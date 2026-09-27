/**
 * THE HOST'S MAIN SCREEN OFFERS THE ORGANISATION'S EVENTS —
 * components/WelcomeEvents.jsx inside WelcomeScreen (27 Sep 2026: "a host
 * should be able to launch these if they exist from their main screen").
 *
 * rejects: an event that is running now or still to come missing from the
 * list, or one that has ended on it; a running event not first; more than
 * two rows (the page must fit a laptop) with the rest uncounted; Open going
 * anywhere but the event's stage; anything drawn for a host with no events,
 * or when the list cannot be read.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import WelcomeEvents from '../components/WelcomeEvents';

jest.mock('../utils/eventsApi', () => ({ __esModule: true, listEvents: jest.fn() }));
jest.mock('../auth/navigate', () => ({ __esModule: true, navigateTo: jest.fn() }));
const { listEvents } = require('../utils/eventsApi');
const { navigateTo } = require('../auth/navigate');

const NOW = Date.UTC(2026, 9, 9, 8, 0);
const ev = (code, title, startsAt, extra = {}) => ({ code, title, startsAt, state: 'SCHEDULED', itemCount: 5, attendeeCount: 0, ...extra });

beforeEach(() => jest.clearAllMocks());

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

test('nothing at all for a host with no events, or when the list cannot be read', async () => {
  listEvents.mockResolvedValue([]);
  const { container, unmount } = render(<WelcomeEvents nowMs={NOW} />);
  await waitFor(() => expect(listEvents).toHaveBeenCalled());
  expect(container).toBeEmptyDOMElement();
  unmount();
  listEvents.mockRejectedValue(new Error('403'));
  const again = render(<WelcomeEvents nowMs={NOW} />);
  await waitFor(() => expect(listEvents).toHaveBeenCalledTimes(2));
  expect(again.container).toBeEmptyDOMElement();
});
