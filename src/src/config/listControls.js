/**
 * THE COMMON LIST-CONTROLS MECHANISM — search, filter axes, sort, drop-exits.
 *
 * Three list screens grew the same shape independently: a search box that
 * OR-matches a handful of fields, a row of "all or one value" selects, an
 * optional sort, and — on the two screens that got the UX treatment — the
 * drop-exits from "nothing matches" (QuestionSetsPanel's `drops`,
 * PromptLibraryPanel's copy of it). Both copies carry the same comment: the
 * predicate lives in ONE place so the drop-counts cannot drift from the list
 * they describe. This module makes that guarantee structural instead of
 * copied: `applyListControls` and `computeDrops` both call
 * `makeListPredicate` on the same config, so there is no second predicate to
 * drift.
 *
 * IN `config/`, NOT `utils/`, for `config/tableCells.js`'s reason: this is
 * pure cross-screen logic imported by components in both the admin console and
 * the host surface, and `config/` is where such modules live without creating
 * component-to-component cycles. React-free so it can be unit-tested directly,
 * like `utils/archiveFiltering.js` (the React half is
 * `hooks/useListControls.js`).
 *
 * A CONFIG looks like:
 *
 *   {
 *     searchFields: ['name', 'description', (item) => item.tags],
 *     axes: {
 *       type:   { get: (item) => normalizeGameType(item.engagementType) },
 *       status: { get: (item) => item.status,
 *                 eq: (a, b) => canonical(a) === canonical(b) },
 *     },
 *     sorts: { newest: cmp, oldest: cmp },
 *     defaultSort: 'newest',
 *   }
 *
 * and a STATE is a plain object over the same keys:
 * `{ search, type, status, sort }`.
 *
 * WHY `eq` EXISTS AND IS PER-AXIS. The three screens do not compare an axis
 * the same way, and the difference is meaning, not style:
 *
 *   - question sets normalise only the ITEM side (`normalizeGameType(
 *     set.engagementType) !== type`): the filter's options come from the
 *     canonical registry, so its value is already canonical;
 *   - prompts normalise BOTH sides (`normalizeGameType(a) !==
 *     normalizeGameType(b)`): rows written before the ids were dashed store
 *     `callandanswer`, and the R3 defect was an exact-match filter that showed
 *     none of them;
 *   - prompt status folds the legacy `inactive` synonym onto `draft` on both
 *     sides, so rows the old importer wrote stay findable.
 *
 * The axis config owns that comparison. A shared predicate with one hardcoded
 * `===` would silently re-introduce whichever defect the screen had fixed.
 */

/** The sentinel meaning "don't filter on this axis" — the All… option. An axis
 *  may override it (`all: ''`, the archive browser's ANY) via its config. */
export const ALL = 'all';

const axisAll = (axis) => (axis && axis.all !== undefined ? axis.all : ALL);
const strictEq = (a, b) => a === b;

/**
 * A case-insensitive OR-includes matcher over the named fields.
 *
 * A field is a property name or a function of the item; a function may return
 * a string OR an array of strings (prompt tags, a session's several ids), and
 * arrays are flattened into the haystack. Absent values are skipped rather
 * than matched as the string "undefined". A blank or whitespace query matches
 * everything — the box being empty is not a filter.
 */
export function makeSearchMatcher(fields) {
  return (item, query) => {
    const needle = String(query == null ? '' : query).trim().toLowerCase();
    if (!needle) return true;
    const hay = [];
    for (const field of fields) {
      const value = typeof field === 'function' ? field(item) : item[field];
      const parts = Array.isArray(value) ? value : [value];
      for (const part of parts) {
        if (part) hay.push(String(part).toLowerCase());
      }
    }
    return hay.some((part) => part.includes(needle));
  };
}

/**
 * THE ONE PREDICATE — `(item, state) => boolean`. Everything below that counts
 * or filters goes through this, which is what keeps the drop-exit numbers and
 * the list itself in agreement by construction.
 *
 * A state key that is absent is treated as that axis's All value, so partial
 * filter objects (`{ type: 'trivia' }`, the shape the exported per-screen
 * predicates have always accepted) keep working.
 */
export function makeListPredicate(config) {
  const searchMatcher = config.searchFields ? makeSearchMatcher(config.searchFields) : null;
  const axes = Object.entries(config.axes || {});
  return (item, state = {}) => {
    if (searchMatcher && !searchMatcher(item, state.search)) return false;
    for (const [key, axis] of axes) {
      const all = axisAll(axis);
      const value = state[key] === undefined ? all : state[key];
      if (value === all) continue;
      if (!(axis.eq || strictEq)(axis.get(item), value)) return false;
    }
    return true;
  };
}

/** One-call form of the predicate, for the per-screen `matches*Filters`
 *  exports that other modules and tests already import. */
export function matchesListFilters(item, config, state) {
  return makeListPredicate(config)(item, state);
}

/**
 * Filter, then sort. `state.sort` picks a comparator out of `config.sorts`,
 * falling back to `config.defaultSort`; with no sorts configured the incoming
 * order is preserved (the prompts screens render server order deliberately).
 * Always returns a new array — the input is never sorted in place.
 */
export function applyListControls(items, config, state = {}) {
  const predicate = makeListPredicate(config);
  const shown = items.filter((item) => predicate(item, state));
  const sorts = config.sorts || {};
  const comparator = sorts[state.sort] || sorts[config.defaultSort];
  return comparator ? shown.sort(comparator) : shown;
}

/**
 * THE EXITS FROM "NOTHING MATCHES". For each active control (the search, then
 * each axis in config order), count what the list would show with just that
 * one dropped — the OTHER filters still applied — and offer it only when the
 * count is positive: an exit that leads to another empty screen is not an
 * exit. The counting predicate is the same `makeListPredicate(config)` the
 * list uses, which is the whole reason this function takes the config rather
 * than a callback.
 *
 * `labels` maps a key to `(value) => string` for the button text; the search
 * label receives the trimmed query. Returns
 * `[{ key, label, next, count }, …]`.
 */
export function computeDrops(items, config, state = {}, labels = {}) {
  const predicate = makeListPredicate(config);
  const candidates = [];
  const needle = String(state.search == null ? '' : state.search).trim();
  if (config.searchFields && needle) {
    candidates.push({
      key: 'search',
      label: labels.search ? labels.search(needle) : `Search “${needle}”`,
      next: { ...state, search: '' },
    });
  }
  for (const [key, axis] of Object.entries(config.axes || {})) {
    const all = axisAll(axis);
    const value = state[key] === undefined ? all : state[key];
    if (value === all) continue;
    candidates.push({
      key,
      label: labels[key] ? labels[key](value) : `${key}: ${value}`,
      next: { ...state, [key]: all },
    });
  }
  return candidates
    .map((candidate) => ({
      ...candidate,
      count: items.filter((item) => predicate(item, candidate.next)).length,
    }))
    .filter((candidate) => candidate.count > 0);
}

/** How many controls are currently narrowing the list. The sort never counts:
 *  reordering hides nothing, so it is not a filter and gets no drop-exit. */
export function activeFilterCount(config, state = {}) {
  let count = 0;
  if (config.searchFields && String(state.search == null ? '' : state.search).trim()) count += 1;
  for (const [key, axis] of Object.entries(config.axes || {})) {
    if (state[key] !== undefined && state[key] !== axisAll(axis)) count += 1;
  }
  return count;
}

/** The state a fresh mount starts from: empty search, every axis at All, the
 *  default sort when the config has one. */
export function initialListState(config) {
  const state = {};
  if (config.searchFields) state.search = '';
  for (const [key, axis] of Object.entries(config.axes || {})) {
    state[key] = axisAll(axis);
  }
  if (config.sorts) state.sort = config.defaultSort;
  return state;
}

/** The patch that clears ONE control — what a drop-exit applies. Patch-shaped
 *  rather than state-shaped so controlled parents merge it over their own
 *  object, exactly as the screens' hand-written `clearOne`s did. */
export function clearPatch(config, key) {
  if (key === 'search') return { search: '' };
  return { [key]: axisAll((config.axes || {})[key]) };
}

/** The patch that clears every filter and leaves the sort alone. */
export function clearAllPatch(config) {
  const patch = {};
  if (config.searchFields) patch.search = '';
  for (const [key, axis] of Object.entries(config.axes || {})) {
    patch[key] = axisAll(axis);
  }
  return patch;
}
