/* fixture for retarget-tests.js --selftest */
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const GLOBAL_CSS = read('styles.css');
const MY_CSS = read('mine.css');
const ROOT = ':root {';
const MINE = '.mine {';

function token(css, block, name) {
  const start = css.indexOf(block);
  const body = css.slice(start, css.indexOf('}', start));
  const m = body.match(new RegExp(`${name}\\s*:\\s*(#[0-9A-Fa-f]{6})`));
  return m[1];
}

const T = {
  bg: token(GLOBAL_CSS, '[data-theme="dark"]', '--bg'),
  paper: token(GLOBAL_CSS, '[data-theme="light"] {', '--bg'),
  primary: token(GLOBAL_CSS, ROOT, '--primary'),
  hairline: token(GLOBAL_CSS, ROOT, '--hairline'),
  ink: token(MY_CSS, MINE, '--mine-ink'),
};
