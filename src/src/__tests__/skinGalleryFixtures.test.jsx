/**
 * Every gallery fixture renders (Phase 1: the 13 shared components are
 * mounted in /skins so shoot.js can shoot them in both skins), and every
 * Phase 1 unit's gallery route has a fixture with that id.
 */
import React from 'react';
import { render, cleanup } from '@testing-library/react';
import { FIXTURES } from '../components/SkinGallery';

const units = require('../../../docs/design/themes/units.json');

afterEach(cleanup);

test.each(FIXTURES.map((f) => [f.id, f]))('%s renders', (_id, f) => {
  const { container } = render(<div>{f.render()}</div>);
  expect(container.textContent.length).toBeGreaterThan(0);
});

test('every Phase 1 unit\'s gallery route has a fixture', () => {
  const list = units.units || units;
  const ids = new Set(FIXTURES.map((f) => f.id));
  const wanted = list.filter((u) => /^L\d+$/.test(u.id))
    .flatMap((u) => (u.routes || []).filter((r) => r.startsWith('gallery:')).map((r) => r.slice(8)));
  expect(wanted.length).toBe(13);
  expect(wanted.filter((id) => !ids.has(id))).toEqual([]);
});
