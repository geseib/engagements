# Archive Full-Fidelity Backup and Restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make archiving Engage (platform) and public question sets and prompts a real backup: every field, image and setting survives a restore on any tier. Lock the shared archive service behind AWS IAM so only the three tiers' own functions can use it, prove each tier still reaches it, and move the archive stack off Node 18.

**Architecture:** Export writes one wholesale JSON snapshot per item (`engage.set/1` / `engage.prompt/1`) and copies the images the rows point at into the archive bucket. Import restores snapshots into the platform library: a new version when the id exists, otherwise a recreation under the original id. Items written before this change still restore through the legacy path. Every archive call leaves the main app SigV4-signed from the tier's Lambda role, and the browser reaches the archive only through Cognito-guarded proxy routes on its own tier. Phase 1 ships the main app through the pipeline to every tier. Phase 2 hand-deploys the archive stack with `AWS_IAM`, `nodejs22.x` and retention, after a live pre-flight proves every tier can sign.

**Tech Stack:** Node.js 22 Lambda (AWS SDK v3, `@smithy/signature-v4`, `@aws-crypto/sha256-js`), DynamoDB single table, S3, API Gateway HTTP APIs, SAM/CloudFormation, React + Jest/RTL, bash + AWS CLI + jq.

**Spec:** `docs/superpowers/specs/2026-09-14-archive-full-fidelity-design.md` (approved 2026-09-15, amendments A1–A14 in §0). Read it before starting any task. This plan argues from it.

## Global Constraints

- **Runtime:** every Lambda in both templates is `nodejs22.x`. The archive stack moves off `nodejs18.x` in Task 14 (A1).
- **Scope:** organisation content is never exported or restored. Any value shaped like a `tenant-crypto.js` envelope (`isEnvelope`), anywhere in an item, refuses that item on export and on import (A7). Every restore lands in PLATFORM.
- **Who:** export, import and the archive proxy all require `tenant.canManageScope(event, tenant.PLATFORM)` in the handler. That means the `admins` group and no active organisation.
- **Keys:** no `'SETS'` / `'GAMES'` literal under `lambda-functions/` (`tests/no-global-partition-literals.js`), and no new `'AIPROMPTS'` literal either. Build every key with `shared/tenant.js`, `shared/set-version.js` or `shared/prompt-access.js`.
- **Signing:** archive calls go only to the execute-api host in `ARCHIVE_SERVICE_URL`, never `archive.seibtribe.us`. Credentials come from `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN`.
- **CORS:** any handler whose `Access-Control-Allow-Headers` names `Authorization` must also name `X-Engage-Org` (`tests/cors-allows-sent-headers.js`). Use exactly `'Content-Type, Authorization, X-Engage-Org'`.
- **KMS:** any function whose require graph reaches `shared/tenant-crypto.js` needs `kms:Decrypt` on `!GetAtt TenantKey.Arn` (`tests/kms-grants-match-code.js`).
- **Backend tests:** standalone `node tests/<file>.js`, judged by **exit code**. Write each new test first and watch it fail for the stated reason before implementing.
- **Full backend run** (clear stale build output first, or `cors-allows-sent-headers.js` fails on old copies):
  ```bash
  rm -rf .aws-sam lambda-functions/dist lambda-functions/admin/.aws-sam
  fails=0; for f in tests/*.js; do case "$f" in *.spec.js) continue;; esac; node "$f" >/dev/null 2>&1 || { echo "FAIL $f"; fails=$((fails+1)); }; done; echo "failed suites: $fails"
  ```
- **Frontend:** `cd src && npx jest <path>` for one suite. Before any push, `npm test`, `npm run lint` (0 errors, no more than 11 warnings) and `npm run build` must all pass.
- **Baselines before this work:** backend 113/113, frontend 197 suites / 4898 tests, lint 0 errors / 11 warnings. New suites raise the counts; no existing suite may go red at any commit.
- **Commits:** plain sentences, no conventional-commit prefix. The body says what and why, and the last line is `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. Never `git stash`. Commit only the files the task names.
- **Deploys:** a push to `dev`, `test` or `prod` deploys, as does a `<tier>-v*` tag. Push the branch OR the tag, never both. Nothing is pushed before Task 13. `scripts/deploy-archive.sh` is never run before Task 15's gate.
- **AWS:** use `AWS_PROFILE=adminaccess` (account 239601476690). If a command reports an expired SSO token, stop and ask the owner to run `aws sso login --profile adminaccess`. Never work around it.
- **Undeclared test packages:** if a suite dies with `MODULE_NOT_FOUND` for an AWS SDK client, `jsonwebtoken`, `jwk-to-pem` or `axios`, install them all in ONE command at the repo root: `npm install --no-save @aws-sdk/client-s3 @aws-sdk/client-cognito-identity-provider @aws-sdk/s3-request-presigner @aws-sdk/client-kms @aws-sdk/client-cloudwatch @aws-sdk/client-sesv2 @aws-sdk/client-sns @aws-sdk/client-ssm jsonwebtoken jwk-to-pem axios`.

## File Map

| File | Responsibility | Task |
|---|---|---|
| `lambda-functions/admin/shared/archive-client.js` (new) | SigV4-signed calls to the archive service | 1 |
| `lambda-functions/admin/package.json`, `package-lock.json` | declare the signer packages | 1 |
| `lambda-functions/admin/shared/archive-snapshot.js` (new) | envelope build/parse, refusal rules, platform stripping | 2 |
| `lambda-functions/admin/shared/archive-media.js` (new) | copy images out to / back from the archive bucket | 3 |
| `tests/helpers/archive-harness.js` (new) | in-memory DynamoDB, S3 and signed-only archive service | 4 |
| `lambda-functions/admin/shared/archive-restore.js` (new) | restore a set or prompt snapshot into platform | 4 |
| `lambda-functions/admin/upload-questions.js` | additive `startInactive` flag | 5 |
| `lambda-functions/admin/import-from-archive.js` (rewrite) | per-item restore: snapshot or legacy | 6 |
| `lambda-functions/admin/export-to-archive.js` (rewrite) | snapshot export with media, no main-table writes | 7 |
| `lambda-functions/admin/archive-items.js` (new) | Cognito-side relay for list/get/search/delete | 8 |
| `template-clean.yaml`, `docs/architecture/api.md` | mapping, grants, proxy routes, dead route removed | 9 |
| `lambda-functions/admin/list-local-archive.js` (delete) | dead route | 9 |
| `src/src/utils/archiveItems.js` (new), `src/src/utils/archiveFiltering.js` | tier, scope, grouping, request and report helpers | 10 |
| `src/src/components/ArchivePanel.jsx`, `src/src/AdminPage.jsx`, `src/src/config/consoleSections.js`, `src/src/styles.css` | admin screen | 11 |
| `scripts/archive-access-check.sh` (new), `scripts/archive-drill.sh` (new) | prove every tier reaches the archive; restore drill | 12 |
| `template-archive.yaml`, `scripts/deploy-archive.sh`, `lambda-functions/archive/package.json`, `tests/template-validates.js`, `docs/architecture/archive-service.md`, `DEPLOYMENT.md` | Phase 2 lock-down | 14 |
| Tests (new): `tests/archive-client-sigv4.js`, `tests/archive-snapshot-envelope.js`, `tests/archive-media-copy.js`, `tests/archive-restore.js`, `tests/upload-start-inactive.js`, `tests/archive-import-handler.js`, `tests/archive-set-snapshot-roundtrip.js`, `tests/archive-scope-boundary.js`, `tests/archive-proxy-routes.js`, `tests/archive-infrastructure.js`, `src/src/__tests__/archiveItems.test.js`, `src/src/__tests__/archivePanel.test.jsx`, `src/src/__tests__/archiveNoDirectCalls.test.js` | | 1–14 |
| Tests (migrated): `tests/prompt-archive-roundtrip.js`, `tests/archive-export-image-roundtrip.js`, `tests/export-to-archive-read.js`, `tests/archive-title-header-safety.js`, `src/src/__tests__/archiveFiltering.test.js` | | 6, 7, 10 |

---

## Part A — Phase 1: the main app (ships through the pipeline to every tier)

### Task 1: Signed archive client

**Files:**
- Create: `lambda-functions/admin/shared/archive-client.js`
- Modify: `lambda-functions/admin/package.json`, `lambda-functions/admin/package-lock.json` (via npm)
- Test: `tests/archive-client-sigv4.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces (all exported from `shared/archive-client.js`):
  - `archiveBaseUrl(): URL`. Throws when `ARCHIVE_SERVICE_URL` is unset or not an execute-api host.
  - `signedRequest(method: string, path: string, opts?: { query?: object, body?: any, signingDate?: Date }): Promise<{ url, method, headers, body }>`
  - `send(method, path, opts?): Promise<Response>`. Uses global `fetch`, looked up at call time.
  - `readJson(response, what: string): Promise<object>`. On a non-2xx reply it throws an `Error` whose `.status` is the HTTP status and whose message is `` `${what}: ${status} ${text}` ``.
  - `uploadItem(item)` → `{ archiveId, item }`; `listItems(query)` → `{ items, count }`; `searchItems(criteria)` → `{ items }`; `getItem(archiveId)` → `{ item, downloadUrl }`; `deleteItem(archiveId)`.
  - `downloadItem(archiveId): Promise<{ item, content: string }>`. Fetches the presigned URL unsigned, and throws on an empty body.

- [ ] **Step 1: Declare the signer packages**

Both packages are already in the admin bundle transitively. They are declared here so the build does not depend on a transitive copy.

```bash
npm --prefix lambda-functions/admin install --save @smithy/signature-v4@^5.6.12 @aws-crypto/sha256-js@^5.2.0
git diff --stat lambda-functions/admin/package.json lambda-functions/admin/package-lock.json
```

Expected: `package.json` gains exactly two dependencies, and the lock changes only in its root `packages[""].dependencies` and the two packages' own entries. If the lock diff rewrites unrelated packages, run `git checkout lambda-functions/admin/package.json lambda-functions/admin/package-lock.json`, then stop and report.

- [ ] **Step 2: Write the failing test**

Create `tests/archive-client-sigv4.js`:

```js
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
```

- [ ] **Step 3: Run it and watch it fail**

Run: `node tests/archive-client-sigv4.js; echo "exit $?"`
Expected: exit 1, with `Cannot find module '.../lambda-functions/admin/shared/archive-client.js'`.

- [ ] **Step 4: Implement the client**

Create `lambda-functions/admin/shared/archive-client.js`:

```js
/**
 * SIGNED CALLS TO THE SHARED ARCHIVE SERVICE — the only way the main app reaches it.
 *
 * The archive (template-archive.yaml, stack `engage2-archive-service`) is ONE service behind
 * dev, test and prod, and each tier has its own Cognito pool, so a Cognito authorizer there
 * would have no single pool to trust. It trusts the AWS account instead: every route requires
 * AWS_IAM, and a caller proves itself by signing with its Lambda role's credentials (SigV4,
 * service `execute-api`). WHO may act is decided before this module is reached, in the
 * handler, by canManageScope(event, PLATFORM).
 * See docs/superpowers/specs/2026-09-14-archive-full-fidelity-design.md §4.6.
 *
 * SIGNED FOR THE execute-api HOST, NEVER archive.seibtribe.us. SigV4 signs the Host header,
 * and CloudFront rewrites it on the way to the origin, so a request signed for the CloudFront
 * name arrives carrying a signature for a host it no longer names.
 *
 * CREDENTIALS COME FROM THE ENVIRONMENT, not the SDK's provider chain. Lambda always sets
 * AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_SESSION_TOKEN for the execution role.
 * Reading them directly cannot wander off to an SSO cache or the instance metadata endpoint,
 * which is how a test run or a laptop would hang instead of failing.
 */
const { SignatureV4 } = require('@smithy/signature-v4');
const { Sha256 } = require('@aws-crypto/sha256-js');

/** RFC 3986 escaping, which is SigV4's — encodeURIComponent leaves !'()* alone. */
const escapeUri = (value) => encodeURIComponent(value)
  .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

function archiveBaseUrl() {
  const raw = String(process.env.ARCHIVE_SERVICE_URL || '').trim();
  if (!raw) {
    throw new Error('ARCHIVE_SERVICE_URL is not set on this function, so the archive cannot be reached. '
      + 'This is a deployment fault (template-clean.yaml).');
  }
  const url = new URL(raw);
  if (!/\.execute-api\.[a-z0-9-]+\.amazonaws\.com$/.test(url.hostname)) {
    throw new Error(`ARCHIVE_SERVICE_URL must be the archive API's execute-api endpoint, not ${url.hostname}: `
      + 'a request signed through CloudFront arrives with a different Host and is refused.');
  }
  return url;
}

function environmentCredentials() {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error('No AWS credentials in the environment, so the archive request cannot be signed.');
  }
  return { accessKeyId, secretAccessKey, sessionToken: process.env.AWS_SESSION_TOKEN || undefined };
}

/**
 * Build and sign one request, returning exactly what will be sent. Host is signed but not
 * returned: fetch derives it from the URL, which is the value that was signed, and a second
 * copy only invites a mismatch.
 */
async function signedRequest(method, path, { query, body, signingDate } = {}) {
  const base = archiveBaseUrl();
  const credentials = environmentCredentials();
  const entries = Object.entries(query || {})
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => [key, String(value)]);
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const signer = new SignatureV4({
    credentials,
    region: process.env.AWS_REGION || 'us-east-1',
    service: 'execute-api',
    sha256: Sha256,
  });
  const signed = await signer.sign({
    method,
    protocol: 'https:',
    hostname: base.hostname,
    path,
    query: Object.fromEntries(entries),
    headers: {
      host: base.hostname,
      ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: payload,
  }, signingDate ? { signingDate } : undefined);
  const headers = { ...signed.headers };
  delete headers.host;
  const qs = entries.map(([key, value]) => `${escapeUri(key)}=${escapeUri(value)}`).join('&');
  return { url: `${base.origin}${path}${qs ? `?${qs}` : ''}`, method, headers, body: payload };
}

/** Sign and send. `fetch` is looked up at call time so a suite can replace it. */
async function send(method, path, options) {
  const request = await signedRequest(method, path, options);
  return fetch(request.url, { method: request.method, headers: request.headers, body: request.body });
}

/** The parsed reply, or an Error naming the call, the status and the archive's own words. */
async function readJson(response, what) {
  if (!response.ok) {
    const text = typeof response.text === 'function' ? await response.text() : '';
    const error = new Error(`${what}: ${response.status} ${text}`.trim());
    error.status = response.status;
    throw error;
  }
  return response.json();
}

const uploadItem = async (item) => readJson(await send('POST', '/archive/items', { body: item }), 'Archive upload');
const listItems = async (query) => readJson(await send('GET', '/archive/items', { query }), 'Archive list');
const searchItems = async (criteria) => readJson(await send('POST', '/archive/search', { body: criteria }), 'Archive search');
const getItem = async (archiveId) => readJson(
  await send('GET', `/archive/items/${escapeUri(archiveId)}`), `Archive read of ${archiveId}`,
);
const deleteItem = async (archiveId) => readJson(
  await send('DELETE', `/archive/items/${escapeUri(archiveId)}`), `Archive delete of ${archiveId}`,
);

/**
 * An item's row and its stored content. The content comes from the presigned S3 URL the
 * archive mints, fetched WITHOUT signing: S3 refuses a presigned request that also carries
 * an Authorization header.
 */
async function downloadItem(archiveId) {
  const data = await getItem(archiveId);
  const item = data.item || data;
  if (!data.downloadUrl) throw new Error(`Archive item ${archiveId} came back without a downloadUrl.`);
  const response = await fetch(data.downloadUrl);
  if (!response.ok) throw new Error(`Could not download archive item ${archiveId}: ${response.status}`);
  const content = await response.text();
  if (!content || !content.trim()) throw new Error(`Archive item ${archiveId} is empty.`);
  return { item, content };
}

module.exports = {
  archiveBaseUrl, signedRequest, send, readJson,
  uploadItem, listItems, searchItems, getItem, deleteItem, downloadItem,
};
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `node tests/archive-client-sigv4.js; echo "exit $?"`
Expected: `10 passed, 0 failed`, exit 0.

- [ ] **Step 6: Commit**

```bash
git add lambda-functions/admin/shared/archive-client.js lambda-functions/admin/package.json lambda-functions/admin/package-lock.json tests/archive-client-sigv4.js
git commit -m "Archive calls can be signed with the tier's own AWS credentials

The shared archive will require AWS_IAM on every route, so the main app needs a client that
signs for the archive's execute-api host rather than the CloudFront name, whose Host header
CloudFront rewrites. The test checks the signature with an independent SigV4 computation
over the exact request fetch receives, and refuses the CloudFront host and missing
credentials before anything is sent.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 2: The snapshot envelope

**Files:**
- Create: `lambda-functions/admin/shared/archive-snapshot.js`
- Test: `tests/archive-snapshot-envelope.js`

**Interfaces:**
- Consumes: `shared/tenant-crypto.js` `isEnvelope`, `shared/tenant.js` scope constants.
- Produces (all exported, all pure):
  - constants `SET_SCHEMA = 'engage.set/1'`, `PROMPT_SCHEMA = 'engage.prompt/1'`, `TIERS = ['dev','test','prod']`, `LIFECYCLE_SKS = ['REVIEW','PUBLISHED']`, `ORG_SHAPED = ['scope','orgId','sourceOrgId','publishedAt']`, `SET_SETTINGS` (the 12 attribute names below)
  - `currentTier(): 'dev'|'test'|'prod'|'unknown'`, read from `process.env.ENVIRONMENT`
  - `withoutKeys(row)` returns the row minus PK and SK; `snapshotRows(rows)` drops PK and the lifecycle rows
  - `findCiphertext(value): string[]` returns paths like `$.rows[1].Title`
  - `buildSetEnvelope({ tier, scope, setId, version, metadata, rows, media, snapshotId, exportedAt, promptName })`
  - `buildPromptEnvelope({ tier, scope, promptId, metadata, body, exportedAt })`
  - `envelopeTags(envelope, extra = []): string[]`
  - `parseArchiveContent(text)` returns `{ kind: 'set'|'prompt', envelope }`, `{ kind: 'legacy', doc? }` or `{ kind: 'unknown', schema }`
  - `refusalFor(envelope): string`, which is `''` when the envelope may be restored
  - `provenance(envelope, archiveId)` returns `{ archiveId, scope, setId?|promptId?, tier, exportedAt, sourceOrgId? }`
  - `platformMetadata(metadata, restoredFrom)`: org-shaped attributes and `ttl` dropped, `restoredFrom` added
  - `settingsFrom(metadata)`: the `SET_SETTINGS` entries that are not `undefined`/`null`/`''`
  - `rowCarriesPromptText(row): boolean`, true when `basePrompt`, `instructions` or `template` holds text

- [ ] **Step 1: Write the failing test**

Create `tests/archive-snapshot-envelope.js`:

```js
/**
 * WHAT A BACKUP IS, AND WHAT MAY NEVER BE RESTORED FROM ONE.
 *
 * shared/archive-snapshot.js is the one definition both sides of the archive share:
 * export-to-archive.js builds envelopes with it and shared/archive-restore.js reads them
 * back. Pure functions, so these are plain unit checks.
 *
 * // rejects: an allow-list creeping back into the envelope; PK travelling with a row; a
 * //          lifecycle row archived as content; an org, public-prompt or ciphertext backup
 * //          passing refusalFor; org-shaped attributes surviving onto a platform row.
 */
const assert = require('assert');
const path = require('path');

const REPO = path.join(__dirname, '..');
const snap = require(path.join(REPO, 'lambda-functions/admin/shared/archive-snapshot.js'));

let pass = 0; let fail = 0;
const check = (label, fn) => {
  try { fn(); console.log(`  ok   - ${label}`); pass += 1; } catch (e) {
    console.log(`  FAIL - ${label}\n         ${e.message}`); fail += 1;
  }
};

const CIPHERTEXT = { v: 1, iv: 'aXY=', tag: 'dGFn', ct: 'Y3Q=' }; // tenant-crypto's envelope shape
const META = {
  PK: 'SETS', SK: 'SET#pulse', name: 'Pulse', active: false, customInstruction: 'Be kind',
  roundKind: 'produce', Quickstart: true, isAIGenerated: false, futureField: { nested: [1, 2] },
};
const ROWS = [
  { PK: 'SET#pulse#v2', SK: 'CATEGORY#c001', Name: 'Zeta' },
  { PK: 'SET#pulse#v2', SK: 'QUESTION#c001#001', Title: 'Q', options: ['Yes', 'No'], allowMultiple: true },
  { PK: 'SET#pulse#v2', SK: 'REVIEW', status: 'approved' },
  { PK: 'SET#pulse#v2', SK: 'PUBLISHED', publicSetId: 'x' },
];
const envelope = () => snap.buildSetEnvelope({
  tier: 'prod', scope: 'platform', setId: 'pulse', version: 2, metadata: META, rows: ROWS,
  media: [{ key: 'sets/pulse/a.png', archiveKey: 'archive/media/snap-1/sets/pulse/a.png' }],
  snapshotId: 'snap-1', exportedAt: '2026-09-15T12:00:00.000Z', promptName: 'Workie - Pulse',
});

console.log('1. the envelope copies wholesale');
check('every metadata attribute travels, including one nobody has written a reader for', () => {
  assert.deepStrictEqual(envelope().metadata, {
    name: 'Pulse', active: false, customInstruction: 'Be kind', roundKind: 'produce',
    Quickstart: true, isAIGenerated: false, futureField: { nested: [1, 2] },
  });
});
check('rows keep SK and every attribute, and drop PK', () => {
  const env = envelope();
  assert.deepStrictEqual(env.rows[1], { SK: 'QUESTION#c001#001', Title: 'Q', options: ['Yes', 'No'], allowMultiple: true });
  assert.ok(env.rows.every((row) => !('PK' in row)));
});
check('REVIEW and PUBLISHED rows are not archived', () => {
  assert.deepStrictEqual(envelope().rows.map((row) => row.SK), ['CATEGORY#c001', 'QUESTION#c001#001']);
});
check('the envelope names its schema, where it came from, its snapshot id and its prompt link', () => {
  const env = envelope();
  assert.strictEqual(env.schema, 'engage.set/1');
  assert.deepStrictEqual(env.exportedFrom, { tier: 'prod', scope: 'platform', setId: 'pulse', version: 2 });
  assert.strictEqual(env.snapshotId, 'snap-1');
  assert.deepStrictEqual(env.links, { promptName: 'Workie - Pulse' });
});
check('building does not mutate the rows it was given', () => {
  envelope();
  assert.strictEqual(ROWS[0].PK, 'SET#pulse#v2');
});
check('a prompt envelope carries the row and body verbatim, or null for a row-only prompt', () => {
  const withBody = snap.buildPromptEnvelope({
    tier: 'dev', scope: 'platform', promptId: 'p1', exportedAt: 't',
    metadata: { PK: 'AIPROMPTS', SK: 'AIPROMPT#p1', name: 'P' }, body: { instructions: 'x' },
  });
  assert.strictEqual(withBody.schema, 'engage.prompt/1');
  assert.deepStrictEqual(withBody.metadata, { name: 'P' });
  assert.deepStrictEqual(withBody.body, { instructions: 'x' });
  const rowOnly = snap.buildPromptEnvelope({ tier: 'dev', scope: 'platform', promptId: 'g1', metadata: {}, body: null, exportedAt: 't' });
  assert.strictEqual(rowOnly.body, null);
});

console.log('\n2. tags say what and where');
check('tier, schema, scope, source and export time come first, then the extras', () => {
  assert.deepStrictEqual(snap.envelopeTags(envelope(), ['trivia']), [
    'prod', 'schema:engage.set/1', 'scope:platform', 'source:platform/pulse',
    'exportedAt:2026-09-15T12:00:00.000Z', 'trivia',
  ]);
});

console.log('\n3. reading stored content');
check('a set snapshot, a prompt snapshot, a legacy CSV, a legacy prompt, an unknown schema', () => {
  assert.strictEqual(snap.parseArchiveContent(JSON.stringify(envelope())).kind, 'set');
  assert.strictEqual(snap.parseArchiveContent(JSON.stringify({ schema: 'engage.prompt/1' })).kind, 'prompt');
  assert.strictEqual(snap.parseArchiveContent('"Category","Title"\n"A","B"').kind, 'legacy');
  const legacyPrompt = snap.parseArchiveContent(JSON.stringify({ metadata: { name: 'x' }, prompt: {} }));
  assert.strictEqual(legacyPrompt.kind, 'legacy');
  assert.deepStrictEqual(legacyPrompt.doc.metadata, { name: 'x' });
  // rejects: reading a FUTURE schema as legacy, which would hand a JSON envelope to the CSV importer.
  assert.deepStrictEqual(snap.parseArchiveContent(JSON.stringify({ schema: 'engage.set/2' })), { kind: 'unknown', schema: 'engage.set/2' });
});

console.log('\n4. what is never restored');
check('an org backup is refused by name', () => {
  const env = { ...envelope(), exportedFrom: { tier: 'dev', scope: 'org', setId: 'x' } };
  assert.strictEqual(snap.refusalFor(env), 'Organisation content is not archived: it is encrypted per organisation.');
});
check('a public prompt is refused; a public set is not', () => {
  assert.match(snap.refusalFor({ schema: 'engage.prompt/1', exportedFrom: { scope: 'public', promptId: 'p' }, metadata: {} }), /Public prompts/);
  assert.strictEqual(snap.refusalFor({ ...envelope(), exportedFrom: { tier: 'dev', scope: 'public', setId: 'acme-x' } }), '');
});
check('an unknown library is refused', () => {
  assert.match(snap.refusalFor({ ...envelope(), exportedFrom: { scope: 'galaxy', setId: 'x' } }), /library/);
});
check('an encrypted value ANYWHERE refuses the backup, and the reason says where', () => {
  const env = envelope();
  env.rows[1].Title = CIPHERTEXT;
  const reason = snap.refusalFor(env);
  assert.match(reason, /encrypted/);
  assert.ok(reason.includes('$.rows[1].Title'), reason);
});
check('findCiphertext finds nothing in plaintext and every nested envelope otherwise', () => {
  assert.deepStrictEqual(snap.findCiphertext({ a: [{ b: 'x' }], c: 1 }), []);
  assert.deepStrictEqual(snap.findCiphertext({ a: [{ b: CIPHERTEXT }], c: CIPHERTEXT }), ['$.a[0].b', '$.c']);
});
check('a clean platform backup is not refused', () => assert.strictEqual(snap.refusalFor(envelope()), ''));

console.log('\n5. a platform row after a restore');
check('org-shaped attributes and ttl are dropped, and provenance nests in restoredFrom', () => {
  const env = {
    ...envelope(),
    exportedFrom: { tier: 'prod', scope: 'public', setId: 'acme-retro' },
    metadata: { name: 'Retro', scope: 'public', orgId: '', sourceOrgId: 'acme', publishedAt: '2026-09-01', ttl: 1 },
  };
  const row = snap.platformMetadata(env.metadata, snap.provenance(env, 'arc-9'));
  assert.deepStrictEqual(row, {
    name: 'Retro',
    restoredFrom: { archiveId: 'arc-9', scope: 'public', setId: 'acme-retro', tier: 'prod', exportedAt: '2026-09-15T12:00:00.000Z', sourceOrgId: 'acme' },
  });
});
check('settingsFrom keeps set settings that hold a value, false included', () => {
  assert.deepStrictEqual(
    snap.settingsFrom({ name: 'N', personaId: '', Quickstart: false, isAIGenerated: false, roundKind: null, unrelated: 'x' }),
    { name: 'N', Quickstart: false, isAIGenerated: false },
  );
});
check('rowCarriesPromptText: a generation row yes, an empty pointer no', () => {
  assert.strictEqual(snap.rowCarriesPromptText({ basePrompt: 'Generate {count}' }), true);
  assert.strictEqual(snap.rowCarriesPromptText({ name: 'hollow' }), false);
});
check('currentTier reads ENVIRONMENT and never guesses', () => {
  const saved = process.env.ENVIRONMENT;
  process.env.ENVIRONMENT = 'prod';
  assert.strictEqual(snap.currentTier(), 'prod');
  process.env.ENVIRONMENT = 'production';
  assert.strictEqual(snap.currentTier(), 'unknown');
  if (saved === undefined) delete process.env.ENVIRONMENT; else process.env.ENVIRONMENT = saved;
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node tests/archive-snapshot-envelope.js; echo "exit $?"`
Expected: exit 1, with `Cannot find module '.../shared/archive-snapshot.js'`.

- [ ] **Step 3: Implement the module**

Create `lambda-functions/admin/shared/archive-snapshot.js`:

```js
/**
 * WHAT A BACKUP IS — the snapshot envelope, and the rules for reading one back.
 *
 * docs/superpowers/specs/2026-09-14-archive-full-fidelity-design.md §4.1. The archive used to
 * hold a CSV with a fixed column set, and every column it lacked was a silent loss: poll
 * options, trivia E and F, images, every set setting, the active flag. An envelope that
 * copies rows WHOLESALE cannot go stale that way. The next attribute anyone adds travels
 * without anyone remembering to add it here.
 *
 * Pure, no AWS calls. export-to-archive.js builds envelopes with it and archive-restore.js
 * reads them back, so the two sides agree by construction.
 */
const { isEnvelope } = require('./tenant-crypto');
const tenant = require('./tenant');

const SET_SCHEMA = 'engage.set/1';
const PROMPT_SCHEMA = 'engage.prompt/1';
const TIERS = ['dev', 'test', 'prod'];

/**
 * Publication-lifecycle rows that share a version's content partition (set-review.js:75-78).
 * A verdict about a version in another library is not content, and restoring one beside the
 * questions would describe a review that never happened here.
 */
const LIFECYCLE_SKS = ['REVIEW', 'PUBLISHED'];

/**
 * Attributes that say WHERE a row lives. A platform row carries none of them, and that absence
 * IS the platform marker (prompt-access.js promptOwnerStamp). So a restore into platform drops
 * them and keeps the provenance in `restoredFrom` instead.
 */
const ORG_SHAPED = ['scope', 'orgId', 'sourceOrgId', 'publishedAt'];

/** The set settings a restore makes the live row match: SET when present, REMOVE when not. */
const SET_SETTINGS = [
  'name', 'description', 'customInstruction', 'aiContextInstruction', 'personaId',
  'roundNoun', 'roundKind', 'roundKindBrief', 'engagementType', 'Quickstart',
  'isAIGenerated', 'promptId',
];

/** Where a prompt keeps its text when it has no S3 body (the gen-* rows). */
const ROW_TEXT_FIELDS = ['basePrompt', 'instructions', 'template'];

function currentTier() {
  const tier = String(process.env.ENVIRONMENT || '').trim().toLowerCase();
  return TIERS.includes(tier) ? tier : 'unknown';
}

function withoutKeys(row) {
  const { PK, SK, ...rest } = row || {};
  return rest;
}

/** Content rows as a snapshot stores them: PK dropped (it is rebuilt), SK kept (it IS the structure). */
function snapshotRows(rows) {
  return (rows || [])
    .filter((row) => !LIFECYCLE_SKS.includes(String(row && row.SK)))
    .map(({ PK, ...rest }) => rest);
}

/** The location of every tenant-crypto envelope inside a value. */
function findCiphertext(value, at = '$', found = []) {
  if (isEnvelope(value)) {
    found.push(at);
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => findCiphertext(item, `${at}[${index}]`, found));
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) findCiphertext(item, `${at}.${key}`, found);
  }
  return found;
}

function buildSetEnvelope({ tier, scope, setId, version, metadata, rows, media, snapshotId, exportedAt, promptName }) {
  return {
    schema: SET_SCHEMA,
    snapshotId,
    exportedFrom: { tier, scope, setId, version: version == null ? null : version },
    exportedAt,
    metadata: withoutKeys(metadata),
    rows: snapshotRows(rows),
    media: media || [],
    links: promptName ? { promptName } : {},
  };
}

function buildPromptEnvelope({ tier, scope, promptId, metadata, body, exportedAt }) {
  return {
    schema: PROMPT_SCHEMA,
    exportedFrom: { tier, scope, promptId },
    exportedAt,
    metadata: withoutKeys(metadata),
    body: body == null ? null : body,
  };
}

/** Tags the archive item carries, so the admin screen can say what an item is and where it came from. */
function envelopeTags(envelope, extra = []) {
  const from = envelope.exportedFrom || {};
  const id = from.setId || from.promptId;
  return [
    from.tier,
    `schema:${envelope.schema}`,
    `scope:${from.scope}`,
    `source:${from.scope}/${id}`,
    `exportedAt:${envelope.exportedAt}`,
    ...extra,
  ].filter(Boolean);
}

/**
 * Read stored content. A JSON document with a known `schema` is a snapshot. Anything without a
 * `schema` is an item written before snapshots existed (a CSV set, or a `{metadata, prompt}`
 * prompt). A schema this code does not know is `unknown`, never legacy: treating a newer
 * envelope as legacy would hand it to the CSV importer.
 */
function parseArchiveContent(text) {
  let doc;
  try { doc = JSON.parse(text); } catch { return { kind: 'legacy' }; }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc) || !Object.prototype.hasOwnProperty.call(doc, 'schema')) {
    return { kind: 'legacy', doc };
  }
  if (doc.schema === SET_SCHEMA) return { kind: 'set', envelope: doc };
  if (doc.schema === PROMPT_SCHEMA) return { kind: 'prompt', envelope: doc };
  return { kind: 'unknown', schema: doc.schema };
}

/** Why this envelope must not be restored, or '' when it may be. */
function refusalFor(envelope) {
  const from = (envelope && envelope.exportedFrom) || {};
  if (from.scope === tenant.ORG) {
    return 'Organisation content is not archived: it is encrypted per organisation.';
  }
  if (from.scope !== tenant.PLATFORM && from.scope !== tenant.PUBLIC) {
    return `This backup names a library this product does not have (${JSON.stringify(from.scope)}), so it is not restored.`;
  }
  if (envelope.schema === PROMPT_SCHEMA && from.scope === tenant.PUBLIC) {
    return 'Public prompts are not restored: nothing in this product writes public prompts.';
  }
  const ciphertext = findCiphertext(envelope);
  if (ciphertext.length > 0) {
    const shown = ciphertext.slice(0, 3).join(', ');
    return `This backup contains encrypted values (${shown}${ciphertext.length > 3 ? ', …' : ''}), `
      + 'which cannot be read outside their organisation, so it is not restored.';
  }
  return '';
}

function provenance(envelope, archiveId) {
  const from = envelope.exportedFrom || {};
  const metadata = envelope.metadata || {};
  return {
    archiveId,
    scope: from.scope,
    ...(from.setId ? { setId: from.setId } : {}),
    ...(from.promptId ? { promptId: from.promptId } : {}),
    tier: from.tier,
    exportedAt: envelope.exportedAt,
    ...(metadata.sourceOrgId ? { sourceOrgId: metadata.sourceOrgId } : {}),
  };
}

function platformMetadata(metadata, restoredFrom) {
  const row = withoutKeys(metadata);
  for (const key of ORG_SHAPED) delete row[key];
  delete row.ttl;
  return { ...row, restoredFrom };
}

function settingsFrom(metadata) {
  const settings = {};
  for (const attr of SET_SETTINGS) {
    const value = metadata && metadata[attr];
    if (value !== undefined && value !== null && value !== '') settings[attr] = value;
  }
  return settings;
}

function rowCarriesPromptText(row) {
  return ROW_TEXT_FIELDS.some((field) => typeof (row && row[field]) === 'string' && row[field].trim() !== '');
}

module.exports = {
  SET_SCHEMA, PROMPT_SCHEMA, TIERS, LIFECYCLE_SKS, ORG_SHAPED, SET_SETTINGS,
  currentTier, withoutKeys, snapshotRows, findCiphertext,
  buildSetEnvelope, buildPromptEnvelope, envelopeTags, parseArchiveContent,
  refusalFor, provenance, platformMetadata, settingsFrom, rowCarriesPromptText,
};
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `node tests/archive-snapshot-envelope.js; echo "exit $?"`
Expected: `18 passed, 0 failed`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add lambda-functions/admin/shared/archive-snapshot.js tests/archive-snapshot-envelope.js
git commit -m "A backup is now a wholesale snapshot envelope with explicit refusal rules

Rows and metadata are copied whole rather than through a column list, which is what lost
poll options, trivia E and F, images and every set setting. The same module decides what
may never be restored: organisation content, public prompts, unknown libraries, and
anything carrying an encrypted value, wherever it sits.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 3: Images travel with the backup

**Files:**
- Create: `lambda-functions/admin/shared/archive-media.js`
- Test: `tests/archive-media-copy.js`

**Interfaces:**
- Consumes: `shared/set-media.js` `isMediaKey`; `@aws-sdk/client-s3` `CopyObjectCommand`, `HeadObjectCommand`.
- Produces:
  - `MEDIA_PREFIX = 'archive/media/'`
  - `mediaKeysIn(rows): string[]`: the distinct uploaded-image keys, sorted
  - `copyMediaOut(s3, { mediaBucket, archiveBucket, snapshotId, rows })` → `Promise<{ media: {key, archiveKey}[], missing: string[] }>`
  - `copyMediaIn(s3, { mediaBucket, archiveBucket, media })` → `Promise<{ copied: number, kept: number, missing: string[], skipped: string[] }>`
  - `isRestorableKey(key): boolean`

- [ ] **Step 1: Write the failing test**

Create `tests/archive-media-copy.js`:

```js
/**
 * A BACKUP'S IMAGES GO OUT WITH IT AND COME BACK WITH IT — without clobbering a live one.
 *
 * spec §4.5 and amendment A11. A question row stores an image as a KEY into its tier's media
 * bucket, never as bytes, so a backup that copied only rows restored every image as a
 * broken link.
 *
 * // rejects: copying remote URLs or repo assets; failing a whole backup over one lost image;
 * //          hiding an AccessDenied as a "missing" image; overwriting an image that already
 * //          exists on the tier; writing anywhere but one set's folder.
 */
const assert = require('assert');
const path = require('path');
const Module = require('module');

const REPO = path.join(__dirname, '..');
const objects = new Map(); // "bucket/key" -> body
let denyNext = false;
const command = (name) => class { constructor(input) { this.input = input; this.name = name; } };
const failure = (name, status) => Object.assign(new Error(name), { name, $metadata: { httpStatusCode: status } });
const s3 = {
  async send(cmd) {
    const { Bucket, Key } = cmd.input;
    if (denyNext) { denyNext = false; throw failure('AccessDenied', 403); }
    if (cmd.name === 'HeadObject') {
      if (!objects.has(`${Bucket}/${Key}`)) throw failure('NotFound', 404);
      return {};
    }
    if (cmd.name === 'CopyObject') {
      const source = cmd.input.CopySource;
      const slash = source.indexOf('/');
      const from = `${source.slice(0, slash)}/${source.slice(slash + 1).split('/').map(decodeURIComponent).join('/')}`;
      if (!objects.has(from)) throw failure('NoSuchKey', 404);
      objects.set(`${Bucket}/${Key}`, objects.get(from));
      return {};
    }
    throw new Error(`unstubbed S3 command ${cmd.name}`);
  },
};
const realLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === '@aws-sdk/client-s3') {
    return { CopyObjectCommand: command('CopyObject'), HeadObjectCommand: command('HeadObject') };
  }
  return realLoad.call(this, request, parent, isMain);
};
const media = require(path.join(REPO, 'lambda-functions/admin/shared/archive-media.js'));

let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok   - ${label}`); pass += 1; } catch (e) {
    console.log(`  FAIL - ${label}\n         ${e.message}`); fail += 1;
  }
}

const MEDIA = 'engagedev-media';
const ARCHIVE = 'engage2-archive-content';
const ROWS = [
  { SK: 'QUESTION#c001#001', Image: 'sets/art/smile.jpg' },
  { SK: 'QUESTION#c001#002', Image: 'sets/art/smile.jpg' },
  { SK: 'QUESTION#c001#003', Image: 'https://upload.wikimedia.org/x.jpg' },
  { SK: 'QUESTION#c001#004', Image: '/assets/art/local.jpg' },
  { SK: 'QUESTION#c001#005', Image: 'sets/art/gone.png' },
  { SK: 'QUESTION#c001#006', Image: 'sets/art/with space.png' },
  { SK: 'CATEGORY#c001', Name: 'Art' },
];

(async () => {
  console.log('1. which images are ours to copy');
  await check('uploaded keys only, each once, sorted — remote URLs and repo assets are left alone', () => {
    assert.deepStrictEqual(media.mediaKeysIn(ROWS), ['sets/art/gone.png', 'sets/art/smile.jpg', 'sets/art/with space.png']);
  });

  console.log('\n2. out to the archive');
  await check('present images are copied under the snapshot id; a missing one is reported, not fatal', async () => {
    objects.clear();
    objects.set(`${MEDIA}/sets/art/smile.jpg`, 'SMILE');
    objects.set(`${MEDIA}/sets/art/with space.png`, 'SPACE');
    const out = await media.copyMediaOut(s3, { mediaBucket: MEDIA, archiveBucket: ARCHIVE, snapshotId: 'snap-1', rows: ROWS });
    assert.deepStrictEqual(out.missing, ['sets/art/gone.png']);
    assert.deepStrictEqual(out.media, [
      { key: 'sets/art/smile.jpg', archiveKey: 'archive/media/snap-1/sets/art/smile.jpg' },
      { key: 'sets/art/with space.png', archiveKey: 'archive/media/snap-1/sets/art/with space.png' },
    ]);
    assert.strictEqual(objects.get(`${ARCHIVE}/archive/media/snap-1/sets/art/with space.png`), 'SPACE');
  });
  await check('an AccessDenied is thrown, not reported as a missing image', async () => {
    objects.clear();
    denyNext = true;
    await assert.rejects(
      () => media.copyMediaOut(s3, { mediaBucket: MEDIA, archiveBucket: ARCHIVE, snapshotId: 's', rows: ROWS }),
      /AccessDenied/,
    );
  });
  await check('images with no bucket configured are a named deployment fault', async () => {
    await assert.rejects(
      () => media.copyMediaOut(s3, { mediaBucket: '', archiveBucket: ARCHIVE, snapshotId: 's', rows: ROWS }),
      /MEDIA_BUCKET/,
    );
  });
  await check('a set with no uploaded images needs no bucket at all', async () => {
    const out = await media.copyMediaOut(s3, {
      mediaBucket: '', archiveBucket: '', snapshotId: 's', rows: [{ SK: 'QUESTION#1', Image: '/assets/a.jpg' }],
    });
    assert.deepStrictEqual(out, { media: [], missing: [] });
  });

  console.log('\n3. back onto a tier');
  await check('an absent image is restored; an existing one is kept untouched; a lost one is reported', async () => {
    objects.clear();
    objects.set(`${ARCHIVE}/archive/media/snap-1/sets/art/smile.jpg`, 'SMILE-ARCHIVED');
    objects.set(`${ARCHIVE}/archive/media/snap-1/sets/art/kept.jpg`, 'KEPT-ARCHIVED');
    objects.set(`${MEDIA}/sets/art/kept.jpg`, 'KEPT-LIVE');
    const out = await media.copyMediaIn(s3, {
      mediaBucket: MEDIA,
      archiveBucket: ARCHIVE,
      media: [
        { key: 'sets/art/smile.jpg', archiveKey: 'archive/media/snap-1/sets/art/smile.jpg' },
        { key: 'sets/art/kept.jpg', archiveKey: 'archive/media/snap-1/sets/art/kept.jpg' },
        { key: 'sets/art/lost.jpg', archiveKey: 'archive/media/snap-1/sets/art/lost.jpg' },
      ],
    });
    assert.deepStrictEqual(out, { copied: 1, kept: 1, missing: ['sets/art/lost.jpg'], skipped: [] });
    assert.strictEqual(objects.get(`${MEDIA}/sets/art/smile.jpg`), 'SMILE-ARCHIVED');
    // rejects: overwriting the live image that every other version of the set shows.
    assert.strictEqual(objects.get(`${MEDIA}/sets/art/kept.jpg`), 'KEPT-LIVE');
  });
  await check('a key outside one set folder, or an archive key outside the media prefix, is skipped', async () => {
    objects.clear();
    const out = await media.copyMediaIn(s3, {
      mediaBucket: MEDIA,
      archiveBucket: ARCHIVE,
      media: [
        { key: 'index.html', archiveKey: 'archive/media/s/index.html' },
        { key: 'sets/../config.js', archiveKey: 'archive/media/s/x' },
        { key: 'sets/a/b.png', archiveKey: 'archive/questionset/abc.csv' },
      ],
    });
    assert.deepStrictEqual(out, { copied: 0, kept: 0, missing: [], skipped: ['index.html', 'sets/../config.js', 'sets/a/b.png'] });
    assert.strictEqual(objects.size, 0);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('harness error:', e); process.exit(2); });
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node tests/archive-media-copy.js; echo "exit $?"`
Expected: exit 1, with `Cannot find module '.../shared/archive-media.js'`.

- [ ] **Step 3: Implement the module**

Create `lambda-functions/admin/shared/archive-media.js`:

```js
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

function isMissing(error) {
  const status = error && error.$metadata && error.$metadata.httpStatusCode;
  return ['NoSuchKey', 'NotFound'].includes(error && error.name) || status === 404;
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
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `node tests/archive-media-copy.js; echo "exit $?"`
Expected: `7 passed, 0 failed`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add lambda-functions/admin/shared/archive-media.js tests/archive-media-copy.js
git commit -m "A backup's uploaded images are copied out with it and back on restore

Rows only ever held a key into the tier's media bucket, so a restored set showed broken
images. Uploaded images are copied server-side under the snapshot id and copied back to the
key the row names. A missing image is reported rather than failing the item, an access
fault is still thrown, and an image that already exists on the tier is never overwritten.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 4: The test harness, and restoring a snapshot

**Files:**
- Create: `tests/helpers/archive-harness.js` (test infrastructure; not a suite, and `tests/*.js` does not glob into `helpers/`)
- Create: `lambda-functions/admin/shared/archive-restore.js`
- Test: `tests/archive-restore.js`

**Interfaces:**
- Consumes: Task 2 `archive-snapshot.js` (`LIFECYCLE_SKS`, `SET_SETTINGS`, `provenance`, `platformMetadata`, `settingsFrom`, `rowCarriesPromptText`, `buildSetEnvelope`, `buildPromptEnvelope`). Task 3 `archive-media.js` `copyMediaIn`. Existing `set-version.js` (`setRef`, `setPartition`, `setMetadataKey`, `queryPartition`, `batchPutItems`, `copyPartition`, `knownVersions`, `nextVersion`, `toVersion`, `resolveSetPartition`), `ddb-delete.js` `batchDeleteKeys`, `prompt-access.js` (`promptKey`, `promptBodyKey`), `archive-prompt-link.js` `resolveLocalPromptId`, `game-types.js` (`normalizeGameType`, `DEFAULT_GAME_TYPE`), `tenant.js` (`PLATFORM`, `promptsMetadataPk`).
- Produces:
  - `tests/helpers/archive-harness.js`. Require it FIRST in any suite that uses it. Exports `TABLE`, `DOWNLOAD`, the maps `table` / `objects` (`"bucket/key" -> { Body, ContentType }`) / `archive` (`archiveId -> { item, content }`), the logs `writes` (`{op, PK, SK}`) / `reads` (`{op, PK}`) / `fetchLog` (`{url, method, headers, body}`), `options` (`{ queryPageSize, throwAfterNextBatchWrite }`), plus `reset()`, `put(item)`, `get(pk, sk)`, `rows(pk)`, `seedSet({ scope, orgId, setId, version, meta, rows })`, `seedPrompt({ promptId, row, body })`, `seedArchiveItem({ contentType, title, description, tags, content })` → archiveId, `adminEvent(body, extra)`, `orgAdminEvent(orgId, body, extra)`, `hostEvent(body, extra)` and `checker()` → `{ check(label, fn), finish() }`. `extra` may carry `routeKey`, `pathParameters`, `queryStringParameters`.
  - `shared/archive-restore.js`:
    - `restoreSetSnapshot(deps, envelope, ctx)` → `{ kind: 'set', id, name, mode: 'created'|'new-version', version, active, wasActive, media: { copied, kept, missing, skipped } }`
    - `restorePromptSnapshot(deps, envelope, ctx)` → `{ kind: 'prompt', id, name, mode, version, status, isDefault }`
    - `resolvePromptLink(deps, envelope): Promise<string>`
    - `deps` is `{ db, s3, tableName, promptsBucket, mediaBucket, archiveBucket, now?: () => isoString }`; `ctx` is `{ archiveId, restoredBy }`.

- [ ] **Step 1: Create the harness**

Create `tests/helpers/archive-harness.js`:

```js
/**
 * AN IN-MEMORY AWS FOR THE ARCHIVE SUITES — DynamoDB, S3 and the archive service itself.
 *
 * Require it FIRST, before any handler. It installs Module._load stubs for the three AWS SDK
 * packages the archive code imports, replaces global fetch, and sets the environment the
 * handlers read when they load.
 *
 * THE FAKE ARCHIVE REFUSES UNSIGNED REQUESTS, as the locked one does in Phase 2. A suite that
 * passes here signed every archive call it made. tests/archive-client-sigv4.js is where the
 * signature itself is checked against an independent computation.
 *
 * Only what the archive code issues is implemented. Anything else throws by name, because a
 * stub that quietly accepts a command it does not understand hides the bug under test. Scan
 * throws on purpose: the archive code reads partitions by Query, and a Scan is the bug that
 * once exported nothing (tests/export-to-archive-read.js).
 */
const path = require('path');
const Module = require('module');

const TABLE = 'engage-archive-suite';
Object.assign(process.env, {
  TABLE_NAME: TABLE,
  ENVIRONMENT: 'dev',
  ARCHIVE_SERVICE_URL: 'https://archtest01.execute-api.us-east-1.amazonaws.com',
  ARCHIVE_BUCKET: 'engage2-archive-content',
  MEDIA_BUCKET: 'engagedev-media',
  AI_PROMPTS_BUCKET: 'engagedev-ai-prompts',
  AWS_REGION: 'us-east-1',
  AWS_ACCESS_KEY_ID: 'AKIDARCHIVESUITE',
  AWS_SECRET_ACCESS_KEY: 'archive-suite-secret',
  AWS_SESSION_TOKEN: 'archive-suite-token',
  BATCH_RETRY_BASE_MS: '1',
  DELETE_RETRY_BASE_MS: '1',
});

const table = new Map();
const objects = new Map();
const archive = new Map();
const writes = [];
const reads = [];
const fetchLog = [];
const options = { queryPageSize: 1000, throwAfterNextBatchWrite: false };
let nextArchive = 1;

const key = (pk, sk) => `${pk}|${sk}`;
const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
const bySK = (a, b) => (a.SK < b.SK ? -1 : a.SK > b.SK ? 1 : 0);

// ---- DynamoDB ---------------------------------------------------------------
function conditionFails(existing, expression) {
  if (!expression) return false;
  if (/^attribute_not_exists\((PK|SK)\)$/.test(expression)) return existing !== undefined;
  if (/^attribute_exists\((PK|SK)\)$/.test(expression)) return existing === undefined;
  throw new Error(`archive-harness: unsupported ConditionExpression ${expression}`);
}
const conditionalFailure = () => Object.assign(new Error('The conditional request failed'), { name: 'ConditionalCheckFailedException' });

/** Split on commas that are not inside parentheses. */
function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const ch of text) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) { parts.push(current.trim()); current = ''; } else { current += ch; }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/** `SET a = :a, b = list_append(if_not_exists(b, :seed), :entry) REMOVE c, d` — what the archive code writes. */
function applyUpdate(item, input) {
  const names = input.ExpressionAttributeNames || {};
  const values = input.ExpressionAttributeValues || {};
  const attr = (token) => names[token.trim()] || token.trim();
  const operand = (token) => {
    const t = token.trim();
    if (t.startsWith(':')) {
      if (!(t in values)) throw new Error(`archive-harness: ${t} is used but not defined`);
      return clone(values[t]);
    }
    const listAppend = /^list_append\(([\s\S]*)\)$/.exec(t);
    if (listAppend) {
      const [a, b] = splitTopLevel(listAppend[1]);
      return [...operand(a), ...operand(b)];
    }
    const ifNotExists = /^if_not_exists\(([\s\S]*)\)$/.exec(t);
    if (ifNotExists) {
      const [name, fallback] = splitTopLevel(ifNotExists[1]);
      return item[attr(name)] === undefined ? operand(fallback) : clone(item[attr(name)]);
    }
    throw new Error(`archive-harness: unsupported update operand ${t}`);
  };
  const match = /^\s*SET\s+([\s\S]*?)(?:\s+REMOVE\s+([\s\S]*))?\s*$/.exec(input.UpdateExpression);
  if (!match) throw new Error(`archive-harness: unsupported UpdateExpression ${input.UpdateExpression}`);
  const next = { ...item };
  for (const assignment of splitTopLevel(match[1])) {
    const eq = assignment.indexOf('=');
    next[attr(assignment.slice(0, eq))] = operand(assignment.slice(eq + 1));
  }
  for (const removed of match[2] ? splitTopLevel(match[2]) : []) delete next[attr(removed)];
  return next;
}

function query(input) {
  const values = input.ExpressionAttributeValues || {};
  const pkToken = (/=\s*(:\w+)/.exec(input.KeyConditionExpression) || [])[1];
  const skToken = (/begins_with\(\s*\S+\s*,\s*(:\w+)\s*\)/.exec(input.KeyConditionExpression) || [])[1];
  if (!pkToken) throw new Error(`archive-harness: unsupported KeyConditionExpression ${input.KeyConditionExpression}`);
  const pk = values[pkToken];
  const prefix = skToken ? values[skToken] : '';
  reads.push({ op: 'Query', PK: pk });
  const all = [...table.values()].filter((row) => row.PK === pk && String(row.SK).startsWith(prefix)).sort(bySK);
  const start = input.ExclusiveStartKey ? all.findIndex((row) => row.SK === input.ExclusiveStartKey.SK) + 1 : 0;
  const page = all.slice(start, start + options.queryPageSize);
  const more = start + page.length < all.length;
  return { Items: clone(page), ...(more ? { LastEvaluatedKey: { PK: pk, SK: page[page.length - 1].SK } } : {}) };
}

const dynamoCommand = (name) => class { constructor(input) { this.input = input; this.name = name; } };
const lib = {
  GetCommand: dynamoCommand('Get'),
  PutCommand: dynamoCommand('Put'),
  UpdateCommand: dynamoCommand('Update'),
  QueryCommand: dynamoCommand('Query'),
  BatchWriteCommand: dynamoCommand('BatchWrite'),
  DeleteCommand: dynamoCommand('Delete'),
  ScanCommand: dynamoCommand('Scan'),
};
const db = {
  async send(cmd) {
    const { input } = cmd;
    switch (cmd.name) {
      case 'Get':
        reads.push({ op: 'Get', PK: input.Key.PK });
        return { Item: clone(table.get(key(input.Key.PK, input.Key.SK))) };
      case 'Put': {
        const k = key(input.Item.PK, input.Item.SK);
        if (conditionFails(table.get(k), input.ConditionExpression)) throw conditionalFailure();
        table.set(k, clone(input.Item));
        writes.push({ op: 'Put', PK: input.Item.PK, SK: input.Item.SK });
        return {};
      }
      case 'Update': {
        const k = key(input.Key.PK, input.Key.SK);
        const existing = table.get(k);
        if (conditionFails(existing, input.ConditionExpression)) throw conditionalFailure();
        table.set(k, applyUpdate(existing || { ...input.Key }, input));
        writes.push({ op: 'Update', PK: input.Key.PK, SK: input.Key.SK });
        return {};
      }
      case 'Delete':
        table.delete(key(input.Key.PK, input.Key.SK));
        writes.push({ op: 'Delete', PK: input.Key.PK, SK: input.Key.SK });
        return {};
      case 'Query':
        return query(input);
      case 'BatchWrite': {
        for (const requests of Object.values(input.RequestItems)) {
          for (const request of requests) {
            if (request.PutRequest) {
              const row = request.PutRequest.Item;
              table.set(key(row.PK, row.SK), clone(row));
              writes.push({ op: 'Put', PK: row.PK, SK: row.SK });
            }
            if (request.DeleteRequest) {
              const k = request.DeleteRequest.Key;
              table.delete(key(k.PK, k.SK));
              writes.push({ op: 'Delete', PK: k.PK, SK: k.SK });
            }
          }
        }
        if (options.throwAfterNextBatchWrite) {
          options.throwAfterNextBatchWrite = false;
          throw Object.assign(new Error('Throughput exceeds the current capacity'), { name: 'ProvisionedThroughputExceededException' });
        }
        return { UnprocessedItems: {} };
      }
      case 'Scan':
        throw new Error('archive-harness: a Scan was issued — the archive code must read partitions by Query');
      default:
        throw new Error(`archive-harness: unstubbed DynamoDB command ${cmd.name}`);
    }
  },
};

// ---- S3 ---------------------------------------------------------------------
const s3Command = (name) => class { constructor(input) { this.input = input; this.name = name; } };
const missingObject = (name, what) => Object.assign(new Error(`${name}: ${what}`), { name, $metadata: { httpStatusCode: 404 } });
const s3 = {
  async send(cmd) {
    const { Bucket, Key } = cmd.input;
    if (!Bucket) throw Object.assign(new Error('Bucket name is required'), { name: 'InvalidBucketName' });
    const at = `${Bucket}/${Key}`;
    switch (cmd.name) {
      case 'PutObject':
        objects.set(at, { Body: String(cmd.input.Body), ContentType: cmd.input.ContentType });
        return {};
      case 'GetObject': {
        const found = objects.get(at);
        if (!found) throw missingObject('NoSuchKey', at);
        return { Body: { transformToString: async () => found.Body } };
      }
      case 'HeadObject':
        if (!objects.has(at)) throw missingObject('NotFound', at);
        return {};
      case 'CopyObject': {
        const source = String(cmd.input.CopySource);
        const slash = source.indexOf('/');
        const from = `${source.slice(0, slash)}/${source.slice(slash + 1).split('/').map(decodeURIComponent).join('/')}`;
        if (!objects.has(from)) throw missingObject('NoSuchKey', from);
        objects.set(at, { ...objects.get(from) });
        return {};
      }
      case 'DeleteObject':
        objects.delete(at);
        return {};
      default:
        throw new Error(`archive-harness: unstubbed S3 command ${cmd.name}`);
    }
  },
};

const stubs = new Map([
  ['@aws-sdk/client-dynamodb', { DynamoDBClient: class {} }],
  ['@aws-sdk/lib-dynamodb', { DynamoDBDocumentClient: { from: () => db }, ...lib }],
  ['@aws-sdk/client-s3', {
    S3Client: class { send(cmd) { return s3.send(cmd); } },
    GetObjectCommand: s3Command('GetObject'),
    PutObjectCommand: s3Command('PutObject'),
    CopyObjectCommand: s3Command('CopyObject'),
    HeadObjectCommand: s3Command('HeadObject'),
    DeleteObjectCommand: s3Command('DeleteObject'),
  }],
]);
const realLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (stubs.has(request)) return stubs.get(request);
  return realLoad.call(this, request, parent, isMain);
};

// ---- the archive service, signed requests only ------------------------------
const DOWNLOAD = 'https://archive-download.test.invalid/';
function respond(status, body) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, text: async () => text, json: async () => JSON.parse(text), headers: { get: () => 'application/json' } };
}
function isSigned(headers) {
  const auth = String(headers.authorization || headers.Authorization || '');
  return auth.startsWith('AWS4-HMAC-SHA256 Credential=') && auth.includes('/execute-api/aws4_request') && Boolean(headers['x-amz-date']);
}
function storedItem(data, archiveId) {
  return {
    PK: 'ARCHIVE', SK: `ITEM#${archiveId}`, ArchiveId: archiveId, Title: data.title, Description: data.description || '',
    ContentType: data.contentType, Category: data.category || 'general', Tags: data.tags || [],
    FileName: data.fileName || data.title, FileSize: Buffer.byteLength(String(data.content), 'utf8'),
    CreatedAt: new Date(Date.UTC(2026, 8, 15, 12, 0, nextArchive)).toISOString(),
  };
}
global.fetch = async (rawUrl, init = {}) => {
  const url = new URL(String(rawUrl));
  const method = String(init.method || 'GET').toUpperCase();
  const headers = { ...(init.headers || {}) };
  fetchLog.push({ url: url.href, method, headers, body: init.body });
  if (url.href.startsWith(DOWNLOAD)) {
    if (headers.authorization || headers.Authorization) return respond(400, 'Only one auth mechanism allowed');
    const record = archive.get(url.pathname.slice(1));
    return record ? respond(200, record.content) : respond(404, 'NoSuchKey');
  }
  if (url.origin !== new URL(process.env.ARCHIVE_SERVICE_URL).origin) return respond(599, `archive-harness: unexpected fetch to ${url.href}`);
  if (!isSigned(headers)) return respond(403, { message: 'Forbidden' });
  const itemId = (/^\/archive\/items\/([^/]+)$/.exec(url.pathname) || [])[1];
  if (method === 'POST' && url.pathname === '/archive/items') {
    const data = JSON.parse(init.body);
    const archiveId = `arc-${nextArchive}`;
    const item = storedItem(data, archiveId);
    nextArchive += 1;
    archive.set(archiveId, { item, content: data.content });
    return respond(200, { success: true, archiveId, item });
  }
  if (method === 'GET' && url.pathname === '/archive/items') {
    const type = url.searchParams.get('type');
    const items = [...archive.values()].map((r) => r.item).filter((i) => !type || i.ContentType === type)
      .sort((a, b) => (a.CreatedAt < b.CreatedAt ? 1 : -1));
    return respond(200, { success: true, items, count: items.length });
  }
  if (method === 'POST' && url.pathname === '/archive/search') {
    const { query: text = '' } = JSON.parse(init.body || '{}');
    const items = [...archive.values()].map((r) => r.item).filter((i) => i.Title.toLowerCase().includes(String(text).toLowerCase()));
    return respond(200, { success: true, items, count: items.length });
  }
  if (itemId && method === 'GET') {
    const record = archive.get(decodeURIComponent(itemId));
    return record
      ? respond(200, { success: true, item: record.item, downloadUrl: `${DOWNLOAD}${record.item.ArchiveId}` })
      : respond(404, { error: 'Archive item not found' });
  }
  if (itemId && method === 'DELETE') {
    const id = decodeURIComponent(itemId);
    if (!archive.has(id)) return respond(404, { error: 'Archive item not found' });
    archive.delete(id);
    return respond(200, { success: true, archiveId: id });
  }
  return respond(404, { error: `archive-harness: no route ${method} ${url.pathname}` });
};

// ---- seeding and events -----------------------------------------------------
const ADMIN = path.join(__dirname, '..', '..', 'lambda-functions', 'admin', 'shared');
const { setMetadataKey, setPartition } = require(path.join(ADMIN, 'set-version.js'));
const { promptKey, promptBodyKey } = require(path.join(ADMIN, 'prompt-access.js'));

function put(item) { table.set(key(item.PK, item.SK), clone(item)); return item; }
function get(pk, sk) { return clone(table.get(key(pk, sk))); }
function rows(pk) { return [...table.values()].filter((row) => row.PK === pk).sort(bySK).map(clone); }

function seedSet({ scope = 'platform', orgId = '', setId, version = null, meta = {}, rows: content = [] }) {
  const ref = { scope, orgId, setId };
  put({
    ...(version ? { activeVersion: version, versions: [{ version, createdAt: '2026-09-01T00:00:00.000Z' }] } : {}),
    ...meta,
    ...setMetadataKey(ref),
  });
  const pk = setPartition(ref, version);
  for (const row of content) put({ ...row, PK: pk });
  return { ref, pk };
}

function seedPrompt({ promptId, row = {}, body }) {
  const ref = { scope: 'platform', promptId };
  const base = { gameType: 'call-and-answer', status: 'active', isDefault: false, version: 1, ...row };
  const s3Key = body ? promptBodyKey(ref, base.gameType, base.version) : undefined;
  put({ promptId, ...base, ...promptKey(ref), ...(s3Key ? { s3Key } : {}) });
  if (body) objects.set(`${process.env.AI_PROMPTS_BUCKET}/${s3Key}`, { Body: JSON.stringify(body), ContentType: 'application/json' });
  return { ref, s3Key };
}

function seedArchiveItem({ contentType = 'questionset', title = 'Seeded', description = '', tags = [], content }) {
  const archiveId = `arc-${nextArchive}`;
  const item = storedItem({ title, description, contentType, tags, content }, archiveId);
  nextArchive += 1;
  archive.set(archiveId, { item, content });
  return archiveId;
}

function event(context, body, extra = {}) {
  return {
    requestContext: { authorizer: { lambda: context }, ...(extra.routeKey ? { routeKey: extra.routeKey } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    ...(extra.pathParameters ? { pathParameters: extra.pathParameters } : {}),
    ...(extra.queryStringParameters ? { queryStringParameters: extra.queryStringParameters } : {}),
  };
}
const adminEvent = (body, extra) => event({ groups: 'admins', userId: 'staff-1', username: 'staff@engage.test' }, body, extra);
const orgAdminEvent = (orgId, body, extra) => event({ groups: 'admins', userId: 'staff-1', orgId, orgRole: 'owner' }, body, extra);
const hostEvent = (body, extra) => event({ groups: 'hosts', userId: 'host-1' }, body, extra);

function reset() {
  table.clear(); objects.clear(); archive.clear();
  writes.length = 0; reads.length = 0; fetchLog.length = 0;
  nextArchive = 1;
  options.queryPageSize = 1000;
  options.throwAfterNextBatchWrite = false;
}

function checker() {
  let pass = 0;
  let fail = 0;
  return {
    async check(label, fn) {
      try { await fn(); console.log(`  ok   - ${label}`); pass += 1; } catch (e) {
        console.log(`  FAIL - ${label}\n         ${e.message}`); fail += 1;
      }
    },
    finish() {
      console.log(`\n${pass} passed, ${fail} failed`);
      process.exit(fail ? 1 : 0);
    },
  };
}

module.exports = {
  TABLE, DOWNLOAD, table, objects, archive, writes, reads, fetchLog, options,
  reset, put, get, rows, seedSet, seedPrompt, seedArchiveItem,
  adminEvent, orgAdminEvent, hostEvent, checker,
};
```

- [ ] **Step 2: Write the failing restore test**

Create `tests/archive-restore.js`:

```js
/**
 * PUTTING A BACKUP BACK — shared/archive-restore.js against an in-memory table and bucket.
 *
 * spec §4.3 with amendments A9–A11. Every restore lands in Engage's library. A set that does
 * not exist comes back under its original id. A set that does gets a new version, and only
 * then becomes current.
 *
 * // rejects: a restore that renames, re-ids or publishes; one that overwrites the version it
 * //          supersedes; one that strands legacy content; one that leaves half a version when
 * //          a write fails; org-shaped attributes on a platform row; a restore that changes
 * //          which prompt is the default.
 */
const h = require('./helpers/archive-harness');
const assert = require('assert');
const path = require('path');

const SHARED = path.join(__dirname, '..', 'lambda-functions', 'admin', 'shared');
const tenant = require(path.join(SHARED, 'tenant.js'));
const { setMetadataKey, setPartition, resolveSetPartition } = require(path.join(SHARED, 'set-version.js'));
const { promptKey, promptBodyKey } = require(path.join(SHARED, 'prompt-access.js'));
const snap = require(path.join(SHARED, 'archive-snapshot.js'));
const { restoreSetSnapshot, restorePromptSnapshot } = require(path.join(SHARED, 'archive-restore.js'));
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const { S3Client } = require('@aws-sdk/client-s3');

const { check, finish } = h.checker();
const db = DynamoDBDocumentClient.from();
const deps = {
  db, s3: new S3Client({}), tableName: h.TABLE, promptsBucket: process.env.AI_PROMPTS_BUCKET,
  mediaBucket: process.env.MEDIA_BUCKET, archiveBucket: process.env.ARCHIVE_BUCKET, now: () => '2026-09-15T12:00:00.000Z',
};
const ctx = { archiveId: 'arc-7', restoredBy: 'staff-1' };
const platform = (setId) => ({ scope: tenant.PLATFORM, setId });
const metaRow = (setId) => h.get(setMetadataKey(platform(setId)).PK, `SET#${setId}`);
const contentOf = (setId, version) => h.rows(setPartition(platform(setId), version)).map(({ PK, ...rest }) => rest);
const promptRow = (promptId) => { const k = promptKey({ scope: 'platform', promptId }); return h.get(k.PK, k.SK); };

const ROWS = [
  { SK: 'CATEGORY#c001', Name: 'Zeta', QuestionCount: 1 },
  { SK: 'CATEGORY#c002', Name: 'Alpha', QuestionCount: 1 },
  { SK: 'QUESTION#c001#001', Title: 'First', Category: 'Zeta', options: ['Yes', 'No'], allowMultiple: true, Image: 'sets/pulse/chart.png' },
  { SK: 'QUESTION#c002#001', Title: 'Second', Category: 'Alpha', optionE: 'E', correctAnswer: 'OptionE' },
  { SK: 'REVIEW', status: 'approved' },
];
const META = {
  name: 'Pulse', description: 'How we are', customInstruction: 'Be kind', roundKind: 'produce', Quickstart: true,
  isAIGenerated: false, engagementType: 'poll', active: false, createdBy: 'author-9', createdByName: 'Nine', promptId: 'p-pulse',
};
const setEnvelope = (overrides = {}) => snap.buildSetEnvelope({
  tier: 'prod', scope: 'platform', setId: 'pulse', version: 4, metadata: META, rows: ROWS,
  media: [{ key: 'sets/pulse/chart.png', archiveKey: 'archive/media/snap-1/sets/pulse/chart.png' }],
  snapshotId: 'snap-1', exportedAt: '2026-09-14T09:00:00.000Z', promptName: 'Workie - Pulse', ...overrides,
});

(async () => {
  console.log('1. a set that does not exist comes back under its original id');
  h.reset();
  h.objects.set(`${process.env.ARCHIVE_BUCKET}/archive/media/snap-1/sets/pulse/chart.png`, { Body: 'PNG' });
  h.seedPrompt({ promptId: 'p-pulse', row: { name: 'Workie - Pulse' } });
  let outcome = await restoreSetSnapshot(deps, setEnvelope(), ctx);
  const created = metaRow('pulse');
  await check('it is created as version 1 of "pulse"', () => {
    assert.deepStrictEqual(outcome, {
      kind: 'set', id: 'pulse', name: 'Pulse', mode: 'created', version: 1, active: false, wasActive: false,
      media: { copied: 1, kept: 0, missing: [], skipped: [] },
    });
    assert.strictEqual(created.activeVersion, 1);
  });
  await check('every row is back, in SK order, without the lifecycle row', () => {
    assert.deepStrictEqual(contentOf('pulse', 1), ROWS.filter((row) => row.SK !== 'REVIEW'));
  });
  await check('settings, status, creator and prompt link come from the snapshot, with no suffix', () => {
    for (const [attr, value] of Object.entries(META)) assert.deepStrictEqual(created[attr], value, attr);
  });
  await check('the version entry and provenance say where it came from', () => {
    assert.strictEqual(created.versions.length, 1);
    assert.match(created.versions[0].note, /arc-7/);
    assert.strictEqual(created.versions[0].sourceFile, 'archive:arc-7');
    assert.deepStrictEqual(created.restoredFrom, { archiveId: 'arc-7', scope: 'platform', setId: 'pulse', tier: 'prod', exportedAt: '2026-09-14T09:00:00.000Z' });
    assert.strictEqual(created.restoredBy, 'staff-1');
    assert.deepStrictEqual([created.questionCount, created.categoryCount, created.hasImages], [2, 2, true]);
  });
  await check('its image is back in the tier media bucket', () => {
    assert.strictEqual(h.objects.get(`${process.env.MEDIA_BUCKET}/sets/pulse/chart.png`).Body, 'PNG');
  });

  console.log('\n2. a set that exists gets a new version, and only then becomes current');
  h.reset();
  h.seedSet({
    setId: 'pulse', version: 2, rows: [{ SK: 'QUESTION#c001#001', Title: 'Live v2' }],
    meta: { name: 'Pulse (edited live)', personaId: 'persona-live', active: true, versions: [{ version: 1 }, { version: 2 }] },
  });
  h.put({ PK: setPartition(platform('pulse'), 1), SK: 'QUESTION#c001#001', Title: 'Live v1' });
  outcome = await restoreSetSnapshot(deps, setEnvelope({ media: [] }), ctx);
  const flipped = metaRow('pulse');
  await check('v3 is written and made current', () => {
    assert.deepStrictEqual([outcome.mode, outcome.version, flipped.activeVersion], ['new-version', 3, 3]);
    assert.deepStrictEqual(flipped.versions.map((v) => v.version), [1, 2, 3]);
    assert.strictEqual(contentOf('pulse', 3).length, 4);
  });
  await check('the version it supersedes is untouched', () => {
    assert.deepStrictEqual(contentOf('pulse', 2), [{ SK: 'QUESTION#c001#001', Title: 'Live v2' }]);
  });
  await check('a game pinned to v2 still reads v2', async () => {
    const resolved = await resolveSetPartition(db, h.TABLE, 'pulse', 2);
    assert.strictEqual(resolved.pk, setPartition(platform('pulse'), 2));
  });
  await check('the live row now matches the snapshot: settings set, absent ones removed, status applied', () => {
    assert.strictEqual(flipped.name, 'Pulse');
    assert.strictEqual(flipped.customInstruction, 'Be kind');
    assert.strictEqual(flipped.personaId, undefined, 'personaId was not in the snapshot and must not survive');
    assert.strictEqual(flipped.active, false);
    assert.strictEqual(outcome.wasActive, true);
  });

  console.log('\n3. a set that was never versioned keeps its old content as v1');
  h.reset();
  h.seedSet({ setId: 'pulse', rows: [{ SK: 'QUESTION#c001#001', Title: 'Legacy row' }], meta: { name: 'Legacy', active: true, questionCount: 1 } });
  outcome = await restoreSetSnapshot(deps, setEnvelope({ media: [] }), ctx);
  await check('the legacy rows are copied to v1 and the restore becomes v2', () => {
    assert.strictEqual(outcome.version, 2);
    assert.deepStrictEqual(metaRow('pulse').versions.map((v) => v.version), [1, 2]);
    assert.deepStrictEqual(contentOf('pulse', 1), [{ SK: 'QUESTION#c001#001', Title: 'Legacy row' }]);
    assert.strictEqual(contentOf('pulse', null).length, 1, 'the legacy partition itself is left in place');
  });

  console.log('\n4. a public backup comes back as a house copy');
  h.reset();
  outcome = await restoreSetSnapshot(deps, setEnvelope({
    scope: 'public', setId: 'acme-retro', media: [],
    metadata: { ...META, scope: 'public', orgId: '', sourceOrgId: 'acme', sourceSetId: 'retro', publishedAt: '2026-09-01T00:00:00.000Z' },
  }), ctx);
  const house = metaRow('acme-retro');
  await check('it lands in the platform library with no org-shaped attribute at the top level', () => {
    assert.ok(house, 'no platform row');
    for (const attr of ['scope', 'orgId', 'sourceOrgId', 'publishedAt']) assert.strictEqual(house[attr], undefined, attr);
    assert.deepStrictEqual(house.restoredFrom, {
      archiveId: 'arc-7', scope: 'public', setId: 'acme-retro', tier: 'prod', exportedAt: '2026-09-14T09:00:00.000Z', sourceOrgId: 'acme',
    });
    assert.ok(!h.writes.some((w) => /^(ORG#|PUBLIC#)/.test(w.PK)), JSON.stringify(h.writes));
  });

  console.log('\n5. a failed write leaves the live set as it was');
  h.reset();
  h.seedSet({ setId: 'pulse', version: 2, meta: { name: 'Live', active: true }, rows: [{ SK: 'QUESTION#c001#001', Title: 'Live v2' }] });
  h.options.throwAfterNextBatchWrite = true;
  await check('the error says the live set is untouched', async () => {
    await assert.rejects(() => restoreSetSnapshot(deps, setEnvelope({ media: [] }), ctx), /v3 of "pulse" failed.*untouched/);
  });
  await check('no v3 row survives and the pointer still names v2', () => {
    assert.strictEqual(contentOf('pulse', 3).length, 0);
    assert.strictEqual(metaRow('pulse').activeVersion, 2);
  });

  console.log('\n6. the prompt link');
  h.reset();
  h.seedPrompt({ promptId: 'p-local-7', row: { name: 'workie  -  PULSE' } });
  await restoreSetSnapshot(deps, setEnvelope({ media: [] }), ctx);
  await check('an id that does not exist here is relinked by name', () => assert.strictEqual(metaRow('pulse').promptId, 'p-local-7'));
  h.reset();
  await restoreSetSnapshot(deps, setEnvelope({ media: [] }), ctx);
  await check('with no match by id or by name, the set is left unlinked rather than dangling', () => {
    assert.strictEqual(metaRow('pulse').promptId, undefined);
  });

  console.log('\n7. prompts');
  const BODY = { instructions: 'Read {responsesText}', outputFormat: '## Out', variables: { responsesText: 'answers' }, version: 2, isDefault: true };
  const promptEnvelope = (overrides = {}) => snap.buildPromptEnvelope({
    tier: 'prod', scope: 'platform', promptId: 'p-transfer', exportedAt: '2026-09-14T09:00:00.000Z', body: BODY,
    metadata: {
      name: 'Workie — Transfer', gameType: 'callandanswer', status: 'active', version: 2, isDefault: true,
      questionSetIds: ['pulse'], promptType: 'analysis', createdBy: 'author-9', s3Key: 'prompts/call-and-answer/p-transfer/v2.json',
    },
    ...overrides,
  });

  h.reset();
  outcome = await restorePromptSnapshot(deps, promptEnvelope(), ctx);
  const recreated = promptRow('p-transfer');
  await check('a prompt that does not exist is recreated under its id — canonical type, never a default', () => {
    assert.deepStrictEqual(outcome, { kind: 'prompt', id: 'p-transfer', name: 'Workie — Transfer', mode: 'created', version: 3, status: 'active', isDefault: false });
    assert.strictEqual(recreated.gameType, 'call-and-answer');
    assert.strictEqual(recreated.isDefault, false);
    assert.deepStrictEqual(recreated.questionSetIds, ['pulse']);
    assert.strictEqual(recreated.createdBy, 'author-9');
    assert.strictEqual(recreated.s3Key, promptBodyKey({ scope: 'platform', promptId: 'p-transfer' }, 'call-and-answer', 3));
  });
  await check('its body is the snapshot body, with identity fields reset', () => {
    const stored = JSON.parse(h.objects.get(`${process.env.AI_PROMPTS_BUCKET}/${recreated.s3Key}`).Body);
    assert.strictEqual(stored.instructions, BODY.instructions);
    assert.deepStrictEqual(stored.variables, BODY.variables);
    assert.deepStrictEqual([stored.id, stored.version, stored.isDefault], ['p-transfer', 3, false]);
  });

  h.reset();
  const live = h.seedPrompt({ promptId: 'p-transfer', row: { name: 'Live default', isDefault: true, version: 5 }, body: { instructions: 'live text' } });
  outcome = await restorePromptSnapshot(deps, promptEnvelope(), ctx);
  await check('restoring over the live default makes a new version and leaves it the default', () => {
    assert.deepStrictEqual([outcome.mode, outcome.version], ['new-version', 6]);
    assert.strictEqual(promptRow('p-transfer').isDefault, true);
    assert.strictEqual(JSON.parse(h.objects.get(`${process.env.AI_PROMPTS_BUCKET}/${live.s3Key}`).Body).instructions, 'live text');
  });

  h.reset();
  await restorePromptSnapshot(deps, promptEnvelope({
    promptId: 'gen-trivia', body: null,
    metadata: { name: 'Custom Trivia', gameType: 'trivia', promptType: 'generation', basePrompt: 'Generate {count}', status: 'active' },
  }), ctx);
  await check('a row-only generation prompt comes back as a row with no body', () => {
    const row = promptRow('gen-trivia');
    assert.strictEqual(row.basePrompt, 'Generate {count}');
    assert.strictEqual(row.s3Key, undefined);
    assert.ok(![...h.objects.keys()].some((k) => k.startsWith(`${process.env.AI_PROMPTS_BUCKET}/`)));
  });

  h.reset();
  await check('a backup with no body and no text on its row is refused before anything is written', async () => {
    await assert.rejects(
      () => restorePromptSnapshot(deps, promptEnvelope({ promptId: 'hollow', body: null, metadata: { name: 'Hollow' } }), ctx),
      /no body and no text/,
    );
    assert.deepStrictEqual(h.writes, []);
  });

  finish();
})().catch((e) => { console.error('harness error:', e); process.exit(2); });
```

- [ ] **Step 3: Run it and watch it fail**

Run: `node tests/archive-restore.js; echo "exit $?"`
Expected: exit 1 or 2, with `Cannot find module '.../shared/archive-restore.js'`.

- [ ] **Step 4: Implement the restore module**

Create `lambda-functions/admin/shared/archive-restore.js`:

```js
/**
 * PUTTING A BACKUP BACK — into Engage's library, and nowhere else.
 *
 * spec §4.3. Every restore lands in PLATFORM, whatever library the backup came from. A public
 * set comes back as a house copy (D3). An org backup never reaches this module:
 * archive-snapshot.js refusalFor stops it in the handler.
 *
 * A SET THAT EXISTS GETS A NEW VERSION, AND ONLY THEN BECOMES CURRENT (D2). This is the
 * write-content-then-flip sequence upload-questions.js uses for a replace, so a failure part
 * way leaves the live set exactly as it was, and the previous version stays one click away on
 * the versions screen. A set that does not exist is recreated under its ORIGINAL id, so games,
 * prompts and bookmarks that name it find it again.
 *
 * A PROMPT that exists gets a new version of THAT prompt; one that does not is recreated under
 * its id. A restore never changes which prompt is a default (A9).
 */
const { GetCommand, PutCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const tenant = require('./tenant');
const {
  setRef, setPartition, setMetadataKey, queryPartition, batchPutItems, copyPartition,
  knownVersions, nextVersion, toVersion,
} = require('./set-version');
const { batchDeleteKeys } = require('./ddb-delete');
const { promptKey, promptBodyKey } = require('./prompt-access');
const { resolveLocalPromptId } = require('./archive-prompt-link');
const { normalizeGameType, DEFAULT_GAME_TYPE } = require('./game-types');
const { copyMediaIn } = require('./archive-media');
const snap = require('./archive-snapshot');

const nowIso = (deps) => (deps.now ? deps.now() : new Date().toISOString());

/** The prompt a restored set should name on THIS tier, or '' for none. */
async function resolvePromptLink(deps, envelope) {
  const wanted = String((envelope.metadata && envelope.metadata.promptId) || '').trim();
  if (wanted) {
    const found = await deps.db.send(new GetCommand({
      TableName: deps.tableName, Key: promptKey({ scope: tenant.PLATFORM, promptId: wanted }),
    }));
    if (found && found.Item) return wanted;
  }
  const name = String((envelope.links && envelope.links.promptName) || '').trim();
  if (!name) return '';
  const { items } = await queryPartition(deps.db, deps.tableName, tenant.promptsMetadataPk(tenant.PLATFORM), 'AIPROMPT#');
  return resolveLocalPromptId(name, items).promptId;
}

async function restoreSetSnapshot(deps, envelope, ctx) {
  const { db, tableName } = deps;
  const now = nowIso(deps);
  const from = envelope.exportedFrom || {};
  const setId = String(from.setId || '').trim();
  if (!setId) throw new Error('This backup names no set id, so there is nothing to restore it as.');

  const rows = (Array.isArray(envelope.rows) ? envelope.rows : [])
    .filter((row) => !snap.LIFECYCLE_SKS.includes(String(row && row.SK)));
  if (rows.some((row) => !row || typeof row.SK !== 'string' || row.SK === '')) {
    throw new Error('This backup has a row with no SK, so its structure cannot be rebuilt.');
  }
  const questions = rows.filter((row) => row.SK.startsWith('QUESTION#'));
  if (questions.length === 0) throw new Error('This backup holds no questions, so there is nothing to restore.');
  const categoryCount = rows.filter((row) => row.SK.startsWith('CATEGORY#')).length;
  const hasImages = questions.some((question) => String(question.Image || '').trim() !== '');

  const ref = setRef({ scope: tenant.PLATFORM, setId });
  const found = await db.send(new GetCommand({ TableName: tableName, Key: setMetadataKey(ref) }));
  let existing = found && found.Item;
  const promptId = await resolvePromptLink(deps, envelope);
  const restoredFrom = snap.provenance(envelope, ctx.archiveId);

  // A set that has never been versioned keeps its content in the legacy partition. Snapshot it
  // to v1 first, exactly as a replace does (upload-questions.js), so what this restore
  // supersedes is still a version rather than a partition nothing lists.
  let seed = [];
  let targetVersion = 1;
  if (existing) {
    const versioned = toVersion(existing.activeVersion) !== null || knownVersions(existing).length > 0;
    if (versioned) {
      seed = Array.isArray(existing.versions) ? existing.versions : [];
    } else {
      const legacyPk = setPartition(ref, null);
      const { items: legacyRows } = await queryPartition(db, tableName, legacyPk);
      if (legacyRows.length > 0) {
        await copyPartition(db, tableName, legacyPk, setPartition(ref, 1));
        seed = [{
          version: 1,
          createdAt: existing.createdAt || now,
          questionCount: existing.questionCount || 0,
          categoryCount: existing.categoryCount || 0,
          sourceFile: existing.sourceFile || '',
          note: 'snapshot of the pre-versioning content',
        }];
        existing = { ...existing, versions: seed };
      }
    }
    targetVersion = nextVersion(existing);
  }

  const contentPk = setPartition(ref, targetVersion);
  const items = rows.map((row) => ({ ...row, PK: contentPk }));
  try {
    await batchPutItems(db, tableName, items);
  } catch (error) {
    try {
      await batchDeleteKeys(db, tableName, items.map(({ PK, SK }) => ({ PK, SK })));
    } catch (cleanup) {
      console.error(`⚠️ rollback of ${contentPk} was incomplete: ${cleanup.message}`);
    }
    throw new Error(`Writing v${targetVersion} of "${setId}" failed: ${error.message}. `
      + (existing ? 'The live set is untouched.' : 'Nothing was left behind.'));
  }

  const media = await copyMediaIn(deps.s3, { mediaBucket: deps.mediaBucket, archiveBucket: deps.archiveBucket, media: envelope.media });

  const note = `Restored from archive ${ctx.archiveId}, exported ${envelope.exportedAt} from ${from.tier}`
    + (from.version ? ` (it was v${from.version} there)` : '');
  const versionEntry = {
    version: targetVersion, createdAt: now, questionCount: questions.length, categoryCount,
    sourceFile: `archive:${ctx.archiveId}`, note,
  };
  const settings = snap.settingsFrom(envelope.metadata);
  if (promptId) settings.promptId = promptId; else delete settings.promptId;
  const snapshotActive = typeof (envelope.metadata && envelope.metadata.active) === 'boolean' ? envelope.metadata.active : null;

  if (!existing) {
    const item = {
      ...snap.platformMetadata(envelope.metadata, restoredFrom),
      ...setMetadataKey(ref),
      activeVersion: 1,
      versions: [versionEntry],
      questionCount: questions.length,
      categoryCount,
      hasImages,
      // No recorded status is not permission to publish: an active Engage set is live for every organisation.
      active: snapshotActive === null ? false : snapshotActive,
      restoredAt: now,
      ...(ctx.restoredBy ? { restoredBy: ctx.restoredBy } : {}),
      updatedAt: now,
    };
    if (promptId) item.promptId = promptId; else delete item.promptId;
    await db.send(new PutCommand({ TableName: tableName, Item: item, ConditionExpression: 'attribute_not_exists(SK)' }));
    return { kind: 'set', id: setId, name: item.name || setId, mode: 'created', version: 1, active: item.active, wasActive: false, media };
  }

  // THE FLIP. One update carries the pointer, the version list, the counts and the settings,
  // so the live row never names the new version while still holding the old settings.
  const names = { '#versions': 'versions' };
  const values = { ':seed': seed, ':entry': [versionEntry] };
  const sets = ['#versions = list_append(if_not_exists(#versions, :seed), :entry)'];
  const removes = [];
  const assign = (attr, value) => {
    names[`#${attr}`] = attr;
    values[`:${attr}`] = value;
    sets.push(`#${attr} = :${attr}`);
  };
  assign('activeVersion', targetVersion);
  assign('questionCount', questions.length);
  assign('categoryCount', categoryCount);
  assign('hasImages', hasImages);
  assign('updatedAt', now);
  assign('restoredAt', now);
  assign('restoredFrom', restoredFrom);
  if (ctx.restoredBy) assign('restoredBy', ctx.restoredBy);
  for (const attr of snap.SET_SETTINGS) {
    if (Object.prototype.hasOwnProperty.call(settings, attr)) {
      assign(attr, settings[attr]);
    } else {
      names[`#${attr}`] = attr;
      removes.push(`#${attr}`);
    }
  }
  if (snapshotActive !== null) assign('active', snapshotActive);

  await db.send(new UpdateCommand({
    TableName: tableName,
    Key: setMetadataKey(ref),
    UpdateExpression: `SET ${sets.join(', ')}${removes.length ? ` REMOVE ${removes.join(', ')}` : ''}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
    ConditionExpression: 'attribute_exists(SK)',
  }));

  const wasActive = existing.active !== false;
  return {
    kind: 'set', id: setId, name: settings.name || existing.name || setId, mode: 'new-version',
    version: targetVersion, active: snapshotActive === null ? wasActive : snapshotActive, wasActive, media,
  };
}

async function restorePromptSnapshot(deps, envelope, ctx) {
  const { db, tableName } = deps;
  const now = nowIso(deps);
  const from = envelope.exportedFrom || {};
  const promptId = String(from.promptId || '').trim();
  if (!promptId) throw new Error('This backup names no prompt id, so there is nothing to restore it as.');

  const metadata = envelope.metadata || {};
  const hasBody = Boolean(envelope.body) && typeof envelope.body === 'object';
  if (!hasBody && !snap.rowCarriesPromptText(metadata)) {
    throw new Error(`This backup of prompt ${promptId} has no body and no text on its row, so restoring it would create an empty prompt.`);
  }
  if (hasBody && !deps.promptsBucket) {
    throw new Error('AI_PROMPTS_BUCKET is not set on the import function, so the prompt body cannot be stored. '
      + 'This is a deployment fault, not a problem with this backup (template-clean.yaml, AdminImportFromArchiveFunction).');
  }

  const ref = { scope: tenant.PLATFORM, promptId };
  const found = await db.send(new GetCommand({ TableName: tableName, Key: promptKey(ref) }));
  const existing = found && found.Item;
  const gameType = normalizeGameType(metadata.gameType) || DEFAULT_GAME_TYPE;
  const numeric = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
  // A version number neither tier has used, so no body key from either history is overwritten.
  const version = Math.max(numeric(existing && existing.version), numeric(metadata.version)) + 1;
  const isDefault = existing ? existing.isDefault === true : false;
  const status = metadata.status || 'draft';

  let s3Key;
  if (hasBody) {
    s3Key = promptBodyKey(ref, gameType, version);
    const body = { ...envelope.body, id: promptId, version, gameType, isDefault, status, updatedAt: now };
    await deps.s3.send(new PutObjectCommand({
      Bucket: deps.promptsBucket,
      Key: s3Key,
      Body: JSON.stringify(body, null, 2),
      ContentType: 'application/json',
      Metadata: { promptId, gameType, version: String(version), status: String(status) },
    }));
  }

  const row = {
    ...snap.platformMetadata(metadata, snap.provenance(envelope, ctx.archiveId)),
    ...promptKey(ref),
    promptId,
    gameType,
    version,
    isDefault,
    status,
    updatedAt: now,
    restoredAt: now,
    ...(ctx.restoredBy ? { restoredBy: ctx.restoredBy } : {}),
  };
  if (s3Key) row.s3Key = s3Key; else delete row.s3Key;
  await db.send(new PutCommand({ TableName: tableName, Item: row }));
  return { kind: 'prompt', id: promptId, name: row.name || promptId, mode: existing ? 'new-version' : 'created', version, status, isDefault };
}

module.exports = { restoreSetSnapshot, restorePromptSnapshot, resolvePromptLink };
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `node tests/archive-restore.js; echo "exit $?"`
Expected: `20 passed, 0 failed`, exit 0.

If the rollback check fails because `batchDeleteKeys` issued a Query, look at how `lambda-functions/admin/shared/ddb-delete.js` builds its `BatchWriteCommand` and fix the restore call site. Do not loosen the harness.

- [ ] **Step 6: Run the neighbouring guards**

Run: `node tests/no-global-partition-literals.js && node tests/kms-grants-match-code.js; echo "exit $?"`
Expected: exit 0. The new module adds no partition literal, and no handler requires it yet.

- [ ] **Step 7: Commit**

```bash
git add tests/helpers/archive-harness.js lambda-functions/admin/shared/archive-restore.js tests/archive-restore.js
git commit -m "Snapshots restore into Engage's library under their original ids

A set that exists gets a new version and is switched to it only after every row is written,
the same sequence a replace uses, so a failed write leaves the live set as it was. A set
that was never versioned keeps its old rows as version 1. A missing set is recreated under
its original id. Public backups come back as house copies with no org-shaped attributes,
and a restored prompt never changes which prompt is the default. The in-memory harness the
archive suites share refuses unsigned archive requests, as the locked service will.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 5: A new set can start inactive

**Files:**
- Modify: `lambda-functions/admin/upload-questions.js` (the payload destructure at ~line 116, and the `active:` line at ~line 842)
- Test: `tests/upload-start-inactive.js`

**Interfaces:**
- Consumes: Task 4 harness.
- Produces: `POST /admin/upload-questions` accepts an optional `startInactive: true`. It creates the set with `active: false` and leaves every question row `Active: true`. Only the boolean `true` counts. Task 6's legacy CSV restore sends it (spec §4.8: "lands inactive", with no moment at which the set is live).

- [ ] **Step 1: Write the failing test**

Create `tests/upload-start-inactive.js`:

```js
/**
 * A LEGACY BACKUP LANDS INACTIVE — WITHOUT A MOMENT WHERE IT IS LIVE.
 *
 * spec §4.8. A CSV written before snapshots does not record whether its set was active, and an
 * active Engage set is shown to every organisation. So the legacy restore creates the set
 * inactive. Doing it with a follow-up update would leave a window in which the set is live,
 * hence an additive flag on the create itself.
 *
 * // rejects: a flag that also deactivates the questions (activating the set would then not be
 * //          enough); a truthy string counting as true; any change to the default.
 */
const h = require('./helpers/archive-harness');
const assert = require('assert');
const path = require('path');

const REPO = path.join(__dirname, '..');
const { setMetadataKey, setPartition } = require(path.join(REPO, 'lambda-functions/admin/shared/set-version.js'));
const upload = require(path.join(REPO, 'lambda-functions/admin/upload-questions.js')).handler;

const { check, finish } = h.checker();
const CSV = 'Category,Title,Detail\nWarmups,First,One\nWarmups,Second,Two';
const ref = { scope: 'platform', setId: 'warmups' };
const create = (extra) => upload(h.adminEvent({ fileName: 'warm.csv', fileContent: CSV, customTitle: 'Warm Ups', ...extra }));
const meta = () => h.get(setMetadataKey(ref).PK, setMetadataKey(ref).SK);
const questions = () => h.rows(setPartition(ref, null)).filter((row) => row.SK.startsWith('QUESTION#'));

(async () => {
  console.log('1. startInactive');
  h.reset();
  let res = await create({ startInactive: true });
  await check('the set is created inactive', () => {
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(meta().active, false);
  });
  await check('its questions stay playable, so activating the set is all it takes', () => {
    assert.strictEqual(questions().length, 2);
    assert.ok(questions().every((q) => q.Active === true));
  });
  await check('it is not marked AI-generated', () => assert.strictEqual(meta().isAIGenerated, false));

  console.log('\n2. nothing else changes');
  h.reset();
  res = await create({});
  await check('without the flag a new set is active, as before', () => {
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(meta().active, true);
  });
  h.reset();
  await create({ startInactive: 'true' });
  await check('only a real true counts — the string "true" does not', () => assert.strictEqual(meta().active, true));
  h.reset();
  await create({ isAIGenerated: true });
  await check('AI-generated content still starts inactive, questions and all', () => {
    assert.strictEqual(meta().active, false);
    assert.ok(questions().every((q) => q.Active === false));
  });

  finish();
})().catch((e) => { console.error('harness error:', e); process.exit(2); });
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node tests/upload-start-inactive.js; echo "exit $?"`
Expected: exit 1. `the set is created inactive` fails (`true !== false`), and the other five pass.

- [ ] **Step 3: Add the flag**

In `lambda-functions/admin/upload-questions.js`, directly below the line
`const { fileName, fileContent, customTitle, customDescription, customInstructions, aiContextInstructions, promptId, isAIGenerated } = payload;`
add:

```js
    // A NEW SET THAT STARTS HIDDEN. The archive's legacy restore sends this, because a CSV
    // written before snapshots does not record whether its set was live, and an active Engage
    // set is shown to every organisation. Set-level only: the question rows stay Active, so
    // switching the set on is all it takes. Strictly `true` — this is a publish decision, and
    // "true" as a string is a caller bug to be seen, not a value to be guessed at.
    const startInactive = payload.startInactive === true;
```

Replace the line
`      active: isAIGenerated ? false : true,  // AI-generated content starts as inactive`
with:

```js
      // AI-generated content starts inactive, and so does a set restored from a legacy backup.
      active: (isAIGenerated || startInactive) ? false : true,
```

- [ ] **Step 4: Run the test, then the existing upload suites**

Run: `node tests/upload-start-inactive.js; echo "exit $?"`
Expected: `6 passed, 0 failed`, exit 0.

Run: `for f in tests/*upload*.js tests/import-questions-flow.js tests/question-set-roundtrip.js; do [ -f "$f" ] && { node "$f" >/dev/null 2>&1 && echo "ok $f" || echo "FAIL $f"; }; done`
Expected: every line starts with `ok`.

- [ ] **Step 5: Commit**

```bash
git add lambda-functions/admin/upload-questions.js tests/upload-start-inactive.js
git commit -m "A question set can be created inactive with startInactive

The legacy archive restore needs a set that is never live, even for a moment. A legacy CSV
does not record whether its set was active, and an active Engage set is shown to every
organisation. The flag is set-level only, so the questions stay playable, and only the
boolean true counts.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 6: Import restores per item — snapshot or legacy

**Files:**
- Modify (rewrite whole file): `lambda-functions/admin/import-from-archive.js`
- Test (new): `tests/archive-import-handler.js`
- Modify: `tests/prompt-archive-roundtrip.js`, `tests/archive-export-image-roundtrip.js` (the minimum these need to keep passing against the new import; Task 7 migrates them properly)

**Interfaces:**
- Consumes: Task 1 `archive-client.downloadItem`; Task 2 `parseArchiveContent`, `refusalFor`; Task 4 `restoreSetSnapshot`, `restorePromptSnapshot`; Task 5 `startInactive`; existing `upload-questions.js` handler, `question-set-access.callerUserId`, `prompt-access` (`promptKey`, `promptBodyKey`), `archive-prompt-link` (`promptNameFromTags`, `resolveLocalPromptId`), `game-types`, `prompt-shape.inferPromptType`, `set-version.queryPartition`.
- Produces: `POST /admin/import-from-archive` with body `{ selectedItems: string[] }`. `importType` and `conflictResolution` are accepted and ignored. Responses:
  - `403 { error }` when `canManageScope(event, PLATFORM)` is false; `400 { error }` for a bad body.
  - `200 { message, results: { successful, failed, totalRequested }, becameActive: [{ id, name }], media: { copied, kept, missing } }`
  - a snapshot entry in `successful`: `{ archiveId, kind, id, name, mode, version, active }` for a set, `{ archiveId, kind, id, name, mode, version, status, isDefault }` for a prompt
  - a legacy entry: `{ archiveId, kind: 'set', id, name, mode: 'created', version: null, active: false, legacy: true, questionCount }` or `{ archiveId, kind: 'prompt', id, name, mode: 'created', version: 1, status: 'draft', isDefault: false, legacy: true }`
  - a refusal: `{ archiveId, refused: true, error }` in `failed`; any other failure is `{ archiveId, error }`

- [ ] **Step 1: Write the failing handler test**

Create `tests/archive-import-handler.js`:

```js
/**
 * RESTORING FROM THE ARCHIVE, AS THE ADMIN SCREEN ASKS FOR IT — the import handler's wiring.
 *
 * shared/archive-restore.js is tested on its own (tests/archive-restore.js). This drives the
 * REAL handler against tests/helpers/archive-harness.js and checks what only the handler
 * decides: who may restore, which path each item takes, that one bad item does not stop the
 * rest, and that the response names every set now live for every organisation.
 *
 * // rejects: a restore by a host or by an admin standing in a customer team; a batch that
 * //          dies on its first bad item; a refusal that still writes; a legacy CSV that lands
 * //          active or renamed; an unsigned archive call.
 */
const h = require('./helpers/archive-harness');
const assert = require('assert');
const path = require('path');

const REPO = path.join(__dirname, '..');
const SHARED = path.join(REPO, 'lambda-functions/admin/shared');
const snap = require(path.join(SHARED, 'archive-snapshot.js'));
const { setMetadataKey, setPartition } = require(path.join(SHARED, 'set-version.js'));
const importHandler = require(path.join(REPO, 'lambda-functions/admin/import-from-archive.js')).handler;

const { check, finish } = h.checker();
const run = async (event) => { const res = await importHandler(event); return { status: res.statusCode, body: JSON.parse(res.body) }; };
const metaRow = (setId) => { const k = setMetadataKey({ scope: 'platform', setId }); return h.get(k.PK, k.SK); };
const setSnapshot = (setId, meta, extra = {}) => snap.buildSetEnvelope({
  tier: 'test', scope: 'platform', setId, version: 1, metadata: { name: setId, engagementType: 'call-and-answer', ...meta },
  rows: [{ SK: 'CATEGORY#c001', Name: 'A' }, { SK: 'QUESTION#c001#001', Title: 'Q', Category: 'A' }],
  media: [], snapshotId: 'snap', exportedAt: '2026-09-14T09:00:00.000Z', ...extra,
});
const seedSnapshot = (envelope) => h.seedArchiveItem({
  contentType: envelope.schema === snap.PROMPT_SCHEMA ? 'prompt' : 'questionset',
  title: String(envelope.metadata.name), tags: snap.envelopeTags(envelope), content: JSON.stringify(envelope),
});
const LEGACY_CSV = '"Category","Title","Detail","OptionA","OptionB","OptionC","OptionD","OptionE","CorrectAnswer"\n'
  + '"Space","Largest planet?","","Mars","Venus","Earth","Mercury","Jupiter","OptionE"';

(async () => {
  console.log('1. only Engage staff acting as Engage may restore');
  h.reset();
  const anyItem = seedSnapshot(setSnapshot('guarded', { active: true }));
  for (const [who, event] of [
    ['a host', h.hostEvent({ selectedItems: [anyItem] })],
    ['an Engage admin standing in a customer team', h.orgAdminEvent('acme', { selectedItems: [anyItem] })],
  ]) {
    // eslint-disable-next-line no-await-in-loop
    const res = await run(event);
    // eslint-disable-next-line no-await-in-loop
    await check(`${who} is refused before the archive is touched`, () => {
      assert.strictEqual(res.status, 403);
      assert.match(res.body.error, /Switch to Engage/);
      assert.strictEqual(h.fetchLog.length, 0);
      assert.deepStrictEqual(h.writes, []);
    });
  }
  await check('an empty selection is a 400', async () => {
    assert.strictEqual((await run(h.adminEvent({ selectedItems: [] }))).status, 400);
  });

  console.log('\n2. snapshots');
  h.reset();
  const live = seedSnapshot(setSnapshot('livequiz', { active: true }));
  const hidden = seedSnapshot(setSnapshot('hiddenquiz', { active: false }));
  h.seedSet({ setId: 'alreadylive', version: 1, meta: { name: 'Already live', active: true }, rows: [{ SK: 'QUESTION#c001#001', Title: 'old' }] });
  const stillLive = seedSnapshot(setSnapshot('alreadylive', { name: 'Already live', active: true }));
  let res = await run(h.adminEvent({ selectedItems: [live, hidden, stillLive] }));
  await check('each set is restored, and the entry says what happened', () => {
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body.results.failed, []);
    assert.deepStrictEqual(res.body.results.successful[0], {
      archiveId: live, kind: 'set', id: 'livequiz', name: 'livequiz', mode: 'created', version: 1, active: true,
    });
    assert.deepStrictEqual(res.body.results.successful.map((r) => r.mode), ['created', 'created', 'new-version']);
  });
  await check('becameActive names the set that is newly live — not the hidden one, not one that was live already', () => {
    assert.deepStrictEqual(res.body.becameActive, [{ id: 'livequiz', name: 'livequiz' }]);
  });
  await check('the restore is recorded against the member of staff who ran it', () => {
    assert.strictEqual(metaRow('livequiz').restoredBy, 'staff-1');
  });
  await check('every archive call was signed; the presigned downloads were not', () => {
    const archiveCalls = h.fetchLog.filter((c) => c.url.startsWith(process.env.ARCHIVE_SERVICE_URL));
    const downloads = h.fetchLog.filter((c) => c.url.startsWith(h.DOWNLOAD));
    assert.strictEqual(archiveCalls.length, 3);
    assert.ok(archiveCalls.every((c) => String(c.headers.authorization).startsWith('AWS4-HMAC-SHA256')));
    assert.ok(downloads.length === 3 && downloads.every((c) => !c.headers.authorization));
  });

  console.log('\n3. refusals write nothing, and one bad item does not stop the batch');
  h.reset();
  const orgBackup = seedSnapshot(setSnapshot('acmeretro', {}, { scope: 'org' }));
  const future = h.seedArchiveItem({ title: 'From the future', content: JSON.stringify({ schema: 'engage.set/9' }) });
  const encrypted = seedSnapshot(setSnapshot('sealed', { name: 'sealed', customInstruction: { v: 1, iv: 'aQ==', tag: 'dA==', ct: 'Yw==' } }));
  const good = seedSnapshot(setSnapshot('goodquiz', { active: false }));
  res = await run(h.adminEvent({ selectedItems: ['arc-does-not-exist', orgBackup, future, encrypted, good] }));
  await check('the three refusals are marked as refusals and name their reason', () => {
    const refused = res.body.results.failed.filter((f) => f.refused);
    assert.deepStrictEqual(refused.map((f) => f.archiveId), [orgBackup, future, encrypted]);
    assert.match(refused[0].error, /Organisation content is not archived/);
    assert.match(refused[1].error, /engage\.set\/9/);
    assert.match(refused[2].error, /encrypted/);
  });
  await check('a missing item is a failure, not a refusal', () => {
    const missing = res.body.results.failed.find((f) => f.archiveId === 'arc-does-not-exist');
    assert.ok(missing && !missing.refused && /404/.test(missing.error), JSON.stringify(missing));
  });
  await check('the good item after them was still restored, and it is the only thing written', () => {
    assert.deepStrictEqual(res.body.results.successful.map((r) => r.id), ['goodquiz']);
    assert.ok(h.writes.every((w) => w.PK === setPartition({ scope: 'platform', setId: 'goodquiz' }, 1) || w.SK === 'SET#goodquiz'));
  });

  console.log('\n4. legacy items: no suffixes, and a set lands inactive');
  h.reset();
  const legacySet = h.seedArchiveItem({
    contentType: 'questionset', title: 'Old Quiz (dev)', description: 'Space facts - Exported from dev environment',
    tags: ['dev', 'trivia', 'questions:1'], content: LEGACY_CSV,
  });
  res = await run(h.adminEvent({ selectedItems: [legacySet] }));
  const legacyRow = metaRow('oldquiz');
  await check('the CSV restores as "Old Quiz", inactive, owned by the restorer', () => {
    assert.deepStrictEqual(res.body.results.failed, []);
    assert.deepStrictEqual(res.body.results.successful[0], {
      archiveId: legacySet, kind: 'set', id: 'oldquiz', name: 'Old Quiz', mode: 'created', version: null, active: false, legacy: true, questionCount: 1,
    });
    assert.deepStrictEqual([legacyRow.name, legacyRow.description, legacyRow.active, legacyRow.createdBy], ['Old Quiz', 'Space facts', false, 'staff-1']);
  });
  await check('its trivia options survive', () => {
    const question = h.rows(setPartition({ scope: 'platform', setId: 'oldquiz' }, null)).find((r) => r.SK.startsWith('QUESTION#'));
    assert.deepStrictEqual([question.optionE, question.correctAnswer], ['Jupiter', 'OptionE']);
  });
  await check('restoring it again, over the set it created, is refused and changes nothing', async () => {
    const before = metaRow('oldquiz');
    const again = await run(h.adminEvent({ selectedItems: [legacySet] }));
    assert.match(again.body.results.failed[0].error, /already exists/);
    assert.deepStrictEqual(metaRow('oldquiz'), before);
  });

  h.reset();
  const legacyPrompt = h.seedArchiveItem({
    contentType: 'prompt', title: 'Summary (dev)', tags: ['dev', 'trivia'],
    content: JSON.stringify({ metadata: { promptId: 'old1', name: 'Summary', description: 'Reads the room', gameType: 'trivia' }, prompt: { instructions: 'Say {x}', outputFormat: '## S' } }),
  });
  res = await run(h.adminEvent({ selectedItems: [legacyPrompt] }));
  await check('a legacy prompt restores as a draft copy, with no suffix on its name or description', () => {
    const entry = res.body.results.successful[0];
    assert.ok(entry && entry.legacy && entry.id.startsWith('imported-'), JSON.stringify(res.body));
    const row = h.rows('AIPROMPTS').find((r) => r.promptId === entry.id);
    assert.deepStrictEqual([row.name, row.description, row.status, row.isDefault], ['Summary', 'Reads the room', 'draft', false]);
  });

  finish();
})().catch((e) => { console.error('harness error:', e); process.exit(2); });
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node tests/archive-import-handler.js; echo "exit $?"`
Expected: exit 1. The 403 checks fail because the current handler has no scope check and answers 200. The restore checks fail because its unsigned `fetch` calls are answered 403 by the harness, so every item lands in `failed`.

- [ ] **Step 3: Rewrite the import handler**

Replace the whole of `lambda-functions/admin/import-from-archive.js` with:

```js
/**
 * RESTORE FROM THE SHARED ARCHIVE — into Engage's library, and nowhere else.
 *
 * docs/superpowers/specs/2026-09-14-archive-full-fidelity-design.md §4.3, §4.4 and §4.8.
 *
 * WHO: canManageScope(event, PLATFORM), checked here. The route's `admins` gate alone let an
 * Engage admin standing inside a customer team restore into the library every organisation
 * reads.
 *
 * WHAT IS DECIDED BY CONTENT, per item. A JSON document with a `schema` is a snapshot
 * (shared/archive-snapshot.js), restored by shared/archive-restore.js under its original id.
 * Anything else was written before snapshots existed: a CSV question set or a
 * `{metadata, prompt}` JSON prompt. Those take the legacy path below, which keeps working with
 * two corrections: no suffixes are added, and a set lands inactive, because the item never
 * recorded whether the set was live.
 *
 * WHAT IT SAYS: per item what happened, which sets are now live for every organisation, and
 * which images could not be brought back, so a restore cannot quietly publish anything. One
 * bad item is reported and the rest carry on.
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const tenant = require('./shared/tenant');
const { queryPartition } = require('./shared/set-version');
const { promptKey, promptBodyKey } = require('./shared/prompt-access');
const { callerUserId } = require('./shared/question-set-access');
const { normalizeGameType, DEFAULT_GAME_TYPE } = require('./shared/game-types');
const { inferPromptType } = require('./shared/prompt-shape');
const { promptNameFromTags, resolveLocalPromptId } = require('./shared/archive-prompt-link');
const archive = require('./shared/archive-client');
const snap = require('./shared/archive-snapshot');
const { restoreSetSnapshot, restorePromptSnapshot } = require('./shared/archive-restore');

const db = DynamoDBDocumentClient.from(new DynamoDBClient());
const s3Client = new S3Client({});

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Engage-Org',
};
const respond = (statusCode, body) => ({ statusCode, headers: corsHeaders, body: JSON.stringify(body) });

/** What the pre-snapshot exporter appended to titles and descriptions, and a restore now strips. */
const TIER_SUFFIX = /\s*\((dev|test|prod|unknown)\)\s*$/i;
const EXPORT_NOTE = /\s*-\s*Exported from (dev|test|prod|unknown) environment\s*$/i;
const LEGACY_TYPES = ['call-and-answer', 'trivia', 'poll', 'wavelength', 'survey'];

exports.handler = async (event) => {
  if (event && event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders, body: '' };
  if (!tenant.canManageScope(event, tenant.PLATFORM)) {
    return respond(403, { error: "Restoring writes Engage's library. Switch to Engage (no organisation selected) to restore from the archive." });
  }
  let payload;
  try {
    payload = JSON.parse((event && event.body) || '{}');
  } catch {
    return respond(400, { error: 'Request body is not valid JSON.' });
  }
  const { selectedItems } = payload;
  if (!Array.isArray(selectedItems) || selectedItems.length === 0) {
    return respond(400, { error: 'selectedItems array is required and must not be empty' });
  }

  const deps = {
    db,
    s3: s3Client,
    tableName: process.env.TABLE_NAME,
    promptsBucket: process.env.AI_PROMPTS_BUCKET,
    mediaBucket: process.env.MEDIA_BUCKET,
    archiveBucket: process.env.ARCHIVE_BUCKET,
  };
  const results = { successful: [], failed: [], totalRequested: selectedItems.length };
  const becameActive = [];
  const media = { copied: 0, kept: 0, missing: [] };

  for (const raw of selectedItems) {
    const archiveId = String(raw || '').trim();
    try {
      const { item, content } = await archive.downloadItem(archiveId);
      const parsed = snap.parseArchiveContent(content);

      if (parsed.kind === 'unknown') {
        results.failed.push({ archiveId, refused: true, error: `This backup uses a format this version does not read (${JSON.stringify(parsed.schema)}), so it is not restored.` });
        continue;
      }

      if (parsed.kind === 'legacy') {
        const entry = item.ContentType === 'prompt'
          ? await restoreLegacyPrompt(archiveId, item, parsed.doc)
          : await restoreLegacySet(event, archiveId, item, content);
        results.successful.push(entry);
        continue;
      }

      const refusal = snap.refusalFor(parsed.envelope);
      if (refusal) {
        results.failed.push({ archiveId, refused: true, error: refusal });
        continue;
      }
      const ctx = { archiveId, restoredBy: callerUserId(event) };
      const outcome = parsed.kind === 'set'
        ? await restoreSetSnapshot(deps, parsed.envelope, ctx)
        : await restorePromptSnapshot(deps, parsed.envelope, ctx);
      const { media: restoredMedia, wasActive, ...entry } = outcome;
      results.successful.push({ archiveId, ...entry });
      if (restoredMedia) {
        media.copied += restoredMedia.copied;
        media.kept += restoredMedia.kept;
        media.missing.push(...restoredMedia.missing);
      }
      if (outcome.kind === 'set' && outcome.active === true && wasActive !== true) {
        becameActive.push({ id: outcome.id, name: outcome.name });
      }
    } catch (error) {
      console.error(`❌ restore of ${archiveId} failed:`, error);
      results.failed.push({ archiveId, error: error.message });
    }
  }

  console.log(`✅ Restore finished. Restored ${results.successful.length}, not restored ${results.failed.length}`);
  return respond(200, {
    message: `Import completed. ${results.successful.length} items restored.`,
    results,
    becameActive,
    media,
  });
};

/** The environment a legacy item was tagged with. */
function legacyTier(tags) {
  const found = (Array.isArray(tags) ? tags : []).map((tag) => String(tag).toLowerCase()).find((tag) => snap.TIERS.includes(tag));
  return found || 'unknown';
}

/** Re-link a legacy set to a local prompt by the name its tags carry, or '' for none. */
async function legacyPromptLink(archiveId, tags) {
  const wanted = promptNameFromTags(tags);
  if (!wanted) return '';
  const { items } = await queryPartition(db, process.env.TABLE_NAME, tenant.promptsMetadataPk(tenant.PLATFORM), 'AIPROMPT#');
  const { promptId, matched } = resolveLocalPromptId(wanted, items);
  if (matched === 0) console.warn(`⚠️ ${archiveId}: no local prompt named "${wanted}" — restoring unlinked`);
  if (matched > 1) console.warn(`⚠️ ${archiveId}: ${matched} local prompts named "${wanted}"; linked the first (${promptId})`);
  return promptId;
}

/**
 * A CSV question set from before snapshots: through upload-questions.js, as the ADMIN who asked
 * (so the set is owned by them and created in platform), inactive, with its original name.
 * A name that is already taken is refused by upload-questions itself. With no suffix there
 * is no automatic rename, and overwriting a live set from a CSV of unknown age is not a restore.
 */
async function restoreLegacySet(event, archiveId, item, csv) {
  const name = String(item.Title || '').replace(TIER_SUFFIX, '').trim();
  if (!name) throw new Error('This legacy item has no title to name the set with.');
  const tags = Array.isArray(item.Tags) ? item.Tags : [];
  const engagementType = tags.map((tag) => String(tag).toLowerCase()).find((tag) => LEGACY_TYPES.includes(tag)) || 'call-and-answer';
  const promptId = await legacyPromptLink(archiveId, tags);
  const uploadQuestions = require('./upload-questions');
  const response = await uploadQuestions.handler({
    requestContext: event.requestContext,
    body: JSON.stringify({
      fileName: `${name}.csv`,
      fileContent: csv,
      customTitle: name,
      customDescription: String(item.Description || '').replace(EXPORT_NOTE, '').trim(),
      promptId,
      engagementType,
      isAIGenerated: false,
      startInactive: true,
      scope: tenant.PLATFORM,
    }),
  });
  let body = {};
  try { body = JSON.parse(response.body || '{}'); } catch { body = {}; }
  if (response.statusCode !== 200) throw new Error(body.error || `The legacy restore was refused (${response.statusCode}).`);
  return {
    archiveId, kind: 'set', id: body.setId, name: body.setName || name, mode: 'created',
    version: null, active: false, legacy: true, questionCount: body.questionCount,
  };
}

/**
 * A `{metadata, prompt}` prompt from before snapshots: a DRAFT copy under a new id, with its
 * body written to S3 the way create-ai-prompt.js writes one. Unchanged from the importer this
 * replaces, apart from the suffixes it no longer adds.
 */
async function restoreLegacyPrompt(archiveId, item, doc) {
  const { metadata = {}, prompt } = doc || {};
  if (!prompt || typeof prompt !== 'object') throw new Error('This legacy prompt item has no prompt body.');
  if (!process.env.AI_PROMPTS_BUCKET) {
    throw new Error('AI_PROMPTS_BUCKET is not set on the import function, so the prompt body cannot be stored. '
      + 'This is a deployment fault, not a problem with this archive item. Redeploy with AI_PROMPTS_BUCKET and an '
      + 'S3 write policy (template-clean.yaml, AdminImportFromArchiveFunction).');
  }
  const promptId = `imported-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  const now = new Date().toISOString();
  const gameType = normalizeGameType(metadata.gameType) || DEFAULT_GAME_TYPE;
  const promptType = metadata.promptType || inferPromptType(prompt);
  const name = String(metadata.name || item.Title || '').replace(TIER_SUFFIX, '').trim() || promptId;

  // Everything the item carried, minus the two legacy aliases older exports added. They
  // duplicate instructions and outputFormat, and are promoted into them when those are absent.
  const { systemPrompt, userPrompt, ...bodyFields } = prompt;
  const body = {
    ...bodyFields,
    id: promptId, version: 1, name, gameType, promptType, isDefault: false, status: 'draft', createdAt: now, updatedAt: now,
    ...(bodyFields.instructions === undefined && systemPrompt ? { instructions: systemPrompt } : {}),
    ...(bodyFields.outputFormat === undefined && userPrompt ? { outputFormat: userPrompt } : {}),
  };
  const ref = { scope: tenant.PLATFORM, promptId };
  const s3Key = promptBodyKey(ref, gameType, 1);
  await s3Client.send(new PutObjectCommand({
    Bucket: process.env.AI_PROMPTS_BUCKET,
    Key: s3Key,
    Body: JSON.stringify(body, null, 2),
    ContentType: 'application/json',
    Metadata: { promptId, gameType, version: '1', status: 'draft' },
  }));
  await db.send(new PutCommand({
    TableName: process.env.TABLE_NAME,
    Item: {
      ...promptKey(ref),
      promptId,
      name,
      description: metadata.description || '',
      gameType,
      promptType,
      category: metadata.category || 'imported',
      status: 'draft',
      isDefault: false,
      ...(body.scenario && { scenario: body.scenario }),
      ...(body.scenarioType && { scenarioType: body.scenarioType }),
      ...(body.basePrompt && { basePrompt: body.basePrompt }),
      ...(body.contextTemplate && { contextTemplate: body.contextTemplate }),
      ...(body.audienceTemplate && { audienceTemplate: body.audienceTemplate }),
      ...(body.categoryTemplate && { categoryTemplate: body.categoryTemplate }),
      ...(body.outputFormat && { outputFormat: body.outputFormat }),
      ...(body.outputSections && { outputSections: body.outputSections }),
      ...(body.defaultSettings && { defaultSettings: body.defaultSettings }),
      questionSetIds: [],
      tags: Array.isArray(body.tags) ? body.tags : [],
      s3Key,
      version: 1,
      createdAt: now,
      updatedAt: now,
      importedFrom: { archiveId, originalId: metadata.promptId, importedAt: now, sourceEnvironment: legacyTier(item.Tags) },
    },
  }));
  return { archiveId, kind: 'prompt', id: promptId, name, mode: 'created', version: 1, status: 'draft', isDefault: false, legacy: true };
}
```

- [ ] **Step 4: Run the handler test and watch it pass**

Run: `node tests/archive-import-handler.js; echo "exit $?"`
Expected: `14 passed, 0 failed`, exit 0.

- [ ] **Step 5: Keep the two older round-trip suites running against the new import**

Their export half still runs the old exporter, which is replaced in Task 7. Only the import half changed: it now signs (so it needs an execute-api host and credentials) and requires an Engage caller.

In `tests/prompt-archive-roundtrip.js`, replace

```js
process.env.TABLE_NAME = TABLE;
process.env.ARCHIVE_SERVICE_URL = 'https://archive.test.invalid';
```

with

```js
process.env.TABLE_NAME = TABLE;
// The importer signs its archive calls, so it needs the execute-api host and credentials.
process.env.ARCHIVE_SERVICE_URL = 'https://archtest01.execute-api.us-east-1.amazonaws.com';
process.env.AWS_ACCESS_KEY_ID = 'AKIDPROMPTSUITE';
process.env.AWS_SECRET_ACCESS_KEY = 'prompt-suite-secret';
```

and replace

```js
const importPrompt = (archiveId) => importHandler({
  body: JSON.stringify({ selectedItems: [archiveId], importType: 'prompts' }),
});
```

with

```js
// Restoring writes Engage's library, so the caller is Engage staff acting as Engage.
const importPrompt = (archiveId) => importHandler({
  requestContext: { authorizer: { lambda: { groups: 'admins', userId: 'staff-1' } } },
  body: JSON.stringify({ selectedItems: [archiveId], importType: 'prompts' }),
});
```

In `tests/archive-export-image-roundtrip.js`, replace

```js
process.env.ARCHIVE_SERVICE_URL = 'https://archive.seibtribe.us';
```

with

```js
// The importer signs its archive calls, so it needs the execute-api host and credentials.
const BASE = 'https://archtest01.execute-api.us-east-1.amazonaws.com';
process.env.ARCHIVE_SERVICE_URL = BASE;
process.env.AWS_ACCESS_KEY_ID = 'AKIDIMAGESUITE';
process.env.AWS_SECRET_ACCESS_KEY = 'image-suite-secret';
```

Then replace `if (url === 'https://archive.seibtribe.us/archive/items' && opts && opts.method === 'POST') {` with ``if (url === `${BASE}/archive/items` && opts && opts.method === 'POST') {``, and replace ``if (url === `https://archive.seibtribe.us/archive/items/${ARCHIVE_ID}`) {`` with ``if (url === `${BASE}/archive/items/${ARCHIVE_ID}`) {``.

In the same file, replace

```js
    const importRes = await importHandler.handler({
      httpMethod: 'POST',
```

with

```js
    const importRes = await importHandler.handler({
      httpMethod: 'POST',
      requestContext: { authorizer: { lambda: { groups: 'admins', userId: 'staff-1' } } },
```

and replace `const newSetId = importBody.results.successful[0].newId;` with `const newSetId = importBody.results.successful[0].id;`.

Run: `node tests/prompt-archive-roundtrip.js; echo "exit $?"; node tests/archive-export-image-roundtrip.js; echo "exit $?"`
Expected: both exit 0. If a check in `prompt-archive-roundtrip.js` fails, read its assertion before touching it. The legacy path is meant to keep that suite's legacy import behaviour (draft status, `imported-` id, body in S3, aliases promoted, canonical game type), so a failure there is a regression in Step 3, not in the test.

- [ ] **Step 6: Run the guards the handler is subject to**

Run: `for f in tests/no-global-partition-literals.js tests/cors-allows-sent-headers.js tests/kms-grants-match-code.js; do node "$f" >/dev/null 2>&1 && echo "ok $f" || echo "FAIL $f"; done`
Expected: three `ok` lines. (The import function already holds `kms:Decrypt`.)

- [ ] **Step 7: Commit**

```bash
git add lambda-functions/admin/import-from-archive.js tests/archive-import-handler.js tests/prompt-archive-roundtrip.js tests/archive-export-image-roundtrip.js
git commit -m "Import restores each archive item by what it contains, and says what went live

Snapshots restore through the new restore module under their original ids. Items written
before snapshots still restore through the old path, now without the Imported and Exported
suffixes, and a legacy set lands inactive because it never recorded its status. Only Engage
staff acting as Engage may restore, every archive call is signed, one bad item no longer
stops the batch, and the response lists every set that is newly live for every
organisation.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 7: Export writes snapshots — and the round trip is proven end to end

**Files:**
- Modify (rewrite whole file): `lambda-functions/admin/export-to-archive.js`
- Test (new): `tests/archive-set-snapshot-roundtrip.js`, `tests/archive-scope-boundary.js`
- Test (rewrite onto the harness): `tests/prompt-archive-roundtrip.js`, `tests/archive-export-image-roundtrip.js`, `tests/export-to-archive-read.js`
- Test (edit): `tests/archive-title-header-safety.js`
- Modify: `template-clean.yaml`, adding `kms:Decrypt` to `AdminExportToArchiveFunction` only (the export now requires `archive-snapshot.js`, which requires `tenant-crypto.js`; `tests/kms-grants-match-code.js` fails otherwise). All other template work is Task 9.

**Interfaces:**
- Consumes: Task 1 `uploadItem`; Task 2 `currentTier`, `findCiphertext`, `buildSetEnvelope`, `buildPromptEnvelope`, `envelopeTags`, `rowCarriesPromptText`; Task 3 `copyMediaOut`; Task 6 import handler; existing `set-version` (`setRef`, `setMetadataKey`, `resolvePartitionFromMeta`, `queryPartition`), `prompt-access.promptKey`, `archive-prompt-link.promptLinkTag`.
- Produces: `POST /admin/export-to-archive` with body `{ selectedItems: Array<string | {scope, id}>, exportType: 'questionsets'|'prompts' }`. A bare string means platform.
  - `403` unless `canManageScope(event, PLATFORM)`; `400` for a bad body
  - `200 { message, results: { successful, failed, totalRequested } }`
  - a set in `successful`: `{ id, scope, name, archiveId, snapshotId, questionsCount, media: { copied, missing } }`
  - a prompt in `successful`: `{ id, scope: 'platform', name, archiveId, gameType }`
  - `failed`: `{ id, scope, refused?: true, error }`, plus `name` and `step` (`'config'` | `'s3-read-body'`) for prompt body failures
  - writes nothing to the main table

- [ ] **Step 1: Write the failing round-trip suite**

Create `tests/archive-set-snapshot-roundtrip.js`:

```js
/**
 * A QUESTION SET SURVIVES THE ARCHIVE — every field, both directions, twice.
 *
 * spec §6 items 2–5, against the list in spec §2.1 of what a restore used to lose: poll
 * options, trivia E and F, uploaded images, every set setting, the active flag, the set's id
 * and its name. The fixtures carry all of them. The REAL export handler archives them, the
 * tier is wiped, and the REAL import handler puts them back.
 *
 * // rejects: every loss in spec §2.1; a second trip that differs from the first; an export
 * //          that writes to the main table; archiving a superseded version; a restore that
 * //          overwrites the version it replaces or an image that already exists.
 */
const h = require('./helpers/archive-harness');
const assert = require('assert');
const path = require('path');

const REPO = path.join(__dirname, '..');
const SHARED = path.join(REPO, 'lambda-functions/admin/shared');
const tenant = require(path.join(SHARED, 'tenant.js'));
const { setMetadataKey, setPartition, resolveSetPartition } = require(path.join(SHARED, 'set-version.js'));
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const exportHandler = require(path.join(REPO, 'lambda-functions/admin/export-to-archive.js')).handler;
const importHandler = require(path.join(REPO, 'lambda-functions/admin/import-from-archive.js')).handler;

const { check, finish } = h.checker();
const parse = (res) => ({ status: res.statusCode, body: JSON.parse(res.body) });
const exportSets = async (...refs) => parse(await exportHandler(h.adminEvent({ selectedItems: refs, exportType: 'questionsets' })));
const importItems = async (...ids) => parse(await importHandler(h.adminEvent({ selectedItems: ids })));
const platform = (setId) => ({ scope: tenant.PLATFORM, setId });
const metaRow = (setId) => h.get(setMetadataKey(platform(setId)).PK, `SET#${setId}`);
const envelopeOf = (archiveId) => JSON.parse(h.archive.get(archiveId).content);
const MEDIA = process.env.MEDIA_BUCKET;

/** Wipe the tier (table and media bucket), keeping only what the archive holds. */
function loseTheTier() {
  h.table.clear();
  for (const key of [...h.objects.keys()]) if (key.startsWith(`${MEDIA}/`)) h.objects.delete(key);
}

const POLL = {
  setId: 'pulse',
  version: 2,
  meta: {
    name: 'Pulse Check', description: 'How the team is doing', engagementType: 'poll', customInstruction: 'Be kind',
    aiContextInstruction: 'Quarterly check-in', personaId: 'persona-7', roundNoun: 'Pulse', roundKind: 'produce',
    roundKindBrief: 'Say it plainly', Quickstart: true, isAIGenerated: false, promptId: 'p-pulse', active: false,
    createdBy: 'author-9', createdByName: 'Nine', createdAt: '2026-01-01T00:00:00.000Z',
    questionCount: 2, categoryCount: 2, hasImages: true, versions: [{ version: 1 }, { version: 2 }],
  },
  rows: [
    { SK: 'CATEGORY#c001', Name: 'Zeta', Description: 'Zeta questions', QuestionCount: 1 },
    { SK: 'CATEGORY#c002', Name: 'Alpha', Description: 'Alpha questions', QuestionCount: 1 },
    { SK: 'QUESTION#c001#001', Title: 'How is your week?', Detail: 'Honestly', Category: 'Zeta', options: ['Great', 'Fine', 'Rough'], allowMultiple: true, Tags: ['mood'], Image: 'sets/pulse/chart.png', Active: true },
    { SK: 'QUESTION#c002#001', Title: 'Anything blocking you?', Detail: '', Category: 'Alpha', options: ['Yes', 'No'], allowMultiple: false, Tags: [], Image: '', Active: true },
  ],
};
const TRIVIA = {
  setId: 'spacequiz',
  version: null,
  meta: { name: 'Space Quiz', description: 'Planets', engagementType: 'trivia', active: true, isAIGenerated: false },
  rows: [
    { SK: 'CATEGORY#c001', Name: 'Planets', QuestionCount: 1 },
    { SK: 'QUESTION#c001#001', Title: 'Largest planet?', Detail: '', Category: 'Planets', optionA: 'Mars', optionB: 'Venus', optionC: 'Earth', optionD: 'Mercury', optionE: 'Jupiter', optionF: 'Saturn', correctAnswer: 'OptionE', difficulty: 'hard', points: 10, AnswerDetails: 'Jupiter is eleven Earths wide', Image: 'https://upload.wikimedia.org/jupiter.jpg' },
  ],
};
const ART = {
  setId: 'artset',
  version: 1,
  meta: { name: 'Mystery Art', description: 'An art-title round', engagementType: 'call-and-answer', active: true },
  rows: [
    { SK: 'CATEGORY#c001', Name: 'Art', QuestionCount: 1 },
    { SK: 'QUESTION#c001#001', Title: 'A puzzling smile', Detail: '', Category: 'Art', Image: '/assets/art/the-enigmatic-smile.jpg', AnswerDetails: 'The Enigmatic Smile — painted 1900s', CustomInstructions: '' },
  ],
};

(async () => {
  console.log('1. export');
  h.reset();
  for (const set of [POLL, TRIVIA, ART]) h.seedSet(set);
  h.put({ PK: setPartition(platform('pulse'), 1), SK: 'QUESTION#c001#001', Title: 'Superseded' });
  h.objects.set(`${MEDIA}/sets/pulse/chart.png`, { Body: 'PNG-CHART', ContentType: 'image/png' });
  h.seedPrompt({ promptId: 'p-pulse', row: { name: 'Workie - Pulse' } });
  const writesBefore = h.writes.length;
  let exported = await exportSets({ scope: 'platform', id: 'pulse' }, 'spacequiz', { scope: 'platform', id: 'artset' });
  const [pollItem, triviaItem, artItem] = exported.body.results.successful;

  await check('three snapshots, one per set, and no failures', () => {
    assert.strictEqual(exported.status, 200);
    assert.deepStrictEqual(exported.body.results.failed, []);
    assert.deepStrictEqual(exported.body.results.successful.map((s) => s.id), ['pulse', 'spacequiz', 'artset']);
  });
  await check('a bare id is read as the platform library', () => assert.strictEqual(triviaItem.scope, 'platform'));
  await check('the export wrote nothing to the main table', () => assert.strictEqual(h.writes.length, writesBefore));
  await check('the active version is what was archived, not the superseded one', () => {
    const env = envelopeOf(pollItem.archiveId);
    assert.strictEqual(env.exportedFrom.version, 2);
    assert.ok(!env.rows.some((row) => row.Title === 'Superseded'));
  });
  await check('the uploaded image went to the archive; the remote URL and the repo asset did not', () => {
    const env = envelopeOf(pollItem.archiveId);
    assert.deepStrictEqual(env.media.map((m) => m.key), ['sets/pulse/chart.png']);
    assert.strictEqual(h.objects.get(`${process.env.ARCHIVE_BUCKET}/${env.media[0].archiveKey}`).Body, 'PNG-CHART');
    assert.deepStrictEqual(envelopeOf(triviaItem.archiveId).media, []);
    assert.deepStrictEqual(envelopeOf(artItem.archiveId).media, []);
    assert.deepStrictEqual(pollItem.media, { copied: 1, missing: [] });
  });
  await check('the linked prompt travels by name as well as by id', () => {
    assert.deepStrictEqual(envelopeOf(pollItem.archiveId).links, { promptName: 'Workie - Pulse' });
    assert.ok(h.archive.get(pollItem.archiveId).item.Tags.includes('prompt:Workie - Pulse'));
  });
  await check('the item is titled with the set name, no tier suffix, and tagged with where it came from', () => {
    const { item } = h.archive.get(pollItem.archiveId);
    assert.strictEqual(item.Title, 'Pulse Check');
    for (const tag of ['dev', 'schema:engage.set/1', 'scope:platform', 'source:platform/pulse', 'poll', 'questions:2']) {
      assert.ok(item.Tags.includes(tag), `missing tag ${tag}`);
    }
  });

  console.log('\n2. lose the tier, restore everything');
  loseTheTier();
  h.seedPrompt({ promptId: 'p-pulse', row: { name: 'Workie - Pulse' } });
  let restored = await importItems(pollItem.archiveId, triviaItem.archiveId, artItem.archiveId);

  await check('all three come back under their original ids', () => {
    assert.deepStrictEqual(restored.body.results.failed, []);
    assert.deepStrictEqual(
      restored.body.results.successful.map((r) => [r.id, r.mode, r.version]),
      [['pulse', 'created', 1], ['spacequiz', 'created', 1], ['artset', 'created', 1]],
    );
  });
  for (const set of [POLL, TRIVIA, ART]) {
    // eslint-disable-next-line no-await-in-loop
    await check(`${set.setId}: every question and category attribute, in stored order`, () => {
      assert.deepStrictEqual(h.rows(setPartition(platform(set.setId), 1)).map(({ PK, ...rest }) => rest), set.rows);
    });
    // eslint-disable-next-line no-await-in-loop
    await check(`${set.setId}: every setting, the status and the creator, with no suffix`, () => {
      const row = metaRow(set.setId);
      for (const [attr, value] of Object.entries(set.meta)) {
        if (attr !== 'versions') assert.deepStrictEqual(row[attr], value, attr);
      }
    });
  }
  await check('the deactivated set stayed deactivated; only the two active sets are reported as live', () => {
    assert.strictEqual(metaRow('pulse').active, false);
    assert.deepStrictEqual(restored.body.becameActive.map((s) => s.id), ['spacequiz', 'artset']);
  });
  await check('the image is back in the tier media bucket', () => {
    assert.strictEqual(h.objects.get(`${MEDIA}/sets/pulse/chart.png`).Body, 'PNG-CHART');
    assert.deepStrictEqual(restored.body.media, { copied: 1, kept: 0, missing: [] });
  });

  console.log('\n3. a second round trip is identical to the first');
  const first = envelopeOf(pollItem.archiveId);
  exported = await exportSets({ scope: 'platform', id: 'pulse' });
  const second = envelopeOf(exported.body.results.successful[0].archiveId);
  const VOLATILE = ['restoredFrom', 'restoredAt', 'restoredBy', 'updatedAt', 'activeVersion', 'versions'];
  const stable = (meta) => Object.fromEntries(Object.entries(meta).filter(([k]) => !VOLATILE.includes(k)));
  await check('the rows are identical', () => assert.deepStrictEqual(second.rows, first.rows));
  await check('the metadata is identical apart from the restore bookkeeping', () => assert.deepStrictEqual(stable(second.metadata), stable(first.metadata)));

  console.log('\n4. restoring over a set that still exists');
  h.put({ ...metaRow('pulse'), name: 'Pulse Check (edited)', personaId: 'persona-other', ...setMetadataKey(platform('pulse')) });
  restored = await importItems(pollItem.archiveId);
  const now = metaRow('pulse');
  await check('it becomes a new version and is made current', () => {
    assert.deepStrictEqual(restored.body.results.successful.map((r) => [r.mode, r.version]), [['new-version', 2]]);
    assert.strictEqual(now.activeVersion, 2);
    assert.deepStrictEqual(now.versions.map((v) => v.version), [1, 2]);
  });
  await check('the edited settings are back to the snapshot', () => {
    assert.deepStrictEqual([now.name, now.personaId], ['Pulse Check', 'persona-7']);
  });
  await check('a game pinned to the version it replaced still reads that version', async () => {
    const resolved = await resolveSetPartition(DynamoDBDocumentClient.from(), h.TABLE, 'pulse', 1);
    assert.strictEqual(resolved.pk, setPartition(platform('pulse'), 1));
    assert.strictEqual(h.rows(resolved.pk).length, 4);
  });
  await check('the image that already existed was kept, not overwritten', () => {
    assert.deepStrictEqual(restored.body.media, { copied: 0, kept: 1, missing: [] });
  });

  console.log('\n5. a public set is archived and comes back as a house copy');
  h.reset();
  h.seedSet({
    scope: 'public', setId: 'acme-retro', version: 1,
    meta: { name: 'Team Retro', engagementType: 'call-and-answer', active: true, scope: 'public', orgId: '', sourceOrgId: 'acme', sourceSetId: 'retro', publishedAt: '2026-09-01T00:00:00.000Z' },
    rows: [{ SK: 'CATEGORY#c001', Name: 'Went well' }, { SK: 'QUESTION#c001#001', Title: 'What worked?', Category: 'Went well' }, { SK: 'REVIEW', status: 'approved' }],
  });
  exported = await exportSets({ scope: 'public', id: 'acme-retro' });
  const publicItem = exported.body.results.successful[0];
  await check('it exports, tagged as public, without its review row', () => {
    assert.ok(h.archive.get(publicItem.archiveId).item.Tags.includes('scope:public'));
    assert.deepStrictEqual(envelopeOf(publicItem.archiveId).rows.map((r) => r.SK), ['CATEGORY#c001', 'QUESTION#c001#001']);
  });
  loseTheTier();
  restored = await importItems(publicItem.archiveId);
  await check("it is restored into Engage's library, with its provenance nested rather than stamped", () => {
    const house = metaRow('acme-retro');
    assert.ok(house, 'no platform row');
    for (const attr of ['scope', 'orgId', 'sourceOrgId', 'publishedAt']) assert.strictEqual(house[attr], undefined, attr);
    assert.deepStrictEqual([house.restoredFrom.scope, house.restoredFrom.sourceOrgId], ['public', 'acme']);
  });

  console.log('\n6. export details');
  h.reset();
  h.seedSet({ setId: 'gappy', version: 1, meta: { name: 'Gappy', active: true }, rows: [{ SK: 'CATEGORY#c001', Name: 'A' }, { SK: 'QUESTION#c001#001', Title: 'Lost image', Category: 'A', Image: 'sets/gappy/gone.png' }] });
  exported = await exportSets('gappy');
  await check('a missing image is reported, and the backup still happens', () => {
    assert.strictEqual(exported.body.results.successful.length, 1);
    assert.deepStrictEqual(exported.body.results.successful[0].media, { copied: 0, missing: ['sets/gappy/gone.png'] });
  });
  h.reset();
  const bulky = Array.from({ length: 600 }, (_, i) => ({ SK: `QUESTION#c001#${String(i).padStart(3, '0')}`, Title: 'x'.repeat(10000), Category: 'A' }));
  h.seedSet({ setId: 'huge', version: 1, meta: { name: 'Huge' }, rows: [{ SK: 'CATEGORY#c001', Name: 'A' }, ...bulky] });
  exported = await exportSets('huge');
  await check("a snapshot over the archive's request limit is refused by name, before any upload", () => {
    assert.strictEqual(exported.body.results.successful.length, 0);
    assert.match(exported.body.results.failed[0].error, /6 MB/);
    assert.strictEqual(h.archive.size, 0);
  });

  finish();
})().catch((e) => { console.error('harness error:', e); process.exit(2); });
```

- [ ] **Step 2: Write the failing scope-boundary suite**

Create `tests/archive-scope-boundary.js`:

```js
/**
 * THE ARCHIVE HOLDS ENGAGE AND PUBLIC CONTENT ONLY — enforced by rule, not by accident.
 *
 * spec §2.3 and §6.1. Export used to refuse org content only because it read the platform key
 * and an org id was therefore "not found". Import wrote to platform unconditionally, and an
 * Engage admin standing in a customer team could reach both routes.
 *
 * // rejects: an org set or prompt being read or uploaded; an org-scoped or encrypted envelope
 * //          being restored; either route answering a host or an admin inside an org; any
 * //          restore writing an ORG# or PUBLIC# key.
 */
const h = require('./helpers/archive-harness');
const assert = require('assert');
const path = require('path');

const REPO = path.join(__dirname, '..');
const snap = require(path.join(REPO, 'lambda-functions/admin/shared/archive-snapshot.js'));
const exportHandler = require(path.join(REPO, 'lambda-functions/admin/export-to-archive.js')).handler;
const importHandler = require(path.join(REPO, 'lambda-functions/admin/import-from-archive.js')).handler;

const { check, finish } = h.checker();
const parse = (res) => ({ status: res.statusCode, body: JSON.parse(res.body) });
const CIPHERTEXT = { v: 1, iv: 'aQ==', tag: 'dA==', ct: 'Yw==' };
const ORG_MESSAGE = 'Organisation content is not archived: it is encrypted per organisation.';
const setEnvelope = (scope, setId, metadata) => snap.buildSetEnvelope({
  tier: 'dev', scope, setId, version: 1, metadata,
  rows: [{ SK: 'CATEGORY#c001', Name: 'A' }, { SK: 'QUESTION#c001#001', Title: 'Q', Category: 'A' }],
  media: [], snapshotId: 's', exportedAt: '2026-09-14T09:00:00.000Z',
});
const seedEnvelope = (envelope) => h.seedArchiveItem({
  contentType: envelope.schema === snap.PROMPT_SCHEMA ? 'prompt' : 'questionset',
  title: 'Seeded', tags: snap.envelopeTags(envelope), content: JSON.stringify(envelope),
});

(async () => {
  console.log('1. export refuses organisation content by name, before reading it');
  h.reset();
  h.seedSet({ scope: 'org', orgId: 'acme', setId: 'retro', version: 1, meta: { name: 'Acme Retro', scope: 'org', orgId: 'acme' }, rows: [{ SK: 'QUESTION#c001#001', Title: 'Secret' }] });
  let res = parse(await exportHandler(h.adminEvent({ selectedItems: [{ scope: 'org', id: 'retro' }], exportType: 'questionsets' })));
  await check('an org set is refused with the reason, and nothing is uploaded or even read', () => {
    assert.deepStrictEqual(res.body.results.failed, [{ id: 'retro', scope: 'org', refused: true, error: ORG_MESSAGE }]);
    assert.strictEqual(h.archive.size, 0);
    assert.ok(h.reads.every((r) => !String(r.PK).startsWith('ORG#')), JSON.stringify(h.reads));
  });
  res = parse(await exportHandler(h.adminEvent({ selectedItems: [{ scope: 'org', id: 'p1' }], exportType: 'prompts' })));
  await check('an org prompt is refused the same way', () => {
    assert.deepStrictEqual(res.body.results.failed, [{ id: 'p1', scope: 'org', refused: true, error: ORG_MESSAGE }]);
  });
  res = parse(await exportHandler(h.adminEvent({ selectedItems: [{ scope: 'public', id: 'p1' }], exportType: 'prompts' })));
  await check('a public prompt is refused: nothing writes one', () => assert.match(res.body.results.failed[0].error, /Public prompts/));

  console.log('\n2. encrypted content is never archived and never restored');
  h.reset();
  h.seedSet({ scope: 'public', setId: 'acme-sealed', version: 1, meta: { name: CIPHERTEXT, scope: 'public', sourceOrgId: 'acme' }, rows: [{ SK: 'QUESTION#c001#001', Title: 'Q' }] });
  res = parse(await exportHandler(h.adminEvent({ selectedItems: [{ scope: 'public', id: 'acme-sealed' }], exportType: 'questionsets' })));
  await check('a public set whose name is ciphertext is refused on export', () => {
    assert.strictEqual(res.body.results.failed[0].refused, true);
    assert.match(res.body.results.failed[0].error, /encrypted/);
    assert.strictEqual(h.archive.size, 0);
  });
  h.reset();
  const orgItem = seedEnvelope(setEnvelope('org', 'retro', { name: 'Acme Retro' }));
  const sealedItem = seedEnvelope(setEnvelope('public', 'acme-sealed', { name: 'Sealed', aiContextInstruction: CIPHERTEXT }));
  res = parse(await importHandler(h.adminEvent({ selectedItems: [orgItem, sealedItem] })));
  await check('an org-scoped or encrypted backup is refused on import, and nothing is written', () => {
    assert.deepStrictEqual(res.body.results.failed.map((f) => [f.archiveId, f.refused]), [[orgItem, true], [sealedItem, true]]);
    assert.strictEqual(res.body.results.failed[0].error, ORG_MESSAGE);
    assert.deepStrictEqual(h.writes, []);
  });

  console.log('\n3. only Engage staff acting as Engage may use either route');
  for (const [who, make] of [['a host', h.hostEvent], ['an Engage admin inside a customer team', (body) => h.orgAdminEvent('acme', body)]]) {
    h.reset();
    // eslint-disable-next-line no-await-in-loop
    const exported = parse(await exportHandler(make({ selectedItems: ['anything'], exportType: 'questionsets' })));
    // eslint-disable-next-line no-await-in-loop
    const imported = parse(await importHandler(make({ selectedItems: ['arc-1'] })));
    // eslint-disable-next-line no-await-in-loop
    await check(`${who} is refused by both, before the archive is touched`, () => {
      assert.deepStrictEqual([exported.status, imported.status], [403, 403]);
      assert.strictEqual(h.fetchLog.length, 0);
    });
  }

  console.log('\n4. no restore ever writes into an organisation or the public library');
  h.reset();
  const items = [
    seedEnvelope(setEnvelope('platform', 'house', { name: 'House', active: false })),
    seedEnvelope(setEnvelope('public', 'acme-shared', { name: 'Shared', scope: 'public', sourceOrgId: 'acme', active: false })),
    seedEnvelope(snap.buildPromptEnvelope({ tier: 'dev', scope: 'platform', promptId: 'p9', metadata: { name: 'P9', gameType: 'trivia', status: 'active' }, body: { instructions: 'x' }, exportedAt: 't' })),
    h.seedArchiveItem({ contentType: 'questionset', title: 'Legacy (dev)', tags: ['dev'], content: 'Category,Title\nA,Q' }),
  ];
  res = parse(await importHandler(h.adminEvent({ selectedItems: items })));
  await check('four mixed items restore, and every key written is a platform key', () => {
    assert.deepStrictEqual(res.body.results.failed, []);
    assert.strictEqual(res.body.results.successful.length, 4);
    const leaked = h.writes.filter((w) => /^(ORG#|PUBLIC#)/.test(String(w.PK)));
    assert.deepStrictEqual(leaked, []);
  });

  finish();
})().catch((e) => { console.error('harness error:', e); process.exit(2); });
```

- [ ] **Step 3: Run both new suites and watch them fail**

Run: `node tests/archive-set-snapshot-roundtrip.js; echo "exit $?"; node tests/archive-scope-boundary.js; echo "exit $?"`
Expected: both exit 1. The current exporter sends unsigned requests, which the harness answers with 403, and it writes CSV rather than envelopes, so the export checks fail. The import-only checks in the boundary suite (section 2's second check, section 4) may already pass. That is fine, because the import was rewritten in Task 6.

- [ ] **Step 4: Rewrite the export handler**

Replace the whole of `lambda-functions/admin/export-to-archive.js` with the following. The `describeTitleHazard` function and its comment are kept verbatim from the current file (lines 98–137), because `tests/archive-title-header-safety.js` pins its wording.

```js
/**
 * BACK UP ENGAGE AND PUBLIC CONTENT TO THE SHARED ARCHIVE — as full-fidelity snapshots.
 *
 * docs/superpowers/specs/2026-09-14-archive-full-fidelity-design.md §4.2. What used to be
 * written here was a CSV with a fixed column set. Everything it had no column for (poll
 * options, trivia E/F, images, every set setting, the active flag) was lost on every trip.
 * Each item is now one JSON envelope (shared/archive-snapshot.js) copied wholesale from its
 * rows, with the images those rows point at copied beside it (shared/archive-media.js).
 *
 * WHO: Engage staff acting as Engage, via canManageScope(event, PLATFORM), the same interlock
 * that guards writing Engage's library. The route's `admins` gate alone lets an admin standing
 * inside a customer team reach it.
 *
 * WHAT: platform and public content. Organisation content is refused BY NAME before any read,
 * because it is encrypted per organisation and the owner decided not to archive ciphertext.
 * Anything else carrying an encrypted value is refused too, wherever the value sits. A bare id
 * is platform, the house rule (set-version.js setRef), which is what the prompt manager's
 * "Copy to archive" sends.
 *
 * WRITES NOTHING TO THE MAIN TABLE. The `PK: 'ARCHIVE'` rows this used to write were read by
 * nothing; the archive service's own table is the index.
 */
const crypto = require('crypto');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const tenant = require('./shared/tenant');
const { setRef, setMetadataKey, resolvePartitionFromMeta, queryPartition } = require('./shared/set-version');
const { promptKey } = require('./shared/prompt-access');
const { promptLinkTag } = require('./shared/archive-prompt-link');
const archive = require('./shared/archive-client');
const snap = require('./shared/archive-snapshot');
const { copyMediaOut } = require('./shared/archive-media');

const db = DynamoDBDocumentClient.from(new DynamoDBClient());
const s3Client = new S3Client({});

/** The archive API is API Gateway in front of Lambda, whose request payload limit is 6 MB. */
const MAX_ITEM_BYTES = 5.5 * 1024 * 1024;
const ORG_REFUSAL = 'Organisation content is not archived: it is encrypted per organisation.';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Engage-Org',
};
const respond = (statusCode, body) => ({ statusCode, headers: corsHeaders, body: JSON.stringify(body) });

exports.handler = async (event) => {
  if (event && event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders, body: '' };
  if (!tenant.canManageScope(event, tenant.PLATFORM)) {
    return respond(403, { error: "The archive backs up Engage's library. Switch to Engage (no organisation selected) to use it." });
  }
  let payload;
  try {
    payload = JSON.parse((event && event.body) || '{}');
  } catch {
    return respond(400, { error: 'Request body is not valid JSON.' });
  }
  const { selectedItems, exportType } = payload;
  if (!Array.isArray(selectedItems) || selectedItems.length === 0) {
    return respond(400, { error: 'selectedItems array is required and must not be empty' });
  }
  if (!['questionsets', 'prompts'].includes(exportType)) {
    return respond(400, { error: 'exportType must be either "questionsets" or "prompts"' });
  }

  const results = { successful: [], failed: [], totalRequested: selectedItems.length };
  const tier = snap.currentTier();
  for (const entry of selectedItems) {
    const ref = selectionRef(entry);
    try {
      if (exportType === 'questionsets') await exportSet(ref, tier, results);
      else await exportPrompt(ref, tier, results);
    } catch (error) {
      console.error(`❌ export of ${ref.scope}/${ref.id} failed:`, error);
      results.failed.push({ id: ref.id, scope: ref.scope, error: error.message });
    }
  }
  console.log(`✅ Export completed. Success: ${results.successful.length}, Failed: ${results.failed.length}`);
  return respond(200, { message: `Export completed. ${results.successful.length} items exported successfully.`, results });
};

/** `{scope, id}` from one selection entry. A bare id, or an object with no scope, is platform. */
function selectionRef(entry) {
  if (typeof entry === 'string') return { scope: tenant.PLATFORM, id: entry.trim() };
  if (entry && typeof entry === 'object') {
    return { scope: String(entry.scope || '').trim().toLowerCase() || tenant.PLATFORM, id: String(entry.id || '').trim() };
  }
  return { scope: '', id: '' };
}

const refuse = (results, ref, error) => results.failed.push({ id: ref.id, scope: ref.scope, refused: true, error });

/*
  NAME THE EM DASH, BECAUSE THE ARCHIVE SERVICE CANNOT.

  On 2026-08-15 the four TRIVIA prompts for the demo quiz sets each failed this
  export with a flat 500 "Failed to upload archive item" while the four
  call-and-answer prompts in the same batch succeeded. The trivia prompts are
  named "Workie — <thing>" (U+2014 EM DASH); the others "Workie - <thing>"
  (ASCII hyphen). The archive service puts the title in S3 user metadata, which
  is an HTTP header, and Node throws ERR_INVALID_CHAR on any character outside
  /[\t\x20-\x7e\x80-\xff]/ — which an em dash is — before the request leaves the
  process. See the long note in lambda-functions/archive/upload-archive.js,
  where it is actually fixed.

  This exporter cannot fix that: the archive service is a separately deployed,
  SHARED stack (scripts/deploy-archive.sh, engage2-archive-service) that all
  three tiers talk to, so a patched exporter can still meet an unpatched
  archive. What it can do is stop the diagnosis costing another afternoon —
  when an upload fails and the title carries a character known to break that
  path, say so, with the character and its code point.

  Deliberately NOT a pre-flight rejection and NOT a sanitiser. Refusing the
  export would block a legitimate title, and rewriting the title would silently
  alter what the user wrote. This only annotates a failure that already happened.
*/
function describeTitleHazard(title) {
  // Node's own rule, from lib/_http_common.js checkInvalidHeaderChar. Matching
  // it exactly rather than testing for "> U+00FF" so that a stray newline or
  // control character — which breaks the request in precisely the same way and
  // is far harder to see in a title — is named too.
  const offenders = [...String(title || '')]
    .filter(ch => /[^\t\x20-\x7e\x80-\xff]/.test(ch))
    .map(ch => `${JSON.stringify(ch)} (U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')})`);
  if (offenders.length === 0) return '';
  const unique = [...new Set(offenders)];
  return ` — NOTE: the title contains ${unique.join(', ')}, which Node refuses to put in an HTTP header. `
    + `The archive service copies the title into S3 user metadata, and user metadata is sent as the `
    + `x-amz-meta-* request headers, so this throws ERR_INVALID_CHAR inside the SDK and surfaces as `
    + `exactly this 500. If that is the cause, the fix is in lambda-functions/archive/upload-archive.js `
    + `and the archive service needs redeploying (scripts/deploy-archive.sh) — the title itself is fine.`;
}

async function upload(item, label) {
  const bytes = Buffer.byteLength(JSON.stringify(item), 'utf8');
  if (bytes > MAX_ITEM_BYTES) {
    throw new Error(`${label} is ${(bytes / 1048576).toFixed(1)} MB as a snapshot, over the archive service's `
      + '6 MB request limit, so it was not archived.');
  }
  try {
    return await archive.uploadItem(item);
  } catch (error) {
    throw new Error(`Archive upload failed for ${label}: ${error.message}${describeTitleHazard(item.title)}`);
  }
}

async function exportSet(ref, tier, results) {
  if (ref.scope === tenant.ORG) return refuse(results, ref, ORG_REFUSAL);
  if (ref.scope !== tenant.PLATFORM && ref.scope !== tenant.PUBLIC) return refuse(results, ref, `Unknown library ${JSON.stringify(ref.scope)}.`);
  if (!ref.id) return refuse(results, ref, 'No set id was given.');

  const sref = setRef({ scope: ref.scope, setId: ref.id });
  const found = await db.send(new GetCommand({ TableName: process.env.TABLE_NAME, Key: setMetadataKey(sref) }));
  const meta = found && found.Item;
  if (!meta) {
    results.failed.push({ id: ref.id, scope: ref.scope, error: `Question set not found in the ${ref.scope} library` });
    return undefined;
  }

  const resolved = resolvePartitionFromMeta(sref, meta, null);
  /*
    QUERY, PAGINATED: every row of the resolved partition, following LastEvaluatedKey to the
    end. This was once a Scan with a filter, which read one 1 MB page of the whole table and
    silently exported nothing for a set whose rows sat outside it
    (tests/export-to-archive-read.js). queryPartition is the shared paginated read.
  */
  const { items: rows } = await queryPartition(db, process.env.TABLE_NAME, resolved.pk);
  const questionCount = rows.filter((row) => String(row.SK).startsWith('QUESTION#')).length;
  if (questionCount === 0) {
    results.failed.push({
      id: ref.id,
      scope: ref.scope,
      error: `No questions found in partition ${resolved.pk}. The set metadata says `
        + `${meta.questionCount ?? 'an unknown number of'} questions, so this is a read problem, not an empty set.`,
    });
    return undefined;
  }

  const ciphertext = snap.findCiphertext({ metadata: meta, rows });
  if (ciphertext.length > 0) {
    return refuse(results, ref, `This set carries encrypted values (${ciphertext.slice(0, 3).join(', ')}), `
      + 'which cannot be read outside their organisation, so it is not archived.');
  }

  let promptName = '';
  if (meta.promptId) {
    const linked = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME, Key: promptKey({ scope: tenant.PLATFORM, promptId: meta.promptId }),
    }));
    promptName = linked && linked.Item && typeof linked.Item.name === 'string' ? linked.Item.name : '';
  }

  const snapshotId = crypto.randomUUID();
  const { media, missing } = await copyMediaOut(s3Client, {
    mediaBucket: process.env.MEDIA_BUCKET, archiveBucket: process.env.ARCHIVE_BUCKET, snapshotId, rows,
  });
  const envelope = snap.buildSetEnvelope({
    tier, scope: ref.scope, setId: ref.id, version: resolved.version, metadata: meta, rows, media,
    snapshotId, exportedAt: new Date().toISOString(), promptName,
  });
  const item = {
    title: meta.name || ref.id,
    description: meta.description || '',
    content: JSON.stringify(envelope),
    contentType: 'questionset',
    category: meta.engagementType || 'general',
    fileName: `${ref.id}.snapshot.json`,
    tags: snap.envelopeTags(envelope, [
      meta.engagementType || 'call-and-answer',
      `questions:${questionCount}`,
      ...(meta.isAIGenerated ? ['ai-generated'] : []),
      ...(promptName ? [promptLinkTag(promptName)] : []),
    ]),
  };
  const uploaded = await upload(item, `"${meta.name}" (${ref.id})`);
  results.successful.push({
    id: ref.id, scope: ref.scope, name: meta.name, archiveId: uploaded.archiveId, snapshotId,
    questionsCount: questionCount, media: { copied: media.length, missing },
  });
  return undefined;
}

async function exportPrompt(ref, tier, results) {
  if (ref.scope === tenant.ORG) return refuse(results, ref, ORG_REFUSAL);
  if (ref.scope === tenant.PUBLIC) return refuse(results, ref, 'Public prompts are not archived: nothing in this product writes public prompts.');
  if (ref.scope !== tenant.PLATFORM) return refuse(results, ref, `Unknown library ${JSON.stringify(ref.scope)}.`);
  if (!ref.id) return refuse(results, ref, 'No prompt id was given.');
  const promptId = ref.id;

  const found = await db.send(new GetCommand({ TableName: process.env.TABLE_NAME, Key: promptKey({ scope: tenant.PLATFORM, promptId }) }));
  const prompt = found && found.Item;
  if (!prompt) {
    results.failed.push({ id: promptId, scope: ref.scope, error: 'AI prompt not found' });
    return undefined;
  }

  /*
    A PROMPT IS A TWO-STORE RECORD: the row, and the body in AI_PROMPTS_BUCKET at `s3Key`. An
    unreadable body is a named failure, never an archived empty shell (338af103). The one
    exception is a prompt whose text lives ON the row (the gen-* rows, written without an
    s3Key). The row IS that prompt, so it is archived with `body: null`.
  */
  let body = null;
  if (prompt.s3Key) {
    if (!process.env.AI_PROMPTS_BUCKET) {
      results.failed.push({
        id: promptId, name: prompt.name, step: 'config',
        error: 'AI_PROMPTS_BUCKET is not set on the export function, so no prompt body can be read. '
          + 'This is a deployment fault, not a problem with this prompt: every prompt in this run will '
          + 'fail the same way. Redeploy with AI_PROMPTS_BUCKET and an S3 read policy on the AI prompts '
          + 'bucket (template-clean.yaml, AdminExportToArchiveFunction).',
      });
      return undefined;
    }
    try {
      const response = await s3Client.send(new GetObjectCommand({ Bucket: process.env.AI_PROMPTS_BUCKET, Key: prompt.s3Key }));
      body = JSON.parse(await response.Body.transformToString());
      if (!body || typeof body !== 'object' || Object.keys(body).length === 0) {
        throw new Error(`body parsed to ${JSON.stringify(body)} — no fields`);
      }
    } catch (s3Error) {
      results.failed.push({
        id: promptId, name: prompt.name, step: 's3-read-body',
        error: `Could not read the prompt body at s3://${process.env.AI_PROMPTS_BUCKET}/${prompt.s3Key} `
          + `(${s3Error.name}: ${s3Error.message}). The DynamoDB pointer exists but its body does not, `
          + 'so this is a read problem, not an empty prompt — archiving it would have stored a hollow '
          + 'record and called it a success.',
      });
      return undefined;
    }
  } else if (!snap.rowCarriesPromptText(prompt)) {
    results.failed.push({
      id: promptId, name: prompt.name, step: 's3-read-body',
      error: `Prompt ${promptId} ("${prompt.name}") has no s3Key on its DynamoDB row and no text on the row itself, `
        + 'so there is nothing to archive. Archiving it would store an empty prompt and report success. '
        + 'This is a broken record, not an empty prompt.',
    });
    return undefined;
  }

  const ciphertext = snap.findCiphertext({ metadata: prompt, body });
  if (ciphertext.length > 0) {
    return refuse(results, ref, `This prompt carries encrypted values (${ciphertext.slice(0, 3).join(', ')}), `
      + 'which cannot be read outside their organisation, so it is not archived.');
  }

  const envelope = snap.buildPromptEnvelope({
    tier, scope: tenant.PLATFORM, promptId, metadata: prompt, body, exportedAt: new Date().toISOString(),
  });
  const item = {
    title: prompt.name || promptId,
    description: prompt.description || '',
    content: JSON.stringify(envelope, null, 2),
    contentType: 'prompt',
    category: prompt.gameType || 'general',
    fileName: `${promptId}.snapshot.json`,
    tags: snap.envelopeTags(envelope, [
      prompt.gameType || 'general',
      prompt.category || 'uncategorized',
      prompt.status || 'active',
      ...(prompt.isDefault ? ['default'] : []),
    ]),
  };
  const uploaded = await upload(item, `"${prompt.name}" (${promptId})`);
  results.successful.push({ id: promptId, scope: tenant.PLATFORM, name: prompt.name, archiveId: uploaded.archiveId, gameType: prompt.gameType });
  return undefined;
}
```

`describeTitleHazard` above is the current file's function and comment, carried over unchanged.

In `template-clean.yaml`, inside `AdminExportToArchiveFunction` → `Policies:`, add this as the first list entry, above `- DynamoDBCrudPolicy:`:

```yaml
        # Required by tests/kms-grants-match-code.js: this function's require graph reaches
        # tenant-crypto.js, through archive-snapshot.js's use of isEnvelope for the ciphertext
        # refusal. It decrypts nothing, since org content is refused before it is read.
        - Version: '2012-10-17'
          Statement:
            - Effect: Allow
              Action: [ kms:Decrypt ]
              Resource: !GetAtt TenantKey.Arn
```

- [ ] **Step 5: Run the new suites and watch them pass**

Run: `node tests/archive-set-snapshot-roundtrip.js; echo "exit $?"; node tests/archive-scope-boundary.js; echo "exit $?"`
Expected: `26 passed, 0 failed` and `8 passed, 0 failed`, both exit 0.

- [ ] **Step 6: Migrate `tests/export-to-archive-read.js` from source-shape checks to behaviour**

Its assertions anchored on source text (`QUERY, PAGINATED`, `convertQuestionsToCSV`) that no longer exists. The bug it guards is behavioural, so pin the behaviour. Replace the whole file with:

```js
/**
 * DOES THE EXPORTER ACTUALLY READ A SET'S QUESTIONS?
 *
 *   "its wasnt in archive when you did it, and when i retryed archive, it says export
 *    completed, 0 items exported"
 *
 * The exporter once used a ScanCommand with a FilterExpression and no pagination. A Scan reads
 * one 1 MB page of the WHOLE TABLE and filters after reading, so a set whose rows sat outside
 * that page exported nothing, and the archive's reply blamed three fields that were all fine.
 * It failed by TABLE POSITION: reproducible for one set, invisible for the rest.
 *
 * These drive the REAL export handler against tests/helpers/archive-harness.js, whose Query
 * pages are forced small and whose Scan throws. A single-page read or a table Scan fails here
 * the way it failed in production.
 *
 * // rejects: a Scan; one Query page; an empty read sent onward as an empty backup.
 */
const h = require('./helpers/archive-harness');
const assert = require('assert');
const path = require('path');

const REPO = path.join(__dirname, '..');
const { setPartition } = require(path.join(REPO, 'lambda-functions/admin/shared/set-version.js'));
const exportHandler = require(path.join(REPO, 'lambda-functions/admin/export-to-archive.js')).handler;

const { check, finish } = h.checker();
const exportSet = async (id) => JSON.parse((await exportHandler(h.adminEvent({ selectedItems: [id], exportType: 'questionsets' }))).body).results;

(async () => {
  h.reset();
  h.options.queryPageSize = 2;
  const questions = Array.from({ length: 11 }, (_, i) => ({ SK: `QUESTION#c001#${String(i + 1).padStart(3, '0')}`, Title: `Q${i + 1}`, Category: 'A' }));
  h.seedSet({ setId: 'readyornot', version: 1, meta: { name: 'Ready or Not', questionCount: 11 }, rows: [{ SK: 'CATEGORY#c001', Name: 'A' }, ...questions] });
  const out = await exportSet('readyornot');

  await check('every row of the partition is archived, across six Query pages', () => {
    assert.strictEqual(out.successful.length, 1, JSON.stringify(out.failed));
    assert.strictEqual(JSON.parse(h.archive.get(out.successful[0].archiveId).content).rows.length, 12);
    assert.strictEqual(out.successful[0].questionsCount, 11);
  });
  await check('the rows were read by paginated Query on the set partition (the harness throws on Scan)', () => {
    const pk = setPartition({ scope: 'platform', setId: 'readyornot' }, 1);
    assert.ok(h.reads.filter((r) => r.op === 'Query' && r.PK === pk).length >= 6);
  });

  h.reset();
  h.seedSet({ setId: 'hollow', version: 1, meta: { name: 'Hollow', questionCount: 12 }, rows: [] });
  const empty = await exportSet('hollow');
  await check('an empty read is refused with a diagnosis, and nothing is uploaded', () => {
    assert.strictEqual(empty.successful.length, 0);
    assert.match(empty.failed[0].error, /read problem, not an empty set/);
    assert.match(empty.failed[0].error, /12 questions/);
    assert.strictEqual(h.archive.size, 0);
  });

  finish();
})().catch((e) => { console.error('harness error:', e); process.exit(2); });
```

- [ ] **Step 7: Migrate `tests/archive-export-image-roundtrip.js` onto the harness**

Replace the whole file with:

```js
/**
 * Archive export/import regression: an art-title set keeps its artwork and its reveal.
 *
 * BUG (fixed twice, now structurally impossible): the archive once stored a fixed-column CSV,
 * so an art-title set lost its Image and its AnswerDetails reveal on every round trip, in
 * every environment. Since 2026-09-15 the archive stores a wholesale snapshot
 * (shared/archive-snapshot.js), so there is no column to lose. This file keeps the original
 * regression pinned against that.
 *
 * Runs the REAL export and import handlers against tests/helpers/archive-harness.js.
 */
const h = require('./helpers/archive-harness');
const assert = require('assert');
const path = require('path');

const REPO = path.join(__dirname, '..');
const { setMetadataKey, setPartition } = require(path.join(REPO, 'lambda-functions/admin/shared/set-version.js'));
const exportHandler = require(path.join(REPO, 'lambda-functions/admin/export-to-archive.js')).handler;
const importHandler = require(path.join(REPO, 'lambda-functions/admin/import-from-archive.js')).handler;

const { check, finish } = h.checker();
const ref = { scope: 'platform', setId: 'artset1' };
const QUESTION = {
  SK: 'QUESTION#c001#001', Title: 'A puzzling smile', Detail: '', Category: 'Art',
  Image: '/assets/art/the-enigmatic-smile.jpg', AnswerDetails: 'The Enigmatic Smile — painted 1900s', CustomInstructions: '',
};
function seedArt() {
  h.reset();
  h.seedSet({ setId: 'artset1', meta: { name: 'Mystery Art', description: 'An art-title round', engagementType: 'call-and-answer', active: true }, rows: [{ SK: 'CATEGORY#c001', Name: 'Art' }, QUESTION] });
}
const exportArt = async () => JSON.parse((await exportHandler(h.adminEvent({ selectedItems: ['artset1'], exportType: 'questionsets' }))).body).results;

(async () => {
  await check('the archived snapshot carries the Image and the reveal', async () => {
    seedArt();
    const out = await exportArt();
    const archived = JSON.parse(h.archive.get(out.successful[0].archiveId).content).rows.find((r) => r.SK === QUESTION.SK);
    assert.strictEqual(archived.Image, QUESTION.Image);
    assert.strictEqual(archived.AnswerDetails, QUESTION.AnswerDetails);
  });

  await check('importing into an empty environment restores the Image on the question row', async () => {
    seedArt();
    const out = await exportArt();
    h.table.clear(); // a fresh environment: only the archive still has the set
    const res = JSON.parse((await importHandler(h.adminEvent({ selectedItems: [out.successful[0].archiveId] }))).body);
    assert.deepStrictEqual(res.results.failed, []);
    const restored = h.rows(setPartition(ref, 1)).find((r) => r.SK === QUESTION.SK);
    assert.strictEqual(restored.Image, QUESTION.Image, 'Image did not survive the archive round trip');
    assert.strictEqual(restored.AnswerDetails, QUESTION.AnswerDetails, 'the reveal did not survive the archive round trip');
    assert.strictEqual(h.get(setMetadataKey(ref).PK, setMetadataKey(ref).SK).hasImages, true);
  });

  finish();
})().catch((e) => { console.error('harness error:', e); process.exit(2); });
```

- [ ] **Step 8: Migrate `tests/prompt-archive-roundtrip.js` onto the harness**

Replace the whole file with:

```js
/**
 * A PROMPT MUST SURVIVE A ROUND TRIP THROUGH THE ARCHIVE.
 *
 * On 2026-08-15 every prompt in the archive was hollow (instructions, outputFormat, template
 * and scenario all ''), nine of them reported as successful exports. Three faults produced
 * that. The export function could not read a body at all (no AI_PROMPTS_BUCKET, no S3
 * policy). It copied five hand-picked ANALYSIS fields, so a GENERATION prompt's basePrompt,
 * contextTemplate, audienceTemplate, categoryTemplate and outputSections were dropped. And the
 * import wrote no body, a status outside the vocabulary, a game-type alias and no promptType.
 *
 * SINCE 2026-09-15 THE ARCHIVE HOLDS A SNAPSHOT. The row and its S3 body travel verbatim in an
 * `engage.prompt/1` envelope (docs/superpowers/specs/2026-09-14-archive-full-fidelity-design.md
 * §4.1), and a restore puts both back under the ORIGINAL id with the status it had. It never
 * makes a prompt a default and never takes default status away (A9). Items written before
 * that, `{metadata, prompt}` JSON, still import through the legacy path as a draft copy under
 * a new id. Sections 5b and 7 keep that path honest.
 *
 * Drives the REAL handlers against tests/helpers/archive-harness.js.
 */
const h = require('./helpers/archive-harness');
const assert = require('assert');
const path = require('path');

const REPO = path.join(__dirname, '..');
const { promptKey } = require(path.join(REPO, 'lambda-functions/admin/shared/prompt-access.js'));
const link = require(path.join(REPO, 'lambda-functions/admin/shared/archive-prompt-link.js'));
const exportHandler = require(path.join(REPO, 'lambda-functions/admin/export-to-archive.js')).handler;
const importHandler = require(path.join(REPO, 'lambda-functions/admin/import-from-archive.js')).handler;

const { check, finish } = h.checker();
const PROMPTS_BUCKET = process.env.AI_PROMPTS_BUCKET;
const PROMPTS_PK = promptKey({ scope: 'platform', promptId: 'x' }).PK;

/** The ANALYSIS shape: what the summary engine can actually run. */
const ANALYSIS_BODY = {
  id: 'p-analysis', version: 2, name: 'Workie — The Transfer Reader',
  gameType: 'call-and-answer', promptType: 'analysis', category: 'lessons-learned',
  instructions: 'Read {responsesText} as foreign material nobody here owns.',
  outputFormat: '## Where it lands\n## What resists',
  variables: { responsesText: 'the answers' },
  isDefault: false, status: 'active', questionSetIds: ['qs-1'], tags: ['demo'],
};

/** The GENERATION shape: five fields, none of which the old export copied. */
const GENERATION_BODY = {
  id: 'p-gen', version: 1, name: 'Custom Trivia Topics',
  gameType: 'trivia', promptType: 'generation',
  basePrompt: 'Generate {count} trivia questions about {subject}.',
  contextTemplate: 'The room is {audience}.',
  audienceTemplate: 'Pitch for {audience}.',
  categoryTemplate: 'Spread across {categories}.',
  outputFormat: 'JSON array',
  outputSections: ['question', 'answer', 'explanation'],
  defaultSettings: { count: 10 },
  isDefault: false, status: 'active', questionSetIds: [], tags: [],
};
const SHAPE_FIELDS = ['basePrompt', 'contextTemplate', 'audienceTemplate', 'categoryTemplate', 'outputFormat', 'outputSections', 'defaultSettings'];

/** A row shaped the way create-ai-prompt.js writes one: the shape fields mirrored onto the row. */
function seed(promptId, body) {
  const mirrored = Object.fromEntries(SHAPE_FIELDS.filter((f) => body[f] !== undefined).map((f) => [f, body[f]]));
  h.seedPrompt({
    promptId,
    body,
    row: {
      name: body.name, description: 'seeded', gameType: body.gameType, promptType: body.promptType, category: body.category,
      status: body.status, isDefault: body.isDefault, version: body.version, questionSetIds: body.questionSetIds,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z', ...mirrored,
    },
  });
}
const exportPrompt = async (id) => JSON.parse((await exportHandler(h.adminEvent({ selectedItems: [id], exportType: 'prompts' }))).body).results;
const importItem = async (archiveId) => JSON.parse((await importHandler(h.adminEvent({ selectedItems: [archiveId] }))).body);
const envelopeOf = (archiveId) => JSON.parse(h.archive.get(archiveId).content);
const rowOf = (promptId) => h.get(PROMPTS_PK, `AIPROMPT#${promptId}`);
const bodyAt = (s3Key) => JSON.parse(h.objects.get(`${PROMPTS_BUCKET}/${s3Key}`).Body);
const importedRow = () => h.rows(PROMPTS_PK).find((row) => String(row.promptId).startsWith('imported-'));
const legacyItem = (title, content) => h.seedArchiveItem({ contentType: 'prompt', title, description: 'x', tags: ['dev'], content: JSON.stringify(content) });

(async () => {
  console.log('\n1. THE MISCONFIGURATION — no bucket means no body, and it must SAY so');
  h.reset();
  seed('p1', ANALYSIS_BODY);
  delete process.env.AI_PROMPTS_BUCKET;
  let out = await exportPrompt('p1');
  process.env.AI_PROMPTS_BUCKET = PROMPTS_BUCKET;
  // rejects: archiving a metadata-only shell with a 200, which is how nine hollow prompts arrived.
  await check('an unconfigured bucket fails the export instead of archiving a shell', () => assert.strictEqual(out.successful.length, 0));
  await check('...and nothing was uploaded to the archive at all', () => assert.strictEqual(h.archive.size, 0));
  await check('...and the failure names the deployment fault, not the prompt', () => {
    assert.match(out.failed[0].error, /AI_PROMPTS_BUCKET is not set/);
    assert.strictEqual(out.failed[0].step, 'config');
  });

  console.log('\n2. THE ANALYSIS SHAPE — row and body travel verbatim');
  h.reset();
  seed('p1', ANALYSIS_BODY);
  out = await exportPrompt('p1');
  await check('the export succeeds', () => assert.strictEqual(out.successful.length, 1, JSON.stringify(out.failed)));
  let env = envelopeOf(out.successful[0].archiveId);
  await check('instructions and outputFormat are present and NOT empty', () => {
    assert.strictEqual(env.body.instructions, ANALYSIS_BODY.instructions);
    assert.strictEqual(env.body.outputFormat, ANALYSIS_BODY.outputFormat);
  });
  // rejects: an allow-list, or aliases added to the body, in either direction.
  await check('the body is exactly the stored body — nothing added, nothing dropped', () => assert.deepStrictEqual(env.body, ANALYSIS_BODY));
  await check('the row travels too, with its status and shape', () => {
    assert.deepStrictEqual([env.metadata.status, env.metadata.promptType], ['active', 'analysis']);
  });

  console.log('\n3. THE GENERATION SHAPE — the fields the old export dropped');
  h.reset();
  seed('gen1', GENERATION_BODY);
  out = await exportPrompt('gen1');
  env = envelopeOf(out.successful[0].archiveId);
  for (const field of SHAPE_FIELDS) {
    // eslint-disable-next-line no-await-in-loop
    await check(`${field} survives the export`, () => assert.deepStrictEqual(env.body[field], GENERATION_BODY[field]));
  }
  await check('the archive records which SHAPE this prompt is', () => assert.strictEqual(env.metadata.promptType, 'generation'));

  console.log('\n3b. A GENERATION PROMPT WHOSE TEXT LIVES ON ITS ROW');
  h.reset();
  h.seedPrompt({ promptId: 'gen-trivia', row: { name: 'Custom Trivia Topics', gameType: 'trivia', promptType: 'generation', basePrompt: 'Generate {count} questions' } });
  out = await exportPrompt('gen-trivia');
  await check('it is archived with no body, because the row IS the prompt', () => {
    assert.strictEqual(out.successful.length, 1, JSON.stringify(out.failed));
    const rowOnly = envelopeOf(out.successful[0].archiveId);
    assert.strictEqual(rowOnly.body, null);
    assert.strictEqual(rowOnly.metadata.basePrompt, 'Generate {count} questions');
  });

  console.log('\n4. THE ROUND TRIP — the same prompt, under the same id');
  h.reset();
  seed('p1', { ...ANALYSIS_BODY, isDefault: true });
  out = await exportPrompt('p1');
  h.table.clear();
  let back = await importItem(out.successful[0].archiveId);
  const row = rowOf('p1');
  await check('it restores under its original id', () => {
    assert.deepStrictEqual(back.results.failed, []);
    assert.ok(row, 'no row under p1');
    assert.strictEqual(back.results.successful[0].mode, 'created');
  });
  await check('the row points at a body that exists', () => assert.ok(row.s3Key && h.objects.get(`${PROMPTS_BUCKET}/${row.s3Key}`)));
  const written = bodyAt(row.s3Key);
  await check('...and the text made it all the way through', () => {
    assert.strictEqual(written.instructions, ANALYSIS_BODY.instructions);
    assert.deepStrictEqual(written.variables, ANALYSIS_BODY.variables);
  });
  await check('no legacy aliases were invented', () => {
    assert.strictEqual(written.systemPrompt, undefined);
    assert.strictEqual(written.userPrompt, undefined);
  });

  console.log('\n5. WHAT A RESTORE KEEPS, AND WHAT IT NEVER DOES');
  await check('the status it had is kept', () => assert.strictEqual(row.status, 'active'));
  // rejects: a recreated prompt becoming a default. A default runs in every room of its type.
  await check('a recreated prompt is not a default, even when the backup was one', () => assert.strictEqual(row.isDefault, false));
  await check('its question-set links are kept, because set ids survive a restore', () => assert.deepStrictEqual(row.questionSetIds, ANALYSIS_BODY.questionSetIds));
  await check('no ttl is stamped on a prompt', () => assert.strictEqual(row.ttl, undefined));
  await check('the game type is canonical', () => assert.strictEqual(row.gameType, 'call-and-answer'));
  h.reset();
  seed('p1', { ...ANALYSIS_BODY, isDefault: true });
  out = await exportPrompt('p1');
  back = await importItem(out.successful[0].archiveId);
  // rejects: a restore silently un-defaulting the live default, which changes every room of that type.
  await check('restoring over the live default makes a new version and leaves it the default', () => {
    assert.strictEqual(back.results.successful[0].mode, 'new-version');
    assert.deepStrictEqual([rowOf('p1').isDefault, rowOf('p1').version], [true, 3]);
  });

  console.log('\n5b. LEGACY ITEMS — the game-type aliases, and no suffix');
  const ALIAS_CASES = [['callandanswer', 'call-and-answer'], ['call_and_answer', 'call-and-answer'], ['quiz', 'trivia'], ['polls', 'poll']];
  for (const [spelling, canonical] of ALIAS_CASES) {
    h.reset();
    const id = legacyItem('Aliased (dev)', { metadata: { promptId: 'a1', name: 'Aliased', gameType: spelling }, prompt: { instructions: 'text {responsesText}', outputFormat: '## Out' } });
    // eslint-disable-next-line no-await-in-loop
    await importItem(id);
    const aliasRow = importedRow();
    // eslint-disable-next-line no-await-in-loop
    await check(`gameType "${spelling}" is stored as "${canonical}", in the row and in its s3Key`, () => {
      assert.strictEqual(aliasRow.gameType, canonical);
      assert.ok(String(aliasRow.s3Key).startsWith(`prompts/${canonical}/`), aliasRow.s3Key);
    });
  }
  await check('a legacy prompt is a draft copy, never a default, with no suffix on its name', () => {
    const legacy = importedRow();
    assert.deepStrictEqual([legacy.status, legacy.isDefault, legacy.name], ['draft', false, 'Aliased']);
    assert.deepStrictEqual(legacy.questionSetIds, []);
  });
  h.reset();
  await importItem(legacyItem('Typeless (dev)', { metadata: { promptId: 'n1', name: 'Typeless' }, prompt: { instructions: 'text', outputFormat: '## Out' } }));
  await check('a legacy item with no game type falls back to a CANONICAL id', () => assert.strictEqual(importedRow().gameType, 'call-and-answer'));

  console.log('\n6. A GENERATION PROMPT SURVIVES THE FULL ROUND TRIP');
  h.reset();
  seed('gen1', GENERATION_BODY);
  out = await exportPrompt('gen1');
  h.table.clear();
  back = await importItem(out.successful[0].archiveId);
  await check('it restores', () => assert.deepStrictEqual(back.results.failed, []));
  const genRow = rowOf('gen1');
  const genBody = bodyAt(genRow.s3Key);
  for (const field of SHAPE_FIELDS) {
    // eslint-disable-next-line no-await-in-loop
    await check(`${field} survives the FULL round trip, in the body and on the row`, () => {
      assert.deepStrictEqual(genBody[field], GENERATION_BODY[field]);
      assert.deepStrictEqual(genRow[field], GENERATION_BODY[field]);
    });
  }
  await check('it keeps the trivia game type and its shape', () => assert.deepStrictEqual([genRow.gameType, genRow.promptType], ['trivia', 'generation']));

  console.log('\n7. AN OLD ARCHIVE ENTRY — aliases only, which is what the archive held before');
  h.reset();
  const oldId = legacyItem('Old Prompt (dev)', { metadata: { promptId: 'old1', name: 'Old Prompt', gameType: 'trivia', category: 'general' }, prompt: { systemPrompt: 'Say something useful about {responsesText}.', userPrompt: '## Summary', variables: {} } });
  back = await importItem(oldId);
  await check('a legacy archive entry imports', () => assert.strictEqual(back.results.successful.length, 1, JSON.stringify(back.results.failed)));
  await check('...and its text is promoted into the structured fields', () => {
    const legacyBody = bodyAt(importedRow().s3Key);
    assert.strictEqual(legacyBody.instructions, 'Say something useful about {responsesText}.');
    assert.strictEqual(legacyBody.outputFormat, '## Summary');
  });

  console.log('\n8. THE SET-TO-PROMPT LINK, BY NAME');
  // rejects: split(':')[1], which truncates the four demo prompts whose names contain a colon.
  await check('a prompt name containing a colon survives the tag round trip', () => {
    const name = 'Workie - Knowledge Organization: Make the Distinction Land';
    assert.strictEqual(link.promptNameFromTags([link.promptLinkTag(name)]), name);
  });
  await check('a set with no prompt gets no tag', () => {
    assert.strictEqual(link.promptLinkTag(''), null);
    assert.strictEqual(link.promptLinkTag(undefined), null);
    assert.strictEqual(link.promptNameFromTags(['dev', 'trivia', 'questions:12']), '');
  });
  await check('missing or malformed tags are not a crash', () => {
    assert.strictEqual(link.promptNameFromTags(undefined), '');
    assert.strictEqual(link.promptNameFromTags('prompt:x'), '');
    assert.strictEqual(link.promptNameFromTags([null, 7]), '');
  });
  // Prompts imported before 2026-09-15 carry " (Imported <date>)" in their names; a relink must still find them.
  await check('a suffix older imports added does not break the match', () => {
    const { promptId, matched } = link.resolveLocalPromptId('Workie - The Verdict Board', [{ promptId: 'local-1', name: 'Workie - The Verdict Board (Imported 2026-08-15)' }]);
    assert.deepStrictEqual([matched, promptId], [1, 'local-1']);
  });
  await check('case and whitespace do not decide the link', () => {
    assert.strictEqual(link.resolveLocalPromptId('Workie - The Verdict Board', [{ promptId: 'local-2', name: 'workie  -  the   verdict board' }]).promptId, 'local-2');
  });
  // rejects: guessing. An unlinked set falls back to the default; a wrongly linked one says another set's words.
  await check('no match links nothing, rather than guessing', () => {
    const { promptId, matched } = link.resolveLocalPromptId('Nobody Home', [{ promptId: 'a', name: 'Workie - The Verdict Board' }, { promptId: 'b', name: 'Trivia - Round Call' }]);
    assert.deepStrictEqual([promptId, matched], ['', 0]);
  });
  await check('an ambiguous match is reported as ambiguous', () => {
    const { promptId, matched } = link.resolveLocalPromptId('Twin', [{ promptId: 'first', name: 'Twin' }, { promptId: 'second', name: 'Twin' }]);
    assert.deepStrictEqual([matched, promptId], [2, 'first']);
  });
  await check('an empty name matches nothing, not the unnamed rows', () => {
    assert.strictEqual(link.resolveLocalPromptId('', [{ promptId: 'x', name: '' }]).matched, 0);
    assert.strictEqual(link.resolveLocalPromptId('   ', [{ promptId: 'x' }]).matched, 0);
  });

  finish();
})().catch((e) => { console.error('harness error:', e); process.exit(2); });
```

- [ ] **Step 9: Update `tests/archive-title-header-safety.js` for a signing, Engage-only exporter**

Its phase 3 drives the export handler with no caller and an unsigned host. Replace

```js
process.env.ARCHIVE_SERVICE_URL = 'https://archive.seibtribe.us';
process.env.STACK_NAME = 'engagedev';
```

with

```js
// Export signs its archive calls (shared/archive-client.js), so it needs the execute-api host
// and credentials to sign with.
process.env.ARCHIVE_SERVICE_URL = 'https://archtest01.execute-api.us-east-1.amazonaws.com';
process.env.AWS_ACCESS_KEY_ID = 'AKIDTITLESUITE';
process.env.AWS_SECRET_ACCESS_KEY = 'title-suite-secret';
process.env.STACK_NAME = 'engagedev';
```

Directly after the `function resetAll() { ... }` block, add:

```js
/** Export is Engage staff acting as Engage; every export event below carries that caller. */
const exportAsEngage = (body) => exportToArchive.handler({
  requestContext: { authorizer: { lambda: { groups: 'admins', userId: 'staff-1' } } },
  body: JSON.stringify(body),
});
```

Then replace every occurrence (there are five) of
`exportToArchive.handler({ body: JSON.stringify({ selectedItems: [p.promptId], exportType: 'prompts' }) })`
with
`exportAsEngage({ selectedItems: [p.promptId], exportType: 'prompts' })`.

- [ ] **Step 10: Run every archive suite, then the full backend suite**

Run:
```bash
for f in tests/archive-*.js tests/export-to-archive-read.js tests/prompt-archive-roundtrip.js tests/upload-start-inactive.js tests/kms-grants-match-code.js tests/no-global-partition-literals.js tests/cors-allows-sent-headers.js; do node "$f" >/dev/null 2>&1 && echo "ok $f" || echo "FAIL $f"; done
```
Expected: every line starts with `ok`.

Then run the full backend loop from Global Constraints. Expected: `failed suites: 0`.

- [ ] **Step 11: Commit**

```bash
git add lambda-functions/admin/export-to-archive.js template-clean.yaml tests/archive-set-snapshot-roundtrip.js tests/archive-scope-boundary.js tests/export-to-archive-read.js tests/archive-export-image-roundtrip.js tests/prompt-archive-roundtrip.js tests/archive-title-header-safety.js
git commit -m "Export writes full-fidelity snapshots, and a set survives the archive both ways

Each set or prompt is archived as one wholesale envelope with its uploaded images copied
beside it, so poll options, trivia E and F, images, every setting and the active flag now
come back, under the original id and with no suffix. Public sets become exportable.
Organisation content and anything carrying an encrypted value is refused by name. Export is
Engage-only, signs every call and writes nothing to the main table. The older archive
suites move onto the shared harness and pin behaviour instead of source text. The export
function gains kms:Decrypt, which the KMS guard requires once it reaches tenant-crypto.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 8: The archive proxy routes

**Files:**
- Create: `lambda-functions/admin/archive-items.js`
- Test: `tests/archive-proxy-routes.js` (handler behaviour; Task 9 appends the template and authorizer checks)

**Interfaces:**
- Consumes: Task 1 `archive-client.send`; `tenant.canManageScope`; Task 4 harness.
- Produces: `exports.handler`, routed on `event.requestContext.routeKey`:
  - `GET /admin/archive/items` relays to `GET /archive/items`, passing through only `type`, `category` and `search` from the query string
  - `GET /admin/archive/items/{archiveId}` relays to `GET /archive/items/{archiveId}`
  - `POST /admin/archive/search` relays to `POST /archive/search` with the JSON body
  - `DELETE /admin/archive/items/{archiveId}` relays to `DELETE /archive/items/{archiveId}`
  - responses: the archive's status and body verbatim; `404` for an unknown route; `403` unless `canManageScope(event, PLATFORM)`; `400` for a malformed id or body; `502` when the archive cannot be reached. Every response carries CORS headers including `X-Engage-Org`.

- [ ] **Step 1: Write the failing test**

Create `tests/archive-proxy-routes.js`:

```js
/**
 * THE BROWSER REACHES THE ARCHIVE ONLY THROUGH ITS OWN TIER.
 *
 * spec §4.6. The archive screen used to fetch archive.seibtribe.us directly, with no
 * credentials, including DELETE. These four routes replace those calls. The tier's sign-in and
 * the `admins` group gate the route; this handler requires Engage staff acting as Engage; and
 * the request leaves signed with the function's role, the only kind the locked archive accepts.
 *
 * // rejects: a relay a host or an org-standing admin can use; an id that can steer the path;
 * //          query parameters the archive was not asked for; a relay that rewrites the
 * //          archive's answer; CORS headers that drop X-Engage-Org.
 */
const h = require('./helpers/archive-harness');
const assert = require('assert');
const path = require('path');

const REPO = path.join(__dirname, '..');
const handler = require(path.join(REPO, 'lambda-functions/admin/archive-items.js')).handler;

const { check, finish } = h.checker();
const call = async (event) => {
  const res = await handler(event);
  let body;
  try { body = JSON.parse(res.body); } catch { body = res.body; }
  return { status: res.statusCode, headers: res.headers, body };
};
const archiveCalls = () => h.fetchLog.filter((c) => c.url.startsWith(process.env.ARCHIVE_SERVICE_URL));

(async () => {
  console.log('1. each route relays to the archive, signed');
  h.reset();
  const kept = h.seedArchiveItem({ contentType: 'questionset', title: 'Team Retro', tags: ['prod'], content: '{"schema":"engage.set/1"}' });
  const doomed = h.seedArchiveItem({ contentType: 'prompt', title: 'Old Prompt', tags: ['dev'], content: '{"schema":"engage.prompt/1"}' });

  let res = await call(h.adminEvent(undefined, { routeKey: 'GET /admin/archive/items', queryStringParameters: { type: 'questionset', sneaky: 'x' } }));
  await check('list returns the archive\'s items, filtered as asked', () => {
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body.items.map((i) => i.ArchiveId), [kept]);
  });
  await check('only type, category and search are passed on', () => {
    const sent = new URL(archiveCalls()[0].url);
    assert.deepStrictEqual([...sent.searchParams.keys()], ['type']);
  });
  res = await call(h.adminEvent(undefined, { routeKey: 'GET /admin/archive/items/{archiveId}', pathParameters: { archiveId: kept } }));
  await check('get returns the item and its download link', () => {
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.item.ArchiveId, kept);
    assert.ok(res.body.downloadUrl);
  });
  res = await call(h.adminEvent({ query: 'retro' }, { routeKey: 'POST /admin/archive/search' }));
  await check('search relays the body', () => assert.deepStrictEqual(res.body.items.map((i) => i.Title), ['Team Retro']));
  res = await call(h.adminEvent(undefined, { routeKey: 'DELETE /admin/archive/items/{archiveId}', pathParameters: { archiveId: doomed } }));
  await check('delete removes the item', () => {
    assert.strictEqual(res.status, 200);
    assert.ok(!h.archive.has(doomed) && h.archive.has(kept));
  });
  await check('every call carried a SigV4 signature (the harness refuses the rest)', () => {
    assert.strictEqual(archiveCalls().length, 4);
    assert.ok(archiveCalls().every((c) => String(c.headers.authorization).startsWith('AWS4-HMAC-SHA256')));
  });
  res = await call(h.adminEvent(undefined, { routeKey: 'GET /admin/archive/items/{archiveId}', pathParameters: { archiveId: 'arc-404' } }));
  await check('an archive 404 is relayed as a 404, not rewritten', () => assert.strictEqual(res.status, 404));
  await check('responses carry CORS headers that include X-Engage-Org', () => {
    assert.match(res.headers['Access-Control-Allow-Headers'], /X-Engage-Org/);
  });

  console.log('\n2. refusals, before the archive is touched');
  for (const [who, event] of [
    ['a host', h.hostEvent(undefined, { routeKey: 'GET /admin/archive/items' })],
    ['an Engage admin inside a customer team', h.orgAdminEvent('acme', undefined, { routeKey: 'DELETE /admin/archive/items/{archiveId}', pathParameters: { archiveId: kept } })],
  ]) {
    h.fetchLog.length = 0;
    // eslint-disable-next-line no-await-in-loop
    res = await call(event);
    // eslint-disable-next-line no-await-in-loop
    await check(`${who} gets 403 and the archive is never called`, () => {
      assert.strictEqual(res.status, 403);
      assert.strictEqual(h.fetchLog.length, 0);
    });
  }
  h.fetchLog.length = 0;
  res = await call(h.adminEvent(undefined, { routeKey: 'GET /admin/archive/items/{archiveId}', pathParameters: { archiveId: '../search' } }));
  await check('an id that is not an id is refused before it can become part of a path', () => {
    assert.strictEqual(res.status, 400);
    assert.strictEqual(h.fetchLog.length, 0);
  });
  res = await call(h.adminEvent(undefined, { routeKey: 'PUT /admin/archive/items/{archiveId}', pathParameters: { archiveId: kept } }));
  await check('a route this relay does not serve is a 404', () => assert.strictEqual(res.status, 404));

  console.log('\n3. an unreachable archive is named');
  const realFetch = global.fetch;
  global.fetch = async () => { throw new Error('getaddrinfo ENOTFOUND'); };
  res = await call(h.adminEvent(undefined, { routeKey: 'GET /admin/archive/items' }));
  global.fetch = realFetch;
  await check('it is a 502 that says the archive could not be reached', () => {
    assert.strictEqual(res.status, 502);
    assert.match(res.body.error, /archive could not be reached/);
  });

  finish();
})().catch((e) => { console.error('harness error:', e); process.exit(2); });
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node tests/archive-proxy-routes.js; echo "exit $?"`
Expected: exit 1 or 2, with `Cannot find module '.../lambda-functions/admin/archive-items.js'`.

- [ ] **Step 3: Implement the relay**

Create `lambda-functions/admin/archive-items.js`:

```js
/**
 * THE ARCHIVE, AS THE BROWSER REACHES IT — list, read, search and delete, through the tier.
 *
 * docs/superpowers/specs/2026-09-14-archive-full-fidelity-design.md §4.6. The archive screen
 * used to fetch archive.seibtribe.us directly, with no credentials, including DELETE. Now the
 * browser calls these routes on its own tier. The route requires the tier's sign-in and the
 * `admins` group (lambda-functions/auth/authorizer.js). This handler requires Engage staff
 * acting as Engage (canManageScope PLATFORM). And the call leaves signed with this function's
 * role (shared/archive-client.js), the only kind of request the locked archive accepts.
 *
 * A RELAY, NOT A SECOND ARCHIVE API. Status and body come back as the archive sent them, so a
 * missing item is a 404 here too and the screen can say so.
 */
const tenant = require('./shared/tenant');
const archive = require('./shared/archive-client');

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Engage-Org',
  'Content-Type': 'application/json',
};
const reply = (statusCode, body) => ({ statusCode, headers, body: typeof body === 'string' ? body : JSON.stringify(body) });

/** Archive ids are UUIDs. Anything else is refused before it can become part of a path. */
const ARCHIVE_ID = /^[A-Za-z0-9-]{1,64}$/;
function archiveIdOf(event) {
  const id = String((event.pathParameters && event.pathParameters.archiveId) || '');
  if (!ARCHIVE_ID.test(id)) throw new Error('That is not an archive item id.');
  return id;
}
function jsonBody(event) {
  try {
    return JSON.parse(event.body || '{}');
  } catch {
    throw new Error('Request body is not valid JSON.');
  }
}
const LIST_FILTERS = ['type', 'category', 'search'];
const listQuery = (event) => Object.fromEntries(
  LIST_FILTERS
    .filter((name) => event.queryStringParameters && event.queryStringParameters[name])
    .map((name) => [name, String(event.queryStringParameters[name])]),
);

const ROUTES = {
  'GET /admin/archive/items': (event) => ['GET', '/archive/items', { query: listQuery(event) }],
  'GET /admin/archive/items/{archiveId}': (event) => ['GET', `/archive/items/${archiveIdOf(event)}`],
  'POST /admin/archive/search': (event) => ['POST', '/archive/search', { body: jsonBody(event) }],
  'DELETE /admin/archive/items/{archiveId}': (event) => ['DELETE', `/archive/items/${archiveIdOf(event)}`],
};

exports.handler = async (event) => {
  const routeKey = String((event && event.requestContext && event.requestContext.routeKey) || '');
  const route = ROUTES[routeKey];
  if (!route) return reply(404, { error: `No archive route ${routeKey || '(none)'}` });
  if (!tenant.canManageScope(event, tenant.PLATFORM)) {
    return reply(403, { error: "The archive backs up Engage's library. Switch to Engage (no organisation selected) to use it." });
  }
  let request;
  try {
    request = route(event);
  } catch (error) {
    return reply(400, { error: error.message });
  }
  try {
    const response = await archive.send(...request);
    const text = await response.text();
    return reply(response.status, text || '{}');
  } catch (error) {
    console.error(`archive relay ${routeKey} failed:`, error);
    return reply(502, { error: `The archive could not be reached: ${error.message}` });
  }
};
```

- [ ] **Step 4: Run the test and the header guards**

Run: `node tests/archive-proxy-routes.js; echo "exit $?"`
Expected: `13 passed, 0 failed`, exit 0.

Run: `node tests/cors-allows-sent-headers.js && node tests/no-global-partition-literals.js && node tests/kms-grants-match-code.js; echo "exit $?"`
Expected: exit 0. `kms-grants-match-code.js` only scans functions in the template, and this one is not declared until Task 9.

- [ ] **Step 5: Commit**

```bash
git add lambda-functions/admin/archive-items.js tests/archive-proxy-routes.js
git commit -m "The admin screen's archive calls get signed relay routes on each tier

List, read, search and delete used to go from the browser straight to the unauthenticated
archive. This relay serves them on the tier instead. It requires Engage staff acting as
Engage, refuses anything that is not an archive id before it reaches a path, passes on
only the list filters it knows, and signs each call with the function's own role. The
archive's answer is relayed unchanged.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 9: Every tier's template can reach the archive, and the dead route goes

**Files:**
- Modify: `template-clean.yaml`. Add `Mappings`, replace the `AdminExportToArchiveFunction` and `AdminImportFromArchiveFunction` resources, and replace `AdminListLocalArchiveFunction` with `AdminArchiveItemsFunction`.
- Delete: `lambda-functions/admin/list-local-archive.js`
- Regenerate: `docs/architecture/api.md`
- Test (new): `tests/archive-infrastructure.js`
- Test (extend): `tests/archive-proxy-routes.js`

**Interfaces:**
- Consumes: Tasks 6–8 handlers; `tests/helpers/template-routes.js`; `lambda-functions/auth/authorizer.js` `requiredGroupsForRoute`; `config/archive-service.json` (`archiveApiUrl` = `https://9gi7xpycsf.execute-api.us-east-1.amazonaws.com`).
- Produces: in every tier, the functions `${StackName}-admin-export-to-archive`, `${StackName}-admin-import-from-archive` and `${StackName}-admin-archive-items` carry `ARCHIVE_SERVICE_URL = https://<ArchiveService.Api.Id>.execute-api.<region>.amazonaws.com` and `execute-api:Invoke` on `arn:aws:execute-api:<region>:<account>:<id>/*/*/archive/*`. Task 12's scripts check exactly these three function names.

- [ ] **Step 1: Write the failing infrastructure test**

Create `tests/archive-infrastructure.js`:

```js
/**
 * EVERY TIER CAN REACH THE SHARED ARCHIVE — asserted from the files that decide it.
 *
 * The owner's instruction for this work: "make sure that all tiers can access dev/test/prod".
 * All three tiers deploy template-clean.yaml, so what the template grants, every tier gets.
 * This suite pins that grant and the one source of the archive's API id, and (as later
 * sections are added) the scripts that prove it against live AWS and the archive stack's own
 * lock-down. scripts/archive-access-check.sh is the live half of the same claim.
 *
 * TEXT, NOT YAML. The template is full of CloudFormation short tags no loader in this repo
 * reads, the same reason tests/helpers/template-routes.js scans text. Every scanner here
 * asserts it found something before anything is concluded from it.
 *
 * // rejects: an archive caller without the invoke grant or on the CloudFront host; the API id
 * //          drifting from the archive stack's output; write grants wider than the paths the
 * //          archive code uses; the dead list-local-archive route coming back.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');

let pass = 0; let fail = 0;
const check = (label, fn) => {
  try { fn(); console.log(`  ok   - ${label}`); pass += 1; } catch (e) {
    console.log(`  FAIL - ${label}\n         ${e.message}`); fail += 1;
  }
};

/** One top-level resource's text: from its two-space key to the next one. */
function resourceBlock(src, logicalId) {
  const start = src.indexOf(`\n  ${logicalId}:\n`);
  assert.ok(start !== -1, `${logicalId} is not declared`);
  const after = src.slice(start + 1);
  const next = after.slice(1).search(/\n {2}[A-Za-z0-9]+:\n/);
  return next === -1 ? after : after.slice(0, next + 2);
}

/** Every Serverless function whose FunctionName is `${StackName}-<suffix>`, keyed by suffix. */
function functionsBySuffix(src) {
  const found = new Map();
  for (const m of src.matchAll(/\n {2}([A-Za-z0-9]+):\n {4}Type: AWS::Serverless::Function\n/g)) {
    const block = resourceBlock(src, m[1]);
    const name = /FunctionName: !Sub '\$\{StackName\}-([a-z0-9-]+)'/.exec(block);
    if (name) found.set(name[1], { logicalId: m[1], block });
  }
  return found;
}

const template = read('template-clean.yaml');
const functions = functionsBySuffix(template);
const ARCHIVE_CALLERS = ['admin-archive-items', 'admin-export-to-archive', 'admin-import-from-archive'];
const URL_FROM_MAPPING = /ARCHIVE_SERVICE_URL: !Sub\s*\n\s*- 'https:\/\/\$\{ArchiveApiId\}\.execute-api\.\$\{AWS::Region\}\.amazonaws\.com'\s*\n\s*- ArchiveApiId: !FindInMap \[ArchiveService, Api, Id\]/;
const INVOKE_GRANT = /Action: \['execute-api:Invoke'\]\s*\n\s*Resource: !Sub\s*\n\s*- 'arn:aws:execute-api:\$\{AWS::Region\}:\$\{AWS::AccountId\}:\$\{ArchiveApiId\}\/\*\/\*\/archive\/\*'\s*\n\s*- ArchiveApiId: !FindInMap \[ArchiveService, Api, Id\]/;

console.log('1. the archive API id has one source, and it matches the archive stack');
check('the function scanner found the functions (it is not matching nothing)', () => {
  assert.ok(functions.size > 40, `found only ${functions.size}`);
});
check('ArchiveService → Api → Id is the id deploy-archive.sh recorded in config/archive-service.json', () => {
  const mapping = /\nMappings:\n[\s\S]*?\n {2}ArchiveService:\n {4}Api:\n {6}Id: (\S+)\n/.exec(template);
  assert.ok(mapping, 'no ArchiveService mapping in template-clean.yaml');
  const recorded = new URL(JSON.parse(read('config/archive-service.json')).archiveApiUrl).hostname.split('.')[0];
  assert.strictEqual(mapping[1], recorded);
});
check('nothing in the main template names archive.seibtribe.us', () => {
  assert.ok(!template.includes('archive.seibtribe.us'), 'a signed call through the CloudFront name is refused');
});

console.log('\n2. every archive caller signs for the execute-api host and may invoke it');
check('the functions that call the archive are exactly the three the access check knows', () => {
  const callers = [...functions].filter(([, f]) => f.block.includes('ARCHIVE_SERVICE_URL')).map(([suffix]) => suffix).sort();
  assert.deepStrictEqual(callers, ARCHIVE_CALLERS);
});
for (const suffix of ARCHIVE_CALLERS) {
  check(`${suffix} reads the URL from the mapping and holds execute-api:Invoke on /archive/*`, () => {
    const fn = functions.get(suffix);
    assert.ok(fn, `${suffix} is not declared`);
    assert.match(fn.block, URL_FROM_MAPPING);
    assert.match(fn.block, INVOKE_GRANT);
  });
}

console.log('\n3. least privilege on the data paths');
check('export reads the main table and writes nothing to it', () => {
  const { block } = functions.get('admin-export-to-archive');
  assert.ok(block.includes('DynamoDBReadPolicy'));
  assert.ok(!block.includes('DynamoDBCrudPolicy'), 'export writes nothing to the main table');
});
check('export may write only under the archive media prefix', () => {
  assert.match(functions.get('admin-export-to-archive').block, /Action: \['s3:PutObject'\]\s*\n\s*Resource: 'arn:aws:s3:::engage2-archive-content\/archive\/media\/\*'/);
});
check('import may write images only under sets/', () => {
  assert.match(functions.get('admin-import-from-archive').block, /Action: \['s3:GetObject', 's3:PutObject'\]\s*\n\s*Resource: !Sub '\$\{MediaBucket\.Arn\}\/sets\/\*'/);
});
check('both data functions may list the buckets they copy between, so a missing image is a 404', () => {
  assert.match(functions.get('admin-export-to-archive').block, /Action: \['s3:ListBucket'\]\s*\n\s*Resource: !GetAtt MediaBucket\.Arn/);
  assert.match(functions.get('admin-import-from-archive').block, /Action: \['s3:ListBucket'\]\s*\n\s*Resource: 'arn:aws:s3:::engage2-archive-content'/);
});
check('the relay holds nothing but the invoke grant', () => {
  const { block } = functions.get('admin-archive-items');
  assert.ok(!/DynamoDB\w*Policy|S3\w*Policy|s3:|kms:/.test(block), 'the relay needs no table, bucket or key');
});

console.log('\n4. the dead route is gone');
check('AdminListLocalArchiveFunction is not declared, and its handler is deleted', () => {
  assert.ok(!template.includes('AdminListLocalArchiveFunction'));
  assert.ok(!fs.existsSync(path.join(REPO, 'lambda-functions/admin/list-local-archive.js')));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Extend the proxy-route test with both halves of the route closure**

In `tests/archive-proxy-routes.js`, insert this section immediately before the line `  finish();`:

```js
  console.log('\n4. the routes are closed at both halves: the template and the authorizer');
  const { routesFromTemplate, findRoute, assertScannerWorks } = require('./helpers/template-routes');
  const { requiredGroupsForRoute } = require(path.join(REPO, 'lambda-functions/auth/authorizer.js'));
  const routes = routesFromTemplate();
  await check('the template scanner works', () => assertScannerWorks(routes));
  for (const [method, routePath] of [
    ['GET', '/admin/archive/items'],
    ['GET', '/admin/archive/items/{archiveId}'],
    ['POST', '/admin/archive/search'],
    ['DELETE', '/admin/archive/items/{archiveId}'],
  ]) {
    // eslint-disable-next-line no-await-in-loop
    await check(`${method} ${routePath} carries CognitoAuthorizer and requires admins`, () => {
      const route = findRoute(routes, method, routePath);
      assert.ok(route, 'not declared in template-clean.yaml');
      assert.strictEqual(route.authorizer, 'CognitoAuthorizer');
      assert.deepStrictEqual(requiredGroupsForRoute(method, routePath.slice(1)), ['admins']);
    });
  }
  await check('the dead list-local-archive route is gone', () => {
    assert.strictEqual(findRoute(routes, 'GET', '/admin/list-local-archive'), undefined);
  });
```

- [ ] **Step 3: Run both and watch them fail**

Run: `node tests/archive-infrastructure.js; echo "exit $?"; node tests/archive-proxy-routes.js; echo "exit $?"`
Expected: both exit 1. The mapping, grants and relay routes do not exist yet, and `AdminListLocalArchiveFunction` still does.

- [ ] **Step 4: Add the mapping**

In `template-clean.yaml`, insert immediately above the top-level line `Globals:`:

```yaml
Mappings:
  # THE SHARED ARCHIVE SERVICE'S HTTP API ID (stack engage2-archive-service, deployed by
  # hand with scripts/deploy-archive.sh). All three tiers call the one archive, so all
  # three read the id from here.
  #
  # A mapping on purpose. Not an SSM dynamic reference: that parameter would have to be
  # created by hand before any tier could deploy. Not a template Parameter: a stack update
  # keeps a parameter's previous value rather than re-reading a changed default. And not
  # !ImportValue, which would pin the hand-deployed stack's export forever.
  # tests/archive-infrastructure.js fails if this disagrees with config/archive-service.json,
  # which deploy-archive.sh writes from the archive stack's own output.
  ArchiveService:
    Api:
      Id: 9gi7xpycsf

```

- [ ] **Step 5: Replace the export function resource**

Replace the whole `AdminExportToArchiveFunction` resource, from the line `  AdminExportToArchiveFunction:` down to and including its `        StackName: !Ref StackName` tag line, with:

```yaml
  AdminExportToArchiveFunction:
    Type: AWS::Serverless::Function
    Properties:
      FunctionName: !Sub '${StackName}-admin-export-to-archive'
      CodeUri: lambda-functions/admin/
      Handler: export-to-archive.handler
      Runtime: nodejs22.x
      Timeout: 300
      MemorySize: 512
      Environment:
        Variables:
          TABLE_NAME: !Ref GameTable
          # THE ARCHIVE'S execute-api ENDPOINT, NOT archive.seibtribe.us. Every archive call is
          # SigV4-signed (shared/archive-client.js), SigV4 signs the Host header, and CloudFront
          # rewrites Host, so a call signed through the CloudFront name is refused once the
          # archive requires AWS_IAM.
          ARCHIVE_SERVICE_URL: !Sub
            - 'https://${ArchiveApiId}.execute-api.${AWS::Region}.amazonaws.com'
            - ArchiveApiId: !FindInMap [ArchiveService, Api, Id]
          # Where a backup's images are copied to (shared/archive-media.js).
          ARCHIVE_BUCKET: engage2-archive-content
          MEDIA_BUCKET: !Ref MediaBucket
          # A prompt is a two-store record: the row, and the body in this bucket. Without the
          # variable and the read below, every archived prompt was empty (2026-08-15).
          AI_PROMPTS_BUCKET: !Ref AIPromptsBucket
      Policies:
        # Required by tests/kms-grants-match-code.js: this function's require graph reaches
        # tenant-crypto.js, through archive-snapshot.js's use of isEnvelope for the ciphertext
        # refusal. It decrypts nothing, since org content is refused before it is read.
        - Version: '2012-10-17'
          Statement:
            - Effect: Allow
              Action: [ kms:Decrypt ]
              Resource: !GetAtt TenantKey.Arn
        # READ, not Crud: an export writes nothing to the main table.
        - DynamoDBReadPolicy:
            TableName: !Ref GameTable
        # Read-only: an export reads prompt bodies and never writes one.
        - S3ReadPolicy:
            BucketName: !Ref AIPromptsBucket
        - Statement:
            # EVERY TIER HOLDS THIS SAME GRANT, because every tier deploys this template. That is
            # what lets dev, test and prod all reach the one shared archive once its routes
            # require AWS_IAM. scripts/archive-access-check.sh proves it against the live roles.
            - Effect: Allow
              Action: ['execute-api:Invoke']
              Resource: !Sub
                - 'arn:aws:execute-api:${AWS::Region}:${AWS::AccountId}:${ArchiveApiId}/*/*/archive/*'
                - ArchiveApiId: !FindInMap [ArchiveService, Api, Id]
            # Copy a set's images out of this tier's media bucket...
            - Effect: Allow
              Action: ['s3:GetObject']
              Resource: !Sub '${MediaBucket.Arn}/sets/*'
            # ...where ListBucket is what makes an absent image a 404 rather than a 403...
            - Effect: Allow
              Action: ['s3:ListBucket']
              Resource: !GetAtt MediaBucket.Arn
            # ...into the archive, under its media prefix and nowhere else.
            - Effect: Allow
              Action: ['s3:PutObject']
              Resource: 'arn:aws:s3:::engage2-archive-content/archive/media/*'
      Events:
        ExportToArchive:
          Type: HttpApi
          Properties:
            ApiId: !Ref RestApi
            Path: /admin/export-to-archive
            Method: POST
            Auth:
              Authorizer: CognitoAuthorizer
      Tags:
        Environment: !Ref Environment
        StackName: !Ref StackName
```

- [ ] **Step 6: Replace the import function resource**

Replace the whole `AdminImportFromArchiveFunction` resource, from `  AdminImportFromArchiveFunction:` through its `        StackName: !Ref StackName` tag line, with:

```yaml
  AdminImportFromArchiveFunction:
    Type: AWS::Serverless::Function
    Properties:
      FunctionName: !Sub '${StackName}-admin-import-from-archive'
      CodeUri: lambda-functions/admin/
      Handler: import-from-archive.handler
      Runtime: nodejs22.x
      Timeout: 300
      MemorySize: 512
      Environment:
        Variables:
          TABLE_NAME: !Ref GameTable
          # Signed calls go to the execute-api host; see AdminExportToArchiveFunction.
          ARCHIVE_SERVICE_URL: !Sub
            - 'https://${ArchiveApiId}.execute-api.${AWS::Region}.amazonaws.com'
            - ArchiveApiId: !FindInMap [ArchiveService, Api, Id]
          ARCHIVE_BUCKET: engage2-archive-content
          MEDIA_BUCKET: !Ref MediaBucket
          # A restored prompt's body is WRITTEN here, and the row's s3Key points at it.
          AI_PROMPTS_BUCKET: !Ref AIPromptsBucket
      Policies:
        # Required by tests/kms-grants-match-code.js: upload-questions.js (the legacy CSV path)
        # and archive-snapshot.js both reach tenant-crypto.js. Nothing is decrypted, because
        # every restore lands in platform and org content is refused before it is read.
        - Version: '2012-10-17'
          Statement:
            - Effect: Allow
              Action: [ kms:Decrypt ]
              Resource: !GetAtt TenantKey.Arn
        - DynamoDBCrudPolicy:
            TableName: !Ref GameTable
        - Statement:
            # The same grant every tier holds; see AdminExportToArchiveFunction.
            - Effect: Allow
              Action: ['execute-api:Invoke']
              Resource: !Sub
                - 'arn:aws:execute-api:${AWS::Region}:${AWS::AccountId}:${ArchiveApiId}/*/*/archive/*'
                - ArchiveApiId: !FindInMap [ArchiveService, Api, Id]
            # Read what the archive holds. ListBucket makes an absent image a 404, not a 403.
            - Effect: Allow
              Action: ['s3:GetObject']
              Resource: 'arn:aws:s3:::engage2-archive-content/*'
            - Effect: Allow
              Action: ['s3:ListBucket']
              Resource: 'arn:aws:s3:::engage2-archive-content'
            # Put images back, only under sets/, and never over one that exists. The HeadObject
            # that checks is why GetObject and ListBucket are here too.
            - Effect: Allow
              Action: ['s3:GetObject', 's3:PutObject']
              Resource: !Sub '${MediaBucket.Arn}/sets/*'
            - Effect: Allow
              Action: ['s3:ListBucket']
              Resource: !GetAtt MediaBucket.Arn
        # Crud, not Read: a restore puts the body it just downloaded.
        - S3CrudPolicy:
            BucketName: !Ref AIPromptsBucket
      Events:
        ImportFromArchive:
          Type: HttpApi
          Properties:
            ApiId: !Ref RestApi
            Path: /admin/import-from-archive
            Method: POST
            Auth:
              Authorizer: CognitoAuthorizer
      Tags:
        Environment: !Ref Environment
        StackName: !Ref StackName
```

- [ ] **Step 7: Replace the dead route with the relay**

Replace the whole `AdminListLocalArchiveFunction` resource, from `  AdminListLocalArchiveFunction:` through its `        StackName: !Ref StackName` tag line, with:

```yaml
  AdminArchiveItemsFunction:
    Type: AWS::Serverless::Function
    Properties:
      FunctionName: !Sub '${StackName}-admin-archive-items'
      CodeUri: lambda-functions/admin/
      Handler: archive-items.handler
      Runtime: nodejs22.x
      Timeout: 30
      Environment:
        Variables:
          ARCHIVE_SERVICE_URL: !Sub
            - 'https://${ArchiveApiId}.execute-api.${AWS::Region}.amazonaws.com'
            - ArchiveApiId: !FindInMap [ArchiveService, Api, Id]
      Policies:
        # THE ONLY GRANT. The admin screen's list, read, search and delete come here signed in,
        # are checked by canManageScope, and leave signed with this role. It touches no table,
        # no bucket and no key of its own.
        - Statement:
            - Effect: Allow
              Action: ['execute-api:Invoke']
              Resource: !Sub
                - 'arn:aws:execute-api:${AWS::Region}:${AWS::AccountId}:${ArchiveApiId}/*/*/archive/*'
                - ArchiveApiId: !FindInMap [ArchiveService, Api, Id]
      Events:
        ListArchiveItems:
          Type: HttpApi
          Properties:
            ApiId: !Ref RestApi
            Path: /admin/archive/items
            Method: GET
            Auth:
              Authorizer: CognitoAuthorizer
        GetArchiveItem:
          Type: HttpApi
          Properties:
            ApiId: !Ref RestApi
            Path: /admin/archive/items/{archiveId}
            Method: GET
            Auth:
              Authorizer: CognitoAuthorizer
        SearchArchiveItems:
          Type: HttpApi
          Properties:
            ApiId: !Ref RestApi
            Path: /admin/archive/search
            Method: POST
            Auth:
              Authorizer: CognitoAuthorizer
        DeleteArchiveItem:
          Type: HttpApi
          Properties:
            ApiId: !Ref RestApi
            Path: /admin/archive/items/{archiveId}
            Method: DELETE
            Auth:
              Authorizer: CognitoAuthorizer
      Tags:
        Environment: !Ref Environment
        StackName: !Ref StackName
```

Then delete the dead handler and regenerate the API reference:

```bash
git rm lambda-functions/admin/list-local-archive.js
node scripts/generate-api-doc.js
```

Expected: `wrote docs/architecture/api.md — 108 routes, 89 authenticated`.

- [ ] **Step 8: Run the new and affected suites, and validate the template**

Run:
```bash
for f in tests/archive-infrastructure.js tests/archive-proxy-routes.js tests/kms-grants-match-code.js tests/tenant-infrastructure.js tests/cors-allows-sent-headers.js tests/no-global-partition-literals.js tests/template-validates.js; do node "$f" >/dev/null 2>&1 && echo "ok $f" || echo "FAIL $f"; done
```
Expected: seven `ok` lines. `archive-infrastructure.js` reports `13 passed`, and `archive-proxy-routes.js` reports `19 passed`. `template-validates.js` runs `sam validate --lint`. A lint failure there names the line, so fix the YAML rather than the test.

Then run the full backend loop. Expected: `failed suites: 0`.

- [ ] **Step 9: Commit**

```bash
git add template-clean.yaml docs/architecture/api.md tests/archive-infrastructure.js tests/archive-proxy-routes.js
git commit -m "Every tier's archive functions may invoke the locked archive, and the dead route is removed

All three tiers deploy this template, so the grant written here is the grant each tier
gets. Export, import and the new relay read the archive's execute-api URL from one mapping
pinned to the archive stack's recorded output, and each holds execute-api:Invoke on the
archive routes. Their S3 grants are narrowed to the prefixes the code uses, and export is
read-only on the main table. The list-local-archive route, which could never succeed, is
gone.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 10: What an archive item is, for the screen

**Files:**
- Create: `src/src/utils/archiveItems.js`
- Modify: `src/src/utils/archiveFiltering.js` (export `STRUCTURED_TAG`, keep structured tags out of the tag dropdown, add a `tier` filter axis)
- Test (new): `src/src/__tests__/archiveItems.test.js`
- Test (extend): `src/src/__tests__/archiveFiltering.test.js`

**Interfaces:**
- Consumes: `archiveFiltering.archiveTags`; the tags export writes (Task 2 `envelopeTags`); the import and export response shapes (Tasks 6 and 7).
- Produces:
  - from `archiveFiltering.js`: `STRUCTURED_TAG` (a RegExp) and `filterArchiveItems(items, { gameType, tag, tier })`
  - from `archiveItems.js`: `TIERS`, `archiveTier(item)` → `'dev'|'test'|'prod'|''`, `archiveScope(item)`, `archiveSource(item)`, `isSnapshot(item)`, `displayTags(item)`, `groupSnapshots(items)` → `Array<{ item, latest, snapshots }>`, `selectionKey(scope, id)`, `exportSelection(keys)` → `Array<{scope, id}>` (org dropped), `describeExport(response)` → `string[]`, `describeRestore(response)` → `string[]`

- [ ] **Step 1: Write the failing tests**

Create `src/src/__tests__/archiveItems.test.js`:

```js
/**
 * WHAT AN ARCHIVE ITEM IS, READ OFF ITS TAGS — utils/archiveItems.js.
 *
 * Every tier reads every tier's backups (spec A2), so the screen has to say where each one came
 * from, keep a source's snapshots together, send export requests that name their library, and
 * report a restore in words that lead with what just went live for every organisation.
 */
import {
  TIERS, archiveTier, archiveScope, archiveSource, isSnapshot, displayTags, groupSnapshots,
  selectionKey, exportSelection, describeExport, describeRestore,
} from '../utils/archiveItems';

const snapshot = (id, tier, source, createdAt, extra = []) => ({
  ArchiveId: id, Title: source, CreatedAt: createdAt,
  Tags: [tier, 'schema:engage.set/1', `scope:${source.split('/')[0]}`, `source:${source}`, `exportedAt:${createdAt}`, ...extra],
});
const NEW_RETRO = snapshot('arc-3', 'prod', 'platform/teamretro', '2026-09-15T12:00:00.000Z', ['call-and-answer', 'questions:12']);
const OLD_RETRO = snapshot('arc-1', 'dev', 'platform/teamretro', '2026-09-01T12:00:00.000Z');
const SHARED = snapshot('arc-2', 'test', 'public/acme-quiz', '2026-09-10T12:00:00.000Z');
const LEGACY = { ArchiveId: 'arc-0', Title: 'Old Quiz (dev)', CreatedAt: '2026-08-01T00:00:00.000Z', Tags: ['dev', 'trivia', 'questions:3'] };

describe('reading an item', () => {
  test('the tier is the environment tag, for snapshots and legacy items alike', () => {
    expect(TIERS).toEqual(['dev', 'test', 'prod']);
    expect(archiveTier(NEW_RETRO)).toBe('prod');
    expect(archiveTier(LEGACY)).toBe('dev');
    expect(archiveTier({ Tags: ['business'] })).toBe('');
  });
  test('scope, source and snapshot-ness come from the structured tags', () => {
    expect(archiveScope(SHARED)).toBe('public');
    expect(archiveSource(NEW_RETRO)).toBe('platform/teamretro');
    expect(isSnapshot(NEW_RETRO)).toBe(true);
    expect(isSnapshot(LEGACY)).toBe(false);
    expect(archiveScope(LEGACY)).toBe('');
  });
  test('display tags leave out the structured tags and the tier, which have their own chips', () => {
    expect(displayTags(NEW_RETRO)).toEqual(['call-and-answer', 'questions:12']);
    expect(displayTags(LEGACY)).toEqual(['trivia', 'questions:3']);
  });
});

describe('groupSnapshots', () => {
  test("a source's snapshots sit together, newest first, and groups follow their newest snapshot", () => {
    const rows = groupSnapshots([OLD_RETRO, LEGACY, SHARED, NEW_RETRO]);
    expect(rows.map((r) => r.item.ArchiveId)).toEqual(['arc-3', 'arc-1', 'arc-2', 'arc-0']);
    expect(rows.map((r) => [r.latest, r.snapshots])).toEqual([[true, 2], [false, 2], [true, 1], [true, 1]]);
  });
  test('an empty archive groups to nothing', () => {
    expect(groupSnapshots([])).toEqual([]);
    expect(groupSnapshots(undefined)).toEqual([]);
  });
});

describe('export selection', () => {
  test('keys round-trip to {scope, id}, and an organisation set can never be sent', () => {
    const keys = new Set([selectionKey('platform', 'teamretro'), selectionKey('public', 'acme-quiz'), selectionKey('org', 'mine')]);
    expect(exportSelection(keys)).toEqual([{ scope: 'platform', id: 'teamretro' }, { scope: 'public', id: 'acme-quiz' }]);
  });
  test('a missing scope is the platform library', () => {
    expect(selectionKey(undefined, 'x')).toBe('platform:x');
  });
});

describe('describeRestore', () => {
  test('what went live comes first, then what happened to each item, then what was refused', () => {
    const lines = describeRestore({
      results: {
        successful: [
          { archiveId: 'arc-3', kind: 'set', id: 'teamretro', name: 'Team Retro', mode: 'new-version', version: 4, active: true },
          { archiveId: 'arc-2', kind: 'set', id: 'acme-quiz', name: 'Acme Quiz', mode: 'created', version: 1, active: false },
          { archiveId: 'arc-0', kind: 'set', id: 'oldquiz', name: 'Old Quiz', mode: 'created', version: null, active: false, legacy: true },
        ],
        failed: [{ archiveId: 'arc-9', refused: true, error: 'Organisation content is not archived: it is encrypted per organisation.' }],
      },
      becameActive: [{ id: 'teamretro', name: 'Team Retro' }],
      media: { copied: 2, kept: 1, missing: ['sets/acme-quiz/gone.png'] },
    });
    expect(lines).toEqual([
      'Now live for every organisation: Team Retro.',
      'Restored 3: Team Retro (new version v4); Acme Quiz (recreated); Old Quiz (imported as an inactive set).',
      '1 image could not be restored: sets/acme-quiz/gone.png.',
      'Not restored: arc-9 — Organisation content is not archived: it is encrypted per organisation.',
    ]);
  });
  test('a restore that did nothing says so rather than saying nothing', () => {
    expect(describeRestore({ results: { successful: [], failed: [] } })).toEqual(['The import reported nothing restored and no error.']);
  });
});

describe('describeExport', () => {
  test('backups, lost images and refusals, each named', () => {
    expect(describeExport({
      results: {
        successful: [{ id: 'teamretro', name: 'Team Retro', media: { copied: 1, missing: ['sets/teamretro/old.png'] } }],
        failed: [{ id: 'mine', scope: 'org', refused: true, error: 'Organisation content is not archived: it is encrypted per organisation.' }],
      },
    })).toEqual([
      'Backed up 1: Team Retro.',
      'Team Retro: 1 image was already missing and is not in the backup.',
      'Not archived: mine — Organisation content is not archived: it is encrypted per organisation.',
    ]);
  });
  test('an export that did nothing says so', () => {
    expect(describeExport({ results: {} })).toEqual(['The export reported no backup and no error.']);
  });
});
```

In `src/src/__tests__/archiveFiltering.test.js`, add `STRUCTURED_TAG` to the import list at the top, and append:

```js
describe('snapshot tags and the environment filter', () => {
  const snapshotItem = {
    ArchiveId: 'a5', Title: 'Team Retro', ContentType: 'questionset', Category: 'call-and-answer',
    Tags: ['test', 'schema:engage.set/1', 'scope:platform', 'source:platform/teamretro', 'exportedAt:2026-09-15T12:00:00.000Z', 'questions:12'],
  };

  it('keeps structured tags out of the tag dropdown', () => {
    const tags = collectArchiveTags([snapshotItem]);
    expect(tags).toEqual(['questions:12', 'test']);
    expect(STRUCTURED_TAG.test('source:platform/teamretro')).toBe(true);
    expect(STRUCTURED_TAG.test('questions:12')).toBe(false);
  });

  it('narrows by the environment a backup came from', () => {
    expect(filterArchiveItems([...ALL, snapshotItem], { tier: 'test' })).toEqual([snapshotItem]);
    expect(filterArchiveItems(ALL, { tier: 'prod' })).toEqual([callAndAnswerPrompt]);
  });

  it('combines the environment with the other axes', () => {
    expect(filterArchiveItems(ALL, { tier: 'dev', gameType: 'trivia' })).toEqual([triviaSet]);
    expect(filterArchiveItems(ALL, { tier: 'prod', gameType: 'trivia' })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd src && npx jest src/__tests__/archiveItems.test.js src/__tests__/archiveFiltering.test.js; cd ..`
Expected: `archiveItems.test.js` fails with `Cannot find module '../utils/archiveItems'`. The new `archiveFiltering` block fails, because `STRUCTURED_TAG` is undefined and `tier` is ignored.

- [ ] **Step 3: Extend the filtering utility**

In `src/src/utils/archiveFiltering.js`, directly after `export const ANY = '';` add:

```js
/**
 * Tags a snapshot carries for machines, not people: its schema, library, source and export
 * time (lambda-functions/admin/shared/archive-snapshot.js envelopeTags). Every snapshot has a
 * unique source and time, so listing them would bury the tag dropdown. The screen shows what
 * they mean as chips instead.
 */
export const STRUCTURED_TAG = /^(schema|scope|source|exportedAt):/i;
```

In `collectArchiveTags`, change the inner loop's first line from `if (resolveGameType(tag)) continue;` to:

```js
      if (resolveGameType(tag) || STRUCTURED_TAG.test(tag)) continue;
```

Replace `filterArchiveItems` with:

```js
/**
 * Narrow the loaded records by game type, tag and/or the environment a backup came from. An
 * empty value on any axis means "all", and an unknown game-type id filters to nothing rather
 * than quietly returning everything.
 */
export function filterArchiveItems(items, { gameType = ANY, tag = ANY, tier = ANY } = {}) {
  const wantedType = gameType ? resolveGameType(gameType) : null;
  // A game type the registry doesn't know matches nothing. Letting it through as `null` would
  // make the filter mean "records with no type", which is the opposite of what a stale or
  // mistyped selection should show.
  if (gameType && !wantedType) return [];
  const wantedTier = String(tier || '').toLowerCase();

  return (items || []).filter((item) => {
    if (gameType && archiveGameType(item) !== wantedType) return false;
    if (!hasArchiveTag(item, tag)) return false;
    if (wantedTier && !archiveTags(item).some((t) => t.toLowerCase() === wantedTier)) return false;
    return true;
  });
}
```

- [ ] **Step 4: Create the item utility**

Create `src/src/utils/archiveItems.js`:

```js
/**
 * WHAT AN ARCHIVE ITEM IS, AND WHAT A BACKUP OR RESTORE DID — for components/ArchivePanel.jsx.
 *
 * Every tier reads every tier's backups (docs/superpowers/specs/2026-09-14-archive-full-
 * fidelity-design.md, amendment A2). So "which environment is this from" is the first question
 * the screen answers, a source's snapshots are shown together, and a restore is reported
 * leading with what just went live for every organisation.
 *
 * Pure: everything here reads the tags export writes (archive-snapshot.js envelopeTags) or the
 * JSON the export and import routes return.
 */
import { archiveTags, STRUCTURED_TAG } from './archiveFiltering';

export const TIERS = ['dev', 'test', 'prod'];

const tagValue = (item, prefix) => {
  const found = archiveTags(item).find((tag) => tag.startsWith(prefix));
  return found ? found.slice(prefix.length) : '';
};

/** The environment a backup was taken on, or '' when the item never recorded one. */
export function archiveTier(item) {
  const tags = archiveTags(item).map((tag) => tag.toLowerCase());
  return TIERS.find((tier) => tags.includes(tier)) || '';
}

export const archiveScope = (item) => tagValue(item, 'scope:');
export const archiveSource = (item) => tagValue(item, 'source:');
export const isSnapshot = (item) => tagValue(item, 'schema:') !== '';

/** Tags worth showing a person: not the structured ones, not the tier (each has its own chip). */
export const displayTags = (item) => archiveTags(item)
  .filter((tag) => !STRUCTURED_TAG.test(tag) && !TIERS.includes(tag.toLowerCase()));

/**
 * Items in display order. Snapshots of the same source are adjacent, newest first, and groups
 * are ordered by their newest snapshot. An item with no source is a group of one.
 */
export function groupSnapshots(items) {
  const groups = new Map();
  for (const item of items || []) {
    const key = archiveSource(item) ? `source:${archiveSource(item)}` : `item:${item.ArchiveId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const time = (item) => Date.parse(item.CreatedAt) || 0;
  const ordered = [...groups.values()].map((group) => group.sort((a, b) => time(b) - time(a)));
  ordered.sort((a, b) => time(b[0]) - time(a[0]));
  return ordered.flatMap((group) => group.map((item, index) => ({ item, latest: index === 0, snapshots: group.length })));
}

/** A selection key naming the library as well as the id: `teamretro` alone is not one set. */
export const selectionKey = (scope, id) => `${scope || 'platform'}:${id}`;

/** The export request's entries. An organisation set is never archived, so it is dropped here too. */
export function exportSelection(keys) {
  return [...(keys || [])]
    .map((key) => {
      const at = key.indexOf(':');
      return { scope: key.slice(0, at), id: key.slice(at + 1) };
    })
    .filter((ref) => ref.scope === 'platform' || ref.scope === 'public');
}

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

export function describeExport(response) {
  const results = (response && response.results) || {};
  const done = results.successful || [];
  const failed = results.failed || [];
  const lines = [];
  if (done.length) lines.push(`Backed up ${done.length}: ${done.map((d) => d.name || d.id).join(', ')}.`);
  for (const d of done) {
    const missing = (d.media && d.media.missing) || [];
    if (missing.length) {
      lines.push(`${d.name || d.id}: ${plural(missing.length, 'image')} ${missing.length === 1 ? 'was' : 'were'} already missing and ${missing.length === 1 ? 'is' : 'are'} not in the backup.`);
    }
  }
  for (const f of failed) lines.push(`${f.refused ? 'Not archived' : 'Failed'}: ${f.name || f.id} — ${f.error}`);
  if (!done.length && !failed.length) lines.push('The export reported no backup and no error.');
  return lines;
}

const restoredAs = (entry) => {
  if (entry.legacy) return entry.kind === 'prompt' ? 'imported as a draft copy' : 'imported as an inactive set';
  return entry.mode === 'new-version' ? `new version v${entry.version}` : 'recreated';
};

export function describeRestore(response) {
  const results = (response && response.results) || {};
  const restored = results.successful || [];
  const failed = results.failed || [];
  const live = (response && response.becameActive) || [];
  const missing = (response && response.media && response.media.missing) || [];
  const lines = [];
  if (live.length) lines.push(`Now live for every organisation: ${live.map((s) => s.name || s.id).join(', ')}.`);
  if (restored.length) {
    lines.push(`Restored ${restored.length}: ${restored.map((r) => `${r.name || r.id} (${restoredAs(r)})`).join('; ')}.`);
  }
  if (missing.length) lines.push(`${plural(missing.length, 'image')} could not be restored: ${missing.join(', ')}.`);
  for (const f of failed) lines.push(`${f.refused ? 'Not restored' : 'Failed'}: ${f.archiveId} — ${f.error}`);
  if (!restored.length && !failed.length) lines.push('The import reported nothing restored and no error.');
  return lines;
}
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `cd src && npx jest src/__tests__/archiveItems.test.js src/__tests__/archiveFiltering.test.js; cd ..`
Expected: both suites pass: 11 tests in `archiveItems`, and the existing `archiveFiltering` tests plus 3 new ones.

- [ ] **Step 6: Commit**

```bash
git add src/src/utils/archiveItems.js src/src/utils/archiveFiltering.js src/src/__tests__/archiveItems.test.js src/src/__tests__/archiveFiltering.test.js
git commit -m "The archive screen can tell where a backup came from and what a restore did

Backups from every tier appear in one list, so each item's environment, library and
source are read off the tags export writes. A source's snapshots are grouped newest first,
and the list filters by environment. Export requests name the library of every set and can
never include an organisation's. A restore report leads with what is now live for every
organisation.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 11: The admin screen goes through its tier

**Files:**
- Modify (rewrite whole file): `src/src/components/ArchivePanel.jsx`
- Modify: `src/src/AdminPage.jsx` (mount the panel with `environment`; archive subtitle), `src/src/config/consoleSections.js` (archive subtitle), `src/src/styles.css` (tier chip, note and report styles)
- Test (new): `src/src/__tests__/archivePanel.test.jsx`, `src/src/__tests__/archiveNoDirectCalls.test.js`

**Interfaces:**
- Consumes: Task 8 relay routes (`admin/archive/items`, `admin/archive/items/{id}`, `admin/archive/search`); Task 6 and 7 import and export routes; Task 10 utilities; `utils/adminEnvironment.describeEnvironment` output (`{ id: 'dev'|'test'|'prod'|'unknown', label, detail }`), which `AdminPage.jsx` already computes as `environment`.
- Produces: `<ArchivePanel environment={environment} />`. It makes no `fetch` to the archive service, has no hand-upload form and no per-card Import. Each item shows its tier, the list filters by tier, and an import is confirmed first and reported afterwards.

Scope note: the admin redesign mockup `docs/design/admin-redesign/20-archive.html` draws this screen as a table. Converting it is not part of this work (spec §4.7 is targeted). Its first design note, "Environment is the first question", is what the tier chip and filter implement.

- [ ] **Step 1: Write the failing tests**

Create `src/src/__tests__/archiveNoDirectCalls.test.js`:

```js
/**
 * NO FRONTEND CODE CALLS THE ARCHIVE SERVICE DIRECTLY.
 *
 * The archive requires signed AWS requests once it is locked (spec §4.6). A browser call to
 * archive.seibtribe.us would fail on that day, and until then it is an unauthenticated call to
 * a store every tier depends on. Every archive call goes through the tier's own admin routes.
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..');

function sources(dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__' && entry.name !== 'node_modules') sources(full, found);
    } else if (/\.(js|jsx)$/.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

test('the scan reaches the archive screen at all', () => {
  expect(sources(SRC).some((file) => file.endsWith(path.join('components', 'ArchivePanel.jsx')))).toBe(true);
});

test('no source file names archive.seibtribe.us', () => {
  const offenders = sources(SRC)
    .filter((file) => fs.readFileSync(file, 'utf8').includes('archive.seibtribe.us'))
    .map((file) => path.relative(SRC, file));
  expect(offenders).toEqual([]);
});
```

Create `src/src/__tests__/archivePanel.test.jsx`:

```jsx
/**
 * THE ARCHIVE SCREEN — components/ArchivePanel.jsx, with the network mocked at authFetch.
 *
 * rejects: a call to the archive service that bypasses the tier; the hand-upload form coming
 * back; a backup that does not say which environment it came from; an export request that
 * does not name each set's library, or that includes an organisation's; an import that is not
 * confirmed, or whose result hides what went live.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn() }));
const { authFetch } = require('../auth/authFetch');

import ArchivePanel from '../components/ArchivePanel';

const reply = (body, status = 200) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });
const PROD = { id: 'prod', label: 'PROD', detail: 'API x' };

const snapshot = (id, tier, createdAt) => ({
  ArchiveId: id, Title: 'Team Retro', ContentType: 'questionset', Category: 'call-and-answer', FileSize: 2048, CreatedAt: createdAt,
  Tags: [tier, 'schema:engage.set/1', 'scope:platform', 'source:platform/teamretro', `exportedAt:${createdAt}`, 'call-and-answer', 'questions:12'],
});
const LATEST = snapshot('arc-2', 'prod', '2026-09-15T12:00:00.000Z');
const EARLIER = snapshot('arc-1', 'dev', '2026-09-01T12:00:00.000Z');
const LEGACY = { ArchiveId: 'arc-0', Title: 'Old Quiz (dev)', ContentType: 'questionset', Category: 'trivia', FileSize: 100, CreatedAt: '2026-08-01T12:00:00.000Z', Tags: ['dev', 'trivia'] };

function route(handlers) {
  authFetch.mockImplementation((url, init = {}) => {
    const method = String(init.method || 'GET').toUpperCase();
    const address = String(url);
    const hit = handlers.find(([m, pattern]) => m === method && pattern.test(address));
    return hit ? hit[2](address, init) : reply({ error: `unrouted ${method} ${address}` }, 404);
  });
}
const callsTo = (method, pattern) => authFetch.mock.calls.filter(([url, init = {}]) => String(init.method || 'GET').toUpperCase() === method && pattern.test(String(url)));

const LIST = ['GET', /admin\/archive\/items(\?|$)/, () => reply({ items: [EARLIER, LEGACY, LATEST] })];

beforeEach(() => {
  authFetch.mockReset();
  window.API_BASE = 'https://api.test.invalid/prod/';
  global.fetch = jest.fn();
});

test('the list comes through the tier, never from the archive service', async () => {
  route([LIST]);
  render(<ArchivePanel environment={PROD} />);
  expect(await screen.findByTestId('archive-item-arc-2')).toBeInTheDocument();
  expect(callsTo('GET', /admin\/archive\/items/)).toHaveLength(1);
  expect(global.fetch).not.toHaveBeenCalled();
});

test('there is no hand-upload form any more', async () => {
  route([LIST]);
  render(<ArchivePanel environment={PROD} />);
  await screen.findByTestId('archive-item-arc-2');
  expect(screen.queryByText('Upload New Item')).not.toBeInTheDocument();
});

test('each backup says which environment it came from, and the list filters by it', async () => {
  route([LIST]);
  render(<ArchivePanel environment={PROD} />);
  const latest = await screen.findByTestId('archive-item-arc-2');
  expect(within(latest).getByTestId('archive-item-tier')).toHaveTextContent('From prod');
  expect(within(screen.getByTestId('archive-item-arc-1')).getByTestId('archive-item-tier')).toHaveTextContent('From dev');
  fireEvent.change(screen.getByLabelText('Environment'), { target: { value: 'dev' } });
  expect(screen.queryByTestId('archive-item-arc-2')).not.toBeInTheDocument();
  expect(screen.getByTestId('archive-item-arc-1')).toBeInTheDocument();
  expect(screen.getByTestId('archive-item-arc-0')).toBeInTheDocument();
});

test("a source's backups sit together, newest first, and say so", async () => {
  route([LIST]);
  render(<ArchivePanel environment={PROD} />);
  await screen.findByTestId('archive-item-arc-2');
  const order = screen.getAllByTestId(/^archive-item-arc-/).map((el) => el.getAttribute('data-testid'));
  expect(order).toEqual(['archive-item-arc-2', 'archive-item-arc-1', 'archive-item-arc-0']);
  expect(within(screen.getByTestId('archive-item-arc-2')).getByTestId('archive-item-snapshot')).toHaveTextContent('Latest of 2 backups');
});

test('export names each set\'s library, and never offers an organisation\'s set', async () => {
  route([
    LIST,
    ['GET', /admin\/question-sets$/, () => reply({ questionSets: [
      { id: 'teamretro', scope: 'platform', name: 'Team Retro' },
      { id: 'acme-quiz', scope: 'public', name: 'Acme Quiz' },
      { id: 'ours', scope: 'org', name: 'Our Private Set' },
    ] })],
    ['GET', /admin\/ai-prompts$/, () => reply({ prompts: [] })],
    ['POST', /admin\/export-to-archive$/, () => reply({ results: { successful: [{ id: 'teamretro', name: 'Team Retro', media: { copied: 0, missing: [] } }], failed: [] } })],
  ]);
  render(<ArchivePanel environment={PROD} />);
  fireEvent.click(await screen.findByText('Export to Archive'));
  fireEvent.click(await screen.findByLabelText('Select Team Retro'));
  fireEvent.click(screen.getByLabelText('Select Acme Quiz'));
  expect(screen.queryByText('Our Private Set')).not.toBeInTheDocument();
  fireEvent.click(screen.getByText(/Export Selected \(2\)/));
  await waitFor(() => expect(callsTo('POST', /admin\/export-to-archive$/)).toHaveLength(1));
  expect(JSON.parse(callsTo('POST', /admin\/export-to-archive$/)[0][1].body)).toEqual({
    selectedItems: [{ scope: 'platform', id: 'teamretro' }, { scope: 'public', id: 'acme-quiz' }],
    exportType: 'questionsets',
  });
  expect(await screen.findByText('Backed up 1: Team Retro.')).toBeInTheDocument();
});

test('an import is confirmed, names the environment, and reports what went live', async () => {
  const confirm = jest.spyOn(window, 'confirm').mockReturnValue(true);
  route([
    LIST,
    ['POST', /admin\/import-from-archive$/, () => reply({
      results: { successful: [{ archiveId: 'arc-2', kind: 'set', id: 'teamretro', name: 'Team Retro', mode: 'created', version: 1, active: true }], failed: [] },
      becameActive: [{ id: 'teamretro', name: 'Team Retro' }],
      media: { copied: 0, kept: 0, missing: [] },
    })],
  ]);
  render(<ArchivePanel environment={PROD} />);
  fireEvent.click(await screen.findByText('Import from Archive'));
  fireEvent.click(within(await screen.findByTestId('archive-item-arc-2')).getByRole('checkbox'));
  fireEvent.click(screen.getByText(/Import Selected \(1\)/));
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining('into prod'));
  await waitFor(() => expect(callsTo('POST', /admin\/import-from-archive$/)).toHaveLength(1));
  expect(JSON.parse(callsTo('POST', /admin\/import-from-archive$/)[0][1].body)).toEqual({ selectedItems: ['arc-2'] });
  expect(await screen.findByText('Now live for every organisation: Team Retro.')).toBeInTheDocument();
  confirm.mockRestore();
});

test('a declined confirmation sends nothing', async () => {
  const confirm = jest.spyOn(window, 'confirm').mockReturnValue(false);
  route([LIST]);
  render(<ArchivePanel environment={PROD} />);
  fireEvent.click(await screen.findByText('Import from Archive'));
  fireEvent.click(within(await screen.findByTestId('archive-item-arc-2')).getByRole('checkbox'));
  fireEvent.click(screen.getByText(/Import Selected \(1\)/));
  expect(callsTo('POST', /admin\/import-from-archive$/)).toHaveLength(0);
  confirm.mockRestore();
});

test("the tier's refusal is shown, not swallowed", async () => {
  route([['GET', /admin\/archive\/items(\?|$)/, () => reply({ error: "The archive backs up Engage's library. Switch to Engage (no organisation selected) to use it." }, 403)]]);
  render(<ArchivePanel environment={PROD} />);
  expect(await screen.findByText(/Switch to Engage/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd src && npx jest src/__tests__/archivePanel.test.jsx src/__tests__/archiveNoDirectCalls.test.js; cd ..`
Expected: both fail. The guard finds `components/ArchivePanel.jsx`, and the panel tests fail because the component calls `fetch` directly and has no testids or tier filter.

- [ ] **Step 3: Rewrite the panel**

Replace the whole of `src/src/components/ArchivePanel.jsx` with:

```jsx
import React, { useState, useEffect, useMemo } from 'react';
import { authFetch } from '../auth/authFetch';
import Icon from './Icon';
import StatusMessage from './StatusMessage';
import { GAME_TYPE_LIST, gameTypeLabel } from '../config/gameTypes';
import {
  archiveGameType,
  filterArchiveItems,
  tagFilterOptions,
} from '../utils/archiveFiltering';
import {
  TIERS,
  archiveTier,
  archiveScope,
  displayTags,
  groupSnapshots,
  selectionKey,
  exportSelection,
  describeExport,
  describeRestore,
} from '../utils/archiveItems';

/**
 * THE ARCHIVE SCREEN — backups of Engage's library and the public library, shared by every tier.
 *
 * Every call goes to this tier's own routes: `admin/archive/*` (admin/archive-items.js) and the
 * export and import routes. Nothing calls the archive service itself. The archive accepts only
 * signed AWS requests, and who may use it is decided by the tier's own sign-in. See
 * docs/superpowers/specs/2026-09-14-archive-full-fidelity-design.md §4.7.
 *
 * WHICH ENVIRONMENT IS THE FIRST QUESTION. Every tier reads every tier's backups, so each item
 * says where it came from, the list filters by it, and an import names the environment it is
 * about to write to before anything happens.
 */
const archiveRoute = (suffix) => `${window.API_BASE}admin/archive/${suffix}`;
const readBody = (response) => response.json().catch(() => ({}));
const libraryLabel = (scope) => (scope === 'public' ? 'Public library' : 'Engage library');

const formatFileSize = (bytes) => {
  if (!bytes) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
};
const formatDate = (dateString) => new Date(dateString).toLocaleString();

const ArchivePanel = ({ environment }) => {
  const tierName = environment && environment.id && environment.id !== 'unknown' ? environment.id : 'this environment';
  const [activeTab, setActiveTab] = useState('browse');
  const [archiveItems, setArchiveItems] = useState([]);
  const [localQuestionSets, setLocalQuestionSets] = useState([]);
  const [localPrompts, setLocalPrompts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  const [report, setReport] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState('');
  // Game type, tag and environment are filtered in the browser. See utils/archiveFiltering.js.
  const [selectedGameType, setSelectedGameType] = useState('');
  const [selectedTag, setSelectedTag] = useState('');
  const [selectedTier, setSelectedTier] = useState('');
  const [selectedArchiveItems, setSelectedArchiveItems] = useState(new Set());
  const [selectedQuestionSets, setSelectedQuestionSets] = useState(new Set());
  const [selectedPrompts, setSelectedPrompts] = useState(new Set());

  useEffect(() => {
    loadArchiveItems();
    if (activeTab === 'export') {
      loadLocalContent();
    }
  }, [selectedType, activeTab]);

  const visibleItems = useMemo(
    () => filterArchiveItems(archiveItems, { gameType: selectedGameType, tag: selectedTag, tier: selectedTier }),
    [archiveItems, selectedGameType, selectedTag, selectedTier]
  );
  const rows = useMemo(() => groupSnapshots(visibleItems), [visibleItems]);
  const availableTags = useMemo(() => tagFilterOptions(archiveItems, selectedTag), [archiveItems, selectedTag]);
  // Organisation content is encrypted per organisation and never archived, so it is not offered.
  const exportableSets = useMemo(() => localQuestionSets.filter((qs) => (qs.scope || 'platform') !== 'org'), [localQuestionSets]);
  // Only Engage's prompts: nothing writes public prompts, and org prompts are never archived.
  const exportablePrompts = useMemo(() => localPrompts.filter((p) => (p.scope || 'platform') === 'platform'), [localPrompts]);

  // An empty grid means two different things, and saying which one saves a pointless re-search.
  const emptyMessage = archiveItems.length === 0
    ? 'No archive items found'
    : 'No archive items match the current filters';

  const toggle = (setter, current, key) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key); else next.add(key);
    setter(next);
  };

  const loadArchiveItems = async () => {
    setLoading(true);
    setError(null);
    try {
      const query = selectedType ? `?type=${encodeURIComponent(selectedType)}` : '';
      const response = await authFetch(archiveRoute(`items${query}`));
      const data = await readBody(response);
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      setArchiveItems(data.items || []);
    } catch (err) {
      console.error('Failed to load archive items:', err);
      setError(`Failed to load archive items: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const loadLocalContent = async () => {
    setLoading(true);
    setError(null);
    try {
      const questionSetsResponse = await authFetch(`${window.API_BASE}admin/question-sets`);
      if (questionSetsResponse.ok) {
        const questionSetsData = await questionSetsResponse.json();
        setLocalQuestionSets(questionSetsData.questionSets || []);
      }
      const promptsResponse = await authFetch(`${window.API_BASE}admin/ai-prompts`);
      if (promptsResponse.ok) {
        const promptsData = await promptsResponse.json();
        setLocalPrompts(promptsData.prompts || []);
      }
    } catch (err) {
      console.error('Failed to load local content:', err);
      setError('Failed to load local content. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      loadArchiveItems();
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await authFetch(archiveRoute('search'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: searchQuery, filters: selectedType ? { contentType: selectedType } : {} }),
      });
      const data = await readBody(response);
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      setArchiveItems(data.items || []);
    } catch (err) {
      console.error('Search failed:', err);
      setError(`Search failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async (item) => {
    try {
      const response = await authFetch(archiveRoute(`items/${encodeURIComponent(item.ArchiveId)}`));
      const data = await readBody(response);
      if (!response.ok || !data.downloadUrl) throw new Error(data.error || `HTTP ${response.status}`);
      window.open(data.downloadUrl, '_blank');
    } catch (err) {
      console.error('Download failed:', err);
      setError(`Download failed: ${err.message}`);
    }
  };

  const handleDelete = async (item) => {
    if (!window.confirm(`Delete the backup "${item.Title}"? Every environment shares this archive.`)) return;
    try {
      const response = await authFetch(archiveRoute(`items/${encodeURIComponent(item.ArchiveId)}`), { method: 'DELETE' });
      const data = await readBody(response);
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      setNotice(`Deleted the backup "${item.Title}".`);
      loadArchiveItems();
    } catch (err) {
      console.error('Delete failed:', err);
      setError(`Delete failed: ${err.message}`);
    }
  };

  const handleExportSelected = async (exportType) => {
    const selectedItems = exportType === 'questionsets'
      ? exportSelection(selectedQuestionSets)
      : [...selectedPrompts].map((id) => ({ scope: 'platform', id }));
    if (selectedItems.length === 0) {
      setError('Please select items to export');
      return;
    }
    setLoading(true);
    setError(null);
    setNotice('');
    setReport([]);
    try {
      const response = await authFetch(`${window.API_BASE}admin/export-to-archive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedItems, exportType }),
      });
      const result = await readBody(response);
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      setReport(describeExport(result));
      if (exportType === 'questionsets') setSelectedQuestionSets(new Set());
      else setSelectedPrompts(new Set());
      loadArchiveItems();
    } catch (err) {
      console.error('Export failed:', err);
      setError(`Export failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleImportSelected = async () => {
    const selectedItems = [...selectedArchiveItems];
    if (selectedItems.length === 0) {
      setError('Please select items to import');
      return;
    }
    const count = selectedItems.length;
    const confirmed = window.confirm(
      `Restore ${count} backup${count === 1 ? '' : 's'} into ${tierName}? `
      + 'A set that already exists gets a new version and switches to it; the version it replaces stays in its history. '
      + 'An active Engage set is live for every organisation.'
    );
    if (!confirmed) return;
    setLoading(true);
    setError(null);
    setNotice('');
    setReport([]);
    try {
      const response = await authFetch(`${window.API_BASE}admin/import-from-archive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedItems }),
      });
      const result = await readBody(response);
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      setReport(describeRestore(result));
      setSelectedArchiveItems(new Set());
    } catch (err) {
      console.error('Import failed:', err);
      setError(`Import failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const renderArchiveItem = ({ item, latest, snapshots }, selectable) => {
    const tier = archiveTier(item);
    const scope = archiveScope(item);
    const tags = displayTags(item);
    const selected = selectedArchiveItems.has(item.ArchiveId);
    return (
      <div key={item.ArchiveId} className="archive-item" data-testid={`archive-item-${item.ArchiveId}`}>
        {selectable && (
          <div className="item-checkbox">
            <input
              type="checkbox"
              aria-label={`Select ${item.Title}`}
              checked={selected}
              onChange={() => toggle(setSelectedArchiveItems, selectedArchiveItems, item.ArchiveId)}
            />
          </div>
        )}
        <div className="item-header">
          <h4>{item.Title}</h4>
          <span className="item-type">{item.ContentType}</span>
        </div>

        {item.Description && <p className="item-description">{item.Description}</p>}

        <div className="item-tags">
          <span className={`tag tier tier-${tier || 'unknown'}`} data-testid="archive-item-tier">
            {tier ? `From ${tier}` : 'Environment not recorded'}
          </span>
          {scope && <span className="tag scope">{libraryLabel(scope)}</span>}
          {snapshots > 1 && (
            <span className="tag snapshot" data-testid="archive-item-snapshot">
              {latest ? `Latest of ${snapshots} backups` : 'Earlier backup'}
            </span>
          )}
        </div>

        <div className="item-meta">
          {archiveGameType(item) && (
            <span>
              <Icon name="GameController" weight="bold" size={16} color="currentColor" />
              {' '}{gameTypeLabel(archiveGameType(item))}
            </span>
          )}
          <span><Icon name="Folder" weight="bold" size={16} color="currentColor" /> {item.Category}</span>
          <span><Icon name="FileText" weight="bold" size={16} color="currentColor" /> {formatFileSize(item.FileSize)}</span>
          <span><Icon name="CalendarBlank" weight="bold" size={16} color="currentColor" /> {formatDate(item.CreatedAt)}</span>
        </div>

        {tags.length > 0 && (
          <div className="item-tags">
            {tags.map((tag, index) => <span key={`${tag}-${index}`} className="tag">{tag}</span>)}
          </div>
        )}

        <div className="item-actions">
          {selectable ? (
            <button className="btn-primary" onClick={() => toggle(setSelectedArchiveItems, selectedArchiveItems, item.ArchiveId)}>
              {selected ? 'Selected' : 'Select for Import'}
            </button>
          ) : (
            <>
              <button onClick={() => handleDownload(item)}>
                <Icon name="DownloadSimple" weight="bold" size={16} color="currentColor" /> Download
              </button>
              <button className="delete-btn" onClick={() => handleDelete(item)}>
                <Icon name="Trash" weight="bold" size={16} color="currentColor" /> Delete
              </button>
            </>
          )}
        </div>
      </div>
    );
  };

  const renderGrid = (selectable) => (
    loading ? (
      <div className="loading">Loading archive items...</div>
    ) : (
      <div className="archive-grid">
        {rows.length === 0
          ? <div className="no-items">{emptyMessage}</div>
          : rows.map((row) => renderArchiveItem(row, selectable))}
      </div>
    )
  );

  return (
    <div className="archive-panel">
      <div className="archive-header">
        <h3><Icon name="Books" weight="duotone" size={16} color="var(--primary)" /> Content Archive</h3>
        <div className="archive-tabs">
          <button className={`tab-btn ${activeTab === 'browse' ? 'active' : ''}`} onClick={() => setActiveTab('browse')}>
            <Icon name="MagnifyingGlass" weight="bold" size={16} color="currentColor" /> Browse Archive
          </button>
          <button className={`tab-btn ${activeTab === 'export' ? 'active' : ''}`} onClick={() => setActiveTab('export')}>
            <Icon name="UploadSimple" weight="bold" size={16} color="currentColor" /> Export to Archive
          </button>
          <button className={`tab-btn ${activeTab === 'import' ? 'active' : ''}`} onClick={() => setActiveTab('import')}>
            <Icon name="DownloadSimple" weight="bold" size={16} color="currentColor" /> Import from Archive
          </button>
        </div>
      </div>

      <div className="archive-filters">
        <div className="filter-group">
          <input
            type="text"
            placeholder="Search archive..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
          />
          <button onClick={handleSearch}>Search</button>
        </div>

        <div className="filter-group">
          <select aria-label="Environment" value={selectedTier} onChange={(e) => setSelectedTier(e.target.value)}>
            <option value="">All environments</option>
            {TIERS.map((tier) => <option key={tier} value={tier}>{tier}</option>)}
          </select>

          <select aria-label="Content type" value={selectedType} onChange={(e) => setSelectedType(e.target.value)}>
            <option value="">All Content Types</option>
            <option value="questionset">Question Sets</option>
            <option value="prompt">Prompts</option>
          </select>

          <select aria-label="Game type" value={selectedGameType} onChange={(e) => setSelectedGameType(e.target.value)}>
            <option value="">All Game Types</option>
            {GAME_TYPE_LIST.map((type) => (
              <option key={type.id} value={type.id}>{type.label}</option>
            ))}
          </select>

          <select aria-label="Tag" value={selectedTag} onChange={(e) => setSelectedTag(e.target.value)} disabled={availableTags.length === 0}>
            <option value="">All Tags</option>
            {availableTags.map((tag) => (
              <option key={tag} value={tag}>{tag}</option>
            ))}
          </select>
        </div>
      </div>

      <StatusMessage message={error} tone="error" className="error-message" />
      <StatusMessage message={notice} tone="success" />
      {report.length > 0 && (
        <ul className="archive-report" data-testid="archive-report">
          {report.map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}
        </ul>
      )}

      {activeTab === 'browse' && renderGrid(false)}

      {activeTab === 'export' && (
        <div className="export-section">
          <h4><Icon name="UploadSimple" weight="bold" size={16} color="currentColor" /> Back up from {tierName}</h4>
          <p className="archive-note">
            Engage and public content only. Organisation content is encrypted per organisation and is never archived.
          </p>

          {loading ? (
            <div className="loading">Loading local content...</div>
          ) : (
            <>
              <div className="export-category">
                <div className="category-header">
                  <h5><Icon name="Books" weight="duotone" size={16} color="var(--primary)" /> Question Sets ({exportableSets.length})</h5>
                  <div className="bulk-actions">
                    <button
                      className="btn-secondary btn-small"
                      onClick={() => setSelectedQuestionSets(new Set(exportableSets.map((qs) => selectionKey(qs.scope, qs.id))))}
                    >
                      Select All
                    </button>
                    <button className="btn-secondary btn-small" onClick={() => setSelectedQuestionSets(new Set())}>Clear</button>
                    <button
                      className="btn-primary"
                      onClick={() => handleExportSelected('questionsets')}
                      disabled={selectedQuestionSets.size === 0}
                    >
                      <Icon name="UploadSimple" weight="bold" size={16} color="currentColor" /> Export Selected ({selectedQuestionSets.size})
                    </button>
                  </div>
                </div>

                <div className="archive-grid">
                  {exportableSets.map((qs) => {
                    const key = selectionKey(qs.scope, qs.id);
                    const selected = selectedQuestionSets.has(key);
                    return (
                      <div key={key} className="archive-item">
                        <div className="item-checkbox">
                          <input
                            type="checkbox"
                            aria-label={`Select ${qs.name}`}
                            checked={selected}
                            onChange={() => toggle(setSelectedQuestionSets, selectedQuestionSets, key)}
                          />
                        </div>
                        <div className="item-header">
                          <h4>{qs.name}</h4>
                          <span className="item-type">{libraryLabel(qs.scope)}</span>
                        </div>
                        {qs.description && <p className="item-description">{qs.description}</p>}
                        <div className="item-meta">
                          <span><Icon name="GameController" weight="bold" size={16} color="currentColor" /> {qs.engagementType}</span>
                          <span><Icon name="Question" weight="bold" size={16} color="currentColor" /> {qs.totalQuestions} questions</span>
                          <span><Icon name="CalendarBlank" weight="bold" size={16} color="currentColor" /> {qs.createdAt ? formatDate(qs.createdAt) : 'Unknown'}</span>
                        </div>
                        <div className="item-tags">
                          {qs.active && <span className="tag active">Active</span>}
                          {qs.isAIGenerated && <span className="tag ai">AI Generated</span>}
                        </div>
                        <div className="item-actions">
                          <button className="btn-primary" onClick={() => toggle(setSelectedQuestionSets, selectedQuestionSets, key)}>
                            {selected ? 'Selected' : 'Select for Export'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="export-category">
                <div className="category-header">
                  <h5><Icon name="Sparkle" weight="duotone" size={16} color="var(--primary)" /> AI Prompts ({exportablePrompts.length})</h5>
                  <div className="bulk-actions">
                    <button
                      className="btn-secondary btn-small"
                      onClick={() => setSelectedPrompts(new Set(exportablePrompts.map((p) => p.promptId || p.id)))}
                    >
                      Select All
                    </button>
                    <button className="btn-secondary btn-small" onClick={() => setSelectedPrompts(new Set())}>Clear</button>
                    <button
                      className="btn-primary"
                      onClick={() => handleExportSelected('prompts')}
                      disabled={selectedPrompts.size === 0}
                    >
                      <Icon name="UploadSimple" weight="bold" size={16} color="currentColor" /> Export Selected ({selectedPrompts.size})
                    </button>
                  </div>
                </div>

                <div className="archive-grid">
                  {exportablePrompts.map((prompt) => {
                    const id = prompt.promptId || prompt.id;
                    const selected = selectedPrompts.has(id);
                    return (
                      <div key={id} className="archive-item">
                        <div className="item-checkbox">
                          <input
                            type="checkbox"
                            aria-label={`Select ${prompt.name}`}
                            checked={selected}
                            onChange={() => toggle(setSelectedPrompts, selectedPrompts, id)}
                          />
                        </div>
                        <div className="item-header">
                          <h4>{prompt.name}</h4>
                          <span className="item-type">AI Prompt</span>
                        </div>
                        {prompt.description && <p className="item-description">{prompt.description}</p>}
                        <div className="item-meta">
                          <span><Icon name="GameController" weight="bold" size={16} color="currentColor" /> {prompt.gameType}</span>
                          <span><Icon name="Folder" weight="bold" size={16} color="currentColor" /> {prompt.category}</span>
                          <span><Icon name="CalendarBlank" weight="bold" size={16} color="currentColor" /> {prompt.createdAt ? formatDate(prompt.createdAt) : 'Unknown'}</span>
                        </div>
                        <div className="item-tags">
                          <span className={`tag ${prompt.status}`}>{prompt.status}</span>
                          {prompt.isDefault && <span className="tag default">Default</span>}
                        </div>
                        <div className="item-actions">
                          <button className="btn-primary" onClick={() => toggle(setSelectedPrompts, selectedPrompts, id)}>
                            {selected ? 'Selected' : 'Select for Export'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {activeTab === 'import' && (
        <div className="import-section">
          <h4><Icon name="DownloadSimple" weight="bold" size={16} color="currentColor" /> Restore into {tierName}</h4>
          <div className="import-header">
            <div className="bulk-actions">
              <button
                className="btn-secondary btn-small"
                onClick={() => setSelectedArchiveItems(new Set(visibleItems.map((item) => item.ArchiveId)))}
              >
                Select All
              </button>
              <button className="btn-secondary btn-small" onClick={() => setSelectedArchiveItems(new Set())}>Clear</button>
              <button className="btn-primary" onClick={handleImportSelected} disabled={selectedArchiveItems.size === 0}>
                <Icon name="DownloadSimple" weight="bold" size={16} color="currentColor" /> Import Selected ({selectedArchiveItems.size})
              </button>
            </div>
          </div>
          {renderGrid(true)}
        </div>
      )}
    </div>
  );
};

export default ArchivePanel;
```

- [ ] **Step 4: Mount it with the environment, and correct the subtitle**

In `src/src/AdminPage.jsx`, replace `<ArchivePanel />` with `<ArchivePanel environment={environment} />`.

In both `src/src/AdminPage.jsx` and `src/src/config/consoleSections.js`, replace
`subtitle: 'A shared, public service. The same store backs all three environments.',`
with
`subtitle: 'Backups of Engage and public content. Every environment reads and restores the same store.',`

In `src/src/styles.css`, directly after the `.archive-item .tag { ... }` rule, add:

```css
.archive-item .tag.tier {
  font-weight: 600;
}

/* A production backup is the one to double-check before restoring it anywhere else. */
.archive-item .tag.tier-prod {
  background: var(--primary);
  color: white;
}

.archive-panel .archive-note {
  color: #666;
  margin: 0 0 12px;
}

.archive-panel .archive-report {
  margin: 12px 0;
  padding-left: 20px;
}

.archive-panel .archive-report li + li {
  margin-top: 4px;
}
```

- [ ] **Step 5: Run the tests, lint and build**

Run: `cd src && npx jest src/__tests__/archivePanel.test.jsx src/__tests__/archiveNoDirectCalls.test.js src/__tests__/archiveItems.test.js src/__tests__/archiveFiltering.test.js src/__tests__/promptManagerDialogs.test.jsx; cd ..`
Expected: all five suites pass (8 panel tests, 2 guard tests). `promptManagerDialogs` still passes: its Copy to archive request is unchanged, and a bare id is platform.

Run: `cd src && npm test 2>&1 | tail -5 && npm run lint 2>&1 | tail -3 && npm run build 2>&1 | tail -3; cd ..`
Expected: every suite passes, lint reports 0 errors and no more than 11 warnings, and webpack compiles. The panel's existing `react-hooks/exhaustive-deps` warning on its load effect is one of the 11, so do not add a new one.

- [ ] **Step 6: Commit**

```bash
git add src/src/components/ArchivePanel.jsx src/src/AdminPage.jsx src/src/config/consoleSections.js src/src/styles.css src/src/__tests__/archivePanel.test.jsx src/src/__tests__/archiveNoDirectCalls.test.js
git commit -m "The archive screen works through its own tier and says where every backup came from

Listing, reading, searching and deleting go through the tier's signed relay instead of
unauthenticated browser calls to the archive service, and a guard test keeps that host out
of the frontend. Each backup shows its environment and library, a source's snapshots sit
together newest first, and the list filters by environment. Export names every set's
library and never offers an organisation's. An import is confirmed against the environment
it writes to, and its report leads with what went live. The hand-upload form and the
per-card Import that could never run are gone.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 12: Prove, against live AWS, that every tier reaches the archive

**Files:**
- Create: `scripts/archive-access-check.sh`, `scripts/archive-drill.sh`
- Test (extend): `tests/archive-infrastructure.js` (a section tying both scripts to the template)

**Interfaces:**
- Consumes: the three function names and the mapping from Task 9; `config/archive-service.json`; the relay's `GET /admin/archive/items` (Task 8); export, import, upload-questions and delete-question-set handlers invoked directly with a synthetic Engage-admin event.
- Produces:
  - `scripts/archive-access-check.sh preflight|verify [stack...]`, defaulting to all three tiers; exits non-zero on any failure. For each tier, `preflight` checks that each archive function names the execute-api URL, that IAM simulation allows the calls that function makes, and that the tier's relay lists the archive. `verify` runs the same checks and also requires an unsigned request to be refused with 403.
  - `scripts/archive-drill.sh engagedev|engagetest`: a restore drill with a throwaway inactive set and one image. It refuses `engageprod`.

- [ ] **Step 1: Write the failing test section**

In `tests/archive-infrastructure.js`, insert this block immediately before the final `console.log(\`\n${pass} passed, ${fail} failed\`);` line:

```js
console.log('\n5. the live checks look at exactly what the template grants');
const accessCheck = fs.existsSync(path.join(REPO, 'scripts/archive-access-check.sh')) ? read('scripts/archive-access-check.sh') : '';
const drill = fs.existsSync(path.join(REPO, 'scripts/archive-drill.sh')) ? read('scripts/archive-drill.sh') : '';
const bashArray = (src, name) => {
  const m = new RegExp(`\\n${name}=\\(([^)]*)\\)`).exec(src);
  return m ? m[1].trim().split(/\s+/) : null;
};
check('archive-access-check.sh checks all three tiers by default', () => {
  assert.deepStrictEqual(bashArray(accessCheck, 'TIERS'), ['engagedev', 'engagetest', 'engageprod']);
});
check('...and exactly the functions that call the archive', () => {
  assert.deepStrictEqual((bashArray(accessCheck, 'FUNCTIONS') || []).slice().sort(), ARCHIVE_CALLERS);
});
check('...reads the API id from config/archive-service.json, the file the mapping is pinned to', () => {
  assert.ok(accessCheck.includes('config/archive-service.json'));
});
check('...has both modes, and verify requires an unsigned request to be refused', () => {
  assert.ok(/preflight\|verify\)/.test(accessCheck), 'no preflight|verify case');
  assert.ok(/403/.test(accessCheck) && /curl/.test(accessCheck), 'verify must prove an unsigned request is refused');
});
check('the drill refuses production and covers the functions a restore uses', () => {
  assert.ok(/engageprod\)[^\n]*exit 2/.test(drill), 'the drill must refuse engageprod');
  for (const fn of ['admin-upload-questions', 'admin-export-to-archive', 'admin-delete-question-set', 'admin-import-from-archive', 'admin-archive-items']) {
    assert.ok(drill.includes(fn), `the drill does not use ${fn}`);
    if (fn !== 'admin-archive-items' && fn !== 'admin-export-to-archive' && fn !== 'admin-import-from-archive') {
      assert.ok(template.includes(`FunctionName: !Sub '\${StackName}-${fn}'`), `${fn} is not a function in the template`);
    }
  }
});
```

Run: `node tests/archive-infrastructure.js; echo "exit $?"`
Expected: exit 1, with the five section-5 checks failing because the scripts do not exist.

- [ ] **Step 2: Create the access check**

Create `scripts/archive-access-check.sh`:

```bash
#!/bin/bash
# DOES EVERY TIER STILL REACH THE SHARED ARCHIVE?
#
#   scripts/archive-access-check.sh preflight [stack...]   before the archive is locked
#   scripts/archive-access-check.sh verify    [stack...]   after it is locked
#
# The archive (engage2-archive-service) is one service behind dev, test and prod. Once its
# routes require AWS_IAM, a tier whose functions do not sign, or whose roles may not invoke,
# loses its backups and its restores at the same moment. This proves, per tier:
#
#   preflight  each archive function names the execute-api URL, IAM simulation allows the
#              calls it makes, and the tier's relay lists the archive with a signed request
#   verify     all of that, plus: an UNSIGNED request is refused
#
# Read-only, apart from one Lambda invocation per tier that LISTS the archive.
# scripts/deploy-archive.sh runs `preflight` before deploying and `verify` after.
# tests/archive-infrastructure.js keeps TIERS and FUNCTIONS in step with the template.
set -euo pipefail
cd "$(dirname "$0")/.."

MODE="${1:-}"
if [ "$#" -gt 0 ]; then shift; fi
TIERS=(engagedev engagetest engageprod)
if [ "$#" -gt 0 ]; then TIERS=("$@"); fi
FUNCTIONS=(admin-export-to-archive admin-import-from-archive admin-archive-items)
export AWS_PROFILE="${AWS_PROFILE:-adminaccess}"
export AWS_REGION="us-east-1"

case "$MODE" in
  preflight|verify) ;;
  *) echo "usage: $0 preflight|verify [stack...]" >&2; exit 2 ;;
esac

API_ID=$(node -p "new URL(require('./config/archive-service.json').archiveApiUrl).hostname.split('.')[0]")
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
URL="https://${API_ID}.execute-api.${AWS_REGION}.amazonaws.com"
FAILURES=0
ok() { echo "  ok   - $*"; }
fail() { echo "  FAIL - $*"; FAILURES=$((FAILURES + 1)); }

# The archive routes each function calls, as METHOD/path.
calls_for() {
  case "$1" in
    admin-export-to-archive) echo "POST/archive/items" ;;
    admin-import-from-archive) echo "GET/archive/items/probe" ;;
    admin-archive-items) echo "GET/archive/items GET/archive/items/probe POST/archive/search DELETE/archive/items/probe" ;;
  esac
}

check_tier() {
  local stack="$1" fn name conf url role call decision out status
  echo "$stack"
  for fn in "${FUNCTIONS[@]}"; do
    name="${stack}-${fn}"
    if ! conf=$(aws lambda get-function-configuration --function-name "$name" --output json 2>/dev/null); then
      fail "$name does not exist — this tier has not deployed the signed archive client"
      continue
    fi
    url=$(echo "$conf" | jq -r '.Environment.Variables.ARCHIVE_SERVICE_URL // ""')
    if [ "$url" = "$URL" ]; then ok "$fn calls $URL"; else fail "$fn calls '${url}', not $URL"; fi
    role=$(echo "$conf" | jq -r '.Role')
    for call in $(calls_for "$fn"); do
      decision=$(aws iam simulate-principal-policy --policy-source-arn "$role" --action-names execute-api:Invoke \
        --resource-arns "arn:aws:execute-api:${AWS_REGION}:${ACCOUNT}:${API_ID}/\$default/${call}" \
        --query 'EvaluationResults[0].EvalDecision' --output text)
      if [ "$decision" = "allowed" ]; then ok "$fn may invoke $call"; else fail "$fn may not invoke $call ($decision)"; fi
    done
  done
  out=$(mktemp)
  if aws lambda invoke --function-name "${stack}-admin-archive-items" --cli-binary-format raw-in-base64-out \
      --payload '{"requestContext":{"routeKey":"GET /admin/archive/items","authorizer":{"lambda":{"groups":"admins","userId":"archive-access-check"}}}}' \
      "$out" >/dev/null 2>&1; then
    status=$(jq -r '.statusCode' "$out")
    if [ "$status" = "200" ]; then
      ok "$stack lists the archive with a signed request ($(jq -r '.body | fromjson | (.count // (.items | length))' "$out") items)"
    else
      fail "$stack's relay answered $status: $(jq -r '.body' "$out")"
    fi
  else
    fail "could not invoke ${stack}-admin-archive-items"
  fi
  rm -f "$out"
}

for stack in "${TIERS[@]}"; do check_tier "$stack"; done

if [ "$MODE" = "verify" ]; then
  echo "strangers"
  code=$(curl -s -o /dev/null -w '%{http_code}' "${URL}/archive/items")
  if [ "$code" = "403" ]; then ok "an unsigned request is refused (403)"; else fail "an unsigned request answered $code — the archive is not locked"; fi
fi

echo
if [ "$FAILURES" -eq 0 ]; then echo "all checks passed"; else echo "${FAILURES} check(s) failed"; exit 1; fi
```

- [ ] **Step 3: Create the restore drill**

Create `scripts/archive-drill.sh`:

```bash
#!/bin/bash
# A BACKUP NOBODY HAS RESTORED IS A HOPE. This drill restores one, end to end, on a live tier.
#
#   scripts/archive-drill.sh engagedev
#   scripts/archive-drill.sh engagetest
#
# It creates a throwaway, INACTIVE Engage set with one uploaded image and backs it up. Then it
# deletes the set and the image, restores them from the archive, and checks that the questions
# and the image came back under the original id. Finally it removes everything it made: the
# set, the image, the archive item and the item's copied media. It drives the tier's own Lambda
# functions with a synthetic Engage-admin event, so it exercises the roles a real restore uses.
#
# REFUSES engageprod. Production is restored from the admin screen, by a person.
set -euo pipefail
cd "$(dirname "$0")/.."

STACK="${1:-}"
case "$STACK" in
  engagedev|engagetest) ;;
  engageprod) echo "Refusing engageprod: back up and restore from the admin screen instead." >&2; exit 2 ;;
  *) echo "usage: $0 engagedev|engagetest" >&2; exit 2 ;;
esac
export AWS_PROFILE="${AWS_PROFILE:-adminaccess}"
export AWS_REGION="us-east-1"

SET_ID="archivedrill$(date -u +%Y%m%d%H%M%S)"
MEDIA_BUCKET="${STACK}-media"
ARCHIVE_BUCKET="engage2-archive-content"
TABLE=$(aws cloudformation describe-stack-resources --stack-name "$STACK" --logical-resource-id GameTable \
  --query 'StackResources[0].PhysicalResourceId' --output text)
WORK=$(mktemp -d)
ARCHIVE_ID=""
SNAPSHOT_ID=""
ADMIN='{"groups":"admins","userId":"archive-drill","username":"archive-drill"}'
FAILED=0

# invoke <function-suffix> <event-json>: prints the response body, fails on a non-200.
invoke() {
  local out="$WORK/response.json"
  aws lambda invoke --function-name "${STACK}-$1" --cli-binary-format raw-in-base64-out --payload "$2" "$out" >/dev/null
  if [ "$(jq -r '.statusCode' "$out")" != "200" ]; then
    echo "  FAIL - ${STACK}-$1 answered $(jq -r '.statusCode' "$out"): $(jq -r '.body' "$out")" >&2
    return 1
  fi
  jq -r '.body' "$out"
}
delete_set_event() {
  jq -nc --arg id "$SET_ID" --argjson a "$ADMIN" \
    '{requestContext:{routeKey:"DELETE /admin/question-sets/{setId}",authorizer:{lambda:$a}},pathParameters:{setId:$id}}'
}
cleanup() {
  set +e
  invoke admin-delete-question-set "$(delete_set_event)" >/dev/null 2>&1
  aws s3 rm "s3://${MEDIA_BUCKET}/sets/${SET_ID}/drill.png" >/dev/null 2>&1
  if [ -n "$ARCHIVE_ID" ]; then
    invoke admin-archive-items "$(jq -nc --arg id "$ARCHIVE_ID" --argjson a "$ADMIN" \
      '{requestContext:{routeKey:"DELETE /admin/archive/items/{archiveId}",authorizer:{lambda:$a}},pathParameters:{archiveId:$id}}')" >/dev/null 2>&1
  fi
  if [ -n "$SNAPSHOT_ID" ]; then
    aws s3 rm "s3://${ARCHIVE_BUCKET}/archive/media/${SNAPSHOT_ID}/" --recursive >/dev/null 2>&1
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT
expect() { if [ "$2" = "$3" ]; then echo "  ok   - $1"; else echo "  FAIL - $1: expected $3, got $2"; FAILED=1; fi; }

echo "archive drill on $STACK, set $SET_ID"

echo "1. create an inactive Engage set with one uploaded image"
node -e "process.stdout.write(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAMAASsJTYQAAAAASUVORK5CYII=','base64'))" > "$WORK/drill.png"
aws s3 cp "$WORK/drill.png" "s3://${MEDIA_BUCKET}/sets/${SET_ID}/drill.png" --content-type image/png >/dev/null
CSV=$'Category,Title,Detail,Image\nDrill One,First drill question,Detail one,drill.png\nDrill One,Second drill question,Detail two,\nDrill Two,Third drill question,Detail three,'
invoke admin-upload-questions "$(jq -nc --arg id "$SET_ID" --arg csv "$CSV" --argjson a "$ADMIN" \
  '{requestContext:{authorizer:{lambda:$a}},body:({fileName:($id+".csv"),fileContent:$csv,customTitle:$id,scope:"platform",startInactive:true}|tojson)}')" >/dev/null
echo "  ok   - created"

echo "2. back it up"
EXPORT=$(invoke admin-export-to-archive "$(jq -nc --arg id "$SET_ID" --argjson a "$ADMIN" \
  '{requestContext:{authorizer:{lambda:$a}},body:({selectedItems:[{scope:"platform",id:$id}],exportType:"questionsets"}|tojson)}')")
ARCHIVE_ID=$(echo "$EXPORT" | jq -r '.results.successful[0].archiveId // empty')
SNAPSHOT_ID=$(echo "$EXPORT" | jq -r '.results.successful[0].snapshotId // empty')
if [ -z "$ARCHIVE_ID" ]; then echo "  FAIL - nothing was archived: $(echo "$EXPORT" | jq -c '.results.failed')"; exit 1; fi
expect "archived with its image" "$(echo "$EXPORT" | jq -r '.results.successful[0].media.copied')" "1"

echo "3. lose it: delete the set and its image"
invoke admin-delete-question-set "$(delete_set_event)" >/dev/null
aws s3 rm "s3://${MEDIA_BUCKET}/sets/${SET_ID}/drill.png" >/dev/null
expect "the set is gone" "$(aws dynamodb get-item --table-name "$TABLE" --key "{\"PK\":{\"S\":\"SETS\"},\"SK\":{\"S\":\"SET#${SET_ID}\"}}" --query 'Item.SK.S' --output text)" "None"

echo "4. restore it"
IMPORT=$(invoke admin-import-from-archive "$(jq -nc --arg arc "$ARCHIVE_ID" --argjson a "$ADMIN" \
  '{requestContext:{authorizer:{lambda:$a}},body:({selectedItems:[$arc]}|tojson)}')")
expect "restored under its original id" "$(echo "$IMPORT" | jq -r '.results.successful[0].id')" "$SET_ID"
expect "recreated rather than versioned" "$(echo "$IMPORT" | jq -r '.results.successful[0].mode')" "created"
expect "still inactive" "$(echo "$IMPORT" | jq -r '.results.successful[0].active')" "false"
expect "its image came back" "$(echo "$IMPORT" | jq -r '.media.copied')" "1"
ROWS=$(aws dynamodb query --table-name "$TABLE" --key-condition-expression 'PK = :pk' \
  --expression-attribute-values "{\":pk\":{\"S\":\"SET#${SET_ID}#v1\"}}" --select COUNT --query Count --output text)
expect "all five content rows are back (2 categories, 3 questions)" "$ROWS" "5"
if aws s3api head-object --bucket "$MEDIA_BUCKET" --key "sets/${SET_ID}/drill.png" >/dev/null 2>&1; then
  echo "  ok   - the image object exists again"
else
  echo "  FAIL - the image object is missing"; FAILED=1
fi

if [ "$FAILED" -eq 0 ]; then echo "drill passed on $STACK"; else echo "drill FAILED on $STACK"; exit 1; fi
```

Then make both scripts executable: `chmod +x scripts/archive-access-check.sh scripts/archive-drill.sh`.

- [ ] **Step 4: Run the test, and syntax-check the scripts**

Run: `node tests/archive-infrastructure.js; echo "exit $?"; bash -n scripts/archive-access-check.sh && bash -n scripts/archive-drill.sh && echo "syntax ok"; scripts/archive-drill.sh engageprod; echo "exit $?"`
Expected: `18 passed, 0 failed`, exit 0; then `syntax ok`; then `Refusing engageprod: …` with exit 2. Nothing touches AWS. The live runs happen in Task 13.

- [ ] **Step 5: Commit**

```bash
git add scripts/archive-access-check.sh scripts/archive-drill.sh tests/archive-infrastructure.js
git commit -m "Two scripts prove against live AWS that every tier can use the archive

archive-access-check.sh checks each tier's archive functions for the execute-api URL,
simulates their IAM permission for the calls each makes, and has the tier's relay list the
archive with a signed request. After the lock it also requires an unsigned request to be
refused. archive-drill.sh backs up a throwaway inactive set with an image, deletes both,
restores them and checks what came back, on dev or test only. The infrastructure test keeps
both scripts naming the functions the template actually grants.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 13: Ship Phase 1 — dev, then test, then prod to the gate

**Run by the controlling session, not a subagent.** Each push is a deploy, and prod ends at the owner's approval.

**Files:** none changed. This task pushes Tasks 1–12.

**Interfaces:**
- Consumes: Tasks 1–12 committed on local `dev`, and both scripts from Task 12.
- Produces: the signed archive client live on dev, test and prod, and `scripts/archive-access-check.sh preflight` passing for all three tiers. Task 15 requires that.

Rollout note to include in the owner report: while tiers run different versions, a snapshot exported from an upgraded tier cannot be restored by a tier still on the old import. The old import fails that item loudly and writes nothing. Legacy items restore everywhere.

- [ ] **Step 1: The full gate, on the exact tree that will ship**

```bash
git status --short            # expect: nothing
rm -rf .aws-sam lambda-functions/dist lambda-functions/admin/.aws-sam
fails=0; for f in tests/*.js; do case "$f" in *.spec.js) continue;; esac; node "$f" >/dev/null 2>&1 || { echo "FAIL $f"; fails=$((fails+1)); }; done; echo "failed suites: $fails"
(cd src && npm test 2>&1 | tail -4 && npm run lint 2>&1 | tail -2 && npm run build 2>&1 | tail -2)
node scripts/generate-api-doc.js --check
```
Expected: `failed suites: 0`; every frontend suite passes; lint 0 errors and no more than 11 warnings; the build compiles; `api.md is current (108 routes)`. Anything else is a stop. Fix it in a new commit, and never push around it.

- [ ] **Step 2: Deploy dev with a branch push**

```bash
git log --oneline origin/dev..dev   # the commits about to ship: Tasks 1–12 (and the spec and plan commits)
git push origin dev
```

Then wait for the dev pipeline, re-checking every few minutes (a run takes roughly 15). Use a Monitor until-loop rather than a foreground sleep.

```bash
AWS_PROFILE=adminaccess aws codepipeline list-pipeline-executions --pipeline-name engagecicd-pipeline-dev --max-items 1 \
  --query 'pipelineExecutionSummaries[0].[status,sourceRevisions[0].revisionId]' --output text
```
Expected: `Succeeded` with the pushed `dev` sha. On `Failed`, read the CodeBuild log for that execution, fix the fault in a new commit, and re-run from Step 1.

- [ ] **Step 3: Prove dev reaches the archive and can restore**

```bash
scripts/archive-access-check.sh preflight engagedev
scripts/archive-drill.sh engagedev
```
Expected: `all checks passed` and `drill passed on engagedev`. The pre-flight's relay listing is the first live proof that the open archive accepts a signed request (spec §8). If it answers 403, the premise of the rollout is wrong. Stop and report; do not continue to test.

- [ ] **Step 4: Promote to test by merging (never fast-forward, never force)**

```bash
git fetch origin test
git merge-tree --write-tree origin/test dev    # prints a tree id; a conflict listing means stop and report
git checkout -B promote-test origin/test
git merge dev -m "Merge branch 'dev' into test"
```
Re-run the whole Step 1 gate on this merged tree. Then:
```bash
git push origin promote-test:test
git checkout dev
```
Wait for `engagecicd-pipeline-test` exactly as in Step 2, then:
```bash
scripts/archive-access-check.sh preflight engagetest
scripts/archive-drill.sh engagetest
```
Expected: both pass.

- [ ] **Step 5: Start prod, which halts at the owner's gate**

```bash
git fetch origin prod test
git merge-base --is-ancestor origin/prod origin/test && echo "fast-forward ok"
TEST_SHA=$(git rev-parse origin/test)
git push origin "${TEST_SHA}:refs/heads/prod"
```
Expected: `fast-forward ok` before the push. If it does not print, stop and report; do not force. Confirm the prod execution is waiting at `ApprovalForProd`:
```bash
AWS_PROFILE=adminaccess aws codepipeline get-pipeline-state --name engagecicd-pipeline-prod \
  --query 'stageStates[].[stageName,latestExecution.status]' --output text
```

- [ ] **Step 6: Report, and wait for the owner**

Tell the owner which commit is on each tier, that dev and test passed the access check and the restore drill, and that prod is waiting at `ApprovalForProd`. Include the rollout note above. After they approve and the prod run has `Succeeded`, run the read-only check (never the drill on prod):
```bash
scripts/archive-access-check.sh preflight engageprod
```
Expected: `all checks passed`. That completes the precondition for Task 15.

---

## Part B — Phase 2: lock the archive (hand-deployed, after Phase 1 is live everywhere)

### Task 14: The archive stack's lock-down, Node 22 and retention — as code

This task changes files only. The archive stack sits outside every pipeline, so no push reaches it; it changes only when `scripts/deploy-archive.sh` runs, and that script refuses to lock the archive until every tier passes the pre-flight.

**Files:**
- Modify: `template-archive.yaml`, `scripts/deploy-archive.sh` (rewrite), `lambda-functions/archive/package.json`, `tests/template-validates.js`, `DEPLOYMENT.md`
- Modify (rewrite): `docs/architecture/archive-service.md`
- Test (extend): `tests/archive-infrastructure.js`

**Interfaces:**
- Consumes: `scripts/archive-access-check.sh` (Task 12).
- Produces: `template-archive.yaml` with `AWS_IAM` as the API's default authorizer, no CORS, `nodejs22.x`, `Retain` on the table and bucket, and point-in-time recovery on the table. `scripts/deploy-archive.sh` runs `preflight`, builds into `.aws-sam/archive-build`, deploys, writes `config/archive-service.json`, then runs `verify`.

- [ ] **Step 1: Write the failing test section**

In `tests/archive-infrastructure.js`, insert this block immediately before the final `console.log(\`\n${pass} passed, ${fail} failed\`);` line:

```js
console.log('\n6. the archive stack itself is locked, current and retained');
const archiveTemplate = read('template-archive.yaml');
check('every function runs nodejs22.x, and nothing names nodejs18.x', () => {
  assert.match(archiveTemplate, /\nGlobals:\n {2}Function:\n[\s\S]*?\n {4}Runtime: nodejs22\.x\n/);
  assert.ok(!archiveTemplate.includes('nodejs18.x'));
});
check('the API requires AWS_IAM by default, no event opts out, and there is no browser CORS', () => {
  const api = resourceBlock(archiveTemplate, 'ArchiveApi');
  assert.match(api, /Auth:\s*\n\s*EnableIamAuthorizer: true\s*\n\s*DefaultAuthorizer: AWS_IAM/);
  assert.ok(!/CorsConfiguration/.test(api), 'no browser calls the archive any more');
  assert.ok(!/Authorizer:\s*NONE/.test(archiveTemplate), 'an event opted out of IAM');
  assert.ok(!archiveTemplate.includes('CORS_ALLOWED_ORIGINS'));
});
check('the backups survive a template edit or a deleted stack', () => {
  for (const id of ['ArchiveTable', 'ArchiveBucket']) {
    const block = resourceBlock(archiveTemplate, id);
    assert.match(block, /\n {4}DeletionPolicy: Retain\n/, `${id} is not retained on delete`);
    assert.match(block, /\n {4}UpdateReplacePolicy: Retain\n/, `${id} is not retained on replacement`);
  }
  assert.match(resourceBlock(archiveTemplate, 'ArchiveTable'), /PointInTimeRecoverySpecification:\s*\n\s*PointInTimeRecoveryEnabled: true/);
});
check('deploy-archive.sh runs the pre-flight before deploying and the verification after', () => {
  const deploy = read('scripts/deploy-archive.sh');
  const preflight = deploy.indexOf('scripts/archive-access-check.sh preflight');
  const samDeploy = deploy.indexOf('sam deploy');
  const verify = deploy.indexOf('scripts/archive-access-check.sh verify');
  assert.ok(preflight !== -1 && samDeploy !== -1 && verify !== -1, 'a step is missing');
  assert.ok(preflight < samDeploy && samDeploy < verify, 'the order is preflight, deploy, verify');
  assert.ok(deploy.includes('set -euo pipefail'), 'a failed pre-flight must stop the script');
  assert.ok(deploy.includes('--build-dir'), 'build into its own directory, not over the main stack build');
});
check('the presigner get-archive-item.js requires is declared, not borrowed from the runtime', () => {
  const pkg = JSON.parse(read('lambda-functions/archive/package.json'));
  assert.ok(read('lambda-functions/archive/get-archive-item.js').includes('@aws-sdk/s3-request-presigner'));
  assert.ok(pkg.dependencies['@aws-sdk/s3-request-presigner'], 'declare @aws-sdk/s3-request-presigner');
});
```

Run: `node tests/archive-infrastructure.js; echo "exit $?"`
Expected: exit 1, with the five section-6 checks failing.

- [ ] **Step 2: Lock, update and retain the archive stack**

In `template-archive.yaml`, replace

```yaml
Globals:
  Function:
    Timeout: 30
    Runtime: nodejs18.x
    Environment:
      Variables:
        TABLE_NAME: !Ref ArchiveTable
        ARCHIVE_BUCKET_NAME: !Ref ArchiveBucket
        CORS_ALLOWED_ORIGINS: "*"  # Will restrict this in production
```

with

```yaml
Globals:
  Function:
    Timeout: 30
    # Off nodejs18.x, which receives no security patches and fails `sam validate --lint`.
    # The same runtime as template-clean.yaml.
    Runtime: nodejs22.x
    Environment:
      Variables:
        TABLE_NAME: !Ref ArchiveTable
        ARCHIVE_BUCKET_NAME: !Ref ArchiveBucket
```

Replace

```yaml
  ArchiveTable:
    Type: AWS::DynamoDB::Table
    Properties:
```

with

```yaml
  # THE BACKUPS ARE RETAINED. This stack was once applied from a reconstructed template and
  # silently lost permissions (see DeleteArchiveFunction). A template edit that replaces the
  # table, or a deleted stack, must not take every tier's backups with it.
  ArchiveTable:
    Type: AWS::DynamoDB::Table
    DeletionPolicy: Retain
    UpdateReplacePolicy: Retain
    Properties:
```

In the same resource, directly after the `KeySchema:` list (before `TimeToLiveSpecification:`), add:

```yaml
      # A deleted or overwritten index row is recoverable for 35 days; content objects have
      # the bucket's 90-day noncurrent versions.
      PointInTimeRecoverySpecification:
        PointInTimeRecoveryEnabled: true
```

Replace

```yaml
  ArchiveBucket:
    Type: AWS::S3::Bucket
    Properties:
```

with

```yaml
  ArchiveBucket:
    Type: AWS::S3::Bucket
    DeletionPolicy: Retain
    UpdateReplacePolicy: Retain
    Properties:
```

Replace the whole `ArchiveApi` resource (its `CorsConfiguration` block included) with:

```yaml
  # EVERY ROUTE REQUIRES A SIGNED AWS REQUEST. The callers are the three tiers' archive
  # functions (template-clean.yaml), which sign with their roles; scripts/archive-access-check.sh
  # proves each tier can. No CORS: no browser calls this API any more, because the admin screen
  # goes through its own tier (lambda-functions/admin/archive-items.js).
  ArchiveApi:
    Type: AWS::Serverless::HttpApi
    Properties:
      Auth:
        EnableIamAuthorizer: true
        DefaultAuthorizer: AWS_IAM
```

In `lambda-functions/archive/package.json`, add `"@aws-sdk/s3-request-presigner": "^3.600.0",` to `dependencies`, directly after the `@aws-sdk/client-s3` line.

- [ ] **Step 3: Rewrite the deploy script**

Replace the whole of `scripts/deploy-archive.sh` with:

```bash
#!/bin/bash
# DEPLOY THE SHARED ARCHIVE SERVICE (stack engage2-archive-service) — by hand; no pipeline reaches it.
#
# One archive serves dev, test AND prod, and its routes require AWS_IAM. Deploying it while any
# tier still calls it unsigned locks that tier out of its backups. So this script REFUSES to
# deploy until scripts/archive-access-check.sh passes for every tier, and afterwards runs the
# check again to prove every tier still gets in and a stranger does not.
#
# Rollback: deploy the same template with the ArchiveApi `Auth:` block removed. The table and
# bucket are retained whatever the template says, so no rollback can delete a backup.
set -euo pipefail
cd "$(dirname "$0")/.."

STACK_NAME="engage2-archive-service"
TEMPLATE_FILE="template-archive.yaml"
BUILD_DIR=".aws-sam/archive-build"
DOMAIN_NAME="archive.seibtribe.us"
HOSTED_ZONE_ID="ZB9TUA073B5SH"
export AWS_REGION="us-east-1"
export AWS_PROFILE="${AWS_PROFILE:-adminaccess}"

echo "== 1. pre-flight: can every tier sign its archive calls, and may it invoke? =="
scripts/archive-access-check.sh preflight

echo "== 2. build and deploy ${STACK_NAME} =="
sam build -t "$TEMPLATE_FILE" --build-dir "$BUILD_DIR"
sam deploy \
  --stack-name "$STACK_NAME" \
  --template-file "$BUILD_DIR/template.yaml" \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides DomainName="$DOMAIN_NAME" HostedZoneId="$HOSTED_ZONE_ID" \
  --resolve-s3 \
  --no-confirm-changeset \
  --no-fail-on-empty-changeset

output() {
  aws cloudformation describe-stacks --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}
cat > config/archive-service.json <<EOF
{
  "archiveServiceUrl": "$(output ArchiveDomainUrl)",
  "archiveApiUrl": "$(output ArchiveApiUrl)",
  "tableName": "$(output ArchiveTableName)",
  "bucketName": "$(output ArchiveBucketName)",
  "region": "${AWS_REGION}"
}
EOF
echo "wrote config/archive-service.json"
if ! git diff --quiet -- config/archive-service.json; then
  echo "WARNING: the archive API id changed. Update ArchiveService in template-clean.yaml, run the suites, and redeploy every tier." >&2
fi

echo "== 3. verify: every tier still gets in, and a stranger does not =="
scripts/archive-access-check.sh verify
```

- [ ] **Step 4: Enforce the archive template's validation**

In `tests/template-validates.js`, replace everything from the comment line ``/**`` that begins `` * `template-archive.yaml` is NOT enforced, and this is not laziness.`` through the end of the `for (const tpl of REPORTED) { ... }` loop with:

```js
/**
 * ALL THREE TEMPLATES ARE ENFORCED.
 *
 * template-archive.yaml was only reported while it pinned nodejs18.x, which fails the lint.
 * It moved to nodejs22.x in the archive lock-down
 * (docs/superpowers/specs/2026-09-14-archive-full-fidelity-design.md, amendment A1), so it now
 * has to transform and lint as cleanly as the other two.
 */
const ENFORCED = ['template-clean.yaml', 'template-monitoring.yaml', 'template-archive.yaml'];

for (const tpl of ENFORCED) {
  console.log(`\n${tpl}`);
  check('transforms and lints cleanly', () => {
    try {
      execFileSync('sam', ['validate', '-t', path.join(REPO, tpl), '--lint'],
        { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      const out = `${e.stdout || ''}${e.stderr || ''}`.trim();
      throw new Error(out.split('\n').slice(0, 6).join('\n'));
    }
  });
}
```

(The original `ENFORCED` constant, the enforced loop and the `REPORTED` block are all inside that span. After the edit, `ENFORCED` must be declared once.)

- [ ] **Step 5: Correct the documentation**

Replace the whole of `docs/architecture/archive-service.md` with:

````markdown
# The shared archive service

**One archive serves dev, test and prod.** It backs up Engage (platform) and public question
sets and prompts as full-fidelity snapshots, and any tier can restore any tier's backup into its
own Engage library. Design: `docs/superpowers/specs/2026-09-14-archive-full-fidelity-design.md`.

## Pieces

| Piece | What | Where |
|---|---|---|
| Stack | `engage2-archive-service`, deployed by hand | `template-archive.yaml`, `scripts/deploy-archive.sh` |
| API | HTTP API `9gi7xpycsf`, **every route `AWS_IAM`** | `lambda-functions/archive/*.js` |
| Index | DynamoDB `engage2-archive`, `PK=ARCHIVE`, `SK=ITEM#<id>`; retained; point-in-time recovery | |
| Content | S3 `engage2-archive-content`; versioned (90-day noncurrent); retained | `archive/<type>/<id>.*`, images under `archive/media/<snapshotId>/` |
| Callers | each tier's `admin-export-to-archive`, `admin-import-from-archive`, `admin-archive-items` | `template-clean.yaml`, `lambda-functions/admin/` |

`archive.seibtribe.us` (CloudFront) still exists but is unused: a SigV4 signature covers the Host
header, which CloudFront rewrites, so signed callers use the execute-api endpoint directly.

## Who can do what

- **The browser never calls the archive.** The admin screen calls its own tier's routes, which
  require the tier's sign-in, the `admins` group, and `canManageScope(PLATFORM)`: Engage staff
  with no organisation selected.
- **Each tier's functions sign their calls** with their Lambda role (`shared/archive-client.js`).
  All three tiers deploy the same `execute-api:Invoke` grant, and the archive API id comes from
  one template mapping pinned to `config/archive-service.json`.
- **Organisation content is never archived.** It is encrypted per organisation, and anything
  carrying an encrypted value is refused on export and on import.

## Proving every tier can reach it

```bash
scripts/archive-access-check.sh preflight   # per tier: URL, IAM simulation, a signed list
scripts/archive-access-check.sh verify      # the same, plus: an unsigned request is refused
scripts/archive-drill.sh engagedev          # back up, delete, restore and check a throwaway set (dev or test)
```

## Deploying it

```bash
aws sso login --profile adminaccess
scripts/deploy-archive.sh
```

The script refuses to deploy unless `preflight` passes for all three tiers, and runs `verify`
afterwards. To roll back the lock, deploy the template with the `ArchiveApi` `Auth:` block
removed. The table and bucket are retained, so no rollback deletes a backup.
````

In `DEPLOYMENT.md`, replace the bullet

```markdown
- `template-archive.yaml:21` still pins `nodejs18.x` (EOL). `template-clean.yaml`
  and `template-monitoring.yaml` are on `nodejs22.x`. The archive stack is
  hand-deployed via `scripts/deploy-archive.sh`.
```

with

```markdown
- The shared archive (`template-archive.yaml`) is on `nodejs22.x` and requires
  signed AWS requests on every route. It is the one stack deployed by hand, with
  `scripts/deploy-archive.sh`, which refuses to deploy until
  `scripts/archive-access-check.sh preflight` passes for dev, test and prod. See
  `docs/architecture/archive-service.md`.
```

- [ ] **Step 6: Run the checks**

Run:
```bash
node tests/archive-infrastructure.js; echo "exit $?"
node tests/template-validates.js; echo "exit $?"
bash -n scripts/deploy-archive.sh && echo "syntax ok"
node tests/no-retired-twin-references.js; echo "exit $?"
```
Expected: `23 passed, 0 failed`; `template-validates.js` exits 0 with three `ok - transforms and lints cleanly` lines; `syntax ok`; the twin guard exits 0. Then run the full backend loop. Expected: `failed suites: 0`.

If `sam validate --lint` rejects the archive template, fix the YAML it names. Do not move the template back to *reported*.

- [ ] **Step 7: Commit (and do not deploy)**

```bash
git add template-archive.yaml scripts/deploy-archive.sh lambda-functions/archive/package.json tests/template-validates.js tests/archive-infrastructure.js docs/architecture/archive-service.md DEPLOYMENT.md
git commit -m "The archive stack's lock-down, Node 22 move and retention are ready to deploy

Every archive route will require a signed AWS request, and browser CORS goes, since only the
tiers' own functions call it now. The functions move off Node 18. The backup table and
bucket are retained whatever a future template says, and the table gains point-in-time
recovery. deploy-archive.sh refuses to deploy unless every tier passes the access
pre-flight, builds in its own directory, and verifies afterwards that each tier still gets
in and a stranger does not. The archive template is now held to the same validation as the
others. Nothing here deploys: the archive stack is outside the pipeline.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 15: Lock the archive — with the owner's go-ahead

**Run by the controlling session, not a subagent.** This deploys a stack that production's backups depend on, outside the pipeline and its approval gate.

**Files:** none changed, except `config/archive-service.json` if the deploy reports a different API id. It should not.

**Interfaces:**
- Consumes: Task 13 complete (prod `Succeeded` on the Phase 1 commit, and `preflight engageprod` passing); Task 14 committed.
- Produces: the archive requires `AWS_IAM`, runs `nodejs22.x`, retains its data, and `verify` and the dev and test drills pass.

- [ ] **Step 1: Confirm the preconditions from live state, not memory**

```bash
AWS_PROFILE=adminaccess aws codepipeline list-pipeline-executions --pipeline-name engagecicd-pipeline-prod --max-items 1 \
  --query 'pipelineExecutionSummaries[0].[status,sourceRevisions[0].revisionId]' --output text
scripts/archive-access-check.sh preflight
git status --short && git log --oneline -1 -- template-archive.yaml
```
Expected: prod `Succeeded` on a commit that contains Task 12. The pre-flight ends `all checks passed` for all three tiers. The working tree is clean, with the Task 14 commit as the last change to `template-archive.yaml`. If any of these fails, stop and report.

- [ ] **Step 2: Preview the change, then ask the owner and wait for an explicit yes**

```bash
scripts/deploy-archive.sh preview
```
Expected: the commit it builds, the pre-flight `all checks passed` for all three tiers, the change set, then `Nothing was deployed`. Read the change set: every change should be `* Modify` with Replacement `False`, and none should be `- Delete`. If it shows anything else, stop and report it.

Then say, in plain words: every tier passed the pre-flight; the preview was read and shows only in-place changes (name them); the deploy will require signed requests on every archive route, move the archive functions to Node 22, retain the table and bucket, and turn on point-in-time recovery; and if anything after the deploy fails, `scripts/deploy-archive.sh unlock` removes only the lock and cannot delete data. Do not run Step 3 without their yes in this conversation.

- [ ] **Step 3: Lock**

```bash
scripts/deploy-archive.sh lock
```
Expected, in order: the commit it deploys; the pre-flight `all checks passed`; a successful `sam deploy`; `wrote config/archive-service.json` with no `NOTE:`; the verification `all checks passed`, including a `requires AWS_IAM` line for every route, `an unsigned request is refused (403)`, and a relay list from each of `engagedev`, `engagetest` and `engageprod`; then the drill hint.

- [ ] **Step 4: Prove a signed backup, restore and delete on dev and test**

```bash
scripts/archive-drill.sh engagedev && scripts/archive-drill.sh engagetest
```
Expected: `drill passed` on both, and no `LEFT BEHIND` line. Before the lock nothing could prove a signature; these drills are that proof. Never run the drill on engageprod.

- [ ] **Step 5: If anything after the deploy fails, unlock first, then report**

If `lock` prints `THE SHARED ARCHIVE IS NOW LOCKED, but …`, or a drill fails on a signed call:

```bash
scripts/deploy-archive.sh unlock
```
Expected: `THE SHARED ARCHIVE IS UNLOCKED`, and the pre-flight `all checks passed` for all three tiers. Only the lock is removed: Node 22, retention and recovery stay. Report exactly which check failed, with its output.

- [ ] **Step 6: Record and report**

If `config/archive-service.json` changed, commit it together with the matching `ArchiveService` mapping change, and ship that through Task 13's steps. Otherwise, nothing needs committing. Tell the owner the archive is locked, which checks and drills passed, and that `scripts/archive-drill.sh engagedev` can be re-run at any time as a restore drill.

---

## Self-review against the spec (done while writing; kept for the executor)

| Spec requirement | Task |
|---|---|
| §4.1 wholesale envelope, PK dropped / SK kept, lifecycle rows out (A12), `snapshotId` (A4), `links.promptName`, row-only prompts (A8), tags | 2, 7 |
| §4.2 export: `{scope,id}` + bare id = platform (A6), org refused by name, ciphertext refused (A7), no partition literals, active version, empty read refused, media, no main-table writes | 7 |
| §4.3 import: `canManageScope`, detection by content, platform only, new version then flip (D2), recreate under original id, legacy→v1 first (A10), org-shaped stripping, settings applied, `restoredBy/At`, prompt rules incl. default never changed (A9), relink by name | 4, 6 |
| §4.4 restore result, `becameActive`, media totals | 6 |
| §4.5 media out/in, missing reported, never overwrite (A11), ListBucket | 3, 9 |
| §4.6 IAM on archive, SigV4 client, execute-api host, mapping (A5), relay routes, upload form removed, every tier (A2), hardening (A3) | 1, 8, 9, 12, 14 |
| §4.7 screen: authFetch only, pairs, scope, grouping, mixed import, result, tier chip/filter/confirm (A14), dead Import removed | 10, 11 |
| §4.8 legacy: no suffixes, inactive via `startInactive`, collision refused (A13) | 5, 6 |
| §4.9 removed: list-local-archive, ARCHIVE rows, export narrowed to read (kms:Decrypt kept — see spec) | 7, 9 |
| §5 rollout: Phase 1 all tiers, Phase 2 after pre-flight, Node 22 required (A1), rollback | 13, 14, 15 |
| §6 tests 1–12 | 1–12, 14 |

