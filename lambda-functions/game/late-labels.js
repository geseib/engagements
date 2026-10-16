/**
 * THE REVIEW LABELS, in the owner's words (14 Oct; session flow v3 §4.4).
 *
 * Every late item (a late round answer, a late answer to a question for the
 * room, a comment added after its round) carries `Reviewed`:
 *
 *   null     "Not reviewed"            nobody has looked at it yet
 *   'read'   "Reviewed by the host"    the host pressed "Mark reviewed"
 *   'shown'  "Reviewed with the room"  the host put it on the wall
 *
 * Shown to the host and in the report only, never on a phone or the wall
 * (owner, Q14). One place, so the late list and the report cannot drift.
 */
const REVIEW_LABELS = Object.freeze({
  none: 'Not reviewed',
  read: 'Reviewed by the host',
  shown: 'Reviewed with the room',
});

const REVIEW_STATES = Object.freeze(['shown', 'read']);

/** A row's `Reviewed` as the wire carries it: 'shown' | 'read' | null. */
const reviewedOf = (row) => (row && REVIEW_STATES.includes(row.Reviewed) ? row.Reviewed : null);

/** The label for a `Reviewed` value; anything unknown is "Not reviewed". */
const reviewLabel = (reviewed) => REVIEW_LABELS[REVIEW_STATES.includes(reviewed) ? reviewed : 'none'];

/**
 * The report's one line when "Include items not reviewed" is off (spec §4.5,
 * in the owner's words): "2 comments not reviewed are left out of this
 * report, at the host's choice." "answers" when every one left out is an
 * answer (a late round answer or a late answer to a question for the room),
 * "items" when comments and answers are mixed. '' when nothing was left out.
 */
function leftOutLine({ comments = 0, answers = 0 } = {}) {
  const c = Number(comments) || 0;
  const a = Number(answers) || 0;
  const n = c + a;
  if (!n) return '';
  const noun = !a ? ['comment', 'comments'] : (!c ? ['answer', 'answers'] : ['item', 'items']);
  return `${n} ${n === 1 ? noun[0] : noun[1]} not reviewed ${n === 1 ? 'is' : 'are'} left out of this report, at the host's choice.`;
}

/** Workie's read after a Redo that included late answers (owner, Q5). */
const lateIncludedLine = (n) => `Includes ${n} ${Number(n) === 1 ? 'answer' : 'answers'} that arrived late.`;
/** That line, as a whole line of the stored markdown. */
const LATE_INCLUDED_LINE = /^\s*Includes \d+ answers? that arrived late\.\s*$/;

/**
 * The read without that line: it is a note to the host about the read, not
 * something the read found, so it never grounds a follow-up suggestion
 * (followup-asks.js). The frontend's readLinesOf leaves it out the same way.
 */
const withoutLateIncludedLine = (markdown) => String(markdown || '')
  .split(/\r?\n/)
  .filter((line) => !LATE_INCLUDED_LINE.test(line))
  .join('\n')
  .trimEnd();

module.exports = {
  REVIEW_LABELS, REVIEW_STATES, reviewedOf, reviewLabel, leftOutLine, lateIncludedLine,
  LATE_INCLUDED_LINE, withoutLateIncludedLine,
};
