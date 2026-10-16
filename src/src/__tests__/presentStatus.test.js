import { presentStatusFrom, STALE_MS } from '../config/presentStatus';

const NOW = Date.parse('2026-10-15T12:00:00Z');
const at = (msAgo) => new Date(NOW - msAgo).toISOString();

test('connected, visible and full screen: on', () => {
  expect(presentStatusFrom({ open: true, fullscreen: true, visible: true, statusAt: at(5000) }, NOW))
    .toMatchObject({ state: 'on', label: 'Room\'s window: on, full screen', tone: 'success' });
});
test('connected, visible, not full screen: windowed, with the F hint', () => {
  expect(presentStatusFrom({ open: true, fullscreen: false, visible: true, statusAt: at(5000) }, NOW))
    .toMatchObject({ state: 'windowed', label: 'Room\'s window: open, not full screen', tone: 'warn', hint: 'Press F on that window' });
});
test('connected but hidden or minimised: hidden', () => {
  expect(presentStatusFrom({ open: true, fullscreen: true, visible: false, statusAt: at(5000) }, NOW))
    .toMatchObject({ state: 'hidden', tone: 'warn' });
});
test('no viewer, or one that stopped reporting 90 seconds ago, is not open (Review Focus 2)', () => {
  expect(presentStatusFrom(null, NOW).state).toBe('closed');
  expect(presentStatusFrom({ open: false }, NOW).state).toBe('closed');
  expect(presentStatusFrom({ open: true, fullscreen: true, visible: true, statusAt: at(STALE_MS + 1000) }, NOW).state).toBe('closed');
  expect(presentStatusFrom(null, NOW)).toMatchObject({ label: 'Room\'s window: not open', tone: 'muted' });
});
test('an older Present page that never reports its state still counts as open, windowed', () => {
  expect(presentStatusFrom({ open: true, fullscreen: null, visible: null, statusAt: null }, NOW).state).toBe('windowed');
});

/* CLOCK SKEW (final review, 15 Oct): the server's ageMs decides, not this clock. */
test('ageMs from the server decides staleness, whatever this laptop\'s clock says', () => {
  // statusAt looks ten minutes old by a laptop clock that runs fast; the server says 5 s.
  expect(presentStatusFrom({ open: true, fullscreen: true, visible: true, statusAt: at(10 * 60 * 1000), ageMs: 5000 }, NOW).state).toBe('on');
  // statusAt looks fresh by a laptop clock that runs slow; the server says it is stale.
  expect(presentStatusFrom({ open: true, fullscreen: true, visible: true, statusAt: at(0), ageMs: STALE_MS + 1 }, NOW).state).toBe('closed');
});
test('the boundary: exactly STALE_MS old is still open; one millisecond more is not', () => {
  expect(presentStatusFrom({ open: true, fullscreen: true, visible: true, statusAt: at(0), ageMs: STALE_MS }, NOW).state).toBe('on');
  expect(presentStatusFrom({ open: true, fullscreen: true, visible: true, statusAt: at(0), ageMs: STALE_MS + 1 }, NOW).state).toBe('closed');
  // The fallback (no ageMs) holds the same boundary against statusAt.
  expect(presentStatusFrom({ open: true, fullscreen: true, visible: true, statusAt: at(STALE_MS) }, NOW).state).toBe('on');
  expect(presentStatusFrom({ open: true, fullscreen: true, visible: true, statusAt: at(STALE_MS + 1) }, NOW).state).toBe('closed');
});
test('ageMs null (no StatusAt reported) falls back to statusAt vs this clock', () => {
  expect(presentStatusFrom({ open: true, fullscreen: null, visible: null, statusAt: null, ageMs: null }, NOW).state).toBe('windowed');
});
