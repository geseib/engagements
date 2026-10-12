/**
 * "STILL TO ANSWER" MOVES WITH THE COUNT ABOVE IT — HostRemote.jsx's status
 * card and the waiting list under it.
 *
 * Owner, 2026-10-12, dev session 5479 driven from the remote: *"the users left
 * to answer or vote does not update when the box above shows there has been
 * progress in the number of folks answering or voting."*
 *
 * The two came from two different requests: the count from `/host-state`
 * (every 2 s, `answerProgress` / `votingProgress`), the names from `/players`
 * (every 6 s, each row's `readiness`). Whenever the two disagreed the list lost
 * — by up to six seconds on every answer, and for the WHOLE vote, because
 * get-players read the voter off a field no ballot carries (fixed server-side,
 * tests/roster-readiness.js §5). Now WHO HAS ACTED comes from the same
 * `/host-state` response the count does; `/players` supplies only who is in
 * the room.
 *
 * rejects: a list that still names somebody the count has already counted;
 * the list depending on `/players` readiness when host-state says who acted.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import HostRemote from '../HostRemote';
import { waitingOn } from '../config/hostRemote';

jest.mock('../auth/authFetch', () => ({
  ...jest.requireActual('../auth/authFetch'),
  authFetch: jest.fn((url, init) => global.fetch(url, init)),
}));
jest.mock('qrcode.react', () => ({ QRCodeCanvas: () => null }));

/* The roster as `/players` returned it a few seconds ago: nobody has acted. */
const STALE_ROSTER = {
  players: ['Ada', 'Dana', 'Tomás'].map((playerName) => ({
    playerName,
    totalScore: 0,
    readiness: { hasAnswered: false, hasVoted: false },
  })),
  stats: { totalPlayers: 3 },
};

function serve(hostState) {
  global.fetch = jest.fn((url) => {
    const u = String(url);
    if (u.includes('/host-details')) return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    if (u.includes('/host-state')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          gameId: '5479', currentQuestion: 3, gameType: 'call-and-answer',
          gameMetadata: { title: 'Offsite', gameType: 'call-and-answer' },
          ...hostState,
        }),
      });
    }
    if (u.includes('/players')) return Promise.resolve({ ok: true, json: async () => STALE_ROSTER });
    return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
  });
}

async function connect() {
  render(<HostRemote />);
  fireEvent.change(screen.getByLabelText(/session code/i), { target: { value: '5479' } });
  fireEvent.click(screen.getByRole('button', { name: /connect/i }));
  const status = screen.getByText(/^(Live|Offline)$/);
  await waitFor(() => expect(status).toHaveTextContent(/^Live$/));
}

const waitingNames = () => Array.from(document.querySelectorAll('.hr-wait-name')).map((n) => n.textContent);

beforeEach(() => {
  jest.clearAllMocks();
  window.API_BASE = 'https://api.test/';
});

describe('the waiting list follows the same response as the count', () => {
  test('ASK: two counted as answered are not still listed as waiting', async () => {
    serve({
      state: 'ASK#003',
      answerProgress: { answersReceived: 2, totalPlayers: 3, answererIds: ['Ada', 'Tomás'] },
    });
    await connect();
    expect(await screen.findByText('2 of 3 answered')).toBeInTheDocument();
    await waitFor(() => expect(waitingNames()).toEqual(['Dana']));
  });

  test('VOTE: the voters the count counted leave the list', async () => {
    serve({
      state: 'VOTE#003',
      votingProgress: { votesReceived: 1, totalPlayers: 3, votersIds: ['Dana'] },
    });
    await connect();
    expect(await screen.findByText('1 of 3 voted')).toBeInTheDocument();
    await waitFor(() => expect(waitingNames()).toEqual(['Ada', 'Tomás']));
  });

  test('everyone counted: no list at all, matching "Everyone is in"', async () => {
    serve({
      state: 'ASK#003',
      answerProgress: { answersReceived: 3, totalPlayers: 3, answererIds: ['Ada', 'Dana', 'Tomás'] },
    });
    await connect();
    expect(await screen.findByText(/everyone is in/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('group', { name: /still to answer/i })).toBeNull());
  });
});

describe('waitingOn with a host-state snapshot', () => {
  test('the snapshot\'s acted list wins over stale roster readiness', () => {
    const snapshot = { state: 'ASK#001', answerProgress: { answererIds: ['Ada'] } };
    expect(waitingOn(STALE_ROSTER, snapshot).names).toEqual(['Dana', 'Tomás']);
  });

  test('a snapshot with no acted list falls back to the roster\'s readiness', () => {
    const roster = { players: [{ playerName: 'Ada', readiness: { hasVoted: true } }, { playerName: 'Dana' }] };
    expect(waitingOn(roster, { state: 'VOTE#001' }).names).toEqual(['Dana']);
  });

  test('a bare state string still works as before', () => {
    expect(waitingOn(STALE_ROSTER, 'ASK#001').heading).toBe('Still to answer');
    expect(waitingOn(STALE_ROSTER, 'RESULTS#001').applicable).toBe(false);
  });
});
