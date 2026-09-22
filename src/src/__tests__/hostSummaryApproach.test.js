/**
 * THE MID-ROUND APPROACH SWITCH, ON THE HOST'S RESULTS STAGE — GameHostPage.jsx.
 *
 * The owner asked for the summary approach to be changeable "midround as
 * well", the same way the voice is: from the NEXT round on, with Redo the
 * control that rewrites the one on screen. GameHostPage.test.jsx mounts the
 * entry screen only; driving it into a live RESULTS stage is a fixture this
 * repo does not have, so the wiring is pinned here in source, the way the
 * stacking and palette contracts are. Three things must hold together:
 *
 *   1. a second select beside the voice one, labelled for the next round;
 *   2. its handler writes `promptId` through PUT /games/{gameId} — the route
 *      update-game.js already validates ownership on, not a new one;
 *   3. a resumed session restores the pick from `gameMetadata.promptId`,
 *      or the picker misreports its own state after every reload (the
 *      persona picker's own history, get-game-state.js:333).
 */
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'GameHostPage.jsx'), 'utf8');

test('the results stage carries an approach select beside the voice one', () => {
  expect(src).toMatch(/id="game-prompt"/);
  expect(src).toMatch(/Approach \(next \$\{getHostRoundNoun\(\)\.toLowerCase\(\)\}\)/);
  expect(src).toMatch(/id="game-persona"/);
});

test('switching it writes promptId through PUT /games/{gameId}', () => {
  const at = src.indexOf('const handleChangeGamePrompt');
  expect(at).toBeGreaterThan(-1);
  const body = src.slice(at, at + 1600);
  expect(body).toMatch(/method: 'PUT'/);
  expect(body).toMatch(/`\$\{API_BASE\}games\/\$\{gameId\}`/);
  expect(body).toMatch(/promptId: promptId \|\| ''/);
  // Says what the voice switch says: next round, not this one.
  expect(body).toMatch(/next/i);
});

test('a resumed session restores the pick from the game record', () => {
  expect(src).toMatch(/setGamePromptId\(gameStateData\.gameMetadata\.promptId \|\| ''\)/);
});
