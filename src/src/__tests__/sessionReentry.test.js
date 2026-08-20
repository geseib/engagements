/**
 * RE-OPENING THE SESSION YOU JUST LEFT — game 5486, pinned at the source.
 *
 * The owner's repro, after their own bisection: "the issue only happens when
 * you leave a session and come back to the same session: all categories and
 * questions are missing."
 *
 * The mechanism was a React bailout. Leaving clears every per-game value
 * (leaveCurrentGame) but not `gameId`; re-opening the SAME session calls
 * `setGameId(sameId)`, which React treats as a no-op and bails out of, so a
 * restore effect keyed on `[gameId]` alone never re-fired — and the cleared
 * slate rendered AS the session. A different game changed the id and worked,
 * which is why the bug bisected exactly along same-vs-different.
 *
 * GameHostPage cannot mount in jsdom (it dies on the auth provider), so the
 * contract is pinned as source — the technique inviteCallSite.test.js and the
 * clear-game post-mortem test use, for the same reason. Comment-stripped, so
 * a comment quoting the old shape cannot satisfy an assertion.
 */
const fs = require('fs');
const path = require('path');

const SRC = fs
  .readFileSync(path.join(__dirname, '..', 'GameHostPage.jsx'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

describe('the session epoch — same-id re-entry restores', () => {
  test('every switchToGame bumps the epoch, beside the id it may not change', () => {
    // rejects: bumping only when the id differs, which reintroduces the exact
    // bailout being fixed; and bumping somewhere other than the choke point,
    // which some create/continue path will bypass.
    const at = SRC.indexOf('const switchToGame = ');
    expect(at).toBeGreaterThan(-1);
    const body = SRC.slice(at, SRC.indexOf('};', at));
    expect(body).toMatch(/setGameId\(nextGameId\)/);
    expect(body).toMatch(/setSessionEpoch\(\(epoch\) => epoch \+ 1\)/);
    expect(body).not.toMatch(/if\s*\(\s*nextGameId\s*[!=]==?\s*gameId/);
  });

  test('the restore effect depends on the epoch as well as the id', () => {
    expect(SRC).toMatch(/initializeGame\(\);[\s\S]{0,400}\}, \[gameId, sessionEpoch\]\);/);
  });

  test('no other dependency array quietly gained the epoch', () => {
    // The epoch exists for ONE effect. Spreading it into others would re-run
    // websocket connects and queue loads on every same-game re-entry for no
    // reason — if a second effect ever genuinely needs it, this pin is the
    // prompt to argue it in a comment there and update the count here.
    const uses = SRC.match(/\[gameId, sessionEpoch\]/g) || [];
    expect(uses).toHaveLength(1);
  });
});
