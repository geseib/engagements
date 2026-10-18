import React, { useEffect } from 'react';
import RW from '../../config/roundWords';
import HostActionBar from '../HostActionBar';

/**
 * WHAT THE HOST DOES NEXT, AT THE TOP OF THE CONSOLE (owner, 18 Oct 2026:
 * "For the two screen version lets put what they are doing next in the
 * center console. it is confusing down at the bottom"). "Your part now" as
 * the card's sentence, the moment's status and what the wall shows next under
 * it, and the existing HostActionBar beside it (keys unchanged: Space, →, ←,
 * the clicker, the in-place second press). It was the console's footer (spec
 * §3.2) until then. The card states the count itself, so the bar's own status
 * line is handed an empty status: StatusMessage renders nothing for an empty
 * message, and one fact is never said twice.
 *
 * Leaving is not here: the top line's "All sessions" (HostConsole takes a
 * LEAVE control off the bar), so the way out never sits beside Start round 1.
 */
const NO_STATUS = Object.freeze({ text: '', tone: '' });

/**
 * The status text, with the late count (roundStep's `status.late.link`, always
 * the last part) drawn as a link that opens the late list (late items Task 4).
 */
function StatusText({ status, onReviewLate }) {
  const text = (status && status.text) || '';
  const late = status && status.late;
  if (!late || !onReviewLate || !late.link || !text.endsWith(late.link)) return text;
  return (
    <>
      {text.slice(0, text.length - late.link.length)}
      <button type="button" className="hc-status-link" onClick={onReviewLate}>{late.link}</button>
    </>
  );
}

export default function ConsoleFooter({ status, nextOnWall = '', part, controls, onAction, shortcutsEnabled, interceptAdvance, onBackKey, onReviewLate = null }) {
  /*
    NO DOCK ON TWO SCREENS. The Session panel and its scrim stop at
    `--dock-measured` (styles.css) so a bottom dock stays reachable; the
    console has none now, so it publishes 0 and the panel runs full height.
    Removed on the way out, and only if still ours.
  */
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--dock-measured', '0px');
    return () => {
      if (root.style.getPropertyValue('--dock-measured') === '0px') root.style.removeProperty('--dock-measured');
    };
  }, []);
  const statusText = (status && status.text) || '';
  return (
    <section className="hc-now" aria-label={RW.yourPartLabel}>
      <div className="hc-now-text">
        <p className="hc-part-k">{RW.yourPartLabel}</p>
        {part ? (
          <p className="hc-part">
            {part.before}{part.action ? <b className="hc-action">{part.action}</b> : null}{part.after}
          </p>
        ) : null}
        <div className="hc-status">
          {statusText ? <b><StatusText status={status} onReviewLate={onReviewLate} /></b> : null}
          {/* What the wall shows next (spec §3.5, first draft): only when given. */}
          {nextOnWall ? <p className="hc-next">{nextOnWall}</p> : null}
        </div>
      </div>
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
    </section>
  );
}
