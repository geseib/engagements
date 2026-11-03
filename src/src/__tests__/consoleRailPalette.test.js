/**
 * THE CONSOLE RAIL'S STYLESHEET CONTRACT, AS TEXT (docs/design/console-rail
 * README §5, §6; engage-design §5). The rail's headers live in
 * components/console/HostConsole.css, the compact person row in
 * components/people/PersonRow.css, the line's fade in
 * components/needs/NeedsYou.css, Everyone's in in ConsolePulse.css.
 *
 * jsdom loads no stylesheet, so the contract is read from the files: roles
 * only, a reduced-motion rule for every animation and transition, one motion
 * that never repeats, and the measured contrast of every new pairing,
 * composited from the skins' own dusk values. NO GEOMETRIC ASSERTIONS.
 */
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const SHEETS = {
  host: strip(read('components', 'console', 'HostConsole.css')),
  row: strip(read('components', 'people', 'PersonRow.css')),
  needs: strip(read('components', 'needs', 'NeedsYou.css')),
  pulse: strip(read('components', 'console', 'ConsolePulse.css')),
};
const roles = read('styles', 'roles.css');
const rule = (css, sel) => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp(`(?:^|[}\\n])\\s*${esc}\\s*\\{([^}]*)\\}`));
  return m ? m[1] : '';
};

describe('tokens only', () => {
  test.each(Object.keys(SHEETS))('%s: no colour literal, no --primary, never text in --danger', (k) => {
    const css = SHEETS[k];
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d/);
    expect(css).not.toMatch(/var\(--primary/);
    expect(css).not.toMatch(/(^|[^-])color:\s*var\(--danger\)/);
  });
  test('the header paint names roles, never a colour: the lit header is the line\'s own pair', () => {
    const now = rule(SHEETS.host, '.hc-sec summary[data-level="now"]');
    expect(now).toMatch(/border-left-color:\s*var\(--accent\)/);
    expect(now).toMatch(/rgb\(var\(--warn-rgb\) \/ \.08\)/);
    const line = rule(SHEETS.needs, '.ny.ny-line.is-now');
    expect(line).toMatch(/border-left-color:\s*var\(--accent\)/);
    expect(line).toMatch(/rgb\(var\(--warn-rgb\) \/ \.08\)/);
    expect(rule(SHEETS.host, '.hc-sec summary[data-level="now"] .hc-who')).toMatch(/color:\s*var\(--accent-text\)/);
  });
  test('Late (soon) has a dot and no edge or wash: no rule paints data-level="soon"', () => {
    expect(SHEETS.host).not.toMatch(/data-level="soon"\][^{]*\{[^}]*(border|background)/);
    expect(rule(SHEETS.host, '.hc-count .hc-dot')).toMatch(/background:\s*var\(--accent\)/);
  });
  test('every token the new rules use is declared in the roles sheet', () => {
    ['--accent', '--accent-text', '--warn-rgb', '--success', '--success-rgb', '--success-text', '--muted', '--text', '--bg', '--surface', '--info', '--glow-rgb']
      .forEach((t) => expect([t, new RegExp(`${t}\\s*:`).test(roles)]).toEqual([t, true]));
  });
  test('the rail\'s headers and rows stay on the laptop ladder', () => {
    expect(rule(SHEETS.host, '.hc-count')).toMatch(/font-size:\s*13px/);
    expect(rule(SHEETS.host, '.hc-sec summary')).toMatch(/font-size:\s*13px/);
  });
});

describe('the compact row (README D7)', () => {
  test('five slots: dot, the flexible name, a 20px glyph, a 48px fact, a 28px ⋯', () => {
    const r = rule(SHEETS.row, '.prow.prow--rail');
    expect(r).toMatch(/grid-template-columns:\s*8px minmax\(0, 1fr\) 20px 48px 28px/);
    expect(r).toMatch(/display:\s*grid/);
  });
  test('✓ in success text, … and — muted; the score muted until it is live', () => {
    expect(rule(SHEETS.row, '.prow.prow--rail .prow-doing.is-done')).toMatch(/color:\s*var\(--success-text\)/);
    expect(SHEETS.row).toMatch(/\.prow\.prow--rail \.prow-doing\.is-wait,\s*\.prow\.prow--rail \.prow-doing\.is-unknown \{[^}]*color:\s*var\(--muted\)/);
    expect(rule(SHEETS.row, '.prow .prow-fact')).toMatch(/color:\s*var\(--muted\)/);
    expect(rule(SHEETS.row, '.prow .prow-fact.is-live')).toMatch(/color:\s*var\(--text\)/);
  });
});

describe('motion: once, short, and off under reduced motion (README D4, fork 3)', () => {
  const animations = (css) => [...css.matchAll(/animation:\s*([^;]+);/g)].map((m) => m[1].trim()).filter((a) => a !== 'none');
  test.each(Object.keys(SHEETS))('%s: nothing repeats, alternates or runs forever', (k) => {
    const css = SHEETS[k];
    expect(css).not.toMatch(/infinite|alternate/);
    expect(css).not.toMatch(/animation-iteration-count:\s*(?!1\b)/);
    animations(css).forEach((a) => expect([a, /\s1\s/.test(` ${a} `)]).toEqual([a, true]));
  });
  test('the alert is 240ms on the line, the asker and the header; Everyone\'s in 600ms; the caret 120ms', () => {
    expect(animations(SHEETS.needs).every((a) => /240ms/.test(a))).toBe(true);
    expect(animations(SHEETS.host).filter((a) => /^hc-arrive/.test(a)).every((a) => /240ms/.test(a))).toBe(true);
    expect(animations(SHEETS.pulse).every((a) => /600ms/.test(a))).toBe(true);
    expect(rule(SHEETS.host, '.hc-caret svg')).toMatch(/transition:\s*transform 120ms/);
  });
  test('the fades are triggered by an arrival, not by the lit state itself (no fade on reload)', () => {
    expect(SHEETS.needs).toMatch(/\.ny\.ny-line\.is-now\[data-arrived\] \{ animation: ny-arrive/);
    expect(rule(SHEETS.needs, '.ny.ny-line.is-now')).not.toMatch(/animation/);
    expect(SHEETS.host).toMatch(/summary\[data-level="now"\]\[data-arrived\] \{ animation: hc-arrive/);
    expect(rule(SHEETS.host, '.hc-sec summary[data-level="now"]')).not.toMatch(/animation/);
  });
  test('paint only: the keyframes touch colour, shadow and opacity, never the box', () => {
    const frames = Object.values(SHEETS).join('\n').match(/@keyframes[^{]+\{[^{}]*\{[^}]*\}\s*\}/g) || [];
    expect(frames.length).toBeGreaterThanOrEqual(5);
    frames.forEach((f) => expect([f, /height|width|padding|margin|transform|top|left/.test(f.replace(/border-left-color/g, ''))]).toEqual([f, false]));
  });
  test.each(Object.keys(SHEETS).filter((k) => k !== 'row'))('%s: prefers-reduced-motion turns every motion off', (k) => {
    const css = SHEETS[k];
    const m = css.match(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/);
    expect(m).not.toBeNull();
    expect(m[1]).toMatch(/animation:\s*none/);
    // Every animated selector is repeated verbatim inside, so the reduced rule
    // wins on order at equal specificity (a shorter selector would lose).
    const animated = [...css.replace(m[0], '').matchAll(/([^{}]+)\{[^}]*animation:\s*(?!none)[^;]+;/g)]
      .flatMap((x) => x[1].split(',')).map((s) => s.trim());
    const reduced = m[1].split('{')[0].split(',').map((s) => s.trim());
    animated.forEach((s) => expect([s, reduced.includes(s)]).toEqual([s, true]));
    if (k === 'host') expect(m[1]).toMatch(/\.hc-caret svg \{ transition: none; \}/);
  });
});

/* MEASURED (README §6), composited from the skins' dusk values. */
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lum = (rgb) => {
  const [r, g, b] = rgb.map((c) => c / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const over = (top, alpha, base) => top.map((c, i) => Math.round(c * alpha + base[i] * (1 - alpha)));

describe.each(['classic', 'present'])('%s dusk: every new pairing clears AA', (skin) => {
  const sk = read('styles', 'skins', `${skin}.css`);
  const v = (name) => {
    const m = sk.match(new RegExp(`--sk-(?:dark-)?${name}:\\s*(#[0-9A-Fa-f]{6})`));
    return m ? hex(m[1]) : null;
  };
  const rgbVar = (name) => (sk.match(new RegExp(`--sk-${name}-rgb:\\s*(\\d+) (\\d+) (\\d+)`)) || []).slice(1).map(Number);
  const BG = hex('#0F1A2E');
  const SURFACE = hex('#1B2942');
  const TEXT = hex('#F4EDE4');
  const MUTED = hex('#9BA8BE');
  const SUCCESS_TEXT = hex('#6FD0A4');
  const accentText = () => v('accent-text') || v('dark-accent-text');
  const warnWashBg = () => over(rgbVar('warn'), 0.08, BG);
  const successWash = () => over(rgbVar('success'), 0.10, SURFACE);

  test('the lit header on the 8% warn wash over the rail --bg: text, muted, the name', () => {
    expect(rgbVar('warn')).toHaveLength(3);
    expect(ratio(TEXT, warnWashBg())).toBeGreaterThanOrEqual(4.5);
    expect(ratio(MUTED, warnWashBg())).toBeGreaterThanOrEqual(4.5);
    expect(accentText()).not.toBeNull();
    expect(ratio(accentText(), warnWashBg())).toBeGreaterThanOrEqual(4.5);
  });
  test('the rows on the rail --bg: ✓ in success text, … muted, the score at both steps', () => {
    expect(ratio(SUCCESS_TEXT, BG)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(MUTED, BG)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(TEXT, BG)).toBeGreaterThanOrEqual(4.5);
  });
  test('tile 1 on its 10% success wash: text, muted (the lowest, ~5.1), success text', () => {
    expect(rgbVar('success')).toHaveLength(3);
    expect(ratio(TEXT, successWash())).toBeGreaterThanOrEqual(4.5);
    expect(ratio(MUTED, successWash())).toBeGreaterThanOrEqual(4.5);
    expect(ratio(SUCCESS_TEXT, successWash())).toBeGreaterThanOrEqual(4.5);
  });
});
