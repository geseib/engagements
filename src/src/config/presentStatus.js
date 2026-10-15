/**
 * IS THE ROOM'S WINDOW REALLY UP? (spec §3.1; owner, 15 Oct: "does it really
 * know that it is up?"). What the app can know: a Present window is connected
 * to this session, whether it is full screen, and whether its tab is visible.
 * It cannot know the projector is on, so it never claims to.
 *
 * A viewer that has not reported for STALE_MS is treated as gone: its row can
 * outlive a closed tab by up to two hours (connect.js ttl).
 */
export const STALE_MS = 90 * 1000;

const STATES = {
  on: { label: 'Room\'s window: on, full screen', tone: 'success', hint: 'Connected, visible and full screen' },
  windowed: { label: 'Room\'s window: open, not full screen', tone: 'warn', hint: 'Press F on that window' },
  hidden: { label: 'Room\'s window: hidden', tone: 'warn', hint: 'The room\'s window is hidden or minimised' },
  closed: { label: 'Room\'s window: not open', tone: 'muted', hint: 'Open it, then drag it onto the projector' },
};

export function presentStatusFrom(detail, nowMs = Date.now()) {
  const make = (state) => ({ state, ...STATES[state] });
  if (!detail || !detail.open) return make('closed');
  const at = Date.parse(detail.statusAt || '');
  if (Number.isFinite(at) && nowMs - at > STALE_MS) return make('closed');
  if (detail.visible === false) return make('hidden');
  if (detail.fullscreen === true) return make('on');
  return make('windowed');
}
