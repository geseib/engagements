/**
 * UPDATE AND DELETE, FOR THE SAME MULTI-TENANT WORKIE org-authored-prompts.js
 * ALREADY PROVES CREATE AND GET FOR.
 *
 * `create-ai-prompt.js` puts a new Workie in the author's own library
 * (platform or org); `get-ai-prompts.js` lists every library the caller may
 * read. `update-ai-prompt.js` and `delete-ai-prompt.js` were left behind: both
 * hardcoded `Key: { PK: 'AIPROMPTS' }` — the bare PLATFORM partition — while an
 * org's rows live at `ORG#<orgId>#AIPROMPTS`. An admin auto-assigned into their
 * own org (pickActiveOrg rule 2, no way to opt out) could create a Workie,
 * get a 201, and then find it un-editable and un-deletable through the
 * product: both routes 404'd on a row that was very much there.
 *
 * This file is the other half of org-authored-prompts.js: the REAL
 * update/delete handlers, driven against stubbed AWS, looking at what is
 * actually in the store afterwards — plus the encryption-bypass close on the
 * update side, which is not a scoping bug but is the reason this task exists.
 *
 * `PROMPT_HANDLERS_DIR` lets the SAME suite run against a different admin/
 * directory (used once, by hand, to confirm every assertion below actually
 * fails against the pre-fix handlers before it was trusted to pass against
 * the real ones). The default is the real handlers — nothing about ordinary
 * `for t in tests/*.js; do node "$t"; done` runs changes.
 *
 * Stubbing note (from tests/ai-prompt-lifecycle.js): poisoning require.cache
 * by resolved path silently misses, because several SDK packages these
 * handlers import exist only in the deployed bundle. Intercept Module._load
 * by request NAME instead, before any handler loads.
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
        // `removeUndefinedValues: true` IS MODELLED — see
        // tests/ai-prompt-status-update.js for why this matters: an
        // ExpressionAttributeValues entry whose value is `undefined` is
        // DROPPED before the request is sent while the clause that reads it
        // stays in the UpdateExpression, and DynamoDB refuses the whole write.
        // A stub that quietly assigns `undefined` turns a guaranteed failure
        // into a passing test.
        const values = Object.fromEntries(
          Object.entries(inp.ExpressionAttributeValues || {}).filter(([, v]) => v !== undefined)
        );
        const expr = String(inp.UpdateExpression || '');
        for (const ref of expr.match(/:[A-Za-z0-9_]+/g) || []) {
          if (!(ref in values)) {
            throw new Error(
              'ValidationException: Invalid UpdateExpression: An expression attribute value '
              + `used in expression is not defined; attribute value: ${ref}`
            );
          }
        }
        const setPart = (expr.replace(/^SET /, '').match(/^(.*?)(?:\s+REMOVE\b|$)/i) || [])[1];
        if (setPart) {
          for (const clause of setPart.split(',')) {
            const m = clause.trim().match(/^(#?[\w.]+)\s*=\s*(.+)$/);
            if (!m) continue;
            const attr = names[m[1]] || m[1];
            if (m[2].trim().startsWith(':')) item[attr] = values[m[2].trim()];
          }
        }
        const removePart = (expr.match(/REMOVE\s+(.*)$/i) || [])[1];
        if (removePart) {
          for (const t of removePart.split(',')) delete item[names[t.trim()] || t.trim()];
        }
        store.set(k, item);
        return { Attributes: item };
      }
      case 'query': {
        const v = inp.ExpressionAttributeValues || {};
        const names = inp.ExpressionAttributeNames || {};
        let items = [...store.values()].filter((i) =>
          i.PK === v[':pk'] && String(i.SK).startsWith(String(v[':sk'] ?? '')));
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

// ---- in-memory S3 -----------------------------------------------------------
const s3Store = new Map();
const s3Meta = new Map();
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
      if (cmd.type === 'delete') { s3Store.delete(cmd.input.Key); s3Meta.delete(cmd.input.Key); return {}; }
      if (cmd.type === 'deleteMany') {
        for (const o of (cmd.input.Delete && cmd.input.Delete.Objects) || []) {
          s3Store.delete(o.Key); s3Meta.delete(o.Key);
        }
        return {};
      }
      if (cmd.type === 'list') {
        const prefix = cmd.input.Prefix || '';
        const Contents = [...s3Store.keys()]
          .filter((k) => k.startsWith(prefix))
          .map((k) => ({ Key: k }));
        return { Contents };
      }
      return {};
    }
  },
  PutObjectCommand: class { constructor(i) { this.input = i; this.type = 'put'; } },
  GetObjectCommand: class { constructor(i) { this.input = i; this.type = 'get'; } },
  DeleteObjectCommand: class { constructor(i) { this.input = i; this.type = 'delete'; } },
  DeleteObjectsCommand: class { constructor(i) { this.input = i; this.type = 'deleteMany'; } },
  ListObjectsV2Command: class { constructor(i) { this.input = i; this.type = 'list'; } },
});

// ---- a KMS that behaves the way the key policy will --------------------------
const nodeCrypto = require('crypto');
class GenerateDataKeyCommand { constructor(i) { this.input = i; } }
class DecryptCommand { constructor(i) { this.input = i; } }
const wrap = (orgId, k) =>
  Buffer.from(JSON.stringify({ orgId, key: k.toString('base64') }), 'utf8');

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

// create-ai-prompt.js and get-ai-prompts.js are NOT part of this task and are
// always the real, current handlers. update-ai-prompt.js and delete-ai-prompt.js
// are the ones under test, and PROMPT_HANDLERS_DIR can point them at a
// different admin/ directory (a reconstructed pre-fix copy) for a one-off red
// check; ordinary runs never set it.
const REAL_ADMIN = path.join(REPO, 'lambda-functions', 'admin');
const ADMIN_DIR = process.env.PROMPT_HANDLERS_DIR || REAL_ADMIN;
const admin = (f) => require(path.join(REAL_ADMIN, f));
const adminUnderTest = (f) => require(path.join(ADMIN_DIR, f));

const createPrompt = admin('create-ai-prompt.js');
const getPrompts = admin('get-ai-prompts.js');
const updatePrompt = adminUnderTest('update-ai-prompt.js');
const deletePrompt = adminUnderTest('delete-ai-prompt.js');

if (!process.env.DEBUG) { console.log = () => {}; console.warn = () => {}; console.error = () => {}; }
const say = (...a) => process.stdout.write(a.join(' ') + '\n');

let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); say(`  PASS  ${label}`); pass++; }
  catch (e) { say(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const reset = () => { store.clear(); s3Store.clear(); s3Meta.clear(); };

// ---- callers, IN THIS API'S REAL SHAPE --------------------------------------
// `requestContext.authorizer.lambda`, groups comma-joined. See require-admin.js.
//
// BOTH ROUTES UNDER TEST ARE ADMINS-ONLY AT THE AUTHORIZER
// (auth/authorizer.js: `PUT/DELETE admin/ai-prompts/{promptId}` are absent
// from HOST_ADMIN_ROUTES by name, so they fall to the trailing `admin/*` rule,
// `['admins']`) — a plain host can never reach either handler, full stop, org
// Workie or not. So every caller below carries `admins`. The bug this task
// closes needs nothing more exotic than that: an Engage admin who has an
// active org selected (pickActiveOrg rule 2, no way to opt out) is still,
// underneath the group check, editing/deleting content — and `canManagePrompt`
// is the thing that has to tell platform and org apart from there.
const ORG_A = 'org_acme';
const ORG_B = 'org_globex';
const caller = (lambda) => ({ requestContext: { authorizer: { lambda } } });
/** An admin, acting for their own org, who authored the Workie in question. */
const orgAdmin = (orgId, sub = 'sub-amara', username = 'amara') => caller({
  userId: sub, username, groups: 'admins', status: 'enabled',
  orgId, orgRole: 'member', orgIds: orgId,
});
/** An admin with no active org — Engage staff maintaining the house library. */
const PLATFORM_ADMIN = caller({
  userId: 'sub-g', username: 'g', groups: 'admins', status: 'enabled',
});

/** Is this value the envelope shape tenant-crypto writes? */
const isEnvelope = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
  && typeof v.v === 'number' && typeof v.iv === 'string'
  && typeof v.tag === 'string' && typeof v.ct === 'string';

/** Mint the org exactly as create-org does — see org-authored-prompts.js. */
async function mintOrg(orgId) {
  const C = require(path.join(REPO, 'lambda-functions/admin/shared/tenant-crypto.js'));
  const blob = await C.createOrgDataKey(orgId);
  store.set(key(`ORG#${orgId}`, 'METADATA'),
    { PK: `ORG#${orgId}`, SK: 'METADATA', orgId, dataKeyCiphertext: blob });
  C.forgetOrg(orgId);
}

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
const put = (who, promptId, body) => updatePrompt.handler({
  ...who, pathParameters: { promptId }, body: JSON.stringify(body),
});
const del = (who, promptId, qs) => deletePrompt.handler({
  ...who, pathParameters: { promptId }, queryStringParameters: qs || {},
});
const list = (who, qs) => getPrompts.handler({ ...who, queryStringParameters: qs || {} })
  .then((r) => ({ status: r.statusCode, body: JSON.parse(r.body) }));
const parse = (res) => { try { return JSON.parse(res.body); } catch { return {}; } };
const rowAt = (pk, sk) => store.get(key(pk, sk));

(async () => {
  say('\nupdate and delete, for the same multi-tenant Workie\n');

  say('1. an org host edits their own org Workie');

  // rejects: `Key: { PK: 'AIPROMPTS' }` hardcoded — the exact bug. Pre-fix this
  // 500s ("AI prompt not found") because the row lives at
  // ORG#<orgId>#AIPROMPTS and the handler never looked there.
  reset();
  await mintOrg(ORG_A);
  const admin1 = orgAdmin(ORG_A);
  const created1 = parse(await post(admin1, {
    name: 'Q3 Retro Notes', description: 'first draft',
  }));
  const edited1 = await put(admin1, created1.promptId, {
    name: 'Q3 Retro Notes (final)', description: 'the honest version',
  });
  await check('the edit succeeds (200), not the pre-fix 500', () =>
    assert.strictEqual(edited1.statusCode, 200, edited1.body));
  await check('…and reports the scope it actually landed in', () => {
    const body = parse(edited1);
    assert.strictEqual(body.scope, 'org', `scope was ${JSON.stringify(body.scope)}`);
    assert.strictEqual(body.orgId, ORG_A);
  });

  // THE ROW STAYS AN ENVELOPE, AND DECRYPTS TO THE NEW VALUE — not the
  // handler's own echo of what it wrote, an INDEPENDENT decrypt of what is
  // actually sitting in the store, compared to the literal string this test
  // sent. Proves both that the edit landed and that it stayed encrypted; a
  // handler that wrote plaintext-over-ciphertext (the bypass) would fail the
  // `isEnvelope` half, and a handler that silently no-op'd would fail the
  // decrypt-equals-new-value half.
  await check('the row\'s name and description are ENVELOPES after the edit, decrypting to the NEW text', async () => {
    const row = rowAt(`ORG#${ORG_A}#AIPROMPTS`, `AIPROMPT#${created1.promptId}`);
    assert.ok(isEnvelope(row.name), `name stored as ${JSON.stringify(row.name)}`);
    assert.ok(isEnvelope(row.description), `description stored as ${JSON.stringify(row.description)}`);
    assert.strictEqual(await decryptValue(ORG_A, row.name), 'Q3 Retro Notes (final)');
    assert.strictEqual(await decryptValue(ORG_A, row.description), 'the honest version');
  });

  // THE S3 BODY TOO — create-ai-prompt.js wraps the whole document; an edit
  // that forgot to re-wrap it would leave the Workie's actual instructions
  // readable in the bucket in the clear.
  await check('the S3 body is still an envelope, and decrypts to the merged document', async () => {
    const raw = s3Store.get(parse(edited1).s3Key);
    assert.ok(!raw.includes('Q3 Retro Notes'), 'the Workie name is sitting in the bucket in plaintext');
    const doc = await decryptValue(ORG_A, JSON.parse(raw));
    assert.strictEqual(doc.name, 'Q3 Retro Notes (final)');
    assert.strictEqual(doc.description, 'the honest version');
    // Untouched by this edit — must have survived the currentContent merge,
    // not been dropped because the pre-edit read came back as an
    // undecrypted envelope with no `.instructions` property to fall back to.
    assert.strictEqual(doc.instructions, 'Summarise the responses.',
      'the untouched instructions field did not survive the merge — currentContent was not decrypted');
  });

  // rejects: `category` being swept into the encrypted set. tenant-crypto.js
  // is explicit that it must stay plaintext (get-ai-prompts.js filters on it
  // by equality), and create-ai-prompt.js already leaves it that way.
  await check('…but category is still plaintext, so the FilterExpression the library uses can still match it', () => {
    const row = rowAt(`ORG#${ORG_A}#AIPROMPTS`, `AIPROMPT#${created1.promptId}`);
    assert.strictEqual(row.category, 'lessons-learned', `category stored as ${JSON.stringify(row.category)}`);
  });

  say('\n2. an org host deletes their own org Workie');

  // rejects: the same hardcoded platform key on the delete side. Pre-fix this
  // 404s (delete-ai-prompt.js's own "not found" mapping) because neither the
  // canonical nor the legacy key is where an org row lives.
  reset();
  await mintOrg(ORG_A);
  const admin2 = orgAdmin(ORG_A);
  const created2 = parse(await post(admin2, {}));
  const s3KeyBefore = created2.s3Key;
  const deleted2 = await del(admin2, created2.promptId, { hardDelete: 'true' });
  await check('the delete succeeds (200), not the pre-fix 404', () =>
    assert.strictEqual(deleted2.statusCode, 200, deleted2.body));
  await check('…and the row is gone from the ORG partition', () =>
    assert.strictEqual(rowAt(`ORG#${ORG_A}#AIPROMPTS`, `AIPROMPT#${created2.promptId}`), undefined));
  await check('…and the S3 object is gone', () =>
    assert.strictEqual(s3Store.has(s3KeyBefore), false, `still present: ${s3KeyBefore}`));

  say('\n3. a platform Workie edits and deletes exactly as it does today');

  /*
    Not a bug being fixed — a constraint being held. Both of these succeed on
    the PRE-fix handler too, for a caller with `admins` and no active org
    (which is all the pre-fix handler ever checked — nothing). What actually
    distinguishes fixed from unfixed here is section 9 below, where the SAME
    platform row is approached by an admin who DOES have an org active.
  */
  reset();
  const platformCreated = parse(await post(PLATFORM_ADMIN, { name: 'House Workie' }));
  const platformEdited = await put(PLATFORM_ADMIN, platformCreated.promptId, { name: 'House Workie (renamed)' });
  await check('a platform edit still succeeds for Engage staff acting as Engage', () =>
    assert.strictEqual(platformEdited.statusCode, 200, platformEdited.body));
  await check('…at the byte-identical bare key', () => {
    const row = rowAt('AIPROMPTS', `AIPROMPT#${platformCreated.promptId}`);
    assert.ok(row, 'nothing at PK: AIPROMPTS');
    assert.strictEqual(row.name, 'House Workie (renamed)', `name stored as ${JSON.stringify(row.name)}`);
  });
  const platformDeleted = await del(PLATFORM_ADMIN, platformCreated.promptId, { hardDelete: 'true' });
  await check('a platform delete still succeeds', () =>
    assert.strictEqual(platformDeleted.statusCode, 200, platformDeleted.body));
  await check('…and removes the bare-key row', () =>
    assert.strictEqual(rowAt('AIPROMPTS', `AIPROMPT#${platformCreated.promptId}`), undefined));

  say('\n4. org A cannot see, edit or delete org B\'s Workie');

  reset();
  await mintOrg(ORG_A);
  await mintOrg(ORG_B);
  const ownerA = orgAdmin(ORG_A, 'sub-amara', 'amara');
  const attackerB = orgAdmin(ORG_B, 'sub-zed', 'zed');
  const targetA = parse(await post(ownerA, { name: 'Org A\'s private Workie' }));

  const editAttempt = await put(attackerB, targetA.promptId, { name: 'overwritten' });
  await check('org B\'s edit attempt on org A\'s Workie is a 404', () =>
    assert.strictEqual(editAttempt.statusCode, 404, editAttempt.body));
  await check('…NOT a 403 — that would confirm the row exists', () =>
    assert.notStrictEqual(editAttempt.statusCode, 403));

  const deleteAttempt = await del(attackerB, targetA.promptId, { hardDelete: 'true' });
  await check('org B\'s delete attempt on org A\'s Workie is a 404', () =>
    assert.strictEqual(deleteAttempt.statusCode, 404, deleteAttempt.body));
  await check('…NOT a 403', () => assert.notStrictEqual(deleteAttempt.statusCode, 403));

  // THE ABSENT-NOT-FORBIDDEN PROPERTY, ASSERTED DIRECTLY: the SAME generic
  // "not found" template a truly nonexistent id gets, not a special-cased
  // "this belongs to someone else" that would confirm the row exists. Each
  // message interpolates its own id, so the check is against an
  // INDEPENDENTLY BUILT expected string for each — not the two literal
  // strings against each other, which would never match (different ids) even
  // from a correct implementation.
  const trulyMissing = await put(attackerB, 'does-not-exist-anywhere', { name: 'x' });
  await check('…and is worded exactly like a truly nonexistent promptId, not a special case', () => {
    assert.strictEqual(parse(editAttempt).error, `AI prompt not found: ${targetA.promptId}`,
      `got: ${JSON.stringify(parse(editAttempt).error)}`);
    assert.strictEqual(parse(trulyMissing).error, 'AI prompt not found: does-not-exist-anywhere',
      `got: ${JSON.stringify(parse(trulyMissing).error)}`);
  });

  await check('org A\'s Workie is untouched by any of it', () => {
    const row = rowAt(`ORG#${ORG_A}#AIPROMPTS`, `AIPROMPT#${targetA.promptId}`);
    assert.ok(row, 'org A\'s row vanished');
  });

  // The SAME property from the read side, for completeness — org-authored-
  // prompts.js section 6 already owns this story for the list, so this is
  // one confirming check, not a re-derivation of it.
  const listAsB = await list(attackerB);
  await check('…and org A\'s Workie never appears in org B\'s list either', () =>
    assert.ok(!listAsB.body.prompts.some((p) => p.promptId === targetA.promptId)));

  say('\n5. a legacy-shaped platform row still deletes');

  // The pre-D14 shape only populate-default-prompts.js (dead, unrouted) ever
  // wrote. Nothing about tenancy changes it: still tried, still platform,
  // still deletable — the scope-aware search misses it (it is not at
  // PK:'AIPROMPTS'/SK:'AIPROMPT#…') and the legacy fallback catches it.
  reset();
  store.set(key('AI_PROMPT#legacy-1', 'METADATA'), {
    PK: 'AI_PROMPT#legacy-1', SK: 'METADATA',
    promptId: 'legacy-1', name: 'Legacy Row', gameType: 'callandanswer', isDefault: false,
  });
  const legacyDeleted = await del(PLATFORM_ADMIN, 'legacy-1', { hardDelete: 'true' });
  await check('the legacy row deletes (200)', () =>
    assert.strictEqual(legacyDeleted.statusCode, 200, legacyDeleted.body));
  await check('…and is actually gone', () =>
    assert.strictEqual(rowAt('AI_PROMPT#legacy-1', 'METADATA'), undefined));

  say('\n6. there is no org-level default, on the update side either');

  /*
    create-ai-prompt.js already refuses `isDefault: true` for an org row at
    creation (org-authored-prompts.js section 3). Without the matching refusal
    here, an org could create with isDefault:false (passes) and then flip it
    on through an edit — reopening the exact hole creation closes, and writing
    a GAMETYPE#… pointer at the bare 'AIPROMPTS' partition crediting an org's
    own promptId as Engage's house default for every tenant.
  */
  reset();
  await mintOrg(ORG_A);
  const admin6 = orgAdmin(ORG_A);
  const created6 = parse(await post(admin6, {}));
  const flipAttempt = await put(admin6, created6.promptId, { isDefault: true });
  await check('flipping isDefault:true on an org Workie is refused with 400', () =>
    assert.strictEqual(flipAttempt.statusCode, 400, flipAttempt.body));
  await check('…naming the rule', () =>
    assert.match(parse(flipAttempt).error, /cannot be a default/));
  await check('…and no GAMETYPE# pointer was written anywhere', () => {
    const pointers = [...store.values()].filter((i) => String(i.SK).startsWith('GAMETYPE#'));
    assert.strictEqual(pointers.length, 0, `a pointer was written: ${JSON.stringify(pointers)}`);
  });
  await check('…and the row itself was not flipped', () =>
    assert.notStrictEqual(rowAt(`ORG#${ORG_A}#AIPROMPTS`, `AIPROMPT#${created6.promptId}`).isDefault, true));

  say('\n7. deleteAllVersions sweeps the ORG-scoped prefix, not the platform one');

  /*
    The single-key path (`currentPrompt.s3Key`) was already scope-correct
    coming in — it is a stored field, not rebuilt. `deleteAllVersions` rebuilds
    a PREFIX instead, and that rebuild was hardcoded to the platform shape:
    `prompts/${gameType}/${promptId}/`. For an org row that lists (and so only
    ever deletes) the wrong directory, leaving every version of the org's
    Workie behind while the response claims success.
  */
  reset();
  await mintOrg(ORG_A);
  const admin7 = orgAdmin(ORG_A);
  const created7 = parse(await post(admin7, {}));
  // A second version, so there is more than one object for "all versions" to
  // actually mean something — minted via an edit that forces a new version.
  await put(admin7, created7.promptId, { name: 'v2', createNewVersion: true });
  const orgVersionKeys = [...s3Store.keys()].filter((k) => k.includes(created7.promptId));
  await check('the fixture really does have more than one org-scoped object', () =>
    assert.ok(orgVersionKeys.length >= 2, `only ${orgVersionKeys.length} object(s): ${orgVersionKeys.join(', ')}`));
  await check('…and every one of them is under prompts/org/<orgId>/, not prompts/<gameType>/', () =>
    orgVersionKeys.forEach((k) => assert.ok(k.startsWith(`prompts/org/${ORG_A}/`), `unscoped key: ${k}`)));

  const sweepAll = await del(admin7, created7.promptId, { hardDelete: 'true', deleteAllVersions: 'true' });
  await check('deleteAllVersions succeeds', () =>
    assert.strictEqual(sweepAll.statusCode, 200, sweepAll.body));
  await check('…and actually removed every org-scoped version, not zero of them', () => {
    const remaining = [...s3Store.keys()].filter((k) => k.includes(created7.promptId));
    assert.deepStrictEqual(remaining, [], `left behind: ${remaining.join(', ')}`);
  });

  say('\n8. minting a new version of an org Workie stays in the org\'s S3 path');

  // rejects: `newS3Key = \`prompts/${gameType}/${promptId}/v${n}.json\`` — the
  // hardcoded platform shape create-ai-prompt.js's OWN fix already replaced on
  // the create side. A version-bump here would silently start writing a
  // customer's Workie text into the shared bucket namespace.
  reset();
  await mintOrg(ORG_A);
  const admin8 = orgAdmin(ORG_A);
  const created8 = parse(await post(admin8, {}));
  const versioned8 = await put(admin8, created8.promptId, { createNewVersion: true });
  const expectedV2Key = `prompts/org/${ORG_A}/call-and-answer/${created8.promptId}/v2.json`;
  await check('the new version\'s key is scoped', () =>
    assert.strictEqual(parse(versioned8).s3Key, expectedV2Key, `s3Key was ${parse(versioned8).s3Key}`));
  await check('…and that object actually exists', () =>
    assert.ok(s3Store.has(expectedV2Key), `objects present: ${[...s3Store.keys()].join(', ')}`));
  await check('…and the row points at it', () =>
    assert.strictEqual(rowAt(`ORG#${ORG_A}#AIPROMPTS`, `AIPROMPT#${created8.promptId}`).s3Key, expectedV2Key));

  say('\n9. the interlock: an admin ACTING FOR an org cannot touch a PLATFORM Workie');

  /*
    The question-set precedent's whole point, restated for prompts: being an
    Engage administrator does not grant access to content while standing
    inside an organisation. Pre-fix this SUCCEEDS — the old handler checked
    nothing about the caller at all, which is section 3's real distinction
    from this one.
  */
  reset();
  await mintOrg(ORG_A);
  const houseWorkie = parse(await post(PLATFORM_ADMIN, { name: 'Engage house Workie' }));
  const actingForOrg = orgAdmin(ORG_A);
  const interlockEdit = await put(actingForOrg, houseWorkie.promptId, { name: 'renamed by mistake' });
  await check('an admin with an active org is refused editing a platform Workie (403)', () =>
    assert.strictEqual(interlockEdit.statusCode, 403, interlockEdit.body));
  await check('…and the platform row is untouched', () =>
    assert.strictEqual(rowAt('AIPROMPTS', `AIPROMPT#${houseWorkie.promptId}`).name, 'Engage house Workie'));
  const interlockDelete = await del(actingForOrg, houseWorkie.promptId, { hardDelete: 'true' });
  await check('…and refused deleting one too', () =>
    assert.strictEqual(interlockDelete.statusCode, 403, interlockDelete.body));
  await check('…still there afterward', () =>
    assert.ok(rowAt('AIPROMPTS', `AIPROMPT#${houseWorkie.promptId}`)));

  say('\n10. an org admin may manage a teammate\'s Workie, not just their own');

  // The second clause of canManagePrompt's org branch — canManageScope(...,
  // 'admin') — never exercised by sections 1/2 above, which both use the
  // CREATOR path. An 'owner' teammate who did not author the Workie must
  // still be able to manage it, mirroring question sets exactly.
  reset();
  await mintOrg(ORG_A);
  const author = orgAdmin(ORG_A, 'sub-amara', 'amara');
  const created10 = parse(await post(author, { name: 'Team Workie' }));
  const owner = caller({
    userId: 'sub-priya', username: 'priya', groups: 'admins', status: 'enabled',
    orgId: ORG_A, orgRole: 'owner', orgIds: ORG_A,
  });
  const teammateEdit = await put(owner, created10.promptId, { name: 'Edited by the org owner' });
  await check('an org owner who did not author it may still edit it (200)', () =>
    assert.strictEqual(teammateEdit.statusCode, 200, teammateEdit.body));
  const plainMember = caller({
    userId: 'sub-jae', username: 'jae', groups: 'admins', status: 'enabled',
    orgId: ORG_A, orgRole: 'member', orgIds: ORG_A,
  });
  const strangerEdit = await put(plainMember, created10.promptId, { name: 'should not land' });
  await check('…but a plain member who did not author it may not (403)', () =>
    assert.strictEqual(strangerEdit.statusCode, 403, strangerEdit.body));

  say('\n11. what reaches CloudWatch on update and delete');

  /*
    event.body on an UPDATE carries the same Workie prose create's does — name,
    description, instructions, outputFormat — and this handler makes all of it
    ciphertext in DynamoDB and S3 (section 1 above). A log line dumping the raw
    event puts the identical sentences in CloudWatch instead, in the clear,
    defeating the property tenant-crypto.js's header exists to guarantee, on
    every edit, regardless of anything else being fixed. DELETE carries no
    prose in its body, but the raw event still carries the bearer identity in
    `requestContext.authorizer.lambda` — the same leak get-ai-prompts.js's own
    fix closed for the same reason.
  */
  reset();
  await mintOrg(ORG_A);
  const admin11 = orgAdmin(ORG_A);
  const created11 = parse(await post(admin11, {}));
  const savedLog = console.log;
  const logged = [];
  console.log = (...args) => { logged.push(args.map(String).join(' ')); };
  const PROSE = {
    name: 'What we got wrong in Q3',
    description: 'the honest one nobody wants in a slide',
    instructions: 'Summarise exactly what leadership got wrong, by name.',
  };
  let editRes;
  try {
    editRes = await put(admin11, created11.promptId, PROSE);
  } finally {
    console.log = savedLog;
  }
  const editLog = logged.join('\n');
  await check('the edit actually ran, so the log line actually ran', () =>
    assert.strictEqual(editRes.statusCode, 200, editRes.body));
  await check('none of the Workie prose reaches console.log on update', () => {
    for (const [field, text] of Object.entries(PROSE)) {
      assert.ok(!editLog.includes(text), `${field} is in the log verbatim: ${editLog}`);
    }
  });
  await check('…but the caller and org are still traceable', () => {
    assert.ok(editLog.includes('sub-amara'), `expected the caller sub in the log: ${editLog}`);
    assert.ok(editLog.includes(ORG_A), `expected the orgId in the log: ${editLog}`);
  });

  const logged2 = [];
  console.log = (...args) => { logged2.push(args.map(String).join(' ')); };
  let delRes;
  try {
    delRes = await del(admin11, created11.promptId, { hardDelete: 'true' });
  } finally {
    console.log = savedLog;
  }
  const delLog = logged2.join('\n');
  await check('the delete actually ran too', () =>
    assert.strictEqual(delRes.statusCode, 200, delRes.body));
  await check('no bearer identity or raw authorizer context reaches console.log on delete', () => {
    assert.ok(!delLog.includes('"authorizer"'), `the raw event was logged: ${delLog}`);
    assert.ok(!delLog.includes('"lambda"'), `the raw authorizer context was logged: ${delLog}`);
  });
  await check('…but the caller and org are still traceable there too', () => {
    assert.ok(delLog.includes('sub-amara'), `expected the caller sub in the log: ${delLog}`);
    assert.ok(delLog.includes(ORG_A), `expected the orgId in the log: ${delLog}`);
  });

  say('\n12. isDefault:false on an org row must never delete the PLATFORM default pointer');

  /*
    Section 6 refuses turning a default ON for a non-platform Workie, both at
    creation (create-ai-prompt.js) and on this edit route — but that refusal,
    by its own design, only ever fires for `isDefault: true`. `isDefault:
    false` always goes through unchecked by scope (see the comment on the
    isDefault block in update-ai-prompt.js). The `false` branch there then
    deleted `GAMETYPE#<gameType>#CATEGORY#<category>` at the bare 'AIPROMPTS'
    partition — Engage's default-Workie pointer, shared by every tenant —
    gated solely on `currentPrompt.isDefault === true`, with nothing checking
    that the row asking to be unset is the platform row that pointer actually
    describes.

    No route today can produce an org row carrying `isDefault: true` (create
    refuses it, section 6 refuses it on edit too), so the fixture below is
    written directly into the store — standing in for a restored fixture, a
    hand-written row, or a future relaxation of either refusal.
  */
  reset();
  await mintOrg(ORG_A);

  // Engage's real default for this game type/category, set through the front
  // door exactly as an Engage admin would.
  const houseDefault12 = parse(await post(PLATFORM_ADMIN, { name: 'House Default' }));
  const setDefault12 = await put(PLATFORM_ADMIN, houseDefault12.promptId, { isDefault: true });
  await check('fixture setup: the house default is actually set (200)', () =>
    assert.strictEqual(setDefault12.statusCode, 200, setDefault12.body));
  const pointerKey12 = { PK: 'AIPROMPTS', SK: `GAMETYPE#${BODY.gameType}#CATEGORY#${BODY.category}` };
  const pointerBefore12 = rowAt(pointerKey12.PK, pointerKey12.SK);
  await check('fixture setup: the platform pointer row actually exists', () =>
    assert.ok(pointerBefore12, 'no GAMETYPE# pointer was written by the fixture setup'));

  // An org row that SOMEHOW carries isDefault:true, for the same gameType and
  // category as the house default above — written directly, because no
  // handler will produce this shape through the front door.
  const orgDefaultId12 = 'org-row-claiming-default';
  store.set(key(`ORG#${ORG_A}#AIPROMPTS`, `AIPROMPT#${orgDefaultId12}`), {
    PK: `ORG#${ORG_A}#AIPROMPTS`, SK: `AIPROMPT#${orgDefaultId12}`,
    promptId: orgDefaultId12, scope: 'org', orgId: ORG_A, createdBy: 'sub-amara',
    gameType: BODY.gameType, category: BODY.category,
    name: 'Org Workie somehow carrying isDefault:true', isDefault: true, status: 'active',
  });

  const orgOwner12 = orgAdmin(ORG_A, 'sub-amara', 'amara');
  const unsetAttempt12 = await put(orgOwner12, orgDefaultId12, { isDefault: false });
  await check('the org caller\'s own edit still succeeds (200)', () =>
    assert.strictEqual(unsetAttempt12.statusCode, 200, unsetAttempt12.body));
  await check('…the org row itself is actually unset', () =>
    assert.strictEqual(rowAt(`ORG#${ORG_A}#AIPROMPTS`, `AIPROMPT#${orgDefaultId12}`).isDefault, false));
  await check('…and the PLATFORM default pointer survives, byte-identical', () => {
    const pointerAfter = rowAt(pointerKey12.PK, pointerKey12.SK);
    assert.ok(pointerAfter, 'the platform default pointer was deleted by an org-scoped edit');
    assert.deepStrictEqual(pointerAfter, pointerBefore12, `pointer changed: ${JSON.stringify(pointerAfter)}`);
  });

  say('\n13. a caller with no requestContext at all is refused, not silently admitted');

  /*
    tests/ai-prompt-lifecycle.js, tests/ai-prompt-status-update.js and
    tests/prompt-variable-gates.js all used to call PUT and DELETE with no
    requestContext at all, until the tenancy fix on update-ai-prompt.js gave
    their helpers an `admins` caller so they would pass the authorisation
    `canManagePrompt` already applies inside both handlers. That was the
    right fix for those suites — production's own authorizer never lets a
    groupless caller reach either route to begin with, admin/* being
    admins-only (auth/authorizer.js) — but it removed the only calls anywhere
    that exercised a groupless one, and nothing was left asserting what
    happens to it. This section pins that.
  */
  reset();
  const houseWorkie13 = parse(await post(PLATFORM_ADMIN, {
    name: 'Untouched by a groupless caller', description: 'still here after',
  }));
  const rowBefore13 = rowAt('AIPROMPTS', `AIPROMPT#${houseWorkie13.promptId}`);
  const groupless13 = {};

  const grouplessPut13 = await put(groupless13, houseWorkie13.promptId, { name: 'should not land' });
  await check('PUT with no requestContext at all is refused (403)', () =>
    assert.strictEqual(grouplessPut13.statusCode, 403, grouplessPut13.body));
  await check('…and the row is still there, byte-for-byte what it was before the attempt', () => {
    const row = rowAt('AIPROMPTS', `AIPROMPT#${houseWorkie13.promptId}`);
    assert.ok(row, 'the platform row vanished after a refused PUT');
    assert.deepStrictEqual(row, rowBefore13, `row changed: ${JSON.stringify(row)}`);
  });

  const grouplessDel13 = await del(groupless13, houseWorkie13.promptId, { hardDelete: 'true' });
  await check('DELETE with no requestContext at all is refused (403)', () =>
    assert.strictEqual(grouplessDel13.statusCode, 403, grouplessDel13.body));
  await check('…and the row still exists, unchanged, afterward', () => {
    const row = rowAt('AIPROMPTS', `AIPROMPT#${houseWorkie13.promptId}`);
    assert.ok(row, 'the platform row was deleted by a refused DELETE');
    assert.deepStrictEqual(row, rowBefore13, `row changed: ${JSON.stringify(row)}`);
  });

  say(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
