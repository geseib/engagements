/**
 * MOCKUPS READY, WHERE THE HOST IS LOOKING (owner, 23 Oct 2026, dev game 2550).
 *
 * Claude made three mockups for a vote (ask 004, proposed, a picture on A, B
 * and C), but the room was in the opening with its Ideas ask (002) open and
 * Claude's own Ideas ask (003) above 004 in Waiting for you. The only way to
 * the mockups was 004's card there, and nothing pointed at it.
 *
 * rejects: a ready set that shows only in Waiting for you; a card that
 * replaces the console's main move; a dock cue on the room's window; Put to
 * the room now closing an open ask without asking; Next that is not the
 * existing line-up (`opennext`); Next not leading during the opening; a card
 * that stays after the ask opened or was discarded; a lined-up set that does
 * not say so; 004 under 003 in Waiting for you.
 *
 * Fixtures from the REAL build-store.js hostView, as the page reads them.
 */
import React from 'react';
import {
  render, screen, fireEvent, waitFor, within,
} from '@testing-library/react';
import { authFetch } from '../auth/authFetch';
import BuildRoomPage from '../buildroom/BuildRoomPage';
import BuildStageScreen from '../buildroom/screens/BuildStageScreen';
import MockupsReady from '../buildroom/BuildMockupsReady';
import { mockupsCard, readyMockupAsks, queueItems } from '../buildroom/buildScreens';
import { SURFACES_KEY } from '../config/surfaces';
import { W } from '../buildroom/words';

jest.mock('../utils/reloadPage', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn(), getAuthToken: jest.fn(async () => 'id-token') }));
jest.mock('../WebSocketClient', () => ({
  __esModule: true,
  default: {
    connect: jest.fn(), disconnect: jest.fn(), onMessage: jest.fn(), offMessage: jest.fn(), onReconnected: jest.fn(), onConnectionStatusChange: jest.fn(), isConnected: jest.fn(() => false), ensureConnected: jest.fn(),
  },
}));

const S = require('../../../lambda-functions/game/build-store');

const API = 'https://api.example.test/dev/';
const GAME = '2550';
const NOW = new Date().toISOString();
const ago = (s) => new Date(Date.now() - s * 1000).toISOString();
const pad = (n) => String(n).padStart(15, '0');

const IDEAS_002 = { SK: 'BUILD#ASK#002', AskId: '002', Kind: 'suggest', Prompt: 'What problem do they have today?', Source: 'host', Status: 'live', OpeningStep: 'problem', CreatedAt: ago(900), OpenedAt: ago(800) };
const IDEAS_003 = { SK: 'BUILD#ASK#003', AskId: '003', Kind: 'suggest', Prompt: 'What should the sign-up page say first?', Source: 'agent', Status: 'proposed', CreatedAt: ago(700) };
const CHOICE_004 = {
  SK: 'BUILD#ASK#004', AskId: '004', Kind: 'choice', Prompt: 'Which look should the sign-up page have?', Source: 'agent', Status: 'proposed', CreatedAt: ago(600), MaxPicks: 1,
  Options: ['Calm', 'Bold', 'Playful'].map((title, i) => ({ label: 'ABC'[i], title, detail: '', url: '' })),
};
const img = (askId, label, s) => ({ SK: `BUILD#IMG#${pad(Date.now() - s * 1000)}#${askId}${label}`, ImageId: `img-${askId}-${label}`, Kind: 'mockup', AskId: askId, Label: label, Caption: `Choice ${label}`, ContentType: 'image/png', By: 'agent', CreatedAt: ago(s) });
const MOCKUPS_004 = ['A', 'B', 'C'].map((l, i) => img('004', l, 500 - i));

function hostState({ st = {}, rows = [] } = {}) {
  const view = S.hostView({
    gameId: GAME,
    meta: { Title: 'Volunteer sign-up', Details: '' },
    sessionState: 'STARTED',
    room: S.roomFromRows([{ SK: 'BUILD#STATE', Rev: 7, AgentSeenAt: ago(6), ...st }, ...rows]),
    players: ['Ana', 'Sam'],
    now: NOW,
  });
  return { ...view, wallKey: 'K'.repeat(43), wall: { screen: 'stage', codes: 'none', profile: 'room', rev: 1 }, presenting: 0, presentDetail: null };
}
/** Game 2550 as the owner found it: the opening, 002 open, 003 then 004 proposed, 004's pictures in. */
const game2550 = (over = {}) => hostState({
  st: { Phase: 'opening', CurrentAskId: '002', ...(over.st || {}) },
  rows: [IDEAS_002, IDEAS_003, CHOICE_004, ...MOCKUPS_004, ...(over.rows || [])],
});

let calls;
let current;
const res = (data) => ({ ok: true, status: 200, json: async () => data });
function serve(state) {
  current = state;
  calls = [];
  authFetch.mockImplementation(async (url, opts = {}) => {
    const method = opts.method || 'GET';
    calls.push({ url, method, body: opts.body ? JSON.parse(opts.body) : undefined });
    if (url.includes('/build/images/')) return { ok: true, status: 200, blob: async () => new Blob(['x']) };
    if (method === 'GET' && url.endsWith('/build/state')) return res(current);
    if (method === 'GET' && url.endsWith('/players')) return res({ players: [], removedPlayers: [] });
    if (url.endsWith('/host-ticket')) return res({ ticket: 't' });
    return res({ ok: true, ask: {}, wall: current.wall });
  });
}
const askPosts = (askId) => calls.filter((c) => c.method === 'POST' && c.url.endsWith(`/build/asks/${askId}`)).map((c) => c.body);

async function openRoom(state, choice = 'classic') {
  window.localStorage.setItem(SURFACES_KEY, choice);
  serve(state);
  window.history.pushState({}, '', `/build?gameId=${GAME}`);
  render(<BuildRoomPage />);
  await screen.findAllByText('Volunteer sign-up');
}

beforeEach(() => {
  window.API_BASE = API;
  jest.clearAllMocks();
  window.localStorage.clear();
  global.URL.createObjectURL = jest.fn(() => 'blob:test');
});

describe('the rule', () => {
  test('game 2550: 004 is ready, 002 is open, Next leads during the opening', () => {
    const c = mockupsCard(game2550());
    expect([c.ask.askId, c.more, c.queued, c.open.askId, c.nextLeads]).toEqual(['004', 0, false, '002', true]);
  });
  test('after the opening Put to the room now leads; with nothing open there is no Next', () => {
    expect(mockupsCard(game2550({ st: { Phase: 'building' } })).nextLeads).toBe(false);
    expect(mockupsCard(game2550({ st: { CurrentAskId: '' } })).open).toBeNull();
  });
  test('no card without every picture, or once the ask is opened or discarded', () => {
    expect(mockupsCard(hostState({ rows: [CHOICE_004, ...MOCKUPS_004.slice(0, 2)] }))).toBeNull();
    expect(mockupsCard(hostState({ rows: [{ ...CHOICE_004, Status: 'live' }, ...MOCKUPS_004] }))).toBeNull();
    expect(mockupsCard(hostState({ rows: [{ ...CHOICE_004, Status: 'discarded' }, ...MOCKUPS_004] }))).toBeNull();
  });
  test('more than one ready: the oldest, and how many more', () => {
    const later = { ...CHOICE_004, SK: 'BUILD#ASK#005', AskId: '005', CreatedAt: ago(100) };
    const room = game2550({ rows: [later, ...['A', 'B', 'C'].map((l, i) => img('005', l, 90 - i))] });
    expect(readyMockupAsks(room).map((a) => a.askId)).toEqual(['004', '005']);
    expect([mockupsCard(room).ask.askId, mockupsCard(room).more]).toEqual(['004', 1]);
  });
  test('lined up: it says so', () => {
    const c = mockupsCard(game2550({ st: { NextAskId: '004' } }));
    expect([c.ask.askId, c.queued]).toEqual(['004', true]);
  });
  test('Waiting for you lists the ready set before Claude\'s other asks (still Claude first, oldest first)', () => {
    const ids = queueItems(game2550()).filter((x) => x.type === 'ask').map((x) => x.ask.askId);
    expect(ids).toEqual(['004', '003']);
  });
});

describe('the card\'s two moves', () => {
  const run = async (fn) => fn();
  const mount = (room) => {
    const askAction = jest.fn(async () => ({ ask: {} }));
    render(<MockupsReady room={room} busy={false} ended={false} run={run} api={{ askAction }} />);
    return askAction;
  };
  test('the question, the A/B/C tiles, and Next as the primary during the opening', () => {
    mount(game2550());
    const card = screen.getByTestId('brm-mockups-card');
    expect(card.textContent).toContain(W.mockupsCardHead);
    expect(card.textContent).toContain('Which look should the sign-up page have?');
    expect(card.querySelectorAll('.brm-mocktiles li').length).toBe(3);
    expect(within(card).getByRole('button', { name: W.nextAfterThis })).toHaveClass('brm-btn--primary');
    expect(within(card).getByRole('button', { name: W.putToRoomNow })).not.toHaveClass('brm-btn--primary');
  });
  test('Next, after this ask lines it up with the existing open-next action', async () => {
    const askAction = mount(game2550());
    fireEvent.click(screen.getByRole('button', { name: W.nextAfterThis }));
    await waitFor(() => expect(askAction).toHaveBeenCalledWith('004', { action: 'openNext' }));
  });
  test('Put to the room now asks first while an ask is open, then opens it', async () => {
    const askAction = mount(game2550());
    fireEvent.click(screen.getByRole('button', { name: W.putToRoomNow }));
    expect(askAction).not.toHaveBeenCalled();
    expect(screen.getByText(W.closeAndOpen(2))).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: W.keepItOpen }));
    expect(askAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: W.putToRoomNow }));
    fireEvent.click(screen.getByRole('button', { name: W.closeAndOpenYes }));
    await waitFor(() => expect(askAction).toHaveBeenCalledWith('004', { action: 'open' }));
  });
  test('with nothing open it opens at once, and leads', async () => {
    const askAction = mount(game2550({ st: { CurrentAskId: '', Phase: 'building' } }));
    expect(screen.queryByRole('button', { name: W.nextAfterThis })).toBeNull();
    expect(screen.getByRole('button', { name: W.putToRoomNow })).toHaveClass('brm-btn--primary');
    fireEvent.click(screen.getByRole('button', { name: W.putToRoomNow }));
    await waitFor(() => expect(askAction).toHaveBeenCalledWith('004', { action: 'open' }));
  });
  test('lined up: "Opens after ask 2", and Not next', async () => {
    const askAction = mount(game2550({ st: { NextAskId: '004' } }));
    expect(screen.getByTestId('brm-mockups-queued').textContent).toBe(W.opensAfterAsk(2));
    expect(screen.queryByRole('button', { name: W.putToRoomNow })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: W.notNext }));
    await waitFor(() => expect(askAction).toHaveBeenCalledWith('004', { action: 'notNext' }));
  });
});

describe('where it shows', () => {
  test('Host screen (one screen): in the main area, above the open ask', async () => {
    await openRoom(game2550(), 'classic');
    const card = await screen.findByTestId('brm-mockups-card');
    const main = document.querySelector('.brm-host main') || card.closest('main');
    expect(main).not.toBeNull();
    expect(main.contains(card)).toBe(true);
    const path = main.querySelector('[data-capability="ask-path"]');
    // eslint-disable-next-line no-bitwise
    expect(card.compareDocumentPosition(path) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: W.nextAfterThis }));
    await waitFor(() => expect(askPosts('004')).toContainEqual({ action: 'openNext' }));
  });
  test('the console (two screens): a second card in Your part now, under the move', async () => {
    await openRoom(game2550(), 'two');
    const now = document.querySelector('.hc.hc--build .hc-now');
    const card = await within(now).findByTestId('brm-mockups-card');
    expect(card.closest('.hc-now-extra')).not.toBeNull();
    expect(now.querySelector('.hc-acts')).not.toBeNull();
    expect(now.querySelector('.hc-acts').contains(card)).toBe(false);
  });
  test('the Stage: a cue on the host\'s dock that goes to the Host screen; never on the room\'s window', async () => {
    await openRoom(game2550(), 'classic');
    fireEvent.keyDown(window, { key: '2' });
    const cue = await screen.findByTestId('brm-dock-mockups');
    expect(cue.closest('footer.dock')).not.toBeNull();
    expect(cue.textContent).toBe(W.dockMockups);
    fireEvent.click(cue);
    expect(await screen.findByTestId('brm-mockups-card')).toBeInTheDocument();
    // The room's window draws the Stage with no controls: no cue.
    const wall = render(<BuildStageScreen room={game2550()} now={Date.now()} profile="room" />);
    expect(wall.container.querySelector('[data-testid="brm-dock-mockups"]')).toBeNull();
  });
  test('no ready set, no card and no cue', async () => {
    await openRoom(hostState({ st: { Phase: 'opening', CurrentAskId: '002' }, rows: [IDEAS_002, IDEAS_003, CHOICE_004] }), 'classic');
    await screen.findByRole('region', { name: 'Proposed ask 4' });
    expect(screen.queryByTestId('brm-mockups-card')).toBeNull();
    fireEvent.keyDown(window, { key: '2' });
    await waitFor(() => expect(document.querySelector('footer.dock')).not.toBeNull());
    expect(screen.queryByTestId('brm-dock-mockups')).toBeNull();
  });
});
