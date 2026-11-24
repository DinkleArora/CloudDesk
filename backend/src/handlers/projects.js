import { randomUUID } from 'node:crypto';
import { DeleteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { ddb, TABLES, now, queryAll, batchGet, batchDelete } from '../lib/db.js';
import { s3, BUCKET } from '../lib/s3.js';
import { requireMember, requireOwner } from '../lib/access.js';
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

async function getProjectOr404(projectId) {
  const res = await ddb.send(new GetCommand({ TableName: TABLES.projects, Key: { projectId } }));
  if (!res.Item) throw new HttpError(404, 'Project not found');
  return res.Item;
}

const listMembers = (projectId) =>
  queryAll({
    TableName: TABLES.members,
    KeyConditionExpression: 'projectId = :p',
    ExpressionAttributeValues: { ':p': projectId },
  });

// GET /projects - every project the caller is a member of
async function listProjects(event) {
  const caller = getCaller(event);
  const memberships = await queryAll({
    TableName: TABLES.members,
    IndexName: 'UserProjectsIndex',
    KeyConditionExpression: 'userId = :u',
    ExpressionAttributeValues: { ':u': caller.userId },
  });
  if (!memberships.length) return ok([]);

  const projects = await batchGet(
    TABLES.projects,
    memberships.map((m) => ({ projectId: m.projectId })),
  );
  const roleByProject = Object.fromEntries(memberships.map((m) => [m.projectId, m.role]));
  const result = projects
    .map((p) => ({ ...p, myRole: roleByProject[p.projectId] }))
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return ok(result);
}

// POST /projects { name, description }
async function createProject(event) {
  const caller = getCaller(event);
  const body = parseBody(event);
  const name = requireString(body.name, 'name', { max: 100 });
  const description = requireString(body.description, 'description', { max: 1000, required: false }) || '';
  const timestamp = now();

  const project = {
    projectId: randomUUID(),
    name,
    description,
    ownerId: caller.userId,
    ownerName: caller.name,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  await ddb.send(new PutCommand({ TableName: TABLES.projects, Item: project }));
  await ddb.send(
    new PutCommand({
      TableName: TABLES.members,
      Item: {
        projectId: project.projectId,
        userId: caller.userId,
        name: caller.name,
        email: caller.email,
        role: 'owner',
        joinedAt: timestamp,
      },
    }),
  );
  return created({ ...project, myRole: 'owner' });
}

// GET /projects/{projectId} - project details plus member list
async function getProject(event) {
  const caller = getCaller(event);
  const projectId = pathParam(event, 'projectId');
  const membership = await requireMember(projectId, caller.userId);
  const [project, members] = await Promise.all([getProjectOr404(projectId), listMembers(projectId)]);
  members.sort((a, b) => (a.role === 'owner' ? -1 : b.role === 'owner' ? 1 : a.name.localeCompare(b.name)));
  return ok({ project: { ...project, myRole: membership.role }, members });
}

// PATCH /projects/{projectId} { name?, description? } - owner only
async function updateProject(event) {
  const caller = getCaller(event);
  const projectId = pathParam(event, 'projectId');
  await requireOwner(projectId, caller.userId);
  const body = parseBody(event);

  const sets = ['updatedAt = :ts'];
  const names = {};
  const values = { ':ts': now() };
  if (body.name !== undefined) {
    sets.push('#name = :name');
    names['#name'] = 'name';
    values[':name'] = requireString(body.name, 'name', { max: 100 });
  }
  if (body.description !== undefined) {
    sets.push('description = :description');
    values[':description'] =
      requireString(body.description, 'description', { max: 1000, required: false }) || '';
  }

  const res = await ddb.send(
    new UpdateCommand({
      TableName: TABLES.projects,
      Key: { projectId },
      UpdateExpression: `SET ${sets.join(', ')}`,
      ExpressionAttributeNames: Object.keys(names).length ? names : undefined,
      ExpressionAttributeValues: values,
      ConditionExpression: 'attribute_exists(projectId)',
      ReturnValues: 'ALL_NEW',
    }),
  );
  return ok({ ...res.Attributes, myRole: 'owner' });
}

// DELETE /projects/{projectId} - owner only; removes tasks, files (S3 + metadata) and members
async function deleteProject(event) {
  const caller = getCaller(event);
  const projectId = pathParam(event, 'projectId');
  await requireOwner(projectId, caller.userId);

  const byProject = { KeyConditionExpression: 'projectId = :p', ExpressionAttributeValues: { ':p': projectId } };
  const [tasks, files, members] = await Promise.all([
    queryAll({ TableName: TABLES.tasks, ...byProject }),
    queryAll({ TableName: TABLES.files, ...byProject }),
    listMembers(projectId),
  ]);

  for (let i = 0; i < files.length; i += 1000) {
    const objects = files.slice(i, i + 1000).map((f) => ({ Key: f.key }));
    await s3.send(new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: objects, Quiet: true } }));
  }

  await batchDelete(TABLES.tasks, tasks.map((t) => ({ projectId, taskId: t.taskId })));
  await batchDelete(TABLES.files, files.map((f) => ({ projectId, fileId: f.fileId })));
  await batchDelete(TABLES.members, members.map((m) => ({ projectId, userId: m.userId })));
  await ddb.send(new DeleteCommand({ TableName: TABLES.projects, Key: { projectId } }));
  return noContent();
}

// POST /projects/{projectId}/members { email } - owner only
async function addMember(event) {
  const caller = getCaller(event);
  const projectId = pathParam(event, 'projectId');
  await requireOwner(projectId, caller.userId);
  const email = requireString(parseBody(event).email, 'email', { max: 254 }).toLowerCase();

  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLES.users,
      IndexName: 'EmailIndex',
      KeyConditionExpression: 'email = :e',
      ExpressionAttributeValues: { ':e': email },
      Limit: 1,
    }),
  );
  const user = res.Items?.[0];
  if (!user) {
    throw new HttpError(404, 'No CloudDesk user has this email. Ask them to sign up first, then add them.');
  }

  const member = {
    projectId,
    userId: user.userId,
    name: user.name,
    email: user.email,
    role: 'member',
    joinedAt: now(),
  };
  try {
    await ddb.send(
      new PutCommand({
        TableName: TABLES.members,
        Item: member,
        ConditionExpression: 'attribute_not_exists(userId)',
      }),
    );
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      throw new HttpError(409, 'This user is already a member of the project');
    }
    throw err;
  }
  return created(member);
}

// DELETE /projects/{projectId}/members/{userId}
// The owner can remove any member; a member can remove themselves (leave the project).
async function removeMember(event) {
  const caller = getCaller(event);
  const projectId = pathParam(event, 'projectId');
  const targetUserId = pathParam(event, 'userId');
  const membership = await requireMember(projectId, caller.userId);

  const isSelf = targetUserId === caller.userId;
  if (isSelf && membership.role === 'owner') {
    throw new HttpError(400, 'The owner cannot leave the project. Delete the project instead.');
  }
  if (!isSelf && membership.role !== 'owner') {
    throw new HttpError(403, 'Only the project owner can remove members');
  }

  await ddb.send(
    new DeleteCommand({
      TableName: TABLES.members,
      Key: { projectId, userId: targetUserId },
      ConditionExpression: 'attribute_exists(userId)',
    }),
  );
  return noContent();
}

export const handler = router({
  'GET /projects': listProjects,
  'POST /projects': createProject,
  'GET /projects/{projectId}': getProject,
  'PATCH /projects/{projectId}': updateProject,
  'DELETE /projects/{projectId}': deleteProject,
  'POST /projects/{projectId}/members': addMember,
  'DELETE /projects/{projectId}/members/{userId}': removeMember,
});
