/**
 * THE USAGE STATS ROWS — lambda-functions/*\/platform-metrics.js (2026-10-11).
 *
 * docs/design/usage-stats/SPEC.md §6. Monthly counters per session type for
 * three scopes (platform, team, account), all-time rows per set and version,
 * and the daily gauges. What this suite has to prove:
 *
 *   §1  one rule: the type map agrees with game-types.js, the tenant copies
 *       carry setStatsPk
 *   §2  the key shapes, all three scopes, and the orgless account `#ORG#-`
 *   §3  the rows carry numbers and ids only: no ttl, no Title, no text
 *   §4  a failing write never throws, and costs only its own row
 *   §5  the readers page, and "all types" is a sum that leaves events out
 *   §6  setStatsPk for the three libraries
 *   §7  created counts once when the recorder is called twice for one session
 *
 * (The three platform-metrics copies are held identical by
 * tests/platform-metrics.js §1, which this work extends rather than repeats.)
 *
 * Every check carries a `// rejects:` line naming the change it catches.
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const fs = require('fs');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const { createTable, installStubs } = require('./helpers/player-table');
const { createPagedTable } = require('./helpers/paged-table');

const table = createTable();
installStubs({ table, sent: [] });
process.env.TABLE_NAME = 'test-table';

const M = require(path.join(REPO, 'lambda-functions/game/platform-metrics.js'));
const T = require(path.join(REPO, 'lambda-functions/game/tenant.js'));
const GT = require(path.join(REPO, 'lambda-functions/game/game-types.js'));

if (!process.env.DEBUG) { console.error = () => {}; console.warn = () => {}; }
const say = (...a) => process.stdout.write(`${a.join(' ')}\n`);
let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); say(`  PASS  ${label}`); pass += 1; } catch (e) { say(`  FAIL  ${label}\n        ${e.message}`); fail += 1; }
}

const OCT = new Date('2026-10-11T10:00:00Z');
const opts = (db = table.doc, now = OCT) => ({ db, tableName: 'test-table', now });
const row = (pk, sk) => table.get(pk, sk);
const statsRows = () => [...table.store.values()].filter((i) => /^(STATS|MONTH#.*#TYPE|SET#.*#V#)/.test(String(i.SK)) || /SETSTATS$/.test(String(i.PK)));

(async () => {
  say('\nusage stats: the rows\n');

  say('§1 one rule');
  // rejects: a type alias added to game-types.js and not here — a legacy
  // "polls" session would count as "other".
  await check('TYPE_ALIASES equals game-types.js ALIASES, and every known spelling agrees', () => {
    const src = fs.readFileSync(path.join(REPO, 'lambda-functions/game/game-types.js'), 'utf8');
    const block = /const ALIASES = \{([\s\S]*?)\};/.exec(src)[1];
    const aliases = Object.fromEntries([...block.matchAll(/(\w+):\s*'([^']+)'/g)].map((m) => [m[1], m[2]]));
    assert.deepStrictEqual({ ...M.TYPE_ALIASES }, aliases);
    for (const spelling of [...GT.GAME_TYPE_IDS || [], ...Object.keys(aliases)]) {
      assert.strictEqual(M.statsType(spelling), GT.normalizeGameType(spelling), spelling);
    }
  });
  // rejects: normalising build or junk to call-and-answer.
  await check('build passes through, junk is other, absent is the create default', () => {
    assert.strictEqual(M.statsType('build'), 'build');
    assert.strictEqual(M.statsType('banana'), 'other');
    assert.strictEqual(M.statsType(undefined), 'call-and-answer');
    assert.strictEqual(M.statsType('Polls'), 'poll');
  });
  // rejects: setStatsPk in one tenant.js copy only.
  await check('the three tenant.js copies are identical and export setStatsPk', () => {
    const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8');
    const game = read('lambda-functions/game/tenant.js');
    assert.strictEqual(read('lambda-functions/websocket/tenant.js'), game);
    assert.strictEqual(read('lambda-functions/admin/shared/tenant.js'), game);
    assert.strictEqual(typeof T.setStatsPk, 'function');
  });

  say('\n§2 the key shapes');
  table.clear();
  await M.fanOut({ ...opts(), db: table.doc, tableName: 'test-table', now: OCT }, { type: 'trivia', orgId: 'o1', userId: 'u1' }, { questions: 1 });
  // rejects: a key shape that drifts from SPEC §6.1 — the readers would miss it.
  await check('platform, team and account rows land on the SPEC keys', () => {
    assert.ok(row('PLATFORM#METRICS', 'MONTH#2026-10#TYPE#trivia'), 'platform');
    assert.ok(row('ORG#o1', 'STATS#2026-10#TYPE#trivia'), 'team');
    const acct = row('USER#u1', 'STATS#2026-10#TYPE#trivia#ORG#o1');
    assert.ok(acct, 'account');
    assert.strictEqual(acct.orgId, 'o1');
    assert.strictEqual(acct.questions, 1);
  });
  // rejects: an orgless session dropping its account row, or writing a team row
  // under ORG# with an empty id.
  await check('an orgless session: platform and account (#ORG#-) rows, no team row', async () => {
    table.clear();
    await M.fanOut(opts(), { type: 'poll', orgId: '', userId: 'u2' }, { created: 1 });
    assert.ok(row('PLATFORM#METRICS', 'MONTH#2026-10#TYPE#poll'));
    assert.ok(row('USER#u2', 'STATS#2026-10#TYPE#poll#ORG#-'));
    assert.ok(![...table.store.keys()].some((k) => k.startsWith('ORG#')), 'no team row');
  });
  // rejects: the readRecordedMetrics month regex matching the new type rows,
  // which would list a month twice.
  await check('the existing platform reader ignores type rows', async () => {
    const back = await M.readRecordedMetrics(opts());
    assert.deepStrictEqual(back.months, []);
    assert.deepStrictEqual(back.categories, []);
  });
  // rejects: the gauge or set key shapes drifting from SPEC §6.2/§6.3.
  await check('gauge and set SKs', () => {
    assert.strictEqual(M.statsGaugeSk('2026-10'), 'STATS#2026-10#GAUGE');
    assert.strictEqual(M.accountGaugeSk('2026-10', ''), 'STATS#2026-10#GAUGE#ORG#-');
    assert.strictEqual(M.platformGaugeSk('2026-10'), 'MONTH#2026-10#GAUGE');
    assert.strictEqual(M.setStatsSk('teamretro', 3), 'SET#teamretro#V#3');
    assert.strictEqual(M.setStatsSk('legacy', null), 'SET#legacy#V#0');
  });

  say('\n§3 numbers and ids only');
  table.clear();
  table.put({ PK: 'GAME#5001', SK: 'METADATA', orgId: 'o1', CreatedBy: 'u1', GameType: 'trivia', Title: { v: 1, ct: 'Q3 Layoffs Retro' } });
  await M.recordSessionCreated({ gameId: '5001' }, opts());
  await M.recordRoundServed({ gameId: '5001', round: 1, set: { scope: 'org', orgId: 'o1', setId: 'teamretro', version: 2, pk: 'ORG#o1#SET#teamretro#v2' }, questionId: 'QUESTION#c001#001' }, opts());
  await M.recordSetDownloaded({ set: { scope: 'platform', setId: 'shared', version: 1 } }, opts());
  // rejects: a ttl on a counter (a history that silently shortens), or a
  // Title copied off METADATA into a stats row.
  await check('no stats row carries ttl, Title or any text beyond ids', () => {
    const rows = statsRows();
    assert.ok(rows.length >= 5, `rows: ${rows.length}`);
    for (const r of rows) {
      assert.ok(!('ttl' in r), `${r.PK}/${r.SK} has a ttl`);
      assert.ok(!('Title' in r) && !('title' in r) && !('name' in r), `${r.PK}/${r.SK} has a title`);
      assert.ok(!JSON.stringify(r).includes('Layoffs'), `${r.PK}/${r.SK} carries text`);
    }
  });
  // rejects: counting an org set under the wrong partition.
  await check('an org set row lands in ORG#<org>#SETSTATS at the version served', () => {
    const r = row('ORG#o1#SETSTATS', 'SET#teamretro#V#2');
    assert.ok(r);
    assert.strictEqual(r.questions, 1);
    assert.strictEqual(r.sessions, 1);
    assert.ok(row('SETSTATS', 'SET#shared#V#1').downloads === 1);
  });

  say('\n§4 never throws');
  const broken = { send: async () => { const e = new Error('ProvisionedThroughputExceededException'); e.name = e.message; throw e; } };
  // rejects: a recorder whose failure would fail the create, start or join it rides on.
  await check('every recorder survives a table that fails every call', async () => {
    const o = opts(broken);
    const calls = [
      M.recordSessionCreated({ gameId: '1' }, o),
      M.recordSessionCounted({ gameId: '1' }, o),
      M.recordParticipant({ gameId: '1' }, o),
      M.recordBuildAsk({ gameId: '1', askId: '001' }, o),
      M.recordBuildDecision({ gameId: '1', askId: '001' }, o),
      M.recordBuildTask({ gameId: '1' }, o),
      M.recordSetCopied({ set: { scope: 'platform', setId: 's', version: 1 } }, o),
      M.recordSetDownloaded({ set: { scope: 'platform', setId: 's', version: 1 } }, o),
      M.recordEventCreated({ orgId: 'o1', createdBy: 'u1' }, o),
      M.recordEventRun({ code: '1234', orgId: 'o1', createdBy: 'u1' }, o),
      M.recordEventAttendee({ orgId: 'o1', createdBy: 'u1' }, o),
    ];
    const out = await Promise.all(calls);
    out.forEach((r) => assert.ok(r && typeof r === 'object'));
  });
  // rejects: Promise.all without per-row catch — one bad scope losing the others.
  await check('one failing scope row costs that row only', async () => {
    table.clear();
    const flaky = { send: (cmd) => (cmd.input && cmd.input.Key && String(cmd.input.Key.PK).startsWith('ORG#')
      ? Promise.reject(Object.assign(new Error('boom'), { name: 'ThrottlingException' }))
      : table.doc.send(cmd)) };
    await M.fanOut(opts(flaky), { type: 'trivia', orgId: 'o1', userId: 'u1' }, { participants: 1 });
    assert.ok(row('PLATFORM#METRICS', 'MONTH#2026-10#TYPE#trivia'));
    assert.ok(row('USER#u1', 'STATS#2026-10#TYPE#trivia#ORG#o1'));
    assert.ok(!row('ORG#o1', 'STATS#2026-10#TYPE#trivia'));
  });

  say('\n§5 the readers page, and sum');
  const paged = createPagedTable({ pageSize: 2 });
  const po = opts(paged);
  for (const [type, n] of [['trivia', 3], ['poll', 2], ['survey', 1], ['build', 4], ['event', 9]]) {
    await M.fanOut(po, { type, orgId: 'o9', userId: 'u9' }, { questions: n, created: 1 });
  }
  await M.fanOut({ ...po, now: new Date('2026-09-03T00:00:00Z') }, { type: 'trivia', orgId: 'o9', userId: 'u9' }, { questions: 100 });
  // rejects: a reader that reads one page and stops — rows past the first
  // page would vanish from a busy team's month.
  await check('readScopeStats follows every page', async () => {
    const before = paged.calls('query').length;
    const { rows } = await M.readScopeStats('team', 'o9', { from: '2026-10', to: '2026-10' }, po);
    assert.strictEqual(rows.length, 5);
    assert.ok(paged.calls('query').length - before > 1, 'more than one page');
  });
  // rejects: "all types" adding the event row — an event's sessions twice.
  await check('sumCounters adds the types and leaves events out', async () => {
    const { rows } = await M.readScopeStats('team', 'o9', { from: '2026-10', to: '2026-10' }, po);
    const sum = M.sumCounters(rows);
    assert.strictEqual(sum.questions, 10);
    assert.strictEqual(sum.created, 4);
  });
  // rejects: a month range that leaks rows from outside it.
  await check('a range reads both months and nothing else', async () => {
    const both = await M.readScopeStats('account', 'u9', { from: '2026-09', to: '2026-10' }, po);
    assert.strictEqual(both.rows.length, 6);
    assert.ok(both.rows.every((r) => r.orgId === 'o9'));
    const sept = await M.readScopeStats('team', 'o9', { from: '2026-09', to: '2026-09' }, po);
    assert.strictEqual(M.sumCounters(sept.rows).questions, 100);
  });
  await check('readSetStats pages a library', async () => {
    for (let v = 1; v <= 5; v += 1) await M.recordSetDownloaded({ set: { scope: 'public', setId: 'pub', version: v } }, po);
    const rows = await M.readSetStats({ scope: 'public', setId: 'pub' }, po);
    assert.strictEqual(rows.length, 5);
    assert.deepStrictEqual(rows.map((r) => r.downloads), [1, 1, 1, 1, 1]);
  });

  say('\n§6 setStatsPk');
  // rejects: a set stats partition built outside tenant.js, or one that
  // collides with the SETS index.
  await check('platform / org / public', () => {
    assert.strictEqual(T.setStatsPk('platform'), 'SETSTATS');
    assert.strictEqual(T.setStatsPk('org', 'o1'), 'ORG#o1#SETSTATS');
    assert.strictEqual(T.setStatsPk('public'), 'PUBLIC#SETSTATS');
    assert.throws(() => T.setStatsPk('org', ''));
  });

  say('\n§7 created, once');
  table.clear();
  table.put({ PK: 'GAME#6001', SK: 'METADATA', orgId: 'o1', CreatedBy: 'u1', GameType: 'poll' });
  // rejects: a create recorder with no guard — a retried call counts twice.
  await check('the recorder called twice for one session counts one', async () => {
    const a = await M.recordSessionCreated({ gameId: '6001' }, opts());
    const b = await M.recordSessionCreated({ gameId: '6001' }, opts());
    assert.strictEqual(a.counted, true);
    assert.strictEqual(b.counted, false);
    assert.strictEqual(row('ORG#o1', 'STATS#2026-10#TYPE#poll').created, 1);
    assert.strictEqual(row('PLATFORM#METRICS', 'MONTH#2026-10').sessionsCreated, 1);
  });

  suiteFinished();
  say(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
