/**
 * A FEEDBACK ROUND IS THE THIRD BEAT OF RESULTS.
 *
 * The owner asked for *"a request feedback button during the AI feedback phase.
 * if so there is a new round where every one can comment on what they have
 * heard"*. Three mechanisms could have carried that and two are wrong:
 *
 *   - A new ROUND KIND is an authoring axis. It lives on the question set,
 *     steers the generator, and nothing under lambda-functions/game reads it at
 *     runtime (admin/shared/round-kinds.js header). A feedback round has no
 *     authored question at all.
 *
 *   - A new GAME STATE would mint a second round ordinal, and the comments have
 *     to land in `detailedQuestions[i]` — the round report OF THE ROUND BEING
 *     COMMENTED ON. A separate ordinal orphans them from the thing they
 *     annotate, and disturbs LessonNumber, roundOf and the question queue on
 *     the way past.
 *
 * RESULTS already has beats: durable per round on ROUND#nnn, host-authenticated,
 * idempotent, bidirectional between the projector and the host's phone, and
 * announced as `stageBeatChanged` — a frame deliberately distinct from
 * `gameStateChanged` so it does not trigger a full client re-sync. So feedback
 * becomes the third one, and this file proves the extension did not break the
 * two that were there.
 */
const path = require('path');
const fs = require('fs');
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

/**
 * A real UpdateCommand applier, not a `return {}` stub — a stub that returned
 * an empty object would let a handler which broadcasts the beat but never
 * writes it pass every assertion here, and a beat that is only broadcast is
 * lost on the next reload.
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
    item[names[lhs] || lhs] = values[rhs];
  }
  store.set(k, item);
  return {};
}

const fakeDoc = {
  send: async (cmd) => {
    const inp = cmd.input || {};
    switch (cmd.type) {
      case 'put': store.set(key(inp.Item.PK, inp.Item.SK), inp.Item); return {};
      case 'get': return { Item: store.get(key(inp.Key.PK, inp.Key.SK)) };
      case 'delete': store.delete(key(inp.Key.PK, inp.Key.SK)); return {};
      case 'update': return applyUpdate(inp);
      case 'query': {
        const pk = inp.ExpressionAttributeValues[':pk'];
        const prefix = inp.ExpressionAttributeValues[':sk'] ?? '';
        const items = [...store.values()].filter(
          (i) => i.PK === pk && String(i.SK).startsWith(String(prefix)));
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

const stageBeatModule = require(path.join(REPO, 'lambda-functions/game/stage-beat.js'));
const { handler: stageBeat } = stageBeatModule;
const { handler: getState } = require(path.join(REPO, 'lambda-functions/game/get-game-state.js'));

let pass = 0, fail = 0;
// async-aware: `await fn()` awaits a returned promise the same way it resolves
// a plain value, so a rejection from an `async` callback lands in this catch
// exactly like a thrown error from a sync one. Previously a `check(label, async
// () => {...})` call could never fail — `fn()` returned a pending promise, the
// try block completed "successfully" around that promise object, and the
// rejection (if any) settled after this function had already returned. Every
// call site below now `await`s this function so increments stay ordered and
// the final tally is complete before it is printed.
async function check(label, fn) {
  try { await fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const put = (item) => store.set(key(item.PK, item.SK), item);
const roundOf = (gameId, padded) => store.get(key(`GAME#${gameId}`, `ROUND#${padded}`));
const post = (gameId, body) => stageBeat({
  requestContext: { http: { method: 'POST' } },
  pathParameters: { gameId },
  body: JSON.stringify(body),
});

function seedGame(gameId, lessonNumber = 3) {
  store.clear();
  sent = [];
  const padded = String(lessonNumber).padStart(3, '0');
  put({ PK: `GAME#${gameId}`, SK: 'METADATA', GameType: 'call-and-answer', Title: 'Test session' });
  put({ PK: `GAME#${gameId}`, SK: 'STATE', State: `RESULTS#${padded}`, LessonNumber: lessonNumber });
  put({ PK: `GAME#${gameId}`, SK: `ROUND#${padded}`, QuestionNumber: padded, AuthorsRevealed: true, StageBeat: 'field-notes' });
  put({ PK: `GAME#${gameId}`, SK: 'CONNECTION#host-1', ConnectionId: 'host-1', ConnectionType: 'HOST' });
  put({ PK: `GAME#${gameId}`, SK: 'CONNECTION#player-1', ConnectionId: 'player-1', ConnectionType: 'PLAYER', PlayerName: 'Ada' });
}

(async () => {
  // ---------- 1. the vocabulary ----------
  console.log('\n1. feedback is a beat, on both sides of the wire');

  await check('the server knows three beats, in flow order', () => {
    // Written out by hand. Comparing against the module's own export twice
    // would prove only that it agrees with itself.
    assert.deepStrictEqual(stageBeatModule.BEATS, ['results', 'field-notes', 'feedback']);
  });

  await check('the frontend mirror declares the same three, in the same order', () => {
    // Read as TEXT, the way tests/round-kind-steering.js:216 reads its mirror.
    // The frontend module is ESM and cannot be require()d into this bundle, and
    // a mirror that drifts fails in the worst way available: the write succeeds,
    // the frame goes out, every client compares the value against a list that
    // does not contain it, and the host watches a button do nothing with no
    // error anywhere in the system.
    const mirror = fs.readFileSync(path.join(REPO, 'src/src/config/hostControls.js'), 'utf8');
    const declared = /STAGE_BEATS\s*=\s*\[([^\]]*)\]/.exec(mirror)[1]
      .split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
    assert.deepStrictEqual(declared, ['results', 'field-notes', 'feedback']);
  });

  // ---------- 2. the write ----------
  console.log('\n2. the host opens a feedback round');
  seedGame('3001');
  const opened = await post('3001', { beat: 'feedback', questionNumber: 3 });

  await check('responds 200', () =>
    assert.strictEqual(opened.statusCode, 200, `got ${opened.statusCode}: ${opened.body}`));

  await check('writes StageBeat=feedback onto the round being commented on', () => {
    const round = roundOf('3001', '003');
    assert.ok(round, 'no ROUND#003 record');
    assert.strictEqual(round.StageBeat, 'feedback', `StageBeat is '${round.StageBeat}'`);
  });

  await check('leaves AuthorsRevealed alone', () => {
    // The beat and the reveal share this item. A Put here would un-reveal a
    // round get-results had already revealed, and every attributed response in
    // the report the room is about to comment on would go back in the box.
    assert.strictEqual(roundOf('3001', '003').AuthorsRevealed, true,
      'the reveal was clobbered — this must be an UpdateCommand, not a Put');
  });

  await check('does not touch the game STATE row', () => {
    // A feedback round is a beat, not a state. If this moved, round numbering,
    // the question queue and every ASK#/VOTE#/RESULTS# prefix test downstream
    // would be reasoning about a state string nothing else knows how to read.
    assert.strictEqual(store.get(key('GAME#3001', 'STATE')).State, 'RESULTS#003');
  });

  await check('announces it to the whole room, players included', () => {
    // The participants are the point of this beat — they are the ones who get
    // the report and the composer. A frame that reached only the projector
    // would open a feedback round nobody could join.
    const ids = sent.map((s) => s.connectionId).sort();
    assert.deepStrictEqual(ids, ['host-1', 'player-1'], `announced to [${ids}]`);
  });

  await check('the frame is a stageBeatChanged carrying the beat and the round', () => {
    const frame = sent[0].message;
    assert.strictEqual(frame.type, 'stageBeatChanged', `type was '${frame.type}'`);
    assert.strictEqual(frame.beat, 'feedback', `beat was '${frame.beat}'`);
    assert.strictEqual(frame.questionNumber, '003', `round was '${frame.questionNumber}'`);
    assert.strictEqual(frame.gameId, '3001');
  });

  // ---------- 3. it is still a closed set ----------
  console.log('\n3. the set is still closed, and the old beats still work');

  seedGame('3002');
  const unknown = await post('3002', { beat: 'chat', questionNumber: 3 });
  await check('an unknown beat is still refused with 400', () =>
    assert.strictEqual(unknown.statusCode, 400, `got ${unknown.statusCode}`));
  await check('and nothing was written for it', () =>
    assert.strictEqual(roundOf('3002', '003').StageBeat, 'field-notes',
      'a refused beat still moved the round'));

  seedGame('3003');
  const back = await post('3003', { beat: 'results', questionNumber: 3 });
  await check('the host can still step back to the tally', () => {
    assert.strictEqual(back.statusCode, 200);
    assert.strictEqual(roundOf('3003', '003').StageBeat, 'results');
  });

  seedGame('3004');
  await post('3004', { beat: 'feedback', questionNumber: 3 });
  const again = await post('3004', { beat: 'feedback', questionNumber: 3 });
  await check('opening the same feedback round twice is a no-op, not an error', () => {
    // The host is standing in front of a room; a double-tap must be a 200.
    assert.strictEqual(again.statusCode, 200, `got ${again.statusCode}`);
    assert.strictEqual(roundOf('3004', '003').StageBeat, 'feedback');
  });

  seedGame('3005');
  const junk = await post('3005', { beat: 'feedback', questionNumber: 'three' });
  await check('a non-numeric round is still refused before it becomes a sort key', () =>
    assert.strictEqual(junk.statusCode, 400, `got ${junk.statusCode}`));

  // ---------- 4. per round, not per game ----------
  console.log('\n4. the beat belongs to the round, not to the session');
  seedGame('3006', 3);
  put({ PK: 'GAME#3006', SK: 'ROUND#004', QuestionNumber: '004' });
  await post('3006', { beat: 'feedback', questionNumber: 3 });
  await check('opening feedback on round 3 leaves round 4 on its own beat', () => {
    // The next round's results must open on its own tally, not inherit the
    // previous round's feedback session. Storing the beat on the STATE record
    // would do exactly that.
    assert.strictEqual(roundOf('3006', '003').StageBeat, 'feedback');
    assert.strictEqual(roundOf('3006', '004').StageBeat, undefined);
  });

  // ---------- 5. it survives the read-back ----------
  console.log('\n5. every surface that polls or reloads can see it');
  seedGame('3007', 3);
  await post('3007', { beat: 'feedback', questionNumber: 3 });
  const state = await getState({
    requestContext: { http: { method: 'GET' } },
    pathParameters: { gameId: '3007' },
  });
  const payload = JSON.parse(state.body);

  await check('get-game-state reports the feedback beat, not the tally', () => {
    // THIS IS THE ONE THAT WAS BROKEN. The reader tested `=== 'field-notes'`
    // against a variable initialised to 'results', so a stored `feedback` was
    // reported to every client as `results` — the row correct, the wire wrong,
    // and nothing in any log. This endpoint is upstream of the host page and
    // the phone remote, so a beat lost here is lost everywhere at once.
    assert.strictEqual(payload.stageBeat, 'feedback', `stageBeat was '${payload.stageBeat}'`);
  });

  await check('and still reports the older beats it always did', async () => {
    // Widening the read must not have loosened it into a passthrough.
    assert.strictEqual(payload.authorsRevealed, true);
  });

  seedGame('3008', 3);
  await post('3008', { beat: 'field-notes', questionNumber: 3 });
  const fieldNotes = JSON.parse((await getState({
    requestContext: { http: { method: 'GET' } },
    pathParameters: { gameId: '3008' },
  })).body);
  await check('field-notes still reads back as field-notes', () =>
    assert.strictEqual(fieldNotes.stageBeat, 'field-notes'));

  // A value from an older or newer deploy must fall back rather than travel on
  // to a client that will compare it against a list it is not in.
  seedGame('3009', 3);
  put({ PK: 'GAME#3009', SK: 'ROUND#003', QuestionNumber: '003', StageBeat: 'from-the-future' });
  const unknownBeat = JSON.parse((await getState({
    requestContext: { http: { method: 'GET' } },
    pathParameters: { gameId: '3009' },
  })).body);
  await check('an unrecognised stored beat falls back to the tally', () =>
    assert.strictEqual(unknownBeat.stageBeat, 'results',
      `an unknown beat travelled to the client as '${unknownBeat.stageBeat}'`));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
