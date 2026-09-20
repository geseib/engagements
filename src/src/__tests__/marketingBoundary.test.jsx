import React from 'react';
import { render, screen } from '@testing-library/react';

/**
 * The chunk arrives, but the page it contains cannot render -- this is the
 * shape a real chunk-load failure takes by the time React sees it. `lazy()`
 * turns any failure to produce a usable module (a rejected `import()`, or --
 * as modeled here -- a component that throws) into a thrown error during
 * render, and that is exactly what `MarketingBoundary` exists to catch. A
 * factory that makes `jest.mock` itself throw would fail at require time,
 * before `lazy()` or `Suspense` are even involved, and would not exercise the
 * boundary at all -- so the mock below is a normal module whose default
 * export throws when RENDERED, which is the part `MarketingBoundary` sits
 * above.
 */
let mockAuthValue = { currentUser: null, loading: false, signOut: jest.fn() };
jest.mock('../auth/AuthContext', () => {
  const R = require('react');
  const Ctx = R.createContext(null);
  return { __esModule: true, AuthProvider: ({ children }) => R.createElement(Ctx.Provider, { value: mockAuthValue }, children), useAuth: () => R.useContext(Ctx) };
});
jest.mock('../GameHostPage', () => () => <div data-testid="game-host-page" />);
jest.mock('../PlayerPage', () => () => <div data-testid="player-page" />);
jest.mock('../AdminPage', () => () => <div data-testid="admin-page" />);
jest.mock('../BuilderPage', () => () => <div data-testid="builder-page" />);
jest.mock('../HostRemote', () => () => <div data-testid="host-remote" />);
jest.mock('../WordCloudTest', () => () => <div data-testid="wordcloud" />);
jest.mock('../auth/AuthPage', () => () => <div data-testid="auth-page" />);
jest.mock('../components/RootPage', () => () => <div data-testid="root-page" />);
jest.mock('../marketing/HomePage', () => () => {
  throw new Error('chunk failed');
});

import App from '../App';

const goTo = (p) => window.history.pushState({}, '', p);
beforeEach(() => { mockAuthValue = { currentUser: null, loading: false, signOut: jest.fn() }; });
afterEach(() => goTo('/'));

// One spy per test, restored even when an assertion in the test throws --
// `mockRestore()` as the last line of a test body never runs if an earlier
// `expect` fails first, and a leaked silenced `console.error` would corrupt
// every later test's output in this file.
let spy;
beforeEach(() => { spy = jest.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { spy.mockRestore(); });

// React itself also logs to console.error for a caught render error (its own
// "above error occurred in the <Boom> component" notice), so asserting on the
// spy as a whole would pass even if MarketingBoundary logged twice, or would
// falsely fail on React's own unrelated line. Filter to exactly the boundary's
// own message before counting.
const boundaryLogs = () => spy.mock.calls.filter(([first]) => first === 'Marketing page failed to load');

test('a marketing chunk that fails to load falls back to the join page, not a blank screen', async () => {
  // rejects: nothing above Suspense -- the lazy rejection/render throw would
  // otherwise reach no boundary and jsdom (and a real browser) show a blank /
  render(<App />);
  expect(await screen.findByTestId('root-page')).toBeInTheDocument();
  expect(screen.queryByTestId('auth-page')).not.toBeInTheDocument();
  // Exactly once: componentDidCatch fires once per catch, and React 18
  // StrictMode's dev double-invocation does not apply to it, so a second
  // occurrence here would be a real bug, not test noise to tolerate.
  const ours = boundaryLogs();
  expect(ours).toHaveLength(1);
  expect(ours[0][1]).toBeInstanceOf(Error);
});

test('a signed-in host at / never touches the boundary, even with the same failing mock', () => {
  // the failing HomePage mock is never rendered for a signed-in host, so the
  // boundary has nothing to catch and the host page renders as normal
  mockAuthValue = { currentUser: { groups: ['hosts'] }, loading: false, signOut: jest.fn() };
  render(<App />);
  expect(screen.getByTestId('game-host-page')).toBeInTheDocument();
  // "never touches the boundary" means its log line specifically never fires,
  // not merely that console.error as a whole was quiet.
  expect(boundaryLogs()).toHaveLength(0);
});
