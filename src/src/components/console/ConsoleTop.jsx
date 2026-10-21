import React from 'react';
import CW from '../../config/consoleWords';
import RoomWindowStatus from '../stage/RoomWindowStatus';
import HostNotificationsBell from '../HostNotificationsBell';

/**
 * THE CONSOLE'S TOP LINE (host console spec §3.1): the session's name, the
 * join code (pressing it shows the code on the wall), the room's window and
 * whether that window is really up. Only what the app can know: connected,
 * full screen, visible. Never "the projector is on".
 */
export default function ConsoleTop({ title, code, onJoin, presentHref, presentDetail, onOpenPresent, onLeave = null, children = null, short = false, codeProps = null }) {
  const open = typeof onOpenPresent === 'function' ? onOpenPresent : undefined;
  return (
    <header className="hc-top">
      {/* The way out, saying where it goes (owner, 18 Oct 2026). The session
          keeps running; Continue brings the host back. */}
      {onLeave ? (
        <button type="button" className="hc-leave" onClick={onLeave} title={CW.allSessionsHint}>
          <span aria-hidden="true">←</span> {CW.allSessions}
        </button>
      ) : null}
      <span className="hc-brand">Engagements</span>
      <span className="hc-name">{title}</span>
      <span className="hc-spacer" />
      {code ? (
        <button type="button" className="hc-code" onClick={onJoin} aria-label={`${CW.join} ${code}. Show the join code on the wall`} {...(codeProps || {})}>
          {CW.join} <b>{code}</b>
        </button>
      ) : null}
      {/* The room's window and whether it is really up; on a laptop with no
          second display, Open as a tab and the line that says what to do
          (owner, 19 Oct 2026). The same part the Build Room's header draws. */}
      <RoomWindowStatus
        href={presentHref}
        detail={presentDetail}
        onOpen={open}
        short={short}
        linkLabel={`${CW.roomsWindow} ↗`}
        classes={{ link: 'hc-btn', stat: 'hc-winstat', dot: 'hc-dot' }}
      />
      {/* A type's own top-line parts (the Build Room's Share demo, The room
          sees and the connection), after the window, in its order. */}
      {children}
      {/* THE BELL (owner, 21 Oct 2026), last on the line. The laptop's private
          screen; a click opens the console in a new tab so the session stays put. */}
      <HostNotificationsBell newTab />
    </header>
  );
}
