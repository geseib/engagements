/**
 * BUILD ROOM CREW MODE, THE HOST'S SIDE — buildroom/BuildCrew.jsx inside
 * buildroom/BuildRoomPage.jsx.
 *
 * Every fixture is built by the REAL backend's pure half: rows go through
 * build-store.js `roomFromRows` → `hostView`, and build-crew.js `crewView(room,
 * 'host')` fills `crew` exactly as GET build/state does (build-room.js
 * hostState). A change to those shapes turns this red.
 *
 * Pinned: each host crew action POSTs the right path and body; the Run crew
 * code switch shows its state and asks before On (never before Off); Present
 * hides Incoming, every host control, help details and the room's names;
 * untrusted links stay text. NO GEOMETRIC ASSERTIONS — jsdom has no layout.
 */
import React from 'react';
import {
  render, screen, fireEvent, waitFor, within,
} from '@testing-library/react';
import { authFetch } from '../auth/authFetch';
import BuildRoomPage from '../buildroom/BuildRoomPage';
import { buildApi } from '../buildroom/buildHostApi';
import { feedbackDraft } from '../buildroom/BuildCrew';

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
const C = require('../../../lambda-functions/game/build-crew');

const API = 'https://api.example.test/dev/';
const GAME = '4821';
const ago = (s) => new Date(Date.now() - s * 1000).toISOString();

const CREW_ON = {
  enabled: true,
  repoUrl: 'https://github.com/george/foodbank',
  baseBranch: 'build-room/4821',
  baseCommit: 'e91b04d',
  modes: ['fork', 'patch'],
  runCrewCode: false,
};

const V1 = {
  v: 1, summary: 'A map of the three lots under the calendar.', unsure: 'Lot hours are typed in by hand.', feedbackWanted: 'Is a map better than a list?',
  commit: '9c41d7a', branch: 'crew/priya/parking-map', forkUrl: 'https://github.com/priya-k/foodbank',
  diffstat: { files: ['src/Map.tsx', 'src/lots.json'], fileCount: 2, added: 223, removed: 14 }, imageIds: [], hasPatch: false, createdAt: ago(900),
};
const V2 = { ...V1, v: 2, summary: 'Lit lots marked at night.', unsure: '', commit: 'a1b2c3d', diffstat: { files: ['src/Map.tsx'], fileCount: 1, added: 40, removed: 2 }, createdAt: ago(300) };

const PRIYA_SHARE = {
  SK: 'BUILD#SHR#s1', ShareId: 's1', Builder: 'Priya', TaskId: '001', Title: 'Parking map', Lane: 'reviewed', Featured: false,
  PrUrl: 'https://github.com/george/foodbank/pull/7', Versions: [V1, V2], CreatedAt: ago(900), UpdatedAt: ago(300),
};
const SAM_SHARE = {
  SK: 'BUILD#SHR#s2', ShareId: 's2', Builder: 'Sam', TaskId: '001', Title: 'Parking as a list', Lane: 'shared', Featured: true,
  PrUrl: 'javascript:alert(1)',
  Versions: [{ ...V1, summary: 'Lots as a list with walking times.', unsure: 'Is the list too long?', branch: 'crew/sam/parking-list', forkUrl: '' }],
  CreatedAt: ago(800), UpdatedAt: ago(200),
};

/** HostState with `crew`, computed from rows — never hand-shaped. */
function hostState({ crew = CREW_ON, builders, tasks, shares, comments, reviews, logs = [] } = {}) {
  const rows = [
    { SK: 'BUILD#STATE', Rev: 7, AgentSeenAt: ago(6), ...(crew ? { Crew: crew } : {}) },
    ...(builders || [
      { SK: 'BUILD#BLD#Ana', PlayerName: 'Ana', Mode: 'fork', Branch: 'crew/ana/confirm-text', Status: 'needs-help', Note: 'Where do shift times live?', TaskId: '002', CheckpointAt: ago(840), LastSeenAt: ago(60) },
      { SK: 'BUILD#BLD#Priya', PlayerName: 'Priya', Mode: 'fork', ForkUrl: 'https://github.com/priya-k/foodbank', Branch: 'crew/priya/parking-map', Commit: 'a1b2c3d', Status: 'building', TaskId: '001', CheckpointAt: ago(120) },
      { SK: 'BUILD#BLD#Sam', PlayerName: 'Sam', Mode: 'fork', Branch: 'crew/sam/parking-list', Status: 'needs-rebase', Note: 'Header.tsx clashes', TaskId: '001', CheckpointAt: ago(60) },
    ]),
    ...(tasks || [
      { SK: 'BUILD#TASK#001', TaskId: '001', Text: 'Parking map', Detail: 'Lots and walking times', ClaimedBy: ['Priya', 'Sam'], State: 'open' },
      { SK: 'BUILD#TASK#002', TaskId: '002', Text: 'Confirmation text', Detail: '', ClaimedBy: ['Ana'], State: 'open' },
      { SK: 'BUILD#TASK#003', TaskId: '003', Text: 'Dark mode', Detail: '', ClaimedBy: [], State: 'open' },
    ]),
    ...(shares || [PRIYA_SHARE, SAM_SHARE]),
    ...(comments || [
      { SK: 'BUILD#CMT#s1#0000000000001#a', ShareId: 's1', Kind: 'question', By: 'room', Name: 'Dee', Text: 'Does it work at night?', Version: 2 },
      { SK: 'BUILD#CMT#s1#0000000000002#b', ShareId: 's1', Kind: 'concern', By: 'room', Name: 'Marcus', Text: 'Lot C closes at noon on Saturdays.', Version: 2 },
      { SK: 'BUILD#CMT#s1#0000000000003#c', ShareId: 's1', Kind: 'looks-right', By: 'room', Name: 'Ana', Text: '', Version: 2 },
      { SK: 'BUILD#CMT#s1#0000000000004#d', ShareId: 's1', Kind: 'question', By: 'room', Name: 'Dee', Text: 'An old question about v1', Version: 1 },
      { SK: 'BUILD#CMT#s2#0000000000005#e', ShareId: 's2', Kind: 'question', By: 'room', Name: 'Marcus', Text: 'How far is Lot B?', Version: 1 },
    ]),
    ...(reviews || [
      {
        SK: 'BUILD#REV#s1#0000000000009', ShareId: 's1', Version: 2, Does: 'Adds a map of three lots.', Fits: ['Clashes with Sam in Header.tsx'], Risk: 'Low',
        Suggestions: ['Move hours into lots.json', 'Add one test'], Recommendation: 'merge-after-changes', TestsRun: false, RunCrewCode: false, CreatedAt: ago(250),
      },
    ]),
    ...logs.map((l, i) => ({ SK: `BUILD#LOG#${String(i).padStart(13, '0')}#x${i}`, LogId: `${i}-x${i}`, CreatedAt: ago(600 - i * 60), ...l })),
  ];
  const room = S.roomFromRows(rows);
  const view = S.hostView({
    gameId: GAME,
    meta: { Title: 'Volunteer sign-up', Details: 'A one-page site to pick a shift in a minute.' },
    sessionState: 'STARTED',
    room,
    players: ['Ana', 'Dee', 'Marcus', 'Priya', 'Sam'],
    now: new Date().toISOString(),
  });
  view.crew = C.crewView(room, 'host', null);
  return view;
}

let current;
let calls;
const res = (data, ok = true, status = 200) => ({ ok, status, json: async () => data });
function serve(state) {
  current = state;
  calls = [];
  authFetch.mockImplementation(async (url, opts = {}) => {
    const method = opts.method || 'GET';
    calls.push({ url, method, body: opts.body ? JSON.parse(opts.body) : undefined });
    if (method === 'GET' && url.endsWith('/build/state')) return res(current);
    if (url.endsWith('/host-ticket')) return res({ ticket: 't' });
    return res({ ok: true, crew: {}, task: {}, share: {} });
  });
}
const posts = () => calls.filter((c) => c.method === 'POST' && !c.url.endsWith('/host-ticket'));
const lastPost = () => posts()[posts().length - 1];
const path = (c) => c.url.slice(API.length);
const expectPost = async (p, body) => {
  await waitFor(() => expect(path(lastPost())).toBe(`games/${GAME}/build/${p}`));
  if (body !== undefined) expect(lastPost().body).toEqual(body);
};

/** Every action runs one at a time (the page is busy until it refetches), so wait for the button. */
async function press(el) {
  await waitFor(() => expect(el.disabled).toBe(false));
  fireEvent.click(el);
}

async function openRoom(state) {
  serve(state);
  window.history.pushState({}, '', `/build?gameId=${GAME}`);
  render(<BuildRoomPage />);
  await screen.findByText('Volunteer sign-up');
}
async function openCrew(state = hostState()) {
  await openRoom(state);
  fireEvent.click(screen.getByRole('tab', { name: /The crew/ }));
  return screen.getByRole('region', { name: /Crew · 3 building with Claude Code/ });
}

beforeEach(() => {
  window.API_BASE = API;
  jest.clearAllMocks();
  jest.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => window.confirm.mockRestore());

describe('opening the room to a crew', () => {
  test('crew mode off: no stage tabs, no switch; the header offers Open to a crew', async () => {
    await openRoom(hostState({ crew: null, builders: [], tasks: [], shares: [], comments: [], reviews: [] }));
    expect(screen.queryByRole('tab', { name: /The crew/ })).toBeNull();
    expect(screen.queryByRole('switch', { name: /Run crew code/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Open to a crew' })).toBeTruthy();
  });

  test('the dialog: repo not shared yet says how to ask Claude; one shared repo, no modes to pick; the switch; opening POSTs crew/settings', async () => {
    await openRoom(hostState({ crew: null, builders: [], tasks: [], shares: [], comments: [], reviews: [] }));
    fireEvent.click(screen.getByRole('button', { name: 'Open to a crew' }));
    const dialog = screen.getByRole('dialog', { name: 'Open to a crew' });
    expect(within(dialog).getByText(/Claude has not shared the repo yet/)).toBeTruthy();
    expect(within(dialog).getByText('/engage:share-repo')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: /Copy "Share the repo with the crew"/ })).toBeTruthy();
    // Owner, 2026-10-02: everyone has access to the same repo. No fork, no patch, nothing to pick.
    expect(within(dialog).getByText(/Builders push their own branch and open a pull request\./)).toBeTruthy();
    expect(within(dialog).queryAllByRole('checkbox')).toHaveLength(0);
    expect(dialog.textContent).not.toMatch(/[Ff]ork|[Pp]atch/);
    // Two kinds of people.
    expect(within(dialog).getByText(/link their own Claude Code/)).toBeTruthy();
    expect(within(dialog).getByText(/follows on their phone/)).toBeTruthy();
    // Two exits: the X and a bottom Cancel.
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeTruthy();

    const sw = within(dialog).getByRole('switch');
    expect(sw.checked).toBe(false);
    fireEvent.click(sw);
    expect(within(dialog).getByText(/Claude may install and run builders' code on this laptop/)).toBeTruthy();
    await press(within(dialog).getByRole('button', { name: 'Open to a crew' }));
    await expectPost('crew/settings', { enabled: true, runCrewCode: true });
  });

  test('crew on: the dialog shows the repo Claude shared, read-only, and can close the crew', async () => {
    await openRoom(hostState());
    fireEvent.click(screen.getByRole('button', { name: 'Crew' }));
    const dialog = screen.getByRole('dialog', { name: 'The crew' });
    expect(within(dialog).getByRole('link', { name: CREW_ON.repoUrl }).getAttribute('href')).toBe(CREW_ON.repoUrl);
    expect(within(dialog).getByText('build-room/4821')).toBeTruthy();
    expect(dialog.textContent).toMatch('Everyone has access to this repo. Builders push their own branch and open a pull request.');
    // The repo is stated once.
    expect(dialog.textContent.split(CREW_ON.repoUrl)).toHaveLength(2);
    expect(within(dialog).queryAllByRole('textbox')).toHaveLength(0);
    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Close the crew' })[0]);
    await press(within(dialog).getByRole('button', { name: 'Close the crew' }));
    await expectPost('crew/settings', { enabled: false });
  });
});

describe('the Run crew code switch', () => {
  test('Off is shown, and turning it On asks first', async () => {
    await openRoom(hostState());
    const sw = screen.getByRole('switch', { name: /Run crew code: Off/ });
    expect(sw.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(sw);
    const ask = screen.getByRole('dialog', { name: 'Switch Run crew code on?' });
    expect(within(ask).getByText(/Claude may install and run builders' code on this laptop/)).toBeTruthy();
    expect(posts()).toHaveLength(0);
    fireEvent.click(within(ask).getByRole('button', { name: 'Keep it off' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(posts()).toHaveLength(0);

    fireEvent.click(sw);
    await press(screen.getByRole('button', { name: 'Switch on' }));
    await expectPost('crew/settings', { runCrewCode: true });
  });

  test('On is shown, and turning it Off needs no confirm', async () => {
    await openRoom(hostState({ crew: { ...CREW_ON, runCrewCode: true } }));
    const sw = screen.getByRole('switch', { name: /Run crew code: On/ });
    expect(sw.getAttribute('aria-checked')).toBe('true');
    expect(sw.className).toMatch(/is-on/);
    await press(sw);
    await expectPost('crew/settings', { runCrewCode: false });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('the crew board', () => {
  test('the pipeline counts, one lane per builder, status chips, races and checkpoints', async () => {
    const board = await openCrew();
    // Builders and everyone else, at a glance: five joined, three of them building.
    expect(within(board).getByRole('heading', { level: 2 }).textContent).toBe('Crew · 3 building with Claude Code · 2 following along');
    expect(board.textContent).not.toMatch(/\bfork\b/);
    const pipe = within(board).getByRole('list', { name: 'Where the work is' });
    const counts = within(pipe).getAllByRole('listitem').map((li) => li.textContent);
    expect(counts).toEqual(['Building1', 'Early look1', 'Reviewed1', 'PR open0', 'Merged0']);
    const priya = within(board).getByRole('listitem', { name: "Priya's lane" });
    expect(within(priya).getByText('Parking map')).toBeTruthy();
    expect(within(priya).getByText('crew/priya/parking-map')).toBeTruthy();
    expect(within(priya).getByText('Reviewed · v2')).toBeTruthy();
    expect(within(priya).getByText('checkpointed 2 min ago')).toBeTruthy();
    expect(within(priya).getByText('Race with Sam')).toBeTruthy();
    const sam = within(board).getByRole('listitem', { name: "Sam's lane" });
    expect(within(sam).getByText('Needs a rebase')).toBeTruthy();
    expect(within(sam).getByText('Header.tsx clashes')).toBeTruthy();
    expect(within(sam).getByText('On the wall')).toBeTruthy();
    expect(within(board).getByRole('listitem', { name: "Ana's lane" }).textContent).toMatch(/Needs help/);
  });

  test('Incoming lists early looks not yet on the wall; each button POSTs its route', async () => {
    await openCrew();
    const inc = screen.getByRole('region', { name: /Incoming/ });
    expect(within(inc).getByText('Parking map')).toBeTruthy();
    expect(within(inc).queryByText('Parking as a list')).toBeNull();
    expect(within(inc).getByText('Claude: Merge after changes')).toBeTruthy();
    await press(within(inc).getByRole('button', { name: 'Put on the wall' }));
    await expectPost('crew/shares/s1', { action: 'feature' });
    await press(within(inc).getByRole('button', { name: 'Ask Claude to review' }));
    await expectPost('crew/shares/s1/review-request', {});
    fireEvent.click(within(inc).getByRole('button', { name: 'Open' }));
    expect(screen.getByRole('dialog', { name: 'Early look: Parking map' })).toBeTruthy();
  });

  test('help: the note, Send my Claude and Mark handled', async () => {
    const board = await openCrew();
    const help = within(board).getByRole('region', { name: 'Ana asks for help' });
    expect(within(help).getByText('Where do shift times live?')).toBeTruthy();
    await press(within(help).getByRole('button', { name: /Send my Claude/ }));
    await expectPost('crew/help/Ana', { action: 'send-claude' });
    await press(within(help).getByRole('button', { name: /Mark handled/ }));
    await expectPost('crew/help/Ana', { action: 'resolve' });
  });

  test('the base moved: a recent move shows who synced and who needs a rebase; an old one does not', async () => {
    const moved = { ...CREW_ON, baseCommit: '7f3c2a1ffff', baseNote: "Priya's Parking map", baseMovedAt: ago(120) };
    const builders = [
      { SK: 'BUILD#BLD#Priya', PlayerName: 'Priya', Status: 'synced' },
      { SK: 'BUILD#BLD#Sam', PlayerName: 'Sam', Status: 'needs-rebase' },
      { SK: 'BUILD#BLD#Zed', PlayerName: 'Zed', Status: 'building' },
    ];
    const board = await openCrew(hostState({ crew: moved, builders }));
    const note = within(board).getByRole('region', { name: 'The base moved' });
    expect(note.textContent).toMatch(/Base moved to 7f3c2a1: Priya's Parking map/);
    expect(within(note).getByText('Priya synced')).toBeTruthy();
    expect(within(note).getByText('Sam: needs a rebase')).toBeTruthy();
    expect(within(note).getByText('Zed: not synced yet')).toBeTruthy();
  });

  test('an old base move shows no notice', async () => {
    const board = await openCrew(hostState({ crew: { ...CREW_ON, baseMovedAt: ago(3 * 3600) } }));
    expect(within(board).queryByRole('region', { name: 'The base moved' })).toBeNull();
  });
});

describe('an early look', () => {
  async function openLook() {
    const board = await openCrew();
    fireEvent.click(within(within(board).getByRole('listitem', { name: "Priya's lane" })).getByRole('button', { name: /Open the early look/ }));
    return screen.getByRole('dialog', { name: 'Early look: Parking map' });
  }

  test('version tabs, the words, the numbers, where the code is, names and the review card', async () => {
    const d = await openLook();
    expect(within(d).getByRole('tab', { name: 'v2' }).getAttribute('aria-selected')).toBe('true');
    expect(within(d).getByText('Lit lots marked at night.')).toBeTruthy();
    expect(within(d).getByRole('group', { name: 'The change in numbers' }).textContent).toMatch(/1 file.*\+40.*−2.*a1b2c3d/);
    fireEvent.click(within(d).getByRole('tab', { name: 'v1' }));
    expect(within(d).getByText('A map of the three lots under the calendar.')).toBeTruthy();
    expect(within(d).getByText('Lot hours are typed in by hand.')).toBeTruthy();
    expect(within(d).getByText('Is a map better than a list?')).toBeTruthy();
    expect(within(d).getByRole('link', { name: 'https://github.com/george/foodbank/pull/7' })).toBeTruthy();
    expect(within(d).getByText('crew/priya/parking-map')).toBeTruthy();
    expect(within(d).getByRole('link', { name: CREW_ON.repoUrl })).toBeTruthy();
    expect(d.textContent).not.toMatch(/Fork|priya-k/);
    // The host sees who said what.
    expect(within(d).getAllByText('Dee').length).toBeGreaterThan(0);
    expect(within(d).getByText('Marcus')).toBeTruthy();
    const reacts = within(d).getByRole('group', { name: 'Reactions' }).textContent;
    expect(reacts).toMatch(/Looks right 1/);
    expect(reacts).toMatch(/Question 1/); // one person, one reaction: Dee's latest
    expect(reacts).toMatch(/Concern 1/);
    const review = within(d).getByRole('region', { name: 'Review by Claude on v2' });
    expect(within(review).getByText('Merge after changes')).toBeTruthy();
    expect(within(review).getByText('Move hours into lots.json')).toBeTruthy();
    expect(within(review).getByText('2')).toBeTruthy();
    expect(review.textContent).toMatch(/Read the code only; ran nothing of theirs\. Run crew code was Off at review time\./);
  });

  test('Write feedback starts from the room\'s questions and concerns, is editable, and goes to the builder\'s Claude', async () => {
    const d = await openLook();
    fireEvent.click(within(d).getByRole('button', { name: /Write feedback/ }));
    const box = within(d).getByRole('textbox', { name: 'Feedback' });
    expect(box.value).toBe('1 in the room said it looks right.\nThe room asked:\n- Does it work at night?\nConcerns:\n- Lot C closes at noon on Saturdays.');
    expect(box.value).not.toMatch(/old question about v1/);
    fireEvent.change(box, { target: { value: 'Keep the map. Show which lots are lit.' } });
    await press(within(d).getByRole('button', { name: "Send to Priya's Claude" }));
    await expectPost('crew/shares/s1/feedback', { text: 'Keep the map. Show which lots are lit.' });
  });

  test('host actions: on the wall, review, not now, back in the lane, reply', async () => {
    const d = await openLook();
    await press(within(d).getByRole('button', { name: /Put on the wall/ }));
    await expectPost('crew/shares/s1', { action: 'feature' });
    await press(within(d).getByRole('button', { name: /Ask Claude to review/ }));
    await expectPost('crew/shares/s1/review-request', {});
    await press(within(d).getByRole('button', { name: 'Not now' }));
    await expectPost('crew/shares/s1', { action: 'not-now' });
    fireEvent.change(within(d).getByRole('textbox', { name: 'Reply on this early look' }), { target: { value: '2: yes please' } });
    await press(within(d).getByRole('button', { name: 'Post' }));
    await expectPost('crew/shares/s1/comments', { text: '2: yes please' });
  });

  test('a featured one comes off the wall; a set-aside one goes back in the lane; a javascript: PR link stays text', async () => {
    const parked = { ...PRIYA_SHARE, Lane: 'not-now' };
    const board = await openCrew(hostState({ shares: [parked, SAM_SHARE] }));
    fireEvent.click(within(within(board).getByRole('listitem', { name: "Sam's lane" })).getByRole('button', { name: /Open the early look/ }));
    const d = screen.getByRole('dialog', { name: 'Early look: Parking as a list' });
    // The repo is a real https link; the PR is not, so it stays text.
    expect(within(d).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual([CREW_ON.repoUrl]);
    expect(within(d).getByText('javascript:alert(1)')).toBeTruthy();
    await press(within(d).getByRole('button', { name: /Take off the wall/ }));
    await expectPost('crew/shares/s2', { action: 'unfeature' });
    fireEvent.click(within(d).getAllByRole('button', { name: 'Close' })[0]);
    // Priya's is set aside: it is in no lane, so it is not in Incoming either.
    expect(within(screen.getByRole('region', { name: /Incoming/ })).queryByText('Parking map')).toBeNull();
  });

  test('a builder whose work merged, with nothing open, reads Merged, not Building', async () => {
    const board = await openCrew(hostState({ shares: [{ ...PRIYA_SHARE, Lane: 'merged' }, SAM_SHARE] }));
    const lane = within(board).getByRole('listitem', { name: "Priya's lane" });
    expect(within(lane).getByText('Merged')).toBeTruthy();
    expect(within(lane).queryByText('Building')).toBeNull();
  });

  test('closing with written feedback asks first', async () => {
    const d = await openLook();
    fireEvent.click(within(d).getByRole('button', { name: /Write feedback/ }));
    fireEvent.change(within(d).getByRole('textbox', { name: 'Feedback' }), { target: { value: 'Changed' } });
    window.confirm.mockReturnValue(false);
    fireEvent.click(within(d).getAllByRole('button', { name: 'Close' })[0]);
    expect(window.confirm).toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Early look: Parking map' })).toBeTruthy();
  });
});

describe('tasks', () => {
  test('claimed-by chips and a race; add, edit, done and delete each POST their route', async () => {
    await openCrew();
    const panel = screen.getByRole('region', { name: 'Tasks' });
    const rows = within(panel).getAllByRole('row').slice(1);
    expect(rows[0].textContent).toMatch(/Parking map.*Priya.*Sam.*Race/);
    expect(rows[2].textContent).toMatch(/Dark mode.*Open/);

    fireEvent.click(within(panel).getByRole('button', { name: /Add a task/ }));
    let dlg = screen.getByRole('dialog', { name: 'Add a task' });
    fireEvent.change(within(dlg).getByRole('textbox', { name: /^Task/ }), { target: { value: 'Shift reminders by SMS' } });
    fireEvent.change(within(dlg).getByRole('textbox', { name: /^Detail/ }), { target: { value: 'A text the day before' } });
    await press(within(dlg).getByRole('button', { name: 'Add task' }));
    await expectPost('crew/tasks', { text: 'Shift reminders by SMS', detail: 'A text the day before' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    fireEvent.click(within(panel).getByRole('button', { name: 'Edit Dark mode' }));
    dlg = screen.getByRole('dialog', { name: 'Edit the task' });
    fireEvent.change(within(dlg).getByRole('textbox', { name: /^Task/ }), { target: { value: 'Dark mode for the wall' } });
    await press(within(dlg).getByRole('button', { name: 'Save task' }));
    await expectPost('crew/tasks/003', { action: 'edit', text: 'Dark mode for the wall', detail: '' });

    await press(within(panel).getByRole('button', { name: 'Mark Confirmation text done' }));
    await expectPost('crew/tasks/002', { action: 'done' });

    fireEvent.click(within(panel).getByRole('button', { name: 'Delete Dark mode' }));
    await press(within(panel).getByRole('button', { name: 'Delete' }));
    await expectPost('crew/tasks/003', { action: 'delete' });
  });
});

describe('Present mode (the wall)', () => {
  async function present(state) {
    const board = await openCrew(state);
    fireEvent.click(screen.getByRole('button', { name: /Present/ }));
    return board;
  }

  test('no Incoming, no switch, no host controls, no crew dialog door', async () => {
    await present();
    expect(screen.queryByRole('region', { name: /Incoming/ })).toBeNull();
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByRole('button', { name: /Open to a crew|^Crew$/ })).toBeNull();
    ['Put on the wall', 'Ask Claude to review', 'Add a task', 'Send my Claude', 'Mark handled', 'Write feedback'].forEach((name) => {
      expect(screen.queryByRole('button', { name: new RegExp(name) })).toBeNull();
    });
    expect(screen.queryByRole('button', { name: /Open the early look/ })).toBeNull();
    // Help is visible as a chip; what Ana wrote is the host's.
    expect(screen.queryByText('Where do shift times live?')).toBeNull();
    expect(screen.getByRole('listitem', { name: "Ana's lane" }).textContent).toMatch(/Needs help/);
  });

  test('the featured early look is the stage, the room is anonymous, and no fork or PR link shows', async () => {
    await present(hostState({ logs: [{ Kind: 'help', By: 'builder', Name: 'Ana', Text: 'Where do shift times live?' }] }));
    const look = screen.getByRole('article', { name: 'Early look: Parking as a list' });
    expect(within(look).getByText('Lots as a list with walking times.')).toBeTruthy();
    expect(within(look).getByText('How far is Lot B?')).toBeTruthy();
    expect(within(look).queryByText('Marcus')).toBeNull();
    expect(within(look).getByText('Anonymous on the wall.')).toBeTruthy();
    expect(within(look).queryByRole('link')).toBeNull();
    expect(screen.queryByText('Parking map', { selector: '.brc-look-title' })).toBeNull();
    // The timeline on the wall says who asked for help, not what.
    expect(screen.getByText('Ana asked for help')).toBeTruthy();
    expect(screen.queryByText('Where do shift times live?')).toBeNull();
  });
});

describe('the client', () => {
  test('crewBase and the other crew routes build the right paths', async () => {
    serve(hostState());
    const api = buildApi(GAME);
    await api.crewBase({ commit: '7f3c2a1', shareId: 's1' });
    expect(path(lastPost())).toBe(`games/${GAME}/build/crew/base`);
    expect(lastPost().body).toEqual({ commit: '7f3c2a1', shareId: 's1' });
    await api.crewHelpAction('Ana Lee', 'resolve');
    expect(path(lastPost())).toBe(`games/${GAME}/build/crew/help/Ana%20Lee`);
  });

  test('feedbackDraft is empty when the room said nothing', () => {
    expect(feedbackDraft({ versions: [{ v: 1 }], comments: [] })).toBe('');
  });
});
