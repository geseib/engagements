// The host page wires the console (host console spec §4.1, plan Task 8).
import fs from 'fs';
import path from 'path';

const page = fs.readFileSync(path.join(__dirname, '..', 'GameHostPage.jsx'), 'utf8');

test('the console renders only on two screens, round types, outside an event', () => {
  expect(page).toMatch(/const useConsole = twoSurfaces && !eventCode && \['call-and-answer', 'trivia', 'poll', 'wavelength'\]\.includes\(normalizeGameType\(currentGameType\)\)/);
  expect(page).toMatch(/useConsole \? \(\s*<HostConsole/);
});

test('the host-state read keeps the window status and the host notes', () => {
  expect(page).toMatch(/setPresentDetail\(data\.presentDetail \|\| null\)/);
  expect(page).toMatch(/setHostNotes\(data\.hostNotes \|\| null\)/);
  expect(page).toMatch(/onMessage\('presentChanged'/);
  expect(page).toMatch(/offMessage\('presentChanged'\)/);
});

test('in the console the composer is inline, not the dialog', () => {
  expect(page).toMatch(/<AskComposerBody/);
  // Never both: the dialog mounts only on one screen (one askc-title id).
  expect(page).toMatch(/\{askComposer && !useConsole && \(\s*<AskComposer\s/);
});

test('the console puts responses on the wall in the spotlight\'s own index space', () => {
  // `answers` is already the room's order (voting order at VOTE, tallyOrder at
  // RESULTS), the same array the stage cards index for openSpotlight.
  // Gated by the stage's readiness guard: no rows until this phase's land.
  expect(page).toMatch(/phase="VOTE" responses=\{stageResponsesReady \? answers : \[\]\} \{\.\.\.consoleGathering\}[^>]*onPutOnWall=\{openSpotlight\}/);
  expect(page).toMatch(/phase="RESULTS" responses=\{stageResponsesReady \? answers : \[\]\} \{\.\.\.consoleGathering\}[^>]*onPutOnWall=\{openSpotlight\}/);
  expect(page).toMatch(/const consoleGathering = \{\s*status: stageResponsesStatus,/);
});

test('the strip and the keys share one handler on both surfaces', () => {
  expect((page.match(/onView=\{stripOnView\}/g) || []).length).toBe(1);
  expect(page).toMatch(/onView: stripOnView/);
  expect((page.match(/interceptAdvance=\{consoleInterceptAdvance\}/g) || []).length).toBe(1);
  expect(page).toMatch(/interceptAdvance: consoleInterceptAdvance/);
  expect((page.match(/onBackKey=\{consoleOnBackKey\}/g) || []).length).toBe(1);
  expect(page).toMatch(/onBackKey: consoleOnBackKey/);
});

test('one screen still renders the stage', () => {
  expect(page).toMatch(/<Stage\b/);
});

test('the People rows go through the freshness guard, never a bare name lookup', () => {
  expect(page).toMatch(/const consolePeople = consolePeopleFor\(\{[\s\S]{0,200}answeredCount,/);
  expect(page).not.toMatch(/playersWhoAnswered\.includes\(name\) \? 'answered'/);
});

describe('the late list (late items Task 4)', () => {
  test('read from /late on load and as the room moves, kept as lateItems and lateCounts', () => {
    expect(page).toMatch(/const \[lateItems, setLateItems\] = useState\(\[\]\)/);
    expect(page).toMatch(/const \[lateCounts, setLateCounts\] = useState\(/);
    expect(page).toMatch(/fetchLate\(\{ fetchFn: authFetch, apiBase: API_BASE, gameId \}\)/);
    expect(page).toMatch(/loadLateRef\.current\(\);\s*\}, \[gameId, gameState\]\)/);
  });

  test('re-read on lateChanged, lateAnswerKept and a comment landing; handlers cleaned up', () => {
    expect(page).toMatch(/onMessage\('lateChanged', \(\) => \{ loadLateRef\.current\(\); \}\)/);
    expect(page).toMatch(/onMessage\('lateAnswerKept', \(\) => \{ loadLateRef\.current\(\); \}\)/);
    expect(page).toMatch(/onMessage\('commentPosted', \(\) => \{\s*loadRoundCommentsRef\.current\(\);[\s\S]{0,120}loadLateRef\.current\(\);/);
    expect(page).toMatch(/offMessage\('lateChanged'\)/);
    expect(page).toMatch(/offMessage\('lateAnswerKept'\)/);
  });

  test('the rail gets the real items, the count and the two buttons', () => {
    expect(page).not.toMatch(/late: \[\],/);
    expect(page).toMatch(/late: consoleLate,\s*lateCount: lateCounts\.notReviewed,\s*onLateShow: showLateOnWall,\s*onLateMark: markLateReviewed,/);
  });

  test('Show on the wall reuses the feature route and the Ideas pick; Mark reviewed is the review route', () => {
    expect(page).toMatch(/const showLateOnWall = async \(item\) => \{[\s\S]{0,400}featureComment\(\{[\s\S]{0,200}commentId: item\.ref, questionNumber: item\.round, featured: true/);
    expect(page).toMatch(/pickIdea\(\{ fetchFn: authFetch, apiBase: API_BASE, gameId, round: item\.round, askId: item\.askId, id: item\.id, picked: true \}\)/);
    expect(page).toMatch(/reviewLateItem\(\{ fetchFn: authFetch, apiBase: API_BASE, gameId, item, how: 'read' \}\)/);
  });

  test('the Session panel\'s Rounds tab carries the full list; Review opens it there', () => {
    expect(page).toMatch(/late=\{\{\s*rounds: lateItems,\s*ended: gameState === 'ENDED',\s*commentsClosedAt,/);
    expect(page).toMatch(/const openLateList = \(\) => openSetupAt\('history'\)/);
  });
});
