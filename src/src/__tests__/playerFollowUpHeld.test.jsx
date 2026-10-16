/**
 * A DRAFT ANSWER TO A QUESTION FOR THE ROOM, WHEN THE ROOM MOVES ON
 * (session flow v3 §4.4; late items Task 1). PlayerPage end to end, as the
 * other PlayerPage suites drive it: a joined phone on RESULTS#003 answering
 * an Ideas question, then the next round starts.
 *
 * rejects: the draft lost when the round moves on; the held card HIDING the
 * new round's answer box (controller ruling: both on the page).
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import PlayerPage from '../PlayerPage';

jest.mock('../WebSocketClient', () => ({
  __esModule: true,
  default: {
    connect: jest.fn(),
    disconnect: jest.fn(),
    ensureConnected: jest.fn(),
    sendCleanMessage: jest.fn(() => true),
    onConnectionStatusChange: jest.fn(),
    onReconnected: jest.fn(),
    onMessage: jest.fn(),
    offMessage: jest.fn(),
  },
}));
const ws = require('../WebSocketClient').default;

const GAME = '4821';
const ME = 'Ana';
const ASK = { askId: 'k1abc', round: '003', kind: 'ideas', status: 'live', question: 'Who pushes back first?', picked: [] };
let state = 'RESULTS#003';
let live = ASK;

function installServer() {
  global.fetch.mockImplementation((url, options) => {
    const u = String(url);
    const method = (options && options.method) || 'GET';
    let body = {};
    if (method === 'POST' && u.includes('followup-play/asks/')) body = { gameId: GAME, askId: ASK.askId, yours: 'x', late: true };
    else if (method === 'POST' && u.includes(`games/${GAME}/players`)) body = { success: true, playerName: ME };
    else if (u.includes('followup-play/live')) body = { gameId: GAME, beat: 'ask', ask: live };
    else if (u.includes(`games/${GAME}/state`)) {
      const n = Number(state.split('#')[1]);
      body = { state, gameType: 'call-and-answer', currentQuestion: String(n).padStart(3, '0') };
      if (/\/state\/[^/?]+/.test(u)) body.playerQuestionState = { questionNumber: n, hasAnswered: false, hasVoted: false };
    } else if (u.includes(`games/${GAME}/question`)) body = { title: 'Round four', detail: 'Next.', questionNumber: '004', id: '004' };
    else if (u.includes(`games/${GAME}/players`)) body = { players: [{ name: ME, playerName: ME, score: 0 }] };
    else if (u.includes('question-sets')) body = { sets: [] };
    else if (u.includes(`games/${GAME}`)) body = { engagementInfo: '' };
    return Promise.resolve({ ok: true, status: 200, json: async () => body });
  });
}

const handler = (type) => {
  const reg = ws.onMessage.mock.calls.filter(([t]) => t === type);
  return reg[reg.length - 1][1];
};

beforeEach(() => {
  global.fetch.mockClear();
  ws.onMessage.mockClear();
  localStorage.clear();
  sessionStorage.clear();
  window.history.pushState({}, '', '/play');
  state = 'RESULTS#003';
  live = ASK;
});

test('the next round starts with a draft: the held card and the new answer box are both on the page', async () => {
  installServer();
  render(<PlayerPage />);
  fireEvent.change(screen.getByPlaceholderText(/Game ID/i), { target: { value: GAME } });
  fireEvent.change(screen.getByPlaceholderText(/Your Name/i), { target: { value: ME } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Join Game/i })); });
  await waitFor(() => expect(screen.getByText('Who pushes back first?')).toBeInTheDocument());

  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'The finance team' } });

  state = 'ASK#004';
  live = null;
  await act(async () => { handler('questionStarted')({ state: `GAME#${GAME} ASK#004` }); });

  await waitFor(() => expect(document.querySelector('#plr-answer')).not.toBeNull());
  expect(screen.getByText('Who pushes back first?')).toBeInTheDocument();
  expect(screen.getByDisplayValue('The finance team')).toBeInTheDocument();
  expect(screen.getByText('The room has moved on. Your answer is still here, and you can still send it.')).toBeInTheDocument();

  // Send still works, and is kept late; Done lets it go; the round's box stays.
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })); });
  expect(await screen.findByText('The results are already up. Your answer is kept, but not in the count.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  expect(screen.queryByText('Who pushes back first?')).toBeNull();
  expect(document.querySelector('#plr-answer')).not.toBeNull();
});
