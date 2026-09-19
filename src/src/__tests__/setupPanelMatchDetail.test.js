/**
 * `filterBrowserRows` — searching the detail as well, when asked to.
 *
 * Its own file, deliberately: setupPanel.test.js stays unedited (spec
 * 2026-09-19 §6), and every case in it still describes the in-session browser.
 * The set editor's preview is the one caller that passes `matchDetail: true`.
 */
import { filterBrowserRows, browserRow } from '../config/setupPanel';

// Searched for 'parking', each row is a different kind of hit, and each one is
// load-bearing. '4' matches on its title alone: without it, searching the
// detail INSTEAD of the title passes. '1' matches on its title AND its detail:
// without that, listing a double hit twice passes, and so does letting a
// detail hit skip the category chip. '2' matches on its detail alone.
const rows = [
  { id: '1', title: 'Which killer was caught by a parking ticket?', detail: 'New York, 1977: a parking ticket on his car.', category: 'History' },
  { id: '2', title: 'The Green River case', detail: 'Solved by a parking-lot survey in 2001.', category: 'Method' },
  { id: '3', title: 'Who was dubbed the Night Stalker?', detail: '', category: 'History' },
  { id: '4', title: 'What did the parking ticket cost him?', detail: 'Thirty-five dollars.', category: 'History' },
];
const ids = (list) => list.map((r) => r.id);

describe('matchDetail', () => {
  test('when true, a phrase from the detail finds the question', () => {
    expect(ids(filterBrowserRows(rows, { search: 'new york', matchDetail: true }))).toEqual(['1']);
  });

  test('when true, the title still matches, and a question matching both appears once', () => {
    // '1' matches on its title AND its detail; '2' on its detail alone; '4' on
    // its title alone.
    // rejects: searching the detail instead of the title once the flag is on,
    // which is the only mode the preview uses. '4' would drop out.
    // rejects: a union of title hits and detail hits. '1' would be listed twice.
    expect(ids(filterBrowserRows(rows, { search: 'parking', matchDetail: true }))).toEqual(['1', '2', '4']);
  });

  test('when false, the detail is not searched', () => {
    // rejects: widening the stage's own search. Its box says "Search titles…".
    expect(ids(filterBrowserRows(rows, { search: 'new york', matchDetail: false }))).toEqual([]);
    expect(ids(filterBrowserRows(rows, { search: 'parking', matchDetail: false }))).toEqual(['1', '4']);
  });

  test('off by default, so the in-session browser searches titles only', () => {
    expect(ids(filterBrowserRows(rows, { search: 'new york' }))).toEqual([]);
    expect(ids(filterBrowserRows(rows, { search: 'solved' }))).toEqual([]);
  });

  test('it composes with the category chip', () => {
    expect(ids(filterBrowserRows(rows, { search: 'parking', category: 'Method', matchDetail: true })))
      .toEqual(['2']);
  });

  test('a row with no detail at all does not throw', () => {
    expect(ids(filterBrowserRows([{ id: 'x', title: 'Bare' }], { search: 'zzz', matchDetail: true })))
      .toEqual([]);
  });

  test('it searches what browserRow projects, which is what both lists render', () => {
    const row = browserRow({ id: 'q', title: 'A title', questionDetail: 'A body sentence' });
    expect(ids(filterBrowserRows([row], { search: 'body sentence', matchDetail: true }))).toEqual(['q']);
  });
});
