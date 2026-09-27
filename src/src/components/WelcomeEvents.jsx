import React, { useEffect, useState } from 'react';
import { listEvents } from '../utils/eventsApi';
import { readEventsAccess } from '../utils/eventsAccess';
import { navigateTo } from '../auth/navigate';
import EventDetailsDialog from './EventDetailsDialog';
import rules from '../../../lambda-functions/websocket/events/agenda-rules';
import pricing from '../../../lambda-functions/game/pricing';

/**
 * YOUR EVENTS, FROM THE HOST'S MAIN SCREEN (the owner, 27 Sep 2026: "a host
 * should be able to launch these if they exist from their main screen").
 *
 * The acting organisation's events that are running now or still to come,
 * soonest first, each with Open — straight to its stage
 * (/host/event/<code>, components/event/EventStage.jsx), where the agenda
 * is. Two at most, a running one first; the rest are in the console's Events
 * list. Two because the main screen fits a 1280×720 laptop without
 * scrolling (the owner, same day: "They should not have to scroll"), and
 * four rows pushed the page past it.
 *
 * AND A HOST MAKES ONE HERE (the owner, 27 Sep 2026: "there is still no way
 * to create an agenda for the host. only the admin"). On a paid plan the block
 * carries "New event": the same new-event dialog the console uses, and then
 * the agenda — the console's own builder, on the host's side
 * (/host/event/<code>/agenda, components/event/HostEventAgenda.jsx). Any
 * member may, host or admin (create-event.js). On Free the block says which
 * plan brings events, once, with the way to it.
 *
 * DRAWS NOTHING while Events is switched off for the tier, or when GET /orgs
 * cannot be read — the welcome screen is then exactly as it was.
 */
const SHOWN = 2;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Running now, or on a day from yesterday on (an event can run late). */
function stillOn(event, nowMs) {
  if (event.state === 'ENDED') return false;
  if (event.state === 'LIVE') return true;
  const s = rules.parseStartsAt(event.startsAt);
  if (!s) return false;
  return Date.UTC(s.y, s.mo - 1, s.d) >= nowMs - 2 * DAY_MS;
}

export default function WelcomeEvents({ nowMs }) {
  const [events, setEvents] = useState([]);
  const [access, setAccess] = useState(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    readEventsAccess().then((a) => { if (!cancelled) setAccess(a); });
    return () => { cancelled = true; };
  }, []);

  /*
    READ ONCE PER MOUNT. `nowMs` is a prop only so a test can fix the clock;
    it used to DEFAULT to Date.now() in the signature, which is a new value on
    every render — so every render of the welcome screen re-ran this effect,
    cancelled the request in flight and sent another. The list never landed
    and GET /events went out in a loop (found driving the real handlers in
    Chromium, 27 Sep 2026). The clock is read inside the effect instead.
  */
  useEffect(() => {
    let cancelled = false;
    const at = typeof nowMs === 'number' ? nowMs : Date.now();
    listEvents()
      .then((all) => {
        if (cancelled) return;
        const on = (all || []).filter((e) => stillOn(e, at));
        on.sort((a, b) => (a.state === 'LIVE' ? 0 : 1) - (b.state === 'LIVE' ? 0 : 1)
          || String(a.startsAt).localeCompare(String(b.startsAt)));
        setEvents(on);
      })
      .catch(() => { if (!cancelled) setEvents([]); });
    return () => { cancelled = true; };
  }, [nowMs]);

  // Switched off, or not yet known: nothing — unless events already exist
  // (they were listed before this read existed, and still open).
  const enabled = Boolean(access && access.enabled);
  if (!enabled && !events.length) return null;
  const canCreate = Boolean(access && access.canCreate);
  const shown = events.slice(0, SHOWN);
  return (
    <section className="wel-events" aria-labelledby="wel-events-title">
      <p className="wel-kicker">Events</p>
      <div className="wel-evhead">
        <h2 id="wel-events-title">Run an event</h2>
        {canCreate && (
          <button type="button" className="wel-btn wel-btn-line" onClick={() => setCreating(true)}>
            New event
          </button>
        )}
      </div>
      {!events.length && canCreate && (
        <p className="wel-meta wel-ev-more">
          {`A whole agenda behind one code — quizzes, polls, talks and breaks, in the order you run them. `}
          {`${pricing.formatCents(pricing.PER_EVENT_CENTS)} an event, counted when it first goes live.`}
        </p>
      )}
      {!canCreate && enabled && access.offerPlanName && (
        <p className="wel-meta wel-ev-more">
          {`Events come with the ${access.offerPlanName}: a whole agenda behind one code. `}
          <button type="button" className="wel-btn wel-btn-quiet wel-ev-plan" onClick={() => navigateTo('/admin?section=events')}>
            See how
          </button>
        </p>
      )}
      {events.length > 0 && (
        <ul className="wel-evlist">
          {shown.map((event) => (
            <li key={event.code} className="wel-ev">
              <span className="wel-ev-main">
                <span className="wel-ev-name" title={event.title}>{event.title || 'Untitled event'}</span>
                <span className="wel-ev-meta">
                  {event.state === 'LIVE' ? <b className="wel-ev-live">Running</b> : rules.formatEventWhen(event.startsAt)}
                  {` · ${event.itemCount || 0} item${event.itemCount === 1 ? '' : 's'}`}
                  {Number(event.attendeeCount) > 0 ? ` · ${event.attendeeCount} joined` : ''}
                </span>
              </span>
              <button
                type="button"
                className="wel-btn wel-btn-line"
                onClick={() => navigateTo(`/host/event/${encodeURIComponent(event.code)}`)}
                aria-label={`Open ${event.title || 'the event'}: its agenda and stage`}
              >
                Open
              </button>
            </li>
          ))}
        </ul>
      )}
      {events.length > SHOWN && (
        <p className="wel-meta wel-ev-more">
          {`${events.length - SHOWN} more in the console's Events list.`}
        </p>
      )}
      {creating && (
        <EventDetailsDialog
          onClose={() => setCreating(false)}
          /* Made: straight to its agenda, on the host's side. */
          onSaved={(event) => {
            setCreating(false);
            navigateTo(`/host/event/${encodeURIComponent(event.code)}/agenda`);
          }}
        />
      )}
    </section>
  );
}
