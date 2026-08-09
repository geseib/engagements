/**
 * Tag vocabulary — frontend mirror of lambda-functions/admin/shared/tags.js.
 *
 * ⚠️ DUPLICATED ON PURPOSE, for the same reason game-types.js is: each Lambda
 * deploys from its own CodeUri, so the backend cannot import from src/. Keep the
 * two in lock-step.
 *
 * `tags` already exists on the AIPROMPT# rows with real values, e.g.
 * ["scenarios","amazon-principles","leadership","STAR"] — note the casing.
 * That inconsistency is exactly why comparisons must normalise BOTH sides:
 * a filter on "star" has to match a stored "STAR". Normalise on write,
 * tolerate on read.
 */

export const MIN_SUGGESTED_TAGS = 3;
export const MAX_TAGS = 6;
export const MAX_TAG_LENGTH = 40;

/** One tag → canonical lowercase kebab-case. Returns '' if nothing survives. */
export const normalizeTag = (raw) =>
  String(raw == null ? '' : raw)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_TAG_LENGTH)
    .replace(/-+$/g, '');

/** A list (array or comma string) → canonical, de-duplicated, capped. */
export const normalizeTags = (raw, { max = MAX_TAGS } = {}) => {
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
};

/**
 * Editing note: do NOT normalise on every keystroke. It eats the hyphen out of
 * "remote-" and the comma out of "a," the instant they are typed. Hold the raw
 * text in local state while editing and call `normalizeTags` on blur.
 */

/** Do two tag lists overlap? Normalises both sides first. */
export const tagsMatch = (candidateTags, wantedTags) => {
  const wanted = new Set(normalizeTags(wantedTags, { max: Infinity }));
  if (wanted.size === 0) return true;
  return normalizeTags(candidateTags, { max: Infinity }).some((t) => wanted.has(t));
};

/**
 * Tags → one CSV cell. Pipe-separated, matching the Options column's existing
 * convention in upload-questions.js. Normalising first guarantees kebab-case,
 * which is also why this is safe inside the naive `"${value}"` interpolation
 * the CSV generators use: a normalised tag cannot contain a quote or a comma.
 */
export const tagsToCsvCell = (tags) => normalizeTags(tags).join('|');
