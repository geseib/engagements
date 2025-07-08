const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');

const dynamoClient = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(dynamoClient);

exports.handler = async (event) => {
  const connectionId = event.requestContext.connectionId;
  const gameId = event.queryStringParameters?.gameId;
  const playerName = event.queryStringParameters?.playerName;
  const isHost = event.queryStringParameters?.isHost === 'true';
  
  console.log(`🔌 WebSocket Connect: ${connectionId}, Game: ${gameId}, Player: ${playerName}, Host: ${isHost}`);
  
  try {
    // Store connection info using proper single table design
    const ttl = Math.floor(Date.now() / 1000) + (2 * 60 * 60); // 2 hours TTL
    await db.send(new PutCommand({
      TableName: process.env.TABLE_NAME,
      Item: {
        PK: `GAME#${gameId || 'LOBBY'}`,
        SK: `CONNECTION#${connectionId}`,
        ConnectionId: connectionId,
        GameId: gameId || null,
        PlayerName: playerName || null,
        IsHost: isHost || false,
        ConnectedAt: new Date().toISOString(),
        ttl
      }
    }));
    
    console.log(`✅ WebSocket connection stored: ${connectionId}`);
    return { statusCode: 200, body: 'Connected' };
  } catch (error) {
    console.error('❌ Connect error:', error);
    return { statusCode: 500, body: 'Failed to connect' };
  }
};
