/**
 * DEV'S AI MODEL PICKER, FOR STAFF (docs/handoff/ai-model-picker-2026-10-11.md).
 *
 * The server decides whether the picker exists: GET
 * /games/{id}/ai-summary/host?questionId=<nnn>&variants=true answers with
 * `modelPicker` only on dev (template AiModelPicker) and only to Engage staff.
 * Anywhere else it answers as an ordinary read and `info` stays null, so
 * nothing is drawn. The hostname is never consulted.
 *
 * `round` is the round whose read is on screen (null off What We Heard).
 * `staff` only saves a pointless request for a host who is not in `admins`;
 * the server checks again.
 *
 * Redo with a model writes that model's variant and leaves the room's read
 * alone, so this polls the variants until the new one lands rather than
 * waiting on the room's aiSummaryReady.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export const POLL_MS = 4000;
export const POLL_LIMIT = 75; // five minutes: past the worker's 300s ceiling

/** Has the variant for `modelId` been written since `since` (ms)? */
export function landedSince(variants, modelId, since) {
  const v = (variants || []).find((x) => x.modelRequested === modelId);
  return Boolean(v && v.generatedAt && Date.parse(v.generatedAt) >= since - 2000);
}

export default function useModelPicker({ gameId, round, staff, fetchFn, apiBase }) {
  const [info, setInfo] = useState(null);
  const [variants, setVariants] = useState([]);
  const [pending, setPending] = useState({}); // modelId -> requested at (ms)
  const [error, setError] = useState('');
  const [compareOpen, setCompareOpen] = useState(false);
  const timer = useRef(null);
  const polls = useRef(0);
  const live = useRef({ gameId, round });
  live.current = { gameId, round };

  const load = useCallback(async () => {
    const { gameId: g, round: r } = live.current;
    if (!g || !r) return null;
    try {
      const res = await fetchFn(`${apiBase}games/${g}/ai-summary/host?questionId=${encodeURIComponent(r)}&variants=true`);
      if (!res.ok) return null;
      const body = await res.json();
      // A stale answer for a round the host has left is dropped.
      if (live.current.gameId !== g || live.current.round !== r) return null;
      if (body && body.modelPicker && body.modelPicker.enabled) {
        setInfo(body.modelPicker);
        setVariants(Array.isArray(body.variants) ? body.variants : []);
        return body.variants || [];
      }
      setInfo(null);
      return null;
    } catch {
      return null;
    }
  }, [fetchFn, apiBase]);

  // On What We Heard, ask once whether the picker is on.
  useEffect(() => {
    setVariants([]);
    setPending({});
    setError('');
    if (!staff || !gameId || !round) { setInfo(null); return; }
    load();
  }, [staff, gameId, round, load]);

  // While anything is being written, look for it.
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const waiting = Object.keys(pending);
    if (!waiting.length) { polls.current = 0; return undefined; }
    timer.current = setTimeout(async () => {
      polls.current += 1;
      const list = await load();
      setPending((prev) => {
        const next = { ...prev };
        for (const id of Object.keys(prev)) {
          if (list && landedSince(list, id, prev[id])) delete next[id];
        }
        if (polls.current >= POLL_LIMIT) {
          setError('A model took too long. Its read may still arrive; open Compare again later.');
          return {};
        }
        return next;
      });
    }, POLL_MS);
    return () => clearTimeout(timer.current);
  }, [pending, load]);

  const redoWith = useCallback(async (modelId) => {
    const { gameId: g, round: r } = live.current;
    if (!g || !r || !modelId) return;
    setError('');
    const at = Date.now();
    setPending((prev) => ({ ...prev, [modelId]: at }));
    setCompareOpen(true);
    try {
      const res = await fetchFn(
        `${apiBase}games/${g}/ai-summary/host?questionId=${encodeURIComponent(r)}&generateNew=true&model=${encodeURIComponent(modelId)}`,
        { method: 'GET', headers: { 'Content-Type': 'application/json' } },
      );
      if (!res.ok && res.status !== 202) throw new Error(String(res.status));
    } catch (e) {
      setPending((prev) => { const next = { ...prev }; delete next[modelId]; return next; });
      setError('That model could not be started. Try again.');
    }
  }, [fetchFn, apiBase]);

  const openCompare = useCallback(() => { setCompareOpen(true); load(); }, [load]);
  const closeCompare = useCallback(() => setCompareOpen(false), []);

  return { info, variants, pending, error, compareOpen, redoWith, openCompare, closeCompare };
}
