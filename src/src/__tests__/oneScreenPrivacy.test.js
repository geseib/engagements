/**
 * ONE-SCREEN PRIVACY (docs/design/experience-plan/PLAN.md §5.3, principle 3; audit B §2.3).
 *
 * Fails when any part on the private list renders with "the room sees this laptop" on
 * and no reveal. Phase 0 holds the list (config/privateParts.js): it starts as audit B's
 * eight hazards, every entry complete. The render check lands with Phase 1e (and 1b for
 * the bell), named in the test.todo entries below.
 *
 * Fix a failure by completing the entry in config/privateParts.js. A part is never taken
 * off the list to make the guard pass: when it moves to the phone, its render check
 * proves it.
 */
import fs from 'fs';
import path from 'path';
import { PRIVATE_PARTS, PRIVACY_TAGS } from '../config/privateParts';

const SRC = path.join(__dirname, '..');
const filled = (s) => typeof s === 'string' && s.trim().length > 0;

describe('the private list is complete', () => {
  test('it starts as audit B §2.3\'s eight hazards, each once', () => {
    const ranks = PRIVATE_PARTS.map((p) => p.hazard).filter((h) => h !== null).sort((a, b) => a - b);
    expect(ranks).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  test('ids are unique, kebab-case', () => {
    const ids = PRIVATE_PARTS.map((p) => p.id);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
    for (const id of ids) expect(id).toMatch(/^[a-z]+(-[a-z]+)*$/);
  });

  test.each(PRIVATE_PARTS.map((p) => [p.id, p]))('%s', (id, p) => {
    const problems = [];
    if (!filled(p.what)) problems.push('what is empty: say in plain words what could escape');
    if (!PRIVACY_TAGS.includes(p.tag)) problems.push(`tag "${p.tag}" is not one of ${PRIVACY_TAGS.join(', ')} (PLAN principle 3; a public part does not belong on this list)`);
    if (!/^[0-9][a-h]$/.test(p.step || '')) problems.push(`step "${p.step}" is not a plan step like 1e (PLAN §6)`);
    if (!Array.isArray(p.where) || !p.where.length) problems.push('where is empty: name the component(s) that draw it, relative to src/src');
    else for (const w of p.where) if (!fs.existsSync(path.join(SRC, w))) problems.push(`where names ${w}, which does not exist under src/src: point it at the file that draws the part now`);
    if (problems.length) throw new Error(`config/privateParts.js "${id}":\n  ${problems.join('\n  ')}`);
  });
});

describe('no private part renders unrevealed on one screen (Phase 1)', () => {
  test.todo('1e: render every host part with "the room sees this laptop" on; no part tagged private on config/privateParts.js appears without its Show on this screen press');
  test.todo('1e: a part tagged count-only renders as a number, with no name or text');
  test.todo('1e: the Session menu on one screen hides the read-check, late text, Workie settings, the remote QR and upcoming titles');
  test.todo('1b: on one screen the bell shows a count and never a name; its sheet starts with "The room can see this screen"');
  test.todo('1b: the Needs-you line on one screen shows a count by kind and Open, never a name and never Let them / Not now');
});
