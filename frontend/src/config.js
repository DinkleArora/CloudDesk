const env = import.meta.env;
// trim() guards against spaces/newlines pasted into environment variables
const clean = (v) => String(v || '').trim();

export const config = {
  apiUrl: clean(env.VITE_API_URL).replace(/\/+$/, ''),
  userPoolId: clean(env.VITE_USER_POOL_ID),
  userPoolClientId: clean(env.VITE_USER_POOL_CLIENT_ID),
  region: clean(env.VITE_AWS_REGION) || 'ap-southeast-2',
};

export const missingConfig = Object.entries({
  VITE_API_URL: config.apiUrl,
  VITE_USER_POOL_ID: config.userPoolId,
  VITE_USER_POOL_CLIENT_ID: config.userPoolClientId,
})
  .filter(([, value]) => !value)
  .map(([key]) => key);
