import React, { useCallback, useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import {
  listNotifications, markNotificationRead, markAllNotificationsRead, daysLeftLabel,
} from '../utils/notificationsApi';
import { libraryLabel, ENGAGE_KEY } from '../utils/libraries';
import './NotificationsBell.css';

/**
 * THE BELL — one inbox in the console's top line.
 *
 * The owner, 2026-10-21: "ONE general notifications icon (an inbox with a bell
 * and a count) in the app's top line. It covers question sets, the
 * organisation, requests to the user, and so on. Each notification in its
 * list, when clicked, takes the user where they need to go."
 *
 * WHAT IT SHOWS is whatever GET /me/notifications/list answers
 * (admin/orgs/my-notifications.js): AI drafts ready, partly ready or failed
 * (read/unread, a reminder five days before one expires), and the live things
 * that already wait — invitations, people waiting in a team you run, sets the
 * content check sent back, Engage's queues for staff.
 *
 * THE COUNT is unread entries. A live entry is unread for as long as the thing
 * waits, because it is a request to come and act, not news.
 *
 * READ ON OPEN, NOT POLLED HARD. Once when the console loads, again when the
 * window regains focus (at most once a minute), and every five minutes while
 * it is open. A draft takes minutes; a tighter loop would cost requests to say
 * nothing new.
 *
 * WHERE A CLICK GOES is the page's business (`onOpen`): it may have to switch
 * library first, which reloads the console.
 */
const FOCUS_THROTTLE_MS = 60 * 1000;
const INTERVAL_MS = 5 * 60 * 1000;

export default function NotificationsBell({ libraries = [], onOpen, refreshKey = 0 }) {
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const lastRead = useRef(0);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);

  const load = useCallback(async () => {
    lastRead.current = Date.now();
    try {
      const data = await listNotifications();
      setItems(data.items);
      setUnread(data.unread);
      setError('');
    } catch (e) {
      setError(e.message || 'The notifications could not be read.');
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  useEffect(() => {
    const onFocus = () => { if (Date.now() - lastRead.current > FOCUS_THROTTLE_MS) load(); };
    window.addEventListener('focus', onFocus);
    const timer = setInterval(() => { if (!document.hidden) load(); }, INTERVAL_MS);
    return () => { window.removeEventListener('focus', onFocus); clearInterval(timer); };
  }, [load]);

  /* Outside click and Escape close it, and Escape hands focus back. */
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => {
      if (e.key === 'Escape') { setOpen(false); if (buttonRef.current) buttonRef.current.focus(); }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) load();
  };

  const choose = async (item) => {
    if (item.source === 'stored' && !item.read) {
      setItems((list) => list.map((n) => (n.id === item.id ? { ...n, read: true } : n)));
      setUnread((n) => Math.max(0, n - 1));
      try { await markNotificationRead(item.id); } catch (e) { /* the click still goes */ }
    }
    setOpen(false);
    if (onOpen) onOpen(item);
  };

  const readAll = async () => {
    try { await markAllNotificationsRead(); } catch (e) { /* re-read shows the truth */ }
    load();
  };

  const storedUnread = items.some((n) => n.source === 'stored' && !n.read);
  const label = unread ? `Notifications, ${unread} waiting` : 'Notifications';

  return (
    <div className="nbell" ref={rootRef}>
      <button
        type="button"
        ref={buttonRef}
        className={`nbell-btn${unread ? ' nbell-btn--some' : ''}`}
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={toggle}
        data-testid="nbell-button"
      >
        <Icon name="Bell" weight={unread ? 'fill' : 'bold'} size={18} color="currentColor" />
        {unread > 0 && <span className="nbell-count" data-testid="nbell-count">{unread > 99 ? '99+' : unread}</span>}
      </button>

      {open && (
        <div className="nbell-panel" role="dialog" aria-label="Notifications" data-testid="nbell-panel">
          <header className="nbell-head">
            <h2 className="nbell-title">Notifications</h2>
            {storedUnread && (
              <button type="button" className="nbell-link" onClick={readAll}>Mark all read</button>
            )}
            <button type="button" className="nbell-x" aria-label="Close notifications" onClick={() => setOpen(false)}>
              <Icon name="X" weight="bold" size={14} color="currentColor" />
            </button>
          </header>

          {error && (
            <p className="nbell-error" role="alert">
              {error} <button type="button" className="nbell-link" onClick={load}>Try again</button>
            </p>
          )}

          {!error && loaded && items.length === 0 && (
            <p className="nbell-empty">Nothing is waiting for you. Generated drafts, invitations and requests show up here.</p>
          )}

          {items.length > 0 && (
            <ul className="nbell-list">
              {items.map((item) => {
                const where = item.orgId
                  ? libraryLabel(item.orgId, libraries)
                  : (item.link && item.link.orgId === ENGAGE_KEY ? 'Engage' : '');
                const left = daysLeftLabel(item.daysLeft);
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={`nbell-item${item.read ? '' : ' nbell-item--unread'}`}
                      onClick={() => choose(item)}
                      data-testid={`nbell-item-${item.kind}`}
                    >
                      <span className="nbell-dot" aria-hidden="true" />
                      <span className="nbell-text">
                        <span className="nbell-line">{item.title}</span>
                        {item.body && <span className="nbell-body">{item.body}</span>}
                        {(where || left || item.reminder) && (
                          <span className="nbell-meta">
                            {where && <span>{where}</span>}
                            {left && <span>{item.reminder ? `Reminder · ${left}` : left}</span>}
                          </span>
                        )}
                      </span>
                      <Icon name="CaretRight" weight="bold" size={14} color="currentColor" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <footer className="nbell-foot">
            <button type="button" className="nbell-link" onClick={() => setOpen(false)}>Close</button>
          </footer>
        </div>
      )}
    </div>
  );
}
