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
 *
 * `kbd` is the key that also fires the primary — "SPACE" in every mockup dock,
 * on every state. It has to be rendered HERE and not left to HostActionBar,
 * which hides its own `__kbd` under `.big-screen-mode`, the mode the dock
 * always passes: without this the affordance is invisible in all four
 * profiles, which is the state the `.dock .kbd` note in ../../styles/stage.css
 * was written to prevent. It sits immediately after the primary, as it does in
 * the mockups, and it is aria-hidden because it is a visual affordance for the
 * operator, not a control.
 */
export default function Dock({ status, hint, kbd, onSetup, complete = false, children }) {
  return (
    <footer className="dock">
      {status && <span className={`status${complete ? ' go' : ''}`} aria-live="polite">{status}</span>}
      <span className="spacer" />
      {children}
      {kbd && <span className="kbd" aria-hidden="true">{kbd}</span>}
      {hint && <span className="hint">{hint}</span>}
      {/*
        LAST IN THE DOCK, AND ON PURPOSE.

        The mockup put this first, at the far left, while the panel it opens is
        `right: 0`. So the host clicked bottom-left and a surface appeared on
        the far side of a projected screen — a long way to travel with a room
        watching, and no cue that the two were the same thing. The control now
        sits at the edge it opens from.

        It reads SESSION, not SETUP. Setup is something you do once, before
        anybody arrives; this panel is where the host sees who is in the room,
        which question comes next, and how the session is running, all of it
        mid-round. The panel's own heading stays "Session setup" because that
        is what the Settings tab does — the button names the whole thing.
        Still not "Console": user testing killed the proper noun.

        No `⋯` beside the word. The glyph and the label said the same thing
        inside one 48px target, and the whole argument for adding the label
        was that the glyph alone was unhittable.
      */}
      <button
        type="button"
        className="dock-more"
        onClick={onSetup}
        aria-label="Session panel"
        title="Session panel — backslash key"
      >
        <span className="dock-more-lbl">SESSION</span>
      </button>
    </footer>
  );
}
