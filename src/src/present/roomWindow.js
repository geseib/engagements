/**
 * OPENING THE ROOM'S WINDOW ON THE OTHER DISPLAY (two-surface PLAN 3.9; the
 * owner's second-screen idea, 16 Oct 2026).
 *
 * Where Chrome offers the Window Management API and this computer has a second
 * display, the room's window opens as a popup and is moved to fill that
 * display, instead of "drag it onto the projector". Everywhere else the plain
 * link stays exactly as it was. Progressive: nothing here is required.
 *
 * THE ORDER MATTERS. A popup may only open inside the click that asked for it
 * (transient activation), and the permission prompt for the screen list can
 * outlast that. So the window opens FIRST, synchronously, and is moved after
 * `getScreenDetails()` answers. Refused or unavailable, the window simply stays
 * where it opened and the host drags it, as before.
 *
 * FULL SCREEN cannot be taken from here: a page may only go full screen from a
 * click inside itself. The window opens with `placed=1`, and on it the first
 * click goes full screen (PresentPage.jsx). The laptop's status says whether it
 * is (config/presentStatus.js).
 */

/** One name, so a second press brings the same window back rather than a third. */
export const ROOM_WINDOW_NAME = 'engage-room';

const dims = (s) => ({
  left: Number(s.availLeft ?? s.left ?? 0),
  top: Number(s.availTop ?? s.top ?? 0),
  width: Number(s.availWidth ?? s.width ?? 0),
  height: Number(s.availHeight ?? s.height ?? 0),
});

/** True when this computer has more than one display (no permission needed). */
export function hasOtherScreen(win = typeof window !== 'undefined' ? window : undefined) {
  return Boolean(win && win.screen && win.screen.isExtended === true);
}

/** True when the browser can tell us where the displays are (Chrome, Edge). */
export function canPlace(win = typeof window !== 'undefined' ? window : undefined) {
  return Boolean(win && typeof win.getScreenDetails === 'function');
}

/** Both: the button will place the window rather than just open it. */
export function willPlace(win) {
  return canPlace(win) && hasOtherScreen(win);
}

/**
 * The display the room should watch: not the one this page is on; of the
 * rest, an external one before a built-in one; then the largest. Null when
 * there is no other display.
 */
export function pickRoomScreen(details) {
  if (!details || !Array.isArray(details.screens)) return null;
  const here = details.currentScreen ? dims(details.currentScreen) : null;
  const same = (s) => here && s.left === here.left && s.top === here.top
    && s.width === here.width && s.height === here.height;
  const others = details.screens
    .filter((s) => s && s !== details.currentScreen)
    .map((s) => ({ s, d: dims(s) }))
    .filter(({ d }) => d.width > 0 && d.height > 0 && !same(d));
  if (!others.length) return null;
  others.sort((a, b) => {
    const ia = a.s.isInternal ? 1 : 0;
    const ib = b.s.isInternal ? 1 : 0;
    if (ia !== ib) return ia - ib;
    return (b.d.width * b.d.height) - (a.d.width * a.d.height);
  });
  return others[0].d;
}

/** The room's window address with `placed=1`, so its first click goes full screen. */
export function placedHref(href) {
  const s = String(href || '');
  if (!s || /[?&]placed=1(&|$)/.test(s)) return s;
  return `${s}${s.includes('?') ? '&' : '?'}placed=1`;
}

/**
 * Open the room's window and, once the screen list answers, move it onto the
 * other display, filled. Returns the window (or null when the popup was
 * blocked) and a promise that settles true when it was placed.
 */
export function openRoomWindow(href, win = window) {
  const w = win.open(placedHref(href), ROOM_WINDOW_NAME, 'popup,width=960,height=540');
  if (!w) return { window: null, placed: Promise.resolve(false) };
  // The room's page has no use for this one; keep our handle, drop its link back.
  try { w.opener = null; } catch (e) { /* some browsers make it read-only */ }
  const placed = Promise.resolve()
    .then(() => win.getScreenDetails())
    .then((details) => {
      const d = pickRoomScreen(details);
      if (!d) return false;
      w.moveTo(d.left, d.top);
      w.resizeTo(d.width, d.height);
      if (typeof w.focus === 'function') w.focus();
      return true;
    })
    .catch(() => false);
  return { window: w, placed };
}

/**
 * The click handler every "Room's window" link shares. Leaves the plain link
 * alone when placing is not possible, and for a modified or middle click,
 * which the person meant for the browser.
 */
export function onRoomWindowClick(event, href, win = typeof window !== 'undefined' ? window : undefined) {
  if (!event || event.defaultPrevented || !href) return false;
  if (event.button > 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  if (!willPlace(win)) return false;
  const opened = openRoomWindow(href, win);
  if (!opened.window) return false; // blocked: let the link open it the old way
  event.preventDefault();
  return true;
}
