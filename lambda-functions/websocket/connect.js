const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, QueryCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');

const dynamoClient = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(dynamoClient);

exports.handler = async (event) => {
  const connectionId = event.requestContext.connectionId;
  const gameId = event.queryStringParameters?.gameId;
  const playerName = event.queryStringParameters?.playerName;
  const isHost = event.queryStringParameters?.isHost === 'true';
  
  console.log(`🔌 WebSocket Connect: ${connectionId}, Game: ${gameId}, Player: ${playerName}, Host: ${isHost}`);
  
  try {
    // C3: dedup prior connection rows for this identity before inserting the
    // new one. Every reconnect mints a new connectionId; without this, dead
    // rows accumulate and skew the roster / re-poison each broadcast.
    if (gameId) {
      try {
        const existing = await db.send(new QueryCommand({
          TableName: process.env.TABLE_NAME,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
          FilterExpression: isHost
            ? 'ConnectionType = :ct'
            : 'ConnectionType = :ct AND PlayerName = :pn',
          ExpressionAttributeValues: isHost
            ? { ':pk': `GAME#${gameId}`, ':sk': 'CONNECTION#', ':ct': 'HOST' }
            : { ':pk': `GAME#${gameId}`, ':sk': 'CONNECTION#', ':ct': 'PLAYER', ':pn': playerName || null },
        }));
        await Promise.all((existing.Items || [])
          .filter(i => i.ConnectionId !== connectionId)
          .map(i => db.send(new DeleteCommand({
            TableName: process.env.TABLE_NAME,
            Key: { PK: i.PK, SK: i.SK }
          }))));
      } catch (dedupError) {
        console.error('⚠️ Connection dedup failed (continuing):', dedupError);
      }
    }

    // Store connection info using proper single table design
    const ttl = Math.floor(Date.now() / 1000) + (2 * 60 * 60); // 2 hours TTL
    await db.send(new PutCommand({
      TableName: process.env.TABLE_NAME,
      Item: {
        PK: `GAME#${gameId || 'LOBBY'}`,
        SK: `CONNECTION#${connectionId}`,
        ConnectionId: connectionId,
        ConnectionType: isHost ? 'HOST' : 'PLAYER',
        GameId: gameId || null,
        PlayerName: playerName || null,
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
