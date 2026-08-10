import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

/**
 * The call site, not the module.
 *
 * `<RootPage>` can be perfect and `/` can still render a sign-in wall, which is
 * exactly the defect this stream exists to fix. Everything here renders the real
 * `App` and asserts what the router actually chose.
 *
 * Note the navigation technique: `window.location.pathname = '/x'` is a SILENT
 * no-op under jsdom 26 (`delete window.location` returns false, so setupTests's
 * mock never replaced the real Location, and the setter is an unimplemented
 * navigation). A test written that way asserts nothing at all. `pushState` is a
 * real same-document navigation and does move `location.pathname`.
 */

// A real React context, so `useAuth` is a real hook and calling it outside
// render throws the way it does in a browser. A plain `jest.fn()` here would
// make the App.jsx:116 hook bug untestable -- the mock would happily return a
// value from inside an onClick handler and the broken button would look fine.
let mockAuthValue = { currentUser: null, loading: false, signOut: jest.fn() };
jest.mock('../auth/AuthContext', () => {
  const ReactModule = require('react');
  const Ctx = ReactModule.createContext(null);
  return {
    __esModule: true,
    AuthProvider: ({ children }) =>
      ReactModule.createElement(Ctx.Provider, { value: mockAuthValue }, children),
    useAuth: () => ReactModule.useContext(Ctx),
  };
});

jest.mock('../GameHostPage', () => () => <div data-testid="game-host-page" />);
jest.mock('../PlayerPage', () => () => <div data-testid="player-page" />);
jest.mock('../AdminPage', () => () => <div data-testid="admin-page" />);
jest.mock('../BuilderPage', () => () => <div data-testid="builder-page" />);
jest.mock('../HostRemote', () => () => <div data-testid="host-remote" />);
jest.mock('../WordCloudTest', () => () => <div data-testid="wordcloud" />);
jest.mock('../auth/AuthPage', () => () => <div data-testid="auth-page" />);
jest.mock('../components/RootPage', () => () => <div data-testid="root-page" />);

// eslint-disable-next-line import/first
import App from '../App';

const goTo = (path) => window.history.pushState({}, '', path);
const signedInHost = {
  groups: ['hosts'],
  attributes: { email: 'host@example.com' },
};

beforeEach(() => {
  goTo('/');
  mockAuthValue = { currentUser: null, loading: false, signOut: jest.fn() };
});
afterEach(() => goTo('/'));

describe('the root gate at /', () => {
  test('a signed-out arrival gets the join page, not a sign-in wall', () => {
    // rejects: today's code, where `/` is the catch-all fallthrough and
    // ProtectedRoute renders AuthPage in place -- a participant who types the
    // domain off a slide is asked to sign in to an account they will never have
    render(<App />);
    expect(screen.getByTestId('root-page')).toBeInTheDocument();
    expect(screen.queryByTestId('auth-page')).not.toBeInTheDocument();
  });

  test('a signed-in host still goes straight to their host page', () => {
    // rejects: putting the landing page in front of the only repeat users, who
    // would then click through it on every single visit
    mockAuthValue = { currentUser: signedInHost, loading: false, signOut: jest.fn() };
    render(<App />);
    expect(screen.getByTestId('game-host-page')).toBeInTheDocument();
    expect(screen.queryByTestId('root-page')).not.toBeInTheDocument();
  });

  test('while auth is still resolving, neither page is committed to', () => {
    // rejects: gating on `!currentUser` alone, which renders the join page for a
    // beat on every reload a signed-in host does before the token resolves
    mockAuthValue = { currentUser: null, loading: true, signOut: jest.fn() };
    render(<App />);
    expect(screen.queryByTestId('root-page')).not.toBeInTheDocument();
    expect(screen.queryByTestId('game-host-page')).not.toBeInTheDocument();
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  test('an unrecognised path is untouched by the gate', () => {
    // rejects: matching with startsWith('/') or adding RootPage as the default
    // case -- either swallows every route in the app
    goTo('/some/unknown/path');
    render(<App />);
    expect(screen.queryByTestId('root-page')).not.toBeInTheDocument();
    expect(screen.getByTestId('auth-page')).toBeInTheDocument();
  });

  test('the gate does not intercept /play', () => {
    // rejects: placing the root gate above the player route with a loose match,
    // which would strand every QR scan on the landing page
    goTo('/play');
    render(<App />);
    expect(screen.getByTestId('player-page')).toBeInTheDocument();
  });
});

describe('the Access Pending screen', () => {
  const pendingUser = { groups: [], attributes: { email: 'new@example.com' } };

  test('Sign Out works instead of throwing', () => {
    // rejects: App.jsx:116-120, which calls useAuth() INSIDE the onClick
    // handler. A hook outside render has no dispatcher, so pressing that button
    // throws and the only escape from the pending screen is dead.
    const signOut = jest.fn();
    mockAuthValue = { currentUser: pendingUser, loading: false, signOut };
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));
    expect(signOut).toHaveBeenCalled();
  });
});
