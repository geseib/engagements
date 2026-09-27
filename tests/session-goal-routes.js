/**
 * A SESSION'S GOAL ON THE WIRE — POST /games (websocket/create-game.js),
 * PUT /games/{gameId} (game/update-game.js), and the two host doors that read
 * it back: GET /games/{id}/host-details (game/get-game.js) and
 * GET /games/{id}/host-state (game/get-game-state.js). Events M1b.
 *
 * rejects: a goal larger than the set, or a fraction, stored; a goal on a
 * survey; the size read from the set's newest version for a session pinned to
 * an older one; a refused goal that still makes a session; a PUT that cannot
 * clear a goal; a goal edited after the start; the public /state carrying the
 * goal to every phone.
 */
const suiteFinished = require('./helpers/finish-guard');
const assert = require('assert');
const { installEventHarness, asHost, seedOrg, bodyOf } = require('./helpers/event-harness');

const h = installEventHarness();
const { table } = h;
const create = h.load('lambda-functions/websocket/create-game.js').handler;
const update = h.load('lambda-functions/game/update-game.js').handler;
const getGame = h.load('lambda-functions/game/get-game.js').handler;
const getState = h.load('lambda-functions/game/get-game-state.js').handler;

let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok - ${label}`); pass += 1; }
  catch (e) { console.log(`  FAIL - ${label}\n    ${e.message}`); fail += 1; }
}

const NW = 'org_nw';
const newSession = (body) => create({
  body: JSON.stringify({
    eventTitle: 'Offsite', gameType: 'trivia', questionSetId: 'space', questionSetScope: 'platform', ...body,
  }),
  requestContext: asHost(NW),
});
const put = (gameId, body) => update({
  pathParameters: { gameId }, body: JSON.stringify(body), requestContext: asHost(NW),
});
const door = (gameId, suffix) => ({
  pathParameters: { gameId },
  rawPath: `/games/${gameId}${suffix}`,
  requestContext: { ...asHost(NW), http: { method: 'GET', path: `/games/${gameId}${suffix}` } },
});
const metadata = (gameId) => table.get(`GAME#${gameId}`, 'METADATA');
const sessionCount = () => [...table.store.values()]
  .filter((r) => r.SK === 'METADATA' && String(r.PK).startsWith('GAME#')).length;

(async () => {
  table.clear();
  seedOrg(table, NW);
  table.put({
    PK: 'SETS', SK: 'SET#space', name: 'Space Trivia', engagementType: 'trivia', questionCount: 12,
    activeVersion: 2, versions: [{ version: 1, questionCount: 8 }, { version: 2, questionCount: 12 }],
  });

  console.log('\n1. creating a session with a goal');
  let gameId;
  await check('a goal within the set is stored on METADATA as Target', async () => {
    const res = await newSession({ target: 5 });
    assert.strictEqual(res.statusCode, 201, res.body);
    gameId = bodyOf(res).gameId;
    assert.strictEqual(metadata(gameId).Target, 5);
  });
  await check('no goal writes no Target', async () => {
    const res = await newSession({});
    assert.strictEqual(res.statusCode, 201, res.body);
    assert.ok(!('Target' in metadata(bodyOf(res).gameId)));
  });
  for (const [label, body, error] of [
    ['more questions than the set holds', { target: 13 }, /This set has 12 questions/],
    ['more than an explicitly pinned older version holds', { target: 9, questionSetVersion: 1 }, /This set has 8 questions/],
    ['zero', { target: 0 }, /whole number of questions/],
    ['a fraction', { target: 2.5 }, /whole number of questions/],
    ['a word', { target: 'five' }, /whole number of questions/],
    ['a survey', { gameType: 'survey', target: 3 }, /survey .* no goal/],
  ]) {
    await check(`${label}: 400, and no session is made`, async () => {
      const before = sessionCount();
      const res = await newSession(body);
      assert.strictEqual(res.statusCode, 400, res.body);
      assert.match(bodyOf(res).error, error);
      assert.strictEqual(sessionCount(), before);
    });
  }

  console.log('\n2. changing the goal before the start');
  await check('PUT sets a new goal', async () => {
    const res = await put(gameId, { target: 7 });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(bodyOf(res).updated.target, 7);
    assert.strictEqual(metadata(gameId).Target, 7);
  });
  await check('PUT null clears it', async () => {
    const res = await put(gameId, { target: null });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.ok(!('Target' in metadata(gameId)));
  });
  await check('the size is the PINNED version\'s, not the set\'s newest', async () => {
    const older = bodyOf(await newSession({ target: 4, questionSetVersion: 1 })).gameId;
    assert.strictEqual(metadata(older).QuestionSetVersion, 1);
    const over = await put(older, { target: 10 });
    assert.strictEqual(over.statusCode, 400, over.body);
    assert.match(bodyOf(over).error, /This set has 8 questions/);
    assert.strictEqual(metadata(older).Target, 4);
  });
  await check('a survey: 400', async () => {
    table.put({ PK: 'GAME#7777', SK: 'METADATA', orgId: NW, GameType: 'survey', QuestionSetId: 'space', QuestionSetScope: 'platform' });
    table.put({ PK: 'GAME#7777', SK: 'STATE', State: 'CREATED' });
    const res = await put('7777', { target: 3 });
    assert.strictEqual(res.statusCode, 400, res.body);
    assert.match(bodyOf(res).error, /no goal/);
    assert.ok(!('Target' in table.get('GAME#7777', 'METADATA')));
  });
  await check('after the start: refused by the CREATED gate, as every edit is', async () => {
    table.put({ ...table.get(`GAME#${gameId}`, 'STATE'), State: 'STARTED' });
    const res = await put(gameId, { target: 3 });
    assert.strictEqual(res.statusCode, 400, res.body);
    assert.ok(!('Target' in metadata(gameId)));
    table.put({ ...table.get(`GAME#${gameId}`, 'STATE'), State: 'CREATED' });
  });

  console.log('\n3. the host reads it back');
  await put(gameId, { target: 6 });
  await check('host-details carries the goal, for the edit dialog', async () => {
    const res = await getGame(door(gameId, '/host-details'));
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(bodyOf(res).target, 6);
  });
  await check('host-state carries it, for the stage and the remote', async () => {
    const res = await getState(door(gameId, '/host-state'));
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(bodyOf(res).target, 6);
  });

  console.log('\n4. the room never reads it');
  await check('the public /state carries no goal, anywhere', async () => {
    const res = await getState({
      pathParameters: { gameId },
      rawPath: `/games/${gameId}/state`,
      requestContext: { http: { method: 'GET', path: `/games/${gameId}/state` } },
    });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.ok(!('target' in bodyOf(res)));
    assert.ok(!/"target"/.test(res.body));
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})();
