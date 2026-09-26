/**
 * THE PLAYER'S OWN FEEDBACK BUTTON — the owner's ruling, 26 Sep 2026: *"the
 * player's own Feedback button works on any round whose results are showing,
 * without the host opening feedback mode. Host-triggered feedback mode stays
 * exactly as it is."*
 *
 * `PlayerPage.jsx` mounts successfully elsewhere in this suite with the right
 * mocks (voteSwitching.test.jsx, PlayerPage.test.jsx) — the "does not mount
 * under jsdom" claim in `FeedbackRoundPanel.jsx`'s doc-block does not hold for
 * every scenario. The full mount harness those files build (WebSocketClient,
 * fetch, the join flow) is disproportionate for exercising this feature's
 * orchestration specifically, so THIS file still asserts against the source —
 * read the file, strip comments, and check the shape of the wiring — while
 * the parts of this feature that ARE cheaply testable behaviourally live
 * elsewhere: `rankedResultsFrom.test.js` (a pure function, imported directly,
 * no mount needed) and `feedbackRoundPanel.test.jsx`'s "lifted draft flag"
 * tests (FeedbackRoundPanel mounts trivially on its own, no auth or socket
 * mocking required). Comments are stripped here because a previous agent's
 * test in this repo passed against a comment rather than code.
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

  test('snapshots the question rather than reading it live, and fetches the responses fresh rather than trusting `answers`', () => {
    // The whole point: `currentQuestion` gets overwritten by the NEXT round's
    // data the instant the host advances, so the question must be a SNAPSHOT
    // taken at open time. `answers` (fix round 1, item 3) is worse than
    // stale for Call & Answer — it is the VOTE-TIME ballot with no ranks, and
    // is `[]` outright after a reload during RESULTS — so the responses are
    // not read from it at all; they are fetched fresh (loadMyFeedbackAnswers)
    // and merged in once they arrive.
    const fn = sliceFrom(player, 'const openMyFeedback = () => {', '\n  };');
    expect(fn).toMatch(/setMyFeedbackSnapshot\(\{/);
    expect(fn).toMatch(/answers:\s*\[\]/);
    expect(fn).not.toMatch(/answers:\s*Array\.isArray\(answers\)/);
    expect(fn).toMatch(/loadMyFeedbackAnswers\(padded\)/);

    const roundData = sliceFrom(player, 'const myFeedbackRoundData = myFeedbackSnapshot ? {', '} : null;');
    // Built from the snapshot, never from `currentQuestion` or `answers` directly.
    expect(roundData).toMatch(/\.\.\.myFeedbackSnapshot/);
    expect(roundData).not.toMatch(/currentQuestion/);
  });

  test('fetches the ranked responses from the same results endpoint the ordinary results screen uses', () => {
    const fn = sliceFrom(player, 'const loadMyFeedbackAnswers = async (padded) => {', '\n  };');
    expect(fn).toMatch(/games\/get-results/);
    expect(fn).toMatch(/rankedResultsFrom\(data\)/);
    // Merged into the existing snapshot, not a replacement of the whole thing —
    // the question must not flicker once the responses arrive.
    expect(fn).toMatch(/setMyFeedbackSnapshot\(\(current\)/);
    expect(fn).toMatch(/\.\.\.current/);
  });

  test('sets a status on every path — ok/no-data, error on a bad response, error on a thrown failure (fix round 2, item 1)', () => {
    const fn = sliceFrom(player, 'const loadMyFeedbackAnswers = async (padded) => {', '\n  };');
    expect(fn).toMatch(/feedbackAnswersStatusFrom\(data\)/);
    expect(fn).toMatch(/setMyFeedbackAnswersStatus\('error'\)/);
    // Never left silently at whatever it was — a failed fetch must not read
    // as "still loading" forever, nor default to "ok".
    const okBranchAt = fn.indexOf("if (!res.ok)");
    expect(okBranchAt).toBeGreaterThan(-1);
    expect(fn.slice(okBranchAt, okBranchAt + 60)).toMatch(/setMyFeedbackAnswersStatus\('error'\)/);
  });

  test('opening sets the status to loading before the fetch resolves, so the panel never shows "Nobody responded" for a round nobody has checked yet', () => {
    const fn = sliceFrom(player, 'const openMyFeedback = () => {', '\n  };');
    expect(fn).toMatch(/setMyFeedbackAnswersStatus\('loading'\)/);
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
    // `if (myFeedbackShowing)` has to be the FIRST condition in the chain: the
    // round can leave RESULTS while the player is mid-comment, and falling
    // through to whatever `gameState` says next would unmount the composer
    // and throw the draft away.
    const chainStart = player.indexOf('let body = null;');
    const openAt = player.indexOf('if (myFeedbackShowing) {', chainStart);
    // The exact branch check, not any mention of the string — fix round 2
    // added `const myFeedbackEnded = gameState === 'ENDED';` ahead of the
    // chain (to phrase the "moved on" banner), which a bare substring search
    // would find first and misreport as the chain's own ENDED branch.
    const endedAt = player.indexOf("} else if (gameState === 'ENDED') {", chainStart);
    expect(openAt).toBeGreaterThan(chainStart);
    expect(endedAt).toBeGreaterThan(openAt);
  });

  test('shows while the round it opened on is still showing, OR there is an unsent draft (fix round 1, item 6)', () => {
    // Reading only, no draft, round moved on: this must be FALSE so the chain
    // falls through to whatever gameState now calls for, rather than
    // stranding a player with nothing to lose on a dead panel.
    const def = sliceFrom(player, 'const myFeedbackShowing =', ';');
    expect(def).toMatch(/myFeedbackOpen && \(myFeedbackStillOpen \|\| myFeedbackHasDraft\)/);
  });

  test('posts a comment through the same FeedbackRoundPanel the host-triggered mode uses, and lifts the draft flag', () => {
    const branch = sliceFrom(player, 'if (myFeedbackShowing) {', "gameState === 'ENDED'");
    expect(branch).toMatch(/<FeedbackRoundPanel/);
    expect(branch).toMatch(/round=\{myFeedbackRoundData\}/);
    expect(branch).toMatch(/onSubmit=\{submitMyFeedbackComment\}/);
    expect(branch).toMatch(/onDraftChange=\{setMyFeedbackHasDraft\}/);
  });

  test('says plainly the next question is live once the round has moved on, and offers to copy — never "post it"', () => {
    const branch = sliceFrom(player, 'if (myFeedbackShowing) {', "gameState === 'ENDED'");
    // The panel itself always renders here — only the banner is conditional —
    // so a draft mid-typing in FeedbackRoundPanel's own local state is never
    // torn down by this branch.
    expect(branch).toMatch(/!myFeedbackStillOpen/);
    expect(branch).toMatch(/next question is live/i);
    expect(branch).toMatch(/copy it/i);
    // A post would be refused once the round has moved on (comments.js's
    // state check) — the banner must not invite one.
    expect(branch).not.toMatch(/post it/i);
    expect(branch).toMatch(/<FeedbackRoundPanel/);
  });

  test('the button reads "Go to the question" once moved on, "Close" while still on the same round or once the session has ended', () => {
    const branch = sliceFrom(player, 'if (myFeedbackShowing) {', "gameState === 'ENDED'");
    expect(branch).toMatch(/onClick=\{closeMyFeedback\}/);
    expect(branch).toMatch(/\{myFeedbackExitLabel\}/);
    const def = sliceFrom(player, 'const myFeedbackExitLabel =', ';');
    expect(def).toMatch(/myFeedbackStillOpen\s*\n?\s*\?\s*'Close'/);
    expect(def).toMatch(/myFeedbackEnded \? 'Close' : 'Go to the question'/);
  });

  test('the session-ended case reads "The session has ended", not "the next question is live" (fix round 2, item 3)', () => {
    const branch = sliceFrom(player, 'if (myFeedbackShowing) {', "gameState === 'ENDED'");
    expect(branch).toMatch(/myFeedbackEnded/);
    expect(branch).toMatch(/session has ended/i);
    // Both messages exist, gated by the same flag — never shown together.
    expect(branch).toMatch(/next question is live/i);
  });

  test('the composer is told the round has moved on, so it disables Post rather than letting it fail silently on submit', () => {
    const branch = sliceFrom(player, 'if (myFeedbackShowing) {', "gameState === 'ENDED'");
    expect(branch).toMatch(/postDisabled=\{!myFeedbackStillOpen\}/);
  });

  test('RoundReport is told what to say instead of the responses, and given a retry only on failure', () => {
    const branch = sliceFrom(player, 'if (myFeedbackShowing) {', "gameState === 'ENDED'");
    expect(branch).toMatch(/answersEmptyText=\{myFeedbackAnswersEmptyText\}/);
    expect(branch).toMatch(/onRetryAnswers=\{myFeedbackRetryAnswers\}/);
  });

  test('closing (or "going to the question") calls a dedicated handler that posts nothing', () => {
    const fn = sliceFrom(player, 'const closeMyFeedback = () => {', '\n  };');
    expect(fn).toMatch(/setMyFeedbackOpen\(false\)/);
    expect(fn).toMatch(/setMyFeedbackHasDraft\(false\)/);
    expect(fn).not.toMatch(/postComment/);
  });
});

describe('following the room once there is nothing to lose (fix round 1, item 6)', () => {
  test('an effect auto-closes the panel once the round has moved on AND there is no draft', () => {
    const fn = sliceFrom(
      player,
      'useEffect(() => {\n    if (myFeedbackOpen && myFeedbackNumber',
      '}, [gameState, myFeedbackOpen, myFeedbackHasDraft, myFeedbackNumber]);',
    );
    expect(fn).toMatch(/gameState !== `RESULTS#\$\{myFeedbackNumber\}`/);
    expect(fn).toMatch(/!myFeedbackHasDraft/);
    expect(fn).toMatch(/closeMyFeedback\(\)/);
  });

  test('the effect is keyed on gameState, so it actually re-runs as the room moves', () => {
    expect(player).toMatch(
      /\}, \[gameState, myFeedbackOpen, myFeedbackHasDraft, myFeedbackNumber\]\);/,
    );
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

  test('sends the membership proof (comments.js\'s PLAYER# check, fix round 1 item 1)', () => {
    // The server refuses a playerName with no PLAYER# row in this game, and
    // where that row carries a ClientId it requires this same one back. Both
    // composers must send the identical value the join request itself sent —
    // getClientId(gameId) reads the same localStorage-backed id every time —
    // or a legitimate player's own comment would be refused by their own
    // check.
    const fn = sliceFrom(player, 'const submitMyFeedbackComment = async (draft) => {', '\n  };');
    expect(fn).toMatch(/clientId:\s*getClientId\(gameId\)/);
  });
});

describe('the host-triggered composer sends the same membership proof', () => {
  // `submitComment` (feedbackRound, the host-triggered whole-room switch) is
  // untouched in every other respect by this feature, but it posts through
  // the same comments.js route and needs the same clientId or a real
  // participant in an OPENED feedback round would be refused too.
  test('submitComment also sends getClientId(gameId)', () => {
    const fn = sliceFrom(player, 'const submitComment = async (draft) => {', '\n  };');
    expect(fn).toMatch(/postComment\(\{/);
    expect(fn).toMatch(/clientId:\s*getClientId\(gameId\)/);
  });
});

describe('minors folded into fix round 1', () => {
  test('a top exit sits above the panel, for a phone that would otherwise scroll a long report to find the bottom one', () => {
    const branch = sliceFrom(player, 'if (myFeedbackShowing) {', "gameState === 'ENDED'");
    expect(branch).toMatch(/plr-feedback-top-close/);
    expect(branch).toMatch(/onClick=\{closeMyFeedback\}/g);
    // Two exits, not one relabelled: the top one and the bottom one both call
    // the same handler, so `closeMyFeedback` must appear at least twice here.
    const closeCalls = branch.match(/onClick=\{closeMyFeedback\}/g) || [];
    expect(closeCalls.length).toBeGreaterThanOrEqual(2);
  });

  test('the Feedback button on the ordinary results screen carries a class with an actual CSS rule', () => {
    expect(player).toMatch(/plr-feedback-btn/);
    const css = fs.readFileSync(src('components', 'PlayerSurface.css'), 'utf8');
    expect(css).toMatch(/\.plr-feedback-btn\s*\{[^}]*margin-top/);
  });

  test('loadComments (the commentPosted handler) refreshes the player\'s own panel too, not only the host-triggered one', () => {
    const fn = sliceFrom(player, 'const loadComments = async () => {', '\n  };');
    expect(fn).toMatch(/setFeedbackComments/);
    expect(fn).toMatch(/myFeedbackNumberRef\.current/);
    expect(fn).toMatch(/setMyFeedbackComments/);
  });

  test('myFeedbackNumberRef is kept current, and cleared once the panel closes', () => {
    const fn = sliceFrom(player, 'myFeedbackNumberRef.current = myFeedbackOpen', '\n  }, [myFeedbackOpen, myFeedbackNumber]);');
    expect(fn).toMatch(/myFeedbackOpen \? myFeedbackNumber : null/);
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
