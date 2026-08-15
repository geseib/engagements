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

const GAME = 'TEST123';
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
      const body = { state: server.state, gameType: server.gameType, currentQuestion: '001' };
      if (/\/state\/[^/?]+/.test(url)) {
        body.playerQuestionState = {
          questionNumber: 1, hasAnswered: server.answered, hasVoted: server.voted,
        };
      }
      return { ok: true, body };
    }
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
  fireEvent.change(screen.getByPlaceholderText(/Game ID/i), { target: { value: GAME } });
  fireEvent.change(screen.getByPlaceholderText(/Your Name/i), { target: { value: ME } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /Join Game/i }));
  });
}

const shell = () => document.querySelector('.plr');
const dock = () => document.querySelector('.plr-dock');
const stage = () => document.querySelector('.plr-stage');

beforeEach(() => {
  global.fetch.mockClear();
  localStorage.clear();
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
    expect(within(dock()).getByRole('button', { name: /Join Game/i })).toBeInTheDocument();
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
    expect(screen.getByLabelText(/Session code/i)).toBe(screen.getByPlaceholderText(/Game ID/i));
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

    expect(await screen.findByRole('alert')).toHaveTextContent(/not found/i);
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
    expect(screen.getByText(/Waiting for the game to start/i)).toBeInTheDocument();
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
  //          invitation to do something that cannot be done.
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
      fireEvent.click(screen.getByRole('button', { name: /Submit Answer/i }));
    });

    await waitFor(() => expect(shell()).toHaveAttribute('data-volume', 'rest'));
    expect(dock()).toBeNull();
  });

  // rejects: RESULTS growing an action. The stage is the show in WATCH; the
  //          phone carries only what is personal and cannot be on the stage.
  test('results is WATCH and offers nothing to press', async () => {
    const server = makeServer({ state: 'CREATED', gameType: 'trivia' });
    installFetch(server);
    await join();
    server.state = 'RESULTS#001';
    await resync();
    await waitFor(() => expect(shell()).toHaveAttribute('data-volume', 'watch'));
    expect(dock()).toBeNull();
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
  //          opens it again — a fold, not a deletion.
  test('focusing the composer folds the question and offers it back', async () => {
    const server = makeServer({ state: 'CREATED' });
    installFetch(server);
    await join();
    server.state = 'ASK#001';
    await resync();

    const composer = await screen.findByRole('textbox', { name: /Your response/i });
    expect(document.querySelector('.plr-q--fold')).toBeNull();

    fireEvent.focus(composer);
    expect(document.querySelector('.plr-q--fold')).not.toBeNull();

    const opener = screen.getByRole('button', { name: /Show the whole question/i });
    fireEvent.click(opener);
    expect(document.querySelector('.plr-q--fold')).toBeNull();
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
      fireEvent.click(screen.getByRole('button', { name: /Submit Answer/i }));
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

  // rejects: the anonymity copy being softened, shortened, or turned into
  //          "anonymous". The qualifier is not a footnote: a room of twelve where
  //          somebody writes in their own voice about their own team is not
  //          anonymous in any cryptographic sense, and the product has to be able
  //          to say the true sentence out loud.
  test('the ballot carries the exact sentence and its qualifier', async () => {
    const server = makeServer({ state: 'CREATED' });
    installFetch(server);
    await reachBallot(server);

    const text = document.querySelector('.plr').textContent.replace(/\s+/g, ' ');
    expect(text).toContain('Nobody sees who wrote what — the host included — until voting closes.');
    expect(text).toContain('This hides names, not identities.');
    expect(text).not.toMatch(/anonymous/i);
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
  //          loaded during VOTE and was simply never rendered, so a player who
  //          joined at round three ranked six answers to a question nobody had
  //          shown them.
  test('the question being voted on is on the screen', async () => {
    const server = makeServer({ state: 'CREATED' });
    installFetch(server);
    await reachBallot(server);
    expect(screen.getByText(/Our regional teams each built their own intake process/i))
      .toBeInTheDocument();
  });

  // rejects: the submit drifting back into the scrolling list, where a 20-card
  //          ballot puts it below the fold, and a second copy of it appearing in
  //          the other mode.
  test('there is exactly one Submit Votes, and it is in the dock', async () => {
    const server = makeServer({ state: 'CREATED' });
    installFetch(server);
    await reachBallot(server);

    const submits = screen.getAllByRole('button', { name: /Submit Votes|more to submit/i });
    expect(submits).toHaveLength(1);
    expect(dock().contains(submits[0])).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /Detailed Vote/i }));
    const afterSwitch = screen.getAllByRole('button', { name: /Submit Votes|more to submit/i });
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

    expect(screen.getByRole('button', { name: /Pick 3 more to submit/i })).toBeDisabled();
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
    expect(src('GameHostPage.jsx')).not.toMatch(/surfaceClassName/);
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
      expect(button).toHaveClass('plr-btn');
      expect(button.className).not.toMatch(/btn-primary|btn-secondary|btn-large/);
    }
    expect(within(stage()).queryAllByRole('button')).toEqual([]);
  });

  /* rejects: a self-serve takeover reappearing on the one screen built to
     refuse one.

     THIS TEST COUNTED ONE BUTTON UNTIL THE HANDOVER SHIPPED, and the count was
     standing in for the real rule: nothing on this screen may take a name the
     server has said is held. Two buttons now, and the rule is asserted
     directly instead — the first offer is to ASK, and the takeover is not
     reachable until the person has. A single button labelled "take it anyway"
     would satisfy a count of two and is exactly what must never appear. */
  test('the first offer is to ask the host, never to take the name', async () => {
    await refuse('NAME_TAKEN');

    const labels = () => within(dock()).getAllByRole('button')
      .map((b) => b.textContent.trim());
    expect(labels()).toEqual(['Ask the host to hand it over', 'Pick a different name']);

    // Only after asking does a takeover appear at all — and even then the
    // server refuses it without a host grant (tests/name-handover.js §1).
    fireEvent.click(screen.getByRole('button', { name: /ask the host/i }));
    await waitFor(() => expect(labels()).toEqual(['Take over the name', 'Pick a different name']));
    expect(screen.getByText(/when they say go ahead/i)).toBeInTheDocument();
  });

  /* rejects: a takeover the host has not authorised failing SILENTLY. The
     server refuses it — a 409 with the same NAME_TAKEN code the screen is
     already showing — so without this branch the button does nothing visible
     and the person taps it forever. */
  test('a takeover the host has not granted says "not yet", not nothing', async () => {
    await refuse('NAME_TAKEN');

    fireEvent.click(screen.getByRole('button', { name: /ask the host/i }));
    await waitFor(() => screen.getByRole('button', { name: /take over the name/i }));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /take over the name/i }));
    });

    await waitFor(() => expect(screen.getByText(/has not unlocked/i)).toBeInTheDocument());
    expect(screen.getByText(/ask them out loud/i)).toBeInTheDocument();
    // The way out is still there, and the takeover can still be retried once
    // the host does unlock it.
    expect(within(dock()).getAllByRole('button').map((b) => b.textContent.trim()))
      .toEqual(['Take over the name', 'Pick a different name']);
  });

  /* rejects: a takeover that does not actually CLAIM. Without `claimExisting`
     the server treats it as an ordinary retry and refuses it however wide the
     host's grant is open — the button would be permanently, silently inert,
     and every other test here would stay green because they all model a
     session that refuses. */
  test('the takeover claims the name, and the grant lets it through', async () => {
    await refuse('NAME_TAKEN', { granted: true });

    fireEvent.click(screen.getByRole('button', { name: /ask the host/i }));
    await waitFor(() => screen.getByRole('button', { name: /take over the name/i }));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /take over the name/i }));
    });

    // In. The refusal is gone and the surface has left the join phase.
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(shell().getAttribute('data-phase')).not.toBe('join');

    const claim = global.fetch.mock.calls
      .map(([url, options]) => ({ url: String(url), options }))
      .filter(({ url, options }) => (options?.method === 'POST')
        && url.endsWith(`games/${GAME}/players`))
      .pop();
    expect(JSON.parse(claim.options.body).claimExisting).toBe(true);
  });

  /* rejects: an ask that carries no identity. The host's console offers "let
     the person who asked take it", and the SERVER aims that grant by reading
     the client id off its own row — so an ask with no id can only ever produce
     an OPEN grant, spendable by whoever types the name next. The id is also
     the thing that ends up owning the row afterwards. */
  test('the ask carries this browser\'s id, so the grant can be aimed at it', async () => {
    await refuse('NAME_TAKEN');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /ask the host/i }));
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

  /* rejects: `asked` surviving into a refusal about a DIFFERENT name. The
     two-step is the guard on this screen — reaching "Take over the name"
     requires having asked — and a stage carried across a fresh join would hand
     that button to somebody who has asked nobody anything. */
  test('picking a different name and colliding again starts the ask over', async () => {
    await refuse('NAME_TAKEN');

    fireEvent.click(screen.getByRole('button', { name: /ask the host/i }));
    await waitFor(() => screen.getByRole('button', { name: /take over the name/i }));

    // Give up on that name and try another, which is also taken.
    fireEvent.click(screen.getByRole('button', { name: /pick a different name/i }));
    fireEvent.change(screen.getByPlaceholderText(/Your Name/i), { target: { value: 'Someone Else' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Join Game/i }));
    });

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(within(dock()).getAllByRole('button').map((b) => b.textContent.trim()))
      .toEqual(['Ask the host to hand it over', 'Pick a different name']);
    expect(screen.queryByText(/when they say go ahead/i)).toBeNull();
  });
});

describe('results shows the personal half and points at the room for the rest', () => {
  /* rejects: a results branch that throws. There are three of them — trivia,
              wavelength, and the call-and-answer branch that poll and survey
              also fall into — and each was rebuilt. A branch nobody mounts is a
              branch that is broken in front of a room the first time a host
              runs that game type. */
  test.each([
    ['call-and-answer', /Yours was/i],
    ['trivia', /You answered/i],
    ['wavelength', /Your words/i],
    ['poll', /Yours was/i],
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
    expect(screen.queryByText(/Waiting for the game to start/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /Download Report/i })).toBeNull();
    expect(shell()).toHaveAttribute('data-volume', 'watch');
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
