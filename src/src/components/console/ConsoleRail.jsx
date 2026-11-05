import React, { useEffect, useState } from 'react';
import Button from '../ui/Button';
import CW from '../../config/consoleWords';
import { consoleRailFor, railSummaries, scoresLive } from '../../config/consoleRail';
import LW from '../../config/lateWords';
import { canShowOnWall } from '../../utils/lateClient';
import NeedsActions from '../needs/NeedsActions';
import { NEEDS_ACTIONS, NEEDS_WORDS } from '../../config/needsYou';
import YoursMark from '../YoursMark';
import Icon from '../Icon';
import PersonRow, { PERSON_WORDS } from '../people/PersonRow';
import useArrival from '../../hooks/useArrival';
import { ownQuestionWords as OQ } from '../../config/consoleWords';
import '../needs/NeedsYou.css';

/** The rail shows the first few; "Review them" opens the whole list. */
const LATE_SHOWN = 3;

/* The doing-now glyph for each row state (PersonRow density="rail"), and its
   word: the glyph's accessible name and title (console-rail README D7). */
const MARK = { answered: 'done', voted: 'done', writing: 'wait', answering: 'wait', 'not-yet': 'wait', unknown: 'unknown' };
const WORD = {
  answered: CW.answered, voted: CW.voted, writing: CW.stillWriting, answering: CW.stillAnswering,
  'not-yet': CW.notYet, unknown: CW.notKnownYet,
};

/*
  A <details> whose `open` React owns. The summary's click is taken (no native
  toggle) so the host's choice lives in one place: the rail's state. The
  summary stays the native control, so it is focusable and Enter/Space press
  it, and it ALWAYS toggles: no header is a button that does nothing.

  The caret (README D2) is decorative; <details> exposes expanded/collapsed.
  `level` paints the header: 'now' wears the Needs-you line's own edge and
  wash, 'soon' a dot, 'calm' nothing. `label` is the summary's accessible
  name past its title, whole even where the visible text truncates (review
  A2); `tip` its title=. `arrived` is the one fade (README D4).
*/
export function Section({
  id, title, summary, alert = false, open, onToggle, children, link, onLink,
  level = 'calm', label = '', tip = undefined, arrived = false,
}) {
  return (
    <details className="hc-sec" data-section={id} open={open}>
      <summary
        onClick={(e) => { e.preventDefault(); onToggle(id); }}
        data-level={level}
        data-arrived={arrived ? '' : undefined}
        aria-label={label ? `${title}, ${label}` : undefined}
        title={tip}
      >
        <span className="hc-caret" aria-hidden="true"><Icon name="CaretRight" weight="bold" size={12} color="currentColor" /></span>
        <span className="hc-sec-title">{title}</span>
        <span className={`hc-count${alert ? ' is-alert' : ''}`}>{summary}</span>
      </summary>
      {children}
      {link ? <Button variant="tertiary" className="hc-sec-link" onClick={onLink}>{link}</Button> : null}
    </details>
  );
}

/** One header summary from railSummaries: [dot][who] · text · <b>strong</b>. */
function HeadSummary({ head }) {
  if (!head) return null;
  const { dot, who, text, strong } = head;
  return (
    <>
      {dot ? <i className="hc-dot" aria-hidden="true" /> : null}
      {who ? <span className="hc-who">{who}</span> : null}
      {who && text ? ' · ' : null}
      {text}
      {strong ? <>{text || who ? ' · ' : null}<b>{strong}</b></> : null}
    </>
  );
}

/** The format's one added fact (§3.2b, 2g): Trivia's ✓/✗ then the score; C&A the score. */
function Fact({ fact, unscored }) {
  if (!fact) return '';
  return (
    <span data-testid="person-fact">
      {fact.mark ? (
        <span className={fact.mark === 'right' ? 'prow-right' : 'prow-wrong'} role="img" aria-label={fact.mark === 'right' ? CW.gotItRight : CW.gotItWrong}>
          {fact.mark === 'right' ? '✓' : '✗'}
        </span>
      ) : null}
      {/* "–" before the first scored round: a column of zeros reads as everyone failed (review H5). */}
      <span className="hc-score">{unscored ? '–' : fact.score}</span>
    </span>
  );
}

/**
 * THE CONSOLE'S RAIL (spec §3.3; docs/design/console-rail): round queue,
 * people, late & not reviewed. The section that matters for the moment opens
 * by itself; the host's own open/close choice holds until the moment changes.
 * Every header says one useful thing, more when it is closed.
 */
export default function ConsoleRail({
  moment, rounds = [], total = null, people = [], counts = {}, late = [], lateCount = null, lateWall = null,
  onLateShow = () => {}, onLateMark = () => {}, onOpenSection = () => {},
  scoreboard = null,
  /* NEEDS YOU, ON THE PERSON (experience plan §3.2b, §4.4; console-rail D3):
     the name items from config/needsYou.js. An asker's row is lifted to the
     top under "Needs you", amber, with Let them / Not now in the row itself;
     an open name shows Lock again. People opens ONCE when a request arrives
     and the host may close it again: the closed header then carries the mark
     ("● Sam needs you · 6 here") in the Needs-you line's paint. */
  asking = [],
  onNeedsAct = null,
  needsBusy = false,
  needsError = '',
  /* THE IMPROMPTU ASK (README D2): a quiet "Write a question" link in the
     Round queue that opens the same composer step as the Session menu's
     Rounds. Null draws nothing. A round the host wrote carries `own: true`
     and is marked Yours. */
  onWriteQuestion = null,
  /* THE ROW'S ⋯ (PersonRow; the Session menu's People has the same two):
     Move to a new device, and Remove from session (pressed twice). Null
     leaves the item out. */
  onPersonMove = null,
  onPersonRemove = null,
}) {
  // A refusal from the late buttons, said in the section (as LateList does).
  const [lateError, setLateError] = useState('');
  // While one call is in flight every late button waits (LateList's `busy`),
  // so a second press cannot send it twice.
  const [lateBusy, setLateBusy] = useState(false);
  const lateAct = (fn) => async (item) => {
    setLateBusy(true);
    setLateError('');
    try {
      const r = await fn(item);
      if (r && r.ok === false) setLateError(r.error || 'That did not work.');
    } finally {
      setLateBusy(false);
    }
  };
  const askers = (asking || []).filter((a) => a.kind === 'name-request');
  const opened = (asking || []).filter((a) => a.kind === 'name-open');
  const flagged = new Set((asking || []).map((a) => a.name));
  const [open, setOpen] = useState(() => (askers.length ? 'people' : consoleRailFor(moment)));
  // A moment change opens its own section, unless someone is still asking:
  // then People (the read must not fold a request away; owner, 1 Nov).
  const asked = askers.length > 0;
  useEffect(() => { setOpen(asked ? 'people' : consoleRailFor(moment)); }, [moment]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (id) => setOpen((cur) => (cur === id ? null : id));
  // A new request opens People once, and fades the mark in (the line's same commit).
  const arrived = useArrival(askers.map((a) => a.id), () => setOpen('people'));
  const peopleOpen = open === 'people';
  const peopleRows = people.filter((p) => !flagged.has(p.name));
  const waiting = Number.isFinite(Number(lateCount)) && lateCount !== null ? Number(lateCount) : late.length;
  const heads = railSummaries({
    moment,
    open: { queue: open === 'queue', people: peopleOpen, late: open === 'late' },
    players: counts && counts.players ? Number(counts.players) : 0,
    people,
    askers,
    rounds,
    total,
    late: waiting,
  });
  const live = scoresLive(moment);
  const unscored = Boolean(scoreboard && scoreboard.show && !scoreboard.enabled);
  /* NO SCORE COLUMN UNTIL THERE IS A SCORE (owner, 5 Nov 2026, cut 6): a
     column of zeros (or dashes) beside every name before anyone has scored
     is noise. It appears with the first score above zero, or the first
     Trivia mark. */
  const scored = peopleRows.some((p) => p.fact && (Number(p.fact.score) > 0 || p.fact.mark));
  const menuFor = (name) => [
    onPersonMove && { id: 'move', label: PERSON_WORDS.move, onSelect: () => onPersonMove(name) },
    onPersonRemove && { id: 'remove', label: PERSON_WORDS.remove, danger: true, onSelect: () => onPersonRemove(name) },
  ].filter(Boolean);
  return (
    <aside className="hc-rail" aria-label="Session">
      <Section
        id="queue"
        title={CW.queue}
        summary={<HeadSummary head={heads.queue} />}
        level={heads.queue.level}
        label={heads.queue.label}
        tip={heads.queue.title}
        open={open === 'queue'}
        onToggle={toggle}
        link={CW.allRounds}
        onLink={() => onOpenSection('history')}
      >
        <ul className="hc-list">
          {rounds.map((r) => (
            <li key={r.n} className={r.state === 'now' ? 'is-now' : ''}>
              <span className="hc-n">{r.n}</span>
              {r.own ? <YoursMark className="hc-yours" /> : null}
              <span>{r.title}{r.state !== 'later' ? <span className="hc-meta">{` · ${CW[r.state]}`}</span> : null}</span>
            </li>
          ))}
        </ul>
        {onWriteQuestion ? (
          <button type="button" className="hc-link hc-write" onClick={onWriteQuestion} data-testid="rail-write">
            <Icon name="Plus" weight="bold" size={12} color="currentColor" />
            {OQ.write}
          </button>
        ) : null}
      </Section>
      <Section
        id="people"
        title={CW.people}
        summary={<HeadSummary head={heads.people} />}
        level={heads.people.level}
        label={heads.people.label}
        tip={heads.people.title}
        arrived={arrived}
        open={peopleOpen}
        onToggle={toggle}
        link={CW.allPeople(counts && counts.players)}
        onLink={() => onOpenSection('players')}
      >
        {askers.length || opened.length ? (
          <div className="ny ny-asking" data-testid="people-needs" data-arrived={arrived ? '' : undefined}>
            <p className="ny-k">{NEEDS_WORDS.title}</p>
            {askers.map((a) => (
              <div key={a.id} className="ny-asker" data-testid="people-asker">
                <span className="ny-asker-name">
                  <span className="ny-dot" aria-hidden="true" />
                  {a.name}
                  {/* The item's own `ago`, from the same clock as the Needs-you line. */}
                  {a.ago ? <span className="ny-asker-meta">{a.ago}</span> : null}
                </span>
                <span className="ny-asker-flag">{CW.wantsName}</span>
                <NeedsActions item={a} onAct={onNeedsAct} busy={needsBusy} only={[NEEDS_ACTIONS.LET, NEEDS_ACTIONS.NOT_NOW]} />
              </div>
            ))}
            {opened.map((a) => (
              <div key={a.id} className="ny-asker" data-testid="people-open">
                <span className="ny-asker-name">{a.name}</span>
                <span className="ny-asker-flag">{a.text}</span>
                <NeedsActions item={a} onAct={onNeedsAct} busy={needsBusy} />
              </div>
            ))}
            {needsError ? <p className="ny-empty ny-error" role="alert">{needsError}</p> : null}
          </div>
        ) : null}
        {/* THE SHARED PERSON ROW (PLAN §3.2b), at the rail's compact density:
            the status a glyph, the score muted mid-round and bright from
            Results (README D6, D7). While the room answers or votes the
            people still out come first (consoleRail.js peopleRows, cut 6). */}
        {peopleRows.length ? (
          // The columns' heads (frames 1, 3, 6): decorative, the row's own labels speak.
          <div className="hc-colhd" aria-hidden="true">
            <span />
            <span>{CW.colName}</span>
            <span>{peopleRows.some((p) => MARK[p.state]) ? '✓' : ''}</span>
            <span>{scored ? CW.colScore : ''}</span>
            <span />
          </div>
        ) : null}
        <ul className="hc-list hc-people" aria-label={CW.people}>
          {peopleRows.map((p) => (
            <PersonRow
              key={p.name}
              density="rail"
              name={p.name}
              status={p.away ? 'away' : 'here'}
              mark={MARK[p.state] || null}
              doing={WORD[p.state] || ''}
              note={!MARK[p.state] && p.from ? p.from : ''}
              fact={scored ? <Fact fact={p.fact} unscored={unscored} /> : ''}
              factLive={live && !unscored}
              menu={menuFor(p.name)}
            />
          ))}
        </ul>
        {/* THE SCOREBOARD, ON THE WALL OR OFF IT (owner, 16 Oct 2026): the
            page's own toggle (the S key's), drawn only where a scoreboard is
            allowed (config/scoreboard.js scoreboardAvailability: Trivia and
            Call & Answer), disabled with its reason before a round is scored. */}
        {scoreboard && scoreboard.show ? (
          <div className="hc-board">
            <Button
              variant="secondary"
              size={36}
              disabled={!scoreboard.enabled}
              onClick={() => scoreboard.onToggle(!scoreboard.open)}
            >
              {scoreboard.open ? CW.hideScoreboard : CW.showScoreboard}
            </Button>
            {!scoreboard.enabled && scoreboard.reason ? <span className="hc-meta">{scoreboard.reason}</span> : null}
          </div>
        ) : null}
      </Section>
      {/* LATE & NOT REVIEWED (late items Task 4): the whole count, the first
          few with their two quiet buttons; "Review them" opens the full list
          in the Session panel's Rounds tab. A Soon item: a dot and "2 to
          review", never amber (PLAN §4.1; console-rail fork 7). */}
      {/* NOT DRAWN WHEN IT SAYS "none" (owner, 5 Nov 2026, cut 6): a header
          whose only word is "none" is a row to read for nothing. It appears
          with the first late item. */}
      {waiting > 0 || late.length ? (
      <Section
        id="late"
        title={CW.late}
        summary={<HeadSummary head={heads.late} />}
        level={heads.late.level}
        label={heads.late.label}
        open={open === 'late'}
        onToggle={toggle}
        link={waiting ? CW.reviewLate : null}
        onLink={() => onOpenSection('history')}
      >
        {late.length ? (
          <ul className="hc-list">
            {late.slice(0, LATE_SHOWN).map((l) => (
              <li key={l.id} className="hc-late">
                <span className="hc-bullet">•</span>
                <span>
                  {l.label}<span className="hc-meta">{l.meta ? ` · ${l.meta}` : ''}</span>
                  {l.item ? (
                    <span className="hc-late-acts">
                      {canShowOnWall(l.item, lateWall) ? <Button variant="tertiary" disabled={lateBusy} onClick={() => lateAct(onLateShow)(l.item)}>{LW.show}</Button> : null}
                      {!l.item.reviewed ? <Button variant="tertiary" disabled={lateBusy} onClick={() => lateAct(onLateMark)(l.item)}>{LW.markReviewed}</Button> : null}
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        ) : <p className="hc-empty">{CW.noLate}</p>}
        {lateError ? <p className="hc-empty hc-error" role="alert">{lateError}</p> : null}
      </Section>
      ) : null}
      {/* No fourth section (experience plan 2a): the connection is on the top
          bar when it is broken, and Questions, Rounds and the settings are in
          the Session menu, top right. */}
    </aside>
  );
}
