/**
 * THE PLAYER'S OWN FEEDBACK BUTTON — the owner's ruling, 26 Sep 2026: *"the
 * player's own Feedback button works on any round whose results are showing,
 * without the host opening feedback mode. Host-triggered feedback mode stays
 * exactly as it is."*
 *
 * `PlayerPage.jsx` does not mount under jsdom (it dies on the auth provider —
 * see `feedbackRoundCallSite.test.js` and `FeedbackRoundPanel.jsx`'s own
 * doc-block), so this file asserts against the source the same way that one
 * does: read the file, strip comments, and check the shape of the wiring.
 * Comments are stripped because a previous agent's test in this repo passed
 * against a comment rather than code.
 */
const fs = require('fs');
const path = require('path');

const src = (...p) => path.join(__dirname, '..', ...p);

/** Source with every comment and string literal's comment-lookalikes removed. */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')      // block comments, including JSX {/* */}
    .replace(/^[ \t]*\/\/.*$/gm, '')       // whole-line // comments
    .replace(/([^:'"`\\])\/\/.*$/gm, '$1'); // trailing // comments, sparing URLs
}

const player = stripComments(fs.readFileSync(src('PlayerPage.jsx'), 'utf8'));

/** Every top-level `if (...) { ... } else if (...) { ... }` chain, balanced by
 *  brace depth, starting at the given anchor text. */
function sliceFrom(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  expect(start).toBeGreaterThan(-1);
  const end = endMarker ? text.indexOf(endMarker, start) : text.length;
  expect(end).toBeGreaterThan(start);
  return text.slice(start, end);
}

describe('the button on the ordinary results screen', () => {
  test('every RESULTS# arm gets a Feedback button, appended once rather than duplicated per game type', () => {
    // The three game-type branches (trivia / wavelength / call-and-answer) all
    // build `body` inside one `if (gameType === 'trivia') {...} else if
    // (gameType === 'wavelength') {...} else {...}` chain; the button is
    // appended once, after that chain closes, so the three cannot drift on
    // whether they offer it.
    const resultsArm = sliceFrom(
      player,
      "gameState.startsWith('RESULTS#')) {",
      'const betweenRounds = lastRankRef.current > 0;',
    );
    expect(resultsArm).toMatch(/onClick=\{openMyFeedback\}/);
    expect(resultsArm).toMatch(/plr-feedback-btn/);
    // Appended to whatever body the game-type branch built, not a replacement.
    expect(resultsArm).toMatch(/body = \(\s*<>\s*\{body\}/);
  });

  test('the host-triggered whole-room panel (feedbackRound) is a separate branch, checked first, and untouched', () => {
    // `else if (gameState.startsWith('RESULTS#') && feedbackRound)` must still
    // exist ahead of the ordinary RESULTS# arm, exactly as before this change.
    expect(player).toMatch(
      /else if \(gameState\.startsWith\('RESULTS#'\) && feedbackRound\) \{/,
    );
  });
});

describe('opening the player\'s own panel', () => {
  test('captures the round number from the live gameState', () => {
    const fn = sliceFrom(player, 'const openMyFeedback = () => {', '\n  };');
    expect(fn).toMatch(/RESULTS#\(\\d\+\)\$/);
    expect(fn).toMatch(/setMyFeedbackOpen\(true\)/);
  });

  test('snapshots the question and the responses rather than reading them live', () => {
    // The whole point: `currentQuestion`/`answers` get overwritten by the NEXT
    // round's data the instant the host advances, so the panel must read a
    // SNAPSHOT taken at open time, not those live values.
    const fn = sliceFrom(player, 'const openMyFeedback = () => {', '\n  };');
    expect(fn).toMatch(/setMyFeedbackSnapshot\(\{/);
    expect(fn).toMatch(/answers: Array\.isArray\(answers\) \? answers : \[\]/);

    const roundData = sliceFrom(player, 'const myFeedbackRoundData = myFeedbackSnapshot ? {', '} : null;');
    // Built from the snapshot, never from `currentQuestion` or `answers` directly.
    expect(roundData).toMatch(/\.\.\.myFeedbackSnapshot/);
    expect(roundData).not.toMatch(/currentQuestion/);
  });

  test('fetches Workie\'s read from the public ai-summary endpoint, never from GET /feedback-round', () => {
    // `readFeedbackRound` (comments.js) stays gated on the feedback beat and
    // the REPORT row the host alone can build — a player-initiated open must
    // not depend on either, so it goes through the public per-question route.
    const fn = sliceFrom(player, 'const loadMyFeedbackSummary = async (padded) => {', '\n  };');
    expect(fn).toMatch(/\/ai-summary\?questionId=/);
    expect(fn).not.toMatch(/feedback-round/);
  });

  test('reads existing comments through the public, beat-independent GET /comments, not fetchFeedbackRound', () => {
    const fn = sliceFrom(player, 'const loadMyFeedbackComments = async (padded) => {', '\n  };');
    expect(fn).toMatch(/fetchComments\(\{/);
  });
});

describe('while the panel is open', () => {
  test('the branch is checked before every gameState branch, including ENDED', () => {
    // `if (myFeedbackOpen)` has to be the FIRST condition in the chain: the
    // round can leave RESULTS while the player is mid-comment, and falling
    // through to whatever `gameState` says next would unmount the composer
    // and throw the draft away.
    const chainStart = player.indexOf('let body = null;');
    const openAt = player.indexOf('if (myFeedbackOpen) {', chainStart);
    const endedAt = player.indexOf("gameState === 'ENDED'", chainStart);
    expect(openAt).toBeGreaterThan(chainStart);
    expect(openAt).toBeLessThan(endedAt);
  });

  test('posts a comment through the same FeedbackRoundPanel the host-triggered mode uses', () => {
    const branch = sliceFrom(player, 'if (myFeedbackOpen) {', "gameState === 'ENDED'");
    expect(branch).toMatch(/<FeedbackRoundPanel/);
    expect(branch).toMatch(/round=\{myFeedbackRoundData\}/);
    expect(branch).toMatch(/onSubmit=\{submitMyFeedbackComment\}/);
  });

  test('says plainly when the round has moved on, and keeps the draft up rather than unmounting it', () => {
    const branch = sliceFrom(player, 'if (myFeedbackOpen) {', "gameState === 'ENDED'");
    // The panel itself always renders — only the banner is conditional — so a
    // draft mid-typing in FeedbackRoundPanel's own local state is never torn
    // down by this branch.
    expect(branch).toMatch(/const stillOpen = gameState === `RESULTS#\$\{myFeedbackNumber\}`/);
    expect(branch).toMatch(/moved on/i);
    expect(branch).toMatch(/<FeedbackRoundPanel/);
  });

  test('closing calls a dedicated close handler that posts nothing', () => {
    const branch = sliceFrom(player, 'if (myFeedbackOpen) {', "gameState === 'ENDED'");
    expect(branch).toMatch(/onClick=\{closeMyFeedback\}/);
    const fn = sliceFrom(player, 'const closeMyFeedback = () => {', '\n  };');
    expect(fn).toMatch(/setMyFeedbackOpen\(false\)/);
    expect(fn).not.toMatch(/postComment/);
  });
});

describe('posting from the player\'s own panel', () => {
  test('goes through the same postComment client helper, and appends optimistically to its own list', () => {
    const fn = sliceFrom(player, 'const submitMyFeedbackComment = async (draft) => {', '\n  };');
    expect(fn).toMatch(/postComment\(\{/);
    // Its own state — never the host-triggered `feedbackComments` — so the two
    // panels can never fight over one piece of state.
    expect(fn).toMatch(/setMyFeedbackComments/);
    expect(fn).not.toMatch(/setFeedbackComments/);
  });
});

describe('the player page still registers and removes its sockets symmetrically', () => {
  // Guards against this feature having quietly added a handler with no
  // matching offMessage — the exact defect feedbackRoundCallSite.test.js
  // exists to catch, re-run here because this file touches the same page.
  const registered = new Set(
    [...player.matchAll(/webSocketClient\.onMessage\(\s*'([^']+)'/g)].map((m) => m[1]),
  );
  const removed = new Set(
    [...player.matchAll(/webSocketClient\.offMessage\(\s*'([^']+)'/g)].map((m) => m[1]),
  );

  test('every handler registered is also removed', () => {
    const leaked = [...registered].filter((type) => !removed.has(type));
    expect(leaked).toEqual([]);
  });
});
