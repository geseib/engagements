/**
 * Integration test: does the PLAYER payload carry what the player screen needs?
 *
 * Two defects live here, and both are payload-shape defects rather than UI ones:
 *
 *   D1  PlayerPage's round badge read `currentQuestion.id`, which get-question
 *       never emitted — so the badge rendered "Lesson " with no number during
 *       ASK and RESULTS. Only the VOTE phase, served by get-game-state, had an
 *       `id`.
 *   D2  PlayerPage guards its per-set instruction fetch on `questionData.setId`.
 *       get-question exposed the set id as `questionSetId`, and only on the HOST
 *       branch, so the guard could never fire and a player never saw a per-set
 *       instruction the host was showing.
 *
 * Runs the REAL get-question and get-game-state handlers against a stubbed
 * DynamoDB, in the style of tests/art-title-flow.js.
 */
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const store = new Map();               // "PK|SK" -> item
const key = (pk, sk) => `${pk}|${sk}`;

// ---- Stub @aws-sdk/lib-dynamodb + client-dynamodb before handlers load ----
class PutCommand { constructor(i) { this.input = i; this.type = 'put'; } }
class GetCommand { constructor(i) { this.input = i; this.type = 'get'; } }
class QueryCommand { constructor(i) { this.input = i; this.type = 'query'; } }
class DeleteCommand { constructor(i) { this.input = i; this.type = 'delete'; } }
class UpdateCommand { constructor(i) { this.input = i; this.type = 'update'; } }
class BatchWriteCommand { constructor(i) { this.input = i; this.type = 'batchWrite'; } }

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
        return {};
      case 'batchWrite': {
        for (const [, requests] of Object.entries(inp.RequestItems || {})) {
          for (const r of requests) {
            if (r.PutRequest) store.set(key(r.PutRequest.Item.PK, r.PutRequest.Item.SK), r.PutRequest.Item);
            if (r.DeleteRequest) store.delete(key(r.DeleteRequest.Key.PK, r.DeleteRequest.Key.SK));
          }
        }
        return { UnprocessedItems: {} };
      }
      case 'query': {
        const pk = inp.ExpressionAttributeValues[':pk'] ?? inp.ExpressionAttributeValues[':PK'];
        const prefixVal = inp.ExpressionAttributeValues[':sk'] ?? inp.ExpressionAttributeValues[':prefix'] ?? '';
        const items = [...store.values()].filter(
          (i) => i.PK === pk && String(i.SK).startsWith(String(prefixVal))
        );
        return { Items: items, Count: items.length };
      }
      default:
        return {};
    }
  },
};

// Each lambda-functions/<group>/ may carry its own node_modules, and Node
// resolves from the requiring file's directory upward — so stub every copy or
// the real SDK loads and the test dies on credentials instead of assertions.
const STUB_PATHS = [
  REPO,
  path.join(REPO, 'lambda-functions'),
  path.join(REPO, 'lambda-functions', 'admin'),
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
  if (!seen.size) throw new Error(`stub(): could not resolve ${name} from any of ${STUB_PATHS.join(', ')}`);
}
stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => fakeDoc },
  PutCommand, GetCommand, QueryCommand, DeleteCommand, UpdateCommand, BatchWriteCommand,
});

process.env.TABLE_NAME = 'test-table';
process.env.GAME_TABLE = 'test-table';

let pass = 0, fail = 0;
function check(label, fn) {
  try { fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

// The player screen's badge logic, mirrored from PlayerPage.roundNumberOf().
function roundNumberOf(question, gameState) {
  for (const candidate of [question?.lessonNumber, question?.questionNumber, question?.id]) {
    const n = parseInt(candidate, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const fromState = parseInt(String(gameState || '').split('#')[1], 10);
  return Number.isFinite(fromState) && fromState > 0 ? fromState : null;
}

const SET_ID = 'famousarttitles';
const TRIVIA_SET_ID = 'triviaset';
const GAME_ID = '1234';
const SET_INSTRUCTION = 'Name this work of art. Accurate, witty, or make the room think?';
const OTHER_SET_NAME = 'OTHER_SET_SENTINEL — Team Retro';

// A trivia round, used for the correct-answer gating checks. Note the
// LOWER-CASE `answerDetails`: admin/ai-generate-trivia.js emits that spelling
// while admin/upload-questions.js writes `AnswerDetails`, so both live in the
// table. get-question must project neither.
function seedTrivia(state) {
  store.clear();
  store.set(key(`SET#${TRIVIA_SET_ID}`, 'QUESTION#001'), {
    PK: `SET#${TRIVIA_SET_ID}`, SK: 'QUESTION#001',
    Title: 'A CITY ON THE SEINE',
    Category: 'Geography',
    questionDetail: 'Which city is the capital of France?',
    optionA: 'Paris', optionB: 'Lyon', optionC: 'Marseille', optionD: 'Nice',
    correctAnswer: 'OptionA',
    answerDetails: 'SPOILER_SENTINEL — Paris has been the capital since 987.',
  });
  store.set(key(`GAME#${GAME_ID}`, 'METADATA'), {
    PK: `GAME#${GAME_ID}`, SK: 'METADATA', GameId: GAME_ID,
    Title: 'Trivia Night', GameType: 'trivia', QuestionSetId: TRIVIA_SET_ID,
  });
  store.set(key(`GAME#${GAME_ID}`, 'STATE'), {
    PK: `GAME#${GAME_ID}`, SK: 'STATE', State: state,
    LessonNumber: 1, CurrentQuestionId: 'QUESTION#001',
  });
  store.set(key(`GAME#${GAME_ID}`, 'QUESTION#001#REF'), {
    PK: `GAME#${GAME_ID}`, SK: 'QUESTION#001#REF',
    SourceQuestionId: 'QUESTION#001', SetId: TRIVIA_SET_ID,
    StartedAt: new Date(0).toISOString(),
  });
}

function seed(state) {
  store.clear();
  store.set(key(`SET#${SET_ID}`, 'QUESTION#001'), {
    PK: `SET#${SET_ID}`, SK: 'QUESTION#001',
    Title: 'THE COMPANY STEPS OUT',
    Category: 'Baroque',
    School: 'Rembrandt van Rijn',
    Image: 'https://example.test/night-watch.jpg',
    Detail: '',
    CustomInstructions: '',
  });
  store.set(key(`GAME#${GAME_ID}`, 'METADATA'), {
    PK: `GAME#${GAME_ID}`, SK: 'METADATA', GameId: GAME_ID,
    Title: 'Art Night', GameType: 'call-and-answer', QuestionSetId: SET_ID,
  });
  store.set(key(`GAME#${GAME_ID}`, 'STATE'), {
    PK: `GAME#${GAME_ID}`, SK: 'STATE', State: state,
    LessonNumber: 1, CurrentQuestionId: 'QUESTION#001',
  });
  store.set(key(`GAME#${GAME_ID}`, 'QUESTION#001#REF'), {
    PK: `GAME#${GAME_ID}`, SK: 'QUESTION#001#REF',
    SourceQuestionId: 'QUESTION#001', SetId: SET_ID,
    StartedAt: new Date(0).toISOString(),
  });
  // The SET metadata row. resolveSetPartition() already reads this to decide
  // which partition to serve, and hands it back as `resolved.metadata` — so the
  // two set-level fields below cost the payload no extra round trip.
  store.set(key('SETS', `SET#${SET_ID}`), {
    PK: 'SETS', SK: `SET#${SET_ID}`,
    name: 'Famous Art Titles',
    description: 'Name the painting.',
    customInstruction: SET_INSTRUCTION,
    roundNoun: 'Artwork',
    engagementType: 'call-and-answer',
    active: true,
  });
  // A SECOND set, which this game is not playing. Nothing a participant
  // receives may mention it. See section 7.
  store.set(key('SETS', 'SET#otherteamretro'), {
    PK: 'SETS', SK: 'SET#otherteamretro',
    name: OTHER_SET_NAME,
    description: 'Another org would own this one.',
    customInstruction: 'Do not leak me.',
    roundNoun: 'Round',
    engagementType: 'call-and-answer',
    active: true,
  });
}

(async () => {
  const questionHandler = require(path.join(REPO, 'lambda-functions/game/get-question.js')).handler;
  const stateHandler = require(path.join(REPO, 'lambda-functions/game/get-game-state.js')).handler;

  // ---------- 1. ASK: the phase where the badge used to be blank ----------
  console.log('\n1. get-question (role=player) during ASK');
  seed('ASK#001');
  const askRes = await questionHandler({
    pathParameters: { gameId: GAME_ID }, queryStringParameters: { role: 'player' },
  });
  check('returns 200', () =>
    assert.strictEqual(askRes.statusCode, 200, `got ${askRes.statusCode}: ${askRes.body}`));

  const ask = JSON.parse(askRes.body);
  check('D1: payload carries a round number the badge can render', () =>
    assert.strictEqual(roundNumberOf(ask, 'ASK#001'), 1,
      `badge would render ${JSON.stringify(roundNumberOf(ask, 'ASK#001'))} from ${JSON.stringify(ask.id)}/${JSON.stringify(ask.lessonNumber)}`));
  check('D1: `id` is present (it was absent, so the badge read undefined)', () =>
    assert.ok(ask.id, `id was ${JSON.stringify(ask.id)}`));
  check('D2: payload carries `setId`, the key PlayerPage guards on', () =>
    assert.strictEqual(ask.setId, SET_ID, `setId was ${JSON.stringify(ask.setId)}`));
  check('artwork still reaches the player (round noun resolves to Artwork)', () =>
    assert.ok(ask.image && ask.image.startsWith('http'), `image was ${JSON.stringify(ask.image)}`));

  // ---------- 2. RESULTS: the other blank-badge phase ----------
  //
  // D3  The guard was ASK-only, so every RESULTS-state caller got a 400. The one
  //     that mattered is PlayerPage.loadResultsData, which swallows the failure
  //     (`if (questionRes.ok)`) and rebuilds the question from get-results
  //     instead. That reconstruction carries only title/detail/correctAnswer/
  //     optionA-F — it drops image, school, category, customInstructions and
  //     setId, so an art round lost its artwork at RESULTS. It also stranded the
  //     handler's own `RESULTS#` correct-answer block, which could never run.
  console.log('\n2. get-question (role=player) during RESULTS');
  seed('RESULTS#001');
  const resultsRes = await questionHandler({
    pathParameters: { gameId: GAME_ID }, queryStringParameters: { role: 'player' },
  });
  check('D3: RESULTS is served, not 400d', () =>
    assert.strictEqual(resultsRes.statusCode, 200, `got ${resultsRes.statusCode}: ${resultsRes.body}`));
  const results = JSON.parse(resultsRes.body);
  check('D3: badge renders a round number at RESULTS', () =>
    assert.strictEqual(roundNumberOf(results, 'RESULTS#001'), 1));
  check('D3: the artwork survives to RESULTS (get-results cannot supply it)', () =>
    assert.strictEqual(results.image, 'https://example.test/night-watch.jpg'));
  check('D3: so do the other fields the get-results fallback drops', () => {
    assert.strictEqual(results.school, 'Rembrandt van Rijn');
    assert.strictEqual(results.category, 'Baroque');
    assert.strictEqual(results.setId, SET_ID);
  });

  // ---------- 3. VOTE ----------
  console.log('\n3. get-question (role=player) during VOTE');
  seed('VOTE#001');
  const voteRes = await questionHandler({
    pathParameters: { gameId: GAME_ID }, queryStringParameters: { role: 'player' },
  });
  check('D3: VOTE is served too', () =>
    assert.strictEqual(voteRes.statusCode, 200, `got ${voteRes.statusCode}: ${voteRes.body}`));
  check('D3: badge renders a round number at VOTE', () =>
    assert.strictEqual(roundNumberOf(JSON.parse(voteRes.body), 'VOTE#001'), 1));

  console.log('\n3b. get-game-state during VOTE (the path that already had an id)');
  seed('VOTE#001');
  const stateRes = await stateHandler({ pathParameters: { gameId: GAME_ID } });
  check('returns 200', () =>
    assert.strictEqual(stateRes.statusCode, 200, `got ${stateRes.statusCode}: ${stateRes.body}`));
  const cq = JSON.parse(stateRes.body).currentQuestionData || {};
  check('badge renders a number here too', () =>
    assert.strictEqual(roundNumberOf(cq, 'VOTE#001'), 1));
  check('and this path spells the set id `setId` — the same key get-question now uses', () =>
    assert.strictEqual(cq.setId, SET_ID));

  // ---------- 4. Host branch keeps its existing field ----------
  console.log('\n4. get-question (role=host) is unchanged');
  seed('ASK#001');
  const hostRes = await questionHandler({
    pathParameters: { gameId: GAME_ID }, queryStringParameters: { role: 'host' },
  });
  const host = JSON.parse(hostRes.body);
  check('host still gets questionSetId', () =>
    assert.strictEqual(host.questionSetId, SET_ID));
  check('host also gets setId now (the total-questions lookup reads it)', () =>
    assert.strictEqual(host.setId, SET_ID));
  check('host keeps its extra fields', () =>
    assert.ok('points' in host && 'sourceQuestionId' in host));

  // ---------- 5. Widening the guard must not widen the spoilers ----------
  // Serving VOTE and RESULTS means the correct answer and the answer
  // explanation now pass through states they never used to. correctAnswer is
  // gated on RESULTS# by design; answerDetails is gated on nothing, because it
  // is not projected at all.
  console.log('\n5. correctAnswer is gated on RESULTS, answerDetails is never sent');
  for (const state of ['ASK#001', 'VOTE#001']) {
    for (const role of ['player', 'host']) {
      seedTrivia(state);
      const res = await questionHandler({
        pathParameters: { gameId: GAME_ID }, queryStringParameters: { role },
      });
      check(`${role} @ ${state}: 200, and no correctAnswer`, () => {
        assert.strictEqual(res.statusCode, 200, `got ${res.statusCode}: ${res.body}`);
        assert.strictEqual(JSON.parse(res.body).correctAnswer, undefined);
      });
    }
  }

  for (const role of ['player', 'host']) {
    seedTrivia('RESULTS#001');
    const res = await questionHandler({
      pathParameters: { gameId: GAME_ID }, queryStringParameters: { role },
    });
    check(`${role} @ RESULTS: correctAnswer resolved to option TEXT, not "OptionA"`, () => {
      assert.strictEqual(res.statusCode, 200, `got ${res.statusCode}: ${res.body}`);
      assert.strictEqual(JSON.parse(res.body).correctAnswer, 'Paris');
    });
  }

  /*
    ── 5b. AND THE SIBLING HANDLER MUST AGREE ───────────────────────────────

    `get-question` gates the correct answer on RESULTS# and is tested for it
    above. `get-game-state` served the SAME question through
    `currentQuestionData` and gated nothing — so the spoiler this file exists to
    keep out of one payload walked straight out of the other.

    It is not a host leak, it is a PUBLIC one. `/games/{gameId}/state` carries no
    authorizer in template-clean.yaml (unlike `/games/{gameId}/queue`, which
    does), and `currentQuestionData` is in the BASE response — gated by neither
    `playerId` nor `includeHostData`. So anyone holding the four digits that are
    projected on the wall could read the answer during ASK, from a phone, while
    the room was still answering.

    RESULTS is the line because that is where the answer is revealed on the
    projector anyway — the same line get-question already draws, and copying it
    keeps one rule rather than two.
  */
  console.log('\n5b. get-game-state gates the correct answer on the same line');
  for (const state of ['ASK#001', 'VOTE#001']) {
    seedTrivia(state);
    const res = await stateHandler({ pathParameters: { gameId: GAME_ID } });
    // rejects: THE REPORTED LEAK. A public route handing out the answer while
    // the room is still answering.
    check(`@ ${state}: the public state payload carries no correct answer`, () => {
      assert.strictEqual(res.statusCode, 200, `got ${res.statusCode}: ${res.body}`);
      const body = JSON.parse(res.body);
      assert.strictEqual(body.currentQuestionData?.correctAnswer, undefined,
        `correctAnswer leaked at ${state}`);
      assert.ok(!/OptionA/.test(res.body), 'the answer leaked somewhere else in the payload');
    });
  }

  // rejects: over-correcting into a withhold that never lifts. The results
  // screen needs it, and by then it is on the projector.
  seedTrivia('RESULTS#001');
  {
    const res = await stateHandler({ pathParameters: { gameId: GAME_ID } });
    check('@ RESULTS: the correct answer is served again', () => {
      assert.strictEqual(res.statusCode, 200, `got ${res.statusCode}: ${res.body}`);
      assert.strictEqual(JSON.parse(res.body).currentQuestionData.correctAnswer, 'OptionA');
    });
  }

  // rejects: gating on `includeHostData` instead of on the round's state, which
  // moves the leak behind a query parameter anyone can type rather than closing
  // it. The route has no authorizer, so that flag proves nothing.
  for (const state of ['ASK#001', 'VOTE#001']) {
    seedTrivia(state);
    const res = await stateHandler({
      pathParameters: { gameId: GAME_ID },
      queryStringParameters: { includeHostData: 'true' },
    });
    check(`@ ${state}: asking for host data does not unlock it either`, () => {
      assert.strictEqual(JSON.parse(res.body).currentQuestionData?.correctAnswer, undefined);
    });
  }

  // The spoiler check, in every state the widened guard now serves.
  for (const state of ['ASK#001', 'VOTE#001', 'RESULTS#001']) {
    for (const role of ['player', 'host']) {
      seedTrivia(state);
      const res = await questionHandler({
        pathParameters: { gameId: GAME_ID }, queryStringParameters: { role },
      });
      check(`${role} @ ${state}: answerDetails withheld, lower-case spelling and all`, () => {
        assert.ok(!/SPOILER_SENTINEL/.test(res.body), 'the answer explanation leaked');
        assert.ok(!/answerdetails/i.test(res.body), res.body.slice(0, 200));
      });
    }
  }

  // ---------- 6. Non-question states are still refused ----------
  // Widening is to the ASK#/VOTE#/RESULTS# triple that get-game-state.js and
  // next-question.js already treat as "a round is in progress" — not to
  // everything. There is no current question in a lobby or a finished game.
  console.log('\n6. states with no round in progress are still 400d');
  for (const state of ['STARTED', 'CREATED', 'ENDED']) {
    seed(state);
    const res = await questionHandler({
      pathParameters: { gameId: GAME_ID }, queryStringParameters: { role: 'player' },
    });
    check(`${state}: 400 'No active question'`, () => {
      assert.strictEqual(res.statusCode, 400, `got ${res.statusCode}: ${res.body}`);
      assert.strictEqual(JSON.parse(res.body).error, 'No active question');
    });
  }

  // ---------- 7. The set-level fields ride on the question ----------
  //
  // rejects: dropping `setCustomInstruction` / `setRoundNoun` from
  // get-question's player payload.
  //
  // WHY THEY HAVE TO BE HERE. PlayerPage used to obtain these two values by
  // fetching the WHOLE of `GET /question-sets` — every set in the environment,
  // with its name, description, categories, counts and persona id — and then
  // `.find()`ing the one set its own game was playing. Every anonymous
  // participant in every session was handed the entire catalogue, with no
  // login, to read two strings. That is the single widest tenant leak in the
  // product, and closing `GET /question-sets` to authenticated callers is
  // impossible while a player still needs it.
  //
  // These fields cost nothing: resolveSetPartition() already reads the SETS row
  // to decide which partition to serve, and returns it as `resolved.metadata`.
  console.log('\n7. set-level instruction and round noun ride on the question payload');
  for (const state of ['ASK#001', 'VOTE#001', 'RESULTS#001']) {
    for (const role of ['player', 'host']) {
      seed(state);
      const res = await questionHandler({
        pathParameters: { gameId: GAME_ID }, queryStringParameters: { role },
      });
      const body = JSON.parse(res.body);
      check(`${role} @ ${state}: carries setCustomInstruction`, () =>
        assert.strictEqual(body.setCustomInstruction, SET_INSTRUCTION,
          `got ${JSON.stringify(body.setCustomInstruction)}`));
      check(`${role} @ ${state}: carries setRoundNoun`, () =>
        assert.strictEqual(body.setRoundNoun, 'Artwork',
          `got ${JSON.stringify(body.setRoundNoun)}`));
    }
  }

  // A set with neither field must yield null, not undefined and not the
  // question's own CustomInstructions — PlayerPage stores these straight into
  // state and `resolveInstruction` distinguishes "no set instruction" from
  // "empty string".
  console.log('\n   a set carrying neither field yields null, not undefined');
  seed('ASK#001');
  store.set(key('SETS', `SET#${SET_ID}`), {
    PK: 'SETS', SK: `SET#${SET_ID}`, name: 'Bare', active: true,
  });
  {
    const res = await questionHandler({
      pathParameters: { gameId: GAME_ID }, queryStringParameters: { role: 'player' },
    });
    const body = JSON.parse(res.body);
    check('setCustomInstruction is null', () =>
      assert.strictEqual(body.setCustomInstruction, null,
        `got ${JSON.stringify(body.setCustomInstruction)}`));
    check('setRoundNoun is null', () =>
      assert.strictEqual(body.setRoundNoun, null,
        `got ${JSON.stringify(body.setRoundNoun)}`));
  }

  // ---------- 8. Nothing about any OTHER set reaches a participant ----------
  //
  // rejects: any future widening of this payload that projects the set list, a
  // set index, or a neighbouring set's metadata.
  //
  // This is the assertion the catalogue download would have failed. It is
  // deliberately a substring search over the whole serialized body rather than
  // a field check, because the leak it guards against is by definition a field
  // nobody thought to look at.
  console.log('\n8. no other set is mentioned anywhere in a participant payload');
  for (const state of ['ASK#001', 'VOTE#001', 'RESULTS#001']) {
    seed(state);
    const res = await questionHandler({
      pathParameters: { gameId: GAME_ID }, queryStringParameters: { role: 'player' },
    });
    check(`player @ ${state}: no trace of a set this game is not playing`, () => {
      assert.ok(!res.body.includes('OTHER_SET_SENTINEL'),
        `another set leaked into the player payload: ${res.body.slice(0, 300)}`);
      assert.ok(!res.body.includes('otherteamretro'),
        `another set id leaked into the player payload: ${res.body.slice(0, 300)}`);
    });
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('harness error:', e); process.exit(2); });
