import React, { useEffect, useState } from 'react';
import NotificationsBell from './NotificationsBell';
import { hrefFor } from '../utils/notificationsApi';
import { fetchOrgs, librariesFrom } from '../utils/libraries';

/**
 * THE BELL OUTSIDE THE CONSOLE (owner, 21 Oct 2026: "add the bell to the host
 * page and remote too"). The same inbox as the console's top line
 * (NotificationsBell); only where a click goes differs, because these pages
 * are not the console.
 *
 * `newTab`: on a page with a live session (the two-screen console, the
 * remote) a notification opens the console in a new tab, so the session page
 * stays where it is. On the host's menu, where no session is open, it opens
 * in place, as that screen's own link to the console does.
 *
 * PRIVATE SCREENS ONLY. Never on the one-screen stage or the room's window:
 * those are projected, and a notification names drafts, people and teams.
 *
 * The libraries only name where each entry belongs ("Your space", a team);
 * Engage's own entries are named from their link, so no staff check is needed.
 */
export function openNotificationAway(item, { newTab = false, win = window } = {}) {
  const url = hrefFor(item && item.link);
  if (newTab) {
    // Not the 'noopener' feature: with it open() answers null even when the
    // tab opened, and the fallback below would take the session page away too.
    const w = win.open(url, '_blank');
    if (w) {
      try { w.opener = null; } catch (e) { /* read-only in some browsers */ }
      return;
    }
  }
  win.location.assign(url);
}

export default function HostNotificationsBell({ newTab = false }) {
  const [libraries, setLibraries] = useState([]);
  useEffect(() => {
    let live = true;
    Promise.resolve()
      .then(() => fetchOrgs())
      .then((list) => { if (live) setLibraries(librariesFrom(list || [], false)); })
      .catch(() => { /* labels are a nicety; the inbox still reads */ });
    return () => { live = false; };
  }, []);
  return <NotificationsBell libraries={libraries} onOpen={(item) => openNotificationAway(item, { newTab })} />;
}
