// tests/snapshot-store.js
const path = require('path');
const assert = require('assert');
const H = require('./helpers/moderation-harness');
H.install();
const { S3Client } = require('@aws-sdk/client-s3');
const s3 = new S3Client({});
const { readSnapshot, deleteSnapshot } = require(path.join(H.REPO, 'lambda-functions/admin/shared/snapshot-store.js'));
const BUCKET = 'prompts-test';
(async () => {
  console.log('\nsnapshot-store\n');
  await H.test('a stored snapshot reads back as the object that was put', async () => {
    H.reset();
    H.state.s3.set(`${BUCKET}/moderation/org_acme/safety/v2/2026-09-17T10-00-00-000Z.json`, JSON.stringify({ version: 2, questions: [{ SK: 'QUESTION#c001#001', Title: 'Q1' }] }));
    const snap = await readSnapshot(s3, BUCKET, 'moderation/org_acme/safety/v2/2026-09-17T10-00-00-000Z.json');
    assert.strictEqual(snap.version, 2);
    assert.strictEqual(snap.questions[0].Title, 'Q1');
  });
  await H.test('a missing key reads as null, not an error', async () => {
    H.reset();
    assert.strictEqual(await readSnapshot(s3, BUCKET, 'moderation/nope.json'), null);
  });
  await H.test('a body that is not JSON reads as null', async () => {
    H.reset();
    H.state.s3.set(`${BUCKET}/moderation/bad.json`, 'not json');
    assert.strictEqual(await readSnapshot(s3, BUCKET, 'moderation/bad.json'), null);
  });
  await H.test('delete removes the key and tolerates a missing one', async () => {
    H.reset();
    H.state.s3.set(`${BUCKET}/moderation/x.json`, '{}');
    assert.strictEqual(await deleteSnapshot(s3, BUCKET, 'moderation/x.json'), true);
    assert.ok(!H.state.s3.has(`${BUCKET}/moderation/x.json`), 'the key is still there');
    assert.strictEqual(await deleteSnapshot(s3, BUCKET, 'moderation/x.json'), true);
  });
  H.summary();
})();
