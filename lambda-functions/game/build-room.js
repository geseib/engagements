/**
 * BUILD ROOM — the handler (docs/design/build-room/PLAN.md §6).
 *
 * One function, two families of routes:
 *
 *   /games/{gameId}/build/{proxy+}       GET, POST — CognitoAuthorizer.
 *       The HOST (a signed-in user who may drive this session) or the
 *       host's CLAUDE CODE, presenting the session key `eng_<gameId>_…` that
 *       the authorizer verified and scoped to this one session's build/*
 *       routes (auth/authorizer.js, agentKeyContext).
 *
 *   /games/{gameId}/build-play/{proxy+}  GET, POST — public.
 *       A PHONE, identified the way the rest of the player API identifies
 *       one: `{playerName, clientId}` against its PLAYER# row.
 *
 * The rules live in build-store.js; this file reads rows, checks who is
 * asking, writes, bumps the room's Rev and tells every connection
 * `buildChanged` so each page refetches (notify → refresh, as everywhere).
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand, DeleteCommand,
} = require('@aws-sdk/lib-dynamodb');
const { callerMayDriveSession } = require('./tenant');
const { encryptItem, decryptItem, decryptItems } = require('./tenant-crypto');
const { ttlFrom, ROUND_RECORD_DAYS } = require('./session-ttl');
const { toAll } = require('./survey-broadcast');
const S = require('./build-store');

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const TABLE = () => process.env.TABLE_NAME;

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'no-store',
};
const reply = (statusCode, body) => ({ statusCode, headers: HEADERS, body: JSON.stringify(body) });
const fail = (statusCode, error, extra) => reply(statusCode, { error, ...(extra || {}) });

// ── Rows ─────────────────────────────────────────────────────────────────────

async function queryAll(pk, prefix) {
  const out = [];
  let ExclusiveStartKey;
  do {
    const page = await db.send(new QueryCommand({
      TableName: TABLE(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': pk, ':sk': prefix },
      ExclusiveStartKey,
    }));
    out.push(...((page && page.Items) || []));
    ExclusiveStartKey = page && page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return out;
}

/** Seal a row under the session's org (orgless sessions stay plaintext, as every row does). */
async function seal(ctx, item) {
  const entity = S.entityForSk(item.SK);
  if (!ctx.orgId || !entity) return item;
  return encryptItem(ctx.orgId, entity, item);
}

async function put(ctx, item) {
  const row = { PK: ctx.pk, ...item, ttl: ctx.ttl };
  await db.send(new PutCommand({ TableName: TABLE(), Item: await seal(ctx, row) }));
  return row;
}

async function loadRoom(ctx) {
  const rows = await queryAll(ctx.pk, 'BUILD#');
  if (ctx.orgId) {
    for (let i = 0; i < rows.length; i += 1) {
      const entity = S.entityForSk(String(rows[i].SK));
      if (entity) rows[i] = await decryptItem(ctx.orgId, entity, rows[i]);
    }
  }
  return S.roomFromRows(rows);
}

async function loadPlayers(ctx) {
  const rows = await queryAll(ctx.pk, 'PLAYER#');
  const names = new Set();
  for (const r of rows) {
    const sk = String(r.SK);
    if (sk.includes('#SCORE') || sk.includes('#STATE')) continue;
    if (r.Removed) continue;
    const name = r.PlayerName || r.playerName || sk.slice('PLAYER#'.length);
    if (name) names.add(name);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

async function sessionState(ctx) {
  const r = await db.send(new GetCommand({ TableName: TABLE(), Key: { PK: ctx.pk, SK: 'STATE' }, ProjectionExpression: '#s', ExpressionAttributeNames: { '#s': 'State' } }));
  return (r && r.Item && r.Item.State) || null;
}

/** Bump the room's revision (and anything else on BUILD#STATE) atomically. */
async function touchState(ctx, { set = {}, add = {} } = {}) {
  const names = { '#rev': 'Rev', '#ttl': 'ttl' };
  const values = { ':one': 1, ':ttl': ctx.ttl };
  const sets = ['#ttl = :ttl'];
  const adds = ['#rev :one'];
  let i = 0;
  for (const [k, v] of Object.entries(set)) {
    i += 1;
    names[`#s${i}`] = k;
    values[`:s${i}`] = v;
    sets.push(`#s${i} = :s${i}`);
  }
  for (const [k, v] of Object.entries(add)) {
    i += 1;
    names[`#a${i}`] = k;
    values[`:a${i}`] = v;
    adds.push(`#a${i} :a${i}`);
  }
  const res = await db.send(new UpdateCommand({
    TableName: TABLE(),
    Key: { PK: ctx.pk, SK: S.SK.state },
    UpdateExpression: `SET ${sets.join(', ')} ADD ${adds.join(', ')}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
    ReturnValues: 'ALL_NEW',
  }));
  return (res && res.Attributes) || {};
}

async function announce(ctx, rev) {
  await toAll(db, TABLE(), ctx.gameId, { type: 'buildChanged', gameId: ctx.gameId, rev: rev || 0 });
}

/** Write a timeline entry. */
async function logEntry(ctx, { kind, text, detail, link, by, askId, forAgent }) {
  const now = new Date().toISOString();
  const sk = S.SK.log(now);
  const row = {
    SK: sk,
    LogId: sk.slice('BUILD#LOG#'.length).replace('#', '-'),
    Kind: kind,
    Text: text,
    ...(detail ? { Detail: detail } : {}),
    ...(link ? { Link: link } : {}),
    By: by,
    ...(askId ? { AskId: askId } : {}),
    ...(forAgent ? { ForAgent: true } : {}),
    CreatedAt: now,
  };
  return put(ctx, row);
}

const findAsk = (room, askId) => room.asks.find((a) => a.AskId === askId) || null;
const findLog = (room, logId) => room.logs.find((l) => l.LogId === logId) || null;
const findIdea = (room, ideaId) => room.ideas.find((i) => i.IdeaId === ideaId) || null;

// ── Who is asking ────────────────────────────────────────────────────────────

function authorizerCtx(event) {
  const a = (event.requestContext && event.requestContext.authorizer) || {};
  return a.lambda || (a.jwt && a.jwt.claims) || null;
}

/** 'agent' | 'host' | null. */
function hostOrAgent(event, ctx) {
  const auth = authorizerCtx(event);
  if (!auth) return null;
  if (auth.agent === 'build') {
    // The authorizer already pinned the key to this game; check again here so
    // this handler never depends on how it was reached.
    return auth.agentGameId === ctx.gameId ? 'agent' : null;
  }
  if (!auth.userId && !auth.sub) return null;
  return callerMayDriveSession(event, ctx.meta) ? 'host' : null;
}

async function playerFrom(ctx, input) {
  const playerName = S.cleanText(input.playerName, 60);
  const clientId = String(input.clientId || '').slice(0, 100);
  if (!playerName) return null;
  const r = await db.send(new GetCommand({ TableName: TABLE(), Key: { PK: ctx.pk, SK: `PLAYER#${playerName}` } }));
  const row = r && r.Item;
  if (!row || row.Removed) return null;
  if (row.ClientId && row.ClientId !== clientId) return null;
  return { playerName };
}

// ── Host + agent routes ──────────────────────────────────────────────────────

async function hostState(ctx, audience) {
  const [room, players, state] = await Promise.all([loadRoom(ctx), loadPlayers(ctx), sessionState(ctx)]);
  return { room, view: S.hostView({ gameId: ctx.gameId, meta: ctx.meta, sessionState: state, room, players, now: new Date().toISOString(), audience }) };
}

async function createAsk(ctx, role, body) {
  const norm = S.normalizeAsk(body);
  if (norm.error) return fail(400, norm.error);
  const room = await loadRoom(ctx);
  const settings = S.settingsOf(room.state);
  const status = role === 'agent'
    ? (settings.reviewAgentAsks ? 'proposed' : 'live')
    : (body && body.draft ? 'proposed' : 'live');
  const st = await touchState(ctx, { add: { AskSeq: 1 } });
  const askId = S.pad3(st.AskSeq || 1);
  const now = new Date().toISOString();
  const v = norm.value;
  const ask = {
    SK: S.SK.ask(askId),
    AskId: askId,
    Kind: v.kind,
    Prompt: v.prompt,
    Detail: v.detail,
    Options: v.options,
    ...(v.scale ? { Scale: v.scale } : {}),
    ...(v.maxPicks ? { MaxPicks: v.maxPicks } : {}),
    Status: status,
    Source: role === 'agent' ? 'agent' : 'host',
    CreatedAt: now,
    ...(status === 'live' ? { OpenedAt: now } : {}),
  };
  await put(ctx, ask);
  if (status === 'live') await makeCurrent(ctx, room, askId, role);
  else await logEntry(ctx, { kind: 'ask', text: `Claude proposed a question: ${v.prompt}`, by: 'system', askId });
  const after = await loadRoom(ctx);
  const rev = (await touchState(ctx)).Rev;
  await announce(ctx, rev);
  return reply(201, { ask: S.askView(findAsk(after, askId), after, 'host') });
}

/** Open `askId` as the one current ask; anything else still answering moves to results. */
async function makeCurrent(ctx, room, askId, role) {
  const now = new Date().toISOString();
  for (const other of room.asks) {
    if (other.AskId !== askId && S.OPEN_STATUSES.includes(other.Status)) {
      await put(ctx, { ...other, Status: 'results', ClosedAt: now });
    }
  }
  await touchState(ctx, { set: { CurrentAskId: askId } });
  const ask = findAsk(await loadRoom(ctx), askId);
  await logEntry(ctx, {
    kind: 'ask',
    text: `${role === 'agent' ? 'Claude asked' : 'Asked'} the room: ${ask ? ask.Prompt : ''}`,
    by: 'system',
    askId,
  });
}

async function askAction(ctx, role, askId, body) {
  const b = body || {};
  const room = await loadRoom(ctx);
  const ask = findAsk(room, askId);
  if (!ask) return fail(404, `No ask ${askId}`);
  const action = String(b.action || '').toLowerCase();
  const now = new Date().toISOString();
  const answered = room.answers.some((a) => a.AskId === askId) || room.resps.some((r) => r.AskId === askId && (r.Source || 'player') !== 'host');

  if (action === 'edit') {
    const edited = S.applyEdit(ask, b, { answered });
    if (edited.error) return fail(400, edited.error);
    await put(ctx, { ...edited.value, EditedAt: now });
  } else {
    const t = S.transition(ask, action);
    if (t.error) return fail(t.conflict ? 409 : 400, t.error);
    const next = { ...ask, Status: t.to };
    if (action === 'open' || action === 'reopen') {
      next.OpenedAt = now;
      delete next.ClosedAt;
    }
    if (action === 'vote') next.VotingAt = now;
    if (action === 'close') next.ClosedAt = now;
    if (action === 'discard') next.DiscardedAt = now;
    if (action === 'decide') {
      const direction = S.cleanText(b.direction, S.LIMITS.direction) || S.defaultDirection(ask, room);
      if (!direction) return fail(400, 'Write the direction for Claude (nobody has answered yet)');
      const chosen = (Array.isArray(b.chosen) ? b.chosen : []).map((c) => S.cleanText(c, 40)).filter(Boolean).slice(0, 20);
      const note = S.cleanText(b.note, S.LIMITS.note);
      const sendToAgent = b.sendToAgent !== false;
      next.Decision = { direction, chosen, note, sendToAgent };
      next.DecidedAt = now;
      if (!next.ClosedAt) next.ClosedAt = now;
      // One entry: the decision IS what Claude receives (inboxText adds the note).
      await logEntry(ctx, { kind: 'decision', text: direction, detail: note, by: 'host', askId, forAgent: sendToAgent });
    }
    await put(ctx, next);
    if (action === 'open' || action === 'reopen') await makeCurrent(ctx, room, askId, role);
    if (action === 'discard' && room.state && room.state.CurrentAskId === askId) {
      await touchState(ctx, { set: { CurrentAskId: '' } });
    }
    if (action === 'close') await logEntry(ctx, { kind: 'ask', text: `Closed: ${ask.Prompt}`, by: 'system', askId });
  }
  const after = await loadRoom(ctx);
  const rev = (await touchState(ctx)).Rev;
  await announce(ctx, rev);
  return reply(200, { ask: S.askView(findAsk(after, askId), after, 'host') });
}

async function hostResponse(ctx, askId, respId, body) {
  const b = body || {};
  const room = await loadRoom(ctx);
  const ask = findAsk(room, askId);
  if (!ask) return fail(404, `No ask ${askId}`);
  if (ask.Kind !== 'suggest') return fail(400, 'Only an Ideas ask takes suggestions');
  const now = new Date().toISOString();
  if (!respId) {
    // What somebody said out loud, added so the room can vote on it.
    const text = S.cleanText(b.text, S.LIMITS.response);
    if (!text) return fail(400, 'Write the suggestion');
    const id = S.newId();
    await put(ctx, { SK: S.SK.resp(askId, id), AskId: askId, RespId: id, Text: text, PlayerName: S.cleanText(b.attribution, 60) || 'From the room', Source: 'host', CreatedAt: now });
    await logEntry(ctx, { kind: 'verbal', text, by: 'host', askId });
  } else {
    const resp = room.resps.find((r) => r.AskId === askId && r.RespId === respId);
    if (!resp) return fail(404, 'No such suggestion');
    const action = String(b.action || '');
    if (action === 'hide') await put(ctx, { ...resp, Hidden: true });
    else if (action === 'show') await put(ctx, { ...resp, Hidden: false });
    else if (action === 'edit') {
      const text = S.cleanText(b.text, S.LIMITS.response);
      if (!text) return fail(400, 'A suggestion cannot be empty');
      await put(ctx, { ...resp, Text: text, EditedAt: now });
    } else return fail(400, 'action must be hide, show or edit');
  }
  const after = await loadRoom(ctx);
  const rev = (await touchState(ctx)).Rev;
  await announce(ctx, rev);
  return reply(200, { ask: S.askView(findAsk(after, askId), after, 'host') });
}

async function postLog(ctx, role, body) {
  const b = body || {};
  const kind = String(b.kind || (role === 'agent' ? 'progress' : 'verbal')).toLowerCase();
  const allowed = role === 'agent' ? S.AGENT_LOG_KINDS : S.HOST_LOG_KINDS;
  if (!allowed.includes(kind)) return fail(400, `kind must be one of ${allowed.join(', ')}`);
  const text = S.cleanText(b.text, S.LIMITS.logText);
  if (!text) return fail(400, 'Write the update');
  const row = await logEntry(ctx, {
    kind,
    text,
    detail: S.cleanText(b.detail, S.LIMITS.logDetail),
    link: S.safeUrl(b.link),
    by: role === 'agent' ? 'agent' : 'host',
    // What the room said can go straight to Claude; a host note never does.
    forAgent: role === 'host' && Boolean(b.forAgent) && kind !== 'note',
  });
  const rev = (await touchState(ctx)).Rev;
  await announce(ctx, rev);
  return reply(201, { entry: S.logView(row) });
}

async function editLog(ctx, logId, body) {
  const b = body || {};
  const room = await loadRoom(ctx);
  const entry = findLog(room, logId);
  if (!entry) return fail(404, 'No such entry');
  const now = new Date().toISOString();
  let out;
  if (b.action === 'delete') {
    // Kept as a tombstone-free delete: the timeline is the host's to curate.
    await db.send(new DeleteCommand({ TableName: TABLE(), Key: { PK: ctx.pk, SK: entry.SK } }));
    out = { ...S.logView(entry), deleted: true };
  } else if (b.action === 'edit') {
    const text = b.text !== undefined ? S.cleanText(b.text, S.LIMITS.logText) : entry.Text;
    if (!text) return fail(400, 'An entry cannot be empty');
    const next = { ...entry, Text: text, EditedAt: now };
    if (b.detail !== undefined) next.Detail = S.cleanText(b.detail, S.LIMITS.logDetail);
    await put(ctx, next);
    out = S.logView(next);
  } else return fail(400, 'action must be edit or delete');
  const rev = (await touchState(ctx)).Rev;
  await announce(ctx, rev);
  return reply(200, { entry: out });
}

async function postDirection(ctx, body) {
  const text = S.cleanText((body || {}).text, S.LIMITS.direction);
  if (!text) return fail(400, 'Write the direction');
  const row = await logEntry(ctx, { kind: 'direction', text, by: 'host', forAgent: true });
  const rev = (await touchState(ctx)).Rev;
  await announce(ctx, rev);
  return reply(201, { entry: S.logView(row) });
}

async function ideaAction(ctx, ideaId, body) {
  const action = String((body || {}).action || '');
  const room = await loadRoom(ctx);
  const idea = findIdea(room, ideaId);
  if (!idea) return fail(404, 'No such idea');
  const now = new Date().toISOString();
  let status = idea.Status || 'new';
  if (action === 'direct') {
    status = 'promoted';
  } else if (action === 'suggest') {
    const current = room.state && room.state.CurrentAskId ? findAsk(room, room.state.CurrentAskId) : null;
    if (!current || current.Kind !== 'suggest' || !S.OPEN_STATUSES.includes(current.Status)) {
      return fail(409, 'There is no Ideas ask open to add it to');
    }
    const id = S.newId();
    await put(ctx, { SK: S.SK.resp(current.AskId, id), AskId: current.AskId, RespId: id, Text: idea.Text, PlayerName: idea.PlayerName, Source: 'idea', CreatedAt: now });
    status = 'promoted';
  } else if (action === 'dismiss') status = 'dismissed';
  else if (action === 'restore') status = 'new';
  else return fail(400, 'action must be direct, suggest, dismiss or restore');
  const next = { ...idea, Status: status, UpdatedAt: now };
  await put(ctx, next);
  if (action === 'direct' || action === 'suggest') {
    await logEntry(ctx, { kind: 'idea', text: idea.Text, detail: `from ${idea.PlayerName}`, by: 'room', forAgent: action === 'direct' });
  }
  const rev = (await touchState(ctx)).Rev;
  await announce(ctx, rev);
  return reply(200, { idea: S.ideaView(next) });
}

async function postOutcome(ctx, role, body) {
  const now = new Date().toISOString();
  const norm = S.normalizeOutcome(body, role === 'agent' ? 'agent' : 'host', now);
  if (norm.error) return fail(400, norm.error);
  const st = await touchState(ctx, { set: { Outcome: ctx.orgId ? await sealOutcome(ctx, norm.value) : norm.value } });
  await logEntry(ctx, { kind: 'outcome', text: role === 'agent' ? 'Claude wrapped up the build' : 'The host updated the wrap-up', detail: norm.value.summary.slice(0, 500), by: role === 'agent' ? 'agent' : 'host' });
  const rev = (await touchState(ctx)).Rev || st.Rev;
  await announce(ctx, rev);
  return reply(200, { outcome: S.outcomeView(norm.value) });
}

/** BUILD#STATE is written by UpdateItem, so its one sealed field is sealed by hand. */
async function sealOutcome(ctx, outcome) {
  const sealed = await encryptItem(ctx.orgId, 'buildState', { Outcome: outcome });
  return sealed.Outcome;
}

async function postSettings(ctx, body) {
  const b = body || {};
  const room = await loadRoom(ctx);
  const settings = { ...S.settingsOf(room.state) };
  if (b.reviewAgentAsks !== undefined) settings.reviewAgentAsks = Boolean(b.reviewAgentAsks);
  const set = { Settings: settings };
  if (b.agentName !== undefined) set.AgentName = S.cleanText(b.agentName, S.LIMITS.agentName) || 'Claude Code';
  const st = await touchState(ctx, { set });
  await announce(ctx, st.Rev);
  return reply(200, { settings });
}

async function mintAgentKey(ctx, event, body) {
  const room = await loadRoom(ctx);
  const now = new Date().toISOString();
  // One live key per session: a new one retires the old, so a key pasted
  // somewhere it should not be is one click from dead.
  for (const k of room.keys) {
    if (!k.RevokedAt) await put(ctx, { ...k, RevokedAt: now });
  }
  const { key, hash } = S.mintKey(ctx.gameId);
  const auth = authorizerCtx(event) || {};
  const keyId = hash.slice(0, 12);
  await put(ctx, {
    SK: S.SK.key(hash),
    KeyId: keyId,
    Label: S.cleanText((body || {}).label, S.LIMITS.label) || 'Claude Code',
    MintedBy: auth.userId || auth.sub || null,
    CreatedAt: now,
  });
  const st = await touchState(ctx);
  await announce(ctx, st.Rev);
  return { statusCode: 201, headers: HEADERS, body: JSON.stringify({ key, keyId, gameId: ctx.gameId }) };
}

async function revokeAgentKey(ctx, keyId) {
  const room = await loadRoom(ctx);
  const k = room.keys.find((x) => x.KeyId === keyId);
  if (!k) return fail(404, 'No such key');
  if (!k.RevokedAt) await put(ctx, { ...k, RevokedAt: new Date().toISOString() });
  const st = await touchState(ctx);
  await announce(ctx, st.Rev);
  return reply(200, { ok: true });
}

/**
 * Claude was here: stamp the chip's clock and the key's, and hand over every
 * direction it has not heard yet, marking each delivered as it goes. A
 * direction is delivered exactly once — the conditional write is the claim.
 */
async function agentTouch(ctx, event) {
  const now = new Date().toISOString();
  const auth = authorizerCtx(event) || {};
  await touchState(ctx, { set: { AgentSeenAt: now } }).catch(() => {});
  if (auth.agentKeyHash) {
    await db.send(new UpdateCommand({
      TableName: TABLE(),
      Key: { PK: ctx.pk, SK: S.SK.key(auth.agentKeyHash) },
      UpdateExpression: 'SET LastUsedAt = :now',
      ConditionExpression: 'attribute_exists(PK)',
      ExpressionAttributeValues: { ':now': now },
    })).catch(() => {});
  }
}

async function takeInbox(ctx) {
  const room = await loadRoom(ctx);
  const out = [];
  const now = new Date().toISOString();
  for (const d of S.pendingDirections(room)) {
    try {
      await db.send(new UpdateCommand({
        TableName: TABLE(),
        Key: { PK: ctx.pk, SK: d.SK },
        UpdateExpression: 'SET DeliveredAt = :now',
        ConditionExpression: 'attribute_not_exists(DeliveredAt)',
        ExpressionAttributeValues: { ':now': now },
      }));
      out.push({ id: d.LogId, text: S.inboxText(d), from: S.inboxFrom(d), askId: d.AskId || null, createdAt: d.CreatedAt });
    } catch (e) {
      if (e && e.name !== 'ConditionalCheckFailedException') throw e;
    }
  }
  // The decision row records that Claude heard it.
  for (const item of out.filter((x) => x.askId)) {
    const ask = findAsk(room, item.askId);
    if (ask && ask.Decision && !ask.Decision.deliveredAt) {
      await put(ctx, { ...ask, Decision: { ...ask.Decision, deliveredAt: now } });
    }
  }
  return out;
}

async function routeHost(ctx, role, method, parts, body, event) {
  const [a, b, c, d] = parts;
  const hostOnly = () => (role === 'host' ? null : fail(403, 'Only the host can do that'));

  if (method === 'GET' && a === 'state' && !b) {
    const { view } = await hostState(ctx, role === 'agent' ? 'agent' : 'host');
    return reply(200, view);
  }
  if (method === 'GET' && a === 'asks' && b && !c) {
    const room = await loadRoom(ctx);
    const ask = findAsk(room, b);
    if (!ask) return fail(404, `No ask ${b}`);
    return reply(200, { ask: S.askView(ask, room, role === 'agent' ? 'agent' : 'host') });
  }
  if (method !== 'POST') return fail(404, 'Not found');

  const ended = (await sessionState(ctx)) === 'ENDED';
  if (ended && !(a === 'outcome' || (a === 'log' && b))) return fail(409, 'This session has ended');

  if (a === 'asks' && !b) return createAsk(ctx, role, body);
  if (a === 'asks' && b && !c) return hostOnly() || askAction(ctx, role, b, body);
  if (a === 'asks' && b && c === 'responses') return hostOnly() || hostResponse(ctx, b, d || null, body);
  if (a === 'log' && !b) return postLog(ctx, role, body);
  if (a === 'log' && b) return hostOnly() || editLog(ctx, b, body);
  if (a === 'directions' && !b) return hostOnly() || postDirection(ctx, body);
  if (a === 'ideas' && b) return hostOnly() || ideaAction(ctx, b, body);
  if (a === 'outcome' && !b) return postOutcome(ctx, role, body);
  if (a === 'settings' && !b) return hostOnly() || postSettings(ctx, body);
  if (a === 'keys' && !b) return hostOnly() || mintAgentKey(ctx, event, body);
  if (a === 'keys' && b && c === 'revoke') return hostOnly() || revokeAgentKey(ctx, b);
  return fail(404, 'Not found');
}

// ── Phone routes ─────────────────────────────────────────────────────────────

async function routePlay(ctx, method, parts, body, query) {
  const [a] = parts;
  const input = method === 'GET' ? (query || {}) : (body || {});
  const me = await playerFrom(ctx, input);
  if (!me) return fail(403, 'Join the session first');

  if (method === 'GET' && a === 'state') {
    const [room, players, state] = await Promise.all([loadRoom(ctx), loadPlayers(ctx), sessionState(ctx)]);
    return reply(200, S.publicView({ gameId: ctx.gameId, meta: ctx.meta, sessionState: state, room, players, me, now: new Date().toISOString() }));
  }
  if (method !== 'POST') return fail(404, 'Not found');
  if ((await sessionState(ctx)) === 'ENDED') return fail(409, 'This session has ended');
  const now = new Date().toISOString();
  const room = await loadRoom(ctx);

  if (a === 'idea') {
    const text = S.cleanText(input.text, S.LIMITS.idea);
    if (!text) return fail(400, 'Write your idea');
    if (room.ideas.filter((i) => i.PlayerName === me.playerName).length >= 20) return fail(429, 'That is plenty of ideas from one phone for now');
    const sk = S.SK.idea(now);
    await put(ctx, { SK: sk, IdeaId: sk.slice('BUILD#IDEA#'.length).replace('#', '-'), PlayerName: me.playerName, Text: text, Status: 'new', CreatedAt: now });
    const st = await touchState(ctx);
    await announce(ctx, st.Rev);
    return reply(201, { ok: true });
  }

  const askId = String(input.askId || '');
  const ask = findAsk(room, askId);
  if (!ask || (room.state || {}).CurrentAskId !== askId) return fail(409, 'That question is no longer open');

  if (a === 'respond') {
    if (ask.Status !== 'live') return fail(409, 'Answers are closed for this question');
    if (ask.Kind === 'suggest') {
      const text = S.cleanText(input.text, S.LIMITS.response);
      if (!text) return fail(400, 'Write your suggestion');
      const mine = room.resps.filter((r) => r.AskId === askId && r.PlayerName === me.playerName && (r.Source || 'player') === 'player');
      if (mine.length >= S.MAX_SUGGESTIONS_PER_PLAYER) return fail(409, `Up to ${S.MAX_SUGGESTIONS_PER_PLAYER} suggestions each`);
      const id = S.newId();
      await put(ctx, { SK: S.SK.resp(askId, id), AskId: askId, RespId: id, Text: text, PlayerName: me.playerName, Source: 'player', CreatedAt: now });
    } else if (ask.Kind === 'choice') {
      const labels = (ask.Options || []).map((o) => o.label);
      const picks = [...new Set((Array.isArray(input.choice) ? input.choice : [input.choice]).map((x) => String(x || '').toUpperCase()))]
        .filter((x) => labels.includes(x));
      if (!picks.length) return fail(400, 'Pick an option');
      if (picks.length > (ask.MaxPicks || 1)) return fail(400, `Pick up to ${ask.MaxPicks || 1}`);
      await put(ctx, { SK: S.SK.ans(askId, me.playerName), AskId: askId, PlayerName: me.playerName, Choice: picks, Why: S.cleanText(input.why, S.LIMITS.why), CreatedAt: now });
    } else {
      const r = Number(input.rating);
      if (!Number.isInteger(r) || r < 1 || r > 5) return fail(400, 'Rate from 1 to 5');
      await put(ctx, { SK: S.SK.ans(askId, me.playerName), AskId: askId, PlayerName: me.playerName, Rating: r, Why: S.cleanText(input.why, S.LIMITS.why), CreatedAt: now });
    }
  } else if (a === 'vote') {
    if (ask.Kind !== 'suggest' || ask.Status !== 'voting') return fail(409, 'Voting is not open for this question');
    const valid = new Map(room.resps.filter((r) => r.AskId === askId && !r.Hidden).map((r) => [r.RespId, r]));
    const ids = [...new Set((Array.isArray(input.respIds) ? input.respIds : []).map(String))];
    if (ids.some((id) => !valid.has(id))) return fail(400, 'That suggestion is not on the ballot');
    if (ids.some((id) => valid.get(id).PlayerName === me.playerName && (valid.get(id).Source || 'player') === 'player')) return fail(400, 'Vote for other people\'s ideas');
    const max = ask.MaxPicks || S.DEFAULT_MAX_PICKS;
    if (ids.length > max) return fail(400, `Pick up to ${max}`);
    await put(ctx, { SK: S.SK.vote(askId, me.playerName), AskId: askId, PlayerName: me.playerName, RespIds: ids, CreatedAt: now });
  } else {
    return fail(404, 'Not found');
  }
  const st = await touchState(ctx);
  await announce(ctx, st.Rev);
  const after = await loadRoom(ctx);
  const view = S.publicView({ gameId: ctx.gameId, meta: ctx.meta, room: after, players: [], me, now });
  return reply(200, { ok: true, mine: view.mine });
}

// ── Entry ────────────────────────────────────────────────────────────────────

function parseBody(event) {
  if (!event.body) return {};
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    return null;
  }
}

exports.handler = async (event) => {
  try {
    const params = event.pathParameters || {};
    const gameId = String(params.gameId || '');
    if (!/^\d{4}$/.test(gameId)) return fail(404, 'Session not found');
    const routeKey = String(event.routeKey || '');
    const isPlay = routeKey.includes('/build-play/');
    const method = String((event.requestContext && event.requestContext.http && event.requestContext.http.method) || routeKey.split(' ')[0] || 'GET').toUpperCase();
    const parts = String(params.proxy || '').split('/').filter(Boolean).map(decodeURIComponent);
    const body = method === 'POST' ? parseBody(event) : {};
    if (body === null) return fail(400, 'The body must be JSON');

    const metaRead = await db.send(new GetCommand({ TableName: TABLE(), Key: { PK: `GAME#${gameId}`, SK: 'METADATA' } }));
    let meta = metaRead && metaRead.Item;
    if (!meta || meta.GameType !== S.GAME_TYPE_BUILD) return fail(404, 'Session not found');
    const orgId = meta.orgId || meta.OrgId || '';
    if (orgId) meta = await decryptItem(orgId, 'session', meta);
    const ctx = {
      gameId,
      pk: `GAME#${gameId}`,
      meta,
      orgId,
      // Every BUILD# row dies with the session: it copies the session's own
      // ttl (written at creation, rewritten at start by session-start.js —
      // the one owner of that rule). A session with none predates the ttl
      // rule; its rows then live as long as any other content a session
      // produces (session-ttl.js ROUND_RECORD_DAYS), so they cannot pin the
      // code forever.
      ttl: Number(meta.ttl) || ttlFrom(new Date().toISOString(), ROUND_RECORD_DAYS),
    };

    if (isPlay) return await routePlay(ctx, method, parts, body, event.queryStringParameters || {});

    const role = hostOrAgent(event, ctx);
    if (!role) return fail(404, 'Session not found');
    if (role === 'agent') {
      await agentTouch(ctx, event);
      const res = await routeHost(ctx, role, method, parts, body, event);
      // Directions ride along on every call Claude makes, so it hears the
      // room on its very next tool call without having to ask.
      if (res.statusCode < 500) {
        const inbox = await takeInbox(ctx);
        const parsed = JSON.parse(res.body || '{}');
        res.body = JSON.stringify({ ...parsed, inbox });
        if (inbox.length) {
          const st = await touchState(ctx);
          await announce(ctx, st.Rev);
        }
      }
      return res;
    }
    return await routeHost(ctx, role, method, parts, body, event);
  } catch (err) {
    console.error('BUILD ROOM: request failed', err);
    return fail(500, 'Something went wrong in the Build Room');
  }
};

// For tests.
exports._internals = { hostOrAgent, playerFrom };
