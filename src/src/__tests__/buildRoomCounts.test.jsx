/**
 * THE FIRST VIEW, COUNTED (docs/design/build-room-simplify/PLAN.md §1, §5,
 * phase 1; owner, 26 Oct 2026: "go, build phase 1 on dev").
 *
 * The plan measured the first view at 59 controls on one screen and 57 on the
 * console, and set phase 1's targets: no more than 36 on either, no more than
 * 250 words. This holds them, so they cannot drift back.
 *
 * The plan's method, reproduced: the real BuildRoomPage in jsdom, the state
 * built by the real server's pure half (build-store.js roomFromRows +
 * hostView), as buildCapabilities.test.jsx builds its fixtures. A control is a
 * button, input, select, textarea, link, summary, tab or switch that is not
 * inside a closed fold. Words are the words of the page's text, the same way.
 *
 * The first view is a new room: no ask yet, Claude Code not connected, four
 * people joined, and (on one screen) a browser that has not chosen screens.
 */
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { authFetch, getAuthToken } from '../auth/authFetch';
import BuildRoomPage from '../buildroom/BuildRoomPage';
import { SURFACES_KEY } from '../config/surfaces';

jest.mock('../utils/reloadPage', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn(), getAuthToken: jest.fn(async () => 'id-token') }));
jest.mock('../WebSocketClient', () => ({
  __esModule: true,
  default: {
    connect: jest.fn(), disconnect: jest.fn(), onMessage: jest.fn(), offMessage: jest.fn(), onReconnected: jest.fn(), onConnectionStatusChange: jest.fn(), isConnected: jest.fn(() => false), ensureConnected: jest.fn(),
  },
}));

const S = require('../../../lambda-functions/game/build-store');

const API = 'https://api.example.test/dev/';
const GAME = '4821';
const NOW = new Date().toISOString();

/** A new room: the state row alone, no Claude, four joined. */
function firstView() {
  const view = S.hostView({
    gameId: GAME,
    meta: { Title: 'Volunteer sign-up', Details: '' },
    sessionState: 'STARTED',
    room: S.roomFromRows([{ SK: 'BUILD#STATE', Rev: 1 }]),
    players: ['Ana', 'Dee', 'Priya', 'Sam'],
    now: NOW,
  });
  return {
    ...view, wallKey: 'K'.repeat(43), wall: { screen: 'stage', codes: 'none', profile: 'room', rev: 1 }, presenting: 0, presentDetail: null,
  };
}

const res = (data) => ({ ok: true, status: 200, json: async () => data });
function serve(state) {
  authFetch.mockImplementation(async (url, opts = {}) => {
    const method = opts.method || 'GET';
    if (method === 'GET' && url.endsWith('/build/state')) return res(state);
    if (method === 'GET' && url.endsWith('/players')) return res({ players: [], removedPlayers: [] });
    if (url.endsWith('/host-ticket')) return res({ ticket: 't' });
    return res({ ok: true });
  });
}

const CONTROLS = 'button, input, select, textarea, a[href], summary, [role="tab"], [role="switch"]';

/** Every control not inside a closed fold (a <details> without `open`; its own summary counts). */
function countControls(root) {
  return [...root.querySelectorAll(CONTROLS)].filter((el) => {
    const fold = el.parentElement && el.parentElement.closest('details:not([open])');
    if (!fold) return true;
    return el.tagName === 'SUMMARY' && el.parentElement === fold;
  }).length;
}

/**
 * The words a host reads: the page's text, leaving out what is inside a closed
 * fold, screen-reader-only labels and the options of a shut select. Counted
 * this way, the first view was 377 words on one screen and 330 on the console
 * before phase 1 (the plan's 412 came from a scratch count that was not kept).
 */
function countWords(root) {
  const copy = root.cloneNode(true);
  copy.querySelectorAll('details:not([open])').forEach((d) => {
    [...d.childNodes].forEach((n) => { if (n.tagName !== 'SUMMARY') n.remove(); });
  });
  copy.querySelectorAll('.brm-sr, .sr-only, .rws-sr, option').forEach((n) => n.remove());
  return (copy.textContent || '').split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
}

async function open({ two = false } = {}) {
  if (two) window.localStorage.setItem(SURFACES_KEY, 'two');
  serve(firstView());
  window.history.pushState({}, '', `/build?gameId=${GAME}`);
  render(<BuildRoomPage />);
  await screen.findAllByText('Volunteer sign-up');
  const root = document.querySelector('.brm-room');
  return { root, controls: countControls(root), words: countWords(root) };
}

beforeEach(() => {
  window.API_BASE = API;
  jest.clearAllMocks();
  window.localStorage.clear();
  getAuthToken.mockImplementation(async () => 'id-token');
});
afterEach(() => { cleanup(); window.localStorage.clear(); });

test('one screen: no more than 36 controls and 250 words (59 and 377 before phase 1)', async () => {
  const { controls, words } = await open();
  expect(controls).toBeLessThanOrEqual(36);
  expect(words).toBeLessThanOrEqual(250);
});

test('two screens: the console\'s first view has no more than 36 controls (57 before), and fewer words than its 330', async () => {
  const { controls, words } = await open({ two: true });
  expect(controls).toBeLessThanOrEqual(36);
  // The plan's word target is the one-screen figure; the console carries its own top line,
  // strip and rail besides, so it holds the ground it gained instead.
  expect(words).toBeLessThanOrEqual(280);
});

test('one panel before the opening, and no choice to make before it: one orange, Connect (PLAN §5 phase 1)', async () => {
  const { root } = await open();
  const now = screen.getByRole('main', { name: 'Now' });
  const panels = [...now.querySelectorAll(':scope > section')];
  expect(panels[0]).toHaveAccessibleName('Before the room starts');
  expect(panels[1]).toHaveClass('brm-opening');
  // Which screen is not asked: one screen until the host says otherwise; Use two screens is a row.
  expect(screen.queryByRole('button', { name: 'Use one screen' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Help me pick' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Use two screens' })).toBeInTheDocument();
  // Connect or the opening is not a choice either: Connect is the one orange button.
  const orange = [...root.querySelectorAll('.brm-btn--primary')];
  expect(orange.map((b) => b.textContent.trim())).toEqual(['Connect']);
});
