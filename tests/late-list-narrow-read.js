/**
 * GET /late READS NARROWLY (late items final review, minor 2).
 *
 * lateByRound (game/late-list.js) reads late ROUND answers per round,
 * `QUESTION#nnn#LATE#`, from the ROUND# rows it already reads, and never the
 * whole `QUESTION#` prefix (every answer and vote of the session). Paged, on
 * the follow-up suites' paging table (two rows a page).
 *
 *   the read     no Query on bare QUESTION#; one per round 001..max+1
 *   the gaps     a round with no ROUND# row, between two that have one, is read
 *   one past     a round left without results (no row) after the last row is read
 *   paging       three late answers on one round, two a page: all three
 *   lateAnswerRounds   by hand
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const { createTable, commands } = require('./helpers/followup-table');
const { makeKmsStub, installTestKeyLoader } = require('./helpers/tenant-crypto-stub');

const table = createTable({ pageSize: 2 });
const STUB_PATHS = [REPO, path.join(REPO, 'lambda-functions'), path.join(REPO, 'lambda-functions', 'game')];
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
stub('@aws-sdk/client-kms', makeKmsStub().exports);
stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', { DynamoDBDocumentClient: { from: () => table.doc }, ...commands });

process.env.TABLE_NAME = 'test-table';
process.env.TENANT_KMS_KEY_ID = 'alias/engage-tenant';
installTestKeyLoader();

const { lateByRound, lateAnswerRounds } = require(path.join(REPO, 'lambda-functions/game/late-list.js'));

const logs = [];
if (!process.env.DEBUG) { console.log = (...a) => logs.push(a.join(' ')); console.warn = console.log; console.error = console.log; }
const say = (s) => process.stdout.write(s + '\n');
let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); say(`  PASS  ${label}`); pass++; }
  catch (e) { say(`  FAIL  ${label}\n        ${e.stack.split('\n').slice(0, 3).join('\n        ')}`); fail++; }
}

const GAME = '4861';
const PK = `GAME#${GAME}`;
const META = { PK, SK: 'METADATA', GameType: 'call-and-answer', HostPreferences: { anonymousUntilReveal: false } };

function late(round, name, at) {
  table.put({
    PK, SK: `QUESTION#${round}#LATE#${name}`, PlayerName: name, QuestionNumber: round, Answer: `${name} on ${round}`,
    AnswerType: 'standard', ArrivedDuring: 'ASK#009', SubmittedAt: at,
  });
}

function seed() {
  table.rows.clear();
  table.log.length = 0;
  table.put(META);
  table.put({ PK, SK: 'STATE', State: 'ASK#005' });
  // Rows for 000 (the feedback beat), 001 and 003; none for 002 or 004.
  table.put({ PK, SK: 'ROUND#000', QuestionNumber: '000' });
  table.put({ PK, SK: 'ROUND#001', QuestionNumber: '001', AuthorsRevealed: true });
  table.put({ PK, SK: 'ROUND#003', QuestionNumber: '003', AuthorsRevealed: true });
  // On-time answers and votes: never read by the late list.
  for (const r of ['001', '002', '003']) {
    table.put({ PK, SK: `QUESTION#${r}#ANSWER#Bea`, PlayerName: 'Bea', Answer: 'on time' });
    table.put({ PK, SK: `QUESTION#${r}#VOTE#Bea`, PlayerName: 'Bea' });
  }
  late('001', 'Ada', '2026-10-16T09:01:00.000Z');
  late('001', 'Cy', '2026-10-16T09:02:00.000Z');
  late('001', 'Dee', '2026-10-16T09:03:00.000Z');
  late('002', 'Grace', '2026-10-16T09:10:00.000Z'); // a gap: no ROUND#002
  late('004', 'Linus', '2026-10-16T09:20:00.000Z'); // one past the last row
}

const queries = () => table.log.filter((l) => l.type === 'query').map((l) => l.input.ExpressionAttributeValues[':sk']);

(async () => {
  say('\nlateAnswerRounds');
  await check('001 to one past the highest round; 000 and junk ignored', () => {
    assert.deepStrictEqual(lateAnswerRounds(['000', '001', '003']), ['001', '002', '003', '004']);
    assert.deepStrictEqual(lateAnswerRounds([]), ['001']);
    assert.deepStrictEqual(lateAnswerRounds(['000', 'abc', '2']), ['001']);
  });

  say('\nthe read');
  await check('never the whole QUESTION# prefix; one QUESTION#nnn#LATE# per round 001..004', async () => {
    seed();
    await lateByRound(table.doc, { gameId: GAME, meta: META, withRefs: false });
    const q = queries();
    assert.strictEqual(q.includes('QUESTION#'), false, JSON.stringify(q));
    assert.ok(q.every((p) => !/^QUESTION#/.test(p) || /^QUESTION#\d{3}#LATE#$/.test(p)), JSON.stringify(q));
    const late = [...new Set(q.filter((p) => p.startsWith('QUESTION#')))].sort();
    assert.deepStrictEqual(late, ['QUESTION#001#LATE#', 'QUESTION#002#LATE#', 'QUESTION#003#LATE#', 'QUESTION#004#LATE#']);
  });

  await check('every late answer found: paged (three on 001), the gap (002), one past (004); nothing on time', async () => {
    seed();
    const byRound = await lateByRound(table.doc, { gameId: GAME, meta: META, withRefs: false });
    const got = [...byRound.entries()]
      .map(([round, items]) => [round, items.map((i) => `${i.kind}:${i.author}`).sort()])
      .sort((a, b) => a[0].localeCompare(b[0]));
    assert.deepStrictEqual(got, [
      ['001', ['answer:Ada', 'answer:Cy', 'answer:Dee']],
      ['002', ['answer:Grace']],
      ['004', ['answer:Linus']],
    ]);
  });

  say('\nbounded by STATE.LessonNumber too');
  await check('lateAnswerRounds: the higher of one past the last row and LessonNumber', () => {
    assert.deepStrictEqual(lateAnswerRounds(['001', '002'], 5), ['001', '002', '003', '004', '005']);
    assert.deepStrictEqual(lateAnswerRounds(['001', '002', '003'], 2), ['001', '002', '003', '004']);
    assert.deepStrictEqual(lateAnswerRounds([], 3), ['001', '002', '003']);
    assert.deepStrictEqual(lateAnswerRounds([], 'junk'), ['001']);
  });

  /** The last ROUND# row at 002, the room on ASK#005, a late answer on 004 (two past the last row). */
  function seedPastTheRows({ rows = ['001', '002'], lesson = 5, state = 'ASK#005' } = {}) {
    table.rows.clear();
    table.log.length = 0;
    table.put(META);
    table.put({ PK, SK: 'STATE', State: state, LessonNumber: lesson, CurrentQuestionId: 'q-xyz' });
    for (const r of rows) table.put({ PK, SK: `ROUND#${r}`, QuestionNumber: r, AuthorsRevealed: true });
    late('004', 'Omar', '2026-10-16T09:40:00.000Z');
  }
  const authorsOn = (byRound, round) => (byRound.get(round) || []).map((i) => i.author);

  await check('two rounds past the last ROUND# row: found, with STATE read by one GetItem', async () => {
    seedPastTheRows();
    const byRound = await lateByRound(table.doc, { gameId: GAME, meta: META, withRefs: false });
    assert.deepStrictEqual(authorsOn(byRound, '004'), ['Omar']);
    assert.ok(queries().includes('QUESTION#005#LATE#'));
    assert.ok(!queries().includes('QUESTION#006#LATE#'));
    assert.strictEqual(table.log.filter((l) => l.type === 'get' && l.input.Key.SK === 'STATE').length, 1);
  });

  await check('...and with the caller\'s STATE (no GetItem), still found after ENDED', async () => {
    seedPastTheRows({ state: 'ENDED' });
    const state = table.get(PK, 'STATE');
    const byRound = await lateByRound(table.doc, { gameId: GAME, meta: META, state, withRefs: false });
    assert.deepStrictEqual(authorsOn(byRound, '004'), ['Omar']);
    assert.strictEqual(table.log.filter((l) => l.type === 'get').length, 0);
  });

  await check('LessonNumber the only source (no ROUND# rows at all): found', async () => {
    seedPastTheRows({ rows: [], lesson: 4 });
    const byRound = await lateByRound(table.doc, { gameId: GAME, meta: META, withRefs: false });
    assert.deepStrictEqual(authorsOn(byRound, '004'), ['Omar']);
  });

  await check('GET /late through comments.js finds it too (the route hands its STATE on)', async () => {
    seedPastTheRows();
    process.env.WEBSOCKET_API_ENDPOINT = 'https://ws.test.invalid/dev';
    const { handler } = require(path.join(REPO, 'lambda-functions/game/comments.js'));
    const routeKey = 'GET /games/{gameId}/late';
    table.put({ ...META, orgId: 'org_acme', IdSecret: 'c2VjcmV0LWZvci1uYXJyb3ctcmVhZA==' });
    const res = await handler({
      routeKey,
      requestContext: { http: { method: 'GET' }, routeKey, authorizer: { lambda: { userId: 'u', groups: 'hosts', orgId: 'org_acme', orgIds: 'org_acme' } } },
      pathParameters: { gameId: GAME },
    });
    assert.strictEqual(res.statusCode, 200, res.body);
    const body = JSON.parse(res.body);
    assert.deepStrictEqual(body.rounds.map((r) => [r.round, r.items.map((i) => i.who)]), [['004', ['Omar']]]);
  });

  say(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})().catch((e) => { say(`CRASH ${e.stack}`); process.exit(1); });
