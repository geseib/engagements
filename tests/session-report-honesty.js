/**
 * The end-of-session reporting path must not state things that are not true.
 *
 * Three defects, all in what a host reads out loud or projects on a wall:
 *
 *   1. `participationRate` / `votingParticipation` were interpolated into the
 *      LIVE Bedrock prompt (get-ai-summary.js), computed with this round's own
 *      answer count as the denominator. The "answered" half was therefore 100%
 *      by construction on every round ever summarised, and the "voted" half was
 *      100% too whenever a round had no votes. The model was told the room's
 *      participation was total, every time.
 *
 *   2. get-ai-summary.js's own wavelength vote-tally pass read a bare
 *      `commonWords`, declared nowhere in that function — a ReferenceError, so
 *      every wavelength round that reached it produced a 500 instead of a
 *      summary.
 *
 *   3. create-report.js counted `PLAYER#`, `PLAYER#...#SCORE` and
 *      `PLAYER#...#STATE` rows together as `gameStats.totalPlayers`, roughly
 *      tripling the figure on the front page of the report.
 *
 * Runs the REAL handlers against a stubbed DynamoDB, following the stub
 * preamble in tests/report-payload-flow.js and tests/anonymous-round-flow.js.
 * Defect 2 in particular is only meaningful when the wavelength branch actually
 * EXECUTES — a ReferenceError does not exist until the line runs — so it is
 * driven through exports.handler in worker mode rather than around it.
 */
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');

// ---- Stub every AWS client before any handler loads ------------------------
// Hook Module._load BY NAME: @aws-sdk/client-s3 and @aws-sdk/client-lambda are
// not resolvable from the repo root at all (they exist only in the deployed
// bundle), so require.cache poisoning cannot reach them.
const Module = require('module');
const realLoad = Module._load;
const stubs = new Map();
Module._load = function (request, parent, isMain) {
  if (stubs.has(request)) return stubs.get(request);
  return realLoad.call(this, request, parent, isMain);
};

class GetCommand { constructor(i) { this.input = i; this.type = 'get'; } }
class PutCommand { constructor(i) { this.input = i; this.type = 'put'; } }
class DeleteCommand { constructor(i) { this.input = i; this.type = 'delete'; } }
class QueryCommand { constructor(i) { this.input = i; this.type = 'query'; } }
class ScanCommand { constructor(i) { this.input = i; this.type = 'scan'; } }
class UpdateCommand { constructor(i) { this.input = i; this.type = 'update'; } }
class BatchWriteCommand { constructor(i) { this.input = i; this.type = 'batchWrite'; } }

const TABLE = 'test-table';
const store = new Map();                       // "PK|SK" -> item
const k = (pk, sk) => `${pk}|${sk}`;
const put = (item) => store.set(k(item.PK, item.SK), item);

/**
 * When set, every Get against PK='AIPROMPTS' throws. That is the only route to
 * fetchPromptFromS3's hardcoded `lessons-learned` template (both its DynamoDB
 * read and its DynamoDB retry must fail before the hardcoded copy is returned),
 * and that hardcoded copy is the prompt text defect 1 lived in.
 */
let promptTableIsDown = false;

const fakeDoc = {
  send: async (cmd) => {
    const inp = cmd.input || {};
    if (promptTableIsDown && inp.Key && inp.Key.PK === 'AIPROMPTS') {
      throw new Error('stub: prompt table unavailable');
    }
    if (cmd.type === 'get') return { Item: store.get(k(inp.Key.PK, inp.Key.SK)) };
    if (cmd.type === 'put') { put(inp.Item); return {}; }
    if (cmd.type === 'delete') { store.delete(k(inp.Key.PK, inp.Key.SK)); return {}; }
    if (cmd.type === 'query') {
      const v = inp.ExpressionAttributeValues || {};
      const items = [...store.values()].filter(
        (i) => i.PK === v[':pk'] && String(i.SK).startsWith(String(v[':sk'] ?? ''))
      );
      return { Items: items, Count: items.length };
    }
    if (cmd.type === 'scan') {
      const v = inp.ExpressionAttributeValues || {};
      const items = [...store.values()].filter((i) => {
        if (v[':pk'] !== undefined && i.PK !== v[':pk']) return false;
        if (v[':isDefault'] !== undefined && i.isDefault !== v[':isDefault']) return false;
        return true;
      });
      return { Items: items, Count: items.length };
    }
    return { Items: [], Count: 0 };
  },
};

const noopClient = class { async send() { return {}; } };
// Bedrock must FAIL, deterministically and locally. Every check below reaches
// the deterministic fallback, which is the same path a real throttle takes and
// still carries debugInfo — the assembled prompt these tests read.
const throwingBedrock = class { async send() { throw new Error('stub: no Bedrock in tests'); } };

stubs.set('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stubs.set('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => fakeDoc },
  GetCommand, PutCommand, DeleteCommand, QueryCommand,
  ScanCommand, UpdateCommand, BatchWriteCommand,
});
stubs.set('@aws-sdk/client-s3', { S3Client: noopClient, GetObjectCommand: class {} });
stubs.set('@aws-sdk/client-lambda', { LambdaClient: noopClient, InvokeCommand: class {} });
stubs.set('@aws-sdk/client-bedrock-runtime', {
  BedrockRuntimeClient: throwingBedrock, InvokeModelCommand: class {},
});
stubs.set('@aws-sdk/client-apigatewaymanagementapi', {
  ApiGatewayManagementApiClient: noopClient, PostToConnectionCommand: class {},
});

process.env.TABLE_NAME = TABLE;
process.env.WEBSOCKET_API_ENDPOINT = 'https://ws.test.invalid/dev';

const aiSummary = require(path.join(REPO, 'lambda-functions', 'game', 'get-ai-summary.js'));
const { generateAISummary, resolvePromptTemplate, handler: getAiSummary } = aiSummary;
const createReport = require(path.join(REPO, 'lambda-functions', 'game', 'create-report.js')).handler;

Module._load = realLoad; // restore — nothing after this point needs the hook

// The handlers are extremely chatty. Keep the harness's own output readable.
const say = (...a) => process.stdout.write(a.join(' ') + '\n');
if (!process.env.DEBUG) { console.log = () => {}; console.warn = () => {}; console.error = () => {}; }

let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); say(`  PASS  ${label}`); pass++; }
  catch (e) { say(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

// This file is CommonJS, so every await below lives inside one async IIFE.
(async () => {

// ---------------------------------------------------------------------------
// 1. DEFECT 1 — no fabricated participation figure reaches the model
// ---------------------------------------------------------------------------
say('\n1. The prompt states no participation percentage');

// A template that references BOTH tokens inside brackets, so the resolved
// prompt shows exactly what each one contributed.
const PROBE_TEMPLATE =
  'Participation:[{participationRate}] Voting:[{votingParticipation}]\n' +
  '=== SUMMARY ===\nx\n=== DISCUSSION QUESTIONS ===\nQ1: x\n=== NEXT STEPS ===\nSTEP1: x';

function seedProbePrompt() {
  put({ PK: 'AIPROMPTS', SK: 'AIPROMPT#probe', s3Key: 'fake-key', template: PROBE_TEMPLATE });
}

const probeArgs = {
  eventTitle: 'Retro', gameType: 'call-and-answer', gameAiContext: '', questionSetAiContext: '',
  customInstruction: '', promptId: 'probe', promptProvenance: { hierarchy: [] }, debugMode: true,
  questionId: '001', question: { title: 'What should we stop doing?' },
  results: { voteTallies: {}, winners: [], totalVotes: 0 },
  gameId: 'probe-1', questionSetId: null, paddedQuestionNumber: '001',
  scoringConfig: { firstPlacePoints: 3, secondPlacePoints: 2, thirdPlacePoints: 1 },
  hostPersonaId: null, setPersonaId: null, hidden: false, storedResults: null,
};

store.clear();
seedProbePrompt();

// The 100%-by-construction case: two answers, nobody voted. The old code
// emitted "100% answered, 100% voted" and "100%" here.
const noVotes = await generateAISummary({
  ...probeArgs,
  answers: [{ playerName: 'Ada', answer: 'a' }, { playerName: 'Grace', answer: 'b' }],
  votes: [],
});

await check('participationRate contributes nothing to the prompt', () =>
  assert.strictEqual(noVotes.debugInfo.templateVariables.participationRate, '',
    'a round where everyone who answered IS the denominator cannot report a rate of anything'));

await check('votingParticipation contributes nothing to the prompt', () =>
  assert.strictEqual(noVotes.debugInfo.templateVariables.votingParticipation, ''));

await check('the assembled prompt carries no participation figure at all', () => {
  const p = noVotes.debugInfo.fullPrompt;
  assert.ok(p.includes('Participation:[]') && p.includes('Voting:[]'),
    `a figure survived into the live prompt: ${p.split('\n')[0]}`);
  assert.ok(!/\d+%\s*(answered|voted)/i.test(p), `"% answered/% voted" is back: ${p.split('\n')[0]}`);
});

// The deletion must not be done by dropping the keys: an unresolved token goes
// to the model — and onto a projector — as literal `{participationRate}`.
await check('neither token is left unresolved (deleting the keys is not the fix)', () =>
  assert.deepStrictEqual(
    noVotes.debugInfo.unresolvedVariables.filter(
      (n) => n === 'participationRate' || n === 'votingParticipation'),
    [],
    'template-variables.js still advertises these to prompt authors; a key that is gone ' +
    'renders as literal braces in front of a room'));

// A round WITH votes: the old votingParticipation was votes-per-answer, which
// is not a rate of people either. It must be gone too, not merely gone when it
// would have read 100%.
const withVotes = await generateAISummary({
  ...probeArgs,
  gameId: 'probe-2',
  answers: [{ playerName: 'Ada', answer: 'a' }, { playerName: 'Grace', answer: 'b' }],
  votes: [{ PlayerName: 'Ada', Votes: { 0: 1 } }],
});

await check('a voted round reports no figure either', () => {
  const t = withVotes.debugInfo.templateVariables;
  assert.strictEqual(t.votingParticipation, '');
  assert.strictEqual(t.participationRate, '');
});

// The figures also lived in the hardcoded lessons-learned template that ships
// inside get-ai-summary.js, under a "VOTING INSIGHTS" heading.
promptTableIsDown = true;
const hardcoded = await resolvePromptTemplate('lessons-learned', 'call-and-answer');
promptTableIsDown = false;

await check('the built-in lessons-learned template still resolves (this check is not vacuous)', () =>
  assert.ok(hardcoded && hardcoded.promptData && hardcoded.promptData.template,
    'could not reach the hardcoded template, so the two checks below prove nothing'));

await check('the built-in template no longer asks the model to read a participation figure', () =>
  assert.ok(!hardcoded.promptData.template.includes('{votingParticipation}'),
    'the hardcoded prompt interpolates the figure again'));

await check('removing it left no dangling "Participation:" label', () =>
  assert.ok(!/^-\s*Participation:/m.test(hardcoded.promptData.template),
    'a bare "- Participation:" bullet with nothing after it reads as a missing value, ' +
    'which is its own lie'));

// ---------------------------------------------------------------------------
// 2. DEFECT 2 — the wavelength branch actually runs
// ---------------------------------------------------------------------------
say('\n2. A wavelength round survives exports.handler');

const WAVE_TEMPLATE =
  'TALLY: {voteTally}\nWORDS: {wavelengthWords}\n' +
  '=== SUMMARY ===\nx\n=== DISCUSSION QUESTIONS ===\nQ1: x\n=== NEXT STEPS ===\nSTEP1: x';

/**
 * A finished wavelength round, seeded so exports.handler reaches the branch.
 *
 * Worker mode (`__workerMode: true`) on purpose: the HTTP path returns 202 and
 * self-invokes without ever generating, so it never executes the vote-tally
 * pass this section exists to cover. Worker mode also RETHROWS on failure, so
 * the pre-fix ReferenceError surfaces here as a rejected promise rather than
 * being flattened into a 500 body.
 */
function seedWavelength(gameId, { storedWordAnalysis = null } = {}) {
  store.clear();
  put({ PK: 'AIPROMPTS', SK: 'AIPROMPT#wave-prompt', s3Key: 'fake-key', template: WAVE_TEMPLATE });
  put({
    PK: `GAME#${gameId}`, SK: 'METADATA', GameType: 'wavelength', Title: 'Wavelength Night',
    QuestionSetId: 'wave-set',
    // Attribution on: the redaction path is covered in anonymous-round-flow.js;
    // here the scores must be readable so the team score can be asserted.
    HostPreferences: { anonymousUntilReveal: false },
  });
  put({ PK: `GAME#${gameId}`, SK: 'STATE', State: 'RESULTS#001', CurrentQuestionId: '001' });
  put({ PK: 'SETS', SK: 'SET#wave-set', SetName: 'Waves', promptId: 'wave-prompt' });
  put({ PK: `GAME#${gameId}`, SK: 'QUESTION#001#REF', SourceQuestionId: 'QUESTION#001', SetId: 'wave-set' });
  put({ PK: 'SET#wave-set', SK: 'QUESTION#001', Title: 'Pick a word', Category: 'General' });
  put({ PK: `GAME#${gameId}`, SK: 'QUESTION#001#ANSWER#Ada', PlayerName: 'Ada', Answer: 'ocean,blue' });
  put({ PK: `GAME#${gameId}`, SK: 'QUESTION#001#ANSWER#Grace', PlayerName: 'Grace', Answer: 'ocean,tide' });
  if (storedWordAnalysis) {
    put({ PK: `GAME#${gameId}`, SK: 'QUESTION#001#RESULTS', wordAnalysis: storedWordAnalysis });
  }
}

const runWorker = (gameId) =>
  getAiSummary({ __workerMode: true, gameId, questionId: '001', debug: 'true', promptDebug: 'true' });

/** What the handler persisted, which is what the report and the room later read. */
const storedSummary = (gameId) => store.get(k(`GAME#${gameId}`, 'QUESTION#001#AISummary'));

// 2a. The crash itself. Pre-fix this rejects with
// "commonWords is not defined" before a single word of summary is produced.
seedWavelength('w-1', {
  storedWordAnalysis: {
    commonWords: [{ word: 'ocean', count: 2 }],
    totalUniqueWords: 3, connectionScore: 33,
  },
});
let waveResult, waveError = null;
try { waveResult = await runWorker('w-1'); } catch (e) { waveError = e; }

await check('the wavelength vote-tally pass runs without a ReferenceError', () => {
  assert.strictEqual(waveError, null,
    `wavelength generation threw: ${waveError && waveError.message}`);
  assert.ok(waveResult && waveResult.ok === true,
    `expected the worker to finish, got ${JSON.stringify(waveResult)}`);
});

await check('a summary was actually persisted for the round', () =>
  assert.ok(storedSummary('w-1'), 'nothing reached the table, so the round has no Field Notes'));

// 2b. The value is the RIGHT one, not a constant. The team score is the number
// of common words in the stored word analysis — one here — and it reaches the
// per-player tallies the prompt is built from.
await check('the team score comes from the stored word analysis (1 common word → 1)', () => {
  const tally = storedSummary('w-1').DebugInfo.templateVariables.voteTally;
  assert.ok(/\b1 vote points\b/.test(tally),
    `expected every player to carry the team score of 1, got: ${tally}`);
});

seedWavelength('w-2', {
  storedWordAnalysis: {
    commonWords: [{ word: 'ocean', count: 2 }, { word: 'blue', count: 2 }],
    totalUniqueWords: 3, connectionScore: 67,
  },
});
// Swallowed on purpose: a throw here is the SAME defect 2a already reports,
// and letting it escape the IIFE would take the remaining checks with it.
await runWorker('w-2').catch(() => {});
await check('two common words give a team score of 2 (so the count is read, not hardcoded)', () => {
  const summary = storedSummary('w-2');
  assert.ok(summary, 'the round produced no summary at all');
  const tally = summary.DebugInfo.templateVariables.voteTally;
  assert.ok(/\b2 vote points\b/.test(tally), `expected a team score of 2, got: ${tally}`);
});

// 2c. No stored word analysis: the count is genuinely unavailable here, so the
// round must still finish and report 0 rather than crash or guess.
seedWavelength('w-3');                         // no QUESTION#001#RESULTS row at all
let bareResult, bareError = null;
try { bareResult = await runWorker('w-3'); } catch (e) { bareError = e; }

await check('a wavelength round with no stored results still completes', () => {
  assert.strictEqual(bareError, null,
    `a missing RESULTS record must not be fatal: ${bareError && bareError.message}`);
  assert.ok(bareResult && bareResult.ok === true);
});

await check('with nothing stored, the team score is 0 rather than invented', () => {
  const tally = storedSummary('w-3').DebugInfo.templateVariables.voteTally;
  assert.ok(/\b0 vote points\b/.test(tally), `expected an explicit 0, got: ${tally}`);
});

// A non-wavelength round must be untouched by the fix.
store.clear();
seedProbePrompt();
const stillFine = await generateAISummary({
  ...probeArgs,
  answers: [{ playerName: 'Ada', answer: 'a' }],
  votes: [],
});
await check('a call-and-answer round is unaffected by the wavelength change', () =>
  assert.ok(stillFine.debugInfo && stillFine.debugInfo.fullPrompt));

// ---------------------------------------------------------------------------
// 3. DEFECT 3 — the report counts people, not rows
// ---------------------------------------------------------------------------
say('\n3. gameStats.totalPlayers counts players');

const RGAME = '4242';

/**
 * Three players, each writing the three rows a real session writes under the
 * PLAYER# prefix. `players.length` sees nine.
 */
function seedReport({ extraJoinRowFor = null } = {}) {
  store.clear();
  put({
    PK: `GAME#${RGAME}`, SK: 'METADATA', GameId: RGAME, Title: 'Retro Night',
    GameType: 'call-and-answer', QuestionSetId: 'retro', HostName: 'Ada',
    CreatedAt: '2026-08-01T00:00:00.000Z',
  });
  put({ PK: `GAME#${RGAME}`, SK: 'STATE', State: 'RESULTS#001', LessonNumber: 1 });
  for (const name of ['Ada', 'Grace', 'Kay']) {
    put({ PK: `GAME#${RGAME}`, SK: `PLAYER#${name}`, PlayerName: name, JoinedAt: '2026-08-01T00:01:00.000Z' });
    put({ PK: `GAME#${RGAME}`, SK: `PLAYER#${name}#SCORE`, PlayerName: name, score: 3 });
    put({ PK: `GAME#${RGAME}`, SK: `PLAYER#${name}#STATE`, PlayerName: name, State: 'ANSWERED' });
  }
  if (extraJoinRowFor) {
    // A reconnect writing a second main row for the same person.
    put({
      PK: `GAME#${RGAME}`, SK: `PLAYER#${extraJoinRowFor}#2`,
      PlayerName: extraJoinRowFor, JoinedAt: '2026-08-01T00:09:00.000Z',
    });
  }
  put({ PK: `GAME#${RGAME}`, SK: 'QUESTION#001#RESULTS', QuestionNumber: '001' });
  put({ PK: `GAME#${RGAME}`, SK: 'QUESTION#001#ANSWER#Ada', PlayerName: 'Ada', Answer: 'a' });
}

seedReport();
const report = JSON.parse((await createReport({ pathParameters: { gameId: RGAME } })).body).report;

await check('three players in the room are three players on the report', () =>
  assert.strictEqual(report.gameStats.totalPlayers, 3,
    'PLAYER#, PLAYER#...#SCORE and PLAYER#...#STATE are three rows per person, not three people'));

await check('totalPlayers matches the list the report actually renders', () =>
  assert.strictEqual(report.gameStats.totalPlayers, report.playerPerformance.length,
    'the headline count and the per-player table must be the same set of people'));

seedReport({ extraJoinRowFor: 'Grace' });
const rejoined = JSON.parse((await createReport({ pathParameters: { gameId: RGAME } })).body).report;

await check('a player who rejoined is still one player', () =>
  assert.strictEqual(rejoined.gameStats.totalPlayers, 3,
    'the count must use the deduplicated set, not the raw main-record list'));

await check('the rest of gameStats is unchanged', () => {
  assert.strictEqual(rejoined.gameStats.totalQuestions, 1);
  assert.strictEqual(rejoined.gameStats.totalAnswers, 1);
  assert.strictEqual(rejoined.gameStats.totalVotes, 0);
});

// ---------------------------------------------------------------------------
// 4. DEFECT 4 — votesGiven was 0 for everybody, in every report ever produced
// ---------------------------------------------------------------------------
//
// BOTH writers of a VOTE# row stamp the voter as `VoterName`
// (game/submit-vote.js:61, websocket/submit-votes.js:28). Neither writes
// PlayerName. create-report.js filtered `v.PlayerName || v.playerName`, which
// matched nothing, so the per-player `votesGiven` column was structurally zero
// — not "nobody voted", but "this number cannot be anything else".
// get-votes.js:79 already read `VoterName || PlayerName`; the report was the
// one place that did not.
say('\n4. votesGiven reflects votes actually cast');

const VGAME = '5150';

function seedVotes() {
  store.clear();
  put({
    PK: `GAME#${VGAME}`, SK: 'METADATA', GameId: VGAME, Title: 'Ballot Night',
    GameType: 'call-and-answer', QuestionSetId: 'retro', HostName: 'Ada',
    CreatedAt: '2026-08-01T00:00:00.000Z',
  });
  put({ PK: `GAME#${VGAME}`, SK: 'STATE', State: 'RESULTS#001', LessonNumber: 1 });
  for (const name of ['Ada', 'Grace', 'Kay']) {
    put({ PK: `GAME#${VGAME}`, SK: `PLAYER#${name}`, PlayerName: name, JoinedAt: '2026-08-01T00:01:00.000Z' });
    put({ PK: `GAME#${VGAME}`, SK: `PLAYER#${name}#SCORE`, PlayerName: name, score: 3 });
  }
  put({ PK: `GAME#${VGAME}`, SK: 'QUESTION#001#RESULTS', QuestionNumber: '001' });
  put({ PK: `GAME#${VGAME}`, SK: 'QUESTION#001#ANSWER#Ada', PlayerName: 'Ada', Answer: 'a' });
  put({ PK: `GAME#${VGAME}`, SK: 'QUESTION#001#ANSWER#Grace', PlayerName: 'Grace', Answer: 'b' });
  // Exactly the row shape submit-vote.js writes: VoterName, no PlayerName.
  put({
    PK: `GAME#${VGAME}`, SK: 'QUESTION#001#VOTE#Ada',
    VoterName: 'Ada', QuestionNumber: '001', Votes: ['b'],
  });
  put({
    PK: `GAME#${VGAME}`, SK: 'QUESTION#001#VOTE#Grace',
    VoterName: 'Grace', QuestionNumber: '001', Votes: ['a'],
  });
  // Kay never voted, so the column has to distinguish 1 from 0 to be worth anything.
}

seedVotes();
const voteReport = JSON.parse((await createReport({ pathParameters: { gameId: VGAME } })).body).report;
const byName = (n) => voteReport.playerPerformance.find(
  (p) => (p.playerName || p.PlayerName) === n);

// rejects: filtering vote rows on PlayerName, which no writer ever sets.
await check('a player who voted has votesGiven 1, not 0', () =>
  assert.strictEqual(byName('Ada').votesGiven, 1,
    'VOTE# rows carry VoterName; filtering on PlayerName matches nothing'));

// rejects: "fixing" it by counting all vote rows for everyone.
await check('a player who did not vote still has votesGiven 0', () =>
  assert.strictEqual(byName('Kay').votesGiven, 0,
    'Kay cast no ballot; a fix that counts every row would give her 2'));

await check('the column distinguishes voters from non-voters at all', () => {
  const values = voteReport.playerPerformance.map((p) => p.votesGiven);
  assert(new Set(values).size > 1,
    `every player has the same votesGiven (${values.join(', ')}), so the column carries no information`);
});

say(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

})().catch((e) => {
  // A throw out here is not a failed assertion — it is the harness itself
  // dying, which would otherwise print no result line and vanish silently from
  // the aggregate.
  say(`\nHARNESS ERROR: ${e && e.stack}`);
  say(`\n${pass} passed, ${fail + 1} failed`);
  process.exit(1);
});
