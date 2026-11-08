/**
 * IMAGES TRAVEL WITH THE BACKUP.
 *
 * spec §4.5. A question row stores an image as a KEY into its tier's media bucket
 * (`sets/<setId>/<file>`, toMediaKey in upload-questions.js), never as bytes. A backup that
 * copied only rows restored every image as a broken link. These copy the objects out to the
 * archive bucket at export and back at restore, server-side.
 *
 * A MISSING OBJECT IS REPORTED, NEVER FATAL. Media already outlives its set
 * (delete-question-set.js never touches S3), so a backup is still worth taking when one image
 * is gone, and a restore is still worth finishing when one did not survive.
 *
 * A RESTORE NEVER OVERWRITES AN IMAGE THAT IS ALREADY THERE (A11). Media is per set, not per
 * version, so the live object under that key is what every other version of the set shows.
 *
 * ONLY A KEY UNDER ONE SET'S FOLDER TRAVELS, in either direction (`sets/<setId>/<file>`,
 * isRestorableKey). Export's role may read only `sets/*` of the media bucket, so a row whose
 * Image is stored anywhere else would answer AccessDenied and fail the whole set's backup — for
 * an object copyMediaIn could never write back anyway. Such a key is reported as `skipped`,
 * with no S3 call, and the bucket names are only required when there is a key to copy.
 *
 * Telling "missing" from "forbidden" needs s3:ListBucket, because without it S3 answers 403
 * for an absent key. template-clean.yaml grants it to both archive functions. Anything that
 * is not a missing object is re-thrown: an AccessDenied here is a deployment fault, and
 * reporting it as a lost image would hide it.
 *
 * AN ABSOLUTE URL ON ONE OF ENGAGE'S OWN SITES IS A KEY TOO (2026-11-08). Sets made by the
 * generators store `https://engage.dev.seibtribe.us/sets/<setId>/<file>`: the same object in
 * the same media bucket, reached through that tier's CloudFront `sets/*` behaviour. Treated as a
 * remote URL, it was neither copied nor reported, and on test every such image loaded test's
 * index.html instead of the picture. tierMediaKey() reads the key out of such a URL; export
 * copies the object from THIS tier's bucket like a stored key (an entry carrying `urls`), and
 * restore writes the row back as the stored key, `sets/<setId>/<file>`, which every tier serves
 * same-origin (set-media.js, "the images stay same-origin"). Any other absolute URL is somebody
 * else's picture: left as it is, and listed as `external` so the screens can say so.
 */
const { CopyObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const { isMediaKey } = require('./set-media');
const { isTierHost } = require('./tier-hosts');

const MEDIA_PREFIX = 'archive/media/';

function mediaKeysIn(rows) {
  const keys = new Set();
  for (const row of rows || []) {
    const image = String((row && row.Image) || '').trim();
    if (isMediaKey(image)) keys.add(image);
  }
  return [...keys].sort();
}

const isAbsoluteUrl = (value) => /^https?:\/\//i.test(String(value || '').trim());

/**
 * The media key behind an absolute URL on one of Engage's tier sites, or '' when the URL is
 * anything else: another host, a path outside one set's folder, or a path that does not decode.
 * The query and fragment are ignored; each path segment is decoded, as S3 keys are stored.
 */
function tierMediaKey(rawUrl) {
  const value = String(rawUrl || '').trim();
  if (!isAbsoluteUrl(value)) return '';
  let url;
  try { url = new URL(value); } catch { return ''; }
  if (!isTierHost(url.hostname)) return '';
  let key;
  try {
    key = url.pathname.replace(/^\/+/, '').split('/').map(decodeURIComponent).join('/');
  } catch { return ''; }
  return isRestorableKey(key) ? key : '';
}

/** `{url: key}` for every absolute tier-site media URL in these rows. */
function tierUrlsIn(rows) {
  const found = new Map();
  for (const row of rows || []) {
    const image = String((row && row.Image) || '').trim();
    const key = tierMediaKey(image);
    if (key) found.set(image, key);
  }
  return found;
}

/** Every absolute URL in these rows that is NOT on an Engage tier site, each once, sorted. */
function externalImagesIn(rows) {
  const urls = new Set();
  for (const row of rows || []) {
    const image = String((row && row.Image) || '').trim();
    if (isAbsoluteUrl(image) && !tierMediaKey(image)) urls.add(image);
  }
  return [...urls].sort();
}

/**
 * Every absolute URL left in these rows, each once, sorted: after rewriteTierUrls, the images
 * that stay on another site. That includes a tier-site URL whose object never made it into the
 * backup (a snapshot taken before tier URLs were copied, or one reported missing at export).
 */
function absoluteImagesIn(rows) {
  const urls = new Set();
  for (const row of rows || []) {
    const image = String((row && row.Image) || '').trim();
    if (isAbsoluteUrl(image)) urls.add(image);
  }
  return [...urls].sort();
}

/**
 * The rows with each tier-site URL whose object is now on this tier rewritten to its stored
 * key. `media` is the snapshot's entries; `notLanded` the keys copyMediaIn could not bring back
 * (missing or skipped), whose rows keep the URL they had. Never mutates its input.
 */
function rewriteTierUrls(rows, media, notLanded = []) {
  const failed = new Set(notLanded);
  const urlToKey = new Map();
  for (const entry of Array.isArray(media) ? media : []) {
    const key = String((entry && entry.key) || '');
    if (!key || failed.has(key)) continue;
    for (const url of Array.isArray(entry.urls) ? entry.urls : []) urlToKey.set(String(url), key);
  }
  if (urlToKey.size === 0) return rows;
  return (rows || []).map((row) => {
    const image = String((row && row.Image) || '').trim();
    return urlToKey.has(image) ? { ...row, Image: urlToKey.get(image) } : row;
  });
}

/**
 * Only a missing OBJECT: NoSuchKey from CopyObject, NotFound from HeadObject. Never the bare
 * status, because a missing BUCKET also answers 404 (NoSuchBucket), and a mistyped or renamed
 * bucket must be thrown, not reported as every image lost.
 */
function isMissing(error) {
  return ['NoSuchKey', 'NotFound'].includes(error && error.name);
}

/** CopySource is `bucket/key`, with the key URI-encoded one segment at a time. */
const copySource = (bucket, key) => `${bucket}/${String(key).split('/').map(encodeURIComponent).join('/')}`;

/** A key a restore may write: one set's folder, one file, no traversal. */
const isRestorableKey = (key) => /^sets\/[^/]+\/[^/]+$/.test(String(key || '')) && !String(key).includes('..');

async function copyMediaOut(s3, { mediaBucket, archiveBucket, snapshotId, rows }) {
  const keys = mediaKeysIn(rows);
  const skipped = keys.filter((key) => !isRestorableKey(key));
  // Each tier-site URL is copied from THIS tier's bucket under the key its path names. One on
  // another tier's site is tried here too: if this bucket has no such object it is reported
  // missing, and the row keeps its URL.
  const urlsByKey = new Map();
  for (const [url, key] of tierUrlsIn(rows)) {
    if (!urlsByKey.has(key)) urlsByKey.set(key, []);
    urlsByKey.get(key).push(url);
  }
  const restorable = [...new Set([...keys.filter((key) => isRestorableKey(key)), ...urlsByKey.keys()])].sort();
  const external = externalImagesIn(rows);
  if (restorable.length > 0 && (!mediaBucket || !archiveBucket)) {
    throw new Error('MEDIA_BUCKET or ARCHIVE_BUCKET is not set on this function, so the images this set uses '
      + 'cannot be backed up. This is a deployment fault (template-clean.yaml).');
  }
  const media = [];
  const missing = [];
  for (const key of restorable) {
    const archiveKey = `${MEDIA_PREFIX}${snapshotId}/${key}`;
    try {
      await s3.send(new CopyObjectCommand({
        Bucket: archiveBucket, Key: archiveKey, CopySource: copySource(mediaBucket, key), TaggingDirective: 'REPLACE',
      }));
      const urls = urlsByKey.get(key);
      media.push(urls ? { key, archiveKey, urls: urls.sort() } : { key, archiveKey });
    } catch (error) {
      if (!isMissing(error)) throw error;
      // A stored key is reported as the key; a URL as the URL, which is what the admin wrote.
      if (keys.includes(key)) missing.push(key);
      if (urlsByKey.has(key)) missing.push(...urlsByKey.get(key));
    }
  }
  return { media, missing, skipped, external };
}

async function copyMediaIn(s3, { mediaBucket, archiveBucket, media }) {
  const entries = Array.isArray(media) ? media : [];
  if (entries.length > 0 && (!mediaBucket || !archiveBucket)) {
    throw new Error('MEDIA_BUCKET or ARCHIVE_BUCKET is not set on this function, so the images in this backup '
      + 'cannot be restored. This is a deployment fault (template-clean.yaml).');
  }
  let copied = 0;
  let kept = 0;
  const missing = [];
  const skipped = [];
  for (const entry of entries) {
    const key = String((entry && entry.key) || '');
    const archiveKey = String((entry && entry.archiveKey) || '');
    if (!isRestorableKey(key) || !archiveKey.startsWith(MEDIA_PREFIX)) {
      skipped.push(key);
      continue;
    }
    let exists = true;
    try {
      await s3.send(new HeadObjectCommand({ Bucket: mediaBucket, Key: key }));
    } catch (error) {
      if (!isMissing(error)) throw error;
      exists = false;
    }
    if (exists) {
      kept += 1;
      continue;
    }
    try {
      await s3.send(new CopyObjectCommand({
        Bucket: mediaBucket, Key: key, CopySource: copySource(archiveBucket, archiveKey), TaggingDirective: 'REPLACE',
      }));
      copied += 1;
    } catch (error) {
      if (!isMissing(error)) throw error;
      missing.push(key);
    }
  }
  return { copied, kept, missing, skipped };
}

module.exports = {
  MEDIA_PREFIX, mediaKeysIn, copyMediaOut, copyMediaIn, isRestorableKey,
  tierMediaKey, tierUrlsIn, externalImagesIn, absoluteImagesIn, rewriteTierUrls,
};
