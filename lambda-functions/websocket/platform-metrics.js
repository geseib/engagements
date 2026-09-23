/**
 * PLATFORM METRICS — how Engage is used, counted as it happens.
 *
 * The owner, 2026-09-23: "total sessions per month … number of questions
 * answered for each category … average questions per session (we only need to
 * record actually gone through sessions, not how many question were
 * potentially in a session (if i bring up a session with 50 questions, but go
 * through 10. it counts as 10."
 *
 * Nothing in the table could answer that after the fact. Session rows expire
 * (7 days from start, 90 from creation — session-ttl.js), a REF row lasts a
 * day, and an answer row is a person's words under their organisation's key.
 * So these are RECORDED, at the moment each thing happens, into a partition of
 * their own. History starts at deploy; there is no backfill.
 *
 * ── THE ROWS ───────────────────────────────────────────────────────────────
 *
 *   PK: PLATFORM#METRICS  SK: MONTH#<yyyy-mm>
 *       sessionsCreated   a host created a session
 *       sessionsStarted   a session left the lobby (either door, session-start.js)
 *       roundsServed      a question was put in front of the room (next-question.js)
 *       sessionsServed    sessions that served their FIRST question this month
 *       answersStored     a NEW answer row — one per person per question
 *       firstRecordedAt   the first event ever written to this month's row
 *
 *   PK: PLATFORM#METRICS  SK: MONTH#<yyyy-mm>#CATEGORY#<key>
 *       rounds, answers   the same two counts, by the category the question
 *                         came from — see "WHOSE CATEGORY NAME" below
 *       label, library    what the screen prints
 *
 * Numbers only. No organisation id, no session id, no title, no answer text
 * reaches either row kind.
 *
 * ── ttl: DELIBERATELY ABSENT ───────────────────────────────────────────────
 *
 * Same argument usage.js makes for USAGE#/LEDGER#: session content expires,
 * the FACT that a session ran is an accounting entry and outlives everything
 * it refers to. A counter row with a ttl is a history that silently shortens.
 *
 * ── WHOSE CATEGORY NAME ────────────────────────────────────────────────────
 *
 * A category from ENGAGE'S library or the PUBLIC library is counted under its
 * name: both are plaintext by design (tenant-crypto.js — platform content has
 * no tenant, and published means public). A category from an ORGANISATION'S
 * own set is that team's content — its `Name` is plaintext only because the
 * category bitmask depends on its order — and it is counted in ONE bucket,
 * "Teams' own sets", never named and never read. For an org set this module
 * does not even fetch the question row. Any scope it does not recognise goes
 * into the same unnamed bucket: the safe direction is to know less.
 *
 * ── COUNTED ONCE, WHATEVER RETRIES ─────────────────────────────────────────
 *
 *   created   one call per successful create; a retried create is a new session.
 *   started   a marker on the session's own METADATA row, `MetricsStartedAt`,
 *             written only if absent. Two Start presses racing both reach
 *             startSession; one writes the marker, the other bounces.
 *   served    a HIGH-WATER MARK on METADATA, `MetricsRoundsServed`, raised only
 *             when the new round number is higher — the ratchet usage.js uses
 *             for setsPeak. A retried or racing next-question for the same round
 *             carries the same number and bounces. The OLD value (UPDATED_OLD)
 *             says whether this was the session's first served round.
 *   answer    the caller passes what its own Put overwrote (ReturnValues
 *             ALL_OLD). A resubmitted answer overwrites its row, so it arrives
 *             with a `previous` and is not counted again.
 *
 * The markers live on METADATA because a session code is reused once its
 * reservation expires, and the next session's create PUTS a fresh METADATA
 * row — the markers cannot outlive the session they describe.
 *
 * ── IT NEVER THROWS, AND NEVER BLOCKS WHAT IT RIDES ON ─────────────────────
 *
 * Every export catches everything, logs, and returns a small result object.
 * These calls sit inside the create, the start, the round and the answer — a
 * metrics write that could fail any of those would be a room stopped for a
 * dashboard. Losing a count is strictly better.
 *
 * TRIPLICATED, BYTE FOR BYTE: lambda-functions/game/platform-metrics.js,
 * lambda-functions/websocket/platform-metrics.js and
 * lambda-functions/admin/shared/platform-metrics.js — CodeUri is per-directory
 * and there are no layers. game/ serves rounds and starts, websocket/ creates
 * sessions and stores answers, admin/ reads it all back for the platform
 * console. tests/platform-metrics.js fails the build if the copies drift.
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient, GetCommand, UpdateCommand, QueryCommand,
} = require('@aws-sdk/lib-dynamodb');
const { setContentPk, PLATFORM, PUBLIC } = require('./tenant');

const client = new DynamoDBClient({});
const defaultDb = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

const METRICS_PK = 'PLATFORM#METRICS';
const monthSk = (period) => `MONTH#${period}`;
const categorySk = (period, key) => `MONTH#${period}#CATEGORY#${key}`;

/** The one label an organisation's own categories are counted under. */
const TEAM_SETS_LABEL = 'Teams’ own sets';
const TEAM_SETS_KEY = 'org';

/** The attributes this module keeps on a session's METADATA row. */
const STARTED_MARKER = 'MetricsStartedAt';
const ROUNDS_MARKER = 'MetricsRoundsServed';

/** Tests inject a db, a table and a clock; production reads env per call. */
function ctx(opts = {}) {
  return {
    db: opts.db || defaultDb,
    tableName: opts.tableName || process.env.TABLE_NAME,
    now: opts.now instanceof Date ? opts.now : new Date(),
  };
}

/** `yyyy-mm` in UTC — the same rule, and the same reason, as usage.js:periodOf. */
function periodOf(date) {
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

const clean = (v) => (typeof v === 'string' ? v.trim() : '');

/**
 * Which bucket a question's category is counted in.
 *
 * `library` is 'platform' | 'public' | 'org'. ONLY platform and public carry a
 * name; everything else — an org set, or a scope nobody recognises — is the
 * one unnamed bucket.
 */
function bucketFor(scope, categoryName) {
  if (scope !== PLATFORM && scope !== PUBLIC) {
    return { key: TEAM_SETS_KEY, label: TEAM_SETS_LABEL, library: 'org' };
  }
  const library = scope === PUBLIC ? 'public' : 'platform';
  const name = clean(categoryName).slice(0, 120) || 'Uncategorised';
  return { key: `${library}#${name.toLowerCase()}`, label: name, library };
}

/**
 * The category NAME of one question in a platform or public set. Never called
 * for an org set — the caller decides the bucket first.
 */
async function categoryNameOf(c, contentPk, questionId) {
  if (!contentPk || !clean(questionId)) return '';
  const found = await c.db.send(new GetCommand({
    TableName: c.tableName,
    Key: { PK: contentPk, SK: questionId },
    ProjectionExpression: '#c, #lc',
    ExpressionAttributeNames: { '#c': 'Category', '#lc': 'category' },
  }));
  const item = (found && found.Item) || {};
  return clean(item.Category) || clean(item.category);
}

/** A set reference as next-question's resolvedSet or a REF row states it. */
async function bucketForQuestion(c, { scope, contentPk, questionId }) {
  if (scope !== PLATFORM && scope !== PUBLIC) return bucketFor(scope, '');
  let name = '';
  try {
    name = await categoryNameOf(c, contentPk, questionId);
  } catch (error) {
    console.warn(`⚠️ metrics: could not read a category name (${error.message}); counted as uncategorised`);
  }
  return bucketFor(scope, name);
}

/** ADD each positive counter on this month's row. */
async function bumpMonth(c, counters) {
  const entries = Object.entries(counters).filter(([, n]) => n > 0);
  if (!entries.length) return;
  const names = { '#period': 'period', '#updated': 'updatedAt', '#first': 'firstRecordedAt' };
  const values = { ':p': periodOf(c.now), ':t': c.now.toISOString() };
  const adds = entries.map(([attr, n], i) => {
    names[`#a${i}`] = attr;
    values[`:n${i}`] = n;
    return `#a${i} :n${i}`;
  });
  await c.db.send(new UpdateCommand({
    TableName: c.tableName,
    Key: { PK: METRICS_PK, SK: monthSk(periodOf(c.now)) },
    UpdateExpression: `ADD ${adds.join(', ')} SET #period = :p, #updated = :t, #first = if_not_exists(#first, :t)`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  }));
}

/** ADD one to `attr` on this month's row for the bucket. */
async function bumpCategory(c, bucket, attr) {
  const period = periodOf(c.now);
  await c.db.send(new UpdateCommand({
    TableName: c.tableName,
    Key: { PK: METRICS_PK, SK: categorySk(period, bucket.key) },
    UpdateExpression: 'ADD #n :one SET #label = :label, #library = :library, #period = :p',
    ExpressionAttributeNames: {
      '#n': attr, '#label': 'label', '#library': 'library', '#period': 'period',
    },
    ExpressionAttributeValues: {
      ':one': 1, ':label': bucket.label, ':library': bucket.library, ':p': period,
    },
  }));
}

const isConditionFailure = (e) => Boolean(e && e.name === 'ConditionalCheckFailedException');

/** Log and swallow. Every public recorder funnels its failure through here. */
function swallow(what, error) {
  console.error(`⚠️ metrics: ${what} not recorded:`, error && error.message ? error.message : error);
  return { counted: false, reason: 'error' };
}

// ── The four recorders ─────────────────────────────────────────────────────

/** A host created a session. Call once, after the create succeeded. */
async function recordSessionCreated(_args = {}, opts = {}) {
  try {
    const c = ctx(opts);
    await bumpMonth(c, { sessionsCreated: 1 });
    return { counted: true };
  } catch (error) {
    return swallow('session created', error);
  }
}

/** A session left the lobby. Once per session, however many doors raced. */
async function recordSessionStarted({ gameId } = {}, opts = {}) {
  try {
    const c = ctx(opts);
    const id = clean(String(gameId || ''));
    if (!id) return { counted: false, reason: 'no-session' };
    try {
      await c.db.send(new UpdateCommand({
        TableName: c.tableName,
        Key: { PK: `GAME#${id}`, SK: 'METADATA' },
        UpdateExpression: 'SET #m = :t',
        // attribute_exists(PK): never conjure a METADATA row for a session
        // that does not have one.
        ConditionExpression: 'attribute_exists(PK) AND attribute_not_exists(#m)',
        ExpressionAttributeNames: { '#m': STARTED_MARKER },
        ExpressionAttributeValues: { ':t': c.now.toISOString() },
      }));
    } catch (error) {
      if (isConditionFailure(error)) return { counted: false, reason: 'already' };
      throw error;
    }
    await bumpMonth(c, { sessionsStarted: 1 });
    return { counted: true };
  } catch (error) {
    return swallow('session started', error);
  }
}

/**
 * next-question.js put round `round` on screen.
 *
 * @param {object} args
 * @param {string} args.gameId
 * @param {number} args.round       the round number just served (LessonNumber)
 * @param {object} args.set         next-question's resolvedSet: { scope, pk }
 * @param {string} args.questionId  the served question's SK in that partition
 */
async function recordRoundServed({ gameId, round, set, questionId } = {}, opts = {}) {
  try {
    const c = ctx(opts);
    const id = clean(String(gameId || ''));
    const n = Math.trunc(Number(round));
    if (!id || !Number.isFinite(n) || n < 1) return { counted: false, reason: 'no-round' };

    let firstForSession;
    try {
      const res = await c.db.send(new UpdateCommand({
        TableName: c.tableName,
        Key: { PK: `GAME#${id}`, SK: 'METADATA' },
        UpdateExpression: 'SET #r = :n',
        ConditionExpression: 'attribute_exists(PK) AND (attribute_not_exists(#r) OR #r < :n)',
        ExpressionAttributeNames: { '#r': ROUNDS_MARKER },
        ExpressionAttributeValues: { ':n': n },
        ReturnValues: 'UPDATED_OLD',
      }));
      const old = res && res.Attributes ? res.Attributes[ROUNDS_MARKER] : undefined;
      firstForSession = old === undefined;
    } catch (error) {
      if (isConditionFailure(error)) return { counted: false, reason: 'already' };
      throw error;
    }

    const bucket = await bucketForQuestion(c, {
      scope: set && set.scope,
      contentPk: set && set.pk,
      questionId,
    });
    await Promise.all([
      bumpMonth(c, { roundsServed: 1, sessionsServed: firstForSession ? 1 : 0 }),
      bumpCategory(c, bucket, 'rounds'),
    ]);
    return { counted: true, firstForSession, library: bucket.library };
  } catch (error) {
    return swallow('round served', error);
  }
}

/**
 * websocket/message.js stored an answer.
 *
 * @param {object} args
 * @param {string} args.gameId
 * @param {string} args.questionNumber  the padded round number, e.g. '004'
 * @param {object} [args.previous]      what the Put overwrote (ALL_OLD). Present
 *                                      means a resubmission: not counted again.
 */
async function recordAnswerStored({ gameId, questionNumber, previous } = {}, opts = {}) {
  try {
    if (previous && typeof previous === 'object' && Object.keys(previous).length) {
      return { counted: false, reason: 'resubmitted' };
    }
    const c = ctx(opts);
    const id = clean(String(gameId || ''));
    const q = clean(String(questionNumber || ''));
    if (!id || !q) return { counted: false, reason: 'no-question' };

    // The REF row says which set and question this round served. Its scope
    // decides the bucket before anything else is read.
    const refRes = await c.db.send(new GetCommand({
      TableName: c.tableName,
      Key: { PK: `GAME#${id}`, SK: `QUESTION#${q}#REF` },
      ProjectionExpression: 'SourceQuestionId, SetId, SetScope, SetOrgId, SetVersion',
    }));
    const ref = (refRes && refRes.Item) || null;
    let bucket = bucketFor('', '');
    if (ref) {
      // A REF written before scope pinning carries no SetScope and reads as
      // platform — unless it names an org, which is the safe reading.
      const scope = clean(ref.SetScope) || (clean(ref.SetOrgId) ? 'org' : PLATFORM);
      let contentPk = '';
      if (scope === PLATFORM || scope === PUBLIC) {
        try {
          contentPk = setContentPk(scope, '', ref.SetId, ref.SetVersion);
        } catch {
          contentPk = '';
        }
      }
      bucket = await bucketForQuestion(c, { scope, contentPk, questionId: ref.SourceQuestionId });
    }

    await Promise.all([
      bumpMonth(c, { answersStored: 1 }),
      bumpCategory(c, bucket, 'answers'),
    ]);
    return { counted: true, library: bucket.library };
  } catch (error) {
    return swallow('answer', error);
  }
}

// ── Reading it back (admin/ only calls this) ───────────────────────────────

const int = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Math.trunc(Number(v))) : 0);

/**
 * Questions served ÷ sessions that served at least one, to one decimal place.
 * null when no session served anything — "0.0 questions per session" would be
 * a number about sessions that did not happen.
 */
function averageRounds(roundsServed, sessionsServed) {
  const s = int(sessionsServed);
  if (!s) return null;
  return Math.round((int(roundsServed) / s) * 10) / 10;
}

/**
 * Every recorded row, shaped for the platform console.
 *
 * @returns {{ months: object[], categories: object[], countingSince: string|null }}
 *   months      newest first: { period, sessionsCreated, sessionsStarted,
 *               roundsServed, sessionsServed, answersStored, averageRounds }
 *   categories  summed over every month, most answers first, the unnamed
 *               teams' bucket always last: { label, library, rounds, answers }
 */
async function readRecordedMetrics(opts = {}) {
  const c = ctx(opts);
  const items = [];
  let ExclusiveStartKey;
  do {
    const page = await c.db.send(new QueryCommand({
      TableName: c.tableName,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': METRICS_PK },
      ExclusiveStartKey,
    }));
    items.push(...((page && page.Items) || []));
    ExclusiveStartKey = page && page.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  const months = [];
  const byBucket = new Map();
  let countingSince = null;

  for (const item of items) {
    const sk = String(item.SK || '');
    const month = /^MONTH#(\d{4}-\d{2})$/.exec(sk);
    if (month) {
      const row = {
        period: month[1],
        sessionsCreated: int(item.sessionsCreated),
        sessionsStarted: int(item.sessionsStarted),
        roundsServed: int(item.roundsServed),
        sessionsServed: int(item.sessionsServed),
        answersStored: int(item.answersStored),
      };
      row.averageRounds = averageRounds(row.roundsServed, row.sessionsServed);
      months.push(row);
      const first = clean(item.firstRecordedAt);
      if (first && (!countingSince || first < countingSince)) countingSince = first;
      continue;
    }
    const cat = /^MONTH#\d{4}-\d{2}#CATEGORY#(.+)$/.exec(sk);
    if (!cat) continue;
    const library = ['platform', 'public'].includes(item.library) ? item.library : 'org';
    // Re-derived, never trusted: a row whose library is not platform/public
    // is the unnamed bucket whatever label it carries.
    const key = library === 'org' ? TEAM_SETS_KEY : cat[1];
    const label = library === 'org' ? TEAM_SETS_LABEL : (clean(item.label) || 'Uncategorised');
    const sum = byBucket.get(key) || { label, library, rounds: 0, answers: 0 };
    sum.rounds += int(item.rounds);
    sum.answers += int(item.answers);
    byBucket.set(key, sum);
  }

  months.sort((a, b) => b.period.localeCompare(a.period));
  const named = [...byBucket.entries()].filter(([k]) => k !== TEAM_SETS_KEY).map(([, v]) => v);
  named.sort((a, b) => (b.answers - a.answers) || (b.rounds - a.rounds) || a.label.localeCompare(b.label));
  const teams = byBucket.get(TEAM_SETS_KEY);

  return { months, categories: teams ? [...named, teams] : named, countingSince };
}

module.exports = {
  recordSessionCreated,
  recordSessionStarted,
  recordRoundServed,
  recordAnswerStored,
  readRecordedMetrics,
  averageRounds,
  bucketFor,
  periodOf,
  METRICS_PK,
  monthSk,
  categorySk,
  TEAM_SETS_LABEL,
  STARTED_MARKER,
  ROUNDS_MARKER,
};
