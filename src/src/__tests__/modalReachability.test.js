/**
 * CAN YOU GET OUT OF A DIALOG THAT IS TALLER THAN THE SCREEN?
 *
 * Reported from real use on an iPad: the new-question dialog was cut off at the
 * bottom, would not scroll, and had no way to close. All three were one bug.
 * `.modal-overlay` was `align-items: center` with no `overflow`, and
 * `.modal-content` had no `max-height` and no `overflow`, so a dialog taller
 * than the viewport was centred — overflowing the top AND the bottom at once —
 * with no scroll container anywhere. The footer holding Cancel and Done was
 * below the fold and unreachable. With no Escape key on a tablet, and a backdrop
 * the question dialog deliberately makes inert so a stray tap cannot discard a
 * draft, there was no way out of the dialog at all.
 *
 * WHY THIS FILE PARSES CSS INSTEAD OF RENDERING.
 *
 * jsdom has no layout engine. It computes no heights, does no overflow, and
 * scrolls nothing — `getBoundingClientRect()` returns zeroes for every element
 * on the page. A test that rendered the dialog and asserted the footer was
 * visible would pass just as happily against the broken stylesheet, which is
 * precisely how 1,859 passing tests sat on top of this bug. So this reads the
 * stylesheet as text, the way questionSetsPalette.test.js and
 * hostQuestionSetsPalette.test.js already do for colour.
 *
 * What that buys is narrow and worth stating: it pins the CSS contract that
 * makes the dialog reachable. It cannot prove the dialog IS reachable in a
 * browser — only a real device can. Treat a green run here as "the fix has not
 * been reverted", not as "this works on an iPad".
 */
const fs = require('fs');
const path = require('path');

const GLOBAL_CSS = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

/** A rule's declaration block, read out of the stylesheet by exact selector. */
function block(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`(^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm'));
  if (!match) throw new Error(`No rule found for "${selector}" — did the selector get renamed?`);
  return match[2];
}

const overlay = () => block(GLOBAL_CSS, '.modal-overlay');

describe('a dialog taller than the screen stays reachable', () => {
  // rejects: the exact shape of the reported bug — a fixed, full-viewport scrim
  //          that clips its overflow. Without a scroll container the part of the
  //          dialog past the fold cannot be reached by any gesture.
  test('the scrim scrolls', () => {
    expect(overlay()).toMatch(/overflow-y:\s*auto/);
  });

  // rejects: restoring `align-items: center` on a scrolling scrim. Centring is
  //          the specific thing that makes the overflow unreachable: a flex child
  //          centred by the container overflows in BOTH directions, and a scroll
  //          container can only reach one of them. The card is centred by
  //          `margin: auto` instead, which yields once it stops fitting.
  test('the card is not centred by the flex container', () => {
    expect(overlay()).not.toMatch(/align-items:\s*center/);
    expect(overlay()).toMatch(/align-items:\s*flex-start/);
  });

  // rejects: dropping the margin rule while keeping flex-start, which would
  //          leave every short dialog in the app jammed against the top edge.
  //          The two halves of the fix only work as a pair.
  test('the card still centres itself while it fits', () => {
    expect(GLOBAL_CSS).toMatch(/\.modal-overlay\s*>\s*\*\s*\{[^}]*margin:\s*auto/);
  });

  // rejects: a scrim with no breathing room. At zero padding the card meets the
  //          viewport edge exactly, so the last row of a scrolled dialog reads as
  //          clipped even when it is fully scrollable.
  test('the scrim has padding, so a scrolled card does not touch the edge', () => {
    expect(overlay()).toMatch(/padding:\s*\S+/);
  });
});
