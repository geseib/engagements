/**
 * THE GOAL'S WIRING ON THE HOST PAGE — GameHostPage.jsx and config/gameSession.js
 * (events M1b, Task 5). Read as source, the way gameSession.test.js reads the
 * page: the page is wired to the functions whose behaviour hostControlsGoal
 * and sessionSetupPanelGoal pin.
 *
 * rejects: the goal surviving a switch to another session; a reload that
 * forgets it; a new session that does not carry the goal just set; the dock
 * or the panel not told; the rail's goal derived anywhere but goalStage.
 */
import fs from 'fs';
import path from 'path';
import { gameSessionKeys, initialGameSession } from '../config/gameSession';

const source = fs.readFileSync(path.join(__dirname, '..', 'GameHostPage.jsx'), 'utf8');
const bodyOf = (name) => {
  const start = source.indexOf(`const ${name} = `);
  expect(start).toBeGreaterThan(-1);
  return source.slice(start, source.indexOf('\n  };', start));
};

test('the goal is per-game state, reset with the rest', () => {
  expect(gameSessionKeys()).toContain('sessionTarget');
  expect(initialGameSession().sessionTarget).toBeNull();
});

test('a reload restores it from host-state\'s top level', () => {
  expect(source).toMatch(/setSessionTarget\(Number\.isInteger\(gameStateData\.target\) \? gameStateData\.target : null\)/);
});

test('a new session carries the goal the host just set, and an edit of the live one follows', () => {
  expect(bodyOf('handleStartNewGame')).toMatch(/setSessionTarget\(Number\.isInteger\(form\.target\)/);
  expect(bodyOf('handleSaveGameEdits')).toMatch(/targetId === gameId && 'target' in form\) setSessionTarget\(/);
});

test('the dock hears it through hostControlsFor, and the panel gets the progress', () => {
  expect(source).toMatch(/goalRules\.goalProgress\(\{ target: sessionTarget, round: lessonNumber, phase: hostPhase \}\)/);
  // The dock's notice is goalStage's: the goal round's results AND the first
  // round past it (QA drive #3), not goalProgress's reached-only line.
  expect(source).toMatch(/goalOnStage\(\{\s*target: sessionTarget, round: lessonNumber, phase: hostPhase, gameType: currentGameType,\s*\}\)/);
  expect(source).toMatch(/hostControlsFor\(\{[\s\S]*?goalLine: stageGoal\.notice,[\s\S]*?\}\);/);
  expect(source).toMatch(/<SessionSetupPanel[\s\S]*?remoteUrl=\{remoteUrl\}\s+goal=\{goal\}/);
});

// RETIRED: "the rail never prints the goal". M1b kept the plan off the room's
// screen; the 2026-09-29 QA drive found the goal invisible there (finding #3)
// and the fix plan puts it on the header. What stays true: the rail's goal is
// goalStage's, not a second derivation, and a survey's rail carries none.
test('the rail prints the goal from goalStage, and only on a counted round', () => {
  const at = source.indexOf('const railContext = ');
  const block = source.slice(at, source.indexOf(';\n', at));
  expect(block).toMatch(/goal: stageGoal\.rail \|\| undefined/);
  expect(block).not.toMatch(/sessionTarget/);
  const surveyArm = block.slice(0, block.indexOf(': {', block.indexOf('surveyStage')));
  expect(surveyArm).not.toMatch(/goal/);
});

test('the dock is told when its status is the goal\'s notice', () => {
  expect(source).toMatch(/notice=\{Boolean\(dockStatus\) && hostControls\.status\.tone === 'notice' && dockStatus === hostControls\.status\.text\}/);
});
