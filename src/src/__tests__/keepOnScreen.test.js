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

/* Walked on test 2026-10-10 at 659px: the Stage dock's "Press Space" hint
   comes and goes with the pointer, the HOST button moved 107px, and the open
   Host alert list kept the slide it was given at opening — 91px off the right
   edge. An open popover follows its anchor, not only a window resize. */
describe('useKeepOnScreen follows a moving anchor', () => {
  const React = require('react');
  const { render, act } = require('@testing-library/react');
  const { useKeepOnScreen } = require('../buildroom/keepOnScreen');

  test('the anchor moves while open: the popover is placed again', () => {
    jest.useFakeTimers();
    const realW = window.innerWidth;
    window.innerWidth = 659;
    let anchorLeft = 0; // where the button's wrap sits; the CSS hangs the panel from it
    function Pop() {
      const ref = React.useRef(null);
      useKeepOnScreen(ref, true, 'k');
      return <span className="wrap"><div className="pop" ref={ref} /></span>;
    }
    const { container } = render(<Pop />);
    const wrap = container.querySelector('.wrap');
    const pop = container.querySelector('.pop');
    wrap.getBoundingClientRect = () => rect(anchorLeft, 90);
    // The panel is 627px wide, right-aligned to the wrap's right edge, plus whatever slide it carries.
    pop.getBoundingClientRect = () => {
      const m = /translateX\((-?\d+)px\)/.exec(pop.style.transform || '');
      const left = anchorLeft + 90 - 627 + (m ? Number(m[1]) : 0);
      return rect(left, 627);
    };
    anchorLeft = 436; // hint showing: panel 6..633 at first, before any slide
    act(() => { window.dispatchEvent(new Event('resize')); });
    expect(pop.getBoundingClientRect().left).toBe(GUTTER);
    anchorLeft = 329; // the hint went away: the button moved 107px left
    act(() => { jest.advanceTimersByTime(100); });
    const r = pop.getBoundingClientRect();
    expect(r.left).toBeGreaterThanOrEqual(GUTTER);
    expect(r.right).toBeLessThanOrEqual(659 - GUTTER);
    window.innerWidth = realW;
    jest.useRealTimers();
  });
});
