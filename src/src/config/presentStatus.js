/**
 * IS THE ROOM'S WINDOW REALLY UP? (spec §3.1; owner, 15 Oct: "does it really
 * know that it is up?"). What the app can know: a Present window is connected
 * to this session, whether it is full screen, and whether its tab is visible.
 * It cannot know the projector is on, so it never claims to.
 *
 * A viewer that has not reported for STALE_MS is treated as gone: its row can
 * outlive a closed tab by up to two hours (connect.js ttl). The age is the
 * host door's `ageMs` (server now − StatusAt) when given, so the laptop's
 * clock is never the judge.
 */
export const STALE_MS = 90 * 1000;

/**
 * ONE INSTRUCTION FOR FILLING THE SCREEN (walk of 18 Oct, W3): the status told
 * the host to press F and the placing link to click once, two different
 * sentences, both in tooltips. Now one, shown as text where the status is (the
 * Screens group, the top lines' note line).
 */
export const FILL_ONCE = 'Click the room\'s window once to fill the screen (or press F)';

/*
  `label` names the window ("Room's window: not open"), for a place where
  nothing beside it does; `short` is the state alone ("Not open"), for a row or
  a top line whose own label or link already says "Room's window" (W2).
*/
const STATES = {
  on: { label: 'Room\'s window: on, full screen', short: 'On, full screen', tone: 'success', hint: 'Connected, visible and full screen' },
  windowed: { label: 'Room\'s window: open, not full screen', short: 'Open, not full screen', tone: 'warn', hint: FILL_ONCE },
  hidden: { label: 'Room\'s window: hidden', short: 'Hidden', tone: 'warn', hint: 'The room\'s window is hidden or minimised' },
  closed: { label: 'Room\'s window: not open', short: 'Not open', tone: 'muted', hint: 'Open it, then drag it onto the projector' },
};

export function presentStatusFrom(detail, nowMs = Date.now()) {
  const make = (state) => ({ state, ...STATES[state] });
  if (!detail || !detail.open) return make('closed');
  // The server's own age of the last report when it sends one (no clock
  // skew: a laptop a minute off would otherwise misjudge the window); an
  // older host door without `ageMs` falls back to statusAt vs this clock.
  if (typeof detail.ageMs === 'number' && Number.isFinite(detail.ageMs)) {
    if (detail.ageMs > STALE_MS) return make('closed');
  } else {
    const at = Date.parse(detail.statusAt || '');
    if (Number.isFinite(at) && nowMs - at > STALE_MS) return make('closed');
  }
  if (detail.visible === false) return make('hidden');
  if (detail.fullscreen === true) return make('on');
  return make('windowed');
}

/** True while a room's window is really up (any state but closed): the laptop then stays where it is. */
export function windowIsOpen(presenting, detail, nowMs = Date.now()) {
  return Number(presenting) > 0 && presentStatusFrom(detail, nowMs).state !== 'closed';
}
