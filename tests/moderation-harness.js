// tests/moderation-harness.js
const assert = require('assert');
const H = require('./helpers/moderation-harness');
H.install();
const { PutCommand, UpdateCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
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
  await H.test('a query keyed by :setpk — ddb-delete.js collectPartitionKeys\' placeholder — is honoured too', async () => {
    H.reset();
    H.seedRow({ PK: 'ORG#o#SET#s#v1', SK: 'QUESTION#q001', x: 1 });
    H.seedRow({ PK: 'ORG#o#SET#s#v1', SK: 'QUESTION#q002', x: 2 });
    H.seedRow({ PK: 'OTHER', SK: 'a', x: 3 });
    const res = await db.send(new QueryCommand({
      TableName: 't', KeyConditionExpression: 'PK = :setpk', ExpressionAttributeValues: { ':setpk': 'ORG#o#SET#s#v1' },
    }));
    assert.deepStrictEqual(res.Items.map((i) => i.SK), ['QUESTION#q001', 'QUESTION#q002'], 'collectPartitionKeys would silently collect nothing under this harness');
  });
  await H.test('S3 put then get round-trips a string body', async () => {
    H.reset();
    const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
    const s3 = new S3Client({});
    await s3.send(new PutObjectCommand({ Bucket: 'b', Key: 'k', Body: '{"a":1}' }));
    const got = await s3.send(new GetObjectCommand({ Bucket: 'b', Key: 'k' }));
    assert.strictEqual(await got.Body.transformToString(), '{"a":1}');
  });
  await H.test('a conditional put on bare equality succeeds when the status matches and is refused when it does not', async () => {
    H.reset();
    await db.send(new PutCommand({ TableName: 't', Item: { PK: 'B', SK: 'REVIEW', status: 'flagged' } }));
    await db.send(new PutCommand({
      TableName: 't', Item: { PK: 'B', SK: 'REVIEW', status: 'appealed' },
      ConditionExpression: '#s = :from',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':from': 'flagged' },
    }));
    assert.strictEqual(H.state.ddb.get('B|REVIEW').status, 'appealed');
    let refused = null;
    try {
      await db.send(new PutCommand({
        TableName: 't', Item: { PK: 'B', SK: 'REVIEW', status: 'published' },
        ConditionExpression: '#s = :from',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':from': 'flagged' },
      }));
    } catch (e) { refused = e; }
    assert.ok(refused && refused.name === 'ConditionalCheckFailedException', 'the bare equality condition was not enforced');
    assert.strictEqual(H.state.ddb.get('B|REVIEW').status, 'appealed');
  });
  await H.test('a condition resolves a nested path (#s.publicSetId) through the item, both ways', async () => {
    H.reset();
    H.seedRow({ PK: 'C', SK: 'SET#x', share: { publicSetId: 'pub1' } });
    await db.send(new UpdateCommand({
      TableName: 't', Key: { PK: 'C', SK: 'SET#x' },
      UpdateExpression: 'SET touched = :yes',
      ExpressionAttributeNames: { '#s': 'share' },
      ExpressionAttributeValues: { ':yes': true, ':p': 'pub1' },
      ConditionExpression: 'attribute_exists(PK) AND #s.publicSetId = :p',
    }));
    assert.strictEqual(H.state.ddb.get('C|SET#x').touched, true, 'the matching nested condition was refused');
    let refused = null;
    try {
      await db.send(new UpdateCommand({
        TableName: 't', Key: { PK: 'C', SK: 'SET#x' },
        UpdateExpression: 'SET touched = :no',
        ExpressionAttributeNames: { '#s': 'share' },
        ExpressionAttributeValues: { ':no': false, ':p': 'somebody-else' },
        ConditionExpression: 'attribute_exists(PK) AND #s.publicSetId = :p',
      }));
    } catch (e) { refused = e; }
    assert.ok(refused && refused.name === 'ConditionalCheckFailedException', 'the mismatched nested condition was not refused');
    assert.strictEqual(H.state.ddb.get('C|SET#x').touched, true, 'the refused update must not have applied');
  });
  await H.test('attribute_exists/attribute_not_exists resolve a dotted path through the item, both ways', async () => {
    H.reset();
    H.seedRow({ PK: 'D', SK: 'SET#present', share: { publicSetId: 'pub1' } });
    H.seedRow({ PK: 'D', SK: 'SET#absent', share: {} });
    // attribute_exists(dotted): true when the leaf is present…
    await db.send(new UpdateCommand({
      TableName: 't', Key: { PK: 'D', SK: 'SET#present' },
      UpdateExpression: 'SET seen = :yes',
      ExpressionAttributeNames: { '#s': 'share' },
      ExpressionAttributeValues: { ':yes': true },
      ConditionExpression: 'attribute_exists(#s.publicSetId)',
    }));
    assert.strictEqual(H.state.ddb.get('D|SET#present').seen, true, 'attribute_exists(dotted) did not match a present nested field');
    // …false when the intermediate object exists but the leaf is missing.
    let existsRefused = null;
    try {
      await db.send(new UpdateCommand({
        TableName: 't', Key: { PK: 'D', SK: 'SET#absent' },
        UpdateExpression: 'SET seen = :yes',
        ExpressionAttributeNames: { '#s': 'share' },
        ExpressionAttributeValues: { ':yes': true },
        ConditionExpression: 'attribute_exists(#s.publicSetId)',
      }));
    } catch (e) { existsRefused = e; }
    assert.ok(existsRefused && existsRefused.name === 'ConditionalCheckFailedException', 'attribute_exists(dotted) did not refuse a missing nested field');
    // attribute_not_exists(dotted): true when the leaf is missing…
    await db.send(new UpdateCommand({
      TableName: 't', Key: { PK: 'D', SK: 'SET#absent' },
      UpdateExpression: 'SET seen = :yes',
      ExpressionAttributeNames: { '#s': 'share' },
      ExpressionAttributeValues: { ':yes': true },
      ConditionExpression: 'attribute_not_exists(#s.publicSetId)',
    }));
    assert.strictEqual(H.state.ddb.get('D|SET#absent').seen, true, 'attribute_not_exists(dotted) did not match a missing nested field');
    // …false when the leaf is present.
    let notExistsRefused = null;
    try {
      await db.send(new UpdateCommand({
        TableName: 't', Key: { PK: 'D', SK: 'SET#present' },
        UpdateExpression: 'SET seen2 = :yes',
        ExpressionAttributeNames: { '#s': 'share' },
        ExpressionAttributeValues: { ':yes': true },
        ConditionExpression: 'attribute_not_exists(#s.publicSetId)',
      }));
    } catch (e) { notExistsRefused = e; }
    assert.ok(notExistsRefused && notExistsRefused.name === 'ConditionalCheckFailedException', 'attribute_not_exists(dotted) did not refuse a present nested field');
  });
  H.summary();
})();
