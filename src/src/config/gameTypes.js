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
    blurb: 'Word association — the room converges on a shared cloud.',
    answerType: 'wavelength',
    roundNoun: 'Subject',
  },
  survey: {
    id: 'survey',
    label: 'Survey',
    short: 'Survey',
    icon: 'ListChecks',
    accent: 'var(--secondary)',
    // Records what the code DOES, which may not be what was intended: only
    // trivia and wavelength skip voting, so a survey falls through and runs a
    // vote phase. Arguably a survey should not — but changing that changes the
    // game, so this table is corrected to reality and the question is flagged
    // rather than silently answered here.
    phases: ['ASK', 'VOTE', 'RESULTS'],
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
 * `survey` — `lambda-functions/admin/upload-questions.js:146-157` rejects survey
 * uploads outright ("surveys cannot be imported as playable question sets until
 * game sessions support the survey engagement type"). So no survey question set
 * can exist; the create dialog's set dropdown filters by type, so a Survey
 * option would open onto a permanently empty list with Create permanently
 * disabled — a dead end that looks like a feature. When that upload block is
 * lifted, delete the id from this array and the option appears. Nothing else
 * changes, because the picker renders from GAME_TYPE_LIST rather than a
 * hand-written list of its own.
 */
export const UNPLAYABLE_GAME_TYPES = ['survey'];

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
