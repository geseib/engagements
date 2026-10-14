/**
 * CARD BEHAVIOUR (components/ui/Card.jsx, skins unit L5).
 *
 * PLAN Phase 1 asks L5 to prove "--select-mark applied only when selected".
 * The mark lives in one rule, `.ui-card.is-selected` (pinned as text in
 * uiCardPalette.test.js), so here the proof is that the class appears exactly
 * when `selected` is true. No geometric assertions: jsdom has no layout.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import Card from '../components/ui/Card';

test('a plain card is a div with the ui-card class and no selection', () => {
  render(<Card>Plain</Card>);
  const el = screen.getByText('Plain');
  expect(el.tagName).toBe('DIV');
  expect(el).toHaveClass('ui-card');
  expect(el).not.toHaveClass('is-selected');
  expect(el.querySelector('.ui-card-head')).toBeNull();
});

test('selected adds is-selected, and only then', () => {
  const { rerender } = render(<Card selected>Chosen</Card>);
  expect(screen.getByText('Chosen')).toHaveClass('ui-card', 'is-selected');
  rerender(<Card selected={false}>Chosen</Card>);
  expect(screen.getByText('Chosen')).not.toHaveClass('is-selected');
  rerender(<Card selected={0}>Chosen</Card>);
  expect(screen.getByText('Chosen')).not.toHaveClass('is-selected');
});

test('a number badge renders a NumberBadge in the head, beside the head text', () => {
  const { container } = render(<Card badge={6} head={<b>Priya</b>}>Body</Card>);
  const head = container.querySelector('.ui-card > .ui-card-head');
  expect(head).not.toBeNull();
  const badge = head.querySelector('.ui-badge');
  expect(badge).toHaveTextContent('6');
  expect(badge).toHaveClass('ui-badge--accent');
  expect(head.querySelector('.ui-card-head-text')).toHaveTextContent('Priya');
  // the head comes before the body
  expect(container.querySelector('.ui-card').firstChild).toBe(head);
});

test('badge 0 is a badge; null, false and empty are none', () => {
  const { container, rerender } = render(<Card badge={0}>x</Card>);
  expect(container.querySelector('.ui-badge')).toHaveTextContent('0');
  for (const none of [null, false, '', undefined]) {
    rerender(<Card badge={none} head="Who">x</Card>);
    expect(container.querySelector('.ui-card-head')).toBeNull();
  }
});

test('a ready element as badge is rendered as given', () => {
  const { container } = render(<Card badge={<span className="mine">A</span>}>x</Card>);
  expect(container.querySelector('.ui-card-head .mine')).toHaveTextContent('A');
  expect(container.querySelector('.ui-badge')).toBeNull();
});

test('a badge without head has no head text slot', () => {
  const { container } = render(<Card badge={3}>x</Card>);
  expect(container.querySelector('.ui-card-head-text')).toBeNull();
});

test('as, className and other props pass through', () => {
  render(<ul><Card as="li" className="extra" data-n="4" aria-label="Response 4">x</Card></ul>);
  const el = screen.getByLabelText('Response 4');
  expect(el.tagName).toBe('LI');
  expect(el).toHaveClass('ui-card', 'extra');
  expect(el).toHaveAttribute('data-n', '4');
});
