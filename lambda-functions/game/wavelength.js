/**
 * Wavelength convergence — the unanimity engine.
 *
 * The rules live in docs/superpowers/specs/2026-08-09-wavelength-convergence-design.md
 * and every one of them is the owner's, not this file's:
 *
 *   - A word LANDS when every person who SUBMITTED included it. The denominator
 *     is submitters, never the room — someone who joined and never answered
 *     must not be able to zero the result for everybody.
 *   - Everything else the room offered still shows, dimmer, with the number of
 *     people who said it. A round where nothing was unanimous still has
 *     something to talk about.
 *   - If nothing landed, the strongest tier that is not empty becomes the
 *     headline ("no word was on every list — here is what came closest").
 *   - Players have no scores. There is no Winners array and never will be.
 *
 * Matching runs in two stages:
 *   1. DETERMINISTIC here: case, surrounding punctuation, whitespace and
 *      hyphenation/spacing variants ("data base" / "data-base" / "database")
 *      collapse to one key. Same submissions, same clusters, every time.
 *   2. AI merges (plurals, misspellings, abbreviations) arrive as merge GROUPS
 *      proposed by a model and are applied by applyMerges() — which VALIDATES
 *      rather than trusts: a merge may only regroup keys that actually exist.
 *      The model can fail to merge; it cannot invent agreement.
 *
 * Everything here is pure and synchronous so tests/wavelength-convergence.js
 * can hold the whole contract without a stubbed AWS in sight.
 */

/**
 * The match key for one surface form. Lowercase, unicode-normalised, and with
 * every non-letter/non-digit stripped — which is exactly the "what merges"
 * list from the spec's clustering contract (case, punctuation, whitespace,
 * hyphenation/spacing) and nothing off the "what never merges" list, because
 * removing separators cannot turn two different ideas into one word.
 * Returns '' for a submission with no letters or digits in it at all.
 */
const matchKey = (surface) =>
  String(surface || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * The canonical on-screen label for a cluster: the most frequent surface form;
 * ties break to the shortest, then alphabetically. Deterministic, so the same
 * submissions always produce the same word on the wall.
 */
const canonicalLabel = (surfaceCounts) => {
  let best = null;
  let bestCount = -1;
  for (const [surface, count] of Object.entries(surfaceCounts)) {
    if (
      count > bestCount ||
      (count === bestCount && (
        surface.length < best.length ||
        (surface.length === best.length && surface < best)
      ))
    ) {
      best = surface;
      bestCount = count;
    }
  }
  return best;
};

/**
 * Deterministic clustering over player submissions.
 *
 * submissions: [{ player, words: [surface, ...] }]
 * Returns a Map keyed by matchKey:
 *   key -> { key, surfaces: {surface: occurrences}, players: Set<player> }
 *
 * A player who typed the same idea twice ("db, DB") counts once — unanimity
 * asks who said it, not how often.
 */
const buildClusters = (submissions) => {
  const clusters = new Map();
  for (const { player, words } of submissions) {
    for (const raw of words || []) {
      const surface = String(raw || '').trim();
      const key = matchKey(surface);
      if (!key) continue;
      let cluster = clusters.get(key);
      if (!cluster) {
        cluster = { key, surfaces: {}, players: new Set() };
        clusters.set(key, cluster);
      }
      cluster.surfaces[surface] = (cluster.surfaces[surface] || 0) + 1;
      cluster.players.add(player);
    }
  }
  return clusters;
};

/**
 * Apply model-proposed merge groups to a cluster map. Validation IS the safety
 * mechanism (the spec's contract replaces host review):
 *
 *   - a group member that names no existing key is dropped, not guessed at
 *   - a group left with fewer than two real keys merges nothing
 *   - a key already consumed by an earlier group is skipped in later ones,
 *     so overlapping proposals cannot chain distinct ideas together
 *
 * Group members may be surface forms or keys; both resolve through matchKey.
 * Returns a NEW map; the input is not mutated.
 */
const applyMerges = (clusters, mergeGroups) => {
  const merged = new Map();
  for (const [key, c] of clusters) {
    merged.set(key, {
      key,
      surfaces: { ...c.surfaces },
      players: new Set(c.players),
    });
  }

  const consumed = new Set();
  for (const group of Array.isArray(mergeGroups) ? mergeGroups : []) {
    if (!Array.isArray(group)) continue;
    const keys = [];
    for (const member of group) {
      const key = matchKey(member);
      if (!key || !merged.has(key) || consumed.has(key) || keys.includes(key)) continue;
      keys.push(key);
    }
    if (keys.length < 2) continue;

    const target = merged.get(keys[0]);
    for (const key of keys.slice(1)) {
      const source = merged.get(key);
      for (const [surface, count] of Object.entries(source.surfaces)) {
        target.surfaces[surface] = (target.surfaces[surface] || 0) + count;
      }
      for (const player of source.players) target.players.add(player);
      merged.delete(key);
    }
    for (const key of keys) consumed.add(key);
  }
  return merged;
};

/**
 * The whole result for one round.
 *
 * submissions: [{ player, words: [surface, ...] }]
 * options.merges: model-proposed merge groups (see applyMerges), optional.
 *
 * Returns:
 *   submitterCount      people who answered — THE denominator, stated on screen
 *   totalWordsSubmitted every surface form offered (before dedup)
 *   totalUniqueWords    distinct ideas after matching
 *   words               every cluster: [{ word, count, members }], count desc
 *                       then label — members are the distinct surface forms,
 *                       stored so a merge nobody can audit never has to be trusted
 *   commonWords         the LANDED tier: count === submitterCount
 *   nearMiss            when nothing landed: the highest count that at least
 *                       two people share — "here is what came closest"
 *   teamScore           commonWords.length, the one figure on the wall
 */
const analyzeWavelength = (submissions, options = {}) => {
  const real = (submissions || []).filter(
    (s) => s && Array.isArray(s.words) && s.words.some((w) => matchKey(w))
  );
  const submitterCount = real.length;
  const totalWordsSubmitted = real.reduce(
    (sum, s) => sum + s.words.filter((w) => matchKey(w)).length, 0
  );

  let clusters = buildClusters(real);
  if (options.merges) clusters = applyMerges(clusters, options.merges);

  const words = [...clusters.values()]
    .map((c) => ({
      word: canonicalLabel(c.surfaces),
      count: c.players.size,
      members: Object.keys(c.surfaces).sort(),
    }))
    .sort((a, b) => b.count - a.count || (a.word < b.word ? -1 : 1));

  const commonWords = submitterCount > 0
    ? words.filter((w) => w.count === submitterCount)
    : [];

  let nearMiss = [];
  if (commonWords.length === 0) {
    const best = words.length ? words[0].count : 0;
    if (best >= 2) nearMiss = words.filter((w) => w.count === best);
  }

  return {
    submitterCount,
    totalWordsSubmitted,
    totalUniqueWords: words.length,
    words,
    commonWords,
    nearMiss,
    teamScore: commonWords.length,
  };
};

/**
 * The clustering prompt. Stated as a contract because there is no host review
 * step behind it — the tie-break line is the entire safety mechanism, so it is
 * written down rather than left to temperature.
 */
const buildMergePrompt = (labels) => `You are matching words submitted by a team in a word-association game. A word only counts when everyone said it, so your job is to recognise when two entries are THE SAME TERM in different clothes.

MERGE only: plurals and inflections of one term; obvious misspellings and transpositions; abbreviations and their expansion of the SAME term (db, dbs, DBMS, database).

NEVER merge terms that are merely related, however closely: cloud/AWS, database/storage, fast/performance. Never merge broader and narrower categories, and never antonyms. If a reasonable person in the room would defend the two as different answers, they are different answers.

WHEN IN DOUBT, DO NOT MERGE. A missed merge costs one word off a count; a wrong merge manufactures agreement that did not happen, which is the one thing this game must never do.

Here are the entries, one per line:
${labels.map((l) => `- ${l}`).join('\n')}

Reply with ONLY a JSON array of merge groups, each group an array of two or more entries copied EXACTLY from the list above. Entries you leave out stay unmerged. If nothing should merge, reply [].`;

/**
 * Parse the model's reply into merge groups. Tolerant of fenced code blocks
 * and stray prose; strict about shape — anything that is not an array of
 * arrays of strings comes back as [] and the exact-match result stands.
 */
const parseMergeReply = (text) => {
  const raw = String(text || '');
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start === -1 || end <= start) return [];
  let parsed;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (g) => Array.isArray(g) && g.length >= 2 && g.every((m) => typeof m === 'string')
  );
};

/**
 * The {wordAnalysis} template variable's prose, in the convergence model: the
 * landed words with their denominator, or the honest near-miss when nothing
 * landed. Interpolated into LIVE prompts (get-ai-summary.js), so every claim
 * carries who it counted and no bare percentage appears.
 */
const buildWavelengthProse = (landed, nearMiss, distinct, submitters) => {
  if (landed.length > 0) {
    return `${landed.length} of ${distinct} distinct words were on every list (all ${submitters} who answered). ` +
      `Shared: ${landed.map((w) => w.word).join(', ')}`;
  }
  if (nearMiss.length > 0) {
    return `No word was on every list (all ${submitters} who answered). Closest: ` +
      `${nearMiss.map((w) => `${w.word} (${w.count} of ${submitters})`).join(', ')}`;
  }
  return `No word was shared — each of the ${distinct} distinct words came from one person (all ${submitters} who answered).`;
};

module.exports = {
  matchKey,
  canonicalLabel,
  buildClusters,
  applyMerges,
  analyzeWavelength,
  buildMergePrompt,
  parseMergeReply,
  buildWavelengthProse,
};
