/**
 * THE BUILD ROOM'S LAPTOP ON TWO SCREENS: THE CONSOLE (parity PLAN §2 B8;
 * docs/design/build-room-console views 1a-1e; docs/design/build-room-consider
 * frame 1; owner, 19 Oct 2026: "yes build consider and the console as drawn").
 *
 *   1  the console on two screens (the choice, or a window up), never on one
 *   2  each moment a-e: "Your part now" at the top of the centre with the
 *      main button in it (held and named between asks, answer (b)); the
 *      strip, dimmed with a plain label when nothing is live (answer (c));
 *      the rail's four slots and the side column's folds (answer (d))
 *   3  parity: the card's buttons are buildControls' for the moment, the
 *      dock's own words; on the result the second is Spin the wheel because
 *      the decide panel is drawn open (answer (a)); one Send
 *   4  People ticks who has answered, by name, never what they chose (e)
 *   5  the keys: 2/3/4 and P go to the room's window, Space presses the
 *      card's main button; "All sessions" leaves
 *
 * Fixtures from the REAL backend's pure half (build-store.js hostView) plus
 * what build-room.js adds to the host's read. NO GEOMETRIC ASSERTIONS.
 */
import React from 'react';
import {
  render, screen, fireEvent, waitFor, within, cleanup,
} from '@testing-library/react';
import { authFetch } from '../auth/authFetch';
import BuildRoomPage from '../buildroom/BuildRoomPage';
import { buildControls } from '../buildroom/buildControls';
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
const KEY = 'K3y_abcdefghijklmnopqrstuvwxyz0123456789ABCD';
const NOW = new Date().toISOString();
const ago = (s) => new Date(Date.now() - s * 1000).toISOString();
const PLAYERS = ['Ana', 'Dee', 'Priya', 'Sam'];
const UP = { open: true, fullscreen: true, visible: true, statusAt: NOW, ageMs: 1000 };

const CHOICE = {
  AskId: '003', Kind: 'choice', Prompt: 'Which sign-up page should Claude build first?', Detail: '', MaxPicks: 1,
  Options: [{ label: 'A', title: 'One long list of shifts', detail: '', url: '' }, { label: 'B', title: 'A week calendar', detail: '', url: '' }],
};
const DECIDED = { ...CHOICE, AskId: '002', Prompt: 'Who is it for?', Status: 'decided', DecidedAt: ago(700), Decision: { direction: 'Who is it for: busy volunteers, often on an old phone', chosen: ['B'], note: '' } };
const ans = (who, choice) => ({ SK: `BUILD#ANS#003#${who}`, AskId: '003', PlayerName: who, Choice: choice, CreatedAt: ago(200) });
const ANSWERS3 = [ans('Ana', ['B']), ans('Priya', ['B']), ans('Sam', ['A'])];
const POINT = (n, over = {}) => ({
  SK: `BUILD#POINT#${`p${n}`.padStart(13, '0')}`, PointId: `p${n}`, Kind: 'finding', Text: `Point ${n}: most volunteers sign up on a phone`, Status: 'new', By: 'claude', ByRole: 'agent', BatchId: 'b1', CreatedAt: ago(300 - n), Sources: [], ...over,
});
const RUN = (cur, marks, done) => ({
  SK: 'BUILD#RUN', RunId: 'r1', Status: 'running', Cur: cur, Ver: 2, StartedAt: ago(500),
  Marks: marks, SentAt: marks.map((m) => (m === 'pending' ? '' : ago(300))), DoneAt: marks.map((m, i) => (m === 'done' || (done && i === cur - 1) ? ago(100) : '')),
  Items: [1, 2, 3].map((n) => ({ pointId: `p${n}`, text: `Point ${n}`, kind: 'idea', site: '', dir: `dir ${n}` })),
});

function hostState({ st = {}, rows = [], presenting = 0 } = {}) {
  const view = S.hostView({
    gameId: GAME,
    meta: { Title: 'Volunteer sign-up', Details: 'A one-page site to pick a shift in a minute.' },
    sessionState: 'STARTED',
    room: S.roomFromRows([{ SK: 'BUILD#STATE', Rev: 7, AgentSeenAt: ago(6), Phase: 'building', ...st }, ...rows]),
    players: PLAYERS,
    now: NOW,
  });
  return {
    ...view, wallKey: KEY, wall: { screen: 'stage', codes: 'none', profile: 'room', rev: 1 }, presenting, presentDetail: presenting ? UP : null,
  };
}
const ask = (over) => ({ SK: `BUILD#ASK#${over.AskId}`, Source: 'agent', CreatedAt: ago(600), ...over });

const MOMENTS = {
  'a · between asks': () => hostState({ rows: [ask(DECIDED)] }),
  'b · an ask collecting': () => hostState({ st: { CurrentAskId: '003' }, rows: [ask(DECIDED), ask({ ...CHOICE, Status: 'live', ClaudeNote: "I'll build the winner first and keep the others as tabs." }), ...ANSWERS3] }),
  'c · results, settle': () => hostState({ st: { CurrentAskId: '003' }, rows: [ask(DECIDED), ask({ ...CHOICE, Status: 'results' }), ...ANSWERS3] }),
  'd · the run list': () => hostState({ rows: [ask(DECIDED), POINT(1, { Status: 'sent' }), POINT(2, { Status: 'sent' }), POINT(3, { Status: 'queued' }), RUN(2, ['done', 'doing', 'pending'], false)] }),
  'e · a talking point': () => hostState({
    st: { ShownPoint: { id: 'p4', at: ago(30) } },
    rows: [
      ask(DECIDED), POINT(4, { Status: 'shown' }),
      { SK: 'BUILD#IDEA#0000000000001#i1', IdeaId: '1-i1', Status: 'new', Source: 'room', PlayerName: 'Ana', Text: 'One tap from the text message straight to the shift', AboutPoint: 'p4', CreatedAt: ago(20) },
    ],
  }),
};

let calls;
let current;
const res = (data) => ({ ok: true, status: 200, json: async () => data });
function serve(state) {
  current = state;
  calls = [];
  authFetch.mockImplementation(async (url, opts = {}) => {
    const method = opts.method || 'GET';
    calls.push({ url, method, body: opts.body ? JSON.parse(opts.body) : undefined });
    if (method === 'GET' && url.endsWith('/build/state')) return res(current);
    if (method === 'GET' && url.endsWith('/players')) return res({ players: [], removedPlayers: [] });
    if (url.endsWith('/host-ticket')) return res({ ticket: 't' });
    return res({ ok: true, wall: current.wall });
  });
}
const posts = (tail) => calls.filter((c) => c.method === 'POST' && c.url.endsWith(tail)).map((c) => c.body);

async function openRoom(state, choice = 'two') {
  if (choice) window.localStorage.setItem(SURFACES_KEY, choice);
  serve(state);
  window.history.pushState({}, '', `/build?gameId=${GAME}`);
  render(<BuildRoomPage />);
  await screen.findAllByText('Volunteer sign-up');
}

const consoleEl = () => document.querySelector('.hc.hc--build');
const card = () => consoleEl().querySelector('.hc-now');
const bar = () => card().querySelector('.host-action-bar');
const mainButton = () => card().querySelector('.host-action-bar__primary');
const secondButton = () => card().querySelector('.host-action-bar__secondary');
const strip = () => consoleEl().querySelector('.hc-loop');
const rail = () => consoleEl().querySelector('.hc-rail');
const side = () => consoleEl().querySelector('.hc-side');
const currentOf = (r) => (r.asks || []).find((a) => a.askId === r.currentAskId && ['live', 'voting', 'results'].includes(a.status)) || null;

beforeEach(() => {
  window.API_BASE = API;
  jest.clearAllMocks();
  window.localStorage.clear();
});

describe('1. the console on two screens, never on one', () => {
  test('two screens chosen: the console, with the Build Room\'s parts', async () => {
    await openRoom(MOMENTS['a · between asks']());
    expect(consoleEl()).not.toBeNull();
    expect(consoleEl()).toHaveAttribute('data-theme', 'dark');
    // The Host screen's own columns are not there; the console's main area is "Now".
    expect(document.querySelector('.brm-host')).toBeNull();
    expect(screen.getByRole('main', { name: 'Now' })).toBe(consoleEl().querySelector('.hc-main'));
  });

  test('one screen: today\'s Host screen, no console', async () => {
    await openRoom(MOMENTS['a · between asks'](), 'classic');
    expect(consoleEl()).toBeNull();
    expect(document.querySelector('.brm-host')).not.toBeNull();
    expect(document.querySelector('.brm-hbar')).not.toBeNull();
  });

  test('not chosen yet: today\'s Host screen, with the question', async () => {
    await openRoom(MOMENTS['a · between asks'](), null);
    expect(consoleEl()).toBeNull();
    expect(screen.getByRole('region', { name: 'Where will the room watch?' })).toBeInTheDocument();
  });

  test('a room\'s window up, even on a browser that said one screen: the console', async () => {
    await openRoom(hostState({ rows: [ask(DECIDED)], presenting: 1 }), 'classic');
    expect(consoleEl()).not.toBeNull();
  });

  test('the top line: Join, Room\'s window ↗ and its state, The room sees with 2 3 4, and the way out', async () => {
    await openRoom(hostState({ rows: [ask(DECIDED)], presenting: 1 }));
    const top = consoleEl().querySelector('.hc-top');
    expect(within(top).getByRole('button', { name: /^Join 4821/ })).toBeInTheDocument();
    expect(within(top).getByRole('link', { name: "Room's window ↗" })).toHaveAttribute('href', `/present?gameId=${GAME}&type=build&k=${encodeURIComponent(KEY)}`);
    expect(top.querySelector('.hc-winstat')).toHaveTextContent('On, full screen');
    const sees = within(top).getByRole('group', { name: 'The room sees' });
    expect(within(sees).getAllByRole('button').map((b) => b.getAttribute('aria-label') || b.textContent)).toEqual(['Stage', 'Build', 'History', 'See it here']);
    expect(within(sees).getByRole('button', { name: 'Stage' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(top).getByRole('button', { name: /All sessions/ })).toBeInTheDocument();
  });
});

describe('2. each moment: the card, the strip, the rail, the folds', () => {
  test('the rail has four slots, in order (answer (d))', async () => {
    await openRoom(MOMENTS['a · between asks']());
    const titles = [...rail().querySelectorAll(':scope > details > summary')].map((s) => s.firstChild.textContent);
    expect(titles).toEqual(['Waiting for you', 'People', 'Later', 'Session']);
  });

  test('the side column holds Now, then the folds: Decided, Timeline, Asks, Screenshots, Room brief, History', async () => {
    await openRoom(MOMENTS['a · between asks']());
    expect(within(side()).getByText('Now')).toBeInTheDocument();
    expect(side().textContent).toMatch('Last decided, ask 2: Who is it for: busy volunteers, often on an old phone.');
    const folds = [...side().querySelectorAll('.brm-stackhead')].map((b) => b.textContent.replace(/ · .*/, ''));
    // History last: a Sent to Claude mark on the console opens it at its entry (Consider, 19 Oct).
    expect(folds).toEqual(['Decided', 'Timeline', 'Asks', 'Screenshots', 'Room brief', 'History']);
  });

  test('a · between asks: "Your part now" at the top of the centre, no main button, the slot held and named (b)', async () => {
    await openRoom(MOMENTS['a · between asks']());
    expect(within(card()).getByText('Your part now')).toBeInTheDocument();
    expect(bar()).toBeNull();
    expect(card().querySelector('[data-empty-slot]')).toHaveTextContent('No main move now');
    // What's next stays in the main area, with its own lead; the Composer is there between asks.
    expect(consoleEl().querySelector('.hc-main [data-capability="composer"]')).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Now', level: 2 })).toBeInTheDocument();
  });

  test('a · between asks: the strip stays, dimmed, and its left end says "Between asks" (c)', async () => {
    await openRoom(MOMENTS['a · between asks']());
    expect(strip()).toHaveClass('is-idle');
    expect(strip().querySelector('.wfs-round')).toHaveTextContent('Between asks');
    expect([...strip().querySelectorAll('.wfs-loop .wfs-step')].map((s) => s.className.includes('is-live'))).toEqual([false, false, false, false]);
  });

  test('b · collecting: the main button is Show results, armed in place while people answer; Spin the wheel beside it', async () => {
    await openRoom(MOMENTS['b · an ask collecting']());
    expect(mainButton()).toHaveTextContent('Show results');
    expect(secondButton()).toHaveTextContent('Spin the wheel');
    expect(card().textContent).toMatch('Show results when answers stop.');
    expect(card().textContent).toMatch('Next on the wall: the results');
    expect(strip()).not.toHaveClass('is-idle');
    expect(strip().querySelector('.wfs-round')).toHaveTextContent('Ask 3 · Choose');
    const live = strip().querySelector('.wfs-step.is-live');
    expect(live).toHaveTextContent('Collect');
    // The question and the board in the main area, and the note for Claude beside it.
    const panel = within(consoleEl().querySelector('.hc-main')).getByRole('region', { name: 'This ask' });
    expect(panel.textContent).toMatch('Ask 3 · Choose · Collect');
    expect(panel.textContent).toMatch("I'll build the winner first and keep the others as tabs.");
    // The first press arms in place; the second closes the ask.
    fireEvent.click(mainButton());
    expect(card().textContent).toMatch('still answering');
    expect(posts('/build/asks/003')).toEqual([]);
    fireEvent.click(mainButton());
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && /asks\/003/.test(c.url) && c.body && c.body.action === 'close')).toBe(true));
  });

  test('c · settle: Send B to Claude in the card; the decide panel is open beside the board, with no Send of its own', async () => {
    await openRoom(MOMENTS['c · results, settle']());
    expect(mainButton()).toHaveTextContent('Send B to Claude');
    expect(secondButton()).toHaveTextContent('Spin the wheel');
    expect(card().textContent).toMatch('Check the words, then Send B to Claude.');
    const panel = within(consoleEl().querySelector('.hc-main')).getByRole('region', { name: 'This ask' });
    const box = within(panel).getByRole('textbox', { name: 'Direction for Claude' });
    expect(box.value).toMatch('A week calendar');
    // One Send on the screen: the card's.
    expect(within(panel).queryByRole('button', { name: /^Send/ })).toBeNull();
    expect(within(panel).getByRole('button', { name: 'Record only' })).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Save for later' })).toBeInTheDocument();
    expect(strip().querySelector('.wfs-step.is-live')).toHaveTextContent('Settle');
    // The host's words go: change them, then press the card's Send.
    fireEvent.change(box, { target: { value: 'Build B, a week calendar, with spots left on each shift.' } });
    fireEvent.click(mainButton());
    await waitFor(() => {
      const sent = calls.filter((c) => c.method === 'POST' && /asks\/003/.test(c.url) && c.body && c.body.action === 'decide');
      expect(sent.length).toBe(1);
      expect(sent[0].body.direction).toBe('Build B, a week calendar, with spots left on each shift.');
    });
  });

  test('c · settle: another option picked on the board, the card says Send A to Claude', async () => {
    await openRoom(MOMENTS['c · results, settle']());
    const panel = within(consoleEl().querySelector('.hc-main')).getByRole('region', { name: 'This ask' });
    // The board's own pick: B is going to Claude, A offers itself.
    expect(within(panel).getByText('Going to Claude')).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole('button', { name: 'Choose this instead' }));
    await waitFor(() => expect(mainButton()).toHaveTextContent('Send A to Claude'));
    expect(within(panel).getByRole('textbox', { name: 'Direction for Claude' }).value).toMatch('One long list of shifts');
  });

  test('d · the run list: Next in the card, Skip beside it, Stop in the third slot; the strip says how far the list is', async () => {
    const r = MOMENTS['d · the run list']();
    await openRoom(r);
    const c = buildControls(r, null, Date.now(), { decideInline: true });
    expect(mainButton()).toHaveTextContent(c.primary.label);
    expect(secondButton()).toHaveTextContent(c.secondary.label);
    expect(card().querySelector('.host-action-bar__tertiary')).toHaveTextContent('Stop');
    expect(strip()).toHaveClass('is-idle');
    expect(strip().querySelector('.wfs-round')).toHaveTextContent('The run list · 1 of 3 done');
  });

  test('e · a talking point: Take it down in the card, the point and the ideas on it in the main area', async () => {
    await openRoom(MOMENTS['e · a talking point']());
    expect(mainButton()).toHaveTextContent('Take it down');
    expect(secondButton()).toHaveTextContent('Save for later');
    const point = within(consoleEl().querySelector('.hc-main')).getByRole('region', { name: 'A talking point' });
    expect(point.textContent).toMatch('Point 4: most volunteers sign up on a phone');
    expect(point.textContent).toMatch('One tap from the text message straight to the shift');
    expect(strip().querySelector('.wfs-round')).toHaveTextContent('A talking point');
  });
});

describe('3. parity: the card reads buildControls, the dock\'s own words', () => {
  test.each(Object.keys(MOMENTS))('%s', async (name) => {
    const r = MOMENTS[name]();
    await openRoom(r);
    const cur = currentOf(r);
    const inline = buildControls(r, cur, Date.now(), { decideInline: true });
    const dock = buildControls(r, cur, Date.now());
    const label = (b) => (b ? b.querySelector('span').textContent : null);
    expect(label(mainButton())).toBe(inline.primary ? inline.primary.label : null);
    expect(label(secondButton())).toBe(inline.secondary ? inline.secondary.label : null);
    // The main button is the dock's in every moment; only the result's second button differs (answer (a)).
    expect(inline.primary ? inline.primary.label : null).toBe(dock.primary ? dock.primary.label : null);
    if (name.startsWith('c')) {
      expect(dock.secondary.label).toBe('Change before sending');
      expect(inline.secondary.label).toBe('Spin the wheel');
    } else {
      expect(inline.secondary ? inline.secondary.label : null).toBe(dock.secondary ? dock.secondary.label : null);
    }
  });
});

describe('4. People ticks who has answered, by name, never what they chose (answer (e))', () => {
  test('collecting: every name, three ticked as answered, Dee not yet; the summary counts them', async () => {
    await openRoom(MOMENTS['b · an ask collecting']());
    const sec = rail().querySelector('[data-section="people"]');
    expect(sec).toHaveAttribute('open');
    expect(sec.querySelector('summary').textContent).toMatch('3 of 4 answered');
    const rows = [...sec.querySelectorAll('.bc-people li')].map((li) => [li.textContent.replace('…', '').trim(), li.getAttribute('data-state')]);
    expect(rows).toEqual([
      ['Ana · answered', 'answered'],
      ['Dee · not yet', 'not-yet'],
      ['Priya · answered', 'answered'],
      ['Sam · answered', 'answered'],
    ]);
    // Never a choice: no option letter or title beside a name.
    const text = sec.textContent;
    ['One long list of shifts', 'A week calendar', ' B', ' A '].forEach((w) => expect(text).not.toMatch(w));
  });

  test('between asks: the names, no ticks', async () => {
    await openRoom(MOMENTS['a · between asks']());
    const sec = rail().querySelector('[data-section="people"]');
    expect(sec.querySelector('summary').textContent).toMatch('4 here');
    expect([...sec.querySelectorAll('.bc-people li')].map((li) => li.getAttribute('data-state'))).toEqual(['here', 'here', 'here', 'here']);
  });
});

describe('5. the keys and the way out', () => {
  test('2, 3, 4 and the chips send the screen to the room\'s window; the laptop stays the console', async () => {
    await openRoom(MOMENTS['a · between asks']());
    fireEvent.keyDown(window, { key: '3' });
    expect(consoleEl()).not.toBeNull();
    await waitFor(() => expect(posts('/build/wall')).toContainEqual({ screen: 'build' }));
    fireEvent.click(within(consoleEl().querySelector('.hc-top')).getByRole('button', { name: 'History' }));
    await waitFor(() => expect(posts('/build/wall')).toContainEqual({ screen: 'history' }));
    fireEvent.keyDown(window, { key: 'p' });
    expect(consoleEl()).not.toBeNull();
  });

  test('Space presses the card\'s main button (everyone in: Show results goes in one press)', async () => {
    await openRoom(hostState({ st: { CurrentAskId: '003' }, rows: [ask({ ...CHOICE, Status: 'live' }), ...ANSWERS3, ans('Dee', ['A'])] }));
    fireEvent.keyDown(window, { key: ' ' });
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && /asks\/003/.test(c.url) && c.body && c.body.action === 'close')).toBe(true));
  });

  test('Look here, privately: Build opens on the laptop; 1 comes back to the console', async () => {
    await openRoom(MOMENTS['a · between asks']());
    fireEvent.click(within(rail()).getByRole('button', { name: 'Build' }));
    expect(consoleEl()).toBeNull();
    expect(document.querySelector('[data-capability="build-screen"]')).not.toBeNull();
    fireEvent.keyDown(window, { key: '1' });
    expect(consoleEl()).not.toBeNull();
  });

  test('Join toggles the codes, as on one screen; its words say what a press does; Escape takes them down', async () => {
    await openRoom(MOMENTS['a · between asks']());
    const top = consoleEl().querySelector('.hc-top');
    const join = within(top).getByRole('button', { name: /^Join 4821/ });
    expect(join).toHaveAttribute('aria-pressed', 'false');
    expect(join).toHaveAttribute('title', 'Show the join code on the Stage');
    fireEvent.click(join);
    await waitFor(() => expect(posts('/build/wall')).toContainEqual(expect.objectContaining({ codes: 'join' })));
    expect(join).toHaveAttribute('aria-pressed', 'true');
    expect(join).toHaveAttribute('title', 'Hide the join code on the Stage');
    fireEvent.click(join);
    await waitFor(() => expect(posts('/build/wall')).toContainEqual(expect.objectContaining({ codes: 'none' })));
    expect(join).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(join);
    await waitFor(() => expect(join).toHaveAttribute('aria-pressed', 'true'));
    const before = posts('/build/wall').filter((b) => b.codes === 'none').length;
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() => expect(join).toHaveAttribute('aria-pressed', 'false'));
    expect(posts('/build/wall').filter((b) => b.codes === 'none').length).toBe(before + 1);
  });

  test('the Session slot opens the Session panel; \\ does too', async () => {
    await openRoom(MOMENTS['a · between asks']());
    fireEvent.click(within(rail()).getByRole('button', { name: 'Settings' }));
    expect(screen.getByRole('dialog', { name: 'Session' })).toBeInTheDocument();
    cleanup();
  });
});
