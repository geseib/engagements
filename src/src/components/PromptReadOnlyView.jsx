import React from 'react';
import Modal from './Modal';
import { promptOwnerTag, ENGAGE, PUBLIC } from '../utils/setOwnerTag';

/**
 * A PROMPT, READ-ONLY — what opens from a row outside Engage mode.
 *
 * The owner, 2026-09-24: "the workie advisor and ai prompts should be only in
 * the engage mode for now. team admins could view them." Both libraries
 * (Workie results prompts and question-set generation prompts) mount this in
 * place of their editor when `readOnly`: the text, shown as text — no field
 * to type in, no Save that the server would refuse (admin/shared/
 * prompt-access.js refuses every prompt write outside Engage mode).
 *
 * `parts` is the caller's, because the two libraries store different halves:
 * `[{ label, text }]`, rendered in order, empty ones left out.
 */

/** The sentence both libraries say at the top, and the view repeats. */
export const PROMPTS_READ_ONLY_NOTE = 'Engage’s AI prompts. Only Engage staff can change them.';

const LIBRARY_LABEL = {
  [ENGAGE]: 'Engage',
  [PUBLIC]: 'Public',
};

/** Which library a prompt row is in, as a reader would say it. */
export const promptLibraryLabel = (prompt) => LIBRARY_LABEL[promptOwnerTag(prompt)] || 'Your team';

/** The hover text on that word — what it means for the reader. */
export const promptLibraryTitle = (prompt) => (
  promptOwnerTag(prompt) === ENGAGE || promptOwnerTag(prompt) === PUBLIC
    ? 'Engage’s prompt. Every organisation reads it; only Engage staff change it.'
    : 'Your team’s own Workie. It still runs in your sessions, and cannot be changed for now.'
);

export default function PromptReadOnlyView({ prompt, parts = [], facts = [], onClose }) {
  if (!prompt) return null;
  const shownParts = parts.filter((p) => String(p.text || '').trim());
  const shownFacts = [
    { label: 'Library', value: promptLibraryLabel(prompt) },
    ...facts,
  ].filter((f) => f.value);

  return (
    <Modal
      overlayClassName="pmgr-scrim"
      contentClassName="pmgr-modal pmgr-modal--wide"
      onClose={onClose}
      labelledBy="pmgr-view-title"
    >
      <div className="pmgr-modal-head">
        <h2 id="pmgr-view-title">{prompt.name}</h2>
        <button type="button" className="pmgr-x" onClick={onClose} aria-label="Close this prompt">
          ×
        </button>
      </div>

      <div className="pmgr-view-body" data-testid="pmgr-view-body">
        <p className="pmgr-view-note">{PROMPTS_READ_ONLY_NOTE}</p>
        {prompt.description && <p className="pmgr-view-desc">{prompt.description}</p>}
        <dl className="pmgr-view-facts">
          {shownFacts.map((f) => (
            <div key={f.label} className="pmgr-view-fact">
              <dt>{f.label}</dt>
              <dd>{f.value}</dd>
            </div>
          ))}
        </dl>
        {shownParts.map((p) => (
          <section key={p.label} className="pmgr-view-part">
            <h3>{p.label}</h3>
            <pre className="pmgr-view-text">{p.text}</pre>
          </section>
        ))}
      </div>

      <div className="pmgr-view-foot">
        <button type="button" className="btn-secondary" onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}
