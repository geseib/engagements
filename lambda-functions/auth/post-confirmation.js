const { 
  CognitoIdentityProviderClient, 
  AdminGetUserCommand,
  AdminListGroupsForUserCommand,
  AdminAddUserToGroupCommand,
  AdminUpdateUserAttributesCommand
} = require('@aws-sdk/client-cognito-identity-provider');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');

const cognito = new CognitoIdentityProviderClient({ region: 'us-east-1' });
const dynamoClient = new DynamoDBClient({ region: 'us-east-1' });
const dynamodb = DynamoDBDocumentClient.from(dynamoClient);

const TABLE_NAME = process.env.TABLE_NAME;

exports.handler = async (event) => {
  console.log('Post-confirmation event:', JSON.stringify(event, null, 2));

  // Check if user is verified (email/phone verified OR external provider)
  const isEmailVerified = event.request.userAttributes.email_verified === 'true';
  const isPhoneVerified = event.request.userAttributes.phone_number_verified === 'true';
  const isExternalProvider = event.request.userAttributes['cognito:user_status'] === 'EXTERNAL_PROVIDER';
  
  if (!isEmailVerified && !isPhoneVerified && !isExternalProvider) {
    console.log('User not verified and not external provider, skipping');
    return event;
  }
  
  console.log('User verification status:', { isEmailVerified, isPhoneVerified, isExternalProvider });

  try {
    const username = event.userName;
    const userPoolId = event.userPoolId;
    const email = event.request.userAttributes.email;
    const name = event.request.userAttributes.name || email.split('@')[0];
    const userId = event.request.userAttributes.sub;

    console.log(`Processing post-confirmation for user: ${username}, email: ${email}`);

    // Check if user already has pending status (duplicate signup detection)
    try {
      const existingUser = await cognito.send(new AdminGetUserCommand({
        UserPoolId: userPoolId,
        Username: username
      }));
      
      // Check if user already in pending group
      const groupsResponse = await cognito.send(new AdminListGroupsForUserCommand({
        UserPoolId: userPoolId,
        Username: username
      }));
      
      const isInPendingGroup = groupsResponse.Groups.some(group => group.GroupName === 'pending');
      const isInHostsGroup = groupsResponse.Groups.some(group => group.GroupName === 'hosts');
      const isInAdminsGroup = groupsResponse.Groups.some(group => group.GroupName === 'admins');
      
      if (isInPendingGroup || isInHostsGroup || isInAdminsGroup) {
        console.log(`User ${username} already has appropriate group membership, skipping setup`);
        return event;
      }
    } catch (error) {
      console.log('User not found or error checking existing user:', error.message);
    }

    // Add user to pending group
    try {
      await cognito.send(new AdminAddUserToGroupCommand({
        UserPoolId: userPoolId,
        Username: username,
        GroupName: 'pending'
      }));
      console.log(`✅ Added user ${username} to pending group`);
    } catch (error) {
      console.error('❌ Error adding to pending group:', error);
    }

    // Set initial custom attributes (only if not already set)
    try {
      await cognito.send(new AdminUpdateUserAttributesCommand({
        UserPoolId: userPoolId,
        Username: username,
        UserAttributes: [
          {
            Name: 'custom:status',
            Value: 'pending'
          },
          {
            Name: 'custom:role',
            Value: 'host'
          }
        ]
      }));
      console.log(`✅ Set custom attributes for user ${username}`);
    } catch (error) {
      console.error('❌ Error setting custom attributes:', error);
      // Don't throw - this is not critical for registration
    }

    // Store user record in DynamoDB (only if not exists)
    try {
      await dynamodb.send(new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK: `USER#${userId}`,
          SK: 'PROFILE',
          userId,
          username,
          email,
          name,
          status: 'pending',
          role: 'host',
          groups: ['pending'],
          provider: event.request.userAttributes.identities ? 
            JSON.parse(event.request.userAttributes.identities)[0]?.providerName : 
            'cognito',
          createdAt: new Date().toISOString(),
          gameCount: 0,
          lastActivity: new Date().toISOString()
        },
        ConditionExpression: 'attribute_not_exists(PK)' // Only create if doesn't exist
      }));
      console.log(`✅ Created DynamoDB record for user ${username}`);
    } catch (error) {
      if (error.code === 'ConditionalCheckFailedException') {
        console.log(`ℹ️ User record already exists in DynamoDB for ${username}`);
      } else {
        console.error('❌ Error creating DynamoDB record:', error);
        throw error;
      }
    }

    // Log the registration (always log, even for duplicates)
    try {
      await dynamodb.send(new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK: 'AUDIT#USER',
          SK: `ACTION#${Date.now()}`,
          action: 'USER_REGISTERED',
          userId,
          email,
          name,
          provider: event.request.userAttributes.identities ? 
            JSON.parse(event.request.userAttributes.identities)[0]?.providerName : 
            'cognito',
          timestamp: new Date().toISOString(),
          ttl: Math.floor(Date.now() / 1000) + (90 * 24 * 60 * 60) // 90 days
        }
      }));
      console.log(`✅ Logged registration event for user ${username}`);
    } catch (error) {
      console.error('❌ Error logging registration:', error);
      // Don't throw - logging failure shouldn't block user registration
    }

    // TODO: Send notification to admins about new user registration

    console.log(`✅ Post-confirmation completed successfully for user ${username}`);
  } catch (error) {
    console.error('❌ Error in post-confirmation:', error);
    // Don't throw error to prevent user registration from failing
    // Users can still sign in even if post-confirmation partially fails
  }

  return event;
};