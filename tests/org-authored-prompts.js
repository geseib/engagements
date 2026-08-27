/**
 * ORG-AUTHORED WORKIES, END TO END — create-ai-prompt.js and get-ai-prompts.js
 *
 * `admin/shared/prompt-access.js` has been complete and tested since the public
 * library work (tests/prompt-scoping.js, 20 assertions) and NOTHING CALLED IT.
 * `create-ai-prompt.js` wrote `PK: 'AIPROMPTS'` unconditionally, so an
 * organisation could not author a Workie at all.
 *
 * tests/prompt-scoping.js proves the MODULE. Every one of its assertions stays
 * green while not a single handler calls it. This file is the other half: the
 * REAL handlers, driven against stubbed AWS, looking at what is actually in the
 * store afterwards.
 *
 * Stubbing note (from tests/ai-prompt-lifecycle.js:29-35): poisoning
 * require.cache by resolved path silently misses, because several SDK packages
 * these handlers import exist only in the deployed bundle. Intercept
 * Module._load by request NAME instead, before any handler loads.
 */
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');

const Module = require('module');
const stubs = new Map();
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (stubs.has(request)) return stubs.get(request);
  return realLoad.call(this, request, parent, isMain);
};
function stub(name, exports) { stubs.set(name, exports); }

// ---- in-memory table -------------------------------------------------------
const store = new Map();
const key = (pk, sk) => `${pk}|${sk}`;

class GetCommand { constructor(i) { this.input = i; this.type = 'get'; } }
class PutCommand { constructor(i) { this.input = i; this.type = 'put'; } }
class QueryCommand { constructor(i) { this.input = i; this.type = 'query'; } }
class UpdateCommand { constructor(i) { this.input = i; this.type = 'update'; } }
class DeleteCommand { constructor(i) { this.input = i; this.type = 'delete'; } }
class ScanCommand { constructor(i) { this.input = i; this.type = 'scan'; } }

const fakeDoc = {
  send: async (cmd) => {
    const inp = cmd.input || {};
    switch (cmd.type) {
      case 'put': store.set(key(inp.Item.PK, inp.Item.SK), inp.Item); return {};
      case 'get': return { Item: store.get(key(inp.Key.PK, inp.Key.SK)) };
      case 'delete': store.delete(key(inp.Key.PK, inp.Key.SK)); return {};
      case 'update': {
        const k = key(inp.Key.PK, inp.Key.SK);
        const item = store.get(k) || { ...inp.Key };
        const names = inp.ExpressionAttributeNames || {};
        const values = inp.ExpressionAttributeValues || {};
        for (const clause of String(inp.UpdateExpression || '').replace(/^SET /, '').split(',')) {
          const m = clause.trim().match(/^(#?[\w.]+)\s*=\s*(.+)$/);
          if (!m) continue;
          const attr = names[m[1]] || m[1];
          if (m[2].trim().startsWith(':')) item[attr] = values[m[2].trim()];
        }
        store.set(k, item);
        return { Attributes: item };
      }
      case 'query': {
        const v = inp.ExpressionAttributeValues || {};
        const names = inp.ExpressionAttributeNames || {};
        let items = [...store.values()].filter((i) =>
          i.PK === v[':pk'] && String(i.SK).startsWith(String(v[':sk'] ?? '')));
        // get-ai-prompts.js's buildQuery pushes `category`/`status` into a
        // FilterExpression of ANDed `attr = :value` clauses, applied by
        // DynamoDB AFTER the key condition, PER QUERY. Section 6 below
        // exercises three partitions at once and asserts the filter narrows
        // each of them — without evaluating it here that assertion would pass
        // on an implementation that dropped the filter entirely, because this
        // suite's own store only ever holds a handful of rows per PK anyway.
        if (inp.FilterExpression) {
          const clauses = inp.FilterExpression.split(/\s+AND\s+/i);
          items = items.filter((i) => clauses.every((clause) => {
            const m = clause.trim().match(/^(#?[\w.]+)\s*=\s*(:[\w]+)$/);
            if (!m) return true;
            const attr = m[1].startsWith('#') ? names[m[1]] : m[1];
            return i[attr] === v[m[2]];
          }));
        }
        return { Items: items, Count: items.length };
      }
      default: return { Items: [], Count: 0 };
    }
  },
};

stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => fakeDoc },
  GetCommand, PutCommand, QueryCommand, UpdateCommand, DeleteCommand, ScanCommand,
});

// ---- in-memory S3 ----------------------------------------------------------
const s3Store = new Map();     // key -> Body string
const s3Meta = new Map();      // key -> the Metadata block the handler sent
stub('@aws-sdk/client-s3', {
  S3Client: class {
    async send(cmd) {
      if (cmd.type === 'put') {
        s3Store.set(cmd.input.Key, cmd.input.Body);
        s3Meta.set(cmd.input.Key, cmd.input.Metadata || {});
        return {};
      }
      if (cmd.type === 'get') {
        const body = s3Store.get(cmd.input.Key);
        if (!body) { const e = new Error('NoSuchKey'); e.name = 'NoSuchKey'; throw e; }
        return { Body: { transformToString: async () => body } };
      }
      if (cmd.type === 'list') return { Contents: [] };
      return {};
    }
  },
  PutObjectCommand: class { constructor(i) { this.input = i; this.type = 'put'; } },
  GetObjectCommand: class { constructor(i) { this.input = i; this.type = 'get'; } },
  DeleteObjectCommand: class { constructor(i) { this.input = i; this.type = 'delete'; } },
  DeleteObjectsCommand: class { constructor(i) { this.input = i; this.type = 'deleteMany'; } },
  ListObjectsV2Command: class { constructor(i) { this.input = i; this.type = 'list'; } },
});

// ---- a KMS that behaves the way the key policy will ------------------------
const nodeCrypto = require('crypto');
class GenerateDataKeyCommand { constructor(i) { this.input = i; } }
class DecryptCommand { constructor(i) { this.input = i; } }
const wrap = (orgId, key) =>
  Buffer.from(JSON.stringify({ orgId, key: key.toString('base64') }), 'utf8');

stub('@aws-sdk/client-kms', {
  KMSClient: class {
    async send(command) {
      if (command instanceof GenerateDataKeyCommand) {
        const orgId = command.input.EncryptionContext?.orgId;
        assert.ok(orgId, 'GenerateDataKey must bind an orgId');
        const k2 = nodeCrypto.randomBytes(32);
        return { Plaintext: k2, CiphertextBlob: wrap(orgId, k2) };
      }
      if (command instanceof DecryptCommand) {
        const ctx = command.input.EncryptionContext?.orgId;
        if (!ctx) throw new Error('AccessDeniedException: no orgId in encryption context');
        const blob = JSON.parse(Buffer.from(command.input.CiphertextBlob).toString('utf8'));
        if (blob.orgId && blob.orgId !== ctx) {
          throw new Error('InvalidCiphertextException: encryption context mismatch');
        }
        return { Plaintext: Buffer.from(blob.key, 'base64') };
      }
      throw new Error('unexpected KMS command');
    }
  },
  GenerateDataKeyCommand,
  DecryptCommand,
});

process.env.TABLE_NAME = 'test-table';
process.env.AI_PROMPTS_BUCKET = 'test-bucket';
process.env.TENANT_KMS_KEY_ID = 'alias/engage-tenant';

const admin = (f) => require(path.join(REPO, 'lambda-functions', 'admin', f));
const createPrompt = admin('create-ai-prompt.js');
const getPrompts = admin('get-ai-prompts.js');

if (!process.env.DEBUG) { console.log = () => {}; console.warn = () => {}; console.error = () => {}; }
const say = (...a) => process.stdout.write(a.join(' ') + '\n');

let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); say(`  PASS  ${label}`); pass++; }
  catch (e) { say(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

// ---- callers, IN THIS API'S REAL SHAPE -------------------------------------
// `requestContext.authorizer.lambda`, groups comma-joined. See require-admin.js.
const ORG = 'org_acme';
const caller = (lambda) => ({ requestContext: { authorizer: { lambda } } });
const HOST = caller({
  userId: 'sub-amara', username: 'amara', groups: 'hosts', status: 'enabled',
  orgId: ORG, orgRole: 'owner', orgIds: ORG,
});
const ORGLESS_HOST = caller({
  userId: 'sub-rob', username: 'rob', groups: 'hosts', status: 'enabled',
});
const STAFF = caller({ userId: 'sub-g', username: 'g', groups: 'admins', status: 'enabled' });
/** No groups and no org: a script, the seed, the suite's own direct calls. */
const INTERNAL = {};

/** Is this value the envelope shape tenant-crypto writes? */
const isEnvelope = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
  && typeof v.v === 'number' && typeof v.iv === 'string'
  && typeof v.tag === 'string' && typeof v.ct === 'string';

/**
 * Mint the org exactly as create-org does: ONE GenerateDataKey, and the wrapped
 * blob onto ORG#<id>/METADATA, which every tenant-crypto copy's default loader
 * reads through the stubbed DynamoDB.
 */
async function mintOrg(orgId) {
  const C = require(path.join(REPO, 'lambda-functions/admin/shared/tenant-crypto.js'));
  const blob = await C.createOrgDataKey(orgId);
  store.set(key(`ORG#${orgId}`, 'METADATA'),
    { PK: `ORG#${orgId}`, SK: 'METADATA', orgId, dataKeyCiphertext: blob });
  C.forgetOrg(orgId);
}

// So a check below can look INSIDE an org's encrypted S3 body — the same
// module the handler calls, required once and reused.
const { decryptValue } = require(path.join(REPO, 'lambda-functions/admin/shared/tenant-crypto.js'));

const BODY = {
  name: 'Retro Workie',
  description: 'what the room learned',
  gameType: 'call-and-answer',
  promptType: 'analysis',
  category: 'lessons-learned',
  instructions: 'Summarise the responses.',
  outputFormat: '## Summary\n{responsesText}',
};

const post = (who, body) =>
  createPrompt.handler({ ...who, body: JSON.stringify({ ...BODY, ...body }) });
const parse = (res) => { try { return JSON.parse(res.body); } catch { return {}; } };

(async () => {
  say('\norg-authored Workies\n');

  say('1. where a new Workie goes');

  // rejects: PK: 'AIPROMPTS' staying hard-coded, which writes a customer's
  // Workie into the library every other customer reads.
  store.clear(); s3Store.clear(); s3Meta.clear();
  await mintOrg(ORG);
  const orgRes = await post(HOST, {});
  const orgBody = parse(orgRes);
  await check('a host in an org creates a prompt (201)', () =>
    assert.strictEqual(orgRes.statusCode, 201, orgRes.body));
  await check('…and the row lands in the ORG partition', () =>
    assert.ok(store.get(`ORG#${ORG}#AIPROMPTS|AIPROMPT#${orgBody.promptId}`),
      `nothing at ORG#${ORG}#AIPROMPTS — keys present: ${[...store.keys()].join(' | ')}`));
  await check('…and NOT in the platform partition', () =>
    assert.strictEqual(store.get(`AIPROMPTS|AIPROMPT#${orgBody.promptId}`), undefined,
      'the org host wrote into the shared library'));

  // rejects: dropping promptOwnerStamp, which leaves canManagePrompt reading a
  // row that does not say whose it is.
  await check('the row is stamped with scope, orgId and the creator', () => {
    const row = store.get(`ORG#${ORG}#AIPROMPTS|AIPROMPT#${orgBody.promptId}`);
    assert.strictEqual(row.scope, 'org', `scope was ${JSON.stringify(row.scope)}`);
    assert.strictEqual(row.orgId, ORG);
    assert.strictEqual(row.createdBy, 'sub-amara');
  });

  // rejects: a response the client cannot address the new row with. A promptId
  // alone no longer names one partition.
  await check('the response carries the pair, not just the id', () => {
    assert.strictEqual(orgBody.scope, 'org');
    assert.strictEqual(orgBody.orgId, ORG);
  });

  // rejects: Engage staff losing the ability to author house content.
  store.clear(); s3Store.clear(); s3Meta.clear();
  const staffBody = parse(await post(STAFF, {}));
  await check('staff with no org still write PLATFORM, at the bare key', () =>
    assert.ok(store.get(`AIPROMPTS|AIPROMPT#${staffBody.promptId}`),
      `keys present: ${[...store.keys()].join(' | ')}`));

  // rejects: closing the seam every seed script, worker and existing test comes
  // through — see tests/ai-prompt-lifecycle.js, which passes no requestContext.
  store.clear(); s3Store.clear(); s3Meta.clear();
  const internalBody = parse(await post(INTERNAL, {}));
  await check('an internal caller (no groups, no org) still writes platform', () =>
    assert.ok(store.get(`AIPROMPTS|AIPROMPT#${internalBody.promptId}`),
      `keys present: ${[...store.keys()].join(' | ')}`));

  say('\n2. who is refused');

  /*
    A REAL host with no organisation is REFUSED rather than defaulted. This is
    the branch that, on the sets side, silently published every customer's
    generated content to the shared library for weeks.
  */
  // rejects: defaulting an orgless host to platform; and returning the generic
  // 500 that every other failure in this handler returns.
  store.clear(); s3Store.clear(); s3Meta.clear();
  const refused = await post(ORGLESS_HOST, {});
  await check('an orgless host is refused with 403, not 500 and not 201', () =>
    assert.strictEqual(refused.statusCode, 403, refused.body));
  await check('…with the sets wording, noun changed', () =>
    assert.strictEqual(parse(refused).error,
      'Choose an organisation before creating a Workie.'));
  await check('…and nothing was written to DynamoDB', () =>
    assert.strictEqual(store.size, 0, `wrote ${[...store.keys()].join(' | ')}`));
  await check('…and no orphan body was left in S3', () =>
    assert.strictEqual(s3Store.size, 0, `wrote ${[...s3Store.keys()].join(' | ')}`));

  // rejects: `?scope=platform` from an org host being an escalation rather than
  // a refusal.
  store.clear(); s3Store.clear(); s3Meta.clear();
  const escalation = await createPrompt.handler({
    ...HOST, body: JSON.stringify({ ...BODY, scope: 'platform' }),
  });
  await check('an org host asking for platform is refused', () =>
    assert.strictEqual(escalation.statusCode, 403, escalation.body));
  await check('…and wrote nothing', () =>
    assert.strictEqual(store.size, 0, `wrote ${[...store.keys()].join(' | ')}`));

  /*
    createPromptRef returns null for this AND for the orgless-host case above,
    and one generic message used to answer for both. Telling a caller who
    ALREADY HAS an org to "choose an organisation" sends them back to a step
    they already did — it is not just unhelpful, it names a state they are not
    in.
  */
  // rejects: reusing the orgless-host wording for an org host, which tells
  // them to do the thing they already did.
  await check('…with a message that is not "choose an organisation" — they did', () =>
    assert.notStrictEqual(parse(escalation).error,
      'Choose an organisation before creating a Workie.',
      'an org host was told to do the thing they already did'));
  await check('…and says the true rule instead', () =>
    assert.match(parse(escalation).error, /not acting for an organisation/i,
      `got: ${JSON.stringify(parse(escalation).error)}`));

  say('\n3. there is no org-level default');

  /*
    The bare AIPROMPTS partition holds three row shapes and only prompts move.
    The GAMETYPE#…#CATEGORY#… pointer answers "what does Engage use when a set
    names nothing", which is a house decision by definition, and
    get-ai-summary.js's findDefaultPromptId is a SCAN with `PK = :pk` equality
    against 'AIPROMPTS' — an ORG# row could never match it however it were
    stamped. So a stored `isDefault: true` on an org row would be a claim
    nothing in the product can honour.

    The house rule for that is written in this very handler, at
    create-ai-prompt.js:103-105: reject at the door rather than storing
    something that will be silently ignored at runtime.
  */
  // rejects: silently ignoring isDefault, which is "I set it and nothing
  // changed" — the exact complaint this area exists to fix.
  store.clear(); s3Store.clear(); s3Meta.clear();
  const orgDefault = await post(HOST, { isDefault: true });
  await check('an org prompt asking to be the default is refused with 400', () =>
    assert.strictEqual(orgDefault.statusCode, 400, orgDefault.body));
  await check('…and the refusal names the rule', () =>
    assert.match(parse(orgDefault).error, /cannot be a default/));
  await check('…and wrote no row at all', () =>
    assert.strictEqual(store.size, 0, `wrote ${[...store.keys()].join(' | ')}`));
  await check('…and left no orphan body in S3', () =>
    assert.strictEqual(s3Store.size, 0, `wrote ${[...s3Store.keys()].join(' | ')}`));

  // rejects: the sweep clearing a platform default from an org partition, or
  // the GAMETYPE# pointer being written into one.
  store.clear(); s3Store.clear(); s3Meta.clear();
  const houseDefault = parse(await post(STAFF, { isDefault: true }));
  await check('a PLATFORM prompt may still be the default', () =>
    assert.ok(store.get(`AIPROMPTS|AIPROMPT#${houseDefault.promptId}`),
      `keys present: ${[...store.keys()].join(' | ')}`));
  await check('…and its pointer row is in the BARE partition, unchanged', () => {
    const pointers = [...store.values()].filter((i) => String(i.SK).startsWith('GAMETYPE#'));
    assert.strictEqual(pointers.length, 1, `got ${pointers.length} pointer rows`);
    assert.strictEqual(pointers[0].PK, 'AIPROMPTS',
      `the default pointer moved to ${pointers[0].PK} — get-ai-summary's Scan cannot see it there`);
  });

  /*
    THE SCAN'S SAFETY, ASSERTED DIRECTLY. findDefaultPromptId (get-ai-summary.js
    :394-401) filters `PK = 'AIPROMPTS' AND isDefault = true`. Two independent
    things keep an org row out of it, and this asserts the second: no org row
    can carry isDefault: true, because the request is refused.
  */
  // rejects: storing isDefault: true on an org row "harmlessly", AND the sweep
  // running for an org request at all. Fix round 1, finding 3: the seed used to
  // stop at `{ isDefault: false }`, so the GAMETYPE# filter below was provably
  // `[]` — with or without the guard — and its forEach body never ran. This
  // seeds an actual `{ isDefault: true }` attempt from an org caller too, so
  // the guard (400, nothing written) is what keeps the pointer count at zero,
  // not the absence of anything that could have produced one. Pre-fix, this
  // same attempt returns 201 and DOES write a GAMETYPE# pointer — at the
  // hardcoded bare-partition literal, crediting the org's own promptId as the
  // house default.
  store.clear(); s3Store.clear(); s3Meta.clear();
  await mintOrg(ORG);
  await post(HOST, {});
  await post(HOST, { isDefault: false });
  await post(HOST, { isDefault: true });
  await check('no org prompt row anywhere carries isDefault: true', () =>
    [...store.values()]
      .filter((i) => String(i.PK).startsWith('ORG#'))
      .forEach((i) => assert.notStrictEqual(i.isDefault, true,
        `${i.PK}/${i.SK} claims a default the resolver can never honour`)));
  await check('no GAMETYPE# pointer was written outside the bare partition', () => {
    const pointers = [...store.values()].filter((i) => String(i.SK).startsWith('GAMETYPE#'));
    assert.strictEqual(pointers.length, 0,
      `an org isDefault attempt produced a pointer: ${JSON.stringify(pointers)}`);
  });

  say('\n4. the body is in S3, which the partition does not reach');

  /*
    The prompt TEXT is not in the DynamoDB row — only `s3Key` is. Two orgs whose
    slugs collide would overwrite each other's Workie text, and the row's
    partition scoping does not touch it. Platform keys are unchanged, which is
    what makes this zero migration in S3 as well.
  */
  // rejects: `prompts/${gameType}/${promptId}/v${version}.json` staying
  // hard-coded — the collision, and an org's text in the platform namespace.
  store.clear(); s3Store.clear(); s3Meta.clear();
  await mintOrg(ORG);
  const bodyOrg = parse(await post(HOST, {}));
  // THE INDEPENDENT GROUND TRUTH — built once, from nothing the handler
  // returned, and reused by every check below. Comparing the response's s3Key
  // against the S3 store's own key, or against the row's own s3Key field, only
  // proves the handler agrees with itself: all three are copies of the same
  // local `s3Key` variable in one invocation, so a wrong-but-consistent value
  // (e.g. the old unscoped path) would pass every one of those comparisons.
  // Fix round 1, finding 1+2.
  const expectedOrgBodyKey = `prompts/org/${ORG}/call-and-answer/${bodyOrg.promptId}/v1.json`;
  await check('an org body is written under prompts/org/<orgId>/', () =>
    assert.strictEqual(bodyOrg.s3Key, expectedOrgBodyKey, `s3Key was ${bodyOrg.s3Key}`));
  await check('…and that is the object that actually exists', () =>
    assert.ok(s3Store.has(expectedOrgBodyKey),
      `objects present: ${[...s3Store.keys()].join(' | ')}`));
  // rejects: storing the platform key on an org row, which would make
  // update-ai-prompt.js (which reads the stored key) rewrite the wrong object.
  await check('…and the ROW stores the scoped key, not a rebuilt one', () => {
    const row = store.get(`ORG#${ORG}#AIPROMPTS|AIPROMPT#${bodyOrg.promptId}`);
    assert.strictEqual(row && row.s3Key, expectedOrgBodyKey, `row.s3Key was ${row && row.s3Key}`);
  });

  // rejects: changing the platform key shape, which would orphan every body
  // stored since 2025.
  store.clear(); s3Store.clear(); s3Meta.clear();
  const bodyPlatform = parse(await post(STAFF, {}));
  await check('a platform body keeps the path it has always had', () =>
    assert.strictEqual(bodyPlatform.s3Key,
      `prompts/call-and-answer/${bodyPlatform.promptId}/v1.json`,
      `s3Key was ${bodyPlatform.s3Key}`));

  say('\n5. the body says whose it is');

  /*
    `metadata.author` was the constant string 'admin' on every prompt ever
    written. The body is the copy that TRAVELS — it is what includeContent
    returns, what export-to-archive copies wholesale, and what a published
    Workie would carry — so a constant there is a lie that outlives the row.
  */
  // rejects: metadata.author staying the constant 'admin' for a host-authored
  // org Workie.
  //
  // Task 6 (after this section was first written) wraps an org's whole S3
  // document as ONE envelope — see section 7 below — so `metadata.author` is
  // no longer sitting in the bucket in the clear for an org Workie. Decrypting
  // is the only way to look, and it is a STRICTER check than reading the raw
  // JSON used to be: it fails exactly as before if the author is still the
  // constant 'admin', and it ALSO fails if the body were encrypted under the
  // wrong org's key.
  store.clear(); s3Store.clear(); s3Meta.clear();
  await mintOrg(ORG);
  const stamped = parse(await post(HOST, {}));
  await check('the S3 body names the real author and the library', async () => {
    const raw = JSON.parse(s3Store.get(stamped.s3Key));
    const doc = await decryptValue(ORG, raw);
    assert.strictEqual(doc.metadata.author, 'sub-amara',
      `author was ${JSON.stringify(doc.metadata.author)}`);
    assert.strictEqual(doc.metadata.scope, 'org');
    assert.strictEqual(doc.metadata.orgId, ORG);
  });
  // rejects: an object in the bucket that cannot be attributed without a table
  // lookup.
  await check('the S3 object metadata carries the pair too', () => {
    const meta = s3Meta.get(stamped.s3Key);
    assert.strictEqual(meta.scope, 'org', `scope was ${JSON.stringify(meta.scope)}`);
    assert.strictEqual(meta.orgId, ORG);
  });
  // rejects: writing `orgId: undefined` into S3 user metadata on a platform
  // object, which the SDK sends as the literal string "undefined".
  store.clear(); s3Store.clear(); s3Meta.clear();
  const housed = parse(await post(STAFF, {}));
  await check('a platform object carries scope and NO orgId key', () => {
    const meta = s3Meta.get(housed.s3Key);
    assert.strictEqual(meta.scope, 'platform');
    assert.ok(!('orgId' in meta), `orgId present as ${JSON.stringify(meta.orgId)}`);
  });

  say('\n6. the list reads every library the caller may read');

  const list = (who, qs) =>
    getPrompts.handler({ ...who, queryStringParameters: qs || {} })
      .then((r) => ({ status: r.statusCode, body: JSON.parse(r.body) }));

  /*
    A new org Workie is invisible the moment it is written if the list still
    runs one Query on PK = 'AIPROMPTS'. That is why create and list are one
    change.
  */
  store.clear(); s3Store.clear(); s3Meta.clear();
  await mintOrg(ORG);
  const mine = parse(await post(HOST, { name: 'Ours' }));
  const house = parse(await post(STAFF, { name: 'Engage house' }));
  const mineToo = parse(await post(HOST, { name: 'Ours too' }));

  /*
    FORCE A REAL CONFLICT BETWEEN THE TWO SORTS, RATHER THAN TRUSTING WALL
    CLOCK ORDER. `readablePromptRefs` already returns `[org, platform, public]`
    (prompt-access.js), and `Promise.all(refs.map(...)).flat()` preserves that
    array order regardless of resolution timing — so the merged list is
    org-first BEFORE any sort runs. Every row created above also lands in the
    same millisecond, and `Array.prototype.sort` is stable, so a tie changes
    nothing either. Without forcing real dates, "the caller's own library
    comes first" passes on a flat `updatedAt` sort AND on no sort at all —
    proven by reverting `get-ai-prompts.js`'s sort both ways and re-running:
    still 37/0 either way.

    Two conflicts, because the sort's two clauses fail independently:

      - CROSS-scope (`SCOPE_RANK`): backdating platform's `updatedAt` to be
        NEWER than either org row's makes a flat date sort provably put
        platform first, while only the scope-rank sort still puts org first.
        "the caller's own library comes first" below asserts this.

      - WITHIN-scope (the `updatedAt` tie-break): `mineToo` is inserted
        SECOND, so the store's own Map iteration — what a MISSING sort
        leaves untouched, since nothing reorders it — returns it after
        `mine`. Giving `mineToo` the NEWER date of the two org rows means
        only a sort that actually runs puts it first; no sort at all leaves
        insertion order, `mine` first. "…and within it, the newest Workie
        leads" below asserts this — the cross-scope check alone cannot catch
        a deleted sort, because `readablePromptRefs` already guarantees
        org-before-platform by construction, independent of anything the
        handler does with the merged list afterward.

    All three backdated directly in the store, the pattern already used
    below for the persona row.
  */
  store.set(`ORG#${ORG}#AIPROMPTS|AIPROMPT#${mine.promptId}`, {
    ...store.get(`ORG#${ORG}#AIPROMPTS|AIPROMPT#${mine.promptId}`),
    updatedAt: '2019-01-01T00:00:00.000Z',
  });
  store.set(`ORG#${ORG}#AIPROMPTS|AIPROMPT#${mineToo.promptId}`, {
    ...store.get(`ORG#${ORG}#AIPROMPTS|AIPROMPT#${mineToo.promptId}`),
    updatedAt: '2021-01-01T00:00:00.000Z',
  });
  store.set(`AIPROMPTS|AIPROMPT#${house.promptId}`, {
    ...store.get(`AIPROMPTS|AIPROMPT#${house.promptId}`),
    updatedAt: '2030-01-01T00:00:00.000Z',
  });

  // rejects: the single Query on the bare partition, which is a platform-only
  // read and makes every org Workie invisible to its own author.
  const asHost = await list(HOST);
  await check('a host sees their own org Workie', () =>
    assert.ok(asHost.body.prompts.some((p) => p.promptId === mine.promptId),
      `ids returned: ${asHost.body.prompts.map((p) => p.promptId).join(', ') || '(none)'}`));
  await check('…and Engage\'s, in the same list', () =>
    assert.ok(asHost.body.prompts.some((p) => p.promptId === house.promptId)));
  // rejects: a client that holds a promptId and cannot tell which library it
  // came from — the pair is the reference, the id alone is not.
  await check('every row carries the scope pair', () => {
    const ours = asHost.body.prompts.find((p) => p.promptId === mine.promptId);
    const theirs = asHost.body.prompts.find((p) => p.promptId === house.promptId);
    assert.strictEqual(ours.scope, 'org', `ours.scope was ${JSON.stringify(ours.scope)}`);
    assert.strictEqual(ours.orgId, ORG);
    assert.strictEqual(theirs.scope, 'platform');
    assert.strictEqual(theirs.orgId, null);
  });
  // rejects: a flat updatedAt sort, which interleaves a team's own Workies with
  // Engage's twenty-two and makes "ours" unfindable in the surface built to
  // show them. readablePromptRefs already encodes the rank and the reason.
  await check('the caller\'s own library comes first', () =>
    assert.strictEqual(asHost.body.prompts[0].scope, 'org',
      `first row was ${asHost.body.prompts[0].scope}`));
  // rejects: a missing sort. readablePromptRefs already guarantees org before
  // platform by construction, so a deleted sort call still passes the check
  // above — the merge order alone accounts for scope rank. Recency within a
  // scope is the property only an actually-running sort provides: `mineToo`
  // is newer but was inserted SECOND, so a missing sort leaves it behind
  // `mine`, store insertion order unchanged.
  await check('…and within it, the newest Workie leads', () => {
    const orgRows = asHost.body.prompts.filter((p) => p.scope === 'org');
    assert.strictEqual(orgRows[0] && orgRows[0].promptId, mineToo.promptId,
      `first org row was ${orgRows[0] && orgRows[0].promptId}`);
  });

  // rejects: probing a partition the caller cannot read, which would turn
  // "absent" into "forbidden" and confirm another org's Workie exists.
  const OTHER = caller({
    userId: 'sub-zed', username: 'zed', groups: 'hosts', status: 'enabled',
    orgId: 'org_globex', orgRole: 'owner', orgIds: 'org_globex',
  });
  const asOther = await list(OTHER);
  await check('another organisation does not see it — absent, not forbidden', () => {
    assert.strictEqual(asOther.status, 200);
    assert.ok(!asOther.body.prompts.some((p) => p.promptId === mine.promptId),
      'org_globex can read org_acme\'s library');
  });
  await check('…but still sees the shared Engage library', () =>
    assert.ok(asOther.body.prompts.some((p) => p.promptId === house.promptId)));

  /*
    THE FILTERS. `category` and `status` are pushed into a FilterExpression,
    which is PER QUERY — so each partition needs its OWN input object. Sharing
    one object across a Promise.all and reassigning `:pk` between sends is a
    race in which every query can read the last `:pk` written.
  */
  // rejects: a shared, mutated query object; and a FilterExpression that stops
  // being applied to the org partition.
  //
  // Identified by promptId, not `name` — `name` is now an envelope for the org
  // row (section 7), which get-ai-prompts.js does not decrypt (Task 7). The
  // filter's job is unchanged: prove BOTH partitions were queried with the
  // FilterExpression applied, which promptId membership proves exactly as
  // well as the sentence did.
  store.clear(); s3Store.clear(); s3Meta.clear();
  await mintOrg(ORG);
  const orgLessons = parse(await post(HOST, { name: 'Org lessons', category: 'lessons-learned' }));
  await post(HOST, { name: 'Org retro', category: 'retro' });
  const houseLessons = parse(await post(STAFF, { name: 'House lessons', category: 'lessons-learned' }));
  const filtered = await list(HOST, { category: 'lessons-learned' });
  await check('the category filter applies to EVERY partition', () => {
    const ids = filtered.body.prompts.map((p) => p.promptId).sort();
    assert.deepStrictEqual(ids, [orgLessons.promptId, houseLessons.promptId].sort(),
      `got ${JSON.stringify(filtered.body.prompts.map((p) => ({ promptId: p.promptId, scope: p.scope })))}`);
  });
  // rejects: the JS gameType/promptType filters being applied per-partition
  // and losing rows, or being dropped in the merge.
  const byType = await list(HOST, { gameType: 'callandanswer' });
  await check('the legacy gameType spelling still matches across scopes', () =>
    assert.strictEqual(byType.body.prompts.length, 3,
      `got ${byType.body.prompts.length}`));

  /*
    PERSONAS AND THE DEFAULT POINTER SHARE THE BARE PARTITION AND MUST NOT
    APPEAR. `begins_with(SK, 'AIPROMPT#')` is what keeps them out and must stay.
  */
  // rejects: dropping the SK prefix condition while widening the query, which
  // would put personas and GAMETYPE# pointer rows in the prompt library.
  store.clear(); s3Store.clear(); s3Meta.clear();
  await post(STAFF, { isDefault: true });
  store.set('AIPROMPTS|PERSONA#sage', { PK: 'AIPROMPTS', SK: 'PERSONA#sage', name: 'Sage' });
  const clean = await list(HOST);
  await check('no persona and no default-pointer row enters the list', () =>
    clean.body.prompts.forEach((p) => {
      assert.ok(!String(p.SK).startsWith('PERSONA#'), `persona leaked: ${p.SK}`);
      assert.ok(!String(p.SK).startsWith('GAMETYPE#'), `pointer leaked: ${p.SK}`);
    }));

  say('\n7. an org\'s Workie is ciphertext at rest');

  /*
    docs/design/tenancy-redesign/08-privacy.html: "Engage staff browsing the
    database see identifiers and ciphertext, not your questions." A Workie is
    prose the customer wrote. A field shipping in plaintext breaks NOTHING —
    the product behaves identically and every other test passes — so these
    assertions are about BYTES AT REST, not about what the handler returns.
  */
  // rejects: dropping the encryptItem call, or gating it on something other
  // than the ref's scope.
  store.clear(); s3Store.clear(); s3Meta.clear();
  await mintOrg(ORG);
  const secret = parse(await post(HOST, {
    name: 'What we got wrong in Q3', description: 'the honest one',
    defaultSettings: { mustHaveCategories: 'Layoffs, Attrition, Reorg', numberOfCategories: 3 },
    tags: ['q3-retro', 'leadership-only'],
  }));
  await check('the org row\'s name and description are ENVELOPES, not sentences', () => {
    const row = store.get(`ORG#${ORG}#AIPROMPTS|AIPROMPT#${secret.promptId}`);
    assert.ok(isEnvelope(row.name), `name stored as ${JSON.stringify(row.name)}`);
    assert.ok(isEnvelope(row.description), `description stored as ${JSON.stringify(row.description)}`);
  });
  // rejects: defaultSettings and tags staying filed as "vocabulary... and
  // model configuration", which left AIGenerationPromptEditor's free-text
  // fields (mustHaveCategories, sampleCategories, contextPlaceholder,
  // audiencePlaceholder) sitting on the row in the clear beside an encrypted
  // name, while the identical strings were already ciphertext in S3.
  await check('…and so are defaultSettings and tags, which carry free text too', () => {
    const row = store.get(`ORG#${ORG}#AIPROMPTS|AIPROMPT#${secret.promptId}`);
    assert.ok(isEnvelope(row.defaultSettings), `defaultSettings stored as ${JSON.stringify(row.defaultSettings)}`);
    assert.ok(isEnvelope(row.tags), `tags stored as ${JSON.stringify(row.tags)}`);
    assert.ok(!JSON.stringify(row).includes('Layoffs'),
      'defaultSettings prose ("Layoffs, Attrition, Reorg") is sitting in the row in the clear');
  });
  // rejects: encrypting the columns the list filters on, which would silently
  // make every category and status filter return nothing for org prompts.
  await check('…but category, status and s3Key are still readable', () => {
    const row = store.get(`ORG#${ORG}#AIPROMPTS|AIPROMPT#${secret.promptId}`);
    assert.strictEqual(row.category, 'lessons-learned');
    assert.strictEqual(row.status, 'active');
    assert.strictEqual(row.s3Key, secret.s3Key);
    assert.strictEqual(row.orgId, ORG);
  });
  /*
    THE S3 HALF. ENCRYPTED_FIELDS alone encrypts the row and leaves the TEXT in
    the clear, in a shared bucket, beside a row that is ciphertext. That is the
    exact mistake spec §3 names.
  */
  // rejects: encrypting the row and forgetting the body.
  await check('the S3 body is an envelope, and the prose is not in it', () => {
    const raw = s3Store.get(secret.s3Key);
    assert.ok(!raw.includes('What we got wrong in Q3'),
      'the Workie name is sitting in the bucket in plaintext');
    assert.ok(!raw.includes('Summarise the responses.'),
      'the Workie instructions are sitting in the bucket in plaintext');
    assert.ok(isEnvelope(JSON.parse(raw)), `body was ${raw.slice(0, 80)}`);
  });

  // rejects: encrypting PLATFORM content, which would make the shared library
  // unreadable by everybody — upload-questions.js says why.
  store.clear(); s3Store.clear(); s3Meta.clear();
  const open = parse(await post(STAFF, { name: 'Engage house Workie' }));
  await check('a platform row is still plaintext', () => {
    const row = store.get(`AIPROMPTS|AIPROMPT#${open.promptId}`);
    assert.strictEqual(row.name, 'Engage house Workie');
  });
  await check('…and its S3 body is still the readable document', () => {
    const doc = JSON.parse(s3Store.get(open.s3Key));
    assert.strictEqual(doc.name, 'Engage house Workie');
  });

  say('\n8. …and the list unwraps it');

  // rejects: encrypting on write and forgetting to decrypt on read, which
  // renders `{v:1,iv:…}` where the Workie's name should be.
  store.clear(); s3Store.clear(); s3Meta.clear();
  await mintOrg(ORG);
  const wrapped = parse(await post(HOST, {
    name: 'What we got wrong in Q3', description: 'the honest one',
  }));
  const readBack = await list(HOST);
  await check('the org Workie comes back as sentences, not envelopes', () => {
    const row = readBack.body.prompts.find((p) => p.promptId === wrapped.promptId);
    assert.ok(row, `ids returned: ${readBack.body.prompts.map((p) => p.promptId).join(', ') || '(none)'}`);
    assert.strictEqual(row.name, 'What we got wrong in Q3',
      `name came back as ${JSON.stringify(row.name)}`);
    assert.strictEqual(row.description, 'the honest one');
  });

  // rejects: decrypting the row and leaving the BODY wrapped, so the picker's
  // shape preview and the summary engine both read an envelope.
  const withContent = await list(HOST, { includeContent: 'true' });
  await check('includeContent unwraps the S3 body too', () => {
    const row = withContent.body.prompts.find((p) => p.promptId === wrapped.promptId);
    assert.ok(row.promptContent, 'no promptContent on the row');
    assert.strictEqual(row.promptContent.name, 'What we got wrong in Q3',
      `promptContent.name was ${JSON.stringify(row.promptContent && row.promptContent.name)}`);
    assert.strictEqual(row.promptContent.instructions, 'Summarise the responses.');
  });

  // rejects: naming an orgId on a platform partition, which `requireOrgId`
  // throws on — the whole list would 500 for every caller.
  store.clear(); s3Store.clear(); s3Meta.clear();
  const plain = parse(await post(STAFF, { name: 'Engage house Workie' }));
  const staffList = await list(STAFF, { includeContent: 'true' });
  await check('a platform-only list still succeeds and reads plainly', () => {
    assert.strictEqual(staffList.status, 200, JSON.stringify(staffList.body));
    const row = staffList.body.prompts.find((p) => p.promptId === plain.promptId);
    assert.strictEqual(row.name, 'Engage house Workie');
    assert.strictEqual(row.promptContent.name, 'Engage house Workie');
  });

  /*
    THE MIGRATION, WHICH IS THE PASSTHROUGH RULE. There is no backfill: a row
    written into an org partition before encryption landed is plaintext and must
    keep reading.
  */
  // rejects: a decrypt that throws on plaintext, which would take out every row
  // written before this change.
  store.clear(); s3Store.clear(); s3Meta.clear();
  await mintOrg(ORG);
  store.set(key(`ORG#${ORG}#AIPROMPTS`, 'AIPROMPT#legacy'), {
    PK: `ORG#${ORG}#AIPROMPTS`, SK: 'AIPROMPT#legacy', promptId: 'legacy',
    name: 'Written before the cipher', gameType: 'call-and-answer',
    status: 'active', scope: 'org', orgId: ORG,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  });
  const mixed = await list(HOST);
  await check('a plaintext org row written before encryption still reads', () => {
    const row = mixed.body.prompts.find((p) => p.promptId === 'legacy');
    assert.ok(row, 'the pre-cipher row vanished from the list');
    assert.strictEqual(row.name, 'Written before the cipher');
  });

  say('\n9. what reaches CloudWatch');

  /*
    event.body is the WHOLE POST payload — name, description, instructions,
    outputFormat, basePrompt, every template field. This branch makes all of
    that ciphertext in DynamoDB and S3 (section 7 above); a log line that
    dumped the raw event put the identical sentences in CloudWatch instead, in
    the clear, readable with no kms:Decrypt and therefore no CloudTrail record
    — defeating the exact property tenant-crypto.js's header exists to
    guarantee.
  */
  store.clear(); s3Store.clear(); s3Meta.clear();
  await mintOrg(ORG);
  const savedLog = console.log;
  const logged = [];
  console.log = (...args) => { logged.push(args.map(String).join(' ')); };
  const PROSE = {
    name: 'What we got wrong in Q3',
    description: 'the honest one nobody wants in a slide',
    instructions: 'Summarise exactly what leadership got wrong, by name.',
    outputFormat: '## The uncomfortable part\n{responsesText}',
  };
  let loggedRes;
  try {
    loggedRes = await post(HOST, PROSE);
  } finally {
    console.log = savedLog;
  }
  const allLogged = logged.join('\n');

  await check('the create actually ran, so the log line actually ran', () =>
    assert.strictEqual(loggedRes.statusCode, 201, loggedRes.body));
  // rejects: JSON.stringify(event) at the top of the handler, and anything
  // else that echoes the request body wholesale.
  await check('none of the Workie prose reaches console.log', () => {
    for (const [field, text] of Object.entries(PROSE)) {
      assert.ok(!allLogged.includes(text), `${field} is in the log verbatim: ${allLogged}`);
    }
  });
  // Asserting only that lengths appear would pass a line that logged both the
  // lengths AND the prose — this is the other half, checked together.
  await check('…but each field\'s LENGTH is, so a request stays traceable', () => {
    for (const [field, text] of Object.entries(PROSE)) {
      assert.ok(allLogged.includes(`"${field}":${text.length}`),
        `expected "${field}":${text.length} somewhere in the log: ${allLogged}`);
    }
  });
  await check('…and the caller and org are traceable too', () => {
    assert.ok(allLogged.includes('sub-amara'), `expected the caller sub in the log: ${allLogged}`);
    assert.ok(allLogged.includes(ORG), `expected the orgId in the log: ${allLogged}`);
  });

  say('\n10. one corrupted row does not take the rest of the list down with it');

  /*
    decryptItem throws on the FIRST field it cannot decrypt, and the
    row-decrypt loop in get-ai-prompts.js used to let that escape straight to
    the outer Promise.all — which rejects the WHOLE handler the moment any ONE
    of its promises does, 500ing platform and public rows that were never in
    question. Simulated the way the real failure happens: not a wrong org
    (tests/tenant-crypto.js section 3 already owns that story), but a torn
    write — the stored envelope's own auth tag no longer matches its
    ciphertext, which is what a partial write or a rotated key leaves behind.
  */
  store.clear(); s3Store.clear(); s3Meta.clear();
  await mintOrg(ORG);
  const okPrompt = parse(await post(HOST, { name: 'Readable Workie' }));
  const badPrompt = parse(await post(HOST, { name: 'Corrupted Workie' }));
  const housePrompt = parse(await post(STAFF, { name: 'Engage house Workie' }));

  const badKey = `ORG#${ORG}#AIPROMPTS|AIPROMPT#${badPrompt.promptId}`;
  const badRow = store.get(badKey);
  const tamperedTag = Buffer.from(badRow.name.tag, 'base64');
  tamperedTag[0] ^= 0xff;
  store.set(badKey, { ...badRow, name: { ...badRow.name, tag: tamperedTag.toString('base64') } });

  const savedWarn = console.warn;
  const warned = [];
  console.warn = (...args) => { warned.push(args.map(String).join(' ')); };
  let corrupted;
  try {
    corrupted = await list(HOST);
  } finally {
    console.warn = savedWarn;
  }

  await check('the list still succeeds — one bad row is not a 500', () =>
    assert.strictEqual(corrupted.status, 200, JSON.stringify(corrupted.body)));
  await check('…the readable org row is still in it, still decrypted', () =>
    assert.ok(corrupted.body.prompts.some((p) =>
      p.promptId === okPrompt.promptId && p.name === 'Readable Workie'),
      `ids returned: ${(corrupted.body.prompts || []).map((p) => p.promptId).join(', ')}`));
  await check('…and the unrelated PLATFORM row is still in it too', () =>
    assert.ok(corrupted.body.prompts.some((p) => p.promptId === housePrompt.promptId),
      'the platform library vanished behind one org\'s bad row'));
  await check('…the bad row is still LISTED, not silently dropped', () =>
    assert.ok(corrupted.body.prompts.some((p) => p.promptId === badPrompt.promptId)));
  await check('…but its name is not the raw ciphertext envelope', () => {
    const row = corrupted.body.prompts.find((p) => p.promptId === badPrompt.promptId);
    assert.ok(!isEnvelope(row.name), `the envelope leaked into "name": ${JSON.stringify(row.name)}`);
  });
  await check('…and it honestly says it could not be read, rather than inventing a name', () => {
    const row = corrupted.body.prompts.find((p) => p.promptId === badPrompt.promptId);
    assert.strictEqual(row.decryptFailed, true, `row was ${JSON.stringify(row)}`);
    assert.strictEqual(row.name, null, `expected no fabricated name, got ${JSON.stringify(row.name)}`);
  });
  await check('…and it was logged server-side, naming the row and the org', () =>
    assert.ok(warned.some((w) => w.includes(badPrompt.promptId) && w.includes(ORG)),
      `nothing diagnosable was logged: ${JSON.stringify(warned)}`));

  say(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
