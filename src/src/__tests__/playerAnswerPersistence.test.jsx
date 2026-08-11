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
    answerers: [],          // answerProgress.answererIds
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
    if (url.includes(`games/${GAME}/state`)) {
      const body = {
        state: server.state,
        gameType: server.gameType,
        currentQuestion: '001',
      };
      if (server.state.startsWith('ASK#')) {
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
    // The real shape during ASK#: a count, and nothing that identifies anyone.
    if (url.includes(`games/${GAME}/answers`)) {
      return {
        ok: true,
        body: {
          gameId: GAME,
          questionId: '001',
          answerCount: server.answerers.length,
          timestamp: new Date().toISOString(),
        },
      };
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
    expect(screen.getByText(/Paris/).closest('.trivia-option')).toHaveClass('active');
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
    expect(screen.getByText(/Madrid/).closest('.trivia-option')).not.toHaveClass('active');
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

  // A refresh that came back without the roster knows nothing about who
  // answered, and must therefore change nothing. get-game-state.js only
  // attaches answerProgress when it can resolve a current question number, so
  // an ASK# response without it is a real reply, not a hypothetical one.
  test('a refresh that omits the answered roster does not un-answer the player', async () => {
    await joinAndReachQuestion();

    fireEvent.click(screen.getByText(/Paris/));
    await act(async () => {
      fireEvent.click(submitButton());
    });
    await waitFor(() => {
      expect(screen.getByText(/Answer Submitted!/i)).toBeInTheDocument();
    });
    server.answerers = [ME];

    // Still ASK#001, still 200 OK — just no answerProgress on the payload.
    const healthy = server.handle;
    server.handle = (url, options) => {
      const result = healthy(url, options);
      if (url.includes(`games/${GAME}/state`)) delete result.body.answerProgress;
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
      if (url.includes(`games/${GAME}/state`)) delete result.body.answerProgress;
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
