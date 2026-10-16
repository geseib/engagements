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

module.exports = { REVIEW_LABELS, REVIEW_STATES, reviewedOf, reviewLabel };
