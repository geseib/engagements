const {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  AdminListGroupsForUserCommand,
  AdminAddUserToGroupCommand,
  AdminRemoveUserFromGroupCommand,
  AdminDeleteUserCommand,
  AdminDisableUserCommand,
  AdminEnableUserCommand
} = require('@aws-sdk/client-cognito-identity-provider');

const cognito = new CognitoIdentityProviderClient({ region: 'us-east-1' });
const USER_POOL_ID = process.env.USER_POOL_ID;

// Authorisation lives in shared/require-admin.js and is applied in the handler
// below, before any route runs. It used to say "Skip authorization for now"
// and never stopped skipping — see that file for what that allowed.
const { requireAdmin } = require('./shared/require-admin');

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

      // A rejected account is DISABLED at the Cognito account level and holds
      // no groups (see changeUserState). Enabled=false outranks whatever the
      // groups say: an account that has been switched off is off, and without
      // this override a rejected user would read as 'pending' (the group-less
      // default) and reappear in the approval queue wearing a Reject button.
      if (user.Enabled === false) {
        userState = 'disabled';
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
    
    /*
      'disabled' IS NOT A GROUP, AND NEVER WAS. This used to fall through to
      AdminAddUserToGroup with GroupName 'disabled' — a group no template has
      ever created (only admins/hosts/pending exist) — so EVERY reject failed
      with Cognito's raw "Group not found". And a group could never keep the
      confirm dialog's promise anyway: membership does not stop a sign-in.
      Cognito's account flag does. So a reject disables the ACCOUNT — which
      works whether or not the person ever verified their email — and moving
      someone back to a real state switches the account on again, or a
      re-approved host would hold the hosts group and still be locked out.
    */
    if (newState === 'disabled') {
      await cognito.send(new AdminDisableUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: username
      }));
      console.log(`Disabled account for ${username}`);
    } else {
      await cognito.send(new AdminEnableUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: username
      }));
      await cognito.send(new AdminAddUserToGroupCommand({
        UserPoolId: USER_POOL_ID,
        Username: username,
        GroupName: newState
      }));
      console.log(`Added ${username} to group ${newState}`);
    }

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, message: `User moved to ${newState}` })
    };

  } catch (error) {
    console.error('Error changing user state:', error);
    // The one failure an admin can actually act on gets its own answer: the
    // account is gone (deleted in another tab, or the list is stale).
    if (error.name === 'UserNotFoundException') {
      return {
        statusCode: 404,
        headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'That account no longer exists. Refresh the list.' })
      };
    }
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: `Could not change that account's state: ${error.message}` })
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

  // ─────────────────────────────────────────────────────────────────────────
  // AUTHORISATION. Not authentication — the authorizer already did that, and
  // that was the whole problem: `CognitoAuthorizer` admits ANY account in the
  // pool, including one still sitting in `pending` waiting to be approved.
  //
  // With no check here, any registered user could
  //     PUT /admin/users/<their-own-username>/state  {"state":"admins"}
  // and promote themselves — `validStates` below includes 'admins' and
  // 'delete', and the requested group is passed straight to
  // AdminAddUserToGroupCommand. They could also enumerate every account in the
  // pool via /admin/users/list.
  //
  // It goes AFTER the OPTIONS preflight (a preflight carries no credentials
  // and must not 403) and BEFORE the route table, so a new route added below
  // cannot forget it.
  // ─────────────────────────────────────────────────────────────────────────
  const denied = requireAdmin(event);
  if (denied) return denied;

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