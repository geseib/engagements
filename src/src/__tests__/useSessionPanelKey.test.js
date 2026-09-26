/**
 * useSessionPanelKey — the Session panel's OPEN half.
 *
 * Owner report, 26 Sep 2026: "the '\' does close the session menu on the host
 * screen but will not open it." SessionSetupPanel's own listener (mounted
 * only while it is open) has always answered the close half; this hook is
 * the other half, armed while the panel is NOT open.
 *
 * `sessionPanelKeyIntent` is the pure decision — mirrors
 * `config/scoreboard.js`'s `scoreboardKeyIntent` in shape, so it is testable
 * with plain synthetic events the way that suite tests typing targets and
 * modifiers, without needing a real DOM node for each case.
 */
import { renderHook, act } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import useSessionPanelKey, { sessionPanelKeyIntent } from '../components/stage/useSessionPanelKey';

const key = (k, extra = {}) => ({ key: k, target: document.body, ...extra });

describe('sessionPanelKeyIntent', () => {
  test('backslash opens', () => {
    expect(sessionPanelKeyIntent(key('\\'))).toBe('open');
  });

  test('every other key is not this one\'s', () => {
    for (const k of ['Escape', ' ', 'ArrowRight', 'a', 's', 'v']) {
      expect(sessionPanelKeyIntent(key(k))).toBeNull();
    }
  });

  test('never while typing — input, textarea, select', () => {
    const input = document.createElement('input');
    expect(sessionPanelKeyIntent(key('\\', { target: input }))).toBeNull();
    const area = document.createElement('textarea');
    expect(sessionPanelKeyIntent(key('\\', { target: area }))).toBeNull();
    const select = document.createElement('select');
    expect(sessionPanelKeyIntent(key('\\', { target: select }))).toBeNull();
  });

  test('never in a contenteditable', () => {
    // A plain duck-typed target, the same way stagePaging.test.js checks this
    // case — no dependency on jsdom's own contentEditable resolution.
    const target = { tagName: 'DIV', isContentEditable: true };
    expect(sessionPanelKeyIntent(key('\\', { target }))).toBeNull();
  });

  test('never with Meta held', () => {
    expect(sessionPanelKeyIntent(key('\\', { metaKey: true }))).toBeNull();
  });

  test('never with a bare Ctrl — that combination is the browser/OS\'s', () => {
    expect(sessionPanelKeyIntent(key('\\', { ctrlKey: true }))).toBeNull();
  });

  test('Ctrl+Alt DOES open — an AltGr keyboard reports it that way and still types \\', () => {
    expect(sessionPanelKeyIntent(key('\\', { ctrlKey: true, altKey: true }))).toBe('open');
  });

  test('Meta with Ctrl+Alt is still refused — Meta alone is the harder rule', () => {
    expect(sessionPanelKeyIntent(key('\\', { metaKey: true, ctrlKey: true, altKey: true }))).toBeNull();
  });

  test('Alt alone still opens — only Meta and a bare Ctrl are refused', () => {
    expect(sessionPanelKeyIntent(key('\\', { altKey: true }))).toBe('open');
  });
});

describe('useSessionPanelKey', () => {
  const press = (k, opts = {}) => act(() => {
    fireEvent.keyDown(opts.target || window, { key: k, ...opts });
  });

  test('\\ opens when enabled', () => {
    const onOpen = jest.fn();
    renderHook(() => useSessionPanelKey({ enabled: true, onOpen }));
    press('\\');
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  test('nothing happens when disabled', () => {
    const onOpen = jest.fn();
    renderHook(() => useSessionPanelKey({ enabled: false, onOpen }));
    press('\\');
    expect(onOpen).not.toHaveBeenCalled();
  });

  test('nothing while typing in a real input', () => {
    const onOpen = jest.fn();
    renderHook(() => useSessionPanelKey({ enabled: true, onOpen }));
    const input = document.createElement('input');
    document.body.appendChild(input);
    press('\\', { target: input });
    expect(onOpen).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });

  test('nothing with Meta or a bare Ctrl; Ctrl+Alt (AltGr) opens', () => {
    const onOpen = jest.fn();
    renderHook(() => useSessionPanelKey({ enabled: true, onOpen }));
    press('\\', { metaKey: true });
    press('\\', { ctrlKey: true });
    expect(onOpen).not.toHaveBeenCalled();
    press('\\', { ctrlKey: true, altKey: true });
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  test('going from enabled to disabled removes the listener', () => {
    const onOpen = jest.fn();
    const { rerender } = renderHook(
      ({ enabled }) => useSessionPanelKey({ enabled, onOpen }),
      { initialProps: { enabled: true } },
    );
    rerender({ enabled: false });
    press('\\');
    expect(onOpen).not.toHaveBeenCalled();
  });
});
