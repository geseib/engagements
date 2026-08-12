import React, { useEffect, useRef } from 'react';
import { PROFILES, profileClass } from '../../config/displayProfile';
import useStageFit from '../../hooks/useStageFit';
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
 * `fitKey` exists because the fitter's deps live here but the content that
 * changes lives in the caller. Without it a question arriving, an answer list
 * growing or a reveal flipping would re-render the stage and never re-measure
 * it, because `profile` and `phase` are unchanged.
 */
export default function Stage({
  profile, phase, rail = null, meter = null, dock = null, fitKey = '', children,
}) {
  const stageRef = useRef(null);

  useStageFit(stageRef, [profile, phase, fitKey]);

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
    <main className="stage" ref={stageRef}>
      <div className="field" aria-hidden="true" />
      {rail || <div className="rail" />}
      <PhaseBar phase={phase} />
      <div className={`main${meter ? '' : ' solo'}`}>
        {children}
        {meter}
      </div>
      {dock || <div className="dock" />}
    </main>
  );
}
