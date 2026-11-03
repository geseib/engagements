import { useEffect, useRef, useState } from 'react';

/**
 * THE HOST'S CHROME STEPS ASIDE ON ONE SCREEN (owner, 3 Nov 2026): "in 1
 * screen mode, i like the idea of the clutter disappearing after a few seconds
 * of no mouse movement. if the host uses remote no need to bring that up, but
 * if the host moves the mouse they have access to all the buttons and extra
 * info for host support."
 *
 * On one screen the laptop IS the room's screen, so the frame's rows (the top
 * bar, Your part now, the Needs-you line) and any host-only control inside the
 * room's content (`.fn-controls`) are projected. This hook says when they may
 * fade: after CHROME_IDLE_MS with no pointer activity. Stage.jsx turns the
 * answer into `data-chrome="hidden"` and styles/stage.css does the fade.
 *
 * WHAT BRINGS IT BACK: the mouse moving (a real move, not Chromium's synthetic
 * mousemove at the same spot after a layout change), the pointer entering the
 * window, a touch or a pointer press, the wheel, and keyboard focus landing in
 * the chrome (Tab: an invisible focused button is not an accessible one).
 *
 * WHAT DOES NOT: keys. A presenter clicker or a remote sends → ← Space
 * PageDown, and the phone Remote sends server actions; the host using either
 * is not reaching for the laptop, so neither may put the clutter back. There
 * is no keydown listener that shows anything — Tab shows only through the
 * focus it moves into the chrome.
 *
 * WHAT HOLDS IT UP (checked when the idle time runs out, re-checked every
 * CHROME_IDLE_MS while it holds): the caller's `hold` (a sheet or menu the
 * page knows is open); any dialog or menu in the document; a disclosure in the
 * chrome left open (`aria-expanded="true"`: the time chip's choices, a
 * popover); the pointer resting over the chrome; a text field with focus,
 * anywhere; keyboard focus inside the chrome.
 *
 * Opacity only, never display or visibility: the rows keep their height so the
 * fitter never refits and the room never sees the stage jump (measured: a
 * collapse would refit up to 28% and move the question up to 178px each time),
 * and a hidden control stays reachable by Tab. Pointer events are off while
 * hidden (stage.css), so a tap that wakes the chrome cannot also press an
 * invisible button.
 */
export const CHROME_IDLE_MS = 3000;

/** The host chrome on the one-screen stage: the frame's three rows, and the
 *  host-only controls that live inside the room's content. */
export const CHROME_SELECTOR = '.stage-top, .stage-now, .stage-needs, .fn-controls';

/** Anything open that the host is in the middle of. */
const OPEN_SELECTOR = '[role="dialog"], [role="alertdialog"], [aria-modal="true"], dialog[open], [role="menu"], [role="listbox"]';

const NOT_TEXT = new Set(['button', 'checkbox', 'radio', 'range', 'color', 'file', 'image', 'reset', 'submit', 'hidden']);

/** A field the host is typing in: hiding under it would hide what they type. */
export function isTextField(el) {
  if (!el || el.nodeType !== 1) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  return !NOT_TEXT.has(String(el.getAttribute('type') || 'text').toLowerCase());
}

function inChrome(root, el) {
  if (!root || !el || el.nodeType !== 1 || !root.contains(el)) return false;
  return Boolean(el.closest(CHROME_SELECTOR));
}

/**
 * Why the chrome must stay up right now, or '' when it may hide. Exported for
 * the tests: every reason is one line here, so none can be lost quietly.
 */
export function chromeHoldReason({
  root, hold = false, overChrome = false, keyboard = false, doc = typeof document !== 'undefined' ? document : null,
}) {
  if (hold) return 'hold';
  if (!doc) return '';
  if (doc.querySelector(OPEN_SELECTOR)) return 'open';
  if (root && root.querySelector(
    '.stage-top [aria-expanded="true"], .stage-now [aria-expanded="true"], .stage-needs [aria-expanded="true"]',
  )) return 'expanded';
  if (overChrome) return 'pointer';
  const active = doc.activeElement;
  if (isTextField(active)) return 'field';
  if (keyboard && inChrome(root, active)) return 'focus';
  return '';
}

/**
 * @param {object} o
 * @param {boolean} o.enabled  one screen, with chrome to hide. Off → always shown.
 * @param {boolean} [o.hold]   the caller knows a sheet/menu is open.
 * @param {{current: Element|null}} o.rootRef  the stage element.
 * @param {number} [o.delay]
 * @returns {boolean} hidden
 */
export default function useChromeAutoHide({
  enabled, hold = false, rootRef, delay = CHROME_IDLE_MS,
}) {
  const [hidden, setHidden] = useState(false);
  const holdRef = useRef(hold);
  holdRef.current = hold;
  const api = useRef(null);

  useEffect(() => {
    if (!enabled) {
      setHidden(false);
      api.current = null;
      return undefined;
    }
    let timer = null;
    let overChrome = false;
    let keyboard = false;
    let last = null;
    const root = () => (rootRef && rootRef.current) || null;

    const tryHide = () => {
      timer = null;
      if (chromeHoldReason({
        root: root(), hold: holdRef.current, overChrome, keyboard,
      })) {
        // Held: look again after another idle stretch.
        timer = setTimeout(tryHide, delay);
        return;
      }
      setHidden(true);
    };
    const arm = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(tryHide, delay);
    };
    const show = () => {
      setHidden(false);
      arm();
    };

    const onMove = (e) => {
      const x = e.screenX || e.clientX || 0;
      const y = e.screenY || e.clientY || 0;
      // Chromium re-sends mousemove at the same place after a layout change
      // under a still pointer (a phase change, a new card): not a host moving.
      if (last && last.x === x && last.y === y) return;
      last = { x, y };
      keyboard = false;
      show();
    };
    const onPointer = () => { keyboard = false; show(); };
    const onKey = (e) => {
      // Tab marks keyboard navigation; the focus it moves shows the chrome.
      // No other key does anything here (the clicker rule above).
      if (e.key === 'Tab') keyboard = true;
    };
    const onFocus = (e) => {
      if (inChrome(root(), e.target)) show();
    };
    const onOver = (e) => { overChrome = inChrome(root(), e.target); };
    const onOut = (e) => {
      // Leaving the window (relatedTarget null) or to somewhere not chrome.
      if (!inChrome(root(), e.relatedTarget)) overChrome = false;
    };

    const html = document.documentElement;
    document.addEventListener('mousemove', onMove, true);
    html.addEventListener('mouseenter', onPointer);
    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('touchstart', onPointer, { capture: true, passive: true });
    document.addEventListener('wheel', onPointer, { capture: true, passive: true });
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('focusin', onFocus, true);
    document.addEventListener('mouseover', onOver, true);
    document.addEventListener('mouseout', onOut, true);
    api.current = { show, arm };
    arm();

    return () => {
      if (timer) clearTimeout(timer);
      api.current = null;
      document.removeEventListener('mousemove', onMove, true);
      html.removeEventListener('mouseenter', onPointer);
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('touchstart', onPointer, { capture: true });
      document.removeEventListener('wheel', onPointer, { capture: true });
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('focusin', onFocus, true);
      document.removeEventListener('mouseover', onOver, true);
      document.removeEventListener('mouseout', onOut, true);
    };
  }, [enabled, delay, rootRef]);

  // A sheet or menu the page opened (the Session menu, the Needs-you sheet) is
  // anchored to the chrome: show it while it is open, and start the idle time
  // afresh when it closes.
  useEffect(() => {
    if (!api.current) return;
    if (hold) api.current.show();
    else api.current.arm();
  }, [hold]);

  return enabled ? hidden : false;
}
