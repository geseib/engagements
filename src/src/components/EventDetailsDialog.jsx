import React, { useState } from 'react';
import Modal from './Modal';
import Icon from './Icon';
import rules from '../../../lambda-functions/websocket/events/agenda-rules';
import { createEvent, updateEvent } from '../utils/eventsApi';
import './EventsPanel.css';

/**
 * NEW EVENT, AND "EDIT DETAILS" — docs/design/agenda-redesign/05-new-event.html.
 *
 * Name, date, start, time zone and place, who can join, and what attendees get
 * of each report. With `initial` (an event from GET /events/{code}) it edits
 * that event through PUT; without, it creates one through POST and hands the
 * new event (its code chosen by the server) to `onSaved`.
 *
 * WHAT THIS RELEASE CHANGES FROM THE DRAWING, and why:
 *   - "Only people you invite" is shown, disabled, "Coming soon": invitations
 *     are PLAN Phase 3. The server refuses `invite` the same way.
 *   - The billing note states today's rule (decision 1: an event counts as
 *     one session) rather than the drawn end state of event pricing
 *     (decision 12, PLAN Phase 7), which has not shipped.
 *
 * Checked with the same agenda-rules.checkEventFields the server runs, so a
 * refusal is said here before it is sent — and the server's own sentence is
 * shown if it refuses anyway (a Personal space in a stale tab: 402).
 *
 * EDITING SENDS ONLY WHAT CHANGED, so a stale dialog cannot put back what a
 * co-host changed after it opened; the server refuses a write that raced
 * another (409 agenda_changed), and `onRefused` has the builder reload the
 * event while this dialog keeps what was typed (final review M3).
 *
 * TWO EXITS, ONE CLOSE: the X and Close both go through `requestClose`, which
 * asks before discarding typed words; Escape and the backdrop are gated on the
 * same (hard rules 2 and 3).
 */

export function browserZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch (e) {
    return 'UTC';
  }
}

/** Every zone this browser knows, `first` first. */
export function zoneOptions(first) {
  let all = [];
  try {
    all = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  } catch (e) {
    all = [];
  }
  const out = [first, ...all.filter((z) => z !== first)];
  if (!out.includes('UTC')) out.push('UTC');
  return out.filter(Boolean);
}

const REPORT_CHOICES = [
  { value: 'full', label: 'Full', sentence: 'Each item’s report as you see it, names included.' },
  { value: 'anonymous', label: 'Anonymous', sentence: 'The same reports with every name removed.' },
  { value: 'none', label: 'Not shared', sentence: 'Reports stay in the console.' },
];

export default function EventDetailsDialog({ initial = null, onClose, onSaved, onRefused }) {
  const editing = Boolean(initial && initial.code);
  const [baseline] = useState(() => {
    const start = (initial && initial.startsAt) || '';
    return {
      title: (initial && initial.title) || '',
      date: start.slice(0, 10),
      time: start.slice(11, 16) || '09:00',
      timeZone: (initial && initial.timeZone) || browserZone(),
      place: (initial && initial.place) || '',
      reports: (initial && initial.attendeeReports) || 'full',
    };
  });
  const [title, setTitle] = useState(baseline.title);
  const [date, setDate] = useState(baseline.date);
  const [time, setTime] = useState(baseline.time);
  const [timeZone, setTimeZone] = useState(baseline.timeZone);
  const [place, setPlace] = useState(baseline.place);
  const [reports, setReports] = useState(baseline.reports);
  const [zones] = useState(() => zoneOptions(baseline.timeZone));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const dirty = title !== baseline.title || date !== baseline.date || time !== baseline.time
    || timeZone !== baseline.timeZone || place !== baseline.place || reports !== baseline.reports;

  const requestClose = () => {
    if (busy) return;
    if (dirty && !window.confirm('Close without saving? What you typed will be lost.')) return;
    onClose();
  };

  const submit = async (e) => {
    if (e) e.preventDefault();
    const fields = { title, place, startsAt: `${date}T${time}`, timeZone, access: 'open', attendeeReports: reports };
    const checked = rules.checkEventFields(fields, { nowSeconds: Math.floor(Date.now() / 1000) });
    if (checked.error) {
      setError(checked.error);
      return;
    }
    /* AN EDIT SENDS ONLY WHAT THIS HOST CHANGED (final review M3). The PUT
       keeps every field a body leaves out, so a name changed here cannot put
       back a date a co-host moved after this dialog opened — which the whole
       form, read when the dialog opened, would. Nothing changed, nothing
       sent. */
    const v = checked.value;
    const changes = {};
    if (title !== baseline.title) changes.title = v.title;
    if (place !== baseline.place) changes.place = v.place;
    if (date !== baseline.date || time !== baseline.time) changes.startsAt = v.startsAt;
    if (timeZone !== baseline.timeZone) changes.timeZone = v.timeZone;
    if (reports !== baseline.reports) changes.attendeeReports = v.attendeeReports;
    if (editing && Object.keys(changes).length === 0) {
      onClose();
      return;
    }
    setBusy(true);
    setError('');
    try {
      const event = editing ? await updateEvent(initial.code, changes) : await createEvent(v);
      onSaved(event);
    } catch (err) {
      setError(err.message || 'The event was not saved.');
      setBusy(false);
      // A 404 or 409 (another write landed first): the builder reloads the
      // event behind this dialog, which stays open with what was typed.
      if (onRefused && (err.status === 404 || err.status === 409)) onRefused(err);
    }
  };

  return (
    <Modal
      overlayClassName="evts evts-scrim"
      contentClassName="evts-modal"
      labelledBy="evts-details-title"
      onClose={requestClose}
      closeOnBackdrop={() => !dirty && !busy}
      closeOnEscape={() => !dirty && !busy}
      theme="dark"
    >
      <form onSubmit={submit} noValidate>
        <header className="evts-modal-head">
          <div className="evts-grow">
            <h2 id="evts-details-title">{editing ? 'Event details' : 'New event'}</h2>
            <p>
              {editing
                ? 'The name, the day and the place, as the agenda shows them.'
                : 'Name it, say when and where, and choose who can join. You build the agenda next, from empty.'}
            </p>
          </div>
          <button type="button" className="evts-x" onClick={requestClose} aria-label="Close" title="Close" disabled={busy}>×</button>
        </header>

        <div className="evts-modal-body">
          <div className="evts-field evts-step">
            <label className="evts-label" htmlFor="evts-name">Name</label>
            <input id="evts-name" className="evts-input" value={title} maxLength={rules.TITLE_MAX} onChange={(e) => setTitle(e.target.value)} />
          </div>

          <div className="evts-grid evts-step">
            <div className="evts-field">
              <label className="evts-label" htmlFor="evts-date">Date</label>
              <input id="evts-date" type="date" className="evts-input" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="evts-field">
              <label className="evts-label" htmlFor="evts-time">Starts</label>
              <input id="evts-time" type="time" className="evts-input" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
            <div className="evts-field evts-span2">
              <label className="evts-label" htmlFor="evts-zone">Time zone</label>
              <select id="evts-zone" className="evts-input" value={timeZone} onChange={(e) => setTimeZone(e.target.value)}>
                {zones.map((z) => <option key={z} value={z}>{z}</option>)}
              </select>
            </div>
            <div className="evts-field evts-span4">
              <label className="evts-label" htmlFor="evts-place">
                Place <span className="evts-dim">· optional, shown on the agenda</span>
              </label>
              <input id="evts-place" className="evts-input" value={place} maxLength={rules.PLACE_MAX} onChange={(e) => setPlace(e.target.value)} />
            </div>
          </div>

          <fieldset className="evts-field evts-step">
            <legend className="evts-label">Who can join</legend>
            <div className="evts-opts" role="radiogroup" aria-label="Who can join">
              <label className="evts-opt" data-checked="true">
                <input type="radio" name="evts-access" defaultChecked />
                <div>
                  <b>Anyone with the code</b>
                  <span>Like a session today: the code on the main screen is all anyone needs, and they type their own name.</span>
                </div>
              </label>
              <label className="evts-opt evts-opt--off" data-checked="false">
                <input type="radio" name="evts-access" disabled />
                <Icon name="Lock" weight="bold" size={18} color="var(--primary)" />
                <div>
                  <b>Only people you invite</b>
                  <span>Coming soon. Each person will get their own passcode, which you hand out.</span>
                </div>
              </label>
            </div>
          </fieldset>

          <fieldset className="evts-field evts-step">
            <legend className="evts-label">Reports for attendees, afterwards</legend>
            <div className="evts-opts" role="radiogroup" aria-label="Reports for attendees">
              {REPORT_CHOICES.map((choice) => (
                <label key={choice.value} className="evts-opt" data-checked={String(reports === choice.value)}>
                  <input
                    type="radio"
                    name="evts-reports"
                    value={choice.value}
                    checked={reports === choice.value}
                    onChange={() => setReports(choice.value)}
                  />
                  <div><b>{choice.label}</b><span>{choice.sentence}</span></div>
                </label>
              ))}
            </div>
            <p className="evts-hint">The default for every item’s report.</p>
          </fieldset>

          <div className="evts-note evts-step">
            <Icon name="CreditCard" weight="bold" size={16} color="currentColor" />
            <div>
              <b>An event counts as one session, however many items it runs.</b> Up to {rules.MAX_ITEMS} items,
              {' '}{rules.MAX_ENGAGEMENTS} of them engagements.
            </div>
          </div>

          {error && <p className="evts-error" role="alert">{error}</p>}
        </div>

        <footer className="evts-modal-foot">
          <button type="button" className="evts-btn" onClick={requestClose} disabled={busy}>Close</button>
          <span className="evts-grow" />
          {!editing && <span className="evts-foot-note">The join code is chosen when you create it.</span>}
          <button type="submit" className="evts-btn evts-btn--primary" disabled={busy}>
            {busy ? 'Saving…' : (editing ? 'Save' : 'Create event')}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
