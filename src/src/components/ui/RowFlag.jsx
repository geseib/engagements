import React from 'react';
import './RowFlag.css';

/**
 * RowFlag — the flag on a row (experience plan §5.1 "Flag on a row", step 5a).
 *
 *   <RowFlag ago="2 min ago">wants their name on a new device</RowFlag>
 *   <RowFlag tone="calm">away</RowFlag>
 *
 * An amber dot plus words, never a colour alone: "wants their name on a new
 * device", "away", "joined 2 min ago". Replaces the ad-hoc chip each surface
 * drew for the same fact. Person rows use it (components/people/PersonRow.jsx)
 * for a name request; the row's own amber edge says "needs you", the flag says
 * what.
 *
 * tone  'needs' (default) the amber dot (--accent), the words in --text
 *       'calm'  a muted dot, the words in --muted (a fact, not a request)
 * ago   optional, muted, after a middle dot.
 *
 * Text only: the buttons the flag asks for (Let them / Not now) are the
 * caller's, beside it, so the same flag reads the same in every list.
 */
export const ROW_FLAG_TONES = ['needs', 'calm'];

export default function RowFlag({ tone = 'needs', ago = '', className = '', children, ...rest }) {
  const t = ROW_FLAG_TONES.includes(tone) ? tone : 'needs';
  return (
    <span className={['ui-flag', `ui-flag--${t}`, className].filter(Boolean).join(' ')} {...rest}>
      <span className="ui-flag-dot" aria-hidden="true" />
      <span className="ui-flag-words">{children}</span>
      {ago ? <span className="ui-flag-ago">{` · ${ago}`}</span> : null}
    </span>
  );
}
