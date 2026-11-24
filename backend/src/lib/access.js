import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLES } from './db.js';
import { HttpError } from './http.js';

export async function getMembership(projectId, userId) {
  const res = await ddb.send(new GetCommand({ TableName: TABLES.members, Key: { projectId, userId } }));
  return res.Item || null;
}

// Every project route checks that the caller belongs to the project.
// We return 404 (not 403) so non-members cannot tell whether a project exists.
export async function requireMember(projectId, userId) {
  const membership = await getMembership(projectId, userId);
  if (!membership) throw new HttpError(404, 'Project not found');
  return membership;
}

export async function requireOwner(projectId, userId) {
  const membership = await requireMember(projectId, userId);
  if (membership.role !== 'owner') throw new HttpError(403, 'Only the project owner can do this');
  return membership;
}
