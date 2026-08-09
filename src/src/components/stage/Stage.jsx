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
 * since Stage already owns that prop. The rail and dock areas carry no
 * per-state content in this task — wiring Rail/RoomMeter/Dock's real data
 * into them is Task 5's job, in GameHostPage. `children` is the main
 * content column.
 */
export default function Stage({ profile, phase, children }) {
  const stageRef = useRef(null);

  useStageFit(stageRef, [profile, phase]);

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
      <div className="rail" />
      <PhaseBar phase={phase} />
      <div className="main">{children}</div>
      <div className="dock" />
    </main>
  );
}
