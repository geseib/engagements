import React from 'react';
import AnswerSpotlight from './AnswerSpotlight';
import MarkdownRenderer from './MarkdownRenderer';
import {
  hasSummary, snippetOf, podiumAnswers, roundIsAttributed,
} from '../config/sessionHistory';
import { displayLabelFor } from '../config/anonymity';

/**
 * ONE ROUND'S REPORT — the question, what the room said, and what the AI made
 * of it. The artifact itself, with no container around it.
 *
 * ── WHY THIS IS A SEPARATE COMPONENT ───────────────────────────────────────
 *
 * This was the body of `PastRound`, and `PastRound` is a `<Modal>`. When the
 * owner asked for a feedback round they were explicit about what participants
 * hold: *"they should have a copy of the feedback report (the same item that is
 * avail when you click the previous round in the session rounds screen"*.
 *
 * The same item — so a second renderer is out. But a modal is the wrong
 * container for a participant's primary surface. It owns Escape, a focus trap
 * and a scroll lock, all of which belong to a dialog laid over something else;
 * it carries a close button that on a phone would strand the participant on an
 * empty page; and `RemoteSessionPanel` already settled that this codebase does
 * not put modals over a phone's primary surface — it expands rounds inline
 * *"deliberately — a modal on a phone covers the dock"*.
 *
 * So: one renderer, two containers.
 *
 *     PastRound  = <Modal> + head + <RoundReport/> + prev/next nav   (host)
 *     PlayerPage = <RoundReport/> inline, in the player's dusk shell  (room)
 *
 * ── WHAT STAYED BEHIND, AND WHY ────────────────────────────────────────────
 *
 * The spotlight STATE and the document keyboard handler stayed in `PastRound`.
 * Both are properties of the container, not of the artifact: the keyboard
 * handler steps between ROUNDS, which only the paging container has, and it
 * must fall silent while a response is open because both dialogs bind Left and
 * Right on `document`. The player's surface pages nothing and binds nothing, so
 * it holds a spotlight index and no keys at all.
 *
 * ── CLASS NAMES ARE UNCHANGED ──────────────────────────────────────────────
 *
 * `styles.css:11651-11855` styles this markup and `sessionHistory.test.jsx`
 * asserts against it. Nothing here is renamed. If that suite moves, the
 * extraction changed the host's DOM and the extraction is what is wrong.
 *
 * ── WHO WROTE WHAT ─────────────────────────────────────────────────────────
 *
 * Unchanged from `PastRound`, and the reasoning is worth keeping in front of
 * whoever edits this next. This asks `displayLabelFor(answer, i)` and nothing
 * else, because THE ROW IS THE ANSWER: `create-report.js` decides attribution
 * per round through the `isHidden()` gate and OMITS `playerName` from the
 * rounds still hidden. A caller-supplied `labelFor` used to exist here and was
 * deleted — it answered a per-round question with the session-wide
 * `authorsRevealed` flag, which relabelled three long-finished rounds
 * "Response 1, 2, 3" while round four sat in ASK.
 */
export default function RoundReport({
  round,
  /** Which response is open on top of this, or null. Owned by the container. */
  spotlight = null,
  onSpotlight = () => {},
  /**
   * Regenerate this round's summary, given the round NUMBER (the zero-padded
   * string, which is what the ai-summary endpoint wants as its questionId).
   *
   * Optional, and its absence is the participant's case: a control that re-runs
   * a Bedrock call for the whole room is not something to put on forty phones.
   * The affordance is gated on the handler existing rather than rendered dead —
   * a dead control is the one people reach for first.
   */
  onRegenerate,
  /** True while this round's summary is being regenerated. */
  regenerating = false,
}) {
  if (!round) return null;

  const summary = round.aiSummary || {};
  const showSummary = hasSummary(round);
  const podium = podiumAnswers(round);
  const answers = Array.isArray(round.answers) ? round.answers : [];
  const options = Array.isArray(round.options) ? round.options : [];

  return (
    <div className="past-round__body">
      {/* THE QUESTION. Shown, not just the results — a results screen with no
          question on it is unreadable a quarter of an hour later. */}
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
        {options.length > 0 && (
          <ul className="past-round__options">
            {options.map((option, i) => (
              <li key={i}>{option}</li>
            ))}
          </ul>
        )}
        {round.answerDetails && <p className="past-round__answer-detail">{round.answerDetails}</p>}
      </section>

      {/* WHAT THE ROOM SAID. */}
      <section className="past-round__results">
        <h4>Responses</h4>
        {answers.length === 0 ? (
          /* A round with no responses is a real outcome and has to read as one.
             Rendering an empty list instead looks like a load that failed,
             which sends the reader looking for a bug. */
          <p className="past-round__empty">Nobody responded to this round.</p>
        ) : (
          /*
            THE BRIEF BAR, AND A WAY INTO THE WHOLE THING.

              "i do like the brief bar of the answers, but i think we need an
               easy way to review these in detail. so if each of the 3 has a
               number in a circle, the start of their answer, their name and you
               click that number the full modal shows there answer."

            EVERY ROW IS CLICKABLE, not only the three. The circle marks the
            three the owner singled out, but a row shows a SNIPPET, so a
            fourth-place response with no way to open it would be a response
            nobody can read.

            A BUTTON, NOT A CLICKABLE SPAN — reachable by Tab, operable by Enter
            and Space, and the accessible name has to say which response it
            opens and whose it is, because the ordinal alone reads as "1" to a
            screen reader and names nothing.

            THE NUMBER SHOWN IS THE PLACEMENT; THE THING OPENED IS THE ROW.
            Those are two different numbers and ties are where they diverge:
            create-report gives equal scores equal ranks (1, 1, 3), so two
            circles both read "1". The handler therefore closes over the ROW'S
            OWN POSITION `i` — never over the number printed on it.
          */
          <ol className="past-round__answers">
            {answers.map((answer, i) => {
              const who = displayLabelFor(answer, i);
              return (
                <li key={i} className={answer.rank === 1 ? 'is-lead' : ''}>
                  <button
                    type="button"
                    className={`past-round__rank${i < podium.length ? ' is-podium' : ''}`}
                    onClick={() => onSpotlight(i)}
                    aria-label={`Read response ${i + 1} in full, by ${who}`}
                  >
                    {answer.rank || i + 1}
                  </button>
                  <span className="past-round__answer">{snippetOf(answer.answer)}</span>
                  <span className="past-round__who">{who}</span>
                </li>
              );
            })}
          </ol>
        )}

        {/*
          THE FULL RESPONSE, reusing the dialog the RESULTS stage already uses
          rather than building a second one — same clamped pager, same X, same
          backdrop, same scroll contract.

          `showPoints` follows the names (a score beside a response is
          attribution by arithmetic), and `roundIsAttributed` reads that off the
          rows for the same reason the label does.
        */}
        <AnswerSpotlight
          answers={answers}
          index={spotlight}
          onIndex={onSpotlight}
          onClose={() => onSpotlight(null)}
          labelFor={displayLabelFor}
          showPoints={roundIsAttributed(round)}
          closeOnKey
          onJump={onSpotlight}
          title={`Round ${round.ordinal} response`}
        />
      </section>

      {/*
        WHAT THE AI MADE OF IT — AS MARKDOWN, WHICH IS WHAT IT IS.

        Every one of these fields is model output and `personas.js`'s output
        contract tells the model it may write markdown, so a plain <p> prints
        the asterisks. `MarkdownRenderer` is the one renderer allowed to draw it.

        THE SAME TWO PATHS THE SESSION REPORT USES, deliberately, so the two
        cannot disagree about one summary: `markdownResponse` when the model
        wrote a whole document, and the structured fields when it did not.
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
          it self-invokes a worker and returns 202, so this is a request, not a
          wait. The `aiSummaryReady` socket frame is what actually refreshes it.

          The label depends on whether there IS one, because "Regenerate" over
          an empty panel invites the reasonable question of what is being
          regenerated.
        */}
        {onRegenerate && (
          <button
            type="button"
            className="btn-secondary past-round__regen"
            onClick={() => onRegenerate(round.number)}
            disabled={regenerating}
          >
            {regenerating ? 'Regenerating…' : showSummary ? 'Regenerate summary' : 'Generate summary'}
          </button>
        )}
      </section>
    </div>
  );
}
