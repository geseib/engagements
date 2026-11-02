import React from 'react';
import { ENDED } from '../config/playerWords';

/**
 * ONE ENDED SCREEN, EVERY PARTICIPANT TYPE (experience plan 3a and 3e; audit C
 * P5, P6).
 *
 * Audit C found the game end and the survey end disagreeing on every line:
 * "Thanks for playing" over a poll, "Final score 0" on a poll and on
 * Wavelength (neither scores), a green strip on one and a neutral one on the
 * other, and a survey inside an event saying "You can close this page" while
 * the event's own rule is the opposite. Both ends now draw this.
 *
 *   scored     the format scores (config/scoreboard.js `hasScoreboard`): the
 *              heading thanks them for playing and the score rows show.
 *              Otherwise "Thanks for taking part" and no score at all.
 *   event      an event's item: { onAgenda, nextTitle }. The eyebrow says the
 *              ITEM is finished, the line says keep the page open, "Up next"
 *              names what follows when the agenda knows, and the dock (see
 *              `PlayerEndedDock`) opens the agenda. Never "close this page".
 *   children   whatever else the end offers (a game's "Something to add?"),
 *              drawn after the score, before the look-up line.
 *
 * Words come from config/playerWords.js ENDED and nowhere else.
 */
export default function PlayerEnded({
  name = '',
  scored = false,
  score = null,
  standing = null,
  event = null,
  lookUp = null,
  children = null,
}) {
  const inEvent = Boolean(event);
  return (
    <>
      <p className="plr-lab">{inEvent ? ENDED.itemEyebrow : ENDED.eyebrow}</p>
      <h1 className="plr-h1 plr-h1--primary">{scored ? ENDED.scored(name) : ENDED.unscored(name)}</h1>

      {scored && (
        <>
          <hr className="plr-sep" />
          <div className="plr-stat">
            <span className="plr-k">{ENDED.finalScore}</span>
            <span className="plr-v">{score ?? 0}</span>
          </div>
          {standing && (
            <div className="plr-stat">
              <span className="plr-k">{ENDED.finalStanding}</span>
              <span className="plr-v">{standing}</span>
            </div>
          )}
        </>
      )}

      {children}

      {lookUp}

      {inEvent && event.nextTitle && (
        <p className="plr-ended-next" data-testid="ended-next">
          <span className="plr-k">{ENDED.next}</span>{' '}
          <b>{event.nextTitle}</b>
        </p>
      )}
      <p className="plr-help plr-ended-line">
        {inEvent ? ENDED.eventLine : ENDED.closeLine}
      </p>
    </>
  );
}

/** The ended screen's dock: in an event, the agenda is one tap. */
export function PlayerEndedDock({ event = null }) {
  if (!event || typeof event.onAgenda !== 'function') return null;
  return (
    <button type="button" className="plr-btn" onClick={() => event.onAgenda()}>
      {ENDED.agenda}
    </button>
  );
}
