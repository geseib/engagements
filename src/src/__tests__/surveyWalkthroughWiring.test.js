/**
 * GameHostPage.jsx's wiring for the survey walk-through (Task 8, 2026-09-26
 * feature sweep) — read as source, the same technique
 * __tests__/scoreboardHostKeys.test.jsx uses for the scoreboard's own wiring,
 * because GameHostPage needs a live AuthProvider and socket and cannot mount
 * in jsdom at all.
 *
 * SurveyWalkthrough.jsx's own behaviour (cycling, keys, paging, no names) is
 * covered by __tests__/surveyWalkthrough.test.jsx, which mounts it directly.
 * This file only holds the PLACEMENT and GATING decisions that make the
 * component safe to reach from the page: which early return wins when both
 * flags are true, and that the page's own always-registered listeners
 * (`useScoreboardKeys`, the auto-mode timer) go quiet while it is open.
 */
const fs = require('fs');
const path = require('path');

const PAGE = fs.readFileSync(path.join(__dirname, '..', 'GameHostPage.jsx'), 'utf8');

describe('the walk-through is checked before the cut sheet', () => {
  test('showSurveyWalkthrough\'s early return appears before showSurveyResults\'s', () => {
    const walkthroughAt = PAGE.indexOf('if (showSurveyWalkthrough) {');
    const cutSheetAt = PAGE.indexOf('if (showSurveyResults) {');
    expect(walkthroughAt).toBeGreaterThan(-1);
    expect(cutSheetAt).toBeGreaterThan(-1);
    expect(walkthroughAt).toBeLessThan(cutSheetAt);
  });

  test('the cut sheet\'s own "Walk through" only flips the flag — no second fetch', () => {
    const cutSheetBlock = PAGE.slice(
      PAGE.indexOf('if (showSurveyResults) {'),
      PAGE.indexOf('if (showSurveyResults) {') + 800,
    );
    expect(cutSheetBlock).toMatch(/onPresent=\{\(\)\s*=>\s*setShowSurveyWalkthrough\(true\)\}/);
  });

  test('opened from the dock, presentSurveyResults clears showSurveyResults so leaving lands on the stage', () => {
    const fn = /const presentSurveyResults = async[\s\S]*?\n {2}\};/.exec(PAGE);
    expect(fn).not.toBeNull();
    expect(fn[0]).toMatch(/setShowSurveyResults\(false\)/);
    expect(fn[0]).toMatch(/setShowSurveyWalkthrough\(true\)/);
  });
});

describe('the page\'s own listeners go quiet while the presenter is open', () => {
  test('the auto-mode timer\'s blocking list carries showSurveyWalkthrough', () => {
    const block = /if \(showQuickstartMenu \|\| showWelcomeScreen \|\| showNewGameDialog[\s\S]*?return undefined;/.exec(PAGE);
    expect(block).not.toBeNull();
    expect(block[0]).toMatch(/\bshowSurveyWalkthrough\b/);
  });

  test('useScoreboardKeys is disabled while the presenter is open', () => {
    const hook = /useScoreboardKeys\(\{([\s\S]*?)\}\);/.exec(PAGE);
    expect(hook).not.toBeNull();
    expect(hook[1]).toMatch(/enabled:[\s\S]*?!showSurveyWalkthrough\b/);
  });

  test('the dispatch case exists and calls presentSurveyResults', () => {
    expect(PAGE).toMatch(/case HOST_INTENTS\.SURVEY_PRESENT:\s*\n\s*presentSurveyResults\(gameId, eventTitle\);/);
  });
});

describe('switching sessions cannot carry the presenter into the next one', () => {
  test('gameSessionSetters maps showSurveyWalkthrough', () => {
    const mapBody = /const gameSessionSetters = \{([\s\S]*?)\n {2}\};/.exec(PAGE);
    expect(mapBody).not.toBeNull();
    expect(mapBody[1]).toMatch(/showSurveyWalkthrough:\s*setShowSurveyWalkthrough,/);
  });

  test('config/gameSession.js declares the same key, false by default', () => {
    const gameSessionSrc = fs.readFileSync(path.join(__dirname, '..', 'config', 'gameSession.js'), 'utf8');
    expect(gameSessionSrc).toMatch(/showSurveyWalkthrough:\s*false,/);
  });
});
