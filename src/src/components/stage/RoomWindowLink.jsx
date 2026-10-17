import React from 'react';
import { onRoomWindowClick, willPlace } from '../../present/roomWindow';

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
      title={placing ? 'Opens on your other display. Click it once to fill the screen.' : title}
      data-places={placing ? '' : undefined}
      onClick={handle}
    >
      {children}
    </a>
  );
}
