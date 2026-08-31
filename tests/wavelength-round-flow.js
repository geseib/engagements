/**
 * The wavelength round, end to end through the REAL get-results handler:
 * close → exact analysis stored + worker dispatched → worker clusters via a
 * stubbed Bedrock → upgraded analysis written back and announced on the wire.
 *
 * What each test would reject:
 *   - a handler that recomputes on re-read (the host who refreshes must get
 *     the same answer the room saw — spec §3, "a re-read must never re-cluster")
 *   - a worker that trusts the model (merges inventing words, chained groups)
 *   - a worker that broadcasts before writing, or double-clusters on retry
 *   - a model failure that leaves the stage waiting on beat one forever
 *   - the return of connectionScore or per-player wavelength scoring
 */
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');

// ---- Loader interception (client-lambda is not installed locally) ----------
const Module = require('module');
const loaderStubs = new Map();
const realLoad = Module._load;
/*
  THE DEPLOYED SHAPE THIS REPRODUCES. get-results.js requires
  '@aws-sdk/client-lambda' in a try/catch, because the pipeline installs NO
  backend dependencies at all — buildspec-dev.yml runs `npm ci` in src/ only,
  and `sam build` targets CodeUri lambda-functions/game/, which has no
  package.json. Every @aws-sdk require in the deployed function therefore
  resolves from the Lambda runtime, and any client the runtime does not carry
  is simply absent. Set this and the require throws, which is exactly what a
  missing client looks like from inside the handler.
*/
let lambdaClientMissing = false;
Module._load = function (request, parent, isMain) {
  if (request === '@aws-sdk/client-lambda' && lambdaClientMissing) {
    const e = new Error("Cannot find module '@aws-sdk/client-lambda'");
    e.code = 'MODULE_NOT_FOUND';
    throw e;
  }
  if (loaderStubs.has(request)) return loaderStubs.get(request);
  return realLoad.call(this, request, parent, isMain);
};

class PutCommand { constructor(i) { this.input = i; this.type = 'put'; } }
class GetCommand { constructor(i) { this.input = i; this.type = 'get'; } }
class QueryCommand { constructor(i) { this.input = i; this.type = 'query'; } }
class DeleteCommand { constructor(i) { this.input = i; this.type = 'delete'; } }
class UpdateCommand { constructor(i) { this.input = i; this.type = 'update'; } }
class PostToConnectionCommand { constructor(i) { this.input = i; } }
class InvokeCommand { constructor(i) { this.input = i; } }
class InvokeModelCommand { constructor(i) { this.input = i; } }

const store = new Map();
const key = (pk, sk) => `${pk}|${sk}`;
let sent = [];            // WebSocket frames
let invocations = [];     // Lambda self-invokes
let bedrockCalls = [];    // Bedrock prompts
let bedrockReply = '[]';  // what the stubbed model says
let bedrockFails = false;
let lambdaFails = false;

/**
 * Honest-enough UpdateCommand applier, including the one shape the worker
 * uses: `SET wordAnalysis = :wa, teamScore = :ts` and the dotted
 * `wordAnalysis.clustering = :status`.
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
    const attrPath = (names[lhs] || lhs).split('.').map((p) => names[p] || p);
    let target = item;
    for (const part of attrPath.slice(0, -1)) {
      if (typeof target[part] !== 'object' || target[part] === null) target[part] = {};
      target = target[part];
    }
    target[attrPath[attrPath.length - 1]] = values[rhs];
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
          (i) => i.PK === pk && String(i.SK).startsWith(String(prefix))
        );
        return { Items: items, Count: items.length };
      }
      default: return {};
    }
  },
};

loaderStubs.set('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
loaderStubs.set('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => fakeDoc },
  PutCommand, GetCommand, QueryCommand, DeleteCommand, UpdateCommand,
});
loaderStubs.set('@aws-sdk/client-apigatewaymanagementapi', {
  ApiGatewayManagementApiClient: class {
    async send(cmd) {
      sent.push({ connectionId: cmd.input.ConnectionId, message: JSON.parse(cmd.input.Data) });
      return {};
    }
  },
  PostToConnectionCommand,
});
loaderStubs.set('@aws-sdk/client-lambda', {
  LambdaClient: class {
    async send(cmd) {
      if (lambdaFails) throw new Error('no self-invoke for you');
      invocations.push(JSON.parse(cmd.input.Payload.toString()));
      return {};
    }
  },
  InvokeCommand,
});
loaderStubs.set('@aws-sdk/client-bedrock-runtime', {
  BedrockRuntimeClient: class {
    async send(cmd) {
      if (bedrockFails) { const e = new Error('Bedrock is having a day'); e.name = 'ServiceUnavailableException'; throw e; }
      bedrockCalls.push(JSON.parse(cmd.input.body).messages[0].content);
      return { body: Buffer.from(JSON.stringify({ content: [{ text: bedrockReply }] })) };
    }
  },
  InvokeModelCommand,
});

/*
  A FAKE TENANT-CRYPTO, so a round can be stored the way a real tenant's round
  is stored. `{__enc: json}` stands in for the `{v, iv, ct, tag}` envelope
  tenant-crypto really writes; what matters is that the stored value is NOT the
  value a caller should receive, so a read path that forgets to unwrap is
  visible instead of being a no-op. Every other section in this file seeds rows
  with no orgId, where both real and fake crypto are pass-through.
*/
const unwrap = (v) => {
  if (Array.isArray(v)) return v.map(unwrap);
  if (v && typeof v === 'object') {
    if (typeof v.__enc === 'string') return JSON.parse(v.__enc);
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, unwrap(x)]));
  }
  return v;
};
const SEALED = (value) => ({ __enc: JSON.stringify(value) });
/* The `results` boundary, from tenant-crypto's ENCRYPTED_FIELDS. Sealing the
   real fields rather than passing through is what makes a handler that reads a
   tenant's row without unwrapping FAIL here instead of quietly working. */
const RESULTS_FIELDS = ['Winners', 'answers', 'question', 'wordAnalysis'];
loaderStubs.set('./tenant-crypto', {
  encryptItem: async (_org, entity, item) => {
    if (entity !== 'results') return item;
    const out = { ...item };
    for (const f of RESULTS_FIELDS) if (f in out) out[f] = SEALED(out[f]);
    return out;
  },
  decryptItem: async (_org, _entity, item) => unwrap(item),
  decryptItems: async (_org, _entity, items) => (items || []).map(unwrap),
});

process.env.TABLE_NAME = 'test-table';
process.env.WEBSOCKET_API_ENDPOINT = 'https://ws.test.invalid/dev';
process.env.AWS_LAMBDA_FUNCTION_NAME = 'engagetest-get-results';
process.env.ACCOUNT_ID = '000000000000';

const { handler } = require(path.join(REPO, 'lambda-functions/game/get-results.js'));

let pass = 0, fail = 0;
function check(label, fn) {
  try { fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const put = (item) => store.set(key(item.PK, item.SK), item);
const resultsRow = (gameId) => store.get(key(`GAME#${gameId}`, 'QUESTION#001#RESULTS'));

function seedGame(gameId, extras = []) {
  store.clear();
  sent = []; invocations = []; bedrockCalls = [];
  bedrockReply = '[]'; bedrockFails = false; lambdaFails = false;
  put({ PK: `GAME#${gameId}`, SK: 'METADATA', GameType: 'wavelength', Title: 'Test session' });
  put({ PK: `GAME#${gameId}`, SK: 'STATE', State: 'ASK#001', LessonNumber: 1, CurrentQuestionId: '001' });
  put({ PK: `GAME#${gameId}`, SK: 'CONNECTION#host-1', ConnectionId: 'host-1', ConnectionType: 'HOST' });
  put({ PK: `GAME#${gameId}`, SK: 'CONNECTION#player-1', ConnectionId: 'player-1', ConnectionType: 'PLAYER', PlayerName: 'Ada' });
  for (const item of extras) put(item);
}

const answer = (gameId, player, words) => ({
  PK: `GAME#${gameId}`, SK: `QUESTION#001#ANSWER#${player}`,
  PlayerName: player, Answer: words.join(','), ProcessedWords: words,
  SubmittedAt: '2026-01-01T00:00:00.000Z',
});

const closeRound = (gameId) => handler({
  requestContext: { routeKey: 'POST /games/{gameId}/close-round' },
  pathParameters: { gameId },
  body: JSON.stringify({ questionNumber: 1 }),
});

const publicRead = (gameId) => handler({
  requestContext: { routeKey: 'POST /games/get-results' },
  body: JSON.stringify({ gameId, questionNumber: 1 }),
});

const runWorker = (gameId) => handler({
  __wavelengthClusterWorker: true, gameId, questionId: '001',
});

(async () => {
  console.log('\n1. closing the round — exact analysis now, clustering dispatched');
  seedGame('2001', [
    answer('2001', 'Ada', ['summit', 'ridge', 'valley']),
    answer('2001', 'Grace', ['Summit', 'ridge']),
    answer('2001', 'Lin', ['summit!', 'ridge', 'tarn']),
  ]);
  const closed = await closeRound('2001');
  const body = JSON.parse(closed.body);

  check('responds 200', () => assert.strictEqual(closed.statusCode, 200, closed.body));
  check('a word lands only when EVERYONE who submitted said it', () => {
    assert.deepStrictEqual(body.wordAnalysis.commonWords.map((w) => w.word.toLowerCase()).sort(),
      ['ridge', 'summit']);
    assert.strictEqual(body.teamScore, 2);
  });
  check('the denominator is on the payload, by name', () =>
    assert.strictEqual(body.wordAnalysis.submitterCount, 3));
  check('everything else still shows with its count', () => {
    const valley = body.wordAnalysis.words.find((w) => w.word === 'valley');
    assert.strictEqual(valley.count, 1);
  });
  check('connectionScore is gone, not zero', () =>
    assert.ok(!('connectionScore' in body.wordAnalysis), 'connectionScore survived'));
  check('per-player wavelength scoring is gone entirely', () =>
    assert.ok(!('teamScoring' in body), 'teamScoring survived'));
  check('cluster members are stored for audit', () =>
    assert.ok(body.wordAnalysis.words.every((w) => Array.isArray(w.members) && w.members.length)));
  check('payload says exact matching, clustering pending', () => {
    assert.strictEqual(body.wordAnalysis.matching, 'exact');
    assert.strictEqual(body.wordAnalysis.clustering, 'pending');
  });
  check('the worker was dispatched for this round', () =>
    assert.deepStrictEqual(invocations, [{ __wavelengthClusterWorker: true, gameId: '2001', questionId: '001' }]));
  check('the RESULTS row was written before the state broadcast', () =>
    assert.ok(resultsRow('2001'), 'no stored round'));

  console.log('\n2. a re-read returns the STORED round — never a recompute');
  // Poison the stored analysis with a marker no recompute would produce; if
  // the marker comes back, the read took the stored path.
  resultsRow('2001').wordAnalysis.marker = 'stored-not-recomputed';
  const reread = await publicRead('2001');
  const rereadBody = JSON.parse(reread.body);
  check('public read of the resolved round is allowed', () =>
    assert.strictEqual(reread.statusCode, 200, reread.body));
  check('and comes from the stored row', () =>
    assert.strictEqual(rereadBody.wordAnalysis.marker, 'stored-not-recomputed'));
  check('a re-read does not re-dispatch the worker', () =>
    assert.strictEqual(invocations.length, 1));

  console.log('\n3. the worker — clusters, writes, THEN announces');
  seedGame('2002', [
    answer('2002', 'Ada', ['summit', 'cloud']),
    answer('2002', 'Grace', ['sumit', 'ridge']),
  ]);
  await closeRound('2002');
  bedrockReply = 'Merging:\n```json\n[["summit", "sumit"], ["cloud", "AWS"]]\n```';
  sent = [];
  await runWorker('2002');

  check('the model saw every distinct word', () => {
    assert.strictEqual(bedrockCalls.length, 1);
    assert.ok(bedrockCalls[0].includes('- summit') && bedrockCalls[0].includes('- sumit'));
  });
  check('the misspelling merge lands the word', () => {
    const row = resultsRow('2002');
    assert.deepStrictEqual(row.wordAnalysis.commonWords.map((w) => w.word), ['sumit']);
    assert.strictEqual(row.teamScore, 1);
    assert.strictEqual(row.wordAnalysis.matching, 'clustered');
    assert.strictEqual(row.wordAnalysis.clustering, 'done');
  });
  check('a merge group naming a word nobody said merges nothing', () => {
    // ["cloud","AWS"]: nobody said AWS, so cloud must survive untouched at 1.
    const cloud = resultsRow('2002').wordAnalysis.words.find((w) => w.word === 'cloud');
    assert.ok(cloud && cloud.count === 1, 'cloud was merged with an invented word');
  });
  check('the room is told, host and player alike', () => {
    const frames = sent.filter((s) => s.message.type === 'wavelengthAnalysisReady');
    assert.deepStrictEqual(frames.map((f) => f.connectionId).sort(), ['host-1', 'player-1']);
    assert.strictEqual(frames[0].message.wordAnalysis.clustering, 'done');
    assert.strictEqual(frames[0].message.teamScore, 1);
  });

  console.log('\n4. the worker is idempotent — a retry cannot produce a second answer');
  sent = []; bedrockCalls = [];
  await runWorker('2002');
  check('an already-clustered round is left alone', () => {
    assert.strictEqual(bedrockCalls.length, 0, 'the model was consulted again');
    assert.strictEqual(sent.length, 0, 'a second frame went out');
  });

  console.log('\n5. model failure — exact matching stands and SAYS SO');
  seedGame('2003', [
    answer('2003', 'Ada', ['summit', 'ridge']),
    answer('2003', 'Grace', ['summit', 'valley']),
  ]);
  await closeRound('2003');
  sent = [];
  bedrockFails = true;
  await runWorker('2003');

  check('the stored round is downgraded honestly', () => {
    const row = resultsRow('2003');
    assert.strictEqual(row.wordAnalysis.matching, 'exact');
    assert.strictEqual(row.wordAnalysis.clustering, 'failed');
  });
  check('the exact analysis is untouched', () =>
    assert.deepStrictEqual(resultsRow('2003').wordAnalysis.commonWords.map((w) => w.word), ['summit']));
  check('beat one still resolves — the failure frame goes out', () => {
    const frames = sent.filter((s) => s.message.type === 'wavelengthAnalysisReady');
    assert.strictEqual(frames.length, 2);
    assert.strictEqual(frames[0].message.wordAnalysis.clustering, 'failed');
  });

  console.log('\n6. dispatch failure at close time — nobody waits for a frame that will never come');
  seedGame('2004', [
    answer('2004', 'Ada', ['summit', 'ridge']),
    answer('2004', 'Grace', ['summit', 'valley']),
  ]);
  lambdaFails = true;
  const undispatched = await closeRound('2004');
  check('the response already says clustering failed', () =>
    assert.strictEqual(JSON.parse(undispatched.body).wordAnalysis.clustering, 'failed'));
  check('so does the stored round', () =>
    assert.strictEqual(resultsRow('2004').wordAnalysis.clustering, 'failed'));

  console.log('\n7. nothing worth clustering — skipped, not pending');
  seedGame('2005', [answer('2005', 'Ada', ['summit', 'ridge'])]);
  const solo = await closeRound('2005');
  check('a single submitter skips the model entirely', () => {
    assert.strictEqual(JSON.parse(solo.body).wordAnalysis.clustering, 'skipped');
    assert.strictEqual(invocations.length, 0);
  });
  check('and their whole list lands — all 1 who answered', () =>
    assert.strictEqual(JSON.parse(solo.body).teamScore, 2));

  console.log('\n8. nothing unanimous — the near-miss tier is on the payload');
  seedGame('2006', [
    answer('2006', 'Ada', ['summit', 'ridge']),
    answer('2006', 'Grace', ['summit', 'scree']),
    answer('2006', 'Lin', ['valley', 'ridge']),
  ]);
  const nearMiss = await closeRound('2006');
  const nm = JSON.parse(nearMiss.body).wordAnalysis;
  check('nothing landed', () => assert.deepStrictEqual(nm.commonWords, []));
  check('what came closest is named, with its count', () => {
    assert.deepStrictEqual(nm.nearMiss.map((w) => w.word).sort(), ['ridge', 'summit']);
    assert.ok(nm.nearMiss.every((w) => w.count === 2));
  });

  /*
    9. THE DISPATCHER THAT WAS NEVER THERE — and the round that said nothing.

    Reported after a live session: "wavelength did not refine the list for
    mispellings or like words … sore was likely score". The clustering pass is
    built to catch exactly that, so the question was why it had not run.

    `clusteringPlanned` was three conditions collapsed into one status:

        Boolean(lambda) && submitterCount >= 2 && totalUniqueWords >= 2

    and every falsy path stored clustering:'skipped'. Two of the three really
    are "nothing to cluster" — section 7 above — and the stage says nothing for
    them ON PURPOSE (utils/wavelength.js: announcing a loss that did not happen
    is its own kind of lie). The third is a room of twelve with thirty distinct
    words whose model pass never even dispatched, and it was wearing the same
    silent status: an exact-match-only result presented as the final answer,
    which is the one outcome both the worker and the stage say must never
    happen — "a degraded claim about agreement that does not announce itself is
    worse than no claim".

    // rejects: a missing dispatcher hiding behind the status that means
    //          "there was nothing to do".
  */
  console.log('\n9. the dispatcher is missing — that is not "nothing to cluster"');
  {
    // A SECOND instance of the handler, loaded with the require throwing. The
    // client is resolved once at module load, so the flag has to be set before
    // the re-require and the cache entry dropped.
    lambdaClientMissing = true;
    delete require.cache[require.resolve(path.join(REPO, 'lambda-functions/game/get-results.js'))];
    const { handler: noDispatcher } = require(path.join(REPO, 'lambda-functions/game/get-results.js'));
    lambdaClientMissing = false;

    seedGame('2007', [
      answer('2007', 'Ada', ['score', 'better']),
      answer('2007', 'Grace', ['sore', 'betterment']),
      answer('2007', 'Lin', ['score', 'ridge']),
    ]);
    const undispatchable = await noDispatcher({
      requestContext: { routeKey: 'POST /games/{gameId}/close-round' },
      pathParameters: { gameId: '2007' },
      body: JSON.stringify({ questionNumber: 1 }),
    });
    const wa = JSON.parse(undispatchable.body).wordAnalysis;

    check('a full room with no dispatcher does not report "skipped"', () =>
      assert.notStrictEqual(wa.clustering, 'skipped',
        'the stage says nothing for skipped, so this round claims to be final'));
    check('it reports the dispatcher as unavailable', () =>
      assert.strictEqual(wa.clustering, 'unavailable'));
    check('and the stored round agrees', () =>
      assert.strictEqual(resultsRow('2007').wordAnalysis.clustering, 'unavailable'));
    check('nothing was dispatched, and the exact result still stands', () => {
      assert.strictEqual(invocations.length, 0);
      assert.strictEqual(wa.matching, 'exact');
      assert.ok(wa.words.length > 0, 'the round lost its analysis as well');
    });

    // The handler the rest of this file uses is the stubbed-client one; put it
    // back so nothing after here inherits the broken instance.
    delete require.cache[require.resolve(path.join(REPO, 'lambda-functions/game/get-results.js'))];
    require(path.join(REPO, 'lambda-functions/game/get-results.js'));
  }

  /*
    10. THE WORKER NEEDS LONGER THAN THE ROUND-CLOSE DOES.

    The self-invoke exists to get the Bedrock call off the API Gateway ceiling —
    the comment on it says so, and names `get-ai-summary` as the pattern it
    copies. get-ai-summary is a 300s function. The clustering worker is NOT a
    separate function: it is a second entry point into get-results, so it
    inherits get-results' timeout, and that was 30s.

    WHY A HARD TIMEOUT IS THE WORST FAILURE OF THE THREE. Every other way this
    can fail runs the catch below — the row is marked 'failed' and the SAME
    frame goes out, so the stage resolves beat one and the room sees the exact
    result. A hard timeout KILLS THE PROCESS: no catch, no status write, no
    broadcast. The row is left saying 'pending' forever, and the stage waits out
    its watchdog with nothing ever arriving.

    Observed on dev 2026-08-29: a four-player round sat on beat one for the full
    watchdog and never resolved, which is the signature of exactly this.

    // rejects: the worker inheriting a request-path timeout again.
  */
  console.log('\n10. the clustering worker gets a worker-sized timeout');
  {
    const template = require('fs').readFileSync(path.join(REPO, 'template-clean.yaml'), 'utf8');
    // The Timeout belonging to one function: from its FunctionName line to the
    // next resource at the same indent.
    const timeoutOf = (fnName) => {
      const at = template.indexOf(`\${StackName}-${fnName}'`);
      if (at === -1) return null;
      const rest = template.slice(at, at + 4000);
      const stop = rest.search(/\n  [A-Z]\w+:\n/);
      const block = stop === -1 ? rest : rest.slice(0, stop);
      const m = /\n\s+Timeout:\s*(\d+)/.exec(block);
      return m ? Number(m[1]) : null;
    };

    const getResults = timeoutOf('get-results');
    const aiSummary = timeoutOf('get-ai-summary');

    check('the template scanner found both timeouts (guards this check)', () => {
      assert.ok(Number.isInteger(getResults), `get-results Timeout not found (${getResults})`);
      assert.ok(Number.isInteger(aiSummary), `get-ai-summary Timeout not found (${aiSummary})`);
    });
    check('get-results has at least the worker budget get-ai-summary has', () =>
      assert.ok(getResults >= aiSummary,
        `get-results is ${getResults}s and get-ai-summary is ${aiSummary}s — the clustering `
        + 'worker runs inside get-results and dies mid-Bedrock without marking or broadcasting'));
  }

  /*
    11. A RE-READ HANDS BACK THE ROUND, NOT ITS CIPHERTEXT.

    The stored RESULTS row is encrypted per organisation — `wordAnalysis`,
    `answers` and `question` are all on tenant-crypto's `results` boundary,
    because the wavelength branch stores each participant's literal submission
    inside the tally. Every other read path in this handler unwraps before
    answering. The re-read path spread the stored item straight into the
    response:

        const { PK, SK, ttl, ...resultsData } = storedRound.Item;

    so a player fetching results after the round closed, or a host refreshing,
    received `{v, iv, ct, tag}` where the words should be. Confirmed against dev
    2026-08-29 by reading a closed round over the public route.

    It hid because the round-close response is computed IN MEMORY and returned
    before any of it is stored — so the host who closes the round sees the real
    thing, and only the second reader sees the envelope. The block's own comment
    states the contract it was breaking: "the same round asked twice has to give
    the same answer, or a host who refreshes gets a different result than the
    room saw."

    // rejects: a read path that answers with the envelope.
  */
  console.log('\n11. a re-read of an encrypted round is decrypted');
  {
    seedGame('2008');
    // A tenant's session, and a round already stored the way one is stored.
    put({ PK: 'GAME#2008', SK: 'METADATA', GameType: 'wavelength', Title: 'Tenant session', orgId: 'org_9xK4Fq7Pz2mNbVc8dQwLxR' });
    // The room is ON this round — the public read reports only the resolved one
    // (it refuses to close a round on a participant's behalf), so a seed left at
    // ASK#001 tests the refusal rather than the decrypt.
    put({ PK: 'GAME#2008', SK: 'STATE', State: 'RESULTS#001', LessonNumber: 1, CurrentQuestionId: '001' });
    put({
      PK: 'GAME#2008',
      SK: 'QUESTION#001#RESULTS',
      gameId: '2008',
      questionId: '001',
      gameType: 'wavelength',
      teamScore: 1,
      question: SEALED({ title: 'Where does time go?' }),
      answers: SEALED([{ playerName: 'Ada', answer: 'summit,ridge', words: ['summit', 'ridge'] }]),
      wordAnalysis: SEALED({
        submitterCount: 2, totalWordsSubmitted: 4, totalUniqueWords: 3,
        commonWords: [{ word: 'summit', count: 2, members: ['summit'] }],
        nearMiss: [], words: [{ word: 'summit', count: 2, members: ['summit'] }],
        matching: 'clustered', clustering: 'done',
      }),
    });

    const reread = JSON.parse((await publicRead('2008')).body);

    check('wordAnalysis comes back as the analysis, not the envelope', () => {
      assert.ok(!reread.wordAnalysis || !('__enc' in reread.wordAnalysis),
        'the caller received ciphertext where the words should be');
      assert.strictEqual(reread.wordAnalysis.clustering, 'done');
      assert.deepStrictEqual(reread.wordAnalysis.commonWords.map((w) => w.word), ['summit']);
    });
    check('so do the answers and the question', () => {
      assert.ok(Array.isArray(reread.answers), `answers came back as ${typeof reread.answers}`);
      assert.strictEqual(reread.answers[0].playerName, 'Ada');
      assert.strictEqual(reread.question.title, 'Where does time go?');
    });
  }

  /*
    12. A TENANT'S ROUND ACTUALLY GETS CLUSTERED.

    Every seed above this point has no orgId, so tenant-crypto is a pass-through
    and the worker reads plaintext. That fixture choice hid the bug entirely.

    On a real session the stored row is sealed, and the worker fetched it with a
    raw GetCommand and never unwrapped it:

        if (!stored.Item || !stored.Item.wordAnalysis) ...   // an envelope is truthy
        if (round.wordAnalysis.clustering !== 'pending') {   // an envelope has no .clustering
          return { statusCode: 200 };                        // undefined !== 'pending'
        }

    So the worker's own IDEMPOTENCY GUARD fired on every tenant round, and it
    returned immediately having logged "clustering already undefined — leaving
    it alone" at info level. No Bedrock call, no status write, no broadcast, and
    nothing anywhere that reads as an error. The row said 'pending' forever and
    the stage waited out its watchdog.

    Observed twice on dev: sessions 3083 and 5578, both stuck at 'pending', the
    second still pending two minutes after the round closed.

    TWO TRAPS IN THE FIX, both asserted below. Decrypting on the way in and
    writing the result back as-is would put a tenant's words in the table IN THE
    CLEAR. And markWavelengthClustering's `SET wordAnalysis.clustering` is a
    document path into what is, on a tenant row, a {v,iv,ct,tag} envelope — it
    does not update a status, it bolts a stray key onto the ciphertext, which is
    why a failing worker never recorded its failure either.

    // rejects: a worker that reads a tenant's round without unwrapping it, and
    //          one that writes the answer back in the clear.
  */
  console.log('\n12. a tenant round is clustered, and stays encrypted at rest');
  {
    const ORG = 'org_9xK4Fq7Pz2mNbVc8dQwLxR';
    const tenantRound = (gameId) => {
      seedGame(gameId, [
        answer(gameId, 'Ada', ['summit', 'ridge']),
        answer(gameId, 'Grace', ['summit', 'ridges']),
      ]);
      put({ PK: `GAME#${gameId}`, SK: 'METADATA', GameType: 'wavelength', Title: 'Tenant', orgId: ORG });
    };

    tenantRound('2009');
    await closeRound('2009');

    check('the round is stored sealed, and says pending inside', () => {
      const row = resultsRow('2009');
      assert.ok(row.wordAnalysis && typeof row.wordAnalysis.__enc === 'string',
        'the stored round is not encrypted — this test proves nothing');
      assert.strictEqual(unwrap(row).wordAnalysis.clustering, 'pending');
    });

    bedrockReply = '[["ridge","ridges"]]';
    await runWorker('2009');

    check('the worker read it, so it clustered instead of bailing out', () => {
      const wa = unwrap(resultsRow('2009')).wordAnalysis;
      assert.strictEqual(wa.clustering, 'done',
        `clustering is "${wa.clustering}" — the worker bailed on its own idempotency guard`);
      assert.strictEqual(wa.matching, 'clustered');
    });

    // rejects: THE LEAK. Unwrapping to work on it and writing the result back
    // as-is puts a tenant's words in the table in the clear.
    check('and wrote it back still sealed', () => {
      const row = resultsRow('2009');
      assert.ok(row.wordAnalysis && typeof row.wordAnalysis.__enc === 'string',
        'the worker wrote the analysis back in the CLEAR — a tenant\'s words are now readable at rest');
    });

    check('the merge actually landed — ridge and ridges are one word', () => {
      const wa = unwrap(resultsRow('2009')).wordAnalysis;
      assert.deepStrictEqual(wa.commonWords.map((w) => w.word).sort(), ['ridge', 'summit']);
    });

    check('the room is told, in plaintext — clients hold no key', () => {
      const frames = sent.filter((x) => x.message.type === 'wavelengthAnalysisReady');
      assert.ok(frames.length > 0, 'no frame went out, so the stage waits out its watchdog');
      const wa = frames[frames.length - 1].message.wordAnalysis;
      assert.ok(!wa.__enc, 'the frame carries ciphertext, which no client can render');
      assert.strictEqual(wa.clustering, 'done');
    });

    // The failure path, which never recorded anything on a tenant round.
    tenantRound('2010');
    await closeRound('2010');
    bedrockFails = true;
    await runWorker('2010');
    bedrockFails = false;

    check('a failing worker records the failure where it can be read back', () => {
      const wa = unwrap(resultsRow('2010')).wordAnalysis;
      assert.strictEqual(wa.clustering, 'failed',
        `clustering reads "${wa.clustering}" — the status was written into the ciphertext envelope`);
    });
    check('and did not break the seal doing it', () => {
      const row = resultsRow('2010');
      assert.ok(row.wordAnalysis && typeof row.wordAnalysis.__enc === 'string',
        'the failure path left the round in the clear');
    });
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
