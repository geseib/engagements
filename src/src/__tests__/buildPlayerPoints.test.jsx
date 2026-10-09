/**
 * THE ROOM'S SCREEN AND A BUILDER'S, FOR TALKING POINTS (Task 5)
 * docs/superpowers/plans/2026-10-09-build-room-talking-points.md;
 * mockups docs/design/build-room-talking-points T4, T5b, T7c, T8.
 *
 * Fixtures are computed by the REAL views: build-store.js roomFromRows ->
 * publicView, build-crew.js crewView, and pointsBuilderView, exactly as
 * build-room.js routePlay assembles GET build-play/state.
 *
 * rejects: a participant's name on a phone; a point's detail or sources list on
 * a phone; a builder's request that names someone else; another builder's
 * points on a builder's lane; a run line while the list is not running.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import BuildPlayer from '../buildroom/BuildPlayer';

const S = require('../../../lambda-functions/game/build-store');
const C = require('../../../lambda-functions/game/build-crew');

const API = 'http://localhost:3000/api/';
const GAME = '4821';
const CID = 'cid-1';
const T = (m) => `2026-10-09T20:${String(m).padStart(2, '0')}:00.000Z`;
const PLAYERS = ['Priya', 'Sam', 'Ana', 'Marcus', 'Dee'];

const OPTS = [1, 2, 3, 4, 5].map((n, i) => ({ label: String.fromCharCode(65 + i), title: `Option text ${n}`, detail: '', url: '' }));

function rows({
  ask = null, shown = null, run = null, points = [], preqs = [], crew = false,
} = {}) {
  const out = [{ SK: 'BUILD#STATE', Rev: 9, ...(ask ? { CurrentAskId: ask.AskId } : {}), ...(crew ? { Crew: { enabled: true, repoUrl: 'https://github.com/george/foodbank', baseBranch: 'build-room/4821', baseCommit: 'e91b04d', runCrewCode: true } } : {}) }];
  if (ask) out.push({ SK: `BUILD#ASK#${ask.AskId}`, Source: 'host', CreatedAt: T(1), ...ask });
  for (const p of points) out.push({ SK: `BUILD#POINT#${p.PointId.padStart(13, '0')}`, ...p });
  for (const r of preqs) out.push({ SK: `BUILD#PREQ#${r.ReqId.padStart(13, '0')}`, ...r });
  if (shown) out.push({ SK: 'BUILD#POINT#0000000000999', PointId: 'ps', Kind: shown.kind || 'finding', Text: shown.text, Detail: 'host-only detail', Status: 'shown', By: shown.by || 'claude', ByRole: shown.by ? 'builder' : 'agent', CreatedAt: T(3), Sources: shown.kind === 'talk' ? [] : [{ title: 'Contrast checker', url: 'https://webaim.org/resources/contrastchecker/' }] });
  if (run) out.push({ SK: 'BUILD#RUN', ...run });
  if (crew) {
    out.push({ SK: 'BUILD#TASK#001', TaskId: '001', Text: 'Parking map', Detail: '', ClaimedBy: ['Priya'], State: 'open', CreatedAt: T(1) });
    out.push({ SK: C.SK.builder('Priya'), PlayerName: 'Priya', Branch: 'crew/priya/parking-map', TaskId: '001', Status: 'building', Note: '' });
    out.push({ SK: C.SK.builder('Sam'), PlayerName: 'Sam', Branch: 'crew/sam/x', TaskId: '', Status: 'building', Note: '' });
  }
  return out;
}

/** GET build-play/state, as routePlay builds it. */
function phoneView(name, opts) {
  const room = S.roomFromRows(rows(opts));
  const me = { playerName: name };
  const view = S.publicView({ gameId: GAME, meta: { Title: 'Food bank sign-up' }, sessionState: 'STARTED', room, players: PLAYERS, me, now: T(30) });
  view.crew = C.crewView(room, 'public', me);
  if (room.builders.some((b) => b.PlayerName === me.playerName)) view.myPoints = S.pointsBuilderView(room, me.playerName);
  return view;
}

const VOTE_ASK = {
  AskId: '005', Kind: 'choice', Prompt: 'Which should Claude take on next?', Detail: '', MaxPicks: 3, Status: 'live', OpenedAt: T(2),
  FromPoints: ['p1', 'p2', 'p3', 'p4', 'p5'],
  Options: OPTS.map((o, i) => ({ ...o, pointId: `p${i + 1}` })),
};
const RUN = (over = {}) => ({
  RunId: 'r1', Status: 'running', Cur: 2, Ver: 3, StartedAt: T(5),
  Marks: ['done', 'doing', 'pending', 'pending'], SentAt: [T(5), T(8), '', ''], DoneAt: [T(7), '', '', ''],
  Items: [1, 2, 3, 4].map((n) => ({ pointId: `p${n}`, text: `Run item ${n} text`, kind: 'idea', site: '', dir: `dir ${n}`, note: n === 1 ? 'Claude secret note' : '' })),
  ...over,
});

let responder;
const calls = () => global.fetch.mock.calls.map(([url, init]) => ({
  url: String(url), method: (init && init.method) || 'GET', body: init && init.body ? JSON.parse(init.body) : null,
}));
const posts = (route) => calls().filter((c) => c.method === 'POST' && c.url.endsWith(`/build-play/${route}`));

function serve(view, postReply = () => ({ status: 201, body: { ok: true } })) {
  responder = { view, postReply };
  global.fetch.mockImplementation((url, init) => {
    const method = (init && init.method) || 'GET';
    if (method === 'GET') return Promise.resolve({ ok: true, status: 200, json: async () => responder.view });
    const r = responder.postReply(String(url), JSON.parse(init.body));
    return Promise.resolve({ ok: r.status < 400, status: r.status, json: async () => r.body });
  });
}

async function mount(name, waitFor_) {
  let utils;
  await act(async () => {
    utils = render(<BuildPlayer gameId={GAME} playerName={name} clientId={CID} apiBase={API} rev={0} />);
  });
  await screen.findAllByText(waitFor_ || 'Food bank sign-up');
  return utils;
}

beforeEach(() => { global.fetch.mockReset(); });

describe('the vote from points, on a phone', () => {
  test('Pick up to 3: the rule counts, the rest dim at the limit, and the picks go as one answer', async () => {
    const view = phoneView('Dee', { ask: VOTE_ASK });
    expect(view.current.options.every((o) => !('pointId' in o))).toBe(true);
    expect(view.current.maxPicks).toBe(3);
    serve(view);
    await mount('Dee');
    expect(screen.getByRole('button', { name: 'Pick up to 3' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /Option text 2/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Option text 1/ }));
    expect(document.body.textContent).toMatch('2 of 3 picked.');
    fireEvent.click(screen.getByRole('checkbox', { name: /Option text 4/ }));
    expect(document.body.textContent).toMatch('3 of 3 picked. Untick one to change.');
    expect(screen.getByRole('checkbox', { name: /Option text 5/ })).toHaveAttribute('aria-disabled', 'true');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Pick A \+ B \+ D$/ })); });
    expect(posts('respond')[0].body).toMatchObject({ askId: '005', choice: ['A', 'B', 'D'] });
    expect(document.body.textContent).not.toMatch(/\bAna\b|\bMarcus\b|\bSam\b/);
  });
});

describe('a point on the Stage, on a phone: Talk it over', () => {
  test('the point, where it came from, the source site and an idea box; never the detail or the full source list', async () => {
    const view = phoneView('Dee', { shown: { text: 'Mid oranges on white come out near 2:1.' } });
    expect(view.shownPoint).toMatchObject({ kind: 'finding', site: 'webaim.org', from: 'claude' });
    serve(view);
    await mount('Dee', 'Talk it over');
    const card = screen.getByRole('region', { name: 'Talk it over' });
    expect(within(card).getByText(/From Claude's research/)).toBeInTheDocument();
    expect(within(card).getByText('Mid oranges on white come out near 2:1.')).toBeInTheDocument();
    expect(within(card).getByText('Source: webaim.org')).toBeInTheDocument();
    expect(within(card).getByText(/Talk it over with the people near you\./)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch('host-only detail');
    expect(document.querySelector('a[href*="webaim"]')).toBeNull();
    expect(screen.queryByText('Claude is building')).toBeNull();
  });

  test('the point shows even when the last question is decided (found on dev, 2026-10-09)', async () => {
    const decided = { ...VOTE_ASK, Status: 'decided', DecidedAt: T(4), Decision: { direction: 'Moved forward: x', chosen: ['A'], sendToAgent: false, method: 'vote', as: 'do-now' } };
    serve(phoneView('Dee', { ask: decided, shown: { kind: 'talk', text: 'Is teal the right mood for this room?' } }));
    await mount('Dee', 'Talk it over');
    expect(screen.getByRole('region', { name: 'Talk it over' }).textContent).toMatch('Is teal the right mood for this room?');
  });

  test('a talking point from a builder\'s Claude says whose; a talking point has no source line', async () => {
    serve(phoneView('Dee', { shown: { kind: 'talk', text: 'Is a city at a time enough?', by: 'Priya' } }));
    await mount('Dee', 'Talk it over');
    const card = screen.getByRole('region', { name: 'Talk it over' });
    expect(within(card).getByText(/From Priya's Claude/)).toBeInTheDocument();
    expect(card.textContent).not.toMatch('Source:');
  });

  test('Send idea posts the idea (the server ties it to the point that is up) and says where it went', async () => {
    serve(phoneView('Dee', { shown: { text: 'Mid oranges on white come out near 2:1.' } }));
    await mount('Dee', 'Talk it over');
    const card = screen.getByRole('region', { name: 'Talk it over' });
    const send = within(card).getByRole('button', { name: 'Send idea' });
    expect(send).toBeDisabled();
    fireEvent.change(within(card).getByLabelText('Your idea about this'), { target: { value: 'Use amber for text' } });
    await act(async () => { fireEvent.click(send); });
    expect(posts('idea')).toHaveLength(1);
    expect(posts('idea')[0].body).toEqual({ playerName: 'Dee', clientId: CID, text: 'Use amber for text' });
    expect(await within(card).findByText('Sent to the host, about this point.')).toBeInTheDocument();
  });

  test('an open question comes first; with no point up the screen is as it was', async () => {
    serve(phoneView('Dee', { ask: VOTE_ASK, shown: { text: 'Hidden behind the ask' } }));
    await mount('Dee');
    expect(screen.queryByRole('region', { name: 'Talk it over' })).toBeNull();
    global.fetch.mockReset();
    serve(phoneView('Dee'));
    document.body.innerHTML = '';
  });
});

describe('the run list, on a phone', () => {
  test('Claude is working on 2 of 4: the item, the list with states, no notes, no ids', async () => {
    const view = phoneView('Dee', { run: RUN() });
    expect(view.run.status).toBe('running');
    serve(view);
    await mount('Dee', 'Working through');
    const sec = screen.getByRole('region', { name: 'Working through' });
    expect(within(sec).getByText('Claude is working on 2 of 4: Run item 2 text')).toBeInTheDocument();
    const items = within(sec).getAllByRole('listitem');
    expect(items).toHaveLength(4);
    expect(items[1]).toHaveAttribute('aria-current', 'step');
    expect(within(sec).getByText(/Watch the big screen/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch('Claude secret note');
    expect(screen.queryByText('Claude is building')).toBeNull();
  });

  test('the idea button is still there during a run', async () => {
    serve(phoneView('Dee', { run: RUN() }));
    await mount('Dee', 'Working through');
    expect(screen.getByRole('button', { name: /Send an idea to the host/ })).toBeInTheDocument();
  });

  test('a list that is not running is not on a phone', async () => {
    const view = phoneView('Dee', { run: RUN({ Status: 'finished' }) });
    expect(view.run).toBeNull();
    serve(view);
    await mount('Dee', 'Claude is building');
    expect(screen.queryByRole('region', { name: 'Working through' })).toBeNull();
  });

  test('during a question the run is one line under it', async () => {
    serve(phoneView('Dee', { run: RUN(), ask: { ...VOTE_ASK, MaxPicks: 1 } }));
    await mount('Dee');
    expect(screen.getByText('Claude is working on 2 of 4: Run item 2 text')).toBeInTheDocument();
  });
});

const LANE = {
  crew: true,
  points: [
    { PointId: 'q1', Kind: 'idea', Text: 'Colour each lot by how long it takes to earn its value.', Status: 'voting', By: 'Priya', ByRole: 'builder', BatchId: 'b1', CreatedAt: T(13), Sources: [] },
    { PointId: 'q2', Kind: 'idea', Text: 'Let people drag their own salary onto the map.', Status: 'new', By: 'Priya', ByRole: 'builder', BatchId: 'b1', CreatedAt: T(14), Sources: [] },
    { PointId: 'q3', Kind: 'talk', Text: 'The map loads every lot at once. Is a city at a time enough?', Status: 'sent', By: 'Priya', ByRole: 'builder', BatchId: 'b2', CreatedAt: T(24), Sources: [] },
    { PointId: 'q4', Kind: 'idea', Text: 'Sam only idea', Status: 'new', By: 'Sam', ByRole: 'builder', BatchId: 'b3', CreatedAt: T(25), Sources: [] },
    { PointId: 'q5', Kind: 'talk', Text: 'The host\'s own Claude point', Status: 'new', By: 'claude', ByRole: 'agent', BatchId: 'b4', CreatedAt: T(26), Sources: [] },
  ],
};

describe('a builder\'s lane: Research… and Ideas… for their own task', () => {
  test('the buttons sit under Your lane, with the note; a participant who is not a builder has none', async () => {
    serve(phoneView('Priya', LANE));
    await mount('Priya', 'Your lane');
    const lane = screen.getByRole('region', { name: 'Your lane' });
    expect(within(lane).getByRole('button', { name: 'Research…' })).toBeInTheDocument();
    expect(within(lane).getByRole('button', { name: 'Ideas…' })).toBeInTheDocument();
    expect(within(lane).getByText('For your task. Your Claude does it in a helper and keeps building.')).toBeInTheDocument();
    global.fetch.mockReset();
    serve(phoneView('Dee', LANE));
    document.body.innerHTML = '';
    await mount('Dee');
    expect(screen.queryByRole('button', { name: 'Research…' })).toBeNull();
  });

  test('Research… opens a window titled for the task, filled in from it; Send posts for themselves only', async () => {
    serve(phoneView('Priya', LANE));
    await mount('Priya', 'Your lane');
    fireEvent.click(screen.getByRole('button', { name: 'Research…' }));
    const dlg = screen.getByRole('group', { name: 'Research for Parking map' });
    const box = within(dlg).getByLabelText('What should Claude look up?');
    expect(box).toHaveValue('Parking map');
    fireEvent.change(box, { target: { value: 'parking prices by city' } });
    await act(async () => { fireEvent.click(within(dlg).getByRole('button', { name: 'Send' })); });
    expect(posts('crew/points/requests')).toHaveLength(1);
    expect(posts('crew/points/requests')[0].body).toEqual({ playerName: 'Priya', clientId: CID, kind: 'research', subject: 'parking prices by city' });
    expect(screen.queryByRole('group', { name: 'Research for Parking map' })).toBeNull();
  });

  test('Ideas… is titled Ideas for the task; Send needs words', async () => {
    serve(phoneView('Priya', LANE));
    await mount('Priya', 'Your lane');
    fireEvent.click(screen.getByRole('button', { name: 'Ideas…' }));
    const dlg = screen.getByRole('group', { name: 'Ideas for Parking map' });
    fireEvent.change(within(dlg).getByLabelText('Ideas about what?'), { target: { value: '   ' } });
    expect(within(dlg).getByRole('button', { name: 'Send' })).toBeDisabled();
    fireEvent.click(within(dlg).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('group', { name: 'Ideas for Parking map' })).toBeNull();
  });

  test('a request in flight shows as a chip; one not yet picked up says it waits', async () => {
    const preqs = [
      { ReqId: 'a1', Kind: 'research', Subject: 'parking prices by city', Status: 'working', Count: 0, CreatedAt: T(20), ForBuilder: 'Priya' },
      { ReqId: 'a2', Kind: 'ideas', Subject: 'Priya waits', Status: 'waiting', Count: 0, CreatedAt: T(21), ForBuilder: 'Priya' },
      { ReqId: 'a3', Kind: 'research', Subject: 'Sam subject', Status: 'working', Count: 0, CreatedAt: T(22), ForBuilder: 'Sam' },
      { ReqId: 'a4', Kind: 'research', Subject: 'Host subject', Status: 'working', Count: 0, CreatedAt: T(23) },
    ];
    serve(phoneView('Priya', { ...LANE, preqs }));
    await mount('Priya', 'Your lane');
    expect(screen.getByText('Your Claude is researching: parking prices by city')).toBeInTheDocument();
    expect(screen.getByText(/Priya waits/).textContent).toMatch('Your Claude will start when it reconnects.');
    expect(document.body.textContent).not.toMatch('Sam subject|Host subject');
  });

  test('Your points: only their own, each with what happened to it', async () => {
    serve(phoneView('Priya', LANE));
    await mount('Priya', 'Your lane');
    const list = screen.getByRole('list', { name: 'Your points' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0].textContent).toMatch("In the room's vote");
    expect(items[1].textContent).toMatch('With the host');
    expect(items[2].textContent).toMatch('Sent to Claude');
    expect(screen.getByText(/2 ideas, 1 talking point/)).toBeInTheDocument();
    expect(screen.getByText(/the host chooses what the room sees/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch('Sam only idea');
    expect(document.body.textContent).not.toMatch("host's own Claude point");
  });

  test('no orange of its own: the lane\'s buttons are not the dock\'s button', async () => {
    serve(phoneView('Priya', LANE));
    await mount('Priya', 'Your lane');
    const lane = screen.getByRole('region', { name: 'Your lane' });
    expect(lane.querySelectorAll('.plr-btn')).toHaveLength(0);
  });
});
