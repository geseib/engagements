import React, { useCallback, useEffect, useState } from 'react';
import Icon from './Icon';
import EventDetailsDialog from './EventDetailsDialog';
import { listEvents } from '../utils/eventsApi';
import rules from '../../../lambda-functions/websocket/events/agenda-rules';
import './EventsPanel.css';

/**
 * EVENTS — the list (01-events.html), or, for a space not on the Team plan,
 * what an event is and the one way in (01b-events-personal.html).
 *
 * A place with a table, not a dialog: an event is an agenda, and the builder
 * it opens is a place too (EventBuilder.jsx, with a breadcrumb back here).
 * AdminPage owns which is on screen and draws "New event" in the work head
 * (NewEventButton below); this component owns the list, its filter and the
 * new-event dialog.
 *
 * Mountable on its own, like every console panel (AdminPage cannot be
 * mounted in jsdom): props in, calls through utils/eventsApi.js.
 *
 * @param {boolean}  teamPlan          the active organisation is on the Team plan
 * @param {boolean}  creating          the new-event dialog is open
 * @param {Function} onCreatingChange  (open: boolean) => void
 * @param {Function} onOpen            (code, title) => void — open the builder
 * @param {Function} [onRequestPlan]   opens "Request the Team plan"; absent for
 *                                     someone who may not ask (not the owner)
 * @param {Function} [onShowPlan]      opens Plan & usage; absent when this
 *                                     person has no such section
 */

/** Today as YYYY-MM-DD on this viewer's own calendar. */
export function todayIso(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** Upcoming is today or later, by the event's own date — a plan, not a timer. */
export const isUpcoming = (event, today) => String((event && event.startsAt) || '').slice(0, 10) >= today;

/** The work head's primary action; carries the scope so its tokens resolve. */
export function NewEventButton({ onClick }) {
  return (
    <span className="evts evts-headact">
      <button type="button" className="evts-btn evts-btn--primary evts-btn--lg" onClick={onClick}>
        <Icon name="Plus" weight="bold" size={16} color="currentColor" /> New event
      </button>
    </span>
  );
}

function TeamPlanOnly({ onRequestPlan, onShowPlan }) {
  return (
    <div className="evts">
      <div className="evts-empty" data-testid="events-team-only">
        <Icon name="CalendarBlank" weight="duotone" size={40} color="var(--primary)" />
        <h3>Events are part of the Team plan</h3>
        <p>
          An event puts a whole agenda behind one code — quizzes, Call &amp; Answer, polls and breaks, in the
          order you run them. This space is on the Personal plan.
        </p>
        <div className="evts-acts">
          {onRequestPlan && (
            <button type="button" className="evts-btn evts-btn--primary evts-btn--lg" onClick={onRequestPlan}>
              Request the Team plan
            </button>
          )}
          {onShowPlan && (
            <button type="button" className="evts-btn evts-btn--lg" onClick={onShowPlan}>What the Team plan adds</button>
          )}
        </div>
        {!onRequestPlan && <p className="evts-hint">Only an owner of this organisation can request the Team plan.</p>}
        <p className="evts-hint">Until then, <b>Sessions</b> runs one engagement at a time, exactly as today.</p>
      </div>
    </div>
  );
}

export default function EventsPanel({
  teamPlan, creating = false, onCreatingChange, onOpen, onRequestPlan, onShowPlan,
}) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(Boolean(teamPlan));
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [when, setWhen] = useState('upcoming');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setEvents(await listEvents());
    } catch (err) {
      setError(err.message || 'Could not load events.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (teamPlan) load();
  }, [teamPlan, load]);

  if (!teamPlan) return <TeamPlanOnly onRequestPlan={onRequestPlan} onShowPlan={onShowPlan} />;

  const today = todayIso();
  const upcoming = events.filter((e) => isUpcoming(e, today));
  const past = events.filter((e) => !isUpcoming(e, today)).reverse();
  const inView = when === 'upcoming' ? upcoming : past;
  const needle = search.trim().toLowerCase();
  const shown = needle
    ? inView.filter((e) => `${e.title} ${e.place} ${e.code}`.toLowerCase().includes(needle))
    : inView;
  const open = (event) => onOpen(event.code, event.title);

  return (
    <div className="evts">
      {error && (
        <div className="evts-alert" role="alert">
          <Icon name="Warning" weight="fill" size={16} color="currentColor" />
          <span>{error}</span>
        </div>
      )}
      {loading && events.length === 0 && <p className="evts-loading">Loading events…</p>}

      {!loading && !error && events.length === 0 && (
        <div className="evts-empty" data-testid="events-empty">
          <Icon name="CalendarBlank" weight="duotone" size={40} color="var(--primary)" />
          <h3>No events yet</h3>
          <p>
            An event puts a whole agenda behind one code: engagements and breaks, in the order you run them.
            You name it first, then build its agenda.
          </p>
          <div className="evts-acts">
            <button type="button" className="evts-btn evts-btn--primary evts-btn--lg" onClick={() => onCreatingChange(true)}>
              <Icon name="Plus" weight="bold" size={16} color="currentColor" /> New event
            </button>
          </div>
        </div>
      )}

      {events.length > 0 && (
        <>
          <div className="evts-filters">
            <label className="evts-search">
              <Icon name="MagnifyingGlass" weight="bold" size={14} color="currentColor" />
              <input
                className="evts-input"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search events"
                aria-label="Search events"
              />
            </label>
            <div className="evts-seg" role="group" aria-label="Show">
              <button type="button" aria-pressed={when === 'upcoming'} onClick={() => setWhen('upcoming')}>
                Upcoming <span className="evts-dim">{upcoming.length}</span>
              </button>
              <button type="button" aria-pressed={when === 'past'} onClick={() => setWhen('past')}>
                Past <span className="evts-dim">{past.length}</span>
              </button>
            </div>
          </div>

          {shown.length === 0 ? (
            <div className="evts-nomatch" data-testid="events-nomatch">
              {needle ? (
                <>
                  <p>No {when} event matches “{search.trim()}”.</p>
                  <button type="button" className="evts-btn" onClick={() => setSearch('')}>Clear the search</button>
                </>
              ) : (
                <>
                  <p>{when === 'upcoming' ? 'Nothing is coming up.' : 'Nothing has happened yet.'}</p>
                  <button type="button" className="evts-btn" onClick={() => setWhen(when === 'upcoming' ? 'past' : 'upcoming')}>
                    {when === 'upcoming' ? 'Show past events' : 'Show upcoming events'}
                  </button>
                </>
              )}
            </div>
          ) : (
            <table className="evts-tbl">
              <thead>
                <tr>
                  <th>Event</th>
                  <th className="evts-col-when">When</th>
                  <th className="evts-col-items evts-num">Items</th>
                  <th className="evts-col-who">Who can join</th>
                  <th className="evts-col-code">Code</th>
                  <th className="evts-col-state">State</th>
                  <th className="evts-col-acts" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {shown.map((event) => (
                  <tr key={event.code} data-testid="event-row">
                    <td>
                      <button type="button" className="evts-nm" title={event.title} onClick={() => open(event)}>
                        {event.title || 'Untitled event'}
                      </button>
                      {event.place && <span className="evts-sub" title={event.place}>{event.place}</span>}
                    </td>
                    <td className="evts-when">{rules.formatEventWhen(event.startsAt)}</td>
                    <td className="evts-num">{event.itemCount}</td>
                    <td>{event.access === 'invite' ? 'Invite only' : 'Anyone with the code'}</td>
                    <td className="evts-mono">{event.code}</td>
                    <td>
                      {event.itemCount > 0
                        ? <span className="evts-chip evts-chip--type">Scheduled</span>
                        : <span className="evts-chip evts-chip--off">Draft</span>}
                    </td>
                    <td>
                      <div className="evts-rowact">
                        <button type="button" className="evts-btn evts-btn--sm" onClick={() => open(event)} aria-label={`Open ${event.title}`}>
                          Open
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      {creating && (
        <EventDetailsDialog
          onClose={() => onCreatingChange(false)}
          onSaved={(event) => {
            onCreatingChange(false);
            onOpen(event.code, event.title);
          }}
        />
      )}
    </div>
  );
}
