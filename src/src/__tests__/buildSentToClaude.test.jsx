/**
 * SENT TO CLAUDE and THE STAGE WHILE CLAUDE WORKS (docs/design/build-room-ideas
 * I9-I10, owner 18 Oct 2026): the headline says Sent to Claude until Claude
 * says what it is doing; the right column quotes what we told Claude; the row,
 * the test counts and the tool lines show the work.
 */
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import {
  claudeState, sentOf, stageSide, workView, testsWords, SENT_PICKED_HOLD_MS, SENT_UNPICKED_WARN_MS,
} from '../buildroom/buildScreens';
import { claudeWords } from '../buildroom/roomContentData';
import { IdleStage } from '../buildroom/screens/StageIdle';
import { wallRoom } from '../present/buildwall/wallRoom';
import { W } from '../buildroom/words';

const T0 = Date.parse('2026-10-18T10:58:00.000Z');
const iso = (ms) => new Date(ms).toISOString();
const sent = (extra = {}) => ({ verb: 'told', text: 'We need an old-school leaderboard', askId: null, at: iso(T0), pickedAt: null, ...extra });
const room = (extra = {}) => ({ agent: { connected: true, listening: false }, log: [], asks: [], activity: [], ...extra });

describe('Sent to Claude: the headline (I9)', () => {
  test('from the moment it is sent, while Claude has not taken it', () => {
    const st = claudeState(room({ sent: sent() }), T0 + 30000);
    expect(st.key).toBe('sent');
    expect(st.headline).toBe('Sent to Claude');
    expect(st.line).toMatch(/waiting for Claude to pick it up$/);
  });
  test('once Claude\'s inbox took it, it says so, for a short while', () => {
    const r = room({ sent: sent({ pickedAt: iso(T0 + 5000) }) });
    expect(claudeState(r, T0 + 20000).line).toMatch(/^Claude picked it up at /);
    expect(claudeState(r, T0 + 5000 + SENT_PICKED_HOLD_MS + 1000).key).not.toBe('sent');
  });
  test('Claude saying what it is doing ends it: a doing line or a post after the send', () => {
    const doing = { text: 'Adding a retro leaderboard', startedAt: iso(T0 + 60000), lastActiveAt: iso(T0 + 60000) };
    expect(claudeState(room({ sent: sent(), doing }), T0 + 70000).headline).toBe('Claude is adding a retro leaderboard');
    const log = [{ by: 'agent', kind: 'progress', text: 'Leaderboard is in', createdAt: iso(T0 + 60000) }];
    expect(claudeState(room({ sent: sent(), log }), T0 + 70000).key).toBe('building');
    // A doing line from BEFORE the send does not end it.
    const old = { text: 'Scaffolding the site', startedAt: iso(T0 - 60000), lastActiveAt: iso(T0 - 1000) };
    expect(claudeState(room({ sent: sent(), doing: old }), T0 + 10000).key).toBe('sent');
  });
  test('the host alone is told when Claude has not picked it up', () => {
    const r = room({ sent: sent() });
    const later = T0 + SENT_UNPICKED_WARN_MS + 1000;
    expect(claudeState(r, later, { host: true }).line).toBe(W.sentNotPicked);
    expect(claudeState(r, later).line).not.toBe(W.sentNotPicked);
  });
  test('beside an open ask, the room\'s one line is what was sent, word for word', () => {
    expect(claudeWords(room({ sent: sent() }), T0 + 1000)).toMatchObject({ key: 'sent', headline: 'Sent to Claude', line: '“We need an old-school leaderboard”' });
  });
  test('a read with no `sent`, or a broken one, changes nothing', () => {
    expect(sentOf(room())).toBeNull();
    expect(sentOf(room({ sent: { at: 'never' } }))).toBeNull();
    expect(claudeState(room(), T0).key).not.toBe('sent');
  });
});

describe('the right column (I9)', () => {
  const decidedAsk = (at) => ({ askId: '3', status: 'decided', prompt: 'Leaderboard style?', decidedAt: iso(at), decision: { direction: 'B · Arcade' } });
  test('We told Claude / We asked Claude, quoted', () => {
    expect(stageSide(room({ sent: sent() }))).toEqual({ label: 'We told Claude', text: '“We need an old-school leaderboard”', at: iso(T0) });
    expect(stageSide(room({ sent: sent({ verb: 'asked', text: 'Which font?' }) })).label).toBe('We asked Claude');
  });
  test('a room decision reads We decided, when it is newer or is what was sent', () => {
    expect(stageSide(room({ sent: sent(), asks: [decidedAsk(T0 + 1000)] })).label).toBe('We decided');
    expect(stageSide(room({ sent: sent({ verb: 'decided' }), asks: [decidedAsk(T0 - 1000)] })).label).toBe('We decided');
    expect(stageSide(room({ sent: sent(), asks: [decidedAsk(T0 - 1000)] })).label).toBe('We told Claude');
  });
  test('nothing sent and nothing decided: no column', () => {
    expect(stageSide(room())).toBeNull();
  });
});

describe('the row while Claude works (I10)', () => {
  const act = (s, kind, text, extra = {}) => ({ at: iso(T0 + s * 1000), kind, text, ...extra });
  test('an edit is Building', () => {
    const w = workView(room({ activity: [act(10, 'read', 'Read App.jsx'), act(20, 'edit', 'Edited Leaderboard.jsx')] }), T0 + 30000);
    expect(w.phases.map((p) => [p.name, p.state])).toEqual([['Building', 'on'], ['Testing', ''], ['Fixing', ''], ['Checking', ''], ['Saved', '']]);
    expect(w.ticker.map((t) => t.text)).toEqual(['Edited Leaderboard.jsx', 'Read App.jsx']);
  });
  test('a failed test run stays red, and an edit after it is Fixing', () => {
    const w = workView(room({ activity: [
      act(10, 'edit', 'Edited Leaderboard.jsx'),
      act(20, 'test', 'Ran npm test', { tests: { passed: 12, failed: 1 }, failed: true }),
      act(30, 'edit', 'Edited scores.js'),
    ] }), T0 + 40000);
    expect(w.phases.map((p) => p.state)).toEqual(['done', 'bad', 'on', '', '']);
    expect(testsWords(w.tests)).toBe('12 passed · 1 failed');
  });
  test('a passing run, a look at the demo, then Engage\'s own commit (a checkpoint post) is Saved', () => {
    const w = workView(room({
      activity: [act(10, 'test', 'Ran npm test', { tests: { passed: 13, failed: 0 } }), act(20, 'check', 'Looked at the running demo')],
      log: [{ by: 'agent', kind: 'checkpoint', text: 'Add the leaderboard', createdAt: iso(T0 + 30000) }],
    }), T0 + 40000);
    expect(w.phases.map((p) => p.state)).toEqual(['', 'done', '', 'done', 'on']);
    expect(testsWords(w.tests)).toBe('13 passed');
  });
  test('without counts it says passed or failed; a plugin before 1.24.0 gives the ticker only', () => {
    expect(testsWords({ passed: null, failed: null, bad: true })).toBe('Tests failed');
    const w = workView(room({ activity: [act(10, 'run', 'Ran npm test'), act(11, 'other', 'Ran ls')] }), T0 + 20000);
    expect(w.phases).toBeNull();
    expect(w.ticker).toHaveLength(2);
  });
  test('only what came after the latest send counts, and old lines leave the ticker', () => {
    const w = workView(room({ sent: sent({ at: iso(T0 + 15000) }), activity: [act(10, 'edit', 'Edited old.js'), act(20, 'test', 'Ran npm test', { failed: true })] }), T0 + 25000);
    expect(w.phases.map((p) => p.state)).toEqual(['', 'bad', '', '', '']);
    expect(workView(room({ activity: [act(10, 'edit', 'Edited a.js')] }), T0 + 60 * 60 * 1000)).toBeNull();
  });
});

describe('the Stage between asks', () => {
  test('Sent to Claude, with what we told Claude on the right', () => {
    render(<IdleStage room={room({ sent: sent() })} now={T0 + 5000} host={false} />);
    expect(screen.getByRole('heading', { name: 'Sent to Claude' })).toBeInTheDocument();
    const side = screen.getByTestId('brm-stage-side');
    expect(within(side).getByText('We told Claude')).toBeInTheDocument();
    expect(within(side).getByText('“We need an old-school leaderboard”')).toBeInTheDocument();
  });
  test('while Claude works: the row, the counts and the newest tool lines', () => {
    const doing = { text: 'Adding the old-school leaderboard', startedAt: iso(T0 + 60000), lastActiveAt: iso(T0 + 300000) };
    const activity = [
      { at: iso(T0 + 120000), kind: 'edit', text: 'Edited Leaderboard.jsx' },
      { at: iso(T0 + 240000), kind: 'test', text: 'Ran npm test', tests: { passed: 12, failed: 1 }, failed: true },
      { at: iso(T0 + 300000), kind: 'edit', text: 'Edited scores.js' },
    ];
    render(<IdleStage room={room({ sent: sent({ pickedAt: iso(T0 + 5000) }), doing, activity })} now={T0 + 310000} host={false} />);
    expect(screen.getByRole('heading', { name: 'Claude is adding the old-school leaderboard' })).toBeInTheDocument();
    const work = screen.getByTestId('brm-work');
    expect(within(work).getByText('Fixing')).toHaveAttribute('aria-current', 'step');
    expect(within(work).getByText('Testing')).toHaveClass('is-bad');
    expect(within(work).getByText('12 passed · 1 failed')).toBeInTheDocument();
    expect(within(work).getAllByRole('listitem').map((li) => li.textContent).slice(-3)).toEqual([
      expect.stringContaining('Edited scores.js'), expect.stringContaining('Ran npm test'), expect.stringContaining('Edited Leaderboard.jsx'),
    ]);
  });
});

test('the room\'s window passes `sent` and `activity` through to the same screens', () => {
  const r = wallRoom({ sent: sent(), activity: [{ at: iso(T0), kind: 'edit', text: 'Edited a.js' }] });
  expect(r.sent.text).toBe('We need an old-school leaderboard');
  expect(r.activity).toHaveLength(1);
  expect(wallRoom({}).activity).toEqual([]);
});
