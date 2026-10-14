import React from 'react';
import Notice, { NOTICE_TONES } from '../Notice';

/**
 * Gallery fixture for Notice (unit L12): every tone, with and without an icon, on
 * dusk, on a dusk panel's second surface, and on paper. Sample data only. The
 * coordinator mounts it in SkinGallery's FIXTURES.
 */
const COPY = {
  ok: ['CheckCircle', 'Saved. The set is live for your team.'],
  warn: ['Warning', 'Three questions have no answer detail yet.'],
  danger: ['XCircle', 'Upload failed: the file has no rows.'],
  note: ['Info', 'Reading the file…'],
};

function Sheet({ theme, icons }) {
  return (
    <div className="sg-sheet" data-theme={theme}>
      <p className="sg-eyebrow">{`${theme === 'dark' ? 'Dusk' : 'Paper'}${icons ? ', with icons' : ''}`}</p>
      <div style={{ display: 'grid', gap: 10 }}>
        {NOTICE_TONES.map((t) => (
          <Notice key={t} tone={t} icon={icons ? COPY[t][0] : undefined}>{COPY[t][1]}</Notice>
        ))}
      </div>
    </div>
  );
}

export default function NoticeFixture() {
  return (
    <div className="sg-pair">
      <Sheet theme="dark" icons />
      <Sheet theme="light" icons />
      <Sheet theme="dark" />
      <Sheet theme="light" />
    </div>
  );
}
