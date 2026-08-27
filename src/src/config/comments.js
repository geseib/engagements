/**
 * WHAT A COMMENT IS ATTACHED TO — the anchor vocabulary, shared by the
 * participant's composer, the host's round review, and both reports.
 *
 * The owner asked for section-anchored commenting in these words:
 *
 *   "in fact there should be like in chat response they click on a section
 *    (the summary, the results, a specific user response) and the comments now
 *    can be seen in the resulting round of feedback"
 *
 * So there are exactly three anchors, and the question the round was built on
 * is deliberately not among them: it is the prompt the room was GIVEN, not
 * something the room heard. The set is closed for the same reason `BEATS` in
 * stage-beat.js is closed — an open one fails by writing a row that every
 * reader then quietly ignores, with no error anywhere in the system.
 *
 * ── A RESPONSE ANCHOR IS A POSITION, NEVER A RANK ──────────────────────────
 *
 * `create-report.js` gives equal scores equal ranks (1, 1, 3), so two rows can
 * both print "1". `PastRound.jsx` already closes its spotlight handler over the
 * row's own position `i` rather than the badge for exactly this reason, and
 * says so at length. A comment keyed on the printed number would attach to the
 * first of two tied responses from either row — silently, and only on ties,
 * which is the worst kind of intermittent.
 *
 * ── A COMMENT CARRIES ITS OWN CONTEXT ──────────────────────────────────────
 *
 * `anchorLabel` and `anchorExcerpt` are computed HERE, at write time, and
 * stored on the row. Nothing at read time re-resolves an index back into a
 * response. Two reasons, and the second is the load-bearing one:
 *
 *   1. Position is stable within a stored report, but a report is rebuilt from
 *      raw rows on every open, and an annotation that can be re-pointed is an
 *      annotation that can be re-pointed at the wrong thing.
 *   2. In the SESSION report a comment is read a long way from the round it
 *      belongs to. "Too internal" against nothing is not a comment; against
 *      "Response 3 — Dana Whitfield: Freeze all discretionary discounting…" it
 *      is. The excerpt is what makes the session report readable at all.
 *
 * DUPLICATED SHAPE, NOT DUPLICATED FILE. The backend's SK builder lives in
 * `lambda-functions/game/comment-keys.js` and owns the key format; this module
 * owns the vocabulary and the display strings. They share the three kind names
 * and nothing else, and `tests/round-comments.js` asserts the two lists agree.
 */

/** The closed set. Order is the order a reader meets them in a report. */
export const ANCHOR_KINDS = ['summary', 'results', 'response'];

/**
 * A comment's character ceiling.
 *
 * Long enough for a real remark, short enough that a comment cannot become a
 * second response smuggled into a round that has already been scored and
 * summarised. A feedback round is commentary on the record, not another turn.
 */
export const MAX_COMMENT = 1000;

/** How much of the commented-on material travels with the comment. */
export const MAX_EXCERPT = 140;

/** Is this one of the three? Exact match — no case folding, no coercion. */
export function isAnchorKind(value) {
  return ANCHOR_KINDS.includes(value);
}

/**
 * The ref segment for an anchor, or `null` when the input cannot be one.
 *
 * `summary` and `results` address a whole section, so their ref is empty — the
 * segment still exists in the sort key so that a `begins_with` on the round
 * prefix matches every anchor uniformly.
 *
 * A `response` ref is its decimal position. Refused rather than coerced when it
 * is anything else: `''` would pass a bare presence check, and a value carrying
 * `#` would split the sort key into a shape nothing ever queries again. The
 * same guard, for the same reason, as stage-beat.js:147 and
 * reveal-authors.js:73.
 */
export function normalizeAnchorRef(kind, ref) {
  if (!isAnchorKind(kind)) return null;
  if (kind !== 'response') return '';

  // Number() would take '', ' ' and '\n' to 0 and hand back a valid-looking
  // position for input that named nothing. Test the STRING, then convert.
  const raw = String(ref ?? '').trim();
  if (!/^\d+$/.test(raw)) return null;
  return String(Number(raw));
}

/**
 * The human name for an anchor, computed once at write time.
 *
 * `answers` is optional on purpose: a caller that does not have the round to
 * hand still gets a usable label rather than a throw, because the label's job
 * is to keep the comment readable and a missing author is a normal state, not
 * an error.
 *
 * The author is appended only when the row actually carries one. On a round the
 * server redacted, `playerName` is ABSENT rather than null
 * (create-report.js:344-354, and `game/anonymity.js` deletes rather than nulls
 * so that a client which forgets to handle anonymity renders nothing instead of
 * the string "null"). Appending an em dash with nothing after it would turn
 * that careful omission into visible damage.
 */
export function anchorLabelFor(anchor, context = {}) {
  const kind = anchor && anchor.anchorKind;
  if (kind === 'summary') return 'AI summary';
  if (kind === 'results') return 'Results';
  if (kind !== 'response') return '';

  const position = Number(normalizeAnchorRef('response', anchor.anchorRef));
  if (!Number.isInteger(position)) return '';

  const answers = Array.isArray(context.answers) ? context.answers : [];
  const row = answers[position];
  const who = row && (row.playerName || row.name);
  const ordinal = `Response ${position + 1}`;
  return who ? `${ordinal} — ${who}` : ordinal;
}

/**
 * The slice of the commented-on material that travels with the comment.
 *
 * Whitespace is collapsed first: the source is a participant's own prose, often
 * pasted, and a preserved run of newlines inside a one-line label is a wall
 * rather than an excerpt.
 *
 * The ellipsis is not decoration. A reduction with no recovery is a deletion,
 * and the recovery here is the anchor itself — so the excerpt is allowed to cut
 * only because it SAYS it cut, and the anchor says where to read the rest.
 */
export function excerptOf(text, max = MAX_EXCERPT) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max)}…`;
}
