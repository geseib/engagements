/**
 * THE BUILD ROOM HOST PAGE — buildroom/BuildRoomPage.jsx.
 *
 * Every fixture is built by the REAL backend's pure half: rows go through
 * lambda-functions/game/build-store.js `roomFromRows` and `hostView`, so the
 * page is tested against exactly the shape GET build/state answers with, and
 * a change to that shape turns this red instead of the wall going blank.
 *
 * What is pinned: each ask status renders; each host action POSTs the right
 * path and body; Present mode removes the host-only surface; the key is shown
 * once and the command carries it and the real API base; untrusted text stays
 * text. NO GEOMETRIC ASSERTIONS — jsdom has no layout engine.
 */
import React from 'react';
import {
  render, screen, fireEvent, waitFor, within, act,
} from '@testing-library/react';
import { authFetch, getAuthToken } from '../auth/authFetch';
import webSocketClient from '../WebSocketClient';
import BuildRoomPage, { BuildCreate, stageHint, ConnectPanel } from '../buildroom/BuildRoomPage';
import reloadPage from '../utils/reloadPage';

jest.mock('../utils/reloadPage', () => ({ __esModule: true, default: jest.fn() }));

jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn(), getAuthToken: jest.fn(async () => 'id-token') }));
jest.mock('../WebSocketClient', () => ({
  __esModule: true,
  default: {
    connect: jest.fn(),
    disconnect: jest.fn(),
    onMessage: jest.fn(),
    offMessage: jest.fn(),
    onReconnected: jest.fn(),
    onConnectionStatusChange: jest.fn(),
    isConnected: jest.fn(() => false),
    ensureConnected: jest.fn(),
  },
}));

const S = require('../../../lambda-functions/game/build-store');

const API = 'https://api.example.test/dev/';
const GAME = '4821';
const NOW = new Date().toISOString();
const ago = (s) => new Date(Date.now() - s * 1000).toISOString();

/** HostState, computed by build-store.js from rows — never hand-shaped. */
function hostState({ st = {}, asks = [], resps = [], answers = [], votes = [], logs = [], ideas = [], keys = [], activity = null } = {}) {
  const rows = [
    { SK: 'BUILD#STATE', Rev: 7, AgentSeenAt: ago(6), ...st },
    ...asks.map((a) => ({ SK: `BUILD#ASK#${a.AskId}`, Source: 'agent', CreatedAt: ago(600), ...a })),
    ...resps.map((r) => ({ SK: `BUILD#RESP#${r.AskId}#${r.RespId}`, Source: 'player', CreatedAt: ago(300), ...r })),
    ...answers.map((a) => ({ SK: `BUILD#ANS#${a.AskId}#${a.PlayerName}`, CreatedAt: ago(200), ...a })),
    ...votes.map((v) => ({ SK: `BUILD#VOTE#${v.AskId}#${v.PlayerName}`, CreatedAt: ago(100), ...v })),
    ...logs.map((l, i) => ({ SK: `BUILD#LOG#${String(i).padStart(13, '0')}#x${i}`, LogId: `${i}-x${i}`, CreatedAt: ago(900 - i * 60), ...l })),
    ...ideas.map((d, i) => ({ SK: `BUILD#IDEA#${String(i).padStart(13, '0')}#i${i}`, IdeaId: `${i}-i${i}`, Status: 'new', CreatedAt: ago(120), ...d })),
    ...keys.map((k) => ({ SK: `BUILD#KEY#${k.KeyId}`, ...k })),
    ...(activity ? [{ SK: 'BUILD#ACTIVITY', Items: activity }] : []),
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

const CHOICE = {
  AskId: '003',
  Kind: 'choice',
  Prompt: 'Which header should volunteers see first?',
  Detail: 'Both run on the laptop.',
  Options: [
    { label: 'A', title: 'Bold banner', detail: '', url: 'http://localhost:5173/a' },
    { label: 'B', title: 'Calm photo + calendar', detail: '', url: '' },
  ],
  MaxPicks: 1,
};
const CHOICE_ANSWERS = [
  { AskId: '003', PlayerName: 'Ana', Choice: ['B'], Why: 'Dates first' },
  { AskId: '003', PlayerName: 'Priya', Choice: ['B'], Why: '' },
  { AskId: '003', PlayerName: 'Sam', Choice: ['A'], Why: 'Big button' },
];
const IDEAS_ASK = {
  AskId: '004', Kind: 'suggest', Prompt: 'What would stop someone signing up?', Detail: '', Options: [], MaxPicks: 3,
};
const IDEAS_RESPS = [
  { AskId: '004', RespId: 'r1', Text: 'Having to make an account', PlayerName: 'Ana' },
  { AskId: '004', RespId: 'r2', Text: 'Not seeing open shifts', PlayerName: 'Dee' },
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
    if (url.endsWith('/build/keys')) return res({ key: `eng_${GAME}_${'k'.repeat(43)}`, keyId: 'abc123def456' }, true, 201);
    if (url.endsWith('/host-ticket')) return res({ ticket: 't' });
    return res({ ok: true, ask: {}, entry: {}, idea: {} });
  });
}

const posts = () => calls.filter((c) => c.method === 'POST' && !c.url.endsWith('/host-ticket'));
const lastPost = () => posts()[posts().length - 1];
const path = (c) => c.url.slice(API.length);
/** The header's session menu (owner, 2026-10-05): Connect, crew, Auto, Wrap up, Report, End. */
const openMore = () => fireEvent.click(screen.getByRole('button', { name: /^More/ }));

async function openRoom(state) {
  serve(state);
  window.history.pushState({}, '', `/build?gameId=${GAME}`);
  render(<BuildRoomPage />);
  await screen.findByText('Volunteer sign-up');
}

beforeEach(() => {
  window.API_BASE = API;
  jest.clearAllMocks();
  getAuthToken.mockImplementation(async () => 'id-token');
});

describe('loading and live updates', () => {
  test('fetches GET build/state and connects a ticketed host socket', async () => {
    await openRoom(hostState());
    expect(calls[0]).toMatchObject({ url: `${API}games/${GAME}/build/state`, method: 'GET' });
    expect(webSocketClient.connect).toHaveBeenCalledWith(GAME, null, true, expect.objectContaining({ hostTicket: expect.any(Function) }));
  });

  test('a buildChanged message refetches the state', async () => {
    await openRoom(hostState());
    const handler = webSocketClient.onMessage.mock.calls.find(([type]) => type === 'buildChanged')[1];
    const before = calls.filter((c) => c.url.endsWith('/build/state')).length;
    current = hostState({ logs: [{ Kind: 'progress', Text: 'Shift list renders', By: 'agent' }] });
    await act(async () => { handler({ gameId: GAME, rev: 8 }); });
    await screen.findAllByText('Shift list renders');
    expect(calls.filter((c) => c.url.endsWith('/build/state')).length).toBeGreaterThan(before);
  });

  test('the connected chip reads from state.agent', async () => {
    await openRoom(hostState());
    expect(screen.getByTestId('brm-agentchip')).toHaveTextContent(/Claude Code connected · active \d+s ago/);
  });
});

describe('each ask status', () => {
  test('proposed: a review card the room cannot see, with Open and Discard', async () => {
    await openRoom(hostState({ asks: [{ ...CHOICE, Status: 'proposed' }] }));
    const card = screen.getByRole('region', { name: 'Proposed ask 3' });
    expect(within(card).getByText(/Proposed by Claude · not shown to the room/)).toBeInTheDocument();
    expect(within(card).getByText(stageHint({ status: 'proposed' }))).toBeInTheDocument();
    fireEvent.click(within(card).getByRole('button', { name: 'Open to the room' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(path(lastPost())).toBe(`games/${GAME}/build/asks/003`);
    expect(lastPost().body).toEqual({ action: 'open' });
  });

  test('proposed: an edited option is saved before the ask opens', async () => {
    await openRoom(hostState({ asks: [{ ...CHOICE, Status: 'proposed' }] }));
    fireEvent.change(screen.getByLabelText('Option B title'), { target: { value: 'Calm photo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open to the room' }));
    await waitFor(() => expect(posts()).toHaveLength(2));
    expect(posts()[0].body).toMatchObject({ action: 'edit', options: [{ title: 'Bold banner' }, { title: 'Calm photo' }] });
    expect(posts()[1].body).toEqual({ action: 'open' });
  });

  test('proposed: options with no preview say so, and Claude can be asked for mockups', async () => {
    await openRoom(hostState({ asks: [{ ...CHOICE, Status: 'proposed' }] }));
    const note = screen.getByTestId('brm-previews-missing');
    // A carries a preview link; only B has nothing to show.
    expect(note.textContent).toMatch(/No preview for option B yet\./);
    fireEvent.click(within(note).getByRole('button', { name: 'Ask Claude for mockups' }));
    await waitFor(() => expect(path(lastPost())).toBe(`games/${GAME}/build/directions`));
    expect(lastPost().body.text).toMatch(/^Before ask 3 opens to the room: make a quick mockup of option B, /);
    expect(lastPost().body.text).toContain('share_image (askId "003", label B)');
    await waitFor(() => expect(screen.getByTestId('brm-previews-missing').textContent).toMatch(/Asked Claude for mockups/));
    expect(within(screen.getByTestId('brm-previews-missing')).queryByRole('button')).toBeNull();
  });

  test('proposed: answer for the room — pick what they said; Claude gets the question and the answer', async () => {
    await openRoom(hostState({ asks: [{ ...CHOICE, Status: 'proposed' }] }));
    fireEvent.click(screen.getByRole('button', { name: 'Answer for the room' }));
    const panel = screen.getByRole('region', { name: 'Answer for the room' });
    const send = within(panel).getByRole('button', { name: /Send to Claude/ });
    expect(send).toBeDisabled(); // nothing picked, nothing written yet
    fireEvent.click(within(panel).getByRole('button', { name: 'B · Calm photo + calendar' }));
    expect(within(panel).getByLabelText('Direction for Claude').value).toBe('Which header should volunteers see first: Calm photo + calendar');
    fireEvent.click(send);
    await waitFor(() => expect(path(lastPost())).toBe(`games/${GAME}/build/asks/003`));
    expect(lastPost().body).toEqual({
      action: 'decide', direction: 'Which header should volunteers see first: Calm photo + calendar', chosen: ['B'], note: '', sendToAgent: true, spoken: true, method: 'spoken',
    });
  });

  test('live: answer for the room on a rating, without closing it first', async () => {
    await openRoom(hostState({
      st: { CurrentAskId: '005' },
      asks: [{ AskId: '005', Kind: 'rating', Prompt: 'How close is this?', Options: [], Scale: { min: 1, max: 5, lowLabel: 'Far', highLabel: 'There' }, Status: 'live' }],
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Answer for the room' }));
    const panel = screen.getByRole('region', { name: 'Answer for the room' });
    fireEvent.click(within(panel).getByRole('button', { name: '4' }));
    expect(within(panel).getByLabelText('Direction for Claude').value).toBe('How close is this: 4 out of 5 (5 is great, 1 needs work)');
    // Typing in the sentence stops it following the picks.
    fireEvent.change(within(panel).getByLabelText('Direction for Claude'), { target: { value: 'Four out of five: keep going, bigger dates.' } });
    fireEvent.click(within(panel).getByRole('button', { name: '5 · Great' }));
    expect(within(panel).getByLabelText('Direction for Claude').value).toBe('Four out of five: keep going, bigger dates.');
    fireEvent.click(within(panel).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('region', { name: 'Answer for the room' })).toBeNull();
  });

  test('proposed: every option previewed, no notice', async () => {
    const withPreviews = { ...CHOICE, Options: CHOICE.Options.map((o) => ({ ...o, url: `http://localhost:5173/${o.label.toLowerCase()}` })) };
    await openRoom(hostState({ asks: [{ ...withPreviews, Status: 'proposed' }] }));
    expect(screen.getByRole('button', { name: 'Open to the room' })).toBeInTheDocument();
    expect(screen.queryByTestId('brm-previews-missing')).toBeNull();
  });

  test('proposed: Discard', async () => {
    await openRoom(hostState({ asks: [{ ...CHOICE, Status: 'proposed' }] }));
    fireEvent.click(within(screen.getByRole('region', { name: 'Proposed ask 3' })).getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(lastPost().body).toEqual({ action: 'discard' }));
  });

  test('live choice: letters, live counts, and Close', async () => {
    await openRoom(hostState({ st: { CurrentAskId: '003' }, asks: [{ ...CHOICE, Status: 'live' }], answers: CHOICE_ANSWERS }));
    const stage = screen.getByRole('region', { name: 'Current ask' });
    expect(within(stage).getByText('Which header should volunteers see first?')).toBeInTheDocument();
    expect(within(stage).getByText('Calm photo + calendar')).toBeInTheDocument();
    expect(within(stage).getByText('67%')).toBeInTheDocument();
    fireEvent.click(within(stage).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(lastPost().body).toEqual({ action: 'close' }));
    expect(path(lastPost())).toBe(`games/${GAME}/build/asks/003`);
  });

  test('live ideas: suggestions with names for the host, Hide, and adding what the room said', async () => {
    await openRoom(hostState({ st: { CurrentAskId: '004' }, asks: [{ ...IDEAS_ASK, Status: 'live' }], resps: IDEAS_RESPS }));
    expect(screen.getByText('Having to make an account')).toBeInTheDocument();
    expect(screen.getByText('Ana')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Hide' })[0]);
    await waitFor(() => expect(path(lastPost())).toBe(`games/${GAME}/build/asks/004/responses/r1`));
    expect(lastPost().body).toEqual({ action: 'hide' });

    fireEvent.change(screen.getByLabelText('Add what the room said'), { target: { value: 'Parking is unclear' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(path(lastPost())).toBe(`games/${GAME}/build/asks/004/responses`));
    expect(lastPost().body).toEqual({ text: 'Parking is unclear' });

    fireEvent.click(screen.getByRole('button', { name: 'Open voting' }));
    await waitFor(() => expect(lastPost().body).toEqual({ action: 'vote' }));
  });

  test('voting: the vote counts show', async () => {
    await openRoom(hostState({
      st: { CurrentAskId: '004' },
      asks: [{ ...IDEAS_ASK, Status: 'voting' }],
      resps: IDEAS_RESPS,
      votes: [{ AskId: '004', PlayerName: 'Sam', RespIds: ['r2'] }, { AskId: '004', PlayerName: 'Priya', RespIds: ['r2', 'r1'] }],
    }));
    expect(screen.getByText(/^Vote$/)).toBeInTheDocument();
    expect(screen.getByText(stageHint({ status: 'voting' }))).toBeInTheDocument();
    const row = screen.getByText('Not seeing open shifts').closest('li');
    expect(within(row).getByText('2')).toBeInTheDocument();
  });

  test('results: bars, reasons with names, and a direction prefilled from the winner', async () => {
    await openRoom(hostState({ st: { CurrentAskId: '003' }, asks: [{ ...CHOICE, Status: 'results' }], answers: CHOICE_ANSWERS }));
    const reasons = screen.getByText('Reasons').closest('div');
    expect(within(reasons).getByText('Dates first')).toBeInTheDocument();
    expect(within(reasons).getByText('Sam')).toBeInTheDocument();
    const box = screen.getByRole('textbox', { name: 'Direction for Claude' });
    expect(box.value).toBe('Which header should volunteers see first: Calm photo + calendar');

    fireEvent.click(screen.getByRole('button', { name: /Big button/ }));
    expect(box.value).toBe('Which header should volunteers see first: Calm photo + calendar. Big button');

    fireEvent.click(within(screen.getByRole('region', { name: 'Direction for Claude' })).getByRole('button', { name: 'Send to Claude' }));
    await waitFor(() => expect(lastPost().body).toMatchObject({ action: 'decide' }));
    expect(path(lastPost())).toBe(`games/${GAME}/build/asks/003`);
    expect(lastPost().body).toEqual({
      action: 'decide', direction: 'Which header should volunteers see first: Calm photo + calendar. Big button', chosen: ['B'], note: '', sendToAgent: true, method: 'vote',
    });
  });

  test('results: switching Send to Claude off records the decision only', async () => {
    await openRoom(hostState({ st: { CurrentAskId: '003' }, asks: [{ ...CHOICE, Status: 'results' }], answers: CHOICE_ANSWERS }));
    fireEvent.click(screen.getByRole('switch', { name: 'Send to Claude' }));
    fireEvent.click(screen.getByRole('button', { name: 'Record decision' }));
    await waitFor(() => expect(lastPost().body).toMatchObject({ action: 'decide', sendToAgent: false }));
  });

  test('results of a rating: the average and the distribution', async () => {
    await openRoom(hostState({
      st: { CurrentAskId: '005' },
      asks: [{ AskId: '005', Kind: 'rating', Prompt: 'How close is this?', Options: [], Scale: { min: 1, max: 5, lowLabel: 'Far', highLabel: 'There' }, Status: 'results' }],
      answers: [
        { AskId: '005', PlayerName: 'Ana', Rating: 4, Why: 'Warmer colours please' },
        { AskId: '005', PlayerName: 'Sam', Rating: 3 },
      ],
    }));
    expect(screen.getByText('3.5')).toBeInTheDocument();
    expect(within(screen.getByText('Reasons').closest('div')).getByText('Warmer colours please')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Direction for Claude' }).value).toBe('How close is this: 3.5 out of 5 (5 is great, 1 needs work)');
  });

  test('between asks: Claude is building, with the latest decision and the ticker', async () => {
    await openRoom(hostState({
      asks: [{ ...CHOICE, Status: 'decided', DecidedAt: ago(240), Decision: { direction: 'Go with B, keep A\'s logo', chosen: ['B'], note: '' } }],
      answers: CHOICE_ANSWERS,
      logs: [
        { Kind: 'progress', Text: 'Moved the logo into header B', By: 'agent' },
        { Kind: 'showing', Text: 'Header B is live', By: 'agent', Link: 'http://localhost:5173/' },
      ],
    }));
    // The Host screen's Now card carries the latest decision (C1)...
    expect(within(screen.getByRole('region', { name: 'Now' })).getByText('Go with B, keep A\'s logo')).toBeInTheDocument();
    // ...and the room sees Claude building, with its ticker, on the Stage screen.
    fireEvent.keyDown(window, { key: '2' });
    const stage = screen.getByRole('region', { name: 'Claude is building' });
    expect(within(stage).getByText('Claude is building…')).toBeInTheDocument();
    expect(within(stage).getByText('Go with B, keep A\'s logo')).toBeInTheDocument();
    expect(within(stage).getByText('Header B is live')).toBeInTheDocument();
    // Claude's local link is a button the host opens on this laptop.
    const open = within(stage).getByRole('link', { name: 'Open' });
    expect(open).toHaveAttribute('href', 'http://localhost:5173/');
    expect(open).toHaveAttribute('target', '_blank');
  });

  test('an empty room shows how a Build Room works', async () => {
    await openRoom(hostState({ st: { AgentSeenAt: undefined } }));
    expect(screen.getByRole('heading', { name: 'How a Build Room works' })).toBeInTheDocument();
    expect(screen.getByText('Paste the Kick off prompt into Claude Code.')).toBeInTheDocument();
  });
});

describe('the host side panel', () => {
  test('logging what the room said, and telling Claude too', async () => {
    await openRoom(hostState());
    // The one composer logs it (C1): "Room said" is the default kind.
    fireEvent.change(screen.getByLabelText(/log what the room said/i), { target: { value: 'Colours are too dark' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Also tell Claude' }));
    fireEvent.click(screen.getByRole('button', { name: 'Log it' }));
    await waitFor(() => expect(path(lastPost())).toBe(`games/${GAME}/build/log`));
    expect(lastPost().body).toEqual({ kind: 'verbal', text: 'Colours are too dark', forAgent: true });
  });

  test('a timeline entry can be edited and deleted', async () => {
    await openRoom(hostState({ logs: [{ Kind: 'verbal', Text: 'Most of us use phones', By: 'host' }] }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit "Most of us use phones"' }));
    fireEvent.change(screen.getByLabelText('Edit entry'), { target: { value: 'Nearly all of us use phones' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(path(lastPost())).toBe(`games/${GAME}/build/log/0-x0`));
    expect(lastPost().body).toEqual({ action: 'edit', text: 'Nearly all of us use phones' });

    fireEvent.click(await screen.findByRole('button', { name: 'Delete "Most of us use phones"' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(lastPost().body).toEqual({ action: 'delete' }));
  });

  test('ideas inbox: Send to Claude, and Dismiss', async () => {
    await openRoom(hostState({ ideas: [{ PlayerName: 'Jordan', Text: 'A map link for parking' }] }));
    const inbox = screen.getByRole('region', { name: /Ideas inbox/ });
    fireEvent.click(within(inbox).getByRole('button', { name: 'Send to Claude' }));
    await waitFor(() => expect(path(lastPost())).toBe(`games/${GAME}/build/ideas/0-i0`));
    expect(lastPost().body).toEqual({ action: 'direct' });
    const dismiss = within(inbox).getByRole('button', { name: 'Dismiss' });
    await waitFor(() => expect(dismiss).not.toBeDisabled());
    fireEvent.click(dismiss);
    await waitFor(() => expect(lastPost().body).toEqual({ action: 'dismiss' }));
  });

  test('the host asks the room: a Choose ask', async () => {
    await openRoom(hostState());
    fireEvent.click(screen.getByRole('button', { name: /Choose/ }));
    const dialog = screen.getByRole('dialog', { name: 'Ask the room' });
    fireEvent.change(within(dialog).getByLabelText(/Question/), { target: { value: 'Which colour?' } });
    fireEvent.change(within(dialog).getByLabelText('Option A'), { target: { value: 'Green' } });
    fireEvent.change(within(dialog).getByLabelText('Option B'), { target: { value: 'Blue' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ask the room' }));
    await waitFor(() => expect(path(lastPost())).toBe(`games/${GAME}/build/asks`));
    expect(lastPost().body).toEqual({
      kind: 'choice', prompt: 'Which colour?', detail: '', options: [{ title: 'Green', url: '' }, { title: 'Blue', url: '' }],
    });
  });

  test('End session posts games/{id}/end', async () => {
    await openRoom(hostState());
    openMore();
    fireEvent.click(screen.getByRole('button', { name: 'End session' }));
    const dialog = screen.getByRole('dialog', { name: 'End this session?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'End session' }));
    await waitFor(() => expect(path(lastPost())).toBe(`games/${GAME}/end`));
  });

  test('Wrap up saves the outcome', async () => {
    await openRoom(hostState());
    openMore();
    fireEvent.click(screen.getByRole('button', { name: 'Wrap up' }));
    const dialog = screen.getByRole('dialog', { name: 'Wrap up' });
    fireEvent.change(within(dialog).getByLabelText('Summary'), { target: { value: 'A sign-up site.' } });
    fireEvent.change(within(dialog).getByLabelText(/What we built/), { target: { value: 'Shift list\nForm' } });
    fireEvent.change(within(dialog).getByLabelText(/Links/), { target: { value: 'Repo | https://github.com/x/y' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save wrap-up' }));
    await waitFor(() => expect(path(lastPost())).toBe(`games/${GAME}/build/outcome`));
    expect(lastPost().body).toEqual({
      summary: 'A sign-up site.', built: ['Shift list', 'Form'], links: [{ label: 'Repo', url: 'https://github.com/x/y' }], nextSteps: [],
    });
  });
});

describe('Connect Claude Code', () => {
  test('the key is shown once, inside a command with the real API base', async () => {
    await openRoom(hostState());
    fireEvent.click(screen.getAllByRole('button', { name: /Connect Claude Code/ })[0]);
    const dialog = screen.getByRole('dialog', { name: 'Connect Claude Code' });
    // The four steps, in the order they are done (owner, 2026-10-04).
    const titles = [...dialog.querySelectorAll('.brm-step-title')].map((n) => n.textContent);
    expect(titles).toEqual([
      'Check for the latest Engage plugin',
      'Mint a key and copy the connect command',
      'Start Claude Code in your project folder and paste the command',
      'Kick off',
    ]);
    expect(within(dialog).getByTestId('brm-kickoff').textContent).toBe('/engage:kickoff');
    const writeText = jest.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Mint a key and copy the command' }));
    await waitFor(() => expect(path(lastPost())).toBe(`games/${GAME}/build/keys`));
    const command = await within(dialog).findByTestId('brm-command');
    const key = `eng_${GAME}_${'k'.repeat(43)}`;
    // One click mints AND copies the line to paste into Claude Code.
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`/engage:connect ${key}`));
    expect(within(dialog).getByRole('status').textContent).toMatch(/^Copied\. Paste it into Claude Code\./);
    delete navigator.clipboard;
    expect(command.textContent).toContain(`--env ENGAGE_KEY=${key}`);
    expect(command.textContent).toContain(`--env ENGAGE_API=${API}`);
    expect(command.textContent).toContain(`curl -fsSL ${window.location.origin}/engage-mcp.mjs -o ~/.engage-mcp.mjs`);
    expect(command.textContent).toContain('claude mcp add engage');
    expect(within(dialog).getByText(/This key is shown once/)).toBeInTheDocument();
    // The plugin route: install once (no key in it), then one line per session.
    const install = within(dialog).getByTestId('brm-install');
    expect(install.textContent).toContain(`curl -fsSL ${window.location.origin}/engage-mcp.mjs -o ~/.engage-mcp.mjs`);
    expect(install.textContent).toContain(`node ~/.engage-mcp.mjs --install-plugin --api ${API}`);
    expect(install.textContent).not.toContain(key);
    expect(within(dialog).getByTestId('brm-connect').textContent).toBe(`/engage:connect ${key}`);

    // Close, reopen: gone.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    fireEvent.click(screen.getAllByRole('button', { name: /Connect Claude Code/ })[0]);
    const again = screen.getByRole('dialog', { name: 'Connect Claude Code' });
    expect(within(again).queryByTestId('brm-command')).toBeNull();
    expect(within(again).queryByTestId('brm-connect')).toBeNull();
    expect(within(again).getByTestId('brm-install')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(key);
  });

  test('revoke, the review setting, and the six prompt cards with their slash commands', async () => {
    await openRoom(hostState({ keys: [{ KeyId: 'abc123def456', Label: 'Claude Code', CreatedAt: ago(300) }] }));
    openMore();
    fireEvent.click(screen.getByRole('button', { name: /Connect Claude Code/ }));
    const dialog = screen.getByRole('dialog', { name: 'Connect Claude Code' });
    ['/engage:kickoff', '/engage:ideas', '/engage:ab-mockups', '/engage:continue', '/engage:preview', '/engage:wrap-up', '/engage:share-repo', '/mcp__engage__kickoff'].forEach((slash) => {
      expect(within(dialog).getAllByText(slash, { exact: false }).length).toBeGreaterThan(0);
    });
    // Step 1 (install) and step 4 (kick off), then one per prompt card.
    expect(within(dialog).getAllByRole('button', { name: 'Copy' })).toHaveLength(2 + 7);
    expect(within(dialog).queryByTestId('brm-share-repo')).toBeNull(); // not a crew room

    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Review Claude's questions/ }));
    await waitFor(() => expect(path(lastPost())).toBe(`games/${GAME}/build/settings`));
    expect(lastPost().body).toEqual({ reviewAgentAsks: false });

    const revoke = within(dialog).getByRole('button', { name: 'Revoke key' });
    await waitFor(() => expect(revoke).not.toBeDisabled());
    fireEvent.click(revoke);
    await waitFor(() => expect(path(lastPost())).toBe(`games/${GAME}/build/keys/abc123def456/revoke`));
  });

  const panel = (room, api = {}) => render(
    <ConnectPanel room={{ settings: {}, ...room }} gameId={GAME} api={{ mintKey: jest.fn(() => Promise.resolve({ key: `eng_${GAME}_${'n'.repeat(43)}`, keyId: 'k2' })), revokeKey: jest.fn(), saveSettings: jest.fn(), ...api }} run={(fn) => fn()} busy={false} onClose={() => {}} />,
  );

  test('a crew room adds a fifth step: share the repo', () => {
    panel({ agent: {}, crew: { enabled: true } });
    const titles = [...document.querySelectorAll('.brm-step-title')].map((n) => n.textContent);
    expect(titles[4]).toBe('Open the project to your crew');
    expect(screen.getByTestId('brm-share-repo').textContent).toBe('/engage:share-repo');
  });

  test('with Claude connected on a live key, minting again warns that it disconnects', async () => {
    const mintKey = jest.fn(() => Promise.resolve({ key: `eng_${GAME}_${'n'.repeat(43)}`, keyId: 'k2' }));
    panel({ agent: { lastSeenAt: ago(5), key: { keyId: 'k1', createdAt: ago(600) } } }, { mintKey });
    expect(screen.getByText(/Claude Code is connected with the current key/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Mint a new key and copy the command' }));
    expect(mintKey).not.toHaveBeenCalled();
    expect(screen.getByText(/Claude Code disconnects until you paste the new command/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(mintKey).not.toHaveBeenCalled();
  });
});

describe('after Claude wraps up, and what next', () => {
  const OUTCOME = {
    summary: 'A one-page sign-up site with live open spots.',
    built: ['Five sample events', 'Sign-up form'],
    links: [{ label: 'Demo', url: 'http://localhost:5173/' }, { label: 'Repository', url: 'https://github.com/x/y' }],
    nextSteps: ['Send a confirmation text'],
    by: 'agent',
    updatedAt: NOW,
  };

  test('the stage says what we built, with the demo one click away', async () => {
    await openRoom(hostState({ st: { Outcome: OUTCOME } }));
    const stage = screen.getByRole('region', { name: 'What we built' });
    expect(screen.queryByText('Claude is building…')).toBeNull();
    expect(within(stage).getByText('A one-page sign-up site with live open spots.')).toBeInTheDocument();
    expect(within(stage).getByRole('link', { name: 'Demo' })).toHaveAttribute('href', 'http://localhost:5173/');
    expect(within(stage).getByRole('link', { name: 'Repository' })).toHaveAttribute('href', 'https://github.com/x/y');
    expect(within(stage).getByText('Five sample events')).toBeInTheDocument();
    expect(within(stage).getByText('Send a confirmation text')).toBeInTheDocument();
  });

  test('a choice offers Open A / Open B for each running variant', async () => {
    await openRoom(hostState({ st: { CurrentAskId: '003' }, asks: [{ ...CHOICE, Status: 'live' }] }));
    expect(screen.getByRole('link', { name: 'Open A' })).toHaveAttribute('href', 'http://localhost:5173/a');
  });

  test('Tell Claude posts a direction and says honestly when Claude will read it', async () => {
    await openRoom(hostState({ st: { AgentListeningAt: ago(3) } }));
    expect(screen.getByTestId('brm-agentchip').textContent).toBe('Claude Code is listening for you');
    const panel = screen.getByRole('region', { name: 'Add something' });
    expect(within(panel).getByText('Claude is listening. It will act on this straight away.')).toBeInTheDocument();
    fireEvent.change(within(panel).getByLabelText(/Tell Claude/), { target: { value: 'Make the button green' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Send to Claude' }));
    await waitFor(() => expect(path(lastPost())).toBe(`games/${GAME}/build/directions`));
    expect(lastPost().body).toEqual({ text: 'Make the button green' });
    ['Ideas', 'Choose', 'Rate'].forEach((k) => expect(within(panel).getByRole('button', { name: new RegExp(`^${k}`) })).toBeInTheDocument());
  });

  test('when Claude has gone quiet, the panel offers the Continue prompt', async () => {
    await openRoom(hostState({ st: { AgentSeenAt: ago(3600) } }));
    expect(within(screen.getByRole('region', { name: 'Add something' })).getByText(/If it has stopped, paste the Continue prompt/)).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Now' })).getByRole('button', { name: /Copy the Continue prompt/ })).toBeInTheDocument();
  });
});

describe('the Stage screen (was Present mode)', () => {
  const busyRoom = () => hostState({
    st: { CurrentAskId: '004' },
    asks: [{ ...IDEAS_ASK, Status: 'live' }, { ...CHOICE, AskId: '005', Status: 'proposed' }],
    resps: [...IDEAS_RESPS, { AskId: '004', RespId: 'r3', Text: 'Something rude', PlayerName: 'Troll', Hidden: true }],
    logs: [{ Kind: 'note', Text: 'Ask Dee about parking later', By: 'host' }, { Kind: 'verbal', Text: 'Phones mostly', By: 'host' }],
    ideas: [{ PlayerName: 'Jordan', Text: 'Dark mode' }],
  });

  test('hides every host-only control, the inbox, notes, names, hidden suggestions and proposed asks', async () => {
    await openRoom(busyRoom());
    expect(screen.getByText('Ask Dee about parking later')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Stage' }));

    expect(screen.queryByRole('region', { name: /Ideas inbox/ })).toBeNull();
    expect(screen.queryByText('Ask Dee about parking later')).toBeNull();
    expect(screen.queryByText('Something rude')).toBeNull();
    expect(screen.queryByText('Ana')).toBeNull();
    expect(screen.queryByRole('region', { name: /Proposed ask/ })).toBeNull();
    ['Close', 'Discard', 'Hide', 'Wrap up', 'End session', 'Log'].forEach((name) => {
      expect(screen.queryByRole('button', { name })).toBeNull();
    });
    // The one move the room may see the host make: the dock's, as on the regular stage (C6).
    expect(within(document.querySelector('footer.dock')).getByRole('button', { name: 'Open voting' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Connect Claude Code/ })).toBeNull();
    expect(screen.queryByText(stageHint({ status: 'live', kind: 'suggest' }))).toBeNull();
    // The wall still has the question, the suggestions and the timeline.
    const stage = screen.getByRole('region', { name: 'Current ask' });
    expect(within(stage).getByText('What would stop someone signing up?')).toBeInTheDocument();
    expect(within(stage).getByText('Not seeing open shifts')).toBeInTheDocument();
    expect(screen.queryByText('Which header should volunteers see first?')).toBeNull();
    // The room's timeline lives on the History screen now.
    fireEvent.keyDown(window, { key: '4' });
    expect(screen.getByText('Phones mostly')).toBeInTheDocument();
  });

  test('the wall timeline is the room\'s: newest first, no system entries, no host note or idea author', async () => {
    await openRoom(hostState({
      logs: [
        { Kind: 'ask', Text: 'Asked the room: Which header?', By: 'system' },
        { Kind: 'decision', Text: 'Use B with a bigger button', Detail: 'Marcus: small buttons are hard', By: 'host', ForAgent: true },
        { Kind: 'idea', Text: 'Add a parking map', Detail: 'from Jordan', By: 'room' },
        { Kind: 'progress', Text: 'Header B in place', By: 'agent' },
      ],
    }));
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    const tl = screen.getByRole('region', { name: 'Timeline' });
    const texts = within(tl).getAllByRole('listitem').map((li) => li.textContent);
    expect(texts.map((t) => ['Header B in place', 'Add a parking map', 'Use B with a bigger button'].find((x) => t.includes(x)))).toEqual(['Header B in place', 'Add a parking map', 'Use B with a bigger button']);
    expect(within(tl).queryByText(/Asked the room/)).toBeNull();
    expect(within(tl).queryByText(/from Jordan/)).toBeNull();
    expect(within(tl).queryByText(/small buttons are hard/)).toBeNull();
  });

  test('the P key toggles it, but not while typing', async () => {
    await openRoom(busyRoom());
    const log = screen.getByLabelText(/log what the room said/i);
    fireEvent.keyDown(log, { key: 'p' });
    expect(screen.getByRole('region', { name: /Ideas inbox/ })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'p' });
    expect(screen.queryByRole('region', { name: /Ideas inbox/ })).toBeNull();
    fireEvent.keyDown(window, { key: 'P' });
    expect(screen.getByRole('region', { name: /Ideas inbox/ })).toBeInTheDocument();
  });
});

describe('untrusted text', () => {
  test('markup from Claude stays text, and a javascript: link never becomes a link', async () => {
    await openRoom(hostState({
      logs: [{ Kind: 'showing', Text: '<img src=x onerror=alert(1)>', By: 'agent', Link: 'javascript:alert(1)' }],
    }));
    expect(screen.getAllByText('<img src=x onerror=alert(1)>').length).toBeGreaterThan(0);
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('a[href^="javascript"]')).toBeNull();
  });
});

describe('the report view', () => {
  test('?view=report opens the report, and Back returns to the room', async () => {
    serve(hostState());
    window.history.pushState({}, '', `/build?gameId=${GAME}&view=report`);
    render(<BuildRoomPage />);
    expect(await screen.findByRole('button', { name: /^Print$/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Back to room/ }));
    expect(await screen.findByRole('button', { name: 'Stage' })).toBeInTheDocument();
  });

  test('the Report button opens it', async () => {
    await openRoom(hostState());
    openMore();
    fireEvent.click(screen.getByRole('button', { name: 'Report' }));
    expect(await screen.findByRole('heading', { name: 'What we built' })).toBeInTheDocument();
  });
});

describe('create', () => {
  test('/build with no gameId is the create form', () => {
    serve(hostState());
    window.history.pushState({}, '', '/build');
    render(<BuildRoomPage />);
    expect(screen.getByRole('heading', { name: 'New Build Room' })).toBeInTheDocument();
  });

  test('creates a build session, starts it, then opens the room', async () => {
    calls = [];
    authFetch.mockImplementation(async (url, opts = {}) => {
      calls.push({ url, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : undefined });
      if (url.endsWith('games')) return res({ gameId: '5150' }, true, 201);
      return res({ success: true });
    });
    const navigate = jest.fn();
    render(<BuildCreate navigate={navigate} />);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Food bank' } });
    fireEvent.change(screen.getByLabelText(/Goal/), { target: { value: 'Pick a shift fast' } });
    fireEvent.click(screen.getByLabelText(/Private/));
    fireEvent.change(screen.getByLabelText('Access code'), { target: { value: 'beans' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create room' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/build?gameId=5150'));
    expect(calls[0]).toMatchObject({ url: `${API}games`, method: 'POST' });
    expect(calls[0].body).toEqual({
      eventTitle: 'Food bank', engagementInfo: 'Pick a shift fast', gameType: 'build', visibility: 'private', accessCode: 'beans',
    });
    expect(calls[1]).toMatchObject({ url: `${API}games/5150/start`, method: 'POST' });
  });

  test('switching review off saves the setting after create', async () => {
    calls = [];
    authFetch.mockImplementation(async (url, opts = {}) => {
      calls.push({ url, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : undefined });
      if (url.endsWith('games')) return res({ gameId: '5150' }, true, 201);
      return res({});
    });
    const navigate = jest.fn();
    render(<BuildCreate navigate={navigate} />);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Food bank' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /Review Claude's questions/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Create room' }));
    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(calls[2]).toMatchObject({ url: `${API}games/5150/build/settings`, body: { reviewAgentAsks: false } });
  });
});


describe('the connection (owner, 2026-10-04: a long wait left only "refresh the page")', () => {
  const socketSays = (up) => act(() => { webSocketClient.onConnectionStatusChange.mock.calls.slice(-1)[0][0](up); });

  test('Connecting, then Live, then Disconnected with one click to reconnect', async () => {
    await openRoom(hostState());
    expect(screen.getByTestId('brm-conn').textContent).toBe('Connecting…');
    socketSays(true);
    expect(screen.getByTestId('brm-conn').textContent).toBe('Live');
    socketSays(false);
    const chip = screen.getByRole('button', { name: 'Disconnected · Reconnect' });
    const before = calls.filter((c) => c.url.endsWith('/build/state')).length;
    fireEvent.click(chip);
    await waitFor(() => expect(webSocketClient.ensureConnected).toHaveBeenCalled());
    await waitFor(() => expect(calls.filter((c) => c.url.endsWith('/build/state')).length).toBeGreaterThan(before));
  });

  test('waking the laptop or coming back online reconnects without a reload', async () => {
    await openRoom(hostState());
    webSocketClient.ensureConnected.mockClear();
    act(() => { window.dispatchEvent(new Event('online')); });
    expect(webSocketClient.ensureConnected).toHaveBeenCalledTimes(1);
    act(() => { window.dispatchEvent(new Event('focus')); });
    expect(webSocketClient.ensureConnected).toHaveBeenCalledTimes(2);
  });

  test('a sign-in that has run out says so, and Sign in again comes back to this room', async () => {
    await openRoom(hostState());
    try {
      getAuthToken.mockImplementation(async () => null);
      authFetch.mockImplementation(async () => res({ message: 'Unauthorized' }, false, 401));
      act(() => { window.dispatchEvent(new Event('focus')); });
      const chip = await screen.findByRole('button', { name: 'Signed out · Sign in again' });
      fireEvent.click(chip);
      await waitFor(() => expect(reloadPage).toHaveBeenCalled());
      expect(sessionStorage.getItem('authReturnTo')).toBe(`/build?gameId=${GAME}`);
    } finally {
      sessionStorage.removeItem('authReturnTo');
    }
  });

  test('a request that never reached the server offers Reconnect, and clears once the room loads again', async () => {
    await openRoom(hostState({ asks: [{ ...CHOICE, Status: 'proposed' }] }));
    const working = authFetch.getMockImplementation();
    authFetch.mockImplementation(async (url, opts = {}) => {
      if ((opts.method || 'GET') === 'POST') throw new TypeError('Failed to fetch');
      return working(url, opts);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    const bar = await screen.findByRole('alert');
    expect(bar.textContent).toMatch(/did not reach the server/);
    expect(within(bar).getByRole('button', { name: 'Reconnect' })).toBeInTheDocument();
    authFetch.mockImplementation(working);
    fireEvent.click(within(bar).getByRole('button', { name: 'Reconnect' }));
    await waitFor(() => expect(screen.queryByText(/did not reach the server/)).toBeNull());
  });
});

describe('the join QR and link (owner, 2026-10-04)', () => {
  test('the join code shows the QR big; a click anywhere puts it away; the link copies the full URL', async () => {
    await openRoom(hostState());
    const writeText = jest.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    try {
      // The header's join code opens it (the join block under the stage is gone, owner 2026-10-05).
      fireEvent.click(screen.getByRole('button', { name: `Join code ${GAME}. Show the QR code` }));
      const big = screen.getByRole('dialog', { name: 'Join QR code' });
      const full = `${window.location.origin}/play?gameId=${GAME}`;
      // The link copies, and does NOT close the big QR.
      fireEvent.click(within(big).getByRole('button', { name: `Copy the join link ${full}` }));
      await waitFor(() => expect(writeText).toHaveBeenCalledWith(full));
      expect(screen.getByRole('dialog', { name: 'Join QR code' })).toBeInTheDocument();
      // A click anywhere else (here: on the code itself) closes it.
      fireEvent.click(within(big).getByRole('img'));
      expect(screen.queryByRole('dialog', { name: 'Join QR code' })).toBeNull();
    } finally {
      delete navigator.clipboard;
    }
  });
});


describe('what Claude is doing, the preview button and Auto (owner, 2026-10-04)', () => {
  test('the live activity: the newest line leads, the host sees the last few, a socket message updates it with no refetch', async () => {
    await openRoom(hostState({ activity: [
      { at: ago(40), kind: 'read', text: 'Read App.jsx' },
      { at: ago(10), kind: 'edit', text: 'Edited Header.jsx' },
    ] }));
    expect(screen.getByTestId('brm-activity-now').textContent).toMatch(/^Edited Header\.jsx/);
    expect(screen.getByText('Read App.jsx')).toBeInTheDocument();
    const statesBefore = calls.filter((c) => c.url.endsWith('/build/state')).length;
    const onActivity = webSocketClient.onMessage.mock.calls.filter(([type]) => type === 'buildActivity').pop()[1];
    act(() => { onActivity({ gameId: GAME, items: [{ at: ago(1), kind: 'run', text: 'Ran npm test' }] }); });
    expect(screen.getByTestId('brm-activity-now').textContent).toMatch(/^Ran npm test/);
    expect(calls.filter((c) => c.url.endsWith('/build/state')).length).toBe(statesBefore);
  });

  test('Preview the work sends Claude the preview instructions', async () => {
    await openRoom(hostState());
    fireEvent.click(screen.getByRole('button', { name: /Preview the work/ }));
    await waitFor(() => expect(path(lastPost())).toBe(`games/${GAME}/build/directions`));
    expect(lastPost().body.text).toMatch(/^Show the room the work so far, running\./);
    expect(lastPost().body.text).toContain('post_update with kind "showing"');
  });

  test('Auto-open Claude\'s questions saves the setting the other way round', async () => {
    await openRoom(hostState());
    openMore();
    fireEvent.click(screen.getByRole('switch', { name: /Auto-open Claude's questions/ }));
    await waitFor(() => expect(path(lastPost())).toBe(`games/${GAME}/build/settings`));
    expect(lastPost().body).toEqual({ reviewAgentAsks: false });
  });
});

describe('the four screens (owner, 2026-10-05: "yes to the shape")', () => {
  const busy = () => hostState({
    st: { CurrentAskId: '003' },
    asks: [{ ...CHOICE, Status: 'live' }, { ...IDEAS_ASK, AskId: '005', Status: 'proposed' }],
    answers: CHOICE_ANSWERS,
    logs: [
      { Kind: 'note', Text: 'Ask Dee about parking later', By: 'host' },
      { Kind: 'showing', Text: 'The shift calendar is up', By: 'agent', Link: 'http://localhost:5173/' },
    ],
    ideas: [{ PlayerName: 'Jordan', Text: 'Dark mode' }],
  });

  test('Host, Stage, Build and History in the header; Host counts what waits, as a number', async () => {
    await openRoom(busy());
    const nav = screen.getByRole('navigation', { name: 'Screens' });
    expect(within(nav).getAllByRole('button').map((b) => b.textContent)).toEqual(['Host2 waiting', 'Stage', 'Build', 'History']);
    expect(within(nav).getByRole('button', { name: /^Host/ })).toHaveAttribute('aria-pressed', 'true');
  });

  test('the ask pill names the open ask and its count, and opens the Stage', async () => {
    await openRoom(busy());
    const pill = screen.getByRole('button', { name: 'Ask 3 · 3 of 4' });
    fireEvent.click(pill);
    expect(screen.getByRole('region', { name: 'Current ask' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Host screen' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^More/ })).toBeNull();
  });

  test('keys 1 to 4 pick a screen, never while typing', async () => {
    await openRoom(busy());
    fireEvent.keyDown(screen.getByLabelText(/log what the room said/i), { key: '3' });
    expect(screen.getByRole('button', { name: /^Host/ })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.keyDown(window, { key: '3' });
    expect(screen.getByRole('region', { name: 'The build' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: '4' });
    expect(screen.getByRole('heading', { name: 'Decided so far' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: '1' });
    expect(screen.getByRole('region', { name: /Ideas inbox/ })).toBeInTheDocument();
  });

  test('P flips between Host and the last screen the room saw', async () => {
    await openRoom(busy());
    fireEvent.keyDown(window, { key: '3' });
    fireEvent.keyDown(window, { key: 'p' });
    expect(screen.getByRole('button', { name: /^Host/ })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.keyDown(window, { key: 'p' });
    expect(screen.getByRole('button', { name: 'Build' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('Build: the newest screenshot and the running build, opened on this laptop', async () => {
    await openRoom(busy());
    fireEvent.click(screen.getByRole('button', { name: 'Build' }));
    const build = screen.getByRole('region', { name: 'The build' });
    expect(within(build).getByRole('link', { name: /Open the build/ })).toHaveAttribute('href', 'http://localhost:5173/');
    expect(within(build).getByText(/Nothing to show yet/)).toBeInTheDocument();
  });

  test('History: the room\'s timeline and decisions, no host note, nothing to edit', async () => {
    await openRoom(hostState({
      asks: [{ ...CHOICE, Status: 'decided', Decision: { direction: 'Which header should volunteers see first: Calm photo + calendar' }, DecidedAt: ago(60) }],
      logs: [{ Kind: 'note', Text: 'Ask Dee about parking later', By: 'host' }, { Kind: 'progress', Text: 'Header B in place', By: 'agent' }],
    }));
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    expect(screen.getByText('Which header should volunteers see first: Calm photo + calendar')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Timeline' })).getByText('Header B in place')).toBeInTheDocument();
    expect(screen.queryByText('Ask Dee about parking later')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Edit/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Delete/ })).toBeNull();
  });

  test('a screen the room sees carries no proposed ask, idea, note or session control', async () => {
    await openRoom(busy());
    ['2', '3', '4'].forEach((key) => {
      fireEvent.keyDown(window, { key });
      expect(screen.queryByText('Dark mode')).toBeNull();
      expect(screen.queryByText('Ask Dee about parking later')).toBeNull();
      expect(screen.queryByText('What would stop someone signing up?')).toBeNull();
      expect(screen.queryByRole('button', { name: /^More/ })).toBeNull();
      expect(screen.queryByTestId('brm-conn')).toBeNull();
    });
  });

  test('the session menu holds the once-a-session controls and closes on Escape', async () => {
    await openRoom(busy());
    expect(screen.queryByRole('button', { name: 'End session' })).toBeNull();
    openMore();
    const menu = screen.getByRole('group', { name: 'Session' });
    ['Connect Claude Code', 'Open to a crew', 'Wrap up', 'Report', 'End session'].forEach((name) => {
      expect(within(menu).getByRole('button', { name: new RegExp(name) })).toBeInTheDocument();
    });
    expect(within(menu).getByRole('switch', { name: /Auto-open Claude's questions/ })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('group', { name: 'Session' })).toBeNull();
  });

  test('the join code in the header shows the QR', async () => {
    await openRoom(busy());
    fireEvent.click(screen.getByRole('button', { name: `Join code ${GAME}. Show the QR code` }));
    expect(screen.getByRole('dialog', { name: 'Join QR code' })).toBeInTheDocument();
  });
});

describe('the Stage screen is the regular stage (rail, meter, dock)', () => {
  const live = () => hostState({ st: { CurrentAskId: '003' }, asks: [{ ...CHOICE, Status: 'live' }], answers: CHOICE_ANSWERS });

  test('the rail: the phase, the ask, the join address and code; the meter: answered of here', async () => {
    await openRoom(live());
    fireEvent.keyDown(window, { key: '2' });
    const rail = document.querySelector('header.rail');
    expect(rail.textContent).toMatch(/Answering/);
    expect(rail.textContent).toMatch(/Choose/);
    expect(rail.textContent).toMatch(/Ask 3/);
    expect(rail.textContent).toMatch(new RegExp(`JOIN.*${window.location.host}/play.*${GAME}`));
    expect(document.querySelector('.dock .status').textContent).toBe('3 of 4 have answered');
  });

  test('Space closes the ask from the dock', async () => {
    await openRoom(live());
    fireEvent.keyDown(window, { key: '2' });
    expect(within(document.querySelector('footer.dock')).getByRole('button', { name: 'Close and show results' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: ' ' });
    await waitFor(() => expect(path(lastPost())).toBe(`games/${GAME}/build/asks/003`));
    expect(lastPost().body).toEqual({ action: 'close' });
  });

  test('at results the winning vote is the button, back to the Host to decide; HOST at the dock\'s edge goes back too', async () => {
    await openRoom(hostState({ st: { CurrentAskId: '003' }, asks: [{ ...CHOICE, Status: 'results' }], answers: CHOICE_ANSWERS }));
    fireEvent.keyDown(window, { key: '2' });
    fireEvent.click(screen.getByRole('button', { name: 'Go with B' }));
    expect(screen.getByRole('textbox', { name: 'Direction for Claude' }).value).toBe('Which header should volunteers see first: Calm photo + calendar');
    fireEvent.keyDown(window, { key: '2' });
    fireEvent.click(screen.getByRole('button', { name: 'Host screen' }));
    expect(screen.getByRole('button', { name: /^Host/ })).toHaveAttribute('aria-pressed', 'true');
  });

  test('the rail\'s join code shows the QR', async () => {
    await openRoom(live());
    fireEvent.keyDown(window, { key: '2' });
    fireEvent.click(screen.getByRole('button', { name: `Session code ${GAME}. Show the join QR code` }));
    expect(screen.getByRole('dialog', { name: 'Join QR code' })).toBeInTheDocument();
  });
});

describe('the Host screen: Now, Waiting for you, what happened (C1)', () => {
  test('three columns: Now with the one composer, what waits on the host, and the timeline', async () => {
    await openRoom(hostState({
      asks: [{ ...CHOICE, Status: 'proposed' }],
      ideas: [{ PlayerName: 'Jordan', Text: 'A map link for parking' }],
      logs: [{ Kind: 'progress', Text: 'Shift list renders', By: 'agent' }],
    }));
    expect(screen.getByRole('main', { name: 'Now' })).toBeInTheDocument();
    const waiting = screen.getByRole('region', { name: 'Waiting for you · 2' });
    expect(within(waiting).getByRole('region', { name: 'Proposed ask 3' })).toBeInTheDocument();
    expect(within(waiting).getByText('A map link for parking')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Timeline' })).getByText('Shift list renders')).toBeInTheDocument();
    // One place to type: the composer. The timeline has no form of its own.
    expect(screen.getAllByRole('textbox').filter((t) => !t.closest('.brm-proposed'))).toHaveLength(1);
  });

  test('between asks, Show the build puts the Build screen in front of the room', async () => {
    await openRoom(hostState());
    fireEvent.click(within(screen.getByRole('region', { name: 'Now' })).getByRole('button', { name: /Show the build/ }));
    expect(screen.getByRole('region', { name: 'The build' })).toBeInTheDocument();
  });

  test('a host note is logged from the composer and never sent to Claude', async () => {
    await openRoom(hostState());
    fireEvent.change(screen.getByLabelText(/log what the room said/i), { target: { value: 'Ask Dee about parking' } });
    fireEvent.change(screen.getByLabelText('Log it as'), { target: { value: 'note' } });
    expect(screen.getByRole('checkbox', { name: 'Also tell Claude' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Log it' }));
    await waitFor(() => expect(path(lastPost())).toBe(`games/${GAME}/build/log`));
    expect(lastPost().body).toEqual({ kind: 'note', text: 'Ask Dee about parking', forAgent: false });
  });
});

describe('the review card leads with what the room would see (C2)', () => {
  test('the question and the options show; the edit fields are folded until wanted', async () => {
    await openRoom(hostState({ asks: [{ ...CHOICE, Status: 'proposed' }] }));
    const card = screen.getByRole('region', { name: 'Proposed ask 3' });
    expect(within(card).getByText('Which header should volunteers see first?', { selector: '.brm-reviewq' })).toBeInTheDocument();
    expect(within(card).getByText('Calm photo + calendar', { selector: '.brm-reviewopt-t' })).toBeInTheDocument();
    const fold = card.querySelector('details.brm-editfold');
    expect(fold.open).toBe(false);
    expect(within(fold).getByText('Edit the question and options')).toBeInTheDocument();
    // An edit opens it and keeps it open.
    fireEvent.change(within(card).getByLabelText('Option B title'), { target: { value: 'Calm photo' } });
    expect(card.querySelector('details.brm-editfold').open).toBe(true);
  });
});

describe('timeline, asks and screenshots: one open at a time (owner, 2026-10-05)', () => {
  test('the Timeline starts open; opening Asks closes it; one is always open', async () => {
    await openRoom(hostState({
      asks: [{ ...CHOICE, Status: 'decided', Decision: { direction: 'Go with B.' }, DecidedAt: ago(60) }],
      logs: [{ Kind: 'progress', Text: 'Shift list renders', By: 'agent' }],
    }));
    const head = (name) => screen.getByRole('button', { name: new RegExp(`^${name} · `) });
    expect(head('Timeline')).toHaveAttribute('aria-expanded', 'true');
    expect(head('Asks')).toHaveAttribute('aria-expanded', 'false');
    expect(head('Screenshots')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('region', { name: 'Timeline' })).toBeInTheDocument();

    fireEvent.click(head('Asks'));
    expect(head('Asks')).toHaveAttribute('aria-expanded', 'true');
    expect(head('Timeline')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region', { name: 'Timeline' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Asks' })).toBeInTheDocument();

    // Clicking the open one keeps it open: there is always one to read.
    fireEvent.click(head('Asks'));
    expect(head('Asks')).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('Claude Code has stopped: the chip copies /engage:continue (owner, 2026-10-05)', () => {
  test('a last-seen chip is a button whose tooltip says what to do, and a click copies the command', async () => {
    await openRoom(hostState({ st: { AgentSeenAt: ago(3600) } }));
    const writeText = jest.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    try {
      const chip = screen.getByTestId('brm-agentchip');
      expect(chip.tagName).toBe('BUTTON');
      expect(chip.textContent).toMatch(/Claude Code last seen/);
      expect(chip.getAttribute('title')).toBe('Claude Code has stopped. Click to copy /engage:continue, then paste it into the Claude Code window and press Enter.');
      fireEvent.click(chip);
      await waitFor(() => expect(writeText).toHaveBeenCalledWith('/engage:continue'));
      expect(await screen.findByText('Copied /engage:continue. Paste it into Claude Code.')).toBeInTheDocument();
    } finally {
      delete navigator.clipboard;
    }
  });

  test('connected, the chip explains itself and is not a button', async () => {
    await openRoom(hostState());
    const chip = screen.getByTestId('brm-agentchip');
    expect(chip.tagName).toBe('SPAN');
    expect(chip.getAttribute('title')).toBe('Claude Code is connected and working.');
  });
});

describe('a direction Claude has not heard while Claude Code has stopped (owner, 2026-10-06)', () => {
  const SENT = [{ Kind: 'direction', Text: 'Board size: mega board', By: 'host', ForAgent: true }];
  const openTimeline = () => fireEvent.click(screen.getByRole('button', { name: /^Timeline/ }));

  test('stopped: the column says so, the copy button copies the command, the timeline does not claim delivery', async () => {
    await openRoom(hostState({ st: { AgentSeenAt: ago(3600) }, logs: SENT }));
    const writeText = jest.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    try {
      const notice = screen.getByTestId('brm-unheard');
      expect(notice.textContent).toMatch(/Claude Code has stopped\. It has not heard your last direction yet\./);
      fireEvent.click(within(notice).getByRole('button', { name: 'Copy /engage:continue' }));
      await waitFor(() => expect(writeText).toHaveBeenCalledWith('/engage:continue'));
      openTimeline();
      expect(screen.getByText('Waiting for Claude · run /engage:continue')).toBeInTheDocument();
      expect(screen.queryByText('Claude has it')).toBeNull();
    } finally {
      delete navigator.clipboard;
    }
  });

  test('connected, or already heard: no notice', async () => {
    await openRoom(hostState({ logs: SENT }));
    expect(screen.queryByTestId('brm-unheard')).toBeNull();
  });

  test('stopped but everything heard: no notice, and the timeline says Claude has it', async () => {
    await openRoom(hostState({ st: { AgentSeenAt: ago(3600) }, logs: [{ ...SENT[0], DeliveredAt: ago(3500) }] }));
    expect(screen.queryByTestId('brm-unheard')).toBeNull();
    openTimeline();
    expect(screen.getByText('Claude has it')).toBeInTheDocument();
  });
});

describe('a room that begins with an ask, a tie, and the wheel (owner, 2026-10-05)', () => {
  const TIE = [
    { AskId: '003', PlayerName: 'Ana', Choice: ['A'] },
    { AskId: '003', PlayerName: 'Priya', Choice: ['B'] },
  ];
  const WHEEL = (over = {}) => ({
    Slices: [{ id: 'A', label: 'A', text: 'Bold banner' }, { id: 'B', label: 'B', text: 'Calm photo + calendar' }],
    Spinner: 'Dee', Armed: true, Spins: [], ...over,
  });

  test('an empty room starts with "What should we build?": the host lists options, or the room suggests', async () => {
    await openRoom(hostState());
    expect(screen.getByText('Start with the room: What should we build?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: "I'll list the options" }));
    const dialog = screen.getByRole('dialog', { name: 'Ask the room' });
    expect(within(dialog).getByLabelText(/Question/).value).toBe('What should we build?');
  });

  test('a tie offers the wheel or a revote; each is the host\'s call', async () => {
    await openRoom(hostState({ st: { CurrentAskId: '003' }, asks: [{ ...CHOICE, Status: 'results' }], answers: TIE }));
    const panel = screen.getByRole('region', { name: 'The wheel' });
    expect(within(panel).getByText('A tie between A and B.')).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole('button', { name: 'Spin the wheel' }));
    await waitFor(() => expect(lastPost().body).toEqual({ action: 'wheel' }));
    const again = within(panel).getByRole('button', { name: 'Vote again' });
    await waitFor(() => expect(again).not.toBeDisabled());
    fireEvent.click(again);
    await waitFor(() => expect(lastPost().body).toEqual({ action: 'revote' }));
  });

  test('with the wheel up: the host can always spin, or hand it to someone else', async () => {
    await openRoom(hostState({ st: { CurrentAskId: '003' }, asks: [{ ...CHOICE, Status: 'results', Wheel: WHEEL() }], answers: TIE }));
    const panel = screen.getByRole('region', { name: 'The wheel' });
    expect(within(panel).getByText('Dee spins the wheel')).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole('button', { name: 'Spin it yourself' }));
    await waitFor(() => expect(lastPost().body).toEqual({ action: 'spin' }));
    const pass = within(panel).getByRole('button', { name: 'Someone else spins' });
    await waitFor(() => expect(pass).not.toBeDisabled());
    fireEvent.click(pass);
    await waitFor(() => expect(lastPost().body).toEqual({ action: 'pass' }));
  });

  test('where it landed fills in the direction, which the host can still change', async () => {
    await openRoom(hostState({
      st: { CurrentAskId: '003' },
      asks: [{ ...CHOICE, Status: 'results', Wheel: WHEEL({ Armed: false, Spins: [{ SpinId: 's1', At: NOW, By: 'Dee', Result: 'B', Turns: 5 }] }) }],
      answers: TIE,
    }));
    expect(screen.getByRole('textbox', { name: 'Direction for Claude' }).value).toBe('Which header should volunteers see first: Calm photo + calendar');
    expect(screen.getByRole('button', { name: 'Spin again' })).toBeInTheDocument();
  });

  test('on the Stage the wheel is the screen; Space spins, and deciding is back on the Host', async () => {
    await openRoom(hostState({ st: { CurrentAskId: '003' }, asks: [{ ...CHOICE, Status: 'results', Wheel: WHEEL() }], answers: TIE }));
    fireEvent.keyDown(window, { key: '2' });
    expect(screen.getByRole('region', { name: 'The wheel' })).toBeInTheDocument();
    expect(document.querySelector('.dock .status').textContent).toBe('Dee spins the wheel');
    fireEvent.keyDown(window, { key: ' ' });
    await waitFor(() => expect(lastPost().body).toEqual({ action: 'spin' }));
    const decide = screen.getByRole('button', { name: 'Decide on Host' });
    await waitFor(() => expect(decide).not.toBeDisabled());
    fireEvent.click(decide);
    expect(screen.getByRole('button', { name: /^Host/ })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('acknowledge, and a comment on the wall (owner, 2026-10-05)', () => {
  test('Acknowledge and Show on the wall each say what they do, and post', async () => {
    await openRoom(hostState({ ideas: [{ PlayerName: 'Jordan', Text: 'I like the look of the new buttons' }] }));
    const inbox = screen.getByRole('region', { name: /Ideas inbox/ });
    const ack = within(inbox).getByRole('button', { name: 'Acknowledge' });
    expect(ack.getAttribute('title')).toBe('Mark it as seen. Their phone says so; nothing goes to Claude.');
    fireEvent.click(ack);
    await waitFor(() => expect(lastPost().body).toEqual({ action: 'acknowledge' }));
    const wall = within(inbox).getByRole('button', { name: 'Show on the wall' });
    await waitFor(() => expect(wall).not.toBeDisabled());
    fireEvent.click(wall);
    await waitFor(() => expect(lastPost().body).toEqual({ action: 'wall' }));
  });

  test('two or more new: Acknowledge all clears them in one go', async () => {
    await openRoom(hostState({ ideas: [{ PlayerName: 'Jordan', Text: 'Nice colours' }, { PlayerName: 'Dee', Text: 'Love the map' }] }));
    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge all 2' }));
    await waitFor(() => expect(path(lastPost())).toBe(`games/${GAME}/build/ideas/acknowledge-all`));
  });

  test('while fresh, the comment is on the Stage with no name, and the Host can take it down', async () => {
    await openRoom(hostState({ st: { WallComment: { IdeaId: '0-i0', Text: 'The calendar reads really well', At: ago(3) } } }));
    const onWall = screen.getByText(/On the wall now:/).closest('.brm-onwall');
    expect(onWall.textContent).toMatch('The calendar reads really well');
    fireEvent.click(within(onWall).getByRole('button', { name: 'Take it down' }));
    await waitFor(() => expect(path(lastPost())).toBe(`games/${GAME}/build/ideas/wall/clear`));
    fireEvent.keyDown(window, { key: '2' });
    const banner = document.querySelector('.brm-wallcomment');
    expect(banner.textContent).toBe('Someone in the room saidThe calendar reads really well');
  });

  test('after its time is up it is gone from every screen', async () => {
    await openRoom(hostState({ st: { WallComment: { IdeaId: '0-i0', Text: 'Old news', At: ago(60) } } }));
    expect(screen.queryByText(/On the wall now:/)).toBeNull();
    fireEvent.keyDown(window, { key: '2' });
    expect(document.querySelector('.brm-wallcomment')).toBeNull();
  });
});

describe('the wheel whenever the room could vote (owner, 2026-10-06)', () => {
  test('an open Choose offers Spin the wheel instead, on the Host and on the Stage', async () => {
    await openRoom(hostState({ st: { CurrentAskId: '003' }, asks: [{ ...CHOICE, Status: 'live' }], answers: CHOICE_ANSWERS }));
    const kit = screen.getByRole('region', { name: 'Current ask' });
    fireEvent.click(within(kit).getByRole('button', { name: 'Spin the wheel instead' }));
    await waitFor(() => expect(lastPost().body).toEqual({ action: 'wheel' }));
    fireEvent.keyDown(window, { key: '2' });
    const dock = document.querySelector('footer.dock');
    const instead = within(dock).getByRole('button', { name: 'Spin the wheel instead' });
    await waitFor(() => expect(instead).not.toBeDisabled());
    fireEvent.click(instead);
    await waitFor(() => expect(calls.filter((c) => c.method === 'POST' && c.body && c.body.action === 'wheel')).toHaveLength(2));
  });
});

describe('deciding: the winner by default, or choose another (owner, 2026-10-06)', () => {
  const results = () => hostState({ st: { CurrentAskId: '003' }, asks: [{ ...CHOICE, Status: 'results' }], answers: CHOICE_ANSWERS });

  test('on the Host the winner is going to Claude; choosing another swaps the sentence, and back again', async () => {
    await openRoom(results());
    const box = () => screen.getByRole('textbox', { name: 'Direction for Claude' });
    expect(box().value).toBe('Which header should volunteers see first: Calm photo + calendar');
    const now = screen.getByRole('region', { name: 'Current ask' });
    expect(within(now).getByText('Going to Claude')).toBeInTheDocument();
    fireEvent.click(within(now).getByRole('button', { name: 'Choose this instead' }));
    expect(box().value).toBe('Which header should volunteers see first: Bold banner');
    // Changed their mind: the winner offers itself again.
    fireEvent.click(within(now).getByRole('button', { name: 'Choose this instead' }));
    expect(box().value).toBe('Which header should volunteers see first: Calm photo + calendar');
    fireEvent.click(within(screen.getByRole('region', { name: 'Direction for Claude' })).getByRole('button', { name: 'Send to Claude' }));
    await waitFor(() => expect(lastPost().body).toMatchObject({ action: 'decide', direction: 'Which header should volunteers see first: Calm photo + calendar', chosen: ['B'], method: 'vote' }));
  });

  test('on the Stage, choosing another goes to the Host with its sentence in the box', async () => {
    await openRoom(results());
    fireEvent.keyDown(window, { key: '2' });
    fireEvent.click(screen.getByRole('button', { name: 'Choose this instead' }));
    expect(screen.getByRole('button', { name: /^Host/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('textbox', { name: 'Direction for Claude' }).value).toBe('Which header should volunteers see first: Bold banner');
  });

  test('an Ideas ask: the top idea by default, any other idea on a click', async () => {
    await openRoom(hostState({
      st: { CurrentAskId: '004' },
      asks: [{ ...IDEAS_ASK, Status: 'results' }],
      resps: IDEAS_RESPS,
      votes: [{ AskId: '004', PlayerName: 'Sam', RespIds: ['r2'] }],
    }));
    const box = () => screen.getByRole('textbox', { name: 'Direction for Claude' });
    expect(box().value).toBe('What would stop someone signing up: Not seeing open shifts');
    fireEvent.click(screen.getByRole('button', { name: 'Choose this idea instead' }));
    expect(box().value).toBe('What would stop someone signing up: Having to make an account');
  });
});

describe('the decision records how it was made; Claude gets the question and the answer (owner, 2026-10-06)', () => {
  test('choosing another option records the host\'s pick', async () => {
    await openRoom(hostState({ st: { CurrentAskId: '003' }, asks: [{ ...CHOICE, Status: 'results' }], answers: CHOICE_ANSWERS }));
    fireEvent.click(within(screen.getByRole('region', { name: 'Current ask' })).getByRole('button', { name: 'Choose this instead' }));
    fireEvent.click(within(screen.getByRole('region', { name: 'Direction for Claude' })).getByRole('button', { name: 'Send to Claude' }));
    await waitFor(() => expect(lastPost().body).toMatchObject({ direction: 'Which header should volunteers see first: Bold banner', chosen: ['A'], method: 'host' }));
  });

  test('History shows how each decision was made', async () => {
    await openRoom(hostState({ asks: [
      { ...CHOICE, Status: 'decided', DecidedAt: ago(60), Decision: { direction: 'Which header should volunteers see first: Bold banner', chosen: ['A'], method: 'wheel' } },
    ] }));
    fireEvent.keyDown(window, { key: '4' });
    const decided = screen.getByRole('heading', { name: 'Decided so far' }).closest('section');
    expect(decided.textContent).toMatch('Which header should volunteers see first: Bold banner · by the wheel');
  });
});
