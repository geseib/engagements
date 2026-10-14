/**
 * Notice behaviour — components/ui/Notice.jsx (unit L12). Colours are pinned by
 * uiNoticePalette.test.js; this pins the markup and the tone mapping StatusMessage
 * will rely on when it adopts Notice's look.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import Notice, { NOTICE_TONES, noticeTone } from '../components/ui/Notice';

describe('Notice', () => {
  test('defaults: a note <div> with the words in a body, no icon', () => {
    const { container } = render(<Notice>Two sets are waiting for review.</Notice>);
    const el = container.firstChild;
    expect(el.tagName).toBe('DIV');
    expect(el.className).toBe('ui-notice ui-notice--note');
    expect(screen.getByText('Two sets are waiting for review.')).toHaveClass('ui-notice-body');
    expect(container.querySelector('.ui-notice-icon')).toBeNull();
  });

  test.each(NOTICE_TONES)('tone %s carries its class', (tone) => {
    const { container } = render(<Notice tone={tone}>Words</Notice>);
    expect(container.firstChild).toHaveClass('ui-notice', `ui-notice--${tone}`);
  });

  test("StatusMessage's tone names map onto Notice's", () => {
    expect(noticeTone('success')).toBe('ok');
    expect(noticeTone('error')).toBe('danger');
    expect(noticeTone('pending')).toBe('note');
    expect(noticeTone('nonsense')).toBe('note');
    expect(noticeTone(undefined)).toBe('note');
  });

  test('an icon is decorative and comes before the words', () => {
    const { container } = render(<Notice tone="danger" icon="XCircle">Upload failed.</Notice>);
    const icon = container.querySelector('.ui-notice-icon');
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    expect(icon.querySelector('svg')).not.toBeNull();
    expect(container.firstChild.firstChild).toBe(icon);
  });

  test('role, aria-live, as, className and other props pass through', () => {
    const { container } = render(
      <Notice as="section" tone="ok" role="status" aria-live="polite" className="mine" id="n1">Saved.</Notice>,
    );
    const el = container.firstChild;
    expect(el.tagName).toBe('SECTION');
    expect(el.className).toBe('ui-notice ui-notice--ok mine');
    expect(el).toHaveAttribute('role', 'status');
    expect(el).toHaveAttribute('aria-live', 'polite');
    expect(el).toHaveAttribute('id', 'n1');
    expect(screen.getByRole('status')).toHaveTextContent('Saved.');
  });
});
