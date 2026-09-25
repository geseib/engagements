/**
 * THE SCOREBOARD'S SESSION STATE — `POST /games/{gameId}/scoreboard`.
 *
 * docs/superpowers/specs/2026-09-25-scoreboard-design.md §2–§3. The board is
 * one session-level fact, not a per-round one (so it also works in ENDED):
 *
 *   STATE.Scoreboard = { open, style, openedAt, page }
 *
 * written by this route, announced as `scoreboardChanged`, and read back by
 * `get-game-state` so a refreshed host page reopens it and the phone remote —
 * which polls `/state` and holds no socket — can draw its button truthfully.
 *
 * `stage-focus.js` is the sibling this copies, and the harness here is the
 * shared single-table fake (helpers/player-table.js), which APPLIES updates
 * rather than returning `{}` — a handler that broadcast the board but never
 * wrote it would otherwise pass, and lose the board on the next reload.
 *
 *   §1  open: persisted, announced, idempotent
 *   §2  style and step, and their validation
 *   §3  only Trivia and Call & Answer have a board
 *   §4  whose room: another organisation's host is refused, and nothing moves
 *   §5  get-game-state reads it back
 *   §6  the template and the frontend's copy of the vocabulary
 */
const suiteFinished = require('./helpers/finish-guard');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const { createTable, installStubs } = require('./helpers/player-table');
const { routesFromTemplate, findRoute, assertScannerWorks } = require('./helpers/template-routes');

const table = createTable();
const sent = [];
const frames = [];
const gone = new Set();
installStubs({ table, sent, frames, gone });

process.env.TABLE_NAME = 'test-table';
process.env.WEBSOCKET_API_ENDPOINT = 'https://ws.test.invalid/dev';

const { handler: scoreboard } = require(path.join(REPO, 'lambda-functions/game/scoreboard.js'));
const { handler: getState } = require(path.join(REPO, 'lambda-functions/game/get-game-state.js'));
const { SCOREBOARD_STYLES } = require(path.join(REPO, 'lambda-functions/game/scoreboard-state.js'));

let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const ORG_A = 'org_9xK4Fq7Pz2mNbVc8dQwLxR';   // owns the room
const ORG_B = 'org_Tb2VnQ8sLxK4WmC7gRdYpF';   // a rival holding only the code
const GAME = '6060';
const PK = `GAME#${GAME}`;

function seed({ gameType = 'trivia', orgId = ORG_A, state = 'RESULTS#003', scoreboardRow } = {}) {
  table.clear();
  sent.length = 0;
  frames.length = 0;
  gone.clear();
  table.put({ PK, SK: 'METADATA', Title: 'Room', GameType: gameType, ...(orgId ? { orgId } : {}) });
  table.put({
    PK, SK: 'STATE', State: state, LessonNumber: 3, CurrentQuestionId: '003',
    ...(scoreboardRow ? { Scoreboard: scoreboardRow } : {}),
  });
  table.put({ PK, SK: 'CONNECTION#host-1', ConnectionId: 'host-1', ConnectionType: 'HOST' });
  table.put({ PK, SK: 'CONNECTION#player-1', ConnectionId: 'player-1', ConnectionType: 'PLAYER', PlayerName: 'Ada' });
}

const hostOf = (orgId) => ({
  http: { method: 'POST' },
  authorizer: { lambda: { userId: 'u', groups: 'hosts', ...(orgId ? { orgId } : {}) } },
});

const post = (body, { orgId = ORG_A, raw } = {}) => scoreboard({
  requestContext: hostOf(orgId),
  pathParameters: { gameId: GAME },
  body: raw !== undefined ? raw : JSON.stringify(body),
});

const stored = () => table.get(PK, 'STATE').Scoreboard;
const readState = async () => JSON.parse(
  (await getState({ pathParameters: { gameId: GAME }, queryStringParameters: { role: 'host' } })).body
);

(async () => {
  console.log('\n1. opening the board persists it on STATE and tells the room');
  seed();
  const opened = await post({ open: true });
  await check('200', () => assert.strictEqual(opened.statusCode, 200, opened.body));
  await check('STATE.Scoreboard says open, on the first page, in the default look', () => {
    const sb = stored();
    assert.strictEqual(sb.open, true);
    assert.strictEqual(sb.page, 0);
    assert.strictEqual(sb.style, 'departure');
    assert.ok(typeof sb.openedAt === 'string' && sb.openedAt, 'openedAt is a timestamp');
  });
  await check('the rest of STATE is untouched — an UPDATE, never a PUT', () => {
    const st = table.get(PK, 'STATE');
    assert.strictEqual(st.State, 'RESULTS#003');
    assert.strictEqual(st.LessonNumber, 3);
  });
  await check('every connection got a frame', () =>
    assert.deepStrictEqual(frames.map((f) => f.connectionId).sort(), ['host-1', 'player-1']));
  await check('the frame is scoreboardChanged with open, style, page and openedAt', () => {
    const m = frames[0].message;
    // NOT gameStateChanged: that type makes GameHostPage call restoreGameState,
    // which rewrites currentQuestionId — stage-beat.js documents the trap.
    assert.strictEqual(m.type, 'scoreboardChanged');
    assert.strictEqual(m.gameId, GAME);
    assert.strictEqual(m.open, true);
    assert.strictEqual(m.style, 'departure');
    assert.strictEqual(m.page, 0);
    assert.strictEqual(m.openedAt, stored().openedAt);
  });
  await check('the frame names nobody', () =>
    // The board's rows are fetched from /players by the stage; the frame is
    // only the board's own state.
    assert.ok(!/Ada/.test(JSON.stringify(frames.map((f) => f.message)))));

  const firstOpenedAt = stored().openedAt;
  await new Promise((r) => setTimeout(r, 5));
  const twice = await post({ open: true });
  await check('opening an open board is a 200 that does not restart it', () => {
    // A double-tap must not throw the room back to page 1 and replay the
    // auto-flip from the top.
    assert.strictEqual(twice.statusCode, 200, twice.body);
    assert.strictEqual(stored().openedAt, firstOpenedAt);
  });

  const closed = await post({ open: false });
  await check('closing persists open:false and is announced', () => {
    assert.strictEqual(closed.statusCode, 200, closed.body);
    assert.strictEqual(stored().open, false);
    assert.strictEqual(frames[frames.length - 1].message.open, false);
  });
  await check('closing keeps the chosen look', () => assert.strictEqual(stored().style, 'departure'));

  const reopened = await post({ open: true });
  await check('reopening starts a new opening: a new openedAt, page 0', () => {
    assert.strictEqual(reopened.statusCode, 200);
    assert.notStrictEqual(stored().openedAt, firstOpenedAt);
    assert.strictEqual(stored().page, 0);
  });

  console.log('\n2. style and step');
  seed();
  await post({ open: true });
  await post({ step: 'next' });
  await post({ step: 'next' });
  await check('step next counts up', () => assert.strictEqual(stored().page, 2));
  await post({ step: 'prev' });
  await check('step prev counts down', () => assert.strictEqual(stored().page, 1));
  await check('a step is announced with the new page', () =>
    assert.strictEqual(frames[frames.length - 1].message.page, 1));

  const openedAtBefore = stored().openedAt;
  const styled = await post({ style: 'tote' });
  await check('switching the look while open applies live: same opening, same page', () => {
    assert.strictEqual(styled.statusCode, 200, styled.body);
    assert.strictEqual(stored().style, 'tote');
    assert.strictEqual(stored().open, true);
    assert.strictEqual(stored().page, 1);
    assert.strictEqual(stored().openedAt, openedAtBefore);
    assert.strictEqual(frames[frames.length - 1].message.style, 'tote');
  });

  seed();
  const settingOnly = await post({ style: 'olympic' });
  await check('the look can be set with the board closed (the Settings tab)', () => {
    assert.strictEqual(settingOnly.statusCode, 200, settingOnly.body);
    assert.strictEqual(stored().style, 'olympic');
    assert.strictEqual(stored().open, false);
  });
  const openAfter = await post({ open: true });
  await check('...and the board then opens in it', () => {
    assert.strictEqual(openAfter.statusCode, 200);
    assert.strictEqual(stored().style, 'olympic');
  });

  for (const [label, body] of [
    ['an unknown style', { style: 'neon' }],
    ['an unknown step', { step: 'sideways' }],
    ['a non-boolean open', { open: 'yes' }],
    ['an empty body', {}],
  ]) {
    seed();
    const res = await post(body);
    await check(`${label} is a 400, and nothing is written or sent`, () => {
      assert.strictEqual(res.statusCode, 400, `got ${res.statusCode}: ${res.body}`);
      assert.strictEqual(stored(), undefined);
      assert.strictEqual(frames.length, 0);
    });
  }

  seed();
  const stepClosed = await post({ step: 'next' });
  await check('a step with the board closed is refused: there is no page to turn', () => {
    assert.strictEqual(stepClosed.statusCode, 409, `got ${stepClosed.statusCode}`);
    assert.strictEqual(frames.length, 0);
  });

  console.log('\n3. only Trivia and Call & Answer have a board');
  for (const gameType of ['poll', 'polls', 'wavelength', 'survey']) {
    seed({ gameType });
    const res = await post({ open: true });
    await check(`${gameType}: refused with 409, nothing written, nothing sent`, () => {
      assert.strictEqual(res.statusCode, 409, `got ${res.statusCode}: ${res.body}`);
      assert.strictEqual(stored(), undefined);
      assert.strictEqual(frames.length, 0);
    });
  }
  for (const gameType of ['trivia', 'quiz', 'call-and-answer']) {
    seed({ gameType });
    const res = await post({ open: true });
    await check(`${gameType}: allowed`, () => assert.strictEqual(res.statusCode, 200, res.body));
  }
  seed({ state: 'ENDED' });
  const ended = await post({ open: true });
  await check('it opens in ENDED too — it is a session fact, not a round fact', () =>
    assert.strictEqual(ended.statusCode, 200, ended.body));

  console.log('\n4. whose room is this?');
  seed();
  const rival = await post({ open: true }, { orgId: ORG_B });
  await check('another organisation\'s host is refused', () =>
    // 404, not 403: a 403 would confirm that a guessed four-digit code names a
    // real session belonging to somebody else (tenant.callerMayDriveSession).
    assert.strictEqual(rival.statusCode, 404, `got ${rival.statusCode}`));
  await check('the refusal wrote nothing and told nobody', () => {
    assert.strictEqual(stored(), undefined);
    assert.strictEqual(frames.length, 0);
  });
  seed({ orgId: null });
  const orgless = await post({ open: true }, { orgId: ORG_B });
  await check('a session with no owning org is left alone', () =>
    assert.strictEqual(orgless.statusCode, 200, orgless.body));

  seed();
  gone.add('host-1');
  const withDead = await post({ open: true });
  await check('a dead socket does not cost the write, and its row is reaped', () => {
    assert.strictEqual(withDead.statusCode, 200);
    assert.strictEqual(stored().open, true);
    assert.deepStrictEqual(frames.map((f) => f.connectionId), ['player-1']);
    assert.strictEqual(table.get(PK, 'CONNECTION#host-1'), undefined);
  });

  const junk = await post(null, { raw: 'not json' });
  await check('a body that is not JSON is a 400', () => assert.strictEqual(junk.statusCode, 400));
  const noGame = await scoreboard({ requestContext: hostOf(ORG_A), pathParameters: {}, body: '{"open":true}' });
  await check('a missing gameId is a 400', () => assert.strictEqual(noGame.statusCode, 400));
  const missing = await scoreboard({ requestContext: hostOf(ORG_A), pathParameters: { gameId: '9999' }, body: '{"open":true}' });
  await check('a session that does not exist is a 404', () => assert.strictEqual(missing.statusCode, 404));
  const preflight = await scoreboard({ requestContext: { http: { method: 'OPTIONS' } }, pathParameters: { gameId: GAME } });
  await check('OPTIONS is answered', () => assert.strictEqual(preflight.statusCode, 200));

  console.log('\n5. get-game-state reads it back');
  seed();
  await post({ style: 'tote' });
  await post({ open: true });
  const back = await readState();
  await check('the state carries the board', () => {
    assert.strictEqual(back.scoreboard.open, true);
    assert.strictEqual(back.scoreboard.style, 'tote');
    assert.strictEqual(back.scoreboard.page, 0);
    assert.strictEqual(back.scoreboard.openedAt, stored().openedAt);
  });
  seed();
  const none = await readState();
  await check('a session nobody has opened a board in reads closed, in the default look', () =>
    // Never undefined: a client inventing its own default is how two
    // surfaces come to disagree.
    assert.deepStrictEqual(none.scoreboard, { open: false, style: 'departure', page: 0, openedAt: null }));
  seed({ scoreboardRow: { open: true, style: 'hologram', page: 'two', openedAt: '2026-09-25T18:00:00.000Z' } });
  const odd = await readState();
  await check('a stored look this build does not know reads as the default; a junk page as 0', () => {
    assert.strictEqual(odd.scoreboard.style, 'departure');
    assert.strictEqual(odd.scoreboard.page, 0);
    assert.strictEqual(odd.scoreboard.open, true);
  });

  console.log('\n6. the template, and the frontend\'s copy of the vocabulary');
  const routes = routesFromTemplate();
  await check('the scanner works', () => assertScannerWorks(routes));
  await check('POST /games/{gameId}/scoreboard carries the Cognito authorizer', () => {
    const hit = findRoute(routes, 'POST', '/games/{gameId}/scoreboard');
    assert.ok(hit, 'route missing from template-clean.yaml');
    assert.strictEqual(hit.authorizer, 'CognitoAuthorizer');
  });
  const template = fs.readFileSync(path.join(REPO, 'template-clean.yaml'), 'utf8');
  const block = (template.split(/\n  ScoreboardFunction:\n/)[1] || '').split(/\n  [A-Z]\w+:\n/)[0];
  await check('the function uses scoreboard.handler from lambda-functions/game/', () => {
    assert.ok(block, 'ScoreboardFunction is not declared');
    assert.match(block, /CodeUri:\s*lambda-functions\/game\//);
    assert.match(block, /Handler:\s*scoreboard\.handler/);
  });
  await check('Crud, not Write: the broadcast reaps dead connections with DeleteItem', () =>
    assert.match(block, /DynamoDBCrudPolicy:/));
  await check('it may post to connections', () =>
    assert.match(block, /execute-api:ManageConnections/));

  const frontend = fs.readFileSync(path.join(REPO, 'src/src/config/scoreboard.js'), 'utf8');
  const m = /export const SCOREBOARD_STYLES\s*=\s*\[([^\]]*)\]/.exec(frontend);
  await check('src/src/config/scoreboard.js lists the same looks, in the same order', () => {
    assert.ok(m, 'SCOREBOARD_STYLES not found in the frontend config');
    const list = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    assert.deepStrictEqual(list, SCOREBOARD_STYLES);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
