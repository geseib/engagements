/**
 * WHAT THE SET IS ABOUT, AND WHICH CATEGORY A QUESTION BELONGS IN.
 *
 * The owner, 2026-10-25: "the way question sets get created could be improved
 * if the prompt told the LLM what the question set was about, the category and
 * the list of other categories. we want to make sure the questions generated
 * related to that category and not what really belongs in another category."
 *
 * Before this, the builders said one of: "Organize questions into EXACTLY N
 * categories" plus a flat "Must include these categories: …" (scenarios,
 * trivia), or a bare "Category: X." with no word about the set's other
 * categories (polls). Nothing told the model that the categories are meant to
 * be distinct, so a question that fits two of them could land in either, and
 * a poll written for one category could be about another.
 *
 * Categories have names only — no descriptions exist anywhere in the repo —
 * so the model is told the NAMES of the other categories and the rule. The
 * set's own description and AI context are what give the names their meaning,
 * which is why the two travel together.
 *
 * Pure: no AWS, no logging. Every generator builds the same block from here so
 * the three cannot each grow their own reading of the rule.
 */

const ABOUT_MAX = 600;
const MAX_CATEGORIES = 24;

const clean = (v) => (typeof v === 'string' ? v.trim() : '');

/** At most `max` characters, cut at a word, so a long description cannot crowd out the task. */
function clip(text, max = ABOUT_MAX) {
  const t = clean(text).replace(/\s+/g, ' ');
  if (t.length <= max) return t;
  const cut = t.lastIndexOf(' ', max);
  return `${t.slice(0, cut > 0 ? cut : max).trim()}…`;
}

/**
 * Category names from either shape the builders send — an array, or the
 * comma-separated `mustHaveCategories` string — trimmed, de-duplicated
 * (case-insensitively) and capped at the 24 a set can hold.
 */
function categoryList(value) {
  const raw = Array.isArray(value) ? value : String(value ?? '').split(',');
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    const name = clean(typeof item === 'string' ? item : String(item ?? ''));
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= MAX_CATEGORIES) break;
  }
  return out;
}

/**
 * The set being added to, as the model should read it: its name, description
 * and AI context. `about` is `{ title, description, aiContext }`; '' when it
 * carries nothing.
 */
function aboutSetBlock(about) {
  if (!about || typeof about !== 'object') return '';
  const lines = [
    ['Set', clip(about.title, 200)],
    ['Description', clip(about.description)],
    ['Background for the AI', clip(about.aiContext ?? about.aiContextInstructions)],
  ].filter(([, v]) => v);
  if (lines.length === 0) return '';
  return `WHAT THIS SET IS ABOUT (every question must fit it):\n${lines.map(([k, v]) => `- ${k}: ${v}`).join('\n')}`;
}

/**
 * The category block.
 *
 *   target      the ONE category this run writes for ('' when the run spans several)
 *   categories  the set's categories (names). With a target, the others are
 *               the ones that question must NOT drift into.
 *   count       how many categories to use when no names are given
 *   total       how many questions the whole run makes, for "about N each"
 *
 * Returns '' when there is nothing to say (no target, no names, no count).
 */
function categoryBlock({ target = '', categories = [], count = 0, total = 0 } = {}) {
  const want = clean(target);
  const names = categoryList(categories);
  const others = names.filter((n) => n.toLowerCase() !== want.toLowerCase());

  if (want) {
    let p = `CATEGORY: every question in this run is for the category "${want}", and is filed under exactly that name.`;
    if (others.length > 0) {
      p += `\nThe set's other categories are: ${others.join(', ')}.`
        + ` A question that belongs better in one of those is not a "${want}" question:`
        + ` write a different one that only "${want}" fits.`;
    }
    return p;
  }

  const n = parseInt(count, 10) || 0;

  // SOME NAMED, MORE WANTED: "3 categories, must include Presidents". The
  // named ones are required, the model picks the rest, and none may overlap.
  if (names.length > 0 && n > names.length) {
    return [
      `CATEGORIES: organize the questions into EXACTLY ${n} categories - no more, no less. These must be among them, spelled exactly as written:`,
      ...names.map((name) => `- ${name}`),
      `Choose the other ${n - names.length} so that no two categories overlap, and file every question under the one`
        + ' category it clearly belongs to; a question that fits a named category belongs in that one.',
    ].join('\n');
  }

  if (names.length > 0) {
    const each = total > 0 ? Math.max(1, Math.round(total / names.length)) : 0;
    return [
      `CATEGORIES: file every question under exactly one of these ${names.length}, spelled exactly as written:`,
      ...names.map((n) => `- ${n}`),
      'Keep them distinct. Write each question for the category it fits best; a question that fits another'
        + ' category on this list as well, or better, belongs in that one. A question that fits none of them'
        + ' does not belong in this set.',
      ...(each > 0 && names.length > 1 ? [`Spread the questions across them, about ${each} in each.`] : []),
    ].join('\n');
  }

  if (n > 1) {
    return `CATEGORIES: organize the questions into EXACTLY ${n} categories - no more, no less. Choose categories`
      + ' that do not overlap, name each for what is in it, and file every question under the one category it'
      + ' clearly belongs to.';
  }
  if (n === 1) return 'CATEGORIES: file every question under one category, named for what the questions share.';
  return '';
}

module.exports = { categoryBlock, aboutSetBlock, categoryList, ABOUT_MAX };
