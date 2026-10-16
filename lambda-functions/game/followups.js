/**
 * CALL & ANSWER FOLLOW-UP ASKS: THE ROUTES (docs/design/ca-followup-asks SPEC §6,
 * reworked by docs/design/followup-icons: Ideas / Choose / Rate, anchored to the read).
 *
 * Served by the comments function (comments.js hands these paths here): the
 * feature replaces "Request feedback" with comments kept inside it, and the
 * stack is near its resource limit, so no new Lambda. Two proxy families:
 *
 *   THE HOST — Cognito, then callerMayDriveSession on the session's own org
 *   (404 on refusal, never 403: a guessed four-digit code learns nothing).
 *     GET  /games/{id}/followups/round/{nnn}       the round's suggestions (with `why`
 *                                                  and marks) and every ask with its count
 *     GET  /games/{id}/followups/rounds            every round's suggestions — the
 *                                                  measurement read (PLAN T8)
 *     POST /games/{id}/followups/send              send one ask
 *     POST /games/{id}/followups/asks/{askId}/close    freeze the count
 *     POST /games/{id}/followups/asks/{askId}/cancel
 *     POST /games/{id}/followups/asks/{askId}/pick     an Ideas answer on or off the wall
 *
 *   THE PHONES — public, as /comments and /votes are: participants hold no
 *   token. The gate is comments.js writeComment's, exactly.
 *     GET  /games/{id}/followup-play/live          the round's current ask: kind, words,
 *                                                  options; after close, the counts
 *     POST /games/{id}/followup-play/asks/{askId}/answer
 *                                                  on time while live; after "Show
 *                                                  results" or once the round moved
 *                                                  on, kept LATE (session flow v3
 *                                                  §4.4) and never counted
 *
 * Remaking the suggestions is the read's own worker, on the host's
 * GET /games/{id}/ai-summary/host?followUps=suggest — it has the model grants,
 * the time and the round's material; this function has none of them.
 *
 * SWITCHED OFF, NOTHING. While FOLLOWUP_ASKS_ENABLED is not `on` for the tier
 * (dev only, for now) every route answers 404, as an unknown path does.
 *
 * THE `ask` BEAT. Sending sets the round's beat to `ask` (stage-beats.js), so
 * every screen moves to the question; cancelling returns it to `field-notes`;
 * closing keeps it, and every screen shows the results. The generic
 * /stage-beat route refuses `ask`: only a sent question opens it.
 *
 * NOTIFY, THEN REFETCH. Every write broadcasts `followUpChanged` with where
 * something changed and never the words.
 */
const { GetCommand } = require('@aws-sdk/lib-dynamodb');
const { callerMayDriveSession } = require('./tenant');
const { isCallAndAnswer } = require('./briefing');
const { resolveBeat } = require('./stage-beats');
const { pollAnswerText } = require('./poll-question');
const keys = require('./followup-keys');
const kinds = require('./followup-kinds');
const store = require('./followup-store');
const { lateWindow } = require('./late-window');
const { sessionIdSecret } = require('./id-secret');

const respond = (statusCode, body) => ({
  statusCode,
  body: JSON.stringify(body),
  headers: { 'Access-Control-Allow-Origin': '*' },
});
const notFound = () => respond(404, { error: 'Not found' });
const orgOf = (item) => (item && typeof item.orgId === 'string' ? item.orgId.trim() : '');
const onScreenRound = (state) => {
  const m = /^RESULTS#(\d+)$/.exec(String((state && state.State) || ''));
  return m ? keys.roundOf(m[1]) : null;
};

async function readSession(db, gameId) {
  const [meta, state] = await Promise.all([
    db.send(new GetCommand({ TableName: process.env.TABLE_NAME, Key: { PK: `GAME#${gameId}`, SK: 'METADATA' } })),
    db.send(new GetCommand({ TableName: process.env.TABLE_NAME, Key: { PK: `GAME#${gameId}`, SK: 'STATE' } })),
  ]);
  return { meta: meta && meta.Item, state: state && state.Item };
}

const isHost = (event, meta) => {
  const a = (event && event.requestContext && event.requestContext.authorizer) || {};
  const claims = (a.jwt && a.jwt.claims) || a.lambda;
  return Boolean(claims) && callerMayDriveSession(event, meta);
};

// ─────────────────────────────────────────────────────────── wires ──

/** An ask as the host sees it: everything, with its count. */
function hostWire(ask, tally, ideas) {
  return {
    askId: ask.AskId,
    round: ask.QuestionNumber,
    kind: ask.Kind,
    statement: ask.Statement || null,
    question: ask.Question || null,
    anchor: ask.Anchor || null,
    options: (ask.Options || []).map((o) => ({ text: o.text, ...(o.ownWords ? { ownWords: true } : { answer: o.answer }) })),
    fromAnswers: ask.FromAnswers || [],
    origin: ask.Origin,
    suggestionIndex: Number.isInteger(ask.SuggestionIndex) ? ask.SuggestionIndex : null,
    status: ask.Status,
    sentAt: ask.SentAt,
    closedAt: ask.ClosedAt || null,
    cancelledAt: ask.CancelledAt || null,
    tally: tally || null,
    // Ideas: every answer's words (never a name) with an id to pick by, and
    // the ones the host has put on the wall.
    ...(ask.Kind === 'ideas' ? { ideas: ideas || [], picked: ask.Picked || [] } : {}),
  };
}

/**
 * An ask as a phone sees it: the words and the options' texts. Never `why`,
 * `FromAnswers`, the origin or a suggestion; the count only once it is
 * closed, and never a name.
 */
function phoneWire(ask, answered = null) {
  const kind = ask.Kind;
  const words = kind === 'rate'
    ? { statement: ask.Statement, scale: { lowLabel: kinds.RATE.lowLabel, highLabel: kinds.RATE.highLabel } }
    : kind === 'ideas'
      ? { question: ask.Question, maxLength: kinds.LIMITS.idea }
      : { question: ask.Question, options: (ask.Options || []).map((o) => o.text) };
  return {
    askId: ask.AskId,
    round: ask.QuestionNumber,
    kind,
    ...words,
    status: ask.Status,
    // How many have answered so far: a count, never who (the wall's line).
    ...(Number.isInteger(answered) ? { answered } : {}),
    ...(ask.Status === 'closed' && ask.Tally ? { tally: ask.Tally } : {}),
    // Ideas reach the room only as the host picks them, and never with a name.
    ...(kind === 'ideas' ? { picked: (ask.Picked || []).map((p) => p.text) } : {}),
  };
}

// ──────────────────────────────────────────────────────────── host ──

async function hostRound(db, { gameId, meta, state, round }) {
  const orgId = orgOf(meta);
  const padded = keys.roundOf(round);
  if (!padded) return respond(400, { error: 'round must be a round number' });
  await store.settleLive(db, { gameId, orgId, onScreenRound: onScreenRound(state) });
  const [suggestions, rows, pointer] = await Promise.all([
    store.readSuggestions(db, { gameId, round: padded, orgId }),
    store.readRound(db, { gameId, round: padded, orgId }),
    store.readLivePointer(db, { gameId }),
  ]);
  const asks = [];
  // The session's id secret, fetched (or made) once, and only if an Ideas ask needs it.
  let secret = null;
  const idKey = async () => (secret = secret || await sessionIdSecret(db, gameId, meta));
  for (const { ask, answerRows, lateRows } of rows) {
    let tally = null;
    if (ask.Status === 'closed') {
      tally = ask.Tally || (await store.freezeTally(db, { gameId, round: padded, ask, orgId, secret: await idKey() })).Tally;
    } else if (ask.Status === 'live') {
      tally = await store.countAnswers(ask, answerRows, orgId);
    }
    const ideas = ask.Kind === 'ideas' ? await store.ideasOf(answerRows, orgId, lateRows, await idKey()) : null;
    asks.push(hostWire(ask, tally, ideas));
  }
  return respond(200, {
    gameId,
    round: padded,
    enabled: true,
    callAndAnswer: isCallAndAnswer(meta.GameType),
    suggestions: store.suggestionsWire(suggestions),
    asks,
    live: pointer ? { round: pointer.Round, askId: pointer.AskId } : null,
  });
}

async function hostRounds(db, { gameId, meta }) {
  const rows = await store.readAllSuggestions(db, { gameId, orgId: orgOf(meta) });
  return respond(200, { gameId, enabled: true, rounds: rows.map(store.suggestionsWire) });
}

async function send(db, broadcast, { gameId, meta, state, body }) {
  if (!isCallAndAnswer(meta.GameType)) return respond(409, { error: 'Follow-up questions are for Call & Answer rounds', code: 'NOT_CALL_AND_ANSWER' });
  const round = keys.roundOf(body.round);
  if (!round) return respond(400, { error: 'round must be a round number' });
  if (onScreenRound(state) !== round) {
    return respond(409, { error: 'This round\'s results are no longer showing', code: 'NOT_ON_SCREEN', currentState: state.State });
  }
  if (state.EventPaused) return respond(409, { error: 'The host has paused this for a moment.', code: 'PAUSED' });

  const normalized = kinds.normalizeFollowUp(body);
  if (normalized.error) return respond(400, { error: normalized.error });
  const value = normalized.value;

  const orgId = orgOf(meta);
  const still = await store.settleLive(db, { gameId, orgId, onScreenRound: round });
  if (still) return respond(409, { error: 'Finish the open question first', code: 'LIVE', live: { round: still.Round, askId: still.AskId } });

  let suggestion = null;
  if (value.suggestionIndex !== null) {
    const row = await store.readSuggestions(db, { gameId, round, orgId });
    suggestion = row && Array.isArray(row.Asks) ? row.Asks[value.suggestionIndex] || null : null;
    if (!suggestion) return respond(409, { error: 'That suggestion has been replaced; open the list again', code: 'STALE_SUGGESTION' });
  }
  const origin = kinds.resolveOrigin(value, suggestion);
  // Where it sits beside the read: the suggestion's checked anchor, or none.
  const anchor = suggestion && suggestion.anchor ? suggestion.anchor : null;
  // The record the report needs (session flow v3 §4.2): Workie's words as
  // they were, what the host changed, where it was sent from, the room size.
  const record = {
    suggested: kinds.suggestedOf(suggestion),
    edits: kinds.editsOf(value, suggestion),
    ...kinds.sendContextOf(body),
  };
  const created = await store.createAsk(db, { gameId, round, orgId, value, origin, anchor, record });
  if (!created.ok) return respond(409, { error: 'Finish the open question first', code: 'LIVE' });

  // Every screen moves to the question: the round's beat becomes `ask`.
  await store.setBeat(db, { gameId, round, beat: 'ask' });
  await broadcast(gameId, { type: 'stageBeatChanged', gameId, questionNumber: round, beat: 'ask', timestamp: new Date().toISOString() });
  await broadcast(gameId, { type: 'followUpChanged', gameId, questionNumber: round, askId: created.ask.AskId, status: 'live' });
  return respond(201, { gameId, ask: hostWire(created.ask, kinds.tallyOf(created.ask, { n: 0 })) });
}

async function finish(db, broadcast, { gameId, meta, askId, body, status }) {
  const round = keys.roundOf(body.round);
  if (!round || !keys.isAskId(askId)) return respond(400, { error: 'round and a follow-up id are required' });
  const done = await store.finishAsk(db, { gameId, round, askId, orgId: orgOf(meta), status });
  if (!done.ok) {
    return done.code === 'NOT_FOUND'
      ? respond(404, { error: 'Follow-up question not found' })
      : respond(409, { error: 'This question is not open', code: 'NOT_LIVE' });
  }
  // Cancelled: the room goes back to the read. Closed: the beat stays `ask`
  // and every screen shows the results.
  if (status === 'cancelled') {
    await store.setBeat(db, { gameId, round, beat: 'field-notes' });
    await broadcast(gameId, { type: 'stageBeatChanged', gameId, questionNumber: round, beat: 'field-notes', timestamp: new Date().toISOString() });
  }
  await broadcast(gameId, { type: 'followUpChanged', gameId, questionNumber: round, askId, status });
  return respond(200, { gameId, ask: hostWire(done.ask, status === 'closed' ? done.ask.Tally : null) });
}

/**
 * THE HOST PICKS AN IDEA FOR THE WALL (or takes it down). The words are copied
 * onto the ask, sealed, without a name, so the wall and the report keep them
 * after the answer rows expire.
 */
async function pick(db, broadcast, { gameId, meta, askId, body }) {
  const round = keys.roundOf(body.round);
  if (!round || !keys.isAskId(askId)) return respond(400, { error: 'round and a follow-up id are required' });
  if (typeof body.id !== 'string' || !body.id || typeof body.picked !== 'boolean') {
    return respond(400, { error: 'id and picked are required' });
  }
  const done = await store.pickIdea(db, {
    gameId, round, askId, orgId: orgOf(meta), id: body.id, picked: body.picked, secret: await sessionIdSecret(db, gameId, meta),
  });
  if (!done.ok) {
    return done.code === 'NOT_FOUND'
      ? respond(404, { error: 'Not found' })
      : respond(409, { error: 'Only an Ideas question has answers to pick', code: done.code });
  }
  await broadcast(gameId, { type: 'followUpChanged', gameId, questionNumber: round, askId, status: 'picked' });
  // A late idea on the wall is now "Reviewed with the room": the host's late list refetches.
  if (done.lateShown) await broadcast(gameId, { type: 'lateChanged', gameId }, { hostsOnly: true });
  return respond(200, { gameId, askId, picked: done.picked });
}

// ────────────────────────────────────────────────────────── phones ──

/** The member check comments.js writeComment makes: a PLAYER# row, and its ClientId when stamped. */
async function isMember(db, gameId, playerName, clientId) {
  const name = String(playerName || '').trim();
  if (!name) return false;
  const row = (await db.send(new GetCommand({
    TableName: process.env.TABLE_NAME, Key: { PK: `GAME#${gameId}`, SK: `PLAYER#${name}` },
  }))).Item;
  if (!row) return false;
  const stored = row.ClientId || null;
  if (!stored) return true;
  const supplied = typeof clientId === 'string' ? clientId.trim() : '';
  return Boolean(supplied) && supplied === stored;
}

async function phoneLive(db, { gameId, meta, state, query }) {
  const round = onScreenRound(state);
  if (!round || !isCallAndAnswer(meta.GameType)) return respond(200, { gameId, ask: null });
  const orgId = orgOf(meta);
  const rows = await store.readRound(db, { gameId, round, orgId });
  // The newest ask of the round that the room may see: the live one, or the
  // last one whose results were shown. A cancelled ask is gone from phones.
  const shownRows = rows.filter((r) => r.ask.Status === 'live' || r.ask.Status === 'closed');
  const current = shownRows.length ? shownRows[shownRows.length - 1] : null;
  if (!current) return respond(200, { gameId, ask: null });
  const ask = current.ask;
  // The round's beat, so a device that missed the frame (it joined or reloaded
  // after the question went out) still knows the room is on the question.
  const roundRow = (await db.send(new GetCommand({
    TableName: process.env.TABLE_NAME, Key: { PK: `GAME#${gameId}`, SK: `ROUND#${round}` },
  }))).Item;
  const out = { gameId, beat: resolveBeat(roundRow && roundRow.StageBeat), ask: phoneWire(ask, (current.answerRows || []).length) };
  const name = String((query && query.playerName) || '').trim();
  if (name && await isMember(db, gameId, name, query.clientId)) {
    const mine = await store.readAnswer(db, { gameId, round, askId: ask.AskId, orgId, playerName: name });
    out.yours = mine ? mine.Value : null;
  }
  return respond(200, out);
}

async function phoneAnswer(db, broadcast, { gameId, meta, state, askId, body }) {
  const round = keys.roundOf(body.round);
  if (!round || !keys.isAskId(askId)) return respond(400, { error: 'round and a follow-up id are required' });
  const playerName = String(body.playerName || '').trim();
  if (!playerName) return respond(400, { error: 'playerName is required' });

  if (!(await isMember(db, gameId, playerName, body.clientId))) return respond(409, { error: 'you have not joined this session' });
  if (state.EventPaused) return respond(409, { error: 'The host has paused this for a moment.', code: 'PAUSED' });

  const orgId = orgOf(meta);
  const ask = await store.readAsk(db, { gameId, round, askId, orgId });
  if (!ask) return respond(404, { error: 'Follow-up question not found' });
  // A cancelled question was taken back from the room: nothing, late or not.
  if (ask.Status !== 'live' && ask.Status !== 'closed') return respond(409, { error: 'this question is no longer open', code: 'NOT_LIVE' });

  const checked = kinds.checkValue(ask, body.value);
  if (!checked.ok) return respond(400, { error: checked.error });
  const text = pollAnswerText(kinds.toSurveyQuestion(ask), checked.value);

  // ON TIME: the question is live and its round is the one on screen. A close
  // racing this write refuses it (writeAnswer's ConditionCheck); then it is late.
  if (ask.Status === 'live' && onScreenRound(state) === round) {
    const written = await store.writeAnswer(db, { gameId, round, askId, orgId, playerName, value: checked.value, text });
    if (written.ok) {
      await broadcast(gameId, { type: 'followUpChanged', gameId, questionNumber: round, askId, status: 'answered' });
      return respond(200, { gameId, askId, yours: checked.value });
    }
  }

  // LATE (session flow v3 §4.4): after "Show results" or after the round moved
  // on. Kept apart from the count, while the window allows (late-window.js).
  const gate = lateWindow({ meta, state });
  if (!gate.open) return respond(409, { error: gate.error, code: gate.code });
  const kept = await store.writeLateAnswer(db, {
    gameId, round, ask, orgId, playerName, value: checked.value, text, arrivedDuring: state.State,
  });
  if (!kept.ok) return respond(409, { error: 'You have already answered this question.', code: kept.code });
  console.log(`Late follow-up answer kept on round ${round} (arrived during ${state.State})`);
  await broadcast(gameId, { type: 'followUpChanged', gameId, questionNumber: round, askId, status: 'late' });
  // The host's late list reads /late, which followUpChanged does not refetch
  // (after ENDED nothing else would): tell the hosts, as a late comment does.
  await broadcast(gameId, { type: 'lateChanged', gameId }, { hostsOnly: true });
  return respond(200, { gameId, askId, yours: checked.value, late: true });
}

// ───────────────────────────────────────────────────────── handler ──

/** Does this request belong here? (comments.js asks before routing.) */
const isFollowUpRoute = (routeKey) => /\/followups\/\{proxy\+\}|\/followup-play\/\{proxy\+\}/.test(String(routeKey || ''));

/**
 * @param {object} event
 * @param {{db: object, broadcast: (gameId: string, message: object) => Promise<void>}} deps
 */
async function handleFollowUps(event, { db, broadcast }) {
  if (!store.followUpsEnabled()) return notFound();
  const method = (event.requestContext && event.requestContext.http && event.requestContext.http.method) || event.httpMethod;
  const routeKey = (event.requestContext && event.requestContext.routeKey) || event.routeKey || '';
  const gameId = event.pathParameters && event.pathParameters.gameId;
  if (!gameId) return respond(400, { error: 'gameId is required' });
  const parts = String((event.pathParameters && event.pathParameters.proxy) || '').split('/').filter(Boolean);
  const phone = routeKey.includes('/followup-play/');

  let body = {};
  if (method === 'POST') {
    try { body = JSON.parse(event.body || '{}') || {}; } catch { return respond(400, { error: 'Body must be JSON' }); }
  }

  const { meta, state } = await readSession(db, gameId);
  if (!meta || !state) return respond(404, { error: 'Game not found' });

  if (phone) {
    if (method === 'GET' && parts.length === 1 && parts[0] === 'live') {
      return phoneLive(db, { gameId, meta, state, query: event.queryStringParameters || {} });
    }
    if (method === 'POST' && parts.length === 3 && parts[0] === 'asks' && parts[2] === 'answer') {
      return phoneAnswer(db, broadcast, { gameId, meta, state, askId: parts[1], body });
    }
    return notFound();
  }

  if (!isHost(event, meta)) return respond(404, { error: 'Game not found' });
  if (method === 'GET' && parts.length === 2 && parts[0] === 'round') return hostRound(db, { gameId, meta, state, round: parts[1] });
  if (method === 'GET' && parts.length === 1 && parts[0] === 'rounds') return hostRounds(db, { gameId, meta });
  if (method === 'POST' && parts.length === 1 && parts[0] === 'send') return send(db, broadcast, { gameId, meta, state, body });
  if (method === 'POST' && parts.length === 3 && parts[0] === 'asks' && parts[2] === 'pick') {
    return pick(db, broadcast, { gameId, meta, askId: parts[1], body });
  }
  if (method === 'POST' && parts.length === 3 && parts[0] === 'asks' && (parts[2] === 'close' || parts[2] === 'cancel')) {
    return finish(db, broadcast, { gameId, meta, askId: parts[1], body, status: parts[2] === 'close' ? 'closed' : 'cancelled' });
  }
  return notFound();
}

module.exports = { handleFollowUps, isFollowUpRoute, hostWire, phoneWire };
