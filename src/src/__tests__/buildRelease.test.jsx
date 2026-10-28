/**
 * THE RELEASE GATE, ON THE HOST'S SCREEN (owner, 17 Oct 2026: "Have thing get
 * to host queue to release to room"; parity PLAN §2c; the server half is
 * tests/build-release.js).
 *
 * Claude's held posts are queue items with Release to the room and Keep to
 * myself (and Release all when several wait); they count on the Host alert as
 * a grey line of fixed words; Session › Settings › Claude carries the switch;
 * the host's Timeline marks them; the laptop's projected screens never draw
 * them; and the laptop's codes card comes down when the server's does.
 * Fixtures go through the REAL server's pure half (build-store.js).
 */
import React from 'react';
import {
  render, screen, fireEvent, waitFor, within, act,
} from '@testing-library/react';
import { authFetch, getAuthToken } from '../auth/authFetch';
import webSocketClient from '../WebSocketClient';
import BuildRoomPage from '../buildroom/BuildRoomPage';
import {
  queueItems, hostAlert, roomSees, heldPosts, filterQueue,
} from '../buildroom/buildScreens';
import { CAPABILITY_IDS } from '../buildroom/capabilities';

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
const GAME = '4821';
const NOW = new Date().toISOString();
const ago = (s) => new Date(Date.now() - s * 1000).toISOString();

const LOG = (i, over) => ({ SK: `BUILD#LOG#${String(i).padStart(13, '0')}#x${i}`, LogId: `${i}-x${i}`, CreatedAt: ago(900 - i * 60), ...over });
const HELD_POST = LOG(1, { Kind: 'showing', Text: 'HELD: the sign-up form is up', Link: 'https://preview.example.org/form', By: 'agent', Released: false });
const HELD_SHOT = LOG(2, { Kind: 'image', Text: 'HELD-SHOT caption', Detail: 'img1', By: 'agent', Released: false });
const KEPT = LOG(3, { Kind: 'answer', Text: 'KEPT answer for the host', By: 'agent', Released: false, KeptAt: ago(10) });
const OPEN_POST = LOG(4, { Kind: 'progress', Text: 'Released: the header is in', By: 'agent' });
const IMAGES = [{ SK: 'BUILD#IMG#0000000000002#a', ImageId: 'img1', ContentType: 'image/png', Bytes: 9, Caption: 'HELD-SHOT caption', Kind: 'progress', By: 'agent', Released: false, CreatedAt: ago(780) }];

function hostState({ logs = [HELD_POST, HELD_SHOT, KEPT, OPEN_POST], images = IMAGES, st = {}, wall } = {}) {
  const rows = [{ SK: 'BUILD#STATE', Rev: 7, AgentSeenAt: ago(6), Phase: 'building', ...st }, ...logs, ...images];
  const view = S.hostView({
    gameId: GAME, meta: { Title: 'Volunteer sign-up', Details: 'A one-page site.' }, sessionState: 'STARTED', room: S.roomFromRows(rows), players: ['Ana'], now: NOW,
  });
  return { ...view, ...(wall ? { wall } : {}) };
}

let current;
let calls;
const res = (data, ok = true, status = 200) => ({ ok, status, json: async () => data });
function serve(state) {
  current = state;
  calls = [];
  authFetch.mockImplementation(async (url, opts = {}) => {
    const method = opts.method || 'GET';
    calls.push({ url, method, body: opts.body ? JSON.parse(opts.body) : undefined });
    if (method === 'GET' && url.endsWith('/build/state')) return res(current);
    if (method === 'GET' && url.endsWith('/players')) return res({ players: [], removedPlayers: [] });
    if (url.endsWith('/host-ticket')) return res({ ticket: 't' });
    return res({ ok: true });
  });
}
const postsTo = (suffix) => calls.filter((c) => c.method === 'POST' && c.url === `${API}games/${GAME}/build/${suffix}`);
async function openRoom(state) {
  serve(state);
  window.history.pushState({}, '', `/build?gameId=${GAME}`);
  render(<BuildRoomPage />);
  await screen.findByText('Volunteer sign-up');
}
const queue = () => screen.getByRole('region', { name: 'The queue' });

beforeEach(() => {
  window.API_BASE = API;
  jest.clearAllMocks();
  getAuthToken.mockImplementation(async () => 'id-token');
});

describe('the model', () => {
  test('held posts are queue items from Claude; kept and released ones are not', () => {
    const room = hostState();
    const items = queueItems(room).filter((x) => x.type === 'post');
    expect(items.map((x) => x.id)).toEqual(['post:1-x1', 'post:2-x2']);
    expect(items.every((x) => x.from === 'claude')).toBe(true);
    expect(filterQueue(queueItems(room), 'claude').map((x) => x.id)).toEqual(expect.arrayContaining(['post:1-x1', 'post:2-x2']));
    expect(heldPosts(room).map((l) => l.logId)).toEqual(['1-x1', '2-x2']);
  });

  test('the Host alert counts them on one grey line of fixed words, never the post\'s text', () => {
    const a = hostAlert(hostState());
    expect(a.count).toBe(2);
    expect(a.amber).toBe(false);
    expect(a.lines).toEqual([expect.objectContaining({ key: 'posts', label: 'Claude wants to show 2 things', ids: ['post:1-x1', 'post:2-x2'], target: { kind: 'waiting' } })]);
    expect(JSON.stringify(a)).not.toMatch(/HELD/);
    // Seen ones drop off, like every other line.
    expect(hostAlert(hostState(), { ids: ['post:1-x1'] }).lines[0].label).toBe('Claude wants to show 1 thing');
  });

  test('the room\'s copy of the host\'s read drops held and kept posts and their pictures', () => {
    const r = roomSees(hostState());
    expect(r.log.map((l) => l.text)).toEqual(['Released: the header is in']);
    expect(r.images).toEqual([]);
  });
});

describe('the queue', () => {
  test('a held post shows its words, its picture and its link; Release to the room posts the right body', async () => {
    await openRoom(hostState());
    const q = queue();
    expect(within(q).getAllByText('Claude wants to show the room', { exact: false })).toHaveLength(2);
    expect(within(q).getByText('HELD: the sign-up form is up')).toBeInTheDocument();
    expect(within(q).getByRole('link', { name: 'https://preview.example.org/form' })).toBeInTheDocument();
    expect(within(q).queryByText('KEPT answer for the host')).toBeNull();
    const card = within(q).getByText('HELD: the sign-up form is up').closest('.brm-qpost');
    fireEvent.click(within(card).getByRole('button', { name: /Release to the room/ }));
    await waitFor(() => expect(postsTo('posts')).toHaveLength(1));
    expect(postsTo('posts')[0].body).toEqual({ action: 'release', ids: ['1-x1'] });
  });

  test('Keep to myself posts keep', async () => {
    await openRoom(hostState());
    const card = within(queue()).getByText('HELD-SHOT caption', { selector: '.brm-idea-text' }).closest('.brm-qpost');
    fireEvent.click(within(card).getByRole('button', { name: 'Keep to myself' }));
    await waitFor(() => expect(postsTo('posts')).toHaveLength(1));
    expect(postsTo('posts')[0].body).toEqual({ action: 'keep', ids: ['2-x2'] });
  });

  test('Release all, when several wait, releases every held one in one call', async () => {
    await openRoom(hostState());
    fireEvent.click(within(queue()).getByRole('button', { name: 'Release all 2' }));
    await waitFor(() => expect(postsTo('posts')).toHaveLength(1));
    expect(postsTo('posts')[0].body).toEqual({ action: 'release', ids: ['1-x1', '2-x2'] });
  });

  test('one waiting: no Release all', async () => {
    await openRoom(hostState({ logs: [HELD_POST, OPEN_POST], images: [] }));
    expect(within(queue()).queryByRole('button', { name: /^Release all/ })).toBeNull();
    expect(within(queue()).getByRole('button', { name: /Release to the room/ })).toBeInTheDocument();
  });
});

describe('the rest of the host\'s screen', () => {
  test('Session › Settings › Claude: the check-posts switch, on by default, posts reviewAgentPosts', async () => {
    await openRoom(hostState());
    fireEvent.click(screen.getAllByRole('button', { name: /^SESSION/ })[0]);
    const panel = screen.getByRole('dialog', { name: 'Session' });
    fireEvent.click(within(panel).getByRole('tab', { name: /^Settings/ }));
    const sw = within(panel).getByRole('switch', { name: "Check Claude's posts before the room sees them" });
    expect(sw).toBeChecked();
    expect(within(panel).getByText(/wait in Waiting for you until you release them/)).toBeInTheDocument();
    fireEvent.click(sw);
    await waitFor(() => expect(postsTo('settings')).toHaveLength(1));
    expect(postsTo('settings')[0].body).toEqual({ reviewAgentPosts: false });
  });

  test('the switch reads off when the room has it off', async () => {
    await openRoom(hostState({ st: { Settings: { reviewAgentPosts: false } } }));
    fireEvent.click(screen.getAllByRole('button', { name: /^SESSION/ })[0]);
    const panel = screen.getByRole('dialog', { name: 'Session' });
    fireEvent.click(within(panel).getByRole('tab', { name: /^Settings/ }));
    expect(within(panel).getByRole('switch', { name: "Check Claude's posts before the room sees them" })).not.toBeChecked();
  });

  test('the host\'s Timeline marks held and kept posts', async () => {
    await openRoom(hostState());
    // The timeline is History's Claude chip (owner, 28 Oct 2026).
    fireEvent.click(within(screen.getByRole('group', { name: 'Show in History' })).getByRole('button', { name: /^Claude/ }));
    const tl = screen.getByRole('region', { name: 'Timeline' });
    expect(within(tl).getAllByText('Not shown to the room')).toHaveLength(2);
    expect(within(tl).getByText('Kept to yourself')).toBeInTheDocument();
    const open = within(tl).getByText('Released: the header is in').closest('li');
    expect(within(open).queryByText('Not shown to the room')).toBeNull();
  });

  test('the laptop\'s projected screens never draw a held post', async () => {
    await openRoom(hostState());
    for (const key of ['2', '3', '4']) {
      fireEvent.keyDown(window, { key });
      expect(document.body.textContent).not.toMatch(/HELD|KEPT/);
    }
  });

  test('the codes card follows the server: an ask opening takes the laptop\'s card down', async () => {
    await openRoom(hostState({ wall: { screen: 'stage', codes: 'none', profile: 'room', rev: 1 } }));
    fireEvent.click(screen.getAllByRole('button', { name: /^SESSION/ })[0]);
    const panel = screen.getByRole('dialog', { name: 'Session' });
    fireEvent.click(within(panel).getByRole('tab', { name: /^Settings/ }));
    fireEvent.click(within(panel).getByRole('button', { name: 'Show on the Stage' }));
    const card = () => screen.queryByTestId('stage-join-panel');
    expect(card()).not.toBeNull();
    const handler = webSocketClient.onMessage.mock.calls.find(([type]) => type === 'buildChanged')[1];
    // A read from before the server heard the laptop: still "none", and the card stays.
    current = hostState({ wall: { screen: 'stage', codes: 'none', profile: 'room', rev: 1 } });
    await act(async () => { handler({ gameId: GAME, rev: 8 }); });
    expect(card()).not.toBeNull();
    // The server has the codes up.
    current = hostState({ wall: { screen: 'stage', codes: 'join', profile: 'room', rev: 2 } });
    await act(async () => { handler({ gameId: GAME, rev: 9 }); });
    await waitFor(() => expect(card()).not.toBeNull());
    // An ask opened: the server took them down, and so does the laptop.
    current = hostState({ wall: { screen: 'stage', codes: 'none', profile: 'room', rev: 3 } });
    await act(async () => { handler({ gameId: GAME, rev: 10 }); });
    await waitFor(() => expect(card()).toBeNull());
  });

  test('the capability has its id', () => {
    expect(CAPABILITY_IDS).toContain('release-posts');
  });
});
