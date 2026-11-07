/**
 * THE BLUFF ROUND, end to end — and the one secret it must keep.
 *
 * docs/design/bluff-round/README.md. One player is secretly handed the real
 * answer; they type it in their own voice and everyone else bluffs. A vote for
 * a made-up answer pays its author 2; a vote for the real one pays the holder
 * 1 and the voter who spotted it 1.
 *
 * Drives the REAL handlers (create-game, next-question,
 * get-question, get-game-state, get-players, get-answers, submit-vote,
 * get-results) over the in-memory table, in the style of lobby-start-ttl.js:
 *
 *   §1  the pure rules: the real answer read from a question, the pick, the
 *       too-few-players skip, the scoring arithmetic, Workie's lines
 *   §2  the session option defaults from the set and the host can override it
 *   §3  the ASK opens with a holder, and ONLY the holder's own payload (name
 *       AND client id) carries the real answer — no other player, no host or
 *       stage payload, no roster, no WebSocket frame, before RESULTS
 *   §4  the vote refuses a ballot for your own answer
 *   §5  the close pays the bluff points into the score rows and reveals
 *   §6  fewer than three players plays normally and says so
 *
 * Every check carries a `// rejects:` line naming the change it catches.
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const { createTable, installStubs } = require('./helpers/player-table');

const kmsStubs = require('./helpers/tenant-crypto-stub');
const kms = kmsStubs.makeKmsStub();
for (const base of [REPO, path.join(REPO, 'lambda-functions'), path.join(REPO, 'lambda-functions', 'game'), path.join(REPO, 'lambda-functions', 'websocket')]) {
  let p;
  try { p = require.resolve('@aws-sdk/client-kms', { paths: [base] }); } catch { continue; }
  require.cache[p] = { id: p, filename: p, loaded: true, exports: kms.exports };
}

const table = createTable();
const store = table.store;
const sent = [];
installStubs({ table, sent });
process.env.TABLE_NAME = 'test-table';
process.env.WEBSOCKET_API_ENDPOINT = 'https://ws.test.invalid/dev';
kmsStubs.installTestKeyLoader();

const bluff = require(path.join(REPO, 'lambda-functions/game/bluff-round.js'));
const createGame = require(path.join(REPO, 'lambda-functions/websocket/create-game.js')).handler;
const nextQuestion = require(path.join(REPO, 'lambda-functions/game/next-question.js')).handler;
const getQuestion = require(path.join(REPO, 'lambda-functions/game/get-question.js')).handler;
const getGameState = require(path.join(REPO, 'lambda-functions/game/get-game-state.js')).handler;
const getPlayers = require(path.join(REPO, 'lambda-functions/game/get-players.js')).handler;
const getAnswers = require(path.join(REPO, 'lambda-functions/game/get-answers.js')).handler;
const submitVote = require(path.join(REPO, 'lambda-functions/game/submit-vote.js')).handler;
const getResults = require(path.join(REPO, 'lambda-functions/game/get-results.js')).handler;

if (!process.env.DEBUG) { console.log = () => {}; console.warn = () => {}; console.error = () => {}; }
const say = (...a) => process.stdout.write(a.join(' ') + '\n');

let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); say(`  PASS  ${label}`); pass++; }
  catch (e) { say(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

/* ---- Fixtures ------------------------------------------------------------- */

const ACME = 'org_acme';
const SET = 'set-art';
const SETPK = `SET#${SET}`;
const REAL = 'The Starry Night';
const STORY_HOOK = 'Saint-Paul asylum';
const REVEAL = `Real title: ${REAL}, Vincent van Gogh, 1889. Trivia: painted from his room at the ${STORY_HOOK}.`;

const asHost = (orgId, extra = {}) => ({
  requestContext: { authorizer: { lambda: { userId: `user-${orgId}`, orgId, orgRole: 'admin', groups: 'hosts' } } },
  ...extra,
});
const row = (pk, sk) => store.get(table.keyOf(pk, sk));

async function session({ bluffChoice, setBluff = true, players = ['Ada', 'Ben', 'Cy', 'Dee'] } = {}) {
  store.clear();
  sent.length = 0;
  table.put({ PK: 'SETS', SK: `SET#${SET}`, name: 'Art', engagementType: 'call-and-answer', bluffRound: setBluff });
  const res = await createGame(asHost(ACME, {
    body: JSON.stringify({
      eventTitle: 'Art night', gameType: 'call-and-answer', questionSetId: SET,
      ...(bluffChoice === undefined ? {} : { bluffRound: bluffChoice }),
    }),
  }));
  assert.strictEqual(res.statusCode, 201, `create failed: ${res.body}`);
  const { gameId } = JSON.parse(res.body);
  const PK = `GAME#${gameId}`;
  Object.assign(row(PK, 'METADATA'), { QuestionSetId: SET });
  table.put({
    PK, SK: 'STATE#CATS',
    'AvailMask1-8': '10000000', 'AvailMask9-16': '00000000', 'AvailMask17-24': '00000000',
    'HostMask1-8': '10000000', 'HostMask9-16': '00000000', 'HostMask17-24': '00000000',
  });
  table.put({ PK, SK: 'CATEGORY#c001#ACTIVE', ActiveIndex: 0, QuestionCount: 2 });
  table.put({ PK, SK: 'CATEGORY#c001#ORDER', QuestionOrder: ['001', '002'], IsRandomized: false });
  table.put({ PK, SK: 'STATE#CATS#COUNTS', '1-8': [2], '9-16': [], '17-24': [], TotalEnabled: 2, TotalRemaining: 2, Version: 1 });
  table.put({ PK: SETPK, SK: 'CATEGORY#c001', Name: 'Post-Impressionism' });
  table.put({ PK: SETPK, SK: 'QUESTION#c001#001', Category: 'Post-Impressionism', Title: 'A SWIRLING NIGHT SKY', AnswerDetails: REVEAL });
  table.put({ PK: SETPK, SK: 'QUESTION#c001#002', Category: 'Post-Impressionism', Title: 'ANOTHER ONE', AnswerDetails: 'Real answer: Sunflowers.' });

  for (const name of players) {
    // The rows join-game.js writes (a lobby join needs a started session).
    table.put({ PK, SK: `PLAYER#${name}`, PlayerName: name, ClientId: `client-${name}`, JoinedAt: new Date().toISOString(), isConnected: true });
    table.put({ PK, SK: `PLAYER#${name}#SCORE`, PlayerName: name, score: 0, afterRound: '000' });
    table.put({ PK, SK: `CONNECTION#conn-${name}`, ConnectionId: `conn-${name}`, ConnectionType: 'PLAYER', PlayerName: name, GameId: gameId });
  }
  table.put({ PK, SK: 'CONNECTION#conn-host', ConnectionId: 'conn-host', ConnectionType: 'HOST', PlayerName: null, GameId: gameId });
  table.put({ PK, SK: 'CONNECTION#conn-wall', ConnectionId: 'conn-wall', ConnectionType: 'PLAYER', PlayerName: null, Viewer: 'present', ViewerId: 'v1', GameId: gameId });
  return gameId;
}

const press = (gameId, body = {}) => nextQuestion(asHost(ACME, { pathParameters: { gameId }, body: JSON.stringify(body) }));
const question = (gameId, qs) => getQuestion({ pathParameters: { gameId }, queryStringParameters: qs });
const leaks = (text, holder) => text.includes(REAL) || text.includes(STORY_HOOK)
  || /realAnswer|HolderName|holderName|"yours"/.test(text) || (holder ? new RegExp(`"${holder}"[^}]*(holder|real)`, 'i').test(text) : false);

(async () => {
  say('\nbluff round\n');

  /* ---------------------------------------------------------------------- */
  say('1. the rules');
  // rejects: the art set's "Real title:" reveal not read as a bluffable answer.
  await check('a "Real title:" reveal yields the title, up to the trivia', () => {
    assert.deepStrictEqual(bluff.realAnswerOf({ AnswerDetails: REVEAL }).realAnswer, `${REAL}, Vincent van Gogh, 1889`);
    assert.strictEqual(bluff.realAnswerOf({ AnswerDetails: 'Real answer: Sunflowers.' }).realAnswer, 'Sunflowers');
  });
  // rejects: the dedicated field losing to the derived one, or the story dropped.
  await check('a RealAnswer field wins, and the reveal stays the story', () => {
    const r = bluff.realAnswerOf({ RealAnswer: 'A potato peeler', AnswerDetails: 'Patented 1890.' });
    assert.deepStrictEqual(r, { realAnswer: 'A potato peeler', story: 'Patented 1890.' });
  });
  // rejects: an ordinary question treated as bluffable.
  await check('no real answer, no bluff', () => {
    assert.strictEqual(bluff.realAnswerOf({ AnswerDetails: 'Why it matters: ...' }), null);
    assert.strictEqual(bluff.realAnswerOf({ Title: 'x' }), null);
  });
  // rejects: the same player holding the truth twice running.
  await check('the pick avoids last round\'s holder when it can', () => {
    for (let i = 0; i < 20; i++) {
      assert.notStrictEqual(bluff.pickHolder(['Ada', 'Ben', 'Cy'], 'Ben', () => i / 20), 'Ben');
    }
    assert.strictEqual(bluff.pickHolder(['Ben'], 'Ben'), 'Ben');
  });
  // rejects: a stale or removed player, a viewer, or someone with no client id picked.
  await check('only joined, present, connected players with a client id are eligible', () => {
    const players = [
      { SK: 'PLAYER#Ada', PlayerName: 'Ada', ClientId: 'a' },
      { SK: 'PLAYER#Ada#SCORE', PlayerName: 'Ada' },
      { SK: 'PLAYER#Ben', PlayerName: 'Ben', ClientId: 'b', RemovedAt: 'x' },
      { SK: 'PLAYER#Cy', PlayerName: 'Cy' },
      { SK: 'PLAYER#Dee', PlayerName: 'Dee', ClientId: 'd' },
      { SK: 'PLAYER#Eve', PlayerName: 'Eve', ClientId: 'e' },
    ];
    const conns = ['Ada', 'Ben', 'Cy', 'Dee'].map((n) => ({ ConnectionType: 'PLAYER', PlayerName: n }))
      .concat([{ ConnectionType: 'HOST', PlayerName: 'Eve' }, { ConnectionType: 'PLAYER', PlayerName: null, Viewer: 'present' }]);
    assert.deepStrictEqual(bluff.eligibleHolders(players, conns), ['Ada', 'Dee']);
  });
  // rejects: the scoring the owner set — 2 per fooled vote; 1 + 1 for the truth.
  await check('scoring: 2 a fooled vote; the real one pays holder 1 and spotter 1; no self-votes', () => {
    const answers = [
      { PlayerName: 'Ada', Answer: 'bluff A' },
      { PlayerName: 'Ben', Answer: 'the real one, in Ben\'s voice' },
      { PlayerName: 'Cy', Answer: 'bluff C' },
      { PlayerName: 'Dee', Answer: 'bluff D' },
    ];
    const votes = [
      { VoterName: 'Ada', Votes: { 1: 1 } },          // spots it
      { VoterName: 'Ben', Votes: { 0: 1 } },          // fooled by Ada
      { VoterName: 'Cy', Votes: { 0: 1, 3: 2 } },     // fooled by Ada (only #1 counts)
      { VoterName: 'Dee', Votes: { 3: 1 } },          // self-vote: ignored
    ];
    const s = bluff.scoreBluff({ answers, votes, holderName: 'Ben' });
    assert.deepStrictEqual(s.points, { Ben: 1, Ada: 5 });
    assert.deepStrictEqual(s.topBluffers, [{ name: 'Ada', fooled: 2 }]);
    assert.deepStrictEqual(s.spotters, ['Ada']);
    assert.strictEqual(s.holderIdx, 1);
    assert.deepStrictEqual(s.answerPoints, { 0: 4, 1: 1, 2: 0, 3: 0 });
  });
  // rejects: Workie not being handed the real answer, its story and the outcome.
  await check('Workie\'s lines carry the real answer, the story and the outcome; names only when shown', () => {
    const b = { realAnswer: REAL, holderName: 'Ben', holderAnswered: true, holderAnswer: 'x', topBluffers: [{ name: 'Ada', fooled: 2 }], spotters: ['Cy'], realBallot: 2 };
    const open = bluff.bluffPromptLines(b, { story: REVEAL });
    assert.ok(open.includes(REAL) && open.includes(STORY_HOOK) && open.includes('Ben') && open.includes('Ada (2 votes)') && open.includes('Cy'));
    const hidden = bluff.bluffPromptLines(b, { story: REVEAL, hidden: true });
    assert.ok(hidden.includes(REAL) && !hidden.includes('Ben') && !hidden.includes('Ada'));
  });
  // rejects: the round's twist reaching a format it was never built for.
  await check('the session switch is Call & Answer only', () => {
    assert.strictEqual(bluff.sessionBluffOn({ GameType: 'trivia', HostPreferences: { bluffRound: true } }), false);
    assert.strictEqual(bluff.sessionBluffOn({ GameType: 'call-and-answer', HostPreferences: { bluffRound: true } }), true);
    assert.strictEqual(bluff.sessionBluffOn({ GameType: 'call-and-answer', HostPreferences: {} }), false);
  });

  /* ---------------------------------------------------------------------- */
  say('\n2. the session option');
  // rejects: the set's option not reaching a session that said nothing.
  await check('a create that says nothing takes the set\'s default', async () => {
    const g = await session({ setBluff: true });
    assert.strictEqual(row(`GAME#${g}`, 'METADATA').HostPreferences.bluffRound, true);
  });
  // rejects: the host unable to switch it off for one session.
  await check('the host can switch it off, and on for a set that has it off', async () => {
    let g = await session({ setBluff: true, bluffChoice: false });
    assert.strictEqual(row(`GAME#${g}`, 'METADATA').HostPreferences.bluffRound, false);
    g = await session({ setBluff: false, bluffChoice: true });
    assert.strictEqual(row(`GAME#${g}`, 'METADATA').HostPreferences.bluffRound, true);
  });

  /* ---------------------------------------------------------------------- */
  say('\n3. the ASK: only the holder learns the real answer');
  const gameId = await session({ setBluff: true });
  const PK = `GAME#${gameId}`;
  sent.length = 0;
  const opened = await press(gameId);
  const bluffRow = row(PK, 'BLUFF#001');
  const holder = bluffRow && bluffRow.HolderName;
  const others = ['Ada', 'Ben', 'Cy', 'Dee'].filter((n) => n !== holder);

  await check('the round opens with a holder among the joined players', () => {
    assert.strictEqual(opened.statusCode, 200, opened.body);
    assert.strictEqual(bluffRow.Status, 'active');
    assert.ok(['Ada', 'Ben', 'Cy', 'Dee'].includes(holder), `holder ${holder}`);
  });
  // rejects: the host's reply naming the holder ("without revealing who").
  await check('the host\'s reply says a bluff is in play, and not who', () => {
    const body = JSON.parse(opened.body);
    assert.deepStrictEqual(body.bluff, { active: true, minPlayers: 3 });
    assert.ok(!leaks(opened.body) && !opened.body.includes(`"${holder}"`), opened.body);
  });
  // rejects: the holder never actually being told.
  await check('the holder, with their client id, gets the real answer and the prompt', async () => {
    const res = await question(gameId, { role: 'player', playerName: holder, clientId: `client-${holder}` });
    const body = JSON.parse(res.body);
    assert.strictEqual(body.bluff.yours.realAnswer, `${REAL}, Vincent van Gogh, 1889`);
    assert.strictEqual(body.bluff.yours.prompt, 'Put it in your own words, so it sounds like you.');
    assert.ok(!res.body.includes(STORY_HOOK), 'the story is Workie\'s to tell afterwards');
  });
  // rejects: the name alone (public on the roster) being enough to read the secret.
  await check('the holder\'s NAME without their client id gets nothing', async () => {
    for (const qs of [{ playerName: holder }, { playerName: holder, clientId: 'guess' }, { playerName: holder, clientId: `client-${others[0]}` }]) {
      const res = await question(gameId, { role: 'player', ...qs });
      assert.ok(!leaks(res.body), `${JSON.stringify(qs)} → ${res.body}`);
    }
  });
  // rejects: any other player's payload carrying it.
  await check('every other player sees the normal prompt and only "a bluff is in play"', async () => {
    for (const name of others) {
      const res = await question(gameId, { role: 'player', playerName: name, clientId: `client-${name}` });
      const body = JSON.parse(res.body);
      assert.deepStrictEqual(body.bluff, { active: true, minPlayers: 3 });
      assert.strictEqual(body.title, 'A SWIRLING NIGHT SKY');
      assert.ok(!leaks(res.body), `${name}: ${res.body}`);
    }
  });
  // rejects: the host/stage door (role=host is a client-chosen flag) leaking.
  await check('the host, stage and anonymous payloads carry neither the answer nor the holder', async () => {
    const bodies = [
      (await question(gameId, { role: 'host' })).body,
      (await question(gameId, {})).body,
      (await getGameState({ pathParameters: { gameId }, queryStringParameters: {} })).body,
      (await getGameState(asHost(ACME, { pathParameters: { gameId }, queryStringParameters: { includeHostData: 'true' } }))).body,
      (await getPlayers({ pathParameters: { gameId }, queryStringParameters: {} })).body,
    ];
    for (const b of bodies) {
      assert.ok(!leaks(b), b.slice(0, 300));
      assert.ok(!/BLUFF#|bluffRole|isHolder/.test(b), 'a bluff row or marker reached a public payload');
    }
    const state = JSON.parse(bodies[2]);
    assert.deepStrictEqual(state.currentQuestionData.bluff, { active: true, minPlayers: 3 });
  });
  // rejects: a frame sent to the room carrying the answer or naming the holder.
  await check('no WebSocket frame carries the real answer or the holder', () => {
    const text = JSON.stringify(sent);
    assert.ok(sent.length > 0, 'expected questionStarted to be broadcast');
    assert.ok(!leaks(text), text.slice(0, 300));
    assert.ok(!/bluff/i.test(text), 'nothing about the bluff rides a frame');
  });

  /* ---------------------------------------------------------------------- */
  say('\n4. the VOTE');
  const order = ['Ada', 'Ben', 'Cy', 'Dee'];
  for (const name of order) {
    table.put({
      PK, SK: `QUESTION#001#ANSWER#${name}`, PlayerName: name,
      Answer: name === holder ? 'Starry, starry night, if I say so myself' : `${name}'s made-up title`,
      SubmittedAt: new Date().toISOString(),
    });
  }
  Object.assign(row(PK, 'STATE'), { State: 'VOTE#001' });

  const shown = JSON.parse((await getAnswers({ pathParameters: { gameId }, queryStringParameters: { role: 'player', questionId: '001' } })).body).answers;
  const posOf = (text) => shown.findIndex((a) => a.answer === text);
  const realPos = posOf('Starry, starry night, if I say so myself');
  const bluffer = others[0];
  const blufferPos = posOf(`${bluffer}'s made-up title`);

  // rejects: the ballot marking which answer is the real one.
  await check('the voting payload is the normal anonymous list', () => {
    assert.strictEqual(shown.length, 4);
    assert.ok(!leaks(JSON.stringify(shown)));
  });
  const vote = (name, pos) => submitVote({ pathParameters: { gameId }, body: JSON.stringify({ playerName: name, questionNumber: '001', votes: { [pos]: 1 }, clientId: `client-${name}` }) });
  // rejects: a self-vote buying the 2x points.
  await check('a vote for your own answer is refused', async () => {
    const res = await vote(bluffer, blufferPos);
    assert.strictEqual(res.statusCode, 400, res.body);
    assert.strictEqual(JSON.parse(res.body).code, 'OWN_ANSWER');
    assert.ok(!row(PK, `QUESTION#001#VOTE#${bluffer}`), 'the refused ballot was stored');
  });
  // The holder votes for the bluffer; the bluffer spots the truth; the other
  // two are fooled by the bluffer.
  const [, fooledA, fooledB] = others;
  await check('the ballots land', async () => {
    for (const [name, pos] of [[holder, blufferPos], [bluffer, realPos], [fooledA, blufferPos], [fooledB, blufferPos]]) {
      const res = await vote(name, pos);
      assert.strictEqual(res.statusCode, 200, `${name}: ${res.body}`);
    }
  });

  /* ---------------------------------------------------------------------- */
  say('\n5. RESULTS');
  const closed = await getResults(asHost(ACME, {
    pathParameters: { gameId },
    body: JSON.stringify({ questionNumber: '001' }),
    requestContext: { routeKey: 'POST /games/{gameId}/close-round', authorizer: { lambda: { userId: `user-${ACME}`, orgId: ACME, orgRole: 'admin', groups: 'hosts' } } },
  }));
  const result = JSON.parse(closed.body);
  const score = (name) => (row(PK, `PLAYER#${name}#SCORE`) || {}).score || 0;

  // rejects: the ranked 3-2-1 points being paid on a bluff round.
  await check('the bluff points land in the score rows', () => {
    assert.strictEqual(closed.statusCode, 200, closed.body);
    // bluffer: fooled 3 (6) + spotted the truth (1) = 7; holder: spotted once (1).
    assert.strictEqual(score(bluffer), 7, `bluffer ${score(bluffer)}`);
    assert.strictEqual(score(holder), 1, `holder ${score(holder)}`);
    assert.strictEqual(score(fooledA), 0);
    assert.strictEqual(score(fooledB), 0);
  });
  // rejects: the room never told which was real, or who had it.
  await check('the reveal names the real answer, its ballot number, the holder and the top bluffer', () => {
    assert.strictEqual(result.bluff.realAnswer, `${REAL}, Vincent van Gogh, 1889`);
    assert.strictEqual(result.bluff.holderName, holder);
    assert.strictEqual(result.bluff.realBallot, realPos + 1);
    assert.deepStrictEqual(result.bluff.topBluffers, [{ name: bluffer, fooled: 3 }]);
    assert.deepStrictEqual(result.bluff.spotters, [bluffer]);
    assert.deepStrictEqual(result.winners.map((w) => w.playerName), [bluffer]);
  });
  // rejects: Workie's read missing the outcome (it reads the stored row).
  await check('the reveal is stored on the RESULTS row for Workie', () => {
    const stored = row(PK, 'QUESTION#001#RESULTS');
    assert.ok(stored && stored.Bluff, 'no Bluff on the RESULTS row');
  });
  // rejects: a second close paying the round twice.
  await check('a second close pays nothing more', async () => {
    await getResults(asHost(ACME, {
      pathParameters: { gameId }, body: JSON.stringify({ questionNumber: '001' }),
      requestContext: { routeKey: 'POST /games/{gameId}/close-round', authorizer: { lambda: { userId: `user-${ACME}`, orgId: ACME, orgRole: 'admin', groups: 'hosts' } } },
    }));
    assert.strictEqual(score(bluffer), 7);
  });

  /* ---------------------------------------------------------------------- */
  say('\n6. too few players');
  const small = await session({ setBluff: true, players: ['Ada', 'Ben'] });
  const smallRes = await press(small);
  // rejects: a two-person room bluffing (the holder would be obvious).
  await check('fewer than three plays normally, and the host is told', async () => {
    assert.deepStrictEqual(JSON.parse(smallRes.body).bluff, { active: false, skipped: 'too-few-players', minPlayers: 3, players: 2 });
    const res = await question(small, { role: 'player', playerName: 'Ada', clientId: 'client-Ada' });
    assert.ok(!leaks(res.body), res.body);
  });
  const off = await session({ setBluff: false });
  const offRes = await press(off);
  // rejects: a session without the option writing or saying anything.
  await check('a session with it off writes nothing and says nothing', () => {
    assert.ok(!row(`GAME#${off}`, 'BLUFF#001'));
    assert.strictEqual(JSON.parse(offRes.body).bluff, undefined);
  });

  say(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})().catch((e) => { process.stdout.write(`harness error: ${e.stack}\n`); process.exit(2); });
