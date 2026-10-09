/**
 * RESEARCH… AND IDEAS… (talking points T2): one small window each. A one-line
 * subject, filled in from the open ask (or Claude's last step), and Send to
 * Claude. Claude hands it to a helper and keeps building, so the window sends
 * and closes at once. The window's Send is the one orange button while it is
 * open. Ctrl or Cmd Enter sends.
 *
 * Claude not connected is not a refusal: the request waits and the chip on the
 * panel says so. This window says it too, before the host presses Send.
 */
import React, { useState } from 'react';
import Modal from '../components/Modal';
import Icon from '../components/Icon';
import { W } from './words';

const SUBJECT_MAX = 200;

export default function BuildPointRequest({ kind, initial = '', connected, busy, onSend, onClose }) {
  const [subject, setSubject] = useState(initial);
  const ideas = kind === 'ideas';
  const title = ideas ? W.ideasTitle : W.researchTitle;
  const ready = subject.trim().length > 0;
  const send = async () => {
    if (!ready || busy) return;
    const ok = await onSend(kind, subject.trim());
    if (ok !== undefined) onClose();
  };
  const onKey = (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); }
  };
  return (
    <Modal overlayClassName="brm-scrim" contentClassName="brm-modal brm-modal--sm brm-modal--point" onClose={onClose} closeOnBackdrop={() => !busy} closeOnEscape={() => !busy} labelledBy="brm-preq-title">
      <div className="brm-dh">
        <h2 className="brm-h" id="brm-preq-title">{title}</h2>
        <button type="button" className="brm-x" aria-label={W.close} onClick={onClose}><Icon name="X" size={16} /></button>
      </div>
      <label className="brm-field">
        <span className="brm-lbl">{ideas ? W.ideasLabel : W.researchLabel}</span>
        <input
          className="brm-input" value={subject} maxLength={SUBJECT_MAX} autoFocus
          onChange={(e) => setSubject(e.target.value)} onKeyDown={onKey}
        />
      </label>
      <p className="brm-hint">{ideas ? W.ideasNote : W.researchNote}</p>
      {!connected && <p className="brm-hint brm-hint--warn" role="status">{W.claudeAway}</p>}
      <div className="brm-row brm-gap">
        <button type="button" className="brm-btn brm-btn--ghost" onClick={onClose}>{W.close}</button>
        <span className="brm-say is-keys brm-push" title={W.ctrlEnterTitle}>{W.ctrlEnterSends}</span>
        <button type="button" className="brm-btn brm-btn--primary" disabled={busy || !ready} onClick={send}>{W.sendToClaudeNow}</button>
      </div>
    </Modal>
  );
}
