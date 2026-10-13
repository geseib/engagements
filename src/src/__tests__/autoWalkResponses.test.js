/**
 * AUTO WALKS THE RESPONSES (owner, 2026-10-13: "in auto forward mode, walk
 * through the responses").
 *
 * With two surfaces the wall shows the tally at RESULTS, not pages of cards,
 * so Auto walks the navigator instead: the tally has its moment, then Show
 * response 1 (the dock's secondary), then each response for as long as its
 * words take to read (the dock's primary: Next part, Next response, and after
 * the last, What we heard). Classic (one screen) keeps paging the cards.
 * During voting Auto still only waits for the vote: an enlarged response on
 * the wall while people vote tilts the vote (CHANGES Q15), so showing one then
 * stays the host's own act.
 */
const fs = require('fs');
const path = require('path');
const {
  autoDecision, RESULTS_PAGE_MS, responseDwellMs, RESPONSE_MIN_MS, RESPONSE_MAX_MS, RESPONSE_MS_PER_WORD,
} = require('../config/autoMode');

const ROOM = { enabled: true, playerCount: 5, answeredCount: 5, votedCount: 5 };

test('the tally has its moment, then the first response goes up', () => {
  expect(autoDecision({ ...ROOM, phase: 'RESULTS', walkResponses: true, responseCount: 4 }))
    .toEqual({ kind: 'secondary', delayMs: RESULTS_PAGE_MS, why: 'the tally has had its moment; the responses next' });
});

test('each response stays up for as long as it takes to read, then the primary moves on', () => {
  const text = 'one two three four five six seven eight nine ten '.repeat(4);
  const d = autoDecision({ ...ROOM, phase: 'RESPONSES', walkResponses: true, responseCount: 4, responseText: text });
  expect(d).toEqual({ kind: 'primary', delayMs: responseDwellMs(text), why: 'this response has been read' });
});

test('the dwell is words times a pace, clamped', () => {
  expect(responseDwellMs('')).toBe(RESPONSE_MIN_MS);
  expect(responseDwellMs('word '.repeat(10))).toBe(Math.max(RESPONSE_MIN_MS, 10 * RESPONSE_MS_PER_WORD));
  expect(responseDwellMs('word '.repeat(1000))).toBe(RESPONSE_MAX_MS);
});

test('with no responses RESULTS moves on as before, and classic still pages the cards', () => {
  expect(autoDecision({ ...ROOM, phase: 'RESULTS', walkResponses: true, responseCount: 0 }).kind).toBe('primary');
  expect(autoDecision({ ...ROOM, phase: 'RESULTS', page: 0, pages: 2 }).kind).toBe('page');
});

test('voting is unchanged: wait for the vote, never walk responses', () => {
  expect(autoDecision({ ...ROOM, phase: 'VOTE', votedCount: 3, walkResponses: true, responseCount: 4 })).toBeNull();
  expect(autoDecision({ ...ROOM, phase: 'VOTE_RESPONSES', votedCount: 3, walkResponses: true, responseCount: 4 })).toBeNull();
});

test('the host page wires it: walk under two surfaces, the secondary through the dock, a spotlight no pause', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'GameHostPage.jsx'), 'utf8');
  expect(src).toMatch(/walkResponses: twoSurfaces/);
  expect(src).toMatch(/decision\.kind === 'secondary'/);
  expect(src).toMatch(/secondary: hostControls\.secondary/);
  expect(src).toMatch(/spotlightOpen: !twoSurfaces && spotlightIndex !== null/);
});
