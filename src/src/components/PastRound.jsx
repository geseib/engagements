import React, { useCallback, useEffect, useState } from 'react';
import Modal from './Modal';
import Icon from './Icon';
import RoundReport from './RoundReport';
import { step, canStep, positionLabel } from '../utils/stepIndex';

/**
 * ONE ROUND THAT ALREADY HAPPENED — the question, what the room said, and what
 * the AI made of it.
 *
 *   "once you move on to a new question it would be nice to go back through AI
 *    responses, and results screens."
 *
 * A MODAL BECAUSE THE OWNER ASKED FOR MODALS: *"the reason i want a modal here
 * is consistancy."* It is also the right shape independently — the host is
 * mid-session, looking something up, and must land back exactly where they were
 * rather than navigating away from a live round.
 *
 * ARROWS AS WELL AS THE LIST, both chosen deliberately: the list is for jumping
 * to round three of twelve, the arrows are for "and what was the one before
 * that". `utils/stepIndex.js` owns the edge rules so they match the answer
 * spotlight exactly — clamped, never wrapped, and a step at an end returns the
 * same index rather than the null that would close this.
 *
 * THE QUESTION IS SHOWN, not just the results, because the owner asked for it
 * and because a results screen with no question on it is unreadable a quarter
 * of an hour later.
 *
 * ── WHO WROTE WHAT, AND WHY THIS DIALOG DOES NOT ASK THE CALLER ────────────
 *
 * Reported: *"the responses are just listed anonymous, and they should not."*
 *
 * This used to take a `labelFor` prop, and the host page passed it
 * `stageLabelFor(…, { authorsHidden: authorsHiddenNow({ gameType,
 * anonymousUntilReveal, authorsRevealed }) })` — the same expression the live
 * RESULTS cards use. That is the right question for the round IN PLAY and the
 * wrong one for a round that finished: `authorsRevealed` on the host page
 * tracks the CURRENT round, so while round four sat in ASK, rounds one through
 * three — long since closed, revealed, and delivered WITH their authors —
 * were all relabelled "Response 1, 2, 3". A per-round fact answered with a
 * whole-session flag.
 *
 * THE ROW IS THE ANSWER. `create-report.js` decides this per round, through the
 * same `isHidden()` gate as `GET /answers`, and OMITS `playerName` from the
 * rounds that are still hidden (create-report.js:332-354). Entering RESULTS
 * sets `AuthorsRevealed` by itself (get-results.js:207), so every round that
 * finished arrives attributed and only a round abandoned mid-vote does not.
 * `displayLabelFor` is `config/anonymity.js`'s reader for exactly that case —
 * *"decides from the row alone, which is right for a payload the server
 * redacted"* — so this asks it and nothing else. Re-deriving the judgement at
 * the call site is the mistake `config/sessionHistory.js`'s header names, and
 * taking a prop for it here was that mistake wearing a parameter.
 *
 * It is display-only either way: nothing here can print a name the server did
 * not send.
 */
export default function PastRound({
  rounds = [],
  index,
  onIndex,
  onClose,
  /** Regenerate this round's summary. Given the round number, not the index. */
  onRegenerate,
  /** Round numbers currently regenerating, so the button can say so. */
  regenerating = [],
}) {
  const total = rounds.length;
  const open = Number.isInteger(index) && index >= 0 && index < total;

  /*
    WHICH RESPONSE IS OPEN ON TOP OF THIS ONE. `null` is closed.

    Held here rather than on the page because it is meaningless outside this
    dialog, and cleared whenever the round changes: stepping from round 3 to
    round 4 with response 5 open would otherwise show round 4's fifth response
    with no indication anything had moved — or, on a shorter round, nothing at
    all.
  */
  const [spotlight, setSpotlight] = useState(null);
  useEffect(() => { setSpotlight(null); }, [index]);

  const move = useCallback((delta) => {
    const next = step(index, delta, total);
    if (next !== null && next !== index) onIndex(next);
  }, [index, total, onIndex]);

  // Same clicker keys as the answer spotlight, for the same reason. Escape is
  // <Modal>'s and is deliberately not handled twice.
  //
  // SILENT WHILE A RESPONSE IS OPEN. Both dialogs bind Left/Right on the
  // document, so without this one press would step the response AND the round
  // underneath it — and the round change then closes the response, so the host
  // sees the dialog vanish and the round jump from a single arrow press.
  /*
    HOW MANY RESPONSES THIS ROUND HAS, read before the early return below so
    the digit shortcut can clamp against it. `rounds[index]` is only safe to
    index when `open`, which is exactly what that guard checks.
  */
  const answerCount = open ? (rounds[index]?.answers?.length || 0) : 0;

  useEffect(() => {
    if (!open || spotlight !== null) return undefined;
    const onKey = (e) => {
      /*
        NEVER STEAL A KEYSTROKE THAT IS BEING TYPED. This dialog has no text
        field today, but the Regenerate control and any later addition make
        that a matter of timing rather than of design. A digit handler bound on
        `document` is the classic way a "1" stops appearing in an input.
      */
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      // A modified press is somebody else's shortcut — browser tab switching is
      // Cmd/Ctrl+digit on every platform this runs on.
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === 'ArrowRight') { e.preventDefault(); move(1); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); move(-1); }

      /*
        1-9 OPENS THAT RESPONSE — the fast path, not the only path.

        The owner: *"there are numbers next to the players responses, that is
        meant for the host to press that number… what if there are 10 ppl, cant
        press the 10 key."* Both halves are addressed, in different places:
        this makes the numbers behave the way they already LOOK, and the
        arrow-key stepping inside AnswerSpotlight is what reaches the tenth
        response and beyond.

        NINE IS THE CEILING AND THAT IS DELIBERATE. There is no tenth digit, so
        a two-key "10" would need a timeout to tell 1-then-0 from 1-then-stop —
        which makes pressing "1" feel broken for the length of that timeout, on
        the most common press. The arrows already cover the tail without
        inventing a mode.

        Clamped against `answerCount`, so pressing 7 in a five-response round
        does nothing rather than opening an empty dialog.
      */
      if (e.key >= '1' && e.key <= '9') {
        const wanted = Number(e.key) - 1;
        if (wanted < answerCount) {
          e.preventDefault();
          setSpotlight(wanted);
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, spotlight, move, answerCount]);

  if (!open) return null;

  const round = rounds[index];
  const busy = regenerating.includes(round.number);

  return (
    <Modal
      overlayClassName="modal-overlay past-round__scrim"
      contentClassName="past-round"
      onClose={onClose}
      closeOnBackdrop
      closeOnEscape
      label={`Round ${round.ordinal}: ${round.title}`}
    >
      <div className="past-round__head">
        <span className="past-round__count">{positionLabel(index, total)}</span>
        <button type="button" className="past-round__close" onClick={onClose} aria-label="Close">
          <Icon name="X" size={22} />
        </button>
      </div>

      <RoundReport
        round={round}
        spotlight={spotlight}
        onSpotlight={setSpotlight}
        onRegenerate={onRegenerate}
        regenerating={busy}
      />

      <div className="past-round__nav">
        <button
          type="button"
          className="btn-secondary"
          onClick={() => move(-1)}
          disabled={!canStep(index, -1, total)}
          aria-label="Previous round"
        >
          <Icon name="CaretLeft" size={18} /> Previous
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => move(1)}
          disabled={!canStep(index, 1, total)}
          aria-label="Next round"
        >
          Next <Icon name="CaretRight" size={18} />
        </button>
      </div>
    </Modal>
  );
}
