/**
 * TELLING THE SCREENS A SURVEY MOVED — the host's, or everyone's.
 *
 *   toHosts   every HOST connection row (`ConnectionType = 'HOST'`), ALL of
 *             them: connect.js leaves same-millisecond host peers in place, and
 *             the screen the host is looking at may be any one of them
 *             (submit-vote.js getHostConnections records the frozen meter that
 *             `Items[0]` produced). Not host-notify.js, which sends to one; not
 *             the manager's `IsHost` filter, which no writer sets.
 *   toAll     every connection on the session — the phones and the stage.
 *
 * `surveyProgress` goes to hosts only and carries counts only; the phones need
 * nothing from another person's answer. The rest (`surveyClosingSoon`,
 * `surveyClosed`, `gameEnded`) go to everyone.
 *
 * NEVER THROWS. By the time anything is broadcast the row is written; failing
 * the request now would tell a phone its answer was lost when it was not. A
 * 410 Gone is a dead socket and its row is reaped inline, as every broadcaster
 * in this repo does. Connection rows are read page by page — a big room is a
 * big partition prefix.
 */
const { QueryCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');

async function connections(db, tableName, gameId, hostsOnly) {
  const out = [];
  let ExclusiveStartKey;
  do {
    const page = await db.send(new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ...(hostsOnly ? { FilterExpression: 'ConnectionType = :type' } : {}),
      ExpressionAttributeValues: {
        ':pk': `GAME#${gameId}`,
        ':sk': 'CONNECTION#',
        ...(hostsOnly ? { ':type': 'HOST' } : {}),
      },
      ExclusiveStartKey,
    }));
    out.push(...((page && page.Items) || []));
    ExclusiveStartKey = page && page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return out;
}

async function send(db, tableName, gameId, message, hostsOnly) {
  try {
    const targets = await connections(db, tableName, gameId, hostsOnly);
    if (!targets.length) return 0;
    const api = new ApiGatewayManagementApiClient({ endpoint: process.env.WEBSOCKET_API_ENDPOINT });
    const data = JSON.stringify(message);
    let delivered = 0;
    await Promise.all(targets.map(async (conn) => {
      try {
        await api.send(new PostToConnectionCommand({ ConnectionId: conn.ConnectionId, Data: data }));
        delivered += 1;
      } catch (err) {
        const status = err.statusCode || err.$metadata?.httpStatusCode || err.$response?.statusCode;
        if (status === 410 || err.name === 'GoneException') {
          await db.send(new DeleteCommand({ TableName: tableName, Key: { PK: conn.PK, SK: conn.SK } })).catch(() => {});
        } else {
          console.error(`❌ SURVEY: ${message.type} to ${conn.ConnectionId} failed:`, err.message);
        }
      }
    }));
    return delivered;
  } catch (err) {
    console.error(`❌ SURVEY: ${message && message.type} broadcast failed entirely (continuing):`, err);
    return 0;
  }
}

const toHosts = (db, tableName, gameId, message) => send(db, tableName, gameId, message, true);
const toAll = (db, tableName, gameId, message) => send(db, tableName, gameId, message, false);

module.exports = { toHosts, toAll };
