/**
 * SETUP IS THE LOBBY (docs/design/session-start D1, F1, F5, F6, F7, F8;
 * experience plan Phase 2 step 2b). Behaviour on the real host page and on
 * the panel itself:
 *
 *   - a first-time Start lands on Setup step 1 (no stored choice, any tier)
 *   - choosing moves Your part now with the step (QA, 1 Nov 2026)
 *   - two screens: the window step, then the room joins
 *   - the join code (QR) is drawn only at step 3
 *   - one screen: the check, the Remote's address as text, no second QR
 *   - no rail before round 1 (F7)
 *   - Setup in the strip reopens the same panel mid-session
 */
import React from 'react';
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react';
import SessionSetup from '../components/console/panels/SessionSetup';
import SessionHistoryPanel from '../components/SessionHistoryPanel';
import {
  setupStepFor, setupPartFor, recentArrivals, windowChecklist, SETUP_WORDS as W,
} from '../config/sessionSetup';
import { ROOM_WORDS } from '../config/roomScreen';

jest.mock('../auth/AuthContext', () => ({
  __esModule: true,
  useAuth: () => ({
    currentUser: { username: 'host', attributes: { email: 'host@example.com' } },
    signOut: jest.fn(),
    isAdmin: false,
  }),
  AuthProvider: ({ children }) => children,
}));

jest.mock('../auth/authFetch', () => ({
  __esModule: true,
  authFetch: (...args) => global.fetch(...args),
  getActiveOrgId: () => '',
  setActiveOrgId: () => {},
  ORG_HEADER: 'X-Engage-Org',
  ACTIVE_ORG_STORAGE_KEY: 'engage.activeOrg',
}));

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

import GameHostPage from '../GameHostPage';

const GAME = '7924';
const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
const FULL = () => ({ open: true, fullscreen: true, visible: true, statusAt: new Date().toISOString() });

let hostState;
beforeAll(() => {
  global.ResizeObserver = global.ResizeObserver || class { observe() {} disconnect() {} unobserve() {} };
});

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  window.ENV = 'development'; // F6: the tier no longer decides anything
  window.alert = jest.fn();
  window.history.pushState({}, '', `/host?gameId=${GAME}`);
  hostState = {
    state: 'STARTED',
    gameMetadata: { gameType: 'call-and-answer', title: 'Relay expansion: kick-off' },
    presenting: 0,
    presentDetail: null,
  };
  global.fetch = jest.fn(async (url) => {
    const u = String(url);
    if (u.endsWith(`games/${GAME}`)) return ok({ started: true, gameType: 'call-and-answer' });
    if (u.includes(`games/${GAME}/host-state`)) return ok(hostState);
    return ok({});
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  localStorage.clear();
  delete window.ENV;
});

const mount = async () => {
  const utils = render(<GameHostPage />);
  await waitFor(() => expect(utils.container.querySelector('.hsetup')).toBeTruthy(), { timeout: 5000 });
  return utils;
};
const partText = (container) => container.querySelector('.hc-now .hc-part').textContent;
const qr = (container) => container.querySelector('[data-testid="setup-qr"], .joinblock .qr, svg[aria-label="QR code to join"]');

describe('on the host page', () => {
  test('first-time Start: Setup at step 1 asks where the room watches, even on dev (no tier default)', async () => {
    const { container } = await mount();
    expect(container.querySelector('.hsetup').getAttribute('data-at')).toBe('where');
    expect(screen.getByRole('button', { name: ROOM_WORDS.useTwo })).toBeInTheDocument();
    expect(partText(container)).toMatch(/^Choose where the room watches\./);
    // The held slot names round 1 rather than offering it (D1).
    expect(container.querySelector('.hc-now [data-empty-slot]').textContent).toMatch(/after setup/);
    expect(container.querySelector('.hc-now .host-action-bar__primary')).toBeNull();
    // No join code anywhere before step 3, and no rail (F7).
    expect(qr(container)).toBeNull();
    expect(container.querySelector('.hc-rail')).toBeNull();
    expect(container.querySelector('.hc').classList.contains('hc--setup')).toBe(true);
    // The shared top bar from 2a: Main menu present during Setup.
    expect(container.querySelector('.hc-top [data-slot="main-menu"]')).toBeTruthy();
  });

  test('two screens: choosing moves Your part now to the window step, and its one button opens the window', async () => {
    const opened = jest.spyOn(window, 'open').mockImplementation(() => ({ opener: {} }));
    const { container } = await mount();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: ROOM_WORDS.useTwo })); });
    expect(container.querySelector('.hsetup').getAttribute('data-at')).toBe('screen');
    expect(partText(container)).toMatch(/^Open the room's window/);
    expect(partText(container)).not.toMatch(/Choose where/);
    expect(container.querySelector('[data-check="open"]').getAttribute('data-state')).toBe('todo');
    expect(qr(container)).toBeNull();
    const primary = container.querySelector('.hc-now .host-action-bar__primary');
    expect(primary.textContent).toMatch(/Open the room's window/);
    await act(async () => { fireEvent.click(primary); });
    expect(opened).toHaveBeenCalledWith(expect.stringContaining(`/present?gameId=${GAME}`), 'engage-room');
    expect(localStorage.getItem('engage.surfaces')).toBe('two');
  });

  test('two screens, window up: step 3, the join code drawn now, with the count and Start round 1', async () => {
    localStorage.setItem('engage.surfaces', 'two');
    hostState = { ...hostState, presenting: 1, presentDetail: FULL() };
    const { container } = await mount();
    await waitFor(() => expect(container.querySelector('.hsetup').getAttribute('data-at')).toBe('joins'));
    expect(container.querySelector('[data-testid="setup-qr"]')).toBeTruthy();
    expect(container.querySelector('.hsetup-numeral').textContent).toBe('0');
    expect(container.querySelector('.hc-now .host-action-bar__primary').textContent).toMatch(/Start round 1/);
    expect(partText(container)).toMatch(/Start round 1 when the room is in/);
    expect(container.querySelector('.hc-rail')).toBeNull();
  });

  test('one screen: the check with the Remote\'s address as text and no second QR, then the stage lobby', async () => {
    localStorage.setItem('engage.surfaces', 'classic');
    const { container } = await mount();
    expect(container.querySelector('.hsetup').getAttribute('data-at')).toBe('screen');
    expect(partText(container)).toMatch(/^Check the room can read this screen/);
    expect(screen.getByText(W.roomSeesThis)).toBeInTheDocument();
    const remote = container.querySelector('[data-testid="setup-remote"]');
    expect(remote.textContent).toMatch(/\/remote/);
    expect(remote.querySelector('svg')).toBeNull();
    expect(qr(container)).toBeNull();
    expect(container.querySelectorAll('svg[aria-label*="QR"], [data-testid="setup-qr"]')).toHaveLength(0);
    // Show the join code: step 3 is the stage lobby, where the QR goes up.
    await act(async () => { fireEvent.click(container.querySelector('.hc-now .host-action-bar__primary')); });
    await waitFor(() => expect(container.querySelector('.hsetup')).toBeNull());
    expect(container.querySelector('.joinblock .qr')).toBeTruthy();
    expect(container.querySelector('.hc')).toBeNull();
  });

  test('a host who chose can Change it, and Keep this choice folds step 1 again', async () => {
    localStorage.setItem('engage.surfaces', 'two');
    const { container } = await mount();
    const head = container.querySelector('[data-step="where"] .hsetup-change');
    expect(head.textContent).toBe(W.change);
    await act(async () => { fireEvent.click(head); });
    expect(container.querySelector('.hsetup').getAttribute('data-at')).toBe('where');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: ROOM_WORDS.keepChoice })); });
    expect(container.querySelector('.hsetup').getAttribute('data-at')).toBe('screen');
  });

  test('Setup in the strip reopens the same panel mid-session, with step 3 folded', async () => {
    localStorage.setItem('engage.surfaces', 'two');
    hostState = { ...hostState, state: 'ASK#001', currentQuestion: 1, presenting: 1, presentDetail: FULL() };
    const { container } = render(<GameHostPage />);
    await waitFor(() => expect(container.querySelector('.hc-rail')).toBeTruthy(), { timeout: 5000 });
    expect(container.querySelector('.hsetup')).toBeNull();
    const setupStep = [...container.querySelectorAll('.hc-loop button')].find((b) => b.querySelector('.wfs-name') && b.querySelector('.wfs-name').textContent === 'Setup');
    expect(setupStep).toBeTruthy();
    await act(async () => { fireEvent.click(setupStep); });
    const panel = container.querySelector('.hsetup');
    expect(panel).toBeTruthy();
    expect(panel.classList.contains('is-mid')).toBe(true);
    expect(container.querySelector('[data-step="joins"]').getAttribute('data-state')).toBe('done');
    // Mid-session the rail stays: it is round 1 or later.
    expect(container.querySelector('.hc-rail')).toBeTruthy();
  });
});

describe('the panel and its rules', () => {
  const players = [
    { name: 'Ana', joinedAt: 1000 },
    { name: 'Priya', joinedAt: 100000 - 20000 },
    { name: 'Tom', joinedAt: 100000 - 5000 },
  ];

  test('the step: never chosen or Change asks; two screens waits for the window; one screen for the check', () => {
    expect(setupStepFor({ choice: null })).toBe('where');
    expect(setupStepFor({ choice: 'two', choosing: true })).toBe('where');
    expect(setupStepFor({ choice: 'two', detail: null })).toBe('screen');
    expect(setupStepFor({ choice: 'two', detail: FULL() })).toBe('joins');
    expect(setupStepFor({ choice: 'classic' })).toBe('screen');
    expect(setupStepFor({ choice: 'classic', checked: true })).toBe('joins');
  });

  test('Your part now per step names the step\'s one move', () => {
    expect(setupPartFor('where').part.action).toBe(W.part.where.action);
    expect(setupPartFor('screen', { choice: 'two' }).part.action).toBe(W.part.window.action);
    expect(setupPartFor('screen', { choice: 'classic' }).part.action).toBe(W.part.check.action);
    const windowed = { open: true, fullscreen: false, visible: true, statusAt: new Date().toISOString() };
    expect(setupPartFor('joins', { choice: 'two', detail: windowed }).part.action).toBe(W.part.fill.action);
    expect(setupPartFor('joins', { choice: 'two', detail: FULL(), startLabel: 'Start round 1' }).part.action).toBe('Start round 1');
  });

  test('who arrived in the last minute, oldest first', () => {
    expect(recentArrivals(players, 100000)).toEqual(['Priya', 'Tom']);
  });

  test('the window checklist says only what the app can verify', () => {
    expect(windowChecklist(null).map((i) => i.state)).toEqual(['todo', 'todo']);
    expect(windowChecklist(FULL()).map((i) => i.state)).toEqual(['done', 'done']);
  });

  test('step 3 names new arrivals in text and says what round 1 is; the QR only now', () => {
    const { container, rerender } = render(
      <SessionSetup step="screen" choice="two" players={players} now={100000} title="Relay" code={GAME} joinUrl="https://x/play?gameId=7924" firstUp="Round 1 · The Meiji Restoration" />,
    );
    expect(container.querySelector('[data-testid="setup-qr"]')).toBeNull();
    expect(container.querySelector('[data-step="screen"]').getAttribute('data-state')).toBe('now');
    // Step names carry their state for a screen reader (reviews L5).
    expect(container.querySelector('[data-step="where"] .hsetup-h').textContent).toMatch(/^Step 1, done/);
    rerender(
      <SessionSetup step="joins" choice="two" presentDetail={FULL()} players={players} now={100000} title="Relay" code={GAME} joinUrl="https://x/play?gameId=7924" firstUp="Round 1 · The Meiji Restoration" />,
    );
    expect(container.querySelector('[data-testid="setup-qr"]')).toBeTruthy();
    expect(container.querySelector('.hsetup-numeral').textContent).toBe('3');
    expect(container.querySelector('.hsetup-recent').textContent).toMatch(/2 in the last minute: Priya, Tom/);
    expect(screen.getByText('Round 1 · The Meiji Restoration')).toBeInTheDocument();
  });

  test('a blocked popup: Setup opens at the window step and says so (F5)', () => {
    render(<SessionSetup step="screen" choice="two" blocked presentHref="/present?gameId=7924" />);
    expect(screen.getByRole('status')).toHaveTextContent(W.blocked);
  });
});

describe('a returning host (D2, F5)', () => {
  const row = {
    gameId: GAME, title: 'Relay expansion: kick-off', gameType: 'call-and-answer',
    createdAt: '2026-11-01T09:00:00Z', started: false, playerCount: 0, roundsPlayed: 0,
  };
  const panel = (props) => render(
    <SessionHistoryPanel sessions={[row]} onStart={jest.fn()} {...props} />,
  );

  test('two screens stored: "Start · two screens" opens the room\'s window inside the click and hands it to Start', () => {
    const fake = { location: {}, close: jest.fn() };
    const opened = jest.spyOn(window, 'open').mockImplementation(() => fake);
    const onStart = jest.fn();
    const onRoomScreen = jest.fn();
    panel({ roomScreen: 'two', onStart, onRoomScreen });
    const start = screen.getByRole('button', { name: /Start · two screens/ });
    fireEvent.click(start);
    expect(opened).toHaveBeenCalledWith('about:blank', 'engage-room', expect.any(String));
    expect(onStart).toHaveBeenCalledWith(GAME, row.title, expect.objectContaining({ blocked: false }));
    expect(onStart.mock.calls[0][2].pending.window).toBe(fake);
    expect(screen.getByTestId('shist-mode')).toHaveTextContent('Two screens, like last time.');
    fireEvent.click(screen.getByRole('button', { name: 'One screen this time' }));
    expect(onRoomScreen).toHaveBeenCalledWith('classic');
  });

  test('a blocked popup still starts, and says it was blocked so Setup opens at step 2', () => {
    jest.spyOn(window, 'open').mockImplementation(() => null);
    const onStart = jest.fn();
    panel({ roomScreen: 'two', onStart });
    fireEvent.click(screen.getByRole('button', { name: /Start · two screens/ }));
    expect(onStart).toHaveBeenCalledWith(GAME, row.title, { pending: null, blocked: true });
  });

  test('no stored choice: plain Start, no window, and Setup asks (F6)', () => {
    const opened = jest.spyOn(window, 'open').mockImplementation(() => null);
    const onStart = jest.fn();
    panel({ roomScreen: null, onStart });
    fireEvent.click(screen.getByRole('button', { name: /^Start$/ }));
    expect(opened).not.toHaveBeenCalled();
    expect(onStart).toHaveBeenCalledWith(GAME, row.title);
    expect(screen.queryByTestId('shist-mode')).toBeNull();
  });

  test('one screen stored: "Start · one screen", no window', () => {
    const opened = jest.spyOn(window, 'open').mockImplementation(() => null);
    panel({ roomScreen: 'classic' });
    fireEvent.click(screen.getByRole('button', { name: /Start · one screen/ }));
    expect(opened).not.toHaveBeenCalled();
  });

  test('the page sends the pending window to the room\'s window once started, and closes it if Start fails', () => {
    // eslint-disable-next-line global-require
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'GameHostPage.jsx'), 'utf8');
    const fn = src.slice(src.indexOf('const startGameFromHistory'), src.indexOf('const startGameFromHistory') + 900);
    expect(fn).toMatch(/if \(pending\) pending\.cancel\(\)/);
    expect(fn).toMatch(/setWindowBlockedFor\(opts && opts\.blocked \? id : null\)/);
    expect(fn).toMatch(/if \(pending\) pending\.go\(presentHref\(id\)\)/);
  });
});
