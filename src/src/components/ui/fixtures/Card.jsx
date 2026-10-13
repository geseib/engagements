import React from 'react';
import Card from '../Card';

/**
 * Gallery fixture for Card (unit L5): plain, selected, badged, and badged and
 * selected, on dusk and on paper. Sample data only; the coordinator mounts it
 * in components/SkinGallery.jsx as #gallery-ui-card.
 */
function Sheet({ theme }) {
  return (
    <div className="sg-sheet" data-theme={theme}>
      <p className="sg-eyebrow">{theme === 'dark' ? 'Dusk' : 'Paper'}</p>
      <div className="sg-rows">
        <Card>A plain card: the surface, a rule border and the large radius.</Card>
        <Card selected>The selected card: the accent border and the skin&apos;s select mark.</Card>
        <Card badge={6} head={<b>Priya Raman</b>}>
          We could start by asking the people who use it every day.
        </Card>
        <Card selected badge={7} head={<><b>Response 7</b><br />name hidden</>}>
          Shorter meetings, and one decision written down at the end of each.
        </Card>
      </div>
    </div>
  );
}

export default function CardFixture() {
  return (
    <div className="sg-pair">
      <Sheet theme="dark" />
      <Sheet theme="light" />
    </div>
  );
}
