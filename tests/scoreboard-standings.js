/**
 * THE SCOREBOARD'S NUMBERS — places, ties and movement since the last round.
 *
 * docs/superpowers/specs/2026-09-25-scoreboard-design.md §4. The board shows,
 * for every player still in the room: a place in COMPETITION ranking (1, 2, 3,
 * =4, =4, 6), the total as of the last fully scored round, and how far they
 * moved since the round before — ▲n, ▼n, `NEW` for somebody with no previous
 * place, `–` for no change.
 *
 * Three pieces, three sections:
 *
 *   §1  `standings.js` — the arithmetic, on the exact fourteen players the
 *       approved mockups draw (docs/design/scoreboard-2026-09-25/), so the
 *       numbers the owner looked at are the numbers this asserts.
 *   §2  the edges: a player who scored nothing this round, a player who joined
 *       since, a row written before `prevScore` existed, the first scored round.
 *   §3  `get-results.js` writes `prevScore` on BOTH scoring paths (trivia, and
 *       call-and-answer), once — a second close of the same round is still a
 *       no-op.
 *   §4  `get-players.js` returns `rank`, `movement`, `previousScore` and
 *       `afterRound`, keeps the `ranking` object its current readers use, and
 *       leaves removed players off the board.
 *
 * WHY "NEW" IS DECIDED BY WHEN SOMEBODY JOINED, not by whether they have a
 * score row: join-game.js writes every player a `PLAYER#<name>#SCORE` row at
 * `afterRound: "000"` the moment they join, so "had a row before this round"
 * is true of everybody and could never produce NEW. The previous standings
 * were fixed at the moment the previous round was scored; whoever joined after
 * that moment had no place in them.
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const { createTable, installStubs } = require('./helpers/player-table');

const table = createTable();
const sent = [];
installStubs({ table, sent });

process.env.TABLE_NAME = 'test-table';
process.env.WEBSOCKET_API_ENDPOINT = 'https://ws.test.invalid/dev';

const { computeStandings, scoreRowAfterRound } = require(path.join(REPO, 'lambda-functions/game/standings.js'));
const { handler: getResults } = require(path.join(REPO, 'lambda-functions/game/get-results.js'));
const { handler: getPlayers } = require(path.join(REPO, 'lambda-functions/game/get-players.js'));

let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

// ---- The mockups' fourteen ------------------------------------------------
// [name, total after round 5 (null: joined during round 6), round 6 points]
const RAW = [
  ['Priya', 66, 15], ['Marcus', 70, 8], ['Oluwaseun Adebayo-Richardson', 60, 12],
  ['Hannah', 52, 14], ['Tomás', 58, 8], ['Keiko', 59, 4], ['Dev', 47, 12],
  ['Sofia', 50, 5], ['Liam', 48, 4], ['Aisha', 41, 10], ['Grace', 44, 0],
  ['Ben', 30, 9], ['Inès', null, 14], ['Kofi', null, 11],
];
const T_JOIN = '2026-09-25T18:00:00.000Z';   // the room arrives
const T5 = '2026-09-25T18:40:00.000Z';       // round 5 is scored
const T_LATE = '2026-09-25T18:43:00.000Z';   // two people join during round 6
const T6 = '2026-09-25T18:48:00.000Z';       // round 6 is scored

/** The rows get-results would have left behind after round 6. */
function mockupRoom() {
  const players = [];
  const rows = {};
  for (const [name, prev, r6] of RAW) {
    players.push({ name, joinedAt: prev === null ? T_LATE : T_JOIN });
    if (r6 > 0) {
      rows[name] = {
        score: (prev || 0) + r6, prevScore: prev || 0, afterRound: '006', updatedAt: T6,
        ...(prev === null ? {} : { prevScoredAt: T5 }),
      };
    } else {
      rows[name] = { score: prev, afterRound: '005', updatedAt: T5 };
    }
  }
  return { players, rows };
}

const place = (s) => s.rank;

(async () => {
  console.log('\n1. the mockups\' fourteen, placed and moved');
  const room = mockupRoom();
  const board = computeStandings(room);
  const at = (name) => board.standings.get(name);

  await check('afterRound is the last scored round, as a number', () =>
    assert.strictEqual(board.afterRound, 6));
  await check('competition ranking: 1, 2, 3, =4, =4, 6', () => {
    assert.deepStrictEqual(
      ['Priya', 'Marcus', 'Oluwaseun Adebayo-Richardson', 'Hannah', 'Tomás', 'Keiko'].map((n) => place(at(n))),
      [1, 2, 3, 4, 4, 6]);
  });
  await check('the rest of the field', () => {
    assert.deepStrictEqual(
      ['Dev', 'Sofia', 'Liam', 'Aisha', 'Grace', 'Ben', 'Inès', 'Kofi'].map((n) => place(at(n))),
      [7, 8, 9, 10, 11, 12, 13, 14]);
  });
  await check('movement against the order after round 5', () => {
    // Exactly the ▲/▼/– column the three mockups draw.
    const want = {
      Priya: 1, Marcus: -1, 'Oluwaseun Adebayo-Richardson': 0, Hannah: 2, 'Tomás': 1,
      Keiko: -2, Dev: 2, Sofia: -1, Liam: -1, Aisha: 1, Grace: -1, Ben: 0,
    };
    for (const [name, move] of Object.entries(want)) {
      assert.strictEqual(at(name).movement, move, `${name}: got ${at(name).movement}`);
    }
  });
  await check('the two who joined during round 6 are NEW', () => {
    assert.strictEqual(at('Inès').movement, 'new');
    assert.strictEqual(at('Kofi').movement, 'new');
  });
  await check('previousScore is the total after round 5 (the tote board replays it)', () => {
    assert.strictEqual(at('Priya').previousScore, 66);
    assert.strictEqual(at('Marcus').previousScore, 70);
    assert.strictEqual(at('Grace').previousScore, 44);
  });
  await check('a NEW player has no previous total, not a zero', () =>
    // 0 would draw them at the foot of the "after round 5" order they were
    // never in.
    assert.strictEqual(at('Inès').previousScore, null));

  console.log('\n2. the edges');
  await check('a player who scored nothing this round moves only by being passed', () => {
    // Grace: 44 after round 5 and still 44. Aisha passed her, so she drops one.
    assert.strictEqual(at('Grace').movement, -1);
    assert.strictEqual(at('Grace').previousScore, 44);
  });

  await check('a player with no points at all has a place, and is not NEW', () => {
    const b = computeStandings({
      players: [{ name: 'Ada', joinedAt: T_JOIN }, { name: 'Zed', joinedAt: T_JOIN }],
      rows: {
        Ada: { score: 12, prevScore: 5, prevScoredAt: T5, afterRound: '006', updatedAt: T6 },
        Zed: { score: 0, afterRound: '000', updatedAt: T_JOIN },
      },
    });
    assert.strictEqual(b.standings.get('Zed').rank, 2);
    assert.strictEqual(b.standings.get('Zed').movement, 0);
    assert.strictEqual(b.standings.get('Zed').previousScore, 0);
  });

  await check('a row written before prevScore existed reads as unchanged, not as NEW', () => {
    // The spec: rows from before this change carry no prevScore. Their total
    // before the round is unknowable, so they neither climb nor fall.
    const b = computeStandings({
      players: [{ name: 'Old', joinedAt: T_JOIN }, { name: 'Ada', joinedAt: T_JOIN }],
      rows: {
        Old: { score: 30, afterRound: '006', updatedAt: T6 },
        Ada: { score: 20, afterRound: '005', updatedAt: T5 },
      },
    });
    assert.strictEqual(b.standings.get('Old').movement, 0);
    assert.strictEqual(b.standings.get('Old').previousScore, null);
  });

  await check('the first scored round: everybody is NEW', () => {
    const b = computeStandings({
      players: [{ name: 'Ada', joinedAt: T_JOIN }, { name: 'Bo', joinedAt: T_JOIN }, { name: 'Cy', joinedAt: T_JOIN }],
      rows: {
        Ada: { score: 10, prevScore: 0, afterRound: '001', updatedAt: T5 },
        Bo: { score: 10, prevScore: 0, afterRound: '001', updatedAt: T5 },
        Cy: { score: 0, afterRound: '000', updatedAt: T_JOIN },
      },
    });
    assert.strictEqual(b.afterRound, 1);
    assert.deepStrictEqual(['Ada', 'Bo', 'Cy'].map((n) => b.standings.get(n).movement), ['new', 'new', 'new']);
    assert.deepStrictEqual(['Ada', 'Bo', 'Cy'].map((n) => b.standings.get(n).rank), [1, 1, 3]);
  });

  await check('no round scored yet: afterRound is null', () => {
    const b = computeStandings({
      players: [{ name: 'Ada', joinedAt: T_JOIN }],
      rows: { Ada: { score: 0, afterRound: '000', updatedAt: T_JOIN } },
    });
    assert.strictEqual(b.afterRound, null);
  });

  await check('a player with no score row at all still gets a place', () => {
    const b = computeStandings({
      players: [{ name: 'Ada', joinedAt: T_JOIN }, { name: 'Ghost', joinedAt: T_JOIN }],
      rows: { Ada: { score: 4, prevScore: 2, prevScoredAt: T5, afterRound: '002', updatedAt: T6 } },
    });
    assert.strictEqual(b.standings.get('Ghost').rank, 2);
    assert.strictEqual(b.standings.get('Ghost').movement, 0);
  });

  await check('rows of players who have left still date the previous round', () => {
    // The only person who scored in round 5 has since been removed. Their row
    // is still the evidence of WHEN round 5 was scored, so Ada — who joined
    // before it — is not NEW.
    const b = computeStandings({
      players: [{ name: 'Ada', joinedAt: T_JOIN }],
      rows: {
        Ada: { score: 3, prevScore: 0, afterRound: '006', updatedAt: T6 },
        Gone: { score: 9, afterRound: '005', updatedAt: T5 },
      },
    });
    assert.strictEqual(b.standings.get('Ada').movement, 0);
  });

  console.log('\n   the counted round comes from the session, not only from the rows');
  await check('a round in which nobody scored still moves the board on', () => {
    // Round 6 was counted and every player got 0: no score row says 006. The
    // session's own record of the round it counted is what says "after 6".
    const T5b = '2026-09-25T18:41:00.000Z';
    const b = computeStandings({
      players: [
        { name: 'Ada', joinedAt: T_JOIN }, { name: 'Bo', joinedAt: T_JOIN },
        { name: 'Late', joinedAt: T_LATE },
      ],
      rows: {
        Ada: { score: 12, prevScore: 5, afterRound: '005', updatedAt: T5 },
        Bo: { score: 9, afterRound: '004', updatedAt: '2026-09-25T18:30:00.000Z' },
        Late: { score: 0, afterRound: '000', updatedAt: T_LATE },
      },
      marker: { round: 6, at: T6, prevAt: T5b },
    });
    assert.strictEqual(b.afterRound, 6);
    assert.strictEqual(b.standings.get('Ada').movement, 0);
    assert.strictEqual(b.standings.get('Bo').movement, 0);
    // Joined after round 5 was counted: no place in the previous standings.
    assert.strictEqual(b.standings.get('Late').movement, 'new');
  });

  await check('the session\'s previous count dates NEW, even when nobody scored in it', () => {
    // Round 5 was counted at T5b with nobody scoring; nothing on the rows
    // records it. A player who joined before it is not NEW at round 6.
    const T5b = '2026-09-25T18:41:00.000Z';
    const joinedBetween = '2026-09-25T18:40:30.000Z';
    const b = computeStandings({
      players: [{ name: 'Ada', joinedAt: T_JOIN }, { name: 'Mid', joinedAt: joinedBetween }],
      rows: {
        Ada: { score: 7, prevScore: 4, prevScoredAt: T5, afterRound: '006', updatedAt: T6 },
        Mid: { score: 0, afterRound: '000', updatedAt: joinedBetween },
      },
      marker: { round: 6, at: T6, prevAt: T5b },
    });
    assert.strictEqual(b.standings.get('Mid').movement, 0);
  });

  await check('a session counted before the marker existed falls back to the rows', () => {
    const b = computeStandings({
      players: [{ name: 'Ada', joinedAt: T_JOIN }],
      rows: { Ada: { score: 7, prevScore: 4, prevScoredAt: T5, afterRound: '006', updatedAt: T6 } },
      marker: { round: null, at: null, prevAt: null },
    });
    assert.strictEqual(b.afterRound, 6);
    assert.strictEqual(b.standings.get('Ada').movement, 0);
  });

  console.log('\n   scoreRowAfterRound');
  await check('carries the total before the round and when it was set', () => {
    const next = scoreRowAfterRound({ score: 20, afterRound: '004', updatedAt: T5 }, 7, '005', T6);
    assert.deepStrictEqual(next, { score: 27, prevScore: 20, prevScoredAt: T5, afterRound: '005', updatedAt: T6 });
  });
  await check('a join-time row ("000") is not a scored round: no prevScoredAt', () => {
    const next = scoreRowAfterRound({ score: 0, afterRound: '000', updatedAt: T_JOIN }, 7, '005', T6);
    assert.deepStrictEqual(next, { score: 7, prevScore: 0, afterRound: '005', updatedAt: T6 });
  });
  await check('no row at all starts from zero', () => {
    const next = scoreRowAfterRound(undefined, 3, '001', T6);
    assert.deepStrictEqual(next, { score: 3, prevScore: 0, afterRound: '001', updatedAt: T6 });
  });

  // ---- §3 get-results, both scoring paths ------------------------------------
  const GAME = '5150';
  const PK = `GAME#${GAME}`;
  const CLOSE = 'POST /games/{gameId}/close-round';
  const closeRound = (questionNumber) => getResults({
    routeKey: CLOSE,
    pathParameters: { gameId: GAME },
    requestContext: {
      routeKey: CLOSE, http: { method: 'POST' },
      authorizer: { lambda: { userId: 'u', groups: 'hosts' } },
    },
    body: JSON.stringify({ questionNumber }),
  });

  function seedRoom(gameType) {
    table.clear();
    sent.length = 0;
    table.put({ PK, SK: 'METADATA', Title: 'Room', GameType: gameType });
    table.put({ PK, SK: 'STATE', State: gameType === 'trivia' ? 'ASK#002' : 'VOTE#002', LessonNumber: 2, CurrentQuestionId: '002' });
    // Ada has been scored before; Bo only has the row join-game wrote.
    table.put({ PK, SK: 'PLAYER#Ada#SCORE', PlayerName: 'Ada', score: 5, afterRound: '001', updatedAt: T5 });
    table.put({ PK, SK: 'PLAYER#Bo#SCORE', PlayerName: 'Bo', score: 0, afterRound: '000', updatedAt: T_JOIN });
  }

  console.log('\n3. get-results writes prevScore on the trivia path');
  seedRoom('trivia');
  table.put({ PK, SK: 'QUESTION#002#ANSWER#Ada', PlayerName: 'Ada', Answer: 'OptionA', IsCorrect: true, PointsEarned: 10 });
  table.put({ PK, SK: 'QUESTION#002#ANSWER#Bo', PlayerName: 'Bo', Answer: 'OptionA', IsCorrect: true, PointsEarned: 8 });
  const trivia = await closeRound(2);
  await check('200', () => assert.strictEqual(trivia.statusCode, 200, trivia.body));
  await check('Ada: the total before the round, and when it was set', () => {
    const row = table.get(PK, 'PLAYER#Ada#SCORE');
    assert.strictEqual(row.score, 15);
    assert.strictEqual(row.prevScore, 5);
    assert.strictEqual(row.prevScoredAt, T5);
    assert.strictEqual(row.afterRound, '002');
  });
  await check('Bo (first points ever): prevScore 0 and no prevScoredAt', () => {
    const row = table.get(PK, 'PLAYER#Bo#SCORE');
    assert.strictEqual(row.score, 8);
    assert.strictEqual(row.prevScore, 0);
    assert.strictEqual(row.prevScoredAt, undefined);
  });
  await check('the session records the round it counted, and when', () => {
    const st = table.get(PK, 'STATE');
    assert.strictEqual(st.ScoresAfterRound, 2);
    assert.ok(typeof st.ScoresAt === 'string' && st.ScoresAt, 'ScoresAt is a timestamp');
  });
  const firstCountedAt = table.get(PK, 'STATE').ScoresAt;
  const again = await closeRound(2);
  await check('a second close of the same round changes nothing', () => {
    assert.strictEqual(again.statusCode, 200, again.body);
    const row = table.get(PK, 'PLAYER#Ada#SCORE');
    assert.strictEqual(row.score, 15);
    assert.strictEqual(row.prevScore, 5, 'the second close must not overwrite prevScore with the new total');
  });
  await check('...and does not count the round again on the session', () => {
    const st = table.get(PK, 'STATE');
    assert.strictEqual(st.ScoresAt, firstCountedAt);
    assert.notStrictEqual(st.PrevScoresAt, firstCountedAt, 'a re-close must not shift the previous count onto itself');
  });

  console.log('\n3b. an all-wrong trivia round is still a counted round');
  seedRoom('trivia');
  table.put({ PK, SK: 'PLAYER#Ada', PlayerName: 'Ada', playerId: 'Ada', JoinedAt: T_JOIN });
  table.put({ PK, SK: 'PLAYER#Bo', PlayerName: 'Bo', playerId: 'Bo', JoinedAt: T_JOIN });
  table.put({ PK, SK: 'PLAYER#Cy', PlayerName: 'Cy', playerId: 'Cy', JoinedAt: T_LATE });
  table.put({ PK, SK: 'PLAYER#Cy#SCORE', PlayerName: 'Cy', score: 0, afterRound: '000', updatedAt: T_LATE });
  // Round 1 was counted at T5, before Cy arrived.
  Object.assign(table.get(PK, 'STATE'), { ScoresAfterRound: 1, ScoresAt: T5 });
  for (const who of ['Ada', 'Bo', 'Cy']) {
    table.put({ PK, SK: `QUESTION#002#ANSWER#${who}`, PlayerName: who, Answer: 'OptionB', IsCorrect: false, PointsEarned: 0 });
  }
  const allWrong = await closeRound(2);
  await check('200', () => assert.strictEqual(allWrong.statusCode, 200, allWrong.body));
  await check('the session says round 2 was counted, and when round 1 was', () => {
    const st = table.get(PK, 'STATE');
    assert.strictEqual(st.ScoresAfterRound, 2);
    assert.strictEqual(st.PrevScoresAt, T5);
  });
  const wrongBoard = JSON.parse((await getPlayers({ pathParameters: { gameId: GAME } })).body);
  const wrongBy = new Map(wrongBoard.players.map((p) => [p.playerName, p]));
  await check('the board says "after round 2", not round 1', () => assert.strictEqual(wrongBoard.afterRound, 2));
  await check('nobody moved; the one who arrived after round 1 is NEW', () => {
    assert.strictEqual(wrongBy.get('Ada').movement, 0);
    assert.strictEqual(wrongBy.get('Bo').movement, 0);
    assert.strictEqual(wrongBy.get('Cy').movement, 'new');
  });

  // The public read PlayerPage makes once the room says RESULTS#nnn.
  const readRound = (questionNumber) => getResults({
    routeKey: 'POST /games/get-results',
    requestContext: { routeKey: 'POST /games/get-results', http: { method: 'POST' } },
    body: JSON.stringify({ gameId: GAME, questionNumber }),
  });

  console.log('\n3b2. a trivia round NOBODY answered still closes');
  // The zero-answer exit counted the round and returned without ever writing
  // RESULTS#nnn, so the session sat on ASK#002: the host page (which sets
  // RESULTS locally) moved on, while the phones, the remote and a refresh
  // read the round as still open — and every phone's results read was
  // refused, because the public route only reads a round already in RESULTS.
  seedRoom('trivia');
  const silent = await closeRound(2);
  const silentBody = JSON.parse(silent.body);
  await check('200, with an empty result', () => {
    assert.strictEqual(silent.statusCode, 200, silent.body);
    assert.strictEqual(silentBody.gameType, 'trivia');
    assert.strictEqual(silentBody.totalAnswers, 0);
    assert.deepStrictEqual(silentBody.leaderboard, []);
  });
  await check('the room moves to RESULTS#002 like any other close', () => {
    const st = table.get(PK, 'STATE');
    assert.strictEqual(st.State, 'RESULTS#002');
    assert.strictEqual(st.CurrentQuestionId, '002');
  });
  await check('and it is still a counted round', () =>
    assert.strictEqual(table.get(PK, 'STATE').ScoresAfterRound, 2));
  const silentRead = await readRound(2);
  await check('a phone can read the empty result afterwards', () =>
    assert.strictEqual(silentRead.statusCode, 200, silentRead.body));

  console.log('\n3c. re-closing an OLDER round never moves the count backwards');
  // The host goes back and closes round 2 again after round 3 was counted.
  // The guard used to ask only "is this the round already recorded?", so
  // round 2 passed it and the board went back to "after round 2", with round
  // 3's count shifted into PrevScoresAt.
  seedRoom('trivia');
  table.put({ PK, SK: 'QUESTION#002#ANSWER#Ada', PlayerName: 'Ada', Answer: 'OptionA', IsCorrect: true, PointsEarned: 10 });
  Object.assign(table.get(PK, 'STATE'), { ScoresAfterRound: 3, ScoresAt: T6, PrevScoresAt: T5 });
  const olderRound = await closeRound(2);
  await check('200', () => assert.strictEqual(olderRound.statusCode, 200, olderRound.body));
  await check('the session still says round 3, counted when it was', () => {
    const st = table.get(PK, 'STATE');
    assert.strictEqual(st.ScoresAfterRound, 3);
    assert.strictEqual(st.ScoresAt, T6);
    assert.strictEqual(st.PrevScoresAt, T5);
  });

  console.log('\n4. get-results writes prevScore on the call-and-answer path');
  seedRoom('call-and-answer');
  table.put({ PK, SK: 'QUESTION#002#ANSWER#Ada', PlayerName: 'Ada', Answer: 'a thought' });
  table.put({ PK, SK: 'QUESTION#002#VOTE#Bo', PlayerName: 'Bo', Votes: { 0: 1 } });
  const cna = await closeRound(2);
  await check('200', () => assert.strictEqual(cna.statusCode, 200, cna.body));
  await check('Ada: first place is 3 points on top of 5, and prevScore is the 5', () => {
    const row = table.get(PK, 'PLAYER#Ada#SCORE');
    assert.strictEqual(row.score, 8);
    assert.strictEqual(row.prevScore, 5);
    assert.strictEqual(row.prevScoredAt, T5);
    assert.strictEqual(row.afterRound, '002');
  });
  await check('the session records the counted round on this path too', () =>
    assert.strictEqual(table.get(PK, 'STATE').ScoresAfterRound, 2));
  await check('the points are written BEFORE the room is told the round is over', () => {
    // Otherwise a stage reacting to RESULTS reads last round's totals and
    // nothing ever tells it to look again.
    const at = (pred) => table.log.findIndex(pred);
    const scoreWrite = at((c) => c.type === 'put' && c.input.Item && c.input.Item.SK === 'PLAYER#Ada#SCORE');
    const resultsState = at((c) => c.type === 'update' && c.input.Key.SK === 'STATE'
      && Object.values(c.input.ExpressionAttributeValues || {}).includes('RESULTS#002'));
    assert.ok(scoreWrite !== -1 && resultsState !== -1, 'both writes happened');
    assert.ok(scoreWrite < resultsState, `score write #${scoreWrite} came after the RESULTS write #${resultsState}`);
  });

  seedRoom('call-and-answer');
  const noVotes = await closeRound(2);
  await check('a round nobody voted on is counted too', () => {
    assert.strictEqual(noVotes.statusCode, 200, noVotes.body);
    assert.strictEqual(table.get(PK, 'STATE').ScoresAfterRound, 2);
  });
  await check('...and moves to RESULTS#002, the same as the trivia round nobody answered', () =>
    assert.strictEqual(table.get(PK, 'STATE').State, 'RESULTS#002'));
  const noVotesRead = await readRound(2);
  await check('a phone can read its empty result afterwards', () =>
    assert.strictEqual(noVotesRead.statusCode, 200, noVotesRead.body));

  // ---- §4 get-players -------------------------------------------------------
  console.log('\n5. get-players carries the board');
  table.clear();
  table.put({ PK, SK: 'METADATA', Title: 'Room', GameType: 'trivia' });
  table.put({ PK, SK: 'STATE', State: 'RESULTS#006', LessonNumber: 6, CurrentQuestionId: '006' });
  const { players, rows } = mockupRoom();
  for (const p of players) {
    table.put({ PK, SK: `PLAYER#${p.name}`, PlayerName: p.name, playerId: p.name, JoinedAt: p.joinedAt });
    table.put({ PK, SK: `PLAYER#${p.name}#SCORE`, PlayerName: p.name, ...rows[p.name] });
  }
  // Somebody the host removed. Their points stay on the record; they leave the board.
  table.put({ PK, SK: 'PLAYER#Zara', PlayerName: 'Zara', playerId: 'Zara', JoinedAt: T_JOIN, RemovedAt: T6 });
  table.put({ PK, SK: 'PLAYER#Zara#SCORE', PlayerName: 'Zara', score: 99, prevScore: 90, prevScoredAt: T5, afterRound: '006', updatedAt: T6 });

  const res = await getPlayers({ pathParameters: { gameId: GAME } });
  const body = JSON.parse(res.body);
  const byName = new Map(body.players.map((p) => [p.playerName, p]));

  await check('200', () => assert.strictEqual(res.statusCode, 200, res.body));
  await check('afterRound is on the response', () => assert.strictEqual(body.afterRound, 6));
  await check('every player carries rank and movement', () => {
    assert.strictEqual(byName.get('Priya').rank, 1);
    assert.strictEqual(byName.get('Priya').movement, 1);
    assert.strictEqual(byName.get('Hannah').rank, 4);
    assert.strictEqual(byName.get('Tomás').rank, 4);
    assert.strictEqual(byName.get('Keiko').rank, 6);
    assert.strictEqual(byName.get('Kofi').movement, 'new');
    assert.strictEqual(byName.get('Marcus').previousScore, 70);
  });
  await check('a removed player is not on the board and does not take a place', () => {
    // Zara's 99 would be first. She is gone, so Priya is still first.
    assert.strictEqual(byName.has('Zara'), false);
    assert.strictEqual(byName.get('Priya').rank, 1);
  });
  await check('the ranking object its current readers use is still there', () => {
    // PlayerPage and others read `ranking`; the board's fields sit beside it.
    assert.deepStrictEqual(byName.get('Priya').ranking,
      { rank: 1, label: '1st', isTop3: true, position: 1 });
  });
  await check('totals are unchanged', () => assert.strictEqual(byName.get('Priya').totalScore, 81));

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
