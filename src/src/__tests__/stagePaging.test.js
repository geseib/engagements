/**
 * THE PAGING RULES, AND ABOVE ALL THE KEY GUARD.
 *
 * Nothing here measures anything. jsdom has no layout engine, so a test that
 * asked whether a page "fits" would return zero and pass with the feature
 * deleted (RESUME.md, Landmines). What is asserted instead is the mechanism:
 * which keys count, which are refused, where the slice starts, and what happens
 * to a page index when the list moves underneath it.
 *
 * The refusals are the important half. A presenter's clicker sends keys with no
 * meaningful `event.target`, so a key bound here is bound for the clicker; the
 * enumerated list below is what stops this feature from eating the room's
 * advance key.
 */
import {
  PAGE_SIZE, DEFAULT_PAGE_SIZE, pageSizeFor, pageCount, clampPage, pageSlice,
  pagerLabel, pageIntentFor,
} from '../config/stagePaging';

/** A key event shaped like the ones jsdom and a real browser both produce. */
const key = (k, extra = {}) => ({ key: k, target: null, ...extra });

describe('which keys page, and which are refused', () => {
  test('Down pages forward and Up pages back', () => {
    // rejects: a module that exports a paging API and never decides anything —
    // and rejects reversing the two, which the pager line's own "↑ ↓ to page"
    // fixes the direction of.
    expect(pageIntentFor(key('ArrowDown'))).toBe('next');
    expect(pageIntentFor(key('ArrowUp'))).toBe('prev');
  });

  test.each([
    [' ', 'Space — the room\'s advance key, printed on the dock'],
    ['Spacebar', 'the legacy Space name some clickers still send'],
    ['ArrowRight', 'a presenter clicker\'s forward button'],
    ['ArrowLeft', 'a presenter clicker\'s back button, reserved for the beat'],
    ['PageDown', 'what many remotes send INSTEAD of the arrows'],
    ['PageUp', 'the same remote\'s other button'],
    ['Enter', 'pins the QR and the waiting list'],
    ['Escape', 'dismisses the QR, the waiting list and the panel'],
    ['\\', 'toggles the session panel'],
  ])('%s is not a page turn (%s)', (k) => {
    // rejects: ANY widening of the key set. Every key on this list is either
    // already bound in this product or is one a presenter remote emits, and
    // binding one of them means a host pressing forward pages the answers
    // instead of advancing the round — in front of a room, with no way to tell
    // which happened.
    expect(pageIntentFor(key(k))).toBeNull();
  });

  test.each(['metaKey', 'ctrlKey', 'altKey', 'shiftKey'])('%s + Down is not a page turn', (mod) => {
    // rejects: dropping the modifier guard. Shift+Down is a text selection and
    // Cmd/Ctrl+Down is an OS or browser gesture; neither is a page turn, and
    // hijacking them makes the stage feel broken rather than driven.
    expect(pageIntentFor(key('ArrowDown', { [mod]: true }))).toBeNull();
  });

  test.each(['INPUT', 'TEXTAREA', 'SELECT'])('Down inside a %s belongs to the %s', (tag) => {
    // rejects: dropping the typing-target guard. A <select> IS driven by the
    // arrow keys and the stage has two in reach — the persona picker on
    // FIELD_NOTES and the display-profile picker in the session panel. Stealing
    // Down from an open select breaks something that already worked.
    expect(pageIntentFor(key('ArrowDown', { target: { tagName: tag } }))).toBeNull();
  });

  test('Down inside a contenteditable belongs to the caret', () => {
    // rejects: a guard that only checks tagName. contentEditable is how the
    // rich-text surfaces in this app take a caret, and none of them is an INPUT.
    expect(pageIntentFor(key('ArrowDown', { target: { tagName: 'DIV', isContentEditable: true } })))
      .toBeNull();
  });

  test('Down inside the session panel belongs to the panel', () => {
    // rejects: deleting the `.setup-panel` guard. The panel is deliberately NOT
    // part of shortcutsSuppressed — it stops at the top of the dock and the
    // primary stays live beneath it (utils/hostOverlays.js) — so the hazard it
    // does introduce has to be handled by where the key landed, exactly as
    // HostActionBar handles the same hazard for Space.
    const inPanel = { tagName: 'DIV', closest: (sel) => (sel === '.setup-panel' ? {} : null) };
    const outside = { tagName: 'DIV', closest: () => null };
    expect(pageIntentFor(key('ArrowDown', { target: inPanel }))).toBeNull();
    expect(pageIntentFor(key('ArrowDown', { target: outside }))).toBe('next');
  });

  test('a missing event is not a page turn', () => {
    expect(pageIntentFor(null)).toBeNull();
    expect(pageIntentFor(undefined)).toBeNull();
  });
});

describe('the per-profile budget', () => {
  test('every profile has its own number, and the larger ladders hold less', () => {
    // rejects: one page size for all four profiles. TV's ladder is ~1.3x Room's
    // on every rung and the design spec says of TV in so many words that "less
    // content fits"; Table's is ~0.65x and the reader is at arm's length. A
    // single number is the version that keeps cutting TV off, which is the
    // profile the owner reported.
    expect(PAGE_SIZE.room).toBe(3);
    expect(PAGE_SIZE.call).toBe(3);
    expect(PAGE_SIZE.tv).toBeLessThan(PAGE_SIZE.room);
    expect(PAGE_SIZE.table).toBeGreaterThan(PAGE_SIZE.room);
  });

  test('Room is what 05-vote.html draws', () => {
    // The mockup's own pager line reads "Responses 1–3 of 20", so Room is 3 by
    // observation rather than by taste.
    expect(pageSizeFor('room')).toBe(3);
  });

  test('an unknown profile falls back to Room, not to something permissive', () => {
    // rejects: a fallback of Infinity / answers.length "so nothing is hidden".
    // Showing too few is a page turn; showing too many is content off the
    // bottom of a projector, which is the defect.
    expect(pageSizeFor('hologram')).toBe(DEFAULT_PAGE_SIZE);
    expect(pageSizeFor(undefined)).toBe(DEFAULT_PAGE_SIZE);
    expect(DEFAULT_PAGE_SIZE).toBe(PAGE_SIZE.room);
  });
});

describe('the slice, and the label indices that go with it', () => {
  const answers = Array.from({ length: 20 }, (unused, i) => ({ answer: `a${i}` }));

  test('page two starts at the absolute index, not at zero', () => {
    // THE ONE THAT MATTERS MOST. Anonymous responses are labelled positionally
    // — displayLabelFor(answer, index) renders `Response ${index + 1}`, and
    // PlayerPage renders the same label from the same index on every phone in
    // the room. Mapping a page with a fresh counter labels page two's first
    // card "Response 1" on the projector while twelve phones call it
    // "Response 4", and the room votes for the wrong one.
    //
    // rejects: returning only the items, which forces the caller to map with a
    // page-local index — the shortest path to shipping this.
    const p = pageSlice(answers, 1, 3);
    expect(p.offset).toBe(3);
    expect(p.items.map((a) => a.answer)).toEqual(['a3', 'a4', 'a5']);
    expect(p.from).toBe(4);
    expect(p.to).toBe(6);
  });

  test('the last page is short rather than padded', () => {
    // rejects: slicing a fixed window off the end, which repeats responses the
    // room has already voted on.
    const p = pageSlice(answers, 6, 3);
    expect(p.items).toHaveLength(2);
    expect(p.offset).toBe(18);
    expect(p.to).toBe(20);
    expect(p.pages).toBe(7);
  });

  test('an empty list is one empty page, not zero pages', () => {
    // rejects: pageCount returning 0, which makes clampPage return -1 and
    // slice(-3) hand back the TAIL of the list.
    expect(pageCount(0, 3)).toBe(1);
    const p = pageSlice([], 0, 3);
    expect(p.items).toEqual([]);
    expect(p.from).toBe(0);
    expect(p.pages).toBe(1);
  });

  test('a shrinking list clamps the host to the last page instead of blanking the stage', () => {
    // rejects: leaving the raw index alone. Answers arrive and are re-fetched
    // while the host is paging; a host parked on page 7 when the list drops to
    // two pages gets an empty projector, which is indistinguishable from a
    // crash from twenty-five feet.
    expect(clampPage(6, 2)).toBe(1);
    const p = pageSlice(answers.slice(0, 4), 6, 3);
    expect(p.page).toBe(1);
    expect(p.items).toHaveLength(1);
  });

  test('a negative or nonsense index reads as page one', () => {
    expect(clampPage(-4, 5)).toBe(0);
    expect(clampPage(NaN, 5)).toBe(0);
  });
});

describe('the pager line says all three things', () => {
  test('which responses, which page, and how to move', () => {
    // rejects: dropping the key hint. A position indicator that does not say
    // how to change position is a status light — the room can see there is
    // more and nobody knows how to get to it. It is also the only place the
    // binding is documented to a host who never reads a doc-block.
    const line = pagerLabel({ from: 4, to: 6, total: 20, page: 1, pages: 7 });
    expect(line).toContain('Responses 4–6 of 20');
    expect(line).toContain('page 2 of 7');
    expect(line).toContain('↑ ↓');
  });
});
