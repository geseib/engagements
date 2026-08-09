/**
 * A wavelength round must be able to produce Field Notes at all.
 *
 * The motivating failure: exports.handler's own vote-tally pass has a
 * wavelength branch (get-ai-summary.js, the `else if (gameType ===
 * 'wavelength')` arm that sets every player's team score) which read a bare
 * `commonWords`. That identifier was only ever declared inside
 * generateAISummary — a separate top-level function with no closure over the
 * handler's locals — so the read was an undeclared-variable reference and every
 * wavelength game threw `ReferenceError: commonWords is not defined` there.
 *
 * It threw BEFORE prompt resolution, before generateAISummary was called at
 * all, so no prompt/persona/template configuration could avoid it: any
 * wavelength round with at least one answer failed. In production the HTTP call
 * still returned 202 "generating" (it self-invokes a worker), and the worker
 * then crashed, broadcast `aiSummaryError` to the room and rethrew into
 * Lambda's retries. Field Notes never appeared for wavelength.
 *
 * Sibling of tests/anonymous-round-flow.js, whose stub preamble this copies.
 * That suite had to call generateAISummary() directly precisely because this
 * bug made the exports.handler round trip unreachable for wavelength; these
 * tests drive the real handler instead.
 */
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');

// ---- Stubs, installed before the handler loads -----------------------------
class PutCommand { constructor(i) { this.input = i; this.type = 'put'; } }
class GetCommand { constructor(i) { this.input = i; this.type = 'get'; } }
class QueryCommand { constructor(i) { this.input = i; this.type = 'query'; } }
class DeleteCommand { constructor(i) { this.input = i; this.type = 'delete'; } }
class UpdateCommand { constructor(i) { this.input = i; this.type = 'update'; } }
class ScanCommand { constructor(i) { this.input = i; this.type = 'scan'; } }
class PostToConnectionCommand { constructor(i) { this.input = i; } }

const store = new Map();
const key = (pk, sk) => `${pk}|${sk}`;
const put = (item) => store.set(key(item.PK, item.SK), item);

/** Frames the handler tried to push, in order. */
let sent = [];

const fakeDoc = {
  send: async (cmd) => {
    const inp = cmd.input || {};
    switch (cmd.type) {
      case 'put':
        store.set(key(inp.Item.PK, inp.Item.SK), inp.Item);
        return {};
      case 'get':
        return { Item: store.get(key(inp.Key.PK, inp.Key.SK)) };
      case 'delete':
        store.delete(key(inp.Key.PK, inp.Key.SK));
        return {};
      case 'update':
        return {};
      case 'query': {
        const pk = inp.ExpressionAttributeValues[':pk'];
        const prefix = inp.ExpressionAttributeValues[':sk'] ?? '';
        const items = [...store.values()].filter(
          (i) => i.PK === pk && String(i.SK).startsWith(String(prefix))
        );
        return { Items: items, Count: items.length };
      }
      case 'scan': {
        const values = inp.ExpressionAttributeValues || {};
        const items = [...store.values()].filter((i) => {
          if (values[':pk'] !== undefined && i.PK !== values[':pk']) return false;
          if (values[':isDefault'] !== undefined && i.isDefault !== values[':isDefault']) return false;
          return true;
        });
        return { Items: items, Count: items.length };
      }
      default:
        return {};
    }
  },
};

class FakeApiGatewayClient {
  async send(cmd) {
    sent.push({ connectionId: cmd.input.ConnectionId, message: JSON.parse(cmd.input.Data) });
    return {};
  }
}

// Handlers live in lambda-functions/<group>/, each of which may carry its own
// node_modules. Node resolves from the requiring file upward, so poison every
// resolvable copy or the real SDK loads and the test dies on credentials.
const STUB_PATHS = [
  REPO,
  path.join(REPO, 'lambda-functions'),
  path.join(REPO, 'lambda-functions', 'game'),
  path.join(REPO, 'lambda-functions', 'websocket'),
];

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

stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => fakeDoc },
  PutCommand, GetCommand, QueryCommand, DeleteCommand, UpdateCommand, ScanCommand,
});
stub('@aws-sdk/client-apigatewaymanagementapi', {
  ApiGatewayManagementApiClient: FakeApiGatewayClient,
  PostToConnectionCommand,
});

process.env.TABLE_NAME = 'test-table';
process.env.WEBSOCKET_API_ENDPOINT = 'https://ws.test.invalid/dev';

// @aws-sdk/client-s3 and @aws-sdk/client-lambda exist only in the deployed
// bundle, so require.cache poisoning (which needs require.resolve to succeed)
// cannot reach them — hook the loader by name. Bedrock IS resolvable locally
// and would attempt a real network call, so stub it to fail fast: every test
// here then exercises the deterministic fallback-summary path, which is the
// same path a real throttle or outage takes. The Bedrock client is a
// MODULE-LEVEL singleton, so this must be in place before the first require.
const Module = require('module');
const realLoad = Module._load;
const noopClient = class { async send() { return {}; } };
const throwingBedrock = class { async send() { throw new Error('stub: no Bedrock in tests'); } };
const extraStubs = new Map([
  ['@aws-sdk/client-s3', { S3Client: noopClient, GetObjectCommand: class {} }],
  ['@aws-sdk/client-lambda', { LambdaClient: noopClient, InvokeCommand: class {} }],
  ['@aws-sdk/client-bedrock-runtime', { BedrockRuntimeClient: throwingBedrock, InvokeModelCommand: class {} }],
]);
Module._load = function (request, parent, isMain) {
  if (extraStubs.has(request)) return extraStubs.get(request);
  return realLoad.call(this, request, parent, isMain);
};
const { handler: getAiSummary } = require(path.join(REPO, 'lambda-functions/game/get-ai-summary.js'));
Module._load = realLoad;

let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

// Enough of a template that prompt resolution succeeds and the assembled
// prompt carries the wavelength variables. s3Key present + the stubbed S3
// client resolving to a bodyless {} makes fetchPromptFromS3 fall through to its
// own "use the DynamoDB record" fallback, which is the simplest way to supply a
// usable .template without a real S3 object.
const AI_PROMPT_TEMPLATE =
  'Q: {questionTitle}\n' +
  'RESPONSES: {responsesText}\n' +
  'COMMON WORDS: {commonWords}\n' +
  'WORD ANALYSIS: {wordAnalysis}\n' +
  'TEAM SCORE: {teamScore}\n' +
  '=== SUMMARY ===\nx\n=== DISCUSSION QUESTIONS ===\nQ1: x\n=== NEXT STEPS ===\nSTEP1: x';

/**
 * Seeds a wavelength round. Two players share two words ("ocean", "blue") out
 * of four unique ones, so the correct common-word count is 2 and the correct
 * connection rate 50% — numbers that are wrong in a visible way if the team
 * score silently degrades to zero.
 *
 * `storedResults` mirrors what get-results.js's handleWavelengthResults
 * actually persists under QUESTION#nnn#RESULTS, field for field.
 */
function seedWavelength(gameId, { withStoredResults = true, withPrompt = true } = {}) {
  store.clear();
  sent = [];
  put({ PK: `GAME#${gameId}`, SK: 'METADATA', GameType: 'wavelength', Title: 'T',
        QuestionSetId: 'wl-set', HostPreferences: {} });
  put({ PK: `GAME#${gameId}`, SK: 'STATE', State: 'RESULTS#001', LessonNumber: 1, CurrentQuestionId: '001' });
  put({ PK: `GAME#${gameId}`, SK: 'ROUND#001', QuestionNumber: '001', AuthorsRevealed: true });
  put({ PK: `GAME#${gameId}`, SK: 'QUESTION#001#ANSWER#Ada', PlayerName: 'Ada',
        Answer: 'ocean, blue, calm', ProcessedWords: ['ocean', 'blue', 'calm'],
        SubmittedAt: '2026-01-01T00:00:00.000Z' });
  put({ PK: `GAME#${gameId}`, SK: 'QUESTION#001#ANSWER#Grace', PlayerName: 'Grace',
        Answer: 'ocean, deep, blue', ProcessedWords: ['ocean', 'deep', 'blue'],
        SubmittedAt: '2026-01-01T00:00:00.000Z' });
  put({ PK: `GAME#${gameId}`, SK: 'CONNECTION#host-1', ConnectionId: 'host-1', ConnectionType: 'HOST' });

  if (withStoredResults) {
    put({
      PK: `GAME#${gameId}`, SK: 'QUESTION#001#RESULTS',
      gameId, questionId: '001', gameType: 'wavelength',
      answers: [
        { playerName: 'Ada', answer: 'ocean, blue, calm', words: ['ocean', 'blue', 'calm'] },
        { playerName: 'Grace', answer: 'ocean, deep, blue', words: ['ocean', 'deep', 'blue'] },
      ],
      wordAnalysis: {
        totalAnswers: 2, totalWordsSubmitted: 6, totalUniqueWords: 4,
        commonWords: [{ word: 'ocean', count: 2 }, { word: 'blue', count: 2 }],
        wordCounts: { ocean: 2, blue: 2, calm: 1, deep: 1 },
        connectionScore: 50,
      },
      teamScore: 2,
    });
  }
  if (withPrompt) {
    put({ PK: 'SETS', SK: 'SET#wl-set', setId: 'wl-set', gameType: 'wavelength', promptId: 'wavelength-default' });
    put({ PK: 'AIPROMPTS', SK: 'AIPROMPT#wavelength-default', promptId: 'wavelength-default',
          gameType: 'wavelength', isDefault: true, s3Key: 'fake-key', template: AI_PROMPT_TEMPLATE });
  }
}

/** Drives the real worker path — the one production actually runs. */
async function runWorker(gameId, opts) {
  seedWavelength(gameId, opts);
  const res = await getAiSummary({ __workerMode: true, gameId, questionId: '001', debug: 'true' });
  return { res, stored: store.get(key(`GAME#${gameId}`, 'QUESTION#001#AISummary')) };
}

(async () => {

console.log('\n1. a wavelength round reaches the end of the handler at all');

await check('the worker completes instead of throwing ReferenceError', async () => {
  const { res } = await runWorker('9101');
  assert.strictEqual(res.ok, true, `worker did not report ok: ${JSON.stringify(res)}`);
});

await check('the summary is persisted', async () => {
  const { stored } = await runWorker('9102');
  assert.ok(stored, 'no QUESTION#001#AISummary record was written');
});

await check('the room is told the summary is ready, not that it errored', async () => {
  await runWorker('9103');
  const types = sent.map((s) => s.message.type);
  assert.ok(types.includes('aiSummaryReady'), `broadcast types were ${JSON.stringify(types)}`);
  assert.ok(!types.includes('aiSummaryError'), `broadcast an error: ${JSON.stringify(types)}`);
});

console.log('\n2. the team score is the real common-word count, not a silent zero');

// The handler's wavelength arm gives every player the same team score. Nothing
// downstream would have flagged a hardcoded 0 — it is a plausible-looking
// score — so pin it to the seeded data: 2 shared words out of 4 unique.
await check('every player is scored 2, the number of shared words', async () => {
  const { stored } = await runWorker('9104');
  const vars = stored.DebugInfo?.templateVariables || {};
  assert.strictEqual(String(vars.teamScore), '2', `teamScore was ${vars.teamScore}`);
});

await check('the assembled prompt names the words that were actually shared', async () => {
  const { stored } = await runWorker('9105');
  const prompt = stored.DebugInfo?.fullPrompt || '';
  assert.ok(/ocean/.test(prompt) && /blue/.test(prompt), `common words missing from prompt:\n${prompt}`);
  assert.ok(!/\bcalm\b/.test(prompt.split('COMMON WORDS:')[1]?.split('\n')[0] || ''),
    'listed a word only one player submitted as common');
});

console.log('\n3. a round whose results were never stored still works');

// storedResults is a separate QUESTION#nnn#RESULTS record. It is absent for
// rounds resolved before that write existed, and for any round whose results
// call did not complete — so the handler cannot assume it.
await check('no stored results: the worker still completes', async () => {
  const { res } = await runWorker('9106', { withStoredResults: false });
  assert.strictEqual(res.ok, true, `worker did not report ok: ${JSON.stringify(res)}`);
});

await check('no stored results: the score is recomputed from the answers, not zeroed', async () => {
  const { stored } = await runWorker('9107', { withStoredResults: false });
  const vars = stored.DebugInfo?.templateVariables || {};
  assert.strictEqual(String(vars.teamScore), '2', `teamScore was ${vars.teamScore}`);
});

console.log('\n4. the handler and generateAISummary agree on the count');

// These are two independent derivations of the same number: the handler's
// vote-tally pass scores the players, generateAISummary builds the model's
// word analysis. They read the same inputs and must not drift — a disagreement
// means the room is shown one score while the model is told another.
for (const [label, opts] of [['stored results', {}], ['recomputed', { withStoredResults: false }]]) {
  await check(`${label}: teamScore matches the wordAnalysis common-word count`, async () => {
    const { stored } = await runWorker('9108', opts);
    const vars = stored.DebugInfo?.templateVariables || {};
    const fromAnalysis = /^(\d+) common words found/.exec(vars.wordAnalysis || '');
    assert.ok(fromAnalysis, `could not read a count out of wordAnalysis: ${vars.wordAnalysis}`);
    assert.strictEqual(String(vars.teamScore), fromAnalysis[1],
      `teamScore ${vars.teamScore} but wordAnalysis reported ${fromAnalysis[1]}`);
  });
}

console.log('\n5. the other game types are unaffected');

// The wavelength arm sits in an if/else chain with trivia and the vote-based
// types. Scoring for those must be untouched by the fix.
await check('a trivia round still scores from the points on each answer', async () => {
  store.clear();
  sent = [];
  put({ PK: 'GAME#9109', SK: 'METADATA', GameType: 'trivia', Title: 'T', QuestionSetId: 'tr-set', HostPreferences: {} });
  put({ PK: 'GAME#9109', SK: 'STATE', State: 'RESULTS#001', LessonNumber: 1, CurrentQuestionId: '001' });
  put({ PK: 'GAME#9109', SK: 'ROUND#001', QuestionNumber: '001', AuthorsRevealed: true });
  put({ PK: 'GAME#9109', SK: 'QUESTION#001#ANSWER#Ada', PlayerName: 'Ada', Answer: 'OptionA',
        PointsEarned: 7, IsCorrect: true, SubmittedAt: '2026-01-01T00:00:00.000Z' });
  put({ PK: 'GAME#9109', SK: 'CONNECTION#host-1', ConnectionId: 'host-1', ConnectionType: 'HOST' });
  put({ PK: 'SETS', SK: 'SET#tr-set', setId: 'tr-set', gameType: 'trivia', promptId: 'trivia-default' });
  put({ PK: 'AIPROMPTS', SK: 'AIPROMPT#trivia-default', promptId: 'trivia-default', gameType: 'trivia',
        isDefault: true, s3Key: 'fake-key', template: AI_PROMPT_TEMPLATE + '\nSCORES: {roundScores}' });

  const res = await getAiSummary({ __workerMode: true, gameId: '9109', questionId: '001', debug: 'true' });
  assert.strictEqual(res.ok, true, `trivia worker did not report ok: ${JSON.stringify(res)}`);
  const stored = store.get(key('GAME#9109', 'QUESTION#001#AISummary'));
  assert.ok(/7/.test(stored.DebugInfo?.fullPrompt || ''), 'the 7 points earned did not reach the prompt');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

})();
