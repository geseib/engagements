/**
 * THE HOST ALERT (docs/design/build-room-host-alert, owner 2026-10-10): on the
 * Build and History screens the room sees, a count on the header's Host tab.
 * Amber while Claude waits on the host, grey otherwise. A click with a count
 * opens a short list in place, most urgent first, folded by kind; each line
 * jumps to where it is handled. With no count a click goes straight to the
 * Host screen.
 *
 * THE STAGE HAS NO LIST (parity PLAN §2a D2, Q16 ruled, 17 Oct 2026): its
 * HOST goes home in one press, the count a badge on it (HostHome in
 * screens/BuildStageScreen.jsx), because on one screen the Stage has no other
 * way back. The list of what waits is the Host screen's Waiting for you.
 *
 * The room reads these screens: the button and the list carry fixed words and
 * numbers only, never a name or a word a participant typed. No sound, no
 * pop-up, no live region.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useKeepOnScreen } from './keepOnScreen';
import { W } from './words';

export default function HostAlert({ alert, onHost, onGo, onMarkAll }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  const trigger = useRef(null);
  const panel = useRef(null);
  const count = alert.count;
  const showList = open && count > 0;
  useKeepOnScreen(panel, showList, `${alert.lines.length}:header`);

  // Escape or a click outside closes it. Escape hands the focus back to the button.
  useEffect(() => {
    if (!showList) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      if (trigger.current) trigger.current.focus();
    };
    const onDown = (e) => { if (wrap.current && !wrap.current.contains(e.target)) setOpen(false); };
    // A click into an iframe (the live build) fires neither mousedown here nor a focusout: the window itself loses the focus.
    const onWindowBlur = () => setOpen(false);
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('blur', onWindowBlur);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); window.removeEventListener('blur', onWindowBlur); };
  }, [showList]);

  const tone = count > 0 ? (alert.amber ? 'amber' : 'grey') : 'none';
  const cls = `brm-hostalert brm-hostalert--header${count > 0 ? ` brm-hostalert--${tone}` : ''}${showList ? ' is-open' : ''}`;
  const press = () => {
    if (count > 0) setOpen((o) => !o);
    else onHost();
  };
  const go = (line) => { setOpen(false); onGo(line); };
  const host = () => { setOpen(false); onHost(); };
  const num = count > 0 ? <span className="brm-hostalert-n"><span aria-hidden="true"> · </span><span className="c">{count}</span></span> : null;

  return (
    <span
      className="brm-hostalert-wrap brm-hostalert-wrap--header"
      data-capability="host-alert"
      ref={wrap}
      // Focus leaving for somewhere outside closes the list. A null target (a click on nothing focusable) is the mousedown handler's.
      onBlur={(e) => { if (showList && e.relatedTarget && wrap.current && !wrap.current.contains(e.relatedTarget)) setOpen(false); }}
    >
      <button
        type="button"
        ref={trigger}
        className={`brm-screen ${cls}`}
        aria-haspopup={count > 0 ? 'true' : undefined}
        aria-expanded={count > 0 ? showList : undefined}
        title={W.hostKeys}
        onClick={press}
      >
        {W.hostAlertName}{num}
      </button>
      {showList && (
        <div className="brm-halist brm-halist--header" role="group" aria-label={W.alertList} ref={panel}>
          <ul>
            {alert.lines.map((line, i) => (
              <li key={line.key} className={i === 0 ? 'lead' : undefined}>
                <button type="button" className="brm-halist-line" onClick={() => go(line)} autoFocus={i === 0}>
                  <span className="t">{line.label}</span>
                  <span className="go">{line.go}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="brm-halist-ft">
            <button type="button" className="brm-halist-btn" onClick={() => { setOpen(false); onMarkAll(); if (trigger.current) trigger.current.focus(); }}>{W.markAllSeen}</button>
            <button type="button" className="brm-halist-btn brm-halist-push" onClick={host}>{W.hostScreen} · 1</button>
          </div>
        </div>
      )}
    </span>
  );
}
