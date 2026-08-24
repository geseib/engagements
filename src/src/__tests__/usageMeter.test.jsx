/**
 * THE USAGE METER, RENDERED — components/UsageMeter.jsx.
 *
 * NO GEOMETRIC ASSERTIONS. jsdom has no layout engine: `getBoundingClientRect`
 * returns zeros, so "the fill is wider than the notch" would pass whatever the
 * component did. Every position here is asserted as the STRING the component
 * wrote — the inline width and the `data-percent` attribute — which is the
 * thing that actually reaches the browser.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import UsageMeter, { meterGeometry } from '../components/UsageMeter';

const row = (container, key) => container.querySelector(`[data-row="${key}"]`);
const fill = (container, key) => row(container, key).querySelector('.usg-fill');
const notch = (container, key) => row(container, key).querySelector('.usg-notch');

describe('the allowance is a notch on the track, not the end of it', () => {
  // rejects: capping the fill at the allowance. A bar that fills to 100% and
  // stops cannot show "15 over" — the overage stops being a length you can see.
  test('20 sessions against an included 5 runs the bar full and slides the notch to 25%', () => {
    const { container } = render(
      <UsageMeter rows={[{ key: 'sessions', label: 'Sessions run', used: 20, included: 5 }]} />,
    );
    expect(fill(container, 'sessions')).toHaveAttribute('data-percent', '100%');
    expect(fill(container, 'sessions').style.width).toBe('100%');
    expect(notch(container, 'sessions')).toHaveAttribute('data-percent', '25%');
    expect(notch(container, 'sessions').style.left).toBe('25%');
  });

  // rejects: scaling the track to the used count when nothing is over, which
  // would draw 3 of 5 as a full bar.
  test('3 sets against an included 5 fills 60% and leaves the notch at the end', () => {
    const { container } = render(
      <UsageMeter rows={[{ key: 'sets', label: 'Question sets stored', used: 3, included: 5 }]} />,
    );
    expect(fill(container, 'sets')).toHaveAttribute('data-percent', '60%');
    expect(notch(container, 'sets')).toHaveAttribute('data-percent', '100%');
    /* Right-aligned, or the label hangs into the gap before the value. */
    expect(notch(container, 'sets').className).toContain('usg-notch--end');
  });

  // rejects: `NaN%`, which CSS drops silently and which would leave the bar
  // empty on a plan with no allowance at all.
  test('an allowance of zero still produces a real percentage', () => {
    const g = meterGeometry(4, 0);
    expect(g.fill).toBe('100%');
    expect(g.notch).toBe('0%');
  });

  test('a fractional or absent count is trunc\'d, never rounded up into an overage', () => {
    expect(meterGeometry(4.9, 5).past).toBe(false);
    expect(meterGeometry(undefined, 5).used).toBe(0);
    expect(meterGeometry(-3, 5).used).toBe(0);
  });
});

describe('what the numbers say out loud', () => {
  // rejects: printing "20 of 5", which is arithmetic nobody says.
  test('past the allowance it names the overage', () => {
    const { container } = render(
      <UsageMeter rows={[{ key: 'sessions', label: 'Sessions run', used: 20, included: 5 }]} />,
    );
    expect(container.querySelector('.usg-value').textContent).toBe('20 · 15 over');
    expect(row(container, 'sessions').className).toContain('usg-row--over');
  });

  // rejects: treating the last included unit as ordinary. On a free plan 5 of 5
  // IS the wall, and finding that out afterwards is the failure this component
  // exists to prevent.
  test('exactly at the allowance it still reads as over', () => {
    const { container } = render(
      <UsageMeter rows={[{ key: 'sessions', label: 'Sessions run', used: 5, included: 5 }]} />,
    );
    expect(container.querySelector('.usg-value').textContent).toBe('5 of 5');
    expect(row(container, 'sessions').className).toContain('usg-row--over');
  });

  test('the track carries the whole sentence for a screen reader', () => {
    render(<UsageMeter rows={[{ key: 'sessions', label: 'Sessions run', used: 20, included: 5 }]} />);
    expect(screen.getByRole('img', { name: 'Sessions run: 20, 15 over the included 5' }))
      .toBeInTheDocument();
  });
});

describe('the compact strip on the host front door', () => {
  // rejects: wrapping the strip in a panel, or assuming a 150px label gutter.
  test('it renders bare, with no panel and no heading', () => {
    const { container } = render(
      <UsageMeter compact rows={[{ key: 'sessions', label: 'Sessions', used: 2, included: 5 }]} />,
    );
    const root = container.firstChild;
    expect(root.className).toContain('usg--compact');
    expect(container.querySelectorAll('h1, h2, h3, section')).toHaveLength(0);
  });

  // rejects: shrinking the printed "5 included" label below the 12px floor to
  // make it fit. A reduction with no recovery is a deletion, so the string moves
  // to a title= instead of disappearing.
  test('the dropped notch label is still recoverable', () => {
    const { container } = render(
      <UsageMeter compact rows={[{ key: 'sets', label: 'Sets', used: 3, included: 5 }]} />,
    );
    expect(notch(container, 'sets')).toHaveAttribute('title', '5 included');
    expect(notch(container, 'sets')).toHaveAttribute('data-label', '5 included');
  });
});

// rejects: letting the meter inherit its theme. index.html puts
// data-theme="light" on <html>; a dusk strip that does not declare its own
// renders #F4EDE4 on #FBF7F1.
test('the meter declares its own theme, and defaults to dusk', () => {
  const { container } = render(<UsageMeter rows={[{ key: 'a', label: 'A', used: 1, included: 5 }]} />);
  expect(container.firstChild).toHaveAttribute('data-theme', 'dark');
});

// rejects: rendering an empty grid with a gap in it where a meter should be.
test('no rows means no meter at all', () => {
  const { container } = render(<UsageMeter rows={[]} />);
  expect(container.firstChild).toBeNull();
});
