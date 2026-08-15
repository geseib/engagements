/**
 * SWITCHING A VOTE IN THE QUICK BALLOT.
 *
 *   "when voting, the quick view method does not allow for you to switch votes,
 *    where as the detailed vote does. i like how the detailed voted kicks out
 *    the choice anywhere else when you pick it, make that work for the quick
 *    vote."
 *
 * The two ballots are ONE piece of state (`votes`) rendered twice, and
 * `handleVoteChange` has always kicked a re-picked answer out of whatever rank
 * it previously held. The quick ballot never reached that code: every option
 * for an answer already ranked somewhere else was rendered `disabled`, so the
 * browser refused the pick and the kick-out was unreachable. The player had to
 * find the OTHER select, empty it by hand, then come back — which reads as
 * "you cannot change your mind".
 *
 * These tests therefore drive the ballot the way a person does — through
 * user-event, which honours `disabled` exactly as a browser does. `fireEvent
 * .change` does NOT: it sets the value straight onto the element and fires the
 * event, so it walks through a disabled option and every one of these tests
 * would have passed against the broken build. That distinction is the whole
 * reason this file exists.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PlayerPage from '../PlayerPage';

jest.mock('../WebSocketClient', () => ({
  __esModule: true,
  default: {
    connect: jest.fn(),
    disconnect: jest.fn(),
    ensureConnected: jest.fn(),
    sendCleanMessage: jest.fn(),
    onConnectionStatusChange: jest.fn(),
    onReconnected: jest.fn(),
    onMessage: jest.fn(),
    offMessage: jest.fn(),
  },
}));

const GAME = 'TEST123';
const ME = 'TestPlayer';

/** The three responses on the ballot, in ballot order — index IS the vote value. */
const BALLOT = [
  { playerName: 'Ada', answer: 'A careful answer' },
  { playerName: 'Grace', answer: 'A bolder answer' },
  { playerName: 'Katherine', answer: 'A third answer' },
];

function makeServer() {
  const server = {
    state: 'ASK#001',
    gameType: 'call-and-answer',
    answerers: [],
    voters: [],
    ballot: [],
    /** Every body POSTed to /votes, so a switched ranking can be read off the wire. */
    votePosts: [],
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

    if (method === 'POST' && url.includes(`games/${GAME}/votes`)) {
      server.votePosts.push(JSON.parse(options.body));
      return { ok: true, body: { message: 'Vote submitted successfully' } };
    }
    if (method === 'POST' && url.includes(`games/${GAME}/players`)) {
      return { ok: true, body: { success: true, playerName: ME } };
    }
    if (url.includes(`games/${GAME}/state`)) {
      const body = {
        state: server.state,
        gameType: server.gameType,
        currentQuestion: '001',
      };
      if (/\/state\/[^/?]+/.test(url)) {
        body.playerQuestionState = {
          questionNumber: 1,
          hasAnswered: server.answerers.includes(ME),
          hasVoted: server.voters.includes(ME),
        };
      }
      return { ok: true, body };
    }
    if (url.includes(`games/${GAME}/question`)) {
      return { ok: true, body: server.question };
    }
    if (url.includes(`games/${GAME}/answers`)) {
      const body = {
        gameId: GAME,
        questionId: '001',
        answerCount: server.answerers.length,
        timestamp: new Date().toISOString(),
      };
      if (server.ballot.length) body.answers = [...server.ballot];
      return { ok: true, body };
    }
    if (url.includes(`games/${GAME}/players`)) {
      return { ok: true, body: { players: [{ name: ME, playerName: ME, score: 0, totalScore: 0 }] } };
    }
    if (url.includes('question-sets')) {
      return { ok: true, body: { sets: [] } };
    }
    if (url.includes(`games/${GAME}`)) {
      return { ok: true, body: { engagementInfo: '' } };
    }
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

async function switchAwayAndBack() {
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

/** Join during ASK, then let the host open voting with a three-response ballot. */
async function reachTheBallot(server) {
  render(<PlayerPage />);

  fireEvent.change(screen.getByPlaceholderText(/Game ID/i), { target: { value: GAME } });
  fireEvent.change(screen.getByPlaceholderText(/Your Name/i), { target: { value: ME } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /Join Game/i }));
  });
  await waitFor(() => {
    expect(screen.getByText(/What is the capital of France/i)).toBeInTheDocument();
  });

  server.state = 'VOTE#001';
  server.ballot = [...BALLOT];
  await switchAwayAndBack();

  await waitFor(() => expect(screen.getAllByRole('combobox')).toHaveLength(3));
}

/** The quick ballot's three selects, in rank order. */
const ranks = () => screen.getAllByRole('combobox');
const rankValues = () => ranks().map((select) => select.value);

/** The option for ballot row `idx` inside the select for `rank` (0-based). */
const optionIn = (rank, idx) =>
  ranks()[rank].querySelector(`option[value="${idx}"]`);

const showDetailed = () => fireEvent.click(screen.getByRole('button', { name: /Detailed Vote/i }));
const showQuick = () => fireEvent.click(screen.getByRole('button', { name: /Quick Vote/i }));

/** The detailed ballot's rank button for row `idx`. */
const rankButton = (idx, label) =>
  screen.getAllByRole('button', { name: `Vote this answer ${label}` })[idx];

describe('the quick ballot lets a vote be switched', () => {
  let server;
  let user;

  beforeEach(() => {
    global.fetch.mockClear();
    localStorage.clear();
    window.history.pushState({}, '', '/play');
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    server = makeServer();
    installFetch(server);
    user = userEvent.setup();
  });

  /*
    rejects: `disabled` coming back on the options for answers ranked elsewhere.
             That attribute IS the bug: it is what makes the pick impossible in
             a real browser, and it is invisible to fireEvent, so nothing else
             in the suite would notice it returning.
  */
  test('an answer already ranked elsewhere is still selectable in another rank', async () => {
    await reachTheBallot(server);

    await user.selectOptions(ranks()[0], '1');
    expect(rankValues()).toEqual(['1', '', '']);

    // Ada's row is taken by 1st place. Every other rank must still offer it.
    expect(optionIn(1, 1)).not.toBeDisabled();
    expect(optionIn(2, 1)).not.toBeDisabled();
    // And the rank that holds it, obviously, must not disable its own value.
    expect(optionIn(0, 1)).not.toBeDisabled();
  });

  /*
    rejects: the reported fault itself. Driven through user-event, which will
             not operate a disabled option, so this fails against the shipped
             build exactly the way the player's finger does.
  */
  test('picking a ranked answer in another rank kicks it out of the first', async () => {
    await reachTheBallot(server);

    await user.selectOptions(ranks()[0], '1');   // 1st = Grace
    await user.selectOptions(ranks()[1], '0');   // 2nd = Ada
    expect(rankValues()).toEqual(['1', '0', '']);

    // Now move Grace from 1st to 3rd by picking her there.
    await user.selectOptions(ranks()[2], '1');

    expect(rankValues()).toEqual(['', '0', '1']);
  });

  /*
    rejects: a "fix" that lets the answer be picked twice — the same response
             sitting in two ranks at once, which the backend would happily
             store as two different scores for one row.
  */
  test('one answer never occupies two ranks at once', async () => {
    await reachTheBallot(server);

    await user.selectOptions(ranks()[0], '2');
    await user.selectOptions(ranks()[1], '2');

    const filled = rankValues().filter((v) => v !== '');
    expect(filled).toEqual(['2']);
    expect(rankValues()).toEqual(['', '2', '']);
  });

  /*
    rejects: clearing a rank back to the placeholder wiping the OTHER ranks —
             the empty string matches every empty slot, so a careless kick-out
             loop takes the whole ballot with it.
  */
  test('emptying one rank leaves the others alone', async () => {
    await reachTheBallot(server);

    await user.selectOptions(ranks()[0], '0');
    await user.selectOptions(ranks()[1], '1');
    await user.selectOptions(ranks()[2], '2');
    expect(rankValues()).toEqual(['0', '1', '2']);

    await user.selectOptions(ranks()[1], '');

    expect(rankValues()).toEqual(['0', '', '2']);
  });

  /*
    rejects: dropping the affordance that replaced `disabled`. Without the
             disabled state there is nothing in a bare select to say an answer
             is already ranked, so the option says where it currently sits —
             and that is the accessible name a screen reader announces.
  */
  test('an option says WHICH rank currently holds it', async () => {
    await reachTheBallot(server);

    await user.selectOptions(ranks()[0], '1');   // 1st = Grace  (row 1)
    await user.selectOptions(ranks()[1], '2');   // 2nd = Katherine (row 2)

    /*
      TWO DIFFERENT RANKS, DELIBERATELY. An earlier version of this test ranked
      one answer and checked for "1st Place", and a mutation that hard-coded the
      annotation to 'first' survived it — the assertion could not tell "says
      where it sits" from "always says first". Every rank in play has to be
      named correctly for the annotation to be worth anything.
    */
    expect(optionIn(2, 1)).toHaveTextContent(/currently 1st Place/);
    expect(optionIn(2, 2)).toHaveTextContent(/currently 2nd Place/);
    expect(optionIn(0, 2)).toHaveTextContent(/currently 2nd Place/);
    expect(optionIn(1, 1)).toHaveTextContent(/currently 1st Place/);

    // Seen from the rank that holds it, there is nothing to move it out of.
    expect(optionIn(0, 1)).not.toHaveTextContent(/Place/);
    expect(optionIn(1, 2)).not.toHaveTextContent(/Place/);
    // An answer nobody has ranked is not annotated at all.
    expect(optionIn(0, 0)).not.toHaveTextContent(/Place/);
    expect(optionIn(2, 0)).not.toHaveTextContent(/Place/);
  });

  /*
    rejects: a switch that only changes the screen. What matters is the ranking
             that reaches submit-vote.js — `{ answerIndex: rank }`.
  */
  test('the switched ranking is what gets submitted', async () => {
    await reachTheBallot(server);

    await user.selectOptions(ranks()[0], '0');
    await user.selectOptions(ranks()[1], '1');
    await user.selectOptions(ranks()[2], '2');

    // Change of mind: Katherine to 1st, which must vacate 3rd.
    await user.selectOptions(ranks()[0], '2');
    expect(rankValues()).toEqual(['2', '1', '']);

    // Fill the hole the switch left, then send it.
    await user.selectOptions(ranks()[2], '0');
    expect(rankValues()).toEqual(['2', '1', '0']);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Submit Votes/i }));
    });

    await waitFor(() => expect(server.votePosts).toHaveLength(1));
    expect(server.votePosts[0].votes).toEqual({ 2: 1, 1: 2, 0: 3 });
    expect(server.votePosts[0].playerName).toBe(ME);
  });
});

describe('the two ballots are one ballot', () => {
  let server;
  let user;

  beforeEach(() => {
    global.fetch.mockClear();
    localStorage.clear();
    window.history.pushState({}, '', '/play');
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    server = makeServer();
    installFetch(server);
    user = userEvent.setup();
  });

  /*
    rejects: the two views drifting onto separate notions of "which rank holds
             this answer". They read one `votes` object, and the detailed view's
             pressed state must be derived by the same rule the quick view's
             selects are.
  */
  test('a rank set in the quick ballot shows as pressed in the detailed one', async () => {
    await reachTheBallot(server);

    await user.selectOptions(ranks()[0], '1');   // 1st = Grace (row 1)
    await user.selectOptions(ranks()[1], '2');   // 2nd = Katherine (row 2)

    showDetailed();

    expect(rankButton(1, '1st Place')).toHaveAttribute('aria-pressed', 'true');
    expect(rankButton(2, '2nd Place')).toHaveAttribute('aria-pressed', 'true');
    // Row 0 holds nothing, and row 1 holds only 1st.
    expect(rankButton(0, '1st Place')).toHaveAttribute('aria-pressed', 'false');
    expect(rankButton(1, '2nd Place')).toHaveAttribute('aria-pressed', 'false');
  });

  /*
    rejects: the reverse drift. A kick-out performed in the detailed view has to
             be the same kick-out the quick selects show when the player toggles
             back — one state, rendered twice.
  */
  test('a kick-out done in the detailed ballot is what the quick ballot shows', async () => {
    await reachTheBallot(server);

    await user.selectOptions(ranks()[0], '1');   // 1st = Grace
    showDetailed();

    // Move Grace to 3rd from the detailed card. 1st must empty.
    fireEvent.click(rankButton(1, '3rd Place'));
    expect(rankButton(1, '1st Place')).toHaveAttribute('aria-pressed', 'false');
    expect(rankButton(1, '3rd Place')).toHaveAttribute('aria-pressed', 'true');

    showQuick();

    expect(rankValues()).toEqual(['', '', '1']);
  });

  /*
    rejects: a quick-path kick-out that leaves the detailed view believing the
             answer still holds its old rank — the failure this whole task is
             about, seen from the other side.
  */
  test('a switch made in the quick ballot is visible in the detailed one', async () => {
    await reachTheBallot(server);

    await user.selectOptions(ranks()[0], '0');   // 1st = Ada
    await user.selectOptions(ranks()[2], '0');   // move Ada to 3rd

    showDetailed();

    expect(rankButton(0, '1st Place')).toHaveAttribute('aria-pressed', 'false');
    expect(rankButton(0, '3rd Place')).toHaveAttribute('aria-pressed', 'true');
  });
});
