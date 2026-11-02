import React from 'react';
import Modal from './Modal';
import { DialogHead, DialogFoot } from './ui/DialogParts';
import HelpButton from './HelpButton';
import { helpFor } from '../config/help/screens';
import './QuestionSetEditor.css';
import './AIBuilderDialog.css';

/**
 * THE ONE WINDOW THE FOUR AI BUILDERS OPEN IN (experience plan §5.1 "Dialog",
 * Phase 5 step 5e; audit E §1.5 Q2).
 *
 * Trivia, Poll, Survey and the scenario builder were four different products:
 * four raw `div.modal-overlay` + `.modal-content` shells (white paper inside a
 * dusk console), four Title Case headings, an X styled four ways, no Escape and
 * no focus trap. They are now one shell:
 *
 *   - `Modal` for the behaviour: Escape, the Tab trap, scroll lock, focus
 *     restore, and DOM-containment topmost — so the small confirm a builder
 *     asks from inside itself answers Escape before the builder does.
 *   - `ui/DialogParts` for the head (title, Icon X, the AI builders' help) and
 *     the foot (each builder's way back on the left, its action on the right).
 *   - DUSK, declared on the overlay (`theme="dark"`), never inherited: opened
 *     from the console, from the host's shelf and from the set editor's Add
 *     questions, and the last one portals to document.body, where it would
 *     otherwise resolve to `<html data-theme="light">`.
 *   - `.qs-editor` on the card, ON PURPOSE: the builders' forms are the same
 *     paper controls the set editor borrows (`.form-group`, the round-kind
 *     picker, the status banner, the sub-components' `.btn-*`), and
 *     QuestionSetEditor.css is where their dusk re-inking is already measured.
 *     `.aib` (AIBuilderDialog.css) adds what only the builders draw.
 *
 * Every way out — the X, the backdrop, Escape and each builder's Cancel — goes
 * through the builder's own `requestClose`, which asks (useConfirm) only when
 * something would be lost.
 */
export default function AIBuilderDialog({
  /** 'trivia' | 'poll' | 'survey' | 'scenario' — a modifier class, nothing more. */
  kind,
  titleId,
  title,
  sub = null,
  icon = null,
  /** The builder's requestClose. */
  onClose,
  closeLabel = 'Close the generator',
  /** The foot's way back (left) and its actions (right), per step. */
  cancel = null,
  actions = null,
  className = '',
  children,
}) {
  return (
    <Modal
      overlayClassName={`ui-scrim aib-scrim aib-scrim--${kind}`}
      contentClassName={`ui-dialog ui-dialog--full qs-editor aib aib--${kind}${className ? ` ${className}` : ''}`}
      theme="dark"
      labelledBy={titleId}
      onClose={onClose}
    >
      <DialogHead
        className="aib-head"
        titleId={titleId}
        title={title}
        sub={sub}
        icon={icon}
        onClose={onClose}
        closeLabel={closeLabel}
        closeClassName="aib-close"
        closeProps={{ 'data-testid': 'aib-close', title: 'Close' }}
      >
        {/* The AI builders' guide (Help Phase 3), beside the X. */}
        <HelpButton {...helpFor('ai-builders')} variant="inline" size="small" tooltip="Help: AI builders" className="help-button-quiet" />
      </DialogHead>
      <div className="ui-dialog-body aib-body">{children}</div>
      <DialogFoot className="aib-foot" cancel={cancel}>{actions}</DialogFoot>
    </Modal>
  );
}
