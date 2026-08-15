import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import PlayerPage from '../PlayerPage';

// The player page reaches for the socket on mount. None of these bugs are
// transport bugs, so the socket is a stub — every refresh in these tests is
// driven by a real browser event instead.
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

const API = 'http://localhost:3000/api/';
const GAME = 'TEST123';
const ME = 'TestPlayer';

/**
 * A stand-in for the real backend, shaped by what the deployed handlers
 * actually return.
 *
 * The `/answers` response deliberately carries no `hasAnswer` field and
 * ignores `player=`/`question=`: that is precisely what get-answers.js does
 * (it reads only `role` and `questionId`), and a mock that invented the field
 * would hide the bug under test.
 */
function makeServer() {
  const server = {
    state: 'ASK#001',
    gameType: 'trivia',
    answerers: [],          // who has answered — drives both routes below
    voters: [],             // who has voted
    ballot: [],             // the responses on offer during VOTE#
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
      return { ok: true, body: { success: true, playerName: ME } };
    }
    /*
      TWO ROUTES, AND THEY ANSWER DIFFERENT QUESTIONS — which is the whole
      subject of this file, so the mock has to model both honestly.

      `/state` carries no player identity, so get-game-state.js takes its
      `if (!playerId || includeHostData)` branch and answers as if a host had
      asked: roster lists, and only for the phase they belong to
      (`answerProgress` exists solely while the state is `ASK#`).

      `/state/{playerName}` reads THAT player's own answer and vote rows
      directly and returns `playerQuestionState`. It is gated on there being a
      current question rather than on the phase, so unlike the roster it keeps
      answering once the round moves on. The player page reads this one.
    */
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
      } else if (server.state.startsWith('ASK#')) {
        body.answerProgress = {
          answersReceived: server.answerers.length,
          totalPlayers: 3,
          answererIds: [...server.answerers],
        };
      }
      return { ok: true, body };
    }
    if (url.includes(`games/${GAME}/question`)) {
      return { ok: true, body: server.question };
    }
    /*
      During ASK# this is a count and nothing that identifies anyone — exactly
      what get-answers.js returns to a player mid-round.

      During VOTE# it is the ballot, because that is what the player ranks.
      `server.ballot` is empty by default so the ASK# tests keep the shape they
      were written against.
    */
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
    const { ok, body, reject } = server.handle(String(url), options);
    if (reject) return Promise.reject(new Error(reject));
    return Promise.resolve({
      ok,
      status: ok ? 200 : 500,
      json: async () => body,
    });
  });
}

/** A real tab switch: hidden, then visible again, with the events browsers send. */
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

async function joinAndReachQuestion() {
  render(<PlayerPage />);

  fireEvent.change(screen.getByPlaceholderText(/Game ID/i), { target: { value: GAME } });
  fireEvent.change(screen.getByPlaceholderText(/Your Name/i), { target: { value: ME } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /Join Game/i }));
  });

  await waitFor(() => {
    expect(screen.getByText(/What is the capital of France/i)).toBeInTheDocument();
  });
}

const submitButton = () => screen.getByRole('button', { name: /Submit Answer/i });

describe('PlayerPage — answered state and in-flight selection survive a refresh', () => {
  let server;

  beforeEach(() => {
    global.fetch.mockClear();
    localStorage.clear();
    window.history.pushState({}, '', '/play');
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    server = makeServer();
    installFetch(server);
  });

  // BUG A. The player answers, backgrounds the tab, comes back. The server
  // knows they answered; the screen must agree.
  test('a submitted answer survives switching away from the tab and back', async () => {
    await joinAndReachQuestion();

    fireEvent.click(screen.getByText(/Paris/));
    await act(async () => {
      fireEvent.click(submitButton());
    });

    await waitFor(() => {
      expect(screen.getByText(/Answer Submitted!/i)).toBeInTheDocument();
    });

    // The server has recorded it, which is the whole point of asking the server.
    server.answerers = [ME];

    await switchAwayAndBack();

    expect(screen.getByText(/Answer Submitted!/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Submit Answer/i })).not.toBeInTheDocument();
  });

  // BUG B. Tapped but not submitted. A refresh landing in that window must not
  // throw the tap away.
  test('a tapped-but-unsubmitted option survives a refresh landing before Submit', async () => {
    await joinAndReachQuestion();

    fireEvent.click(screen.getByText(/Paris/));
    expect(submitButton()).not.toBeDisabled();

    // The player has not submitted, so the server still lists nobody.
    await switchAwayAndBack();

    expect(submitButton()).not.toBeDisabled();
    // ASSERTED ON `aria-checked`, NOT ON A CLASS. This read
    // `.closest('.trivia-option')).toHaveClass('active')` — two class names the
    // player surface carried only because this line named them. Neither has
    // painted anything since the option became a radio button
    // (styles.css:6839 records `.trivia-option` losing its rules), so the
    // assertion was pinning dead paint while the state a screen reader
    // announces — and the state `.plr-opt[aria-checked="true"]` actually
    // renders from — went unguarded.
    expect(screen.getByText(/Paris/).closest('[role="radio"]')).toHaveAttribute('aria-checked', 'true');
  });

  // The reset still has to happen when it should, or the fix above would just
  // be "never clear anything".
  test('moving to the next question clears the answered flag and the draft', async () => {
    await joinAndReachQuestion();

    fireEvent.click(screen.getByText(/Paris/));
    await act(async () => {
      fireEvent.click(submitButton());
    });
    await waitFor(() => {
      expect(screen.getByText(/Answer Submitted!/i)).toBeInTheDocument();
    });
    server.answerers = [ME];

    // Host advances. New question, nobody has answered it.
    server.state = 'ASK#002';
    server.answerers = [];
    server.question = {
      title: 'What is the capital of Spain?',
      questionNumber: '002',
      id: '002',
      optionA: 'Lisbon',
      optionB: 'Madrid',
    };

    await switchAwayAndBack();

    await waitFor(() => {
      expect(screen.getByText(/What is the capital of Spain/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/Answer Submitted!/i)).not.toBeInTheDocument();
    // Draft cleared: nothing is selected, so Submit is unavailable.
    expect(submitButton()).toBeDisabled();
  });

  // The same reset, exercised with a draft that is actually dirty: the player
  // taps and then never submits, and the host moves on. A selection made
  // against the previous question must not arrive pre-made on the next one.
  test('an unsubmitted selection does not carry over to the next question', async () => {
    await joinAndReachQuestion();

    fireEvent.click(screen.getByText(/Paris/));
    expect(submitButton()).not.toBeDisabled();

    server.state = 'ASK#002';
    server.question = {
      title: 'What is the capital of Spain?',
      questionNumber: '002',
      id: '002',
      optionA: 'Lisbon',
      optionB: 'Madrid',
    };

    await switchAwayAndBack();

    await waitFor(() => {
      expect(screen.getByText(/What is the capital of Spain/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/Madrid/).closest('[role="radio"]')).toHaveAttribute('aria-checked', 'false');
    expect(submitButton()).toBeDisabled();
  });

  // A full reload is the harsher version of Bug A: no local state at all, so
  // the screen is only ever as right as the question it asks the server.
  test('a player who reloads mid-question is shown as having answered', async () => {
    server.answerers = [ME];
    localStorage.setItem(`playerName_${GAME}`, ME);
    window.history.pushState({}, '', `/play?gameId=${GAME}&name=${ME}`);

    render(<PlayerPage />);

    // Saved name + URL name match, so the page offers a rejoin rather than
    // silently re-entering.
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: new RegExp(`Rejoin as ${ME}`) }));
    });

    await waitFor(() => {
      expect(screen.getByText(/Answer Submitted!/i)).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /Submit Answer/i })).not.toBeInTheDocument();
  });

  // A refresh that came back without the participation block knows nothing
  // about who answered, and must therefore change nothing. get-game-state.js
  // only attaches `playerQuestionState` when it can resolve a current question
  // number, so an ASK# response without it is a real reply, not a hypothetical.
  //
  // THIS USED TO DELETE `answerProgress`, and after the endpoint moved that
  // would have passed without proving anything — the page no longer reads that
  // key, so stripping it changes nothing whether or not the guard exists. It
  // strips what the page actually reads.
  test('a refresh that omits the participation block does not un-answer the player', async () => {
    await joinAndReachQuestion();

    fireEvent.click(screen.getByText(/Paris/));
    await act(async () => {
      fireEvent.click(submitButton());
    });
    await waitFor(() => {
      expect(screen.getByText(/Answer Submitted!/i)).toBeInTheDocument();
    });
    server.answerers = [ME];

    // Still ASK#001, still 200 OK — just no playerQuestionState on it.
    const healthy = server.handle;
    server.handle = (url, options) => {
      const result = healthy(url, options);
      if (url.includes(`games/${GAME}/state`)) delete result.body.playerQuestionState;
      return result;
    };

    await switchAwayAndBack();

    expect(screen.getByText(/Answer Submitted!/i)).toBeInTheDocument();
  });

  /**
   * `checkPlayerAnswer` has TWO "I could not find out" exits, and the suite
   * only covered one. The test above deletes `answerProgress` from a 200; this
   * one makes `/state` fail outright, which takes the earlier
   * `if (!stateRes.ok) return null` branch instead.
   *
   * REJECTS: changing that single `return null` to `return false`. Everything
   * else stays green when you do — including the roster-omitted test, which
   * never reaches this line — and the result is the exact defect this whole
   * fix removed: one bad response throws away a submitted answer. A flaky
   * /state is the likeliest thing to happen in a real room, on the wifi that
   * caused the disconnect reported earlier today.
   */
  test('a refresh whose state request fails does not un-answer the player', async () => {
    await joinAndReachQuestion();

    fireEvent.click(screen.getByText(/Paris/));
    await act(async () => {
      fireEvent.click(submitButton());
    });
    await waitFor(() => {
      expect(screen.getByText(/Answer Submitted!/i)).toBeInTheDocument();
    });
    server.answerers = [ME];

    // ONLY the second /state of the refresh fails, and that precision is the
    // whole test. A refresh hits /state twice: checkGameState first, then
    // checkPlayerAnswer. Failing both makes checkGameState bail before
    // fetchCurrentQuestion ever runs, so the branch under test is never
    // reached and the test passes no matter what the branch returns — which
    // is exactly what the first draft of this test did.
    const healthy = server.handle;
    let stateCalls = 0;
    server.handle = (url, options) => {
      if (url.includes(`games/${GAME}/state`)) {
        stateCalls += 1;
        if (stateCalls > 1) return { ok: false, body: {} };
      }
      return healthy(url, options);
    };

    await switchAwayAndBack();

    expect(stateCalls).toBeGreaterThan(1);
    expect(screen.getByText(/Answer Submitted!/i)).toBeInTheDocument();
  });

  // The complement of the test above: not knowing must not carry the previous
  // question's "answered" over onto a question the player has not seen.
  test('a new question with no roster still opens unanswered', async () => {
    await joinAndReachQuestion();

    fireEvent.click(screen.getByText(/Paris/));
    await act(async () => {
      fireEvent.click(submitButton());
    });
    await waitFor(() => {
      expect(screen.getByText(/Answer Submitted!/i)).toBeInTheDocument();
    });

    server.state = 'ASK#002';
    server.question = {
      title: 'What is the capital of Spain?',
      questionNumber: '002',
      id: '002',
      optionA: 'Lisbon',
      optionB: 'Madrid',
    };
    const healthy = server.handle;
    server.handle = (url, options) => {
      const result = healthy(url, options);
      if (url.includes(`games/${GAME}/state`)) delete result.body.playerQuestionState;
      return result;
    };

    await switchAwayAndBack();

    await waitFor(() => {
      expect(screen.getByText(/What is the capital of Spain/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/Answer Submitted!/i)).not.toBeInTheDocument();
    expect(submitButton()).toBeDisabled();
  });
});

/*
 * THE VOTE HALF, WHICH IS WHAT THE REPORT NAMED FIRST.
 *
 *   "if a player switches away from the tab after answering or voting, the
 *    screen resets as if they have not already answered."
 *
 * Everything above is the ANSWER path, and it was hardened first — which is
 * precisely why the vote path stayed broken so long. Two separate faults, both
 * only on this side:
 *
 *   1. The ballot-clearing guard compared `gameState` (frozen at join time
 *      inside the resume effect's closure) against the server's, so it was true
 *      on EVERY resync and wiped the cast vote before anything else spoke.
 *   2. `checkPlayerVote` returned a confident `false` from three exits that had
 *      learned nothing, and its caller assigned that straight into state.
 *
 * Either one alone re-offers the ballot to somebody who has already voted.
 */
describe('PlayerPage — a cast vote survives a tab switch', () => {
  let server;

  beforeEach(() => {
    global.fetch.mockClear();
    localStorage.clear();
    window.history.pushState({}, '', '/play');
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    server = makeServer();
    server.gameType = 'call-and-answer';
    installFetch(server);
  });

  /** Join during ASK, then let the host move the room to VOTE on the same round. */
  async function joinAndReachVoting() {
    await joinAndReachQuestion();
    server.state = 'VOTE#001';
    server.voters = [ME];          // this player has already cast their ballot
    await switchAwayAndBack();
    await waitFor(() => {
      expect(screen.getByText(/Votes Submitted!/i)).toBeInTheDocument();
    });
  }

  // rejects: BOTH vote-side faults. The stale-closure guard clears `hasVoted`
  //          on every resync; the `return false` exits then confirm it. Restore
  //          either and the ballot comes back in front of someone who has voted.
  test('a second tab switch does not put the ballot back', async () => {
    await joinAndReachVoting();

    await switchAwayAndBack();
    await switchAwayAndBack();

    expect(screen.getByText(/Votes Submitted!/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Submit Votes/i })).not.toBeInTheDocument();
  });

  // rejects: collapsing "I could not find out" into "you have not voted" on the
  //          vote path — the exact asymmetry that existed between the two
  //          checks. Still VOTE#001, still 200 OK, just nothing said about this
  //          player, which is what the payload looks like when a request races
  //          the round.
  test('a resync that says nothing about this player leaves the vote alone', async () => {
    await joinAndReachVoting();

    const healthy = server.handle;
    server.handle = (url, options) => {
      const result = healthy(url, options);
      if (url.includes(`games/${GAME}/state`)) delete result.body.playerQuestionState;
      return result;
    };

    await switchAwayAndBack();

    expect(screen.getByText(/Votes Submitted!/i)).toBeInTheDocument();
  });

  // rejects: a fix that simply never clears the ballot, which would lock the
  //          player out of voting for the rest of the session.
  test('a genuinely new voting round does open the ballot again', async () => {
    await joinAndReachVoting();

    server.state = 'VOTE#002';
    server.voters = [];
    await switchAwayAndBack();

    await waitFor(() => {
      expect(screen.queryByText(/Votes Submitted!/i)).not.toBeInTheDocument();
    });
  });

  /**
   * THE RANKING DRAFT, WHICH IS THE CLEARING BLOCK'S REAL JOB.
   *
   * Written because a mutation survived. Disabling the whole
   * `if (isNewVoteRound)` block left every other test in this file green: the
   * flag it sets is recomputed from `nextParticipation`, which is handed
   * `isNewVoteRound` separately, so the server's answer covers for it. What the
   * block uniquely does is wipe `votes` — and nothing else restores that.
   *
   * A stale draft is not cosmetic. `votes` holds PLAYER NAMES chosen from round
   * one's ballot, and round two's ballot is a different set of responses. The
   * selects come up pre-filled with a ranking the player never made for this
   * round, over answers that may not even be on offer.
   */
  test("a new round does not inherit the previous round's rankings", async () => {
    await joinAndReachQuestion();

    server.state = 'VOTE#001';
    server.ballot = [
      { playerName: 'Ada', answer: 'A careful answer' },
      { playerName: 'Grace', answer: 'A bolder answer' },
    ];
    await switchAwayAndBack();

    const firstPick = () => screen.getAllByRole('combobox')[0];
    await waitFor(() => expect(firstPick()).toBeInTheDocument());

    // The option value is the ballot INDEX, not the name — that is what
    // handleVoteChange stores and what `votes` therefore holds.
    fireEvent.change(firstPick(), { target: { value: '0' } });
    expect(firstPick().value).toBe('0');

    // The host opens round two. Same shape of ballot, different responses.
    server.state = 'VOTE#002';
    server.ballot = [
      { playerName: 'Ada', answer: 'Something else entirely' },
      { playerName: 'Grace', answer: 'And another' },
    ];
    await switchAwayAndBack();

    await waitFor(() => expect(firstPick().value).toBe(''));
  });
});
