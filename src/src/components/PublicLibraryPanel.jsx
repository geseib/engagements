import React, { useState } from 'react';
import Modal from './Modal';
import QuestionSetsPanel from './QuestionSetsPanel';
import './PublicLibraryPanel.css';

/**
 * THE PUBLIC LIBRARY — docs/design/tenancy-redesign/07-public-library.html.
 *
 * Both consoles read the same rows (the public scope of the list) through the
 * same table (QuestionSetsPanel — filters, sorts, the two honest empty states)
 * and differ only in what a row offers: an organisation previews or copies;
 * Engage opens the score card or unpublishes. The copies column of the mockup
 * is out (D6). "Report a problem" (spec §10.6) arrives with reports, Stage 3.
 */
const COPY = {
  org: 'Sets other teams have published and had reviewed. Copying one makes your organisation its own copy — your own published sets appear here too.',
  platform: 'Everything organisations have published. Taking a set down removes it for everyone; the organisation keeps their copy and reads your note.',
};

/*
  UnpublishDialog MIRRORS ScoreCard's TakedownDialog (task-10) EXACTLY, not by
  coincidence — R16 and R17 are the same two rulings, on the same shape of
  action (remove a public set, require a note the organisation will read).
  Deviations from the brief's literal code block below are both load-bearing:

  R16 — closeOnBackdrop/closeOnEscape are gated on `!busy && !note.trim()`,
  not merely `!busy`. The brief's block only had `!busy`; that would let a
  half-typed note vanish on a stray Escape or an off-card click, which is the
  exact defect R16 exists to name. The X and the bottom Cancel stay live
  through the one `requestClose`, gated only on `busy` — a deliberate click
  is allowed to discard a draft on purpose.

  R17 — `busy`/`error` are LOCAL to the dialog, not props from this panel (the
  brief's block threaded a `busy` prop down and had no `error` at all). A
  rejected — or resolved-with-`{ error }` — `onUnpublish` must leave the
  dialog mounted, the note intact and the confirm button live for a retry,
  with the reason shown beside the note. That can only happen if the dialog
  survives its own confirm handler's catch block; a promise this panel awaits
  and only unwraps in `finally` cannot keep the dialog open on failure without
  also reaching back into this panel's state, which is what ScoreCard's
  `takeDown`/`TakedownDialog` split avoids. `confirmUnpublish` below resolves
  (and closes the dialog, from here) only on success, and throws — never
  touching this panel's own state — on failure, exactly as `ScoreCard.takeDown`
  documents it.

  The footer button reads "Cancel", not the brief's literal "Close" — the X
  carries the app's default `aria-label="Close"` (ScoreCard, ArchivePanel,
  ShareSetDialog, CreateOrgDialog, PrivacyPanel, TeamPanel, … all use it bare),
  and two controls in one dialog answering to the same accessible name is not
  two exits — it is one exit `getByRole('button', { name })` cannot pick
  between (the exact defect ModerationPanel's `.modq-x` comment names, from
  task-9, resolved there the other way round by renaming the X instead). R16's
  own wording — "the X and the bottom Cancel" — says which control keeps which
  name here, and ScoreCard already made the same choice.
*/
function UnpublishDialog({ set, onClose, onConfirm }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const requestClose = () => { if (!busy) onClose(); };

  const handleConfirm = async () => {
    setBusy(true); setError(null);
    try {
      await onConfirm(note.trim());
    } catch (e) {
      setError(e.message || 'Could not unpublish it.');
      setBusy(false);
    }
  };

  return (
    <Modal overlayClassName="publib publib-scrim" contentClassName="publib-dialog" labelledBy="publib-title" onClose={requestClose} closeOnBackdrop={() => !busy && !note.trim()} closeOnEscape={() => !busy && !note.trim()}>
      <header className="publib-head">
        <h2 id="publib-title">Unpublish “{set.name}”?</h2>
        <button type="button" className="publib-x" onClick={requestClose} aria-label="Close" title="Close" disabled={busy}>×</button>
      </header>
      <div className="publib-body">
        <p>It is gone for everyone. The organisation keeps their copy and sees your note in their editor.</p>
        <label className="publib-label" htmlFor="publib-note">Note to the organisation (required)</label>
        <textarea id="publib-note" className="publib-textarea" rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        {error && <div className="publib-outage" role="alert">{error}</div>}
      </div>
      <footer className="publib-foot">
        <button type="button" className="publib-btn" onClick={requestClose} disabled={busy}>Cancel</button>
        <button type="button" className="publib-btn publib-btn--danger" onClick={handleConfirm} disabled={busy || !note.trim()}>Unpublish</button>
      </footer>
    </Modal>
  );
}

export default function PublicLibraryPanel({ questionSets = [], mode = 'org', onCopy, onPreview, onOpenScoreCard, onUnpublish, loading = false }) {
  const [unpublishing, setUnpublishing] = useState(null);
  const rows = questionSets.filter((s) => (s.scope || 'platform') === 'public');

  const rowActions = (set) => (mode === 'platform' ? (
    <div className="qsets-rowact">
      <button type="button" className="qsets-btn qsets-btn--sm" onClick={() => onOpenScoreCard && onOpenScoreCard(set.id)}>Score card</button>
      <button type="button" className="qsets-btn qsets-btn--sm qsets-btn--ghostdanger" onClick={() => setUnpublishing(set)} title="Remove it for everyone; the organisation keeps their copy">Unpublish</button>
    </div>
  ) : (
    <div className="qsets-rowact">
      <button type="button" className="qsets-btn qsets-btn--sm" onClick={() => onPreview && onPreview(set)} title="Read it. Saving from there makes your organisation its own copy.">Preview</button>
      <button type="button" className="qsets-btn qsets-btn--sm qsets-btn--primary" onClick={() => onCopy && onCopy(set)} title="Take a copy now, without opening it">Copy to my team</button>
      {/* Stage 3: Report a problem (spec §10.6). */}
    </div>
  ));

  // Resolves on success (closing the dialog itself, here); THROWS on failure
  // rather than touching this panel's own state — a failed unpublish is the
  // dialog's problem to show, beside the note, with the confirm live for a
  // retry, not a reason to unmount the dialog and lose what was typed (R17).
  // A resolved `{ error }` is folded into the same throw, so the dialog does
  // not have to tell rejection and a soft failure apart.
  const confirmUnpublish = async (note) => {
    const result = await onUnpublish(unpublishing, note);
    if (result && result.error) throw new Error(result.error);
    setUnpublishing(null);
  };

  return (
    <section className="publib" data-theme="dark">
      <p className="publib-note">{COPY[mode] || COPY.org}</p>
      {rows.length === 0 && !loading ? (
        <p className="publib-empty">Nobody has published a set yet. When an organisation shares one and it passes review, it appears here.</p>
      ) : (
        <QuestionSetsPanel questionSets={rows} loading={loading} rowActions={rowActions} />
      )}
      {unpublishing && <UnpublishDialog set={unpublishing} onClose={() => setUnpublishing(null)} onConfirm={confirmUnpublish} />}
    </section>
  );
}
