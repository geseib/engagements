/**
 * A WORKIE MAY NAME THE MODEL THAT WRITES ITS READS (owner, 2026-11-08).
 *
 * The What Is This Thing? reveal mixed up votes and points and broke its own
 * naming rule on Haiku 4.5; the owner approved moving that one Workie to the
 * larger model, on condition that it stays on Bedrock in this account.
 *
 *   1. The rule: prompt-shape.js normalizeSummaryModel, identical in the admin
 *      and game copies, accepts exactly the Bedrock rows of summary-models.js
 *      (or nothing), and promptSummaryModel resolves only those.
 *   2. The handlers: create stores it on the row; update sets it, leaves it
 *      alone when not mentioned, clears it, refuses a bad id; a model-only
 *      update mints no new version.
 *   3. The read goes through the Engage-wide Claude models switch like every
 *      other call (owner, 2026-11-08: "use the workie model external"). With
 *      the switch on, a Workie naming bedrock-sonnet-4-6 is written by Sonnet
 *      5.5 on the Anthropic API; if that call fails, by Bedrock Sonnet 4.6.
 *      With the switch off, by Bedrock Sonnet 4.6 (heading asked for in words,
 *      no prefill), from the S3 body and the row fallback alike. A Workie
 *      naming nothing, or a stored id that is not a Bedrock model, is written
 *      by Haiku as before.
 *
 * rejects: the field dropped by create or update; an Anthropic API model
 *          accepted; the read still going to Haiku; the Workie's model
 *          bypassing the switch; no Bedrock fallback; a bad id failing the read.
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
const stub = (name, exports) => stubs.set(name, exports);

// ---- in-memory table -------------------------------------------------------
const store = new Map();
const key = (pk, sk) => `${pk}|${sk}`;
const put = (item) => store.set(key(item.PK, item.SK), item);

class GetCommand { constructor(i) { this.input = i; this.type = 'get'; } }
class PutCommand { constructor(i) { this.input = i; this.type = 'put'; } }
class QueryCommand { constructor(i) { this.input = i; this.type = 'query'; } }
class UpdateCommand { constructor(i) { this.input = i; this.type = 'update'; } }
class DeleteCommand { constructor(i) { this.input = i; this.type = 'delete'; } }
class ScanCommand { constructor(i) { this.input = i; this.type = 'scan'; } }

function project(item, input) {
  if (!item || !input.ProjectionExpression) return item;
  const names = input.ExpressionAttributeNames || {};
  const out = {};
  for (const raw of input.ProjectionExpression.split(',')) {
    const attr = names[raw.trim()] || raw.trim();
    if (attr in item) out[attr] = item[attr];
  }
  return out;
}

const fakeDoc = {
  send: async (cmd) => {
    const inp = cmd.input || {};
    switch (cmd.type) {
      case 'put': put(inp.Item); return {};
      case 'get': return { Item: project(store.get(key(inp.Key.PK, inp.Key.SK)), inp) };
      case 'delete': store.delete(key(inp.Key.PK, inp.Key.SK)); return {};
      case 'update': {
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
        if (removePart) for (const t of removePart.split(',')) delete item[resolve(t.trim())];
        return {};
      }
      case 'query': {
        const v = inp.ExpressionAttributeValues || {};
        const items = [...store.values()].filter((i) =>
          i.PK === v[':pk'] && String(i.SK).startsWith(String(v[':sk'] ?? '')));
        return { Items: items, Count: items.length };
      }
      case 'scan': {
        const v = inp.ExpressionAttributeValues || {};
        const items = [...store.values()].filter((i) =>
          (v[':pk'] === undefined || i.PK === v[':pk'])
          && (v[':isDefault'] === undefined || i.isDefault === v[':isDefault']));
        return { Items: items, Count: items.length };
      }
      default: return {};
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
stub('@aws-sdk/client-lambda', {
  LambdaClient: class { async send() { return {}; } },
  InvokeCommand: class { constructor(i) { this.input = i; } },
});
stub('@aws-sdk/client-apigatewaymanagementapi', {
  ApiGatewayManagementApiClient: class { async send() { return {}; } }, PostToConnectionCommand: class {},
});

// ---- Bedrock: record each request ------------------------------------------
let bedrockCalls = [];
const HEADING = '## What the room said';
const BODY = '\n\n- **What came back**: four answers name a pilot.\n\n## What the room voted\n'
  + '- **Top of the vote**: the pilot answer.\n\n## Discussion topics\n1. Which team pilots first?\n\n'
  + '## Suggested next steps\n1. Whoever runs the pilot: draft the one-page plan.';
stub('@aws-sdk/client-bedrock-runtime', {
  BedrockRuntimeClient: class {
    async send(cmd) {
      const body = JSON.parse(cmd.input.body);
      bedrockCalls.push({ modelId: cmd.input.modelId, body });
      const prefilled = body.messages.length > 1;
      return {
        body: new TextEncoder().encode(JSON.stringify({
          content: [{ text: prefilled ? BODY : HEADING + BODY }], stop_reason: 'end_turn',
          usage: { input_tokens: 100, output_tokens: 50 },
        })),
      };
    }
  },
  InvokeModelCommand: class { constructor(i) { this.input = i; } },
});

const { makeKmsStub, installTestKeyLoader } = require('./helpers/tenant-crypto-stub');
stub('@aws-sdk/client-kms', makeKmsStub().exports);
installTestKeyLoader();

process.env.TABLE_NAME = 'test-table';
process.env.TENANT_KMS_KEY_ID = 'alias/engage-tenant';
process.env.WEBSOCKET_API_ENDPOINT = 'https://ws.test.invalid/dev';
process.env.AI_PROMPTS_BUCKET = 'test-prompts-bucket';
process.env.AWS_REGION = 'us-east-1';
process.env.ACCOUNT_ID = '111122223333';
process.env.AWS_LAMBDA_FUNCTION_NAME = 'engagedev-get-ai-summary';
// The four federation ids, so the Engage-wide switch COULD route a read to the
// Anthropic API. The transport below fails the test if anything tries.
Object.assign(process.env, {
  ANTHROPIC_FEDERATION_RULE_ID: 'fdrl_01TEST',
  ANTHROPIC_ORGANIZATION_ID: '3f6c0a1e-0000-4000-8000-000000000001',
  ANTHROPIC_SERVICE_ACCOUNT_ID: 'svac_01TEST',
  ANTHROPIC_WORKSPACE_ID: 'wrkspc_01TEST',
});
delete process.env.AI_MODEL_PICKER;

const game = (f) => require(path.join(REPO, 'lambda-functions/game', f));
const admin = (f) => require(path.join(REPO, 'lambda-functions/admin', f));
const { setMetadataKey, setPartition } = game('set-version.js');
const { PLATFORM } = game('tenant.js');
const models = game('summary-models.js');
const gameShape = game('prompt-shape.js');
const adminShape = admin('shared/prompt-shape.js');
const anthropic = game('anthropic-messages.js');
const claudeRoute = game('claude-route.js');
const { handler } = game('get-ai-summary.js');
const createPrompt = admin('create-ai-prompt.js');
const updatePrompt = admin('update-ai-prompt.js');

// The fake transport: STS, the token exchange and Messages, the only way out
// of anthropic-messages.js. `apiDown` makes Messages fail (a 529 overload).
let apiCalls = [];
let apiDown = false;
anthropic._setTransport(async (req) => {
  if (req.host === 'sts.us-east-1.amazonaws.com') {
    return { status: 200, body: '<GetWebIdentityTokenResponse><GetWebIdentityTokenResult>'
      + '<WebIdentityToken>eyJ.test.jwt</WebIdentityToken><Expiration>2026-11-08T12:00:00Z</Expiration>'
      + '</GetWebIdentityTokenResult></GetWebIdentityTokenResponse>' };
  }
  if (req.host === 'api.anthropic.com' && req.path === '/v1/oauth/token') {
    return { status: 200, body: JSON.stringify({ access_token: 'sk-ant-oat01-test', token_type: 'Bearer', expires_in: 600 }) };
  }
  if (req.host === 'api.anthropic.com' && req.path === '/v1/messages') {
    const body = JSON.parse(req.body);
    apiCalls.push(body);
    if (apiDown) return { status: 529, body: JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'busy' } }) };
    return { status: 200, body: JSON.stringify({
      id: 'msg_1', type: 'message', role: 'assistant', model: body.model,
      content: [{ type: 'text', text: HEADING + BODY }], stop_reason: 'end_turn',
      usage: { input_tokens: 100, output_tokens: 50 },
    }) };
  }
  throw new Error('unexpected host ' + req.host + req.path);
});
const switchOn = (on) => claudeRoute._setSettingReader(async () => ({ PK: 'PLATFORM#SETTINGS', SK: 'CLAUDE_MODELS', Anthropic55: on }));

const say = (...a) => process.stdout.write(a.join(' ') + '\n');
if (!process.env.DEBUG) { console.log = () => {}; console.warn = () => {}; console.error = () => {}; }

let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); say(`  PASS  ${label}`); pass++; }
  catch (e) { say(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

// ---- fixtures ---------------------------------------------------------------
const ADMIN = { requestContext: { authorizer: { lambda: { userId: 'sub-admin', username: 'admin', groups: 'admins', status: 'enabled' } } } };
const post = (body) => createPrompt.handler({ body: JSON.stringify(body) });
const patch = (promptId, body) => updatePrompt.handler({ ...ADMIN, pathParameters: { promptId }, body: JSON.stringify(body) });
const promptRow = (id) => store.get(key('AIPROMPTS', `AIPROMPT#${id}`));
const WORKIE = {
  name: 'Model test', description: 'a summary prompt', gameType: 'call-and-answer', promptType: 'analysis',
  category: 'lessons-learned', instructions: 'Read the round back to the room. {responsesText}', outputFormat: 'Keep it short.',
};

function seedRound(gameId, promptId) {
  const setId = `set-${gameId}`;
  const setRef = { scope: PLATFORM, orgId: '', setId };
  put({ PK: `GAME#${gameId}`, SK: 'METADATA', GameType: 'call-and-answer', Title: 'Model pilot',
    QuestionSetId: setId, QuestionSetScope: PLATFORM });
  put({ PK: `GAME#${gameId}`, SK: 'STATE', State: 'RESULTS#001', CurrentQuestionId: '001' });
  put({ PK: `GAME#${gameId}`, SK: 'ROUND#001', QuestionNumber: '001', AuthorsRevealed: true });
  put({ ...setMetadataKey(setRef), activeVersion: 1, engagementType: 'call-and-answer', name: 'Model set', promptId });
  put({ PK: setPartition(setRef, 1), SK: 'QUESTION#c001#001', Title: 'A drawing', Detail: '', Category: 'Things' });
  put({ PK: `GAME#${gameId}`, SK: 'QUESTION#001#REF', SourceQuestionId: 'QUESTION#c001#001',
    SetId: setId, SetVersion: 1, SetScope: PLATFORM });
  ['Ana', 'Ben', 'Cy'].forEach((name, i) => {
    put({ PK: `GAME#${gameId}`, SK: `QUESTION#001#ANSWER#${name}`, PlayerName: name, Answer: `Guess number ${i + 1}` });
  });
  put({ PK: `GAME#${gameId}`, SK: 'QUESTION#001#VOTE#Ana', VoterName: 'Ana', QuestionNumber: '001', Votes: { 1: 1 } });
}

async function readWith(gameId, promptId) {
  bedrockCalls = [];
  apiCalls = [];
  seedRound(gameId, promptId);
  let res;
  try { res = await handler({ __workerMode: true, gameId, questionId: '001' }); } catch (e) { res = { error: e.message }; }
  return res;
}
const SONNET_ARN = 'arn:aws:bedrock:us-east-1:111122223333:inference-profile/us.anthropic.claude-sonnet-4-6';
const HAIKU_ARN = 'arn:aws:bedrock:us-east-1:111122223333:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0';

(async () => {
  say('\n1. the rule');
  await check('the admin and game copies agree on the allowed ids', () =>
    assert.deepStrictEqual([...adminShape.SUMMARY_MODEL_IDS], [...gameShape.SUMMARY_MODEL_IDS]));
  await check('the allowed ids are exactly the Bedrock rows of the summary catalogue', () =>
    assert.deepStrictEqual([...gameShape.SUMMARY_MODEL_IDS].sort(),
      models.MODELS.filter((m) => m.provider === 'bedrock').map((m) => m.id).sort()));
  await check('absent, null and empty mean the house default', () => {
    for (const v of [undefined, null, '']) assert.deepStrictEqual(adminShape.normalizeSummaryModel(v), { ok: true, model: null });
  });
  await check('an Anthropic API model, an unknown id and a non-string are refused', () => {
    for (const v of ['claude-sonnet-5-5', 'claude-opus-5-5', 'gpt-5', 42, {}]) {
      assert.strictEqual(adminShape.normalizeSummaryModel(v).ok, false, String(v));
    }
  });
  await check('promptSummaryModel resolves a Bedrock id, and nothing else', () => {
    assert.strictEqual(models.promptSummaryModel({ summaryModel: 'bedrock-sonnet-4-6' }).modelId, 'us.anthropic.claude-sonnet-4-6');
    assert.strictEqual(models.promptSummaryModel({ summaryModel: 'bedrock-haiku-4-5' }), null, 'the default reads as null');
    assert.strictEqual(models.promptSummaryModel({ summaryModel: 'claude-sonnet-5-5' }), null);
    assert.strictEqual(models.promptSummaryModel({}), null);
    assert.strictEqual(models.promptSummaryModel(null), null);
  });

  say('\n2. the handlers');
  const made = await post({ ...WORKIE, summaryModel: 'bedrock-sonnet-4-6' });
  const id = JSON.parse(made.body).promptId;
  await check('create stores it on the row', () => {
    assert.ok(made.statusCode < 300, made.body);
    assert.strictEqual(promptRow(id).summaryModel, 'bedrock-sonnet-4-6');
  });
  const plainId = JSON.parse((await post({ ...WORKIE, name: 'No model' })).body).promptId;
  await check('a Workie created without one has none', () => assert.strictEqual(promptRow(plainId).summaryModel, undefined));
  const sizeBefore = store.size;
  const bad = await post({ ...WORKIE, name: 'Bad model', summaryModel: 'claude-sonnet-5-5' });
  await check('create refuses an Anthropic API model with the reason, writing nothing', () => {
    assert.ok(bad.statusCode >= 400, `status ${bad.statusCode}`);
    assert.match(bad.body, /summaryModel/);
    assert.strictEqual(store.size, sizeBefore);
  });

  const v0 = promptRow(plainId).version;
  const set = await patch(plainId, { summaryModel: 'bedrock-sonnet-4-6' });
  await check('update sets it, and a model-only update mints no new version', () => {
    assert.strictEqual(set.statusCode, 200, set.body);
    assert.strictEqual(promptRow(plainId).summaryModel, 'bedrock-sonnet-4-6');
    assert.strictEqual(promptRow(plainId).version, v0);
  });
  await patch(plainId, { description: 'renamed' });
  await check('an update that does not mention it leaves it alone', () =>
    assert.strictEqual(promptRow(plainId).summaryModel, 'bedrock-sonnet-4-6'));
  const refused = await patch(plainId, { summaryModel: 'claude-opus-5-5' });
  await check('update refuses a bad id with the reason, and keeps the old value', () => {
    assert.ok(refused.statusCode >= 400, `status ${refused.statusCode}`);
    assert.match(refused.body, /summaryModel/);
    assert.strictEqual(promptRow(plainId).summaryModel, 'bedrock-sonnet-4-6');
  });
  await patch(plainId, { summaryModel: null });
  await check('clearing it returns the Workie to the house default', () =>
    assert.strictEqual(models.promptSummaryModel(promptRow(plainId)), null));

  say('\n3. the read, through the Engage-wide switch');
  switchOn(true);
  const external = await readWith('g-on', id);
  await check('switch on: a Workie naming Sonnet 4.6 is written by Sonnet 5.5 on the Anthropic API', () => {
    assert.ok(!external.error, external.error);
    assert.strictEqual(apiCalls.length >= 1, true, 'the Anthropic API was not called');
    assert.strictEqual(apiCalls[0].model, 'claude-sonnet-5-5');
    assert.strictEqual(bedrockCalls.length, 0, 'Bedrock was called as well');
  });

  apiDown = true;
  const fellBack = await readWith('g-down', id);
  await check('switch on, API failing: it falls back to Bedrock Sonnet 4.6, not Haiku', () => {
    assert.ok(!fellBack.error, fellBack.error);
    assert.ok(apiCalls.length >= 1, 'the API was not tried');
    assert.strictEqual(bedrockCalls[0] && bedrockCalls[0].modelId, SONNET_ARN);
  });
  apiDown = false;

  switchOn(false);
  const viaS3 = await readWith('g-s3', id);
  await check('switch off: written by Bedrock Sonnet 4.6, heading asked for in words', () => {
    assert.ok(!viaS3.error, viaS3.error);
    assert.strictEqual(apiCalls.length, 0);
    assert.strictEqual(bedrockCalls[0] && bedrockCalls[0].modelId, SONNET_ARN);
    assert.strictEqual(bedrockCalls[0].body.messages.length, 1, 'Sonnet 4.6 refuses a prefill');
    assert.match(bedrockCalls[0].body.messages[0].content, /Begin your reply with this exact line/);
  });

  put({ PK: 'AIPROMPTS', SK: 'AIPROMPT#row-only', promptId: 'row-only', name: 'Row only', s3Key: 'missing.json',
    gameType: 'call-and-answer', promptType: 'analysis', status: 'active', summaryModel: 'bedrock-sonnet-4-6',
    instructions: WORKIE.instructions, outputFormat: WORKIE.outputFormat });
  const viaRow = await readWith('g-row', 'row-only');
  await check('the row fallback (no S3 body) honours it too', () => {
    assert.ok(!viaRow.error, viaRow.error);
    assert.strictEqual(bedrockCalls[0] && bedrockCalls[0].modelId, SONNET_ARN);
  });

  await patch(plainId, { summaryModel: '' });
  await readWith('g-plain', plainId);
  await check('a Workie naming nothing is written as before: Haiku 4.5, heading prefilled', () => {
    assert.strictEqual(bedrockCalls[0] && bedrockCalls[0].modelId, HAIKU_ARN);
    assert.strictEqual(bedrockCalls[0].body.messages.length, 2);
  });
  put({ ...promptRow('row-only'), SK: 'AIPROMPT#bad-model', promptId: 'bad-model', summaryModel: 'claude-sonnet-5-5' });
  const badRead = await readWith('g-bad', 'bad-model');
  await check('a stored id that is not a Bedrock model degrades to Haiku, never fails the read', () => {
    assert.ok(!badRead.error, badRead.error);
    assert.strictEqual(bedrockCalls[0] && bedrockCalls[0].modelId, HAIKU_ARN);
  });
  switchOn(true);
  await readWith('g-bad-on', 'bad-model');
  await check('...and with the switch on it is the default read, Haiku 5.5, as before', () => {
    assert.strictEqual(apiCalls[0] && apiCalls[0].model, 'claude-haiku-5-5');
  });
  switchOn(false);

  say(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})().catch((e) => { say(`CRASH ${e.stack}`); process.exit(1); });
