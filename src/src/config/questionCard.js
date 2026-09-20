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
 * NOTHING HERE MAY CHANGE WHAT THE STAGE SHOWS WITHOUT A TEST SAYING SO.
 * `TRIVIA_OPTION_KEYS` and `isCorrectTriviaOption` moved here verbatim from
 * GameHostPage.jsx (lines 77-107 at 29a055a7); `triviaOptions` and
 * `optionShare` are the two inline expressions its ASK and RESULTS markup
 * computed, lifted unchanged. `isCorrectTriviaOption` has since been widened
 * twice, on purpose — see its own note.
 */

/** Trivia answer slots, in display order. */
export const TRIVIA_OPTION_KEYS = ['optionA', 'optionB', 'optionC', 'optionD', 'optionE', 'optionF'];

/**
 * Is this option slot the correct answer?
 *
 * Question sets in the wild record `correctAnswer` four different ways —
 * "OptionA", "A", the option's own text, or an array of any of those — so the
 * comparison has to try all of them. Lifted verbatim out of the RESULTS render
 * when that moved onto the stage.
 *
 * TWO DELIBERATE WIDENINGS SINCE THE LIFT, both of them the same bug: the
 * host's phone read a spelling this predicate could not, so the phone flagged
 * an option while the projector behind it drew every option dimmed and the room
 * was never told which answer was right.
 *
 *   1. THE BARE LETTER, whatever its case. The inline version compared 'c' only
 *      against the uppercase positional letter and guarded its bare-letter
 *      branch on `/[A-F]/` with no `i`, so a set storing 'c' matched NOTHING.
 *   2. THE SLOT ID, whatever its case and spacing. `startsWith('Option')` and an
 *      exact comparison of the stripped letter matched `OptionB` alone, so
 *      `optionb`, `Optionb`, `OPTIONB` and `Option B` all matched NOTHING.
 *
 * Both spellings were already understood one surface over: config/hostRemote.js
 * `correctOptionIndex` matches `/^[A-F]$/i` and `/^option\s*([A-F])$/i`, both
 * deliberately. __tests__/questionCard.test.js now pins the two decoders
 * against each other so neither can be widened alone again.
 *
 * NOTHING UPSTREAM TIDIES THE SPELLING, which is why it has to be read here:
 * lambda-functions/admin/upload-questions.js stores the CorrectAnswer cell of an
 * imported CSV verbatim, with no validation of any kind, and
 * lambda-functions/game/get-question.js rewrites an answer only when it
 * startsWith('Option') — case-sensitively.
 *
 * THE OPTION'S OWN TEXT IS STILL COMPARED EXACTLY, and deliberately: an answer
 * is only the same answer if it is spelled the same way. Only the two POINTER
 * spellings — the ones that name a slot rather than say an answer — fold.
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
    /* THE SLOT ID, READ AS THE PHONE READS IT. This was `startsWith('Option')`
       followed by an exact comparison of the letter it stripped, which matched
       `OptionB` and nothing else — not `optionb`, not `Optionb`, not `OPTIONB`,
       not `Option B`. The phone's decoder has always matched all four
       (config/hostRemote.js `correctOptionIndex`, `/^option\s*([A-F])$/i` — the
       `i` and the `\s*` are both deliberate), so the host's hand flagged an
       option the projector behind them left dim. Same regex here, so the two
       surfaces cannot read one set two ways.

       BOTH COMPARISONS ARE KEPT. `key` is the slot and `letter` is the
       POSITION among the filled slots, and they differ whenever a question
       skips a slot: for optionA/optionC/optionD the stage draws C as B, so
       `OptionC` places by key and `OptionB` places by letter. Matching only one
       of them would drop half the sets this branch already read. */
    if (typeof correct === 'string') {
      const named = correct.trim().match(/^option\s*([A-F])$/i);
      if (named) {
        const slot = named[1].toUpperCase();
        if (`option${slot}` === key || slot === letter) return true;
      }
    }
    /* THE BARE LETTER, CASE-FOLDED — the first of the two. `letter` is always the
       stage's uppercase positional letter, so a set recording 'c' matched
       neither it nor the slot id, and the projector drew every option dimmed
       with none marked — the room was never told which answer was right. The
       option's own TEXT above is still compared exactly: an answer is only the
       same answer if it is spelled the same way. */
    if (typeof correct === 'string' && correct.length === 1 && /[A-F]/i.test(correct)) {
      const bare = correct.toUpperCase();
      if (`option${bare}` === key || bare === letter) return true;
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
