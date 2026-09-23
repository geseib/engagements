/**
 * WHAT THE PHONE KNOWS ABOUT AN ANSWER — without the server.
 *
 * The values are the contract's (docs/design/survey-redesign/
 * IMPLEMENTATION-phase-2.md §2 "Answer values"), and the phone never invents
 * another shape:
 *
 *   rating  an integer on the scale
 *   choice  `[index…]`, or `[index…, {other}]` with a write-in
 *   yesno   `{v: 'yes'|'no'|'unsure', why?}`
 *   rank    `[index…]` in the order given
 *   text    a string
 *
 * Indexes are ALWAYS the canonical option order. `shuffle` only changes the
 * order the options are DRAWN in, on this phone (`seededOrder`), so a count on
 * the wall can never depend on which phone happened to show "Pricing" first.
 */

/** The steps a rating scale offers. `stars` is 1–5 drawn as glyphs; an unknown scale reads as 1–5. */
export function ratingSteps(scale) {
  const range = (lo, hi) => Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  switch (scale) {
    case '1-10': return range(1, 10);
    case '0-10': return range(0, 10);
    default: return range(1, 5);
  }
}

const TEXT_DEFAULT = { long: 500, short: 280 };
const TEXT_CAP = 2000;

/** The character limit an open answer enforces: the set's, else 500 long / 280 short, never above 2000. */
export function textLimit(question) {
  const q = question || {};
  const set = Number(q.maxLength);
  const fallback = TEXT_DEFAULT[q.textLength] || TEXT_DEFAULT.long;
  const limit = Number.isInteger(set) && set > 0 ? set : fallback;
  return Math.min(limit, TEXT_CAP);
}

/** A write-in or a "why" is at most this long (the contract's ≤280). */
export const NOTE_LIMIT = 280;

const isOther = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v) && typeof v.other === 'string';
const words = (s) => String(s ?? '').trim();

/** Would the server count this question as answered by this value? */
export function isAnswered(question, value) {
  if (value === null || value === undefined) return false;
  switch (question && question.kind) {
    case 'rating':
      return Number.isInteger(value);
    case 'choice':
      return Array.isArray(value)
        && value.some((v) => Number.isInteger(v) || (isOther(v) && words(v.other) !== ''));
    case 'yesno':
      return typeof value === 'object' && ['yes', 'no', 'unsure'].includes(value.v);
    case 'rank':
      return Array.isArray(value) && value.some(Number.isInteger);
    case 'text':
      return typeof value === 'string' && words(value) !== '';
    default:
      return false;
  }
}

/** The label a yes/no answer carries on this question. */
export function yesNoLabel(question, v) {
  const q = question || {};
  if (v === 'yes') return words(q.yesLabel) || 'Yes';
  if (v === 'no') return words(q.noLabel) || 'No';
  return 'Not sure';
}

const optionText = (question, i) => words((question.options || [])[i]);

/** A long answer, folded to its first words for the review list. "Change" beside it opens it whole. */
function excerpt(s, budget = 55) {
  const all = words(s).replace(/\s+/g, ' ');
  if (all.length <= budget) return `“${all}”`;
  let out = '';
  for (const w of all.split(' ')) {
    const next = out ? `${out} ${w}` : w;
    if (next.length > budget) break;
    out = next;
  }
  return `“${out || all.slice(0, budget)}…”`;
}

/** What the review list says was given, in words. '' for no answer. */
export function summaryFor(question, value) {
  const q = question || {};
  if (!isAnswered(q, value)) return '';
  switch (q.kind) {
    case 'rating': {
      const steps = ratingSteps(q.scale);
      const lo = steps[0];
      const hi = steps[steps.length - 1];
      if (q.scale === 'stars') return `${value} of ${hi} stars`;
      if (value === lo && words(q.lowLabel)) return `${value} · ${words(q.lowLabel)}`;
      if (value === hi && words(q.highLabel)) return `${value} · ${words(q.highLabel)}`;
      return `${value} out of ${hi}`;
    }
    case 'choice': {
      const parts = value.filter(Number.isInteger).map((i) => optionText(q, i));
      const other = value.find(isOther);
      if (other && words(other.other)) {
        parts.push(`${parts.length ? 'something' : 'Something'} else: “${words(other.other)}”`);
      }
      return parts.join('; ');
    }
    case 'yesno': {
      const label = yesNoLabel(q, value.v);
      return words(value.why) ? `${label} — with a note` : label;
    }
    case 'rank':
      return value.filter(Number.isInteger).map((i) => optionText(q, i)).join(', ');
    case 'text':
      return excerpt(value);
    default:
      return '';
  }
}

/* ---- the display-only shuffle -------------------------------------------
   Seeded by respondent + qid, so one phone draws the same order on every visit
   (a reload does not reshuffle under somebody's thumb), and two phones draw
   different orders (which is the point of shuffling). cyrb53 → mulberry32 →
   Fisher–Yates: small, deterministic, and no dependency. */

function hash(str) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i += 1) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0) ^ (h1 >>> 0);
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A permutation of 0…n-1, the same every time for the same seed. */
export function seededOrder(seed, n) {
  const order = Array.from({ length: Math.max(0, n) }, (_, i) => i);
  const rand = mulberry32(hash(String(seed)));
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

/** "two", not "2", for the small counts a person reads in a rule line. */
export function countWord(n) {
  return ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'][n] || String(n);
}

/**
 * Where an arrow key moves the choice in a radiogroup: Right/Down forward,
 * Left/Up back, Home/End to the ends, wrapping at both. null for any other key.
 */
export function rovingIndex(key, index, count) {
  if (count <= 0) return null;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return (index + 1) % count;
    case 'ArrowLeft':
    case 'ArrowUp':
      return (index - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}
