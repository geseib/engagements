/**
 * CREW MODE ON THE PHONE — buildroom/BuildPlayerCrew.jsx inside BuildPlayer.
 *
 * Every fixture is computed by the REAL views: build-store.js `roomFromRows`
 * → `publicView`, plus build-crew.js `crewView(room, 'public', me)`, exactly
 * as build-room.js routePlay assembles GET build-play/state. Every POST body
 * is the one routePlayCrew reads.
 *
 * rejects: a key shown without the /engage:connect line, or shown again after
 * Done; a claim or reaction body the server would not read; a question or
 * concern sent without words; a room comment carrying a name; a builder's
 * unfeatured early look without its "only you and the host" notice.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import BuildPlayer from '../buildroom/BuildPlayer';
import { pipelineLine } from '../buildroom/BuildPlayerCrew';

// These pin prod's plugin names (/engage:…). setupTests.js runs every suite as the
// test site, whose plugin is engage-test (buildPluginTier.test.js covers the tiers).
beforeEach(() => { window.ENV = 'production'; });
afterEach(() => { window.ENV = 'test'; });

const S = require('../../../lambda-functions/game/build-store');
const C = require('../../../lambda-functions/game/build-crew');

const API = 'http://localhost:3000/api/';
const GAME = '4821';
const CID = 'cid-1';
const T = (m) => `2026-10-02T20:${String(m).padStart(2, '0')}:00.000Z`;

const KEY = 'eng_4821_7Hq2vX9mK3sLabcdef';

function rows({ builders = ['Priya', 'Sam'], featured = true, base = false, lane = 'reviewed' } = {}) {
  const out = [
    {
      SK: 'BUILD#STATE',
      Rev: 9,
      Crew: {
        enabled: true,
        repoUrl: 'https://github.com/george/foodbank',
        baseBranch: 'build-room/4821',
        baseCommit: base ? '7f3c2a1aa' : 'e91b04d',
        baseNote: '',
        baseMovedAt: base ? T(26) : null,
        runCrewCode: true,
      },
    },
    { SK: 'BUILD#TASK#001', TaskId: '001', Text: 'Parking map', Detail: 'Lots and walking times', ClaimedBy: ['Priya', 'Sam'], State: 'open', CreatedAt: T(1) },
    { SK: 'BUILD#TASK#002', TaskId: '002', Text: 'Confirmation text', ClaimedBy: [], State: 'open', CreatedAt: T(2) },
    { SK: 'BUILD#TASK#003', TaskId: '003', Text: 'Dark mode', ClaimedBy: [], State: 'deleted', CreatedAt: T(3) },
    {
      SK: 'BUILD#SHR#s1', ShareId: 's1', Builder: 'Priya', TaskId: '001', Title: 'Parking map', Lane: lane, Featured: featured,
      PrUrl: 'https://github.com/george/foodbank/pull/7',
      Versions: [
        { v: 1, summary: 'A map of the three lots.', imageIds: ['aaa111'], commit: '3b9e1f0', createdAt: T(5) },
        { v: 2, summary: 'Lit lots marked.', unsure: 'Lot hours are typed in by hand.', feedbackWanted: 'Is a map better than a list?', imageIds: ['bbb222'], commit: '9c41d7a', branch: 'crew/priya/parking-map', createdAt: T(11) },
      ],
      CreatedAt: T(5), UpdatedAt: T(11),
    },
    { SK: C.SK.comment('s1', T(7)), ShareId: 's1', Kind: 'question', By: 'room', Name: 'Ana', Text: 'Does it work at night?', Version: 1, CreatedAt: T(7) },
    { SK: C.SK.comment('s1', T(8)), ShareId: 's1', Kind: 'concern', By: 'room', Name: 'Marcus', Text: 'Lot C closes at noon.', Version: 1, CreatedAt: T(8) },
    { SK: C.SK.comment('s1', T(9)), ShareId: 's1', Kind: 'feedback', By: 'host', Name: 'Host', Text: 'Show which lots are lit at night.', Version: 1, CreatedAt: T(9) },
    { SK: C.SK.review('s1', T(12)), ShareId: 's1', Version: 2, Does: 'Adds a map of three lots.', Recommendation: 'merge-after-changes', RunCrewCode: false, CreatedAt: T(12) },
  ];
  if (base) out.push({ SK: 'BUILD#LOG#0000000000026#z', LogId: '26-z', Kind: 'base', Text: "Base moved to 7f3c2a1: Priya's Parking map", By: 'agent', CreatedAt: T(26) });
  for (const name of builders) {
    out.push({
      SK: C.SK.builder(name), PlayerName: name, Branch: `crew/${name.toLowerCase()}/parking-map`, TaskId: '001',
      Status: name === 'Sam' ? 'needs-rebase' : 'building', Note: name === 'Sam' ? 'Header.tsx clashes' : '',
    });
  }
  return out;
}

/** GET build-play/state, as routePlay builds it. */
function phoneView(name, opts) {
  const room = S.roomFromRows(rows(opts));
  const me = { playerName: name };
  const view = S.publicView({ gameId: GAME, meta: { Title: 'Food bank sign-up' }, sessionState: 'STARTED', room, players: ['Priya', 'Sam', 'Ana', 'Marcus', 'Dee'], me, now: T(30) });
  view.crew = C.crewView(room, 'public', me);
  return view;
}

let responder;
const calls = () => global.fetch.mock.calls.map(([url, init]) => ({
  url: String(url), method: (init && init.method) || 'GET', body: init && init.body ? JSON.parse(init.body) : null,
}));
const posts = (route) => calls().filter((c) => c.method === 'POST' && c.url.endsWith(`/build-play/${route}`));

function serve(view, postReply = () => ({ status: 200, body: { ok: true } })) {
  responder = { view, postReply };
  global.fetch.mockImplementation((url, init) => {
    const method = (init && init.method) || 'GET';
    if (method === 'GET') return Promise.resolve({ ok: true, status: 200, json: async () => responder.view });
    const r = responder.postReply(String(url), JSON.parse(init.body));
    return Promise.resolve({ ok: r.status < 400, status: r.status, json: async () => r.body });
  });
}

async function mount(name) {
  let utils;
  await act(async () => {
    utils = render(<BuildPlayer gameId={GAME} playerName={name} clientId={CID} apiBase={API} rev={0} />);
  });
  await screen.findByRole('region', { name: 'The crew' });
  return utils;
}

beforeEach(() => { global.fetch.mockReset(); });

describe('the room\'s phone', () => {
  test('the real public view: pipeline line, the featured early look, anonymous comments', async () => {
    const view = phoneView('Dee');
    expect(view.crew.me).toBeNull();
    serve(view);
    await mount('Dee');
    expect(screen.getByText('1 building · 1 reviewed')).toBeInTheDocument();
    const look = screen.getByRole('article', { name: 'Early look: Parking map' });
    expect(within(look).getByText(/Priya · v2 of 2/)).toBeInTheDocument();
    expect(within(look).getByText('Lit lots marked.')).toBeInTheDocument();
    expect(within(look).getByText('Lot hours are typed in by hand.')).toBeInTheDocument();
    expect(within(look).getByText('Merge after changes')).toBeInTheDocument();
    expect(within(look).getByText('Reviewed')).toBeInTheDocument();
    // The room is anonymous on a phone; the host's feedback says it is the host's.
    const cm = within(look).getByRole('list', { name: 'What the room said' });
    expect(within(cm).getByText('Does it work at night?')).toBeInTheDocument();
    expect(within(cm).getAllByText(/^(Question|Concern)$/)).toHaveLength(2);
    expect(within(cm).getByText('Feedback · Host')).toBeInTheDocument();
    expect(look.textContent).not.toMatch(/Ana|Marcus/);
    // A phone never gets the PR link.
    expect(look.textContent).not.toMatch(/github\.com/);
    expect(within(look).getByText(/Looks right/, { selector: '.bpl-rxn span' })).toBeInTheDocument();
  });

  test('an early look not on the wall is not on a room phone', async () => {
    serve(phoneView('Dee', { featured: false }));
    await mount('Dee');
    expect(screen.queryByRole('article')).toBeNull();
  });

  test('Looks right is one tap; the POST body is what routePlayCrew reads', async () => {
    serve(phoneView('Dee'), () => ({ status: 201, body: { ok: true } }));
    await mount('Dee');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Looks right' })); });
    expect(posts('crew/react')[0].body).toEqual({ playerName: 'Dee', clientId: CID, shareId: 's1', kind: 'looks-right' });
  });

  test('a question needs words: nothing is sent without them, then the text goes with it', async () => {
    serve(phoneView('Dee'), () => ({ status: 201, body: { ok: true } }));
    await mount('Dee');
    fireEvent.click(screen.getByRole('button', { name: 'Question' }));
    const send = screen.getByRole('button', { name: 'Send question' });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Your question'), { target: { value: '   ' } });
    expect(send).toBeDisabled();
    expect(posts('crew/react')).toHaveLength(0);
    fireEvent.change(screen.getByLabelText('Your question'), { target: { value: ' How far is Lot B? ' } });
    expect(screen.getByText('Anonymous on the wall.')).toBeInTheDocument();
    await act(async () => { fireEvent.click(send); });
    expect(posts('crew/react')[0].body).toEqual({ playerName: 'Dee', clientId: CID, shareId: 's1', kind: 'question', text: 'How far is Lot B?' });
  });

  test('my own reaction reads "You said", the latest wins, and it is pressed', async () => {
    // Marcus raised a concern; from his own phone the server names it "You".
    serve(phoneView('Marcus'));
    await mount('Marcus');
    const look = screen.getByRole('article', { name: 'Early look: Parking map' });
    expect(within(look).getByText(/You said:/).textContent).toMatch(/You said: Concern: Lot C closes at noon\./);
    // Said once: the list does not repeat it.
    expect(within(look).queryByText('Concern · You')).toBeNull();
    expect(within(look).getAllByText('Lot C closes at noon.', { exact: false })).toHaveLength(1);
    expect(within(look).getByRole('button', { name: 'Concern' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(look).getByRole('button', { name: 'Looks right' })).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('becoming a builder', () => {
  test('"Want to build too?" is optional, explains, mints on "I have Claude Code", and shows the key ONCE with the /engage:connect line', async () => {
    const before = phoneView('Dee');
    serve(before, (url) => {
      if (url.endsWith('crew/builder-key')) {
        responder.view = phoneView('Dee', { builders: ['Priya', 'Sam', 'Dee'] });
        return { status: 201, body: { key: KEY, gameId: GAME } };
      }
      return { status: 200, body: {} };
    });
    await mount('Dee');
    const join = screen.getByRole('region', { name: 'Want to build too?' });
    expect(within(join).getByText(/Needs Claude Code and the repo\./)).toBeInTheDocument();
    expect(within(join).getByText('Everyone else: just follow along here.')).toBeInTheDocument();
    // One shared repo, a branch each: the phone never talks about forks or patches.
    expect(document.body.textContent).not.toMatch(/fork|patch/i);
    await act(async () => { fireEvent.click(within(join).getByRole('button', { name: 'I have Claude Code' })); });
    expect(posts('crew/builder-key')[0].body).toEqual({ playerName: 'Dee', clientId: CID });

    const card = await screen.findByRole('region', { name: 'Your builder key' });
    expect(within(card).getByText(`/engage:connect ${KEY}`)).toBeInTheDocument();
    expect(within(card).getByText('No plugin? Ask the host.')).toBeInTheDocument();
    expect(within(card).getByText(/shown once/)).toBeInTheDocument();

    const writeText = jest.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });
    await act(async () => { fireEvent.click(within(card).getByRole('button', { name: 'Copy' })); });
    expect(writeText).toHaveBeenCalledWith(`/engage:connect ${KEY}`);
    expect(within(card).getByRole('button', { name: 'Copied' })).toBeInTheDocument();

    // Now a builder: the lane, and no way back in through the join card.
    await waitFor(() => expect(screen.getByRole('region', { name: 'Your lane' })).toBeInTheDocument());
    expect(screen.queryByRole('region', { name: 'Want to build too?' })).toBeNull();
    expect(document.body.textContent).not.toMatch(/fork|patch/i);

    fireEvent.click(within(card).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('region', { name: 'Your builder key' })).toBeNull();
    expect(document.body.textContent).not.toContain(KEY);
    // A refetch never brings it back: the server never sends it again.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Looks right' })); });
    await waitFor(() => expect(posts('crew/react')).toHaveLength(1));
    expect(document.body.textContent).not.toContain(KEY);
  });

  test('a full crew says so and offers no key', async () => {
    serve(phoneView('Dee', { builders: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] }));
    await mount('Dee');
    const join = screen.getByRole('region', { name: 'Want to build too?' });
    expect(within(join).getByText(/The crew is full\./)).toBeInTheDocument();
    expect(within(join).queryByRole('button')).toBeNull();
  });
});

describe('a builder\'s phone', () => {
  test('Your lane: task, status, feedback, latest screenshot slot, open tasks with the race', async () => {
    serve(phoneView('Priya'));
    await mount('Priya');
    const lane = screen.getByRole('region', { name: 'Your lane' });
    expect(lane.querySelector('.bpl-eyebrow').textContent).toBe('Your lane · Parking map');
    expect(within(lane).getByText('Building')).toBeInTheDocument();
    expect(within(lane).getByText('crew/priya/parking-map')).toBeInTheDocument();
    expect(within(lane).getByText('Show which lots are lit at night.')).toBeInTheDocument();
    expect(within(lane).getByText('Race: Sam has it too')).toBeInTheDocument();
    // Deleted tasks are gone; the open one not mine can be taken.
    expect(within(lane).queryByText('Dark mode')).toBeNull();
    expect(within(lane).getAllByRole('button', { name: /Take this task/ })).toHaveLength(1);
  });

  test('Take this task POSTs crew/claim with the taskId', async () => {
    serve(phoneView('Priya'), () => ({ status: 200, body: { taskId: '002', builder: 'Priya' } }));
    await mount('Priya');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Take this task\s*: Confirmation text$/ })); });
    expect(posts('crew/claim')[0].body).toEqual({ playerName: 'Priya', clientId: CID, taskId: '002' });
  });

  test('needs a rebase shows with the note', async () => {
    serve(phoneView('Sam'));
    await mount('Sam');
    const lane = screen.getByRole('region', { name: 'Your lane' });
    expect(within(lane).getByText('Needs a rebase')).toBeInTheDocument();
    expect(within(lane).getByText('Header.tsx clashes')).toBeInTheDocument();
    expect(within(lane).getByText('Race: Priya has it too')).toBeInTheDocument();
  });

  test('their own early look, not on the wall yet: marked, and no reaction buttons on their own work', async () => {
    const view = phoneView('Priya', { featured: false });
    expect(view.crew.shares).toHaveLength(1);
    serve(view);
    await mount('Priya');
    const look = screen.getByRole('article', { name: 'Early look: Parking map' });
    expect(within(look).getByText('Private until it is on the wall.')).toBeInTheDocument();
    expect(within(look).getByText(/Yours · v2/)).toBeInTheDocument();
    expect(within(look).queryByRole('button', { name: 'Looks right' })).toBeNull();
    expect(look.className).toMatch(/bpl-el--private/);
  });

  test('once their work is merged, the lane says Merged and the old feedback goes', async () => {
    serve(phoneView('Priya', { lane: 'merged' }));
    await mount('Priya');
    const lane = screen.getByRole('region', { name: 'Your lane' });
    expect(within(lane).getByText('Merged')).toBeInTheDocument();
    expect(within(lane).queryByText('Building')).toBeNull();
    expect(within(lane).queryByText('Show which lots are lit at night.')).toBeNull();
  });

  test('on the wall, the notice goes', async () => {
    serve(phoneView('Priya'));
    await mount('Priya');
    expect(screen.queryByText(/Private until it is on the wall/)).toBeNull();
  });
});

describe('the base moved, in the watch feed', () => {
  test('the notice names the commit and what was merged, said once; builders hear their Claude was told', async () => {
    serve(phoneView('Sam', { base: true }));
    await mount('Sam');
    const feed = screen.getByRole('region', { name: 'Watch the build' });
    const notice = within(feed).getByRole('status');
    expect(notice.textContent).toMatch(/build-room\/4821 is now at 7f3c2a1: Priya's Parking map/);
    expect(within(notice).getByText('Your Claude has been told to pull it in.')).toBeInTheDocument();
    expect(within(feed).queryByText("Base moved to 7f3c2a1: Priya's Parking map")).toBeNull();
  });

  test('a room phone gets the notice without the builder line', async () => {
    serve(phoneView('Dee', { base: true }));
    await mount('Dee');
    const notice = within(screen.getByRole('region', { name: 'Watch the build' })).getByRole('status');
    expect(notice.textContent).not.toMatch(/Your Claude/);
  });
});

describe('the crew stays out of the way of an ask', () => {
  test('a live ask comes first; the crew sits after it', async () => {
    const v = phoneView('Dee');
    v.current = {
      askId: '005', kind: 'suggest', prompt: 'What would stop a sign-up?', detail: '', status: 'live', source: 'host',
      options: [], scale: null, maxPicks: 3, responses: [], results: null, decision: null,
    };
    v.currentAskId = '005';
    serve(v);
    const { container } = await mount('Dee');
    const prompt = screen.getByText('What would stop a sign-up?');
    const crew = screen.getByRole('region', { name: 'The crew' });
    // eslint-disable-next-line no-bitwise
    expect(prompt.compareDocumentPosition(crew) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelector('.plr-btn').textContent).toBe('Suggest');
  });

  test('crew off: no crew section at all', async () => {
    const v = phoneView('Dee');
    v.crew = { enabled: false };
    serve(v);
    await act(async () => {
      render(<BuildPlayer gameId={GAME} playerName="Dee" clientId={CID} apiBase={API} rev={0} />);
    });
    await screen.findByText('Claude is building');
    expect(screen.queryByRole('region', { name: 'The crew' })).toBeNull();
  });
});

test('pipelineLine says only the stages something is in', () => {
  expect(pipelineLine({ building: 2, shared: 1, reviewed: 0, pr: 0, merged: 1, 'not-now': 3 })).toBe('2 building · 1 early look · 1 merged');
  expect(pipelineLine({ building: 0, shared: 2, pr: 1 })).toBe('2 early looks · 1 pull request');
  expect(pipelineLine({})).toBe('Nobody is building yet');
});
