/**
 * WORKIE KNOWS HOW LONG THE SESSION HAS RUN — {sessionDuration} in get-ai-summary.js.
 *
 * generateAISummary() computed the duration from `metadata.CreatedAt`, but no
 * `metadata` is in scope there: the session row lives in the handler. Every
 * round threw a ReferenceError into the block's own catch, logged
 * "⚠️ Could not calculate session duration: metadata is not defined", and
 * handed Workie 'Current session' — seen on dev (session 3255, round 010,
 * 2026-09-25) and in every earlier log.
 *
 * The handler reads METADATA; its CreatedAt (schema-compliant-manager.js, an
 * ISO string, plaintext on an org session too) is what must reach the prompt.
 *
 * Drives the REAL handler in worker mode against a stubbed table, a KMS that
 * enforces the key policy, and a Bedrock that records its prompt.
 *
 * rejects: a duration that never reaches the prompt; the ReferenceError line
 * in the logs; a missing CreatedAt that prints something other than the old
 * fallback text.
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
// record's own `template` — the same route tests/ai-summary-briefing.js uses.
const noopClient = class { async send() { return {}; } };
stub('@aws-sdk/client-s3', { S3Client: noopClient, GetObjectCommand: class {} });
stub('@aws-sdk/client-lambda', { LambdaClient: noopClient, InvokeCommand: class {} });
stub('@aws-sdk/client-apigatewaymanagementapi', {
  ApiGatewayManagementApiClient: noopClient, PostToConnectionCommand: class {},
});

// ---- Bedrock: record what Workie was told, and answer ------------------------
let bedrockBodies = [];
const COMPLETION = '\n\nThe room put the easy fixes first.'
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

// Every log line is kept, so the ReferenceError the old code swallowed can be
// seen; printed only under DEBUG.
let logLines = [];
const keep = (...a) => {
  logLines.push(a.map((x) => (typeof x === 'string' ? x : (x && x.message) || String(x))).join(' '));
  if (process.env.DEBUG) process.stderr.write(a.join(' ') + '\n');
};
console.log = keep; console.warn = keep; console.error = keep;
const say = (...a) => process.stdout.write(a.join(' ') + '\n');

let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); say(`  PASS  ${label}`); pass++; }
  catch (e) { say(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

// ---- the session ------------------------------------------------------------
const ORG = 'org_acme';

const TEMPLATE =
  'EVENT: {eventTitle}\n' +
  'SESSION DURATION: {sessionDuration}\n' +
  'Q: {questionTitle}\n' +
  'RESPONSES: {responsesText}\n' +
  '=== SUMMARY ===\nx\n=== DISCUSSION QUESTIONS ===\nQ1: x\n=== NEXT STEPS ===\nSTEP1: x';

async function mintOrg(orgId) {
  const blob = await crypto.createOrgDataKey(orgId);
  put({ PK: `ORG#${orgId}`, SK: 'METADATA', orgId, dataKeyCiphertext: blob });
  crypto.forgetOrg(orgId);
}

/** One round at RESULTS. `createdAt` is METADATA.CreatedAt as create writes it. */
async function seedRound(gameId, { orgId, createdAt }) {
  const metadata = {
    PK: `GAME#${gameId}`, SK: 'METADATA',
    GameType: 'call-and-answer',
    Title: 'Support Ops Review — Q3', HostName: 'Host', Details: '', AIContext: '',
    ...(createdAt ? { CreatedAt: createdAt } : {}),
    ...(orgId ? { orgId, QuestionSetScope: 'org' } : {}),
  };
  put(orgId ? await crypto.encryptItem(orgId, 'session', metadata) : metadata);
  put({ PK: `GAME#${gameId}`, SK: 'STATE', State: 'RESULTS#001', CurrentQuestionId: '001' });
  put({ PK: `GAME#${gameId}`, SK: 'ROUND#001', QuestionNumber: '001', AuthorsRevealed: true });
  const answers = [
    { PK: `GAME#${gameId}`, SK: 'QUESTION#001#ANSWER#Ada', PlayerName: 'Ada', Answer: 'Prioritise the easy-fix tickets' },
    { PK: `GAME#${gameId}`, SK: 'QUESTION#001#ANSWER#Grace', PlayerName: 'Grace', Answer: 'One owner per ticket' },
  ];
  for (const a of answers) put(orgId ? await crypto.encryptItem(orgId, 'answer', a) : a);
  put({ PK: 'AIPROMPTS', SK: 'AIPROMPT#lessons-learned', s3Key: 'fake-key', template: TEMPLATE });
}

async function runWorker(gameId) {
  bedrockBodies = [];
  logLines = [];
  let res;
  try {
    res = await getAiSummary({ __workerMode: true, gameId, questionId: '001', debug: 'true' });
  } catch (e) {
    res = { error: e.message };
  }
  const prompt = bedrockBodies.length ? bedrockBodies[0].messages[0].content : '';
  const line = (prompt.match(/SESSION DURATION: (.*)/) || [])[1];
  return { res, prompt, duration: line, logs: logLines.slice() };
}

const ago = (ms) => new Date(Date.now() - ms).toISOString();
const MIN = 60 * 1000;

/** "12 minutes, 34 seconds" → [12, 34]; tolerates the seconds the run itself takes. */
function assertDuration(duration, minutes, seconds) {
  const m = /^(\d+) minutes, (\d+) seconds$/.exec(duration || '');
  assert.ok(m, `sessionDuration was ${JSON.stringify(duration)}`);
  assert.strictEqual(Number(m[1]), minutes, `minutes in ${JSON.stringify(duration)}`);
  const s = Number(m[2]);
  assert.ok(s >= seconds && s <= seconds + 5, `seconds in ${JSON.stringify(duration)}`);
}

const noReferenceError = (logs) => {
  const bad = logs.filter((l) => /metadata is not defined/.test(l));
  assert.strictEqual(bad.length, 0, bad.join('\n'));
};

(async () => {
  await mintOrg(ORG);

  say('\n1. a platform session created 12 minutes, 34 seconds ago');
  await seedRound('6101', { createdAt: ago(12 * MIN + 34 * 1000) });
  const plat = await runWorker('6101');
  await check('the worker completed', () =>
    assert.strictEqual(plat.res && plat.res.ok, true, JSON.stringify(plat.res)));
  await check('{sessionDuration} reaches the prompt as the time since CreatedAt', () =>
    assertDuration(plat.duration, 12, 34));
  await check('no "metadata is not defined" line is logged', () => noReferenceError(plat.logs));

  say('\n2. an org session (METADATA decrypted first) created 3 minutes, 5 seconds ago');
  await seedRound('6102', { orgId: ORG, createdAt: ago(3 * MIN + 5 * 1000) });
  const org = await runWorker('6102');
  await check('the worker completed', () =>
    assert.strictEqual(org.res && org.res.ok, true, JSON.stringify(org.res)));
  await check('{sessionDuration} reaches the prompt as the time since CreatedAt', () =>
    assertDuration(org.duration, 3, 5));
  await check('no "metadata is not defined" line is logged', () => noReferenceError(org.logs));

  say('\n3. a session row with no CreatedAt');
  await seedRound('6103', {});
  const bare = await runWorker('6103');
  await check('the worker completed', () =>
    assert.strictEqual(bare.res && bare.res.ok, true, JSON.stringify(bare.res)));
  await check("{sessionDuration} keeps the fallback 'Current session'", () =>
    assert.strictEqual(bare.duration, 'Current session'));
  await check('no "metadata is not defined" line is logged', () => noReferenceError(bare.logs));

  say(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})().catch((e) => { say(`CRASH ${e.stack}`); process.exit(1); });
