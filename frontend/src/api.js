import { fetchAuthSession } from 'aws-amplify/auth';
import { config } from './config.js';

// Every request carries the Cognito ID token; API Gateway's JWT authorizer verifies it.
async function request(method, path, body) {
  const session = await fetchAuthSession();
  const token = session.tokens?.idToken?.toString();
  if (!token) throw new Error('Your session has expired. Please sign in again.');

  const headers = { Authorization: `Bearer ${token}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${config.apiUrl}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }
  }
  if (!res.ok) throw new Error(data?.message || `Request failed (${res.status})`);
  return data;
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body = {}) => request('POST', path, body),
  patch: (path, body = {}) => request('PATCH', path, body),
  del: (path) => request('DELETE', path),
};

// PUT the file directly to S3 with XHR so we can show upload progress.
function putToS3(url, file, contentType, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Upload to S3 failed (${xhr.status})`));
    xhr.onerror = () => reject(new Error('Network error while uploading to S3'));
    xhr.send(file);
  });
}

// Three-step upload: get presigned URL -> PUT to S3 -> confirm so metadata is saved in DynamoDB.
export async function uploadFile(projectId, file, onProgress) {
  const contentType = file.type || 'application/octet-stream';
  const { fileId, key, uploadUrl } = await api.post(`/projects/${projectId}/files/upload-url`, {
    fileName: file.name,
    contentType,
    size: file.size,
  });
  await putToS3(uploadUrl, file, contentType, onProgress);
  return api.post(`/projects/${projectId}/files`, { fileId, key });
}
