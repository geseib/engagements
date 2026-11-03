/**
 * THE NEXT THING IS IN THE DOCK (experience plan PLAN.md §2 principle 8, §6
 * Phase 3 step 3d; audit C problems P4 and P9).
 *
 * On the participant phone, whatever a participant can do next lives in the
 * player shell's dock, outside the scrolling stage, so it can never scroll out
 * of reach. A send that did not go is a line in the dock, never a browser
 * alert. A ballot pressed offline is held and sent on reconnect, as an answer
 * already was.
 *
 * rejects: an orange (main) button in the stage on any participant screen; a
 * type whose primary action renders anywhere but the dock; "Submit Answer" /
 * "Submit Words" / "Submit Votes" coming back; window.alert on a player path;
 * a vote lost because the phone was offline; a vote failure with no word on
 * the screen.
 *
 * NO GEOMETRY (jsdom has no layout engine): "in the dock" is asserted as DOM
 * containment in `.plr-dock`, which is the structural claim the shell makes.
 * One deliberate exception to "no primary in the stage": the comment
 * composer's Post (`.fbr__post`) lives in a sheet that sticks to the foot of
 * the stage (phone-comments 3b D5), so it is never scrolled away either; it is
 * not a ui/Button primary and is not counted here.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import PlayerPage from '../PlayerPage';
import FollowUpCard from '../components/FollowUpCard';
import webSocketClient from '../WebSocketClient';
import { pendingVoteKey, pendingVoteVerdict, isOfflineFailure } from '../utils/pendingVote';
import { SEND, HELD, SEND_FAILED } from '../config/playerWords';

const fs = require('fs');
const path = require('path');
const D = require('../testing/driftScan');

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

const GAME = '7123';
const ME = 'TestPlayer';
const BALLOT = [
  { answer: 'A careful answer about intake forms' },
  { answer: 'Another answer' },
  { answer: 'A third answer' },
];
const ASK = { askId: 'k1abc', round: '001', kind: 'ideas', status: 'live', question: 'Who pushes back first?', picked: [] };

function makeServer(overrides = {}) {
  const server = {
    state: 'CREATED',
    gameType: 'call-and-answer',
    ballot: [],
    voted: false,
    ask: null,
    commentsOpen: true,
    currentQuestion: '001',
    votePosts: [],
    // (body) => { status, body } | 'offline'
    vote: () => ({ status: 200, body: { message: 'Vote submitted successfully' } }),
    question: {
      title: 'What is the capital of France?',
      detail: 'Our regional teams each built their own intake process.',
      questionNumber: '001',
      id: '001',
      optionA: 'Berlin',
      optionB: 'Paris',
      optionC: 'Rome',
      optionD: 'Madrid',
      correctAnswer: 'OptionB',
    },
    ...overrides,
  };
  global.fetch.mockImplementation((url, options) => {
    const u = String(url);
    const method = options?.method || 'GET';
    const reply = (status, body) => Promise.resolve({ ok: status < 400, status, json: async () => body });
    if (method === 'POST' && u.includes(`games/${GAME}/votes`)) {
      const sent = JSON.parse(options.body);
      server.votePosts.push(sent);
      const r = server.vote(sent);
      if (r === 'offline') return Promise.reject(new TypeError('Failed to fetch'));
      return reply(r.status, r.body);
    }
    if (method === 'POST' && u.includes(`games/${GAME}/players`)) return reply(200, { success: true, playerName: ME });
    if (u.includes('followup-play/live')) {
      return server.ask ? reply(200, { gameId: GAME, beat: 'ask', ask: server.ask }) : reply(404, {});
    }
    if (u.includes(`games/${GAME}/state`)) {
      const body = { state: server.state, gameType: server.gameType, currentQuestion: server.currentQuestion, commentsOpen: server.commentsOpen };
      if (/\/state\/[^/?]+/.test(u)) {
        body.playerQuestionState = { questionNumber: 1, hasAnswered: false, hasVoted: server.voted };
      }
      return reply(200, body);
    }
    if (u.includes(`games/${GAME}/question`)) return reply(200, server.question);
    if (u.includes(`games/${GAME}/answers`)) {
      const body = { gameId: GAME, questionId: '001', answerCount: server.ballot.length };
      if (server.ballot.length) body.answers = [...server.ballot];
      return reply(200, body);
    }
    if (u.includes(`games/${GAME}/players`)) return reply(200, { players: [{ name: ME, playerName: ME, score: 0 }] });
    if (u.includes('question-sets')) return reply(200, { sets: [] });
    if (u.includes(`games/${GAME}`)) return reply(200, { engagementInfo: '' });
    return reply(200, {});
  });
  return server;
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

async function join() {
  render(<PlayerPage />);
  fireEvent.change(screen.getByLabelText(/Session code/i), { target: { value: GAME } });
  fireEvent.change(screen.getByPlaceholderText(/Your Name/i), { target: { value: ME } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Join$/i })); });
}

async function reach(server, state) {
  await join();
  server.state = state;
  await resync();
}

/** Tell the page the socket is up, the way WebSocketClient does. */
async function setConnected(up) {
  const calls = webSocketClient.onConnectionStatusChange.mock.calls.filter(([cb]) => typeof cb === 'function');
  const cb = calls[calls.length - 1][0];
  await act(async () => { cb(up); });
}

const dock = () => document.querySelector('.plr-dock');
const stage = () => document.querySelector('.plr-stage');
/** A main (orange) button: ui/Button's primary (step 5a moved the dock onto it). */
const mainButtons = (root) => [...root.querySelectorAll('button.ui-btn--action')];

function expectNoMainInStage() {
  expect(stage()).not.toBeNull();
  expect(mainButtons(stage())).toHaveLength(0);
}

async function fillBallot() {
  await waitFor(() => expect(screen.getAllByRole('combobox').length).toBeGreaterThanOrEqual(3));
  const ranks = screen.getAllByRole('combobox');
  fireEvent.change(ranks[0], { target: { value: '0' } });
  fireEvent.change(ranks[1], { target: { value: '1' } });
  fireEvent.change(ranks[2], { target: { value: '2' } });
}

let alertSpy;
beforeEach(() => {
  global.fetch.mockReset();
  webSocketClient.sendCleanMessage.mockReset();
  webSocketClient.sendCleanMessage.mockReturnValue(true);
  webSocketClient.onConnectionStatusChange.mockClear();
  localStorage.clear();
  sessionStorage.clear();
  window.history.pushState({}, '', '/play');
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});
});
afterEach(() => {
  // No player path may raise a browser alert, on any screen this file drives.
  expect(alertSpy).not.toHaveBeenCalled();
  alertSpy.mockRestore();
});

/* ======================================================================= */

describe('per type, the primary action renders in the dock, and the stage has no main button', () => {
  test('Call & Answer: "Send my answer"', async () => {
    const server = makeServer();
    await reach(server, 'ASK#001');
    await screen.findByRole('textbox', { name: /Your response/i });
    const send = screen.getByRole('button', { name: SEND.answer });
    expect(dock().contains(send)).toBe(true);
    expectNoMainInStage();
  });

  test('Trivia: "Send my answer", and the line above it says "send"', async () => {
    const server = makeServer({ gameType: 'trivia' });
    await reach(server, 'ASK#001');
    await screen.findByRole('radiogroup');
    const send = screen.getByRole('button', { name: SEND.answer });
    expect(dock().contains(send)).toBe(true);
    expect(dock().textContent).toContain(SEND.triviaPick);
    expectNoMainInStage();
  });

  test('Wavelength: "Send my words (n/10)"', async () => {
    const server = makeServer({ gameType: 'wavelength' });
    await reach(server, 'ASK#001');
    await screen.findByLabelText('Word 1');
    fireEvent.change(screen.getByLabelText('Word 1'), { target: { value: 'cloud' } });
    const send = screen.getByRole('button', { name: SEND.words(1) });
    expect(send).toHaveTextContent('Send my words (1/10)');
    expect(dock().contains(send)).toBe(true);
    expectNoMainInStage();
  });

  test('Poll: "Send my answer"', async () => {
    const server = makeServer({ gameType: 'poll' });
    server.question = { title: 'Best day?', questionNumber: '001', id: '001', poll: { kind: 'choice', options: ['Monday', 'Friday'], allowMultiple: false, allowOther: false, shuffle: false } };
    await reach(server, 'ASK#001');
    await screen.findByRole('radio', { name: /Friday/ });
    const send = screen.getByRole('button', { name: SEND.answer });
    expect(dock().contains(send)).toBe(true);
    expectNoMainInStage();
  });

  test('the ballot: "Pick N more to send", then "Send my votes"', async () => {
    const server = makeServer({ ballot: [...BALLOT] });
    await reach(server, 'VOTE#001');
    await waitFor(() => expect(screen.getAllByRole('combobox').length).toBeGreaterThan(0));
    expect(dock().contains(screen.getByRole('button', { name: SEND.pickMore(3) }))).toBe(true);
    await fillBallot();
    const send = screen.getByRole('button', { name: SEND.votes });
    expect(dock().contains(send)).toBe(true);
    expectNoMainInStage();
  });

  test('a question for the room: its Send is in the dock, not in the card', async () => {
    const server = makeServer({ ask: ASK });
    await reach(server, 'RESULTS#001');
    await screen.findByText('Who pushes back first?');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'The finance team' } });
    const send = await screen.findByRole('button', { name: 'Send' });
    expect(dock().contains(send)).toBe(true);
    expect(document.querySelector('.fu-card').contains(send)).toBe(false);
    expectNoMainInStage();
  });

  test('results: "Comment on this round" in the dock, nothing pressable in the stage', async () => {
    const server = makeServer({ gameType: 'trivia' });
    await reach(server, 'RESULTS#001');
    await waitFor(() => expect(dock()).not.toBeNull());
    expect(dock().contains(screen.getByRole('button', { name: /Comment on this round/ }))).toBe(true);
    expectNoMainInStage();
  });

  test('the end: "Something to add?" and its rounds are in the dock, not the stage', async () => {
    const server = makeServer({ currentQuestion: '002' });
    await reach(server, 'ENDED');
    await waitFor(() => expect(screen.getByText(/Something to add\?/)).toBeInTheDocument());
    expect(dock().contains(screen.getByText(/Something to add\?/))).toBe(true);
    const rounds = within(dock()).getAllByRole('button', { name: /Round \d/ });
    expect(rounds).toHaveLength(2);
    expect(stage().querySelectorAll('button')).toHaveLength(0);
  });

  test('a comment panel opened from a result: its exit is in the dock', async () => {
    const server = makeServer({ gameType: 'trivia' });
    await reach(server, 'RESULTS#001');
    await waitFor(() => expect(dock()).not.toBeNull());
    fireEvent.click(screen.getByRole('button', { name: /Comment on this round/ }));
    await waitFor(() => expect(document.body.textContent).toMatch(/Comments/));
    const exits = screen.getAllByRole('button', { name: 'Close' });
    expect(exits.some((b) => dock().contains(b))).toBe(true);
    expectNoMainInStage();
  });
});

/* ======================================================================= */

describe('the labels say "send", in the playerWords grammar', () => {
  test('the words', () => {
    expect(SEND.answer).toBe('Send my answer');
    expect(SEND.words(4)).toBe('Send my words (4/10)');
    expect(SEND.votes).toBe('Send my votes');
    expect(SEND.pickMore(2)).toBe('Pick 2 more to send');
  });

  test('PlayerPage spells no "Submit Answer", "Submit Words" or "Submit Votes"', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'PlayerPage.jsx'), 'utf8');
    expect(src).not.toMatch(/Submit (Answer|Words|Votes)/);
    expect(src).not.toMatch(/more to submit/);
  });
});

/* ======================================================================= */

describe('no browser dialog on a player path', () => {
  const PLAYER_FILES = [
    'PlayerPage.jsx',
    'components/PlayerShell.jsx',
    'components/PlayerEnded.jsx',
    'components/FollowUpCard.jsx',
    'components/FeedbackRoundPanel.jsx',
    'components/survey/SurveyRunner.jsx',
    'buildroom/BuildPlayer.jsx',
  ];
  test.each(PLAYER_FILES)('%s calls no alert() or confirm()', (rel) => {
    const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
    expect(D.scanDialogs(src, rel)).toEqual([]);
  });

  test('an answer that throws on the way out says so in the dock', async () => {
    const server = makeServer();
    await reach(server, 'ASK#001');
    await screen.findByRole('textbox', { name: /Your response/i });
    webSocketClient.sendCleanMessage.mockImplementation(() => { throw new Error('socket exploded'); });
    fireEvent.change(screen.getByRole('textbox', { name: /Your response/i }), { target: { value: 'An answer' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: SEND.answer })); });
    const line = within(dock()).getByRole('alert');
    expect(line).toHaveTextContent(SEND_FAILED.answer);
  });
});

/* ======================================================================= */

describe('a vote that fails is a line in the dock', () => {
  test('a refused vote: the dock says so, the ballot and its button stay', async () => {
    const server = makeServer({ ballot: [...BALLOT], vote: () => ({ status: 500, body: { error: 'boom' } }) });
    await reach(server, 'VOTE#001');
    await fillBallot();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: SEND.votes })); });
    await waitFor(() => expect(within(dock()).getByRole('alert')).toHaveTextContent(SEND_FAILED.votes));
    expect(screen.getByRole('button', { name: SEND.votes })).not.toBeDisabled();
    expect(screen.queryByText(/Your votes are in/)).toBeNull();
  });

  test('voting closed under the ballot: the result says so in its dock', async () => {
    const server = makeServer({ ballot: [...BALLOT] });
    server.vote = () => {
      server.state = 'RESULTS#001';
      return { status: 400, body: { error: 'Invalid game state for voting', currentState: 'RESULTS#001' } };
    };
    await reach(server, 'VOTE#001');
    await fillBallot();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: SEND.votes })); });
    await waitFor(() => expect(dock()?.textContent || '').toContain(SEND_FAILED.votesClosed));
    expect(dock().contains(screen.getByRole('button', { name: /Comment on this round/ }))).toBe(true);
  });
});

/* ======================================================================= */

describe('a ballot pressed offline is held, and sent when the connection is back', () => {
  test('held with the same line as an answer, then sent on reconnect', async () => {
    const server = makeServer({ ballot: [...BALLOT], vote: () => 'offline' });
    await reach(server, 'VOTE#001');
    await fillBallot();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: SEND.votes })); });

    await screen.findByText(HELD.heading);
    expect(screen.getByText(HELD.eyebrow)).toBeInTheDocument();
    expect(within(dock()).getByRole('status')).toHaveTextContent(HELD.line);
    expect(dock().contains(screen.getByRole('button', { name: HELD.changeVotes }))).toBe(true);
    expect(screen.queryByText(/Your votes are in/)).toBeNull();
    expect(JSON.parse(sessionStorage.getItem(pendingVoteKey(GAME, ME)))).toMatchObject({
      gameId: GAME, playerName: ME, round: 1, votes: { 0: 1, 1: 2, 2: 3 },
    });
    expectNoMainInStage();

    server.vote = () => ({ status: 200, body: { message: 'ok' } });
    const before = server.votePosts.length;
    await setConnected(true);

    await screen.findByText(/Your votes are in/);
    expect(server.votePosts.length).toBe(before + 1);
    expect(server.votePosts[server.votePosts.length - 1]).toMatchObject({
      playerName: ME, votes: { 0: 1, 1: 2, 2: 3 }, clientId: expect.any(String),
    });
    expect(sessionStorage.getItem(pendingVoteKey(GAME, ME))).toBeNull();
  });

  test('voting closed while offline: dropped, never resent, and the dock says it did not count', async () => {
    const server = makeServer({ ballot: [...BALLOT], vote: () => 'offline' });
    await reach(server, 'VOTE#001');
    await fillBallot();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: SEND.votes })); });
    await screen.findByText(HELD.heading);

    server.state = 'RESULTS#001';
    server.vote = () => ({ status: 200, body: {} });
    const before = server.votePosts.length;
    await setConnected(true);

    await waitFor(() => expect(sessionStorage.getItem(pendingVoteKey(GAME, ME))).toBeNull());
    expect(server.votePosts.length).toBe(before);
    await resync();
    await waitFor(() => expect(dock()?.textContent || '').toContain(SEND_FAILED.votesMissed));
  });

  test('"Change my votes" puts the held ballot back', async () => {
    const server = makeServer({ ballot: [...BALLOT], vote: () => 'offline' });
    await reach(server, 'VOTE#001');
    await fillBallot();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: SEND.votes })); });
    fireEvent.click(await screen.findByRole('button', { name: HELD.changeVotes }));
    const ranks = screen.getAllByRole('combobox');
    expect(ranks.slice(0, 3).map((r) => r.value)).toEqual(['0', '1', '2']);
    expect(screen.getByRole('button', { name: SEND.votes })).not.toBeDisabled();
    expect(sessionStorage.getItem(pendingVoteKey(GAME, ME))).toBeNull();
  });
});

describe('pendingVoteVerdict: a ballot only ever counts in its own round', () => {
  const p = { round: 3 };
  test.each([
    ['VOTE#003', 'send'],
    ['ASK#003', 'wait'],
    ['ASK#002', 'wait'],
    ['RESULTS#003', 'drop'],
    ['ASK#004', 'drop'],
    ['VOTE#004', 'drop'],
    ['ENDED', 'drop'],
    ['CREATED', 'wait'],
  ])('%s → %s', (state, verdict) => {
    expect(pendingVoteVerdict(p, state)).toBe(verdict);
  });

  test('which failures are the network\'s', () => {
    expect(isOfflineFailure(new TypeError('Failed to fetch'))).toBe(true);
    expect(isOfflineFailure(null, 503)).toBe(true);
    expect(isOfflineFailure(null, 500)).toBe(false);
    expect(isOfflineFailure(null, 400)).toBe(false);
  });
});

/* ======================================================================= */

describe('FollowUpCard draws its actions where it is told', () => {
  test('into a dock element through a portal; nothing while the slot is not there yet', () => {
    const slot = document.createElement('div');
    document.body.appendChild(slot);
    const { rerender, container } = render(<FollowUpCard ask={ASK} onSend={jest.fn()} actionsIn={slot} />);
    expect(slot.querySelector('button.ui-btn--h56')).toHaveTextContent('Send');
    expect(container.querySelector('.fu-card button.ui-btn')).toBeNull();

    rerender(<FollowUpCard ask={ASK} onSend={jest.fn()} actionsIn={null} />);
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
    slot.remove();
  });

  test('plain, for a card above a screen with its own main button', () => {
    render(<FollowUpCard ask={ASK} onSend={jest.fn()} plain />);
    expect(screen.getByRole('button', { name: 'Send' })).toHaveClass('ui-btn--quiet');
  });
});

/* ======================================================================= */

/*
  "SENT", NOT A GREYED SEND (owner, 3 Nov 2026: "could the button on the player
  screen change to sent when answering a question instead of greyed out send.
  it would change back to send if you edit as it does now.").

  rejects: the disabled grey "Send my answer" (or no word at all) after a send
  the socket or server took; a "Sent" that can be pressed or resubmits a form;
  "Sent" over an answer or ballot held offline; a "Sent" said by nothing to a
  screen reader, or said by a region that only mounted with it.
*/
const live = () => document.querySelector('[data-sent-live]');

function expectSent() {
  const sent = within(dock()).getByRole('button', { name: 'Sent' });
  expect(sent).toHaveClass('ui-btn--done');
  expect(sent).not.toHaveClass('ui-btn--action');
  expect(sent).toHaveAttribute('aria-disabled', 'true');
  expect(sent).toHaveAttribute('type', 'button');
  expect(sent.querySelector('svg')).not.toBeNull();
  expect(live()).toHaveTextContent(/^Sent$/);
  return sent;
}

describe('after a send, the dock reads "Sent" with a check, and pressing it does nothing', () => {
  const POLL_Q = { title: 'Best day?', questionNumber: '001', id: '001', poll: { kind: 'choice', options: ['Monday', 'Friday'], allowMultiple: false, allowOther: false, shuffle: false } };
  test.each(['call-and-answer', 'trivia', 'wavelength', 'poll'])('%s', async (gameType) => {
    const server = makeServer({ gameType, ...(gameType === 'poll' ? { question: POLL_Q } : {}) });
    await reach(server, 'ASK#001');
    if (gameType === 'call-and-answer') {
      fireEvent.change(await screen.findByRole('textbox', { name: /Your response/i }), { target: { value: 'An answer' } });
    } else if (gameType === 'trivia') {
      fireEvent.click(await screen.findByRole('radio', { name: /Paris/ }));
    } else if (gameType === 'wavelength') {
      fireEvent.change(await screen.findByLabelText('Word 1'), { target: { value: 'cloud' } });
    } else {
      fireEvent.click(await screen.findByRole('radio', { name: /Friday/ }));
    }
    const region = live();
    expect(region).toHaveTextContent('');
    const label = gameType === 'wavelength' ? SEND.words(1) : SEND.answer;
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: label })); });
    expect(webSocketClient.sendCleanMessage).toHaveBeenCalledTimes(1);

    const sent = expectSent();
    // The region was on the page before the send: its change is what is said.
    expect(live()).toBe(region);
    expect(screen.queryByRole('button', { name: label })).toBeNull();
    await act(async () => { fireEvent.click(sent); });
    expect(webSocketClient.sendCleanMessage).toHaveBeenCalledTimes(1);
    expectNoMainInStage();
  });

  test('votes: "Send my votes" turns to "Sent"', async () => {
    const server = makeServer({ ballot: [...BALLOT] });
    await reach(server, 'VOTE#001');
    await fillBallot();
    expect(live()).toHaveTextContent('');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: SEND.votes })); });
    await screen.findByText(/Your votes are in/);
    const sent = expectSent();
    const posts = server.votePosts.length;
    await act(async () => { fireEvent.click(sent); });
    expect(server.votePosts.length).toBe(posts);
  });
});

describe('held offline is "Not sent yet", never "Sent"', () => {
  test('an answer pressed while the socket is down', async () => {
    const server = makeServer();
    await reach(server, 'ASK#001');
    webSocketClient.sendCleanMessage.mockReturnValue(false);
    fireEvent.change(await screen.findByRole('textbox', { name: /Your response/i }), { target: { value: 'Held one' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: SEND.answer })); });
    await screen.findByText(HELD.heading);
    expect(screen.getByText(HELD.eyebrow)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sent' })).toBeNull();
    expect(document.querySelector('.ui-btn--done')).toBeNull();
    expect(live()).toHaveTextContent('');
    // "Change my answer" puts it back under a live Send.
    fireEvent.click(screen.getByRole('button', { name: HELD.changeAnswer }));
    const send = screen.getByRole('button', { name: SEND.answer });
    expect(send).toHaveClass('ui-btn--action');
    expect(send).not.toBeDisabled();
  });

  test('a ballot pressed offline', async () => {
    const server = makeServer({ ballot: [...BALLOT], vote: () => 'offline' });
    await reach(server, 'VOTE#001');
    await fillBallot();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: SEND.votes })); });
    await screen.findByText(HELD.heading);
    expect(screen.queryByRole('button', { name: 'Sent' })).toBeNull();
    expect(live()).toHaveTextContent('');
  });
});

describe('a question for the room: "Sent", and an edit brings "Send" back', () => {
  test('in the card on its own', async () => {
    const onSend = jest.fn().mockResolvedValue({ ok: true });
    render(<FollowUpCard ask={ASK} onSend={onSend} />);
    const box = screen.getByRole('textbox');
    fireEvent.change(box, { target: { value: 'The finance team' } });
    expect(live()).toHaveTextContent('');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })); });
    const sent = await screen.findByRole('button', { name: 'Sent' });
    expect(sent).toHaveClass('ui-btn--done');
    expect(sent).toHaveAttribute('aria-disabled', 'true');
    expect(sent).toHaveAttribute('type', 'button');
    expect(sent).not.toHaveAttribute('form');
    expect(sent.querySelector('svg')).not.toBeNull();
    expect(live()).toHaveTextContent(/^Sent$/);
    await act(async () => { fireEvent.click(sent); });
    expect(onSend).toHaveBeenCalledTimes(1);

    fireEvent.change(box, { target: { value: 'The finance team, then legal' } });
    const send = screen.getByRole('button', { name: 'Send' });
    expect(send).toHaveClass('ui-btn--action');
    expect(send).not.toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Sent' })).toBeNull();
    expect(live()).toHaveTextContent('');
    await act(async () => { fireEvent.click(send); });
    expect(onSend).toHaveBeenCalledTimes(2);
    expect(await screen.findByRole('button', { name: 'Sent' })).toBeInTheDocument();
  });

  test('on the phone, in the dock', async () => {
    const server = makeServer({ ask: ASK });
    await reach(server, 'RESULTS#001');
    await screen.findByText('Who pushes back first?');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'The finance team' } });
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'Send' })); });
    const sent = await within(dock()).findByRole('button', { name: 'Sent' });
    expect(sent).toHaveClass('ui-btn--done');
    expect(sent).toHaveAttribute('aria-disabled', 'true');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Legal' } });
    const send = within(dock()).getByRole('button', { name: 'Send' });
    expect(send).not.toBeDisabled();
    expect(send).toHaveClass('ui-btn--action');
    expectNoMainInStage();
  });
});
