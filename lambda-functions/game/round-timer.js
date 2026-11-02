/**
 * THE ROUND TIMER (experience plan Phase 2 step 2f; session-start D4, forks
 * F2-F4, accepted by the owner on 1 Nov 2026).
 *
 * The host picks a time as a phase opens (a chip beside Start round N and
 * Start voting: No limit, 1, 2, 3 or 5 minutes). The time is ADVISORY: at
 * zero nothing closes unless the host ticked "Close answering at zero". +1 min
 * gives the room another minute, timed by THIS server's clock.
 *
 * STATE fields, written by the call that opens the phase (next-question.js for
 * ASK#nnn, start-vote.js for VOTE#nnn):
 *
 *   PhaseStartedAt   ISO, when this phase opened (every opening, timed or not:
 *                    voting had no reliable stamp before, STATE.UpdatedAt moves
 *                    on every write)
 *   TimePhase        the state the timer belongs to ('ASK#002', 'VOTE#002'), so
 *                    a timer never leaks into the next phase
 *   TimeLimitMs      the time given; absent with No limit
 *   TimeExtendedMs   what +1 min has added; 0 at opening
 *   TimeOnWall       the room's window and the phones show the time in words
 *   TimeCloses       answering closes on its own at zero (opt-in)
 *   TimeChoiceAsk /
 *   TimeChoiceVote   the session's last choice for that kind of opening, so a
 *                    round opened from the phone Remote (or by a door that sends
 *                    no time) carries the same timer the laptop chose
 *
 * THE SERVER'S CLOCK IS THE REFERENCE. Every read and frame carries
 * `serverNow`; a client works out time left from these timestamps plus its
 * measured offset to `serverNow`, never from its own clock alone (the takeover
 * countdown once showed a skewed 5:07).
 *
 * IDENTICAL COPIES in lambda-functions/game/ and lambda-functions/websocket/
 * (separate deploy bundles); tests/round-timer.js holds them equal.
 */

const MINUTE_MS = 60 * 1000;
/** The chip's presets. 0 is No limit, a first-class choice and the default. */
const PRESET_MS = Object.freeze([0, MINUTE_MS, 2 * MINUTE_MS, 3 * MINUTE_MS, 5 * MINUTE_MS]);
/** One press of +1 min. */
const STEP_MS = MINUTE_MS;
/** A held key or a stuck client cannot push a round past an hour of extra time. */
const MAX_EXTENDED_MS = 60 * MINUTE_MS;

/**
 * The opening call's `time` ({ limitMs, onWall, closes }) made safe. Anything
 * that is not a preset is No limit. The time shows on the wall unless the host
 * said otherwise (F3: on by default). Closing is opt-in, and only means
 * something with a limit.
 */
function timerFromBody(raw) {
  const t = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const asked = Number(t.limitMs);
  const limitMs = PRESET_MS.includes(asked) ? asked : 0;
  return { limitMs, onWall: t.onWall !== false, closes: limitMs > 0 && t.closes === true };
}

/** A stored choice (TimeChoiceAsk / TimeChoiceVote) read back, or null. */
function storedChoice(value) {
  if (!value || typeof value !== 'object') return null;
  return timerFromBody(value);
}

/**
 * The timer for an opening: the body's when it sent one, else the session's
 * last choice for this kind of opening, else No limit.
 */
function timerForOpening(body, state, kind) {
  if (body && Object.prototype.hasOwnProperty.call(body, 'time')) return timerFromBody(body.time);
  const remembered = storedChoice(state && state[kind === 'vote' ? 'TimeChoiceVote' : 'TimeChoiceAsk']);
  return remembered || timerFromBody(null);
}

/**
 * The clauses an opening adds to its STATE update: SET and REMOVE parts plus
 * the names and values they use, for the caller to splice into its own
 * UpdateExpression. Placeholders are prefixed `rt` so they cannot collide.
 */
function openingClauses(phase, nowIso, timer, kind) {
  const t = timerFromBody(timer);
  const names = {
    '#rtPhaseStartedAt': 'PhaseStartedAt',
    '#rtPhase': 'TimePhase',
    '#rtLimit': 'TimeLimitMs',
    '#rtExtended': 'TimeExtendedMs',
    '#rtOnWall': 'TimeOnWall',
    '#rtCloses': 'TimeCloses',
    '#rtChoice': kind === 'vote' ? 'TimeChoiceVote' : 'TimeChoiceAsk',
  };
  const values = {
    ':rtPhaseStartedAt': nowIso,
    ':rtPhase': phase,
    ':rtChoice': { limitMs: t.limitMs, onWall: t.onWall, closes: t.closes },
  };
  const set = ['#rtPhaseStartedAt = :rtPhaseStartedAt', '#rtPhase = :rtPhase', '#rtChoice = :rtChoice'];
  const remove = [];
  if (t.limitMs > 0) {
    set.push('#rtLimit = :rtLimit', '#rtExtended = :rtExtended', '#rtOnWall = :rtOnWall', '#rtCloses = :rtCloses');
    Object.assign(values, { ':rtLimit': t.limitMs, ':rtExtended': 0, ':rtOnWall': t.onWall, ':rtCloses': t.closes });
  } else {
    remove.push('#rtLimit', '#rtExtended', '#rtOnWall', '#rtCloses');
  }
  return { set, remove, names, values, timer: t };
}

/** The STATE row as it reads after an opening (for the frames sent right after it). */
function stateAfterOpening(state, phase, nowIso, timer) {
  const t = timerFromBody(timer);
  const next = { ...(state || {}), State: phase, PhaseStartedAt: nowIso, TimePhase: phase };
  if (t.limitMs > 0) Object.assign(next, { TimeLimitMs: t.limitMs, TimeExtendedMs: 0, TimeOnWall: t.onWall, TimeCloses: t.closes });
  else { delete next.TimeLimitMs; delete next.TimeExtendedMs; delete next.TimeOnWall; delete next.TimeCloses; }
  return next;
}

const isOnPhase = (state, phase) => {
  const s = String((state && state.State) || '');
  return Boolean(phase) && (s === phase || s.startsWith(`${phase}#`));
};

/**
 * The timer as a reader sees it, or null.
 *
 * PUBLIC (the room's window, the phones, /state, every broadcast frame): only
 * while its phase is on, only when the host left "show the time" on, and only
 * what the wall needs to draw words and a bar: { phase, startedAt, limitMs,
 * extendedMs }. Whether it closes at zero is the host's business.
 *
 * HOST (`host: true`, the host's door and host-only frames): whenever a limit
 * is stored, with `onWall` and `closes`, so the console can also say "Took 2:14
 * · 2:00 given" after the phase has closed.
 */
function timerView(state, { host = false } = {}) {
  if (!state) return null;
  const limitMs = Number(state.TimeLimitMs) || 0;
  if (limitMs <= 0 || !state.TimePhase || !state.PhaseStartedAt) return null;
  const onWall = state.TimeOnWall !== false;
  if (!host && (!onWall || !isOnPhase(state, state.TimePhase))) return null;
  const view = {
    phase: String(state.TimePhase),
    startedAt: String(state.PhaseStartedAt),
    limitMs,
    extendedMs: Math.max(0, Number(state.TimeExtendedMs) || 0),
  };
  if (host) {
    view.onWall = onWall;
    view.closes = state.TimeCloses === true;
  }
  return view;
}

/** Epoch ms when the time runs out, or null with no limit. */
function endsAtMs(state) {
  const limitMs = Number(state && state.TimeLimitMs) || 0;
  const started = Date.parse(state && state.PhaseStartedAt);
  if (limitMs <= 0 || !Number.isFinite(started)) return null;
  return started + limitMs + Math.max(0, Number(state.TimeExtendedMs) || 0);
}

/**
 * What TimeExtendedMs becomes after one +1 min, by the server's clock: one more
 * minute while time is left (0:47 left becomes 1:47), and a minute FROM NOW
 * once it has run out (0:18 over becomes 1:00 left; "give them another minute"
 * means another minute, not 0:42).
 */
function extendedAfterPlusOne(state, nowMs) {
  const current = Math.max(0, Number(state && state.TimeExtendedMs) || 0);
  const ends = endsAtMs(state);
  if (ends === null) return null;
  const fromNow = current + (nowMs - ends) + STEP_MS;
  return Math.min(MAX_EXTENDED_MS, Math.max(current + STEP_MS, fromNow));
}

/** Answering may close on its own: a limit, the opt-in tick, and zero reached by the server's clock. */
function isDue(state, nowMs) {
  if (!state || state.TimeCloses !== true) return false;
  if (!isOnPhase(state, state.TimePhase)) return false;
  const ends = endsAtMs(state);
  return ends !== null && nowMs >= ends;
}

module.exports = {
  MINUTE_MS,
  PRESET_MS,
  STEP_MS,
  MAX_EXTENDED_MS,
  timerFromBody,
  timerForOpening,
  openingClauses,
  stateAfterOpening,
  timerView,
  endsAtMs,
  extendedAfterPlusOne,
  isDue,
};
