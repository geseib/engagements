/**
 * HOW MANY ARE IN THE ROOM, AND HOW MANY HAVE ACTED — counts only
 * (docs/design/two-surface/PLAN.md 1.11, D3).
 *
 * The Presentation reads the public `/state?view=room` and shows "4 of 5
 * answered". The host's door already counts the same thing, but it carries
 * WHO (answererIds, votersIds) and lives behind Cognito. This module answers
 * the room's question and returns integers, never a name: the player rows it
 * reads to deduplicate stay inside this function.
 *
 * Query only, never Scan, and every Query follows LastEvaluatedKey: a
 * one-call Query past 1 MB silently returns a prefix, and a room count that
 * stopped at the first page would tell a full room it was waiting.
 * tests/present-public-reads.js reads these through a paged fake.
 *
 * Who counts as in the room is the rule the host's door uses: a player row
 * with a name, deduplicated by name keeping the most recent join, minus anyone
 * the host removed (player-presence.js).
 */
const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { isPresent } = require('./player-presence');

/** Every row under one prefix of a game's partition, page after page. */
async function queryAll(db, tableName, gameId, prefix, extra = {}) {
  const items = [];
  let count = 0;
  let startKey;
  do {
    const res = await db.send(new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': `GAME#${gameId}`, ':sk': prefix },
      ...extra,
      ...(startKey ? { ExclusiveStartKey: startKey } : {}),
    }));
    items.push(...((res && res.Items) || []));
    count += Number(res && res.Count) || 0;
    startKey = res && res.LastEvaluatedKey;
  } while (startKey);
  return { items, count };
}

/** The players in the room now: named, deduplicated by name (latest join), not removed. */
async function presentPlayers(db, tableName, gameId) {
  const { items } = await queryAll(db, tableName, gameId, 'PLAYER#');
  const byName = new Map();
  for (const player of items) {
    const name = player.PlayerName || player.playerName;
    if (!name) continue;
    const existing = byName.get(name);
    if (!existing || (player.JoinedAt && (!existing.JoinedAt || player.JoinedAt > existing.JoinedAt))) {
      byName.set(name, player);
    }
  }
  return Array.from(byName.values()).filter(isPresent);
}

/** How many rows sit under a prefix, without bringing their contents back. */
async function countOf(db, tableName, gameId, prefix) {
  const { count } = await queryAll(db, tableName, gameId, prefix, { Select: 'COUNT' });
  return count;
}

/**
 * `{ joined, answered, voted }` for the round on screen (`round` padded,
 * '003'), or answered/voted 0 when no round is on. Integers only.
 */
async function roomCounts(db, tableName, gameId, round) {
  const [players, answered, voted] = await Promise.all([
    presentPlayers(db, tableName, gameId),
    round ? countOf(db, tableName, gameId, `QUESTION#${round}#ANSWER#`) : 0,
    round ? countOf(db, tableName, gameId, `QUESTION#${round}#VOTE#`) : 0,
  ]);
  return { joined: players.length, answered, voted };
}

/**
 * How many Presentations are open on this game (two-surface D4): connection
 * rows marked `Viewer: 'present'` by websocket/connect.js. A closed tab's row
 * goes on $disconnect; a missed one on its 2-hour ttl.
 */
async function presentingCount(db, tableName, gameId) {
  const { count } = await queryAll(db, tableName, gameId, 'CONNECTION#', {
    Select: 'COUNT',
    FilterExpression: 'Viewer = :viewer',
    ExpressionAttributeValues: { ':pk': `GAME#${gameId}`, ':sk': 'CONNECTION#', ':viewer': 'present' },
  });
  return count;
}

/**
 * The room's window as the host console reports it (host console spec §4.2):
 * the most recently reporting Present viewer's Fullscreen/Visible/StatusAt.
 */
async function presentingDetail(db, tableName, gameId) {
  const { items } = await queryAll(db, tableName, gameId, 'CONNECTION#', {
    FilterExpression: 'Viewer = :viewer',
    ExpressionAttributeValues: { ':pk': `GAME#${gameId}`, ':sk': 'CONNECTION#', ':viewer': 'present' },
  });
  if (!items.length) return { open: false, fullscreen: null, visible: null, statusAt: null };
  const stamp = (i) => String(i.StatusAt || i.ConnectedAt || '');
  const latest = items.slice().sort((a, b) => stamp(b).localeCompare(stamp(a)))[0];
  return {
    open: true,
    fullscreen: typeof latest.Fullscreen === 'boolean' ? latest.Fullscreen : null,
    visible: typeof latest.Visible === 'boolean' ? latest.Visible : null,
    statusAt: latest.StatusAt || null,
  };
}

module.exports = { roomCounts, presentPlayers, presentingCount, presentingDetail, queryAll };
