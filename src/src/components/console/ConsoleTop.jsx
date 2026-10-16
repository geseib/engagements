import React from 'react';
import CW from '../../config/consoleWords';
import { presentStatusFrom } from '../../config/presentStatus';
import RoomWindowLink from '../stage/RoomWindowLink';

/**
 * THE CONSOLE'S TOP LINE (host console spec §3.1): the session's name, the
 * join code (pressing it shows the code on the wall), the room's window and
 * whether that window is really up. Only what the app can know: connected,
 * full screen, visible. Never "the projector is on".
 */
export default function ConsoleTop({ title, code, onJoin, presentHref, presentDetail, onOpenPresent }) {
  const status = presentStatusFrom(presentDetail);
  const open = typeof onOpenPresent === 'function' ? onOpenPresent : undefined;
  return (
    <header className="hc-top">
      <span className="hc-brand">Engagements</span>
      <span className="hc-name">{title}</span>
      <span className="hc-spacer" />
      {code ? (
        <button type="button" className="hc-code" onClick={onJoin} aria-label={`${CW.join} ${code}. Show the join code on the wall`}>
          {CW.join} <b>{code}</b>
        </button>
      ) : null}
      {presentHref ? (
        <RoomWindowLink className="hc-btn" href={presentHref} onClick={open}>
          {`${CW.roomsWindow} ↗`}
        </RoomWindowLink>
      ) : null}
      {status.state === 'closed' && presentHref ? (
        <RoomWindowLink className={`hc-winstat is-${status.tone}`} href={presentHref} title={status.hint} onClick={open}>
          <span className="hc-dot" aria-hidden="true" />{status.label}
        </RoomWindowLink>
      ) : (
        <span className={`hc-winstat is-${status.tone}`} title={status.hint} role="status">
          <span className="hc-dot" aria-hidden="true" />{status.label}
        </span>
      )}
    </header>
  );
}
