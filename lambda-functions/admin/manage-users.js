const { 
  CognitoIdentityProviderClient, 
  ListUsersCommand,
  AdminListGroupsForUserCommand,
  AdminAddUserToGroupCommand,
  AdminRemoveUserFromGroupCommand,
  AdminDeleteUserCommand
} = require('@aws-sdk/client-cognito-identity-provider');

const cognito = new CognitoIdentityProviderClient({ region: 'us-east-1' });
const USER_POOL_ID = process.env.USER_POOL_ID;

// Skip authorization for now - just focus on getting user list working

// Simple function to list all users
async function listUsers(event) {
  console.log('Listing users from User Pool:', USER_POOL_ID);
  
  try {
    const response = await cognito.send(new ListUsersCommand({
      UserPoolId: USER_POOL_ID,
      Limit: 60  // Max allowed per request
    }));
    
    console.log('Found users:', response.Users?.length || 0);
    
    // Get user groups and format for frontend
    const users = await Promise.all(response.Users.map(async (user) => {
      const attributes = {};
      user.Attributes.forEach(attr => {
        attributes[attr.Name] = attr.Value;
      });
      
      // Get user's groups
      let userGroups = [];
      let userState = 'pending'; // default state
      try {
        const groupsResponse = await cognito.send(new AdminListGroupsForUserCommand({
          UserPoolId: USER_POOL_ID,
          Username: user.Username
        }));
        
        console.log(`Groups for ${user.Username}:`, groupsResponse.Groups?.map(g => g.GroupName) || 'none');
        
        if (groupsResponse.Groups && groupsResponse.Groups.length > 0) {
          userGroups = groupsResponse.Groups.map(g => g.GroupName);
          userState = groupsResponse.Groups[0].GroupName; // Primary group for state
        } else {
          console.log(`User ${user.Username} has no groups assigned`);
        }
      } catch (error) {
        console.log(`Could not get groups for user ${user.Username}:`, error.message);
      }
      
      return {
        username: user.Username,
        email: attributes.email,
        name: attributes.name || (attributes.given_name ? attributes.given_name + ' ' + attributes.family_name : ''),
        groups: userGroups, // Array of groups for display
        state: userState, // Primary group for state management
        status: userState, // Alias for compatibility
        userStatus: user.UserStatus, // CONFIRMED, etc.
        enabled: user.Enabled,
        created: user.UserCreateDate
      };
    }));
    
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ users })
    };
    
  } catch (error) {
    console.error('Error listing users:', error);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ error: error.message })
    };
  }
}

// Change user state by moving them between groups
async function changeUserState(event) {
  console.log('Changing user state');
  
  const { username } = event.pathParameters || {};
  const { newState } = JSON.parse(event.body || '{}');
  
  if (!username || !newState) {
    return {
      statusCode: 400,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Missing username or newState' })
    };
  }
  
  const validStates = ['pending', 'hosts', 'admins', 'disabled', 'delete'];
  if (!validStates.includes(newState)) {
    return {
      statusCode: 400,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Invalid state. Must be: ' + validStates.join(', ') })
    };
  }
  
  try {
    // Handle delete action
    if (newState === 'delete') {
      await cognito.send(new AdminDeleteUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: username
      }));
      
      console.log(`User ${username} deleted`);
      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true, message: 'User deleted' })
      };
    }
    
    // For other states, first remove user from all groups
    const currentGroupsResponse = await cognito.send(new AdminListGroupsForUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: username
    }));
    
    // Remove from all current groups
    if (currentGroupsResponse.Groups) {
      for (const group of currentGroupsResponse.Groups) {
        await cognito.send(new AdminRemoveUserFromGroupCommand({
          UserPoolId: USER_POOL_ID,
          Username: username,
          GroupName: group.GroupName
        }));
        console.log(`Removed ${username} from group ${group.GroupName}`);
      }
    }
    
    // Add to new group (all states correspond to group names)
    await cognito.send(new AdminAddUserToGroupCommand({
      UserPoolId: USER_POOL_ID,
      Username: username,
      GroupName: newState
    }));
    
    console.log(`Added ${username} to group ${newState}`);
    
    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, message: `User moved to ${newState}` })
    };
    
  } catch (error) {
    console.error('Error changing user state:', error);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message })
    };
  }
}

// Handle OPTIONS preflight requests
function handlePreflight() {
  return {
    statusCode: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'OPTIONS,GET,POST,PUT,DELETE',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token',
      'Access-Control-Max-Age': '86400'
    },
    body: ''
  };
}

// Handler for user management
exports.handler = async (event) => {
  console.log('User management request received');

  const method = event.requestContext.http.method;
  const path = event.requestContext.http.path;

  // Handle preflight requests
  if (method === 'OPTIONS') {
    return handlePreflight();
  }

  // Route to appropriate function
  if (method === 'POST' && path.endsWith('/admin/users/list')) {
    return await listUsers(event);
  }
  
  // Change user state: PUT /admin/users/{username}/state
  if (method === 'PUT' && path.includes('/admin/users/') && path.endsWith('/state')) {
    return await changeUserState(event);
  }

  return {
    statusCode: 404,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ error: 'Endpoint not found' })
  };
};