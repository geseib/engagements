import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

/**
 * THE REPORT CONTROL HAS ONE HOME, AND IT IS ON EVERY WORKING SCREEN.
 *
 * It began as a 56px circle fixed bottom-right above every dialog ("floating in
 * the way"), and was then made inline — which fixed the overlap and lost the
 * control: inline it lived in the admin header and in ONE tab of the host's
 * setup panel, and nowhere on the stage, the lobby, the player page, the phone
 * remote or the builder. The owner, 2026-09-20: it "is not showing up in most
 * screens".
 *
 * So it is mounted ONCE, by the router, in a fixed quiet corner — bottom-LEFT,
 * because Submit, Next and the docks live bottom-right — and it sits UNDER
 * every dialog rather than over them, which was the actual complaint about the
 * original.
 *
 * jsdom has no layout, so position is asserted as stylesheet text and mounting
 * as DOM facts. Green means the contract has not been reverted; only a browser
 * shows whether the corner is clear on a given phone.
 */

let mockAuthValue = { currentUser: { groups: ['hosts'] }, loading: false, signOut: jest.fn() };
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
jest.mock('../marketing/ReportsPage', () => () => <div data-testid="reports-page" />);
jest.mock('../marketing/HelpPage', () => () => <div data-testid="help-page" />);
jest.mock('../components/IssueReportForm', () => (props) => (
  <div data-testid="issue-form" data-context={props.initialContext} data-game={props.gameId || ''} data-type={props.initialType} />
));

import App, { issueSurfaceFor } from '../App';
import { setIssueGameId } from '../utils/issueContext';

const fs = require('fs');
const path = require('path');
const CSS = fs.readFileSync(path.join(__dirname, '..', 'components', 'IssueFab.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

const goTo = (p) => window.history.pushState({}, '', p);
const corner = () => document.querySelector('.issue-fab-container--corner');
const main = () => screen.queryByRole('button', { name: /report a problem/i });

beforeEach(() => {
  mockAuthValue = { currentUser: { groups: ['hosts', 'admins'] }, loading: false, signOut: jest.fn() };
  setIssueGameId(null);
});
afterEach(() => goTo('/'));

describe('which screens carry it', () => {
  test.each([
    ['/', 'host'],
    ['/play?gameId=4821', 'player'],
    ['/admin', 'admin'],
    ['/admin/sets', 'admin'],
    ['/builder', 'host'],
    ['/remote', 'host'],
  ])('%s carries the corner control, reporting as %s', (url, context) => {
    goTo(url);
    render(<App />);
    expect(corner()).toBeInTheDocument();
    expect(document.querySelectorAll('.issue-fab-container')).toHaveLength(1);
    fireEvent.click(main());
    fireEvent.click(screen.getByRole('button', { name: /report bug/i }));
    expect(screen.getByTestId('issue-form')).toHaveAttribute('data-context', context);
  });

  test.each(['/how-it-works', '/use-cases', '/reports', '/help', '/help/host/host-quick-start', '/join', '/auth', '/privacy', '/terms'])(
    '%s does not — a brochure, a sign-in form and a legal page are not the product',
    async (url) => {
      goTo(url);
      render(<App />);
      await screen.findByTestId(/page$/).catch(() => {});
      expect(corner()).toBeNull();
    },
  );

  test('a signed-out visitor to / gets the marketing home, without it', async () => {
    mockAuthValue = { currentUser: null, loading: false, signOut: jest.fn() };
    render(<App />);
    expect(await screen.findByTestId('home-page')).toBeInTheDocument();
    expect(corner()).toBeNull();
  });

  test('the mapping is one pure function, so a new route is one line', () => {
    expect(issueSurfaceFor('/play', true)).toEqual({ context: 'player', lifted: true });
    expect(issueSurfaceFor('/remote/abc', true)).toEqual({ context: 'host', lifted: true });
    expect(issueSurfaceFor('/admin', true)).toEqual({ context: 'admin', lifted: false });
    expect(issueSurfaceFor('/', true)).toEqual({ context: 'host', lifted: false });
    expect(issueSurfaceFor('/', false)).toBeNull();
    expect(issueSurfaceFor('/helpers', true)).toEqual({ context: 'host', lifted: false }); // not /help
  });
});

describe('what it reports', () => {
  test('a player report carries the session code from the address', () => {
    goTo('/play?gameId=4821');
    render(<App />);
    fireEvent.click(main());
    fireEvent.click(screen.getByRole('button', { name: /report bug/i }));
    expect(screen.getByTestId('issue-form')).toHaveAttribute('data-game', '4821');
  });

  test('a host report carries the session the stage published', () => {
    // The stage holds its game id in state, and the control is no longer its
    // child — so the stage publishes it and the control reads it when opened.
    goTo('/');
    render(<App />);
    setIssueGameId('7310');
    fireEvent.click(main());
    fireEvent.click(screen.getByRole('button', { name: /request feature/i }));
    expect(screen.getByTestId('issue-form')).toHaveAttribute('data-game', '7310');
    expect(screen.getByTestId('issue-form')).toHaveAttribute('data-type', 'feature');
  });
});

describe('the corner, as the stylesheet declares it', () => {
  const block = (selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = CSS.match(new RegExp(`(^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm'));
    if (!m) throw new Error(`No rule for "${selector}" — renamed?`);
    return m[2];
  };

  test('it is fixed to the bottom LEFT, clear of the phone safe area', () => {
    const rule = block('.issue-fab-container--corner');
    expect(rule).toMatch(/position:\s*fixed/);
    expect(rule).toMatch(/left:\s*max\(12px,\s*env\(safe-area-inset-left\)\)/);
    expect(rule).toMatch(/bottom:[^;]*env\(safe-area-inset-bottom\)/);
    expect(rule).not.toMatch(/right:/);
  });

  test('it sits UNDER every dialog — the original sat over them at 20000', () => {
    const z = Number(block('.issue-fab-container--corner').match(/z-index:\s*(\d+)/)[1]);
    // 60 is the lowest dialog/scrim layer anywhere in the app's stylesheets.
    expect(z).toBeLessThan(60);
    expect(z).toBeGreaterThan(4); // above the remote's dock (z-index 4) it sits beside
  });

  test('on the player page and the remote it clears the dock instead of covering it', () => {
    expect(block('.issue-fab-container--corner.issue-fab-container--lifted')).toMatch(/bottom:[^;]*88px/);
  });

  test('it is quiet until it is wanted, and never invisible to a keyboard', () => {
    expect(block('.issue-fab-container--corner .issue-fab-main')).toMatch(/opacity:\s*0?\.[0-9]+/);
    expect(CSS).toMatch(/\.issue-fab-container--corner \.issue-fab-main:focus-visible[^{]*\{[^}]*opacity:\s*1/);
    expect(CSS).toMatch(/\.issue-fab-container--corner\.menu-open \.issue-fab-main[^{]*\{[^}]*opacity:\s*1/);
  });

  test('a finger gets a 44px target', () => {
    expect(CSS).toMatch(/@media \(pointer:\s*coarse\)[\s\S]*\.issue-fab-container--corner \.issue-fab-main\s*\{[^}]*width:\s*44px[^}]*height:\s*44px/);
  });

  test('its menu opens upward and to the right, into the screen', () => {
    const rule = block('.issue-fab-container--corner .issue-fab-menu');
    expect(rule).toMatch(/bottom:\s*calc\(100% \+ 8px\)/);
    expect(rule).toMatch(/left:\s*0/);
  });
});
