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

/**
 * KEYS THAT MUST NOT MEAN "I AM DONE READING".
 *
 *   "any key takes you back to the review overview page for the question they
 *    were looking at."
 *
 * A literal any-key handler is not what that sentence means, and shipping one
 * would break the dialog for exactly the people who need it most. Four groups
 * are excluded, each for a different reason:
 *
 *   FOCUS AND MODIFIERS — Tab, Shift+Tab, and every bare modifier key. Tab is
 *   how a keyboard user moves through the dialog's own controls, and <Modal>
 *   traps it deliberately; dismissing on it would make the trap unreachable.
 *   A bare Shift/Control/Alt/Meta/CapsLock press is the FIRST half of a chord,
 *   never an instruction on its own — and screen readers hold modifiers down.
 *
 *   ANYTHING WITH A MODIFIER HELD — Ctrl+F, Cmd+C, and every screen-reader
 *   command, which are chords by construction. Closing the dialog under them
 *   would make copy-and-paste dismiss the thing being copied.
 *
 *   THE READING KEYS — Arrow up/down, PageUp/PageDown, Home/End and Space.
 *   This dialog exists to hold an answer too long to read in the grid behind
 *   it, and these are how a keyboard-only user scrolls it. "Any key goes back"
 *   must not mean "the answer cannot be read without a mouse".
 *
 *   THE DIALOG'S OWN CONTROLS — Arrow left/right, which step to the previous
 *   and next answer, and Escape, which <Modal> already answers. Both already
 *   do something deliberate; a second meaning would be a race.
 *
 * Everything else — letters, digits, Enter, Backspace, punctuation, the
 * function keys — dismisses. Typing into a field dismisses nothing either,
 * which costs nothing today (this dialog has no inputs) and stops the rule
 * becoming a trap if one is ever added.
 */
const HELD_DOWN = new Set([
  'Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'NumLock', 'ScrollLock',
  'AltGraph', 'Fn', 'FnLock', 'Hyper', 'Super', 'ContextMenu', 'Dead',
]);
const READING = new Set([
  'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ', 'Spacebar',
]);
const OWNED = new Set(['ArrowLeft', 'ArrowRight', 'Escape', 'Tab']);

export function dismissesOnKey(event) {
  const e = event || {};
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  const key = e.key;
  if (typeof key !== 'string' || key.length === 0) return false;
  if (HELD_DOWN.has(key) || READING.has(key) || OWNED.has(key)) return false;
  const tag = e.target && e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return false;
  if (e.target && e.target.isContentEditable) return false;
  return true;
}
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
  /**
   * Dismiss on a keypress, per `dismissesOnKey` above. OFF by default: on the
   * live RESULTS stage the host is running the room from this dialog and a
   * stray keypress must not close it. The past-round review turns it on,
   * because that is what the owner asked for there.
   */
  closeOnKey = false,
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
      /*
        "any key takes you back" — but only the keys that mean it. The
        exclusions and the reasoning are in `dismissesOnKey` above.

        NO EARLY RETURN ON THE ARROW BRANCHES, DELIBERATELY. They fall through
        to here and `dismissesOnKey` refuses them, because it lists them as
        this dialog's own keys. An early return would say the same thing a
        second time — and a doubled guard is a guard that cannot be tested:
        with both in place, deleting EITHER changes no behaviour, so no
        assertion can hold either one in place. One rule, in the predicate that
        is named after it.
      */
      if (!closeOnKey || !dismissesOnKey(e)) return;
      e.preventDefault();
      if (onClose) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, move, closeOnKey, onClose]);

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
