const { CognitoIdentityProviderClient, AdminGetUserCommand, AdminSetUserPasswordCommand, AdminInitiateAuthCommand } = require('@aws-sdk/client-cognito-identity-provider');

const cognito = new CognitoIdentityProviderClient({ region: 'us-east-1' });

exports.handler = async (event) => {
  console.log('🔍 Admin Login Request:', JSON.stringify(event, null, 2));
  
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
    const { email, tempPassword } = JSON.parse(event.body || '{}');
    
    // Only allow this for the known Google user
    if (email !== 'george.seib@gmail.com') {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Not authorized' })
      };
    }

    const googleUsername = 'Google_113956208956782440356';
    
    try {
      // Get user details
      const getUserResponse = await cognito.send(new AdminGetUserCommand({
        UserPoolId: process.env.USER_POOL_ID,
        Username: googleUsername
      }));
      
      console.log('🔍 Found user:', googleUsername);
      
      // Set a temporary password for the user so they can authenticate
      if (tempPassword) {
        await cognito.send(new AdminSetUserPasswordCommand({
          UserPoolId: process.env.USER_POOL_ID,
          Username: googleUsername,
          Password: tempPassword,
          Permanent: false
        }));
        
        console.log('🔍 Set temporary password for user');
      }
      
      // Try to authenticate the user with admin auth
      const authResponse = await cognito.send(new AdminInitiateAuthCommand({
        UserPoolId: process.env.USER_POOL_ID,
        ClientId: process.env.CLIENT_ID,
        AuthFlow: 'ADMIN_NO_SRP_AUTH',
        AuthParameters: {
          USERNAME: googleUsername,
          PASSWORD: tempPassword || 'TempPass123!'
        }
      }));
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          user: {
            username: googleUsername,
            email: email,
            status: getUserResponse.UserStatus
          },
          authResult: authResponse.AuthenticationResult
        })
      };
      
    } catch (userError) {
      console.error('🔍 User operation failed:', userError);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ 
          error: 'User authentication failed',
          details: userError.message 
        })
      };
    }

  } catch (error) {
    console.error('🔍 Admin Login Error:', error);
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