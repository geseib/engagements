const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, DeleteCommand } = require('@aws-sdk/lib-dynamodb');

const dynamoClient = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(dynamoClient);

exports.handler = async (event) => {
  const connectionId = event.requestContext.connectionId;
  
  console.log(`🔌 WebSocket Disconnect: ${connectionId}`);
  
  try {
    // Remove connection info
    await db.send(new DeleteCommand({
      TableName: process.env.TABLE_NAME,
      Key: {
        PK: `CONNECTION#${connectionId}`,
        SK: 'METADATA'
      }
    }));
    
    console.log(`✅ WebSocket connection removed: ${connectionId}`);
    return { statusCode: 200, body: 'Disconnected' };
  } catch (error) {
    console.error('❌ Disconnect error:', error);
    return { statusCode: 500, body: 'Failed to disconnect' };
  }
};
