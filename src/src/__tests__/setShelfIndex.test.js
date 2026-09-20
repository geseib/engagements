/**
 * THE INDEX AT THE FRONT OF THE LIBRARY — config/setShelfIndex.js.
 *
 * Two questions a person browsing asks that a filter cannot answer: which
 * shelves have anything on them, and which words the sets actually carry. The
 * filter offers the whole closed vocabulary (fifteen shelves, always) because
 * that is what a vocabulary is; this counts what is really there.
 *
 * React-free, like config/listControls.js, so the counting is asserted here
 * without a DOM and the component test can be about the markup.
 */
import {
  topicIndex,
  tagIndex,
  filterTagIndex,
} from '../config/setShelfIndex';
import { UNFILED, UNFILED_LABEL } from '../config/setTopics';

/** Deliberately includes the two rows every reader has to survive: a set from
 *  before the field existed, and a set whose stored shelf is not one. */
const SETS = [
  { id: 'a', topic: 'history', tags: ['1980s', 'cold-war'] },
  { id: 'b', topic: 'history', tags: ['1980s'] },
  { id: 'c', topic: 'science-technology', tags: ['onboarding'] },
  { id: 'd' },
  { id: 'e', topic: 'not-a-shelf', tags: [] },
  { id: 'f', topic: 'music', tags: ['Cold War', 'cold-war'] },
];

describe('topicIndex — which shelves have sets on them', () => {
  test('it counts each shelf in use and names it', () => {
    // rejects: counting the raw stored string, which would file the `history`
    // rows under two different keys the day one of them stored `History`.
    expect(topicIndex(SETS)).toEqual([
      { id: 'history', label: 'History', count: 2 },
      { id: 'music', label: 'Music', count: 1 },
      { id: 'science-technology', label: 'Science & Technology', count: 1 },
      { id: UNFILED, label: UNFILED_LABEL, count: 2 },
    ]);
  });

  test('a shelf nothing sits on is not offered', () => {
    // An entry reading "Film & TV — 0" is a dead end wearing the same clothes
    // as a live one; computeDrops refuses those for the same reason.
    expect(topicIndex(SETS).map((entry) => entry.id)).not.toContain('film-tv');
  });

  test('Unfiled is last, because it is a state and not a shelf', () => {
    const ids = topicIndex(SETS).map((entry) => entry.id);
    expect(ids[ids.length - 1]).toBe(UNFILED);
  });

  test('a junk shelf counts as Unfiled rather than inventing a sixteenth', () => {
    // rejects: keying off the raw value, which would put "not-a-shelf" in the
    // index and offer a filter nothing can ever match.
    expect(topicIndex([{ topic: 'not-a-shelf' }])).toEqual([
      { id: UNFILED, label: UNFILED_LABEL, count: 1 },
    ]);
  });

  test('a library with nothing on any shelf indexes nothing', () => {
    expect(topicIndex([])).toEqual([]);
  });
});

describe('tagIndex — which words the sets carry', () => {
  test('it counts every tag, most-used first and then alphabetically', () => {
    expect(tagIndex(SETS)).toEqual([
      { tag: '1980s', count: 2 },
      { tag: 'cold-war', count: 2 },
      { tag: 'onboarding', count: 1 },
    ]);
  });

  test('one set spelling a tag two ways counts once', () => {
    // "Normalise on write, tolerate on read" (utils/tags.js). rejects: counting
    // raw strings, which would report three sets carrying `cold-war` when only
    // two do.
    expect(tagIndex([{ tags: ['Cold War', 'cold-war', 'COLD-WAR'] }])).toEqual([
      { tag: 'cold-war', count: 1 },
    ]);
  });

  test('a library where nobody has tagged anything indexes nothing', () => {
    expect(tagIndex([{ id: 'a' }, { id: 'b', tags: [] }])).toEqual([]);
  });
});

describe('filterTagIndex — searching the tags themselves', () => {
  const INDEX = tagIndex(SETS);

  test('a blank box is not a filter', () => {
    expect(filterTagIndex(INDEX, '')).toEqual(INDEX);
    expect(filterTagIndex(INDEX, '   ')).toEqual(INDEX);
  });

  test('it matches part of a tag', () => {
    expect(filterTagIndex(INDEX, 'cold')).toEqual([{ tag: 'cold-war', count: 2 }]);
  });

  test('typing what you would say finds what is stored', () => {
    expect(filterTagIndex(INDEX, 'Cold War')).toEqual([{ tag: 'cold-war', count: 2 }]);
  });

  test('the hyphen is not a wall in either direction', () => {
    // The stored form is kebab and the typed form is whatever somebody types.
    // `cold-war` must be reachable by "coldwar", and `onboarding` by
    // "on boarding" — rejects: comparing the two as written, which hides a tag
    // from the only spelling half the people will try.
    expect(filterTagIndex(INDEX, 'coldwar')).toEqual([{ tag: 'cold-war', count: 2 }]);
    expect(filterTagIndex(INDEX, 'On Boarding')).toEqual([{ tag: 'onboarding', count: 1 }]);
  });

  test('a query nothing carries matches nothing', () => {
    expect(filterTagIndex(INDEX, 'zzz')).toEqual([]);
  });
});
