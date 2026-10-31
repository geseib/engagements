/**
 * THE SWEEP SEALS WHAT IT WRITES UNDER THE SESSION'S ORG — game/report-sweep.js
 * through create-report.js's real buildReport.
 *
 * The automatic report is the whole room — names against answers, Workie's
 * reads — written with no caller at all. So the org it is sealed under can only
 * come off the session row, as create-report has always done. Pinned here:
 *   - the stored report (head + one row per round) is ciphertext at rest and
 *     opens under the session's org and not under another;
 *   - the same rows carry the 90-day ttl, not create-report's 30;
 *   - the index row's Title and the bell's title/body are sealed too, and the
 *     index row lands in the session org's REPORTS partition;
 *   - an orgless session's report stays plaintext in the platform partition;
 *   - a host opening the report later (POST /report) does not cut the 90 days
 *     back to 30.
 *
 * // rejects: a sweep that writes any report text in the clear for an org
 * //          session, seals under the wrong org, files the index row in
 * //          another partition, or a rebuild that shortens the auto ttl.
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const assert = require('assert');
const H = require('./helpers/report-sweep-harness');
const { plainRow } = require('./helpers/tenant-crypto-stub');

const REPO = path.join(__dirname, '..');
const { runSweep } = require(path.join(REPO, 'lambda-functions/game/report-sweep.js'));
const createReport = require(path.join(REPO, 'lambda-functions/game/create-report.js'));

if (!process.env.DEBUG) { console.log = () => {}; console.error = () => {}; console.warn = () => {}; }
const { check, say, HOUR } = H;

const NOW = new Date();
const ago = (h) => new Date(NOW.getTime() - h * HOUR).toISOString();
const DAY_S = 86400;
const isEnvelope = (v) => !!v && typeof v === 'object' && typeof v.ct === 'string' && typeof v.iv === 'string';
const opensUnder = (orgId, row) => { try { plainRow(orgId, row); return true; } catch (e) { return false; } };

function seedRoom(gameId, orgId) {
  H.seedSession({
    gameId, orgId, title: 'Quarterly Retro', startedAt: ago(30), endedAt: ago(26),
    rounds: [{ n: '001', results: true, ai: true }], currentQuestionId: '001',
  });
  H.put({ PK: `GAME#${gameId}`, SK: 'PLAYER#Ada', PlayerName: 'Ada', JoinedAt: ago(30) });
  H.put({ PK: `GAME#${gameId}`, SK: 'QUESTION#001#ANSWER#Ada', PlayerName: 'Ada', Answer: 'Ship smaller things' });
}

(async () => {
  say('\n1. an org session: everything sealed under its org');
  H.reset();
  seedRoom('6001', 'org_acme');
  const result = await runSweep({ db: H.fakeDoc, now: NOW });
  const head = H.get('GAME#6001', 'REPORT');
  const rounds = [...H.store.values()].filter((r) => r.PK === 'GAME#6001' && String(r.SK).startsWith('REPORT#R#'));
  await check('the real buildReport ran and the sweep stamped it built', () => {
    assert.strictEqual(result.built, 1, JSON.stringify(result));
    assert.ok(head, 'no stored report head');
    assert.strictEqual(rounds.length, 1);
  });
  await check('the head\'s title and rounds are ciphertext at rest', () => {
    assert.ok(isEnvelope(head.gameTitle), 'gameTitle is plaintext');
    assert.ok(isEnvelope(rounds[0].Round), 'the round row is plaintext');
    assert.ok(!JSON.stringify(rounds[0]).includes('Ship smaller things'), 'an answer is readable at rest');
  });
  await check('they open under org_acme and not under another org', () => {
    assert.strictEqual(plainRow('org_acme', head).gameTitle, 'Quarterly Retro');
    assert.ok(JSON.stringify(plainRow('org_acme', rounds[0]).Round).includes('Ship smaller things'));
    assert.strictEqual(opensUnder('org_other', rounds[0]), false);
  });
  await check('the stored report carries the 90-day ttl, head and rounds', () => {
    const want = Math.floor(NOW.getTime() / 1000) + 90 * DAY_S;
    assert.ok(Math.abs(head.ttl - want) <= 2, `head ttl ${head.ttl} vs ${want}`);
    assert.ok(Math.abs(rounds[0].ttl - want) <= 2, `round ttl ${rounds[0].ttl}`);
  });
  const idx = H.get('ORG#org_acme#REPORTS', 'REPORT#6001');
  await check('the index row is in the org\'s REPORTS partition, Title sealed, flags plain', () => {
    assert.ok(idx, 'no index row under ORG#org_acme#REPORTS');
    assert.ok(isEnvelope(idx.Title), 'Title is plaintext');
    assert.strictEqual(plainRow('org_acme', idx).Title, 'Quarterly Retro');
    assert.strictEqual(idx.orgId, 'org_acme');
    assert.strictEqual(idx.auto, true);
    assert.strictEqual(idx.pdf, false);
    assert.strictEqual(H.get('REPORTS', 'REPORT#6001'), undefined, 'also written to the platform partition');
  });
  const n = H.get('USER#sub-host#NOTIFY', 'NOTE#report#6001');
  await check('the bell entry\'s words are sealed under the org too', () => {
    assert.ok(n, 'no bell entry');
    assert.ok(isEnvelope(n.title), 'notification title is plaintext');
    assert.strictEqual(plainRow('org_acme', n).title, 'Your report for Quarterly Retro is ready');
    assert.deepStrictEqual(n.link, { type: 'section', section: 'reports', orgId: 'org_acme' });
  });

  say('\n2. the host opening it later keeps the 90 days');
  const before = H.get('GAME#6001', 'REPORT').ttl;
  const res = await createReport.handler({
    pathParameters: { gameId: '6001' },
    requestContext: { authorizer: { lambda: { userId: 'sub-host', groups: 'hosts', orgId: 'org_acme', orgIds: 'org_acme' } } },
  });
  await check('POST /report answers 200 and the stored ttl does not shrink to 30 days', () => {
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.ok(H.get('GAME#6001', 'REPORT').ttl >= before);
  });

  say('\n3. an orgless session: plaintext in the platform partition, as its PDFs are');
  H.reset();
  seedRoom('6002', '');
  await runSweep({ db: H.fakeDoc, now: NOW });
  await check('report head plaintext, index row under REPORTS', () => {
    assert.strictEqual(H.get('GAME#6002', 'REPORT').gameTitle, 'Quarterly Retro');
    const row = H.get('REPORTS', 'REPORT#6002');
    assert.ok(row, 'no platform index row');
    assert.strictEqual(row.Title, 'Quarterly Retro');
    assert.strictEqual(row.orgId, undefined);
  });

  say('\n4. the sweep is not reachable over HTTP');
  await check('an HTTP-shaped event carrying __reportSweep is handled as a request, not a sweep', async () => {
    assert.strictEqual(createReport.isSweepInvocation({ __reportSweep: true }), true);
    assert.strictEqual(createReport.isSweepInvocation({ __reportSweep: true, requestContext: {} }), false);
    assert.strictEqual(createReport.isSweepInvocation({ __reportSweep: true, httpMethod: 'POST' }), false);
    assert.strictEqual(createReport.isSweepInvocation({ __reportSweep: 'true' }), false);
    const http = await createReport.handler({ __reportSweep: true, requestContext: {}, pathParameters: {} });
    assert.strictEqual(http.statusCode, 400);
  });

  const { pass, fail } = H.counts();
  say(`\n${pass} passed, ${fail} failed\n`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})();
