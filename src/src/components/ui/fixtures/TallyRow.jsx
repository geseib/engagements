import React from 'react';
import TallyRow from '../TallyRow';

/**
 * Gallery fixture for TallyRow (unit L10): a results list with points, bars
 * (one at the 3% floor), a long first-words line, and rows without points, on
 * dusk (the only theme a tally renders in). Sample data only; the coordinator
 * mounts it in components/SkinGallery.jsx as #gallery-ui-tally-row.
 */
const ROWS = [
  { rank: 1, label: 'Shorter meetings', sub: 'One decision written down at the end of each, and nobody leaves without it.', share: 0.42, points: 18 },
  { rank: 2, label: 'Ask the people who use it', sub: 'We could start by asking the people who use it every day.', share: 0.31, points: 13 },
  { rank: 3, label: 'A shared notebook', sub: 'Everything in one place.', share: 0.01, points: 1 },
  { rank: 4, label: 'Fewer tools', sub: 'Pick two and stop.', share: null, points: null },
];

export default function TallyRowFixture() {
  return (
    <div className="sg-sheet" data-theme="dark">
      <p className="sg-eyebrow">Dusk</p>
      <ol className="sg-rows" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {ROWS.map((r) => <TallyRow key={r.rank} as="li" size={24} {...r} />)}
      </ol>
    </div>
  );
}
