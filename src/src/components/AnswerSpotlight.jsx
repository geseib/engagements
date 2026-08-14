import React, { useCallback, useEffect } from 'react';
import Modal from './Modal';
import Icon from './Icon';
import { step, canStep, positionLabel } from '../utils/answerSpotlight';

/**
 * ONE ANSWER, BIG ENOUGH TO READ, WITH THE REST STILL REACHABLE.
 *
 *   "it should be easy to click on an answer and it expand on a large modal,
 *    with a x to close or click off the modal to go back, in case we want to
 *    read the answer."
 *
 * Both dismissals are named in the request and both are wired: the X, and the
 * backdrop. Escape comes free from <Modal>, along with the focus trap, the
 * focus restore, the refcounted scroll lock and the ARIA — which is the whole
 * reason this does not hand-roll an overlay. Two raw `.modal-overlay` divs
 * elsewhere in this codebase still do, and they are a standing task.
 *
 * THE BACKDROP CLOSES HERE, unlike the question editor, and the difference is
 * whether a stray tap can destroy anything. The editor holds a draft, so its
 * backdrop is deliberately inert. This holds a copy of something already
 * submitted — closing it loses nothing at all — so the cheaper dismissal is the
 * right one.
 *
 * IT SCROLLS ITS OWN TEXT. A long answer is exactly the case this exists for,
 * so `.answer-spotlight__text` is the scroll container and the dialog is capped
 * against the viewport. jsdom computes no heights and scrolls nothing, so that
 * contract is pinned in the stylesheet and tested as text — the same technique
 * `modalReachability.test.js` uses, and for the same reason.
 */
export default function AnswerSpotlight({
  /** Every answer in the round, not the visible page — Next walks the whole list. */
  answers = [],
  /** Absolute index into `answers`. `null` closes. */
  index,
  onIndex,
  onClose,
  /** How to label an author, so anonymity is decided by the caller, never here. */
  labelFor,
  /** Whether points may appear beside the answer. Same rule as the card behind it. */
  showPoints = false,
  /** Names the round on the dialog, e.g. "Round 3 results". */
  title = 'Answer',
}) {
  const total = answers.length;
  const open = Number.isInteger(index) && index >= 0 && index < total;

  const move = useCallback((delta) => {
    const next = step(index, delta, total);
    if (next !== null && next !== index) onIndex(next);
  }, [index, total, onIndex]);

  /*
    ARROW KEYS, because this is read from across a room with a clicker, and
    every presentation remote on earth sends Left/Right. Bound on the document
    rather than the dialog so it works wherever focus landed inside the trap.
    Escape is deliberately absent — <Modal> owns it, and two handlers for one
    key is how a dialog ends up closing twice.
  */
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'ArrowRight') { e.preventDefault(); move(1); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); move(-1); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, move]);

  if (!open) return null;

  const answer = answers[index];
  const points = answer.points || 0;

  return (
    <Modal
      overlayClassName="modal-overlay answer-spotlight__scrim"
      contentClassName="answer-spotlight"
      onClose={onClose}
      closeOnBackdrop
      closeOnEscape
      label={title}
    >
      <div className="answer-spotlight__head">
        <span className="answer-spotlight__count">{positionLabel(index, total)}</span>
        <button
          type="button"
          className="answer-spotlight__close"
          onClick={onClose}
          aria-label="Close"
        >
          <Icon name="X" size={22} />
        </button>
      </div>

      <div className="answer-spotlight__text">{answer.answer}</div>

      <div className="answer-spotlight__meta">
        <span className="answer-spotlight__who">{labelFor(answer, index)}</span>
        {showPoints && (
          <span className="answer-spotlight__tally">
            {`+${points}`}
            <small>{`${answer.votes || 0} votes`}</small>
          </span>
        )}
      </div>

      <div className="answer-spotlight__nav">
        <button
          type="button"
          className="btn-secondary"
          onClick={() => move(-1)}
          disabled={!canStep(index, -1, total)}
          aria-label="Previous answer"
        >
          <Icon name="CaretLeft" size={18} /> Previous
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => move(1)}
          disabled={!canStep(index, 1, total)}
          aria-label="Next answer"
        >
          Next <Icon name="CaretRight" size={18} />
        </button>
      </div>
    </Modal>
  );
}
