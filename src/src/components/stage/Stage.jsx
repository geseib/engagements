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
