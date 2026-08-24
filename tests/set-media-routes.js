/**
 * THE TWO MEDIA ROUTES, DRIVEN —
 *   lambda-functions/admin/media-upload-urls.js   (presign)
 *   lambda-functions/admin/media-status.js        (verify)
 *
 * A presigned PUT is a WRITE CREDENTIAL handed to a browser, so most of this
 * file is about what one of these URLs cannot be talked into being: a key
 * outside the set's prefix, a file that is not an image, a set the caller does
 * not own, or a set that does not exist.
 *
 * The verification half is about the opposite failure — condemning something
 * that works. The Art set is seven Wikimedia URLs, none of which is in the
 * bucket, and every one of which renders. A verifier that reported those as
 * missing would be worse than no verifier at all.
 *
 * Stubbing follows tests/import-questions-flow.js and
 * tests/upload-questions-tags.js: hook `Module._load` BY MODULE NAME, because
 * several @aws-sdk packages only exist in the deployed bundle and cannot be
 * resolved from the repo root. `@aws-sdk/s3-request-presigner` is one of them,
 * which is also why it was added to lambda-functions/admin/package.json rather
 * than being assumed present in the Lambda runtime.
 */
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');

// ---- Stub the AWS SDK before either handler loads ---------------------------
const Module = require('module');
const stubs = new Map();
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (stubs.has(request)) return stubs.get(request);
  return realLoad.call(this, request, parent, isMain);
};
function stub(name, exports) { stubs.set(name, exports); }

class GetCommand { constructor(i) { this.input = i; this.type = 'get'; } }
class QueryCommand { constructor(i) { this.input = i; this.type = 'query'; } }
class PutObjectCommand { constructor(i) { this.input = i; this.type = 'putObject'; } }
class ListObjectsV2Command { constructor(i) { this.input = i; this.type = 'list'; } }

const TABLE = 'test-table';
const BUCKET = 'engagetest-media';

// In-memory single-table store, keyed "PK|SK".
const store = new Map();
// In-memory bucket: key -> size in bytes.
const bucket = new Map();
// Every presign that was asked for, so the test can inspect what was signed.
const signed = [];

const fakeDoc = {
  send: async (cmd) => {
    const inp = cmd.input || {};
    if (cmd.type === 'get') {
      return { Item: store.get(`${inp.Key.PK}|${inp.Key.SK}`) };
    }
    if (cmd.type === 'query') {
      const pk = inp.ExpressionAttributeValues[':pk'];
      const skPrefix = inp.ExpressionAttributeValues[':sk'];
      const items = [...store.values()].filter((i) => i.PK === pk
        && (!skPrefix || String(i.SK).startsWith(skPrefix)));
      return { Items: items };
    }
    return { Items: [] };
  },
};

const fakeS3 = {
  send: async (cmd) => {
    if (cmd.type === 'list') {
      const prefix = cmd.input.Prefix || '';
      const Contents = [...bucket.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .map(([Key, Size]) => ({ Key, Size }));
      return { Contents, IsTruncated: false };
    }
    return {};
  },
};

stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => fakeDoc },
  GetCommand, QueryCommand,
});
stub('@aws-sdk/client-s3', {
  // The handlers construct their own client, so the stub must BE a client —
  // `class {}` gave them an object with no `send`, which the verification
  // handler swallowed into its 500 branch and every assertion then read as a
  // permission failure.
  S3Client: class { async send(cmd) { return fakeS3.send(cmd); } },
  PutObjectCommand,
  ListObjectsV2Command,
});
// The authorizer's own dependencies, stubbed the same way
// tests/games-list-authorization.js does. Nothing here verifies a token —
// which route needs which group is the only thing this file asks it.
stub('@aws-sdk/client-cognito-identity-provider', {
  CognitoIdentityProviderClient: class { async send() { return { Groups: [] }; } },
  AdminListGroupsForUserCommand: class { constructor(i) { this.input = i; } },
});
stub('jsonwebtoken', { decode: () => ({ header: { kid: 'k' } }), verify: (t) => JSON.parse(t) });
stub('jwk-to-pem', () => 'stub-pem');
stub('axios', { get: async () => ({ data: { keys: [{ kid: 'k' }] } }) });

stub('@aws-sdk/s3-request-presigner', {
  getSignedUrl: async (client, command, options) => {
    signed.push({ input: command.input, options });
    const { Bucket, Key, ContentType } = command.input;
    return `https://${Bucket}.s3.amazonaws.com/${encodeURI(Key)}`
      + `?X-Amz-Expires=${options.expiresIn}`
      + `&content-type=${encodeURIComponent(ContentType)}`
      + '&X-Amz-Signature=deadbeef';
  },
});

process.env.TABLE_NAME = TABLE;
process.env.MEDIA_BUCKET = BUCKET;

// media-status.js verifies remote URLs with the runtime's own global fetch.
// Routed by URL: { status } answers with that status, an Error rejects (the
// shape a timeout or DNS failure takes), a function decides per call — which
// is how the HEAD-refusing host is played. '*' is the fallback route.
const fetchCalls = [];
const fetchRoutes = new Map();
global.fetch = async (url, options = {}) => {
  fetchCalls.push({ url, method: options.method, headers: options.headers || {} });
  const route = fetchRoutes.get(url) ?? fetchRoutes.get('*');
  if (!route) throw new Error(`unstubbed fetch ${url}`);
  if (route instanceof Error) throw route;
  if (typeof route === 'function') return route({ url, options });
  return { status: route.status };
};

const presign = require(path.join(REPO, 'lambda-functions/admin/media-upload-urls.js'));
const status = require(path.join(REPO, 'lambda-functions/admin/media-status.js'));
const media = require(path.join(REPO, 'lambda-functions/admin/shared/set-media.js'));
const { requiredGroupsForRoute, HOST_ADMIN_ROUTES } = require(path.join(REPO, 'lambda-functions/auth/authorizer.js'));

if (!process.env.DEBUG) { console.log = () => {}; console.warn = () => {}; console.error = () => {}; }
const say = (...a) => process.stdout.write(a.join(' ') + '\n');

// ---- fixtures ---------------------------------------------------------------
const SET = 'set-42';
const ORG = 'org_nw';
const ADMIN_SUB = 'admin-sub';
const OWNER_SUB = 'owner-sub';
const STRANGER_SUB = 'stranger-sub';

function reset() {
  store.clear();
  bucket.clear();
  signed.length = 0;
  fetchCalls.length = 0;
  fetchRoutes.clear();
  fetchRoutes.set('*', { status: 200 });
  // TENANCY: a set a host created is an ORG set — `scope` and `orgId` together,
  // which is what ownerStamp writes. Seeded at PK='SETS' it would be PLATFORM
  // content, which only Engage staff may change, so the owner's own upload was
  // correctly refused.
  store.set(`ORG#${ORG}#SETS|SET#${SET}`, {
    PK: `ORG#${ORG}#SETS`, SK: `SET#${SET}`, name: 'Famous art',
    scope: 'org', orgId: ORG,
    createdBy: OWNER_SUB, activeVersion: 2,
    versions: [{ version: 1 }, { version: 2 }],
  });
}

function question(number, image, { version = 2, title = `Q${number}` } = {}) {
  const item = {
    PK: `ORG#${ORG}#SET#${SET}#v${version}`,
    SK: `QUESTION#${String(number).padStart(3, '0')}`,
    QuestionNumber: number,
    Title: title,
    Image: image,
  };
  store.set(`${item.PK}|${item.SK}`, item);
  return item;
}

/**
 * ACTING AS ENGAGE — the staff group AND no active organisation.
 *
 * Writing Engage's shared library needs both now. Being in `admins` says WHO
 * may curate it; the absence of an active org says they meant to, rather than
 * doing it while standing somewhere that makes the row look like their own. An
 * Engage admin inside a customer's team renamed a platform set on dev.
 */
const asEngage = (sub) => ({
  requestContext: { authorizer: { lambda: { userId: sub, username: sub, groups: 'admins', orgId: '', orgRole: '' } } },
});

const asCaller = (sub, groups) => ({
  // TENANCY: a host acts FOR an organisation. One org for the whole file — this
  // suite is about media upload permission, not about tenancy, so every caller
  // shares one and the ownership question stays the question.
  requestContext: { authorizer: { lambda: { userId: sub, username: sub, groups, orgId: ORG, orgRole: 'member' } } },
});

// THE DEFAULT CALLER IS THE SET'S OWNER, NOT AN ENGAGE ADMIN.
//
// It used to be `asCaller(ADMIN_SUB, 'admins')`, which worked because being a
// platform administrator granted access to every set in the system. It no
// longer does: Engage staff manage the shared platform library and nothing
// inside a customer's organisation. Most of the tests below are about presign
// MECHANICS — one key, the right prefix, the content type, the size ceiling —
// so their default caller has to be somebody who is allowed, or they all fail
// at the permission check and never reach the thing they are testing. The tests
// that are genuinely about permission still name their caller explicitly.
const upload = (files, caller = asCaller(OWNER_SUB, 'hosts'), setId = SET) => presign.handler({
  ...caller,
  pathParameters: { setId },
  body: JSON.stringify({ files }),
});

const verify = (caller = asCaller(OWNER_SUB, 'hosts'), setId = SET, query = null) => status.handler({
  ...caller,
  pathParameters: { setId },
  queryStringParameters: query,
});

const body = (res) => JSON.parse(res.body);

// ---- Tiny test runner -------------------------------------------------------
let passed = 0; let failed = 0;
async function test(name, fn) {
  try { await fn(); passed += 1; say(`  PASS  ${name}`); }
  catch (error) { failed += 1; say(`  FAIL  ${name}\n        ${error.message}`); }
}

(async function run() {
  say('\nquestion-set media: presigning and verification');

  /* ------------------------------------------------ the write credential -- */

  await test('a presigned URL is signed for exactly one key inside the set prefix', async () => {
    reset();
    const res = await upload([{ name: 'mona-lisa.jpg', size: 2048 }]);
    assert.strictEqual(res.statusCode, 200, res.body);
    const out = body(res);
    assert.strictEqual(out.uploads.length, 1);
    assert.strictEqual(out.uploads[0].key, `sets/${SET}/mona-lisa.jpg`);
    assert.strictEqual(signed.length, 1);
    assert.strictEqual(signed[0].input.Bucket, BUCKET);
    assert.strictEqual(signed[0].input.Key, `sets/${SET}/mona-lisa.jpg`);
    assert.strictEqual(signed[0].input.ContentType, 'image/jpeg');
  });

  await test('the caller cannot choose the key, however the name is written', async () => {
    reset();
    const attacks = [
      '../../../secrets.jpg',
      '/etc/passwd.png',
      'C:\\Windows\\system32\\x.png',
      'a/b/../../../c.jpg',
      'sets/some-other-set/steal.jpg',
    ];
    const res = await upload(attacks.map((name) => ({ name, size: 10 })));
    assert.strictEqual(res.statusCode, 200, res.body);
    for (const entry of signed) {
      const key = entry.input.Key;
      assert.ok(key.startsWith(`sets/${SET}/`), `escaped the prefix: ${key}`);
      assert.ok(!key.slice(`sets/${SET}/`.length).includes('/'), `nested key: ${key}`);
      assert.ok(!key.includes('..'), `traversal survived: ${key}`);
    }
  });

  await test('the content type comes from the extension, never from the caller', async () => {
    reset();
    // A caller claiming image/jpeg for an executable gets nothing signed at all.
    const exe = await upload([{ name: 'payload.exe', size: 10, type: 'image/jpeg' }]);
    assert.strictEqual(exe.statusCode, 200, exe.body);
    assert.strictEqual(body(exe).uploads.length, 0);
    assert.strictEqual(signed.length, 0);
    assert.match(body(exe).rejected[0].reason, /Only images are accepted/);

    // And for a file that IS acceptable, the caller's `type` is still ignored:
    // the signed header comes from the extension via the closed ALLOWED_TYPES
    // map. Without this half, `(file.type || contentTypeFor(name))` would sign
    // whatever a hand-made request asked for — an `image/jpeg` claim on a .png
    // here, and with a wider extension list, `text/html` on a key that
    // CloudFront serves from the site's own origin.
    reset();
    const png = await upload([
      { name: 'art.png', size: 10, type: 'image/jpeg' },
      { name: 'hack.svg', size: 10, type: 'text/html' },
    ]);
    assert.strictEqual(png.statusCode, 200, png.body);
    const byKey = Object.fromEntries(signed.map((s) => [s.input.Key, s.input.ContentType]));
    assert.strictEqual(byKey[`sets/${SET}/art.png`], 'image/png',
      'the caller\'s image/jpeg claim overrode the extension');
    assert.strictEqual(byKey[`sets/${SET}/hack.svg`], 'image/svg+xml',
      'the caller\'s text/html claim was signed — a stored XSS on the site origin');
    for (const entry of signed) {
      assert.strictEqual(entry.input.ContentType, media.contentTypeFor(entry.input.Key));
    }
  });

  await test('non-image extensions are refused one by one, with the reason', async () => {
    reset();
    const res = await upload([
      { name: 'a.jpg', size: 10 },
      { name: 'b.pdf', size: 10 },
      { name: 'c.zip', size: 10 },
      { name: 'noextension', size: 10 },
    ]);
    const out = body(res);
    assert.strictEqual(out.uploads.length, 1, 'only the image is signed');
    assert.strictEqual(out.rejected.length, 3);
    assert.ok(out.rejected.some((r) => /no file extension/.test(r.reason)));
  });

  await test('a declared size over the ceiling is refused before anything is signed', async () => {
    reset();
    const res = await upload([{ name: 'huge.jpg', size: media.MAX_BYTES + 1 }]);
    assert.strictEqual(body(res).uploads.length, 0);
    assert.strictEqual(signed.length, 0);
    assert.match(body(res).rejected[0].reason, /The ceiling is 12 MB/);
  });

  await test('two files that collapse to one key are reported instead of racing', async () => {
    reset();
    const res = await upload([
      { name: 'Mona Lisa.jpg', size: 10 },
      { name: 'mona-lisa.jpg', size: 10 },
    ]);
    const out = body(res);
    assert.strictEqual(out.uploads.length, 1);
    assert.strictEqual(out.rejected.length, 1);
    assert.match(out.rejected[0].reason, /both become/);
  });

  await test('the URL expires, and says how soon', async () => {
    reset();
    await upload([{ name: 'a.jpg', size: 10 }]);
    assert.strictEqual(signed[0].options.expiresIn, media.URL_TTL_SECONDS);
    assert.ok(media.URL_TTL_SECONDS <= 3600, 'a write credential should not outlive the session');
  });

  await test('a folder bigger than the per-request ceiling is refused whole', async () => {
    reset();
    const files = Array.from({ length: media.MAX_FILES_PER_REQUEST + 1 }, (_, i) => ({ name: `a${i}.jpg`, size: 10 }));
    const res = await upload(files);
    assert.strictEqual(res.statusCode, 400, res.body);
    assert.strictEqual(signed.length, 0);
  });

  /* ------------------------------------------------------------ the guard -- */

  await test('a host who does not own the set gets 403 and no URL', async () => {
    reset();
    const res = await upload([{ name: 'a.jpg', size: 10 }], asCaller(STRANGER_SUB, 'hosts'));
    assert.strictEqual(res.statusCode, 403, res.body);
    assert.strictEqual(signed.length, 0, 'a refused caller must not be handed a write credential');
  });

  await test('the host who created the set may upload to it', async () => {
    reset();
    const res = await upload([{ name: 'a.jpg', size: 10 }], asCaller(OWNER_SUB, 'hosts'));
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(signed.length, 1);
  });

  // THE RULE INVERTED HERE, DELIBERATELY. This test used to read "an admin may
  // upload to any set", and that was true: being in the `admins` group granted
  // access to every set in the system. Tenancy removes it — Engage staff manage
  // the shared platform library, and a customer's organisation is not theirs to
  // write to. It is a real loss of capability and the point of the change, so
  // the test asserts the refusal rather than being deleted.
  await test('Engage staff may NOT upload to an organisation\'s set', async () => {
    reset();
    const res = await upload([{ name: 'a.jpg', size: 10 }], asCaller(ADMIN_SUB, 'admins'));
    assert.notStrictEqual(res.statusCode, 200,
      'a platform admin still has write access to a customer\'s content');
    assert.strictEqual(signed.length, 0, 'a URL was signed before the refusal');
  });

  await test('...but may upload to a PLATFORM set, which is theirs to curate', async () => {
    reset();
    // Move the fixture into the shared library: no `scope`, no `orgId`, at
    // PK='SETS' — the shape of every set that exists today.
    store.delete(`ORG#${ORG}#SETS|SET#${SET}`);
    store.set(`SETS|SET#${SET}`, {
      PK: 'SETS', SK: `SET#${SET}`, name: 'Famous art', activeVersion: 2,
      versions: [{ version: 1 }, { version: 2 }],
    });
    for (const [k, v] of [...store.entries()]) {
      if (k.startsWith(`ORG#${ORG}#SET#${SET}`)) {
        store.delete(k);
        store.set(k.replace(`ORG#${ORG}#`, ''), { ...v, PK: String(v.PK).replace(`ORG#${ORG}#`, '') });
      }
    }
    const res = await upload([{ name: 'a.jpg', size: 10 }], asEngage(ADMIN_SUB));
    assert.strictEqual(res.statusCode, 200, res.body);
  });

  await test('an unowned legacy set is Engage-staff-only, as it always was', async () => {
    reset();
    // A legacy row: no createdBy AND no scope. Tenancy reads that absence as
    // PLATFORM, which is exactly what those ~41 rows always were in practice —
    // every one was made by an administrator back when these routes were
    // admins-only. That is why there is no migration.
    store.delete(`ORG#${ORG}#SETS|SET#${SET}`);
    store.set(`SETS|SET#${SET}`, {
      PK: 'SETS', SK: `SET#${SET}`, name: 'Famous art', activeVersion: 2,
      versions: [{ version: 1 }, { version: 2 }],
    });
    for (const [k, v] of [...store.entries()]) {
      if (k.startsWith(`ORG#${ORG}#SET#${SET}`)) {
        store.delete(k);
        store.set(k.replace(`ORG#${ORG}#`, ''), { ...v, PK: String(v.PK).replace(`ORG#${ORG}#`, '') });
      }
    }
    assert.notStrictEqual(
      (await upload([{ name: 'a.jpg', size: 10 }], asCaller(OWNER_SUB, 'hosts'))).statusCode, 200,
      'an org host can write to the shared library');
    assert.strictEqual(
      (await upload([{ name: 'a.jpg', size: 10 }], asEngage(ADMIN_SUB))).statusCode, 200,
      'Engage staff lost the library they are supposed to curate');
    // rejects: the reported bug, on the media route — Engage staff writing to
    // the shared library while standing inside a customer's organisation.
    assert.notStrictEqual(
      (await upload([{ name: 'a.jpg', size: 10 }], asCaller(ADMIN_SUB, 'admins'))).statusCode, 200,
      'staff wrote to the shared library from inside an organisation');
  });

  await test('a set that does not exist is a 404, not a signed URL for a phantom prefix', async () => {
    reset();
    const res = await upload([{ name: 'a.jpg', size: 10 }], asCaller(ADMIN_SUB, 'admins'), 'no-such-set');
    assert.strictEqual(res.statusCode, 404, res.body);
    assert.strictEqual(signed.length, 0);
  });

  await test('an anonymous caller owns nothing and is refused', async () => {
    reset();
    const res = await presign.handler({ pathParameters: { setId: SET }, body: JSON.stringify({ files: [{ name: 'a.jpg' }] }) });
    // Any non-success. It is a 404 now rather than a 403: an anonymous caller
    // cannot see an org set at all, and answering 403 would turn the refusal
    // into an existence oracle — probe ids, and the ones that come back 403
    // instead of 404 are the real ones.
    assert.ok(res.statusCode >= 400, `expected a refusal, got ${res.statusCode}`);
    assert.strictEqual(signed.length, 0, 'a URL was signed for an anonymous caller');
  });

  await test('an unconfigured environment fails loudly instead of signing for undefined', async () => {
    reset();
    delete process.env.MEDIA_BUCKET;
    const res = await upload([{ name: 'a.jpg', size: 10 }]);
    process.env.MEDIA_BUCKET = BUCKET;
    assert.strictEqual(res.statusCode, 500, res.body);
    assert.strictEqual(signed.length, 0);
  });

  await test('a malformed body is a 400, not a crash', async () => {
    reset();
    const res = await presign.handler({
      ...asCaller(ADMIN_SUB, 'admins'),
      pathParameters: { setId: SET },
      body: '{not json',
    });
    assert.strictEqual(res.statusCode, 400, res.body);
  });

  /* ---------------------------------------------------- the verification -- */

  await test('a question pointing at a file that is not there is reported', async () => {
    reset();
    question(1, `sets/${SET}/mona-lisa.jpg`, { title: 'The enigmatic smile' });
    question(2, `sets/${SET}/starry.jpg`);
    bucket.set(`sets/${SET}/starry.jpg`, 5000);

    const res = await verify();
    assert.strictEqual(res.statusCode, 200, res.body);
    const out = body(res);
    assert.strictEqual(out.missingCount, 1);
    assert.strictEqual(out.missing[0].image, `sets/${SET}/mona-lisa.jpg`);
    assert.strictEqual(out.missing[0].title, 'The enigmatic smile');
    assert.strictEqual(out.counts.key, 2);
  });

  await test('a remote URL is NEVER reported missing — this is the art game', async () => {
    reset();
    question(1, 'https://commons.wikimedia.org/wiki/Special:FilePath/Mona_Lisa.jpg');
    question(2, 'http://example.com/a.png');
    // Nothing at all in the bucket — both answer 200 live (the '*' route).
    const out = body(await verify());
    assert.strictEqual(out.missingCount, 0, 'the whole art set would have gone red');
    assert.strictEqual(out.counts.remote, 2);
    assert.strictEqual(out.remoteChecked, 2);
    assert.strictEqual(out.deadRemoteCount, 0);
    assert.strictEqual(out.remoteUnchecked, 0);
    assert.strictEqual(out.unverifiable, 0,
      'remote is verified live now — only /-rooted assets remain unverifiable');
  });

  await test('a dead web link is reported with its status — the Art set regression', async () => {
    reset();
    const ghost = 'https://commons.wikimedia.org/wiki/Special:FilePath/No_Such_Painting.jpg';
    const real = 'https://commons.wikimedia.org/wiki/Special:FilePath/Mona_Lisa.jpg';
    question(1, real, { title: 'The one that works' });
    question(2, ghost, { title: 'The ghost' });
    fetchRoutes.set(ghost, { status: 404 });

    const out = body(await verify());
    assert.strictEqual(out.missingCount, 0, 'a dead link is not a missing bucket key');
    assert.strictEqual(out.deadRemoteCount, 1);
    assert.strictEqual(out.deadRemote[0].image, ghost);
    assert.strictEqual(out.deadRemote[0].title, 'The ghost');
    assert.strictEqual(out.deadRemote[0].verdict, 'dead');
    assert.strictEqual(out.deadRemote[0].status, 404);
  });

  await test('a host that refuses HEAD gets one ranged GET before being condemned', async () => {
    reset();
    const url = 'https://example.com/refuses-head.jpg';
    question(1, url);
    fetchRoutes.set(url, ({ options }) => (
      options.method === 'HEAD' ? { status: 405 } : { status: 200 }
    ));

    const out = body(await verify());
    assert.strictEqual(out.deadRemoteCount, 0, 'a 405 to HEAD is not a verdict on the file');
    const calls = fetchCalls.filter((c) => c.url === url);
    assert.deepStrictEqual(calls.map((c) => c.method), ['HEAD', 'GET']);
    assert.strictEqual(calls[1].headers.Range, 'bytes=0-0',
      'the fallback GET must ask for one byte, not the whole file');
  });

  await test('no answer is unreachable, not dead — different advice to the author', async () => {
    reset();
    const url = 'https://glacial-art-host.example/x.jpg';
    question(1, url);
    fetchRoutes.set(url, new Error('socket hang up'));

    const out = body(await verify());
    assert.strictEqual(out.deadRemoteCount, 1);
    assert.strictEqual(out.deadRemote[0].verdict, 'unreachable');
    assert.strictEqual(out.deadRemote[0].status, 0);
  });

  await test('past the cap the rest count as unchecked, never as silently fine', async () => {
    reset();
    // The cap (120) lives inside the handler; drive it with 125 questions.
    for (let i = 1; i <= 125; i += 1) {
      question(i, `https://example.com/art-${i}.jpg`);
    }
    const out = body(await verify());
    assert.strictEqual(out.remoteChecked, 120);
    assert.strictEqual(out.remoteUnchecked, 5);
    assert.strictEqual(fetchCalls.length, 120, 'the overflow must not be fetched at all');
  });

  await test('a /-rooted repo asset is never reported missing either', async () => {
    reset();
    question(1, '/assets/art/the-enigmatic-smile.jpg');
    const out = body(await verify());
    assert.strictEqual(out.missingCount, 0);
    assert.strictEqual(out.counts.asset, 1);
    assert.strictEqual(out.unverifiable, 1, 'shipped with the app; nothing to check live');
  });

  await test('a question with no image is not a missing image', async () => {
    reset();
    question(1, '');
    question(2, undefined);
    const out = body(await verify());
    assert.strictEqual(out.missingCount, 0);
    assert.strictEqual(out.counts.none, 2);
  });

  await test('a zero-byte object is not "in place" — that is an aborted upload', async () => {
    reset();
    question(1, `sets/${SET}/a.jpg`);
    bucket.set(`sets/${SET}/a.jpg`, 0);
    const out = body(await verify());
    assert.strictEqual(out.missingCount, 1,
      'a zero-byte object passed verification and would render as a broken picture');
  });

  await test('files nothing points at are listed, and nothing is deleted', async () => {
    reset();
    question(1, `sets/${SET}/mona-lisa.jpg`);
    bucket.set(`sets/${SET}/mona-lisa.jpg`, 100);
    bucket.set(`sets/${SET}/mona_lisa.jpg`, 100);   // the typo's other half
    const out = body(await verify());
    assert.deepStrictEqual(out.unused, [`sets/${SET}/mona_lisa.jpg`]);
    assert.strictEqual(bucket.size, 2, 'verification must never delete anything');
  });

  await test('another set’s objects are not counted as this set’s', async () => {
    reset();
    question(1, `sets/${SET}/a.jpg`);
    bucket.set('sets/other-set/a.jpg', 100);
    const out = body(await verify());
    assert.strictEqual(out.missingCount, 1);
    assert.deepStrictEqual(out.unused, []);
  });

  await test('the version the games play is the version that is checked', async () => {
    reset();
    // v1 points at a file that exists; v2 (active) points at one that does not.
    question(1, `sets/${SET}/old.jpg`, { version: 1 });
    question(1, `sets/${SET}/new.jpg`, { version: 2 });
    bucket.set(`sets/${SET}/old.jpg`, 100);

    const active = body(await verify());
    assert.strictEqual(active.version, 2);
    assert.strictEqual(active.missingCount, 1);

    // The owner, not an Engage admin: staff have no access to an org set since
    // tenancy, and this test is about which VERSION is read, not about who may.
    const pinned = body(await verify(asCaller(OWNER_SUB, 'hosts'), SET, { version: '1' }));
    assert.strictEqual(pinned.version, 1);
    assert.strictEqual(pinned.missingCount, 0);
  });

  await test('verification is guarded by the same ownership rule as every other set route', async () => {
    reset();
    question(1, `sets/${SET}/a.jpg`);
    // A stranger in the SAME organisation: refused, because they did not create
    // it. This is the within-org half of the rule, unchanged by tenancy.
    assert.ok((await verify(asCaller(STRANGER_SUB, 'hosts'))).statusCode >= 400);
    assert.strictEqual((await verify(asCaller(OWNER_SUB, 'hosts'))).statusCode, 200);
    // AND ENGAGE STAFF ARE REFUSED TOO, which is the half that changed. It used
    // to assert 200 here. A platform admin has no access to a customer's set,
    // and that is the whole isolation story in one line.
    assert.ok((await verify(asCaller(ADMIN_SUB, 'admins'))).statusCode >= 400,
      'a platform admin can still read a customer\'s media manifest');
  });

  await test('a set that does not exist is a 404', async () => {
    reset();
    assert.strictEqual((await verify(asCaller(ADMIN_SUB, 'admins'), 'no-such-set')).statusCode, 404);
  });

  /* ---------------------------------------------------------- the routes -- */

  await test('both routes are reachable by a host, and are exact pairs', async () => {
    assert.deepStrictEqual(
      requiredGroupsForRoute('POST', 'admin/question-sets/{setId}/media/uploads'),
      ['hosts', 'admins'],
    );
    assert.deepStrictEqual(
      requiredGroupsForRoute('GET', 'admin/question-sets/{setId}/media'),
      ['hosts', 'admins'],
    );
  });

  await test('adding them did not open the version routes to hosts', async () => {
    // The failure the HOST_ADMIN_ROUTES header exists to prevent: a prefix
    // match would have opened every route under admin/question-sets/{setId}/.
    for (const [method, route] of [
      ['GET', 'admin/question-sets/{setId}/versions'],
      ['POST', 'admin/question-sets/{setId}/versions/{version}/promote'],
      ['DELETE', 'admin/question-sets/{setId}/versions/{version}'],
      ['GET', 'admin/download-question-set/{setId}'],
      ['POST', 'admin/question-sets/{setId}/media'],          // wrong verb
      ['GET', 'admin/question-sets/{setId}/media/uploads'],   // wrong verb
    ]) {
      assert.deepStrictEqual(requiredGroupsForRoute(method, route), ['admins'],
        `${method} ${route} became host-reachable`);
    }
  });

  await test('every host route is still an exact METHOD+path pair with no wildcard', async () => {
    for (const entry of HOST_ADMIN_ROUTES) {
      assert.ok(!entry.includes('*'), `wildcard in the host route list: ${entry}`);
      assert.match(entry, /^(GET|POST|PUT|DELETE) admin\//);
    }
  });

  say(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
})();
