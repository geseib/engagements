/**
 * A SAVED REPORT LEAVES A ROW THAT OUTLIVES ITS SESSION.
 *
 * The owner, 2026-09-21: "how does one find these reports, if the sessions are
 * cleared out." Until now a report was an S3 object whose key existed only in
 * one HTTP response; with session rows expiring (session-ttl.js) it was
 * unfindable. save-report.js now writes REPORT#<game>#<when> under the org's
 * REPORTS partition (platform's for an orgless session), Title encrypted the
 * way the session's is, with a ttl that matches the bucket rule for its prefix.
 *
 * rejects: no row; a plaintext Title under an org; a 1-year report expiring
 * at 90 days; a standard upload without the tag the bucket rule filters on.
 */
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const REPO = path.join(__dirname, '..');

const Module = require('module');
const stubs = new Map();
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (stubs.has(request)) return stubs.get(request);
  return realLoad.call(this, request, parent, isMain);
};
const stub = (name, exports) => stubs.set(name, exports);

process.env.TABLE_NAME = 'engage-test';
process.env.REPORTS_BUCKET_NAME = 'engage-test-reports';
process.env.TENANT_KMS_KEY_ID = 'alias/test-tenant-key';
process.env.ACCOUNT_ID = '000000000000';
process.env.AWS_REGION = 'us-east-1';

const ddb = new Map();
const key = (pk, sk) => `${pk}|${sk}`;
class GetCommand { constructor(input) { this.kind = 'get'; this.input = input; } }
class PutCommand { constructor(input) { this.kind = 'put'; this.input = input; } }
class QueryCommand { constructor(input) { this.kind = 'query'; this.input = input; } }
class UpdateCommand { constructor(input) { this.kind = 'update'; this.input = input; } }
const doc = {
  send: async (cmd) => {
    const i = cmd.input;
    if (cmd.kind === 'get') return { Item: ddb.get(key(i.Key.PK, i.Key.SK)) };
    if (cmd.kind === 'put') { ddb.set(key(i.Item.PK, i.Item.SK), i.Item); return {}; }
    if (cmd.kind === 'query') return { Items: [...ddb.values()].filter((r) => r.PK === i.ExpressionAttributeValues[':pk']) };
    return {};
  },
};
stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => doc }, GetCommand, PutCommand, QueryCommand, UpdateCommand,
});
const s3Puts = [];
class PutObjectCommand { constructor(input) { this.kind = 'put'; this.input = input; } }
class GetObjectCommand { constructor(input) { this.kind = 'get'; this.input = input; } }
stub('@aws-sdk/client-s3', {
  S3Client: class { async send(cmd) { if (cmd.kind === 'put') s3Puts.push(cmd.input); return {}; } },
  PutObjectCommand, GetObjectCommand,
});
stub('@aws-sdk/s3-request-presigner', { getSignedUrl: async () => 'https://signed.example/x' });

const { makeKmsStub, installTestKeyLoader, plainRowAuto } = require('./helpers/tenant-crypto-stub');
stub('@aws-sdk/client-kms', makeKmsStub().exports);

installTestKeyLoader();
const { handler } = require(path.join(REPO, 'lambda-functions/game/save-report.js'));
const { reportsIndexPk } = require(path.join(REPO, 'lambda-functions/game/tenant.js'));

let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); pass += 1; console.log(`  PASS  ${label}`); }
  catch (e) { fail += 1; console.log(`  FAIL  ${label}\n        ${e.message}`); }
}
const save = (gameId, body) => handler({
  pathParameters: { gameId },
  body: JSON.stringify({ eventTitle: 'Q3 Offsite', pdfBlob: 'JVBERi0=', ...body }),
});
const rowsIn = (pk) => [...ddb.values()].filter((r) => r.PK === pk);

(async () => {
  ddb.set(key('GAME#1111', 'METADATA'), { PK: 'GAME#1111', SK: 'METADATA', orgId: 'org_acme' });
  ddb.set(key('GAME#2222', 'METADATA'), { PK: 'GAME#2222', SK: 'METADATA' });

  await check('an org session\'s report is filed under the org, Title encrypted', async () => {
    const res = await save('1111', { permanent: false });
    assert.strictEqual(res.statusCode, 200, res.body);
    const rows = rowsIn(reportsIndexPk('org_acme'));
    assert.strictEqual(rows.length, 1, 'no report row');
    assert.notStrictEqual(rows[0].Title, 'Q3 Offsite', 'Title is plaintext under an org');
    assert.strictEqual(plainRowAuto(rows[0]).Title, 'Q3 Offsite');
    assert.strictEqual(rows[0].gameId, '1111');
    assert.ok(rows[0].s3Key.endsWith('.pdf.enc'));
    assert.ok(rows[0].SK.startsWith('REPORT#1111#'));
  });

  await check('a standard report expires with the bucket\'s 90 days, and is tagged for that rule', async () => {
    const row = rowsIn(reportsIndexPk('org_acme'))[0];
    assert.ok(Math.abs(row.ttl - (Date.now() / 1000 + 90 * 86400)) < 60, `ttl=${row.ttl}`);
    assert.strictEqual(s3Puts[s3Puts.length - 1].Tagging, 'retention=standard');
  });

  await check('a "permanent" report keeps its year — row and object agree', async () => {
    const res = await save('1111', { permanent: true });
    assert.strictEqual(res.statusCode, 200, res.body);
    const rows = rowsIn(reportsIndexPk('org_acme'));
    const row = rows.find((r) => r.permanent);
    assert.ok(row, 'no permanent row');
    assert.ok(Math.abs(row.ttl - (Date.now() / 1000 + 365 * 86400)) < 60, `ttl=${row.ttl}`);
    assert.ok(row.s3Key.startsWith('permanent/'));
    assert.strictEqual(s3Puts[s3Puts.length - 1].Tagging, undefined, 'permanent must not carry the 90-day tag');
  });

  await check('an orgless session files under the platform partition, plaintext', async () => {
    const res = await save('2222', { permanent: false });
    assert.strictEqual(res.statusCode, 200, res.body);
    const rows = rowsIn(reportsIndexPk(''));
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].Title, 'Q3 Offsite');
    assert.strictEqual(rows[0].encrypted, false);
  });

  await check('the bucket keeps permanent/ for a year and filters the 90-day rule off it', () => {
    const t = fs.readFileSync(path.join(REPO, 'template-clean.yaml'), 'utf8');
    const i = t.indexOf('Id: DeleteOldReports');
    const block = t.slice(i, t.indexOf('ExpirationInDays: 365', i) + 24);
    assert.ok(/Value: standard/.test(block), 'the 90-day rule is not filtered on the retention tag');
    assert.ok(/Prefix: permanent\/\s+ExpirationInDays: 365/.test(block), 'no 365-day rule on permanent/');
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
