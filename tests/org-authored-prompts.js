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
        const items = [...store.values()].filter((i) =>
          i.PK === v[':pk'] && String(i.SK).startsWith(String(v[':sk'] ?? '')));
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

process.env.TABLE_NAME = 'test-table';
process.env.AI_PROMPTS_BUCKET = 'test-bucket';

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

  say(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
