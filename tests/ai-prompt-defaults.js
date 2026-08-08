/**
 * Regression tests for summary-prompt resolution in game/get-ai-summary.js.
 *
 * Two behaviours that were previously silent or non-deterministic:
 *
 * 1. A prompt authored in AIGenerationPromptEditor emits
 *    `basePrompt`/`contextTemplate`/`outputFormat` and never
 *    `template`/`instructions`, so it fails the summary gate. The old code
 *    logged one warning and fell back to the game-type default with no way to
 *    tell that apart from "working as configured" — the "I added an Art prompt
 *    and nothing changed" report. The fallback must stay (never dead-end a live
 *    game) but the recovery must be reported with a reason.
 *
 * 2. `findDefaultPromptId` ended with "for polls or other types, just take the
 *    first one", i.e. whatever order DynamoDB happened to return. With seven
 *    call-and-answer prompts all flagged isDefault, two runs of the same game
 *    could use different prompts. Resolution must be deterministic and must
 *    match either game-type spelling.
 *
 * Stubbing note: require.cache-by-path poisoning silently misses here, because
 * client-s3 / client-lambda / client-bedrock-runtime only exist in the deployed
 * bundle. Intercept Module._load by request name instead.
 */
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

// ---- the inventory under test ---------------------------------------------
// A generation-format prompt (unusable for summaries) that a question set
// points at, plus THREE call-and-answer prompts all claiming isDefault, stored
// under two different spellings of the same game type.
const ART_GENERATION_PROMPT = 'art-gen-1';

const ddbItems = new Map([
  [`AIPROMPTS|AIPROMPT#${ART_GENERATION_PROMPT}`, {
    PK: 'AIPROMPTS', SK: `AIPROMPT#${ART_GENERATION_PROMPT}`,
    promptId: ART_GENERATION_PROMPT, name: 'Art Titles (generation)',
    gameType: 'call-and-answer', promptType: 'generation', isDefault: false,
    basePrompt: 'Generate artwork naming rounds.',
    s3Key: `prompts/call-and-answer/${ART_GENERATION_PROMPT}/v1.json`,
  }],
  // Three simultaneous defaults, deliberately out of preference order and
  // spelled inconsistently.
  ['AIPROMPTS|AIPROMPT#zzz-team', {
    PK: 'AIPROMPTS', SK: 'AIPROMPT#zzz-team',
    promptId: 'zzz-team', name: 'Team Building', gameType: 'call-and-answer',
    category: 'team-building', isDefault: true, createdAt: '2025-01-01T00:00:00Z',
    s3Key: 'prompts/call-and-answer/zzz-team/v1.json',
  }],
  ['AIPROMPTS|AIPROMPT#aaa-lessons', {
    PK: 'AIPROMPTS', SK: 'AIPROMPT#aaa-lessons',
    promptId: 'aaa-lessons', name: 'Lessons Learned', gameType: 'callandanswer',
    category: 'lessons-learned', isDefault: true, createdAt: '2025-06-01T00:00:00Z',
    s3Key: 'prompts/callandanswer/aaa-lessons/v1.json',
  }],
  ['AIPROMPTS|AIPROMPT#mmm-opinions', {
    PK: 'AIPROMPTS', SK: 'AIPROMPT#mmm-opinions',
    promptId: 'mmm-opinions', name: 'Opinions', gameType: 'call-and-answer',
    category: 'opinions', isDefault: true, createdAt: '2025-03-01T00:00:00Z',
    s3Key: 'prompts/call-and-answer/mmm-opinions/v1.json',
  }],
  // Two poll defaults, same category — the case the old code resolved by
  // "just take the first one".
  ['AIPROMPTS|AIPROMPT#poll-b', {
    PK: 'AIPROMPTS', SK: 'AIPROMPT#poll-b',
    promptId: 'poll-b', name: 'Poll B', gameType: 'polls',
    category: 'opinion', isDefault: true, createdAt: '2025-05-01T00:00:00Z',
    s3Key: 'prompts/poll/poll-b/v1.json',
  }],
  ['AIPROMPTS|AIPROMPT#poll-a', {
    PK: 'AIPROMPTS', SK: 'AIPROMPT#poll-a',
    promptId: 'poll-a', name: 'Poll A', gameType: 'poll',
    category: 'opinion', isDefault: true, createdAt: '2025-02-01T00:00:00Z',
    s3Key: 'prompts/poll/poll-a/v1.json',
  }],
]);

class GetCommand { constructor(i) { this.input = i; this.type = 'get'; } }
class PutCommand { constructor(i) { this.input = i; this.type = 'put'; } }
class QueryCommand { constructor(i) { this.input = i; this.type = 'query'; } }
class UpdateCommand { constructor(i) { this.input = i; this.type = 'update'; } }
class DeleteCommand { constructor(i) { this.input = i; this.type = 'delete'; } }
class ScanCommand { constructor(i) { this.input = i; this.type = 'scan'; } }

// Scan order is deliberately RANDOMISED on every call. DynamoDB gives no order
// guarantee, and a resolver that "takes the first one" must fail this test.
let scanCalls = 0;
const fakeDoc = {
  send: async (cmd) => {
    const inp = cmd.input || {};
    if (cmd.type === 'get') return { Item: ddbItems.get(`${inp.Key.PK}|${inp.Key.SK}`) };
    if (cmd.type === 'scan') {
      scanCalls++;
      const v = inp.ExpressionAttributeValues || {};
      const items = [...ddbItems.values()]
        .filter((i) => i.PK === v[':pk'] && i.isDefault === v[':isDefault']);
      // Rotate by one on every call, so consecutive scans return the same set
      // in a different order. "Just take the first one" cannot survive this.
      const n = items.length ? scanCalls % items.length : 0;
      return { Items: [...items.slice(n), ...items.slice(0, n)] };
    }
    return { Items: [], Count: 0 };
  },
};

stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => fakeDoc },
  GetCommand, PutCommand, QueryCommand, UpdateCommand, DeleteCommand, ScanCommand,
});

// S3 serves an ANALYSIS-shaped body for the analysis prompts, and a
// GENERATION-shaped body for the art prompt — which is the whole point.
const s3Bodies = {
  [`prompts/call-and-answer/${ART_GENERATION_PROMPT}/v1.json`]: {
    name: 'Art Titles (generation)',
    basePrompt: 'Generate artwork naming rounds about {context}.',
    contextTemplate: '\n\nContext: {context}',
    outputFormat: 'Return as JSON array.',
  },
  'prompts/callandanswer/aaa-lessons/v1.json': {
    name: 'Lessons Learned', instructions: 'Summarise.', outputFormat: '## Summary',
  },
  'prompts/call-and-answer/zzz-team/v1.json': {
    name: 'Team Building', instructions: 'Summarise.', outputFormat: '## Summary',
  },
  'prompts/call-and-answer/mmm-opinions/v1.json': {
    name: 'Opinions', instructions: 'Summarise.', outputFormat: '## Summary',
  },
  'prompts/poll/poll-a/v1.json': {
    name: 'Poll A', instructions: 'Summarise.', outputFormat: '## Summary',
  },
  'prompts/poll/poll-b/v1.json': {
    name: 'Poll B', instructions: 'Summarise.', outputFormat: '## Summary',
  },
};

stub('@aws-sdk/client-s3', {
  S3Client: class {
    async send(cmd) {
      const body = s3Bodies[cmd.input.Key];
      if (!body) { const e = new Error('NoSuchKey'); e.name = 'NoSuchKey'; throw e; }
      return { Body: { transformToString: async () => JSON.stringify(body) } };
    }
  },
  GetObjectCommand: class { constructor(i) { this.input = i; } },
  PutObjectCommand: class { constructor(i) { this.input = i; } },
});
stub('@aws-sdk/client-bedrock-runtime', {
  BedrockRuntimeClient: class { async send() { throw new Error('bedrock not stubbed'); } },
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
  console.log('summary prompts: unusable prompts fail loudly, defaults resolve deterministically\n');

  assert(typeof mod.findDefaultPromptId === 'function',
    'get-ai-summary.js must export findDefaultPromptId for this to be testable');
  assert(typeof mod.isUsableSummaryPrompt === 'function',
    'get-ai-summary.js must export isUsableSummaryPrompt so the admin UI can grey prompts out');

  // === 1. Generation-format prompt: still summarises, but says why =========
  const art = await mod.resolvePromptTemplate(ART_GENERATION_PROMPT, 'call-and-answer');

  check('a generation-format prompt still yields a usable template (game never dead-ends)', () =>
    assert(art && art.promptData, 'got no template — Bedrock would be skipped entirely'));

  check('it does NOT use the generation prompt itself', () =>
    assert.notStrictEqual(art.promptId, ART_GENERATION_PROMPT));

  check('the fallback is reported, not silent', () =>
    assert.strictEqual(art.recoveredFrom, ART_GENERATION_PROMPT));

  check('the reason distinguishes "unusable" from "missing"', () =>
    assert.strictEqual(art.recoveryReason, 'unusable',
      'a prompt that EXISTS but is the wrong shape is a different problem from a deleted one'));

  check('the defect names the actual cause', () =>
    assert(/generation-format/.test(art.unusableDefect || ''), art.unusableDefect));

  check('the exported gate rejects the generation shape', () =>
    assert.strictEqual(mod.isUsableSummaryPrompt(s3Bodies[`prompts/call-and-answer/${ART_GENERATION_PROMPT}/v1.json`]), false));

  // A prompt that is simply absent must report 'missing', not 'unusable'.
  const gone = await mod.resolvePromptTemplate('deleted-prompt', 'call-and-answer');
  check('a deleted prompt reports recoveryReason "missing"', () =>
    assert.strictEqual(gone.recoveryReason, 'missing'));

  // === 2. Deterministic default resolution ================================
  const runs = [];
  for (let i = 0; i < 6; i++) runs.push(await mod.findDefaultPromptId('call-and-answer'));
  check('repeated resolution returns the same prompt every time', () =>
    assert.strictEqual(new Set(runs).size, 1,
      `got ${new Set(runs).size} different answers across 6 runs: ${[...new Set(runs)].join(', ')}`));

  check('the preferred category wins over scan order', () =>
    assert.strictEqual(runs[0], 'aaa-lessons',
      'call-and-answer should resolve to the lessons-learned prompt'));

  check('a default stored under the LEGACY spelling is still found', () =>
    assert.strictEqual(runs[0], 'aaa-lessons',
      'aaa-lessons is stored as gameType "callandanswer"; a dashed-id lookup must still match it'));

  const legacySpelling = await mod.findDefaultPromptId('callandanswer');
  check('callandanswer and call-and-answer resolve to the same default', () =>
    assert.strictEqual(legacySpelling, runs[0]));

  // Polls: same category on both candidates, so the tie-break falls through to
  // createdAt then promptId. This is the case the old code left to chance.
  const pollRuns = [];
  for (let i = 0; i < 6; i++) pollRuns.push(await mod.findDefaultPromptId('poll'));
  check('poll defaults resolve deterministically despite an identical category', () =>
    assert.strictEqual(new Set(pollRuns).size, 1,
      `got ${[...new Set(pollRuns)].join(', ')}`));

  check('the oldest poll prompt wins the tie-break', () =>
    assert.strictEqual(pollRuns[0], 'poll-a'));

  const pluralPoll = await mod.findDefaultPromptId('polls');
  check('findDefaultPromptId("polls") === findDefaultPromptId("poll")', () =>
    assert.strictEqual(pluralPoll, pollRuns[0]));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('harness error:', e); process.exit(1); });
