/**
 * Heading (components/ui/Heading.jsx, PLAN §3 unit L2): the markup contract.
 * The look is uiHeadingPalette.test.js; this drives the props.
 *
 *   - level picks <h1>..<h4>, clamped; the default is <h2>;
 *   - size picks the ladder step class; the default is title for h1, head else;
 *     an unknown size falls back to the default;
 *   - balance adds its class; className is passed through last; rest lands;
 *   - the gallery fixture renders every size on dusk and on paper.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import Heading, { SIZES } from '../components/ui/Heading';
import HeadingFixture from '../components/ui/fixtures/Heading';

test('an <h2 class="ui-heading ui-heading--head"> by default', () => {
  render(<Heading>Question sets</Heading>);
  const el = screen.getByRole('heading', { level: 2, name: 'Question sets' });
  expect(el.className).toBe('ui-heading ui-heading--head');
});

test.each([
  [1, 'H1', 'title'], [2, 'H2', 'head'], [3, 'H3', 'head'], [4, 'H4', 'head'],
  [0, 'H1', 'title'], [9, 'H4', 'head'], ['x', 'H2', 'head'],
])('level %p -> <%s>, default size %s', (level, tag, size) => {
  render(<Heading level={level}>Title</Heading>);
  const el = screen.getByText('Title');
  expect(el.tagName).toBe(tag);
  expect(el).toHaveClass(`ui-heading--${size}`);
});

test.each(SIZES)('size %s picks its ladder step', (size) => {
  render(<Heading level={1} size={size}>Title</Heading>);
  expect(screen.getByText('Title').className).toBe(`ui-heading ui-heading--${size}`);
});

test('an unknown size falls back to the level\'s default', () => {
  render(<Heading level={1} size="giant">Title</Heading>);
  expect(screen.getByText('Title').className).toBe('ui-heading ui-heading--title');
});

test('balance and className, in that order after the component\'s own', () => {
  render(<Heading level={1} size="hero" balance className="present-hero">Title</Heading>);
  expect(screen.getByText('Title').className).toBe('ui-heading ui-heading--hero ui-heading--balance present-hero');
});

test('other props land on the element', () => {
  render(<Heading id="t" title="Full title">Title</Heading>);
  const el = screen.getByText('Title');
  expect(el.id).toBe('t');
  expect(el.getAttribute('title')).toBe('Full title');
});

test('the gallery fixture shows every size on dusk and on paper, with a ladder set', () => {
  const { container } = render(<HeadingFixture />);
  for (const theme of ['dark', 'light']) {
    const sheet = container.querySelector(`[data-theme="${theme}"]`);
    expect(sheet.querySelectorAll('.ui-heading').length).toBe(SIZES.length);
    for (const s of SIZES) expect(sheet.style.getPropertyValue(`--ui-t-${s}`)).toMatch(/px$/);
  }
});
