/**
 * What the AI is told about who got the trivia question right.
 *
 * get-ai-summary.js does NOT read the IsCorrect that websocket/message.js
 * wrote. It recomputes correctness from scratch, and its copy carried both of
 * the bugs the scorer carried:
 *
 *     if (correctAnswerValue.startsWith('Option')) {
 *       const correctLetter = correctAnswerValue.replace('Option', '');
 *       isCorrect = playerAnswer === correctLetter;
 *     }
 *
 *   - `playerAnswer` is the POSITIONAL letter the phone drew and `correctLetter`
 *     is the SLOT the set stores, so a question with a hole in its slots was
 *     tallied against the wrong option — exactly as scoring was;
 *   - `startsWith('Option')` is case-sensitive and nothing else in the branch
 *     understands a slot id, so `optionb`, `Option B`, a bare letter and the
 *     option's own TEXT all fell through to a raw string compare against the
 *     drawn letter and tallied NOBODY.
 *
 * The consequence is not a silent one. `correctCount` becomes
 * "{n} of {total} players correct ({p}%)" in the prompt, so the room is read a
 * summary that says nobody answered a question they all got right.
 *
 * The tally is asserted through the real exported function rather than through
 * generateAISummary, whose other thousand lines of prompt resolution, persona
 * lookup and Bedrock round trip have nothing to do with this decision.
 */
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');

const STUB_PATHS = [
  REPO,
  path.join(REPO, 'lambda-functions'),
  path.join(REPO, 'lambda-functions', 'game'),
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

// This file touches none of these; they are stubbed only so the module loads
// without reaching for AWS credentials.
const nul = class { async send() { return {}; } };
const cmd = class { constructor(i) { this.input = i; } };
stub('@aws-sdk/client-bedrock-runtime', { BedrockRuntimeClient: nul, InvokeModelCommand: cmd });
stub('@aws-sdk/client-dynamodb', { DynamoDBClient: nul });
stub('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => new nul() },
  GetCommand: cmd, PutCommand: cmd, QueryCommand: cmd,
  ScanCommand: cmd, DeleteCommand: cmd,
});
stub('@aws-sdk/client-s3', { S3Client: nul, GetObjectCommand: cmd });
stub('@aws-sdk/client-lambda', { LambdaClient: nul, InvokeCommand: cmd });
stub('@aws-sdk/client-apigatewaymanagementapi', {
  ApiGatewayManagementApiClient: nul, PostToConnectionCommand: cmd,
});

process.env.TABLE_NAME = 'test-table';

const { tallyTriviaCorrectness, describeCorrectAnswer } =
  require(path.join(REPO, 'lambda-functions/game/get-ai-summary.js'));

let pass = 0, fail = 0;
function check(label, fn) {
  try { fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

/** optionB is empty, so the room draws optionA as A, optionC as B, optionD as C. */
const GAPPED = { optionA: 'Mercury', optionC: 'Jupiter', optionD: 'Neptune' };
const SOLID = { optionA: 'Mercury', optionB: 'Jupiter', optionC: 'Neptune', optionD: 'Saturn' };

const said = (playerName, answer) => ({ PlayerName: playerName, Answer: answer });

(async () => {

console.log('\n1. a question with a hole in its slots');

check('a room that all answered correctly is not reported as nobody', () => {
  const q = { ...GAPPED, correctAnswer: 'OptionC' };
  const tally = tallyTriviaCorrectness(q, [said('Ada', 'B'), said('Bob', 'B'), said('Cy', 'B')]);
  assert.strictEqual(tally.correctCount, 3,
    'all three picked the correct option, drawn as B; the tally compared that ' +
    "B against the slot letter C and told the room 0 of 3 were right");
});

check('the player who picked a WRONG option is not counted', () => {
  const q = { ...GAPPED, correctAnswer: 'OptionC' };
  const tally = tallyTriviaCorrectness(q, [said('Bob', 'C')]);
  assert.strictEqual(tally.correctCount, 0,
    "Bob picked optionD, drawn as C; reading 'C' as the optionC slot credited him");
});

check('and the right players are named', () => {
  const q = { ...GAPPED, correctAnswer: 'OptionC' };
  const tally = tallyTriviaCorrectness(q, [said('Ada', 'B'), said('Bob', 'C')]);
  assert.deepStrictEqual(tally.correctPlayers.map((p) => p.playerName), ['Ada']);
});

console.log('\n2. every way a set records which option is right');

for (const stored of ['OptionB', 'optionb', 'OPTIONB', 'Option B', 'B', 'b', 'Jupiter', 'jupiter']) {
  check(`${JSON.stringify(stored)} tallies the player who tapped that option`, () => {
    const tally = tallyTriviaCorrectness({ ...SOLID, correctAnswer: stored }, [said('Ada', 'B')]);
    assert.strictEqual(tally.correctCount, 1);
  });
}

check('a different slot tallies nobody', () => {
  const tally = tallyTriviaCorrectness({ ...SOLID, correctAnswer: 'OptionC' }, [said('Ada', 'B')]);
  assert.strictEqual(tally.correctCount, 0);
});

check('an array of spellings is read', () => {
  const q = { ...SOLID, correctAnswer: ['optionb', 'Option D'] };
  const tally = tallyTriviaCorrectness(q, [said('Ada', 'B'), said('Bob', 'D'), said('Cy', 'C')]);
  assert.strictEqual(tally.correctCount, 2);
  assert.deepStrictEqual(tally.correctPlayers.map((p) => p.playerName), ['Ada', 'Bob']);
});

console.log('\n3. the shapes the rows actually arrive in');

check('a lower-case answer/playerName row is read', () => {
  const q = { ...SOLID, correctAnswer: 'OptionB' };
  const tally = tallyTriviaCorrectness(q, [{ playerName: 'Ada', answer: 'B' }]);
  assert.strictEqual(tally.correctCount, 1);
  assert.deepStrictEqual(tally.correctPlayers.map((p) => p.playerName), ['Ada']);
});

check('no answers tallies nothing rather than throwing', () => {
  assert.strictEqual(tallyTriviaCorrectness({ ...SOLID, correctAnswer: 'OptionB' }, []).correctCount, 0);
  assert.strictEqual(tallyTriviaCorrectness({ ...SOLID, correctAnswer: 'OptionB' }).correctCount, 0);
});

check('a question saying nothing about its answer tallies nobody', () => {
  assert.strictEqual(tallyTriviaCorrectness({ ...SOLID }, [said('Ada', 'B')]).correctCount, 0);
  assert.strictEqual(tallyTriviaCorrectness(null, [said('Ada', 'B')]).correctCount, 0);
});

// The distribution is keyed by what the room SAW, which is the letter the
// player sent — it is printed back to the AI as "B: 3 players".
check('the response distribution counts the drawn letters', () => {
  const q = { ...GAPPED, correctAnswer: 'OptionC' };
  const tally = tallyTriviaCorrectness(q, [said('Ada', 'B'), said('Bob', 'B'), said('Cy', 'A')]);
  assert.deepStrictEqual(tally.responseDistribution, { B: 2, A: 1 });
});

console.log('\n4. the sentence the prompt is handed about the answer');

// The letter in this sentence is read back to the room, so it has to be the
// letter the room SAW. The old line sliced it off the slot id, which on a
// gapped question names a different option than the one it then prints.
check('names the DRAWN letter, not the slot it is stored under', () => {
  assert.strictEqual(
    describeCorrectAnswer({ ...GAPPED, correctAnswer: 'OptionC' }),
    'The correct answer is B: Jupiter');
});

check('a loose spelling still produces the sentence', () => {
  assert.strictEqual(
    describeCorrectAnswer({ ...SOLID, correctAnswer: 'optionb' }),
    'The correct answer is B: Jupiter');
});

check("the option's own text still produces the sentence", () => {
  assert.strictEqual(
    describeCorrectAnswer({ ...SOLID, correctAnswer: 'Jupiter' }),
    'The correct answer is B: Jupiter');
});

// An array is what every trivia builder writes for a multi-answer question,
// and the old line called `.startsWith` on it — a TypeError thrown out of
// generateAISummary, which has no try around this, so the summary died.
check('an array of answers does not throw', () => {
  assert.strictEqual(
    describeCorrectAnswer({ ...SOLID, correctAnswer: ['optionb', 'Option D'] }),
    'The correct answers are B: Jupiter and D: Saturn');
});

check('says the raw value when it can place nothing, rather than a wrong letter', () => {
  assert.strictEqual(describeCorrectAnswer({ ...SOLID, correctAnswer: 'who knows' }), 'who knows');
});

check('says nothing at all when the set says nothing', () => {
  assert.strictEqual(describeCorrectAnswer({ ...SOLID }), '');
  assert.strictEqual(describeCorrectAnswer(null), '');
});

// The set names optionB, which THIS question leaves empty. The projector marks
// the option DRAWN as B (questionCard.js matches by key and by drawn letter),
// the scorer pays it, and the summary must name that same option.
check('an answer naming an empty slot names the option the projector marks', () => {
  assert.strictEqual(
    describeCorrectAnswer({ ...GAPPED, correctAnswer: 'OptionB' }),
    `The correct answer is B: ${GAPPED.optionC}`);
});

// Only an answer no reading can place is repeated as the set wrote it.
check('an answer that places nowhere does not invent a letter', () => {
  assert.strictEqual(describeCorrectAnswer({ ...GAPPED, correctAnswer: 'OptionF' }), 'OptionF');
});

// The template-variable FALLBACK used to carry its own copy of the old reader:
// `.startsWith('Option')` on a value that is an ARRAY for every multi-answer
// question (a TypeError), and the slot letter printed as though it were the
// drawn one. One decoder means no second reader anywhere in this file.
check('no code path in get-ai-summary.js still decodes the answer by hand', () => {
  const source = require('fs').readFileSync(
    require('path').join(__dirname, '../lambda-functions/game/get-ai-summary.js'), 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/startsWith\('Option'\)/.test(code), "a hand-rolled startsWith('Option') reader remains");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

})();
