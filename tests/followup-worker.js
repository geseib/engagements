/**
 * THE FOLLOW-UP SUGGESTIONS IN THE READ'S WORKER (get-ai-summary.js +
 * followup-worker.js, docs/design/ca-followup-asks PLAN T7), driven through
 * exports.handler in worker mode with Bedrock faked — no model is called.
 *
 *   switch off            one model call (the read); no FOLLOWUP# row
 *   switch on             the read is stored and announced FIRST; then one
 *                         more call, with the tool; the SUGGESTED row sealed,
 *                         ForSummaryAt the read's GeneratedAt; followUpChanged
 *   the asks call throws  the worker still returns ok, nothing is retried,
 *                         the stored read is the one the read wrote, and the
 *                         room is told nothing failed
 *   a fallback read       no asks call; earlier suggestions for the round go
 *   not Call & Answer     nothing is called
 *   no time left          nothing is called; the row says why
 *   remake (host)         ?followUps=suggest: host-only, 404 while off, an
 *                         Event to this worker; the worker then makes the asks
 *                         from the STORED read and writes nothing else
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const { createTable, commands } = require('./helpers/followup-table');
const { makeKmsStub, installTestKeyLoader } = require('./helpers/tenant-crypto-stub');

const Module = require('module');
const stubs = new Map();
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (stubs.has(request)) return stubs.get(request);
  return realLoad.call(this, request, parent, isMain);
};
const stub = (name, exports) => stubs.set(name, exports);

const table = createTable({ pageSize: 50 });
stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', { DynamoDBDocumentClient: { from: () => table.doc }, ...commands });
stub('@aws-sdk/client-s3', { S3Client: class { async send() { return {}; } }, GetObjectCommand: class {} });
const invokes = [];
class InvokeCommand { constructor(i) { this.input = i; } }
stub('@aws-sdk/client-lambda', { LambdaClient: class { async send(cmd) { invokes.push(JSON.parse(Buffer.from(cmd.input.Payload).toString())); return {}; } }, InvokeCommand });
const frames = [];
class PostToConnectionCommand { constructor(i) { this.input = i; } }
stub('@aws-sdk/client-apigatewaymanagementapi', {
  ApiGatewayManagementApiClient: class { async send(cmd) { frames.push(JSON.parse(cmd.input.Data)); return {}; } },
  PostToConnectionCommand,
});
stub('@aws-sdk/client-kms', makeKmsStub().exports);

// ---- Bedrock: the read, and the asks call --------------------------------
const COMPLETION = '\n\nThe room put the easy fixes first.\n\n## Discussion Questions\n1. Who guards the hard tickets?\n\n## Next Steps\n- Pull the quick fixes into one sprint.';
let bedrockCalls = [];
let readMode = 'ok';      // 'ok' | 'throw'
let asksMode = 'ok';      // 'ok' | 'throw'
const ASKS = [
  { type: 'agree', statement: 'Prioritise the easy-fix tickets', answers: [1], why: 'Tests the top line.' },
  { type: 'agree', statement: 'Grace says one owner per ticket', answers: [2], why: '' },
];
class InvokeModelCommand { constructor(i) { this.input = i; } }
stub('@aws-sdk/client-bedrock-runtime', {
  BedrockRuntimeClient: class {
    async send(cmd) {
      const body = JSON.parse(cmd.input.body);
      bedrockCalls.push({ modelId: cmd.input.modelId, body });
      if (body.tools) {
        if (asksMode === 'throw') throw Object.assign(new Error('nope'), { name: 'ValidationException' });
        return { body: new TextEncoder().encode(JSON.stringify({ content: [{ type: 'tool_use', id: 't', name: 'suggest_follow_up_asks', input: { asks: ASKS } }], stop_reason: 'tool_use' })) };
      }
      if (readMode === 'throw') throw Object.assign(new Error('down'), { name: 'ServiceUnavailableException' });
      return { body: new TextEncoder().encode(JSON.stringify({ content: [{ text: COMPLETION }], stop_reason: 'end_turn' })) };
    }
  },
  InvokeModelCommand,
});

process.env.TABLE_NAME = 'test-table';
process.env.TENANT_KMS_KEY_ID = 'alias/engage-tenant';
process.env.WEBSOCKET_API_ENDPOINT = 'https://ws.test.invalid/dev';
process.env.ACCOUNT_ID = '123456789012';
process.env.AWS_LAMBDA_FUNCTION_NAME = 'engagedev-get-ai-summary';
installTestKeyLoader();

const C = require(path.join(REPO, 'lambda-functions/game/tenant-crypto.js'));
const { handler: getAiSummary } = require(path.join(REPO, 'lambda-functions/game/get-ai-summary.js'));
const { runFollowUpSuggestions } = require(path.join(REPO, 'lambda-functions/game/followup-worker.js'));

const logs = [];
if (!process.env.DEBUG) { console.log = (...a) => logs.push(a.join(' ')); console.warn = console.log; console.error = console.log; }
const say = (s) => process.stdout.write(s + '\n');
let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); say(`  PASS  ${label}`); pass++; }
  catch (e) { say(`  FAIL  ${label}\n        ${e.stack.split('\n').slice(0, 3).join('\n        ')}`); fail++; }
}

const ORG = 'org_acme';
const TEMPLATE = 'EVENT: {eventTitle}\nQ: {questionTitle}\nRESPONSES: {responsesText}\n'
  + '=== SUMMARY ===\nx\n=== DISCUSSION QUESTIONS ===\nQ1: x\n=== NEXT STEPS ===\nSTEP1: x';
const ANSWER_TEXTS = ['Prioritise the easy-fix tickets', 'One owner per ticket'];

async function seed(gameId, { gameType = 'call-and-answer' } = {}) {
  const PK = `GAME#${gameId}`;
  for (const row of table.prefix(PK, '')) table.remove(row.PK, row.SK);
  const meta = { PK, SK: 'METADATA', GameType: gameType, Title: 'Support review', HostName: 'Hopper', orgId: ORG, QuestionSetScope: 'org' };
  table.put(await C.encryptItem(ORG, 'session', meta));
  table.put({ PK, SK: 'STATE', State: 'RESULTS#001', CurrentQuestionId: '001' });
  table.put({ PK, SK: 'ROUND#001', QuestionNumber: '001', AuthorsRevealed: true });
  table.put({ PK, SK: 'CONNECTION#h', ConnectionId: 'h', ConnectionType: 'HOST' });
  table.put({ PK, SK: 'PLAYER#Ada', PlayerName: 'Ada' });
  table.put({ PK, SK: 'PLAYER#Grace', PlayerName: 'Grace' });
  for (const [i, name] of ['Ada', 'Grace'].entries()) {
    table.put(await C.encryptItem(ORG, 'answer', { PK, SK: `QUESTION#001#ANSWER#${name}`, PlayerName: name, Answer: ANSWER_TEXTS[i] }));
  }
  table.put(await C.encryptItem(ORG, 'vote', { PK, SK: 'QUESTION#001#VOTE#Grace', PlayerName: 'Grace', Votes: { 0: 1, 1: 2 } }));
  table.put({ PK: 'AIPROMPTS', SK: 'AIPROMPT#lessons-learned', s3Key: 'fake-key', template: TEMPLATE });
}

async function worker(gameId, extra = {}, context) {
  bedrockCalls = [];
  frames.length = 0;
  const puts = [];
  const from = table.log.length;
  let res;
  try {
    res = await getAiSummary({ __workerMode: true, gameId, questionId: '001', ...extra }, context);
  } catch (e) {
    res = { thrown: e.message };
  }
  for (const e of table.log.slice(from)) if (e.type === 'put') puts.push(e.input.Item);
  return { res, puts, read: table.get(`GAME#${gameId}`, 'QUESTION#001#AISummary'), suggested: table.get(`GAME#${gameId}`, 'FOLLOWUP#001#SUGGESTED') };
}

(async () => {
  say('\n1. switched off');
  delete process.env.FOLLOWUP_ASKS_ENABLED;
  await seed('5101');
  const off = await worker('5101');
  await check('the read is written, one model call, no follow-up row', () => {
    assert.strictEqual(off.res.ok, true, JSON.stringify(off.res));
    assert.strictEqual(bedrockCalls.length, 1);
    assert.ok(!bedrockCalls[0].body.tools);
    assert.deepStrictEqual(table.prefix('GAME#5101', 'FOLLOWUP#'), []);
    assert.ok(!frames.some((f) => f.type === 'followUpChanged'));
  });

  say('\n2. switched on');
  process.env.FOLLOWUP_ASKS_ENABLED = 'on';
  await seed('5102');
  const on = await worker('5102');
  await check('the read is stored and announced BEFORE the asks call', () => {
    assert.strictEqual(on.res.ok, true, JSON.stringify(on.res));
    assert.deepStrictEqual(frames.map((f) => f.type), ['aiSummaryReady', 'followUpChanged']);
    assert.strictEqual(bedrockCalls.length, 2);
    assert.ok(!bedrockCalls[0].body.tools, 'the read went second');
    assert.ok(bedrockCalls[1].body.tools);
  });
  await check('the asks call is Sonnet, with no prefill and the numbered answers, no name', () => {
    const c = bedrockCalls[1];
    assert.ok(c.modelId.endsWith('inference-profile/us.anthropic.claude-sonnet-4-6'));
    assert.strictEqual(c.body.messages.length, 1);
    const p = c.body.messages[0].content;
    assert.ok(p.includes('1. (3 vote points) "Prioritise the easy-fix tickets"'), p.slice(p.indexOf('numbered'), p.indexOf('numbered') + 300));
    assert.ok(p.includes('2. (2 vote points) "One owner per ticket"'));
    assert.ok(!/\bAda\b|\bGrace\b/.test(p.slice(p.indexOf('Every answer, numbered'), p.indexOf('The read the room just heard'))));
  });
  await check('the SUGGESTED row: sealed, ForSummaryAt the read\'s GeneratedAt, the named ask dropped', async () => {
    assert.ok(C.isEnvelope(on.suggested.Asks));
    assert.strictEqual(on.suggested.ForSummaryAt, on.read.GeneratedAt);
    const opened = await C.decryptItem(ORG, 'followup', on.suggested);
    assert.deepStrictEqual(opened.Asks.map((a) => a.statement), ['Prioritise the easy-fix tickets']);
    assert.deepStrictEqual(opened.DropReasons, { names: 1 });
    assert.strictEqual(opened.Model, 'us.anthropic.claude-sonnet-4-6');
  });
  await check('the read row itself is exactly what the read wrote', () => {
    const readPuts = on.puts.filter((i) => i.SK === 'QUESTION#001#AISummary');
    assert.strictEqual(readPuts.length, 1);
    assert.deepStrictEqual(on.read, readPuts[0]);
  });

  say('\n3. the asks call fails');
  asksMode = 'throw';
  await seed('5103');
  const broken = await worker('5103');
  await check('the worker returns ok and throws nothing (so Lambda never retries the read)', () => {
    assert.strictEqual(broken.res.ok, true, JSON.stringify(broken.res));
    assert.ok(!('thrown' in broken.res));
  });
  await check('the stored read is the one the read wrote, written once', () => {
    const readPuts = broken.puts.filter((i) => i.SK === 'QUESTION#001#AISummary');
    assert.strictEqual(readPuts.length, 1);
    assert.deepStrictEqual(broken.read, readPuts[0]);
  });
  await check('nobody is told anything failed; the row records why', async () => {
    assert.ok(!frames.some((f) => /Error/.test(f.type)));
    const opened = await C.decryptItem(ORG, 'followup', broken.suggested);
    assert.strictEqual(opened.Reason, 'model-error');
    assert.deepStrictEqual(opened.Asks, []);
  });
  await check('a store that fails too still never throws out of the worker', async () => {
    const r = await runFollowUpSuggestions({
      db: { send: async () => { throw new Error('dynamo down'); } }, gameId: '5103', round: '001', orgId: ORG,
      aiData: { gameType: 'call-and-answer', answers: [{ answer: 'x' }], results: { voteTallies: {} } },
      read: { markdownResponse: '## x', fallback: false }, broadcast: async () => {}, send: async () => { throw new Error('x'); },
    });
    assert.deepStrictEqual(r, { ran: false, reason: 'error' });
  });
  asksMode = 'ok';

  say('\n4. a fallback read');
  readMode = 'throw';
  await seed('5104');
  await C.encryptItem(ORG, 'followup', {}); // warm the key
  table.put({ PK: 'GAME#5104', SK: 'FOLLOWUP#001#SUGGESTED', Asks: [], QuestionNumber: '001' });
  const fb = await worker('5104');
  await check('the template read is stored; no asks call; the old suggestions are gone', () => {
    assert.strictEqual(fb.res.ok, true, JSON.stringify(fb.res));
    assert.strictEqual(fb.read.Fallback, true);
    assert.ok(!bedrockCalls.some((c) => c.body.tools));
    assert.strictEqual(fb.suggested, undefined);
  });
  readMode = 'ok';

  say('\n5. the gates');
  const sendSpy = { n: 0 };
  const spy = async () => { sendSpy.n++; throw new Error('should not be called'); };
  const base = {
    db: table.doc, gameId: '5105', round: '001', orgId: ORG, broadcast: async () => {}, send: spy,
    aiData: { gameType: 'call-and-answer', answers: [{ answer: 'x', playerName: 'A' }], results: { voteTallies: { 0: { totalScore: 1 } } } },
    read: { markdownResponse: '## x', fallback: false, generatedAt: 'g' },
  };
  await check('a poll, trivia or survey session: nothing called', async () => {
    for (const t of ['poll', 'trivia', 'survey', 'wavelength']) {
      const r = await runFollowUpSuggestions({ ...base, aiData: { ...base.aiData, gameType: t } });
      assert.strictEqual(r.reason, 'not-call-and-answer', t);
    }
    assert.strictEqual(sendSpy.n, 0);
  });
  await check('the switch off: nothing called', async () => {
    delete process.env.FOLLOWUP_ASKS_ENABLED;
    assert.strictEqual((await runFollowUpSuggestions(base)).reason, 'off');
    process.env.FOLLOWUP_ASKS_ENABLED = 'on';
    assert.strictEqual(sendSpy.n, 0);
  });
  await check('too little time left in the function: nothing called, the row says no-time', async () => {
    const r = await runFollowUpSuggestions({ ...base, context: { getRemainingTimeInMillis: () => 30000 } });
    assert.strictEqual(r.reason, 'no-time');
    assert.strictEqual(sendSpy.n, 0);
    const opened = await C.decryptItem(ORG, 'followup', table.get('GAME#5105', 'FOLLOWUP#001#SUGGESTED'));
    assert.strictEqual(opened.Reason, 'no-time');
  });
  await check('with time, the call gets a deadline inside it', async () => {
    let deadlineSeen = null;
    const realSetTimeout = global.setTimeout;
    global.setTimeout = (fn, ms, ...rest) => { if (ms > 1000) deadlineSeen = ms; return realSetTimeout(fn, ms, ...rest); };
    try {
      await runFollowUpSuggestions({ ...base, send: async () => ({ body: new TextEncoder().encode('{}') }), context: { getRemainingTimeInMillis: () => 200000 } });
    } finally { global.setTimeout = realSetTimeout; }
    assert.strictEqual(deadlineSeen, 180000);
  });

  say('\n6. the host remakes them');
  await seed('5106');
  await worker('5106');
  const route = async (routeKey, query, authorizer) => {
    invokes.length = 0;
    const res = await getAiSummary({
      routeKey, pathParameters: { gameId: '5106' }, queryStringParameters: { questionId: '001', ...query },
      requestContext: { routeKey, ...(authorizer ? { authorizer } : {}) },
    });
    return { status: res.statusCode, body: JSON.parse(res.body) };
  };
  const HOST = { lambda: { userId: 'u', groups: 'hosts', orgId: ORG, orgIds: ORG } };
  await check('the public route refuses it', async () => {
    const r = await route('GET /games/{gameId}/ai-summary', { followUps: 'suggest' });
    assert.strictEqual(r.status, 403);
    assert.strictEqual(invokes.length, 0);
  });
  await check('a rival org\'s host: 404', async () => {
    const r = await route('GET /games/{gameId}/ai-summary/host', { followUps: 'suggest' }, { lambda: { userId: 'r', groups: 'hosts', orgId: 'org_x', orgIds: 'org_x' } });
    assert.strictEqual(r.status, 404);
    assert.strictEqual(invokes.length, 0);
  });
  await check('switched off: 404, nothing started', async () => {
    delete process.env.FOLLOWUP_ASKS_ENABLED;
    const r = await route('GET /games/{gameId}/ai-summary/host', { followUps: 'suggest' }, HOST);
    process.env.FOLLOWUP_ASKS_ENABLED = 'on';
    assert.strictEqual(r.status, 404);
    assert.strictEqual(invokes.length, 0);
  });
  await check('the session\'s host: 202 and one Event to the worker, follow-ups only', async () => {
    const r = await route('GET /games/{gameId}/ai-summary/host', { followUps: 'suggest' }, HOST);
    assert.strictEqual(r.status, 202, JSON.stringify(r.body));
    assert.deepStrictEqual(invokes, [{ __workerMode: true, followUpsOnly: true, gameId: '5106', questionId: '001', paddedQuestionNumber: '001' }]);
  });
  await check('the worker makes them from the stored read, and writes nothing else', async () => {
    const readBefore = table.get('GAME#5106', 'QUESTION#001#AISummary');
    const run = await worker('5106', { followUpsOnly: true });
    assert.strictEqual(run.res.ok, true, JSON.stringify(run.res));
    assert.strictEqual(bedrockCalls.length, 1);
    assert.ok(bedrockCalls[0].body.tools);
    assert.ok(bedrockCalls[0].body.messages[0].content.includes('The room put the easy fixes first.'));
    assert.deepStrictEqual(run.puts.map((i) => i.SK), ['FOLLOWUP#001#SUGGESTED']);
    assert.deepStrictEqual(table.get('GAME#5106', 'QUESTION#001#AISummary'), readBefore);
    assert.strictEqual(run.suggested.ForSummaryAt, readBefore.GeneratedAt);
    assert.deepStrictEqual(frames.map((f) => f.type), ['followUpChanged']);
  });
  await check('with no stored read it does nothing and throws nothing', async () => {
    table.remove('GAME#5106', 'QUESTION#001#AISummary');
    const run = await worker('5106', { followUpsOnly: true });
    assert.strictEqual(run.res.followUps, 'no-read');
    assert.strictEqual(bedrockCalls.length, 0);
  });
  await check('an error before it begins is not reported to the room as a failed read', async () => {
    const run = await worker('9999', { followUpsOnly: true });
    assert.ok(!('thrown' in run.res));
    assert.ok(!frames.some((f) => f.type === 'aiSummaryError'));
  });

  say('\n7. the logs');
  await check('no answer text, statement or name from the follow-up path', () => {
    const mine = logs.filter((l) => l.includes('followup'));
    assert.ok(mine.length > 0);
    for (const l of mine) for (const bit of [...ANSWER_TEXTS, 'Grace says']) assert.ok(!l.includes(bit), l);
  });

  say(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})().catch((e) => { say(`CRASH ${e.stack}`); process.exit(1); });
