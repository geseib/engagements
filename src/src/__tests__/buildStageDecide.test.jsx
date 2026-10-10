/**
 * DECIDING ON THE STAGE (docs/design/build-room-history-and-stage-decide R3, R4, R5).
 * Page level: fixtures go through the real build-store.js views, and the body
 * To Claude posts is held equal to the body the Host screen's panel posts.
 */
import React from 'react';
import { render, screen, fireEvent, within, waitFor, act } from '@testing-library/react';
import { authFetch, getAuthToken } from '../auth/authFetch';
import BuildRoomPage from '../buildroom/BuildRoomPage';

jest.mock('../utils/reloadPage', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn(), getAuthToken: jest.fn(async () => 'id-token') }));
jest.mock('../WebSocketClient', () => ({
  __esModule: true,
  default: {
    connect: jest.fn(), disconnect: jest.fn(), onMessage: jest.fn(), offMessage: jest.fn(), onReconnected: jest.fn(),
    onConnectionStatusChange: jest.fn(), isConnected: jest.fn(() => false), ensureConnected: jest.fn(),
  },
}));

const S = require('../../../lambda-functions/game/build-store');
const webSocketClient = require('../WebSocketClient').default;
const C = require('../../../lambda-functions/game/build-crew');

const API = 'https://api.example.test/dev/';
const GAME = '4821';
const NOW = new Date().toISOString();
const ago = (s) => new Date(Date.now() - s * 1000).toISOString();

const PROMPT = 'How should it look and feel?';
const ASK = {
  SK: 'BUILD#ASK#004', AskId: '004', Kind: 'choice', Prompt: PROMPT, Detail: '', Source: 'agent', CreatedAt: ago(900), Status: 'results',
  Options: [
    { label: 'A', title: 'Calm and clear', detail: '', url: '', imageId: 'img-a' },
    { label: 'B', title: 'Playful', detail: '', url: '', imageId: 'img-b' },
  ],
  MaxPicks: 1,
};
const vote = (name, choice) => ({ SK: `BUILD#ANS#004#${name}`, AskId: '004', PlayerName: name, Choice: [choice], Why: '', CreatedAt: ago(500) });
const LANDED = { Slices: [{ id: 'A', label: 'A', text: 'Calm and clear' }, { id: 'B', label: 'B', text: 'Playful' }], Spinner: 'Dee', Armed: false, Spins: [{ SpinId: 's1', At: ago(5), By: 'Dee', Result: 'B', Turns: 5 }] };
const WIN = [vote('Ana', 'B'), vote('Priya', 'B'), vote('Sam', 'A')];
const TIE = [vote('Ana', 'B'), vote('Sam', 'A')];

let rows;
let calls;
const baseRows = (ask = ASK, answers = WIN) => [{ SK: 'BUILD#STATE', Rev: 7, AgentSeenAt: ago(6), Phase: 'building', CurrentAskId: '004' }, ask, ...answers];
const state = () => {
  const room = S.roomFromRows(rows);
  const view = S.hostView({
    gameId: GAME, meta: { Title: 'Volunteer sign-up', Details: 'A site.' }, sessionState: 'STARTED', room, players: ['Ana', 'Dee', 'Priya', 'Sam'], now: NOW,
  });
  if (room.state && room.state.Crew) view.crew = C.crewView(room, 'host', null);
  return view;
};
const posts = () => calls.filter((c) => c.method === 'POST' && !c.url.endsWith('/host-ticket'));
const lastPost = () => posts()[posts().length - 1];
let failNext = null;

beforeEach(() => {
  window.API_BASE = API;
  jest.clearAllMocks();
  calls = [];
  failNext = null;
  getAuthToken.mockImplementation(async () => 'id-token');
  global.URL.createObjectURL = jest.fn(() => 'blob:test');
  authFetch.mockImplementation(async (url, opts = {}) => {
    const method = opts.method || 'GET';
    calls.push({ url, method, body: opts.body ? JSON.parse(opts.body) : undefined });
    if (url.includes('/build/images/')) return { ok: true, status: 200, blob: async () => new Blob(['x']) };
    if (method === 'GET' && url.endsWith('/build/state')) return { ok: true, status: 200, json: async () => state() };
    if (url.endsWith('/host-ticket')) return { ok: true, status: 200, json: async () => ({ ticket: 't' }) };
    if (method === 'POST' && failNext) return { ok: false, status: 500, json: async () => ({ error: failNext }) };
    return { ok: true, status: 200, json: async () => ({ ask: {} }) };
  });
});

async function openStage(r = baseRows()) {
  rows = r;
  window.history.pushState({}, '', `/build?gameId=${GAME}`);
  render(<BuildRoomPage />);
  await screen.findByText('Volunteer sign-up');
  fireEvent.keyDown(window, { key: '2' });
}
const dock = () => within(document.querySelector('footer.dock'));
/** "Press Space to ..." shows only while the pointer is on the dock (copy pass 2026-10-10). */
const overDock = () => { fireEvent.mouseEnter(document.querySelector('footer.dock')); };
const leaveDock = () => { fireEvent.mouseLeave(document.querySelector('footer.dock')); };
const openEdit = async () => {
  fireEvent.click(dock().getByRole('button', { name: 'Change before sending' }));
  return screen.findByRole('dialog', { name: 'Change before sending' });
};

describe('R3: the Stage at results', () => {
  test('Send B to Claude leads, Change before sending sits beside it, and the hint is words with no key cap', async () => {
    await openStage();
    expect(dock().getByRole('button', { name: 'Send B to Claude' })).toBeInTheDocument();
    expect(dock().getByRole('button', { name: 'Change before sending' })).toBeInTheDocument();
    // Same order as the Host: the change is to the left of the main button.
    const names = [...document.querySelectorAll('footer.dock button')].map((b) => b.textContent.trim());
    expect(names.indexOf('Change before sending')).toBeLessThan(names.indexOf('Send B to Claude'));
    // Never on the Stage until the pointer is on the dock.
    expect(document.querySelector('.dock .brm-dockhint')).toBeNull();
    overDock();
    const hint = document.querySelector('.dock .brm-dockhint');
    expect(hint.textContent).toBe('Press Space to send');
    leaveDock();
    expect(document.querySelector('.dock .brm-dockhint')).toBeNull();
    overDock();
    expect(hint.querySelector('b').textContent).toBe('Space');
    expect(document.querySelector('.dock .kbd')).toBeNull();
  });

  test('the Space hint also shows on keyboard focus in the dock, and goes when focus leaves', async () => {
    await openStage();
    const footer = document.querySelector('footer.dock');
    expect(document.querySelector('.dock .brm-dockhint')).toBeNull();
    fireEvent.focus(dock().getByRole('button', { name: 'Change before sending' }));
    expect(document.querySelector('.dock .brm-dockhint').textContent).toBe('Press Space to send');
    fireEvent.blur(dock().getByRole('button', { name: 'Change before sending' }), { relatedTarget: document.body });
    expect(footer.querySelector('.brm-dockhint')).toBeNull();
  });

  test('To Claude posts the body the Host panel posts: the room\'s choice, its sentence, as Do now', async () => {
    await openStage();
    fireEvent.click(dock().getByRole('button', { name: 'Send B to Claude' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(lastPost().url).toBe(`${API}games/${GAME}/build/asks/004`);
    expect(lastPost().body).toEqual({
      action: 'decide', direction: `${PROMPT.replace(/[\s?]+$/, '')}: Playful`, chosen: ['B'], note: '', sendToAgent: true, method: 'vote', as: 'do-now',
    });
    // The same ask decided from the Host screen's panel sends the very same body.
    fireEvent.keyDown(window, { key: '1' });
    // One press at Settle sends the same body (B1b).
    fireEvent.click(within(screen.getByRole('list', { name: 'This ask' })).getByRole('button', { name: 'Send B to Claude' }));
    await waitFor(() => expect(posts()).toHaveLength(2));
    expect(posts()[1].body).toEqual(posts()[0].body);
  });

  test('Space at results sends; never with a dialog open or a field focused', async () => {
    await openStage();
    const dlg = document.createElement('div');
    dlg.setAttribute('role', 'dialog');
    dlg.setAttribute('aria-modal', 'true');
    document.body.appendChild(dlg);
    fireEvent.keyDown(window, { key: ' ' });
    dlg.remove();
    const field = document.createElement('input');
    document.body.appendChild(field);
    field.focus();
    fireEvent.keyDown(field, { key: ' ' });
    field.remove();
    expect(posts()).toHaveLength(0);
    fireEvent.keyDown(window, { key: ' ' });
    await waitFor(() => expect(lastPost().body).toMatchObject({ action: 'decide', chosen: ['B'] }));
  });

  test('a tie has nothing to send: Spin the wheel leads, Change before sending beside it, as on the Host', async () => {
    await openStage(baseRows(ASK, TIE));
    expect(dock().queryByRole('button', { name: /to Claude$/ })).toBeNull();
    expect(dock().getByRole('button', { name: 'Change before sending' })).toBeInTheDocument();
    expect(dock().getByRole('button', { name: 'Spin the wheel' })).toBeInTheDocument();
    overDock();
    expect(document.querySelector('.dock .brm-dockhint').textContent).toBe('Press Space to spin');
  });

  test('a set that says Later: the same button as the Host, Save for later, and nothing goes to Claude', async () => {
    await openStage(baseRows({ ...ASK, ClaudeGets: 'later' }));
    expect(dock().queryByRole('button', { name: 'Send B to Claude' })).toBeNull();
    overDock();
    expect(document.querySelector('.dock .brm-dockhint').textContent).toBe('Press Space to save for later');
    fireEvent.click(dock().getByRole('button', { name: 'Save for later' }));
    await waitFor(() => expect(lastPost().body).toMatchObject({ action: 'decide', chosen: ['B'], as: 'later' }));
    // The Host's Settle button for the same ask says the same.
    fireEvent.keyDown(window, { key: '1' });
    expect(within(screen.getByRole('list', { name: 'This ask' })).getByRole('button', { name: 'Save for later' })).toBeInTheDocument();
  });

  test('the live build is a small link under the status, not a button in the row', async () => {
    const post = { SK: 'BUILD#LOG#0000000000001#s1', LogId: '1-s1', Kind: 'showing', Text: 'Header is live', Link: 'http://localhost:5173/', By: 'agent', CreatedAt: ago(90) };
    await openStage([...baseRows(), post]);
    const footer = document.querySelector('footer.dock');
    const link = within(footer).getByRole('link', { name: /Open the build in a new tab/ });
    expect(link).toHaveAttribute('href', 'http://localhost:5173/');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.closest('.status')).not.toBeNull();
    expect(link.className).not.toMatch(/\bbtn\b|brm-btn/);
    expect(within(footer).queryByRole('button', { name: /live build/i })).toBeNull();
  });

  test.each([
    ['a winner', () => baseRows()],
    ['a tie', () => baseRows(ASK, TIE)],
    ['the room choosing', () => baseRows({ ...ASK, Status: 'live' }, [])],
    ['voting', () => baseRows({ ...ASK, Status: 'voting' }, WIN)],
    ['the wheel landed', () => baseRows({ ...ASK, Wheel: LANDED }, TIE)],
  ])('one orange on the whole Stage, and no Edit button: %s', async (name, mk) => {
    await openStage(mk());
    // The Stage's orange is the dock's `btn` (not `ghost`) or a Build Room primary; count the whole Stage.
    const orange = [...document.querySelectorAll('.brm-room button')]
      .filter((b) => (b.classList.contains('btn') ? !b.classList.contains('ghost') : b.classList.contains('brm-btn--primary')));
    expect(orange.map((b) => b.textContent.trim())).toHaveLength(1);
    expect(dock().queryByRole('button', { name: 'Edit' })).toBeNull();
  });

  test('a wheel still turning gives nothing away: a disabled "The wheel is turning…", no hint, Space sends nothing; then it unlocks', async () => {
    const armed = { ...LANDED, Armed: true, Spins: [] };
    await openStage(baseRows({ ...ASK, Wheel: armed }, TIE));
    const handler = webSocketClient.onMessage.mock.calls.find(([t]) => t === 'buildChanged')[1];
    rows = baseRows({ ...ASK, Wheel: LANDED }, TIE);
    await act(async () => { handler({}); });
    const turning = await dock().findByRole('button', { name: 'The wheel is turning…' });
    expect(turning).toBeDisabled();
    expect(dock().queryByRole('button', { name: /Send B to Claude/ })).toBeNull();
    expect(dock().getByRole('button', { name: 'Spin again' })).toBeDisabled();
    overDock();
    expect(document.querySelector('.dock .brm-dockhint')).toBeNull();
    expect(document.querySelector('.dock .status').textContent).not.toMatch(/\bB\b/);
    fireEvent.keyDown(window, { key: ' ' });
    expect(posts()).toHaveLength(0);
    fireEvent.transitionEnd(document.querySelector('.bwh-rot'));
    await waitFor(() => expect(dock().getByRole('button', { name: 'Send B to Claude' })).toBeEnabled());
    expect(document.querySelector('.dock .status').textContent).toMatch('The wheel landed on B');
    fireEvent.keyDown(window, { key: ' ' });
    await waitFor(() => expect(lastPost().body).toMatchObject({ action: 'decide', chosen: ['B'] }));
  });

  test('words and a kind the host changed on the Host screen are what the Stage sends, and the draft is cleared', async () => {
    await openStage();
    fireEvent.keyDown(window, { key: '1' });
    const path = screen.getByRole('list', { name: 'This ask' });
    fireEvent.click(within(path).getByRole('button', { name: 'Change before sending' }));
    fireEvent.change(await screen.findByRole('textbox', { name: 'Direction for Claude' }), { target: { value: 'Playful, with big dates' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Keep in mind' }));
    fireEvent.keyDown(window, { key: '2' });
    // The window starts from the same draft.
    fireEvent.click(dock().getByRole('button', { name: 'Change before sending' }));
    const win = await screen.findByRole('dialog', { name: 'Change before sending' });
    expect(within(win).getByRole('radio', { name: 'Keep in mind' })).toHaveAttribute('aria-checked', 'true');
    expect(within(win).getByRole('textbox', { name: 'Direction for Claude' }).value).toBe('Playful, with big dates');
    fireEvent.click(within(win).getByRole('button', { name: 'Close' }));
    fireEvent.click(dock().getByRole('button', { name: 'Send B to Claude' }));
    await waitFor(() => expect(lastPost().body).toMatchObject({ action: 'decide', direction: 'Playful, with big dates', as: 'keep', chosen: ['B'] }));
    // Sent: the draft is gone, so the Host's row goes back to the plain sentence.
    fireEvent.keyDown(window, { key: '1' });
  });

  test('the wheel landed: Send B to Claude leads and Spin again sits beside it', async () => {
    const tie = [vote('Ana', 'B'), vote('Sam', 'A')];
    const wheel = { Slices: [{ id: 'A', label: 'A', text: 'Calm and clear' }, { id: 'B', label: 'B', text: 'Playful' }], Spinner: 'Dee', Armed: false, Spins: [{ SpinId: 's1', At: NOW, By: 'Dee', Result: 'B', Turns: 5 }] };
    await openStage(baseRows({ ...ASK, Wheel: wheel }, tie));
    // A wheel already still on arrival is settled.
    await waitFor(() => expect(dock().getByRole('button', { name: 'Send B to Claude' })).toBeEnabled());
    expect(dock().getByRole('button', { name: 'Spin again' })).toBeInTheDocument();
    overDock();
    expect(document.querySelector('.dock .brm-dockhint').textContent).toBe('Press Space to send');
  });

  test('a rating sends its average', async () => {
    const rating = { ...ASK, Kind: 'rating', Options: [], Prompt: 'How was the demo?' };
    const answers = ['Ana', 'Sam'].map((n, i) => ({ SK: `BUILD#ANS#004#${n}`, AskId: '004', PlayerName: n, Rating: i ? 5 : 4, CreatedAt: ago(500) }));
    await openStage(baseRows(rating, answers));
    fireEvent.click(dock().getByRole('button', { name: 'Send 4.5 to Claude' }));
    await waitFor(() => expect(lastPost().body).toMatchObject({ action: 'decide', chosen: [], sendToAgent: true }));
  });
});

describe('R4: the Change before sending window', () => {
  test('Edit opens the window over the Stage with the room\'s choice picked and its sentence in the box', async () => {
    await openStage();
    const win = await openEdit();
    expect(within(win).getByRole('button', { name: /Playful · the room's choice/ })).toHaveAttribute('aria-pressed', 'true');
    expect(within(win).getByRole('textbox', { name: 'Direction for Claude' }).value).toBe('How should it look and feel: Playful');
    expect(within(win).getByRole('radio', { name: 'Do now' })).toHaveAttribute('aria-checked', 'true');
  });

  test('switching to A rewrites the direction and says it is an alternate', async () => {
    await openStage();
    const win = await openEdit();
    fireEvent.click(within(win).getByRole('button', { name: /Calm and clear/ }));
    expect(within(win).getByRole('textbox', { name: 'Direction for Claude' }).value).toBe('How should it look and feel: Calm and clear');
    expect(within(win).getByTestId('brm-alternate')).toBeInTheDocument();
    // The main button follows the pick.
    fireEvent.click(within(win).getByRole('button', { name: 'Send A to Claude' }));
    await waitFor(() => expect(lastPost().body).toMatchObject({ action: 'decide', chosen: ['A'], method: 'host', direction: 'How should it look and feel: Calm and clear' }));
  });

  test('the title, the three kinds with no Later, and the footer in the Host\'s order', async () => {
    await openStage();
    const win = await openEdit();
    expect(within(win).getByRole('heading', { name: 'Change before sending' })).toBeInTheDocument();
    expect(within(win).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Do now', 'Keep in mind', 'Ask Claude']);
    const foot = [...win.querySelectorAll('.brm-sd-foot > button')].map((b) => b.textContent.trim());
    expect(foot).toEqual(['Close', 'Discard', 'Ask again…', 'Save for later', 'Send B to Claude']);
    expect(win.querySelectorAll('.brm-sd-foot .brm-btn--primary')).toHaveLength(1);
    expect(win.querySelector('.brm-sd-foot .brm-btn--primary').textContent.trim()).toBe('Send B to Claude');
  });

  test('Send to Claude posts the kind chosen; Save for later posts kind later', async () => {
    await openStage();
    let win = await openEdit();
    fireEvent.click(within(win).getByRole('radio', { name: 'Keep in mind' }));
    fireEvent.click(within(win).getByRole('button', { name: 'Send B to Claude' }));
    await waitFor(() => expect(lastPost().body).toMatchObject({ action: 'decide', as: 'keep', sendToAgent: true }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Change before sending' })).toBeNull());
    win = await openEdit();
    fireEvent.click(within(win).getByRole('button', { name: 'Save for later' }));
    await waitFor(() => expect(lastPost().body).toMatchObject({ action: 'decide', as: 'later' }));
  });

  test('Discard asks first, with the votes staying in History; Keep it posts nothing', async () => {
    await openStage();
    const win = await openEdit();
    fireEvent.click(within(win).getByRole('button', { name: 'Discard' }));
    const ask = screen.getByRole('dialog', { name: 'Discard Ask 4? The votes stay in History.' });
    expect(posts()).toHaveLength(0);
    fireEvent.click(within(ask).getByRole('button', { name: 'Keep it' }));
    expect(posts()).toHaveLength(0);
    fireEvent.click(within(win).getByRole('button', { name: 'Discard' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: /^Discard Ask 4/ })).getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(lastPost().body).toEqual({ action: 'discard' }));
  });

  test('X, Close and Esc leave without changing anything', async () => {
    await openStage();
    let win = await openEdit();
    fireEvent.click(within(win).getByRole('button', { name: 'Close this window' }));
    expect(screen.queryByRole('dialog', { name: 'Change before sending' })).toBeNull();
    win = await openEdit();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Change before sending' })).toBeNull();
    win = await openEdit();
    fireEvent.click(within(win).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: 'Change before sending' })).toBeNull();
    expect(posts()).toHaveLength(0);
  });

  test('view mockup opens the viewer from here; Back returns with the pick and the typed words intact', async () => {
    await openStage();
    const win = await openEdit();
    fireEvent.click(within(win).getByRole('button', { name: /Calm and clear/ }));
    fireEvent.change(within(win).getByRole('textbox', { name: 'Direction for Claude' }), { target: { value: 'Calm, with big dates' } });
    fireEvent.click(within(win).getByRole('button', { name: 'View mockup B' }));
    const viewer = await screen.findByRole('dialog', { name: /mockup viewer/i });
    // The window stays mounted behind it.
    expect(screen.getByRole('textbox', { name: 'Direction for Claude' })).toBeInTheDocument();
    fireEvent.click(within(viewer).getByRole('button', { name: 'Back to Change before sending' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /mockup viewer/i })).toBeNull());
    const back = screen.getByRole('dialog', { name: 'Change before sending' });
    expect(within(back).getByRole('textbox', { name: 'Direction for Claude' }).value).toBe('Calm, with big dates');
    expect(within(back).getByRole('button', { name: /Calm and clear/ })).toHaveAttribute('aria-pressed', 'true');
  });

  test('Esc while the viewer is open closes only the viewer', async () => {
    await openStage();
    const win = await openEdit();
    fireEvent.click(within(win).getByRole('button', { name: 'View mockup A' }));
    await screen.findByRole('dialog', { name: /mockup viewer/i });
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /mockup viewer/i })).toBeNull());
    expect(screen.getByRole('dialog', { name: 'Change before sending' })).toBeInTheDocument();
  });

  test('an ask without pictures has no view mockup link', async () => {
    const plain = { ...ASK, Options: ASK.Options.map(({ imageId, ...o }) => o) };
    await openStage(baseRows(plain));
    const win = await openEdit();
    expect(within(win).queryByRole('button', { name: /View mockup/ })).toBeNull();
    expect(within(win).getByRole('button', { name: 'Send B to Claude' })).toBeInTheDocument();
  });

  test('Ideas and ratings open the window too', async () => {
    const ideas = { ...ASK, Kind: 'suggest', Options: [], Prompt: 'What would stop someone?' };
    const resps = [
      { SK: 'BUILD#RESP#004#r1', AskId: '004', RespId: 'r1', Text: 'An account', PlayerName: 'Ana', Source: 'player' },
      { SK: 'BUILD#RESP#004#r2', AskId: '004', RespId: 'r2', Text: 'No shifts', PlayerName: 'Dee', Source: 'player' },
      { SK: 'BUILD#VOTE#004#Ana', AskId: '004', PlayerName: 'Ana', RespId: 'r1' },
    ];
    await openStage(baseRows(ideas, resps));
    const win = await openEdit();
    expect(within(win).queryByRole('button', { name: /View mockup/ })).toBeNull();
    expect(within(win).getByRole('textbox', { name: 'Direction for Claude' })).toBeInTheDocument();
  });

  test('a failed send says so in the window and leaves it as it was', async () => {
    await openStage();
    const win = await openEdit();
    fireEvent.change(within(win).getByRole('textbox', { name: 'Direction for Claude' }), { target: { value: 'My words' } });
    failNext = 'The server is down';
    fireEvent.click(within(win).getByRole('button', { name: 'Send B to Claude' }));
    expect(await within(win).findByRole('alert')).toHaveTextContent(/not sent/i);
    expect(within(win).getByRole('textbox', { name: 'Direction for Claude' }).value).toBe('My words');
  });
});

describe('R5: Re-ask', () => {
  const reaskForm = async () => {
    await openStage();
    const win = await openEdit();
    fireEvent.click(within(win).getByRole('button', { name: 'Ask again…' }));
    return screen.findByRole('dialog', { name: 'Ask the room again' });
  };

  test('the form is filled in from this ask', async () => {
    const form = await reaskForm();
    expect(within(form).getByLabelText('Question').value).toBe(PROMPT);
    expect(within(form).getByLabelText('Option A').value).toBe('Calm and clear');
    expect(within(form).getByLabelText('Option B').value).toBe('Playful');
  });

  test('Back to Change before sending keeps the pick, the typed words and the edits', async () => {
    await openStage();
    let win = await openEdit();
    fireEvent.click(within(win).getByRole('button', { name: /Calm and clear/ }));
    fireEvent.change(within(win).getByRole('textbox', { name: 'Direction for Claude' }), { target: { value: 'Typed words' } });
    fireEvent.click(within(win).getByRole('button', { name: 'Ask again…' }));
    let form = await screen.findByRole('dialog', { name: 'Ask the room again' });
    fireEvent.change(within(form).getByLabelText('Question'), { target: { value: 'Edited question' } });
    fireEvent.click(within(form).getByRole('button', { name: /Back to Change before sending/ }));
    win = await screen.findByRole('dialog', { name: 'Change before sending' });
    expect(within(win).getByRole('textbox', { name: 'Direction for Claude' }).value).toBe('Typed words');
    fireEvent.click(within(win).getByRole('button', { name: 'Ask again…' }));
    form = await screen.findByRole('dialog', { name: 'Ask the room again' });
    expect(within(form).getByLabelText('Question').value).toBe('Edited question');
  });

  test('Ask again calls reask with the edits (edit, add, remove) and closes the window', async () => {
    const form = await reaskForm();
    fireEvent.change(within(form).getByLabelText('Question'), { target: { value: 'How should it look, for first-time visitors?' } });
    fireEvent.click(within(form).getByRole('button', { name: /Add an option/ }));
    fireEvent.change(within(form).getByLabelText('Option C'), { target: { value: 'Bold and serious' } });
    fireEvent.change(within(form).getByLabelText('Option A'), { target: { value: 'Calm' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Ask again' }));
    await waitFor(() => expect(lastPost().body).toMatchObject({ action: 'reask', prompt: 'How should it look, for first-time visitors?' }));
    expect(lastPost().body.options.map((o) => o.title)).toEqual(['Calm', 'Playful', 'Bold and serious']);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Ask the room again' })).toBeNull());
  });

  test('an option can be removed down to two, and a failure is said plainly', async () => {
    const form = await reaskForm();
    expect(within(form).queryByRole('button', { name: /^Remove option/ })).toBeNull();
    fireEvent.click(within(form).getByRole('button', { name: /Add an option/ }));
    fireEvent.click(within(form).getByRole('button', { name: 'Remove option A' }));
    expect(within(form).getByLabelText('Option A').value).toBe('Playful');
    failNext = 'Nope';
    fireEvent.change(within(form).getByLabelText('Option B'), { target: { value: 'Bold' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Ask again' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent(/not sent/i);
    expect(within(form).getByLabelText('Option B').value).toBe('Bold');
  });
});

describe('review fixes', () => {
  test('a click on an option at results opens the window with that pick, not the Host screen', async () => {
    await openStage();
    fireEvent.click(screen.getByTitle('Pick A'));
    const win = await screen.findByRole('dialog', { name: 'Change before sending' });
    expect(within(win).getByRole('button', { name: /Calm and clear/ })).toHaveAttribute('aria-pressed', 'true');
    expect(within(win).getByRole('textbox', { name: 'Direction for Claude' }).value).toBe('How should it look and feel: Calm and clear');
    expect(within(win).getByTestId('brm-alternate')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: /alternate/i })).toBeNull();
  });

  test('a wheel slice after it lands opens the window with that pick', async () => {
    const tie = [vote('Ana', 'B'), vote('Sam', 'A')];
    const wheel = { Slices: [{ id: 'A', label: 'A', text: 'Calm and clear' }, { id: 'B', label: 'B', text: 'Playful' }], Spinner: 'Dee', Armed: false, Spins: [{ SpinId: 's1', At: NOW, By: 'Dee', Result: 'B', Turns: 5 }] };
    await openStage(baseRows({ ...ASK, Wheel: wheel }, tie));
    fireEvent.transitionEnd(document.querySelector('.bwh-rot'));
    fireEvent.click(await screen.findByRole('button', { name: /Calm and clear/ }));
    const win = await screen.findByRole('dialog', { name: 'Change before sending' });
    expect(within(win).getByRole('textbox', { name: 'Direction for Claude' }).value).toBe('How should it look and feel: Calm and clear');
  });

  test('Edit does nothing while the crew board is up', async () => {
    const crewRows = baseRows();
    crewRows[0] = { ...crewRows[0], Crew: { enabled: true, repoUrl: 'https://github.com/george/foodbank', baseBranch: 'build-room/4821' } };
    rows = crewRows;
    window.history.pushState({}, '', `/build?gameId=${GAME}`);
    render(<BuildRoomPage />);
    await screen.findByText('Volunteer sign-up');
    fireEvent.click(screen.getByRole('tab', { name: /The crew/ }));
    fireEvent.keyDown(window, { key: '2' });
    fireEvent.click(await within(document.querySelector('footer.dock')).findByRole('button', { name: 'Change before sending' }));
    expect(screen.queryByRole('dialog', { name: 'Change before sending' })).toBeNull();
  });

  test('a failed send is said once: in the window, not also in the page banner', async () => {
    await openStage();
    const win = await openEdit();
    failNext = 'The server is down';
    fireEvent.click(within(win).getByRole('button', { name: 'Send B to Claude' }));
    await within(win).findByRole('alert');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  test('Space with a dock button focused is the button\'s own press: one send, not two', async () => {
    await openStage();
    const btn = dock().getByRole('button', { name: 'Send B to Claude' });
    btn.focus();
    fireEvent.keyDown(btn, { key: ' ' });
    expect(posts()).toHaveLength(0);
    fireEvent.click(btn);
    await waitFor(() => expect(posts()).toHaveLength(1));
  });

  test('re-asking a revote ask drops the "A tie" line and keeps a real detail', async () => {
    await openStage(baseRows({ ...ASK, Detail: 'A tie between A and B.' }, TIE));
    let win = await openEdit();
    fireEvent.click(within(win).getByRole('button', { name: 'Ask again…' }));
    let form = await screen.findByRole('dialog', { name: 'Ask the room again' });
    expect(within(form).getByLabelText('Context (optional)').value).toBe('');
    fireEvent.click(within(form).getByRole('button', { name: 'Ask again' }));
    await waitFor(() => expect(lastPost().body).toMatchObject({ action: 'reask', detail: '' }));
    expect(within(form).queryByText(/stay with the option that keeps/)).toBeNull();
  });

  test('a real detail goes with the re-ask, and the form says pictures stay with their option', async () => {
    await openStage(baseRows({ ...ASK, Detail: 'Both run on the laptop.' }));
    const win = await openEdit();
    fireEvent.click(within(win).getByRole('button', { name: 'Ask again…' }));
    const form = await screen.findByRole('dialog', { name: 'Ask the room again' });
    expect(within(form).getByText('Pictures stay with their option.')).toBeInTheDocument();
    fireEvent.click(within(form).getByRole('button', { name: 'Ask again' }));
    await waitFor(() => expect(lastPost().body).toMatchObject({ detail: 'Both run on the laptop.' }));
  });
});
