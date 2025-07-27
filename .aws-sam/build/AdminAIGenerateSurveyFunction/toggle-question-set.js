const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const dynamoClient = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(dynamoClient);

exports.handler = async (event) => {
  try {
    const setId = event.pathParameters?.setId;
    const { active } = JSON.parse(event.body || '{}');
    
    console.log(`Toggling question set ${setId} to active: ${active}`);
    
    if (!setId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Set ID is required' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }
    
    if (typeof active !== 'boolean') {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Active status must be a boolean' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }
    
    // Update the question set active status
    await db.send(new UpdateCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: 'SETS', SK: `SET#${setId}` },
      UpdateExpression: 'SET active = :active, updatedAt = :updatedAt',
      ExpressionAttributeValues: {
        ':active': active,
        ':updatedAt': new Date().toISOString()
      }
    }));
    
    console.log(`✅ Successfully toggled question set ${setId} to active: ${active}`);
    
    return {
      statusCode: 200,
      body: JSON.stringify({ 
        message: `Question set ${active ? 'activated' : 'deactivated'} successfully`,
        setId: setId,
        active: active
      }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
    
  } catch (error) {
    console.error('Toggle question set error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `Failed to toggle question set: ${error.message}` }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }
};