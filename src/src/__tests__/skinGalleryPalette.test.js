/**
 * THE SKIN GALLERY'S CSS CONTRACT (components/SkinGallery.css). A dev-only
 * page, but it exists to show what the skin values do, so it may paint
 * nothing of its own: no literal, no font name, no --primary/--secondary, no
 * --sk-*, and every role it reads resolves in every skin. Named
 * *Palette.test.js, never *token* (.gitignore:35).
 */
const fs = require('fs');
const path = require('path');
const H = require('../testing/skinHarness');

const CSS = fs.readFileSync(path.join(__dirname, '..', 'components', 'SkinGallery.css'), 'utf8');
const body = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

test('allowance zero, and nothing to allow', () => {
  expect(CSS).toMatch(/^\/\* skin-allowance: colour=0 font=0 primary=0 \*\//);
  expect(body.match(/#[0-9a-f]{3,8}\b/gi)).toBeNull();
  expect(body.match(/\brgba?\((?!var\()/g)).toBeNull();
  expect(body).not.toMatch(/var\(--(primary|secondary)|--sk-|font-family\s*:(?!\s*var\()/);
});

test('every selector is rooted at .sg', () => {
  const heads = body.split('}').map((b) => b.split('{')[0].trim()).filter((h) => h && !h.startsWith('@'));
  expect(heads.flatMap((h) => h.split(',')).map((s) => s.trim()).filter((s) => !/^\.sg(\s|$)/.test(s))).toEqual([]);
});

describe.each(H.CASES)('%s / %s', (skin, theme) => {
  test('every role the gallery reads resolves', () => {
    const used = [...new Set([...body.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]))];
    const missing = used.filter((n) => { try { H.role(n, { skin, theme }); return false; } catch (_) { return true; } });
    expect(missing).toEqual([]);
  });
  test('its copy is readable on the sheet', () => {
    const sheet = [H.role('--bg', { skin, theme }), H.role('--surface', { skin, theme })];
    for (const fg of ['--text', '--muted', '--accent-text']) {
      expect(H.on(H.role(fg, { skin, theme }), sheet)).toBeGreaterThanOrEqual(H.AA);
    }
  });
});
