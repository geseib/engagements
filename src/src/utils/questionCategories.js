/**
 * CATEGORY IDENTITY FOR THE WORKING COPY — pure logic, no React, no fetch.
 *
 * ── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
 *
 * A category has no id of its own. Its identity is **its position**, and its
 * position is **the order it first appears in the CSV**, recomputed from
 * scratch on every save.
 *
 *   `lambda-functions/admin/upload-questions.js:441` declares `const categories
 *   = new Set()`, `:558` does `categories.add(category)` once per accepted row
 *   while walking rows top to bottom, and `:727-733` turns that insertion-
 *   ordered Set into `CATEGORY#c001…cNNN` and into `categoryNameToId`.
 *
 * Every consumer then treats that index as a **bit position** in one of three
 * eight-bit host masks — `HostMask1-8`, `HostMask9-16`, `HostMask17-24`:
 *
 *   - `lambda-functions/websocket/schema-compliant-manager.js:181` (`const
 *     bitPosition = i + 1`), `:195/:203/:211` (`bitPosition <= 8 / 16 / 24`,
 *     with **no else branch**) — the live writer;
 *   - the same file `:318-324` (`categoryIndex < 8 / 16 / 24`) for the counts
 *     arrays;
 *   - `src/src/config/setupPanel.js:57-68`, `lambda-functions/game/toggle-
 *     category.js:91`, `src/src/GameHostPage.jsx:4762`.
 *
 * Two consequences, and this module exists to make both of them visible to the
 * UI *before* the owner presses Save rather than after:
 *
 * **1. The 24 cap.** A category at index 24 (0-based) or beyond never reaches a
 * mask. It is stored, it is counted, and it is silently untoggleable — a host
 * can never turn it on, so its questions are unreachable in a live session.
 * Nothing anywhere refuses a 25th category today: neither `upload-questions.js`
 * nor `edit-question-set.js` nor `utils/csvPreflight.js` bounds the count. Sets
 * already over the cap therefore exist in the wild, which is why
 * `splitByReachability` exists alongside `canAddCategory` — the UI has to be
 * able to *show* an over-cap set, not merely refuse to make one.
 *
 * **2. Silent reindexing.** There is no per-question write; every add is a full
 * CSV replace (`components/QuestionsPanel.jsx` → `utils/questionRows.js:288`
 * `rowsToCsv`). So introducing a new category anywhere but after every existing
 * category's first appearance shifts every later category down one position:
 * the bit that meant "Strategy" starts meaning "Culture". The existing ↑/↓ row
 * reorder buttons can already do this today with no new feature involved, which
 * is why `comparePositions` takes two arbitrary row lists rather than being
 * specialised to insertion.
 *
 * ── THE RULE THIS MODULE OBEYS: AGREE WITH THE IMPORTER ────────────────────
 *
 * Where the importer is arguably wrong, this module is wrong the same way. A
 * derivation that is "more correct" than the backend is a derivation that lies
 * about what Save will produce, and that is the one failure mode a preview must
 * not have. Verified behaviours mirrored here:
 *
 *   - **Trimmed.** `upload-questions.js:453` reads every cell through
 *     `(values[idx] ?? '').trim()`, so `" Strategy"` and `"Strategy"` are one
 *     category.
 *   - **Case- and punctuation-SENSITIVE.** The Set holds raw trimmed strings
 *     and `:731` counts with `q.Category === categoryName`, so `Strategy` and
 *     `strategy` are **two** categories occupying **two** bit positions. That
 *     is very likely a latent defect; it is not this module's to fix, and
 *     folding case here would under-report positions the backend will really
 *     allocate. `utils/csvPreflight.js:284` already independently mirrors the
 *     same case-sensitive first-appearance rule.
 *   - **A row needs BOTH Category and Title.** `:493` is `if (title &&
 *     category)`, and only inside that branch does `:558` register the
 *     category. A row with a category and no title is skipped, contributes no
 *     count, and — if it is the only row carrying that category — creates no
 *     category at all. `rowProblems` (`questionRows.js:191-193`) refuses to save
 *     such a row anyway, so counting it would over-report a set that cannot be
 *     saved in that state.
 *   - **Tombstones do not exist.** `rowsToCsv` (`questionRows.js:289`) opens
 *     with `rows.filter((r) => !r.removed)`, so a removed row is never
 *     serialised and the importer never sees it. A category whose rows are ALL
 *     tombstoned therefore does not reach the CSV, is never added to the Set,
 *     and **does not occupy a position** — the categories after it move up. The
 *     flag is spelled `removed` on the row (`questionRows.js:96`, set by
 *     `QuestionsPanel.removeRow`), and an unsaved row is dropped outright
 *     rather than tombstoned, so `removed` is the only marker to honour.
 *
 * Counts come from the working copy for the same reason: `set.categoryCount` is
 * a stale integer from the last save (`QuestionSetEditor.jsx:303,539`) and
 * `GET /question-sets/{setId}/categories` serves the persisted version, which
 * the admin editor deliberately never calls (`QuestionSetEditor.jsx:530-535`).
 */

/**
 * Three eight-bit host masks, so twenty-four bits, so twenty-four categories.
 * A category at 0-based position 24 or beyond falls off the end of
 * `schema-compliant-manager.js:211`'s final `else if (bitPosition <= 24)` — a
 * branch with no `else` — and is never written into any mask. It is not an
 * error anywhere; it is simply invisible to the host.
 */
export const MAX_MASKABLE_CATEGORIES = 24;

/**
 * A cell as the importer reads it: `upload-questions.js:453`. Trim only —
 * deliberately no case folding, no collapsing of inner whitespace, no
 * punctuation stripping, because the importer's `Set` does none of those and
 * this module's whole contract is to predict what the importer will do.
 */
export function normalizeCategoryName(value) {
  return String(value ?? '').trim();
}

/**
 * Would this row reach the importer at all, and would the importer accept it?
 *
 * Two gates, both real: `rowsToCsv` drops tombstones before serialising, and
 * `upload-questions.js:493` skips any row missing Category or Title.
 */
export function rowWouldImport(row) {
  if (!row || row.removed) return false;
  return Boolean(normalizeCategoryName(row.category) && normalizeCategoryName(row.title));
}

/** The id the backend will mint for a 0-based position: `c001`, `c024`, `c100`. */
export function categoryIdForPosition(position) {
  return `c${String(position + 1).padStart(3, '0')}`;
}

/** Can a category at this 0-based position ever be toggled by a host? */
export function isReachablePosition(position) {
  return position >= 0 && position < MAX_MASKABLE_CATEGORIES;
}

/**
 * The categories the working copy will produce, in the order the importer will
 * number them.
 *
 * @param {Array} rows the editor's working copy (tombstones included; they are
 *   filtered here exactly as `rowsToCsv` filters them)
 * @returns {Array<{name: string, count: number, position: number,
 *   categoryId: string, reachable: boolean}>}
 *   `position` is 0-based — the same integer every consumer uses as
 *   `categoryIndex` — and `categoryId` is the 1-based `cNNN` the backend will
 *   store. `count` counts only rows that will actually import.
 */
export function deriveCategories(rows) {
  const order = [];
  const counts = new Map();

  for (const row of (rows || [])) {
    if (!rowWouldImport(row)) continue;
    const name = normalizeCategoryName(row.category);
    if (!counts.has(name)) {
      order.push(name);
      counts.set(name, 0);
    }
    counts.set(name, counts.get(name) + 1);
  }

  return order.map((name, position) => ({
    name,
    count: counts.get(name),
    position,
    categoryId: categoryIdForPosition(position),
    reachable: isReachablePosition(position),
  }));
}

/**
 * Split a derived list into the categories a host can toggle and the ones that
 * silently cannot be reached.
 *
 * Accepts either raw rows or an already-derived list, because the UI has both
 * at hand and re-deriving is cheap; `overBy` is the number of categories that
 * would have to be removed to bring the set back into range.
 */
export function splitByReachability(categoriesOrRows) {
  const categories = asDerived(categoriesOrRows);
  const reachable = categories.filter((c) => c.reachable);
  const unreachable = categories.filter((c) => !c.reachable);
  return { reachable, unreachable, overBy: unreachable.length };
}

/** Slots left before the next new category becomes untoggleable. Never negative. */
export function remainingCategorySlots(categoriesOrRows) {
  return Math.max(0, MAX_MASKABLE_CATEGORIES - asDerived(categoriesOrRows).length);
}

/**
 * May another category be created?
 *
 * This is the predicate behind `+ New category`. It answers only the cap
 * question — whether the *name* is new is `addQuestionImpact`'s business, since
 * reusing an existing category is always allowed even at 24 and even at 30.
 */
export function canAddCategory(categoriesOrRows) {
  return asDerived(categoriesOrRows).length < MAX_MASKABLE_CATEGORIES;
}

/**
 * What changes if the working copy goes from `beforeRows` to `afterRows`?
 *
 * Deliberately general. Insertion is one caller; the ↑/↓ reorder buttons
 * (`QuestionsPanel.jsx:702-719`) are another and can reindex a set today with
 * no new category involved; a bulk remove that empties a category is a third.
 *
 * @returns {{reindexed: boolean, moved: Array<{name, from, to}>,
 *   added: Array<{name, position, reachable}>, dropped: Array<{name, position}>,
 *   evicted: Array<{name, from, to}>, admitted: Array<{name, from, to}>}}
 *   `moved` lists categories that exist on both sides at different positions —
 *   i.e. bits whose meaning changed. `evicted` is the subset of those (plus any
 *   pushed out by an insertion) that crossed from reachable to unreachable, the
 *   consequence worth a warning of its own.
 */
export function comparePositions(beforeRows, afterRows) {
  const before = new Map(asDerived(beforeRows).map((c) => [c.name, c]));
  const after = new Map(asDerived(afterRows).map((c) => [c.name, c]));

  const moved = [];
  const evicted = [];
  const admitted = [];
  const dropped = [];

  for (const [name, was] of before) {
    const now = after.get(name);
    if (!now) {
      dropped.push({ name, position: was.position });
      continue;
    }
    if (now.position !== was.position) moved.push({ name, from: was.position, to: now.position });
    if (was.reachable && !now.reachable) evicted.push({ name, from: was.position, to: now.position });
    if (!was.reachable && now.reachable) admitted.push({ name, from: was.position, to: now.position });
  }

  const added = [];
  for (const [name, now] of after) {
    if (!before.has(name)) {
      added.push({ name, position: now.position, reachable: now.reachable });
    }
  }

  return { reindexed: moved.length > 0, moved, added, dropped, evicted, admitted };
}

/**
 * The earliest row index at which a row carrying a brand-new category can be
 * inserted **without** renumbering anything that already exists.
 *
 * The rule from the design note is "the new category must first appear after
 * every existing category's first appearance". The strict end of the list
 * always satisfies that, but it is not the only index that does — everything
 * from the last first-appearance onward is safe, and saying so lets the UI place
 * a row next to its siblings instead of exiling it to the bottom.
 *
 * Rows that would not import are invisible to the importer but still occupy an
 * index in the array the UI splices into, so the returned index is an index into
 * `rows` as given, tombstones and all.
 */
export function safeInsertIndexForNewCategory(rows) {
  const appearances = firstAppearances(rows);
  return appearances.length ? appearances[appearances.length - 1].index + 1 : 0;
}

/**
 * The earliest index at which a row in `categoryName` can be inserted without
 * changing ANY category's position — new category or existing one.
 *
 * An existing category is NOT automatically safe to insert early, which is the
 * intuitive answer and the wrong one. Placing a second "Gamma" row above
 * Gamma's current first appearance moves that first appearance, and therefore
 * moves Gamma's bit, shifting everything it jumped over.
 *
 * The exact rule is the same one in both cases: **a row is safe from just past
 * the first appearance of the category that precedes it in position order.** A
 * new category's predecessor is the last existing category, which is why this
 * collapses to `safeInsertIndexForNewCategory`; the first category has no
 * predecessor, so index 0 is safe for it.
 */
export function safeInsertIndex(rows, categoryName) {
  const appearances = firstAppearances(rows);
  const name = normalizeCategoryName(categoryName);
  const position = appearances.findIndex((c) => c.name === name);

  if (position === -1) return safeInsertIndexForNewCategory(rows);
  if (position === 0) return 0;
  return appearances[position - 1].index + 1;
}

/**
 * Each category that will import, in position order, paired with the index of
 * its first-appearing row **in `rows` as given** — tombstones and unimportable
 * rows included in the numbering, because that is the array the UI splices into.
 */
function firstAppearances(rows) {
  const seen = new Set();
  const appearances = [];
  (rows || []).forEach((row, index) => {
    if (!rowWouldImport(row)) return;
    const name = normalizeCategoryName(row.category);
    if (seen.has(name)) return;
    seen.add(name);
    appearances.push({ name, index });
  });
  return appearances;
}

/**
 * If I add a question in category X at this position, what happens?
 *
 * The one call the add-question flow needs before it commits. It answers all
 * three questions at once — is this category new, does placing it here move any
 * existing category's bit, and will the result be toggleable — by building the
 * hypothetical row list and diffing it, rather than by reasoning about indices
 * separately from the derivation and drifting from it.
 *
 * @param {Array} rows the current working copy
 * @param {{category: string, insertIndex?: number}} question the row to be
 *   added; `insertIndex` defaults to appending, which is the safe placement
 * @returns {{name, isNew, position, reachable, wouldExceedCap, safeInsertIndex,
 *   isSafePlacement, impact}}
 */
export function addQuestionImpact(rows, { category, insertIndex } = {}) {
  const list = rows || [];
  const name = normalizeCategoryName(category);
  const existing = deriveCategories(list);
  const isNew = !existing.some((c) => c.name === name);

  const at = Number.isInteger(insertIndex)
    ? Math.max(0, Math.min(insertIndex, list.length))
    : list.length;

  // A title is required for the importer to accept the row at all, so the
  // hypothetical row carries one. Anything less would predict "no change" for
  // every add, which is the answer that would make this function useless.
  const hypothetical = [...list];
  hypothetical.splice(at, 0, { category: name, title: '(new question)', removed: false });

  const impact = comparePositions(list, hypothetical);
  const after = deriveCategories(hypothetical).find((c) => c.name === name) || null;

  return {
    name,
    isNew,
    position: after ? after.position : -1,
    reachable: after ? after.reachable : false,
    wouldExceedCap: isNew && !canAddCategory(existing),
    // Where this row COULD go without moving anything. Note this is not
    // "existing categories are always safe": inserting above a category's own
    // first appearance moves that category's bit too. See `safeInsertIndex`.
    safeInsertIndex: safeInsertIndex(list, name),
    isSafePlacement: !impact.reindexed,
    impact,
  };
}

/**
 * Accept either raw rows or an already-derived category list.
 *
 * A derived entry is recognised by carrying a numeric `position`; a row never
 * does. Keeping this one-way saves every caller from deciding whether it holds
 * rows or categories, which is the sort of thing that goes wrong once and then
 * reports the wrong count forever.
 */
function asDerived(input) {
  const list = input || [];
  if (list.length && typeof list[0] === 'object' && list[0] !== null
      && typeof list[0].position === 'number' && typeof list[0].name === 'string') {
    return list;
  }
  return deriveCategories(list);
}
