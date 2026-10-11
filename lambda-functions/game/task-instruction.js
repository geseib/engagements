/**
 * WHAT THE ROOM WAS TOLD TO DO — the task line on the player's answer screen,
 * resolved on the server so Workie reads the same words the room did.
 *
 * A MIRROR of src/src/config/instructions.js `resolveInstruction`, which the
 * Lambda bundle cannot import (an ESM file in a separate webpack build).
 * tests/ai-summary-task.js reads that file and fails when the order or any of
 * the default strings here drift from it.
 *
 * Before this, get-ai-summary.js read only Title, Detail, Background and
 * AnswerDetails, so a round that asked "What change does our team need to
 * introduce…" reached the model as the story's TITLE, and the prompt said the
 * room had answered the title (relay pilot review, 2026-10-11).
 *
 * Order, as on the phone:
 *   1. the question's own CustomInstructions
 *   2. the question set's customInstruction
 *   3. artwork present                       — Art Title rounds
 *   4. the game type's default
 *
 * Both 1 and 2 are sealed on an org's set (ENCRYPTED_FIELDS.question and .set);
 * the caller passes them already decrypted. A value that is not a string — an
 * envelope that failed to open — counts as absent rather than being printed.
 */

const GAME_TYPE_INSTRUCTIONS = Object.freeze({
  trivia: 'Select the best answer:',
  poll: 'Share your opinion:',
  wavelength: 'Enter up to 10 words that come to mind for this subject:',
  'call-and-answer': 'How could you adapt this lesson to your work, project, or team?',
  survey: 'Share your response:',
});

const ART_TITLE_INSTRUCTION =
  'Name this work of art. Will you be accurate, witty, or make the room really think?';

const FALLBACK = 'Share your response:';

const text = (v) => (typeof v === 'string' ? v.trim() : '');

/** The task a person wrote — the question's, else the set's — or ''. */
function authoredTaskOf(question, setInstruction) {
  const q = question || {};
  return text(q.customInstructions) || text(q.CustomInstructions) || text(setInstruction);
}

/**
 * @param question        the question row (either field spelling)
 * @param setInstruction  the set's customInstruction, if any
 * @param gameType        canonical game type id
 */
function resolveTask(question, setInstruction, gameType) {
  const q = question || {};
  const authored = authoredTaskOf(q, setInstruction);
  if (authored) return authored;
  if (text(q.image) || text(q.Image)) return ART_TITLE_INSTRUCTION;
  return GAME_TYPE_INSTRUCTIONS[gameType] || FALLBACK;
}

module.exports = { resolveTask, authoredTaskOf, GAME_TYPE_INSTRUCTIONS, ART_TITLE_INSTRUCTION, FALLBACK };
