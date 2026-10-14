/**
 * EVERY ANSWER, NUMBERED, WITH NO NAME — the follow-up asks' view of a round.
 *
 * docs/design/ca-followup-asks/SPEC.md §4.1, PLAN.md T4. Built beside the
 * read's `responsesText` (get-ai-summary.js generateAISummary), in the same
 * order: the answers in the room's order (answer-order.js), then by vote
 * points, highest first, a stable sort, so a tie reads in the order the room
 * voted on — exactly the read's ranked list.
 *
 * NEVER A NAME, on any round, named or hidden: an ask never needs an author,
 * so none is sent. The numbers are what an ask's `answers` and its options'
 * `answer` cite, and what followup-grounding.js checks copied words against.
 *
 * Pure: no AWS, no I/O.
 */

/**
 * @param {{answer?: string, Answer?: string}[]} answers  in the room's order
 * @param {object} voteTallies  keyed by the same position: { totalScore }
 * @returns {{n: number, text: string, points: number}[]}
 */
function rankAnswers(answers, voteTallies) {
  const tallies = voteTallies || {};
  return (Array.isArray(answers) ? answers : [])
    .map((a, idx) => ({
      text: String((a && (a.answer !== undefined ? a.answer : a.Answer)) ?? '').replace(/\s+/g, ' ').trim(),
      points: Number((tallies[idx] || tallies[String(idx)] || {}).totalScore) || 0,
      idx,
    }))
    .sort((x, y) => y.points - x.points || x.idx - y.idx)
    .map((a, i) => ({ n: i + 1, text: a.text, points: a.points }));
}

/** The prompt's `{numberedAnswers}`: one line each, `1. (14 vote points) "…"`. */
function numberedAnswersText(ranked) {
  return (Array.isArray(ranked) ? ranked : [])
    .map((a) => `${a.n}. (${a.points} vote point${a.points === 1 ? '' : 's'}) "${a.text}"`)
    .join('\n');
}

module.exports = { rankAnswers, numberedAnswersText };
