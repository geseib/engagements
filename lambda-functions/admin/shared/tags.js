/**
 * Tag vocabulary shared by generation, prompts and (eventually) question sets.
 *
 * `tags` is NOT a new field. It already exists on the AIPROMPT# rows with real
 * values — e.g. ["scenarios","amazon-principles","leadership","STAR"] on the
 * gen- prompts. That example is also why this module exists: the stored data is
 * NOT consistently cased, so anything that compares tags by string equality
 * ("STAR" vs "star") silently matches nothing. Same class of bug as the two
 * game-type spellings (see shared/game-types.js).
 *
 * The rule is therefore: NORMALISE ON WRITE, TOLERATE ON READ. Writers store
 * the canonical kebab-case form; readers put both sides through
 * `normalizeTag`/`normalizeTags` before comparing, so legacy rows keep matching
 * without a data migration.
 */

/** Suggest few enough that a tag actually partitions the set. */
const MIN_SUGGESTED_TAGS = 3;
const MAX_TAGS = 6;
/** Long enough for "amazon-principles", short enough to stay a tag not a sentence. */
const MAX_TAG_LENGTH = 40;

/**
 * One tag → canonical form: lowercase kebab-case, no leading/trailing dashes.
 * Returns '' for anything that normalises to nothing, so callers can filter.
 */
function normalizeTag(raw) {
  return String(raw == null ? '' : raw)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_TAG_LENGTH)
    .replace(/-+$/g, '');
}

/**
 * A list of tags → canonical, de-duplicated, capped.
 *
 * Accepts an array, a comma-separated string, or junk. Order is preserved
 * (first occurrence wins) because the model emits them roughly most- to
 * least-specific and that ordering is worth keeping.
 */
function normalizeTags(raw, { max = MAX_TAGS } = {}) {
  let list;
  if (Array.isArray(raw)) list = raw;
  else if (typeof raw === 'string') list = raw.split(',');
  else list = [];

  const seen = new Set();
  const out = [];
  for (const candidate of list) {
    const tag = normalizeTag(candidate);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Do two tag lists overlap? Both sides are normalised first, which is the
 * whole point — a filter on "star" has to match a stored "STAR".
 */
function tagsMatch(candidateTags, wantedTags) {
  const wanted = new Set(normalizeTags(wantedTags, { max: Infinity }));
  if (wanted.size === 0) return true;
  return normalizeTags(candidateTags, { max: Infinity }).some((t) => wanted.has(t));
}

module.exports = {
  MIN_SUGGESTED_TAGS,
  MAX_TAGS,
  MAX_TAG_LENGTH,
  normalizeTag,
  normalizeTags,
  tagsMatch,
};
