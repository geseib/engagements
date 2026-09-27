/**
 * THE SAME GAME-SESSION BOUNDARY CHECK, POINTED AT SessionOptions.jsx.
 *
 * gameSession.test.js's "the setup dialog / game session boundary" describe
 * block scans GameSetupDialog.jsx for `useState` pairs and asserts none of
 * them collides with a key `resetGameSession()` is responsible for
 * (config/gameSession.js `gameSessionKeys()`). That scan only reads
 * GameSetupDialog.jsx — since Task 3 moved the Advanced fold's own state
 * (`knownPromptIds`, `promptList`) into components/SessionOptions.jsx, a
 * per-game key added there later would never be caught by the protected
 * test, which cannot be edited (global-constraints.md).
 *
 * This file is that same disjointness scan, run over SessionOptions.jsx
 * instead, so the boundary still holds now that the state lives in two
 * files rather than one.
 *
 * rejects: a future per-game value (something `resetGameSession()` must
 * clear when the host leaves a game) being added to SessionOptions.jsx as a
 * `useState` instead of arriving through `value`/`onChange` like every other
 * field this component already owns.
 */
import fs from 'fs';
import path from 'path';
import { gameSessionKeys } from '../config/gameSession';

const SOURCE = fs.readFileSync(
  path.join(__dirname, '..', 'components', 'SessionOptions.jsx'), 'utf8'
);
const ownedKeys = [...SOURCE.matchAll(/const \[([A-Za-z0-9_]+),\s*set[A-Za-z0-9_]+\] = useState/g)]
  .map((m) => m[1]);

describe('SessionOptions.jsx / game-session boundary', () => {
  it('finds SessionOptions.jsx\'s own state, so the check below means something', () => {
    // If this component stops using useState this assertion goes quiet and
    // the disjointness check below becomes vacuously true — the same guard
    // gameSession.test.js keeps for GameSetupDialog.jsx.
    expect(ownedKeys.length).toBeGreaterThanOrEqual(1);
    expect(ownedKeys).toContain('knownPromptIds');
  });

  // rejects: a per-game key (categories, activeCategoryIds, eventTitle, or
  // anything resetGameSession() drives) being declared as SessionOptions.jsx's
  // own useState instead of arriving as a prop.
  it('owns nothing that resetGameSession is responsible for', () => {
    const overlap = ownedKeys.filter((k) => gameSessionKeys().includes(k));
    expect(overlap).toEqual([]);
  });
});
