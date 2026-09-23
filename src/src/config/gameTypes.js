/**
 * Single source of truth for the five engagement types.
 *
 * The codebase carries two spellings of the same type — `call-and-answer` (UI /
 * question sets) and `callandanswer` (AI-prompt storage key) — plus legacy rows
 * with no type at all. `gameTypeMeta()` normalises all of that so a display
 * surface never has to re-derive a label, an icon, or a phase list.
 *
 * `icon` names must exist in components/Icon.jsx.
 */
export const GAME_TYPES = {
  'call-and-answer': {
    id: 'call-and-answer',
    label: 'Call & Answer',
    short: 'Call & Answer',
    icon: 'ChatCircleText',
    accent: 'var(--secondary)',
    // free-text responses, then the room votes on them
    phases: ['ASK', 'VOTE', 'RESULTS'],
    blurb: 'Open responses, then the room votes on the best ones.',
    answerType: 'text',
    // What one unit of play is called on screen. See resolveRoundNoun() in
    // config/instructions.js — art rounds override this by carrying an image.
    roundNoun: 'Round',
  },
  trivia: {
    id: 'trivia',
    label: 'Trivia',
    short: 'Trivia',
    icon: 'Brain',
    accent: 'var(--primary)',
    phases: ['ASK', 'RESULTS'],
    blurb: 'Multiple choice with one correct answer and a scoreboard.',
    answerType: 'trivia',
    roundNoun: 'Question',
  },
  poll: {
    id: 'poll',
    label: 'Poll',
    short: 'Poll',
    icon: 'ChartBar',
    accent: 'var(--secondary)',
    phases: ['ASK', 'VOTE', 'RESULTS'],
    blurb: 'Gauge opinion — no right answer, distribution is the result.',
    answerType: 'text',
    roundNoun: 'Poll',
  },
  wavelength: {
    id: 'wavelength',
    label: 'Wavelength',
    short: 'Wavelength',
    icon: 'Waves',
    accent: 'var(--secondary)',
    // No VOTE. handleFinishQuestion() in GameHostPage special-cases trivia and
    // wavelength straight to results; the word cloud IS the result, there is
    // nothing to vote on. This table used to claim a vote phase that never ran.
    phases: ['ASK', 'RESULTS'],
    // The group-size caveat is the spec's whole answer to large rooms: no
    // team-splitting mechanic is built; the guidance is copy, stated where the
    // type is chosen (2026-08-09 wavelength convergence spec §2.2).
    blurb: 'Word association — a word counts when everyone says it. Works best with groups of ten or less.',
    answerType: 'wavelength',
    roundNoun: 'Subject',
  },
  survey: {
    id: 'survey',
    label: 'Survey',
    short: 'Survey',
    icon: 'ListChecks',
    accent: 'var(--secondary)',
    // A SESSION WITH NO ROUNDS (surveys phase 2). This used to read
    // ASK → VOTE → RESULTS, recording what the code did to a survey by
    // accident — it fell through handleFinishQuestion() into start-vote. A
    // survey now collects at each person's own pace and is then closed:
    // STATE SURVEY#OPEN → SURVEY#CLOSED, host phases COLLECTING → CLOSED
    // (config/hostControls.js), and no vote, so hasVotePhase() is false.
    phases: ['COLLECTING', 'CLOSED'],
    blurb: 'Structured multi-question feedback, reported in aggregate.',
    answerType: 'text',
    roundNoun: 'Question',
  },
};

/** Storage/legacy spellings → canonical id. */
const ALIASES = {
  callandanswer: 'call-and-answer',
  call_and_answer: 'call-and-answer',
  calland: 'call-and-answer',
  quiz: 'trivia',
  polls: 'poll',
};

export const DEFAULT_GAME_TYPE = 'call-and-answer';

/** Canonical id for any spelling; falls back to call-and-answer. */
export function normalizeGameType(type) {
  if (!type) return DEFAULT_GAME_TYPE;
  const key = String(type).trim().toLowerCase();
  if (GAME_TYPES[key]) return key;
  if (ALIASES[key]) return ALIASES[key];
  return DEFAULT_GAME_TYPE;
}

/**
 * Canonical id for a value that is *supposed to be* a game type, or null when
 * the value is something else entirely.
 *
 * `normalizeGameType()` answers "what type should I render this as?" and so
 * always returns one. Filtering asks the opposite question — "is this a game
 * type at all?" — where the fallback is actively wrong: every archived record
 * whose Category is `business` or `general` would come back tagged
 * Call & Answer and show up under the wrong filter.
 */
export function resolveGameType(type) {
  if (type === null || type === undefined) return null;
  const key = String(type).trim().toLowerCase();
  if (!key) return null;
  if (GAME_TYPES[key]) return key;
  if (ALIASES[key]) return ALIASES[key];
  return null;
}

/** Full descriptor for any spelling. Never returns undefined. */
export function gameTypeMeta(type) {
  return GAME_TYPES[normalizeGameType(type)];
}

/** Human label for any spelling — the one-liner most call sites want. */
export function gameTypeLabel(type) {
  return gameTypeMeta(type).label;
}

/** The AI-prompt storage key (`callandanswer`, not `call-and-answer`). */
export function gameTypePromptKey(type) {
  return normalizeGameType(type).replace(/-/g, '');
}

/** Does this type run a VOTE phase between ASK and RESULTS? */
export function hasVotePhase(type) {
  return gameTypeMeta(type).phases.includes('VOTE');
}

/** Ordered list for pickers/filters. */
export const GAME_TYPE_LIST = Object.values(GAME_TYPES);

/**
 * Types a host may NOT create, and why. One id per reason, so the fix is a
 * deletion rather than an edit.
 *
 * EMPTY SINCE SURVEYS PHASE 2. `survey` sat here through phase 1, when a survey
 * set could be made and edited but no session could play one; phase 2 is the
 * session (the collecting stage, the phone's five inputs, the answer rows), so
 * the id was deleted and the create dialog's pill appeared, exactly as this
 * comment promised. The array, NOT_PLAYABLE_LABEL and notPlayableReason() stay
 * for the next type that is authorable before it is playable.
 */
export const UNPLAYABLE_GAME_TYPES = [];

/**
 * The types the create dialog offers today.
 *
 * Derived rather than hand-listed. The shipped <select> named three of five and
 * its own state comment repeated the omission — a picker that had drifted from
 * the very table built to stop it drifting.
 */
export const PICKER_GAME_TYPES = GAME_TYPE_LIST.filter(
  (type) => !UNPLAYABLE_GAME_TYPES.includes(type.id)
);

/**
 * Can a host actually play a set of this type?
 *
 * The ADMIN pickers are not the host's create dialog and do not use
 * PICKER_GAME_TYPES. The owner's decision on OPEN-QUESTIONS #3 is **label it,
 * not hide it** — mockup 01 row 13 draws a Survey set carrying a `Not playable`
 * state chip — so admin renders every type in GAME_TYPE_LIST and annotates the
 * ones this predicate rejects. Hiding it would make an existing survey set
 * unreachable in the one console that can delete it.
 *
 * The console's type filter used to be four hand-written <option> elements that
 * omitted Survey while two other selects on the same tab offered it. That drift
 * is the bug; every list is derived from this file now.
 */
export function isPlayableGameType(type) {
  return !UNPLAYABLE_GAME_TYPES.includes(normalizeGameType(type));
}

/** The words on the chip and on the annotated <option>. One spelling, one place. */
export const NOT_PLAYABLE_LABEL = 'Not playable';

/**
 * Why a type is not playable, in the operator's terms rather than the table's.
 * Returns '' for a playable type, so a caller can render it unconditionally.
 */
export function notPlayableReason(type) {
  if (isPlayableGameType(type)) return '';
  return `A ${gameTypeLabel(type)} set can be made and edited here, but no session can run one yet.`;
}
