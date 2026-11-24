// Small helpers shared by every Lambda: routing, JSON responses, errors, auth claims, validation.

export class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? '' : JSON.stringify(body),
  };
}

export const ok = (body) => json(200, body);
export const created = (body) => json(201, body);
export const noContent = () => ({ statusCode: 204, body: '' });

export function parseBody(event) {
  if (!event.body) return {};
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON');
  }
}

// The Cognito JWT authorizer on API Gateway has already verified the token;
// we only read the verified claims it passes through.
export function getCaller(event) {
  const claims = event.requestContext?.authorizer?.jwt?.claims || {};
  if (!claims.sub) throw new HttpError(401, 'Unauthorized');
  const email = String(claims.email || '').toLowerCase();
  return {
    userId: claims.sub,
    email,
    name: claims.name || email.split('@')[0] || 'User',
  };
}

export function pathParam(event, name) {
  const value = event.pathParameters?.[name];
  if (!value) throw new HttpError(400, `Missing path parameter: ${name}`);
  return decodeURIComponent(value);
}

export function requireString(value, field, { max = 200, required = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new HttpError(400, `${field} is required`);
    return undefined;
  }
  if (typeof value !== 'string') throw new HttpError(400, `${field} must be a string`);
  const trimmed = value.trim();
  if (required && !trimmed) throw new HttpError(400, `${field} is required`);
  if (trimmed.length > max) throw new HttpError(400, `${field} must be at most ${max} characters`);
  return trimmed;
}

// Builds a Lambda handler that dispatches on the HTTP API route key, e.g. "GET /projects/{projectId}".
export function router(routes) {
  return async (event) => {
    try {
      const route = routes[event.routeKey];
      if (!route) throw new HttpError(404, `No route for ${event.routeKey}`);
      return await route(event);
    } catch (err) {
      if (err instanceof HttpError) return json(err.statusCode, { message: err.message });
      if (err?.name === 'ConditionalCheckFailedException') {
        return json(409, { message: 'The item was changed or does not exist' });
      }
      console.error('Unhandled error', { routeKey: event.routeKey, error: err });
      return json(500, { message: 'Internal server error' });
    }
  };
}
