import React from 'react';
import Heading, { SIZES } from '../Heading';

/**
 * Gallery fixture for unit L2 (gallery:ui-heading). Every size on dusk and on
 * paper. The gallery has no ladder of its own, so the fixture sets the five
 * --ui-t-* hooks the way a surface would (here the laptop steps and a
 * wall-like run above them). Sample data only: no network. Frames use the
 * gallery's .sg-pair / .sg-sheet classes (components/SkinGallery.css).
 */
const LADDER = {
  '--ui-t-hero': '48px',
  '--ui-t-primary': '36px',
  '--ui-t-secondary': '28px',
  '--ui-t-title': '24px',
  '--ui-t-head': '19px',
};

function Sheet({ theme }) {
  return (
    <div className="sg-sheet" data-theme={theme} style={LADDER}>
      {SIZES.map((size) => (
        <Heading key={size} level={size === 'hero' ? 1 : 2} size={size} balance={size === 'hero'}>
          {`${size}: Thirty-one people answered`}
        </Heading>
      ))}
    </div>
  );
}

export default function HeadingFixture() {
  return (
    <div className="sg-pair">
      <Sheet theme="dark" />
      <Sheet theme="light" />
    </div>
  );
}
