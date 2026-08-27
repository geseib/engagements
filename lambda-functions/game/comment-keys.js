/**
 * THE COMMENT SORT KEY, and nothing else.
 *
 * Separate from the handler on purpose: the key format is the one part of this
 * feature that decides which reads are possible for the life of the data, and
 * it is worth being able to test it without stubbing DynamoDB, KMS and the API
 * Gateway Management API to do it.
 *
 *     PK  GAME#{gameId}
 *     SK  COMMENT#{nnn}#{anchorKind}#{anchorRef}#{commentId}
 *
 * ── WHY THIS SHAPE ─────────────────────────────────────────────────────────
 *
 * Three reads have to work off one key with `begins_with` and no GSI:
 *
 *     COMMENT#003#response#2#   one section of one round  (the composer)
 *     COMMENT#003#              one round                 (the round report)
 *     COMMENT#                  the whole session         (create-report.js)
 *
 * The round number comes FIRST, before the anchor, because the round is the
 * grouping every reader wants and DynamoDB can only prefix-match from the left.
 * Putting the anchor first would make "every comment on round 3" a scan.
 *
 * EVERY PREFIX CARRIES ITS OWN TRAILING '#'. Without it `COMMENT#003#` also
 * matches round 30 and round 31, and `response#1#` also matches response 10 —
 * the classic prefix bug, which shows up only once a session runs past ten of
 * anything and is therefore never seen in testing.
 *
 * THE REF SEGMENT IS PRESENT EVEN WHEN EMPTY (`COMMENT#007#summary##z9`), so
 * every anchor kind has the same number of segments. A parser that had to cope
 * with four segments sometimes and five other times is a parser that will
 * eventually file an answer as a comment.
 *
 * ── WHY EVERY BUILDER RETURNS null RATHER THAN THROWING ────────────────────
 *
 * A malformed segment must never reach the table. `stage-beat.js:147` and
 * `reveal-authors.js:73` already refuse a non-numeric round number before
 * padding it, and record the reason: `''` passes a bare presence check and pads
 * to `'000'`, and any other junk writes a row into the game's partition that
 * nothing will ever read again — with no error anywhere in the system. The same
 * hazard applies to every segment here, so every segment is checked. `null` is
 * returned rather than thrown so the handler can answer 400 with a message,
 * which is the only place a refusal can still tell somebody.
 *
 * `ANCHOR_KINDS` is duplicated in `src/src/config/comments.js` for the reason
 * `round-kinds.js` and `game-types.js` are duplicated: Lambda bundles are
 * per-directory, there are no layers, and a require() that resolves in the
 * frontend build and not in the bundle is worse than a three-element list
 * written twice. `tests/comment-keys.js` asserts the two agree.
 */

/** The closed set. Mirrors `ANCHOR_KINDS` in src/src/config/comments.js. */
const ANCHOR_KINDS = ['summary', 'results', 'response'];

/**
 * A comment's character ceiling. Mirrors `MAX_COMMENT` in
 * src/src/config/comments.js, which is where the reasoning lives: long enough
 * for a real remark, short enough that a comment cannot become a second
 * response smuggled into a round that has already been scored and summarised.
 *
 * Enforced HERE as well as in the composer, because the composer is a text area
 * on somebody's phone and the route is public.
 */
const MAX_COMMENT = 1000;

/** The stored excerpt's ceiling, mirroring `MAX_EXCERPT`. Enforced for the same
 *  reason: a client could otherwise attach an arbitrarily long "excerpt". */
const MAX_EXCERPT = 140;

/**
 * How many digits the timestamp half of an id is padded to.
 *
 * DynamoDB returns a `begins_with` query in LEXICOGRAPHIC sort-key order, and
 * unpadded decimal does not agree with chronological order: '9' sorts after
 * '10'. 15 digits holds every millisecond timestamp until the year 33658, so
 * the two orders agree for the life of the data and a round's comments come
 * back in the order they were written without a sort at the call site.
 */
const ID_TIME_DIGITS = 15;

/** A segment that cannot corrupt the key: no separator, and not empty. */
function isCleanSegment(value) {
  const raw = String(value ?? '');
  return raw.length > 0 && !raw.includes('#');
}

/** The padded round number, or null. Padded, never padding — see the header. */
function roundSegment(questionNumber) {
  const raw = String(questionNumber ?? '').trim();
  // Exactly three digits. An unpadded '3' is refused rather than padded here so
  // that there is precisely one spelling of round three in the table; a builder
  // that padded would happily create both COMMENT#3#… and COMMENT#003#… from
  // two call sites and only one of them would ever be found again.
  return /^\d{3,}$/.test(raw) ? raw : null;
}

/** The ref segment for an anchor, or null when the pair cannot be one. */
function refSegment(anchorKind, anchorRef) {
  if (!ANCHOR_KINDS.includes(anchorKind)) return null;
  if (anchorKind !== 'response') return '';
  const raw = String(anchorRef ?? '').trim();
  return /^\d+$/.test(raw) ? String(Number(raw)) : null;
}

/**
 * The full sort key for one comment, or null when any part is unusable.
 */
function commentSk({ questionNumber, anchorKind, anchorRef, commentId } = {}) {
  const round = roundSegment(questionNumber);
  if (round === null) return null;

  const ref = refSegment(anchorKind, anchorRef);
  if (ref === null) return null;

  if (!isCleanSegment(commentId)) return null;

  return `COMMENT#${round}#${anchorKind}#${ref}#${commentId}`;
}

/**
 * A `begins_with` prefix, narrowing as more is supplied.
 *
 * Called with nothing it returns the session-wide prefix, which is what
 * `create-report.js` wants: one query for every comment in the game.
 */
function commentPrefix({ questionNumber, anchorKind, anchorRef } = {}) {
  if (questionNumber === undefined || questionNumber === null) return 'COMMENT#';

  const round = roundSegment(questionNumber);
  if (round === null) return null;
  if (anchorKind === undefined || anchorKind === null) return `COMMENT#${round}#`;

  const ref = refSegment(anchorKind, anchorRef);
  if (ref === null) return null;
  return `COMMENT#${round}#${anchorKind}#${ref}#`;
}

/**
 * A strictly increasing millisecond clock, for the life of this container.
 *
 * `Date.now()` alone is NOT enough to order comments, and the gap is not
 * theoretical — it showed up the first time two comments were written back to
 * back. Two writes inside one millisecond get the same timestamp, and the
 * tiebreaker then becomes the RANDOM half of the id, so the two come back in an
 * order decided by `crypto.randomBytes`. Stable once written, but not the order
 * they were written in, which is the order a reader is entitled to.
 *
 * So the clock never returns the same value twice: if the wall clock has not
 * advanced, it moves on by one millisecond of its own. Two consequences worth
 * being explicit about:
 *
 *   - WITHIN one container this is a total order, which covers every sequential
 *     write — a participant posting twice, and the tests.
 *   - ACROSS containers it degrades to the wall clock, which is the right
 *     answer: two people in different Lambda invocations who commented in the
 *     same millisecond have no true order, and inventing one would be a lie
 *     rather than a fix.
 *
 * The drift is bounded by the number of writes a warm container serves in a
 * millisecond, so it is measured in milliseconds and never compounds.
 */
let lastIssued = 0;
function monotonicNow(now = Date.now()) {
  const wall = Math.floor(Number(now) || 0);
  lastIssued = wall > lastIssued ? wall : lastIssued + 1;
  return lastIssued;
}

/**
 * A time-ordered, collision-resistant id.
 *
 * `now` and `rand` are parameters rather than read from `Date.now()` and
 * `crypto` inside, so the ordering guarantee above can be tested at fixed
 * timestamps instead of by sleeping. Callers that need insertion order pass
 * `monotonicNow()`; the random half is for collision resistance across
 * containers, never for ordering.
 */
function newCommentId(now, rand) {
  const stamp = String(Math.max(0, Math.floor(Number(now) || 0))).padStart(ID_TIME_DIGITS, '0');
  const suffix = String(rand ?? '').replace(/[^a-z0-9]/gi, '').slice(0, 12) || '000000';
  return `${stamp}-${suffix}`;
}

/**
 * The parts an SK was built from, or null when it is not a comment key.
 *
 * Returns null rather than a half-filled object for the neighbouring keys in
 * the same partition (`QUESTION#…`, `ROUND#…`, `PLAYER#…`, `REPORT`), because a
 * parser that guesses would let an answer be counted as a comment in the
 * report — a wrong number that looks entirely plausible.
 */
function parseCommentSk(sk) {
  const raw = String(sk ?? '');
  const parts = raw.split('#');
  // COMMENT, round, kind, ref, id — five, always, including the empty ref.
  if (parts.length !== 5) return null;
  const [tag, questionNumber, anchorKind, anchorRef, commentId] = parts;
  if (tag !== 'COMMENT') return null;
  if (roundSegment(questionNumber) === null) return null;
  if (refSegment(anchorKind, anchorRef) === null) return null;
  if (!isCleanSegment(commentId)) return null;
  return { questionNumber, anchorKind, anchorRef, commentId };
}

module.exports = {
  ANCHOR_KINDS,
  MAX_COMMENT,
  MAX_EXCERPT,
  ID_TIME_DIGITS,
  commentSk,
  commentPrefix,
  newCommentId,
  monotonicNow,
  parseCommentSk,
};
