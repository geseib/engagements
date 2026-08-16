/**
 * Tell the host's browser something happened, and never let that failure be the
 * caller's failure.
 *
 * A FIFTH COPY WOULD HAVE BEEN THE ALTERNATIVE. `join-game.js`,
 * `submit-vote.js`, `websocket/message.js` and `websocket/clean-websocket-utils.js`
 * each carry their own `getHostConnection` + `sendToConnection` pair. The three
 * new handlers in this feature need the same thing, so this is where they get
 * it — the existing four are deliberately left alone, because each is wrapped
 * in per-handler debug logging that tests and log-greps already lean on and a
 * consolidation of live join/vote paths is not what this change is for.
 *
 * TWO PROPERTIES, BOTH LEARNED THE HARD WAY:
 *
 *   it never throws     the host's socket being closed is not a reason for a
 *                       player's request to 500. Every path returns instead.
 *   410 is a cleanup    a dead connection row is deleted inline rather than
 *                       left to accumulate and be re-tried on every broadcast.
 */

const { QueryCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');

/**
 * @returns {{ sent: boolean }} — `sent: false` means there was no host
 *   listening, which is normal (the host page may simply be closed) and is
 *   never an error.
 */
async function notifyHost(db, apigateway, tableName, gameId, message) {
  try {
    const connections = await db.send(new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      FilterExpression: 'ConnectionType = :type',
      ExpressionAttributeValues: {
        ':pk': `GAME#${gameId}`,
        ':sk': 'CONNECTION#',
        ':type': 'HOST'
      }
    }));

    const host = (connections.Items || [])[0];
    if (!host) {
      console.log(`⚠️ No host connection for game ${gameId}; ${message.type} not delivered`);
      return { sent: false };
    }

    try {
      await apigateway.send(new PostToConnectionCommand({
        ConnectionId: host.ConnectionId,
        Data: JSON.stringify(message)
      }));
      console.log(`✅ Host notified: ${message.type} for game ${gameId}`);
      return { sent: true };
    } catch (error) {
      if (error.statusCode === 410 || error.name === 'GoneException' || error.$response?.statusCode === 410) {
        console.log(`🧹 Removing stale host connection ${host.ConnectionId} (410 Gone)`);
        await db.send(new DeleteCommand({
          TableName: tableName,
          Key: { PK: `GAME#${gameId}`, SK: `CONNECTION#${host.ConnectionId}` }
        })).catch(() => {});
        return { sent: false };
      }
      throw error;
    }
  } catch (error) {
    // Deliberately swallowed. See the header: a host who is not listening must
    // not turn a successful write into a 500 for the person who made it.
    console.error(`❌ notifyHost(${message && message.type}) failed for game ${gameId}:`, error);
    return { sent: false };
  }
}

module.exports = { notifyHost };
