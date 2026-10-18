import React, {
  useCallback, useEffect, useMemo, useState,
} from 'react';
import Modal from './Modal';
import Icon from './Icon';
import { step, canStep, positionLabel } from '../utils/answerSpotlight';
import { answerText } from '../config/stageAnswers';
import { minimalK, partText } from '../present/presentFit';

/** The ladder beside a result shows this many rows; the rest share the last ("5–9"). */
export const LADDER_ROWS = 5;

/**
 * The ladder's rows: one per answer in order (the caller's tally order), the
 * last row covering the tail when there are more than LADDER_ROWS. Each row's
 * bar is its answer's share relative to the pick; a collapsed row takes the
 * share of its first (highest) answer.
 */
export function ladderRows(total, shareAt, rows = LADDER_ROWS) {
  const n = Math.max(0, total);
  const out = [];
  for (let i = 0; i < Math.min(n, rows); i += 1) {
    const last = i === rows - 1 && n > rows;
    out.push({
      from: i, to: last ? n - 1 : i, label: last ? `${i + 1}–${n}` : String(i + 1), share: shareAt(i),
    });
  }
  return out;
}

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
  /**
   * Appended to the dialog box, so a surface with its own palette can re-tint
   * this one instead of forking it. `PlayerPage` passes `plr-spot`: the player's
   * device is dusk and `styles.css` paints `.answer-spotlight` for the host's
   * paper theme, right down to a `.btn-secondary` that is #F6A94C on #FFFFFF.
   * Only the caller knows which polarity it is on, so only the caller says.
   * Empty by default — the host and `PastRound` keep exactly what they had.
   */
  surfaceClassName = '',
  /**
   * Jump straight to a response by its position — `(zeroBasedIndex) => void`.
   *
   * OPT-IN, AND THAT IS THE WHOLE POINT. When this is passed, the digits 1-9
   * stop dismissing and start jumping. When it is absent — the host's live
   * results stage, the player's own surface — nothing changes and a digit
   * still takes you back, exactly as `dismissesOnKey` documents.
   *
   * The review dialog passes it because there the number IS the address of a
   * response: the owner reads the badges as "press that number and bring up the
   * full answer for that person". Without this, reading #1 and wanting #3 costs
   * two presses — one to dismiss, one to open — and the first of them looks
   * like the shortcut failing.
   *
   * On the live stage the opposite rule is right and stays: that screen faces a
   * room, "any key takes you back" is the owner's own wording for it, and a
   * stray digit from a clicker should not silently swap which answer a room is
   * reading.
   */
  onJump = null,
  /**
   * THE ROOM'S LOOK, ONE ANSWER PUT UP (owner, 18 Oct 2026,
   * docs/design/room-content-v2 frames 11 and 12). Empty by default — the
   * phone, the past-round review and anything else keep exactly what they had.
   *
   *   'vote'    the answer's NUMBER as a badge ("answer 4 of 9"), and a row of
   *             numbered chips saying where it sits, each one a way to it. No
   *             name, no points, whatever `labelFor` would say: the number IS
   *             the label while voting.
   *   'result'  its PLACE ("2nd") as the eyebrow, and a ladder of bars beside
   *             it — every place's bar relative to the pick, this one marked —
   *             with no figures on it. `placeFor(answer)` and
   *             `shareFor(answer)` (0..1) are the caller's, so anonymity and
   *             the tally stay decided where the cards behind decide them.
   */
  variant = '',
  placeFor = null,
  shareFor = null,
  /**
   * A LONG ANSWER SPLITS INTO PARTS rather than scrolling on a projector:
   * past `partChars` characters it is cut at sentence ends
   * (present/presentFit.js, the wall's own cutter) into the fewest parts that
   * each fit, and → / ← walk the parts before they move to the next answer.
   * Null (the default) keeps the one scrolling text every other caller has.
   */
  partChars = null,
}) {
  const total = answers.length;
  const open = Number.isInteger(index) && index >= 0 && index < total;
  const [part, setPart] = useState(0);
  const fullText = open ? answerText(answers[index].answer) : '';
  const parts = useMemo(() => (
    Number.isFinite(partChars) && partChars > 0 && fullText.length > partChars
      ? minimalK(fullText, (slice) => slice.length <= partChars)
      : 1
  ), [fullText, partChars]);
  // A new answer opens on its first part.
  useEffect(() => { setPart(0); }, [index]);
  const shownPart = Math.min(part, parts - 1);

  const move = useCallback((delta) => {
    if (delta > 0 && shownPart < parts - 1) { setPart(shownPart + 1); return; }
    if (delta < 0 && shownPart > 0) { setPart(shownPart - 1); return; }
    const next = step(index, delta, total);
    if (next !== null && next !== index) onIndex(next);
  }, [index, total, onIndex, shownPart, parts]);

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
        A DIGIT JUMPS, BUT ONLY WHERE A CALLER ASKED FOR IT (`onJump`).

        THIS IS NOT THE DOUBLED GUARD THE NOTE BELOW WARNS ABOUT. That warning
        is about restating something `dismissesOnKey` already decides — delete
        either copy and behaviour is unchanged, so neither can be tested. This
        is the opposite: `dismissesOnKey` is a pure predicate that knows nothing
        about props, and it lists digits as dismissing. Deleting THIS branch
        changes what a digit does wherever `onJump` is passed, and a test holds
        it in place.

        Bounded by `total` so a digit past the end of a short round does
        nothing at all rather than dismissing — pressing 7 in a four-response
        round must not close the dialog, or the ceiling becomes invisible.
        Modifiers and typed input are left alone for the reasons
        `dismissesOnKey` already gives.
      */
      if (onJump && !e.metaKey && !e.ctrlKey && !e.altKey && e.key >= '1' && e.key <= '9') {
        const t = e.target;
        if (!(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable))) {
          const wanted = Number(e.key) - 1;
          if (wanted < total) {
            e.preventDefault();
            onJump(wanted);
          }
          return;
        }
      }

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
  }, [open, move, closeOnKey, onClose, onJump, total]);

  if (!open) return null;

  const answer = answers[index];
  const points = answer.points || 0;
  const isVote = variant === 'vote';
  const isResult = variant === 'result';
  const text = parts > 1 ? partText(fullText, shownPart, parts) : fullText;
  const share = (i) => {
    const v = typeof shareFor === 'function' ? Number(shareFor(answers[i], i)) : 0;
    return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
  };
  const place = isResult && typeof placeFor === 'function' ? placeFor(answer, index) : '';
  const ladder = isResult && typeof shareFor === 'function' ? ladderRows(total, share) : [];
  // The meta line repeats nothing: while voting the number is the label, and
  // a hidden result's label would only say "Response N" again.
  const who = labelFor(answer, index);
  const showWho = !isVote && who && !(isResult && /^Response \d+$/.test(who));

  return (
    <Modal
      overlayClassName="modal-overlay answer-spotlight__scrim"
      contentClassName={`answer-spotlight${surfaceClassName ? ` ${surfaceClassName}` : ''}${variant ? ` is-${variant}` : ''}`}
      onClose={onClose}
      closeOnBackdrop
      closeOnEscape
      label={title}
    >
      <div className="answer-spotlight__head">
        {isVote ? (
          <span className="answer-spotlight__num-line">
            <span className="answer-spotlight__num" aria-hidden="true">{index + 1}</span>
            <span className="answer-spotlight__count">{`answer ${positionLabel(index, total)}`}</span>
          </span>
        ) : (
          <span className="answer-spotlight__count">{positionLabel(index, total)}</span>
        )}
        {parts > 1 && (
          <span className="answer-spotlight__part">{`Part ${shownPart + 1} of ${parts}`}</span>
        )}
        <button
          type="button"
          className="answer-spotlight__close"
          onClick={onClose}
          aria-label="Close"
        >
          <Icon name="X" size={22} />
        </button>
      </div>

      {!variant && <div className="answer-spotlight__text">{text}</div>}
      {variant && (
      <div className={isResult && ladder.length ? 'answer-spotlight__split' : 'answer-spotlight__main'}>
        <div className="answer-spotlight__body">
          {place && <span className="answer-spotlight__place">{place}</span>}
          <div className="answer-spotlight__text">{text}</div>
        </div>
        {ladder.length > 0 && (
          <ol className="answer-spotlight__ladder" aria-label="Where it sits">
            {ladder.map((row) => {
              const here = index >= row.from && index <= row.to;
              return (
                <li
                  key={row.label}
                  className={`answer-spotlight__rung${row.from === 0 ? ' is-pick' : ''}${here ? ' is-here' : ''}`}
                  aria-current={here ? 'true' : undefined}
                >
                  <span className="answer-spotlight__rung-fill" style={{ width: `${Math.max(3, Math.round(row.share * 100))}%` }} />
                  <span className="answer-spotlight__rung-n">{row.label}</span>
                </li>
              );
            })}
          </ol>
        )}
      </div>
      )}

      {(!variant || showWho || showPoints) && (
        <div className="answer-spotlight__meta">
          <span className="answer-spotlight__who">{!variant || showWho ? who : ''}</span>
          {showPoints && (
            <span className="answer-spotlight__tally">
              {`+${points}`}
              <small>{`${answer.votes || 0} votes`}</small>
            </span>
          )}
        </div>
      )}

      {isVote && total > 1 && (
        <div className="answer-spotlight__chips" role="group" aria-label="Answers">
          {answers.map((a, i) => (
            <button
              key={i}
              type="button"
              className={`answer-spotlight__chip${i === index ? ' is-on' : ''}`}
              aria-current={i === index ? 'true' : undefined}
              aria-label={`Answer ${i + 1}`}
              onClick={() => { if (i !== index) onIndex(i); }}
            >
              {i + 1}
            </button>
          ))}
        </div>
      )}

      <div className="answer-spotlight__nav">
        <button
          type="button"
          className="btn-secondary"
          onClick={() => move(-1)}
          disabled={!canStep(index, -1, total) && shownPart === 0}
          aria-label="Previous answer"
        >
          <Icon name="CaretLeft" size={18} /> Previous
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => move(1)}
          disabled={!canStep(index, 1, total) && shownPart >= parts - 1}
          aria-label="Next answer"
        >
          Next <Icon name="CaretRight" size={18} />
        </button>
      </div>
    </Modal>
  );
}
