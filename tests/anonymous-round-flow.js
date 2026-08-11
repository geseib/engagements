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
class ScanCommand { constructor(i) { this.input = i; this.type = 'scan'; } }
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
      case 'scan': {
        // Only real caller is get-ai-summary.js's findDefaultPromptId, which
        // always scans for `PK = :pk AND isDefault = :isDefault`. A generic
        // AND-of-equalities filter over ExpressionAttributeValues is enough
        // for that shape without pretending to be a real Scan.
        const values = inp.ExpressionAttributeValues || {};
        const items = [...store.values()].filter((i) => {
          if (values[':pk'] !== undefined && i.PK !== values[':pk']) return false;
          if (values[':isDefault'] !== undefined && i.isDefault !== values[':isDefault']) return false;
          return true;
        });
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
  PutCommand, GetCommand, QueryCommand, DeleteCommand, UpdateCommand, ScanCommand,
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
//
// @aws-sdk/client-bedrock-runtime IS resolvable locally (unlike the two
// above), so it would otherwise load for real and try an actual network call
// to AWS the moment any test below drives generateAISummary() past prompt
// resolution. Stub it to fail fast and deterministically instead — every
// test below that reaches Bedrock is exercising the fallback-on-failure path
// (buildFallback(), with debugInfo still attached under debugMode), which is
// realistic: Bedrock failing is exactly the everyday case this fallback
// exists for, and it's the same code path a real throttle or outage takes.
// The client is a MODULE-LEVEL singleton in get-ai-summary.js (created once,
// at require time) — this stub has to be in place before the FIRST require
// of that file below, or a later section stubbing it would be too late.
const Module = require('module');
const realLoad = Module._load;
const noopClient = class { async send() { return {}; } };
const throwingBedrock = class { async send() { throw new Error('stub: no Bedrock in tests'); } };
const extraStubs = new Map([
  ['@aws-sdk/client-s3', { S3Client: noopClient, GetObjectCommand: class {} }],
  ['@aws-sdk/client-lambda', { LambdaClient: noopClient, InvokeCommand: class {} }],
  ['@aws-sdk/client-bedrock-runtime', { BedrockRuntimeClient: throwingBedrock, InvokeModelCommand: class {} }],
]);
Module._load = function (request, parent, isMain) {
  if (extraStubs.has(request)) return extraStubs.get(request);
  return realLoad.call(this, request, parent, isMain);
};

// Not hypothetical and not the model: get-ai-summary builds this string in code.
const {
  buildFallbackSummary,
  generateAISummary,
  handler: getAiSummary,
} = require(path.join(REPO, 'lambda-functions/game/get-ai-summary.js'));
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

console.log('\n12. GET AI summary — the model prompt itself is redacted, not just the fallback template');

// Review round 2, IMPORTANT 3: section 11 only unit-tests buildFallbackSummary
// with hand-built arguments — nothing drove the real isHidden(metadata,
// roundRecord.Item) wiring added to exports.handler, nor the hidden-gated
// answers/results.voteTallies/results.winners redaction at the top of
// generateAISummary, nor whether the redacted values actually reach the
// assembled Bedrock prompt (and, via debug=true, get-ai-summary.js's own
// cache-hit/promptDebug branches — the leak this task exists to close). This
// section drives the REAL exports.handler end to end.
//
// A minimal usable prompt template, seeded once and re-seeded per call since
// seedAnonymousRound() clears the whole store. s3Key present + the stubbed S3
// client resolving to a bodyless {} makes fetchPromptFromS3 fall through to
// its OWN "use the DynamoDB record" final fallback (get-ai-summary.js, inside
// fetchPromptFromS3's catch block) — the simplest way to hand this a usable
// .template without a real S3 object.
const AI_PROMPT_TEMPLATE =
  'Q: {questionTitle}\n' +
  'RESPONSES: {responsesText}\n' +
  'WINNER: {winnerInfo}\n' +
  'TOP: {topVotedAnswers}\n' +
  'PLAYERS: {playerNames}\n' +
  'ROUND SCORES: {roundScores}\n' +
  'SCORE CHANGES: {scoreChanges}\n' +
  'PLAYER ANSWERS: {playerAnswers}\n' +
  '=== SUMMARY ===\nx\n=== DISCUSSION QUESTIONS ===\nQ1: x\n=== NEXT STEPS ===\nSTEP1: x';

async function runAiSummaryWorker(gameId, { revealed }) {
  seedAnonymousRound(gameId, { revealed });
  put({ PK: 'AIPROMPTS', SK: 'AIPROMPT#lessons-learned', s3Key: 'fake-key', template: AI_PROMPT_TEMPLATE });
  // seedAnonymousRound's default answer TEXT is "Ada's answer" / "Grace's
  // answer" — the player's name is literally embedded in the CONTENT, which
  // is legitimately never redacted (only authorship is). A blanket "does not
  // include 'Ada'" check on the assembled prompt would otherwise trip on that
  // correctly-preserved answer text, not on a real name leak. Overwrite the
  // content here (own put(), not a change to the shared helper) so the checks
  // below can only be about the playerName field.
  put({ PK: `GAME#${gameId}`, SK: 'QUESTION#001#ANSWER#Ada', PlayerName: 'Ada', Answer: 'loves the ocean', SubmittedAt: '2026-01-01T00:00:00.000Z' });
  put({ PK: `GAME#${gameId}`, SK: 'QUESTION#001#ANSWER#Grace', PlayerName: 'Grace', Answer: 'prefers the mountains', SubmittedAt: '2026-01-01T00:00:00.000Z' });
  // A vote from a THIRD person (not an answer author) gives voteTallies/winners
  // real, non-zero content to redact — the ocean answer (index 0, seeded
  // first) gets the first-place vote.
  put({ PK: `GAME#${gameId}`, SK: 'QUESTION#001#VOTE#Mallory', PlayerName: 'Mallory', Votes: { '0': 1 } });
  put({ PK: `GAME#${gameId}`, SK: 'CONNECTION#host-1', ConnectionId: 'host-1', ConnectionType: 'HOST' });
  // WHOLE-BRANCH REVIEW, IMPORTANT 8: seedAnonymousRound seeds no
  // PLAYER#…#SCORE records, which made every "no Ada anywhere" assertion in
  // this section VACUOUS for the cumulative-standings variables — leaderboard,
  // totalScores/cumulativeScores, topPerformers and playerRankings are all
  // built from these records, and with none seeded they were empty for reasons
  // that had nothing to do with anonymity. Seed them, and the assertions below
  // start doing the job they claimed to be doing.
  put({ PK: `GAME#${gameId}`, SK: 'PLAYER#Ada#SCORE', PlayerName: 'Ada', score: 12 });
  put({ PK: `GAME#${gameId}`, SK: 'PLAYER#Grace#SCORE', PlayerName: 'Grace', score: 5 });

  const res = await getAiSummary({ __workerMode: true, gameId, questionId: '001', debug: 'true' });
  const stored = store.get(key(`GAME#${gameId}`, 'QUESTION#001#AISummary'));
  return { res, stored };
}

const hidden12 = await runAiSummaryWorker('3011', { revealed: false });

await check('worker mode completes and returns ok', () =>
  assert.strictEqual(hidden12.res.ok, true, JSON.stringify(hidden12.res)));
await check('an AISummary record was persisted with DebugInfo attached', () =>
  assert.ok(hidden12.stored && hidden12.stored.DebugInfo, 'debug=true should have attached DebugInfo'));

const hiddenPrompt = hidden12.stored.DebugInfo.fullPrompt;
const hiddenVars = JSON.stringify(hidden12.stored.DebugInfo.templateVariables);

await check('hidden: no answer author name reaches the assembled prompt sent to the model', () =>
  assert.ok(!hiddenPrompt.includes('Ada') && !hiddenPrompt.includes('Grace'),
    `leaked into fullPrompt: ${hiddenPrompt}`));
await check('hidden: no answer author name reaches any template variable (incl. ones debug=true returns raw)', () =>
  assert.ok(!hiddenVars.includes('Ada') && !hiddenVars.includes('Grace'),
    `leaked into templateVariables: ${hiddenVars}`));
await check('hidden: the placeholder is what was actually substituted, not an empty/undefined field', () =>
  assert.ok(hiddenPrompt.includes('a participant'),
    `expected the redaction placeholder somewhere in the prompt: ${hiddenPrompt}`));
await check('hidden: the persisted fallback summary text also names nobody (end-to-end, not just in isolation)', () =>
  assert.ok(!hidden12.stored.SummaryText.includes('Ada'), hidden12.stored.SummaryText));

// IMPORTANT 4: discussionQuestions must not quote the answer verbatim while
// hidden either — same closure (buildFallback()), same markdownResponse.
await check('IMPORTANT 4 fix: hidden discussion questions do not quote the answer verbatim', () =>
  assert.ok(!hidden12.stored.DiscussionQuestions.some((q) => q.includes('"')),
    `still quoting the answer while hidden: ${JSON.stringify(hidden12.stored.DiscussionQuestions)}`));
await check('hidden discussion questions use the same unattributed phrasing as the fallback summary', () =>
  assert.ok(hidden12.stored.DiscussionQuestions.some((q) => /most-supported response/i.test(q)),
    JSON.stringify(hidden12.stored.DiscussionQuestions)));

// IMPORTANT 8: attribution by arithmetic. "Ada leads with 12 points" names the
// author of the round's top answer as surely as a label would, and it reached
// the model AND the debug echo through four separate template variables. Named
// individually rather than left to the blanket string checks above so a
// regression says WHICH variable started leaking again.
const hiddenTemplateVars = hidden12.stored.DebugInfo.templateVariables;
for (const varName of ['totalScores', 'cumulativeScores', 'topPerformers', 'playerRankings', 'leaderboard']) {
  await check(`IMPORTANT 8 fix: hidden — templateVars.${varName} carries no cumulative standings`, () =>
    assert.strictEqual(hiddenTemplateVars[varName], '',
      `expected empty while hidden, got: ${JSON.stringify(hiddenTemplateVars[varName])}`));
}
await check('IMPORTANT 8 fix: hidden — the aggregate average still survives, because it names nobody', () =>
  assert.ok(/^\d+ points$/.test(String(hiddenTemplateVars.averageScore)),
    `expected an aggregate average, got: ${JSON.stringify(hiddenTemplateVars.averageScore)}`));

// Revealed counterpart — proves the checks above are not vacuous (e.g. a
// broken template that never substitutes anything would also show "no Ada").
const revealed12 = await runAiSummaryWorker('3012', { revealed: true });
const revealedVars = JSON.stringify(revealed12.stored.DebugInfo.templateVariables);

await check('revealed: the answer author DOES appear in the template variables (proves the playerName checks above are not vacuous)', () =>
  assert.ok(revealedVars.includes('Ada'), revealedVars));
await check('revealed: discussion questions quote the answer verbatim again, as before this task', () =>
  assert.ok(revealed12.stored.DiscussionQuestions.some((q) => q.includes('"loves the ocean"')),
    JSON.stringify(revealed12.stored.DiscussionQuestions)));

// The counterpart that stops the five checks above from passing on a
// leaderboard that is simply broken.
const revealedTemplateVars = revealed12.stored.DebugInfo.templateVariables;
for (const varName of ['totalScores', 'cumulativeScores', 'topPerformers', 'playerRankings', 'leaderboard']) {
  await check(`revealed: templateVars.${varName} DOES carry the standings (proves the hidden checks are not vacuous)`, () =>
    assert.ok(String(revealedTemplateVars[varName]).includes('Ada'),
      `expected the standings once revealed, got: ${JSON.stringify(revealedTemplateVars[varName])}`));
}

console.log('\n13. Wavelength: both the stored-results cache path and the live-calculation path redact without dropping participants');

// CRITICAL 1 + IMPORTANT 2: generateAISummary is called directly here
// (exported above), not through exports.handler.
//
// When these checks were written that was forced: exports.handler's OWN
// wavelength vote-tally pass referenced a bare `commonWords` declared nowhere
// in its scope, so the real handler threw a ReferenceError before ever
// reaching generateAISummary. That crash has since been fixed, and
// tests/session-report-honesty.js section 2 covers the wavelength path
// through exports.handler.
//
// These checks stay on the direct call deliberately: they are about the
// REDACTION inside generateAISummary, and calling it directly is what lets
// them feed a stored-results fixture and a live-calculation fixture to the
// same function and compare, without a full seeded game for each.
put({
  PK: 'AIPROMPTS', SK: 'AIPROMPT#lessons-learned', s3Key: 'fake-key',
  template: 'WORDS: {wavelengthWords}\n=== SUMMARY ===\nx\n=== DISCUSSION QUESTIONS ===\nQ1: x\n=== NEXT STEPS ===\nSTEP1: x',
});

const wavelengthAnswers = [
  { playerName: 'Ada', answer: 'ocean,blue' },
  { playerName: 'Grace', answer: 'ocean,tide' },
];
const wavelengthBaseArgs = {
  eventTitle: 'Wavelength Test', gameType: 'wavelength', gameAiContext: '', questionSetAiContext: '',
  customInstruction: '', promptId: 'lessons-learned', promptProvenance: { hierarchy: [] }, debugMode: true,
  questionId: '001', question: { title: 'Pick a word' },
  results: { voteTallies: {}, winners: [], totalVotes: 0 },
  votes: [], gameId: 'wave-1', questionSetId: null, paddedQuestionNumber: '001',
  scoringConfig: { firstPlacePoints: 3, secondPlacePoints: 2, thirdPlacePoints: 1 },
  hostPersonaId: null, setPersonaId: null,
};

// 13a. Stored-results cache path (CRITICAL 1's exact location).
const storedResultsFixture = {
  wordAnalysis: { commonWords: [{ word: 'ocean', count: 2 }], wordCounts: { ocean: 2 }, totalUniqueWords: 3, connectionScore: 67 },
  playerAnswers: wavelengthAnswers,
};

const storedHidden = await generateAISummary({
  ...wavelengthBaseArgs, hidden: true, answers: wavelengthAnswers, storedResults: storedResultsFixture,
});
const storedHiddenWords = storedHidden.debugInfo.templateVariables.wavelengthWords;

await check('CRITICAL 1 fix: hidden — storedResults.playerAnswers no longer leaks names into wavelengthWords', () =>
  assert.ok(!storedHiddenWords.includes('Ada') && !storedHiddenWords.includes('Grace'),
    `leaked via the stored-results cache path: ${storedHiddenWords}`));
await check('IMPORTANT 2 fix: hidden — both participants survive the stored-results path, not just the last', () =>
  assert.strictEqual((storedHiddenWords.match(/a participant/g) || []).length, 2,
    `expected one redacted entry per participant, got: ${storedHiddenWords}`));

const storedRevealed = await generateAISummary({
  ...wavelengthBaseArgs, hidden: false, answers: wavelengthAnswers, storedResults: storedResultsFixture,
});
const storedRevealedWords = storedRevealed.debugInfo.templateVariables.wavelengthWords;
await check('revealed — both real names appear (proves the two hidden checks above are not vacuous)', () =>
  assert.ok(storedRevealedWords.includes('Ada') && storedRevealedWords.includes('Grace'), storedRevealedWords));

// 13b. Live-calculation path — no stored-results cache hit (IMPORTANT 2's
// other half: `answers` was already redacted at the top of generateAISummary,
// so no name leaks even without this fix, but the naive object-keyed-by-name
// collision still dropped every participant but the last).
const liveHidden = await generateAISummary({
  ...wavelengthBaseArgs, hidden: true, answers: wavelengthAnswers, storedResults: null,
});
const liveHiddenWords = liveHidden.debugInfo.templateVariables.wavelengthWords;

await check('hidden — the live-calculation path (no stored results) does not leak names', () =>
  assert.ok(!liveHiddenWords.includes('Ada') && !liveHiddenWords.includes('Grace'), liveHiddenWords));
await check('IMPORTANT 2 fix: hidden — both participants survive the live-calculation path too', () =>
  assert.strictEqual((liveHiddenWords.match(/a participant/g) || []).length, 2,
    `expected one redacted entry per participant, got: ${liveHiddenWords}`));

console.log('\n14. voting closing reveals the round');

const { handler: getResults } = require(path.join(REPO, 'lambda-functions/game/get-results.js'));
const { isHidden } = require(path.join(REPO, 'lambda-functions/game/anonymity.js'));

/** An authenticated host closing a round: POST /games/{gameId}/close-round. */
const closeRound = (gameId, questionNumber) => ({
  requestContext: { routeKey: 'POST /games/{gameId}/close-round' },
  pathParameters: { gameId },
  body: JSON.stringify({ questionNumber }),
});

seedAnonymousRound('3011');
put({ PK: 'GAME#3011', SK: 'STATE', State: 'VOTE#001', LessonNumber: 1, CurrentQuestionId: '001' });
put({ PK: 'GAME#3011', SK: 'QUESTION#001#VOTE#Grace', PlayerName: 'Grace', Votes: { 0: 1 } });
put({ PK: 'GAME#3011', SK: 'CONNECTION#host-1', ConnectionId: 'host-1', ConnectionType: 'HOST' });
sent = [];

// The HOST route. Closing a round — and so discharging the anonymity promise —
// is host-only: the public POST /games/get-results may only read a round that
// is already resolved (get-results.js: isHostTransitionRoute). The refusal
// itself is pinned in tests/results-route-auth.js.
await getResults(closeRound('3011', 1));

// The promise is "until voting closes", not "until the host presses a button".
// Closing the vote is what discharges it.
await check('entering RESULTS sets AuthorsRevealed on the round', () =>
  assert.strictEqual(store.get(key('GAME#3011', 'ROUND#001')).AuthorsRevealed, true));
await check('the round is no longer hidden once results are in', () =>
  assert.strictEqual(
    isHidden(store.get(key('GAME#3011', 'METADATA')), store.get(key('GAME#3011', 'ROUND#001'))),
    false));

// And the ordinary answers endpoint carries names again, with no host action.
//
// role='host' here, deliberately, not 'player': section 1 above pins the
// pre-existing, anonymity-unrelated invariant that the player branch only
// ever returns a full `answers` array during VOTE# ("VOTE is the one phase
// where BOTH roles actually receive an answers array"); everywhere else,
// including RESULTS#, players get a count-only response regardless of
// attribution. That gate predates this feature and is out of this task's
// scope. role is client-supplied and carries no privilege distinction
// (get-answers.js:11), so role='host' still proves what this check is
// for — the endpoint carries names again with no POST /reveal-authors call.
const afterVoteClose = JSON.parse((await askAnswers('3011', 'host')).body);
await check('GET /answers carries attribution once voting has closed', () =>
  assert.strictEqual(afterVoteClose.answers[0].playerName, 'Ada'));

console.log('\n15. the round record is written even on the exits that used to skip it');

// enterResultsState's own comment records that the state write used to be
// missing from the wavelength and zero-vote exits. The reveal must not inherit
// that hole: a round with no votes still closes.
seedAnonymousRound('3013');
put({ PK: 'GAME#3013', SK: 'STATE', State: 'VOTE#001', LessonNumber: 1, CurrentQuestionId: '001' });
put({ PK: 'GAME#3013', SK: 'CONNECTION#host-1', ConnectionId: 'host-1', ConnectionType: 'HOST' });
sent = [];

await getResults(closeRound('3013', 1));

await check('a round that closed with zero votes is still revealed', () =>
  assert.strictEqual(store.get(key('GAME#3013', 'ROUND#001'))?.AuthorsRevealed, true));

console.log('\n16. GET /games/{id}/state reports the reveal back to the host');

// This is the read that makes an EARLY reveal survive a resync — without it a
// host who revealed during VOTE gets silently reverted by the next
// gameStateChanged/reconnect. It was reachable from this harness all along and
// simply never driven.
// revealAuthors is already required by section 8 above.
const { handler: getGameState } = require(path.join(REPO, 'lambda-functions/game/get-game-state.js'));

const askState = (gameId) => getGameState({ pathParameters: { gameId }, queryStringParameters: { role: 'host' } });

seedAnonymousRound('3014', { state: 'VOTE#001' });
const stateBeforeReveal = JSON.parse((await askState("3014")).body);
await check('an unrevealed round reports authorsRevealed false', () =>
  assert.strictEqual(stateBeforeReveal.authorsRevealed, false));

await revealAuthors({ pathParameters: { gameId: '3014' }, body: JSON.stringify({ questionNumber: 1 }) });
const stateAfterReveal = JSON.parse((await askState("3014")).body);
await check('after an early reveal the state read carries it, so a resync cannot revert it', () =>
  assert.strictEqual(stateAfterReveal.authorsRevealed, true));

console.log('\n17. POST /reveal-authors rejects a question number that is not a round number');

// The value becomes part of the SK. '' used to pass the presence check and pad
// to ROUND#000; anything else wrote ROUND#<junk> into the game partition that
// nothing would ever read. Combined with the route having been public, that was
// an unauthenticated write primitive.
for (const bad of ['', '  ', 'abc', '1; DROP', '../../x', null, undefined, {}, -1, 1.5]) {
  seedAnonymousRound('3015');
  const res = await revealAuthors({
    pathParameters: { gameId: '3015' },
    body: JSON.stringify({ questionNumber: bad })
  });
  await check(`rejects questionNumber ${JSON.stringify(bad)} with 400`, () =>
    assert.strictEqual(res.statusCode, 400, `got ${res.statusCode}: ${res.body}`));
  await check(`writes no ROUND# record for questionNumber ${JSON.stringify(bad)}`, () =>
    assert.strictEqual(
      [...store.keys()].filter((k) => k.startsWith('GAME#3015|ROUND#')).length, 1,
      'only the seeded ROUND#001 should exist'));
}

// The counterpart: a legitimate number still works, in both spellings.
for (const good of [1, '1', '001']) {
  seedAnonymousRound('3016');
  const res = await revealAuthors({
    pathParameters: { gameId: '3016' },
    body: JSON.stringify({ questionNumber: good })
  });
  await check(`accepts questionNumber ${JSON.stringify(good)} and reveals ROUND#001`, () =>
    assert.ok(res.statusCode === 200 && store.get(key('GAME#3016', 'ROUND#001')).AuthorsRevealed === true,
      `${res.statusCode}: ${res.body}`));
}

console.log('\n18. POST /games/{id}/report does not attribute an unrevealed round');

// The route is PUBLIC (template-clean.yaml), and the rounds it reports on are
// not all finished — questionNumbers is built from votes ∪ results ∪ AI
// summaries, so a round still in VOTE joins the list the moment the first
// ballot lands. Anyone holding the four-digit game id could therefore ask the
// report for the names the ballot in the room is withholding.
const { handler: createReport } = require(path.join(REPO, 'lambda-functions/game/create-report.js'));

const askReport = async (gameId) => {
  const res = await createReport({ pathParameters: { gameId } });
  return { res, body: JSON.parse(res.body) };
};

/**
 * A game mid-vote on round 1: answers in, one ballot cast, nothing revealed.
 *
 * Overwrites the answer TEXT for the same reason section 12 does — the shared
 * helper's default content is literally "Ada's answer", so a blanket "the
 * report contains no 'Ada'" check would trip on correctly-preserved answer
 * text rather than on a real attribution leak. Only authorship is redacted;
 * what a participant wrote is never touched.
 */
function seedReportableRound(gameId, { revealed }) {
  seedAnonymousRound(gameId, { revealed, state: 'VOTE#001' });
  put({ PK: `GAME#${gameId}`, SK: 'QUESTION#001#ANSWER#Ada', PlayerName: 'Ada', Answer: 'loves the ocean', SubmittedAt: '2026-01-01T00:00:00.000Z' });
  put({ PK: `GAME#${gameId}`, SK: 'QUESTION#001#ANSWER#Grace', PlayerName: 'Grace', Answer: 'prefers the mountains', SubmittedAt: '2026-01-01T00:00:00.000Z' });
  put({ PK: `GAME#${gameId}`, SK: 'QUESTION#001#VOTE#Mallory', PlayerName: 'Mallory', Votes: { '0': 1 } });
}

seedReportableRound('3017', { revealed: false });
const hiddenReport = await askReport('3017');

await check('the report is still produced for an unrevealed round', () =>
  assert.strictEqual(hiddenReport.res.statusCode, 200, hiddenReport.res.body));
await check('the unrevealed round is still IN the report — redaction, not omission', () =>
  assert.strictEqual(hiddenReport.body.report.detailedQuestions.length, 1,
    JSON.stringify(hiddenReport.body.report.detailedQuestions)));
await check('no author name reaches the report while the round is unrevealed', () => {
  const serialized = JSON.stringify(hiddenReport.body.report.detailedQuestions);
  assert.ok(!serialized.includes('Ada') && !serialized.includes('Grace'), serialized);
});
await check('authorship is OMITTED, not nulled — no playerName key at all', () => {
  const rows = hiddenReport.body.report.detailedQuestions[0].answers;
  assert.ok(rows.every((r) => !('playerName' in r)), JSON.stringify(rows));
});
await check('the ballot is neither reordered nor filtered — both rows survive, in index order', () => {
  const rows = hiddenReport.body.report.detailedQuestions[0].answers;
  assert.deepStrictEqual(rows.map((r) => r.answerIndex).sort(), [0, 1], JSON.stringify(rows));
});
await check('the answer TEXT is untouched — only authorship is withheld', () => {
  const serialized = JSON.stringify(hiddenReport.body.report.detailedQuestions[0].answers);
  assert.ok(serialized.includes('loves the ocean') && serialized.includes('prefers the mountains'), serialized);
});
await check('winners is empty rather than a list of blanks', () =>
  assert.deepStrictEqual(hiddenReport.body.report.questionSummaries[0].winners, [],
    JSON.stringify(hiddenReport.body.report.questionSummaries[0])));
await check('the legacy voteTallies block omits playerName too', () => {
  const tallies = Object.values(hiddenReport.body.report.questionSummaries[0].voteTallies);
  assert.ok(tallies.every((t) => !('playerName' in t)), JSON.stringify(tallies));
});

// The counterpart. In practice this is EVERY finished round, because entering
// RESULTS reveals on its own — so this is also the check that stops the gate
// above from quietly emptying the ordinary report.
seedReportableRound('3018', { revealed: true });
const revealedReport = await askReport('3018');

await check('a revealed round is attributed exactly as before this task', () => {
  const rows = revealedReport.body.report.detailedQuestions[0].answers;
  assert.ok(rows.some((r) => r.playerName === 'Ada'), JSON.stringify(rows));
});
await check('a revealed round names its winner', () =>
  assert.deepStrictEqual(revealedReport.body.report.questionSummaries[0].winners, ['Ada'],
    JSON.stringify(revealedReport.body.report.questionSummaries[0])));

// And a game that never had anonymity at all is untouched by any of this.
seedAnonymousRound('3019', { anonymous: false, state: 'VOTE#001' });
put({ PK: 'GAME#3019', SK: 'QUESTION#001#VOTE#Mallory', PlayerName: 'Mallory', Votes: { '0': 1 } });
const optedOutReport = await askReport('3019');
await check('a game with anonymity switched off is attributed even mid-vote', () => {
  const rows = optedOutReport.body.report.detailedQuestions[0].answers;
  assert.ok(rows.some((r) => r.playerName === 'Ada'), JSON.stringify(rows));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

})();
