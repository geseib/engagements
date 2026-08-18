/**
 * THE COMMON LIST-CONTROLS MECHANISM — config/listControls.js.
 *
 * Pure module, tested directly with no React and no DOM — the
 * archiveFiltering.test.js arrangement. The per-screen behaviour (which fields
 * each screen searches, which axes it folds) is asserted where it lives, in
 * questionSetsPanel/promptLibraryPanel/sessionsPanel; THIS file pins the
 * mechanism those screens now share, and above all the guarantee both donor
 * implementations carried as a comment: the drop-exit counts and the list are
 * computed by ONE predicate and cannot drift.
 */
import {
  ALL,
  activeFilterCount,
  applyListControls,
  clearAllPatch,
  clearPatch,
  computeDrops,
  initialListState,
  makeListPredicate,
  makeSearchMatcher,
  matchesListFilters,
} from '../config/listControls';

/* A stand-in for the prompts screen's two folded axes: aliases on the item
   side (`callandanswer`), synonyms on both sides (`inactive` ≡ `draft`). */
const dashType = (value) => String(value || '').replace(/callandanswer/, 'call-and-answer');
const foldStatus = (value) => (value === 'inactive' ? 'draft' : value);

const CONFIG = {
  searchFields: ['name', 'description', (item) => item.tags],
  axes: {
    type: { get: (item) => item.type, eq: (a, b) => dashType(a) === dashType(b) },
    status: { get: (item) => item.status, eq: (a, b) => foldStatus(a) === foldStatus(b) },
  },
  sorts: {
    newest: (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0),
    name: (a, b) => String(a.name || '').localeCompare(String(b.name || '')),
  },
  defaultSort: 'newest',
};

const ITEMS = [
  { name: 'Alpha', description: 'first', tags: ['retro'], type: 'callandanswer', status: 'inactive', createdAt: '2026-08-01' },
  { name: 'Bravo', description: 'second', type: 'trivia', status: 'active', createdAt: '2026-08-03' },
  { name: 'Charlie', tags: ['retro', 'merger'], type: 'call-and-answer', status: 'active', createdAt: '2026-08-02' },
];

const state = (patch = {}) => ({ search: '', type: ALL, status: ALL, sort: 'newest', ...patch });
const names = (items) => items.map((item) => item.name);

/* ------------------------------------------------------------------ search */

describe('makeSearchMatcher', () => {
  const matches = makeSearchMatcher(['name', 'description', (item) => item.tags]);

  test('ORs across every field, case-insensitively', () => {
    // rejects: a matcher that ANDs the fields, or one that compares raw case.
    expect(matches(ITEMS[0], 'ALPHA')).toBe(true);
    expect(matches(ITEMS[1], 'second')).toBe(true);
    expect(matches(ITEMS[1], 'alpha')).toBe(false);
  });

  test('a function field can return an array, and every element is searched', () => {
    // The prompts screen searches tags[]; the sessions screen reads several
    // ids. rejects: String(tags) coercion, which would match "retro,merger"
    // but is asserted here through the element that a joined string ALSO
    // contains — so the real rejection is the next line: a matcher that only
    // reads plain properties finds nothing in an array at all.
    expect(matches(ITEMS[2], 'merger')).toBe(true);
    expect(matches(ITEMS[0], 'retro')).toBe(true);
  });

  test('absent fields are skipped, not matched as the string "undefined"', () => {
    // rejects: hay.push(String(undefined)) — an item with no description would
    // match the search "undefined".
    expect(matches({ name: 'bare' }, 'undefined')).toBe(false);
    expect(matches({ name: 'bare' }, 'bare')).toBe(true);
  });

  test('a blank or whitespace query matches everything', () => {
    // rejects: treating "  " as a needle, which silently empties the list.
    expect(matches({ name: 'x' }, '')).toBe(true);
    expect(matches({ name: 'x' }, '   ')).toBe(true);
    expect(matches({ name: 'x' }, undefined)).toBe(true);
  });
});

/* --------------------------------------------------------------- predicate */

describe('the predicate and its per-axis eq', () => {
  test('an axis eq owns the comparison — an alias on the item side still matches', () => {
    // The R3 defect: an exact-match filter over rows that store
    // `callandanswer` shows none of them. rejects: a shared predicate with a
    // hardcoded ===, which would re-introduce it on every adopting screen.
    expect(matchesListFilters(ITEMS[0], CONFIG, state({ type: 'call-and-answer' }))).toBe(true);
    expect(matchesListFilters(ITEMS[0], CONFIG, state({ type: 'trivia' }))).toBe(false);
  });

  test('status synonyms fold on BOTH sides', () => {
    // The `inactive` rows the old importer wrote must be findable under Draft.
    // rejects: folding only the item side (filtering by the raw synonym would
    // then miss real draft rows) and only the filter side (the stored synonym
    // would be invisible under every option except All).
    expect(matchesListFilters(ITEMS[0], CONFIG, state({ status: 'draft' }))).toBe(true);
    expect(matchesListFilters({ status: 'draft' }, CONFIG, state({ status: 'inactive' }))).toBe(true);
    expect(matchesListFilters(ITEMS[0], CONFIG, state({ status: 'active' }))).toBe(false);
  });

  test('a missing state key means All, so partial filter objects keep working', () => {
    // The exported per-screen predicates have always accepted { type: 'x' }
    // with no search key — questionSetsPanel.test.jsx calls matchesFilters
    // exactly that way. rejects: reading state.search.trim() of undefined, and
    // rejects treating an absent axis key as "matches nothing".
    expect(matchesListFilters(ITEMS[1], CONFIG, { type: 'trivia' })).toBe(true);
    expect(matchesListFilters(ITEMS[1], CONFIG, { search: 'second' })).toBe(true);
  });

  test('an axis may declare its own All sentinel', () => {
    // utils/archiveFiltering.js uses ANY = '' for "don't filter"; the shared
    // mechanism has to be able to express that. rejects: hardcoding 'all'.
    const config = { axes: { kind: { get: (item) => item.kind, all: '' } } };
    expect(matchesListFilters({ kind: 'x' }, config, { kind: '' })).toBe(true);
    expect(matchesListFilters({ kind: 'x' }, config, { kind: 'y' })).toBe(false);
  });
});

/* -------------------------------------------------------------------- sort */

describe('applyListControls', () => {
  test('filters, then sorts by the named comparator', () => {
    expect(names(applyListControls(ITEMS, CONFIG, state({ sort: 'name' })))).toEqual([
      'Alpha', 'Bravo', 'Charlie',
    ]);
    expect(names(applyListControls(ITEMS, CONFIG, state()))).toEqual([
      'Bravo', 'Charlie', 'Alpha',
    ]);
    expect(names(applyListControls(ITEMS, CONFIG, state({ status: 'active', sort: 'name' })))).toEqual([
      'Bravo', 'Charlie',
    ]);
  });

  test('an unknown sort falls back to the default rather than crashing or passing raw order', () => {
    expect(names(applyListControls(ITEMS, CONFIG, state({ sort: 'nonsense' })))).toEqual([
      'Bravo', 'Charlie', 'Alpha',
    ]);
  });

  test('with no sorts configured the incoming order is preserved and the input is not mutated', () => {
    // The prompts screens render server order deliberately. rejects: sorting
    // in place, which would silently reorder the caller's state array.
    const input = [...ITEMS];
    const noSorts = { searchFields: CONFIG.searchFields, axes: CONFIG.axes };
    expect(names(applyListControls(input, noSorts, { search: '' }))).toEqual([
      'Alpha', 'Bravo', 'Charlie',
    ]);
    expect(applyListControls(input, CONFIG, state())).not.toBe(input);
    expect(names(input)).toEqual(['Alpha', 'Bravo', 'Charlie']);
  });
});

/* ------------------------------------------------------------------- drops */

describe('computeDrops, which must use the SAME predicate as the list', () => {
  test('each active control becomes a candidate, counted with the others still applied', () => {
    // search 'retro' (Alpha, Charlie) + status active (Bravo, Charlie) →
    // Charlie only; drop the search → active rows (2); drop the status →
    // retro rows (2). rejects: counting against NO other filters (both would
    // say 3), and rejects skipping the trim on the search label.
    const drops = computeDrops(ITEMS, CONFIG, state({ search: '  retro ', status: 'active' }));
    expect(drops.map(({ key, count }) => ({ key, count }))).toEqual([
      { key: 'search', count: 2 },
      { key: 'status', count: 2 },
    ]);
    expect(drops[0].label).toBe('Search “retro”');
  });

  test('THE NON-DRIFT GUARANTEE: drop counts agree with the list under an eq-folded axis', () => {
    /*
      This is the test that fails if computeDrops grows a predicate of its own.
      state: search 'zzz' (nothing) + status 'draft'. The search drop's count
      is the list under { search: '', status: 'draft' } — which contains Alpha
      ONLY because the status axis folds `inactive` onto `draft`. A drop
      implementation that re-compares with === (or any second copy of the
      predicate that misses the axis's eq) counts ZERO there, filters the
      candidate out, and offers no exit at all from a dead end that has one.
    */
    const stuck = state({ search: 'zzz', status: 'draft' });
    expect(applyListControls(ITEMS, CONFIG, stuck)).toHaveLength(0);

    const drops = computeDrops(ITEMS, CONFIG, stuck);
    const searchDrop = drops.find((drop) => drop.key === 'search');
    expect(searchDrop).toBeDefined();
    expect(searchDrop.count).toBe(1);
    expect(searchDrop.count).toBe(applyListControls(ITEMS, CONFIG, searchDrop.next).length);
  });

  test('a drop whose removal still yields nothing is not offered', () => {
    // rejects: `.filter(() => true)` — the mutation promptLibraryPanel.test's
    // first version survived. search 'zzz' matches nothing on its own, so
    // dropping the type still shows zero rows and must not be drawn.
    const drops = computeDrops(ITEMS, CONFIG, state({ search: 'zzz', type: 'trivia' }));
    expect(drops.map((drop) => drop.key)).toEqual(['search']);
  });

  test('labels come from the caller, keyed by axis, and the search label gets the trimmed needle', () => {
    const drops = computeDrops(ITEMS, CONFIG, state({ search: ' retro ', status: 'active' }), {
      search: (needle) => `Search "${needle}"`,
      status: (value) => `Status: ${value.toUpperCase()}`,
    });
    expect(drops.map((drop) => drop.label)).toEqual(['Search "retro"', 'Status: ACTIVE']);
  });
});

/* ----------------------------------------------------- counting and clearing */

describe('activeFilterCount and the clear helpers', () => {
  test('counts the trimmed search and every non-All axis, and never the sort', () => {
    // rejects: counting the sort (reordering hides nothing, so it gets no
    // drop-exit and no place in "these N filters"), and rejects counting a
    // whitespace-only search.
    expect(activeFilterCount(CONFIG, state())).toBe(0);
    expect(activeFilterCount(CONFIG, state({ sort: 'name' }))).toBe(0);
    expect(activeFilterCount(CONFIG, state({ search: '   ' }))).toBe(0);
    expect(activeFilterCount(CONFIG, state({ search: 'x', type: 'trivia', status: 'draft' }))).toBe(3);
  });

  test('initialListState is empty search, every axis at All, the default sort', () => {
    expect(initialListState(CONFIG)).toEqual({ search: '', type: ALL, status: ALL, sort: 'newest' });
  });

  test('clearPatch clears exactly one control; clearAllPatch clears every filter and leaves the sort alone', () => {
    // rejects: a drop-exit wired to clearAll — the defect the qsets suite
    // names: it throws away the two filters the operator meant to keep.
    expect(clearPatch(CONFIG, 'search')).toEqual({ search: '' });
    expect(clearPatch(CONFIG, 'type')).toEqual({ type: ALL });
    expect(clearAllPatch(CONFIG)).toEqual({ search: '', type: ALL, status: ALL });
  });

  test('the clear helpers respect a per-axis All sentinel', () => {
    const config = { axes: { kind: { get: (item) => item.kind, all: '' } } };
    expect(clearPatch(config, 'kind')).toEqual({ kind: '' });
    expect(clearAllPatch(config)).toEqual({ kind: '' });
    expect(initialListState(config)).toEqual({ kind: '' });
  });
});

/* --------------------------------------------------------------- the export */

describe('makeListPredicate is the one predicate', () => {
  test('matchesListFilters is the predicate applied once', () => {
    const predicate = makeListPredicate(CONFIG);
    const filters = state({ search: 'retro', status: 'active' });
    for (const item of ITEMS) {
      expect(matchesListFilters(item, CONFIG, filters)).toBe(predicate(item, filters));
    }
  });
});
