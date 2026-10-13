import React from 'react';
import Eyebrow from '../Eyebrow';

/**
 * Gallery fixture for unit L1 (gallery:ui-eyebrow). Every tone, on dusk and on
 * paper, each above a line of body copy so the treatment reads in context.
 * Sample data only: no network. Uses the gallery's own .sg-pair/.sg-sheet/.sg-body
 * classes (components/SkinGallery.css) for the frame.
 */
const TONES = ['auto', 'muted', 'accent'];

function Sheet({ theme }) {
  return (
    <div className="sg-sheet" data-theme={theme}>
      {TONES.map((tone) => (
        <div key={tone}>
          <Eyebrow tone={tone}>{`Round 3 of 5 · tone ${tone}`}</Eyebrow>
          <p className="sg-body">What should we stop doing next quarter?</p>
        </div>
      ))}
      <Eyebrow as="h4" style={{ '--ui-eyebrow-size': '13px' }}>As an h4, at 13px</Eyebrow>
    </div>
  );
}

export default function EyebrowFixture() {
  return (
    <div className="sg-pair">
      <Sheet theme="dark" />
      <Sheet theme="light" />
    </div>
  );
}
