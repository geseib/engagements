/**
 * PROMPTS ARE CHANGED IN ENGAGE MODE ONLY — every write route, with the team
 * authoring switch at its default (off).
 *
 * Spec: docs/superpowers/specs/2026-09-24-prompt-admin-engage-mode-design.md.
 *
 * The owner, 2026-09-24: "the workie advisor and ai prompts should be only in
 * the engage mode for now. team admins could view them. perhaps later we let
 * them copy and create them." Decisions: team owners/admins view read-only;
 * existing team Workies keep working, frozen. The owner's own save had been
 * refused in user mode — dev's log: `refused to let groups [admins] (org:
 * org_…/owner) update Workie "mskc5h7boibe5abg15" in platform` — and Engage
 * mode had no Prompts screen, so no screen could edit Engage's Workies at all.
 *
 * `TEAM_WORKIE_AUTHORING` (prompt-access.js) is the owner's "later": off, only
 * an Engage admin acting for no organisation may create, change, retire, run
 * the advisor or the generator on, or populate prompts. The suites that pin how
 * team authoring works (org-authored-prompts.js and friends) turn it on, so
 * that path stays proven for when it comes back.
 *
 * rejects: a team caller creating, updating, retiring or advising a Workie; an
 * Engage admin acting for a team doing any of those; populate-defaults from
 * any mode but Engage; a team Workie changed by anyone, its own team included;
 * a refusal that does not say which rule and what to do; the list no longer
 * showing a team its own Workies (they still drive its sessions); an Engage
 * admin in Engage mode refused; an internal caller refused.
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

// The advisor self-invokes its worker and the generator calls Bedrock: stubbed
// so an ALLOWED call gets past authorisation to a status that is not 403.
stub('@aws-sdk/client-lambda', {
  LambdaClient: class { async send() { return { StatusCode: 202 }; } },
  InvokeCommand: class { constructor(i) { this.input = i; } },
});
stub('@aws-sdk/client-bedrock-runtime', {
  BedrockRuntimeClient: class { async send() { throw new Error('stub: no Bedrock in tests'); } },
  InvokeModelCommand: class { constructor(i) { this.input = i; } },
  ConverseCommand: class { constructor(i) { this.input = i; } },
});

const admin = (f) => require(path.join(REPO, 'lambda-functions', 'admin', f));
const access = admin('shared/prompt-access.js');
const createPrompt = admin('create-ai-prompt.js');
const updatePrompt = admin('update-ai-prompt.js');
const deletePrompt = admin('delete-ai-prompt.js');
const getPrompts = admin('get-ai-prompts.js');
const advisor = admin('ai-prompt-advisor.js');
const generate = admin('ai-generate-prompt.js');
const populate = admin('populate-defaults.js');
const C = admin('shared/tenant-crypto.js');

if (!process.env.DEBUG) { console.log = () => {}; console.warn = () => {}; console.error = () => {}; }
const say = (...a) => process.stdout.write(a.join(' ') + '\n');
let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); say(`  PASS  ${label}`); pass++; }
  catch (e) { say(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const ORG = 'org_acme';
const caller = (lambda) => ({ requestContext: { authorizer: { lambda } } });
const STAFF_ENGAGE = caller({ userId: 'sub-g', username: 'g', groups: 'admins', status: 'enabled' });
const STAFF_IN_TEAM = caller({ userId: 'sub-g', username: 'g', groups: 'admins', status: 'enabled', orgId: ORG, orgRole: 'owner', orgIds: ORG });
const TEAM_OWNER = caller({ userId: 'sub-amara', username: 'amara', groups: 'hosts', status: 'enabled', orgId: ORG, orgRole: 'owner', orgIds: ORG });
const INTERNAL = {};

const BODY = {
  name: 'Retro Workie', description: 'what the room learned', gameType: 'call-and-answer', promptType: 'analysis',
  category: 'lessons-learned', instructions: 'Read the round back. {responsesText}', outputFormat: 'Keep it short.',
};
const json = (r) => { try { return JSON.parse(r.body); } catch { return {}; } };
const post = (who, body) => createPrompt.handler({ ...who, body: JSON.stringify(body) });
const put = (who, id, body) => updatePrompt.handler({ ...who, pathParameters: { promptId: id }, body: JSON.stringify(body) });
const del = (who, id) => deletePrompt.handler({ ...who, pathParameters: { promptId: id }, queryStringParameters: {} });

/** A platform Workie and a sealed team Workie, written as the create handler writes them. */
async function seed() {
  const blob = await C.createOrgDataKey(ORG);
  store.set(key(`ORG#${ORG}`, 'METADATA'), { PK: `ORG#${ORG}`, SK: 'METADATA', orgId: ORG, dataKeyCiphertext: blob });
  C.forgetOrg(ORG);
  store.set(key('AIPROMPTS', 'AIPROMPT#house'), {
    PK: 'AIPROMPTS', SK: 'AIPROMPT#house', promptId: 'house', name: 'House Workie', gameType: 'call-and-answer',
    promptType: 'analysis', status: 'active', scope: 'platform', s3Key: 'prompts/call-and-answer/house/v1.json', version: 1,
  });
  s3Store.set('prompts/call-and-answer/house/v1.json', JSON.stringify({ ...BODY, name: 'House Workie' }));
  const teamRow = {
    PK: `ORG#${ORG}#AIPROMPTS`, SK: 'AIPROMPT#team', promptId: 'team', name: 'Team Workie', gameType: 'call-and-answer',
    promptType: 'analysis', status: 'active', scope: 'org', orgId: ORG, createdBy: 'sub-amara',
    s3Key: `prompts/org/${ORG}/call-and-answer/team/v1.json`, version: 1,
  };
  store.set(key(teamRow.PK, teamRow.SK), await C.encryptItem(ORG, 'prompt', teamRow));
  s3Store.set(teamRow.s3Key, JSON.stringify(await C.encryptValue(ORG, { ...BODY, name: 'Team Workie' })));
}

(async () => {
  delete process.env.TEAM_WORKIE_AUTHORING;
  await seed();

  say('\n1. the rule, in prompt-access.js');
  await check('the switch is off by default', () => assert.strictEqual(access.teamWorkieAuthoringOn(), false));
  await check('an Engage admin acting for no organisation may author; an internal caller may too', () => {
    assert.strictEqual(access.canAuthorPrompts(STAFF_ENGAGE), true);
    assert.ok(access.createPromptRef(STAFF_ENGAGE, 'x'), 'no ref for Engage mode');
    assert.ok(access.createPromptRef(INTERNAL, 'x'), 'no ref for an internal caller');
  });
  await check('nobody acting for a team may author — Engage admin or team owner', () => {
    for (const who of [STAFF_IN_TEAM, TEAM_OWNER]) {
      assert.strictEqual(access.canAuthorPrompts(who), false);
      assert.strictEqual(access.createPromptRef(who, 'x'), null);
    }
  });
  const house = store.get(key('AIPROMPTS', 'AIPROMPT#house'));
  const team = store.get(key(`ORG#${ORG}#AIPROMPTS`, 'AIPROMPT#team'));
  await check("Engage's Workie: only Engage mode may change it", () => {
    assert.strictEqual(access.canManagePrompt(STAFF_ENGAGE, house), true);
    assert.strictEqual(access.canManagePrompt(STAFF_IN_TEAM, house), false);
    assert.strictEqual(access.canManagePrompt(TEAM_OWNER, house), false);
  });
  await check('a team Workie is frozen for everyone, its own team and its creator included', () => {
    for (const who of [STAFF_ENGAGE, STAFF_IN_TEAM, TEAM_OWNER]) assert.strictEqual(access.canManagePrompt(who, team), false);
  });
  await check('each refusal says which rule, in words that say what to do', () => {
    assert.match(access.promptRefusalMessage(STAFF_IN_TEAM, house), /Engage mode/);
    assert.match(access.promptRefusalMessage(TEAM_OWNER, house), /Only Engage staff/);
    assert.match(access.promptRefusalMessage(TEAM_OWNER, team), /read-only for now/);
    assert.match(access.promptRefusalMessage(STAFF_IN_TEAM, null), /Engage mode/);
  });

  say('\n2. the write routes');
  const before = store.size;
  const madeInTeam = await post(STAFF_IN_TEAM, BODY);
  await check('create, as an Engage admin acting for a team: 403, "switch to Engage mode"', () => {
    assert.strictEqual(madeInTeam.statusCode, 403, madeInTeam.body);
    assert.match(json(madeInTeam).error, /Engage mode/);
  });
  const madeByOwner = await post(TEAM_OWNER, BODY);
  await check('create, as a team owner: 403', () => assert.strictEqual(madeByOwner.statusCode, 403, madeByOwner.body));
  await check('…and neither wrote a row', () => assert.strictEqual(store.size, before));
  const madeEngage = await post(STAFF_ENGAGE, BODY);
  await check('create, in Engage mode: 201, into Engage\'s library', () => {
    assert.strictEqual(madeEngage.statusCode, 201, madeEngage.body);
    assert.ok(store.has(key('AIPROMPTS', `AIPROMPT#${json(madeEngage).promptId}`)));
  });

  const upInTeam = await put(STAFF_IN_TEAM, 'house', { description: 'changed' });
  await check("update Engage's Workie while acting for a team: 403, \"Engage mode\" (the owner's refused save)", () => {
    assert.strictEqual(upInTeam.statusCode, 403, upInTeam.body);
    assert.match(json(upInTeam).error, /Engage mode/);
  });
  const upEngage = await put(STAFF_ENGAGE, 'house', { description: 'changed' });
  await check("update Engage's Workie in Engage mode: 200", () => assert.strictEqual(upEngage.statusCode, 200, upEngage.body));
  const upTeam = await put(TEAM_OWNER, 'team', { description: 'changed' });
  await check('update a team Workie as its own team owner: 403, read-only for now', () => {
    assert.strictEqual(upTeam.statusCode, 403, upTeam.body);
    assert.match(json(upTeam).error, /read-only for now/);
  });
  const delTeam = await del(TEAM_OWNER, 'team');
  await check('retire a team Workie as its own team owner: 403, and it is still there', () => {
    assert.strictEqual(delTeam.statusCode, 403, delTeam.body);
    assert.ok(store.has(key(`ORG#${ORG}#AIPROMPTS`, 'AIPROMPT#team')));
  });
  const delInTeam = await del(STAFF_IN_TEAM, 'house');
  await check("retire Engage's Workie while acting for a team: 403", () => assert.strictEqual(delInTeam.statusCode, 403, delInTeam.body));

  say('\n3. the advisor, the generator and populate-defaults');
  const adviseBody = JSON.stringify({ promptText: 'Read the round back. {responsesText}', gameType: 'call-and-answer', analysisType: 'improve' });
  const advInTeam = await advisor.handler({ ...STAFF_IN_TEAM, requestContext: { ...STAFF_IN_TEAM.requestContext, http: { method: 'POST' } }, body: adviseBody });
  await check('the advisor, acting for a team: 403, "Engage mode"', () => {
    assert.strictEqual(advInTeam.statusCode, 403, advInTeam.body);
    assert.match(json(advInTeam).error, /Engage mode/);
  });
  const advEngage = await advisor.handler({ ...STAFF_ENGAGE, requestContext: { ...STAFF_ENGAGE.requestContext, http: { method: 'POST' } }, body: adviseBody });
  await check('the advisor, in Engage mode: not refused', () => assert.notStrictEqual(advEngage.statusCode, 403, advEngage.body));
  const genBody = JSON.stringify({ gameType: 'call-and-answer', description: 'a retro read-back' });
  const genInTeam = await generate.handler({ ...STAFF_IN_TEAM, body: genBody });
  await check('the generator, acting for a team: 403, "Engage mode"', () => {
    assert.strictEqual(genInTeam.statusCode, 403, genInTeam.body);
    assert.match(json(genInTeam).error, /Engage mode/);
  });
  const genEngage = await generate.handler({ ...STAFF_ENGAGE, body: genBody });
  await check('the generator, in Engage mode: not refused', () => assert.notStrictEqual(genEngage.statusCode, 403, genEngage.body));
  const popInTeam = await populate.handler({ ...STAFF_IN_TEAM, body: '{}' });
  await check("populate-defaults, acting for a team: 403 — it writes Engage's library", () => {
    assert.strictEqual(popInTeam.statusCode, 403, popInTeam.body);
    assert.match(json(popInTeam).error, /Engage mode/);
  });
  const popOwner = await populate.handler({ ...TEAM_OWNER, body: '{}' });
  await check('populate-defaults, as a team owner: 403', () => assert.strictEqual(popOwner.statusCode, 403, popOwner.body));

  say('\n4. reading is unchanged');
  const listed = json(await getPrompts.handler({ ...TEAM_OWNER, queryStringParameters: {} }));
  await check('a team still sees its own Workie (it still drives their sessions) and Engage\'s', () => {
    const ids = (listed.prompts || []).map((p) => p.promptId);
    assert.ok(ids.includes('team'), JSON.stringify(ids));
    assert.ok(ids.includes('house'), JSON.stringify(ids));
  });

  say(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})().catch((e) => { process.stdout.write(`CRASH ${e.stack}\n`); process.exit(1); });
