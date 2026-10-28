/**
 * THE BUILD ROOM REPORT — buildroom/BuildReport.jsx.
 *
 * Fed HostState computed by the real lambda-functions/game/build-store.js
 * (`roomFromRows` → `hostView`), so the report reads exactly what GET
 * build/state sends. Pins the sections and their order of facts, that host
 * notes stay out, that links render only when http(s), and that Print calls
 * window.print. No geometric assertions.
 */
import React from 'react';
import { render, screen, within, fireEvent } from '@testing-library/react';
import BuildReport from '../buildroom/BuildReport';

const S = require('../../../lambda-functions/game/build-store');

const T = (m) => `2026-10-02T19:${String(m).padStart(2, '0')}:00.000Z`;

function state() {
  const rows = [
    {
      SK: 'BUILD#STATE',
      Rev: 12,
      Outcome: {
        summary: 'A one-page sign-up site with the shift calendar first.',
        built: ['Shift calendar', 'Three-field form'],
        links: [{ label: 'Repo', url: 'https://github.com/eastside/signup' }, { label: 'Bad', url: 'javascript:alert(1)' }],
        nextSteps: ['Add Spanish copy'],
        by: 'agent',
        updatedAt: T(58),
      },
    },
    {
      SK: 'BUILD#ASK#001', AskId: '001', Kind: 'choice', Prompt: 'Which header first?', Status: 'decided', Source: 'agent',
      Options: [{ label: 'A', title: 'Bold banner' }, { label: 'B', title: 'Calm photo' }],
      DecidedAt: T(20), Decision: { direction: 'Go with B, keep A\'s logo', chosen: ['B'], note: 'Bigger button on phones' },
    },
    { SK: 'BUILD#ANS#001#Ana', AskId: '001', PlayerName: 'Ana', Choice: ['B'], Why: 'Dates first' },
    { SK: 'BUILD#ANS#001#Sam', AskId: '001', PlayerName: 'Sam', Choice: ['A'] },
    {
      SK: 'BUILD#ASK#002', AskId: '002', Kind: 'suggest', Prompt: 'What stops a sign-up?', Status: 'decided', Source: 'host',
      MaxPicks: 3, DecidedAt: T(30), Decision: { direction: 'No account, three fields only', chosen: [], note: '' },
    },
    { SK: 'BUILD#RESP#002#r1', AskId: '002', RespId: 'r1', Text: 'Making an account', PlayerName: 'Ana', Source: 'player', CreatedAt: T(25) },
    { SK: 'BUILD#VOTE#002#Sam', AskId: '002', PlayerName: 'Sam', RespIds: ['r1'] },
    {
      SK: 'BUILD#ASK#003', AskId: '003', Kind: 'rating', Prompt: 'How close are we?', Status: 'results', Source: 'host',
      Scale: { min: 1, max: 5, lowLabel: '', highLabel: '' },
    },
    { SK: 'BUILD#ANS#003#Ana', AskId: '003', PlayerName: 'Ana', Rating: 4 },
    { SK: 'BUILD#ASK#004', AskId: '004', Kind: 'suggest', Prompt: 'A discarded ask', Status: 'discarded', Source: 'agent' },
    { SK: 'BUILD#LOG#1#a', LogId: '1-a', Kind: 'progress', Text: 'Plan: list, form, reminder', By: 'agent', CreatedAt: T(5) },
    { SK: 'BUILD#LOG#2#b', LogId: '2-b', Kind: 'note', Text: 'Private: chase Dee', By: 'host', CreatedAt: T(6) },
    { SK: 'BUILD#LOG#3#c', LogId: '3-c', Kind: 'showing', Text: 'Header B live', By: 'agent', Link: 'https://preview.example/b', CreatedAt: T(40) },
    { SK: 'BUILD#IDEA#1#i', IdeaId: '1-i', PlayerName: 'Jordan', Text: 'A parking map', Status: 'promoted', CreatedAt: T(41) },
    { SK: 'BUILD#IDEA#2#j', IdeaId: '2-j', PlayerName: 'Sam', Text: 'Dark mode', Status: 'dismissed', CreatedAt: T(42) },
  ];
  return S.hostView({
    gameId: '4821',
    meta: { Title: 'Volunteer sign-up', Details: 'Pick a Saturday shift in under a minute.' },
    sessionState: 'ENDED',
    room: S.roomFromRows(rows),
    players: ['Ana', 'Jordan', 'Sam'],
    now: T(59),
  });
}

const section = (name) => screen.getByRole('heading', { name }).closest('section');

test('title, goal and the meta line', () => {
  render(<BuildReport state={state()} />);
  expect(screen.getByRole('heading', { level: 1, name: 'Volunteer sign-up' })).toBeInTheDocument();
  expect(screen.getByText('Pick a Saturday shift in under a minute.')).toBeInTheDocument();
  expect(screen.getByText(/3 people · Claude Code · 3 asks · 2 timeline entries/)).toBeInTheDocument();
  expect(screen.getByText(/Build Room report · /)).toBeInTheDocument();
});

test('What we built: summary, built, next steps, and only http(s) links', () => {
  render(<BuildReport state={state()} />);
  const s = section('What we built');
  expect(within(s).getByText('A one-page sign-up site with the shift calendar first.')).toBeInTheDocument();
  expect(within(s).getByText('Shift calendar')).toBeInTheDocument();
  expect(within(s).getByText('Add Spanish copy')).toBeInTheDocument();
  expect(within(s).getByRole('link', { name: 'Repo' })).toHaveAttribute('href', 'https://github.com/eastside/signup');
  expect(within(s).queryByRole('link', { name: 'Bad' })).toBeNull();
});

test('Decisions: each ask with its results, the direction and the note; discarded asks left out', () => {
  render(<BuildReport state={state()} />);
  const s = section('Decisions');
  expect(within(s).getByText(/Ask 1 · Which header first\?/)).toBeInTheDocument();
  expect(within(s).getByText('Calm photo')).toBeInTheDocument();
  expect(within(s).getAllByText('1 · 50%')).toHaveLength(2);
  expect(within(s).getByText('Go with B, keep A\'s logo', { exact: false })).toBeInTheDocument();
  expect(within(s).getByText('Bigger button on phones', { exact: false })).toBeInTheDocument();
  expect(within(s).getByText('Dates first', { exact: false })).toBeInTheDocument();
  expect(within(s).getByText('Making an account')).toBeInTheDocument();
  expect(within(s).getByText('1 votes')).toBeInTheDocument();
  expect(within(s).getByText(/Ask 3 · How close are we\?/)).toBeInTheDocument();
  expect(within(s).getByText('1 rated')).toBeInTheDocument();
  expect(within(s).queryByText(/A discarded ask/)).toBeNull();
});

test('Timeline: every entry but host notes, with links', () => {
  render(<BuildReport state={state()} />);
  const s = section('Timeline');
  expect(within(s).getByText('Plan: list, form, reminder')).toBeInTheDocument();
  expect(within(s).getByText('Header B live')).toBeInTheDocument();
  expect(within(s).getByRole('link', { name: 'https://preview.example/b' })).toBeInTheDocument();
  expect(screen.queryByText('Private: chase Dee')).toBeNull();
});

test('Unprompted ideas and who took part', () => {
  render(<BuildReport state={state()} />);
  const ideas = section('Unprompted ideas');
  expect(within(ideas).getByText('A parking map')).toBeInTheDocument();
  expect(within(ideas).getByText('Used')).toBeInTheDocument();
  expect(within(ideas).getByText('Dismissed')).toBeInTheDocument();
  const people = section('Who took part');
  ['Ana', 'Jordan', 'Sam'].forEach((name) => expect(within(people).getByText(name)).toBeInTheDocument());
});

test('Print calls window.print, and Back calls onBack', () => {
  const print = jest.spyOn(window, 'print').mockImplementation(() => {});
  const onBack = jest.fn();
  render(<BuildReport state={state()} onBack={onBack} />);
  fireEvent.click(screen.getByRole('button', { name: /^Print$/ }));
  expect(print).toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /Back to room/ }));
  expect(onBack).toHaveBeenCalled();
  print.mockRestore();
});

test('paper theme on its own root', () => {
  const { container } = render(<BuildReport state={state()} />);
  expect(container.firstChild).toHaveAttribute('data-theme', 'light');
  expect(container.firstChild).toHaveClass('brr');
});

test('an empty room still renders every section with an honest empty state', () => {
  const empty = S.hostView({
    gameId: '1111', meta: { Title: 'Empty' }, sessionState: 'STARTED', room: S.roomFromRows([]), players: [], now: T(1),
  });
  render(<BuildReport state={empty} />);
  expect(screen.getByText(/No wrap-up yet/)).toBeInTheDocument();
  expect(screen.getByText('The room was not asked anything.')).toBeInTheDocument();
  // Revy review (2026-10-10): "No ideas were sent" sat beside six suggestions under Decisions.
  expect(screen.getByText('No unprompted ideas were sent.')).toBeInTheDocument();
  expect(screen.queryByText('Ideas from the room')).toBeNull();
  expect(screen.getByText('Nobody joined from a phone.')).toBeInTheDocument();
});

describe('Who built what (crew mode)', () => {
  const C = require('../../../lambda-functions/game/build-crew');
  function crewState({ enabled = true } = {}) {
    const rows = [
      {
        SK: 'BUILD#STATE', Rev: 30,
        Crew: { enabled, repoUrl: 'https://github.com/george/foodbank', baseBranch: 'build-room/4821', baseCommit: '7f3c2a1aa', runCrewCode: false },
      },
      { SK: C.SK.builder('Priya'), PlayerName: 'Priya', Branch: 'crew/priya/parking-map', Status: 'synced', TaskId: '001' },
      { SK: C.SK.builder('Ana'), PlayerName: 'Ana', Branch: 'crew/ana/confirmation', Status: 'building' },
      { SK: 'BUILD#TASK#001', TaskId: '001', Text: 'Parking map', ClaimedBy: ['Priya'], State: 'done' },
      { SK: 'BUILD#TASK#002', TaskId: '002', Text: 'Confirmation text', ClaimedBy: ['Ana'], State: 'open' },
      {
        SK: 'BUILD#SHR#s1', ShareId: 's1', Builder: 'Priya', TaskId: '001', Title: 'Parking map', Lane: 'merged', Featured: true,
        PrUrl: 'https://github.com/george/foodbank/pull/7', MergedCommit: '7f3c2a1aa',
        Versions: [{ v: 1, summary: 'Map', imageIds: ['aaa111'] }, { v: 2, summary: 'Lit lots', imageIds: ['bbb222'] }],
        CreatedAt: T(30), UpdatedAt: T(40),
      },
      { SK: 'BUILD#SHR#s2', ShareId: 's2', Builder: 'Ana', Title: 'Confirmation text', Lane: 'shared', Versions: [{ v: 1, summary: 'SMS', imageIds: [], branch: 'crew/ana/confirmation-v2' }], CreatedAt: T(35), UpdatedAt: T(35) },
      { SK: C.SK.comment('s1', T(31)), ShareId: 's1', Kind: 'looks-right', By: 'room', Name: 'Sam', Text: '', Version: 1, CreatedAt: T(31) },
      { SK: C.SK.comment('s1', T(32)), ShareId: 's1', Kind: 'question', By: 'room', Name: 'Jordan', Text: 'At night?', Version: 1, CreatedAt: T(32) },
      { SK: C.SK.comment('s1', T(33)), ShareId: 's1', Kind: 'looks-right', By: 'room', Name: 'Jordan', Text: '', Version: 1, CreatedAt: T(33) },
      { SK: C.SK.review('s1', T(36)), ShareId: 's1', Version: 2, Does: 'Adds a map.', Recommendation: 'merge-after-changes', CreatedAt: T(36) },
    ];
    const room = S.roomFromRows(rows);
    const view = S.hostView({ gameId: '4821', meta: { Title: 'Volunteer sign-up' }, sessionState: 'ENDED', room, players: ['Priya', 'Ana', 'Sam', 'Jordan'], now: T(59) });
    view.crew = C.crewView(room, 'host');
    return view;
  }

  test('each builder: branch, tasks, early looks with versions, lane, merged commit, reactions, review, PR', () => {
    render(<BuildReport state={crewState()} />);
    const s = section('Who built what');
    expect(s.textContent).toMatch(/The base branch: build-room\/4821 on github\.com\/george\/foodbank · final commit 7f3c2a1/);
    expect(within(s).getByRole('link', { name: 'github.com/george/foodbank' })).toHaveAttribute('href', 'https://github.com/george/foodbank');

    const priya = within(s).getByText('Priya', { selector: 'b' }).closest('.brr-builder');
    expect(priya.textContent).toMatch(/branch crew\/priya\/parking-map/);
    expect(priya.textContent).toMatch(/Tasks: Parking map/);
    expect(priya.textContent).toMatch(/Parking map · 2 versions · Merged at 7f3c2a1/);
    // Latest wins per person: Jordan's question became Looks right.
    expect(priya.textContent).toMatch(/Room: Looks right 2 · Question 0 · Concern 0 · Claude's review: merge after changes/);
    expect(within(priya).getByRole('link', { name: 'Pull request' })).toHaveAttribute('href', 'https://github.com/george/foodbank/pull/7');
    // The room stays a count: no reacting names.
    expect(s.textContent).not.toMatch(/Jordan|Sam/);
    // One shared repo, a branch each: no forks, no patches.
    expect(s.textContent).not.toMatch(/fork|patch/i);

    const ana = within(s).getByText('Ana', { selector: 'b' }).closest('.brr-builder');
    expect(ana.textContent).toMatch(/branch crew\/ana\/confirmation/);
    // An early look on a branch other than the builder's own says which.
    expect(ana.textContent).toMatch(/Confirmation text · 1 version · Early look · branch crew\/ana\/confirmation-v2/);
    expect(within(ana).queryByRole('link')).toBeNull();
  });

  test('section order: What we built, then Who built what, then Decisions', () => {
    render(<BuildReport state={crewState()} />);
    const names = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(names.slice(0, 3)).toEqual(['What we built', 'Who built what', 'Decisions']);
  });

  test('no crew, no section', () => {
    render(<BuildReport state={crewState({ enabled: false })} />);
    expect(screen.queryByRole('heading', { name: 'Who built what' })).toBeNull();
    render(<BuildReport state={state()} />);
    expect(screen.queryByRole('heading', { name: 'Who built what' })).toBeNull();
  });
});

test('an ask the host answered for the room says "answered out loud", not "0 answered"', () => {
  // Owner, 2026-10-04: a room that talks instead of tapping still decided.
  const rows = [
    { SK: 'BUILD#STATE', Rev: 3 },
    {
      SK: 'BUILD#ASK#001', AskId: '001', Kind: 'rating', Prompt: 'How close is this?', Status: 'decided', Source: 'agent',
      Scale: { min: 1, max: 5, lowLabel: 'Far', highLabel: 'There' },
      DecidedAt: T(20), Decision: { direction: 'The room rated this 4 out of 5 (said out loud).', chosen: ['4'], note: '', spoken: true },
    },
  ];
  const st = S.hostView({ gameId: '4821', meta: { Title: 'Spoken room' }, sessionState: 'ENDED', room: S.roomFromRows(rows), players: [], now: T(59) });
  render(<BuildReport state={st} />);
  const s = section('Decisions');
  expect(within(s).getByText(/answered out loud/)).toBeInTheDocument();
  expect(within(s).queryByText(/0 answered/)).toBeNull();
  expect(within(s).getByText('The room rated this 4 out of 5 (said out loud).', { exact: false })).toBeInTheDocument();
});

describe('what never reached Claude says so (host review, 25 Oct 2026, F1 and F5)', () => {
  const view = (rows) => S.hostView({ gameId: '4821', meta: { Title: 'Held room' }, sessionState: 'ENDED', room: S.roomFromRows(rows), players: [], now: T(59) });
  const ask = (id, decision) => ({
    SK: `BUILD#ASK#${id}`, AskId: id, Kind: 'choice', Prompt: `Ask ${id}?`, Status: 'decided', Source: 'host',
    Options: [{ label: 'A', title: 'One' }, { label: 'B', title: 'Two' }], DecidedAt: T(20), Decision: { chosen: ['A'], note: '', ...decision },
  });

  test('a Claude that never called in is not listed in the header', () => {
    render(<BuildReport state={view([{ SK: 'BUILD#STATE', Rev: 1 }])} />);
    expect(screen.getByText(/0 people · 0 asks/)).toBeInTheDocument();
    expect(screen.queryByText(/Claude Code ·/)).toBeNull();
  });

  test('a Claude that called in is', () => {
    render(<BuildReport state={view([{ SK: 'BUILD#STATE', Rev: 1, AgentSeenAt: T(3) }])} />);
    expect(screen.getByText(/0 people · Claude Code · 0 asks/)).toBeInTheDocument();
  });

  test('a decision saved for later, and one recorded only, are marked; a sent one is not', () => {
    render(<BuildReport state={view([
      { SK: 'BUILD#STATE', Rev: 1, AgentSeenAt: T(3) },
      ask('001', { direction: 'Ask 001: One', heldForLater: true, as: 'later' }),
      ask('002', { direction: 'Ask 002: One', sendToAgent: false }),
      ask('003', { direction: 'Ask 003: One' }),
    ])} />);
    const s = section('Decisions');
    expect(within(s).getAllByText(/Saved for later, not sent to Claude/)).toHaveLength(1);
    expect(within(s).getAllByText(/Recorded only, not sent to Claude/)).toHaveLength(1);
    expect(within(s).getByText(/Ask 003: One/).textContent).not.toMatch(/not sent/);
  });

  test('an idea saved for later says it was not sent', () => {
    render(<BuildReport state={view([
      { SK: 'BUILD#STATE', Rev: 1 },
      { SK: 'BUILD#IDEA#1#i', IdeaId: '1-i', PlayerName: 'Jordan', Text: 'A parking map', Status: 'later', CreatedAt: T(41) },
    ])} />);
    expect(within(section('Unprompted ideas')).getByText('Saved for later, not sent')).toBeInTheDocument();
  });
});

// ── Phase 3 of the simplify plan (owner, 28 Oct 2026: "then start phase 3"), item 16 ──
describe('the brief, plain lines for what Engage told Claude, and the wheel (simplify PLAN item 16)', () => {
  const view = (rows) => S.hostView({ gameId: '4821', meta: { Title: 'Brief room' }, sessionState: 'ENDED', room: S.roomFromRows(rows), players: [], now: T(59) });
  const BRIEF = {
    headline: 'Pick a shift in under a minute', summary: 'One page, no login.', forWhom: 'Volunteers on an old phone',
    lines: { kind: 'A website', problem: 'The spreadsheet is a mess', good: 'Volunteers sign up alone', firstBuild: 'The shift list' },
    keep: [{ id: 'k1', text: 'Never ask for a password' }],
  };

  test('a Build brief section of its own: the headline, the opening\'s answers, who it is for and Keep in mind, before What we built', () => {
    render(<BuildReport state={view([{ SK: 'BUILD#STATE', Rev: 1, Brief: BRIEF }])} />);
    const s = section('Build brief');
    expect(within(s).getByText('Pick a shift in under a minute')).toBeInTheDocument();
    expect(within(s).getByText('One page, no login.')).toBeInTheDocument();
    expect([...s.querySelectorAll('dt')].map((d) => d.textContent)).toEqual(['Making', 'Who it is for', 'The problem', 'Good looks like', 'First build']);
    expect(within(s).getByText('Volunteers on an old phone')).toBeInTheDocument();
    expect(within(s).getByText('Never ask for a password')).toBeInTheDocument();
    const order = [...document.querySelectorAll('h2')].map((h) => h.textContent);
    expect(order.indexOf('Build brief')).toBeLessThan(order.indexOf('What we built'));
  });

  test('no brief, no section', () => {
    render(<BuildReport state={view([{ SK: 'BUILD#STATE', Rev: 1 }])} />);
    expect(screen.queryByRole('heading', { name: 'Build brief' })).toBeNull();
  });

  test('Start building reads "Start building: Claude got the brief", never the prompt Claude was given', () => {
    const start = `The room has framed the build. Plan 3 to 6 steps, post the plan with post_update (kind "milestone"), and start building.\n\n${S.briefText(S.briefView({ Brief: BRIEF }))}`;
    render(<BuildReport state={view([
      { SK: 'BUILD#STATE', Rev: 1, Brief: BRIEF },
      { SK: 'BUILD#LOG#1#a', LogId: '1-a', Kind: 'direction', Text: start, By: 'host', ForAgent: true, CreatedAt: T(5) },
      { SK: 'BUILD#LOG#2#b', LogId: '2-b', Kind: 'direction', Text: 'We are wrapping up. Call room_status, then write the outcome with wrap_up: a short summary.', By: 'host', ForAgent: true, CreatedAt: T(50) },
      { SK: 'BUILD#LOG#3#c', LogId: '3-c', Kind: 'direction', Text: 'Use the blue header', By: 'host', ForAgent: true, CreatedAt: T(51) },
    ])} />);
    const s = section('Timeline');
    expect(within(s).getByText('Start building: Claude got the brief')).toBeInTheDocument();
    expect(within(s).getByText('Asked Claude to wrap up')).toBeInTheDocument();
    expect(within(s).getByText('Use the blue header')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/post_update|wrap_up|room_status|THE ROOM BRIEF/);
  });

  test('a decision the wheel settled says so; one the room voted does not', () => {
    const ask = (id, decision) => ({
      SK: `BUILD#ASK#${id}`, AskId: id, Kind: 'choice', Prompt: `Ask ${id}?`, Status: 'decided', Source: 'host',
      Options: [{ label: 'A', title: 'One' }, { label: 'B', title: 'Two' }], DecidedAt: T(20), Decision: { chosen: ['A'], note: '', direction: `Ask ${id}: One`, ...decision },
    });
    render(<BuildReport state={view([{ SK: 'BUILD#STATE', Rev: 1 }, ask('001', { method: 'wheel' }), ask('002', {})])} />);
    const s = section('Decisions');
    expect(within(s).getAllByText('Settled by the wheel')).toHaveLength(1);
    expect(within(s).getByText('Settled by the wheel').closest('.brr-dec').textContent).toMatch('Ask 001?');
  });
});
