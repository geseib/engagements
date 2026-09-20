/**
 * TRIVIA SCORING — the single place that decides whether a submitted answer is
 * the right one.
 *
 * It exists because two different things are both called "B", and the code that
 * scored answers held only one of them:
 *
 *   SLOT      the column an author typed into. optionA..optionF. This is what a
 *             set STORES, as `correctAnswer: 'OptionC'`.
 *   POSITION  the letter the room SEES. The stage and the player's phone letter
 *             only the FILLED slots, by position among them — PlayerPage.jsx
 *             filters the six keys on truthiness and THEN letters what is left.
 *             This is what a phone SUBMITS.
 *
 * They are the same letter until a question skips a slot. For one filling
 * optionA, optionC and optionD the room sees A, B, C, so optionC — the correct
 * one — is submitted as 'B'. Scoring used to build `Option${answer}` straight
 * out of the submitted letter, which read 'B' as the optionB slot: the player
 * who picked the right answer was marked wrong, and the player who picked
 * optionD, drawn as C, was marked RIGHT. A gapped question did not merely fail
 * to score, it paid the wrong person, and it did so for the `OptionX` spelling
 * CLAUDE.md mandates.
 *
 * SO THE TWO ARE NEVER COMPARED DIRECTLY. `correctSlots` answers in slots,
 * `slotForSubmitted` converts a submitted position into a slot, and only then
 * are they matched.
 *
 * EVERY SPELLING A SET RECORDS, because this is the reader that decides who
 * scores and it accepted exactly one of them. `correctOptionIndex` in
 * src/src/config/hostRemote.js — the host's phone — has always read all of
 * these, and this function is deliberately its mirror:
 *
 *   OptionB / optionb / OPTIONB / Option B    a slot id, any case, `\s*`
 *   B / b                                     a bare letter, meaning the SLOT
 *   Jupiter / jupiter                         the option's own TEXT
 *   ['optionb', 'Option D']                   an array of any of the above
 *
 * config/setupPanel.js records that sets store the option's TEXT "as often as
 * they record it as OptionB", and admin/upload-questions.js stores the
 * CorrectAnswer cell of an uploaded CSV verbatim — `question.CorrectAnswer ||
 * ''`, no validation of any kind — so a hand-authored CSV really does land all
 * of them in the table. Before this, such a set scored NOBODY: the projector
 * marked the right option, the host's phone marked it, and every player in the
 * room got 0 for a question they had answered correctly.
 *
 * A bare letter resolves to the SLOT, not to the position, because that is what
 * `correctOptionIndex` does with it and because an author writing 'C' is naming
 * the column they typed into. The one exception is a slot the question leaves
 * EMPTY — see `slotForPointer`.
 *
 * NOTHING ELSE IS GUESSED. An answer that places against none of the question's
 * own options resolves to no slot at all and scores nobody, which is the honest
 * outcome — a scoring reader that guessed would pay the wrong player, which is
 * the bug this module exists to end.
 *
 * DUPLICATED — Lambda bundles are per-directory (CodeUri: lambda-functions/game,
 * .../websocket), so a module cannot be shared across them. The two copies must
 * stay BYTE-IDENTICAL; tests/trivia-scoring-slots.js fails if they drift:
 *   - lambda-functions/game/trivia-answer.js
 *   - lambda-functions/websocket/trivia-answer.js
 */

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

// Both spellings, because both are in the table: admin/upload-questions.js
// writes `optionA` while older rows carry `OptionA`, which is why
// game/get-question.js reads `optionA || OptionA` on every one of the six.
const OPTION_KEYS = LETTERS.map((letter) => [`option${letter}`, `Option${letter}`]);

/** The first of `names` holding a string, '' when none does. */
function firstOf(obj, names) {
  for (const name of names) {
    const value = obj[name];
    if (typeof value === 'string' && value) return value;
  }
  return '';
}

/**
 * The options as the ROOM sees them: `slot` is the column it is stored under,
 * `letter` is the letter it is drawn as.
 *
 * Filled is decided by TRUTHINESS, exactly as PlayerPage.jsx decides it, so a
 * slot holding only spaces is counted here as it is drawn there. Agreeing with
 * the surface that produced the letter is the whole job — disagree by one blank
 * and every option after it is scored as its neighbour. get-question.js coerces
 * a missing slot to '', so falsy means absent.
 */
function drawnOptions(question) {
  const q = question || {};
  const drawn = [];
  OPTION_KEYS.forEach((names, index) => {
    const text = firstOf(q, names);
    if (!text) return;
    drawn.push({ slot: LETTERS[index], letter: LETTERS[drawn.length], text: text.trim() });
  });
  return drawn;
}

/**
 * The slot a player meant by the letter their phone sent, or null.
 *
 * Null for a letter no option was drawn for — a five-option answer to a
 * three-option question is not a near miss to be rounded, it is nothing.
 */
function slotForSubmitted(question, submitted) {
  if (typeof submitted !== 'string') return null;
  const letter = submitted.trim().toUpperCase();
  if (!letter) return null;
  const match = drawnOptions(question).find((option) => option.letter === letter);
  return match ? match.slot : null;
}

/**
 * The stored answer, preferring whichever spelling actually holds one.
 *
 * The PLURAL names are last and no writer produces them — every builder puts an
 * array in the singular field — but get-ai-summary.js has always consulted
 * `correctAnswers`, and dropping a read is a regression even when nothing
 * exercises it today.
 */
function storedCorrectAnswer(question) {
  const q = question || {};
  for (const name of ['correctAnswer', 'CorrectAnswer', 'correctAnswers', 'CorrectAnswers']) {
    const value = q[name];
    if (Array.isArray(value) && value.length) return value;
    if (typeof value === 'string' && value.trim()) return value;
  }
  return null;
}

/**
 * A POINTER spelling — `OptionC`, `c` — to the slot it means, or null.
 *
 * It names the SLOT whenever that slot is filled. When the question leaves that
 * slot EMPTY nobody can tap it, and the projector (isCorrectTriviaOption in
 * src/src/config/questionCard.js, which matches by key AND by drawn letter)
 * marks the option DRAWN under that letter instead. The scorer follows it: a
 * room shown one right answer and scored on another is the failure this module
 * exists to end. src/src/__tests__/triviaScorerAgreesWithProjector.test.js pins
 * the two layers to the same answers.
 *
 * The fallback is for an empty slot ONLY. Reading a filled slot as a position
 * is the original bug, and a letter neither reading can place is still null.
 */
function slotForPointer(question, letter) {
  const drawn = drawnOptions(question);
  if (drawn.some((option) => option.slot === letter)) return letter;
  const byPosition = drawn.find((option) => option.letter === letter);
  return byPosition ? byPosition.slot : null;
}

/** One stored spelling to a slot letter, or null. The mirror of correctOptionIndex. */
function slotForStored(question, stored) {
  if (typeof stored !== 'string') return null;
  const answer = stored.trim();
  if (!answer) return null;

  const named = answer.match(/^option\s*([A-F])$/i);
  if (named) return slotForPointer(question, named[1].toUpperCase());

  if (/^[A-F]$/i.test(answer)) return slotForPointer(question, answer.toUpperCase());

  const needle = answer.toLowerCase();
  const q = question || {};
  for (let index = 0; index < OPTION_KEYS.length; index++) {
    const text = firstOf(q, OPTION_KEYS[index]);
    if (text && text.trim().toLowerCase() === needle) return LETTERS[index];
  }
  return null;
}

/**
 * Every SLOT the set says is right, in slot order. Empty when it says nothing
 * this question can place.
 *
 * Every slot returned is one the question FILLS: a pointer at an empty slot is
 * resolved by `slotForPointer`, and one that places nowhere is dropped.
 */
function correctSlots(question) {
  const stored = storedCorrectAnswer(question);
  if (stored === null) return [];
  const entries = Array.isArray(stored) ? stored : [stored];
  const slots = [];
  for (const entry of entries) {
    const slot = slotForStored(question, entry);
    if (slot && !slots.includes(slot)) slots.push(slot);
  }
  return slots.sort((a, b) => LETTERS.indexOf(a) - LETTERS.indexOf(b));
}

/**
 * THE decision. `submitted` is the positional letter the player's phone sent.
 *
 * Both sides are resolved to slots before they meet, so a question with a hole
 * in its slots scores the player who picked the right option and nobody else.
 */
function isAnswerCorrect(question, submitted) {
  const slot = slotForSubmitted(question, submitted);
  if (!slot) return false;
  return correctSlots(question).includes(slot);
}

module.exports = {
  LETTERS,
  OPTION_KEYS,
  drawnOptions,
  slotForSubmitted,
  correctSlots,
  isAnswerCorrect,
};
