/**
 * Fix round 2: prefersReducedMotion() used to be read once at mount, so a
 * reader who flipped the OS setting mid-visit kept the mode the page loaded
 * in. useScrollProgress now holds `reduced` in state and subscribes to the
 * media query's own `change` event. These pin that behaviour with a fake
 * matchMedia — jsdom (this project's default test environment) has none.
 */
import { act, renderHook } from '@testing-library/react';
import useScrollProgress from '../marketing/useScrollProgress';

function fakeMatchMedia(initialMatches) {
  let changeHandler = null;
  const mql = {
    matches: initialMatches,
    addEventListener: (event, handler) => {
      if (event === 'change') changeHandler = handler;
    },
    removeEventListener: (event, handler) => {
      if (event === 'change' && changeHandler === handler) changeHandler = null;
    },
  };
  return {
    matchMedia: () => mql,
    fire: (matches) => {
      mql.matches = matches;
      if (changeHandler) act(() => changeHandler({ matches }));
    },
  };
}

describe('useScrollProgress reacts to a live prefers-reduced-motion change', () => {
  let originalMatchMedia;

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
  });

  afterEach(() => {
    if (originalMatchMedia === undefined) delete window.matchMedia;
    else window.matchMedia = originalMatchMedia;
    jest.restoreAllMocks();
  });

  test('starts reduced: progress is pinned to 1 and no scroll listener is added', () => {
    const fake = fakeMatchMedia(true);
    window.matchMedia = fake.matchMedia;
    const addSpy = jest.spyOn(window, 'addEventListener');

    const { result } = renderHook(() => useScrollProgress());

    expect(result.current).toBe(1);
    expect(addSpy).not.toHaveBeenCalledWith('scroll', expect.any(Function), expect.anything());
  });

  test('flipping to not-reduced attaches a scroll listener', () => {
    const fake = fakeMatchMedia(true);
    window.matchMedia = fake.matchMedia;
    const addSpy = jest.spyOn(window, 'addEventListener');

    renderHook(() => useScrollProgress());
    fake.fire(false);

    expect(addSpy).toHaveBeenCalledWith('scroll', expect.any(Function), expect.anything());
  });
});
