/**
 * THE POINTS TAB, RESEARCH AND IDEAS, TICKS, SHOW ON STAGE
 * (docs/superpowers/plans/2026-10-09-build-room-talking-points.md, Task 4;
 * mockups docs/design/build-room-talking-points T1-T4).
 *
 * Fixtures go through the REAL build-store.js (roomFromRows + hostView), so
 * the page is tested against the shape GET build/state answers with. No
 * geometric assertions: jsdom has no layout engine.
 */
import React from 'react';
import {
  render, screen, fireEvent, waitFor, within,
} from '@testing-library/react';
import { authFetch, getAuthToken } from '../auth/authFetch';
import BuildRoomPage from '../buildroom/BuildRoomPage';
import { stageModel, pointGroups, whatsNextMoves } from '../buildroom/buildScreens';

jest.mock('../utils/reloadPage', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn(), getAuthToken: jest.fn(async () => 'id-token') }));
jest.mock('../WebSocketClient', () => ({
  __esModule: true,
  default: {
    connect: jest.fn(),
    disconnect: jest.fn(),
    onMessage: jest.fn(),
    offMessage: jest.fn(),
    onReconnected: jest.fn(),
    onConnectionStatusChange: jest.fn(),
    isConnected: jest.fn(() => false),
    ensureConnected: jest.fn(),
  },
}));

const S = require('../../../lambda-functions/game/build-store');

const API = 'https://api.example.test/dev/';
const GAME = '4821';
const NOW = new Date().toISOString();
const ago = (s) => new Date(Date.now() - s * 1000).toISOString();

const FINDING = (n, over = {}) => ({
  PointId: `f${n}`, Kind: 'finding', Text: `Finding number ${n}`, Status: 'new', By: 'claude', ByRole: 'agent',
  BatchId: 'b-research', RequestId: 'rq1', CreatedAt: ago(300 - n),
  Sources: [{ title: 'WCAG 2.2', url: 'https://www.w3.org/TR/WCAG22/' }], ...over,
});
const TALK = (n, over = {}) => ({
  PointId: `t${n}`, Kind: 'talk', Text: `Talking point ${n}`, Status: 'new', By: 'claude', ByRole: 'agent',
  BatchId: `b-step${n}`, About: 'header built', CreatedAt: ago(200 - n), Sources: [], ...over,
});
const IDEA = (n, over = {}) => ({
  PointId: `i${n}`, Kind: 'idea', Text: `Idea number ${n}`, Status: 'new', By: 'Priya', ByRole: 'builder',
  BatchId: 'b-priya', About: 'Parking map', CreatedAt: ago(100 - n), Sources: [], ...over,
});
const REQ = (over = {}) => ({
  ReqId: 'rq1', Kind: 'research', Subject: 'accessible colour contrast', Status: 'done', Count: 3, CreatedAt: ago(320), ...over,
});
const CHOICE = {
  AskId: '003', Kind: 'choice', Prompt: 'Which header should volunteers see first?', Detail: '',
  Options: [{ label: 'A', title: 'Bold banner', detail: '', url: '' }, { label: 'B', title: 'Calm photo', detail: '', url: '' }], MaxPicks: 1,
};

function hostState({
  st = {}, asks = [], points = [], preqs = [], ideas = [], later = [], logs = [],
} = {}) {
  const rows = [
    { SK: 'BUILD#STATE', Rev: 7, AgentSeenAt: ago(6), Phase: 'building', ...(later.length ? { Brief: { later } } : {}), ...st },
    ...asks.map((a) => ({ SK: `BUILD#ASK#${a.AskId}`, Source: 'agent', CreatedAt: ago(600), ...a })),
    ...points.map((p) => ({ SK: `BUILD#POINT#${p.PointId.padStart(13, '0')}`, ...p })),
    ...preqs.map((r) => ({ SK: `BUILD#PREQ#${r.ReqId.padStart(13, '0')}`, ...r })),
    ...ideas.map((d, i) => ({ SK: `BUILD#IDEA#${String(i).padStart(13, '0')}#i${i}`, IdeaId: `${i}-i${i}`, Status: 'new', CreatedAt: ago(120), Source: 'room', ...d })),
    ...logs.map((l, i) => ({ SK: `BUILD#LOG#${String(i).padStart(13, '0')}#x${i}`, LogId: `${i}-x${i}`, CreatedAt: ago(900 - i * 60), ...l })),
  ];
  return S.hostView({
    gameId: GAME,
    meta: { Title: 'Volunteer sign-up', Details: 'A one-page site to pick a shift in a minute.' },
    sessionState: 'STARTED',
    room: S.roomFromRows(rows),
    players: ['Ana', 'Dee', 'Priya', 'Sam'],
    now: NOW,
  });
}

let current;
let calls;
const res = (data, ok = true, status = 200) => ({ ok, status, json: async () => data });

function serve(state) {
  current = state;
  calls = [];
  authFetch.mockImplementation(async (url, opts = {}) => {
    const method = opts.method || 'GET';
    const body = opts.body ? JSON.parse(opts.body) : undefined;
    calls.push({ url, method, body });
    if (method === 'GET' && url.endsWith('/build/state')) return res(current);
    if (url.endsWith('/host-ticket')) return res({ ticket: 't' });
    return res({ ok: true, ask: {}, request: {}, point: {}, sent: [] }, true, 201);
  });
}
const posts = () => calls.filter((c) => c.method === 'POST' && !c.url.endsWith('/host-ticket'));
const path = (c) => c.url.slice(API.length + `games/${GAME}/build/`.length);
const postsTo = (p) => posts().filter((c) => path(c) === p);

async function openRoom(state) {
  serve(state);
  window.history.pushState({}, '', `/build?gameId=${GAME}`);
  render(<BuildRoomPage />);
  await screen.findByText('Volunteer sign-up');
}

/** The orange buttons on the Host screen, outside any dialog (the existing counting rule). */
const oranges = () => [...document.querySelectorAll('.brm-host .brm-btn--primary, .brm-host .bwh-spin:not(.bwh-spin--sec)')]
  .filter((b) => !b.closest('[role="dialog"], .brm-modal'));
const panel = () => screen.getByRole('region', { name: 'Points' });
const tick = (text) => fireEvent.click(within(panel()).getByRole('checkbox', { name: `Tick: ${text}` }));

beforeEach(() => {
  window.API_BASE = API;
  jest.clearAllMocks();
  getAuthToken.mockImplementation(async () => 'id-token');
});

/** Between asks: one ask already decided, so What's next (not the starter question) holds the orange. */
const DECIDED = { ...CHOICE, Status: 'decided', DecidedAt: ago(240), Decision: { direction: 'Go', chosen: ['B'], note: '' } };
const RESEARCH_STATE = (over = {}) => hostState({
  asks: [DECIDED], points: [FINDING(1), FINDING(2), FINDING(3)], preqs: [REQ()], ...over,
});

describe('the Points tab beside Later', () => {
  test('both tabs show; Points opens by itself when points are the only thing held', async () => {
    await openRoom(RESEARCH_STATE());
    const tabs = screen.getByRole('tablist');
    expect(within(tabs).getByRole('tab', { name: /^Later/ })).toBeInTheDocument();
    const pointsTab = within(tabs).getByRole('tab', { name: /^Points 3/ });
    expect(pointsTab).toHaveAttribute('aria-selected', 'true');
    expect(pointsTab.textContent).toMatch('3 new');
    expect(screen.getByText('The room sees none of these')).toBeInTheDocument();
  });

  test('Later stays first when it has items; the other tab is one click away', async () => {
    await openRoom(RESEARCH_STATE({ later: [{ id: 'l1', text: 'Check the dates', at: ago(50) }] }));
    expect(screen.getByRole('tab', { name: /^Later/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('region', { name: 'Points' })).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: /^Points/ }));
    expect(panel()).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /^Later/ }));
    expect(screen.getByRole('region', { name: 'Later' })).toBeInTheDocument();
  });

  test('empty: says what Research and Ideas do', async () => {
    await openRoom(hostState());
    fireEvent.click(screen.getByRole('tab', { name: /^Points/ }));
    expect(within(panel()).getByText(/No points yet\./)).toBeInTheDocument();
    expect(within(panel()).getByRole('button', { name: 'Research…' })).toBeInTheDocument();
    expect(within(panel()).getByRole('button', { name: 'Ideas…' })).toBeInTheDocument();
  });

  test('a room whose server sent no points shows Later alone, as before', async () => {
    const state = hostState({ later: [{ id: 'l1', text: 'Check the dates', at: ago(50) }] });
    delete state.points;
    await openRoom(state);
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.getByRole('region', { name: 'Later' })).toBeInTheDocument();
  });

  test('groups by request, shows two points and opens the rest; sources are links only when http(s)', async () => {
    await openRoom(RESEARCH_STATE({
      points: [FINDING(1), FINDING(2), FINDING(3, { Sources: [{ title: 'Evil', url: 'javascript:alert(1)' }] }), TALK(1), IDEA(1)],
    }));
    const group = within(panel()).getByRole('group', { name: 'Research: accessible colour contrast · 3 findings' });
    expect(within(group).getAllByRole('checkbox', { name: /^Tick: Finding/ })).toHaveLength(2);
    const link = within(group).getAllByRole('link')[0];
    expect(link).toHaveAttribute('href', 'https://www.w3.org/TR/WCAG22/');
    expect(link.textContent).toMatch('w3.org');
    fireEvent.click(within(group).getByRole('button', { name: '1 more finding' }));
    expect(within(group).getAllByRole('checkbox', { name: /^Tick: Finding/ })).toHaveLength(3);
    // The javascript: link is text-free: no anchor carries it.
    expect(document.querySelector('a[href^="javascript"]')).toBeNull();
    expect(within(panel()).getByRole('group', { name: 'From step: header built · 1 point' })).toBeInTheDocument();
    expect(within(panel()).getByRole('group', { name: "Priya's Claude · 1 idea for Parking map" })).toBeInTheDocument();
  });

  test('a point already used says so, and cannot be ticked again', async () => {
    await openRoom(RESEARCH_STATE({ points: [FINDING(1, { Status: 'sent' }), FINDING(2)] }));
    expect(within(panel()).getByText('Sent to Claude')).toBeInTheDocument();
    expect(within(panel()).queryByRole('checkbox', { name: 'Tick: Finding number 1' })).toBeNull();
  });

  test('Remove posts remove for that point', async () => {
    await openRoom(RESEARCH_STATE());
    fireEvent.click(within(panel()).getAllByRole('button', { name: 'Remove' })[0]);
    await waitFor(() => expect(postsTo('points/f1')).toHaveLength(1));
    expect(postsTo('points/f1')[0].body).toEqual({ action: 'remove' });
  });

  test('forty open points: the panel says so', async () => {
    const many = Array.from({ length: 40 }, (_, i) => TALK(i + 1, { PointId: `t${i + 1}` }));
    await openRoom(hostState({ points: many }));
    expect(within(panel()).getByText('40 at most. Remove some first.')).toBeInTheDocument();
  });
});

describe('Research… and Ideas…', () => {
  test('Research opens a window prefilled from the open ask, and Send posts the request', async () => {
    await openRoom(hostState({ st: { CurrentAskId: '003' }, asks: [{ ...CHOICE, Status: 'live' }] }));
    fireEvent.click(screen.getByRole('tab', { name: /^Points/ }));
    fireEvent.click(within(panel()).getByRole('button', { name: 'Research…' }));
    const dlg = screen.getByRole('dialog');
    const box = within(dlg).getByLabelText('What should Claude look up?');
    expect(box).toHaveValue('Which header should volunteers see first?');
    fireEvent.change(box, { target: { value: 'accessible colour contrast' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Send to Claude' }));
    await waitFor(() => expect(postsTo('points/requests')).toHaveLength(1));
    expect(postsTo('points/requests')[0].body).toEqual({ kind: 'research', subject: 'accessible colour contrast' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  test('with no ask, the subject comes from Claude\'s last step; Ctrl Enter sends', async () => {
    await openRoom(hostState({ logs: [{ Kind: 'milestone', By: 'agent', Text: 'header built' }] }));
    fireEvent.click(screen.getByRole('tab', { name: /^Points/ }));
    fireEvent.click(within(panel()).getByRole('button', { name: 'Ideas…' }));
    const box = within(screen.getByRole('dialog')).getByLabelText('Ideas about what?');
    expect(box).toHaveValue('header built');
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(postsTo('points/requests')).toHaveLength(1));
    expect(postsTo('points/requests')[0].body).toEqual({ kind: 'ideas', subject: 'header built' });
  });

  test('Send needs a subject; Close leaves without sending', async () => {
    await openRoom(hostState());
    fireEvent.click(screen.getByRole('tab', { name: /^Points/ }));
    fireEvent.click(within(panel()).getByRole('button', { name: 'Research…' }));
    const dlg = screen.getByRole('dialog');
    expect(within(dlg).getByRole('button', { name: 'Send to Claude' })).toBeDisabled();
    const closers = within(dlg).getAllByRole('button', { name: 'Close' });
    fireEvent.click(closers[closers.length - 1]);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(postsTo('points/requests')).toHaveLength(0);
  });

  test('Claude not connected: the window says it will wait, and still sends', async () => {
    await openRoom(hostState({ st: { AgentSeenAt: undefined } }));
    fireEvent.click(screen.getByRole('tab', { name: /^Points/ }));
    fireEvent.click(within(panel()).getByRole('button', { name: 'Ideas…' }));
    const dlg = screen.getByRole('dialog');
    expect(within(dlg).getByText('Claude starts when it reconnects.')).toBeInTheDocument();
    fireEvent.change(within(dlg).getByLabelText('Ideas about what?'), { target: { value: 'where it goes next' } });
    expect(within(dlg).getByRole('button', { name: 'Send to Claude' })).not.toBeDisabled();
  });

  test('exactly one orange button in the open window', async () => {
    await openRoom(hostState());
    fireEvent.click(screen.getByRole('tab', { name: /^Points/ }));
    fireEvent.click(within(panel()).getByRole('button', { name: 'Research…' }));
    const dlg = screen.getByRole('dialog');
    expect(dlg.querySelectorAll('.brm-btn--primary')).toHaveLength(1);
  });

  test('a working request shows its chip; a waiting one for a Claude that is away says so; Cancel posts cancel', async () => {
    await openRoom(hostState({
      st: { AgentSeenAt: undefined },
      preqs: [REQ({ ReqId: 'a1', Status: 'working', Subject: 'keyboard support' }), REQ({ ReqId: 'a2', Kind: 'ideas', Status: 'waiting', Subject: 'parking costs' })],
    }));
    fireEvent.click(screen.getByRole('tab', { name: /^Points/ }));
    expect(within(panel()).getByText('Claude is researching: keyboard support')).toBeInTheDocument();
    expect(within(panel()).getByText('Ideas waits: parking costs.')).toBeInTheDocument();
    fireEvent.click(within(panel()).getAllByRole('button', { name: 'Cancel' })[1]);
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(path(posts()[0])).toMatch(/^points\/requests\/a[12]$/);
    expect(posts()[0].body).toEqual({ action: 'cancel' });
  });

  test('a waiting request while Claude is connected reads as in progress, not as a wait', async () => {
    await openRoom(hostState({ preqs: [REQ({ ReqId: 'a2', Kind: 'ideas', Status: 'waiting', Subject: 'parking costs' })] }));
    fireEvent.click(screen.getByRole('tab', { name: /^Points/ }));
    expect(within(panel()).getByText('Claude is finding ideas: parking costs')).toBeInTheDocument();
  });

  test('a finished request leaves no chip', async () => {
    await openRoom(RESEARCH_STATE());
    expect(within(panel()).queryByLabelText('Requests')).toBeNull();
  });
});

describe('ticks and the action row', () => {
  test('nothing ticked: no action row', async () => {
    await openRoom(RESEARCH_STATE());
    expect(within(panel()).queryByRole('button', { name: 'Clear' })).toBeNull();
  });

  test('one ticked: Send to Claude is the orange; vote is disabled and says why', async () => {
    await openRoom(RESEARCH_STATE());
    tick('Finding number 1');
    const row = within(panel());
    expect(row.getByRole('button', { name: 'Send to Claude' }).className).toMatch('brm-btn--primary');
    expect(row.getByRole('button', { name: 'Put 1 to a vote' })).toBeDisabled();
    expect(row.getByRole('button', { name: 'Put 1 to a vote' })).toHaveAttribute('title', 'Tick 2 to 8');
    expect(row.getByRole('button', { name: 'Show on Stage' })).not.toBeDisabled();
    expect(row.getByText(/Ctrl Enter sends/)).toBeInTheDocument();
    expect(row.queryByText(/Press Space/)).toBeNull();
    fireEvent.click(row.getByRole('button', { name: 'Send to Claude' }));
    await waitFor(() => expect(postsTo('points/f1')).toHaveLength(1));
    expect(postsTo('points/f1')[0].body).toEqual({ action: 'send' });
  });

  test('two ticked: Put 2 to a vote is the orange; Show on Stage is off; Send these 2 is secondary', async () => {
    await openRoom(RESEARCH_STATE());
    tick('Finding number 1');
    tick('Finding number 2');
    const row = within(panel());
    expect(row.getByRole('button', { name: 'Put 2 to a vote' }).className).toMatch('brm-btn--primary');
    expect(row.getByRole('button', { name: 'Send these 2 to Claude' }).className).not.toMatch('brm-btn--primary');
    const show = row.getByRole('button', { name: 'Show on Stage' });
    expect(show).toBeDisabled();
    expect(show).toHaveAttribute('title', 'One point at a time on the Stage');
    expect(row.getByText(/Ctrl Enter puts them to a vote/)).toBeInTheDocument();
    expect(row.queryByText(/Press Space/)).toBeNull();
  });

  test('the main button is last on the right in both states', async () => {
    await openRoom(RESEARCH_STATE());
    tick('Finding number 1');
    const last = () => [...panel().querySelectorAll('.brm-arow > .brm-btn')].pop();
    expect(last().textContent).toBe('Send to Claude');
    tick('Finding number 2');
    expect(last().textContent).toBe('Put 2 to a vote');
  });

  test('Send these 2 posts one send for both; Put 2 posts the vote with the ids', async () => {
    await openRoom(RESEARCH_STATE());
    tick('Finding number 1');
    tick('Finding number 2');
    fireEvent.click(within(panel()).getByRole('button', { name: 'Send these 2 to Claude' }));
    await waitFor(() => expect(postsTo('points/send')).toHaveLength(1));
    expect(postsTo('points/send')[0].body).toEqual({ ids: ['f1', 'f2'] });
  });

  test('Put 2 to a vote opens the window; nothing is posted until Open voting (the window is Task 5)', async () => {
    await openRoom(RESEARCH_STATE());
    tick('Finding number 1');
    tick('Finding number 2');
    fireEvent.click(within(panel()).getByRole('button', { name: 'Put 2 to a vote' }));
    expect(await screen.findByRole('dialog', { name: 'Put 2 to a vote' })).toBeInTheDocument();
    expect(postsTo('points/vote')).toHaveLength(0);
  });

  test('Save for later posts later for each ticked point; Show on Stage posts show for one', async () => {
    await openRoom(RESEARCH_STATE());
    tick('Finding number 1');
    tick('Finding number 2');
    fireEvent.click(within(panel()).getByRole('button', { name: 'Save for later' }));
    await waitFor(() => expect(posts()).toHaveLength(2));
    expect(posts().map((c) => [path(c), c.body.action])).toEqual([['points/f1', 'later'], ['points/f2', 'later']]);
  });

  test('Show on Stage with one ticked', async () => {
    await openRoom(RESEARCH_STATE());
    tick('Finding number 2');
    fireEvent.click(within(panel()).getByRole('button', { name: 'Show on Stage' }));
    await waitFor(() => expect(postsTo('points/f2')).toHaveLength(1));
    expect(postsTo('points/f2')[0].body).toEqual({ action: 'show' });
  });

  test('ticking a group heading ticks all its open points; Clear empties the row', async () => {
    await openRoom(RESEARCH_STATE({ points: [FINDING(1), FINDING(2), FINDING(3, { Status: 'sent' })] }));
    fireEvent.click(within(panel()).getByRole('checkbox', { name: /^Tick all:/ }));
    expect(within(panel()).getByRole('button', { name: 'Put 2 to a vote' })).toBeInTheDocument();
    fireEvent.click(within(panel()).getByRole('button', { name: 'Clear' }));
    expect(within(panel()).queryByRole('button', { name: 'Clear' })).toBeNull();
  });

  test('more than 8 ticked: the vote says it takes at most 8', async () => {
    const nine = Array.from({ length: 9 }, (_, i) => FINDING(i + 1, { PointId: `f${i + 1}` }));
    await openRoom(hostState({ points: nine, preqs: [REQ()] }));
    fireEvent.click(within(panel()).getByRole('checkbox', { name: /^Tick all:/ }));
    expect(within(panel()).getByRole('button', { name: 'Put 9 to a vote' })).toBeDisabled();
  });
});

describe('one orange on the whole Host screen, with Points', () => {
  const states = {
    'points arrive, nothing ticked': () => RESEARCH_STATE(),
    'points arrive and Claude is not connected': () => RESEARCH_STATE({ st: { AgentSeenAt: undefined } }),
    'a request waiting': () => RESEARCH_STATE({ preqs: [REQ({ Status: 'waiting' })] }),
    'the Later tab with points held': () => RESEARCH_STATE({ later: [{ id: 'l1', text: 'x', at: ago(5) }] }),
  };
  test.each(Object.keys(states))('exactly one orange: %s', async (name) => {
    await openRoom(states[name]());
    expect(oranges()).toHaveLength(1);
  });

  test('one ticked: the row holds the one orange and What\'s next leads in outline', async () => {
    await openRoom(RESEARCH_STATE());
    expect(oranges()[0].textContent).toBe('Ask');
    tick('Finding number 1');
    expect(oranges().map((b) => b.textContent)).toEqual(['Send to Claude']);
    tick('Finding number 1');
    expect(oranges().map((b) => b.textContent)).toEqual(['Ask']);
  });

  test('two ticked: Put 2 to a vote is the only orange', async () => {
    await openRoom(RESEARCH_STATE());
    tick('Finding number 1');
    tick('Finding number 2');
    expect(oranges().map((b) => b.textContent)).toEqual(['Put 2 to a vote']);
  });

  test('Space never fires the Points row: an accidental tick plus Space does nothing', async () => {
    await openRoom(RESEARCH_STATE());
    tick('Finding number 1');
    fireEvent.keyDown(window, { key: ' ' });
    tick('Finding number 2');
    fireEvent.keyDown(window, { key: ' ' });
    await new Promise((r) => setTimeout(r, 50));
    expect(posts()).toHaveLength(0);
    expect(within(panel()).getByRole('button', { name: 'Put 2 to a vote' })).toHaveAttribute('data-no-space');
  });

  test('Ctrl Enter on the Host screen presses the row\'s primary: Send with one, the vote with two', async () => {
    await openRoom(RESEARCH_STATE());
    tick('Finding number 1');
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(postsTo('points/f1')).toHaveLength(1));
    expect(postsTo('points/f1')[0].body).toEqual({ action: 'send' });
  });

  test('Cmd Enter puts two to a vote', async () => {
    await openRoom(RESEARCH_STATE());
    tick('Finding number 1');
    tick('Finding number 2');
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true });
    expect(await screen.findByRole('dialog', { name: 'Put 2 to a vote' })).toBeInTheDocument();
  });

  test('Ctrl Enter does nothing while typing, with a dialog open, or when the row does not lead', async () => {
    await openRoom(RESEARCH_STATE());
    tick('Finding number 1');
    const box = screen.getByLabelText('Tell Claude, or log what the room said');
    box.focus();
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true });
    box.blur();
    const dlg = document.createElement('div');
    dlg.setAttribute('role', 'dialog');
    dlg.setAttribute('aria-modal', 'true');
    document.body.appendChild(dlg);
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });
    dlg.remove();
    await new Promise((r) => setTimeout(r, 50));
    expect(postsTo('points/f1')).toHaveLength(0);
  });

  test('Ctrl Enter does nothing while an ask holds the orange', async () => {
    await openRoom(hostState({ st: { CurrentAskId: '003' }, asks: [{ ...CHOICE, Status: 'live' }], points: [FINDING(1), FINDING(2)], preqs: [REQ()] }));
    fireEvent.click(screen.getByRole('tab', { name: /^Points/ }));
    tick('Finding number 1');
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });
    await new Promise((r) => setTimeout(r, 50));
    expect(postsTo('points/f1')).toHaveLength(0);
  });

  test('while an ask is open its step keeps the orange; the row\'s main button is outline', async () => {
    await openRoom(hostState({ st: { CurrentAskId: '003' }, asks: [{ ...CHOICE, Status: 'live' }], points: [FINDING(1), FINDING(2)], preqs: [REQ()] }));
    fireEvent.click(screen.getByRole('tab', { name: /^Points/ }));
    const before = oranges().map((b) => b.textContent);
    expect(before).toHaveLength(1);
    tick('Finding number 1');
    expect(oranges().map((b) => b.textContent)).toEqual(before);
    expect(within(panel()).getByRole('button', { name: 'Send to Claude' }).className).not.toMatch('brm-btn--primary');
    tick('Finding number 2');
    expect(oranges().map((b) => b.textContent)).toEqual(before);
    expect(within(panel()).getByRole('button', { name: 'Put 2 to a vote' }).className).not.toMatch('brm-btn--primary');
  });

  test('a proposed ask waiting: ticking hands the orange to the row', async () => {
    await openRoom(hostState({ asks: [{ ...CHOICE, Status: 'proposed' }], points: [FINDING(1)], preqs: [REQ()] }));
    expect(oranges().map((b) => b.textContent)).toEqual(['Open it']);
    tick('Finding number 1');
    expect(oranges().map((b) => b.textContent)).toEqual(['Send to Claude']);
  });

  test('the starter question holds the orange; the row stays outline', async () => {
    const state = hostState({ points: [FINDING(1)], preqs: [REQ()] });
    await openRoom(state);
    // No asks at all: the starter's "I'll list the options" is the orange.
    const before = oranges().map((b) => b.textContent);
    expect(before).toHaveLength(1);
    tick('Finding number 1');
    expect(oranges().map((b) => b.textContent)).toEqual(before);
  });

  test('a point on the Stage: the Host card adds no second orange', async () => {
    await openRoom(RESEARCH_STATE({ points: [FINDING(1, { Status: 'shown' }), FINDING(2)] }));
    expect(oranges()).toHaveLength(1);
  });
});

describe('What\'s next points at the tab', () => {
  test('three or more new points: a secondary move, never the lead', () => {
    const room = hostState({ points: [TALK(1), TALK(2), TALK(3)] });
    const moves = whatsNextMoves(room);
    const m = moves.find((x) => x.key === 'talk-points');
    expect(m.title).toBe('Talk over a point');
    expect(moves[0].key).not.toBe('talk-points');
  });

  test('two new points: no such move', () => {
    expect(whatsNextMoves(hostState({ points: [TALK(1), TALK(2)] })).some((x) => x.key === 'talk-points')).toBe(false);
  });

  test('its button opens the Points tab', async () => {
    await openRoom(hostState({
      asks: [{ ...CHOICE, Status: 'decided', DecidedAt: ago(240), Decision: { direction: 'Go', chosen: ['B'], note: '' } }],
      points: [TALK(1), TALK(2), TALK(3)], later: [{ id: 'l1', text: 'x', at: ago(5) }],
    }));
    expect(screen.getByRole('tab', { name: /^Later/ })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Points' }));
    expect(screen.getByRole('tab', { name: /^Points/ })).toHaveAttribute('aria-selected', 'true');
  });
});

describe('a point on the Stage', () => {
  const SHOWN = (over = {}) => FINDING(1, { Status: 'shown', Text: 'Mid oranges on white come out near 2:1.', Sources: [{ title: 'Contrast checker', url: 'https://webaim.org/resources/contrastchecker/' }], ...over });
  const IDEAS_ON = (n) => Array.from({ length: n }, (_, i) => ({ Text: `Room idea ${i + 1}`, PlayerName: ['Ana', 'Dee', 'Sam', 'Priya'][i], AboutPoint: 'f1' }));

  test('stageModel: the point, the meter, Take it down leads, Save for later beside it', () => {
    const room = hostState({ points: [SHOWN()], preqs: [REQ()], ideas: IDEAS_ON(2) });
    const m = stageModel(room, null, Date.now());
    expect(m.point.text).toMatch('Mid oranges');
    expect(m.meter).toEqual({ heading: 'Ideas on this', count: 2, of: null });
    // The heading already says Talk it over: the Stage's status line is empty (copy pass 2026-10-10).
    expect(m.status).toBe('');
    expect(m.primary).toMatchObject({ action: 'take-down', label: 'Take it down' });
    expect(m.secondary).toMatchObject({ action: 'point-later', label: 'Save for later' });
  });

  test('stageModel: a live ask outranks the point', () => {
    const room = hostState({ st: { CurrentAskId: '003' }, asks: [{ ...CHOICE, Status: 'live' }], points: [SHOWN()], preqs: [REQ()] });
    const cur = room.asks.find((a) => a.askId === '003');
    expect(stageModel(room, cur, Date.now()).point).toBeUndefined();
  });

  test('the Host screen shows the point that is up, with the same two moves', async () => {
    await openRoom(RESEARCH_STATE({ points: [SHOWN()] }));
    const card = screen.getByRole('region', { name: 'A point is up for the room' });
    expect(within(card).getByText('Mid oranges on white come out near 2:1.')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Take it down' })).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Save for later' })).toBeInTheDocument();
  });

  test('Take it down with 0 or 1 ideas takes it down at once', async () => {
    await openRoom(RESEARCH_STATE({ points: [SHOWN()], ideas: IDEAS_ON(1) }));
    fireEvent.click(within(screen.getByRole('region', { name: 'A point is up for the room' })).getByRole('button', { name: 'Take it down' }));
    await waitFor(() => expect(postsTo('points/f1')).toHaveLength(1));
    expect(postsTo('points/f1')[0].body).toEqual({ action: 'hide' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('Take it down with 2 or more ideas asks first; Not now takes it down and nothing else', async () => {
    await openRoom(RESEARCH_STATE({ points: [SHOWN()], ideas: IDEAS_ON(4) }));
    fireEvent.click(within(screen.getByRole('region', { name: 'A point is up for the room' })).getByRole('button', { name: 'Take it down' }));
    const dlg = await screen.findByRole('dialog', { name: 'Put the 4 ideas to a vote?' });
    expect(postsTo('points/f1')).toHaveLength(0);
    // The ideas are the options; who sent them never shows.
    expect(within(dlg).getByText('Room idea 3')).toBeInTheDocument();
    expect(dlg.textContent).not.toMatch(/Ana|Dee|Sam|Priya/);
    expect(dlg.querySelectorAll('.brm-btn--primary')).toHaveLength(1);
    fireEvent.click(within(dlg).getByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(postsTo('points/f1')).toHaveLength(1));
    expect(postsTo('points/f1')[0].body).toEqual({ action: 'hide' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  test('Put to a vote takes it down and opens the vote window with the ideas and 3 picks', async () => {
    await openRoom(RESEARCH_STATE({ points: [SHOWN()], ideas: IDEAS_ON(4) }));
    fireEvent.click(within(screen.getByRole('region', { name: 'A point is up for the room' })).getByRole('button', { name: 'Take it down' }));
    const dlg = await screen.findByRole('dialog', { name: 'Put the 4 ideas to a vote?' });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Put to a vote' }));
    await waitFor(() => expect(postsTo('points/f1')).toHaveLength(1));
    const vote = await screen.findByRole('dialog', { name: 'Put 4 ideas to a vote' });
    expect(within(vote).getByRole('radio', { name: 'Pick up to 3' })).toHaveAttribute('aria-checked', 'true');
  });

  test('Save for later on the card posts later', async () => {
    await openRoom(RESEARCH_STATE({ points: [SHOWN()] }));
    fireEvent.click(within(screen.getByRole('region', { name: 'A point is up for the room' })).getByRole('button', { name: 'Save for later' }));
    await waitFor(() => expect(postsTo('points/f1')).toHaveLength(1));
    expect(postsTo('points/f1')[0].body).toEqual({ action: 'later' });
  });

  test('the Stage shows where it came from, the text, the source and the prompt; no names', async () => {
    await openRoom(RESEARCH_STATE({ points: [SHOWN({ Detail: 'host-only detail' })], ideas: IDEAS_ON(2) }));
    fireEvent.keyDown(window, { key: '2' });
    const stage = await screen.findByRole('region', { name: 'Talk it over' });
    expect(stage.textContent).toMatch("From Claude's research");
    expect(within(stage).getByText('Mid oranges on white come out near 2:1.')).toBeInTheDocument();
    expect(within(stage).getByText('Source: webaim.org')).toBeInTheDocument();
    expect(within(stage).getByText(/Talk it over\. Send an idea\./)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch('host-only detail');
    expect(document.body.textContent).not.toMatch(/\bAna\b|\bDee\b/);
    expect(screen.getByRole('button', { name: 'Take it down' })).toBeInTheDocument();
    expect(screen.getAllByText('Talk it over').length).toBeGreaterThan(0);
    expect(screen.queryByText('A point is up for the room')).toBeNull();
  });

  test('a builder\'s point is labelled with the builder, nothing else', async () => {
    await openRoom(RESEARCH_STATE({ points: [IDEA(1, { Status: 'shown' })], preqs: [] }));
    fireEvent.keyDown(window, { key: '2' });
    const stage = await screen.findByRole('region', { name: 'Talk it over' });
    expect(stage.textContent).toMatch("From Priya's Claude");
  });

  test('Space on the Stage takes it down', async () => {
    await openRoom(RESEARCH_STATE({ points: [SHOWN()] }));
    fireEvent.keyDown(window, { key: '2' });
    await screen.findByRole('region', { name: 'Talk it over' });
    fireEvent.keyDown(window, { key: ' ' });
    await waitFor(() => expect(postsTo('points/f1')).toHaveLength(1));
    expect(postsTo('points/f1')[0].body).toEqual({ action: 'hide' });
  });

  test('the Stage\'s Save for later puts the point on Later', async () => {
    await openRoom(RESEARCH_STATE({ points: [SHOWN()] }));
    fireEvent.keyDown(window, { key: '2' });
    await screen.findByRole('region', { name: 'Talk it over' });
    fireEvent.click(screen.getByRole('button', { name: 'Save for later' }));
    await waitFor(() => expect(postsTo('points/f1')).toHaveLength(1));
    expect(postsTo('points/f1')[0].body).toEqual({ action: 'later' });
  });

  test('on the Stage, Take it down with 2 ideas offers the vote there too', async () => {
    await openRoom(RESEARCH_STATE({ points: [SHOWN()], ideas: IDEAS_ON(3) }));
    fireEvent.keyDown(window, { key: '2' });
    await screen.findByRole('region', { name: 'Talk it over' });
    fireEvent.click(screen.getByRole('button', { name: 'Take it down' }));
    expect(await screen.findByRole('dialog', { name: 'Put the 3 ideas to a vote?' })).toBeInTheDocument();
  });
});

describe('pointGroups', () => {
  test('newest group first; a builder\'s point carries the builder', () => {
    const room = hostState({ points: [FINDING(1), IDEA(1)], preqs: [REQ()] });
    const groups = pointGroups(room);
    expect(groups.map((g) => g.heading)).toEqual(["Priya's Claude · 1 idea for Parking map", 'Research: accessible colour contrast · 1 finding']);
    expect(groups[0].by).toBe("Priya's Claude");
  });
});

describe('fix round 1', () => {
  test('I3: Show on Stage is off while an ask is current', async () => {
    await openRoom(hostState({ st: { CurrentAskId: '003' }, asks: [{ ...CHOICE, Status: 'live' }], points: [FINDING(1)], preqs: [REQ()] }));
    fireEvent.click(screen.getByRole('tab', { name: /^Points/ }));
    tick('Finding number 1');
    const show = within(panel()).getByRole('button', { name: 'Show on Stage' });
    expect(show).toBeDisabled();
    expect(show).toHaveAttribute('title', 'Finish the open question first');
    fireEvent.click(show);
    expect(postsTo('points/f1')).toHaveLength(0);
  });

  test('I4: a finished request that brought nothing back says so, and can be hidden', async () => {
    await openRoom(hostState({ points: [TALK(1)], preqs: [REQ({ ReqId: 'n1', Subject: 'salary by street', Status: 'done', Count: 0 }), REQ({ ReqId: 'n2', Kind: 'ideas', Subject: 'next steps', Status: 'done', Count: 0 })] }));
    expect(within(panel()).getByText('Research found nothing it could source on "salary by street".')).toBeInTheDocument();
    expect(within(panel()).getByText('Ideas found nothing to suggest on "next steps".')).toBeInTheDocument();
    fireEvent.click(within(panel()).getAllByRole('button', { name: 'Hide' })[0]);
    expect(within(panel()).getAllByRole('button', { name: 'Hide' })).toHaveLength(1);
  });

  test('I4: a finished request with findings has no such chip', async () => {
    await openRoom(hostState({ points: [FINDING(1)], preqs: [REQ({ Count: 1 })] }));
    expect(within(panel()).queryByText(/found nothing/)).toBeNull();
  });

  test('I5: What\'s next sending the host to Points clears the Later ticks', async () => {
    await openRoom(hostState({
      asks: [DECIDED], points: [TALK(1), TALK(2), TALK(3)],
      later: [{ id: 'l1', text: 'Check the dates', at: ago(50) }, { id: 'l2', text: 'Check the colours', at: ago(40) }],
    }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Tick: Check the dates' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Tick: Check the colours' }));
    expect(screen.getByRole('button', { name: 'Put 2 to a vote' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Points' }));
    fireEvent.click(screen.getByRole('tab', { name: /^Later/ }));
    expect(screen.queryByText('2 ticked')).toBeNull();
  });

  test('forty open points: Research and Ideas are off and say why', async () => {
    const many = Array.from({ length: 40 }, (_, i) => TALK(i + 1, { PointId: `t${i + 1}` }));
    await openRoom(hostState({ points: many }));
    const r = within(panel()).getByRole('button', { name: 'Research…' });
    expect(r).toBeDisabled();
    expect(r).toHaveAttribute('title', '40 at most. Remove some first.');
    expect(within(panel()).getByRole('button', { name: 'Ideas…' })).toBeDisabled();
  });

  test('a point in a vote cannot be removed', async () => {
    await openRoom(RESEARCH_STATE({ points: [FINDING(1, { Status: 'voting' }), FINDING(2)] }));
    expect(within(panel()).getAllByRole('button', { name: 'Remove' })).toHaveLength(1);
  });

  test('source links say they open in a new tab', async () => {
    await openRoom(RESEARCH_STATE());
    expect(within(panel()).getAllByRole('link')[0]).toHaveAccessibleName(/\(opens in a new tab\)/);
  });

  test('the take-down window says closing keeps the point up', async () => {
    const ideas = [{ Text: 'a', PlayerName: 'Ana', AboutPoint: 'f1' }, { Text: 'b', PlayerName: 'Dee', AboutPoint: 'f1' }];
    await openRoom(RESEARCH_STATE({ points: [FINDING(1, { Status: 'shown' })], ideas }));
    fireEvent.click(within(screen.getByRole('region', { name: 'A point is up for the room' })).getByRole('button', { name: 'Take it down' }));
    const dlg = await screen.findByRole('dialog');
    expect(within(dlg).getByText(/The point stays up\./)).toBeInTheDocument();
  });

  test('shownPointIdeas finds nothing when the point has no id', () => {
    const { shownPointIdeas } = require('../buildroom/buildScreens');
    expect(shownPointIdeas({ shownPoint: { text: 'x' }, points: { items: [] }, ideas: [{ aboutPoint: null, status: 'new' }] })).toEqual([]);
  });
});
