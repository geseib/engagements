/**
 * The fitter's decisions, with the measuring taken away.
 *
 * jsdom has no layout engine, so every geometric assertion in
 * docs/design/host-redesign/audit.js returns zero here and would pass
 * unconditionally. What CAN be tested — and what actually broke in three
 * separate rounds of review — is the policy: the order things are sacrificed
 * in, the shape of the search, and which elements are even allowed to
 * abbreviate. All three shipped wrong at least once.
 */
import {
  ITERATIONS, searchScale, buildSacrificeList,
  declaresTruncation, isAbbreviated,
} from '../hooks/fitPolicy';

describe('the scale search', () => {
  /** A box that is clean at or below `threshold`. Monotonic, like the real one. */
  function boxCleanBelow(threshold) {
    let scale = 1;
    return {
      setScale: (v) => { scale = v; },
      isClean: () => scale <= threshold,
      get scale() { return scale; },
    };
  }

  test('a state that fits at full size is left at full size', () => {
    const box = boxCleanBelow(1);
    expect(searchScale({ min: 0.55, max: 1, isClean: box.isClean, setScale: box.setScale }))
      .toBe(1);
  });

  test('a state that fits nowhere in range returns null rather than a wrong answer', () => {
    const box = boxCleanBelow(0.4); // below the floor
    expect(searchScale({ min: 0.55, max: 1, isClean: box.isClean, setScale: box.setScale }))
      .toBeNull();
  });

  test('it converges from below, never returning a scale that is not clean', () => {
    const box = boxCleanBelow(0.8);
    const found = searchScale({ min: 0.55, max: 1, isClean: box.isClean, setScale: box.setScale });
    expect(found).toBeLessThanOrEqual(0.8);
    // Seven halvings of a 0.45-wide interval resolves to ~0.0035.
    expect(found).toBeGreaterThan(0.8 - 0.01);
  });

  test('it leaves the box AT the scale it returns, not at the last one it probed', () => {
    // This is the bug shape: a binary search that reports a good value but
    // leaves the element rendering at whatever the final probe set.
    const box = boxCleanBelow(0.8);
    const found = searchScale({ min: 0.55, max: 1, isClean: box.isClean, setScale: box.setScale });
    expect(box.scale).toBe(found);
  });

  test('the search is exactly seven iterations — a resolution, not a guess', () => {
    let probes = 0;
    const box = boxCleanBelow(0.8);
    searchScale({
      min: 0.55, max: 1,
      isClean: () => { probes += 1; return box.isClean(); },
      setScale: box.setScale,
    });
    // max probe + min probe + ITERATIONS midpoints.
    expect(probes).toBe(ITERATIONS + 2);
  });

  // data-grow: a state carrying one object — a wavelength subject, a champion,
  // a join code — may exceed the ladder. The ladder is a legibility FLOOR
  // derived from the room, not a ceiling, and a ladder tuned for a dense screen
  // under-uses a sparse one.
  // Corrected from the brief's boxCleanBelow(2): with max 2.2 that made the
  // box dirty AT max by construction, so no correct implementation — and no
  // clamped one either — could have passed it (see task-2-report.md). This
  // version is also dirty at max, so it can't take the "isClean() at max"
  // shortcut the very first test in this block already covers; it must walk
  // the binary-search loop to land above the ladder's ceiling of 1, which is
  // the actual invariant this test is named for.
  test('a growable state may exceed 1', () => {
    const box = boxCleanBelow(1.5);
    const found = searchScale({ min: 0.55, max: 2.2, isClean: box.isClean, setScale: box.setScale });
    expect(found).toBeGreaterThan(1); // exceeds the ladder's ceiling
    expect(found).toBeLessThanOrEqual(1.5);
    // Seven halvings of a 1.65-wide interval resolves to ~0.0129; double it
    // for floating-point slack rather than hard-coding an unrelated guess.
    const resolution = (2.2 - 0.55) / (2 ** ITERATIONS);
    expect(found).toBeGreaterThan(1.5 - resolution * 2);
  });
});

describe('the order of sacrifice', () => {
  const groups = [
    { el: 'pager', order: 1, note: null },
    { el: 'guarantee', order: 2, note: null },
    { el: 'third-answer', order: 3, note: 'Answers 3+' },
  ];

  // THE BUG THIS TEST EXISTS FOR. widen() used to run only AFTER every
  // data-drop group had been hidden, so a state discarded an ANSWER and then
  // kept a 233px standings column. Measured on 21-results-revealed at
  // 1280x720: two cards, meter kept, 117px unused, second place thrown away —
  // on the reveal beat, the payoff of the entire anonymity feature.
  test('the meter goes before any content group', () => {
    const list = buildSacrificeList({ hasMeter: true, isSolo: false, dropGroups: groups });
    expect(list[0].kind).toBe('meter');
    expect(list[0].order).toBe(-1);
  });

  test('groups follow in ascending declared order', () => {
    const list = buildSacrificeList({ hasMeter: true, isSolo: false, dropGroups: groups });
    expect(list.slice(1).map((e) => e.el)).toEqual(['pager', 'guarantee', 'third-answer']);
  });

  test('declaration order does not matter — only the number does', () => {
    const shuffled = [groups[2], groups[0], groups[1]];
    const list = buildSacrificeList({ hasMeter: true, isSolo: false, dropGroups: shuffled });
    expect(list.slice(1).map((e) => e.el)).toEqual(['pager', 'guarantee', 'third-answer']);
  });

  test('a state already solo does not offer the meter twice', () => {
    const list = buildSacrificeList({ hasMeter: true, isSolo: true, dropGroups: groups });
    expect(list.some((e) => e.kind === 'meter')).toBe(false);
  });

  test('a state with no meter still sacrifices its groups', () => {
    const list = buildSacrificeList({ hasMeter: false, isSolo: false, dropGroups: groups });
    expect(list.map((e) => e.kind)).toEqual(['group', 'group', 'group']);
  });

  test('an empty state has nothing to give up', () => {
    expect(buildSacrificeList({ hasMeter: false, isSolo: false, dropGroups: [] })).toEqual([]);
  });
});

describe('which elements may abbreviate at all', () => {
  const base = { webkitLineClamp: 'none', textOverflow: 'clip', whiteSpace: 'normal' };

  test('a line clamp declares a truncation', () => {
    expect(declaresTruncation({ ...base, webkitLineClamp: '2' })).toBe(true);
  });

  test('ellipsis plus nowrap declares a truncation', () => {
    expect(declaresTruncation({ ...base, textOverflow: 'ellipsis', whiteSpace: 'nowrap' })).toBe(true);
  });

  // text-overflow only applies to a block container with inline content. On a
  // flex box it is inert — which is exactly how the rail shipped clipping
  // mid-glyph with no ellipsis, at -445px of slack.
  test('ellipsis without nowrap declares nothing, because it cannot render', () => {
    expect(declaresTruncation({ ...base, textOverflow: 'ellipsis', whiteSpace: 'normal' })).toBe(false);
  });

  test('ordinary text declares nothing — it just wraps and makes its parent taller', () => {
    expect(declaresTruncation(base)).toBe(false);
  });
});

describe('detecting an actual abbreviation', () => {
  const clamped = { webkitLineClamp: '2', textOverflow: 'clip', whiteSpace: 'normal', lineHeight: '34.9272px', fontSize: '33.264px' };

  // THE OTHER BUG THIS EXISTS FOR. A block with a fractional line-height
  // reports a pixel of phantom overflow — measured, h1.q reported scrollHeight
  // 176 against clientHeight 175 — which made a naive predicate permanently
  // true, drove the search to its floor, and left 548px of a 795px box empty.
  test('one pixel of phantom overflow is not an abbreviation', () => {
    expect(isAbbreviated(clamped, { scrollHeight: 176, clientHeight: 175, scrollWidth: 0, clientWidth: 0 }))
      .toBe(false);
  });

  test('half a line of tolerance, and beyond it a real cut', () => {
    // Half of 34.93 is ~17.5. 190 - 175 = 15 is inside; 200 - 175 = 25 is not.
    expect(isAbbreviated(clamped, { scrollHeight: 190, clientHeight: 175, scrollWidth: 0, clientWidth: 0 }))
      .toBe(false);
    expect(isAbbreviated(clamped, { scrollHeight: 200, clientHeight: 175, scrollWidth: 0, clientWidth: 0 }))
      .toBe(true);
  });

  test('a horizontal cut counts, with a tighter tolerance', () => {
    expect(isAbbreviated(clamped, { scrollHeight: 0, clientHeight: 0, scrollWidth: 300, clientWidth: 200 }))
      .toBe(true);
  });

  test('an element that declares no truncation can never be abbreviated', () => {
    const plain = { webkitLineClamp: 'none', textOverflow: 'clip', whiteSpace: 'normal', lineHeight: '20px', fontSize: '16px' };
    expect(isAbbreviated(plain, { scrollHeight: 9999, clientHeight: 10, scrollWidth: 0, clientWidth: 0 }))
      .toBe(false);
  });
});
