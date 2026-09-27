import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

/**
 * THE EVENT ON THE WALL — /host/event/<code> (events M3). The host's stage
 * while the agenda is up: before the first item (s-01), between items
 * (s-03), a break (s-05) and a talk or an activity (s-02). Starting an
 * engagement runs the wipe (s-04) and hands the stage to that item's own
 * session — today's host stage, unchanged but for an Agenda door
 * (GameHostPage with `?event=`) — which comes back here when the host
 * presses Agenda (the item pauses) or ends it.
 *
 * ONE SET OF ACTIONS (roadmap D5): Start, Resume, Pause, End item, End event,
 * all through POST /events/{code}/run (utils/eventsApi.runEvent). The dock
 * carries the next obvious one; the Agenda panel carries every item's own.
 * Every answer is the server's view of the event, so two host screens — this
 * stage and a laptop — converge, and a start that lost a race says so.
 *
 * A reload restores event mode: the event's live item decides the screen, and
 * a live engagement takes the stage straight into its session.
 */
const POLL_MS = 10000;
const WIPE_MS = 1400;
const WALL_ROWS = 7;

const playUrl = (code) => `${window.location.origin}/play?event=${code}`;
const joinDisplayUrl = () => `${window.location.host}/play`;
const sessionStage = (gameId, code) => `/host?gameId=${encodeURIComponent(gameId)}&event=${encodeURIComponent(code)}`;

function TypeIcon({ type, size = 22 }) {
  return <Icon name={TYPE_ICONS[type] || 'Circle'} weight="bold" size={size} color="currentColor" />;
}

/**
 * What the dock's button says to start an item (s-01, s-03, s-05): an
 * engagement by its kind ("Start trivia", "Start the survey" — the wall above
 * already shows its title), anything else by its title ("Start The FY27 plan").
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

/** The wall's agenda: at most seven rows, and a count of the rest — never clipped. */
function WallList({ items, heading, markId, markWord }) {
  const shown = items.slice(0, WALL_ROWS);
  const rest = items.slice(WALL_ROWS);
  return (
    <aside className="ag-wall">
      <h4>{heading}</h4>
      <ol className="ag-wl">
        {shown.map((item) => {
          const state = item.state || 'planned';
          const mark = item.itemId === markId;
          const word = state === 'done' ? 'Done' : state === 'paused' ? 'Paused' : state === 'live' ? 'Now' : mark ? markWord : '';
          const cls = [state === 'done' ? 'done' : '', mark || state === 'live' ? 'now' : ''].filter(Boolean).join(' ');
          return (
            <li key={item.itemId} className={cls}>
              <span className="at">{item.at}</span>
              <div>
                <div className="tt">{item.title || typeLabel(item.type)}</div>
                <span className="ty">{typeLine(item)}</span>
              </div>
              <span className="st">{word}</span>
            </li>
          );
        })}
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

export default function EventStage({ code }) {
  const [view, setView] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [refusal, setRefusal] = useState('');
  const [busy, setBusy] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [confirmEndEvent, setConfirmEndEvent] = useState(false);
  const [wipe, setWipe] = useState(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [profile] = useState(() => loadProfile(window.localStorage, window.innerWidth));
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const event = (view && view.event) || null;
  const items = useMemo(() => (view && view.items) || [], [view]);
  const liveItem = event ? items.find((i) => i.itemId === event.liveItemId) || null : null;

  /** A live engagement belongs to its own session's stage: go there. */
  const enterIfLive = useCallback((fresh) => {
    const ev = fresh && fresh.event;
    const live = ev && (fresh.items || []).find((i) => i.itemId === ev.liveItemId);
    if (live && isEngagement(live.type) && live.gameId) {
      navigateTo(sessionStage(live.gameId, code));
      return true;
    }
    return false;
  }, [code]);

  const load = useCallback(async ({ enter = false } = {}) => {
    try {
      const fresh = await getEvent(code);
      if (!mounted.current) return;
      setLoadError('');
      if (enter && enterIfLive(fresh)) return;
      setView(fresh);
    } catch (error) {
      if (!mounted.current) return;
      setLoadError(error && error.status === 404
        ? 'No event has that code, or it is not yours to run.'
        : ((error && error.message) || 'Could not load the event.'));
    }
  }, [code, enterIfLive]);

  useEffect(() => { load({ enter: true }); }, [load]);

  // Another host screen (the remote, a laptop) may move the day on: look again
  // now and then, and follow a live engagement onto its stage.
  useEffect(() => {
    const timer = setInterval(() => { if (!document.hidden) load({ enter: true }); }, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  // A break's countdown ticks once a second, and only while a break is live.
  const breakLive = Boolean(liveItem && isBreak(liveItem.type));
  useEffect(() => {
    if (!breakLive) return undefined;
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [breakLive]);

  const act = useCallback(async (action, item) => {
    if (busy) return;
    setBusy(true);
    setRefusal('');
    try {
      const fresh = await runEvent(code, action, item ? item.itemId : undefined);
      if (!mounted.current) return;
      const live = (fresh.items || []).find((i) => i.itemId === fresh.event.liveItemId);
      if ((action === 'start' || action === 'resume') && live && isEngagement(live.type) && live.gameId) {
        // THE TRIGGER (s-04): the wipe names the item and says the phones have
        // moved, once, then the stage is the item's own.
        setView(fresh);
        setPanelOpen(false);
        setWipe({ title: typeLabel(live.type) || live.title });
        setTimeout(() => navigateTo(sessionStage(live.gameId, code)), WIPE_MS);
        return;
      }
      setView(fresh);
    } catch (error) {
      if (!mounted.current) return;
      setRefusal((error && error.message) || 'That did not work. Try again.');
      load();
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, [busy, code, load]);

  /** A talk or an activity is ended, and then the next item started. */
  const endThenStart = useCallback(async (current, next) => {
    await act('end', current);
    if (next) await act('start', next);
  }, [act]);

  // ── The one obvious next step, for the dock ──────────────────────────────
  const plan = useMemo(() => {
    if (!event) return null;
    if (event.state === 'ENDED') return { label: 'Back to the builder', run: () => navigateTo('/admin') };
    const next = liveItem ? nextAfter(items, liveItem.itemId) : firstPlanned(items);
    if (liveItem && isBreak(liveItem.type)) {
      return next
        ? { label: `Start ${startWords(next)}`, run: () => act('start', next) }
        : { label: 'End the break', run: () => act('end', liveItem) };
    }
    if (liveItem) {
      return next
        ? { label: `Next: ${startWords(next)}`, run: () => endThenStart(liveItem, next) }
        : { label: `End ${liveItem.title || typeLabel(liveItem.type)}`, run: () => act('end', liveItem) };
    }
    if (next) return { label: `Start ${startWords(next)}`, run: () => act('start', next) };
    const paused = items.find((i) => i.state === 'paused');
    if (paused) return { label: `Resume ${paused.title || typeLabel(paused.type)}`, run: () => act('resume', paused) };
    return { label: 'End the event', run: () => setConfirmEndEvent(true) };
  }, [event, items, liveItem, act, endThenStart]);

  // SPACE (and the clicker's arrow) takes the dock's step, as on every stage.
  useEffect(() => {
    const onKey = (e) => {
      if (panelOpen || confirmEndEvent || busy || !plan) return;
      const tag = (e.target && e.target.tagName) || '';
      if (/INPUT|TEXTAREA|SELECT|BUTTON/.test(tag)) return;
      if (e.key === ' ' || e.key === 'ArrowRight') {
        e.preventDefault();
        plan.run();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [plan, panelOpen, confirmEndEvent, busy]);

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

  // ── What the wall says ───────────────────────────────────────────────────
  const ended = event.state === 'ENDED';
  const started = event.state === 'LIVE' || items.some((i) => (i.state || 'planned') !== 'planned');
  const done = items.filter((i) => i.state === 'done' && !isBreak(i.type)).length;
  const counted = items.filter((i) => !isBreak(i.type)).length;
  const next = liveItem ? nextAfter(items, liveItem.itemId) : firstPlanned(items);
  const talk = liveItem && !isBreak(liveItem.type) && !isEngagement(liveItem.type) ? liveItem : null;

  let chip;
  let railCtx;
  let main;
  let status;
  if (ended) {
    chip = ['done', 'The day is over'];
    railCtx = `${done} of ${counted} done`;
    status = `${event.attendeeCount || 0} joined`;
    main = (
      <div className="ag-up">
        <h1 className="ag-title">That’s the day.</h1>
        <p className="ag-date">{`${title(event)} · ${done} of ${counted} items run.`}</p>
        <p className="qdetail">Each item’s report is in the session history.</p>
      </div>
    );
  } else if (liveItem && isBreak(liveItem.type)) {
    const count = countdown(liveItem.endsAt, nowMs);
    chip = ['lobby', 'Break'];
    railCtx = `${done} of ${counted} done`;
    status = count.left > 0 ? 'Counting down to the planned return' : 'Back now — start the next item';
    main = (
      <div className="ag-up">
        <p className="ty"><TypeIcon type="break" />{`Back at ${wallClock(liveItem.endsAt, event.timeZone) || liveItem.until}`}</p>
        <p className="ag-count" role="timer" aria-label={`${count.text} until the break ends`}>{count.text}</p>
        <p className="qdetail">
          {liveItem.description ? `${liveItem.description} ` : ''}
          {next ? <>Next: <b>{next.title}</b>{next.ledBy ? ` · ${next.ledBy}` : ''}.</> : null}
        </p>
      </div>
    );
  } else if (talk) {
    const pos = positionOf(items, talk.itemId);
    chip = ['lobby', talk.type === rules.PRESENTATION ? 'Now presenting' : 'Now'];
    railCtx = pos ? `${pos.n} of ${pos.of}` : '';
    status = `${event.attendeeCount || 0} joined`;
    main = (
      <div className="ag-up">
        <p className="ty"><TypeIcon type={talk.type} />{typeLabel(talk.type)}</p>
        <h2 className="q">{talk.title}</h2>
        {talk.ledBy && <p className="ag-who">{talk.ledBy}</p>}
        {talk.description && <p className="qdetail">{talk.description}</p>}
        <JoinBlock code={code} label="Just arrived? Open" />
      </div>
    );
  } else if (!started) {
    chip = ['lobby', 'Starting soon'];
    railCtx = `Ends ${event.endsAt || ''}`;
    status = `${event.attendeeCount || 0} joined`;
    main = (
      <div className="ag-up">
        <h1 className="ag-title">{title(event)}</h1>
        <p className="ag-date">{rules.formatEventDay(event.startsAt)}{event.place ? ` · ${event.place}` : ''}</p>
        <JoinBlock code={code} label="Open on your phone, laptop or tablet" />
      </div>
    );
  } else {
    chip = ['lobby', 'Between items'];
    railCtx = `${done} of ${counted} done`;
    status = `${event.attendeeCount || 0} joined`;
    main = next ? (
      <div className="ag-up">
        <p className="ty"><TypeIcon type={next.type} />{`${typeLabel(next.type)} · next`}</p>
        <h2 className="q">{next.title || typeLabel(next.type)}</h2>
        {next.ledBy && <p className="ag-who">{next.ledBy}</p>}
        {next.description && <p className="qdetail">{next.description}</p>}
        <JoinBlock code={code} label="Just arrived? Open" />
      </div>
    ) : (
      <div className="ag-up">
        <h2 className="q">Everything on the agenda has started.</h2>
        <p className="qdetail">Resume a paused item from the Agenda, or end the event.</p>
        <JoinBlock code={code} label="Just arrived? Open" />
      </div>
    );
  }

  const wallHeading = !started ? 'Today' : liveItem ? 'Coming up' : 'Later today';
  const wallItems = !started ? items : items.filter((i) => (i.state || 'planned') !== 'done'
    && (!liveItem || i.itemId !== liveItem.itemId) && (!next || i.itemId !== next.itemId || liveItem));
  // The wall's agenda sits in the stage's side column, where the lobby's
  // meter sits (agenda-redesign s-01, s-03): `.main` keeps its two tracks.
  const wallEl = !started
    ? <WallList items={items} heading={wallHeading} markId={next ? next.itemId : null} markWord="First" />
    : <WallList items={wallItems} heading={wallHeading} markId={null} markWord="" />;
  const railEl = (
    <header className="rail">
      <span className={`chip ${chip[0]}`}><span className="dot" />{chip[1]}</span>
      <span className="rail-title" data-drop="1">{title(event)}</span>
      <span className="rail-ctx"><b>{railCtx}</b></span>
      {!ended && (liveItem && isBreak(liveItem.type)) && (
        <div className="rail-join">
          <span data-join-word="" data-drop="2">JOIN</span>
          <span data-join-url="" data-drop="3">{joinDisplayUrl()}</span>
          <code>{code}</code>
        </div>
      )}
    </header>
  );

  const dockEl = (
    <footer className="dock">
      <span className={`status${ended ? '' : ' go'}`} aria-live="polite">{refusal || status}</span>
      <span className="spacer" />
      {liveItem && isBreak(liveItem.type) && (
        <button type="button" className="btn ghost" disabled={busy} onClick={() => act('extend', liveItem)}>+5 min</button>
      )}
      {plan && !ended && <span className="kbd" aria-hidden="true">SPACE</span>}
      {plan && (
        <button type="button" className="btn" disabled={busy} onClick={plan.run}>{plan.label}</button>
      )}
      <button type="button" className="dock-more" onClick={() => setPanelOpen(true)} aria-label="The agenda, with every item's controls">
        <span className="dock-more-lbl">AGENDA</span>
      </button>
    </footer>
  );

  return (
    <div className="ag-stage-root" data-theme="dark">
      <Stage
        profile={profile}
        phase={ended ? 'done' : 'lobby'}
        rail={railEl}
        dock={dockEl}
        meter={wallEl}
        fitKey={`${event.liveItemId}|${event.state}|${items.length}`}
        overlay={wipe ? (
          <div className="wipe ag-go" role="status">
            {wipe.title}
            <small>Phones have switched — <b>no code needed</b></small>
          </div>
        ) : null}
      >
        <div className="content">
          <div className="fitbox center">{main}</div>
        </div>
      </Stage>

      {panelOpen && (
        <Modal
          overlayClassName="ag-scrim"
          contentClassName="ag-panel"
          onClose={() => setPanelOpen(false)}
          label="The agenda"
          theme="dark"
        >
          <div className="ag-panel-head">
            <h2>The agenda</h2>
            <button type="button" className="ag-x" onClick={() => setPanelOpen(false)} aria-label="Close the agenda">
              <Icon name="X" weight="bold" size={18} color="currentColor" />
            </button>
          </div>
          {refusal && <p className="ag-refusal" role="alert">{refusal}</p>}
          <ol className="ag-rows">
            {items.map((item) => (
              <AgendaRow key={item.itemId} item={item} busy={busy || ended} onAct={act} code={code} />
            ))}
          </ol>
          <div className="ag-panel-foot">
            <span className="ag-joined">{`${event.attendeeCount || 0} joined · ${playUrl(code).replace(/^https?:\/\//, '')}`}</span>
            {!ended && (
              <button type="button" className="ag-end" disabled={busy} onClick={() => setConfirmEndEvent(true)}>
                End the event…
              </button>
            )}
            <button type="button" className="ag-close" onClick={() => setPanelOpen(false)}>Close</button>
          </div>
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
              onClick={async () => { setConfirmEndEvent(false); setPanelOpen(false); await act('end-event'); }}
            >
              End the event
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function title(event) {
  return (event && event.title) || 'The event';
}

/** One row of the host's agenda: its state, and the actions that fit it. */
function AgendaRow({ item, busy, onAct, code }) {
  const state = item.state || 'planned';
  const words = { planned: '', live: 'Live', paused: 'Paused', done: 'Done' };
  return (
    <li className={`ag-row ag-row--${state}`}>
      <span className="ag-row-at">{item.at}</span>
      <span className="ag-row-main">
        <span className="ag-row-tt">{item.title || typeLabel(item.type)}</span>
        <span className="ag-row-ty">
          <TypeIcon type={item.type} size={14} />
          {typeLine(item)}
          {words[state] && <b className={`ag-row-st ag-row-st--${state}`}>{words[state]}</b>}
        </span>
      </span>
      <span className="ag-row-go">
        {state === 'planned' && (
          <button type="button" className="ag-act" disabled={busy} onClick={() => onAct('start', item)}>Start</button>
        )}
        {state === 'paused' && (
          <button type="button" className="ag-act" disabled={busy} onClick={() => onAct('resume', item)}>Resume</button>
        )}
        {state === 'live' && isEngagement(item.type) && item.gameId && (
          <button type="button" className="ag-act" disabled={busy} onClick={() => navigateTo(sessionStage(item.gameId, code))}>Open</button>
        )}
        {state === 'live' && !isBreak(item.type) && (
          <button type="button" className="ag-act ag-act--quiet" disabled={busy} onClick={() => onAct('pause', item)}>Pause</button>
        )}
        {(state === 'live' || state === 'paused') && (
          <button type="button" className="ag-act ag-act--quiet" disabled={busy} onClick={() => onAct('end', item)}>End</button>
        )}
      </span>
    </li>
  );
}
