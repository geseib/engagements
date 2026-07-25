import { useState, useEffect } from 'react';

const STORAGE_KEY = 'admin_websocket_mode';
// Same-tab notification. The native `storage` event deliberately does not fire
// in the tab that wrote the value, so the admin toggle needs this to reach any
// host/player view open in its own tab.
const CHANGE_EVENT = 'websocket-mode-change';

/** Current mode from localStorage, falling back to the window global, else on. */
export function readWebSocketMode() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored !== null) return stored === 'true';
  return window.WEBSOCKET_MODE ?? true;
}

/** Persist the mode and notify every listener, in this tab and in others. */
export function setWebSocketMode(enabled) {
  localStorage.setItem(STORAGE_KEY, String(enabled));
  window.WEBSOCKET_MODE = enabled;
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: enabled }));
}

/**
 * Track the admin's WebSocket toggle.
 *
 * Previously the host and player pages each polled localStorage on a 1-second
 * setInterval that ran for the lifetime of the page — on every connected
 * client, for the whole session, to observe a value that changes maybe once a
 * day. This listens for the change instead: `storage` covers other tabs, and
 * the custom event covers this one.
 */
export function useWebSocketMode() {
  const [enabled, setEnabled] = useState(() => {
    const initial = readWebSocketMode();
    if (window.WEBSOCKET_MODE === undefined) window.WEBSOCKET_MODE = initial;
    return initial;
  });

  useEffect(() => {
    const sync = () => {
      const next = readWebSocketMode();
      window.WEBSOCKET_MODE = next;
      // setState with an unchanged value is a no-op in React, so there is no
      // need to compare here.
      setEnabled(next);
    };

    const onStorage = (e) => {
      if (e.key === null || e.key === STORAGE_KEY) sync();
    };

    window.addEventListener('storage', onStorage);
    window.addEventListener(CHANGE_EVENT, sync);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(CHANGE_EVENT, sync);
    };
  }, []);

  return enabled;
}
