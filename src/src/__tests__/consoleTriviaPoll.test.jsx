/**
 * TRIVIA AND POLL ON THE CONSOLE (experience plan 2g; PLAN §3.2a Trivia and
 * Poll columns, §3.2b the person row's added fact, §7 decision 10).
 *
 *   - Trivia's content area: the question, each option with its live count,
 *     and the PRIVATE answer ("B is correct. Only you see this.").
 *   - Pulse tile 3 for Trivia: "Correct so far", host-only.
 *   - The person row: Trivia's score, ✓/✗ in front of it after the reveal;
 *     Poll adds nothing.
 *   - Poll's content area: the live board.
 *   - The Screens group says why Wavelength is one screen instead of hiding
 *     the choice; the Session menu offers two screens for Trivia and Poll.
 *   - On the real page: a trivia round on two screens is the console, its
 *     answer read from the host's door.
 *
 * rejects: the answer said with no letter known; a poll's row carrying a
 * score; Wavelength's chooser simply missing; trivia on two screens falling
 * back to the projector stage.
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen, waitFor, within, act } from '@testing-library/react';
import { TriviaPanel, PollPanel, triviaCounts, correctSoFar } from '../components/console/panels/FormatPanels';
import ConsolePulse from '../components/console/ConsolePulse';
import ConsoleRail from '../components/console/ConsoleRail';
import ScreensGroup from '../components/stage/ScreensGroup';
import { consolePeopleFor, personFactsFor } from '../config/consoleRail';
import { oneScreenWhy } from '../config/surfaces';

jest.mock('../auth/AuthContext', () => ({
  __esModule: true,
  useAuth: () => ({
    currentUser: { username: 'host', attributes: { email: 'host@example.com' } },
    signOut: jest.fn(),
    isAdmin: false,
  }),
  AuthProvider: ({ children }) => children,
}));
jest.mock('../auth/authFetch', () => ({
  __esModule: true,
  authFetch: (...args) => global.fetch(...args),
  getActiveOrgId: () => '',
  setActiveOrgId: () => {},
  ORG_HEADER: 'X-Engage-Org',
  ACTIVE_ORG_STORAGE_KEY: 'engage.activeOrg',
}));
jest.mock('../WebSocketClient', () => ({
  __esModule: true,
  default: {
    connect: jest.fn(),
    disconnect: jest.fn(),
    ensureConnected: jest.fn(),
    isConnected: () => false,
    sendCleanMessage: jest.fn(),
    onConnectionStatusChange: jest.fn(),
    onReconnected: jest.fn(),
    onMessage: jest.fn(),
    offMessage: jest.fn(),
  },
}));

import GameHostPage from '../GameHostPage';
import webSocketClient from '../WebSocketClient';

jest.setTimeout(30000);

const Q = {
  title: 'Fastest growth', questionDetail: 'Which region grew fastest last quarter?',
  optionA: 'North America', optionB: 'Southeast Asia', optionC: 'Western Europe', optionD: 'Latin America',
};
const ASK_ANSWERS = [{ answer: 'B' }, { answer: 'B' }, { answer: 'A' }, { answer: 'C' }, { answer: 'B' }];

describe('Trivia: the question, the live counts and the private answer', () => {
  it('counts each drawn letter, and correct so far against the private letters', () => {
    expect(triviaCounts(ASK_ANSWERS)).toEqual({ A: 1, B: 3, C: 1 });
    expect(correctSoFar(ASK_ANSWERS, ['B'])).toEqual({ right: 3, of: 5 });
    expect(correctSoFar(ASK_ANSWERS, null)).toBeNull();
  });
  it('draws each option with its count and says "B is correct. Only you see this."', () => {
    const { container } = render(<TriviaPanel kicker="Round 4 · Question" question={Q} answers={ASK_ANSWERS} letters={['B']} />);
    expect(screen.getByRole('heading', { name: 'Fastest growth' })).toBeInTheDocument();
    expect(screen.getByText('Which region grew fastest last quarter?')).toBeInTheDocument();
    expect(screen.getByTestId('hc-opt-count-A')).toHaveTextContent('1');
    expect(screen.getByTestId('hc-opt-count-B')).toHaveTextContent('3');
    expect(screen.getByTestId('hc-opt-count-D')).toHaveTextContent('0');
    expect(container.querySelector('.hc-opt.is-correct').getAttribute('data-letter')).toBe('B');
    const line = screen.getByTestId('hc-private-answer');
    expect(line).toHaveTextContent('B is correct.');
    expect(line).toHaveTextContent('Only you see this.');
  });
  it('after the reveal the line says the room\'s window shows it now', () => {
    render(<TriviaPanel question={Q} answers={ASK_ANSWERS} letters={['B']} revealed />);
    expect(screen.getByTestId('hc-private-answer')).toHaveTextContent('The room\'s window shows the answer now.');
  });
  it('a question with no answer marked says so rather than inventing one', () => {
    const { container } = render(<TriviaPanel question={Q} answers={ASK_ANSWERS} letters={null} />);
    expect(container.querySelector('.hc-opt.is-correct')).toBeNull();
    expect(screen.getByTestId('hc-private-answer')).toHaveTextContent(/no answer marked/);
  });
});

describe('Pulse tile 3 for Trivia: "Correct so far"', () => {
  it('takes the third tile, host-only words, and keeps three tiles', () => {
    const { container } = render(<ConsolePulse moment="ANSWERING" players={12} answered={11} now={0} correct={{ right: 6, of: 11 }} />);
    expect(container.querySelectorAll('[data-tile]')).toHaveLength(3);
    const tile = container.querySelector('[data-tile="correct"]');
    expect(within(tile).getByText('Correct so far')).toBeInTheDocument();
    expect(screen.getByTestId('pulse-correct')).toHaveTextContent('6 of 11');
    expect(within(tile).getByText('only you see this')).toBeInTheDocument();
    expect(container.querySelector('[data-tile="since"]')).toBeNull();
  });
  it('after the round a no-vote format says "N here", never "0 voted"', () => {
    const { container } = render(<ConsolePulse moment="RESULTS" players={12} answered={10} now={0} noVote />);
    const tile = container.querySelector('[data-tile="room"]');
    expect(tile).toHaveTextContent('12 here');
    expect(tile).not.toHaveTextContent(/voted/);
  });
  it('without it, tile 3 is "Since this round opened", as before', () => {
    const { container } = render(<ConsolePulse moment="ANSWERING" players={12} answered={11} now={0} />);
    expect(container.querySelector('[data-tile="since"]')).not.toBeNull();
  });
});

describe('the person row\'s one added fact (§3.2b)', () => {
  const players = [{ name: 'Priya', score: 340 }, { name: 'Sam', score: 320 }, { name: 'Dana', score: 0 }];
  it('Trivia: the score; ✓ or ✗ in front of it only once marks are passed (after the reveal)', () => {
    expect(personFactsFor({ gameType: 'trivia', players })).toEqual({
      Priya: { score: 340, mark: null }, Sam: { score: 320, mark: null }, Dana: { score: 0, mark: null },
    });
    const after = personFactsFor({ gameType: 'trivia', players, marks: { Priya: true, Sam: false } });
    expect(after.Priya.mark).toBe('right');
    expect(after.Sam.mark).toBe('wrong');
    expect(after.Dana.mark).toBeNull();
  });
  it('Poll and Wavelength add nothing', () => {
    expect(personFactsFor({ gameType: 'poll', players })).toBeNull();
    expect(personFactsFor({ gameType: 'wavelength', players })).toBeNull();
  });
  it('the rail draws the fact at the row\'s end, the mark before the score', () => {
    const facts = personFactsFor({ gameType: 'trivia', players, marks: { Priya: true, Sam: false } });
    const people = consolePeopleFor({ moment: 'RESULTS', players, facts });
    render(<ConsoleRail moment="RESULTS" people={people} counts={{ players: 3 }} />);
    const rows = screen.getAllByTestId('person-fact');
    expect(rows.map((r) => r.textContent)).toEqual(['✓340', '✗320', '0']);
  });
  it('a poll\'s rows carry no fact', () => {
    const people = consolePeopleFor({ moment: 'RESULTS', players, facts: personFactsFor({ gameType: 'poll', players }) });
    render(<ConsoleRail moment="RESULTS" people={people} counts={{ players: 3 }} />);
    expect(screen.queryByTestId('person-fact')).toBeNull();
  });
});

describe('Poll: the live board', () => {
  const POLL_Q = { title: 'Best day to meet in person?', poll: { kind: 'choice', options: ['Monday', 'Wednesday', 'Thursday', 'Friday'] } };
  it('the board, live while the room answers', () => {
    const { container } = render(<PollPanel kicker="Poll 2 · Ask" question={POLL_Q} tally={{ kind: 'choice', n: 18, counts: [4, 9, 0, 5], other: 0, texts: [] }} live />);
    expect(container.querySelector('.hc-poll .svw[data-poll-kind="choice"]')).not.toBeNull();
    expect(screen.getByText(/18 answered so far/)).toBeInTheDocument();
    expect(screen.getByText(/fills in live on the room's window/)).toBeInTheDocument();
  });
  it('the same board, still, at the results', () => {
    const { container } = render(<PollPanel question={POLL_Q} tally={{ kind: 'choice', n: 18, counts: [4, 9, 0, 5], other: 0, texts: [] }} />);
    expect(container.querySelector('.svw[data-live]')).toBeNull();
  });
});

describe('Screens: two for Trivia and Poll, and why Wavelength is one', () => {
  it('Wavelength: the row says One screen and the reason, with no choice to press', () => {
    const { container } = render(<ScreensGroup offerChoice={false} why={oneScreenWhy('wavelength')} />);
    const row = container.querySelector('[data-row="where-fixed"]');
    expect(row).toHaveTextContent('Where the room watches');
    expect(row).toHaveTextContent('One screen');
    expect(row).toHaveTextContent(/Write and Reveal/);
    expect(screen.queryByRole('button', { name: 'Two screens' })).toBeNull();
  });
  it('Trivia and Poll: the Session menu\'s Screens group offers the choice', () => {
    const panel = fs.readFileSync(path.join(__dirname, '..', 'components', 'stage', 'SessionSetupPanel.jsx'), 'utf8');
    expect(panel).toMatch(/TWO_SURFACE_TYPES\.includes\(gameType \|\| 'call-and-answer'\)/);
    expect(panel).toMatch(/why=\{oneScreenWhy\(gameType\)\}/);
    render(<ScreensGroup offerChoice choice="classic" why="" />);
    expect(screen.getByRole('button', { name: 'Two screens' })).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------ the real page */

const GAME = '3150';
const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });

function mountTrivia({ state = 'ASK#004', choice = 'two', hostAnswer = { round: '004', letters: ['B'] } } = {}) {
  localStorage.clear();
  sessionStorage.clear();
  if (choice) localStorage.setItem('engage.surfaces', choice);
  window.alert = jest.fn();
  window.history.pushState({}, '', `/host?gameId=${GAME}`);
  global.fetch = jest.fn(async (url) => {
    const u = String(url);
    if (u.endsWith(`games/${GAME}`)) return ok({ started: true, gameType: 'trivia' });
    if (u.includes(`games/${GAME}/host-state`)) {
      return ok({
        state,
        currentQuestion: 4,
        currentQuestionData: { ...Q, id: 4 },
        gameMetadata: { gameType: 'trivia', title: 'Friday quiz' },
        presenting: 1,
        presentDetail: { open: true, fullscreen: true, visible: true, statusAt: new Date().toISOString() },
        hostNotes: null,
        hostAnswer,
        answerProgress: { answersReceived: ASK_ANSWERS.length, totalPlayers: 12, answererIds: [] },
      });
    }
    if (u.includes(`games/${GAME}/question?role=host`)) return ok({ id: 'q4', ...Q });
    if (u.includes(`games/${GAME}/answers/host`)) return ok({ answers: ASK_ANSWERS });
    return ok({});
  });
  return render(<GameHostPage />);
}

beforeAll(() => {
  global.ResizeObserver = global.ResizeObserver || class { observe() {} disconnect() {} unobserve() {} };
});
afterEach(() => { localStorage.clear(); });

test('a trivia round on two screens: the console, with the private answer from the host\'s door', async () => {
  const { container } = mountTrivia();
  await waitFor(() => expect(container.querySelector('.hc')).toBeTruthy(), { timeout: 10000 });
  expect(container.querySelector('.stage')).toBeNull();
  await waitFor(() => expect(container.querySelector('[data-format="trivia"]')).toBeTruthy(), { timeout: 10000 });
  await waitFor(() => expect(screen.getByTestId('hc-private-answer')).toHaveTextContent('B is correct.'), { timeout: 10000 });
  // An answer landing refetches the round's answers from the host's door.
  const answered = webSocketClient.onMessage.mock.calls.filter(([type]) => type === 'playerAnswered').pop();
  await act(async () => { answered[1]({ type: 'playerAnswered', gameId: GAME, questionNumber: '004' }); });
  await waitFor(() => expect(screen.getByTestId('hc-opt-count-B')).toHaveTextContent('3'), { timeout: 10000 });
  // Tile 3 is Correct so far: B was picked 3 times of 5.
  await waitFor(() => expect(screen.getByTestId('pulse-correct')).toHaveTextContent('3 of 5'), { timeout: 10000 });
  // The strip names Trivia's steps.
  expect(container.querySelector('.hc-loop').textContent).toMatch(/Question/);
  expect(container.querySelector('.hc-loop').textContent).toMatch(/Reveal/);
});

test('a trivia session before round 1: Setup is the lobby and asks where the room watches', async () => {
  const { container } = mountTrivia({ state: 'CREATED', choice: null, hostAnswer: null });
  await waitFor(() => expect(container.querySelector('.hc')).toBeTruthy(), { timeout: 10000 });
  expect(await screen.findByText('Where will the room watch?', {}, { timeout: 10000 })).toBeInTheDocument();
  expect(screen.getAllByText('Two screens').length).toBeGreaterThan(0);
});

test('a trivia round on one screen keeps the stage (the room sees the laptop)', async () => {
  const { container } = mountTrivia({ choice: 'classic' });
  await waitFor(() => expect(container.querySelector('.stage')).toBeTruthy(), { timeout: 10000 });
  expect(container.querySelector('[data-format="trivia"]')).toBeNull();
});
