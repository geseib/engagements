/**
 * HISTORY -> a past ask's window -> its picture -> the viewer -> Back
 * (docs/design/build-room-history-and-stage-decide R1, R2). Page level: the
 * fixtures go through the real build-store.js views.
 */
import React from 'react';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { authFetch, getAuthToken } from '../auth/authFetch';
import BuildRoomPage from '../buildroom/BuildRoomPage';

jest.mock('../utils/reloadPage', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn(), getAuthToken: jest.fn(async () => 'id-token') }));
jest.mock('../WebSocketClient', () => ({
  __esModule: true,
  default: {
    connect: jest.fn(), disconnect: jest.fn(), onMessage: jest.fn(), offMessage: jest.fn(), onReconnected: jest.fn(),
    onConnectionStatusChange: jest.fn(), isConnected: jest.fn(() => false), ensureConnected: jest.fn(),
  },
}));

const S = require('../../../lambda-functions/game/build-store');

const API = 'https://api.example.test/dev/';
const GAME = '4821';
const NOW = new Date().toISOString();
const ago = (s) => new Date(Date.now() - s * 1000).toISOString();

const ASK = {
  SK: 'BUILD#ASK#004', AskId: '004', Kind: 'choice', Prompt: 'How should it look and feel?', Detail: '', Source: 'agent', CreatedAt: ago(900),
  Options: [
    { label: 'A', title: 'Calm and clear', detail: '', url: '', imageId: 'img-a' },
    { label: 'B', title: 'Playful', detail: '', url: '', imageId: 'img-b' },
  ],
  MaxPicks: 1, Status: 'decided', DecidedAt: ago(300),
  Decision: { direction: 'How should it look and feel: Playful', chosen: ['B'], method: 'vote', sendToAgent: true, as: 'do-now' },
};
const rows = [
  { SK: 'BUILD#STATE', Rev: 7, AgentSeenAt: ago(6), Phase: 'building' },
  ASK,
  { SK: 'BUILD#LOG#0000000000001#d1', LogId: '1-d1', Kind: 'decision', Text: 'How should it look and feel: Playful', By: 'host', AskId: '004', ForAgent: true, ForAgentAs: 'do-now', CreatedAt: ago(300) },
  { SK: 'BUILD#ANS#004#Ana', AskId: '004', PlayerName: 'Ana', Choice: ['B'], Why: '', CreatedAt: ago(500) },
  { SK: 'BUILD#ANS#004#Priya', AskId: '004', PlayerName: 'Priya', Choice: ['B'], Why: '', CreatedAt: ago(500) },
  { SK: 'BUILD#ANS#004#Sam', AskId: '004', PlayerName: 'Sam', Choice: ['A'], Why: '', CreatedAt: ago(500) },
];
const state = () => S.hostView({
  gameId: GAME, meta: { Title: 'Volunteer sign-up', Details: 'A site.' }, sessionState: 'STARTED', room: S.roomFromRows(rows), players: ['Ana', 'Dee', 'Priya', 'Sam'], now: NOW,
});

beforeEach(() => {
  window.API_BASE = API;
  jest.clearAllMocks();
  getAuthToken.mockImplementation(async () => 'id-token');
  global.URL.createObjectURL = jest.fn(() => 'blob:test');
  authFetch.mockImplementation(async (url) => {
    if (url.includes('/build/images/')) return { ok: true, status: 200, blob: async () => new Blob(['x']) };
    if (url.endsWith('/build/state')) return { ok: true, status: 200, json: async () => state() };
    if (url.endsWith('/host-ticket')) return { ok: true, status: 200, json: async () => ({ ticket: 't' }) };
    return { ok: true, status: 200, json: async () => ({}) };
  });
});

async function openHistory() {
  window.history.pushState({}, '', `/build?gameId=${GAME}`);
  render(<BuildRoomPage />);
  await screen.findByText('Volunteer sign-up');
  fireEvent.keyDown(window, { key: '4' });
}

test('a decided item opens its window; a picture opens the viewer; Back leaves the window open', async () => {
  await openHistory();
  const story = screen.getByRole('list', { name: 'The story so far' });
  fireEvent.click(within(story).getByRole('button', { name: 'Open Ask 4' }));
  const win = await screen.findByRole('dialog', { name: /How should it look and feel\?/ });
  expect(within(win).getByText("Picked · the room's choice, 2 to 1")).toBeInTheDocument();
  expect(within(win).getByText(/^Do now · sent /)).toBeInTheDocument();
  fireEvent.click(await within(win).findByRole('button', { name: /Look closer: Choice A/ }));
  const viewer = await screen.findByRole('dialog', { name: /mockup viewer/i });
  expect(within(viewer).getByRole('button', { name: /Back to Ask 4/ })).toBeInTheDocument();
  expect(within(viewer).getByRole('tab', { selected: true }).textContent).toMatch(/^A/);
  fireEvent.click(within(viewer).getByRole('button', { name: /Back to Ask 4/ }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: /mockup viewer/i })).toBeNull());
  expect(screen.getByRole('dialog', { name: /How should it look and feel\?/ })).toBeInTheDocument();
});

test('Esc in the viewer goes Back only; a second Esc closes the window', async () => {
  await openHistory();
  fireEvent.click(within(screen.getByRole('heading', { name: 'Decided so far' }).closest('section')).getByRole('button', { name: /How should it look/ }));
  const win = await screen.findByRole('dialog', { name: /How should it look and feel\?/ });
  fireEvent.click(await within(win).findByRole('button', { name: /Look closer: Choice B/ }));
  await screen.findByRole('dialog', { name: /mockup viewer/i });
  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog', { name: /mockup viewer/i })).toBeNull());
  expect(screen.getByRole('dialog', { name: /How should it look and feel\?/ })).toBeInTheDocument();
  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog', { name: /How should it look and feel\?/ })).toBeNull());
});

test('with a window open, 1-4 do not switch screens', async () => {
  await openHistory();
  fireEvent.click(within(screen.getByRole('heading', { name: 'Decided so far' }).closest('section')).getByRole('button', { name: /How should it look/ }));
  await screen.findByRole('dialog', { name: /How should it look and feel\?/ });
  fireEvent.keyDown(window, { key: '1' });
  expect(screen.getByRole('heading', { name: 'Decided so far' })).toBeInTheDocument();
});

describe('the Host screen opens the viewer', () => {
  const proposed = { ...ASK, Status: 'proposed', DecidedAt: undefined, Decision: undefined, AskForMockups: true };
  const live = { ...ASK, Status: 'live', DecidedAt: undefined, Decision: undefined };
  const openHost = async (askRow, current) => {
    rows.splice(0, rows.length, { SK: 'BUILD#STATE', Rev: 7, AgentSeenAt: ago(6), Phase: 'building', ...(current ? { CurrentAskId: '004' } : {}) }, askRow);
    window.history.pushState({}, '', `/build?gameId=${GAME}`);
    render(<BuildRoomPage />);
    await screen.findByText('Volunteer sign-up');
  };
  test('the queue\'s waiting-vote tile', async () => {
    await openHost(proposed, false);
    fireEvent.click((await screen.findAllByRole('button', { name: /Look closer: Choice B/ })).find((b) => b.closest('.brm-mocktile-img')));
    const viewer = await screen.findByRole('dialog', { name: /mockup viewer/i });
    expect(within(viewer).getByRole('button', { name: /Back to the Host screen/ })).toBeInTheDocument();
    expect(within(viewer).getByRole('tab', { selected: true }).textContent).toMatch(/^B/);
  });
  test('the path\'s option tile', async () => {
    await openHost(live, true);
    fireEvent.click(await screen.findByRole('button', { name: /Look closer: Choice A/ }));
    const viewer = await screen.findByRole('dialog', { name: /mockup viewer/i });
    expect(within(viewer).getByRole('button', { name: /Back to the Host screen/ })).toBeInTheDocument();
  });
});
