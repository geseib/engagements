/**
 * WHOSE SET IS THIS? — one word, on every row.
 *
 * The owner asked for it in those terms: *"if we create question sets they need
 * to be tagged by the owner the tag maybe 'yours' teams engage or public"*.
 *
 * ── THIS REVERSES A DELIBERATE CHOICE, SO IT IS WORTH SAYING WHY ───────────
 *
 * QuestionSetsPanel badged only the rows that were NOT the reader's own, and
 * the comment there argued the case: *"the common case is the quiet one, or
 * every row shouts and none of them reads."* That argument is right about
 * ALARMS and wrong about this, and the difference is what changed: badging the
 * exceptions makes the chip a warning, so an unbadged row means "no warning" —
 * which is not the same as "yours", and cannot be told apart from a row whose
 * badge simply failed to render.
 *
 * Tagging every row turns the chip into a COLUMN. A column of four possible
 * values, always present, is read once and then scanned; it is quieter in
 * practice than three exceptions against an unexplained default. What must not
 * happen is four colours — see `tone` below.
 *
 * ── THE ANSWER IS ALREADY IN THE PAYLOAD ──────────────────────────────────
 *
 * No backend change was needed for any of this. `admin/get-question-sets.js`
 * projects `scope` (which library) and `mine` (`isSetOwner` — "I created this",
 * deliberately NOT the same question as `canManage`, which an org admin also
 * passes on somebody else's set). Those two fields are exactly the four cases.
 */

/** `platform` — Engage's shared library, readable by every organisation. */
export const ENGAGE = 'engage';
/** `public` — published by another organisation for everyone. */
export const PUBLIC = 'public';
/** This org's, and I made it. */
export const YOURS = 'yours';
/** This org's, and a colleague made it. */
export const TEAM = 'team';

const LABELS = {
  [YOURS]: 'Yours',
  [TEAM]: 'Team',
  [ENGAGE]: 'Engage',
  [PUBLIC]: 'Public',
};

const TITLES = {
  [YOURS]: 'You created this. You can edit or delete it.',
  [TEAM]: 'Someone else in your organisation created this.',
  [ENGAGE]: 'Managed by Engage and shared with every organisation. Copy it to make changes.',
  [PUBLIC]: 'Published by another organisation. Copy it to make changes.',
};

/**
 * Which of the four a row is.
 *
 * A row with no scope is a PLATFORM row: that is what every set that predates
 * tenancy is, and what `create-game.js` already means by a payload that names
 * no scope. Guessing "yours" for an unscoped row would be the dangerous
 * direction — it would tell somebody they may edit Engage's library.
 */
export function setOwnerTag(set) {
  const scope = (set && typeof set.scope === 'string' && set.scope.trim()) || 'platform';
  if (scope === 'public') return PUBLIC;
  if (scope !== 'org') return ENGAGE;
  return set && set.mine ? YOURS : TEAM;
}

/** The word on the chip. */
export const setOwnerLabel = (set) => LABELS[setOwnerTag(set)];

/** What the chip says on hover — the CONSEQUENCE, not a restatement of the word. */
export const setOwnerTitle = (set) => TITLES[setOwnerTag(set)];

/**
 * The chip's tone, and there are only two on purpose.
 *
 * Four colours would be a legend to memorise on a screen that is mostly a list.
 * The only distinction that changes what you can DO is whether the row is
 * yours-or-your-org's (editable) or somebody else's (copy first) — so that is
 * the only distinction the colour carries. The WORD says which of the four.
 */
export const setOwnerIsOurs = (set) => {
  const tag = setOwnerTag(set);
  return tag === YOURS || tag === TEAM;
};

export default { setOwnerTag, setOwnerLabel, setOwnerTitle, setOwnerIsOurs };
