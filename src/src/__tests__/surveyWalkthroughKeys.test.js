/**
 * surveyWalkthroughKeyIntent — Task 8 of the 2026-09-26 feature sweep, "walk
 * the room through survey results, one question at a time, full size."
 *
 * Pure arithmetic, mirroring config/scoreboard.js's scoreboardKeyIntent: a
 * typing target and a modifier key veto everything, Space/→ mean 'next' and
 * ← means 'previous' (both guarded against key-repeat, the same way
 * HostActionBar's own advance key is), and Escape always means 'close'.
 */
import { surveyWalkthroughKeyIntent } from '../config/surveyWalkthrough';

const key = (k, extra = {}) => ({ key: k, ...extra });

describe('surveyWalkthroughKeyIntent', () => {
  test('Space and ArrowRight mean next', () => {
    expect(surveyWalkthroughKeyIntent(key(' '))).toBe('next');
    expect(surveyWalkthroughKeyIntent(key('Spacebar'))).toBe('next');
    expect(surveyWalkthroughKeyIntent(key('ArrowRight'))).toBe('next');
  });

  test('ArrowLeft means previous', () => {
    expect(surveyWalkthroughKeyIntent(key('ArrowLeft'))).toBe('previous');
  });

  test('Escape means close', () => {
    expect(surveyWalkthroughKeyIntent(key('Escape'))).toBe('close');
  });

  test('every other key is null', () => {
    expect(surveyWalkthroughKeyIntent(key('a'))).toBeNull();
    expect(surveyWalkthroughKeyIntent(key('Tab'))).toBeNull();
    expect(surveyWalkthroughKeyIntent(null)).toBeNull();
  });

  test('a held key-repeat does not re-fire next/previous', () => {
    expect(surveyWalkthroughKeyIntent(key(' ', { repeat: true }))).toBeNull();
    expect(surveyWalkthroughKeyIntent(key('ArrowRight', { repeat: true }))).toBeNull();
    expect(surveyWalkthroughKeyIntent(key('ArrowLeft', { repeat: true }))).toBeNull();
  });

  test('a held Escape still closes — repeated close is harmless', () => {
    expect(surveyWalkthroughKeyIntent(key('Escape', { repeat: true }))).toBe('close');
  });

  test('a modifier key vetoes everything (browser/OS shortcuts pass through)', () => {
    expect(surveyWalkthroughKeyIntent(key('ArrowRight', { ctrlKey: true }))).toBeNull();
    expect(surveyWalkthroughKeyIntent(key(' ', { metaKey: true }))).toBeNull();
    expect(surveyWalkthroughKeyIntent(key('Escape', { altKey: true }))).toBeNull();
  });

  test('nothing fires while typing in a field', () => {
    const input = { tagName: 'INPUT' };
    expect(surveyWalkthroughKeyIntent(key('ArrowRight', { target: input }))).toBeNull();
    const editable = { isContentEditable: true };
    expect(surveyWalkthroughKeyIntent(key('Escape', { target: editable }))).toBeNull();
  });
});
