import React, { useCallback, useEffect } from 'react';
import Modal from './Modal';
import Icon from './Icon';
import { step, canStep, positionLabel } from '../utils/stepIndex';
import { hasSummary } from '../config/sessionHistory';

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
  /** How to label an author. Passed in so anonymity is decided in one place. */
  labelFor = (a) => a.playerName || 'Anonymous',
}) {
  const total = rounds.length;
  const open = Number.isInteger(index) && index >= 0 && index < total;

  const move = useCallback((delta) => {
    const next = step(index, delta, total);
    if (next !== null && next !== index) onIndex(next);
  }, [index, total, onIndex]);

  // Same clicker keys as the answer spotlight, for the same reason. Escape is
  // <Modal>'s and is deliberately not handled twice.
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

  const round = rounds[index];
  const busy = regenerating.includes(round.number);
  const summary = round.aiSummary || {};
  const showSummary = hasSummary(round);

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
            <ol className="past-round__answers">
              {round.answers.map((answer, i) => (
                <li key={i} className={answer.rank === 1 ? 'is-lead' : ''}>
                  <span className="past-round__rank">{answer.rank || '·'}</span>
                  <span className="past-round__answer">{answer.answer}</span>
                  <span className="past-round__who">{labelFor(answer, i)}</span>
                </li>
              ))}
            </ol>
          )}
        </section>

        {/* WHAT THE AI MADE OF IT. */}
        <section className="past-round__summary">
          <h4>AI summary</h4>
          {showSummary ? (
            <>
              {summary.summaryText && <p>{summary.summaryText}</p>}
              {Array.isArray(summary.discussionQuestions) && summary.discussionQuestions.length > 0 && (
                <>
                  <h5>Discussion</h5>
                  <ul>
                    {summary.discussionQuestions.map((q, i) => <li key={i}>{q}</li>)}
                  </ul>
                </>
              )}
              {Array.isArray(summary.nextSteps) && summary.nextSteps.length > 0 && (
                <>
                  <h5>Next steps</h5>
                  <ul>
                    {summary.nextSteps.map((s, i) => <li key={i}>{s}</li>)}
                  </ul>
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
