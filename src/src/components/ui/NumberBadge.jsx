import React from 'react';
import './NumberBadge.css';

/**
 * NUMBER BADGE (docs/design/themes/SPEC.md §6, unit L4): the number in a circle.
 *
 *   <NumberBadge n={3} />                                  accent pill, surrounding size
 *   <NumberBadge n={12} size="var(--L-secondary)" />       the caller's ladder step
 *   <NumberBadge n={4} tone="muted" size={19} />           a ring, muted ink, 19px
 *
 * Props
 *   n          the number (or short text) inside. Rendered as given.
 *   size       the font size the badge is built from: a CSS length or var()
 *              string, or a number of px. Sets --ui-size; the pill is 1.7em tall.
 *              Omit it to inherit the surrounding font size.
 *   tone       'accent' (default: --accent fill, --on-accent ink) | 'muted'
 *              (no fill, --rule-strong ring, --muted ink). Anything else is accent.
 *   as         the element, default 'span'.
 *   className  appended; every other prop (aria-*, title, onClick…) passes through.
 *
 * Colour is the skin's, never this file's: Classic paints it orange, Present
 * blue. NumberBadge.css says why each pairing clears AA.
 */
const TONES = ['accent', 'muted'];

export function sizeValue(size) {
  if (size === undefined || size === null || size === '') return undefined;
  return typeof size === 'number' ? `${size}px` : String(size);
}

export default function NumberBadge({ n, size, tone = 'accent', as: Tag = 'span', className = '', style, ...rest }) {
  const t = TONES.includes(tone) ? tone : 'accent';
  const s = sizeValue(size);
  const merged = s ? { ...style, '--ui-size': s } : style;
  return (
    <Tag className={`ui-badge ui-badge--${t}${className ? ` ${className}` : ''}`} style={merged} {...rest}>
      {n}
    </Tag>
  );
}
