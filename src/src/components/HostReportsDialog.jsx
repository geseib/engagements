import React from 'react';
import Modal from './Modal';
import Icon from './Icon';
import ReportsPanel from './ReportsPanel';

/**
 * THE HOST'S REPORTS — the same list the console shows, in the host's dialog
 * shell (the one "Your question sets" uses), declared dusk for the same
 * reason that one is: from the welcome screen this overlay is a sibling of
 * `.wel-page` and would otherwise resolve to `<html data-theme="light">`.
 */
export default function HostReportsDialog({ onClose }) {
  return (
    <Modal
      overlayClassName="qsets qsets-scrim qsets-scrim--over"
      contentClassName="qsets-modal qsets-modal--wide qsets-modal--shelf"
      labelledBy="hrp-title"
      onClose={() => onClose && onClose()}
      theme="dark"
    >
      <header>
        <Icon name="FileText" weight="duotone" size={20} color="var(--primary)" />
        <div className="qsets-grow">
          <h2 id="hrp-title">Your reports</h2>
          <p className="qsets-dim">Saved from a session's report screen. They stay after the session has expired.</p>
        </div>
        <button
          type="button"
          className="qs-dialog-close"
          onClick={() => onClose && onClose()}
          aria-label="Close your reports"
          title="Close your reports"
          data-testid="hrp-close"
        >
          ×
        </button>
      </header>
      <div className="qsets-modal-body">
        <ReportsPanel />
      </div>
      <footer>
        <button type="button" className="qsets-btn" onClick={() => onClose && onClose()}>Close</button>
      </footer>
    </Modal>
  );
}
