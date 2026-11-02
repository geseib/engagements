import React, { useEffect, useState } from 'react';
import TimeRing from './console/TimeRing';
import Button from './ui/Button';
import { timeLeft, clock, TIMER_WORDS } from '../config/roundTimer';
import { serverNowMs } from '../utils/serverClock';

/**
 * THE REMOTE'S TIME CARD (session-start D5 C2, frame 1-c2; experience plan
 * 2f): the round timer on the host's phone, beside the meter it already has.
 * The host's own screen, so seconds are fine here: "0:47 left of 2:00", and
 * amber "Time's up · 0:18 over 2:00" at zero. +1 min is one press.
 *
 * `timer` is the host's view of the timer of the phase that is on; the clock
 * is the SERVER's (utils/serverClock.js). Styled by HostRemote.css (`hr-time`).
 */
export default function RemoteTimeCard({ timer, onAddMinute, busy = false, now: fixedNow = null }) {
  const [tick, setTick] = useState(() => serverNowMs());
  useEffect(() => {
    if (fixedNow !== null || !timer) return undefined;
    setTick(serverNowMs());
    const interval = setInterval(() => setTick(serverNowMs()), 1000);
    return () => clearInterval(interval);
  }, [fixedNow, timer]);
  const tl = timeLeft(timer, fixedNow !== null ? fixedNow : tick);
  if (!tl) return null;
  const given = clock(tl.givenMs);
  return (
    <section className={`hr-time${tl.up ? ' is-up' : ''}`} aria-label={TIMER_WORDS.remoteHeading} data-testid="remote-time">
      <p className="hr-time-k">{TIMER_WORDS.remoteHeading}</p>
      <div className="hr-time-row">
        <TimeRing fraction={tl.up ? 0 : tl.fraction} up={tl.up} className="hr-time-ring" />
        <div className="hr-time-text">
          <p className="hr-time-v" data-testid="remote-time-value">{tl.up ? TIMER_WORDS.timesUp : clock(tl.leftMs)}</p>
          <p className="hr-time-sub">{tl.up ? TIMER_WORDS.overOf(clock(tl.overMs), given) : TIMER_WORDS.leftOf(given)}</p>
        </div>
        {onAddMinute ? (
          <Button variant="secondary" size={44} className="hr-time-plus" onClick={onAddMinute} disabled={busy} aria-label={TIMER_WORDS.plusOneLabel}>
            {TIMER_WORDS.plusOne}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
