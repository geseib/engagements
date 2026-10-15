import React from 'react';
import RW from '../../config/roundWords';
import HostActionBar from '../HostActionBar';

/**
 * THE CONSOLE'S FOOTER (spec §3.2): the moment's status, "Your part now", and
 * the existing HostActionBar (keys unchanged: Space, →, ←, the clicker, the
 * in-place second press). The footer states the count itself, so the bar's own
 * status line is handed an empty status: StatusMessage renders nothing for an
 * empty message, and one fact is never said twice.
 */
const NO_STATUS = Object.freeze({ text: '', tone: '' });

export default function ConsoleFooter({ status, part, controls, onAction, shortcutsEnabled, interceptAdvance, onBackKey }) {
  return (
    <footer className="hc-foot">
      <div className="hc-status"><b>{status && status.text}</b></div>
      {part ? (
        <p className="hc-part">
          <span className="hc-part-k">{RW.yourPartLabel}</span>
          {part.before}{part.action ? <b className="hc-action">{part.action}</b> : null}{part.after}
        </p>
      ) : null}
      <div className="hc-acts">
        {controls ? (
          <HostActionBar
            controls={{ ...controls, status: NO_STATUS }}
            onAction={onAction}
            shortcutsEnabled={shortcutsEnabled}
            interceptAdvance={interceptAdvance}
            onBackKey={onBackKey}
          />
        ) : null}
      </div>
    </footer>
  );
}
