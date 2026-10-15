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
  return (
    <section className="hc-panel">
      <p className="hc-kicker">{kicker}</p>
      <div className={`hc-cols${composer ? ' is-read' : ' is-one'}`}>
        <div className="hc-card">
          <h3 className="hc-card-h">{`${CW.readTitle} · ${CW.readOnWall}`}</h3>
          <MarkdownRenderer content={markdown || ''} className="hc-md" listItemAddon={askAddon} />
          {afterRead}
        </div>
        {composer}
      </div>
    </section>
  );
}
