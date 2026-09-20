/**
 * THE SHELF CONTROL IS THEME-PROOF BY DECLINING INK.
 *
 * `SetTopicField` renders inside `QuestionSetEditor`'s Details panel, which is
 * mounted on the PAPER console (AdminPage) AND inside the host's DUSK dialog
 * (HostQuestionSetsDialog) — and on the CSV upload panel, which is both again.
 * That is exactly the split that shipped a 2.6:1 version chip twice
 * (setEditorChipsPalette.test.js): a colour measured against one surface and
 * then rendered on the other.
 *
 * So `.qs-topic*` declares no text colour at all, and these tests pin that
 * decision rather than a ratio — copy that inherits its surface's own `--text`
 * cannot fail in either theme, and a future edit that adds `color:` here has to
 * come past this file first. The same method as `.qs-workie`, one screen over.
 *
 * The ONE thing there is to measure is the neutral ground the tag chips sit on.
 * `rgba(155,168,190,α)` is the hairline grey this sheet already uses fifty-odd
 * times: it is hueless, so it darkens paper and lightens dusk by the same
 * small amount rather than tinting either. The composites are measured below,
 * on both themes, because "a tint is invisible in a token table".
 */
const fs = require('fs');
const path = require('path');

const GLOBAL_CSS = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
const JSX = fs.readFileSync(path.join(__dirname, '..', 'components', 'SetTopicField.jsx'), 'utf8');

/* ── the helpers, copied from setEditorChipsPalette.test.js ─────────────── */
function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function lum(c) { return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]); }
function ratio(a, b) { const la = lum(a); const lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); }
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16));
function token(block, name) {
  const start = GLOBAL_CSS.indexOf(block);
  const body = GLOBAL_CSS.slice(start, GLOBAL_CSS.indexOf('}', start));
  const m = body.match(new RegExp(`${name}\\s*:\\s*(#[0-9A-Fa-f]{6})`));
  if (!m) throw new Error(`${name} not in ${block}`);
  return hex(m[1]);
}
/** One alpha layer over a ground, which is what a browser actually paints. */
const over = (layer, alpha, ground) => ground.map((c, i) => Math.round(layer[i] * alpha + c * (1 - alpha)));

const AA = 4.5;
const PAPER = '[data-theme="light"] {';
const ROOT = ':root {';
/** Every `.qs-topic…` rule body in the sheet, keyed by selector. */
function blocks() {
  const found = [];
  const pattern = /(^|\n)(\.qs-topic[^{]*)\{([^}]*)\}/g;
  for (const m of GLOBAL_CSS.matchAll(pattern)) found.push([m[2].trim(), m[3]]);
  return found;
}

describe('the control declares the classes its markup uses', () => {
  const used = [...JSX.matchAll(/className="([^"]*)"/g)]
    .flatMap((m) => m[1].split(/\s+/))
    .filter((c) => c.startsWith('qs-topic'));

  it('uses at least the wrapper, the chips and the two offers', () => {
    expect(new Set(used).size).toBeGreaterThanOrEqual(5);
  });

  test.each([...new Set(used)])('%s is declared in styles.css', (cls) => {
    // jsdom loads no stylesheet, so no render test can see a class that was
    // never written. This is the one question answerable as string-to-string —
    // and it is where `.corg-scrim` hid an invisible dialog for a week.
    expect(GLOBAL_CSS).toMatch(new RegExp(`\\.${cls}[\\s,{:.]`));
  });
});

describe('it declines ink, so neither theme can be the wrong one', () => {
  test.each(blocks())('%s names no text colour of its own', (_selector, body) => {
    // `inherit` and `currentColor` are the decline itself, and a bare <button>
    // NEEDS one of them: the user agent paints buttontext (near-black), which
    // is invisible on dusk. Anything else here is a colour chosen against one
    // of the two surfaces this editor renders on.
    for (const m of body.matchAll(/(?:^|[;{\s])color\s*:\s*([^;}]+)/g)) {
      expect(m[1].trim()).toMatch(/^(inherit|currentColor)$/i);
    }
  });

  test.each(blocks())('%s writes no hex and no opaque colour function', (_selector, body) => {
    // rejects: a hand-picked grey. The only colour allowed here is the hueless
    // hairline rgba below and the tokens the surface itself re-points.
    expect(body).not.toMatch(/#[0-9A-Fa-f]{3,8}/);
    expect(body).not.toMatch(/(^|[;{\s(])(rgb|hsl|hsla)\(/);
  });

  test.each(blocks())('%s tints only with the hairline grey', (_selector, body) => {
    for (const m of body.matchAll(/rgba\(([^)]*)\)/g)) {
      const [r, g, b] = m[1].split(',').map((n) => Number(n.trim()));
      expect([r, g, b]).toEqual([155, 168, 190]);
    }
  });

  test.each(blocks())('%s uses only custom properties styles.css declares', (_selector, body) => {
    for (const m of body.matchAll(/var\((--[a-z0-9-]+)/g)) {
      expect(GLOBAL_CSS).toMatch(new RegExp(`${m[1]}\\s*:`));
    }
  });
});

describe('the ground the chips sit on carries the surface’s own ink', () => {
  /**
   * Only the alphas painted as a BACKGROUND. A border's alpha is not a ground —
   * nothing is read on top of a 3px rule — and compositing text over one would
   * be arithmetic about a pixel that carries no letter. The hover tint counts:
   * the × glyph is read on it.
   */
  /*
    A GROUND MAY BE WRITTEN AS A TOKEN, AND SINCE 2026-09-20 IT IS. The five
    literals these rules used to paint were tokenised onto `.qs-topic`'s own
    root, because the editor's stylesheet guard forbids a raw colour in a
    `.qs-*` rule and SetTopicField mounts in three places, only one of which
    has `.qs-editor` overhead. Reading only literals here made this suite
    measure nothing and say so; it now resolves the token first, so the
    arithmetic still runs on the colour that actually paints.
  */
  const TOKEN_ALPHA = Object.fromEntries(
    [...GLOBAL_CSS.matchAll(/--(qs-topic-[\w-]+)\s*:\s*rgba\(155,\s*168,\s*190,\s*([.\d]+)\)/g)]
      .map((m) => [m[1], Number(m[2])]),
  );
  const alphas = [...new Set(
    blocks().flatMap(([, body]) => [
      ...[...body.matchAll(/background(?:-color)?:\s*rgba\(155,\s*168,\s*190,\s*([.\d]+)\)/g)]
        .map((m) => Number(m[1])),
      ...[...body.matchAll(/background(?:-color)?:\s*var\(--(qs-topic-[\w-]+)\)/g)]
        .map((m) => TOKEN_ALPHA[m[1]]),
    ].filter((a) => Number.isFinite(a))),
  )];
  const grey = [155, 168, 190];

  it('paints at least one tint, or there is nothing here to measure', () => {
    expect(alphas.length).toBeGreaterThan(0);
  });

  describe.each([
    ['paper', token(PAPER, '--bg'), token(PAPER, '--text')],
    ['paper, on a white card', [255, 255, 255], token(PAPER, '--text')],
    ['dusk', token(ROOT, '--surface'), token(ROOT, '--text')],
  ])('on %s', (_name, bg, text) => {
    it('the surface’s own --text clears AA on every tint this group paints', () => {
      for (const alpha of alphas) expect(ratio(text, over(grey, alpha, bg))).toBeGreaterThanOrEqual(AA);
    });
  });

  it('paints no ground at all under the two sentences, which carry muted copy', () => {
    // --muted is deliberately NOT measured above: nothing here puts muted text
    // on a tint. It stays that way only while these two sit on the panel's own
    // ground, which the panel's palette already measures — so that is what this
    // pins. A background added here would need its own ratio, and dusk --muted
    // is 2.6:1 on the hover tint, which is how that would go.
    for (const selector of ['.qs-topic-offer', '.qs-topic-mismatch']) {
      const [, body] = blocks().find(([s]) => s === `${selector} `.trim()) || [];
      expect(body).toBeDefined();
      expect(body).not.toMatch(/(^|[;{\s])background(-color)?\s*:/);
    }
  });
});

describe('the type sits on the laptop ladder', () => {
  it('declares nothing below the 12px floor, and nothing off the ladder', () => {
    const ladder = [12, 13, 15, 19, 24, 30];
    const sizes = blocks()
      .flatMap(([, body]) => [...body.matchAll(/font-size:\s*(\d+)px/g)].map((m) => Number(m[1])));
    expect(sizes.length).toBeGreaterThan(0);
    for (const size of sizes) expect(ladder).toContain(size);
  });
});
