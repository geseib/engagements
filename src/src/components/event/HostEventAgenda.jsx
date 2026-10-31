import React, { useEffect, useState } from 'react';
import Icon from '../Icon';
import HelpButton from '../HelpButton';
import { helpFor } from '../../config/help/screens';
import EventBuilder from '../EventBuilder';
import { authFetch } from '../../auth/authFetch';
import { adminApiUrl } from '../../utils/adminApi';
import { navigateTo } from '../../auth/navigate';
import useFullscreenKey from '../../hooks/useFullscreenKey';
import { downloadEventSummary } from '../../utils/eventSummary';
import { useOptionalAuth } from '../../auth/AuthContext';
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
  // The event summary PDF (utils/eventSummary.js): drawing, or why it failed.
  const [summary, setSummary] = useState({ busy: false, error: '' });
  // The signed-in host: their name stands in on an event made before the
  // event kept its creator's (utils/eventSummary.js hostOf).
  const auth = useOptionalAuth();
  const user = auth && auth.currentUser;
  useFullscreenKey();

  const saveSummary = async () => {
    if (summary.busy) return;
    setSummary({ busy: true, error: '' });
    try {
      await downloadEventSummary(code, { user });
      setSummary({ busy: false, error: '' });
    } catch (err) {
      setSummary({ busy: false, error: `The event summary was not made${err && err.message ? ` (${err.message})` : ''}. Please try again.` });
    }
  };

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
        {/* The agenda guide's page section (Help Phase 3); the item dialogs
            carry the adding-items one. */}
        <HelpButton {...helpFor('event-agenda')} variant="inline" size="small" tooltip="Help: the agenda" className="help-button-quiet" />
        {/* A short PDF: the overview and the agenda, and which item reports
            exist and where. Downloaded, not stored (utils/eventSummary.js). */}
        <button type="button" className="hea-btn" onClick={saveSummary} disabled={summary.busy}>
          <Icon name="FilePdf" size={16} color="currentColor" /> {summary.busy ? 'Making the summary…' : 'Save event summary (PDF)'}
        </button>
        <button
          type="button"
          className="hea-btn hea-btn--primary"
          onClick={() => navigateTo(`/host/event/${encodeURIComponent(code)}`)}
        >
          <Icon name="PlayCircle" size={16} color="currentColor" /> Open the stage
        </button>
      </header>
      {summary.error && <p className="hea-error" role="alert">{summary.error}</p>}
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
