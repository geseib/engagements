/**
 * VOTE, HIGHLIGHT, RUN LIST (Host and Stage)
 * docs/superpowers/plans/2026-10-09-build-room-talking-points.md, Task 5;
 * mockups docs/design/build-room-talking-points T5, T6, T7.
 *
 * Fixtures go through the REAL build-store.js (roomFromRows + hostView), so
 * the page is tested against the shape GET build/state answers with. No
 * geometric assertions: jsdom has no layout engine.
 */
import React from 'react';
import {
  render, screen, fireEvent, waitFor, within,
} from '@testing-library/react';
import { authFetch, getAuthToken } from '../auth/authFetch';
import BuildRoomPage from '../buildroom/BuildRoomPage';
import { stageModel, defaultHighlight, pointVoteRows, defaultPicks } from '../buildroom/buildScreens';
import { W } from '../buildroom/words';

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

const TEXTS = {
  1: 'Add keyboard support so the slider works without a mouse.',
  2: 'Let the slider run in hours of work as well as dollars.',
  3: 'Use a deeper amber for any orange text.',
  4: 'Colour each lot by how long it takes to earn its value.',
  5: 'A share link that keeps the slider where you left it.',
};
const POINT = (n, over = {}) => ({
  PointId: `p${n}`, Kind: n === 3 ? 'finding' : 'idea', Text: TEXTS[n], Status: 'new', By: n === 4 ? 'Priya' : 'claude', ByRole: n === 4 ? 'builder' : 'agent',
  BatchId: 'b1', CreatedAt: ago(300 - n), Sources: n === 3 ? [{ title: 'Contrast checker', url: 'https://webaim.org/resources/contrastchecker/' }] : [], ...over,
});
const CHOICE = {
  AskId: '003', Kind: 'choice', Prompt: 'Which header should volunteers see first?', Detail: '',
  Options: [{ label: 'A', title: 'Bold banner', detail: '', url: '' }, { label: 'B', title: 'Calm photo', detail: '', url: '' }], MaxPicks: 1,
};
const DECIDED = { ...CHOICE, Status: 'decided', DecidedAt: ago(240), Decision: { direction: 'Go', chosen: ['B'], note: '' } };
// Ask 5: a vote made from five points. Option letters A-E are the points p1-p5.
const VOTE = (over = {}) => ({
  AskId: '005', Kind: 'choice', Prompt: 'Which should Claude take on next?', Detail: '', MaxPicks: 3, Status: 'results',
  FromPoints: ['p1', 'p2', 'p3', 'p4', 'p5'],
  Options: [1, 2, 3, 4, 5].map((n, i) => ({ label: String.fromCharCode(65 + i), title: TEXTS[n], detail: '', url: '', pointId: `p${n}` })),
  ...over,
});
/** Answers that give each label its count (voters V1..Vn pick the labels whose count exceeds their index). */
const ANSWERS = (counts) => {
  const most = Math.max(...Object.values(counts));
  return Array.from({ length: most }, (_, i) => ({
    SK: `BUILD#ANS#005#V${i + 1}`, AskId: '005', PlayerName: `V${i + 1}`,
    Choice: Object.entries(counts).filter(([, c]) => c > i).map(([l]) => l),
  }));
};
// B 9, A 8, D 6, E 5, C 3: the owner's mockup. B is point 2, A point 1, D point 4, E point 5, C point 3.
const COUNTS = { B: 9, A: 8, D: 6, E: 5, C: 3 };
const voting = (over = {}) => [1, 2, 3, 4, 5].map((n) => POINT(n, { Status: 'voting', PromotedTo: '005', ...over }));

function hostState({
  st = {}, asks = [], points = [], ideas = [], later = [], run = null, answers = [], players = ['Ana', 'Dee', 'Priya', 'Sam'],
} = {}) {
  const rows = [
    { SK: 'BUILD#STATE', Rev: 7, AgentSeenAt: ago(6), Phase: 'building', ...(later.length ? { Brief: { later } } : {}), ...st },
    ...asks.map((a) => ({ SK: `BUILD#ASK#${a.AskId}`, Source: 'agent', CreatedAt: ago(600), ...a })),
    ...points.map((p) => ({ SK: `BUILD#POINT#${p.PointId.padStart(13, '0')}`, ...p })),
    ...ideas.map((d, i) => ({ SK: `BUILD#IDEA#${String(i).padStart(13, '0')}#i${i}`, IdeaId: `${i}-i${i}`, Status: 'new', CreatedAt: ago(120), Source: 'room', ...d })),
    ...answers,
    ...(run ? [{ SK: 'BUILD#RUN', ...run }] : []),
  ];
  return S.hostView({
    gameId: GAME,
    meta: { Title: 'Volunteer sign-up', Details: 'A one-page site to pick a shift in a minute.' },
    sessionState: 'STARTED',
    room: S.roomFromRows(rows),
    players,
    now: NOW,
  });
}

/** The state with the vote at results and the points in the vote. */
const RESULTS = (over = {}) => hostState({
  st: { CurrentAskId: '005' }, asks: [DECIDED, VOTE()], points: voting(), answers: ANSWERS(COUNTS), ...over,
});

// A run of four: Claude finished 1, is on 2, 3 and 4 wait. `done2` = Claude has reported 2.
const RUN = (over = {}, done2 = false) => ({
  RunId: 'r1', Status: 'running', Cur: 2, Ver: 3, StartedAt: ago(500),
  Marks: ['done', done2 ? 'done' : 'doing', 'pending', 'pending'],
  SentAt: [ago(480), ago(300), '', ''], DoneAt: [ago(400), done2 ? ago(100) : '', '', ''],
  Items: [2, 1, 3, 4].map((n, i) => ({
    pointId: `p${n}`, text: TEXTS[n], kind: n === 3 ? 'finding' : 'idea', site: n === 3 ? 'webaim.org' : '', dir: `dir ${n}`,
    ...(i === 0 ? { note: 'Keyboard added. Committed.' } : {}),
  })),
  ...over,
});
const runPoints = () => [
  POINT(2, { Status: 'sent' }), POINT(1, { Status: 'sent' }), POINT(3, { Status: 'queued' }), POINT(4, { Status: 'queued' }), POINT(5),
];
const RUNNING = (done2 = false, extra = {}) => hostState({ asks: [DECIDED], points: runPoints(), run: RUN({}, done2), ...extra });

let current;
let calls;
let override;
const res = (data, ok = true, status = 200) => ({ ok, status, json: async () => data });

function serve(state) {
  current = state;
  calls = [];
  override = null;
  authFetch.mockImplementation(async (url, opts = {}) => {
    const method = opts.method || 'GET';
    const body = opts.body ? JSON.parse(opts.body) : undefined;
    calls.push({ url, method, body });
    if (method === 'GET' && url.endsWith('/build/state')) return res(current);
    if (url.endsWith('/host-ticket')) return res({ ticket: 't' });
    if (override) {
      const out = override(url, body);
      if (out) return out;
    }
    return res({ ok: true, ask: {}, request: {}, point: {}, sent: [], run: {} }, true, 201);
  });
}
const posts = () => calls.filter((c) => c.method === 'POST' && !c.url.endsWith('/host-ticket'));
const path = (c) => c.url.slice(API.length + `games/${GAME}/build/`.length);
const postsTo = (p) => posts().filter((c) => path(c) === p);

async function openRoom(state) {
  serve(state);
  window.history.pushState({}, '', `/build?gameId=${GAME}`);
  render(<BuildRoomPage />);
  await screen.findByText('Volunteer sign-up');
}

/** The orange buttons on the Host screen, outside any dialog (the existing counting rule). */
const oranges = () => [...document.querySelectorAll('.brm-host .brm-btn--primary, .brm-host .bwh-spin:not(.bwh-spin--sec)')]
  .filter((b) => !b.closest('[role="dialog"], .brm-modal'));
const panel = () => screen.getByRole('region', { name: 'Points' });
const tick = (text) => {
  // A group shows two points; the rest are one click away.
  let box = within(panel()).queryByRole('checkbox', { name: `Tick: ${text}` });
  while (!box) {
    const more = within(panel()).getAllByRole('button', { name: /^\d+ more (points?|findings?|ideas?)$/ })[0];
    fireEvent.click(more);
    box = within(panel()).queryByRole('checkbox', { name: `Tick: ${text}` });
  }
  fireEvent.click(box);
};
const rows = () => screen.getByRole('list', { name: /^Move forward/ });
const row = (text) => within(rows()).getByRole('button', { name: `Highlight: ${text}` });

beforeEach(() => {
  window.API_BASE = API;
  jest.clearAllMocks();
  getAuthToken.mockImplementation(async () => 'id-token');
});

const PTS = (n) => Array.from({ length: n }, (_, i) => POINT(i + 1));
const pickState = (n = 5) => hostState({ asks: [DECIDED], points: PTS(n) });

describe('T5 the vote dialog', () => {
  test('Put N to a vote opens a window with the question, the options and 3 picks (one fewer than the options when smaller)', async () => {
    await openRoom(pickState(5));
    fireEvent.click(screen.getByRole('tab', { name: /^Points/ }));
    [1, 2, 3, 4, 5].forEach((n) => tick(TEXTS[n]));
    fireEvent.click(within(panel()).getByRole('button', { name: 'Put 5 to a vote' }));
    const dlg = await screen.findByRole('dialog', { name: 'Put 5 to a vote' });
    expect(within(dlg).getByLabelText('The question')).toHaveValue('Which should Claude take on next?');
    const opts = within(dlg).getByRole('list', { name: 'The options, as people will see them' });
    expect(within(opts).getAllByRole('listitem')).toHaveLength(5);
    expect(opts.textContent).toMatch(TEXTS[2]);
    expect(opts.textContent).toMatch("Idea · Priya's Claude");
    expect(within(dlg).getByRole('group', { name: 'Picks per person' }).textContent).toMatch('3');
    expect(defaultPicks(2)).toBe(1);
    expect(defaultPicks(3)).toBe(2);
    expect(defaultPicks(8)).toBe(3);
  });

  test('Open voting posts the ids, the question and the picks; the stepper runs 1 to 5', async () => {
    await openRoom(pickState(5));
    fireEvent.click(screen.getByRole('tab', { name: /^Points/ }));
    [1, 2, 3, 4, 5].forEach((n) => tick(TEXTS[n]));
    fireEvent.click(within(panel()).getByRole('button', { name: 'Put 5 to a vote' }));
    const dlg = await screen.findByRole('dialog', { name: 'Put 5 to a vote' });
    fireEvent.click(within(dlg).getByRole('button', { name: 'One more pick' }));
    fireEvent.click(within(dlg).getByRole('button', { name: 'One more pick' }));
    expect(within(dlg).getByRole('button', { name: 'One more pick' })).toBeDisabled();
    fireEvent.change(within(dlg).getByLabelText('The question'), { target: { value: 'What first?' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Open voting' }));
    await waitFor(() => expect(postsTo('points/vote')).toHaveLength(1));
    expect(postsTo('points/vote')[0].body).toEqual({ ids: ['p1', 'p2', 'p3', 'p4', 'p5'], prompt: 'What first?', maxPicks: 5 });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Put 5 to a vote' })).toBeNull());
  });

  test('2 ticked: picks start at 1 and cannot pass 2; the least is 1', async () => {
    await openRoom(pickState(5));
    fireEvent.click(screen.getByRole('tab', { name: /^Points/ }));
    tick(TEXTS[1]);
    tick(TEXTS[2]);
    fireEvent.click(within(panel()).getByRole('button', { name: 'Put 2 to a vote' }));
    const dlg = await screen.findByRole('dialog', { name: 'Put 2 to a vote' });
    expect(within(dlg).getByRole('button', { name: 'One fewer pick' })).toBeDisabled();
    fireEvent.click(within(dlg).getByRole('button', { name: 'One more pick' }));
    expect(within(dlg).getByRole('button', { name: 'One more pick' })).toBeDisabled();
    fireEvent.click(within(dlg).getByRole('button', { name: 'Open voting' }));
    await waitFor(() => expect(postsTo('points/vote')).toHaveLength(1));
    expect(postsTo('points/vote')[0].body.maxPicks).toBe(2);
  });

  test('Ctrl Enter in the question opens voting; Close posts nothing and keeps the ticks', async () => {
    await openRoom(pickState(5));
    fireEvent.click(screen.getByRole('tab', { name: /^Points/ }));
    tick(TEXTS[1]);
    tick(TEXTS[2]);
    fireEvent.click(within(panel()).getByRole('button', { name: 'Put 2 to a vote' }));
    let dlg = await screen.findByRole('dialog', { name: 'Put 2 to a vote' });
    const closers = within(dlg).getAllByRole('button', { name: 'Close' });
    fireEvent.click(closers[closers.length - 1]);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(postsTo('points/vote')).toHaveLength(0);
    expect(within(panel()).getByRole('checkbox', { name: `Tick: ${TEXTS[1]}` })).toBeChecked();
    fireEvent.click(within(panel()).getByRole('button', { name: 'Put 2 to a vote' }));
    dlg = await screen.findByRole('dialog', { name: 'Put 2 to a vote' });
    fireEvent.keyDown(within(dlg).getByLabelText('The question'), { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(postsTo('points/vote')).toHaveLength(1));
  });

  test('an open question: the button says it closes that ask first', async () => {
    await openRoom(hostState({ st: { CurrentAskId: '003' }, asks: [{ ...CHOICE, Status: 'live' }], points: PTS(3) }));
    fireEvent.click(screen.getByRole('tab', { name: /^Points/ }));
    tick(TEXTS[1]);
    tick(TEXTS[2]);
    fireEvent.click(within(panel()).getByRole('button', { name: 'Put 2 to a vote' }));
    const dlg = await screen.findByRole('dialog', { name: 'Put 2 to a vote' });
    expect(within(dlg).getByRole('button', { name: 'Close ask 3 and open the vote' })).toBeInTheDocument();
    // The ask's step held the orange; with the window over it, the window holds it alone.
    expect(dlg.querySelectorAll('.brm-btn--primary')).toHaveLength(1);
    expect(oranges()).toHaveLength(0);
    fireEvent.click(within(dlg).getAllByRole('button', { name: 'Close' }).pop());
    expect(oranges()).toHaveLength(1);
  });

  test('one orange: the window holds it and the Host screen behind holds none', async () => {
    await openRoom(pickState(5));
    fireEvent.click(screen.getByRole('tab', { name: /^Points/ }));
    tick(TEXTS[1]);
    tick(TEXTS[2]);
    expect(oranges().map((b) => b.textContent)).toEqual(['Put 2 to a vote']);
    fireEvent.click(within(panel()).getByRole('button', { name: 'Put 2 to a vote' }));
    const dlg = await screen.findByRole('dialog', { name: 'Put 2 to a vote' });
    expect(dlg.querySelectorAll('.brm-btn--primary')).toHaveLength(1);
    expect(oranges()).toHaveLength(0);
    fireEvent.click(within(dlg).getAllByRole('button', { name: 'Close' }).pop());
    expect(oranges().map((b) => b.textContent)).toEqual(['Put 2 to a vote']);
  });
});

describe('T6 results: highlight what moves forward', () => {
  test('the rows come most votes first, the top three are highlighted, and the step says so', async () => {
    await openRoom(RESULTS());
    expect(screen.getByText('The room voted 9 of 9 · 31 picks')).toBeInTheDocument();
    const names = within(rows()).getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    expect(names).toEqual([2, 1, 4, 5, 3].map((n) => `Highlight: ${TEXTS[n]}`));
    expect(row(TEXTS[2])).toHaveAttribute('aria-pressed', 'true');
    expect(row(TEXTS[1])).toHaveAttribute('aria-pressed', 'true');
    expect(row(TEXTS[4])).toHaveAttribute('aria-pressed', 'true');
    expect(row(TEXTS[5])).toHaveAttribute('aria-pressed', 'false');
    expect(row(TEXTS[3])).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('3 highlighted')).toBeInTheDocument();
    expect(screen.getByText(/The top 3 by votes are highlighted\. Click a row to change that\./)).toBeInTheDocument();
    expect(within(row(TEXTS[2])).getByLabelText('9 votes')).toBeInTheDocument();
  });

  test('a tie at the cut highlights both and says so', async () => {
    await openRoom(RESULTS({ answers: ANSWERS({ B: 9, A: 8, D: 6, E: 6, C: 3 }) }));
    expect(screen.getByText('4 highlighted')).toBeInTheDocument();
    expect(row(TEXTS[4])).toHaveAttribute('aria-pressed', 'true');
    expect(row(TEXTS[5])).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('A tie at the cut: D and E, 6 each. Both are highlighted. Clear one, or keep both.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send these 4 to Claude' })).toBeInTheDocument();
  });

  test('a click clears or adds a row; nothing nobody picked is highlighted by default', async () => {
    await openRoom(RESULTS());
    fireEvent.click(row(TEXTS[4]));
    expect(row(TEXTS[4])).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('2 highlighted')).toBeInTheDocument();
    fireEvent.click(row(TEXTS[3]));
    expect(row(TEXTS[3])).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Send these 3 to Claude' })).toBeInTheDocument();
    expect(defaultHighlight(pointVoteRows({ options: [{ label: 'A', pointId: 'x' }], results: { options: [{ label: 'A', count: 0 }] } }, { points: { items: [{ id: 'x', status: 'voting' }] } }))).toEqual([]);
  });

  test('three moves, the main one right-most and the only orange; Work through needs two', async () => {
    await openRoom(RESULTS());
    const bar = rows().closest('.brm-path-body');
    const btns = [...bar.querySelectorAll('.brm-arow > .brm-btn')];
    const bar2 = within(bar);
    expect(btns.map((b) => b.textContent)).toEqual(['Save the rest for later', 'Work through in turn', 'Send these 3 to Claude']);
    expect(oranges().map((b) => b.textContent)).toEqual(['Send these 3 to Claude']);
    expect(btns[2].hasAttribute('data-next-primary')).toBe(true);
    fireEvent.click(row(TEXTS[1]));
    fireEvent.click(row(TEXTS[4]));
    expect(screen.getByRole('button', { name: 'Work through in turn' })).toBeDisabled();
    expect(bar2.getByRole('button', { name: 'Send to Claude' }).className).toMatch('brm-btn--primary');
  });

  test('Send these 3 posts forward/send with the ids in vote order, and that is the only post (the server settles the vote)', async () => {
    await openRoom(RESULTS());
    fireEvent.click(screen.getByRole('button', { name: 'Send these 3 to Claude' }));
    await waitFor(() => expect(postsTo('asks/005')).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(postsTo('asks/005')).toHaveLength(1);
    expect(postsTo('asks/005')[0].body).toEqual({ action: 'forward', pointIds: ['p2', 'p1', 'p4'], then: 'send' });
  });

  test('Work through in turn posts forward/run', async () => {
    await openRoom(RESULTS());
    fireEvent.click(screen.getByRole('button', { name: 'Work through in turn' }));
    await waitFor(() => expect(postsTo('asks/005')).toHaveLength(1));
    expect(postsTo('asks/005')[0].body).toEqual({ action: 'forward', pointIds: ['p2', 'p1', 'p4'], then: 'run' });
  });

  test('a refused run (one already going) records nothing and the vote stays open', async () => {
    await openRoom(RESULTS());
    serve(RESULTS());
    override = (url, body) => (body && body.then === 'run' ? res({ error: 'Finish or stop the current list first' }, false, 409) : null);
    window.history.pushState({}, '', `/build?gameId=${GAME}`);
    fireEvent.click(screen.getByRole('button', { name: 'Work through in turn' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch('Finish or stop the current list first'));
    expect(postsTo('asks/005').filter((c) => c.body.action === 'decide')).toHaveLength(0);
  });

  test('Save the rest posts later-rest with the highlighted ids, says how many, and the step stays', async () => {
    await openRoom(RESULTS());
    fireEvent.click(screen.getByRole('button', { name: 'Save the rest for later' }));
    await waitFor(() => expect(postsTo('asks/005')).toHaveLength(1));
    expect(postsTo('asks/005')[0].body).toEqual({ action: 'forward', pointIds: ['p2', 'p1', 'p4'], then: 'later-rest' });
    expect(await screen.findByText('Saved 2 for later')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send these 3 to Claude' })).toBeInTheDocument();
  });

  test('Space presses the main button, as at Settle', async () => {
    await openRoom(RESULTS());
    fireEvent.keyDown(window, { key: ' ' });
    await waitFor(() => expect(postsTo('asks/005').length).toBeGreaterThan(0));
    expect(postsTo('asks/005')[0].body.then).toBe('send');
  });

  test('rows already moved are not clickable; with none left the step offers Close this vote', async () => {
    await openRoom(RESULTS({ points: voting().map((p) => ({ ...p, Status: 'sent', Outcome: 'voted 3, sent to Claude' })) }));
    expect(screen.getByText('Moved forward')).toBeInTheDocument();
    expect(oranges().map((b) => b.textContent)).toEqual(['Close this vote']);
    fireEvent.click(screen.getByRole('button', { name: 'Close this vote' }));
    await waitFor(() => expect(postsTo('asks/005')).toHaveLength(1));
    expect(postsTo('asks/005')[0].body).toMatchObject({ action: 'decide', sendToAgent: false });
  });

  test('the Stage dock carries the same three moves with Send as the main button; a click on an option sends nothing', async () => {
    await openRoom(RESULTS());
    fireEvent.keyDown(window, { key: '2' });
    const m = stageModel(current, current.asks.find((a) => a.askId === '005'), Date.now());
    expect(m.primary).toMatchObject({ action: 'points-send', label: 'Send these 3 to Claude' });
    expect(m.secondary).toMatchObject({ action: 'points-run', label: 'Work through in turn' });
    expect(m.extras.map((x) => x.label)).toEqual(['Save the rest for later']);
    const dockButtons = await screen.findAllByRole('button', { name: /Save the rest for later|Work through in turn|Send these 3 to Claude/ });
    expect(dockButtons.map((b) => b.textContent)).toEqual(['Save the rest for later', 'Work through in turn', 'Send these 3 to Claude']);
    fireEvent.click(screen.getByRole('button', { name: 'Work through in turn' }));
    await waitFor(() => expect(postsTo('asks/005')).toHaveLength(1));
    expect(postsTo('asks/005')[0].body).toEqual({ action: 'forward', pointIds: ['p2', 'p1', 'p4'], then: 'run' });
  });

  test('on the Stage Space sends the highlighted ones', async () => {
    await openRoom(RESULTS());
    fireEvent.keyDown(window, { key: '2' });
    await screen.findByRole('button', { name: 'Send these 3 to Claude' });
    fireEvent.keyDown(window, { key: ' ' });
    await waitFor(() => expect(postsTo('asks/005').length).toBeGreaterThan(0));
    expect(postsTo('asks/005')[0].body.then).toBe('send');
  });

  test('a vote not made from points settles as before', async () => {
    await openRoom(hostState({ st: { CurrentAskId: '003' }, asks: [{ ...CHOICE, Status: 'results' }], answers: [{ SK: 'BUILD#ANS#003#Ana', AskId: '003', PlayerName: 'Ana', Choice: ['B'] }] }));
    expect(screen.queryByRole('list', { name: /^Move forward/ })).toBeNull();
    expect(screen.getByRole('button', { name: /^Send B to Claude/ })).toBeInTheDocument();
  });
});

describe('T7 the run list on the Host', () => {
  test('the list, the states, Claude\'s note under the done item, and Next as the one orange', async () => {
    await openRoom(RUNNING(false));
    const list = screen.getByRole('region', { name: 'The run list' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(4);
    expect(items[0].textContent).toMatch('Done');
    expect(items[0].textContent).toMatch('Claude: "Keyboard added. Committed."');
    expect(items[1].textContent).toMatch('Claude is on it');
    expect(items[2].textContent).toMatch('Next');
    expect(within(list).getByText(/2 of 4 started/)).toBeInTheDocument();
    expect(within(list).getByText(W.claudeIsOnItem(2))).toBeInTheDocument();
    expect(oranges().map((b) => b.textContent)).toEqual([W.nextItem(3, TEXTS[3])]);
    expect(within(list).getByRole('button', { name: 'Skip 3' })).toBeInTheDocument();
    expect(within(list).getByRole('button', { name: 'Stop' })).toBeInTheDocument();
  });

  test('Next is the one orange with What\'s next on the screen (it stands aside) and with points ticked', async () => {
    await openRoom(RUNNING(false));
    expect(screen.getByText("What's next")).toBeInTheDocument();
    expect(oranges()).toHaveLength(1);
    fireEvent.click(screen.getByRole('tab', { name: /^Points/ }));
    tick(TEXTS[5]);
    expect(oranges().map((b) => b.textContent)).toEqual([W.nextItem(3, TEXTS[3])]);
    expect(within(panel()).getByRole('button', { name: 'Send to Claude' }).className).not.toMatch('brm-btn--primary');
  });

  test('Claude still on it: Space does nothing and Next asks first; Wait for Claude sends nothing', async () => {
    await openRoom(RUNNING(false));
    fireEvent.keyDown(window, { key: ' ' });
    await new Promise((r) => setTimeout(r, 50));
    expect(postsTo('run/next')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: /^Next: 3/ }));
    const dlg = await screen.findByRole('dialog', { name: "Claude hasn't finished 2. Send 3 anyway?" });
    expect(dlg.textContent).toMatch(`Claude is still on "${TEXTS[1]}"`);
    expect(oranges()).toHaveLength(0);
    expect(dlg.querySelectorAll('.brm-btn--primary')).toHaveLength(1);
    fireEvent.click(within(dlg).getByRole('button', { name: 'Wait for Claude' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(postsTo('run/next')).toHaveLength(0);
  });

  test('Send 3 anyway forces it', async () => {
    await openRoom(RUNNING(false));
    fireEvent.click(screen.getByRole('button', { name: /^Next: 3/ }));
    const dlg = await screen.findByRole('dialog', { name: "Claude hasn't finished 2. Send 3 anyway?" });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Send 3 anyway' }));
    await waitFor(() => expect(postsTo('run/next')).toHaveLength(1));
    expect(postsTo('run/next')[0].body).toEqual({ from: 2, runId: 'r1', force: true });
  });

  test('Claude has reported: the row says so, Space presses Next, and no confirm', async () => {
    await openRoom(RUNNING(true));
    expect(screen.getByText('Claude finished 2 · Press Space to send 3')).toBeInTheDocument();
    expect(oranges().map((b) => b.className.includes('brm-btn--primary') && b.hasAttribute('data-next-primary'))).toEqual([true]);
    fireEvent.keyDown(window, { key: ' ' });
    await waitFor(() => expect(postsTo('run/next')).toHaveLength(1));
    expect(postsTo('run/next')[0].body).toEqual({ from: 2, runId: 'r1' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('when Claude has reported, the focus is on Next; before that it is nowhere near it', async () => {
    await openRoom(RUNNING(true));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Next: 3/ })));
    document.body.innerHTML = '';
  });

  test('the server\'s own needsConfirm (the list moved under the page) opens the same question', async () => {
    await openRoom(RUNNING(true));
    override = (url) => {
      if (url.endsWith('/run/next')) {
        current = RUNNING(false);
        return res({ error: "Claude hasn't finished 2. Send 3 anyway?", needsConfirm: true }, false, 409);
      }
      return null;
    };
    fireEvent.click(screen.getByRole('button', { name: /^Next: 3/ }));
    expect(await screen.findByRole('dialog', { name: "Claude hasn't finished 2. Send 3 anyway?" })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('Skip and Stop post their routes', async () => {
    await openRoom(RUNNING(false));
    fireEvent.click(screen.getByRole('button', { name: 'Skip 3' }));
    await waitFor(() => expect(postsTo('run/skip')).toHaveLength(1));
    expect(postsTo('run/skip')[0].body).toEqual({ from: 2, runId: 'r1' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stop' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await waitFor(() => expect(postsTo('run/stop')).toHaveLength(1));
    expect(postsTo('run/stop')[0].body).toEqual({ runId: 'r1' });
  });

  test('two quick ArrowDowns send one reorder; a stale ver shows the server\'s sentence and the page reads the list again', async () => {
    await openRoom(RUNNING(false));
    const grip = screen.getByRole('region', { name: 'The run list' }).querySelector('[data-grip="p3"]');
    expect(grip).toHaveAttribute('aria-label', `Reorder ${TEXTS[3]} (arrow keys)`);
    override = (url) => (url.endsWith('/run/reorder') ? res({ error: 'The list changed; look again' }, false, 409) : null);
    const gets = () => calls.filter((c) => c.method === 'GET').length;
    const before = gets();
    fireEvent.keyDown(grip, { key: 'ArrowDown' });
    fireEvent.keyDown(grip, { key: 'ArrowDown' });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch('The list changed; look again'));
    expect(postsTo('run/reorder')).toHaveLength(1);
    await waitFor(() => expect(gets()).toBeGreaterThan(before));
  });

  test('a point waiting in the running list is not a highlight row any more', async () => {
    await openRoom(RESULTS({ run: RUN({}, false), points: [...voting().slice(0, 4), POINT(5, { Status: 'voting', PromotedTo: '005' })] }));
    // p3 and p4 wait in the list: they cannot be highlighted from here.
    expect(row(TEXTS[3])).toBeDisabled();
    expect(row(TEXTS[4])).toBeDisabled();
    expect(row(TEXTS[5])).not.toBeDisabled();
  });

  test('one orange with the vote window open over an ask, and with the confirm open over an ask', async () => {
    await openRoom(hostState({ st: { CurrentAskId: '003' }, asks: [{ ...CHOICE, Status: 'live' }], points: runPoints(), run: RUN({}, false) }));
    fireEvent.click(screen.getByRole('button', { name: /^Next: 3/ }));
    const dlg = await screen.findByRole('dialog', { name: "Claude hasn't finished 2. Send 3 anyway?" });
    expect(dlg.querySelectorAll('.brm-btn--primary')).toHaveLength(1);
    expect(oranges()).toHaveLength(0);
    fireEvent.click(within(dlg).getByRole('button', { name: 'Wait for Claude' }));
    expect(oranges()).toHaveLength(1);
  });

  test('pending items reorder from the keyboard, with the list\'s ver; the first and last stay put', async () => {
    await openRoom(RUNNING(false));
    const list = screen.getByRole('region', { name: 'The run list' });
    const grips = list.querySelectorAll('[data-grip]');
    expect([...grips].map((g) => g.getAttribute('data-grip'))).toEqual(['p3', 'p4']);
    fireEvent.keyDown(grips[0], { key: 'ArrowUp' });
    expect(postsTo('run/reorder')).toHaveLength(0);
    fireEvent.keyDown(grips[0], { key: 'ArrowDown' });
    await waitFor(() => expect(postsTo('run/reorder')).toHaveLength(1));
    expect(postsTo('run/reorder')[0].body).toEqual({ order: ['p4', 'p3'], ver: 3, runId: 'r1' });
    expect(within(list).getByText(W.reorderNote)).toBeInTheDocument();
  });

  test('a drag drops one pending item on another', async () => {
    await openRoom(RUNNING(false));
    const list = screen.getByRole('region', { name: 'The run list' });
    const items = within(list).getAllByRole('listitem');
    fireEvent.dragStart(items[3]);
    fireEvent.dragOver(items[2]);
    fireEvent.drop(items[2]);
    await waitFor(() => expect(postsTo('run/reorder')).toHaveLength(1));
    expect(postsTo('run/reorder')[0].body).toEqual({ order: ['p4', 'p3'], ver: 3, runId: 'r1' });
  });

  test('the last item: no Next, no Skip; Stop remains', async () => {
    const run = RUN({ Cur: 4, Marks: ['done', 'done', 'done', 'doing'], SentAt: [ago(9), ago(8), ago(7), ago(6)], DoneAt: [ago(5), ago(4), ago(3), ''] });
    await openRoom(hostState({ asks: [DECIDED], points: runPoints(), run }));
    const list = screen.getByRole('region', { name: 'The run list' });
    expect(within(list).queryByRole('button', { name: /^Next/ })).toBeNull();
    expect(within(list).getByText(W.claudeLastItem(4))).toBeInTheDocument();
    expect(within(list).getByRole('button', { name: 'Stop' })).toBeInTheDocument();
    expect(oranges()).toHaveLength(0);
  });

  test('an ask open: its step keeps the orange and Next is outline', async () => {
    await openRoom(hostState({ st: { CurrentAskId: '003' }, asks: [{ ...CHOICE, Status: 'live' }], points: runPoints(), run: RUN({}, true) }));
    const before = oranges().map((b) => b.textContent);
    expect(before).toHaveLength(1);
    expect(before[0]).not.toMatch(/^Next/);
    expect(screen.getByRole('button', { name: /^Next: 3/ }).className).not.toMatch('brm-btn--primary');
    expect(screen.getByRole('button', { name: /^Next: 3/ }).hasAttribute('data-next-primary')).toBe(false);
  });

  test('a list that finished is told once and can be put away; it holds no orange', async () => {
    const run = RUN({ Status: 'finished', Cur: 4, Marks: ['done', 'done', 'done', 'done'], DoneAt: [ago(5), ago(4), ago(3), ago(2)], FinishedAt: ago(2) });
    await openRoom(hostState({ asks: [DECIDED], points: runPoints(), run }));
    const list = screen.getByRole('region', { name: 'The run list' });
    expect(list.textContent).toMatch('Worked through all 4');
    expect(within(list).queryByRole('button', { name: /^Next/ })).toBeNull();
    fireEvent.click(within(list).getByRole('button', { name: 'Hide' }));
    expect(screen.queryByRole('region', { name: 'The run list' })).toBeNull();
  });

  test('a second list while one runs: Work through is off, with the reason', async () => {
    await openRoom(RESULTS({ run: RUN({}, false), points: [...voting().slice(0, 4), POINT(5, { Status: 'voting', PromotedTo: '005' })] }));
    const btn = screen.getByRole('button', { name: 'Work through in turn' });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', 'Finish or stop the current list first');
  });
});

describe('T7b the Stage and room safety', () => {
  test('stageModel: the list, the current item lit, Next with its number, Skip beside, Stop', () => {
    const room = RUNNING(false);
    const m = stageModel(room, null, Date.now());
    expect(m.run.cur).toBe(2);
    expect(m.primary).toMatchObject({ action: 'run-next', label: 'Next: 3', claudeDone: false });
    expect(m.secondary).toMatchObject({ action: 'run-skip', label: 'Skip 3' });
    expect(m.extras.map((x) => x.label)).toEqual(['Stop']);
    expect(m.status).toBe('Claude is working on 2 of 4 · Next waits until Claude reports 2 done');
    expect(stageModel(RUNNING(true), null, Date.now()).status).toBe('Claude finished 2');
    expect(m.meter).toMatchObject({ count: 1, of: 4 });
    expect(stageModel(RUNNING(true), null, Date.now()).primary.claudeDone).toBe(true);
  });

  test('the Stage shows the list, Claude is on 2 / 4, no names; Space does nothing until Claude reports', async () => {
    await openRoom(RUNNING(false));
    fireEvent.keyDown(window, { key: '2' });
    const stage = await screen.findByRole('region', { name: 'Working through' });
    expect(stage.textContent).toMatch('4 the room chose');
    const items = within(stage).getAllByRole('listitem');
    expect(items).toHaveLength(4);
    expect(items[1]).toHaveAttribute('aria-current', 'step');
    expect(within(stage).getByText('Claude is on 2 / 4')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\bAna\b|\bDee\b|\bSam\b|\bPriya\b/);
    expect(screen.getByRole('button', { name: 'Next: 3' })).toBeInTheDocument();
    expect(screen.queryByText(/to send 3/)).toBeNull();
    fireEvent.keyDown(window, { key: ' ' });
    await new Promise((r) => setTimeout(r, 50));
    expect(postsTo('run/next')).toHaveLength(0);
  });

  test('the Stage: Claude has reported, Space sends the next; Next early asks the same question', async () => {
    await openRoom(RUNNING(true));
    fireEvent.keyDown(window, { key: '2' });
    await screen.findByRole('region', { name: 'Working through' });
    expect(screen.getByText(/Press/).textContent).toMatch('send 3');
    fireEvent.keyDown(window, { key: ' ' });
    await waitFor(() => expect(postsTo('run/next')).toHaveLength(1));
  });

  test('the Stage: Next before Claude reports opens the confirm there', async () => {
    await openRoom(RUNNING(false));
    fireEvent.keyDown(window, { key: '2' });
    await screen.findByRole('region', { name: 'Working through' });
    fireEvent.click(screen.getByRole('button', { name: 'Next: 3' }));
    expect(await screen.findByRole('dialog', { name: "Claude hasn't finished 2. Send 3 anyway?" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
  });
});
