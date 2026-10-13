import React from 'react';
import './Ground.css';

/**
 * GROUND — the page or canvas background (docs/design/themes/SPEC.md §6).
 *
 *   <Ground as="main" className="plr">…</Ground>          a page's field
 *   <Ground variant="wall" className="present-canvas">…</Ground>   the wall
 *
 * variant   'page' (default) paints --field in the surrounding theme;
 *           'wall' paints --wall-canvas and is always dusk (data-theme="dark")
 * as        the element to render (default 'div')
 * className passed through, after the component's own classes
 *
 * Flat --bg under the Call profile for both variants (Ground.css). Ground
 * paints only: it sets no size, padding or position — the surface's own class
 * does. Any other prop (id, aria-*, style) lands on the element.
 */
export const VARIANTS = ['page', 'wall'];

export default function Ground({ variant = 'page', as: Tag = 'div', className, children, ...rest }) {
  const v = VARIANTS.includes(variant) ? variant : 'page';
  const cls = ['ui-ground', v === 'wall' && 'ui-ground--wall', className].filter(Boolean).join(' ');
  const theme = v === 'wall' ? { 'data-theme': 'dark' } : {};
  return <Tag {...rest} {...theme} className={cls}>{children}</Tag>;
}
