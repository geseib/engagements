/**
 * Pure filter logic behind the archive browser.
 *
 * Kept free of React so it can be unit-tested directly — the archive panel
 * lives inside AdminPage, behind the auth provider, which makes a render test
 * of it impractical (same reasoning as utils/questionSetEditing).
 *
 * The problem this exists to solve: **game type is not a field on an archived
 * record.** `lambda-functions/admin/export-to-archive.js` folds it into two
 * places and neither is reliable on its own:
 *
 *   - `Category` — the question set's `engagementType` (or, for an AI prompt,
 *     its `gameType`), falling back to the literal string `general`. Records
 *     uploaded by hand through the panel's own modal instead carry a *topic*
 *     there (`business`, `education`, …), so Category is not always a type.
 *   - `Tags` — the same value again, alongside the environment, a
 *     `questions:<n>` count, and flags like `ai-generated`.
 *
 * Spellings vary too: prompts are stored under the AI-prompt key
 * (`callandanswer`), question sets under the canonical id (`call-and-answer`).
 * That is why filtering happens here, on values normalised through the
 * gameTypes registry, rather than as an exact-match `Category = :category`
 * FilterExpression on the server — the server comparison misses every record
 * that spells the type differently or carries it only in Tags.
 */

import { resolveGameType } from '../config/gameTypes';

/** Sentinel for "don't filter on this axis" — the value of the All… option. */
export const ANY = '';

/** An archived record's Tags as a plain, trimmed, non-empty string array. */
export function archiveTags(item) {
  const raw = item && item.Tags;
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : typeof raw.forEach === 'function' ? Array.from(raw) : [];
  return list
    .map((tag) => String(tag == null ? '' : tag).trim())
    .filter(Boolean);
}

/**
 * The game type an archived record represents, or null when it carries none.
 *
 * Category wins over Tags: for an exported record it is the engagement type
 * verbatim, whereas Tags is a grab-bag that could in principle hold a stray
 * type-shaped word.
 */
export function archiveGameType(item) {
  if (!item) return null;

  const fromCategory = resolveGameType(item.Category);
  if (fromCategory) return fromCategory;

  for (const tag of archiveTags(item)) {
    const fromTag = resolveGameType(tag);
    if (fromTag) return fromTag;
  }

  return null;
}

/**
 * Distinct tags across the loaded records, for the tag dropdown.
 *
 * Game-type spellings are dropped: they already have their own dropdown, and
 * listing `trivia` in both controls invites the reading that they are two
 * different filters. Everything else is kept as stored — `dev`, `ai-generated`,
 * `questions:24` — because guessing which of those the owner cares about is
 * not this module's call to make.
 */
export function collectArchiveTags(items) {
  const seen = new Map();

  for (const item of items || []) {
    for (const tag of archiveTags(item)) {
      if (resolveGameType(tag)) continue;
      const key = tag.toLowerCase();
      if (!seen.has(key)) seen.set(key, tag);
    }
  }

  return Array.from(seen.values()).sort((a, b) =>
    a.toLowerCase().localeCompare(b.toLowerCase())
  );
}

/**
 * Options for the tag dropdown, keeping the current selection listed even when
 * it is absent from the freshly loaded records — otherwise changing the type
 * filter silently blanks the tag control while it is still filtering.
 */
export function tagFilterOptions(items, selected) {
  const tags = collectArchiveTags(items);
  if (selected && !tags.some((tag) => tag.toLowerCase() === String(selected).toLowerCase())) {
    return [selected, ...tags];
  }
  return tags;
}

/** Does this record match the chosen tag? Comparison is case-insensitive. */
export function hasArchiveTag(item, tag) {
  if (!tag) return true;
  const wanted = String(tag).toLowerCase();
  return archiveTags(item).some((candidate) => candidate.toLowerCase() === wanted);
}

/**
 * Narrow the loaded records by game type and/or tag. An empty value on either
 * axis means "all", and an unknown game-type id filters to nothing rather than
 * quietly returning everything.
 */
export function filterArchiveItems(items, { gameType = ANY, tag = ANY } = {}) {
  const wantedType = gameType ? resolveGameType(gameType) : null;
  // A game type the registry doesn't know matches nothing. Letting it through
  // as `null` would make the filter mean "records with no type", which is the
  // opposite of what a stale or mistyped selection should show.
  if (gameType && !wantedType) return [];

  return (items || []).filter((item) => {
    if (gameType && archiveGameType(item) !== wantedType) return false;
    if (!hasArchiveTag(item, tag)) return false;
    return true;
  });
}
