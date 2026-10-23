/**
 * CONSIDER, AND THE "SENT TO CLAUDE" MARKS (docs/design/build-room-consider,
 * frames 2-6; owner, 19 Oct 2026).
 *
 * Fixtures are built by the REAL server's pure half (build-store.js
 * roomFromRows, hostView, publicView), so the marks are read from exactly the
 * stamps GET build/state carries. What is pinned:
 *   - sentMarks: one mark per thing, per state (sent, reworded, for later,
 *     queued), sent beating later, the decision marking its option and ask;
 *   - the Consider panel: two doors, the room's words to start, the changed-
 *     words hint, the Why, Send to Claude now / Later / Queue for the room
 *     POST the server's body, Esc closes and keeps what was typed;
 *   - on the host's page: Consider on an arriving idea, the mark on it, and a
 *     click on the mark opening History at that entry, highlighted, with the
 *     room's words struck through, what Claude got and the why;
 *   - on a phone: History shows the same entry, "yours", the why, no names.
 * NO GEOMETRIC ASSERTIONS — jsdom has no layout engine.
 */
import React, { useState } from 'react';
import {
  render, screen, fireEvent, waitFor, within, act,
} from '@testing-library/react';
import { authFetch, getAuthToken } from '../auth/authFetch';
import BuildRoomPage from '../buildroom/BuildRoomPage';
import BuildPlayer from '../buildroom/BuildPlayer';
import { ConsiderPanel, freshDraft } from '../buildroom/BuildConsider';
import { sentMarks, storyHolds } from '../buildroom/sentMarks';
import { roomStory, contributionsOf } from '../buildroom/buildScreens';

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

const IDEAS_ASK = {
  SK: 'BUILD#ASK#004', AskId: '004', Kind: 'suggest', Prompt: 'What would make sign-up friendlier?', Status: 'live', Source: 'host', CreatedAt: ago(600), OpenedAt: ago(590), Options: [], MaxPicks: 3,
};
const RESPS = [
  { SK: 'BUILD#RESP#004#r1', AskId: '004', RespId: 'r1', Text: 'make the background blue', PlayerName: 'Ana', Source: 'player', CreatedAt: ago(300) },
  { SK: 'BUILD#RESP#004#r2', AskId: '004', RespId: 'r2', Text: 'bigger buttons for older phones', PlayerName: 'Dee', Source: 'player', CreatedAt: ago(200) },
];
/** The host considered r1 and sent it in other words, with a why (what POST build/consider writes). */
const CONSIDERED = {
  SK: 'BUILD#LOG#0000000000100#c1', LogId: '100-c1', Kind: 'direction', Text: 'make the background a gradient, light blue to white', By: 'host',
  ForAgent: true, ForAgentAs: 'do-now', From: { AskIds: [], IdeaIds: [], Items: ['resp:004:r1'] }, AsWritten: false,
  Why: 'the room agreed plain blue was too drab', RoomWords: 'make the background blue', Liked: 4, Considered: true, CreatedAt: ago(100),
};

function hostState(rows) {
  return S.hostView({
    gameId: GAME,
    meta: { Title: 'Volunteer sign-up', Details: 'A one-page site to pick a shift in a minute.' },
    sessionState: 'STARTED',
    room: S.roomFromRows([{ SK: 'BUILD#STATE', Rev: 7, AgentSeenAt: ago(6), Phase: 'building', CurrentAskId: '004' }, ...rows]),
    players: ['Ana', 'Dee'],
    now: NOW,
  });
}

// ── sentMarks: one mark per thing, per state ────────────────────────────────

describe('sentMarks', () => {
  test('sent as written, reworded, for later, queued; the decision marks its option and its ask', () => {
    const room = hostState([
      IDEAS_ASK, ...RESPS, CONSIDERED,
      { SK: 'BUILD#IDEA#0000000000001#i1', IdeaId: 'i1', Text: 'a map of the parking', PlayerName: 'Ana', Status: 'promoted', PromotedVia: 'claude', CreatedAt: ago(500) },
      { SK: 'BUILD#LOG#0000000000050#a', LogId: '50-a', Kind: 'idea', Text: 'a map of the parking', By: 'room', ForAgent: true, ForAgentAs: 'do-now', IdeaId: 'i1', AsWritten: true, CreatedAt: ago(450) },
      { SK: 'BUILD#IDEA#0000000000002#i2', IdeaId: 'i2', Text: 'a dark mode', PlayerName: 'Dee', Status: 'queued', QueuedAt: ago(90), CreatedAt: ago(400) },
      {
        SK: 'BUILD#ASK#005', AskId: '005', Kind: 'choice', Prompt: 'What next?', Status: 'decided', Source: 'host', CreatedAt: ago(380), OpenedAt: ago(370), DecidedAt: ago(60),
        Options: [{ label: 'A', title: 'Pricing' }, { label: 'B', title: 'Sign-up flow' }, { label: 'C', title: 'A live demo room' }],
        Decision: { direction: 'What next: Sign-up flow', chosen: ['B'], sendToAgent: true, method: 'vote', reworded: false },
      },
      { SK: 'BUILD#LOG#0000000000070#d', LogId: '70-d', Kind: 'decision', Text: 'What next: Sign-up flow', By: 'host', AskId: '005', ForAgent: true, ForAgentAs: 'do-now', CreatedAt: ago(60) },
      // Option A held for later, then sent from Later (the carrying entry wins)...
      { SK: 'BUILD#LOG#0000000000080#l', LogId: '80-l', Kind: 'direction', Text: 'A live demo room', By: 'host', ForAgentAs: 'later', From: { AskIds: [], IdeaIds: [], Items: ['option:005:A'] }, AsWritten: true, Considered: true, CreatedAt: ago(50) },
      { SK: 'BUILD#LOG#0000000000081#s', LogId: '81-s', Kind: 'direction', Text: 'Pricing', By: 'host', ForAgent: true, ForAgentAs: 'do-now', From: { AskIds: [], IdeaIds: [], Items: ['option:005:A'] }, AsWritten: true, Considered: true, CreatedAt: ago(40) },
      // ...and C held for later only.
      { SK: 'BUILD#LOG#0000000000082#h', LogId: '82-h', Kind: 'direction', Text: 'A live demo room', By: 'host', ForAgentAs: 'later', From: { AskIds: [], IdeaIds: [], Items: ['option:005:C'] }, AsWritten: true, Considered: true, CreatedAt: ago(30) },
    ]);
    const m = sentMarks(room);
    const of = (k) => (m.get(k) ? [m.get(k).mark, m.get(k).entryId] : null);
    expect(of('resp:004:r1')).toEqual(['reworded', '100-c1']);
    expect(of('resp:004:r2')).toBeNull();
    expect(of('idea:i1')).toEqual(['sent', '50-a']);
    expect(of('idea:i2')).toEqual(['queued', null]);
    expect(of('option:005:B')).toEqual(['sent', '70-d']);
    expect(of('ask:005')).toEqual(['sent', '70-d']);
    expect(of('option:005:C')).toEqual(['later', '82-h']);
    expect(of('option:005:A')).toEqual(['sent', '81-s']);
  });

  test('History holds the considered entry under the id the mark carries, with the why and the room\'s words', () => {
    const room = hostState([IDEAS_ASK, ...RESPS, CONSIDERED]);
    const story = roomStory({ log: room.log, asks: room.asks, images: [], gave: contributionsOf(room) });
    const it = story.find((x) => storyHolds(x, '100-c1'));
    expect(it).toBeTruthy();
    expect(it.heading).toBe('Ask 4 · from the room');
    expect(it.sent).toEqual({
      roomWords: 'make the background blue', got: 'make the background a gradient, light blue to white', why: 'the room agreed plain blue was too drab',
      marks: ['reworded by the host', 'liked by 4'],
    });
  });
});

// ── The Consider panel ──────────────────────────────────────────────────────

describe('the Consider panel', () => {
  const ITEM = { key: 'resp:004:r1', words: 'make the background blue', askId: '004', type: 'resp' };
  function Harness({ api, item = ITEM, canIdeas = false }) {
    const [open, setOpen] = useState(true);
    const [draft, setDraft] = useState(null);
    return (
      <div className="brm">
        <button type="button" onClick={() => setOpen(true)}>reopen</button>
        {open && (
          <ConsiderPanel item={item} draft={draft} setDraft={setDraft} api={api} run={(fn) => fn()} busy={false} canIdeas={canIdeas} onClose={() => setOpen(false)} />
        )}
      </div>
    );
  }
  const api = () => ({ consider: jest.fn(async () => ({ entry: {} })), ideaAction: jest.fn(async () => ({ idea: {} })) });
  const dialog = () => screen.getByRole('dialog');

  test('starts on Send to Claude with the room\'s words; changing them asks why; Send to Claude now posts words and why', async () => {
    const a = api();
    render(<Harness api={a} />);
    expect(within(dialog()).getByText('Consider · from the room · Ask 4')).toBeInTheDocument();
    expect(within(dialog()).getByRole('heading', { name: '“make the background blue”' })).toBeInTheDocument();
    expect(within(dialog()).getByRole('radio', { name: /Send to Claude/ })).toHaveAttribute('aria-checked', 'true');
    const words = within(dialog()).getByLabelText(/What Claude gets/);
    expect(words).toHaveValue('make the background blue');
    expect(screen.queryByTestId('brm-consider-changed')).toBeNull();
    fireEvent.change(words, { target: { value: 'make the background a gradient, light blue to white' } });
    expect(screen.getByTestId('brm-consider-changed')).toHaveTextContent("You changed the room's words. Saying why helps Claude, and the room sees it in History.");
    fireEvent.change(within(dialog()).getByLabelText('Why? (Claude reads this; History keeps it)'), { target: { value: 'too drab' } });
    fireEvent.click(within(dialog()).getByRole('button', { name: /Send to Claude now/ }));
    await waitFor(() => expect(a.consider).toHaveBeenCalledWith({ item: 'resp:004:r1', go: 'send', text: 'make the background a gradient, light blue to white', why: 'too drab' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  test('Later holds it for Claude, words unchanged and no why', async () => {
    const a = api();
    render(<Harness api={a} />);
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Later' }));
    await waitFor(() => expect(a.consider).toHaveBeenCalledWith({ item: 'resp:004:r1', go: 'later', text: 'make the background blue' }));
  });

  test('Queue for the room: yes/no with a question, feedback, or a vote', async () => {
    const a = api();
    render(<Harness api={a} />);
    fireEvent.click(within(dialog()).getByRole('radio', { name: /Queue for the room/ }));
    expect(within(dialog()).getByRole('radio', { name: 'Yes or no' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.change(within(dialog()).getByLabelText('Your question'), { target: { value: 'Blue for everyone?' } });
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Queue for the room' }));
    await waitFor(() => expect(a.consider).toHaveBeenCalledWith({ item: 'resp:004:r1', go: 'queue', round: 'yesno', prompt: 'Blue for everyone?' }));
    fireEvent.click(screen.getByRole('button', { name: 'reopen' }));
    fireEvent.click(within(dialog()).getByRole('radio', { name: /Queue for the room/ }));
    fireEvent.click(within(dialog()).getByRole('radio', { name: 'Add to a vote' }));
    expect(within(dialog()).queryByLabelText('Your question')).toBeNull();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Queue for the room' }));
    await waitFor(() => expect(a.consider).toHaveBeenLastCalledWith({ item: 'resp:004:r1', go: 'queue', round: 'vote' }));
  });

  test('an idea can join the open Ideas ask from here (the card\'s own door)', async () => {
    const a = api();
    render(<Harness api={a} canIdeas item={{ key: 'idea:i7', words: 'a FAQ', type: 'idea', ideaId: 'i7' }} />);
    expect(within(dialog()).getByText('Consider · from the room')).toBeInTheDocument();
    fireEvent.click(within(dialog()).getByRole('radio', { name: /Queue for the room/ }));
    fireEvent.click(within(dialog()).getByRole('radio', { name: 'Add to the open Ideas ask' }));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Queue for the room' }));
    await waitFor(() => expect(a.ideaAction).toHaveBeenCalledWith('i7', 'suggest'));
  });

  test('Esc closes it, nothing sent, and what was typed is there when it opens again', () => {
    const a = api();
    render(<Harness api={a} />);
    fireEvent.change(within(dialog()).getByLabelText(/Why\?/), { target: { value: 'half a thought' } });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(a.consider).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'reopen' }));
    expect(within(dialog()).getByLabelText(/Why\?/)).toHaveValue('half a thought');
    expect(within(dialog()).getByText('Esc closes; nothing is lost')).toBeInTheDocument();
  });

  test('a fresh draft is the room\'s words on the Send door', () => {
    expect(freshDraft({ words: 'x' })).toEqual({ door: 'claude', text: 'x', why: '', round: 'yesno', question: '', hide: false });
  });
});

// ── On the host's page ──────────────────────────────────────────────────────

describe('the host\'s page: Consider on an arriving idea, and the mark opening History', () => {
  let calls;
  const res = (data, ok = true, status = 200) => ({ ok, status, json: async () => data });
  async function openRoom(state) {
    calls = [];
    authFetch.mockImplementation(async (url, opts = {}) => {
      const method = opts.method || 'GET';
      calls.push({ url, method, body: opts.body ? JSON.parse(opts.body) : undefined });
      if (method === 'GET' && url.endsWith('/build/state')) return res(state);
      if (url.endsWith('/host-ticket')) return res({ ticket: 't' });
      return res({ ok: true, entry: {}, idea: {}, ask: {} });
    });
    window.history.pushState({}, '', `/build?gameId=${GAME}`);
    render(<BuildRoomPage />);
    await screen.findByText('Volunteer sign-up');
  }
  beforeEach(() => {
    window.API_BASE = API;
    jest.clearAllMocks();
    getAuthToken.mockImplementation(async () => 'id-token');
  });

  test('each arriving idea has Consider; the sent one carries its mark', async () => {
    await openRoom(hostState([IDEAS_ASK, ...RESPS, CONSIDERED]));
    const sug = (t) => screen.getByText(t, { selector: '.brm-sug-text' }).closest('li');
    expect(within(sug('make the background blue')).getByRole('button', { name: 'Sent to Claude, reworded' })).toBeInTheDocument();
    expect(within(sug('bigger buttons for older phones')).queryByText(/Sent to Claude/)).toBeNull();
    fireEvent.click(within(sug('bigger buttons for older phones')).getByRole('button', { name: 'Consider: bigger buttons for older phones' }));
    const d = screen.getByRole('dialog');
    fireEvent.click(within(d).getByRole('button', { name: /Send to Claude now/ }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === `${API}games/${GAME}/build/consider`)).toBe(true));
    expect(calls.find((c) => c.url.endsWith('/build/consider')).body).toEqual({ item: 'resp:004:r2', go: 'send', text: 'bigger buttons for older phones' });
    // The normal flow is untouched: the ask is still collecting.
    expect(calls.some((c) => c.method === 'POST' && /\/build\/asks\//.test(c.url))).toBe(false);
  });

  test('a click on the mark opens History at the entry: highlighted, the room\'s words struck, what Claude got, the why', async () => {
    await openRoom(hostState([IDEAS_ASK, ...RESPS, CONSIDERED]));
    const sug = screen.getByText('make the background blue', { selector: '.brm-sug-text' }).closest('li');
    await act(async () => { fireEvent.click(within(sug).getByRole('button', { name: 'Sent to Claude, reworded' })); });
    const section = document.querySelector('.brm-histsection');
    expect(section).not.toBeNull();
    expect(within(section).getByText('showing the entry')).toBeInTheDocument();
    const entry = section.querySelector('.brm-story-it.is-focus');
    expect(entry).not.toBeNull();
    expect(entry.querySelector('s').textContent).toBe('make the background blue');
    expect(entry.textContent).toContain('→ make the background a gradient, light blue to white');
    expect(entry.textContent).toContain('Why: the room agreed plain blue was too drab');
    expect(within(entry).getByText('reworded by the host')).toBeInTheDocument();
    expect(within(entry).getByText('liked by 4')).toBeInTheDocument();
  });

  test('a queued idea in Waiting for you says so, and keeps its card', async () => {
    await openRoom(hostState([
      { SK: 'BUILD#IDEA#0000000000002#i2', IdeaId: 'i2', Text: 'a dark mode', PlayerName: 'Dee', Status: 'queued', QueuedAt: ago(90), CreatedAt: ago(400) },
    ]));
    const q = screen.getByRole('region', { name: 'The queue' });
    const card = within(q).getByText('a dark mode').closest('.brm-qidea');
    expect(within(card).getByText('Queued for the room')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Consider: a dark mode' })).toBeInTheDocument();
  });
});

// ── On a phone ──────────────────────────────────────────────────────────────

describe('a phone\'s History: the same entry, the why, "yours", no names', () => {
  beforeEach(() => { global.fetch.mockReset(); });
  test('my idea, reworded by the host, with the why', async () => {
    const rows = [
      { SK: 'BUILD#STATE', Rev: 3, Phase: 'building' },
      { SK: 'BUILD#IDEA#0000000000001#i1', IdeaId: 'i1', Text: 'make the background blue', PlayerName: 'Priya', Status: 'promoted', PromotedVia: 'claude', CreatedAt: ago(500) },
      {
        SK: 'BUILD#LOG#0000000000100#c1', LogId: '100-c1', Kind: 'direction', Text: 'make the background a gradient, light blue to white', By: 'host',
        ForAgent: true, ForAgentAs: 'do-now', From: { AskIds: [], IdeaIds: ['i1'] }, AsWritten: false,
        Why: 'the room agreed plain blue was too drab', RoomWords: 'make the background blue', Considered: true, CreatedAt: ago(100),
      },
    ];
    const view = S.publicView({ gameId: GAME, meta: { Title: 'Food bank sign-up' }, sessionState: 'STARTED', room: S.roomFromRows(rows), players: ['Priya', 'Sam'], me: { playerName: 'Priya' }, now: NOW });
    global.fetch.mockImplementation(() => Promise.resolve({ ok: true, status: 200, json: async () => view }));
    await act(async () => { render(<BuildPlayer gameId={GAME} playerName="Priya" clientId="c-1" apiBase="http://localhost:3000/api/" rev={0} />); });
    fireEvent.click(await screen.findByRole('button', { name: 'History' }));
    const h = screen.getByRole('region', { name: 'History' });
    const it = within(h).getByText('make the background blue', { selector: 's' }).closest('li');
    expect(it.textContent).toContain('yours · Sent to Claude, reworded');
    expect(it.textContent).toContain('→ make the background a gradient, light blue to white');
    expect(it.textContent).toContain('Why: the room agreed plain blue was too drab');
    expect(h.textContent).not.toMatch(/Priya|Sam/);
  });
});
