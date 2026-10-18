// src/src/__tests__/hostConsolePalette.test.js
import fs from 'fs';
import path from 'path';
const css = fs.readFileSync(path.join(__dirname, '..', 'components', 'console', 'HostConsole.css'), 'utf8');

// The root is .hc itself; every other class is .hc-*. \b accepts both, never .hcx.
test('every selector is scoped hc-', () => {
  const selectors = css.replace(/\/\*[\s\S]*?\*\//g, '').match(/(^|})\s*([^{@}]+)\{/g) || [];
  for (const s of selectors) {
    const sel = s.replace(/^}?\s*/, '').replace(/\{$/, '').trim();
    for (const part of sel.split(',')) expect([part.trim(), /\.hc\b/.test(part)]).toEqual([part.trim(), true]);
  }
});
test('the laptop ladder only: 12 / 13 / 15 / 19 / 24px', () => {
  const ladder = [12, 13, 15, 19, 24];
  for (const m of css.matchAll(/font-size:\s*(\d+)px/g)) expect(ladder).toContain(Number(m[1]));
  expect(css).not.toMatch(/font-size:\s*[\d.]+(rem|em)/);
  expect(css).not.toMatch(/var\(--(L|t)-/);
});
// The next step is a card above the main area, outside its scroll (owner, 18 Oct 2026).
test('the main area scrolls; the next-step card is above it, outside it (Review Focus 5)', () => {
  expect(css).toMatch(/\.hc-main\s*\{[^}]*overflow:\s*auto/);
  expect(css).toMatch(/grid-template-areas:\s*"top top"\s*"loop loop"\s*"rail now"\s*"rail main"/);
});
test('no colour literal', () => {
  expect(css.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d/);
});
test('the reused action bar is pinned to the ladder inside the console', () => {
  for (const cls of ['__hint', '__armed', '__primary', '__secondary', '__tertiary', '__kbd', '__keyhint']) {
    expect(css).toMatch(new RegExp(`\\.hc-acts \\.host-action-bar${cls}[^{]*\\{[^}]*font-size:\\s*\\d+px`));
  }
});
test('keyboard focus is visible on the console\'s own controls', () => {
  for (const sel of ['.hc-sec summary', '.hc-link', '.hc-code', '.hc-btn', '.hc-winstat']) {
    expect(css).toMatch(new RegExp(`${sel.replace(/\./g, '\\.')}:focus-visible`));
  }
});

/* WORKIE'S READ ON DUSK (walk, 15 Oct): styles.css .markdown-* hardcodes the
   paper theme's dark text, so the read was dark on dark. Inside .hc every
   text-bearing markdown class takes a token colour and a ladder size. */
const rule = (sel) => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp(`(?:^|[},])\\s*[^{}]*${esc}\\s*(?:,[^{]*)?\\{([^}]*)\\}`, 'm'));
  return m ? m[1] : '';
};
test('the read takes dusk colours and the ladder', () => {
  const colourOf = (sel) => (rule(sel).match(/(?:^|;)\s*color:\s*([^;]+)/) || [])[1];
  expect(colourOf('.hc .markdown-content')).toBe('var(--text)');
  for (const sel of ['.hc .markdown-p', '.hc .markdown-li', '.hc .markdown-h2', '.hc .markdown-h3', '.hc .markdown-content strong', '.hc .markdown-td', '.hc .markdown-th']) {
    expect([sel, colourOf(sel)]).toEqual([sel, 'var(--text)']);
  }
  expect(colourOf('.hc .markdown-content em')).toBe('var(--muted)');
  expect(colourOf('.hc .markdown-link')).toBe('var(--info)');
  expect(rule('.hc .markdown-content')).toMatch(/font-size:\s*15px/);
  expect(rule('.hc .markdown-h2')).toMatch(/font-size:\s*19px/);
  expect(rule('.hc .markdown-h3')).toMatch(/font-size:\s*15px/);
  // The ask chips: never under the 12px floor inside the console.
  expect(rule('.hc .askicon')).toMatch(/font-size:\s*12px/);
});

/* THE COMPOSER STAYS IN VIEW (walk, 15 Oct). Geometry is checked in a
   browser (see the walk-fix report); this pins the rules that give it. */
test('the inline composer is sticky, the main area\'s height, its body scrolls', () => {
  expect(css).toMatch(/\.hc-main\s*\{[^}]*container-type:\s*size/);
  const c = rule('.hc-cols.is-read > .askc--inline');
  expect(c).toMatch(/position:\s*sticky/);
  expect(c).toMatch(/top:\s*0/);
  expect(c).toMatch(/align-self:\s*start/);
  expect(c).toMatch(/max-height:\s*100cqh/);
  expect(rule('.hc-cols.is-read > .askc--inline .askc-body')).toMatch(/overflow-y:\s*auto/);
  expect(rule('.hc-cols.is-read > .askc--inline .ui-dialog-foot')).toMatch(/flex:\s*none/);
});

/* A QUESTION FOR THE ROOM AT LAPTOP SIZE (walk, 15 Oct): AskStage carries
   the wall's type (--t-*, .q, .kicker); inside .hc it is pinned to the ladder. */
test('the room question in the console uses the laptop ladder', () => {
  const size = (sel) => (rule(sel).match(/font-size:\s*(\d+)px/) || [])[1];
  expect(size('.hc .askstage .askstage-kicker')).toBe('12');
  expect(size('.hc .askstage .askstage-q')).toBe('24');
  expect(size('.hc .askstage .askstage-count')).toBe('15');
  expect(size('.hc .askstage .askstage-idea')).toBe('15');
  expect(size('.hc .askstage .askstage-options li')).toBe('15');
  expect(size('.hc .askstage .askstage-bars li')).toBe('15');
  // No viewport-scaled spacing from the wall's stylesheet either.
  expect(rule('.hc .askstage')).toMatch(/gap:\s*12px/);
});
