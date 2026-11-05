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
 * THE ROOM TILE (owner, 5 Nov 2026, cut 5; host-attention PLAN §4.2): one
 * tile under Your part now on the console, where three were. Pure props; the
 * facts come from config/consolePulse.js pulseFor, the counts from
 * config/roomProgress.js (`progress`). A caller with only numbers passes
 * `players`, `answered`, `voted` and gets the same tile without names.
 *
 *   9/15 answered                     open 1:51
 *   ▓▓▓▓▓▓▓▓▓▓░░░░░░
 *   Waiting on Hannah, Ravi, Grace · away: Tom
 *   +1 joined · Bob                   (only when someone has)
 *
 * The clock ticks HERE, once a second and only while a step collects, so the
 * host page does not re-render to move "open 1:24". `now` overrides it (tests).
 *
 * aria-live: only on the nudge line, polite, so a screen reader hears
 * "Everyone's in" when it happens; the time is never announced every second.
 *
 * THE TIMER (experience plan 2f): `timer` is the round timer of the phase that
 * is on (config/roundTimer.js), on the SERVER's clock (utils/serverClock.js).
 * `onAddMinute` draws +1 min beside it while a timer runs or is over.
 */
export default function ConsolePulse({
  moment, progress = null, players = 0, answered = 0, voted = 0, everyoneIn = null,
  openedAt = null, voteAt = null, askAt = null, arrivals = [],
  now: fixedNow = null, timer = null, onAddMinute = null,
  /* Trivia's "Correct so far" ({ right, of }), or null: one host-only line. */
  correct = null,
  /* Trivia and Poll have no vote: no vote count, ever. */
  noVote = false,
  /* The answers are options (consolePulse answersAreChoices): "still answering". */
  choice = false,
}) {
  const ticking = fixedNow === null && ['answer', 'vote', 'ask'].includes(pulsePhase(moment));
  const [tick, setTick] = useState(() => serverNowMs());
  useEffect(() => {
    if (!ticking) return undefined;
    setTick(serverNowMs());
    const interval = setInterval(() => setTick(serverNowMs()), 1000);
    return () => clearInterval(interval);
  }, [ticking]);
  const now = fixedNow !== null ? fixedNow : tick;
  const ringStepMs = prefersReducedMotion() ? 10000 : 0;
  const { phase, room, time, joined } = pulseFor({
    moment, progress, players, answered, voted, everyoneIn, openedAt, voteAt, askAt, now, arrivals, timer, ringStepMs, noVote, choice,
  });
  const timed = Boolean(time && time.state !== 'none');
  const label = [room.value ? `${room.value}${room.of} ${room.verb}` : room.record, room.nudgeTitle || room.nudge].filter(Boolean).join('. ');
  return (
    <section className="cpulse" aria-label="The room this round" data-phase={phase}>
      <div className={`cpulse-tile cpulse-room${room.everyoneIn ? ' is-in' : ''}`} data-tile="room" role="group" title={room.nudgeTitle || undefined} aria-label={label || undefined}>
        <div className="cpulse-head">
          <Eyebrow tone="muted">{room.eyebrow}</Eyebrow>
          {room.steps ? <span className="cpulse-steps" data-testid="pulse-steps">{room.steps}</span> : null}
        </div>
        <div className="cpulse-row">
          {room.value ? (
            <p className="cpulse-num" data-testid="pulse-count">
              {room.value}<small>{room.of}</small> <span className="cpulse-verb">{room.verb}</span>
            </p>
          ) : (
            <p className="cpulse-val" data-testid="pulse-count">{room.record}</p>
          )}
          {time ? (
            <div className={`cpulse-time${time.state === 'up' ? ' is-up' : ''}`} data-tile="time" data-time-state={time.state}>
              {timed ? <TimeRing fraction={time.ring} up={time.state === 'up'} className="cpulse-ring" /> : null}
              <div className="cpulse-timer-text">
                <p className="cpulse-clock" data-testid="pulse-time">{time.value}</p>
                {time.sub ? <p className="cpulse-sub" data-testid="pulse-time-sub">{time.sub}</p> : null}
              </div>
              {timed && onAddMinute ? (
                <Button variant="secondary" size={36} className="cpulse-plus" onClick={onAddMinute} title={`${TIMER_WORDS.plusOneLabel} (${TIMER_WORDS.plusOneKeys})`} aria-keyshortcuts="+ =">
                  {TIMER_WORDS.plusOne}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
        {room.bar !== null ? (
          <div className="cpulse-bar" role="presentation"><i style={{ width: `${Math.round(room.bar * 100)}%` }} /></div>
        ) : null}
        {room.nudge || room.bar !== null ? (
          <p className="cpulse-nudge" aria-live="polite" data-testid="pulse-nudge" title={room.nudgeTitle || undefined}>
            {room.everyoneIn ? <span className="cpulse-in" aria-hidden="true">✓ </span> : null}
            {room.nudge}
          </p>
        ) : null}
        {joined ? <p className="cpulse-sub" data-testid="pulse-joined" title={joined}>{joined}</p> : null}
        {correct ? (
          /* TRIVIA'S "CORRECT SO FAR" (experience plan §3.2a, 2g): host-only,
             one line in the room tile, never on the room's screen. */
          <p className="cpulse-sub cpulse-correct" data-testid="pulse-correct">
            {`${PULSE_WORDS.correct}: ${correct.right} ${PULSE_WORDS.correctOf(correct.of)} · ${PULSE_WORDS.onlyYou}`}
          </p>
        ) : null}
      </div>
    </section>
  );
}
