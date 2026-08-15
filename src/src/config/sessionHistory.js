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

import { PODIUM_SIZE } from './podium';
import { isRedacted } from './anonymity';

/** A round with nothing in it is still a round that happened. */
function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * ONE ANSWER ROW, IN THE SHAPE THE DIALOGS ALREADY READ.
 *
 * THE DEFECT THIS EXISTS TO FIX, and it is the invented-fixture trap for the
 * second time in this file. `create-report.js` builds its ranked rows as
 *
 *     { answerIndex, playerName?, answerText, totalScore,
 *       firstPlace, secondPlace, thirdPlace, voteBreakdown, rank, rankDisplay }
 *
 * (create-report.js:384-415) — `answerText`, not `answer`. Every other answer
 * surface in this app is fed by `GET /answers`, whose rows carry `answer`,
 * `points` and `votes`, and `PastRound` was written against that shape. So it
 * rendered `answer.answer` for every past round and printed nothing at all:
 * the owner's *"the actual answers are not there"*. The rounds tab's own tests
 * built their answer rows from the client's reading rather than from the
 * handler, exactly as the envelope bug did, so the whole suite stayed green
 * over a dialog that showed no responses.
 *
 * Normalising here rather than in the JSX means both dialogs — the list and the
 * spotlight it opens — read one shape, and the tolerant reads sit where they
 * can be tested.
 *
 * ANONYMITY IS NOT RE-DECIDED HERE, and that is the point. `create-report.js`
 * already redacts PER ROUND, through the same `isHidden()` gate as
 * `GET /answers`, by OMITTING `playerName` (create-report.js:344-354). This
 * preserves that omission verbatim — omitted stays omitted, never nulled and
 * never defaulted to a name — so `config/anonymity.js` can answer the label
 * question from the row alone, which is what it is for.
 */
export function answersFrom(round) {
  const raw = Array.isArray(round && round.answers) ? round.answers : [];
  return raw.map((row, i) => {
    const a = row || {};
    // `answerText` is the report's spelling; `answer` is the live payload's.
    // Both are accepted so one normaliser serves both routes.
    const name = typeof a.playerName === 'string' && a.playerName.length > 0
      ? a.playerName
      : null;
    return {
      answer: textOf(a.answerText) || textOf(a.answer),
      // OMITTED, NOT NULLED — see the doc-block. `isRedacted` treats a missing
      // key and an empty string alike, so a redacted row can never render as
      // an empty label or the string "null".
      ...(name ? { playerName: name } : {}),
      rank: Number.isFinite(a.rank) ? a.rank : null,
      answerIndex: Number.isFinite(a.answerIndex) ? a.answerIndex : i,
      // The report keeps the three placement tallies and the score apart; the
      // dialogs want the same two numbers `GET /answers` gives them.
      points: Number(a.totalScore ?? a.points) || 0,
      votes: Number.isFinite(a.votes)
        ? a.votes
        : (Number(a.firstPlace) || 0) + (Number(a.secondPlace) || 0) + (Number(a.thirdPlace) || 0),
    };
  });
}

/**
 * THE START OF AN ANSWER, for the row that offers to show the rest.
 *
 *   "so if each of the 3 has a number in a circle, the start of their answer,
 *    their name and you click that number the full modal shows there answer."
 *
 * Cut on a word boundary rather than mid-word, because the row is read at a
 * glance and a truncation that lands inside a word reads as a corrupted value
 * rather than as a summary. An answer that already fits is returned UNCHANGED —
 * no ellipsis — so a short response never looks truncated.
 *
 * The ellipsis is a single character, not three dots: three dots wrap.
 */
export function snippetOf(text, max = 90) {
  const full = textOf(text);
  if (full.length <= max) return full;
  const cut = full.slice(0, max);
  const space = cut.lastIndexOf(' ');
  // A single unbroken 200-character string has no space to cut at; a hard cut
  // is right there, and better than returning the whole wall of text.
  return `${(space > max * 0.5 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * THE TOP THREE, which is what the owner asked to be able to open.
 *
 * `PODIUM_SIZE` rather than a literal 3, from `config/podium.js`, because it is
 * the same three: *"a podium, not a leaderboard"*. The rows arrive already
 * ranked by create-report (score, then first-place votes as the tiebreak), so
 * this is a slice and never a second sort — re-sorting here could disagree with
 * the `rank` printed on the row.
 *
 * Fewer than three responses yields fewer than three entries. A round nobody
 * answered yields none, which is the case that must not throw.
 */
export function podiumAnswers(round) {
  return ((round && round.answers) || []).slice(0, PODIUM_SIZE);
}

/**
 * Did this round come back WITH its authors?
 *
 * Read off the rows rather than re-derived from the session settings, for the
 * reason `answersFrom` gives: create-report decided it per round, and the row
 * is that decision. Used to gate the score in the spotlight, because §5.6.4 —
 * a score beside a response is attribution by arithmetic, so it goes wherever
 * the names go.
 *
 * A round with no responses has nothing to attribute and answers `false`.
 */
export function roundIsAttributed(round) {
  const rows = (round && round.answers) || [];
  return rows.length > 0 && rows.every((row) => !isRedacted(row));
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
export function roundsFrom(payload) {
  /*
    THE ENVELOPE, WHICH I GOT WRONG AND SHIPPED.

    Reported: a completed round 1, and the tab still saying *"No rounds yet."*

    `POST /games/{gameId}/report` answers
        { success, gameId, report: { … detailedQuestions … }, message }
    and this read `payload.detailedQuestions` — one level too high, always
    `undefined`, so every session looked empty no matter how many rounds it had.

    The cause is worth naming because it is not a typo: the tests for this
    module were written from a fixture I INVENTED to match my own reading, not
    from what create-report.js returns. A fixture that agrees with the code
    under test and disagrees with the server proves only that the code is
    self-consistent. `sessionHistory.test.jsx` now builds its payload in the
    real envelope, and the mounted panel test asserts the rounds actually
    appear.

    Both shapes are accepted rather than only the right one, because the stored
    `REPORT` row is `reportData` itself — so `GET /games/{id}/report` hands back
    the INNER object while POST hands back the outer. A reader that insisted on
    one would break the moment anyone pointed this at the other route.
  */
  const report = (payload && payload.report) || payload;
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
        // Normalised here, not in the JSX: the report spells the text
        // `answerText` and the rest of the app spells it `answer`. See
        // answersFrom, and the defect it is named after.
        answers: answersFrom(round),
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
