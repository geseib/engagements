import React from 'react';
import NumberBadge from '../NumberBadge';

/**
 * Gallery fixture for NumberBadge (unit L4): both tones at three ladder steps,
 * on dusk and on paper. Sample data only; the coordinator mounts it in
 * components/SkinGallery.jsx as #gallery-ui-number-badge.
 */
function Sheet({ theme }) {
  return (
    <div className="sg-sheet" data-theme={theme}>
      <p className="sg-eyebrow">{theme === 'dark' ? 'Dusk' : 'Paper'}</p>
      {[15, 24, 40].map((size) => (
        <p key={size} className="sg-body">
          <NumberBadge n={3} size={size} />
          {' '}
          <NumberBadge n={12} size={size} />
          {' '}
          <NumberBadge n={128} size={size} />
          {' '}
          <NumberBadge n={4} size={size} tone="muted" />
          {' '}
          <NumberBadge n={27} size={size} tone="muted" />
        </p>
      ))}
    </div>
  );
}

export default function NumberBadgeFixture() {
  return (
    <div className="sg-pair">
      <Sheet theme="dark" />
      <Sheet theme="light" />
    </div>
  );
}
