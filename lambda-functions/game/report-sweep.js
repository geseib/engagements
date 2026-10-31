/**
 * THE AUTOMATIC REPORT SWEEP — every session that ran gets its report, even
 * when the host ran out of time and never made one.
 *
 * The owner, 2026-10-31: "make sure that all the reports get built at the end
 * of the session… if the session is run after that the reports get generated
 * for the completed items." Option A, approved.
 *
 * ── HOW IT RUNS (NO NEW RESOURCES) ─────────────────────────────────────────
 *
 * The stack is near CloudFormation's 500-resource ceiling, so there is no new
 * function and no new rule. The one schedule the stack already has —
 * UsageReconcileFunction's — now fires every 3 hours; usage-reconcile.js runs
 * its own daily job once a day inside that, and on every run invokes
 * CreateReportFunction asynchronously with `{ __reportSweep: true }`.
 * create-report.js hands that shape (unreachable over HTTP; see its
 * `isSweepInvocation`) to `runSweep` below. The sweep lives here, in game/,
 * because it builds through create-report's own `buildReport`, and the
 * bundler confines every function to its CodeUri folder (scripts/ci/
 * bundle-lambdas.js) — admin/ cannot require game/.
 *
 * ── WHICH SESSIONS ─────────────────────────────────────────────────────────
 *
 * Every row of the global reservation list (PK=GAMES, paged), skipping event
 * codes. A session is due when ALL of:
 *   - it STARTED (METADATA.Started, or STATE past CREATED). Never-started
 *     sessions have nothing to report;
 *   - it has NO index row (`REPORT#<game>` in its org's REPORTS partition):
 *     a host who saved a PDF, or an earlier sweep, already made it;
 *   - its ttl has not passed (rows may already be half-deleted);
 *   - it was active in the last 10 days. A started session lives 7, so this
 *     only excludes the legacy rows from before session ttls (2026-09-21) and
 *     the 90-day rows a start that missed its ttl rewrite left behind: their
 *     answers expired long ago, and a first run must not ring a bell for every
 *     session ever played;
 *   - and ONE of: STATE ENDED more than 24h ago; idle more than 12h by its
 *     last activity; or less than 48h before its ttl. An open survey is not
 *     "idle" — answers do not touch STATE — so only the 48h rule takes it;
 *     a closed one counts from its close.
 *
 * ── PER SESSION ────────────────────────────────────────────────────────────
 *
 *   1. CLAIM. A conditional update of `GAME#<id> / AUTOREPORT` (this sweep's
 *      own marker row, ttl = the session's): taken only when nobody holds a
 *      fresh claim and the report is not already built. Two runs never both
 *      build.
 *   2. RETRY WORKIE ONCE. A round that reached RESULTS without a read (a read
 *      that failed is never retried at close) gets one more, through the
 *      same claimSummaryJob + async get-ai-summary worker get-results starts.
 *      Rounds that never closed get no AI. A round retried is recorded on the
 *      marker and never retried again. When a retry started, the build waits
 *      for the next run (3h later) so the read can land — unless the session
 *      is inside its last 6 hours, when it builds now.
 *   3. BUILD through create-report's `buildReport` — the same decryption, the
 *      same report, sealed under the SESSION's org — with a 90-day ttl on the
 *      stored report rows.
 *   4. INDEX ROW `REPORT#<game>` with `auto: true, pdf: false`, a 90-day ttl
 *      and `Covers` (completed rounds, rounds opened but not run). Written
 *      only if absent: a PDF the host saved meanwhile wins.
 *   5. BELL for the host who created it ('report.auto', to Reports).
 *
 * A failure releases the claim and the next run tries again. Still unbuilt
 * 24h before expiry → one 'report.failed' bell.
 */
const { GetCommand, PutCommand, QueryCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const {
  GAMES_RESERVATION_PK, reportsIndexPk,
} = require('./tenant');
const { encryptItem } = require('./tenant-crypto');
const { claimSummaryJob } = require('./summary-job');
const notifications = require('./notifications');

const HOUR = 60 * 60 * 1000;
const DAY_S = 24 * 60 * 60;

const ENDED_GRACE_MS = 24 * HOUR;
const IDLE_MS = 12 * HOUR;
const BEFORE_EXPIRY_MS = 48 * HOUR;
/** Older than this, a session is history, not a session that just finished. */
const STALE_MS = 10 * 24 * HOUR;
/** Inside this, a pending Workie retry no longer delays the build. */
const BUILD_NOW_MS = 6 * HOUR;
/** Inside this, a report still unbuilt gets one 'report.failed' bell. */
const FAIL_NOTICE_MS = 24 * HOUR;
/** A claim this old belongs to a run that died. */
const CLAIM_MS = 15 * 60 * 1000;
const AUTO_RETENTION_DAYS = 90;
/** Leave time inside the function's 300s for the run in hand. */
const RUN_BUDGET_MS = 240 * 1000;
const MAX_BUILDS_PER_RUN = 40;

const MARKER_SK = 'AUTOREPORT';
const SURVEY_OPEN = 'SURVEY#OPEN';
const SURVEY_CLOSED = 'SURVEY#CLOSED';

const TABLE = () => process.env.TABLE_NAME;
const clean = (v) => (typeof v === 'string' ? v.trim() : '');
const ms = (iso) => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? t : 0; };
const pad = (n) => String(n).replace(/\D/g, '').padStart(3, '0');

const isConditionFailure = (error) => !!error && (error.name === 'ConditionalCheckFailedException'
  || error.__type === 'com.amazonaws.dynamodb.v20120810#ConditionalCheckFailedException');

async function queryAll(db, params) {
  const out = [];
  let ExclusiveStartKey;
  do {
    // eslint-disable-next-line no-await-in-loop
    const res = await db.send(new QueryCommand({ ...params, ...(ExclusiveStartKey ? { ExclusiveStartKey } : {}) }));
    out.push(...((res && res.Items) || []));
    ExclusiveStartKey = res && res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return out;
}

const getItem = async (db, PK, SK) => {
  const res = await db.send(new GetCommand({ TableName: TABLE(), Key: { PK, SK } }));
  return (res && res.Item) || null;
};

/** Did this session ever start? */
function hasStarted(meta, state) {
  if (meta && meta.Started === true) return true;
  const s = clean(state && state.State);
  return !!s && s !== 'CREATED';
}

/** The latest thing that happened in the session, epoch ms (0 when nothing says). */
function lastActivity(meta, state) {
  return Math.max(
    ms(state && state.UpdatedAt), ms(state && state.EndedAt), ms(state && state.ClosedAt),
    ms(state && state.StartedAt), ms(meta && meta.LastPlayedAt), ms(meta && meta.OpenedAt),
  );
}

/**
 * Is the session due for its automatic report? Pure: everything it needs is
 * passed in. `ttl` is epoch seconds (the session's, from METADATA).
 *
 * @returns {false|'ended'|'idle'|'expiring'}
 */
function dueReason({ meta, state, ttl, now }) {
  const t = now.getTime();
  const ttlMs = Number(ttl) > 0 ? Number(ttl) * 1000 : 0;
  if (ttlMs && ttlMs <= t) return false; // already expired: rows may be half gone
  if (!hasStarted(meta, state)) return false;
  const latest = lastActivity(meta, state);
  if (!latest || t - latest > STALE_MS) return false;
  const current = clean(state && state.State);
  if (current === 'ENDED') {
    const endedAt = ms(state.EndedAt) || ms(state.UpdatedAt);
    if (endedAt && t - endedAt > ENDED_GRACE_MS) return 'ended';
  }
  // An open survey is collecting answers that never touch STATE.
  const surveyOpen = meta && meta.GameType === 'survey' && current === SURVEY_OPEN;
  if (!surveyOpen) {
    const last = lastActivity(meta, state);
    if (last && t - last > IDLE_MS) return 'idle';
  }
  if (ttlMs && ttlMs - t < BEFORE_EXPIRY_MS) return 'expiring';
  return false;
}

/**
 * Which rounds finished, and which were opened but never closed.
 *
 * COMPLETED: a `QUESTION#nnn#RESULTS` row or a `ROUND#nnn` record with
 * ResultsShownAt (get-results.js enterResultsState). A survey's one
 * pseudo-round, 000, is complete once the survey is closed.
 * NOT RUN: numbers up to the furthest round the session opened (STATE's
 * CurrentQuestionId, a REF row) that never reached results. Rounds a set held
 * but the session never opened cannot be told apart from rounds it never
 * meant to play, and are not listed.
 */
function roundsOf({ meta, state, rows }) {
  if (meta && meta.GameType === 'survey') {
    const current = clean(state && state.State);
    const closed = current === SURVEY_CLOSED || current === 'ENDED';
    return { completed: closed ? ['000'] : [], notRun: closed ? [] : ['000'] };
  }
  const completed = new Set();
  const opened = new Set();
  for (const row of rows) {
    const sk = String(row.SK || '');
    let m = /^QUESTION#(\d+)#RESULTS$/.exec(sk);
    if (m) { completed.add(pad(m[1])); continue; }
    m = /^ROUND#(\d+)$/.exec(sk);
    if (m && row.ResultsShownAt) { completed.add(pad(m[1])); continue; }
    m = /^QUESTION#(\d+)#REF$/.exec(sk);
    if (m) opened.add(pad(m[1]));
  }
  let furthest = Number(String((state && state.CurrentQuestionId) || '').replace(/\D/g, '')) || 0;
  for (const n of [...completed, ...opened]) furthest = Math.max(furthest, Number(n));
  const notRun = [];
  for (let i = 1; i <= furthest; i += 1) if (!completed.has(pad(i))) notRun.push(pad(i));
  return { completed: [...completed].sort(), notRun };
}

/** Completed rounds with no stored Workie read, not already retried by the sweep. */
function roundsNeedingRead({ meta, rows, completed, retried = [] }) {
  if (meta && meta.GameType === 'build') return [];
  const have = new Set(rows
    .map((r) => /^QUESTION#(\d+)#AISummary$/.exec(String(r.SK || '')))
    .filter(Boolean).map((m) => pad(m[1])));
  const done = new Set((retried || []).map(pad));
  return completed.filter((n) => !have.has(n) && !done.has(n));
}

/** Take the session's sweep claim. Returns the token, or null. */
async function claim(db, { gameId, ttl, now, token }) {
  try {
    const res = await db.send(new UpdateCommand({
      TableName: TABLE(),
      Key: { PK: `GAME#${gameId}`, SK: MARKER_SK },
      UpdateExpression: 'SET #tok = :tok, #until = :until, #ttl = :ttl, #att = if_not_exists(#att, :zero) + :one',
      ConditionExpression: 'attribute_not_exists(#built) AND (attribute_not_exists(#until) OR #until < :now)',
      ExpressionAttributeNames: {
        '#tok': 'ClaimToken', '#until': 'ClaimedUntil', '#ttl': 'ttl', '#att': 'Attempts', '#built': 'BuiltAt',
      },
      ExpressionAttributeValues: {
        ':tok': token, ':until': now.getTime() + CLAIM_MS, ':now': now.getTime(),
        ':ttl': Number(ttl) > 0 ? Number(ttl) + 2 * DAY_S : Math.floor(now.getTime() / 1000) + 7 * DAY_S,
        ':zero': 0, ':one': 1,
      },
      ReturnValues: 'ALL_NEW',
    }));
    return (res && res.Attributes) || { ClaimToken: token };
  } catch (error) {
    if (isConditionFailure(error)) return null;
    throw error;
  }
}

/** Update the marker while this run holds it. Never throws past a lost claim. */
async function updateMarker(db, { gameId, token, set }) {
  const names = { '#tok': 'ClaimToken' };
  const values = { ':tok': token };
  const parts = [];
  Object.entries(set).forEach(([k, v], i) => {
    names[`#f${i}`] = k;
    values[`:v${i}`] = v;
    parts.push(`#f${i} = :v${i}`);
  });
  try {
    await db.send(new UpdateCommand({
      TableName: TABLE(),
      Key: { PK: `GAME#${gameId}`, SK: MARKER_SK },
      UpdateExpression: `SET ${parts.join(', ')}`,
      ConditionExpression: '#tok = :tok',
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }));
    return true;
  } catch (error) {
    if (isConditionFailure(error)) return false;
    throw error;
  }
}

/** Start one Workie read the way get-results.js does at close. Returns true if started. */
async function retryRead(db, lambda, { gameId, padded }) {
  const functionName = process.env.AI_SUMMARY_FUNCTION_NAME;
  if (!functionName || !lambda) return false;
  const jobId = await claimSummaryJob(db, { gameId, padded, unlessWritten: true });
  if (!jobId) return false;
  const { InvokeCommand } = require('@aws-sdk/client-lambda');
  await lambda.send(new InvokeCommand({
    FunctionName: functionName,
    InvocationType: 'Event',
    Payload: Buffer.from(JSON.stringify({
      __workerMode: true, gameId, questionId: padded, paddedQuestionNumber: padded, jobId,
    })),
  }));
  return true;
}

const reportLink = (orgId) => ({ type: 'section', section: 'reports', ...(orgId ? { orgId } : {}) });

/**
 * Sweep one session. Returns what happened, for the run's log and the tests:
 * 'built' | 'deferred' | 'skipped' | 'claimed-elsewhere' | 'failed' | 'saved-meanwhile'.
 */
async function sweepSession(db, deps, { gameId, meta, state, now }) {
  const { buildReport, lambda } = deps;
  const orgId = clean(meta.orgId);
  const ttl = Number(meta.ttl) || 0;
  const token = `${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

  const marker = await claim(db, { gameId, ttl, now, token });
  if (!marker) return 'claimed-elsewhere';

  const ttlMs = ttl * 1000;
  const left = ttlMs ? ttlMs - now.getTime() : Infinity;
  const creator = clean(meta.CreatedBy);
  try {
    const rows = await queryAll(db, {
      TableName: TABLE(),
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': `GAME#${gameId}` },
      ProjectionExpression: 'PK, SK, ResultsShownAt',
    });
    const covers = roundsOf({ meta, state, rows });

    // 2. One more Workie read for each round that closed without one.
    const retried = Array.isArray(marker.SummaryRetried) ? marker.SummaryRetried : [];
    const need = roundsNeedingRead({ meta, rows, completed: covers.completed, retried });
    let started = 0;
    for (const padded of need) {
      try {
        // eslint-disable-next-line no-await-in-loop
        if (await retryRead(db, lambda, { gameId, padded })) started += 1;
      } catch (error) {
        console.error(`⚠️ report-sweep: ${gameId}:${padded} Workie retry not started: ${error && error.message}`);
      }
    }
    if (need.length) {
      await updateMarker(db, { gameId, token, set: { SummaryRetried: [...new Set([...retried, ...need])] } });
    }
    if (started > 0 && left > BUILD_NOW_MS) {
      // Let the reads land; the next run (3h) builds.
      await updateMarker(db, { gameId, token, set: { ClaimedUntil: 0 } });
      return 'deferred';
    }

    // 3. The report, through create-report's own builder.
    const reportExpires = Math.floor(now.getTime() / 1000) + AUTO_RETENTION_DAYS * DAY_S;
    const report = await buildReport(gameId, { ttlSeconds: reportExpires });
    if (!report) throw new Error('the session has no METADATA');

    // 4. The index row, only if the host has not saved one meanwhile.
    const savedAt = now.toISOString();
    const row = {
      PK: reportsIndexPk(orgId),
      SK: `REPORT#${gameId}`,
      gameId,
      Title: report.gameTitle || 'Untitled session',
      ...(orgId ? { orgId } : {}),
      auto: true,
      pdf: false,
      encrypted: !!orgId,
      permanent: false,
      savedAt,
      expiresAt: new Date(reportExpires * 1000).toISOString(),
      GameType: meta.GameType || null,
      ...(meta.EventRef ? { EventRef: String(meta.EventRef), EventItem: meta.EventItem || '' } : {}),
      ...(creator ? { CreatedBy: creator } : {}),
      Covers: covers,
      ttl: reportExpires,
    };
    let outcome = 'built';
    try {
      await db.send(new PutCommand({
        TableName: TABLE(),
        Item: orgId ? await encryptItem(orgId, 'reportIndex', row) : row,
        ConditionExpression: 'attribute_not_exists(PK)',
      }));
    } catch (error) {
      if (!isConditionFailure(error)) throw error;
      outcome = 'saved-meanwhile';
    }
    await updateMarker(db, { gameId, token, set: { BuiltAt: savedAt, ClaimedUntil: 0 } });

    // 5. The bell.
    if (outcome === 'built' && creator) {
      await notifications.notify(db, {
        sub: creator,
        key: `report#${gameId}`,
        kind: notifications.KINDS.REPORT_AUTO,
        orgId,
        title: `Your report for ${report.gameTitle || `session ${gameId}`} is ready`,
        body: 'Built automatically when the session finished. Open it in Reports to make the PDF.',
        link: reportLink(orgId),
        expiresAt: reportExpires,
      }, { now });
    }
    return outcome;
  } catch (error) {
    console.error(`❌ report-sweep: ${gameId} not built (attempt ${marker.Attempts || 1}): ${error && error.message}`);
    const set = { ClaimedUntil: 0, LastError: String((error && error.message) || error).slice(0, 200) };
    if (left <= FAIL_NOTICE_MS && !marker.FailedNotifiedAt) {
      if (creator) {
        await notifications.notify(db, {
          sub: creator,
          key: `report#${gameId}`,
          kind: notifications.KINDS.REPORT_FAILED,
          orgId,
          title: `The report for session ${gameId} could not be built`,
          body: 'The session expires within a day. Open it and save its report now if you need it.',
          link: reportLink(orgId),
          expiresAt: ttl || null,
        }, { now });
      }
      set.FailedNotifiedAt = now.toISOString();
    }
    await updateMarker(db, { gameId, token, set }).catch(() => false);
    return 'failed';
  }
}

/**
 * One sweep over every session. `deps` are injectable for tests:
 * buildReport (create-report.js's), lambda (a LambdaClient).
 */
async function runSweep({ db, now = new Date(), deps = {} } = {}) {
  const started = Date.now();
  const buildReport = deps.buildReport || require('./create-report').buildReport;
  let lambda = deps.lambda;
  if (lambda === undefined && process.env.AI_SUMMARY_FUNCTION_NAME) {
    const { LambdaClient } = require('@aws-sdk/client-lambda');
    lambda = new LambdaClient({});
  }
  const tally = {};
  const count = (k) => { tally[k] = (tally[k] || 0) + 1; };

  const reservations = await queryAll(db, {
    TableName: TABLE(),
    KeyConditionExpression: 'PK = :pk',
    ExpressionAttributeValues: { ':pk': GAMES_RESERVATION_PK },
  });
  let attempted = 0;
  for (const res of reservations) {
    if (Date.now() - started > RUN_BUDGET_MS || attempted >= MAX_BUILDS_PER_RUN) { count('left-for-next-run'); continue; }
    const gameId = String(res.SK || '').replace(/^GAME#/, '');
    if (!/^\d+$/.test(gameId) || res.Kind === 'event') continue;
    try {
      // eslint-disable-next-line no-await-in-loop
      const meta = await getItem(db, `GAME#${gameId}`, 'METADATA');
      if (!meta) { count('no-session'); continue; }
      // eslint-disable-next-line no-await-in-loop
      const state = await getItem(db, `GAME#${gameId}`, 'STATE');
      const reason = dueReason({ meta, state, ttl: meta.ttl || res.ttl, now });
      if (!reason) { count('not-due'); continue; }
      // eslint-disable-next-line no-await-in-loop
      const marker = await getItem(db, `GAME#${gameId}`, MARKER_SK);
      if (marker && marker.BuiltAt) { count('already-built'); continue; }
      // eslint-disable-next-line no-await-in-loop
      const indexed = await getItem(db, reportsIndexPk(clean(meta.orgId)), `REPORT#${gameId}`);
      if (indexed) { count('has-report'); continue; }
      attempted += 1;
      // eslint-disable-next-line no-await-in-loop
      count(await sweepSession(db, { buildReport, lambda }, { gameId, meta, state, now }));
    } catch (error) {
      count('error');
      console.error(`⚠️ report-sweep: ${gameId} skipped: ${error && error.message}`);
    }
  }
  console.log(`🧾 report-sweep: ${reservations.length} sessions read`, JSON.stringify(tally));
  return { sessions: reservations.length, ...tally };
}

module.exports = {
  runSweep,
  sweepSession,
  dueReason,
  roundsOf,
  roundsNeedingRead,
  hasStarted,
  lastActivity,
  MARKER_SK,
  AUTO_RETENTION_DAYS,
  ENDED_GRACE_MS,
  IDLE_MS,
  BEFORE_EXPIRY_MS,
  STALE_MS,
  FAIL_NOTICE_MS,
  BUILD_NOW_MS,
};
