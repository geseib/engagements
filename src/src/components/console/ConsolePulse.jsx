import React, { useEffect, useState } from 'react';
import Eyebrow from '../ui/Eyebrow';
import Button from '../ui/Button';
import { pulseFor, pulsePhase } from '../../config/consolePulse';
import './ConsolePulse.css';

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
 */
export default function ConsolePulse({
  moment, players = 0, answered = 0, voted = 0, everyoneIn = null,
  openedAt = null, voteAt = null, resultsAt = null, arrivals = [], late = 0,
  onLate = null, now: fixedNow = null,
}) {
  const ticking = fixedNow === null && ['answer', 'vote'].includes(pulsePhase(moment));
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return undefined;
    setTick(Date.now());
    const timer = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ticking]);
  const now = fixedNow !== null ? fixedNow : tick;
  const { phase, room, time, since } = pulseFor({ moment, players, answered, voted, everyoneIn, openedAt, voteAt, resultsAt, now, arrivals, late });
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
      <div className="cpulse-tile cpulse-time" data-tile="time">
        <Eyebrow tone="muted">{time.eyebrow}</Eyebrow>
        <p className="cpulse-val" data-testid="pulse-time">{time.value}</p>
        {time.sub ? <p className="cpulse-sub">{time.sub}</p> : null}
      </div>
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
    </section>
  );
}
