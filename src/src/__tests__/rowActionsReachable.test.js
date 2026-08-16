/**
 * THE LEFTMOST ROW BUTTON MUST NOT BE THE ONE THAT DISAPPEARS.
 *
 * Reported from real use: in the admin console the Edit button was cut off on
 * its left edge, and the host's set list did the same to Rename. One cause.
 * `.qsets-tbl td` is `overflow: hidden` and `.qsets-rowact` was
 * `justify-content: flex-end`, so once the buttons were wider than the cell the
 * group overflowed towards the START of the row — and a hidden overflow on the
 * leading edge is unreachable by any scroll, drag or resize. The column was also
 * 10%, which the console's own two buttons never fitted in, so the overflow was
 * not an edge case but the normal state.
 *
 * WHY THIS PARSES CSS INSTEAD OF RENDERING, again.
 *
 * jsdom has no layout engine: no widths, no overflow, no clipping. A rendered
 * test would find both buttons present and accessible in the DOM and pass —
 * which is exactly what every existing suite did while the button was visibly
 * cut in half on screen. So this asserts the stylesheet contract, following
 * questionSetsPalette.test.js's precedent of reading the CSS as text.
 *
 * The limit is worth stating plainly: this proves the alignment rule that caused
 * the clipping is gone. It cannot prove the buttons fit at any particular width
 * — only a browser can. Green here means "not reverted", not "looks right".
 */
const fs = require('fs');
const path = require('path');

const QS_CSS = fs.readFileSync(
  path.join(__dirname, '..', 'components', 'QuestionSetsPanel.css'),
  'utf8',
);
/* The prompt library copied this screen's shape when it converted to dusk
   (AUDIT §6.2 item 13) — table, chips, two empty states, a row action group —
   and copying a shape is exactly when a fixed bug comes back. Its row carries
   FOUR actions (Edit, Advisor, Copy to archive, Retire) where the sets row
   carries two, so it has more to lose off the leading edge, not less. */
const PLIB_CSS = fs.readFileSync(
  path.join(__dirname, '..', 'components', 'AIPromptManager.css'),
  'utf8',
);

/** A rule's declaration block, read out of the stylesheet by exact selector. */
function block(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`(^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm'));
  if (!match) throw new Error(`No rule for "${selector}" — renamed?`);
  return match[2];
}

const pct = (selector) => {
  const width = block(QS_CSS, selector).match(/width:\s*([\d.]+)%/);
  if (!width) throw new Error(`No percentage width on "${selector}"`);
  return parseFloat(width[1]);
};

describe('row action buttons stay reachable', () => {
  // rejects: the exact rule that caused the report. With a hidden overflow,
  //          end- and centre-alignment both push the spill onto the leading
  //          edge, where nothing can bring it back.
  test('the action row does not align in a way that clips its leading edge', () => {
    const rule = block(QS_CSS, '.qsets-rowact');
    expect(rule).not.toMatch(/justify-content:\s*(flex-end|end|center|right)/);
  });

  // rejects: dropping the auto margin along with `flex-end`, which would leave
  //          every row's controls jammed against the middle of the table. The
  //          two halves are one fix: auto margin right-aligns while it fits and
  //          collapses when it does not.
  test('the controls still sit to the right while they fit', () => {
    expect(QS_CSS).toMatch(/\.qsets-rowact\s*>\s*:first-child\s*\{[^}]*margin-left:\s*auto/);
  });

  // rejects: a nowrap row at narrow widths, where the fix above relocates the
  //          clipping rather than removing it. Wrapping costs a taller row and
  //          loses nothing.
  test('the controls wrap rather than overflow', () => {
    expect(block(QS_CSS, '.qsets-rowact')).toMatch(/flex-wrap:\s*wrap/);
  });

  // rejects: restoring the 10% column. The console's own Edit and Delete never
  //          fitted in a tenth of the table, which is why the clipping was the
  //          normal state rather than an edge case.
  test('the actions column is wide enough to have stopped being the problem', () => {
    expect(pct('.qsets-col-acts')).toBeGreaterThan(10);
  });

  // rejects: paying for the wider actions column out of a column that cannot
  //          absorb it. The name is the only cell here that ellipsizes; every
  //          other one holds a short fixed token and would clip instead.
  test('the width came out of the column that degrades gracefully', () => {
    const total = ['.qsets-col-set', '.qsets-col-type', '.qsets-col-qs',
      '.qsets-col-state', '.qsets-col-when', '.qsets-col-acts'].reduce((a, s) => a + pct(s), 0);
    expect(total).toBe(100);
    expect(block(QS_CSS, '.qsets-nm')).toMatch(/text-overflow:\s*ellipsis/);
  });
});

describe('the prompt library inherited the fix, not just the shape', () => {
  const pctP = (selector) => {
    const width = block(PLIB_CSS, selector).match(/width:\s*([\d.]+)%/);
    if (!width) throw new Error(`No percentage width on "${selector}"`);
    return parseFloat(width[1]);
  };

  // rejects: `.plib-rowact { justify-content: flex-end }`, which is what this
  //          rule actually said until the dusk conversion — copied from the
  //          sets screen BEFORE the sets screen was fixed.
  test('the action row does not align in a way that clips its leading edge', () => {
    expect(block(PLIB_CSS, '.plib-rowact'))
      .not.toMatch(/justify-content:\s*(flex-end|end|center|right)/);
  });

  test('the controls still sit to the right while they fit', () => {
    expect(PLIB_CSS).toMatch(/\.plib-rowact\s*>\s*:first-child\s*\{[^}]*margin-left:\s*auto/);
  });

  test('the controls wrap rather than overflow', () => {
    expect(block(PLIB_CSS, '.plib-rowact')).toMatch(/flex-wrap:\s*wrap/);
  });

  /*
    HARD RULE 11, AND IT IS ONLY HALF A RULE ON ITS OWN.

    Under `table-layout: auto` a declared width is a HINT. The State column's
    chips are `white-space: nowrap`, so their min-content width wins and grows
    the table until the actions column is narrower than the four buttons in it
    — which is the alignment fault above, arrived at from the other direction.
    Fixed layout plus declared widths is one contract, so both halves are here.
  */
  test('the table is fixed-layout, so its declared widths are widths', () => {
    expect(block(PLIB_CSS, '.plib-tbl')).toMatch(/table-layout:\s*fixed/);
  });

  test('every column is declared, and they add to 100', () => {
    const cols = ['.plib-col-name', '.plib-col-type', '.plib-col-cat',
      '.plib-col-state', '.plib-col-acts'];
    expect(cols.reduce((a, s) => a + pctP(s), 0)).toBe(100);
    // The four-button actions column needs more than the sets screen's two did.
    expect(pctP('.plib-col-acts')).toBeGreaterThanOrEqual(pct('.qsets-col-acts'));
  });

  test('the width comes out of the column that degrades gracefully', () => {
    // rejects: fixed layout landing without the truncation that makes it
    //          survivable. A fixed column with no ellipsis clips mid-glyph.
    expect(block(PLIB_CSS, '.plib-nm')).toMatch(/text-overflow:\s*ellipsis/);
    expect(block(PLIB_CSS, '.plib-nm')).toMatch(/min-width:\s*0/);
  });

  test('and the truncated name is still recoverable', () => {
    // rejects: a reduction with no recovery, which is a deletion (hard rule 7).
    const jsx = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'PromptLibraryPanel.jsx'), 'utf8');
    expect(jsx).toMatch(/className="plib-nm"\s+title=\{prompt\.name\}/);
  });
});
