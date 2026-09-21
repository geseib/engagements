import React from 'react';

/**
 * THE MOUNTAIN — one drawing of it, for every top-left corner.
 *
 * The path is the favicon's (public/favicon.svg) and the marketing shell's,
 * which until now was the only screen that drew it: the console showed an
 * amber gradient square and the welcome, join and sign-in screens showed the
 * word alone. The owner: "add that mountain logo throughout the top left."
 *
 * IT IS A PICTURE, NEVER A LINK. Whether the brand is a way home is each
 * screen's decision — the console, welcome and join screens wrap it in their
 * `/home` anchor; the session panel and the player bar deliberately do not,
 * because one stray tap there would take a projector or a participant out of
 * a live round. So this component renders no anchor and takes no href.
 *
 * `--primary` is theme-invariant (#F6A94C in dusk and paper alike), so the
 * mark needs no per-theme rule; the fallback covers a scope that re-declares
 * its own tokens and never defines `--primary` (the player's `--plr-*`).
 *
 * `alignSelf: center`, inline, because three of the wordmark rows it joins are
 * `align-items: baseline`, where a replaced element would otherwise sit on the
 * text baseline and ride high.
 */
export const BRAND_MARK_PATH = 'M2 27 L11 13 L16 20 L22 6 L30 27 Z';

export default function BrandMark({ size = 22, className = '', title }) {
  return (
    <svg
      className={`brand-mark${className ? ` ${className}` : ''}`}
      viewBox="0 0 32 32"
      width={size}
      height={size}
      style={{ flex: 'none', alignSelf: 'center' }}
      data-testid="brand-mark"
      {...(title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': 'true' })}
    >
      <path d={BRAND_MARK_PATH} fill="var(--primary, #F6A94C)" />
    </svg>
  );
}
