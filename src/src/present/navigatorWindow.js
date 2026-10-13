/**
 * THE RESPONSE NAVIGATOR'S FLANKS (two-surface NOTES §5, PLAN 2.2).
 *
 * The owner's sketch `[1-5] < 6 > [7-8]`, made into a rule: the focused
 * response in the middle, its two nearest neighbours each side as mini cards,
 * and everything further as ONE range chip. A flank never holds more than
 * three items, so the card never changes size whatever the count:
 *
 *   8 at #6   [1–3] 4 5 | 6 | 7 8
 *   60 at #30 [1–27] 28 29 | 30 | 31 32 [33–60]
 *
 * Indexes are 0-based in and out. A "range" of one response is a mini.
 */
const NEIGHBOURS = 2;

const mini = (index) => ({ kind: 'mini', index });
const span = (from, to) => (from === to ? mini(from) : { kind: 'range', from, to, count: to - from + 1 });

export function navigatorWindow(index, total) {
  const n = Math.max(0, Math.floor(Number(total) || 0));
  if (!n) return { index: 0, total: 0, left: [], right: [] };
  const i = Math.min(n - 1, Math.max(0, Math.floor(Number(index) || 0)));

  const left = [];
  const nearLeft = Math.max(0, i - NEIGHBOURS);
  if (nearLeft > 0) left.push(span(0, nearLeft - 1));
  for (let j = nearLeft; j < i; j += 1) left.push(mini(j));

  const right = [];
  const nearRight = Math.min(n - 1, i + NEIGHBOURS);
  for (let j = i + 1; j <= nearRight; j += 1) right.push(mini(j));
  if (nearRight < n - 1) right.push(span(nearRight + 1, n - 1));

  return { index: i, total: n, left, right };
}

/** The foot track: one tick per response up to 24, then a bar with a marker (0..1). */
export const TRACK_TICKS_MAX = 24;
export function trackOf(index, total) {
  const n = Math.max(0, Math.floor(Number(total) || 0));
  const i = Math.min(Math.max(0, n - 1), Math.max(0, Math.floor(Number(index) || 0)));
  if (n <= TRACK_TICKS_MAX) return { kind: 'ticks', ticks: Array.from({ length: n }, (_, k) => k === i) };
  return { kind: 'bar', at: n > 1 ? i / (n - 1) : 0 };
}
