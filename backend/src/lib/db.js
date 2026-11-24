import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  BatchGetCommand,
  BatchWriteCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';

export const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

export const TABLES = {
  users: process.env.USERS_TABLE,
  projects: process.env.PROJECTS_TABLE,
  members: process.env.MEMBERS_TABLE,
  tasks: process.env.TASKS_TABLE,
  files: process.env.FILES_TABLE,
};

export const now = () => new Date().toISOString();

const chunk = (items, size) => {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

// Query that follows pagination until every item has been read.
export async function queryAll(params) {
  const items = [];
  let ExclusiveStartKey;
  do {
    const res = await ddb.send(new QueryCommand({ ...params, ExclusiveStartKey }));
    items.push(...(res.Items || []));
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

// BatchGet in chunks of 100 (DynamoDB limit), retrying unprocessed keys.
export async function batchGet(tableName, keys) {
  const results = [];
  for (const part of chunk(keys, 100)) {
    let request = { [tableName]: { Keys: part } };
    for (let attempt = 0; request && Object.keys(request).length && attempt < 5; attempt++) {
      const res = await ddb.send(new BatchGetCommand({ RequestItems: request }));
      results.push(...(res.Responses?.[tableName] || []));
      request = res.UnprocessedKeys && Object.keys(res.UnprocessedKeys).length ? res.UnprocessedKeys : null;
      if (request) await new Promise((r) => setTimeout(r, 100 * 2 ** attempt));
    }
  }
  return results;
}

// BatchWrite deletes in chunks of 25 (DynamoDB limit), retrying unprocessed items.
export async function batchDelete(tableName, keys) {
  for (const part of chunk(keys, 25)) {
    let request = { [tableName]: part.map((Key) => ({ DeleteRequest: { Key } })) };
    for (let attempt = 0; request && attempt < 5; attempt++) {
      const res = await ddb.send(new BatchWriteCommand({ RequestItems: request }));
      request = res.UnprocessedItems && Object.keys(res.UnprocessedItems).length ? res.UnprocessedItems : null;
      if (request) await new Promise((r) => setTimeout(r, 100 * 2 ** attempt));
    }
  }
}
