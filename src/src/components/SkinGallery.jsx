import React from 'react';
import { SKINS } from '../config/skins';
import { useSkin } from './SkinProvider';
import './SkinGallery.css';

/**
 * THE SKIN GALLERY — /skins (docs/design/themes/TOOLING-BRIEF §5.3,
 * approved by the owner 2026-10-13). DEV ONLY AND STAFF ONLY: App.jsx mounts
 * it only when window.ENV is 'development', behind ProtectedRoute requireAdmin,
 * as its own lazy chunk, so no other tier and no other visitor ever loads it.
 *
 * Why it exists: the signed-in surfaces cannot be screenshotted by
 * scripts/skins/shoot.js without a session. Here they render from sample data,
 * each mount in an element with a fixed id, `#gallery-<id>`, so a `gallery:<id>`
 * route in docs/design/themes/units.json can be shot in each skin. The skin is
 * the page's own (<html data-skin>, set by the boot script and SkinProvider);
 * shoot.js shoots the page once per skin.
 *
 * ADDING A FIXTURE (each wave unit adds its surface's): one entry in FIXTURES
 * below — an id, a title, and a render() that mounts the real component with
 * props only. No fetch, no auth, no socket: a component that needs them gets a
 * mocked prop or is extracted first (references/testing-a-surface.md §4).
 *
 * Today's fixtures are the roles themselves and the stage chips, so the switch
 * can be seen working before any surface is migrated.
 */

const ROLE_SWATCHES = [
  ['--bg', 'sg-sw--bg'],
  ['--surface', 'sg-sw--surface'],
  ['--surface-2', 'sg-sw--surface-2'],
  ['--text', 'sg-sw--text'],
  ['--muted', 'sg-sw--muted'],
  ['--accent', 'sg-sw--accent'],
  ['--action', 'sg-sw--action'],
  ['--info', 'sg-sw--info'],
  ['--success', 'sg-sw--success'],
  ['--danger', 'sg-sw--danger'],
];

function RoleSheet({ theme }) {
  return (
    <div className="sg-sheet" data-theme={theme}>
      <p className="sg-eyebrow">{theme === 'dark' ? 'Dusk' : 'Paper'}</p>
      <h3 className="sg-title">Thirty-one people answered</h3>
      <p className="sg-body">
        Body copy in <span className="sg-accent-text">accent text</span>, a
        {' '}
        <span className="sg-info-text">link in info</span>
        , and muted notes beside it.
      </p>
      <ul className="sg-swatches" aria-label={`${theme} roles`}>
        {ROLE_SWATCHES.map(([role, cls]) => (
          <li key={role}><span className={`sg-sw ${cls}`} aria-hidden="true" /><code>{role}</code></li>
        ))}
      </ul>
      <div className="sg-rows">
        <div className="sg-row">An ordinary row</div>
        <div className="sg-row is-selected">The selected row</div>
      </div>
    </div>
  );
}

export const FIXTURES = [
  {
    id: 'roles',
    title: 'Roles, dusk and paper',
    render: () => (
      <div className="sg-pair">
        <RoleSheet theme="dark" />
        <RoleSheet theme="light" />
      </div>
    ),
  },
  {
    id: 'stage-chips',
    title: 'Stage phase chips and kicker (styles/stage.css)',
    render: () => (
      <div className="sg-sheet" data-theme="dark">
        <p className="kicker">Round 3 of 5</p>
        <div className="sg-chips">
          <span className="chip lobby"><span className="dot" />Lobby</span>
          <span className="chip ask"><span className="dot" />Ask</span>
          <span className="chip vote"><span className="dot" />Vote</span>
          <span className="chip results"><span className="dot" />Results</span>
        </div>
      </div>
    ),
  },
];

export default function SkinGallery() {
  const { skin } = useSkin();
  const name = (SKINS.find((s) => s.id === skin) || SKINS[0]).name;
  return (
    <main className="sg" data-theme="dark">
      <header className="sg-head">
        <h1 className="sg-h1">Skin gallery</h1>
        <p className="sg-note">{`Wearing ${name}. Dev only, Engage staff only. Each fixture has the id #gallery-<id>.`}</p>
      </header>
      {FIXTURES.map((f) => (
        <section key={f.id} id={`gallery-${f.id}`} className="sg-fixture" aria-labelledby={`gallery-${f.id}-title`}>
          <h2 id={`gallery-${f.id}-title`} className="sg-h2">{f.title}</h2>
          {f.render()}
        </section>
      ))}
    </main>
  );
}
