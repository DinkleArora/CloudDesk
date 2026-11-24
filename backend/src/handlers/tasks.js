import { randomUUID } from 'node:crypto';
import { DeleteCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLES, now, queryAll } from '../lib/db.js';
import { getMembership, requireMember } from '../lib/access.js';
import {
  HttpError,
  created,
  getCaller,
  noContent,
  ok,
  parseBody,
  pathParam,
  requireString,
  router,
} from '../lib/http.js';

const STATUSES = ['todo', 'in_progress', 'done'];
const PRIORITIES = ['low', 'medium', 'high'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validateEnum(value, field, allowed) {
  if (!allowed.includes(value)) throw new HttpError(400, `${field} must be one of: ${allowed.join(', ')}`);
  return value;
}

function validateDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value) || Number.isNaN(Date.parse(value))) {
    throw new HttpError(400, 'dueDate must be a date in YYYY-MM-DD format');
  }
  return value;
}

async function resolveAssignee(projectId, assigneeId) {
  const member = await getMembership(projectId, assigneeId);
  if (!member) throw new HttpError(400, 'The assignee must be a member of this project');
  return member;
}

// GET /projects/{projectId}/tasks
async function listTasks(event) {
  const caller = getCaller(event);
  const projectId = pathParam(event, 'projectId');
  await requireMember(projectId, caller.userId);
  const tasks = await queryAll({
    TableName: TABLES.tasks,
    KeyConditionExpression: 'projectId = :p',
    ExpressionAttributeValues: { ':p': projectId },
  });
  tasks.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  return ok(tasks);
}

// POST /projects/{projectId}/tasks { title, description?, status?, priority?, assigneeId?, dueDate? }
async function createTask(event) {
  const caller = getCaller(event);
  const projectId = pathParam(event, 'projectId');
  await requireMember(projectId, caller.userId);
  const body = parseBody(event);

  const task = {
    projectId,
    taskId: randomUUID(),
    title: requireString(body.title, 'title', { max: 150 }),
    description: requireString(body.description, 'description', { max: 2000, required: false }) || '',
    status: validateEnum(body.status || 'todo', 'status', STATUSES),
    priority: validateEnum(body.priority || 'medium', 'priority', PRIORITIES),
    createdBy: caller.userId,
    createdByName: caller.name,
    createdAt: now(),
  };
  task.updatedAt = task.createdAt;

  if (body.assigneeId) {
    const assignee = await resolveAssignee(projectId, body.assigneeId);
    task.assigneeId = assignee.userId;
    task.assigneeName = assignee.name;
  }
  if (body.dueDate) task.dueDate = validateDate(body.dueDate);

  await ddb.send(new PutCommand({ TableName: TABLES.tasks, Item: task }));
  return created(task);
}

// PATCH /projects/{projectId}/tasks/{taskId}
// Any subset of fields; send assigneeId: null or dueDate: null to clear them.
async function updateTask(event) {
  const caller = getCaller(event);
  const projectId = pathParam(event, 'projectId');
  const taskId = pathParam(event, 'taskId');
  await requireMember(projectId, caller.userId);
  const body = parseBody(event);

  const sets = ['updatedAt = :updatedAt'];
  const removes = [];
  const names = {};
  const values = { ':updatedAt': now() };
  const set = (attr, value) => {
    names[`#${attr}`] = attr;
    values[`:${attr}`] = value;
    sets.push(`#${attr} = :${attr}`);
  };
  const remove = (attr) => {
    names[`#${attr}`] = attr;
    removes.push(`#${attr}`);
  };

  if (body.title !== undefined) set('title', requireString(body.title, 'title', { max: 150 }));
  if (body.description !== undefined) {
    set('description', requireString(body.description, 'description', { max: 2000, required: false }) || '');
  }
  if (body.status !== undefined) set('status', validateEnum(body.status, 'status', STATUSES));
  if (body.priority !== undefined) set('priority', validateEnum(body.priority, 'priority', PRIORITIES));
  if (body.dueDate !== undefined) {
    if (body.dueDate === null || body.dueDate === '') remove('dueDate');
    else set('dueDate', validateDate(body.dueDate));
  }
  if (body.assigneeId !== undefined) {
    if (body.assigneeId === null || body.assigneeId === '') {
      remove('assigneeId');
      remove('assigneeName');
    } else {
      const assignee = await resolveAssignee(projectId, body.assigneeId);
      set('assigneeId', assignee.userId);
      set('assigneeName', assignee.name);
    }
  }

  let UpdateExpression = `SET ${sets.join(', ')}`;
  if (removes.length) UpdateExpression += ` REMOVE ${removes.join(', ')}`;

  try {
    const res = await ddb.send(
      new UpdateCommand({
        TableName: TABLES.tasks,
        Key: { projectId, taskId },
        UpdateExpression,
        ExpressionAttributeNames: Object.keys(names).length ? names : undefined,
        ExpressionAttributeValues: values,
        ConditionExpression: 'attribute_exists(taskId)',
        ReturnValues: 'ALL_NEW',
      }),
    );
    return ok(res.Attributes);
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') throw new HttpError(404, 'Task not found');
    throw err;
  }
}

// DELETE /projects/{projectId}/tasks/{taskId}
async function deleteTask(event) {
  const caller = getCaller(event);
  const projectId = pathParam(event, 'projectId');
  const taskId = pathParam(event, 'taskId');
  await requireMember(projectId, caller.userId);
  try {
    await ddb.send(
      new DeleteCommand({
        TableName: TABLES.tasks,
        Key: { projectId, taskId },
        ConditionExpression: 'attribute_exists(taskId)',
      }),
    );
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') throw new HttpError(404, 'Task not found');
    throw err;
  }
  return noContent();
}

export const handler = router({
  'GET /projects/{projectId}/tasks': listTasks,
  'POST /projects/{projectId}/tasks': createTask,
  'PATCH /projects/{projectId}/tasks/{taskId}': updateTask,
  'DELETE /projects/{projectId}/tasks/{taskId}': deleteTask,
});
