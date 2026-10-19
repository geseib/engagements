import React from 'react';
import { presentStatusFrom } from '../../config/presentStatus';
import { SCREEN_WORDS } from '../../config/roomScreen';
import { willPlace } from '../../present/roomWindow';
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
 */
export default function RoomWindowStatus({
  href, detail = null, classes = {}, short = false, onOpen, linkLabel = `${SCREEN_WORDS.window} ↗`, ...rest
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
