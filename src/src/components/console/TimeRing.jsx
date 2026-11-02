import React from 'react';

/**
 * THE DRAINING RING (session-start D3/D4; experience plan 2f): time left as a
 * share of the time given, for the console's Time tile and the Remote's time
 * card. Decorative: the words beside it say the same thing, so it is hidden
 * from assistive technology. Colours come from the caller's stylesheet
 * (`.tring-track`, `.tring-fill`), never from here.
 */
const R = 16;
const C = 2 * Math.PI * R;

export default function TimeRing({ fraction = 0, up = false, className = '' }) {
  const f = Math.max(0, Math.min(1, Number(fraction) || 0));
  return (
    <svg
      className={`tring${up ? ' is-up' : ''}${className ? ` ${className}` : ''}`}
      viewBox="0 0 40 40"
      width="40"
      height="40"
      aria-hidden="true"
      focusable="false"
      data-fraction={f.toFixed(3)}
    >
      <circle className="tring-track" cx="20" cy="20" r={R} fill="none" strokeWidth="5" />
      <circle
        className="tring-fill"
        cx="20"
        cy="20"
        r={R}
        fill="none"
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray={`${(C * f).toFixed(2)} ${C.toFixed(2)}`}
        transform="rotate(-90 20 20)"
      />
    </svg>
  );
}
