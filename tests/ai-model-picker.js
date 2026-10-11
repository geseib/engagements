/**
 * DEV'S AI MODEL PICKER (owner, 2026-10-11): staff regenerate one round's read
 * with a different model and compare. docs/handoff/ai-model-picker-2026-10-11.md.
 *
 *   1. The switch: template parameter AiModelPicker defaults to 'false', only
 *      buildspec-dev.yml passes 'true', the function reads it as
 *      AI_MODEL_PICKER, its only new grant is sts:GetWebIdentityToken
 *      (Allow on dev, Deny elsewhere), the four federation ids are dev-only
 *      parameters, nothing reads SSM, and no resource is added.
 *   2. Switch off: the Bedrock request is byte-for-byte today's (Haiku 4.5,
 *      the heading prefilled, temperature 0.7, 2048), STS is never asked, the
 *      Anthropic API is never called, no variant row and no new attribute is
 *      written, and a staff member's `model` / `variants` are ignored.
 *   3. Who: a host who is not staff, and the public route, never reach a
 *      chosen model or the variants; an unknown model is a 400 for staff.
 *   4. The Anthropic path, signed in with Workload Identity Federation: a
 *      SigV4-signed STS GetWebIdentityToken (pinned against a known answer),
 *      the jwt-bearer exchange, Bearer on Messages, the access token cached
 *      until it expires and minted again then and once after a 401; a correct
 *      Messages request (no prefill, no temperature, the heading asked for in
 *      words); no JWT, access token or AWS secret in any log line.
 *   5. Fallback to Haiku 4.5, reason recorded: not connected (an id
 *      missing), STS or exchange failure, rate limit, timeout, out of credit,
 *      refusal, a second 401, Bedrock access denied.
 *   6. Variants: a chosen model writes only its own row
 *      (QUESTION#nnn#AIVARIANT#<model>), sealed like the read, 30-day ttl;
 *      the room's read is untouched and the public reader still returns it;
 *      a normal generation files a copy under the default; the staff
 *      variants read returns every model's latest with its footer figures.
 *
 * No network: Bedrock, STS, the token exchange and Messages are fakes, and
 * the fake transport is the only way out of anthropic-messages.js.
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const util = require('util');
const fs = require('fs');
const assert = require('assert');
const { execFileSync } = require('child_process');

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
const puts = [];

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
      case 'put': puts.push(inp.Item.SK); put(inp.Item); return {};
      case 'get': return { Item: project(store.get(key(inp.Key.PK, inp.Key.SK)), inp) };
      case 'delete': store.delete(key(inp.Key.PK, inp.Key.SK)); return {};
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

class GetObjectCommand { constructor(i) { this.input = i; } }
stub('@aws-sdk/client-s3', { S3Client: class { async send() { return {}; } }, GetObjectCommand });

const invokes = [];
class InvokeCommand { constructor(i) { this.input = i; } }
stub('@aws-sdk/client-lambda', {
  LambdaClient: class { async send(cmd) { invokes.push(JSON.parse(Buffer.from(cmd.input.Payload).toString('utf8'))); return {}; } },
  InvokeCommand,
});
const noopClient = class { async send() { return {}; } };
stub('@aws-sdk/client-apigatewaymanagementapi', {
  ApiGatewayManagementApiClient: noopClient, PostToConnectionCommand: class {},
});

// ---- Bedrock: record each request, answer from a queue -----------------------
let bedrockCalls = [];
let bedrockReply = '';
let bedrockFail = null; // (input) => Error | null
class InvokeModelCommand { constructor(i) { this.input = i; } }
stub('@aws-sdk/client-bedrock-runtime', {
  BedrockRuntimeClient: class {
    async send(cmd) {
      bedrockCalls.push({ modelId: cmd.input.modelId, raw: cmd.input.body, body: JSON.parse(cmd.input.body) });
      const err = bedrockFail && bedrockFail(cmd.input);
      if (err) throw err;
      return {
        body: new TextEncoder().encode(JSON.stringify({
          content: [{ text: bedrockReply }], stop_reason: 'end_turn',
          usage: { input_tokens: 4100, output_tokens: 700 },
        })),
      };
    }
  },
  InvokeModelCommand,
});

// ---- secrets that must never surface -----------------------------------------
const JWT = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhcm46YXdzOmlhbTo6cm9sZSJ9.JWT-SIGNATURE-never-print';
const ACCESS = 'sk-ant-oat01-ACCESS-TOKEN-never-print-me';
const ACCESS2 = 'sk-ant-oat01-SECOND-ACCESS-TOKEN-never-print';
const AWS_SECRET = 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY';
const SECRETS = [JWT, ACCESS, ACCESS2, AWS_SECRET, 'JWT-SIGNATURE', 'ACCESS-TOKEN-never'];
const noSecretIn = (text, where) => {
  for (const x of SECRETS) assert.ok(!String(text).includes(x), `${where} carries a secret`);
};

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
process.env.AWS_ACCESS_KEY_ID = 'AKIDEXAMPLE';
process.env.AWS_SECRET_ACCESS_KEY = AWS_SECRET;
process.env.AWS_SESSION_TOKEN = 'FQoGZXIvYXdzEXAMPLETOKEN';
const WIF = {
  ANTHROPIC_FEDERATION_RULE_ID: 'fdrl_01TEST',
  ANTHROPIC_ORGANIZATION_ID: '3f6c0a1e-0000-4000-8000-000000000001',
  ANTHROPIC_SERVICE_ACCOUNT_ID: 'svac_01TEST',
  ANTHROPIC_WORKSPACE_ID: 'wrkspc_01TEST',
};
Object.assign(process.env, WIF);
delete process.env.AI_MODEL_PICKER;

const crypto = require(path.join(REPO, 'lambda-functions/game/tenant-crypto.js'));
const { ORG: ORG_SCOPE, PLATFORM } = require(path.join(REPO, 'lambda-functions/game/tenant.js'));
const { setMetadataKey, setPartition } = require(path.join(REPO, 'lambda-functions/game/set-version.js'));
const summary = require(path.join(REPO, 'lambda-functions/game/get-ai-summary.js'));
const models = require(path.join(REPO, 'lambda-functions/game/summary-models.js'));
const anthropic = require(path.join(REPO, 'lambda-functions/game/anthropic-messages.js'));
const { handler } = summary;

// ---- the fake transport: STS, the token exchange, Messages -------------------
let apiCalls = [];     // Messages
let stsCalls = [];
let exchangeCalls = [];
let apiAnswer = null;  // (req) => {status, body} | throws
let stsAnswer = null;
let exchangeAnswer = null;
const stsOk = () => ({
  status: 200,
  body: '<GetWebIdentityTokenResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/">\n'
    + '  <GetWebIdentityTokenResult>\n    <WebIdentityToken>' + JWT + '</WebIdentityToken>\n'
    + '    <Expiration>2026-10-11T12:49:56Z</Expiration>\n  </GetWebIdentityTokenResult>\n'
    + '  <ResponseMetadata><RequestId>r-1</RequestId></ResponseMetadata>\n</GetWebIdentityTokenResponse>',
});
let accessQueue = [];
const exchangeOk = () => ({
  status: 200,
  body: JSON.stringify({ access_token: accessQueue.length ? accessQueue.shift() : ACCESS, token_type: 'Bearer', expires_in: 600 }),
});
anthropic._setTransport(async (req) => {
  if (req.host === 'sts.us-east-1.amazonaws.com') {
    stsCalls.push(req);
    return (stsAnswer || stsOk)(req);
  }
  if (req.host === 'api.anthropic.com' && req.path === '/v1/oauth/token') {
    exchangeCalls.push({ ...req, json: JSON.parse(req.body) });
    return (exchangeAnswer || exchangeOk)(req);
  }
  if (req.host === 'api.anthropic.com' && req.path === '/v1/messages') {
    apiCalls.push({ headers: req.headers, body: JSON.parse(req.body), timeoutMs: req.timeoutMs });
    if (!apiAnswer) throw new Error('the Anthropic API was called with no answer queued');
    return apiAnswer(req);
  }
  throw new Error('unexpected host ' + req.host + req.path);
});
let fakeNow = Date.now();
anthropic._setClock(() => fakeNow);

if (!process.env.DEBUG) { console.log = () => {}; console.warn = () => {}; console.error = () => {}; }
const say = (...a) => process.stdout.write(a.join(' ') + '\n');

let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); say(`  PASS  ${label}`); pass++; }
  catch (e) { say(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const FORMAT = { depth: Infinity, maxArrayLength: Infinity, maxStringLength: Infinity, breakLength: Infinity };
async function captureLogs(fn) {
  const lines = [];
  const orig = {};
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    orig[level] = console[level];
    console[level] = (...args) => lines.push(util.formatWithOptions(FORMAT, ...args));
  }
  let out;
  try { out = await fn(); } finally { Object.assign(console, orig); }
  return { out, logs: lines.join('\n') };
}

const isEnvelope = (v) => !!v && typeof v === 'object' && typeof v.ct === 'string' && typeof v.iv === 'string';

// ---- fixtures (the relay pilot's round, as tests/ai-advisor-relay-fixes.js) ---
const ORG = 'org_picker';
const ADVISOR = JSON.parse(fs.readFileSync(path.join(REPO, 'sets/prompt-callandanswer-workie-advisor.json'), 'utf8'));
const HEADING = '## ' + ADVISOR.outputSections[0].heading;
const PEOPLE = ['Lena Ortiz', 'Maya Chen', 'Omar Patel', 'Theo Brooks'];
const BALLOTS = [
  ['V1', { 3: 1, 0: 2, 2: 3 }], ['V2', { 0: 1, 3: 2, 1: 3 }],
  ['V3', { 1: 1, 2: 2, 3: 3 }], ['V4', { 2: 1, 0: 2, 1: 3 }],
];

async function mintOrg(orgId) {
  const blob = await crypto.createOrgDataKey(orgId);
  put({ PK: `ORG#${orgId}`, SK: 'METADATA', orgId, dataKeyCiphertext: blob });
  crypto.forgetOrg(orgId);
}

async function seedRound(gameId, { orgId = '' } = {}) {
  const scope = orgId ? ORG_SCOPE : PLATFORM;
  const setId = `set-${gameId}`;
  const setRef = { scope, orgId, setId };
  const seal = async (entity, item) => (orgId ? crypto.encryptItem(orgId, entity, item) : item);
  put(await seal('session', {
    PK: `GAME#${gameId}`, SK: 'METADATA', GameType: 'call-and-answer', Title: 'Picker pilot',
    QuestionSetId: setId, QuestionSetScope: scope, ...(orgId ? { orgId } : {}),
  }));
  put({ PK: `GAME#${gameId}`, SK: 'STATE', State: 'RESULTS#001', CurrentQuestionId: '001' });
  put({ PK: `GAME#${gameId}`, SK: 'ROUND#001', QuestionNumber: '001', AuthorsRevealed: true });
  put(await seal('set', {
    ...setMetadataKey(setRef), ...(orgId ? { orgId } : {}), activeVersion: 1,
    engagementType: 'call-and-answer', name: 'Picker set',
  }));
  put(await seal('question', {
    PK: setPartition(setRef, 1), SK: 'QUESTION#c001#001',
    Title: 'A reform the court resisted', Detail: 'The story.', Category: 'Change',
  }));
  put({
    PK: `GAME#${gameId}`, SK: 'QUESTION#001#REF', SourceQuestionId: 'QUESTION#c001#001',
    SetId: setId, SetVersion: 1, SetScope: scope, ...(orgId ? { SetOrgId: orgId } : {}),
  });
  for (const name of PEOPLE) {
    put(await seal('answer', { PK: `GAME#${gameId}`, SK: `QUESTION#001#ANSWER#${name}`, PlayerName: name,
      Answer: `If we pilot it with ${name.split(' ')[0]}'s team first, the court cannot stall it.` }));
  }
  for (const [voter, votes] of BALLOTS) {
    put(await seal('vote', { PK: `GAME#${gameId}`, SK: `QUESTION#001#VOTE#${voter}`, VoterName: voter,
      QuestionNumber: '001', Votes: votes }));
  }
  put({ PK: 'AIPROMPTS', SK: 'AIPROMPT#lessons-learned', promptId: 'lessons-learned', name: ADVISOR.name,
        s3Key: 'none', instructions: ADVISOR.instructions, outputFormat: ADVISOR.outputFormat,
        outputSections: ADVISOR.outputSections });
}

// The completion after the prefilled heading (Bedrock Haiku), and the same
// read as a whole document (a model with no prefill).
const BODY = '\n\n- **What came back**: four answers open with *If we pilot it*.\n'
  + '- **No split**: every answer names a pilot.\n\n## What the room voted\n'
  + '- **Top of the vote**: Lena Ortiz earned 7 vote points; Theo Brooks and Omar Patel each earned 6 vote points.\n\n'
  + '## Discussion topics\n1. Which team pilots first?\n\n## Suggested next steps\n'
  + '1. Whoever runs the pilot: draft the one-page plan.';
const API_TEXT = 'SONNET-WROTE-THIS ' + HEADING + BODY.replace('four answers', 'all four answers');
const apiOk = (text = API_TEXT, extra = {}) => () => ({
  status: 200,
  body: JSON.stringify({
    id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5',
    content: [{ type: 'thinking', thinking: '' }, { type: 'text', text }],
    stop_reason: 'end_turn', usage: { input_tokens: 3900, output_tokens: 610 }, ...extra,
  }),
});
const apiStatus = (status, type, message) => () => ({
  status, body: JSON.stringify({ type: 'error', error: { type, message } }),
});

const DEFAULT_SK = 'QUESTION#001#AISummary';
const variantKey = (gameId, id) => key(`GAME#${gameId}`, `QUESTION#001#AIVARIANT#${id}`);
const row = (gameId, sk = DEFAULT_SK) => store.get(key(`GAME#${gameId}`, sk));
const open = async (orgId, item) => (orgId && item ? crypto.decryptItem(orgId, 'aiSummary', item) : item);

function reset() {
  bedrockCalls = []; apiCalls = []; stsCalls = []; exchangeCalls = []; invokes.length = 0; puts.length = 0;
  bedrockFail = null; apiAnswer = null; stsAnswer = null; exchangeAnswer = null; accessQueue = [];
  bedrockReply = BODY;
}

async function runWorker(gameId, model) {
  let res;
  const { logs } = await captureLogs(async () => {
    try { res = await handler({ __workerMode: true, gameId, questionId: '001', ...(model ? { model } : {}) }); }
    catch (e) { res = { error: e.message }; }
  });
  return { res, logs };
}

const PUBLIC_ROUTE = 'GET /games/{gameId}/ai-summary';
const HOST_ROUTE = 'GET /games/{gameId}/ai-summary/host';
const STAFF = { lambda: { userId: 'u-staff', groups: 'admins,hosts', orgId: ORG, orgIds: ORG } };
const HOST = { lambda: { userId: 'u-host', groups: 'hosts', orgId: ORG, orgIds: ORG } };

async function call(routeKey, gameId, query = {}, authorizer = null) {
  invokes.length = 0;
  const res = await handler({
    routeKey,
    rawPath: routeKey === HOST_ROUTE ? `/games/${gameId}/ai-summary/host` : `/games/${gameId}/ai-summary`,
    pathParameters: { gameId },
    queryStringParameters: Object.keys(query).length ? query : undefined,
    requestContext: { routeKey, ...(authorizer ? { authorizer } : {}) },
  });
  let body = {};
  try { body = JSON.parse(res.body || '{}'); } catch { body = {}; }
  return { status: res.statusCode, body, invoked: invokes.slice() };
}

const NEW_FIELDS = ['ModelRequested', 'Provider', 'LatencyMs', 'InputTokens', 'OutputTokens', 'ModelFallbackReason'];

(async () => {
  await mintOrg(ORG);

  // ------------------------------------------------------------------------
  say('\n1. the switch: off by default, on for dev only, no new resource');
  const template = fs.readFileSync(path.join(REPO, 'template-clean.yaml'), 'utf8');
  const spec = (tier) => fs.readFileSync(path.join(REPO, `buildspec-${tier}.yml`), 'utf8');

  await check('AiModelPicker is a parameter that defaults to \'false\'', () => {
    const block = template.match(/\n {2}AiModelPicker:\n((?: {4}.*\n)+)/);
    assert.ok(block, 'no AiModelPicker parameter');
    assert.match(block[1], /Default: 'false'/);
    assert.match(block[1], /AllowedValues: \['true', 'false'\]/);
  });
  await check('the get-ai-summary function reads it as AI_MODEL_PICKER, with the four federation ids', () => {
    const fn = template.slice(template.indexOf('  GetAISummaryFunction:'), template.indexOf('      Events:', template.indexOf('  GetAISummaryFunction:')));
    assert.match(fn, /AI_MODEL_PICKER: !Ref AiModelPicker/);
    for (const [name, param] of [['ANTHROPIC_FEDERATION_RULE_ID', 'AnthropicFederationRuleId'],
      ['ANTHROPIC_ORGANIZATION_ID', 'AnthropicOrganizationId'],
      ['ANTHROPIC_SERVICE_ACCOUNT_ID', 'AnthropicServiceAccountId'],
      ['ANTHROPIC_WORKSPACE_ID', 'AnthropicWorkspaceId']]) {
      assert.ok(fn.includes(`${name}: !Ref ${param}`), name);
      const block = template.match(new RegExp(`\\n  ${param}:\\n((?: {4}.*\\n)+)`));
      assert.ok(block && /Default: ''/.test(block[1]), `${param} must default to empty`);
    }
    // ...and nowhere else: no other function gets the switch.
    assert.strictEqual(template.split('AI_MODEL_PICKER: !Ref AiModelPicker').length - 1, 1);
    assert.strictEqual(template.split('ANTHROPIC_WORKSPACE_ID: !Ref').length - 1, 1);
  });
  await check('its one new grant: sts:GetWebIdentityToken, Allow on the switch, Deny without it', () => {
    const fn = template.slice(template.indexOf('  GetAISummaryFunction:'), template.indexOf('      Events:', template.indexOf('  GetAISummaryFunction:')));
    assert.match(fn, /- Effect: !If \[AiModelPickerOn, Allow, Deny\]\n\s+Action: sts:GetWebIdentityToken\n\s+Resource: '\*'/);
    assert.match(template, /AiModelPickerOn: !Equals \[!Ref AiModelPicker, 'true'\]/);
    assert.strictEqual(template.split('sts:GetWebIdentityToken').length - 1, 1, 'granted to another function');
    assert.ok(!/ssm:GetParameter|anthropic\/api-key|ANTHROPIC_KEY/.test(template), 'a stored-key path survives');
  });
  await check('only buildspec-dev.yml passes AiModelPicker=true; test and prod never mention it', () => {
    assert.match(spec('dev'), /PARAM_OVERRIDES="\$PARAM_OVERRIDES AiModelPicker=true"/);
    assert.ok(!/AiModelPicker|Anthropic/.test(spec('test')), 'buildspec-test.yml sets the picker');
    assert.ok(!/AiModelPicker|Anthropic/.test(spec('prod')), 'buildspec-prod.yml sets the picker');
    for (const p of ['AnthropicFederationRuleId', 'AnthropicOrganizationId', 'AnthropicServiceAccountId', 'AnthropicWorkspaceId']) {
      assert.match(spec('dev'), new RegExp(`\\[ -n "\\$[A-Z_]+" \\] && PARAM_OVERRIDES="\\$PARAM_OVERRIDES ${p}=`), p);
    }
  });
  await check('the override is appended before the sam deploy that uses it', () => {
    const s = spec('dev');
    assert.ok(s.indexOf('AiModelPicker=true') < s.indexOf('Deploying to AWS...'), 'appended after the deploy');
  });
  await check('no resource is added: the same top-level resources as HEAD', () => {
    const names = (text) => {
      const start = text.indexOf('\nResources:\n');
      const end = text.indexOf('\nOutputs:\n');
      return (text.slice(start, end > start ? end : undefined).match(/^ {2}[A-Za-z0-9]+:/gm) || []).length;
    };
    let head;
    try { head = execFileSync('git', ['show', 'HEAD:template-clean.yaml'], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 << 20 }); }
    catch { head = null; }
    if (head === null) return; // a checkout with no history has nothing to compare
    const before = names(head);
    const after = names(template);
    assert.ok(after <= before, `${before} resources at HEAD, ${after} now`);
  });

  await check('the catalogue: one default (Bedrock Haiku 4.5), ids with no "#", the four API models', () => {
    assert.strictEqual(models.DEFAULT_MODEL.modelId, summary.SUMMARY_MODEL_ID);
    assert.strictEqual(models.DEFAULT_MODEL.provider, 'bedrock');
    assert.strictEqual(models.DEFAULT_MODEL.prefill, true);
    for (const m of models.MODELS) assert.ok(!m.id.includes('#'), m.id);
    for (const id of ['claude-fable-5-1', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']) {
      const m = models.findModel(id);
      assert.ok(m && m.provider === 'anthropic' && m.modelId === id && m.prefill === false, id);
    }
    assert.strictEqual(models.MODELS.filter((m) => m.prefill).length, 1, 'only Haiku 4.5 takes a prefill');
  });
  await check('a variant key is never an "#AISummary" key (create-report.js gathers those)', () => {
    assert.ok(!models.variantSk('001', 'claude-opus-5-5').includes('#AISummary'));
  });

  // ------------------------------------------------------------------------
  say('\n2. switch off: the read is written exactly as before');
  delete process.env.AI_MODEL_PICKER;
  reset();
  await seedRound('8101', { orgId: ORG });
  const off = await runWorker('8101', 'claude-sonnet-5-5'); // even a model in the event is ignored
  await check('the worker completed', () => assert.strictEqual(off.res && off.res.ok, true, JSON.stringify(off.res)));
  await check('one Bedrock request, byte-for-byte today\'s', () => {
    assert.strictEqual(bedrockCalls.length, 1);
    const c = bedrockCalls[0];
    assert.strictEqual(c.modelId,
      'arn:aws:bedrock:us-east-1:111122223333:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0');
    const expected = JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 2048,
      temperature: 0.7,
      messages: [
        { role: 'user', content: c.body.messages[0].content },
        { role: 'assistant', content: HEADING },
      ],
    });
    assert.strictEqual(c.raw, expected);
    assert.ok(!c.body.messages[0].content.includes('Begin your reply with this exact line'));
  });
  await check('no STS token, no exchange, no Anthropic API call', () => {
    assert.strictEqual(stsCalls.length, 0);
    assert.strictEqual(exchangeCalls.length, 0);
    assert.strictEqual(apiCalls.length, 0);
  });
  await check('the room\'s read only: no variant row, none of the new attributes', async () => {
    assert.deepStrictEqual(puts, [DEFAULT_SK]);
    const stored = await open(ORG, row('8101'));
    assert.strictEqual(stored.Model, summary.SUMMARY_MODEL_ID);
    for (const f of NEW_FIELDS) assert.ok(!(f in stored), `${f} written with the switch off`);
    assert.ok(stored.MarkdownResponse.startsWith(HEADING));
  });
  await check('staff on the host route: `model` is not passed to the worker', async () => {
    const r = await call(HOST_ROUTE, '8101', { questionId: '001', generateNew: 'true', model: 'claude-opus-5-5' }, STAFF);
    assert.strictEqual(r.status, 202);
    assert.strictEqual(r.invoked.length, 1);
    assert.ok(!('model' in r.invoked[0]), JSON.stringify(r.invoked[0]));
    assert.ok(!('model' in r.body));
  });
  await check('staff: an unknown model is not even a 400 — it is ignored', async () => {
    const r = await call(HOST_ROUTE, '8101', { questionId: '001', generateNew: 'true', model: 'gpt-9' }, STAFF);
    assert.strictEqual(r.status, 202);
  });
  await check('staff: `variants` returns the ordinary read, with no picker and no variants', async () => {
    const r = await call(HOST_ROUTE, '8101', { questionId: '001', variants: 'true' }, STAFF);
    assert.strictEqual(r.status, 200);
    assert.ok(!('variants' in r.body) && !('modelPicker' in r.body), Object.keys(r.body).join(','));
    assert.ok(!('provider' in r.body) && !('modelRequested' in r.body));
  });

  // ------------------------------------------------------------------------
  say('\n3. switch on: who may choose a model');
  process.env.AI_MODEL_PICKER = 'true';
  reset();
  await check('a host who is not staff: `model` ignored, a normal generation', async () => {
    const r = await call(HOST_ROUTE, '8101', { questionId: '001', generateNew: 'true', model: 'claude-opus-5-5' }, HOST);
    assert.strictEqual(r.status, 202);
    assert.ok(!('model' in r.invoked[0]));
  });
  await check('a host who is not staff: `variants` gives no variants and no picker', async () => {
    const r = await call(HOST_ROUTE, '8101', { questionId: '001', variants: 'true' }, HOST);
    assert.ok(!('variants' in r.body) && !('modelPicker' in r.body));
  });
  await check('the public route still 403s a generation, model or not, even for staff', async () => {
    const r = await call(PUBLIC_ROUTE, '8101', { questionId: '001', generateNew: 'true', model: 'claude-opus-5-5' }, STAFF);
    assert.strictEqual(r.status, 403);
    assert.strictEqual(r.invoked.length, 0);
  });
  await check('the public route never lists variants', async () => {
    const r = await call(PUBLIC_ROUTE, '8101', { questionId: '001', variants: 'true' }, STAFF);
    assert.ok(!('variants' in r.body) && !('modelPicker' in r.body));
  });
  await check('staff, unknown model: 400, and no generation', async () => {
    const r = await call(HOST_ROUTE, '8101', { questionId: '001', generateNew: 'true', model: 'gpt-9' }, STAFF);
    assert.strictEqual(r.status, 400);
    assert.strictEqual(r.invoked.length, 0);
  });
  await check('staff, a catalogue model: 202 and the worker is told which', async () => {
    const r = await call(HOST_ROUTE, '8101', { questionId: '001', generateNew: 'true', model: 'claude-sonnet-5-5' }, STAFF);
    assert.strictEqual(r.status, 202);
    assert.strictEqual(r.invoked[0].model, 'claude-sonnet-5-5');
    assert.strictEqual(r.body.model, 'claude-sonnet-5-5');
  });
  await check('staff, the cached read carries the picker and the row\'s model fields', async () => {
    const r = await call(HOST_ROUTE, '8101', { questionId: '001' }, STAFF);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.modelPicker.enabled, true);
    assert.strictEqual(r.body.modelPicker.defaultModel, 'bedrock-haiku-4-5');
    assert.ok(r.body.modelPicker.models.every((m) => !('modelId' in m)), 'provider ids leak to the client');
    assert.strictEqual(r.body.modelLabel, 'Claude Haiku 4.5');
  });

  // ------------------------------------------------------------------------
  say('\n4. the Anthropic API path');
  reset();
  anthropic._resetTokenCache();
  const roomBefore = JSON.stringify(row('8101'));
  apiAnswer = apiOk();
  const sonnet = await runWorker('8101', 'claude-sonnet-5-5');
  await check('the worker completed', () => assert.strictEqual(sonnet.res && sonnet.res.ok, true, JSON.stringify(sonnet.res)));
  await check('STS GetWebIdentityToken: the regional host, the Query action, the audience, signed', () => {
    assert.strictEqual(stsCalls.length, 1);
    const r = stsCalls[0];
    assert.strictEqual(r.method, 'POST');
    assert.strictEqual(r.path, '/');
    const q = new URLSearchParams(r.body);
    assert.strictEqual(q.get('Action'), 'GetWebIdentityToken');
    assert.strictEqual(q.get('Version'), '2011-06-15');
    assert.strictEqual(q.get('Audience.member.1'), 'https://api.anthropic.com');
    assert.strictEqual(q.get('SigningAlgorithm'), 'RS256');
    assert.strictEqual(q.get('DurationSeconds'), '900');
    assert.match(r.headers.authorization, /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/us-east-1\/sts\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date;x-amz-security-token, Signature=[0-9a-f]{64}$/);
    assert.strictEqual(r.headers['x-amz-security-token'], 'FQoGZXIvYXdzEXAMPLETOKEN');
  });
  await check('the SigV4 signature is the one @smithy/signature-v4 computes (known answer)', () => {
    const h = anthropic.signSigV4({
      host: 'sts.us-east-1.amazonaws.com', region: 'us-east-1', service: 'sts', body: anthropic.stsBody(),
      credentials: { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: AWS_SECRET, sessionToken: 'FQoGZXIvYXdzEXAMPLETOKEN' },
      now: new Date('2026-10-11T12:34:56Z'),
    });
    // Computed with @smithy/signature-v4 + @aws-crypto/sha256-js on the same inputs.
    assert.ok(h.authorization.endsWith('Signature=060738a0f03c80b649007805f32b24e736517df612ef9542412815f8bcd772bb'), h.authorization);
  });
  await check('the exchange: jwt-bearer grant, the AWS JWT, the four ids', () => {
    assert.strictEqual(exchangeCalls.length, 1);
    assert.deepStrictEqual(exchangeCalls[0].json, {
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: JWT,
      federation_rule_id: WIF.ANTHROPIC_FEDERATION_RULE_ID, organization_id: WIF.ANTHROPIC_ORGANIZATION_ID,
      service_account_id: WIF.ANTHROPIC_SERVICE_ACCOUNT_ID, workspace_id: WIF.ANTHROPIC_WORKSPACE_ID,
    });
  });
  await check('one Messages POST, Bearer access token, the API version and JSON, no x-api-key', () => {
    assert.strictEqual(apiCalls.length, 1);
    const h = apiCalls[0].headers;
    assert.strictEqual(h.authorization, 'Bearer ' + ACCESS);
    assert.ok(!('x-api-key' in h));
    assert.strictEqual(h['anthropic-version'], '2023-06-01');
    assert.strictEqual(h['content-type'], 'application/json');
    assert.ok(apiCalls[0].timeoutMs > 0 && apiCalls[0].timeoutMs < 300000, 'no timeout under the function\'s 300s');
  });
  await check('the Messages request: the model, one user turn, no prefill, no temperature', () => {
    const b = apiCalls[0].body;
    assert.strictEqual(b.model, 'claude-sonnet-5-5');
    assert.strictEqual(b.max_tokens, 2048);
    assert.strictEqual(b.messages.length, 1);
    assert.strictEqual(b.messages[0].role, 'user');
    assert.ok(!('temperature' in b), 'temperature is a 400 on this model');
    assert.deepStrictEqual(b.thinking, { type: 'between_tools' });
    assert.ok(b.messages[0].content.endsWith('Begin your reply with this exact line, and write nothing before it:\n' + HEADING));
  });
  await check('Bedrock was never asked when the API answered', async () => {
    reset();
    apiAnswer = apiOk();
    await runWorker('8101', 'claude-sonnet-5-5');
    assert.strictEqual(bedrockCalls.length, 0);
  });
  await check('the access token is cached for the warm container', () => {
    assert.strictEqual(stsCalls.length, 0, 'minted again');
    assert.strictEqual(exchangeCalls.length, 0);
  });
  await check('...and minted again once it is within a minute of expiring', async () => {
    reset(); apiAnswer = apiOk(); accessQueue = [ACCESS2];
    fakeNow += 541 * 1000; // 600s life, refreshed 60s early
    await runWorker('8101', 'claude-sonnet-5-5');
    assert.strictEqual(stsCalls.length, 1);
    assert.strictEqual(exchangeCalls.length, 1);
    assert.strictEqual(apiCalls[0].headers.authorization, 'Bearer ' + ACCESS2);
  });
  await check('a 401 mints once more and retries once', async () => {
    reset(); accessQueue = [ACCESS];
    let n = 0;
    apiAnswer = (req) => (++n === 1 ? apiStatus(401, 'authentication_error', 'expired')() : apiOk()(req));
    const r = await runWorker('8101', 'claude-sonnet-5-5');
    assert.strictEqual(r.res && r.res.ok, true);
    assert.strictEqual(apiCalls.length, 2);
    assert.strictEqual(stsCalls.length, 1);
    assert.strictEqual(apiCalls[1].headers.authorization, 'Bearer ' + ACCESS);
    const v = await open(ORG, store.get(variantKey('8101', 'claude-sonnet-5-5')));
    assert.strictEqual(v.Provider, 'anthropic');
  });
  await check('no JWT, access token or AWS secret in any log line', () => noSecretIn(sonnet.logs, 'the logs'));
  const variant = await open(ORG, store.get(variantKey('8101', 'claude-sonnet-5-5')));
  await check('the variant row: who wrote it, what it cost, how long', () => {
    assert.ok(variant, 'no variant row');
    assert.strictEqual(variant.Model, 'claude-sonnet-5-5');
    assert.strictEqual(variant.ModelRequested, 'claude-sonnet-5-5');
    assert.strictEqual(variant.Provider, 'anthropic');
    assert.strictEqual(variant.InputTokens, 3900);
    assert.strictEqual(variant.OutputTokens, 610);
    assert.ok(Number.isFinite(variant.LatencyMs) && variant.LatencyMs >= 0);
    assert.ok(!('ModelFallbackReason' in variant));
    assert.ok(!('DebugInfo' in variant), 'the prompt was copied onto a variant');
  });
  await check('the heading is enforced: the preamble before it is dropped', () => {
    assert.ok(variant.MarkdownResponse.startsWith(HEADING), variant.MarkdownResponse.slice(0, 60));
    assert.ok(!variant.MarkdownResponse.includes('SONNET-WROTE-THIS'));
    assert.ok(variant.MarkdownResponse.includes('all four answers'));
  });
  await check('the variant is sealed at rest like the read, with the 30-day ttl', () => {
    const raw = store.get(variantKey('8101', 'claude-sonnet-5-5'));
    assert.ok(isEnvelope(raw.MarkdownResponse), 'MarkdownResponse in the clear');
    assert.strictEqual(raw.Model, 'claude-sonnet-5-5', 'Model is configuration, plaintext');
    const days = (raw.ttl - Date.now() / 1000) / 86400;
    assert.ok(days > 29.9 && days <= 30, `ttl ${days} days`);
  });
  await check('a heading-less reply gets the heading put back', () => {
    assert.strictEqual(summary.ensureLeadingHeading('Plain start.', HEADING), HEADING + '\n\nPlain start.');
    assert.strictEqual(summary.ensureLeadingHeading(HEADING + '\n\nx', HEADING), HEADING + '\n\nx');
  });
  await check('Opus 5.5 and Fable 5.1, which always think, get room for it', () => {
    for (const id of ['claude-opus-5-5', 'claude-fable-5-1']) {
      const b = anthropic.buildRequest(models.findModel(id), 'p');
      assert.ok(b.max_tokens > 2048, id);
      assert.ok(!('thinking' in b) && !('temperature' in b), id);
    }
    assert.deepStrictEqual(anthropic.buildRequest(models.findModel('claude-haiku-5-5'), 'p').thinking, { type: 'disabled' });
  });

  // ------------------------------------------------------------------------
  say('\n5. a chosen model that fails falls back to Haiku 4.5, and says why');
  const fallbackCase = async (label, reason, setup) => {
    reset();
    setup();
    store.delete(variantKey('8101', 'claude-opus-5-5'));
    const run = await runWorker('8101', 'claude-opus-5-5');
    const v = await open(ORG, store.get(variantKey('8101', 'claude-opus-5-5')));
    await check(`${label}: written by Haiku 4.5 with the prefill, reason "${reason}"`, () => {
      assert.strictEqual(run.res && run.res.ok, true, JSON.stringify(run.res));
      assert.ok(v, 'no variant row');
      assert.strictEqual(v.Model, summary.SUMMARY_MODEL_ID);
      assert.strictEqual(v.ModelRequested, 'claude-opus-5-5');
      assert.strictEqual(v.Provider, 'bedrock');
      assert.strictEqual(v.ModelFallbackReason, reason);
      assert.strictEqual(bedrockCalls.length, 1);
      assert.strictEqual(bedrockCalls[0].body.messages[1].content, HEADING);
      assert.ok(!v.Fallback, 'a model fallback is still a real read, not the template');
      noSecretIn(run.logs, 'the logs');
      noSecretIn(JSON.stringify(store.get(variantKey('8101', 'claude-opus-5-5'))), 'the row');
      // One generation, two models: the same prompt, plus only the heading line.
      if (apiCalls.length) {
        assert.strictEqual(apiCalls[0].body.messages[0].content,
          bedrockCalls[0].body.messages[0].content
          + '\n\nBegin your reply with this exact line, and write nothing before it:\n' + HEADING);
      }
    });
    return run;
  };
  anthropic._resetTokenCache();
  await fallbackCase('rate limited (429)', 'rate-limit', () => { apiAnswer = apiStatus(429, 'rate_limit_error', 'slow down'); });
  await fallbackCase('out of credit', 'credit', () => {
    apiAnswer = apiStatus(400, 'invalid_request_error', 'Your credit balance is too low to access the Anthropic API.');
  });
  await fallbackCase('overloaded (529)', 'overloaded', () => { apiAnswer = apiStatus(529, 'overloaded_error', 'Overloaded'); });
  await fallbackCase('a refusal', 'refusal', () => { apiAnswer = apiOk('', { stop_reason: 'refusal', content: [] }); });
  await fallbackCase('timed out', 'timeout', () => {
    apiAnswer = () => { throw new anthropic.ModelCallError(anthropic.REASONS.TIMEOUT); };
  });
  await fallbackCase('a second 401', 'auth', () => { apiAnswer = apiStatus(401, 'authentication_error', 'no'); });
  await fallbackCase('STS refuses the token', 'sts-error', () => {
    anthropic._resetTokenCache(); apiAnswer = apiOk();
    stsAnswer = () => ({ status: 403, body: '<ErrorResponse><Error><Code>AccessDenied</Code><Message>' + JWT + '</Message></Error></ErrorResponse>' });
  });
  await check('...and with no token Anthropic is never called', () => {
    assert.strictEqual(exchangeCalls.length, 0);
    assert.strictEqual(apiCalls.length, 0);
  });
  await fallbackCase('the exchange is refused', 'token-exchange', () => {
    anthropic._resetTokenCache(); apiAnswer = apiOk();
    exchangeAnswer = () => ({ status: 400, body: JSON.stringify({ error: 'invalid_grant', error_description: JWT }) });
  });
  await check('...and Messages is never called', () => assert.strictEqual(apiCalls.length, 0));
  const savedRule = process.env.ANTHROPIC_WORKSPACE_ID;
  await fallbackCase('an id is missing (not connected)', 'not-connected', () => {
    anthropic._resetTokenCache(); delete process.env.ANTHROPIC_WORKSPACE_ID; apiAnswer = apiOk();
  });
  await check('...and nothing leaves AWS: no STS, no exchange, no Messages', () => {
    assert.strictEqual(stsCalls.length + exchangeCalls.length + apiCalls.length, 0);
  });
  await check('...and the picker shows the API models unavailable, with the reason', async () => {
    const r = await call(HOST_ROUTE, '8101', { questionId: '001', variants: 'true' }, STAFF);
    for (const m of r.body.modelPicker.models) {
      if (m.provider === 'anthropic') {
        assert.strictEqual(m.available, false, m.id);
        assert.strictEqual(m.unavailableReason, 'Anthropic API not connected');
      } else {
        assert.strictEqual(m.available, true, m.id);
      }
    }
  });
  process.env.ANTHROPIC_WORKSPACE_ID = savedRule;
  anthropic._resetTokenCache();
  await fallbackCase('an API error (500)', 'api-error', () => { apiAnswer = apiStatus(500, 'api_error', 'x'); });
  // A Bedrock model that is refused: Opus 4.6, AccessDenied, then Haiku.
  reset();
  bedrockFail = (input) => {
    if (input.modelId.includes('opus-4-6')) { const e = new Error('denied'); e.name = 'AccessDeniedException'; return e; }
    return null;
  };
  await runWorker('8101', 'bedrock-opus-4-6');
  const opus46 = await open(ORG, store.get(variantKey('8101', 'bedrock-opus-4-6')));
  await check('Bedrock Opus 4.6 refused: asked without a prefill, then Haiku with one', () => {
    assert.strictEqual(bedrockCalls.length, 2);
    assert.match(bedrockCalls[0].modelId, /inference-profile\/us\.anthropic\.claude-opus-4-6-v1$/);
    assert.strictEqual(bedrockCalls[0].body.messages.length, 1, 'a prefill sent to a model that refuses one');
    assert.ok(bedrockCalls[0].body.messages[0].content.endsWith(HEADING));
    assert.strictEqual(bedrockCalls[1].body.messages[1].content, HEADING);
    assert.strictEqual(opus46.ModelFallbackReason, 'access-denied');
    assert.strictEqual(opus46.Model, summary.SUMMARY_MODEL_ID);
  });
  reset();
  await runWorker('8101', 'bedrock-sonnet-4-6');
  const s46 = await open(ORG, store.get(variantKey('8101', 'bedrock-sonnet-4-6')));
  await check('Bedrock Sonnet 4.6 answering: no prefill, heading enforced, tokens counted', () => {
    assert.strictEqual(bedrockCalls.length, 1);
    assert.match(bedrockCalls[0].modelId, /inference-profile\/us\.anthropic\.claude-sonnet-4-6$/);
    assert.strictEqual(s46.Model, 'us.anthropic.claude-sonnet-4-6');
    assert.strictEqual(s46.Provider, 'bedrock');
    assert.ok(s46.MarkdownResponse.startsWith(HEADING));
    assert.strictEqual(s46.InputTokens, 4100);
  });

  // ------------------------------------------------------------------------
  say('\n6. variants beside the room\'s read');
  await check('§4\'s chosen-model runs left 8101\'s room read as it was', () => {
    assert.strictEqual(JSON.stringify(row('8101')), roomBefore);
  });
  reset();
  await seedRound('8102', { orgId: ORG });
  await runWorker('8102'); // the round's normal read, picker on
  const roomRead = JSON.stringify(row('8102'));
  await check('a normal generation writes the room\'s read and a copy under the default', async () => {
    assert.deepStrictEqual(puts.sort(), [DEFAULT_SK, 'QUESTION#001#AIVARIANT#bedrock-haiku-4-5'].sort());
    const stored = await open(ORG, row('8102'));
    assert.strictEqual(stored.ModelRequested, 'bedrock-haiku-4-5');
    assert.strictEqual(stored.Provider, 'bedrock');
    assert.strictEqual(stored.InputTokens, 4100);
  });
  reset(); apiAnswer = apiOk();
  await runWorker('8102', 'claude-sonnet-5-5');
  reset(); bedrockFail = (input) => (input.modelId.includes('opus-4-6') ? Object.assign(new Error('x'), { name: 'AccessDeniedException' }) : null);
  await runWorker('8102', 'bedrock-opus-4-6');
  await check('a chosen model writes only its own variant: the room\'s read is byte-identical', () => {
    assert.strictEqual(JSON.stringify(row('8102')), roomRead);
  });
  await check('the room\'s reader (public route) still returns the default read', async () => {
    const r = await call(PUBLIC_ROUTE, '8102', { questionId: '001' });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.model, summary.SUMMARY_MODEL_ID);
    assert.ok(!r.body.markdownResponse.includes('all four answers'), 'the room got the Sonnet read');
    assert.ok(!('variants' in r.body) && !('provider' in r.body));
  });
  const listed = await call(HOST_ROUTE, '8102', { questionId: '001', variants: 'true' }, STAFF);
  await check('staff variants read: every model\'s latest, decrypted, in catalogue order', () => {
    assert.strictEqual(listed.status, 200);
    assert.strictEqual(listed.body.modelPicker.enabled, true);
    const ids = listed.body.variants.map((v) => v.modelRequested);
    assert.deepStrictEqual(ids, ['bedrock-haiku-4-5', 'bedrock-opus-4-6', 'claude-sonnet-5-5']);
    for (const v of listed.body.variants) {
      assert.strictEqual(typeof v.markdownResponse, 'string', 'still sealed');
      assert.ok(v.markdownResponse.startsWith(HEADING));
    }
  });
  await check('each carries the footer figures: label, provider, time, tokens, cost, fallback', () => {
    const son = listed.body.variants.find((v) => v.modelRequested === 'claude-sonnet-5-5');
    assert.strictEqual(son.modelLabel, 'Claude Sonnet 5.5');
    assert.strictEqual(son.provider, 'anthropic');
    assert.strictEqual(son.inputTokens, 3900);
    assert.ok(Math.abs(son.costUsd - (3900 * 2 + 610 * 10) / 1e6) < 1e-12, String(son.costUsd));
    const op = listed.body.variants.find((v) => v.modelRequested === 'bedrock-opus-4-6');
    assert.strictEqual(op.modelLabel, 'Claude Haiku 4.5');
    assert.strictEqual(op.modelRequestedLabel, 'Claude Opus 4.6');
    assert.strictEqual(op.modelFallbackReason, 'access-denied');
    // Priced at the model that actually wrote it.
    assert.ok(Math.abs(op.costUsd - (4100 * 1 + 700 * 5) / 1e6) < 1e-12, String(op.costUsd));
  });
  await check('a variant failure broadcasts its own type, never the room\'s aiSummaryError', () => {
    const src = fs.readFileSync(path.join(REPO, 'lambda-functions/game/get-ai-summary.js'), 'utf8');
    assert.match(src, /type: event\.model \? 'aiSummaryVariantError' : 'aiSummaryError'/);
    assert.match(src, /type: 'aiSummaryVariantReady'/);
  });

  // An orgless round: the variant is plaintext, as the read is.
  reset(); apiAnswer = apiOk();
  await seedRound('8103');
  await runWorker('8103', 'claude-haiku-5-5');
  await check('an orgless round\'s variant is stored in the clear like its read', () => {
    const raw = store.get(variantKey('8103', 'claude-haiku-5-5'));
    assert.ok(raw && typeof raw.MarkdownResponse === 'string');
    assert.strictEqual(apiCalls[0].body.model, 'claude-haiku-5-5');
  });

  say(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})().catch((e) => { say('CRASH ' + (e && e.stack)); process.exit(1); });
