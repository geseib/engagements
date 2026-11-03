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
import { markEventScreens } from '../config/eventAgenda';

const events = require('../utils/eventsApi');
const { navigateTo } = require('../auth/navigate');

const GAME = '4821';
const CODE = '5307';
// Wavelength, a type whose lobby is still the stage: since experience plan 2g a
// Trivia or Poll item opens on Setup, as Call & Answer does (eventItemConsole.test.jsx).
const ITEM = { itemId: 'it_0000000a', type: 'wavelength', title: 'Space night', state: 'planned', gameId: GAME, at: '9:00', until: '9:15' };
const viewWith = (item) => ({ event: { code: CODE, title: 'Q4 Kickoff', state: 'LIVE', liveItemId: item.state === 'live' ? item.itemId : '' }, items: [item] });

function installFetch(state, { players = [] } = {}) {
  global.fetch = jest.fn(async (url) => {
    const u = String(url);
    const body = u.endsWith(`games/${GAME}`) ? { exists: true, started: state !== 'CREATED' }
      : u.includes(`games/${GAME}/host-state`) ? {
        state, gameMetadata: { gameType: 'wavelength', title: 'Space night' }, eventRef: CODE, eventPaused: false,
      }
        : u.includes(`games/${GAME}/players`) ? { players: players.map((playerName) => ({ playerName, totalScore: 0 })) }
        : {};
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  });
}

// ConfirmDialog (components/ConfirmDialog.jsx) draws its card as .confirmation-modal.
const findAsk = () => waitFor(() => {
  const el = document.querySelector('.confirmation-modal');
  if (!el) throw new Error('no ask is open');
  return el;
});

async function mountItemStage() {
  window.history.pushState({}, '', `/host?gameId=${GAME}&event=${CODE}`);
  render(<GameHostPage />);
  await screen.findByRole('button', { name: 'Session menu' }, { timeout: 5000 });
}

beforeEach(() => {
  localStorage.clear();
  /* A Wavelength item opens Setup since dev QA 2 Nov. Its screens were set
     up earlier today (the event's once-a-day check, config/eventAgenda.js),
     so it opens past the check, on its one-screen stage, as these tests read. */
  markEventScreens(localStorage, CODE);
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
  // A preview asks before the phones move (owner, 31 Oct 2026).
  const ask = await findAsk();
  expect(ask).toHaveTextContent('Bring everyone here?');
  expect(events.runEvent).not.toHaveBeenCalled();
  fireEvent.click(within(ask).getByRole('button', { name: 'Bring everyone here' }));
  await waitFor(() => expect(events.runEvent).toHaveBeenCalledWith(CODE, 'start', ITEM.itemId));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Bring everyone here' })).toBeNull(), { timeout: 5000 });
  expect(navigateTo).not.toHaveBeenCalled();
});

// rejects: the owner's report, 31 Oct 2026 — "if i accidentally press space
// bar it starts the event". On a preview SPACE asks; it never moves the room.
test('SPACE on a preview asks first, and moves nobody until the host says yes', async () => {
  installFetch('CREATED');
  events.getEvent.mockResolvedValue(viewWith(ITEM));
  await mountItemStage();
  await screen.findByRole('button', { name: 'Bring everyone here' }, { timeout: 5000 });
  fireEvent.keyDown(window, { key: ' ' });
  const ask = await findAsk();
  expect(ask).toHaveTextContent('Bring everyone here?');
  expect(events.runEvent).not.toHaveBeenCalled();
});

test('a preview in an event that has not started asks to START THE EVENT', async () => {
  installFetch('CREATED');
  events.getEvent.mockResolvedValue({ ...viewWith(ITEM), event: { ...viewWith(ITEM).event, state: 'SCHEDULED' } });
  await mountItemStage();
  await screen.findByRole('button', { name: 'Bring everyone here' }, { timeout: 5000 });
  fireEvent.keyDown(window, { key: ' ' });
  const ask = await findAsk();
  expect(ask).toHaveTextContent('Start the event?');
  expect(ask).toHaveTextContent(/Space night/);
  expect(events.runEvent).not.toHaveBeenCalled();
});

// rejects: a guard on the room's own paused item — Bring everyone back stays one step.
test('a paused item offers "Bring everyone back"', async () => {
  installFetch('ASK#002');
  events.getEvent.mockResolvedValue(viewWith({ ...ITEM, state: 'paused' }));
  events.runEvent.mockResolvedValue(viewWith({ ...ITEM, state: 'live' }));
  await mountItemStage();

  fireEvent.click(await screen.findByRole('button', { name: 'Bring everyone back' }, { timeout: 5000 }));
  await waitFor(() => expect(events.runEvent).toHaveBeenCalledWith(CODE, 'resume', ITEM.itemId));
});

/*
  AGENDA AND MAIN MENU ARE TWO PLACES (experience plan §3.6, Phase 2 step 2h:
  the owner's open question from the dock fix). rejects: Main menu taking an
  event's host to the agenda (a second Agenda), Agenda standing in for Main
  menu, and either one pausing anything.
*/
test('Agenda is the Session menu\'s first item: back to the event\'s board, and nothing pauses', async () => {
  installFetch('ASK#002');
  events.getEvent.mockResolvedValue(viewWith({ ...ITEM, state: 'live' }));
  await mountItemStage();

  // Not on the stage itself any more: no AGENDA beside Your part now.
  expect(screen.queryByRole('button', { name: /Back to the event's agenda/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Session menu' }));
  const panel = await screen.findByRole('dialog', { name: 'Session menu' });
  fireEvent.click(within(panel).getByTestId('session-menu-agenda'));
  await waitFor(() => expect(navigateTo).toHaveBeenCalledWith(`/host/event/${CODE}`));
  expect(events.runEvent).not.toHaveBeenCalled();
});

test('Main menu in an event goes home, not to the agenda, asking first with people in the room', async () => {
  installFetch('ASK#002', { players: ['Ada', 'Omar'] });
  events.getEvent.mockResolvedValue(viewWith({ ...ITEM, state: 'live' }));
  await mountItemStage();

  // The room is known (the meter counts two) before Main menu is pressed.
  await waitFor(() => expect(document.querySelector('.stage .main').textContent).toMatch(/\/\s*2/), { timeout: 5000 });
  const mains = screen.getAllByRole('button', { name: 'Main menu' });
  expect(mains).toHaveLength(1);
  fireEvent.click(mains[0]);
  const ask = await screen.findByRole('dialog', { name: 'Leave this session?' }, { timeout: 5000 });
  fireEvent.click(within(ask).getByRole('button', { name: 'Back to Menu' }));
  await waitFor(() => expect(document.querySelector('.stage')).toBeNull(), { timeout: 5000 });
  expect(navigateTo).not.toHaveBeenCalled();
  expect(events.runEvent).not.toHaveBeenCalled();
  // The event is dropped from the page on the way home.
  expect(window.location.search).not.toMatch(/event=/);
});

test('a live item\'s lobby has one Main menu and no round button that leaves beside it', async () => {
  installFetch('STARTED');
  events.getEvent.mockResolvedValue(viewWith({ ...ITEM, state: 'live' }));
  await mountItemStage();

  await waitFor(() => expect(events.getEvent).toHaveBeenCalled());
  expect(screen.getAllByRole('button', { name: 'Main menu' })).toHaveLength(1);
  expect(screen.queryByRole('button', { name: /Back to Menu/ })).toBeNull();
  expect(screen.queryByRole('button', { name: /Back to the event's agenda/ })).toBeNull();
});

/*
  "SET THE RUNNING ORDER" (QA drive 2026-09-29, finding #4). rejects: a
  preview lobby with no way to the running order; that way on a paused item;
  ?panel=questions that does not open the Session panel on Questions, or
  that opens it that way again after it is closed; the panel opening at all
  without the parameter.
*/
test('a preview lobby offers "Set the running order", which opens the Session menu on Up next', async () => {
  installFetch('CREATED');
  events.getEvent.mockResolvedValue(viewWith(ITEM));
  await mountItemStage();

  const door = await screen.findByTestId('preview-running-order', {}, { timeout: 5000 });
  expect(screen.queryByRole('dialog', { name: 'Session menu' })).toBeNull();
  fireEvent.click(within(door).getByRole('button', { name: 'Set the running order' }));
  const panel = await screen.findByRole('dialog', { name: 'Session menu' });
  expect(within(panel).getByRole('tab', { name: 'Up next' })).toHaveAttribute('aria-selected', 'true');
  expect(within(panel).getByText('Running order')).toBeInTheDocument();
});

test('no running-order door on a paused item\'s lobby', async () => {
  installFetch('CREATED');
  events.getEvent.mockResolvedValue(viewWith({ ...ITEM, state: 'paused' }));
  await mountItemStage();
  await screen.findByRole('button', { name: 'Bring everyone back' }, { timeout: 5000 });
  expect(screen.queryByTestId('preview-running-order')).toBeNull();
});

test('?panel=questions lands on the Session panel\'s Up next section, once', async () => {
  installFetch('CREATED');
  events.getEvent.mockResolvedValue(viewWith(ITEM));
  window.history.pushState({}, '', `/host?gameId=${GAME}&event=${CODE}&panel=questions`);
  render(<GameHostPage />);

  const panel = await screen.findByRole('dialog', { name: 'Session menu' }, { timeout: 5000 });
  expect(within(panel).getByRole('tab', { name: 'Up next' })).toHaveAttribute('aria-selected', 'true');
  expect(window.location.search).not.toMatch(/panel=/);
  expect(window.location.search).toMatch(`gameId=${GAME}`);

  // Closed and opened again with SESSION, it is the ordinary panel.
  fireEvent.click(within(panel).getByRole('button', { name: 'Close the Session menu' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Session menu' })).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: 'Session menu' }));
  const again = await screen.findByRole('dialog', { name: 'Session menu' });
  // In an event the ordinary menu opens on Up next too, with the event line above (session-menu D5, F7).
  expect(within(again).getByRole('tab', { name: 'Up next' })).toHaveAttribute('aria-selected', 'true');
  expect(within(again).getByTestId('session-menu-event')).toBeInTheDocument();
});

test('without ?panel= the stage opens with the Session panel shut', async () => {
  installFetch('CREATED');
  events.getEvent.mockResolvedValue(viewWith(ITEM));
  await mountItemStage();
  await screen.findByRole('button', { name: 'Bring everyone here' }, { timeout: 5000 });
  expect(screen.queryByRole('dialog', { name: 'Session menu' })).toBeNull();
});
