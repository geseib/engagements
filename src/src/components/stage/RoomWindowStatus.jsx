import React from 'react';
import { presentStatusFrom } from '../../config/presentStatus';
import { SCREEN_WORDS } from '../../config/roomScreen';
import { willPlace, ROOM_WINDOW_NAME } from '../../present/roomWindow';
import RoomWindowLink, { RoomWindowTab } from './RoomWindowLink';
import './RoomWindowStatus.css';

/**
 * THE ROOM'S WINDOW ON A TOP LINE: "Room's window ↗", whether that window is
 * really up, and, on a laptop with no second display, "Open as a tab" and the
 * one line that says what to do (owner, 19 Oct 2026). Call & Answer's console
 * top line (console/ConsoleTop.jsx) and the Build Room's header draw this one
 * part, so the two read the same.
 *
 *   href      the room's window (config/surfaces.js presentHref)
 *   detail    the host door's presentDetail, or null when no window is
 *             connected (config/presentStatus.js: never "the projector is on")
 *   classes   { link, stat, dot }: the host surface's own button and pill
 *   short     the state alone ("Not open"), since the link beside it already
 *             names the window; a hidden prefix keeps it whole for a reader
 *   onOpen    called after either link is pressed (C&A's console marks it)
 *
 * The note line keeps its height when it has nothing to say, so a status
 * change never moves what sits below it.
 *
 * `one` (owner, 5 Nov 2026, cut 7: "say each thing once"): the link and the
 * pill become ONE control, the status in it ("● Room's window: on, full
 * screen ↗"). A press brings the room's window forward when it is up, and
 * opens it when it is not. The window is opened under one name
 * (present/roomWindow.js ROOM_WINDOW_NAME), so the next press finds it.
 */

/**
 * Bring the room's window forward rather than open a second one. `window.open`
 * with an empty URL and the window's name returns the window already open
 * under that name without reloading it (a reload would drop its full screen);
 * one that comes back blank was not there, so it is sent to the room's page.
 * Returns true when it handled the press.
 */
export function focusRoomWindow(href, win = typeof window !== 'undefined' ? window : undefined) {
  if (!win || typeof win.open !== 'function' || !href) return false;
  let w = null;
  try { w = win.open('', ROOM_WINDOW_NAME); } catch (e) { return false; }
  if (!w) return false;
  let blank = false;
  try { blank = !w.location || w.location.href === 'about:blank'; } catch (e) { blank = false; }
  if (blank) {
    try { w.location.href = href; } catch (e) { return false; }
  }
  try { w.focus(); } catch (e) { /* the browser decides */ }
  return true;
}
export default function RoomWindowStatus({
  href, detail = null, classes = {}, short = false, onOpen, linkLabel = `${SCREEN_WORDS.window} ↗`, one = false, ...rest
}) {
  if (!href) return null;
  const status = presentStatusFrom(detail);
  const placing = willPlace();
  const open = typeof onOpen === 'function' ? onOpen : undefined;
  const closed = status.state === 'closed';
  const note = status.state === 'windowed' ? SCREEN_WORDS.fillOnce
    : closed && !placing ? SCREEN_WORDS.noSecondDisplay : '';
  const words = short ? (
    <><span className="rws-sr">{`${SCREEN_WORDS.window}: `}</span>{status.short}</>
  ) : status.label;
  const statClass = `${classes.stat || 'rws-stat'} is-${status.tone}`;
  const dot = <span className={classes.dot || 'rws-dot'} aria-hidden="true" />;
  if (one) {
    const words = <>{dot}{status.label}<span aria-hidden="true">{' ↗'}</span></>;
    // Up: a press brings it forward (never a second window, never a reload).
    const bring = (e) => {
      if (!(e.button > 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) && focusRoomWindow(href)) e.preventDefault();
      if (open) open(e);
    };
    return (
      <span className="rws" data-window={status.state} {...rest}>
        <span className="rws-line">
          {closed ? (
            <RoomWindowLink className={`${statClass} rws-one`} href={href} target={ROOM_WINDOW_NAME} title={status.hint} onClick={open} data-capability="room-window">
              {words}
            </RoomWindowLink>
          ) : (
            <a
              className={`${statClass} rws-one`}
              href={href}
              target={ROOM_WINDOW_NAME}
              rel="noopener noreferrer"
              title={`${status.hint}. ${SCREEN_WORDS.bringForward}`}
              onClick={bring}
              data-capability="room-window"
            >
              {words}
            </a>
          )}
          {closed && !placing ? <RoomWindowTab className="rws-tab" href={href} onClick={open} /> : null}
        </span>
        <span className="rws-note" aria-live="polite">{note}</span>
      </span>
    );
  }
  return (
    <span className="rws" data-window={status.state} {...rest}>
      <span className="rws-line">
        <RoomWindowLink className={classes.link || 'rws-link'} href={href} onClick={open} data-capability="room-window">
          {linkLabel}
        </RoomWindowLink>
        {closed ? (
          <RoomWindowLink className={statClass} href={href} title={status.hint} onClick={open}>
            {dot}{words}
          </RoomWindowLink>
        ) : (
          <span className={statClass} title={status.hint} role="status">{dot}{words}</span>
        )}
        {closed && !placing ? <RoomWindowTab className="rws-tab" href={href} onClick={open} /> : null}
      </span>
      <span className="rws-note" aria-live="polite">{note}</span>
    </span>
  );
}
