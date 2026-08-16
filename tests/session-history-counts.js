/**
 * TWO COUNTS ON THE SESSION LIST, AND THE TWO WAYS THEY LIE.
 *
 *   §2  THREE ROWS PER PLAYER. A participant writes `PLAYER#{name}`,
 *       `PLAYER#{name}#SCORE` and `PLAYER#{name}#STATE`, so the length of a
 *       `begins_with(SK,'PLAYER#')` query is about three times the room.
 *       `create-report.js` shipped exactly that: a four-person session
 *       announced twelve players on the front page of its report. The fixture
 *       here is built from what `join-game.js` actually writes, not from what
 *       the handler hopes to read.
 *
 *   §3  NULL IS NOT ZERO. A read that failed and a session nobody joined are
 *       different facts. Zero must survive as zero and a failure must come back
 *       as null, or the list renders "nobody came" over a query that errored.
 *
 * §4 covers the part that is easy to get wrong in the other direction: one bad
 * session must not take the list down with it.
 */
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const { createTable, installStubs } = require('./helpers/player-table');

const table = createTable();
const store = table.store;
const sent = [];

installStubs({ table, sent });
process.env.TABLE_NAME = 'test-table';

const getGamesList = require(path.join(REPO, 'lambda-functions/game/get-games-list.js'));
const { countPlayers, countParticipants, uniquePlayerRecords } = require(path.join(REPO, 'lambda-functions/game/player-rows.js'));

let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const put = (item) => store.set(table.keyOf(item.PK, item.SK), item);

/** Exactly the three rows a real join leaves behind. */
function seatPlayer(gameId, name, joinedAt = '2026-08-10T09:00:00Z') {
  put({ PK: `GAME#${gameId}`, SK: `PLAYER#${name}`, PlayerName: name, JoinedAt: joinedAt });
  put({ PK: `GAME#${gameId}`, SK: `PLAYER#${name}#SCORE`, PlayerName: name, Score: 3 });
  put({ PK: `GAME#${gameId}`, SK: `PLAYER#${name}#STATE`, PlayerName: name, State: 'answered' });
}

function seedSession(gameId, { players = [], rounds = null, started = true } = {}) {
  put({
    PK: 'GAMES', SK: `GAME#${gameId}`, Title: `Session ${gameId}`,
    GameType: 'call-and-answer', QuestionSetId: 'set-alpha',
    CreatedAt: '2026-08-10T09:00:00Z', Started: started, HostName: 'Ada',
  });
  players.forEach((name) => seatPlayer(gameId, name));
  if (rounds !== null) {
    put({ PK: `GAME#${gameId}`, SK: 'STATE', State: 'RESULTS#004', LessonNumber: rounds });
  }
}

const list = async () => JSON.parse((await getGamesList.handler({})).body).games;
const byId = (games, id) => games.find((g) => g.gameId === id);

(async () => {
  console.log('\n§1  the pure rule');

  await check('three rows per player count as one person', () => {
    const rows = [
      { SK: 'PLAYER#Ada', PlayerName: 'Ada' },
      { SK: 'PLAYER#Ada#SCORE', PlayerName: 'Ada' },
      { SK: 'PLAYER#Ada#STATE', PlayerName: 'Ada' },
    ];
    assert.strictEqual(countPlayers(rows), 1);
  });

  await check('a rejoin leaves two main rows and still counts once', () => {
    const rows = [
      { SK: 'PLAYER#Ada', PlayerName: 'Ada', JoinedAt: '2026-08-10T09:00:00Z' },
      { SK: 'PLAYER#Ada', PlayerName: 'Ada', JoinedAt: '2026-08-10T10:00:00Z' },
    ];
    assert.strictEqual(countPlayers(rows), 1);
    assert.strictEqual(uniquePlayerRecords(rows)[0].JoinedAt, '2026-08-10T10:00:00Z',
      'the newest join should win, which is what the report reads');
  });

  await check('no rows is zero, not a crash', () => {
    assert.strictEqual(countPlayers([]), 0);
    assert.strictEqual(countPlayers(undefined), 0);
  });

  console.log('\n§2  the list does not report three times the room');

  await check('a four-person session says four, not twelve', async () => {
    store.clear();
    seedSession('4821', { players: ['Ada', 'Grace', 'Alan', 'Kay'], rounds: 4 });
    assert.strictEqual(byId(await list(), '4821').playerCount, 4);
  });

  await check('rounds come from LessonNumber', async () => {
    store.clear();
    seedSession('4821', { players: ['Ada'], rounds: 7 });
    assert.strictEqual(byId(await list(), '4821').roundsPlayed, 7);
  });

  await check('counts are per session, not shared between them', async () => {
    store.clear();
    seedSession('4821', { players: ['Ada', 'Grace'], rounds: 2 });
    seedSession('9137', { players: ['Kay'], rounds: 9 });
    const games = await list();
    assert.strictEqual(byId(games, '4821').playerCount, 2);
    assert.strictEqual(byId(games, '4821').roundsPlayed, 2);
    assert.strictEqual(byId(games, '9137').playerCount, 1);
    assert.strictEqual(byId(games, '9137').roundsPlayed, 9);
  });

  console.log('\n§3  zero and unknown are different answers');

  await check('a session nobody joined reports 0, not null', async () => {
    store.clear();
    seedSession('4821', { players: [], rounds: 0 });
    const row = byId(await list(), '4821');
    assert.strictEqual(row.playerCount, 0, 'an empty session genuinely had no players');
  });

  await check('a session with no STATE row reports null rounds, not 0', async () => {
    /*
      An unstarted session has no STATE row at all. Reporting 0 would be a
      guess that happens to be right; reporting null is the truth, and the list
      draws an em dash for it.
    */
    store.clear();
    seedSession('9137', { players: ['Ada'], rounds: null, started: false });
    assert.strictEqual(byId(await list(), '9137').roundsPlayed, null);
  });

  await check('both fields are always present on every row', async () => {
    // The frontend distinguishes null from undefined nowhere, but an absent
    // key would make a row indistinguishable from an older API's response.
    store.clear();
    seedSession('4821', { players: ['Ada'], rounds: 3 });
    const row = byId(await list(), '4821');
    assert.ok('playerCount' in row && 'roundsPlayed' in row);
  });

  console.log('\n§3b  the rows expire before the session does');

  /*
    THE BUG THIS SECTION EXISTS FOR, and it would have shipped silently:

        PLAYER#{name}          7 days
        PLAYER#{name}#SCORE   30 days
        the session itself    90 days

    A session sits in the history list for 90 days, but the main player rows
    are gone after 7. Counting only those rows makes the Players column read 0
    for every session older than a week — a confident, wrong number, in a
    column, for the following two and a half months.
  */
  await check('a week-old session still counts its players from the score rows', async () => {
    store.clear();
    put({
      PK: 'GAMES', SK: 'GAME#4821', Title: 'Aged', GameType: 'trivia',
      CreatedAt: new Date(Date.now() - 20 * 864e5).toISOString(), Started: true,
    });
    put({ PK: 'GAME#4821', SK: 'STATE', LessonNumber: 3 });
    // Exactly what survives day 7: the score rows, and nothing else.
    ['Ada', 'Grace', 'Kay'].forEach((name) => put({
      PK: 'GAME#4821', SK: `PLAYER#${name}#SCORE`, PlayerName: name, score: 4,
    }));
    assert.strictEqual(byId(await list(), '4821').playerCount, 3,
      'the count must survive the 7-day expiry of the main rows');
  });

  await check('past 30 days an empty result is null, not zero', async () => {
    // Nothing is left to count, and "0 played" would be a lie about a session
    // eleven people may have sat through.
    store.clear();
    put({
      PK: 'GAMES', SK: 'GAME#4821', Title: 'Ancient', GameType: 'trivia',
      CreatedAt: new Date(Date.now() - 60 * 864e5).toISOString(), Started: true,
    });
    put({ PK: 'GAME#4821', SK: 'STATE', LessonNumber: 5 });
    assert.strictEqual(byId(await list(), '4821').playerCount, null);
  });

  await check('inside the window an empty result is a real zero', async () => {
    store.clear();
    put({
      PK: 'GAMES', SK: 'GAME#4821', Title: 'Recent', GameType: 'trivia',
      CreatedAt: new Date(Date.now() - 2 * 864e5).toISOString(), Started: true,
    });
    put({ PK: 'GAME#4821', SK: 'STATE', LessonNumber: 1 });
    assert.strictEqual(byId(await list(), '4821').playerCount, 0);
  });

  await check('an old session that was never started is a truthful zero', async () => {
    // Nobody can have joined a session whose doors never opened, so its zero
    // does not decay with age.
    store.clear();
    put({
      PK: 'GAMES', SK: 'GAME#9137', Title: 'Never ran', GameType: 'trivia',
      CreatedAt: new Date(Date.now() - 80 * 864e5).toISOString(), Started: false,
    });
    assert.strictEqual(byId(await list(), '9137').playerCount, 0);
  });

  await check('countParticipants reads score rows; countPlayers does not', () => {
    const scoreOnly = [{ SK: 'PLAYER#Ada#SCORE', PlayerName: 'Ada' }];
    assert.strictEqual(countParticipants(scoreOnly), 1, 'the durable witness');
    assert.strictEqual(countPlayers(scoreOnly), 0, 'the report still wants main rows only');
  });

  await check('a row with no name invents no participant', () => {
    assert.strictEqual(countParticipants([{ SK: 'PLAYER#x#SCORE' }]), 0);
  });

  console.log('\n§4  one bad session does not take the list down');

  await check('a failing player query leaves that row null and keeps the rest', async () => {
    store.clear();
    seedSession('4821', { players: ['Ada', 'Grace'], rounds: 2 });
    seedSession('9137', { players: ['Kay'], rounds: 5 });

    const realSend = table.doc.send.bind(table.doc);
    table.doc.send = async (cmd) => {
      const inp = cmd.input || {};
      const vals = inp.ExpressionAttributeValues || {};
      if (vals[':sk'] === 'PLAYER#' && vals[':pk'] === 'GAME#9137') {
        throw new Error('provisioned throughput exceeded');
      }
      return realSend(cmd);
    };

    try {
      const games = await list();
      assert.strictEqual(games.length, 2, 'the list itself must still come back');
      assert.strictEqual(byId(games, '4821').playerCount, 2, 'the healthy row is unaffected');
      assert.strictEqual(byId(games, '9137').playerCount, null,
        'a failed read is null, never 0');
      assert.strictEqual(byId(games, '9137').roundsPlayed, 5,
        'the other count for that session still works');
    } finally {
      table.doc.send = realSend;
    }
  });

  await check('an empty GAMES partition returns an empty list, not an error', async () => {
    store.clear();
    const res = await getGamesList.handler({});
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(JSON.parse(res.body).games, []);
  });

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
