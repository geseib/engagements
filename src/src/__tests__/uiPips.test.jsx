/**
 * PIPS BEHAVIOUR (components/ui/Pips.jsx, skins unit L6).
 *
 * A port of the Presentation's Meter, page pips and track, so the model is
 * checked against the originals' arithmetic (present/PresentMoments.jsx Meter,
 * ReadPage; present/navigatorWindow.js trackOf), and the cap at 24 is proved.
 * Colour is uiPipsPalette.test.js's. No geometric assertions (jsdom).
 */
import React from 'react';
import { render } from '@testing-library/react';
import Pips, { pipsModel, PIPS_MAX } from '../components/ui/Pips';
import { trackOf } from '../present/navigatorWindow';

const pills = (container) => [...container.querySelectorAll('.ui-pips > i')].map((i) => i.className || '-');

test('the cap is 24', () => {
  expect(PIPS_MAX).toBe(24);
});

describe('meter', () => {
  test('one pill per person, the done ones on', () => {
    const { container } = render(<Pips variant="meter" done={3} of={5} />);
    expect(container.firstChild).toHaveClass('ui-pips', 'ui-pips--meter');
    expect(pills(container)).toEqual(['is-on', 'is-on', 'is-on', '-', '-']);
  });

  test('everyone done turns every pill to is-all', () => {
    const { container } = render(<Pips done={4} of={4} />);
    expect(pills(container)).toEqual(['is-all', 'is-all', 'is-all', 'is-all']);
  });

  test('past 24 people it scales onto 24 pills (the Meter arithmetic)', () => {
    const { container } = render(<Pips variant="meter" done={25} of={40} />);
    const p = pills(container);
    expect(p).toHaveLength(24);
    expect(p.filter((c) => c === 'is-on')).toHaveLength(Math.round((25 * 24) / 40));
  });

  test('done past of is everyone; nothing to count is no pills', () => {
    expect(pipsModel('meter', 9, 3).pills).toEqual(['is-all', 'is-all', 'is-all']);
    expect(pipsModel('meter', 0, 0).pills).toEqual([]);
    expect(pipsModel('meter', 2, undefined).pills).toEqual([]);
  });

  test('the same as the Presentation\'s Meter for every done x of up to 30', () => {
    for (let of = 0; of <= 30; of += 1) {
      for (let done = 0; done <= of + 1; done += 1) {
        const cap = Math.min(Math.max(0, of), 24);
        const on = of > 0 ? Math.round((Math.min(done, of) * cap) / of) : 0;
        const all = of > 0 && done >= of;
        const want = Array.from({ length: cap }, (_, i) => (i < on ? (all ? 'is-all' : 'is-on') : undefined));
        expect(pipsModel('meter', done, of).pills).toEqual(want);
      }
    }
  });
});

describe('pages', () => {
  test('the page on screen is on, the ones before it are seen (ReadPage)', () => {
    const { container } = render(<Pips variant="pages" done={2} of={5} />);
    expect(container.firstChild).toHaveClass('ui-pips--pages');
    expect(pills(container)).toEqual(['is-seen', 'is-seen', 'is-on', '-', '-']);
  });

  test('seen marks pages read beyond the current one', () => {
    expect(pipsModel('pages', 1, 5, 4).pills).toEqual(['is-seen', 'is-on', 'is-seen', 'is-seen', undefined]);
    expect(pipsModel('pages', 3, 5, 0).pills).toEqual([undefined, undefined, undefined, 'is-on', undefined]);
  });

  test('an index past the end clamps to the last page', () => {
    expect(pipsModel('pages', 9, 3).pills).toEqual(['is-seen', 'is-seen', 'is-on']);
  });

  test('past 24 pages it is one bar', () => {
    expect(pipsModel('pages', 0, 25)).toEqual({ kind: 'bar', at: 0 });
  });
});

describe('track', () => {
  test('one tick per response, the focused one on', () => {
    const { container } = render(<Pips variant="track" done={5} of={8} />);
    expect(container.firstChild).toHaveClass('ui-pips--track');
    expect(container.firstChild).not.toHaveClass('is-bar');
    expect(pills(container)).toEqual(['-', '-', '-', '-', '-', 'is-on', '-', '-']);
  });

  test('past 24 responses: a bar, the marker at index / (n - 1)', () => {
    const { container } = render(<Pips variant="track" done={29} of={60} />);
    const bar = container.firstChild;
    expect(bar).toHaveClass('ui-pips', 'ui-pips--track', 'is-bar');
    expect(bar.querySelectorAll('i')).toHaveLength(0);
    expect(bar.querySelector('.ui-pips-mark')).not.toBeNull();
    expect(Number(bar.style.getPropertyValue('--ui-pips-at'))).toBeCloseTo(29 / 59, 10);
  });

  test('the same as the Presentation\'s trackOf for every index x total up to 40', () => {
    for (let n = 0; n <= 40; n += 1) {
      for (let i = 0; i <= n; i += 1) {
        const t = trackOf(i, n);
        const m = pipsModel('track', i, n);
        if (t.kind === 'bar') expect(m).toEqual({ kind: 'bar', at: t.at });
        else expect(m.pills).toEqual(t.ticks.map((on) => (on ? 'is-on' : undefined)));
      }
    }
  });
});

describe('accessibility and passthrough', () => {
  test('without a label the pips are hidden from assistive tech', () => {
    const { container } = render(<Pips done={1} of={3} />);
    expect(container.firstChild).toHaveAttribute('aria-hidden', 'true');
    expect(container.firstChild).not.toHaveAttribute('role');
  });

  test('with a label they are one image with that name', () => {
    const { getByRole } = render(<Pips done={1} of={3} label="1 of 3 answered" />);
    const img = getByRole('img', { name: '1 of 3 answered' });
    expect(img).not.toHaveAttribute('aria-hidden');
  });

  test('an unknown variant is a meter; className and props pass through', () => {
    const { container } = render(<Pips variant="dots" done={1} of={2} className="mine" data-x="y" />);
    expect(container.firstChild).toHaveClass('ui-pips--meter', 'mine');
    expect(container.firstChild).toHaveAttribute('data-x', 'y');
  });
});
