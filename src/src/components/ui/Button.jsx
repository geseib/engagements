import React, { forwardRef } from 'react';
import './Button.css';

/**
 * Button — every button (docs/design/themes/SPEC.md §6, PLAN Phase 1 unit L3;
 * experience plan §5.1, Phase 5 step 5a).
 *
 *   <Button variant="primary" size={36} onClick={start}>Start voting</Button>
 *   <Button variant="secondary" size={36}>Let them</Button>
 *   <Button variant="tertiary">See in People</Button>
 *   <Button variant="danger" size={44}>End session</Button>
 *   <Button variant="primary" size={56}>Join the session</Button>   (the phone dock)
 *
 * THE LOOKS (experience plan §5.1)
 *   'primary'    the ONE main action on a screen, orange: --action / --on-action. Under
 *                [data-surface="wall"] the roles hand it the skin's wall colour, so the
 *                Present wall shows blue and Classic's keeps the stage orange (SPEC §3.4).
 *                Class `ui-btn--action` (named for the role, never `--primary`: the
 *                button-class ratchet counts a `*-btn--primary` class as a scoped primary).
 *   'secondary'  quiet: outlined in --rule-strong, ink --text. Class `ui-btn--quiet`.
 *   'tertiary'   text only, no outline, in the link ink (--info on dusk, --accent-text
 *                on paper). It moves the eye, not the session ("See in People").
 *   'danger'     filled destructive: --danger-deep, light ink (5.16:1 in every skin/theme)
 *   'accent'     a filled accent button: --accent / --on-accent (the room's window)
 *   Older names, kept for callers that predate 5a: 'action' = primary, 'quiet' = secondary.
 *   The default, and the fallback for an unknown name, is secondary.
 *
 * THE SIZES
 *   36 | 44 | 56   a fixed height (experience plan §5.1): 36px laptop rows and bars,
 *                  44px dialog feet and touch, 56px the phone dock. Radius 10px; the
 *                  phone dock's is 14px.
 *   'sm' | 'md' (default) | 'lg'   padding and height in em only, for a surface whose
 *                  own ladder sets the height (the room's window).
 *   The FONT SIZE is always the caller's: the surface's ladder through `--ui-size`, else
 *   the parent's size, so the library never changes a screen's type (SPEC §6).
 * as       'button' (default, renders type="button" unless `type` is given), 'a', or any
 *          component. A disabled non-button gets aria-disabled and swallows its click.
 *
 * Every other prop passes through; `className` is appended; the ref is forwarded.
 */
/** Every look, by the class it renders (`ui-btn--<class>`). */
export const BUTTON_VARIANTS = ['action', 'accent', 'quiet', 'tertiary', 'danger'];
/** The §5.1 names, and the older ones, onto the class each renders. */
export const VARIANT_CLASS = Object.freeze({
  primary: 'action',
  secondary: 'quiet',
  tertiary: 'tertiary',
  danger: 'danger',
  accent: 'accent',
  action: 'action',
  quiet: 'quiet',
});
export const BUTTON_SIZES = ['sm', 'md', 'lg'];
/** The fixed heights (experience plan §5.1), class `ui-btn--h<px>`. */
export const BUTTON_HEIGHTS = [36, 44, 56];

/** The class suffix a `size` renders, or null for the default (md). */
export function sizeClass(size) {
  const n = typeof size === 'number' || /^\d+$/.test(String(size)) ? Number(size) : NaN;
  if (BUTTON_HEIGHTS.includes(n)) return `h${n}`;
  if (BUTTON_SIZES.includes(size) && size !== 'md') return size;
  return null;
}

const Button = forwardRef(function Button(
  { variant = 'secondary', size = 'md', as: As = 'button', className, type, disabled, onClick, children, ...rest },
  ref,
) {
  const v = Object.prototype.hasOwnProperty.call(VARIANT_CLASS, variant) ? VARIANT_CLASS[variant] : 'quiet';
  const s = sizeClass(size);
  const cls = ['ui-btn', `ui-btn--${v}`, s ? `ui-btn--${s}` : null, className].filter(Boolean).join(' ');

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
