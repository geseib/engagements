/**
 * THE CLAUDE MODELS SWITCH (owner, 2026-10-11): one Engage-wide setting, on by
 * default, that sends every Bedrock Haiku 4.5 call to Haiku 5.5 and every
 * Bedrock Sonnet 4.6 call to Sonnet 5.5 on the Anthropic API, and falls back
 * to the original Bedrock model on any failure.
 * docs/handoff/claude-55-switch-2026-10-11.md.
 *
 *   1. The copies: claude-route.js and anthropic-messages.js are byte-identical
 *      in game/ and admin/shared/.
 *   2. Switch off, or not connected: `send` hands Bedrock the very command it
 *      was given, and every call site builds that command exactly as HEAD's
 *      source did (the InvokeModelCommand literal is unchanged) — so each
 *      site's Bedrock request is byte-identical to before. Nothing goes to STS.
 *   3. The setting: absent is ON, a false row is off, a malformed row is on,
 *      an unreadable row keeps the last value (on at first), cached a minute;
 *      not connected never reads it.
 *   4. On: the mapped model ids; no prefill, no temperature/top_p/top_k;
 *      thinking off the way each model accepts (disabled / between_tools) at
 *      an allowed effort; no forced tool_choice; max_tokens raised; Opus and
 *      other models untouched. Driven through the real call sites where they
 *      export one (draft-briefing, finding explanations, topic suggestion,
 *      structured generation).
 *   5. Every failure falls back to the ORIGINAL Bedrock command: STS, token
 *      exchange, HTTP 500/429/529, out of credit, the overall time budget, a
 *      refusal, max_tokens, an empty reply, a missing tool call, a reply that
 *      does not begin with the prefill. One structured warning each; no token,
 *      no prompt text in any log line.
 *   6. The route: staff only (authorizer and handler), GET defaults to on,
 *      `connected` false where an id is missing and POST refused there, a
 *      change audited FIRST and refused (503, nothing written) when the audit
 *      entry cannot be written.
 *   7. The template: sts:GetWebIdentityToken (Allow only when all four ids are
 *      set) and the four env vars on exactly the functions whose code calls a
 *      model, derived from the require graph; the settings route on the
 *      platform function; test's buildspec values; prod untouched; the same
 *      top-level resources as HEAD.
 *
 * No network: STS, the token exchange, Messages and Bedrock are fakes.
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const fs = require('fs');
const util = require('util');
const assert = require('assert');
const { execFileSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const LF = path.join(REPO, 'lambda-functions');

// ---- module stubs (every copy an SDK name resolves to) ------------------------
const STUB_PATHS = [REPO, LF, path.join(LF, 'admin'), path.join(LF, 'admin', 'orgs'), path.join(LF, 'game')];
function stub(name, exports) {
  const seen = new Set();
  for (const base of STUB_PATHS) {
    let p;
    try { p = require.resolve(name, { paths: [base] }); } catch { continue; }
    if (seen.has(p)) continue;
    seen.add(p);
    require.cache[p] = { id: p, filename: p, loaded: true, exports };
  }
  if (!seen.size) throw new Error(`stub(): could not resolve ${name}`);
}

// In-memory table.
const store = new Map();
const key = (pk, sk) => `${pk}|${sk}`;
const writes = []; // [{ PK, SK }] in order
const control = { failAuditPut: false };
class GetCommand { constructor(i) { this.input = i; this.type = 'get'; } }
class PutCommand { constructor(i) { this.input = i; this.type = 'put'; } }
class QueryCommand { constructor(i) { this.input = i; this.type = 'query'; } }
class DeleteCommand { constructor(i) { this.input = i; this.type = 'delete'; } }
class UpdateCommand { constructor(i) { this.input = i; this.type = 'update'; } }
class BatchWriteCommand { constructor(i) { this.input = i; this.type = 'batchWrite'; } }
class TransactWriteCommand { constructor(i) { this.input = i; this.type = 'transactWrite'; } }
const fakeDoc = {
  async send(cmd) {
    const i = cmd.input;
    if (cmd.type === 'get') return { Item: store.get(key(i.Key.PK, i.Key.SK)) };
    if (cmd.type === 'put') {
      if (control.failAuditPut && String(i.Item.PK).includes('AUDIT')) {
        const e = new Error('ProvisionedThroughputExceededException'); e.name = e.message; throw e;
      }
      store.set(key(i.Item.PK, i.Item.SK), i.Item);
      writes.push({ PK: i.Item.PK, SK: i.Item.SK });
      return {};
    }
    if (cmd.type === 'delete') { store.delete(key(i.Key.PK, i.Key.SK)); return {}; }
    if (cmd.type === 'update') return {};
    if (cmd.type === 'query') return { Items: [] };
    throw new Error('test harness: unsupported ' + cmd.type);
  },
};
stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => fakeDoc },
  GetCommand, PutCommand, QueryCommand, DeleteCommand, UpdateCommand, BatchWriteCommand, TransactWriteCommand,
});
const { makeKmsStub, installTestKeyLoader } = require('./helpers/tenant-crypto-stub');
stub('@aws-sdk/client-kms', makeKmsStub().exports);
installTestKeyLoader();

// Bedrock: one fake client. The command class keeps its input like the SDK's.
class InvokeModelCommand { constructor(input) { this.input = input; } }
let bedrockCalls = [];
let bedrockAnswer = null; // (input) => response body object
const bedrockText = (text) => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } });
const fakeBedrock = {
  async send(cmd) {
    bedrockCalls.push(cmd);
    const body = bedrockAnswer ? bedrockAnswer(cmd.input) : bedrockText('bedrock said this');
    return { body: new TextEncoder().encode(JSON.stringify(body)) };
  },
};
stub('@aws-sdk/client-bedrock-runtime', {
  BedrockRuntimeClient: class { send(cmd) { return fakeBedrock.send(cmd); } },
  InvokeModelCommand,
  ApplyGuardrailCommand: class { constructor(i) { this.input = i; } },
});

// ---- environment -----------------------------------------------------------------
const JWT = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhcm4ifQ.SIGNATURE-JWT-SECRET';
const ACCESS = 'sk-ant-oat01-ACCESS-TOKEN-SECRET';
const AWS_SECRET = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
process.env.TABLE_NAME = 'test-table';
process.env.TENANT_KMS_KEY_ID = 'alias/test-tenant-key';
process.env.AWS_REGION = 'us-east-1';
process.env.ACCOUNT_ID = '111122223333';
process.env.AWS_ACCESS_KEY_ID = 'AKIDEXAMPLE';
process.env.AWS_SECRET_ACCESS_KEY = AWS_SECRET;
process.env.AWS_SESSION_TOKEN = 'FQoGZXIvYXdzEXAMPLETOKEN';
const WIF = {
  ANTHROPIC_FEDERATION_RULE_ID: 'fdrl_01TEST',
  ANTHROPIC_ORGANIZATION_ID: '3f6c0a1e-0000-4000-8000-000000000001',
  ANTHROPIC_SERVICE_ACCOUNT_ID: 'svac_01TEST',
  ANTHROPIC_WORKSPACE_ID: 'wrkspc_01TEST',
};
const connect = () => Object.assign(process.env, WIF);
const disconnect = () => { delete process.env.ANTHROPIC_FEDERATION_RULE_ID; };
connect();

const COPIES = {
  route: [path.join(LF, 'game/claude-route.js'), path.join(LF, 'admin/shared/claude-route.js')],
  client: [path.join(LF, 'game/anthropic-messages.js'), path.join(LF, 'admin/shared/anthropic-messages.js')],
};
const routes = COPIES.route.map((p) => require(p));
const clients = COPIES.client.map((p) => require(p));
const route = routes[0];

// ---- the fake transport, on both client copies ----------------------------------
let apiCalls = []; let stsCalls = []; let exchangeCalls = [];
let apiAnswer = null; let stsAnswer = null; let exchangeAnswer = null;
const stsOk = () => ({ status: 200, body: `<R><GetWebIdentityTokenResult><WebIdentityToken>${JWT}</WebIdentityToken></GetWebIdentityTokenResult></R>` });
const exchangeOk = () => ({ status: 200, body: JSON.stringify({ access_token: ACCESS, expires_in: 600 }) });
const transport = async (req) => {
  if (req.host === 'sts.us-east-1.amazonaws.com') { stsCalls.push(req); return (stsAnswer || stsOk)(req); }
  if (req.path === '/v1/oauth/token') { exchangeCalls.push(req); return (exchangeAnswer || exchangeOk)(req); }
  if (req.path === '/v1/messages') {
    const body = JSON.parse(req.body);
    apiCalls.push({ body, headers: req.headers });
    if (!apiAnswer) throw new Error('no API answer queued');
    return apiAnswer(body);
  }
  throw new Error('unexpected host ' + req.host);
};
for (const c of clients) c._setTransport(transport);

const apiReply = (content, extra = {}) => () => ({
  status: 200,
  body: JSON.stringify({
    id: 'msg_1', type: 'message', role: 'assistant', model: 'x',
    content, stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 20 }, ...extra,
  }),
});
const apiText = (text, extra) => apiReply([{ type: 'thinking', thinking: '' }, { type: 'text', text }], extra);
const apiStatus = (status, type, message = 'nope') => () => ({ status, body: JSON.stringify({ type: 'error', error: { type, message } }) });

// The setting, on both route copies.
let settingRow = null; let settingReads = 0; let settingThrows = false;
const reader = async () => {
  settingReads++;
  if (settingThrows) { const e = new Error('boom'); e.name = 'ThrottlingException'; throw e; }
  return settingRow;
};
for (const r of routes) r._setSettingReader(reader);
let now = 1_000_000;
for (const r of routes) r._setClock(() => now);

function reset({ on = true } = {}) {
  apiCalls = []; stsCalls = []; exchangeCalls = []; bedrockCalls = [];
  apiAnswer = null; stsAnswer = null; exchangeAnswer = null; bedrockAnswer = null;
  settingRow = on ? null : { PK: 'PLATFORM#SETTINGS', SK: 'CLAUDE_MODELS', Anthropic55: false };
  settingReads = 0; settingThrows = false;
  for (const r of routes) r._resetSettingCache();
  for (const c of clients) c._resetTokenCache();
  connect();
}

// ---- logs ------------------------------------------------------------------------
const FORMAT = { depth: Infinity, maxArrayLength: Infinity, maxStringLength: Infinity, breakLength: Infinity };
let logLines = [];
const quiet = !process.env.DEBUG;
for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
  const orig = console[level];
  console[level] = (...args) => { logLines.push(util.formatWithOptions(FORMAT, ...args)); if (!quiet) orig(...args); };
}
const say = (...a) => process.stdout.write(a.join(' ') + '\n');
let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); say(`  PASS  ${label}`); pass++; } catch (e) { say(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}
const fallbackLogs = () => logLines.filter((l) => l.includes('"claude-route-fallback"')).map((l) => JSON.parse(l));

const HAIKU_ARN = 'arn:aws:bedrock:us-east-1:111122223333:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0';
const SONNET_ARN = 'arn:aws:bedrock:us-east-1:111122223333:inference-profile/us.anthropic.claude-sonnet-4-6';
const OPUS_ARN = 'arn:aws:bedrock:us-east-1:111122223333:inference-profile/us.anthropic.claude-opus-4-6-v1';
const PROMPT_SECRET = 'PLAYER-ANSWER-Lena-pilots-first';
const cmd = (modelId, body) => new InvokeModelCommand({ modelId, body: JSON.stringify(body) });
const decode = (res) => JSON.parse(new TextDecoder().decode(res.body));

(async () => {
  // ------------------------------------------------------------------------------
  say('\n1. the copies');
  await check('claude-route.js: game/ and admin/shared/ are byte-identical', () => {
    assert.strictEqual(fs.readFileSync(COPIES.route[0], 'utf8'), fs.readFileSync(COPIES.route[1], 'utf8'));
  });
  await check('anthropic-messages.js: game/ and admin/shared/ are byte-identical', () => {
    assert.strictEqual(fs.readFileSync(COPIES.client[0], 'utf8'), fs.readFileSync(COPIES.client[1], 'utf8'));
  });
  await check('the direct switch: Haiku 4.5 -> Haiku 5.5, Sonnet 4.6 -> Sonnet 5.5, nothing else', () => {
    assert.strictEqual(route.apiModelFor(HAIKU_ARN), 'claude-haiku-5-5');
    assert.strictEqual(route.apiModelFor(SONNET_ARN), 'claude-sonnet-5-5');
    assert.strictEqual(route.apiModelFor('us.anthropic.claude-haiku-4-5-20251001-v1:0'), 'claude-haiku-5-5');
    assert.strictEqual(route.apiModelFor(OPUS_ARN), null);
    assert.strictEqual(route.apiModelFor('us.anthropic.claude-sonnet-4-5'), null);
    assert.deepStrictEqual(Object.values(route.MODEL_MAP).sort(), ['claude-haiku-5-5', 'claude-sonnet-5-5']);
  });

  // ------------------------------------------------------------------------------
  say('\n2. switch off, or not connected: Bedrock, with the command as given');
  const body = { anthropic_version: 'bedrock-2023-05-31', max_tokens: 160, temperature: 0.2, messages: [{ role: 'user', content: PROMPT_SECRET }] };
  for (const [label, prep] of [
    ['the setting off', () => reset({ on: false })],
    ['an id missing (not connected)', () => { reset(); disconnect(); }],
  ]) {
    prep();
    const c = cmd(HAIKU_ARN, body);
    const res = await route.send(fakeBedrock, c, { site: 'test' });
    await check(`${label}: bedrock.send gets the very command object, no API, no STS`, () => {
      assert.strictEqual(bedrockCalls.length, 1);
      assert.strictEqual(bedrockCalls[0], c);
      assert.strictEqual(apiCalls.length + stsCalls.length + exchangeCalls.length, 0);
      assert.strictEqual(route.servedBy(res), null);
    });
  }
  await check('not connected never reads the setting row', () => assert.strictEqual(settingReads, 0));
  reset();
  const opus = cmd(OPUS_ARN, body);
  await route.send(fakeBedrock, opus);
  await check('switch on: an Opus 4.6 call is untouched (Bedrock, same command, no STS)', () => {
    assert.strictEqual(bedrockCalls[0], opus);
    assert.strictEqual(apiCalls.length + stsCalls.length, 0);
  });

  /*
    EVERY CALL SITE'S REQUEST, AS HEAD BUILT IT. Each site's `new
    InvokeModelCommand({...})` argument is compared, as source text, with the
    same literal at HEAD: unchanged text builds an unchanged request, and with
    the switch off `send` passes that very command to Bedrock (above).
  */
  const SITES = [
    'lambda-functions/game/get-ai-summary.js',
    'lambda-functions/game/get-results.js',
    'lambda-functions/game/draft-briefing.js',
    'lambda-functions/admin/ai-generate-prompt.js',
    'lambda-functions/admin/ai-prompt-advisor.js',
    'lambda-functions/admin/shared/structured-generation.js',
    'lambda-functions/admin/shared/finding-explanations.js',
    'lambda-functions/admin/shared/topic-suggestion.js',
  ];
  const literals = (text) => {
    const out = [];
    let i = text.indexOf('new InvokeModelCommand(');
    while (i >= 0) {
      let depth = 0; let j = i + 'new InvokeModelCommand'.length;
      for (; j < text.length; j++) {
        if (text[j] === '(') depth++;
        if (text[j] === ')') { depth--; if (depth === 0) break; }
      }
      out.push(text.slice(i, j + 1));
      i = text.indexOf('new InvokeModelCommand(', j);
    }
    return out;
  };
  let head = true;
  try { execFileSync('git', ['cat-file', '-e', 'HEAD'], { cwd: REPO, stdio: 'ignore' }); } catch { head = false; }
  for (const site of SITES) {
    await check(`${path.basename(site)}: every InvokeModelCommand literal is HEAD's, and none is sent past the switch`, () => {
      const nowText = fs.readFileSync(path.join(REPO, site), 'utf8');
      const lits = literals(nowText);
      assert.ok(lits.length >= 1, 'no InvokeModelCommand found');
      if (head) {
        let before = null;
        try { before = execFileSync('git', ['show', `454145ab:${site}`], { cwd: REPO, encoding: 'utf8' }); } catch { before = null; }
        if (before !== null) assert.deepStrictEqual(lits, literals(before));
      }
      // Nothing calls Bedrock's send with a fresh InvokeModelCommand directly.
      assert.ok(!/\.send\(new InvokeModelCommand\(/.test(nowText), 'a direct bedrock.send(new InvokeModelCommand(...)) remains');
      assert.ok(/claudeRoute\.send\(/.test(nowText), 'does not go through claudeRoute.send');
    });
  }
  await check('no other file in lambda-functions calls a model past the switch', () => {
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
      if (d.name === 'node_modules') return [];
      const p = path.join(dir, d.name);
      return d.isDirectory() ? walk(p) : (p.endsWith('.js') ? [p] : []);
    });
    const offenders = walk(LF).filter((f) => /InvokeModelCommand/.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(REPO, f))
      .filter((f) => !SITES.includes(f)
        // They hand InvokeModelCommand to a site above; the switch names it in prose.
        && !/\/(check-question-set|ai-generate-scenarios|generation-handler|set-check-worker|claude-route)\.js$/.test(f));
    assert.deepStrictEqual(offenders, []);
  });

  // ------------------------------------------------------------------------------
  say('\n3. the setting');
  await check('absent row: on', async () => { reset(); settingRow = null; assert.strictEqual(await route.anthropic55On(), true); });
  await check('Anthropic55 false: off', async () => { reset({ on: false }); assert.strictEqual(await route.anthropic55On(), false); });
  await check('malformed row (a string): on', async () => {
    reset(); settingRow = { Anthropic55: 'false' }; assert.strictEqual(await route.anthropic55On(), true);
  });
  await check('unreadable at first: on; unreadable later keeps the last value', async () => {
    reset(); settingThrows = true;
    assert.strictEqual(await route.anthropic55On(), true);
    reset({ on: false });
    assert.strictEqual(await route.anthropic55On(), false);
    settingThrows = true; now += route.SETTING_CACHE_MS + 1;
    assert.strictEqual(await route.anthropic55On(), false);
  });
  await check('read once a minute per container', async () => {
    reset();
    await route.anthropic55On(); await route.anthropic55On(); now += 30000; await route.anthropic55On();
    assert.strictEqual(settingReads, 1);
    now += route.SETTING_CACHE_MS; await route.anthropic55On();
    assert.strictEqual(settingReads, 2);
  });

  // ------------------------------------------------------------------------------
  say('\n4. on: what the API is sent');
  const checkCommon = (b, model) => {
    assert.strictEqual(b.model, model);
    for (const f of ['temperature', 'top_p', 'top_k', 'anthropic_version']) assert.ok(!(f in b), `${f} sent`);
    assert.strictEqual(b.messages[b.messages.length - 1].role, 'user', 'ends on an assistant prefill');
    assert.ok(!b.messages.some((m) => m.role === 'assistant'), 'an assistant turn was sent');
    if (model === 'claude-haiku-5-5') assert.deepStrictEqual(b.thinking, { type: 'disabled' });
    else assert.deepStrictEqual(b.thinking, { type: 'between_tools' });
    assert.ok(['low', 'medium', 'high'].includes(b.output_config.effort), 'thinking off needs effort high or below');
    if (b.tool_choice) assert.ok(!['tool', 'any'].includes(b.tool_choice.type), 'forced tool_choice');
  };

  // draft-briefing: the prefill '{'
  const draft = require(path.join(LF, 'game/draft-briefing.js'));
  reset();
  apiAnswer = apiText('{"briefing":"Revenue rose 4% to $12m.","namesRemoved":0}');
  const dres = await draft.handler({ body: JSON.stringify({ text: 'Revenue rose 4% to $12m. ' + PROMPT_SECRET }) });
  await check('draft-briefing (Haiku): mapped, prefill replaced by words, reply used', () => {
    assert.strictEqual(dres.statusCode, 200, dres.body);
    assert.strictEqual(JSON.parse(dres.body).briefing, 'Revenue rose 4% to $12m.');
    assert.strictEqual(bedrockCalls.length, 0);
    const b = apiCalls[0].body;
    checkCommon(b, 'claude-haiku-5-5');
    assert.match(b.messages[0].content, /Begin your reply with exactly this text, and write nothing before it:\n\{$/);
    assert.strictEqual(b.max_tokens, Math.ceil(900 * 1.5) + 256);
    assert.strictEqual(b.output_config.effort, 'low');
    assert.strictEqual(apiCalls[0].headers.authorization, 'Bearer ' + ACCESS);
  });
  reset();
  apiAnswer = apiText('Here you go:\n{"briefing":"Costs fell.","namesRemoved":1}');
  const dres2 = await draft.handler({ body: JSON.stringify({ text: 'Costs fell.' }) });
  await check('draft-briefing: a short preamble before the prefill on its own line is dropped', () => {
    assert.strictEqual(dres2.statusCode, 200, dres2.body);
    assert.strictEqual(bedrockCalls.length, 0);
  });
  reset({ on: false });
  bedrockAnswer = () => bedrockText('"briefing":"Off path.","namesRemoved":0}');
  const dres3 = await draft.handler({ body: JSON.stringify({ text: 'Off path.' }) });
  await check('draft-briefing, switch off: today\'s Bedrock request byte for byte', () => {
    assert.strictEqual(dres3.statusCode, 200, dres3.body);
    assert.strictEqual(bedrockCalls.length, 1);
    const i = bedrockCalls[0].input;
    assert.strictEqual(i.modelId, HAIKU_ARN);
    const sent = JSON.parse(i.body);
    assert.strictEqual(i.body, JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31', max_tokens: 900, temperature: 0.2,
      messages: [{ role: 'user', content: sent.messages[0].content }, { role: 'assistant', content: '{' }],
    }));
  });

  // finding explanations + topic suggestion: Haiku, temperature 0.2 / 0
  const { explainFindings } = require(path.join(LF, 'admin/shared/finding-explanations.js'));
  const { suggestSetTopic } = require(path.join(LF, 'admin/shared/topic-suggestion.js'));
  const snapshot = {
    source: { setId: 's1' }, meta: { name: 'Pricing', topic: '' },
    questions: [{ SK: 'QUESTION#q1', Title: 'How do we price?', Detail: 'Two options.' }],
  };
  reset();
  apiAnswer = apiText('The word "fight" in the scenario was noted; the subject is pricing.');
  const explained = await explainFindings(fakeBedrock, InvokeModelCommand, snapshot,
    [{ questionId: 'q1', category: 'VIOLENCE', band: 'MEDIUM', outcome: 'held' }]);
  await check('finding explanation (Haiku): mapped, temperature dropped, effort low', () => {
    assert.strictEqual(apiCalls.length, 1, `api ${apiCalls.length}, bedrock ${bedrockCalls.length}`);
    checkCommon(apiCalls[0].body, 'claude-haiku-5-5');
    assert.strictEqual(bedrockCalls.length, 0);
    assert.ok(Array.isArray(explained));
  });
  reset();
  apiAnswer = apiText('{"topic":"business","tags":["pricing","strategy","sales"],"fits":true}');
  await suggestSetTopic(fakeBedrock, InvokeModelCommand, snapshot);
  await check('topic suggestion (Haiku): mapped, temperature 0 dropped', () => {
    assert.strictEqual(apiCalls.length, 1);
    checkCommon(apiCalls[0].body, 'claude-haiku-5-5');
    assert.strictEqual(bedrockCalls.length, 0);
  });

  // structured generation: Sonnet with a forced tool
  const SG = require(path.join(LF, 'admin/shared/structured-generation.js'));
  const tool = { name: SG.TOOL_NAME, description: 'Return items', input_schema: { type: 'object', properties: { items: { type: 'array' } }, required: ['items'] } };
  reset();
  apiAnswer = apiReply([{ type: 'text', text: 'Calling it.' }, { type: 'tool_use', id: 't1', name: SG.TOOL_NAME, input: { items: [{ a: 1 }] } }], { stop_reason: 'tool_use' });
  const items = await SG.invokeStructured(fakeBedrock, InvokeModelCommand, { prompt: 'Write one. ' + PROMPT_SECRET, tool, maxTokens: 4000 });
  await check('structured generation (Sonnet): forced tool becomes auto + a sentence, tool input returned', () => {
    assert.deepStrictEqual(items, { items: [{ a: 1 }] });
    const b = apiCalls[0].body;
    checkCommon(b, 'claude-sonnet-5-5');
    assert.deepStrictEqual(b.tool_choice, { type: 'auto' });
    assert.deepStrictEqual(b.tools, [tool]);
    assert.match(b.messages[0].content, new RegExp(`Answer by calling the ${SG.TOOL_NAME} tool\\.`));
    assert.strictEqual(bedrockCalls.length, 0);
  });
  reset();
  apiAnswer = apiText('I would rather describe them in prose.');
  bedrockAnswer = () => ({ content: [{ type: 'tool_use', id: 'b1', name: SG.TOOL_NAME, input: { items: ['bedrock'] } }], stop_reason: 'tool_use' });
  const items2 = await SG.invokeStructured(fakeBedrock, InvokeModelCommand, { prompt: 'Write one.', tool, maxTokens: 4000 });
  await check('structured generation: no tool call on the API path falls back to Bedrock Sonnet 4.6, forced as before', () => {
    assert.deepStrictEqual(items2, { items: ['bedrock'] });
    assert.strictEqual(bedrockCalls.length, 1);
    assert.strictEqual(bedrockCalls[0].input.modelId, SONNET_ARN);
    assert.deepStrictEqual(JSON.parse(bedrockCalls[0].input.body).tool_choice, { type: 'tool', name: SG.TOOL_NAME });
    assert.strictEqual(fallbackLogs()[0].reason, 'invalid-reply');
  });

  await check('toApiRequest: effort passes through when allowed, anything else is low', () => {
    const b = { max_tokens: 100, messages: [{ role: 'user', content: 'x' }] };
    assert.strictEqual(route.toApiRequest(JSON.stringify(b), 'claude-sonnet-5-5', { effort: 'medium' }).request.output_config.effort, 'medium');
    assert.strictEqual(route.toApiRequest(JSON.stringify(b), 'claude-sonnet-5-5', { effort: 'max' }).request.output_config.effort, 'low');
  });
  await check('toApiRequest: a block-array user turn gets the prefill instruction as a text block', () => {
    const b = { max_tokens: 100, messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }, { role: 'assistant', content: '##' }] };
    const r = route.toApiRequest(JSON.stringify(b), 'claude-haiku-5-5').request;
    assert.strictEqual(r.messages.length, 1);
    assert.strictEqual(r.messages[0].content[1].type, 'text');
    assert.match(r.messages[0].content[1].text, /^Begin your reply with exactly this text/);
  });
  await check('toApiRequest: max_tokens raised by half plus 256, capped at 32000', () => {
    const mk = (n) => route.toApiRequest(JSON.stringify({ max_tokens: n, messages: [{ role: 'user', content: 'x' }] }), 'claude-haiku-5-5').request.max_tokens;
    assert.strictEqual(mk(2048), 3328);
    assert.strictEqual(mk(16000), 24256);
    assert.strictEqual(mk(30000), 32000);
  });

  // ------------------------------------------------------------------------------
  say('\n5. every failure: the original Bedrock command, and one warning');
  const prefillBody = { anthropic_version: 'bedrock-2023-05-31', max_tokens: 200, temperature: 0.7,
    messages: [{ role: 'user', content: PROMPT_SECRET }, { role: 'assistant', content: '## Heading' }] };
  const FAILURES = [
    ['STS refuses', 'sts-error', () => { stsAnswer = () => ({ status: 403, body: '<Error/>' }); }],
    ['the token exchange refuses', 'token-exchange', () => { exchangeAnswer = () => ({ status: 400, body: '{"error":"invalid_grant"}' }); }],
    ['HTTP 500', 'api-error', () => { apiAnswer = apiStatus(500, 'api_error'); }],
    ['HTTP 429', 'rate-limit', () => { apiAnswer = apiStatus(429, 'rate_limit_error'); }],
    ['HTTP 529', 'overloaded', () => { apiAnswer = apiStatus(529, 'overloaded_error'); }],
    ['out of credit', 'credit', () => { apiAnswer = apiStatus(400, 'invalid_request_error', 'Your credit balance is too low'); }],
    ['a 400 (a rejected request shape)', 'api-error', () => { apiAnswer = apiStatus(400, 'invalid_request_error', 'tool_choice not supported'); }],
    ['a refusal', 'refusal', () => { apiAnswer = apiText('', { stop_reason: 'refusal' }); }],
    ['cut off at max_tokens', 'max-tokens', () => { apiAnswer = apiText('## Heading\nhalf', { stop_reason: 'max_tokens' }); }],
    ['an empty reply', 'empty-reply', () => { apiAnswer = apiReply([{ type: 'thinking', thinking: '' }]); }],
    ['a reply that skips the prefill', 'invalid-reply', () => { apiAnswer = apiText('Sure! Here is a summary of everything.'); }],
    ['the overall time budget', 'timeout', () => { apiAnswer = () => new Promise(() => {}); }, { timeoutMs: 40 }],
    ['a transport timeout', 'timeout', () => { apiAnswer = () => { throw new clients[0].ModelCallError('timeout'); }; }],
  ];
  for (const [label, reason, arrange, opts = {}] of FAILURES) {
    reset();
    logLines = [];
    arrange();
    const c = cmd(HAIKU_ARN, prefillBody);
    const res = await route.send(fakeBedrock, c, { site: 'test-site', ...opts });
    await check(`${label}: Bedrock Haiku 4.5 with the original command, reason "${reason}"`, () => {
      assert.strictEqual(bedrockCalls.length, 1);
      assert.strictEqual(bedrockCalls[0], c);
      assert.strictEqual(decode(res).content[0].text, 'bedrock said this');
      assert.strictEqual(route.servedBy(res), null);
      const w = fallbackLogs();
      assert.strictEqual(w.length, 1, logLines.join('\n'));
      assert.strictEqual(w[0].reason, reason);
      assert.strictEqual(w[0].site, 'test-site');
      assert.strictEqual(w[0].model, 'claude-haiku-5-5');
      assert.strictEqual(w[0].fallback, 'us.anthropic.claude-haiku-4-5-20251001-v1:0');
    });
    await check(`${label}: no token, secret or prompt text in any log line`, () => {
      const all = logLines.join('\n');
      for (const s of [JWT, ACCESS, AWS_SECRET, PROMPT_SECRET]) assert.ok(!all.includes(s), 'leaked ' + s.slice(0, 12));
    });
  }
  reset();
  logLines = [];
  apiAnswer = apiText('## Heading\nThe room agreed.');
  const ok = await route.send(fakeBedrock, cmd(HAIKU_ARN, prefillBody), { site: 'ok' });
  await check('success: the prefill is cut off the reply, the model is named, one info line, nothing secret', () => {
    assert.strictEqual(bedrockCalls.length, 0);
    assert.strictEqual(decode(ok).content[0].text, '\nThe room agreed.');
    assert.strictEqual(decode(ok).model, 'claude-haiku-5-5');
    assert.ok(!decode(ok).content.some((b) => b.type === 'thinking'));
    assert.strictEqual(route.servedBy(ok), 'claude-haiku-5-5');
    const all = logLines.join('\n');
    assert.ok(all.includes('"claude-route"'));
    for (const s of [JWT, ACCESS, AWS_SECRET, PROMPT_SECRET, 'The room agreed']) assert.ok(!all.includes(s));
  });

  // ------------------------------------------------------------------------------
  say('\n6. the route: staff only, default on, audited first');
  const authorizer = require(path.join(LF, 'auth/authorizer.js'));
  await check('authorizer: GET and POST platform/settings/claude-models are [admins]', () => {
    assert.deepStrictEqual(authorizer.requiredGroupsForRoute('GET', 'platform/settings/claude-models'), ['admins']);
    assert.deepStrictEqual(authorizer.requiredGroupsForRoute('POST', 'platform/settings/claude-models'), ['admins']);
  });
  const platformOrgs = require(path.join(LF, 'admin/orgs/platform-orgs.js')).handler;
  const SETTING = key('PLATFORM#SETTINGS', 'CLAUDE_MODELS');
  const evt = ({ method = 'GET', sub = 'u_staff', groups = 'admins,hosts', body } = {}) => ({
    rawPath: '/dev/platform/settings/claude-models',
    routeKey: `${method} /platform/settings/claude-models`,
    requestContext: { http: { method }, authorizer: { lambda: { userId: sub, email: `${sub}@x.test`, name: sub, groups } } },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const bodyOf = (r) => JSON.parse(r.body || '{}');
  const resetTable = () => { store.clear(); writes.length = 0; control.failAuditPut = false; connect(); };

  resetTable();
  await check('a host who is not staff: 403 on GET and POST, nothing written', async () => {
    assert.strictEqual((await platformOrgs(evt({ sub: 'u_host', groups: 'hosts' }))).statusCode, 403);
    assert.strictEqual((await platformOrgs(evt({ method: 'POST', sub: 'u_host', groups: 'hosts', body: { anthropic55: false } }))).statusCode, 403);
    assert.strictEqual(writes.length, 0);
  });
  await check('staff, no row: on, the default, connected, effective anthropic-5-5', async () => {
    const r = await platformOrgs(evt());
    assert.strictEqual(r.statusCode, 200);
    const v = bodyOf(r);
    assert.strictEqual(v.anthropic55, true);
    assert.strictEqual(v.isDefault, true);
    assert.strictEqual(v.connected, true);
    assert.strictEqual(v.effective, 'anthropic-5-5');
    assert.ok(!JSON.stringify(v).includes(WIF.ANTHROPIC_FEDERATION_RULE_ID), 'an id leaked');
  });
  await check('a body that is not a boolean: 400, nothing written', async () => {
    assert.strictEqual((await platformOrgs(evt({ method: 'POST', body: { anthropic55: 'no' } }))).statusCode, 400);
    assert.strictEqual(writes.length, 0);
  });
  await check('staff turns it off: the audit entry is written FIRST, then the row', async () => {
    const r = await platformOrgs(evt({ method: 'POST', body: { anthropic55: false } }));
    assert.strictEqual(r.statusCode, 200, r.body);
    assert.strictEqual(bodyOf(r).effective, 'bedrock-4');
    assert.strictEqual(writes.length, 2, JSON.stringify(writes));
    assert.strictEqual(writes[0].PK, 'PLATFORM#AUDIT');
    assert.deepStrictEqual(writes[1], { PK: 'PLATFORM#SETTINGS', SK: 'CLAUDE_MODELS' });
    const audit = store.get(key(writes[0].PK, writes[0].SK));
    assert.strictEqual(audit.Action, 'platform.claude-models');
    assert.strictEqual(audit.Actor.Sub, 'u_staff');
    assert.strictEqual(audit.Actor.Role, 'platform-admin');
    assert.deepStrictEqual(audit.Detail, { from: 'anthropic-5-5', to: 'bedrock-4' });
    const rowNow = store.get(SETTING);
    assert.strictEqual(rowNow.Anthropic55, false);
    assert.strictEqual(rowNow.UpdatedBy, 'u_staff');
    assert.strictEqual(route.settingFromItem(rowNow), false);
    assert.strictEqual(bodyOf(await platformOrgs(evt())).anthropic55, false);
  });
  await check('the audit entry cannot be written: 503 and the row is unchanged', async () => {
    control.failAuditPut = true;
    const r = await platformOrgs(evt({ method: 'POST', body: { anthropic55: true } }));
    assert.strictEqual(r.statusCode, 503);
    assert.strictEqual(store.get(SETTING).Anthropic55, false);
    control.failAuditPut = false;
  });
  resetTable();
  disconnect();
  await check('an id missing: GET says not connected (effective bedrock-4), POST is 409 and writes nothing', async () => {
    const v = bodyOf(await platformOrgs(evt()));
    assert.strictEqual(v.connected, false);
    assert.strictEqual(v.anthropic55, true);
    assert.strictEqual(v.effective, 'bedrock-4');
    const r = await platformOrgs(evt({ method: 'POST', body: { anthropic55: false } }));
    assert.strictEqual(r.statusCode, 409);
    assert.match(bodyOf(r).error, /Anthropic API not connected on this tier/);
    assert.strictEqual(writes.length, 0);
  });
  connect();

  // ------------------------------------------------------------------------------
  say('\n7. the template and the buildspecs');
  const template = fs.readFileSync(path.join(REPO, 'template-clean.yaml'), 'utf8');
  const functionBlocks = () => {
    const out = {};
    const re = /\n {2}([A-Za-z0-9]+):\n {4}Type: AWS::Serverless::Function\n/g;
    const starts = [];
    let m;
    while ((m = re.exec(template))) starts.push({ name: m[1], at: m.index });
    starts.forEach((s, i) => {
      const end = template.slice(s.at + 1).search(/\n {2}[A-Za-z0-9]+:\n {4}Type: /);
      out[s.name] = template.slice(s.at, end < 0 ? undefined : s.at + 1 + end);
    });
    return out;
  };
  const blocks = functionBlocks();
  const requiresOf = (file, seen = new Set()) => {
    if (seen.has(file)) return seen;
    seen.add(file);
    const text = fs.readFileSync(file, 'utf8');
    for (const r of text.matchAll(/require\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)) {
      let p = path.resolve(path.dirname(file), r[1]);
      if (!p.endsWith('.js')) p += '.js';
      if (fs.existsSync(p)) requiresOf(p, seen);
    }
    return seen;
  };
  const callsModel = (fnBlock) => {
    const code = /CodeUri: ([^\n]+)\n/.exec(fnBlock);
    const handler = /Handler: ([^\n]+)\.handler\n/.exec(fnBlock);
    if (!code || !handler) return false;
    const file = path.join(REPO, code[1].trim(), handler[1].trim() + '.js');
    if (!fs.existsSync(file)) return false;
    // A file that sends through the switch is a model call; claude-route.js
    // itself (whose constants the settings route reads) is not.
    return [...requiresOf(file)].some((f) => /claudeRoute\.send\(/.test(fs.readFileSync(f, 'utf8')));
  };
  const modelCallers = Object.keys(blocks).filter((n) => callsModel(blocks[n])).sort();
  const granted = Object.keys(blocks).filter((n) => /Action: sts:GetWebIdentityToken/.test(blocks[n])).sort();
  await check('the functions whose code calls a model (from the require graph): the thirteen expected', () => {
    assert.deepStrictEqual(modelCallers, [
      'AdminAIDraftBuilderFormFunction', 'AdminAIDraftSetMetadataFunction', 'AdminAIGeneratePollsFunction',
      'AdminAIGeneratePromptFunction', 'AdminAIGenerateQuestionsFunction', 'AdminAIGenerateScenariosFunction',
      'AdminAIGenerateSurveyFunction', 'AdminAIGenerateTriviaFunction', 'AdminAIPromptAdvisorFunction',
      'CheckQuestionSetFunction', 'DraftBriefingFunction', 'GetAISummaryFunction', 'GetResultsFunction',
    ]);
  });
  await check('sts:GetWebIdentityToken is granted to exactly those functions, and to no other', () => {
    assert.deepStrictEqual(granted, modelCallers);
  });
  await check('each grant is Allow only when all four ids are set, an explicit Deny otherwise', () => {
    for (const n of granted) {
      assert.match(blocks[n], /- Effect: !If \[AnthropicApiConfigured, Allow, Deny\]\n\s+Action: sts:GetWebIdentityToken\n\s+Resource: '\*'/, n);
    }
    const cond = /\n {2}AnthropicApiConfigured: !And\n((?: {4}- .*\n)+)/.exec(template);
    assert.ok(cond, 'no AnthropicApiConfigured condition');
    for (const p of ['AnthropicFederationRuleId', 'AnthropicOrganizationId', 'AnthropicServiceAccountId', 'AnthropicWorkspaceId']) {
      assert.ok(cond[1].includes(`- !Not [!Equals [!Ref ${p}, '']]`), p);
    }
    assert.ok(!/AiModelPickerOn/.test(template), 'the old picker-only condition survives');
  });
  await check('each model-calling function has the four federation ids in its environment', () => {
    for (const n of modelCallers) {
      for (const [v, p] of [['ANTHROPIC_FEDERATION_RULE_ID', 'AnthropicFederationRuleId'], ['ANTHROPIC_ORGANIZATION_ID', 'AnthropicOrganizationId'],
        ['ANTHROPIC_SERVICE_ACCOUNT_ID', 'AnthropicServiceAccountId'], ['ANTHROPIC_WORKSPACE_ID', 'AnthropicWorkspaceId']]) {
        assert.ok(blocks[n].includes(`${v}: !Ref ${p}`), `${n} ${v}`);
      }
    }
  });
  await check('the two functions with no table policy may read the setting row and nothing else', () => {
    for (const n of ['DraftBriefingFunction', 'AdminAIGeneratePromptFunction']) {
      assert.match(blocks[n], /Action: dynamodb:GetItem\n\s+Resource: !GetAtt GameTable\.Arn\n\s+Condition:\n\s+ForAllValues:StringEquals:\n\s+dynamodb:LeadingKeys: \['PLATFORM#SETTINGS'\]/, n);
    }
  });
  await check('the platform function: the two settings events, the ids to report `connected`, no sts', () => {
    const b = blocks.PlatformOrgsFunction;
    assert.match(b, /GetClaudeModelsSetting:\n\s+Type: HttpApi\n\s+Properties:\n\s+ApiId: !Ref RestApi\n\s+Path: \/platform\/settings\/claude-models\n\s+Method: GET\n\s+Auth:\n\s+Authorizer: CognitoAuthorizer/);
    assert.match(b, /SetClaudeModelsSetting:\n\s+Type: HttpApi\n\s+Properties:\n\s+ApiId: !Ref RestApi\n\s+Path: \/platform\/settings\/claude-models\n\s+Method: POST\n\s+Auth:\n\s+Authorizer: CognitoAuthorizer/);
    assert.ok(b.includes('ANTHROPIC_WORKSPACE_ID: !Ref AnthropicWorkspaceId'));
    assert.ok(!/Action: sts:/.test(b));
  });
  const spec = (tier) => fs.readFileSync(path.join(REPO, `buildspec-${tier}.yml`), 'utf8');
  await check('buildspec-test.yml: the picker on, test\'s three ids, the rule id empty until the owner makes it', () => {
    const s = spec('test');
    assert.match(s, /PARAM_OVERRIDES="\$PARAM_OVERRIDES AiModelPicker=true"/);
    assert.match(s, /# The federation rule id: set when the owner creates the test rule\.\n\s+- ANTHROPIC_FEDERATION_RULE_ID=""\n/);
    assert.match(s, /- ANTHROPIC_ORGANIZATION_ID="19cbae90-fa39-4d34-bd38-e24396c41df4"/);
    assert.match(s, /- ANTHROPIC_SERVICE_ACCOUNT_ID="svac_012zQiYAvkDEUJBXDX7uA5TS"/);
    assert.match(s, /- ANTHROPIC_WORKSPACE_ID="wrkspc_01Fxxn28qBVFs6uYyoccyngL"/);
    assert.ok(s.indexOf('AnthropicWorkspaceId=') < s.indexOf('Deploying to AWS...'), 'appended after the deploy');
    assert.ok(!/fdrl_/.test(s), 'a federation rule id (dev\'s?) is on test');
  });
  await check('buildspec-dev.yml keeps its four ids; buildspec-prod.yml is untouched by this work', () => {
    assert.match(spec('dev'), /- ANTHROPIC_FEDERATION_RULE_ID="fdrl_01Fgi2W7zco8f1k4HAPabtzn"/);
    assert.ok(!/AiModelPicker|Anthropic|ANTHROPIC/.test(spec('prod')));
    let diff = '';
    try { diff = execFileSync('git', ['diff', '454145ab', '--', 'buildspec-prod.yml'], { cwd: REPO, encoding: 'utf8' }); } catch { diff = ''; }
    assert.strictEqual(diff, '');
  });
  await check('no resource is added: the same top-level resources as HEAD', () => {
    const names = (text) => {
      const start = text.indexOf('\nResources:\n');
      const end = text.indexOf('\nOutputs:\n');
      return (text.slice(start, end > start ? end : undefined).match(/^ {2}[A-Za-z0-9]+:/gm) || []).sort();
    };
    let before;
    try { before = execFileSync('git', ['show', 'HEAD:template-clean.yaml'], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 << 20 }); } catch { before = null; }
    if (before === null) return;
    assert.deepStrictEqual(names(template), names(before));
  });

  say(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})();
