/* eslint-env node */
/**
 * classicGlobalCss — a MIGRATION BRIDGE for palette tests written before the site skins.
 *
 *   const GLOBAL_CSS = require('../testing/classicGlobalCss')();
 *
 * Until Phase 0a, styles.css opened with the whole token layer as hex:
 *   :root { --bg: #0F1A2E; … }  [data-theme="light"] { … }  [data-theme="dark"] { … }
 * and ~55 tests read those blocks as text, each with its own little parser, or collect
 * "every custom property styles.css declares". Phase 0a moved the layer into
 * styles/skins/*.css (values) and styles/roles.css (roles), so those reads found nothing.
 *
 * This returns the text such a test expects: the three blocks it used to find, written
 * with the values they resolve to TODAY IN CLASSIC (through skinHarness — real files, not
 * retyped numbers), followed by styles/roles.css and styles.css as they are. So an
 * assertion keeps measuring Classic's real values, and a "declared somewhere" check sees
 * every role. It cannot speak for Present; a test that must is moved onto skinHarness
 * (H.role / H.CASES) by the unit that owns it, which then drops this require.
 *
 * Delete this file when nothing requires it (Phase 8 at the latest).
 */
const fs = require('fs');
const path = require('path');
const H = require('./skinHarness');

const SRC = path.join(__dirname, '..');

/* The names and order styles.css carried at 1174563f. */
const ROOT = ['--bg', '--surface', '--surface-2', '--text', '--muted',
  '--primary', '--primary-deep', '--secondary', '--success', '--danger', '--danger-text', '--danger-deep',
  '--gold', '--silver', '--bronze', '--ridge-front', '--radius', '--radius-sm', '--hairline', '--space',
  '--font-display', '--font-ui'];
const THEMED = ['--bg', '--surface', '--surface-2', '--text', '--muted'];

function block(selector, names, theme) {
  const lines = names.map((n) => `  ${n}: ${H.role(n, { skin: 'classic', theme })};`);
  return `${selector} {\n${lines.join('\n')}\n}\n`;
}

let CACHE = null;
module.exports = function classicGlobalCss() {
  if (CACHE) return CACHE;
  CACHE = [
    '/* classicGlobalCss: the pre-0a token blocks, resolved in Classic (testing/classicGlobalCss.js) */',
    block(':root', ROOT, 'dark'),
    block('[data-theme="light"]', THEMED, 'light'),
    block('[data-theme="dark"]', THEMED, 'dark'),
    fs.readFileSync(path.join(SRC, 'styles', 'roles.css'), 'utf8'),
    fs.readFileSync(path.join(SRC, 'styles.css'), 'utf8'),
  ].join('\n');
  return CACHE;
};
