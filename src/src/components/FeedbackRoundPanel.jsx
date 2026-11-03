import React, { useCallback, useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import RoundReport from './RoundReport';
import { MAX_COMMENT, anchorLabelShown, plainOf } from '../config/comments';
import './FeedbackRoundPanel.css';

/**
 * A FEEDBACK ROUND, ON THE PARTICIPANT'S OWN DEVICE.
 *
 * The owner: *"there is a new round where every one can comment on what they
 * have heard, they should have a copy of the feedback report (the same item
 * that is avail when you click the previous round in the session rounds screen.
 * so they can read, copy paste. in fact there should be like in chat response
 * they click on a section (the summary, the results, a specific user response)
 * and the comments now can be seen in the resulting round of feedback"*.
 *
 * ── THE PRINCIPLE THIS LOOKS LIKE IT BREAKS ────────────────────────────────
 *
 * The player's phone is deliberately not a second projector.
 * `player-redesign/17-results-call.html`: *"Names are on the main screen now.
 * The top responses and the discussion prompts are up there too — this page
 * will not repeat them."* `19-between-rounds.html` opens *"Nothing to do
 * here."*
 *
 * That rule holds, and reading it precisely is what makes this surface
 * legitimate: the phone does not duplicate the stage WHILE THE PARTICIPANT HAS
 * NO TASK. In a feedback round they have one, and it cannot happen anywhere
 * else — the report is here because it is the substrate of the work, not
 * because it is being mirrored.
 *
 * ── WHY A COMPONENT AND NOT ANOTHER BRANCH IN PlayerPage ───────────────────
 *
 * `PlayerPage.jsx` does not mount under jsdom — it dies on the auth provider —
 * so everything in it is asserted by reading source. A surface that collects
 * customer prose ABOUT NAMED PEOPLE should be testable by rendering it and
 * clicking it, so it lives here and the page holds a branch.
 *
 * ── PHASE 3b: EVERY ACTION NAMES ITS TARGET (docs/design/phone-comments) ───
 *
 * The owner, 1 Nov 2026: *"how do we know which response they are commenting
 * on"*. The report is laid out in three sections by RoundReport's phone layout
 * (RoundReportSections.jsx), each action inside the thing it is about. The
 * composer is a docked sheet that names its target three ways at once (D4):
 * its heading ("Reply to Priya Shah's response"), a quote of the target, and
 * the target's card outlined on the page behind. Switching target with words
 * in the box asks first; closing with words asks first (D5); a post says where
 * it landed, inside that card (D6).
 *
 * The anchor still travels from the tap rather than being re-derived on submit,
 * and a response is anchored by its BALLOT number (backend B1), so a reply on a
 * tied response stays on the row that was tapped, on every surface.
 */

/** Which target a draft belongs to: its kind and, for a response, its ref. */
const draftKeyOf = (anchor) => `${anchor.anchorKind}#${anchor.anchorRef ?? ''}`;

/** The name rule under the box (phone-comments D4), word for word. */
export const NAME_RULE_SHOWN = 'Your name is shown with this comment. Everyone in the session can read it, and the host may put it on the room’s screen.';
export const NAME_RULE_HIDDEN = 'Your name is not shown with this comment.';

/** A saved anchor from before 3b carries no sheet words; give it some. */
function withSheetWords(anchor) {
  if (!anchor || anchor.heading) return anchor;
  if (anchor.anchorKind === 'summary') {
    return {
      ...anchor, targetKey: 'summary', noun: 'comment', heading: 'Comment on Workie’s read',
      quoteHead: 'Workie’s read', targetName: 'Workie’s read', isWorkie: true,
      sentLead: 'Comment posted', sentRest: 'under Workie’s read.',
    };
  }
  if (anchor.anchorKind === 'results') {
    return {
      ...anchor, targetKey: 'round', noun: 'comment', heading: 'Comment on the whole round',
      quoteHead: 'The whole round', targetName: 'the whole round',
      sentLead: 'Comment posted', sentRest: 'on the whole round.',
    };
  }
  const label = anchorLabelShown(anchor) || 'this response';
  return {
    ...anchor, noun: 'reply', heading: `Reply to ${label}`, quoteHead: label, targetName: label,
    sentLead: 'Reply posted', sentRest: `under ${label}.`,
  };
}

export default function FeedbackRoundPanel({
  /** The round being commented on, in `config/sessionHistory.js`'s shape. */
  round,
  /** The padded round number, for the composer to post back. */
  questionNumber,
  /** Comments already on this round, in writing order. */
  comments = [],
  /**
   * Post one comment. Given the anchor the section supplied plus the text.
   * Resolves `{ok: true, comment?}` or `{ok: false, error}` — never throws,
   * because a throw here would take the participant's words with it.
   */
  onSubmit,
  /**
   * LIFTED "HAS A DRAFT" FLAG — fix round 1, item 6. Called with `true`
   * whenever the composer holds unsent text, `false` once it is empty again.
   * A container deciding whether it may close the panel (PlayerPage.jsx)
   * cannot see inside without this. Optional.
   */
  onDraftChange,
  /** Pass-through to RoundReport (fix round 2). */
  answersEmptyText,
  onRetryAnswers,
  /**
   * WHETHER THE WRITER'S NAME GOES WITH THE COMMENT. True for a round, whose
   * feedback runs attributed. False for a closed survey's feedback round:
   * comments.js strips the name from every survey comment, so the sheet must
   * promise the opposite — and say it before anyone types.
   */
  namesShown = true,
  /**
   * A DRAFT KEPT FOR THIS ROUND (issue #47): `{ anchor, text }`, restored on
   * mount — target and words together, so the sheet reopens on the response it
   * was for. Read once; the container keys the panel by round.
   */
  savedDraft = null,
  /** Called with `{ anchor, text }` while there is unsent text, null after. */
  onDraftSave,
  /** Whose phone this is, so their own comments read "You". */
  playerName = '',
}) {
  const restored = savedDraft && savedDraft.anchor && typeof savedDraft.text === 'string'
    ? { ...savedDraft, anchor: withSheetWords(savedDraft.anchor) } : null;
  /** The target being written about, or null when the sheet is closed. */
  const [anchor, setAnchor] = useState(restored ? restored.anchor : null);
  /* Drafts by target. Switching target with words in the box ASKS (D5) rather
     than silently parking them, so in practice one draft is live; the map is
     what lets a restored draft and "Move it" carry words to the right key. */
  const [drafts, setDrafts] = useState(
    restored ? { [draftKeyOf(restored.anchor)]: restored.text } : {},
  );
  const text = anchor ? drafts[draftKeyOf(anchor)] || '' : '';
  const setText = useCallback((value) => {
    if (!anchor) return;
    const k = draftKeyOf(anchor);
    setDrafts((d) => ({ ...d, [k]: value }));
  }, [anchor]);
  const anyDraft = Object.values(drafts).some((t) => String(t || '').trim());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  /** A target tapped while the box held words: "Move your reply to …?" */
  const [pendingMove, setPendingMove] = useState(null);
  /** Cancel / X / Escape with words in the box: "Discard your reply?" */
  const [askDiscard, setAskDiscard] = useState(false);
  /** The confirmation for the last comment posted (D6). */
  const [sent, setSent] = useState(null);
  const boxRef = useRef(null);
  const askRef = useRef(null);
  /** The control that opened the sheet, for focus to return to (D6). */
  const openerRef = useRef(null);
  const headId = `fbr-sheet-h-${questionNumber || 'r'}`;
  const ruleId = `fbr-sheet-rule-${questionNumber || 'r'}`;

  // Focus the box when the sheet opens or moves: the next thing is to type.
  useEffect(() => {
    if (anchor && boxRef.current) boxRef.current.focus();
  }, [anchor]);

  // A question the sheet asks takes focus, so a keyboard or screen-reader
  // user meets it rather than the box behind it.
  useEffect(() => {
    if ((pendingMove || askDiscard) && askRef.current) askRef.current.focus();
  }, [pendingMove, askDiscard]);

  // ANY target's draft counts: words kept anywhere are words a container
  // must not close over.
  useEffect(() => {
    onDraftChange?.(anyDraft);
  }, [anyDraft, onDraftChange]);

  // The draft itself, for a container keeping one per round. Through a ref so
  // a caller passing a fresh function each render does not re-fire this.
  const onDraftSaveRef = useRef(onDraftSave);
  onDraftSaveRef.current = onDraftSave;
  useEffect(() => {
    const save = onDraftSaveRef.current;
    if (!save) return;
    save(anchor && text.trim() ? { anchor, text } : null);
  }, [anchor, text]);

  // The confirmation fades after six seconds; the comment itself stays.
  useEffect(() => {
    if (!sent) return undefined;
    const t = setTimeout(() => setSent(null), 6000);
    return () => clearTimeout(t);
  }, [sent]);

  /** Return focus to the control that opened the sheet (D6). */
  const returnFocus = () => {
    const el = openerRef.current;
    if (!el || typeof el.focus !== 'function') return;
    setTimeout(() => { if (el.isConnected) el.focus(); }, 0);
  };

  /*
    A TARGET IS TAPPED. With an empty box the sheet simply moves. With words
    in it, the sheet asks before moving them (D5) — the shipped panel dropped
    them silently, and later parked them out of sight.
  */
  const open = useCallback((next, opener) => {
    if (opener) openerRef.current = opener;
    setError('');
    setAskDiscard(false);
    const target = withSheetWords(next);
    if (anchor && draftKeyOf(anchor) !== draftKeyOf(target) && text.trim()) {
      setPendingMove(target);
      return;
    }
    setPendingMove(null);
    setAnchor(target);
  }, [anchor, text]);

  /** "Move it": the words go to the new target, and the sheet follows them. */
  const moveIt = () => {
    if (!pendingMove || !anchor) return;
    const from = draftKeyOf(anchor);
    const to = draftKeyOf(pendingMove);
    setDrafts((d) => {
      const { [from]: words, ...rest } = d;
      const there = String(rest[to] || '').trim();
      return { ...rest, [to]: there ? `${rest[to]}\n\n${words || ''}` : (words || '') };
    });
    setAnchor(pendingMove);
    setPendingMove(null);
  };

  /** Close the sheet and drop this target's draft. */
  const close = useCallback(() => {
    if (anchor) {
      const k = draftKeyOf(anchor);
      setDrafts((d) => {
        const { [k]: _gone, ...rest } = d;
        return rest;
      });
    }
    setAnchor(null);
    setError('');
    setPendingMove(null);
    setAskDiscard(false);
  }, [anchor]);

  /** The one way out (X, Cancel, Escape): it asks first when there are words. */
  const requestClose = () => {
    if (busy) return;
    if (text.trim()) {
      setPendingMove(null);
      setAskDiscard(true);
      return;
    }
    close();
    returnFocus();
  };

  const send = useCallback(async () => {
    const prose = text.trim();
    if (!prose || busy) return;
    setBusy(true);
    setError('');
    const target = anchor;
    const result = await onSubmit({ ...target, questionNumber, text: prose });
    setBusy(false);
    if (result && result.ok) {
      // Posted after the room moved on: the shipped late sentence, attached
      // to the same confirmation.
      const late = Boolean(result.comment && result.comment.addedLater);
      setSent({
        key: target.targetKey,
        lead: target.sentLead || 'Comment posted',
        rest: `${target.sentRest || ''}${late ? ' It is marked as added later.' : ''}`,
        commentId: (result.comment && result.comment.commentId) || null,
      });
      close();
      returnFocus();
      return;
    }
    /*
      THE WORDS STAY. A composer that clears on failure has thrown away what
      somebody wrote, and this is the ONLY place that text exists.
    */
    setError((result && result.error) || 'That did not send. Try again.');
  }, [anchor, busy, close, onSubmit, questionNumber, text]);

  /*
    THE HOST BUILDS THE REPORT, THEN OPENS THE BEAT. A phone can arrive between
    those two calls, and so can one that reconnects a moment early. That is a
    STATE, not an error.
  */
  if (!round) {
    return (
      <div className="fbr">
        <p className="fbr__waiting">The host is preparing this round for feedback.</p>
        <p className="fbr__waiting-sub">This page will change on its own.</p>
      </div>
    );
  }

  const isSurvey = round.kind === 'survey';
  const ordinal = round.ordinal || parseInt(questionNumber, 10) || '';
  const title = isSurvey ? 'Comment on the survey' : `Comment on round ${ordinal}`.trim();
  const noun = anchor ? anchor.noun || 'comment' : 'comment';

  return (
    <div className="fbr">
      <h1 className="fbr__title">{title}</h1>
      <p className="fbr__lead">
        {isSurvey
          ? 'Every comment is attached to one thing: Workie’s read, one question’s result, or the survey as a whole.'
          : 'Every comment is attached to one thing: Workie’s read, one response, or the round as a whole.'}
      </p>

      <RoundReport
        round={round}
        comments={comments}
        onComment={open}
        commentTarget={anchor ? anchor.targetKey : null}
        sent={sent}
        playerName={playerName}
        answersEmptyText={answersEmptyText}
        onRetryAnswers={onRetryAnswers}
      />

      {anchor && (
        /*
          THE DOCKED SHEET (D5). Not a Modal: the page above stays scrollable,
          so the target can still be read while writing about it. It sticks to
          the foot of the phone's scrolling region rather than being
          `position: fixed`, for the reason the shell's dock is a flex row.
          `role="region"` labelled by its heading — a dialog role would promise
          a focus trap this deliberately does not have.
        */
        <div
          className="fbr__composer"
          role="region"
          aria-labelledby={headId}
          onKeyDown={(e) => {
            if (e.key !== 'Escape') return;
            e.stopPropagation();
            if (pendingMove) { setPendingMove(null); return; }
            if (askDiscard) { setAskDiscard(false); return; }
            requestClose();
          }}
        >
          <div className="fbr__sheet-head">
            <h2 id={headId} className="fbr__sheet-title">{anchor.heading}</h2>
            <button
              type="button"
              className="fbr__x"
              aria-label="Close this box"
              onClick={requestClose}
              disabled={busy}
            >
              <Icon name="X" size={20} />
            </button>
          </div>

          {anchor.anchorExcerpt && (
            <figure className={`fbr__quote${anchor.isWorkie ? ' fbr__quote--workie' : ''}`}>
              {anchor.quoteHead && <figcaption className="fbr__quote-head">{anchor.quoteHead}</figcaption>}
              <p className="fbr__quote-text">{plainOf(anchor.anchorExcerpt)}</p>
            </figure>
          )}

          <textarea
            ref={boxRef}
            className="fbr__box"
            value={text}
            maxLength={MAX_COMMENT}
            rows={3}
            aria-labelledby={headId}
            aria-describedby={ruleId}
            placeholder={noun === 'reply' ? 'Write your reply' : 'Write your comment'}
            onChange={(e) => setText(e.target.value)}
          />

          {/* THE NAME RULE, said BEFORE anyone types (D4). Each clause is
              something the system does: the name rides on the comment, the
              public GET /comments returns it, and featureComment can put it
              on the room's screen. */}
          <p id={ruleId} className="fbr__attribution">
            {namesShown ? NAME_RULE_SHOWN : NAME_RULE_HIDDEN}
          </p>

          {pendingMove && (
            <div className="fbr__ask" role="group" aria-labelledby={`${headId}-move`}>
              <p id={`${headId}-move`} className="fbr__ask-text">
                {`Move your ${noun} to ${pendingMove.targetName}? Your words come with it.`}
              </p>
              <div className="fbr__actions">
                <button type="button" ref={askRef} className="fbr__cancel" onClick={() => setPendingMove(null)}>
                  Keep it here
                </button>
                <button type="button" className="fbr__post" onClick={moveIt}>Move it</button>
              </div>
            </div>
          )}

          {askDiscard && (
            <div className="fbr__ask" role="group" aria-labelledby={`${headId}-discard`}>
              <p id={`${headId}-discard`} className="fbr__ask-text">{`Discard your ${noun}?`}</p>
              <div className="fbr__actions">
                <button type="button" ref={askRef} className="fbr__cancel" onClick={() => setAskDiscard(false)}>
                  Keep writing
                </button>
                <button
                  type="button"
                  className="fbr__discard"
                  onClick={() => { close(); returnFocus(); }}
                >
                  Discard
                </button>
              </div>
            </div>
          )}

          {error && <p className="fbr__error">{error}</p>}

          {!pendingMove && !askDiscard && (
            <div className="fbr__actions">
              <button type="button" className="fbr__cancel" onClick={requestClose} disabled={busy}>
                Cancel
              </button>
              <span className="fbr__count">{`${text.length} / ${MAX_COMMENT}`}</span>
              <button
                type="button"
                className="fbr__post"
                onClick={send}
                disabled={busy || !text.trim()}
              >
                <Icon name="PaperPlaneTilt" size={18} />
                {busy ? 'Posting…' : (noun === 'reply' ? 'Post reply' : 'Post comment')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
