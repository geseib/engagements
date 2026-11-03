/**
 * THE ROUND TIMER, client rules (config/roundTimer.js, utils/serverClock.js;
 * experience plan Phase 2 step 2f; session-start D4, F2-F4).
 *
 * // rejects: a chip that offers anything but the presets, forgets the last
 * //          choice, or closes by default; room words that show seconds; time
 * //          left measured on the laptop's own clock (the takeover once read a
 * //          skewed 5:07).
 */
import {
  TIME_PRESETS, MINUTE_MS, presetLabel, normalizeChoice, loadTimeChoices, saveTimeChoices, DEFAULT_CHOICES,
  timeLeft, roomTimeWords, ROOM_TIME_WORDS, timerOnPhase, chipKindFor, mergeTimer, basePhase, clock,
} from '../config/roundTimer';
import { noteServerNow, serverNowMs, serverOffsetMs, resetServerClock } from '../utils/serverClock';
import { hostControlsFor } from '../config/hostControls';

const MIN = MINUTE_MS;
const T0 = Date.parse('2026-11-02T10:00:00Z');
const iso = (ms) => new Date(ms).toISOString();

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m };
}

describe('the chip\'s choices', () => {
  test('No limit, 1, 2, 3, 5 min, in that order; No limit first and the default', () => {
    expect(TIME_PRESETS.map((p) => p.label)).toEqual(['No limit', '1 min', '2 min', '3 min', '5 min']);
    expect(TIME_PRESETS.map((p) => p.ms)).toEqual([0, MIN, 2 * MIN, 3 * MIN, 5 * MIN]);
    expect(DEFAULT_CHOICES.ask).toEqual({ limitMs: 0, onWall: true, closes: false });
    expect(DEFAULT_CHOICES.vote).toEqual({ limitMs: 0, onWall: true, closes: false });
  });
  test('anything else reads as No limit; closing is opt-in, needs a limit, and only answering closes', () => {
    expect(normalizeChoice({ limitMs: 90000, closes: true })).toEqual({ limitMs: 0, onWall: true, closes: false });
    expect(normalizeChoice({ limitMs: 2 * MIN, closes: true })).toEqual({ limitMs: 2 * MIN, onWall: true, closes: true });
    expect(normalizeChoice({ limitMs: 2 * MIN, closes: true }, 'vote').closes).toBe(false);
    expect(normalizeChoice({ limitMs: MIN, onWall: false }).onWall).toBe(false);
    expect(presetLabel(3 * MIN)).toBe('3 min');
    expect(presetLabel(1234)).toBe('No limit');
  });
});

describe('memory: the last choice carries to the next round and the next session', () => {
  test('saved and read back, per kind', () => {
    const s = memoryStorage();
    expect(loadTimeChoices(s)).toEqual({ ask: DEFAULT_CHOICES.ask, vote: DEFAULT_CHOICES.vote });
    saveTimeChoices({ ask: { limitMs: 2 * MIN, onWall: false, closes: true }, vote: { limitMs: MIN } }, s);
    expect(loadTimeChoices(s)).toEqual({
      ask: { limitMs: 2 * MIN, onWall: false, closes: true },
      vote: { limitMs: MIN, onWall: true, closes: false },
    });
  });
  test('blocked or corrupt storage falls back to the defaults, never throws', () => {
    const throwing = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    expect(loadTimeChoices(throwing)).toEqual({ ask: DEFAULT_CHOICES.ask, vote: DEFAULT_CHOICES.vote });
    expect(() => saveTimeChoices({ ask: { limitMs: MIN } }, throwing)).not.toThrow();
    const corrupt = memoryStorage();
    corrupt.setItem('engage.roundTimer.v1', '{nope');
    expect(loadTimeChoices(corrupt).ask.limitMs).toBe(0);
  });
});

describe('time left, of time given', () => {
  const timer = { phase: 'ASK#002', startedAt: iso(T0), limitMs: 2 * MIN, extendedMs: 0 };
  test('running', () => {
    expect(timeLeft(timer, T0 + 73000)).toMatchObject({ leftMs: 47000, givenMs: 2 * MIN, up: false });
    expect(timeLeft(timer, T0 + 73000).fraction).toBeCloseTo(47 / 120);
  });
  test('extended: +1 min is part of what was given', () => {
    expect(timeLeft({ ...timer, extendedMs: MIN }, T0 + 2 * MIN)).toMatchObject({ leftMs: MIN, givenMs: 3 * MIN, up: false });
  });
  test('up: counts over, the fraction is empty', () => {
    expect(timeLeft(timer, T0 + 2 * MIN + 18000)).toMatchObject({ leftMs: 0, overMs: 18000, up: true, fraction: 0 });
  });
  test('No limit is no timer', () => {
    expect(timeLeft({ ...timer, limitMs: 0 }, T0)).toBeNull();
    expect(timeLeft(null, T0)).toBeNull();
  });
  test('the host\'s clock reads m:ss', () => {
    expect(clock(47000)).toBe('0:47');
    expect(clock(2 * MIN)).toBe('2:00');
  });
});

describe('the room\'s words: never seconds (F3)', () => {
  const samples = [5 * MIN, 3 * MIN, 150000, 2 * MIN, 91000, 90000, MIN, 41000, 40000, 30000, 10000, 1000, 0, -5000];
  test.each(samples)('%i ms left', (ms) => {
    const words = roomTimeWords(ms);
    expect(words).not.toMatch(/\d+\s*(s|sec|secs|second|seconds)\b/i);
    expect(words).not.toMatch(/\d:\d/);
  });
  test('the ladder', () => {
    expect(roomTimeWords(5 * MIN)).toBe('About 5 minutes left');
    expect(roomTimeWords(2 * MIN)).toBe('About 2 minutes left');
    expect(roomTimeWords(MIN)).toBe(ROOM_TIME_WORDS.aMinute);
    expect(roomTimeWords(30000)).toBe(ROOM_TIME_WORDS.nearly);
    expect(roomTimeWords(0)).toBe("Time's up");
  });
});

describe('which timer belongs to the phase that is on', () => {
  const t = { phase: 'ASK#002', startedAt: iso(T0), limitMs: MIN, extendedMs: 0 };
  test('same phase only', () => {
    expect(basePhase('VOTE#002#RESPONSES')).toBe('VOTE#002');
    expect(timerOnPhase(t, 'ASK#002')).toBe(t);
    expect(timerOnPhase(t, 'VOTE#002')).toBeNull();
    expect(timerOnPhase(t, 'ASK#003')).toBeNull();
    expect(timerOnPhase(null, 'ASK#002')).toBeNull();
  });
  test('a frame from the room\'s side keeps what only the host knows', () => {
    const held = { ...t, onWall: true, closes: true };
    expect(mergeTimer(held, { ...t, extendedMs: MIN })).toMatchObject({ extendedMs: MIN, closes: true, onWall: true });
    expect(mergeTimer(held, { ...t, phase: 'VOTE#002' }).closes).toBe(false);
    expect(mergeTimer(held, { ...t, onWall: false, closes: false }).closes).toBe(false);
    expect(mergeTimer(held, null)).toBe(held);
  });
});

describe('the chip sits beside the opening moves only', () => {
  const base = { gameType: 'call-and-answer', playerCount: 4, answeredCount: 2, votedCount: 0, answerCount: 2, hasQuestionSet: true };
  test('Start round 1, Next round: answering; Start voting: voting; Show results: none', () => {
    expect(chipKindFor(hostControlsFor({ ...base, phase: 'LOBBY' }).primary)).toBe('ask');
    expect(chipKindFor(hostControlsFor({ ...base, phase: 'ASK' }).primary)).toBe('vote');
    expect(chipKindFor(hostControlsFor({ ...base, phase: 'VOTE' }).primary)).toBeNull();
    expect(chipKindFor(hostControlsFor({ ...base, phase: 'FEEDBACK' }).primary)).toBe('ask');
    expect(chipKindFor(hostControlsFor({ ...base, gameType: 'trivia', phase: 'ASK' }).primary)).toBeNull();
  });
});

describe('the server\'s clock, never the laptop\'s alone', () => {
  beforeEach(() => resetServerClock());
  test('no reading: the local clock', () => {
    expect(serverOffsetMs()).toBe(0);
    expect(serverNowMs(T0)).toBe(T0);
  });
  test('a laptop five minutes fast reads the server\'s time from a timed reading (the midpoint)', () => {
    const local = T0 + 5 * MIN;
    noteServerNow(T0 + 100, local, local + 200);
    expect(serverNowMs(local + 200)).toBe(T0 + 100 + 100);
  });
  test('the tightest round trip wins; a frame counts as a second of error', () => {
    noteServerNow(T0, T0 - 4000, T0 + 4000); // 8 s round trip: offset 0, error 4 s
    noteServerNow(T0 + 1000, null, T0); // frame: offset +1 s, error 1 s
    expect(serverOffsetMs()).toBe(1000);
    noteServerNow(T0 + 2500, T0 + 2000, T0 + 2100); // 100 ms round trip
    expect(serverOffsetMs()).toBe(450);
  });
  test('junk is ignored', () => {
    noteServerNow(undefined);
    noteServerNow('soon');
    expect(serverOffsetMs()).toBe(0);
  });
});
