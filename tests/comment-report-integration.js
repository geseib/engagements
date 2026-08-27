/**
 * COMMENTS REACH BOTH REPORTS.
 *
 * The owner: *"these will get added to the round report and the over all report
 * as well. clearly called out as comments."*
 *
 * There is only one builder. A round report IS `detailedQuestions[i]` and the
 * session report is the object wrapping the array, so one change in
 * `create-report.js` serves both — which is why this file asserts against that
 * one output and both requirements are covered.
 *
 * ── HOW THE EXPECTATIONS ARE BUILT ─────────────────────────────────────────
 *
 * By hand, from the fixture rows, and never by re-reading the handler's own
 * output. Two rounds with DIFFERENT, ASYMMETRIC comment counts, because the
 * failure this is really guarding against is a cross-wire: comments landing on
 * the wrong round would pass any assertion that only counted the total, and
 * would pass a symmetric fixture too.
 */
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');

// ---- Stubs -----------------------------------------------------------------
class PutCommand { constructor(i) { this.input = i; this.type = 'put'; } }
class GetCommand { constructor(i) { this.input = i; this.type = 'get'; } }
class QueryCommand { constructor(i) { this.input = i; this.type = 'query'; } }
class DeleteCommand { constructor(i) { this.input = i; this.type = 'delete'; } }
class UpdateCommand { constructor(i) { this.input = i; this.type = 'update'; } }

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
stub('@aws-sdk/client-s3', { S3Client: class {}, PutObjectCommand: class {} });

process.env.TABLE_NAME = 'test-table';

const { handler } = require(path.join(REPO, 'lambda-functions/game/create-report.js'));

let pass = 0, fail = 0;
function check(label, fn) {
  try { fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const put = (item) => store.set(key(item.PK, item.SK), item);

const GAME = '5001';

/**
 * A session with two finished rounds and ASYMMETRIC comment counts:
 * round 1 gets THREE, round 2 gets ONE. Written out here so the expectations
 * below can be stated as literals.
 */
function seed() {
  store.clear();
  put({
    PK: `GAME#${GAME}`, SK: 'METADATA',
    GameType: 'call-and-answer', Title: 'Q3 offsite', HostName: 'Dana',
    QuestionSetId: 'none', Visibility: 'public',
  });
  put({ PK: `GAME#${GAME}`, SK: 'STATE', State: 'RESULTS#002', LessonNumber: 2 });

  for (const n of ['001', '002']) {
    put({ PK: `GAME#${GAME}`, SK: `ROUND#${n}`, QuestionNumber: n, AuthorsRevealed: true });
    put({
      PK: `GAME#${GAME}`, SK: `QUESTION#${n}#RESULTS`,
      QuestionId: n, Winners: ['Ada'], VoteTallies: {}, MaxVotes: 1, TotalVotes: 1,
    });
    put({
      PK: `GAME#${GAME}`, SK: `QUESTION#${n}#ANSWER#Ada`,
      PlayerName: 'Ada', QuestionNumber: n, Answer: `Answer to round ${n}`,
    });
  }
  put({ PK: `GAME#${GAME}`, SK: 'PLAYER#Ada', PlayerName: 'Ada', playerId: 'p1' });
  put({ PK: `GAME#${GAME}`, SK: 'PLAYER#Ada#SCORE', PlayerName: 'Ada', score: 3 });

  // Round 1: three comments, one per anchor kind.
  comment('001', 'summary', '', '000000000000001-a', 'The summary misses the customer.');
  comment('001', 'results', '', '000000000000002-a', 'Two of these are the same move.');
  comment('001', 'response', '0', '000000000000003-a', 'This is the only concrete one.');
  // Round 2: exactly one.
  comment('002', 'summary', '', '000000000000004-a', 'Sharper than the last one.');
}

function comment(round, kind, ref, id, text) {
  put({
    PK: `GAME#${GAME}`,
    SK: `COMMENT#${round}#${kind}#${ref}#${id}`,
    GameId: GAME,
    QuestionNumber: round,
    AnchorKind: kind,
    AnchorRef: ref,
    AnchorLabel: kind === 'response' ? 'Response 1 — Ada' : (kind === 'summary' ? 'AI summary' : 'Results'),
    AnchorExcerpt: `excerpt for ${round}/${kind}`,
    Text: text,
    playerName: 'Ada',
    name: 'Ada',
    SubmittedAt: '2026-08-27T10:00:00.000Z',
  });
}

const build = () => handler({
  requestContext: { http: { method: 'POST' } },
  pathParameters: { gameId: GAME },
  body: JSON.stringify({}),
});

(async () => {
  console.log('\n1. comments land on the round named by their sort key');
  seed();
  const res = await build();
  const payload = JSON.parse(res.body);

  check('the report builds', () =>
    assert.strictEqual(res.statusCode, 200, `got ${res.statusCode}: ${res.body}`));

  const report = payload.report;
  const roundOf = (n) => (report.detailedQuestions || []).find((q) => q.questionNumber === n);

  check('both rounds are in the report', () => {
    assert.ok(roundOf('001'), 'round 001 missing');
    assert.ok(roundOf('002'), 'round 002 missing');
  });

  check('round 1 carries exactly its three comments', () => {
    // Three, not four. A cross-wire that put every comment on every round would
    // report four here and pass a total-only assertion.
    assert.strictEqual((roundOf('001').comments || []).length, 3,
      `round 1 has ${(roundOf('001').comments || []).length}`);
  });

  check('round 2 carries exactly its one', () => {
    assert.strictEqual((roundOf('002').comments || []).length, 1,
      `round 2 has ${(roundOf('002').comments || []).length}`);
  });

  check("round 2's comment is round 2's, not a copy of round 1's", () => {
    // The asymmetric fixture's real payoff: identity, not just arity.
    assert.strictEqual(roundOf('002').comments[0].text, 'Sharper than the last one.');
  });

  console.log('\n2. each comment carries what a reader needs');

  check('the anchor, the label and the excerpt all survive', () => {
    const onResponse = roundOf('001').comments.find((c) => c.anchorKind === 'response');
    assert.ok(onResponse, 'the response comment is missing');
    assert.strictEqual(onResponse.anchorRef, '0');
    assert.strictEqual(onResponse.anchorLabel, 'Response 1 — Ada');
    assert.strictEqual(onResponse.anchorExcerpt, 'excerpt for 001/response');
    assert.strictEqual(onResponse.text, 'This is the only concrete one.');
    assert.strictEqual(onResponse.playerName, 'Ada');
  });

  check('all three anchor kinds arrive', () => {
    const kinds = roundOf('001').comments.map((c) => c.anchorKind).sort();
    assert.deepStrictEqual(kinds, ['response', 'results', 'summary']);
  });

  check('they are ordered the way they were written', () => {
    const texts = roundOf('001').comments.map((c) => c.text);
    assert.deepStrictEqual(texts, [
      'The summary misses the customer.',
      'Two of these are the same move.',
      'This is the only concrete one.',
    ]);
  });

  console.log('\n3. the session report counts them');

  check('gameStats carries the session total', () => {
    // Four, computed by hand from the fixture: 3 + 1.
    assert.strictEqual(report.gameStats.totalComments, 4,
      `totalComments was ${report.gameStats.totalComments}`);
  });

  check('and the counts that were already there are unchanged', () => {
    // Adding a query must not have moved anything else. One player, two rounds.
    assert.strictEqual(report.gameStats.totalPlayers, 1);
    assert.strictEqual(report.gameStats.totalQuestions, 2);
  });

  console.log('\n4. a round that has only comments still appears');

  store.clear();
  seed();
  // Round 3 has a comment and nothing else — no vote, no results row, no AI
  // summary. `questionNumbers` is votes ∪ results ∪ summaries, so without
  // comments as a fourth source this round vanishes from the report and takes
  // its comments with it, silently. That is reachable in practice: the raw
  // vote and results rows are 7 days and the comment row is 30.
  put({ PK: `GAME#${GAME}`, SK: 'ROUND#003', QuestionNumber: '003', AuthorsRevealed: true });
  comment('003', 'summary', '', '000000000000009-a', 'Orphaned but not lost.');
  const withOrphan = JSON.parse((await build()).body).report;

  check('round 3 is in the report at all', () => {
    const r = (withOrphan.detailedQuestions || []).find((q) => q.questionNumber === '003');
    assert.ok(r, 'a round whose only artefact is a comment was dropped from the report');
    assert.strictEqual((r.comments || []).length, 1);
    assert.strictEqual(r.comments[0].text, 'Orphaned but not lost.');
  });

  check('and the session total counts it', () =>
    assert.strictEqual(withOrphan.gameStats.totalComments, 5,
      `totalComments was ${withOrphan.gameStats.totalComments}`));

  console.log('\n5. a session with no comments is unchanged');

  store.clear();
  seed();
  for (const k of [...store.keys()]) if (k.includes('|COMMENT#')) store.delete(k);
  const bare = JSON.parse((await build()).body).report;

  check('every round reports an empty list, never undefined', () => {
    // A renderer that has to distinguish "no comments" from "the field is
    // missing" will get it wrong somewhere. One shape, always.
    for (const q of bare.detailedQuestions) {
      assert.ok(Array.isArray(q.comments), `round ${q.questionNumber} has ${typeof q.comments}`);
      assert.strictEqual(q.comments.length, 0);
    }
  });

  check('and the total is zero rather than absent', () =>
    assert.strictEqual(bare.gameStats.totalComments, 0));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
