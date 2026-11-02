/**
 * THE ROOM'S TIME LINE on the room's window and the phones
 * (components/RoomTimeLine.jsx; present/presentModel.js and PresentMoments;
 * PlayerPage; experience plan 2f, frames 1-b7 and 1-c3).
 *
 * // rejects: seconds on the wall or a phone; a time line when the host turned
 * //          "show the time" off; a line that measures the laptop's clock.
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen } from '@testing-library/react';
import RoomTimeLine from '../components/RoomTimeLine';
import { presentModel } from '../present/presentModel';
import { PresentAnswering } from '../present/PresentMoments';
import { resetServerClock, noteServerNow } from '../utils/serverClock';

const T0 = Date.parse('2026-11-02T10:00:00Z');
const iso = (ms) => new Date(ms).toISOString();
const MIN = 60000;
const time = { phase: 'ASK#002', startedAt: iso(T0), limitMs: 2 * MIN, extendedMs: 0 };

describe('words and a bar, never seconds', () => {
  test.each([
    [10000, 'About 2 minutes left'],
    [73000, 'About a minute left'],
    [100000, 'Nearly time'],
    [2 * MIN + 5000, "Time's up"],
  ])('at %i ms in: %s', (elapsed, words) => {
    render(<RoomTimeLine time={time} now={T0 + elapsed} />);
    const line = screen.getByTestId('room-time');
    expect(line).toHaveTextContent(words);
    expect(line.textContent).not.toMatch(/\d:\d\d|\d+\s*s(ec(ond)?s?)?\b/);
  });
  test('the bar drains with the time left', () => {
    const { container } = render(<RoomTimeLine time={time} now={T0 + 90000} />);
    expect(container.querySelector('.rtime-bar i').style.width).toBe('25%');
  });
  test('nothing at all with no timer (No limit, or not shown on the wall)', () => {
    const { container } = render(<RoomTimeLine time={null} now={T0} />);
    expect(container).toBeEmptyDOMElement();
  });
  test('the clock is the server\'s: a laptop five minutes fast still reads the round right', () => {
    jest.useFakeTimers();
    jest.setSystemTime(T0 + 5 * MIN + 10000);
    resetServerClock();
    noteServerNow(T0 + 10000, T0 + 5 * MIN + 9900, T0 + 5 * MIN + 10100);
    render(<RoomTimeLine time={time} />);
    expect(screen.getByTestId('room-time')).toHaveTextContent('About 2 minutes left');
    jest.useRealTimers();
    resetServerClock();
  });
});

describe('the room\'s window', () => {
  const snapshot = (extra = {}) => ({
    gameId: '7924', state: 'ASK#002', currentQuestion: 2, gameType: 'call-and-answer',
    currentQuestionData: { title: 'The Meiji Restoration', questionNumber: '002' },
    roomCounts: { joined: 12, answered: 9, voted: 0 },
    ...extra,
  });
  test('answering carries the time only when /state does', () => {
    expect(presentModel(snapshot({ time })).time).toEqual(time);
    expect('time' in presentModel(snapshot({ time: null }))).toBe(false);
  });
  test('voting too', () => {
    expect(presentModel(snapshot({ state: 'VOTE#002', time: { ...time, phase: 'VOTE#002' } })).time.phase).toBe('VOTE#002');
  });
  test('the answering wall draws the words in its foot, beside the pips', () => {
    const model = presentModel(snapshot({ time: { ...time, startedAt: iso(Date.now() - 73000) } }));
    const { container } = render(<PresentAnswering model={model} />);
    const foot = container.querySelector('.present-foot');
    expect(foot.querySelector('[data-testid="room-time"]')).toHaveTextContent('About a minute left');
  });
  test('the wall re-reads /state when +1 min lands', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'present', 'usePresentation.js'), 'utf8');
    expect(src).toMatch(/'roundTimeChanged'/);
    expect(src).toMatch(/noteServerNow\(snap\.serverNow, sentAt\)/);
  });
});

describe('a participant\'s phone', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'PlayerPage.jsx'), 'utf8');
  test('draws the same time line, only for the phase that is on, from /state and the frames', () => {
    expect(src).toMatch(/<RoomTimeLine time=\{roomTimer\} className="plr-time" \/>/);
    expect(src).toMatch(/const roomTimer = timerOnPhase\(roomTime, gameState\)/);
    expect(src).toMatch(/onMessage\('roundTimeChanged'/);
    expect(src).toMatch(/setRoomTime\(stateJson\.time \|\| null\)/);
  });
});
