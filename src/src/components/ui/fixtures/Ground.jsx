import React from 'react';
import Ground from '../Ground';

/**
 * Gallery fixture for unit L9 (gallery:ui-ground). The page ground on dusk and
 * on paper, and the wall ground, each with a line of copy so the ink shows.
 * Under the Call profile all three go flat. The fixture's own box (padding,
 * height, corner) is inline because Ground sets no layout of its own.
 * Sample data only: no network. Uses the gallery's .sg-pair class
 * (components/SkinGallery.css).
 */
const BOX = { padding: '24px', minHeight: '160px', borderRadius: '16px' };

export default function GroundFixture() {
  return (
    <div className="sg-pair">
      <div data-theme="dark">
        <Ground style={BOX}>
          <p>Page ground, dusk</p>
        </Ground>
      </div>
      <div data-theme="light">
        <Ground style={BOX}>
          <p>Page ground, paper</p>
        </Ground>
      </div>
      <Ground variant="wall" style={BOX}>
        <p>Wall ground</p>
      </Ground>
    </div>
  );
}
