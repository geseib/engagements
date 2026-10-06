/**
 * EVENTS AND BUILD ROOMS ARE ROWS LIKE ANY SESSION — in the console's Sessions
 * list, the host's Your sessions, and Reports (2026-10-04).
 *
 * The owner: "why are these not treated as other types of engagements that i
 * can see listed in sessions, and reports, etc." — and the shape, decided the
 * same day: an event is ONE row, labelled Event with its item count; opening
 * it shows its agenda items, each linking to that item's own session and
 * report; an item session is never listed a second time. A Build Room is one
 * row labelled Build Room. Type is a filter wherever State or retention is.
 *
 * The API shapes here are the ones lambda-functions/game/get-games-list.js
 * and get-reports.js answer (tests/engagement-session-list.js and
 * tests/engagement-report-list.js drive those handlers).
 *
 * NO GEOMETRIC ASSERTIONS. jsdom has no layout engine.
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import SessionsPanel from '../components/SessionsPanel';
import SessionHistoryPanel, { rowActions, matchesType } from '../components/SessionHistoryPanel';
import ReportsPanel from '../components/ReportsPanel';
import {
  kindOf, typeOptions, mergeSessions, groupReports, itemKindLabel,
} from '../config/engagementKinds';
import { authFetch } from '../auth/authFetch';

jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn() }));

const DAY = 86400000;
const iso = (offsetDays) => new Date(Date.now() + offsetDays * DAY).toISOString();

const GAMES = [
  { gameId: '5101', title: 'Friday quiz', gameType: 'trivia', createdAt: iso(-1), started: true, playerCount: 9, roundsPlayed: 6, questionSetId: 'space' },
  { gameId: '5102', title: 'Badge printer', gameType: 'build', createdAt: iso(-2), started: true, playerCount: 4, roundsPlayed: 0 },
];
const EVENT = {
  kind: 'event', gameId: '4821', eventCode: '4821', gameType: 'event', title: 'Q4 Kickoff', place: 'Harbour Room',
  startsAt: '2026-10-09T09:00', state: 'LIVE', createdAt: iso(-3), started: true, lastPlayedAt: iso(0),
  playerCount: 38, roundsPlayed: null, itemCount: 3,
  items: [
    { itemId: 'it_00000001', type: 'trivia', title: 'Space night', state: 'done', minutes: 15, gameId: '7657', startedAt: iso(0),
      session: { gameId: '7657', gameType: 'trivia', started: true, playerCount: 31, roundsPlayed: 5 }, sessionGone: false },
    { itemId: 'it_00000002', type: 'presentation', title: 'FY26 in review', state: 'planned', minutes: 30, gameId: null, session: null, sessionGone: false },
    { itemId: 'it_00000003', type: 'call-and-answer', title: 'What slows us down?', state: 'done', minutes: 20, gameId: '1931',
      session: null, sessionGone: true },
  ],
};

const json = (status, body) => ({
  ok: status >= 200 && status < 300, status, json: async () => body, blob: async () => new Blob(['%PDF']),
});

beforeEach(() => {
  authFetch.mockReset();
  window.API_BASE = 'https://api.example.test/dev/';
});

/* ------------------------------------------------------------------ rules */

describe('config/engagementKinds — one place names every kind', () => {
  test('an event, a Build Room, a format, and a row nothing says', () => {
    expect(kindOf(EVENT)).toBe('event');
    expect(kindOf(GAMES[1])).toBe('build');
    expect(kindOf(GAMES[0])).toBe('trivia');
    expect(kindOf({ gameType: undefined })).toBe('');
    expect(itemKindLabel('presentation')).toBe('Presentation');
    expect(itemKindLabel('custom')).toBe('Activity');
    expect(itemKindLabel('call-and-answer')).toBe('Call & Answer');
  });
  test('the Type filter offers Event only while events are in the list (the switch is off otherwise)', () => {
    const withEvent = typeOptions(mergeSessions({ games: GAMES, events: [EVENT] })).map((o) => o.label);
    expect(withEvent).toEqual(expect.arrayContaining(['All types', 'Trivia', 'Build Room', 'Event']));
    const without = typeOptions(mergeSessions({ games: GAMES, events: [] })).map((o) => o.label);
    expect(without).toContain('Build Room');
    expect(without).not.toContain('Event');
  });
  test('reports: an item report sits under its ONE event row; one whose event is not listed stays alone', () => {
    const rows = groupReports({
      reports: [
        { id: 'REPORT#7657', gameId: '7657', title: 'Space night', gameType: 'trivia', eventRef: '4821', savedAt: iso(0), expiresAt: iso(90) },
        { id: 'REPORT#5102', gameId: '5102', title: 'Badge printer', gameType: 'build', savedAt: iso(-1), expiresAt: iso(89) },
        { id: 'REPORT#2222', gameId: '2222', title: 'Old offsite', gameType: 'poll', eventRef: '9999', savedAt: iso(-9), expiresAt: iso(80) },
      ],
      events: [{ code: '4821', title: 'Q4 Kickoff', itemCount: 1, items: [{ itemId: 'it_1', type: 'trivia', title: 'Space night', gameId: '7657', reportId: 'REPORT#7657' }] }],
    });
    expect(rows.map((r) => r.id).sort()).toEqual(['EVENT#4821', 'REPORT#2222', 'REPORT#5102']);
    const event = rows.find((r) => r.kind === 'event');
    expect(event.items[0].report.id).toBe('REPORT#7657');
    expect(event.reportCount).toBe(1);
  });
});

/* ------------------------------------------------------ console Sessions */

describe("the console's Sessions list", () => {
  function api({ events = [EVENT], deleteStatus = 200 } = {}) {
    authFetch.mockImplementation(async (url, options = {}) => {
      const method = (options.method || 'GET').toUpperCase();
      if (method === 'GET' && /\/games$/.test(url)) return json(200, { games: GAMES, events, count: GAMES.length });
      if (method === 'DELETE' && /\/events\/4821$/.test(url)) {
        return deleteStatus === 200 ? json(200, { deleted: '4821', sessions: 2 })
          : json(409, { error: 'This event has an item running. End it on the stage, then delete the event.', code: 'item_running' });
      }
      if (method === 'POST' && url.includes('/admin/clear-all-games')) return json(200, { sessionsDeleted: 2 });
      throw new Error(`Unhandled request: ${method} ${url}`);
    });
  }
  async function mount(props = {}, opts) {
    api(opts);
    render(<SessionsPanel environment={{ id: 'dev', label: 'DEV' }} {...props} />);
    await waitFor(() => expect(screen.queryByText(/Loading sessions/i)).toBeNull());
  }
  const table = () => screen.getByRole('table');

  test('the event is one row, labelled Event with its item count; the Build Room is one row labelled Build Room', async () => {
    await mount();
    const rows = within(table()).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);
    const eventRow = screen.getByTestId('event-row');
    expect(within(eventRow).getByText('Event')).toBeInTheDocument();
    expect(within(eventRow).getByText(/3 items/)).toBeInTheDocument();
    expect(within(eventRow).getByText('Running')).toBeInTheDocument();
    expect(within(screen.getByText('Badge printer').closest('tr')).getByText('Build Room')).toBeInTheDocument();
  });

  test("opening the event shows each item with its kind and state; an item's session opens on the stage inside the event", async () => {
    await mount();
    expect(screen.queryAllByTestId('event-item-row')).toHaveLength(0);
    const toggle = within(screen.getByTestId('event-row')).getByRole('button', { name: /Q4 Kickoff/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const items = screen.getAllByTestId('event-item-row');
    expect(items).toHaveLength(3);
    expect(within(items[0]).getByRole('link', { name: 'Open session' })).toHaveAttribute('href', '/host?gameId=7657&event=4821');
    expect(within(items[1]).getByText('Presentation')).toBeInTheDocument();
    expect(within(items[1]).queryByRole('link')).toBeNull();
    expect(within(items[2]).getByText('Session expired')).toBeInTheDocument();
  });

  test('the item sessions are not rows of their own: 7657 appears only under its event', async () => {
    await mount();
    expect(within(table()).queryByText('7657')).toBeNull();
    fireEvent.click(within(screen.getByTestId('event-row')).getByRole('button', { name: /Q4 Kickoff/ }));
    expect(within(table()).getAllByText('7657')).toHaveLength(1);
  });

  test('Type filters events and Build Rooms like any format', async () => {
    await mount();
    const type = screen.getByLabelText('Filter by type');
    fireEvent.change(type, { target: { value: 'event' } });
    expect(within(table()).getAllByRole('row').slice(1)).toHaveLength(1);
    fireEvent.change(type, { target: { value: 'build' } });
    expect(within(table()).getAllByRole('row').slice(1)).toHaveLength(1);
    expect(screen.getByText('Badge printer')).toBeInTheDocument();
  });

  test('a search finds an event by one of its items', async () => {
    await mount();
    fireEvent.change(screen.getByPlaceholderText(/Search title/), { target: { value: 'slows us' } });
    expect(within(table()).getAllByRole('row').slice(1)).toHaveLength(1);
    expect(screen.getByTestId('event-row')).toBeInTheDocument();
  });

  test('switched off: no event rows and no Event option', async () => {
    await mount({}, { events: [] });
    expect(screen.queryByTestId('event-row')).toBeNull();
    expect(within(screen.getByLabelText('Filter by type')).queryByRole('option', { name: 'Event' })).toBeNull();
  });

  test("Open hands the event to the console's Events place", async () => {
    const onOpenEvent = jest.fn();
    await mount({ onOpenEvent });
    fireEvent.click(within(screen.getByTestId('event-row')).getByRole('button', { name: 'Open' }));
    expect(onOpenEvent).toHaveBeenCalledWith('4821', 'Q4 Kickoff');
  });

  test('Delete goes through the event route, and a refusal is said in the server\'s words', async () => {
    const confirm = jest.spyOn(window, 'confirm').mockReturnValue(true);
    await mount({}, { deleteStatus: 409 });
    fireEvent.click(within(screen.getByTestId('event-row')).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('End it on the stage');
    expect(confirm.mock.calls[0][0]).toMatch(/Saved reports are kept/);
    expect(authFetch.mock.calls.some(([u, o]) => /\/events\/4821$/.test(u) && o.method === 'DELETE')).toBe(true);
    expect(screen.getByTestId('event-row')).toBeInTheDocument();
    confirm.mockRestore();
  });

  test('AdminPage wires Open to the Events place', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'AdminPage.jsx'), 'utf8');
    expect(src).toMatch(/onOpenEvent=\{\(code, title\) => \{\s*handleNavigate\('events'\);\s*setEventPlace\(\{ code, title \}\);/);
  });
});

/* ------------------------------------------------- host: Your sessions */

describe("the host's Your sessions", () => {
  const rows = mergeSessions({ games: GAMES, events: [EVENT] });
  const mount = () => {
    const h = {
      onCopyPlayerUrl: jest.fn(), onInvite: jest.fn(), onReport: jest.fn(), onOpen: jest.fn(),
      onStart: jest.fn(), onEdit: jest.fn(), onClose: jest.fn(), onResults: jest.fn(), navigate: jest.fn(),
    };
    render(<SessionHistoryPanel sessions={rows} {...h} />);
    return h;
  };

  test("an event's row offers Open (its stage), Edit (its agenda) and Link (the attendees' link)", () => {
    expect(rowActions(EVENT)).toMatchObject({ open: true, edit: true, start: false, continue: false });
    const h = mount();
    const row = screen.getByTestId('event-row');
    fireEvent.click(within(row).getByRole('button', { name: /Open/ }));
    expect(h.navigate).toHaveBeenLastCalledWith('/host/event/4821');
    fireEvent.click(within(row).getByRole('button', { name: /Edit/ }));
    expect(h.navigate).toHaveBeenLastCalledWith('/host/event/4821/agenda');
    fireEvent.click(within(row).getByRole('button', { name: /Link/ }));
    expect(h.onCopyPlayerUrl).toHaveBeenCalledWith('4821', { event: true });
    expect(h.onEdit).not.toHaveBeenCalled();
  });

  test("its items: a played one continues on the stage and opens its report; an expired one says so", () => {
    const h = mount();
    fireEvent.click(within(screen.getByTestId('event-row')).getByRole('button', { name: /Q4 Kickoff/ }));
    const items = screen.getAllByTestId('event-item-row');
    fireEvent.click(within(items[0]).getByRole('button', { name: /Continue/ }));
    expect(h.navigate).toHaveBeenLastCalledWith('/host?gameId=7657&event=4821');
    fireEvent.click(within(items[0]).getByRole('button', { name: /Report/ }));
    expect(h.onReport).toHaveBeenCalledWith('7657', 'Space night');
    expect(within(items[2]).getByText('Session expired')).toBeInTheDocument();
  });

  test('Type filters the host list too', () => {
    expect(matchesType(EVENT, 'event')).toBe(true);
    expect(matchesType(GAMES[0], 'event')).toBe(false);
    mount();
    fireEvent.change(screen.getByLabelText('Filter by type'), { target: { value: 'build' } });
    expect(screen.queryByTestId('event-row')).toBeNull();
    expect(screen.getByText('Badge printer')).toBeInTheDocument();
  });

  test('GameHostPage merges the events into the list it hands this panel', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'GameHostPage.jsx'), 'utf8');
    expect(src).toMatch(/setGamesList\(mergeSessions\(data\)\)/);
  });
});

/* -------------------------------------------------------------- Reports */

describe('Reports', () => {
  const REPORTS = {
    reports: [
      { id: 'REPORT#7657', gameId: '7657', title: 'Space night', gameType: 'trivia', eventRef: '4821', eventItem: 'it_1', s3Key: 'a.pdf.enc', permanent: false, savedAt: iso(0), expiresAt: iso(90), sessionGone: false, downloadUrl: 'reports/download?key=a.pdf.enc', passkey: 'K' },
      { id: 'REPORT#5102', gameId: '5102', title: 'Badge printer', gameType: 'build', s3Key: 'b.pdf.enc', permanent: true, savedAt: iso(-1), expiresAt: iso(364), sessionGone: false, downloadUrl: 'reports/download?key=b.pdf.enc', passkey: 'L' },
    ],
    events: [{
      kind: 'event', code: '4821', title: 'Q4 Kickoff', state: 'ENDED', itemCount: 2,
      items: [
        { itemId: 'it_1', type: 'trivia', title: 'Space night', state: 'done', gameId: '7657', reportId: 'REPORT#7657', sessionGone: false },
        { itemId: 'it_2', type: 'poll', title: 'Pulse', state: 'done', gameId: '7658', reportId: null, sessionGone: false },
      ],
    }],
  };
  const mount = async (body = REPORTS) => {
    authFetch.mockImplementation(async () => json(200, body));
    render(<ReportsPanel />);
    await waitFor(() => expect(screen.queryByText(/Loading reports/)).toBeNull());
  };

  test('every row is typed; the event is one row and the item report is not listed again', async () => {
    await mount();
    expect(screen.getAllByTestId('report-row')).toHaveLength(1);
    expect(within(screen.getAllByTestId('report-row')[0]).getByText('Build Room')).toBeInTheDocument();
    const event = screen.getByTestId('event-row');
    expect(within(event).getByText('Event')).toBeInTheDocument();
    expect(within(event).getByText(/2 items · 1 report saved/)).toBeInTheDocument();
    expect(screen.queryByText('Space night')).toBeNull();
  });

  test('opened, the event lists its items: the saved report with Share and PDF, the other saying none was saved', async () => {
    await mount();
    fireEvent.click(within(screen.getByTestId('event-row')).getByRole('button', { name: /Q4 Kickoff/ }));
    const saved = screen.getByText('Space night').closest('tr');
    expect(within(saved).getByRole('button', { name: 'Share Space night' })).toBeInTheDocument();
    expect(within(saved).getByRole('button', { name: 'Download Space night' })).toBeInTheDocument();
    expect(within(screen.getByTestId('event-item-row')).getByText('No report saved')).toBeInTheDocument();
  });

  test('Type filters reports', async () => {
    await mount();
    fireEvent.change(screen.getByLabelText('Filter by type'), { target: { value: 'build' } });
    expect(screen.queryByTestId('event-row')).toBeNull();
    expect(screen.getAllByTestId('report-row')).toHaveLength(1);
  });
});
