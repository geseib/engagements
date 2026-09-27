/**
 * AN AGENDA ITEM'S SESSION (events M3) — how an engagement on the agenda
 * becomes an ordinary one-set, one-type session when the host starts it, how
 * a start that lost a race gives that session back, and how the room inside
 * it is told what the event is doing.
 *
 * ── THE SESSION IS TODAY'S SESSION ────────────────────────────────────────
 * The item's session is made by the session manager's own createGame, behind
 * the same code lock (code-reservation.reserveCode), and opened by the same
 * startSession every other door uses (session-start.js, copied here from
 * game/). It plays the item's PINNED set version and carries the item's
 * session options (agenda-rules.sessionFormOf, checked at save by
 * item-settings.js), translated here as create-game.js translates the create
 * dialog's payload. Two things differ, both on purpose:
 *   - METADATA carries `EventRef` (the event's code) and `EventItem`, which is
 *     how join-game.js knows to take an attendee's token instead of a typed
 *     name, and how session-count.js bills the event once (decision 1);
 *   - the create gate is not asked. The event was gated once, when it was
 *     made (create-event.js: Team plan only), and an item is part of it.
 *
 * An item whose words could not be decrypted is refused before this file is
 * reached (run.js): its blanked settings look exactly like an item that never
 * had any (agenda-rules.sessionFormOf says so).
 *
 * ── A START THAT LOSES GIVES ITS SESSION BACK ─────────────────────────────
 * The session is made first, because the item's row must name it; the item
 * and the event are then moved in one transaction. When that transaction
 * loses (another screen started something at the same moment), the session
 * nobody will ever play is removed, every row of it, and its code released:
 * "no child session is orphaned" (roadmap §6, review focus 2).
 */
const {
  GetCommand, QueryCommand, DeleteCommand, UpdateCommand, BatchWriteCommand,
} = require('@aws-sdk/lib-dynamodb');
const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');
const { createGame } = require('../schema-compliant-manager');
const { reserveCode, releaseCode } = require('../code-reservation');
const { startSession } = require('../session-start');
const { gamesIndexPk } = require('../tenant');
const { recordSessionCreated } = require('../platform-metrics');
const rules = require('./agenda-rules');

/** The two kinds whose votes can hide who wrote what (create dialog's rule). */
// Call-and-answer only since typed polls (27 Sep 2026): a poll has no vote,
// and its wall shows counts, never authors (game/anonymity.js).
const ANONYMITY_TYPES = Object.freeze(['call-and-answer']);
const SURVEY_OPEN = 'SURVEY#OPEN';

const gamePk = (gameId) => `GAME#${gameId}`;

/**
 * The session manager's `gameData` for an item — create-game.js's translation
 * of the create dialog's payload, applied to the item's own form
 * (agenda-rules.sessionFormOf). Null for an item that cannot be played.
 */
function childGameData(item, { orgId, code, itemId }) {
  const form = rules.sessionFormOf(item);
  if (!form || !rules.isEngagement(form.gameType)) return null;
  const isSurvey = form.gameType === 'survey';
  const hidesAuthors = ANONYMITY_TYPES.includes(form.gameType);
  const data = {
    title: form.title || 'Engagement Session',
    engagementType: form.gameType,
    questionSetId: form.setId || undefined,
    questionSetScope: form.setScope || 'platform',
    ...(form.setVersion !== null && form.setVersion !== undefined ? { questionSetVersion: form.setVersion } : {}),
    orgId,
    selectedCategories: Array.isArray(form.categoryIds) ? form.categoryIds.slice() : [],
    hostPreferences: {
      randomizeQuestions: isSurvey ? false : form.randomizeQuestions !== false,
      anonymousUntilReveal: hidesAuthors ? form.anonymousResponses !== false : false,
    },
    aiContext: form.aiContext || '',
    personaId: String(form.personaId || '').trim(),
    promptId: String(form.promptId || '').trim(),
    details: form.eventDetails || '',
    hostName: 'Host',
    visibility: 'public',
    accessCode: null,
    eventRef: code,
    eventItem: itemId,
  };
  if (isSurvey) data.names = form.names;
  if (form.gameType === 'call-and-answer' && form.briefing) data.briefing = form.briefing;
  if (!isSurvey && form.target !== null && form.target !== undefined) data.target = form.target;
  return data;
}

/** The state a started item's session opens in: a survey collects at once. */
const openingState = (type) => (type === 'survey' ? SURVEY_OPEN : 'STARTED');

/**
 * Make the item's session and open it. Returns its code. Throws on anything
 * but a lost code draw, which reserveCode retries; a failure after the create
 * removes what was made, so nothing is left holding a code.
 */
async function createChildSession(db, tableName, {
  item, orgId, code, itemId, now = new Date().toISOString(), open = true,
}) {
  const data = childGameData(item, { orgId, code, itemId });
  if (!data) throw new Error(`child-session: item ${itemId} of EVENT#${code} is not a playable engagement`);
  const gameId = await reserveCode(db, {
    kind: 'session', orgId, tableName, claim: (candidate) => createGame(candidate, data),
  });
  // A PREVIEW (`open: false`, run.js `prepare`) stops here: the session
  // exists, so the host's stage can show its lobby and its questions, but it
  // is CREATED — session-gate.js refuses every join ("Game not started") until
  // the host takes the item live, which opens it (openChildSession).
  if (open) {
    try {
      await startSession(db, tableName, gameId, { orgId, now, state: openingState(data.engagementType) });
    } catch (error) {
      await discardChildSession(db, tableName, gameId, orgId);
      throw error;
    }
  }
  await recordSessionCreated({ gameId }); // platform metrics; never throws
  return gameId;
}

/**
 * Open a previewed session when its item goes live: CREATED → STARTED (a
 * survey: collecting), through the same startSession every door uses. A
 * session already past CREATED is left as it is. Returns its state after.
 */
async function openChildSession(db, tableName, { gameId, orgId, type, now = new Date().toISOString() }) {
  const res = await db.send(new GetCommand({
    TableName: tableName, Key: { PK: gamePk(gameId), SK: 'STATE' }, ConsistentRead: true,
  }));
  const state = res && res.Item && res.Item.State;
  if (state !== 'CREATED') return state || null;
  const opening = openingState(type);
  await startSession(db, tableName, gameId, { orgId, now, state: opening });
  return opening;
}

/**
 * Every row of a session nobody will play: its partition, its org's list row
 * and its code. Paged and batched; never throws — a failure is logged, and
 * the rows it leaves expire on their own ttl.
 */
async function discardChildSession(db, tableName, gameId, orgId) {
  try {
    let ExclusiveStartKey;
    const keys = [];
    do {
      const page = await db.send(new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': gamePk(gameId) },
        ProjectionExpression: 'PK, SK',
        ...(ExclusiveStartKey ? { ExclusiveStartKey } : {}),
      }));
      for (const row of (page && page.Items) || []) keys.push({ PK: row.PK, SK: row.SK });
      ExclusiveStartKey = page && page.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    for (let i = 0; i < keys.length; i += 25) {
      let pending = keys.slice(i, i + 25).map((Key) => ({ DeleteRequest: { Key } }));
      for (let attempt = 0; pending.length && attempt < 5; attempt += 1) {
        const res = await db.send(new BatchWriteCommand({ RequestItems: { [tableName]: pending } }));
        pending = ((res && res.UnprocessedItems) || {})[tableName] || [];
      }
    }
    if (orgId) {
      await db.send(new DeleteCommand({ TableName: tableName, Key: { PK: gamesIndexPk(orgId), SK: `GAME#${gameId}` } }));
    }
    await releaseCode(db, { code: gameId, tableName });
    console.log(`↩️ child-session: discarded ${gameId} (${keys.length} row(s)); its code is free`);
  } catch (error) {
    console.error(`❌ child-session: could not discard ${gameId}:`, error && error.message);
  }
}

/**
 * THE PAUSE FLAG on the session's STATE (roadmap D1). While it is set, an
 * answer, a vote, a survey answer and a comment are refused (message.js,
 * submit-vote.js, survey-answers.js, comments.js). The round's own State is
 * never touched, so a resume returns to exactly the phase it left. An Update,
 * never a Put: STATE is only ever updated after create
 * (tests/state-row-never-replaced.js).
 */
async function setPaused(db, tableName, gameId, paused) {
  try {
    await db.send(new UpdateCommand({
      TableName: tableName,
      Key: { PK: gamePk(gameId), SK: 'STATE' },
      UpdateExpression: paused ? 'SET #p = :on' : 'REMOVE #p',
      ConditionExpression: 'attribute_exists(PK)',
      ExpressionAttributeNames: { '#p': 'EventPaused' },
      ...(paused ? { ExpressionAttributeValues: { ':on': true } } : {}),
    }));
    return true;
  } catch (error) {
    console.error(`❌ child-session: could not ${paused ? 'pause' : 'resume'} ${gameId}:`, error && error.message);
    return false;
  }
}

let apigateway = null;
function gateway() {
  if (!apigateway) apigateway = new ApiGatewayManagementApiClient({ endpoint: process.env.WEBSOCKET_API_ENDPOINT });
  return apigateway;
}

/**
 * Tell every socket in a session — host and phones — what the event did.
 * Paged, and it NEVER THROWS: the event's own rows are already written when
 * this runs, and a phone that misses a frame still learns from the agenda it
 * polls. A gone socket (410) is reaped as the other broadcasters do.
 */
async function toSession(db, tableName, gameId, message) {
  if (!gameId) return 0;
  let sentTo = 0;
  try {
    let ExclusiveStartKey;
    do {
      const page = await db.send(new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: { ':pk': gamePk(gameId), ':sk': 'CONNECTION#' },
        ...(ExclusiveStartKey ? { ExclusiveStartKey } : {}),
      }));
      await Promise.all(((page && page.Items) || []).map(async (conn) => {
        try {
          await gateway().send(new PostToConnectionCommand({
            ConnectionId: conn.ConnectionId,
            Data: JSON.stringify(message),
          }));
          sentTo += 1;
        } catch (error) {
          const status = (error && (error.statusCode || (error.$metadata && error.$metadata.httpStatusCode))) || 0;
          if (status === 410) {
            try {
              await db.send(new DeleteCommand({ TableName: tableName, Key: { PK: conn.PK, SK: conn.SK } }));
            } catch (_) { /* reaped next time */ }
          }
        }
      }));
      ExclusiveStartKey = page && page.LastEvaluatedKey;
    } while (ExclusiveStartKey);
  } catch (error) {
    console.error(`❌ child-session: could not tell ${gameId} "${message && message.type}":`, error && error.message);
  }
  return sentTo;
}

module.exports = {
  ANONYMITY_TYPES, SURVEY_OPEN,
  childGameData, openingState, createChildSession, openChildSession, discardChildSession, setPaused, toSession,
};
