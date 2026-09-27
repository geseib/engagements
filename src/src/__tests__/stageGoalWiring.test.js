/**
 * THE GOAL'S WIRING ON THE HOST PAGE — GameHostPage.jsx and config/gameSession.js
 * (events M1b, Task 5). Read as source, the way gameSession.test.js reads the
 * page: the page is wired to the functions whose behaviour hostControlsGoal
 * and sessionSetupPanelGoal pin.
 *
 * rejects: the goal surviving a switch to another session; a reload that
 * forgets it; a new session that does not carry the goal just set; the dock
 * or the panel not told; the rail printing it to the room.
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
  expect(source).toMatch(/hostControlsFor\(\{[\s\S]*?goalLine: goal\.line,[\s\S]*?\}\);/);
  expect(source).toMatch(/<SessionSetupPanel[\s\S]*?remoteUrl=\{remoteUrl\}\s+goal=\{goal\}/);
});

test('the rail never prints the goal', () => {
  const at = source.indexOf('const railContext = ');
  const block = source.slice(at, source.indexOf(';\n', at));
  expect(block).not.toMatch(/sessionTarget|goal/);
});
