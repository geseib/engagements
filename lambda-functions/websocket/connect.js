const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, QueryCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { spendHostTicket } = require('./host-tickets');

const dynamoClient = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(dynamoClient);

exports.handler = async (event) => {
  const connectionId = event.requestContext.connectionId;
  const gameId = event.queryStringParameters?.gameId;
  /*
    A PRESENTATION IS A VIEWER (two-surface PLAN 2.1, D4). `/present` connects
    with no name. Every name-less socket used to be stored PlayerName: null, so
    the dedup below retired a second Presentation's peer — the first wall went
    silent while still showing "connected". A viewer is identified by its own
    per-tab `viewerId` instead, and is never HOST and never named: it shows only
    what the room sees. A viewerId that is not a short id falls back to the
    connection id, which dedups against nothing.
  */
  const isViewer = event.queryStringParameters?.viewer === 'present';
  const rawViewerId = String(event.queryStringParameters?.viewerId || '');
  const viewerId = isViewer
    ? (/^[A-Za-z0-9_-]{8,64}$/.test(rawViewerId) ? rawViewerId : connectionId)
    : null;
  const playerName = isViewer ? null : event.queryStringParameters?.playerName;
  const askedForHost = !isViewer && event.queryStringParameters?.isHost === 'true';

  try {
    // `isHost=true` is a REQUEST, never a fact. This route has no authorizer,
    // and every host-only frame — survey progress, names as they join, vote
    // progress — goes to the rows stored HOST, so the query string alone used
    // to hand anyone with the four-digit code the host's private feed. HOST now
    // takes a single-use ticket from POST /games/{gameId}/host-ticket, which
    // only someone allowed to drive this room can mint (host-tickets.js).
    //
    // Anything short of a live ticket for THIS game stores PLAYER: the socket
    // still connects and still gets what the room gets. A table error while
    // spending throws to the catch below and refuses the handshake — the host
    // page reconnects with a fresh ticket, where a silent PLAYER row would have
    // left it deaf. The ticket is never logged.
    const isHost = askedForHost
      && await spendHostTicket(db, process.env.TABLE_NAME, gameId, event.queryStringParameters?.hostTicket);

    console.log(`🔌 WebSocket Connect: ${connectionId}, Game: ${gameId}, Player: ${playerName}, Host: ${isHost}`
      + (askedForHost && !isHost ? ' (asked for host without a live ticket; stored as PLAYER)' : ''));

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
        ...(isViewer ? { Viewer: 'present', ViewerId: viewerId } : {}),
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
          // A viewer dedups by its own tab id; an ordinary player by name, never
          // against a viewer row (both are PLAYER, both may be name-less).
          FilterExpression: isHost
            ? 'ConnectionType = :ct'
            : isViewer
              ? 'ConnectionType = :ct AND ViewerId = :vid'
              : 'ConnectionType = :ct AND PlayerName = :pn AND attribute_not_exists(ViewerId)',
          ExpressionAttributeValues: isHost
            ? { ':pk': `GAME#${gameId}`, ':sk': 'CONNECTION#', ':ct': 'HOST' }
            : isViewer
              ? { ':pk': `GAME#${gameId}`, ':sk': 'CONNECTION#', ':ct': 'PLAYER', ':vid': viewerId }
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
