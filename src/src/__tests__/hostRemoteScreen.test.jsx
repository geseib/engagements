/**
 * The remote's CALL SITES, not its decision module.
 *
 * config/hostRemote.js is thoroughly unit-tested and that is not enough: this
 * codebase has shipped a correct module wired to nothing at least twice (an
 * OAuth return-path fix that was dead code behind twelve passing tests, an ARIA
 * role with no keyboard activation). Every assertion here fails if
 * `HostRemote.jsx` stops calling the function whose result it renders.
 *
 * Three things are pinned:
 *
 *   1. the RESULTS two-step reaches the button and the button reaches the
 *      server — `primaryAction` can be perfect while the component never
 *      passes it `stageBeat`;
 *   2. the waiting list is rendered from the roster the component ALREADY
 *      polled and used to throw away (HostRemote.jsx:155 kept a count and
 *      discarded eight names);
 *   3. the AI read-back is fetched and rendered under the server's own field
 *      names.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import HostRemote from '../HostRemote';

// A real fetch would be attempted against the Cognito pool; the module under
// test only needs the header attached, and the assertion is about the URL and
// body it is handed.
jest.mock('../auth/authFetch', () => ({
  authFetch: jest.fn(() => Promise.resolve({
    ok: true,
    status: 200,
    json: async () => ({ status: 'OK' }),
  })),
}));
// qrcode.react draws to a canvas jsdom does not implement.
jest.mock('qrcode.react', () => ({ QRCodeCanvas: () => null }));

const { authFetch } = require('../auth/authFetch');

/**
 * Route every GET the remote makes. The shapes are the ones the real handlers
 * return: get-game-state.js for /state (including its new `stageBeat`),
 * get-players.js:101-152 for /players, get-ai-summary.js:568 for /ai-summary.
 */
function serve({ state, stageBeat = 'results', players = [], aiSummary = null, progress = {} }) {
  global.fetch = jest.fn((url) => {
    if (String(url).includes('/state')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          gameId: '4821',
          state,
          stageBeat,
          currentQuestion: 3,
          gameType: 'call-and-answer',
          gameMetadata: { title: 'Q3 Leadership Offsite', gameType: 'call-and-answer' },
          ...progress,
        }),
      });
    }
    if (String(url).includes('/players')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ players, stats: { totalPlayers: players.length } }),
      });
    }
    if (String(url).includes('/ai-summary')) {
      return aiSummary
        ? Promise.resolve({ ok: true, status: 200, json: async () => aiSummary })
        : Promise.resolve({ ok: false, status: 404, json: async () => ({ status: 'not_ready' }) });
    }
    return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
  });
}

const person = (playerName, readiness) => ({
  playerName, totalScore: 0, isConnected: true,
  readiness: { isReady: false, type: 'answered', ...readiness },
});

/** Enter the session the way the entry card does — no window.location needed. */
async function connect() {
  render(<HostRemote />);
  fireEvent.change(screen.getByLabelText(/session code/i), { target: { value: '4821' } });
  fireEvent.click(screen.getByRole('button', { name: /connect/i }));
  await waitFor(() => expect(screen.queryByLabelText(/session code/i)).not.toBeInTheDocument());
}

beforeEach(() => {
  jest.clearAllMocks();
  window.API_BASE = 'https://api.test/';
});

describe('the RESULTS two-step reaches the button', () => {
  it('offers What We Heard while the round is on its tally beat', async () => {
    // Fails if HostRemote calls primaryAction(state, gameType) without the
    // beat: the module would be right and the phone would still say "Next
    // Round" and skip the AI beat, which is the whole defect.
    serve({ state: 'RESULTS#003', stageBeat: 'results' });
    await connect();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /what we heard/i })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /next round/i })).not.toBeInTheDocument();
  });

  it('offers Next Round once the server says the beat has moved', async () => {
    serve({ state: 'RESULTS#003', stageBeat: 'field-notes' });
    await connect();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /next round/i })).toBeInTheDocument());
  });

  it('posts the beat to stage-beat, addressed to the round on screen', async () => {
    // The one tap that matters. Fails if `fire` cannot build a request for the
    // new action id, or if the button is wired to next-question instead.
    serve({ state: 'RESULTS#003', stageBeat: 'results' });
    await connect();
    const button = await screen.findByRole('button', { name: /what we heard/i });
    fireEvent.click(button);

    await waitFor(() => expect(authFetch).toHaveBeenCalled());
    const [url, options] = authFetch.mock.calls[0];
    expect(url).toBe('https://api.test/games/4821/stage-beat');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual({ beat: 'field-notes', questionNumber: 3 });
  });

  it('takes the beat on ONE tap', async () => {
    // Moving to the read-back discards nothing, so arming it would put a
    // "Tap again to confirm" in front of the host on the expected beat, in
    // front of a room. `needsConfirmation` says no; this checks the component
    // agrees.
    serve({ state: 'RESULTS#003', stageBeat: 'results' });
    await connect();
    fireEvent.click(await screen.findByRole('button', { name: /what we heard/i }));
    await waitFor(() => expect(authFetch).toHaveBeenCalledTimes(1));
  });
});

describe('the waiting list', () => {
  it('names who has not answered, from the roster it already polls', async () => {
    // HostRemote.jsx:155 kept `data.stats.totalPlayers` and dropped the array.
    // This fails the moment it goes back to doing that.
    serve({
      state: 'ASK#003',
      progress: { answerProgress: { answersReceived: 1, totalPlayers: 3 } },
      players: [
        person('Dana', { hasAnswered: false }),
        person('Ada', { hasAnswered: true }),
        person('Tomás', { hasAnswered: false }),
      ],
    });
    await connect();

    const block = await screen.findByRole('group', { name: /still to answer/i });
    expect(within(block).getByText('Dana')).toBeInTheDocument();
    expect(within(block).getByText('Tomás')).toBeInTheDocument();
    expect(within(block).queryByText('Ada')).not.toBeInTheDocument();
  });

  it('switches to who has not VOTED once voting opens', async () => {
    // Everyone has answered by now, so a list still filtering on hasAnswered
    // renders empty during the phase the host most needs it.
    serve({
      state: 'VOTE#003',
      progress: { votingProgress: { votesReceived: 1, totalPlayers: 2 } },
      players: [
        person('Dana', { hasAnswered: true, hasVoted: false }),
        person('Ada', { hasAnswered: true, hasVoted: true }),
      ],
    });
    await connect();

    const block = await screen.findByRole('group', { name: /still to vote/i });
    expect(within(block).getByText('Dana')).toBeInTheDocument();
    expect(within(block).queryByText('Ada')).not.toBeInTheDocument();
  });

  it('prints the privacy note beside the names', async () => {
    // 17-remote.html draws this note IN the block, and §5.5 says keep it: it is
    // the argument for why naming people here is allowed, printed where the
    // person holding the phone can read it. Deleting the sentence is the
    // change this rejects.
    serve({
      state: 'ASK#003',
      progress: { answerProgress: { answersReceived: 0, totalPlayers: 1 } },
      players: [person('Dana', { hasAnswered: false })],
    });
    await connect();

    const block = await screen.findByRole('group', { name: /still to answer/i });
    expect(within(block).getByText(/Private/)).toBeInTheDocument();
    expect(within(block).getByText(/different fact from who wrote what/i)).toBeInTheDocument();
  });

  it('says nothing at all once the room is done', async () => {
    serve({
      state: 'ASK#003',
      progress: { answerProgress: { answersReceived: 1, totalPlayers: 1 } },
      players: [person('Ada', { hasAnswered: true })],
    });
    await connect();
    await screen.findByText(/Everyone is in/i);
    expect(screen.queryByRole('group', { name: /still to/i })).not.toBeInTheDocument();
  });

  it('is absent on RESULTS, where nobody is being waited for', async () => {
    // get-players reports hasVoted:false for the whole room once the round has
    // resolved. Rendering the list here would name every player as holding the
    // session up on the screen where the session is not held up.
    serve({
      state: 'RESULTS#003',
      players: [person('Dana', { hasAnswered: true, hasVoted: false })],
    });
    await connect();
    await screen.findByRole('button', { name: /what we heard/i });
    expect(screen.queryByRole('group', { name: /still to/i })).not.toBeInTheDocument();
  });
});

describe('the AI read-back on the phone', () => {
  const summary = {
    summaryText: 'The room wants to defend price, but nobody proposed telling a customer why.',
    discussionQuestions: ['Who are we prepared to let go?', 'Why were the cheap moves popular?'],
    nextSteps: ['Name one segment before the next session.'],
  };

  it('fetches and renders it once the beat has moved', async () => {
    // `discussionQuestions` is the SERVER's name. GameHostPage renames it to
    // `discussionTopics` (:775); reading that name here renders the headline
    // with no points under it — plausibly, and silently.
    serve({ state: 'RESULTS#003', stageBeat: 'field-notes', aiSummary: summary });
    await connect();

    expect(await screen.findByText(/nobody proposed telling a customer why/i)).toBeInTheDocument();
    expect(screen.getByText(/Who are we prepared to let go\?/)).toBeInTheDocument();
    expect(screen.getByText(/Name one segment before the next session\./)).toBeInTheDocument();
  });

  it('does not fetch it while the round is still on its tally beat', async () => {
    // The endpoint 404s on a cache miss and the summary is generated
    // asynchronously; polling it every two seconds from the moment results open
    // is a request per poll for a screen nobody has asked for.
    serve({ state: 'RESULTS#003', stageBeat: 'results', aiSummary: summary });
    await connect();
    await screen.findByRole('button', { name: /what we heard/i });
    expect(global.fetch.mock.calls.some(([u]) => String(u).includes('ai-summary'))).toBe(false);
  });

  it('says so, rather than rendering blank, while the summary is still being written', async () => {
    // 404 { status: 'not_ready' } is the normal state for the first seconds of
    // the beat. An unguarded render shows an empty screen and the host cannot
    // tell it apart from a broken one.
    serve({ state: 'RESULTS#003', stageBeat: 'field-notes', aiSummary: null });
    await connect();
    expect(await screen.findByText(/reading the responses/i)).toBeInTheDocument();
  });
});
