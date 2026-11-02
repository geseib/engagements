/**
 * THE BALLOT NUMBER IS THE REPLY ANCHOR (docs/design/phone-comments, backend
 * B1; experience plan Phase 3c).
 *
 * A reply to one response used to store the row's POSITION in whichever ranked
 * list the phone drew. On a tie the phone and the report could order the rows
 * differently, so a reply could land under the wrong person. Now:
 *
 *   - get-results / create-report give every response row its BALLOT number
 *     (the 1-based display place from answer-order.js, the number the room
 *     voted under);
 *   - a new reply stores that number with `AnchorBasis: 'ballot'`, the sort key
 *     keeping its numeric shape;
 *   - the report places each comment back on the response with that ballot
 *     number (comment-placement.js), and an older row with no basis by
 *     matching its stored quote, else under the whole round with its quote.
 *
 * Every expectation is built by hand from the fixture, never read back off
 * another field of the handler's own output.
 *
 * rejects: a ballot anchor read as a position; AnchorBasis stored for anything
 *          but a response, or for any value but 'ballot'; a changed sort-key
 *          shape; a tie that files a reply under the other tied response; an
 *          older reply filed by its untrustworthy position rather than its
 *          quote; an unmatched older reply dropped instead of kept under the
 *          whole round.
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');

// ---- Stubs, installed before either handler loads ---------------------------
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
  ApiGatewayManagementApiClient: class { async send() { return {}; } },
  PostToConnectionCommand,
});
stub('@aws-sdk/client-s3', { S3Client: class {}, PutObjectCommand: class {} });

process.env.TABLE_NAME = 'test-table';
process.env.WEBSOCKET_API_ENDPOINT = 'https://ws.test.invalid/dev';

const comments = require(path.join(REPO, 'lambda-functions/game/comments.js'));
const report = require(path.join(REPO, 'lambda-functions/game/create-report.js'));
const { displayOrder } = require(path.join(REPO, 'lambda-functions/game/answer-order.js'));
const { placeComment } = require(path.join(REPO, 'lambda-functions/game/comment-placement.js'));

let pass = 0; let fail = 0;
function check(label, fn) {
  try { fn(); console.log(`  PASS  ${label}`); pass += 1; } catch (e) {
    console.log(`  FAIL  ${label}\n        ${e.message}`); fail += 1;
  }
}

const GAME = '7301';
const put = (item) => store.set(key(item.PK, item.SK), item);
const rows = (prefix) => [...store.values()]
  .filter((i) => i.PK === `GAME#${GAME}` && String(i.SK).startsWith(prefix))
  .sort((a, b) => String(a.SK).localeCompare(String(b.SK)));

const ANSWERS = {
  Ada: 'Freeze all discretionary discounting for thirty days.',
  Bea: 'Re-price the onboarding package as a paid engagement.',
  Cy: 'Call our ten largest accounts first.',
};

function seed() {
  store.clear();
  put({
    PK: `GAME#${GAME}`, SK: 'METADATA',
    GameType: 'call-and-answer', Title: 'Q3 offsite', HostName: 'Dana', QuestionSetId: 'none', Visibility: 'public',
  });
  put({ PK: `GAME#${GAME}`, SK: 'STATE', State: 'RESULTS#001', LessonNumber: 1 });
  put({ PK: `GAME#${GAME}`, SK: 'ROUND#001', QuestionNumber: '001', AuthorsRevealed: true, ResultsShownAt: '2026-11-01T10:00:00.000Z' });
  put({
    PK: `GAME#${GAME}`, SK: 'QUESTION#001#RESULTS',
    QuestionId: '001', Winners: [], VoteTallies: {}, MaxVotes: 0, TotalVotes: 0,
  });
  for (const [who, text] of Object.entries(ANSWERS)) {
    put({ PK: `GAME#${GAME}`, SK: `QUESTION#001#ANSWER#${who}`, PlayerName: who, QuestionNumber: '001', Answer: text });
    put({ PK: `GAME#${GAME}`, SK: `PLAYER#${who}`, PlayerName: who });
  }
  put({ PK: `GAME#${GAME}`, SK: 'PLAYER#Lee', PlayerName: 'Lee' });
}

/** The room's numbers, computed here from the answer rows in SK order. */
function ballots() {
  const sk = rows('QUESTION#001#ANSWER#');
  const order = displayOrder(sk, GAME, '001');
  const out = {};
  order.forEach((canonical, pos) => { out[sk[canonical].PlayerName] = pos + 1; });
  return { out, sk, order };
}

const post = (body) => comments.handler({
  requestContext: { http: { method: 'POST' }, routeKey: 'POST /games/{gameId}/comments' },
  routeKey: 'POST /games/{gameId}/comments',
  pathParameters: { gameId: GAME },
  body: JSON.stringify({ questionNumber: 1, playerName: 'Lee', ...body }),
});
const getComments = () => comments.handler({
  requestContext: { http: { method: 'GET' }, routeKey: 'GET /games/{gameId}/comments' },
  routeKey: 'GET /games/{gameId}/comments',
  pathParameters: { gameId: GAME },
  queryStringParameters: { questionNumber: '001' },
});
const build = () => report.handler({
  requestContext: { http: { method: 'POST' } },
  pathParameters: { gameId: GAME },
  body: JSON.stringify({}),
});

(async () => {
  console.log('\n1. a reply stores its ballot number, marked as one');
  seed();
  const { out: ballotOf, sk, order } = ballots();
  const bea = ballotOf.Bea;
  const res = await post({
    anchorKind: 'response', anchorRef: String(bea), anchorBasis: 'ballot',
    anchorLabel: `Response ${bea} — Bea`, anchorExcerpt: 'Re-price the onboarding package as a paid engagement.',
    text: 'The only one that touches the customer.',
  });
  check('responds 201', () => assert.strictEqual(res.statusCode, 201, res.body));
  const written = rows('COMMENT#');
  check('the sort key keeps its numeric shape, with the ballot number as the ref', () => {
    assert.strictEqual(written.length, 1);
    assert.ok(new RegExp(`^COMMENT#001#response#${bea}#\\d{15}-[a-z0-9]+$`).test(written[0].SK), written[0].SK);
  });
  check('AnchorBasis is "ballot" and AnchorRef is the ballot number', () => {
    assert.strictEqual(written[0].AnchorBasis, 'ballot');
    assert.strictEqual(written[0].AnchorRef, String(bea));
  });

  console.log('\n2. only a response, and only "ballot", is ever marked');
  await post({ anchorKind: 'summary', anchorRef: '', anchorBasis: 'ballot', text: 'Sharp read.' });
  await post({ anchorKind: 'response', anchorRef: '2', anchorBasis: 'position', anchorExcerpt: 'x', text: 'Odd basis.' });
  check('a summary comment carries no basis, whatever was sent', () => {
    const row = rows('COMMENT#001#summary#')[0];
    assert.ok(row, 'summary row missing');
    assert.strictEqual('AnchorBasis' in row, false);
  });
  check('an unknown basis is dropped, so the row reads as an older one', () => {
    const row = rows('COMMENT#').find((r) => r.Text === 'Odd basis.');
    assert.strictEqual('AnchorBasis' in row, false);
  });

  console.log('\n3. the wire carries it back');
  const wire = JSON.parse((await getComments()).body);
  const list = wire.comments || wire;
  check('GET /comments returns anchorBasis on the ballot reply, and on no other', () => {
    const mine = list.find((c) => c.text === 'The only one that touches the customer.');
    assert.strictEqual(mine.anchorBasis, 'ballot');
    assert.strictEqual(mine.anchorRef, String(bea));
    for (const c of list.filter((x) => x !== mine)) assert.strictEqual('anchorBasis' in c, false, c.text);
  });

  console.log('\n4. the report maps it back, on a tie');
  // Ada and Bea tie on points (4 each); Bea has the first-place vote, so the
  // report ranks Bea first whatever the display order. Votes are canonical
  // (SK order) indexes, as submit-vote.js stores them.
  const idx = (who) => sk.findIndex((r) => r.PlayerName === who);
  put({ PK: `GAME#${GAME}`, SK: 'QUESTION#001#VOTE#v1', Votes: { [idx('Bea')]: 1, [idx('Ada')]: 2 } });
  put({ PK: `GAME#${GAME}`, SK: 'QUESTION#001#VOTE#v2', Votes: { [idx('Ada')]: 2, [idx('Bea')]: 3 } });
  // An older reply: position 0 (which would be the report's first row), but a
  // quote that is Cy's words. It belongs under Cy.
  put({
    PK: `GAME#${GAME}`, SK: 'COMMENT#001#response#0#000000000000001-old1', GameId: GAME, QuestionNumber: '001',
    AnchorKind: 'response', AnchorRef: '0', AnchorLabel: 'Response 1 — Cy',
    AnchorExcerpt: 'Call our ten largest accounts first.', Text: 'Older, by quote.', playerName: 'Lee', name: 'Lee',
    SubmittedAt: '2026-11-01T09:00:00.000Z',
  });
  // An older reply whose response is not in the round at all.
  put({
    PK: `GAME#${GAME}`, SK: 'COMMENT#001#response#7#000000000000002-old2', GameId: GAME, QuestionNumber: '001',
    AnchorKind: 'response', AnchorRef: '7', AnchorLabel: 'Response 8',
    AnchorExcerpt: 'A response that has since expired', Text: 'Older, unmatched.', playerName: 'Lee', name: 'Lee',
    SubmittedAt: '2026-11-01T09:01:00.000Z',
  });
  const built = await build();
  check('the report builds', () => assert.strictEqual(built.statusCode, 200, built.body));
  const round = JSON.parse(built.body).report.detailedQuestions.find((q) => q.questionNumber === '001');

  check('every response row carries its ballot number (display place + 1)', () => {
    for (const a of round.answers) {
      assert.strictEqual(a.ballot, ballotOf[a.playerName], `${a.playerName}: ${a.ballot}`);
      assert.strictEqual(a.ballot, order.indexOf(a.answerIndex) + 1);
    }
  });
  check('the tie is real: Ada and Bea share placement 1, Bea listed first', () => {
    assert.deepStrictEqual(round.answers.slice(0, 2).map((a) => [a.playerName, a.rank]), [['Bea', 1], ['Ada', 1]]);
  });
  const byText = (t) => round.comments.find((c) => c.text === t);
  check('the ballot reply carries its basis and is placed on Bea, by number', () => {
    const c = byText('The only one that touches the customer.');
    assert.strictEqual(c.anchorBasis, 'ballot');
    assert.deepStrictEqual(c.placement, { section: 'response', ballot: bea });
    const row = round.answers.find((a) => a.ballot === c.placement.ballot);
    assert.strictEqual(row.playerName, 'Bea');
  });
  check('an older reply is placed by its quote (Cy), not its stored position', () => {
    const c = byText('Older, by quote.');
    assert.strictEqual('anchorBasis' in c, false);
    assert.deepStrictEqual(c.placement, { section: 'response', ballot: ballotOf.Cy });
  });
  check('an older reply with no matching response goes under the whole round, quote kept', () => {
    const c = byText('Older, unmatched.');
    assert.deepStrictEqual(c.placement, { section: 'round', ballot: null });
    assert.strictEqual(c.anchorExcerpt, 'A response that has since expired');
  });
  check('Workie\'s comment goes under Workie\'s read', () => {
    assert.deepStrictEqual(byText('Sharp read.').placement, { section: 'summary', ballot: null });
  });

  console.log('\n5. placeComment on its own');
  const rowsByRank = [
    { answerText: 'Bea says', ballot: 3 },
    { answerText: 'Ada says', ballot: 1 },
  ];
  check('a ballot ref is a number to find, never a position', () => {
    // rejects: ref 1 read as position 1 (Ada) — it is ballot 1, which is Ada;
    // and ref 3 read as position 3 (nothing) — it is ballot 3, Bea.
    assert.deepStrictEqual(placeComment({ anchorKind: 'response', anchorRef: '3', anchorBasis: 'ballot' }, rowsByRank),
      { section: 'response', index: 0, ballot: 3 });
    assert.deepStrictEqual(placeComment({ anchorKind: 'response', anchorRef: '1', anchorBasis: 'ballot' }, rowsByRank),
      { section: 'response', index: 1, ballot: 1 });
  });
  check('a ballot nobody carries goes under the whole round', () => {
    assert.deepStrictEqual(placeComment({ anchorKind: 'response', anchorRef: '2', anchorBasis: 'ballot' }, rowsByRank),
      { section: 'round', index: null, ballot: null });
  });
  check('an older quote matches through markdown, case and a cut ellipsis', () => {
    const rowsMd = [{ answer: 'The **handoff** from sales to implementation, again.', ballot: 4 }];
    assert.deepStrictEqual(placeComment({ anchorKind: 'response', anchorRef: '9', anchorExcerpt: 'the handoff from sales…' }, rowsMd),
      { section: 'response', index: 0, ballot: 4 });
  });
  check('two responses opening alike: the stored position breaks the tie when it names one', () => {
    const twins = [{ answer: 'Same words here.', ballot: 1 }, { answer: 'Same words here.', ballot: 2 }];
    assert.strictEqual(placeComment({ anchorKind: 'response', anchorRef: '1', anchorExcerpt: 'Same words here.' }, twins).ballot, 2);
    assert.strictEqual(placeComment({ anchorKind: 'response', anchorRef: '5', anchorExcerpt: 'Same words here.' }, twins).ballot, 1);
  });
  check('a comment with no quote and no basis, or on the results, is the whole round\'s', () => {
    assert.strictEqual(placeComment({ anchorKind: 'response', anchorRef: '0', anchorExcerpt: '' }, rowsByRank).section, 'round');
    assert.strictEqual(placeComment({ anchorKind: 'results' }, rowsByRank).section, 'round');
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail === 0 ? 0 : 1);
})();
