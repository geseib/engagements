import React, { useCallback, useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import RoundReport from './RoundReport';
import { MAX_COMMENT } from '../config/comments';
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
 * because it is being mirrored. The owner also asked for it explicitly, in the
 * same breath as "so they can read, copy paste", which a projector cannot do.
 *
 * ── WHY A COMPONENT AND NOT ANOTHER BRANCH IN PlayerPage ───────────────────
 *
 * `PlayerPage.jsx` is 3,229 lines and does not mount under jsdom — it dies on
 * the auth provider — so everything in it is asserted by reading source. A
 * surface that collects customer prose ABOUT NAMED PEOPLE should be testable by
 * rendering it and clicking it, so it lives here and the page holds a branch.
 *
 * ── THE COMPOSER IS CHAT-SHAPED, NOT FORM-SHAPED ───────────────────────────
 *
 * *"like in chat response they click on a section"*. So there is no standing
 * text box: a box with no stated subject collects remarks about nothing, and
 * the section has to be chosen first. Choosing one opens the composer with the
 * section named at the top of it, and the anchor travels from the click rather
 * than being re-derived on submit — which is what keeps a comment on a tied
 * response attached to the row that was actually tapped.
 */
export default function FeedbackRoundPanel({
  /** The round being commented on, in `config/sessionHistory.js`'s shape. */
  round,
  /** The padded round number, for the composer to post back. */
  questionNumber,
  /** Comments already on this round, in writing order. */
  comments = [],
  /**
   * Post one comment. Given the anchor the section supplied plus the text.
   * Resolves `{ok: true}` or `{ok: false, error}` — never throws, because a
   * throw here would take the participant's words with it.
   */
  onSubmit,
}) {
  /** The section being commented on, or null when the composer is closed. */
  const [anchor, setAnchor] = useState(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const boxRef = useRef(null);

  // Focus the box when it opens: the participant has just tapped a section and
  // the next thing they want to do is type. Guarded because a ref is null on
  // the render where the element does not exist yet.
  useEffect(() => {
    if (anchor && boxRef.current) boxRef.current.focus();
  }, [anchor]);

  const open = useCallback((next) => {
    setAnchor(next);
    setText('');
    setError('');
  }, []);

  const close = useCallback(() => {
    setAnchor(null);
    setText('');
    setError('');
  }, []);

  const send = useCallback(async () => {
    const prose = text.trim();
    if (!prose || busy) return;
    setBusy(true);
    setError('');
    const result = await onSubmit({ ...anchor, questionNumber, text: prose });
    setBusy(false);
    if (result && result.ok) {
      close();
      return;
    }
    /*
      THE WORDS STAY. A composer that clears on failure has thrown away what
      somebody wrote, and this is the ONLY place that text exists — it is not
      recoverable from the round, the report or the socket. So the box keeps its
      contents and the reason appears beside it.
    */
    setError((result && result.error) || 'That did not send. Try again.');
  }, [anchor, busy, close, onSubmit, questionNumber, text]);

  /*
    THE HOST BUILDS THE REPORT, THEN OPENS THE BEAT. A phone can arrive between
    those two calls, and so can one that reconnects a moment early. That is a
    STATE, not an error: it says what is happening and it offers nothing to
    press, rather than showing an empty report that looks broken.
  */
  if (!round) {
    return (
      <div className="fbr">
        <p className="fbr__waiting">The host is preparing this round for feedback.</p>
        <p className="fbr__waiting-sub">This page will change on its own.</p>
      </div>
    );
  }

  return (
    <div className="fbr">
      <p className="fbr__lead">
        Read it back, then say what you think. Tap <b>Comment</b> on the summary, on the
        results, or on any single response.
      </p>

      <RoundReport
        round={round}
        comments={comments}
        onComment={open}
      />

      {anchor && (
        /*
          NOT A MODAL. `Modal` owns Escape, a focus trap and a scroll lock — all
          right for a dialog laid over something else, all wrong here, where the
          participant needs to keep reading the section they are commenting on
          while they write about it. `RemoteSessionPanel` settled the same
          question the same way: a modal on a phone covers the dock.
        */
        <div className="fbr__composer" role="group" aria-label={`Comment on ${anchor.anchorLabel}`}>
          <div className="fbr__on">
            <span className="fbr__on-label">Commenting on</span>
            <span className="fbr__on-anchor">{anchor.anchorLabel}</span>
            {anchor.anchorExcerpt && (
              <span className="fbr__on-excerpt">{anchor.anchorExcerpt}</span>
            )}
          </div>

          <textarea
            ref={boxRef}
            className="fbr__box"
            value={text}
            maxLength={MAX_COMMENT}
            rows={4}
            placeholder="What do you make of it?"
            onChange={(e) => setText(e.target.value)}
          />

          <div className="fbr__meta">
            <span className="fbr__count">{`${text.length} characters`}</span>
          </div>

          {/*
            THE DISCLOSURE, and it is the deliberate half of the anonymity
            decision rather than a caption.

            A feedback round always runs attributed — `get-results.js` reveals
            authors unconditionally on entering RESULTS, and this beat is inside
            RESULTS. But the participant has spent the whole session being told
            "Your name is not attached to it until voting closes", so carrying
            that assumption into a comment is the real privacy failure available
            here. It is said BEFORE they type, not discovered afterwards.
          */}
          <p className="fbr__attribution">Your name will be shown with this comment.</p>

          {error && <p className="fbr__error">{error}</p>}

          <div className="fbr__actions">
            {/* The way out that is not the commit. */}
            <button type="button" className="fbr__cancel" onClick={close} disabled={busy}>
              Cancel
            </button>
            <button
              type="button"
              className="fbr__post"
              onClick={send}
              disabled={busy || !text.trim()}
            >
              <Icon name="PaperPlaneTilt" size={16} />
              {busy ? 'Posting…' : 'Post comment'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
