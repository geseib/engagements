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
      /* NOT 'skipped'. A convergence-shaped round with no `clustering` field is
         one stored before the field existed — 'legacy' is what that is, and it
         is annotated. Defaulting to 'skipped' made it read as a complete
         clustered result, because 'skipped' is the one status this file
         deliberately keeps quiet about. */
      clustering: raw.clustering || 'legacy',
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
 * The degraded-matching announcement.
 *
 *   'failed'       the model ran and threw
 *   'unavailable'  the pass could not be dispatched at all
 *   'legacy'       a round stored before clustering existed
 *   'skipped'      nothing to cluster — one submitter, or one distinct idea
 *
 * The first three are announced; 'skipped' is not, because exact matching IS
 * the complete result for a round with nothing to merge and announcing it would
 * imply a loss that did not happen.
 *
 * 'unavailable' exists because it used to be spelled 'skipped' too, and so
 * inherited that silence — a full room whose clustering never dispatched got an
 * exact-match result presented as final, with nothing on screen to say so. See
 * get-results.js, where the three-way split is made.
 *
 * Null means say nothing.
 *
 * 'pending' is NOT in the list, and that is the point: a round still waiting on
 * its worker has no reported outcome, so nothing here can honestly describe it.
 * The stage prints WAVELENGTH_STILL_MATCHING instead once its watchdog fires.
 */
export function wavelengthMatchingNote(analysis) {
  if (analysis.matching === 'exact' && (
    analysis.clustering === 'failed'
    || analysis.clustering === 'unavailable'
    || analysis.clustering === 'legacy'
  )) {
    return 'Matched on exact wording only — spelling variants were not combined this round.';
  }
  return null;
}

/**
 * What the wall says when the watchdog fired and the worker has still not
 * reported. The room stops waiting — a host is standing in front of people —
 * but the claim has to stay true to what is known: these are the exact-wording
 * counts, and the matched ones may still be coming.
 *
 * The stage used to relabel the round 'failed' at this moment and print
 * "spelling variants were not combined this round", which asserts an outcome
 * nothing had reported. The worker's own budget is minutes (template-clean.yaml
 * gives get-results a worker-sized timeout), so a frame arriving after twenty
 * seconds is ordinary — and it re-flows the words underneath a sentence that
 * had already called the run a failure.
 */
export const WAVELENGTH_STILL_MATCHING =
  'Showing exact wording for now — still matching the room\'s words.';

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

/* ─────────────────────────────── the session, across rounds (ENDED) ──────── */

/**
 * The dedupe key for combining rounds. Mirrors the SERVER's matchKey
 * (lambda-functions/game/wavelength.js:38) — NFKC, lowercase, strip everything
 * that is not a letter or digit — because each round's labels already went
 * through it; using anything looser here would re-split what a round merged.
 */
const sessionKey = (word) => String(word || '')
  .normalize('NFKC')
  .toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * The whole session's vocabulary, combined from each round's STORED analysis
 * (never recomputed — the stored copy is what the room saw).
 *
 * Two tiers, spec'd in 2026-08-09-ended-screen-review.md §1.4:
 *   unison   — landed (said by everyone who answered) in at least one round.
 *   nearMiss — offered by more than one person somewhere, but never landed.
 * The figure that replaces the podium's score is unison.length.
 *
 * `total` sums the per-round say-counts, which is what sizes a term on the
 * wall; `landedIn` counts the rounds it was unanimous in, which is what ranks
 * the unison tier — a word the room agreed on twice outranks one it agreed on
 * once, whatever their raw counts.
 */
export function aggregateWavelengthSession(rounds) {
  const tally = new Map();
  let roundsCounted = 0;

  for (const round of rounds || []) {
    const analysis = normalizeWavelengthAnalysis(round?.wordAnalysis);
    if (!analysis || analysis.words.length === 0) continue;
    roundsCounted += 1;
    const landedKeys = new Set(analysis.landed.map((w) => sessionKey(w.word)));
    for (const w of analysis.words) {
      const key = sessionKey(w.word);
      if (!key) continue;
      const entry = tally.get(key) || { word: w.word, total: 0, landedIn: 0, members: new Set() };
      entry.total += w.count;
      if (landedKeys.has(key)) {
        entry.landedIn += 1;
        // A landed round's label wins the spelling contest — it is the form
        // the room saw lit up.
        entry.word = w.word;
      }
      for (const m of (w.members || [])) entry.members.add(m);
      tally.set(key, entry);
    }
  }

  const all = [...tally.values()].map((e) => ({ ...e, members: [...e.members].sort() }));
  const byWord = (a, b) => (a.word < b.word ? -1 : 1);
  const unison = all
    .filter((e) => e.landedIn > 0)
    .sort((a, b) => b.landedIn - a.landedIn || b.total - a.total || byWord(a, b));
  const nearMiss = all
    .filter((e) => e.landedIn === 0 && e.total >= 2)
    .sort((a, b) => b.total - a.total || byWord(a, b));

  return { roundsCounted, unison, nearMiss, figure: unison.length };
}
