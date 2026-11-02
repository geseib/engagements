/**
 * NEEDS YOU'S STYLESHEET, AS TEXT (components/needs/NeedsYou.css), and the help
 * that describes it.
 *
 * jsdom loads no stylesheet, so the contract is read from the file: scoped,
 * token-only, on the ladder, a line of ONE height (calm and amber alike, owner
 * review O1: nothing below it moves), and a sheet scrim that scrolls.
 *
 * // rejects: the help line that told hosts "SESSION on the dock shows a count"
 * //          when someone asks for a name (config/help/host-running.js:192,
 * //          :628), true only in a Build Room (audit A §2.3).
 */
const fs = require('fs');
const path = require('path');
const { HELP_ROLES } = require('../config/help');
const L = require('../testing/helpLint');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const css = read('components', 'needs', 'NeedsYou.css').replace(/\/\*[\s\S]*?\*\//g, '');
const block = (sel) => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp(`(?:^|})\\s*${esc}\\s*\\{([^}]*)\\}`));
  return m ? m[1] : '';
};

test('every selector is rooted at .ny', () => {
  const selectors = css.match(/[^{}]+(?=\{)/g) || [];
  selectors.flatMap((s) => s.split(',')).map((s) => s.trim()).filter(Boolean)
    .forEach((s) => expect([s, s.startsWith('.ny')]).toEqual([s, true]));
});

test('no colour literal, no --primary, never text in --danger', () => {
  expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d/);
  expect(css).not.toMatch(/var\(--primary/);
  expect(css).not.toMatch(/(^|[^-])color:\s*var\(--danger\)/);
});

test('nothing under the 12px floor, on the laptop ladder', () => {
  const px = [...css.matchAll(/--ny-t-[a-z]+:\s*(\d+)px/g)].map((m) => Number(m[1]));
  expect(px.sort((a, b) => a - b)).toEqual([12, 13, 15, 19]);
  [...css.matchAll(/font-size:\s*(\d+)px/g)].forEach((m) => expect(Number(m[1])).toBeGreaterThanOrEqual(12));
});

test('the line has one fixed height whatever it says', () => {
  expect(block('.ny.ny-line')).toMatch(/height:\s*var\(--ny-line-h\)/);
  expect(css).toMatch(/--ny-line-h:\s*56px/);
  // The amber state changes colour and edge only, never the box.
  expect(block('.ny.ny-line.is-now')).not.toMatch(/height|padding|margin/);
});

test('the sheet scrim scrolls and its card does not centre with flex', () => {
  expect(block('.ny.ny-scrim')).toMatch(/align-items:\s*flex-start/);
  expect(block('.ny.ny-scrim')).toMatch(/overflow-y:\s*auto/);
  expect(block('.ny .ny-sheet')).toMatch(/margin:\s*auto/);
});

describe('help truth', () => {
  const corpus = HELP_ROLES.flatMap((r) => r.guides).map((g) => L.userText(g)).join('\n');

  test('no guide promises a count on SESSION for a name request', () => {
    expect(corpus).not.toMatch(/SESSION\*\*[^.]*(shows a count|shows a number)/);
    expect(corpus).not.toMatch(/SESSION[^.]*on the dock shows a count/);
  });

  // The dock's door is a bell and a count since 2 Nov 2026 (the word NEEDS YOU
  // pushed the dock to two lines), so the help names the bell, not the word.
  test('the help names the door that exists: the bell, the line, Not now for every type', () => {
    expect(corpus).toMatch(/a bell with a number counts what waits on you \(\*\*Needs you\*\*\)/);
    expect(corpus).not.toMatch(/\*\*NEEDS YOU\*\*/);
    expect(read('components', 'needs', 'OneScreenNeedsBell.jsx')).toMatch(/name="Bell"/);
    expect(corpus).not.toMatch(/in a Build Room, press \*\*Not now\*\*/);
    expect(corpus).toMatch(/Needs-you line/i);
  });
});
