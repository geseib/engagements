/**
 * A SHARED REPORT NEEDS TWO ITEMS: THE LINK AND THE PASSKEY.
 *
 * GET /games/{gameId}/report/download?key= is public so a report can go to
 * somebody with no account. Its key is `<title>-<date>-<gameId>.pdf.enc` — all
 * three known to everyone in the room — so the link alone was enough for any of
 * them to read the whole session. The owner, 2026-09-23: "a second item a
 * passkey that the host can give out so that if you are not logged in you
 * could share it with the passkey."
 *
 * save-report.js mints the passkey, returns it once, and stores only a salted
 * scrypt hash in the object's metadata; download-report.js requires it in the
 * X-Report-Passkey header and checks it before reading the body.
 *
 * rejects: a download with no passkey, a wrong one, another report's, or one
 * for a report saved before passkeys; a refusal that differs by cause; the
 * passkey stored anywhere in plaintext; an orgless PDF corrupted on the way
 * out; the header missing from CORS; the route acquiring an authorizer.
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
const doc = {
  send: async (cmd) => {
    const i = cmd.input;
    if (cmd.kind === 'get') return { Item: ddb.get(key(i.Key.PK, i.Key.SK)) };
    if (cmd.kind === 'put') { ddb.set(key(i.Item.PK, i.Item.SK), i.Item); return {}; }
    return { Items: [] };
  },
};
stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', { DynamoDBDocumentClient: { from: () => doc }, GetCommand, PutCommand, QueryCommand });

// The bucket, as S3 really answers: user metadata comes back lower-cased and
// without its x-amz-meta- prefix, and the body is a stream of BYTES.
const bucket = new Map();
let readBodies = 0;
class PutObjectCommand { constructor(input) { this.kind = 'put'; this.input = input; } }
class GetObjectCommand { constructor(input) { this.kind = 'get'; this.input = input; } }
stub('@aws-sdk/client-s3', {
  S3Client: class {
    async send(cmd) {
      if (cmd.kind === 'put') {
        bucket.set(cmd.input.Key, { body: Buffer.from(cmd.input.Body), meta: { ...(cmd.input.Metadata || {}) } });
        return {};
      }
      const obj = bucket.get(cmd.input.Key);
      if (!obj) { const e = new Error('NoSuchKey'); e.name = 'NoSuchKey'; throw e; }
      const meta = Object.fromEntries(Object.entries(obj.meta).map(([k, v]) => [k.toLowerCase(), v]));
      return {
        Metadata: meta,
        Body: {
          // Both, as the real SDK body has both: the old reader used the string
          // one, and a stub without it made the old code fail for the wrong reason.
          transformToByteArray: async () => { readBodies += 1; return new Uint8Array(obj.body); },
          transformToString: async () => { readBodies += 1; return obj.body.toString('utf8'); },
          destroy: () => {},
        },
      };
    }
  },
  PutObjectCommand, GetObjectCommand,
});
stub('@aws-sdk/s3-request-presigner', { getSignedUrl: async () => 'https://signed.example/x' });

const { makeKmsStub, installTestKeyLoader } = require('./helpers/tenant-crypto-stub');
stub('@aws-sdk/client-kms', makeKmsStub().exports);
installTestKeyLoader();

const save = require(path.join(REPO, 'lambda-functions/game/save-report.js')).handler;
const download = require(path.join(REPO, 'lambda-functions/game/download-report.js')).handler;
const passkeys = require(path.join(REPO, 'lambda-functions/game/report-passkey.js'));
const { routesFromTemplate, findRoute, assertScannerWorks } = require('./helpers/template-routes');

let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); pass += 1; console.log(`  PASS  ${label}`); }
  catch (e) { fail += 1; console.log(`  FAIL  ${label}\n        ${e.message}`); }
}

const HOST = { authorizer: { lambda: { userId: 'u-1', groups: 'hosts', orgId: 'org_acme', orgIds: 'org_acme' } } };
// Not UTF-8: "%PDF-" then the binary comment line every real PDF carries.
const PDF = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0xff, 0x00, 0x80]);
const saveAs = async (gameId, title = 'Q3 Offsite') => {
  const res = await save({
    pathParameters: { gameId },
    requestContext: HOST,
    body: JSON.stringify({ eventTitle: title, pdfBlob: PDF.toString('base64') }),
  });
  assert.strictEqual(res.statusCode, 200, res.body);
  return JSON.parse(res.body);
};
const fetchReport = (gameId, s3Key, passkey) => download({
  pathParameters: { gameId },
  queryStringParameters: { key: s3Key },
  headers: passkey === undefined ? {} : { 'x-report-passkey': passkey },
});

(async () => {
  const SESSION_TTL = Math.floor(Date.parse('2026-09-30T12:00:00.000Z') / 1000);
  ddb.set(key('GAME#1111', 'METADATA'), { PK: 'GAME#1111', SK: 'METADATA', orgId: 'org_acme', ttl: SESSION_TTL });
  ddb.set(key('GAME#3333', 'METADATA'), { PK: 'GAME#3333', SK: 'METADATA', orgId: 'org_acme' });
  ddb.set(key('GAME#2222', 'METADATA'), { PK: 'GAME#2222', SK: 'METADATA' });

  console.log('\n1. the passkey itself');
  await check('XXXXX-XXXXX from an alphabet with no I, L, O or U', () => {
    for (let i = 0; i < 200; i += 1) {
      assert.ok(/^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/.test(passkeys.generatePasskey()));
    }
  });
  await check('two saves never share one', () => {
    const seen = new Set(Array.from({ length: 500 }, () => passkeys.generatePasskey()));
    assert.strictEqual(seen.size, 500);
  });
  await check('typing is forgiving: case, spaces, dashes, and I/L/O read as 1/1/0', () => {
    assert.strictEqual(passkeys.normalizePasskey(' k7qm3-xpd9z '), 'K7QM3XPD9Z');
    // a b 1 l 0 - o i 2 c d  →  A B 1 1 0 0 1 2 C D
    assert.strictEqual(passkeys.normalizePasskey('ab1l0-oi2cd'), 'AB110012CD');
    assert.strictEqual(passkeys.normalizePasskey('K7QM3 XPD9'), '');   // nine characters
    assert.strictEqual(passkeys.normalizePasskey('K7QM3-XPD9U'), '');  // U is not in the alphabet
  });

  console.log('\n2. saving mints one and keeps only its hash');
  const org = await saveAs('1111');
  await check('the host gets the passkey, a relative link, and how long they work', () => {
    assert.ok(/^[0-9A-Z]{5}-[0-9A-Z]{5}$/.test(org.passkey), `passkey was ${org.passkey}`);
    assert.strictEqual(org.downloadUrl, `games/1111/report/download?key=${encodeURIComponent(org.fileName)}`);
    assert.strictEqual(org.downloadUrlIsRelative, true);
    assert.strictEqual(org.shareUntil, '2026-09-30T12:00:00.000Z');
  });
  await check('the object carries a salted hash, and the passkey appears nowhere in plaintext', () => {
    const { meta } = bucket.get(org.fileName);
    assert.ok(meta['passkey-salt'] && meta['passkey-hash'], 'no passkey hash on the object');
    const canonical = passkeys.normalizePasskey(org.passkey);
    const everywhere = JSON.stringify([meta, [...ddb.values()]]);
    assert.ok(!everywhere.includes(org.passkey) && !everywhere.includes(canonical), 'the passkey was stored');
  });

  console.log('\n3. the link alone opens nothing');
  readBodies = 0;
  const bare = await fetchReport('1111', org.fileName);
  await check('no passkey: 404', () => assert.strictEqual(bare.statusCode, 404));
  const wrong = await fetchReport('1111', org.fileName, 'ABCDE-FGHJK');
  await check('a wrong passkey: 404, word for word the same refusal', () => {
    assert.strictEqual(wrong.statusCode, 404);
    assert.deepStrictEqual(wrong, bare);
  });
  const other = await saveAs('3333');
  const crossed = await fetchReport('1111', org.fileName, other.passkey);
  await check("another report's passkey: 404", () => assert.strictEqual(crossed.statusCode, 404));
  await check('...and no refused request read the report body', () => assert.strictEqual(readBodies, 0));
  const missing = await fetchReport('1111', 'Nope-2026-09-23-1111.pdf.enc', org.passkey);
  await check('a key that does not exist: the same refusal', () => assert.deepStrictEqual(missing, bare));

  console.log('\n4. link and passkey together');
  const opened = await fetchReport('1111', org.fileName, org.passkey);
  await check('200, a PDF, byte for byte what was saved (decrypted from the envelope)', () => {
    assert.strictEqual(opened.statusCode, 200, opened.body);
    assert.strictEqual(opened.headers['Content-Type'], 'application/pdf');
    assert.strictEqual(opened.isBase64Encoded, true);
    assert.ok(Buffer.from(opened.body, 'base64').equals(PDF));
  });
  const typed = await fetchReport('1111', org.fileName, org.passkey.toLowerCase().replace('-', ' '));
  await check('typed in lower case with a space instead of the dash: still opens', () => assert.strictEqual(typed.statusCode, 200));
  const upper = await download({
    pathParameters: { gameId: '1111' }, queryStringParameters: { key: org.fileName }, headers: { 'X-Report-Passkey': org.passkey },
  });
  await check('the header is found whatever its case', () => assert.strictEqual(upper.statusCode, 200));

  console.log('\n5. orgless sessions share the same way, and their PDF survives');
  const orgless = await saveAs('2222');
  await check('an orgless save gets the same relative link and a passkey, not a presigned S3 URL', () => {
    assert.strictEqual(orgless.downloadUrl, `games/2222/report/download?key=${encodeURIComponent(orgless.fileName)}`);
    assert.ok(orgless.passkey);
  });
  const plain = await fetchReport('2222', orgless.fileName, orgless.passkey);
  await check('its PDF comes back byte for byte — binary, not decoded as UTF-8', () => {
    assert.strictEqual(plain.statusCode, 200, plain.body);
    assert.ok(Buffer.from(plain.body, 'base64').equals(PDF), 'the plain PDF was corrupted on the way out');
  });
  await check('...and still needs its passkey', async () => {
    assert.strictEqual((await fetchReport('2222', orgless.fileName)).statusCode, 404);
  });

  console.log('\n6. what the passkey does not rescue');
  bucket.set('Old-2026-08-01-1111.pdf.enc', { body: bucket.get(org.fileName).body, meta: { 'org-id': 'org_acme' } });
  const legacy = await fetchReport('1111', 'Old-2026-08-01-1111.pdf.enc', org.passkey);
  await check('a report saved before passkeys opens for nobody on the public route', () => assert.strictEqual(legacy.statusCode, 404));
  ddb.delete(key('GAME#1111', 'METADATA'));
  const gone = await fetchReport('1111', org.fileName, org.passkey);
  await check('once the session record has expired, the public link stops (the team has Reports)', () => assert.strictEqual(gone.statusCode, 404));

  console.log('\n7. the wiring');
  const template = fs.readFileSync(path.join(REPO, 'template-clean.yaml'), 'utf8');
  await check('CORS allows X-Report-Passkey, or the browser never sends it', () => {
    const m = /^\s*AllowHeaders:\s*\[([^\]]*)\]/m.exec(template);
    assert.ok(m, 'no AllowHeaders');
    assert.ok(m[1].toLowerCase().includes('"x-report-passkey"'), `AllowHeaders is ${m[1]}`);
  });
  const routes = routesFromTemplate();
  await check('the template scanner parses routes and sees Auth', () => assertScannerWorks(routes));
  await check('the download route stays public — a recipient has no account', () => {
    const hit = findRoute(routes, 'GET', '/games/{gameId}/report/download');
    assert.ok(hit, 'route missing');
    assert.strictEqual(hit.authorizer, null);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
