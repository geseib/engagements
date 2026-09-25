import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './Scoreboard.css';
import LookBoard from './LookBoard';
import {
  boardRows, movementLabel, normaliseScoreboard, pageCount, pageDwellMs, pageRange,
  pageRows, placesPerPage, previousOrder, scoreboardKeyIntent,
} from '../../../config/scoreboard';

/**
 * THE SCOREBOARD — a full-screen standings moment on the room's screen.
 *
 * docs/superpowers/specs/2026-09-25-scoreboard-design.md; the looks are the
 * approved mockups in docs/design/scoreboard-2026-09-25/. The owner: "I love
 * all of those, and want them all, with a host ability to switch the view."
 *
 * Mounted by GameHostPage inside `.stage`, only while STATE.Scoreboard says
 * open, and above the rail, bar and main (Scoreboard.css). This component
 * owns what the board shows and when:
 *
 *   - THE ROWS, fetched from the public `GET /games/{id}/players` — totals as
 *     of the last fully scored round, with each player's place and movement
 *     (lambda-functions/game/standings.js). Fetched on open and again whenever
 *     `refreshKey` changes (the host page passes the room's state, so a round
 *     scored while the board is up lands on it).
 *   - THE PAGE. It opens on page 1, auto-flips through every page at the
 *     mockups' pace, returns to page 1 and holds. ← / → step, and stepping
 *     cancels the auto-flip for this opening. The phone's "Next page" arrives
 *     as a change in `remotePage` and steps the same way. The page is local
 *     because the number of pages depends on this screen's display profile.
 *   - THE LOOK, handed in (`style`); LookBoard remounts on a switch.
 *
 * What it does NOT own: opening, closing and the look. Those are server
 * facts (scoreboard.js) driven by the host page's S / V / Esc / Space, the
 * remote and the Players tab.
 *
 * The rows go on the wall by name, with totals — the owner's ruling
 * (2026-09-25), which retires "a full roster WITH SCORES never goes on the
 * wall" (config/podium.js). The board never says which answer was whose.
 */

const newView = (style, visited = [0]) => ({ page: 0, seq: 0, auto: true, firstVisit: true, style, visited });

function usePrefersReducedMotion() {
  const query = '(prefers-reduced-motion: reduce)';
  const read = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? Boolean(window.matchMedia(query).matches) : false);
  const [reduced, setReduced] = useState(read);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia(query);
    const on = () => setReduced(Boolean(mq.matches));
    if (mq.addEventListener) mq.addEventListener('change', on);
    return () => { if (mq.removeEventListener) mq.removeEventListener('change', on); };
  }, []);
  return reduced;
}

export default function Scoreboard({
  gameId, apiBase = '', title = '', profile = 'room', board, refreshKey = '', keysEnabled = true,
}) {
  const { style, openedAt, page: remotePage } = normaliseScoreboard({ ...board, open: true });
  const size = placesPerPage(profile);
  const reduced = usePrefersReducedMotion();

  /* ------------------------------------------------------------- the rows */
  const [roster, setRoster] = useState({ status: 'loading', rows: [], afterRound: null });
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        // Public, like every roster read: the totals were already public.
        const res = await fetch(`${apiBase}games/${gameId}/players`);
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data = await res.json();
        if (!live) return;
        setRoster({
          status: 'ready',
          rows: boardRows(data.players),
          afterRound: Number.isInteger(data.afterRound) ? data.afterRound : null,
        });
      } catch (error) {
        if (live) setRoster((r) => ({ ...r, status: r.rows.length ? 'ready' : 'error' }));
      }
    })();
    return () => { live = false; };
  }, [apiBase, gameId, openedAt, refreshKey]);

  const { rows, afterRound } = roster;
  const pages = pageCount(rows.length, size);
  const hasHistory = useMemo(() => previousOrder(rows).length > 0 && afterRound > 1, [rows, afterRound]);

  /* ------------------------------------------------------------- the page */
  const [view, setView] = useState(() => newView(style));
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  const styleRef = useRef(style);
  styleRef.current = style;

  // A new opening starts on page 1 with the auto-flip armed.
  const lastRemote = useRef(remotePage);
  useEffect(() => {
    lastRemote.current = remotePage;
    setView((v) => ({ ...newView(styleRef.current), seq: v.seq + 1 }));
  // Only a new opening resets; the remote page is read, not tracked, here.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openedAt]);

  /** A host's step: cancels the auto-flip for this opening; never replays. */
  const step = useCallback((delta) => {
    setView((v) => {
      const n = pagesRef.current;
      const page = ((v.page + delta) % n + n) % n;
      return { page, seq: v.seq + 1, auto: false, firstVisit: false, style: styleRef.current, visited: [...v.visited, page] };
    });
  }, []);

  // The phone's "Next page": the server counts steps; apply the change.
  useEffect(() => {
    const delta = remotePage - lastRemote.current;
    lastRemote.current = remotePage;
    if (delta) step(delta);
  }, [remotePage, step]);

  const loaded = roster.status === 'ready';
  const current = ((view.page % pages) + pages) % pages;
  const onPage = pageRows(rows, current, size);
  const replay = style === 'tote' && view.style === style && view.firstVisit && view.auto
    && hasHistory && !reduced;

  // The auto-flip: dwell, turn, and after the last page go back to page 1 and hold.
  useEffect(() => {
    if (!loaded || !view.auto || pages <= 1) return undefined;
    const timer = setTimeout(() => {
      setView((v) => {
        if (!v.auto || v.seq !== view.seq) return v;
        if (v.page < pagesRef.current - 1) {
          const page = v.page + 1;
          return {
            page, seq: v.seq + 1, auto: true, firstVisit: !v.visited.includes(page),
            style: styleRef.current, visited: [...v.visited, page],
          };
        }
        return { page: 0, seq: v.seq + 1, auto: false, firstVisit: false, style: styleRef.current, visited: v.visited };
      });
    }, pageDwellMs(onPage.length, style, replay));
    return () => clearTimeout(timer);
  // onPage/replay are functions of view + rows; the timer re-arms per view.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, view.seq, view.auto, pages, style]);

  /* ------------------------------------------------------------- the keys */
  // ← / → only. S, V, Escape and Space change the server's board and are the
  // host page's (useScoreboardKeys); both read one key map.
  useEffect(() => {
    if (!keysEnabled) return undefined;
    const onKeyDown = (event) => {
      const intent = scoreboardKeyIntent(event, { open: true });
      if (intent !== 'next' && intent !== 'prev') return;
      event.preventDefault();
      step(intent === 'next' ? 1 : -1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [keysEnabled, step]);

  /* ------------------------------------------------------------ the rail */
  const [shownRound, setShownRound] = useState(null);
  useEffect(() => { setShownRound(null); }, [view.seq, style]);
  const roundOnRail = shownRound ?? afterRound;

  const label = afterRound ? `Standings after round ${afterRound}` : 'Standings';

  return (
    <section
      className={`sb sb--${style}`}
      aria-label={label}
      data-scoreboard=""
      data-style={style}
      data-page={current}
      data-auto={view.auto ? 'on' : 'held'}
    >
      <div className="sb-field" aria-hidden="true" />
      <header className="sb-rail">
        <span className="sb-chip"><span className="sb-chip-dot" aria-hidden="true" />Standings</span>
        {title ? <span className="sb-title">{title}</span> : null}
        {roundOnRail ? (
          <span className="sb-ctx">
            <b className={roundOnRail !== afterRound ? 'sb-was' : undefined}>{`After round ${roundOnRail}`}</b>
          </span>
        ) : null}
        {rows.length ? (
          <span className="sb-page"><b>{pageRange(current, size, rows.length)}</b><span>{`of ${rows.length}`}</span></span>
        ) : null}
      </header>
      <div className="sb-body">
        {roster.status === 'loading' && <p className="sb-note">Loading the standings…</p>}
        {roster.status === 'error' && <p className="sb-note">The standings did not load. They will try again after the next round.</p>}
        {loaded && !rows.length && <p className="sb-note">Nobody is on the board yet.</p>}
        {loaded && rows.length > 0 && (
          <LookBoard
            key={style}
            look={style}
            rows={onPage}
            allRows={rows}
            pageSize={size}
            view={{ page: current, seq: view.seq }}
            replay={replay}
            reduced={reduced}
            afterRound={afterRound}
            onRound={setShownRound}
          />
        )}
      </div>
      <ol className="sb-vh">
        {onPage.map((r) => (
          <li key={r.id}>{`${r.place} ${r.name}, ${r.total} points, ${movementLabel(r.movement).spoken}`}</li>
        ))}
      </ol>
    </section>
  );
}
