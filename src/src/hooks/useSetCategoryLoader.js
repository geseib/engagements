import { useCallback, useRef, useState } from 'react';
import { setRefKey } from '../utils/setRef';

/**
 * THE CREATE DIALOG'S CATEGORY REQUESTS, LATEST-ONLY (docs/design/new-engagement
 * README §2b — the owner's "the catagories of the old question set stay up").
 *
 * GameHostPage.fetchCategories used to: keep set A's list on screen until set
 * B's request returned; accept whichever response arrived LAST, so a slow A
 * could overwrite B; log a failure and leave A's list up; never check
 * `res.ok`. Each of those let Create send one set's categories for another.
 *
 * This hook owns the request half. Every call takes a ticket; only the newest
 * ticket may write. It clears the page's list BEFORE it awaits, treats a
 * non-OK response as an error, and reports `status` — `{ key, loading, error }`
 * where `key` is the set reference (utils/setRef.js) the list belongs to — so
 * the dialog can refuse to show or send categories that are not the chosen
 * set's. The page still OWNS `categories` and `activeCategoryIds` (they are
 * per-game keys, config/gameSession.js); the setters arrive as arguments.
 *
 * `claim()` lets the page's other caller (fetchCategories, which restores a
 * running game's categories) retire any request in flight here, and
 * `isCurrent(ticket)` lets it apply the same rule to its own answers.
 */
export async function loadSetCategories({ fetcher, apiBase, setId, scope }) {
  const scopeQuery = scope ? `?scope=${encodeURIComponent(scope)}` : '';
  const res = await fetcher(`${apiBase}question-sets/${encodeURIComponent(setId)}/categories${scopeQuery}`);
  if (!res || !res.ok) {
    let why = '';
    try { const body = await res.json(); why = (body && (body.error || body.message)) || ''; } catch (e) { /* no body */ }
    throw new Error(`HTTP ${res ? res.status : '?'}${why ? `: ${why}` : ''}`);
  }
  const json = await res.json();
  return Array.isArray(json && json.categories) ? json.categories : [];
}

const IDLE = Object.freeze({ key: '', loading: false, error: '' });

export default function useSetCategoryLoader({ fetcher, apiBase, setCategories, setActiveCategoryIds }) {
  const ticketRef = useRef(0);
  const [status, setStatus] = useState(IDLE);
  // Read at call time so a re-render never strands an in-flight request on
  // stale setters.
  const latest = useRef({});
  latest.current = { fetcher, apiBase, setCategories, setActiveCategoryIds };

  const claim = useCallback(() => {
    ticketRef.current += 1;
    return ticketRef.current;
  }, []);
  const isCurrent = useCallback((ticket) => ticket === ticketRef.current, []);

  const load = useCallback(async (setId, scope) => {
    const ticket = claim();
    const { setCategories: setCats, setActiveCategoryIds: setActive } = latest.current;
    // CLEAR BEFORE THE AWAIT: set A's names must not sit under set B's.
    setCats([]);
    setActive(new Set());
    if (!setId) {
      setStatus(IDLE);
      return;
    }
    const key = setRefKey({ id: setId, scope });
    setStatus({ key, loading: true, error: '' });
    try {
      const { fetcher: f, apiBase: base } = latest.current;
      const list = await loadSetCategories({ fetcher: f, apiBase: base, setId, scope });
      if (ticket !== ticketRef.current) return; // a newer pick owns the page now
      latest.current.setCategories(list);
      // A new session starts with every category on (README §9: "All topics
      // start on").
      latest.current.setActiveCategoryIds(new Set(list.map((c) => c.name)));
      setStatus({ key, loading: false, error: '' });
    } catch (e) {
      if (ticket !== ticketRef.current) return;
      latest.current.setCategories([]);
      latest.current.setActiveCategoryIds(new Set());
      setStatus({ key, loading: false, error: `Could not load this set’s topics (${e.message}).` });
    }
  }, [claim]);

  return { load, claim, isCurrent, status };
}
