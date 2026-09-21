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
 * ONE RULE FOR THE COUNT AND THE CLICK. `setCarriesTag` below is the whole of
 * what "this set carries this tag" means, and both halves go through it: this
 * module counts with it and the library's tag filter matches with it. The
 * promise a few lines further down — the number beside a tag is the number of
 * rows clicking it produces — is then structural rather than a claim, in the
 * same way `config/listControls.js` makes the drop-counts structural by
 * refusing to own a second predicate.
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
 * One set's tags, canonical and de-duplicated — what this module means by
 * "the words this set carries".
 *
 * De-duplicated because the count is per SET and not per occurrence: a set
 * spelling a word two ways is one set carrying that tag, not two.
 */
function setTagsOf(set) {
  const raw = set && Array.isArray(set.tags) ? set.tags : [];
  const out = [];
  for (const candidate of raw) {
    const tag = normalizeTag(candidate);
    if (tag && !out.includes(tag)) out.push(tag);
  }
  return out;
}

/**
 * DOES THIS SET CARRY THIS TAG — and the reason this is exported rather than
 * inlined twice.
 *
 * The index's count and the library's tag filter are two halves of one
 * promise: the number beside a tag has to be the number of rows clicking it
 * produces. They were computed by two different rules, and so they disagreed.
 * `tagIndex` counted sets carrying the tag; the click dropped the word into
 * the free-text search box, which OR-matches a SUBSTRING across a set's name,
 * description, custom instruction AND tags — so a pill reading 1 could
 * produce three rows: the set that carries the tag, a set that merely says
 * the word in its name, and a set whose own longer tag begins with it.
 *
 * The count was the honest half and stayed. This is the rule it counts by,
 * and `QuestionSetsPanel`'s `tag` axis matches by the same function, so there
 * is no second rule left to drift. A whole-tag compare, never a substring:
 * `ancient-egypt` is a different word from `ancient`, and a person who asked
 * for one did not ask for the other.
 *
 * TOLERATES BOTH SIDES, like every other comparison in this repo that reads
 * these fields — the stored spelling may be anything, and the wanted one
 * comes from a pill, a saved filter or a URL one day.
 */
export function setCarriesTag(set, tag) {
  const wanted = normalizeTag(tag);
  if (!wanted) return false;
  return setTagsOf(set).includes(wanted);
}

/**
 * Every tag these sets carry, most-used first and then alphabetically — the
 * order that answers "what is this library about" before "what is in it".
 *
 * Counted per SET, not per occurrence, through `setTagsOf` — the same list
 * `setCarriesTag` reads, which is what makes the number beside a tag the
 * number of rows clicking it produces rather than merely a claim that it is.
 *
 * @returns {Array<{tag: string, count: number}>}
 */
export function tagIndex(sets = []) {
  const counts = new Map();
  for (const set of sets) {
    for (const tag of setTagsOf(set)) {
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
