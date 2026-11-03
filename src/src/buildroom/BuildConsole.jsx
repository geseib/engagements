/**
 * THE BUILD ROOM'S PRIVATE LAPTOP ON TWO SCREENS (parity PLAN §2 B8; owner,
 * 19 Oct 2026: "yes build consider and the console as drawn").
 *
 * Call & Answer's console (components/console/HostConsole) with the Build
 * Room's parts in its places, as docs/design/build-room-consider/ frame 1
 * draws it:
 *
 *   top line   ConsoleTop, the shared top bar (experience plan 2a, 2e):
 *              Main menu, the session, Join, Room's window ↗ and its status;
 *              then the Build Room's own Share demo and The room sees: Stage
 *              2 · Build 3 · History 4, See it here; the connection only when
 *              broken; the bell (Needs you); ?; Session menu
 *   strip      the ask path in the shared WorkflowStrip; dimmed between asks
 *              with a plain label on its left (answer (c))
 *   rail       three slots (answer (d)): Waiting for you, People (the
 *              shared person row, 340px), Later (Points inside). Session
 *              moved into the Session menu (experience plan 2e)
 *   needs      the Needs-you line under Your part now: Claude's asks, the
 *              room's ideas, name requests (config/needsYou.js)
 *   centre     "Your part now" (ConsoleFooter, on buildControls with the
 *              decide panel inline: answer (a)), the main button in it, an
 *              empty held slot between asks (answer (b)); Claude's one status
 *              line; then the moment's work, the page's own panels
 *   side       the right column as on one screen (owner, 28 Oct 2026): Claude
 *              now, then The brief and History (ClaudeNow, columnFolds in the
 *              page); Claude now is the console's status line too
 *
 * Data and nodes only: the page owns the session and builds every panel it
 * already had; this file places them and draws the rail's own lists.
 */
import React, { useEffect, useState } from 'react';
import HostConsole from '../components/console/HostConsole';
import { Section } from '../components/console/ConsoleRail';
import PersonRow from '../components/people/PersonRow';
import { BCW, RAIL_SLOTS, railOpenFor } from './buildConsole';
import './BuildConsole.css';


/**
 * People (answer (e); experience plan 2e, §3.2b): who is here, and who has
 * answered, by name, never what they chose. Each person is the shared person
 * row: dot, name, doing now, the ideas they gave, and ⋯ (Move to a new
 * device, Lock name, Remove from session; the Build Room has no Rename). An
 * asker's row turns amber with Let them / Not now, the Needs-you line's pair.
 */
export function PeopleList({ people, onPlayers, menuFor = null, asking = [], onNeedsAct = null, needsBusy = false }) {
  if (!people.rows.length) return <p className="hc-empty">{BCW.nobodyHere}</p>;
  const askBy = new Map((asking || []).map((a) => [a.name, a]));
  // Askers first (PLAN §4.4: "Sam's row moves to the top under Needs you").
  const rows = [...people.rows].sort((a, b) => (askBy.has(b.name) ? 1 : 0) - (askBy.has(a.name) ? 1 : 0));
  return (
    <>
      <ul className="bc-people" aria-label={BCW.people}>
        {rows.map((p) => (
          <PersonRow
            key={p.name}
            name={p.name}
            status={p.status || 'here'}
            state={p.state}
            doing={p.doing}
            fact={p.fact}
            menu={menuFor ? menuFor(p) : []}
            needsItem={askBy.get(p.name) || null}
            onNeedsAct={onNeedsAct}
            needsBusy={needsBusy}
          />
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

/** The rail: three slots (answer (d); Session moved into the Session menu, 2e). The one that matters opens by itself; the host's choice holds until the moment changes. */
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
  moment, top, topExtra, onLeave, strip, stripIdle, card, slots, side, children, needs = null, sheetRef = null,
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
      /* The Needs-you line under Your part now, and the Session menu's sheet
         host over the content area (experience plan 2e): the same frame as
         Call & Answer's. */
      needs={needs}
      sheetRef={sheetRef}
    >
      {children}
    </HostConsole>
  );
}

