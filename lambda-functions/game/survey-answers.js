/**
 * A PHONE ANSWERING A SURVEY.
 *
 *     GET  /games/{gameId}/survey          the questions, and where the survey is
 *     PUT  /games/{gameId}/survey/answers  one answer: {qid, value}, autosaved
 *     POST /games/{gameId}/survey/submit   Send — marks this person's row complete
 *     POST /games/{gameId}/survey/mine     this person's own answers back (resume,
 *                                          while the survey is open)
 *
 * docs/design/survey-redesign/IMPLEMENTATION-phase-2.md §2 is the contract.
 *
 * ── PUBLIC, LIKE THE VOTE AND THE COMMENT ──────────────────────────────────
 *
 * Participants hold no Cognito identity, so these routes carry no authorizer
 * (comments.js's header argues it at length). The gate is not "who are you"
 * but "is this room collecting right now": STATE must be SURVEY#OPEN, and the
 * write itself re-checks that in the same transaction (see the PUT below). The
 * organisation comes off METADATA, never off the caller.
 *
 * `mine` IS A POST, not a GET: it carries a respondent id or a clientId, and
 * both are CAPABILITIES — what proves a row is yours — that must stay out of
 * URLs and access logs (the precedent is POST /games/get-results).
 *
 * ── WHOSE ROW: NAMES DECIDES, THE SERVER DERIVES ───────────────────────────
 *
 * The key is worked out here from METADATA.Names and never taken from the body:
 *
 *   anonymous  SURVEY#RESP#<respondentId> — `r_` + 22 base64url the PHONE made
 *              (128 bits) and keeps; never derived from the clientId, never a
 *              name. Nothing on the row says who it is.
 *   finished   the same row, plus SURVEY#DONE#<player> — a name and
 *              started/finished, with no respondent id — so writes also bring
 *              the player, checked against their own browser.
 *   named      SURVEY#RESP#<player name>, checked by the player's clientId:
 *              PLAYER#<name>.ClientId must be the caller's (a legacy row with no
 *              ClientId is accepted, as join-game.js accepts it). After a host
 *              handover the new browser's clientId is the one on the player row,
 *              so it reaches the same answers and the old browser does not.
 *
 * ── NO TIMESTAMPS WHERE A NAME IS NOT WRITTEN ─────────────────────────────
 *
 * In Anonymous and Who finished the answer row carries no UpdatedAt, no
 * StartedAt — a time on it would line up with DONE.FinishedAt and put a name
 * back on the answers (§5.2). Only Named, which writes the name anyway, keeps
 * StartedAt and CompletedAt. And nothing here logs a respondent id beside a
 * player name.
 *
 * ── THE PUT ───────────────────────────────────────────────────────────────
 *
 * Read METADATA+STATE → check the value against its question → read the row
 * strongly, open it, set one key, seal it → ONE TransactWriteItems: a
 * ConditionCheck that STATE is still SURVEY#OPEN, beside the Put conditioned on
 * the row's Rev (optimistic lock; up to three tries). The ConditionCheck is
 * what makes close final: an answer that read "open" and lands after the close
 * fails whole, rather than sitting in the row after the results were frozen
 * without it. Then: DONE "started" for a first answer in Who finished; the
 * billing counter (a survey bills at its second distinct answered question —
 * session-count.js, the game/ copy); and, only when WHO has answered WHAT
 * changed, the counts to the host's screens.
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient, GetCommand, PutCommand, TransactWriteCommand,
} = require('@aws-sdk/lib-dynamodb');

const { normalizeNames, SURVEY_OPEN, SURVEY_CLOSED } = require('./survey-names');
const { loadSurveyQuestions, toWire } = require('./survey-questions');
const { checkAnswer } = require('./survey-answer');
const { toHosts } = require('./survey-broadcast');
const {
  RESP_PREFIX, DONE_PREFIX, RESPONDENT_ID,
  isSurvey, sessionOf, orgOf, readSession, progressFor, respond,
} = require('./survey-rows');
const { encryptItem, decryptItem } = require('./tenant-crypto');
const { countAnsweredQuestion } = require('./session-count');

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });
const TABLE = () => process.env.TABLE_NAME;

const MAX_TRIES = 3;

/** A refusal the phone can act on: `code` is for the client, `error` for a person. */
const refuse = (statusCode, code, error, extra = {}) => respond(statusCode, { error, code, ...extra });

const notFound = () => respond(404, { error: 'Survey not found' });

/**
 * Is the room collecting? `null` when it is; otherwise the response.
 * CREATED is "not open yet", CLOSED/ENDED "closed" — two sentences a phone
 * shows differently.
 */
function collectingOr(state) {
  const s = state && state.State;
  if (s === SURVEY_OPEN) return null;
  if (s === SURVEY_CLOSED || s === 'ENDED') {
    return refuse(409, 'SURVEY_CLOSED', 'This survey has closed.', { state: s });
  }
  return refuse(409, 'NOT_OPEN', 'This survey is not open yet.', { state: s || null });
}

/** Has the survey been opened at all (anything after CREATED)? */
const opened = (state) => Boolean(state && state.State && state.State !== 'CREATED');

/** `{name, clientId}` off the body, or nulls. The name is used exactly as joined. */
function playerOf(body) {
  const p = body && body.player && typeof body.player === 'object' ? body.player : {};
  const name = typeof p.name === 'string' && p.name.trim() ? p.name : null;
  const clientId = typeof p.clientId === 'string' && p.clientId.trim() ? p.clientId.trim() : null;
  return { name, clientId };
}

/**
 * Is this browser the player it says it is? The PLAYER row's ClientId is the
 * proof (join-game.js stamps it; a handover moves it). A legacy row with no
 * ClientId is accepted, as join accepts it.
 */
async function isThatPlayer(gameId, { name, clientId }) {
  if (!name) return false;
  const res = await db.send(new GetCommand({
    TableName: TABLE(),
    Key: { PK: `GAME#${gameId}`, SK: `PLAYER#${name}` },
    ProjectionExpression: '#cid',
    ExpressionAttributeNames: { '#cid': 'ClientId' },
  }));
  const item = res && res.Item;
  if (!item) return false;
  if (!item.ClientId) return true;
  return Boolean(clientId) && item.ClientId === clientId;
}

/**
 * Whose row this request is about — `{ key, name?, doneName? }` — or a
 * response. `forWrite` asks for the player in Who finished (the DONE list is
 * written); reading your own row back needs only the respondent id.
 */
async function respondentFor(gameId, names, body, { forWrite }) {
  const player = playerOf(body);
  if (names === 'named') {
    if (!player.name) return { response: refuse(400, 'BAD_PLAYER', 'This survey keeps names: send player {name, clientId}.') };
    if (!(await isThatPlayer(gameId, player))) {
      return { response: refuse(403, 'NOT_YOU', 'These answers belong to someone else in this session.') };
    }
    return { key: player.name, name: player.name };
  }
  const rid = body && body.respondentId;
  if (typeof rid !== 'string' || !RESPONDENT_ID.test(rid)) {
    return { response: refuse(400, 'BAD_RESPONDENT', 'respondentId must be r_ followed by 22 letters, digits, - or _.') };
  }
  if (names === 'finished' && forWrite) {
    if (!player.name) return { response: refuse(400, 'BAD_PLAYER', 'This survey lists who finished: send player {name, clientId}.') };
    if (!(await isThatPlayer(gameId, player))) {
      return { response: refuse(403, 'NOT_YOU', 'That name belongs to someone else in this session.') };
    }
    return { key: rid, doneName: player.name };
  }
  return { key: rid };
}

const respKey = (gameId, key) => ({ PK: `GAME#${gameId}`, SK: `${RESP_PREFIX}${key}` });

/** The stored row for this person in THIS session, opened; null when there is none. */
async function readOwnRow(gameId, key, meta) {
  const res = await db.send(new GetCommand({ TableName: TABLE(), Key: respKey(gameId, key), ConsistentRead: true }));
  const raw = res && res.Item;
  if (!raw) return { raw: null, current: null };
  // A row from a previous session on this code is not this person's: it is
  // overwritten, never read back or added to.
  if (raw.Session !== sessionOf(meta)) return { raw, current: null };
  const orgId = orgOf(meta);
  const current = orgId ? await decryptItem(orgId, 'surveyResponse', raw) : raw;
  return { raw, current };
}

/** The qids answered, in the survey's own order. */
const answeredIn = (questions, answers) => questions.filter((q) => answers[q.qid] !== undefined).map((q) => q.qid);

/** The session's started ttl, as startSession wrote it — the only writer of one. */
const rowTtl = (meta, state) => (state && state.ttl) || (meta && meta.ttl) || undefined;

/**
 * Write one version of a person's row, but only while the survey is open and
 * only over the version that was read. Returns 'ok' | 'closed' | 'stale'.
 */
async function writeRow(gameId, meta, raw, item) {
  const orgId = orgOf(meta);
  const sealed = orgId ? await encryptItem(orgId, 'surveyResponse', item) : item;
  try {
    await db.send(new TransactWriteCommand({
      TransactItems: [
        {
          ConditionCheck: {
            TableName: TABLE(),
            Key: { PK: `GAME#${gameId}`, SK: 'STATE' },
            ConditionExpression: '#state = :open',
            ExpressionAttributeNames: { '#state': 'State' },
            ExpressionAttributeValues: { ':open': SURVEY_OPEN },
          },
        },
        {
          Put: {
            TableName: TABLE(),
            Item: sealed,
            ConditionExpression: 'attribute_not_exists(PK) OR #rev = :rev',
            ExpressionAttributeNames: { '#rev': 'Rev' },
            ExpressionAttributeValues: { ':rev': raw ? raw.Rev : 0 },
          },
        },
      ],
    }));
    return 'ok';
  } catch (err) {
    if (err && err.name === 'TransactionCanceledException') {
      const codes = (err.CancellationReasons || []).map((r) => r && r.Code);
      if (codes[0] === 'ConditionalCheckFailed') return 'closed';
      if (codes[1] === 'ConditionalCheckFailed') return 'stale';
    }
    throw err;
  }
}

/** The fields every version of a person's row carries, whatever else changes. */
function baseRow(gameId, who, meta, state, raw, current, now) {
  const item = {
    ...respKey(gameId, who.key),
    Rev: (raw && Number(raw.Rev)) ? Number(raw.Rev) + 1 : 1,
    Session: sessionOf(meta),
    ttl: rowTtl(meta, state),
  };
  // NAMED ONLY: the name, and when they started and sent. In the other two
  // modes a time on this row would re-link it to a name (see the header).
  if (who.name) {
    item.Name = who.name;
    item.StartedAt = (current && current.StartedAt) || now;
    if (current && current.CompletedAt) item.CompletedAt = current.CompletedAt;
  }
  return item;
}

async function announceProgress(gameId, meta, questions) {
  const payload = await progressFor(db, TABLE(), gameId, meta, questions);
  await toHosts(db, TABLE(), gameId, { type: 'surveyProgress', ...payload });
}

/** Who finished: the first answer puts the name on the list as "started". */
async function markStarted(gameId, meta, state, name) {
  try {
    await db.send(new PutCommand({
      TableName: TABLE(),
      Item: {
        PK: `GAME#${gameId}`, SK: `${DONE_PREFIX}${name}`,
        Name: name, Status: 'started', Session: sessionOf(meta), ttl: rowTtl(meta, state),
      },
      // Never over "finished", and never over this session's own row — but a
      // previous session's row on the same code is fair to replace.
      ConditionExpression: 'attribute_not_exists(PK) OR #session <> :session',
      ExpressionAttributeNames: { '#session': 'Session' },
      ExpressionAttributeValues: { ':session': sessionOf(meta) },
    }));
  } catch (err) {
    if (!err || err.name !== 'ConditionalCheckFailedException') {
      console.error('⚠️ SURVEY: could not mark a respondent started (continuing):', err && err.message);
    }
  }
}

// ─────────────────────────────────────────────────────────── GET ───────────

async function getSurvey(gameId) {
  const { meta, state } = await readSession(db, TABLE(), gameId);
  if (!isSurvey(meta)) return notFound();
  if (!opened(state)) return refuse(409, 'NOT_OPEN', 'This survey is not open yet.', { state: (state && state.State) || null });
  const { questions } = await loadSurveyQuestions(db, TABLE(), meta);
  return respond(200, {
    gameId,
    state: state.State,
    names: normalizeNames(meta.Names),
    openedAt: meta.OpenedAt || null,
    warnedAt: state.WarnedAt || null,
    questions: questions.map(toWire),
  });
}

// ─────────────────────────────────────────────────────────── PUT ───────────

async function putAnswer(gameId, body) {
  const { meta, state } = await readSession(db, TABLE(), gameId);
  if (!isSurvey(meta)) return notFound();
  const gate = collectingOr(state);
  if (gate) return gate;

  const names = normalizeNames(meta.Names);
  const who = await respondentFor(gameId, names, body, { forWrite: true });
  if (who.response) return who.response;

  const { questions } = await loadSurveyQuestions(db, TABLE(), meta);
  const qid = typeof body.qid === 'string' ? body.qid : '';
  const question = questions.find((q) => q.qid === qid);
  if (!question) return refuse(400, 'BAD_QID', 'That question is not in this survey.');
  if (!Object.prototype.hasOwnProperty.call(body, 'value')) {
    return refuse(400, 'BAD_VALUE', 'value is required — send null to clear an answer.');
  }
  const checked = checkAnswer(question, body.value);
  if (!checked.ok) return refuse(400, 'BAD_VALUE', checked.error);

  let before = null;
  let item = null;
  for (let attempt = 1; ; attempt += 1) {
    const now = new Date().toISOString();
    const { raw, current } = await readOwnRow(gameId, who.key, meta);
    // Clearing an answer nobody has given is nothing to write: no empty row,
    // no "started" on the wall, no DONE entry for a person who answered nothing.
    if (checked.value === null && !current) {
      return respond(200, { qid, saved: true, rev: 0, answered: 0, complete: false });
    }
    const answers = { ...((current && current.Answers) || {}) };
    if (checked.value === null) delete answers[qid];
    else answers[qid] = checked.value;
    before = {
      answered: (current && Array.isArray(current.Answered)) ? current.Answered : [],
      complete: Boolean(current && current.Complete === true),
      isNew: !current,
    };
    item = {
      ...baseRow(gameId, who, meta, state, raw, current, now),
      Answers: answers,
      Answered: answeredIn(questions, answers),
      Complete: before.complete,
    };
    const outcome = await writeRow(gameId, meta, raw, item);
    if (outcome === 'ok') break;
    if (outcome === 'closed') return collectingOr({ State: SURVEY_CLOSED });
    if (attempt >= MAX_TRIES) {
      return refuse(409, 'CONFLICT', 'Another save for this person landed at the same moment. Try again.');
    }
  }

  if (who.doneName && before.isNew) await markStarted(gameId, meta, state, who.doneName);
  if (checked.value !== null) await countAnsweredQuestion(db, TABLE(), gameId, qid, meta);
  const changed = before.isNew
    || before.complete !== item.Complete
    || before.answered.join('|') !== item.Answered.join('|');
  if (changed) await announceProgress(gameId, meta, questions);

  return respond(200, { qid, saved: true, rev: item.Rev, answered: item.Answered.length, complete: item.Complete });
}

// ───────────────────────────────────────────────────────── submit ──────────

async function submit(gameId, body) {
  const { meta, state } = await readSession(db, TABLE(), gameId);
  if (!isSurvey(meta)) return notFound();
  const gate = collectingOr(state);
  if (gate) return gate;

  const names = normalizeNames(meta.Names);
  const who = await respondentFor(gameId, names, body, { forWrite: true });
  if (who.response) return who.response;
  const { questions } = await loadSurveyQuestions(db, TABLE(), meta);

  let item = null;
  let wasComplete = false;
  for (let attempt = 1; ; attempt += 1) {
    const now = new Date().toISOString();
    const { raw, current } = await readOwnRow(gameId, who.key, meta);
    const answers = (current && current.Answers) || {};
    const missing = questions.filter((q) => q.required && answers[q.qid] === undefined).map((q) => q.qid);
    if (missing.length) {
      return respond(422, { error: 'Some required questions have no answer yet.', code: 'MISSING', missing });
    }
    wasComplete = Boolean(current && current.Complete === true);
    if (wasComplete) {
      item = current;
      break;
    }
    item = {
      ...baseRow(gameId, who, meta, state, raw, current, now),
      Answers: answers,
      Answered: answeredIn(questions, answers),
      Complete: true,
      ...(who.name ? { CompletedAt: now } : {}),
    };
    const outcome = await writeRow(gameId, meta, raw, item);
    if (outcome === 'ok') break;
    if (outcome === 'closed') return collectingOr({ State: SURVEY_CLOSED });
    if (attempt >= MAX_TRIES) {
      return refuse(409, 'CONFLICT', 'Another save for this person landed at the same moment. Try again.');
    }
  }

  if (!wasComplete) {
    if (who.doneName) {
      await db.send(new PutCommand({
        TableName: TABLE(),
        Item: {
          PK: `GAME#${gameId}`, SK: `${DONE_PREFIX}${who.doneName}`,
          Name: who.doneName, Status: 'finished', FinishedAt: new Date().toISOString(),
          Session: sessionOf(meta), ttl: rowTtl(meta, state),
        },
      }));
    }
    await announceProgress(gameId, meta, questions);
  }
  return respond(200, { complete: true, answered: (item.Answered || []).length });
}

// ──────────────────────────────────────────────────────────── mine ──────────

async function mine(gameId, body) {
  const { meta, state } = await readSession(db, TABLE(), gameId);
  if (!isSurvey(meta)) return notFound();
  // Resume is for a survey still collecting: once it has closed a phone is
  // told so (409, as the PUT and Send are), not handed answers to edit.
  const gate = collectingOr(state);
  if (gate) return gate;
  const names = normalizeNames(meta.Names);
  const who = await respondentFor(gameId, names, body, { forWrite: false });
  if (who.response) return who.response;
  const { current } = await readOwnRow(gameId, who.key, meta);
  if (!current) return respond(404, { error: 'No answers yet.', code: 'NO_ROW' });
  return respond(200, {
    answers: current.Answers || {},
    answered: Array.isArray(current.Answered) ? current.Answered : [],
    complete: current.Complete === true,
    rev: Number(current.Rev) || 0,
  });
}

// ───────────────────────────────────────────────────────── handler ─────────

/** 'get' | 'answers' | 'submit' | 'mine' | null, from the route template (or the path). */
function routeOf(event) {
  const method = event.requestContext?.http?.method || event.httpMethod || '';
  const key = event.requestContext?.routeKey || event.routeKey || '';
  const p = key ? key.split(' ')[1] || '' : (event.rawPath || event.path || '');
  if (method === 'GET' && /\/survey$/.test(p)) return 'get';
  if (method === 'PUT' && /\/survey\/answers$/.test(p)) return 'answers';
  if (method === 'POST' && /\/survey\/submit$/.test(p)) return 'submit';
  if (method === 'POST' && /\/survey\/mine$/.test(p)) return 'mine';
  return null;
}

exports.handler = async (event) => {
  const method = event.requestContext?.http?.method || event.httpMethod;
  if (method === 'OPTIONS') return respond(200, {});

  const { gameId } = event.pathParameters || {};
  if (!gameId) return respond(400, { error: 'gameId is required' });

  const route = routeOf(event);
  if (!route) return respond(404, { error: 'Not found' });

  try {
    if (route === 'get') return await getSurvey(gameId);
    let body = {};
    try {
      body = JSON.parse(event.body || '{}') || {};
    } catch {
      return respond(400, { error: 'Body must be JSON' });
    }
    if (typeof body !== 'object' || Array.isArray(body)) return respond(400, { error: 'Body must be a JSON object' });
    if (route === 'answers') return await putAnswer(gameId, body);
    if (route === 'submit') return await submit(gameId, body);
    return await mine(gameId, body);
  } catch (error) {
    console.error('❌ SURVEY: error:', error);
    return respond(500, { error: 'Failed to handle the survey request' });
  }
};
