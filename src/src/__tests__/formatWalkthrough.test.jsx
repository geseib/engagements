/**
 * THE WALKTHROUGH (docs/design/new-engagement README "Round 2 — owner
 * feedback", decision 4; config/formatWalkthrough.js,
 * components/FormatWalkthrough.jsx). Behaviour only: jsdom has no layout.
 */
import React from 'react';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import FormatWalkthrough from '../components/FormatWalkthrough';
import { FORMAT_WALKTHROUGH, walkthroughFor, PLAY_MS } from '../config/formatWalkthrough';
import { PICKER_GAME_TYPES } from '../config/gameTypes';
import { BUILD_KIND, EVENT_KIND } from '../config/engagementKinds';
import { formatGuide } from '../config/formatGuide';

const OFFERED = [...PICKER_GAME_TYPES.map((t) => t.id), BUILD_KIND, EVENT_KIND];

describe('every offered format has a walkthrough', () => {
  test.each(OFFERED)('%s: 3–5 steps plus "What you get" (4–6 dots), each step says what you do', (id) => {
    const walk = walkthroughFor(id);
    expect(walk).not.toBeNull();
    expect(walk.steps.length).toBeGreaterThanOrEqual(3);
    expect(walk.steps.length + 1).toBeGreaterThanOrEqual(4);
    expect(walk.steps.length + 1).toBeLessThanOrEqual(6);
    walk.steps.forEach((step) => {
      expect(step.title).toEqual(expect.any(String));
      expect(step.title.length).toBeGreaterThan(0);
      expect(step.you.length).toBeGreaterThan(0);
      expect(typeof step.phones).toBe('string');
      expect(typeof step.room).toBe('string');
      expect(step.art && step.art.stage && step.art.stage.kind).toBeTruthy();
    });
    expect(walk.get.text.length).toBeGreaterThan(0);
    expect(walk.get.art.stage.kind).toBe('report');
  });

  test('no walkthrough for a format nobody offers', () => {
    expect(Object.keys(FORMAT_WALKTHROUGH).sort()).toEqual([...OFFERED].sort());
  });

  test('the words the help holds: phones rank their top three; no names while voting; Wavelength never scores', () => {
    const ca = walkthroughFor('call-and-answer').steps.map((s) => `${s.phones} ${s.room}`).join(' ');
    expect(ca).toMatch(/top three/);
    expect(ca).toMatch(/no names/i);
    expect(JSON.stringify(walkthroughFor('wavelength'))).toMatch(/Nobody scores/);
    expect(JSON.stringify(walkthroughFor('wavelength'))).not.toMatch(/a word scores/);
  });

  test('the plain descriptions (owner, 30 Oct): Call & Answer in the owner\'s words, every format has one', () => {
    expect(formatGuide('call-and-answer').short).toBe('Ask the room a question. Everyone answers on their phone, reads all the answers and votes for their favourites.');
    OFFERED.forEach((id) => {
      const g = formatGuide(id);
      ['short', 'col', 'good', 'group', 'startsShort', 'get'].forEach((k) => expect([id, k, g[k].length > 0]).toEqual([id, k, true]));
    });
  });
});

describe('moving through it', () => {
  test('Back, Next and the dots move; the status says where you are; the last dot is What you get', () => {
    render(<FormatWalkthrough format="call-and-answer" label="Call & Answer" />);
    expect(screen.getByRole('heading', { name: 'How Call & Answer runs' })).toBeInTheDocument();
    expect(screen.getByText('Step 1 of 5')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /You ask a question/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    expect(screen.getByText('Step 2 of 5')).toBeInTheDocument();
    expect(screen.getByText(/Nobody sees who wrote it\./)).toBeInTheDocument();
    const dots = within(screen.getByRole('group', { name: 'Steps of Call & Answer' })).getAllByRole('button');
    expect(dots).toHaveLength(6);
    expect(dots[1]).toHaveAttribute('aria-current', 'step');
    expect(dots[5]).toHaveAccessibleName('What you get');
    fireEvent.click(dots[5]);
    expect(screen.getAllByText('What you get').length).toBeGreaterThan(0);
    expect(screen.getByText(/Save it and it stays after the session expires/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Next/ })).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(screen.getByRole('button', { name: /Back/ }));
    expect(screen.getByText('Step 5 of 5')).toBeInTheDocument();
  });

  test('the arrow keys on a dot move a step, and the focus goes with it', () => {
    render(<FormatWalkthrough format="trivia" label="Trivia" />);
    const dots = within(screen.getByRole('group', { name: 'Steps of Trivia' })).getAllByRole('button');
    dots[0].focus();
    fireEvent.keyDown(dots[0], { key: 'ArrowRight' });
    expect(screen.getByText('Step 2 of 4')).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Steps of Trivia' })).getAllByRole('button')[1]).toHaveFocus();
    fireEvent.keyDown(document.activeElement, { key: 'End' });
    expect(screen.getAllByText('What you get').length).toBeGreaterThan(0);
  });

  test('changing the format starts again at step 1', () => {
    const { rerender } = render(<FormatWalkthrough format="call-and-answer" label="Call & Answer" />);
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    expect(screen.getByText('Step 3 of 5')).toBeInTheDocument();
    rerender(<FormatWalkthrough format="poll" label="Poll" />);
    expect(screen.getByText('Step 1 of 3')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /You ask/ })).toBeInTheDocument();
  });

  // rejects: the owner's white screen (2026-10-30). On Call & Answer's last
  // page ("What you get", index 5) a shorter format has no step 5, and the
  // first render with it read `.art` of undefined and took the page down.
  test('from the last page of the longest walkthrough, every other format still renders', () => {
    const others = Object.keys(FORMAT_WALKTHROUGH).filter((f) => f !== 'call-and-answer');
    for (const other of others) {
      const { rerender, unmount } = render(<FormatWalkthrough format="call-and-answer" label="Call & Answer" />);
      for (let i = 0; i < 6; i += 1) fireEvent.click(screen.getByRole('button', { name: /Next/ }));
      expect(screen.getAllByText('What you get').length).toBeGreaterThan(0);
      expect(() => rerender(<FormatWalkthrough format={other} label={other} />)).not.toThrow();
      expect(screen.getByText(/^Step 1 of \d$/)).toBeInTheDocument();
      unmount();
    }
  });

  test('a format is first shown at step 1', () => {
    render(<FormatWalkthrough format="wavelength" label="Wavelength" />);
    expect(screen.getByText('Step 1 of 4')).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Steps of Wavelength' })).getAllByRole('button')[0]).toHaveAttribute('aria-current', 'step');
  });

  test('the room card keeps its words clear of the phone (dev check: the title ran under it)', () => {
    const { container } = render(<FormatWalkthrough format="call-and-answer" label="Call & Answer" />);
    expect(container.querySelector('.gsd-wt-pic')).toHaveClass('has-phone');
    const css = require('fs').readFileSync(require('path').join(__dirname, '..', 'components', 'GameSetupDialog.css'), 'utf8');
    const overlap = Number(css.match(/\.gsd \.gsd-wt-phone \{[^}]*width:\s*(\d+)px/)[1])
      - Number(css.match(/\.gsd \.gsd-wt-pic \{[^}]*padding-right:\s*(\d+)px/)[1]);
    const clear = Number(css.match(/\.gsd \.gsd-wt-pic\.has-phone \.gsd-wt-stage \{[^}]*padding-right:\s*(\d+)px/)[1]);
    expect(clear).toBeGreaterThan(overlap);
  });

  test('a blank Phones or Room row is left out, not invented', () => {
    render(<FormatWalkthrough format="build" label="Build Room" />);
    expect(screen.getByText('You')).toBeInTheDocument();
    expect(screen.queryByText('Phones')).toBeNull();
    expect(screen.queryByText('Room screen')).toBeNull();
  });

  test('no format yet: one plain line, no controls', () => {
    render(<FormatWalkthrough format="" />);
    expect(screen.getByText(/Choose a format to see how it runs/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('Play', () => {
  const realMatch = window.matchMedia;
  afterEach(() => { window.matchMedia = realMatch; jest.useRealTimers(); });
  const motion = (reduce) => {
    window.matchMedia = (q) => ({ matches: reduce && /reduced-motion/.test(q), media: q, addEventListener() {}, removeEventListener() {} });
  };

  test('is off by default, and advances one step every 8 seconds once pressed', () => {
    motion(false);
    jest.useFakeTimers();
    render(<FormatWalkthrough format="call-and-answer" label="Call & Answer" />);
    const play = screen.getByRole('button', { name: /Play/ });
    expect(play).toHaveAttribute('aria-pressed', 'false');
    act(() => { jest.advanceTimersByTime(PLAY_MS * 2); });
    expect(screen.getByText('Step 1 of 5')).toBeInTheDocument();
    fireEvent.click(play);
    act(() => { jest.advanceTimersByTime(PLAY_MS); });
    expect(screen.getByText('Step 2 of 5')).toBeInTheDocument();
  });

  test('pauses while focus is inside the pane, and goes on when it leaves', () => {
    motion(false);
    jest.useFakeTimers();
    render(<><FormatWalkthrough format="call-and-answer" label="Call & Answer" /><button type="button">outside</button></>);
    fireEvent.click(screen.getByRole('button', { name: /Play/ }));
    const dot = within(screen.getByRole('group', { name: 'Steps of Call & Answer' })).getAllByRole('button')[0];
    act(() => { dot.focus(); });
    act(() => { jest.advanceTimersByTime(PLAY_MS * 2); });
    expect(screen.getByText('Step 1 of 5')).toBeInTheDocument();
    act(() => { screen.getByRole('button', { name: 'outside' }).focus(); });
    act(() => { jest.advanceTimersByTime(PLAY_MS); });
    expect(screen.getByText('Step 2 of 5')).toBeInTheDocument();
  });

  test('pauses while the pointer is over the pane', () => {
    motion(false);
    jest.useFakeTimers();
    const { container } = render(<FormatWalkthrough format="call-and-answer" label="Call & Answer" />);
    fireEvent.click(screen.getByRole('button', { name: /Play/ }));
    fireEvent.pointerEnter(container.querySelector('.gsd-wt'));
    act(() => { jest.advanceTimersByTime(PLAY_MS * 2); });
    expect(screen.getByText('Step 1 of 5')).toBeInTheDocument();
  });

  test('is never offered under reduced motion, so it can never start', () => {
    motion(true);
    jest.useFakeTimers();
    render(<FormatWalkthrough format="call-and-answer" label="Call & Answer" />);
    expect(screen.queryByRole('button', { name: /Play/ })).toBeNull();
    act(() => { jest.advanceTimersByTime(PLAY_MS * 3); });
    expect(screen.getByText('Step 1 of 5')).toBeInTheDocument();
  });
});
