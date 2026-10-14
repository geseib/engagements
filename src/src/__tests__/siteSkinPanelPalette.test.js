/**
 * THE SITE LOOK PANEL'S CSS CONTRACT (components/SiteSkinPanel.css).
 *
 * The panel was born on roles (docs/design/themes/SPEC.md §3), so every
 * colour it paints comes from the skin values through styles/roles.css, and
 * this test reads them through the harness rather than retyping them: change
 * a skin value and these numbers move.
 *
 * DUSK ONLY, IN EVERY SKIN. The panel's root declares data-theme="dark" and
 * AdminPage gives Engage settings contentTheme 'dark', so paper never applies
 * to it; the theme pin below fails the day that changes, and then this file
 * must add the paper cases.
 *
 * Named *Palette.test.js, never *token*: .gitignore:35 is an unanchored
 * `*token*`. What green means: every pairing the sheet paints clears AA,
 * composited from its real stack, in every skin that has a values file. It
 * cannot prove the panel renders — siteSkinPanel.test.jsx drives that.
 */
const fs = require('fs');
const path = require('path');
const H = require('../testing/skinHarness');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const CSS = read('components', 'SiteSkinPanel.css');
const JSX = read('components', 'SiteSkinPanel.jsx');
const stripped = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

const DUSK = H.CASES.filter(([, theme]) => theme === 'dark').map(([skin]) => skin);

test('every skin with a values file is checked (Classic and Present today)', () => {
  expect(DUSK).toEqual(expect.arrayContaining(['classic']));
  expect(DUSK.length).toBe(H.SKINS.filter((s) => s === 'classic' || fs.existsSync(path.join(__dirname, '..', 'styles', 'skins', `${s}.css`))).length);
});

describe.each(DUSK)('%s skin, dusk', (skin) => {
  const o = { skin, theme: 'dark' };
  const R = (name) => H.role(name, o);
  const tint = (name) => H.scopeVar(CSS, '.sks {', name, o);
  const PANEL = () => [R('--bg'), R('--surface')];

  test.each([
    ['the heading, names and values on the panel', '--text'],
    ['descriptions, the label and the foot', '--muted'],
  ])('%s clear AA on --surface', (_l, fg) => {
    expect(H.on(R(fg), PANEL())).toBeGreaterThanOrEqual(H.AA);
  });

  test('the loading line on the work field', () => {
    expect(H.on(R('--muted'), [R('--bg')])).toBeGreaterThanOrEqual(H.AA);
  });

  test('the chosen row: name, description and "In use" on --row-selected over the panel', () => {
    const stack = [...PANEL(), R('--row-selected')];
    expect(H.on(R('--text'), stack)).toBeGreaterThanOrEqual(H.AA);
    expect(H.on(R('--muted'), stack)).toBeGreaterThanOrEqual(H.AA);
    expect(H.on(R('--accent-text'), stack)).toBeGreaterThanOrEqual(H.AA);
  });

  test('a hovered row, and "In use" on the row the site wears while another is chosen', () => {
    const stack = [...PANEL(), R('--row-hover')];
    expect(H.on(R('--text'), stack)).toBeGreaterThanOrEqual(H.AA);
    expect(H.on(R('--muted'), stack)).toBeGreaterThanOrEqual(H.AA);
    expect(H.on(R('--accent-text'), PANEL())).toBeGreaterThanOrEqual(H.AA);
  });

  test('the reason field: text and placeholder on --bg inside the panel', () => {
    const stack = [...PANEL(), R('--bg')];
    expect(H.on(R('--text'), stack)).toBeGreaterThanOrEqual(H.AA);
    expect(H.on(R('--muted'), stack)).toBeGreaterThanOrEqual(H.AA);
  });

  test('the buttons: --text on --surface-2, and the quiet one on the panel', () => {
    expect(H.on(R('--text'), [...PANEL(), R('--surface-2')])).toBeGreaterThanOrEqual(H.AA);
    expect(H.on(R('--info'), PANEL())).toBeGreaterThanOrEqual(H.AA);
  });

  test('the notes: preview (info tint), saved (success tint), refused (danger tint on the field)', () => {
    expect(H.on(R('--text'), [...PANEL(), tint('--sks-tint-info')])).toBeGreaterThanOrEqual(H.AA);
    expect(H.on(R('--info'), [...PANEL(), tint('--sks-tint-info')])).toBeGreaterThanOrEqual(H.AA);
    expect(H.on(R('--success-text'), [...PANEL(), tint('--sks-tint-success')])).toBeGreaterThanOrEqual(H.AA);
    expect(H.on(R('--danger-text'), [R('--bg'), tint('--sks-tint-danger')])).toBeGreaterThanOrEqual(H.AA);
  });
});

describe('the sheet reads roles only', () => {
  test('its allowance is zero on all three counts', () => {
    expect(CSS).toMatch(/^\/\* skin-allowance: colour=0 font=0 primary=0 \*\//);
  });

  test('no literal colour, no font name, no --primary/--secondary, no --sk-*', () => {
    const body = stripped(CSS);
    expect(body.match(/#[0-9a-f]{3,8}\b/gi)).toBeNull();
    expect(body.match(/\brgba?\((?!var\()/g)).toBeNull();
    expect(body).not.toMatch(/var\(--(primary|secondary)/);
    expect(body).not.toMatch(/--sk-/);
    expect(body).not.toMatch(/font-family\s*:/);
  });

  test('--danger never carries text', () => {
    expect(stripped(CSS)).not.toMatch(/(^|[^-])\bcolor\s*:\s*var\(--danger\)/m);
  });

  test('every custom property it reads resolves (roles) or is declared in its scope', () => {
    const local = new Set([...stripped(CSS).matchAll(/(--sks-[\w-]+)\s*:/g)].map((m) => m[1]));
    const used = [...new Set([...stripped(CSS).matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]))];
    const missing = used.filter((n) => !local.has(n) && (() => {
      try { H.role(n, { skin: 'classic', theme: 'dark' }); return false; } catch (_) { return true; }
    })());
    expect(missing).toEqual([]);
  });
});

describe('the scope and the ladder', () => {
  const roots = () => {
    const out = new Set();
    for (const blk of stripped(CSS).split('}')) {
      const head = blk.split('{')[0];
      if (!head || head.includes('@')) continue;
      for (const sel of head.split(',')) {
        const m = sel.trim().match(/^[a-zA-Z]*\.([\w-]+)/);
        if (m) out.add(m[1]);
      }
    }
    return [...out];
  };

  test('every selector is rooted at .sks', () => {
    expect(roots().filter((n) => n !== 'sks')).toEqual([]);
  });

  test('styles.css declares nothing in the .sks scope', () => {
    expect(stripped(read('styles.css')).match(/\.sks[\w-]*/g)).toBeNull();
  });

  test.each([['floor', '12px'], ['label', '13px'], ['body', '15px'], ['head', '19px']])('--sks-t-%s is %s', (step, px) => {
    expect(CSS).toMatch(new RegExp(`--sks-t-${step}:\\s*${px}`));
  });

  test('rows are 36px and nothing is under the 12px floor', () => {
    expect(CSS).toMatch(/--sks-row-h:\s*36px/);
    const px = [...CSS.matchAll(/font-size:\s*(\d+)px/g)].map((m) => Number(m[1]));
    expect(px.filter((n) => n < 12)).toEqual([]);
  });

  test('the panel declares dusk on its root, and Engage settings renders dusk', () => {
    expect(JSX).toMatch(/className="sks" data-theme="dark"/);
    const sections = read('config', 'consoleSections.js');
    const block = sections.slice(sections.indexOf('engagesettings: {'), sections.indexOf('settings: {', sections.indexOf('engagesettings: {') + 20));
    expect(block).toMatch(/contentTheme:\s*'dark'/);
  });
});
