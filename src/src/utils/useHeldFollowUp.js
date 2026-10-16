import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * A DRAFT ANSWER TO A QUESTION FOR THE ROOM IS NEVER LOST (session flow v3
 * §4.4: "The answer box stays open while the player is typing. If the round
 * closes first, Send still works.").
 *
 * While FollowUpCard holds something unsent, the ask it belongs to is kept
 * here, keyed by its askId and round, so the room moving on (the public read
 * goes null) does not unmount the card; Send then keeps the answer late.
 * After a late send the card stays up, with its line, until the session's
 * state next changes. Emptied, or sent on time, it is let go.
 *
 *   held          { ask, draft, late } or null
 *   onDraft(ask)  the card's onDraft for that ask: (value|null) => void
 *   keptLate(ask) the server kept the answer late
 *   release()     let it go (sent on time, or the player chose to leave it)
 *   heldFor(ask)  the held entry when it is this ask, else null
 */
const same = (a, b) => Boolean(a && b && a.askId === b.askId && a.round === b.round);

export default function useHeldFollowUp(gameState) {
  const [held, setHeld] = useState(null);
  const stateRef = useRef(gameState);
  stateRef.current = gameState;

  useEffect(() => {
    setHeld((h) => (h && h.late && h.releaseOn !== gameState ? null : h));
  }, [gameState]);

  const onDraft = useCallback((ask) => (value) => {
    if (value !== null && value !== undefined) {
      setHeld((h) => ({ ask: same(h && h.ask, ask) ? h.ask : ask, draft: value, late: false, releaseOn: null }));
    } else {
      setHeld((h) => (h && h.late ? h : null));
    }
  }, []);
  const keptLate = useCallback((ask) => {
    setHeld({ ask, draft: null, late: true, releaseOn: stateRef.current });
  }, []);
  const release = useCallback(() => setHeld(null), []);
  const heldFor = (ask) => (held && same(held.ask, ask) ? held : null);

  return { held, onDraft, keptLate, release, heldFor };
}
