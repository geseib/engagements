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
    // Claim the row FIRST, then retire the older ones.
    //
    // Ordering is the whole point. This used to delete every existing row for
    // the identity before writing its own, unconditionally — so when two
    // $connect invocations overlapped (a reconnect, a second /host tab, or a
    // duplicate connect() while a handshake was still in flight) the one that
    // executed LAST won, whichever socket the client was actually holding. An
    // older $connect landing late deleted the newer row, and since every
    // broadcast is a Query over CONNECTION# rows, that socket then received
    // nothing while the browser still reported readyState OPEN and a green
    // "Connected" badge. Silent, and it strands the host screen for the rest of
    // the session. Reproduced on dev: of two isHost sockets, the evicted one
    // got neither questionStarted nor votingStarted.
    const connectedAt = new Date().toISOString();
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
        ConnectedAt: connectedAt,
        ttl
      }
    }));

    // C3: dedup prior connection rows for this identity. Every reconnect mints
    // a new connectionId; without this, dead rows accumulate and skew the
    // roster / re-poison each broadcast.
    //
    // STRICTLY OLDER ONLY. A row with no ConnectedAt predates this field and is
    // fair game; a row stamped later than us belongs to a connection that
    // superseded this one, and deleting it is exactly the defect above. Equal
    // stamps (same millisecond) retire nobody — two live rows are harmless,
    // both get every broadcast, whereas one wrong deletion is unrecoverable.
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
          .filter(i => !i.ConnectedAt || i.ConnectedAt < connectedAt)
          .map(i => db.send(new DeleteCommand({
            TableName: process.env.TABLE_NAME,
            Key: { PK: i.PK, SK: i.SK }
          }))));
      } catch (dedupError) {
        console.error('⚠️ Connection dedup failed (continuing):', dedupError);
      }
    }

    console.log(`✅ WebSocket connection stored: ${connectionId}`);
    return { statusCode: 200, body: 'Connected' };
  } catch (error) {
    console.error('❌ Connect error:', error);
    return { statusCode: 500, body: 'Failed to connect' };
  }
};
