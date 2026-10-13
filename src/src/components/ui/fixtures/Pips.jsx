import React from 'react';
import Pips from '../Pips';

/**
 * Gallery fixture for Pips (unit L6): every variant and state, on dusk (the
 * only theme pips render in). Laptop sizes are passed in, as a surface would;
 * the defaults are the Presentation's 1920x1080 pills. Sample data only; the
 * coordinator mounts it in components/SkinGallery.jsx as #gallery-ui-pips.
 */
const LAPTOP = {
  '--ui-meter-w': '22px', '--ui-meter-h': '6px', '--ui-meter-gap': '4px',
  '--ui-pages-w': '24px', '--ui-pages-h': '6px', '--ui-pages-gap': '5px',
  '--ui-track-w': '15px', '--ui-track-on-w': '28px', '--ui-track-h': '6px', '--ui-track-gap': '3px',
  '--ui-bar-w': '320px', '--ui-bar-h': '6px', '--ui-bar-mark-w': '8px', '--ui-bar-mark-h': '14px',
};

const ROWS = [
  ['Meter, 7 of 12 answered', { variant: 'meter', done: 7, of: 12 }],
  ['Meter, everyone answered', { variant: 'meter', done: 9, of: 9 }],
  ['Meter, 40 people (scaled to 24 pills)', { variant: 'meter', done: 25, of: 40 }],
  ['Pages, page 3 of 5', { variant: 'pages', done: 2, of: 5 }],
  ['Pages, back on page 2 after reading 4', { variant: 'pages', done: 1, of: 5, seen: 4 }],
  ['Track, response 6 of 8', { variant: 'track', done: 5, of: 8 }],
  ['Track, response 30 of 60 (a bar)', { variant: 'track', done: 29, of: 60 }],
];

export default function PipsFixture() {
  return (
    <div className="sg-sheet" data-theme="dark" style={LAPTOP}>
      <p className="sg-eyebrow">Dusk</p>
      {ROWS.map(([title, props]) => (
        <div key={title} className="sg-body">
          <p className="sg-note">{title}</p>
          <Pips {...props} label={title} />
        </div>
      ))}
    </div>
  );
}
