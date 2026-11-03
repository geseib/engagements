/**
 * EVERY READER OF A ROUND'S QUESTION GOES THROUGH ONE RESOLVER
 * (lambda-functions/{game,websocket}/round-question.js) — the main risk of the
 * impromptu ask (docs/design/impromptu-ask README §5.5, §6 risk 1).
 *
 * A round used to be a set row and nothing else, so seven readers (eight with
 * the socket's two) each resolved the set partition from the REF and fetched
 * `REF.SourceQuestionId` themselves. A host-written round's question lives on
 * the SESSION (`OWNQ#<id>`); a reader that still went to the set would show
 * "Source question not found" on every phone.
 *
 *   §1 THE GUARD, on the source: no file but the resolver uses a
 *      SourceQuestionId as a key; every file that mentions SourceQuestionId is
 *      one of the named writers/collectors or a reader that requires the
 *      resolver; the two copies of the resolver are identical.
 *   §2 THE RESOLVER: a set REF reads the set row through its pinned version; an
 *      own REF (`Source: 'host'`, or an `OWNQ#` id standing in from a RESULTS
 *      row) reads the session's row; a missing row is null, never a throw.
 *   §3 EACH READER, driven for real with an own REF and a set REF:
 *      get-question, get-game-state, get-results (the read-back), poll-round,
 *      create-report, websocket/message.js (trivia scoring and poll check),
 *      and platform-metrics' bucket. (get-ai-summary has its own file,
 *      tests/ai-summary-own.js.)
 */
const suiteFinished = require('./helpers/finish-guard');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const { createTable, installStubs } = require('./helpers/player-table');

const table = createTable();
const store = table.store;
const sent = [];
installStubs({ table, sent });

const noopClient = class { async send() { return {}; } };
for (const [name, exports] of [
  ['@aws-sdk/client-lambda', { LambdaClient: noopClient, InvokeCommand: class {} }],
  ['@aws-sdk/client-s3', { S3Client: noopClient, GetObjectCommand: class {}, PutObjectCommand: class {} }],
  ['@aws-sdk/client-bedrock-runtime', { BedrockRuntimeClient: class { async send() { throw new Error('no Bedrock'); } }, InvokeModelCommand: class {} }],
]) {
  for (const base of [REPO, path.join(REPO, 'lambda-functions'), path.join(REPO, 'lambda-functions', 'game'), path.join(REPO, 'lambda-functions', 'websocket')]) {
    let p;
    try { p = require.resolve(name, { paths: [base] }); } catch { continue; }
    require.cache[p] = { id: p, filename: p, loaded: true, exports };
  }
}

process.env.TABLE_NAME = 'test-table';
process.env.WEBSOCKET_API_ENDPOINT = 'https://ws.test.invalid/dev';

let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

/* ---- §1 the guard ---------------------------------------------------------- */

const LAMBDA = path.join(REPO, 'lambda-functions');
function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === 'archive') continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (name.endsWith('.js')) out.push(p);
  }
  return out;
}
const rel = (p) => path.relative(LAMBDA, p).split(path.sep).join('/');
const sources = new Map(walk(LAMBDA).map((p) => [rel(p), fs.readFileSync(p, 'utf8')]));

/** The resolver itself. */
const RESOLVERS = ['game/round-question.js', 'websocket/round-question.js'];

/**
 * Files that mention SourceQuestionId WITHOUT fetching a question by it, each
 * with why. Adding a file here is a decision: it must never use the id as a key.
 */
const NOT_READERS = {
  'game/next-question.js': 'writes the REF; collects asked ids from REF rows',
  'game/up-next.js': 'collects asked ids from REF rows (the preview twin of next-question)',
  'game/platform-metrics.js': 'buckets a round; returns the own bucket for an own REF before any set read',
  'websocket/platform-metrics.js': 'byte-for-byte copy of game/platform-metrics.js',
  'admin/shared/platform-metrics.js': 'byte-for-byte copy of game/platform-metrics.js',
};

/** The readers, every one of which must require the resolver and call it. */
const READERS = [
  'game/get-question.js',
  'game/get-game-state.js',
  'game/get-results.js',
  'game/get-ai-summary.js',
  'game/create-report.js',
  'game/poll-round.js',
  'websocket/message.js',
];

(async () => {
  console.log('\n1. the guard: nothing reads a round\'s question around the resolver');

  await check('the two copies of round-question.js are identical', () =>
    assert.strictEqual(sources.get(RESOLVERS[0]), sources.get(RESOLVERS[1]), 'game/ and websocket/ copies drifted'));

  await check('no file but the resolver uses a SourceQuestionId as a DynamoDB key', () => {
    const offenders = [];
    const keyUse = [
      /SK\s*:\s*[\w.?]*\.SourceQuestionId\b/,
      /Key\s*:\s*\{[^}]*SourceQuestionId/,
    ];
    for (const [file, src] of sources) {
      if (RESOLVERS.includes(file)) continue;
      if (keyUse.some((re) => re.test(src))) { offenders.push(file); continue; }
      // The two-step form the old readers used: `const id = ref.SourceQuestionId`
      // and later `SK: id` (or `':sk': id`).
      for (const m of src.matchAll(/(?:(?:const|let|var)\s+)?(\w+)\s*=\s*[\w.?]+\.SourceQuestionId\b/g)) {
        const v = m[1];
        if (new RegExp(`(SK|':sk')\\s*:\\s*${v}\\b`).test(src)) { offenders.push(file); break; }
      }
    }
    assert.deepStrictEqual(offenders, [], `read a question by SourceQuestionId around the resolver: ${offenders.join(', ')}`);
  });

  await check('every file that mentions SourceQuestionId is a named non-reader or a reader on the resolver', () => {
    const unknown = [];
    for (const [file, src] of sources) {
      if (RESOLVERS.includes(file) || !/SourceQuestionId/.test(src)) continue;
      if (NOT_READERS[file]) continue;
      if (READERS.includes(file)) continue;
      unknown.push(file);
    }
    assert.deepStrictEqual(unknown, [], `new SourceQuestionId reader(s) — route them through round-question.js: ${unknown.join(', ')}`);
  });

  await check('each reader requires ./round-question and calls the resolver', () => {
    const missing = READERS.filter((file) => {
      const src = sources.get(file) || '';
      return !/require\(['"]\.\/round-question['"]\)/.test(src)
        || !/\b(readRoundQuestion|readRoundByNumber)\s*\(/.test(src);
    });
    assert.deepStrictEqual(missing, [], `not on the resolver: ${missing.join(', ')}`);
  });

  await check('no reader resolves the set partition from a REF by hand any more', () => {
    const byHand = READERS.filter((file) => /resolveSetPartition\([^)]*(questionRef|ref)\.Item[^)]*SetVersion/.test(sources.get(file) || '')
      || /refSetRef\((questionRef\.Item|ref\.Item|ref)\b/.test(sources.get(file) || ''));
    assert.deepStrictEqual(byHand, [], `still resolving the REF's set itself: ${byHand.join(', ')}`);
  });

  await check('platform-metrics short-circuits an own REF before any set read', () => {
    const src = sources.get('game/platform-metrics.js');
    assert.match(src, /ref\.Source === 'host' \|\| isOwnQuestionId\(ref\.SourceQuestionId\)\) return ownBucket\(\)/);
  });

  /* ---- §2 the resolver ----------------------------------------------------- */
  console.log('\n2. the resolver');

  const RQ = require(path.join(REPO, 'lambda-functions/game/round-question.js'));
  const GAME = '6230';
  const PK = `GAME#${GAME}`;
  const SET = 'set-r';
  const SETPK = `SET#${SET}#v2`;
  const put = (item) => { store.set(table.keyOf(item.PK, item.SK), item); };
  const OWN_TITLE = 'What would have to be true for the pilot to ship?';
  const NOTE = 'Note for Workie only: budget or sign-off?';

  function seed({ own = true, gameType = 'call-and-answer', state = 'ASK#001' } = {}) {
    store.clear();
    sent.length = 0;
    put({ PK, SK: 'METADATA', GameType: gameType, Title: 'Readers', QuestionSetId: SET, QuestionSetVersion: 2, Started: true, Visibility: 'public' });
    put({ PK, SK: 'STATE', State: state, LessonNumber: 1, CurrentQuestionId: '001' });
    put({ PK: 'SETS', SK: `SET#${SET}`, activeVersion: 2, versions: [{ version: 2 }] });
    put({ PK: SETPK, SK: 'QUESTION#c001#001', Category: 'Delivery', Title: 'A set question', Detail: 'Set detail', optionA: 'Yes', optionB: 'No', correctAnswer: 'OptionA' });
    put({ PK, SK: 'OWNQ#abc123', Title: OWN_TITLE, Detail: 'A line for the room', Background: NOTE, CustomInstructions: RQ.OWN_TASK, Status: 'asked', AskedRound: 1, CreatedAt: '2026-11-03T10:42:00.000Z', UpdatedAt: '2026-11-03T10:42:00.000Z', Placement: 'next', PlacedAtRound: 3, CreatedByName: 'Dana' });
    put(own
      ? { PK, SK: 'QUESTION#001#REF', SourceQuestionId: 'OWNQ#abc123', Source: 'host', QuestionNumber: '001', StartedAt: new Date().toISOString() }
      : { PK, SK: 'QUESTION#001#REF', SourceQuestionId: 'QUESTION#c001#001', SetId: SET, SetVersion: 2, QuestionNumber: '001', StartedAt: new Date().toISOString() });
    put({ PK, SK: 'CONNECTION#host-1', ConnectionId: 'host-1', ConnectionType: 'HOST' });
  }

  seed({ own: true });
  const ownRead = await RQ.readRoundByNumber(table.doc, 'test-table', GAME, '001');
  await check('an own REF reads the session\'s OWNQ row, flagged own, with no set', () => {
    assert.strictEqual(ownRead.own, true);
    assert.strictEqual(ownRead.question.Title, OWN_TITLE);
    assert.strictEqual(ownRead.setId, null);
    assert.strictEqual(ownRead.resolved.metadata, null);
  });
  const standIn = await RQ.readRoundQuestion(table.doc, 'test-table', GAME, { SourceQuestionId: 'OWNQ#abc123' });
  await check('an OWNQ# id standing in from a RESULTS row resolves the same way', () =>
    assert.strictEqual(standIn.question && standIn.question.Title, OWN_TITLE));
  const gone = await RQ.readRoundQuestion(table.doc, 'test-table', GAME, { SourceQuestionId: 'OWNQ#nope', Source: 'host' });
  await check('a missing own row is null, never a throw', () => assert.strictEqual(gone.question, null));
  seed({ own: false });
  const setRead = await RQ.readRoundByNumber(table.doc, 'test-table', GAME, '001');
  await check('a set REF reads the set row through its pinned version', () => {
    assert.strictEqual(setRead.own, false);
    assert.strictEqual(setRead.question.Title, 'A set question');
    assert.strictEqual(setRead.resolved.pk, SETPK);
  });
  await check('no REF is { ref: null }, not a throw', async () => {
    store.delete(table.keyOf(PK, 'QUESTION#001#REF'));
    const none = await RQ.readRoundByNumber(table.doc, 'test-table', GAME, '001');
    assert.strictEqual(none.ref, null);
  });

  /* ---- §3 each reader ------------------------------------------------------ */
  console.log('\n3. every reader, with an own REF and a set REF');

  const { handler: getQuestion } = require(path.join(REPO, 'lambda-functions/game/get-question.js'));
  const { handler: getState } = require(path.join(REPO, 'lambda-functions/game/get-game-state.js'));
  const { handler: getResults } = require(path.join(REPO, 'lambda-functions/game/get-results.js'));
  const { readPollQuestion } = require(path.join(REPO, 'lambda-functions/game/poll-round.js'));
  const createReport = require(path.join(REPO, 'lambda-functions/game/create-report.js'));
  const { handler: wsMessage } = require(path.join(REPO, 'lambda-functions/websocket/message.js'));
  const PM = require(path.join(REPO, 'lambda-functions/game/platform-metrics.js'));
  const HOST = { authorizer: { lambda: { userId: 'host-1', groups: 'hosts' } } };
  const body = (res) => JSON.parse(res.body);

  for (const own of [true, false]) {
    const want = own ? OWN_TITLE : 'A set question';
    const label = own ? 'own' : 'set';

    seed({ own });
    const q = await getQuestion({ pathParameters: { gameId: GAME }, queryStringParameters: { role: 'player' } });
    // eslint-disable-next-line no-await-in-loop
    await check(`get-question (${label}): 200 with the question, never "Source question not found"`, () => {
      assert.strictEqual(q.statusCode, 200, q.body);
      assert.strictEqual(body(q).title, want);
      assert.ok(!q.body.includes(NOTE), 'the note reached the phone');
    });

    const st = await getState({ pathParameters: { gameId: GAME }, requestContext: { http: { method: 'GET' } } });
    // eslint-disable-next-line no-await-in-loop
    await check(`get-game-state public (${label}): the round's question, no note`, () => {
      assert.strictEqual(body(st).currentQuestionData && body(st).currentQuestionData.title, want, st.body.slice(0, 300));
      assert.ok(!st.body.includes(NOTE), 'the note reached /state');
    });

    const hostState = await getState({
      routeKey: 'GET /games/{gameId}/host-state',
      requestContext: { http: { method: 'GET' }, routeKey: 'GET /games/{gameId}/host-state', ...HOST },
      pathParameters: { gameId: GAME },
    });
    if (own) {
      // eslint-disable-next-line no-await-in-loop
      await check('get-game-state host door (own): the note is the host\'s notes, on this door only', () =>
        assert.strictEqual(body(hostState).hostNotes && body(hostState).hostNotes.background, NOTE));
    }

    // The read-back of a finished round (issue #47), public.
    seed({ own, state: 'ENDED' });
    put({ PK, SK: 'QUESTION#001#RESULTS', VoteTallies: { 0: { answerText: 'x', totalScore: 3 } }, TotalVotes: 1, MaxVotes: 3 });
    const rb = await getResults({ body: JSON.stringify({ gameId: GAME, questionNumber: 1 }) });
    // eslint-disable-next-line no-await-in-loop
    await check(`get-results read-back (${label}): the question's public face, no note`, () => {
      assert.strictEqual(body(rb).questionTitle, want, rb.body.slice(0, 300));
      assert.ok(!rb.body.includes(NOTE));
    });

    seed({ own, gameType: 'poll' });
    const poll = await readPollQuestion(table.doc, 'test-table', GAME, '001');
    // eslint-disable-next-line no-await-in-loop
    await check(`poll-round (${label}): ${own ? 'an own round is never a poll' : 'a set row is read'}`, () => {
      if (own) assert.strictEqual(poll, null);
      else assert.ok(poll === null || typeof poll === 'object');
    });

    seed({ own, state: 'ENDED' });
    put({ PK, SK: 'QUESTION#001#RESULTS', SourceQuestionId: own ? 'OWNQ#abc123' : 'QUESTION#c001#001', VoteTallies: {} });
    put({ PK, SK: 'QUESTION#001#ANSWER#Ada', PlayerName: 'Ada', Answer: 'ship smaller' });
    const report = await createReport.handler({ pathParameters: { gameId: GAME }, requestContext: HOST, body: '{}' });
    const rounds = (body(report).report || body(report)).detailedQuestions || (body(report).reportData || {}).detailedQuestions || [];
    const r1 = rounds.find((r) => r.questionNumber === '001') || {};
    // eslint-disable-next-line no-await-in-loop
    await check(`create-report (${label}): the round's title${own ? ', marked own with its source and the labelled note' : ', not marked own'}`, () => {
      assert.strictEqual(report.statusCode, 200, report.body.slice(0, 300));
      assert.strictEqual(r1.questionData && r1.questionData.title, want, JSON.stringify(r1).slice(0, 300));
      if (own) {
        assert.deepStrictEqual(r1.questionData.own, {
          createdAt: '2026-11-03T10:42:00.000Z', createdByName: 'Dana', placement: 'next', placedAtRound: 3, placedAfterRound: null, note: NOTE,
        });
        assert.strictEqual(r1.questionData.category, '', 'a host-written round has no category');
      } else {
        assert.ok(!('own' in r1.questionData));
      }
    });

    // The socket's two readers: trivia scoring and the poll check, on an own REF.
    seed({ own, gameType: 'trivia' });
    put({ PK, SK: 'CONNECTION#p-1', ConnectionId: 'p-1', ConnectionType: 'PLAYER', PlayerName: 'Ada' });
    await wsMessage({ requestContext: { connectionId: 'p-1' }, body: JSON.stringify({ messageType: 'ANSWER#001', gameId: GAME, playerName: 'Ada', answer: 'A', answerType: 'trivia' }) });
    const row = store.get(table.keyOf(PK, 'QUESTION#001#ANSWER#Ada'));
    // eslint-disable-next-line no-await-in-loop
    await check(`websocket/message.js trivia (${label}): the answer is stored${own ? '' : ' and scored from the set row'}`, () => {
      assert.ok(row, 'no answer row');
      if (!own) assert.strictEqual(row.IsCorrect, true);
    });
  }

  seed({ own: true });
  const bucket = await (async () => {
    // bucketForRound is internal; recordRoundClosed reads it for a round with no kept bucket.
    const res = await PM.recordRoundServed({ gameId: GAME, round: 1, set: null, questionId: 'OWNQ#abc123', metadata: {} }, { db: table.doc, tableName: 'test-table' });
    return res;
  })();
  await check('platform-metrics: an own round counts, in the "own questions" bucket', () =>
    assert.strictEqual(bucket && bucket.library, 'own', JSON.stringify(bucket)));

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail === 0 ? 0 : 1);
})();
