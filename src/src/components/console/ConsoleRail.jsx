import React, { useEffect, useState } from 'react';
import CW from '../../config/consoleWords';
import { consoleRailFor, peopleSummary } from '../../config/consoleRail';

const MARK = { answered: '✓', voted: '✓', here: '✓', writing: '…', 'not-yet': '…' };
const META = { answered: CW.answered, voted: CW.voted, writing: CW.stillWriting, 'not-yet': CW.notYet, here: '' };

/*
  A <details> whose `open` React owns. The summary's click is taken (no native
  toggle) so the host's choice lives in one place: ConsoleRail's state. The
  summary stays the native control, so it is focusable and Enter/Space press it.
*/
function Section({ id, title, summary, alert = false, open, onToggle, children, link, onLink }) {
  return (
    <details className="hc-sec" data-section={id} open={open}>
      <summary onClick={(e) => { e.preventDefault(); onToggle(id); }}>
        {title}<span className={`hc-count${alert ? ' is-alert' : ''}`}>{summary}</span>
      </summary>
      {children}
      {link ? <button type="button" className="hc-link" onClick={onLink}>{link}</button> : null}
    </details>
  );
}

/**
 * THE CONSOLE'S RAIL (spec §3.3): round queue, people, late & not reviewed,
 * session tools. The section that matters for the moment opens by itself; the
 * host's own open/close choice holds until the moment changes.
 */
export default function ConsoleRail({ moment, rounds = [], total = null, people = [], counts = {}, late = [], connected = true, onOpenSection = () => {} }) {
  const [open, setOpen] = useState(() => consoleRailFor(moment));
  useEffect(() => { setOpen(consoleRailFor(moment)); }, [moment]);
  const toggle = (id) => setOpen((cur) => (cur === id ? null : id));
  const nowRound = rounds.find((r) => r.state === 'now');
  // The session's total is the strip's ("Round 1 of 80"), never the length of
  // the list: the page knows only a few rounds' titles (walk, 15 Oct: the
  // queue said "1 of 7" beside "Round 1 of 80"). No total known: the round.
  const queueSummary = !nowRound ? '' : (Number(total) > 0 ? `${nowRound.n} of ${Number(total)}` : String(nowRound.n));
  return (
    <aside className="hc-rail" aria-label="Session">
      <Section id="queue" title={CW.queue} summary={queueSummary} open={open === 'queue'} onToggle={toggle} link={CW.allRounds} onLink={() => onOpenSection('history')}>
        <ul className="hc-list">
          {rounds.map((r) => (
            <li key={r.n} className={r.state === 'now' ? 'is-now' : ''}>
              <span className="hc-n">{r.n}</span>
              <span>{r.title}{r.state !== 'later' ? <span className="hc-meta">{` · ${CW[r.state]}`}</span> : null}</span>
            </li>
          ))}
        </ul>
      </Section>
      <Section id="people" title={CW.people} summary={peopleSummary({ moment, ...counts })} open={open === 'people'} onToggle={toggle} link={CW.allPlayers} onLink={() => onOpenSection('players')}>
        <ul className="hc-list">
          {people.map((p) => (
            <li key={p.name}>
              <span className={MARK[p.state] === '✓' ? 'hc-tick' : 'hc-wait'}>{MARK[p.state]}</span>
              <span>{p.name}{META[p.state] ? <span className="hc-meta">{` · ${META[p.state]}`}</span> : null}</span>
            </li>
          ))}
        </ul>
      </Section>
      <Section id="late" title={CW.late} summary={String(late.length)} alert={late.length > 0} open={open === 'late'} onToggle={toggle} link={late.length ? CW.reviewLate : null} onLink={() => onOpenSection('history')}>
        {late.length ? (
          <ul className="hc-list">
            {late.map((l) => (
              <li key={l.id}><span className="hc-bullet">•</span><span>{l.label}<span className="hc-meta">{l.meta ? ` · ${l.meta}` : ''}</span></span></li>
            ))}
          </ul>
        ) : <p className="hc-empty">{CW.noLate}</p>}
      </Section>
      <Section id="tools" title={CW.tools} summary={connected ? `● ${CW.connected}` : CW.offline} open={open === 'tools'} onToggle={toggle}>
        <ul className="hc-list">
          <li><button type="button" className="hc-link" onClick={() => onOpenSection('questions')}>{CW.questions}</button></li>
          <li><button type="button" className="hc-link" onClick={() => onOpenSection('history')}>{CW.rounds}</button></li>
          <li><button type="button" className="hc-link" onClick={() => onOpenSection('settings')}>{CW.settings}</button></li>
        </ul>
      </Section>
    </aside>
  );
}
