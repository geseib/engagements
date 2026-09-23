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
 * Sets STATE to `state` — STARTED unless the caller says otherwise; a caller
 * serving the first round in the same request writes its ASK state over that
 * immediately after. A SURVEY opens straight into SURVEY#OPEN (start-game.js):
 * STARTED would hand it the lobby's behaviour — the host page's set
 * auto-select, the remote's "Start First Round", next-question's advance.
 *
 * METADATA.OpenedAt is written here, `if_not_exists`, for every session type:
 * the moment the room first opened, equal to StartedAt. It is what a survey's
 * Names lock reads (update-game.js refuses a Names edit once it exists) and
 * what a shared link's clock will count from.
 *
 * METADATA IS WRITTEN FIRST, BEFORE STATE FLIPS. update-game.js lets a Names
 * edit through when it reads STATE as CREATED, and its write is conditioned on
 * `attribute_not_exists(OpenedAt)`. Flip STATE first and there is a gap — STATE
 * already SURVEY#OPEN or about to be, OpenedAt not yet written — in which an
 * edit that read CREATED changes what the phones promise about names after
 * the survey has opened. With OpenedAt down first, the lock is shut before the
 * room can open. (If STATE's write then fails, the session sits CREATED with
 * OpenedAt and Started set; Start again finishes the job and `if_not_exists`
 * keeps the first OpenedAt.)
 *
 * @returns {{ startedAt: string, ttl: number }}
 */
async function startSession(db, tableName, gameId, { orgId = '', now = new Date().toISOString(), state = 'STARTED' } = {}) {
  // A started session expires 7 days on (session-ttl.js) — on every one of
  // its rows, including the reservation, or the code stays taken forever.
  const ttl = startedTtl(now);

  // METADATA FIRST (see the header): the Started flag the join gate reads,
  // LastPlayedAt, and OpenedAt — the first opening only, however many doors
  // race — so the Names lock is shut before STATE opens the room.
  await db.send(new UpdateCommand({
    TableName: tableName,
    Key: { PK: `GAME#${gameId}`, SK: 'METADATA' },
    UpdateExpression: 'SET #started = :started, #lastPlayedAt = :lastPlayedAt, #ttl = :ttl, #openedAt = if_not_exists(#openedAt, :openedAt)',
    ExpressionAttributeNames: {
      '#started': 'Started',
      '#lastPlayedAt': 'LastPlayedAt',
      '#ttl': 'ttl',
      '#openedAt': 'OpenedAt'
    },
    ExpressionAttributeValues: {
      ':started': true,
      ':lastPlayedAt': now,
      ':ttl': ttl,
      ':openedAt': now
    }
  }));

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
      ':state': state,
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
