/**
 * FILES GO WITH THE ROWS THAT POINT AT THEM (2026-10-04, events and Build
 * Rooms integration).
 *
 * The owner asked for lifecycle management "to all of their artifacts as
 * well, just like the other types engagements". Two kinds of engagement keep
 * files in the media bucket that nothing deleted when their rows went:
 *
 *   - AN EVENT'S SLIDES (`decks/<org>/<code>/<nonce>.pdf`, deck-store.js).
 *     Deleted when the event is deleted or the item removed, but never when
 *     the event simply EXPIRED by its ttl — there is no S3 rule for decks/,
 *     and an event's ttl is set from its date, which no bucket rule can know.
 *   - A BUILD ROOM'S SCREENSHOTS AND PATCHES (`builds/<gameId>/…`,
 *     build-room.js). Deleted one at a time by the host; a room deleted
 *     through POST /admin/clear-game, or expired, left them for the bucket's
 *     30-day `builds/` rule.
 *
 * The table's stream sees every row removal, deletes and ttl expiry alike
 * (StreamViewType NEW_AND_OLD_IMAGES, so the removed row's OldImage is in the
 * record). So the stream consumer that already exists (usage-stream.js) asks
 * this file, for each REMOVE, which objects the removed row pointed at:
 *
 *   EVENT#<code> / ITEM#<id>     whose OldImage carries Deck.key under decks/
 *                                → that one object
 *   GAME#<id> / METADATA         whose OldImage says GameType 'build'
 *                                → every object under builds/<id>/
 *
 * Everything here is a DELETE OF A FILE NOTHING CAN READ ANY MORE: a deck is
 * read only through its item row (a signed URL), a room's files only through
 * the room's routes, which 404 once METADATA is gone. Deleting twice is
 * harmless (S3 answers 204 for a missing key). The 30-day `builds/` rule
 * stays as the backstop for anything a dropped stream batch misses.
 *
 * It NEVER THROWS: a shard that throws is retried and blocks every record
 * behind it, including the usage meter's.
 */
const BUILD_PREFIX = 'builds/';
const DECK_PREFIX = 'decks/';
const GAME_ID = /^\d{4}$/;

const str = (attr) => (attr && typeof attr.S === 'string' ? attr.S : '');

/**
 * What one stream record asks to be deleted:
 * `{ keys: string[], prefixes: string[] }` — both empty for anything else.
 */
function artifactsOf(record) {
  const none = { keys: [], prefixes: [] };
  if (!record || record.eventName !== 'REMOVE') return none;
  const d = record.dynamodb || {};
  const pk = str((d.Keys || {}).PK);
  const sk = str((d.Keys || {}).SK);
  const old = d.OldImage || {};

  if (pk.startsWith('EVENT#') && sk.startsWith('ITEM#')) {
    const deck = old.Deck && old.Deck.M;
    const key = deck ? str(deck.key) : '';
    return key.startsWith(DECK_PREFIX) && !key.includes('..') ? { keys: [key], prefixes: [] } : none;
  }

  if (pk.startsWith('GAME#') && sk === 'METADATA' && str(old.GameType) === 'build') {
    const gameId = pk.slice('GAME#'.length);
    return GAME_ID.test(gameId) ? { keys: [], prefixes: [`${BUILD_PREFIX}${gameId}/`] } : none;
  }
  return none;
}

let s3sdk = null;
let client = null;
function s3() {
  // Required on first use: the stream consumer runs for every record of the
  // table, and only a removal of one of these rows needs S3 at all.
  if (!s3sdk) s3sdk = require('@aws-sdk/client-s3');
  if (!client) client = new s3sdk.S3Client({});
  return { sdk: s3sdk, client };
}

/** Every key under `prefix`, paged (ListObjectsV2 returns at most 1,000). */
async function keysUnder(bucket, prefix) {
  const { sdk, client: c } = s3();
  const keys = [];
  let ContinuationToken;
  do {
    const page = await c.send(new sdk.ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken }));
    for (const obj of (page && page.Contents) || []) if (obj && obj.Key) keys.push(obj.Key);
    ContinuationToken = page && page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (ContinuationToken);
  return keys;
}

/**
 * Delete what a batch of stream records points at. Returns how many objects
 * were deleted. Never throws; logs keys only (never contents).
 */
async function sweepArtifacts(records, { bucket = process.env.MEDIA_BUCKET } = {}) {
  const keys = new Set();
  const prefixes = new Set();
  for (const record of records || []) {
    const found = artifactsOf(record);
    found.keys.forEach((k) => keys.add(k));
    found.prefixes.forEach((p) => prefixes.add(p));
  }
  if (!keys.size && !prefixes.size) return 0;
  if (!bucket) {
    console.error('⚠️ artifact-sweep: MEDIA_BUCKET is not set; leaving files for the bucket rules');
    return 0;
  }
  let deleted = 0;
  try {
    for (const prefix of prefixes) {
      for (const key of await keysUnder(bucket, prefix)) keys.add(key);
    }
  } catch (error) {
    console.error('⚠️ artifact-sweep: could not list a prefix:', error && error.message);
  }
  const { sdk, client: c } = s3();
  for (const key of keys) {
    try {
      await c.send(new sdk.DeleteObjectCommand({ Bucket: bucket, Key: key }));
      deleted += 1;
    } catch (error) {
      console.error(`⚠️ artifact-sweep: could not delete ${key}:`, error && error.message);
    }
  }
  if (deleted) console.log(`🧹 artifact-sweep: ${deleted} file(s) went with their rows`);
  return deleted;
}

module.exports = { artifactsOf, sweepArtifacts };
