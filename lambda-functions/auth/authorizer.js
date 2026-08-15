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

// Routes under /admin/* that HOSTS may also reach, matched on the EXACT
// "METHOD path" pair.
//
// These are the question-set routes the create-engagement flow needs: hosts
// build their own sets there rather than in the admin console. Reaching a route
// is not the same as being allowed to change a given row — WHICH set a host may
// edit or delete is decided per-row by `admin/shared/question-set-access.js`,
// which refuses any set the caller did not create. This gate only decides who
// may knock.
//
// EXACT PAIRS, NOT A PREFIX, AND THAT IS THE WHOLE POINT. `path.startsWith(
// 'admin/question-sets')` would read as the same intent and would additionally
// open `admin/question-sets/{setId}/versions`, `.../versions/{version}` (a
// DELETE) and `.../versions/{version}/promote` — three routes that decide which
// content a live game plays and that nothing here is asking to share. This is
// the mirror of the `path === 'games'` decision below: prefix matching in this
// function has already been the wrong tool once, in both directions.
//
// Not included, deliberately: toggle-question-set and toggle-quickstart (global
// curation — which sets the whole product offers), the AI generation routes
// (they spend Bedrock budget), download-question-set, and every version route.
const HOST_ADMIN_ROUTES = new Set([
  // The list. Authenticated, and the only projection carrying ownership, so a
  // host can see which sets are theirs.
  'GET admin/question-sets',
  // Create a set (and, with replaceSetId, replace one the caller owns).
  'POST admin/upload-questions',
  // The blank CSV a host fills in. Read-only and set-independent.
  'GET admin/download-template',
  // Rename/describe a set. Ownership checked in the handler.
  'PUT admin/edit-question-set/{setId}',
  // Delete a set. Ownership checked in the handler.
  'DELETE admin/question-sets/{setId}',
  // The set's images: mint presigned upload URLs, and report which questions
  // point at a file that is not there. Both are ownership-guarded by
  // `requireSetManager` in their handlers, exactly like the two above — a host
  // who builds a set with artwork has to be able to put the artwork somewhere,
  // and to be told when a question is pointing at nothing.
  //
  // STILL EXACT PAIRS. `admin/question-sets/{setId}/media` and
  // `admin/question-sets/{setId}/media/uploads` are two entries because they
  // are two routes; a prefix match here would additionally open every version
  // route, which is the mistake this list's header exists to prevent.
  'POST admin/question-sets/{setId}/media/uploads',
  'GET admin/question-sets/{setId}/media',
]);

// Which groups a route requires. `path` is the route path without a leading
// slash, e.g. "admin/clear-game/{gameId}"; `method` is the HTTP verb.
function requiredGroupsForRoute(method, path) {
  // Hosts reset their own games via the admin clear-game endpoint
  // (GameHostPage.jsx), so hosts are allowed there.
  if (path.startsWith('admin/clear-game')) {
    return ['hosts', 'admins'];
  }
  // Hosts build and manage their own question sets. See HOST_ADMIN_ROUTES.
  if (HOST_ADMIN_ROUTES.has(`${method} ${path}`)) {
    return ['hosts', 'admins'];
  }
  // All other admin routes require the admins group
  if (path.startsWith('admin')) {
    return ['admins'];
  }
  // The games LIST, not a game. `GET /games` returns every session's title,
  // host name and four-digit join code in the environment, and the generic
  // "GET + games is public" rule below would let ANY account in the pool read
  // it — including one still sitting in `pending`, unapproved. That is the
  // failure require-admin.js:19-24 documents for /admin/users/*: an authorizer
  // proves you are someone, it does not prove you are allowed.
  //
  // MATCHED EXACTLY, and that is load-bearing. `path.startsWith('games')` or
  // `path.includes('games')` here would also catch GET /games/{gameId} and
  // every GET /games/{gameId}/* below it — the session brief the root page
  // checks a code against, plus /state, /players, /answers, /question, /votes
  // — and 401 every participant out of the join flow.
  if (method === 'GET' && path === 'games') {
    return ['hosts', 'admins'];
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
module.exports.HOST_ADMIN_ROUTES = HOST_ADMIN_ROUTES;
module.exports.verifyToken = verifyToken;
module.exports.getUserGroups = getUserGroups;
module.exports.hasPermission = hasPermission;
module.exports.requiredGroupsForRoute = requiredGroupsForRoute;
