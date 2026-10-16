import fs from 'fs';
import path from 'path';
import { presentStatusPayload } from '../present/usePresentation';

test('the payload is two booleans', () => {
  expect(presentStatusPayload({ fullscreen: true, hidden: false })).toEqual({ fullscreen: true, visible: true });
  expect(presentStatusPayload({ fullscreen: false, hidden: true })).toEqual({ fullscreen: false, visible: false });
});

test('the page reports on connect, on full screen and visibility changes, and every minute', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'present', 'usePresentation.js'), 'utf8');
  expect(src).toMatch(/sendCleanMessage\('PRESENT_STATUS'/);
  expect(src).toMatch(/'fullscreenchange'/);
  expect(src).toMatch(/'visibilitychange'/);
  expect(src).toMatch(/setInterval\(report, 60 \* 1000\)/);
});
