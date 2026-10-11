/**
 * THE USAGE STATS' TWO LEVELS, WRITTEN DAILY — admin/usage-reconcile.js
 * (usage-stats SPEC §6.2).
 *
 * "Sessions still kept" and "sets held" are levels, not events. The daily job
 * snapshots them for each team, each account in it, and the platform:
 *
 *   §1  the levels: kept sessions by type and by creator; an expired session
 *       whose row DynamoDB has not yet deleted (it is up to ~48 h late) is
 *       not counted; a set held for a public copy is not counted
 *   §2  run twice: the same rows (SET, never ADD)
 *   §3  the reads follow every page — the fake cuts 2-row pages, so a
 *       one-page read fails here
 *   §4  on the 1st, the month just ended gets its closing figure too
 *   §5  the gauge rows carry counts and ids only
 *
 * Every check carries a `// rejects:` line naming the change it catches.
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const assert = require('assert');
const Module = require('module');

const REPO = path.join(__dirname, '..');
const {
  createTable, GetCommand, PutCommand, QueryCommand, DeleteCommand, UpdateCommand,
  BatchGetCommand, TransactWriteCommand, BatchWriteCommand,
} = require('./helpers/player-table');

const table = createTable();
table.pageSize = 2;
const stubs = new Map([
  ['@aws-sdk/client-dynamodb', { DynamoDBClient: class {} }],
  ['@aws-sdk/lib-dynamodb', {
    DynamoDBDocumentClient: { from: () => table.doc },
    GetCommand, PutCommand, QueryCommand, DeleteCommand, UpdateCommand, BatchGetCommand, TransactWriteCommand, BatchWriteCommand,
  }],
]);
const realLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (stubs.has(request)) return stubs.get(request);
  return realLoad.call(this, request, parent, isMain);
};
process.env.TABLE_NAME = 'test-table';

const reconcile = require(path.join(REPO, 'lambda-functions/admin/usage-reconcile.js')).handler;

if (!process.env.DEBUG) { console.log = () => {}; console.warn = () => {}; console.error = () => {}; }
const say = (...a) => process.stdout.write(`${a.join(' ')}\n`);
let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); say(`  PASS  ${label}`); pass += 1; } catch (e) { say(`  FAIL  ${label}\n        ${e.message}`); fail += 1; }
}

const NOW = new Date('2026-10-11T00:05:00Z');
const FIRST = new Date('2026-11-01T00:05:00Z');
const sec = (d) => Math.floor(d.getTime() / 1000);

function seed() {
  table.clear();
  for (const org of ['org_nw', 'org_hl']) {
    table.put({ PK: 'ORGS', SK: `ORG#${org}`, orgId: org, type: 'team' });
    table.put({ PK: `ORG#${org}`, SK: 'METADATA', orgId: org, plan: 'team', type: 'team' });
  }
  const kept = sec(NOW) + 86400;
  const gone = sec(NOW) - 3600;      // past its ttl, still in the table
  const games = [
    ['1001', 'trivia', 'u-ana', kept],
    ['1002', 'trivia', 'u-ben', kept],
    ['1003', 'poll', 'u-ana', kept],
    ['1004', 'build', 'u-ana', kept],
    ['1005', 'trivia', 'u-ana', gone],
    ['1006', 'polls', 'u-ben', kept],   // a legacy spelling
  ];
  for (const [id, type, who, ttl] of games) {
    table.put({ PK: 'ORG#org_nw#GAMES', SK: `GAME#${id}`, GameType: type, CreatedBy: who, ttl, Title: { v: 1, ct: 'sealed' } });
  }
  table.put({ PK: 'ORG#org_hl#GAMES', SK: 'GAME#2001', GameType: 'survey', CreatedBy: 'u-cy', ttl: kept });
  for (const [id, who, hold] of [['a', 'u-ana'], ['b', 'u-ana'], ['c', 'u-ben'], ['d', 'u-ben', true]]) {
    table.put({ PK: 'ORG#org_nw#SETS', SK: `SET#${id}`, createdBy: who, name: { v: 1, ct: 'sealed' }, ...(hold ? { publicHold: true } : {}) });
  }
}
const g = (pk, sk) => table.get(pk, sk);

(async () => {
  say('\nusage stats: the daily gauges\n');
  seed();
  await reconcile({ now: NOW.toISOString() });

  say('§1 the levels');
  // rejects: trusting presence — a row past its ttl that DynamoDB has not yet
  // reaped would be counted as a kept session.
  await check('the team row: kept sessions by type, the expired one left out, legacy spelling mapped', () => {
    const team = g('ORG#org_nw', 'STATS#2026-10#GAUGE');
    assert.deepStrictEqual(team.existing, { trivia: 2, poll: 2, build: 1 });
    assert.strictEqual(team.setsHeld, 3);
  });
  // rejects: account gauges not split by creator, or filed without the team.
  await check('each account: its own kept sessions and sets, under the team', () => {
    const ana = g('USER#u-ana', 'STATS#2026-10#GAUGE#ORG#org_nw');
    assert.deepStrictEqual(ana.existing, { trivia: 1, poll: 1, build: 1 });
    assert.strictEqual(ana.setsHeld, 2);
    const ben = g('USER#u-ben', 'STATS#2026-10#GAUGE#ORG#org_nw');
    assert.deepStrictEqual(ben.existing, { trivia: 1, poll: 1 });
    assert.strictEqual(ben.setsHeld, 1);
  });
  // rejects: a platform row that is not the sum, or written before the teams.
  await check('the platform row is the sum of the teams, with the teams that kept any', () => {
    const p = g('PLATFORM#METRICS', 'MONTH#2026-10#GAUGE');
    assert.deepStrictEqual(p.existing, { trivia: 2, poll: 2, build: 1, survey: 1 });
    assert.strictEqual(p.setsHeld, 3);
    assert.strictEqual(p.teams, 2);
  });

  say('\n§2 run twice, same rows');
  // rejects: ADD instead of SET — a second run would double every level.
  await check('a second run writes the same figures', async () => {
    const before = JSON.stringify([g('ORG#org_nw', 'STATS#2026-10#GAUGE').existing, g('PLATFORM#METRICS', 'MONTH#2026-10#GAUGE').existing]);
    await reconcile({ now: NOW.toISOString() });
    const after = JSON.stringify([g('ORG#org_nw', 'STATS#2026-10#GAUGE').existing, g('PLATFORM#METRICS', 'MONTH#2026-10#GAUGE').existing]);
    assert.strictEqual(after, before);
  });

  say('\n§3 the reads page');
  // rejects: one Query page — with 2-row pages, 6 sessions and 4 sets need several.
  await check('the session and set index reads followed LastEvaluatedKey', () => {
    const reads = (pk) => table.log.filter((e) => e.type === 'query' && e.input.ExpressionAttributeValues[':pk'] === pk);
    assert.ok(reads('ORG#org_nw#GAMES').some((e) => e.input.ExclusiveStartKey), 'sessions: one page only');
    assert.ok(reads('ORG#org_nw#SETS').some((e) => e.input.ExclusiveStartKey), 'sets: one page only');
  });

  say('\n§4 the 1st closes the month just ended');
  // rejects: a closed month left with a mid-month figure.
  await check('a run on 1 November writes October\'s closing figure and November\'s first', async () => {
    seed();
    await reconcile({ now: FIRST.toISOString() });
    assert.ok(g('ORG#org_nw', 'STATS#2026-10#GAUGE'), 'October');
    assert.ok(g('ORG#org_nw', 'STATS#2026-11#GAUGE'), 'November');
    assert.ok(g('PLATFORM#METRICS', 'MONTH#2026-10#GAUGE'));
  });

  say('\n§5 counts and ids only');
  // rejects: a sealed title or set name riding into a gauge, or a ttl on one.
  await check('no gauge row carries text or a ttl', () => {
    const rows = [...table.store.values()].filter((r) => /GAUGE/.test(String(r.SK)));
    assert.ok(rows.length >= 5);
    for (const r of rows) {
      assert.ok(!('ttl' in r), `${r.PK}/${r.SK} has a ttl`);
      assert.ok(!JSON.stringify(r).includes('sealed'), `${r.PK}/${r.SK} carries text`);
    }
  });

  suiteFinished();
  say(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { say(e.stack); process.exit(1); });
