/**
 * A REGENERATED REPORT IS NEVER LESS COMPLETE THAN THE ONE ALREADY STORED.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 *
 * create-report.js rebuilds the whole report from the live table every time it
 * is asked, and the rows it reads expire on four different clocks:
 *
 *   session    QUESTION#nnn#REF                  next-question.js (was 24 hours
 *                                                 until 2026-09-25; now the
 *                                                 session's own ttl)
 *    7 days    QUESTION#nnn#ANSWER#{player}      websocket/message.js:374
 *    7 days    QUESTION#nnn#VOTE#{player}        submit-vote.js:66
 *    7 days    PLAYER#{name}                     join-game.js:338
 *    7 days    QUESTION#nnn#RESULTS (wavelength) get-results.js:1128
 *   30 days    QUESTION#nnn#RESULTS (voted)      get-results.js:632
 *   30 days    PLAYER#{name}#SCORE               join-game.js:362
 *   30 days    QUESTION#nnn#AISummary            get-ai-summary.js:1203
 *   30 days    GAME#{id} / REPORT                create-report.js
 *   90 days    GAME#{id} / METADATA, STATE       schema-compliant-manager.js
 *
 * From about day 8 the participants and their ballots are gone while the
 * session, its results and its AI summaries are still there. The rebuild
 * therefore returned 200 with `totalAnswers: 0`, every `answers` array empty
 * and an empty leaderboard — a retro that reads as though nobody attended.
 *
 * AND IT WAS DESTRUCTIVE, which is the half that made it urgent. create-report
 * has always written the REPORT snapshot as its last act, unconditionally. So
 * the hollow rebuild did not merely fail to show the answers, it REPLACED the
 * good snapshot taken on the night and stamped a fresh TTL on the hollow one.
 * Opening the retro is what destroyed it — and GameHostPage's Rounds tab POSTs
 * this route on every round advance and from the session-history list, so it
 * fired without anyone asking for a report at all.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 *
 * Where the live table can still answer, it wins: a summary regenerated today
 * is today's, a late vote counts. Where it has gone silent and the snapshot
 * remembers, the snapshot wins. Recovery is a FLOOR under the report, never a
 * freeze on it.
 *
 * ── WHAT THIS DELIBERATELY IS NOT ───────────────────────────────────────────
 *
 * It is not a change to how long anything is kept. Aligning the ANSWER row's
 * 7-day TTL with the session's 90 would extend the retention of participants'
 * own prose thirteenfold, and that is a product and privacy decision rather
 * than a config change — the privacy page concedes what is VISIBLE, not how
 * long a raw submission is held. It would also repair no existing session,
 * since those rows already carry their stamps. The derived, already-redacted
 * snapshot is the right thing to lean on; the raw rows expiring early is
 * plausibly the point.
 *
 * It is also not hung off the end of a session, because there is no way to end
 * one: `ENDED` is written only when the question pool runs dry
 * (docs/handoff/public-library-2026-08-27.md §3). The snapshot this file leans
 * on already exists and is already written on every report generation, so the
 * fix needs no such hook.
 *
 * Pure functions over plain objects, with no DynamoDB and no crypto: the
 * caller hands in the DECRYPTED stored row. tests/report-retention.js drives
 * it through the real handler.
 */

/** A round carries participants only if it has at least one ranked answer. */
const hasAnswers = (round) => Array.isArray(round && round.answers) && round.answers.length > 0;

/** `undefined`/`null` mean "the live table had nothing to say", not "empty". */
const pick = (live, kept) => (live === undefined || live === null ? kept : live);

/**
 * Did the rebuild actually RESOLVE this round's question, or is it holding the
 * `Question 001` placeholder create-report falls back to?
 *
 * `sourceQuestionId` is the whole test, because it is exactly what the handler
 * needs to look the question up: it comes from the RESULTS row (30 days) or the
 * REF row (24 hours), and when both have expired the handler cannot name the
 * question at all — but the snapshot still can.
 */
const resolvedQuestion = (round) => !!(round && round.questionData && round.questionData.sourceQuestionId);

/**
 * One round, merged. `live` and `kept` are the same round number from the
 * rebuild and from the stored snapshot; either may be undefined.
 *
 * @returns {{ round: object, recovered: boolean, unrecoverable: boolean }}
 */
function mergeRound(live, kept) {
  if (!kept) return { round: live, recovered: false, unrecoverable: !hasAnswers(live) };
  // The round fell out of the rebuild entirely. That is the votes-only round:
  // `questionNumbers` is built from votes ∪ results ∪ summaries, so a round
  // that was answered and voted but never closed disappears the moment its
  // ballots expire, taking its answers with it.
  if (!live) return { round: kept, recovered: true, unrecoverable: false };

  const liveHas = hasAnswers(live);
  const keptHas = hasAnswers(kept);
  const recovered = !liveHas && keptHas;

  return {
    round: {
      ...live,
      // Answers and their tallies move together or not at all — `voteStats`
      // counts the very rows `answers` lists, and a live count over recovered
      // answers would be the "0 answers" bug wearing the fix as a hat.
      answers: recovered ? kept.answers : live.answers,
      voteStats: recovered ? kept.voteStats : live.voteStats,
      // Regenerable, and regenerated summaries must win. Only absence falls back.
      aiSummary: pick(live.aiSummary, kept.aiSummary),
      questionData: resolvedQuestion(live) ? live.questionData : (kept.questionData || live.questionData),
      processedAt: pick(live.processedAt, kept.processedAt),
      completedAt: pick(live.completedAt, kept.completedAt),
      ...(live.wordAnalysis === undefined && kept.wordAnalysis !== undefined
        ? { wordAnalysis: kept.wordAnalysis }
        : {}),
    },
    recovered,
    unrecoverable: !liveHas && !keptHas,
  };
}

const byQuestionNumber = (a, b) =>
  (parseInt(a.questionNumber, 10) || 0) - (parseInt(b.questionNumber, 10) || 0);

/**
 * Reconcile a freshly rebuilt report against the stored snapshot.
 *
 * @param {object|null} stored  the DECRYPTED `SK: 'REPORT'` row, or null
 * @param {object} rebuilt      `{ detailedQuestions, playerPerformance, gameStats }`
 * @returns {{ detailedQuestions: object[], playerPerformance: object[],
 *            gameStats: object, completeness: object }}
 */
function reconcileReport(stored, rebuilt) {
  const liveRounds = Array.isArray(rebuilt.detailedQuestions) ? rebuilt.detailedQuestions : [];
  const keptRounds = Array.isArray(stored && stored.detailedQuestions) ? stored.detailedQuestions : [];
  const keptByNumber = new Map(keptRounds.map((r) => [String(r.questionNumber), r]));
  const liveByNumber = new Map(liveRounds.map((r) => [String(r.questionNumber), r]));

  const numbers = [...new Set([...liveByNumber.keys(), ...keptByNumber.keys()])];
  const detailedQuestions = [];
  const recoveredRounds = [];
  const unrecoverableRounds = [];

  for (const n of numbers) {
    const { round, recovered, unrecoverable } = mergeRound(liveByNumber.get(n), keptByNumber.get(n));
    if (!round) continue;
    detailedQuestions.push(round);
    if (recovered) recoveredRounds.push(n);
    if (unrecoverable) unrecoverableRounds.push(n);
  }
  detailedQuestions.sort(byQuestionNumber);
  recoveredRounds.sort();
  unrecoverableRounds.sort();

  // The leaderboard is all-or-nothing: it is rebuilt from PLAYER# rows (7 days)
  // and there is no partial state between "the room is listed" and "the room is
  // gone". A per-player merge would invent a roster that never played together.
  const liveRoster = Array.isArray(rebuilt.playerPerformance) ? rebuilt.playerPerformance : [];
  const keptRoster = Array.isArray(stored && stored.playerPerformance) ? stored.playerPerformance : [];
  const playerPerformance = liveRoster.length ? liveRoster : keptRoster;

  const gameStats = reconcileStats(
    rebuilt.gameStats, stored && stored.gameStats, recoveredRounds.length > 0
  );

  return {
    detailedQuestions,
    playerPerformance,
    gameStats,
    completeness: describe({
      stored, recoveredRounds, unrecoverableRounds, roundCount: detailedQuestions.length,
    }),
  };
}

/**
 * The four counts on the front page of the report.
 *
 * UNTOUCHED WHEN NOTHING WAS RECOVERED. Every live session, and every report
 * generated inside a week, takes the early return — so the reconciliation can
 * never change what a running session reads, and `totalAnswers` keeps counting
 * the round currently on the projector (which has no RESULTS row yet and is
 * therefore not among the rounds below).
 *
 * When rows HAVE expired, a count that went down did not go down because
 * anybody withdrew an answer — nothing in the product deletes one, remove-player
 * included, which marks a player removed rather than erasing what they wrote.
 * It went down because the row aged out. So the larger of the two figures is
 * the true one, and the averages are recomputed from the pair rather than
 * carried over, or a report could claim more answers than answers per question
 * can account for.
 */
function reconcileStats(live, kept, recovered) {
  const base = live || {};
  if (!recovered || !kept) return base;

  const most = (field) => Math.max(Number(base[field]) || 0, Number(kept[field]) || 0);
  const totalQuestions = most('totalQuestions');
  const totalAnswers = most('totalAnswers');
  const totalVotes = most('totalVotes');
  const per = (n) => (totalQuestions > 0 ? Math.round((n / totalQuestions) * 100) / 100 : 0);

  return {
    ...base,
    totalPlayers: most('totalPlayers'),
    totalQuestions,
    totalAnswers,
    totalVotes,
    averageAnswersPerQuestion: per(totalAnswers),
    averageVotesPerQuestion: per(totalVotes),
  };
}

/**
 * WHAT THIS REPORT IS, SAID OUT LOUD.
 *
 * The failure being fixed was never an error — it was a 200 with a plausible
 * empty report, which is the worst shape a wrong answer can take. So a report
 * that could not be fully reconstructed carries the fact, and get-report.js
 * whitelists it through to the host (its host branch is an explicit projection,
 * so a field stored faithfully is otherwise invisible).
 *
 * `complete` is about CONTENT, not provenance: a report rebuilt entirely from
 * the snapshot is complete, because everything the session produced is in it.
 * Only a round whose answers exist in neither place makes it false.
 */
function describe({ stored, recoveredRounds, unrecoverableRounds, roundCount }) {
  const complete = unrecoverableRounds.length === 0;
  const source = recoveredRounds.length === 0
    ? 'live'
    : (recoveredRounds.length >= roundCount ? 'snapshot' : 'live+snapshot');

  const completeness = {
    complete,
    source,
    recoveredRounds,
    unrecoverableRounds,
    snapshotTakenAt: (stored && stored.reportGeneratedAt) || null,
  };

  if (!complete) {
    const n = unrecoverableRounds.length;
    completeness.note = `The participant responses for ${n === 1 ? 'round' : 'rounds'} `
      + `${unrecoverableRounds.join(', ')} have expired and no earlier copy of this report `
      + 'was stored, so those rounds are shown without their answers. Response rows are kept '
      + 'for seven days after a session.';
  }

  return completeness;
}

module.exports = { reconcileReport, reconcileStats, mergeRound };
