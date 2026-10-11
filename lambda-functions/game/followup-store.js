/**
 * THE FOLLOW-UP ROWS: read, write, close (docs/design/ca-followup-asks SPEC §5).
 *
 * The keys are followup-keys.js, the kinds followup-kinds.js; this file is the
 * table. Every function takes the DocumentClient it should use, so the
 * worker (get-ai-summary.js), the routes (followups.js) and next-question.js
 * share one implementation without sharing a client.
 *
 * SEALED under the session's org, as comments and Build Room rows are
 * (ENCRYPTED_FIELDS.followup); an orgless session stays plaintext, as every
 * row of it does.
 *
 * TTL, the session's content rules (session-ttl.js):
 *   SUGGESTED  30 days, as the read it was made from (QUESTION#nnn#AISummary)
 *   ASK        ROUND_RECORD_DAYS (30) from when it was sent, as ROUND# rows
 *   answer      7 days (STARTED_DAYS), as answer and vote rows
 *   LIVE        7 days; deleted when the ask closes
 * The frozen `Tally` on the ask row is what the Stage, the report and the PDF
 * read, so a report built after day 7 still has its numbers.
 *
 * BILLING IS NEVER TOUCHED: nothing here requires session-count.js, and the
 * answers arrive over HTTP, never through websocket/message.js — a follow-up
 * is never a session's second answered question (owner, 2026-10-11).
 */
const {
  GetCommand, PutCommand, QueryCommand, UpdateCommand, DeleteCommand, TransactWriteCommand,
} = require('@aws-sdk/lib-dynamodb');
const { encryptItem, decryptItem, decryptItems } = require('./tenant-crypto');
const { ttlFrom, ROUND_RECORD_DAYS, STARTED_DAYS } = require('./session-ttl');
const { pollTally } = require('./poll-round');
const keys = require('./followup-keys');
const { toSurveyQuestion, tallyOf } = require('./followup-kinds');

const SUGGESTED_DAYS = 30;
const LIVE_DAYS = STARTED_DAYS;

const table = () => process.env.TABLE_NAME;
const pkOf = (gameId) => `GAME#${gameId}`;
const seal = async (orgId, item) => (orgId ? encryptItem(orgId, 'followup', item) : item);
const open = async (orgId, item) => (orgId && item ? decryptItem(orgId, 'followup', item) : item);
const openAll = async (orgId, items) => (orgId ? decryptItems(orgId, 'followup', items) : items);

/** Is the feature on for this function? Exactly 'on'; anything else, absent included, is off. */
const followUpsEnabled = (env = process.env) => String(env.FOLLOWUP_ASKS_ENABLED || '').trim().toLowerCase() === 'on';

/** Every row under a prefix, every page (a one-call Query past 1 MB truncates silently). */
async function queryAll(db, gameId, prefix) {
  const out = [];
  let ExclusiveStartKey;
  do {
    const res = await db.send(new QueryCommand({
      TableName: table(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': pkOf(gameId), ':sk': prefix },
      ...(ExclusiveStartKey ? { ExclusiveStartKey } : {}),
    }));
    out.push(...((res && res.Items) || []));
    ExclusiveStartKey = res && res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return out;
}

/**
 * Did a write fail on its CONDITION (the answer the caller should hear), as
 * opposed to anything else? A cancelled transaction says why per item; only a
 * ConditionalCheckFailed among them is a refusal. A TransactionConflict —
 * forty phones answering one ask at once all check the same ask row — is not
 * a refusal and is retried (transact below).
 */
function isConditionFailure(e) {
  if (!e) return false;
  if (e.name === 'ConditionalCheckFailedException') return true;
  if (e.name !== 'TransactionCanceledException') return false;
  const reasons = Array.isArray(e.CancellationReasons) ? e.CancellationReasons : [];
  return reasons.some((r) => r && r.Code === 'ConditionalCheckFailed');
}
const isConflict = (e) => Boolean(e && e.name === 'TransactionCanceledException' && !isConditionFailure(e));

/** A transaction, retried on conflict (never on a failed condition). */
async function transact(db, input, { attempts = 4, pauseMs = 40 } = {}) {
  for (let i = 1; ; i++) {
    try {
      return await db.send(new TransactWriteCommand(input));
    } catch (e) {
      if (!isConflict(e) || i >= attempts) throw e;
      await new Promise((r) => setTimeout(r, pauseMs * i + Math.floor(Math.random() * pauseMs)));
    }
  }
}

// ──────────────────────────────────────────────────────── suggestions ──

/**
 * Store the checked suggestions for a round's read, replacing any earlier set
 * (a Redo of the read makes them again). Written even when none survived or
 * the call failed, so the measurement can tell "the model suggested nothing
 * sendable" from "the call never happened".
 */
async function writeSuggestions(db, { gameId, round, orgId, forSummaryAt, result, now = new Date().toISOString() }) {
  const sk = keys.suggestedSk(round);
  if (!sk) throw new Error('followup-store: bad round');
  const r = result || {};
  const marks = {};
  for (const a of r.asks || []) for (const m of a.marks || []) marks[m] = (marks[m] || 0) + 1;
  const item = {
    PK: pkOf(gameId),
    SK: sk,
    GameId: gameId,
    QuestionNumber: keys.roundOf(round),
    Asks: r.asks || [],
    ForSummaryAt: forSummaryAt || null,
    Model: r.model || null,
    ServedBy: r.servedBy || null,
    PromptVersion: r.promptVersion || null,
    Reason: r.reason || null,
    Raw: Number(r.raw) || 0,
    Kept: (r.asks || []).length,
    Dropped: Number(r.dropped) || 0,
    DropReasons: r.reasons || {},
    Marks: marks,
    LatencyMs: Number(r.ms) || 0,
    CreatedAt: now,
    ttl: ttlFrom(now, SUGGESTED_DAYS),
  };
  await db.send(new PutCommand({ TableName: table(), Item: await seal(orgId, item) }));
  return item;
}

async function deleteSuggestions(db, { gameId, round }) {
  const sk = keys.suggestedSk(round);
  if (!sk) return;
  await db.send(new DeleteCommand({ TableName: table(), Key: { PK: pkOf(gameId), SK: sk } }));
}

async function readSuggestions(db, { gameId, round, orgId }) {
  const sk = keys.suggestedSk(round);
  if (!sk) return null;
  const res = await db.send(new GetCommand({ TableName: table(), Key: { PK: pkOf(gameId), SK: sk } }));
  return res && res.Item ? open(orgId, res.Item) : null;
}

/** The suggestions of every round of the session, oldest round first (the measurement read). */
async function readAllSuggestions(db, { gameId, orgId }) {
  const rows = (await queryAll(db, gameId, keys.ROOT))
    .filter((r) => (keys.parseFollowUpSk(r.SK) || {}).kind === 'suggested');
  const opened = await openAll(orgId, rows);
  return opened.sort((a, b) => String(a.SK).localeCompare(String(b.SK)));
}

/** A stored suggestion row as the host sees it. */
function suggestionsWire(row) {
  if (!row) return null;
  return {
    round: row.QuestionNumber,
    asks: Array.isArray(row.Asks) ? row.Asks : [],
    forSummaryAt: row.ForSummaryAt || null,
    model: row.Model || null,
    servedBy: row.ServedBy || null,
    promptVersion: row.PromptVersion || null,
    reason: row.Reason || null,
    raw: row.Raw || 0,
    kept: row.Kept || 0,
    dropped: row.Dropped || 0,
    dropReasons: row.DropReasons || {},
    marks: row.Marks || {},
    latencyMs: row.LatencyMs || 0,
    createdAt: row.CreatedAt || null,
  };
}

// ─────────────────────────────────────────────────────────────── asks ──

/** The round's asks (opened) and, for each, its answer rows (still sealed). */
async function readRound(db, { gameId, round, orgId }) {
  const prefix = keys.asksPrefix(round);
  if (!prefix) return [];
  const rows = await queryAll(db, gameId, prefix);
  const asks = [];
  const answers = new Map();
  for (const row of rows) {
    const k = keys.parseFollowUpSk(row.SK);
    if (!k) continue;
    if (k.kind === 'ask') asks.push(row);
    else if (k.kind === 'answer') {
      const list = answers.get(k.askId) || [];
      list.push(row);
      answers.set(k.askId, list);
    }
  }
  const opened = await openAll(orgId, asks);
  return opened
    .sort((a, b) => String(a.SK).localeCompare(String(b.SK)))
    .map((ask) => ({ ask, answerRows: answers.get(ask.AskId) || [] }));
}

async function readAsk(db, { gameId, round, askId, orgId }) {
  const sk = keys.askSk(round, askId);
  if (!sk) return null;
  const res = await db.send(new GetCommand({ TableName: table(), Key: { PK: pkOf(gameId), SK: sk } }));
  return res && res.Item ? open(orgId, res.Item) : null;
}

async function readLivePointer(db, { gameId }) {
  const res = await db.send(new GetCommand({ TableName: table(), Key: { PK: pkOf(gameId), SK: keys.LIVE_SK } }));
  return (res && res.Item) || null;
}

/** The count, from answer rows (sealed or not): the survey's own aggregate. */
async function countAnswers(ask, answerRows, orgId) {
  const opened = await openAll(orgId, answerRows || []);
  const question = toSurveyQuestion(ask);
  if (!question) return tallyOf(ask, { n: 0 });
  const result = pollTally(question, opened.map((r) => ({ PollValue: r.Value })));
  return tallyOf(ask, result);
}

/**
 * Send an ask: the LIVE pointer (only if none) and the ask row, in one
 * transaction, so two sends racing cannot both go live.
 *
 * @returns {Promise<{ok: true, ask: object} | {ok: false, code: 'LIVE'}>}
 */
async function createAsk(db, { gameId, round, orgId, value, origin, now = new Date().toISOString(), askId = keys.newAskId() }) {
  const sk = keys.askSk(round, askId);
  if (!sk) throw new Error('followup-store: bad round or ask id');
  const item = {
    PK: pkOf(gameId),
    SK: sk,
    GameId: gameId,
    QuestionNumber: keys.roundOf(round),
    AskId: askId,
    Kind: value.kind,
    ...(value.kind === 'agree' ? { Statement: value.statement } : { Question: value.question, Options: origin.options }),
    FromAnswers: origin.fromAnswers || [],
    Origin: origin.origin,
    SuggestionIndex: value.suggestionIndex,
    Status: 'live',
    SentAt: now,
    ttl: ttlFrom(now, ROUND_RECORD_DAYS),
  };
  const pointer = {
    PK: pkOf(gameId), SK: keys.LIVE_SK, Round: keys.roundOf(round), AskId: askId, SentAt: now, ttl: ttlFrom(now, LIVE_DAYS),
  };
  try {
    await transact(db, {
      TransactItems: [
        { Put: { TableName: table(), Item: pointer, ConditionExpression: 'attribute_not_exists(SK)' } },
        { Put: { TableName: table(), Item: await seal(orgId, item), ConditionExpression: 'attribute_not_exists(SK)' } },
      ],
    });
  } catch (e) {
    if (isConditionFailure(e)) return { ok: false, code: 'LIVE' };
    throw e;
  }
  return { ok: true, ask: item };
}

/**
 * Close (freeze the tally) or cancel a live ask, and free the session's LIVE
 * pointer. The status flips FIRST, conditionally, and answers are only
 * accepted while it is `live` (writeAnswer's transaction), so the tally read
 * after the flip is final.
 *
 * @returns {Promise<{ok: true, ask: object} | {ok: false, code: 'NOT_FOUND'|'NOT_LIVE'}>}
 */
async function finishAsk(db, { gameId, round, askId, orgId, status, now = new Date().toISOString() }) {
  const sk = keys.askSk(round, askId);
  if (!sk) return { ok: false, code: 'NOT_FOUND' };
  let updated;
  try {
    updated = await db.send(new UpdateCommand({
      TableName: table(),
      Key: { PK: pkOf(gameId), SK: sk },
      UpdateExpression: 'SET #s = :status, #at = :now',
      ConditionExpression: 'attribute_exists(SK) AND #s = :live',
      ExpressionAttributeNames: { '#s': 'Status', '#at': status === 'closed' ? 'ClosedAt' : 'CancelledAt' },
      ExpressionAttributeValues: { ':status': status, ':now': now, ':live': 'live' },
      ReturnValues: 'ALL_NEW',
    }));
  } catch (e) {
    if (!isConditionFailure(e)) throw e;
    const existing = await readAsk(db, { gameId, round, askId, orgId });
    await freePointer(db, { gameId, askId });
    return { ok: false, code: existing ? 'NOT_LIVE' : 'NOT_FOUND' };
  }
  let ask = await open(orgId, updated.Attributes);
  if (status === 'closed') ask = await freezeTally(db, { gameId, round, ask, orgId });
  await freePointer(db, { gameId, askId });
  return { ok: true, ask };
}

/** Count a closed ask's answers and store the count on it, sealed. Idempotent. */
async function freezeTally(db, { gameId, round, ask, orgId }) {
  const prefix = keys.answersPrefix(round, ask.AskId);
  const rows = prefix ? await queryAll(db, gameId, prefix) : [];
  const tally = await countAnswers(ask, rows, orgId);
  const sealed = await seal(orgId, { Tally: tally });
  await db.send(new UpdateCommand({
    TableName: table(),
    Key: { PK: pkOf(gameId), SK: ask.SK },
    UpdateExpression: 'SET #t = :t',
    ExpressionAttributeNames: { '#t': 'Tally' },
    ExpressionAttributeValues: { ':t': sealed.Tally },
  }));
  return { ...ask, Tally: tally };
}

/** Delete the LIVE pointer if it still names this ask. */
async function freePointer(db, { gameId, askId }) {
  try {
    await db.send(new DeleteCommand({
      TableName: table(),
      Key: { PK: pkOf(gameId), SK: keys.LIVE_SK },
      ConditionExpression: 'AskId = :id',
      ExpressionAttributeValues: { ':id': askId },
    }));
  } catch (e) {
    if (!isConditionFailure(e)) throw e;
  }
}

/**
 * The session's live ask, if its round is no longer the one on screen, is
 * closed with its tally (Next round with an ask still live closes it, so no
 * answer is lost — SPEC §4.3 step 6). Called by next-question.js before the
 * room moves, and by the routes before they trust the pointer.
 *
 * @param {string|null} onScreenRound  the round on RESULTS now ('003'), or null
 * @returns {Promise<object|null>} the pointer still live, or null
 */
async function settleLive(db, { gameId, orgId, onScreenRound }) {
  const pointer = await readLivePointer(db, { gameId });
  if (!pointer) return null;
  if (onScreenRound && pointer.Round === onScreenRound) return pointer;
  await finishAsk(db, { gameId, round: pointer.Round, askId: pointer.AskId, orgId, status: 'closed' });
  return null;
}

// ──────────────────────────────────────────────────────────── answers ──

/**
 * One person's answer, overwritten on change; refused once the ask is not
 * live (the ConditionCheck), so nothing lands after the tally is frozen.
 *
 * @returns {Promise<{ok: true} | {ok: false, code: 'NOT_LIVE'}>}
 */
async function writeAnswer(db, { gameId, round, askId, orgId, playerName, value, text, now = new Date().toISOString() }) {
  const sk = keys.answerSk(round, askId, playerName);
  const askKey = keys.askSk(round, askId);
  if (!sk || !askKey) throw new Error('followup-store: bad answer key');
  const item = {
    PK: pkOf(gameId),
    SK: sk,
    GameId: gameId,
    QuestionNumber: keys.roundOf(round),
    AskId: askId,
    PlayerName: playerName,
    Value: value,
    Text: text,
    At: now,
    ttl: ttlFrom(now, STARTED_DAYS),
  };
  try {
    await transact(db, {
      TransactItems: [
        {
          ConditionCheck: {
            TableName: table(),
            Key: { PK: pkOf(gameId), SK: askKey },
            ConditionExpression: '#s = :live',
            ExpressionAttributeNames: { '#s': 'Status' },
            ExpressionAttributeValues: { ':live': 'live' },
          },
        },
        { Put: { TableName: table(), Item: await seal(orgId, item) } },
      ],
    });
  } catch (e) {
    if (isConditionFailure(e)) return { ok: false, code: 'NOT_LIVE' };
    throw e;
  }
  return { ok: true };
}

async function readAnswer(db, { gameId, round, askId, orgId, playerName }) {
  const sk = keys.answerSk(round, askId, playerName);
  if (!sk) return null;
  const res = await db.send(new GetCommand({ TableName: table(), Key: { PK: pkOf(gameId), SK: sk } }));
  return res && res.Item ? open(orgId, res.Item) : null;
}

module.exports = {
  isConditionFailure,
  SUGGESTED_DAYS,
  LIVE_DAYS,
  followUpsEnabled,
  queryAll,
  writeSuggestions,
  deleteSuggestions,
  readSuggestions,
  readAllSuggestions,
  suggestionsWire,
  readRound,
  readAsk,
  readLivePointer,
  countAnswers,
  createAsk,
  finishAsk,
  freezeTally,
  settleLive,
  writeAnswer,
  readAnswer,
};
