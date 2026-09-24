/**
 * A WORKIE WITH MORE TO SAY IS NOT CUT OFF BEFORE ITS NEXT STEPS.
 *
 * ── THE FAILURE ────────────────────────────────────────────────────────────
 *
 * get-ai-summary.js asked Bedrock for at most 1,024 tokens, sized for the
 * default three- and four-heading Workies ("content is ~600–1000 tok … bump
 * to 1536 only if stop_reason:max_tokens"). A Workie may declare its own
 * sections, and dev's live "Leadership Principals" Workie declares five. Run
 * on Haiku 4.5 with the worker's exact settings (2026-09-24), it hit the cap
 * in 2 of 3 replies and stopped mid-sentence in its fourth section: the room
 * got no Next Steps, and nothing said so — the cut-off reply was parsed and
 * stored as if it were whole.
 *
 * The cap is now 2,048, which only costs time when a Workie actually writes
 * more, and a reply that still ends on max_tokens is logged as cut off.
 *
 * rejects: a reply cap that cannot hold a five-section Workie; a reply that
 *          ended on max_tokens with no warning; a warning on a whole reply.
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const assert = require('assert');
const util = require('util');

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

const fakeDoc = {
  send: async (cmd) => {
    const inp = cmd.input || {};
    switch (cmd.type) {
      case 'put': put(inp.Item); return {};
      case 'get': return { Item: store.get(key(inp.Key.PK, inp.Key.SK)) };
      case 'delete': store.delete(key(inp.Key.PK, inp.Key.SK)); return {};
      case 'query': {
        const v = inp.ExpressionAttributeValues || {};
        const items = [...store.values()].filter((i) =>
          i.PK === v[':pk'] && String(i.SK).startsWith(String(v[':sk'] ?? '')));
        return { Items: items, Count: items.length };
      }
      case 'scan': return { Items: [], Count: 0 };
      default: return {};
    }
  },
};

stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => fakeDoc },
  GetCommand, PutCommand, QueryCommand, UpdateCommand, DeleteCommand, ScanCommand,
});
const noopClient = class { async send() { return {}; } };
stub('@aws-sdk/client-s3', { S3Client: noopClient, GetObjectCommand: class {} });
stub('@aws-sdk/client-lambda', { LambdaClient: noopClient, InvokeCommand: class {} });
stub('@aws-sdk/client-apigatewaymanagementapi', {
  ApiGatewayManagementApiClient: noopClient, PostToConnectionCommand: class {},
});
stub('@aws-sdk/client-kms', {
  KMSClient: class { async send() { throw new Error('no KMS: every row here is platform'); } },
  GenerateDataKeyCommand: class {}, DecryptCommand: class {},
});

// ---- Bedrock: answers with whatever stop_reason the section asks for --------
let bedrockBodies = [];
let stopReason = 'end_turn';
const REPLY = '\n\nThe room split.\n\n## Discussion Questions\n1. Why?\n\n## Next Steps\n1. Ada: draft the checklist.';
stub('@aws-sdk/client-bedrock-runtime', {
  BedrockRuntimeClient: class {
    async send(cmd) {
      bedrockBodies.push(JSON.parse(cmd.input.body));
      const body = { content: [{ type: 'text', text: REPLY }], stop_reason: stopReason, usage: { output_tokens: 2048 } };
      return { body: new TextEncoder().encode(JSON.stringify(body)) };
    }
  },
  InvokeModelCommand: class { constructor(i) { this.input = i; } },
});

process.env.TABLE_NAME = 'test-table';
process.env.WEBSOCKET_API_ENDPOINT = 'https://ws.test.invalid/dev';

const { handler: getAiSummary } = require(path.join(REPO, 'lambda-functions/game/get-ai-summary.js'));

// ---- harness ---------------------------------------------------------------
let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

function seedRound(gameId) {
  put({ PK: `GAME#${gameId}`, SK: 'METADATA', GameType: 'call-and-answer', Title: 'Launch retro' });
  put({ PK: `GAME#${gameId}`, SK: 'STATE', State: 'RESULTS#001', CurrentQuestionId: '001' });
  put({ PK: `GAME#${gameId}`, SK: 'ROUND#001', QuestionNumber: '001', AuthorsRevealed: true });
  put({ PK: `GAME#${gameId}`, SK: 'QUESTION#001#ANSWER#Ada', PlayerName: 'Ada', Answer: 'Skipping the dress rehearsal' });
}

/** Run the worker; return what it asked Bedrock for and every warning it printed. */
async function run(gameId) {
  bedrockBodies = [];
  const warnings = [];
  const orig = { log: console.log, warn: console.warn, error: console.error };
  console.log = () => {};
  console.warn = console.error = (...a) => warnings.push(util.format(...a));
  try {
    await getAiSummary({ __workerMode: true, gameId, questionId: '001' });
  } catch { /* a failure here surfaces as a missing Bedrock call below */ } finally {
    Object.assign(console, orig);
  }
  assert.ok(bedrockBodies.length, 'the worker never called the model');
  return { asked: bedrockBodies[0], warnings };
}

(async () => {
  put({ PK: 'AIPROMPTS', SK: 'AIPROMPT#lessons-learned', promptId: 'lessons-learned', s3Key: 'none',
        instructions: 'Read the round back. Answers: {responsesText}', outputFormat: 'Keep it short.' });

  console.log('\n1. the cap holds a five-section Workie');
  seedRound('9101');
  const whole = await run('9101');
  await check('the worker asks for at least 2,048 tokens', () =>
    assert.ok(whole.asked.max_tokens >= 2048, `max_tokens is ${whole.asked.max_tokens}`));
  await check('a whole reply raises no cut-off warning', () =>
    assert.ok(!whole.warnings.some((w) => /max_tokens|cut off/i.test(w)), whole.warnings.join('\n')));

  console.log('\n2. a reply that still hits the cap says so');
  stopReason = 'max_tokens';
  seedRound('9102');
  const cut = await run('9102');
  await check('a reply that ended on max_tokens is warned about as cut off', () => {
    const line = cut.warnings.find((w) => /cut off/i.test(w));
    assert.ok(line, `no cut-off warning among:\n${cut.warnings.join('\n')}`);
    assert.ok(line.includes('max_tokens'), line);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log(`CRASH ${e.stack}`); process.exit(1); });
