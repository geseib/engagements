/**
 * THE WALL NEVER SCROLLS (two-surface NOTES §4 rule 1, PLAN 2.5).
 *
 * The owner rejected the single-screen prototype because content scrolled on
 * the projected screen. This pins the stylesheet so it cannot come back: the
 * root and the canvas hide overflow, nothing inside `.present` may scroll or
 * stick, no viewport unit reaches inside the scaled canvas (it would measure
 * the window, not the 1920x1080 page), the html lock hides overflow on html
 * and body, and all four profiles carry the whole ladder.
 */
const fs = require('fs');
const path = require('path');

const CSS = fs.readFileSync(path.join(__dirname, '..', 'present', 'present.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

/** Every `selector { body }` rule, flat (no nested @media handling needed beyond stripping the wrapper). */
function rules(css) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) out.push({ selector: m[1].trim(), body: m[2] });
  return out;
}
const ALL = rules(CSS);
const bodyOf = (selector) => {
  const hit = ALL.filter((r) => r.selector.split(',').map((s) => s.trim()).includes(selector));
  if (!hit.length) throw new Error(`no rule for ${selector}`);
  return hit.map((r) => r.body).join(';');
};

describe('present.css never scrolls', () => {
  it('the root and the canvas hide overflow', () => {
    expect(bodyOf('.present')).toMatch(/overflow:\s*hidden/);
    expect(bodyOf('.present .present-canvas')).toMatch(/overflow:\s*hidden/);
    expect(bodyOf('.present .present-main')).toMatch(/overflow:\s*hidden/);
  });
  it('the canvas is exactly 1920x1080 and scaled by --present-scale', () => {
    const body = bodyOf('.present .present-canvas');
    expect(body).toMatch(/width:\s*1920px/);
    expect(body).toMatch(/height:\s*1080px/);
    expect(body).toMatch(/scale\(var\(--present-scale/);
  });
  it('nothing may scroll or stick', () => {
    expect(CSS).not.toMatch(/overflow(-[xy])?:\s*(auto|scroll)/);
    expect(CSS).not.toMatch(/position:\s*sticky/);
  });
  it('no viewport units inside the canvas', () => {
    expect(CSS).not.toMatch(/\d(vh|vw|dvh|svh|lvh|vmin|vmax)\b/);
  });
  it('the html lock hides overflow on html and body', () => {
    expect(bodyOf('html.present-locked')).toMatch(/overflow:\s*hidden/);
    expect(bodyOf('html.present-locked body')).toMatch(/overflow:\s*hidden/);
  });
  it('every profile carries the whole ladder', () => {
    const LADDER = ['--L-hero', '--L-primary', '--L-secondary', '--L-body', '--L-meta', '--fit-min', '--floor'];
    for (const profile of ['room', 'tv', 'call', 'table']) {
      const body = bodyOf(`.present[data-profile="${profile}"] .present-canvas`);
      for (const name of LADDER) expect(`${profile} ${body}`).toMatch(new RegExp(`${name}\\s*:`));
    }
  });
  it("Room's secondary, the smallest response text, is at least 40px (Q5)", () => {
    const m = bodyOf('.present[data-profile="room"] .present-canvas').match(/--L-secondary:\s*(\d+)px/);
    expect(Number(m[1])).toBeGreaterThanOrEqual(40);
  });
  it('the ladders are stage.css resolved at 1080px', () => {
    const at1080 = (vh, lo, hi) => Math.round(Math.min(hi, Math.max(lo, vh * 10.8)));
    const room = bodyOf('.present[data-profile="room"] .present-canvas');
    expect(room).toMatch(new RegExp(`--L-hero:\\s*${at1080(8.4, 56, 104)}px`));
    expect(room).toMatch(new RegExp(`--L-primary:\\s*${at1080(5.6, 40, 68)}px`));
    const tv = bodyOf('.present[data-profile="tv"] .present-canvas');
    expect(tv).toMatch(new RegExp(`--L-primary:\\s*${at1080(7.4, 52, 88)}px`));
    expect(tv).toMatch(new RegExp(`--L-meta:\\s*${at1080(2.4, 26, 31)}px`));
    const table = bodyOf('.present[data-profile="table"] .present-canvas');
    expect(table).toMatch(new RegExp(`--L-hero:\\s*${at1080(6.2, 44, 64)}px`));
  });
});
