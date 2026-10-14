/**
 * Chip behaviour — components/ui/Chip.jsx (unit L8). Colours are pinned by
 * uiChipPalette.test.js; this pins the markup the stylesheet relies on.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import Chip, { CHIP_TONES } from '../components/ui/Chip';

describe('Chip', () => {
  test('defaults: a muted <span> with no dot and no caps', () => {
    const { container } = render(<Chip>Draft</Chip>);
    const el = screen.getByText('Draft');
    expect(el.tagName).toBe('SPAN');
    expect(el.className).toBe('ui-chip ui-chip--muted');
    expect(container.querySelector('.ui-chip-dot')).toBeNull();
  });

  test.each(CHIP_TONES)('tone %s carries its class', (tone) => {
    render(<Chip tone={tone}>Word</Chip>);
    expect(screen.getByText('Word')).toHaveClass('ui-chip', `ui-chip--${tone}`);
  });

  test('the tones are the seven SPEC §6 names', () => {
    expect(CHIP_TONES).toEqual(['ask', 'vote', 'results', 'ok', 'warn', 'danger', 'muted']);
  });

  test('an unknown tone falls back to muted', () => {
    render(<Chip tone="primary">Word</Chip>);
    expect(screen.getByText('Word').className).toBe('ui-chip ui-chip--muted');
  });

  test('dot renders one decorative dot before the word; caps adds the stage treatment', () => {
    render(<Chip tone="ask" dot caps>Ask</Chip>);
    const el = screen.getByText('Ask');
    expect(el).toHaveClass('ui-chip--caps');
    const dot = el.querySelector('.ui-chip-dot');
    expect(dot).not.toBeNull();
    expect(dot).toHaveAttribute('aria-hidden', 'true');
    expect(el.firstChild).toBe(dot);
    expect(el).toHaveTextContent(/^Ask$/);
  });

  test('as, className and other props pass through', () => {
    render(<Chip as="li" tone="ok" className="mine" title="Published on 3 Oct" data-x="1">Published</Chip>);
    const el = screen.getByText('Published');
    expect(el.tagName).toBe('LI');
    expect(el.className).toBe('ui-chip ui-chip--ok mine');
    expect(el).toHaveAttribute('title', 'Published on 3 Oct');
    expect(el).toHaveAttribute('data-x', '1');
  });
});
