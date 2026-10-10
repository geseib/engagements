/**
 * THE HOST ALERT, the model (docs/design/build-room-host-alert, owner
 * 2026-10-10): what waits on the host, as a count and a short folded list,
 * for the Stage dock and the Build / History header. Pure: no React.
 *
 * The room sees these screens, so nothing here carries a name or a word a
 * participant typed; only fixed labels and numbers.
 */
import { hostAlert, latestDecisionLine } from '../buildroom/buildScreens';

const S = require('../../../lambda-functions/game/build-store');

const T = (min) => new Date(Date.UTC(2026, 9, 10, 12, min)).toISOString();

const ask = (id, o = {}) => ({ askId: id, kind: 'suggest', status: 'proposed', source: 'agent', createdAt: T(Number(id)), options: [], prompt: 'Which header, Dee?', ...o });
const shots = (n) => Array.from({ length: n }, (_, i) => ({ label: 'ABCDEF'[i], imageId: `img${i}`, title: 'Bold banner' }));
const mock = (id, n = 3, o = {}) => ask(id, { kind: 'choice', options: shots(n), ...o });
const idea = (id, o = {}) => ({ ideaId: id, status: 'new', source: 'room', createdAt: T(Number(id)), text: 'Add a dark mode', playerName: 'Priya', ...o });
const share = (id, o = {}) => ({ shareId: id, lane: 'shared', featured: false, builder: 'Marcus', title: 'The map page', createdAt: T(Number(id)), updatedAt: T(Number(id)), ...o });
const room = (o = {}) => ({ asks: [], ideas: [], log: [], crew: null, seen: { ids: [], allAt: '' }, ...o });

describe('what counts', () => {
  test('an empty room: no count, grey, no lines', () => {
    expect(hostAlert(room())).toMatchObject({ count: 0, amber: false, lines: [] });
    expect(hostAlert(null)).toMatchObject({ count: 0, amber: false, lines: [] });
  });

  test('a question from Claude: counts, amber, "Open →", jumps to that ask', () => {
    const a = hostAlert(room({ asks: [ask('1')] }));
    expect(a.count).toBe(1);
    expect(a.amber).toBe(true);
    expect(a.lines).toEqual([expect.objectContaining({ key: 'question', label: 'Claude has a question', go: 'Open →', ids: ['ask:1'], target: { kind: 'ask', id: '1' } })]);
  });

  test('two questions fold into one line and jump to the oldest', () => {
    const a = hostAlert(room({ asks: [ask('2'), ask('1')] }));
    expect(a.count).toBe(2);
    expect(a.lines).toHaveLength(1);
    expect(a.lines[0]).toMatchObject({ label: 'Claude has 2 questions', ids: ['ask:1', 'ask:2'], target: { kind: 'ask', id: '1' } });
  });

  test('mockups ready: amber too, counted in pictures, "See them →", never "Open the vote"', () => {
    const a = hostAlert(room({ asks: [mock('3', 3)] }));
    expect(a.amber).toBe(true);
    expect(a.count).toBe(1);
    expect(a.lines[0]).toMatchObject({ key: 'mockups', label: 'Mockups are ready (3)', go: 'See them →', target: { kind: 'ask', id: '3' } });
    expect(JSON.stringify(a)).not.toMatch(/Open the vote/);
  });

  test('a choice ask without all its pictures is a question, not mockups', () => {
    const half = ask('4', { kind: 'choice', options: [{ label: 'A', imageId: 'x' }, { label: 'B', imageId: '' }] });
    expect(hostAlert(room({ asks: [half] })).lines[0].key).toBe('question');
  });

  test('Claude still making the mockups is not waiting on the host: not counted until they are in', () => {
    const making = ask('7', { kind: 'choice', options: shots(2).map((o, i) => ({ ...o, imageId: i ? '' : 'x' })), mockups: { asked: true, have: 1, total: 2, ready: false } });
    expect(hostAlert(room({ asks: [making] })).count).toBe(0);
    const done = { ...making, options: shots(2), mockups: { asked: true, have: 2, total: 2, ready: true } };
    expect(hostAlert(room({ asks: [done] })).lines[0].label).toBe('Mockups are ready (2)');
  });

  test('two mockup asks fold: "2 votes are ready"', () => {
    const a = hostAlert(room({ asks: [mock('3'), mock('5', 2)] }));
    expect(a.lines[0].label).toBe('2 votes are ready');
    expect(a.count).toBe(2);
  });

  test('new ideas from the room: grey, one line, "Review →", counted one each', () => {
    const a = hostAlert(room({ ideas: [idea('1'), idea('2'), idea('3')] }));
    expect(a.count).toBe(3);
    expect(a.amber).toBe(false);
    expect(a.lines).toEqual([expect.objectContaining({ key: 'ideas', label: '3 new ideas from the room', go: 'Review →', target: { kind: 'waiting' } })]);
    expect(hostAlert(room({ ideas: [idea('1')] })).lines[0].label).toBe('1 new idea from the room');
  });

  test('crew early looks count, grey, "Review →"; a featured, merged or not-now one does not', () => {
    const crew = { enabled: true, shares: [share('1'), share('2'), share('3', { featured: true }), share('4', { lane: 'merged' }), share('5', { lane: 'not-now' }), share('6', { lane: 'reviewed' })] };
    const a = hostAlert(room({ crew }));
    expect(a.count).toBe(2);
    expect(a.amber).toBe(false);
    expect(a.lines[0]).toMatchObject({ key: 'looks', label: '2 early looks', go: 'Review →', target: { kind: 'waiting' } });
    expect(hostAlert(room({ crew: { enabled: true, shares: [share('1')] } })).lines[0].label).toBe('1 early look');
  });

  test('not counted: the host\'s own ideas and asks, handled ideas, opened or discarded asks, Claude finished, takeover requests', () => {
    const a = hostAlert(room({
      asks: [ask('1', { source: 'host' }), ask('2', { status: 'live' }), ask('3', { status: 'discarded' }), ask('4', { status: 'decided' })],
      ideas: [idea('1', { source: 'host' }), idea('2', { status: 'acknowledged' }), idea('3', { status: 'promoted' })],
      log: [{ kind: 'milestone', by: 'agent', text: 'Built the header', createdAt: T(9) }, { kind: 'showing', by: 'agent', text: 'Header is up', createdAt: T(9) }],
      asking: [{ name: 'Priya' }],
    }));
    expect(a).toMatchObject({ count: 0, amber: false, lines: [] });
  });

  test('most urgent first: question, mockups, ideas, early looks', () => {
    const a = hostAlert(room({ asks: [mock('3'), ask('1')], ideas: [idea('2')], crew: { enabled: true, shares: [share('1')] } }));
    expect(a.lines.map((l) => l.key)).toEqual(['question', 'mockups', 'ideas', 'looks']);
    expect(a.count).toBe(1 + 1 + 1 + 1);
  });
});

describe('amber and grey', () => {
  test('amber while a question or mockups wait; grey with only ideas and looks', () => {
    expect(hostAlert(room({ asks: [ask('1')], ideas: [idea('2')] })).amber).toBe(true);
    expect(hostAlert(room({ ideas: [idea('2')] })).amber).toBe(false);
    expect(hostAlert(room({ crew: { enabled: true, shares: [share('1')] } })).amber).toBe(false);
  });

  test('once the question is seen the count is grey, and counts only what is left', () => {
    const a = hostAlert(room({ asks: [ask('1')], ideas: [idea('2'), idea('3')], seen: { ids: ['ask:1'], allAt: '' } }));
    expect(a.amber).toBe(false);
    expect(a.count).toBe(2);
    expect(a.lines.map((l) => l.key)).toEqual(['ideas']);
  });
});

describe('seen', () => {
  test('an id the host opened leaves the count; the rest of its line stays', () => {
    const a = hostAlert(room({ ideas: [idea('1'), idea('2'), idea('3')], seen: { ids: ['idea:1'], allAt: '' } }));
    expect(a.count).toBe(2);
    expect(a.lines[0]).toMatchObject({ label: '2 new ideas from the room', ids: ['idea:2', 'idea:3'] });
  });

  test('Mark all seen: everything made before that time is gone; anything newer counts', () => {
    const seen = { ids: [], allAt: T(2) };
    const a = hostAlert(room({ asks: [ask('1')], ideas: [idea('2'), idea('3')], seen }));
    expect(a.lines.map((l) => [l.key, l.ids])).toEqual([['ideas', ['idea:3']]]);
    expect(a.count).toBe(1);
  });

  test('this device\'s own just-seen ids count at once, before the server answers', () => {
    const r = room({ asks: [ask('1')], ideas: [idea('2')] });
    expect(hostAlert(r, { ids: ['ask:1'], allAt: '' }).count).toBe(1);
    expect(hostAlert(r, { ids: [], allAt: T(30) }).count).toBe(0);
  });

  test('a room with no seen at all (an older server) counts everything', () => {
    const { seen, ...rest } = room({ ideas: [idea('1')] });
    expect(hostAlert(rest).count).toBe(1);
  });
});

describe('what the room could read', () => {
  test('no name, no typed text, no prompt, no title anywhere in the alert', () => {
    const r = room({
      asks: [ask('1'), mock('3')],
      ideas: [idea('2')],
      crew: { enabled: true, shares: [share('1')] },
    });
    const text = JSON.stringify(hostAlert(r));
    ['Priya', 'dark mode', 'Which header', 'Dee', 'Bold banner', 'Marcus', 'map page'].forEach((w) => expect(text).not.toContain(w));
  });
});

describe('mockups the host asked for (rebuilt through the real server view)', () => {
  const view = (rows) => S.hostView({
    gameId: '4821', meta: { Title: 't' }, sessionState: 'STARTED', room: S.roomFromRows(rows), players: [], now: T(60),
  });
  const rows = (pictures) => [
    { SK: 'BUILD#STATE', Rev: 1 },
    {
      SK: 'BUILD#ASK#009', AskId: '009', Kind: 'choice', Prompt: 'Which look?', Options: [{ label: 'A', title: 'Bold' }, { label: 'B', title: 'Calm' }], MaxPicks: 1, Status: 'proposed', Source: 'host', AskForMockups: true, CreatedAt: T(0),
    },
    ...pictures.map(([label, at], i) => ({ SK: `BUILD#IMG#${i}`, ImageId: `i${i}`, AskId: '009', Label: label, Kind: 'mockup', CreatedAt: at })),
  ];

  test('a mockups ask the HOST made (Source host) counts once every picture is in', () => {
    const v = view(rows([['A', T(5)], ['B', T(9)]]));
    expect(v.asks[0].source).toBe('host');
    const a = hostAlert(v);
    expect(a.count).toBe(1);
    expect(a.amber).toBe(true);
    expect(a.lines[0]).toMatchObject({ key: 'mockups', label: 'Mockups are ready (2)', go: 'See them →', ids: ['ask:009'] });
  });

  test('not counted while Claude is still making them, and never as a question', () => {
    const v = view(rows([['A', T(5)]]));
    expect(hostAlert(v)).toMatchObject({ count: 0, lines: [] });
  });

  test('a Mark all seen during the making does not hide them: they are dated by the last picture', () => {
    const v = { ...view(rows([['A', T(5)], ['B', T(20)]])), seen: { ids: [], allAt: T(10) } };
    expect(hostAlert(v).count).toBe(1);
    const later = { ...v, seen: { ids: [], allAt: T(25) } };
    expect(hostAlert(later).count).toBe(0);
  });

  test('the host\'s own proposed vote from ideas is still not counted', () => {
    const v = view([{ SK: 'BUILD#STATE', Rev: 1 }, { SK: 'BUILD#ASK#010', AskId: '010', Kind: 'choice', Prompt: 'x', Options: [{ label: 'A', title: 'a' }, { label: 'B', title: 'b' }], MaxPicks: 1, Status: 'proposed', Source: 'host', CreatedAt: T(0) }]);
    expect(hostAlert(v).count).toBe(0);
  });
});

describe('early looks: one rule, the time of the last version', () => {
  test('a new version of a look the host opened counts again; mark-all dates it by that same time', () => {
    const old = share('1', { updatedAt: T(5) });
    const idOld = hostAlert(room({ crew: { enabled: true, shares: [old] } })).lines[0].ids[0];
    const seen = { ids: [idOld], allAt: '' };
    expect(hostAlert(room({ crew: { enabled: true, shares: [old] }, seen })).count).toBe(0);
    const newer = { ...old, updatedAt: T(30) };
    expect(hostAlert(room({ crew: { enabled: true, shares: [newer] }, seen })).count).toBe(1);
    expect(hostAlert(room({ crew: { enabled: true, shares: [newer] }, seen: { ids: [], allAt: T(10) } })).count).toBe(1);
    expect(hostAlert(room({ crew: { enabled: true, shares: [old] }, seen: { ids: [], allAt: T(10) } })).count).toBe(0);
  });

  test('the id is one the server accepts', () => {
    const id = hostAlert(room({ crew: { enabled: true, shares: [share('12')] } })).lines[0].ids[0];
    expect(S.normalizeSeen({ ids: [id] })).toMatchObject({ ok: true });
  });
});

describe('the Stage\'s "We decided" for a vote that came from Points', () => {
  const pointsVote = (o = {}) => ({
    askId: '012', status: 'decided', prompt: 'Which points go first?', decidedAt: T(5), fromPoints: ['p1', 'p2'],
    options: [{ label: 'A', title: 'Tell the volunteers' }, { label: 'B', title: 'Show the rota' }, { label: 'C', title: 'Print a map' }],
    decision: { direction: 'Moved forward: Tell the volunteers; Print a map', chosen: ['A', 'C'], method: 'vote' }, ...o,
  });
  test('reads "The room chose: <title>, <title>" from the chosen options', () => {
    expect(latestDecisionLine({ asks: [pointsVote()] })).toBe('The room chose: Tell the volunteers, Print a map');
  });
  test('an ordinary decision, or a vote from points the host spoke about, is unchanged', () => {
    const plain = pointsVote({ fromPoints: undefined, decision: { direction: 'Blue', chosen: ['A'], method: 'vote' }, prompt: 'What colour?' });
    expect(latestDecisionLine({ asks: [plain] })).toBe('What colour: Blue');
  });
});
