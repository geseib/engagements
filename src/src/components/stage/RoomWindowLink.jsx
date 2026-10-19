import React from 'react';
import { onRoomWindowClick, willPlace, placedHref } from '../../present/roomWindow';
import { FILL_ONCE } from '../../config/presentStatus';
import { SCREEN_WORDS } from '../../config/roomScreen';

/**
 * Every "Room's window" link (console top line, Screens group, the Setup
 * chooser, the dock's PRESENT). A real link, so "open in new window" and a drag
 * still work; where Chrome can place windows and a second display is attached,
 * a plain click opens it on that display, filled (present/roomWindow.js).
 */
export default function RoomWindowLink({ href, className, children, title, onClick, ...rest }) {
  const placing = willPlace();
  const handle = (e) => {
    onRoomWindowClick(e, href);
    if (typeof onClick === 'function') onClick(e);
  };
  return (
    <a
      {...rest}
      className={className}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={placing ? `Opens on your other display. ${FILL_ONCE}.` : title}
      data-places={placing ? '' : undefined}
      onClick={handle}
    >
      {children}
    </a>
  );
}

/**
 * OPEN AS A TAB (owner, 19 Oct 2026: one laptop, no second display). The
 * room's window in a tab of this browser, with `placed=1`, so the window's
 * fill cue shows and its first click goes full screen (PresentPage.jsx
 * useClickToFill), exactly as a window placed on another display. The host
 * shares that tab on the call, or fills it on a mirrored projector.
 */
export function RoomWindowTab({ href, className, children, ...rest }) {
  if (!href) return null;
  return (
    <a
      {...rest}
      className={className}
      href={placedHref(href)}
      target="_blank"
      rel="noopener noreferrer"
      title={SCREEN_WORDS.openTabHint}
      data-room-tab=""
    >
      {children || SCREEN_WORDS.openTab}
    </a>
  );
}
