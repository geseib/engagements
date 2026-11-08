/**
 * THE PLAYER'S SURFACE, RENDERED — the half of the design contract that is
 * about structure rather than about paint.
 *
 * `playerSurfacePalette.test.js` reads the stylesheet as text and does
 * arithmetic on it. This file mounts the real component and asserts the things
 * jsdom genuinely models: roles, accessible names, document order, and which
 * elements exist at all.
 *
 * IT ASSERTS NO GEOMETRY, and it cannot. jsdom has no layout engine: every
 * width, offset, height and visibility check passes unconditionally, which is
 * exactly how 1,859 passing tests once sat on top of an iPad overflow bug. So
 * "the dock is on screen" is not testable here; "there IS no dock element in a
 * REST state" is, and it is the stronger claim anyway — RATIONALE §2.2 makes
 * the absence structural rather than visual precisely so that a rule about
 * attention survives the next feature request.
 *
 * WHAT IT CANNOT TELL YOU: whether any of this is legible on a phone at arm's
 * length or on a laptop at 24 inches. Only a device can say that.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import PlayerPage from '../PlayerPage';
import webSocketClient from '../WebSocketClient';

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
const ME = 'TestPlayer';

/* A REDACTED ballot, which is what an unattributed round actually sends: the
   backend OMITS `playerName` rather than nulling it, and `config/anonymity.js`
   turns a row with no usable author into `Response N`. A ballot carrying names
   is a different (also valid) payload and would label the rows with them. */
const BALLOT = [
  { answer: 'A careful answer about intake forms' },
  { answer: 'My own submitted answer' },
  { answer: 'A third answer' },
];

function makeServer(overrides = {}) {
  const server = {
    state: 'CREATED',
    gameType: 'call-and-answer',
    answered: false,
    voted: false,
    ballot: [],
    engagementInfo: '',
    question: {
      title: 'What is the capital of France?',
      detail: 'Our regional teams each built their own intake process.',
      questionNumber: '001',
      id: '001',
      field: 'Operating Model',
      optionA: 'Berlin',
      optionB: 'Paris',
      optionC: 'Rome',
      optionD: 'Madrid',
      correctAnswer: 'OptionB',
    },
    ...overrides,
  };

  server.handle = (url, options) => {
    const method = options?.method || 'GET';
    if (method === 'POST' && url.includes(`games/${GAME}/votes`)) {
      return { ok: true, body: { message: 'Vote submitted successfully' } };
    }
    if (method === 'POST' && url.includes(`games/${GAME}/players`)) {
      return { ok: true, body: { success: true, playerName: ME } };
    }
    if (url.includes(`games/${GAME}/state`)) {
      const body = { state: server.state, gameType: server.gameType, currentQuestion: '001', commentsOpen: server.commentsOpen !== false };
      if (/\/state\/[^/?]+/.test(url)) {
        body.playerQuestionState = {
          questionNumber: 1, hasAnswered: server.answered, hasVoted: server.voted,
        };
      }
      return { ok: true, body };
    }
    if (url.includes('games/get-results') && server.pastResults) return { ok: true, body: server.pastResults };
    if (url.includes(`games/${GAME}/question`)) return { ok: true, body: server.question };
    if (url.includes(`games/${GAME}/answers`)) {
      const body = { gameId: GAME, questionId: '001', answerCount: server.ballot.length };
      if (server.ballot.length) body.answers = [...server.ballot];
      return { ok: true, body };
    }
    if (url.includes(`games/${GAME}/players`)) {
      return { ok: true, body: { players: [{ name: ME, playerName: ME, score: 0, totalScore: 12 }] } };
    }
    if (url.includes('question-sets')) return { ok: true, body: { sets: [] } };
    if (url.includes(`games/${GAME}`)) return { ok: true, body: { engagementInfo: server.engagementInfo } };
    return { ok: true, body: {} };
  };
  return server;
}

function installFetch(server) {
  global.fetch.mockImplementation((url, options) => {
    const { ok, body } = server.handle(String(url), options);
    return Promise.resolve({ ok, status: ok ? 200 : 500, json: async () => body });
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

async function join() {
  render(<PlayerPage />);
  fireEvent.change(screen.getByLabelText(/Session code/i), { target: { value: GAME } });
  fireEvent.change(screen.getByPlaceholderText(/Your Name/i), { target: { value: ME } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /^Join$/i }));
  });
}

const shell = () => document.querySelector('.plr');
const dock = () => document.querySelector('.plr-dock');
const stage = () => document.querySelector('.plr-stage');

beforeEach(() => {
  global.fetch.mockClear();
  localStorage.clear();
  // A held answer is mirrored in sessionStorage; without this one test's held
  // answer seats the next test's round in HELD.
  sessionStorage.clear();
  // CRA's resetMocks strips the factory's `() => true` before every test, and
  // an undefined send reads as "the socket was down": the answer is HELD, not
  // sent, and "an answered round" never reaches its receipt.
  webSocketClient.sendCleanMessage.mockImplementation(() => true);
  window.history.pushState({}, '', '/play');
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
});

/* ========================================================================== */

describe('the shell', () => {
  // rejects: the surface losing its theme declaration. public/index.html puts
  //          data-theme="light" on <html>, so dusk markup with no re-declaration
  //          renders #F4EDE4 body copy on #FBF7F1 paper at 1.2:1 — the exact
  //          failure the Question sets tab shipped with, in the other direction.
  test('the root re-declares dusk under a paper document', () => {
    installFetch(makeServer());
    render(<PlayerPage />);
    expect(shell()).toHaveAttribute('data-theme', 'dark');
    expect(document.documentElement).not.toHaveAttribute('data-theme', 'dark');
  });

  // rejects: the dock drifting inside the scrolling region. "Scrolling to READ
  //          is fine, scrolling to ACT is not" is only structural while the
  //          primary action is a SIBLING of the thing that scrolls; put it
  //          inside and a long ballot can push it off the bottom.
  test('the dock is a sibling of the stage and comes after it', () => {
    installFetch(makeServer());
    render(<PlayerPage />);
    expect(dock().parentElement).toBe(stage().parentElement);
    // Node.DOCUMENT_POSITION_FOLLOWING — a relationship jsdom does model,
    // unlike every offset on the page.
    expect(stage().compareDocumentPosition(dock()) & 4).toBeTruthy();
    expect(within(dock()).getByRole('button', { name: /^Join$/i })).toBeInTheDocument();
  });

  // rejects: the parallax hero coming back. Three cross-origin .webp layers,
  //          loading="eager", at the top of the DOM above the question, on the
  //          smallest screen and the slowest connection in the building.
  test('the join screen loads no external asset', () => {
    installFetch(makeServer());
    render(<PlayerPage />);
    const external = [...document.querySelectorAll('img')]
      .map((el) => el.getAttribute('src') || '')
      .filter((src) => /^https?:/.test(src));
    expect(external).toEqual([]);
  });
});

describe('the join screen', () => {
  // rejects: placeholders standing in for labels. A placeholder vanishes on
  //          focus, is not announced as a label, and this form had no labels at
  //          all — two fields, four words, nothing associated with anything.
  test('both fields have real labels tied to them', () => {
    installFetch(makeServer());
    render(<PlayerPage />);
    expect(screen.getByLabelText(/Session code/i)).toBe(screen.getByLabelText(/Session code/i));
    expect(screen.getByLabelText(/Your name/i)).toBe(screen.getByPlaceholderText(/Your Name/i));
  });

  // rejects: the anonymity promise arriving too late. Telling somebody at the
  //          BALLOT that their answer was unattributed is telling them after
  //          they wrote it; the name field is where consent belongs.
  test('the name field says what a name is for, before it is typed', () => {
    installFetch(makeServer());
    render(<PlayerPage />);
    const help = document.getElementById('plr-name-help');
    expect(help).toHaveTextContent(/not.*shown next to your answer until voting closes/i);
  });

  // rejects: alert() coming back on the join path. A native alert on a phone is
  //          a modal system dialog that looks like a browser error: unstyleable,
  //          unassociated with the field it refers to, and it gave ONE message
  //          for four failures with four different remedies.
  test('a refused join is stated on the form, not in a system dialog', async () => {
    const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});
    const server = makeServer();
    installFetch(server);
    global.fetch.mockImplementation((url, options) => {
      if ((options?.method || 'GET') === 'POST' && String(url).includes('/players')) {
        return Promise.resolve({
          ok: false, status: 404, json: async () => ({ error: 'Game not found' }),
        });
      }
      const { ok, body } = server.handle(String(url), options);
      return Promise.resolve({ ok, status: 200, json: async () => body });
    });

    await join();

    expect(await screen.findByRole('alert')).toHaveTextContent(/Nothing is running under 7123/i);
    expect(alertSpy).not.toHaveBeenCalled();
    // And the form is still usable, which is the whole point of not navigating.
    expect(screen.getByPlaceholderText(/Your Name/i)).toBeInTheDocument();
    alertSpy.mockRestore();
  });
});

describe('the volume is set by the state machine, and the player never chooses', () => {
  // rejects: a dock, or anything pressable, on the lobby. RATIONALE §2.2 makes
  //          the absence STRUCTURAL: not a disabled button, not a greyed bar. If
  //          there is nothing to do there must be nothing that looks pressable.
  test('the lobby is REST and has no dock at all', async () => {
    installFetch(makeServer({ state: 'CREATED' }));
    await join();
    await waitFor(() => expect(shell()).toHaveAttribute('data-volume', 'rest'));
    expect(dock()).toBeNull();
    expect(screen.getByText(/Waiting for the host/i)).toBeInTheDocument();
  });

  // rejects: the lobby's way-back card returning as a second six-line card.
  //          It is one line, "Lost this page?", that opens in place to the
  //          same words — the code included — and nothing else became a card.
  test('the lobby: one card at most, and the way back is a one-line disclosure', async () => {
    installFetch(makeServer({ state: 'CREATED', engagementInfo: 'Half-day planning session.' }));
    await join();
    await screen.findByText(/Waiting for the host/i);

    const cards = stage().querySelectorAll('.plr-card');
    expect(cards).toHaveLength(1);
    expect(cards[0]).toHaveTextContent(/About this session/);

    const lost = stage().querySelector('details.plr-lost');
    expect(lost).not.toBeNull();
    expect(lost.open).toBe(false);
    const summary = lost.querySelector('summary');
    expect(summary).toHaveTextContent(/^Lost this page\?$/);
    expect(lost).toHaveTextContent(new RegExp(`enter ${GAME} and the same name`));
    expect(stage().textContent).not.toMatch(/If you lose this page/i);
    // The disclosure comes after the session card.
    expect(cards[0].compareDocumentPosition(lost) & 4).toBeTruthy();
  });

  // rejects: ASK losing its dock — the one state where the phone legitimately
  //          wins the room's attention, because the host has just asked
  //          everyone to answer.
  test('an unanswered round is ACT and has exactly one primary action', async () => {
    const server = makeServer({ state: 'CREATED' });
    installFetch(server);
    await join();
    server.state = 'ASK#001';
    await resync();
    await waitFor(() => expect(shell()).toHaveAttribute('data-volume', 'act'));
    expect(dock()).not.toBeNull();
    expect(within(dock()).getAllByRole('button')).toHaveLength(1);
  });

  // rejects: an action surviving the submission. Once the task is done the
  //          phone yields; a second submit affordance in a REST state is an
  //          invitation to do something that cannot be done. Since 3 Nov the
  //          dock keeps ONE thing in Send's place: the "Sent" state, which is
  //          aria-disabled, swallows its click and is not the orange action.
  test('an answered round is REST and offers nothing to press', async () => {
    const server = makeServer({ state: 'CREATED' });
    installFetch(server);
    await join();
    server.state = 'ASK#001';
    await resync();
    await screen.findByRole('textbox', { name: /Your response/i });

    fireEvent.change(screen.getByRole('textbox', { name: /Your response/i }), {
      target: { value: 'A definition everyone renders from.' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Send my answer/i }));
    });

    await waitFor(() => expect(shell()).toHaveAttribute('data-volume', 'rest'));
    const only = within(dock()).getAllByRole('button');
    expect(only).toHaveLength(1);
    expect(only[0]).toHaveAccessibleName('Sent');
    expect(only[0]).toHaveAttribute('aria-disabled', 'true');
    expect(dock().querySelector('.ui-btn--action')).toBeNull();
  });

  // rejects: RESULTS growing an action beyond the one way into comments. The
  //          stage is the show in WATCH; the phone's dock carries only
  //          "Comment on this round" (phone-comments D9; experience plan
  //          principle 8: the action lives in the dock), never the bare
  //          "Feedback".
  test('results is WATCH and its dock offers only "Comment on this round"', async () => {
    const server = makeServer({ state: 'CREATED', gameType: 'trivia' });
    installFetch(server);
    await join();
    server.state = 'RESULTS#001';
    await resync();
    await waitFor(() => expect(shell()).toHaveAttribute('data-volume', 'watch'));
    const buttons = dock().querySelectorAll('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent.trim()).toBe('Comment on this round');
    expect(dock().textContent).toContain('Reply to a response, or comment on Workie’s read.');
  });
});

describe('ASK', () => {
  // rejects: trivia options going back to `<div onClick>`. They were
  //          `className="category-item trivia-option"` — the admin category
  //          picker's class — with no role, no tabIndex and no aria-checked:
  //          unreachable by keyboard, unannounced as selectable.
  test('trivia options are radios in a radiogroup and announce their state', async () => {
    const server = makeServer({ state: 'CREATED', gameType: 'trivia' });
    installFetch(server);
    await join();
    server.state = 'ASK#001';
    await resync();

    const group = await screen.findByRole('radiogroup', { name: /Answer options/i });
    const options = within(group).getAllByRole('radio');
    expect(options).toHaveLength(4);
    options.forEach((o) => expect(o).toHaveAttribute('aria-checked', 'false'));

    fireEvent.click(screen.getByText(/Paris/));
    expect(within(group).getAllByRole('radio')[1]).toHaveAttribute('aria-checked', 'true');
  });

  // rejects: the instruction going back to being placeholder text as well as
  //          content. A placeholder is present exactly while it is not needed
  //          and absent exactly when it is.
  test('the instruction is stated once, as content, never as a placeholder', async () => {
    const server = makeServer({ state: 'CREATED' });
    installFetch(server);
    await join();
    server.state = 'ASK#001';
    await resync();

    const composer = await screen.findByRole('textbox', { name: /Your response/i });
    expect(composer).not.toHaveAttribute('placeholder');
    expect(document.querySelectorAll('.plr-task')).toHaveLength(1);
  });

  // rejects: the full-screen composer overlay returning, and with it a screen
  //          where a player cannot see the question they are answering. The one
  //          legal reduction folds the question and SAYS SO, with a control that
  //          opens it again — a fold, not a deletion. Since 5 Nov 2026 a
  //          call-and-answer TITLE is the question line and stays whole on
  //          focus; only the brief under it folds away.
  test('focusing the composer folds the brief, keeps the question line, and offers it back', async () => {
    const server = makeServer({ state: 'CREATED' });
    installFetch(server);
    await join();
    server.state = 'ASK#001';
    await resync();

    const composer = await screen.findByRole('textbox', { name: /Your response/i });
    expect(screen.getByText(/Our regional teams each built/)).toBeInTheDocument();

    fireEvent.focus(composer);
    expect(document.querySelector('.plr-q')).toHaveTextContent('What is the capital of France?');
    expect(document.querySelector('.plr-q--fold')).toBeNull();
    expect(screen.queryByText(/Our regional teams each built/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Show the whole question/i }));
    expect(screen.getByText(/Our regional teams each built/)).toBeInTheDocument();
  });

  // rejects: a passage-as-headline losing its fold. PlayerPage only seats a
  //          question that has a title, so the passage case that reaches a
  //          phone is a "title" that is itself the whole brief: it is set at
  //          the reading size (.plr-q--long) and it is what condenses on focus.
  test('a title that is a passage is read at body size, and it is what folds', async () => {
    const server = makeServer({ state: 'CREATED' });
    server.question = { ...server.question, title: 'Our regional teams each built their own intake process, and now nobody can say which form a request should start on, who owns it, or when it is finished. Name the one change that would fix that.', detail: '' };
    installFetch(server);
    await join();
    server.state = 'ASK#001';
    await resync();

    const composer = await screen.findByRole('textbox', { name: /Your response/i });
    expect(document.querySelector('.plr-q')).toHaveTextContent(/Our regional teams each built/);
    expect(document.querySelector('.plr-q')).toHaveClass('plr-q--long');
    expect(document.querySelector('.plr-brief')).toBeNull();

    fireEvent.focus(composer);
    expect(document.querySelector('.plr-q--fold')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Show the whole question/i }));
    expect(document.querySelector('.plr-q--fold')).toBeNull();
  });

  // rejects: the title going back to being a small grey caps label over a
  //          400-character brief set as the headline. The room's screen puts
  //          the title large and the detail as body; the phone matches it.
  test('call-and-answer: the title is the headline, the brief is body text, the task follows', async () => {
    const server = makeServer({ state: 'CREATED' });
    installFetch(server);
    await join();
    server.state = 'ASK#001';
    await resync();
    await screen.findByRole('textbox', { name: /Your response/i });

    const q = document.querySelector('.plr-stage .plr-q');
    expect(q).toHaveTextContent('What is the capital of France?');
    expect(q).not.toHaveClass('plr-q--long');
    const brief = document.querySelector('.plr-stage .plr-brief');
    expect(brief).toHaveTextContent(/Our regional teams each built/);
    // Content they must read, so not the muted aside.
    expect(brief).toHaveClass('plr-detail');
    expect(brief).not.toHaveClass('plr-muted');
    // The title appears once, and never as a caps label.
    const labels = [...document.querySelectorAll('.plr-stage .plr-lab')].map((l) => l.textContent);
    expect(labels).not.toContain('What is the capital of France?');
    // Document order: question, brief, then the task.
    const task = document.querySelector('.plr-stage .plr-task');
    if (task) expect(brief.compareDocumentPosition(task) & 4).toBeTruthy();
    expect(q.compareDocumentPosition(brief) & 4).toBeTruthy();
  });

  // rejects (owner, 5 Nov 2026): the instruction leaving the phones with the
  //          room's screen. The stage and /present dropped "Your turn" and the
  //          how-to line so the question body could be larger; the phone is
  //          where the people answering read how to answer, so it stays here.
  test('call-and-answer: the phone still shows the question\'s own instruction as "Your task"', async () => {
    const server = makeServer({ state: 'CREATED' });
    server.question = { ...server.question, customInstructions: 'One habit, one sentence on its cost.' };
    installFetch(server);
    await join();
    server.state = 'ASK#001';
    await resync();
    await screen.findByRole('textbox', { name: /Your response/i });
    const task = document.querySelector('.plr-stage .plr-task');
    expect(task).not.toBeNull();
    expect(task.querySelector('.plr-lab').textContent).toBe('Your task');
    expect(task).toHaveTextContent('One habit, one sentence on its cost.');
  });

  // rejects: the receipt disappearing. handleSubmitAnswer clears the composer on
  //          send, so without this the only record of what a player wrote is
  //          `mySubmittedAnswer`, which exists to find their own ballot row and
  //          was never displayed. Somebody guessing whether the room is
  //          discussing their idea is not participating in the discussion.
  test('a submitted answer is shown back to the player', async () => {
    const server = makeServer({ state: 'CREATED' });
    installFetch(server);
    await join();
    server.state = 'ASK#001';
    await resync();
    const composer = await screen.findByRole('textbox', { name: /Your response/i });

    fireEvent.change(composer, { target: { value: 'One definition, rendered everywhere.' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Send my answer/i }));
    });

    expect(await screen.findByText('One definition, rendered everywhere.')).toBeInTheDocument();
  });
});

describe('the ballot', () => {
  async function reachBallot(server) {
    await join();
    server.state = 'VOTE#001';
    server.ballot = [...BALLOT];
    await resync();
    await waitFor(() => expect(screen.getAllByRole('combobox').length).toBeGreaterThan(0));
  }

  // rejects: the anonymity copy being softened into "anonymous", or vanishing.
  //          Since 5 Nov 2026 it is ONE short line under the ballot; "Only
  //          names" carries the qualifier ("hides names, not identities"): a
  //          room of twelve is not anonymous in any cryptographic sense.
  test('the ballot carries the privacy line, once, under the ballot', async () => {
    const server = makeServer({ state: 'CREATED' });
    installFetch(server);
    await reachBallot(server);

    const lines = document.querySelectorAll('.plr-anon');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toHaveTextContent('Only names are hidden, from the host too, until voting closes.');
    const text = document.querySelector('.plr').textContent.replace(/\s+/g, ' ');
    expect(text).not.toMatch(/anonymous/i);
    const ballot = document.querySelector('.plr-quick');
    expect(ballot.compareDocumentPosition(lines[0]) & 4).toBeTruthy();
  });

  // rejects: the vote screen opening on an instruction, the whole brief again,
  //          a privacy paragraph and a mode toggle, with no response on the
  //          first phone screen. The order is: the question as one line, the
  //          ballot, then the quiet way to the other ballot and the privacy line.
  test('the vote screen shows what to vote on first, then the ballot', async () => {
    const server = makeServer({ state: 'CREATED' });
    installFetch(server);
    await reachBallot(server);

    const st = stage();
    const q = st.querySelector('h1.plr-q');
    expect(q).toHaveTextContent('What is the capital of France?');
    // Nothing before the question in the stage's content.
    const first = st.querySelector('.plr-q, .plr-h1, .plr-anon, .plr-rank-cue, .plr-quick, .plr-detail');
    expect(first).toBe(q);
    const quick = st.querySelector('.plr-quick');
    const switchLink = screen.getByRole('button', { name: /Detailed vote/i });
    const anon = st.querySelector('.plr-anon');
    const follows = (a, b) => expect(a.compareDocumentPosition(b) & 4).toBeTruthy();
    follows(q, quick);
    follows(quick, switchLink);
    follows(switchLink, anon);
    // The brief is NOT repeated on the ballot until asked for.
    expect(screen.queryByText(/Our regional teams each built/)).toBeNull();
    // One way by default: the quick vote, and no toggle group above it.
    expect(st.querySelector('[role="group"][aria-label="How to rank"]')).toBeNull();
    expect(st.querySelectorAll('[aria-pressed]')).toHaveLength(0);
    expect(screen.getAllByRole('combobox')).toHaveLength(3);
  });

  // rejects: the detailed ballot becoming unreachable, or the way back
  //          missing once it is open.
  test('the detailed vote is one quiet link away, and so is the way back', async () => {
    const server = makeServer({ state: 'CREATED' });
    installFetch(server);
    await reachBallot(server);

    const link = screen.getByRole('button', { name: /Detailed vote/i });
    expect(link).toHaveClass('plr-more');
    fireEvent.click(link);
    expect(document.querySelectorAll('.plr-resp')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: /Back to the quick vote/i }));
    expect(screen.getAllByRole('combobox')).toHaveLength(3);
  });

  // rejects: a long question line clamped with no way to read the rest.
  test('a passage as the question line is clamped to two lines and opens with "Show the whole question"', async () => {
    const server = makeServer({ state: 'CREATED' });
    server.question = { ...server.question, title: 'Our regional teams each built their own intake process, and now nobody can say which form a request should start on, who owns it, or when it is finished. Name the one change that would fix that.', detail: '' };
    installFetch(server);
    await reachBallot(server);

    const q = stage().querySelector('h1.plr-q');
    expect(q).toHaveClass('plr-q--clamp');
    fireEvent.click(screen.getByRole('button', { name: /Show the whole question/i }));
    expect(stage().querySelector('h1.plr-q')).not.toHaveClass('plr-q--clamp');
    expect(screen.queryByRole('button', { name: /Show the whole question/i })).toBeNull();
  });

  // rejects: a sort control, a filter, or any reindexing. Vote indices map to
  //          array position, so `Response N` must be 1-based, strictly
  //          increasing and contiguous — that is what lets a host say "response
  //          six" and have it mean one thing to forty people.
  test('response numbers are 1-based, increasing, contiguous — and name the right row', async () => {
    const server = makeServer({ state: 'CREATED' });
    installFetch(server);
    await reachBallot(server);

    fireEvent.click(screen.getByRole('button', { name: /Detailed Vote/i }));
    const cards = [...document.querySelectorAll('.plr-resp')];
    const ids = cards.map((c) => parseInt(c.querySelector('.plr-rid').textContent.replace(/\D+/g, ''), 10));

    expect(ids[0]).toBe(1);
    expect(ids.every((n, i) => i === 0 || n > ids[i - 1])).toBe(true);
    expect(ids[ids.length - 1] - ids[0]).toBe(ids.length - 1);

    /* THE NUMBERS ALONE ARE NOT ENOUGH, and a mutation proved it: sorting the
       array by response length and then labelling from the NEW index still
       prints 1, 2, 3. What has to hold is that `Response N` names
       `answers[N-1]` — the invariant vote indices actually depend on, since
       they map to array position. A ballot that renumbers after sorting is a
       ballot where "look at response six" means six different things in a room
       of forty. */
    cards.forEach((card, i) => {
      expect(card.querySelector('.plr-rtxt').textContent).toBe(BALLOT[ids[i] - 1].answer);
      expect(ids[i]).toBe(i + 1);
    });
  });

  // rejects: voting on a question the phone will not show. `currentQuestion` is
  //          loaded during VOTE and was once never rendered, so a player who
  //          joined at round three ranked six answers to a question nobody had
  //          shown them. The title is on screen; the brief is one tap away.
  test('the question being voted on is on the screen, and the brief is recoverable', async () => {
    const server = makeServer({ state: 'CREATED' });
    installFetch(server);
    await reachBallot(server);
    expect(screen.getByRole('heading', { name: 'What is the capital of France?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Show the whole question/i }));
    expect(screen.getByText(/Our regional teams each built their own intake process/i))
      .toBeInTheDocument();
  });

  // rejects: the submit drifting back into the scrolling list, where a 20-card
  //          ballot puts it below the fold, and a second copy of it appearing in
  //          the other mode.
  test('there is exactly one Send my votes, and it is in the dock', async () => {
    const server = makeServer({ state: 'CREATED' });
    installFetch(server);
    await reachBallot(server);

    const submits = screen.getAllByRole('button', { name: /Send my votes|more to send/i });
    expect(submits).toHaveLength(1);
    expect(dock().contains(submits[0])).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /Detailed Vote/i }));
    const afterSwitch = screen.getAllByRole('button', { name: /Send my votes|more to send/i });
    expect(afterSwitch).toHaveLength(1);
    expect(dock().contains(afterSwitch[0])).toBe(true);
  });

  // rejects: `alert('Please select answers for all N positions.')` coming back.
  //          A modal system dialog standing in for a form that can simply say
  //          what is missing, on the control that is missing it.
  test('an incomplete ballot says what is missing on the button itself', async () => {
    const server = makeServer({ state: 'CREATED' });
    installFetch(server);
    await reachBallot(server);

    expect(screen.getByRole('button', { name: /Pick 3 more to send/i })).toBeDisabled();
  });

  // rejects: your own row losing its mark, or gaining a block on ranking it.
  //          OPEN-QUESTIONS §2 leaves it rankable, because requiredRanks counts
  //          it and blocking self-votes makes submit unreachable in a room of
  //          three.
  test('every row on the ballot offers every rank, including your own', async () => {
    const server = makeServer({ state: 'CREATED' });
    installFetch(server);
    await reachBallot(server);

    fireEvent.click(screen.getByRole('button', { name: /Detailed Vote/i }));
    const cards = document.querySelectorAll('.plr-resp');
    expect(cards).toHaveLength(3);
    cards.forEach((card) => {
      expect(within(card).getAllByRole('button', { name: /^Vote this answer/ })).toHaveLength(3);
    });
  });

  // rejects: the response text losing its way out of the five-line clamp. A
  //          reduction with no recovery is a deletion, and on a phone the reader
  //          is holding the control — so every fold in this design ships with the
  //          thing that opens it.
  test('every clamped response carries a control that opens it', async () => {
    const server = makeServer({ state: 'CREATED' });
    installFetch(server);
    await reachBallot(server);

    fireEvent.click(screen.getByRole('button', { name: /Detailed Vote/i }));
    document.querySelectorAll('.plr-resp').forEach((card) => {
      expect(card.querySelector('.plr-rtxt--clamp')).not.toBeNull();
      expect(within(card).getByRole('button', { name: /Show all/i })).toBeInTheDocument();
    });
  });

  /* rejects: the reading view reverting to a paper island.
              `Show all ↓` opens `AnswerSpotlight`, which belongs to the host's
              results wall and is painted out of the `styles.css` monolith. It
              was mounted as a SIBLING of the shell — outside `.plr`, therefore
              outside the data-theme="dark" this surface re-declares and outside
              every --plr-* token — so it opened a WHITE card with
              #F6A94C-on-#FFFFFF Previous/Next buttons at 1.96:1 over a dusk
              ballot. Containment is the whole fix: an undefined custom property
              invalidates the whole declaration, so `.plr-spot` outside `.plr`
              would drop §10 of the stylesheet on the floor silently, in the
              bundle only, where no test can see it. Document containment is a
              relationship jsdom genuinely models. */
  test('reading one response in full happens inside the surface, in its palette', async () => {
    const server = makeServer({ state: 'CREATED' });
    installFetch(server);
    await reachBallot(server);

    fireEvent.click(screen.getByRole('button', { name: /Detailed Vote/i }));
    fireEvent.click(screen.getAllByRole('button', { name: /Show all/i })[0]);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveClass('answer-spotlight', 'plr-spot');
    expect(shell().contains(dialog)).toBe(true);
    // ...and after the dock, not inside the region that scrolls. A dialog
    // nested in `.plr-stage` is a dialog inside the thing it covers.
    expect(stage().contains(dialog)).toBe(false);
  });

  /* rejects: the re-tint being applied to the host's copy too. `PastRound` and
              the host results wall render the same component on paper and must
              not move; the class is opt-in, from the caller, because only the
              caller knows which polarity it is on. */
  test('the re-tint is the player\'s alone', () => {
    const fs = require('fs');
    const path = require('path');
    const src = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '');       // prose is not a call site
    // Opt-in, and off by default: an unspecified caller gets exactly the
    // markup it had.
    expect(src('components', 'AnswerSpotlight.jsx')).toMatch(/surfaceClassName\s*=\s*''/);
    // The other two callers are paper and stay paper.
    expect(src('components', 'PastRound.jsx')).not.toMatch(/surfaceClassName/);

    /*
      THE RE-TINT, NOT THE SEAM. This used to assert GameHostPage passed no
      `surfaceClassName` at all, which was broader than the rule above it: the
      thing that must not reach a paper caller is `plr-spot`, the PLAYER'S DUSK
      PALETTE, not the prop that carries it.

      The host now passes `stage-spot`, which sets width, height, padding and
      type from the stage's own per-profile ladders and declares no colour at
      all — it is how the dialog stopped opening SMALLER than the card it
      expands ("it should make use of the screen space and make the text large
      so all can really read the text from a decent size room"). Blocking that
      on a colour rule would have been the assertion enforcing something it does
      not mean.

      So: name the class the rule is actually about, and keep asserting the
      host's copy is not tinted.
    */
    expect(src('GameHostPage.jsx')).not.toMatch(/plr-spot/);
    expect(src('GameHostPage.jsx')).toMatch(/surfaceClassName="stage-spot"/);
  });
});

describe('the join refusal', () => {
  /* The second Chris. The refusal used to render its heading, its sentence and
     two `.btn-primary`/`.btn-secondary` buttons into the middle of `.plr-stage`
     — the one scrolling region — from a stylesheet whose own header described a
     white `.join-screen` container that had been deleted. Its explanatory
     sentence was `color: #444`: 1.79:1 on `--bg #0F1A2E`, which is not "low
     contrast", it is not there. */
  /**
   * A session that refuses this name.
   *
   * `grantedTo` models the host having unlocked it: the join then succeeds,
   * but ONLY for a request that actually carries `claimExisting`. That
   * condition is the server's real rule (join-game.js's `handover` verdict
   * needs both the grant and the person's own yes), and modelling it here is
   * what makes "the takeover claims" testable at all — a mock that says yes to
   * anything cannot tell a claim from a plain retry.
   */
  async function refuse(code, { granted = false } = {}) {
    const server = makeServer({ state: 'CREATED' });
    server.handle = ((inner) => (url, options) => {
      const method = options?.method || 'GET';
      if (method === 'POST' && url.includes('/handover-request')) {
        return { ok: true, body: { success: true, playerName: ME } };
      }
      if (method === 'POST' && url.includes(`games/${GAME}/players`)) {
        const sent = JSON.parse(options?.body || '{}');
        if (granted && sent.claimExisting === true) {
          return { ok: true, body: { success: true, playerName: ME, isReconnection: true } };
        }
        return {
          ok: false,
          status: 409,
          body: { code, playerName: ME, message: 'Someone here is already answering as that name.' },
        };
      }
      return inner(url, options);
    })(server.handle);

    global.fetch.mockImplementation((url, options) => {
      const { ok, status, body } = server.handle(String(url), options);
      return Promise.resolve({ ok, status: status || (ok ? 200 : 500), json: async () => body });
    });

    await join();
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  }

  // rejects: the ways out drifting back into the scrolling region. Every other
  //          ACT state on this surface puts its actions in the dock, which is a
  //          SIBLING of the stage — that is what makes "scrolling to read is
  //          fine, scrolling to act is not" structural. The one screen where a
  //          player is already stuck was the one screen that broke it.
  test('the refusal is in the stage and its ways out are in the dock', async () => {
    await refuse('NAME_UNVERIFIED');

    expect(stage().contains(screen.getByRole('alert'))).toBe(true);
    const buttons = within(dock()).getAllByRole('button');
    expect(buttons.map((b) => b.textContent.trim())).toEqual([
      `Yes — rejoin as ${ME}`,
      `No — I'm a different ${ME}`,
    ]);
    // Nothing pressable is left behind in the stage: two places for one
    // decision is how a player answers the question twice.
    expect(within(stage()).queryAllByRole('button')).toEqual([]);
  });

  // rejects: the monolith's paper buttons coming back onto a dusk shell.
  test('the ways out wear the dock vocabulary, not the global one', async () => {
    await refuse('NAME_TAKEN');

    const buttons = within(dock()).getAllByRole('button');
    for (const button of buttons) {
      expect(button).toHaveClass('ui-btn', 'ui-btn--h56');
      expect(button.className).not.toMatch(/btn-primary|btn-secondary|btn-large/);
    }
    expect(within(stage()).queryAllByRole('button')).toEqual([]);
  });

  /* rejects: a self-serve takeover reappearing on the one screen built to
     refuse one.

     Two buttons, and the rule is asserted directly: the first offer ASKS, and
     nothing on this screen ever takes a name the server has said is held. A
     single button labelled "take it anyway" would satisfy a count of two and
     is exactly what must never appear. The wait that follows the ask, its
     quiet retry and its timings are pinned in playerNameMove.test.jsx. */
  test('the first offer is to ask the host, never to take the name', async () => {
    await refuse('NAME_TAKEN');

    const labels = () => within(dock()).getAllByRole('button')
      .map((b) => b.textContent.trim());
    expect(labels()).toEqual(["That's me: use my name on this device", "I'm someone else: pick another name"]);
    expect(screen.getByRole('heading', { name: `${ME} is already in this session.` })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /use my name on this device/i }));
    });
    // Asked, and checked: the screen waits only because the server said yes.
    await waitFor(() => expect(screen.getByText(/Waiting for the host to let you in as/)).toBeInTheDocument());
    expect(labels()).toEqual(['Pick another name']);
  });

  /* rejects: an ask that carries no identity. The host's console offers "let
     the person who asked take it", and the SERVER aims that grant by reading
     the client id off its own row — so an ask with no id can only ever produce
     an OPEN grant, spendable by whoever types the name next. The id is also
     the thing that ends up owning the row afterwards. */
  test('the ask carries this browser\'s id, so the grant can be aimed at it', async () => {
    await refuse('NAME_TAKEN');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /use my name on this device/i }));
    });

    const ask = global.fetch.mock.calls
      .map(([url, options]) => ({ url: String(url), options }))
      .find(({ url }) => url.includes('/handover-request'));
    expect(ask).toBeTruthy();
    // The same id the join sends, not a fresh one — a new id per request would
    // bind the grant to a browser that never comes back.
    const asked = JSON.parse(ask.options.body);
    const joined = JSON.parse(global.fetch.mock.calls
      .map(([url, options]) => ({ url: String(url), options }))
      .find(({ url, options }) => options?.method === 'POST' && url.endsWith(`games/${GAME}/players`))
      .options.body);
    expect(asked.clientId).toBeTruthy();
    expect(asked.clientId).toBe(joined.clientId);
    // And the name is a path segment, so it is escaped.
    expect(ask.url).toContain(`${encodeURIComponent(ME)}/handover-request`);
  });

  /* rejects: a wait surviving into a refusal about a DIFFERENT name. A screen
     that said "Waiting for the host to let you in as Someone Else" would be
     describing an ask nobody made. */
  test('picking a different name and colliding again starts the ask over', async () => {
    await refuse('NAME_TAKEN');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /use my name on this device/i }));
    });
    await waitFor(() => screen.getByText(/Waiting for the host/));

    // Give up on that name and try another, which is also taken.
    fireEvent.click(screen.getByRole('button', { name: /pick another name/i }));
    fireEvent.change(screen.getByPlaceholderText(/Your Name/i), { target: { value: 'Someone Else' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Join$/i }));
    });

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(within(dock()).getAllByRole('button').map((b) => b.textContent.trim()))
      .toEqual(["That's me: use my name on this device", "I'm someone else: pick another name"]);
    expect(screen.queryByText(/Waiting for the host/)).toBeNull();
  });
});

describe('results shows the personal half and points at the room for the rest', () => {
  /* rejects: a results branch that throws. There are three of them — trivia,
              wavelength, and the call-and-answer branch that poll and survey
              also fall into — and each was rebuilt. A branch nobody mounts is a
              branch that is broken in front of a room the first time a host
              runs that game type. */
  test.each([
    ['call-and-answer', /You didn’t send a response this round/i],
    ['trivia', /Your result/i],
    ['wavelength', /Your result/i],
    ['poll', /You didn’t send a response this round/i],
  ])('%s results renders and carries the look-up cue', async (gameType, heading) => {
    const server = makeServer({ state: 'CREATED', gameType });
    installFetch(server);
    await join();
    server.state = 'RESULTS#001';
    await resync();

    await waitFor(() => expect(screen.getByText(heading)).toBeInTheDocument());
    // The one cue that says where the room's half lives, in the same position,
    // in every WATCH state. It replaces "Check the main screen for detailed
    // results and AI insights!", which appeared in ONE branch of three.
    expect(document.querySelector('.plr-lookup')).not.toBeNull();
    // And no room-wide aggregate is re-derived on the phone.
    expect(screen.queryByText(/Common Words/i)).toBeNull();
    expect(screen.queryByText(/Total Responses/i)).toBeNull();
    expect(screen.queryByText(/Unique Words/i)).toBeNull();
  });

  /* rejects: "This round +0" on a type that scores nobody (#43). Wavelength
              writes no scores and a poll is not scored, so the line read as a
              wrong answer; the scored types keep it. */
  test.each([
    ['wavelength', /Your result/i, false],
    ['poll', /You didn’t send a response this round/i, false],
    ['call-and-answer', /You didn’t send a response this round/i, true],
    ['trivia', /Your result/i, true],
  ])('%s results: the score lines only where the type scores', async (gameType, heading, scored) => {
    const server = makeServer({ state: 'CREATED', gameType });
    installFetch(server);
    await join();
    server.state = 'RESULTS#001';
    await resync();

    await waitFor(() => expect(screen.getByText(heading)).toBeInTheDocument());
    expect(Boolean(screen.queryByText('This round'))).toBe(scored);
    expect(Boolean(screen.queryByText('Total'))).toBe(scored);
  });
});

describe('the states that did not exist', () => {
  // rejects: `isWaitingState` swallowing ENDED again. It returns true for
  //          anything that is not ASK#/VOTE#/RESULTS#, so a finished session
  //          rendered "You're in! / Waiting for the game to start…" and left the
  //          player there permanently, behind a dismissible modal whose primary
  //          action was an admin report endpoint.
  test('a finished session says so instead of showing the lobby', async () => {
    const server = makeServer({ state: 'CREATED' });
    installFetch(server);
    await join();
    server.state = 'ENDED';
    await resync();

    await waitFor(() => expect(screen.getByText(/Thanks for playing/i)).toBeInTheDocument());
    expect(screen.queryByText(/Waiting for the host/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /Download Report/i })).toBeNull();
    expect(shell()).toHaveAttribute('data-volume', 'watch');
  });

  // rejects: a final score read only from memory filled during RESULTS, so a
  //          player who reloads or rejoins after the end sees "Final score 0"
  //          and no standing while the host and the report say 6 (review of
  //          test 32ac4eb4, issue #35).
  test('a player arriving at the end is shown their stored final score and standing', async () => {
    const server = makeServer({ state: 'CREATED' });
    installFetch(server);
    await join();
    server.state = 'ENDED';
    await resync();

    await waitFor(() => expect(screen.getByText(/Final standing/i)).toBeInTheDocument());
    const score = screen.getByText(/Final score/i).nextSibling;
    expect(score).toHaveTextContent('12');
  });

  // rejects: an earlier round opened from the end screen headed "Round 1"
  //          alone, with no question title (review of test 32ac4eb4, issue
  //          #35); a round nobody answered reading "The responses could not
  //          be loaded" once the server answers it empty.
  test('at the end, an earlier round is headed by its question and an empty one says so', async () => {
    const server = makeServer({ state: 'CREATED' });
    server.pastResults = { gameId: GAME, questionId: '001', answers: [], noAnswers: true, stored: true, questionTitle: 'Is the demo ready for Tuesday?' };
    installFetch(server);
    await join();
    server.state = 'ENDED';
    await resync();
    await waitFor(() => expect(screen.getByText(/Something to add\?/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Round 1/ }));
    await waitFor(() => expect(document.querySelector('.fbr-q__title')?.textContent).toBe('Is the demo ready for Tuesday?'));
    expect(document.body.textContent).toMatch(/Round 1 · Comments/i);
    expect(screen.queryByText(/could not be loaded/i)).toBeNull();
  });

  // rejects: an end screen with no way back to a round's comments while they
  //          are still open (review of test a76fda95, issue #34); a panel
  //          opened from it that closes itself because the room "moved on";
  //          the entry offered after the host closed comments.
  test('at the end, a round can still be commented on while comments are open', async () => {
    const server = makeServer({ state: 'CREATED' });
    installFetch(server);
    await join();
    server.state = 'ENDED';
    await resync();
    await waitFor(() => expect(screen.getByText(/Something to add\?/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Round 1/ }));
    await waitFor(() => expect(screen.queryByText(/Thanks for playing/i)).toBeNull());
    expect(screen.getByText(/Comments stay open for 24 hours/)).toBeInTheDocument();
    expect(document.body.textContent).toMatch(/Round 1 · Comments/i);
    // The room cannot "move on" from the end: the panel stays, and a comment can be started.
    await new Promise((r) => setTimeout(r, 50));
    fireEvent.click(screen.getAllByRole('button', { name: /^Comment on /i })[0]);
    await waitFor(() => expect(document.querySelector('textarea')).not.toBeNull());
  });

  test('once comments are closed, the end screen does not offer them', async () => {
    const server = makeServer({ state: 'CREATED', commentsOpen: false });
    installFetch(server);
    await join();
    server.state = 'ENDED';
    await resync();
    await waitFor(() => expect(screen.getByText(/Thanks for playing/i)).toBeInTheDocument());
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText(/Something to add\?/i)).toBeNull();
  });

  // rejects: the reload-on-tap connection chip returning. Its click handler was
  //          `window.location.reload()`, offered as the remedy for a bad
  //          connection to a player who may be mid-sentence in a textarea whose
  //          contents live in React state and nowhere else.
  test('nothing on the surface offers to reload the page', async () => {
    installFetch(makeServer({ state: 'CREATED' }));
    await join();
    await waitFor(() => expect(shell()).not.toBeNull());

    const reloaders = [...document.querySelectorAll('.plr [role="button"], .plr button')]
      .filter((el) => /reload|refresh/i.test(el.getAttribute('title') || el.textContent || ''));
    expect(reloaders).toEqual([]);
  });

  // rejects: the offline banner overclaiming. RATIONALE §7 wants "Your text is
  //          safe on this phone and will send as soon as you are back" — and
  //          says the sentence must not ship before the localStorage draft that
  //          makes it TRUE. That draft does not exist yet, so the banner must
  //          not promise it. Delete this test the day §11.7 is built.
  test('the offline banner promises no local draft, because there is none', async () => {
    installFetch(makeServer({ state: 'CREATED' }));
    await join();
    await waitFor(() => expect(shell()).not.toBeNull());

    const banner = document.querySelector('.plr-banner');
    expect(banner).not.toBeNull();                   // the mock socket never connects
    expect(banner).toHaveTextContent(/Offline/i);
    expect(banner).not.toHaveTextContent(/safe on this phone/i);
    expect(banner).not.toHaveTextContent(/will send as soon as/i);
  });
});

describe('the results heading (owner, 2026-10-13)', () => {
  test('a participant who answered reads which response was theirs, by its ballot number', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'PlayerPage.jsx'), 'utf8');
    expect(src).toMatch(/`You wrote response \$\{ownAnswerIdx \+ 1\}`/);
    expect(src).not.toMatch(/>Yours was</);
  });
});
