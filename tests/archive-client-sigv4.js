/**
 * THE ARCHIVE CLIENT SIGNS WHAT IT SENDS — checked by computing the signature independently.
 *
 * Phase 2 of docs/superpowers/specs/2026-09-14-archive-full-fidelity-design.md puts AWS_IAM
 * on every archive route. From then on, a request whose signature does not match what API
 * Gateway recomputes from the request it RECEIVED is a 403, and every backup and restore on
 * that tier stops. The dangerous bug is not "no signature". It is signing one URL and
 * fetching another: a query string escaped two ways, or a Host header CloudFront rewrites.
 * So the oracle here is a from-the-spec SigV4 computation over the request exactly as fetch
 * was handed it, not the signer's own output.
 *
 * // rejects: an unsigned archive call; a signature over a different URL, query or body than
 * //          the one sent; signing for archive.seibtribe.us; a presigned download sent with
 * //          a second Authorization header.
 */
const assert = require('assert');
const crypto = require('crypto');
const path = require('path');

const REPO = path.join(__dirname, '..');

process.env.ARCHIVE_SERVICE_URL = 'https://abc123defg.execute-api.us-east-1.amazonaws.com';
process.env.AWS_REGION = 'us-east-1';
process.env.AWS_ACCESS_KEY_ID = 'AKIDEXAMPLE';
process.env.AWS_SECRET_ACCESS_KEY = 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY';
process.env.AWS_SESSION_TOKEN = 'session-token-example';

const client = require(path.join(REPO, 'lambda-functions/admin/shared/archive-client.js'));

let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok   - ${label}`); pass += 1; } catch (e) {
    console.log(`  FAIL - ${label}\n         ${e.message}`); fail += 1;
  }
}

// ---- an independent SigV4 verifier, written from the published algorithm ----
const sha256hex = (data) => crypto.createHash('sha256').update(data === undefined ? '' : data, 'utf8').digest('hex');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data, 'utf8').digest();
const rfc3986 = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

function recomputeSignature(sent, secret) {
  const url = new URL(sent.url);
  const lower = Object.fromEntries(Object.entries(sent.headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
  lower.host = url.host; // what the wire carries, whatever the caller passed
  const auth = lower.authorization || '';
  const signed = (/SignedHeaders=([^,]+)/.exec(auth) || [])[1];
  const scope = (/Credential=[^/]+\/([^,]+)/.exec(auth) || [])[1];
  assert.ok(signed && scope, `no parseable Authorization header: ${auth}`);
  const [date, region, service] = scope.split('/');
  const canonicalHeaders = signed.split(';')
    .map((h) => `${h}:${(lower[h] || '').trim().replace(/\s+/g, ' ')}\n`).join('');
  const canonicalQuery = [...url.searchParams.entries()]
    .map(([k, v]) => `${rfc3986(k)}=${rfc3986(v)}`).sort().join('&');
  // Every service but S3 encodes the path twice: what is on the wire, encoded once more.
  const canonicalPath = url.pathname.split('/').map(rfc3986).join('/');
  const canonicalRequest = [sent.method, canonicalPath, canonicalQuery, canonicalHeaders, signed, sha256hex(sent.body)].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', lower['x-amz-date'], scope, sha256hex(canonicalRequest)].join('\n');
  let key = hmac(`AWS4${secret}`, date);
  for (const part of [region, service, 'aws4_request']) key = hmac(key, part);
  return {
    signature: crypto.createHmac('sha256', key).update(stringToSign, 'utf8').digest('hex'),
    region, service, signed: signed.split(';'),
  };
}
const signatureIn = (headers) => (/Signature=([0-9a-f]{64})/.exec(headers.authorization || '') || [])[1];

// ---- a fetch that records exactly what it was handed ------------------------
const realFetch = global.fetch;
let calls = [];
function recordFetch(respond) {
  calls = [];
  global.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET', headers: { ...(init.headers || {}) }, body: init.body });
    return respond(String(url), init);
  };
}
const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
const SECRET = process.env.AWS_SECRET_ACCESS_KEY;

(async () => {
  console.log('1. what is sent is what is signed');

  await check('a GET with a query string verifies against an independent SigV4 computation', async () => {
    recordFetch(() => ok({ items: [], count: 0 }));
    await client.listItems({ type: 'questionset', search: "a b!'()*" });
    assert.strictEqual(calls.length, 1);
    const { signature, service, region } = recomputeSignature(calls[0], SECRET);
    assert.strictEqual(service, 'execute-api');
    assert.strictEqual(region, 'us-east-1');
    assert.strictEqual(signatureIn(calls[0].headers), signature, 'the signature does not match the request fetch was given');
  });

  await check('a POST whose body carries an em dash verifies too (the body hash is over UTF-8)', async () => {
    recordFetch(() => ok({ archiveId: 'a-1' }));
    await client.uploadItem({ title: 'Workie — The Verdict Board', content: '{"x":1}', contentType: 'prompt' });
    assert.strictEqual(calls[0].method, 'POST');
    assert.strictEqual(signatureIn(calls[0].headers), recomputeSignature(calls[0], SECRET).signature);
  });

  await check('CONTROL: a body changed after signing no longer verifies', async () => {
    // rejects: a verifier so loose it would pass anything, which would make both checks above worthless.
    recordFetch(() => ok({ archiveId: 'a-1' }));
    await client.uploadItem({ title: 'x', content: 'y', contentType: 'prompt' });
    const tampered = { ...calls[0], body: calls[0].body.replace('"y"', '"z"') };
    assert.notStrictEqual(signatureIn(tampered.headers), recomputeSignature(tampered, SECRET).signature);
  });

  await check('Host and the session token are signed, and the token is sent', async () => {
    recordFetch(() => ok({ items: [] }));
    await client.listItems({});
    const { signed } = recomputeSignature(calls[0], SECRET);
    assert.strictEqual(calls[0].headers['x-amz-security-token'], 'session-token-example');
    assert.ok(signed.includes('x-amz-security-token'), `signed headers: ${signed.join(';')}`);
    assert.ok(signed.includes('host'), 'Host must be signed');
  });

  await check('the request goes to the execute-api host and carries no Host header of its own', async () => {
    recordFetch(() => ok({ item: {} }));
    await client.getItem('3f1c9a2e-0000-4000-8000-000000000001');
    const url = new URL(calls[0].url);
    assert.strictEqual(url.host, 'abc123defg.execute-api.us-east-1.amazonaws.com');
    assert.strictEqual(url.pathname, '/archive/items/3f1c9a2e-0000-4000-8000-000000000001');
    assert.ok(!Object.keys(calls[0].headers).some((h) => h.toLowerCase() === 'host'),
      'fetch derives Host from the URL; passing one invites a mismatch');
  });

  console.log('\n2. refusing to sign the wrong thing');

  await check('archive.seibtribe.us is refused before any request is made', async () => {
    // rejects: signing for the CloudFront name, whose origin request carries a different Host.
    const saved = process.env.ARCHIVE_SERVICE_URL;
    process.env.ARCHIVE_SERVICE_URL = 'https://archive.seibtribe.us';
    recordFetch(() => ok({}));
    try {
      await assert.rejects(() => client.listItems({}), /execute-api/);
      assert.strictEqual(calls.length, 0);
    } finally { process.env.ARCHIVE_SERVICE_URL = saved; }
  });

  await check('missing credentials are a named error, not an unsigned request', async () => {
    const saved = process.env.AWS_SECRET_ACCESS_KEY;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    recordFetch(() => ok({}));
    try {
      await assert.rejects(() => client.listItems({}), /credentials/);
      assert.strictEqual(calls.length, 0);
    } finally { process.env.AWS_SECRET_ACCESS_KEY = saved; }
  });

  console.log('\n3. replies');

  await check('a non-2xx reply throws with the status and the archive\'s own words', async () => {
    recordFetch(() => ({ ok: false, status: 403, text: async () => '{"message":"Forbidden"}' }));
    await assert.rejects(() => client.getItem('x'), (e) => e.status === 403 && /Forbidden/.test(e.message));
  });

  await check('downloadItem fetches the presigned URL WITHOUT signing it', async () => {
    // rejects: a second Authorization header on a presigned S3 URL, which S3 refuses outright.
    recordFetch((url) => (url.includes('execute-api')
      ? ok({ item: { ArchiveId: 'a-1', ContentType: 'prompt' }, downloadUrl: 'https://engage2-archive-content.s3.amazonaws.com/archive/prompt/a-1.txt?X-Amz-Signature=abc' })
      : { ok: true, status: 200, text: async () => '{"schema":"engage.prompt/1"}' }));
    const { item, content } = await client.downloadItem('a-1');
    assert.strictEqual(item.ArchiveId, 'a-1');
    assert.strictEqual(content, '{"schema":"engage.prompt/1"}');
    assert.strictEqual(calls.length, 2);
    assert.deepStrictEqual(calls[1].headers, {}, `the presigned download carried headers: ${JSON.stringify(calls[1].headers)}`);
  });

  await check('an empty stored item is an error, not an empty restore', async () => {
    recordFetch((url) => (url.includes('execute-api')
      ? ok({ item: { ArchiveId: 'a-2' }, downloadUrl: 'https://s3.test.invalid/a-2' })
      : { ok: true, status: 200, text: async () => '   ' }));
    await assert.rejects(() => client.downloadItem('a-2'), /empty/);
  });

  global.fetch = realFetch;
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('harness error:', e); process.exit(2); });
