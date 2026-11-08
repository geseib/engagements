/**
 * THE ROOM TILE'S FACTS (config/consolePulse.js; owner's cut 5, 5 Nov 2026,
 * which made the pulse's three tiles one). Pure: every phase, the
 * everyone's-in state, who is left, the elapsed time from a stamp the page was
 * given, and the one-count rule for the Your-part-now status.
 *
 * // rejects: the count said three times on one console (People header
 * //          "9 of 12 answered", the card's status, the tile; audit A §3.4).
 */
import { pulseFor, formatClock, arrivalsSince, withoutRoomCount, pulsePhase } from '../config/consolePulse';
import { roomProgressFor } from '../config/roomProgress';

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

describe('one room tile in every phase (cut 5, 5 Nov 2026)', () => {
  test.each(['LOBBY', 'ANSWERING', 'VOTING', 'VOTE_RESPONSES', 'RESULTS', 'RESPONSES', 'READ', 'FEEDBACK', 'ENDED', 'OTHER'])('%s', (moment) => {
    const p = pulseFor({ moment, players: 4, answered: 2, voted: 1, now: at(10), openedAt: at(0) });
    // rejects: the three tiles (room, time, since) that took ~110px for one fact.
    expect(Object.keys(p)).toEqual(['phase', 'room', 'time', 'joined']);
    expect(p.room.eyebrow).toBeTruthy();
  });
});

describe('ASK: 9/15 answered with a bar, open since the round opened, who is left', () => {
  test('part way, counts only: "3 still writing"', () => {
    const p = pulseFor({ moment: 'ANSWERING', players: 12, answered: 9, openedAt: new Date(at(0)).toISOString(), now: at(84) });
    expect(p.room).toMatchObject({ eyebrow: 'The room', value: '9', of: '/12', verb: 'answered', everyoneIn: false, nudge: '3 still writing' });
    expect(p.room.bar).toBeCloseTo(0.75);
    expect(p.time).toMatchObject({ value: 'open 1:24', state: 'none' });
  });
  test('with names: "Waiting on …" from roomProgressFor, away apart', () => {
    const roster = ['Maya', 'Sam', 'Hannah', 'Ravi', 'Tom'].map((name) => ({ name, deviceConnected: name !== 'Tom' }));
    const progress = roomProgressFor({ moment: 'ANSWERING', roster, answer: { names: ['Maya', 'Sam'], count: 2 } });
    const p = pulseFor({ moment: 'ANSWERING', progress, now: at(10) });
    expect(`${p.room.value}${p.room.of} ${p.room.verb}`).toBe('2/5 answered');
    expect(p.room.nudge).toBe('Waiting on Hannah, Ravi · away: Tom');
  });
  test('everyone in', () => {
    const p = pulseFor({ moment: 'ANSWERING', players: 4, answered: 4, openedAt: at(0), now: at(30) });
    expect(p.room).toMatchObject({ everyoneIn: true, nudge: "Everyone's in", bar: 1 });
  });
  test('the page\'s own everyone-in wins when it is given', () => {
    expect(pulseFor({ moment: 'ANSWERING', players: 4, answered: 3, everyoneIn: true }).room.everyoneIn).toBe(true);
  });
  test('nobody here yet is not everyone in', () => {
    const p = pulseFor({ moment: 'ANSWERING', players: 0, answered: 0 });
    expect(p.room).toMatchObject({ everyoneIn: false, nudge: 'Nobody here yet', bar: 0 });
  });
  test('no stamp at all: no time, never a wrong one', () => {
    expect(pulseFor({ moment: 'ANSWERING', players: 2, answered: 1 }).time).toBeNull();
  });
});

describe('VOTE: voted, open since voting opened, the answered count beside it', () => {
  test('from the vote stamp', () => {
    const p = pulseFor({ moment: 'VOTING', players: 12, answered: 12, voted: 7, openedAt: at(0), voteAt: at(134), now: at(176) });
    expect(p.room).toMatchObject({ value: '7', of: '/12', verb: 'voted', nudge: '5 still voting', everyoneIn: false, steps: '✓ 12/12 answered' });
    expect(p.time).toMatchObject({ value: 'open 0:42' });
  });
  test('everyone voted', () => {
    expect(pulseFor({ moment: 'VOTE_RESPONSES', players: 3, answered: 3, voted: 3 }).room).toMatchObject({ everyoneIn: true, nudge: "Everyone's in" });
  });
  test('no vote stamp: no clock (never the round\'s, never this tab\'s load time)', () => {
    expect(pulseFor({ moment: 'VOTING', players: 3, voted: 1, openedAt: at(0), now: at(65) }).time).toBeNull();
  });
});

describe('AFTER THE ROUND: the record, no clock', () => {
  test('"15/15 answered · 12/15 voted"', () => {
    const p = pulseFor({ moment: 'RESULTS', players: 15, answered: 15, voted: 12, openedAt: at(0), voteAt: at(134), now: at(300) });
    expect(p.room).toMatchObject({ eyebrow: 'This round', record: '15/15 answered · 12/15 voted', bar: null, everyoneIn: false });
    // rejects: "Took 10:30:37" (4 Nov), a page stamp against a server one.
    expect(p.time).toBeNull();
  });
  test('a vote count the page cannot know (0 after a reload) is left out', () => {
    expect(pulseFor({ moment: 'READ', players: 2, answered: 2, voted: 0 }).room.record).toBe('2/2 answered');
  });
  test('a no-vote format: answered only', () => {
    expect(pulseFor({ moment: 'RESULTS', players: 12, answered: 10, noVote: true }).room.record).toBe('10/12 answered');
  });
});

describe('joiners since the round opened, only when there are some', () => {
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
  test('+N joined with the names', () => {
    const p = pulseFor({ moment: 'ANSWERING', players: 4, arrivals: ['Ana Gomez', 'Lee Park'], openedAt: at(0), now: at(60) });
    expect(p.joined).toBe('+2 joined · Ana Gomez, Lee Park');
  });
  test('nobody new: nothing at all (rejects "No one new")', () => {
    expect(pulseFor({ moment: 'VOTING', players: 4, arrivals: [] }).joined).toBe('');
  });
  test('the lobby says how many are here, and no joiners line', () => {
    const p = pulseFor({ moment: 'LOBBY', players: 3, arrivals: ['x'] });
    expect(p.room).toMatchObject({ value: '3', verb: 'here' });
    expect(p.joined).toBe('');
  });
});

describe('one count, once: the card\'s status drops the room\'s count while the pulse shows it', () => {
  test('answering: the count and the late count both go (the room tile and the Needs-you line say them)', () => {
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
  test('the room\'s question: its count goes too (D2: it was said three times)', () => {
    expect(withoutRoomCount({ text: 'All 2 answered', tone: 'success' }, 'ROOM_QUESTION')).toEqual({ text: '', tone: '' });
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
  expect(pulsePhase('ROOM_QUESTION')).toBe('ask');
  expect(pulsePhase('LOBBY')).toBe('lobby');
  expect(pulsePhase('NONSENSE')).toBe('lobby');
});
