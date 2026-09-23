/**
 * NAMES — the one survey setting that decides what is recorded about people.
 *
 * The owner, 2026-09-23: "i would like to collect names. this could be an
 * option: anon, record just that they completed, attribute. name concisely."
 * Three values; the VALUE decides what the server WRITES (a random id the
 * phone makes, a separate who-finished list, or answers under the person),
 * not what is hidden afterwards. docs/design/survey-redesign/RATIONALE.md §3,
 * IMPLEMENTATION-phase-2.md.
 *
 * Every sentence a person reads about a value lives here, once:
 *   hostLine   the one line under the option in the start dialog's chooser
 *   does       the paragraph under the chooser for the chosen value
 *   phoneLead  the bold opening of the phone's promise (may be empty)
 *   phoneLine  the rest of the phone's promise, above question 1
 *   wallLine   the subtitle on the collecting stage
 * The server's twin (ids, default, states) is lambda-functions/game/
 * survey-names.js; tests/survey-names-agree.js holds the two equal.
 */
export const NAMES_MODES = [
  {
    id: 'anonymous',
    label: 'Anonymous',
    hostLine: 'Nobody is recorded. The host sees totals and the words people write.',
    does: 'Nobody is recorded. You’ll see totals and the words people write, never who wrote them.',
    phoneLead: 'Anonymous.',
    phoneLine: 'Your host sees totals and the words you write — never who wrote them.',
    wallLine: 'Anonymous — the host sees totals and words, never names.',
  },
  {
    id: 'finished',
    label: 'Who finished',
    hostLine: 'The host sees who finished, never what they answered.',
    does: 'You will see a list of who finished and who stopped partway. Their answers are stored apart from their names, so nobody — you included — can match an answer to a person.',
    phoneLead: '',
    phoneLine: 'Your host sees that you finished — not what you answered.',
    wallLine: 'Your host sees who finished — not what you answered.',
  },
  {
    id: 'named',
    label: 'Named',
    hostLine: 'The host sees each person’s name with their answers. The room never does.',
    does: 'Each answer is kept with the person’s name. You’ll see who said what in the console and the CSV. The wall, the shared link and the report never show a name.',
    phoneLead: 'Named.',
    phoneLine: 'Your host sees your name with your answers. The room and any shared results never do.',
    wallLine: 'Your host sees names with answers — the room never does.',
  },
];

export const NAMES_DEFAULT = 'anonymous';

const BY_ID = Object.fromEntries(NAMES_MODES.map((m) => [m.id, m]));

/** The value's entry; anything unknown reads as the default. */
export function namesMode(id) {
  return BY_ID[String(id || '').trim().toLowerCase()] || BY_ID[NAMES_DEFAULT];
}

/** The Names part of the create/update payload: a survey sends its value, every other type nothing. */
export function namesPayloadFor({ gameType, names } = {}) {
  if (gameType !== 'survey') return {};
  return { names: namesMode(names).id };
}
