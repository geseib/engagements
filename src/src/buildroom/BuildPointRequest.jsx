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

/** The plugin that answers mockups and walkthrough requests (build-store MOCKUPS_PLUGIN). */
export const MOCKUPS_PLUGIN = '1.27.0';
/** True when `running` is a version older than `want` ("1.26.1" < "1.27.0"). */
export function olderPlugin(running, want = MOCKUPS_PLUGIN) {
  if (!running) return false;
  const a = String(running).split('.').map(Number);
  const b = String(want).split('.').map(Number);
  for (let i = 0; i < 3; i += 1) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) < (b[i] || 0);
  return false;
}

export default function BuildPointRequest({ kind, initial = '', ideaId = '', connected, busy, onSend, onClose, plugin = '' }) {
  const [subject, setSubject] = useState(initial);
  const [count, setCount] = useState(3);
  const ideas = kind === 'ideas';
  const mockups = kind === 'mockups';
  const walk = kind === 'walkthrough';
  const title = mockups ? W.mockupsTitle : walk ? W.walkthroughTitle : ideas ? W.ideasTitle : W.researchTitle;
  // ASK CLAUDE (ideas flow E): an older plugin cannot answer these; say so rather than send.
  const old = (mockups || walk) && olderPlugin(plugin);
  const ready = !old && (walk || subject.trim().length > 0);
  const send = async () => {
    if (!ready || busy) return;
    const ok = await onSend(kind, subject.trim(), mockups ? { count, ...(ideaId ? { ideaId } : {}) } : {});
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
        <span className="brm-lbl">{mockups ? W.mockupsLabel : walk ? W.walkthroughLabel : ideas ? W.ideasLabel : W.researchLabel}</span>
        <input
          className="brm-input" value={subject} maxLength={SUBJECT_MAX} autoFocus
          onChange={(e) => setSubject(e.target.value)} onKeyDown={onKey}
        />
      </label>
      {mockups && (
        <div className="brm-field">
          <span className="brm-lbl">{W.mockupsHowMany}</span>
          <div className="brm-seg" role="radiogroup" aria-label={W.mockupsHowMany}>
            {[2, 3].map((n) => (
              <button key={n} type="button" role="radio" aria-checked={count === n} className={`brm-segbtn${count === n ? ' is-on' : ''}`} onClick={() => setCount(n)}>{n}</button>
            ))}
          </div>
        </div>
      )}
      <p className="brm-hint">{mockups ? W.mockupsNote : walk ? W.walkthroughNote : ideas ? W.ideasNote : W.researchNote}</p>
      {old && <p className="brm-hint brm-hint--warn" role="status">{W.updatePluginFor(MOCKUPS_PLUGIN)}</p>}
      {!connected && <p className="brm-hint brm-hint--warn" role="status">{W.claudeAway}</p>}
      <div className="brm-row brm-gap">
        <button type="button" className="brm-btn brm-btn--ghost" onClick={onClose}>{W.close}</button>
        <span className="brm-say is-keys brm-push" title={W.ctrlEnterTitle}>{W.ctrlEnterSends}</span>
        <button type="button" className="brm-btn brm-btn--primary" disabled={busy || !ready} onClick={send}>{W.sendToClaudeNow}</button>
      </div>
    </Modal>
  );
}
