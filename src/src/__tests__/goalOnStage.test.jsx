/**
 * THE GOAL, ON THE STAGE — config/goalStage.js, the rail's goal segment, the
 * dock's notice chip, and the stylesheet rules that make it a chip
 * (QA drive 2026-09-29, findings #3 and #22).
 *
 * #3: the header said "ROUND 1 OF 5" and the goal was nowhere on it; skipping
 * past the goal round said nothing. #22: "That's your 2. Keep going…" was the
 * dock's small grey status text.
 *
 * rejects: no goal on the rail while a round is in play; a skip past the goal
 * going unmarked; the notice drawn as plain status text; the notice changing
 * or disabling the primary; a goal on a survey or a session without one.
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render } from '@testing-library/react';
import { goalOnStage, goalPassedLine } from '../config/goalStage';
import { hostControlsFor } from '../config/hostControls';
import Rail from '../components/stage/Rail';
import Dock from '../components/stage/Dock';

const REACHED = 'That’s your 2. Keep going if there’s time, or end the session.';
const at = (round, phase, extra = {}) => goalOnStage({ target: 2, round, phase, gameType: 'call-and-answer', ...extra });

describe('goalOnStage', () => {
  test('short of the goal: the rail says the goal, nothing is announced', () => {
    expect(at(1, 'ASK')).toEqual({ rail: { text: 'Goal 2', state: 'ahead' }, notice: '' });
    expect(at(1, 'RESULTS')).toEqual({ rail: { text: 'Goal 2', state: 'ahead' }, notice: '' });
    expect(at(2, 'VOTE')).toEqual({ rail: { text: 'Goal 2', state: 'ahead' }, notice: '' });
  });

  test('the goal round\'s results: reached, with session-goal.js\'s own words', () => {
    expect(at(2, 'RESULTS')).toEqual({ rail: { text: 'Goal 2 reached', state: 'reached' }, notice: REACHED });
    expect(at(2, 'FIELD_NOTES').notice).toBe(REACHED);
    expect(at(2, 'FEEDBACK').notice).toBe(REACHED);
  });

  test('past the goal by ANY route: the rail marks it from the round number alone', () => {
    // A skip on round 2's ASK lands on round 3's ASK — the goal round's
    // results never came. The rail still says so, at once.
    expect(at(3, 'ASK').rail).toEqual({ text: 'Past goal 2', state: 'passed' });
    expect(at(3, 'ASK').notice).toBe('');
    expect(at(7, 'RESULTS').rail.state).toBe('passed');
  });

  test('the first round past the goal announces it on its results; later ones do not', () => {
    expect(at(3, 'RESULTS').notice).toBe(goalPassedLine(2));
    expect(goalPassedLine(2)).toBe('Past your goal of 2. Keep going if there’s time, or end the session.');
    expect(at(4, 'RESULTS').notice).toBe('');
  });

  test('nothing without a goal, on a survey, or between rounds', () => {
    expect(goalOnStage({ target: null, round: 1, phase: 'ASK', gameType: 'trivia' })).toEqual({ rail: null, notice: '' });
    expect(at(1, 'COLLECTING', { gameType: 'survey' })).toEqual({ rail: null, notice: '' });
    expect(at(0, 'LOBBY')).toEqual({ rail: null, notice: '' });
    expect(at(3, 'ENDED')).toEqual({ rail: null, notice: '' });
  });
});

describe('hostControlsFor: the notice is a notice, and only words', () => {
  const READY = { playerCount: 6, answeredCount: 6, votedCount: 6, answerCount: 6, hasQuestionSet: true };

  test('it takes the results status with the notice tone, the primary untouched', () => {
    const plain = hostControlsFor({ ...READY, gameType: 'call-and-answer', phase: 'RESULTS' });
    const goal = hostControlsFor({ ...READY, gameType: 'call-and-answer', phase: 'RESULTS', goalLine: at(3, 'RESULTS').notice });
    expect(goal.status).toEqual({ text: goalPassedLine(2), tone: 'notice' });
    expect(goal.primary).toEqual(plain.primary);
    expect(plain.status.tone).not.toBe('notice');
  });

  test('a long read-back keeps its page position, and that is not a notice', () => {
    const c = hostControlsFor({
      ...READY, gameType: 'call-and-answer', phase: 'FIELD_NOTES', goalLine: REACHED, notesPage: 0, notesPages: 3,
    });
    expect(c.status.text).toBe('Reading page 1 of 3');
    expect(c.status.tone).not.toBe('notice');
  });
});

describe('the rail and the dock draw it', () => {
  test('the rail: "Round 1 of 5 · Goal 2", plain while ahead', () => {
    const { container } = render(
      <Rail phase="ASK" title="T" context={{ noun: 'Round', round: 1, of: 5, goal: at(1, 'ASK').rail }} />,
    );
    const ctx = container.querySelector('.rail-ctx');
    expect(ctx.textContent).toBe('Round 1of 5·Goal 2');
    const goal = container.querySelector('.rail-goal');
    expect(goal.getAttribute('data-goal-state')).toBe('ahead');
    expect(goal.classList.contains('met')).toBe(false);
  });

  test('the rail: reached and passed wear the amber chip', () => {
    const reached = render(<Rail phase="RESULTS" title="T" context={{ noun: 'Round', round: 2, of: 5, goal: at(2, 'RESULTS').rail }} />);
    expect(reached.container.querySelector('.rail-goal.met').textContent).toBe('Goal 2 reached');
    const passed = render(<Rail phase="ASK" title="T" context={{ noun: 'Round', round: 3, of: 5, goal: at(3, 'ASK').rail }} />);
    expect(passed.container.querySelector('.rail-goal.met').textContent).toBe('Past goal 2');
  });

  test('the rail prints no goal when it has none', () => {
    const { container } = render(<Rail phase="ASK" title="T" context={{ noun: 'Round', round: 1, of: 5 }} />);
    expect(container.querySelector('.rail-goal')).toBeNull();
  });

  test('the dock: the notice is a chip, not the grey status', () => {
    const { container, rerender } = render(<Dock status={REACHED} notice />);
    const status = container.querySelector('.dock .status');
    expect(status.classList.contains('notice')).toBe(true);
    expect(status.hasAttribute('data-goal-notice')).toBe(true);
    expect(status.getAttribute('aria-live')).toBe('polite');
    rerender(<Dock status="Results are on screen" />);
    expect(container.querySelector('.dock .status').classList.contains('notice')).toBe(false);
  });
});

describe('styles/stage.css: the chip is declared', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles', 'stage.css'), 'utf8');
  const rule = (selector) => {
    const i = css.indexOf(`${selector}{`);
    expect(i).toBeGreaterThan(-1);
    return css.slice(i, css.indexOf('}', i));
  };

  test('.dock .status.notice: amber, bordered, at body size, never below the floor', () => {
    const r = rule('.dock .status.notice');
    expect(r).toMatch(/color:var\(--primary\)/);
    expect(r).toMatch(/border:var\(--hair\) solid currentColor/);
    expect(r).toMatch(/font-size:max\(var\(--floor\),var\(--t-body\)\)/);
    expect(r).not.toMatch(/var\(--danger\)/);
  });

  test('its pulse is finite and stands down for reduced motion', () => {
    expect(rule('.dock .status.notice')).toMatch(/animation:cue [^;]* 3\b/);
    expect(css).toMatch(/prefers-reduced-motion:reduce\)\{\.dock \.status\.notice\{animation:none\}/);
  });

  test('.rail-goal.met: the .chip idiom in amber', () => {
    const r = rule('.rail-ctx .rail-goal.met');
    expect(r).toMatch(/color:var\(--primary\)/);
    expect(r).toMatch(/border-radius:999px/);
  });
});
