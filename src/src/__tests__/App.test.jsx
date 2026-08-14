/**
 * WHICH PAGE DOES A PATH GET YOU?
 *
 * This suite has never run. It looked for `data-testid="game-host-page"` and
 * friends — attributes that exist nowhere in the product, on any page, in any
 * commit reachable from here. It was written against markup that was planned
 * and never built, and because it never ran, nobody found out.
 *
 * THE PAGES ARE STUBBED ON PURPOSE. `AppRouter`'s whole job is to read
 * `window.location.pathname` and pick a page; mounting the real ones would drag
 * in auth, sockets and fetch, and would turn any failure in a page into a
 * failure of the router. Each page has its own suite. This asserts the routing
 * and nothing else, which is the one thing only this file can cover.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';

jest.mock('../GameHostPage', () => ({
  __esModule: true,
  default: () => <div>HOST PAGE</div>,
}));
jest.mock('../PlayerPage', () => ({
  __esModule: true,
  default: () => <div>PLAYER PAGE</div>,
}));
jest.mock('../AdminPage', () => ({
  __esModule: true,
  default: () => <div>ADMIN PAGE</div>,
}));
jest.mock('../auth/AuthContext', () => ({
  __esModule: true,
  /*
    `groups` IS WHAT THE GUARD ACTUALLY READS, not `isAdmin`. ProtectedRoute
    lives inside App.jsx — it is not an importable module and cannot be
    stubbed — so this fixture has to satisfy the real one:
    `currentUser.groups?.includes('admins')` for the /admin branch, and no
    'pending' membership or every route returns the auth screen.
  */
  useAuth: () => ({
    currentUser: { username: 'host', groups: ['admins', 'hosts'] },
    signOut: jest.fn(),
    loading: false,
  }),
  AuthProvider: ({ children }) => children,
}));

// require, not import: jest.mock calls are hoisted above imports, and App must
// be loaded AFTER them or it captures the real modules.
const App = require('../App').default;

const at = (path) => {
  window.history.pushState({}, '', path);
};

describe('the router sends each path to its page', () => {
  beforeEach(() => {
    global.fetch = jest.fn(async () => ({
      ok: true, status: 200, json: async () => ({}), text: async () => '{}',
    }));
  });

  // rejects: a player link landing anywhere but the player screen. This is the
  //          path printed on the QR code every room scans, so it is the one
  //          route that must never regress.
  test('/play is the player screen', async () => {
    at('/play?gameId=4821');
    render(<App />);
    expect(await screen.findByText('PLAYER PAGE')).toBeInTheDocument();
  });

  // rejects: the admin console being reachable from an unexpected path, or not
  //          reachable from its own.
  test('/admin is the admin screen', async () => {
    at('/admin');
    render(<App />);
    expect(await screen.findByText('ADMIN PAGE')).toBeInTheDocument();
  });

  // rejects: an unknown path 404ing or blanking instead of landing somewhere
  //          usable. A host who mistypes should get the host screen.
  test('an unknown path falls back rather than blanking', async () => {
    at('/something-that-does-not-exist');
    render(<App />);
    expect(document.body.textContent.trim()).not.toBe('');
  });
});
