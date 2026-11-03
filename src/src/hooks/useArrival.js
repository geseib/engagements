import { useEffect, useRef, useState } from 'react';

/**
 * THE ONE MOTION'S TRIGGER (docs/design/console-rail README D4; owner, 3 Nov
 * 2026, fork 3: "fade in once, never repeated flashing").
 *
 * `ids` are the ids of the items that can light a surface (the Now items for
 * the Needs-you line, the name requests for the People header). The hook
 * answers true for one fade's length when a NEW id appears, and false
 * otherwise: not on the first render (a reload, a reconnect or a remount
 * finds the item already there, so it is drawn lit without a fade), not when
 * an item clears (no fade-out), and not on a re-render with the same ids.
 *
 * Every caller reads the same item list in the same render, so the Needs-you
 * line and the People header set `data-arrived` in the same commit and their
 * fades start together: one alarm in two places, not two alarms.
 *
 * `onArrive` runs once per arrival (ConsoleRail opens People with it).
 */
export const ARRIVE_MS = 240;

export default function useArrival(ids = [], onArrive = null) {
  const key = (ids || []).join('\u0001');
  const seen = useRef(null);
  const arriveRef = useRef(onArrive);
  arriveRef.current = onArrive;
  const [arrived, setArrived] = useState(false);
  useEffect(() => {
    const now = new Set(key ? key.split('\u0001') : []);
    const before = seen.current;
    seen.current = now;
    if (before === null) return;
    const fresh = [...now].some((id) => !before.has(id));
    if (!fresh) return;
    setArrived(true);
    if (typeof arriveRef.current === 'function') arriveRef.current();
  }, [key]);
  useEffect(() => {
    if (!arrived) return undefined;
    // A little past the fade, so the attribute is never removed mid-paint.
    const t = setTimeout(() => setArrived(false), ARRIVE_MS + 120);
    return () => clearTimeout(t);
  }, [arrived]);
  return arrived;
}
