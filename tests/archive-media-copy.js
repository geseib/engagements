/**
 * A BACKUP'S IMAGES GO OUT WITH IT AND COME BACK WITH IT — without clobbering a live one.
 *
 * spec §4.5 and amendment A11. A question row stores an image as a KEY into its tier's media
 * bucket, never as bytes, so a backup that copied only rows restored every image as a
 * broken link.
 *
 * // rejects: copying remote URLs or repo assets; failing a whole backup over one lost image,
 * //          or over one stored outside sets/ that export's role may not read; hiding an
 * //          AccessDenied as a "missing" image; overwriting an image that already exists on
 * //          the tier; writing anywhere but one set's folder.
 */
const suiteFinished = require('./helpers/finish-guard');
const assert = require('assert');
const path = require('path');
const Module = require('module');

const REPO = path.join(__dirname, '..');
const objects = new Map(); // "bucket/key" -> body
let denyNext = false;
let noBucketNext = false;
const command = (name) => class { constructor(input) { this.input = input; this.name = name; } };
const failure = (name, status) => Object.assign(new Error(name), { name, $metadata: { httpStatusCode: status } });
const s3 = {
  async send(cmd) {
    const { Bucket, Key } = cmd.input;
    if (denyNext) { denyNext = false; throw failure('AccessDenied', 403); }
    if (noBucketNext) { noBucketNext = false; throw failure('NoSuchBucket', 404); }
    if (cmd.name === 'HeadObject') {
      if (!objects.has(`${Bucket}/${Key}`)) throw failure('NotFound', 404);
      return {};
    }
    if (cmd.name === 'CopyObject') {
      const source = cmd.input.CopySource;
      const slash = source.indexOf('/');
      const from = `${source.slice(0, slash)}/${source.slice(slash + 1).split('/').map(decodeURIComponent).join('/')}`;
      if (!objects.has(from)) throw failure('NoSuchKey', 404);
      objects.set(`${Bucket}/${Key}`, objects.get(from));
      return {};
    }
    throw new Error(`unstubbed S3 command ${cmd.name}`);
  },
};
const realLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === '@aws-sdk/client-s3') {
    return { CopyObjectCommand: command('CopyObject'), HeadObjectCommand: command('HeadObject') };
  }
  return realLoad.call(this, request, parent, isMain);
};
const media = require(path.join(REPO, 'lambda-functions/admin/shared/archive-media.js'));

let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok   - ${label}`); pass += 1; } catch (e) {
    console.log(`  FAIL - ${label}\n         ${e.message}`); fail += 1;
  }
}

const MEDIA = 'engagedev-media';
const ARCHIVE = 'engage2-archive-content';
const ROWS = [
  { SK: 'QUESTION#c001#001', Image: 'sets/art/smile.jpg' },
  { SK: 'QUESTION#c001#002', Image: 'sets/art/smile.jpg' },
  { SK: 'QUESTION#c001#003', Image: 'https://upload.wikimedia.org/x.jpg' },
  { SK: 'QUESTION#c001#004', Image: '/assets/art/local.jpg' },
  { SK: 'QUESTION#c001#005', Image: 'sets/art/gone.png' },
  { SK: 'QUESTION#c001#006', Image: 'sets/art/with space.png' },
  { SK: 'CATEGORY#c001', Name: 'Art' },
];

(async () => {
  console.log('1. which images are ours to copy');
  await check('uploaded keys only, each once, sorted — remote URLs and repo assets are left alone', () => {
    assert.deepStrictEqual(media.mediaKeysIn(ROWS), ['sets/art/gone.png', 'sets/art/smile.jpg', 'sets/art/with space.png']);
  });

  console.log('\n2. out to the archive');
  await check('present images are copied under the snapshot id; a missing one is reported, not fatal', async () => {
    objects.clear();
    objects.set(`${MEDIA}/sets/art/smile.jpg`, 'SMILE');
    objects.set(`${MEDIA}/sets/art/with space.png`, 'SPACE');
    const out = await media.copyMediaOut(s3, { mediaBucket: MEDIA, archiveBucket: ARCHIVE, snapshotId: 'snap-1', rows: ROWS });
    assert.deepStrictEqual(out.missing, ['sets/art/gone.png']);
    assert.deepStrictEqual(out.media, [
      { key: 'sets/art/smile.jpg', archiveKey: 'archive/media/snap-1/sets/art/smile.jpg' },
      { key: 'sets/art/with space.png', archiveKey: 'archive/media/snap-1/sets/art/with space.png' },
    ]);
    assert.strictEqual(objects.get(`${ARCHIVE}/archive/media/snap-1/sets/art/with space.png`), 'SPACE');
  });
  await check('an AccessDenied is thrown, not reported as a missing image', async () => {
    objects.clear();
    denyNext = true;
    await assert.rejects(
      () => media.copyMediaOut(s3, { mediaBucket: MEDIA, archiveBucket: ARCHIVE, snapshotId: 's', rows: ROWS }),
      /AccessDenied/,
    );
  });
  await check('a missing bucket is thrown, not reported as missing images', async () => {
    objects.clear();
    noBucketNext = true;
    await assert.rejects(
      () => media.copyMediaOut(s3, { mediaBucket: MEDIA, archiveBucket: ARCHIVE, snapshotId: 's', rows: ROWS }),
      /NoSuchBucket/,
    );
  });
  await check('an image stored outside sets/ is skipped with no S3 call, and the backup goes on', async () => {
    // Export's role may read only sets/* of the media bucket, so this S3 answers AccessDenied for
    // any other source, as the real one does. A key copyMediaIn could never write back is not
    // worth a call that fails the whole set's backup.
    const copies = [];
    const strict = {
      async send(cmd) {
        if (cmd.name !== 'CopyObject') throw new Error(`unexpected S3 command ${cmd.name}`);
        if (!cmd.input.CopySource.startsWith(`${MEDIA}/sets/`)) throw failure('AccessDenied', 403);
        copies.push(cmd.input.CopySource);
        return {};
      },
    };
    const out = await media.copyMediaOut(strict, {
      mediaBucket: MEDIA,
      archiveBucket: ARCHIVE,
      snapshotId: 'snap-2',
      rows: [{ SK: 'QUESTION#c001#001', Image: 'sets/s1/a.png' }, { SK: 'QUESTION#c001#002', Image: 'images/legacy.png' }],
    });
    assert.deepStrictEqual(copies, [`${MEDIA}/sets/s1/a.png`]);
    assert.deepStrictEqual(out.skipped, ['images/legacy.png']);
    assert.deepStrictEqual(out.media, [{ key: 'sets/s1/a.png', archiveKey: 'archive/media/snap-2/sets/s1/a.png' }]);
    assert.deepStrictEqual(out.missing, []);
  });
  await check('images with no bucket configured are a named deployment fault', async () => {
    await assert.rejects(
      () => media.copyMediaOut(s3, { mediaBucket: '', archiveBucket: ARCHIVE, snapshotId: 's', rows: ROWS }),
      /MEDIA_BUCKET/,
    );
  });
  await check('a set with no uploaded images needs no bucket at all', async () => {
    const out = await media.copyMediaOut(s3, {
      mediaBucket: '', archiveBucket: '', snapshotId: 's', rows: [{ SK: 'QUESTION#1', Image: '/assets/a.jpg' }],
    });
    assert.deepStrictEqual(out, { media: [], missing: [], skipped: [] });
    // Nor does a set whose only key is outside sets/: nothing would be copied, so nothing is asked of a bucket.
    const stray = await media.copyMediaOut(s3, {
      mediaBucket: '', archiveBucket: '', snapshotId: 's', rows: [{ SK: 'QUESTION#1', Image: 'images/legacy.png' }],
    });
    assert.deepStrictEqual(stray, { media: [], missing: [], skipped: ['images/legacy.png'] });
  });

  console.log('\n3. back onto a tier');
  await check('an absent image is restored; an existing one is kept untouched; a lost one is reported', async () => {
    objects.clear();
    objects.set(`${ARCHIVE}/archive/media/snap-1/sets/art/smile.jpg`, 'SMILE-ARCHIVED');
    objects.set(`${ARCHIVE}/archive/media/snap-1/sets/art/kept.jpg`, 'KEPT-ARCHIVED');
    objects.set(`${MEDIA}/sets/art/kept.jpg`, 'KEPT-LIVE');
    const out = await media.copyMediaIn(s3, {
      mediaBucket: MEDIA,
      archiveBucket: ARCHIVE,
      media: [
        { key: 'sets/art/smile.jpg', archiveKey: 'archive/media/snap-1/sets/art/smile.jpg' },
        { key: 'sets/art/kept.jpg', archiveKey: 'archive/media/snap-1/sets/art/kept.jpg' },
        { key: 'sets/art/lost.jpg', archiveKey: 'archive/media/snap-1/sets/art/lost.jpg' },
      ],
    });
    assert.deepStrictEqual(out, { copied: 1, kept: 1, missing: ['sets/art/lost.jpg'], skipped: [] });
    assert.strictEqual(objects.get(`${MEDIA}/sets/art/smile.jpg`), 'SMILE-ARCHIVED');
    // rejects: overwriting the live image that every other version of the set shows.
    assert.strictEqual(objects.get(`${MEDIA}/sets/art/kept.jpg`), 'KEPT-LIVE');
  });
  await check('a key outside one set folder, or an archive key outside the media prefix, is skipped', async () => {
    objects.clear();
    const out = await media.copyMediaIn(s3, {
      mediaBucket: MEDIA,
      archiveBucket: ARCHIVE,
      media: [
        { key: 'index.html', archiveKey: 'archive/media/s/index.html' },
        { key: 'sets/../config.js', archiveKey: 'archive/media/s/x' },
        { key: 'sets/a/b.png', archiveKey: 'archive/questionset/abc.csv' },
      ],
    });
    assert.deepStrictEqual(out, { copied: 0, kept: 0, missing: [], skipped: ['index.html', 'sets/../config.js', 'sets/a/b.png'] });
    assert.strictEqual(objects.size, 0);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('harness error:', e); process.exit(2); });
