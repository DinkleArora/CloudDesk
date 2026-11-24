const env = import.meta.env;

export const config = {
  apiUrl: (env.VITE_API_URL || '').replace(/\/+$/, ''),
  userPoolId: env.VITE_USER_POOL_ID || '',
  userPoolClientId: env.VITE_USER_POOL_CLIENT_ID || '',
  region: env.VITE_AWS_REGION || 'ap-south-1',
};

export const missingConfig = Object.entries({
  VITE_API_URL: config.apiUrl,
  VITE_USER_POOL_ID: config.userPoolId,
  VITE_USER_POOL_CLIENT_ID: config.userPoolClientId,
})
  .filter(([, value]) => !value)
  .map(([key]) => key);
