/**
 * THE ROUND TIMER, server side (experience plan Phase 2 step 2f; session-start
 * D4, forks F2-F4). See lambda-functions/game/round-timer.js.
 *
 *   1. the pure rules: presets only, on the wall by default, closing opt-in,
 *      +1 min by the server's clock (a minute more, or a minute from now once
 *      time is up), due only when opted in and zero is reached
 *   2. start-vote writes PhaseStartedAt and the voting timer, and tells the
 *      room only what the wall needs
 *   3. +1 min (POST /stage-beat { addTime, phase }) extends by the server's
 *      clock, refuses a phase that has moved on, and adds nothing to the next
 *      phase
 *   4. the close at zero (start-vote { timeUp }): only when opted in, only once
 *      zero is reached by the SERVER's clock, once when two screens fire, and
 *      never on a room with no answers
 *   5. reads: the public /state carries only { phase, startedAt, limitMs,
 *      extendedMs } and only when the wall shows the time; the host's door
 *      carries the whole timer; both carry serverNow
 *   6. the two copies (game/, websocket/) are identical, and no new route
 *
 * next-question's half (the round opening) is tests/round-timer-opening.js.
 * Runs the real handlers on a stubbed DynamoDB whose updates and conditions
 * are applied for real (tests/helpers/stage-table.js).
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const fs = require('fs');
const assert = require('assert');

const REPO = path.join(__dirname, '..');

class PutCommand { constructor(i) { this.input = i; this.type = 'put'; } }
class GetCommand { constructor(i) { this.input = i; this.type = 'get'; } }
class QueryCommand { constructor(i) { this.input = i; this.type = 'query'; } }
class DeleteCommand { constructor(i) { this.input = i; this.type = 'delete'; } }
class UpdateCommand { constructor(i) { this.input = i; this.type = 'update'; } }
class PostToConnectionCommand { constructor(i) { this.input = i; } }

const store = new Map();
const key = (pk, sk) => `${pk}|${sk}`;
let sent = [];
const stageTable = require('./helpers/stage-table');

const fakeDoc = {
  send: async (cmd) => {
    const inp = cmd.input || {};
    switch (cmd.type) {
      case 'put': store.set(key(inp.Item.PK, inp.Item.SK), inp.Item); return {};
      case 'get': return { Item: store.get(key(inp.Key.PK, inp.Key.SK)) };
      case 'delete': store.delete(key(inp.Key.PK, inp.Key.SK)); return {};
      case 'update': return stageTable.applyUpdate(store, key, inp);
      case 'query': {
        const pk = inp.ExpressionAttributeValues[':pk'];
        const prefix = inp.ExpressionAttributeValues[':sk'] ?? '';
        const items = [...store.values()].filter((i) => i.PK === pk && String(i.SK).startsWith(String(prefix)));
        return { Items: items, Count: items.length };
      }
      default: return {};
    }
  },
};

class FakeApiGatewayClient {
  async send(cmd) {
    sent.push({ connectionId: cmd.input.ConnectionId, message: JSON.parse(cmd.input.Data) });
    return {};
  }
}

const STUB_PATHS = [REPO, path.join(REPO, 'lambda-functions'), path.join(REPO, 'lambda-functions', 'game'), path.join(REPO, 'lambda-functions', 'websocket')];
function stub(name, exports) {
  const seen = new Set();
  for (const base of STUB_PATHS) {
    let p;
    try { p = require.resolve(name, { paths: [base] }); } catch { continue; }
    if (seen.has(p)) continue;
    seen.add(p);
    require.cache[p] = { id: p, filename: p, loaded: true, exports };
  }
  if (!seen.size) throw new Error(`stub(): could not resolve ${name}`);
}
stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', { DynamoDBDocumentClient: { from: () => fakeDoc }, PutCommand, GetCommand, QueryCommand, DeleteCommand, UpdateCommand });
stub('@aws-sdk/client-apigatewaymanagementapi', { ApiGatewayManagementApiClient: FakeApiGatewayClient, PostToConnectionCommand });

process.env.TABLE_NAME = 'test-table';
process.env.WEBSOCKET_API_ENDPOINT = 'https://ws.test.invalid/dev';
if (!process.env.DEBUG) { console.log = () => {}; console.warn = () => {}; console.error = () => {}; }
const say = (...a) => process.stdout.write(a.join(' ') + '\n');

const RT = require(path.join(REPO, 'lambda-functions/game/round-timer.js'));
const { handler: startVote } = require(path.join(REPO, 'lambda-functions/websocket/start-vote.js'));
const { handler: stageBeat } = require(path.join(REPO, 'lambda-functions/game/stage-beat.js'));
const { handler: getState } = require(path.join(REPO, 'lambda-functions/game/get-game-state.js'));

let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); say(`  PASS  ${label}`); pass++; }
  catch (e) { say(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const MIN = 60000;
const put = (item) => store.set(key(item.PK, item.SK), item);
const stateOf = (id) => store.get(key(`GAME#${id}`, 'STATE'));
const iso = (ms) => new Date(ms).toISOString();

/** A C&A game on ASK#001, answering opened `agoMs` ago with a timer as given. */
function seed(id, { agoMs = 30000, limitMs = 2 * MIN, extendedMs = 0, onWall = true, closes = false, answers = ['Ada', 'Grace'], extra = {} } = {}) {
  store.clear();
  sent = [];
  put({ PK: `GAME#${id}`, SK: 'METADATA', GameType: 'call-and-answer', Title: 'Timer session' });
  const state = { PK: `GAME#${id}`, SK: 'STATE', State: 'ASK#001', LessonNumber: 1, CurrentQuestionId: '001', PhaseStartedAt: iso(Date.now() - agoMs), TimePhase: 'ASK#001', ...extra };
  if (limitMs) Object.assign(state, { TimeLimitMs: limitMs, TimeExtendedMs: extendedMs, TimeOnWall: onWall, TimeCloses: closes });
  put(state);
  put({ PK: `GAME#${id}`, SK: 'CONNECTION#host-1', ConnectionId: 'host-1', ConnectionType: 'HOST' });
  put({ PK: `GAME#${id}`, SK: 'CONNECTION#player-1', ConnectionId: 'player-1', ConnectionType: 'PLAYER', PlayerName: 'Ada' });
  for (const p of answers) put({ PK: `GAME#${id}`, SK: `QUESTION#001#ANSWER#${p}`, PlayerName: p, Answer: `${p} says`, SubmittedAt: iso(Date.now()) });
}

const vote = (id, body) => startVote({ pathParameters: { gameId: id }, body: JSON.stringify({ questionNumber: 1, ...body }) });
const plusOne = (id, phase = 'ASK#001') => stageBeat({ requestContext: { http: { method: 'POST' } }, pathParameters: { gameId: id }, body: JSON.stringify({ addTime: true, phase }) });
const readPublic = async (id, query) => JSON.parse((await getState({ requestContext: { http: { method: 'GET' } }, pathParameters: { gameId: id }, ...(query ? { queryStringParameters: query } : {}) })).body);
const readHost = async (id) => JSON.parse((await getState({
  requestContext: { http: { method: 'GET' }, routeKey: 'GET /games/{gameId}/host-state', authorizer: { lambda: { userId: 'host-user', groups: 'hosts' } } },
  pathParameters: { gameId: id },
})).body);
const framesOf = (type) => sent.filter((s) => s.message.type === type);

(async () => {
  say('\nround timer: server fields, +1 min, the close at zero, and what each reader sees\n');

  say('1. the rules');
  await check('presets only; anything else is No limit; the wall shows it by default; closing is opt-in', () => {
    assert.deepStrictEqual(RT.PRESET_MS, [0, MIN, 2 * MIN, 3 * MIN, 5 * MIN]);
    assert.deepStrictEqual(RT.timerFromBody({ limitMs: 2 * MIN }), { limitMs: 2 * MIN, onWall: true, closes: false });
    assert.deepStrictEqual(RT.timerFromBody({ limitMs: 90000, closes: true }), { limitMs: 0, onWall: true, closes: false }, 'not a preset');
    assert.deepStrictEqual(RT.timerFromBody({ limitMs: 0, closes: true }), { limitMs: 0, onWall: true, closes: false }, 'closing means nothing without a limit');
    assert.deepStrictEqual(RT.timerFromBody({ limitMs: MIN, onWall: false, closes: true }), { limitMs: MIN, onWall: false, closes: true });
    assert.deepStrictEqual(RT.timerFromBody(null), { limitMs: 0, onWall: true, closes: false });
  });
  await check('an opening with no time uses the session\'s last choice for that kind, else No limit', () => {
    const state = { TimeChoiceAsk: { limitMs: 3 * MIN, onWall: false, closes: true } };
    assert.deepStrictEqual(RT.timerForOpening({}, state, 'ask'), { limitMs: 3 * MIN, onWall: false, closes: true });
    assert.deepStrictEqual(RT.timerForOpening({}, state, 'vote'), { limitMs: 0, onWall: true, closes: false }, 'voting defaults to No limit (Q3)');
    assert.deepStrictEqual(RT.timerForOpening({ time: { limitMs: 0 } }, state, 'ask').limitMs, 0, 'an explicit No limit wins');
  });
  await check('+1 min with time left adds a minute; once time is up it is a minute from now (server clock)', () => {
    const start = Date.parse('2026-11-02T10:00:00.000Z');
    const state = { State: 'ASK#001', TimePhase: 'ASK#001', PhaseStartedAt: iso(start), TimeLimitMs: 2 * MIN, TimeExtendedMs: 0 };
    // 0:47 left -> 1:47 left
    assert.strictEqual(RT.extendedAfterPlusOne(state, start + 73000), MIN);
    // 0:18 over -> a minute from now: ends = now + 60s
    const now = start + 2 * MIN + 18000;
    const ext = RT.extendedAfterPlusOne(state, now);
    assert.strictEqual(start + 2 * MIN + ext, now + MIN);
    assert.strictEqual(RT.extendedAfterPlusOne({ ...state, TimeLimitMs: undefined }, now), null, 'no limit, nothing to extend');
    assert.strictEqual(RT.extendedAfterPlusOne({ ...state, TimeExtendedMs: RT.MAX_EXTENDED_MS }, now), RT.MAX_EXTENDED_MS, 'capped');
  });
  await check('due only with the opt-in, on its own phase, at or after zero', () => {
    const start = Date.parse('2026-11-02T10:00:00.000Z');
    const state = { State: 'ASK#001', TimePhase: 'ASK#001', PhaseStartedAt: iso(start), TimeLimitMs: MIN, TimeExtendedMs: 0, TimeCloses: true };
    assert.strictEqual(RT.isDue(state, start + 59999), false);
    assert.strictEqual(RT.isDue(state, start + MIN), true);
    assert.strictEqual(RT.isDue({ ...state, TimeCloses: false }, start + 2 * MIN), false, 'advisory by default');
    assert.strictEqual(RT.isDue({ ...state, State: 'VOTE#001' }, start + 2 * MIN), false, 'the phase has moved on');
    assert.strictEqual(RT.isDue({ ...state, TimeExtendedMs: MIN }, start + MIN + 1000), false, '+1 min pushes zero back');
  });

  say('\n2. start-vote opens voting with its own timer');
  seed('4101', { limitMs: 2 * MIN });
  const before = Date.now();
  const opened = await vote('4101', { time: { limitMs: MIN, onWall: true } });
  await check('200, VOTE#001, PhaseStartedAt stamped by the server as voting opens', () => {
    assert.strictEqual(opened.statusCode, 200, opened.body);
    const s = stateOf('4101');
    assert.strictEqual(s.State, 'VOTE#001');
    const at = Date.parse(s.PhaseStartedAt);
    assert.ok(at >= before - 5 && at <= Date.now() + 5, `PhaseStartedAt ${s.PhaseStartedAt}`);
  });
  await check('the voting timer replaces the answering one: TimePhase VOTE#001, 1 min, nothing added yet', () => {
    const s = stateOf('4101');
    assert.strictEqual(s.TimePhase, 'VOTE#001');
    assert.strictEqual(s.TimeLimitMs, MIN);
    assert.strictEqual(s.TimeExtendedMs, 0);
    assert.strictEqual(s.TimeOnWall, true);
    assert.strictEqual(s.TimeCloses, false);
    assert.deepStrictEqual(s.TimeChoiceVote, { limitMs: MIN, onWall: true, closes: false });
  });
  await check('votingStarted tells the room only what the wall needs, with the server clock', () => {
    const frame = framesOf('votingStarted')[0].message;
    assert.deepStrictEqual(Object.keys(frame.time).sort(), ['extendedMs', 'limitMs', 'phase', 'startedAt']);
    assert.strictEqual(frame.time.limitMs, MIN);
    assert.ok(Number.isFinite(frame.serverNow));
    const hostFrames = framesOf('roundTimeChanged');
    assert.deepStrictEqual(hostFrames.map((f) => f.connectionId), ['host-1'], 'the whole timer goes to host screens only');
    assert.strictEqual(hostFrames[0].message.time.closes, false);
  });
  await check('the response carries hostTime and serverNow', () => {
    const body = JSON.parse(opened.body);
    assert.strictEqual(body.hostTime.phase, 'VOTE#001');
    assert.ok(Number.isFinite(body.serverNow));
  });

  seed('4102', { limitMs: 2 * MIN });
  await vote('4102', {});
  await check('a vote opened with no time (the Remote, an old client) has No limit: the answering timer is removed', () => {
    const s = stateOf('4102');
    assert.strictEqual(s.State, 'VOTE#001');
    assert.strictEqual(s.TimePhase, 'VOTE#001');
    assert.ok(!('TimeLimitMs' in s) && !('TimeExtendedMs' in s) && !('TimeCloses' in s) && !('TimeOnWall' in s), JSON.stringify(s));
    assert.strictEqual(framesOf('votingStarted')[0].message.time, null);
  });

  seed('4103', { limitMs: 2 * MIN, extra: { TimeChoiceVote: { limitMs: 3 * MIN, onWall: false, closes: false } } });
  await vote('4103', {});
  await check('...unless this session chose a voting time before, which carries over', () => {
    assert.strictEqual(stateOf('4103').TimeLimitMs, 3 * MIN);
    assert.strictEqual(stateOf('4103').TimeOnWall, false);
    assert.strictEqual(framesOf('votingStarted')[0].message.time, null, 'not shown on the wall, so not on the public frame');
    assert.strictEqual(framesOf('roundTimeChanged')[0].message.time.limitMs, 3 * MIN, 'the host still hears it');
  });

  say('\n3. +1 min');
  seed('4201', { agoMs: 73000, limitMs: 2 * MIN });
  const add = await plusOne('4201');
  await check('0:47 left: one more minute, written on STATE', () => {
    assert.strictEqual(add.statusCode, 200, add.body);
    assert.strictEqual(stateOf('4201').TimeExtendedMs, MIN);
    assert.strictEqual(JSON.parse(add.body).hostTime.extendedMs, MIN);
  });
  await check('the room and the host hear roundTimeChanged with the public shape', () => {
    const frames = framesOf('roundTimeChanged');
    assert.deepStrictEqual(frames.map((f) => f.connectionId).sort(), ['host-1', 'player-1']);
    assert.deepStrictEqual(Object.keys(frames[0].message.time).sort(), ['extendedMs', 'limitMs', 'phase', 'startedAt']);
    assert.ok(Number.isFinite(frames[0].message.serverNow));
  });
  await plusOne('4201');
  await check('a second press adds a second minute', () => assert.strictEqual(stateOf('4201').TimeExtendedMs, 2 * MIN));

  seed('4202', { agoMs: 2 * MIN + 18000, limitMs: 2 * MIN });
  const late = await plusOne('4202');
  await check('0:18 over: a minute from now by the server\'s clock, not 0:42', () => {
    assert.strictEqual(late.statusCode, 200, late.body);
    const s = stateOf('4202');
    const left = RT.endsAtMs(s) - Date.now();
    assert.ok(left > 58000 && left <= 60000, `left ${left}ms`);
  });

  seed('4203', { limitMs: 2 * MIN, onWall: false });
  await plusOne('4203');
  await check('a timer the room is not shown: +1 min is told to host screens only', () => {
    assert.deepStrictEqual(framesOf('roundTimeChanged').map((f) => f.connectionId), ['host-1']);
  });

  seed('4204', { limitMs: 2 * MIN });
  const stale = await plusOne('4204', 'ASK#002');
  await check('a press for a phase that is not on is refused and adds nothing', () => {
    assert.strictEqual(stale.statusCode, 409, stale.body);
    assert.strictEqual(stateOf('4204').TimeExtendedMs, 0);
    assert.strictEqual(sent.length, 0);
  });
  seed('4205', { limitMs: 0 });
  const unlimited = await plusOne('4205');
  await check('no limit: nothing to extend (409)', () => assert.strictEqual(unlimited.statusCode, 409, unlimited.body));
  const badShape = await stageBeat({ pathParameters: { gameId: '4205' }, body: JSON.stringify({ addTime: true, profile: 'room', phase: 'ASK#001' }) });
  await check('mixed with another stage-beat shape: refused', () => assert.strictEqual(badShape.statusCode, 400));
  const noPhase = await stageBeat({ pathParameters: { gameId: '4205' }, body: JSON.stringify({ addTime: true }) });
  await check('without the phase it was pressed on: refused', () => assert.strictEqual(noPhase.statusCode, 400));

  say('\n4. the close at zero');
  seed('4301', { agoMs: 2 * MIN + 1000, limitMs: 2 * MIN, closes: false });
  const advisory = await vote('4301', { timeUp: true });
  await check('advisory (not opted in): refused, the room stays on answering', () => {
    assert.strictEqual(advisory.statusCode, 409, advisory.body);
    assert.strictEqual(stateOf('4301').State, 'ASK#001');
    assert.strictEqual(sent.length, 0);
  });
  seed('4302', { agoMs: 30000, limitMs: 2 * MIN, closes: true });
  const early = await vote('4302', { timeUp: true });
  await check('opted in but zero not reached by the SERVER\'s clock (a skewed laptop): refused with time left', () => {
    assert.strictEqual(early.statusCode, 409, early.body);
    const body = JSON.parse(early.body);
    assert.ok(body.remainingMs > 80000 && body.remainingMs <= 90000, `remainingMs ${body.remainingMs}`);
    assert.strictEqual(stateOf('4302').State, 'ASK#001');
  });
  seed('4303', { agoMs: 2 * MIN + 1000, limitMs: 2 * MIN, closes: true });
  const due = await vote('4303', { timeUp: true });
  const second = await vote('4303', { timeUp: true });
  await check('opted in and zero reached: voting opens', () => {
    assert.strictEqual(due.statusCode, 200, due.body);
    assert.strictEqual(stateOf('4303').State, 'VOTE#001');
    assert.strictEqual(JSON.parse(due.body).closedAtZero, true);
  });
  await check('the second screen\'s close is a no-op: each screen hears votingStarted once', () => {
    assert.strictEqual(second.statusCode, 200, second.body);
    assert.strictEqual(JSON.parse(second.body).alreadyMoved, true);
    assert.deepStrictEqual(framesOf('votingStarted').map((f) => f.connectionId).sort(), ['host-1', 'player-1']);
  });
  seed('4304', { agoMs: 2 * MIN + 1000, limitMs: 2 * MIN, closes: true, answers: [] });
  const empty = await vote('4304', { timeUp: true });
  await check('nobody answered: a timer does not open a vote on nothing', () => {
    assert.strictEqual(empty.statusCode, 409, empty.body);
    assert.strictEqual(stateOf('4304').State, 'ASK#001');
  });
  seed('4305', { agoMs: 2 * MIN + 1000, limitMs: 2 * MIN, closes: true });
  await check('the host\'s own Start voting is never held by the timer', async () => {
    const res = await vote('4305', {});
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(stateOf('4305').State, 'VOTE#001');
  });

  say('\n5. what each reader is told');
  seed('4401', { agoMs: 30000, limitMs: 2 * MIN, extendedMs: MIN, closes: true });
  const pub = await readPublic('4401');
  const room = await readPublic('4401', { view: 'room' });
  const host = await readHost('4401');
  await check('public /state (and ?view=room): only phase, startedAt, limitMs, extendedMs', () => {
    for (const body of [pub, room]) {
      assert.deepStrictEqual(Object.keys(body.time).sort(), ['extendedMs', 'limitMs', 'phase', 'startedAt']);
      assert.strictEqual(body.time.limitMs, 2 * MIN);
      assert.strictEqual(body.time.extendedMs, MIN);
      assert.ok(Number.isFinite(body.serverNow));
      assert.ok(!('hostTime' in body), 'the host\'s timer is not public');
      assert.ok(!JSON.stringify(body).includes('closes'), 'whether it closes is the host\'s business');
    }
  });
  await check('the host\'s door: the same public time, plus hostTime with onWall and closes, and phaseStartedAt', () => {
    assert.deepStrictEqual(host.time, pub.time);
    assert.strictEqual(host.hostTime.closes, true);
    assert.strictEqual(host.hostTime.onWall, true);
    assert.strictEqual(host.phaseStartedAt, stateOf('4401').PhaseStartedAt);
    assert.ok(Number.isFinite(host.serverNow));
  });
  seed('4402', { limitMs: 2 * MIN, onWall: false });
  await check('"show the time" off: the public read carries no time; the host still has it', async () => {
    assert.strictEqual((await readPublic('4402')).time, null);
    assert.strictEqual((await readHost('4402')).hostTime.limitMs, 2 * MIN);
  });
  seed('4403', { limitMs: 2 * MIN, extra: { State: 'RESULTS#001' } });
  await check('after its phase closes: gone from the public read, kept for the host ("2:00 given")', async () => {
    assert.strictEqual((await readPublic('4403')).time, null);
    assert.strictEqual((await readHost('4403')).hostTime.phase, 'ASK#001');
  });
  seed('4404', { limitMs: 0 });
  await check('no limit: time is null everywhere', async () => {
    assert.strictEqual((await readPublic('4404')).time, null);
    assert.strictEqual((await readHost('4404')).hostTime, null);
  });

  say('\n6. structure');
  await check('game/round-timer.js and websocket/round-timer.js are identical (separate bundles)', () => {
    const a = fs.readFileSync(path.join(REPO, 'lambda-functions/game/round-timer.js'), 'utf8');
    const b = fs.readFileSync(path.join(REPO, 'lambda-functions/websocket/round-timer.js'), 'utf8');
    assert.strictEqual(a, b);
  });
  await check('no new route: +1 min rides /stage-beat (the stack is near its 500-resource limit)', () => {
    const tpl = fs.readFileSync(path.join(REPO, 'template-clean.yaml'), 'utf8');
    assert.ok(!/Path: \/games\/\{gameId\}\/time\b/.test(tpl), 'a /time route appeared');
  });

  suiteFinished();
  say(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
