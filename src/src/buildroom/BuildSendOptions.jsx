/**
 * BESIDE EVERY SEND TO CLAUDE (owner, 23 Oct 2026):
 *
 *   HideFromRoom   "Don't show the room", unticked by default. Ticked, Claude
 *                  gets every word as ever (`hideFromRoom: true` on the send);
 *                  the Stage, the room's window, phones and the room's History
 *                  say only that the host sent something.
 *   MirrorToggle   "Show my typing to the room", two screens only (on one the
 *                  room already sees this laptop). Off by default, remembered
 *                  per session in this browser (typingMirror.js mirrorKey).
 *   useMirror      a direction box's `draft(text)` while typing and `done()` on
 *                  Send or cancel: the words go to the room's window opened
 *                  from this laptop (typingMirror.js), never to the server.
 *                  Never the Why: only the direction box calls it.
 *
 * The page (BuildRoomPage) provides the session and whether the room watches
 * on two screens; with no provider (a test, the report) nothing mirrors.
 */
import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { W } from './words';
import {
  createTypingSender, openTypingChannel, readMirror, storeMirror,
} from './typingMirror';

const storage = () => { try { return window.localStorage; } catch (e) { return null; } };

const SendOptions = createContext({ twoScreens: false, mirrorOn: false, setMirrorOn: () => {}, sender: null });

export function SendOptionsProvider({ gameId, twoScreens = false, children }) {
  const [mirrorOn, setOn] = useState(() => readMirror(gameId, storage()));
  useEffect(() => { setOn(readMirror(gameId, storage())); }, [gameId]);
  const sender = useRef(null);
  // One channel per session for as long as the page is up; '' when it goes.
  useEffect(() => {
    sender.current = createTypingSender(openTypingChannel(gameId));
    return () => { if (sender.current) sender.current.close(); sender.current = null; };
  }, [gameId]);
  const live = mirrorOn && twoScreens;
  // The toggle going off (or the room going back to one screen) clears the window at once.
  useEffect(() => { if (!live && sender.current) sender.current.clear(); }, [live]);
  const setMirrorOn = useCallback((on) => { storeMirror(gameId, storage(), on); setOn(on); }, [gameId]);
  const value = useMemo(() => ({
    twoScreens, mirrorOn, setMirrorOn, sender: live ? sender : null,
  }), [twoScreens, mirrorOn, setMirrorOn, live]);
  return <SendOptions.Provider value={value}>{children}</SendOptions.Provider>;
}

/** A direction box's mirror: `draft(text)` as the host types, `done()` on Send or cancel. */
export function useMirror() {
  const { sender } = useContext(SendOptions);
  const draft = useCallback((text) => { if (sender && sender.current) sender.current.push(text); }, [sender]);
  const done = useCallback(() => { if (sender && sender.current) sender.current.clear(); }, [sender]);
  // A box that goes away (a window closed, a send) takes its words off the room's window.
  useEffect(() => () => { if (sender && sender.current) sender.current.clear(); }, [sender]);
  return { draft, done };
}

export function HideFromRoom({ checked, onChange, disabled = false }) {
  return (
    <label className="brm-check brm-small brm-hideroom" title={W.hideFromRoomTip}>
      <input type="checkbox" checked={Boolean(checked)} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {W.hideFromRoom}
    </label>
  );
}

/** Only offered when the room watches on two screens. */
export function MirrorToggle() {
  const { twoScreens, mirrorOn, setMirrorOn } = useContext(SendOptions);
  if (!twoScreens) return null;
  return (
    <label className="brm-check brm-small brm-mirror" title={W.mirrorTypingTip}>
      <input type="checkbox" checked={mirrorOn} onChange={(e) => setMirrorOn(e.target.checked)} />
      {W.mirrorTyping}
      <span className="brm-hint brm-mirror-hint">{W.mirrorTypingTip}</span>
    </label>
  );
}

/** Both, as one row beside a send box. `hide`/`setHide` are the box's own; `mirror` false where there is no direction box. */
export function SendExtras({ hide, setHide, disabled = false, mirror = true }) {
  return (
    <span className="brm-row brm-gap brm-sendextras">
      <HideFromRoom checked={hide} onChange={setHide} disabled={disabled} />
      {mirror && <MirrorToggle />}
    </span>
  );
}
