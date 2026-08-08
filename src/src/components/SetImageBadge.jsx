import React from 'react';
import Icon from './Icon';

/**
 * Marks a question set that carries artwork.
 *
 * "Art Title" rounds are ordinary call-and-answer sets that happen to have an
 * Image column — deliberately not their own engagement type, so they keep
 * working with every existing filter, prompt and scoring path. The cost of that
 * decision is that nothing in a set list distinguishes them. This is the hint.
 *
 * Wording is generic ("Images", not "Artwork") so it still reads correctly if
 * images later appear on trivia or poll questions.
 */
export default function SetImageBadge({ hasImages, size = 15, withLabel = false, className = '' }) {
  if (!hasImages) return null;
  return (
    <span className={`set-image-badge ${className}`.trim()} title="This set includes images">
      <Icon name="Image" weight="duotone" size={size} color="var(--primary)" />
      {withLabel && <span className="set-image-badge__label">Images</span>}
    </span>
  );
}

/**
 * Text-only marker for <option> elements.
 *
 * A native <select> can only contain text — markup inside <option> is dropped
 * or mangled by the browser, which is why the icons that were swept into the
 * issue-report form had to be reverted. U+25A3 is a geometric shape rather than
 * a pictograph, so it stays consistent with retiring emoji-as-icons and renders
 * identically across platforms without a colour font.
 */
export const HAS_IMAGES_GLYPH = '▣';

/** Suffix for a set's label inside a <select>. Returns '' when there are none. */
export function imageMarkerSuffix(hasImages) {
  return hasImages ? ` ${HAS_IMAGES_GLYPH}` : '';
}
