import React, { useCallback, useEffect, useState } from 'react';
import Icon from './Icon';
import EventDetailsDialog from './EventDetailsDialog';
import { PlanRequestStrip } from './PlanRequestDialog';
import { listEvents } from '../utils/eventsApi';
import rules from '../../../lambda-functions/websocket/events/agenda-rules';
import pricing from '../../../lambda-functions/game/pricing';
import './EventsPanel.css';

const { upgradePlanFor, formatCents } = pricing;

/**
 * EVENTS — the list (01-events.html), or, for a space on Free, what an event
 * is and the one way in (01b-events-personal.html). Events come with either
 * paid plan (27 Sep 2026): Standard for a person's own space, the
 * Organisation plan for a team — each event $2.00, counted when it goes live.
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
 * @param {boolean}  teamPlan          the active organisation may run events (a
 *                                     paid plan; the name predates Standard)
 * @param {string}   [orgType]         'personal' | 'team' — which plan to offer
 * @param {boolean}  creating          the new-event dialog is open
 * @param {Function} onCreatingChange  (open: boolean) => void
 * @param {Function} onOpen            (code, title) => void — open the builder
 * @param {object}   [planRequest]     the org's latest plan request (Billing's
 *                                     own state, reused here, Fix round 1 #5) — while
 *                                     it is `status: 'requested'` the button below
 *                                     is replaced by the same strip Billing shows,
 *                                     so this page never offers a request that
 *                                     would 409
 * @param {Function} [onRequestPlan]   opens the plan request; absent for
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

function TeamPlanOnly({ onRequestPlan, onShowPlan, planRequest, orgType = '' }) {
  // Reads Billing's own state (Fix round 1 #5, ruling): a request already
  // sitting with Engage must read as pending here too, not offer a button
  // that would 409. Same `status === 'requested'` guard AdminPage's own
  // `?request=team` handling and BillingPanel already use.
  const pending = Boolean(planRequest && planRequest.status === 'requested');
  // What this space would move to: Standard for a person's own space, the
  // Organisation plan for a team. Never a team plan for an individual.
  const plan = upgradePlanFor({ type: orgType });
  const isTeam = plan.id === 'team';
  return (
    <div className="evts">
      <div className="evts-empty" data-testid="events-team-only">
        <Icon name="CalendarBlank" weight="duotone" size={40} color="var(--primary)" />
        <h3>{`Events come with the ${plan.name}`}</h3>
        <p>
          An event puts a whole agenda behind one code — quizzes, Call &amp; Answer, polls and breaks, in the
          order you run them.{' '}
          {isTeam
            ? 'This team is on Free until Engage approves its Organisation plan.'
            : 'This space is on Free.'}
          {` Each event is ${formatCents(plan.perEvent)}, counted when it first goes live — any host here can run one.`}
        </p>
        {pending && <PlanRequestStrip request={planRequest} />}
        <div className="evts-acts">
          {!pending && onRequestPlan && (
            <button type="button" className="evts-btn evts-btn--primary evts-btn--lg" onClick={onRequestPlan}>
              {`Request the ${plan.name}`}
            </button>
          )}
          {onShowPlan && (
            <button type="button" className="evts-btn evts-btn--lg" onClick={onShowPlan}>{`What the ${plan.name} adds`}</button>
          )}
        </div>
        {!onRequestPlan && !pending && (
          <p className="evts-hint">{`Only an owner of this organisation can request the ${plan.name}.`}</p>
        )}
        <p className="evts-hint">Until then, <b>Sessions</b> runs one engagement at a time, exactly as today.</p>
      </div>
    </div>
  );
}

export default function EventsPanel({
  teamPlan, orgType = '', creating = false, onCreatingChange, onOpen, onRequestPlan, onShowPlan, planRequest,
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

  if (!teamPlan) {
    return <TeamPlanOnly onRequestPlan={onRequestPlan} onShowPlan={onShowPlan} planRequest={planRequest} orgType={orgType} />;
  }

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
                      {event.state === 'LIVE' && <span className="evts-chip evts-chip--type">Running</span>}
                      {event.state === 'ENDED' && <span className="evts-chip evts-chip--off">Ended</span>}
                      {event.state !== 'LIVE' && event.state !== 'ENDED' && (event.itemCount > 0
                        ? <span className="evts-chip evts-chip--type">Scheduled</span>
                        : <span className="evts-chip evts-chip--off">Draft</span>)}
                      {/* "N joined" (events M2): a count, never a name. */}
                      {Number(event.attendeeCount) > 0 && (
                        <span className="evts-sub" data-testid="event-joined">{`${event.attendeeCount} joined`}</span>
                      )}
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
