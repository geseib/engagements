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
import { authFetch } from '../auth/authFetch';
import webSocketClient from '../WebSocketClient';
import BuildRoomPage, { BuildCreate, stageHint } from '../buildroom/BuildRoomPage';

jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn() }));
jest.mock('../WebSocketClient', () => ({
  __esModule: true,
  default: {
    connect: jest.fn(),
    disconnect: jest.fn(),
    onMessage: jest.fn(),
    offMessage: jest.fn(),
    onReconnected: jest.fn(),
    onConnectionStatusChange: jest.fn(),
  },
}));

const S = require('../../../lambda-functions/game/build-store');

const API = 'https://api.example.test/dev/';
const GAME = '4821';
const NOW = new Date().toISOString();
const ago = (s) => new Date(Date.now() - s * 1000).toISOString();

/** HostState, computed by build-store.js from rows — never hand-shaped. */
function hostState({ st = {}, asks = [], resps = [], answers = [], votes = [], logs = [], ideas = [], keys = [] } = {}) {
  const rows = [
    { SK: 'BUILD#STATE', Rev: 7, AgentSeenAt: ago(6), ...st },
    ...asks.map((a) => ({ SK: `BUILD#ASK#${a.AskId}`, Source: 'agent', CreatedAt: ago(600), ...a })),
    ...resps.map((r) => ({ SK: `BUILD#RESP#${r.AskId}#${r.RespId}`, Source: 'player', CreatedAt: ago(300), ...r })),
    ...answers.map((a) => ({ SK: `BUILD#ANS#${a.AskId}#${a.PlayerName}`, CreatedAt: ago(200), ...a })),
    ...votes.map((v) => ({ SK: `BUILD#VOTE#${v.AskId}#${v.PlayerName}`, CreatedAt: ago(100), ...v })),
    ...logs.map((l, i) => ({ SK: `BUILD#LOG#${String(i).padStart(13, '0')}#x${i}`, LogId: `${i}-x${i}`, CreatedAt: ago(900 - i * 60), ...l })),
    ...ideas.map((d, i) => ({ SK: `BUILD#IDEA#${String(i).padStart(13, '0')}#i${i}`, IdeaId: `${i}-i${i}`, Status: 'new', CreatedAt: ago(120), ...d })),
    ...keys.map((k) => ({ SK: `BUILD#KEY#${k.KeyId}`, ...k })),
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

async function openRoom(state) {
  serve(state);
  window.history.pushState({}, '', `/build?gameId=${GAME}`);
  render(<BuildRoomPage />);
  await screen.findByText('Volunteer sign-up');
}

beforeEach(() => {
  window.API_BASE = API;
  jest.clearAllMocks();
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
    expect(box.value).toBe('Go with B: Calm photo + calendar.');

    fireEvent.click(screen.getByRole('button', { name: /Big button/ }));
    expect(box.value).toBe('Go with B: Calm photo + calendar. Big button');

    fireEvent.click(within(screen.getByRole('region', { name: 'Direction for Claude' })).getByRole('button', { name: 'Send to Claude' }));
    await waitFor(() => expect(lastPost().body).toMatchObject({ action: 'decide' }));
    expect(path(lastPost())).toBe(`games/${GAME}/build/asks/003`);
    expect(lastPost().body).toEqual({
      action: 'decide', direction: 'Go with B: Calm photo + calendar. Big button', chosen: ['B'], note: '', sendToAgent: true,
    });
  });

  test('results: switching Send to Claude off records the decision only', async () => {
    await openRoom(hostState({ st: { CurrentAskId: '003' }, asks: [{ ...CHOICE, Status: 'results' }], answers: CHOICE_ANSWERS }));
    fireEvent.click(screen.getByRole('switch'));
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
    expect(screen.getByRole('textbox', { name: 'Direction for Claude' }).value).toBe('The room rated this 3.5 out of 5.');
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
  test('quick log: what the room said, sent to Claude', async () => {
    await openRoom(hostState());
    fireEvent.change(screen.getByLabelText('Log what the room said'), { target: { value: 'Colours are too dark' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Send to Claude' }));
    fireEvent.click(screen.getByRole('button', { name: 'Log' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'End session' }));
    const dialog = screen.getByRole('dialog', { name: 'End this session?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'End session' }));
    await waitFor(() => expect(path(lastPost())).toBe(`games/${GAME}/end`));
  });

  test('Wrap up saves the outcome', async () => {
    await openRoom(hostState());
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
    fireEvent.click(within(dialog).getByRole('button', { name: 'Mint a key' }));
    await waitFor(() => expect(path(lastPost())).toBe(`games/${GAME}/build/keys`));
    const command = await within(dialog).findByTestId('brm-command');
    const key = `eng_${GAME}_${'k'.repeat(43)}`;
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
    fireEvent.click(screen.getByRole('button', { name: /Connect Claude Code/ }));
    const dialog = screen.getByRole('dialog', { name: 'Connect Claude Code' });
    ['/engage:kickoff', '/engage:ideas', '/engage:ab-mockups', '/engage:continue', '/engage:wrap-up', '/engage:share-repo', '/mcp__engage__kickoff'].forEach((slash) => {
      expect(within(dialog).getAllByText(slash, { exact: false }).length).toBeGreaterThan(0);
    });
    expect(within(dialog).getAllByRole('button', { name: 'Copy' })).toHaveLength(6);

    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Review Claude's questions/ }));
    await waitFor(() => expect(path(lastPost())).toBe(`games/${GAME}/build/settings`));
    expect(lastPost().body).toEqual({ reviewAgentAsks: false });

    const revoke = within(dialog).getByRole('button', { name: 'Revoke key' });
    await waitFor(() => expect(revoke).not.toBeDisabled());
    fireEvent.click(revoke);
    await waitFor(() => expect(path(lastPost())).toBe(`games/${GAME}/build/keys/abc123def456/revoke`));
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
    const panel = screen.getByRole('region', { name: 'What next?' });
    expect(within(panel).getByText('Claude is listening. It will act on this straight away.')).toBeInTheDocument();
    fireEvent.change(within(panel).getByLabelText('Tell Claude'), { target: { value: 'Make the button green' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Send to Claude' }));
    await waitFor(() => expect(path(lastPost())).toBe(`games/${GAME}/build/directions`));
    expect(lastPost().body).toEqual({ text: 'Make the button green' });
    ['Ideas', 'Choose', 'Rate'].forEach((k) => expect(within(panel).getByRole('button', { name: new RegExp(`^${k}`) })).toBeInTheDocument());
  });

  test('when Claude has gone quiet, the panel offers the Continue prompt', async () => {
    await openRoom(hostState({ st: { AgentSeenAt: ago(3600) } }));
    const panel = screen.getByRole('region', { name: 'What next?' });
    expect(within(panel).getByText(/If it has stopped, paste the Continue prompt/)).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: /Copy the Continue prompt/ })).toBeInTheDocument();
  });
});

describe('Present mode', () => {
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
    fireEvent.click(screen.getByRole('button', { name: /Present/ }));

    expect(screen.queryByRole('region', { name: /Ideas inbox/ })).toBeNull();
    expect(screen.queryByText('Ask Dee about parking later')).toBeNull();
    expect(screen.queryByText('Something rude')).toBeNull();
    expect(screen.queryByText('Ana')).toBeNull();
    expect(screen.queryByRole('region', { name: /Proposed ask/ })).toBeNull();
    ['Close', 'Open voting', 'Discard', 'Hide', 'Wrap up', 'End session', 'Log'].forEach((name) => {
      expect(screen.queryByRole('button', { name })).toBeNull();
    });
    expect(screen.queryByRole('button', { name: /Connect Claude Code/ })).toBeNull();
    expect(screen.queryByText(stageHint({ status: 'live', kind: 'suggest' }))).toBeNull();
    // The wall still has the question, the suggestions and the timeline.
    const stage = screen.getByRole('region', { name: 'Current ask' });
    expect(within(stage).getByText('What would stop someone signing up?')).toBeInTheDocument();
    expect(within(stage).getByText('Not seeing open shifts')).toBeInTheDocument();
    expect(screen.queryByText('Which header should volunteers see first?')).toBeNull();
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
    fireEvent.click(screen.getByRole('button', { name: /Present/ }));
    const tl = screen.getByRole('region', { name: 'Timeline' });
    const texts = within(tl).getAllByRole('listitem').map((li) => li.textContent);
    expect(texts.map((t) => ['Header B in place', 'Add a parking map', 'Use B with a bigger button'].find((x) => t.includes(x)))).toEqual(['Header B in place', 'Add a parking map', 'Use B with a bigger button']);
    expect(within(tl).queryByText(/Asked the room/)).toBeNull();
    expect(within(tl).queryByText(/from Jordan/)).toBeNull();
    expect(within(tl).queryByText(/small buttons are hard/)).toBeNull();
  });

  test('the P key toggles it, but not while typing', async () => {
    await openRoom(busyRoom());
    const log = screen.getByLabelText('Log what the room said');
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
    expect(await screen.findByRole('button', { name: /Print \/ Save as PDF/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Back to room/ }));
    expect(await screen.findByRole('button', { name: /Present/ })).toBeInTheDocument();
  });

  test('the Report button opens it', async () => {
    await openRoom(hostState());
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
