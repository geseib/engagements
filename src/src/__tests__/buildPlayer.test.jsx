/**
 * A BUILD ROOM ON THE PHONE — buildroom/BuildPlayer.jsx.
 *
 * Every fixture below is shaped exactly like `publicView` in
 * lambda-functions/game/build-store.js (PLAN.md §6.3 PublicState), and every
 * POST body like `routePlay` in build-room.js reads it.
 *
 * rejects: a screen that does not follow `current.status`; a POST body the
 * server would not read; a phone that can vote for its own suggestion or pick
 * past maxPicks; a refresh that ignores `rev`; a host `note` reaching the
 * room; a `javascript:` link rendered as a link; markup from Claude rendered
 * as markup.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import BuildPlayer, { POLL_MS } from '../buildroom/BuildPlayer';

const API = 'http://localhost:3000/api/';
const GAME = '4821';
const ME = 'Priya';
const CID = 'cid-123';

const mineEmpty = () => ({ responses: [], vote: [], answer: null });

function baseView(over = {}) {
  return {
    gameId: GAME,
    title: 'Food bank sign-up',
    goal: 'A one-page site where a volunteer can pick a Saturday shift.',
    state: 'STARTED',
    playerCount: 3,
    currentAskId: null,
    current: null,
    decisions: [],
    log: [],
    myIdeas: [],
    outcome: null,
    agentConnected: false,
    mine: mineEmpty(),
    rev: 1,
    ...over,
  };
}

function ask(over = {}) {
  return {
    askId: '003',
    kind: 'choice',
    prompt: 'Which header should volunteers see first?',
    detail: '',
    status: 'live',
    source: 'agent',
    options: [],
    scale: null,
    maxPicks: null,
    createdAt: '2026-10-02T19:00:00.000Z',
    openedAt: '2026-10-02T19:01:00.000Z',
    votingAt: null,
    closedAt: null,
    decidedAt: null,
    answerCount: 0,
    voteCount: null,
    responses: [],
    results: null,
    decision: null,
    ...over,
  };
}

const CHOICE_OPTS = [
  { label: 'A', title: 'Bold banner', detail: 'Big orange band', url: '' },
  { label: 'B', title: 'Calm photo + calendar', detail: '', url: 'https://example.com/b' },
  { label: 'C', title: 'Sneaky', detail: '', url: 'javascript:alert(1)' },
];

let responder;
const calls = () => global.fetch.mock.calls.map(([url, init]) => ({
  url: String(url),
  method: (init && init.method) || 'GET',
  body: init && init.body ? JSON.parse(init.body) : null,
}));
const posts = (route) => calls().filter((c) => c.method === 'POST' && c.url.endsWith(`/build-play/${route}`));
const gets = () => calls().filter((c) => c.method === 'GET' && c.url.includes('/build-play/state'));

function serve(view, postReply = () => ({ status: 200, body: { ok: true, mine: mineEmpty() } })) {
  responder = { view, postReply };
  global.fetch.mockImplementation((url, init) => {
    const method = (init && init.method) || 'GET';
    if (method === 'GET') {
      return Promise.resolve({ ok: true, status: 200, json: async () => responder.view });
    }
    const r = responder.postReply(String(url), JSON.parse(init.body));
    return Promise.resolve({ ok: r.status < 400, status: r.status, json: async () => r.body });
  });
}

async function mount(props = {}) {
  let utils;
  await act(async () => {
    utils = render(<BuildPlayer gameId={GAME} playerName={ME} clientId={CID} apiBase={API} rev={0} {...props} />);
  });
  await waitFor(() => expect(gets().length).toBeGreaterThan(0));
  return utils;
}

beforeEach(() => {
  global.fetch.mockReset();
});

describe('loading the room', () => {
  test('GET state carries playerName and clientId, and the page sits inside the player shell', async () => {
    serve(baseView());
    const { container } = await mount();
    const url = gets()[0].url;
    expect(url).toBe(`${API}games/${GAME}/build-play/state?playerName=${ME}&clientId=${CID}`);
    await screen.findByText('Claude is building');
    // `.bpl` borrows the player's ladder and controls, so it must be under `.plr`.
    const bpl = container.querySelector('.bpl');
    expect(bpl.closest('.plr')).not.toBeNull();
    expect(container.querySelector('.plr').getAttribute('data-theme')).toBe('dark');
  });

  test('refetches when rev changes, and polls as a fallback', async () => {
    jest.useFakeTimers();
    try {
      serve(baseView());
      const { rerender } = await mount();
      const before = gets().length;
      await act(async () => {
        rerender(<BuildPlayer gameId={GAME} playerName={ME} clientId={CID} apiBase={API} rev={1} />);
      });
      expect(gets().length).toBe(before + 1);
      await act(async () => { jest.advanceTimersByTime(POLL_MS); });
      expect(gets().length).toBe(before + 2);
    } finally {
      jest.useRealTimers();
    }
  });

  test('a load failure shows the server\'s sentence', async () => {
    global.fetch.mockImplementation(() => Promise.resolve({ ok: false, status: 403, json: async () => ({ error: 'Join the session first' }) }));
    await act(async () => {
      render(<BuildPlayer gameId={GAME} playerName={ME} clientId={CID} apiBase={API} rev={0} />);
    });
    expect(await screen.findByText('Join the session first')).toBeInTheDocument();
  });
});

describe('Ideas (suggest)', () => {
  const live = () => baseView({
    currentAskId: '004',
    current: ask({ askId: '004', kind: 'suggest', prompt: 'What would stop someone from signing up?', maxPicks: 3 }),
    mine: { responses: [{ respId: 'r1', text: 'Having to make an account first' }], vote: [], answer: null },
  });

  test('shows mine so far and POSTs the suggestion with identity and askId', async () => {
    serve(live(), () => {
      const mine = { responses: [{ respId: 'r1', text: 'Having to make an account first' }, { respId: 'r2', text: 'Parking' }], vote: [], answer: null };
      responder.view = { ...responder.view, mine };
      return { status: 200, body: { ok: true, mine } };
    });
    await mount();
    expect(await screen.findByText('Yours so far (1 of 3)')).toBeInTheDocument();
    expect(screen.getByText('Having to make an account first')).toBeInTheDocument();
    expect(screen.getByText(/without your name/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Your suggestion'), { target: { value: '  Parking ' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Suggest' })); });
    expect(posts('respond')[0].body).toEqual({ playerName: ME, clientId: CID, askId: '004', text: 'Parking' });
    await waitFor(() => expect(screen.getByText('Yours so far (2 of 3)')).toBeInTheDocument());
    expect(screen.getByLabelText('Your suggestion')).toHaveValue('');
  });

  test('three suggestions in: no composer, no send', async () => {
    const v = live();
    v.mine.responses = [{ respId: 'a', text: 'one' }, { respId: 'b', text: 'two' }, { respId: 'c', text: 'three' }];
    serve(v);
    await mount();
    expect(await screen.findByText('Yours so far (3 of 3)')).toBeInTheDocument();
    expect(screen.queryByLabelText('Your suggestion')).toBeNull();
    expect(screen.getByRole('button', { name: '3 of 3 sent' })).toBeDisabled();
  });

  test('409 "That question is no longer open" is shown and the room is refetched', async () => {
    serve(live(), () => ({ status: 409, body: { error: 'That question is no longer open' } }));
    await mount();
    await screen.findByText('Yours so far (1 of 3)');
    const before = gets().length;
    fireEvent.change(screen.getByLabelText('Your suggestion'), { target: { value: 'Late' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Suggest' })); });
    expect(await screen.findByText('That question is no longer open')).toBeInTheDocument();
    await waitFor(() => expect(gets().length).toBeGreaterThan(before));
  });
});

describe('Choose (choice)', () => {
  const live = (over = {}) => baseView({
    currentAskId: '003',
    current: ask({ options: CHOICE_OPTS, maxPicks: 1, ...over }),
  });

  test('letter cards, preview only for http(s), POST choice + why', async () => {
    serve(live());
    const { container } = await mount();
    await screen.findByText('Bold banner');
    expect([...container.querySelectorAll('.bpl-letter')].map((n) => n.textContent)).toEqual(['A', 'B', 'C']);
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', 'https://example.com/b');
    expect(links[0]).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getAllByText('Look at the big screen')).toHaveLength(2);
    expect(container.innerHTML).not.toMatch(/javascript:/);

    expect(screen.getByRole('button', { name: 'Pick an option' })).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: /Choice A/ }));
    fireEvent.click(screen.getByRole('radio', { name: /Choice B/ }));
    expect(screen.getByRole('radio', { name: /Choice A/ })).toHaveAttribute('aria-checked', 'false');
    fireEvent.change(screen.getByLabelText(/Why\?/), { target: { value: 'Dates first' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Pick B' })); });
    expect(posts('respond')[0].body).toEqual({ playerName: ME, clientId: CID, askId: '003', choice: ['B'], why: 'Dates first' });
  });

  test('maxPicks is enforced, and an answer already sent can be changed', async () => {
    const v = live({ maxPicks: 2 });
    v.mine.answer = { choice: ['A'], rating: null, why: '' };
    serve(v);
    await mount();
    await screen.findByText('Bold banner');
    expect(screen.getByRole('button', { name: 'Picked A' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /Choice C/ }));
    expect(screen.getByRole('checkbox', { name: /Choice B/ })).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(screen.getByRole('checkbox', { name: /Choice B/ }));
    expect(screen.getByRole('checkbox', { name: /Choice B/ })).toHaveAttribute('aria-checked', 'false');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Change to A + C' })); });
    expect(posts('respond')[0].body.choice).toEqual(['A', 'C']);
  });
});

describe('Rate (rating)', () => {
  test('1–5 with the end labels, POST rating + why', async () => {
    serve(baseView({
      currentAskId: '005',
      current: ask({ askId: '005', kind: 'rating', prompt: 'How close is this?', scale: { min: 1, max: 5, lowLabel: 'Far off', highLabel: 'Nailed it' } }),
    }));
    await mount();
    await screen.findByText('How close is this?');
    expect(screen.getByText('1 · Far off')).toBeInTheDocument();
    expect(screen.getByText('5 · Nailed it')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: '4 of 5' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Rate 4' })); });
    expect(posts('respond')[0].body).toEqual({ playerName: ME, clientId: CID, askId: '005', rating: 4, why: '' });
  });
});

describe('Vote (suggest, voting)', () => {
  const voting = () => baseView({
    currentAskId: '004',
    current: ask({
      askId: '004', kind: 'suggest', status: 'voting', maxPicks: 2, prompt: 'What would stop someone from signing up?',
      responses: [
        { respId: 'x1', text: 'Not seeing which shifts need people', mine: false },
        { respId: 'x2', text: 'Having to make an account first', mine: true },
        { respId: 'x3', text: 'No idea where to park', mine: false },
        { respId: 'x4', text: 'Not sure if teens can come', mine: false },
      ],
    }),
  });

  test('own suggestion is marked and not selectable; maxPicks holds; POST respIds', async () => {
    serve(voting());
    await mount();
    await screen.findByText('Not seeing which shifts need people');
    const own = screen.getByRole('checkbox', { name: /Having to make an account first/ });
    expect(own).toHaveAttribute('aria-disabled', 'true');
    expect(own).toHaveTextContent('yours');
    fireEvent.click(own);
    expect(own).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(screen.getByRole('checkbox', { name: /shifts/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /park/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /teens/ }));
    expect(screen.getByRole('checkbox', { name: /teens/ })).toHaveAttribute('aria-checked', 'false');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Submit 2 votes' })); });
    expect(posts('vote')[0].body).toEqual({ playerName: ME, clientId: CID, askId: '004', respIds: ['x1', 'x3'] });
  });
});

describe('results and decided', () => {
  test('choice results with bars, and the host\'s direction once sent', async () => {
    serve(baseView({
      currentAskId: '003',
      current: ask({
        options: CHOICE_OPTS.slice(0, 2),
        status: 'decided',
        results: {
          total: 14,
          options: [{ label: 'A', title: 'Bold banner', count: 5, pct: 36 }, { label: 'B', title: 'Calm photo + calendar', count: 9, pct: 64 }],
          whys: [{ label: 'B', text: 'Seeing the dates first' }],
        },
        decision: { direction: 'Go with B. Keep A\'s logo.', chosen: ['B'], decidedAt: '2026-10-02T19:37:00.000Z', deliveredAt: null },
      }),
      mine: { responses: [], vote: [], answer: { choice: ['B'], rating: null, why: '' } },
    }));
    await mount();
    expect(await screen.findByText('Sent to Claude')).toBeInTheDocument();
    expect(screen.getByText('Go with B. Keep A\'s logo.')).toBeInTheDocument();
    expect(screen.getByText('9 · 64%')).toBeInTheDocument();
    expect(screen.getByText('Seeing the dates first')).toBeInTheDocument();
    expect(screen.getByText(/You picked B/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Pick/ })).toBeNull();
  });

  test('ranked suggestions at results, before any decision', async () => {
    serve(baseView({
      currentAskId: '004',
      current: ask({
        askId: '004', kind: 'suggest', status: 'results',
        responses: [{ respId: 'x1', text: 'Parking', mine: false, votes: 4 }],
        results: { total: 6, ranked: [{ respId: 'x1', text: 'Parking', votes: 4 }] },
      }),
    }));
    await mount();
    expect(await screen.findByText('4 votes')).toBeInTheDocument();
    expect(screen.getByText("The host shapes this into Claude's next step.")).toBeInTheDocument();
    expect(screen.queryByText('Sent to Claude')).toBeNull();
  });
});

describe('watching the build', () => {
  const LOG = [
    { logId: 'l1', kind: 'progress', text: 'Picked up the direction', detail: 'detail one', link: '', by: 'agent', askId: null, createdAt: '2026-10-02T19:39:00.000Z', editedAt: null },
    { logId: 'l2', kind: 'note', text: 'HOST PRIVATE NOTE', detail: '', link: '', by: 'host', askId: null, createdAt: '2026-10-02T19:40:00.000Z', editedAt: null },
    { logId: 'l3', kind: 'ask', text: 'Closed: Which header?', detail: '', link: '', by: 'system', askId: '003', createdAt: '2026-10-02T19:40:30.000Z', editedAt: null },
    { logId: 'l4', kind: 'showing', text: '<b>Header B</b> is live', detail: '', link: 'https://example.com/live', by: 'agent', askId: null, createdAt: '2026-10-02T19:42:00.000Z', editedAt: null },
    { logId: 'l5', kind: 'milestone', text: 'Form works', detail: '', link: 'javascript:alert(1)', by: 'agent', askId: null, createdAt: '2026-10-02T19:43:00.000Z', editedAt: null },
  ];

  test('goal, connection, latest decision, timeline — never a note, never markup, links only http(s)', async () => {
    serve(baseView({
      agentConnected: true,
      log: LOG,
      decisions: [{ askId: '003', prompt: 'Which header?', direction: 'Go with B', decidedAt: '2026-10-02T19:37:00.000Z' }],
    }));
    const { container } = await mount();
    expect(await screen.findByText('Claude Code is connected')).toBeInTheDocument();
    expect(screen.getByText(/one-page site/)).toBeInTheDocument();
    expect(screen.getByText('Latest decision · Ask 3')).toBeInTheDocument();
    expect(screen.getByText('Go with B')).toBeInTheDocument();
    expect(screen.getByText('Picked up the direction')).toBeInTheDocument();
    expect(screen.getByText('detail one')).toBeInTheDocument();
    expect(screen.queryByText('HOST PRIVATE NOTE')).toBeNull();
    expect(screen.queryByText(/Closed: Which header/)).toBeNull();
    // Rendered as text, not as a <b>.
    expect(screen.getByText('<b>Header B</b> is live')).toBeInTheDocument();
    expect(container.querySelector('.bpl-feed b')).toBeNull();
    const links = screen.getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['https://example.com/live']);
    expect(container.innerHTML).not.toMatch(/javascript:/);
  });

  test('not connected says so', async () => {
    serve(baseView());
    await mount();
    expect(await screen.findByText('Claude Code is not connected')).toBeInTheDocument();
  });

  test('ENDED shows "What we built" with http(s) links only, and no idea composer', async () => {
    serve(baseView({
      state: 'ENDED',
      outcome: {
        summary: 'A sign-up page.',
        built: ['Shift picker', 'Reminder email'],
        links: [{ label: 'Live site', url: 'https://example.org' }, { label: 'Bad', url: 'javascript:alert(1)' }],
        nextSteps: ['Add Sunday shifts'],
        by: 'agent',
        updatedAt: '2026-10-02T20:10:00.000Z',
      },
    }));
    await mount();
    expect(await screen.findByText('What we built')).toBeInTheDocument();
    expect(screen.getByText('A sign-up page.')).toBeInTheDocument();
    expect(screen.getByText('Shift picker')).toBeInTheDocument();
    expect(screen.getByText('Add Sunday shifts')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Live site' })).toHaveAttribute('href', 'https://example.org');
    expect(screen.queryByText('Bad')).toBeNull();
    expect(screen.queryByRole('button', { name: /Send an idea/ })).toBeNull();
  });
});

describe('send an idea', () => {
  test('collapsed by default; POST idea; my ideas with status', async () => {
    serve(baseView({
      myIdeas: [{ ideaId: 'i1', text: 'A map link for parking', playerName: ME, status: 'promoted', createdAt: '2026-10-02T19:41:00.000Z' }],
    }), () => ({ status: 201, body: { ok: true } }));
    await mount();
    const toggle = await screen.findByRole('button', { name: /Send an idea to the host/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('Your idea')).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByText('A map link for parking')).toBeInTheDocument();
    expect(screen.getByText('Picked up')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Your idea'), { target: { value: 'Teens 14+ welcome' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send idea' })); });
    expect(posts('idea')[0].body).toEqual({ playerName: ME, clientId: CID, text: 'Teens 14+ welcome' });
    expect(await screen.findByText('Sent to the host.')).toBeInTheDocument();
  });

  test('the composer is there under a live ask too', async () => {
    serve(baseView({ currentAskId: '003', current: ask({ options: CHOICE_OPTS, maxPicks: 1 }) }));
    await mount();
    await screen.findByText('Bold banner');
    expect(screen.getByRole('button', { name: /Send an idea to the host/ })).toBeInTheDocument();
  });
});

describe('guidance', () => {
  const intro = /You're helping build\s*Food bank sign-up\s*with Claude Code\. Answer when a question appears; send ideas any time\./;

  test('the first screen says what this is, and each screen says what to do next', async () => {
    serve(baseView({ currentAskId: '003', current: ask({ options: CHOICE_OPTS, maxPicks: 1 }) }));
    const { container } = await mount();
    await screen.findByText('Bold banner');
    expect(container.querySelector('.bpl-intro').textContent).toMatch(intro);
    expect(screen.getByText('You can change your pick until the host closes it.')).toBeInTheDocument();
  });

  test('the intro steps aside once the screen moves on, and is always on the watch screen', async () => {
    serve(baseView());
    const { container, rerender } = await mount();
    await screen.findByText('Claude is building');
    expect(container.querySelector('.bpl-intro')).not.toBeNull();
    responder.view = baseView({
      currentAskId: '004',
      current: ask({ askId: '004', kind: 'suggest', status: 'voting', maxPicks: 3, responses: [{ respId: 'x1', text: 'Parking', mine: false }] }),
    });
    await act(async () => {
      rerender(<BuildPlayer gameId={GAME} playerName={ME} clientId={CID} apiBase={API} rev={1} />);
    });
    await screen.findByText('Parking');
    expect(container.querySelector('.bpl-intro')).toBeNull();
    expect(screen.getByText(/ideas you'd build first/)).toBeInTheDocument();
  });

  test('no emoji anywhere on any screen', async () => {
    const EMOJI = /[\u2600-\u27BF\u{1F000}-\u{1FAFF}\u2705\u2713\u2714]/u;
    const views = [
      baseView({ agentConnected: true }),
      baseView({ currentAskId: '003', current: ask({ options: CHOICE_OPTS, maxPicks: 1 }) }),
      baseView({
        currentAskId: '003',
        current: ask({
          options: CHOICE_OPTS.slice(0, 2), status: 'decided',
          results: { total: 1, options: [{ label: 'A', title: 'Bold banner', count: 1, pct: 100 }, { label: 'B', title: 'Calm', count: 0, pct: 0 }], whys: [] },
          decision: { direction: 'Go with A', chosen: ['A'], decidedAt: null, deliveredAt: '2026-10-02T19:40:00.000Z' },
        }),
      }),
      baseView({ state: 'ENDED', outcome: { summary: 'Done', built: [], links: [], nextSteps: [], by: 'agent', updatedAt: null } }),
    ];
    for (const v of views) {
      serve(v);
      const { container, unmount } = await mount();
      await waitFor(() => expect(container.querySelector('.bpl h1, .bpl h2')).not.toBeNull());
      expect(container.textContent).not.toMatch(EMOJI);
      unmount();
    }
  });
});

describe('feedback on what Claude is showing (owner, 2026-10-04)', () => {
  const SHOWING = { logId: 'L9', kind: 'showing', text: 'Header B is live', createdAt: '2026-10-04T12:00:00.000Z', link: 'http://localhost:5173/' };

  test('Looks good goes at once, naming the preview', async () => {
    serve(baseView({ log: [SHOWING] }));
    await mount();
    const card = screen.getByRole('region', { name: 'Feedback on the preview' });
    fireEvent.click(within(card).getByRole('button', { name: 'Looks good' }));
    await waitFor(() => expect(posts('idea').length).toBe(1));
    expect(posts('idea')[0].body).toMatchObject({ aboutLogId: 'L9', verdict: 'good', text: '' });
  });

  test('Needs a change asks what, and sends it', async () => {
    serve(baseView({ log: [SHOWING] }));
    await mount();
    const card = screen.getByRole('region', { name: 'Feedback on the preview' });
    fireEvent.click(within(card).getByRole('button', { name: 'Needs a change' }));
    const send = within(card).getByRole('button', { name: 'Send' });
    expect(send).toBeDisabled();
    fireEvent.change(within(card).getByLabelText('What should change?'), { target: { value: 'Bigger button' } });
    fireEvent.click(send);
    await waitFor(() => expect(posts('idea').length).toBe(1));
    expect(posts('idea')[0].body).toMatchObject({ aboutLogId: 'L9', verdict: 'change', text: 'Bigger button' });
  });

  test('once sent, the card thanks you; with nothing shown there is no card', async () => {
    serve(baseView({ log: [SHOWING], myIdeas: [{ ideaId: 'i1', text: 'On the preview "Header B is live": Looks good', status: 'new', aboutLogId: 'L9' }] }));
    const { unmount } = await mount();
    expect(within(screen.getByRole('region', { name: 'Feedback on the preview' })).getByText(/Your feedback is with the host/)).toBeInTheDocument();
    unmount();
    serve(baseView({ log: [] }));
    await mount();
    expect(screen.queryByRole('region', { name: 'Feedback on the preview' })).toBeNull();
  });
});

describe('the wheel on a phone (owner, 2026-10-05)', () => {
  const wheel = (over = {}) => ({
    slices: [{ id: 'A', label: 'A', text: 'Bold banner' }, { id: 'B', label: 'B', text: 'Calm photo + calendar' }],
    spinner: 'Priya', armed: true, spins: [], landed: null, mine: true, ...over,
  });
  const results = (w) => baseView({
    currentAskId: '003',
    current: ask({ status: 'results', options: CHOICE_OPTS.slice(0, 2), results: { total: 2, options: [{ label: 'A', title: 'Bold banner', count: 1, pct: 50 }, { label: 'B', title: 'Calm photo + calendar', count: 1, pct: 50 }], whys: [], tied: ['A', 'B'] }, wheel: w }),
  });

  test('the phone the wheel picked gets the button, and spinning posts its turn', async () => {
    serve(results(wheel()));
    await mount();
    expect(screen.getByText('Your turn.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Spin the wheel' }));
    await waitFor(() => expect(posts('spin')).toHaveLength(1));
    expect(posts('spin')[0].body).toEqual({ playerName: ME, clientId: CID, askId: '003' });
  });

  test('every other phone sees the wheel and who spins, with no button', async () => {
    serve(results(wheel({ spinner: 'Dee', mine: false })));
    await mount();
    expect(screen.getByRole('img', { name: /A wheel of 2/ })).toBeInTheDocument();
    expect(screen.getByText('Dee spins the wheel')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Spin the wheel' })).toBeNull();
  });

  test('a phone that opens after the spin sees where it landed', async () => {
    serve(results(wheel({ armed: false, mine: false, spins: [{ spinId: 's1', at: '', by: 'Dee', result: 'B', turns: 5 }], landed: 'B' })));
    await mount();
    expect(screen.getByText('The wheel picked B: Calm photo + calendar')).toBeInTheDocument();
  });
});
