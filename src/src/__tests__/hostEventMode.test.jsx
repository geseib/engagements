/**
 * AN EVENT'S ITEM ON THE HOST'S STAGE — GameHostPage with `?event=` (events,
 * reworked 27 Sep 2026), mounted.
 *
 * rejects: a previewed item's stage (its session made but not opened) sent
 * to the welcome screen because the session has not started; a preview whose
 * primary runs a round to an empty room instead of bringing everyone here;
 * "Bring everyone here" that does not take the item live, or leaves the host
 * on a stale preview; AGENDA that pauses the item (it is the host looking,
 * not the room moving); a second way back (Back to Menu) beside AGENDA; the
 * lobby advertising the item's own code instead of the event's.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

jest.mock('../auth/AuthContext', () => ({
  __esModule: true,
  useAuth: () => ({
    currentUser: { username: 'host', attributes: { email: 'host@example.com' } },
    signOut: jest.fn(),
    isAdmin: false,
  }),
  AuthProvider: ({ children }) => children,
}));

jest.mock('../auth/authFetch', () => ({
  __esModule: true,
  authFetch: (...args) => global.fetch(...args),
  getActiveOrgId: () => '',
  setActiveOrgId: () => {},
  ORG_HEADER: 'X-Engage-Org',
  ACTIVE_ORG_STORAGE_KEY: 'engage.activeOrg',
}));

jest.mock('../WebSocketClient', () => ({
  __esModule: true,
  default: {
    connect: jest.fn(),
    disconnect: jest.fn(),
    ensureConnected: jest.fn(),
    isConnected: () => false,
    sendCleanMessage: jest.fn(),
    onConnectionStatusChange: jest.fn(),
    onReconnected: jest.fn(),
    onMessage: jest.fn(),
    offMessage: jest.fn(),
  },
}));

jest.mock('../utils/eventsApi', () => ({
  __esModule: true,
  getEvent: jest.fn(),
  runEvent: jest.fn(),
  listEvents: jest.fn(async () => []),
}));
jest.mock('../auth/navigate', () => ({ __esModule: true, navigateTo: jest.fn() }));

import GameHostPage from '../GameHostPage';

const events = require('../utils/eventsApi');
const { navigateTo } = require('../auth/navigate');

const GAME = '4821';
const CODE = '5307';
const ITEM = { itemId: 'it_0000000a', type: 'trivia', title: 'Space night', state: 'planned', gameId: GAME, at: '9:00', until: '9:15' };
const viewWith = (item) => ({ event: { code: CODE, title: 'Q4 Kickoff', state: 'LIVE', liveItemId: item.state === 'live' ? item.itemId : '' }, items: [item] });

function installFetch(state) {
  global.fetch = jest.fn(async (url) => {
    const u = String(url);
    const body = u.endsWith(`games/${GAME}`) ? { exists: true, started: state !== 'CREATED' }
      : u.includes(`games/${GAME}/host-state`) ? {
        state, gameMetadata: { gameType: 'trivia', title: 'Space night' }, eventRef: CODE, eventPaused: false,
      }
        : {};
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  });
}

async function mountItemStage() {
  window.history.pushState({}, '', `/host?gameId=${GAME}&event=${CODE}`);
  render(<GameHostPage />);
  await screen.findByRole('button', { name: /session panel/i }, { timeout: 5000 });
}

beforeEach(() => {
  localStorage.clear();
  jest.clearAllMocks();
});

test('a preview opens on its stage, not the welcome screen, and its primary brings everyone here', async () => {
  installFetch('CREATED');
  events.getEvent.mockResolvedValue(viewWith(ITEM));
  await mountItemStage();

  expect(await screen.findByRole('button', { name: 'Bring everyone here' }, { timeout: 5000 })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Start First/ })).toBeNull();
  await waitFor(() => expect(document.querySelector('.dock .status')).toHaveTextContent('Preview — the phones are not here yet'));
  // Attendees join the day, never the item: the lobby shows the event's code.
  expect(screen.getAllByText(CODE).length).toBeGreaterThan(0);
});

test('"Bring everyone here" takes the item live and the host stays, now running it', async () => {
  installFetch('CREATED');
  events.getEvent.mockResolvedValue(viewWith(ITEM));
  events.runEvent.mockResolvedValue(viewWith({ ...ITEM, state: 'live' }));
  await mountItemStage();

  const bring = await screen.findByRole('button', { name: 'Bring everyone here' }, { timeout: 5000 });
  installFetch('STARTED');
  fireEvent.click(bring);
  await waitFor(() => expect(events.runEvent).toHaveBeenCalledWith(CODE, 'start', ITEM.itemId));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Bring everyone here' })).toBeNull(), { timeout: 5000 });
  expect(navigateTo).not.toHaveBeenCalled();
});

test('a paused item offers "Bring everyone back"', async () => {
  installFetch('ASK#002');
  events.getEvent.mockResolvedValue(viewWith({ ...ITEM, state: 'paused' }));
  events.runEvent.mockResolvedValue(viewWith({ ...ITEM, state: 'live' }));
  await mountItemStage();

  fireEvent.click(await screen.findByRole('button', { name: 'Bring everyone back' }, { timeout: 5000 }));
  await waitFor(() => expect(events.runEvent).toHaveBeenCalledWith(CODE, 'resume', ITEM.itemId));
});

test('AGENDA is the host looking: back to the event\'s board, and nothing pauses', async () => {
  installFetch('ASK#002');
  events.getEvent.mockResolvedValue(viewWith({ ...ITEM, state: 'live' }));
  await mountItemStage();

  fireEvent.click(await screen.findByRole('button', { name: /Back to the event's agenda/ }, { timeout: 5000 }));
  await waitFor(() => expect(navigateTo).toHaveBeenCalledWith(`/host/event/${CODE}`));
  expect(events.runEvent).not.toHaveBeenCalled();
});

test('a live item\'s lobby has one way back, AGENDA — not Back to Menu beside it', async () => {
  installFetch('STARTED');
  events.getEvent.mockResolvedValue(viewWith({ ...ITEM, state: 'live' }));
  await mountItemStage();

  expect(await screen.findByRole('button', { name: /Back to the event's agenda/ }, { timeout: 5000 })).toBeInTheDocument();
  await waitFor(() => expect(events.getEvent).toHaveBeenCalled());
  expect(screen.queryByRole('button', { name: /Back to Menu/ })).toBeNull();
});

/*
  "SET THE RUNNING ORDER" (QA drive 2026-09-29, finding #4). rejects: a
  preview lobby with no way to the running order; that way on a paused item;
  ?panel=questions that does not open the Session panel on Questions, or
  that opens it that way again after it is closed; the panel opening at all
  without the parameter.
*/
test('a preview lobby offers "Set the running order", which opens SESSION on Questions', async () => {
  installFetch('CREATED');
  events.getEvent.mockResolvedValue(viewWith(ITEM));
  await mountItemStage();

  const door = await screen.findByTestId('preview-running-order', {}, { timeout: 5000 });
  expect(screen.queryByRole('dialog', { name: 'Session setup' })).toBeNull();
  fireEvent.click(within(door).getByRole('button', { name: 'Set the running order' }));
  const panel = await screen.findByRole('dialog', { name: 'Session setup' });
  expect(within(panel).getByRole('tab', { name: 'Questions' })).toHaveAttribute('aria-selected', 'true');
  expect(within(panel).getByText('Running order')).toBeInTheDocument();
});

test('no running-order door on a paused item\'s lobby', async () => {
  installFetch('CREATED');
  events.getEvent.mockResolvedValue(viewWith({ ...ITEM, state: 'paused' }));
  await mountItemStage();
  await screen.findByRole('button', { name: 'Bring everyone back' }, { timeout: 5000 });
  expect(screen.queryByTestId('preview-running-order')).toBeNull();
});

test('?panel=questions lands on the Session panel\'s Questions tab, once', async () => {
  installFetch('CREATED');
  events.getEvent.mockResolvedValue(viewWith(ITEM));
  window.history.pushState({}, '', `/host?gameId=${GAME}&event=${CODE}&panel=questions`);
  render(<GameHostPage />);

  const panel = await screen.findByRole('dialog', { name: 'Session setup' }, { timeout: 5000 });
  expect(within(panel).getByRole('tab', { name: 'Questions' })).toHaveAttribute('aria-selected', 'true');
  expect(window.location.search).not.toMatch(/panel=/);
  expect(window.location.search).toMatch(`gameId=${GAME}`);

  // Closed and opened again with SESSION, it is the ordinary panel.
  fireEvent.click(within(panel).getByRole('button', { name: 'Close setup' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Session setup' })).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: /session panel/i }));
  const again = await screen.findByRole('dialog', { name: 'Session setup' });
  expect(within(again).getByRole('tab', { name: 'Players' })).toHaveAttribute('aria-selected', 'true');
});

test('without ?panel= the stage opens with the Session panel shut', async () => {
  installFetch('CREATED');
  events.getEvent.mockResolvedValue(viewWith(ITEM));
  await mountItemStage();
  await screen.findByRole('button', { name: 'Bring everyone here' }, { timeout: 5000 });
  expect(screen.queryByRole('dialog', { name: 'Session setup' })).toBeNull();
});
