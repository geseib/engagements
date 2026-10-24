import React from 'react';
import CW from '../../config/consoleWords';
import RoomWindowStatus from '../stage/RoomWindowStatus';
import HostNotificationsBell from '../HostNotificationsBell';
import HelpButton from '../HelpButton';
import { helpFor } from '../../config/help/screens';

/**
 * THE CONSOLE'S TOP LINE (host console spec §3.1): the session's name, the
 * join code (pressing it shows the code on the wall), the room's window and
 * whether that window is really up. Only what the app can know: connected,
 * full screen, visible. Never "the projector is on".
 */
export default function ConsoleTop({ title, code, onJoin, joinHint = '', joinPressed, presentHref, presentDetail, onOpenPresent, onLeave = null, children = null, short = false, codeProps = null, help = '' }) {
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
      {/* A type whose Join toggles (the Build Room) passes `joinHint`, what a
          press does now, and `joinPressed`; Call & Answer's stays as it was. */}
      {code ? (
        <button type="button" className="hc-code" onClick={onJoin} title={joinHint || undefined} aria-label={`${CW.join} ${code}. ${joinHint || 'Show the join code on the wall'}`} aria-pressed={joinPressed} {...(codeProps || {})}>
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
      {/* THE `?` (Help Phase 3): `help` is the screen id of the type's console
          (config/help/screens.js), and the same button is where a bug is
          reported from, as on the Session panel's header. Before the bell,
          which stays last. */}
      {help ? (
        <HelpButton
          {...helpFor(help)}
          variant="inline"
          size="small"
          tooltip="Help and feedback"
          className="help-button-quiet hc-help"
          reports={{ context: 'host', gameId: code || undefined }}
        />
      ) : null}
      {/* THE BELL (owner, 21 Oct 2026), last on the line. The laptop's private
          screen; a click opens the console in a new tab so the session stays put. */}
      <HostNotificationsBell newTab />
    </header>
  );
}
