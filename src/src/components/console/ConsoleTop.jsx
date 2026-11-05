import React from 'react';
import HW, { TOP_SLOTS } from '../../config/hostWords';
import RoomWindowStatus from '../stage/RoomWindowStatus';
import HostNotificationsBell from '../HostNotificationsBell';
import HelpButton from '../HelpButton';
import Icon from '../Icon';
import Button from '../ui/Button';
import JoinCodeChip from './JoinCodeChip';
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
 *
 * ONE SCREEN (`oneScreen`, §3.3, Phase 2 step 2h): the one-screen stage draws
 * this same bar, in the same slots, and two words change. Join reads "Show
 * join code" / "Hide join code" (the one toggle; the room already reads the
 * code on the rail), and the room's-window slot reads "The room sees this
 * screen", a status rather than a link, because there is no window to open.
 * `bell` replaces the account-aware bell there with the count-only one
 * (components/needs/OneScreenNeedsBell): the room can read this bar, so it
 * never carries a name.
 */
export default function ConsoleTop({
  title, code, onJoin, joinHint = '', joinPressed, presentHref, presentDetail, onOpenPresent,
  onLeave = null, leaveLabel = '', children = null, short = false, codeProps = null, help = '',
  bellSession = null, connected = null, onSessionMenu = null, sessionMenuOpen = false,
  oneScreen = false, bell = null, joinQr = null,
  /* Call & Answer's console (owner, 5 Nov 2026, cut 7): the room's window
     and its status as ONE control. The Build Room keeps the pair. */
  oneRoomWindow = false,
}) {
  const open = typeof onOpenPresent === 'function' ? onOpenPresent : undefined;
  // Never a dead control (engage-design hard rule 2): without a page's own way
  // out, Main menu goes to the start screen.
  const leave = typeof onLeave === 'function' ? onLeave : () => window.location.assign('/');
  const pressed = Boolean(joinPressed);
  const joinWhat = joinHint || (pressed ? HW.joinHideHint : HW.joinShowHint);
  const joinWords = oneScreen ? (pressed ? HW.hideJoinCode : HW.showJoinCode) : '';
  return (
    <header className="hc-top">
      {/* Every button on the bar is ui/Button, secondary at 36px (experience
          plan §5.1, step 5a): the bar spends no orange; Your part now has it. */}
      <Button variant="secondary" size={36} className="hc-leave" data-slot="main-menu" onClick={leave} title={HW.mainMenuHint}>
        <Icon name="House" weight="bold" size={16} color="currentColor" />
        {/* `leaveLabel`: kept for a caller still passing its own copy of the word. */}
        <span>{leaveLabel || HW.mainMenu}</span>
      </Button>
      <span className="hc-name" data-slot="name" title={title}>{title}</span>
      <span className="hc-spacer" />
      {/* THE ONE JOIN TOGGLE (§3.6): the code on the room's screen, or not.
          A press shows it; the next press takes it down.
          TWO SCREENS WITH `joinQr` ({ playUrl, joinUrl }; owner, 3 Nov 2026):
          the code shows its QR on this laptop on hover, focus or a click, and
          the room's toggle moves inside that card (JoinCodeChip). */}
      {code && joinQr && !oneScreen ? (
        <JoinCodeChip
          code={code}
          playUrl={joinQr.playUrl}
          joinUrl={joinQr.joinUrl}
          onRoomToggle={onJoin}
          roomPressed={pressed}
          buttonProps={codeProps}
        />
      ) : code ? (
        <Button
          variant="secondary"
          size={36}
          className="hc-code"
          data-slot="join"
          onClick={onJoin}
          title={joinWhat}
          aria-label={joinWords ? `${joinWords}. ${joinWhat}` : `${HW.join} ${code}. ${joinWhat}`}
          aria-pressed={joinPressed === undefined ? undefined : pressed}
          {...(codeProps || {})}
        >
          <Icon name="QrCode" weight="bold" size={16} color="currentColor" />
          {joinWords || <>{HW.join} <b>{code}</b></>}
        </Button>
      ) : null}
      {/* The room's screen. On one screen, a status: this laptop IS it. On two,
          the room's window and whether it is really up; on a laptop with no
          second display, Open as a tab and the line that says what to do
          (owner, 19 Oct 2026). The same part the Build Room's header draws. */}
      {oneScreen ? (
        <span className="hc-winstat hc-roomsees" data-slot="room-screen" role="status" title={HW.roomSeesThisScreenHint}>
          <span className="hc-dot" aria-hidden="true" />
          {HW.roomSeesThisScreen}
        </span>
      ) : (
        <RoomWindowStatus
          data-slot="room-screen"
          href={presentHref}
          detail={presentDetail}
          onOpen={open}
          short={short}
          one={oneRoomWindow}
          linkLabel={`${HW.roomsWindow} ↗`}
          classes={{ link: 'ui-btn ui-btn--quiet ui-btn--h36', stat: 'hc-winstat', dot: 'hc-dot' }}
        />
      )}
      {children}
      {/* THE CONNECTION, ONLY WHEN IT IS BROKEN (PLAN §4.2 row 7). The socket
          reconnects by itself; the chip says so until it has. */}
      {connected === false ? (
        <span className="hc-conn" data-slot="connection" role="status" title={HW.reconnecting} aria-label={`${HW.notHearing} · ${HW.reconnecting}`}>
          <Icon name="WifiSlash" weight="bold" size={16} color="currentColor" />
          {HW.notHearing}
        </span>
      ) : null}
      {/* THE BELL: the session's Needs-you door with `bellSession` (§4.3), or
          the caller's own `bell` (the one-screen count, never a name). */}
      <span className="hc-bell" data-slot="needs-you">
        {bell || (bellSession ? <HostNotificationsBell newTab session={bellSession} labelled /> : <HostNotificationsBell newTab />)}
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
        <Button
          variant="secondary"
          size={36}
          className="hc-menu"
          data-slot="session-menu"
          aria-haspopup="dialog"
          aria-expanded={Boolean(sessionMenuOpen)}
          onClick={onSessionMenu}
        >
          <Icon name="List" weight="bold" size={16} color="currentColor" />
          {HW.sessionMenu}
        </Button>
      ) : null}
    </header>
  );
}
