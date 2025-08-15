const { CognitoIdentityProviderClient, AdminInitiateAuthCommand, AdminGetUserCommand } = require('@aws-sdk/client-cognito-identity-provider');

const cognito = new CognitoIdentityProviderClient({ region: 'us-east-1' });

exports.handler = async (event) => {
  console.log('🔍 Google Auth Request:', JSON.stringify(event, null, 2));
  
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const { googleToken } = JSON.parse(event.body || '{}');
    
    if (!googleToken) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Google token is required' })
      };
    }

    // Verify Google token by calling Google's API
    const googleResponse = await fetch(`https://www.googleapis.com/oauth2/v1/userinfo?access_token=${googleToken}`);
    
    if (!googleResponse.ok) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Invalid Google token' })
      };
    }

    const googleUser = await googleResponse.json();
    console.log('🔍 Google User Info:', googleUser);

    // Check if this Google user exists in Cognito
    const googleSub = googleUser.id;
    const cognitoUsername = `Google_${googleSub}`;
    
    try {
      const getUserResponse = await cognito.send(new AdminGetUserCommand({
        UserPoolId: process.env.USER_POOL_ID,
        Username: cognitoUsername
      }));
      
      console.log('🔍 Found Cognito user:', cognitoUsername);
      
      // Create a custom auth challenge for this user
      const authResponse = await cognito.send(new AdminInitiateAuthCommand({
        UserPoolId: process.env.USER_POOL_ID,
        ClientId: process.env.CLIENT_ID,
        AuthFlow: 'CUSTOM_AUTH',
        AuthParameters: {
          USERNAME: cognitoUsername,
          CHALLENGE_NAME: 'CUSTOM_CHALLENGE'
        }
      }));
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          user: {
            username: cognitoUsername,
            email: googleUser.email,
            name: googleUser.name
          },
          authChallenge: authResponse
        })
      };
      
    } catch (userError) {
      console.log('🔍 User not found in Cognito:', userError.message);
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ 
          error: 'Google account not linked to this application',
          googleUser: {
            email: googleUser.email,
            name: googleUser.name
          }
        })
      };
    }

  } catch (error) {
    console.error('🔍 Google Auth Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Authentication failed',
        details: error.message 
      })
    };
  }
};