import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLES, now } from '../lib/db.js';
import { getCaller, ok, router } from '../lib/http.js';

// POST /me
// Called by the frontend right after sign-in. Saves the user's profile (from the
// verified Cognito token) so teammates can add them to projects by email.
async function upsertMe(event) {
  const caller = getCaller(event);
  const timestamp = now();
  const res = await ddb.send(
    new UpdateCommand({
      TableName: TABLES.users,
      Key: { userId: caller.userId },
      UpdateExpression:
        'SET email = :email, #name = :name, updatedAt = :ts, createdAt = if_not_exists(createdAt, :ts)',
      ExpressionAttributeNames: { '#name': 'name' },
      ExpressionAttributeValues: { ':email': caller.email, ':name': caller.name, ':ts': timestamp },
      ReturnValues: 'ALL_NEW',
    }),
  );
  return ok(res.Attributes);
}

export const handler = router({
  'POST /me': upsertMe,
});
