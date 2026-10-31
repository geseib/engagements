/**
 * AN AUTO-BUILT REPORT STILL OPENS AFTER ITS SESSION HAS EXPIRED — and only for
 * the team that owns it. game/get-report.js, game/save-report.js and
 * game/get-reports.js, with game/report-access.js.
 *
 * The session's METADATA lives 7 days from the start; the auto report's rows
 * and its index row live 90. get-report and save-report authorised on
 * METADATA alone, so a report the sweep built on day 6 was unreadable on day
 * 8 and its PDF could never be made. Now, with METADATA gone, the index row in
 * the org's REPORTS partition is the owner record, and the same
 * callerMayDriveSession question is asked of it.
 *
 * // rejects: a reader that 404s the owner after expiry, one that hands the
 * //          report to another team or to no identity, a save that cannot
 * //          replace the auto row, and a list that offers a download for a
 * //          report with no PDF.
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const assert = require('assert');
const H = require('./helpers/report-sweep-harness');
const { plainRow } = require('./helpers/tenant-crypto-stub');

const REPO = path.join(__dirname, '..');
const { runSweep } = require(path.join(REPO, 'lambda-functions/game/report-sweep.js'));
const getReport = require(path.join(REPO, 'lambda-functions/game/get-report.js')).handler;
const saveReport = require(path.join(REPO, 'lambda-functions/game/save-report.js')).handler;
const getReports = require(path.join(REPO, 'lambda-functions/game/get-reports.js')).handler;

if (!process.env.DEBUG) { console.log = () => {}; console.error = () => {}; console.warn = () => {}; }
const { check, say, HOUR } = H;
process.env.REPORTS_BUCKET_NAME = 'test-reports';

const NOW = new Date();
const ago = (h) => new Date(NOW.getTime() - h * HOUR).toISOString();
const caller = (orgId) => ({
  authorizer: { lambda: { userId: 'u-1', groups: 'hosts', orgId, orgRole: 'member', orgIds: orgId } },
});
const read = (gameId, requestContext) => getReport({
  pathParameters: { gameId }, queryStringParameters: { role: 'host' }, ...(requestContext ? { requestContext } : {}),
});
const save = (gameId, requestContext) => saveReport({
  pathParameters: { gameId }, requestContext,
  body: JSON.stringify({ eventTitle: 'Quarterly Retro', pdfBlob: 'JVBERi0=' }),
});
/** What DynamoDB's TTL does to the session's own rows on day 8. */
const expireSession = (gameId) => {
  for (const sk of ['METADATA', 'STATE']) H.store.delete(`GAME#${gameId}|${sk}`);
  H.store.delete(`GAMES|GAME#${gameId}`);
};

(async () => {
  H.reset();
  H.seedSession({
    gameId: '8001', orgId: 'org_acme', title: 'Quarterly Retro', startedAt: ago(30), endedAt: ago(26),
    rounds: [{ n: '001', results: true, ai: true }, { n: '002' }], currentQuestionId: '002',
  });
  await runSweep({ db: H.fakeDoc, now: NOW });

  say('\n1. GET /reports lists it as auto-built, with nothing to download');
  const listed = JSON.parse((await getReports({ requestContext: caller('org_acme') })).body).reports;
  await check('auto: true, pdf: false, no download link, and its coverage', () => {
    assert.strictEqual(listed.length, 1);
    const [r] = listed;
    assert.strictEqual(r.auto, true);
    assert.strictEqual(r.pdf, false);
    assert.strictEqual(r.downloadUrl, null);
    assert.strictEqual(r.passkey, null);
    assert.deepStrictEqual(r.covers, { completed: ['001'], notRun: ['002'] });
    assert.strictEqual(r.title, 'Quarterly Retro');
  });

  say('\n2. GET /games/{id}/report after the session has expired');
  expireSession('8001');
  let res = await read('8001', caller('org_acme'));
  await check('the owning team still reads it (200, decrypted)', () => {
    assert.strictEqual(res.statusCode, 200, res.body);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.gameTitle, 'Quarterly Retro');
    assert.strictEqual(body.detailedQuestions.length, 1);
  });
  res = await read('8001', caller('org_other'));
  await check('another team gets the same 404 as a missing report', () => assert.strictEqual(res.statusCode, 404));
  res = await read('8001', null);
  await check('no identity gets 404', () => assert.strictEqual(res.statusCode, 404));
  res = await read('8001', { authorizer: { lambda: { userId: 'u-2', groups: 'hosts', orgId: 'org_other', orgIds: 'org_other,org_acme' } } });
  await check('a member of the owning team standing in another library reads it, as before expiry', () =>
    assert.strictEqual(res.statusCode, 200, res.body));

  say('\n3. POST save-report after expiry: the PDF replaces the auto row');
  res = await save('8001', caller('org_other'));
  await check('another team cannot save against it', () => assert.strictEqual(res.statusCode, 404));
  res = await save('8001', caller('org_acme'));
  await check('the owning team saves the PDF (200)', () => assert.strictEqual(res.statusCode, 200, res.body));
  const row = plainRow('org_acme', H.get('ORG#org_acme#REPORTS', 'REPORT#8001'));
  await check('the row is now a PDF row: s3Key and passkey, no auto flag', () => {
    assert.ok(row.s3Key && row.s3Key.endsWith('.pdf.enc'), row.s3Key);
    assert.ok(row.passkey);
    assert.strictEqual(row.auto, undefined);
    assert.strictEqual(row.orgId, 'org_acme');
  });
  const relisted = JSON.parse((await getReports({ requestContext: caller('org_acme') })).body).reports;
  await check('and the list offers its download', () => {
    assert.strictEqual(relisted[0].auto, false);
    assert.strictEqual(relisted[0].pdf, true);
    assert.ok(relisted[0].downloadUrl);
  });

  say('\n4. a session that still exists is judged on METADATA, as before');
  H.reset();
  H.seedSession({ gameId: '8002', orgId: 'org_acme', startedAt: ago(30), endedAt: ago(26), rounds: [{ n: '001', results: true, ai: true }] });
  await runSweep({ db: H.fakeDoc, now: NOW });
  await check('owner 200, stranger 404', async () => {
    assert.strictEqual((await read('8002', caller('org_acme'))).statusCode, 200);
    assert.strictEqual((await read('8002', caller('org_other'))).statusCode, 404);
  });

  const { pass, fail } = H.counts();
  say(`\n${pass} passed, ${fail} failed\n`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})();
