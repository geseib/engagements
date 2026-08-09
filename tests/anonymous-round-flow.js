/**
 * GET /games/{id}/answers must not hand out authorship while a round is
 * anonymous — to EITHER role. `role` is a client-supplied query parameter
 * (get-answers.js:11), not derived from auth, so "hide it from players but
 * show it to the host" is not a guarantee this API can keep: anybody can ask
 * for role=host. The only implementable contract is that the server does not
 * send the names at all while hidden, regardless of what role was requested.
 *
 * Runs the REAL get-answers handler against a stubbed DynamoDB. Sibling of
 * tests/anonymity-contract.js (which tests the redaction gate in isolation)
 * and tests/vote-state-broadcast.js (which this file's stub preamble is
 * copied from).
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

const store = new Map();                 // "PK|SK" -> item
const key = (pk, sk) => `${pk}|${sk}`;

/** Frames the handler tried to push, in order. */
let sent = [];
/** Connection ids the stub should reject with 410 Gone. */
let goneConnections = new Set();

/**
 * A minimal, honest UpdateCommand applier — the real client mutates the stored
 * item. A stub returning {} would let a handler that never writes the state
 * pass, which is the whole family of bug this file guards.
 */
function applyUpdate(input) {
  const k = key(input.Key.PK, input.Key.SK);
  const item = store.get(k) || { ...input.Key };
  const names = input.ExpressionAttributeNames || {};
  const values = input.ExpressionAttributeValues || {};

  const setClause = String(input.UpdateExpression || '').replace(/^\s*SET\s+/i, '');
  for (const pair of setClause.split(',')) {
    const [lhs, rhs] = pair.split('=').map((s) => s.trim());
    if (!lhs || !rhs) continue;
    const attr = names[lhs] || lhs;
    item[attr] = values[rhs];
  }
  store.set(k, item);
  return {};
}

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
        return applyUpdate(inp);
      case 'query': {
        const pk = inp.ExpressionAttributeValues[':pk'];
        const prefix = inp.ExpressionAttributeValues[':sk'] ?? '';
        const items = [...store.values()].filter(
          (i) => i.PK === pk && String(i.SK).startsWith(String(prefix))
        );
        return { Items: items, Count: items.length };
      }
      default:
        return {};
    }
  },
};

class FakeApiGatewayClient {
  async send(cmd) {
    const { ConnectionId, Data } = cmd.input;
    if (goneConnections.has(ConnectionId)) {
      const err = new Error('Gone');
      err.name = 'GoneException';
      err.statusCode = 410;
      throw err;
    }
    sent.push({ connectionId: ConnectionId, message: JSON.parse(Data) });
    return {};
  }
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

const { handler: getAnswers } = require(path.join(REPO, 'lambda-functions/game/get-answers.js'));
const { handler: startVote } = require(path.join(REPO, 'lambda-functions/websocket/start-vote.js'));

// ---- Tiny harness ----------------------------------------------------------
let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const put = (item) => store.set(key(item.PK, item.SK), item);

/**
 * A call-and-answer game mid-round with two answers in. Defaults to ASK#001;
 * pass `state: 'VOTE#001'` for checks that need the player branch to actually
 * return an answers array (see section 2 below).
 */
function seedAnonymousRound(gameId, { anonymous = true, revealed = false, state = 'ASK#001' } = {}) {
  store.clear();
  sent = [];
  put({ PK: `GAME#${gameId}`, SK: 'METADATA', GameType: 'call-and-answer', Title: 'T',
        HostPreferences: { randomizeQuestions: true, anonymousUntilReveal: anonymous } });
  put({ PK: `GAME#${gameId}`, SK: 'STATE', State: state, LessonNumber: 1, CurrentQuestionId: '001' });
  put({ PK: `GAME#${gameId}`, SK: 'ROUND#001', QuestionNumber: '001', AuthorsRevealed: revealed });
  for (const n of ['Ada', 'Grace']) {
    put({ PK: `GAME#${gameId}`, SK: `QUESTION#001#ANSWER#${n}`,
          PlayerName: n, Answer: `${n}'s answer`, SubmittedAt: '2026-01-01T00:00:00.000Z' });
  }
}

const askAnswers = (gameId, role) => getAnswers({
  pathParameters: { gameId },
  queryStringParameters: { role, questionId: '001' }
});

(async () => {

console.log('\n1. GET /answers while hidden (ASK phase)');

seedAnonymousRound('3001');
const asHost = JSON.parse((await askAnswers('3001', 'host')).body);
const asPlayerAsk = JSON.parse((await askAnswers('3001', 'player')).body);

await check('the host payload carries no playerName', () =>
  assert.ok(asHost.answers.every(a => !('playerName' in a)),
    `leaked: ${JSON.stringify(asHost.answers[0])}`));
await check('the host payload carries no name', () =>
  assert.ok(asHost.answers.every(a => !('name' in a))));
await check('the answers themselves survive, in order', () =>
  assert.deepStrictEqual(asHost.answers.map(a => a.answer),
    ["Ada's answer", "Grace's answer"]));
await check('the count is unchanged', () =>
  assert.strictEqual(asHost.answerCount, 2));
// During ASK, players don't get anyone's answers yet — count only. That's an
// older, pre-vote gate, unrelated to anonymity (it exists so players aren't
// influenced before they answer, and it applies whether or not the round is
// anonymous). Pin it here: this is exactly the property that broke an
// earlier version of the parity check below when it was seeded at ASK
// instead of VOTE.
await check('during ASK, the player branch returns no answers array at all', () =>
  assert.ok(!('answers' in asPlayerAsk),
    `unexpected answers key during ASK: ${JSON.stringify(asPlayerAsk)}`));

console.log('\n2. GET /answers while hidden (VOTE phase — parity, host vs. player)');

// Seeded at VOTE#001, not ASK#001. Anonymity is only load-bearing here: VOTE
// is the one phase where BOTH roles actually receive an answers array (see
// the ASK invariant above), so it's the only phase where "host and player
// are given identical attribution" is even a testable claim. Do not move
// this seed back to ASK — that was the original bug in this file.
seedAnonymousRound('3005', { state: 'VOTE#001' });
const asHostVote = JSON.parse((await askAnswers('3005', 'host')).body);
const asPlayerVote = JSON.parse((await askAnswers('3005', 'player')).body);

// role is client-supplied, so "host" is not a trust boundary. Both branches
// must redact identically or the feature is a label on a leak.
await check('role=host and role=player return identical attribution', () =>
  assert.deepStrictEqual(
    asHostVote.answers.map(a => Object.keys(a).sort()),
    asPlayerVote.answers.map(a => Object.keys(a).sort()),
    'role is client-supplied, so any difference here means a player who asks ' +
    'for role=host sees names a real player could not — the whole design ' +
    'assumes both branches are given the same thing to send'));

console.log('\n3. GET /answers once revealed');

seedAnonymousRound('3002', { revealed: true });
const revealed = JSON.parse((await askAnswers('3002', 'host')).body);
await check('revealed rounds carry playerName again', () =>
  assert.strictEqual(revealed.answers[0].playerName, 'Ada'));

console.log('\n4. GET /answers with anonymity turned off');

seedAnonymousRound('3003', { anonymous: false });
const plain = JSON.parse((await askAnswers('3003', 'host')).body);
await check('opting out carries playerName from the start', () =>
  assert.strictEqual(plain.answers[0].playerName, 'Ada'));

console.log('\n5. a game with no HostPreferences at all');

seedAnonymousRound('3004');
delete store.get(key('GAME#3004', 'METADATA')).HostPreferences;
const legacy = JSON.parse((await askAnswers('3004', 'host')).body);
// Games created before this feature must be anonymous, not accidentally open.
await check('a pre-feature game defaults to hidden', () =>
  assert.ok(!('playerName' in legacy.answers[0])));

console.log('\n5. POST /start-vote while hidden');

seedAnonymousRound('3005');
// seedAnonymousRound doesn't seed connections (it's built for get-answers, which
// doesn't broadcast). start-vote's votingStarted frame only reaches `sent` if
// broadcastToGame finds at least one CONNECTION# record, so seed one here.
put({ PK: 'GAME#3005', SK: 'CONNECTION#host-1', ConnectionId: 'host-1', ConnectionType: 'HOST', IsHost: true });
const voteRes = await startVote({ pathParameters: { gameId: '3005' }, body: JSON.stringify({ questionNumber: 1 }) });
const votePayload = JSON.parse(voteRes.body);

await check('start-vote still returns 200', () =>
  assert.strictEqual(voteRes.statusCode, 200));
await check('the ballot carries all the answers', () =>
  assert.strictEqual(votePayload.answers.length, 2));
await check('no playerId — the label that named the answer', () =>
  assert.ok(votePayload.answers.every(a => !('playerId' in a)),
    `leaked: ${JSON.stringify(votePayload.answers[0])}`));
await check('no playerName and no name', () =>
  assert.ok(votePayload.answers.every(a => !('playerName' in a) && !('name' in a))));
await check('answer order is untouched — the ballot runs on it', () =>
  assert.deepStrictEqual(votePayload.answers.map(a => a.answer),
    ["Ada's answer", "Grace's answer"]));

// Regression guard for the fix in d9e58aae — this must not be lost.
await check('votingStarted still carries newState', () =>
  assert.strictEqual(sent[0]?.message?.newState, 'VOTE#001'));
await check('votingStarted carries no attribution and never did', () => {
  const frame = sent[0].message;
  assert.ok(!('playerName' in frame) && !('answers' in frame),
    'the broadcast has grown an attribution field');
});

console.log('\n6. the playerAnswered socket frame');

// This is the leak a purely HTTP redaction would leave behind: the host's
// socket receives a live author-to-answer mapping in real time, before any
// endpoint is called.
const { handler: wsMessage } = require(path.join(REPO, 'lambda-functions/websocket/message.js'));

seedAnonymousRound('3006');
put({ PK: 'GAME#3006', SK: 'CONNECTION#host-1', ConnectionId: 'host-1', ConnectionType: 'HOST' });
sent = [];

// NOTE ON EVENT SHAPE: handlePlayerMessage(gameId, playerName, messageType,
// messageData) is called with the ENTIRE parsed body as `messageData` (see
// message.js's handler: `handlePlayerMessage(gameId, playerName, messageType,
// body)`), and handlePlayerAnswer destructures `const { answer } =
// messageData` off that same object. So the answer text belongs at the top
// level of the body, not nested under a `messageData: {...}` envelope — a
// nested shape would leave `answer` inaccessible to the handler and would
// make the leak this test exists to catch invisible by accident rather than
// by the redaction actually working.
await wsMessage({
  requestContext: { connectionId: 'player-conn-1', domainName: 'ws.test.invalid', stage: 'dev' },
  body: JSON.stringify({
    action: 'message', gameId: '3006', playerName: 'Ada',
    messageType: 'ANSWER#001', answer: 'a splendid answer'
  })
});

const answered = sent.map(s => s.message).find(m => m.type === 'playerAnswered' || m.messageType === 'ANSWER#001');

// NOTE: `check` is async, so it must be awaited — a bare `check(...)` here
// races the final summary/process.exit() and can silently drop the LAST
// unawaited check's result before its microtask ever runs (caught empirically:
// with these calls unawaited, the file reported 20 checks even though 21
// check() calls exist in source). Every other section in this file already
// awaits; matching that here.
await check('a playerAnswered frame was still sent', () =>
  assert.ok(answered, 'the host was told nothing at all — progress would stall'));
await check('the frame names nobody', () =>
  assert.ok(!('playerName' in answered),
    `leaked author over the socket: ${JSON.stringify(answered)}`));
await check('the frame carries no answer text', () =>
  assert.ok(!('answer' in answered),
    `leaked answer body over the socket: ${JSON.stringify(answered)}`));
await check('the frame still identifies the round', () =>
  assert.strictEqual(String(answered.questionNumber), '001'));

console.log('\n7. playerVoted is NOT anonymised');

seedAnonymousRound('3007');
put({ PK: 'GAME#3007', SK: 'CONNECTION#host-1', ConnectionId: 'host-1', ConnectionType: 'HOST' });
sent = [];
await wsMessage({
  requestContext: { connectionId: 'player-conn-2', domainName: 'ws.test.invalid', stage: 'dev' },
  body: JSON.stringify({
    action: 'message', gameId: '3007', playerName: 'Ada',
    messageType: 'VOTE#001', votedFor: 'Grace'
  })
});
// NOTE ON EVENT SHAPE: message.js's isHostMessage() matches ANY
// 'VOTE#'-prefixed messageType, and the top-level handler checks
// isHostMessage() before isPlayerMessage() — so a player-originated
// VOTE#001 message is always routed through handleHostMessage, never through
// handlePlayerMessage's own VOTE# branch (the one that assigns
// notificationType = 'playerVoted', and the one this task's binding
// constraints forbid touching). That branch is unreachable through the real
// exported handler for any messageType value; it's a pre-existing routing
// property, not something this task's redaction change affects. §5.6.6: this
// feature is about who WROTE an answer, not who voted for it — the invariant
// this test can honestly check against the real handler is that whatever
// frame VOTE#001 does produce keeps the player's name.
const voted = sent.map(s => s.message).find(m => m.messageType === 'VOTE#001');
await check('playerVoted keeps its playerName', () =>
  assert.strictEqual(voted?.playerName, 'Ada'));

console.log('\n8. POST /reveal-authors');

const { handler: revealAuthors } = require(path.join(REPO, 'lambda-functions/game/reveal-authors.js'));

seedAnonymousRound('3008');
put({ PK: 'GAME#3008', SK: 'CONNECTION#host-1', ConnectionId: 'host-1', ConnectionType: 'HOST' });
put({ PK: 'GAME#3008', SK: 'CONNECTION#player-1', ConnectionId: 'player-1', ConnectionType: 'PLAYER' });
sent = [];

const rev = await revealAuthors({
  pathParameters: { gameId: '3008' },
  body: JSON.stringify({ questionNumber: 1 })
});
const revBody = JSON.parse(rev.body);

await check('responds 200', () =>
  assert.strictEqual(rev.statusCode, 200, rev.body));
await check('persists AuthorsRevealed on the round', () =>
  assert.strictEqual(store.get(key('GAME#3008', 'ROUND#001')).AuthorsRevealed, true));
await check('returns the rows with attribution joined back on', () =>
  assert.deepStrictEqual(revBody.answers.map(a => a.playerName), ['Ada', 'Grace']));
await check('order is still the ballot order', () =>
  assert.deepStrictEqual(revBody.answers.map(a => a.answer),
    ["Ada's answer", "Grace's answer"]));
await check('announces to every connection, host included', () =>
  assert.deepStrictEqual(sent.map(s => s.connectionId).sort(), ['host-1', 'player-1']));
await check('the frame is an authorsRevealed carrying the round', () => {
  const f = sent[0].message;
  assert.strictEqual(f.type, 'authorsRevealed');
  assert.strictEqual(f.gameId, '3008');
  assert.strictEqual(String(f.questionNumber), '001');
});

// A host double-tapping in front of a room must not error.
sent = [];
const again = await revealAuthors({
  pathParameters: { gameId: '3008' }, body: JSON.stringify({ questionNumber: 1 })
});
await check('is idempotent — a second reveal still returns 200', () =>
  assert.strictEqual(again.statusCode, 200));
await check('is idempotent — still revealed', () =>
  assert.strictEqual(store.get(key('GAME#3008', 'ROUND#001')).AuthorsRevealed, true));

// After reveal, the ordinary answers endpoint carries names again.
// NOTE ON EVENT SHAPE: the brief's draft asked role=player here, but this
// round is seeded (by seedAnonymousRound's default) at ASK#001, and
// get-answers.js's player branch only returns an `answers` array at all
// during VOTE# (see section 1's "during ASK, the player branch returns no
// answers array at all" — a pre-existing, anonymity-unrelated gate). role=host
// is the branch that actually carries answers during ASK, matching section 3's
// use of 'host' to check the same post-reveal property. Fixing the test, not
// the handler, per the task brief.
const afterReveal = JSON.parse((await askAnswers('3008', 'host')).body);
await check('GET /answers now carries attribution', () =>
  assert.strictEqual(afterReveal.answers[0].playerName, 'Ada'));

console.log('\n9. reveal on a round with no answers');

seedAnonymousRound('3009');
for (const n of ['Ada', 'Grace']) store.delete(key('GAME#3009', `QUESTION#001#ANSWER#${n}`));
const empty = await revealAuthors({
  pathParameters: { gameId: '3009' }, body: JSON.stringify({ questionNumber: 1 })
});
await check('an empty round still reveals and returns 200', () =>
  assert.strictEqual(empty.statusCode, 200));
await check('an empty round returns an empty list', () =>
  assert.deepStrictEqual(JSON.parse(empty.body).answers, []));

console.log('\n10. the playerAnswered round lookup pads the question number');

// Review round 1 finding: message.js's ANSWER# branch built the ROUND# key
// from the raw `messageNumber = messageType.replace('ANSWER#', '')` with no
// .padStart(3, '0') — every other ROUND# reader/writer in this file (and in
// start-vote.js / reveal-authors.js) pads. It fails safe today because a
// missed lookup returns Item: undefined and isHidden(meta, undefined) still
// evaluates to hidden — so a round seeded ANONYMOUS (the default) can't
// distinguish a correct padded lookup from a broken unpadded one; both land on
// "redact". To actually exercise the key-construction contract, this round is
// seeded REVEALED: a correct padded lookup finds ROUND#001 (AuthorsRevealed:
// true) and stops redacting; a broken unpadded lookup for 'ANSWER#1' queries
// 'ROUND#1', misses the row entirely, falls back to the hidden default, and
// keeps redacting — which is exactly the wrong answer once revealed, and
// exactly what this check catches.
seedAnonymousRound('3010', { revealed: true });
put({ PK: 'GAME#3010', SK: 'CONNECTION#host-1', ConnectionId: 'host-1', ConnectionType: 'HOST' });
sent = [];

await wsMessage({
  requestContext: { connectionId: 'player-conn-3', domainName: 'ws.test.invalid', stage: 'dev' },
  body: JSON.stringify({
    // Unpadded on purpose — '1', not '001'. handlePlayerAnswer's own state
    // check tolerates this (it tries both padded and unpadded forms), so this
    // exercises only the notification's round lookup, nothing upstream of it.
    action: 'message', gameId: '3010', playerName: 'Ada',
    messageType: 'ANSWER#1', answer: 'a splendid answer'
  })
});

const answeredRevealedUnpadded = sent.map(s => s.message)
  .find(m => m.type === 'playerAnswered' || m.messageType === 'ANSWER#1');

await check('an unpadded ANSWER# still finds the padded ROUND#001 row once revealed', () =>
  assert.ok(answeredRevealedUnpadded
    && answeredRevealedUnpadded.playerName === 'Ada'
    && answeredRevealedUnpadded.answer === 'a splendid answer',
    `padded round lookup regression — unpadded messageType missed ROUND#001 and ` +
    `over-redacted a revealed round: ${JSON.stringify(answeredRevealedUnpadded)}`));

console.log('\n11. Field Notes on an unrevealed round');

// get-ai-summary.js also imports @aws-sdk/client-s3 and @aws-sdk/client-lambda,
// which (unlike the packages stubbed above) aren't resolvable from local
// node_modules at all — they exist only in the deployed bundle — so stub()'s
// require.cache poisoning (which needs require.resolve to succeed first) can't
// reach them. Hook the loader by name instead, as tests/ai-response-parsing.js
// already does for this same file.
const Module = require('module');
const realLoad = Module._load;
const noopClient = class { async send() { return {}; } };
const extraStubs = new Map([
  ['@aws-sdk/client-s3', { S3Client: noopClient, GetObjectCommand: class {} }],
  ['@aws-sdk/client-lambda', { LambdaClient: noopClient, InvokeCommand: class {} }],
]);
Module._load = function (request, parent, isMain) {
  if (extraStubs.has(request)) return extraStubs.get(request);
  return realLoad.call(this, request, parent, isMain);
};

// Not hypothetical and not the model: get-ai-summary builds this string in code.
const { buildFallbackSummary } = require(path.join(REPO, 'lambda-functions/game/get-ai-summary.js'));
Module._load = realLoad; // restore — nothing after this point needs the hook

const top = { playerName: 'Ada', answer: 'a splendid answer', score: 5, votes: 3 };

await check('while hidden, the summary names nobody', () => {
  const text = buildFallbackSummary({
    totalParticipants: 2, votesCast: 3, top, gameType: 'call-and-answer',
    question: 'What should we stop doing?', hidden: true
  });
  assert.ok(!text.includes('Ada'), `named an unrevealed author: ${text}`);
});
await check('while hidden, it still reports the most-supported answer', () => {
  const text = buildFallbackSummary({
    totalParticipants: 2, votesCast: 3, top, gameType: 'call-and-answer',
    question: 'Q', hidden: true
  });
  assert.ok(/most[- ]supported|earned the most support/i.test(text), text);
});
await check('once revealed, it names the author as before', () => {
  const text = buildFallbackSummary({
    totalParticipants: 2, votesCast: 3, top, gameType: 'call-and-answer',
    question: 'Q', hidden: false
  });
  assert.ok(text.includes("Ada's answer"), text);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

})();
