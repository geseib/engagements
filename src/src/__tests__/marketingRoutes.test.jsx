// src/src/__tests__/marketingRoutes.test.jsx
import React from 'react';
import { render, screen } from '@testing-library/react';

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
jest.mock('../marketing/HomePage', () => () => <div data-testid="home-page" />);
jest.mock('../marketing/HowItWorksPage', () => () => <div data-testid="how-page" />);
jest.mock('../marketing/UseCasesPage', () => () => <div data-testid="cases-page" />);

import App from '../App';

const goTo = (p) => window.history.pushState({}, '', p);
beforeEach(() => { mockAuthValue = { currentUser: null, loading: false, signOut: jest.fn() }; });
afterEach(() => goTo('/'));

// Tasks 9–11 append their rows here.
const PUBLIC = [
  ['/join', 'root-page'],
  ['/how-it-works', 'how-page'],
  ['/use-cases', 'cases-page'],
];

test.each(PUBLIC)('%s is public: a signed-out visitor gets the page, not the sign-in form', async (path, testId) => {
  // rejects: forgetting the branch, which drops the path through to the
  // protected catch-all and shows a prospect a login wall
  goTo(path);
  render(<App />);
  expect(await screen.findByTestId(testId)).toBeInTheDocument();
  expect(screen.queryByTestId('auth-page')).not.toBeInTheDocument();
});

test('/join is the join page even for a signed-in host', async () => {
  // a host helping someone join should see the same screen they do
  mockAuthValue = { currentUser: { groups: ['hosts'] }, loading: false, signOut: jest.fn() };
  goTo('/join');
  render(<App />);
  expect(await screen.findByTestId('root-page')).toBeInTheDocument();
});

test('/joining is not /join', () => {
  // rejects: startsWith('/join'), which would swallow any future path
  goTo('/joining');
  render(<App />);
  expect(screen.queryByTestId('root-page')).not.toBeInTheDocument();
  expect(screen.getByTestId('auth-page')).toBeInTheDocument();
});
