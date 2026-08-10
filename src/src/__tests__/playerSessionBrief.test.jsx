/**
 * Event Details, on the screen the setup field promises it on.
 *
 * `create-game.js:37` has always stored it as `Details` and `get-game.js:102`
 * has always returned it to participants as `engagementInfo` — and until now
 * `grep engagementInfo src/src` found only the two SEND sites. Nothing rendered
 * it, so the host's help text ("shown to participants when they join") was
 * false for the whole life of the field.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import PlayerPage from '../PlayerPage';

const API = window.API_BASE;

/** A fetch that answers by URL, so the join path can reach the lobby. */
function routeFetch({ engagementInfo = '', gameOk = true } = {}) {
  return jest.fn((url, opts = {}) => {
    const u = String(url);
    const reply = (body, ok = true) => Promise.resolve({
      ok,
      status: ok ? 200 : 404,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => body,
    });

    if (u === `${API}games/TEST123?role=player`) {
      return gameOk
        ? reply({ gameId: 'TEST123', gameType: 'call-and-answer', engagementInfo })
        : reply({ error: 'Game not found' }, false);
    }
    if (u.endsWith('/players') && opts.method === 'POST') {
      return reply({ success: true, playerName: 'Ada' });
    }
    if (u.includes('/state')) return reply({ state: 'CREATED', gameType: 'call-and-answer' });
    return reply({});
  });
}

async function joinAs(name = 'Ada') {
  render(<PlayerPage />);
  fireEvent.change(screen.getByPlaceholderText(/Game ID/i), { target: { value: 'TEST123' } });
  fireEvent.change(screen.getByPlaceholderText(/Your Name/i), { target: { value: name } });
  fireEvent.click(screen.getByRole('button', { name: /Join Game/i }));
  await screen.findByText(/Waiting for the game to start/i);
}

describe('what a participant sees when they join', () => {
  // A successful join writes `playerName_<gameId>`, and the next render would
  // otherwise open on the rejoin prompt rather than the join form.
  beforeEach(() => { window.localStorage.clear(); });
  afterEach(() => { global.fetch = jest.fn(); });

  // rejects: the shipped state, where the host types a session brief, the
  // backend stores it, the API returns it, and no participant ever sees it.
  test('shows the session details the host typed', async () => {
    global.fetch = routeFetch({ engagementInfo: 'Half a day on pricing strategy.' });
    await joinAs();
    expect(await screen.findByText('Half a day on pricing strategy.')).toBeInTheDocument();
  });

  // rejects: an always-rendered card, which would put an empty labelled box on
  // every lobby — the majority case, since the field is optional.
  test('shows nothing at all when the host left it blank', async () => {
    global.fetch = routeFetch({ engagementInfo: '' });
    await joinAs();
    expect(screen.queryByText(/about this session/i)).toBeNull();
  });

  // rejects: letting a failed or 404 lookup take the lobby down with it. The
  // brief is a nicety; being in the room is not.
  test('still reaches the lobby when the lookup fails', async () => {
    global.fetch = routeFetch({ gameOk: false });
    await joinAs();
    expect(screen.getByText(/Waiting for the game to start/i)).toBeInTheDocument();
    expect(screen.queryByText(/about this session/i)).toBeNull();
  });

  // rejects: fetching the host view, which returns the access code
  // (get-game.js:79) to a participant.
  test('asks for the participant view of the game, never the host view', async () => {
    global.fetch = routeFetch({ engagementInfo: 'Anything.' });
    await joinAs();
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(`${API}games/TEST123?role=player`);
    });
    const hostCalls = global.fetch.mock.calls.filter(([u]) => String(u).includes('role=host'));
    expect(hostCalls).toEqual([]);
  });
});
