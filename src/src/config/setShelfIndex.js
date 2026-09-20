/**
 * WHAT IS ACTUALLY ON THE SHELVES — the counting half of the browse.
 *
 * `config/setTopics.js` is the closed VOCABULARY: fifteen shelves, always all
 * fifteen, because that is what a vocabulary is and what a picker must offer.
 * This module is the INVENTORY: which of those shelves a given list of sets
 * really sits on, which words those sets really carry, and how many each has.
 * The filter select is built from the first; the browse is built from this.
 *
 * REACT-FREE AND IN `config/`, for `config/listControls.js`'s reason: pure
 * cross-screen logic, unit-testable without a DOM, imported by a component
 * without creating a component-to-component cycle. The markup half is
 * `components/SetShelfBrowse.jsx`.
 *
 * COUNTED OVER THE WHOLE LIST IT IS GIVEN, never over the filtered view. The
 * owner asked to "see/search ALL tags", and a tag that vanishes from the index
 * because an unrelated type filter is set is not all of them. The list's own
 * count line ("41 sets · 3 shown") and the drop-exits under it are what keep
 * the TABLE honest; this stays an index of the library.
 *
 * TOLERATES ON READ, like everything else that reads these two fields: a shelf
 * it does not recognise is Unfiled rather than a sixteenth entry, and two
 * spellings of one word are one tag. `utils/tags.js` states the rule —
 * normalise on write, tolerate on read — and the AIPROMPT# rows carrying
 * `STAR` beside `leadership` are why it exists.
 */
import { resolveSetTopic, setTopicLabel, SET_TOPIC_IDS, UNFILED, UNFILED_LABEL } from './setTopics';
import { normalizeTag } from '../utils/tags';

/**
 * Every shelf these sets sit on, in picker order, with Unfiled last.
 *
 * A shelf with nothing on it is LEFT OUT rather than shown as a zero: an entry
 * that leads to an empty table is a dead end wearing a live one's clothes, and
 * `computeDrops` refuses to offer those for the same reason. The select above
 * the table still lists all fifteen — that control is the vocabulary.
 *
 * @param {Array} sets rows as `get-question-sets` projects them (`topic` raw).
 * @returns {Array<{id: string, label: string, count: number}>}
 */
export function topicIndex(sets = []) {
  const counts = new Map();
  for (const set of sets) {
    const id = resolveSetTopic(set && set.topic);
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  const out = [];
  for (const id of SET_TOPIC_IDS) {
    if (counts.has(id)) out.push({ id, label: setTopicLabel(id), count: counts.get(id) });
  }
  // Last, because Unfiled is a state and not a shelf — the same order the
  // filter's own options use.
  if (counts.has(UNFILED)) {
    out.push({ id: UNFILED, label: UNFILED_LABEL, count: counts.get(UNFILED) });
  }
  return out;
}

/**
 * Every tag these sets carry, most-used first and then alphabetically — the
 * order that answers "what is this library about" before "what is in it".
 *
 * Counted per SET, not per occurrence: one set spelling a word two ways is one
 * set carrying that tag, and the number beside a tag has to be the number of
 * rows clicking it produces.
 *
 * @returns {Array<{tag: string, count: number}>}
 */
export function tagIndex(sets = []) {
  const counts = new Map();
  for (const set of sets) {
    const raw = set && Array.isArray(set.tags) ? set.tags : [];
    const seen = new Set();
    for (const candidate of raw) {
      const tag = normalizeTag(candidate);
      if (!tag || seen.has(tag)) continue;
      seen.add(tag);
      counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => (b.count - a.count) || a.tag.localeCompare(b.tag));
}

/**
 * What both sides of the find box are compared as: lower-cased, with every
 * separator removed.
 *
 * DELIBERATELY NOT `normalizeTag`, which is the WRITE rule and produces kebab.
 * Folding the query to kebab would leave `cold-war` unreachable by "coldwar"
 * and `onboarding` unreachable by "on boarding" — the author chose where the
 * hyphens went, and nobody searching knows what they chose. Taking the
 * separators out of both sides makes the find box agree with either spelling,
 * which is the whole of "tolerate on read" applied to a search.
 */
const fold = (value) => String(value == null ? '' : value).toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * Narrow a tag index by what somebody typed into the find box.
 *
 * A query that folds to nothing (spaces, a lone hyphen) is not a filter — the
 * box being empty is not one either, exactly as `makeSearchMatcher` treats a
 * blank query.
 */
export function filterTagIndex(index = [], query) {
  const needle = fold(query);
  if (!needle) return index;
  return index.filter((entry) => fold(entry.tag).includes(needle));
}
