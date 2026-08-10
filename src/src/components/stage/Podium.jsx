import React from 'react';
import { podiumEntries } from '../../config/podium';

/**
 * The top three, on the room's screen.
 *
 * A component rather than markup inside GameHostPage.jsx because that file
 * cannot be mounted in jsdom — it dies on the auth provider — and the one
 * assertion this surface most needs is that it renders NOTHING while
 * authorship is withheld. That has to be rendered to be believed.
 *
 * IT TAKES THE GATE'S INPUTS, NOT ITS ANSWER. Handing it a pre-computed list
 * would move the decision back into the page and out of reach of a test, which
 * is the exact shape the gate must not have.
 *
 * `data-attribution="revealed"` is required, not decorative: audit check A13
 * fails any stage document carrying a roster name without it. It is safe to
 * declare unconditionally here because the component only ever reaches this
 * line when `podiumEntries` has already found the reveal to have happened —
 * the attribute and the gate are the same condition.
 *
 * NO `data-drop`. The mockup marks its podium as the first thing sacrificed;
 * this is content, and fitPolicy.js sacrifices chrome before content. A podium
 * that vanishes on the densest results screen is worse than no podium, because
 * the host has already promised it to the room.
 */
export default function Podium(props) {
  const entries = podiumEntries(props);
  if (!entries.length) return null;

  return (
    <div className="podium" data-attribution="revealed">
      {entries.map((entry) => (
        <div className="pod" key={`${entry.rank}-${entry.name}`}>
          <div className="pl">{entry.label}</div>
          <span className="nm">{entry.name}</span>
          <div className="sc">{entry.score.toLocaleString()}</div>
        </div>
      ))}
    </div>
  );
}
