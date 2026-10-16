// src/src/components/console/panels/ReadPanel.jsx
import React from 'react';
import MarkdownRenderer from '../../MarkdownRenderer';
import CW from '../../../config/consoleWords';

/**
 * Workie's read, as the host works with it (host console spec): the page the
 * wall shows, drawn with the same renderer, and — when the host opens Ask the
 * room — the composer beside it in the right column instead of a dialog.
 */
export default function ReadPanel({ kicker, markdown, askAddon = null, afterRead = null, composer = null }) {
  const read = (
    <div className="hc-card">
      <h3 className="hc-card-h">{`${CW.readTitle} · ${CW.readOnWall}`}</h3>
      <MarkdownRenderer content={markdown || ''} className="hc-md" listItemAddon={askAddon} />
      {afterRead}
    </div>
  );
  const kick = <p className="hc-kicker">{kicker}</p>;
  /* While composing, the kicker rides in the read's column so both columns
     start at the top of the main area: the composer can then be exactly the
     main area's height (HostConsole.css) and its Send never falls below the
     fold (walk, 15 Oct: Send at y≈1259 on a 768px laptop). */
  if (composer) {
    return (
      <section className="hc-panel is-composing">
        <div className="hc-cols is-read">
          <div className="hc-panel">{kick}{read}</div>
          {composer}
        </div>
      </section>
    );
  }
  return (
    <section className="hc-panel">
      {kick}
      <div className="hc-cols is-one">{read}</div>
    </section>
  );
}
