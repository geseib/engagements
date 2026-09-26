import React, { useCallback, useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import EventDetailsDialog from './EventDetailsDialog';
import EventItemDialog from './EventItemDialog';
import rules from '../../../lambda-functions/websocket/events/agenda-rules';
import { getEvent, reorderItems, updateItem } from '../utils/eventsApi';
import './EventBuilder.css';

/**
 * ONE EVENT'S AGENDA — docs/design/agenda-redesign/02-builder.html and
 * 02b-cap-reached.html. A place in the console (AdminPage draws the event's
 * name as the title and "Events" as the breadcrumb back).
 *
 *   - The facts, once each: date, start and zone, place, who can join, the
 *     code. "Edit details" opens the new-event dialog filled in.
 *   - The agenda table. Times are the start plus the running total
 *     (agenda-rules.agendaTimes, the same function the server's public agenda
 *     uses), so a move re-times every row after it at once.
 *   - Reorder three ways (RATIONALE §c, WCAG 2.5.7 — drag is never the only
 *     way): the grip, the ↑/↓ buttons, and Alt+↑/Alt+↓ on a focused row.
 *     Each move is saved as the whole order; a refusal puts the rows back
 *     and says why.
 *   - "Use vN" on an engagement whose set has a newer version than the one
 *     pinned — never applied silently.
 *   - The add menu, grouped as 02 draws it. At 8 engagements the engagement
 *     kinds disable WITH the reason above them (02b); Break stays open.
 *     Presentation and Survey are listed, disabled, "Coming soon": they are
 *     roadmap M5 and PLAN Phase 6.
 *   - The foot: the end time, the planned length and both caps, counted once.
 *
 * NOT HERE YET, and why: the Invitations and Reports tabs (PLAN Phases 3 and
 * 5) — a tab strip with one tab is a control people learn to ignore — and
 * "Rehearse on the stage" (roadmap M3).
 *
 * @param {string}   code     the event
 * @param {object[]} sets     the console's question sets, for the set picker
 * @param {Function} [onTitle] (title) => void — the place's heading follows a rename
 */
const TYPE_ICONS = {
  trivia: 'Brain',
  'call-and-answer': 'ChatCircleText',
  poll: 'ChartBar',
  wavelength: 'Waves',
  survey: 'ListChecks',
  presentation: 'Monitor',
  break: 'Clock',
};
const MENU_ENGAGEMENTS = [
  ['survey', 'A form people fill in at their own pace.'],
  ['trivia', 'Questions with one right answer. Scored, with standings.'],
  ['call-and-answer', 'Everyone writes an answer, then the room votes for the best.'],
  ['poll', 'One question at a time; each result revealed on the main screen.'],
  ['wavelength', 'Everyone gives a few words; the room’s shared language appears.'],
];

function sourceLine(item, until) {
  if (item.type === rules.BREAK) return { text: `Back at ${until} · not counted, not billed`, bad: false };
  if (!item.set) return { text: '', bad: false };
  if (item.set.missing) return { text: 'This question set is no longer available', bad: true };
  const version = item.setRef && item.setRef.version ? ` · v${item.setRef.version}` : '';
  return { text: `${item.set.name || 'Question set'}${version} · ${item.set.questionCount} questions`, bad: false };
}

export default function EventBuilder({ code, sets = [], onTitle }) {
  const [event, setEvent] = useState(null);
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialog, setDialog] = useState(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [dragFrom, setDragFrom] = useState(null);
  const rowRefs = useRef({});
  const focusAfterMove = useRef(null);
  const menuRef = useRef(null);
  /* The caller's callback, read through a ref: AdminPage passes a fresh arrow
     on every render, and as a dependency of `load` it would reload the event
     on every render. */
  const titleRef = useRef(onTitle);
  titleRef.current = onTitle;

  const load = useCallback(async () => {
    try {
      const body = await getEvent(code);
      setEvent(body.event);
      setItems(Array.isArray(body.items) ? body.items : []);
      setError('');
      if (titleRef.current && body.event) titleRef.current(body.event.title);
    } catch (err) {
      setError(err.message || 'Could not load the event.');
    } finally {
      setLoading(false);
    }
  }, [code]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (focusAfterMove.current && rowRefs.current[focusAfterMove.current]) {
      rowRefs.current[focusAfterMove.current].focus();
      focusAfterMove.current = null;
    }
  });

  useEffect(() => {
    if (!menuOpen) return undefined;
    const away = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [menuOpen]);

  const move = async (from, to) => {
    if (to < 0 || to >= items.length || from === to) return;
    const before = items;
    const next = items.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setItems(next);
    focusAfterMove.current = moved.itemId;
    try {
      await reorderItems(code, next.map((it) => it.itemId));
      setError('');
    } catch (err) {
      setItems(before);
      setError(err.message || 'The new order was not saved.');
      if (err.body && err.body.code === 'agenda_changed') load();
    }
  };

  const pinLatest = async (item) => {
    try {
      await updateItem(code, item.itemId, { version: item.set.latestVersion });
      await load();
    } catch (err) {
      setError(err.message || 'The version was not changed.');
    }
  };

  if (loading && !event) return <div className="evb"><p className="evb-loading">Loading the event…</p></div>;
  if (!event) {
    return (
      <div className="evb">
        <div className="evb-alert" role="alert"><span>{error || 'This event could not be opened.'}</span></div>
      </div>
    );
  }

  const counts = rules.countItems(items);
  const { rows, endsAt, totalMinutes } = rules.agendaTimes(event.startsAt, items);
  const itemsFull = counts.items >= rules.MAX_ITEMS;
  const engagementsFull = counts.engagements >= rules.MAX_ENGAGEMENTS;
  const breaksFull = counts.breaks >= rules.MAX_BREAKS;
  const engagementReason = itemsFull ? rules.CAP_SENTENCES.items : (engagementsFull ? rules.CAP_SENTENCES.engagements : '');
  let n = 0;

  const openAdd = (type) => {
    setMenuOpen(false);
    setDialog({ mode: 'add', type });
  };
  const afterWrite = async () => {
    setDialog(null);
    await load();
  };

  return (
    <div className="evb">
      {error && (
        <div className="evb-alert" role="alert">
          <Icon name="Warning" weight="fill" size={16} color="currentColor" />
          <span>{error}</span>
        </div>
      )}

      <div className="evb-facts" data-testid="event-facts">
        <div className="evb-fact"><span className="evb-lab">Date</span><span className="evb-v">{rules.formatEventDay(event.startsAt)}</span></div>
        <div className="evb-fact">
          <span className="evb-lab">Starts</span>
          <span className="evb-v">{rules.formatStartTime(event.startsAt)} <span className="evb-dim">· {event.timeZone}</span></span>
        </div>
        {event.place && <div className="evb-fact"><span className="evb-lab">Place</span><span className="evb-v">{event.place}</span></div>}
        <div className="evb-fact"><span className="evb-lab">Who can join</span><span className="evb-v">Anyone with the code</span></div>
        <div className="evb-fact"><span className="evb-lab">Join code</span><span className="evb-code">{event.code}</span></div>
        <div className="evb-fact evb-facts-acts">
          <button type="button" className="evb-btn" onClick={() => setDetailsOpen(true)}>
            <Icon name="PencilSimple" weight="bold" size={14} color="currentColor" /> Edit details
          </button>
        </div>
      </div>

      <section className="evb-panel">
        <header className="evb-panel-head">
          <h2>Agenda</h2>
          <p className="evb-note">The host starts each item. Times are the plan, not a timer.</p>
          <div className="evb-menuwrap" ref={menuRef}>
            <button
              type="button"
              className="evb-btn evb-btn--primary"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <Icon name="Plus" weight="bold" size={14} color="currentColor" /> Add item
            </button>
            {menuOpen && (
              <div className="evb-menu" role="menu" aria-label="Add to the agenda">
                <h6 className="evb-menu-h">Answered by the room{engagementsFull ? ` · ${counts.engagements} of ${rules.MAX_ENGAGEMENTS}` : ''}</h6>
                {engagementReason && (
                  <p className="evb-capnote" id="evb-capwhy">
                    <b>{engagementReason.split('. ')[0]}.</b> {engagementReason.split('. ').slice(1).join('. ')}
                    {!breaksFull && ' Breaks can still be added.'}
                  </p>
                )}
                {MENU_ENGAGEMENTS.map(([type, sentence]) => {
                  const soon = !rules.ADDABLE_TYPES.includes(type);
                  const disabled = soon || Boolean(engagementReason);
                  return (
                    <button
                      key={type}
                      type="button"
                      role="menuitem"
                      className="evb-menu-item"
                      disabled={disabled}
                      aria-describedby={engagementReason && !soon ? 'evb-capwhy' : undefined}
                      onClick={() => openAdd(type)}
                    >
                      <Icon name={TYPE_ICONS[type]} weight="bold" size={17} color="var(--primary)" />
                      <div>
                        <b>{rules.TYPE_LABELS[type]}</b>
                        <span>{soon ? `Coming soon. ${sentence}` : (engagementReason ? '' : sentence)}</span>
                      </div>
                    </button>
                  );
                })}
                <hr className="evb-menu-rule" />
                <h6 className="evb-menu-h">Talks</h6>
                <button type="button" role="menuitem" className="evb-menu-item" disabled>
                  <Icon name={TYPE_ICONS.presentation} weight="bold" size={17} color="var(--primary)" />
                  <div>
                    <b>Presentation</b>
                    <span>Coming soon. A talk from the presenter’s own screen, with an optional PDF copy for attendees.</span>
                  </div>
                </button>
                <hr className="evb-menu-rule" />
                <h6 className="evb-menu-h">Just on the agenda</h6>
                <button type="button" role="menuitem" className="evb-menu-item" disabled={breaksFull} onClick={() => openAdd(rules.BREAK)}>
                  <Icon name={TYPE_ICONS.break} weight="bold" size={17} color="var(--primary)" />
                  <div>
                    <b>Break</b>
                    <span>{breaksFull ? rules.CAP_SENTENCES.breaks : 'A return time on the agenda. Not counted, not billed.'}</span>
                  </div>
                </button>
              </div>
            )}
          </div>
        </header>

        {items.length === 0 ? (
          <p className="evb-foot" data-testid="agenda-empty">
            Nothing on the agenda yet. <b>Add item</b> puts the first one here; the times follow from the start.
          </p>
        ) : (
          <table className="evb-tbl">
            <thead>
              <tr>
                <th className="evb-col-grip" aria-label="Drag" />
                <th className="evb-col-no">#</th>
                <th className="evb-col-at">Time</th>
                <th>Item</th>
                <th className="evb-col-type">Type</th>
                <th className="evb-col-len">Length</th>
                <th className="evb-col-acts" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {rows.map((item, index) => {
                const isBreak = item.type === rules.BREAK;
                if (!isBreak) n += 1;
                const line = sourceLine(item, item.until);
                const newer = item.set && !item.set.missing && item.set.latestVersion
                  && item.setRef && item.setRef.version && item.set.latestVersion > item.setRef.version;
                const rowClass = [isBreak ? 'evb-row--brk' : '', dragFrom === index ? 'evb-row--moving' : ''].filter(Boolean).join(' ');
                return (
                  <tr
                    key={item.itemId}
                    ref={(el) => { rowRefs.current[item.itemId] = el; }}
                    className={rowClass || undefined}
                    tabIndex={0}
                    data-testid="agenda-row"
                    draggable
                    onDragStart={() => setDragFrom(index)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => { e.preventDefault(); if (dragFrom !== null) move(dragFrom, index); setDragFrom(null); }}
                    onDragEnd={() => setDragFrom(null)}
                    onKeyDown={(e) => {
                      if (!e.altKey || e.target !== e.currentTarget) return;
                      if (e.key === 'ArrowUp') { e.preventDefault(); move(index, index - 1); }
                      if (e.key === 'ArrowDown') { e.preventDefault(); move(index, index + 1); }
                    }}
                  >
                    <td className="evb-grip" title="Drag to move, or Alt+↑ / Alt+↓">
                      <Icon name="DotsSixVertical" weight="bold" size={14} color="currentColor" />
                    </td>
                    <td className="evb-no">{isBreak ? <span title="Breaks are not numbered or counted">–</span> : n}</td>
                    <td className="evb-at" data-testid="agenda-at">{item.at}</td>
                    <td>
                      <span className="evb-nm" title={item.title}>{item.title}</span>
                      {line.text && <span className={`evb-sub${line.bad ? ' evb-sub--bad' : ''}`} title={line.text}>{line.text}</span>}
                    </td>
                    <td>
                      <span className={`evb-type${isBreak ? ' evb-type--brk' : ''}`}>
                        <Icon name={TYPE_ICONS[item.type] || 'Circle'} weight="bold" size={13} color="currentColor" />
                        {rules.TYPE_LABELS[item.type] || item.type}
                      </span>
                    </td>
                    <td className="evb-len-cell">{item.minutes} min</td>
                    <td>
                      <div className="evb-rowact">
                        {newer && (
                          <button type="button" className="evb-btn evb-btn--sm" onClick={() => pinLatest(item)}>
                            Use v{item.set.latestVersion}
                          </button>
                        )}
                        <button type="button" className="evb-btn evb-btn--sm evb-btn--icon" aria-label={`Move ${item.title} up`} disabled={index === 0} onClick={() => move(index, index - 1)}>
                          <Icon name="ArrowUp" weight="bold" size={13} color="currentColor" />
                        </button>
                        <button type="button" className="evb-btn evb-btn--sm evb-btn--icon" aria-label={`Move ${item.title} down`} disabled={index === rows.length - 1} onClick={() => move(index, index + 1)}>
                          <Icon name="ArrowDown" weight="bold" size={13} color="currentColor" />
                        </button>
                        <button type="button" className="evb-btn evb-btn--sm" aria-label={`Edit ${item.title}`} onClick={() => setDialog({ mode: 'edit', type: item.type, item })}>
                          Edit
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p className="evb-foot" data-testid="agenda-foot">
          Ends <b>{endsAt}</b> · {rules.formatDuration(totalMinutes)} planned · <b>{counts.items}</b> of {rules.MAX_ITEMS} items
          {' '}· <b>{counts.engagements}</b> of {rules.MAX_ENGAGEMENTS} engagements
          {(itemsFull || engagementsFull) && <span className="evb-warn">· the most an event can hold</span>}
          {counts.breaks > 0 && <> · {counts.breaks} break{counts.breaks === 1 ? '' : 's'} <span className="evb-dim">(not counted)</span></>}
        </p>
      </section>

      {dialog && (
        <EventItemDialog
          code={event.code}
          mode={dialog.mode}
          type={dialog.type}
          item={dialog.item}
          items={items}
          sets={sets}
          onClose={() => setDialog(null)}
          onSaved={afterWrite}
          onRemoved={afterWrite}
        />
      )}
      {detailsOpen && (
        <EventDetailsDialog
          initial={event}
          onClose={() => setDetailsOpen(false)}
          onSaved={(saved) => {
            setDetailsOpen(false);
            setEvent({ ...event, ...saved });
            if (titleRef.current) titleRef.current(saved.title);
          }}
        />
      )}
    </div>
  );
}
