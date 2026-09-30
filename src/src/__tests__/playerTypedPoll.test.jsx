/**
 * A TYPED POLL ON THE PHONE — PlayerPage in a poll round (typed polls,
 * 27 Sep 2026). The owner's report: "an example AI rendered medium Poll item
 * but didn't give options but open text box."
 *
 * rejects: a poll question drawn as a free-text box when it carries options;
 * a Submit that sends before anything is picked; an answer sent as text
 * instead of the value the server checks; a binary that ignores its labels;
 * a receipt that shows the raw value instead of words.
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

function installServer(poll) {
  const question = { title: 'Best day to meet in person?', detail: 'Once a week.', questionNumber: '001', id: '001', poll };
  global.fetch.mockImplementation((url, options) => {
    const u = String(url);
    const method = (options && options.method) || 'GET';
    let body = {};
    if (method === 'POST' && u.includes(`games/${GAME}/players`)) body = { success: true, playerName: ME };
    else if (u.includes(`games/${GAME}/state`)) {
      body = { state: 'ASK#001', gameType: 'poll', currentQuestion: '001' };
      if (/\/state\/[^/?]+/.test(u)) body.playerQuestionState = { questionNumber: 1, hasAnswered: false, hasVoted: false };
    } else if (u.includes(`games/${GAME}/question`)) body = question;
    else if (u.includes(`games/${GAME}/players`)) body = { players: [{ name: ME, playerName: ME, score: 0 }] };
    else if (u.includes('question-sets')) body = { sets: [] };
    else if (u.includes(`games/${GAME}`)) body = { engagementInfo: '' };
    return Promise.resolve({ ok: true, status: 200, json: async () => body });
  });
}

async function joinAndReachQuestion() {
  render(<PlayerPage />);
  fireEvent.change(screen.getByPlaceholderText(/Game ID/i), { target: { value: GAME } });
  fireEvent.change(screen.getByPlaceholderText(/Your Name/i), { target: { value: ME } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Join Game/i })); });
  await waitFor(() => expect(screen.getByText(/Best day to meet in person/)).toBeInTheDocument());
}

const submit = () => screen.getByRole('button', { name: /Submit Answer/i });

beforeEach(() => {
  global.fetch.mockClear();
  ws.sendCleanMessage.mockClear();
  localStorage.clear();
  window.history.pushState({}, '', '/play');
});

test('a choice poll draws its options, not a text box, and sends the pick as a value', async () => {
  installServer({ kind: 'choice', options: ['Monday', 'Wednesday', 'Friday'], allowMultiple: false, allowOther: false, shuffle: false, required: false });
  await joinAndReachQuestion();

  expect(document.querySelector('#plr-answer')).toBeNull();
  expect(submit()).toBeDisabled();
  fireEvent.click(screen.getByRole('radio', { name: /Friday/ }));
  expect(submit()).not.toBeDisabled();
  await act(async () => { fireEvent.click(submit()); });

  expect(ws.sendCleanMessage).toHaveBeenCalledWith('ANSWER#001', { answer: [2], answerType: 'poll' });
  await waitFor(() => expect(screen.getByText('Answer In!')).toBeInTheDocument());
  expect(screen.getByText('Friday')).toBeInTheDocument();
});

test('a rating poll sends the number', async () => {
  installServer({ kind: 'rating', scale: '1-5', lowLabel: 'Not at all', highLabel: 'Completely', required: false });
  await joinAndReachQuestion();
  fireEvent.click(screen.getByRole('radio', { name: '4 of 5' }));
  await act(async () => { fireEvent.click(submit()); });
  expect(ws.sendCleanMessage).toHaveBeenCalledWith('ANSWER#001', { answer: 4, answerType: 'poll' });
});

test('a binary poll reads in its own labels and sends {v}', async () => {
  installServer({ kind: 'yesno', yesLabel: 'Approve', noLabel: 'Decline', unsure: false, followUpWhen: '', required: false });
  await joinAndReachQuestion();
  fireEvent.click(screen.getByRole('radio', { name: /Approve/ }));
  await act(async () => { fireEvent.click(submit()); });
  expect(ws.sendCleanMessage).toHaveBeenCalledWith('ANSWER#001', { answer: { v: 'yes' }, answerType: 'poll' });
  await waitFor(() => expect(screen.getByText('Approve')).toBeInTheDocument());
});

// QA 2026-09-29 #1: a poll answer sent while the socket is down is held, shown
// in words rather than as its raw value, and can be taken back to change.
test('a poll answer that could not be sent is held in words, never shown as in', async () => {
  sessionStorage.clear();
  installServer({ kind: 'choice', options: ['Monday', 'Wednesday', 'Friday'], allowMultiple: false, allowOther: false, shuffle: false, required: false });
  await joinAndReachQuestion();
  ws.sendCleanMessage.mockReturnValueOnce(false);
  fireEvent.click(screen.getByRole('radio', { name: /Friday/ }));
  await act(async () => { fireEvent.click(submit()); });

  expect(screen.queryByText('Answer In!')).not.toBeInTheDocument();
  expect(screen.getByText(/^Not sent yet$/)).toBeInTheDocument();
  expect(screen.getByText('Friday')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /Change my answer/i }));
  expect(screen.getByRole('radio', { name: /Friday/ })).toBeChecked();
  expect(submit()).not.toBeDisabled();
});
