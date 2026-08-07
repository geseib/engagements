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
  },
  wavelength: {
    id: 'wavelength',
    label: 'Wavelength',
    short: 'Wavelength',
    icon: 'Waves',
    accent: 'var(--secondary)',
    phases: ['ASK', 'VOTE', 'RESULTS'],
    blurb: 'Word association — the room converges on a shared cloud.',
    answerType: 'wavelength',
  },
  survey: {
    id: 'survey',
    label: 'Survey',
    short: 'Survey',
    icon: 'ListChecks',
    accent: 'var(--secondary)',
    phases: ['ASK', 'RESULTS'],
    blurb: 'Structured multi-question feedback, reported in aggregate.',
    answerType: 'text',
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
