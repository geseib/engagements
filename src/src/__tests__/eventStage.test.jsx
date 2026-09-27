/**
 * THE EVENT ON THE WALL — components/event/EventStage.jsx (/host/event/<code>;
 * events M3; docs/design/agenda-redesign s-01, s-03, s-04, s-05).
 *
 * rejects: a wall that cannot start the first item; a start of an engagement
 * that stays on the wall instead of handing the stage to the item's session;
 * a live engagement found on arrival and not entered; a break with no
 * countdown or no +5 min; the agenda panel missing an item's own actions;
 * ending the event without a confirmation that says what it does; a refusal
 * swallowed instead of said.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import EventStage from '../components/event/EventStage';

jest.mock('../utils/eventsApi', () => ({
  getEvent: jest.fn(),
  runEvent: jest.fn(),
}));
jest.mock('../auth/navigate', () => ({ navigateTo: jest.fn() }));
jest.mock('qrcode.react', () => ({ QRCodeSVG: ({ value }) => <svg data-testid="qr" data-value={value} /> }));
jest.mock('../hooks/useStageFit', () => () => {});

const api = require('../utils/eventsApi');
const { navigateTo } = require('../auth/navigate');

const CODE = '5307';
const EVENT = {
  code: CODE, title: 'Q4 Kickoff', place: 'Harbour Room', startsAt: '2026-10-09T09:00', timeZone: 'Europe/London',
  endsAt: '10:05', state: 'SCHEDULED', liveItemId: '', attendeeCount: 12,
};
const item = (n, type, title, extra = {}) => ({
  itemId: `it_0000000${n}`, order: n, type, title, description: '', ledBy: '', minutes: 15,
  at: `9:${n}0`, until: `9:${n}5`, state: 'planned', ...extra,
});
const DAY = [
  item(1, 'trivia', 'How well do you know our customers?', { description: 'Ten questions.' }),
  item(2, 'presentation', 'FY26 in review', { ledBy: 'Dana Whitfield' }),
  item(3, 'break', 'Break', { description: 'Coffee on the landing.' }),
  item(4, 'call-and-answer', 'What slows us down?'),
];
const view = (event = {}, items = DAY) => ({ event: { ...EVENT, ...event }, items });

beforeEach(() => {
  jest.clearAllMocks();
});

test('before the day: the event\'s title, its code and QR, and "Start" the first item', async () => {
  api.getEvent.mockResolvedValue(view());
  render(<EventStage code={CODE} />);

  expect(await screen.findByRole('heading', { name: 'Q4 Kickoff' })).toBeInTheDocument();
  expect(screen.getByText('Starting soon')).toBeInTheDocument();
  expect(screen.getByTestId('qr')).toHaveAttribute('data-value', expect.stringMatching(/\/play\?event=5307$/));
  expect(screen.getByText('12 joined')).toBeInTheDocument();
  // An engagement is started by its kind (s-01's "Start the survey"): the
  // wall above already shows its title.
  expect(screen.getByRole('button', { name: 'Start trivia' })).toBeInTheDocument();
});

test('starting an engagement runs the wipe, then hands the stage to its session', async () => {
  api.getEvent.mockResolvedValue(view());
  const live = { ...DAY[0], state: 'live', gameId: '4821' };
  api.runEvent.mockResolvedValue(view({ state: 'LIVE', liveItemId: live.itemId }, [live, ...DAY.slice(1)]));
  jest.useFakeTimers();
  try {
    render(<EventStage code={CODE} />);
    await act(async () => { await Promise.resolve(); });
    fireEvent.click(await screen.findByRole('button', { name: 'Start trivia' }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(api.runEvent).toHaveBeenCalledWith(CODE, 'start', DAY[0].itemId);
    expect(screen.getByRole('status')).toHaveTextContent(/Trivia.*no code needed/);
    await act(async () => { jest.advanceTimersByTime(1500); });
    expect(navigateTo).toHaveBeenCalledWith('/host?gameId=4821&event=5307');
  } finally {
    jest.useRealTimers();
  }
});

test('a live engagement on arrival is entered at once (a reload restores event mode)', async () => {
  const live = { ...DAY[3], state: 'live', gameId: '6120' };
  api.getEvent.mockResolvedValue(view({ state: 'LIVE', liveItemId: live.itemId }, [...DAY.slice(0, 3), live]));
  render(<EventStage code={CODE} />);
  await waitFor(() => expect(navigateTo).toHaveBeenCalledWith('/host?gameId=6120&event=5307'));
});

test('a break: the countdown to the planned return, +5 min, and the next item\'s Start', async () => {
  const brk = { ...DAY[2], state: 'live', endsAt: new Date(Date.now() + 9 * 60000).toISOString() };
  api.getEvent.mockResolvedValue(view({ state: 'LIVE', liveItemId: brk.itemId }, [{ ...DAY[0], state: 'done' }, { ...DAY[1], state: 'done' }, brk, DAY[3]]));
  api.runEvent.mockResolvedValue(view({ state: 'LIVE', liveItemId: brk.itemId }, [DAY[0], DAY[1], brk, DAY[3]]));
  render(<EventStage code={CODE} />);

  expect(await screen.findByRole('timer')).toHaveTextContent(/^(8:5\d|9:00)$/);
  fireEvent.click(screen.getByRole('button', { name: '+5 min' }));
  await waitFor(() => expect(api.runEvent).toHaveBeenCalledWith(CODE, 'extend', brk.itemId));
  expect(screen.getByRole('button', { name: 'Start Call & Answer' })).toBeInTheDocument();
});

test('the agenda panel: every item with the actions that fit it, and a refusal said', async () => {
  const paused = { ...DAY[0], state: 'paused', gameId: '4821' };
  api.getEvent.mockResolvedValue(view({ state: 'LIVE' }, [paused, ...DAY.slice(1)]));
  api.runEvent.mockRejectedValue(Object.assign(new Error('The survey is still collecting.'), { status: 409 }));
  render(<EventStage code={CODE} />);

  fireEvent.click(await screen.findByRole('button', { name: /every item's controls/ }));
  const dialog = await screen.findByRole('dialog');
  const rows = within(dialog).getAllByRole('listitem');
  expect(rows).toHaveLength(4);
  expect(within(rows[0]).getByRole('button', { name: 'Resume' })).toBeInTheDocument();
  expect(within(rows[0]).getByRole('button', { name: 'End' })).toBeInTheDocument();
  expect(within(rows[1]).getByRole('button', { name: 'Start' })).toBeInTheDocument();

  fireEvent.click(within(rows[0]).getByRole('button', { name: 'End' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('The survey is still collecting.');
});

test('ending the event asks first, and says what it does', async () => {
  api.getEvent.mockResolvedValue(view({ state: 'LIVE' }, DAY.map((i) => ({ ...i, state: 'done' }))));
  api.runEvent.mockResolvedValue(view({ state: 'ENDED' }, DAY.map((i) => ({ ...i, state: 'done' }))));
  render(<EventStage code={CODE} />);

  fireEvent.click(await screen.findByRole('button', { name: 'End the event' }));
  const confirm = await screen.findByRole('dialog');
  expect(confirm).toHaveTextContent(/nobody new can join/);
  expect(api.runEvent).not.toHaveBeenCalled();
  fireEvent.click(within(confirm).getByRole('button', { name: 'End the event' }));
  await waitFor(() => expect(api.runEvent).toHaveBeenCalledWith(CODE, 'end-event', undefined));
  expect(await screen.findByText('That’s the day.')).toBeInTheDocument();
});
