// tests/moderation-harness.js
const path = require('path');
const assert = require('assert');
const H = require('./helpers/moderation-harness');
H.install();
const { PutCommand, UpdateCommand, QueryCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const db = DynamoDBDocumentClient.from({});

(async () => {
  console.log('\nmoderation harness\n');
  await H.test('a conditional put refuses when the condition is false', async () => {
    H.reset();
    await db.send(new PutCommand({ TableName: 't', Item: { PK: 'A', SK: 'REVIEW', status: 'checking', checkedAt: '2026-09-17T10:00:00.000Z' } }));
    let refused = null;
    try {
      await db.send(new PutCommand({
        TableName: 't', Item: { PK: 'A', SK: 'REVIEW', status: 'checking' },
        ConditionExpression: 'attribute_not_exists(#s) OR #s <> :checking OR checkedAt < :stale',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':checking': 'checking', ':stale': '2026-09-17T09:00:00.000Z' },
      }));
    } catch (e) { refused = e; }
    assert.ok(refused && refused.name === 'ConditionalCheckFailedException', 'the stale lock was not refused');
  });
  await H.test('the same put succeeds once the row is stale', async () => {
    H.reset();
    await db.send(new PutCommand({ TableName: 't', Item: { PK: 'A', SK: 'REVIEW', status: 'checking', checkedAt: '2026-09-17T08:00:00.000Z' } }));
    await db.send(new PutCommand({
      TableName: 't', Item: { PK: 'A', SK: 'REVIEW', status: 'checking', checkedAt: 'now' },
      ConditionExpression: 'attribute_not_exists(#s) OR #s <> :checking OR checkedAt < :stale',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':checking': 'checking', ':stale': '2026-09-17T09:00:00.000Z' },
    }));
    assert.strictEqual(H.state.ddb.get('A|REVIEW').checkedAt, 'now');
  });
  await H.test('SET and ADD update expressions apply, and a failed ADD condition throws', async () => {
    H.reset();
    await db.send(new UpdateCommand({
      TableName: 't', Key: { PK: 'ORG#o', SK: 'CHECKS#2026-09-17' },
      UpdateExpression: 'SET #share = :share ADD submits :one',
      ExpressionAttributeNames: { '#share': 'share' },
      ExpressionAttributeValues: { ':share': { status: 'checking' }, ':one': 1 },
    }));
    const row = H.state.ddb.get('ORG#o|CHECKS#2026-09-17');
    assert.deepStrictEqual(row.share, { status: 'checking' });
    assert.strictEqual(row.submits, 1);
    let refused = null;
    try {
      await db.send(new UpdateCommand({
        TableName: 't', Key: { PK: 'ORG#o', SK: 'CHECKS#2026-09-17' },
        UpdateExpression: 'ADD submits :one',
        ConditionExpression: 'attribute_not_exists(submits) OR submits < :cap',
        ExpressionAttributeValues: { ':one': 1, ':cap': 1 },
      }));
    } catch (e) { refused = e; }
    assert.ok(refused && refused.name === 'ConditionalCheckFailedException', 'the cap was not enforced');
  });
  await H.test('a query returns the partition, prefix-filtered, in SK order', async () => {
    H.reset();
    H.seedRow({ PK: 'MODERATION', SK: 'b', x: 1 });
    H.seedRow({ PK: 'MODERATION', SK: 'a', x: 2 });
    H.seedRow({ PK: 'OTHER', SK: 'a', x: 3 });
    const res = await db.send(new QueryCommand({
      TableName: 't', KeyConditionExpression: 'PK = :pk', ExpressionAttributeValues: { ':pk': 'MODERATION' },
    }));
    assert.deepStrictEqual(res.Items.map((i) => i.SK), ['a', 'b']);
  });
  await H.test('S3 put then get round-trips a string body', async () => {
    H.reset();
    const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
    const s3 = new S3Client({});
    await s3.send(new PutObjectCommand({ Bucket: 'b', Key: 'k', Body: '{"a":1}' }));
    const got = await s3.send(new GetObjectCommand({ Bucket: 'b', Key: 'k' }));
    assert.strictEqual(await got.Body.transformToString(), '{"a":1}');
  });
  H.summary();
})();
