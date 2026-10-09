/**
 * A popover that hangs from a button stays inside the window (owner,
 * 2026-10-07: "be mindful of when dialog modals appear off screen"). Measured
 * on dev at a 659px-wide window, the header wrapped and the Wi-Fi panel sat
 * 321px past the left edge, the More menu 93px. jsdom has no layout, so the
 * rule is pinned as arithmetic on a rect.
 */
import { nudgeX, roomBelow, GUTTER } from '../buildroom/keepOnScreen';

const rect = (left, width, top = 100, height = 200) => ({ left, right: left + width, width, top, bottom: top + height, height });

describe('nudgeX: how far to slide a popover to keep it in the window', () => {
  test('inside the window: no slide', () => {
    expect(nudgeX(rect(100, 300), 800)).toBe(0);
  });
  test('past the left edge (the measured Wi-Fi panel): slides right to the gutter', () => {
    expect(nudgeX(rect(-321, 440), 659)).toBe(GUTTER + 321);
  });
  test('past the right edge: slides left to the gutter', () => {
    expect(nudgeX(rect(500, 300), 700)).toBe(700 - GUTTER - 800);
  });
  test('wider than the window: pins its left edge to the gutter', () => {
    expect(nudgeX(rect(-50, 900), 600)).toBe(GUTTER + 50);
  });
  test('the gutter is 16px', () => {
    expect(GUTTER).toBe(16);
  });
});

describe('roomBelow: the height a popover may use before it would run off the bottom', () => {
  test('the space from its top to the window bottom, less the gutter', () => {
    expect(roomBelow(rect(0, 100, 150), 900)).toBe(900 - 150 - GUTTER);
  });
  test('never less than a usable minimum', () => {
    expect(roomBelow(rect(0, 100, 880), 900)).toBe(160);
  });
});
