/**
 * ONE SCREEN GRAMMAR ON EVERY PARTICIPANT TYPE, RENDERED (experience plan 3a;
 * audit C §1.9, P6, P7, P10).
 *
 * rejects, per type: a receipt that is not "Sent / Your <thing> is in." (audit
 * C counted six headings); a wait that is not "Waiting for the host."; a bar
 * that does not say "Round 1 · Answer" / "Round 1 · Vote"; a results heading
 * at the hero size on one type and not another; an end screen that prints
 * "Final score 0" on a poll or Wavelength, or thanks a poll "for playing", or
 * leaves the strip neutral; a join screen that says "Join Game", "Game ID" or
 * "Game not found", or draws a plain text field instead of the one four-cell
 * code widget.
 *
 * jsdom has no layout: sizes are asserted as the class that carries them
 * (`plr-h1--primary`, the one heading rung), never as pixels.
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
    isConnected: () => false,
    sendCleanMessage: jest.fn(() => true),
    onConnectionStatusChange: jest.fn(),
    onReconnected: jest.fn(),
    onMessage: jest.fn(),
    offMessage: jest.fn(),
  },
}));

const GAME = '7123';
const ME = 'Ada';

function makeServer(overrides = {}) {
  const server = {
    state: 'CREATED',
    gameType: 'call-and-answer',
    answered: false,
    voted: false,
    joinStatus: 200,
    joinBody: { success: true, playerName: ME },
    question: {
      title: 'What slows us down?',
      detail: 'Name the one thing.',
      questionNumber: '001',
      id: '001',
      optionA: 'Berlin',
      optionB: 'Paris',
      correctAnswer: 'OptionB',
    },
    ...overrides,
  };
  server.handle = (url, options) => {
    const method = options?.method || 'GET';
    if (method === 'POST' && url.includes(`games/${GAME}/players`)) {
      return { status: server.joinStatus, body: server.joinBody };
    }
    if (url.includes(`games/${GAME}/state`)) {
      const body = { state: server.state, gameType: server.gameType, currentQuestion: '001', commentsOpen: false };
      if (/\/state\/[^/?]+/.test(url)) {
        body.playerQuestionState = { questionNumber: 1, hasAnswered: server.answered, hasVoted: server.voted };
      }
      return { status: 200, body };
    }
    if (url.includes(`games/${GAME}/question`)) return { status: 200, body: server.question };
    if (url.includes(`games/${GAME}/answers`)) return { status: 200, body: { gameId: GAME, questionId: '001', answerCount: 0 } };
    if (url.includes(`games/${GAME}/players`)) {
      return { status: 200, body: { players: [{ name: ME, playerName: ME, score: 0, totalScore: 0 }] } };
    }
    return { status: 200, body: {} };
  };
  global.fetch.mockImplementation((url, options) => {
    const { status, body } = server.handle(String(url), options);
    return Promise.resolve({ ok: status < 300, status, json: async () => body });
  });
  return server;
}

async function join() {
  render(<PlayerPage />);
  fireEvent.change(screen.getByLabelText(/Session code/i), { target: { value: GAME } });
  fireEvent.change(screen.getByPlaceholderText(/Your Name/i), { target: { value: ME } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /^Join$/ }));
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

const ctx = () => document.querySelector('.plr-ctx')?.textContent || '';
const eyebrow = () => document.querySelector('.plr-stage .plr-lab')?.textContent || '';
const heading = () => document.querySelector('.plr-stage h1');

beforeEach(() => {
  global.fetch.mockReset();
  localStorage.clear();
  window.history.pushState({}, '', '/play');
});

describe('joining says "session", with one code widget and a friendly wrong-code line', () => {
  test('the join screen: "Join the session." and a Join button, never "game"', () => {
    makeServer();
    render(<PlayerPage />);
    expect(screen.getByRole('heading', { name: 'Join the session.' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Join' })).toBeInTheDocument();
    expect(ctx()).toBe('Join the session');
    expect(document.body.textContent).not.toMatch(/\bgame\b/i);
    expect(screen.queryByPlaceholderText(/Game ID/i)).toBeNull();
  });

  test('the code is the one widget: four cells over one labelled input', () => {
    makeServer();
    render(<PlayerPage />);
    const input = screen.getByLabelText(/Session code/i);
    expect(input.closest('.plr-codewrap')).not.toBeNull();
    expect(document.querySelectorAll('.plr-cell')).toHaveLength(4);
    fireEvent.change(input, { target: { value: '7-1 23x9' } });
    // Digits only, four at most: what the cells can show.
    expect(input).toHaveValue('7123');
    expect([...document.querySelectorAll('.plr-cell')].map((c) => c.textContent).join('')).toBe('7123');
  });

  test('a wrong code reads the friendly line, not "Game not found"', async () => {
    makeServer({ joinStatus: 404, joinBody: { error: 'Game not found' } });
    await join();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/Nothing is running under 7123\./);
    expect(alert).not.toHaveTextContent(/game/i);
  });
});

describe('the bar says where you are', () => {
  test('ASK is "Round 1 · Answer" and VOTE is "Round 1 · Vote"', async () => {
    const server = makeServer();
    await join();
    server.state = 'ASK#001';
    await resync();
    await waitFor(() => expect(ctx()).toBe('Round 1 · Answer'));
    server.state = 'VOTE#001';
    await resync();
    await waitFor(() => expect(ctx()).toBe('Round 1 · Vote'));
  });
});

describe('one receipt per type: "Sent", then "Your <thing> is in."', () => {
  test.each([
    ['call-and-answer', {}, 'Your answer is in.'],
    ['call-and-answer', { image: 'https://example.test/art.png' }, 'Your title is in.'],
    ['trivia', {}, 'Your answer is in.'],
    ['poll', {}, 'Your answer is in.'],
    ['wavelength', {}, 'Your words are in.'],
  ])('%s %j', async (gameType, extra, expected) => {
    const server = makeServer({ gameType, answered: true });
    server.question = { ...server.question, ...extra };
    await join();
    server.state = 'ASK#001';
    await resync();
    await waitFor(() => expect(heading()).toHaveTextContent(expected));
    expect(eyebrow()).toBe('Sent');
    expect(heading()).toHaveClass('plr-h1--primary');
    expect(document.body.textContent).not.toMatch(/Submitted!|Answer In!|received\./);
  });

  test('a ballot sent is "Your votes are in."', async () => {
    const server = makeServer({ voted: true });
    await join();
    server.state = 'VOTE#001';
    await resync();
    await waitFor(() => expect(heading()).toHaveTextContent('Your votes are in.'));
    expect(eyebrow()).toBe('Sent');
  });
});

describe('one way to say wait', () => {
  test('the lobby: "You’re in as Ada", "Waiting for the host."', async () => {
    makeServer();
    await join();
    await waitFor(() => expect(heading()).toHaveTextContent('Waiting for the host.'));
    expect(eyebrow()).toBe('You’re in as Ada');
    expect(document.body.textContent).not.toMatch(/Waiting for the game/);
  });

  test('before the ballot: "Voting next", the same heading, and the question named', async () => {
    const server = makeServer();
    await join();
    server.state = 'VOTE#001';
    await resync();
    await waitFor(() => expect(eyebrow()).toBe('Voting next'));
    expect(heading()).toHaveTextContent('Waiting for the host.');
    expect(document.body.textContent).toMatch(/Name the one thing\./);
  });
});

describe('results: one heading at one size on every type', () => {
  test.each(['call-and-answer', 'trivia', 'wavelength'])('%s', async (gameType) => {
    const server = makeServer({ gameType });
    await join();
    server.state = 'RESULTS#001';
    await resync();
    await waitFor(() => expect(eyebrow()).toBe('Your result'));
    expect(heading()).toHaveClass('plr-h1--primary');
  });
});

describe('one ended screen: score only where the format scores', () => {
  test.each([
    ['trivia', true],
    ['call-and-answer', true],
    ['poll', false],
    ['wavelength', false],
  ])('%s scored=%s', async (gameType, scored) => {
    const server = makeServer({ gameType });
    await join();
    server.state = 'ENDED';
    await resync();
    await waitFor(() => expect(eyebrow()).toBe('That’s a wrap'));
    expect(heading()).toHaveTextContent(scored ? 'Thanks for playing, Ada.' : 'Thanks for taking part, Ada.');
    expect(Boolean(screen.queryByText('Final score'))).toBe(scored);
    expect(document.querySelector('.plr')).toHaveAttribute('data-phase', 'done');
    expect(ctx()).toBe('Session complete');
    expect(screen.getByText(/You can close this page/)).toBeInTheDocument();
    // Outside an event there is nothing to press.
    expect(document.querySelector('.plr-dock')).toBeNull();
  });
});
