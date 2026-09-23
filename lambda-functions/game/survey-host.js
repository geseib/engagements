/**
 * THE HOST DRIVING A SURVEY.
 *
 *     POST /games/{gameId}/survey/close     freeze the results; SURVEY#CLOSED
 *     POST /games/{gameId}/survey/warning   "two minutes left", to every screen
 *     POST /games/{gameId}/survey/end       SURVEY#CLOSED → ENDED
 *     GET  /games/{gameId}/survey/progress  the live counts (the surveyProgress payload)
 *     GET  /games/{gameId}/survey/people    who finished / partway / not started
 *
 * docs/design/survey-redesign/IMPLEMENTATION-phase-2.md §2 is the contract.
 *
 * ── NOT PUBLIC, AND NOT MERELY SIGNED IN ────────────────────────────────────
 *
 * Every route carries the Cognito authorizer (template-clean.yaml), and every
 * one ALSO asks `callerMayDriveSession` on the session's own org — the pair
 * comments.js's feature route and stage-beat.js pay, for the same reason: the
 * id space is 9,000 four-digit codes. The guard alone lets a caller with no
 * groups through (tenant.js: the participant journey is never gated), so a
 * request with no authorizer context at all is refused here too. 404, never
 * 403, so a guessed code learns nothing.
 *
 * The two GETs need an explicit rule in auth/authorizer.js as well: its generic
 * "GET + games is public" rule would otherwise let any account in the pool —
 * one still `pending` — read who has and has not finished.
 *
 * ── CLOSE FREEZES, ONCE ─────────────────────────────────────────────────────
 *
 * STATE moves OPEN → CLOSED on a condition, so two presses race to one close.
 * From that instant no answer can land: every answer write carries a
 * ConditionCheck on STATE being OPEN (survey-answers.js). Then every answer row
 * of THIS session is read, page by page, opened, and counted by
 * survey-aggregate.js — the one function that counts a survey — into
 * SURVEY#RESULTS: self-contained (Names, OpenedAt, the pinned set) because
 * METADATA expires at start + 7 days and the results live 30. A close of a
 * survey already closed returns what was frozen and tells nobody again; a
 * close whose freeze never landed (the flip succeeded, the write did not)
 * freezes now — and so does `end`, so a survey never reaches ENDED without
 * its results.
 *
 * ── THE WORDS ARE PAGED ──────────────────────────────────────────────────────
 *
 * The words people wrote (open answers, write-ins, whys — the rows they came
 * from go at 7 days) do NOT ride on SURVEY#RESULTS. One item holding every
 * one of them, encrypted, passes DynamoDB's 400 KB limit at a few hundred
 * respondents, and then close fails on every press and nothing is ever
 * frozen. They go to SURVEY#RESULTS#TEXT#<qid>#<page>, each page cut by the
 * BYTES of its entries (TEXT_PAGE_BYTES), not by a count, each sealed under
 * the org's key, on the same Session and ttl. The main item names the pages
 * (`TextPages: {qid: count}`) and is written LAST, conditionally: its
 * existence means every page it names is there, so a reader that finds it may
 * trust them, and of two closes racing through the freeze only the one whose
 * write lands tells the room — the other hands back what that one froze.
 *
 * ── A BUSY STATE ROW ─────────────────────────────────────────────────────────
 *
 * Close, the warning and end are UpdateItems on STATE, and every answer in
 * flight holds STATE inside its transaction (survey-answers.js), so they can
 * be refused with TransactionConflictException while a room is answering.
 * That is retried with jittered backoff (survey-retry.js); a budget spent is
 * 503 {code:'BUSY'}, never a 500.
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand,
} = require('@aws-sdk/lib-dynamodb');

const { normalizeNames, SURVEY_OPEN, SURVEY_CLOSED } = require('./survey-names');
const { loadSurveyQuestions } = require('./survey-questions');
const { aggregate } = require('./survey-aggregate');
const { toAll } = require('./survey-broadcast');
const {
  RESP_PREFIX, DONE_PREFIX, RESULTS_SK, textPageSk,
  isSurvey, sessionOf, orgOf, readSession, queryAll, progressFor, respond,
} = require('./survey-rows');
const { encryptItem, decryptItems } = require('./tenant-crypto');
const { callerMayDriveSession } = require('./tenant');
const { ttlFrom } = require('./session-ttl');
const { recordSurveyClosed } = require('./platform-metrics');
const { uniquePlayerRecords } = require('./player-rows');
const { isPresent } = require('./player-presence');
const retry = require('./survey-retry');

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });
const TABLE = () => process.env.TABLE_NAME;

/** Frozen results are kept as long as the durable content tier: 30 days from close. */
const RESULTS_DAYS = 30;

/**
 * The most plaintext one text page carries, measured as the JSON the sealed
 * value is made from. Sealing is AES-GCM, base64'd: ×4/3 plus a few dozen
 * bytes, so 256 KB of words is ~342 KB on the table — under 400 KB with room
 * for the key and the stamps. A single entry is at most 2,000 characters
 * (survey-aggregate.js TEXT_CAP), so one always fits.
 */
const TEXT_PAGE_BYTES = 256 * 1024;

const notFound = () => respond(404, { error: 'Game not found' });
const busy = () => respond(503, { error: 'The survey is busy taking answers. Try again in a moment.', code: 'BUSY' });
const stateKey = (gameId) => ({ PK: `GAME#${gameId}`, SK: 'STATE' });
const isConditionFailure = (e) => Boolean(e && e.name === 'ConditionalCheckFailedException');

/**
 * What a close answers with: counts, never the words (those are on the text
 * pages). `perQuestion` is the SAME shape as the live progress —
 * `[{qid, answered}]` in survey order, every question, zeros included — so the
 * stage reads one shape before and after the close. `answered` is the frozen
 * `n`. The full per-kind counts stay on SURVEY#RESULTS for the results pages.
 */
const closeBody = (r) => {
  const per = r.PerQuestion || {};
  const order = Array.isArray(r.Order) && r.Order.length ? r.Order : Object.keys(per);
  return {
    n: r.N,
    finished: r.Finished,
    perQuestion: order.map((qid) => ({ qid, answered: Number(per[qid] && per[qid].n) || 0 })),
    closedAt: r.ClosedAt,
  };
};

/** This session's frozen results, as stored (counts only; the words are on the pages), or null. */
async function storedResults(gameId, meta) {
  const res = await db.send(new GetCommand({ TableName: TABLE(), Key: { PK: `GAME#${gameId}`, SK: RESULTS_SK }, ConsistentRead: true }));
  const item = res && res.Item;
  return item && item.Session === sessionOf(meta) ? item : null;
}

/** Cut one question's texts into pages of at most TEXT_PAGE_BYTES of JSON, in order. */
function pageTexts(entries) {
  const pages = [];
  let page = [];
  let bytes = 2; // the brackets
  for (const entry of entries) {
    const size = Buffer.byteLength(JSON.stringify(entry), 'utf8') + 1; // and its comma
    if (page.length && bytes + size > TEXT_PAGE_BYTES) {
      pages.push(page);
      page = [];
      bytes = 2;
    }
    page.push(entry);
    bytes += size;
  }
  if (page.length) pages.push(page);
  return pages;
}

/**
 * Write every question's texts as sealed pages; returns `{qid: pageCount}`.
 * Pages of a previous session on the same code are overwritten where the keys
 * meet and otherwise left to their ttl: nothing reads a page the main item
 * does not name, and a reader can check the page's Session besides.
 */
async function writeTextPages(gameId, orgId, texts, stamp) {
  const counts = {};
  for (const [qid, entries] of Object.entries(texts || {})) {
    if (!Array.isArray(entries) || !entries.length) continue;
    const pages = pageTexts(entries);
    for (let i = 0; i < pages.length; i += 1) {
      const item = {
        PK: `GAME#${gameId}`,
        SK: textPageSk(qid, i),
        Qid: qid,
        Page: i,
        Texts: pages[i],
        ...stamp,
      };
      await db.send(new PutCommand({
        TableName: TABLE(),
        Item: orgId ? await encryptItem(orgId, 'surveyResults', item) : item,
      }));
    }
    counts[qid] = pages.length;
  }
  return counts;
}

/**
 * Count every answer row of this session, write the text pages and then
 * SURVEY#RESULTS; tell the room. `closedAt` is STATE's, so a retried freeze
 * stamps the same moment.
 *
 * The main item's write is conditional — it may replace only a previous
 * session's results — so when two closes race through here only one lands.
 * That one records the metrics and broadcasts `surveyClosed`; the other
 * answers with what it wrote, and tells nobody.
 */
async function freeze(gameId, meta, closedAt) {
  const { questions, set } = await loadSurveyQuestions(db, TABLE(), meta);
  const session = sessionOf(meta);
  const orgId = orgOf(meta);
  const own = (await queryAll(db, TABLE(), gameId, RESP_PREFIX)).filter((r) => r.Session === session);
  const opened = orgId ? await decryptItems(orgId, 'surveyResponse', own) : own;
  // Only what the aggregate reads: the answers and whether they were sent.
  // The key, a Named row's name and the lock never reach it.
  const rows = opened.map((r) => ({
    Answers: r.Answers || {},
    Answered: Array.isArray(r.Answered) ? r.Answered : [],
    Complete: r.Complete === true,
  }));
  const counted = aggregate(questions, rows);

  const ttl = ttlFrom(closedAt, RESULTS_DAYS);
  const stamp = { ...(orgId ? { orgId } : {}), Session: session, ttl };
  // FIRST the pages, so the main item's existence means they are all there.
  const textPages = await writeTextPages(gameId, orgId, counted.Texts, stamp);

  const results = {
    PK: `GAME#${gameId}`,
    SK: RESULTS_SK,
    Version: 1,
    N: counted.N,
    Finished: counted.Finished,
    Order: counted.Order,
    PerQuestion: counted.PerQuestion,
    TextPages: textPages,
    ...(orgId ? { orgId } : {}),
    Names: normalizeNames(meta.Names),
    OpenedAt: meta.OpenedAt || null,
    ClosedAt: closedAt,
    Session: session,
    QuestionSetId: set.setId || meta.QuestionSetId || null,
    QuestionSetScope: set.scope || meta.QuestionSetScope || null,
    ...(set.version !== null && set.version !== undefined ? { QuestionSetVersion: set.version } : {}),
    ttl,
  };
  try {
    await db.send(new PutCommand({
      TableName: TABLE(),
      // No field of the main item is sealed now that the words are on the
      // pages; it still goes through the entity so a field added to it later
      // is sealed without anyone remembering to.
      Item: orgId ? await encryptItem(orgId, 'surveyResults', results) : results,
      ConditionExpression: 'attribute_not_exists(PK) OR #session <> :session',
      ExpressionAttributeNames: { '#session': 'Session' },
      ExpressionAttributeValues: { ':session': session },
    }));
  } catch (err) {
    if (!isConditionFailure(err)) throw err;
    // Another close froze this session a moment ago, from the same rows.
    const stored = await storedResults(gameId, meta);
    if (stored) return respond(200, closeBody(stored));
    throw err;
  }

  // Answers GIVEN — one per person per question, what one ANSWER# row is for
  // a round. Never throws (platform-metrics.js).
  const given = Object.values(counted.PerQuestion || {}).reduce((sum, q) => sum + (Number(q && q.n) || 0), 0);
  await recordSurveyClosed({ gameId, answers: given, metadata: meta }, { db });

  await toAll(db, TABLE(), gameId, {
    type: 'surveyClosed', gameId, newState: SURVEY_CLOSED, n: results.N, finished: results.Finished, closedAt,
  });
  return respond(200, closeBody(results));
}

// ────────────────────────────────────────────────────────── close ──────────

async function close(gameId, meta, state) {
  let current = state && state.State;
  let closedAt = state && state.ClosedAt;

  if (current === SURVEY_OPEN) {
    closedAt = new Date().toISOString();
    try {
      await retry.retryOnConflict(() => db.send(new UpdateCommand({
        TableName: TABLE(),
        Key: stateKey(gameId),
        UpdateExpression: 'SET #state = :closed, #closedAt = :at, #updatedAt = :at',
        ConditionExpression: '#state = :open',
        ExpressionAttributeNames: { '#state': 'State', '#closedAt': 'ClosedAt', '#updatedAt': 'UpdatedAt' },
        ExpressionAttributeValues: { ':closed': SURVEY_CLOSED, ':open': SURVEY_OPEN, ':at': closedAt },
      })));
      return await freeze(gameId, meta, closedAt);
    } catch (err) {
      if (!isConditionFailure(err)) throw err;
      // Another press closed it between our read and our write.
      ({ meta, state } = await readSession(db, TABLE(), gameId));
      current = state && state.State;
      closedAt = state && state.ClosedAt;
    }
  }

  if (current === SURVEY_CLOSED || current === 'ENDED') {
    const stored = await storedResults(gameId, meta);
    if (stored) return respond(200, closeBody(stored));
    return freeze(gameId, meta, closedAt || new Date().toISOString());
  }
  return respond(409, { error: 'This survey is not open.', code: 'NOT_OPEN', state: current || null });
}

// ──────────────────────────────────────────────────────── warning ──────────

async function warn(gameId, state) {
  if (!state || state.State !== SURVEY_OPEN) {
    return respond(409, { error: 'Only an open survey can be warned.', code: 'NOT_OPEN', state: (state && state.State) || null });
  }
  const warnedAt = new Date().toISOString();
  try {
    await retry.retryOnConflict(() => db.send(new UpdateCommand({
      TableName: TABLE(),
      Key: stateKey(gameId),
      // On STATE, so a phone or a stage that reloads inside the two minutes
      // still shows the warning (get-game / get-game-state / GET /survey).
      UpdateExpression: 'SET #warnedAt = :at',
      ConditionExpression: '#state = :open',
      ExpressionAttributeNames: { '#warnedAt': 'WarnedAt', '#state': 'State' },
      ExpressionAttributeValues: { ':at': warnedAt, ':open': SURVEY_OPEN },
    })));
  } catch (err) {
    if (!isConditionFailure(err)) throw err;
    return respond(409, { error: 'Only an open survey can be warned.', code: 'NOT_OPEN' });
  }
  await toAll(db, TABLE(), gameId, { type: 'surveyClosingSoon', gameId, minutes: 2, warnedAt });
  return respond(200, { warnedAt });
}

// ─────────────────────────────────────────────────────────── end ───────────

/**
 * CLOSED → ENDED — but never past a close whose freeze did not land. A close
 * can flip STATE and then fail to write the results (a 500, a timeout); the
 * next close would freeze, but a host who presses End instead would leave a
 * survey ENDED with its answers expiring at 7 days and nothing frozen. So the
 * results are looked for first, and frozen here if they are missing — with
 * STATE's own ClosedAt, as a retried close would.
 */
async function end(gameId, meta, state) {
  const current = state && state.State;
  if (current !== SURVEY_CLOSED && current !== 'ENDED') {
    return respond(409, { error: 'Close the survey before ending the session.', code: 'NOT_CLOSED', state: current || null });
  }
  if (!(await storedResults(gameId, meta))) {
    const frozen = await freeze(gameId, meta, (state && state.ClosedAt) || new Date().toISOString());
    if (frozen.statusCode !== 200) return frozen;
  }
  if (current === 'ENDED') return respond(200, { state: 'ENDED' });
  const now = new Date().toISOString();
  try {
    await retry.retryOnConflict(() => db.send(new UpdateCommand({
      TableName: TABLE(),
      Key: stateKey(gameId),
      UpdateExpression: 'SET #state = :ended, #endedAt = :at, #updatedAt = :at',
      ConditionExpression: '#state = :closed',
      ExpressionAttributeNames: { '#state': 'State', '#endedAt': 'EndedAt', '#updatedAt': 'UpdatedAt' },
      ExpressionAttributeValues: { ':ended': 'ENDED', ':closed': SURVEY_CLOSED, ':at': now },
    })));
  } catch (err) {
    if (!isConditionFailure(err)) throw err;
    // A second press that lost the race has nothing more to say.
    return respond(200, { state: 'ENDED' });
  }
  // Both pages already handle `gameEnded` (GameHostPage, PlayerPage).
  await toAll(db, TABLE(), gameId, { type: 'gameEnded', gameId, state: 'ENDED' });
  return respond(200, { state: 'ENDED' });
}

// ──────────────────────────────────────────────────────── progress ─────────

async function progress(gameId, meta) {
  const { questions } = await loadSurveyQuestions(db, TABLE(), meta);
  return respond(200, await progressFor(db, TABLE(), gameId, meta, questions));
}

// ────────────────────────────────────────────────────────── people ─────────

/**
 * By name, and nothing else: finished, partway or not-started. Who finished
 * reads the DONE list (which carries no respondent id); Named reads the
 * answer rows' Name and Complete, never their answers. Anonymous has no one to
 * list, by construction — 409.
 */
async function people(gameId, meta) {
  const names = normalizeNames(meta.Names);
  if (names === 'anonymous') {
    return respond(409, { error: 'An anonymous survey keeps no names.', code: 'ANONYMOUS' });
  }
  const session = sessionOf(meta);
  const status = new Map();
  if (names === 'finished') {
    const done = await queryAll(db, TABLE(), gameId, DONE_PREFIX);
    for (const d of done) {
      if (d.Session !== session || !d.Name) continue;
      status.set(d.Name, d.Status === 'finished' ? 'finished' : 'partway');
    }
  } else {
    const rows = await queryAll(db, TABLE(), gameId, RESP_PREFIX, {
      ProjectionExpression: '#name, #complete, #session',
      ExpressionAttributeNames: { '#name': 'Name', '#complete': 'Complete', '#session': 'Session' },
    });
    for (const r of rows) {
      if (r.Session !== session || !r.Name) continue;
      status.set(r.Name, r.Complete === true ? 'finished' : 'partway');
    }
  }
  // Everyone who joined THIS session and has not answered yet. A player row
  // older than the session is a previous session's on the same code. A player
  // the host REMOVED is not waited on (player-presence.js: counts about the
  // room right now drop them) — though anything they answered before leaving
  // still shows above, because it still counts.
  const joined = uniquePlayerRecords(await queryAll(db, TABLE(), gameId, 'PLAYER#'))
    .filter((p) => !p.JoinedAt || !meta.CreatedAt || p.JoinedAt >= meta.CreatedAt)
    .filter(isPresent)
    .map((p) => p.PlayerName || p.playerName)
    .filter(Boolean);
  for (const name of joined) if (!status.has(name)) status.set(name, 'not-started');

  const list = [...status.entries()]
    .map(([name, s]) => ({ name, status: s }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return respond(200, { people: list });
}

// ───────────────────────────────────────────────────────── handler ─────────

function routeOf(event) {
  const method = event.requestContext?.http?.method || event.httpMethod || '';
  const key = event.requestContext?.routeKey || event.routeKey || '';
  const p = key ? key.split(' ')[1] || '' : (event.rawPath || event.path || '');
  const m = /\/survey\/(close|warning|end|progress|people)$/.exec(p);
  if (!m) return null;
  const wants = { close: 'POST', warning: 'POST', end: 'POST', progress: 'GET', people: 'GET' }[m[1]];
  return method === wants ? m[1] : null;
}

exports.handler = async (event) => {
  const method = event.requestContext?.http?.method || event.httpMethod;
  if (method === 'OPTIONS') return respond(200, {});

  const { gameId } = event.pathParameters || {};
  if (!gameId) return respond(400, { error: 'gameId is required' });
  const route = routeOf(event);
  if (!route) return respond(404, { error: 'Not found' });

  try {
    const { meta, state } = await readSession(db, TABLE(), gameId);
    // No identity at all is a phone, and a phone drives nothing here.
    const claims = event?.requestContext?.authorizer?.jwt?.claims || event?.requestContext?.authorizer?.lambda;
    if (!meta || !claims || !callerMayDriveSession(event, meta) || !isSurvey(meta)) return notFound();

    if (route === 'close') return await close(gameId, meta, state);
    if (route === 'warning') return await warn(gameId, state);
    if (route === 'end') return await end(gameId, meta, state);
    if (route === 'progress') return await progress(gameId, meta);
    return await people(gameId, meta);
  } catch (error) {
    // STATE held by the answers in flight for the whole retry budget: busy,
    // not broken — the host presses again.
    if (retry.isConflictError(error)) return busy();
    console.error('❌ SURVEY HOST: error:', error);
    return respond(500, { error: 'Failed to handle the survey request' });
  }
};
