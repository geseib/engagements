import React from 'react';
import Icon from './Icon';
import { sameFocus } from '../config/stageFocus';

/**
 * MAKE THAT BIGGER — the phone's control over what the ROOM is looking at.
 *
 * The owner: the remote *"should handle the happy path through the session, and
 * being able to enlarge a question, a specific response, etc."*
 *
 * PRESENTATIONAL. Every action is a prop and nothing here fetches, like
 * `RemoteCategoryList` and `RemoteQuestionBrowser` beside it. What a focus MEANS
 * is `config/stageFocus.js`, shared with the stage and mirrored by the endpoint,
 * so the phone's idea of "showing" cannot drift from the projector's.
 *
 * ── IT DRIVES THE PROJECTOR, NOT THE PHONE ─────────────────────────────────
 *
 * Nothing here enlarges anything on the host's own screen, and the copy says so
 * in as many words. A control on a phone that reads "Enlarge" and quietly makes
 * the phone's own text bigger would be the opposite of what a remote is for —
 * the host is holding this precisely because they are not at the laptop.
 *
 * ── ONE RESPONSE AT A TIME, AND THE ONE THAT IS SHOWING IS OBVIOUS ─────────
 *
 * The focus is a single value, so "showing" is a property of the list, not of
 * each row. Each row therefore renders as Show or Stop by comparing against the
 * one live focus rather than holding a flag of its own — two rows both believing
 * they are showing is a state the data cannot represent, and it stays that way.
 *
 * ── STALE BY CONSTRUCTION ──────────────────────────────────────────────────
 *
 * The remote holds no WebSocket (HostRemote.jsx explains the host-row eviction
 * that rules one out) and polls `/state` every two seconds, so `focus` here is
 * routinely a beat behind the room. That is why every control is idempotent at
 * the far end and why pressing Show on a row that is already showing costs
 * nothing: the host taps what they see, and what they see is a moment old.
 */
export default function RemoteFocusPanel({
  focus = { focus: 'none', index: null },
  answers = [],
  questionTitle = '',
  labelFor = (_answer, index) => `Response ${index + 1}`,
  busy = false,
  onFocus = () => {},
}) {
  const showingQuestion = sameFocus(focus, { focus: 'question' });
  const anythingShowing = !sameFocus(focus, { focus: 'none' });

  return (
    <div className="hr-focus">
      <p className="hr-focus__lead">
        These change the <b>room&apos;s screen</b>, not this phone.
      </p>

      <button
        className={`hr-btn ${showingQuestion ? 'hr-btn--primary' : 'hr-btn--ghost'}`}
        type="button"
        disabled={busy || !questionTitle}
        aria-pressed={showingQuestion}
        onClick={() => onFocus(showingQuestion ? { focus: 'none' } : { focus: 'question' })}
      >
        <Icon name={showingQuestion ? 'ArrowsIn' : 'ArrowsOut'} weight="bold" size={18} color="currentColor" />
        {showingQuestion ? 'Shrink the question' : 'Enlarge the question'}
      </button>

      {/*
        THE QUESTION'S OWN TEXT, so the host can confirm they are enlarging the
        thing they think they are. The stage shows it; the phone in their hand
        does not, and "Enlarge the question" with no question named is a button
        pressed on faith in front of a room.
      */}
      {questionTitle && <p className="hr-focus__q">{questionTitle}</p>}

      <div className="hr-focus__list">
        {answers.length === 0 ? (
          /*
            "Nothing to enlarge yet" and not an empty box. Responses arrive
            during the round, so an empty list here is the NORMAL early state
            rather than a fault, and saying which it is stops a host hunting for
            a control that is simply not due yet.
          */
          <p className="hr-focus__empty">
            No responses yet. They appear here as the room answers.
          </p>
        ) : (
          answers.map((answer, index) => {
            const showing = sameFocus(focus, { focus: 'answer', index });
            return (
              <div
                key={answer.id || answer.playerName || index}
                className={`hr-focus__row ${showing ? 'is-showing' : ''}`}
                data-testid="focus-row"
              >
                <span className="hr-focus__who">{labelFor(answer, index)}</span>
                {/*
                  The response text, CLAMPED rather than truncated with an
                  ellipsis this component controls: the host is choosing between
                  responses and needs enough of each to tell them apart. The
                  clamp is CSS, so the full string is still in the DOM for a
                  screen reader and for the copy the host might want.
                */}
                <span className="hr-focus__text">{answer.answer || answer.text || ''}</span>
                <button
                  className={`hr-btn hr-btn--small ${showing ? 'hr-btn--primary' : 'hr-btn--ghost'}`}
                  type="button"
                  disabled={busy}
                  aria-pressed={showing}
                  onClick={() => onFocus(showing ? { focus: 'none' } : { focus: 'answer', index })}
                >
                  {showing ? 'Stop showing' : 'Show the room'}
                </button>
              </div>
            );
          })
        )}
      </div>

      {/*
        ONE UNAMBIGUOUS WAY OUT, always in the same place.

        Every control above is a toggle, which is right for the row the host is
        looking at and wrong for the situation where they are not sure WHAT is
        showing — a host who walked away from the laptop, or whose phone was in
        a pocket through two taps. This is the control they can press without
        first working out the current state. Rendered only when something IS
        showing, so it is never a button that means nothing.
      */}
      {anythingShowing && (
        <button
          className="hr-btn hr-btn--ghost"
          type="button"
          disabled={busy}
          data-testid="focus-clear"
          onClick={() => onFocus({ focus: 'none' })}
        >
          <Icon name="X" weight="bold" size={18} color="currentColor" />
          Back to the normal view
        </button>
      )}
    </div>
  );
}
