/**
 * A SESSION BUILT ON AN ORG OR PUBLIC SET PLAYS THAT SET, NOT THE PLATFORM ONE.
 *
 * The game pins the PAIR `{QuestionSetScope, QuestionSetId}` (plus the org on
 * the METADATA row) at creation, and get-game-state / get-question resolve the
 * set with that pair. The runtime readers that feed the host — up-next (the
 * plan), question-queue, next-question — resolved with the BARE id, which
 * set-version.js reads as PLATFORM: a set created in an organisation's own
 * space, or a public copy, produced an empty plan and nothing to play, while
 * the admin (scope-aware) listed every question. Seen by the owner on dev,
 * 2026-09-18, with a set called "name that thing".
 *
 * rejects: any runtime reader that hands resolveSetPartition a bare id.
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const assert = require('assert');
const REPO = path.join(__dirname, '..');
const { createTable, installStubs } = require('./helpers/player-table');

// KMS, faked: an org's question rows are encrypted at rest (tenant-crypto.js),
// and the plan must show their titles in plaintext.
const kmsStubs = require('./helpers/tenant-crypto-stub');
const kms = kmsStubs.makeKmsStub();
for (const base of [REPO, path.join(REPO, 'lambda-functions'), path.join(REPO, 'lambda-functions', 'game')]) {
  let p;
  try { p = require.resolve('@aws-sdk/client-kms', { paths: [base] }); } catch { continue; }
  require.cache[p] = { id: p, filename: p, loaded: true, exports: kms.exports };
}

const table = createTable();
const sent = [];
installStubs({ table, sent });
process.env.TABLE_NAME = 'test-table';
process.env.WEBSOCKET_API_ENDPOINT = 'https://ws.test.invalid/dev';

const { handler: upNext } = require(path.join(REPO, 'lambda-functions/game/up-next.js'));
const queue = require(path.join(REPO, 'lambda-functions/game/question-queue.js'));
const C = require(path.join(REPO, 'lambda-functions/game/tenant-crypto.js'));
kmsStubs.installTestKeyLoader();

let pass = 0; let fail = 0;
const check = async (label, fn) => {
  try { await fn(); console.log(`  PASS  ${label}`); pass += 1; } catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail += 1; }
};
const put = (item) => table.store.set(table.keyOf(item.PK, item.SK), item);
const host = (orgId, method = 'GET') => ({
  requestContext: { http: { method }, authorizer: { lambda: { userId: 'u', groups: 'hosts', orgId } } },
});

/** A session in `orgId`, pinned to the set `{scope, setId}` at version 1, with two categories of four. */
function seed({ gameId, orgId, scope, setId, metaPk, contentPk }) {
  const PK = `GAME#${gameId}`;
  put({
    PK, SK: 'METADATA', Title: 'Name that thing night', GameType: 'trivia',
    QuestionSetId: setId, QuestionSetScope: scope, QuestionSetVersion: 1, RandomSeed: 'fixed-seed',
    ...(orgId ? { orgId } : {}),
  });
  put({ PK, SK: 'STATE', State: 'RESULTS#001', LessonNumber: 1, CurrentQuestionId: '001' });
  put({
    PK, SK: 'STATE#CATS',
    'AvailMask1-8': '11000000', 'AvailMask9-16': '00000000', 'AvailMask17-24': '00000000',
    'HostMask1-8': '11000000', 'HostMask9-16': '00000000', 'HostMask17-24': '00000000',
  });
  put({ PK, SK: 'STATE#CATS#COUNTS', '1-8': [4, 4], '9-16': [], '17-24': [], TotalEnabled: 8, TotalRemaining: 8, Version: 1 });
  put({ PK: metaPk, SK: `SET#${setId}`, activeVersion: 1, versions: [{ version: 1 }] });
  for (const [cid, name] of [['c001', 'Things'], ['c002', 'Stuff']]) {
    put({ PK: contentPk, SK: `CATEGORY#${cid}`, Name: name });
    put({ PK, SK: `CATEGORY#${cid}#ORDER`, QuestionOrder: ['001', '002', '003', '004'], IsRandom: false });
    put({ PK, SK: `CATEGORY#${cid}#ACTIVE`, ActiveIndex: 0, QuestionCount: 4 });
    for (const n of ['001', '002', '003', '004']) {
      put({ PK: contentPk, SK: `QUESTION#${cid}#${n}`, Category: name, Title: `${name} ${n}` });
    }
  }
  put({ PK, SK: 'CONNECTION#host-1', ConnectionId: 'host-1', ConnectionType: 'HOST' });
}

const plan = async (gameId, orgId) => {
  const res = await upNext({ ...host(orgId), pathParameters: { gameId }, queryStringParameters: { count: '6' } });
  return { status: res.statusCode, body: JSON.parse(res.body || '{}') };
};
const titles = (p) => (p.body.upNext || []).map((i) => i.title || i.Title || '');

const ORG = 'org_acme';
const CASES = [
  { label: 'platform (control)', gameId: '6100', orgId: ORG, scope: 'platform', setId: 'shared-set', metaPk: 'SETS', contentPk: 'SET#shared-set#v1' },
  { label: "the org's own set", gameId: '6101', orgId: ORG, scope: 'org', setId: 'name-that-thing', metaPk: `ORG#${ORG}#SETS`, contentPk: `ORG#${ORG}#SET#name-that-thing#v1` },
  { label: "another org's public copy", gameId: '6102', orgId: 'org_other', scope: 'public', setId: 'orgacme-name-that-thing', metaPk: 'PUBLIC#SETS', contentPk: 'PUBLIC#SET#orgacme-name-that-thing#v1' },
];

(async () => {
  console.log('\norg-set-runtime: a session reads the set it was pinned to\n');
  for (const c of CASES) {
    table.store.clear(); sent.length = 0;
    seed(c);
    const p = await plan(c.gameId, c.orgId);
    await check(`${c.label}: up-next answers 200`, () => assert.strictEqual(p.status, 200, `got ${p.status}: ${JSON.stringify(p.body).slice(0, 200)}`));
    await check(`${c.label}: the plan is built from the set's own rows`, () => {
      assert.ok(titles(p).length > 0, `empty plan: ${JSON.stringify(p.body).slice(0, 200)}`);
      assert.ok(titles(p).some((t) => /^Things|^Stuff/.test(t)), `plan titles: ${JSON.stringify(titles(p))}`);
    });
    const added = await queue.handler({ ...host(c.orgId, 'POST'), pathParameters: { gameId: c.gameId }, body: JSON.stringify({ op: 'add', questionKey: 'QUESTION#c001#002' }) });
    await check(`${c.label}: a question from the set can be queued`, () => assert.strictEqual(added.statusCode, 200, `got ${added.statusCode}: ${added.body}`));
    const after = await plan(c.gameId, c.orgId);
    await check(`${c.label}: the queued question leads the plan`, () => assert.strictEqual(titles(after)[0], 'Things 002', `plan: ${JSON.stringify(titles(after))}`));
  }
  console.log("\n4. an org set's titles are encrypted at rest and the plan still reads them");
  table.store.clear(); sent.length = 0;
  const enc = CASES[1];
  seed(enc);
  for (const [k, row] of [...table.store.entries()]) {
    if (row.PK === enc.contentPk && String(row.SK).startsWith('QUESTION#')) {
      table.store.set(k, await C.encryptItem(ORG, 'question', row)); // eslint-disable-line no-await-in-loop
    }
  }
  const stored = table.store.get(table.keyOf(enc.contentPk, 'QUESTION#c001#001'));
  await check('the seeded title is an envelope, not plaintext', () =>
    assert.ok(stored && typeof stored.Title === 'object', `stored Title: ${JSON.stringify(stored && stored.Title)}`));
  const encPlan = await plan(enc.gameId, enc.orgId);
  await check('the plan shows the plaintext titles', () => {
    assert.strictEqual(encPlan.status, 200, `got ${encPlan.status}`);
    const t = titles(encPlan);
    assert.ok(t.length > 0, `empty plan: ${JSON.stringify(encPlan.body).slice(0, 160)}`);
    assert.ok(t.every((x) => typeof x === 'string' && /^(Things|Stuff) \d{3}$/.test(x)), `plan titles: ${JSON.stringify(t)}`);
  });

  console.log(`\n${pass} passed, ${fail} failed\n`);
  suiteFinished();
  if (fail) process.exit(1);
})();
