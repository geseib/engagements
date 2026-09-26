/**
 * THE DISPLAY FACE IS A FAMILY GOOGLE ACTUALLY SERVES.
 *
 * Until 2026-09-25 `public/index.html` asked Google Fonts for
 * `family=Archivo+Expanded`. Google has no family by that name: requested
 * alone it answers 400 "Missing font family", and inside the combined request
 * it is dropped without a word — the response carried @font-face rules for
 * Inter only. Every heading, numeral and code that names the display face
 * rendered in the system fallback, on every tier, and nothing failed.
 *
 * Google serves the expanded face as "Archivo" on its width axis. Loaded at
 * `wdth 125` only, "Archivo" in this app IS the expanded face: the width axis
 * is the only one loaded, so font matching picks it for every element, with
 * or without a `font-stretch` of its own. That is also why the last test here
 * pins the request to width 125 — loading a normal-width Archivo beside it
 * would quietly narrow every heading that does not ask for 125%.
 *
 * Checked by hand, 2026-09-25 (repeat it when changing the request):
 *   curl -s -A 'Mozilla/5.0 … Chrome/128' \
 *     'https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@125,700;125,800' \
 *     | grep -E 'font-family|font-stretch'
 *
 * No network here: jest reads the files as text and checks them against that
 * recorded answer.
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..');
const INDEX_HTML = fs.readFileSync(path.join(SRC, '..', 'public', 'index.html'), 'utf8');

// Families this app loads that Google Fonts was seen to serve (see header).
const SERVED_FAMILIES = ['Archivo', 'Inter'];

const googleFontRequests = () =>
  [...INDEX_HTML.matchAll(/href="(https:\/\/fonts\.googleapis\.com\/css2\?[^"]+)"/g)].map(
    (m) => new URL(m[1].replace(/&amp;/g, '&'))
  );

// "Archivo:wdth,wght@125,700;125,800" -> { name, axes, tuples }
const parseFamily = (spec) => {
  const [name, axisPart] = spec.split(':');
  if (!axisPart) return { name, axes: [], tuples: [] };
  const [axes, values] = axisPart.split('@');
  return {
    name,
    axes: axes.split(','),
    tuples: values.split(';').map((t) => t.split(',').map(Number)),
  };
};

const requestedFamilies = () =>
  googleFontRequests().flatMap((url) => url.searchParams.getAll('family').map(parseFamily));

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === '__tests__' ? [] : walk(p);
    return [p];
  });

const firstFamily = (value) => value.split(',')[0].trim().replace(/^["']|["']$/g, '');

const tokenValue = (file, name) => {
  const css = stripComments(fs.readFileSync(path.join(SRC, file), 'utf8'));
  const m = css.match(new RegExp(`${name}\\s*:\\s*([^;]+);`));
  return m && m[1].trim();
};

describe('the Google Fonts request in public/index.html', () => {
  it('exists', () => {
    expect(googleFontRequests().length).toBeGreaterThan(0);
  });

  it('names no family Google does not serve', () => {
    const names = requestedFamilies().map((f) => f.name.replace(/\+/g, ' '));
    expect(names).not.toContain('Archivo Expanded');
    names.forEach((n) => expect(SERVED_FAMILIES).toContain(n));
  });

  it('loads Archivo at the expanded width, in the two weights the display rules use', () => {
    const archivo = requestedFamilies().find((f) => f.name === 'Archivo');
    expect(archivo).toBeDefined();
    expect(archivo.axes).toEqual(['wdth', 'wght']);
    const widths = new Set(archivo.tuples.map(([w]) => w));
    const weights = archivo.tuples.map(([, wt]) => wt).sort((a, b) => a - b);
    expect([...widths]).toEqual([125]);
    expect(weights).toEqual([700, 800]);
  });
});

describe('the stylesheets name the family that is loaded', () => {
  it.each([
    ['styles.css', '--font-display'],
    [path.join('marketing', 'MarketingShell.css'), '--mk-font-display'],
  ])('%s declares %s with Archivo first', (file, name) => {
    const value = tokenValue(file, name);
    expect(value).not.toBeNull();
    expect(firstFamily(value)).toBe('Archivo');
  });

  it('no stylesheet or component under src/src names "Archivo Expanded"', () => {
    const offenders = walk(SRC)
      .filter((f) => /\.(css|jsx?)$/.test(f))
      .filter((f) => {
        const text = fs.readFileSync(f, 'utf8');
        const code = f.endsWith('.css') ? stripComments(text) : text;
        return /Archivo[ +]Expanded/i.test(code);
      })
      .map((f) => path.relative(SRC, f));
    expect(offenders).toEqual([]);
  });
});
