import React from 'react';
import './Eyebrow.css';

/**
 * EYEBROW — the small capital label above a title (docs/design/themes/SPEC.md §6).
 *
 *   <Eyebrow>Round 3 of 5</Eyebrow>
 *   <Eyebrow as="h4" tone="muted">Answered</Eyebrow>
 *
 * as        the element to render (default 'p')
 * tone      'auto'   the skin's eyebrow colour (--eyebrow-color: muted in Classic,
 *                    accent in Present) — the default
 *           'muted'  muted in every skin
 *           'accent' accent copy in every skin (--accent-text)
 * className passed through, after the component's own classes
 *
 * Size comes from the caller's ladder through --ui-eyebrow-size (Eyebrow.css).
 * Any other prop (id, title, aria-*) lands on the element.
 */
const TONES = ['auto', 'muted', 'accent'];

export default function Eyebrow({ as: Tag = 'p', tone = 'auto', className, children, ...rest }) {
  const t = TONES.includes(tone) ? tone : 'auto';
  const cls = ['ui-eyebrow', t !== 'auto' && `ui-eyebrow--${t}`, className].filter(Boolean).join(' ');
  return <Tag className={cls} {...rest}>{children}</Tag>;
}
