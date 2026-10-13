import React from 'react';
import Button, { BUTTON_VARIANTS } from '../Button';

/**
 * Gallery fixture for Button (unit L3): every variant at every size, resting and
 * disabled, as a link, on dusk and paper, and on the wall (where Present's action
 * turns blue). Sample data only. The coordinator mounts it in SkinGallery's FIXTURES.
 */
const LABEL = { action: 'Start the round', accent: 'Show results', quiet: 'Skip', danger: 'Delete the set' };

function Sheet({ theme, surface }) {
  return (
    <div className="sg-sheet" data-theme={theme} data-surface={surface}>
      <p className="sg-eyebrow">{surface === 'wall' ? 'The wall' : theme === 'dark' ? 'Dusk' : 'Paper'}</p>
      {['sm', 'md', 'lg'].map((size) => (
        <div key={size} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
          {BUTTON_VARIANTS.map((v) => (
            <Button key={v} variant={v} size={size}>{LABEL[v]}</Button>
          ))}
        </div>
      ))}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <Button variant="action" disabled>Disabled action</Button>
        <Button variant="quiet" disabled>Disabled quiet</Button>
        <Button as="a" href="#gallery-ui-button" variant="quiet">A link as a button</Button>
      </div>
    </div>
  );
}

export default function ButtonFixture() {
  return (
    <div className="sg-pair">
      <Sheet theme="dark" />
      <Sheet theme="light" />
      <Sheet theme="dark" surface="wall" />
    </div>
  );
}
