import React from 'react';
import './Chip.css';

/**
 * Chip — a phase or status chip (docs/design/themes/SPEC.md §6, PLAN Phase 1 unit L8).
 *
 *   <Chip tone="ask" dot caps>Ask</Chip>         the stage's phase chip idiom
 *   <Chip tone="ok">Published</Chip>              a status chip in a table row
 *
 * tone   'ask' | 'vote' | 'results'   the three phases (--phase-*): orange/blue/green in
 *                                     Classic, blue/blue/green in Present
 *        'ok' | 'warn' | 'danger'     status (--success-text, --warn, --danger-text)
 *        'muted'                      (default) neither
 *        The WORD carries the meaning; the colour repeats it. On paper the ink is --text
 *        (--danger-deep for danger) and the tone shows in the outline and the dot, because
 *        the dusk inks are under AA on paper (Chip.css says why).
 * dot    a leading dot in the tone's colour
 * caps   the stage treatment: display face, uppercase, tracked
 * as     'span' (default) or any element/component
 *
 * Every other prop passes through; `className` is appended. Size is the caller's
 * (`--ui-size`, else .8em of the parent).
 */
export const CHIP_TONES = ['ask', 'vote', 'results', 'ok', 'warn', 'danger', 'muted'];

export default function Chip({ tone = 'muted', dot = false, caps = false, as: As = 'span', className, children, ...rest }) {
  const t = CHIP_TONES.includes(tone) ? tone : 'muted';
  const cls = ['ui-chip', `ui-chip--${t}`, caps ? 'ui-chip--caps' : null, className].filter(Boolean).join(' ');
  return (
    <As className={cls} {...rest}>
      {dot ? <span className="ui-chip-dot" aria-hidden="true" /> : null}
      {children}
    </As>
  );
}
