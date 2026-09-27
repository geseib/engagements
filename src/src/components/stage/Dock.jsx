import React, { useLayoutEffect, useRef } from 'react';
import CompletionFlag from './CompletionFlag';

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
 *
 * ---------------------------------------------------------------------------
 * `progress` — WHERE THE ANSWERED / VOTED COUNT GOES WHEN THE METER'S COLUMN IS
 * TAKEN AWAY. This is the fix for a reported defect and the reasoning matters,
 * because the behaviour it changes was deliberate.
 *
 * The fitter enters the meter into the ordered sacrifice at priority -1, ahead
 * of every content group (hooks/fitPolicy.js), and `widen()` surrenders the
 * column by setting `.main.solo` and `meter.hidden = true`. CHROME BEFORE
 * CONTENT is correct and is not being reversed here — width is the cheapest
 * lever on the stage and an answer must never be thrown away to keep a column.
 *
 * What was wrong is that surrendering the COLUMN also deleted the COUNT, and
 * those are not the same thing. The column is 210-460px of horizontal stage;
 * the fraction is seven characters. Measured against the mockups with the
 * shipped fitter, at 1280x720 Room, TV and Call all lose the meter on
 * `05-vote`, and TV loses it on `03-ask-trivia` at 1920x1080 as well — which is
 * precisely the owner's report that "the larger views also don't have the
 * player counts for answered/voted". The bigger the ladder, the sooner the
 * content overflows, and the first thing sacrificed is the number the host is
 * waiting on.
 *
 * So the column still goes and the count moves here, into a row that is already
 * a fixed-height flex line with a `.spacer` in it — zero additional content
 * height, zero column width.
 *
 * EXACTLY ONE OF THE TWO IS EVER VISIBLE, and the switch is CSS, not React.
 * Audit check A12 fails a viewport that states progress more than once, so this
 * mirror is `display:none` until `.main[data-auto-solo="1"] ~ .dock` matches —
 * `data-auto-solo` being the attribute `widen()` already sets and `unwiden()`
 * already clears. Driving it off the fitter's own attribute means React never
 * has to learn what the fitter decided, and the two can never disagree; see
 * ../../styles/stage.css, where the rule and this argument are repeated next to
 * the selector.
 * ---------------------------------------------------------------------------
 */
/**
 * THE LAST RESORT WHEN THE DOCK IS CROWDED. The key hints give way first, by
 * width, in ../../styles/stage.css; an event's AGENDA chip adds a 94px target,
 * so they give way sooner there (`data-agenda`). If the row still runs past the
 * edge, the dock takes a second line — the portrait tablet's layout — rather
 * than clipping SESSION off the screen, which is what it did at 1280x720 on a
 * closed survey's feedback beat in an event (measured in Chromium, 27 Sep
 * 2026). Measured, not guessed from a breakpoint, because the labels change
 * with every beat: the attribute is cleared, the row measured unwrapped, and
 * set again only if it overflows — so it can never hold itself in place.
 */
function useCrowded(ref, deps) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const fit = () => {
      el.removeAttribute('data-crowded');
      if (el.scrollWidth > el.clientWidth + 1) el.setAttribute('data-crowded', '');
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
}

export default function Dock({
  status, hint, kbd, onSetup, onAgenda, complete = false, progress = null, children,
}) {
  const ref = useRef(null);
  useCrowded(ref, [status, hint, kbd, onSetup, onAgenda, progress, children]);
  return (
    <footer className="dock" ref={ref} data-agenda={onAgenda ? '' : undefined}>
      {status && <span className={`status${complete ? ' go' : ''}`} aria-live="polite">{status}</span>}
      {progress && (progress.heading || progress.body) && (
        <span
          className={`dock-progress${progress.complete ? ' done' : ''}`}
          data-progress-mirror=""
        >
          <b className="lbl">{progress.heading}</b>
          <span className="val">{progress.body}</span>
          {progress.complete && <CompletionFlag />}
        </span>
      )}
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

        HIDDEN WHEN THERE IS NOTHING FOR IT TO OPEN (fix round 1, M1). Every
        caller on the live stage has a session panel and passes `onSetup`;
        `SurveyWalkthrough.jsx` does not, and an unconditional button here was
        a live-looking control wired to nothing once it stopped being the
        only caller.
      */}
      {/*
        AN EVENT'S ITEM (events M3, roadmap D5): the way back to the event's
        agenda, beside SESSION and shaped like it. Part-way through, the item
        pauses; once it has ended, it ends. Only where there is an event.
      */}
      {onAgenda && (
        <button
          type="button"
          className="dock-more"
          onClick={onAgenda}
          aria-label="Back to the event's agenda"
          title="Back to the event's agenda — the item pauses, and resumes where it left off"
        >
          <span className="dock-more-lbl">AGENDA</span>
        </button>
      )}
      {onSetup && (
        <button
          type="button"
          className="dock-more"
          onClick={onSetup}
          aria-label="Session panel"
          title="Session panel — backslash key"
        >
          <span className="dock-more-lbl">SESSION</span>
        </button>
      )}
    </footer>
  );
}
