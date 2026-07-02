import { CognitoUserPool } from 'amazon-cognito-identity-js';

// Standalone token access for non-hook call sites (mirrors AuthContext's
// lazy pool init so config.js has loaded before the pool is created).
const getUserPool = () => {
  const userPoolId = window.USER_POOL_ID || process.env.REACT_APP_USER_POOL_ID || 'us-east-1_PLACEHOLDER';
  const clientId = window.USER_POOL_CLIENT_ID || process.env.REACT_APP_CLIENT_ID || 'PLACEHOLDER_CLIENT_ID';
  return new CognitoUserPool({ UserPoolId: userPoolId, ClientId: clientId });
};

// Resolve the current user's ID token, or null when signed out / expired.
export const getAuthToken = () => new Promise((resolve) => {
  try {
    const cognitoUser = getUserPool().getCurrentUser();
    if (!cognitoUser) return resolve(null);
    cognitoUser.getSession((err, session) => {
      if (err || !session || !session.isValid()) return resolve(null);
      resolve(session.getIdToken().getJwtToken());
    });
  } catch (err) {
    console.error('getAuthToken failed:', err);
    resolve(null);
  }
});

// fetch() that attaches the Cognito ID token as a Bearer Authorization
// header. Used for /admin/* routes, which the API's Lambda authorizer
// protects; falls back to an unauthenticated request when signed out.
export const authFetch = async (url, options = {}) => {
  const token = await getAuthToken();
  const headers = { ...(options.headers || {}) };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return fetch(url, { ...options, headers });
};
