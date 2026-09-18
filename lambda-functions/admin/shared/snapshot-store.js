/**
 * THE SNAPSHOT A PERSON REVIEWS. The check uploads what it judged to
 * `moderation/<orgId>/<setId>/v<n>/<checkedAt>.json` (set-check-worker.js
 * `snapshotKeyFor`); approve publishes THAT object, byte for byte, and reject
 * deletes it (spec §3.3, D9). The bucket's lifecycle rule expires strays in
 * 30 days, so a delete here is a courtesy, not the guarantee.
 */
const { GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

const isMissing = (error) => {
  const name = error && (error.name || error.Code || error.code);
  return name === 'NoSuchKey' || name === 'NotFound' || (error && error.$metadata && error.$metadata.httpStatusCode === 404);
};

async function readSnapshot(s3, bucket, key) {
  if (!bucket || !key) return null;
  let res;
  try {
    res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
  if (!res || !res.Body) return null;
  const text = typeof res.Body.transformToString === 'function' ? await res.Body.transformToString() : String(res.Body);
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

async function deleteSnapshot(s3, bucket, key) {
  if (!bucket || !key) return false;
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  return true;
}

module.exports = { readSnapshot, deleteSnapshot };
