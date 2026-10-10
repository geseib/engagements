/**
 * THE HOST ALERT, the model (docs/design/build-room-host-alert, owner
 * 2026-10-10): what waits on the host, as a count and a short folded list,
 * for the Stage dock and the Build / History header. Pure: no React.
 *
 * The room sees these screens, so nothing here carries a name or a word a
 * participant typed; only fixed labels and numbers.
 */
import { hostAlert } from '../buildroom/buildScreens';

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
