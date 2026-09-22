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
 * rejects: any builder root at or below the shelf's 10001; a builder root that
 * stops being position: fixed (it would then stack inside whatever it landed in).
 */
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', 'BuilderPage.css'), 'utf8');
const shelf = fs.readFileSync(path.join(__dirname, '..', 'components', 'QuestionSetsPanel.css'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

const block = (sheet, selector) => {
  const at = sheet.indexOf(`${selector} {`);
  if (at < 0) throw new Error(`no rule for ${selector}`);
  return sheet.slice(at, sheet.indexOf('}', at));
};
const zOf = (sheet, selector) => Number(/z-index:\s*(\d+)/.exec(block(sheet, selector))[1]);

const builders = [
  '.ai-scenario-builder-modal',
  '.trivia-ai-builder-modal',
  '.poll-ai-builder-modal',
  '.survey-ai-builder-modal',
];

test('the two host layers are where the ladder says they are', () => {
  expect(zOf(app, '.new-game-overlay')).toBe(10000);
  expect(zOf(shelf, '.qsets-scrim--over')).toBe(10001);
});

test.each(builders)('%s is fixed and paints above the host shelf', (selector) => {
  expect(block(css, selector)).toMatch(/position:\s*fixed/);
  expect(zOf(css, selector)).toBeGreaterThan(zOf(shelf, '.qsets-scrim--over'));
});

test('the builders portal to body, which is why the root z-index is the one that counts', () => {
  const panel = fs.readFileSync(path.join(__dirname, '..', 'components', 'QuestionsPanel.jsx'), 'utf8');
  expect(panel).toMatch(/createPortal\(/);
  expect(panel).toMatch(/document\.body/);
});
