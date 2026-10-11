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
 *       roundsServed      a question was put in front of the room (next-question.js;
 *                         a survey's every question when it opens, start-game.js)
 *       sessionsServed    sessions that served their FIRST question this month
 *       answersStored     answer rows a question had when the host moved on
 *                         from it — one per person per question
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
 *   survey    a survey has no rounds: recordSurveyOpened counts every
 *             question as served when it opens (the served marker, raised to
 *             the question count), recordSurveyClosed counts the answers given
 *             when it closes (the answers marker, once) — see below.
 *   answers   counted PER ROUND, not per answer, when the host moves on
 *             (next-question.js, before it serves the next round or ends the
 *             session): one COUNT query over the round's answer rows, then one
 *             ADD. A changed answer overwrites its row, so it is one row. A
 *             second high-water mark, `MetricsAnswersCounted`, makes a retried
 *             or racing press count the round once.
 *
 * WHY PER ROUND. Per answer it was four calls for every person on every
 * question — the round's REF row, the question's category, two ADDs — all
 * answering the same question for everyone in the room, and every answer on the
 * platform writing the same monthly row. Per round it is three calls however
 * big the room is, and nothing extra runs while people are answering. The
 * round's category is worked out once, when it is served, and kept on METADATA
 * (`MetricsRoundBucket`) for the close to reuse.
 *
 * THE ONE GAP, accepted: a session abandoned mid-question never has that last
 * question closed, so its answers are not counted. At most one round per
 * abandoned session, and answer rows expire in 7 days, so it cannot be
 * recovered later either.
 *
 * The markers live on METADATA because a session code is reused once its
 * reservation expires, and the next session's create PUTS a fresh METADATA
 * row — the markers cannot outlive the session they describe.
 *
 * ── IT NEVER THROWS, AND NEVER BLOCKS WHAT IT RIDES ON ─────────────────────
 *
 * Every export catches everything, logs, and returns a small result object.
 * These calls sit inside the create, the start and the round — a metrics
 * write that could fail any of those would be a room stopped for a dashboard.
 * Losing a count is strictly better. Nothing here runs on the answer path.
 *
 * TRIPLICATED, BYTE FOR BYTE: lambda-functions/game/platform-metrics.js,
 * lambda-functions/websocket/platform-metrics.js and
 * lambda-functions/admin/shared/platform-metrics.js — CodeUri is per-directory
 * and there are no layers. game/ starts sessions and serves and closes
 * rounds, websocket/ creates sessions, admin/ reads it all back for the
 * platform console. tests/platform-metrics.js fails the build if the copies drift.
 *
 * ── USAGE STATS: BY TYPE, BY TEAM, BY ACCOUNT, BY SET (2026-10-11) ─────────
 *
 * docs/design/usage-stats/SPEC.md. The same moments, counted once more into
 * small rows per month, per session type, for three scopes at once:
 *
 *   PK: PLATFORM#METRICS  SK: MONTH#<yyyy-mm>#TYPE#<type>
 *   PK: ORG#<org>         SK: STATS#<yyyy-mm>#TYPE#<type>
 *   PK: USER#<sub>        SK: STATS#<yyyy-mm>#TYPE#<type>#ORG#<org|->
 *       created, started, counted, questions, participants
 *       (Build Room adds decisions, tasks)
 *
 * and one row per set and version, all time, in the set's own scope:
 *
 *   PK: <scope>SETSTATS   SK: SET#<setId>#V#<n>      (n = 0: unversioned)
 *       sessions, questions, copies, downloads
 *
 * The daily job (admin/usage-reconcile.js) writes the two LEVELS — sessions
 * still kept, sets held — as absolute snapshots under `…#GAUGE`.
 *
 * Every counter rides behind a once-only guard on the session's METADATA (or
 * the event's): `StatsCreatedAt`, `MetricsStartedAt`, `StatsCountedAt`, the
 * `MetricsRoundsServed` ratchet, the string sets `StatsAsks`/`StatsDecided`,
 * and `StatsRunAt` on an event. Numbers and ids only — never a title, never a
 * question, and nothing here can decrypt. No ttl.
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient, GetCommand, UpdateCommand, QueryCommand,
} = require('@aws-sdk/lib-dynamodb');
const {
  setContentPk, setStatsPk, orgPk, userPk, gamesIndexPk, setsMetadataPk, eventPk,
  PLATFORM, PUBLIC, ORG,
} = require('./tenant');

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
const ANSWERS_MARKER = 'MetricsAnswersCounted';
/** The served round's bucket, kept for the close: { key, label, library }. */
const BUCKET_ATTR = 'MetricsRoundBucket';

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

/** ADD `n` (default one) to `attr` on this month's row for the bucket. */
async function bumpCategory(c, bucket, attr, n = 1) {
  const period = periodOf(c.now);
  await c.db.send(new UpdateCommand({
    TableName: c.tableName,
    Key: { PK: METRICS_PK, SK: categorySk(period, bucket.key) },
    UpdateExpression: 'ADD #n :one SET #label = :label, #library = :library, #period = :p',
    ExpressionAttributeNames: {
      '#n': attr, '#label': 'label', '#library': 'library', '#period': 'period',
    },
    ExpressionAttributeValues: {
      ':one': n, ':label': bucket.label, ':library': bucket.library, ':p': period,
    },
  }));
}

const isConditionFailure = (e) => Boolean(e && e.name === 'ConditionalCheckFailedException');

/** Log and swallow. Every public recorder funnels its failure through here. */
function swallow(what, error) {
  console.error(`⚠️ metrics: ${what} not recorded:`, error && error.message ? error.message : error);
  return { counted: false, reason: 'error' };
}

// ── Usage stats: the rows (SPEC §6) ────────────────────────────────────────

/** The session types counted. `event` is the agenda's own row, never a session type. */
const STATS_TYPES = Object.freeze(['call-and-answer', 'trivia', 'poll', 'wavelength', 'survey', 'build']);
const EVENT_TYPE = 'event';
const OTHER_TYPE = 'other';
/**
 * Legacy spellings → canonical type. game-types.js's ALIASES, copied because
 * websocket/ carries no game-types.js; tests/usage-stats.js holds the two
 * equal, so they cannot drift.
 */
const TYPE_ALIASES = Object.freeze({
  callandanswer: 'call-and-answer',
  call_and_answer: 'call-and-answer',
  calland: 'call-and-answer',
  quiz: 'trivia',
  polls: 'poll',
});
/** The counters a type row may hold. Build Room adds the last two. */
const STATS_COUNTERS = Object.freeze(['created', 'started', 'counted', 'questions', 'participants', 'decisions', 'tasks']);
/** The counters a set row may hold. */
const SET_COUNTERS = Object.freeze(['sessions', 'questions', 'copies', 'downloads']);

/** The markers this module keeps for the stats (SPEC §6.4). */
const CREATED_MARKER = 'StatsCreatedAt';
const COUNTED_MARKER = 'StatsCountedAt';
const ASKS_MARKER = 'StatsAsks';
const DECIDED_MARKER = 'StatsDecided';
const RUN_MARKER = 'StatsRunAt';

/**
 * A stored GameType as the stats count it. `build` passes through; a known
 * spelling lands on its canonical key; an absent type is the create default
 * (call-and-answer); anything else is `other`.
 */
function statsType(gameType) {
  if (gameType === undefined || gameType === null || gameType === '') return 'call-and-answer';
  const key = String(gameType).trim().toLowerCase();
  if (!key) return 'call-and-answer';
  if (STATS_TYPES.includes(key)) return key;
  if (TYPE_ALIASES[key]) return TYPE_ALIASES[key];
  return OTHER_TYPE;
}

const NO_ORG = '-';
const statsTypeSk = (period, type) => `STATS#${period}#TYPE#${type}`;
const accountTypeSk = (period, type, orgId) => `STATS#${period}#TYPE#${type}#ORG#${clean(orgId) || NO_ORG}`;
const platformTypeSk = (period, type) => `MONTH#${period}#TYPE#${type}`;
const statsGaugeSk = (period) => `STATS#${period}#GAUGE`;
const accountGaugeSk = (period, orgId) => `STATS#${period}#GAUGE#ORG#${clean(orgId) || NO_ORG}`;
const platformGaugeSk = (period) => `MONTH#${period}#GAUGE`;
const setVersionOf = (version) => {
  const n = Math.trunc(Number(version));
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const setStatsSk = (setId, version) => `SET#${clean(setId)}#V#${setVersionOf(version)}`;

const sessionKey = (gameId) => ({ PK: `GAME#${gameId}`, SK: 'METADATA' });

/**
 * Claim a once-only marker on an existing row. true when this call wrote it;
 * false when it was already there (or the row is gone). Throws on anything
 * else, for the recorder's own catch.
 */
async function claimMarker(c, Key, marker) {
  try {
    await c.db.send(new UpdateCommand({
      TableName: c.tableName,
      Key,
      UpdateExpression: 'SET #m = :t',
      ConditionExpression: 'attribute_exists(PK) AND attribute_not_exists(#m)',
      ExpressionAttributeNames: { '#m': marker },
      ExpressionAttributeValues: { ':t': c.now.toISOString() },
    }));
    return true;
  } catch (error) {
    if (isConditionFailure(error)) return false;
    throw error;
  }
}

/** Add `id` to the string set `marker` on METADATA, once. true when it was new. */
async function claimInSet(c, Key, marker, id) {
  try {
    await c.db.send(new UpdateCommand({
      TableName: c.tableName,
      Key,
      UpdateExpression: 'ADD #s :set',
      ConditionExpression: 'attribute_exists(PK) AND NOT contains(#s, :id)',
      ExpressionAttributeNames: { '#s': marker },
      ExpressionAttributeValues: { ':set': new Set([id]), ':id': id },
    }));
    return true;
  } catch (error) {
    if (isConditionFailure(error)) return false;
    throw error;
  }
}

/**
 * Who and what a session is, for the stats: its type, its team, its creator.
 * From the METADATA item the caller already holds, else one projected read
 * of three plaintext attributes. Never a title.
 */
async function sessionFacts(c, gameId, metadata) {
  let meta = metadata && typeof metadata === 'object' ? metadata : null;
  if (!meta) {
    const res = await c.db.send(new GetCommand({
      TableName: c.tableName,
      Key: sessionKey(gameId),
      ProjectionExpression: '#t, #o, #c',
      ExpressionAttributeNames: { '#t': 'GameType', '#o': 'orgId', '#c': 'CreatedBy' },
    }));
    meta = (res && res.Item) || {};
  }
  return {
    type: statsType(meta.GameType),
    orgId: clean(meta.orgId || meta.OrgId),
    userId: clean(meta.CreatedBy),
  };
}

/** ADD each positive counter on one stats row, and stamp what it is. */
async function bumpStatsRow(c, Key, counters, fields) {
  const entries = Object.entries(counters).filter(([, n]) => n > 0);
  if (!entries.length) return;
  const names = { '#u': 'updatedAt', '#first': 'firstRecordedAt' };
  const values = { ':now': c.now.toISOString() };
  const adds = entries.map(([attr, n], i) => {
    names[`#c${i}`] = attr;
    values[`:n${i}`] = n;
    return `#c${i} :n${i}`;
  });
  const sets = ['#u = :now', '#first = if_not_exists(#first, :now)'];
  Object.entries(fields).forEach(([attr, value], i) => {
    names[`#f${i}`] = attr;
    values[`:f${i}`] = value;
    sets.push(`#f${i} = :f${i}`);
  });
  await c.db.send(new UpdateCommand({
    TableName: c.tableName,
    Key,
    UpdateExpression: `ADD ${adds.join(', ')} SET ${sets.join(', ')}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  }));
}

/**
 * The three scope rows for one event (SPEC §6.1): platform, the team (when
 * the session has one), the account (when it names its creator). Together,
 * each caught and logged on its own — one failed row costs that row only.
 */
async function fanOut(c, { type, orgId, userId } = {}, counters = {}) {
  const t = type || OTHER_TYPE;
  const period = periodOf(c.now);
  const base = { period, type: t };
  const writes = [
    ['platform', { PK: METRICS_PK, SK: platformTypeSk(period, t) }, base],
  ];
  if (clean(orgId)) writes.push(['team', { PK: orgPk(orgId), SK: statsTypeSk(period, t) }, base]);
  if (clean(userId)) {
    writes.push(['account', { PK: userPk(userId), SK: accountTypeSk(period, t, orgId) }, { ...base, orgId: clean(orgId) || NO_ORG }]);
  }
  await Promise.all(writes.map(([scope, Key, fields]) => bumpStatsRow(c, Key, counters, fields)
    .catch((error) => { swallow(`${scope} stats`, error); })));
}

/**
 * A set's all-time row for the version used (SPEC §6.3). `set` is a resolved
 * set reference: { scope, orgId, setId, version }. Nothing for a set this
 * cannot place. Caught and logged here, like fanOut.
 */
async function bumpSet(c, set, counters = {}) {
  try {
    const ref = set && typeof set === 'object' ? set : {};
    const setId = clean(ref.setId);
    const scope = clean(ref.scope) || PLATFORM;
    if (!setId || ![PLATFORM, ORG, PUBLIC].includes(scope)) return;
    const orgId = scope === ORG ? clean(ref.orgId) : '';
    if (scope === ORG && !orgId) return;
    const version = setVersionOf(ref.version);
    const used = (counters.questions || 0) > 0 || (counters.sessions || 0) > 0;
    await bumpStatsRow(c, { PK: setStatsPk(scope, orgId), SK: setStatsSk(setId, version) }, counters, {
      setId, version, scope, ...(orgId ? { orgId } : {}), ...(used ? { lastAt: c.now.toISOString() } : {}),
    });
  } catch (error) {
    swallow('set stats', error);
  }
}

// ── The recorders ─────────────────────────────────────────────────────

/**
 * A host created a session. Call once, after the create succeeded.
 *
 * With a `gameId`, once per session: `StatsCreatedAt` on METADATA, written
 * only if absent. The type, team and creator come from the arguments, else
 * from one projected read of METADATA.
 */
async function recordSessionCreated({
  gameId, gameType, orgId, createdBy, metadata,
} = {}, opts = {}) {
  try {
    const c = ctx(opts);
    const id = clean(String(gameId || ''));
    if (!id) {
      await bumpMonth(c, { sessionsCreated: 1 });
      return { counted: true };
    }
    if (!await claimMarker(c, sessionKey(id), CREATED_MARKER)) return { counted: false, reason: 'already' };
    const given = gameType !== undefined || orgId !== undefined || createdBy !== undefined
      ? { GameType: gameType, orgId, CreatedBy: createdBy } : metadata;
    const facts = await sessionFacts(c, id, given);
    await Promise.all([
      bumpMonth(c, { sessionsCreated: 1 }),
      fanOut(c, facts, { created: 1 }),
    ]);
    return { counted: true };
  } catch (error) {
    return swallow('session created', error);
  }
}

/** A session left the lobby. Once per session, however many doors raced. */
async function recordSessionStarted({ gameId, metadata } = {}, opts = {}) {
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
    const facts = await sessionFacts(c, id, metadata);
    await Promise.all([
      bumpMonth(c, { sessionsStarted: 1 }),
      fanOut(c, facts, { started: 1 }),
    ]);
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
 * @param {object} [args.metadata]  the METADATA item the caller already read
 *                                  (type, team, creator for the usage stats)
 */
async function recordRoundServed({
  gameId, round, set, questionId, metadata,
} = {}, opts = {}) {
  try {
    const c = ctx(opts);
    const id = clean(String(gameId || ''));
    const n = Math.trunc(Number(round));
    if (!id || !Number.isFinite(n) || n < 1) return { counted: false, reason: 'no-round' };

    // Worked out ONCE per round, here, and kept on METADATA beside the marker
    // so the close (recordRoundClosed) counts the answers under it without
    // reading the question again.
    const bucket = await bucketForQuestion(c, {
      scope: set && set.scope,
      contentPk: set && set.pk,
      questionId,
    });

    let firstForSession;
    try {
      const res = await c.db.send(new UpdateCommand({
        TableName: c.tableName,
        Key: { PK: `GAME#${id}`, SK: 'METADATA' },
        UpdateExpression: 'SET #r = :n, #b = :bucket',
        ConditionExpression: 'attribute_exists(PK) AND (attribute_not_exists(#r) OR #r < :n)',
        ExpressionAttributeNames: { '#r': ROUNDS_MARKER, '#b': BUCKET_ATTR },
        ExpressionAttributeValues: { ':n': n, ':bucket': bucket },
        ReturnValues: 'UPDATED_OLD',
      }));
      const old = res && res.Attributes ? res.Attributes[ROUNDS_MARKER] : undefined;
      firstForSession = old === undefined;
    } catch (error) {
      if (isConditionFailure(error)) return { counted: false, reason: 'already' };
      throw error;
    }

    const facts = await sessionFacts(c, id, metadata);
    await Promise.all([
      bumpMonth(c, { roundsServed: 1, sessionsServed: firstForSession ? 1 : 0 }),
      bumpCategory(c, bucket, 'rounds'),
      fanOut(c, facts, { questions: 1 }),
      bumpSet(c, set, { questions: 1, sessions: firstForSession ? 1 : 0 }),
    ]);
    return { counted: true, firstForSession, library: bucket.library };
  } catch (error) {
    return swallow('round served', error);
  }
}

/**
 * The bucket a round's question belongs to, from its REF row — the fallback
 * for a round served before its bucket was kept on METADATA.
 */
async function bucketForRound(c, gameId, round) {
  const q = String(round).padStart(3, '0');
  const refRes = await c.db.send(new GetCommand({
    TableName: c.tableName,
    Key: { PK: `GAME#${gameId}`, SK: `QUESTION#${q}#REF` },
    ProjectionExpression: 'SourceQuestionId, SetId, SetScope, SetOrgId, SetVersion',
  }));
  const ref = (refRes && refRes.Item) || null;
  if (!ref) return bucketFor('', '');
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
  return bucketForQuestion(c, { scope, contentPk, questionId: ref.SourceQuestionId });
}

/**
 * A bucket kept on METADATA, re-derived rather than trusted: anything but a
 * platform or public bucket is the one unnamed teams' bucket.
 */
function keptBucket(stored) {
  if (!stored || typeof stored !== 'object') return null;
  if (stored.library === 'platform') return bucketFor(PLATFORM, stored.label);
  if (stored.library === 'public') return bucketFor(PUBLIC, stored.label);
  return bucketFor('', '');
}

/** How many answer rows round `round` holds: one per person who answered. */
async function countAnswers(c, gameId, round) {
  const prefix = `QUESTION#${String(round).padStart(3, '0')}#ANSWER#`;
  let total = 0;
  let ExclusiveStartKey;
  do {
    const page = await c.db.send(new QueryCommand({
      TableName: c.tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': `GAME#${gameId}`, ':sk': prefix },
      // COUNT: no answer row — a person's words, under their team's key —
      // enters this function. Only the number does.
      Select: 'COUNT',
      ExclusiveStartKey,
    }));
    total += Math.max(0, Math.trunc(Number(page && page.Count) || 0));
    ExclusiveStartKey = page && page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return total;
}

/**
 * next-question.js is moving the room on from round `round` — to the next
 * question or to the end. Count that round's answers, once.
 *
 * @param {object} args
 * @param {string} args.gameId
 * @param {number} args.round     the round being left (LessonNumber)
 * @param {object} [args.metadata] the METADATA item the caller already read;
 *                                 carries the round's kept bucket and markers
 */
async function recordRoundClosed({ gameId, round, metadata } = {}, opts = {}) {
  try {
    const c = ctx(opts);
    const id = clean(String(gameId || ''));
    const n = Math.trunc(Number(round));
    if (!id || !Number.isFinite(n) || n < 1) return { counted: false, reason: 'no-round' };
    const meta = metadata && typeof metadata === 'object' ? metadata : {};
    // The caller's own read already says whether this round was counted: a
    // repeat press costs nothing.
    if (Number(meta[ANSWERS_MARKER]) >= n) return { counted: false, reason: 'already' };

    // Count BEFORE claiming, so a failed count leaves the round unclaimed and
    // the next press can count it.
    const answers = await countAnswers(c, id, n);
    try {
      await c.db.send(new UpdateCommand({
        TableName: c.tableName,
        Key: { PK: `GAME#${id}`, SK: 'METADATA' },
        UpdateExpression: 'SET #a = :n',
        ConditionExpression: 'attribute_exists(PK) AND (attribute_not_exists(#a) OR #a < :n)',
        ExpressionAttributeNames: { '#a': ANSWERS_MARKER },
        ExpressionAttributeValues: { ':n': n },
      }));
    } catch (error) {
      if (isConditionFailure(error)) return { counted: false, reason: 'already' };
      throw error;
    }
    if (!answers) return { counted: true, answers: 0 };

    const kept = Number(meta[ROUNDS_MARKER]) === n ? keptBucket(meta[BUCKET_ATTR]) : null;
    const bucket = kept || await bucketForRound(c, id, n);
    await Promise.all([
      bumpMonth(c, { answersStored: answers }),
      bumpCategory(c, bucket, 'answers', answers),
    ]);
    return { counted: true, answers, library: bucket.library };
  } catch (error) {
    return swallow('round closed', error);
  }
}

// ── A survey: no rounds, so its own two moments ────────────────────────────
//
// A survey session never calls next-question — it opens (start-game.js) and
// closes (survey-host.js), and every question is in front of the room from the
// first moment to the last. Without these two it would read on the console as
// a session that served nothing and was answered by nobody.
// docs/design/survey-redesign/IMPLEMENTATION-phase-2.md, Track A "Metrics".

/**
 * start-game.js opened a survey: all of its questions are served at once.
 *
 * Once per session, on the SAME marker and condition as recordRoundServed —
 * `MetricsRoundsServed` raised to the question count — so a double-pressed
 * Open bounces, and the bucket is kept on METADATA for the close.
 *
 * @param {object} args
 * @param {string} args.gameId
 * @param {number} args.questions   how many questions the survey serves
 * @param {object} args.set         the pinned set: { scope, pk }
 * @param {string} args.questionId  one question's SK in that partition — the
 *                                  category it names is the survey's bucket
 * @param {object} [args.metadata]  the METADATA item the caller already read
 */
async function recordSurveyOpened({
  gameId, questions, set, questionId, metadata,
} = {}, opts = {}) {
  try {
    const c = ctx(opts);
    const id = clean(String(gameId || ''));
    const n = Math.trunc(Number(questions));
    if (!id || !Number.isFinite(n) || n < 1) return { counted: false, reason: 'no-questions' };

    const bucket = await bucketForQuestion(c, {
      scope: set && set.scope,
      contentPk: set && set.pk,
      questionId,
    });

    let firstForSession;
    try {
      const res = await c.db.send(new UpdateCommand({
        TableName: c.tableName,
        Key: { PK: `GAME#${id}`, SK: 'METADATA' },
        UpdateExpression: 'SET #r = :n, #b = :bucket',
        ConditionExpression: 'attribute_exists(PK) AND (attribute_not_exists(#r) OR #r < :n)',
        ExpressionAttributeNames: { '#r': ROUNDS_MARKER, '#b': BUCKET_ATTR },
        ExpressionAttributeValues: { ':n': n, ':bucket': bucket },
        ReturnValues: 'UPDATED_OLD',
      }));
      const old = res && res.Attributes ? res.Attributes[ROUNDS_MARKER] : undefined;
      firstForSession = old === undefined;
    } catch (error) {
      if (isConditionFailure(error)) return { counted: false, reason: 'already' };
      throw error;
    }

    const facts = await sessionFacts(c, id, metadata);
    await Promise.all([
      bumpMonth(c, { roundsServed: n, sessionsServed: firstForSession ? 1 : 0 }),
      bumpCategory(c, bucket, 'rounds', n),
      fanOut(c, facts, { questions: n }),
      bumpSet(c, set, { questions: n, sessions: firstForSession ? 1 : 0 }),
    ]);
    return { counted: true, firstForSession, library: bucket.library };
  } catch (error) {
    return swallow('survey opened', error);
  }
}

/**
 * survey-host.js closed a survey: count its answers, once.
 *
 * `answers` is the number of answers GIVEN — the sum over its questions of how
 * many people answered each, which is what one ANSWER# row per person per
 * question counts for a round. It comes from the frozen results, so nothing
 * here reads an answer row. Once, by `MetricsAnswersCounted`, which a survey
 * never otherwise writes.
 *
 * @param {object} args
 * @param {string} args.gameId
 * @param {number} args.answers    Σ per-question `n` from the aggregate
 * @param {object} [args.metadata] the METADATA item the caller already read
 */
async function recordSurveyClosed({ gameId, answers, metadata } = {}, opts = {}) {
  try {
    const c = ctx(opts);
    const id = clean(String(gameId || ''));
    if (!id) return { counted: false, reason: 'no-session' };
    const meta = metadata && typeof metadata === 'object' ? metadata : {};
    if (meta[ANSWERS_MARKER] !== undefined) return { counted: false, reason: 'already' };
    const total = Math.max(0, Math.trunc(Number(answers)) || 0);
    const mark = Math.max(1, Math.trunc(Number(meta[ROUNDS_MARKER])) || 1);

    try {
      await c.db.send(new UpdateCommand({
        TableName: c.tableName,
        Key: { PK: `GAME#${id}`, SK: 'METADATA' },
        UpdateExpression: 'SET #a = :n',
        ConditionExpression: 'attribute_exists(PK) AND attribute_not_exists(#a)',
        ExpressionAttributeNames: { '#a': ANSWERS_MARKER },
        ExpressionAttributeValues: { ':n': mark },
      }));
    } catch (error) {
      if (isConditionFailure(error)) return { counted: false, reason: 'already' };
      throw error;
    }
    if (!total) return { counted: true, answers: 0 };

    // The bucket the open kept; a survey has no REF rows to fall back to, so
    // one opened before this existed is the unnamed bucket — know less.
    const bucket = keptBucket(meta[BUCKET_ATTR]) || bucketFor('', '');
    await Promise.all([
      bumpMonth(c, { answersStored: total }),
      bumpCategory(c, bucket, 'answers', total),
    ]);
    return { counted: true, answers: total, library: bucket.library };
  } catch (error) {
    return swallow('survey closed', error);
  }
}

// ── Usage stats: the moments with no older counter (SPEC §5) ──────────────

/**
 * The session COUNTED — session-count.js, once the charge is decided (and for
 * an event's item, when the event's charge covers it). Once, by
 * `StatsCountedAt`.
 */
async function recordSessionCounted({ gameId, metadata } = {}, opts = {}) {
  try {
    const c = ctx(opts);
    const id = clean(String(gameId || ''));
    if (!id) return { counted: false, reason: 'no-session' };
    if (!await claimMarker(c, sessionKey(id), COUNTED_MARKER)) return { counted: false, reason: 'already' };
    await fanOut(c, await sessionFacts(c, id, metadata), { counted: 1 });
    return { counted: true };
  } catch (error) {
    return swallow('session counted', error);
  }
}

/**
 * A new player seat in a session — join-game.js, only after its conditional
 * put of the seat succeeded. A reconnect, a refresh or a handover reuses the
 * seat and never reaches here.
 */
async function recordParticipant({ gameId, metadata } = {}, opts = {}) {
  try {
    const c = ctx(opts);
    const id = clean(String(gameId || ''));
    if (!id) return { counted: false, reason: 'no-session' };
    await fanOut(c, await sessionFacts(c, id, metadata), { participants: 1 });
    return { counted: true };
  } catch (error) {
    return swallow('participant', error);
  }
}

/** Build Room: an ask put to the room. Once per ask id (`StatsAsks`). */
async function recordBuildAsk({ gameId, askId, metadata } = {}, opts = {}) {
  try {
    const c = ctx(opts);
    const id = clean(String(gameId || ''));
    const ask = clean(String(askId || ''));
    if (!id || !ask) return { counted: false, reason: 'no-ask' };
    if (!await claimInSet(c, sessionKey(id), ASKS_MARKER, ask)) return { counted: false, reason: 'already' };
    await fanOut(c, await sessionFacts(c, id, metadata), { questions: 1 });
    return { counted: true };
  } catch (error) {
    return swallow('build ask', error);
  }
}

/** Build Room: the host decided an ask. Once per ask id (`StatsDecided`). */
async function recordBuildDecision({ gameId, askId, metadata } = {}, opts = {}) {
  try {
    const c = ctx(opts);
    const id = clean(String(gameId || ''));
    const ask = clean(String(askId || ''));
    if (!id || !ask) return { counted: false, reason: 'no-ask' };
    if (!await claimInSet(c, sessionKey(id), DECIDED_MARKER, ask)) return { counted: false, reason: 'already' };
    await fanOut(c, await sessionFacts(c, id, metadata), { decisions: 1 });
    return { counted: true };
  } catch (error) {
    return swallow('build decision', error);
  }
}

/** Build Room: a crew task was created. Each create is a new task id. */
async function recordBuildTask({ gameId, metadata } = {}, opts = {}) {
  try {
    const c = ctx(opts);
    const id = clean(String(gameId || ''));
    if (!id) return { counted: false, reason: 'no-session' };
    await fanOut(c, await sessionFacts(c, id, metadata), { tasks: 1 });
    return { counted: true };
  } catch (error) {
    return swallow('build task', error);
  }
}

/**
 * A set was copied into a team's library (copy-question-set.js), counted on
 * the SOURCE set at the version copied — never on the copy.
 */
async function recordSetCopied({ set } = {}, opts = {}) {
  try {
    await bumpSet(ctx(opts), set, { copies: 1 });
    return { counted: true };
  } catch (error) {
    return swallow('set copied', error);
  }
}

/** A set was downloaded (download-question-set.js), at the version downloaded. */
async function recordSetDownloaded({ set } = {}, opts = {}) {
  try {
    await bumpSet(ctx(opts), set, { downloads: 1 });
    return { counted: true };
  } catch (error) {
    return swallow('set downloaded', error);
  }
}

/** An event was created (create-event.js, after its conditional put). */
async function recordEventCreated({ orgId, createdBy } = {}, opts = {}) {
  try {
    await fanOut(ctx(opts), { type: EVENT_TYPE, orgId, userId: createdBy }, { created: 1 });
    return { counted: true };
  } catch (error) {
    return swallow('event created', error);
  }
}

/** An event first went live (run.js). Once, by `StatsRunAt` on its METADATA. */
async function recordEventRun({
  code, orgId, createdBy,
} = {}, opts = {}) {
  try {
    const c = ctx(opts);
    let pk;
    try { pk = eventPk(code); } catch { return { counted: false, reason: 'no-event' }; }
    if (!await claimMarker(c, { PK: pk, SK: 'METADATA' }, RUN_MARKER)) return { counted: false, reason: 'already' };
    await fanOut(c, { type: EVENT_TYPE, orgId, userId: createdBy }, { started: 1 });
    return { counted: true };
  } catch (error) {
    return swallow('event run', error);
  }
}

/** A person registered for an event (attendee-store.js, after its conditional put). */
async function recordEventAttendee({ orgId, createdBy } = {}, opts = {}) {
  try {
    await fanOut(ctx(opts), { type: EVENT_TYPE, orgId, userId: createdBy }, { participants: 1 });
    return { counted: true };
  } catch (error) {
    return swallow('event attendee', error);
  }
}

// ── Usage stats: the daily snapshot (SPEC §6.2; admin/usage-reconcile.js) ──

/** Every page of a Query; the rows. */
async function queryEvery(c, input) {
  const items = [];
  let ExclusiveStartKey;
  do {
    const page = await c.db.send(new QueryCommand({ TableName: c.tableName, ...input, ExclusiveStartKey }));
    items.push(...((page && page.Items) || []));
    ExclusiveStartKey = page && page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

const emptyTypeMap = () => ({});
const addTo = (map, key, n = 1) => { map[key] = (map[key] || 0) + n; };

/**
 * One team's levels today: sessions not yet expired, by type and by creator,
 * and sets held, in total and by creator. Reads the team's session index and
 * set index — every attribute read is plaintext — and filters `ttl` in code,
 * because DynamoDB deletes up to ~48 h late and a row past its ttl is gone.
 */
async function readOrgLevels(c, orgId) {
  const nowSeconds = Math.floor(c.now.getTime() / 1000);
  const sessions = await queryEvery(c, {
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: { ':pk': gamesIndexPk(orgId), ':sk': 'GAME#' },
    ProjectionExpression: '#t, #c, #ttl',
    ExpressionAttributeNames: { '#t': 'GameType', '#c': 'CreatedBy', '#ttl': 'ttl' },
  });
  const sets = await queryEvery(c, {
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: { ':pk': setsMetadataPk(ORG, orgId), ':sk': 'SET#' },
    ProjectionExpression: '#c, #hold',
    ExpressionAttributeNames: { '#c': 'createdBy', '#hold': 'publicHold' },
  });
  const existing = emptyTypeMap();
  const byUser = new Map();
  const userOf = (sub) => {
    if (!byUser.has(sub)) byUser.set(sub, { existing: emptyTypeMap(), setsHeld: 0 });
    return byUser.get(sub);
  };
  for (const row of sessions) {
    // No ttl, or one already past: not kept (session-ttl.js gives every
    // session row one; a row without is pre-ttl and expires with nothing).
    if (!(Number(row.ttl) > nowSeconds)) continue;
    const type = statsType(row.GameType);
    addTo(existing, type);
    const sub = clean(row.CreatedBy);
    if (sub) addTo(userOf(sub).existing, type);
  }
  let setsHeld = 0;
  for (const row of sets) {
    if (row.publicHold !== undefined) continue; // usage.js countSets: a held public copy is not stored
    setsHeld += 1;
    const sub = clean(row.createdBy);
    if (sub) userOf(sub).setsHeld += 1;
  }
  return { existing, setsHeld, byUser };
}

/** SET one gauge row absolutely: a rerun writes the same thing. */
async function writeGauge(c, Key, { existing, setsHeld, period, extra = {} }) {
  const names = {
    '#e': 'existing', '#s': 'setsHeld', '#at': 'snapshotAt', '#p': 'period',
  };
  const values = {
    ':e': existing, ':s': setsHeld, ':at': c.now.toISOString(), ':p': period,
  };
  const sets = ['#e = :e', '#s = :s', '#at = :at', '#p = :p'];
  Object.entries(extra).forEach(([attr, value], i) => {
    names[`#x${i}`] = attr;
    values[`:x${i}`] = value;
    sets.push(`#x${i} = :x${i}`);
  });
  await c.db.send(new UpdateCommand({
    TableName: c.tableName,
    Key,
    UpdateExpression: `SET ${sets.join(', ')}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  }));
}

/**
 * Write one team's gauges for `periods` (this month, and on the 1st the month
 * just ended): the team row and one row per account. Returns the levels so
 * the caller can sum the platform row. THROWS — the daily job catches per org.
 */
async function snapshotOrgGauges(orgId, { periods } = {}, opts = {}) {
  const c = ctx(opts);
  const org = clean(orgId);
  if (!org) throw new Error('usage stats: a gauge needs an orgId');
  const levels = await readOrgLevels(c, org);
  const list = (periods && periods.length ? periods : [periodOf(c.now)]);
  for (const period of list) {
    await writeGauge(c, { PK: orgPk(org), SK: statsGaugeSk(period) }, { existing: levels.existing, setsHeld: levels.setsHeld, period });
    for (const [sub, mine] of levels.byUser) {
      await writeGauge(c, { PK: userPk(sub), SK: accountGaugeSk(period, org) }, {
        existing: mine.existing, setsHeld: mine.setsHeld, period, extra: { orgId: org },
      });
    }
  }
  return levels;
}

/** The platform's gauge: the sum of every team's, written last. */
async function writePlatformGauge({ periods, existing, setsHeld, teams } = {}, opts = {}) {
  const c = ctx(opts);
  const list = (periods && periods.length ? periods : [periodOf(c.now)]);
  for (const period of list) {
    await writeGauge(c, { PK: METRICS_PK, SK: platformGaugeSk(period) }, {
      existing: existing || {}, setsHeld: int(setsHeld), period, extra: { teams: int(teams) },
    });
  }
}

// ── Usage stats: reading it back (admin/ only) ────────────────────────────

const PERIOD_RE = /^\d{4}-\d{2}$/;

/** The counters a stats row holds, as integers, every key present. */
function countersOf(item) {
  const out = {};
  for (const k of STATS_COUNTERS) out[k] = int(item && item[k]);
  return out;
}

/**
 * Parse one stats SK, from any of the three scopes:
 *   { period, kind: 'type'|'gauge', type?, orgId? } or null.
 */
function parseStatsSk(sk) {
  const s = String(sk || '');
  let m = /^(?:STATS|MONTH)#(\d{4}-\d{2})#TYPE#([^#]+)(?:#ORG#(.+))?$/.exec(s);
  if (m) return { period: m[1], kind: 'type', type: m[2], ...(m[3] ? { orgId: m[3] === NO_ORG ? '' : m[3] } : {}) };
  m = /^(?:STATS|MONTH)#(\d{4}-\d{2})#GAUGE(?:#ORG#(.+))?$/.exec(s);
  if (m) return { period: m[1], kind: 'gauge', ...(m[2] ? { orgId: m[2] === NO_ORG ? '' : m[2] } : {}) };
  return null;
}

/**
 * Every stats row of one scope between two months (inclusive), paged.
 *
 * @param {'platform'|'team'|'account'} scope
 * @param {string} id   the orgId (team) or sub (account); ignored for platform
 * @returns {Promise<{ rows: object[], firstRecordedAt: string|null }>}
 *   rows: { period, kind, type?, orgId?, counters?, existing?, setsHeld?, snapshotAt? }
 */
async function readScopeStats(scope, id, { from, to } = {}, opts = {}) {
  const c = ctx(opts);
  let pk;
  let base;
  if (scope === 'platform') { pk = METRICS_PK; base = 'MONTH#'; }
  else if (scope === 'team') { pk = orgPk(id); base = 'STATS#'; }
  else if (scope === 'account') { pk = userPk(id); base = 'STATS#'; }
  else throw new Error(`usage stats: unknown scope ${JSON.stringify(scope)}`);
  if (scope !== 'platform' && !clean(id)) throw new Error('usage stats: which team or account?');
  const lo = PERIOD_RE.test(from || '') ? from : '0000-00';
  const hi = PERIOD_RE.test(to || '') ? to : '9999-99';
  // One month: its own prefix. A range: the scope's stats, filtered here.
  const prefix = lo === hi ? `${base}${lo}#` : base;
  const items = await queryEvery(c, {
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: { ':pk': pk, ':sk': prefix },
  });
  const rows = [];
  let firstRecordedAt = null;
  for (const item of items) {
    const parsed = parseStatsSk(item.SK);
    if (!parsed || parsed.period < lo || parsed.period > hi) continue;
    if (parsed.kind === 'type') {
      rows.push({ ...parsed, counters: countersOf(item) });
      const first = clean(item.firstRecordedAt);
      if (first && (!firstRecordedAt || first < firstRecordedAt)) firstRecordedAt = first;
    } else {
      const existing = {};
      for (const [k, v] of Object.entries(item.existing || {})) existing[k] = int(v);
      rows.push({ ...parsed, existing, setsHeld: int(item.setsHeld), snapshotAt: clean(item.snapshotAt) || null, ...(item.teams !== undefined ? { teams: int(item.teams) } : {}) });
    }
  }
  return { rows, firstRecordedAt };
}

/**
 * Sum the counters of type rows — "all types" is a sum on read, never a row
 * (SPEC §6.1). The `event` row is left out: its sessions already count under
 * their own types, and adding it would count them twice (SPEC §5).
 */
function sumCounters(rows) {
  const out = countersOf({});
  for (const row of rows || []) {
    if (!row || row.kind !== 'type' || row.type === EVENT_TYPE) continue;
    for (const k of STATS_COUNTERS) out[k] += int(row.counters && row.counters[k]);
  }
  return out;
}

/**
 * A library's set rows, or one set's (every version), paged. Ids and counts
 * only — never a title.
 */
async function readSetStats({ scope, orgId, setId } = {}, opts = {}) {
  const c = ctx(opts);
  const pk = setStatsPk(scope, scope === ORG ? orgId : '');
  const id = clean(setId);
  const items = await queryEvery(c, {
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: { ':pk': pk, ':sk': id ? `SET#${id}#V#` : 'SET#' },
  });
  return items.map((item) => {
    const m = /^SET#(.+)#V#(\d+)$/.exec(String(item.SK || ''));
    if (!m) return null;
    const out = { setId: m[1], version: Number(m[2]) };
    for (const k of SET_COUNTERS) out[k] = int(item[k]);
    out.firstAt = clean(item.firstRecordedAt) || null;
    out.lastAt = clean(item.lastAt) || null;
    return out;
  }).filter(Boolean);
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
  recordSessionCounted,
  recordParticipant,
  recordBuildAsk,
  recordBuildDecision,
  recordBuildTask,
  recordSetCopied,
  recordSetDownloaded,
  recordEventCreated,
  recordEventRun,
  recordEventAttendee,
  snapshotOrgGauges,
  writePlatformGauge,
  readScopeStats,
  readSetStats,
  parseStatsSk,
  sumCounters,
  countersOf,
  statsType,
  fanOut,
  bumpSet,
  STATS_TYPES,
  TYPE_ALIASES,
  STATS_COUNTERS,
  SET_COUNTERS,
  EVENT_TYPE,
  OTHER_TYPE,
  NO_ORG,
  statsTypeSk,
  accountTypeSk,
  platformTypeSk,
  statsGaugeSk,
  accountGaugeSk,
  platformGaugeSk,
  setStatsSk,
  CREATED_MARKER,
  COUNTED_MARKER,
  ASKS_MARKER,
  DECIDED_MARKER,
  RUN_MARKER,
  recordSessionCreated,
  recordSessionStarted,
  recordRoundServed,
  recordRoundClosed,
  recordSurveyOpened,
  recordSurveyClosed,
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
  ANSWERS_MARKER,
  BUCKET_ATTR,
};
