/**
 * How much did the room actually agree?
 *
 * WHY THIS IS ITS OWN FILE. The label it produces is interpolated into the LIVE
 * model prompt as `{consensusLevel}`, so whatever it says, the model treats as
 * an observation about the room and hosts read the result aloud. That makes it
 * exactly the class of value that must be arithmetic a person can audit, and
 * exactly the class that is impossible to audit while it lives inline in a
 * 2,000-line handler.
 *
 * THE DEFECT THIS REPLACES, because it is worth not rebuilding:
 *
 *     } else if (winners.length === 1 && winners[0].score > (results.maxScore * 0.8)) {
 *       consensusLevel = 'Strong consensus';
 *
 * `winners` is built as exactly those answers whose score EQUALS `maxScore`
 * (get-ai-summary.js:905-916), and `results.maxScore` is that same number. So
 * the test reduces to `maxScore > 0.8 * maxScore` — true for every maxScore
 * above zero. Any round with a single top answer and one vote point reported
 * "Strong consensus", however evenly the room had split. A 4/3/3 round read as
 * strong agreement.
 *
 * It is the same shape as the participationRate defect removed in 78df15ca:
 * a comparison whose two sides are the same expression, interpolated into a
 * live prompt, always true, and silent. The fix in both cases is the same —
 * compare against something that can actually differ.
 *
 * So: consensus is measured against the RUNNER-UP. That is the only comparison
 * on this data that can distinguish a room that agreed from a room that did not.
 */

/**
 * @param {Object}  args
 * @param {string}  args.gameType
 * @param {Array}   args.sortedAnswers    entries of [index, {totalScore}], score-descending
 * @param {number}  args.maxScore         highest vote-point total in the round
 * @param {number}  args.connectionScore  wavelength only
 * @returns {string} a label safe to interpolate into a prompt
 */
function consensusLabel({ gameType, sortedAnswers = [], maxScore = 0, connectionScore = 0 } = {}) {
  if (gameType === 'trivia') return 'Trivia results - no consensus voting';
  if (gameType === 'wavelength') {
    return `Team collaboration - ${connectionScore}% word connection rate`;
  }

  // Nobody voted. Note the callers cannot infer this from the tally: voteTallies
  // is initialised with a row per answer at totalScore 0 (get-ai-summary.js:808-818),
  // so a round with no votes still renders a full ranked list sitting at zero.
  // Saying so plainly is the only thing that stops that list reading as a result.
  if (!(maxScore > 0)) return 'No votes cast - nothing was ranked';

  // One answer is not agreement, it is an absence of alternatives.
  if (sortedAnswers.length < 2) return 'Only one response - nothing to compare';

  const top = Number(sortedAnswers[0][1].totalScore) || 0;
  const runnerUp = Number(sortedAnswers[1][1].totalScore) || 0;

  // runnerUp === 0 falls out of the first branch correctly: the top answer took
  // every point awarded, which is the strongest agreement this data can show.
  // Multiplication rather than a ratio, so there is no divide-by-zero case.
  if (top >= runnerUp * 3) return 'Strong consensus';
  if (top >= runnerUp * 2) return 'Moderate consensus';
  return 'Mixed opinions';
}

module.exports = { consensusLabel };
