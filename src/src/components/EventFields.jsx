import React, { useState } from 'react';
import rules from '../../../lambda-functions/websocket/events/agenda-rules';
import { browserZone, zoneOptions } from './EventDetailsDialog';

/**
 * AN EVENT'S DAY, MADE INSIDE NEW ENGAGEMENT (experience plan 4c; audit E N2).
 *
 * Choosing Event used to close New engagement and open a second dialog (the
 * new-event dialog, its own card and buttons) before the agenda. Now the
 * event's fields sit in the dialog's own slot, under "Next: the agenda":
 * the day and start (required: the agenda is laid out from them), and in one
 * quiet fold the time zone, the place and what attendees get of each report,
 * each with its default. Create makes the event and lands on its agenda,
 * where the items are added. "Edit details" on the agenda changes any of it.
 *
 * Checked with the same agenda-rules.checkEventFields the server runs
 * (`eventProblem` below), with the new-event dialog's words. The day starts
 * as today in this browser, so the fast path is a name and one press.
 */
export const EVENT_REPORT_CHOICES = Object.freeze([
  { value: 'full', label: 'Full', sentence: 'Each item’s report as you see it, names included.' },
  { value: 'anonymous', label: 'Anonymous', sentence: 'The same reports with every name removed.' },
  { value: 'none', label: 'Not shared', sentence: 'Reports stay with you.' },
]);

/** Today in this browser, as YYYY-MM-DD. */
export function todayLocal(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function eventDefaults(now = new Date()) {
  return { date: todayLocal(now), time: '09:00', timeZone: browserZone(), place: '', reports: 'full' };
}

/** The fields the server takes, from the dialog's title and these fields. */
export function eventFieldsFor(title, v) {
  const f = v || {};
  return {
    title: String(title || '').trim(),
    place: f.place || '',
    startsAt: `${f.date || ''}T${f.time || ''}`,
    timeZone: f.timeZone || '',
    access: 'open',
    attendeeReports: f.reports || 'full',
  };
}

/** The first problem, in the server's own words, or ''. */
export function eventProblem(title, v, nowSeconds = Math.floor(Date.now() / 1000)) {
  const checked = rules.checkEventFields(eventFieldsFor(title, v), { nowSeconds });
  return checked.error || '';
}

function summaryOf(v) {
  const bits = [];
  if (String(v.place || '').trim()) bits.push(`at ${String(v.place).trim()}`);
  if (v.reports && v.reports !== 'full') bits.push(`reports ${v.reports === 'none' ? 'not shared' : 'anonymous'}`);
  return bits.length
    ? { changed: true, text: `Changed: ${bits.join(', ')}.` }
    : { changed: false, text: `Defaults: ${v.timeZone || 'this time zone'}, no place, attendees get each report in full.` };
}

export default function EventFields({ value, onChange }) {
  const v = value || {};
  const set = (patch) => onChange && onChange(patch);
  const [zones] = useState(() => zoneOptions(v.timeZone || browserZone()));
  const summary = summaryOf(v);
  return (
    <div className="gsd-xfields" data-testid="gsd-event-fields">
      <div className="gsd-xgrid">
        <label className="gsd-xfield" htmlFor="gsd-event-date">
          <span className="gsd-xlabel">Date</span>
          <input id="gsd-event-date" type="date" className="dialog-input" value={v.date || ''} onChange={(e) => set({ date: e.target.value })} />
        </label>
        <label className="gsd-xfield" htmlFor="gsd-event-time">
          <span className="gsd-xlabel">Starts</span>
          <input id="gsd-event-time" type="time" className="dialog-input" value={v.time || ''} onChange={(e) => set({ time: e.target.value })} />
        </label>
      </div>
      <details className="gsd-adv gsd-xfold">
        <summary>
          <span className="gsd-adv-k"><i className="gsd-chev" aria-hidden="true" />Time zone, place, reports</span>
          <span className="gsd-adv-s">
            {summary.changed ? <b>{summary.text}</b> : <>Optional · {summary.text}</>}
          </span>
        </summary>
        <div className="gsd-adv-body gsd-xfields">
          <label className="gsd-xfield" htmlFor="gsd-event-zone">
            <span className="gsd-xlabel">Time zone</span>
            <select id="gsd-event-zone" className="dialog-select" value={v.timeZone || ''} onChange={(e) => set({ timeZone: e.target.value })}>
              {zones.map((z) => <option key={z} value={z}>{z}</option>)}
            </select>
          </label>
          <label className="gsd-xfield" htmlFor="gsd-event-place">
            <span className="gsd-xlabel">Place · optional, shown on the agenda</span>
            <input id="gsd-event-place" className="dialog-input" maxLength={rules.PLACE_MAX} value={v.place || ''} onChange={(e) => set({ place: e.target.value })} />
          </label>
          <fieldset className="gsd-xfield">
            <legend>Reports for attendees, afterwards</legend>
            {EVENT_REPORT_CHOICES.map((c) => (
              <label key={c.value} className="gsd-xcheck">
                <input type="radio" name="gsd-event-reports" value={c.value} checked={(v.reports || 'full') === c.value} onChange={() => set({ reports: c.value })} />
                <span><b>{c.label}</b> · {c.sentence}</span>
              </label>
            ))}
            <small className="dialog-help-text">The default for every item’s report. Anyone with the code can join; invitations are coming.</small>
          </fieldset>
        </div>
      </details>
    </div>
  );
}
