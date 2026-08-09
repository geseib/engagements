import React from 'react';

/**
 * The dock — the `.dock` grid area, and the room's one persistent action
 * strip. This is a GRID ROW, not a fixed overlay. `position:fixed`
 * guarantees the control is *visible*; a grid row guarantees it is
 * *placed* — it cannot be covered by a rail, clipped by a
 * `height:100vh;overflow:hidden` ancestor (the exact bug documented at
 * ../../styles.css:7190), or reach a state where reserved padding fights
 * the content. It reserves `--dock-h` per profile through the `.dock` rule
 * in ../../styles/stage.css.
 *
 * The primary action is not reimplemented here — it is whatever the caller
 * passes as children, in practice the existing HostActionBar rendered with
 * `bigScreen`. Its keyboard handling, its typing-target guard and its
 * disabled-hint behaviour are untouched; only its positioning CSS changes,
 * because HostActionBar's own big-screen-mode rule already goes static
 * inside a container like this one.
 *
 * `status` and `hint` are optional, room-safe text — the sentence the room
 * needs (e.g. "Some are still answering") and, separately, the room-safe
 * explanation the big screen shows in place of HostActionBar's own
 * disabled-hint (which HostActionBar hides in big-screen mode, because a
 * host-facing hint like "Waiting on 3 more" is a private instruction, not
 * something to project). Neither renders an empty element when absent.
 */
export default function Dock({ status, hint, onSetup, children }) {
  return (
    <footer className="dock">
      <button
        type="button"
        className="dock-more"
        onClick={onSetup}
        aria-label="Session setup"
        title="Session setup"
      >
        <span aria-hidden="true">⋯</span>
        <span className="dock-more-lbl">SETUP</span>
      </button>
      {status && <span className="status" aria-live="polite">{status}</span>}
      <span className="spacer" />
      {children}
      {hint && <span className="hint">{hint}</span>}
    </footer>
  );
}
