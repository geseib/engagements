import React from 'react';
import Chip, { CHIP_TONES } from '../Chip';

/**
 * Gallery fixture for Chip (unit L8): every tone, plain and in the stage treatment
 * (dot + caps), on dusk and paper. Sample data only. The coordinator mounts it in
 * SkinGallery's FIXTURES.
 */
const WORD = {
  ask: 'Ask', vote: 'Vote', results: 'Results', ok: 'Published', warn: 'Needs review', danger: 'Flagged', muted: 'Draft',
};

function Sheet({ theme }) {
  return (
    <div className="sg-sheet" data-theme={theme}>
      <p className="sg-eyebrow">{theme === 'dark' ? 'Dusk' : 'Paper'}</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
        {CHIP_TONES.map((t) => <Chip key={t} tone={t}>{WORD[t]}</Chip>)}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {CHIP_TONES.map((t) => <Chip key={t} tone={t} dot caps>{WORD[t]}</Chip>)}
      </div>
    </div>
  );
}

export default function ChipFixture() {
  return (
    <div className="sg-pair">
      <Sheet theme="dark" />
      <Sheet theme="light" />
    </div>
  );
}
