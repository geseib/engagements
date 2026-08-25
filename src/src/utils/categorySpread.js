/**
 * WHAT ASKING FOR N ITEMS ACROSS C CATEGORIES ACTUALLY GETS YOU.
 *
 * The builders ask "how many?" twice — once for items and once for categories —
 * as two independent fields, and the two numbers are not independent at all.
 * Twenty questions across twelve categories is under two per category, which
 * makes a poor session: the host switches a category on mid-round and it is
 * exhausted immediately. Six categories for four questions is worse — two of
 * them come back empty, and nothing in the interface said so before the
 * generation was paid for.
 *
 * Neither control could say this on its own, because it is a fact about the
 * PAIR. So it is said once, under the categories field, and it moves while you
 * move either one.
 *
 * Pure and total: no clamping assumptions, no throwing on nonsense. Callers
 * pass whatever their state holds.
 */
export function categorySpread(items, categories, noun = 'questions') {
  const n = Math.max(0, Math.floor(Number(items) || 0));
  const c = Math.max(0, Math.floor(Number(categories) || 0));

  if (!n || !c) return '';

  const head = `${n} ${n === 1 ? noun.replace(/s$/, '') : noun} across ${c} ${c === 1 ? 'category' : 'categories'}`;

  if (c === 1) return `${head} — all of them together.`;

  /*
    THE CASE WORTH A WARNING. More categories than items means the model is
    being asked to fill buckets it has nothing to put in, and what comes back
    is either empty categories or categories invented to pad the count.
  */
  if (c > n) return `${head} — more categories than ${noun}, so some will come back empty.`;

  const low = Math.floor(n / c);
  const high = Math.ceil(n / c);
  const each = low === high ? `${low}` : `${low}–${high}`;

  if (high <= 1) return `${head} — one each.`;
  return `${head} — about ${each} each.`;
}

export default categorySpread;
