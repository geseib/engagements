import React, { useState } from 'react';
import Modal from './Modal';
import QuestionSetsPanel from './QuestionSetsPanel';
import { shareStateOf } from '../utils/shareState';
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

  /*
    `busy` is cleared in `finally`, not only in `catch`. On the success path
    the parent unmounts this dialog, so the clear is usually a no-op — but
    "usually" is the whole problem: it made the dialog's own correctness depend
    on what its parent does next. A caller whose `onConfirm` resolves without
    closing (a soft failure folded into a resolve, a future confirm-and-stay)
    would leave the confirm button disabled for ever with no way back.
    React 18 treats a state update on an unmounted component as a no-op, so
    the ordinary path costs nothing.
  */
  const handleConfirm = async () => {
    setBusy(true); setError(null);
    try {
      await onConfirm(note.trim());
    } catch (e) {
      setError(e.message || 'Could not unpublish it.');
    } finally {
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

/*
  THE WAY IN — the owner's report: *"there is a new set button on the admin page
  for public library. it does not seem to do anything. im thinking it should say
  add or share. and when you click it it brings up a list of all your (whichever
  view you are in) with a share button next to it."*

  What was there was QuestionSetsPanel's header "New set", wired to an
  `onCreate` this panel has never passed — a filled primary button whose click
  handler short-circuited. That button is now gated on its handler (see
  QuestionSetsPanel), and this is what replaces it.

  IT IS A MODAL, AND THE CONTAINER RULE SAYS SO. Choosing one of your own sets
  is doing one thing, and the thing being judged — your organisation's sets — is
  not the thing on screen, which is the public library's rows. That is exactly
  the case docs/design/admin-container-rule.md sends to a dialog rather than
  inline, and both exits are here: the X and the footer Cancel, one
  `onClose`. There is nothing unsaved to guard, so neither is gated.

  IT NEVER OPENS A MODAL FROM INSIDE A MODAL. `pick` closes this dialog in the
  same handler that calls `onShare`, so the share dialog the caller opens
  replaces it rather than stacking on it.

  IT CARRIES `qsets` ON THE CARD, DELIBERATELY. Modal renders no portal, so this
  card is a child of `.publib`, and every `.qsets-chip--vis-*` colour is
  `var(--qsets-…)` — locals declared on `.qsets` and nowhere else. An undefined
  custom property invalidates the whole declaration (QuestionSetsPanel.css:58),
  so a share chip drawn outside that scope would silently lose its colour and
  its border. QuestionSetUploadPanel and QuestionSetDeleteDialog solve it the
  same way: carry the scope class on your own root.
*/
function SharePickerDialog({ sets, onClose, onPick }) {
  return (
    <Modal overlayClassName="publib publib-scrim" contentClassName="publib-dialog qsets" labelledBy="publib-pick-title" onClose={onClose}>
      <header className="publib-head">
        <h2 id="publib-pick-title">Which set do you want to share?</h2>
        <button type="button" className="publib-x" onClick={onClose} aria-label="Close" title="Close">×</button>
      </header>
      <div className="publib-body">
        <p>
          Sharing submits a set&rsquo;s active version for the content check. If it passes, a copy
          of it joins the library below — yours stays yours, and editing it later changes nothing
          out here until you share again.
        </p>
        {sets.length === 0 ? (
          <p className="publib-empty">
            You have no sets of your own yet. Ones you make on the Question sets screen appear here.
          </p>
        ) : (
          <ul className="publib-list">
            {sets.map((set) => {
              /* `canShare` is true here and nowhere conditionally: every row
                 this dialog draws has the Share button two lines down, so the
                 drift chip's "Click Share to share the latest version" names a
                 control the reader is looking at. */
              const vis = shareStateOf(set, undefined, { canShare: true });
              return (
                <li key={set.id} className="publib-item">
                  {/* ONE TEXT NODE, so text-overflow is not inert on it (design
                      rule 8), and the `title` is the recovery the truncation
                      owes the reader (rule 7). */}
                  <span className="publib-item-nm" title={set.name}>{set.name}</span>
                  <span className={`qsets-chip qsets-chip--vis-${vis.key}`} title={vis.title}>{vis.label}</span>
                  <button
                    type="button"
                    className="publib-btn publib-btn--sm"
                    onClick={() => onPick(set)}
                    /* The row action's own words, because it is the row action's
                       own path — QuestionSetsPanel's Share and this one both
                       call the caller's `onShare`. */
                    title="Submit the active version for the content check; it goes public if it passes"
                  >
                    Share
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <footer className="publib-foot">
        <button type="button" className="publib-btn" onClick={onClose}>Cancel</button>
      </footer>
    </Modal>
  );
}

export default function PublicLibraryPanel({ questionSets = [], mode = 'org', onCopy, onPreview, onShare, onOpenScoreCard, onUnpublish, loading = false, notice = null, onDismissNotice }) {
  const [unpublishing, setUnpublishing] = useState(null);
  const [picking, setPicking] = useState(false);
  const rows = questionSets.filter((s) => (s.scope || 'platform') === 'public');
  /*
    THE SETS THIS ORGANISATION MAY SUBMIT — the same predicate the list row's
    own Share button uses (`canManage !== false`, from
    admin/shared/question-set-access.js via get-question-sets.js), so the picker
    can never offer a set whose own row would not, and never offers a row that
    is already somebody else's public copy.
  */
  const mine = questionSets.filter((s) => s.canManage !== false && (s.scope || 'platform') === 'org');

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
  // `onUnpublish &&` for the same reason as onCopy/onPreview/onOpenScoreCard
  // above: every callback into this panel is optional, and an unguarded one
  // turns a caller's omission into a TypeError thrown inside a dialog whose
  // own error path would then render "onUnpublish is not a function" to a
  // reviewer. Absent, the dialog simply closes, which is what the guarded
  // siblings do too — nothing happened, and nothing claims to have.
  const confirmUnpublish = async (note) => {
    const result = onUnpublish && await onUnpublish(unpublishing, note);
    if (result && result.error) throw new Error(result.error);
    setUnpublishing(null);
  };

  /*
    Closing FIRST, then calling out: the caller's `onShare` opens ShareSetDialog,
    and two dialogs over one another is the pattern admin-container-rule.md
    forbids. React commits both state changes together, so the picker is gone in
    the same paint the share dialog arrives in.
  */
  const pick = (set) => { setPicking(false); if (onShare) onShare(set); };

  return (
    <section className="publib" data-theme="dark">
      <p className="publib-note">{COPY[mode] || COPY.org}</p>
      {/*
        ORG CONSOLES ONLY, and gated on the handler rather than on `mode`.
        Engage's own library does not go through this pipeline at all —
        admin/check-question-set.js is explicit that a platform set publishes
        nothing ("There is no public copy of an Engage set") — so the staff
        console gets no way in rather than one that would be refused.

        ABOVE the table, so it is still there when the library is empty, which
        is the moment somebody most wants to put the first set into it.
      */}
      {onShare && (
        <div className="publib-bar">
          <button type="button" className="publib-btn publib-btn--primary" onClick={() => setPicking(true)}>
            Share a set
          </button>
        </div>
      )}
      {rows.length === 0 && !loading ? (
        <p className="publib-empty">Nobody has published a set yet. When an organisation shares one and it passes review, it appears here.</p>
      ) : (
        /* `notice` is what the last Copy said back — including a copy refused
           at the stored-set allowance. It used to go only to the Question sets
           list, a screen not on show, so a copy from here said nothing. */
        <QuestionSetsPanel questionSets={rows} loading={loading} rowActions={rowActions} notice={notice} onDismissNotice={onDismissNotice} />
      )}
      {unpublishing && <UnpublishDialog set={unpublishing} onClose={() => setUnpublishing(null)} onConfirm={confirmUnpublish} />}
      {picking && <SharePickerDialog sets={mine} onClose={() => setPicking(false)} onPick={pick} />}
    </section>
  );
}
