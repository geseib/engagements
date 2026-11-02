import React, { useEffect, useState } from 'react';
import Eyebrow from '../ui/Eyebrow';
import Button from '../ui/Button';
import { pulseFor, pulsePhase, PULSE_WORDS } from '../../config/consolePulse';
import { TIMER_WORDS } from '../../config/roundTimer';
import { serverNowMs } from '../../utils/serverClock';
import TimeRing from './TimeRing';
import './ConsolePulse.css';

/** Reduced motion: the ring moves in 10 s steps (session-start D3). */
function prefersReducedMotion() {
  try {
    return Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch (e) {
    return false;
  }
}

/**
 * THE PULSE (session-start D3; experience plan Phase 2 step 2c): three tiles
 * under the Needs-you line on the console. Pure props; the facts come from
 * config/consolePulse.js. The tile keeps the number, the People column keeps
 * the names.
 *
 * The clock ticks HERE, once a second and only while a round is open, so the
 * host page does not re-render to move "Open 1:24". `now` overrides it (tests).
 *
 * aria-live: only on tile 1's sub line, polite, so a screen reader hears
 * "Everyone's in" when it happens; the time is never announced every second.
 *
 * THE TIMER (experience plan 2f): `timer` is the round timer of the phase that
 * is on (config/roundTimer.js), and the clock is the SERVER's
 * (utils/serverClock.js), never this laptop's alone. `onAddMinute` draws +1 min
 * on the tile while a timer runs or is over.
 */
export default function ConsolePulse({
  moment, players = 0, answered = 0, voted = 0, everyoneIn = null,
  openedAt = null, voteAt = null, resultsAt = null, arrivals = [], late = 0,
  onLate = null, now: fixedNow = null, timer = null, onAddMinute = null,
  /* Trivia's "Correct so far" ({ right, of }), or null: tile 3 is then the since tile. */
  correct = null,
  /* Trivia and Poll have no vote: after the round tile 1 says "N here", not "0 voted". */
  noVote = false,
}) {
  const ticking = fixedNow === null && ['answer', 'vote'].includes(pulsePhase(moment));
  const [tick, setTick] = useState(() => serverNowMs());
  useEffect(() => {
    if (!ticking) return undefined;
    setTick(serverNowMs());
    const interval = setInterval(() => setTick(serverNowMs()), 1000);
    return () => clearInterval(interval);
  }, [ticking]);
  const now = fixedNow !== null ? fixedNow : tick;
  const ringStepMs = prefersReducedMotion() ? 10000 : 0;
  const { phase, room, time, since } = pulseFor({ moment, players, answered, voted, everyoneIn, openedAt, voteAt, resultsAt, now, arrivals, late, timer, ringStepMs, noVote });
  const timed = time.state !== 'none';
  return (
    <section className="cpulse" aria-label="The room this round" data-phase={phase}>
      <div className={`cpulse-tile cpulse-room${room.everyoneIn ? ' is-in' : ''}`} data-tile="room">
        <Eyebrow tone="muted">{room.eyebrow}</Eyebrow>
        <p className="cpulse-num" data-testid="pulse-count">{room.value} <small>{room.of}</small></p>
        {room.bar !== null ? (
          <div className="cpulse-bar" role="presentation"><i style={{ width: `${Math.round(room.bar * 100)}%` }} /></div>
        ) : null}
        <p className="cpulse-sub" aria-live="polite">
          {room.everyoneIn ? <span className="cpulse-in" aria-hidden="true">✓ </span> : null}
          {room.sub}
        </p>
      </div>
      <div className={`cpulse-tile cpulse-time${time.state === 'up' ? ' is-up' : ''}`} data-tile="time" data-time-state={time.state}>
        <Eyebrow tone="muted">{time.eyebrow}</Eyebrow>
        {timed ? (
          <div className="cpulse-timer">
            <TimeRing fraction={time.ring} up={time.state === 'up'} className="cpulse-ring" />
            <div className="cpulse-timer-text">
              <p className="cpulse-val" data-testid="pulse-time">{time.value}</p>
              {time.sub ? <p className="cpulse-sub" data-testid="pulse-time-sub">{time.sub}</p> : null}
            </div>
            {onAddMinute ? (
              <Button variant="quiet" size="sm" className="cpulse-plus" onClick={onAddMinute} title={`${TIMER_WORDS.plusOneLabel} (${TIMER_WORDS.plusOneKeys})`} aria-keyshortcuts="+ =">
                {TIMER_WORDS.plusOne}
              </Button>
            ) : null}
          </div>
        ) : (
          <>
            <p className="cpulse-val" data-testid="pulse-time">{time.value}</p>
            {time.sub ? <p className="cpulse-sub">{time.sub}</p> : null}
          </>
        )}
      </div>
      {correct ? (
        /* TRIVIA'S TILE 3 (experience plan §3.2a, 2g): how many have the right
           answer so far, host-only. It takes the "since" tile's place; the
           late count stays on it, so nothing that tile carried is lost. */
        <div className="cpulse-tile cpulse-since cpulse-correct" data-tile="correct">
          <Eyebrow tone="muted">{PULSE_WORDS.correct}</Eyebrow>
          <p className="cpulse-num" data-testid="pulse-correct">{correct.right} <small>{PULSE_WORDS.correctOf(correct.of)}</small></p>
          <p className="cpulse-sub">{PULSE_WORDS.onlyYou}</p>
          {since.late ? (
            onLate
              ? <Button variant="quiet" size="sm" className="cpulse-late" onClick={onLate}>{since.late.text}</Button>
              : <p className="cpulse-sub">{since.late.text}</p>
          ) : null}
        </div>
      ) : (
      <div className="cpulse-tile cpulse-since" data-tile="since">
        <Eyebrow tone="muted">{since.eyebrow}</Eyebrow>
        <p className="cpulse-val" data-testid="pulse-since">{since.value}</p>
        {since.sub ? <p className="cpulse-sub" title={since.sub}>{since.sub}</p> : null}
        {since.late ? (
          onLate
            ? <Button variant="quiet" size="sm" className="cpulse-late" onClick={onLate}>{since.late.text}</Button>
            : <p className="cpulse-sub">{since.late.text}</p>
        ) : null}
      </div>
      )}
    </section>
  );
}
