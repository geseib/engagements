import React from 'react';
import Modal from './Modal';
import { DialogHead, DialogFoot } from './ui/DialogParts';
import HelpButton from './HelpButton';
import { helpFor } from '../config/help/screens';
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
      <DialogHead titleId="hrp-title" title="Reports" titlesClassName="qsets-grow" sub="Saved from a session's report screen. They stay after the session has expired." subClassName="qsets-dim" icon={<Icon name="FileText" weight="duotone" size={20} color="var(--primary)" />} onClose={() => onClose && onClose()} closeLabel="Close Reports" closeClassName="qs-dialog-close" closeProps={{ 'data-testid': "hrp-close" }}>
        {/* The reporting guide's saved-reports help (Help Phase 3). */}
        <HelpButton {...helpFor('host-reports')} variant="inline" size="small" tooltip="Help: reports" className="help-button-quiet" />
      </DialogHead>
      <div className="qsets-modal-body">
        <ReportsPanel />
      </div>
      <DialogFoot>
        <button type="button" className="qsets-btn" onClick={() => onClose && onClose()}>Close</button>
      </DialogFoot>
    </Modal>
  );
}
