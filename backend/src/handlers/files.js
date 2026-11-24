import { randomUUID } from 'node:crypto';
import { DeleteCommand, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ddb, TABLES, now, queryAll } from '../lib/db.js';
import { s3, BUCKET, MAX_FILE_SIZE_BYTES, URL_EXPIRY_SECONDS } from '../lib/s3.js';
import { requireMember } from '../lib/access.js';
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

const maxMb = Math.round(MAX_FILE_SIZE_BYTES / 1024 / 1024);

function safeFileName(name) {
  const cleaned = name.replace(/[^\w.\- ()]/g, '_').replace(/\s+/g, ' ').trim();
  return (cleaned || 'file').slice(0, 150);
}

async function getFileOr404(projectId, fileId) {
  const res = await ddb.send(new GetCommand({ TableName: TABLES.files, Key: { projectId, fileId } }));
  if (!res.Item) throw new HttpError(404, 'File not found');
  return res.Item;
}

// GET /projects/{projectId}/files
async function listFiles(event) {
  const caller = getCaller(event);
  const projectId = pathParam(event, 'projectId');
  await requireMember(projectId, caller.userId);
  const files = await queryAll({
    TableName: TABLES.files,
    KeyConditionExpression: 'projectId = :p',
    ExpressionAttributeValues: { ':p': projectId },
  });
  files.sort((a, b) => (b.uploadedAt || '').localeCompare(a.uploadedAt || ''));
  return ok(files);
}

// POST /projects/{projectId}/files/upload-url { fileName, contentType, size }
// Step 1 of an upload: returns a short-lived presigned URL. The browser then PUTs the
// file straight to S3, so file bytes never pass through Lambda or API Gateway.
async function getUploadUrl(event) {
  const caller = getCaller(event);
  const projectId = pathParam(event, 'projectId');
  await requireMember(projectId, caller.userId);
  const body = parseBody(event);

  const fileName = safeFileName(requireString(body.fileName, 'fileName', { max: 255 }));
  const contentType =
    requireString(body.contentType, 'contentType', { max: 200, required: false }) || 'application/octet-stream';
  const size = Number(body.size);
  if (!Number.isFinite(size) || size <= 0) throw new HttpError(400, 'size must be a positive number of bytes');
  if (size > MAX_FILE_SIZE_BYTES) throw new HttpError(400, `Files must be ${maxMb} MB or smaller`);

  const fileId = randomUUID();
  const key = `projects/${projectId}/${fileId}/${fileName}`;
  const uploadUrl = await getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: contentType }),
    { expiresIn: URL_EXPIRY_SECONDS },
  );
  return ok({ fileId, key, uploadUrl, expiresIn: URL_EXPIRY_SECONDS });
}

// POST /projects/{projectId}/files { fileId, key }
// Step 2 of an upload: checks the object really exists in S3, then saves its metadata.
async function confirmUpload(event) {
  const caller = getCaller(event);
  const projectId = pathParam(event, 'projectId');
  await requireMember(projectId, caller.userId);
  const body = parseBody(event);

  const fileId = requireString(body.fileId, 'fileId', { max: 64 });
  const key = requireString(body.key, 'key', { max: 400 });
  const prefix = `projects/${projectId}/${fileId}/`;
  if (!key.startsWith(prefix) || key.length === prefix.length) throw new HttpError(400, 'Invalid file key');

  let head;
  try {
    head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
  } catch (err) {
    if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
      throw new HttpError(400, 'Upload not found in storage. Please try uploading again.');
    }
    throw err;
  }
  if (head.ContentLength > MAX_FILE_SIZE_BYTES) {
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
    throw new HttpError(400, `Files must be ${maxMb} MB or smaller`);
  }

  const file = {
    projectId,
    fileId,
    key,
    fileName: key.slice(prefix.length),
    contentType: head.ContentType || 'application/octet-stream',
    size: head.ContentLength,
    uploadedBy: caller.userId,
    uploadedByName: caller.name,
    uploadedAt: now(),
  };
  try {
    await ddb.send(
      new PutCommand({ TableName: TABLES.files, Item: file, ConditionExpression: 'attribute_not_exists(fileId)' }),
    );
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') throw new HttpError(409, 'This upload was already saved');
    throw err;
  }
  return created(file);
}

// GET /projects/{projectId}/files/{fileId}/download-url
async function getDownloadUrl(event) {
  const caller = getCaller(event);
  const projectId = pathParam(event, 'projectId');
  const fileId = pathParam(event, 'fileId');
  await requireMember(projectId, caller.userId);
  const file = await getFileOr404(projectId, fileId);

  const downloadUrl = await getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: BUCKET,
      Key: file.key,
      ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    }),
    { expiresIn: URL_EXPIRY_SECONDS },
  );
  return ok({ downloadUrl, expiresIn: URL_EXPIRY_SECONDS });
}

// DELETE /projects/{projectId}/files/{fileId} - the uploader or the project owner
async function deleteFile(event) {
  const caller = getCaller(event);
  const projectId = pathParam(event, 'projectId');
  const fileId = pathParam(event, 'fileId');
  const membership = await requireMember(projectId, caller.userId);
  const file = await getFileOr404(projectId, fileId);

  if (file.uploadedBy !== caller.userId && membership.role !== 'owner') {
    throw new HttpError(403, 'Only the uploader or the project owner can delete this file');
  }
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: file.key }));
  await ddb.send(new DeleteCommand({ TableName: TABLES.files, Key: { projectId, fileId } }));
  return noContent();
}

export const handler = router({
  'GET /projects/{projectId}/files': listFiles,
  'POST /projects/{projectId}/files/upload-url': getUploadUrl,
  'POST /projects/{projectId}/files': confirmUpload,
  'GET /projects/{projectId}/files/{fileId}/download-url': getDownloadUrl,
  'DELETE /projects/{projectId}/files/{fileId}': deleteFile,
});
