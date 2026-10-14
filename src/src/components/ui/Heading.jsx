import React from 'react';
import './Heading.css';

/**
 * HEADING — the display title (docs/design/themes/SPEC.md §6).
 *
 *   <Heading level={1} size="hero" balance>Thirty-one people answered</Heading>
 *   <Heading level={2}>Question sets</Heading>
 *
 * level     1..4, the element (<h1>..<h4>); a number outside is clamped, a
 *           non-number is 2 (default 2)
 * size      'hero' | 'primary' | 'secondary'   the stage and wall ladder steps
 *           'title' | 'head'                    the laptop ladder steps (24 / 19)
 *           Default: 'title' for level 1, 'head' for the rest. Each size reads the
 *           caller's ladder through --ui-t-<size> (Heading.css), never a px.
 * balance   text-wrap: balance
 * className passed through, after the component's own classes
 *
 * The level is the document outline; the size is the look. They are separate
 * so a panel's h2 can wear the head step and a wall's h1 the hero step.
 */
export const SIZES = ['hero', 'primary', 'secondary', 'title', 'head'];

export default function Heading({ level = 2, size, balance = false, className, children, ...rest }) {
  const raw = Math.round(Number(level));
  const n = Number.isFinite(raw) ? Math.min(4, Math.max(1, raw)) : 2;
  const s = SIZES.includes(size) ? size : (n === 1 ? 'title' : 'head');
  const Tag = `h${n}`;
  const cls = ['ui-heading', `ui-heading--${s}`, balance && 'ui-heading--balance', className].filter(Boolean).join(' ');
  return <Tag className={cls} {...rest}>{children}</Tag>;
}
