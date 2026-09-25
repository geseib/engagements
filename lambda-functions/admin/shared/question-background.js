/**
 * A QUESTION'S BACKGROUND — the material its author left for Workie.
 *
 * docs/superpowers/specs/2026-09-25-question-background-design.md. Stored on the
 * question row as `Background`: encrypted for an org set (ENCRYPTED_FIELDS.question),
 * published and copied with the set (publishable.js QUESTION_FIELDS), carried by NO
 * player or live payload, and read only by game/get-ai-summary.js. It is not the
 * Reveal (`AnswerDetails`): the reveal is what the room is told at results; this is
 * what Workie may draw on while it reads the room.
 */
const BACKGROUND_MAX = 600;

/**
 * Trim to BACKGROUND_MAX at the last sentence end that fits, else the last word
 * boundary. One rule for every way in — generator output and CSV import — so a
 * note never ends mid-word and never differs by the door it came through.
 */
function clampBackground(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length <= BACKGROUND_MAX) return text;
  const head = text.slice(0, BACKGROUND_MAX + 1);
  let cut = -1;
  for (const m of head.matchAll(/[.!?](?=\s)/g)) {
    if (m.index < BACKGROUND_MAX) cut = m.index + 1;
  }
  if (cut > 0) return text.slice(0, cut);
  const word = head.lastIndexOf(' ', BACKGROUND_MAX);
  return (word > 0 ? text.slice(0, word) : text.slice(0, BACKGROUND_MAX)).trim();
}

/** Said identically to both generators, so the two cannot drift apart. */
const BACKGROUND_TRUTH_RULE = [
  'Write only what you are certain is true. No statistics, dates, names or quotations unless they are',
  'widely established and you are sure of them. Nothing about the audience\'s organisation, people or',
  'events. When you are not certain of a fact, give an angle or a question instead.',
].join(' ');

module.exports = { BACKGROUND_MAX, clampBackground, BACKGROUND_TRUTH_RULE };
