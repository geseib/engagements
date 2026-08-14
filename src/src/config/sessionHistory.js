/**
 * THE ROUNDS PLAYED SO FAR, AND GOING BACK THROUGH THEM.
 *
 *   "once you move on to a new question it would be nice to go back through AI
 *    responses, and results screens. perhaphs there is even a session tab that
 *    list questions so far, and lists those."
 *
 * The owner chose both shapes when asked: a tab listing the rounds AND arrows
 * for stepping between neighbours, with each round showing the question itself,
 * its results, its AI summary, and a way to regenerate that summary.
 *
 * ── NO NEW BACKEND, AND THAT IS THE WHOLE DESIGN DECISION ──────────────────
 *
 * `POST /games/{gameId}/report` already assembles exactly this. create-report.js
 * queries the results rows, the votes, the AI summaries and each round's source
 * question, ranks the answers, and returns `detailedQuestions` — one entry per
 * round carrying `questionData` (title, detail, category, image, school, and
 * the trivia options), `answers` already ranked, `voteStats`, and `aiSummary`.
 * Every field this feature needs was already on the wire and read by nothing
 * but the end-of-session report.
 *
 * It is also the route that already gets ANONYMITY right for this data — it is
 * public, so it redacts, and reimplementing that judgement in a second place is
 * the specific mistake that hid the names and the podium for a whole session
 * earlier this week.
 *
 * WHAT IT COSTS: create-report writes a `REPORT` snapshot row as its last act.
 * Opening the tab therefore refreshes that snapshot. It is a single fixed key
 * (`SK: 'REPORT'`), so repeated opens overwrite rather than accumulate, and a
 * report that tracks the session as it runs is closer to right than one frozen
 * at whenever it was first generated. Worth knowing, not worth a second
 * endpoint.
 *
 * ── WHY THIS MODULE EXISTS SEPARATELY FROM THE COMPONENTS ──────────────────
 *
 * The report payload is generous, tolerant and inconsistent in its casing,
 * because it accreted — `Title || title`, `Detail || QuestionDetail`, summaries
 * from before the persona resolver stamped its item. Normalising that where it
 * can be tested beats doing it in JSX where it cannot.
 */

/** A round with nothing in it is still a round that happened. */
function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * ONE ENTRY PER ROUND, in the order they were played.
 *
 * Sorted by round number rather than trusting the payload's order:
 * create-report builds `detailedQuestions` by iterating a Map's keys, and a
 * Map keyed by strings orders "10" before "2". A history list that puts round
 * ten second is not a history list.
 *
 * Round numbers are compared NUMERICALLY for that reason, and rendered from the
 * padded string the rest of the system uses, so a caller can pass `number`
 * straight back to the AI-summary endpoint as its `questionId`.
 */
export function roundsFrom(report) {
  const raw = (report && report.detailedQuestions) || [];
  return raw
    .map((round) => {
      const q = round.questionData || {};
      const padded = String(round.questionNumber ?? '').padStart(3, '0');
      return {
        // The id the AI-summary endpoint takes, and the key React lists by.
        number: padded,
        ordinal: Number.parseInt(round.questionNumber, 10) || 0,
        title: textOf(q.title) || `Round ${padded}`,
        // `detail` and `questionDetail` are the same field under two names,
        // depending on how old the round is and whether it is trivia.
        detail: textOf(q.detail) || textOf(q.questionDetail),
        category: textOf(q.category),
        image: textOf(q.image) || null,
        school: textOf(q.school) || null,
        answers: Array.isArray(round.answers) ? round.answers : [],
        voteStats: round.voteStats || null,
        aiSummary: round.aiSummary || null,
        // Trivia rounds carry their options and the correct answer, and a past
        // round is exactly where somebody wants to check what the answer was.
        options: ['optionA', 'optionB', 'optionC', 'optionD', 'optionE', 'optionF']
          .map((key) => textOf(q[key]))
          .filter(Boolean),
        correctAnswer: q.correctAnswer ?? null,
        answerDetails: textOf(q.answerDetails) || '',
      };
    })
    .sort((a, b) => a.ordinal - b.ordinal);
}

/**
 * A one-line description for the list row.
 *
 * The count is the thing a host scanning the list actually wants — "did that
 * round land?" — and it is stated in words rather than as a bare number so a
 * round with none reads as an outcome rather than as a missing value.
 */
export function roundSubtitle(round) {
  if (!round) return '';
  const n = (round.answers || []).length;
  const responses = n === 1 ? '1 response' : `${n} responses`;
  return round.category ? `${round.category} · ${responses}` : responses;
}

/**
 * Does this round have an AI summary worth opening?
 *
 * A summary row can exist with nothing readable in it — generation failed part
 * way, or an older row carries only the legacy `Summary` spelling that
 * create-report maps to `summaryText`. The list badge and the "Regenerate"
 * label both key off this, and both would lie if it merely checked the object
 * for existence.
 */
export function hasSummary(round) {
  const s = round && round.aiSummary;
  if (!s) return false;
  return Boolean(
    textOf(s.summaryText)
    || textOf(s.markdownResponse)
    || (Array.isArray(s.discussionQuestions) && s.discussionQuestions.length)
  );
}

/**
 * Where a round number sits in the list, or -1.
 *
 * BY NUMBER RATHER THAN BY POSITION, because the two diverge exactly when it
 * matters: the arrows step by position, but the caller that opens a round from
 * the results screen has a round NUMBER and no idea what index it landed at
 * after sorting. Looking it up keeps that seam in one place.
 */
export function indexOfRound(rounds, number) {
  const padded = String(number ?? '').padStart(3, '0');
  return (rounds || []).findIndex((r) => r.number === padded);
}
