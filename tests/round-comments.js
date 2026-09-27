/**
 * COMMENTS ON A ROUND'S REPORT — the write path, the read path, and the gate.
 *
 * The owner: *"there is a new round where every one can comment on what they
 * have heard … they click on a section (the summary, the results, a specific
 * user response) and the comments now can be seen in the resulting round of
 * feedback"*.
 *
 * Every expectation below is CONSTRUCTED BY HAND. None of them is read back off
 * another field of the handler's own response — an assertion that compares a
 * handler's output to itself passes for any self-consistent implementation,
 * including a wrong one, and four such assertions shipped green in this repo
 * before being caught.
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');

// ---- Stubs, installed before the handler loads -----------------------------
class PutCommand { constructor(i) { this.input = i; this.type = 'put'; } }
class GetCommand { constructor(i) { this.input = i; this.type = 'get'; } }
class QueryCommand { constructor(i) { this.input = i; this.type = 'query'; } }
class DeleteCommand { constructor(i) { this.input = i; this.type = 'delete'; } }
class UpdateCommand { constructor(i) { this.input = i; this.type = 'update'; } }
class PostToConnectionCommand { constructor(i) { this.input = i; } }

const store = new Map();
const key = (pk, sk) => `${pk}|${sk}`;
let sent = [];

const fakeDoc = {
  send: async (cmd) => {
    const inp = cmd.input || {};
    switch (cmd.type) {
      case 'put': store.set(key(inp.Item.PK, inp.Item.SK), inp.Item); return {};
      case 'get': return { Item: store.get(key(inp.Key.PK, inp.Key.SK)) };
      case 'delete': store.delete(key(inp.Key.PK, inp.Key.SK)); return {};
      case 'query': {
        const pk = inp.ExpressionAttributeValues[':pk'];
        const prefix = inp.ExpressionAttributeValues[':sk'] ?? '';
        const items = [...store.values()]
          .filter((i) => i.PK === pk && String(i.SK).startsWith(String(prefix)))
          .sort((a, b) => String(a.SK).localeCompare(String(b.SK)));
        return { Items: items, Count: items.length };
      }
      default: return {};
    }
  },
};

class FakeApiGatewayClient {
  async send(cmd) {
    sent.push({ connectionId: cmd.input.ConnectionId, message: JSON.parse(cmd.input.Data) });
    return {};
  }
}

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

const { handler } = require(path.join(REPO, 'lambda-functions/game/comments.js'));
const { MAX_COMMENT } = require(path.join(REPO, 'lambda-functions/game/comment-keys.js'));

let pass = 0, fail = 0;
function check(label, fn) {
  try { fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const put = (item) => store.set(key(item.PK, item.SK), item);
const rows = (gameId, prefix) => [...store.values()]
  .filter((i) => i.PK === `GAME#${gameId}` && String(i.SK).startsWith(prefix))
  .sort((a, b) => String(a.SK).localeCompare(String(b.SK)));

const post = (gameId, body) => handler({
  requestContext: { http: { method: 'POST' }, routeKey: 'POST /games/{gameId}/comments' },
  routeKey: 'POST /games/{gameId}/comments',
  pathParameters: { gameId },
  body: JSON.stringify(body),
});

const feedbackRound = (gameId) => handler({
  requestContext: { http: { method: 'GET' }, routeKey: 'GET /games/{gameId}/feedback-round' },
  routeKey: 'GET /games/{gameId}/feedback-round',
  pathParameters: { gameId },
  queryStringParameters: {},
});

const get = (gameId, qs) => handler({
  requestContext: { http: { method: 'GET' }, routeKey: 'GET /games/{gameId}/comments' },
  routeKey: 'GET /games/{gameId}/comments',
  pathParameters: { gameId },
  queryStringParameters: qs || {},
});

/** A session on round 3, results shown, feedback round open. */
function seedGame(gameId, {
  lessonNumber = 3, beat = 'feedback', revealed = true, clientId = undefined,
} = {}) {
  store.clear();
  sent = [];
  const padded = String(lessonNumber).padStart(3, '0');
  put({ PK: `GAME#${gameId}`, SK: 'METADATA', GameType: 'call-and-answer', Title: 'Q3 offsite' });
  put({ PK: `GAME#${gameId}`, SK: 'STATE', State: `RESULTS#${padded}`, LessonNumber: lessonNumber });
  put({
    PK: `GAME#${gameId}`, SK: `ROUND#${padded}`,
    QuestionNumber: padded, AuthorsRevealed: revealed, StageBeat: beat,
  });
  put({ PK: `GAME#${gameId}`, SK: 'CONNECTION#host-1', ConnectionId: 'host-1', ConnectionType: 'HOST' });
  put({ PK: `GAME#${gameId}`, SK: 'CONNECTION#p-1', ConnectionId: 'p-1', ConnectionType: 'PLAYER', PlayerName: 'Ada' });
  // A joined player, matching aComment()'s default author — MEMBERSHIP (fix
  // round 1, item 1): every test below that posts as 'Ada Lovelace' needs this
  // row to exist, or comments.js's new PLAYER# check refuses it before the
  // behaviour the test is actually about is ever reached.
  put({
    PK: `GAME#${gameId}`, SK: 'PLAYER#Ada Lovelace', PlayerName: 'Ada Lovelace',
    ...(clientId ? { ClientId: clientId } : {}),
  });
}

const aComment = (over = {}) => ({
  questionNumber: 3,
  playerName: 'Ada Lovelace',
  anchorKind: 'response',
  anchorRef: '1',
  anchorLabel: 'Response 2 — Sam Ortiz',
  anchorExcerpt: 'Re-price the onboarding package as a paid engagement.',
  text: 'This is the only one that touches the customer conversation.',
  ...over,
});

(async () => {
  // ---------- 1. the write ----------
  console.log('\n1. a participant comments on one section');
  seedGame('4001');
  const before = Math.floor(Date.now() / 1000);
  const res = await post('4001', aComment());

  check('responds 201', () =>
    assert.strictEqual(res.statusCode, 201, `got ${res.statusCode}: ${res.body}`));

  const written = rows('4001', 'COMMENT#');
  check('writes exactly one comment row', () =>
    assert.strictEqual(written.length, 1, `wrote ${written.length}`));

  check('the sort key names the round, the section and the position', () => {
    // Built by hand, not read off comment-keys. The id is the only part the
    // handler mints, so it is the only part matched loosely.
    const sk = written[0].SK;
    assert.ok(/^COMMENT#003#response#1#\d{15}-[a-z0-9]+$/.test(sk),
      `sort key was '${sk}'`);
  });

  check('every attribute is the one the caller sent, under the name the report reads', () => {
    const row = written[0];
    assert.strictEqual(row.PK, 'GAME#4001');
    assert.strictEqual(row.GameId, '4001');
    assert.strictEqual(row.QuestionNumber, '003');
    assert.strictEqual(row.AnchorKind, 'response');
    assert.strictEqual(row.AnchorRef, '1');
    assert.strictEqual(row.AnchorLabel, 'Response 2 — Sam Ortiz');
    assert.strictEqual(row.AnchorExcerpt, 'Re-price the onboarding package as a paid engagement.');
    assert.strictEqual(row.Text, 'This is the only one that touches the customer conversation.');
    assert.strictEqual(row.SubmittedAt.slice(0, 4), String(new Date().getFullYear()));
  });

  check('the author is stored under the spelling redaction strips', () => {
    // ANON_FIELDS is ['playerId','playerName','name'] — lower-case p. Storing
    // `PlayerName`, the way an answer row does, would survive redactAnswers
    // untouched and make the anonymity gate below decorative.
    const row = written[0];
    assert.strictEqual(row.playerName, 'Ada Lovelace');
    assert.strictEqual(row.name, 'Ada Lovelace');
    assert.strictEqual(row.PlayerName, undefined,
      'PlayerName is not in ANON_FIELDS and would survive redaction');
  });

  check('ttl is thirty days, not seven and not ninety', () => {
    // Computed here, independently. A comment is durable content: it must
    // outlive the ballot tier and share the report's tier.
    const row = written[0];
    const expected = before + (30 * 24 * 60 * 60);
    assert.ok(Math.abs(row.ttl - expected) <= 5,
      `ttl was ${row.ttl}, expected about ${expected} (${(row.ttl - before) / 86400} days)`);
  });

  check('the room is told, and the frame carries no comment text', () => {
    // Notify-then-refetch, the way `authorsRevealed` does it: the frame says
    // WHERE something changed and the clients go and read it. Putting the prose
    // on the wire would also put it past the redaction the read path applies.
    const ids = sent.map((s) => s.connectionId).sort();
    assert.deepStrictEqual(ids, ['host-1', 'p-1'], `announced to [${ids}]`);
    const frame = sent[0].message;
    assert.strictEqual(frame.type, 'commentPosted');
    assert.strictEqual(frame.gameId, '4001');
    assert.strictEqual(frame.questionNumber, '003');
    assert.strictEqual(frame.anchorKind, 'response');
    assert.strictEqual(frame.anchorRef, '1');
    assert.strictEqual(frame.text, undefined, 'the comment text was broadcast');
    assert.strictEqual(frame.playerName, undefined, 'the author was broadcast');
  });

  // ---------- 1b. membership (fix round 1, item 1) ----------
  console.log('\n1b. only a name that actually joined this session may comment');

  /*
    Review of the RESULTS-beat loosening above found the gap this section
    covers: with the beat gone, anyone holding the four-digit code could post
    arbitrary text under an arbitrary name and have it reach the projector's
    arrivals (RoomMeter) on every results screen. The owner's ruling: require
    the commenter to be `PLAYER#<name>` in this game, and — where the codebase
    already proves a claimed name belongs to the browser that claimed it
    (join-game.js's `ClientId`, read the identical way
    get-answers.js's `getOwnAnswer` reads it) — require that same proof.
  */
  seedGame('4013');
  const notJoined = await post('4013', aComment({ playerName: 'A Stranger' }));
  check('a name with no PLAYER# row in this game is refused', () => {
    assert.strictEqual(notJoined.statusCode, 409, `got ${notJoined.statusCode}: ${notJoined.body}`);
    assert.strictEqual(rows('4013', 'COMMENT#').length, 0);
  });

  seedGame('4014');
  const joined = await post('4014', aComment());
  check('a name that IS a joined player (seedGame\'s default PLAYER# row) is accepted', () =>
    assert.strictEqual(joined.statusCode, 201, `got ${joined.statusCode}: ${joined.body}`));

  seedGame('4015', { clientId: 'real-browser-id' });
  const noProof = await post('4015', aComment());
  check('refused with no clientId at all, once the row has one to check against', () => {
    assert.strictEqual(noProof.statusCode, 409, `got ${noProof.statusCode}: ${noProof.body}`);
    assert.strictEqual(rows('4015', 'COMMENT#').length, 0);
  });

  seedGame('4016', { clientId: 'real-browser-id' });
  const wrongProof = await post('4016', aComment({ clientId: 'a-different-browser-id' }));
  check('refused when the supplied clientId does not match the one the row was joined with', () => {
    assert.strictEqual(wrongProof.statusCode, 409, `got ${wrongProof.statusCode}: ${wrongProof.body}`);
    assert.strictEqual(rows('4016', 'COMMENT#').length, 0);
  });

  seedGame('4017', { clientId: 'real-browser-id' });
  const rightProof = await post('4017', aComment({ clientId: 'real-browser-id' }));
  check('accepted when the supplied clientId matches', () =>
    assert.strictEqual(rightProof.statusCode, 201, `got ${rightProof.statusCode}: ${rightProof.body}`));

  seedGame('4018'); // PLAYER# row has no ClientId at all — joined before the field existed.
  const legacyNoProof = await post('4018', aComment());
  check('a row with no stamped ClientId proves nothing either way, so membership alone is enough', () =>
    assert.strictEqual(legacyNoProof.statusCode, 201, `got ${legacyNoProof.statusCode}: ${legacyNoProof.body}`));

  // ---------- 2. the gate ----------
  console.log('\n2. a comment can be written on any beat of the round\'s RESULTS');

  /*
    THE OWNER'S RULING, 26 SEP 2026: a player's own "Feedback" button (the
    ordinary RESULTS# screen, PlayerPage.jsx) posts a comment without the host
    ever opening a feedback round. So a beat OTHER than 'feedback' is no
    longer a refusal — the session being on THIS round's RESULTS is enough by
    itself. The three checks below (field-notes, the tally, and feedback
    itself) are the exhaustive set: BEATS is a closed three-value enum
    (stage-beats.js), and all three must now accept a comment.
  */
  seedGame('4002', { beat: 'field-notes' });
  const onFieldNotes = await post('4002', aComment());
  check('accepted on field-notes — no feedback round was ever opened', () => {
    assert.strictEqual(onFieldNotes.statusCode, 201, `got ${onFieldNotes.statusCode}: ${onFieldNotes.body}`);
    assert.strictEqual(rows('4002', 'COMMENT#').length, 1);
  });

  seedGame('4002b', { beat: 'results' });
  const onTally = await post('4002b', aComment());
  check('accepted on the tally beat too — same round, same rule', () => {
    assert.strictEqual(onTally.statusCode, 201, `got ${onTally.statusCode}: ${onTally.body}`);
    assert.strictEqual(rows('4002b', 'COMMENT#').length, 1);
  });

  seedGame('4002c'); // seedGame's default beat is 'feedback'.
  const onFeedbackBeat = await post('4002c', aComment());
  check('the feedback-beat path still works — unchanged, not merely still passing', () => {
    assert.strictEqual(onFeedbackBeat.statusCode, 201, `got ${onFeedbackBeat.statusCode}`);
    assert.strictEqual(rows('4002c', 'COMMENT#').length, 1);
  });

  seedGame('4003', { lessonNumber: 4 });
  const wrongRound = await post('4003', aComment({ questionNumber: 3 }));
  check('refused when the session has moved on to another round', () => {
    // The stale-phone case. Round 3's composer is still on screen while the
    // room is on round 4. Still refused: this is fact (1) in the header, and
    // the ruling above never touched it.
    assert.strictEqual(wrongRound.statusCode, 409, `got ${wrongRound.statusCode}`);
    assert.strictEqual(rows('4003', 'COMMENT#').length, 0);
  });

  seedGame('4003a');
  put({ PK: 'GAME#4003a', SK: 'STATE', State: 'ASK#003', LessonNumber: 3 });
  const onAsk = await post('4003a', aComment());
  check('refused while the session is on ASK', () => {
    assert.strictEqual(onAsk.statusCode, 409, `got ${onAsk.statusCode}`);
    assert.strictEqual(rows('4003a', 'COMMENT#').length, 0);
  });

  seedGame('4003b');
  put({ PK: 'GAME#4003b', SK: 'STATE', State: 'VOTE#003', LessonNumber: 3 });
  const onVote = await post('4003b', aComment());
  check('refused while the session is on VOTE', () => {
    assert.strictEqual(onVote.statusCode, 409, `got ${onVote.statusCode}`);
    assert.strictEqual(rows('4003b', 'COMMENT#').length, 0);
  });

  seedGame('4004');
  const noGame = await post('9999', aComment());
  check('a session that does not exist is a 404, not a silent write', () =>
    assert.strictEqual(noGame.statusCode, 404, `got ${noGame.statusCode}`));

  seedGame('4004b');
  store.delete(key('GAME#4004b', 'ROUND#003'));
  const noRoundRecord = await post('4004b', aComment());
  check('refused when the round record itself does not exist — a defensive check, not the dropped beat requirement', () => {
    assert.strictEqual(noRoundRecord.statusCode, 409, `got ${noRoundRecord.statusCode}`);
    assert.strictEqual(rows('4004b', 'COMMENT#').length, 0);
  });

  // ---------- 3. what the handler refuses ----------
  console.log('\n3. nothing malformed becomes a sort key or a row');

  const refusals = [
    ['an unknown anchor kind', { anchorKind: 'question' }],
    ['a response anchor with no position', { anchorKind: 'response', anchorRef: '' }],
    ['a position that is not a number', { anchorKind: 'response', anchorRef: 'two' }],
    ['a position carrying a separator', { anchorKind: 'response', anchorRef: '1#2' }],
    ['a round number that is not a number', { questionNumber: 'three' }],
    ['no text at all', { text: '' }],
    ['text that is only whitespace', { text: '   \n  ' }],
    ['no author', { playerName: '' }],
    ['text past the ceiling', { text: 'x'.repeat(MAX_COMMENT + 1) }],
  ];
  for (const [label, over] of refusals) {
    seedGame('4005');
    const bad = await post('4005', aComment(over));
    check(`${label} is a 400 and writes nothing`, () => {
      assert.strictEqual(bad.statusCode, 400, `got ${bad.statusCode}: ${bad.body}`);
      assert.strictEqual(rows('4005', 'COMMENT#').length, 0, 'a refused comment was written');
    });
  }

  seedGame('4006');
  const atCeiling = await post('4006', aComment({ text: 'y'.repeat(MAX_COMMENT) }));
  check('text exactly at the ceiling is accepted', () =>
    assert.strictEqual(atCeiling.statusCode, 201, `got ${atCeiling.statusCode}`));

  // ---------- 4. the summary and results anchors ----------
  console.log('\n4. all three anchors, and the empty ref they share');

  seedGame('4007');
  await post('4007', aComment({ anchorKind: 'summary', anchorRef: '', anchorLabel: 'AI summary' }));
  await post('4007', aComment({ anchorKind: 'results', anchorRef: '', anchorLabel: 'Results' }));
  check('summary and results write a ref-less key that the round prefix still matches', () => {
    const keys = rows('4007', 'COMMENT#').map((r) => r.SK.replace(/#\d{15}-[a-z0-9]+$/, ''));
    assert.deepStrictEqual(keys.sort(), ['COMMENT#003#results#', 'COMMENT#003#summary#']);
    assert.strictEqual(rows('4007', 'COMMENT#003#').length, 2,
      'the round prefix did not match every anchor kind');
  });

  // ---------- 5. the read ----------
  console.log('\n5. reading them back');

  seedGame('4008');
  await post('4008', aComment({ text: 'First remark', anchorKind: 'summary', anchorRef: '' }));
  await post('4008', aComment({ text: 'Second remark', anchorKind: 'summary', anchorRef: '' }));
  await post('4008', aComment({ text: 'On a response', anchorKind: 'response', anchorRef: '0' }));

  const all = JSON.parse((await get('4008', { questionNumber: '3' })).body);
  check('returns every comment on the round', () =>
    assert.strictEqual(all.comments.length, 3, `got ${all.comments.length}`));

  check('each carries its anchor, its text and its author', () => {
    const onResponse = all.comments.filter((c) => c.anchorKind === 'response');
    assert.strictEqual(onResponse.length, 1);
    assert.strictEqual(onResponse[0].anchorRef, '0');
    assert.strictEqual(onResponse[0].text, 'On a response');
    assert.strictEqual(onResponse[0].playerName, 'Ada Lovelace');
    assert.strictEqual(onResponse[0].questionNumber, '003');
  });

  check('comments on one section come back in the order they were written', () => {
    // The id is time-ordered so a begins_with returns writing order with no
    // sort at the call site. "Second remark" after "First remark", always.
    const summary = all.comments.filter((c) => c.anchorKind === 'summary').map((c) => c.text);
    assert.deepStrictEqual(summary, ['First remark', 'Second remark']);
  });

  const scoped = JSON.parse((await get('4008', {
    questionNumber: '3', anchorKind: 'summary', anchorRef: '',
  })).body);
  check('a read can be narrowed to one section', () =>
    assert.strictEqual(scoped.comments.length, 2, `got ${scoped.comments.length}`));

  const whole = await get('4008', {});
  check('but NOT widened to the whole session — this route is public and unauthenticated', () => {
    /*
      commentPrefix({}) (comment-keys.js) returns the bare 'COMMENT#' on
      purpose — create-report.js wants exactly that, one query for the whole
      game. But create-report.js reaches the table directly with its own
      QueryCommand and never calls this handler, so the session-wide prefix
      being POSSIBLE is not a reason for this PUBLIC route to serve it. Game
      ids are four digits (create-game.js:191): without this refusal, an
      unauthenticated script walking 1000-9999 gets back every comment in
      every live or recently-ended session it lands on — decrypted, with
      author names attached — in one call each, no round scoping required.
      That is the widest public surface this feature has, wider even than the
      pre-existing GET /games/{id}/answers this is otherwise the shape of.
    */
    assert.strictEqual(whole.statusCode, 400, `got ${whole.statusCode}: ${whole.body}`);
    assert.match(JSON.parse(whole.body).error, /questionNumber/i,
      'refused for the wrong reason, or not refused at all');
  });

  check('the per-round read is unaffected — it is what a real composer and a real report page use', () => {
    // Re-stated here, next to the refusal above, so the two read as one
    // decision: narrow the public surface without narrowing what any
    // legitimate caller (the composer, PastRound, the participant's own page)
    // can already do. `all` above already proved this; this just keeps the
    // two claims textually adjacent for whoever reads this test next.
    assert.strictEqual(all.comments.length, 3, `got ${all.comments.length}`);
  });

  const emptyRound = JSON.parse((await get('4008', { questionNumber: '9' })).body);
  check('a round with no comments is an empty list, not an error', () =>
    assert.deepStrictEqual(emptyRound.comments, []));

  // ---------- 6. anonymity ----------
  console.log('\n6. the anonymity gate, which is dead today and must still be wired');

  seedGame('4009', { revealed: false });
  await post('4009', aComment({ text: 'Said while the round was still hidden' }));
  const hidden = JSON.parse((await get('4009', { questionNumber: '3' })).body);

  check('an unrevealed round returns the comment with no author at all', () => {
    /*
      Today this branch cannot be reached in production: get-results.js:265 sets
      AuthorsRevealed unconditionally on entering RESULTS, and a feedback round
      is a beat INSIDE results. It is wired anyway so that if the reveal
      semantics ever change, comments redact WITH responses rather than becoming
      the one surface in the product that leaks names.

      OMITTED, never nulled — the rule game/anonymity.js states and
      create-report.js follows: a client that forgets to handle anonymity then
      renders nothing rather than the string "null", and the redaction shows up
      in a payload diff.
    */
    const c = hidden.comments[0];
    assert.strictEqual(c.text, 'Said while the round was still hidden');
    assert.ok(!('playerName' in c), `playerName survived: ${JSON.stringify(c)}`);
    assert.ok(!('name' in c), 'name survived');
    assert.ok(!('playerId' in c), 'playerId survived');
  });

  // ---------- 7. what the participant is handed ----------
  console.log('\n7. the round a participant is asked to comment on');

  /*
    HOW A PARTICIPANT GETS THE REPORT was missing from the first design, and
    both obvious answers were wrong.

    POST /report WRITES: forty phones calling it is forty full-partition
    re-queries, forty KMS encrypts and forty overwrites of the same REPORT row.

    GET /report branches on an unverified `?role=` parameter, and its non-host
    branch returns a leaderboard with no detailedQuestions at all — nothing to
    comment on. Passing `role=host` from a phone would work, and would hand
    every phone in the room the whole session: every round, every response, and
    the standings.

    So this route is minimum-privilege by construction: ONE round, the one the
    host has actually opened, and it refuses when none is open.
  */
  seedGame('4010');
  put({
    PK: 'GAME#4010', SK: 'REPORT',
    gameId: '4010', gameTitle: 'Q3 offsite', roundNoun: 'Round',
    gameStats: { totalPlayers: 4, totalComments: 0 },
    playerPerformance: [{ playerName: 'Ada', totalScore: 9 }],
    detailedQuestions: [
      { questionNumber: '002', questionData: { title: 'Round two' }, answers: [], comments: [] },
      {
        questionNumber: '003',
        questionData: { title: 'Competitive response', detail: 'They cut price.' },
        answers: [{ answerIndex: 0, answerText: 'Freeze discounting.', playerName: 'Ada', rank: 1 }],
        aiSummary: { summaryText: 'The room wants to defend price.' },
        comments: [],
      },
    ],
  });
  await post('4010', aComment({ text: 'Only one touches the customer.' }));

  const fr = JSON.parse((await feedbackRound('4010')).body);

  check('it returns the round the host actually opened', () =>
    assert.strictEqual(fr.round.questionNumber, '003', `got ${fr.round && fr.round.questionNumber}`));

  check('with the question, the responses and the summary the room is commenting on', () => {
    assert.strictEqual(fr.round.questionData.title, 'Competitive response');
    assert.strictEqual(fr.round.answers.length, 1);
    assert.strictEqual(fr.round.aiSummary.summaryText, 'The room wants to defend price.');
  });

  check('and the comments already on it', () => {
    assert.strictEqual(fr.round.comments.length, 1);
    assert.strictEqual(fr.round.comments[0].text, 'Only one touches the customer.');
  });

  check('it hands over ONE round and not the session', () => {
    // The whole point of the route. A participant must not receive round 2.
    assert.strictEqual(fr.detailedQuestions, undefined, 'the whole session was returned');
    assert.ok(!Array.isArray(fr.rounds), 'a list of rounds was returned');
  });

  check('and no standings', () => {
    // A leaderboard on forty phones mid-session is attribution by arithmetic,
    // and nothing in a feedback round needs it.
    assert.strictEqual(fr.playerPerformance, undefined);
    assert.strictEqual(fr.leaderboard, undefined);
  });

  check('it says which round is open, for the composer to post back', () =>
    assert.strictEqual(fr.questionNumber, '003'));

  seedGame('4011', { beat: 'field-notes' });
  put({ PK: 'GAME#4011', SK: 'REPORT', gameId: '4011', detailedQuestions: [] });
  const closed = await feedbackRound('4011');
  check('no open feedback round is a 409, not a report', () =>
    assert.strictEqual(closed.statusCode, 409, `got ${closed.statusCode}`));

  seedGame('4012');
  const noReport = await feedbackRound('4012');
  check('an open round whose report has not been built yet says so', () => {
    // The host builds the report before opening the beat, but a phone can
    // arrive between the two calls. It must read as "not ready", not as an
    // error the participant has to interpret.
    assert.strictEqual(noReport.statusCode, 409, `got ${noReport.statusCode}`);
    assert.match(JSON.parse(noReport.body).error, /report/i);
  });

  // ---------- 8. a closed survey: its one pseudo-round, 000 ----------
  console.log('\n8. a closed survey takes comments on 000, and never with a name');

  /*
    The owner, 27 Sep 2026: surveys get "the ability to provide feedback just
    like we do for call and answer". A survey has no RESULTS#nnn — it is
    SURVEY#OPEN, then SURVEY#CLOSED, then ENDED — so its Workie read and the
    comments on it sit at 000, open exactly while the survey is CLOSED.
    tests/survey-workie-read.js drives the same through the real close.
  */
  function seedSurvey(gameId, { state = 'SURVEY#CLOSED', beat = 'field-notes', prefs } = {}) {
    store.clear();
    sent = [];
    put({
      PK: `GAME#${gameId}`, SK: 'METADATA', GameType: 'survey', Title: 'Offsite pulse',
      ...(prefs ? { HostPreferences: prefs } : {}),
    });
    put({ PK: `GAME#${gameId}`, SK: 'STATE', State: state });
    put({ PK: `GAME#${gameId}`, SK: 'ROUND#000', QuestionNumber: '000', StageBeat: beat });
    put({ PK: `GAME#${gameId}`, SK: 'PLAYER#Ada Lovelace', PlayerName: 'Ada Lovelace' });
  }
  const onTheRead = (over = {}) => aComment({
    questionNumber: 0, anchorKind: 'summary', anchorRef: '', anchorLabel: 'AI summary',
    anchorExcerpt: 'Prep matters.', text: 'Send the agenda too.', ...over,
  });

  seedSurvey('4020');
  const surveyWrite = await post('4020', onTheRead());
  check('a closed survey: a comment on 000 is written (201)', () =>
    assert.strictEqual(surveyWrite.statusCode, 201, `got ${surveyWrite.statusCode}: ${surveyWrite.body}`));
  check('...under COMMENT#000, the key create-report files as the survey\'s read', () =>
    assert.ok(/^COMMENT#000#summary#/.test(rows('4020', 'COMMENT#')[0].SK), rows('4020', 'COMMENT#')[0].SK));

  seedSurvey('4021');
  const otherRound = await post('4021', onTheRead({ questionNumber: 3 }));
  // rejects: a gate that opens any round number once a survey is closed.
  check('a closed survey: any round but 000 is refused (409)', () =>
    assert.strictEqual(otherRound.statusCode, 409, `got ${otherRound.statusCode}`));

  for (const state of ['SURVEY#OPEN', 'ENDED']) {
    seedSurvey('4022', { state });
    // eslint-disable-next-line no-await-in-loop
    const refused = await post('4022', onTheRead());
    // rejects: comments while the room is still answering, or after the end.
    check(`a survey in ${state}: a comment on 000 is refused (409)`, () =>
      assert.strictEqual(refused.statusCode, 409, `got ${refused.statusCode}`));
  }

  seedGame('4023');
  put({ PK: 'GAME#4023', SK: 'STATE', State: 'SURVEY#CLOSED' });
  const notASurvey = await post('4023', onTheRead());
  // rejects: keying the 000 door on the state string alone.
  check('a round session is not a survey, whatever its state says: 000 is refused (409)', () =>
    assert.strictEqual(notASurvey.statusCode, 409, `got ${notASurvey.statusCode}`));

  // The host's saved preference says names are shown; a survey says otherwise.
  seedSurvey('4024', { prefs: { anonymousUntilReveal: false } });
  await post('4024', onTheRead());
  const surveyRead = JSON.parse((await get('4024', { questionNumber: '000' })).body);
  check('read back, a survey comment carries no name — even with names switched on for rounds', () => {
    assert.strictEqual(surveyRead.comments.length, 1);
    const c = surveyRead.comments[0];
    assert.strictEqual(c.text, 'Send the agenda too.');
    assert.ok(!('playerName' in c) && !('name' in c), `a name survived: ${JSON.stringify(c)}`);
  });

  seedSurvey('4025', { beat: 'feedback' });
  put({
    PK: 'GAME#4025', SK: 'REPORT', gameId: '4025', gameTitle: 'Offsite pulse',
    detailedQuestions: [{
      questionNumber: '000', questionData: { title: 'Question 000' }, answers: [],
      aiSummary: { markdownResponse: '## What the Room Said\n\n- **Prep**: send slides early.' }, comments: [],
    }],
    surveyResults: {
      n: 2, finished: 2,
      questions: [
        { qid: 'c001#001', n: 1, kind: 'rating', scale: '1-5', title: 'How useful was today?', result: { kind: 'rating', n: 2, counts: [0, 0, 1, 0, 1], mean: 4 }, texts: [] },
        { qid: 'c001#002', n: 2, kind: 'text', title: 'What would you change?', result: { kind: 'text', n: 1, answerIds: ['c001#002:0'] }, texts: [{ id: 'c001#002:0', text: 'Slides a day ahead' }] },
      ],
    },
  });
  await post('4025', onTheRead());
  const surveyRound = JSON.parse((await feedbackRound('4025')).body);
  check('the survey\'s feedback round is round 000, titled with the survey', () => {
    assert.strictEqual(surveyRound.questionNumber, '000');
    assert.strictEqual(surveyRound.round.title, 'Offsite pulse');
    assert.strictEqual(surveyRound.round.questionData.title, 'Offsite pulse');
  });
  // rejects: a round RoundReport cannot draw — it reads `answers[].answer`.
  check('...one row per question, in the words the Workie was given', () => {
    assert.strictEqual(surveyRound.round.answers.length, 2);
    assert.ok(surveyRound.round.answers[0].answer.startsWith('1. How useful was today? (a rating)'),
      surveyRound.round.answers[0].answer);
    assert.ok(surveyRound.round.answers[1].answer.includes('"Slides a day ahead"'), surveyRound.round.answers[1].answer);
    assert.strictEqual(surveyRound.round.answers[1].answerText, surveyRound.round.answers[1].answer);
  });
  check('...with the Workie\'s read from the 000 slice, and the comments, nameless', () => {
    assert.ok(surveyRound.round.aiSummary.markdownResponse.includes('send slides early'));
    assert.strictEqual(surveyRound.round.comments.length, 1);
    assert.ok(!('playerName' in surveyRound.round.comments[0]), 'a name survived');
  });

  seedSurvey('4026', { beat: 'field-notes' });
  put({ PK: 'GAME#4026', SK: 'REPORT', gameId: '4026', detailedQuestions: [], surveyResults: { n: 0, questions: [] } });
  const surveyNotOpen = await feedbackRound('4026');
  check('a closed survey on What We Heard has no feedback round open (409)', () =>
    assert.strictEqual(surveyNotOpen.statusCode, 409, `got ${surveyNotOpen.statusCode}`));

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail === 0 ? 0 : 1);
})();
