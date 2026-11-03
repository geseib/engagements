/**
 * ASK AGAIN COMES BACK AFTER NOT NOW, ON THE REAL PLAYER PAGE.
 *
 * // rejects: dev QA 1 Nov — after the host's "Not now" the participant's
 * //          phone showed "The host said not now." and Ask again never
 * //          returned, not even after ~45 seconds; PLAN §4.4 step 7 and
 * //          config/handoverWait.js say thirty.
 *
 * Fake timers drive the page's own clock, so the thirty seconds are asserted
 * at their edge rather than waited for.
 */
import React from 'react';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import PlayerPage from '../PlayerPage';

jest.mock('../WebSocketClient', () => ({
  __esModule: true,
  default: {
    connect: jest.fn(),
    disconnect: jest.fn(),
    ensureConnected: jest.fn(),
    isConnected: () => true,
    sendCleanMessage: jest.fn(() => true),
    onConnectionStatusChange: jest.fn(),
    onReconnected: jest.fn(),
    onMessage: jest.fn(),
    offMessage: jest.fn(),
  },
}));

const GAME = '4821';
const ME = 'Sam';

function makeServer({ refusedAtJoin = false, waitingAs200 = false } = {}) {
  const server = { asks: [], claims: [] };
  global.fetch.mockImplementation((rawUrl, options) => {
    const url = String(rawUrl);
    const method = options?.method || 'GET';
    const body = JSON.parse(options?.body || '{}');
    let status = 200;
    let out = {};
    if (method === 'POST' && url.includes('/handover-request')) {
      server.asks.push(body);
      out = { success: true, askAgainAfterSeconds: 60, lapseSeconds: 600 };
    } else if (method === 'POST' && url.endsWith(`games/${GAME}/players`)) {
      if (body.claimExisting) server.claims.push(body);
      status = 409;
      out = body.claimExisting || refusedAtJoin
        ? { code: 'NAME_TAKEN', playerName: ME, message: 'The host said not now.', handoverRefused: true }
        : { code: 'NAME_TAKEN', playerName: ME, message: 'Someone here is already answering as Sam.' };
      // join-game.js's "still waiting" shape for a retry that asks for it.
      if (waitingAs200 && body.waitStatus === true) { status = 200; out = { ...out, waiting: true }; }
    } else if (url.includes(`games/${GAME}/state`)) {
      out = { state: 'CREATED', gameType: 'call-and-answer' };
    } else if (url.includes(`games/${GAME}/players`)) {
      out = { players: [] };
    }
    return Promise.resolve({ ok: status < 400, status, json: async () => out });
  });
  return server;
}

const dockLabels = () => {
  const dock = document.querySelector('.plr-dock');
  return dock ? within(dock).queryAllByRole('button').map((b) => b.textContent.trim()) : [];
};

const tick = async (ms) => {
  await act(async () => { jest.advanceTimersByTime(ms); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
};

beforeEach(() => { localStorage.clear(); jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); });

async function joinAs() {
  render(<PlayerPage />);
  fireEvent.change(screen.getByLabelText(/Session code/i), { target: { value: GAME } });
  fireEvent.change(screen.getByPlaceholderText(/Your Name/i), { target: { value: ME } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Join$/i })); });
  await tick(0);
}

test('Ask again appears thirty seconds after Not now, not before, and asks', async () => {
  const server = makeServer();
  render(<PlayerPage />);
  fireEvent.change(screen.getByLabelText(/Session code/i), { target: { value: GAME } });
  fireEvent.change(screen.getByPlaceholderText(/Your Name/i), { target: { value: ME } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Join$/i })); });
  await tick(0);

  await act(async () => { fireEvent.click(screen.getByRole('button', { name: "That's me: use my name on this device" })); });
  await tick(0);
  expect(screen.getByText(`Waiting for the host to let you in as ${ME}.`)).toBeInTheDocument();

  // The quiet retry's first claim meets the host's Not now.
  await tick(4000);
  expect(screen.getByRole('heading', { name: 'The host said not now.' })).toBeInTheDocument();
  expect(dockLabels()).toEqual(['Pick another name']);

  await tick(29 * 1000);
  expect(dockLabels()).toEqual(['Pick another name']);
  await tick(2 * 1000);
  expect(dockLabels()).toEqual(['Pick another name', 'Ask again']);

  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Ask again' })); });
  await tick(0);
  expect(server.asks).toHaveLength(2);
  expect(screen.getByText(`Waiting for the host to let you in as ${ME}.`)).toBeInTheDocument();
});

// rejects: dev QA 1 Nov — a join refused with the host's Not now (a reload,
//          the rejoin prompt) reset the flow to the first-ask screen, so the
//          phone said "The host said not now" and Ask again never came back.
test('a fresh join the host already said Not now to lands on the declined screen, with Ask again after thirty seconds', async () => {
  const server = makeServer({ refusedAtJoin: true });
  await joinAs();
  expect(screen.getByRole('heading', { name: 'The host said not now.' })).toBeInTheDocument();
  expect(dockLabels()).toEqual(['Pick another name']);
  await tick(29 * 1000);
  expect(dockLabels()).toEqual(['Pick another name']);
  await tick(2 * 1000);
  expect(dockLabels()).toEqual(['Pick another name', 'Ask again']);
  expect(server.claims).toHaveLength(0);
});

// rejects: dev QA 1 Nov — the quiet retry's expected "not yet" was a 409 the
//          browser printed as an error every four seconds. The retry now asks
//          for it as a 200 `waiting`, and reads it exactly as it read the 409.
test('the quiet retry asks for "still waiting" as a 200 and still reaches Not now', async () => {
  const server = makeServer({ waitingAs200: true });
  await joinAs();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: "That's me: use my name on this device" })); });
  await tick(0);
  await tick(4000);
  expect(server.claims.length).toBeGreaterThanOrEqual(1);
  expect(server.claims.every((c) => c.waitStatus === true && c.claimExisting === true)).toBe(true);
  expect(screen.getByRole('heading', { name: 'The host said not now.' })).toBeInTheDocument();
  await tick(31 * 1000);
  expect(dockLabels()).toEqual(['Pick another name', 'Ask again']);
});
