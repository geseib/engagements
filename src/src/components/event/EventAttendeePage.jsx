import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PlayerPage from '../../PlayerPage';
import { PlayerShell } from '../PlayerShell';
import Icon from '../Icon';
import { EventBarContext } from './eventBar';
import * as api from '../../utils/attendeeApi';
import {
  TYPE_ICONS, typeLabel, typeLine, positionOf, wallClock, nextAfter, firstPlanned, stateWord,
  isEngagement, isBreak, rules,
} from './eventDisplay';
import '../PlayerSurface.css';
import './EventAttendeePage.css';

/**
 * THE ATTENDEE'S PAGE — /play?event=<code> (events M2–M4).
 * docs/design/agenda-redesign: p-05a (before the day), p-05 (between items),
 * p-06 (a talk), p-07 (the switch), p-09 (a break), p-08 (the end);
 * roadmap §3 and D1–D4 for the paused screen and "Back to live".
 *
 * ONE NAME, ONE CODE, ALL DAY. The attendee types a name once and gets a
 * token (utils/attendeeApi.js keeps it under the event's code). From then on
 * this page follows the host: when an engagement starts, the phone, laptop or
 * tablet switches into it — today's player screens, unchanged (PlayerPage with
 * `event`), joined by token with nothing to type — and when the host goes back
 * to the agenda it shows the paused screen, with the agenda one tap away. A
 * reload lands back where it was, identified by the token.
 *
 * HOW IT KNOWS. Between items it polls the agenda's `now` view every few
 * seconds (two reads, no decryption, lambda-functions/websocket/events/
 * get-agenda.js) and re-reads the whole agenda when `rev` moves. Inside an
 * item the session's own socket carries the event's frames (eventItemPaused,
 * eventItemStarted, …), which PlayerPage hands up here, so a pause or the
 * next item arrives at once. Hidden tabs do not poll.
 *
 * NOTHING IS LOST BY LOOKING AWAY (D3). "Agenda" hides the live item rather
 * than leaving it: the session stays mounted, socket and answer included, and
 * "Back to live" shows it again exactly as it was.
 */
const POLL_MS = 4000;
const FULL_READ_MS = 60000;
const BEAT_MS = 1200;

const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';

function ItemTypeIcon({ type }) {
  return <Icon name={TYPE_ICONS[type] || 'Circle'} weight="bold" size={15} color="currentColor" />;
}

export default function EventAttendeePage({ code }) {
  const [phase, setPhase] = useState('loading'); // loading | missing | error | name | ready
  const [agenda, setAgenda] = useState(null);
  const [attendee, setAttendee] = useState(null);
  const [nameInput, setNameInput] = useState('');
  const [joinError, setJoinError] = useState('');
  const [joining, setJoining] = useState(false);
  const [view, setView] = useState('agenda'); // agenda | item
  const [followed, setFollowed] = useState(null);
  const [beat, setBeat] = useState(null);
  const [online, setOnline] = useState(true);
  const lastLiveRef = useRef(undefined);
  const revRef = useRef('');
  const fullAtRef = useRef(0);
  const beatTimer = useRef(null);
  const mounted = useRef(true);

  useEffect(() => () => {
    mounted.current = false;
    clearTimeout(beatTimer.current);
  }, []);

  /**
   * What is live now, against what was live last time we looked. Something
   * newly live — a start or a resume — is followed at once, with the switch
   * beat (p-07). Nothing live any more leaves the page on the item it was
   * in: the render shows that item paused, ended, or the agenda.
   */
  const applyLive = useCallback((liveId) => {
    const live = liveId || '';
    const before = lastLiveRef.current;
    lastLiveRef.current = live;
    if (before === undefined) {
      // FIRST SIGHT — a reload or a late arrival lands in the live item (§6.4).
      if (live) {
        setFollowed(live);
        setView('item');
      }
      return;
    }
    if (live && live !== before) {
      setFollowed(live);
      setView('item');
      setBeat(live);
      clearTimeout(beatTimer.current);
      beatTimer.current = setTimeout(() => { if (mounted.current) setBeat(null); }, BEAT_MS);
    }
  }, []);

  const readAgenda = useCallback(async () => {
    const fresh = await api.getAgenda(code);
    if (!mounted.current) return null;
    setAgenda(fresh);
    revRef.current = (fresh.event && fresh.event.rev) || '';
    fullAtRef.current = Date.now();
    return fresh;
  }, [code]);

  // ── Arriving ──────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let first;
      try {
        first = await readAgenda();
      } catch (error) {
        if (cancelled) return;
        setPhase(error && error.status === 404 ? 'missing' : 'error');
        return;
      }
      if (cancelled || !first) return;
      const saved = api.readAttendee(code);
      if (saved) {
        try {
          const me = await api.whoAmI(code, saved.token);
          if (cancelled) return;
          const who = { token: saved.token, name: (me.attendee && me.attendee.name) || saved.name };
          setAttendee(who);
          setPhase('ready');
          applyLive(first.event.liveItemId);
          return;
        } catch (error) {
          if (cancelled) return;
          if (error && (error.status === 401 || error.status === 404)) {
            api.forgetAttendee(code);
          } else {
            // Offline or a blip: trust the token we hold; the item's own join
            // is the real check.
            setAttendee(saved);
            setPhase('ready');
            applyLive(first.event.liveItemId);
            return;
          }
        }
      }
      // The day is over and this browser never joined: the agenda, to read.
      if (first.event.state === 'ENDED') {
        setPhase('ready');
        return;
      }
      setPhase('name');
    })();
    return () => { cancelled = true; };
  }, [code, readAgenda, applyLive]);

  // ── Following ─────────────────────────────────────────────────────────────
  const refresh = useCallback(async () => {
    try {
      const fresh = await readAgenda();
      setOnline(true);
      if (fresh) applyLive(fresh.event.liveItemId);
    } catch (_) {
      setOnline(false);
    }
  }, [readAgenda, applyLive]);

  useEffect(() => {
    if (phase !== 'ready') return undefined;
    let stopped = false;
    let timer = null;
    const tick = async () => {
      if (typeof document !== 'undefined' && document.hidden) {
        timer = setTimeout(tick, POLL_MS);
        return;
      }
      try {
        const now = await api.getNow(code);
        if (stopped) return;
        setOnline(true);
        if (now && (now.rev !== revRef.current || Date.now() - fullAtRef.current > FULL_READ_MS)) {
          const fresh = await readAgenda();
          if (fresh) applyLive(fresh.event.liveItemId);
        } else if (now) {
          applyLive(now.liveItemId);
        }
      } catch (_) {
        if (!stopped) setOnline(false);
      }
      if (!stopped) timer = setTimeout(tick, POLL_MS);
    };
    timer = setTimeout(tick, POLL_MS);
    const onVisible = () => {
      if (!document.hidden) {
        clearTimeout(timer);
        tick();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [phase, code, readAgenda, applyLive]);

  // ── Joining, once ─────────────────────────────────────────────────────────
  const submitName = async (e) => {
    if (e) e.preventDefault();
    const name = nameInput.trim();
    if (!name) {
      setJoinError('Type your name.');
      return;
    }
    setJoining(true);
    setJoinError('');
    try {
      const res = await api.joinEvent(code, name);
      const who = { token: res.token, name: (res.attendee && res.attendee.name) || name };
      api.saveAttendee(code, who);
      setAttendee(who);
      setPhase('ready');
      applyLive(agenda && agenda.event ? agenda.event.liveItemId : '');
    } catch (error) {
      if (error && error.status === 404) setPhase('missing');
      else setJoinError((error && error.message) || 'Could not join. Try again.');
    } finally {
      if (mounted.current) setJoining(false);
    }
  };

  const notYou = () => {
    api.forgetAttendee(code);
    setAttendee(null);
    setNameInput('');
    setView('agenda');
    setFollowed(null);
    lastLiveRef.current = undefined;
    setPhase('name');
  };

  const onNotJoined = useCallback(() => notYou(), []); // eslint-disable-line react-hooks/exhaustive-deps
  const toAgenda = useCallback(() => setView('agenda'), []);
  const onFrame = useCallback(() => { refresh(); }, [refresh]);
  const eventBar = useMemo(() => ({ onAgenda: toAgenda }), [toAgenda]);

  // ── What to draw ──────────────────────────────────────────────────────────
  const event = (agenda && agenda.event) || {};
  const items = (agenda && agenda.items) || [];
  const title = event.title || 'The event';
  const liveId = event.liveItemId || '';
  const liveItem = items.find((i) => i.itemId === liveId) || null;
  const current = items.find((i) => i.itemId === followed) || null;
  const who = attendee ? firstName(attendee.name) : '';
  const barCtx = (item) => {
    const pos = item ? positionOf(items, item.itemId) : null;
    return pos ? `${title} · ${pos.n} of ${pos.of}` : title;
  };

  // The item's session: mounted while it is live or paused, and after it
  // ends until the attendee leaves its end screen. Hidden, never unmounted,
  // while they look at the agenda — nothing is lost by looking (D3).
  const playing = current && isEngagement(current.type) && current.gameId
    && (current.state !== 'done' || view === 'item') ? current : null;
  const showPlaying = Boolean(playing && view === 'item' && !beat && playing.state !== 'paused');
  const sessionEvent = useMemo(() => (playing && attendee ? {
    code, token: attendee.token, gameId: playing.gameId, onAgenda: toAgenda, onFrame, onNotJoined,
  } : null), [playing && playing.gameId, attendee && attendee.token, code, toAgenda, onFrame, onNotJoined]); // eslint-disable-line react-hooks/exhaustive-deps

  const session = sessionEvent ? (
    <div hidden={!showPlaying}>
      <EventBarContext.Provider value={eventBar}>
        <PlayerPage key={sessionEvent.gameId} event={sessionEvent} />
      </EventBarContext.Provider>
    </div>
  ) : null;

  if (phase === 'loading') {
    return (
      <PlayerShell phase="join" volume="rest" ctx="Event" centre>
        <h1 className="plr-h1">Opening the event…</h1>
      </PlayerShell>
    );
  }

  if (phase === 'missing' || phase === 'error') {
    return (
      <PlayerShell phase="join" volume="rest" ctx="Event" centre>
        <div className="evp">
          <h1 className="plr-h1">
            {phase === 'missing' ? `Nothing is running with ${code}.` : 'Could not open the event.'}
          </h1>
          <p className="plr-lede plr-muted">
            {phase === 'missing'
              ? 'Check the code on the main screen, or ask the host for the link.'
              : 'Check your connection and try again.'}
          </p>
          <p className="evp-foot">
            {phase === 'missing'
              ? <a className="plr-linkish" href="/join">Type a different code</a>
              : <button type="button" className="plr-linkish" onClick={() => window.location.reload()}>Try again</button>}
          </p>
        </div>
      </PlayerShell>
    );
  }

  if (phase === 'name') {
    return (
      <PlayerShell
        phase="join"
        volume="act"
        ctx={title}
        dock={(
          <>
            <button type="submit" form="evp-join-form" className="plr-btn" disabled={joining}>
              {joining ? 'Joining…' : 'Join the event'}
            </button>
            <p className="plr-note plr-note--after">
              Once, for the whole day. No account, nothing to install, and no more codes.
            </p>
          </>
        )}
      >
        <div className="evp">
          <p className="evp-when">{rules.formatEventDay(event.startsAt)}{event.place ? ` · ${event.place}` : ''}</p>
          <h1 className="plr-h1">{title}</h1>
          <p className="plr-lede plr-muted">
            Type your name once. This page follows the agenda all day, and takes you into each item
            as the host starts it.
          </p>
          <form id="evp-join-form" onSubmit={submitName}>
            <div className="plr-field">
              <label className="plr-lab" htmlFor="evp-name">Your name</label>
              <input
                id="evp-name"
                type="text"
                className="plr-inp"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                maxLength={rules.ATTENDEE_NAME_MAX}
                autoComplete="name"
                aria-describedby="evp-name-help"
                required
              />
              <p className="plr-help" id="evp-name-help">
                Used for the scoreboard in scored items, and to bring you back in if you lose this page.
              </p>
            </div>
            {joinError && (
              <p className="plr-err" role="alert">
                <Icon name="WarningCircle" weight="bold" size={16} />
                {joinError}
              </p>
            )}
            <input type="submit" hidden aria-hidden="true" tabIndex={-1} />
          </form>
        </div>
      </PlayerShell>
    );
  }

  // ── Ready ────────────────────────────────────────────────────────────────
  const ended = event.state === 'ENDED';
  const started = event.state === 'LIVE' || ended || items.some((i) => (i.state || 'planned') !== 'planned');
  const nextId = (firstPlanned(items) || {}).itemId;
  const returnAtOf = (item) => wallClock(item && item.endsAt, event.timeZone) || (item && item.until) || '';

  // THE SWITCH (p-07): one still beat that names the item, then the item.
  if (view === 'item' && beat && current && current.itemId === beat) {
    const pos = positionOf(items, current.itemId);
    return (
      <>
        <PlayerShell phase="ask" volume="watch" ctx={barCtx(current)} who={who} online={online} centre>
          <div className="evp evp-beat">
            <p className="evp-kick">
              <ItemTypeIcon type={current.type} />
              {typeLabel(current.type)}{pos ? ` · ${pos.n} of ${pos.of}` : ''}
            </p>
            <h1 className="plr-h1">{current.title}</h1>
            {attendee && (
              <p className="evp-in">
                <span className="evp-dot" aria-hidden="true" />
                {`You’re in as ${attendee.name}. No code needed.`}
              </p>
            )}
          </div>
        </PlayerShell>
        {session}
      </>
    );
  }

  if (view === 'item' && current) {
    const state = current.state || 'planned';
    const next = nextAfter(items, current.itemId);
    // p-06 / p-09: an engagement is named by its kind ("Trivia · How well…"),
    // a talk or an activity by who leads it ("The FY27 plan · Marcus Oyelaran").
    const nextName = (n) => {
      if (isEngagement(n.type)) return `${typeLabel(n.type)} · ${n.title}`;
      return n.ledBy ? `${n.title} · ${n.ledBy}` : n.title;
    };
    const nextLine = next ? (
      <p className="evp-next">
        Next <b>{nextName(next)}</b>
      </p>
    ) : null;

    // PAUSED (D1): the host went back to the agenda; answers are kept.
    if (state === 'paused') {
      return (
        <>
          <PlayerShell
            phase="rest"
            volume="rest"
            ctx={barCtx(current)}
            who={who}
            online={online}
            centre
            dock={(
              <button type="button" className="plr-btn" onClick={toAgenda}>Open the agenda</button>
            )}
          >
            <div className="evp">
              <p className="evp-when">Paused · {current.title}</p>
              <h1 className="plr-h1">The host will be back.</h1>
              <p className="plr-lede plr-muted">
                Anything you have already sent is kept. This page picks up where it left off when the
                host resumes.
              </p>
            </div>
          </PlayerShell>
          {session}
        </>
      );
    }

    if (isEngagement(current.type) && current.gameId && (state === 'live' || state === 'done')) {
      return session;
    }

    // A BREAK (p-09): when to be back.
    if (state === 'live' && isBreak(current.type)) {
      return (
        <PlayerShell phase="rest" volume="rest" ctx={title} who={who} online={online} centre>
          <div className="evp">
            <p className="evp-when">Break</p>
            <h1 className="plr-h1">Back at {returnAtOf(current)}</h1>
            <p className="plr-lede plr-muted">
              {current.description ? `${current.description} ` : ''}
              This page switches by itself when the next item starts.
            </p>
            {nextLine}
          </div>
        </PlayerShell>
      );
    }

    // A TALK OR AN ACTIVITY (p-06): look up.
    if (state === 'live') {
      const pos = positionOf(items, current.itemId);
      const talk = current.type === rules.PRESENTATION;
      const lead = current.ledBy
        ? (talk ? `${current.ledBy} is presenting.` : `Led by ${current.ledBy}.`)
        : '';
      return (
        <PlayerShell phase="rest" volume="watch" ctx={title} who={who} online={online}>
          <div className="evp">
            <p className="evp-when">
              Now{pos ? ` · ${pos.n} of ${pos.of}` : ''} · {talk ? 'A talk' : typeLabel(current.type)}
            </p>
            <h1 className="plr-h1">{current.title}</h1>
            <p className="plr-lede plr-muted">
              {lead ? `${lead} ` : ''}
              <b>Look up</b> — this page switches by itself when there is something to answer.
            </p>
            {current.description && <p className="evp-desc">{current.description}</p>}
            {nextLine}
          </div>
        </PlayerShell>
      );
    }
  }

  // THE AGENDA (p-05a before the day, p-05 between items, p-08 at the end).
  const backToLive = liveItem && (liveItem.state || '') === 'live' ? liveItem : null;
  const kicker = started
    ? [rules.formatEventDay(event.startsAt).replace(/ \d{4}$/, ''), event.place].filter(Boolean).join(' · ')
    : `${rules.formatEventDay(event.startsAt)} · ${rules.formatStartTime(event.startsAt)}–${event.endsAt || ''}`;
  const heading = ended ? 'That’s the day.' : started ? (backToLive ? title : 'Nothing to do here.') : title;
  let lede;
  if (ended) lede = 'Thanks for taking part. Everything below has finished.';
  else if (!started) lede = `${event.place ? `${event.place}. ` : ''}Nothing opens before the day: each item starts when the host starts it, and this page follows along.`;
  else if (backToLive) lede = 'Something is live now. Go back to it whenever you are ready.';
  else lede = 'This page switches by itself when the host starts the next item.';

  return (
    <>
      <PlayerShell
        phase={ended ? 'done' : 'rest'}
        volume="rest"
        ctx={title}
        who={who}
        online={online}
        dock={backToLive ? (
          <button type="button" className="plr-btn" onClick={() => { setFollowed(backToLive.itemId); setView('item'); }}>
            Back to live · {backToLive.title}
          </button>
        ) : null}
      >
        <div className="evp">
          <p className="evp-when">{kicker}</p>
          <h1 className="plr-h1">{heading}</h1>
          <p className="plr-lede plr-muted">{lede}</p>
          <ol className="evp-list">
            {items.map((item) => {
              const word = stateWord(item, { started, nextId });
              const state = item.state || 'planned';
              const cls = [
                'evp-it',
                state === 'done' ? 'evp-it--done' : '',
                state === 'live' ? 'evp-it--now' : '',
                isBreak(item.type) ? 'evp-it--brk' : '',
              ].filter(Boolean).join(' ');
              return (
                <li key={item.itemId} className={cls}>
                  <span className="evp-at">{item.at}</span>
                  <div className="evp-body">
                    <span className="evp-tt">{item.title || typeLabel(item.type)}</span>
                    <span className="evp-ty">
                      <ItemTypeIcon type={item.type} />
                      <span className="evp-tl">{typeLine(item, { returnAt: state === 'live' ? returnAtOf(item) : '' })}</span>
                      {word && <span className={`evp-st evp-st--${word.tone}`}>{word.word}</span>}
                    </span>
                    {!started && item.description && <p className="evp-desc">{item.description}</p>}
                  </div>
                </li>
              );
            })}
          </ol>
          {attendee && (
            <p className="evp-foot">
              {`In as ${attendee.name}. `}
              <button type="button" className="plr-linkish" onClick={notYou}>Not you?</button>
            </p>
          )}
        </div>
      </PlayerShell>
      {session}
    </>
  );
}
