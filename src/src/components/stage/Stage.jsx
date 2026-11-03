import React, { useEffect, useRef } from 'react';
import { PROFILES, profileClass } from '../../config/displayProfile';
import useStageFit from '../../hooks/useStageFit';
import useChromeAutoHide from '../../hooks/useChromeAutoHide';
import PhaseBar from './PhaseBar';

/**
 * The stage shell — the `.stage` CSS grid and its four grid areas (rail,
 * bar, main, dock). Ported (as CSS, via ../../styles/stage.css) and markup
 * from docs/design/host-redesign/02-ask-call-and-answer.html:766-774.
 *
 * The profile class goes on `document.documentElement`, not a wrapper. The
 * four display-profile ladders are declared on `:root`; a class on a div
 * would leave every custom property substituting against `:root`'s own
 * values, which is exactly how the earlier scalar approach rendered all
 * four profiles identically. Cleaned up on unmount, because nothing else
 * removes a class living on the document root.
 *
 * `phase` drives the persistent `.bar` signal (via PhaseBar) directly,
 * since Stage already owns that prop. `children` is the main content column.
 *
 * NAMED SLOTS (the Task 5 ruling). `rail`, `meter` and `dock` are optional
 * nodes. Stage owns the grid areas, so without them the caller has nowhere to
 * put a Rail; with them the caller composes
 *
 *   <Stage rail={<Rail …/>} meter={<RoomMeter …/>} dock={<Dock …/>}>{content}</Stage>
 *
 * A supplied slot REPLACES the empty placeholder rather than nesting inside
 * it — Rail already renders `<header class="rail">` and Dock already renders
 * `<footer class="dock">`, so wrapping them would produce two nested elements
 * carrying the same grid area, double padding, and two boxes for the fitter's
 * `.rail` query to chew on. `meter` has no placeholder: it is a column of
 * `.main`, not a grid area of `.stage`, and `.main.solo` collapses that column
 * when there is nothing to put in it.
 *
 * `overlay` is the stage's own top layer — the scoreboard
 * (components/stage/scoreboard/Scoreboard.jsx), which covers the rail, bar and
 * main rows and leaves the dock live. It is a grid item of `.stage` rather
 * than a fixed element beside it, so it is part of what the room sees and
 * inherits the stage's dusk tokens, and it sits outside `.content`, so the
 * fitter never measures it.
 *
 * `fitKey` exists because the fitter's deps live here but the content that
 * changes lives in the caller. Without it a question arriving, an answer list
 * growing or a reveal flipping would re-render the stage and never re-measure
 * it, because `profile` and `phase` are unchanged.
 */
/*
 * THE HOST'S FRAME ON THE STAGE (experience plan §3.2, §3.3, Phase 2 step 2h).
 * `top`, `now` and `needs` are three more optional rows ABOVE the rail: the
 * top bar (components/console/ConsoleTop.jsx), "Your part now" (a Dock given
 * `lead`) and the Needs-you line, in that order, so on one screen the main
 * button sits under the top bar exactly where the console has it. Each is
 * host chrome in its own dusk wrapper (data-theme="dark": <html> is paper)
 * and none is inside `.main`, so the fitter never scales them; it measures
 * `.main`'s box, which is whatever these rows leave. With `now` given there is
 * no bottom dock and no empty placeholder for one: the `dock` row is then 0px
 * tall, and the height it held (13vh) goes back to the content.
 *
 * A caller passing none of the three (the Build Room's stage, an event's
 * agenda wall, the survey walk-through) gets the stage exactly as it was: the
 * empty rows collapse to nothing.
 */
/*
 * THE CHROME STEPS ASIDE ON ONE SCREEN (owner, 3 Nov 2026; hooks/
 * useChromeAutoHide.js). `autoHide` is the caller's "this laptop is the room's
 * screen": after a few seconds without the mouse, the frame's rows and any
 * `.fn-controls` fade (`data-chrome="hidden"`, styles/stage.css) and come back
 * when the mouse moves. Never on two screens: that laptop is private and its
 * chrome is the host's to read. `chromeHold` is a sheet or menu the page has
 * open. THE ROWS KEEP THEIR HEIGHT: only opacity changes, so `.main`'s box and
 * the fitter's scale are the same shown and hidden, and the room never sees
 * the stage move (measured in Chromium, 1280x720 and 1920x1080, Room and TV:
 * collapsing the rows would refit by up to 28% and lift the question by 67 to
 * 178px on every show and hide; floating them over a full-height stage would
 * cover the rail, code and all, every time the mouse moved).
 *
 * `urgent` is the count of Needs-you items at Now. While the chrome is hidden
 * it draws a small cue in the corner where the bell sits: a dot and the count,
 * never a name (the same count the public line shows), so the host knows to
 * reach for the mouse. Decorative: the line under it keeps its own live
 * region, which a screen reader still reads with the chrome faded.
 */
export default function Stage({
  profile, phase, rail = null, strip = null, view = null, meter = null, dock = null, overlay = null, fitKey = '',
  top = null, now = null, needs = null, autoHide = false, chromeHold = false, urgent = 0, children,
}) {
  const stageRef = useRef(null);

  useStageFit(stageRef, [profile, phase, fitKey]);

  const hasChrome = Boolean(top || now || needs);
  const chromeHidden = useChromeAutoHide({ enabled: Boolean(autoHide) && hasChrome, hold: chromeHold, rootRef: stageRef });

  useEffect(() => {
    const root = document.documentElement;
    const cls = profileClass(profile);
    PROFILES.forEach((p) => root.classList.remove(`d-${p}`));
    root.classList.add(cls);
    return () => root.classList.remove(cls);
  }, [profile]);

  /**
   * THE DOCUMENT DOES NOT SCROLL WHILE THE STAGE IS UP.
   *
   * The owner's report on the pager that shipped: *"no way to scroll down, as
   * the entire page scrolls down."* Both halves of that are one bug. `.stage`
   * is `height:100dvh; overflow:hidden`, but it is mounted inside
   * `.main-layout{min-height:100vh}` — and `dvh` is the SMALL viewport while
   * `vh` is the LARGE one, so on any browser showing a collapsible toolbar the
   * document is taller than the stage and Down scrolls it. What moves is the
   * whole stage, chrome and all: the dock slides off the bottom, `.content`
   * carries its clipped content along unchanged, and not one word that was cut
   * off becomes readable. It is motion that looks like scrolling and recovers
   * nothing, which is worse than a key that does nothing at all — a host
   * pressing Down sees the screen move and concludes the content is reachable.
   *
   * Locking it is the fix, not a mitigation. A stage that cannot scroll is the
   * premise the whole fitter/pager design rests on: content that does not fit
   * is PAGED, and anything that offers a second, silent way to move content is
   * a way for content to be lost off a projector no one in the room can drive.
   *
   * SEPARATE FROM THE PROFILE EFFECT ABOVE, and `[]` rather than `[profile]`,
   * so switching profile cannot leave a window in which the lock is off. It is
   * scoped to this component's life rather than declared in the stylesheet
   * because the host page's other full-screen views — the session report, the
   * reports list — replace the stage entirely and DO scroll; a rule on `:root`
   * in stage.css would take their scrollbar away with no way to give it back.
   * Overlays keep their own `max-height:90vh; overflow-y:auto`, so nothing that
   * scrolls today stops.
   */
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add('stage-locked');
    return () => root.classList.remove('stage-locked');
  }, []);

  return (
    <main
      className="stage"
      ref={stageRef}
      data-chrome={autoHide && hasChrome ? (chromeHidden ? 'hidden' : 'shown') : undefined}
    >
      <div className="field" aria-hidden="true" />
      {top ? <div className="stage-top" data-theme="dark">{top}</div> : null}
      {now ? <div className="stage-now" data-theme="dark">{now}</div> : null}
      {needs ? <div className="stage-needs" data-theme="dark">{needs}</div> : null}
      {rail || <div className="rail" />}
      <PhaseBar phase={phase} />
      {/* The workflow strip (session flow v3 §4.6): host-only, in its own row
          so the fitter's measure of `.main` already leaves room for it. */}
      {strip}
      <div className={`main${meter ? '' : ' solo'}`}>
        {children}
        {meter}
      </div>
      {/* A step the host is looking at (session flow v3 §4.8): over `.main`,
          which stays mounted underneath and keeps its place. */}
      {view}
      {dock || (now ? null : <div className="dock" />)}
      {overlay}
      {autoHide && chromeHidden && urgent > 0 ? (
        <div className="stage-cue" data-theme="dark" aria-hidden="true" data-testid="stage-chrome-cue">
          <span className="stage-cue-dot" />
          <span className="stage-cue-n">{urgent}</span>
        </div>
      ) : null}
    </main>
  );
}
