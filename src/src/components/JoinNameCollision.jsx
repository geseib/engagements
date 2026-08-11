import React from 'react';
import Icon from './Icon';
import './JoinNameCollision.css';

/**
 * The screen the second Chris now sees instead of quietly inheriting the first
 * Chris's answers and score.
 *
 * Two refusals, and the difference between them is the whole point:
 *
 *   name-taken       the name is provably held by another browser. There is no
 *                    "continue anyway" here — offering one would hand back the
 *                    silent merge this exists to stop.
 *   name-unverified  the session predates identity stamping, so the server
 *                    genuinely cannot tell a returning player from a namesake.
 *                    It does not guess: it asks, and the answer comes from the
 *                    person, who is the only one who knows.
 *
 * Shaped after docs/design/player-redesign/04-join-locked.html — a blocking
 * join sub-state that says what happened in a sentence, says what to do about
 * it, and offers stacked full-width actions rather than an alert() the player
 * can only dismiss.
 */
function JoinNameCollision({
  kind,
  playerName,
  message,
  onRejoinAnyway,
  onUseAnotherName,
}) {
  const ambiguous = kind === 'name-unverified';

  return (
    <div className="join-name-collision" role="alert">
      <h2 className="join-name-collision__heading">
        {ambiguous
          ? `Are you the ${playerName} already here?`
          : 'That name is taken.'}
      </h2>

      <p className="join-name-collision__detail">
        <Icon name="Info" weight="duotone" size={18} color="var(--primary)" />{' '}
        {message}
      </p>

      <div className="join-name-collision__actions">
        {ambiguous && (
          <button
            type="button"
            className="btn-primary btn-large"
            onClick={onRejoinAnyway}
          >
            Yes — rejoin as {playerName}
          </button>
        )}
        <button
          type="button"
          className={`${ambiguous ? 'btn-secondary' : 'btn-primary'} btn-large`}
          onClick={onUseAnotherName}
        >
          {ambiguous ? `No — I'm a different ${playerName}` : 'Pick a different name'}
        </button>
      </div>
    </div>
  );
}

export default JoinNameCollision;
