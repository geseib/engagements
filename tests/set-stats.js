/**
 * A SET'S OWN NUMBERS: COPIED AND DOWNLOADED — usage-stats SPEC §5 E10, E11.
 *
 * Driven through the real admin handlers (copy-question-set.js,
 * download-question-set.js):
 *
 *   §1  a copy of platform v2 bumps the PLATFORM set's V#2 `copies` — never
 *       the copy's own row
 *   §2  a download of `?version=1` bumps V#1; the active version is the one
 *       counted when none is asked for
 *   §3  a download that fails (404) or finds an empty set bumps nothing
 *   §4  set rows hold ids and counts: no name, no question
 *
 * Every check carries a `// rejects:` line naming the change it catches.
 */
const path = require('path');
const assert = require('assert');

const H = require('./helpers/moderation-harness');
H.install();

const tenant = require(path.join(H.REPO, 'lambda-functions/admin/shared/tenant.js'));
const { setMetadataKey, setPartition } = require(path.join(H.REPO, 'lambda-functions/admin/shared/set-version.js'));
const copySet = require(path.join(H.REPO, 'lambda-functions/admin/copy-question-set.js')).handler;
const download = require(path.join(H.REPO, 'lambda-functions/admin/download-question-set.js')).handler;

const GLOBEX = 'org_globex';
const SET = 'icebreakers';
const NAME = 'Quick icebreakers';

/** A platform set at v1 and v2, active v2, one question in each. */
function platformSet() {
  H.seedRow({
    ...setMetadataKey({ scope: tenant.PLATFORM, orgId: '', setId: SET }),
    name: NAME,
    engagementType: 'call-and-answer',
    activeVersion: 2,
    versions: [{ version: 1, questionCount: 1 }, { version: 2, questionCount: 1 }],
  });
  for (const v of [1, 2]) {
    const pk = setPartition({ scope: tenant.PLATFORM, orgId: '', setId: SET }, v);
    H.seedRow({ PK: pk, SK: 'CATEGORY#c001', Name: 'Warm-up', QuestionCount: 1 });
    H.seedRow({ PK: pk, SK: 'QUESTION#c001#001', Category: 'Warm-up', Title: `WHAT WOULD YOU BRING v${v}`, Detail: 'Say why.' });
  }
}
const statsRow = (v) => H.rowsWhere((r) => r.PK === tenant.setStatsPk(tenant.PLATFORM) && r.SK === `SET#${SET}#V#${v}`)[0] || {};
const dl = (setId, query) => download({ ...H.orgEvent({ orgId: GLOBEX, role: 'member', method: 'GET', setId }), queryStringParameters: query });

(async () => {
  console.log('\nset stats: copied and downloaded\n');

  console.log('§1 copies');
  await H.test('a copy of platform v2 counts on the platform set\'s V#2, not on the copy', async () => {
    H.reset();
    platformSet();
    const res = await copySet(H.orgEvent({ orgId: GLOBEX, role: 'member', method: 'POST', setId: SET, body: { scope: tenant.PLATFORM, version: 2 } }), H.ctx());
    assert.strictEqual(res.statusCode, 201, res.body);
    // rejects: counting a copy against the version the copy BECAME (v1 of the new set).
    assert.strictEqual(statsRow(2).copies, 1);
    assert.strictEqual(statsRow(1).copies, undefined);
    // rejects: a stats row for the copy itself.
    assert.strictEqual(H.rowsWhere((r) => r.PK === tenant.setStatsPk(tenant.ORG, GLOBEX)).length, 0);
  });

  console.log('\n§2 downloads');
  await H.test('?version=1 counts on V#1; no version counts the active one', async () => {
    H.reset();
    platformSet();
    const one = await dl(SET, { version: '1' });
    assert.strictEqual(one.statusCode, 200, one.body);
    assert.strictEqual(statsRow(1).downloads, 1);
    // rejects: counting the requested version as the active one.
    assert.strictEqual(statsRow(2).downloads, undefined);
    await dl(SET, {});
    assert.strictEqual(statsRow(2).downloads, 1);
  });

  console.log('\n§3 a failed download counts nothing');
  // rejects: counting before the set was found.
  await H.test('a 404 bumps nothing', async () => {
    H.reset();
    const res = await dl('nosuchset', {});
    assert.strictEqual(res.statusCode, 404);
    assert.strictEqual(H.rowsWhere((r) => /SETSTATS$/.test(r.PK)).length, 0);
  });
  // rejects: counting a download of nothing.
  await H.test('an empty set bumps nothing', async () => {
    H.reset();
    H.seedRow({ ...setMetadataKey({ scope: tenant.PLATFORM, orgId: '', setId: 'empty' }), name: 'Empty', engagementType: 'trivia' });
    await dl('empty', {});
    assert.strictEqual(H.rowsWhere((r) => /SETSTATS$/.test(r.PK)).length, 0);
  });

  console.log('\n§4 numbers and ids only');
  // rejects: a set name or a question copied into a stats row.
  await H.test('set rows carry no name and no question', async () => {
    H.reset();
    platformSet();
    await dl(SET, {});
    await copySet(H.orgEvent({ orgId: GLOBEX, role: 'member', method: 'POST', setId: SET, body: { scope: tenant.PLATFORM } }), H.ctx());
    const rows = H.rowsWhere((r) => /SETSTATS$/.test(r.PK));
    assert.ok(rows.length >= 1);
    const text = JSON.stringify(rows);
    for (const s of [NAME, 'WHAT WOULD YOU BRING', 'Warm-up']) assert.ok(!text.includes(s), s);
    assert.ok(rows.every((r) => !('ttl' in r)));
  });

  H.summary();
})().catch((e) => { console.error(e); process.exit(1); });
