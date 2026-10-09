/**
 * THE ROOM'S ROSTER, for the Session panel and the request strip.
 *
 * One read of GET /games/{id}/players (the route every engagement's Players
 * tab uses: it carries who is here, when they joined and whether a name is
 * unlocked or asked for) that the page repeats when the websocket says the
 * roster moved (a name was asked for, a player removed or brought back, on this
 * device or the host's other one) and when the panel opens.
 *
 * It never throws: a roster that cannot be read leaves the last one in place
 * rather than blanking the people the host is looking at.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export const NO_ROSTER = Object.freeze({ players: [], removed: [] });

/** The people asking to take a name that has not been unlocked for them yet. */
export const askingOf = (players) => (players || []).filter((p) => p.handover && p.handover.requested && !p.handover.open);

export default function useBuildPlayers(api) {
  const [roster, setRoster] = useState(NO_ROSTER);
  const seq = useRef(0);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const load = useCallback(async () => {
    seq.current += 1;
    const mine = seq.current;
    try {
      const out = await api.players();
      if (!alive.current || mine !== seq.current) return;
      setRoster({
        players: Array.isArray(out && out.players) ? out.players : [],
        removed: Array.isArray(out && out.removedPlayers) ? out.removedPlayers : [],
      });
    } catch (e) {
      /* keep what is on screen */
    }
  }, [api]);

  return [roster, load];
}
