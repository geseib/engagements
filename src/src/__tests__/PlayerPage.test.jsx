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

/**
 * CHANGING THE CODE THE LINK ARRIVED WITH.
 *
 * A code from `?gameId=` was `readOnly`, and the help beside it said "Nothing
 * to type." True right up until the code is the wrong one — the host started a
 * different session, the link was yesterday's, someone forwarded the wrong
 * message. Scanning a fresh QR or following a fresh link both worked, because
 * both replace the URL. Reading four digits off the wall did not, and that is
 * the way a room actually fixes this. The field refused, and the only move left
 * was editing the address bar by hand on a phone.
 */
describe('a code that arrived in a link can be replaced', () => {
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

  const arriveByLink = () => {
    window.history.pushState({}, '', '/play?gameId=4821');
    render(<PlayerPage />);
  };

  /*
    The FIELD'S OWN description, resolved through `aria-describedby` rather than
    searched for by text. The page lede also says "Type the four digits on the
    main screen", so a bare text query matches two elements and a test that
    settles for the first is asserting about whichever one happens to come
    first in the document.
  */
  const codeHelp = () => {
    const field = screen.getByPlaceholderText(/Game ID/i);
    return document.getElementById(field.getAttribute('aria-describedby'));
  };

  test('the code is locked by default, so a scanned link still reads as settled', () => {
    arriveByLink();
    expect(screen.getByPlaceholderText(/Game ID/i)).toHaveAttribute('readonly');
    expect(codeHelp()).toHaveTextContent(/Nothing to type/i);
  });

  test('a typed code is not locked, and never was', () => {
    render(<PlayerPage />);
    expect(screen.getByPlaceholderText(/Game ID/i)).not.toHaveAttribute('readonly');
    expect(screen.queryByRole('button', { name: /Use a different code/i })).toBeNull();
  });

  test('a locked code offers a way out', () => {
    arriveByLink();
    expect(screen.getByRole('button', { name: /Use a different code/i })).toBeInTheDocument();
  });

  test('taking it unlocks the field for typing', () => {
    arriveByLink();
    fireEvent.click(screen.getByRole('button', { name: /Use a different code/i }));
    expect(screen.getByPlaceholderText(/Game ID/i)).not.toHaveAttribute('readonly');
  });

  /*
    SELECTED, NOT CLEARED. Wiping the field would be a reduction with no
    recovery — one stray tap and the code that DID arrive is gone. The first
    keystroke replaces a selection anyway, so this costs the player nothing and
    survives a mis-tap.
  */
  test('the code that arrived is still there, not wiped', () => {
    arriveByLink();
    fireEvent.click(screen.getByRole('button', { name: /Use a different code/i }));
    expect(screen.getByPlaceholderText(/Game ID/i)).toHaveValue('4821');
  });

  test('the help line stops saying there is nothing to type', () => {
    arriveByLink();
    fireEvent.click(screen.getByRole('button', { name: /Use a different code/i }));
    expect(codeHelp()).not.toHaveTextContent(/Nothing to type/i);
    expect(codeHelp()).toHaveTextContent(/Four digits/i);
  });

  test('the control retires once it has done its job', () => {
    // A control whose only purpose is already served reads as a second,
    // subtly different action if it stays on screen.
    arriveByLink();
    fireEvent.click(screen.getByRole('button', { name: /Use a different code/i }));
    expect(screen.queryByRole('button', { name: /Use a different code/i })).toBeNull();
  });

  test('the new code is what gets joined, and the URL follows it', async () => {
    arriveByLink();
    fireEvent.click(screen.getByRole('button', { name: /Use a different code/i }));
    fireEvent.change(screen.getByPlaceholderText(/Game ID/i), { target: { value: '9137' } });
    fireEvent.change(screen.getByPlaceholderText(/Your Name/i), { target: { value: 'Ada' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Join Game/i }));
    });

    await waitFor(() => {
      const joins = global.fetch.mock.calls
        .filter(([u, o]) => String(u).includes('/players') && o?.method === 'POST');
      expect(joins.length).toBeGreaterThan(0);
      expect(String(joins[0][0])).toContain('9137');
      expect(String(joins[0][0])).not.toContain('4821');
    });

    /*
      THE HALF THAT MAKES THIS A FIX RATHER THAN A WORKAROUND. `handleJoinGame`
      already rewrites `?gameId=` on a successful manual join, which is why
      unlocking in place is enough and no navigation was needed: reload the page
      after switching and you land on the session you switched TO, not the stale
      one the original link named.
    */
    await waitFor(() => {
      expect(window.location.search).toContain('gameId=9137');
    });
  });
});
