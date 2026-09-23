/**
 * A SESSION STARTS HERE — whichever button started it.
 *
 * Two routes take a session out of CREATED, and both must leave it in the same
 * condition:
 *
 *   start-game.js     POST /games/{id}/start — history's Start, Quickstart
 *   next-question.js  POST /games/{id}/next-question from CREATED — the phone
 *                     remote's "Start First Round", which opens with the same
 *                     endpoint that advances (config/hostRemote.js)
 *
 * The writes lived in start-game.js alone, so the second door moved a room to
 * ASK#001 with none of them. Three things went missing, and the TTL was only
 * the one somebody went looking for:
 *
 *   - every row kept `created + 90 days` (session-ttl.js);
 *   - METADATA.Started stayed unset, and that flag is session-gate.js's second
 *     gate — every phone was told "Game not started" while a round was live;
 *   - the org's index row said Started: false, so the host's list called a
 *     played session unstarted.
 *
 * ALL FOUR ROWS, as session-ttl.js requires: STATE, the GAMES reservation,
 * METADATA and the org's index row. A session with no owning org has no index
 * row, and still starts — STATE and METADATA are the ones that matter.
 *
 * `orgId` is passed in rather than read here: both callers have already read
 * METADATA's orgId to ask callerMayDriveSession, and a session belongs to the
 * org that created it, never to whoever pressed the button.
 *
 * tests/lobby-start-ttl.js drives both doors and holds this the only writer.
 */
const { UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const { gamesIndexPk, GAMES_RESERVATION_PK } = require('./tenant');
const { startedTtl } = require('./session-ttl');
const { recordSessionStarted } = require('./platform-metrics');

/**
 * Mark a session started on all four of its rows.
 *
 * Sets STATE to STARTED; a caller serving the first round in the same request
 * writes its ASK state over that immediately after.
 *
 * @returns {{ startedAt: string, ttl: number }}
 */
async function startSession(db, tableName, gameId, { orgId = '', now = new Date().toISOString() } = {}) {
  // A started session expires 7 days on (session-ttl.js) — on every one of
  // its rows, including the reservation, or the code stays taken forever.
  const ttl = startedTtl(now);

  await db.send(new UpdateCommand({
    TableName: tableName,
    Key: { PK: `GAME#${gameId}`, SK: 'STATE' },
    UpdateExpression: 'SET #state = :state, #started = :started, #updatedAt = :updatedAt, #startedAt = :startedAt, #ttl = :ttl',
    ExpressionAttributeNames: {
      '#state': 'State',
      '#started': 'Started',
      '#updatedAt': 'UpdatedAt',
      '#startedAt': 'StartedAt',
      '#ttl': 'ttl'
    },
    ExpressionAttributeValues: {
      ':state': 'STARTED',
      ':started': true,
      ':updatedAt': now,
      ':startedAt': now,
      ':ttl': ttl
    }
  }));
  await db.send(new UpdateCommand({
    TableName: tableName,
    Key: { PK: GAMES_RESERVATION_PK, SK: `GAME#${gameId}` },
    UpdateExpression: 'SET #ttl = :ttl',
    ExpressionAttributeNames: { '#ttl': 'ttl' },
    ExpressionAttributeValues: { ':ttl': ttl }
  }));

  // METADATA carries the Started flag the join gate reads, and LastPlayedAt.
  await db.send(new UpdateCommand({
    TableName: tableName,
    Key: { PK: `GAME#${gameId}`, SK: 'METADATA' },
    UpdateExpression: 'SET #started = :started, #lastPlayedAt = :lastPlayedAt, #ttl = :ttl',
    ExpressionAttributeNames: {
      '#started': 'Started',
      '#lastPlayedAt': 'LastPlayedAt',
      '#ttl': 'ttl'
    },
    ExpressionAttributeValues: {
      ':started': true,
      ':lastPlayedAt': now,
      ':ttl': ttl
    }
  }));

  /*
    The SESSION BRIEF — the owning org's index row, not the global reservation.
    The reservation carries `{orgId, ttl}` and nothing a list ever reads, so
    `Started` written there would be written to a row nobody looks at while
    every host's list stayed stale.
  */
  if (orgId) {
    await db.send(new UpdateCommand({
      TableName: tableName,
      Key: { PK: gamesIndexPk(orgId), SK: `GAME#${gameId}` },
      UpdateExpression: 'SET #started = :started, #lastPlayedAt = :lastPlayedAt, #ttl = :ttl',
      ExpressionAttributeNames: {
        '#started': 'Started',
        '#lastPlayedAt': 'LastPlayedAt',
        '#ttl': 'ttl'
      },
      ExpressionAttributeValues: {
        ':started': true,
        ':lastPlayedAt': now,
        ':ttl': ttl
      }
    }));
  } else {
    console.warn(`⚠️ Game ${gameId} has no owning organisation — no session list row to update`);
  }

  await recordSessionStarted({ gameId }, { db, tableName }); // once per session; never throws
  return { startedAt: now, ttl };
}

module.exports = { startSession };
