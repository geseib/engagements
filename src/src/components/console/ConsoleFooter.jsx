import React, { useEffect, useRef } from 'react';
import RW from '../../config/roundWords';
import HostActionBar from '../HostActionBar';

/**
 * THE CONSOLE'S FOOTER (spec §3.2): the moment's status, "Your part now", and
 * the existing HostActionBar (keys unchanged: Space, →, ←, the clicker, the
 * in-place second press). The footer states the count itself, so the bar's own
 * status line is handed an empty status: StatusMessage renders nothing for an
 * empty message, and one fact is never said twice.
 */
const NO_STATUS = Object.freeze({ text: '', tone: '' });

export default function ConsoleFooter({ status, nextOnWall = '', part, controls, onAction, shortcutsEnabled, interceptAdvance, onBackKey }) {
  /*
    THE FOOTER IS THE CONSOLE'S DOCK. The Session panel and its scrim stop at
    `--dock-measured` so they never cover the main button (useStageFit
    publishes it from the stage's dock; the stage is not mounted here). The
    same measurement, from this footer, and removed on the way out.
  */
  const ref = useRef(null);
  useEffect(() => {
    const root = document.documentElement;
    let mine = '';
    const publish = () => {
      const h = ref.current ? Math.ceil(ref.current.getBoundingClientRect().height) : 0;
      if (h > 0) {
        mine = `${h}px`;
        root.style.setProperty('--dock-measured', mine);
      }
    };
    publish();
    // Measured when the footer's own box changes, not on every render. jsdom
    // has no ResizeObserver: there the one measurement above stands.
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(publish) : null;
    if (observer && ref.current) observer.observe(ref.current);
    return () => {
      if (observer) observer.disconnect();
      // Only ours: a stage mounted since may have published its own.
      if (mine && root.style.getPropertyValue('--dock-measured') === mine) root.style.removeProperty('--dock-measured');
    };
  }, []);
  return (
    <footer className="hc-foot" ref={ref}>
      <div className="hc-status">
        <b>{status && status.text}</b>
        {/* What the wall shows next (spec §3.5, first draft): only when given. */}
        {nextOnWall ? <p className="hc-next">{nextOnWall}</p> : null}
      </div>
      {part ? (
        <p className="hc-part">
          <span className="hc-part-k">{RW.yourPartLabel}</span>
          {part.before}{part.action ? <b className="hc-action">{part.action}</b> : null}{part.after}
        </p>
      ) : null}
      <div className="hc-acts">
        {controls ? (
          <HostActionBar
            controls={{ ...controls, status: NO_STATUS }}
            onAction={onAction}
            shortcutsEnabled={shortcutsEnabled}
            interceptAdvance={interceptAdvance}
            onBackKey={onBackKey}
          />
        ) : null}
      </div>
    </footer>
  );
}
