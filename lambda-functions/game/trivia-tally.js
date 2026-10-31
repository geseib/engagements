/**
 * HOW MANY PICKED EACH OPTION OF ONE TRIVIA QUESTION — for the session report
 * (create-report.js `triviaTally`, rendered by GameReport.jsx as a bar per
 * option with the right one marked).
 *
 * The owner, 2026-10-31, on the report's trivia rounds: show why the answer is
 * right, and how the room answered. Counts only — never a name, never which
 * player picked what — so nothing here is more than the trivia results screen
 * already shows the room.
 *
 * Read with trivia-answer.js, the scorer's own module, so the report counts a
 * pick under the option the scorer scored it as. A phone sends the letter it
 * DREW, which differs from the stored slot whenever a question skips a slot;
 * `slotForSubmitted` resolves that, and `correctSlots` reads every spelling a
 * set records for the right answer. `Answer` on an answer row is encrypted at
 * rest (ENCRYPTED_FIELDS.answer); the caller hands in rows it has already
 * decrypted, as create-report.js does for every answer it reads.
 */
const { drawnOptions, slotForSubmitted, correctSlots } = require('./trivia-answer');

/**
 * @param {object} question  the question row (decrypted), optionA..F + correctAnswer
 * @param {object[]} answers the round's answer rows (decrypted); `Answer` is the drawn letter
 * @returns {null | { answered: number, correct: number, options: Array<{slot, letter, count, correct}> }}
 *   null when the question draws no options (nothing to count against).
 */
function triviaOptionCounts(question, answers) {
  const drawn = drawnOptions(question || {});
  if (drawn.length === 0) return null;
  const right = correctSlots(question || {});
  const options = drawn.map((o) => ({ slot: o.slot, letter: o.letter, count: 0, correct: right.includes(o.slot) }));
  let answered = 0;
  for (const row of answers || []) {
    const submitted = row && (row.Answer !== undefined ? row.Answer : row.answer);
    if (typeof submitted !== 'string' || !submitted.trim()) continue;
    answered += 1;
    const slot = slotForSubmitted(question, submitted);
    const option = options.find((o) => o.slot === slot);
    if (option) option.count += 1;
  }
  const correct = options.filter((o) => o.correct).reduce((n, o) => n + o.count, 0);
  return { answered, correct, options };
}

module.exports = { triviaOptionCounts };
