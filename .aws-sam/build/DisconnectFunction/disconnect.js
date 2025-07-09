const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, DeleteCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');

const dynamoClient = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(dynamoClient);

exports.handler = async (event) => {
  const connectionId = event.requestContext.connectionId;

  console.log(`🔌 WebSocket Disconnect: ${connectionId}`);

  try {
    // Find and remove connection info - need to scan since we don't know the gameId
    const scanResult = await db.send(new ScanCommand({
      TableName: process.env.TABLE_NAME,
      FilterExpression: 'SK = :sk',
      ExpressionAttributeValues: {
        ':sk': `CONNECTION#${connectionId}`
      }
    }));

    if (scanResult.Items && scanResult.Items.length > 0) {
      const connection = scanResult.Items[0];
      await db.send(new DeleteCommand({
        TableName: process.env.TABLE_NAME,
        Key: {
          PK: connection.PK,
          SK: connection.SK
        }
      }));
      console.log(`✅ WebSocket connection removed: ${connectionId} from ${connection.PK}`);
    } else {
      console.log(`⚠️ Connection ${connectionId} not found in database`);
    }

    return { statusCode: 200, body: 'Disconnected' };
  } catch (error) {
    console.error('❌ Disconnect error:', error);
    return { statusCode: 500, body: 'Failed to disconnect' };
  }
};
