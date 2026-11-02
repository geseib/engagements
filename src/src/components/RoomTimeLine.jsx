import React, { useEffect, useState } from 'react';
import { roomTimeWords, timeLeft } from '../config/roundTimer';
import { serverNowMs } from '../utils/serverClock';
import './RoomTimeLine.css';

/**
 * THE ROOM'S TIME LINE (session-start D4 and F3, frames 1-b7 and 1-c3;
 * experience plan 2f): words and a thin draining bar on the room's window and
 * under a participant's answer, NEVER seconds: "About 2 minutes left", "About a
 * minute left", "Nearly time", "Time's up". The room should think, not race;
 * the seconds are the host's alone.
 *
 * `time` is the public timer ({ startedAt, limitMs, extendedMs }) from /state
 * or a frame; null draws nothing (No limit, or the host turned "show the time"
 * off). Time is the SERVER's (utils/serverClock.js). The words change at most
 * a handful of times a round, so they are a polite live region; the bar is
 * decorative. `now` overrides the clock (tests).
 */
export default function RoomTimeLine({ time, now: fixedNow = null, className = '' }) {
  const [tick, setTick] = useState(() => serverNowMs());
  const live = fixedNow === null && Boolean(time);
  useEffect(() => {
    if (!live) return undefined;
    setTick(serverNowMs());
    const interval = setInterval(() => setTick(serverNowMs()), 1000);
    return () => clearInterval(interval);
  }, [live]);
  const tl = timeLeft(time, fixedNow !== null ? fixedNow : tick);
  if (!tl) return null;
  return (
    <div className={`rtime${tl.up ? ' is-up' : ''}${className ? ` ${className}` : ''}`} data-testid="room-time">
      <span className="rtime-words" aria-live="polite">{roomTimeWords(tl.leftMs)}</span>
      <span className="rtime-bar" aria-hidden="true">
        <i style={{ width: `${Math.round(tl.fraction * 1000) / 10}%` }} />
      </span>
    </div>
  );
}
