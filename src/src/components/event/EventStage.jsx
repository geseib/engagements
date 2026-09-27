import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import Stage from '../stage/Stage';
import Modal from '../Modal';
import Icon from '../Icon';
import { getEvent, runEvent } from '../../utils/eventsApi';
import { navigateTo } from '../../auth/navigate';
import { loadProfile } from '../../config/displayProfile';
import {
  TYPE_ICONS, typeLabel, typeLine, positionOf, wallClock, nextAfter, firstPlanned,
  isEngagement, isBreak, rules,
} from './eventDisplay';
import './EventStage.css';

/** Where a host builds this event's agenda (components/event/HostEventAgenda.jsx). */
const agendaPath = (code) => `/host/event/${encodeURIComponent(code)}/agenda`;

/**
 * THE EVENT'S STAGE — /host/event/<code> (events M3, reworked 27 Sep 2026).
 *
 * THE AGENDA IS THE HOST'S BOARD. Every item, its state, and two ways into it
 * (the owner, 27 Sep 2026):
 *   OPEN     the host's screen goes to that item — an engagement's own stage,
 *            a talk's or a break's wall screen — and NOTHING else moves. The
 *            phones stay where the event is. "That way host can rehearse,
 *            preview etc." An engagement nobody has opened yet gets its
 *            session made, unopened (run.js `prepare`): its lobby, its
 *            questions and its settings are there to look at, and no phone can
 *            join it.
 *   GO LIVE  the host's screen goes to the item AND everyone is brought to
 *            it: the item is live, the phones switch (run.js `start`). A
 *            paused item's is Resume.
 * The same two are on every item's own screen, at the bottom: AGENDA (back
 * here, the host only) and "Bring everyone here" while the item is not live.
 * Going back to the agenda never pauses anything; Pause and End are their own
 * buttons, on the item's row.
 *
 * IT NEVER SCROLLS, on a laptop, a tablet or the room's screen (the owner,
 * same day). The rows are one line each and flow into as many columns as the
 * screen needs (useBoardFit, measured), and only past that do they tighten.
 *
 * Every action answers with the server's view of the event, so two host
 * screens converge, and a start that lost a race says so.
 */
const POLL_MS = 10000;
const WIPE_MS = 1400;
const WALL_ROWS = 7;
/** A column narrower than this cannot hold a row's time, title, word and buttons. */
const MIN_COLUMN_PX = 520;
/** Under this a dense column drops the kind icon and closes its gaps (`data-narrow`). */
const MIN_DENSE_COLUMN_PX = 440;

const playUrl = (code) => `${window.location.origin}/play?event=${code}`;
const joinDisplayUrl = () => `${window.location.host}/play`;
const sessionStage = (gameId, code) => `/host?gameId=${encodeURIComponent(gameId)}&event=${encodeURIComponent(code)}`;

function TypeIcon({ type, size = 22 }) {
  return <Icon name={TYPE_ICONS[type] || 'Circle'} weight="bold" size={size} color="currentColor" />;
}

/**
 * The words for an item in a button: an engagement by its kind ("trivia",
 * "the survey"), anything else by its title ("The FY27 plan").
 */
function startWords(item) {
  if (!item) return '';
  if (item.type === 'survey') return 'the survey';
  if (isEngagement(item.type)) return item.type === 'call-and-answer' ? 'Call & Answer' : typeLabel(item.type).toLowerCase();
  if (isBreak(item.type)) return 'the break';
  return item.title || typeLabel(item.type);
}

/** m:ss to a moment, never below 0:00 (decision 7: lateness is host-facing). */
function countdown(endsAt, nowMs) {
  const left = Math.max(0, Math.round(((Date.parse(endsAt || '') || nowMs) - nowMs) / 1000));
  return { left, text: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` };
}

function JoinBlock({ code, label }) {
  return (
    <div className="joinblock">
      <div className="qr">
        <QRCodeSVG value={playUrl(code)} size={512} level="M" includeMargin={false} />
      </div>
      <div className="joininfo">
        <div className="lbl">{label}</div>
        <div className="url">{joinDisplayUrl()}</div>
        <div className="lbl">Event code</div>
        <div className="code">{code}</div>
      </div>
    </div>
  );
}

/** A talk's or a break's "Coming up": seven rows at most, and a count of the rest. */
/**
 * WHAT IS COMING UP, beside a talk or a break: up to WALL_ROWS items and a
 * line for the rest — but only as many rows as the column holds WHOLE. A
 * long title wraps to two lines, and seven rows cut the last one in half at
 * 1280×720 (measured in Chromium, 27 Sep 2026). Each render that still
 * overflows gives up one row to the "and N more" line; a resize or the web
 * fonts landing start again from the most. Remounted per item (its key), so
 * a different item's list starts from the most too.
 */
function WallList({ rows, heading }) {
  const box = useRef(null);
  const [cap, setCap] = useState(WALL_ROWS);
  useLayoutEffect(() => {
    const el = box.current;
    if (el && cap > 1 && el.scrollHeight > el.clientHeight + 1) setCap(cap - 1);
  }, [cap, rows]);
  useEffect(() => {
    let live = true;
    const again = () => { if (live) setCap(WALL_ROWS); };
    window.addEventListener('resize', again);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(again, () => {});
    return () => {
      live = false;
      window.removeEventListener('resize', again);
    };
  }, []);
  const shown = rows.slice(0, cap);
  const rest = rows.slice(cap);
  return (
    <aside className="ag-wall" ref={box}>
      <h4>{heading}</h4>
      <ol className="ag-wl">
        {shown.map((item) => (
          <li key={item.itemId} className={item.state === 'paused' ? 'now' : ''}>
            <span className="at">{item.at}</span>
            <div>
              <div className="tt">{item.title || typeLabel(item.type)}</div>
              <span className="ty">{typeLine(item)}</span>
            </div>
            <span className="st">{item.state === 'paused' ? 'Paused' : ''}</span>
          </li>
        ))}
        {rest.length > 0 && (
          <li className="more">
            <span className="at" />
            <div><div className="tt">{`and ${rest.length} more, until ${rest[rest.length - 1].until}`}</div></div>
            <span className="st" />
          </li>
        )}
      </ol>
    </aside>
  );
}

/**
 * HOW MANY COLUMNS THE BOARD NEEDS, measured: the rows are one line each, so
 * a column holds (its height ÷ one row) of them, and the board takes as many
 * columns as the agenda needs. Two steps:
 *   roomy  full rows, while every column can stay MIN_COLUMN_PX wide;
 *   dense  past that: tighter rows without the kind line, and as many columns
 *          as it takes. Titles truncate (the row's tooltip keeps the whole
 *          one), but no item is ever cut off the bottom of the board, which
 *          is what scrolling would have hidden. A column that ends up under
 *          MIN_DENSE_COLUMN_PX is also `data-narrow`: no kind icon, closer
 *          gaps, so the title keeps what the buttons leave.
 *
 * WRITTEN STRAIGHT TO THE GRID, not held in React state. The state version
 * looped: a reset queued by one effect kept being replayed against the
 * measurement from another, and a 1280 → 1366 resize ended in "Maximum update
 * depth exceeded" (measured in Chromium, 27 Sep 2026). The grid's own height
 * never depends on its column count (it is a flex child with min-height 0),
 * so measuring from the DOM and writing back to it cannot feed itself. It
 * re-fits when the box changes size and once the web fonts land, which change
 * a row's height without changing the box. jsdom measures nothing and keeps
 * one column.
 */
function fitBoard(grid, count) {
  const style = window.getComputedStyle(grid);
  const place = (cols) => {
    grid.style.setProperty('--ag-cols', String(cols));
    grid.style.setProperty('--ag-rows', String(Math.max(1, Math.ceil(count / cols))));
  };
  const needed = () => {
    const row = grid.querySelector('.ag-r');
    if (!grid.clientHeight || !row || !row.offsetHeight) return 1;
    const gap = parseFloat(style.rowGap) || 0;
    return Math.ceil(count / Math.max(1, Math.floor((grid.clientHeight + gap) / (row.offsetHeight + gap))));
  };
  const widest = (minPx) => Math.max(1, Math.floor((grid.clientWidth + (parseFloat(style.columnGap) || 0)) / minPx));
  grid.removeAttribute('data-dense');
  grid.removeAttribute('data-narrow');
  place(1);
  if (!grid.clientWidth) return;
  let cols = needed();
  if (cols > widest(MIN_COLUMN_PX)) {
    grid.setAttribute('data-dense', '');
    cols = needed();
    if (cols > widest(MIN_DENSE_COLUMN_PX)) grid.setAttribute('data-narrow', '');
  }
  place(cols);
}

function useBoardFit(grid, count) {
  useLayoutEffect(() => {
    if (!grid) return undefined;
    let live = true;
    const fit = () => { if (live) fitBoard(grid, count); };
    fit();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;
    if (observer) observer.observe(grid);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit, () => {});
    return () => {
      live = false;
      if (observer) observer.disconnect();
    };
  }, [grid, count]);
}

export default function EventStage({ code }) {
  const [view, setView] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [refusal, setRefusal] = useState('');
  const [busy, setBusy] = useState(false);
  const [focus, setFocusState] = useState(() => {
    const f = new URLSearchParams(window.location.search).get('focus') || '';
    return /^it_[0-9a-f]{8}$/.test(f) ? f : 'agenda';
  });
  const [confirmEndEvent, setConfirmEndEvent] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [wipe, setWipe] = useState(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [profile] = useState(() => loadProfile(window.localStorage, window.innerWidth));
  const [boardGrid, setBoardGrid] = useState(null);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const event = (view && view.event) || null;
  /* THE PLANNED TIMES. GET /events/{code} sends the agenda without them; the
     builder and the phones' agenda (get-agenda.js) each work them out with
     agenda-rules' agendaTimes, and the stage now does too — it printed
     `item.at` from a field nothing sent, so the host's run sheet had no times
     and a break read "Back at" with nothing after it (seen in Chromium, 27 Sep
     2026). Rows that already carry times are left as they are. */
  const items = useMemo(() => {
    const raw = (view && view.items) || [];
    const startsAt = view && view.event && view.event.startsAt;
    if (!startsAt || raw.every((i) => i.at)) return raw;
    return rules.agendaTimes(startsAt, raw).rows;
  }, [view]);
  const liveItem = event ? items.find((i) => i.itemId === event.liveItemId) || null : null;
  const focused = focus === 'agenda' ? null : items.find((i) => i.itemId === focus) || null;
  useBoardFit(boardGrid, items.length);

  /** The host's own view, kept in the address so a reload lands on it. */
  const setFocus = useCallback((next) => {
    setFocusState(next);
    try {
      const url = new URL(window.location.href);
      if (next === 'agenda') url.searchParams.delete('focus');
      else url.searchParams.set('focus', next);
      window.history.replaceState(null, '', url);
    } catch (_) { /* the address is a convenience */ }
  }, []);

  const load = useCallback(async () => {
    try {
      const fresh = await getEvent(code);
      if (!mounted.current) return;
      setLoadError('');
      setView(fresh);
    } catch (error) {
      if (!mounted.current) return;
      setLoadError(error && error.status === 404
        ? 'No event has that code, or it is not yours to run.'
        : ((error && error.message) || 'Could not load the event.'));
    }
  }, [code]);

  useEffect(() => { load(); }, [load]);
  // Another host screen may move the day on: look again now and then.
  useEffect(() => {
    const timer = setInterval(() => { if (!document.hidden) load(); }, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const breakShown = Boolean(focused && isBreak(focused.type) && focused.state === 'live');
  useEffect(() => {
    if (!breakShown) return undefined;
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [breakShown]);

  /** One run action; the server's view of the event comes back, or a refusal. */
  const act = useCallback(async (action, item) => {
    setBusy(true);
    setRefusal('');
    try {
      const fresh = await runEvent(code, action, item ? item.itemId : undefined);
      if (!mounted.current) return null;
      setView(fresh);
      return fresh;
    } catch (error) {
      if (mounted.current) {
        setRefusal((error && error.message) || 'That did not work. Try again.');
        load();
      }
      return null;
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, [code, load]);

  /** OPEN: the host's screen only. The phones stay where the event is. */
  const openItem = useCallback(async (item) => {
    if (!item) return;
    if (!isEngagement(item.type)) {
      setFocus(item.itemId);
      return;
    }
    if (item.gameId) {
      navigateTo(sessionStage(item.gameId, code));
      return;
    }
    const fresh = await act('prepare', item);
    const ready = fresh && fresh.gameId;
    if (ready) navigateTo(sessionStage(fresh.gameId, code));
  }, [act, code, setFocus]);

  /** GO LIVE: the host's screen, and everyone's, to this item. */
  const goLive = useCallback(async (item) => {
    if (!item) return;
    const fresh = await act(item.state === 'paused' ? 'resume' : 'start', item);
    if (!fresh) return;
    const live = (fresh.items || []).find((i) => i.itemId === fresh.event.liveItemId);
    if (live && isEngagement(live.type) && live.gameId) {
      // THE TRIGGER (s-04): the wipe names the item and says the phones have
      // moved, once, then the stage is the item's own.
      setQrOpen(false);
      setWipe({ title: typeLabel(live.type) || live.title });
      setTimeout(() => navigateTo(sessionStage(live.gameId, code)), WIPE_MS);
      return;
    }
    if (live) setFocus(live.itemId);
  }, [act, code, setFocus]);

  /** A live talk or activity ends, and the next item goes live. */
  const endThenGoLive = useCallback(async (current, next) => {
    const ended = await act('end', current);
    if (ended && next) {
      const fresh = (ended.items || []).find((i) => i.itemId === next.itemId) || next;
      await goLive(fresh);
    }
  }, [act, goLive]);

  const next = firstPlanned(items);

  // ── The one obvious next step, for the dock ──────────────────────────────
  const plan = useMemo(() => {
    if (!event) return null;
    if (event.state === 'ENDED') return { label: 'Back to the agenda', run: () => navigateTo(agendaPath(code)) };
    if (focused) {
      if (focused.state !== 'live' && focused.state !== 'done') {
        return { label: focused.state === 'paused' ? 'Bring everyone back' : 'Bring everyone here', run: () => goLive(focused) };
      }
      if (focused.state === 'live') {
        const after = nextAfter(items, focused.itemId);
        if (isBreak(focused.type)) {
          return after
            ? { label: `Go live: ${startWords(after)}`, run: () => goLive(after) }
            : { label: 'End the break', run: () => act('end', focused) };
        }
        return after
          ? { label: `Go live: ${startWords(after)}`, run: () => endThenGoLive(focused, after) }
          : { label: `End ${focused.title || typeLabel(focused.type)}`, run: () => act('end', focused) };
      }
      return { label: 'Agenda', run: () => setFocus('agenda') };
    }
    if (next) return { label: `Go live: ${startWords(next)}`, run: () => goLive(next) };
    const paused = items.find((i) => i.state === 'paused');
    if (paused) return { label: `Resume ${startWords(paused)}`, run: () => goLive(paused) };
    return { label: 'End the event', run: () => setConfirmEndEvent(true) };
  }, [event, focused, items, next, act, goLive, endThenGoLive, setFocus, code]);

  // SPACE (and the clicker's arrow) takes the dock's step, as on every stage.
  useEffect(() => {
    const onKey = (e) => {
      if (confirmEndEvent || qrOpen || busy || !plan) return;
      const tag = (e.target && e.target.tagName) || '';
      if (/INPUT|TEXTAREA|SELECT|BUTTON/.test(tag)) return;
      if (e.key === ' ' || e.key === 'ArrowRight') {
        e.preventDefault();
        plan.run();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [plan, confirmEndEvent, qrOpen, busy]);

  if (loadError) {
    return (
      <div className="ag-load" data-theme="dark">
        <h1>{loadError}</h1>
        <a href="/admin">Back to the console</a>
      </div>
    );
  }
  if (!event) {
    return (
      <div className="ag-load" data-theme="dark">
        <h1>Opening the event…</h1>
      </div>
    );
  }

  const title = event.title || 'The event';
  const ended = event.state === 'ENDED';
  const started = event.state === 'LIVE' || items.some((i) => (i.state || 'planned') !== 'planned');
  const done = items.filter((i) => i.state === 'done' && !isBreak(i.type)).length;
  const counted = items.filter((i) => !isBreak(i.type)).length;
  const joined = `${event.attendeeCount || 0} joined`;

  // ── The rail ─────────────────────────────────────────────────────────────
  let chip;
  if (ended) chip = ['done', 'The day is over'];
  else if (focused && focused.state !== 'live') chip = ['lobby ag-preview', focused.state === 'done' ? 'Finished' : 'Preview'];
  else if (focused && isBreak(focused.type)) chip = ['lobby', 'Break'];
  else if (focused) chip = ['lobby', focused.type === rules.PRESENTATION ? 'Now presenting' : 'Now'];
  else if (liveItem) chip = ['lobby', 'Live now'];
  else chip = ['lobby', started ? 'Between items' : 'Starting soon'];
  const railEl = (
    <header className="rail">
      <span className={`chip ${chip[0]}`}><span className="dot" />{chip[1]}</span>
      <span className="rail-title" data-drop="1">{title}</span>
      <span className="rail-ctx"><b>{`${done} of ${counted} done`}</b></span>
      {!ended && (
        <div className="rail-join">
          <span data-join-word="" data-drop="2">JOIN</span>
          <span data-join-url="" data-drop="3">{joinDisplayUrl()}</span>
          <code>{code}</code>
        </div>
      )}
    </header>
  );

  // ── What the main area shows ─────────────────────────────────────────────
  let main;
  let meter = null;
  let status;
  if (focused) {
    const pos = positionOf(items, focused.itemId);
    const live = focused.state === 'live';
    const coming = items.filter((i) => (i.state || 'planned') !== 'done' && i.itemId !== focused.itemId);
    meter = <WallList key={focused.itemId} rows={coming} heading="Coming up" />;
    if (isBreak(focused.type)) {
      const count = live ? countdown(focused.endsAt, nowMs) : { left: 1, text: `${focused.minutes}:00` };
      const after = nextAfter(items, focused.itemId);
      status = live
        ? (count.left > 0 ? 'Counting down to the planned return' : 'Back now — take the next item live')
        : 'Preview — the phones are not here yet';
      main = (
        <div className="ag-up">
          <p className="ty">
            <TypeIcon type="break" />
            {live ? `Back at ${wallClock(focused.endsAt, event.timeZone) || focused.until}` : `Break · ${focused.minutes} min`}
          </p>
          <p className="ag-count" role="timer" aria-label={`${count.text} until the break ends`}>{count.text}</p>
          <p className="qdetail">
            {focused.description ? `${focused.description} ` : ''}
            {after ? <>Next: <b>{after.title}</b>{after.ledBy ? ` · ${after.ledBy}` : ''}.</> : null}
          </p>
        </div>
      );
    } else {
      status = live ? joined : 'Preview — the phones are not here yet';
      main = (
        <div className="ag-up">
          <p className="ty">
            <TypeIcon type={focused.type} />
            {`${typeLabel(focused.type)}${pos ? ` · ${pos.n} of ${pos.of}` : ''}`}
          </p>
          <h2 className="q">{focused.title}</h2>
          {focused.ledBy && <p className="ag-who">{focused.ledBy}</p>}
          {focused.description && <p className="qdetail">{focused.description}</p>}
          <JoinBlock code={code} label="Just arrived? Open" />
        </div>
      );
    }
  } else {
    status = liveItem ? `${joined} · ${liveItem.title || typeLabel(liveItem.type)} is live` : joined;
    main = (
      <div className="ag-board">
        <div className="ag-board-head">
          <p className="ag-when">
            {[rules.formatEventDay(event.startsAt), event.place].filter(Boolean).join(' · ')}
          </p>
          <p className="ag-live">
            {ended ? 'That’s the day. Each item’s report is in the session history.'
              : liveItem ? <>Live now: <b>{liveItem.title || typeLabel(liveItem.type)}</b>. Open any item to look at it; only Go live moves the phones.</>
                : 'Nothing is live. Open any item to look at it; Go live brings everyone to it.'}
          </p>
        </div>
        <ol
          className="ag-grid"
          ref={setBoardGrid}
        >
          {items.map((item) => (
            <BoardRow key={item.itemId} item={item} busy={busy || ended} onOpen={openItem} onLive={goLive} onAct={act} />
          ))}
        </ol>
      </div>
    );
  }

  const dockEl = (
    <footer className="dock">
      <span className={`status${ended ? '' : ' go'}`} aria-live="polite">{refusal || status}</span>
      <span className="spacer" />
      {focused && isBreak(focused.type) && focused.state === 'live' && (
        <button type="button" className="btn ghost" disabled={busy} onClick={() => act('extend', focused)}>+5 min</button>
      )}
      {plan && !ended && <span className="kbd" aria-hidden="true">SPACE</span>}
      {plan && <button type="button" className="btn" disabled={busy} onClick={plan.run}>{plan.label}</button>}
      {focused ? (
        <button type="button" className="dock-more" onClick={() => setFocus('agenda')} aria-label="Back to the agenda — the phones stay where they are">
          <span className="dock-more-lbl">AGENDA</span>
        </button>
      ) : (
        <>
          {/* The agenda, on the host's side (27 Sep 2026: a host builds and
              changes it without the console). */}
          <button type="button" className="dock-more" onClick={() => navigateTo(agendaPath(code))} aria-label="Edit the agenda">
            <span className="dock-more-lbl">EDIT AGENDA</span>
          </button>
          {!ended && (
            <button type="button" className="dock-more" onClick={() => setQrOpen(true)} aria-label="Show the join QR code">
              <span className="dock-more-lbl">QR</span>
            </button>
          )}
          {!ended && (
            <button type="button" className="dock-more ag-dock-end" onClick={() => setConfirmEndEvent(true)} aria-label="End the event">
              <span className="dock-more-lbl">END EVENT</span>
            </button>
          )}
        </>
      )}
    </footer>
  );

  return (
    <div className="ag-stage-root" data-theme="dark">
      <Stage
        profile={profile}
        phase={ended ? 'done' : 'lobby'}
        rail={railEl}
        dock={dockEl}
        meter={meter}
        fitKey={`${focus}|${event.liveItemId}|${event.state}|${items.length}`}
        overlay={wipe ? (
          <div className="wipe ag-go" role="status">
            {wipe.title}
            <small>Phones have switched — <b>no code needed</b></small>
          </div>
        ) : null}
      >
        {focused ? (
          <div className="content">
            <div className="fitbox center">{main}</div>
          </div>
        ) : main}
      </Stage>

      {qrOpen && (
        <Modal overlayClassName="ag-scrim" contentClassName="ag-qrcard" onClose={() => setQrOpen(false)} label="Join the event" theme="dark">
          <div className="qr ag-qr">
            <QRCodeSVG value={playUrl(code)} size={512} level="M" includeMargin={false} />
          </div>
          <p className="ag-qr-url">{joinDisplayUrl()}</p>
          <p className="ag-qr-code">{code}</p>
          <button type="button" className="ag-close" onClick={() => setQrOpen(false)}>Close</button>
        </Modal>
      )}

      {confirmEndEvent && (
        <Modal
          overlayClassName="ag-scrim"
          contentClassName="ag-confirm"
          onClose={() => setConfirmEndEvent(false)}
          closeOnEscape={() => !busy}
          label="End the event"
          theme="dark"
        >
          <h2>End the event?</h2>
          <p>
            Anything live or paused ends now, and nobody new can join. Items that have not started stay
            on the agenda, unplayed. Reports already made are kept.
          </p>
          <div className="ag-confirm-foot">
            <button type="button" className="ag-close" onClick={() => setConfirmEndEvent(false)}>Keep going</button>
            <button
              type="button"
              className="ag-end"
              disabled={busy}
              onClick={async () => { setConfirmEndEvent(false); setFocus('agenda'); await act('end-event'); }}
            >
              End the event
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/**
 * ONE ROW OF THE BOARD, ON ONE LINE: when, what, its state in a word, and the
 * buttons that fit it. Open is always there (looking is always allowed); Go
 * live, Resume, Pause and End only where they mean something.
 */
function BoardRow({ item, busy, onOpen, onLive, onAct }) {
  const state = item.state || 'planned';
  const words = { planned: '', live: 'Live', paused: 'Paused', done: 'Done' };
  const name = item.title || typeLabel(item.type);
  const sub = typeLine(item);
  return (
    <li className={`ag-r ag-r--${state}${isBreak(item.type) ? ' ag-r--brk' : ''}`}>
      <span className="ag-r-at">{item.at}</span>
      <span className="ag-r-main" title={`${name} · ${sub}`}>
        <TypeIcon type={item.type} size={18} />
        <span className="ag-r-tt">{name}</span>
        <span className="ag-r-sub">{sub}</span>
      </span>
      <span className={`ag-r-st ag-r-st--${state}`}>{words[state]}</span>
      <span className="ag-r-go">
        <button type="button" className="ag-b" disabled={busy} onClick={() => onOpen(item)} aria-label={`Open ${name} on this screen only`}>
          Open
        </button>
        {state === 'planned' && (
          <button type="button" className="ag-b ag-b--go" disabled={busy} onClick={() => onLive(item)} aria-label={`Go live with ${name}: bring everyone to it`}>
            Go live
          </button>
        )}
        {state === 'paused' && (
          <button type="button" className="ag-b ag-b--go" disabled={busy} onClick={() => onLive(item)} aria-label={`Resume ${name}: bring everyone back to it`}>
            Resume
          </button>
        )}
        {state === 'live' && !isBreak(item.type) && (
          <button type="button" className="ag-b" disabled={busy} onClick={() => onAct('pause', item)} aria-label={`Pause ${name}`}>
            Pause
          </button>
        )}
        {(state === 'live' || state === 'paused') && (
          <button type="button" className="ag-b" disabled={busy} onClick={() => onAct('end', item)} aria-label={`End ${name}`}>
            End
          </button>
        )}
      </span>
    </li>
  );
}
