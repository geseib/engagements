/**
 * THE GOAL ON THE HOST'S PHONE — config/hostRemote.js remoteGoal and the
 * remote's status card (HostRemote.jsx), events M1b Task 6.
 *
 * rejects: the remote reading the goal from gameMetadata (host-state keeps it
 * at the top level); the notice before the goal's own results, or with no
 * goal; a survey showing a goal; the notice replacing or disabling the
 * primary button.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import HostRemote from '../HostRemote';
import { remoteGoal } from '../config/hostRemote';

jest.mock('../auth/authFetch', () => ({
  ...jest.requireActual('../auth/authFetch'),
  authFetch: jest.fn((url, init) => (init && init.method === 'POST'
    ? Promise.resolve({ ok: true, status: 200, json: async () => ({ status: 'OK' }) })
    : global.fetch(url, init))),
}));
jest.mock('qrcode.react', () => ({ QRCodeCanvas: () => null }));

const LINE = 'That’s your 5. Keep going if there’s time, or end the session.';

describe('remoteGoal', () => {
  test('mid-way, from host-state\'s top-level target', () => {
    expect(remoteGoal({ state: 'VOTE#002', gameType: 'poll', target: 4, gameMetadata: { gameType: 'poll' } }))
      .toEqual({ progress: 'Question 2 of 4', reached: false, line: '' });
  });
  test('the goal\'s own results: reached, with the notice', () => {
    expect(remoteGoal({ state: 'RESULTS#005', gameType: 'trivia', target: 5 }))
      .toEqual({ progress: 'Question 5 of 5', reached: true, line: LINE });
  });
  test('a goal inside gameMetadata is not where host-state puts it', () => {
    expect(remoteGoal({ state: 'ASK#001', gameType: 'trivia', gameMetadata: { target: 5 } }).progress).toBe('');
  });
  test('nothing for a survey, before the first round, after the end, or with no answer yet', () => {
    const none = { progress: '', reached: false, line: '' };
    expect(remoteGoal({ state: 'SURVEY#OPEN', gameType: 'survey', target: 4 })).toEqual(none);
    expect(remoteGoal({ state: 'CREATED', gameType: 'trivia', target: 4 })).toEqual(none);
    expect(remoteGoal({ state: 'ENDED', gameType: 'trivia', target: 4 })).toEqual(none);
    expect(remoteGoal(null)).toEqual(none);
  });
});

function serve({ state, gameType = 'call-and-answer', target = null }) {
  global.fetch = jest.fn((url) => {
    const u = String(url);
    if (u.includes('/host-details')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    }
    if (u.includes('/host-state')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          gameId: '4821', state, stageBeat: 'results', currentQuestion: 5, gameType, target,
          gameMetadata: { title: 'Q3 Leadership Offsite', gameType },
        }),
      });
    }
    if (u.includes('/players')) {
      return Promise.resolve({ ok: true, json: async () => ({ players: [], stats: { totalPlayers: 0 } }) });
    }
    return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
  });
}

async function connect() {
  render(<HostRemote />);
  fireEvent.change(screen.getByLabelText(/session code/i), { target: { value: '4821' } });
  fireEvent.click(screen.getByRole('button', { name: /connect/i }));
  const status = screen.getByText(/^(Live|Offline)$/);
  await waitFor(() => expect(status).toHaveTextContent(/^Live$/));
}

beforeEach(() => {
  jest.clearAllMocks();
  window.API_BASE = 'https://api.test/';
});

describe('the status card', () => {
  test('mid-way: "Question 3 of 5" under the headline, and no notice', async () => {
    serve({ state: 'ASK#003', target: 5 });
    await connect();
    expect(await screen.findByTestId('remote-goal')).toHaveTextContent('Question 3 of 5');
    expect(screen.queryByTestId('remote-goal-reached')).toBeNull();
  });

  test('the goal\'s own results: the notice, and the primary is still the one it would be', async () => {
    serve({ state: 'RESULTS#005', target: 5 });
    await connect();
    expect(await screen.findByTestId('remote-goal-reached')).toHaveTextContent(LINE);
    expect(screen.getByRole('button', { name: /what we heard/i })).toBeEnabled();
  });

  test('no goal: nothing extra on the card', async () => {
    serve({ state: 'RESULTS#005', target: null });
    await connect();
    await screen.findByRole('button', { name: /what we heard/i });
    expect(screen.queryByTestId('remote-goal')).toBeNull();
    expect(screen.queryByTestId('remote-goal-reached')).toBeNull();
  });
});
