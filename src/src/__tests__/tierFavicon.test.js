/**
 * THE TAB ICON SAYS WHICH TIER YOU ARE ON — public/tier-favicon.js
 *
 * Owner's ask (2026-10-03): dev and test tabs carry a "D" / "T" on the
 * mountain so the tiers can be told apart in a row of tabs; prod stays the
 * plain mountain.
 *
 * All tiers serve one build, so the swap keys off window.ENV from config.js.
 * The words come from the buildspecs, not from this file: if a buildspec ever
 * wrote "dev" instead of "development", the badge would silently vanish — so
 * the script is run against what each buildspec actually writes.
 *
 * // rejects: a dev/test tab left on the plain mountain, a prod tab that is
 * //          badged, an unknown ENV that is badged, a script loaded before
 * //          config.js, and a badge icon that is not the brand mountain.
 */
const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, '..', '..', 'public');
const REPO = path.join(__dirname, '..', '..', '..');
const SCRIPT = fs.readFileSync(path.join(PUBLIC, 'tier-favicon.js'), 'utf8');
const HTML = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');

/** The window.ENV word a buildspec writes into config.js. */
function envWrittenBy(tier) {
  const spec = fs.readFileSync(path.join(REPO, `buildspec-${tier}.yml`), 'utf8');
  return spec.match(/printf 'window\.ENV = "([^"]+)";/)[1];
}

/** Put index.html's icon links in the document, set ENV, run the script; return the hrefs. */
function iconsFor(env) {
  document.head.innerHTML = HTML.match(/<link rel="icon"[^>]*>/g).join('\n');
  if (env === undefined) delete window.ENV; else window.ENV = env;
  // eslint-disable-next-line no-new-func
  new Function(SCRIPT)();
  return [...document.querySelectorAll('link[rel="icon"]')]
    .map((l) => [l.getAttribute('type'), new URL(l.href, 'https://x').pathname]);
}

afterEach(() => { delete window.ENV; });

describe('each tier gets its icon, from what its buildspec writes', () => {
  test('dev shows the D', () => {
    expect(iconsFor(envWrittenBy('dev'))).toEqual([
      ['image/svg+xml', '/favicon-dev.svg'],
      ['image/png', '/favicon-dev-32.png'],
    ]);
  });

  test('test shows the T', () => {
    expect(iconsFor(envWrittenBy('test'))).toEqual([
      ['image/svg+xml', '/favicon-test.svg'],
      ['image/png', '/favicon-test-32.png'],
    ]);
  });

  test('prod keeps the plain mountain', () => {
    expect(iconsFor(envWrittenBy('prod'))).toEqual([
      ['image/svg+xml', '/favicon.svg'],
      ['image/png', '/favicon-32.png'],
    ]);
  });

  test.each([undefined, '', 'dev', 'local', 'production '])('ENV %p changes nothing', (env) => {
    expect(iconsFor(env)).toEqual([
      ['image/svg+xml', '/favicon.svg'],
      ['image/png', '/favicon-32.png'],
    ]);
  });
});

describe('the page and the files', () => {
  test('index.html loads the script after config.js, which sets ENV', () => {
    const config = HTML.indexOf('<script src="/config.js"></script>');
    const tier = HTML.indexOf('<script src="/tier-favicon.js"></script>');
    expect(config).toBeGreaterThan(-1);
    expect(tier).toBeGreaterThan(config);
  });

  test('every icon the script can point at exists', () => {
    for (const f of ['favicon-dev.svg', 'favicon-dev-32.png', 'favicon-test.svg', 'favicon-test-32.png']) {
      expect(fs.existsSync(path.join(PUBLIC, f))).toBe(true);
    }
  });

  test('the badged icons are the brand mountain, in its colours, with nothing executable', () => {
    const mountain = fs.readFileSync(path.join(PUBLIC, 'favicon.svg'), 'utf8').match(/<path d="([^"]+)"/)[1];
    for (const f of ['favicon-dev.svg', 'favicon-test.svg']) {
      const svg = fs.readFileSync(path.join(PUBLIC, f), 'utf8');
      expect(svg).toContain(`d="${mountain}"`);
      expect(svg).toMatch(/#F6A94C/i);
      expect(svg).toMatch(/#0F1A2E/i);
      expect(svg).not.toMatch(/<script|href=|<image|<text/i);
    }
  });
});
