/**
 * FILES GO WITH THE ROWS THAT POINT AT THEM — lambda-functions/admin/shared/
 * artifact-sweep.js, driven by the table's stream consumer (usage-stream.js),
 * 2026-10-04.
 *
 * An event item's slides (`decks/…`) were deleted with the event or the item
 * but never when the event expired by its ttl, and a Build Room's screenshots
 * and patches (`builds/<gameId>/…`) outlived a room deleted through
 * clear-game. The stream sees every removal — a delete and a ttl expiry alike
 * — with the removed row's OldImage, so the files follow their rows.
 *
 * rejects: a removed item's deck left behind; a removed Build Room's files
 * left behind, past one listing page too; a file deleted for a row that was
 * only modified, for an ordinary session, or for a deck key outside decks/;
 * a failing S3 that throws (a throwing batch blocks the shard, and the usage
 * meter with it); the meter skipped because files were swept.
 */
const suiteFinished = require('./helpers/finish-guard');
const assert = require('assert');
const path = require('path');
const Module = require('module');
const REPO = path.join(__dirname, '..');

const objects = new Set();
const calls = [];
let failDeletes = false;
class ListObjectsV2Command { constructor(input) { this.input = input; } }
class DeleteObjectCommand { constructor(input) { this.input = input; } }
const s3 = {
  S3Client: class {
    async send(cmd) {
      calls.push({ name: cmd.constructor.name, input: cmd.input });
      if (cmd instanceof ListObjectsV2Command) {
        // Two keys a page, so a sweep that reads one page leaves files behind.
        const all = [...objects].filter((k) => k.startsWith(cmd.input.Prefix)).sort();
        const start = cmd.input.ContinuationToken ? Number(cmd.input.ContinuationToken) : 0;
        const page = all.slice(start, start + 2);
        const more = start + 2 < all.length;
        return { Contents: page.map((Key) => ({ Key })), IsTruncated: more, ...(more ? { NextContinuationToken: String(start + 2) } : {}) };
      }
      if (cmd instanceof DeleteObjectCommand) {
        if (failDeletes) throw Object.assign(new Error('AccessDenied'), { name: 'AccessDenied' });
        objects.delete(cmd.input.Key);
        return {};
      }
      throw new Error(`unexpected ${cmd.constructor.name}`);
    }
  },
  ListObjectsV2Command,
  DeleteObjectCommand,
};
const counted = [];
const stubs = new Map([
  ['@aws-sdk/client-s3', s3],
]);
const realLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (stubs.has(request)) return stubs.get(request);
  if (/shared[\\/]usage$/.test(request) || request === './shared/usage') {
    return {
      countSets: async (orgId) => { counted.push(orgId); return 3; },
      recordSetCount: async () => ({ raised: false }),
    };
  }
  return realLoad.call(this, request, parent, isMain);
};
process.env.MEDIA_BUCKET = 'test-media';
process.env.TABLE_NAME = 'test-table';

const { artifactsOf, sweepArtifacts } = require(path.join(REPO, 'lambda-functions/admin/shared/artifact-sweep.js'));
const stream = require(path.join(REPO, 'lambda-functions/admin/usage-stream.js'));

let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok - ${label}`); pass += 1; }
  catch (e) { console.log(`  FAIL - ${label}\n    ${e.stack || e.message}`); fail += 1; }
}

const S = (s) => ({ S: s });
const record = (eventName, pk, sk, old = {}) => ({
  eventName, dynamodb: { Keys: { PK: S(pk), SK: S(sk) }, OldImage: old },
});
const itemRemoved = (key) => record('REMOVE', 'EVENT#4821', 'ITEM#it_0000aaaa', {
  Deck: { M: { key: S(key), bytes: { N: '1000' }, pages: { N: '12' } } }, DeckName: { M: { v: { N: '1' } } },
});
const roomRemoved = (gameId, type = 'build') => record('REMOVE', `GAME#${gameId}`, 'METADATA', { GameType: S(type) });

(async () => {
  console.log('\n1. which rows point at which files');
  await check("a removed event item points at its deck", () => {
    assert.deepStrictEqual(artifactsOf(itemRemoved('decks/o1/4821/abc.pdf')), { keys: ['decks/o1/4821/abc.pdf'], prefixes: [] });
  });
  await check("a removed Build Room's METADATA points at everything under builds/<id>/", () => {
    assert.deepStrictEqual(artifactsOf(roomRemoved('5102')), { keys: [], prefixes: ['builds/5102/'] });
  });
  await check('nothing for a MODIFY, an ordinary session, an item with no deck, or a deck key outside decks/', () => {
    const none = { keys: [], prefixes: [] };
    assert.deepStrictEqual(artifactsOf({ ...itemRemoved('decks/o1/4821/abc.pdf'), eventName: 'MODIFY' }), none);
    assert.deepStrictEqual(artifactsOf(roomRemoved('5101', 'trivia')), none);
    assert.deepStrictEqual(artifactsOf(record('REMOVE', 'EVENT#4821', 'ITEM#it_0000aaaa', {})), none);
    assert.deepStrictEqual(artifactsOf(itemRemoved('sets/x/y.png')), none);
    assert.deepStrictEqual(artifactsOf(itemRemoved('decks/../sets/x.png')), none);
    assert.deepStrictEqual(artifactsOf(record('REMOVE', 'GAME#5102', 'BUILD#IMG#1', {})), none);
  });

  console.log('\n2. the sweep');
  await check("a deck and a room's five files (three listing pages) are deleted; nobody else's", async () => {
    ['decks/o1/4821/abc.pdf', 'decks/o1/4821/keep.pdf', 'builds/5102/i1', 'builds/5102/i2', 'builds/5102/i3',
      'builds/5102/patch-s1-v1', 'builds/5102/patch-s1-v2', 'builds/5103/i1', 'sets/s/x.png'].forEach((k) => objects.add(k));
    const n = await sweepArtifacts([itemRemoved('decks/o1/4821/abc.pdf'), roomRemoved('5102')]);
    assert.strictEqual(n, 6);
    assert.deepStrictEqual([...objects].sort(), ['builds/5103/i1', 'decks/o1/4821/keep.pdf', 'sets/s/x.png']);
  });
  await check('a batch with nothing to sweep never calls S3', async () => {
    calls.length = 0;
    await sweepArtifacts([record('INSERT', 'GAME#1', 'METADATA', {}), roomRemoved('5101', 'poll')]);
    assert.strictEqual(calls.length, 0);
  });
  await check('an S3 that refuses is logged, never thrown', async () => {
    objects.add('decks/o1/4821/z.pdf');
    failDeletes = true;
    try {
      assert.strictEqual(await sweepArtifacts([itemRemoved('decks/o1/4821/z.pdf')]), 0);
    } finally { failDeletes = false; }
  });

  console.log('\n3. the stream consumer does both jobs');
  await check('one batch: the files are swept and the set meter still counts', async () => {
    objects.add('decks/o1/4821/q.pdf');
    counted.length = 0;
    const out = await stream.handler({
      Records: [
        itemRemoved('decks/o1/4821/q.pdf'),
        record('INSERT', 'ORG#acme#SETS', 'SET#one', {}),
      ],
    });
    assert.strictEqual(out.filesSwept, 1);
    assert.strictEqual(out.orgsMeasured, 1);
    assert.deepStrictEqual(counted, ['acme']);
    assert.ok(!objects.has('decks/o1/4821/q.pdf'));
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
