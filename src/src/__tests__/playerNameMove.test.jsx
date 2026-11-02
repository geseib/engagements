/**
 * MOVING A NAME, ON THE REAL PLAYER PAGE (experience plan §4.4; steps 1c, 1d).
 *
 * useHandoverFlow.test.jsx pins the wait's timings on a bare hook. This file
 * mounts PlayerPage and pins the wiring the hook cannot see:
 *
 *   the new device   the ask goes to the server and is checked; the page waits
 *                    and lands in the session by itself on the host's grant;
 *                    Not now stops it; a failed ask says so
 *   the old device   `nameMoved` from the socket, a vote refused with
 *                    NAME_MOVED, or a rejoin refused with `nameMoved`, each
 *                    stop the page on "<Name> is now on another device", with
 *                    one way on; answers and votes carry this browser's id so
 *                    the server can tell
 *
 * The retry is shortened (HANDOVER_TIMING mocked) so the page's own loop runs
 * on real timers; nothing else about the flow is changed.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import PlayerPage from '../PlayerPage';
import webSocketClient from '../WebSocketClient';

jest.mock('../config/handoverWait', () => {
  const actual = jest.requireActual('../config/handoverWait');
  return {
    ...actual,
    HANDOVER_TIMING: Object.freeze({ ...actual.HANDOVER_TIMING, retryEveryMs: 20, grantedHoldMs: 20 }),
  };
});

const handlers = {};
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
    onMessage: jest.fn((type, fn) => { handlers[type] = fn; }),
    offMessage: jest.fn(),
  },
}));

const GAME = '4821';
const ME = 'Sam';
const BALLOT = [{ answer: 'One' }, { answer: 'Two' }, { answer: 'Three' }];

/**
 * A session. `collide` makes the first join refuse the name; `claim` decides
 * what each claim (a join with claimExisting) gets back.
 */
function makeServer(overrides = {}) {
  const server = {
    state: 'CREATED',
    collide: false,
    askOk: true,
    claim: () => ({ status: 409, body: { code: 'NAME_TAKEN', playerName: ME, message: 'taken' } }),
    joinBody: null,
    vote: () => ({ status: 200, body: { message: 'ok' } }),
    ballot: [],
    asks: [],
    claims: [],
    votes: [],
    ...overrides,
  };
  server.handle = (url, options) => {
    const method = options?.method || 'GET';
    const body = JSON.parse(options?.body || '{}');
    if (method === 'POST' && url.includes('/handover-request')) {
      server.asks.push(body);
      return server.askOk
        ? { status: 200, body: { success: true, askAgainAfterSeconds: 60, lapseSeconds: 600 } }
        : { status: 500, body: { error: 'boom' } };
    }
    if (method === 'POST' && url.endsWith(`games/${GAME}/players`)) {
      if (body.claimExisting) { server.claims.push(body); return server.claim(body); }
      if (server.joinBody) return server.joinBody(body);
      if (server.collide) return { status: 409, body: { code: 'NAME_TAKEN', playerName: ME, message: 'Someone here is already answering as Sam.' } };
      return { status: 200, body: { success: true, playerName: ME } };
    }
    if (method === 'POST' && url.includes(`games/${GAME}/votes`)) {
      server.votes.push(body);
      return server.vote(body);
    }
    if (url.includes(`games/${GAME}/state`)) {
      const out = { state: server.state, gameType: 'call-and-answer', currentQuestion: '001', commentsOpen: true };
      if (/\/state\/[^/?]+/.test(url)) out.playerQuestionState = { questionNumber: 1, hasAnswered: false, hasVoted: false };
      return { status: 200, body: out };
    }
    if (url.includes(`games/${GAME}/question`)) {
      return { status: 200, body: { title: 'Q', detail: 'Detail', questionNumber: '001', id: '001' } };
    }
    if (url.includes(`games/${GAME}/answers`)) {
      const out = { gameId: GAME, questionId: '001', answerCount: server.ballot.length };
      if (server.ballot.length) out.answers = [...server.ballot];
      return { status: 200, body: out };
    }
    if (url.includes(`games/${GAME}/players`)) return { status: 200, body: { players: [] } };
    if (url.includes(`games/${GAME}`)) return { status: 200, body: { engagementInfo: '' } };
    return { status: 200, body: {} };
  };
  global.fetch.mockImplementation((url, options) => {
    const { status, body } = server.handle(String(url), options);
    return Promise.resolve({ ok: status < 400, status, json: async () => body });
  });
  return server;
}

async function join() {
  render(<PlayerPage />);
  fireEvent.change(screen.getByLabelText(/Session code/i), { target: { value: GAME } });
  fireEvent.change(screen.getByPlaceholderText(/Your Name/i), { target: { value: ME } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /^Join$/i }));
  });
}

async function resync() {
  await act(async () => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await act(async () => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
  });
}

const shell = () => document.querySelector('.plr');
const dock = () => document.querySelector('.plr-dock');
const dockLabels = () => (dock() ? within(dock()).queryAllByRole('button').map((b) => b.textContent.trim()) : []);
const askButton = () => screen.getByRole('button', { name: "That's me: use my name on this device" });

beforeEach(() => {
  Object.keys(handlers).forEach((k) => delete handlers[k]);
  webSocketClient.sendCleanMessage.mockClear();
  webSocketClient.disconnect.mockClear();
  localStorage.clear();
});

describe('the new device', () => {
  // rejects: a phone that waits for ever because nobody told it the answer.
  test('asks, waits, and lands in the session by itself when the host lets it', async () => {
    let grantOpen = false;
    const server = makeServer({
      collide: true,
      claim: () => (grantOpen
        ? { status: 200, body: { success: true, playerName: ME, isReconnection: true } }
        : { status: 409, body: { code: 'NAME_TAKEN', playerName: ME, message: 'taken' } }),
    });
    await join();
    await waitFor(() => expect(screen.getByRole('heading', { name: `${ME} is already in this session.` })).toBeInTheDocument());

    await act(async () => { fireEvent.click(askButton()); });
    await waitFor(() => expect(screen.getByText(`Waiting for the host to let you in as ${ME}.`)).toBeInTheDocument());
    expect(server.asks).toHaveLength(1);
    expect(server.asks[0].clientId).toBeTruthy();

    // The phone keeps quietly asking the join, and nobody presses anything.
    await waitFor(() => expect(server.claims.length).toBeGreaterThanOrEqual(2));
    expect(server.claims.every((c) => c.claimExisting === true && c.clientId === server.asks[0].clientId)).toBe(true);

    grantOpen = true;  // the host presses Let them
    await waitFor(() => expect(screen.getByText(`You're in as ${ME}.`)).toBeInTheDocument());
    expect(screen.getByText('Your answers and score came with you.')).toBeInTheDocument();
    await waitFor(() => expect(shell().getAttribute('data-phase')).not.toBe('join'));

    // rejects: the retry carrying on after it is in.
    const after = server.claims.length;
    await act(async () => { await new Promise((r) => setTimeout(r, 120)); });
    expect(server.claims.length).toBe(after);
  });

  // rejects: "Asked the host" over an ask that failed (audit C §3.2).
  test('a failed ask says it did not get through, offers Try again, and does not wait', async () => {
    const server = makeServer({ collide: true, askOk: false });
    await join();
    await waitFor(() => askButton());
    await act(async () => { fireEvent.click(askButton()); });
    await waitFor(() => expect(screen.getByText(/did not reach the host|could not be asked/i)).toBeInTheDocument());
    expect(screen.queryByText(/Waiting for the host/)).toBeNull();
    expect(dockLabels()).toEqual(['Try again', 'Pick another name']);
    await act(async () => { await new Promise((r) => setTimeout(r, 80)); });
    expect(server.claims).toHaveLength(0);

    server.askOk = true;
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })); });
    await waitFor(() => expect(screen.getByText(/Waiting for the host/)).toBeInTheDocument());
  });

  // rejects: retrying after the host said no, or a Not now the phone never shows.
  test('Not now shows calmly, makes Pick another name the main button, and stops the retry', async () => {
    const server = makeServer({
      collide: true,
      claim: () => ({ status: 409, body: { code: 'NAME_TAKEN', playerName: ME, message: 'no', handoverRefused: true } }),
    });
    await join();
    await waitFor(() => askButton());
    await act(async () => { fireEvent.click(askButton()); });
    await waitFor(() => expect(screen.getByRole('heading', { name: 'The host said not now.' })).toBeInTheDocument());
    expect(dockLabels()).toEqual(['Pick another name']);
    const claims = server.claims.length;
    await act(async () => { await new Promise((r) => setTimeout(r, 120)); });
    expect(server.claims.length).toBe(claims);
  });
});

describe('the old device', () => {
  async function joinedOnTheOldPhone(server) {
    await join();
    await waitFor(() => expect(shell().getAttribute('data-phase')).not.toBe('join'));
    expect(typeof handlers.nameMoved).toBe('function');
    return server;
  }

  // rejects: the old phone playing on after the name moved (step 1f's push).
  test('the server\'s nameMoved stops the page on "<Name> is now on another device"', async () => {
    await joinedOnTheOldPhone(makeServer());
    await act(async () => { handlers.nameMoved({ playerName: ME, code: 'NAME_MOVED' }); });
    expect(screen.getByRole('heading', { name: `${ME} is now on another device.` })).toBeInTheDocument();
    expect(screen.getByText(/This page has stopped/)).toBeInTheDocument();
    expect(webSocketClient.disconnect).toHaveBeenCalled();
    expect(dockLabels()).toEqual(['Join again with a different name']);
    expect(localStorage.getItem(`playerName_${GAME}`)).toBeNull();

    // The way on: the join form, the code kept, the name cleared.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Join again with a different name' })); });
    expect(screen.getByPlaceholderText(/Your Name/i).value).toBe('');
    expect(screen.queryByText(/is now on another device/)).toBeNull();
  });

  // rejects: answers that do not say which device sent them (the server
  //          could never refuse the old one).
  test('an answer carries this browser\'s client id; a reconnect asks NAME_CHECK with it', async () => {
    const server = makeServer();
    await joinedOnTheOldPhone(server);
    server.state = 'ASK#001';
    await resync();
    const box = await screen.findByRole('textbox', { name: /Your response/i });
    fireEvent.change(box, { target: { value: 'my answer' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Submit Answer/i })); });
    const sent = webSocketClient.sendCleanMessage.mock.calls.find(([type]) => type === 'ANSWER#001');
    expect(sent).toBeTruthy();
    expect(sent[1].clientId).toBe(localStorage.getItem(`playerClient_${GAME}`));

    const onReconnect = webSocketClient.onReconnected.mock.calls.map(([fn]) => fn).filter(Boolean).pop();
    await act(async () => { onReconnect(); });
    const check = webSocketClient.sendCleanMessage.mock.calls.find(([type]) => type === 'NAME_CHECK');
    expect(check && check[1].clientId).toBe(localStorage.getItem(`playerClient_${GAME}`));
  });

  // rejects: a vote refusal shown as a browser alert, or not at all.
  test('a vote refused with NAME_MOVED stops the page, and the vote carried the client id', async () => {
    const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});
    const server = makeServer({
      vote: () => ({ status: 409, body: { error: 'Name moved', code: 'NAME_MOVED', playerName: ME, message: 'Sam is now on another device. This page has stopped.' } }),
    });
    await joinedOnTheOldPhone(server);
    server.state = 'VOTE#001';
    server.ballot = [...BALLOT];
    await resync();
    await waitFor(() => expect(screen.getAllByRole('combobox').length).toBeGreaterThanOrEqual(3));
    const ranks = screen.getAllByRole('combobox');
    fireEvent.change(ranks[0], { target: { value: '0' } });
    fireEvent.change(ranks[1], { target: { value: '1' } });
    fireEvent.change(ranks[2], { target: { value: '2' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Submit Votes/i })); });

    await waitFor(() => expect(screen.getByRole('heading', { name: `${ME} is now on another device.` })).toBeInTheDocument());
    expect(server.votes[0].clientId).toBeTruthy();
    expect(server.votes[0].clientId).toBe(localStorage.getItem(`playerClient_${GAME}`));
    expect(alertSpy).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  // rejects: the old phone, reloaded, being offered "ask the host" for the
  //          name it has just handed on.
  test('a rejoin refused with nameMoved shows the moved screen, not the collision', async () => {
    makeServer({
      joinBody: () => ({ status: 409, body: { code: 'NAME_TAKEN', playerName: ME, nameMoved: true, message: 'Sam is now on another device. This page has stopped.' } }),
    });
    await join();
    await waitFor(() => expect(screen.getByRole('heading', { name: `${ME} is now on another device.` })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /use my name on this device/i })).toBeNull();
  });
});
