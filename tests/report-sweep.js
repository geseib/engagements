/**
 * THE AUTOMATIC REPORT SWEEP — game/report-sweep.js
 *
 * The owner, 2026-10-31: every session that ran gets its report, even when the
 * host never made one. These checks pin:
 *   1. which sessions are due (ended > 24h, idle > 12h, < 48h before ttl;
 *      never-started and expired sessions skipped; an open survey is not idle);
 *   2. what one run writes: the index row (auto, pdf:false, 90-day ttl,
 *      Covers: completed rounds and rounds opened but not run) and the bell;
 *   3. two racing runs build ONCE;
 *   4. Workie is retried once, only for rounds that reached RESULTS without a
 *      read, and the build waits a run for it (unless the session is nearly
 *      gone);
 *   5. a failed build retries on later runs, and 24h before expiry rings
 *      'report.failed' once;
 *   6. a PDF the host saved meanwhile is never overwritten.
 *
 * buildReport is injected here (create-report's real one is exercised in
 * tests/report-sweep-tenancy.js).
 *
 * // rejects: a sweep that builds a never-started session, rebuilds one already
 * //          stamped, double-builds under a race, calls Workie for a round that
 * //          never closed or already has a read, overwrites a saved PDF's row,
 * //          or rings the failure bell more than once.
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const assert = require('assert');
const H = require('./helpers/report-sweep-harness');

const REPO = path.join(__dirname, '..');
const sweepMod = require(path.join(REPO, 'lambda-functions/game/report-sweep.js'));
const { runSweep, dueReason, roundsOf, roundsNeedingRead } = sweepMod;

if (!process.env.DEBUG) { console.log = () => {}; console.error = () => {}; console.warn = () => {}; }

const { check, say, HOUR } = H;
const NOW = new Date('2026-10-20T12:00:00.000Z');
const ago = (h, from = NOW) => new Date(from.getTime() - h * HOUR).toISOString();
const later = (h, from = NOW) => new Date(from.getTime() + h * HOUR);
const DAY_S = 86400;

function fakeBuilder({ fail = false, onBuild = null } = {}) {
  const calls = [];
  const fn = async (gameId, opts) => {
    calls.push({ gameId, opts });
    if (onBuild) await onBuild(gameId);
    if (typeof fail === 'function' ? fail() : fail) throw new Error('build broke');
    return { gameId, gameTitle: `Session ${gameId}` };
  };
  fn.calls = calls;
  return fn;
}
const sweep = (builder, now = NOW) => runSweep({ db: H.fakeDoc, now, deps: { buildReport: builder, lambda: new (require('@aws-sdk/client-lambda').LambdaClient)() } });
const indexRow = (gameId, orgId = '') => H.get(orgId ? `ORG#${orgId}#REPORTS` : 'REPORTS', `REPORT#${gameId}`);
const note = (gameId, sub = 'sub-host') => H.get(`USER#${sub}#NOTIFY`, `NOTE#report#${gameId}`);

(async () => {
  say('\n1. which sessions are due');
  const meta = { Started: true, GameType: 'call-and-answer' };
  const ttlIn = (h) => Math.floor(later(h).getTime() / 1000);
  await check('never started: never due, whatever its age', () => {
    assert.strictEqual(dueReason({ meta: { Started: false }, state: { State: 'CREATED', UpdatedAt: ago(200) }, ttl: ttlIn(10), now: NOW }), false);
  });
  await check('ended more than 24h ago: due', () => {
    assert.strictEqual(dueReason({ meta, state: { State: 'ENDED', EndedAt: ago(25), UpdatedAt: ago(25) }, ttl: ttlIn(100), now: NOW }), 'ended');
  });
  await check('ended 2h ago and plenty of ttl left: not yet', () => {
    assert.strictEqual(dueReason({ meta, state: { State: 'ENDED', EndedAt: ago(2), UpdatedAt: ago(2) }, ttl: ttlIn(100), now: NOW }), false);
  });
  await check('never ended, idle more than 12h: due', () => {
    assert.strictEqual(dueReason({ meta, state: { State: 'RESULTS#002', UpdatedAt: ago(13) }, ttl: ttlIn(100), now: NOW }), 'idle');
  });
  await check('active an hour ago but under 48h before ttl: due', () => {
    assert.strictEqual(dueReason({ meta, state: { State: 'ASK#003', UpdatedAt: ago(1) }, ttl: ttlIn(47), now: NOW }), 'expiring');
  });
  await check('past its ttl: skipped (its rows may be half deleted)', () => {
    assert.strictEqual(dueReason({ meta, state: { State: 'ENDED', EndedAt: ago(200) }, ttl: ttlIn(-1), now: NOW }), false);
  });
  await check('a session last active more than 10 days ago is history, not due (no backfill burst)', () => {
    assert.strictEqual(dueReason({ meta, state: { State: 'ENDED', EndedAt: ago(11 * 24) }, ttl: 0, now: NOW }), false);
    assert.strictEqual(dueReason({ meta, state: { State: 'RESULTS#001', UpdatedAt: ago(11 * 24) }, ttl: ttlIn(1000), now: NOW }), false);
    assert.strictEqual(dueReason({ meta, state: {}, ttl: ttlIn(10) , now: NOW }), false);
  });
  await check('an open survey is not idle — only the 48h rule takes it', () => {
    const survey = { Started: true, GameType: 'survey' };
    assert.strictEqual(dueReason({ meta: survey, state: { State: 'SURVEY#OPEN', UpdatedAt: ago(30) }, ttl: ttlIn(100), now: NOW }), false);
    assert.strictEqual(dueReason({ meta: survey, state: { State: 'SURVEY#OPEN', UpdatedAt: ago(30) }, ttl: ttlIn(40), now: NOW }), 'expiring');
  });
  await check('a closed survey counts from its close', () => {
    const survey = { Started: true, GameType: 'survey' };
    assert.strictEqual(dueReason({ meta: survey, state: { State: 'SURVEY#CLOSED', ClosedAt: ago(13), UpdatedAt: ago(13) }, ttl: ttlIn(100), now: NOW }), 'idle');
  });

  say('\n2. completed rounds and rounds not run');
  await check('RESULTS rounds are completed; opened-but-never-closed ones are "not run"', () => {
    const rows = [
      { SK: 'QUESTION#001#RESULTS' }, { SK: 'ROUND#002', ResultsShownAt: 'x' }, { SK: 'QUESTION#003#REF' },
      { SK: 'ROUND#004' },
    ];
    assert.deepStrictEqual(roundsOf({ meta, state: { CurrentQuestionId: '004' }, rows }),
      { completed: ['001', '002'], notRun: ['003', '004'] });
  });
  await check('a closed survey covers its one read; an open one has not run it', () => {
    const survey = { GameType: 'survey' };
    assert.deepStrictEqual(roundsOf({ meta: survey, state: { State: 'SURVEY#CLOSED' }, rows: [] }), { completed: ['000'], notRun: [] });
    assert.deepStrictEqual(roundsOf({ meta: survey, state: { State: 'SURVEY#OPEN' }, rows: [] }), { completed: [], notRun: ['000'] });
  });
  await check('a Workie retry is owed only to a completed round with no read, once', () => {
    const rows = [{ SK: 'QUESTION#001#AISummary' }];
    assert.deepStrictEqual(roundsNeedingRead({ meta, rows, completed: ['001', '002', '003'], retried: ['003'] }), ['002']);
    assert.deepStrictEqual(roundsNeedingRead({ meta: { GameType: 'build' }, rows: [], completed: ['001'] }), []);
  });

  say('\n3. one run: what it builds and what it skips');
  H.reset();
  H.seedSession({ gameId: '1001', startedAt: ago(30), endedAt: ago(26), rounds: [
    { n: '001', results: true, ai: true }, { n: '002', results: true, ai: true }, { n: '003' },
  ], currentQuestionId: '003' });
  H.seedSession({ gameId: '1002', started: false, startedAt: ago(100) });
  H.seedSession({ gameId: '1003', startedAt: ago(30), endedAt: ago(26) });
  H.put({ PK: 'REPORTS', SK: 'REPORT#1003', gameId: '1003', s3Key: 'x.pdf', savedAt: ago(25) });
  H.seedSession({ gameId: '1004', startedAt: ago(3), endedAt: ago(2) });
  H.put({ PK: 'GAMES', SK: 'GAME#7777', Kind: 'event', ttl: 9999999999 });
  let build = fakeBuilder();
  let result = await sweep(build);
  await check('only the due, started, unreported session is built', () => {
    assert.deepStrictEqual(build.calls.map((c) => c.gameId), ['1001']);
    assert.strictEqual(result.built, 1);
  });
  await check('never-started 1002 and recent 1004 get no report row', () => {
    assert.strictEqual(indexRow('1002'), undefined);
    assert.strictEqual(indexRow('1004'), undefined);
  });
  await check('1003\'s saved PDF row is untouched', () => {
    assert.strictEqual(indexRow('1003').s3Key, 'x.pdf');
    assert.strictEqual(indexRow('1003').auto, undefined);
  });
  const row = indexRow('1001');
  await check('the index row says auto, no PDF, and what it covers', () => {
    assert.strictEqual(row.auto, true);
    assert.strictEqual(row.pdf, false);
    assert.strictEqual(row.s3Key, undefined);
    assert.strictEqual(row.CreatedBy, 'sub-host');
    assert.deepStrictEqual(row.Covers, { completed: ['001', '002'], notRun: ['003'] });
  });
  await check('the index row and the stored report both get a 90-day ttl', () => {
    const want = Math.floor(NOW.getTime() / 1000) + 90 * DAY_S;
    assert.strictEqual(row.ttl, want);
    assert.strictEqual(build.calls[0].opts.ttlSeconds, want);
  });
  await check('the host who created it gets a "report.auto" bell to Reports', () => {
    const n = note('1001');
    assert.ok(n, 'no notification row');
    assert.strictEqual(n.kind, 'report.auto');
    assert.deepStrictEqual(n.link, { type: 'section', section: 'reports' });
    assert.strictEqual(n.title, 'Your report for Session 1001 is ready');
  });
  await check('no Workie call: every completed round already had its read', () => {
    assert.strictEqual(H.invokes.length, 0);
  });
  build = fakeBuilder();
  await sweep(build, later(3));
  await check('the next run does not build it again', () => assert.strictEqual(build.calls.length, 0));

  say('\n4. two runs at once build once');
  H.reset();
  H.seedSession({ gameId: '2001', startedAt: ago(30), endedAt: ago(26), rounds: [{ n: '001', results: true, ai: true }] });
  build = fakeBuilder();
  await Promise.all([sweep(build), sweep(build), sweep(build)]);
  await check('buildReport ran once', () => assert.strictEqual(build.calls.length, 1));
  await check('one index row, one bell', () => {
    assert.strictEqual([...H.store.values()].filter((r) => r.SK === 'REPORT#2001').length, 1);
    assert.strictEqual(H.log.filter((l) => l.type === 'put' && String(l.input.Item.SK) === 'NOTE#report#2001').length, 1);
  });

  say('\n5. Workie is retried once, for RESULTS-without-read rounds only');
  H.reset();
  H.seedSession({ gameId: '3001', startedAt: ago(30), endedAt: ago(26), rounds: [
    { n: '001', results: true, ai: false }, { n: '002', results: true, ai: true }, { n: '003' },
  ], currentQuestionId: '003' });
  build = fakeBuilder();
  result = await sweep(build);
  await check('one worker started, for round 001 only (002 has a read, 003 never closed)', () => {
    assert.deepStrictEqual(H.invokes.map((i) => [i.gameId, i.paddedQuestionNumber, i.__workerMode]), [['3001', '001', true]]);
    assert.ok(H.invokes[0].jobId, 'the worker carries the claim\'s jobId');
  });
  await check('through the shared claim (summary-job.js)', () => {
    assert.ok(H.get('GAME#3001', 'QUESTION#001#AISummaryJob'), 'no AISummaryJob claim row');
  });
  await check('the build waits a run for the read to land', () => {
    assert.strictEqual(result.deferred, 1);
    assert.strictEqual(build.calls.length, 0);
    assert.strictEqual(indexRow('3001'), undefined);
  });
  H.store.delete('GAME#3001|QUESTION#001#AISummaryJob'); // the worker released it, but wrote nothing
  await sweep(build, later(3));
  await check('the next run does not retry the same round again, and builds', () => {
    assert.strictEqual(H.invokes.length, 1);
    assert.strictEqual(build.calls.length, 1);
    assert.strictEqual(indexRow('3001').auto, true);
  });
  H.reset();
  H.seedSession({ gameId: '3002', startedAt: ago(165), updatedAt: ago(5), state: 'RESULTS#001',
    rounds: [{ n: '001', results: true, ai: false }] }); // ttl in 3h
  build = fakeBuilder();
  await sweep(build);
  await check('inside the last 6 hours it retries AND builds in the same run', () => {
    assert.strictEqual(H.invokes.length, 1);
    assert.strictEqual(build.calls.length, 1);
  });

  say('\n6. a failing build retries, and rings report.failed once 24h out');
  H.reset();
  const ttl = H.seedSession({ gameId: '4001', startedAt: ago(130), endedAt: ago(126) }); // ttl at +38h
  let broken = true;
  build = fakeBuilder({ fail: () => broken });
  const at = (hBeforeTtl) => new Date(ttl * 1000 - hBeforeTtl * HOUR);
  await sweep(build, at(30));
  await check('30h before expiry: failed, no bell yet, claim released for the next run', () => {
    assert.strictEqual(build.calls.length, 1);
    assert.strictEqual(note('4001'), undefined);
    const m = H.get('GAME#4001', 'AUTOREPORT');
    assert.strictEqual(m.ClaimedUntil, 0);
    assert.strictEqual(m.Attempts, 1);
    assert.strictEqual(m.LastError, 'build broke');
  });
  await sweep(build, at(21));
  await check('21h before expiry: retried, and the host gets "report.failed"', () => {
    assert.strictEqual(build.calls.length, 2);
    assert.strictEqual(note('4001').kind, 'report.failed');
  });
  const firstFailedAt = note('4001').updatedAt;
  await sweep(build, at(18));
  await check('a later failure does not ring again', () => {
    assert.strictEqual(build.calls.length, 3);
    assert.strictEqual(note('4001').updatedAt, firstFailedAt);
  });
  broken = false;
  await sweep(build, at(15));
  await check('when it finally builds, the entry turns into "report.auto"', () => {
    assert.strictEqual(indexRow('4001').auto, true);
    assert.strictEqual(note('4001').kind, 'report.auto');
  });

  say('\n7. a PDF saved meanwhile wins');
  H.reset();
  H.seedSession({ gameId: '5001', startedAt: ago(30), endedAt: ago(26) });
  build = fakeBuilder({
    onBuild: async () => H.put({ PK: 'REPORTS', SK: 'REPORT#5001', gameId: '5001', s3Key: 'host.pdf' }),
  });
  result = await sweep(build);
  await check('the host\'s row stays, and no "ready" bell is sent', () => {
    assert.strictEqual(indexRow('5001').s3Key, 'host.pdf');
    assert.strictEqual(indexRow('5001').auto, undefined);
    assert.strictEqual(note('5001'), undefined);
    assert.strictEqual(result['saved-meanwhile'], 1);
  });
  await check('and the marker is stamped, so it is not rebuilt', () => {
    assert.ok(H.get('GAME#5001', 'AUTOREPORT').BuiltAt);
  });

  const { pass, fail } = H.counts();
  say(`\n${pass} passed, ${fail} failed\n`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})();
