/**
 * EVENT AND BUILD ROOM THROUGH THE COMMON CREATE FLOW, AND A BUILD ROOM'S
 * REPORT KEPT LIKE ANY OTHER (2026-10-04).
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
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import GameSetupDialog from '../components/GameSetupDialog';
import { BuildCreate } from '../buildroom/BuildRoomPage';
import BuildReport from '../buildroom/BuildReport';
import { authFetch } from '../auth/authFetch';

jest.mock('../auth/authFetch', () => ({
  __esModule: true,
  authFetch: jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ prompts: [] }) })),
}));
jest.mock('html2pdf.js', () => () => ({
  set() { return this; },
  from() { return this; },
  outputPdf: async () => 'data:application/pdf;base64,JVBERi0=',
}));

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
const pill = (name) => screen.getByRole('button', { name });

describe('the create dialog offers Event and Build Room', () => {
  test('both are formats beside the five, and Build Room hands the title to its setup screen', () => {
    const props = dialog();
    fireEvent.click(pill('Build Room'));
    expect(pill('Build Room')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByLabelText(/question set/i)).toBeNull();
    expect(screen.getByText(/Build something with your Claude Code/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Set up the Build Room' }));
    expect(props.onChooseOther).toHaveBeenCalledWith('build', { title: 'Q4 Kickoff' });
    expect(props.onCreate).not.toHaveBeenCalled();
    expect(props.onFormatChange).not.toHaveBeenCalledWith('build');
  });

  test('Event hands over to the new-event dialog', () => {
    const props = dialog();
    fireEvent.click(pill('Event'));
    expect(screen.getByText(/A whole agenda behind one code/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Continue to the event' }));
    expect(props.onChooseOther).toHaveBeenCalledWith('event', { title: 'Q4 Kickoff' });
  });

  test('on Free, Event says which plan brings it and goes no further', () => {
    const props = dialog({ eventsAccess: { enabled: true, canCreate: false, offerPlanName: 'Standard plan' } });
    fireEvent.click(pill('Event'));
    expect(screen.getByTestId('gsd-event-plan')).toHaveTextContent('Events come with the Standard plan.');
    expect(screen.getByRole('button', { name: 'Continue to the event' })).toBeDisabled();
    expect(props.onChooseOther).not.toHaveBeenCalled();
  });

  test('switched off (or not yet known): no Event; Build Room is still offered', () => {
    dialog({ eventsAccess: { enabled: false, canCreate: false, offerPlanName: '' } });
    expect(screen.queryByRole('button', { name: 'Event' })).toBeNull();
    expect(pill('Build Room')).toBeInTheDocument();
  });

  test('neither in edit mode, nor where no page handles them', () => {
    dialog({ mode: 'edit', initialValues: { title: 'x', gameType: 'trivia', questionSetId: 'space' } });
    expect(screen.queryByRole('button', { name: 'Build Room' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Event' })).toBeNull();
  });

  test('the five formats still create a session the way they did', () => {
    const props = dialog({ onChooseOther: undefined });
    expect(screen.queryByRole('button', { name: 'Build Room' })).toBeNull();
    fireEvent.click(pill('Trivia'));
    expect(screen.getByLabelText(/question set/i)).toBeInTheDocument();
    expect(props.onChooseOther).toBeUndefined();
  });
});

describe('the host page wires the hand-over, and the front page keeps its doors', () => {
  const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
  test('GameHostPage passes eventsAccess and onChooseOther; an event goes to the new-event dialog, then its agenda; a Build Room to /build with the title', () => {
    const host = read('GameHostPage.jsx');
    expect(host).toMatch(/<GameSetupDialog\s+eventsAccess=\{eventsAccess\}\s+onChooseOther=\{handleChooseOther\}/);
    expect(host).toMatch(/navigateTo\(title \? `\/build\?title=\$\{encodeURIComponent\(title\)\}` : '\/build'\)/);
    expect(host).toMatch(/<EventDetailsDialog\s+initial=\{\{ title: newEventTitle \}\}/);
    expect(host).toMatch(/navigateTo\(eventAgendaPath\(event\.code\)\)/);
  });
  test('the front page still has Create engagement, the Build Room link and Run an event', () => {
    const welcome = read('components', 'WelcomeScreen.jsx');
    expect(welcome).toMatch(/Create engagement/);
    expect(welcome).toMatch(/href="\/build"/);
    expect(welcome).toMatch(/<WelcomeEvents \/>/);
  });
  test('the Build Room setup takes the title it was handed', () => {
    render(<BuildCreate initialTitle="Q4 Kickoff" navigate={jest.fn()} />);
    expect(screen.getByPlaceholderText(/Volunteer sign-up/)).toHaveValue('Q4 Kickoff');
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
