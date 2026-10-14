import React, { forwardRef } from 'react';
import './Button.css';

/**
 * Button — every button (docs/design/themes/SPEC.md §6, PLAN Phase 1 unit L3).
 *
 *   <Button variant="action" onClick={start}>Start the round</Button>
 *   <Button variant="quiet" size="sm">Skip</Button>
 *   <Button as="a" href="/help" variant="accent">Read the guide</Button>
 *
 * variant  'action'  the ONE main action on a screen: --action / --on-action. Under
 *                    [data-surface="wall"] the roles hand it the skin's wall colour, so the
 *                    Present wall shows blue and Classic's keeps the stage orange (SPEC §3.4).
 *          'accent'  a filled accent button: --accent / --on-accent
 *          'quiet'   (default) outlined in --rule-strong, ink --text
 *          'danger'  filled destructive: --danger-deep, light ink (5.16:1 in every skin/theme)
 * size     'sm' | 'md' (default) | 'lg' — padding and height in em only. The FONT SIZE is the
 *          caller's: the surface's own ladder through `--ui-size`, else the parent's size, so
 *          the library never changes a screen's layout (SPEC §6, last paragraph).
 * as       'button' (default, renders type="button" unless `type` is given), 'a', or any
 *          component. A disabled non-button gets aria-disabled and swallows its click.
 *
 * Every other prop passes through; `className` is appended; the ref is forwarded.
 */
export const BUTTON_VARIANTS = ['action', 'accent', 'quiet', 'danger'];
export const BUTTON_SIZES = ['sm', 'md', 'lg'];

const Button = forwardRef(function Button(
  { variant = 'quiet', size = 'md', as: As = 'button', className, type, disabled, onClick, children, ...rest },
  ref,
) {
  const v = BUTTON_VARIANTS.includes(variant) ? variant : 'quiet';
  const s = BUTTON_SIZES.includes(size) ? size : 'md';
  const cls = ['ui-btn', `ui-btn--${v}`, s === 'md' ? null : `ui-btn--${s}`, className].filter(Boolean).join(' ');

  if (As === 'button') {
    return (
      <button ref={ref} type={type || 'button'} className={cls} disabled={disabled} onClick={onClick} {...rest}>
        {children}
      </button>
    );
  }

  const guarded = disabled
    ? (e) => { e.preventDefault(); e.stopPropagation(); }
    : onClick;
  return (
    <As
      ref={ref}
      type={type}
      {...rest}
      className={cls}
      aria-disabled={disabled ? 'true' : undefined}
      tabIndex={disabled ? -1 : rest.tabIndex}
      onClick={guarded}
    >
      {children}
    </As>
  );
});

export default Button;
