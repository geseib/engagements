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
/*
  READING ONLY styles.css IS HOW THE FOURTH INSTANCE HID.
  `.prompt-editor-overlay` carried the identical fault for the tallest form in
  the product, and this file could not see it because the rule lives in a
  component stylesheet. Every scrim gets checked now, wherever it is declared.
*/
const AIPM_CSS = fs.readFileSync(
  path.join(__dirname, '..', 'components', 'AIPromptManager.css'), 'utf8',
);

/** A rule's declaration block, read out of the stylesheet by exact selector. */
function block(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`(^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm'));
  if (!match) throw new Error(`No rule found for "${selector}" — did the selector get renamed?`);
  return match[2];
}

const overlay = () => block(GLOBAL_CSS, '.modal-overlay');

/*
 * NO COMPONENT STYLESHEET MAY REDECLARE THE GLOBAL SCRIM.
 *
 * THE FIFTH INSTANCE, and it hid from the very test written after the fourth.
 * This file's header already says "reading only styles.css is how the fourth
 * instance hid" — and then it read AIPromptManager.css for
 * `.prompt-editor-overlay` ONLY. A verbatim redeclaration of `.modal-overlay`
 * itself, in that same file, carrying the original broken shape
 * (`align-items: center`, no `overflow-y`), was invisible to every assertion
 * below, because they all read `GLOBAL_CSS`.
 *
 * It was inert only by luck: `index.jsx` imports `./App` before `./styles.css`,
 * so the component sheet injects first and loses on equal specificity. Swapping
 * two import lines would have re-broken every dialog in the product.
 *
 * So this asserts the ABSENCE of the global names anywhere but styles.css,
 * rather than adding a sixth per-file check that the seventh instance would
 * dodge in a file nobody remembered to list.
 */
describe('the global scrim is declared in exactly one place', () => {
  const GLOBAL_NAMES = ['.modal-overlay', '.modal-content'];
  const COMPONENT_CSS = fs.readdirSync(path.join(__dirname, '..', 'components'))
    .filter((f) => f.endsWith('.css'))
    .map((f) => ({ file: f, css: fs.readFileSync(path.join(__dirname, '..', 'components', f), 'utf8') }));

  test('there is at least one component stylesheet to check', () => {
    // rejects: the directory moving and this whole suite silently passing over
    // an empty list, which is the shape a vacuous guard takes.
    expect(COMPONENT_CSS.length).toBeGreaterThan(5);
  });

  for (const name of GLOBAL_NAMES) {
    // rejects: any component sheet re-declaring a selector styles.css owns.
    // Scoped uses (`.foo .modal-overlay`) are fine and are not matched — only a
    // rule whose selector STARTS with the global name at the top level.
    test(`no component stylesheet redeclares ${name}`, () => {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const offenders = COMPONENT_CSS
        .filter(({ css }) => new RegExp(`(^|\\})\\s*${escaped}\\s*(,[^{]*)?\\{`, 'm').test(css))
        .map(({ file }) => file);
      expect(offenders).toEqual([]);
    });
  }
});

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

/*
 * THE SAME FAULT, ONE COMPONENT OVER.
 *
 * Reported from an iPad during a trivia session: the setup panel's sizing was
 * wrong and the Switch game button "did not work". The button was fine. It sits
 * in the last section of the panel body, below a 180px QR code, and the body was
 * `flex: 1; overflow-y: auto` with no `min-height`. A flex item's default
 * `min-height: auto` resolves to its content height, so the body could not be
 * compressed, the overflow never existed for `overflow-y` to act on, and the
 * content grew past the panel's fixed bottom edge — taking the button with it.
 *
 * Same class as the `.modal-overlay` bug above: a container that reads as
 * scrollable and is not. jsdom cannot see either one.
 */
describe('the setup panel body actually scrolls', () => {
  const body = () => block(GLOBAL_CSS, '.setup-panel__body');

  // rejects: the exact shape of the reported bug. `overflow-y: auto` on a
  //          column flex child is inert without this — the item cannot shrink
  //          below its content, so there is never an overflow to scroll.
  test('the body can be compressed below its content', () => {
    expect(body()).toMatch(/min-height:\s*0/);
  });

  // rejects: removing the scroll while keeping min-height, which would clip the
  //          overflow instead of showing it — a different way to lose the button.
  test('the body still scrolls', () => {
    expect(body()).toMatch(/overflow-y:\s*auto/);
  });

  // rejects: leaving the header and tabs shrinkable. While the body refused to
  //          shrink, these are what the flex algorithm compressed instead, which
  //          is the "screen sizing" half of the same report.
  test('the header and tabs are not what gets compressed', () => {
    expect(block(GLOBAL_CSS, '.setup-panel__header')).toMatch(/flex:\s*none/);
    expect(block(GLOBAL_CSS, '.setup-panel__tabs')).toMatch(/flex:\s*none/);
  });
});

/*
 * THE PROMPT EDITOR, WHICH IS THE TALLEST FORM IN THE PRODUCT.
 *
 * Eleven field groups plus the variable inspector, the preflight panel and the
 * assembled preview — and its scrim carried the same `align-items: center` with
 * no overflow that trapped the question dialog. Its Save button is the first
 * thing past the fold, and unlike the others this overlay has no Escape handler
 * to fall back on: it does not use the Modal primitive at all.
 *
 * This block exists in this file rather than a new one because it is the same
 * bug, and because the reason it survived three previous fixes is that the
 * checks only ever read styles.css.
 */
describe('the prompt editor scrim is reachable too', () => {
  const scrim = () => block(AIPM_CSS, '.prompt-editor-overlay,\n.prompt-advisor-overlay');

  // rejects: the fourth recurrence of the centred-overflow trap, in the one
  //          place where the form is tallest and there is no Escape key.
  test('it scrolls and does not centre with the flex container', () => {
    expect(scrim()).toMatch(/overflow-y:\s*auto/);
    expect(scrim()).not.toMatch(/align-items:\s*center/);
  });

  // rejects: dropping the auto margin, which would jam every short prompt
  //          dialog against the top edge.
  test('the card still centres itself while it fits', () => {
    expect(AIPM_CSS).toMatch(/\.prompt-(editor|advisor)-overlay\s*>\s*\*[^{]*\{[^}]*margin:\s*auto/);
  });
});
