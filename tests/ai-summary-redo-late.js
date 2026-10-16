/**
 * REDO INCLUDES THE LATE ANSWERS, AND SAYS SO (session flow v3 §4.4, owner Q5;
 * late items plan Task 5).
 *
 * "Late answers are listed beside the read, not in it. Redo includes them and
 * says so." A late round answer is its own row (QUESTION#nnn#LATE#<player>),
 * outside the ANSWER# prefix the read is built from, so an ordinary read never
 * sees it. When the host presses Redo (GET /ai-summary/host?generateNew=true
 * &redo=true) the worker is told `includeLate`, reads those rows, gives them
 * to Workie as their own block (never in the ranked responses, never voted,
 * never scored), and the read ends with "Includes N answers that arrived late."
 *
 * Drives the REAL handler (worker and HTTP dispatcher) against a stubbed
 * table, KMS and Bedrock, like tests/ai-summary-briefing.js.
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

/** A GetCommand with a ProjectionExpression returns only those attributes. */
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
      case 'query': {
        // `:isDefault` is findDefaultPromptId's filter on the AIPROMPTS partition.
        const v = inp.ExpressionAttributeValues || {};
        const items = [...store.values()].filter((i) =>
          i.PK === v[':pk'] && String(i.SK).startsWith(String(v[':sk'] ?? ''))
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

// A bodyless S3 object makes fetchPromptFromS3 fall back to the DynamoDB
// record's own `template` — the same route tests/anonymous-round-flow.js uses.
const noopClient = class { async send() { return {}; } };
stub('@aws-sdk/client-s3', { S3Client: noopClient, GetObjectCommand: class {} });
// The HTTP route dispatches the worker; record what it was asked to do.
const invoked = [];
class InvokeCommand { constructor(i) { this.input = i; } }
stub('@aws-sdk/client-lambda', {
  LambdaClient: class { async send(cmd) { invoked.push(JSON.parse(Buffer.from(cmd.input.Payload).toString('utf8'))); return {}; } },
  InvokeCommand,
});
stub('@aws-sdk/client-apigatewaymanagementapi', {
  ApiGatewayManagementApiClient: noopClient, PostToConnectionCommand: class {},
});

// ---- Bedrock: record what Workie was told, and answer ------------------------
// A real reply, so the summary row is written from the model path — the only
// path on which a briefing can have been used.
let bedrockBodies = [];
const COMPLETION = '\n\nThe room put the easy fixes first, the classic quick-win play, and the brief puts MTTR at 3 weeks.'
  + '\n\n## Discussion Questions\n1. Who guards the hard tickets?\n\n## Next Steps\n- Pull the quick fixes into one sprint.';
class InvokeModelCommand { constructor(i) { this.input = i; } }
stub('@aws-sdk/client-bedrock-runtime', {
  BedrockRuntimeClient: class {
    async send(cmd) {
      bedrockBodies.push(JSON.parse(cmd.input.body));
      return { body: new TextEncoder().encode(JSON.stringify({ content: [{ text: COMPLETION }], stop_reason: 'end_turn' })) };
    }
  },
  InvokeModelCommand,
});

// ---- a KMS that behaves the way the key policy will ------------------------
const nodeCrypto = require('crypto');
class GenerateDataKeyCommand { constructor(i) { this.input = i; } }
class DecryptCommand { constructor(i) { this.input = i; } }
const wrap = (orgId, k) => Buffer.from(JSON.stringify({ orgId, key: k.toString('base64') }), 'utf8');
stub('@aws-sdk/client-kms', {
  KMSClient: class {
    async send(command) {
      if (command instanceof GenerateDataKeyCommand) {
        const orgId = command.input.EncryptionContext?.orgId;
        assert.ok(orgId, 'GenerateDataKey must bind an orgId');
        const k = nodeCrypto.randomBytes(32);
        return { Plaintext: k, CiphertextBlob: wrap(orgId, k) };
      }
      if (command instanceof DecryptCommand) {
        const ctx = command.input.EncryptionContext?.orgId;
        if (!ctx) throw new Error('AccessDeniedException: no orgId in encryption context');
        const blob = JSON.parse(Buffer.from(command.input.CiphertextBlob).toString('utf8'));
        if (blob.orgId !== ctx) throw new Error('InvalidCiphertextException: encryption context mismatch');
        return { Plaintext: Buffer.from(blob.key, 'base64') };
      }
      throw new Error('unexpected KMS command');
    }
  },
  GenerateDataKeyCommand,
  DecryptCommand,
});

process.env.TABLE_NAME = 'test-table';
process.env.TENANT_KMS_KEY_ID = 'alias/engage-tenant';
process.env.WEBSOCKET_API_ENDPOINT = 'https://ws.test.invalid/dev';

const crypto = require(path.join(REPO, 'lambda-functions/game/tenant-crypto.js'));
const { handler: getAiSummary } = require(path.join(REPO, 'lambda-functions/game/get-ai-summary.js'));

if (!process.env.DEBUG) { console.log = () => {}; console.warn = () => {}; console.error = () => {}; }
const say = (...a) => process.stdout.write(a.join(' ') + '\n');

let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); say(`  PASS  ${label}`); pass++; }
  catch (e) { say(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const isEnvelope = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
  && typeof v.v === 'number' && typeof v.iv === 'string'
  && typeof v.tag === 'string' && typeof v.ct === 'string';


// ---- the session ------------------------------------------------------------
const ORG = 'org_acme';
const HOST = { lambda: { userId: 'u-host', groups: 'hosts', orgId: ORG, orgIds: ORG } };
const TEMPLATE =
  'EVENT: {eventTitle}\n' +
  'Q: {questionTitle}\n' +
  'RESPONSES: {responsesText}\n' +
  '=== SUMMARY ===\nx\n=== DISCUSSION QUESTIONS ===\nQ1: x\n=== NEXT STEPS ===\nSTEP1: x';

async function mintOrg(orgId) {
  const blob = await crypto.createOrgDataKey(orgId);
  put({ PK: `ORG#${orgId}`, SK: 'METADATA', orgId, dataKeyCiphertext: blob });
  crypto.forgetOrg(orgId);
}

/** One round at RESULTS: two on-time answers, one vote, one late answer (Zed). */
async function seedRound(gameId, { revealed = true } = {}) {
  put(await crypto.encryptItem(ORG, 'session', {
    PK: `GAME#${gameId}`, SK: 'METADATA', GameType: 'call-and-answer', Title: 'Ops review', HostName: 'Host',
    Details: '', AIContext: '', orgId: ORG, QuestionSetScope: 'org',
  }));
  put({ PK: `GAME#${gameId}`, SK: 'STATE', State: 'RESULTS#001', CurrentQuestionId: '001' });
  put({ PK: `GAME#${gameId}`, SK: 'ROUND#001', QuestionNumber: '001', AuthorsRevealed: revealed });
  const rows = [
    ['answer', { PK: `GAME#${gameId}`, SK: 'QUESTION#001#ANSWER#Ada', PlayerName: 'Ada', Answer: 'Prioritise the easy-fix tickets' }],
    ['answer', { PK: `GAME#${gameId}`, SK: 'QUESTION#001#ANSWER#Grace', PlayerName: 'Grace', Answer: 'One owner per ticket' }],
    ['vote', { PK: `GAME#${gameId}`, SK: 'QUESTION#001#VOTE#Ada', PlayerName: 'Ada', Votes: { 1: 1 } }],
    ['answer', {
      PK: `GAME#${gameId}`, SK: 'QUESTION#001#LATE#Zed', PlayerName: 'Zed', QuestionNumber: '001',
      Answer: 'Close the stale tickets first', AnswerType: 'standard', ArrivedDuring: 'VOTE#001',
      SubmittedAt: '2026-10-16T09:01:00.000Z',
    }],
  ];
  for (const [entity, row] of rows) put(await crypto.encryptItem(ORG, entity, row));
  put({ PK: 'AIPROMPTS', SK: 'AIPROMPT#lessons-learned', s3Key: 'fake-key', template: TEMPLATE });
}

const snapshot = (gameId) => JSON.stringify([...store.entries()]
  .filter(([k]) => k.startsWith(`GAME#${gameId}|`) && !k.includes('#AISummary') && !k.includes('SUMMARYJOB'))
  .sort());

async function runWorker(gameId, extra = {}) {
  bedrockBodies = [];
  let res;
  try {
    res = await getAiSummary({ __workerMode: true, gameId, questionId: '001', ...extra });
  } catch (e) {
    res = { error: e.message };
  }
  const prompt = bedrockBodies.length ? bedrockBodies[0].messages[0].content : '';
  const raw = store.get(key(`GAME#${gameId}`, 'QUESTION#001#AISummary'));
  const stored = raw ? await crypto.decryptItem(ORG, 'aiSummary', raw) : null;
  return { res, prompt, stored };
}

(async () => {
  await mintOrg(ORG);

  say('\n1. Redo: the worker is told to include the late answers');
  await seedRound('5201');
  const before = snapshot('5201');
  const redo = await runWorker('5201', { includeLate: true });
  await check('the worker completed', () => assert.strictEqual(redo.res && redo.res.ok, true, JSON.stringify(redo.res)));
  await check('the late answer reaches Workie, in its own block, with its author (the round showed names)', () => {
    assert.ok(redo.prompt.includes('ANSWERS THAT ARRIVED LATE'), 'no late block');
    const block = redo.prompt.slice(redo.prompt.indexOf('ANSWERS THAT ARRIVED LATE'));
    assert.ok(block.includes('Close the stale tickets first'), 'the late answer is not in the block');
    assert.ok(block.includes('Zed'), 'the author is not in the block');
  });
  await check('it is not among the ranked responses', () => {
    const line = redo.prompt.split('\n').find((l) => l.startsWith('RESPONSES:')) || '';
    assert.ok(line.includes('One owner per ticket'), `responses line: ${line}`);
    assert.ok(!line.includes('Close the stale tickets first'), 'the late answer was ranked with the rest');
  });
  await check('the read says so, on its last line', () => {
    assert.ok(redo.stored, 'no AISummary row');
    assert.strictEqual(redo.stored.LateAnswersIncluded, 1);
    assert.ok(String(redo.stored.MarkdownResponse).trimEnd().endsWith('Includes 1 answer that arrived late.'),
      `the read ends: ${String(redo.stored.MarkdownResponse).slice(-80)}`);
  });
  await check('no vote, score, answer or late row changed', () => assert.strictEqual(snapshot('5201'), before));

  say('\n2. an ordinary read (not a Redo)');
  await seedRound('5202');
  const plain = await runWorker('5202');
  await check('the worker completed', () => assert.strictEqual(plain.res && plain.res.ok, true, JSON.stringify(plain.res)));
  await check('the late answer never reaches Workie', () => {
    assert.ok(!plain.prompt.includes('Close the stale tickets first'));
    assert.ok(!plain.prompt.includes('ANSWERS THAT ARRIVED LATE'));
  });
  await check('and the read carries no line', () => {
    assert.ok(!String(plain.stored.MarkdownResponse).includes('arrived late'));
    assert.ok(!plain.stored.LateAnswersIncluded);
  });

  say('\n3. Redo in a round that hid names');
  await seedRound('5203', { revealed: false });
  const hidden = await runWorker('5203', { includeLate: true });
  await check('the late answer is there, and no name is', () => {
    assert.ok(hidden.prompt.includes('Close the stale tickets first'));
    assert.ok(!hidden.prompt.includes('Zed'), 'a hidden author reached the prompt');
  });

  say('\n4. the host\'s Redo asks the worker for it; a first read does not');
  const http = async (route, query, authorizer) => {
    invoked.length = 0;
    const res = await getAiSummary({
      routeKey: route,
      pathParameters: { gameId: '5202' },
      queryStringParameters: { questionId: '001', generateNew: 'true', ...query },
      requestContext: { routeKey: route, ...(authorizer ? { authorizer } : {}) },
    });
    return { status: res.statusCode, payload: invoked[0] || null };
  };
  const hostRoute = 'GET /games/{gameId}/ai-summary/host';
  await check('redo=true: the worker is told includeLate', async () => {
    store.delete(key('GAME#5202', 'QUESTION#001#SUMMARYJOB'));
    const r = await http(hostRoute, { redo: 'true' }, HOST);
    assert.strictEqual(r.status, 202);
    assert.strictEqual(r.payload && r.payload.includeLate, true, JSON.stringify(r.payload));
  });
  await check('without it: no includeLate', async () => {
    for (const k of [...store.keys()]) if (k.startsWith('GAME#5202|') && k.includes('JOB')) store.delete(k);
    const r = await http(hostRoute, {}, HOST);
    assert.strictEqual(r.status, 202);
    assert.ok(r.payload && !('includeLate' in r.payload), JSON.stringify(r.payload));
  });
  await check('the public route refuses redo', async () => {
    const r = await http('GET /games/{gameId}/ai-summary', { generateNew: undefined, redo: 'true' });
    assert.strictEqual(r.status, 403);
  });

  say(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})().catch((e) => { say(`CRASH ${e.stack}`); process.exit(1); });
