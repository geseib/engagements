/**
 * Ground (components/ui/Ground.jsx, PLAN §3 unit L9): the markup contract.
 * The look is uiGroundPalette.test.js; this drives the props.
 *
 *   - page (default): .ui-ground, no theme of its own (it takes the surface's);
 *   - wall: .ui-ground.ui-ground--wall and data-theme="dark", always — a caller's
 *     data-theme cannot turn the wall to paper;
 *   - an unknown variant is page; `as` picks the element;
 *   - className is passed through last; other props land on the element;
 *   - the gallery fixture renders page on dusk, page on paper, and the wall.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import Ground, { VARIANTS } from '../components/ui/Ground';
import GroundFixture from '../components/ui/fixtures/Ground';

test('page by default: a <div class="ui-ground"> with no theme of its own', () => {
  render(<Ground data-testid="g">x</Ground>);
  const el = screen.getByTestId('g');
  expect(el.tagName).toBe('DIV');
  expect(el.className).toBe('ui-ground');
  expect(el.hasAttribute('data-theme')).toBe(false);
});

test('wall: the wall class and dusk, even if the caller asks for paper', () => {
  render(<Ground variant="wall" data-testid="g" data-theme="light">x</Ground>);
  const el = screen.getByTestId('g');
  expect(el.className).toBe('ui-ground ui-ground--wall');
  expect(el.getAttribute('data-theme')).toBe('dark');
});

test('an unknown variant is the page ground', () => {
  render(<Ground variant="sky" data-testid="g">x</Ground>);
  expect(screen.getByTestId('g').className).toBe('ui-ground');
});

test('`as`, className and other props', () => {
  render(<Ground as="main" className="plr" id="field" aria-label="Field">x</Ground>);
  const el = screen.getByRole('main', { name: 'Field' });
  expect(el.className).toBe('ui-ground plr');
  expect(el.id).toBe('field');
});

test('the variants are page and wall', () => {
  expect(VARIANTS).toEqual(['page', 'wall']);
});

test('the gallery fixture renders page on dusk, page on paper, and the wall', () => {
  const { container } = render(<GroundFixture />);
  expect(container.querySelector('[data-theme="dark"] > .ui-ground:not(.ui-ground--wall)')).not.toBeNull();
  expect(container.querySelector('[data-theme="light"] > .ui-ground')).not.toBeNull();
  expect(container.querySelector('.ui-ground--wall[data-theme="dark"]')).not.toBeNull();
});
