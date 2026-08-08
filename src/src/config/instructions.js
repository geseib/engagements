/**
 * What the room is told to do for the current question.
 *
 * This lived in three places — GameHostPage had two copies (one of them dead
 * code) and PlayerPage a third — which is how the host and player screens came
 * to disagree about Art Title rounds.
 *
 * The bug that prompted this: the host resolved its question with
 * `questions.find(q => q.id === currentQuestionId)`, but the state-restore path
 * set `questions` without ever setting `currentQuestionId`. After a refresh the
 * lookup returned undefined, and passing undefined skipped BOTH the
 * per-question instruction and the artwork check, so an art round told players
 * "How could you adapt this lesson to your work, project, or team?"
 *
 * Order matters and is deliberate:
 *   1. the question's own instruction   — most specific, always wins
 *   2. the question set's instruction   — authored once for the whole set
 *   3. artwork present                  — Art Title rounds
 *   4. the game type's default
 */
export const GAME_TYPE_INSTRUCTIONS = {
  trivia: 'Select the best answer:',
  poll: 'Share your opinion:',
  wavelength: 'Enter up to 10 words that come to mind for this subject:',
  'call-and-answer': 'How could you adapt this lesson to your work, project, or team?',
  survey: 'Share your response:',
};

export const ART_TITLE_INSTRUCTION = 'Give this masterpiece your own creative title!';

const FALLBACK = 'Share your response:';

/**
 * @param question        the current question object, or null/undefined
 * @param setInstruction  question-set level instruction, if any
 * @param gameType        canonical game type id
 */
export function resolveInstruction(question, setInstruction, gameType) {
  const q = question || {};

  const own = (q.customInstructions || q.CustomInstructions || '').trim();
  if (own) return own;

  const set = (setInstruction || '').trim();
  if (set) return set;

  // Art Title rounds are call-and-answer sets carrying an image, so the artwork
  // is the only thing that identifies them here.
  if ((q.image || q.Image || '').trim()) return ART_TITLE_INSTRUCTION;

  return GAME_TYPE_INSTRUCTIONS[gameType] || FALLBACK;
}

/**
 * Pick the question the room is currently on.
 *
 * `questions` is always set as a single-element array (`setQuestions([data])`
 * at every call site), so an id mismatch should degrade to that one element
 * rather than to undefined — undefined is what produced the wrong instruction.
 */
export function currentQuestionOf(questions, currentQuestionId) {
  if (!Array.isArray(questions) || questions.length === 0) return null;
  const byId = questions.find((q) => q && q.id === currentQuestionId);
  return byId || questions[0];
}
