/**
 * Regression test: a question set pointing at a prompt that no longer exists
 * must NOT silently disable Bedrock.
 *
 * Observed on engagedev 2026-08-07 (game 7971, set "greatesthits"):
 *
 *   🎨 Found custom prompt ID: mdaikmsyh34dwoqayi
 *   ❌ Prompt mdaikmsyh34dwoqayi not found in DynamoDB
 *   ⚠️ Prompt template unavailable — returning data-driven fallback summary
 *
 * Bedrock was never called. A set with NO promptId worked fine the day before,
 * because the "find the game-type default" path only runs when promptId is
 * absent — a dangling promptId is a dead end rather than a miss.
 *
 * That matters because prompt deletion is known to leave orphan references
 * (see docs/handoff/admin-prompt-cleanup-plan.md), so any set can end up here.
 */
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');

// ---- Stub the AWS SDK before the handler loads -----------------------------
// art-title-flow.js poisons require.cache by resolved path, which only works
// for packages that are actually installed. Several of the SDK clients this
// handler imports (client-s3, client-lambda, client-bedrock-runtime) are only
// present in the deployed bundle, so they cannot be resolved locally at all.
// Intercept the loader by module name instead — works either way.
const Module = require('module');
const stubs = new Map();
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (stubs.has(request)) return stubs.get(request);
  return realLoad.call(this, request, parent, isMain);
};
function stub(name, exports) { stubs.set(name, exports); }

// The prompt that EXISTS — the call-and-answer default.
const DEFAULT_PROMPT_ID = 'default-callandanswer';
const DANGLING_PROMPT_ID = 'mdaikmsyh34dwoqayi';

const ddbItems = new Map([
  [`AIPROMPTS|AIPROMPT#${DEFAULT_PROMPT_ID}`, {
    PK: 'AIPROMPTS', SK: `AIPROMPT#${DEFAULT_PROMPT_ID}`,
    promptId: DEFAULT_PROMPT_ID, name: 'Lessons Learned - Strategic Insights',
    gameType: 'callandanswer', isDefault: true, category: 'lessons-learned',
    s3Key: `prompts/callandanswer/${DEFAULT_PROMPT_ID}/v1.json`,
  }],
  // NOTE: no record for DANGLING_PROMPT_ID — that is the whole point.
]);

class GetCommand { constructor(i) { this.input = i; this.type = 'get'; } }
class PutCommand { constructor(i) { this.input = i; this.type = 'put'; } }
class QueryCommand { constructor(i) { this.input = i; this.type = 'query'; } }
class UpdateCommand { constructor(i) { this.input = i; this.type = 'update'; } }
class DeleteCommand { constructor(i) { this.input = i; this.type = 'delete'; } }
class ScanCommand { constructor(i) { this.input = i; this.type = 'scan'; } }

const fakeDoc = {
  send: async (cmd) => {
    const inp = cmd.input || {};
    if (cmd.type === 'get') {
      return { Item: ddbItems.get(`${inp.Key.PK}|${inp.Key.SK}`) };
    }
    if (cmd.type === 'scan') {
      // findDefaultPromptId scans for PK=AIPROMPTS + gameType + isDefault
      const v = inp.ExpressionAttributeValues || {};
      const items = [...ddbItems.values()].filter((i) =>
        i.PK === v[':pk'] && i.gameType === v[':gameType'] && i.isDefault === v[':isDefault']);
      return { Items: items, Count: items.length };
    }
    return { Items: [], Count: 0 };
  },
};

stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => fakeDoc },
  GetCommand, PutCommand, QueryCommand, UpdateCommand, DeleteCommand, ScanCommand,
});

// S3 serves a real template for the default prompt only.
const s3Fetches = [];
stub('@aws-sdk/client-s3', {
  S3Client: class { async send(cmd) {
    const key = cmd.input.Key;
    s3Fetches.push(key);
    if (key === `prompts/callandanswer/${DEFAULT_PROMPT_ID}/v1.json`) {
      return { Body: { transformToString: async () => JSON.stringify({
        name: 'Lessons Learned - Strategic Insights',
        instructions: 'Summarise the responses.',
        outputFormat: '## Summary\n{responsesText}',
      }) } };
    }
    const err = new Error('NoSuchKey'); err.name = 'NoSuchKey'; throw err;
  } },
  GetObjectCommand: class { constructor(i) { this.input = i; } },
  PutObjectCommand: class { constructor(i) { this.input = i; } },
});

stub('@aws-sdk/client-bedrock-runtime', {
  BedrockRuntimeClient: class { async send() { throw new Error('bedrock not stubbed for this test'); } },
  InvokeModelCommand: class { constructor(i) { this.input = i; } },
});
stub('@aws-sdk/client-lambda', {
  LambdaClient: class { async send() { return {}; } },
  InvokeCommand: class { constructor(i) { this.input = i; } },
});
stub('@aws-sdk/client-apigatewaymanagementapi', {
  ApiGatewayManagementApiClient: class { async send() { return {}; } },
  PostToConnectionCommand: class { constructor(i) { this.input = i; } },
});

process.env.TABLE_NAME = 'test-table';
process.env.AI_PROMPTS_BUCKET = 'test-bucket';

const mod = require(path.join(REPO, 'lambda-functions', 'game', 'get-ai-summary.js'));

let pass = 0, fail = 0;
function check(label, fn) {
  try { fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

(async () => {
  console.log('resolvePromptTemplate: dangling promptId must fall back to the game-type default\n');

  assert(typeof mod.resolvePromptTemplate === 'function',
    'get-ai-summary.js must export resolvePromptTemplate for this to be testable');

  // 1. The reported failure: an explicit promptId that does not exist.
  s3Fetches.length = 0;
  const dangling = await mod.resolvePromptTemplate(DANGLING_PROMPT_ID, 'call-and-answer');
  check('a dangling promptId still yields a usable template', () =>
    assert(dangling && dangling.promptData, 'got no template — Bedrock would be skipped'));
  check('it resolves via the game-type default', () =>
    assert.strictEqual(dangling.promptId, DEFAULT_PROMPT_ID));
  check('the recovery is reported, not silent', () =>
    assert.strictEqual(dangling.recoveredFrom, DANGLING_PROMPT_ID));

  // 2. A promptId that does exist must be used as-is, not overridden.
  const good = await mod.resolvePromptTemplate(DEFAULT_PROMPT_ID, 'call-and-answer');
  check('an existing promptId is used unchanged', () =>
    assert.strictEqual(good.promptId, DEFAULT_PROMPT_ID));
  check('no spurious recovery flag when nothing was wrong', () =>
    assert.strictEqual(good.recoveredFrom, undefined));

  // 3. No promptId at all — the path that already worked — must keep working.
  const none = await mod.resolvePromptTemplate(null, 'call-and-answer');
  check('a missing promptId still resolves the default', () =>
    assert.strictEqual(none.promptId, DEFAULT_PROMPT_ID));

  // 4. Genuinely nothing available: caller must still get a clean signal so it
  //    can use the data-driven fallback rather than throwing.
  const empty = await mod.resolvePromptTemplate('nope', 'no-such-game-type');
  check('unresolvable everything returns null rather than throwing', () =>
    assert.strictEqual(empty, null));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('harness error:', e); process.exit(1); });
