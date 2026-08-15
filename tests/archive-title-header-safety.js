/**
 * WHY FOUR TRIVIA PROMPTS 500ed AND FOUR CALL-AND-ANSWER PROMPTS DID NOT.
 *
 *   POST /admin/export-to-archive {"exportType":"prompts"}
 *     msue0xc4ybp0xuby0zq  ->  500 "Failed to upload archive item"   (trivia)
 *     msue0tacv9vj6fsv6rh  ->  200                                   (call-and-answer)
 *
 * Nothing to do with trivia. The four trivia prompts for the demo quiz sets are
 * named "Workie — <thing>" with U+2014 EM DASH; the four call-and-answer ones
 * are "Workie - <thing>" with an ASCII hyphen. (demo-sets/*.prompt.json, all
 * eight installed within six seconds of each other on 2026-08-15.)
 *
 * lambda-functions/archive/upload-archive.js copies the title into the S3
 * object's user metadata. S3 user metadata is transmitted as `x-amz-meta-*`
 * REQUEST HEADERS, and Node's http layer rejects any header value containing a
 * code point outside /[\t\x20-\x7e\x80-\xff]/ with
 *
 *     TypeError [ERR_INVALID_CHAR]: Invalid character in header content ["x-amz-meta-title"]
 *
 * thrown inside the SDK before anything reaches AWS. It landed in the handler's
 * catch, which answered a flat 500 naming no field, no character and no record.
 *
 * The obvious competing story — "the payload is too big" — is not merely wrong,
 * it is wrong backwards: the four that FAILED carry ~4.0-4.4 KB of prompt body,
 * the four that SUCCEEDED ~6.5-7.3 KB.
 *
 * These tests do not take my word for the header rule. Phase 1 drives a REAL
 * @aws-sdk/client-s3 PutObjectCommand at a local HTTP server and probes the
 * boundary character by character, so the oracle the later stubbed tests use is
 * itself verified against the shipped SDK rather than asserted from memory.
 */
const assert = require('assert');
const http = require('http');
const path = require('path');
const Module = require('module');
const { createRequire } = require('module');

const REPO = path.join(__dirname, '..');
const UPLOAD_ARCHIVE = path.join(REPO, 'lambda-functions', 'archive', 'upload-archive.js');
const EXPORT_TO_ARCHIVE = path.join(REPO, 'lambda-functions', 'admin', 'export-to-archive.js');

// The AWS SDK is installed under lambda-functions/, not at the repo root.
const lambdaRequire = createRequire(path.join(REPO, 'lambda-functions', 'package.json'));

/*
  CAPTURED HERE, DELIBERATELY, AND NOT INSIDE THE TEST THAT USES IT.

  Phase 2 installs a Module._load override, and that override runs at module
  EVALUATION time — long before the async IIFE at the bottom calls phase1().
  Resolving the SDK lazily inside withRealS3() therefore handed phase 1 the
  stub, so the test whose entire job is to check the stub's header rule against
  the real SDK was quietly checking the stub against itself. It passed, and it
  was worth nothing. Grab the real module before anything can intercept it.
*/
const REAL_AWS_S3 = lambdaRequire('@aws-sdk/client-s3');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ok - ${name}`); passed++; }
  catch (e) { console.log(`  FAIL - ${name}\n    ${e.message}`); failed++; }
}

/**
 * Node's own rule, from lib/_http_common.js checkInvalidHeaderChar. Phase 1
 * proves this regex matches what the shipped SDK + Node actually do; every
 * later assertion leans on that proof rather than on this line being right.
 */
const isNodeHeaderSafe = (v) => !/[^\t\x20-\x7e\x80-\xff]/.test(String(v));

/** Spin up a throwaway HTTP server and point a real S3Client at it. */
async function withRealS3(fn) {
  const { S3Client, PutObjectCommand } = REAL_AWS_S3;
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push(req.headers);
    res.writeHead(200); res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const client = new S3Client({
    region: 'us-east-1',
    endpoint: `http://127.0.0.1:${server.address().port}`,
    forcePathStyle: true,
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    maxAttempts: 1
  });
  const put = (metadata) => client.send(new PutObjectCommand({
    Bucket: 'bucket', Key: 'key', Body: 'content', ContentType: 'text/plain', Metadata: metadata
  }));
  try { return await fn({ put, seen }); }
  finally { server.close(); }
}

const EM_DASH_TITLE = 'Workie — Knowledge Organization: Make the Distinction Land (dev)';
const ASCII_TITLE = 'Workie - The Verdict Board (dev)';

// ---------------------------------------------------------------------------
// PHASE 1 — the real SDK, no stubs. Establishes the mechanism and the oracle.
// ---------------------------------------------------------------------------
const { toHeaderSafeMetadataValue } = require(UPLOAD_ARCHIVE);

async function phase1() {
  await test('the real SDK rejects exactly the code points isNodeHeaderSafe rejects', async () => {
    /*
      Rejects: this test file inventing a header rule that Node does not have.
      Everything below depends on isNodeHeaderSafe being the truth, so it is
      measured against the shipped @aws-sdk/client-s3 rather than assumed.
    */
    await withRealS3(async ({ put }) => {
      for (const cp of [0x20, 0x7e, 0x7f, 0xa0, 0xff, 0x100, 0x2014, 0x1f600]) {
        const value = `A${String.fromCodePoint(cp)}B`;
        let threw = false;
        try { await put({ title: value }); } catch (e) {
          threw = true;
          assert.strictEqual(e.code, 'ERR_INVALID_CHAR',
            `U+${cp.toString(16)} threw ${e.code || e.name}, expected ERR_INVALID_CHAR`);
        }
        assert.strictEqual(threw, !isNodeHeaderSafe(value),
          `U+${cp.toString(16)}: real SDK threw=${threw} but isNodeHeaderSafe says safe=${isNodeHeaderSafe(value)}`);
      }
    });
  });

  await test('CONTROL: the raw em-dash title really does break a real PutObject', async () => {
    /*
      Rejects: the whole diagnosis being fiction. If this ever stops throwing,
      the bug this file exists for is not what the file says it is.
    */
    await withRealS3(async ({ put }) => {
      await assert.rejects(
        () => put({ archiveId: 'x', title: EM_DASH_TITLE, uploadedAt: 'now' }),
        (e) => e.code === 'ERR_INVALID_CHAR',
        'a raw em-dash title must still be rejected by the real SDK'
      );
    });
  });

  await test('the encoded title is accepted by a real PutObject', async () => {
    // Rejects: an "encoder" that does not actually make the value sendable.
    await withRealS3(async ({ put, seen }) => {
      await put({
        archiveId: 'x',
        title: toHeaderSafeMetadataValue(EM_DASH_TITLE),
        uploadedAt: 'now'
      });
      assert.strictEqual(seen.length, 1, 'the request must have reached the server');
      assert(seen[0]['x-amz-meta-title'], 'the title header must be present');
    });
  });

  await test('an ASCII title is passed through byte-identical', async () => {
    // Rejects: encoding everything, which would turn every readable title in
    // the bucket into base64 for no reason.
    assert.strictEqual(toHeaderSafeMetadataValue(ASCII_TITLE), ASCII_TITLE);
  });

  await test('the encoded title is reversible — nothing is transliterated away', async () => {
    /*
      Rejects: "just strip the non-ASCII" and "replace — with -". Both would
      pass a header-safety check while silently rewriting what the user typed.
      RFC 2047 keeps the original recoverable.
    */
    const encoded = toHeaderSafeMetadataValue(EM_DASH_TITLE);
    const m = /^=\?UTF-8\?B\?(.*)\?=$/.exec(encoded);
    assert(m, `expected an RFC 2047 encoded-word, got ${JSON.stringify(encoded)}`);
    assert.strictEqual(Buffer.from(m[1], 'base64').toString('utf8'), EM_DASH_TITLE);
  });

  await test('a huge title is bounded, header-safe, and still decodes cleanly', async () => {
    /*
      Rejects: unbounded metadata. S3 caps ALL user metadata at 2 KB of keys
      plus values, and truncating base64 after encoding yields a value that
      cannot be decoded at all — so the source must be cut on a character
      boundary before encoding, never after.
    */
    /*
      The leading 'A' is load-bearing. My first version used '— '.repeat(5000)
      — 4 bytes per repeat — so the 512-byte cut fell exactly on a character
      boundary every time and the "no U+FFFD" assertion below could never fire.
      Mutation testing caught it: breaking the boundary repair in truncateUtf8
      left all 15 assertions green. One byte of offset before a run of 3-byte
      characters puts the cut inside a UTF-8 sequence, which is the case that
      actually needs guarding.
    */
    const huge = 'A' + '—'.repeat(5000);
    const encoded = toHeaderSafeMetadataValue(huge);
    assert(isNodeHeaderSafe(encoded), 'a bounded title must still be header-safe');
    assert(Buffer.byteLength(encoded, 'utf8') < 2048,
      `metadata value is ${Buffer.byteLength(encoded, 'utf8')} bytes, over S3's 2 KB budget`);
    const m = /^=\?UTF-8\?B\?(.*)\?=$/.exec(encoded);
    assert(m, 'still an encoded-word');
    const decoded = Buffer.from(m[1], 'base64').toString('utf8');
    assert(!decoded.includes('�'),
      'truncation must land on a character boundary, not mid UTF-8 sequence');
    assert(huge.startsWith(decoded), 'the decoded value must be a true prefix of the original');
  });
}

// ---------------------------------------------------------------------------
// PHASE 2 — stub the SDK and drive the real handlers.
// ---------------------------------------------------------------------------
const stubs = new Map();
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (stubs.has(request)) return stubs.get(request);
  return realLoad.call(this, request, parent, isMain);
};

class GetCommand { constructor(i) { this.input = i; } }
class PutCommand { constructor(i) { this.input = i; } }
class QueryCommand { constructor(i) { this.input = i; } }
class ScanCommand { constructor(i) { this.input = i; } }
class GetObjectCommand { constructor(i) { this.input = i; } }
class PutObjectCommand { constructor(i) { this.input = i; } }

const TABLE = 'test-table';
const store = new Map();
const k = (pk, sk) => `${pk}|${sk}`;

let dynamoPuts = [];
const db = {
  async send(cmd) {
    const name = cmd.constructor.name;
    if (name === 'GetCommand') return { Item: store.get(k(cmd.input.Key.PK, cmd.input.Key.SK)) };
    if (name === 'PutCommand') {
      dynamoPuts.push(cmd.input.Item);
      store.set(k(cmd.input.Item.PK, cmd.input.Item.SK), cmd.input.Item);
      return {};
    }
    if (name === 'QueryCommand') {
      const v = cmd.input.ExpressionAttributeValues || {};
      return { Items: [...store.values()].filter((i) => i.PK === v[':pk']
        && (v[':skPrefix'] === undefined || String(i.SK).startsWith(v[':skPrefix']))) };
    }
    throw new Error(`Unstubbed DynamoDB command: ${name}`);
  }
};

/**
 * An S3 stub that enforces the SAME header rule the real client enforces —
 * verified against the real SDK in phase 1. A stub that silently accepted an
 * em dash would make every assertion below vacuous.
 */
let s3Puts = [];
let s3Objects = new Map();  // key -> string body, or an Error to throw
const s3 = {
  async send(cmd) {
    const name = cmd.constructor.name;
    if (name === 'PutObjectCommand') {
      for (const [mk, mv] of Object.entries(cmd.input.Metadata || {})) {
        if (!isNodeHeaderSafe(mv)) {
          const err = new TypeError(`Invalid character in header content ["x-amz-meta-${mk}"]`);
          err.code = 'ERR_INVALID_CHAR';
          throw err;
        }
      }
      s3Puts.push(cmd.input);
      return {};
    }
    if (name === 'GetObjectCommand') {
      const found = s3Objects.get(cmd.input.Key);
      if (found === undefined) {
        const err = new Error(`The specified key does not exist.`);
        err.name = 'NoSuchKey';
        throw err;
      }
      if (found instanceof Error) throw found;
      return { Body: { transformToString: async () => found } };
    }
    throw new Error(`Unstubbed S3 command: ${name}`);
  }
};

stubs.set('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stubs.set('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => db },
  GetCommand, PutCommand, QueryCommand, ScanCommand
});
stubs.set('@aws-sdk/client-s3', { S3Client: class { send(c) { return s3.send(c); } }, GetObjectCommand, PutObjectCommand });
stubs.set('uuid', { v4: () => 'archive-uuid-1' });

process.env.TABLE_NAME = TABLE;
process.env.ARCHIVE_BUCKET_NAME = 'archive-bucket';
process.env.AI_PROMPTS_BUCKET = 'ai-prompts-bucket';
process.env.ARCHIVE_SERVICE_URL = 'https://archive.seibtribe.us';
process.env.STACK_NAME = 'engagedev';

// Re-load both handlers so they bind the stubs rather than the real clients.
delete require.cache[require.resolve(UPLOAD_ARCHIVE)];
const uploadArchive = require(UPLOAD_ARCHIVE);
const exportToArchive = require(EXPORT_TO_ARCHIVE);

function resetAll() {
  store.clear(); dynamoPuts = []; s3Puts = []; s3Objects = new Map();
}

async function phase2Upload() {
  await test('upload-archive sends header-safe metadata for an em-dash title, and keeps the real title', async () => {
    /*
      Rejects: the shipped bug. Before the fix this handler put `title` straight
      into Metadata and the S3 client threw ERR_INVALID_CHAR, producing the 500
      that started all this. The DynamoDB assertion is the other half: the fix
      must make the upload survive WITHOUT rewriting the title users see.
    */
    resetAll();
    const res = await uploadArchive.handler({
      body: JSON.stringify({ title: EM_DASH_TITLE, content: '{"a":1}', contentType: 'prompt' })
    });
    assert.strictEqual(res.statusCode, 200, `expected 200, got ${res.statusCode}: ${res.body}`);
    assert.strictEqual(s3Puts.length, 1, 'the content must have been written to S3');
    assert(isNodeHeaderSafe(s3Puts[0].Metadata.title),
      `metadata title is not header-safe: ${JSON.stringify(s3Puts[0].Metadata.title)}`);
    assert.strictEqual(dynamoPuts.length, 1);
    assert.strictEqual(dynamoPuts[0].Title, EM_DASH_TITLE,
      'the authoritative title must keep its em dash — encoding is for the header only');
  });

  await test('upload-archive still works for an ASCII title', async () => {
    // Rejects: a fix that breaks the case that was already working.
    resetAll();
    const res = await uploadArchive.handler({
      body: JSON.stringify({ title: ASCII_TITLE, content: 'x', contentType: 'prompt' })
    });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(s3Puts[0].Metadata.title, ASCII_TITLE);
  });

  await test('upload-archive 400 names WHICH field was empty', async () => {
    /*
      Rejects: "Title, content, and contentType are required" — the message that
      sent 338af103's investigation after three fields when only one (an empty
      CSV from a failed read) was actually wrong.
    */
    resetAll();
    const res = await uploadArchive.handler({
      body: JSON.stringify({ title: 'Set (dev)', content: '', contentType: 'questionset' })
    });
    assert.strictEqual(res.statusCode, 400);
    const body = JSON.parse(res.body);
    assert(/content/.test(body.error), `must name content: ${body.error}`);
    assert(!/^Title, content, and contentType are required$/.test(body.error),
      'must not be the old blanket message');
    assert(!/\btitle\b/i.test(body.error.split('.')[0]),
      `must not accuse title, which was present: ${body.error}`);
  });

  await test('upload-archive 500 names the step and the Node error code', async () => {
    /*
      Rejects: the flat {"error":"Failed to upload archive item"} that made the
      original 500 undiagnosable. Simulated by handing DynamoDB a failure, so
      the assertion is about the reporting, not about the em dash.
    */
    resetAll();
    const boom = new Error('table is on fire');
    boom.name = 'ProvisionedThroughputExceededException';
    const realSend = db.send;
    db.send = async (cmd) => {
      if (cmd.constructor.name === 'PutCommand') throw boom;
      return realSend.call(db, cmd);
    };
    try {
      const res = await uploadArchive.handler({
        body: JSON.stringify({ title: ASCII_TITLE, content: 'x', contentType: 'prompt' })
      });
      assert.strictEqual(res.statusCode, 500);
      const body = JSON.parse(res.body);
      assert.strictEqual(body.step, 'dynamodb-put-metadata', `step was ${body.step}`);
      assert.strictEqual(body.title, ASCII_TITLE, 'the failing record must be named');
      assert.strictEqual(body.exception, 'ProvisionedThroughputExceededException');
      assert(/table is on fire/.test(body.details), 'the underlying message must survive');
    } finally { db.send = realSend; }
  });
}

// ---------------------------------------------------------------------------
// PHASE 3 — export-to-archive.js: the half-record fault and legibility.
// ---------------------------------------------------------------------------
const realFetch = global.fetch;
function stubFetch(handler) { global.fetch = handler; }
function restoreFetch() { global.fetch = realFetch; }

function seedPrompt(id, overrides = {}) {
  const item = {
    PK: 'AIPROMPTS', SK: `AIPROMPT#${id}`, promptId: id,
    name: 'Workie - The Verdict Board', description: 'demo',
    gameType: 'call-and-answer', category: 'readiness-review', status: 'active',
    s3Key: `prompts/call-and-answer/${id}/v1.json`,
    ...overrides
  };
  store.set(k(item.PK, item.SK), item);
  return item;
}

const GOOD_BODY = JSON.stringify({ instructions: 'do the thing', outputFormat: 'a format' });

async function phase3Export() {
  await test('export: a prompt whose body cannot be read FAILS instead of archiving an empty shell', async () => {
    /*
      Rejects: `catch { promptContent = {} }`. That swallowed a failed S3 read
      and uploaded a prompt whose instructions, outputFormat, template and
      scenario were all '' — a 200 and a reported success for half a record.
      Same defect as the empty-CSV bug in 338af103, one record type over, and
      worse: it does not even fail, it fills the archive with hollow prompts
      that look like a backup.
    */
    resetAll();
    const p = seedPrompt('p-noBody');   // s3Objects left empty -> NoSuchKey
    let uploaded = 0;
    stubFetch(async () => { uploaded++; return { ok: true, status: 200, json: async () => ({ archiveId: 'a1' }) }; });
    try {
      const res = await exportToArchive.handler({ body: JSON.stringify({ selectedItems: [p.promptId], exportType: 'prompts' }) });
      const { results } = JSON.parse(res.body);
      assert.strictEqual(uploaded, 0, 'nothing may be uploaded when the body could not be read');
      assert.strictEqual(results.successful.length, 0, 'a half-record must not be reported as a success');
      assert.strictEqual(results.failed.length, 1);
      const err = results.failed[0].error;
      assert(/read/i.test(err), `the failure must say it is a read problem: ${err}`);
      assert(new RegExp(p.s3Key).test(err), `the failure must name the key it could not read: ${err}`);
    } finally { restoreFetch(); }
  });

  await test('export: a prompt with no s3Key FAILS instead of archiving an empty shell', async () => {
    // Rejects: the `if (prompt.s3Key)` guard falling through to `{}` — a
    // pointer with no body at all, archived as a valid empty prompt.
    resetAll();
    const p = seedPrompt('p-noKey', { s3Key: undefined });
    let uploaded = 0;
    stubFetch(async () => { uploaded++; return { ok: true, status: 200, json: async () => ({ archiveId: 'a1' }) }; });
    try {
      const res = await exportToArchive.handler({ body: JSON.stringify({ selectedItems: [p.promptId], exportType: 'prompts' }) });
      const { results } = JSON.parse(res.body);
      assert.strictEqual(uploaded, 0, 'nothing may be uploaded for a bodyless pointer');
      assert.strictEqual(results.failed.length, 1, 'a bodyless pointer must fail');
      assert(/s3Key/.test(results.failed[0].error), `must name the missing s3Key: ${results.failed[0].error}`);
    } finally { restoreFetch(); }
  });

  await test('export: a healthy prompt still exports (the guard has no false positives)', async () => {
    // Rejects: a guard so eager it blocks the working case — which would be a
    // worse outage than the bug.
    resetAll();
    const p = seedPrompt('p-good');
    s3Objects.set(p.s3Key, GOOD_BODY);
    let sent = null;
    stubFetch(async (url, opts) => { sent = JSON.parse(opts.body); return { ok: true, status: 200, json: async () => ({ archiveId: 'a1' }) }; });
    try {
      const res = await exportToArchive.handler({ body: JSON.stringify({ selectedItems: [p.promptId], exportType: 'prompts' }) });
      const { results } = JSON.parse(res.body);
      assert.strictEqual(results.failed.length, 0, `expected no failures, got ${JSON.stringify(results.failed)}`);
      assert.strictEqual(results.successful.length, 1);
      assert(/do the thing/.test(sent.content), 'the real body must reach the archive');
    } finally { restoreFetch(); }
  });

  await test('export: an upload failure names the prompt AND flags the em dash', async () => {
    /*
      Rejects: `Archive upload failed: 500 - {"error":"Failed to upload archive
      item"}` — the message the operator actually got, which named neither the
      record nor the cause. The exporter cannot fix the shared archive service,
      but it can stop the next person spending an afternoon on it.
    */
    resetAll();
    const p = seedPrompt('p-emdash', { name: 'Workie — Knowledge Organization' });
    s3Objects.set(p.s3Key, GOOD_BODY);
    stubFetch(async () => ({ ok: false, status: 500, text: async () => '{"error":"Failed to upload archive item"}' }));
    try {
      const res = await exportToArchive.handler({ body: JSON.stringify({ selectedItems: [p.promptId], exportType: 'prompts' }) });
      const { results } = JSON.parse(res.body);
      assert.strictEqual(results.failed.length, 1);
      const err = results.failed[0].error;
      assert(/Workie/.test(err) && /p-emdash/.test(err), `must name the record: ${err}`);
      assert(/U\+2014/.test(err), `must identify the offending code point: ${err}`);
      assert(/header/i.test(err), `must explain it is a header problem: ${err}`);
    } finally { restoreFetch(); }
  });

  await test('export: an upload failure with a clean title does NOT cry em dash', async () => {
    // Rejects: an annotation bolted onto every failure, which would be noise
    // and would mislead the next investigation just as badly.
    resetAll();
    const p = seedPrompt('p-clean');
    s3Objects.set(p.s3Key, GOOD_BODY);
    stubFetch(async () => ({ ok: false, status: 503, text: async () => 'service unavailable' }));
    try {
      const res = await exportToArchive.handler({ body: JSON.stringify({ selectedItems: [p.promptId], exportType: 'prompts' }) });
      const { results } = JSON.parse(res.body);
      assert.strictEqual(results.failed.length, 1);
      const err = results.failed[0].error;
      assert(!/U\+/.test(err), `no code point should be blamed for a plain 503: ${err}`);
      assert(/503/.test(err) && /p-clean/.test(err), `must still name status and record: ${err}`);
    } finally { restoreFetch(); }
  });
}

(async () => {
  await phase1();
  await phase2Upload();
  await phase3Export();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
