/**
 * THE ROOM'S SCREENS AS DISPLAY COMPONENTS (docs/design/parity/PLAN.md §2.5,
 * B6). buildroom/screens/ draws Stage, Build and History from a `room` and an
 * optional `controls`. With controls (one screen, the host's page) they carry
 * the host's moves; with none (the room's window, B7) they render no button
 * and nothing with role=button: the build's link and the codes stay, they are
 * for the room.
 *
 * The first rooms here are the host's (build-store.js hostView). The no-names
 * half draws each screen from a REAL wall body (build-store.js wallView through
 * roomFromRows, testing/buildWallFixture.js, put into the screens' shape by
 * present/buildwall/wallRoom.js) whose rows name players, an idea's author,
 * voters and a spinner: none of them may reach the screen.
 */
import React from 'react';
import { render, cleanup, fireEvent } from '@testing-library/react';
import BuildStageScreen from '../buildroom/screens/BuildStageScreen';
import BuildBuildScreen from '../buildroom/screens/BuildBuildScreen';
import BuildHistoryScreen from '../buildroom/screens/BuildHistoryScreen';
import { wallRoom } from '../present/buildwall/wallRoom';

const S = require('../../../lambda-functions/game/build-store');

const NOW = new Date().toISOString();
const ago = (s) => new Date(Date.now() - s * 1000).toISOString();

const CHOICE = {
  AskId: '003', Kind: 'choice', Prompt: 'Which header should volunteers see first?', Detail: '', MaxPicks: 1,
  Options: [{ label: 'A', title: 'Bold banner', detail: '', url: 'http://localhost:5173/a' }, { label: 'B', title: 'Calm photo', detail: '', url: '' }],
};
const ans = (who, choice) => ({ SK: `BUILD#ANS#003#${who}`, AskId: '003', PlayerName: who, Choice: choice, Why: 'Because', CreatedAt: ago(200) });
const DECIDED = { ...CHOICE, AskId: '002', Status: 'decided', DecidedAt: ago(700), Decision: { direction: 'Go calm', chosen: ['B'], note: '', method: 'vote' } };
const POINT = (n, over = {}) => ({
  SK: `BUILD#POINT#${`p${n}`.padStart(13, '0')}`, PointId: `p${n}`, Kind: 'idea', Text: `Point ${n}`, Status: 'new', By: 'claude', ByRole: 'agent', BatchId: 'b1', CreatedAt: ago(300 - n), Sources: [], ...over,
});
const RUN = {
  SK: 'BUILD#RUN', RunId: 'r1', Status: 'running', Cur: 2, Ver: 2, StartedAt: ago(500),
  Marks: ['done', 'doing', 'pending'], SentAt: [ago(480), ago(300), ''], DoneAt: [ago(400), '', ''],
  Items: [1, 2, 3].map((n) => ({ pointId: `p${n}`, text: `Point ${n}`, kind: 'idea', site: '', dir: `dir ${n}` })),
};
const SHOWING = { SK: 'BUILD#LOG#0000000000001#s1', LogId: '1-s1', Kind: 'showing', Text: 'Header is live', Link: 'http://localhost:5173/', By: 'agent', CreatedAt: ago(90) };

function room({ st = {}, rows = [] } = {}) {
  return S.hostView({
    gameId: '4821',
    meta: { Title: 'Volunteer sign-up', Details: '' },
    sessionState: 'STARTED',
    room: S.roomFromRows([{ SK: 'BUILD#STATE', Rev: 7, AgentSeenAt: ago(6), Phase: 'building', ...st }, SHOWING, ...rows]),
    players: ['Ana', 'Dee', 'Priya', 'Sam'],
    now: NOW,
  });
}
const ask = (status, extra = {}) => room({ st: { CurrentAskId: '003' }, rows: [{ SK: 'BUILD#ASK#003', Source: 'agent', CreatedAt: ago(600), ...CHOICE, Status: status, ...extra }, ans('Ana', ['B']), ans('Sam', ['A']), ans('Priya', ['B'])] });

const pressable = (container) => [...container.querySelectorAll('button, [role="button"]')].map((b) => b.outerHTML.slice(0, 120));

const STAGE_MOMENTS = [
  ['between asks', () => room(), {}],
  ['an ask live', () => ask('live'), {}],
  ['voting', () => ask('voting'), {}],
  ['results', () => ask('results'), {}],
  ['the wheel landed', () => ask('results', { Wheel: { Slices: [{ id: 'A', label: 'A', text: 'Bold' }, { id: 'B', label: 'B', text: 'Calm' }], Spinner: null, Armed: false, Spins: [{ SpinId: 's1', At: NOW, By: 'host', Result: 'B', Turns: 5 }] } }), {}],
  ['the run list', () => room({ rows: [POINT(1, { Status: 'sent' }), POINT(2, { Status: 'sent' }), POINT(3, { Status: 'queued' }), RUN] }), {}],
  ['the opening', () => room({ st: { Phase: undefined } }), {}],
  // The codes beside a live ask: a side panel, the ask and its moves stay (owner, 18 Oct 2026).
  ['the codes beside an ask', () => ask('live'), { codesUp: true }],
];

afterEach(cleanup);

describe('the Stage with no controls: nothing pressable', () => {
  test.each(STAGE_MOMENTS)('%s', (name, mk, show) => {
    const { container } = render(<BuildStageScreen room={mk()} now={Date.now()} show={show} />);
    expect(pressable(container)).toEqual([]);
    expect(container.querySelector('.host-action-bar')).toBeNull();
    expect(container.querySelector('.dock')).not.toBeNull();
  });
});

describe('the Stage with the host\'s controls: the shared bar, HOST and SESSION', () => {
  const controls = {
    busy: false, run: async (fn) => fn(), api: { askAction: jest.fn() }, onHost: jest.fn(), onSession: jest.fn(), alert: { count: 0, amber: false, lines: [] },
  };
  test.each(STAGE_MOMENTS.filter(([n]) => n !== 'between asks' && n !== 'the opening'))('%s', (name, mk, show) => {
    const { container } = render(<BuildStageScreen room={mk()} now={Date.now()} show={show} controls={controls} />);
    expect(container.querySelector('.dock .host-action-bar__primary')).not.toBeNull();
    const dockEl = container.querySelector('.dock');
    const kids = [...dockEl.children];
    expect(kids[kids.length - 2]).toHaveClass('brm-hosthome');
    expect(kids[kids.length - 1]).toHaveTextContent(/^SESSION/);
    // THE DOCK HOLDS STILL (§2a, dockStill.test.jsx for the shared half): the pointer and the focus add nothing.
    const before = dockEl.innerHTML;
    fireEvent.mouseEnter(dockEl);
    fireEvent.focus(dockEl.querySelector('.host-action-bar__primary'));
    expect(dockEl.innerHTML).toBe(before);
    fireEvent.mouseLeave(dockEl);
    expect(dockEl.innerHTML).toBe(before);
  });
});

describe('Build and History with no controls: nothing pressable', () => {
  test('Build: no Share demo, the build link stays', () => {
    const r = room();
    const { container } = render(<BuildBuildScreen room={r} now={Date.now()} />);
    expect(pressable(container)).toEqual([]);
    expect(container.querySelector('a[href="http://localhost:5173/"]')).not.toBeNull();
  });

  test('History: no filters, decided items as text', () => {
    const r = room({ rows: [{ SK: 'BUILD#ASK#002', Source: 'agent', CreatedAt: ago(800), ...DECIDED }] });
    const { container } = render(<BuildHistoryScreen room={r} now={Date.now()} />);
    expect(pressable(container)).toEqual([]);
    expect(container.textContent).toMatch('Go calm');
  });

  test('History with controls: the filters and the ask window, as on the host page', () => {
    const onOpenAsk = jest.fn();
    const r = room({ rows: [{ SK: 'BUILD#ASK#002', Source: 'agent', CreatedAt: ago(800), ...DECIDED }] });
    const { container } = render(<BuildHistoryScreen room={r} now={Date.now()} controls={{ onOpenAsk }} />);
    expect(container.querySelector('[role="group"][aria-label="Show"]')).not.toBeNull();
    container.querySelector('.brm-decided-open').click();
    expect(onOpenAsk).toHaveBeenCalledWith('002');
  });
});

describe('from the wall read: no name, no button (B2\'s wallView, B7)', () => {
  const F = require('../testing/buildWallFixture');
  const MOMENTS = [
    ['between asks', {}], ['an ask live', { ask: 'live' }], ['voting', { ask: 'voting' }],
    ['results', { ask: 'results' }], ['the wheel landed', { ask: 'wheel' }], ['a long history', { history: 12 }],
  ];
  const SCREENS = [
    ['Stage', (r) => <BuildStageScreen room={r} now={Date.now()} show={{}} />],
    ['Stage, codes up', (r) => <BuildStageScreen room={r} now={Date.now()} show={{ codesUp: true }} />],
    ['Build', (r) => <BuildBuildScreen room={r} now={Date.now()} />],
    ['History', (r) => <BuildHistoryScreen room={r} now={Date.now()} />],
  ];
  test('the fixture does name people: the check means something', () => {
    const rows = JSON.stringify(F.rows({ ask: 'wheel' }));
    F.NAMES.forEach((n) => expect(rows).toMatch(n));
  });
  test.each(MOMENTS.flatMap(([m, o]) => SCREENS.map(([s, draw]) => [`${m} · ${s}`, o, draw])))('%s', (name, opts, draw) => {
    const { container } = render(draw(wallRoom(F.wallBody(opts))));
    expect(pressable(container)).toEqual([]);
    F.NAMES.forEach((n) => expect(container.textContent).not.toMatch(n));
  });
});
