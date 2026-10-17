import fs from 'fs';
import path from 'path';
import { presentStatusPayload } from '../present/usePresentation';

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

test('the payload is two booleans', () => {
  expect(presentStatusPayload({ fullscreen: true, hidden: false })).toEqual({ fullscreen: true, visible: true });
  expect(presentStatusPayload({ fullscreen: false, hidden: true })).toEqual({ fullscreen: false, visible: false });
});

test('the reporter reports on connect, on full screen and visibility changes, and every minute', () => {
  const src = read('present', 'presentStatusReporter.js');
  expect(src).toMatch(/sendCleanMessage\('PRESENT_STATUS'/);
  expect(src).toMatch(/'fullscreenchange'/);
  expect(src).toMatch(/'visibilitychange'/);
  expect(src).toMatch(/HEARTBEAT_MS = 60 \* 1000/);
  expect(src).toMatch(/setInterval\(report, HEARTBEAT_MS\)/);
});

// One copy of the rules (parity PLAN §2.4): every room's window shares it, none copies it.
test.each([
  ['present/usePresentation.js'],
  ['present/buildwall/useBuildWall.js'],
])('%s reports through the shared reporter, with no copy of its own', (file) => {
  const src = read(...file.split('/'));
  expect(src).toMatch(/startPresentStatus\(webSocketClient\)/);
  expect(src).not.toMatch(/sendCleanMessage\('PRESENT_STATUS'/);
  expect(src).not.toMatch(/'fullscreenchange'/);
});
