/**
 * THE HOST'S MAIN SCREEN OFFERS THE ORGANISATION'S EVENTS —
 * components/WelcomeEvents.jsx inside WelcomeScreen (27 Sep 2026: "a host
 * should be able to launch these if they exist from their main screen").
 *
 * rejects: an event that is running now or still to come missing from the
 * list, or one that has ended on it; a running event not first; more than
 * two rows (the page must fit a laptop) with the rest uncounted; a list
 * asked for again on every render of the page around it (it never landed, and
 * GET /events went out in a loop); Open going
 * anywhere but the event's stage; anything drawn while Events is switched
 * off, or when the list cannot be read.
 *
 * AND A HOST MAKES ONE HERE (27 Sep 2026: "there is still no way to create an
 * agenda for the host. only the admin"). rejects: no "New event" for a host on
 * a paid plan; one offered on Free (the server would refuse it); a new event
 * landing anywhere but its agenda on the host's side; Free not told which plan
 * brings events.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import WelcomeEvents from '../components/WelcomeEvents';

jest.mock('../utils/eventsApi', () => ({ __esModule: true, listEvents: jest.fn(), createEvent: jest.fn(), updateEvent: jest.fn() }));
jest.mock('../utils/eventsAccess', () => ({ __esModule: true, readEventsAccess: jest.fn() }));
jest.mock('../auth/navigate', () => ({ __esModule: true, navigateTo: jest.fn() }));
const { listEvents, createEvent } = require('../utils/eventsApi');
const { readEventsAccess } = require('../utils/eventsAccess');
const { navigateTo } = require('../auth/navigate');

const PAID = { enabled: true, canCreate: true, offerPlanName: 'Standard plan' };
const FREE = { enabled: true, canCreate: false, offerPlanName: 'Standard plan' };
const OFF = { enabled: false, canCreate: false, offerPlanName: '' };

const NOW = Date.UTC(2026, 9, 9, 8, 0);
const ev = (code, title, startsAt, extra = {}) => ({ code, title, startsAt, state: 'SCHEDULED', itemCount: 5, attendeeCount: 0, ...extra });

beforeEach(() => {
  jest.clearAllMocks();
  readEventsAccess.mockResolvedValue(PAID);
});

test('running now first, then what is to come; ended and long-past events are left out', async () => {
  listEvents.mockResolvedValue([
    ev('1001', 'Board offsite', '2026-10-20T09:00'),
    ev('1002', 'Q4 Kickoff', '2026-10-09T09:00', { state: 'LIVE', attendeeCount: 36 }),
    ev('1003', 'Old news', '2026-09-01T09:00'),
    ev('1004', 'Yesterday\'s wrap', '2026-10-08T09:00', { state: 'ENDED' }),
  ]);
  render(<WelcomeEvents nowMs={NOW} />);

  const rows = await screen.findAllByRole('listitem');
  expect(rows.map((r) => r.querySelector('.wel-ev-name').textContent)).toEqual(['Q4 Kickoff', 'Board offsite']);
  expect(within(rows[0]).getByText('Running')).toBeInTheDocument();
  expect(rows[0]).toHaveTextContent('36 joined');
});

test('two at most, so the main screen still fits a laptop; the rest are counted, not listed', async () => {
  listEvents.mockResolvedValue([
    ev('1001', 'Board offsite', '2026-10-20T09:00'),
    ev('1002', 'Q4 Kickoff', '2026-10-09T09:00', { state: 'LIVE' }),
    ev('1005', 'Sales summit', '2026-11-02T09:00'),
  ]);
  render(<WelcomeEvents nowMs={NOW} />);
  const rows = await screen.findAllByRole('listitem');
  expect(rows.map((r) => r.querySelector('.wel-ev-name').textContent)).toEqual(['Q4 Kickoff', 'Board offsite']);
  expect(screen.getByText('1 more in the console\'s Events list.')).toBeInTheDocument();
});

test('Open goes to the event\'s stage, where its agenda is', async () => {
  listEvents.mockResolvedValue([ev('1002', 'Q4 Kickoff', '2026-10-09T09:00')]);
  render(<WelcomeEvents nowMs={NOW} />);
  fireEvent.click(await screen.findByRole('button', { name: /Open Q4 Kickoff/ }));
  expect(navigateTo).toHaveBeenCalledWith('/host/event/1002');
});

test('nothing at all while Events is switched off, with no events and when the list cannot be read', async () => {
  readEventsAccess.mockResolvedValue(OFF);
  listEvents.mockResolvedValue([]);
  const { container, unmount } = render(<WelcomeEvents nowMs={NOW} />);
  await waitFor(() => expect(readEventsAccess).toHaveBeenCalled());
  await waitFor(() => expect(listEvents).toHaveBeenCalled());
  expect(container).toBeEmptyDOMElement();
  unmount();
  listEvents.mockRejectedValue(new Error('403'));
  const again = render(<WelcomeEvents nowMs={NOW} />);
  await waitFor(() => expect(listEvents).toHaveBeenCalledTimes(2));
  expect(again.container).toBeEmptyDOMElement();
});

test('on a paid plan with no events yet: "New event", and what an event is', async () => {
  listEvents.mockResolvedValue([]);
  render(<WelcomeEvents nowMs={NOW} />);
  expect(await screen.findByRole('button', { name: 'New event' })).toBeInTheDocument();
  expect(screen.getByText(/A whole agenda behind one code/)).toHaveTextContent('$2.00 an event, counted when it first goes live.');
  expect(screen.queryByRole('list')).toBeNull();
});

test('New event opens the new-event dialog, and the event made lands on its agenda on the host\'s side', async () => {
  listEvents.mockResolvedValue([ev('1002', 'Q4 Kickoff', '2026-10-09T09:00')]);
  createEvent.mockResolvedValue({ code: '4821', title: 'Offsite' });
  render(<WelcomeEvents nowMs={NOW} />);
  fireEvent.click(await screen.findByRole('button', { name: 'New event' }));
  await screen.findByRole('dialog');
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Offsite' } });
  const d = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  fireEvent.change(screen.getByLabelText('Date'), { target: { value: date } });
  fireEvent.change(screen.getByLabelText('Starts'), { target: { value: '09:30' } });
  fireEvent.change(screen.getByLabelText('Time zone'), { target: { value: 'Europe/London' } });
  fireEvent.change(screen.getByLabelText(/^Place/), { target: { value: 'Harbour Room' } });
  fireEvent.click(screen.getByLabelText(/Anonymous/));
  fireEvent.click(screen.getByRole('button', { name: 'Create event' }));
  await waitFor(() => expect(createEvent).toHaveBeenCalled());
  await waitFor(() => expect(navigateTo).toHaveBeenCalledWith('/host/event/4821/agenda'));
});

test('on Free: no New event, and the plan that brings events, with the way to it', async () => {
  readEventsAccess.mockResolvedValue(FREE);
  listEvents.mockResolvedValue([]);
  render(<WelcomeEvents nowMs={NOW} />);
  expect(await screen.findByText(/Events come with the Standard plan/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'New event' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'See how' }));
  expect(navigateTo).toHaveBeenCalledWith('/admin?section=events');
});

test('asked for once, however often the page around it renders — and it lands', async () => {
  listEvents.mockResolvedValue([ev('1002', 'Q4 Kickoff', '2099-10-09T09:00')]);
  // No nowMs: the production call. A parent re-rendering must not re-ask.
  const { rerender } = render(<WelcomeEvents />);
  for (let i = 0; i < 5; i += 1) rerender(<WelcomeEvents />);
  expect(await screen.findByText('Q4 Kickoff')).toBeInTheDocument();
  expect(listEvents).toHaveBeenCalledTimes(1);
});
