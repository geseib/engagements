/**
 * THE SCOREBOARD FLASH between two trivia rounds — config/scoreFlash.js, its
 * one timer (components/stage/scoreboard/useScoreFlash.js), the board's foot
 * line, the session menu's setting, Auto's SCORE_FLASH step, and the host
 * page's wiring as source (GameHostPage cannot be mounted in jsdom; see
 * hookDepOrder.test.js).
 *
 * Owner, 2026-11-09: "both in standard mode and automode we need a quick
 * flashup of the scoreboard after each round."
 *
 * rejects: a flash on the last round (doubling the final standings), on a
 * Call & Answer session, before any round is scored, or with the setting
 * off; a second press that does not skip; a server close (the phone remote
 * opened the round) that ADVANCES and so skips a question; Auto running a
 * timer of its own while the board flashes.
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { act, render, renderHook, screen, fireEvent } from '@testing-library/react';
import {
  DEFAULT_SCORE_FLASH_SECONDS, SCORE_FLASH_CHOICES, flashSkipKey, normaliseScoreFlash, roundGains,
  scoreFlashApplies, scoreFlashMs, secondsLeft,
} from '../config/scoreFlash';
import useScoreFlash from '../components/stage/scoreboard/useScoreFlash';
import Scoreboard from '../components/stage/scoreboard/Scoreboard';
import SessionSetupPanel from '../components/stage/SessionSetupPanel';
import { autoDecision } from '../config/autoMode';

const PAGE = fs.readFileSync(path.join(__dirname, '..', 'GameHostPage.jsx'), 'utf8');

describe('1. when the flash applies', () => {
  const base = { on: true, gameType: 'trivia', phase: 'FIELD_NOTES', nextRoundExists: true, boardAvailable: true, boardOpen: false };

  test('trivia, after the read or the reveal, a round to come, a scored round: yes', () => {
    expect(scoreFlashApplies(base)).toBe(true);
    expect(scoreFlashApplies({ ...base, phase: 'RESULTS' })).toBe(true);
  });

  test.each([
    ['the setting is off', { on: false }],
    ['the last round (the end has its own standings)', { nextRoundExists: false }],
    ['Call & Answer', { gameType: 'call-and-answer' }],
    ['no round scored yet', { boardAvailable: false }],
    ['the host already has the board up', { boardOpen: true }],
    ['mid-question', { phase: 'ASK' }],
  ])('no when %s', (_, patch) => {
    expect(scoreFlashApplies({ ...base, ...patch })).toBe(false);
  });

  test('the setting: on for trivia by default, 5 seconds; never on for another format', () => {
    expect(normaliseScoreFlash({}, 'trivia')).toEqual({ on: true, seconds: DEFAULT_SCORE_FLASH_SECONDS });
    expect(normaliseScoreFlash({ on: false, seconds: 8 }, 'trivia')).toEqual({ on: false, seconds: 8 });
    expect(normaliseScoreFlash({ on: true }, 'call-and-answer').on).toBe(false);
    expect(normaliseScoreFlash({ seconds: 99 }, 'trivia').seconds).toBe(5);
    expect(SCORE_FLASH_CHOICES).toEqual([3, 5, 8]);
    expect(scoreFlashMs(3)).toBe(3000);
    expect(scoreFlashMs('nonsense')).toBe(5000);
  });

  test('a clicker skips (→, PageDown, Enter); typing does not', () => {
    expect(flashSkipKey({ key: 'ArrowRight' })).toBe(true);
    expect(flashSkipKey({ key: 'PageDown' })).toBe(true);
    expect(flashSkipKey({ key: 'Enter' })).toBe(true);
    expect(flashSkipKey({ key: 'ArrowLeft' })).toBe(false);
    expect(flashSkipKey({ key: 'Enter', target: { tagName: 'INPUT' } })).toBe(false);
    expect(flashSkipKey({ key: 'ArrowRight', metaKey: true })).toBe(false);
  });

  test('this round\'s gains: largest first, nobody new or unchanged, at most three', () => {
    const rows = [
      { name: 'Ada', total: 40, previousScore: 26, movement: 1 },
      { name: 'Bo', total: 38, previousScore: 38, movement: -1 },
      { name: 'Cy', total: 30, previousScore: 18, movement: 0 },
      { name: 'Di', total: 12, previousScore: null, movement: 'new' },
      { name: 'Ed', total: 22, previousScore: 10, movement: 0 },
      { name: 'Fa', total: 15, previousScore: 5, movement: 0 },
    ];
    expect(roundGains(rows)).toEqual([{ name: 'Ada', gain: 14 }, { name: 'Cy', gain: 12 }, { name: 'Ed', gain: 12 }]);
    expect(secondsLeft(1000, 5000, 2100)).toBe(4);
    expect(secondsLeft(1000, 5000, 9000)).toBe(0);
  });
});

describe('2. the one timer', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  function setup() {
    const openBoard = jest.fn();
    const go = jest.fn();
    const hook = renderHook(({ boardOpen }) => useScoreFlash({ boardOpen, openBoard }), { initialProps: { boardOpen: false } });
    return { hook, openBoard, go };
  }

  test('start opens the board; the round opens by itself after the flash, once', () => {
    const { hook, openBoard, go } = setup();
    act(() => { hook.result.current.start({ ms: 5000, nextRound: 4, go }); });
    hook.rerender({ boardOpen: true });
    expect(openBoard).toHaveBeenCalledTimes(1);
    expect(hook.result.current.flash).toMatchObject({ ms: 5000, nextRound: 4 });
    act(() => { jest.advanceTimersByTime(4999); });
    expect(go).not.toHaveBeenCalled();
    act(() => { jest.advanceTimersByTime(1); });
    expect(go).toHaveBeenCalledTimes(1);
    expect(hook.result.current.flash).toBeNull();
    act(() => { jest.advanceTimersByTime(10000); });
    expect(go).toHaveBeenCalledTimes(1);
  });

  test('pressing on skips it: the round opens now, and the timer does not open another', () => {
    const { hook, go } = setup();
    act(() => { hook.result.current.start({ ms: 5000, go }); });
    hook.rerender({ boardOpen: true });
    act(() => { hook.result.current.skip(); });
    expect(go).toHaveBeenCalledTimes(1);
    act(() => { jest.advanceTimersByTime(6000); });
    expect(go).toHaveBeenCalledTimes(1);
  });

  test('a clicker\'s → skips it, and the board never sees the key', () => {
    const { hook, go } = setup();
    act(() => { hook.result.current.start({ ms: 5000, go }); });
    hook.rerender({ boardOpen: true });
    const boardHeard = jest.fn();
    window.addEventListener('keydown', boardHeard);
    act(() => { fireEvent.keyDown(window, { key: 'ArrowRight' }); });
    window.removeEventListener('keydown', boardHeard);
    expect(go).toHaveBeenCalledTimes(1);
    expect(boardHeard).not.toHaveBeenCalled();
  });

  test('the board closed from elsewhere (the phone opened the round): stop, and never advance', () => {
    const { hook, go } = setup();
    act(() => { hook.result.current.start({ ms: 5000, go }); });
    hook.rerender({ boardOpen: true });
    hook.rerender({ boardOpen: false });
    expect(hook.result.current.flash).toBeNull();
    act(() => { jest.advanceTimersByTime(6000); });
    expect(go).not.toHaveBeenCalled();
  });
});

describe('3. the board\'s foot line', () => {
  beforeEach(() => {
    window.matchMedia = jest.fn(() => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        afterRound: 3,
        players: [
          { playerName: 'Ada', totalScore: 40, previousScore: 26, rank: 1, movement: 1 },
          { playerName: 'Bo', totalScore: 38, previousScore: 38, rank: 2, movement: -1 },
        ],
      }),
    }));
  });
  afterEach(() => { delete global.fetch; });

  async function mount(flash) {
    await act(async () => {
      render(
        <div className="stage">
          <Scoreboard gameId="1" apiBase="https://api.test/" profile="room" board={{ open: true, style: 'departure' }} flash={flash} />
        </div>,
      );
    });
    await act(async () => { await Promise.resolve(); });
  }

  test('during a flash: the countdown, how to skip, and this round\'s gains', async () => {
    await mount({ ms: 5000, startedAt: Date.now(), nextRound: 4 });
    const foot = screen.getByTestId('score-flash');
    expect(foot.textContent).toMatch(/Round 4 starts in [45]/);
    expect(foot.textContent).toMatch(/Next or Space to start now/);
    expect(foot.textContent).toMatch(/\+14 Ada/);
    expect(foot.textContent).not.toMatch(/Bo/);
    expect(document.querySelector('[data-scoreboard]').className).toMatch(/sb--flash/);
  });

  test('opened by the host with S: no foot line, the board as it always was', async () => {
    await mount(null);
    expect(screen.queryByTestId('score-flash')).toBeNull();
    expect(document.querySelector('[data-scoreboard]').className).not.toMatch(/sb--flash/);
  });
});

describe('4. the setting, in How it runs', () => {
  const panel = (scoreFlash) => render(
    <SessionSetupPanel gameType="trivia" onClose={() => {}} initialTab="run" scoreFlash={scoreFlash} />,
  );

  test('trivia: on by default, with its length, and a change is reported', () => {
    const onChange = jest.fn();
    panel({ on: true, seconds: 5, onChange });
    const box = screen.getByTestId('score-flash');
    expect(box.checked).toBe(true);
    expect(screen.getByTestId('score-flash-seconds').value).toBe('5');
    fireEvent.change(screen.getByTestId('score-flash-seconds'), { target: { value: '8' } });
    expect(onChange).toHaveBeenLastCalledWith({ seconds: 8 });
    fireEvent.click(box);
    expect(onChange).toHaveBeenLastCalledWith({ on: false });
  });

  test('off: no length to choose; another format: no setting at all', () => {
    const { unmount } = panel({ on: false, seconds: 5, onChange: () => {} });
    expect(screen.queryByTestId('score-flash-seconds')).toBeNull();
    unmount();
    panel(null);
    expect(screen.queryByTestId('score-flash')).toBeNull();
  });
});

describe('5. Auto and the host page', () => {
  test('Auto stands still while the board flashes (SCORE_FLASH has no decision of its own)', () => {
    expect(autoDecision({ enabled: true, phase: 'SCORE_FLASH', playerCount: 4, answeredCount: 4 })).toBeNull();
    // ...and the FIELD_NOTES primary that starts it is still Auto's to press.
    expect(autoDecision({ enabled: true, phase: 'FIELD_NOTES', playerCount: 4, notesReady: true }).kind).toBe('primary');
  });

  test('the auto effect returns before deciding anything while a flash is up', () => {
    const at = PAGE.indexOf('if (!autoMode) return undefined;');
    expect(at).toBeGreaterThan(-1);
    expect(PAGE.slice(at, at + 400)).toMatch(/if \(scoreFlash\.flash\) return undefined;/);
  });

  test('Start round N flashes first, and pressed again skips', () => {
    const at = PAGE.indexOf('case HOST_INTENTS.NEXT:');
    const body = PAGE.slice(at, PAGE.indexOf('case HOST_INTENTS.SKIP:', at));
    expect(body).toMatch(/if \(scoreFlash\.flash\) \{\s*scoreFlash\.skip\(\);/);
    expect(body).toMatch(/scoreFlashApplies\(\{[\s\S]*nextRoundExists,[\s\S]*boardAvailable: scoreboardAvail\.enabled/);
    expect(body).toMatch(/go: \(\) => handleNextQuestion\(false\)/);
  });

  test('the host\'s own close during a flash starts the round; the board gets the flash', () => {
    expect(PAGE).toMatch(/onClose: \(\) => \(scoreFlash\.flash \? scoreFlash\.skip\(\) : publishScoreboard\(\{ open: false \}\)\)/);
    expect(PAGE).toMatch(/flash=\{scoreFlash\.flash\}/);
  });
});
