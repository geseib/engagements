/**
 * THE PULSE'S TIME TILE WITH A TIMER (config/consolePulse.js,
 * components/console/ConsolePulse.jsx; experience plan 2f; session-start D3
 * row 2, frames 1-b1 and 1-b3).
 *
 * // rejects: a tile that loses "Open 1:24" with no limit, shows no time
 * //          given, stays calm at zero, or draws +1 min with nothing to add to.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import ConsolePulse from '../components/console/ConsolePulse';
import { pulseFor } from '../config/consolePulse';

const T0 = Date.parse('2026-11-02T10:00:00Z');
const iso = (ms) => new Date(ms).toISOString();
const MIN = 60000;
const timer = (extra = {}) => ({ phase: 'ASK#002', startedAt: iso(T0), limitMs: 2 * MIN, extendedMs: 0, ...extra });

describe('the facts', () => {
  test('no limit: today\'s elapsed time, unchanged', () => {
    const p = pulseFor({ moment: 'ANSWERING', players: 12, answered: 9, openedAt: iso(T0), now: T0 + 84000 });
    expect(p.time).toMatchObject({ value: 'Open 1:24', sub: 'No limit set', state: 'none', ring: null });
  });
  test('running: time left of time given, with the ring', () => {
    const p = pulseFor({ moment: 'ANSWERING', players: 12, answered: 9, openedAt: iso(T0), now: T0 + 73000, timer: timer() });
    expect(p.time).toMatchObject({ value: '0:47', sub: 'left of 2:00', state: 'running' });
    expect(p.time.ring).toBeCloseTo(47 / 120);
  });
  test('extended: the minute added is part of the time given, and said', () => {
    const p = pulseFor({ moment: 'ANSWERING', now: T0 + 2 * MIN, timer: timer({ extendedMs: MIN }) });
    expect(p.time).toMatchObject({ value: '1:00', sub: 'left of 3:00 · 1 min added', state: 'extended' });
  });
  test('time\'s up: amber, counting over', () => {
    const p = pulseFor({ moment: 'ANSWERING', now: T0 + 2 * MIN + 18000, timer: timer() });
    expect(p.time).toMatchObject({ value: "Time's up", sub: '0:18 over 2:00', state: 'up', ring: 0 });
  });
  test('voting has its own timer', () => {
    const p = pulseFor({ moment: 'VOTING', now: T0 + 30000, timer: timer({ phase: 'VOTE#002', limitMs: MIN }) });
    expect(p.time).toMatchObject({ value: '0:30', sub: 'left of 1:00', state: 'running' });
  });
  test('after the round: what it took, and the time given', () => {
    const p = pulseFor({ moment: 'RESULTS', openedAt: iso(T0), voteAt: iso(T0 + 134000), now: T0 + 200000, timer: timer() });
    expect(p.time).toMatchObject({ value: 'Took 2:14', state: 'none' });
    expect(p.time.sub).toMatch(/^2:00 given/);
  });
  test('reduced motion: the ring moves in 10 s steps', () => {
    const a = pulseFor({ moment: 'ANSWERING', now: T0 + 71000, timer: timer(), ringStepMs: 10000 });
    const b = pulseFor({ moment: 'ANSWERING', now: T0 + 79000, timer: timer(), ringStepMs: 10000 });
    expect(a.time.ring).toBe(b.time.ring);
    expect(a.time.value).not.toBe(b.time.value); // the words still say the second
  });
});

describe('the tile', () => {
  test('running: the ring, the words and +1 min, which calls the page', () => {
    const onAddMinute = jest.fn();
    const { container } = render(<ConsolePulse moment="ANSWERING" players={12} answered={9} now={T0 + 73000} timer={timer()} onAddMinute={onAddMinute} />);
    expect(screen.getByTestId('pulse-time')).toHaveTextContent('0:47');
    expect(screen.getByTestId('pulse-time-sub')).toHaveTextContent('left of 2:00');
    expect(container.querySelector('[data-tile="time"]')).toHaveAttribute('data-time-state', 'running');
    expect(container.querySelector('.cpulse-ring')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '+1 min' }));
    expect(onAddMinute).toHaveBeenCalledTimes(1);
  });
  test('time\'s up: the tile turns amber (is-up) and counts over', () => {
    const { container } = render(<ConsolePulse moment="ANSWERING" now={T0 + 2 * MIN + 18000} timer={timer()} onAddMinute={() => {}} />);
    const tile = container.querySelector('[data-tile="time"]');
    expect(tile).toHaveClass('is-up');
    expect(tile).toHaveAttribute('data-time-state', 'up');
    expect(screen.getByTestId('pulse-time')).toHaveTextContent("Time's up");
    expect(screen.getByTestId('pulse-time-sub')).toHaveTextContent('0:18 over 2:00');
  });
  test('extended', () => {
    const { container } = render(<ConsolePulse moment="ANSWERING" now={T0 + 2 * MIN} timer={timer({ extendedMs: MIN })} />);
    expect(container.querySelector('[data-tile="time"]')).toHaveAttribute('data-time-state', 'extended');
    expect(screen.getByTestId('pulse-time-sub')).toHaveTextContent('1 min added');
  });
  test('no limit: "Open 1:24", no ring, no +1 min', () => {
    const { container } = render(<ConsolePulse moment="ANSWERING" openedAt={iso(T0)} now={T0 + 84000} onAddMinute={() => {}} />);
    expect(screen.getByTestId('pulse-time')).toHaveTextContent('Open 1:24');
    expect(container.querySelector('.cpulse-ring')).toBeNull();
    expect(screen.queryByRole('button', { name: '+1 min' })).toBeNull();
  });
});
