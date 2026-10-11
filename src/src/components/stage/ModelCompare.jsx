import React, { useEffect, useRef, useState } from 'react';
import Modal from '../Modal';
import MarkdownRenderer from '../MarkdownRenderer';
import { useKeepOnScreen } from '../../buildroom/keepOnScreen';
import './ModelCompare.css';

/**
 * DEV'S AI MODEL PICKER, STAFF ONLY: "Redo with…" and Compare.
 *
 * Drawn in the Session panel's Workie section, never on the stage, and only
 * when the server said the picker is on (useModelPicker: dev's AiModelPicker
 * and the `admins` group). Redo with a model writes that model's read of the
 * round beside the room's, which it never replaces; Compare lists each
 * model's latest read side by side, stacked when the window is narrow, each
 * with a one-line footer of what it took.
 *
 * No orange here: the Session panel already has its one.
 */

const PROVIDER_WORDS = { bedrock: 'Bedrock', anthropic: 'Anthropic API' };

/** Fallback reasons in words a host can read. */
const FALLBACK_WORDS = {
  'not-connected': 'Anthropic API not connected',
  'sts-error': 'AWS sign-in token refused',
  'token-exchange': 'Anthropic sign-in refused',
  timeout: 'timed out',
  'rate-limit': 'rate limited',
  credit: 'out of credit',
  overloaded: 'overloaded',
  auth: 'not authorised',
  refusal: 'declined to answer',
  'empty-reply': 'empty reply',
  'api-error': 'API error',
  network: 'network error',
  'access-denied': 'no Bedrock access',
  'bedrock-validation': 'Bedrock refused the request',
  'model-error': 'model error',
};

const groupDigits = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** The one-line footer under a model's read. */
export function footerLine(v) {
  const parts = [v.modelRequestedLabel || v.modelLabel || v.modelRequested || 'Unknown model'];
  if (v.provider) parts.push(PROVIDER_WORDS[v.provider] || v.provider);
  if (Number.isFinite(v.latencyMs)) parts.push(`${(v.latencyMs / 1000).toFixed(1)} s`);
  if (Number.isFinite(v.inputTokens) && Number.isFinite(v.outputTokens)) {
    parts.push(`${groupDigits(v.inputTokens)} in / ${groupDigits(v.outputTokens)} out`);
  }
  if (Number.isFinite(v.costUsd)) {
    parts.push(v.costUsd < 0.001 ? 'under $0.001' : `about $${v.costUsd.toFixed(3)}`);
  }
  if (v.modelFallbackReason) {
    const why = FALLBACK_WORDS[v.modelFallbackReason] || v.modelFallbackReason;
    parts.push(`fell back to ${v.modelLabel || 'Haiku 4.5'}: ${why}`);
  }
  if (v.fallback) parts.push('template, not a model read');
  return parts.join(' · ');
}

/** "Redo with…" and "Compare", for WorkieSettings. */
export function ModelPickerControls({ picker }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);
  const anchorRef = useRef(null);
  useKeepOnScreen(menuRef, open);
  // A click outside the menu, or Escape, closes it.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (anchorRef.current && !anchorRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  if (!picker || !picker.info) return null;
  const models = picker.info.models || [];
  const busy = Object.keys(picker.pending || {}).length;

  const choose = (id) => {
    setOpen(false);
    picker.redoWith(id);
  };

  return (
    <div className="mcmp-controls" data-testid="model-picker">
      <div className="setup-row mcmp-anchor" ref={anchorRef}>
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          data-testid="model-redo-with"
          onClick={() => setOpen((o) => !o)}
        >
          Redo with…
        </button>
        <button type="button" data-testid="model-compare" onClick={picker.openCompare}>
          {busy ? `Compare (${busy} writing)` : 'Compare'}
        </button>
        {open && (
          <div className="mcmp-menu" role="menu" ref={menuRef} aria-label="Write this read again with">
            {models.map((m) => (
              <button
                key={m.id}
                type="button"
                role="menuitem"
                className="mcmp-menu__item"
                disabled={m.available === false}
                title={m.available === false ? m.unavailableReason : `About $${m.priceIn} in / $${m.priceOut} out per million tokens`}
                onClick={() => choose(m.id)}
              >
                <span className="mcmp-menu__label">{m.label}{m.isDefault ? ' (default)' : ''}</span>
                <span className="mcmp-menu__meta">
                  {m.available === false ? m.unavailableReason : (PROVIDER_WORDS[m.provider] || m.provider)}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      <p className="setup-note">Staff, dev only. Writes a second read beside the room&apos;s; the room keeps seeing its own.</p>
      {picker.error && <p className="setup-note setup-note--warn" role="status">{picker.error}</p>}
      {picker.compareOpen && (
        <ModelCompare
          variants={picker.variants}
          pending={picker.pending}
          models={models}
          onClose={picker.closeCompare}
        />
      )}
    </div>
  );
}

/** Every model's latest read of the round, side by side. */
export default function ModelCompare({ variants = [], pending = {}, models = [], onClose }) {
  const labelOf = (id) => (models.find((m) => m.id === id) || {}).label || id;
  const writing = Object.keys(pending).filter((id) => !variants.some((v) => v.modelRequested === id
    && v.generatedAt && Date.parse(v.generatedAt) >= pending[id] - 2000));

  return (
    <Modal
      overlayClassName="mcmp-scrim"
      contentClassName="mcmp"
      onClose={onClose}
      label="Compare model reads"
      theme="dark"
    >
      <div className="mcmp-head">
        <h2 className="mcmp-title">Compare model reads</h2>
        <button type="button" className="mcmp-x" aria-label="Close" onClick={onClose}>×</button>
      </div>
      {variants.length === 0 && writing.length === 0 ? (
        <p className="mcmp-empty">
          No model reads of this round yet. Use Redo with… to write one.
        </p>
      ) : (
        <div className="mcmp-grid">
          {variants.map((v) => (
            <section className="mcmp-col" key={v.modelRequested} data-testid={`variant-${v.modelRequested}`}>
              <h3 className="mcmp-col__head">{v.modelRequestedLabel || v.modelLabel}</h3>
              <div className="mcmp-col__body">
                {writing.includes(v.modelRequested) && <p className="mcmp-writing">Writing a new read…</p>}
                <MarkdownRenderer content={v.markdownResponse || v.summary || ''} className="mcmp-md" />
              </div>
              <p className="mcmp-foot" data-testid="variant-footer">{footerLine(v)}</p>
            </section>
          ))}
          {writing.filter((id) => !variants.some((v) => v.modelRequested === id)).map((id) => (
            <section className="mcmp-col" key={id} data-testid={`variant-${id}`}>
              <h3 className="mcmp-col__head">{labelOf(id)}</h3>
              <p className="mcmp-writing">Writing…</p>
            </section>
          ))}
        </div>
      )}
      <div className="mcmp-actions">
        <button type="button" className="mcmp-btn" onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}
