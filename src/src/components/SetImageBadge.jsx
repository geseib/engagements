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
 *
 * ── THE BROKEN VARIANT ────────────────────────────────────────────────────
 *
 * The owner, asking for the verification result to be visible: *"so the
 * question set could have a image icon with the x over it for missing image?"*
 * That is `missingCount`, and it is the SAME component rather than a second
 * badge because the two states are one fact about one set — the rule against
 * stating a fact twice in a viewport (RATIONALE §4) applies just as much to
 * stating it in two different visual languages.
 *
 * `missingCount` is OPTIONAL and defaults to 0, so every existing caller —
 * QuestionSetsPanel, HostQuestionSetsDialog, QuickstartMenu, GameHostPage —
 * renders byte-for-byte what it rendered before. None of them knows the count:
 * it costs a bucket listing per set (GET /admin/question-sets/{id}/media) and
 * a list of forty sets is not the place to spend forty of those. The count is
 * passed where it is already known — the editor's Images panel.
 *
 * The colour is `--danger-text` and never `--danger`: #E5645E is 4.38:1 on
 * --surface, under AA, and this glyph is the whole message (styles.css:22-35).
 */
export default function SetImageBadge({
  hasImages,
  missingCount = 0,
  size = 15,
  withLabel = false,
  className = '',
}) {
  const missing = Number(missingCount) || 0;
  // A set with NO images cannot have missing ones — but if a caller says it
  // does, believe the count: it came from a bucket comparison and `hasImages`
  // is a stale boolean written at the last import.
  if (!hasImages && missing <= 0) return null;

  if (missing > 0) {
    return (
      <span
        className={`set-image-badge set-image-badge--missing ${className}`.trim()}
        title={`${missing} question${missing === 1 ? '' : 's'} point${missing === 1 ? 's' : ''} at an image that is not there`}
        data-testid="set-image-badge-missing"
      >
        <Icon name="ImageBroken" weight="fill" size={size} color="var(--danger-text)" />
        {withLabel && (
          <span className="set-image-badge__label">
            {missing} missing
          </span>
        )}
      </span>
    );
  }

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
