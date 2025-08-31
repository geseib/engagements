const AWS = require('aws-sdk');
const jwt = require('jsonwebtoken');
const jwkToPem = require('jwk-to-pem');
const axios = require('axios');

// Cache for Cognito JWKs
let cachedJwks = null;
let cacheExpiry = 0;

const cognito = new AWS.CognitoIdentityServiceProvider();

// Get Cognito JWKs with caching
async function getJwks() {
  const now = Date.now();
  if (cachedJwks && now < cacheExpiry) {
    return cachedJwks;
  }

  const region = process.env.REGION || 'us-east-1';
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
  try {
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

    // Verify token
    const decoded = jwt.verify(token, pem, {
      algorithms: ['RS256'],
      issuer: `https://cognito-idp.${process.env.REGION}.amazonaws.com/${process.env.USER_POOL_ID}`,
      audience: process.env.CLIENT_ID
    });

    return decoded;
  } catch (error) {
    console.error('Token verification failed:', error);
    throw error;
  }
}

// Get user groups from Cognito
async function getUserGroups(username) {
  try {
    const params = {
      UserPoolId: process.env.USER_POOL_ID,
      Username: username
    };

    const response = await cognito.adminListGroupsForUser(params).promise();
    return response.Groups.map(group => group.GroupName);
  } catch (error) {
    console.error('Error fetching user groups:', error);
    return [];
  }
}

// Generate policy document
function generatePolicy(principalId, effect, resource, context = {}) {
  const authResponse = {
    principalId
  };

  if (effect && resource) {
    authResponse.policyDocument = {
      Version: '2012-10-17',
      Statement: [{
        Action: 'execute-api:Invoke',
        Effect: effect,
        Resource: resource
      }]
    };
  }

  // Add context data that will be available in Lambda functions
  authResponse.context = {
    ...context,
    stringKey: JSON.stringify(context) // API Gateway requires string values
  };

  return authResponse;
}

// Check if user has required permissions
function hasPermission(groups, requiredGroups) {
  if (!requiredGroups || requiredGroups.length === 0) {
    return true;
  }
  return requiredGroups.some(group => groups.includes(group));
}

// Main handler
exports.handler = async (event) => {
  console.log('Authorizer event:', JSON.stringify(event, null, 2));

  try {
    // Extract token from event
    const token = event.authorizationToken?.replace(/^Bearer\s+/i, '');
    if (!token) {
      throw new Error('Unauthorized');
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
      throw new Error('User account is disabled');
    }

    // Extract required groups from route
    const methodArn = event.methodArn;
    const arnParts = methodArn.split(':');
    const apiGatewayArn = arnParts[5].split('/');
    const method = apiGatewayArn[2];
    const resource = apiGatewayArn[3] || '';

    // Define permissions based on routes
    let requiredGroups = [];
    
    // Admin routes require admin group
    if (resource.startsWith('admin')) {
      requiredGroups = ['admins'];
    }
    // Game creation/management requires host or admin group
    else if ((method === 'POST' || method === 'PUT' || method === 'DELETE') && 
             (resource === 'games' || resource.includes('games'))) {
      requiredGroups = ['hosts', 'admins'];
    }
    // Public routes (GET game, join, answer, vote) don't require groups
    else if (resource.includes('join') || resource.includes('answer') || 
             resource.includes('vote') || (method === 'GET' && resource.includes('games'))) {
      requiredGroups = [];
    }
    // All other routes require at least host group
    else {
      requiredGroups = ['hosts', 'admins'];
    }

    // Check permissions
    if (!hasPermission(groups, requiredGroups)) {
      throw new Error('Insufficient permissions');
    }

    // Generate policy
    const context = {
      userId: decoded.sub,
      username,
      email,
      groups: groups.join(','),
      status: userStatus,
      role: decoded['custom:role'] || 'host'
    };

    return generatePolicy(decoded.sub, 'Allow', event.methodArn, context);

  } catch (error) {
    console.error('Authorization error:', error);
    throw new Error('Unauthorized');
  }
};

// Export for testing
module.exports.verifyToken = verifyToken;
module.exports.getUserGroups = getUserGroups;
module.exports.hasPermission = hasPermission;