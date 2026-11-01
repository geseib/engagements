import React from 'react';
import HW, { TOP_SLOTS } from '../../config/hostWords';
import RoomWindowStatus from '../stage/RoomWindowStatus';
import HostNotificationsBell from '../HostNotificationsBell';
import HelpButton from '../HelpButton';
import Icon from '../Icon';
import { helpFor } from '../../config/help/screens';

export { TOP_SLOTS };

/**
 * THE TOP BAR (experience plan §3.2, Phase 2 step 2a): fixed slots, in this
 * order, in every phase, and the same words from config/hostWords.js:
 *
 *   Main menu · the session's name · Join · the room's screen ·
 *   the connection (only when it is broken) · the bell (Needs you) · ? ·
 *   Session menu
 *
 * Each slot carries `data-slot` (hostWords TOP_SLOTS), so a test can read the
 * order from the DOM. Main menu is always there, top left (§2 principle 2): the
 * session keeps running when you leave. The Session menu is a labelled button,
 * top right. A type's own parts (`children`: the Build Room's Share demo, The
 * room sees, its connection) sit after the room's screen, before the bell.
 *
 * Only what the app can know about the room's window: connected, full screen,
 * visible. Never "the projector is on".
 */
export default function ConsoleTop({
  title, code, onJoin, joinHint = '', joinPressed, presentHref, presentDetail, onOpenPresent,
  onLeave = null, leaveLabel = '', children = null, short = false, codeProps = null, help = '',
  bellSession = null, connected = null, onSessionMenu = null, sessionMenuOpen = false,
}) {
  const open = typeof onOpenPresent === 'function' ? onOpenPresent : undefined;
  // Never a dead control (engage-design hard rule 2): without a page's own way
  // out, Main menu goes to the start screen.
  const leave = typeof onLeave === 'function' ? onLeave : () => window.location.assign('/');
  const pressed = Boolean(joinPressed);
  const joinWhat = joinHint || (pressed ? HW.joinHideHint : HW.joinShowHint);
  return (
    <header className="hc-top">
      <button type="button" className="hc-leave" data-slot="main-menu" onClick={leave} title={HW.mainMenuHint}>
        <Icon name="House" weight="bold" size={16} color="currentColor" />
        {/* `leaveLabel`: kept for a caller still passing its own copy of the word. */}
        <span>{leaveLabel || HW.mainMenu}</span>
      </button>
      <span className="hc-name" data-slot="name" title={title}>{title}</span>
      <span className="hc-spacer" />
      {/* THE ONE JOIN TOGGLE (§3.6): the code on the room's screen, or not.
          A press shows it; the next press takes it down. */}
      {code ? (
        <button
          type="button"
          className="hc-code"
          data-slot="join"
          onClick={onJoin}
          title={joinWhat}
          aria-label={`${HW.join} ${code}. ${joinWhat}`}
          aria-pressed={joinPressed === undefined ? undefined : pressed}
          {...(codeProps || {})}
        >
          <Icon name="QrCode" weight="bold" size={16} color="currentColor" />
          {HW.join} <b>{code}</b>
        </button>
      ) : null}
      {/* The room's window and whether it is really up; on a laptop with no
          second display, Open as a tab and the line that says what to do
          (owner, 19 Oct 2026). The same part the Build Room's header draws. */}
      <RoomWindowStatus
        data-slot="room-screen"
        href={presentHref}
        detail={presentDetail}
        onOpen={open}
        short={short}
        linkLabel={`${HW.roomsWindow} ↗`}
        classes={{ link: 'hc-btn', stat: 'hc-winstat', dot: 'hc-dot' }}
      />
      {children}
      {/* THE CONNECTION, ONLY WHEN IT IS BROKEN (PLAN §4.2 row 7). The socket
          reconnects by itself; the chip says so until it has. */}
      {connected === false ? (
        <span className="hc-conn" data-slot="connection" role="status" title={HW.reconnecting} aria-label={`${HW.notHearing} · ${HW.reconnecting}`}>
          <Icon name="WifiSlash" weight="bold" size={16} color="currentColor" />
          {HW.notHearing}
        </span>
      ) : null}
      {/* THE BELL: the session's Needs-you door with `bellSession` (§4.3). */}
      <span className="hc-bell" data-slot="needs-you">
        {bellSession ? <HostNotificationsBell newTab session={bellSession} labelled /> : <HostNotificationsBell newTab />}
      </span>
      {/* THE `?` (Help Phase 3): the screen id of the type's console
          (config/help/screens.js); the same button reports a bug. */}
      {help ? (
        <span className="hc-helpslot" data-slot="help">
          <HelpButton
            {...helpFor(help)}
            variant="inline"
            size="small"
            tooltip={HW.help}
            className="help-button-quiet hc-help"
            reports={{ context: 'host', gameId: code || undefined }}
          />
        </span>
      ) : null}
      {/* THE SESSION MENU (§3.2b): one labelled button, top right. It opens
          as a sheet over the content area, never over Your part now. */}
      {typeof onSessionMenu === 'function' ? (
        <button
          type="button"
          className="hc-menu"
          data-slot="session-menu"
          aria-haspopup="dialog"
          aria-expanded={Boolean(sessionMenuOpen)}
          onClick={onSessionMenu}
        >
          <Icon name="List" weight="bold" size={16} color="currentColor" />
          {HW.sessionMenu}
        </button>
      ) : null}
    </header>
  );
}
