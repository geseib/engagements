/**
 * THE ROW FLAG — components/ui/RowFlag.jsx (experience plan §5.1 "Flag on a
 * row", step 5a): an amber dot plus words, never colour alone. Behaviour and
 * the stylesheet's contract (roles only, contrast composited across every
 * skin and theme).
 */
import React from 'react';
import { render } from '@testing-library/react';
import RowFlag, { ROW_FLAG_TONES } from '../components/ui/RowFlag';

const H = require('../testing/skinHarness');
const S = require('../testing/skinScan');

const CSS = H.css('components/ui/RowFlag.css');
const BODY = CSS.replace(/\/\*[\s\S]*?\*\//g, ' ');

describe('RowFlag', () => {
  test('a dot and the words; "ago" muted after a middle dot', () => {
    const { container } = render(<RowFlag ago="2 min ago">wants their name on a new device</RowFlag>);
    const flag = container.firstChild;
    expect(flag).toHaveClass('ui-flag', 'ui-flag--needs');
    expect(flag.querySelector('.ui-flag-dot')).toHaveAttribute('aria-hidden', 'true');
    expect(flag.querySelector('.ui-flag-words')).toHaveTextContent('wants their name on a new device');
    expect(flag.querySelector('.ui-flag-ago')).toHaveTextContent('· 2 min ago');
  });
  test('calm tone for a fact; an unknown tone falls back; className appended', () => {
    const { container, rerender } = render(<RowFlag tone="calm">away</RowFlag>);
    expect(container.firstChild).toHaveClass('ui-flag--calm');
    rerender(<RowFlag tone="loud" className="prow-flag">x</RowFlag>);
    expect(container.firstChild).toHaveClass('ui-flag--needs', 'prow-flag');
    expect(ROW_FLAG_TONES).toEqual(['needs', 'calm']);
  });
});

describe('RowFlag.css', () => {
  test('roles only: the gate at zero, no --primary', () => {
    expect(S.gateCounts(S.scanCss(CSS).counts)).toEqual({ colour: 0, font: 0, primary: 0 });
    expect(BODY).not.toMatch(/var\(--(primary|secondary|sk-)/);
  });
  test('every selector is rooted at .ui-flag; nothing under the 12px floor', () => {
    for (const m of BODY.matchAll(/([^{}]+)\{/g)) {
      for (const sel of m[1].split(',')) expect(sel.trim()).toMatch(/^\.ui-flag\b/);
    }
    expect(BODY).toMatch(/\.ui-flag-ago\s*\{[^}]*font-size:\s*max\(12px/);
  });
  test('the dot is the amber accent; the words never are', () => {
    expect(BODY).toMatch(/\.ui-flag-dot\s*\{[^}]*background:\s*var\(--accent\)/);
    expect(BODY).not.toMatch(/(^|[;{\s])color:\s*var\(--accent\)/);
  });
  test.each(H.CASES)('%s / %s: --text and --muted clear AA on every ground', (skin, theme) => {
    const opts = { skin, theme };
    for (const g of ['--bg', '--surface', '--surface-2']) {
      const ground = [H.role(g, opts)];
      expect(H.on(H.role('--text', opts), ground)).toBeGreaterThanOrEqual(H.AA);
      expect([g, H.on(H.role('--muted', opts), ground) >= H.AA]).toEqual([g, true]);
    }
  });
});
