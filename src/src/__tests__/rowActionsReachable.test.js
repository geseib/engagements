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
