/**
 * A WORKIE CARRIES ITS OWN ROUND-ANGLE WEIGHTS — create-ai-prompt.js and
 * update-ai-prompt.js, against an in-memory table and bucket (the harness of
 * tests/ai-prompt-lifecycle.js).
 *
 * Spec: docs/superpowers/specs/2026-09-24-workie-round-angles-design.md.
 *
 * The worker reads a Workie from its S3 body, so `angleWeights` must be in the
 * body; the row carries a mirror, as it does for `outputSections`. Clearing
 * the field ("Use the house mix") takes it out of the body.
 *
 * rejects: angleWeights dropped on create or on update; a malformed override
 *          stored; an update that does not mention angleWeights wiping them;
 *          a cleared override left in the body.
 */
const suiteFinished = require('./helpers/finish-guard');
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
      case 'put':
        store.set(key(inp.Item.PK, inp.Item.SK), inp.Item);
        return {};
      case 'get':
        return { Item: store.get(key(inp.Key.PK, inp.Key.SK)) };
      case 'delete':
        store.delete(key(inp.Key.PK, inp.Key.SK));
        return {};
      case 'update': {
        // Minimal UpdateExpression interpreter: `SET a = :x, #b = :y [REMOVE #z]`.
        // Enough for both the isDefault clear and the archive (status) path —
        // matching only one of them is how a broken archive looked green.
        const item = store.get(key(inp.Key.PK, inp.Key.SK));
        if (!item) return {};
        const expr = inp.UpdateExpression || '';
        const names = inp.ExpressionAttributeNames || {};
        const values = inp.ExpressionAttributeValues || {};
        const resolve = (t) => (t.startsWith('#') ? names[t] : t);

        const setPart = (expr.match(/SET\s+(.*?)(?=\s+REMOVE\b|$)/i) || [])[1];
        if (setPart) {
          for (const clause of setPart.split(',')) {
            const [lhs, rhs] = clause.split('=').map((s) => s.trim());
            if (lhs && rhs && rhs in values) item[resolve(lhs)] = values[rhs];
          }
        }
        const removePart = (expr.match(/REMOVE\s+(.*)$/i) || [])[1];
        if (removePart) {
          for (const t of removePart.split(',')) delete item[resolve(t.trim())];
        }
        return {};
      }
      case 'query': {
        const v = inp.ExpressionAttributeValues || {};
        let items = [...store.values()].filter(
          (i) => i.PK === v[':pk'] && String(i.SK).startsWith(String(v[':sk'] ?? ''))
        );
        // Only `category` / `status` are ever pushed into a FilterExpression now.
        if (/category = :category/.test(inp.FilterExpression || '')) {
          items = items.filter((i) => i.category === v[':category']);
        }
        if (/#status = :status/.test(inp.FilterExpression || '')) {
          items = items.filter((i) => i.status === v[':status']);
        }
        return { Items: items, Count: items.length };
      }
      default:
        return { Items: [], Count: 0 };
    }
  },
};

stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => fakeDoc },
  GetCommand, PutCommand, QueryCommand, UpdateCommand, DeleteCommand, ScanCommand,
});

// ---- in-memory S3 ----------------------------------------------------------
const s3Store = new Map();
stub('@aws-sdk/client-s3', {
  S3Client: class {
    async send(cmd) {
      if (cmd.type === 'put') { s3Store.set(cmd.input.Key, cmd.input.Body); return {}; }
      if (cmd.type === 'delete') { s3Store.delete(cmd.input.Key); return {}; }
      if (cmd.type === 'list') return { Contents: [] };
      if (cmd.type === 'get') {
        const body = s3Store.get(cmd.input.Key);
        if (!body) { const e = new Error('NoSuchKey'); e.name = 'NoSuchKey'; throw e; }
        return { Body: { transformToString: async () => body } };
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
stub('@aws-sdk/client-bedrock-runtime', {
  BedrockRuntimeClient: class { async send() { throw new Error('bedrock not stubbed'); } },
  InvokeModelCommand: class { constructor(i) { this.input = i; } },
});

process.env.TABLE_NAME = 'test-table';
process.env.AI_PROMPTS_BUCKET = 'test-bucket';

const admin = (f) => require(path.join(REPO, 'lambda-functions', 'admin', f));
const createPrompt = admin('create-ai-prompt.js');
const updatePrompt = admin('update-ai-prompt.js');

let pass = 0, fail = 0;
async function acheck(label, fn) {
  try { await fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const quiet = async (fn) => {
  const orig = { log: console.log, warn: console.warn, error: console.error };
  console.log = console.warn = console.error = () => {};
  try { return await fn(); } finally { Object.assign(console, orig); }
};
const post = (body) => quiet(() => createPrompt.handler({ body: JSON.stringify(body) }));
// A platform administrator acting for nobody — the caller tests/ai-prompt-lifecycle.js uses; rows created
// with no caller are platform rows (create-ai-prompt.js's internal-invocation seam).
const ADMIN = { requestContext: { authorizer: { lambda: { userId: 'sub-admin', username: 'admin', groups: 'admins', status: 'enabled' } } } };
const patch = (promptId, body) => quiet(() => updatePrompt.handler({ ...ADMIN, pathParameters: { promptId }, body: JSON.stringify(body) }));
const row = (id) => store.get(key('AIPROMPTS', `AIPROMPT#${id}`));
const body = (id) => JSON.parse(s3Store.get(row(id).s3Key));

const WORKIE = {
  name: 'Angle test', description: 'a summary prompt', gameType: 'call-and-answer', promptType: 'analysis',
  category: 'lessons-learned', instructions: 'Read the round back to the room. {responsesText}', outputFormat: 'Keep it short.',
};

(async () => {
  console.log('\n1. create');
  const made = await post({ ...WORKIE, angleWeights: { question: 10, race: 70, event: 10, fact: 10 } });
  const id = JSON.parse(made.body).promptId;
  await acheck('the create succeeds', () => assert.ok(made.statusCode < 300, made.body));
  await acheck('the S3 body carries the weights the worker reads', () =>
    assert.deepStrictEqual(body(id).angleWeights, { question: 10, race: 70, event: 10, fact: 10 }));
  await acheck('the row carries the mirror', () =>
    assert.deepStrictEqual(row(id).angleWeights, { question: 10, race: 70, event: 10, fact: 10 }));

  const plain = JSON.parse((await post({ ...WORKIE, name: 'No angles' })).body).promptId;
  await acheck('a Workie created without weights has none (the house mix)', () => {
    assert.strictEqual(body(plain).angleWeights, undefined);
    assert.strictEqual(row(plain).angleWeights, undefined);
  });

  const before = store.size;
  const bad = await post({ ...WORKIE, name: 'Bad angles', angleWeights: { drama: 50 } });
  await acheck('a malformed override is refused with the reason, and nothing is written', () => {
    assert.ok(bad.statusCode >= 400, `status ${bad.statusCode}`);
    assert.ok(/angleWeights/.test(bad.body), bad.body);
    assert.strictEqual(store.size, before, 'a row was written');
  });

  console.log('\n2. update');
  await patch(id, { angleWeights: { race: 0 } });
  await acheck('an update replaces the weights in the body and on the row', () => {
    assert.deepStrictEqual(body(id).angleWeights, { race: 0 });
    assert.deepStrictEqual(row(id).angleWeights, { race: 0 });
  });
  await patch(id, { description: 'renamed' });
  await acheck('an update that does not mention them leaves them alone', () =>
    assert.deepStrictEqual(body(id).angleWeights, { race: 0 }));
  await patch(id, { angleWeights: null });
  await acheck('clearing them takes them out of the body (the house mix again)', () => {
    assert.strictEqual(body(id).angleWeights, undefined);
    assert.deepStrictEqual(row(id).angleWeights || {}, {});
  });
  const refused = await patch(id, { angleWeights: { race: 1.5 } });
  await acheck('a malformed update is refused with the reason', () => {
    assert.ok(refused.statusCode >= 400, `status ${refused.statusCode}`);
    assert.ok(/angleWeights/.test(refused.body), refused.body);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log(`CRASH ${e.stack}`); process.exit(1); });
