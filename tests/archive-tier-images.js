/**
 * PROMOTING DEV → TEST, AS IT WAS DONE FOR REAL ON 2026-11-08 — the three gaps it found.
 *
 * 1. An image stored as an absolute URL on the source tier's own site
 *    (https://engage.dev.seibtribe.us/sets/<setId>/<file>) is an object in that tier's media
 *    bucket. It used to be treated as somebody else's picture: not copied, not reported, and on
 *    test every one loaded test's index.html. It now travels like a stored key and comes back as
 *    one, `sets/<setId>/<file>`, which every tier serves same-origin.
 * 2. Truly external URLs stay as they are, and the preview and the report list them.
 * 3. Prompts are restored before sets in one batch, so a set's prompt link lands on the copy
 *    that just arrived — and the restored prompt is read back like a set is.
 *
 * Runs the REAL export and import handlers against tests/helpers/archive-harness.js.
 *
 * // rejects: a tier-site URL left pointing at the source tier; an external URL rewritten or
 * //          silently dropped from the report; a dry run that writes; a set restored before its
 * //          prompt in the same batch; a prompt restore with no read-back; the backend's tier
 * //          hosts drifting from the frontend's.
 */
const h = require('./helpers/archive-harness');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const SHARED = path.join(REPO, 'lambda-functions/admin/shared');
const { setMetadataKey, setPartition } = require(path.join(SHARED, 'set-version.js'));
const { TIER_HOSTS } = require(path.join(SHARED, 'tier-hosts.js'));
const media = require(path.join(SHARED, 'archive-media.js'));
const exportHandler = require(path.join(REPO, 'lambda-functions/admin/export-to-archive.js')).handler;
const importHandler = require(path.join(REPO, 'lambda-functions/admin/import-from-archive.js')).handler;

const { check, finish } = h.checker();
const parse = (res) => ({ status: res.statusCode, body: JSON.parse(res.body) });
const exportAs = async (exportType, ...selectedItems) => parse(await exportHandler(h.adminEvent({ selectedItems, exportType })));
const importItems = async (ids, extra = {}) => parse(await importHandler(h.adminEvent({ selectedItems: ids, ...extra })));
const metaRow = (setId) => { const k = setMetadataKey({ scope: 'platform', setId }); return h.get(k.PK, k.SK); };
const envelopeOf = (archiveId) => JSON.parse(h.archive.get(archiveId).content);

const DEV_MEDIA = 'engagedev-media';
const TEST_MEDIA = 'engagetest-media';
const OWN_URL = 'https://engage.dev.seibtribe.us/sets/whatisthisthing/witt-01.jpg';
const OWN_URL_SPACE = 'https://engage.dev.seibtribe.us/sets/whatisthisthing/witt%2002.jpg?v=3';
const GONE_URL = 'https://engage.dev.seibtribe.us/sets/whatisthisthing/witt-99.jpg';
const WIKI = 'https://commons.wikimedia.org/wiki/Special:FilePath/Mona_Lisa.jpg';

function seedWitt() {
  h.seedSet({
    setId: 'whatisthisthing',
    version: 1,
    meta: { name: 'What Is This Thing?', engagementType: 'call-and-answer', active: true, promptId: 'witt-reveal' },
    rows: [
      { SK: 'CATEGORY#c001', Name: 'Things' },
      { SK: 'QUESTION#c001#001', Title: 'One', Category: 'Things', Image: OWN_URL },
      { SK: 'QUESTION#c001#002', Title: 'Two', Category: 'Things', Image: OWN_URL_SPACE },
      { SK: 'QUESTION#c001#003', Title: 'Three', Category: 'Things', Image: WIKI },
      { SK: 'QUESTION#c001#004', Title: 'Four', Category: 'Things', Image: GONE_URL },
      { SK: 'QUESTION#c001#005', Title: 'Five', Category: 'Things', Image: OWN_URL },
    ],
  });
  h.seedPrompt({
    promptId: 'witt-reveal',
    row: { name: 'What Is This Thing? reveal', status: 'active', version: 4 },
    body: { name: 'What Is This Thing? reveal', instructions: 'Reveal {thing}' },
  });
  h.objects.set(`${DEV_MEDIA}/sets/whatisthisthing/witt-01.jpg`, { Body: 'JPG-01' });
  h.objects.set(`${DEV_MEDIA}/sets/whatisthisthing/witt 02.jpg`, { Body: 'JPG-02' });
}

/** Move to a fresh test tier: an empty table and media bucket; only the archive survives. */
function becomeTest() {
  h.table.clear();
  for (const key of [...h.objects.keys()]) if (!key.startsWith(`${process.env.ARCHIVE_BUCKET}/`)) h.objects.delete(key);
  process.env.ENVIRONMENT = 'test';
  process.env.MEDIA_BUCKET = TEST_MEDIA;
}
function becomeDev() {
  process.env.ENVIRONMENT = 'dev';
  process.env.MEDIA_BUCKET = DEV_MEDIA;
}

(async () => {
  console.log('0. which URLs are an Engage tier\'s own media');
  await check('the backend tier hosts equal src/src/config/tierHosts.js', () => {
    const source = fs.readFileSync(path.join(REPO, 'src/src/config/tierHosts.js'), 'utf8');
    const block = source.match(/TIER_HOSTS\s*=\s*Object\.freeze\(\{([\s\S]*?)\}\)/);
    assert.ok(block, 'TIER_HOSTS not found in tierHosts.js');
    const front = Object.fromEntries([...block[1].matchAll(/(\w+):\s*'([^']+)'/g)].map((m) => [m[1], m[2]]));
    assert.deepStrictEqual(front, { ...TIER_HOSTS });
  });
  await check('a tier-site sets/ URL names its key; anything else names none', () => {
    assert.strictEqual(media.tierMediaKey(OWN_URL), 'sets/whatisthisthing/witt-01.jpg');
    assert.strictEqual(media.tierMediaKey(OWN_URL_SPACE), 'sets/whatisthisthing/witt 02.jpg');
    assert.strictEqual(media.tierMediaKey('https://ENGAGE.seibtribe.us/sets/a/b.png'), 'sets/a/b.png');
    assert.strictEqual(media.tierMediaKey('https://engage.test.seibtribe.us/sets/a/b.png'), 'sets/a/b.png');
    for (const other of [
      WIKI,
      // The retired twin is not a tier. Built from parts so the twin guard
      // (tests/no-retired-twin-references.js) sees no literal: this only proves it is refused.
      `https://${['eng', 'dev', 'seibtribe', 'us'].join('.')}/sets/a/b.png`,
      'https://engage.dev.seibtribe.us/assets/art/x.jpg', // not under one set's folder
      'https://engage.dev.seibtribe.us/sets/a/b/c.png',
      'https://engage.dev.seibtribe.us/sets/%2e%2e/config.js',
      'https://engage.dev.seibtribe.us.evil.example/sets/a/b.png',
      'sets/a/b.png',
      '/assets/art/x.jpg',
    ]) assert.strictEqual(media.tierMediaKey(other), '', other);
  });

  console.log('\n1. export on dev: the tier-site images go into the backup');
  h.reset();
  becomeDev();
  seedWitt();
  const setExport = await exportAs('questionsets', 'whatisthisthing');
  const setArchiveId = setExport.body.results.successful[0].archiveId;
  await check('both present objects are copied into the archive, each once, carrying the URLs that name it', () => {
    const env = envelopeOf(setArchiveId);
    assert.deepStrictEqual(env.media, [
      { key: 'sets/whatisthisthing/witt 02.jpg', archiveKey: `archive/media/${env.snapshotId}/sets/whatisthisthing/witt 02.jpg`, urls: [OWN_URL_SPACE] },
      { key: 'sets/whatisthisthing/witt-01.jpg', archiveKey: `archive/media/${env.snapshotId}/sets/whatisthisthing/witt-01.jpg`, urls: [OWN_URL] },
    ]);
    assert.strictEqual(h.objects.get(`${process.env.ARCHIVE_BUCKET}/${env.media[1].archiveKey}`).Body, 'JPG-01');
  });
  await check('the export says which tier-site image was missing and which image is external', () => {
    assert.deepStrictEqual(setExport.body.results.successful[0].media, {
      copied: 2, missing: [GONE_URL], skipped: [], external: [WIKI],
    });
  });
  await check('the snapshot rows are what dev holds: URLs are rewritten on the way in, not out', () => {
    assert.strictEqual(envelopeOf(setArchiveId).rows.find((r) => r.SK === 'QUESTION#c001#001').Image, OWN_URL);
  });
  const promptExport = await exportAs('prompts', 'witt-reveal');
  const promptArchiveId = promptExport.body.results.successful[0].archiveId;

  console.log('\n2. a dry run on test lists what stays on another site, and writes nothing');
  becomeTest();
  const tableBefore = JSON.stringify([...h.table.entries()]);
  const objectsBefore = JSON.stringify([...h.objects.keys()]);
  h.writes.length = 0;
  let res = await importItems([setArchiveId, promptArchiveId], { dryRun: true });
  await check('nothing was written: no row, no object', () => {
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(h.writes, []);
    assert.strictEqual(JSON.stringify([...h.table.entries()]), tableBefore);
    assert.strictEqual(JSON.stringify([...h.objects.keys()]), objectsBefore);
  });
  await check('the plan lists the prompt first, then the set', () => {
    assert.deepStrictEqual(res.body.plan.map((p) => [p.archiveId, p.kind]), [[promptArchiveId, 'prompt'], [setArchiveId, 'set']]);
  });
  await check('the set names the images that will stay on another site: the external one and the one not in the backup', () => {
    assert.deepStrictEqual(res.body.plan[1].externalImages, [WIKI, GONE_URL].sort());
  });

  console.log('\n3. the restore on test: images copied and rewritten, prompt first');
  h.writes.length = 0;
  res = await importItems([setArchiveId, promptArchiveId]);
  const rowsNow = h.rows(setPartition({ scope: 'platform', setId: 'whatisthisthing' }, 1));
  const imageOf = (sk) => rowsNow.find((r) => r.SK === sk).Image;
  await check('no failures; the prompt was restored before the set though it was asked for second', () => {
    assert.deepStrictEqual(res.body.results.failed, []);
    assert.deepStrictEqual(res.body.results.successful.map((r) => r.kind), ['prompt', 'set']);
    const firstSetWrite = h.writes.findIndex((w) => String(w.PK).startsWith('SET#') || String(w.SK).startsWith('SET#'));
    const promptWrite = h.writes.findIndex((w) => String(w.SK) === 'AIPROMPT#witt-reveal');
    assert.ok(promptWrite >= 0 && firstSetWrite >= 0 && promptWrite < firstSetWrite, `prompt write ${promptWrite}, first set write ${firstSetWrite}`);
  });
  await check("the set's prompt link resolves to the copy that just landed", () => {
    assert.strictEqual(metaRow('whatisthisthing').promptId, 'witt-reveal');
  });
  await check("the dev objects are now in test's media bucket under the same keys", () => {
    assert.strictEqual(h.objects.get(`${TEST_MEDIA}/sets/whatisthisthing/witt-01.jpg`).Body, 'JPG-01');
    assert.strictEqual(h.objects.get(`${TEST_MEDIA}/sets/whatisthisthing/witt 02.jpg`).Body, 'JPG-02');
  });
  await check('their rows name the stored key, which every tier serves same-origin', () => {
    assert.strictEqual(imageOf('QUESTION#c001#001'), 'sets/whatisthisthing/witt-01.jpg');
    assert.strictEqual(imageOf('QUESTION#c001#005'), 'sets/whatisthisthing/witt-01.jpg');
    assert.strictEqual(imageOf('QUESTION#c001#002'), 'sets/whatisthisthing/witt 02.jpg');
  });
  await check('the external URL and the one not in the backup are left exactly as they were', () => {
    assert.strictEqual(imageOf('QUESTION#c001#003'), WIKI);
    assert.strictEqual(imageOf('QUESTION#c001#004'), GONE_URL);
  });
  await check('the report lists them as staying on another site', () => {
    assert.deepStrictEqual(res.body.media, { copied: 2, kept: 0, missing: [], skipped: [], external: [WIKI, GONE_URL].sort() });
  });

  console.log('\n4. the restored prompt is read back');
  await check('version, status, active and name, beside what the restore wrote', () => {
    const entry = res.body.results.successful[0];
    assert.deepStrictEqual(entry.check, {
      version: entry.version, status: 'active', active: true, name: 'What Is This Thing? reveal', hasBody: true, matches: true,
    });
    assert.strictEqual(entry.version, 5);
  });

  becomeDev();
  finish();
})().catch((e) => { console.error('harness error:', e); process.exit(2); });
