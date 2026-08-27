/**
 * THE COMMENT SORT KEY — the one thing that decides which reads are possible.
 *
 * A comment lives in the session's own partition, beside the answers, the votes
 * and the round records:
 *
 *     PK  GAME#{gameId}
 *     SK  COMMENT#{nnn}#{anchorKind}#{anchorRef}#{commentId}
 *
 * Three reads have to work off that one key with `begins_with` and no GSI:
 * everything on one anchor, everything in one round, and everything in the
 * session for the report. The tests below pin the format against
 * INDEPENDENTLY CONSTRUCTED strings — never against another call of the same
 * builder, which would only prove the builder agrees with itself.
 *
 * The two guards are the ones stage-beat.js:147 and reveal-authors.js:73
 * already apply, for the reason they record: a segment that is not what it
 * claims to be writes a row into the game's partition that nothing will ever
 * read again, and nothing errors.
 */
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const {
  commentSk, commentPrefix, newCommentId, parseCommentSk, ANCHOR_KINDS,
} = require(path.join(REPO, 'lambda-functions/game/comment-keys.js'));

let pass = 0, fail = 0;
function check(label, fn) {
  try { fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

// ---- The format ------------------------------------------------------------

check('an SK is round, kind, ref and id, in that order', () => {
  // The expected string is written out by hand. Comparing against another
  // commentSk() call would pass for any consistent-but-wrong format.
  assert.strictEqual(
    commentSk({ questionNumber: '003', anchorKind: 'response', anchorRef: '2', commentId: 'abc123' }),
    'COMMENT#003#response#2#abc123');
});

check('summary and results keep an empty ref segment', () => {
  // The segment stays so that every anchor has the same number of segments and
  // one begins_with on the round prefix matches all three kinds uniformly.
  assert.strictEqual(
    commentSk({ questionNumber: '007', anchorKind: 'summary', anchorRef: '', commentId: 'z9' }),
    'COMMENT#007#summary##z9');
  assert.strictEqual(
    commentSk({ questionNumber: '007', anchorKind: 'results', anchorRef: '', commentId: 'z9' }),
    'COMMENT#007#results##z9');
});

// ---- The three reads -------------------------------------------------------

check('the anchor prefix selects one section of one round', () => {
  assert.strictEqual(
    commentPrefix({ questionNumber: '003', anchorKind: 'response', anchorRef: '2' }),
    'COMMENT#003#response#2#');
});

check('the round prefix selects every anchor in that round', () => {
  assert.strictEqual(commentPrefix({ questionNumber: '003' }), 'COMMENT#003#');
});

check('the session prefix selects every comment in the game', () => {
  assert.strictEqual(commentPrefix({}), 'COMMENT#');
});

check('the round prefix does not leak across rounds', () => {
  // '003' must not match round 30 or round 31. This is why the prefix carries
  // its own trailing '#' and why the round number is padded.
  const round30 = commentSk({ questionNumber: '030', anchorKind: 'summary', anchorRef: '', commentId: 'x' });
  assert.ok(!round30.startsWith(commentPrefix({ questionNumber: '003' })),
    `round 30's key ${round30} matched round 3's prefix`);
});

check('an anchor prefix does not leak across positions', () => {
  // 'response#1#' must not match response 10. Same trailing-'#' reasoning.
  const tenth = commentSk({ questionNumber: '003', anchorKind: 'response', anchorRef: '10', commentId: 'x' });
  assert.ok(!tenth.startsWith(commentPrefix({ questionNumber: '003', anchorKind: 'response', anchorRef: '1' })),
    `response 10's key ${tenth} matched response 1's prefix`);
});

// ---- The guards ------------------------------------------------------------

check('an unpadded round number is refused, so 3 and 003 cannot both exist', () => {
  assert.strictEqual(
    commentSk({ questionNumber: '3', anchorKind: 'summary', anchorRef: '', commentId: 'x' }), null);
});

check('a non-numeric round number is refused', () => {
  assert.strictEqual(
    commentSk({ questionNumber: 'abc', anchorKind: 'summary', anchorRef: '', commentId: 'x' }), null);
  assert.strictEqual(
    commentSk({ questionNumber: '', anchorKind: 'summary', anchorRef: '', commentId: 'x' }), null);
});

check('an anchor kind outside the closed set is refused', () => {
  assert.strictEqual(
    commentSk({ questionNumber: '003', anchorKind: 'question', anchorRef: '', commentId: 'x' }), null);
});

check('a ref carrying a separator is refused, so the key cannot be split', () => {
  assert.strictEqual(
    commentSk({ questionNumber: '003', anchorKind: 'response', anchorRef: '1#2', commentId: 'x' }), null);
});

check('an id carrying a separator is refused, for the same reason', () => {
  assert.strictEqual(
    commentSk({ questionNumber: '003', anchorKind: 'response', anchorRef: '1', commentId: 'a#b' }), null);
});

check('a response anchor requires a position', () => {
  assert.strictEqual(
    commentSk({ questionNumber: '003', anchorKind: 'response', anchorRef: '', commentId: 'x' }), null);
});

// ---- Ordering --------------------------------------------------------------

check('ids sort by time, so a begins_with returns writing order', () => {
  // Lexicographic order is what DynamoDB returns; the id is built so that it
  // agrees with chronological order for every timestamp this product will see.
  const earlier = newCommentId(1_700_000_000_000, 'aaaaaa');
  const later = newCommentId(1_700_000_001_000, 'aaaaaa');
  assert.ok(earlier < later, `${earlier} should sort before ${later}`);
});

check('ids are zero-padded, so a shorter number cannot sort after a longer one', () => {
  // Without padding '9' > '10' lexicographically and the order silently
  // inverts around every power of ten.
  const small = newCommentId(1, 'aaaaaa');
  const big = newCommentId(1_700_000_000_000, 'aaaaaa');
  assert.ok(small < big, `${small} should sort before ${big}`);
  assert.strictEqual(small.split('-')[0].length, big.split('-')[0].length);
});

check('two ids in the same millisecond differ', () => {
  assert.notStrictEqual(newCommentId(1000, 'aaaaaa'), newCommentId(1000, 'bbbbbb'));
});

check('a generated id survives its own key builder', () => {
  const id = newCommentId(Date.now(), 'ab12cd');
  assert.ok(commentSk({ questionNumber: '003', anchorKind: 'summary', anchorRef: '', commentId: id }));
});

// ---- Round-tripping --------------------------------------------------------

check('an SK parses back into the parts it was built from', () => {
  // The expected object is written out by hand, not read off the input.
  assert.deepStrictEqual(
    parseCommentSk('COMMENT#003#response#2#abc123'),
    { questionNumber: '003', anchorKind: 'response', anchorRef: '2', commentId: 'abc123' });
});

check('an empty ref parses back as an empty ref, not as undefined', () => {
  assert.deepStrictEqual(
    parseCommentSk('COMMENT#012#summary##z9'),
    { questionNumber: '012', anchorKind: 'summary', anchorRef: '', commentId: 'z9' });
});

check('a foreign SK parses to null rather than to a plausible-looking object', () => {
  // These are the neighbours in the same partition. A parser that returned a
  // half-filled object for one of them would file an answer as a comment.
  assert.strictEqual(parseCommentSk('QUESTION#003#ANSWER#Ada'), null);
  assert.strictEqual(parseCommentSk('ROUND#003'), null);
  assert.strictEqual(parseCommentSk('PLAYER#Ada#SCORE'), null);
  assert.strictEqual(parseCommentSk('REPORT'), null);
  assert.strictEqual(parseCommentSk('COMMENT#003#summary'), null);
  assert.strictEqual(parseCommentSk(''), null);
  assert.strictEqual(parseCommentSk(null), null);
});

// ---- The two vocabularies agree -------------------------------------------

check('the backend and frontend anchor lists are the same three, in the same order', () => {
  const fs = require('fs');
  const mirror = fs.readFileSync(path.join(REPO, 'src/src/config/comments.js'), 'utf8');
  const declared = /ANCHOR_KINDS\s*=\s*\[([^\]]*)\]/.exec(mirror)[1]
    .split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
  assert.deepStrictEqual(declared, ['summary', 'results', 'response']);
  assert.deepStrictEqual(ANCHOR_KINDS, ['summary', 'results', 'response']);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
