/**
 * THE AI BUILDERS MUST PAINT ABOVE THE HOST'S SHELF.
 *
 * QuestionsPanel.jsx portals the four AI builders to document.body, so their
 * roots stack against the ROOT stacking context — beside `.new-game-overlay`
 * (z 10000, styles.css) and the host shelf's `.qsets-scrim--over` (z 10001,
 * QuestionSetsPanel.css), not inside them. Found on test 2026-09-22: from the
 * host's Question sets dialog, "Add questions… → Write 6 more" ran the job and
 * built the review screen at z 4000, entirely hidden behind the editor. The
 * admin console never showed it because nothing there sits above 10000.
 *
 * Since experience plan 5e the four open in ONE window, components/AIBuilderDialog
 * (`ui-scrim aib-scrim` over a `ui-dialog`), so the rung is one declaration:
 * `.aib-scrim { --ui-scrim-z }`, read by `.ui-scrim`'s `z-index` (ui/Dialog.css),
 * which is `position: fixed`.
 *
 * rejects: the builders' rung at or below the shelf's 10001; the scrim it rides
 * on ceasing to be position: fixed (it would then stack inside whatever it
 * landed in); a builder that stops opening in that window.
 */
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const aib = read('components', 'AIBuilderDialog.css');
const dialog = read('components', 'ui', 'Dialog.css');
const shelf = read('components', 'QuestionSetsPanel.css');
const app = read('styles.css');

const block = (sheet, selector) => {
  const at = sheet.indexOf(`${selector} {`);
  if (at < 0) throw new Error(`no rule for ${selector}`);
  return sheet.slice(at, sheet.indexOf('}', at));
};
const zOf = (sheet, selector) => Number(/z-index:\s*(\d+)/.exec(block(sheet, selector))[1]);

test('the two host layers are where the ladder says they are', () => {
  expect(zOf(app, '.new-game-overlay')).toBe(10000);
  expect(zOf(shelf, '.qsets-scrim--over')).toBe(10001);
});

test('the builders\' scrim is fixed and its rung is above the host shelf', () => {
  expect(block(dialog, '.ui-scrim')).toMatch(/position:\s*fixed/);
  expect(block(dialog, '.ui-scrim')).toMatch(/z-index:\s*var\(--ui-scrim-z/);
  const rung = Number(/--ui-scrim-z:\s*(\d+)/.exec(block(aib, '.aib-scrim'))[1]);
  expect(rung).toBeGreaterThan(zOf(shelf, '.qsets-scrim--over'));
  // …and below the small confirm a builder asks from inside itself.
  expect(rung).toBeLessThan(zOf(dialog, '.ui-scrim.ui-scrim--top'));
});

test.each(['TriviaAIBuilder', 'PollAIBuilder', 'SurveyAIBuilder', 'AIScenarioBuilder'])(
  '%s opens in the one window', (name) => {
    const src = read('components', `${name}.jsx`);
    expect(src).toMatch(/<AIBuilderDialog\b/);
    expect(src).not.toMatch(/className="modal-overlay"/);
    expect(src).not.toMatch(/modal-content/);
  },
);

test('the window draws the shared scrim and declares dusk', () => {
  const jsx = read('components', 'AIBuilderDialog.jsx');
  expect(jsx).toMatch(/overlayClassName=\{`ui-scrim aib-scrim/);
  expect(jsx).toMatch(/theme="dark"/);
});

test('the builders portal to body, which is why the root z-index is the one that counts', () => {
  const panel = read('components', 'QuestionsPanel.jsx');
  expect(panel).toMatch(/createPortal\(/);
  expect(panel).toMatch(/document\.body/);
});
