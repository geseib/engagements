import { laterItems, whatsNextMoves } from '../buildroom/buildScreens';

const room = (over = {}) => ({
  ideas: [
    { ideaId: 'i1', text: 'Stack of bills', playerName: 'Priya', status: 'later', createdAt: '2026-10-08T10:00:00Z', source: 'room' },
    { ideaId: 'i2', text: 'Waiting idea', playerName: 'Dee', status: 'new', createdAt: '2026-10-08T10:05:00Z', source: 'room' },
    { ideaId: 'i3', text: 'Typed by host', playerName: 'Host', status: 'later', createdAt: '2026-10-08T10:20:00Z', source: 'host' },
    { ideaId: 'i4', text: 'Sent already', playerName: 'Sam', status: 'promoted', createdAt: '2026-10-08T10:06:00Z', source: 'room' },
  ],
  brief: { later: [{ id: 'd1', text: 'Share button', from: 'ask 3', at: '2026-10-08T10:10:00Z' }, { id: 'd2', text: 'Old held decision', from: 'you', at: null }] },
  asks: [], ...over,
});

describe('laterItems', () => {
  test('merges saved ideas and held directions, tagged, newest first, undated last', () => {
    const items = laterItems(room());
    expect(items.map((x) => x.text)).toEqual(['Typed by host', 'Share button', 'Stack of bills', 'Old held decision']);
    expect(items.map((x) => x.tag)).toEqual(['Idea from the room', 'Direction for Claude', 'Idea from the room', 'Direction for Claude']);
    expect(items.map((x) => x.type)).toEqual(['idea', 'direction', 'idea', 'direction']);
  });
  test('says where each came from', () => {
    const [host, dir, idea, typed] = laterItems(room());
    expect(host.from).toBe('You · typed');
    expect(dir.from).toBe('You · from Ask 3');
    expect(idea.from).toBe('Priya · idea');
    expect(typed.from).toBe('You · typed');
  });
  test('an empty room has no Later', () => {
    expect(laterItems({ ideas: [] })).toEqual([]);
    expect(laterItems(null)).toEqual([]);
  });
});

describe('whatsNextMoves and the Later list', () => {
  test('leads with the vote while 2 to 6 are ticked, not before or after', () => {
    expect(whatsNextMoves(room(), { laterTicked: 1 }).some((m) => m.key === 'vote-later')).toBe(false);
    expect(whatsNextMoves(room(), { laterTicked: 2 })[0]).toMatchObject({ key: 'vote-later', count: 2, title: 'Put 2 from Later to a vote', button: 'Open voting' });
    expect(whatsNextMoves(room(), { laterTicked: 6 })[0].key).toBe('vote-later');
    expect(whatsNextMoves(room(), { laterTicked: 7 }).some((m) => m.key === 'vote-later')).toBe(false);
  });
  test('ideas in Later do not count as waiting ideas', () => {
    expect(whatsNextMoves(room({ ideas: room().ideas.filter((i) => i.status === 'later') })).some((m) => m.key === 'vote-ideas')).toBe(false);
  });
});
