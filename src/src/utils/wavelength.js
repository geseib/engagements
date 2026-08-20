/**
 * Wavelength convergence — the presentation model for the stage.
 *
 * The server (lambda-functions/game/wavelength.js, get-results.js) owns the
 * arithmetic; this file decides what the wall SAYS about it, per the spec
 * (docs/superpowers/specs/2026-08-09-wavelength-convergence-design.md §5):
 *
 *   - the landed words at full weight, everything else dimmer with its count
 *   - one figure, with THE DENOMINATOR IN WORDS: "on every list — all 12 who
 *     answered", never a bare "everyone" and never a bare percentage
 *   - if nothing landed, the strongest non-empty tier becomes the headline,
 *     labelled honestly
 *   - a result matched without the model announces itself: "matched on exact
 *     wording only"
 *
 * Pure functions so the whole vocabulary is testable without a stage.
 */

/**
 * Accept both the convergence shape (words/submitterCount/matching) and the
 * legacy stored rounds that predate it (wordCounts/connectionScore, 7-day
 * TTL, so they linger briefly after a deploy). Returns null when there is
 * nothing renderable.
 */
export function normalizeWavelengthAnalysis(raw) {
  if (!raw || typeof raw !== 'object') return null;

  if (Array.isArray(raw.words)) {
    return {
      submitterCount: raw.submitterCount ?? raw.totalAnswers ?? 0,
      totalWordsSubmitted: raw.totalWordsSubmitted ?? 0,
      totalUniqueWords: raw.totalUniqueWords ?? raw.words.length,
      words: raw.words,
      landed: raw.commonWords || [],
      nearMiss: raw.nearMiss || [],
      matching: raw.matching || 'exact',
      clustering: raw.clustering || 'skipped',
    };
  }

  // Legacy round: rebuild what can be rebuilt. Its commonWords meant "two or
  // more", which is not the game — recompute landed as count === submitters
  // from the raw tallies rather than repeat the old claim.
  if (raw.wordCounts && typeof raw.wordCounts === 'object') {
    const submitterCount = raw.totalAnswers ?? 0;
    const words = Object.entries(raw.wordCounts)
      .map(([word, count]) => ({ word, count, members: [word] }))
      .sort((a, b) => b.count - a.count || (a.word < b.word ? -1 : 1));
    const landed = submitterCount > 0
      ? words.filter((w) => w.count === submitterCount)
      : [];
    let nearMiss = [];
    if (landed.length === 0 && words.length && words[0].count >= 2) {
      nearMiss = words.filter((w) => w.count === words[0].count);
    }
    return {
      submitterCount,
      totalWordsSubmitted: raw.totalWordsSubmitted ?? 0,
      totalUniqueWords: raw.totalUniqueWords ?? words.length,
      words,
      landed,
      nearMiss,
      matching: 'exact',
      clustering: 'legacy',
    };
  }

  return null;
}

/** Beat one (spec §4): the round closed, the clustered result is not here yet. */
export const isWavelengthPending = (analysis) =>
  Boolean(analysis) && analysis.clustering === 'pending';

/**
 * The one figure and its honest label. Every string carries its denominator —
 * "11 words" is a claim a host can defend only next to "all 12 who answered".
 */
export function wavelengthHeadline(analysis) {
  const n = analysis.landed.length;
  const who = `all ${analysis.submitterCount} who answered`;

  if (n > 0) {
    return {
      figure: String(n),
      label: n === 1 ? 'word the whole room shared' : 'words the whole room shared',
      sub: `on every list — ${who}`,
    };
  }
  if (analysis.nearMiss.length > 0) {
    const c = analysis.nearMiss[0].count;
    return {
      figure: null,
      label: 'No word was on every list — here is what came closest',
      sub: `said by ${c} of ${who}`,
    };
  }
  return {
    figure: null,
    label: 'No two lists shared a word',
    sub: `every idea was its own — ${who}`,
  };
}

/** The meta line above the flow: the counts, denominator first. */
export const wavelengthMetaLine = (analysis) => {
  const parts = [
    `${analysis.submitterCount} answered`,
    `${analysis.totalWordsSubmitted} words offered`,
    `${analysis.totalUniqueWords} distinct`,
  ];
  return parts.join(' · ');
};

/**
 * The degraded-matching announcement. 'failed' is the model not running;
 * 'legacy' is a round stored before clustering existed. 'skipped' is a round
 * with nothing to cluster (one submitter / one idea) — exact matching is the
 * complete result there and announcing it would imply a loss that did not
 * happen. Null means say nothing.
 */
export function wavelengthMatchingNote(analysis) {
  if (analysis.matching === 'exact'
    && (analysis.clustering === 'failed' || analysis.clustering === 'legacy')) {
    return 'Matched on exact wording only — spelling variants were not combined this round.';
  }
  return null;
}

/** How many terms the wall shows before deferring the tail to the report. */
export const WAVELENGTH_STAGE_TERM_CAP = 24;

/**
 * Every term the stage prints, in order: landed first at full weight, then the
 * rest by how many people said them, dimmer. `tier` is the semantic
 * (landed / near / offered); `sizeClass` maps onto stage.css's ranked-flow
 * ladder (.terms .w1–.w5).
 */
export function wavelengthTerms(analysis, cap = WAVELENGTH_STAGE_TERM_CAP) {
  const landedSet = new Set(analysis.landed.map((w) => w.word));
  const nearSet = new Set(analysis.nearMiss.map((w) => w.word));

  const terms = analysis.words.map((w) => {
    if (landedSet.has(w.word)) {
      return { ...w, tier: 'landed', sizeClass: 'w1' };
    }
    if (nearSet.has(w.word)) {
      return { ...w, tier: 'near', sizeClass: 'w2' };
    }
    return { ...w, tier: 'offered', sizeClass: w.count >= 2 ? 'w4' : 'w5' };
  });

  // Landed first (already the top of the count sort when they exist, but the
  // ordering is the contract, not a coincidence of the sort).
  terms.sort((a, b) => {
    const rank = (t) => (t.tier === 'landed' ? 0 : t.tier === 'near' ? 1 : 2);
    return rank(a) - rank(b) || b.count - a.count || (a.word < b.word ? -1 : 1);
  });

  const shown = terms.slice(0, cap);
  return {
    terms: shown,
    // A reduction with no recovery is a deletion — when the tail is cut, the
    // stage says so and names where the rest lives.
    reduction: terms.length > shown.length
      ? `Showing the ${shown.length} most shared of ${terms.length} — every word is in the session report.`
      : null,
  };
}
