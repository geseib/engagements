/**
 * WHERE A BUILD ROOM OPENS.
 *
 * `/build` is the Build Room; `/builder` is the question builder, matched by
 * startsWith — so `/build` must be an exact match or one of them eats the
 * other. And a Build Room is deliberately NOT a config/gameTypes.js type
 * (PLAN §4), so every list that names or opens sessions has to recognise
 * `gameType === 'build'` itself: the label "Build Room", and Open / Report
 * going to /build rather than into GameHostPage.
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';

jest.mock('../GameHostPage', () => ({ __esModule: true, default: () => <div>HOST PAGE</div> }));
jest.mock('../PlayerPage', () => ({ __esModule: true, default: () => <div>PLAYER PAGE</div> }));
jest.mock('../AdminPage', () => ({ __esModule: true, default: () => <div>ADMIN PAGE</div> }));
jest.mock('../BuilderPage', () => ({ __esModule: true, default: () => <div>QUESTION BUILDER</div> }));
jest.mock('../buildroom/BuildRoomPage', () => ({ __esModule: true, default: () => <div>BUILD ROOM</div> }));
jest.mock('../auth/authFetch', () => ({
  authFetch: jest.fn(), getActiveOrgId: () => '', setActiveOrgId: () => '', ORG_HEADER: 'X-Engage-Org', PLATFORM_MODE_HEADER: '~platform',
}));
let mockUser = { username: 'host', groups: ['hosts'] };
jest.mock('../auth/AuthContext', () => ({
  __esModule: true,
  useAuth: () => ({ currentUser: mockUser, signOut: jest.fn(), loading: false }),
  AuthProvider: ({ children }) => children,
}));

const App = require('../App').default;
const { authFetch } = require('../auth/authFetch');
const SessionsPanel = require('../components/SessionsPanel').default;
const SessionHistoryPanel = require('../components/SessionHistoryPanel').default;
const { rowActions } = require('../components/SessionHistoryPanel');
const { buildRoomPath, buildReportPath, isBuildSession } = require('../buildroom/buildHostApi');

const at = (p) => window.history.pushState({}, '', p);

describe('App: /build and /builder', () => {
  beforeEach(() => { mockUser = { username: 'host', groups: ['hosts'] }; });

  test.each([['/build'], ['/build?gameId=4821'], ['/build?gameId=4821&view=report'], ['/build/']])('%s is the Build Room', (p) => {
    at(p);
    render(<App />);
    expect(screen.getByText('BUILD ROOM')).toBeInTheDocument();
  });

  test('/builder is still the question builder', () => {
    at('/builder');
    render(<App />);
    expect(screen.getByText('QUESTION BUILDER')).toBeInTheDocument();
    expect(screen.queryByText('BUILD ROOM')).toBeNull();
  });

  test('/buildings is not the Build Room', () => {
    at('/buildings');
    render(<App />);
    expect(screen.queryByText('BUILD ROOM')).toBeNull();
  });

  test('the Build Room sits behind sign-in and host approval', () => {
    mockUser = { username: 'p', groups: ['pending'] };
    at('/build');
    render(<App />);
    expect(screen.queryByText('BUILD ROOM')).toBeNull();
  });
});

const BUILD = {
  gameId: '4821', title: 'Food bank sign-up', gameType: 'build', started: true,
  createdAt: '2026-10-02T19:00:00.000Z', lastPlayedAt: '2026-10-02T19:40:00.000Z', visibility: 'public',
};
const POLL = { ...BUILD, gameId: '1234', title: 'Team pulse', gameType: 'poll' };

describe('the paths', () => {
  test('room and report', () => {
    expect(buildRoomPath('4821')).toBe('/build?gameId=4821');
    expect(buildReportPath('4821')).toBe('/build?gameId=4821&view=report');
    expect(isBuildSession(BUILD)).toBe(true);
    expect(isBuildSession(POLL)).toBe(false);
  });
});

describe('SessionsPanel (the console list)', () => {
  test('a build session is labelled Build Room and opens on /build', async () => {
    authFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ games: [BUILD, POLL] }) });
    render(<SessionsPanel />);
    const row = (await screen.findByText('Food bank sign-up')).closest('tr');
    expect(within(row).getByText('Build Room')).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: 'Open' })).toHaveAttribute('href', '/build?gameId=4821');
    expect(within(row).getByRole('link', { name: 'Report' })).toHaveAttribute('href', '/build?gameId=4821&view=report');

    const other = screen.getByText('Team pulse').closest('tr');
    expect(within(other).queryByText('Build Room')).toBeNull();
    expect(within(other).queryByRole('link', { name: 'Open' })).toBeNull();
  });
});

describe('SessionHistoryPanel (the host list)', () => {
  test('a build session is labelled, and always offers Continue and Report', () => {
    expect(rowActions({ ...BUILD, started: false })).toMatchObject({ continue: true, report: true, start: false, edit: false });
  });

  test('Continue and Report go to /build instead of into the host stage', () => {
    const navigate = jest.fn();
    const onOpen = jest.fn();
    const onReport = jest.fn();
    render(
      <SessionHistoryPanel sessions={[BUILD]} questionSets={[]} onOpen={onOpen} onReport={onReport} navigate={navigate} onClose={() => {}} />,
    );
    const row = screen.getByText('Food bank sign-up').closest('tr');
    expect(within(row).getByText(/Build Room/)).toBeInTheDocument();
    fireEvent.click(within(row).getByRole('button', { name: /Continue/ }));
    expect(navigate).toHaveBeenCalledWith('/build?gameId=4821');
    fireEvent.click(within(row).getByRole('button', { name: /Report/ }));
    expect(navigate).toHaveBeenCalledWith('/build?gameId=4821&view=report');
    expect(onOpen).not.toHaveBeenCalled();
    expect(onReport).not.toHaveBeenCalled();
  });
});

describe('GameHostPage ?gameId= sends a build session to /build', () => {
  // GameHostPage cannot be mounted in jsdom (it dies on the auth provider),
  // so the wiring is read from the source.
  const src = fs.readFileSync(path.join(__dirname, '..', 'GameHostPage.jsx'), 'utf8');
  test('checkGameStatus carries gameType', () => {
    expect(src).toMatch(/gameType:\s*gameData\.gameType/);
  });
  test('the URL loader redirects before anything else', () => {
    const loader = src.slice(src.indexOf('checkGameStatus(gameIdFromUrl).then'));
    const head = loader.slice(0, 400);
    expect(head).toMatch(/gameStatus\.gameType === BUILD_GAME_TYPE/);
    expect(head).toMatch(/window\.location\.replace\(buildRoomPath\(gameIdFromUrl\)\)/);
  });
});

describe('the welcome screen has a door to /build', () => {
  test('a Build Room link', () => {
    const WelcomeScreen = require('../components/WelcomeScreen').default;
    authFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    render(<WelcomeScreen currentUser={{ groups: ['hosts'], attributes: {} }} />);
    const link = screen.getByRole('link', { name: /Build Room/ });
    expect(link).toHaveAttribute('href', '/build');
  });
});

afterAll(() => { at('/'); });
