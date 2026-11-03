/**
 * THE CHROME STEPS ASIDE ON ONE SCREEN (owner, 3 Nov 2026): "in 1 screen
 * mode, i like the idea of the clutter disappearing after a few seconds of no
 * mouse movement. if the host uses remote no need to bring that up, but if the
 * host moves the mouse they have access to all the buttons and extra info for
 * host support".
 *
 *   - one screen: hidden after CHROME_IDLE_MS with no pointer; a mouse move,
 *     the pointer entering the window, a touch, or Tab focus into the chrome
 *     brings it back;
 *   - a clicker's keys (→ ← Space PageDown) and the phone Remote's server
 *     actions (a re-render with a new phase) never bring it back;
 *   - two screens: never hides;
 *   - held while a sheet/dialog is open, the pointer is over the chrome, or a
 *     text field has focus;
 *   - reduced motion: no fade (stylesheet contract, read as text);
 *   - something urgent while hidden: a dot and the count, never a name.
 *
 * Attributes and DOM only: jsdom has no layout. The "no jump" half (the rows
 * keep their height) is pinned by reading stage.css below; the pixels were
 * measured in Chromium (Stage.jsx, stage.css carry the numbers).
 *
 * // rejects: a presenter clicker's → bringing the clutter back over the room.
 * // rejects: the chrome hiding under an open Session menu or a typed field.
 * // rejects: the two-screen console's private chrome fading.
 * // rejects: a display/visibility/height change that would refit the stage.
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, act, fireEvent, screen } from '@testing-library/react';
import Stage from '../components/stage/Stage';
import { CHROME_IDLE_MS, isTextField, chromeHoldReason } from '../hooks/useChromeAutoHide';

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');

function frame(props = {}, children = <div className="content"><p className="q">What slows our handoffs?</p></div>) {
  return (
    <Stage
      profile="room"
      phase="ASK"
      autoHide
      top={<div className="hc-top"><button type="button">Main menu</button></div>}
      now={<div className="dock dock--part"><button type="button" aria-expanded={props.expanded ? 'true' : 'false'}>Start voting</button></div>}
      needs={<div className="ny ny-line">Nothing needs you now.</div>}
      {...props}
    >
      {children}
    </Stage>
  );
}

const stage = (c) => c.querySelector('.stage');
const state = (c) => stage(c).getAttribute('data-chrome');
const idle = (ms = CHROME_IDLE_MS + 10) => act(() => { jest.advanceTimersByTime(ms); });
const move = (x = 10, y = 10) => act(() => { fireEvent.mouseMove(document, { screenX: x, screenY: y, clientX: x, clientY: y }); });

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { jest.runOnlyPendingTimers(); jest.useRealTimers(); document.body.innerHTML = ''; });

describe('one screen: hides after the idle delay, the mouse brings it back', () => {
  test('shown at first, still shown just before the delay, hidden after it', () => {
    const { container } = render(frame());
    expect(state(container)).toBe('shown');
    idle(CHROME_IDLE_MS - 100);
    expect(state(container)).toBe('shown');
    idle(200);
    expect(state(container)).toBe('hidden');
  });

  test('a mouse move shows it and restarts the idle time', () => {
    const { container } = render(frame());
    idle();
    expect(state(container)).toBe('hidden');
    move(40, 40);
    expect(state(container)).toBe('shown');
    idle(CHROME_IDLE_MS - 100);
    move(60, 40);
    idle(CHROME_IDLE_MS - 100);
    expect(state(container)).toBe('shown');
    idle(200);
    expect(state(container)).toBe('hidden');
  });

  test("a mousemove at the same spot (Chromium's synthetic one after a layout change) is not a move", () => {
    const { container } = render(frame());
    move(40, 40);
    idle();
    expect(state(container)).toBe('hidden');
    move(40, 40);
    expect(state(container)).toBe('hidden');
  });

  test('the pointer entering the window, a touch and a pointer press show it', () => {
    const { container } = render(frame());
    idle();
    act(() => { fireEvent.mouseEnter(document.documentElement); });
    expect(state(container)).toBe('shown');
    idle();
    act(() => { fireEvent.touchStart(document.body); });
    expect(state(container)).toBe('shown');
    idle();
    act(() => { fireEvent.pointerDown(document.body); });
    expect(state(container)).toBe('shown');
  });
});

describe('a clicker or the phone Remote never brings it back', () => {
  test.each(['ArrowRight', 'ArrowLeft', ' ', 'PageDown', 'PageUp', 'Enter', 'b', '.'])('the %p key leaves it hidden', (key) => {
    const { container } = render(frame());
    idle();
    act(() => { fireEvent.keyDown(window, { key }); fireEvent.keyDown(document.body, { key }); fireEvent.keyUp(document.body, { key }); });
    expect(state(container)).toBe('hidden');
  });

  test('a server action (the Remote moving the round on: a re-render, new phase and content) leaves it hidden', () => {
    const { container, rerender } = render(frame());
    idle();
    rerender(frame({ phase: 'VOTE', fitKey: 'VOTE|q4' }, <div className="content"><p className="q">Vote now</p></div>));
    expect(state(container)).toBe('hidden');
    idle();
    expect(state(container)).toBe('hidden');
  });
});

describe('Tab focus into the chrome shows it (accessibility)', () => {
  test('focus landing on a chrome control shows it, and it stays while the keyboard is there', () => {
    const { container } = render(frame());
    idle();
    expect(state(container)).toBe('hidden');
    act(() => { fireEvent.keyDown(document.body, { key: 'Tab' }); });
    expect(state(container)).toBe('hidden');
    act(() => { screen.getByRole('button', { name: 'Main menu' }).focus(); });
    expect(state(container)).toBe('shown');
    idle(CHROME_IDLE_MS * 3);
    expect(state(container)).toBe('shown');
  });

  test('focus outside the chrome does not show it', () => {
    const { container } = render(frame({}, <div className="content"><button type="button">Room card</button></div>));
    idle();
    act(() => { screen.getByRole('button', { name: 'Room card' }).focus(); });
    expect(state(container)).toBe('hidden');
  });

  test('a mouse click leaves focus on a button but does not hold the chrome up', () => {
    const { container } = render(frame());
    act(() => { fireEvent.pointerDown(document.body); screen.getByRole('button', { name: 'Start voting' }).focus(); });
    idle();
    expect(state(container)).toBe('hidden');
  });
});

describe('never on two screens', () => {
  test('no data-chrome and nothing hides, however long idle', () => {
    const { container } = render(frame({ autoHide: false }));
    idle(CHROME_IDLE_MS * 5);
    expect(stage(container).hasAttribute('data-chrome')).toBe(false);
  });

  test('a stage with no frame (Build Room, agenda wall) has nothing to hide', () => {
    const { container } = render(<Stage profile="room" phase="ASK" autoHide><div /></Stage>);
    idle();
    expect(stage(container).hasAttribute('data-chrome')).toBe(false);
  });

  test('going to two screens while hidden shows it at once', () => {
    const { container, rerender } = render(frame());
    idle();
    expect(state(container)).toBe('hidden');
    rerender(frame({ autoHide: false }));
    expect(stage(container).hasAttribute('data-chrome')).toBe(false);
  });
});

describe('held up while the host is in the middle of something', () => {
  test('a sheet the page has open (chromeHold) holds it, and the idle time starts afresh on close', () => {
    const { container, rerender } = render(frame({ chromeHold: true }));
    idle(CHROME_IDLE_MS * 3);
    expect(state(container)).toBe('shown');
    rerender(frame({ chromeHold: false }));
    idle(CHROME_IDLE_MS - 100);
    expect(state(container)).toBe('shown');
    idle(CHROME_IDLE_MS + 100);
    expect(state(container)).toBe('hidden');
  });

  test('opening a sheet while hidden shows it', () => {
    const { container, rerender } = render(frame());
    idle();
    rerender(frame({ chromeHold: true }));
    expect(state(container)).toBe('shown');
  });

  test('any dialog in the document holds it', () => {
    const { container } = render(<>{frame()}<div role="dialog" aria-modal="true">Session</div></>);
    idle(CHROME_IDLE_MS * 3);
    expect(state(container)).toBe('shown');
  });

  test('a disclosure left open in the chrome (the time chip) holds it', () => {
    const { container } = render(frame({ expanded: true }));
    idle(CHROME_IDLE_MS * 3);
    expect(state(container)).toBe('shown');
  });

  test('the pointer resting over the chrome holds it; leaving lets it go', () => {
    const { container } = render(frame());
    const btn = screen.getByRole('button', { name: 'Main menu' });
    act(() => { fireEvent.mouseOver(btn); });
    idle(CHROME_IDLE_MS * 3);
    expect(state(container)).toBe('shown');
    act(() => { fireEvent.mouseOut(btn, { relatedTarget: document.body }); });
    idle(CHROME_IDLE_MS + 100);
    expect(state(container)).toBe('hidden');
  });

  test('a text field with focus holds it (anywhere on the page)', () => {
    const { container } = render(<>{frame()}<input aria-label="Your question" /></>);
    act(() => { screen.getByLabelText('Your question').focus(); });
    idle(CHROME_IDLE_MS * 3);
    expect(state(container)).toBe('shown');
  });

  test('isTextField: text inputs, textareas, selects and contenteditable; never buttons', () => {
    const el = (html) => { const d = document.createElement('div'); d.innerHTML = html; return d.firstChild; };
    expect(isTextField(el('<input>'))).toBe(true);
    expect(isTextField(el('<input type="search">'))).toBe(true);
    expect(isTextField(el('<textarea></textarea>'))).toBe(true);
    expect(isTextField(el('<select></select>'))).toBe(true);
    expect(isTextField(el('<input type="checkbox">'))).toBe(false);
    expect(isTextField(el('<button></button>'))).toBe(false);
    expect(isTextField(null)).toBe(false);
  });

  test('chromeHoldReason names every reason', () => {
    expect(chromeHoldReason({ root: null, hold: true })).toBe('hold');
    expect(chromeHoldReason({ root: null, overChrome: true })).toBe('pointer');
    expect(chromeHoldReason({ root: null })).toBe('');
  });
});

describe('something urgent while hidden: a dot and the count, never a name', () => {
  test('no cue while shown; the cue while hidden with a Now item; gone when shown again', () => {
    const { container } = render(frame({ urgent: 2 }));
    expect(screen.queryByTestId('stage-chrome-cue')).toBeNull();
    idle();
    const cue = screen.getByTestId('stage-chrome-cue');
    expect(cue.textContent).toBe('2');
    expect(cue.getAttribute('aria-hidden')).toBe('true');
    expect(cue.closest('.stage')).toBe(stage(container));
    move(80, 80);
    expect(screen.queryByTestId('stage-chrome-cue')).toBeNull();
  });

  test('an urgent item arriving while hidden draws the cue and does NOT bring the chrome back', () => {
    const { container, rerender } = render(frame({ urgent: 0 }));
    idle();
    expect(screen.queryByTestId('stage-chrome-cue')).toBeNull();
    rerender(frame({ urgent: 1 }));
    expect(state(container)).toBe('hidden');
    expect(screen.getByTestId('stage-chrome-cue').textContent).toBe('1');
  });

  test('the cue is digits only: no letters can reach it', () => {
    render(frame({ urgent: 3 }));
    idle();
    expect(screen.getByTestId('stage-chrome-cue').textContent).toMatch(/^\d+$/);
  });

  test('never on two screens', () => {
    render(frame({ autoHide: false, urgent: 2 }));
    idle();
    expect(screen.queryByTestId('stage-chrome-cue')).toBeNull();
  });
});

describe('the stylesheet: opacity only (no jump), pointer off while hidden, reduced motion', () => {
  const css = stripComments(read('styles', 'stage.css'));
  const hiddenRule = css.match(/\.stage\[data-chrome="hidden"\] > \.stage-top,[^{]*\{([^}]*)\}/);

  test('the hidden rule covers all three rows and the in-content host controls', () => {
    const sel = css.slice(css.indexOf('.stage[data-chrome="hidden"] > .stage-top'), css.indexOf('{', css.indexOf('.stage[data-chrome="hidden"] > .stage-top')));
    ['> .stage-top', '> .stage-now', '> .stage-needs', '.fn-controls'].forEach((s) => expect(sel).toContain(s));
    expect(hiddenRule).not.toBeNull();
  });

  test('hiding changes opacity and pointer events, and nothing that moves the layout', () => {
    const body = hiddenRule[1];
    expect(body).toMatch(/opacity:\s*0/);
    expect(body).toMatch(/pointer-events:\s*none/);
    expect(body).not.toMatch(/display|visibility|height|margin|padding|position|transform|grid/);
    // No other rule keyed on data-chrome may touch the layout either.
    const keyed = [...css.matchAll(/([^{}]*data-chrome[^{}]*)\{([^}]*)\}/g)];
    expect(keyed.length).toBeGreaterThan(0);
    keyed.forEach(([, , b]) => expect(b).not.toMatch(/display|visibility|height|margin|padding|grid-template/));
  });

  test('reduced motion: no transition on the chrome and no pop on the cue', () => {
    const m = css.match(/@media \(prefers-reduced-motion: reduce\)\{([\s\S]*?\.stage-cue\{animation:none\})/g) || [];
    const block = m.find((x) => /data-chrome="hidden"/.test(x));
    expect(block).toBeTruthy();
    expect(block).toMatch(/\.stage-top,\.stage-now,\.stage-needs/);
    expect(block).toMatch(/transition:none/);
  });

  test('the cue is the laptop ladder, not below the 12px floor, and colours are tokens', () => {
    const cue = css.match(/\.stage-cue-n\{([^}]*)\}/)[1];
    expect(parseFloat(cue.match(/font-size:(\d+)px/)[1])).toBeGreaterThanOrEqual(12);
    const block = css.slice(css.indexOf('.stage-cue{'), css.indexOf('@keyframes stage-cue-in'));
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});

describe('the call site', () => {
  const src = read('GameHostPage.jsx');
  test('one screen only, held by the open sheets, urgent from the Now items', () => {
    const at = src.indexOf('<Stage\n');
    const head = src.slice(at, at + 2500);
    expect(head).toMatch(/autoHide=\{!twoSurfaces\}/);
    expect(head).toMatch(/chromeHold=\{[^}]*setupPanelOpen[^}]*needsSheetOpen/);
    expect(head).toMatch(/urgent=\{[^\n]*NEEDS_LEVELS\.NOW[^\n]*\.length\}/);
  });
  test('the console (two screens) never gets autoHide', () => {
    const at = src.indexOf('<HostConsole');
    const end = src.indexOf('</HostConsole>', at);
    expect(src.slice(at, end)).not.toMatch(/autoHide/);
  });
});
