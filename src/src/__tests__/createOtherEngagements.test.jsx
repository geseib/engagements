/**
 * EVENT AND BUILD ROOM THROUGH THE COMMON CREATE FLOW, AND A BUILD ROOM'S
 * REPORT KEPT LIKE ANY OTHER (2026-10-04).
 *
 * SINCE EXPERIENCE PLAN 4c (2 Nov 2026) the dialog makes both itself: the
 * Build Room's four setup fields fold into its Optional section, an event's
 * day is asked under "Next: the agenda", and the page creates the thing and
 * lands it on its own page (the room's setup, the agenda). Home's own Build
 * Room and New event doors are gone: one New door.
 *
 * The owner: events and Build Rooms "have connect to the current systems for
 * creating and editing those types of engagements … we can leave the current
 * front page entry points in though." So Create engagement offers both as
 * formats and hands each to the screen that already sets it up — the
 * new-event dialog then the agenda builder, the Build Room setup page — with
 * the title carried over; the front page's own doors stay as they were. And a
 * Build Room's report, print-only until now, saves through the same route and
 * helper as a session's: 90 days or a year, a link and a passkey, in Reports.
 *
 * NO GEOMETRIC ASSERTIONS. jsdom has no layout engine.
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import GameSetupDialog from '../components/GameSetupDialog';
import { BuildCreate } from '../buildroom/BuildRoomPage';
import BuildReport from '../buildroom/BuildReport';
import { authFetch } from '../auth/authFetch';

jest.mock('../auth/authFetch', () => ({
  __esModule: true,
  authFetch: jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ prompts: [] }) })),
}));
jest.mock('html2pdf.js', () => () => {
  const pdf = {
    internal: { getNumberOfPages: () => 1, pageSize: { getWidth: () => 8.5, getHeight: () => 11 } },
    setPage() {}, setFillColor() {}, lines() {}, setFont() {}, setFontSize() {}, setTextColor() {},
    text() {}, getTextWidth: () => 1, setDrawColor() {}, setLineWidth() {}, line() {}, addPage() {},
  };
  const worker = {
    set: () => worker, from: () => worker, toContainer: () => worker, toCanvas: () => worker,
    toPdf: () => worker, get: () => worker, then: (fn) => { fn(pdf); return worker; },
    outputPdf: async () => 'data:application/pdf;base64,JVBERi0=',
  };
  return worker;
});

const SETS = [{ id: 'space', name: 'Space Trivia', totalQuestions: 12, engagementType: 'trivia', hasImages: false }];
const ON = { enabled: true, canCreate: true, offerPlanName: 'Standard plan' };

function dialog(overrides = {}) {
  const props = {
    eventTitle: 'Q4 Kickoff',
    onEventTitleChange: jest.fn(),
    questionSets: SETS,
    personas: [],
    categories: [],
    activeCategoryIds: new Set(),
    onCancel: jest.fn(),
    onCreate: jest.fn(),
    onFormatChange: jest.fn(),
    onChooseOther: jest.fn(),
    eventsAccess: ON,
    ...overrides,
  };
  render(<GameSetupDialog {...props} />);
  return props;
}
// Formats are one radio group (docs/design/new-engagement README §3.8).
const pill = (name) => screen.getByRole('radio', { name });

describe('the create dialog offers Event and Build Room, and creates them itself (experience plan 4c)', () => {
  test('Build Room: its four setup fields fold into Optional, with the defaults named; Create hands them over', () => {
    const props = dialog();
    fireEvent.click(pill('Build Room'));
    expect(pill('Build Room')).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByLabelText(/question set/i)).toBeNull();
    expect(screen.getByText(/Build something with your Claude Code while the room suggests and votes/)).toBeInTheDocument();
    const fold = screen.getByTestId('gsd-build-fields');
    // One quiet fold, closed, whose line names every default in force.
    expect(fold.tagName).toBe('DETAILS');
    expect(fold).not.toHaveAttribute('open');
    expect(fold).toHaveTextContent('Optional · Defaults: the room decides what to build, anyone with the code joins, you review Claude’s questions first.');
    // The four fields: what to build, the goal, who can join, review.
    expect(within(fold).getByRole('radio', { name: 'The room decides' })).toBeChecked();
    expect(within(fold).getByRole('radio', { name: /I.ve set the goal/ })).not.toBeChecked();
    expect(within(fold).getByLabelText(/Goal \(optional\)/)).toBeInTheDocument();
    expect(within(fold).getByRole('radio', { name: 'Anyone with the code' })).toBeChecked();
    expect(within(fold).getByRole('checkbox', { name: /Review Claude.s questions/ })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Create the Build Room' }));
    expect(props.onChooseOther).toHaveBeenCalledWith('build', {
      title: 'Q4 Kickoff',
      fields: { goal: '', decides: 'room', visibility: 'public', accessCode: '', review: true },
    });
    expect(props.onCreate).not.toHaveBeenCalled();
    expect(props.onFormatChange).not.toHaveBeenCalledWith('build');
  });

  test('Build Room: "I\'ve set the goal" needs the goal, and Create pressed early opens the fold at it', () => {
    const props = dialog();
    fireEvent.click(pill('Build Room'));
    const fold = screen.getByTestId('gsd-build-fields');
    fireEvent.click(within(fold).getByRole('radio', { name: /I.ve set the goal/ }));
    expect(fold).toHaveTextContent('Changed: you set the goal.');
    expect(screen.getByText(/Still needed:/).closest('p')).toHaveTextContent('Still needed: the goal.');
    const create = screen.getByRole('button', { name: 'Create the Build Room' });
    expect(create).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(create);
    expect(props.onChooseOther).not.toHaveBeenCalled();
    expect(fold).toHaveAttribute('open');
    fireEvent.change(within(fold).getByLabelText(/Goal: what should exist/), { target: { value: 'A sign-up page' } });
    fireEvent.click(within(fold).getByRole('radio', { name: /Private/ }));
    expect(screen.getByText(/Still needed:/).closest('p')).toHaveTextContent('Still needed: an access code.');
    fireEvent.change(within(fold).getByLabelText('Access code'), { target: { value: 'kite' } });
    fireEvent.click(within(fold).getByRole('checkbox', { name: /Review Claude.s questions/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Create the Build Room' }));
    expect(props.onChooseOther).toHaveBeenCalledWith('build', {
      title: 'Q4 Kickoff',
      fields: { goal: 'A sign-up page', decides: 'host', visibility: 'private', accessCode: 'kite', review: false },
    });
  });

  test('Event: its day is asked in the same dialog, under "Next: the agenda", and Create hands over the event', () => {
    const props = dialog();
    fireEvent.click(pill('Event'));
    expect(screen.getByRole('heading', { name: 'Next: the agenda' })).toBeInTheDocument();
    expect(screen.getByText(/A whole agenda behind one code/)).toBeInTheDocument();
    const fields = screen.getByTestId('gsd-event-fields');
    // Today, 09:00, this browser's zone: the fast path is a name and one press.
    expect(within(fields).getByLabelText('Date').value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(within(fields).getByLabelText('Starts')).toHaveValue('09:00');
    fireEvent.change(within(fields).getByLabelText('Date'), { target: { value: '2026-12-01' } });
    fireEvent.change(within(fields).getByLabelText('Starts'), { target: { value: '10:30' } });
    fireEvent.change(within(fields).getByLabelText(/^Place/), { target: { value: 'Harbour Room' } });
    fireEvent.click(within(fields).getByRole('radio', { name: /Anonymous/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Create the event' }));
    expect(props.onChooseOther).toHaveBeenCalledWith('event', {
      title: 'Q4 Kickoff',
      fields: expect.objectContaining({
        title: 'Q4 Kickoff', startsAt: '2026-12-01T10:30', place: 'Harbour Room', access: 'open', attendeeReports: 'anonymous',
      }),
    });
    expect(props.onCreate).not.toHaveBeenCalled();
  });

  test('Event with no date says what is still needed and creates nothing', () => {
    const props = dialog();
    fireEvent.click(pill('Event'));
    fireEvent.change(within(screen.getByTestId('gsd-event-fields')).getByLabelText('Date'), { target: { value: '' } });
    expect(screen.getByText(/Still needed:/).closest('p')).toHaveTextContent('Still needed: a date and start time.');
    fireEvent.click(screen.getByRole('button', { name: 'Create the event' }));
    expect(props.onChooseOther).not.toHaveBeenCalled();
  });

  test('on Free, Event says which plan brings it and goes no further', () => {
    const props = dialog({ eventsAccess: { enabled: true, canCreate: false, offerPlanName: 'Standard plan' } });
    fireEvent.click(pill('Event'));
    expect(screen.getByTestId('gsd-event-plan')).toHaveTextContent('Events come with the Standard plan.');
    expect(screen.queryByTestId('gsd-event-fields')).toBeNull();
    // Round 4: aria-disabled, so it stays reachable and says why when pressed.
    expect(screen.getByRole('button', { name: 'Create the event' })).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Create the event' }));
    expect(props.onChooseOther).not.toHaveBeenCalled();
  });

  test('switched off (or not yet known): no Event; Build Room is still offered', () => {
    dialog({ eventsAccess: { enabled: false, canCreate: false, offerPlanName: '' } });
    expect(screen.queryByRole('radio', { name: 'Event' })).toBeNull();
    expect(pill('Build Room')).toBeInTheDocument();
  });

  test('neither in edit mode, nor where no page handles them', () => {
    dialog({ mode: 'edit', initialValues: { title: 'x', gameType: 'trivia', questionSetId: 'space' } });
    expect(screen.queryByRole('radio', { name: 'Build Room' })).toBeNull();
    expect(screen.queryByRole('radio', { name: 'Event' })).toBeNull();
  });

  test('the five formats still create a session the way they did', () => {
    const props = dialog({ onChooseOther: undefined });
    expect(screen.queryByRole('radio', { name: 'Build Room' })).toBeNull();
    fireEvent.click(pill('Trivia'));
    // The section is labelled by its heading now (round 4), so ask for the search itself.
    expect(screen.getByRole('combobox', { name: /question set/i })).toBeInTheDocument();
    expect(props.onChooseOther).toBeUndefined();
  });
});

describe('the host page creates them and lands each on its own page; Home has one New door', () => {
  const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
  test('GameHostPage passes eventsAccess and onChooseOther; a Build Room is created and lands on its room page, an event on its agenda — no second form or dialog', () => {
    const host = read('GameHostPage.jsx');
    expect(host).toMatch(/<GameSetupDialog\s+eventsAccess=\{eventsAccess\}\s+onChooseOther=\{handleChooseOther\}/);
    expect(host).toMatch(/const newId = await createBuildRoom\(\{ \.\.\.fields, title \}\);\s+navigateTo\(buildRoomPath\(newId\)\)/);
    expect(host).toMatch(/const event = await createEvent\(fields\);\s+navigateTo\(eventAgendaPath\(event\.code\)\)/);
    // rejects: the old hand-offs (a /build?title= page load; the new-event dialog in between).
    expect(host).not.toMatch(/\/build\?title=/);
    expect(host).not.toMatch(/<EventDetailsDialog/);
  });
  test('the front page has New engagement and Run an event, and no Build Room door', () => {
    const welcome = read('components', 'WelcomeScreen.jsx');
    expect(welcome).toMatch(/New engagement/);
    expect(welcome).not.toMatch(/href="\/build"/);
    expect(welcome).toMatch(/<WelcomeEvents \/>/);
  });
  test('the Build Room page\'s own form (reached at /build) still takes a title, and checks with the shared rules', () => {
    render(<BuildCreate initialTitle="Q4 Kickoff" navigate={jest.fn()} />);
    expect(screen.getByPlaceholderText(/Volunteer sign-up/)).toHaveValue('Q4 Kickoff');
    const page = read('buildroom', 'BuildRoomPage.jsx');
    expect(page).toMatch(/buildSetupProblem\(\{ title, goal, decides, visibility, accessCode \}\)/);
    expect(page).toMatch(/createBuildRoom\(\{ title, goal, decides, visibility, accessCode, review \}\)/);
  });
});

describe("a Build Room's report is saved like any session's", () => {
  beforeEach(() => {
    window.API_BASE = 'https://api.example.test/dev/';
    authFetch.mockReset();
    authFetch.mockImplementation(async () => ({
      ok: true, status: 200,
      json: async () => ({ fileName: 'permanent/Badge-printer.pdf.enc', passkey: 'K7Q2-9XPL', shareUntil: '2027-10-04T00:00:00.000Z', permanent: true }),
    }));
  });

  test('Save report asks how long, inline, then saves through save-report and shows the link and passkey', async () => {
    render(<BuildReport state={{ gameId: '5102', title: 'Badge printer', log: [], asks: [], players: [] }} />);
    fireEvent.click(screen.getByRole('button', { name: /Save report/ }));
    expect(screen.getByRole('group')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/Keep for 1 year/));
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    await waitFor(() => expect(authFetch).toHaveBeenCalled());
    const [url, init] = authFetch.mock.calls[0];
    expect(url).toBe('https://api.example.test/dev/games/5102/save-report');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ gameId: '5102', eventTitle: 'Badge printer', permanent: true, pdfBlob: 'JVBERi0=' });
    expect(await screen.findByDisplayValue('K7Q2-9XPL')).toBeInTheDocument();
  });

  test('a refusal is said in words, where the host acted', async () => {
    authFetch.mockImplementation(async () => ({ ok: false, status: 404, json: async () => ({ error: 'Game not found' }) }));
    render(<BuildReport state={{ gameId: '5102', title: 'Badge printer', log: [], asks: [], players: [] }} />);
    fireEvent.click(screen.getByRole('button', { name: /Save report/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  test('the keep terms are the session report\'s, which the bucket rules decide', () => {
    const report = fs.readFileSync(path.join(__dirname, '..', 'buildroom', 'BuildReport.jsx'), 'utf8');
    expect(report).toMatch(/Keep for 90 days/);
    expect(report).toMatch(/Keep for 1 year/);
    expect(report).toMatch(/saveReportPdf\(/);
  });
});
