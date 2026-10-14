/**
 * SPLITTING A LONG RESPONSE INTO PARTS (two-surface NOTES §5, PLAN D1, 2.3).
 *
 * Three facts, each with one owner (D1):
 *   SHAPE  how many parts — measured once by a signed-in surface and stored on
 *          /stage-focus as `parts`;
 *   SLICES which sentences are in part 2 — THIS FILE, a pure function of the
 *          text and the count, so every screen cuts the same way;
 *   SIZE   the shrink within the profile — local to each screen.
 *
 * Pure, no DOM. `minimalK` takes the "does this part fit?" question as a
 * predicate, so the measurer answers it with real layout and tests with a fake.
 */

/** Sentences, each keeping its own trailing space and punctuation; join('') is the text. */
export function sentencesOf(text) {
  const s = String(text || '');
  if (!s.trim()) return [];
  return s.match(/[^.!?;]+[.!?;]+["')”’]*\s*|[^.!?;]+$/g) || [s];
}

/**
 * `k` parts, in order, as even in length as sentence boundaries allow. Each
 * boundary goes at the sentence end nearest to j/k of the text, and every part
 * holds at least one sentence, so k parts come back whenever there are k
 * sentences. Deterministic.
 */
export function splitEven(sentences, k) {
  const list = (sentences || []).filter((x) => String(x).length);
  const want = Math.max(1, Math.min(Math.floor(Number(k) || 1), list.length || 1));
  if (want === 1 || list.length <= 1) return [list.join('').trim()];

  const ends = [];
  let run = 0;
  list.forEach((sentence) => { run += sentence.length; ends.push(run); });
  const total = run;

  const cuts = []; // index of the last sentence in each part but the final one
  let prev = -1;
  for (let j = 1; j < want; j += 1) {
    const target = (total * j) / want;
    const lo = prev + 1;                       // at least one sentence in this part
    const hi = list.length - 1 - (want - j);   // and leave one for each part after
    let best = lo;
    for (let i = lo; i <= hi; i += 1) {
      if (Math.abs(ends[i] - target) < Math.abs(ends[best] - target)) best = i;
    }
    cuts.push(best);
    prev = best;
  }

  const parts = [];
  let start = 0;
  [...cuts, list.length - 1].forEach((last) => {
    parts.push(list.slice(start, last + 1).join('').trim());
    start = last + 1;
  });
  return parts;
}

/** The smallest k (1..maxK) whose every part fits; maxK when none does. */
export function minimalK(text, fits, maxK = 9) {
  const sentences = sentencesOf(text);
  const cap = Math.max(1, Math.min(maxK, sentences.length || 1));
  for (let k = 1; k <= cap; k += 1) {
    if (splitEven(sentences, k).every((part) => fits(part, k))) return k;
  }
  return cap;
}

/** Part `part` (0-based, clamped) of `text` cut into `parts`. */
export function partText(text, part, parts) {
  const slices = splitEven(sentencesOf(text), parts);
  const i = Math.min(slices.length - 1, Math.max(0, Math.floor(Number(part) || 0)));
  return slices[i] || '';
}
