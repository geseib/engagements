/**
 * THE DISABLED-QUESTIONS ENDPOINT — lambda-functions/game/question-exclusions.js
 *
 * The third of the owner's four queue verbs ("move up/move down/disable/move
 * back out"). The op arithmetic is tested directly; the handler runs against
 * the same fake table the queue suites use. How the veto is HONOURED — no
 * round for a disabled question, drain drops a disabled queued entry, a
 * category emptied by vetoes does not end the session — is pinned in
 * tests/up-next-endpoint.js, where the serve and the preview can be run
 * against one fixture.
 */
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const { createTable, installStubs } = require('./helpers/player-table');

const table = createTable();
const store = table.store;
const sent = [];
installStubs({ table, sent });

process.env.TABLE_NAME = 'test-table';

const exclusions = require(path.join(REPO, 'lambda-functions/game/question-exclusions.js'));
const queue = require(path.join(REPO, 'lambda-functions/game/question-queue.js'));

let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const GAME = '6200';
const PK = `GAME#${GAME}`;

const call = async (method, body) => {
  const res = await exclusions.handler({
    requestContext: { http: { method } },
    pathParameters: { gameId: GAME },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { statusCode: res.statusCode, body: JSON.parse(res.body) };
};

const row = () => store.get(table.keyOf(PK, 'EXCLUDED'));

(async () => {
  console.log('\n§1  the op arithmetic');

  check('add appends, dedupes, and canonicalises', () => {
    const first = exclusions.applyExclusionOp([], { op: 'add', questionKey: 'QUESTION#c001#002' });
    assert.deepStrictEqual(first.keys, ['c001#002']);
    const second = exclusions.applyExclusionOp(first.keys, { op: 'add', questionKey: 'c001#002' });
    assert.strictEqual(second.changed, false);
    assert.strictEqual(second.refused, 'duplicate');
  });

  check('remove takes one back; an absent key is a named no-op', () => {
    assert.deepStrictEqual(
      exclusions.applyExclusionOp(['a', 'b'], { op: 'remove', questionKey: 'a' }).keys, ['b']);
    const gone = exclusions.applyExclusionOp(['b'], { op: 'remove', questionKey: 'z' });
    assert.strictEqual(gone.changed, false);
    assert.strictEqual(gone.refused, 'not-excluded');
  });

  check('no cap — the 25th veto is not refused', () => {
    // A veto list is not a running order; forcing a host to un-veto something
    // to veto another would be the cap doing harm.
    const many = Array.from({ length: 30 }, (_, i) => `q${i + 1}`);
    const r = exclusions.applyExclusionOp(many, { op: 'add', questionKey: 'q31' });
    assert.strictEqual(r.changed, true);
    assert.strictEqual(r.keys.length, 31);
  });

  check('the TTL is the session\'s own — the same 90 days the queue rides', () => {
    assert.strictEqual(exclusions.TTL_CREATION_PHASE, queue.TTL_CREATION_PHASE);
  });

  console.log('\n§2  the endpoint');

  await check('a game that has never disabled anything reads as empty at version 0', async () => {
    store.clear();
    const { statusCode, body } = await call('GET');
    assert.strictEqual(statusCode, 200);
    assert.deepStrictEqual(body.excluded, []);
    assert.strictEqual(body.version, 0);
  });

  await check('add writes the row, bumps the version, sets the TTL', async () => {
    store.clear();
    const { statusCode, body } = await call('POST', { op: 'add', questionKey: 'c001#002' });
    assert.strictEqual(statusCode, 200, JSON.stringify(body));
    assert.deepStrictEqual(body.excluded, ['c001#002']);
    assert.strictEqual(body.version, 1);
    assert.ok(row().ttl > Math.floor(Date.now() / 1000) + 80 * 24 * 60 * 60,
      'the veto must outlive the planning window, not a round');
  });

  await check('remove lifts the veto', async () => {
    const { body } = await call('POST', { op: 'remove', questionKey: 'c001#002' });
    assert.deepStrictEqual(body.excluded, []);
    assert.strictEqual(body.version, 2);
  });

  await check('a refused op costs no write and says why', async () => {
    const before = row().Version;
    const { statusCode, body } = await call('POST', { op: 'remove', questionKey: 'never-there' });
    assert.strictEqual(statusCode, 200);
    assert.strictEqual(body.changed, false);
    assert.strictEqual(body.refused, 'not-excluded');
    assert.strictEqual(row().Version, before);
  });

  await check('an op this build has never heard of is a 400, not a cheerful 200', async () => {
    const { statusCode } = await call('POST', { op: 'purge', questionKey: 'x' });
    assert.strictEqual(statusCode, 400);
  });

  await check('a stale expectedVersion is advisory — applied, and flagged', async () => {
    const { statusCode, body } = await call('POST', {
      op: 'add', questionKey: 'c002#004', expectedVersion: 0,
    });
    assert.strictEqual(statusCode, 200);
    assert.strictEqual(body.changed, true);
    assert.strictEqual(body.staleView, true);
    assert.ok(body.excluded.includes('c002#004'));
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
