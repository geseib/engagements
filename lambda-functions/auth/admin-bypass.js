const { 
  CognitoIdentityProviderClient, 
  AdminAddUserToGroupCommand,
  AdminRemoveUserFromGroupCommand,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  AdminUpdateUserAttributesCommand
} = require('@aws-sdk/client-cognito-identity-provider');

const cognito = new CognitoIdentityProviderClient({ region: 'us-east-1' });

const ADMIN_BYPASS_EMAIL = 'george.seib@gmail.com';
const ADMIN_BYPASS_PASSWORD = 'TempAdmin123!';

exports.handler = async (event) => {
  console.log('🔧 Admin bypass request:', JSON.stringify(event, null, 2));
  
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };
  
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: ''
    };
  }
  
  try {
    const body = JSON.parse(event.body);
    const { action, email } = body;
    
    if (!email || email !== ADMIN_BYPASS_EMAIL) {
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ 
          success: false, 
          error: 'Unauthorized admin bypass attempt' 
        })
      };
    }
    
    const userPoolId = process.env.USER_POOL_ID;
    
    if (action === 'create_admin') {
      console.log('🔧 Creating admin user...');
      
      try {
        // Create the admin user if it doesn't exist
        await cognito.send(new AdminCreateUserCommand({
          UserPoolId: userPoolId,
          Username: email,
          UserAttributes: [
            { Name: 'email', Value: email },
            { Name: 'email_verified', Value: 'true' },
            { Name: 'name', Value: 'Admin User' },
            { Name: 'custom:status', Value: 'active' },
            { Name: 'custom:role', Value: 'admin' }
          ],
          MessageAction: 'SUPPRESS',
          TemporaryPassword: ADMIN_BYPASS_PASSWORD
        }));
        
        // Set permanent password
        await cognito.send(new AdminSetUserPasswordCommand({
          UserPoolId: userPoolId,
          Username: email,
          Password: ADMIN_BYPASS_PASSWORD,
          Permanent: true
        }));
        
        console.log('✅ Admin user created');
      } catch (error) {
        if (error.name === 'UsernameExistsException') {
          console.log('ℹ️ Admin user already exists');
        } else {
          throw error;
        }
      }
      
      // Add to admins group
      try {
        await cognito.send(new AdminAddUserToGroupCommand({
          UserPoolId: userPoolId,
          Username: email,
          GroupName: 'admins'
        }));
        console.log('✅ Added to admins group');
      } catch (error) {
        if (error.name === 'UserNotInGroupException' || error.message.includes('already')) {
          console.log('ℹ️ User already in admins group or group operation completed');
        } else {
          throw error;
        }
      }
      
      // Remove from pending group if exists
      try {
        await cognito.send(new AdminRemoveUserFromGroupCommand({
          UserPoolId: userPoolId,
          Username: email,
          GroupName: 'pending'
        }));
        console.log('✅ Removed from pending group');
      } catch (error) {
        console.log('ℹ️ User not in pending group (expected)');
      }
      
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ 
          success: true, 
          message: 'Admin user created/updated successfully',
          credentials: {
            email: ADMIN_BYPASS_EMAIL,
            password: ADMIN_BYPASS_PASSWORD
          }
        })
      };
    }
    
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ 
        success: false, 
        error: 'Invalid action' 
      })
    };
    
  } catch (error) {
    console.error('❌ Admin bypass error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ 
        success: false, 
        error: 'Internal server error' 
      })
    };
  }
};