/**
 * Who actually gets the point for a trivia answer.
 *
 * TWO BUGS LIVE HERE, and websocket/message.js is the only place either one
 * decides anything: it writes IsCorrect and PointsEarned onto the ANSWER row,
 * and game/get-results.js then ACCUMULATES PointsEarned into the running
 * per-player score. Nothing recomputes it afterwards, so a wrong verdict at
 * this instant is the score the room goes home with.
 *
 * The line under test built a SLOT ID out of a POSITIONAL letter:
 *
 *     isCorrect = correctAnswer === `Option${answer}`
 *
 * BUG 1 — ONLY THE EXACT `OptionX` SPELLING EVER SCORED. Sets in the wild
 * record the answer several ways and this was the only reader that accepted
 * one of them. config/hostRemote.js `correctOptionIndex` has always read
 * `/^option\s*([A-F])$/i`, a bare letter, and the option's own TEXT; and
 * config/setupPanel.js records that sets store the TEXT "as often as they
 * record it as OptionB". admin/upload-questions.js stores the CorrectAnswer
 * cell of an uploaded CSV verbatim — `question.CorrectAnswer || ''`, no
 * validation of any kind — so a hand-authored CSV lands any of them in the
 * table. For such a set the projector marked the right option, the host's
 * phone marked it, and every player in the room scored 0 for a question they
 * had answered correctly.
 *
 * BUG 2, AND IT IS WORSE, because it credits the WRONG PLAYER rather than
 * nobody, and it does so for the mandated `OptionX` spelling too. The stage
 * letters only the FILLED slots, by position among them — PlayerPage.jsx
 * filters the six option keys on truthiness and THEN letters what is left, so
 * a question filling optionA, optionC and optionD is drawn A, B, C. The phone
 * submits that positional letter. `Option${answer}` reads it as a slot id:
 *
 *     picked the correct option (optionC, drawn B) -> 'B' -> 'OptionB' -> WRONG
 *     picked optionD           (drawn C)           -> 'C' -> 'OptionC' -> RIGHT
 *
 * One player is robbed and another is paid for an answer they did not give.
 *
 * FIXTURES ARE PRODUCED, NOT WRITTEN. The ANSWER row asserted on is whatever
 * the real websocket message.js writes, reached over the real handler with a
 * real REF row and a real set partition. A test that hand-wrote the row would
 * keep passing after the writer changed, which is the failure it exists to
 * catch.
 */
const path = require('path');
const assert = require('assert');
const fs = require('fs');

const REPO = path.join(__dirname, '..');

// ---- Stubs, installed before any handler loads -----------------------------
class PutCommand { constructor(i) { this.input = i; this.type = 'put'; } }
class GetCommand { constructor(i) { this.input = i; this.type = 'get'; } }
class QueryCommand { constructor(i) { this.input = i; this.type = 'query'; } }
class DeleteCommand { constructor(i) { this.input = i; this.type = 'delete'; } }
class UpdateCommand { constructor(i) { this.input = i; this.type = 'update'; } }
class PostToConnectionCommand { constructor(i) { this.input = i; } }

const store = new Map();
const key = (pk, sk) => `${pk}|${sk}`;

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
        let items = [...store.values()].filter(
          (i) => i.PK === pk && String(i.SK).startsWith(String(prefix))
        );
        const filter = String(inp.FilterExpression || '');
        if (/ConnectionType\s*=\s*:type/.test(filter)) {
          items = items.filter((i) => i.ConnectionType === inp.ExpressionAttributeValues[':type']);
        }
        if (/ConnectionType\s*=\s*:ct/.test(filter)) {
          items = items.filter((i) => i.ConnectionType === inp.ExpressionAttributeValues[':ct']);
        }
        return { Items: items, Count: items.length };
      }
      default:
        return {};
    }
  },
};

class FakeApiGatewayClient {
  async send() { return {}; }
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
  PutCommand, GetCommand, QueryCommand, DeleteCommand, UpdateCommand,
});
stub('@aws-sdk/client-apigatewaymanagementapi', {
  ApiGatewayManagementApiClient: FakeApiGatewayClient,
  PostToConnectionCommand,
});

process.env.TABLE_NAME = 'test-table';
process.env.WEBSOCKET_API_ENDPOINT = 'https://ws.test.invalid/dev';

const WS_COPY = path.join(REPO, 'lambda-functions/websocket/trivia-answer.js');
const GAME_COPY = path.join(REPO, 'lambda-functions/game/trivia-answer.js');

const wsMessage = require(path.join(REPO, 'lambda-functions/websocket/message.js')).handler;
const { drawnOptions, slotForSubmitted, correctSlots, isAnswerCorrect } = require(WS_COPY);

// ---- Tiny harness ----------------------------------------------------------
let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const put = (item) => store.set(key(item.PK, item.SK), item);

/**
 * A trivia game sitting on ASK#001 with one question, seeded through the same
 * rows the handler really reads: the REF row it looks the question up by, and
 * the legacy (unversioned) set partition resolveSetPartition falls through to
 * when the set has no metadata row.
 */
function seedTrivia(gameId, question) {
  store.clear();
  put({
    PK: `GAME#${gameId}`, SK: 'METADATA',
    GameType: 'trivia', Title: 'Test session', Started: true,
  });
  put({
    PK: `GAME#${gameId}`, SK: 'STATE',
    State: 'ASK#001', LessonNumber: 1, CurrentQuestionId: '001',
  });
  put({
    PK: `GAME#${gameId}`, SK: 'CONNECTION#player-1',
    ConnectionId: 'player-1', ConnectionType: 'PLAYER', PlayerName: 'Ada',
  });
  put({
    PK: `GAME#${gameId}`, SK: 'QUESTION#001#REF',
    SourceQuestionId: 'QUESTION#general#001',
    SetId: 'set-under-test',
    StartedAt: new Date().toISOString(),
  });
  put({
    PK: 'SET#set-under-test', SK: 'QUESTION#general#001',
    points: 10,
    ...question,
  });
}

/** Run the REAL websocket handler, then read back the row it wrote. */
async function scoreAnswer(gameId, playerName, submitted) {
  await wsMessage({
    requestContext: { connectionId: 'player-1' },
    body: JSON.stringify({
      messageType: 'ANSWER#001', gameId, playerName,
      answer: submitted, answerType: 'trivia',
    }),
  });
  return store.get(key(`GAME#${gameId}`, `QUESTION#001#ANSWER#${playerName}`));
}

/**
 * The question this whole file exists for: a hole in the slots. optionB is
 * empty, so the room draws optionA as A, optionC as B and optionD as C.
 */
const GAPPED = {
  optionA: 'Mercury',
  optionC: 'Jupiter',
  optionD: 'Neptune',
};

/** No hole. Only the SPELLING of the stored answer is under test here. */
const SOLID = {
  optionA: 'Mercury',
  optionB: 'Jupiter',
  optionC: 'Neptune',
  optionD: 'Saturn',
};

(async () => {

console.log('\n1. a question with a hole in its slots — scored end to end');

await check('the player who picked the right option is scored CORRECT', async () => {
  // optionC is right. The room drew it as B, so the phone submitted 'B'.
  seedTrivia('7001', { ...GAPPED, correctAnswer: 'OptionC' });
  const row = await scoreAnswer('7001', 'Ada', 'B');
  assert.ok(row, 'no answer row was written at all');
  assert.strictEqual(row.IsCorrect, true,
    'the player picked the correct option and was marked wrong: ' +
    "'B' was read as the optionB slot, which this question leaves empty");
});

await check('…and is actually paid for it', async () => {
  seedTrivia('7002', { ...GAPPED, correctAnswer: 'OptionC' });
  const row = await scoreAnswer('7002', 'Ada', 'B');
  assert.ok(row.PointsEarned >= 10,
    `PointsEarned was ${row.PointsEarned}; get-results.js adds this straight ` +
    'into the running score, so a 0 here is a 0 on the leaderboard for ever');
});

// The other half of the same bug, and the reason it is worse than scoring
// nobody: the letter the robbed player should have had lands on someone else.
await check('the player who picked a WRONG option is not credited with it', async () => {
  // optionD is wrong. The room drew it as C, so the phone submitted 'C' —
  // which reads as the optionC slot, which is the correct one.
  seedTrivia('7003', { ...GAPPED, correctAnswer: 'OptionC' });
  const row = await scoreAnswer('7003', 'Bob', 'C');
  assert.strictEqual(row.IsCorrect, false,
    'a player who chose the wrong option was marked correct: ' +
    "'C' was read as the optionC slot rather than as the third option drawn");
});

await check('a wrong option earns nothing', async () => {
  seedTrivia('7004', { ...GAPPED, correctAnswer: 'OptionC' });
  const row = await scoreAnswer('7004', 'Bob', 'C');
  assert.strictEqual(row.PointsEarned, 0,
    `PointsEarned was ${row.PointsEarned} for a wrong answer`);
});

await check('the first option still scores when the hole is after it', async () => {
  seedTrivia('7005', { ...GAPPED, correctAnswer: 'OptionA' });
  const row = await scoreAnswer('7005', 'Ada', 'A');
  assert.strictEqual(row.IsCorrect, true);
});

await check('the last drawn option scores', async () => {
  seedTrivia('7006', { ...GAPPED, correctAnswer: 'OptionD' });
  const row = await scoreAnswer('7006', 'Ada', 'C');
  assert.strictEqual(row.IsCorrect, true,
    "optionD is drawn third, so 'C' is the letter that means it");
});

await check('a letter naming no drawn option scores nothing', async () => {
  seedTrivia('7007', { ...GAPPED, correctAnswer: 'OptionC' });
  const row = await scoreAnswer('7007', 'Ada', 'D');
  assert.strictEqual(row.IsCorrect, false,
    'only three options were drawn, so D names nothing the player could tap');
});

console.log('\n2. every way a set records which option is right');

// Each row: what the set stored, and whether the player who tapped the option
// drawn as B — optionB, "Jupiter" — should be scored correct.
const SPELLINGS = [
  ['OptionB', true, 'the spelling CLAUDE.md mandates'],
  ['optionb', true, 'lower-cased, which an imported CSV stores verbatim'],
  ['Optionb', true, 'mixed case'],
  ['OPTIONB', true, 'shouted'],
  ['Option B', true, "with a space — the \\s* in the phone's decoder says this is real"],
  ['  OptionB  ', true, 'padded, as a spreadsheet cell so often is'],
  ['B', true, 'a bare letter'],
  ['b', true, 'a bare lower-case letter'],
  ['Jupiter', true, "the option's own TEXT, which setupPanel.js says is as common"],
  ['jupiter', true, 'its text in another case'],
  ['OptionC', false, 'a different slot must NOT score'],
  ['C', false, 'a different bare letter must NOT score'],
  ['Neptune', false, "another option's text must NOT score"],
  ['', false, 'an empty answer scores nobody'],
];

for (const [stored, expected, why] of SPELLINGS) {
  await check(`${JSON.stringify(stored)} -> ${expected}  (${why})`, async () => {
    seedTrivia('7100', { ...SOLID, correctAnswer: stored });
    const row = await scoreAnswer('7100', 'Ada', 'B');
    assert.strictEqual(row.IsCorrect, expected);
  });
}

await check('an array of spellings is read, not just the mandated one', async () => {
  seedTrivia('7200', { ...SOLID, correctAnswer: ['optionb', 'Option D'] });
  const row = await scoreAnswer('7200', 'Ada', 'B');
  assert.strictEqual(row.IsCorrect, true,
    'the array branch compared entries against the exact slot id too');
});

await check('a second correct answer in the array also scores', async () => {
  seedTrivia('7201', { ...SOLID, correctAnswer: ['optionb', 'Option D'] });
  const row = await scoreAnswer('7201', 'Bob', 'D');
  assert.strictEqual(row.IsCorrect, true);
});

await check('an option NOT in the array does not score', async () => {
  seedTrivia('7202', { ...SOLID, correctAnswer: ['optionb', 'Option D'] });
  const row = await scoreAnswer('7202', 'Cy', 'C');
  assert.strictEqual(row.IsCorrect, false);
});

// The two bugs meet: a loose spelling AND a hole in the slots.
await check('a loose spelling on a gapped question resolves to the drawn letter', async () => {
  seedTrivia('7203', { ...GAPPED, correctAnswer: 'option c' });
  const row = await scoreAnswer('7203', 'Ada', 'B');
  assert.strictEqual(row.IsCorrect, true);
});

await check("a gapped question's answer stored as TEXT scores its drawn letter", async () => {
  seedTrivia('7204', { ...GAPPED, correctAnswer: 'Jupiter' });
  const row = await scoreAnswer('7204', 'Ada', 'B');
  assert.strictEqual(row.IsCorrect, true);
});

console.log('\n3. the decoder itself');

await check('drawnOptions letters the filled slots by position', () => {
  assert.deepStrictEqual(
    drawnOptions(GAPPED).map((o) => `${o.letter}=${o.slot}`),
    ['A=A', 'B=C', 'C=D']);
});

// Deliberately PlayerPage's rule and not hostRemote's. The phone filters the
// six keys on TRUTHINESS — `.filter((key) => currentQuestion[key])` — so a slot
// holding only spaces is drawn, occupies a letter and can be tapped, while
// remoteQuestionRow trims and would drop it. Scoring has to agree with the
// surface that PRODUCED the letter, or every option after the blank is off by
// one; get-question.js coerces a missing slot to '', so falsy means absent.
await check('drawnOptions counts a whitespace-only slot, because the phone draws it', () => {
  assert.deepStrictEqual(
    drawnOptions({ optionA: 'x', optionB: '   ', optionC: 'y' }).map((o) => `${o.letter}=${o.slot}`),
    ['A=A', 'B=B', 'C=C']);
});

await check('drawnOptions skips a slot that is absent or empty', () => {
  assert.deepStrictEqual(
    drawnOptions({ optionA: 'x', optionB: '', optionC: 'y' }).map((o) => `${o.letter}=${o.slot}`),
    ['A=A', 'B=C']);
});

await check('drawnOptions reads the upper-case spelling the table also holds', () => {
  // get-question.js reads `optionA || OptionA` because BOTH are in the table.
  assert.deepStrictEqual(
    drawnOptions({ OptionA: 'x', OptionC: 'y' }).map((o) => `${o.letter}=${o.slot}`),
    ['A=A', 'B=C']);
});

await check('slotForSubmitted turns the drawn letter into the slot', () => {
  assert.strictEqual(slotForSubmitted(GAPPED, 'B'), 'C');
});

await check('slotForSubmitted is unbothered by case or padding', () => {
  assert.strictEqual(slotForSubmitted(GAPPED, ' b '), 'C');
});

await check('slotForSubmitted refuses a letter nothing was drawn for', () => {
  assert.strictEqual(slotForSubmitted(GAPPED, 'D'), null);
});

await check('slotForSubmitted refuses junk rather than guessing', () => {
  assert.strictEqual(slotForSubmitted(GAPPED, ''), null);
  assert.strictEqual(slotForSubmitted(GAPPED, null), null);
  assert.strictEqual(slotForSubmitted(GAPPED, 'Jupiter'), null);
});

await check('correctSlots answers in SLOTS, never in drawn letters', () => {
  assert.deepStrictEqual(correctSlots({ ...GAPPED, correctAnswer: 'OptionC' }), ['C']);
});

await check('correctSlots resolves a bare letter as a slot, as the phone does', () => {
  // correctOptionIndex indexes OPTION_KEYS with it, so a stored 'C' means the
  // optionC slot — the column an author typed into — not the third drawn.
  assert.deepStrictEqual(correctSlots({ ...GAPPED, correctAnswer: 'C' }), ['C']);
});

await check('correctSlots resolves the option text to its slot', () => {
  assert.deepStrictEqual(correctSlots({ ...GAPPED, correctAnswer: ' JUPITER ' }), ['C']);
});

await check('correctSlots returns every slot an array names', () => {
  assert.deepStrictEqual(
    correctSlots({ ...SOLID, correctAnswer: ['optionb', 'D', 'Neptune'] }),
    ['B', 'C', 'D']);
});

await check('correctSlots says nothing rather than guessing', () => {
  assert.deepStrictEqual(correctSlots({ ...SOLID, correctAnswer: 'who knows' }), []);
  assert.deepStrictEqual(correctSlots({ ...SOLID }), []);
  assert.deepStrictEqual(correctSlots({ ...SOLID, correctAnswer: null }), []);
  assert.deepStrictEqual(correctSlots(), []);
});

await check('correctSlots reads the CorrectAnswer spelling upload-questions writes', () => {
  assert.deepStrictEqual(correctSlots({ ...SOLID, CorrectAnswer: 'OptionB' }), ['B']);
});

// No writer produces the PLURAL field — every builder puts an array in the
// singular one — but get-ai-summary.js has always read it, and dropping a read
// is a regression even when nothing exercises it today.
await check('correctSlots also reads the vestigial plural field', () => {
  assert.deepStrictEqual(correctSlots({ ...SOLID, correctAnswers: ['OptionB'] }), ['B']);
  assert.deepStrictEqual(correctSlots({ ...SOLID, CorrectAnswers: ['C'] }), ['C']);
});

await check('the singular field wins when both are present', () => {
  assert.deepStrictEqual(
    correctSlots({ ...SOLID, correctAnswer: 'OptionB', correctAnswers: ['OptionD'] }), ['B']);
});

// A set naming a slot its own question left empty. Nobody can tap that slot, so
// the projector (questionCard.js isCorrectTriviaOption) reads the letter as a
// POSITION and marks the option DRAWN under it. The scorer pays that player and
// no other: the room must not be shown one right answer and scored on another.
// src/src/__tests__/triviaScorerAgreesWithProjector.test.js pins the two layers.
await check('an answer naming an empty slot pays the option the projector marks', () => {
  const q = { ...GAPPED, correctAnswer: 'OptionB' };
  assert.deepStrictEqual(correctSlots(q), ['C']);
  assert.strictEqual(isAnswerCorrect(q, 'B'), true, 'the option drawn as B was not paid');
  for (const letter of ['A', 'C']) {
    assert.strictEqual(isAnswerCorrect(q, letter), false, `${letter} was credited`);
  }
});

// The fallback is for an EMPTY slot only. A filled slot is always the slot.
await check('a filled slot is never re-read as a position', () => {
  const q = { ...GAPPED, correctAnswer: 'OptionC' };
  assert.deepStrictEqual(correctSlots(q), ['C']);
  assert.strictEqual(isAnswerCorrect(q, 'C'), false, 'optionD, drawn as C, was paid');
});

// A letter past the last drawn option places nowhere, by slot or by position.
await check('an answer no reading can place scores nobody', () => {
  const q = { optionA: 'x', optionB: 'y', correctAnswer: 'OptionE' };
  assert.deepStrictEqual(correctSlots(q), []);
  for (const letter of ['A', 'B']) assert.strictEqual(isAnswerCorrect(q, letter), false);
});

console.log('\n4. the two copies have not drifted');

// Lambda CodeUri is per-directory and there are no layers, so this module
// exists twice. A decoder that scores in one directory and not the other is
// exactly the cross-surface disagreement that produced this bug twice already.
await check('websocket/trivia-answer.js and game/trivia-answer.js are byte-identical', () => {
  const a = fs.readFileSync(WS_COPY, 'utf8');
  const b = fs.readFileSync(GAME_COPY, 'utf8');
  assert.strictEqual(a, b,
    'the copies have diverged — scoring and the AI summary would disagree ' +
    'about who answered correctly, in the same room, about the same question');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

})();
