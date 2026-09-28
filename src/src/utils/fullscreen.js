/**
 * THE BROWSER'S FULL SCREEN, FOR THE HOST (28 Sep 2026). The owner: "hitting
 * 'f' takes the browser to full screen mode for the host", and "we need to be
 * able to present the slides in presos full screen as well".
 *
 * One small module over the Fullscreen API so no screen repeats the prefixes:
 * Safari before 16.4 has only the `webkit` names, and a browser that has
 * neither (an iPhone, an iframe without `allow="fullscreen"`) is told apart by
 * `canFullscreen()`, so a screen can leave out a button that would do nothing.
 *
 * WHETHER THE SCREEN IS FULL IS NOT KEPT HERE. The browser holds it and the
 * browser ends it — Esc always leaves, and Chrome never even delivers that Esc
 * to the page — so every reader asks `fullscreenElement()` or listens for the
 * change (hooks/useFullscreenKey.js `useFullscreenElement`) rather than keeping
 * a flag that an Esc would leave behind.
 */
import { isTypingTarget } from '../components/HostActionBar';

const doc = () => (typeof document === 'undefined' ? null : document);

/** The element that is full screen now, or null. */
export function fullscreenElement() {
  const d = doc();
  if (!d) return null;
  return d.fullscreenElement || d.webkitFullscreenElement || null;
}

/** False where full screen cannot be had at all — the button is left out there. */
export function canFullscreen() {
  const d = doc();
  if (!d) return false;
  const root = d.documentElement || {};
  if (d.fullscreenEnabled === false && !d.webkitFullscreenEnabled) return false;
  return typeof root.requestFullscreen === 'function' || typeof root.webkitRequestFullscreen === 'function';
}

/**
 * Make `el` full screen. Resolves true when the browser agreed; false (never a
 * throw) when it refused — no user gesture, a policy, an element that has gone.
 */
export function enterFullscreen(el) {
  if (!el) return Promise.resolve(false);
  const ask = el.requestFullscreen || el.webkitRequestFullscreen;
  if (typeof ask !== 'function') return Promise.resolve(false);
  try {
    return Promise.resolve(ask.call(el)).then(() => true, () => false);
  } catch {
    return Promise.resolve(false);
  }
}

/**
 * Leave full screen by ONE step. With the page full screen and then a slide
 * inside it, this steps back to the page; with only the page, it leaves.
 */
export function exitFullscreen() {
  const d = doc();
  if (!d || !fullscreenElement()) return Promise.resolve(false);
  const leave = d.exitFullscreen || d.webkitExitFullscreen;
  if (typeof leave !== 'function') return Promise.resolve(false);
  try {
    return Promise.resolve(leave.call(d)).then(() => true, () => false);
  } catch {
    return Promise.resolve(false);
  }
}

/**
 * F's one meaning: `el` full screen, or out of it if it already is. Any OTHER
 * element being full screen (the page, while F asks for a slide) is a switch,
 * not a leave — the slide takes the screen, and F again steps back to the page.
 * `el` defaults to the whole page.
 */
export function toggleFullscreen(el) {
  const d = doc();
  const target = el || (d && d.documentElement);
  if (!target) return Promise.resolve(false);
  if (fullscreenElement() === target) return exitFullscreen();
  return enterFullscreen(target);
}

/**
 * Is this keystroke F, meant for full screen? Refused the same ways the
 * stage's other letter keys are (RoomMeter's U, the scoreboard's S): a
 * modifier is someone else's gesture (Ctrl/Cmd+F is the browser's find), a
 * typing target owns its own letters, the session panel's fields must not
 * change the screen behind them, a held key does not flicker the screen at the
 * OS repeat rate, and a press another handler already took is not F's.
 */
export function isFullscreenKey(event) {
  if (!event || (event.key !== 'f' && event.key !== 'F')) return false;
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  if (event.repeat || event.defaultPrevented) return false;
  const target = event.target;
  if (isTypingTarget(target)) return false;
  if (target && typeof target.closest === 'function' && target.closest('.setup-panel')) return false;
  return true;
}
