/**
 * THE CSS CONTRACT FOR THE IMAGES PANEL — components/SetMediaPanel.css and
 * components/QuestionImageField.css.
 *
 * NAMED `*Palette.test.js` AND NEVER `*Token*`. `.gitignore:35` is an
 * unanchored `*token*`, so a file named for tokens is invisible to git: it
 * runs locally, passes, and never reaches CI. Every palette test in this repo
 * carries this paragraph. Do not rename it back.
 *
 * jsdom loads no stylesheet and resolves no custom property, so the only
 * honest way to pin a design contract here is to read the sheet as text and do
 * the arithmetic. The compositing functions below are lifted verbatim from
 * docs/design/admin-redesign/audit.html's <script>.
 *
 * NO GEOMETRY IS ASSERTED ANYWHERE IN THIS FILE. jsdom has no layout engine,
 * so every width, offset and overflow would pass unconditionally.
 *
 * What green means: the panel's paint still clears AA on the surface it is
 * actually mounted on, and the scope has not started leaking. It cannot prove
 * the panel looks right in a browser.
 */
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const GLOBAL_CSS = read('styles.css');
const SMED_CSS = read('components', 'SetMediaPanel.css');
const QIMG_CSS = read('components', 'QuestionImageField.css');

/* ---- colour: lifted verbatim from docs/design/admin-redesign/audit.html ---- */
function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function lum(c) { return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]); }
function ratio(a, b) {
  const la = lum(a); const lb = lum(b);
  const h = Math.max(la, lb); const l = Math.min(la, lb);
  return (h + 0.05) / (l + 0.05);
}
function alphaOver(fg, bg, a) { return fg.map((c, i) => c * a + bg[i] * (1 - a)); }
function bgOf(el, win) {
  let node = el; const stack = [];
  while (node && node.nodeType === 1) {
    const c = win.getComputedStyle(node).backgroundColor;
    const m = String(c).match(/[\d.]+/g);
    if (m) {
      const a = m.length > 3 ? parseFloat(m[3]) : 1;
      if (a > 0) { stack.push([m.slice(0, 3).map(Number), a]); if (a >= 0.999) break; }
    }
    node = node.parentElement;
  }
  if (!stack.length) return [15, 26, 46];
  let out = stack[stack.length - 1][0];
  for (let i = stack.length - 2; i >= 0; i -= 1) out = alphaOver(stack[i][0], out, stack[i][1]);
  return out;
}

const parseHex = (h) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16));

/** A token READ out of a declaration block, never retyped: change it and these
 *  numbers move with it. */
function token(css, block, name) {
  const start = css.indexOf(block);
  if (start < 0) throw new Error(`no ${block} block`);
  const body = css.slice(start, css.indexOf('}', start));
  const m = body.match(new RegExp(`${name}\\s*:\\s*(#[0-9A-Fa-f]{6})`));
  if (!m) throw new Error(`${name} not declared in ${block}`);
  return m[1];
}
function tint(css, name) {
  const m = css.match(new RegExp(`${name}\\s*:\\s*(rgba\\([^)]*\\))`));
  if (!m) throw new Error(`${name} not declared`);
  return m[1];
}

const PAPER = '[data-theme="light"] {';
const ROOT = ':root {';
const SMED = '.smed {';
const QIMG = '.qimg {';

const T = {
  // The panel declares data-theme="light" on its root, so these are the tokens
  // it actually gets — read from styles.css's paper block, not assumed.
  bg: token(GLOBAL_CSS, PAPER, '--bg'),
  surface: token(GLOBAL_CSS, PAPER, '--surface'),
  surface2: token(GLOBAL_CSS, PAPER, '--surface-2'),
  text: token(GLOBAL_CSS, PAPER, '--text'),
  muted: token(GLOBAL_CSS, PAPER, '--muted'),
  // Theme-INVARIANT in styles.css, and unusable on paper — which is why .smed
  // re-points all three.
  duskPrimary: token(GLOBAL_CSS, ROOT, '--primary'),
  duskDangerText: token(GLOBAL_CSS, ROOT, '--danger-text'),
  danger: token(GLOBAL_CSS, ROOT, '--danger'),
  // .smed's own re-points and locals.
  primary: token(SMED_CSS, SMED, '--primary'),
  dangerText: token(SMED_CSS, SMED, '--danger-text'),
  dangerDeep: token(SMED_CSS, SMED, '--danger-deep'),
  successText: token(SMED_CSS, SMED, '--smed-success-text'),
  // .qimg's three, which inherit the surrounding form rather than a theme.
  qimgMuted: token(QIMG_CSS, QIMG, '--qimg-muted'),
  qimgOk: token(QIMG_CSS, QIMG, '--qimg-ok'),
  qimgBad: token(QIMG_CSS, QIMG, '--qimg-bad'),
};

/** Build the real paint stack in the DOM and hand it to the audit's bgOf.
 *  First entry outermost, last is what the text sits on. */
function composited(layers) {
  document.body.innerHTML = '';
  let host = document.body;
  for (const background of layers) {
    const el = document.createElement('div');
    el.style.backgroundColor = background;
    host.appendChild(el);
    host = el;
  }
  return bgOf(host, window);
}
const on = (fgHex, layers) => ratio(parseHex(fgHex), composited(layers));

const AA = 4.5;
// The panel is mounted inside `.qs-editor .qs-panel`, which paints
// --surface-2 over the editor's white card (styles.css:10012).
const PANEL = [T.surface, T.surface2];
// Its own inner cards and rows paint --surface on top of that.
const CARD = [T.surface, T.surface2, T.surface];

describe('the premise: the theme-invariant tokens are unusable on paper', () => {
  // If either of these ever clears AA on white, .smed's re-points are dead
  // weight and this file should be re-read rather than trusted.
  test('--primary #F6A94C cannot carry text on the white card', () => {
    expect(on(T.duskPrimary, [T.surface])).toBeLessThan(AA);
  });
  test('--danger-text #EF8C86 cannot carry text on the white card', () => {
    expect(on(T.duskDangerText, [T.surface])).toBeLessThan(AA);
  });
});

describe('every flat pairing the Images panel paints', () => {
  const pairs = [
    ['--text on the panel ground (headings, values)', () => T.text, PANEL],
    ['--muted on the panel ground (notes, counts)', () => T.muted, PANEL],
    ['--text on an inner card (report copy, file names)', () => T.text, CARD],
    ['--muted on an inner card (the "where it went" column)', () => T.muted, CARD],
    ['--primary on the panel ground (the file-count link colour)', () => T.primary, PANEL],
    ['--primary on an inner card (the Sending state)', () => T.primary, CARD],
    ['--danger-text on the panel ground (missing images)', () => T.dangerText, PANEL],
    ['--danger-text on an inner card (Refused)', () => T.dangerText, CARD],
    ['--smed-success-text on the panel ground (Uploaded)', () => T.successText, PANEL],
    ['--smed-success-text on an inner card', () => T.successText, CARD],
    ['white on the filled primary button', () => '#FFFFFF', [T.primary]],
    ['white on the filled destructive', () => '#FFFFFF', [T.dangerDeep]],
  ];
  test.each(pairs)('%s clears AA', (_label, fg, layers) => {
    expect(on(fg(), layers)).toBeGreaterThanOrEqual(AA);
  });
});

describe('every tinted composite clears AA — the half a token table cannot show', () => {
  const TINTS = {
    danger: () => tint(SMED_CSS, '--smed-tint-danger'),
    warn: () => tint(SMED_CSS, '--smed-tint-warn'),
    ok: () => tint(SMED_CSS, '--smed-tint-ok'),
    hover: () => tint(SMED_CSS, '--smed-row-hover'),
  };

  test('the missing-images report, tinted red over the white card', () => {
    const stack = [...CARD, TINTS.danger()];
    expect(on(T.dangerText, stack)).toBeGreaterThanOrEqual(AA);
    expect(on(T.text, stack)).toBeGreaterThanOrEqual(AA);
    expect(on(T.muted, stack)).toBeGreaterThanOrEqual(AA);
  });

  test('the all-clear report, tinted green', () => {
    const stack = [...CARD, TINTS.ok()];
    expect(on(T.successText, stack)).toBeGreaterThanOrEqual(AA);
    expect(on(T.text, stack)).toBeGreaterThanOrEqual(AA);
    expect(on(T.muted, stack)).toBeGreaterThanOrEqual(AA);
  });

  test('the warn chip, tinted amber', () => {
    const stack = [...CARD, TINTS.warn()];
    expect(on(T.primary, stack)).toBeGreaterThanOrEqual(AA);
    expect(on(T.muted, stack)).toBeGreaterThanOrEqual(AA);
  });

  test('a hovered row of the upload table', () => {
    const stack = [...CARD, TINTS.hover()];
    expect(on(T.text, stack)).toBeGreaterThanOrEqual(AA);
    expect(on(T.muted, stack)).toBeGreaterThanOrEqual(AA);
  });
});

describe('the per-question field, which inherits the form rather than a theme', () => {
  // It sits inside .qs-question-form on the .qs-panel ground, so its three
  // colours are measured against that and not against white.
  test.each([
    ['the explainer under the input', () => T.qimgMuted],
    ['an upload that succeeded', () => T.qimgOk],
    ['an upload that failed', () => T.qimgBad],
  ])('%s clears AA on the panel ground', (_label, fg) => {
    expect(on(fg(), PANEL)).toBeGreaterThanOrEqual(AA);
  });

  test('it declares no theme, because the controls around it come from styles.css', () => {
    const jsx = read('components', 'QuestionImageField.jsx');
    expect(jsx).not.toMatch(/data-theme/);
  });
});

describe('--danger never carries text', () => {
  test('the premise: #E5645E is under AA on the surfaces here', () => {
    expect(on(T.danger, [T.surface])).toBeLessThan(AA);
  });
  test.each([['SetMediaPanel.css', SMED_CSS], ['QuestionImageField.css', QIMG_CSS]])(
    '%s never sets color: var(--danger)',
    (_name, css) => {
      // The [^-] guard matters: color: var(--danger-text) must not match.
      const offenders = css.split('\n').filter((l) => /(^|[^-])\bcolor\s*:\s*var\(--danger\)/.test(l));
      expect(offenders).toEqual([]);
    },
  );
});

describe('the namespace, both ways', () => {
  const stripped = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
  const roots = (css) => {
    const out = new Set();
    for (const block of stripped(css).split('}')) {
      const head = block.split('{')[0];
      if (!head || head.includes('@')) continue;
      for (const selector of head.split(',')) {
        const m = selector.trim().match(/^[a-zA-Z]*\.([\w-]+)/);
        if (m) out.add(m[1]);
      }
    }
    return [...out];
  };

  test('every selector in SetMediaPanel.css is rooted at .smed', () => {
    expect(roots(SMED_CSS).filter((n) => !n.startsWith('smed'))).toEqual([]);
  });

  test('every selector in QuestionImageField.css is rooted at .qimg', () => {
    expect(roots(QIMG_CSS).filter((n) => !n.startsWith('qimg'))).toEqual([]);
  });

  test('styles.css declares nothing in either scope', () => {
    // `.qs` collided with `.qsets` once and cost a whole surface
    // (QuestionSetsPanel.css:11-18). Both halves, both prefixes.
    const smed = [...stripped(GLOBAL_CSS).matchAll(/\.(smed[\w-]*)/g)].map((m) => m[1]);
    const qimg = [...stripped(GLOBAL_CSS).matchAll(/\.(qimg[\w-]*)/g)].map((m) => m[1]);
    expect([...new Set(smed)]).toEqual([]);
    expect([...new Set(qimg)]).toEqual([]);
  });

  test('no other component stylesheet declares in either scope', () => {
    const dir = path.join(__dirname, '..', 'components');
    const offenders = [];
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.css'))) {
      if (file === 'SetMediaPanel.css' || file === 'QuestionImageField.css') continue;
      const css = stripped(fs.readFileSync(path.join(dir, file), 'utf8'));
      if (/\.(smed|qimg)[\w-]*/.test(css)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});

describe('no stray literal, and no undeclared custom property', () => {
  test('SetMediaPanel.css declares every hex outside its token block by name', () => {
    const declarations = SMED_CSS
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\.smed\s*\{[^}]*\}/, '');           // the token block only
    const literals = [...declarations.matchAll(/(?:^|[\s:])(#[0-9A-Fa-f]{3,8})\b/g)].map((m) => m[1]);
    // #FFFFFF is the label on the filled primary and the filled destructive,
    // measured at 5.41:1 and 7.17:1. styles.css has no "on-primary" token and
    // inventing a global one from a component sheet is the thing
    // UserManagement.css was pulled up for.
    expect([...new Set(literals.map((h) => h.toUpperCase()))]).toEqual(['#FFFFFF']);
  });

  test('QuestionImageField.css keeps every literal inside its token block', () => {
    const declarations = QIMG_CSS
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\.qimg\s*\{[^}]*\}/, '');
    const literals = [...declarations.matchAll(/(?:^|[\s:])(#[0-9A-Fa-f]{3,8})\b/g)].map((m) => m[1]);
    expect(literals).toEqual([]);
  });

  test('every custom property either sheet uses is declared somewhere', () => {
    // An undefined custom property invalidates the WHOLE declaration.
    const declared = new Set();
    const dir = path.join(__dirname, '..', 'components');
    const sources = [GLOBAL_CSS, ...fs.readdirSync(dir)
      .filter((f) => f.endsWith('.css'))
      .map((f) => fs.readFileSync(path.join(dir, f), 'utf8'))];
    for (const css of sources) {
      for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:/gi)) declared.add(m[1]);
    }
    for (const css of [SMED_CSS, QIMG_CSS]) {
      const used = [...css.matchAll(/var\((--[a-z0-9-]+)/gi)].map((m) => m[1]);
      expect([...new Set(used)].filter((n) => !declared.has(n))).toEqual([]);
    }
  });
});

describe('the ladder', () => {
  const LADDER = { floor: '12px', label: '13px', body: '15px', head: '19px' };
  test.each(Object.entries(LADDER))('--smed-t-%s is %s', (step, value) => {
    expect(SMED_CSS).toMatch(new RegExp(`--smed-t-${step}:\\s*${value}`));
  });

  test('rows are 36px, because cards were rejected', () => {
    expect(SMED_CSS).toMatch(/--smed-row-h:\s*36px/);
  });

  test.each([['SetMediaPanel.css', SMED_CSS], ['QuestionImageField.css', QIMG_CSS]])(
    '%s declares nothing below the 12px floor',
    (_name, css) => {
      const px = [...css.matchAll(/font-size:\s*(\d+)px/g)].map((m) => Number(m[1]));
      expect(px.filter((n) => n < 12)).toEqual([]);
    },
  );
});

describe('the table is fixed, because a nowrap cell would otherwise grow it', () => {
  test('.smed-tbl declares table-layout: fixed', () => {
    const block = SMED_CSS.match(/\.smed-tbl\s*\{([^}]*)\}/);
    expect(block).not.toBeNull();
    expect(block[1]).toMatch(/table-layout:\s*fixed/);
  });

  test('a truncating cell is a single text node with min-width: 0', () => {
    // text-overflow is inert on a flex container with span children, and the
    // text is silently cut (AdminShell.css:229-238).
    for (const selector of ['.smed-file', '.smed-note']) {
      const block = SMED_CSS.match(new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`));
      expect(block).not.toBeNull();
      expect(block[1]).toMatch(/min-width:\s*0/);
      expect(block[1]).toMatch(/text-overflow:\s*ellipsis/);
      expect(block[1]).not.toMatch(/display:\s*flex/);
    }
  });
});

describe('the file inputs stay reachable by keyboard', () => {
  // `display: none` and `visibility: hidden` both take the control out of the
  // tab order and out of the accessibility tree, leaving it mouse-only.
  test.each([
    ['SetMediaPanel.css', SMED_CSS, '.smed-picker input[type="file"]'],
    ['QuestionImageField.css', QIMG_CSS, '.qimg-picker input[type="file"]'],
  ])('%s hides the picker by clipping, not by removing it', (_name, css, selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const block = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
    expect(block).not.toBeNull();
    expect(block[1]).toMatch(/clip:\s*rect\(/);
    expect(block[1]).not.toMatch(/display:\s*none/);
    expect(block[1]).not.toMatch(/visibility:\s*hidden/);
  });
});
