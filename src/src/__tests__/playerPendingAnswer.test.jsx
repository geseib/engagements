import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import PlayerPage from '../PlayerPage';
import webSocketClient from '../WebSocketClient';
import { pendingAnswerKey, pendingVerdict } from '../utils/pendingAnswer';

/*
 * QA DRIVE 2026-09-29, FINDING #1 (High): an answer sent while the socket was
 * down was silently lost. `sendCleanMessage` returned false, the page ignored
 * it and showed "Submitted … If this page reloads, it comes back", and the
 * server held nothing.
 *
 * The socket is a stub whose `sendCleanMessage` result each test controls, and
 * whose connection callback the tests fire by hand — that callback is the
 * page's only way of hearing that the socket is back.
 */
jest.mock('../WebSocketClient', () => ({
  __esModule: true,
  default: {
    connect: jest.fn(),
    disconnect: jest.fn(),
    ensureConnected: jest.fn(),
    sendCleanMessage: jest.fn(() => false),
    onConnectionStatusChange: jest.fn(),
    onReconnected: jest.fn(),
    onMessage: jest.fn(),
    offMessage: jest.fn(),
  },
}));

const GAME = 'TEST123';
const ME = 'TestPlayer';
const KEY = pendingAnswerKey(GAME, ME);

function makeServer() {
  const server = {
    state: 'ASK#001',
    answerers: [],
    question: {
      title: 'What is the capital of France?',
      questionNumber: '001',
      id: '001',
      optionA: 'Berlin',
      optionB: 'Paris',
      optionC: 'Rome',
      optionD: 'Madrid',
    },
  };
  server.handle = (url, options) => {
    const method = options?.method || 'GET';
    if (method === 'POST' && url.includes(`games/${GAME}/players`)) {
      return { success: true, playerName: ME };
    }
    if (url.includes(`games/${GAME}/state`)) {
      const body = { state: server.state, gameType: 'trivia', currentQuestion: '001' };
      if (/\/state\/[^/?]+/.test(url)) {
        body.playerQuestionState = {
          questionNumber: 1,
          hasAnswered: server.answerers.includes(ME),
          hasVoted: false,
        };
      }
      return body;
    }
    if (url.includes(`games/${GAME}/question`)) return server.question;
    if (url.includes(`games/${GAME}/answers`)) return { gameId: GAME, answerCount: 0 };
    if (url.includes(`games/${GAME}/players`)) {
      return { players: [{ name: ME, playerName: ME, score: 0 }] };
    }
    if (url.includes('question-sets')) return { sets: [] };
    return {};
  };
  global.fetch.mockImplementation((url, options) => Promise.resolve({
    ok: true,
    status: 200,
    json: async () => server.handle(String(url), options),
  }));
  return server;
}

/** Tell the page the socket is up (or down), the way WebSocketClient does. */
async function setConnected(up) {
  const calls = webSocketClient.onConnectionStatusChange.mock.calls
    .filter(([cb]) => typeof cb === 'function');
  const cb = calls[calls.length - 1][0];
  await act(async () => { cb(up); });
}

async function joinAndReachQuestion() {
  render(<PlayerPage />);
  fireEvent.change(screen.getByPlaceholderText(/Game ID/i), { target: { value: GAME } });
  fireEvent.change(screen.getByPlaceholderText(/Your Name/i), { target: { value: ME } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /Join Game/i }));
  });
  await screen.findByText(/What is the capital of France/i);
}

async function pickParisAndSubmit() {
  fireEvent.click(screen.getByText(/Paris/));
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /Submit Answer/i }));
  });
}

async function rejoinAfterReload() {
  localStorage.setItem(`playerName_${GAME}`, ME);
  window.history.pushState({}, '', `/play?gameId=${GAME}&name=${ME}`);
  render(<PlayerPage />);
  await act(async () => {
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(`Rejoin as ${ME}`) }));
  });
}

const heldForRoundOne = {
  gameId: GAME, playerName: ME, round: 1,
  messageType: 'ANSWER#001', answer: 'B', answerType: 'trivia',
};

describe('PlayerPage — an answer submitted while offline is held, not lost', () => {
  let server;

  beforeEach(() => {
    global.fetch.mockReset();
    webSocketClient.sendCleanMessage.mockReset();
    webSocketClient.sendCleanMessage.mockReturnValue(false);
    webSocketClient.onConnectionStatusChange.mockClear();
    localStorage.clear();
    sessionStorage.clear();
    window.history.pushState({}, '', '/play');
    server = makeServer();
  });

  // rejects: ignoring sendCleanMessage's `false` — the original bug.
  test('a send that fails shows "Not sent yet", never the submitted receipt', async () => {
    await joinAndReachQuestion();
    await pickParisAndSubmit();

    expect(webSocketClient.sendCleanMessage).toHaveBeenCalledWith(
      'ANSWER#001', expect.objectContaining({ answer: 'B', answerType: 'trivia' })
    );
    expect(screen.queryByText(/Answer Submitted!/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/locked for the round/i)).not.toBeInTheDocument();
    expect(screen.getByText(/^Not sent yet$/)).toBeInTheDocument();
    expect(screen.getByText(/it will send when you're back online/i)).toBeInTheDocument();
    expect(screen.getByText(/B\. Paris/)).toBeInTheDocument();
    // Kept across a reload.
    expect(JSON.parse(sessionStorage.getItem(KEY))).toMatchObject(heldForRoundOne);
  });

  // rejects: holding the answer but never sending it when the socket returns.
  test('the held answer is sent when the socket reconnects, then shows as submitted', async () => {
    await joinAndReachQuestion();
    await pickParisAndSubmit();
    expect(webSocketClient.sendCleanMessage).toHaveBeenCalledTimes(1);

    webSocketClient.sendCleanMessage.mockReturnValue(true);
    await setConnected(true);

    await screen.findByText(/Answer Submitted!/i);
    expect(webSocketClient.sendCleanMessage).toHaveBeenCalledTimes(2);
    expect(webSocketClient.sendCleanMessage).toHaveBeenLastCalledWith(
      'ANSWER#001', { answer: 'B', answerType: 'trivia' }
    );
    expect(screen.queryByText(/^Not sent yet$/)).not.toBeInTheDocument();
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  // rejects: sending on the page's stale belief about the phase. The room
  // moved to VOTE while the phone was offline; the page has not heard yet.
  test('a held answer for a round the room has closed is dropped, not sent', async () => {
    await joinAndReachQuestion();
    await pickParisAndSubmit();

    server.state = 'VOTE#001';
    webSocketClient.sendCleanMessage.mockReturnValue(true);
    await setConnected(true);

    await screen.findByText(/Your last answer did not reach the room/i);
    expect(webSocketClient.sendCleanMessage).toHaveBeenCalledTimes(1);   // the original, failed send only
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  test('a reload while held restores it and sends it once connected', async () => {
    sessionStorage.setItem(KEY, JSON.stringify(heldForRoundOne));
    webSocketClient.sendCleanMessage.mockReturnValue(true);

    await rejoinAfterReload();
    await screen.findByText(/^Not sent yet$/);
    expect(webSocketClient.sendCleanMessage).not.toHaveBeenCalled();

    await setConnected(true);

    await screen.findByText(/Answer Submitted!/i);
    expect(webSocketClient.sendCleanMessage).toHaveBeenCalledWith(
      'ANSWER#001', { answer: 'B', answerType: 'trivia' }
    );
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  test('a reload into a later round drops the held answer without sending it', async () => {
    sessionStorage.setItem(KEY, JSON.stringify(heldForRoundOne));
    server.state = 'ASK#002';
    server.question = {
      title: 'What is the capital of Spain?', questionNumber: '002', id: '002',
      optionA: 'Lisbon', optionB: 'Madrid',
    };
    webSocketClient.sendCleanMessage.mockReturnValue(true);

    await rejoinAfterReload();
    await screen.findByText(/What is the capital of Spain/i);
    await setConnected(true);

    await waitFor(() => expect(sessionStorage.getItem(KEY)).toBeNull());
    expect(webSocketClient.sendCleanMessage).not.toHaveBeenCalled();
    expect(screen.queryByText(/^Not sent yet$/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Submit Answer/i })).toBeInTheDocument();
  });

  // The send that "failed" can still have landed; the server's flag wins.
  test('a held answer the server already has is not sent twice', async () => {
    sessionStorage.setItem(KEY, JSON.stringify(heldForRoundOne));
    server.answerers = [ME];
    webSocketClient.sendCleanMessage.mockReturnValue(true);

    await rejoinAfterReload();
    await screen.findByText(/Answer Submitted!/i);
    await setConnected(true);

    expect(webSocketClient.sendCleanMessage).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(KEY)).toBeNull();
    expect(screen.getByText(/B\. Paris/)).toBeInTheDocument();
  });

  test('"Change my answer" puts the held answer back in the form', async () => {
    await joinAndReachQuestion();
    await pickParisAndSubmit();

    fireEvent.click(screen.getByRole('button', { name: /Change my answer/i }));

    expect(screen.getByText(/Paris/).closest('[role="radio"]')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('button', { name: /Submit Answer/i })).not.toBeDisabled();
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });
});

describe('pendingVerdict — which round a held answer may go into', () => {
  const p = { round: 3 };
  test.each([
    ['ASK#003', 'send'],
    ['ASK#3', 'send'],
    ['VOTE#003', 'drop'],
    ['RESULTS#003', 'drop'],
    ['ASK#004', 'drop'],
    ['ENDED', 'drop'],
    ['ASK#002', 'wait'],
    ['CREATED', 'wait'],
    ['', 'wait'],
  ])('%s → %s', (state, verdict) => {
    expect(pendingVerdict(p, state)).toBe(verdict);
  });
});
