/**
 * THE EVENT SUMMARY PDF — the overview and the agenda, and which item reports
 * exist and where. The owner, 2026-10-31: "The event doc should just have the
 * overview and agenda and list the other docs. Let's not create a long pdf."
 *
 * rejects: anything from inside a session (answers, Workie's reads, comments)
 * reaching the summary; a report status that does not say which of saved,
 * auto-built, missing or expired it is; times that are not the agenda's own;
 * the summary pretending to be stored when the save route is per session.
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import EventSummaryDocument from '../components/EventSummary';
import {
  eventSummaryData, eventRunning, summaryFileName, REPORT_STATUS, hostOf, signedInName,
} from '../utils/eventSummary';

jest.mock('../components/EventBuilder', () => () => null);
jest.mock('../utils/eventSummary', () => {
  const actual = jest.requireActual('../utils/eventSummary');
  return { ...actual, downloadEventSummary: jest.fn(async () => ({})) };
});

const view = {
  event: { code: 'KX7Q', title: 'Platform Summit', place: 'Harbour Room', startsAt: '2026-10-28T09:00', timeZone: 'America/New_York', state: 'ENDED' },
  items: [
    { itemId: 'i1', type: 'presentation', title: 'Why we are here', ledBy: 'Dana Whitfield', minutes: 20, state: 'done' },
    { itemId: 'i2', type: 'call-and-answer', title: 'Big Bets', minutes: 70, state: 'done', gameId: '4417' },
    { itemId: 'i3', type: 'break', title: 'Coffee', minutes: 15, state: 'done' },
    { itemId: 'i4', type: 'poll', title: 'Ready or Not', minutes: 45, state: 'done', gameId: '4421' },
    { itemId: 'i5', type: 'trivia', title: 'GenAI', minutes: 30, state: 'live', gameId: '4430' },
    { itemId: 'i6', type: 'survey', title: 'How did it go?', minutes: 10, state: 'paused', gameId: '4436' },
    { itemId: 'i7', type: 'wavelength', title: 'One word', minutes: 10, state: 'planned' },
  ],
};
const reportsBody = {
  reports: [
    { id: 'R1', gameId: '4417', title: 'Platform Summit — Big Bets', eventRef: 'KX7Q', eventItem: 'i2', answers: ['SECRET ANSWER'] },
    { id: 'R2', gameId: '4430', title: 'GenAI quiz', eventRef: 'KX7Q', eventItem: 'i5', auto: true },
  ],
  events: [{ code: 'KX7Q', title: 'Platform Summit', items: [
    { itemId: 'i2', gameId: '4417', reportId: 'R1' },
    { itemId: 'i4', gameId: '4421', reportId: null, sessionGone: true },
    { itemId: 'i5', gameId: '4430', reportId: 'R2' },
    { itemId: 'i6', gameId: '4436', reportId: null },
  ] }],
};

const data = eventSummaryData(view, reportsBody);
const byId = (id) => data.items.find((i) => i.itemId === id);

describe('the summary\'s data', () => {
  test('the agenda\'s own planned times, from the event\'s start', () => {
    expect(data.items.map((i) => `${i.at}-${i.until}`)).toEqual(
      ['9:00-9:20', '9:20-10:30', '10:30-10:45', '10:45-11:30', '11:30-12:00', '12:00-12:10', '12:10-12:20'],
    );
    expect(data.day).toBe('Wed 28 Oct 2026');
    expect(data.endsAt).toBe('12:20');
    expect(data.timeZone).toBe('America/New_York');
    expect(data.place).toBe('Harbour Room');
  });

  test('each session item says which of saved, auto-built, missing, expired or not run its report is', () => {
    expect(byId('i2').reportStatus).toBe(REPORT_STATUS.saved);
    expect(byId('i2').reportTitle).toBe('Platform Summit — Big Bets');
    expect(byId('i2').reportWhere).toBe('Reports › Platform Summit');
    expect(byId('i5').reportStatus).toBe(REPORT_STATUS.auto);
    expect(byId('i4').reportStatus).toBe(REPORT_STATUS.expired);
    expect(byId('i4').status).toBe('Expired');
    expect(byId('i6').reportStatus).toBe(REPORT_STATUS.none);
    expect(byId('i7').reportStatus).toBe(REPORT_STATUS.notRun);
    // A talk and a break have no session, so no report column at all.
    expect(byId('i1').session).toBe(false);
    expect(byId('i1').reportStatus).toBe('');
  });

  test('states in words; the strip\'s counts', () => {
    expect(data.items.map((i) => i.status)).toEqual(['Done', 'Done', 'Done', 'Expired', 'Live', 'Paused', 'Planned']);
    expect(data.counts).toEqual({ items: 7, sessionsRun: 4, reportsReady: 2 });
  });

  test('no reports list (it failed, or the event never ran) still makes a summary', () => {
    const bare = eventSummaryData(view, {});
    expect(bare.items).toHaveLength(7);
    expect(bare.counts.reportsReady).toBe(0);
    expect(eventSummaryData({ event: { code: 'X' }, items: [] }, null).title).toBe('Event X');
  });

  test('the stamped head and foot, and the file name', () => {
    expect(eventRunning(data)).toEqual({ kind: 'Event summary', title: 'Platform Summit', footLeft: 'Event KX7Q · Wed 28 Oct 2026', cover: false });
    expect(summaryFileName('Platform Summit 2026!')).toBe('Platform-Summit-2026-summary.pdf');
  });
});

describe('the document', () => {
  test('overview, then the agenda as one list; nothing from inside a session', () => {
    const { container } = render(<EventSummaryDocument data={data} />);
    const doc = container.querySelector('article');
    expect([...doc.classList]).toEqual(expect.arrayContaining(['report-doc', 'report-paper']));
    expect(doc.getAttribute('data-theme')).toBe('light');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Platform Summit');
    expect(container.querySelector('.rpt-facts').textContent).toContain('Harbour Room');
    expect([...container.querySelectorAll('.rpt-strip-count')].map((n) => n.textContent)).toEqual(['7Items', '4Sessions run', '2Reports ready']);
    expect(container.querySelectorAll('.rpt-ev-list .rpt-ev-row')).toHaveLength(7);
    expect(container.textContent).toContain('Led by Dana Whitfield');
    expect(container.textContent).not.toContain('SECRET ANSWER');
    for (const sel of ['.rpt-workie', '.rpt-resp', '.report-comment', '.rpt-standing']) expect(container.querySelector(sel)).toBeNull();
  });

  test('each unit stays whole on a page; the column labels travel with the first row', () => {
    const { container } = render(<EventSummaryDocument data={data} />);
    for (const row of container.querySelectorAll('.rpt-ev-list .rpt-ev-row')) expect(row.classList.contains('report-keep')).toBe(true);
    const first = container.querySelector('.rpt-keepnext');
    expect(first.querySelector('.rpt-ev-row--head')).not.toBeNull();
    expect(first.querySelector('.rpt-ev-list .rpt-ev-row')).not.toBeNull();
    expect(container.querySelectorAll('[data-pdf-block]').length).toBeGreaterThan(1);
  });
});

describe('where the host gets it', () => {
  test('the host agenda has "Save event summary (PDF)", and it downloads the summary', async () => {
    const { downloadEventSummary } = require('../utils/eventSummary');
    const HostEventAgenda = require('../components/event/HostEventAgenda').default;
    render(<HostEventAgenda code="KX7Q" />);
    fireEvent.click(screen.getByRole('button', { name: /Save event summary \(PDF\)/ }));
    await waitFor(() => expect(downloadEventSummary).toHaveBeenCalledWith('KX7Q', { user: null }));
  });

  test('the event\'s row in Reports offers it too, and says it is not kept', () => {
    const panel = fs.readFileSync(path.join(__dirname, '..', 'components', 'ReportsPanel.jsx'), 'utf8');
    expect(panel).toMatch(/Summary PDF/);
    expect(panel).toMatch(/downloadEventSummary\(event\.code, \{ user: currentUser \}\)/);
    expect(panel).toMatch(/It is not kept here/);
  });

  // The save route is POST /games/{id}/save-report — per session. There is no
  // event-level row to keep a summary under, so it is downloaded only.
  test('download only: the summary never calls the save route', () => {
    const util = fs.readFileSync(path.join(__dirname, '..', 'utils', 'eventSummary.js'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(util).not.toMatch(/save-report|saveReportPdf/);
    expect(util).toMatch(/drawReportPdf/);
  });
});

/*
 * HOSTED BY (owner, 2026-10-31: "We want it"). create-event.js keeps the
 * creator's display name and the team's (sealed); GET /events/{code} returns
 * them. An event made before that has neither: then the signed-in host's own
 * name stands in, but only when they made it.
 */
describe('Hosted by', () => {
  const me = { attributes: { sub: 'u_dana', name: 'Dana Whitfield', email: 'dana@example.com' } };
  const colleague = { attributes: { sub: 'u_other', name: 'Sam Other' } };

  test('the name kept on the event, and its team, print in the overview', () => {
    const named = eventSummaryData({ ...view, event: { ...view.event, hostName: 'Dana Whitfield', teamName: 'Platform Engineering' } }, reportsBody);
    expect(named.hostName).toBe('Dana Whitfield');
    expect(named.teamName).toBe('Platform Engineering');
    const { container } = render(<EventSummaryDocument data={named} />);
    const host = container.querySelector('.rpt-ev-host');
    expect(host.querySelector('dt').textContent).toBe('Hosted by');
    expect(host.querySelector('dd').textContent).toBe('Dana WhitfieldPlatform Engineering');
  });

  test('an older event (no kept name) made by the signed-in host: their own name', () => {
    const older = { ...view, event: { ...view.event, createdBy: 'u_dana' } };
    expect(eventSummaryData(older, reportsBody, { user: me }).hostName).toBe('Dana Whitfield');
  });

  // rejects: printing the viewer's name on a colleague's event.
  test('an older event made by someone else names nobody, and the row is omitted', () => {
    const older = { ...view, event: { ...view.event, createdBy: 'u_dana' } };
    const data = eventSummaryData(older, reportsBody, { user: colleague });
    expect(data.hostName).toBe('');
    const { container } = render(<EventSummaryDocument data={data} />);
    expect(container.querySelector('.rpt-ev-host')).toBeNull();
    expect(container.textContent).not.toContain('Hosted by');
    expect(container.textContent).not.toContain('Sam Other');
  });

  test('a kept name wins over the signed-in host', () => {
    expect(hostOf({ hostName: 'Dana Whitfield', createdBy: 'u_other' }, colleague)).toBe('Dana Whitfield');
    expect(hostOf({ createdBy: 'u_other' }, null)).toBe('');
  });

  test('a team with no host name prints as Team', () => {
    const data = eventSummaryData({ ...view, event: { ...view.event, teamName: 'Platform Engineering' } }, reportsBody);
    const { container } = render(<EventSummaryDocument data={data} />);
    expect(container.querySelector('.rpt-ev-host dt').textContent).toBe('Team');
  });

  test('the signed-in name: name, else given and family, else the email before the @', () => {
    expect(signedInName({ attributes: { given_name: 'Ada', family_name: 'Lovelace' } })).toBe('Ada Lovelace');
    expect(signedInName({ attributes: { email: 'grace.liu@example.com' } })).toBe('grace.liu');
    expect(signedInName(null)).toBe('');
  });
});
