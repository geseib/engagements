/**
 * TALLY ROW BEHAVIOUR (components/ui/TallyRow.jsx, skins unit L10).
 *
 * PLAN Phase 1 asks L10 to prove "tabular figures; bar min 3%". The bar's
 * width is set inline, so it is asserted here; tabular figures are a CSS
 * declaration, pinned as text in uiTallyRowPalette.test.js. No geometric
 * assertions (jsdom has no layout engine).
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import TallyRow, { barPercent, BAR_MIN_PERCENT } from '../components/ui/TallyRow';

test('rank, label, sub, bar and points in the Presentation\'s order', () => {
  const { container } = render(<TallyRow rank={1} label="Shorter meetings" sub="One decision" share={0.42} points={18} />);
  const row = container.firstChild;
  expect(row).toHaveClass('ui-trow');
  const kids = [...row.children].map((c) => c.className);
  expect(kids).toEqual(['ui-trow-rank', 'ui-trow-who', 'ui-trow-points']);
  expect(row.querySelector('.ui-trow-rank')).toHaveTextContent('1');
  const who = row.querySelector('.ui-trow-who');
  expect(who).toHaveTextContent('Shorter meetings');
  expect(who.querySelector('.ui-trow-sub')).toHaveTextContent('One decision');
  expect(who.querySelector('.ui-trow-bar').style.width).toBe('42%');
  const pts = row.querySelector('.ui-trow-points');
  expect(pts).toHaveTextContent('18points');
  expect(pts.querySelector('small.ui-trow-unit')).toHaveTextContent('points');
});

test('the bar is never under 3%, never over 100%', () => {
  expect(BAR_MIN_PERCENT).toBe(3);
  expect(barPercent(0)).toBe(3);
  expect(barPercent(0.001)).toBe(3);
  expect(barPercent(0.024)).toBe(3);
  expect(barPercent(0.035)).toBe(4);
  expect(barPercent(0.5)).toBe(50);
  expect(barPercent(1)).toBe(100);
  expect(barPercent(1.7)).toBe(100);
  const { container } = render(<TallyRow rank={3} label="A" share={0} points={0} />);
  expect(container.querySelector('.ui-trow-bar').style.width).toBe('3%');
});

test('the same width as the Presentation for every whole share', () => {
  for (let i = 0; i <= 100; i += 1) expect(barPercent(i / 100)).toBe(Math.max(3, Math.round((i / 100) * 100)));
});

test('no share is no bar; no points is an empty cell that keeps the column', () => {
  const { container } = render(<TallyRow rank={4} label="Fewer tools" share={null} points={null} />);
  expect(container.querySelector('.ui-trow-bar')).toBeNull();
  const pts = container.querySelector('.ui-trow-points');
  expect(pts).not.toBeNull();
  expect(pts).toBeEmptyDOMElement();
  expect(barPercent(undefined)).toBeNull();
  expect(barPercent('')).toBeNull();
  expect(barPercent('x')).toBeNull();
});

test('zero points is shown', () => {
  render(<TallyRow rank={5} label="Z" points={0} />);
  expect(screen.getByText('0', { exact: false }).closest('.ui-trow-points')).toHaveTextContent('0points');
});

test('a sub line carries its full text as its title (it may be cut)', () => {
  const long = 'We could start by asking the people who use it every day, and then the rest';
  const { container } = render(<TallyRow rank={1} label="A" sub={long} />);
  expect(container.querySelector('.ui-trow-sub')).toHaveAttribute('title', long);
});

test('no sub, no rank: no sub line, an empty rank cell', () => {
  const { container } = render(<TallyRow label="Only a label" />);
  expect(container.querySelector('.ui-trow-sub')).toBeNull();
  expect(container.querySelector('.ui-trow-rank')).toBeEmptyDOMElement();
});

test('unit and size; as, className and props pass through', () => {
  render(<ol><TallyRow as="li" rank={2} label="B" points={7} unit="votes" size={24} className="mine" data-n="2" /></ol>);
  const li = screen.getByText('B').closest('li');
  expect(li).toHaveClass('ui-trow', 'mine');
  expect(li).toHaveAttribute('data-n', '2');
  expect(li.style.getPropertyValue('--ui-size')).toBe('24px');
  expect(li.querySelector('.ui-trow-unit')).toHaveTextContent('votes');
});
