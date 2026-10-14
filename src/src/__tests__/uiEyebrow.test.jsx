/**
 * Eyebrow (components/ui/Eyebrow.jsx, PLAN §3 unit L1): the markup contract.
 * The look is uiEyebrowPalette.test.js; this drives the props.
 *
 *   - renders a <p> by default, any element with `as`;
 *   - tone auto adds no modifier (the skin's --eyebrow-color decides),
 *     muted and accent add theirs, an unknown tone falls back to auto;
 *   - className is passed through after the component's own classes;
 *   - other props (id, aria-*, style) land on the element;
 *   - the gallery fixture renders every tone on dusk and on paper.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import Eyebrow from '../components/ui/Eyebrow';
import EyebrowFixture from '../components/ui/fixtures/Eyebrow';

test('a <p class="ui-eyebrow"> by default, with its text', () => {
  render(<Eyebrow>Round 3 of 5</Eyebrow>);
  const el = screen.getByText('Round 3 of 5');
  expect(el.tagName).toBe('P');
  expect(el.className).toBe('ui-eyebrow');
});

test('`as` picks the element', () => {
  render(<Eyebrow as="h4">Answered</Eyebrow>);
  expect(screen.getByRole('heading', { level: 4, name: 'Answered' })).toHaveClass('ui-eyebrow');
});

test.each([
  ['auto', 'ui-eyebrow'],
  ['muted', 'ui-eyebrow ui-eyebrow--muted'],
  ['accent', 'ui-eyebrow ui-eyebrow--accent'],
  ['loud', 'ui-eyebrow'],
])('tone %s -> class "%s"', (tone, cls) => {
  render(<Eyebrow tone={tone}>Label</Eyebrow>);
  expect(screen.getByText('Label').className).toBe(cls);
});

test('className is passed through after the component\'s own', () => {
  render(<Eyebrow tone="muted" className="present-eyebrow">Label</Eyebrow>);
  expect(screen.getByText('Label').className).toBe('ui-eyebrow ui-eyebrow--muted present-eyebrow');
});

test('other props land on the element', () => {
  render(<Eyebrow id="ey" aria-label="Round" style={{ '--ui-eyebrow-size': '13px' }}>Label</Eyebrow>);
  const el = screen.getByText('Label');
  expect(el.id).toBe('ey');
  expect(el.getAttribute('aria-label')).toBe('Round');
  expect(el.style.getPropertyValue('--ui-eyebrow-size')).toBe('13px');
});

test('the gallery fixture shows every tone on dusk and on paper', () => {
  const { container } = render(<EyebrowFixture />);
  expect(container.querySelectorAll('[data-theme="dark"] .ui-eyebrow').length).toBe(4);
  expect(container.querySelectorAll('[data-theme="light"] .ui-eyebrow').length).toBe(4);
  for (const t of ['muted', 'accent']) expect(container.querySelectorAll(`.ui-eyebrow--${t}`).length).toBe(2);
});
