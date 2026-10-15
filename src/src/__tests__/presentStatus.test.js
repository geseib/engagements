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
