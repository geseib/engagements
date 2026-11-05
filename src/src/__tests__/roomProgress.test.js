/**
 * HOW FAR ALONG IS THE ROOM, AND WHO IS STILL OUT (config/roomProgress.js;
 * docs/design/host-attention PLAN §4.1, Step 1; owner's answers of 5 Nov 2026:
 * names at six or fewer out, else a count; away apart; a latecomer during an
 * open step counts, one after it closed does not).
 *
 * // rejects: "1 answered / 0 voted" beside "2 of 2 answered" (D1, D9), and a
 * //          latecomer turning "2/2 answered" into "2/3" (D10).
 */
import {
  roomProgressFor, progressWords, waitingWords, recordWords, liveStepOf, WAITING_NAMES_MAX,
} from '../config/roomProgress';

const T0 = Date.parse('2026-11-05T10:00:00Z');
const iso = (s) => new Date(T0 + s * 1000).toISOString();
const person = (name, joinedS = -600, extra = {}) => ({ name, joinedAt: iso(joinedS), ...extra });

test('the live step, its words, and roster order kept', () => {
  const roster = ['Maya', 'Sam', 'Priya', 'Jon', 'Hannah'].map((n) => person(n));
  const p = roomProgressFor({ moment: 'ANSWERING', roster, answer: { names: ['Priya', 'Maya'], count: 2 } });
  expect(p.live).toBe('answer');
  const s = liveStepOf(p);
  expect(progressWords(s)).toBe('2/5 answered');
  expect(s.waiting).toEqual(['Sam', 'Jon', 'Hannah']);
  expect(waitingWords(s).text).toBe('Waiting on Sam, Jon, Hannah');
  expect(p.byName).toMatchObject({ Maya: 'done', Sam: 'out', Priya: 'done' });
});

test('away is split from waiting, and counts inside the six', () => {
  const roster = [person('Ana'), person('Raj', -600, { deviceConnected: false }), person('Lee'), person('Tom', -600, { deviceConnected: false })];
  const s = liveStepOf(roomProgressFor({ moment: 'ANSWERING', roster, answer: { names: ['Lee'], count: 1 } }));
  expect(s.waiting).toEqual(['Ana']);
  expect(s.away).toEqual(['Raj', 'Tom']);
  expect(waitingWords(s).text).toBe('Waiting on Ana · away: Raj, Tom');
  // A surface that may not say who is away folds them in.
  expect(waitingWords(s, { showAway: false }).text).toBe('Waiting on Ana, Raj, Tom');
});

test(`more than ${WAITING_NAMES_MAX} out: the count, the whole list in the long form`, () => {
  const roster = Array.from({ length: 15 }, (_, i) => person(`P${i}`));
  const s = liveStepOf(roomProgressFor({ moment: 'ANSWERING', roster, answer: { names: ['P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7'], count: 8 } }));
  const w = waitingWords(s);
  expect(w.text).toBe('7 still writing');
  expect(w.title).toBe('Waiting on P8, P9, P10, P11, P12, P13, P14');
  const six = waitingWords(liveStepOf(roomProgressFor({ moment: 'ANSWERING', roster, answer: { names: roster.slice(0, 9).map((p) => p.name), count: 9 } })));
  expect(six.text).toBe('Waiting on P9, P10, P11, P12, P13, P14');
});

test('names that lag the count: the count stays, no names', () => {
  const roster = ['A', 'B', 'C'].map((n) => person(n));
  const s = liveStepOf(roomProgressFor({ moment: 'ANSWERING', roster, answer: { names: ['A'], count: 2 } }));
  expect(s).toMatchObject({ known: false, done: 2, of: 3, waiting: [], away: [] });
  expect(waitingWords(s).text).toBe('1 still writing');
});

test('a latecomer during an open step is owed it; after it closed, not', () => {
  const roster = [person('Ges'), person('Bob', 200)];
  // Answering open, Bob joined during it: 1/2.
  expect(progressWords(liveStepOf(roomProgressFor({ moment: 'ANSWERING', roster, answer: { names: ['Ges'], count: 1, openedAt: iso(0) } })))).toBe('1/2 answered');
  // Voting opened at 120 s; Bob came at 200 s: answering stays 1/1.
  const p = roomProgressFor({
    moment: 'VOTING', roster, answer: { names: ['Ges'], count: 1, openedAt: iso(0), closedAt: iso(120) }, vote: { names: [], count: 0, openedAt: iso(120) },
  });
  expect(p.steps.find((s) => s.id === 'answer')).toMatchObject({ done: 1, of: 1, all: true, after: ['Bob'] });
  expect(progressWords(liveStepOf(p))).toBe('0/2 voted');
});

test('no-vote formats have no vote step; the record after the round', () => {
  const roster = ['A', 'B'].map((n) => person(n));
  const trivia = roomProgressFor({ moment: 'RESULTS', roster, noVote: true, answer: { names: ['A', 'B'], count: 2 } });
  expect(trivia.steps.map((s) => s.id)).toEqual(['answer']);
  expect(recordWords(trivia)).toBe('2/2 answered');
  const ca = roomProgressFor({ moment: 'RESULTS', roster, answer: { names: ['A', 'B'], count: 2 }, vote: { names: ['A'], count: 1 } });
  expect(recordWords(ca)).toBe('2/2 answered · 1/2 voted');
});

test('the room\'s question is its own live step, counted, names unknown until the wire carries them', () => {
  const roster = [person('Ges'), person('Bob')];
  const p = roomProgressFor({ moment: 'ROOM_QUESTION', roster, answer: { names: ['Ges'], count: 1 }, vote: { names: [], count: 0 }, ask: { n: 1 } });
  expect(p.live).toBe('ask');
  expect(progressWords(liveStepOf(p))).toBe('1/2 answered');
  expect(waitingWords(liveStepOf(p)).text).toBe('1 still answering');
  const named = roomProgressFor({ moment: 'ROOM_QUESTION', roster, ask: { n: 1, answeredBy: ['Ges'] } });
  expect(waitingWords(liveStepOf(named)).text).toBe('Waiting on Bob');
});

test('everyone in, once', () => {
  const roster = [person('A'), person('B')];
  const s = liveStepOf(roomProgressFor({ moment: 'VOTING', roster, answer: { names: ['A', 'B'], count: 2 }, vote: { names: ['B', 'A'], count: 2 } }));
  expect(s.all).toBe(true);
  expect(waitingWords(s).text).toBe("Everyone's in");
});
