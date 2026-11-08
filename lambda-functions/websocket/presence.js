/**
 * "AWAY" AS IT HAPPENS (dev QA 5 Nov 2026).
 *
 * A player's tab closed and the host's room tile kept "Waiting on Ben, Cy"
 * until the console was reloaded. The roster's `deviceConnected` (get-players.js)
 * was already right the moment the socket went: connection rows are deleted
 * by disconnect.js and written by connect.js. Nothing told the host to read it
 * again. Joins, removals and name moves each push a frame; a page opening or
 * closing pushed none.
 *
 * So $connect and $disconnect of a NAMED player socket tell every host device
 * `presenceChanged` { playerName, connected }. The host applies it to that
 * person's row at once and reads the roster again, which stays the authority.
 *
 *   - Only named PLAYER sockets. The host's own sockets, the room's window
 *     (`Viewer`, name-less) and lobby sockets with no game never count as a
 *     person's presence, the same rule get-players.js applies.
 *   - `connected` on a disconnect is whether ANOTHER page is still open under
 *     the name (a second tab, a reconnect that landed first), never a blind
 *     false: a person with one of two tabs closed is not away.
 *   - Never throws. A host who is not listening, or a failed read, must not
 *     turn a socket's $connect or $disconnect into a 500 (host-notify.js).
 *
 * tests/presence-frames.js.
 */
const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { notifyHost } = require('./host-notify');

let client = null;
function apigateway() {
  if (client) return client;
  // Required lazily: the handlers stay loadable where the SDK is stubbed.
  const { ApiGatewayManagementApiClient } = require('@aws-sdk/client-apigatewaymanagementapi');
  client = new ApiGatewayManagementApiClient({ endpoint: process.env.WEBSOCKET_API_ENDPOINT });
  return client;
}

/** A connection row that stands for a person being here. */
function isPresenceRow(row) {
  return Boolean(row && row.ConnectionType === 'PLAYER' && row.PlayerName && !row.Viewer && !row.ViewerId
    && row.GameId && String(row.PK || '') === `GAME#${row.GameId}`);
}

/** Is any other page open under this name in this game? A failed read says yes (no false "away"). */
async function stillHere(db, tableName, gameId, playerName, exceptConnectionId) {
  try {
    let ExclusiveStartKey;
    do {
      const page = await db.send(new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        FilterExpression: 'ConnectionType = :type AND PlayerName = :pn',
        ExpressionAttributeValues: {
          ':pk': `GAME#${gameId}`, ':sk': 'CONNECTION#', ':type': 'PLAYER', ':pn': playerName,
        },
        ExclusiveStartKey,
      }));
      if (((page && page.Items) || []).some((r) => r.ConnectionId !== exceptConnectionId && !r.Viewer)) return true;
      ExclusiveStartKey = page && page.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return false;
  } catch (error) {
    console.error('⚠️ presence: could not read the other connections (saying still here):', error);
    return true;
  }
}

/**
 * Tell the host a person's page opened or closed.
 * @param {'connect'|'disconnect'} change
 * @param row the CONNECTION# row that was written or deleted
 * @param deps { db, tableName, api? } — `api` for tests
 */
async function announcePresence(change, row, { db, tableName, api = null } = {}) {
  try {
    if (!isPresenceRow(row)) return { sent: false };
    const gameId = row.GameId;
    const playerName = row.PlayerName;
    const connected = change === 'connect'
      ? true
      : await stillHere(db, tableName, gameId, playerName, row.ConnectionId);
    return await notifyHost(db, api || apigateway(), tableName, gameId, {
      type: 'presenceChanged', gameId, playerName, connected, timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('⚠️ presence: announce failed (ignored):', error);
    return { sent: false };
  }
}

module.exports = { announcePresence, isPresenceRow };
