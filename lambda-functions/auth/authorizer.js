// Lambda authorizer for the HTTP API (payload format 2.0, simple responses).
//
// Validates a Cognito JWT (ID token) from the Authorization header against
// the user pool configured via env (USER_POOL_ID / CLIENT_ID — UserPoolV2),
// resolves the user's groups, and allows/denies based on the route.
//
// Wired in template-clean.yaml as RestApi CognitoAuthorizer with
// AuthorizerPayloadFormatVersion "2.0" and EnableSimpleResponses true:
// the handler returns { isAuthorized, context }, not an IAM policy.
const { CognitoIdentityProviderClient, AdminListGroupsForUserCommand } = require('@aws-sdk/client-cognito-identity-provider');
const jwt = require('jsonwebtoken');
const jwkToPem = require('jwk-to-pem');
const axios = require('axios');

// Cache for Cognito JWKs (persists across warm invocations)
let cachedJwks = null;
let cacheExpiry = 0;

const cognito = new CognitoIdentityProviderClient({});

// Get Cognito JWKs with caching
async function getJwks() {
  const now = Date.now();
  if (cachedJwks && now < cacheExpiry) {
    return cachedJwks;
  }

  const region = process.env.REGION || process.env.AWS_REGION || 'us-east-1';
  const userPoolId = process.env.USER_POOL_ID;
  const url = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}/.well-known/jwks.json`;

  try {
    const response = await axios.get(url);
    cachedJwks = response.data;
    cacheExpiry = now + 3600000; // Cache for 1 hour
    return cachedJwks;
  } catch (error) {
    console.error('Error fetching JWKs:', error);
    throw new Error('Unable to fetch JWKs');
  }
}

// Verify JWT token
async function verifyToken(token) {
  // Decode token header to get kid
  const decodedHeader = jwt.decode(token, { complete: true });
  if (!decodedHeader) {
    throw new Error('Invalid token');
  }

  // Get JWKs
  const jwks = await getJwks();
  const jwk = jwks.keys.find(key => key.kid === decodedHeader.header.kid);
  if (!jwk) {
    throw new Error('JWK not found');
  }

  // Convert JWK to PEM
  const pem = jwkToPem(jwk);

  const region = process.env.REGION || process.env.AWS_REGION || 'us-east-1';

  // Verify signature, issuer, and audience (frontend sends the ID token,
  // whose aud claim is the app client id)
  return jwt.verify(token, pem, {
    algorithms: ['RS256'],
    issuer: `https://cognito-idp.${region}.amazonaws.com/${process.env.USER_POOL_ID}`,
    audience: process.env.CLIENT_ID
  });
}

// Get user groups from Cognito
async function getUserGroups(username) {
  try {
    const response = await cognito.send(new AdminListGroupsForUserCommand({
      UserPoolId: process.env.USER_POOL_ID,
      Username: username
    }));
    return response.Groups.map(group => group.GroupName);
  } catch (error) {
    console.error('Error fetching user groups:', error);
    return [];
  }
}

// Check if user has required permissions
function hasPermission(groups, requiredGroups) {
  if (!requiredGroups || requiredGroups.length === 0) {
    return true;
  }
  return requiredGroups.some(group => groups.includes(group));
}

// Which groups a route requires. `path` is the route path without a leading
// slash, e.g. "admin/clear-game/{gameId}"; `method` is the HTTP verb.
function requiredGroupsForRoute(method, path) {
  // Hosts reset their own games via the admin clear-game endpoint
  // (GameHostPage.jsx), so hosts are allowed there.
  if (path.startsWith('admin/clear-game')) {
    return ['hosts', 'admins'];
  }
  // All other admin routes require the admins group
  if (path.startsWith('admin')) {
    return ['admins'];
  }
  // Game creation/management requires host or admin group
  if ((method === 'POST' || method === 'PUT' || method === 'DELETE') && path.includes('games')) {
    return ['hosts', 'admins'];
  }
  // Public routes (GET game, join, answer, vote) don't require groups
  if (path.includes('join') || path.includes('answer') || path.includes('vote') ||
      (method === 'GET' && path.includes('games'))) {
    return [];
  }
  // All other routes require at least host group
  return ['hosts', 'admins'];
}

// Main handler — HTTP API payload 2.0 simple response
exports.handler = async (event) => {
  try {
    // HTTP API lowercases header names; identitySource is the configured
    // Authorization header value
    const rawToken = event.identitySource?.[0] || event.headers?.authorization || '';
    const token = rawToken.replace(/^Bearer\s+/i, '');
    if (!token) {
      console.log('Authorization denied: no token');
      return { isAuthorized: false };
    }

    // Verify token
    const decoded = await verifyToken(token);
    const username = decoded['cognito:username'] || decoded.sub;
    const email = decoded.email;

    // Get user groups
    const groups = await getUserGroups(username);

    // Check user status (custom attribute)
    const userStatus = decoded['custom:status'] || 'enabled';
    if (userStatus === 'disabled') {
      console.log(`Authorization denied: user ${username} is disabled`);
      return { isAuthorized: false };
    }

    // routeKey is e.g. "POST /admin/clear-game/{gameId}"
    const [method, routePath] = (event.routeKey || '').split(' ');
    const path = (routePath || event.rawPath || '').replace(/^\//, '');

    const requiredGroups = requiredGroupsForRoute(method, path);
    if (!hasPermission(groups, requiredGroups)) {
      console.log(`Authorization denied: ${username} (groups: ${groups.join(',')}) lacks ${requiredGroups.join('|')} for ${event.routeKey}`);
      return { isAuthorized: false };
    }

    return {
      isAuthorized: true,
      // Available to backing lambdas as event.requestContext.authorizer.lambda
      context: {
        userId: decoded.sub,
        username,
        email,
        groups: groups.join(','),
        status: userStatus,
        role: decoded['custom:role'] || 'host'
      }
    };
  } catch (error) {
    console.error('Authorization error:', error);
    return { isAuthorized: false };
  }
};

// Export for testing
module.exports.verifyToken = verifyToken;
module.exports.getUserGroups = getUserGroups;
module.exports.hasPermission = hasPermission;
module.exports.requiredGroupsForRoute = requiredGroupsForRoute;
