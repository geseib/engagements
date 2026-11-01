/**
 * THE PULSE'S FACTS (config/consolePulse.js; session-start D3; experience plan
 * Phase 2 step 2c). Pure: every tile, every phase, the everyone's-in state and
 * the elapsed time, and the one-count rule for the Your-part-now status.
 *
 * // rejects: the count said three times on one console (People header
 * //          "9 of 12 answered", the card's status, the tile; audit A §3.4).
 */
import { pulseFor, formatClock, arrivalsSince, withoutRoomCount, pulsePhase, PULSE_WORDS } from '../config/consolePulse';

const T0 = Date.parse('2026-11-01T10:00:00Z');
const at = (s) => T0 + s * 1000;

describe('formatClock', () => {
  test('minutes and seconds, hours when needed, never negative', () => {
    expect(formatClock(84 * 1000)).toBe('1:24');
    expect(formatClock(5 * 1000)).toBe('0:05');
    expect(formatClock(3729 * 1000)).toBe('1:02:09');
    expect(formatClock(-4000)).toBe('0:00');
  });
});

describe('every phase keeps three tiles in the same order', () => {
  test.each(['LOBBY', 'ANSWERING', 'VOTING', 'VOTE_RESPONSES', 'RESULTS', 'RESPONSES', 'READ', 'FEEDBACK', 'ENDED', 'OTHER'])('%s', (moment) => {
    const p = pulseFor({ moment, players: 4, answered: 2, voted: 1, now: at(10), openedAt: at(0) });
    expect(Object.keys(p)).toEqual(['phase', 'room', 'time', 'since']);
    expect(p.room.eyebrow).toBeTruthy();
    expect(p.time.eyebrow).toBe(PULSE_WORDS.time);
    expect(p.since.eyebrow).toBe(PULSE_WORDS.since);
  });
});

describe('ASK: answered with a bar, then Everyone\'s in; time open since the round opened', () => {
  test('part way', () => {
    const p = pulseFor({ moment: 'ANSWERING', players: 12, answered: 9, openedAt: new Date(at(0)).toISOString(), now: at(84) });
    expect(p.room).toMatchObject({ eyebrow: 'Answered', value: '9', of: 'of 12', everyoneIn: false, sub: '3 still writing' });
    expect(p.room.bar).toBeCloseTo(0.75);
    expect(p.time).toMatchObject({ value: 'Open 1:24', sub: 'No limit set' });
  });
  test('everyone in', () => {
    const p = pulseFor({ moment: 'ANSWERING', players: 4, answered: 4, openedAt: at(0), now: at(30) });
    expect(p.room).toMatchObject({ everyoneIn: true, sub: "Everyone's in", bar: 1 });
  });
  test('the page\'s own everyone-in wins when it is given', () => {
    expect(pulseFor({ moment: 'ANSWERING', players: 4, answered: 3, everyoneIn: true }).room.everyoneIn).toBe(true);
  });
  test('nobody here yet is not everyone in', () => {
    const p = pulseFor({ moment: 'ANSWERING', players: 0, answered: 0 });
    expect(p.room).toMatchObject({ everyoneIn: false, sub: 'Nobody here yet', bar: 0 });
  });
  test('no stamp at all: the tile still says Open, never a wrong time', () => {
    expect(pulseFor({ moment: 'ANSWERING', players: 2, answered: 1 }).time.value).toBe('Open');
  });
});

describe('VOTE: voted, time since voting opened, answering\'s length under it', () => {
  test('from the vote stamp', () => {
    const p = pulseFor({ moment: 'VOTING', players: 12, answered: 12, voted: 7, openedAt: at(0), voteAt: at(134), now: at(176) });
    expect(p.room).toMatchObject({ eyebrow: 'Voted', value: '7', of: 'of 12', sub: '5 still voting', everyoneIn: false });
    expect(p.time).toMatchObject({ value: 'Open 0:42', sub: 'Answering took 2:14' });
  });
  test('everyone voted', () => {
    expect(pulseFor({ moment: 'VOTE_RESPONSES', players: 3, voted: 3 }).room).toMatchObject({ everyoneIn: true, sub: "Everyone's in" });
  });
  test('no vote stamp: elapsed since the round opened', () => {
    expect(pulseFor({ moment: 'VOTING', players: 3, voted: 1, openedAt: at(0), now: at(65) }).time).toMatchObject({ value: 'Open 1:05', sub: 'No limit set' });
  });
});

describe('RESULTS: the round in both counts, and how long it took', () => {
  test('took and voting took', () => {
    const p = pulseFor({ moment: 'RESULTS', players: 12, answered: 12, voted: 11, openedAt: at(0), voteAt: at(134), resultsAt: at(215), now: at(300) });
    expect(p.room).toMatchObject({ eyebrow: 'This round', value: '12', of: 'answered', sub: '11 voted', bar: null, everyoneIn: false });
    expect(p.time).toMatchObject({ value: 'Took 2:14', sub: 'Voting took 1:21' });
  });
  test('no stamps: closed, no made-up time', () => {
    expect(pulseFor({ moment: 'READ', players: 2, answered: 2, voted: 2 }).time).toMatchObject({ value: 'Round closed', sub: '' });
  });
});

describe('since this round opened', () => {
  const players = [
    { name: 'Priya', joinedAt: new Date(at(-600)).toISOString() },
    { name: 'Lee Park', joinedAt: new Date(at(40)).toISOString() },
    { name: 'Ana Gomez', joinedAt: new Date(at(20)).toISOString() },
    { name: 'No stamp' },
  ];
  test('arrivals are after the round opened, in the order they came', () => {
    expect(arrivalsSince(players, at(0))).toEqual(['Ana Gomez', 'Lee Park']);
    expect(arrivalsSince(players, null)).toEqual([]);
  });
  test('+N joined with the names; late count as its own line', () => {
    const p = pulseFor({ moment: 'ANSWERING', players: 4, arrivals: ['Ana Gomez', 'Lee Park'], late: 2, openedAt: at(0), now: at(60) });
    expect(p.since).toMatchObject({ value: '+2 joined', sub: 'Ana Gomez, Lee Park' });
    expect(p.since.late).toEqual({ count: 2, text: '2 late items not reviewed' });
  });
  test('nobody new, nothing late', () => {
    const p = pulseFor({ moment: 'VOTING', players: 4, arrivals: [] });
    expect(p.since).toMatchObject({ value: 'No one new', sub: '', late: null });
  });
  test('the lobby has no round yet', () => {
    expect(pulseFor({ moment: 'LOBBY', players: 3, arrivals: ['x'] }).since.value).toBe('No round yet');
  });
});

describe('one count, once: the card\'s status drops the room\'s count while the pulse shows it', () => {
  test('answering: the count and the late count both go (tiles 1 and 3 say them)', () => {
    const s = { text: '3 of 4 answered · 1 late answer kept', tone: 'pending', late: { line: '1 late answer kept', link: '1 late answer kept' } };
    expect(withoutRoomCount(s, 'ANSWERING')).toEqual({ text: '', tone: '' });
  });
  test('the read: its page stays, the late count goes', () => {
    const s = { text: 'Reading page 2 of 3 · 2 late items not reviewed', tone: 'info', late: { line: '2 late items not reviewed', link: '2 late items not reviewed' } };
    expect(withoutRoomCount(s, 'READ')).toEqual({ text: 'Reading page 2 of 3', tone: 'info' });
  });
  test('the end: the whole "N items not reviewed · Review" line goes', () => {
    const s = { text: '2 items not reviewed · Review', tone: 'pending', late: { line: '2 items not reviewed', link: 'Review' } };
    expect(withoutRoomCount(s, 'ENDED').text).toBe('');
  });
  test('voting: the count goes, which response is up stays', () => {
    expect(withoutRoomCount({ text: 'All 4 voted · Showing response 1 of 6', tone: 'success' }, 'VOTING').text).toBe('Showing response 1 of 6');
  });
  test('only the count: nothing left, no tone', () => {
    expect(withoutRoomCount({ text: '2 of 5 answered', tone: 'pending' }, 'ANSWERING')).toEqual({ text: '', tone: '' });
  });
  test('other phases and other words are left alone', () => {
    const r = { text: 'Results on screen', tone: 'info' };
    expect(withoutRoomCount(r, 'RESULTS')).toBe(r);
    const w = { text: 'Waiting for players to join', tone: 'pending' };
    expect(withoutRoomCount(w, 'ANSWERING')).toBe(w);
  });
});

test('phases map as D3\'s table', () => {
  expect(pulsePhase('ANSWERING')).toBe('answer');
  expect(pulsePhase('VOTE_RESPONSES')).toBe('vote');
  expect(pulsePhase('READ')).toBe('after');
  expect(pulsePhase('LOBBY')).toBe('lobby');
  expect(pulsePhase('NONSENSE')).toBe('lobby');
});
