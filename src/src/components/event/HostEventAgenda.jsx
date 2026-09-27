import React, { useEffect, useState } from 'react';
import Icon from '../Icon';
import EventBuilder from '../EventBuilder';
import { authFetch } from '../../auth/authFetch';
import { adminApiUrl } from '../../utils/adminApi';
import { navigateTo } from '../../auth/navigate';
import './HostEventAgenda.css';

/**
 * AN EVENT'S AGENDA, ON THE HOST'S SIDE — /host/event/<code>/agenda.
 *
 * The owner, 27 Sep 2026: "there is still no way to create an agenda for the
 * host. only the admin". The agenda could be built only in the console
 * (AdminPage's Events place). Any member of a space on a paid plan may make
 * and change an event (create-event.js, items.js), so this page gives the host
 * the SAME builder — components/EventBuilder.jsx, mounted exactly as the
 * console mounts it, with the same question-set list (GET
 * /admin/question-sets, which the host's own set shelf already reads) — in a
 * frame of the host's own: back to the main screen, and on to the event's
 * stage (/host/event/<code>), where it is run.
 *
 * One builder, two frames: a change to the agenda is made in one component and
 * is the same wherever a host builds it.
 *
 * @param {string} code the event
 */
export default function HostEventAgenda({ code }) {
  const [sets, setSets] = useState([]);
  const [title, setTitle] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch(adminApiUrl('admin/question-sets'));
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled) setSets(Array.isArray(json.questionSets) ? json.questionSets : []);
      } catch {
        // No sets to offer: the builder says "No … sets yet" in its picker.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="hea" data-theme="dark">
      <header className="hea-head">
        <button type="button" className="hea-btn" onClick={() => navigateTo('/host')}>
          <Icon name="ArrowLeft" size={16} color="currentColor" /> Main screen
        </button>
        <div className="hea-titles">
          <p className="hea-kicker">{`Event ${code} · agenda`}</p>
          <h1 className="hea-title" title={title || undefined}>{title || 'Agenda'}</h1>
        </div>
        <button
          type="button"
          className="hea-btn hea-btn--primary"
          onClick={() => navigateTo(`/host/event/${encodeURIComponent(code)}`)}
        >
          <Icon name="PlayCircle" size={16} color="currentColor" /> Open the stage
        </button>
      </header>
      <main className="hea-body">
        <EventBuilder
          code={code}
          sets={sets}
          onTitle={setTitle}
          /* Deleted from here: nothing is left to build — back to the main screen. */
          onDeleted={() => navigateTo('/host')}
        />
      </main>
    </div>
  );
}
