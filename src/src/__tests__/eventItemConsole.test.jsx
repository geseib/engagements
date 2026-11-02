/**
 * AN EVENT'S ITEM IN THE CONSOLE (experience plan Phase 2 step 2d; PLAN §3.2a
 * "Event item", §3.2b, §3.6 Agenda, §4.2 row 13, §7 decision 8; audit A §0).
 *
 * rejects: an event's Call & Answer item on two screens drawing the
 * projector-style stage on the private laptop (a third layout); "‹ Agenda"
 * missing from the strip, or put on the top bar; no Agenda in the Session
 * menu; the event moving on with nothing on the Needs-you line; Bring
 * everyone here that does not take this item live; Setup asking again for an
 * item of an event whose screens were set today; a trivia item in an event
 * getting the console before 2g; a standalone session changing at all.
 */
import React from 'react';
import { render, screen, waitFor, fireEvent, within, act } from '@testing-library/react';
import { needsYou, NEEDS_ACTIONS, ACTION_WORDS, kindSummary } from '../config/needsYou';
import {
  EVENT_WORDS, eventMovedOn, latecomersFrom, itemNumber,
  eventScreensSet, markEventScreens, dayOf, ARRIVAL_GRACE_MS,
} from '../config/eventAgenda';
import { consoleFor, CONSOLE_TYPES } from '../config/surfaces';
import { consolePeopleFor } from '../config/consoleRail';
import { ATTENTION_EVENTS } from '../config/attentionEvents';
import WorkflowStrip from '../components/stage/WorkflowStrip';
import { stripFor } from '../config/workflowStrip';
import HW from '../config/hostWords';

const LOAD_WAIT = 30000;
jest.setTimeout(60000);

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
const STARTED = '2026-11-02T09:00:00.000Z';
const FIRST = { itemId: 'it_00000001', type: 'call-and-answer', title: 'Opening', state: 'done', gameId: '1111' };
const ITEM = { itemId: 'it_0000000a', type: 'call-and-answer', title: 'Strategy round', state: 'live', gameId: GAME, startedAt: STARTED };
const THIRD = { itemId: 'it_0000000c', type: 'trivia', title: 'Space night', state: 'planned', gameId: '' };
const viewWith = (item, liveItemId = item.state === 'live' ? item.itemId : '') => ({
  event: { code: CODE, title: 'Q4 Kickoff', state: 'LIVE', liveItemId },
  items: [FIRST, item, THIRD],
});
const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
const FULL = () => ({ open: true, fullscreen: true, visible: true, statusAt: new Date().toISOString() });

let hostState;
let gameType;
let roster;

beforeAll(() => {
  global.ResizeObserver = global.ResizeObserver || class { observe() {} disconnect() {} unobserve() {} };
});

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  jest.clearAllMocks();
  // restoreAllMocks (afterEach) drops a jest.fn's own implementation: set it each time.
  events.listEvents.mockImplementation(async () => []);
  events.getEvent.mockImplementation(async () => viewWith(ITEM));
  window.alert = jest.fn();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  gameType = 'call-and-answer';
  roster = [];
  hostState = {
    state: 'ASK#001',
    currentQuestion: 1,
    gameMetadata: { gameType: 'call-and-answer', title: 'Strategy round' },
    eventRef: CODE,
    presenting: 1,
    presentDetail: FULL(),
  };
  global.fetch = jest.fn(async (url) => {
    const u = String(url);
    if (u.endsWith(`games/${GAME}`)) return ok({ exists: true, started: hostState.state !== 'CREATED', gameType });
    if (u.includes(`games/${GAME}/host-state`)) return ok({ ...hostState, gameMetadata: { ...hostState.gameMetadata, gameType } });
    if (u.endsWith(`games/${GAME}/players`)) return ok({ players: roster });
    if (u.includes(`games/${GAME}/question?role=host`)) return ok({ id: 'q1', title: 'Where do we grow?', questionDetail: 'Name one market.' });
    return ok({});
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  localStorage.clear();
});

const mountItem = async ({ two = true, event = true } = {}) => {
  if (two) localStorage.setItem('engage.surfaces', 'two');
  window.history.pushState({}, '', `/host?gameId=${GAME}${event ? `&event=${CODE}` : ''}`);
  return render(<GameHostPage />);
};
const consoleUp = (container) => waitFor(() => {
  if (!container.querySelector('.hc')) throw new Error('no console');
}, { timeout: LOAD_WAIT });

/* ------------------------------------------------------------- on the page */

describe('an event\'s Call & Answer item on two screens', () => {
  test('gets the same console as a standalone session: top bar, Your part now, Needs-you line, pulse, People', async () => {
    events.getEvent.mockResolvedValue(viewWith(ITEM));
    const { container } = await mountItem();
    await consoleUp(container);
    // The console, not the projector-style stage.
    expect(container.querySelector('.stage')).toBeNull();
    expect(container.querySelector('.hc-top [data-slot="main-menu"]')).toBeTruthy();
    expect(container.querySelector('.hc-top [data-slot="session-menu"]')).toBeTruthy();
    expect(container.querySelector('.hc-now')).toBeTruthy();
    expect(container.querySelector('.hc-needs')).toBeTruthy();
    await waitFor(() => expect(container.querySelector('.hc-pulse')).toBeTruthy(), { timeout: LOAD_WAIT });
    expect(container.querySelector('.hc-rail [data-section="people"]')).toBeTruthy();
    // The join code is the event's: people join the day, never the item.
    expect(within(container.querySelector('.hc-top')).getByRole('button', { name: new RegExp(`^${HW.join} ${CODE}`) })).toBeInTheDocument();
  });

  test('"‹ Agenda" is the strip\'s first crumb, never a top-bar button, and only navigates', async () => {
    events.getEvent.mockResolvedValue(viewWith(ITEM));
    const { container } = await mountItem();
    await consoleUp(container);
    const crumb = await waitFor(() => {
      const el = container.querySelector('.hc-loop [data-testid="agenda-crumb"]');
      if (!el) throw new Error('no crumb');
      return el;
    }, { timeout: LOAD_WAIT });
    expect(crumb.textContent).toBe(EVENT_WORDS.agendaCrumb);
    // First in the steps list.
    expect(container.querySelector('.hc-loop .wfs-steps').firstElementChild.contains(crumb)).toBe(true);
    // Not on the top bar.
    expect(within(container.querySelector('.hc-top')).queryByRole('button', { name: EVENT_WORDS.agenda })).toBeNull();
    fireEvent.click(crumb);
    await waitFor(() => expect(navigateTo).toHaveBeenCalledWith(`/host/event/${CODE}`));
    expect(events.runEvent).not.toHaveBeenCalled();
  });

  test('Main menu goes to the start screen; Agenda is the level up', async () => {
    events.getEvent.mockResolvedValue(viewWith(ITEM));
    const { container } = await mountItem();
    await consoleUp(container);
    fireEvent.click(container.querySelector('.hc-top [data-slot="main-menu"]'));
    await waitFor(() => expect(navigateTo).toHaveBeenCalledWith('/host'));
  });

  test('the Session menu carries Agenda; Bring everyone here only while the room is elsewhere', async () => {
    events.getEvent.mockResolvedValue(viewWith(ITEM));
    const { container } = await mountItem();
    await consoleUp(container);
    fireEvent.click(container.querySelector('.hc-top [data-slot="session-menu"]'));
    const menu = await screen.findByRole('dialog', { name: HW.sessionMenu });
    const group = within(menu).getByRole('group', { name: EVENT_WORDS.menuK });
    expect(within(group).getByRole('button', { name: EVENT_WORDS.agenda })).toBeInTheDocument();
    // This item is the room's: nothing to bring anyone to.
    expect(within(group).queryByRole('button', { name: EVENT_WORDS.bringHere })).toBeNull();
    fireEvent.click(within(group).getByRole('button', { name: EVENT_WORDS.agenda }));
    await waitFor(() => expect(navigateTo).toHaveBeenCalledWith(`/host/event/${CODE}`));
  });

  test('the event moved on: a Now item on the Needs-you line, and Bring everyone here takes this item live again', async () => {
    const paused = { ...ITEM, state: 'paused' };
    events.getEvent.mockResolvedValue(viewWith(paused, THIRD.itemId));
    events.runEvent.mockResolvedValue(viewWith(ITEM));
    const { container } = await mountItem();
    await consoleUp(container);
    const line = await waitFor(() => {
      const el = container.querySelector('.hc-needs');
      if (!el || !/The event moved on to Item 3/.test(el.textContent)) throw new Error('no moved-on item');
      return el;
    }, { timeout: LOAD_WAIT });
    // The crumb is still there with no live steps.
    expect(container.querySelector('.hc-loop [data-testid="agenda-crumb"]')).toBeTruthy();
    // The Session menu offers Bring everyone here too.
    fireEvent.click(container.querySelector('.hc-top [data-slot="session-menu"]'));
    const menu = await screen.findByRole('dialog', { name: HW.sessionMenu });
    expect(within(menu).getByRole('button', { name: EVENT_WORDS.bringHere })).toBeInTheDocument();
    await act(async () => { fireEvent.click(within(line).getByRole('button', { name: ACTION_WORDS.bring })); });
    await waitFor(() => expect(events.runEvent).toHaveBeenCalledWith(CODE, 'resume', ITEM.itemId));
  });

  test('a latecomer reads "from item 2" in People; someone who came across with the item does not', async () => {
    roster = [
      { playerName: 'Ada', joinedAt: '2026-11-02T08:58:00.000Z' },
      { playerName: 'Omar', joinedAt: '2026-11-02T09:20:00.000Z' },
    ];
    hostState = { ...hostState, state: 'RESULTS#001' };
    events.getEvent.mockResolvedValue(viewWith(ITEM));
    const { container } = await mountItem();
    await consoleUp(container);
    await waitFor(() => {
      const people = container.querySelector('.hc-rail [data-section="people"]');
      if (!people || !/Omar · from item 2/.test(people.textContent)) throw new Error('no latecomer');
    }, { timeout: LOAD_WAIT });
    expect(container.querySelector('.hc-rail [data-section="people"]').textContent).not.toMatch(/Ada · from item/);
  });
});

describe('Setup in an event: screens once per day', () => {
  test('the first item of the day asks where the room watches', async () => {
    hostState = { ...hostState, state: 'STARTED', currentQuestion: 0, presenting: 0, presentDetail: null };
    events.getEvent.mockResolvedValue(viewWith(ITEM));
    const { container } = await mountItem({ two: false });
    await waitFor(() => expect(container.querySelector('.hsetup')).toBeTruthy(), { timeout: LOAD_WAIT });
    expect(container.querySelector('.hsetup').getAttribute('data-at')).toBe('where');
    expect(container.querySelector('.hc-loop [data-testid="agenda-crumb"]')).toBeTruthy();
  });

  test('a later item the same day, on one screen, skips the check: no Setup, the lobby itself', async () => {
    localStorage.setItem('engage.surfaces', 'classic');
    markEventScreens(localStorage, CODE);
    hostState = { ...hostState, state: 'STARTED', currentQuestion: 0, presenting: 0, presentDetail: null };
    events.getEvent.mockResolvedValue(viewWith(ITEM));
    const { container } = await mountItem({ two: false });
    // One screen at step 3 is the stage lobby itself (2b): no Setup frame.
    await waitFor(() => expect(container.querySelector('.stage')).toBeTruthy(), { timeout: LOAD_WAIT });
    expect(container.querySelector('.hsetup')).toBeNull();
  });

  test('two screens with the room\'s window up: step 3 straight away, and the day is remembered', async () => {
    hostState = { ...hostState, state: 'STARTED', currentQuestion: 0 };
    events.getEvent.mockResolvedValue(viewWith(ITEM));
    const { container } = await mountItem();
    await waitFor(() => expect(container.querySelector('.hsetup')).toBeTruthy(), { timeout: LOAD_WAIT });
    await waitFor(() => expect(container.querySelector('.hsetup').getAttribute('data-at')).toBe('joins'), { timeout: LOAD_WAIT });
    await waitFor(() => expect(eventScreensSet(localStorage, CODE)).toBe(true));
  });
});

describe('only Call & Answer gets the console; standalone sessions are unchanged', () => {
  test('a trivia item in an event on two screens keeps its stage (2g brings trivia)', async () => {
    gameType = 'trivia';
    hostState = { ...hostState, state: 'ASK#001', gameMetadata: { gameType: 'trivia', title: 'Space night' } };
    events.getEvent.mockResolvedValue(viewWith({ ...ITEM, type: 'trivia' }));
    const { container } = await mountItem();
    await waitFor(() => expect(container.querySelector('.stage')).toBeTruthy(), { timeout: LOAD_WAIT });
    expect(container.querySelector('.hc')).toBeNull();
  });

  test('a standalone Call & Answer session: the console, with no Agenda anywhere', async () => {
    hostState = { ...hostState, eventRef: undefined };
    const { container } = await mountItem({ event: false });
    await consoleUp(container);
    await waitFor(() => expect(container.querySelector('.hc-loop .wfs')).toBeTruthy(), { timeout: LOAD_WAIT });
    expect(container.querySelector('[data-testid="agenda-crumb"]')).toBeNull();
    expect(events.getEvent).not.toHaveBeenCalled();
    fireEvent.click(container.querySelector('.hc-top [data-slot="session-menu"]'));
    const menu = await screen.findByRole('dialog', { name: HW.sessionMenu });
    expect(within(menu).queryByRole('group', { name: EVENT_WORDS.menuK })).toBeNull();
  });
});

/* ---------------------------------------------------------------- the rules */

describe('the rules, without the page', () => {
  test('consoleFor: two screens and Call & Answer only', () => {
    expect(CONSOLE_TYPES).toEqual(['call-and-answer']);
    expect(consoleFor(true, 'call-and-answer')).toBe(true);
    expect(consoleFor(false, 'call-and-answer')).toBe(false);
    ['trivia', 'poll', 'wavelength', 'survey'].forEach((t) => expect(consoleFor(true, t)).toBe(false));
  });

  test('eventMovedOn: only a paused item with another live', () => {
    const items = [FIRST, ITEM, THIRD];
    expect(eventMovedOn({ item: { ...ITEM, state: 'paused' }, items, liveItemId: THIRD.itemId })).toEqual({ n: 3, title: 'Space night' });
    expect(eventMovedOn({ item: { ...ITEM, state: 'paused' }, items, liveItemId: '' })).toBeNull();
    expect(eventMovedOn({ item: { ...ITEM, state: 'planned' }, items, liveItemId: THIRD.itemId })).toBeNull();
    expect(eventMovedOn({ item: { ...ITEM, state: 'done' }, items, liveItemId: THIRD.itemId })).toBeNull();
    expect(eventMovedOn({ item: ITEM, items, liveItemId: ITEM.itemId })).toBeNull();
    expect(itemNumber(items, ITEM.itemId)).toBe(2);
  });

  test('needsYou: the event moved on is a Now item, before name requests, with Bring everyone here', () => {
    const at = new Date().toISOString();
    const needs = needsYou({
      players: [{ name: 'Sam', handover: { requested: true, requestedAt: at } }],
      eventMoved: { n: 3, title: 'Space night' },
    });
    expect(needs.items[0]).toMatchObject({ kind: 'event-moved-on', level: 'now', text: 'The event moved on to Item 3', detail: 'Space night' });
    expect(needs.items[0].actions).toEqual([NEEDS_ACTIONS.BRING]);
    expect(ACTION_WORDS.bring).toBe('Bring everyone here');
    expect(needs.nowCount).toBe(2);
    // Public-safe: by kind, never a title or a name.
    expect(kindSummary(needs)).toMatch(/The event moved on/);
    expect(needsYou({}).items.some((i) => i.kind === 'event-moved-on')).toBe(false);
  });

  test('the attention list and needsYou say the same words for row 13', () => {
    const e = ATTENTION_EVENTS.find((x) => x.id === 'event-moved-on');
    expect(e.needsYouLine).toBe('The event moved on to Item 3');
    expect(needsYou({ eventMoved: { n: 3 } }).items[0].text).toBe(e.needsYouLine);
    expect(e.actions).toEqual([ACTION_WORDS.bring]);
  });

  test('latecomersFrom: joined after the item first went live, past the grace', () => {
    const since = Date.parse(STARTED);
    const from = latecomersFrom({
      item: ITEM,
      n: 2,
      players: [
        { name: 'Ada', joinedAt: new Date(since - 1000).toISOString() },
        { name: 'Ben', joinedAt: new Date(since + ARRIVAL_GRACE_MS - 1).toISOString() },
        { name: 'Omar', joinedAt: new Date(since + ARRIVAL_GRACE_MS + 1000).toISOString() },
      ],
    });
    expect(from).toEqual({ Omar: 'from item 2' });
    expect(latecomersFrom({ item: { ...ITEM, startedAt: undefined }, n: 2, players: [{ name: 'Omar', joinedAt: STARTED }] })).toEqual({});
  });

  test('consolePeopleFor: "from item N" sits in the doing-now slot only when nothing is being done', () => {
    const players = [{ name: 'Omar' }, { name: 'Ada' }];
    const from = { Omar: 'from item 2' };
    expect(consolePeopleFor({ moment: 'RESULTS', players, from })).toEqual([
      { name: 'Omar', state: 'here', from: 'from item 2' },
      { name: 'Ada', state: 'here' },
    ]);
    const writing = consolePeopleFor({ moment: 'ANSWERING', players, from, answeredNames: [], answeredCount: 0, gameType: 'call-and-answer' });
    expect(writing.every((r) => !r.from)).toBe(true);
  });

  test('screens once per event day: today only, per event', () => {
    const store = new Map();
    const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) };
    const now = Date.parse('2026-11-02T10:00:00');
    expect(eventScreensSet(storage, CODE, now)).toBe(false);
    markEventScreens(storage, CODE, now);
    expect(eventScreensSet(storage, CODE, now + 3600 * 1000)).toBe(true);
    expect(eventScreensSet(storage, '9999', now)).toBe(false);
    expect(eventScreensSet(storage, CODE, now + 24 * 3600 * 1000)).toBe(false);
    expect(dayOf(now)).toBe('2026-11-02');
    // A storage that throws is "not set", never a crash.
    expect(eventScreensSet({ getItem: () => { throw new Error('blocked'); } }, CODE, now)).toBe(false);
  });

  test('WorkflowStrip: the crumb leads, and stays with no live steps', () => {
    const onClick = jest.fn();
    const strip = stripFor({ gameType: 'call-and-answer', roundNoun: 'Round', state: 'ASK#002', totalRounds: 6, progress: { received: 1, total: 4 } });
    const { container, rerender } = render(<WorkflowStrip strip={strip} agenda={{ onClick }} />);
    const first = container.querySelector('.wfs-steps').firstElementChild;
    expect(first.textContent).toBe(EVENT_WORDS.agendaCrumb);
    fireEvent.click(screen.getByRole('button', { name: EVENT_WORDS.agenda }));
    expect(onClick).toHaveBeenCalled();
    rerender(<WorkflowStrip strip={null} agenda={{ onClick }} />);
    expect(screen.getByRole('button', { name: EVENT_WORDS.agenda })).toBeInTheDocument();
    rerender(<WorkflowStrip strip={strip} />);
    expect(screen.queryByRole('button', { name: EVENT_WORDS.agenda })).toBeNull();
  });
});
