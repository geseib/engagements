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
const path = require('path');
const assert = require('assert');
const REPO = path.join(__dirname, '..');
const { createTable, installStubs } = require('./helpers/player-table');

const table = createTable();
const sent = [];
installStubs({ table, sent });
process.env.TABLE_NAME = 'test-table';
process.env.WEBSOCKET_API_ENDPOINT = 'https://ws.test.invalid/dev';

const { handler: upNext } = require(path.join(REPO, 'lambda-functions/game/up-next.js'));
const queue = require(path.join(REPO, 'lambda-functions/game/question-queue.js'));

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
  console.log(`\n${pass} passed, ${fail} failed\n`);
  if (fail) process.exit(1);
})();
