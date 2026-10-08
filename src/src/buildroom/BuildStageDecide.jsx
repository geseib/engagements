/**
 * DECIDING ON THE STAGE (docs/design/build-room-history-and-stage-decide R4, R5).
 *
 * The Send to Claude panel as a window over the Stage: switch the pick, look at
 * a mockup, edit the words, choose how Claude gets it, then Send, Save for
 * later, Re-ask or Discard. Re-ask turns the same window into the question,
 * filled in from this ask; Back returns to the send panel with everything
 * kept. X and Esc close without changing anything.
 *
 * The window is one mounted component, so the pick and the typed direction
 * live here and survive the mockup viewer opening over it (Back returns here).
 * It is on the projector: room-safe words only, no names, no host notes.
 */
import React, { useContext, useState } from 'react';
import Modal from '../components/Modal';
import Icon from '../components/Icon';
import { ViewerContext } from './MockupViewer';
import {
  CLAUDE_KINDS, decideBody, decisionChoices, directionFor, pickVerdict, roomChoice,
} from './buildScreens';

const askNo = (askId) => Number(askId) || askId;
const MAX_OPTIONS = 6;
const letterOf = (i) => String.fromCharCode(65 + i);

/** The reask form starts from this ask; a tie's own "A tie between..." line is not the host's wording. */
function reaskStart(ask) {
  return {
    prompt: ask.prompt || '',
    detail: /^A tie\b/.test(ask.detail || '') ? '' : ask.detail || '',
    options: (ask.options || []).map((o) => ({ title: o.title || '', detail: o.detail || '', url: o.url || '' })),
  };
}

export default function BuildStageDecide({ ask, busy, run, api, onClose }) {
  const openViewer = useContext(ViewerContext);
  const start = roomChoice(ask);
  const room = start.chosen[0] || null;
  const [mode, setMode] = useState('send'); // send | reask
  const [pick, setPick] = useState(room);
  const [direction, setDirection] = useState(start.direction);
  const [as, setAs] = useState(ask.claudeGets || 'do-now');
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState(() => reaskStart(ask));

  const choices = decisionChoices(ask);
  const verdict = pick ? pickVerdict(ask, pick) : null;
  const alternate = verdict && !verdict.isPreferred && verdict.preferred ? verdict : null;
  const total = (ask.results && ask.results.total) || 0;

  const switchTo = (id) => {
    setPick(id);
    setDirection(directionFor(ask, id));
    setError('');
  };

  /** Run a call; its failure is said here, in plain words, and the window stays as it was. */
  const attempt = async (fn, failed) => {
    setError('');
    const out = await run(async () => {
      try { return await fn(); } catch (e) { setError(failed); throw e; }
    });
    return out;
  };

  const decide = async (kind) => {
    const out = await attempt(
      () => api.askAction(ask.askId, decideBody(ask, { direction, chosen: pick ? [pick] : [], as: kind })),
      'That did not send. Nothing changed; try again.',
    );
    if (out !== undefined) onClose();
  };
  const discard = async () => {
    const out = await attempt(() => api.askAction(ask.askId, { action: 'discard' }), 'That did not discard. Nothing changed; try again.');
    if (out !== undefined) onClose();
  };

  // The ask's own detail and options only go when this kind has them.
  const filled = form.options.filter((o) => o.title.trim());
  const reaskReady = Boolean(form.prompt.trim()) && (ask.kind !== 'choice' || filled.length >= 2);
  const askAgain = async () => {
    const body = {
      prompt: form.prompt.trim(),
      detail: form.detail.trim(),
      ...(ask.kind === 'choice' ? { options: filled.map((o) => ({ title: o.title.trim(), detail: o.detail.trim(), url: o.url.trim() })) } : {}),
    };
    const out = await attempt(() => api.reask(ask.askId, body), 'That did not ask again. Your question is still here; try again.');
    if (out !== undefined) onClose();
  };
  const setOpt = (i, patch) => setForm((f) => ({ ...f, options: f.options.map((o, j) => (j === i ? { ...o, ...patch } : o)) }));

  const sendLabel = CLAUDE_KINDS.find((k) => k.key === as);
  const cannot = busy || !direction.trim();
  const pictured = (id) => (ask.kind === 'choice' ? (ask.options || []).find((o) => o.label === id && o.imageId) : null);

  if (mode === 'reask') {
    return (
      <Modal overlayClassName="brm-scrim" contentClassName="brm-modal brm-modal--sd" onClose={onClose} closeOnBackdrop={false} labelledBy="brm-sd-title">
        <div className="brm-pa-head">
          <div>
            <div className="brm-pa-eb">Ask {askNo(ask.askId)} · re-ask</div>
            <h2 className="brm-pa-q" id="brm-sd-title">Ask the room again</h2>
          </div>
          <button type="button" className="brm-x" onClick={onClose} aria-label="Close this window"><Icon name="X" size={16} /></button>
        </div>
        <div className="brm-sd-body">
          <label className="brm-field"><span className="brm-lbl">Question</span>
            <input className="brm-input" value={form.prompt} maxLength={300} onChange={(e) => setForm((f) => ({ ...f, prompt: e.target.value }))} />
          </label>
          <label className="brm-field"><span className="brm-lbl">Context (optional)</span>
            <textarea className="brm-input brm-ta brm-ta--sm" value={form.detail} maxLength={2000} onChange={(e) => setForm((f) => ({ ...f, detail: e.target.value }))} />
          </label>
          {ask.kind === 'choice' && (
            <div className="brm-field">
              <span className="brm-lbl">Options</span>
              {form.options.map((o, i) => (
                <div className="brm-optedit" key={i}>
                  <span className={`brm-letter brm-letter--${i % 3}`} aria-hidden="true">{letterOf(i)}</span>
                  <div className="brm-optfields">
                    <input className="brm-input" aria-label={`Option ${letterOf(i)}`} value={o.title} maxLength={120} onChange={(e) => setOpt(i, { title: e.target.value })} />
                  </div>
                  {form.options.length > 2
                    ? <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" aria-label={`Remove option ${letterOf(i)}`} onClick={() => setForm((f) => ({ ...f, options: f.options.filter((_, j) => j !== i) }))}><Icon name="X" size={14} /></button>
                    : <span />}
                </div>
              ))}
              {form.options.length < MAX_OPTIONS && (
                <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" onClick={() => setForm((f) => ({ ...f, options: [...f.options, { title: '', detail: '', url: '' }] }))}>
                  <Icon name="Plus" size={14} /> Add an option
                </button>
              )}
              <span className="brm-hint">A mockup stays with the option that keeps its words.</span>
            </div>
          )}
          {error && <p className="brm-alert" role="alert">{error}</p>}
        </div>
        <div className="brm-sd-foot">
          <button type="button" className="brm-btn brm-btn--ghost" onClick={() => { setError(''); setMode('send'); }}>
            <Icon name="ArrowLeft" size={14} /> Back to Send to Claude
          </button>
          <button type="button" className="brm-btn brm-btn--primary brm-push" disabled={busy || !reaskReady} onClick={askAgain}>Ask again</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal overlayClassName="brm-scrim" contentClassName="brm-modal brm-modal--sd" onClose={onClose} closeOnBackdrop={false} labelledBy="brm-sd-title">
      <div className="brm-pa-head">
        <div>
          <div className="brm-pa-eb">Ask {askNo(ask.askId)} · results</div>
          <h2 className="brm-pa-q" id="brm-sd-title">Send to Claude</h2>
        </div>
        <button type="button" className="brm-x" onClick={onClose} aria-label="Close this window"><Icon name="X" size={16} /></button>
      </div>
      <div className="brm-sd-body">
        <p className="brm-sd-q">{ask.prompt}</p>
        {choices.length > 0 && (
          <ul className="brm-sd-opts" aria-label="Choices">
            {choices.map((c) => {
              const pic = pictured(c.id);
              return (
                <li key={c.id} className={`brm-sd-opt${pick === c.id ? ' is-on' : ''}`}>
                  <button type="button" className="brm-sd-pick" aria-pressed={pick === c.id} onClick={() => switchTo(c.id)}>
                    {c.label && <span className="brm-letter brm-letter--sm" aria-hidden="true">{c.label}</span>}
                    <span className="brm-sd-t">{c.text}{c.id === room ? " · the room's choice" : ''}</span>
                  </button>
                  {pic && openViewer && (
                    <button type="button" className="brm-btn brm-btn--link" aria-label={`View mockup ${c.label}`} onClick={() => openViewer(ask.askId, c.label, 'stage-edit')}>view mockup</button>
                  )}
                  <b className="brm-sd-n">{c.count}</b>
                </li>
              );
            })}
          </ul>
        )}
        {ask.kind === 'rating' && (
          <p className="brm-sd-q">The room&apos;s rating: <b>{ask.results && ask.results.rating && ask.results.rating.avg !== null ? ask.results.rating.avg : 'none yet'}</b> ({total} answered)</p>
        )}
        {alternate && (
          <div className="brm-notice" role="status" data-testid="brm-alternate">
            <b>You picked an alternate.</b> The room preferred {alternate.preferred.label ? `${alternate.preferred.label} · ` : ''}{alternate.preferred.text}{alternate.by === 'wheel' ? ' (where the wheel landed)' : ''}. This goes on the record as your pick.
          </div>
        )}
        <textarea className="brm-input brm-ta brm-dirbox" aria-label="Direction for Claude" value={direction} maxLength={2000} onChange={(e) => setDirection(e.target.value)} placeholder="What should Claude do now?" />
        <div className="brm-field">
          <span className="brm-lbl">Claude gets it as</span>
          <div className="brm-seg brm-seg--kinds" role="radiogroup" aria-label="Claude gets it as">
            {CLAUDE_KINDS.map((k) => (
              <button key={k.key} type="button" role="radio" aria-checked={as === k.key} className={`brm-segbtn${as === k.key ? ' is-on' : ''}`} title={k.hint} onClick={() => setAs(k.key)}>{k.label}</button>
            ))}
          </div>
          <span className="brm-hint">{sendLabel.hint}</span>
        </div>
        {error && <p className="brm-alert" role="alert">{error}</p>}
      </div>
      <div className="brm-sd-foot">
        <button type="button" className="brm-btn brm-btn--ghostdanger" disabled={busy} onClick={() => setConfirmDiscard(true)}>Discard</button>
        <button type="button" className="brm-btn brm-btn--ghost" disabled={busy} onClick={() => setMode('reask')}>Re-ask…</button>
        <button type="button" className="brm-btn brm-btn--ghost" onClick={onClose}>Close</button>
        <button type="button" className="brm-btn brm-push" disabled={cannot} onClick={() => decide('later')}>Save for later</button>
        <button type="button" className="brm-btn brm-btn--primary" disabled={cannot} onClick={() => decide(as)}>Send to Claude</button>
      </div>
      {confirmDiscard && (
        <Modal overlayClassName="brm-scrim" contentClassName="brm-modal brm-modal--sm" onClose={() => setConfirmDiscard(false)} closeOnBackdrop={false} labelledBy="brm-sd-discard">
          <div className="brm-dh">
            <h2 className="brm-h" id="brm-sd-discard">{`Discard Ask ${askNo(ask.askId)}? The votes stay in History.`}</h2>
            <button type="button" className="brm-x" aria-label="Close" onClick={() => setConfirmDiscard(false)}><Icon name="X" size={16} /></button>
          </div>
          <div className="brm-row brm-gap">
            <button type="button" className="brm-btn brm-btn--ghost" onClick={() => setConfirmDiscard(false)}>Keep it</button>
            <button type="button" className="brm-btn brm-btn--dangersolid brm-push" disabled={busy} onClick={discard}>Discard</button>
          </div>
        </Modal>
      )}
    </Modal>
  );
}
