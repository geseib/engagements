/**
 * THE BUILD ROOM'S PRIVATE LAPTOP ON TWO SCREENS (parity PLAN §2 B8; owner,
 * 19 Oct 2026: "yes build consider and the console as drawn").
 *
 * Call & Answer's console (components/console/HostConsole) with the Build
 * Room's parts in its places, as docs/design/build-room-consider/ frame 1
 * draws it:
 *
 *   top line   ConsoleTop: the session, Join, Room's window ↗ and its status;
 *              then Share demo, The room sees: Stage 2 · Build 3 · History 4,
 *              See it here, and the connection
 *   strip      the ask path in the shared WorkflowStrip; dimmed between asks
 *              with a plain label on its left (answer (c))
 *   rail       four slots, as C&A's (answer (d)): Waiting for you, People,
 *              Later (Points inside), Session
 *   centre     "Your part now" (ConsoleFooter, on buildControls with the
 *              decide panel inline: answer (a)), the main button in it, an
 *              empty held slot between asks (answer (b)); Claude's one status
 *              line; then the moment's work, the page's own panels
 *   side       Now, then the folds: Decided, Timeline, Asks, Screenshots, Room brief
 *
 * Data and nodes only: the page owns the session and builds every panel it
 * already had; this file places them and draws the rail's own lists.
 */
import React, { useEffect, useState } from 'react';
import HostConsole from '../components/console/HostConsole';
import { Section } from '../components/console/ConsoleRail';
import Icon from '../components/Icon';
import { BCW, RAIL_SLOTS, railOpenFor } from './buildConsole';
import './BuildConsole.css';


/** People (answer (e)): who is here, and who has answered, by name. Never what they chose. */
export function PeopleList({ people, onPlayers }) {
  if (!people.rows.length) return <p className="hc-empty">{BCW.nobodyHere}</p>;
  return (
    <>
      <ul className="hc-list bc-people" aria-label={BCW.people}>
        {people.rows.map((p) => (
          <li key={p.name} data-state={p.state}>
            {p.state === 'answered' ? <span className="hc-tick" aria-hidden="true"><Icon name="Check" size={12} weight="bold" /></span> : null}
            {p.state === 'not-yet' ? <span className="hc-wait" aria-hidden="true">…</span> : null}
            <span>
              {p.name}
              {p.builder ? <span className="bc-tag">{BCW.builder}</span> : null}
              {people.open ? <span className="hc-meta">{` · ${p.state === 'answered' ? people.verb : BCW.notYet}`}</span> : null}
            </span>
          </li>
        ))}
      </ul>
      <p className="bc-links">
        <button type="button" className="hc-link" onClick={() => onPlayers('')}>{BCW.allPlayers}</button>
        <span aria-hidden="true">·</span>
        <button type="button" className="hc-link" onClick={() => onPlayers('away')}>{BCW.away}</button>
        <span aria-hidden="true">·</span>
        <button type="button" className="hc-link" onClick={() => onPlayers('builders')}>{BCW.builders}</button>
      </p>
    </>
  );
}

/**
 * Session (the C&A "tools" slot): Claude's connection and plugin, the crew,
 * the room's screens looked at privately, the Session panel's tabs, and the
 * session's own ends. Every one is a door the Host screen or the Session
 * panel already had.
 */
export function SessionSlot({ s }) {
  return (
    <div className="bc-session">
      <ul className="hc-list">
        <li data-capability="claude-status">
          <button type="button" className="hc-link" onClick={s.onConnect}>{BCW.connectClaude}</button>
          {s.keyLine ? <span className="hc-meta">{` · ${s.keyLine}`}</span> : null}
        </li>
        <li data-capability="claude-status">
          <button type="button" className="hc-link" onClick={s.onPlugin}>{s.pluginOld ? BCW.pluginOld : BCW.pluginLatest}</button>
          {s.pluginLine ? <span className="hc-meta">{` · ${s.pluginLine}`}</span> : null}
        </li>
        {s.continueSlot ? <li>{s.continueSlot}</li> : null}
        <li data-capability="crew">
          <button type="button" className="hc-link" onClick={s.onCrew}>{BCW.crew}</button>
          {s.crewLine ? <span className="hc-meta">{` · ${s.crewLine}`}</span> : null}
        </li>
        <li>
          <span className="hc-meta">{BCW.lookHere}</span>
          <button type="button" className="hc-link" data-capability="build-screen" onClick={() => s.onLook('build')}>{BCW.build}</button>
          <span aria-hidden="true">·</span>
          <button type="button" className="hc-link" data-capability="history" onClick={() => s.onLook('history')}>{BCW.history}</button>
        </li>
      </ul>
      <p className="hc-card-h bc-subh">{BCW.sessionPanel}</p>
      <ul className="hc-list">
        <li>
          <button type="button" className="hc-link" data-capability="screens" onClick={() => s.onPanel('settings', 'screens')}>{BCW.screens}</button>
          <span aria-hidden="true">·</span>
          <button type="button" className="hc-link" data-capability="players" onClick={() => s.onPanel('players', '')}>{BCW.players}</button>
          <span aria-hidden="true">·</span>
          <button type="button" className="hc-link bc-sess" data-capability="settings" aria-haspopup="dialog" onClick={() => s.onPanel('settings', '')}>{BCW.settings}</button>
        </li>
        <li data-capability="report">
          {s.onBackToOpening ? (
            <>
              <button type="button" className="hc-link" data-capability="opening" disabled={s.busy} onClick={s.onBackToOpening}>{BCW.backToOpening}</button>
              <span aria-hidden="true">·</span>
            </>
          ) : null}
          <button type="button" className="hc-link" onClick={s.onWrap}>{BCW.wrapUp}</button>
          <span aria-hidden="true">·</span>
          <button type="button" className="hc-link" onClick={s.onReport}>{BCW.report}</button>
          {s.onEnd ? (
            <>
              <span aria-hidden="true">·</span>
              <button type="button" className="hc-link bc-end" onClick={s.onEnd}>{BCW.endSession}</button>
            </>
          ) : null}
        </li>
      </ul>
    </div>
  );
}

/** The rail: four slots (answer (d)). The one that matters opens by itself; the host's choice holds until the moment changes. */
export function BuildConsoleRail({ moment, slots }) {
  const [open, setOpen] = useState(() => railOpenFor(moment));
  useEffect(() => { setOpen(railOpenFor(moment)); }, [moment]);
  const toggle = (id) => setOpen((cur) => (cur === id ? null : id));
  return (
    <aside className="hc-rail bc-rail" aria-label="Session">
      {RAIL_SLOTS.map((id) => {
        const sl = slots[id];
        if (!sl) return null;
        return (
          <Section key={id} id={id} title={sl.title} summary={sl.summary} alert={Boolean(sl.alert)} open={open === id} onToggle={toggle} link={sl.link || null} onLink={sl.onLink}>
            <div className="bc-slot" data-capability={sl.capability}>{sl.body}</div>
          </Section>
        );
      })}
    </aside>
  );
}

/** "Claude is ready · Done: added the calendar grid." on top of the main area, in every moment. */
export function ClaudeLine({ state }) {
  if (!state || !state.headline) return null;
  return (
    <div className="bc-claude" role="status" aria-label={BCW.claudeNow} data-capability="claude-status" data-claude-status={state.key || ''}>
      <span className={`bc-dot bc-dot--${state.key || 'none'}`} aria-hidden="true" />
      <b>{state.headline}</b>
      {state.line ? <span className="hc-muted">{state.line}</span> : null}
      {state.helperLine ? <span className="hc-muted">{state.helperLine}</span> : null}
    </div>
  );
}

/** The side column's first card: what was last decided, and the screenshots so far. */
export function NowCard({ card }) {
  return (
    <section className="hc-card bc-now" aria-label={BCW.now}>
      <p className="hc-card-h">{BCW.now}</p>
      <p className="bc-nowline">{card.line}</p>
      <p className="hc-muted">{card.shots}</p>
    </section>
  );
}

/** A talking point up (view 1e): the point, the ideas on it as they land (names: the laptop is private), the source for the host alone. */
export function ConsolePoint({ point, ideas, sources = [] }) {
  return (
    <section className="hc-panel bc-point" aria-label="A talking point" data-capability="points">
      <p className="hc-kicker">{point.kind === 'finding' ? BCW.pointKickerResearch : BCW.pointKicker}</p>
      <h2 className="hc-h">{point.text}</h2>
      <div className="hc-cols">
        <div className="hc-resps">
          <p className="hc-card-h">{BCW.ideasOnThis}</p>
          {ideas.length ? ideas.map((i) => (
            <div key={i.ideaId} className="hc-resp">
              <small>{i.playerName || 'Someone'}</small>
              <span className="hc-resp-body">{i.text}</span>
            </div>
          )) : <p className="hc-muted">{BCW.noIdeasOnThis}</p>}
          <p className="hc-muted">{BCW.ideasJoinWaiting}</p>
        </div>
        {sources.length ? (
          <div className="hc-card">
            <p className="hc-card-h">{BCW.theSource}</p>
            {sources.map((src) => <p key={src.url || src.title} className="hc-muted">{[src.title, src.url].filter(Boolean).join(' · ')}</p>)}
            <p className="hc-muted">{BCW.sourceNever}</p>
          </div>
        ) : <div />}
      </div>
    </section>
  );
}

/**
 * The console. `card` is ConsoleFooter's props (the "Your part now" card);
 * `children` is the main area, the moment's work.
 */
export default function BuildConsole({
  moment, top, topExtra, onLeave, strip, stripIdle, card, slots, side, children,
}) {
  return (
    <HostConsole
      variant="hc--build"
      /* The top line's `?` opens the Build Room console's own section (Help
         Phase 3), not Call & Answer's. */
      top={{ help: 'build-console', ...top }}
      topExtra={topExtra}
      onLeave={onLeave}
      strip={strip}
      stripIdle={stripIdle}
      footer={card}
      railSlot={<BuildConsoleRail moment={moment} slots={slots} />}
      side={side}
      mainLabel="Now"
    >
      {children}
    </HostConsole>
  );
}

