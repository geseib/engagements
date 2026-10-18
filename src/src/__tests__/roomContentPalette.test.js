/**
 * LARGE AND READABLE, AS A CSS CONTRACT (owner, 17 Oct 2026; engage-design
 * skill §5). jsdom loads no stylesheet, so the sizes the room-content roles
 * draw at are read from the sheets as text:
 *
 *   - the LEAD (config/roomContent.js) is the profile's hero or primary step on
 *     the wall (present.css) and on the stage (styles/stage.css), scaled only by
 *     --fit, which the fitters floor at --fit-min;
 *   - at --fit-min the lead is still at or above the profile's floor, and the
 *     larger profile never draws it smaller than the one beneath (TV ≥ Room);
 *   - the stage's steps are max(var(--floor), …), so nothing scaled goes under
 *     the floor;
 *   - a Build Room ask's option titles lead at the secondary step;
 *   - the new rules paint with tokens only.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { PRESENT_LADDERS } from '../present/PresentStage';
import { FLOORS } from '../config/displayProfile';

const read = (...p) => readFileSync(join(__dirname, '..', ...p), 'utf8');
const PRESENT = read('present', 'present.css');
const STAGE = read('styles', 'stage.css');
const BUILD = read('buildroom', 'BuildRoom.css');

/** The declarations of the first rule whose selector list is exactly `sel`. */
function rule(css, sel) {
  const at = css.indexOf(`${sel}{`) >= 0 ? css.indexOf(`${sel}{`) : css.indexOf(`${sel} {`);
  if (at < 0) return null;
  const open = css.indexOf('{', at);
  return css.slice(open + 1, css.indexOf('}', open));
}
const fontSize = (decl) => {
  const m = /font-size:\s*([^;]+);?/.exec(decl || '');
  return m ? m[1].trim() : null;
};

describe('the wall (present.css)', () => {
  it('the lead is the primary step, or hero when short, scaled only by --fit', () => {
    expect(fontSize(rule(PRESENT, '.present .present-rc-lead.is-primary'))).toBe('calc(var(--L-primary) * var(--fit))');
    expect(fontSize(rule(PRESENT, '.present .present-rc-lead.is-hero'))).toBe('calc(var(--L-hero) * var(--fit))');
  });

  it('support is the secondary step and a kicker keeps the eyebrow (meta) step', () => {
    expect(fontSize(rule(PRESENT, '.present .present-rc-support'))).toBe('calc(var(--L-secondary) * var(--fit))');
    expect(rule(PRESENT, '.present .present-rc-title')).toMatch(/--ui-t-primary:\s*calc\(var\(--L-secondary\) \* var\(--fit\)\)/);
  });

  it.each(Object.keys(PRESENT_LADDERS))('%s: at --fit-min the lead is still at or above the floor', (p) => {
    const L = PRESENT_LADDERS[p];
    expect(L.primary * L.fitMin).toBeGreaterThanOrEqual(L.floor);
    expect(L.primary * L.fitMin).toBeGreaterThanOrEqual(L.secondary * 0.55);
    expect(L.floor).toBe(FLOORS[p]);
  });

  it('TV never draws its lead smaller than Room does', () => {
    expect(PRESENT_LADDERS.tv.primary * PRESENT_LADDERS.tv.fitMin).toBeGreaterThanOrEqual(PRESENT_LADDERS.room.primary * PRESENT_LADDERS.room.fitMin);
  });

  it('a question for the room: its options lead at the secondary step, on the wall and the stage', () => {
    expect(fontSize(rule(PRESENT, '.present .present-ask-options li'))).toBe('calc(var(--L-secondary) * var(--fit, 1))');
    const ask = read('components', 'stage', 'AskStage.css');
    expect(fontSize(rule(ask, '.askstage .askstage-options li'))).toBe('var(--t-secondary)');
  });

  it('the new rules carry no colour literal and no pixel font size', () => {
    const start = PRESENT.indexOf('WHAT THE ROOM SEES, AND HOW LARGE');
    const block = PRESENT.slice(start, PRESENT.indexOf('/* the progress meter', start));
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
    expect(block).not.toMatch(/font-size:\s*\d/);
  });
});

describe('the one-screen stage (styles/stage.css)', () => {
  it('the lead reads the profile\'s primary and hero steps', () => {
    expect(fontSize(rule(STAGE, '.q.q-lead.is-primary'))).toBe('var(--t-primary)');
    expect(fontSize(rule(STAGE, '.q.q-lead.is-hero'))).toBe('var(--t-hero)');
    expect(fontSize(rule(STAGE, '.q-sub'))).toBe('var(--t-secondary)');
  });

  it('every scaled step is floored: max(var(--floor), …)', () => {
    ['hero', 'primary', 'secondary', 'body'].forEach((step) => {
      expect(STAGE).toMatch(new RegExp(`--t-${step}:max\\(var\\(--floor\\),calc\\(var\\(--L-${step}\\) \\* var\\(--fit\\)\\)\\)`));
    });
  });

  it('every profile declares its --fit-min, and TV\'s keeps it at Room\'s size or above', () => {
    const fitMin = (cls) => {
      const block = STAGE.slice(STAGE.indexOf(cls));
      return parseFloat(/--fit-min:([.\d]+)/.exec(block)[1]);
    };
    const primaryMin = (cls) => parseFloat(/--L-primary:\s*clamp\((\d+)px/.exec(STAGE.slice(STAGE.indexOf(cls)))[1]);
    ['.d-room{', ':root.d-tv{', ':root.d-call{', ':root.d-table'].forEach((c) => expect(fitMin(c)).toBeGreaterThan(0));
    expect(primaryMin(':root.d-tv{') * fitMin(':root.d-tv{')).toBeGreaterThanOrEqual(primaryMin('.d-room{') * fitMin('.d-room{'));
  });
});

describe('a Build Room ask on the Stage (BuildRoom.css)', () => {
  it('its option titles lead at the secondary step, not the body step', () => {
    expect(fontSize(rule(BUILD, '.brm .stage .brm-stage[data-room-view] .brm-ct'))).toBe('var(--t-secondary)');
  });
  it('its prompt reads the primary step', () => {
    expect(rule(BUILD, '.brm .stage .brm-stage')).toMatch(/--brm-st-q:\s*var\(--t-primary\)/);
  });
});
