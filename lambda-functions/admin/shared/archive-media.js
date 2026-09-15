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
 * Telling "missing" from "forbidden" needs s3:ListBucket, because without it S3 answers 403
 * for an absent key. template-clean.yaml grants it to both archive functions. Anything that
 * is not a missing object is re-thrown: an AccessDenied here is a deployment fault, and
 * reporting it as a lost image would hide it.
 */
const { CopyObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const { isMediaKey } = require('./set-media');

const MEDIA_PREFIX = 'archive/media/';

function mediaKeysIn(rows) {
  const keys = new Set();
  for (const row of rows || []) {
    const image = String((row && row.Image) || '').trim();
    if (isMediaKey(image)) keys.add(image);
  }
  return [...keys].sort();
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
  if (keys.length > 0 && (!mediaBucket || !archiveBucket)) {
    throw new Error('MEDIA_BUCKET or ARCHIVE_BUCKET is not set on this function, so the images this set uses '
      + 'cannot be backed up. This is a deployment fault (template-clean.yaml).');
  }
  const media = [];
  const missing = [];
  for (const key of keys) {
    const archiveKey = `${MEDIA_PREFIX}${snapshotId}/${key}`;
    try {
      await s3.send(new CopyObjectCommand({
        Bucket: archiveBucket, Key: archiveKey, CopySource: copySource(mediaBucket, key), TaggingDirective: 'REPLACE',
      }));
      media.push({ key, archiveKey });
    } catch (error) {
      if (!isMissing(error)) throw error;
      missing.push(key);
    }
  }
  return { media, missing };
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

module.exports = { MEDIA_PREFIX, mediaKeysIn, copyMediaOut, copyMediaIn, isRestorableKey };
