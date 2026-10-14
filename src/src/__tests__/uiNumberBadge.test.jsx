/**
 * NUMBER BADGE BEHAVIOUR (components/ui/NumberBadge.jsx, skins unit L4).
 *
 * What the component promises its callers: the number, the tone class, the
 * caller's ladder step as --ui-size, and a passthrough for everything else.
 * Colour is asserted in uiNumberBadgePalette.test.js; nothing here is
 * geometric (jsdom has no layout engine).
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import NumberBadge, { sizeValue } from '../components/ui/NumberBadge';

test('renders the number in a span with the accent tone by default', () => {
  render(<NumberBadge n={3} />);
  const el = screen.getByText('3');
  expect(el.tagName).toBe('SPAN');
  expect(el).toHaveClass('ui-badge', 'ui-badge--accent');
  expect(el).not.toHaveClass('ui-badge--muted');
});

test('tone="muted" swaps the tone class; an unknown tone falls back to accent', () => {
  const { rerender } = render(<NumberBadge n={4} tone="muted" />);
  expect(screen.getByText('4')).toHaveClass('ui-badge--muted');
  rerender(<NumberBadge n={4} tone="loud" />);
  expect(screen.getByText('4')).toHaveClass('ui-badge--accent');
});

test('size sets --ui-size: a number is px, a string is passed through', () => {
  const { rerender } = render(<NumberBadge n={5} size={19} />);
  expect(screen.getByText('5').style.getPropertyValue('--ui-size')).toBe('19px');
  rerender(<NumberBadge n={5} size="var(--L-secondary)" />);
  expect(screen.getByText('5').style.getPropertyValue('--ui-size')).toBe('var(--L-secondary)');
  rerender(<NumberBadge n={5} />);
  expect(screen.getByText('5').style.getPropertyValue('--ui-size')).toBe('');
});

test('sizeValue: undefined, null and empty mean "inherit"', () => {
  expect(sizeValue(undefined)).toBeUndefined();
  expect(sizeValue(null)).toBeUndefined();
  expect(sizeValue('')).toBeUndefined();
  expect(sizeValue(0)).toBe('0px');
});

test('size keeps a caller style and className, and passes other props through', () => {
  render(<NumberBadge n={7} size={24} className="mine" style={{ marginLeft: '4px' }} aria-label="Response 7" title="Response 7" />);
  const el = screen.getByLabelText('Response 7');
  expect(el).toHaveClass('ui-badge', 'mine');
  expect(el.style.marginLeft).toBe('4px');
  expect(el.style.getPropertyValue('--ui-size')).toBe('24px');
  expect(el).toHaveAttribute('title', 'Response 7');
});

test('as renders another element (a button the host can click)', () => {
  const onClick = jest.fn();
  render(<NumberBadge n={2} as="button" type="button" onClick={onClick} />);
  const btn = screen.getByRole('button', { name: '2' });
  btn.click();
  expect(onClick).toHaveBeenCalledTimes(1);
  expect(btn).toHaveClass('ui-badge');
});

test('zero and text are rendered as given', () => {
  render(<><NumberBadge n={0} /><NumberBadge n="A" /></>);
  expect(screen.getByText('0')).toHaveClass('ui-badge');
  expect(screen.getByText('A')).toHaveClass('ui-badge');
});
