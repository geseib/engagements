/**
 * ONE SESSIONS LIST, TWO FRAMES — experience plan Phase 4a/4b (PLAN §3.1,
 * §6; audit E §1.3 L1 and §1.9: "Sessions — SessionHistoryPanel (.shist) …
 * SessionsPanel (.sp) — Same component? No").
 *
 * What this pins:
 *   1. PARITY. Every action a row offers on the host's side (Home's recent
 *      rows, the "Your sessions" dialog) it offers in Library & team's
 *      Sessions, and the other way round — for every kind of row.
 *   2. ONE COMPONENT. All three render SessionList; nothing draws its own.
 *   3. THE ROW MODEL. config/sessionRows.js: which actions, which primary,
 *      what Rejoin offers, and the console's hand-over URL.
 *   4. THE HAND-OVER. The host page runs the console's Start / Edit / Report
 *      / Survey results once, from the URL.
 *
 * NO GEOMETRIC ASSERTIONS. jsdom has no layout engine.
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen, waitFor, within, cleanup } from '@testing-library/react';
import SessionsPanel from '../components/SessionsPanel';
import SessionHistoryPanel from '../components/SessionHistoryPanel';
import WelcomeScreen from '../components/WelcomeScreen';
import { authFetch } from '../auth/authFetch';
import { rowActionNames } from '../testUtils/sessionRows';
import {
  sessionActions, allActions, isRejoinable, recentSessions, statusOf, sessionIntentPath,
  readSessionIntent, LIBRARY_NAME, LIBRARY_SESSIONS_PATH, ROW_ACTION_WORDS,
} from '../config/sessionRows';

jest.mock('../auth/authFetch', () => ({ ...jest.requireActual('../auth/authFetch'), authFetch: jest.fn() }));

const NOW = Date.now();
const ago = (h) => new Date(NOW - h * 3600000).toISOString();

const ROWS = {
  unstarted: { gameId: '2001', title: 'Unstarted one', gameType: 'call-and-answer', started: false, byMe: true, createdAt: ago(1), deleteAs: 'host' },
  running: { gameId: '2002', title: 'Running one', gameType: 'trivia', started: true, ended: false, byMe: true, createdAt: ago(2), deleteAs: 'host' },
  ended: { gameId: '2003', title: 'Ended one', gameType: 'poll', started: true, ended: true, byMe: true, createdAt: ago(3), deleteAs: 'host' },
  survey: { gameId: '2004', title: 'Closed survey', gameType: 'survey', started: true, surveyClosed: true, byMe: true, createdAt: ago(4), deleteAs: 'host' },
  build: { gameId: '2005', title: 'A build room', gameType: 'build', started: true, byMe: true, createdAt: ago(5), deleteAs: 'host' },
};
const EVENT = {
  code: '4821', title: 'An event', state: 'SCHEDULED', createdAt: ago(6), items: [], itemCount: 0,
};

beforeEach(() => {
  authFetch.mockReset();
  window.API_BASE = 'https://api.example.test/dev/';
  authFetch.mockImplementation(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      games: Object.values(ROWS),
      events: [{ kind: 'event', gameId: EVENT.code, eventCode: EVENT.code, gameType: 'event', ...EVENT, deleteAs: 'host' }],
    }),
  }));
});

const hostHandlers = () => ({
  onStart: jest.fn(), onEdit: jest.fn(), onOpen: jest.fn(), onReport: jest.fn(), onResults: jest.fn(),
  onInvite: jest.fn(), onCopyPlayerUrl: jest.fn(), onDelete: jest.fn(() => Promise.resolve()),
});
const allRows = () => [
  ...Object.values(ROWS),
  { kind: 'event', gameId: EVENT.code, eventCode: EVENT.code, gameType: 'event', ...EVENT, deleteAs: 'host' },
];

async function namesInConsole() {
  render(<SessionsPanel navigate={jest.fn()} onOpenEvent={jest.fn()} />);
  await waitFor(() => expect(screen.queryByText(/Loading sessions/)).toBeNull());
  const out = {};
  for (const r of allRows()) out[r.title] = rowActionNames(screen.getByText(r.title).closest('tr'));
  cleanup();
  return out;
}

function namesInHostDialog() {
  render(<SessionHistoryPanel sessions={allRows()} {...hostHandlers()} navigate={jest.fn()} />);
  const out = {};
  for (const r of allRows()) out[r.title] = rowActionNames(screen.getByText(r.title).closest('tr'));
  cleanup();
  return out;
}

function namesOnHome() {
  render(<WelcomeScreen currentUser={{ attributes: { name: 'Sam' }, groups: ['hosts'] }} sessions={allRows()} rowActions={hostHandlers()} navigate={jest.fn()} />);
  const recent = screen.getByRole('table', { name: 'Recent sessions' });
  const out = {};
  for (const r of Object.values(ROWS)) out[r.title] = rowActionNames(within(recent).getByText(r.title).closest('tr'));
  cleanup();
  return out;
}

/* ------------------------------------------------------------- 1. parity */

describe('every row action is available from both places', () => {
  test('Library & team and the host\'s sessions dialog offer the same actions, row for row', async () => {
    const consoleNames = await namesInConsole();
    const hostNames = namesInHostDialog();
    expect(Object.keys(consoleNames)).toHaveLength(6);
    expect(consoleNames).toEqual(hostNames);
  });

  test('Home\'s recent rows offer the same actions as Library & team\'s', async () => {
    const consoleNames = await namesInConsole();
    const home = namesOnHome();
    for (const title of Object.keys(home)) expect(home[title]).toEqual(consoleNames[title]);
  });

  test('the actions each list carried before are all still offered (nothing lost)', async () => {
    const c = await namesInConsole();
    // The host list's: Start, Edit, Continue, Report, Results, Link, Invite.
    expect(c['Unstarted one']).toEqual(expect.arrayContaining(['Start', 'Edit', 'Invite…', 'Copy join link']));
    expect(c['Running one']).toEqual(expect.arrayContaining(['Continue', 'Report', 'Invite…', 'Copy join link']));
    expect(c['Closed survey']).toEqual(expect.arrayContaining(['Survey results', 'Report', 'Continue']));
    expect(c['A build room']).toEqual(expect.arrayContaining(['Continue', 'Report']));
    expect(c['An event']).toEqual(expect.arrayContaining(['Open', 'Edit the agenda', 'Copy join link']));
    // The console's: Delete, on every kind.
    Object.values(c).forEach((names) => expect(names).toContain('Delete…'));
  });

  test('one primary per row: the first action is the row\'s one primary button', () => {
    render(<SessionHistoryPanel sessions={allRows()} {...hostHandlers()} navigate={jest.fn()} />);
    for (const r of allRows()) {
      const row = screen.getByText(r.title).closest('tr');
      expect(row.querySelectorAll('.slist-lead')).toHaveLength(1);
      expect(within(row).getByRole('button', { name: /^More for/ })).toHaveAttribute('aria-haspopup', 'menu');
    }
  });
});

/* -------------------------------------------------------- 2. one component */

describe('the console uses the same list', () => {
  const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

  test('SessionsPanel, SessionHistoryPanel and Home all render SessionList', () => {
    for (const file of ['SessionsPanel.jsx', 'SessionHistoryPanel.jsx', 'WelcomeScreen.jsx']) {
      expect(read('components', file)).toMatch(/import SessionList(, \{[^}]*\})? from '\.\/SessionList'/);
      expect(read('components', file)).toMatch(/<SessionList\b/);
    }
    expect(read('AdminPage.jsx')).toMatch(/<SessionsPanel\b/);
  });

  test('neither frame draws its own sessions table any more', () => {
    expect(read('components', 'SessionsPanel.jsx')).not.toMatch(/<table/);
    expect(read('components', 'SessionHistoryPanel.jsx')).not.toMatch(/<table/);
    expect(read('components', 'WelcomeScreen.jsx')).not.toMatch(/<table/);
  });

  test('rendered, the console\'s list is a .slist like the host\'s', async () => {
    const { container } = render(<SessionsPanel navigate={jest.fn()} />);
    await waitFor(() => expect(screen.queryByText(/Loading sessions/)).toBeNull());
    expect(container.querySelector('.sp .slist .slist-tbl')).not.toBeNull();
  });
});

/* ---------------------------------------------------------- 3. the model */

describe('config/sessionRows.js', () => {
  test.each([
    ['unstarted', 'start', ['edit', 'invite', 'link', 'delete']],
    ['running', 'continue', ['report', 'invite', 'link', 'delete']],
    ['ended', 'report', ['continue', 'invite', 'link', 'delete']],
    ['survey', 'results', ['report', 'continue', 'invite', 'link', 'delete']],
    ['build', 'continue', ['report', 'link', 'delete']],
  ])('%s: primary %s, then %j', (key, primary, menu) => {
    expect(sessionActions(ROWS[key])).toEqual({ primary, menu });
  });

  test('an event opens its stage; its agenda is in the menu', () => {
    expect(sessionActions({ kind: 'event', gameId: '4821', deleteAs: 'host' })).toEqual({ primary: 'open', menu: ['agenda', 'link', 'delete'] });
  });

  test('a row nobody here may delete loses Delete from the model (the list says who may)', () => {
    expect(allActions({ ...ROWS.running, deleteAs: '' })).not.toContain('delete');
  });

  test('Results is said "Survey results", never a bare "Results" (PLAN §3.6)', () => {
    expect(ROW_ACTION_WORDS.results).toBe('Survey results');
  });

  test('status words: Not started, Running, Ended, Closed — and Played when the end was not read', () => {
    expect(statusOf(ROWS.unstarted).word).toBe('Not started');
    expect(statusOf(ROWS.running).word).toBe('Running');
    expect(statusOf(ROWS.ended).word).toBe('Ended');
    expect(statusOf(ROWS.survey).word).toBe('Closed');
    expect(statusOf({ ...ROWS.running, ended: undefined }).word).toBe('Played');
  });

  test('Rejoin: mine, started, not ended, touched in the last day', () => {
    expect(isRejoinable(ROWS.running, NOW)).toBe(true);
    expect(isRejoinable(ROWS.ended, NOW)).toBe(false);
    expect(isRejoinable(ROWS.unstarted, NOW)).toBe(false);
    expect(isRejoinable({ ...ROWS.running, byMe: false }, NOW)).toBe(false);
    expect(isRejoinable({ ...ROWS.running, ended: undefined }, NOW)).toBe(false);
    expect(isRejoinable({ ...ROWS.running, createdAt: ago(30) }, NOW)).toBe(false);
  });

  test('Home\'s recent: the newest five, never an event', () => {
    const many = [...Object.values(ROWS), { ...ROWS.ended, gameId: '2010', title: 'Old', createdAt: ago(99) },
      { kind: 'event', gameId: '9', createdAt: ago(0) }];
    const recent = recentSessions(many);
    expect(recent).toHaveLength(5);
    expect(recent.map((r) => r.gameId)).toEqual(['2001', '2002', '2003', '2004', '2005']);
  });

  test('the console hands a session over by URL, and only the four actions it can', () => {
    expect(sessionIntentPath('2001', 'start')).toBe('/host?session=2001&do=start');
    expect(readSessionIntent('?session=2001&do=start')).toEqual({ gameId: '2001', action: 'start' });
    expect(readSessionIntent('?session=2001&do=edit')).toEqual({ gameId: '2001', action: 'edit' });
    expect(readSessionIntent('?session=2001&do=delete')).toBeNull();
    expect(readSessionIntent('?session=../x&do=start')).toBeNull();
    expect(readSessionIntent('')).toBeNull();
  });

  test('the console has one name, and "See all" opens its Sessions place', () => {
    expect(LIBRARY_NAME).toBe('Library & team');
    expect(LIBRARY_SESSIONS_PATH).toBe('/admin?section=games');
  });
});

/* --------------------------------------------------------- 4. hand-over */

describe('the host page runs the hand-over once', () => {
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const host = strip(fs.readFileSync(path.join(__dirname, '..', 'GameHostPage.jsx'), 'utf8'));

  test('the URL loader reads it on Home and runs it', () => {
    expect(host).toMatch(/const intent = readSessionIntent\(window\.location\.search\);\s*if \(intent\) runSessionIntent\(intent\);/);
  });

  test('it clears the URL first, so a reload does not start it twice', () => {
    const fn = host.slice(host.indexOf('const runSessionIntent'));
    const body = fn.slice(0, fn.indexOf('\n  };'));
    expect(body.indexOf("searchParams.delete('do')")).toBeGreaterThan(-1);
    expect(body.indexOf("searchParams.delete('do')")).toBeLessThan(body.indexOf('startSession('));
    for (const action of ['start', 'edit', 'report', 'results']) expect(body).toContain(`'${action}'`);
  });

  test('Report, Survey results and Edit render over Home: their branches come before Home\'s', () => {
    const at = (re) => host.search(re);
    const home = at(/if \(showWelcomeScreen\) \{/);
    expect(at(/if \(showReport\) \{/)).toBeLessThan(home);
    expect(at(/if \(showSurveyResults\) \{/)).toBeLessThan(home);
    expect(at(/if \(editTarget\) \{/)).toBeLessThan(home);
    // …and the sessions dialog still comes after Home, as it did.
    expect(at(/if \(showReportsModal\) \{/)).toBeGreaterThan(home);
  });

  test('Home can invite: the dialog is mounted beside it', () => {
    const block = host.slice(host.indexOf('if (showWelcomeScreen) {'), host.indexOf('if (showReportsModal) {'));
    expect(block).toMatch(/<InviteDialog target=\{inviteTarget\}/);
  });
});
