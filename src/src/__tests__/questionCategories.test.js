/**
 * CATEGORY DERIVATION — utils/questionCategories.js
 *
 * The one thing this module must never do is disagree with
 * `lambda-functions/admin/upload-questions.js`. Its whole job is to predict,
 * before Save, what positions that handler will assign after Save — and a
 * prediction that is "more sensible" than the handler is simply a wrong
 * prediction, shown in a panel whose entire design is about telling the truth
 * about unsaved state.
 *
 * So the load-bearing test in this file is the last describe block: it does NOT
 * assert against hand-written expectations. It builds a working copy, runs it
 * through the REAL serialiser (`utils/questionRows.js` `rowsToCsv`, the one the
 * browser ships) into the REAL importer (the actual Lambda handler, with only
 * the AWS SDK stubbed), reads the `CATEGORY#` rows the handler tried to write,
 * and asserts they match `deriveCategories` name for name, id for id, count for
 * count. Every hand-written test above it is a faster, more legible echo of a
 * property that block proves against the code that will really run.
 *
 * Stubbing follows the established pattern in
 * `src/__tests__/pollCsvImportContract.test.jsx`: virtual jest.mock by module
 * name, because @aws-sdk is not installed under src/ and cannot be resolved.
 */

import {
  MAX_MASKABLE_CATEGORIES,
  normalizeCategoryName,
  rowWouldImport,
  categoryIdForPosition,
  isReachablePosition,
  deriveCategories,
  splitByReachability,
  remainingCategorySlots,
  canAddCategory,
  comparePositions,
  safeInsertIndexForNewCategory,
  safeInsertIndex,
  addQuestionImpact,
} from '../utils/questionCategories';

const { blankRow, rowsToCsv } = require('../utils/questionRows');

/** A minimal working-copy row. `origin: 'loaded'` so tombstones survive. */
const row = (category, title, extra = {}) =>
  blankRow({ origin: 'loaded', category, title, ...extra });

const names = (list) => list.map((c) => c.name);
const positions = (list) => Object.fromEntries(list.map((c) => [c.name, c.position]));

describe('deriveCategories — ordering', () => {
  // rejects: sorting the derived list alphabetically, or by count, or by any
  // other rule than first appearance. The importer's `new Set()` is insertion
  // ordered (upload-questions.js:441,558) and `:727` numbers c001..cNNN off that
  // insertion order, so any other sort hands the UI the wrong bit positions and
  // a host toggling "Strategy" toggles someone else's questions.
  test('order is first appearance in the rows, not alphabetical', () => {
    const rows = [
      row('Zebra', 'z1'),
      row('Alpha', 'a1'),
      row('Zebra', 'z2'),
      row('Mango', 'm1'),
    ];
    expect(names(deriveCategories(rows))).toEqual(['Zebra', 'Alpha', 'Mango']);
  });

  // rejects: emitting 1-based positions from deriveCategories, or forgetting the
  // padStart in the id. `position` must be the integer consumers use as
  // `categoryIndex` (schema-compliant-manager.js:318-324, setupPanel.js:57), and
  // `categoryId` must be the 1-based `cNNN` the backend stores.
  test('position is 0-based and categoryId is the 1-based padded cNNN', () => {
    const rows = [row('First', 'q1'), row('Second', 'q2')];
    const derived = deriveCategories(rows);
    expect(derived[0]).toMatchObject({ name: 'First', position: 0, categoryId: 'c001' });
    expect(derived[1]).toMatchObject({ name: 'Second', position: 1, categoryId: 'c002' });
    expect(categoryIdForPosition(23)).toBe('c024');
    expect(categoryIdForPosition(99)).toBe('c100');
  });

  // rejects: dropping the empty-rows guard and returning `[{name: undefined}]`
  // or throwing on the editor's initial state.
  test('an empty or nullish working copy derives nothing', () => {
    expect(deriveCategories([])).toEqual([]);
    expect(deriveCategories(null)).toEqual([]);
    expect(deriveCategories(undefined)).toEqual([]);
  });
});

describe('deriveCategories — counts and what the importer will actually accept', () => {
  // rejects: counting tombstoned rows. `rowsToCsv` (questionRows.js:289) filters
  // `!r.removed` before serialising, so a removed row never reaches the
  // importer; counting it shows "Strategy · 3" for a set that will save with 2.
  test('tombstoned rows do not count', () => {
    const rows = [
      row('Strategy', 's1'),
      row('Strategy', 's2', { removed: true }),
      row('Strategy', 's3'),
    ];
    expect(deriveCategories(rows)).toEqual([
      expect.objectContaining({ name: 'Strategy', count: 2 }),
    ]);
  });

  // rejects: treating a fully-tombstoned category as still occupying a bit
  // position. It never reaches the CSV at all, so the importer never sees it and
  // every category after it moves UP one. A UI that kept its slot would show
  // every later category on the wrong bit.
  test('a category whose rows are all tombstoned vanishes and later categories move up', () => {
    const rows = [
      row('Keep', 'k1'),
      row('Doomed', 'd1', { removed: true }),
      row('Doomed', 'd2', { removed: true }),
      row('Later', 'l1'),
    ];
    const derived = deriveCategories(rows);
    expect(names(derived)).toEqual(['Keep', 'Later']);
    expect(positions(derived)).toEqual({ Keep: 0, Later: 1 });
  });

  // rejects: registering a category from a row the importer will skip.
  // upload-questions.js:493 is `if (title && category)` and `categories.add` at
  // :558 lives INSIDE that branch, so a row with a category and no title creates
  // nothing. rowProblems (questionRows.js:191) refuses to save such a row
  // anyway, so counting it promises a position that Save cannot deliver.
  test('a row with a category but no title creates no category and adds no count', () => {
    const rows = [
      row('Real', 'r1'),
      row('Ghost', ''),
      row('Real', ''),
      row('Tail', 't1'),
    ];
    const derived = deriveCategories(rows);
    expect(names(derived)).toEqual(['Real', 'Tail']);
    expect(derived[0].count).toBe(1);
    expect(rowWouldImport(row('Ghost', ''))).toBe(false);
    expect(rowWouldImport(row('Ghost', 'g1'))).toBe(true);
  });

  // rejects: dropping the trim, which would let " Strategy" and "Strategy" hold
  // two bit positions in the UI while the importer's trimmed cell
  // (upload-questions.js:453) collapses them to one.
  test('surrounding whitespace is trimmed, matching the importer cell reader', () => {
    const rows = [row('  Strategy  ', 's1'), row('Strategy', 's2'), row('\tStrategy\n', 's3')];
    expect(deriveCategories(rows)).toEqual([
      expect.objectContaining({ name: 'Strategy', count: 3, position: 0 }),
    ]);
    expect(normalizeCategoryName('  Strategy  ')).toBe('Strategy');
    expect(normalizeCategoryName(null)).toBe('');
  });

  // rejects: "helpfully" lower-casing category names to merge Strategy with
  // strategy. The importer does NOT — its Set holds raw trimmed strings and
  // :731 counts with `===` — so folding case here under-reports by one position
  // and every category after the pair would be shown on the wrong bit. This is
  // arguably a backend defect; agreeing with it is still the correct behaviour
  // for a preview.
  test('case is significant, because it is significant to the importer', () => {
    const rows = [row('Strategy', 's1'), row('strategy', 's2'), row('STRATEGY', 's3')];
    const derived = deriveCategories(rows);
    expect(names(derived)).toEqual(['Strategy', 'strategy', 'STRATEGY']);
    expect(derived.map((c) => c.count)).toEqual([1, 1, 1]);
  });

  // rejects: letting a blank or whitespace-only category through as a category
  // named ''. The importer skips those rows entirely (:493), so a '' entry would
  // claim position 0 and shift every real category down one.
  test('blank and whitespace-only categories are not categories', () => {
    const rows = [row('   ', 'q1'), row('', 'q2'), row('Real', 'q3')];
    expect(deriveCategories(rows)).toEqual([
      expect.objectContaining({ name: 'Real', position: 0, count: 1 }),
    ]);
  });
});

/** n categories named Cat01.., one row each, in order. */
const rowsWithCategories = (n) =>
  Array.from({ length: n }, (_, i) => row(`Cat${String(i + 1).padStart(2, '0')}`, `q${i + 1}`));

describe('the 24 cap', () => {
  // rejects: changing the constant, which is not a free parameter — it is three
  // eight-bit masks (HostMask1-8, HostMask9-16, HostMask17-24) and the final
  // `else if (bitPosition <= 24)` in schema-compliant-manager.js:211 that has no
  // else branch.
  test('the limit is 24', () => {
    expect(MAX_MASKABLE_CATEGORIES).toBe(24);
  });

  // rejects: an off-by-one on the boundary in either direction — `<=` instead of
  // `<` would call position 24 (the 25th category) reachable and promise a host
  // toggle that can never exist; `< 23` would refuse a category that works.
  test('positions 0..23 are reachable and 24 is not', () => {
    expect(isReachablePosition(0)).toBe(true);
    expect(isReachablePosition(23)).toBe(true);
    expect(isReachablePosition(24)).toBe(false);
    expect(isReachablePosition(25)).toBe(false);
  });

  // rejects: the same off-by-one reached through the real derivation rather than
  // the predicate — the 24th category must be toggleable and the 25th must not.
  test('the 24th derived category is reachable, the 25th is not', () => {
    const derived = deriveCategories(rowsWithCategories(25));
    expect(derived).toHaveLength(25);
    expect(derived[23]).toMatchObject({ position: 23, categoryId: 'c024', reachable: true });
    expect(derived[24]).toMatchObject({ position: 24, categoryId: 'c025', reachable: false });
  });

  // rejects: `canAddCategory` using `<=` (which would let a 25th be created) or
  // firing one category early (which would refuse a legitimate 24th).
  test('canAddCategory allows the 24th and refuses the 25th', () => {
    expect(canAddCategory(rowsWithCategories(23))).toBe(true);
    expect(remainingCategorySlots(rowsWithCategories(23))).toBe(1);
    expect(canAddCategory(rowsWithCategories(24))).toBe(false);
    expect(remainingCategorySlots(rowsWithCategories(24))).toBe(0);
  });

  // rejects: modelling the cap as a hard invariant instead of a description.
  // Nothing in upload-questions.js, edit-question-set.js or csvPreflight.js
  // bounds the category count, so over-cap sets already exist; the UI has to be
  // able to SHOW one, which means splitByReachability must not throw, clamp the
  // list to 24, or report negative headroom.
  test('an already-over-cap set is described, not truncated or refused', () => {
    const derived = deriveCategories(rowsWithCategories(27));
    const { reachable, unreachable, overBy } = splitByReachability(derived);
    expect(reachable).toHaveLength(24);
    expect(unreachable).toHaveLength(3);
    expect(overBy).toBe(3);
    expect(names(unreachable)).toEqual(['Cat25', 'Cat26', 'Cat27']);
    expect(remainingCategorySlots(derived)).toBe(0);
    expect(canAddCategory(derived)).toBe(false);
  });

  // rejects: splitByReachability / canAddCategory / remainingCategorySlots
  // accepting only one of the two shapes. The UI holds rows in one place and a
  // derived list in another, and a helper that silently re-derives a derived
  // list (or treats rows as derived) reports a count of 0 without failing.
  test('the cap helpers accept raw rows and derived lists interchangeably', () => {
    const rows = rowsWithCategories(27);
    expect(splitByReachability(rows).overBy).toBe(splitByReachability(deriveCategories(rows)).overBy);
    expect(canAddCategory(rows)).toBe(canAddCategory(deriveCategories(rows)));
    expect(splitByReachability([]).reachable).toEqual([]);
  });
});

describe('reindex safety', () => {
  const base = () => [
    row('Alpha', 'a1'),
    row('Alpha', 'a2'),
    row('Beta', 'b1'),
    row('Gamma', 'g1'),
  ];

  // rejects: a reindex predicate hard-wired to false (or to "only when over the
  // cap"). Introducing a new category before an existing one's first appearance
  // shifts every later category down a bit, which is the silent corruption the
  // whole feature exists to prevent, and it must be reported as a change.
  test('a NEW category inserted early reindexes everything after it', () => {
    const impact = addQuestionImpact(base(), { category: 'Delta', insertIndex: 1 });
    expect(impact.isNew).toBe(true);
    expect(impact.isSafePlacement).toBe(false);
    expect(impact.impact.reindexed).toBe(true);
    expect(impact.impact.moved).toEqual([
      { name: 'Beta', from: 1, to: 2 },
      { name: 'Gamma', from: 2, to: 3 },
    ]);
    expect(impact.position).toBe(1);
  });

  // rejects: a predicate hard-wired to true, or one that reports a move for the
  // appended category itself. Appending is the safe placement the design
  // mandates and must come back clean, otherwise the UI warns on every add and
  // the warning stops meaning anything.
  test('a NEW category appended reindexes nothing', () => {
    const impact = addQuestionImpact(base(), { category: 'Delta' });
    expect(impact.isNew).toBe(true);
    expect(impact.isSafePlacement).toBe(true);
    expect(impact.impact.reindexed).toBe(false);
    expect(impact.impact.moved).toEqual([]);
    expect(impact.impact.added).toEqual([{ name: 'Delta', position: 3, reachable: true }]);
    expect(impact.position).toBe(3);
  });

  // rejects: the intuitive shortcut "an existing category can go anywhere,
  // only NEW categories reindex". It is false, and it was in this module's own
  // comments until this test failed. A second "Gamma" row placed above Gamma's
  // current first appearance MOVES that first appearance, so Gamma's bit
  // becomes 0 and Alpha's and Beta's both shift — a silent reindex with no new
  // category involved at all.
  test('an EXISTING category inserted above its own first appearance DOES reindex', () => {
    const impact = addQuestionImpact(base(), { category: 'Gamma', insertIndex: 0 });
    expect(impact.isNew).toBe(false);
    expect(impact.isSafePlacement).toBe(false);
    expect(impact.position).toBe(0);
    expect(impact.impact.moved).toEqual([
      { name: 'Alpha', from: 0, to: 1 },
      { name: 'Beta', from: 1, to: 2 },
      { name: 'Gamma', from: 2, to: 0 },
    ]);
  });

  // rejects: over-correcting the above into "every add warns", and rejects a
  // conservative `safeInsertIndex` that returns the category's own first
  // appearance instead of just past its PREDECESSOR's. Beta may legitimately be
  // inserted at index 1 here — above Beta's own first row but still below
  // Alpha's — and a helper that said 2 would exile rows for no reason.
  test('an EXISTING category is safe from just past its predecessors first appearance', () => {
    const rows = base(); // Alpha(0), Alpha(1), Beta(2), Gamma(3)
    expect(safeInsertIndex(rows, 'Alpha')).toBe(0);  // no predecessor
    expect(safeInsertIndex(rows, 'Beta')).toBe(1);   // Alpha first appears at 0
    expect(safeInsertIndex(rows, 'Gamma')).toBe(3);  // Beta first appears at 2
    expect(safeInsertIndex(rows, 'Fresh')).toBe(4);  // after every first appearance

    expect(addQuestionImpact(rows, { category: 'Beta', insertIndex: 1 }).isSafePlacement).toBe(true);
    expect(addQuestionImpact(rows, { category: 'Beta', insertIndex: 4 }).isSafePlacement).toBe(true);
    expect(addQuestionImpact(rows, { category: 'Beta', insertIndex: 0 }).isSafePlacement).toBe(false);
    expect(addQuestionImpact(rows, { category: 'Gamma', insertIndex: 2 }).isSafePlacement).toBe(false);
    expect(addQuestionImpact(rows, { category: 'Beta' }).safeInsertIndex).toBe(1);
  });

  // rejects: reporting a bare "positions changed" without naming the category
  // that fell out of maskable range. At exactly 24 categories an early insert
  // does not merely renumber — it pushes the last one permanently out of every
  // host mask, and that consequence deserves its own field.
  test('at 24 categories an early new category evicts the last one from the masks', () => {
    const rows = rowsWithCategories(24);
    const impact = addQuestionImpact(rows, { category: 'Wedge', insertIndex: 0 });
    expect(impact.wouldExceedCap).toBe(true);
    expect(impact.impact.evicted).toEqual([{ name: 'Cat24', from: 23, to: 24 }]);
    expect(impact.impact.moved).toHaveLength(24);
  });

  // rejects: computing the safe index as a blind `rows.length` while claiming to
  // implement "after every existing category's first appearance", and rejects
  // an off-by-one that returns the last first-appearance itself (inserting AT
  // that index puts the new category ahead of it).
  test('safeInsertIndexForNewCategory is just past the last first appearance', () => {
    const rows = [
      row('Alpha', 'a1'),
      row('Beta', 'b1'),   // last first appearance, index 1
      row('Alpha', 'a2'),
      row('Beta', 'b2'),
    ];
    expect(safeInsertIndexForNewCategory(rows)).toBe(2);
    expect(addQuestionImpact(rows, { category: 'New', insertIndex: 2 }).isSafePlacement).toBe(true);
    expect(addQuestionImpact(rows, { category: 'New', insertIndex: 1 }).isSafePlacement).toBe(false);
    expect(safeInsertIndexForNewCategory([])).toBe(0);
  });

  // rejects: a safe index computed over rows the importer will never see. A
  // tombstoned or title-less row holds an array slot but contributes no
  // category, so counting it as a first appearance would push the safe index
  // past rows that still matter — or, worse, treating it as a first appearance
  // would return an index that is not actually safe.
  test('rows that will not import do not move the safe insert index', () => {
    const rows = [
      row('Alpha', 'a1'),
      row('Ghost', 'g1', { removed: true }),
      row('Untitled', ''),
    ];
    expect(safeInsertIndexForNewCategory(rows)).toBe(1);
  });

  // rejects: specialising the reindex check to insertion only. The ↑/↓ reorder
  // buttons (QuestionsPanel.jsx:702-719) can reindex a set today with no new
  // category involved, so the comparison must work on any two working copies.
  test('comparePositions catches a reorder that swaps two categories bits', () => {
    const before = [row('Alpha', 'a1'), row('Beta', 'b1')];
    const after = [before[1], before[0]];
    const diff = comparePositions(before, after);
    expect(diff.reindexed).toBe(true);
    expect(diff.moved).toEqual([
      { name: 'Alpha', from: 0, to: 1 },
      { name: 'Beta', from: 1, to: 0 },
    ]);
    expect(comparePositions(before, before).reindexed).toBe(false);
  });

  // rejects: silently losing a category from the report when its last live row
  // is removed. `dropped` is how the UI can say "Beta is gone" rather than
  // showing Gamma sitting on Beta's old bit with no explanation.
  test('comparePositions reports a category dropped by a removal', () => {
    const before = [row('Alpha', 'a1'), row('Beta', 'b1'), row('Gamma', 'g1')];
    const after = [before[0], { ...before[1], removed: true }, before[2]];
    const diff = comparePositions(before, after);
    expect(diff.dropped).toEqual([{ name: 'Beta', position: 1 }]);
    expect(diff.moved).toEqual([{ name: 'Gamma', from: 2, to: 1 }]);
  });
});

/* ------------------------------------------------------------------------- */
/* THE ANCHOR: the same rows, derived here and derived by the real importer.  */
/* ------------------------------------------------------------------------- */

const TABLE_NAME = 'engage-test-table';

let mockSend;

jest.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: class {} }), { virtual: true });

jest.mock('@aws-sdk/lib-dynamodb', () => {
  const kinded = (kind) => class {
    constructor(input) {
      this.input = input;
      this.__kind = kind;
    }
  };
  return {
    DynamoDBDocumentClient: { from: () => ({ send: (command) => mockSend(command) }) },
    GetCommand: kinded('get'),
    QueryCommand: kinded('query'),
    BatchWriteCommand: kinded('batch'),
    UpdateCommand: kinded('update'),
  };
}, { virtual: true });

/**
 * Serialise a working copy exactly as the panel does, import it with the real
 * handler, and return the CATEGORY# rows it wrote — the backend's own answer to
 * "what are this set's categories, in what order, with what counts".
 */
async function importedCategories(rows, engagementType = 'call-and-answer') {
  process.env.TABLE_NAME = TABLE_NAME;
  const written = [];

  mockSend = (command) => {
    if (command.__kind === 'get') return Promise.resolve({});
    if (command.__kind === 'query') return Promise.resolve({ Items: [] });
    if (command.__kind === 'batch') {
      for (const request of command.input.RequestItems[TABLE_NAME]) {
        written.push(request.PutRequest.Item);
      }
    }
    return Promise.resolve({});
  };

  const { handler } = require('../../../lambda-functions/admin/upload-questions.js');
  const response = await handler({
    body: JSON.stringify({
      fileName: 'anchor.csv',
      fileContent: rowsToCsv(rows, engagementType),
      customTitle: 'Anchor Set',
      engagementType,
    }),
  });

  if (response.statusCode !== 200) {
    throw new Error(`importer returned ${response.statusCode}: ${response.body}`);
  }

  return written
    .filter((item) => String(item.SK).startsWith('CATEGORY#'))
    .map((item) => ({
      categoryId: String(item.SK).replace('CATEGORY#', ''),
      name: item.Name,
      count: item.QuestionCount,
    }));
}

describe('agreement with the REAL upload-questions.js handler', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  /**
   * One fixture carrying every rule at once: first-appearance order that is not
   * alphabetical, a repeated category, a tombstone, a fully-tombstoned category,
   * a title-less row, untrimmed whitespace, and a case-variant pair.
   */
  const mixedRows = () => [
    row('Zebra', 'z1'),
    row('  Zebra  ', 'z2'),
    row('Alpha', 'a1'),
    row('Ghost', 'gone1', { removed: true }),
    row('Ghost', 'gone2', { removed: true }),
    row('Alpha', 'untitled row', { title: '' }),
    row('zebra', 'lowercase z'),
    row('Mango', 'm1'),
    row('Alpha', 'a2'),
    row('   ', 'blank category'),
  ];

  // rejects: ANY divergence from the backend — alphabetical sorting, case
  // folding, counting tombstones, counting title-less rows, dropping the trim,
  // or 1-based positions. Neither side of this assertion is hand-written: the
  // expectation comes from the handler that will really run at Save time.
  test('deriveCategories matches the handler name for name, id for id, count for count', async () => {
    const rows = mixedRows();
    const fromHandler = await importedCategories(rows);
    const fromUtil = deriveCategories(rows).map(({ categoryId, name, count }) => ({
      categoryId, name, count,
    }));

    expect(fromHandler.length).toBeGreaterThan(0);
    expect(fromUtil).toEqual(fromHandler);
  });

  // rejects: a divergence that only shows up at scale — specifically an id
  // built without padStart (c9 vs c009) and a boundary miscount at exactly the
  // mask limit. The handler mints the ids; this asserts ours are the same
  // strings, and that the util's reachability flags fall on the right side of
  // the handler's 24th and 25th.
  test('over-cap ids agree with the handler, and the util flags 25+ as unreachable', async () => {
    const rows = rowsWithCategories(26);
    const fromHandler = await importedCategories(rows);
    const fromUtil = deriveCategories(rows);

    expect(fromUtil.map((c) => c.categoryId)).toEqual(fromHandler.map((c) => c.categoryId));
    expect(fromUtil.map((c) => c.name)).toEqual(fromHandler.map((c) => c.name));
    expect(fromHandler[23].categoryId).toBe('c024');
    expect(fromHandler[24].categoryId).toBe('c025');
    expect(fromUtil[23].reachable).toBe(true);
    expect(fromUtil[24].reachable).toBe(false);
    expect(fromUtil[25].reachable).toBe(false);
  });

  // rejects: predicting a reindex the handler would not perform, or missing one
  // it would. The prediction is checked against the handler twice — once for the
  // set as it stands and once for the set with the new row spliced in — so the
  // assertion is "the positions really did move", not "our diff says so".
  test('the reindex prediction is confirmed by re-importing the modified rows', async () => {
    const before = [row('Alpha', 'a1'), row('Beta', 'b1'), row('Gamma', 'g1')];

    const early = [...before];
    early.splice(1, 0, row('Delta', 'd1'));
    const appended = [...before, row('Delta', 'd1')];

    const beforeIds = await importedCategories(before);
    const earlyIds = await importedCategories(early);
    const appendedIds = await importedCategories(appended);

    const idOf = (list, name) => (list.find((c) => c.name === name) || {}).categoryId;

    // Predicted by the util…
    expect(addQuestionImpact(before, { category: 'Delta', insertIndex: 1 }).isSafePlacement).toBe(false);
    expect(addQuestionImpact(before, { category: 'Delta' }).isSafePlacement).toBe(true);

    // …and confirmed by the handler: the early insert moves Beta's and Gamma's
    // ids, the append leaves every existing id exactly where it was.
    expect(idOf(beforeIds, 'Beta')).toBe('c002');
    expect(idOf(earlyIds, 'Beta')).toBe('c003');
    expect(idOf(earlyIds, 'Gamma')).toBe('c004');
    expect(idOf(appendedIds, 'Beta')).toBe('c002');
    expect(idOf(appendedIds, 'Gamma')).toBe('c003');
    expect(idOf(appendedIds, 'Delta')).toBe('c004');
  });
});
