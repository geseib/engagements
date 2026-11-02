/**
 * THE ROUND TIMER ON THE PHONE REMOTE (components/RemoteTimeCard.jsx,
 * config/hostRemote.js requestFor 'add-time' / 'close-at-zero', HostRemote's
 * wiring; experience plan 2f; session-start D5 C2, frame 1-c2).
 *
 * // rejects: a Remote with no +1 min, a +1 min that does not name the phase it
 * //          was pressed on, and a route name written into HostRemote.jsx.
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen, fireEvent } from '@testing-library/react';
import RemoteTimeCard from '../components/RemoteTimeCard';
import { requestFor } from '../config/hostRemote';

const T0 = Date.parse('2026-11-02T10:00:00Z');
const iso = (ms) => new Date(ms).toISOString();
const MIN = 60000;
const timer = { phase: 'ASK#002', startedAt: iso(T0), limitMs: 2 * MIN, extendedMs: 0, onWall: true, closes: false };

describe('the time card', () => {
  test('running: 0:47 left of 2:00, and +1 min calls the Remote', () => {
    const onAddMinute = jest.fn();
    render(<RemoteTimeCard timer={timer} onAddMinute={onAddMinute} now={T0 + 73000} />);
    expect(screen.getByTestId('remote-time-value')).toHaveTextContent('0:47');
    expect(screen.getByTestId('remote-time')).toHaveTextContent('left of 2:00');
    fireEvent.click(screen.getByRole('button', { name: /another minute/i }));
    expect(onAddMinute).toHaveBeenCalledTimes(1);
  });
  test('time\'s up: amber, counting over', () => {
    render(<RemoteTimeCard timer={timer} onAddMinute={() => {}} now={T0 + 2 * MIN + 18000} />);
    expect(screen.getByTestId('remote-time')).toHaveClass('is-up');
    expect(screen.getByTestId('remote-time-value')).toHaveTextContent("Time's up");
    expect(screen.getByTestId('remote-time')).toHaveTextContent('0:18 over 2:00');
  });
  test('busy while a press is on its way', () => {
    render(<RemoteTimeCard timer={timer} onAddMinute={() => {}} busy now={T0} />);
    expect(screen.getByRole('button', { name: /another minute/i })).toBeDisabled();
  });
  test('no timer: no card', () => {
    const { container } = render(<RemoteTimeCard timer={null} onAddMinute={() => {}} now={T0} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('the requests', () => {
  test('+1 min names the phase it was pressed on, on the host-only stage-beat door', () => {
    expect(requestFor('add-time', { gameId: '7924', round: 2, phase: 'ASK#002' })).toEqual({
      path: 'games/7924/stage-beat', body: { addTime: true, phase: 'ASK#002' },
    });
    expect(requestFor('add-time', { gameId: '7924', round: 2 })).toBeNull();
  });
  test('the close at zero is start-vote with timeUp, so the server decides by its own clock', () => {
    expect(requestFor('close-at-zero', { gameId: '7924', round: 2 })).toEqual({
      path: 'games/7924/start-vote', body: { questionNumber: 2, timeUp: true },
    });
    expect(requestFor('close-at-zero', { gameId: '7924' })).toBeNull();
  });
});

describe('HostRemote\'s wiring', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'HostRemote.jsx'), 'utf8');
  test('the card sits with the meter, from the host-state poll, on the server\'s clock', () => {
    expect(src).toMatch(/<RemoteTimeCard timer=\{remoteTimer\} onAddMinute=\{addMinuteHere\}/);
    expect(src).toMatch(/timerOnPhase\(snapshot && snapshot\.hostTime, snapshot && snapshot\.state\)/);
    expect(src).toMatch(/noteServerNow\(body && body\.serverNow, sentAt\)/);
  });
  test('no route name is written into HostRemote.jsx (config/hostRemote.js builds the paths)', () => {
    const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ').replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ');
    expect(code).not.toMatch(/stage-beat|start-vote/);
  });
});
