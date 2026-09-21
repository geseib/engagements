import React, { useState } from 'react';
import Modal from './Modal';
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
      <header>
        <Icon name="NotePencil" weight="duotone" size={20} color="var(--primary)" />
        <div className="qsets-grow">
          <h2 id="qsets-new-title">New question set</h2>
          <p className="qsets-dim">Pick the kind of round, then generate it, start from a template, or upload a file.</p>
        </div>
        <button
          type="button"
          className="qs-dialog-close"
          onClick={requestClose}
          aria-label="Close new question set"
          title="Close"
          data-testid="newset-close"
        >
          ×
        </button>
      </header>

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

      <footer>
        <button type="button" className="qsets-btn" onClick={requestClose}>Close</button>
      </footer>
    </Modal>
  );
}
