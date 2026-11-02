import React, { useState } from 'react';
import HelpButton from './HelpButton';
import { helpFor } from '../config/help/screens';
import Modal from './Modal';
import { DialogHead, DialogFoot } from './ui/DialogParts';
import Icon from './Icon';
import QuestionSetUploadPanel from './QuestionSetUploadPanel';

/**
 * "NEW SET" IS A DIALOG, LIKE EVERY OTHER MAKE-ONE-THING ACTION HERE.
 *
 * What it replaces: the creation panel was appended BELOW the set table and
 * scrolled itself into view — with forty-one rows above it, pressing New looked
 * like nothing had happened. The design skill names that exact pattern as the
 * rejected one (container rule: make/edit one thing → Modal), and
 * docs/handoff/create-set-experience-2026-09-18.md §3.1 records the decision:
 * "the entry becomes a dialog, not a panel below the table."
 *
 * A GENTLE FIRST STEP, on the owner's instruction: the CONTENT is the existing
 * `QuestionSetUploadPanel`, unchanged, so nothing about how a set is made moves
 * in this change — only where it is presented. The one-screen AI builder in
 * docs/design/create-set-redesign is a later step.
 *
 * NEVER A MODAL FROM A MODAL. Choosing "Generate with AI" opens a builder, which
 * is itself a dialog — so this one closes first and hands over, rather than
 * stacking a second scrim on its own.
 *
 * EVERY EXIT IS ONE FUNCTION. The X, the footer button, Escape and the backdrop
 * all go through `requestClose`, which asks first when a file or a title would
 * be lost.
 */
export default function NewSetDialog({ onClose, onOpenBuilder, onUploaded, ...panelProps }) {
  const [dirty, setDirty] = useState(false);

  const requestClose = () => {
    if (dirty && !window.confirm('Close without importing? The file and the details you entered will be lost.')) return;
    if (onClose) onClose();
  };

  return (
    <Modal
      overlayClassName="qsets qsets-scrim"
      contentClassName="qsets-modal qsets-modal--create"
      labelledBy="qsets-new-title"
      onClose={requestClose}
      /* Backdrop and Escape are free exits only while nothing would be lost. */
      closeOnBackdrop={() => !dirty}
      closeOnEscape={() => !dirty}
    >
      <DialogHead titleId="qsets-new-title" title="New question set" titlesClassName="qsets-grow" sub="Pick the kind of round, then generate it, start from a template, or upload a file." subClassName="qsets-dim" icon={<Icon name="NotePencil" weight="duotone" size={20} color="var(--primary)" />} onClose={requestClose} closeLabel="Close new question set" closeClassName="qs-dialog-close" closeProps={{ 'data-testid': "newset-close" }}>
        {/* The question-sets guide's new-set section (Help Phase 3). */}
        <HelpButton {...helpFor('admin-new-set')} variant="inline" size="small" tooltip="Help: new question set" className="help-button-quiet" />
      </DialogHead>

      <div className="qsets-modal-body">
        <QuestionSetUploadPanel
          {...panelProps}
          bare
          onDirtyChange={setDirty}
          onOpenBuilder={(type) => {
            // Hand over, never stack: the builder is a dialog of its own.
            if (onClose) onClose();
            if (onOpenBuilder) onOpenBuilder(type);
          }}
          onUploaded={(...args) => {
            if (onUploaded) onUploaded(...args);
          }}
        />
      </div>

      <DialogFoot>
        <button type="button" className="qsets-btn" onClick={requestClose}>Close</button>
      </DialogFoot>
    </Modal>
  );
}
