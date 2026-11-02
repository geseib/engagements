/**
 * THE ROUND TIMER, client side (experience plan Phase 2 step 2f;
 * docs/design/session-start/README.md D4, forks F2-F4, accepted 1 Nov 2026).
 * The server's half is lambda-functions/game/round-timer.js.
 *
 *   - Chosen as a phase opens: a chip beside Start round N and Start voting.
 *     Presets only (No limit, 1, 2, 3, 5 min); No limit is the default and a
 *     first-class choice; voting has its own chip and defaults to No limit.
 *     The last choice is remembered in this browser for the host's next round
 *     and next session.
 *   - Advisory: at zero nothing closes unless the host ticked "Close answering
 *     at zero". +1 min (button, + or = key, and on the phone Remote).
 *   - The host sees time left of time given; the room's window and the phones
 *     see WORDS and a draining bar, never seconds (F3).
 *
 * Pure: words, arithmetic and the remembered choice. Time is always the
 * server's (utils/serverClock.js), passed in as `now`.
 */

export const MINUTE_MS = 60 * 1000;

export const TIME_PRESETS = Object.freeze([
  { ms: 0, label: 'No limit' },
  { ms: MINUTE_MS, label: '1 min' },
  { ms: 2 * MINUTE_MS, label: '2 min' },
  { ms: 3 * MINUTE_MS, label: '3 min' },
  { ms: 5 * MINUTE_MS, label: '5 min' },
]);
const PRESET_MS = TIME_PRESETS.map((p) => p.ms);

export const TIMER_WORDS = Object.freeze({
  noLimit: 'No limit',
  timesUp: 'Time\'s up',
  plusOne: '+1 min',
  plusOneLabel: 'Give them another minute',
  plusOneKeys: '+ or =',
  leftOf: (given) => `left of ${given}`,
  overOf: (over, given) => `${over} over ${given}`,
  given: (given) => `${given} given`,
  added: (n) => (n === 1 ? '1 min added' : `${n} min added`),
  chipTitle: { ask: (n) => (n ? `Time for answering, round ${n}` : 'Time for answering'), vote: 'Time for voting' },
  chipButton: (label) => `Time: ${label}`,
  showOnWall: 'Show the time on the room\'s window',
  showOnWallNote: 'As words: "About a minute left". Phones see the same line.',
  closeAtZero: 'Close answering at zero',
  closeAtZeroNote: 'Off: you decide. The console says "Time\'s up". On: voting opens at zero while this page or your phone Remote is open.',
  remembered: 'Remembered for your next round. Voting has its own chip.',
  rememberedVote: 'Remembered for your next vote.',
  timesUpPart: { before: '', action: 'Time\'s up.', after: ' Start voting, or give them another minute.' },
  timesUpPartNoVote: { before: '', action: 'Time\'s up.', after: ' Show the results, or give them another minute.' },
  remoteHeading: 'Time',
});

/** "1 min" / "No limit" for a stored limit; anything else reads as No limit. */
export function presetLabel(ms) {
  const hit = TIME_PRESETS.find((p) => p.ms === Number(ms));
  return hit ? hit.label : TIMER_WORDS.noLimit;
}

/** A choice made safe: presets only; closing only with a limit (and only answering closes). */
export function normalizeChoice(raw, kind = 'ask') {
  const t = raw && typeof raw === 'object' ? raw : {};
  const limitMs = PRESET_MS.includes(Number(t.limitMs)) ? Number(t.limitMs) : 0;
  return {
    limitMs,
    onWall: t.onWall !== false,
    closes: kind === 'ask' && limitMs > 0 && t.closes === true,
  };
}

export const DEFAULT_CHOICES = Object.freeze({
  ask: Object.freeze(normalizeChoice(null, 'ask')),
  vote: Object.freeze(normalizeChoice(null, 'vote')),
});

const STORE_KEY = 'engage.roundTimer.v1';

/** This browser's last choices, or the defaults. Never throws (private windows, blocked storage). */
export function loadTimeChoices(storage = null) {
  try {
    const s = storage || window.localStorage;
    const raw = s && s.getItem(STORE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return {
      ask: normalizeChoice(parsed && parsed.ask, 'ask'),
      vote: normalizeChoice(parsed && parsed.vote, 'vote'),
    };
  } catch (e) {
    return { ask: { ...DEFAULT_CHOICES.ask }, vote: { ...DEFAULT_CHOICES.vote } };
  }
}

export function saveTimeChoices(choices, storage = null) {
  try {
    const s = storage || window.localStorage;
    if (s) s.setItem(STORE_KEY, JSON.stringify({ ask: normalizeChoice(choices && choices.ask, 'ask'), vote: normalizeChoice(choices && choices.vote, 'vote') }));
  } catch (e) { /* the choice still holds for this page */ }
}

/** Epoch ms of an ISO string or number, or null. */
function msOf(v) {
  if (v === null || v === undefined || v === '') return null;
  const t = typeof v === 'number' ? v : Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

/**
 * Where a timer stands at `now` (server time): what was given (limit plus
 * every +1 min), what is left, how far over, and the fraction left for the
 * ring and the bar. null for no timer.
 */
export function timeLeft(timer, now) {
  if (!timer) return null;
  const limitMs = Number(timer.limitMs) || 0;
  const started = msOf(timer.startedAt);
  if (limitMs <= 0 || started === null) return null;
  const extendedMs = Math.max(0, Number(timer.extendedMs) || 0);
  const givenMs = limitMs + extendedMs;
  const leftMs = started + givenMs - Number(now);
  return {
    limitMs,
    extendedMs,
    givenMs,
    leftMs: Math.max(0, leftMs),
    overMs: Math.max(0, -leftMs),
    up: leftMs <= 0,
    fraction: givenMs > 0 ? Math.max(0, Math.min(1, leftMs / givenMs)) : 0,
  };
}

/**
 * THE ROOM'S WORDS (F3): never a number of seconds. The room should think,
 * not race; seconds are the host's alone.
 */
export const ROOM_TIME_WORDS = Object.freeze({
  minutes: (n) => `About ${n} minutes left`,
  aMinute: 'About a minute left',
  nearly: 'Nearly time',
  up: 'Time\'s up',
});

export function roomTimeWords(leftMs) {
  const left = Number(leftMs);
  if (!Number.isFinite(left) || left <= 0) return ROOM_TIME_WORDS.up;
  if (left <= 40 * 1000) return ROOM_TIME_WORDS.nearly;
  if (left <= 90 * 1000) return ROOM_TIME_WORDS.aMinute;
  return ROOM_TIME_WORDS.minutes(Math.max(2, Math.round(left / MINUTE_MS)));
}

/** The base phase of a state: 'ASK#002' for 'ASK#002' or 'ASK#002#…'. */
export function basePhase(gameState) {
  const m = /^(ASK|VOTE|RESULTS)#(\d+)/.exec(String(gameState || ''));
  return m ? `${m[1]}#${m[2]}` : '';
}

/** The timer, when it belongs to the phase that is on; else null. */
export function timerOnPhase(timer, gameState) {
  if (!timer || !timer.phase) return null;
  return basePhase(gameState) === String(timer.phase) ? timer : null;
}

/** Which chip an opening control takes: 'ask' (a round opens), 'vote' (voting opens) or null. */
export function chipKindFor(control) {
  if (!control) return null;
  if (control.intent === 'start' || control.intent === 'next') return 'ask';
  if (control.id === 'open-vote') return 'vote';
  return null;
}

/** "1:24", never negative (the host's own console only). */
export function clock(ms) {
  const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Merge a timer from a frame into the one held: a frame from the room's side
 * carries no onWall/closes, so they are kept when it is the same phase. A
 * public frame means the room is shown the time.
 */
export function mergeTimer(held, incoming) {
  if (!incoming) return held || null;
  const hasHostFacts = Object.prototype.hasOwnProperty.call(incoming, 'closes');
  if (hasHostFacts) return { ...incoming };
  const same = held && held.phase === incoming.phase;
  return { ...incoming, onWall: true, closes: same ? Boolean(held.closes) : false };
}
