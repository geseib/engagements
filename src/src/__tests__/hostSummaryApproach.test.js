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
 *   2. its handler writes `promptId` through PUT /games/{gameId}/prompt, the
 *      approach's own route, exactly as the voice uses /persona. It was first
 *      wired to PUT /games/{gameId} — update-game.js, which refuses any session
 *      whose state is not CREATED — so on the results stage, the only place the
 *      select renders, every switch came back "Game cannot be edited". The old
 *      form of this test pinned that route and passed the whole time;
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

/** The handler's own body, cut at the next handler so nothing beside it counts. */
const handlerBody = (name) => {
  const at = src.indexOf(`const ${name}`);
  expect(at).toBeGreaterThan(-1);
  const end = src.indexOf('\n  const handle', at + 1);
  return src.slice(at, end > at ? end : at + 2000);
};

test('switching it writes promptId through PUT /games/{gameId}/prompt', () => {
  const body = handlerBody('handleChangeGamePrompt');
  expect(body).toMatch(/authFetch\(`\$\{API_BASE\}games\/\$\{gameId\}\/prompt`/);
  expect(body).toMatch(/method: 'PUT'/);
  expect(body).toMatch(/promptId: promptId \|\| ''/);
  // Says what the voice switch says: next round, not this one.
  expect(body).toMatch(/next/i);
});

test('it never goes through the pre-start edit route, which refuses a started session', () => {
  const body = handlerBody('handleChangeGamePrompt');
  expect(body).not.toMatch(/`\$\{API_BASE\}games\/\$\{gameId\}`/);
});

test('it has the same shape as the voice switch beside it', () => {
  const voice = handlerBody('handleChangeGamePersona');
  expect(voice).toMatch(/authFetch\(`\$\{API_BASE\}games\/\$\{gameId\}\/persona`/);
});

test('a resumed session restores the pick from the game record', () => {
  expect(src).toMatch(/setGamePromptId\(gameStateData\.gameMetadata\.promptId \|\| ''\)/);
});

/*
  "BRIEFING ON" — session-setup-redesign page 30. The stage says THAT Workie
  has the host's briefing, beside the voice and the approach; never the file
  name and never the text. Restored from get-game-state's boolean on a reload,
  and reset with the rest of the game (config/gameSession.js).
*/
test('the stage says "Briefing on" when the session is briefed, and restores it on reload', () => {
  expect(src).toMatch(/setSessionBriefed\(gameStateData\.gameMetadata\.briefed === true\)/);
  const at = src.indexOf('id="game-prompt"');
  const controls = src.slice(at, at + 2000);
  expect(controls).toMatch(/\{sessionBriefed && \(/);
  expect(controls).toMatch(/Briefing on/);
});
