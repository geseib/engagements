/**
 * The fitter's decisions, with the measuring taken out.
 *
 * The rule, stated once: A REDUCTION MAY ONLY FIRE WHEN SPACE IS ACTUALLY
 * EXHAUSTED.
 *
 * Order of preference, cheapest loss first:
 *   1. full size, no loss
 *   2. smaller type, no loss          (continuous, floored scale search)
 *   3. different layout, no loss      (option grid column count)
 *   4. drop CHROME                    (the meter, then data-drop groups)
 *   5. clamp                          (terminal; a budget failure, not a landing)
 *
 * Everything here is pure so it can be tested without a layout engine. The DOM
 * half lives in useStageFit.js and does nothing but measure and apply.
 */

/** Halvings of the scale interval. Seven resolves 0.45 to about 0.0035. */
export const ITERATIONS = 7;

/**
 * Largest scale in [min, max] that satisfies isClean().
 *
 * Monotonic — a smaller scale is never worse — so a binary search is exact to
 * its resolution. Returns null when even `min` is dirty, which is the signal
 * to reach for a different lever rather than to keep shrinking: below the floor
 * the search simply stops working, and that is the property that makes this not
 * the unfloored "auto-shrink to fit" the design rejects.
 *
 * Leaves the box AT the returned scale.
 */
export function searchScale({ min, max, iterations = ITERATIONS, isClean, setScale }) {
  setScale(max);
  if (isClean()) return max;

  setScale(min);
  if (!isClean()) return null;

  let lo = min;
  let hi = max;
  let best = min;
  for (let i = 0; i < iterations; i += 1) {
    const mid = (lo + hi) / 2;
    setScale(mid);
    if (isClean()) { best = mid; lo = mid; } else { hi = mid; }
  }
  setScale(best);
  return best;
}

/**
 * Everything this state is willing to give up, cheapest first.
 *
 * CHROME BEFORE CONTENT, ALWAYS. The meter enters at priority -1, ahead of
 * every content group, through the same mechanism as everything else rather
 * than as a special case bolted to the end — which is what it was, and which
 * made a results state throw away an answer while keeping a 233px standings
 * column.
 *
 * Width is the cheapest lever on the stage: a wider measure means fewer lines,
 * which buys height at no cost to type size and no cost to content.
 */
export function buildSacrificeList({ hasMeter, isSolo, dropGroups }) {
  const list = [];
  if (hasMeter && !isSolo) list.push({ order: -1, kind: 'meter' });
  (dropGroups || []).forEach((g) => {
    list.push({ order: g.order, kind: 'group', el: g.el, note: g.note || null });
  });
  return list.sort((a, b) => a.order - b.order);
}

/**
 * Does this element DECLARE a truncation that renders?
 *
 * Only clamped or ellipsised elements can abbreviate anything; ordinary text
 * wraps and makes its parent taller, which the overflow check already sees.
 * And `text-overflow` only applies to a block container with inline content —
 * on a flex container it is inert, which is how the rail shipped clipping
 * mid-glyph with no ellipsis at all.
 */
export function declaresTruncation(cs) {
  if (!cs) return false;
  const clamp = cs.webkitLineClamp;
  if (clamp && clamp !== 'none' && clamp !== '') return true;
  return cs.textOverflow === 'ellipsis' && /nowrap|pre$/.test(cs.whiteSpace || '');
}

/**
 * Has this element actually lost content?
 *
 * Asking every element whether scrollHeight exceeds clientHeight is not a
 * stricter version of this question, it is a different and wrong one: a block
 * with a fractional line-height reports a pixel of phantom overflow — measured,
 * 176 against 175 — which makes the predicate permanently true, drives the
 * search to its floor, and leaves 548px of a 795px box empty. Ask only the
 * elements that can actually lie, with a tolerance of half a line.
 */
export function isAbbreviated(cs, rect) {
  if (!declaresTruncation(cs)) return false;
  const lineHeight = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2 || 0;
  const tolerance = Math.max(2, lineHeight * 0.5);
  if (rect.scrollHeight > rect.clientHeight + tolerance) return true;
  return rect.scrollWidth > rect.clientWidth + 2;
}
