/**
 * THE PLAYER'S WAY IN.
 *
 * This suite has never run. It set `window.location.pathname = '/play'` by
 * assignment — which jsdom treats as a navigation and refuses — and then looked
 * for a Game ID field that its own setup had prevented from rendering. Every
 * assertion after that failed for a reason unrelated to what it was testing.
 *
 * `window.history.pushState` is how you change the URL in jsdom, and it is what
 * `playerAnswerPersistence.test.jsx` — the one player suite that has always
 * passed — uses. That file covers the hard behaviour (answers and votes
 * surviving a tab switch); this one covers the door: a player with a link, and
 * a player without one.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

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

import PlayerPage from '../PlayerPage';

describe('joining a session', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.pushState({}, '', '/play');
    global.fetch.mockClear();
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, playerName: 'Ada', state: 'CREATED' }),
      text: async () => '{}',
    });
  });

  // rejects: the manual join form disappearing. Not everyone arrives by QR —
  // a code read aloud in a room is the fallback when a camera will not focus.
  test('a player with no link gets a form to type into', () => {
    render(<PlayerPage />);
    expect(screen.getByPlaceholderText(/Game ID/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Your Name/i)).toBeInTheDocument();
  });

  // rejects: the QR path breaking. `?gameId=` is what every printed link and
  // projected code carries, so the field must arrive filled.
  test('a player arriving by link has the game already filled in', () => {
    window.history.pushState({}, '', '/play?gameId=4821');
    render(<PlayerPage />);
    expect(screen.getByPlaceholderText(/Game ID/i)).toHaveValue('4821');
  });

  // rejects: a join that posts nothing, or posts to the wrong place. This is
  // the only request a player makes before they can take part at all.
  test('joining posts the name to the game', async () => {
    render(<PlayerPage />);
    fireEvent.change(screen.getByPlaceholderText(/Game ID/i), { target: { value: '4821' } });
    fireEvent.change(screen.getByPlaceholderText(/Your Name/i), { target: { value: 'Ada' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Join Game/i }));
    });

    await waitFor(() => {
      const joins = global.fetch.mock.calls
        .filter(([u, o]) => String(u).includes('/players') && o?.method === 'POST');
      expect(joins.length).toBeGreaterThan(0);
      expect(String(joins[0][1].body)).toContain('Ada');
    });
  });

  // rejects: a failed join taking the page down instead of leaving the player
  // somewhere they can try again — in a room, mid-session, on their own phone.
  test('a join that fails leaves the form usable', async () => {
    global.fetch.mockRejectedValue(new Error('network down'));
    render(<PlayerPage />);
    fireEvent.change(screen.getByPlaceholderText(/Game ID/i), { target: { value: '4821' } });
    fireEvent.change(screen.getByPlaceholderText(/Your Name/i), { target: { value: 'Ada' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Join Game/i }));
    });

    expect(screen.getByPlaceholderText(/Game ID/i)).toBeInTheDocument();
  });
});
