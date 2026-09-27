/**
 * "ABOUT THIS SESSION" AND "WHO WAS HERE" — reportData carries the session's
 * own free text and each player's join time (Task 2 of the 2026-09-26
 * feature sweep).
 *
 * ── THE DEFECT ─────────────────────────────────────────────────────────────
 *
 * create-report.js already had the session's `Details` field decrypted in
 * memory — `sessionMeta`, the exact object `gameTitle`/`hostName` read a few
 * lines below it — and never copied it into `reportData`. The report opened
 * on a title, a date and three numbers, with no way to say what the session
 * was for. `playerPerformance` (the roster) existed too, but with no join
 * time on it there was no way to list "who was here" in the order people
 * actually arrived rather than by score.
 *
 * ── THE RULE ───────────────────────────────────────────────────────────────
 *
 * `eventDetails: sessionMeta.EngagementInfo || sessionMeta.Details || ''` —
 * the same field, same fallback order, get-ai-summary.js already reads for
 * its own prompt (`eventDetails: metadata.EngagementInfo || metadata.Details
 * || ''`). For an organisation's session `Details` is ENCRYPTED_FIELDS.session,
 * sealed at rest exactly like `Title`/`HostName`, and `sessionMeta` already
 * decrypts it the same way. The STORED `REPORT` snapshot must seal
 * `eventDetails` right back up — it is the same class of host-authored
 * content as `gameTitle`/`hostName`, which are already in
 * ENCRYPTED_FIELDS.report.
 *
 * `playerPerformance[].joinedAt` is each player's `JoinedAt` off the
 * (deduplicated) `PLAYER#{name}` row — a timestamp, never content, so it
 * stays in the clear on the `report` boundary the same way the identifiers
 * already do.
 *
 * rejects: `eventDetails` missing from the response; an org session's
 *          `Details` reaching the report as an envelope, in the response, OR
 *          reaching the STORED snapshot as plaintext; `joinedAt` absent from
 *          playerPerformance, which is what a "who was here, in join order"
 *          roster needs and score alone cannot give it.
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const { createTable, installStubs } = require('./helpers/player-table');

// KMS, faked, and registered before any handler loads — same pattern as
// tests/report-org-question-decrypted.js.
const kmsStubs = require('./helpers/tenant-crypto-stub');
const kms = kmsStubs.makeKmsStub();
for (const base of [REPO, path.join(REPO, 'lambda-functions'), path.join(REPO, 'lambda-functions', 'game'), path.join(REPO, 'lambda-functions', 'websocket')]) {
  let p;
  try { p = require.resolve('@aws-sdk/client-kms', { paths: [base] }); } catch { continue; }
  require.cache[p] = { id: p, filename: p, loaded: true, exports: kms.exports };
}

const table = createTable();
const sent = [];
installStubs({ table, sent });
process.env.TABLE_NAME = 'test-table';

const createReport = require(path.join(REPO, 'lambda-functions/game/create-report.js')).handler;
const C = require(path.join(REPO, 'lambda-functions/game/tenant-crypto.js'));
kmsStubs.installTestKeyLoader();

let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok   - ${label}`); pass += 1; } catch (e) { console.log(`  FAIL - ${label}\n         ${e.message}`); fail += 1; }
}

const put = (item) => table.store.set(table.keyOf(item.PK, item.SK), item);
const get = (pk, sk) => table.store.get(table.keyOf(pk, sk));
const isEnvelope = (v) => !!v && typeof v === 'object' && typeof v.ct === 'string' && typeof v.iv === 'string';

const ORG = 'org_acme';

(async () => {
  console.log('\nreport-front-matter: "About this session" and "Who was here" reach reportData\n');

  console.log('1. a platform (orgless) session — eventDetails and joinedAt travel in the clear');
  {
    const gameId = '9001';
    table.store.clear(); kmsStubs.forgetAllOrgs();
    const PK = `GAME#${gameId}`;
    put({
      PK, SK: 'METADATA', GameType: 'trivia', Started: true,
      Title: 'Team Standup', HostName: 'Host',
      Details: 'A quarterly check-in for the whole team.',
    });
    put({ PK, SK: 'STATE', State: 'ASK#001', LessonNumber: 1 });
    put({ PK, SK: 'PLAYER#Amara', PlayerName: 'Amara', JoinedAt: '2026-09-20T10:00:00.000Z' });
    put({ PK, SK: 'PLAYER#Amara#SCORE', PlayerName: 'Amara', score: 10 });
    put({ PK, SK: 'PLAYER#Devi', PlayerName: 'Devi', JoinedAt: '2026-09-20T10:02:00.000Z' });
    put({ PK, SK: 'PLAYER#Devi#SCORE', PlayerName: 'Devi', score: 25 });

    const out = await createReport({ pathParameters: { gameId } });
    await check('create-report returns 200', () =>
      assert.strictEqual(out.statusCode, 200, `got ${out.statusCode}: ${out.body}`));
    const report = JSON.parse(out.body).report;

    await check("eventDetails carries the session's Details field", () =>
      assert.strictEqual(report.eventDetails, 'A quarterly check-in for the whole team.'));
    await check('each player carries their own joinedAt', () => {
      const byName = Object.fromEntries(report.playerPerformance.map((p) => [p.playerName, p.joinedAt]));
      assert.strictEqual(byName.Amara, '2026-09-20T10:00:00.000Z');
      assert.strictEqual(byName.Devi, '2026-09-20T10:02:00.000Z');
    });
  }

  console.log('\n2. a session with no Details at all — eventDetails is an empty string, not undefined');
  {
    const gameId = '9002';
    table.store.clear(); kmsStubs.forgetAllOrgs();
    const PK = `GAME#${gameId}`;
    put({ PK, SK: 'METADATA', GameType: 'trivia', Started: true, Title: 'No blurb', HostName: 'Host' });
    put({ PK, SK: 'STATE', State: 'ASK#001', LessonNumber: 1 });

    const out = await createReport({ pathParameters: { gameId } });
    const report = JSON.parse(out.body).report;
    await check('eventDetails is an empty string when Details was never set', () =>
      assert.strictEqual(report.eventDetails, ''));
    await check('a player with no JoinedAt on the row reports joinedAt null, not undefined', () => {
      // No players seeded at all here; the shape is exercised properly in
      // section 3, this just pins the empty-report baseline.
      assert.deepStrictEqual(report.playerPerformance, []);
    });
  }

  console.log("\n3. an organisation's session — Details is sealed at rest, decrypted for the report");
  {
    const gameId = '9003';
    table.store.clear(); kmsStubs.forgetAllOrgs();
    const PK = `GAME#${gameId}`;
    put(await C.encryptItem(ORG, 'session', {
      PK, SK: 'METADATA', GameType: 'trivia', Started: true, orgId: ORG,
      Title: 'Org offsite', HostName: 'Host',
      Details: 'What we are here to decide together.',
    }));
    put({ PK, SK: 'STATE', State: 'ASK#001', LessonNumber: 1 });
    // No JoinedAt on this one — the field predates this row shape, and the
    // report must not throw or invent a timestamp for it.
    put({ PK, SK: 'PLAYER#Lee', PlayerName: 'Lee' });
    put({ PK, SK: 'PLAYER#Lee#SCORE', PlayerName: 'Lee', score: 0 });

    await check('(the fixture is actually sealed)', () => {
      const row = get(PK, 'METADATA');
      assert.ok(isEnvelope(row.Details), 'the fixture Details field is not encrypted');
    });

    const out = await createReport({ pathParameters: { gameId } });
    await check('create-report returns 200', () =>
      assert.strictEqual(out.statusCode, 200, `got ${out.statusCode}: ${out.body}`));
    const report = JSON.parse(out.body).report;

    await check('the response carries the decrypted Details as eventDetails', () =>
      assert.strictEqual(report.eventDetails, 'What we are here to decide together.'));
    await check('a player with no JoinedAt reports joinedAt null rather than throwing', () =>
      assert.strictEqual(report.playerPerformance.find((p) => p.playerName === 'Lee').joinedAt, null));

    const storedRow = get(PK, 'REPORT');
    await check('the stored REPORT snapshot seals eventDetails at rest', () =>
      assert.ok(isEnvelope(storedRow.eventDetails), 'the stored report carries eventDetails in the clear'));
    const stored = kmsStubs.plainRow(ORG, storedRow);
    await check('...and quotes the same words once opened', () =>
      assert.strictEqual(stored.eventDetails, 'What we are here to decide together.'));
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  suiteFinished();
  process.exit(fail === 0 ? 0 : 1);
})();
