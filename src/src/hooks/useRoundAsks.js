/**
 * THE ROUND'S ASKS, FOR THE HOST'S SCREENS (docs/design/followup-icons).
 *
 * The laptop and the Remote both read GET /followups/round/{nnn}: the checked
 * suggestions (with their anchors) and every ask sent this round, with its
 * count. `enabled` is false when the feature is off for the tier (the route
 * answers 404), and then every screen shows nothing.
 *
 * Reads when the round reaches its results and whenever `refreshKey` changes
 * (the page bumps it on `followUpChanged`, `aiSummaryReady` and
 * `stageBeatChanged`). A read that fails keeps what was there.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchRoundAsks } from '../utils/followUpsClient';

const EMPTY = { enabled: false, suggestions: null, asks: [], live: null };

export default function useRoundAsks({ fetchFn, apiBase, gameId, round, active, refreshKey }) {
  const [data, setData] = useState(EMPTY);
  const seq = useRef(0);
  const keyRef = useRef('');

  const load = useCallback(async () => {
    if (!gameId || !round || !active) return;
    seq.current += 1;
    const mine = seq.current;
    const r = await fetchRoundAsks({ fetchFn, apiBase, gameId, round });
    if (mine !== seq.current || !r.ok) return;
    setData({ enabled: r.enabled, suggestions: r.suggestions, asks: r.asks, live: r.live });
  }, [fetchFn, apiBase, gameId, round, active]);

  // A new round's asks are different rows: drop the old ones at once.
  useEffect(() => {
    const key = `${gameId}#${round}`;
    if (keyRef.current !== key) { keyRef.current = key; setData(EMPTY); }
  }, [gameId, round]);

  useEffect(() => { load(); }, [load, refreshKey]);

  const asks = data.asks || [];
  const live = asks.find((a) => a.status === 'live') || null;
  const shown = [...asks].reverse().find((a) => a.status === 'live' || a.status === 'closed') || null;
  const sentIndexes = new Set(asks.filter((a) => a.status !== 'cancelled' && Number.isInteger(a.suggestionIndex)).map((a) => a.suggestionIndex));
  const suggestions = (data.suggestions && Array.isArray(data.suggestions.asks) ? data.suggestions.asks : []);
  return {
    enabled: data.enabled,
    suggestions,
    // Suggestions not yet sent this round (cancelled ones come back).
    unsent: suggestions.map((ask, index) => ({ ask, index })).filter((s) => !sentIndexes.has(s.index)),
    asks,
    live,
    shown,
    reload: load,
  };
}
