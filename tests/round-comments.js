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

const get = (gameId, qs) => handler({
  requestContext: { http: { method: 'GET' }, routeKey: 'GET /games/{gameId}/comments' },
  routeKey: 'GET /games/{gameId}/comments',
  pathParameters: { gameId },
  queryStringParameters: qs || {},
});

/** A session on round 3, results shown, feedback round open. */
function seedGame(gameId, { lessonNumber = 3, beat = 'feedback', revealed = true } = {}) {
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

  // ---------- 2. the gate ----------
  console.log('\n2. a comment can only be written into an open feedback round');

  seedGame('4002', { beat: 'field-notes' });
  const notOpen = await post('4002', aComment());
  check('refused when the host has not opened a feedback round', () => {
    // Otherwise a phone left on the previous beat keeps writing into a round
    // the room has finished with, and the comments appear in a report nobody
    // was invited to comment on.
    assert.strictEqual(notOpen.statusCode, 409, `got ${notOpen.statusCode}`);
    assert.strictEqual(rows('4002', 'COMMENT#').length, 0);
  });

  seedGame('4003', { lessonNumber: 4 });
  const wrongRound = await post('4003', aComment({ questionNumber: 3 }));
  check('refused when the session has moved on to another round', () => {
    // The stale-phone case. Round 3's composer is still on screen while the
    // room is on round 4.
    assert.strictEqual(wrongRound.statusCode, 409, `got ${wrongRound.statusCode}`);
    assert.strictEqual(rows('4003', 'COMMENT#').length, 0);
  });

  seedGame('4004');
  const noGame = await post('9999', aComment());
  check('a session that does not exist is a 404, not a silent write', () =>
    assert.strictEqual(noGame.statusCode, 404, `got ${noGame.statusCode}`));

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

  const whole = JSON.parse((await get('4008', {})).body);
  check('and widened to the whole session', () =>
    assert.strictEqual(whole.comments.length, 3, `got ${whole.comments.length}`));

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

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
