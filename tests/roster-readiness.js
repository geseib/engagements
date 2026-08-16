/**
 * "STILL TO ANSWER" NEVER CHANGED, BECAUSE THE ROSTER WAS QUERYING A KEY THAT
 * CANNOT EXIST.
 *
 * Reported by the owner: *"still to answer did not change when players have
 * answered, although the count above stays accurate (1 of 2 answered)."* That
 * pairing is the entire diagnosis. Two numbers describing the same round, one
 * right and one wrong, means two derivations — and there were:
 *
 *   get-game-state.js:63   `LessonNumber` -> `001`          ✅ the right one
 *   get-players.js:39      `CurrentQuestionId` -> `c005#017` ❌ the wrong one
 *
 * `CurrentQuestionId` is the SOURCE question's id — the row in a question SET
 * that this round is serving (next-question.js:717). Answers are filed under
 * the padded ROUND number (`QUESTION#001#ANSWER#Ada`, websocket/message.js:366).
 * So `get-players.js` built `QUESTION#c005#017#ANSWER#`, matched nothing, and
 * reported every player as not-yet-answered in every session that has ever run.
 *
 * WHY NO TEST CAUGHT IT. The readiness block was well formed — `{ isReady,
 * type, hasAnswered, hasVoted }` — with every value false. A test asserting the
 * SHAPE of that block passes against the bug, and a frontend test that hands
 * `waitingOn` a hand-made payload with `hasAnswered: true` proves the frontend
 * and says nothing about the server. So every assertion below seeds a real
 * answer at the real sort key and drives the real handler.
 *
 * WHAT WAS AND WAS NOT AFFECTED, asserted so the blast radius stops being folk
 * memory:
 *   BROKEN   `readiness.*` and `stats.*` from GET /games/{id}/players, which is
 *            what the host's phone filters on (config/hostRemote.js's
 *            `waitingOn`) — the surface the owner was looking at.
 *   FINE     the host's main stage. Its "still to answer" comes from
 *            get-game-state's `answererIds` via `waitingRoster`, which read the
 *            correct source all along. §3 pins both at once.
 */
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');

const { createTable, installStubs } = require('./helpers/player-table');

const table = createTable();
const store = table.store;
const key = table.keyOf;
const sent = [];

installStubs({ table, sent });

process.env.TABLE_NAME = 'test-table';

const joinGame = require(path.join(REPO, 'lambda-functions/game/join-game.js'));
const getPlayers = require(path.join(REPO, 'lambda-functions/game/get-players.js'));
const getGameState = require(path.join(REPO, 'lambda-functions/game/get-game-state.js'));
const removePlayer = require(path.join(REPO, 'lambda-functions/game/remove-player.js'));
const { currentRoundNumber } = require(path.join(REPO, 'lambda-functions/game/round-key.js'));

/* ---- Harness -------------------------------------------------------------- */

let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const GAME = '4821';
const PK = `GAME#${GAME}`;

const roster = () => getPlayers.handler({ pathParameters: { gameId: GAME } });
const state = () => getGameState.handler({ pathParameters: { gameId: GAME } });
const bodyOf = (res) => JSON.parse(res.body);
const readinessOf = (list, name) => list.players.find((p) => p.playerName === name).readiness;

/**
 * The state row as `next-question.js` actually writes it: BOTH fields set, and
 * they are different values. A fixture that omitted `CurrentQuestionId`, or set
 * it to `'001'`, would let the broken code pass — which is presumably how this
 * survived.
 */
async function seed({ phase = 'ASK', round = 1, answered = [], voted = [] } = {}) {
  table.clear();
  sent.length = 0;
  store.set(key(PK, 'METADATA'), { PK, SK: 'METADATA', Started: true, Visibility: 'public' });

  await joinGame.handler({
    pathParameters: { gameId: GAME }, body: JSON.stringify({ playerName: 'Ada', clientId: 'ada' }),
  });
  await joinGame.handler({
    pathParameters: { gameId: GAME }, body: JSON.stringify({ playerName: 'Dana', clientId: 'dana' }),
  });

  const padded = String(round).padStart(3, '0');
  store.set(key(PK, 'STATE'), {
    PK, SK: 'STATE',
    State: `${phase}#${padded}`,
    LessonNumber: round,
    // The source question id, which is emphatically not the round number.
    CurrentQuestionId: 'c005#017',
  });

  for (const name of answered) {
    store.set(key(PK, `QUESTION#${padded}#ANSWER#${name}`), {
      PK, SK: `QUESTION#${padded}#ANSWER#${name}`, PlayerName: name, Answer: 'something',
    });
  }
  for (const name of voted) {
    store.set(key(PK, `QUESTION#${padded}#VOTE#${name}`), {
      PK, SK: `QUESTION#${padded}#VOTE#${name}`, PlayerName: name, VoterName: name, Votes: { 0: 1 },
    });
  }
}

/* ---- Cases ---------------------------------------------------------------- */

(async () => {
  console.log('\nroster readiness');

  /* --- §1 the derivation --------------------------------------------------- */

  await check('§1 the round number comes from LessonNumber, padded', () => {
    assert.strictEqual(currentRoundNumber({ LessonNumber: 1 }), '001');
    assert.strictEqual(currentRoundNumber({ LessonNumber: 17 }), '017');
    assert.strictEqual(currentRoundNumber({ LessonNumber: 100 }), '100');
  });

  await check('§1 no round in play is null, never a legal-looking key prefix', () => {
    // `'000'` would send a Query at a partition that cannot exist and read as
    // an empty round rather than as no round — the failure being fixed.
    assert.strictEqual(currentRoundNumber({ LessonNumber: 0 }), null);
    assert.strictEqual(currentRoundNumber({}), null);
    assert.strictEqual(currentRoundNumber(null), null);
  });

  await check('§1 CurrentQuestionId is never mistaken for the round', () => {
    // The bug, as a one-line assertion: the source id must not leak into a key.
    assert.strictEqual(currentRoundNumber({ CurrentQuestionId: 'c005#017' }), null);
    assert.strictEqual(currentRoundNumber({ CurrentQuestionId: 'c005#017', LessonNumber: 2 }), '002');
  });

  /* --- §2 the bug itself, through the real handler ------------------------- */

  await check('§2 a player who has answered reads as having answered', async () => {
    await seed({ phase: 'ASK', answered: ['Ada'] });
    const list = bodyOf(await roster());

    // Against the bug every one of these is false, and the block still has the
    // right shape — which is why a shape assertion was not enough.
    assert.strictEqual(readinessOf(list, 'Ada').hasAnswered, true,
      'the readiness query is still built from the source question id');
    assert.strictEqual(readinessOf(list, 'Ada').isReady, true);
    assert.strictEqual(readinessOf(list, 'Ada').type, 'answered');
    assert.strictEqual(readinessOf(list, 'Dana').hasAnswered, false,
      'somebody who has not answered was reported as ready');
  });

  await check('§2 the readiness stats count the room instead of counting zero', async () => {
    await seed({ phase: 'ASK', answered: ['Ada'] });
    const stats = bodyOf(await roster()).stats;

    assert.strictEqual(stats.totalPlayers, 2);
    assert.strictEqual(stats.readyCount, 1, 'readyCount was permanently 0');
    assert.strictEqual(stats.answeredCount, 1);
    assert.strictEqual(stats.readyPercentage, 50, 'readyPercentage was permanently 0');
  });

  await check('§2 voting readiness reads the vote rows, not the answer rows', async () => {
    // During VOTE everyone has already answered, so a handler reading the
    // answers here would show a full set of ticks through a vote nobody cast.
    await seed({ phase: 'VOTE', answered: ['Ada', 'Dana'], voted: ['Dana'] });
    const list = bodyOf(await roster());

    assert.strictEqual(readinessOf(list, 'Dana').hasVoted, true);
    assert.strictEqual(readinessOf(list, 'Dana').isReady, true);
    assert.strictEqual(readinessOf(list, 'Ada').hasVoted, false);
    assert.strictEqual(readinessOf(list, 'Ada').isReady, false,
      'answering was mistaken for voting');
    assert.strictEqual(bodyOf(await roster()).stats.votedCount, 1);
  });

  await check('§2 it works past round nine, where padding starts to matter', async () => {
    await seed({ phase: 'ASK', round: 12, answered: ['Ada'] });
    // `12` and `'012'` are different keys; an unpadded derivation passes §2.1
    // and fails here.
    assert.strictEqual(readinessOf(bodyOf(await roster()), 'Ada').hasAnswered, true);
  });

  await check('§2 before any round has started nobody is waiting on anything', async () => {
    await seed({ phase: 'ASK', round: 0 });
    store.get(key(PK, 'STATE')).State = 'CREATED';
    const list = bodyOf(await roster());
    assert.strictEqual(readinessOf(list, 'Ada').type, 'none');
    assert.strictEqual(list.stats.readyCount, 0);
    assert.strictEqual(list.currentRound, null);
  });

  /* --- §3 one derivation, two handlers ------------------------------------- */

  await check('§3 the roster and the game state now agree about the round', async () => {
    await seed({ phase: 'ASK', answered: ['Ada'] });
    const list = bodyOf(await roster());
    const snapshot = bodyOf(await state());

    // The two numbers the owner saw disagree. They are computed by two
    // handlers from one row, and they now come through one function.
    assert.strictEqual(list.currentRound, '001');
    assert.strictEqual(snapshot.answerProgress.totalPlayers, 2);
    assert.strictEqual(snapshot.answerProgress.answersReceived, 1);
    assert.strictEqual(
      list.stats.answeredCount, snapshot.answerProgress.answersReceived,
      'the host phone and the host stage still disagree about who has answered'
    );
    assert.deepStrictEqual(snapshot.answerProgress.answererIds, ['Ada']);
  });

  await check('§3 the source question id is still published, under its own name', async () => {
    await seed({ phase: 'ASK' });
    const list = bodyOf(await roster());
    // Unchanged contract: this field has always carried the source id. What
    // changed is that nothing builds a sort key out of it any more.
    assert.strictEqual(list.currentQuestionId, 'c005#017');
    assert.strictEqual(list.currentRound, '001');
    assert.notStrictEqual(list.currentQuestionId, list.currentRound);
  });

  /* --- §4 the interaction with removal ------------------------------------- */

  await check('§4 a removed player is out of the readiness denominator', async () => {
    // Only worth asserting now that readiness is a live number at all: with
    // readyCount permanently 0, no denominator could ever be observed.
    await seed({ phase: 'ASK', answered: ['Ada'] });
    assert.strictEqual(bodyOf(await roster()).stats.readyPercentage, 50);

    await removePlayer.handler({
      pathParameters: { gameId: GAME, playerName: 'Dana' }, body: JSON.stringify({}),
    });

    const stats = bodyOf(await roster()).stats;
    assert.strictEqual(stats.totalPlayers, 1);
    assert.strictEqual(stats.readyCount, 1);
    assert.strictEqual(stats.readyPercentage, 100,
      'the round reads as half done because it waits on somebody who left');
  });

  await check('§4 removing somebody does not fabricate readiness for them', async () => {
    await seed({ phase: 'ASK', answered: ['Ada'] });
    await removePlayer.handler({
      pathParameters: { gameId: GAME, playerName: 'Dana' }, body: JSON.stringify({}),
    });
    const list = bodyOf(await roster());
    // They leave the counts; they do not join them as a phantom "ready".
    assert.strictEqual(list.players.length, 1);
    assert.strictEqual(list.stats.answeredCount, 1);
    assert.strictEqual(list.removedPlayers.length, 1);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
