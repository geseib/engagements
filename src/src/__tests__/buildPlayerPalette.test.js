/**
 * THE BUILD ROOM PHONE'S CSS CONTRACT — buildroom/BuildPlayer.css.
 *
 * NAMED `*Palette*`, NEVER `*Token*`. `.gitignore:35` is an unanchored
 * `*token*`, so a file named for tokens is invisible to git: it runs locally,
 * passes, and never reaches CI. Do not rename it.
 *
 * jsdom has no layout engine and loads no stylesheet, so this reads the CSS
 * as TEXT and does arithmetic on it. Green means "the contract has not been
 * reverted", never "this is legible on a phone at arm's length".
 *
 * Every pairing is composited up the real paint stack: dusk --bg, then the
 * card's --surface where there is one, then the sheet's own rgba tint.
 */
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const RAW = read('buildroom', 'BuildPlayer.css');
const CSS = strip(RAW);
const GLOBAL_CSS = read('styles.css');
const PLR_CSS = read('components', 'PlayerSurface.css');
const JSX = read('buildroom', 'BuildPlayer.jsx');
const CREW_JSX = read('buildroom', 'BuildPlayerCrew.jsx');

/* ---- colour ---- */
const lin = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
const ratio = (a, b) => { const x = lum(a); const y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const parseHex = (h) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16));
const parseRgba = (s) => { const m = s.match(/[\d.]+/g).map(Number); return { rgb: m.slice(0, 3), a: m[3] }; };
const over = (top, base) => top.rgb.map((c, i) => c * top.a + base[i] * (1 - top.a));

function token(css, block, name) {
  const start = css.indexOf(block);
  if (start < 0) throw new Error(`no ${block} block`);
  const body = css.slice(start, css.indexOf('}', start));
  const m = body.match(new RegExp(`${name}\\s*:\\s*(#[0-9A-Fa-f]{6}|rgba\\([^)]*\\))`));
  if (!m) throw new Error(`${name} not declared in ${block}`);
  return m[1];
}
const DUSK = '[data-theme="dark"] {';
const ROOT = ':root {';
const T = {
  bg: parseHex(token(GLOBAL_CSS, DUSK, '--bg')),
  surface: parseHex(token(GLOBAL_CSS, DUSK, '--surface')),
  text: parseHex(token(GLOBAL_CSS, DUSK, '--text')),
  primary: parseHex(token(GLOBAL_CSS, ROOT, '--primary')),
  secondary: parseHex(token(GLOBAL_CSS, ROOT, '--secondary')),
  success: parseHex(token(GLOBAL_CSS, ROOT, '--success')),
  muted: parseHex(token(CSS, '.bpl {', '--bpl-muted')),
  successText: parseHex(token(CSS, '.bpl {', '--bpl-success-text')),
};
const tint = (name) => parseRgba(token(CSS, '.bpl {', name));

/** The declaration body for one exact selector; throws if it was renamed. */
function block(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = CSS.match(new RegExp(`(^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm'));
  if (!m) throw new Error(`No rule for "${selector}" — renamed?`);
  return m[2];
}

const AA = 4.5;

describe('every pairing clears AA on what it is really drawn on', () => {
  const amberCard = over(tint('--bpl-amber-tint'), T.surface);
  const amberField = over(tint('--bpl-amber-tint'), T.bg);
  const goodField = over(tint('--bpl-good-tint'), T.bg);
  const blueField = over(tint('--bpl-blue-tint'), T.bg);

  const pairs = [
    ['option title and detail on a card', T.text, T.surface],
    ['option detail, muted, on a card', T.muted, T.surface],
    ['a picked card (amber tint over --surface)', T.text, amberCard],
    ['muted detail on a picked card', T.muted, amberCard],
    ['the preview link, blue on a card', T.secondary, T.surface],
    ['letter A: --bg on --primary', T.bg, T.primary],
    ['letter B: --bg on --secondary', T.bg, T.secondary],
    ['letter C: --bg on --success', T.bg, T.success],
    ['the eyebrow and intro, muted on the field', T.muted, T.bg],
    ['feed kind labels, blue on a timeline card', T.secondary, T.surface],
    ['a decision kind, amber on a timeline card', T.primary, T.surface],
    ['a verbal / idea kind, green on a timeline card', T.successText, T.surface],
    ['the latest decision (amber tint over the field)', T.text, amberField],
    ['its amber label', T.primary, amberField],
    ['"Sent to Claude", green on the decided tint', T.successText, goodField],
    ['the direction text on the decided tint', T.text, goodField],
    ['"Claude Code is connected" on the blue tint', T.text, blueField],
    ['the idea button, blue on the field', T.secondary, T.bg],
    ['the Send idea button, text on the blue tint', T.text, blueField],
    ['result numbers, muted on the field', T.muted, T.bg],
  ];
  // Crew mode (BuildPlayerCrew.jsx): the same tokens and tints, new places.
  const blueCard = over(tint('--bpl-blue-tint'), T.surface);
  pairs.push(
    ['crew: the review card, text on the blue tint over --surface', T.text, blueCard],
    ['crew: needs a rebase / the race / private notice, amber on a card', T.primary, T.surface],
    ['crew: up to date / merged, green on a card', T.successText, T.surface],
    ['crew: the key line and reaction buttons, text on --bg', T.text, T.bg],
    ['crew: a pressed reaction (amber tint over --bg)', T.text, amberField],
    ['crew: the join card lines, muted on a card', T.muted, T.surface],
    ['crew: question kind and "new key" link, blue on a card', T.secondary, T.surface],
    ['crew: the base-moved notice, text on the amber tint', T.text, amberField],
    ['crew: Take this task, text on the blue tint over --surface', T.text, blueCard],
  );

  test.each(pairs)('%s', (_, fg, bg) => {
    expect(ratio(fg, bg)).toBeGreaterThanOrEqual(AA);
  });

  test('the measured pairings are the ones the sheet paints', () => {
    expect(block('.bpl .bpl-letter')).toMatch(/background:\s*var\(--primary\)/);
    expect(block('.bpl .bpl-letter')).toMatch(/color:\s*var\(--bg\)/);
    expect(block('.bpl .bpl-letter.bpl-letter--1')).toMatch(/background:\s*var\(--secondary\)/);
    expect(block('.bpl .bpl-letter.bpl-letter--2')).toMatch(/background:\s*var\(--success\)/);
    expect(block('.bpl .bpl-card.bpl-card--on')).toMatch(/background:\s*var\(--bpl-amber-tint\)/);
    expect(block('.bpl .bpl-decided')).toMatch(/background:\s*var\(--bpl-good-tint\)/);
    expect(block('.bpl .bpl-sent')).toMatch(/color:\s*var\(--bpl-success-text\)/);
    expect(block('.bpl .bpl-latest')).toMatch(/background:\s*var\(--bpl-amber-tint\)/);
    expect(block('.bpl .bpl-send')).toMatch(/background:\s*var\(--bpl-blue-tint\)/);
    expect(block('.bpl .bpl-review')).toMatch(/background:\s*var\(--bpl-blue-tint\)/);
    expect(block('.bpl .bpl-el')).toMatch(/background:\s*var\(--surface\)/);
    expect(block('.bpl .bpl-keyline')).toMatch(/background:\s*var\(--bg\)/);
    expect(block('.bpl .bpl-rxbtn')).toMatch(/background:\s*var\(--bg\)/);
    expect(block('.bpl .bpl-rxbtn[aria-pressed="true"]')).toMatch(/background:\s*var\(--bpl-amber-tint\)/);
    expect(block('.bpl .bpl-base')).toMatch(/background:\s*var\(--bpl-amber-tint\)/);
    expect(block('.bpl .bpl-take')).toMatch(/background:\s*var\(--bpl-blue-tint\)/);
  });

  test('the local greys are the player surface\'s own, not a third grey', () => {
    expect(token(CSS, '.bpl {', '--bpl-muted')).toBe(token(PLR_CSS, '.plr {', '--plr-muted'));
    expect(token(CSS, '.bpl {', '--bpl-success-text')).toBe(token(PLR_CSS, '.plr {', '--plr-success-text'));
  });
});

describe('colour comes from tokens', () => {
  test('no hex outside the .bpl token block', () => {
    const outside = CSS.replace(/^\.bpl \{[^}]*\}/m, '');
    expect(outside.match(/#[0-9A-Fa-f]{3,8}\b/g) || []).toEqual([]);
  });

  test('no red: nothing on this surface is destructive', () => {
    expect(CSS).not.toMatch(/var\(--danger/);
  });

  test('every custom property used is declared here, on .plr, or in styles.css', () => {
    const used = new Set([...CSS.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => m[1]));
    for (const name of used) {
      const re = new RegExp(`${name}\\s*:`);
      expect([name, re.test(CSS) || re.test(PLR_CSS) || re.test(GLOBAL_CSS)]).toEqual([name, true]);
    }
  });
});

describe('the scope is the scope', () => {
  test('every selector is rooted at .bpl', () => {
    const selectors = [...CSS.matchAll(/(^|\})\s*([^@{}][^{}]*)\{/g)].map((m) => m[2].trim());
    expect(selectors.length).toBeGreaterThan(20);
    for (const group of selectors) {
      for (const sel of group.split(',').map((x) => x.trim()).filter(Boolean)) {
        expect([sel, sel.startsWith('.bpl')]).toEqual([sel, true]);
      }
    }
  });

  test('nobody else declares .bpl', () => {
    expect(GLOBAL_CSS).not.toMatch(/\.bpl\b/);
    expect(PLR_CSS).not.toMatch(/\.bpl\b/);
  });

  test('.bpl is always drawn inside PlayerShell (it borrows the .plr ladder)', () => {
    // Every screen goes through the one `shell` helper, which renders PlayerShell.
    expect(JSX).toMatch(/<PlayerShell[\s\S]*?<div className="bpl">\{body\}<\/div>/);
  });
});

describe('type and targets', () => {
  test('no px font sizes: the player ladder (rem, three contexts) sets every size', () => {
    expect(CSS).not.toMatch(/font-size:\s*\d+px/);
    const sizes = [...CSS.matchAll(/font-size:\s*([^;]+);/g)].map((m) => m[1].trim());
    for (const s of sizes) expect(s).toMatch(/^var\(--plr-t-(hero|primary|secondary|body|meta)\)$/);
  });

  test('every input renders at the player\'s input size or larger (no iOS zoom)', () => {
    // The inputs reuse `.plr-inp` (19px on a phone) and this sheet never resizes one.
    expect(JSX).not.toMatch(/<(input|textarea)(?![^>]*plr-inp)[^>]*>/);
    expect(CREW_JSX).not.toMatch(/<(input|textarea)(?![^>]*plr-inp)[^>]*>/);
    expect(CREW_JSX).toMatch(/<textarea[\s\S]*?className="plr-inp/);
    expect(CSS).not.toMatch(/\.bpl-area[^{]*\{[^}]*font-size/);
  });

  test('tap targets are at least 44px', () => {
    expect(block('.bpl .bpl-pick')).toMatch(/min-height:\s*56px/);
    expect(block('.bpl .bpl-vrow')).toMatch(/min-height:\s*56px/);
    expect(block('.bpl .bpl-ideabtn')).toMatch(/min-height:\s*var\(--bpl-tap\)/);
    expect(block('.bpl .bpl-send')).toMatch(/min-height:\s*var\(--bpl-tap\)/);
    expect(block('.bpl .bpl-copy')).toMatch(/min-height:\s*var\(--bpl-tap\)/);
    expect(block('.bpl .bpl-take')).toMatch(/min-height:\s*var\(--bpl-tap\)/);
    expect(block('.bpl .bpl-textbtn')).toMatch(/min-height:\s*var\(--bpl-tap\)/);
    expect(block('.bpl .bpl-rxbtn')).toMatch(/min-height:\s*56px/);
    expect(CSS).toMatch(/--bpl-tap:\s*44px/);
  });

  test('untrusted prose wraps rather than widening the phone', () => {
    expect(block('.bpl .bpl-text')).toMatch(/overflow-wrap:\s*anywhere/);
    expect(block('.bpl .bpl-text')).toMatch(/white-space:\s*pre-wrap/);
  });

  test('the text boxes resize vertically only', () => {
    expect(block('.bpl .bpl-area')).toMatch(/resize:\s*vertical/);
  });
});
