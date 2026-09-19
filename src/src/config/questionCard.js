/**
 * THE QUESTION CARD, AS DATA — what the card computes before anything renders.
 *
 * The card (components/QuestionCard.jsx) is the live stage's ASK and trivia
 * RESULTS markup (GameHostPage.jsx), extracted so the set editor's question
 * preview can render the very same component (spec 2026-09-19 §2.3).
 * GameHostPage cannot mount in jsdom — it dies on the auth provider
 * (components/stage/Pager.jsx's header) — so every decision the card makes
 * lives here, where a test can reach it without mounting anything.
 *
 * NOTHING HERE MAY CHANGE WHAT THE STAGE SHOWS. `TRIVIA_OPTION_KEYS` and
 * `isCorrectTriviaOption` moved here verbatim from GameHostPage.jsx (lines
 * 77-107 at 29a055a7); `triviaOptions` and `optionShare` are the two inline
 * expressions its ASK and RESULTS markup computed, lifted unchanged.
 */

/** Trivia answer slots, in display order. */
export const TRIVIA_OPTION_KEYS = ['optionA', 'optionB', 'optionC', 'optionD', 'optionE', 'optionF'];

/**
 * Is this option slot the correct answer?
 *
 * Question sets in the wild record `correctAnswer` four different ways —
 * "OptionA", "A", the option's own text, or an array of any of those — so the
 * comparison has to try all of them. Lifted verbatim out of the RESULTS render
 * when that moved onto the stage; the logic is unchanged.
 */
export function isCorrectTriviaOption(question, key, letter) {
  if (!question) return false;
  const optionId = `Option${letter}`;
  const candidates = Array.isArray(question.correctAnswer)
    ? question.correctAnswer
    : [question.correctAnswer];

  for (const correct of candidates) {
    if (!correct) continue;
    if (correct === optionId || correct === letter || correct === question[key]) return true;
    if (typeof correct === 'string' && correct.startsWith('Option')) {
      const correctLetter = correct.replace('Option', '');
      if (`option${correctLetter}` === key || correctLetter === letter) return true;
    }
    if (typeof correct === 'string' && correct.length === 1 && /[A-F]/.test(correct)) {
      if (`option${correct}` === key || correct === letter) return true;
    }
  }
  return false;
}

/**
 * The options a trivia question actually carries, lettered as the stage
 * letters them: FILLED slots only, lettered by position among the filled ones.
 * A question with optionA, optionB and optionD shows A, B, C — exactly what
 * `.filter((key) => question[key]).map((key, index) => 65 + index)` did inline.
 */
export function triviaOptions(question) {
  if (!question) return [];
  return TRIVIA_OPTION_KEYS
    .filter((key) => question[key])
    .map((key, index) => ({ key, letter: String.fromCharCode(65 + index), text: question[key] }));
}

/**
 * The share of the room that picked `letter`, as a whole percent — the RESULTS
 * arithmetic, unchanged. 0, never NaN, when nobody answered.
 */
export function optionShare(answers, letter) {
  const list = Array.isArray(answers) ? answers : [];
  const picked = list.filter((a) => a.answer === letter).length;
  return list.length ? Math.round((picked / list.length) * 100) : 0;
}
