/**
 * A small focusable "i" for advice a host needs once (copy pass fix, 2026-10-10).
 * A title on plain text cannot be reached by keyboard or touch, so the advice
 * is also visually hidden text the button points at (aria-describedby).
 */
import React from 'react';

let n = 0;
export default function InfoTip({ text, label = 'More' }) {
  const [id] = React.useState(() => { n += 1; return `brm-info-${n}`; });
  return (
    <>
      <button type="button" className="brm-info" aria-label={label} aria-describedby={id} title={text}>i</button>
      <span id={id} className="brm-sr">{text}</span>
    </>
  );
}
