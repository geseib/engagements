/**
 * THE HOST ALERT, on the page (docs/design/build-room-host-alert A1-A5, owner
 * 2026-10-10). Fixtures come from the real backend's pure half (build-store.js
 * hostView), so the page is tested against the shape GET build/state answers.
 * NO GEOMETRIC ASSERTIONS: jsdom has no layout engine.
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import {
  render, screen, fireEvent, waitFor, within, act,
} from '@testing-library/react';
import { authFetch, getAuthToken } from '../auth/authFetch';
import webSocketClient from '../WebSocketClient';
import BuildRoomPage from '../buildroom/BuildRoomPage';

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
const ago = (s) => new Date(Date.now() - s * 1000).toISOString();

function hostState({ st = {}, asks = [], ideas = [], logs = [], images = [], seen } = {}) {
  const rows = [
    {
      SK: 'BUILD#STATE', Rev: 7, AgentSeenAt: ago(6), Phase: 'building', ...st,
    },
    ...(seen ? [{ SK: 'BUILD#SEEN', Ids: seen.ids || [], AllAt: seen.allAt || '', V: 1 }] : []),
    ...images.map((im, i) => ({ SK: `BUILD#IMG#${i}`, ImageId: `im${i}`, Kind: 'mockup', CreatedAt: ago(60), ...im })),
    ...asks.map((a) => ({ SK: `BUILD#ASK#${a.AskId}`, Source: 'agent', CreatedAt: ago(600), ...a })),
    ...logs.map((l, i) => ({ SK: `BUILD#LOG#${String(i).padStart(13, '0')}#x${i}`, LogId: `${i}-x${i}`, CreatedAt: ago(900 - i * 60), ...l })),
    ...ideas.map((d, i) => ({ SK: `BUILD#IDEA#${String(i).padStart(13, '0')}#i${i}`, IdeaId: `${i}-i${i}`, Status: 'new', CreatedAt: ago(120), ...d })),
  ];
  return S.hostView({
    gameId: GAME,
    meta: { Title: 'Volunteer sign-up', Details: 'A one-page site to pick a shift in a minute.' },
    sessionState: 'STARTED',
    room: S.roomFromRows(rows),
    players: ['Ana', 'Dee', 'Priya', 'Sam'],
    now: NOW,
  });
}

const QUESTION = { AskId: '004', Kind: 'suggest', Prompt: 'What would stop Dee signing up?', Detail: '', Options: [], MaxPicks: 3, Status: 'proposed' };
const MOCKUPS = {
  AskId: '005',
  Kind: 'choice',
  Prompt: 'Which header should volunteers see first?',
  Detail: '',
  Options: [{ label: 'A', title: 'Bold banner', imageId: 'i1' }, { label: 'B', title: 'Calm photo', imageId: 'i2' }, { label: 'C', title: 'Map first', imageId: 'i3' }],
  MaxPicks: 1,
  Status: 'proposed',
};
const IDEAS = [
  { PlayerName: 'Priya', Text: 'Add a dark mode please' },
  { PlayerName: 'Marcus', Text: 'Show parking' },
  { PlayerName: 'Ana', Text: 'Print a rota' },
];

let current;
let calls;
const res = (data, ok = true, status = 200) => ({ ok, status, json: async () => data });

function serve(state) {
  current = state;
  calls = [];
  authFetch.mockImplementation(async (url, opts = {}) => {
    const method = opts.method || 'GET';
    const body = opts.body ? JSON.parse(opts.body) : undefined;
    calls.push({ url, method, body });
    if (method === 'GET' && url.endsWith('/build/state')) return res(current);
    if (url.endsWith('/host-ticket')) return res({ ticket: 't' });
    if (method === 'POST' && url.endsWith('/build/seen')) {
      const seen = body.all ? { ids: [], allAt: new Date().toISOString() } : { ids: body.ids, allAt: '' };
      return res({ seen });
    }
    return res({ ok: true });
  });
}
const seenPosts = () => calls.filter((c) => c.method === 'POST' && c.url.endsWith('/build/seen'));

async function openRoom(state, screenKey) {
  serve(state);
  window.history.pushState({}, '', `/build?gameId=${GAME}`);
  render(<BuildRoomPage />);
  await screen.findByText('Volunteer sign-up');
  if (screenKey) fireEvent.keyDown(window, { key: screenKey });
}
const dock = () => document.querySelector('footer.dock');
const nav = () => screen.getByRole('navigation', { name: 'Screens' });
const stageTrigger = () => dock().querySelector('button.brm-hostalert');
const headerTrigger = () => within(nav()).getAllByRole('button').find((b) => /^Host/.test(b.textContent));
const list = () => screen.getByRole('group', { name: 'Waiting for the host' });

beforeEach(() => {
  window.API_BASE = API;
  jest.clearAllMocks();
  getAuthToken.mockImplementation(async () => 'id-token');
});

describe('A1: the count on the Stage dock', () => {
  test('amber "HOST · 4" while Claude has a question, mockups and ideas wait', async () => {
    await openRoom(hostState({ asks: [QUESTION, MOCKUPS], ideas: IDEAS.slice(0, 2) }), '2');
    const b = stageTrigger();
    expect(b).toHaveTextContent('HOST · 4');
    expect(b).toHaveClass('brm-hostalert--amber');
    expect(b).not.toHaveClass('brm-hostalert--grey');
  });

  test('grey "HOST · 3" with only room ideas', async () => {
    await openRoom(hostState({ ideas: IDEAS }), '2');
    const b = stageTrigger();
    expect(b).toHaveTextContent('HOST · 3');
    expect(b).toHaveClass('brm-hostalert--grey');
  });

  test('A5: nothing new reads "HOST" and one click goes straight to the Host screen, no list', async () => {
    await openRoom(hostState(), '2');
    expect(stageTrigger()).toHaveTextContent(/^HOST$/);
    expect(stageTrigger()).toHaveAttribute('aria-label', 'Host screen');
    fireEvent.click(stageTrigger());
    expect(screen.queryByRole('group', { name: 'Waiting for the host' })).toBeNull();
    expect(screen.getByRole('region', { name: 'The queue' })).toBeInTheDocument();
  });

  test('"Claude finished" does not count: a milestone alone leaves HOST plain', async () => {
    await openRoom(hostState({ logs: [{ Kind: 'milestone', Text: 'Built the header', By: 'agent' }, { Kind: 'showing', Text: 'The header is up', By: 'agent' }] }), '2');
    expect(stageTrigger()).toHaveTextContent(/^HOST$/);
  });

  test('the host\'s own draft and queued idea do not count', async () => {
    await openRoom(hostState({ asks: [{ ...QUESTION, Source: 'host' }], ideas: [{ PlayerName: 'You', Text: 'Later', Source: 'host' }] }), '2');
    expect(stageTrigger()).toHaveTextContent(/^HOST$/);
  });
});

describe('A2: the list opens in place', () => {
  test('click with a count opens the list: most urgent first, folded, one line each, with the footer', async () => {
    await openRoom(hostState({ asks: [QUESTION, MOCKUPS], ideas: IDEAS }), '2');
    fireEvent.click(stageTrigger());
    const l = list();
    const lines = within(l).getAllByRole('button').map((b) => b.textContent);
    expect(lines).toEqual([
      'Claude has a questionOpen →',
      'Mockups are ready (3)See them →',
      '3 new ideas from the roomReview →',
      'Mark all seen',
      'Host screen · 1',
    ]);
    expect(stageTrigger()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.queryByRole('region', { name: 'The queue' })).toBeNull();
  });

  test('Escape closes it and the focus returns to HOST', async () => {
    await openRoom(hostState({ ideas: IDEAS }), '2');
    fireEvent.click(stageTrigger());
    fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape' });
    expect(screen.queryByRole('group', { name: 'Waiting for the host' })).toBeNull();
    expect(document.activeElement).toBe(stageTrigger());
  });

  test('a click outside closes it; a click on the button again closes it too', async () => {
    await openRoom(hostState({ ideas: IDEAS }), '2');
    fireEvent.click(stageTrigger());
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('group', { name: 'Waiting for the host' })).toBeNull();
    fireEvent.click(stageTrigger());
    expect(list()).toBeInTheDocument();
    fireEvent.click(stageTrigger());
    expect(screen.queryByRole('group', { name: 'Waiting for the host' })).toBeNull();
  });

  test('key 1 goes straight to the Host screen even with the list open', async () => {
    await openRoom(hostState({ ideas: IDEAS }), '2');
    fireEvent.click(stageTrigger());
    fireEvent.keyDown(window, { key: '1' });
    expect(screen.getByRole('region', { name: 'The queue' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Waiting for the host' })).toBeNull();
  });

  test('"Host screen · 1" goes there without marking anything seen', async () => {
    await openRoom(hostState({ ideas: IDEAS }), '2');
    fireEvent.click(stageTrigger());
    fireEvent.click(within(list()).getByRole('button', { name: 'Host screen · 1' }));
    expect(screen.getByRole('region', { name: 'The queue' })).toBeInTheDocument();
    expect(seenPosts()).toHaveLength(0);
  });
});

describe('each line jumps to where it is handled, and is seen', () => {
  test('"Open →": the Host screen with that ask focused; POST seen with its id; the count drops at once and goes grey', async () => {
    await openRoom(hostState({ asks: [QUESTION], ideas: IDEAS }), '2');
    fireEvent.click(stageTrigger());
    fireEvent.click(within(list()).getByRole('button', { name: /Claude has a question/ }));
    const card = await screen.findByRole('region', { name: 'Proposed ask 4' });
    await waitFor(() => expect(document.activeElement).toBe(card));
    expect(card).toHaveAttribute('data-alert-ask', '004');
    await waitFor(() => expect(seenPosts()).toHaveLength(1));
    expect(seenPosts()[0].body).toEqual({ ids: ['ask:004'] });
    // Back on the Stage the question is no longer counted, and it is grey.
    fireEvent.keyDown(window, { key: '2' });
    expect(stageTrigger()).toHaveTextContent('HOST · 3');
    expect(stageTrigger()).toHaveClass('brm-hostalert--grey');
    // The item stays in Waiting for you until it is handled.
    fireEvent.keyDown(window, { key: '1' });
    expect(screen.getByRole('region', { name: 'Proposed ask 4' })).toBeInTheDocument();
  });

  test('"See them →" focuses the mockups ask', async () => {
    await openRoom(hostState({ asks: [QUESTION, MOCKUPS] }), '2');
    fireEvent.click(stageTrigger());
    fireEvent.click(within(list()).getByRole('button', { name: /Mockups are ready/ }));
    const card = await screen.findByRole('region', { name: 'Proposed ask 5' });
    await waitFor(() => expect(document.activeElement).toBe(card));
    expect(seenPosts()[0].body).toEqual({ ids: ['ask:005'] });
  });

  test('"Review →" for ideas goes to Waiting for you and marks every idea in the line seen', async () => {
    await openRoom(hostState({ ideas: IDEAS }), '2');
    fireEvent.click(stageTrigger());
    fireEvent.click(within(list()).getByRole('button', { name: /new ideas from the room/ }));
    const heading = await screen.findByRole('heading', { name: /^Waiting for you/ });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(seenPosts()[0].body.ids).toHaveLength(3);
    expect(seenPosts()[0].body.ids.every((id) => /^idea:/.test(id))).toBe(true);
    // Waiting for you on the Host screen still counts all three.
    expect(heading).toHaveTextContent('Waiting for you · 3');
  });

  test('"Mark all seen" posts {all: true}, closes the list and clears the count; the ideas stay in Waiting for you', async () => {
    await openRoom(hostState({ asks: [QUESTION], ideas: IDEAS }), '2');
    fireEvent.click(stageTrigger());
    fireEvent.click(within(list()).getByRole('button', { name: 'Mark all seen' }));
    await waitFor(() => expect(seenPosts()).toHaveLength(1));
    expect(seenPosts()[0].body).toEqual({ all: true });
    expect(screen.queryByRole('group', { name: 'Waiting for the host' })).toBeNull();
    expect(stageTrigger()).toHaveTextContent(/^HOST$/);
    fireEvent.keyDown(window, { key: '1' });
    expect(screen.getByRole('heading', { name: /^Waiting for you · 4/ })).toBeInTheDocument();
  });

  test('a failed save puts the count back and says so', async () => {
    await openRoom(hostState({ ideas: IDEAS }), '2');
    const base = authFetch.getMockImplementation();
    authFetch.mockImplementation(async (url, opts = {}) => (url.endsWith('/build/seen') ? res({ error: 'No' }, false, 500) : base(url, opts)));
    fireEvent.click(stageTrigger());
    fireEvent.click(within(list()).getByRole('button', { name: 'Mark all seen' }));
    await waitFor(() => expect(stageTrigger()).toHaveTextContent('HOST · 3'));
    fireEvent.keyDown(window, { key: '1' });
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});

describe('seen is shared across the host\'s devices', () => {
  test('what the server says is seen is not counted on load', async () => {
    await openRoom(hostState({ asks: [QUESTION], ideas: IDEAS, seen: { ids: ['ask:004'], allAt: '' } }), '2');
    expect(stageTrigger()).toHaveTextContent('HOST · 3');
    expect(stageTrigger()).toHaveClass('brm-hostalert--grey');
  });

  test('another device marks everything seen: the next refresh clears this wall\'s count', async () => {
    await openRoom(hostState({ asks: [QUESTION], ideas: IDEAS }), '2');
    expect(stageTrigger()).toHaveTextContent('HOST · 4');
    const handler = webSocketClient.onMessage.mock.calls.find(([type]) => type === 'buildChanged')[1];
    current = hostState({ asks: [QUESTION], ideas: IDEAS, seen: { ids: [], allAt: new Date(Date.now() + 1000).toISOString() } });
    await act(async () => { handler({ gameId: GAME, rev: 8 }); });
    await waitFor(() => expect(stageTrigger()).toHaveTextContent(/^HOST$/));
  });

  test('an item handled on another device leaves the count', async () => {
    await openRoom(hostState({ ideas: IDEAS }), '2');
    const handler = webSocketClient.onMessage.mock.calls.find(([type]) => type === 'buildChanged')[1];
    current = hostState({ ideas: [{ ...IDEAS[0], Status: 'acknowledged' }, IDEAS[1], IDEAS[2]] });
    await act(async () => { handler({ gameId: GAME, rev: 8 }); });
    await waitFor(() => expect(stageTrigger()).toHaveTextContent('HOST · 2'));
  });
});

describe('A3: the Build and History header', () => {
  test('"Host · 3" on the Host tab on Build and on History, grey; the plain tab with nothing new', async () => {
    await openRoom(hostState({ ideas: IDEAS }), '3');
    expect(headerTrigger()).toHaveTextContent('Host · 3');
    expect(headerTrigger()).toHaveClass('brm-hostalert--grey');
    fireEvent.keyDown(window, { key: '4' });
    expect(headerTrigger()).toHaveTextContent('Host · 3');
  });

  test('amber with a question; the list drops under the tab with the same lines', async () => {
    await openRoom(hostState({ asks: [QUESTION], ideas: IDEAS }), '3');
    expect(headerTrigger()).toHaveClass('brm-hostalert--amber');
    fireEvent.click(headerTrigger());
    expect(within(list()).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Claude has a questionOpen →', '3 new ideas from the roomReview →', 'Mark all seen', 'Host screen · 1',
    ]);
    fireEvent.click(within(list()).getByRole('button', { name: /Claude has a question/ }));
    expect(screen.getByRole('region', { name: 'Proposed ask 4' })).toBeInTheDocument();
  });

  test('nothing new: the tab is plain, and a click goes to the Host screen', async () => {
    await openRoom(hostState(), '3');
    expect(headerTrigger()).toHaveTextContent(/^Host$/);
    fireEvent.click(headerTrigger());
    expect(screen.getByRole('region', { name: 'The queue' })).toBeInTheDocument();
  });

  test('on the Host screen itself the tab carries no count (Waiting for you does)', async () => {
    await openRoom(hostState({ asks: [QUESTION], ideas: IDEAS }));
    expect(headerTrigger()).toHaveTextContent(/^Host$/);
    expect(headerTrigger()).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('heading', { name: /^Waiting for you · 4/ })).toBeInTheDocument();
  });
});

describe('the room reads these screens', () => {
  test('no name, idea text, question or title appears in the alert or its list, on the Stage or on Build', async () => {
    await openRoom(hostState({ asks: [QUESTION, MOCKUPS], ideas: IDEAS }), '2');
    fireEvent.click(stageTrigger());
    const alertText = () => document.querySelector('.brm-hostalert-wrap').textContent;
    const stageText = alertText();
    const stageBody = document.body.textContent;
    fireEvent.keyDown(window, { key: '3' });
    fireEvent.click(headerTrigger());
    const buildText = alertText();
    const buildBody = document.body.textContent;
    expect(stageText).toContain('Claude has a question');
    expect(buildText).toContain('Claude has a question');
    ['Priya', 'Marcus', 'Ana', 'Add a dark mode', 'Show parking', 'Print a rota', 'What would stop Dee', 'Which header should', 'Bold banner', 'Calm photo', 'Map first'].forEach((w) => {
      expect(stageText).not.toContain(w);
      expect(buildText).not.toContain(w);
    });
    // Nothing a participant typed is on these screens at all.
    ['Priya', 'Marcus', 'Add a dark mode', 'Show parking', 'Print a rota', 'What would stop Dee'].forEach((w) => {
      expect(stageBody).not.toContain(w);
      expect(buildBody).not.toContain(w);
    });
  });

  test('the list is not a dialog and makes no sound or pop-up: a group, no live region', async () => {
    await openRoom(hostState({ asks: [QUESTION] }), '2');
    fireEvent.click(stageTrigger());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(list().closest('[aria-live]')).toBeNull();
  });
});

describe('mockups the host asked for, through the real view', () => {
  const HOST_MOCKUPS = { AskId: '006', Kind: 'choice', Prompt: 'Which look?', Detail: '', Options: [{ label: 'A', title: 'Bold' }, { label: 'B', title: 'Calm' }], MaxPicks: 1, Status: 'proposed', Source: 'host', AskForMockups: true };
  test('a host-made vote with mockups counts amber once the pictures are in', async () => {
    await openRoom(hostState({ asks: [HOST_MOCKUPS], images: [{ AskId: '006', Label: 'A' }, { AskId: '006', Label: 'B' }] }), '2');
    expect(stageTrigger()).toHaveTextContent('HOST · 1');
    expect(stageTrigger()).toHaveClass('brm-hostalert--amber');
    fireEvent.click(stageTrigger());
    expect(within(list()).getByRole('button', { name: /Mockups are ready \(2\)/ })).toBeInTheDocument();
  });
  test('and not while a picture is missing', async () => {
    await openRoom(hostState({ asks: [HOST_MOCKUPS], images: [{ AskId: '006', Label: 'A' }] }), '2');
    expect(stageTrigger()).toHaveTextContent(/^HOST$/);
  });
});

describe('saving seen in chunks', () => {
  const many = (n) => Array.from({ length: n }, (_, i) => ({ PlayerName: `P${i}`, Text: `Idea ${i}`, CreatedAt: ago(1000 - i) }));
  test('60 ideas in one line go in two posts of at most 50', async () => {
    await openRoom(hostState({ ideas: many(60) }), '2');
    fireEvent.click(stageTrigger());
    fireEvent.click(within(list()).getByRole('button', { name: /new ideas from the room/ }));
    await waitFor(() => expect(seenPosts().length).toBe(2));
    seenPosts().forEach((c) => expect(c.body.ids.length).toBeLessThanOrEqual(50));
    expect(seenPosts().flatMap((c) => c.body.ids)).toHaveLength(60);
  });
  test('230 ideas: only the newest 200 are sent, so no older id is pushed back out of the list', async () => {
    await openRoom(hostState({ ideas: many(230) }), '2');
    fireEvent.click(stageTrigger());
    fireEvent.click(within(list()).getByRole('button', { name: /new ideas from the room/ }));
    await waitFor(() => expect(seenPosts().length).toBe(4));
    const sent = seenPosts().flatMap((c) => c.body.ids);
    expect(sent).toHaveLength(200);
    const oldest = current.ideas.slice().sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).slice(0, 30).map((i) => `idea:${i.ideaId}`);
    oldest.forEach((id) => expect(sent).not.toContain(id));
  });
});

describe('the Waiting for you filter follows the line', () => {
  test('ideas jump turns the filter to Room; an ask jump leaves it on All', async () => {
    await openRoom(hostState({ asks: [QUESTION], ideas: IDEAS }), '2');
    fireEvent.click(stageTrigger());
    fireEvent.click(within(list()).getByRole('button', { name: /new ideas from the room/ }));
    await screen.findByRole('heading', { name: /^Waiting for you/ });
    expect(within(screen.getByRole('group', { name: 'Show' })).getByRole('button', { name: /^Room/ })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.keyDown(window, { key: '2' });
    fireEvent.click(stageTrigger());
    fireEvent.click(within(list()).getByRole('button', { name: /Claude has a question/ }));
    const card = await screen.findByRole('region', { name: 'Proposed ask 4' });
    await waitFor(() => expect(document.activeElement).toBe(card));
    expect(within(screen.getByRole('group', { name: 'Show' })).getByRole('button', { name: /^All/ })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('focus, rollback and closing', () => {
  test('after Mark all seen the focus is on HOST (Stage) or the Host tab (header)', async () => {
    await openRoom(hostState({ ideas: IDEAS }), '2');
    fireEvent.click(stageTrigger());
    fireEvent.click(within(list()).getByRole('button', { name: 'Mark all seen' }));
    await waitFor(() => expect(document.activeElement).toBe(stageTrigger()));
  });
  test('header: the Host tab keeps the focus even though the count is gone', async () => {
    await openRoom(hostState({ ideas: IDEAS }), '3');
    fireEvent.click(headerTrigger());
    fireEvent.click(within(list()).getByRole('button', { name: 'Mark all seen' }));
    await waitFor(() => expect(headerTrigger()).toHaveTextContent(/^Host$/));
    expect(document.activeElement).toBe(headerTrigger());
  });
  test('a failed save puts back only what failed, and reads the room again', async () => {
    await openRoom(hostState({ asks: [QUESTION], ideas: IDEAS }), '2');
    fireEvent.click(stageTrigger());
    fireEvent.click(within(list()).getByRole('button', { name: /new ideas from the room/ }));
    await waitFor(() => expect(seenPosts()).toHaveLength(1));
    fireEvent.keyDown(window, { key: '2' });
    const base = authFetch.getMockImplementation();
    authFetch.mockImplementation(async (url, opts = {}) => (url.endsWith('/build/seen') ? res({ error: 'No' }, false, 500) : base(url, opts)));
    const reads = calls.filter((c) => c.url.endsWith('/build/state')).length;
    fireEvent.click(stageTrigger());
    fireEvent.click(within(list()).getByRole('button', { name: /Claude has a question/ }));
    await waitFor(() => expect(calls.filter((c) => c.url.endsWith('/build/state')).length).toBeGreaterThan(reads));
    fireEvent.keyDown(window, { key: '2' });
    // The ideas stay seen; the question counts again.
    await waitFor(() => expect(stageTrigger()).toHaveTextContent('HOST · 1'));
    expect(stageTrigger()).toHaveClass('brm-hostalert--amber');
  });
  test('the list closes when the focus leaves it, and when the window loses it (an iframe took the click)', async () => {
    await openRoom(hostState({ ideas: IDEAS }), '2');
    fireEvent.click(stageTrigger());
    fireEvent.focusOut(within(list()).getByRole('button', { name: 'Mark all seen' }), { relatedTarget: document.body });
    expect(screen.queryByRole('group', { name: 'Waiting for the host' })).toBeNull();
    fireEvent.click(stageTrigger());
    expect(list()).toBeInTheDocument();
    fireEvent.blur(window);
    expect(screen.queryByRole('group', { name: 'Waiting for the host' })).toBeNull();
  });
  test('focus moving between the trigger and its own list does not close it', async () => {
    await openRoom(hostState({ ideas: IDEAS }), '2');
    fireEvent.click(stageTrigger());
    fireEvent.focusOut(stageTrigger(), { relatedTarget: within(list()).getByRole('button', { name: 'Mark all seen' }) });
    expect(list()).toBeInTheDocument();
  });
});

describe('one orange', () => {
  const css = fs.readFileSync(path.join(__dirname, '../buildroom/BuildRoom.css'), 'utf8');
  const rules = css.split('}').map((r) => r.trim()).filter(Boolean);
  const ruleFor = (needle) => rules.filter((r) => r.split('{')[0].includes(needle));

  test('the alert and the lit SESSION never use the one orange; they use their own amber, as outline and text only', () => {
    const mine = [...ruleFor('brm-hostalert'), ...ruleFor('brm-dock-lit')];
    expect(mine.length).toBeGreaterThan(4);
    mine.forEach((r) => expect(r).not.toMatch(/var\(--primary\)/));
    const amber = ruleFor('brm-hostalert--amber');
    expect(amber.join(' ')).toMatch(/var\(--brm-alert-amber\)/);
    amber.forEach((r) => expect(r).not.toMatch(/background:\s*var\(--brm-alert-amber\)/));
    expect(css).toMatch(/--brm-alert-amber:\s*#[0-9A-Fa-f]{6}/);
    expect(css.match(/--brm-alert-amber:\s*(#[0-9A-Fa-f]{6})/)[1].toLowerCase()).not.toBe('#f6a94c');
  });

  test('on the Stage with the alert amber the dock still has exactly one filled button', async () => {
    await openRoom(hostState({ asks: [QUESTION] }), '2');
    expect(stageTrigger()).toHaveClass('brm-hostalert--amber');
    expect(stageTrigger().className).not.toMatch(/\bbtn\b/);
    expect(dock().querySelectorAll('.btn:not(.ghost)').length).toBeLessThanOrEqual(1);
  });
});
