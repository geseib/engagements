import React, { useCallback, useEffect, useState } from 'react';
import Modal from './Modal';
import Icon from './Icon';
import AnswerSpotlight from './AnswerSpotlight';
import MarkdownRenderer from './MarkdownRenderer';
import { step, canStep, positionLabel } from '../utils/stepIndex';
import {
  hasSummary, snippetOf, podiumAnswers, roundIsAttributed,
} from '../config/sessionHistory';
import { displayLabelFor } from '../config/anonymity';

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
  useEffect(() => {
    if (!open || spotlight !== null) return undefined;
    const onKey = (e) => {
      if (e.key === 'ArrowRight') { e.preventDefault(); move(1); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); move(-1); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, spotlight, move]);

  if (!open) return null;

  const round = rounds[index];
  const busy = regenerating.includes(round.number);
  const summary = round.aiSummary || {};
  const showSummary = hasSummary(round);
  const podium = podiumAnswers(round);

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

      <div className="past-round__body">
        {/* THE QUESTION. */}
        <section className="past-round__question">
          <h3>{round.title}</h3>
          {round.detail && <p className="past-round__detail">{round.detail}</p>}
          {round.image && (
            <img
              src={round.image}
              alt={round.title}
              className="past-round__image"
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
            />
          )}
          {round.school && <p className="past-round__school">{round.school}</p>}
          {round.options.length > 0 && (
            <ul className="past-round__options">
              {round.options.map((option, i) => (
                <li key={i}>{option}</li>
              ))}
            </ul>
          )}
          {round.answerDetails && <p className="past-round__answer-detail">{round.answerDetails}</p>}
        </section>

        {/* WHAT THE ROOM SAID. */}
        <section className="past-round__results">
          <h4>Responses</h4>
          {round.answers.length === 0 ? (
            /* A round with no responses is a real outcome and has to read as
               one. Rendering an empty list instead looks like a load that
               failed, which sends the host looking for a bug. */
            <p className="past-round__empty">Nobody responded to this round.</p>
          ) : (
            /*
              THE BRIEF BAR, AND A WAY INTO THE WHOLE THING.

                "i do like the brief bar of the answers, but i think we need an
                 easy way to review these in detail. so if each of the 3 has a
                 number in a circle, the start of their answer, their name and
                 you click that number the full modal shows there answer."

              So the row keeps its shape — number, opening words, author — and
              the number becomes the control. The top three carry the circle the
              owner described (`is-podium`; it is a circle in the stylesheet,
              which jsdom cannot see and does not test).

              EVERY ROW IS CLICKABLE, not only the three. The circle marks the
              three the owner singled out, but a row shows a SNIPPET now, so a
              fourth-place response with no way to open it would be a response
              nobody can read — a worse defect than the one being fixed. The
              three are emphasised; none are stranded.

              A BUTTON, NOT A CLICKABLE SPAN. It has to be reachable by Tab and
              operable by Enter and Space, and the accessible name has to say
              which response it opens and whose it is — the ordinal alone reads
              as "1" to a screen reader, which names nothing.

              THE NUMBER SHOWN IS THE PLACEMENT; THE THING OPENED IS THE ROW.
              Those are two different numbers and ties are where they diverge:
              create-report gives equal scores equal ranks (1, 1, 3), so two
              circles both read "1". The handler therefore closes over the ROW'S
              OWN POSITION `i` — never over the number printed on it — because
              `round.answers[i]` is by construction the response this row is
              drawn from. A lookup keyed on the badge would open the first of
              two tied responses from either circle. The accessible name states
              the position and the author for the same reason: those two are
              unique per row where the placement is not. (The live grid in
              GameHostPage has the same split — it prints `answer.placement` and
              opens `answerPage.offset + i`.)
            */
            <ol className="past-round__answers">
              {round.answers.map((answer, i) => {
                const who = displayLabelFor(answer, i);
                return (
                  <li key={i} className={answer.rank === 1 ? 'is-lead' : ''}>
                    <button
                      type="button"
                      className={`past-round__rank${i < podium.length ? ' is-podium' : ''}`}
                      onClick={() => setSpotlight(i)}
                      aria-label={`Read response ${i + 1} in full, by ${who}`}
                    >
                      {answer.rank || i + 1}
                    </button>
                    <span className="past-round__answer">{answer.answer}</span>
                    <span className="past-round__who">{who}</span>
                  </li>
                );
              })}
            </ol>
          )}

          {/*
            THE FULL RESPONSE, reusing the dialog the RESULTS stage already
            uses rather than building a second one — same clamped pager
            (`utils/stepIndex.js`), same X, same backdrop, same scroll contract.

            `closeOnKey` is the owner's *"any key takes you back to the review
            overview page for the question they were looking at"*. It comes
            back to THIS round because this dialog never unmounted: the
            spotlight renders inside it, <Modal> picks the innermost dialog by
            DOM containment, and dismissing it leaves `index` untouched.

            `showPoints` follows the names (§5.6.4 — a score beside a response
            is attribution by arithmetic), and `roundIsAttributed` reads that
            off the rows for the same reason the label does.
          */}
          <AnswerSpotlight
            answers={round.answers}
            index={spotlight}
            onIndex={setSpotlight}
            onClose={() => setSpotlight(null)}
            labelFor={displayLabelFor}
            showPoints={roundIsAttributed(round)}
            closeOnKey
            title={`Round ${round.ordinal} response`}
          />
        </section>

        {/*
          WHAT THE AI MADE OF IT — AS MARKDOWN, WHICH IS WHAT IT IS.

            "also the workie section in the rounds review modal isnt formatted
             from md instead the md sysbols just show like ** ."

          Every one of these fields is model output, and `personas.js`'s output
          contract tells the model it may write markdown — so a `<p>{text}</p>`
          prints the asterisks. `MarkdownRenderer` is the one renderer allowed
          to draw it (it escapes the source before inserting any markup of its
          own), and this is the third surface to reach for it after the stage's
          Field Notes and the session report.

          THE SAME TWO PATHS THE SESSION REPORT USES, deliberately, so the two
          cannot disagree about one summary: `markdownResponse` when the model
          wrote a whole document, and the structured fields when it did not.
          The list items go through it too — they routinely arrive as
          "**Lead phrase**: detail", which is the exact shape the owner saw the
          asterisks on.
        */}
        <section className="past-round__summary">
          <h4>AI summary</h4>
          {showSummary ? (
            <>
              {summary.markdownResponse ? (
                <MarkdownRenderer content={summary.markdownResponse} className="past-round__md" />
              ) : (
                <>
                  {summary.summaryText && (
                    <MarkdownRenderer content={summary.summaryText} className="past-round__md" />
                  )}
                  {Array.isArray(summary.discussionQuestions) && summary.discussionQuestions.length > 0 && (
                    <>
                      <h5>Discussion</h5>
                      <ul>
                        {summary.discussionQuestions.map((q, i) => (
                          <li key={i}><MarkdownRenderer content={q} className="past-round__md" /></li>
                        ))}
                      </ul>
                    </>
                  )}
                  {Array.isArray(summary.nextSteps) && summary.nextSteps.length > 0 && (
                    <>
                      <h5>Next steps</h5>
                      <ul>
                        {summary.nextSteps.map((s, i) => (
                          <li key={i}><MarkdownRenderer content={s} className="past-round__md" /></li>
                        ))}
                      </ul>
                    </>
                  )}
                </>
              )}
              {summary.personaName && (
                <p className="past-round__voice">{`In ${summary.personaName}'s voice`}</p>
              )}
            </>
          ) : (
            <p className="past-round__empty">No summary was generated for this round.</p>
          )}

          {/*
            REGENERATE. `generateNew=true` on the existing ai-summary endpoint —
            it self-invokes a worker and returns 202, so this is a request, not
            a wait. The button says "Regenerating…" and stays disabled until the
            round comes back changed; the `aiSummaryReady` socket frame is what
            actually refreshes it.

            The label depends on whether there IS one, because "Regenerate" over
            an empty panel invites the reasonable question of what is being
            regenerated.
          */}
          <button
            type="button"
            className="btn-secondary past-round__regen"
            onClick={() => onRegenerate(round.number)}
            disabled={busy}
          >
            {busy ? 'Regenerating…' : showSummary ? 'Regenerate summary' : 'Generate summary'}
          </button>
        </section>
      </div>

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
