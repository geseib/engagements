/**
 * LIVE TYPING ON THE ROOM'S WINDOW (owner, 23 Oct 2026: "live typing can be
 * local only with the room window. but once entered, the phones, laptops can
 * see").
 *
 * Two screens only, and only behind the host's "Show my typing to the room".
 * The draft never reaches the server: the host's page posts it to the room's
 * window opened from the same browser on a BroadcastChannel (same origin),
 * named per session. A window on another device simply gets nothing. Once the
 * host sends, the Sent to Claude card (the server's `sent`) takes over on
 * every screen, as for any send.
 *
 *   message   { text, at }: the direction box's words (never the Why), the
 *             last TYPING_MAX characters; '' clears
 *   sender    about 4 a second while typing, plus a final send; '' on Send,
 *             cancel, the toggle going off and the page going away
 *   window    shows "The host is writing to Claude…" with the words; clears
 *             on '', on a new send, and after TYPING_CLEAR_MS of silence
 *
 * No BroadcastChannel (an older browser): nothing is sent and nothing shows.
 * Pure but for the channel and the timers, which a test passes in.
 */

export const TYPING_THROTTLE_MS = 250;
export const TYPING_CLEAR_MS = 10 * 1000;
export const TYPING_MAX = 300;
export const typingChannelName = (gameId) => `engage-build-typing-${gameId}`;
/** The host's choice, per session in this browser. Off unless they turned it on. */
export const mirrorKey = (gameId) => `engage.build.mirrorTyping.${gameId}`;

/** The session's channel, or null where the browser has none. */
export function openTypingChannel(gameId, Channel = typeof BroadcastChannel === 'function' ? BroadcastChannel : null) {
  if (!gameId || typeof Channel !== 'function') return null;
  try { return new Channel(typingChannelName(gameId)); } catch (e) { return null; }
}

export function readMirror(gameId, storage) {
  try { return Boolean(storage && storage.getItem(mirrorKey(gameId)) === 'on'); } catch (e) { return false; }
}
export function storeMirror(gameId, storage, on) {
  try {
    if (!storage) return;
    if (on) storage.setItem(mirrorKey(gameId), 'on');
    else storage.removeItem(mirrorKey(gameId));
  } catch (e) { /* private mode: this visit only */ }
}

/** The words a message carries: the box's own, the newest TYPING_MAX characters. */
export const typingText = (text) => {
  const t = String(text || '');
  return t.length > TYPING_MAX ? t.slice(-TYPING_MAX) : t;
};

/**
 * The host's side. `push(text)` while typing: the first goes at once, then at
 * most one per TYPING_THROTTLE_MS, the last one always (the final send).
 * `clear()` cancels what waits and sends ''. `close()` clears and lets go.
 */
export function createTypingSender(channel, { now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let last = -Infinity;
  let timer = null;
  let pending = null;
  let shown = '';
  const post = (text) => {
    if (!channel) return;
    shown = text;
    last = now();
    try { channel.postMessage({ text, at: new Date(last).toISOString() }); } catch (e) { /* the window is gone */ }
  };
  const cancel = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
    pending = null;
  };
  const clear = () => {
    cancel();
    if (shown) post('');
  };
  const push = (raw) => {
    if (!channel) return;
    const text = typingText(raw);
    if (!text.trim()) { clear(); return; }
    const wait = TYPING_THROTTLE_MS - (now() - last);
    if (wait <= 0 && timer === null) { post(text); return; }
    pending = text;
    if (timer === null) {
      timer = setTimer(() => {
        timer = null;
        const p = pending;
        pending = null;
        if (p !== null) post(p);
      }, Math.max(0, wait));
    }
  };
  const close = () => {
    clear();
    try { if (channel && typeof channel.close === 'function') channel.close(); } catch (e) { /* already closed */ }
  };
  return { push, clear, close };
}

/**
 * The window's side: what the host is typing, or ''. `onText(text)` on every
 * change; '' once a message says so or TYPING_CLEAR_MS pass without one.
 * Returns a stop function.
 */
export function listenForTyping(channel, onText, { setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  if (!channel) return () => {};
  let timer = null;
  const quiet = () => { if (timer !== null) clearTimer(timer); timer = null; };
  const onMessage = (e) => {
    const data = e && e.data;
    const text = data && typeof data.text === 'string' ? typingText(data.text) : '';
    quiet();
    onText(text.trim() ? text : '');
    if (text.trim()) timer = setTimer(() => { timer = null; onText(''); }, TYPING_CLEAR_MS);
  };
  if (typeof channel.addEventListener === 'function') channel.addEventListener('message', onMessage);
  else channel.onmessage = onMessage;
  return () => {
    quiet();
    if (typeof channel.removeEventListener === 'function') channel.removeEventListener('message', onMessage);
    else channel.onmessage = null;
    try { if (typeof channel.close === 'function') channel.close(); } catch (e) { /* already closed */ }
  };
}
