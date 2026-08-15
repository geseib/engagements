/**
 * SOMEBODY LEFT. THE ROOM SHRINKS; THE HISTORY DOES NOT.
 *
 * Owner: *"if someone has left, the host should be able to remove them so they
 * are not in the next rounds counts. this should not eliminate any contribution
 * they had made or points they had accumulated before leaving. they will still
 * show up in the data and reports."*
 *
 * Two clauses pulling opposite ways, and getting the second one wrong is
 * invisible — a report that quietly says "3 players" about a session four
 * people sat through looks exactly like a correct report. So §4 is the reason
 * this file exists, and §1-§3 are the feature.
 *
 *   §1  the model: one attribute, and NOTHING is deleted.
 *   §2  the live counts drop them — get-players' stats, get-game-state's two
 *       progress denominators.
 *   §3  it is reversible, from the roster and by the person rejoining.
 *   §4  THE REPORT DOES NOT DROP THEM. Neither does the score record, nor a
 *       single answer or vote.
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
const removePlayer = require(path.join(REPO, 'lambda-functions/game/remove-player.js'));
const getPlayers = require(path.join(REPO, 'lambda-functions/game/get-players.js'));
const getGameState = require(path.join(REPO, 'lambda-functions/game/get-game-state.js'));
const createReport = require(path.join(REPO, 'lambda-functions/game/create-report.js'));
const grantHandover = require(path.join(REPO, 'lambda-functions/game/grant-handover.js'));

/* ---- Harness -------------------------------------------------------------- */

let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const GAME = '4821';
const PK = `GAME#${GAME}`;

const join = (body) => joinGame.handler({
  pathParameters: { gameId: GAME }, body: JSON.stringify(body),
});
const remove = (playerName, body) => removePlayer.handler({
  pathParameters: { gameId: GAME, playerName }, body: JSON.stringify(body || {}),
});
const roster = () => getPlayers.handler({ pathParameters: { gameId: GAME } });
const state = () => getGameState.handler({ pathParameters: { gameId: GAME } });
const report = () => createReport.handler({ pathParameters: { gameId: GAME } });

const bodyOf = (res) => JSON.parse(res.body);
const playerRow = (name) => store.get(key(PK, `PLAYER#${name}`));

/**
 * A session mid-round: three players joined, everyone has a score row, and Ada
 * has answered round 001. `LessonNumber` is what the round key is derived from
 * — see round-key.js — so it is set here rather than `CurrentQuestionId`.
 */
async function seedSession({ phase = 'ASK' } = {}) {
  table.clear();
  sent.length = 0;
  store.set(key(PK, 'METADATA'), {
    PK, SK: 'METADATA', Started: true, Visibility: 'public',
    Title: 'Strategy offsite', GameType: 'call-and-answer',
  });
  store.set(key(PK, 'CONNECTION#host-1'), {
    PK, SK: 'CONNECTION#host-1', ConnectionId: 'host-1', ConnectionType: 'HOST',
  });

  await join({ playerName: 'Ada', clientId: 'ada-phone' });
  await join({ playerName: 'Dana', clientId: 'dana-phone' });
  await join({ playerName: 'Tomás', clientId: 'tomas-phone' });

  store.set(key(PK, 'STATE'), {
    PK, SK: 'STATE', State: `${phase}#001`, LessonNumber: 1,
    CurrentQuestionId: 'c005#017',
  });

  // Ada answered and voted; Dana and Tomás have not.
  store.set(key(PK, 'QUESTION#001#ANSWER#Ada'), {
    PK, SK: 'QUESTION#001#ANSWER#Ada', PlayerName: 'Ada', Answer: 'One intake form',
  });
  // The real vote row shape — `VoterName` + a `Votes` map, as written by
  // game/submit-vote.js:60-64. create-report.js walks `Votes` with
  // Object.entries and would throw on a row shaped any other way, so the
  // fixture matches the writer rather than the reader's minimum.
  store.set(key(PK, 'QUESTION#001#VOTE#Ada'), {
    PK, SK: 'QUESTION#001#VOTE#Ada', PlayerName: 'Ada', VoterName: 'Ada',
    QuestionNumber: '001', Votes: { 0: 1 },
  });
  store.set(key(PK, 'QUESTION#001#REF'), {
    PK, SK: 'QUESTION#001#REF', SourceQuestionId: 'c005#017', QuestionNumber: '001',
  });

  // Tomás earned points before leaving. This is the number §4 protects.
  store.set(key(PK, 'PLAYER#Tomás#SCORE'), {
    PK, SK: 'PLAYER#Tomás#SCORE', PlayerName: 'Tomás', score: 5, afterRound: '001',
  });
}

/* ---- Cases ---------------------------------------------------------------- */

(async () => {
  console.log('\nplayer removal');

  /* --- §1 the model -------------------------------------------------------- */

  await check('§1 removal is one attribute, and DELETES NOTHING', async () => {
    await seedSession();
    const before = new Set(store.keys());

    const res = await remove('Tomás');
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(bodyOf(res).removed, true);
    assert.ok(playerRow('Tomás').RemovedAt, 'nothing marks them as gone');

    // THE TEST OF THE WHOLE DESIGN. Not one row disappeared: not the player
    // row, not PLAYER#Tomás#SCORE, not an answer or a vote.
    const after = new Set(store.keys());
    const lost = [...before].filter((k) => !after.has(k));
    assert.deepStrictEqual(lost, [], `removal deleted rows: ${lost.join(', ')}`);

    // And the handler issued no DeleteCommand at all, whatever it did to keys.
    const deletes = table.log.filter((entry) => entry.type === 'delete');
    assert.deepStrictEqual(deletes, [], 'remove-player issued a DeleteCommand');
  });

  await check('§1 removal leaves the rest of the player row alone', async () => {
    await seedSession();
    const before = { ...playerRow('Ada') };
    await remove('Ada');
    const after = playerRow('Ada');

    // A whole-item Put here would silently drop ClientId and lock Ada out of
    // her own row on her next reconnect.
    for (const field of Object.keys(before)) {
      assert.deepStrictEqual(after[field], before[field], `${field} was rewritten by a removal`);
    }
    assert.strictEqual(after.ClientId, 'ada-phone');
  });

  await check('§1 removing a name that is not in the session creates nothing', async () => {
    await seedSession();
    const res = await remove('Ghost');
    assert.strictEqual(res.statusCode, 404);
    assert.strictEqual(playerRow('Ghost'), undefined, 'a phantom player row was created');
  });

  await check('§1 a row deleted mid-removal is not resurrected by the write', async () => {
    await seedSession();

    // Same hazard as grant-handover.js: `admin/delete-game.js` batch-deletes
    // the whole partition and the rows carry a TTL, so the row can be gone by
    // the time the Update lands. An unconditional Update upserts, and the
    // upsert would be a player row consisting of nothing but a key and a
    // `RemovedAt` — a nameless ghost in a session that has been cleared.
    const latch = table.hold((command) => command.type === 'update'
      && command.input.Key?.SK === 'PLAYER#Tomás');

    const pending = remove('Tomás');
    await latch.reached;
    store.delete(key(PK, 'PLAYER#Tomás'));
    latch.release();

    const res = await pending;
    assert.strictEqual(res.statusCode, 404);
    assert.strictEqual(playerRow('Tomás'), undefined, 'the removal resurrected a deleted player row');
  });

  await check('§1 the host\'s other device is told', async () => {
    await seedSession();
    sent.length = 0;
    await remove('Tomás');
    const notes = sent.filter((m) => m.type === 'playerRemoved');
    assert.strictEqual(notes.length, 1, 'a phone and a projector would disagree about the room');
    assert.strictEqual(notes[0].playerName, 'Tomás');
  });

  /* --- §2 the live counts -------------------------------------------------- */

  await check('§2 the roster drops them from `players` and from `stats`', async () => {
    await seedSession();
    const before = bodyOf(await roster());
    assert.strictEqual(before.stats.totalPlayers, 3);

    await remove('Tomás');
    const after = bodyOf(await roster());

    assert.strictEqual(after.stats.totalPlayers, 2, 'the host is still waiting on somebody who went home');
    assert.deepStrictEqual(after.players.map((p) => p.playerName).sort(), ['Ada', 'Dana']);
    assert.strictEqual(after.stats.connectedCount, 2);
  });

  await check('§2 the readiness percentage is over the room, not over the history', async () => {
    await seedSession();
    // Ada has answered; Dana and Tomás have not. 1 of 3 = 33%.
    const before = bodyOf(await roster());
    assert.strictEqual(before.stats.readyCount, 1);
    assert.strictEqual(before.stats.readyPercentage, 33);

    // Tomás leaves. Now it is 1 of 2 = 50%, and the round is genuinely half
    // done rather than permanently a third done.
    await remove('Tomás');
    const after = bodyOf(await roster());
    assert.strictEqual(after.stats.totalPlayers, 2);
    assert.strictEqual(after.stats.readyCount, 1);
    assert.strictEqual(after.stats.readyPercentage, 50,
      'the denominator still counts a player who left');
  });

  await check('§2 the answer progress denominator drops them', async () => {
    await seedSession({ phase: 'ASK' });
    const before = bodyOf(await state());
    assert.strictEqual(before.answerProgress.totalPlayers, 3);
    assert.strictEqual(before.answerProgress.answersReceived, 1);

    await remove('Dana');
    await remove('Tomás');
    const after = bodyOf(await state());

    // "1 of 1 answered" — the round can now read as complete, which is the
    // whole point of removing people who have gone.
    assert.strictEqual(after.answerProgress.totalPlayers, 1,
      'the round can never complete because it waits on empty chairs');
    assert.strictEqual(after.answerProgress.answersReceived, 1,
      'the numerator lost an answer that was actually submitted');
  });

  await check('§2 the vote progress denominator drops them', async () => {
    await seedSession({ phase: 'VOTE' });
    const before = bodyOf(await state());
    assert.strictEqual(before.votingProgress.totalPlayers, 3);

    await remove('Tomás');
    const after = bodyOf(await state());
    assert.strictEqual(after.votingProgress.totalPlayers, 2);
    assert.strictEqual(after.votingProgress.votesReceived, 1,
      'a vote cast before the removal was discarded');
  });

  /* --- §3 reversibility ---------------------------------------------------- */

  await check('§3 the roster still shows who left, so there is a row to undo it on', async () => {
    await seedSession();
    await remove('Tomás');
    const list = bodyOf(await roster());

    const departed = list.removedPlayers;
    assert.strictEqual(departed.length, 1);
    assert.strictEqual(departed[0].playerName, 'Tomás');
    assert.ok(departed[0].removedAt, 'the host cannot see when they left');
    // Their points travel with them, so putting them back does not look like
    // resetting them to zero.
    assert.strictEqual(departed[0].totalScore, 5, 'the points vanished from the only screen that can restore them');
  });

  await check('§3 `removed: false` puts them back', async () => {
    await seedSession();
    await remove('Tomás');
    const res = await remove('Tomás', { removed: false });

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(bodyOf(res).removed, false);
    assert.strictEqual(playerRow('Tomás').RemovedAt, undefined);

    const list = bodyOf(await roster());
    assert.strictEqual(list.stats.totalPlayers, 3);
    assert.deepStrictEqual(list.removedPlayers, []);
  });

  await check('§3 it is explicit, never a toggle', async () => {
    await seedSession();
    // A toggle read off a stale roster puts somebody back into the room
    // because the host double-tapped. Two removes leave them removed.
    await remove('Tomás');
    await remove('Tomás');
    assert.ok(playerRow('Tomás').RemovedAt);
    assert.strictEqual(bodyOf(await roster()).stats.totalPlayers, 2);
  });

  await check('§3 a removed player who rejoins is back in the counts', async () => {
    await seedSession();
    await remove('Tomás');

    // THE DECISION, ASSERTED. A removed row keeps its ClientId, so nothing
    // stops that browser returning. Leaving them removed would mean somebody
    // sat in the room typing an answer no progress bar waits for, with nothing
    // on any screen explaining why. See the long comment in join-game.js.
    const res = await join({ playerName: 'Tomás', clientId: 'tomas-phone' });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(playerRow('Tomás').RemovedAt, undefined, 'they rejoined but stayed uncounted');
    assert.strictEqual(bodyOf(await roster()).stats.totalPlayers, 3);
  });

  await check('§3 rejoining does not undo the collision guard', async () => {
    await seedSession();
    await remove('Tomás');
    // A DIFFERENT browser is still refused. "Removed" is not "unclaimed": the
    // row is owned, and the way in is a host grant like anybody else's.
    const res = await join({ playerName: 'Tomás', clientId: 'a-stranger' });
    assert.strictEqual(res.statusCode, 409);
    assert.ok(playerRow('Tomás').RemovedAt, 'a refused join un-removed them anyway');
  });

  await check('§3 a handover onto a removed name brings the name back into the room', async () => {
    await seedSession();
    await remove('Tomás');
    await grantHandover.handler({
      pathParameters: { gameId: GAME, playerName: 'Tomás' }, body: JSON.stringify({}),
    });

    const res = await join({ playerName: 'Tomás', clientId: 'tomas-new-laptop', claimExisting: true });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(playerRow('Tomás').RemovedAt, undefined,
      'somebody is demonstrably at the keyboard and still not counted');
    assert.strictEqual(playerRow('Tomás').ClientId, 'tomas-new-laptop');
  });

  /* --- §4 the history ------------------------------------------------------ */

  await check('§4 THE REPORT STILL COUNTS THEM', async () => {
    await seedSession();
    const before = bodyOf(await report());
    assert.strictEqual(before.report.gameStats.totalPlayers, 3);

    await remove('Tomás');
    await remove('Dana');
    const after = bodyOf(await report());

    // A report is a record of what happened, not a census of who is still in
    // the chair. Dropping them here rewrites history silently — no screen in
    // the product would ever show the discrepancy.
    assert.strictEqual(after.report.gameStats.totalPlayers, 3,
      'the session report lost two people who were in the session');
  });

  await check('§4 the report still carries their performance and their points', async () => {
    await seedSession();
    await remove('Tomás');
    const after = bodyOf(await report()).report;

    const names = after.playerPerformance.map((p) => p.playerName || p.name);
    assert.ok(names.includes('Tomás'), 'a removed player fell out of the performance table');
    const tomas = after.playerPerformance.find((p) => (p.playerName || p.name) === 'Tomás');
    assert.strictEqual(tomas.totalScore, 5, 'the points they earned before leaving were erased');
  });

  await check('§4 their answers and votes survive removal untouched', async () => {
    await seedSession();
    await remove('Ada');
    assert.ok(store.get(key(PK, 'QUESTION#001#ANSWER#Ada')), 'an answer was erased by a removal');
    assert.ok(store.get(key(PK, 'QUESTION#001#VOTE#Ada')), 'a vote was erased by a removal');

    // ...and the numerators that read them still see them, which is what makes
    // "1 of 1 answered" honest rather than a coincidence of two errors.
    const progress = bodyOf(await state()).answerProgress;
    assert.strictEqual(progress.answersReceived, 1);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
