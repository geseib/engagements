/**
 * THE HOST ALERT (docs/design/build-room-host-alert, owner 2026-10-10): on the
 * two screens the room sees, a count on the way back to the Host screen. Amber
 * while Claude waits on the host, grey otherwise. A click with a count opens a
 * short list in place, most urgent first, folded by kind; each line jumps to
 * where it is handled. With no count a click goes straight to the Host screen.
 *
 * The room reads these screens: the button and the list carry fixed words and
 * numbers only, never a name or a word a participant typed. No sound, no
 * pop-up, no live region.
 *
 * `variant`: 'stage' (the dock's HOST, the list opens above it, Room ladder)
 * or 'header' (the Host tab, the list drops under it, laptop ladder).
 */
import React, { useEffect, useRef, useState } from 'react';
import { useKeepOnScreen } from './keepOnScreen';
import { W } from './words';

export default function HostAlert({ alert, variant, onHost, onGo, onMarkAll }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  const trigger = useRef(null);
  const panel = useRef(null);
  const count = alert.count;
  const showList = open && count > 0;
  useKeepOnScreen(panel, showList, `${alert.lines.length}:${variant}`);

  // Escape or a click outside closes it. Escape hands the focus back to the button.
  useEffect(() => {
    if (!showList) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      if (trigger.current) trigger.current.focus();
    };
    const onDown = (e) => { if (wrap.current && !wrap.current.contains(e.target)) setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); };
  }, [showList]);

  const tone = count > 0 ? (alert.amber ? 'amber' : 'grey') : 'none';
  const cls = `brm-hostalert brm-hostalert--${variant}${count > 0 ? ` brm-hostalert--${tone}` : ''}${showList ? ' is-open' : ''}`;
  const press = () => {
    if (count > 0) setOpen((o) => !o);
    else onHost();
  };
  const go = (line) => { setOpen(false); onGo(line); };
  const host = () => { setOpen(false); onHost(); };

  const label = variant === 'stage'
    ? <span className="dock-more-lbl">HOST</span>
    : <>{W.hostAlertName}</>;
  const num = count > 0 ? <span className="brm-hostalert-n"><span aria-hidden="true"> · </span><span className="c">{count}</span></span> : null;

  return (
    <span className={`brm-hostalert-wrap brm-hostalert-wrap--${variant}`} ref={wrap}>
      <button
        type="button"
        ref={trigger}
        className={variant === 'stage' ? `dock-more ${cls}` : `brm-screen ${cls}`}
        aria-haspopup={count > 0 ? 'true' : undefined}
        aria-expanded={count > 0 ? showList : undefined}
        aria-label={count > 0 ? undefined : W.hostScreen}
        title={`${W.hostScreen} (1 or P)`}
        onClick={press}
      >
        {label}{num}
      </button>
      {showList && (
        <div className={`brm-halist brm-halist--${variant}`} role="group" aria-label={W.alertList} ref={panel}>
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
            <button type="button" className="brm-halist-btn" onClick={() => { setOpen(false); onMarkAll(); }}>{W.markAllSeen}</button>
            <button type="button" className="brm-halist-btn brm-halist-push" onClick={host}>{W.hostScreen} · 1</button>
          </div>
        </div>
      )}
    </span>
  );
}
