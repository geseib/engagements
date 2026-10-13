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
 *
 * THE SURFACE MOVED ONCE. This panel was paper, on the editor's #F1EDE4 card,
 * until the owner asked for the editor to stop being the one white screen in a
 * dark product. Every ground below is now READ out of the rule that paints it
 * rather than named here, so the next move is measured rather than discovered.
 */
const fs = require('fs');
const path = require('path');
const H = require('../testing/skinHarness');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const GLOBAL_CSS = require('../testing/classicGlobalCss')();
const SMED_CSS = read('components', 'SetMediaPanel.css');
const QIMG_CSS = read('components', 'QuestionImageField.css');

/* ---- colour: the audit's lin/lum/ratio/alphaOver/bgOf (docs/design/admin-redesign/
        audit.html) live verbatim in testing/skinHarness.js. H.on / H.composite are its
        bgOf as arithmetic, so a role value written `rgb(r g b / a)` composites without
        jsdom having to parse it. ---- */

const CLASSIC_DUSK = { skin: 'classic', theme: 'dark' };

/** A scope-local token READ out of a declaration block, never retyped, with every
 *  var() it reads resolved (scope-local names first, then roles) for one skin x
 *  theme: change it and these numbers move with it. */
function token(css, block, name, opts = CLASSIC_DUSK) {
  return H.scopeVar(css, block, name, opts);
}
function tint(css, name, opts = CLASSIC_DUSK) {
  const v = token(css, SMED, name, opts);
  if (!(H.parseColor(v).a < 1)) throw new Error(`${name} is not a translucent tint: ${v}`);
  return v;
}

const SMED = '.smed {';
const QIMG = '.qimg {';

const HOST_CSS = read('components', 'QuestionSetsPanel.css');
const ONLIGHT = '.qsets.qsets--onlight,';

const on = (fg, layers) => H.on(fg, layers);
const AA = H.AA;

/* The panel is mounted inside `.qs-editor .qs-panel`. The ground that rule
   paints is READ rather than named: it moved from --surface-2 to --bg when the
   editor converted, and a retyped token would have gone on passing against a
   ground nothing draws. */
const PANEL_TOKEN = GLOBAL_CSS
  .slice(GLOBAL_CSS.indexOf('.qs-editor .qs-panel {'))
  .match(/background:\s*var\((--[\w-]+)\)/)[1];

/** The token a `.smed-btn--*` rule draws its label in. */
function btnInkToken(selector) {
  const rule = SMED_CSS
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .match(new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`));
  if (!rule) throw new Error(`no rule for "${selector}" — renamed?`);
  const ink = rule[1].match(/(?:^|;)\s*color:\s*var\((--[\w-]+)\)/);
  if (!ink) throw new Error(`"${selector}" draws its label in no token`);
  return ink[1];
}

/** Everything the panel paints, for one skin x theme. */
function palette(opts) {
  const T = {
    // The panel declares data-theme="dark" on its root, so these are the roles
    // it actually gets — resolved through styles/roles.css and the skin, not assumed.
    surface: H.role('--surface', opts),
    text: H.role('--text', opts),
    muted: H.role('--muted', opts),
    // What the HOST SHELF pushes onto this panel's ancestors, and what the three
    // re-points below exist to hold off.
    hostPrimary: token(HOST_CSS, ONLIGHT, '--primary', opts),
    hostDangerText: token(HOST_CSS, ONLIGHT, '--danger-text', opts),
    danger: H.role('--danger', opts),
    // .smed's own re-points and locals.
    primary: token(SMED_CSS, SMED, '--primary', opts),
    dangerText: token(SMED_CSS, SMED, '--danger-text', opts),
    successText: token(SMED_CSS, SMED, '--smed-success-text', opts),
    // .qimg's three, which inherit the surrounding form rather than a theme.
    qimgMuted: token(QIMG_CSS, QIMG, '--qimg-muted', opts),
    qimgOk: token(QIMG_CSS, QIMG, '--qimg-ok', opts),
    qimgBad: token(QIMG_CSS, QIMG, '--qimg-bad', opts),
    // The ink the filled button carries, READ from the rule that draws it —
    // it was a bare #FFFFFF on the paper amber and is --bg on the dusk one.
    btnInk: H.role(btnInkToken('.smed-btn--primary'), opts),
  };
  const PANEL = [T.surface, H.role(PANEL_TOKEN, opts)];
  // Its own inner cards and rows paint --surface on top of that.
  const CARD = [...PANEL, T.surface];
  const TINTS = {
    danger: tint(SMED_CSS, '--smed-tint-danger', opts),
    warn: tint(SMED_CSS, '--smed-tint-warn', opts),
    ok: tint(SMED_CSS, '--smed-tint-ok', opts),
    hover: tint(SMED_CSS, '--smed-row-hover', opts),
  };
  return { T, PANEL, CARD, TINTS };
}

/** Colour equality tolerant to spelling: rgb channels, alpha to 3 dp. */
const norm = (c) => {
  const p = H.parseColor(c);
  return { rgb: p.rgb.map((n) => Math.round(n)), a: Math.round(p.a * 1000) / 1000 };
};

describe('Classic stays pinned: the values resolve to what the sheet used to spell out', () => {
  test.each([
    ['--primary', '#F6A94C', SMED_CSS, SMED],
    ['--danger-text', '#EF8C86', SMED_CSS, SMED],
    ['--smed-success-text', '#6FD0A4', SMED_CSS, SMED],
    ['--smed-rule', 'rgba(155, 168, 190, .20)', SMED_CSS, SMED],
    ['--smed-rule-strong', 'rgba(155, 168, 190, .34)', SMED_CSS, SMED],
    ['--smed-row-hover', 'rgba(155, 168, 190, .055)', SMED_CSS, SMED],
    ['--smed-tint-danger', 'rgba(229, 100, 94, .09)', SMED_CSS, SMED],
    ['--smed-tint-warn', 'rgba(246, 169, 76, .09)', SMED_CSS, SMED],
    ['--smed-tint-ok', 'rgba(79, 178, 134, .10)', SMED_CSS, SMED],
    ['--qimg-muted', '#9BA8BE', QIMG_CSS, QIMG],
    ['--qimg-ok', '#6FD0A4', QIMG_CSS, QIMG],
    ['--qimg-bad', '#EF8C86', QIMG_CSS, QIMG],
  ])('%s in Classic / dark is %s', (name, literal, css, block) => {
    expect(norm(token(css, block, name))).toEqual(norm(literal));
  });
});

const DUSK_CASES = H.CASES.filter(([, t]) => t === 'dark');

describe.each(DUSK_CASES)('%s / %s', (skin, theme) => {
  const { T, PANEL, CARD, TINTS } = palette({ skin, theme });

  describe('the premise: the host shelf\'s paper inks are unusable here', () => {
    // If either of these ever clears AA on the panel, .smed's re-points are dead
    // weight and this file should be re-read rather than trusted.
    test('the host shelf\'s paper amber cannot carry text on this panel', () => {
      expect(on(T.hostPrimary, PANEL)).toBeLessThan(AA);
    });
    test('the host shelf\'s paper red cannot carry text on this panel', () => {
      expect(on(T.hostDangerText, PANEL)).toBeLessThan(AA);
    });
  });

  describe('every flat pairing the Images panel paints', () => {
    const pairs = [
      ['--text on the panel ground (headings, values)', T.text, PANEL],
      ['--muted on the panel ground (notes, counts)', T.muted, PANEL],
      ['--text on an inner card (report copy, file names)', T.text, CARD],
      ['--muted on an inner card (the "where it went" column)', T.muted, CARD],
      ['--primary on the panel ground (the file-count link colour)', T.primary, PANEL],
      ['--primary on an inner card (the Sending state)', T.primary, CARD],
      ['--danger-text on the panel ground (missing images)', T.dangerText, PANEL],
      ['--danger-text on an inner card (Refused)', T.dangerText, CARD],
      ['--smed-success-text on the panel ground (Uploaded)', T.successText, PANEL],
      ['--smed-success-text on an inner card', T.successText, CARD],
      ['the label on the filled primary button', T.btnInk, [T.primary]],
    ];
    test.each(pairs)('%s clears AA', (_label, fg, layers) => {
      expect(on(fg, layers)).toBeGreaterThanOrEqual(AA);
    });
  });

  describe('every tinted composite clears AA — the half a token table cannot show', () => {
    test('the missing-images report, tinted red over the card', () => {
      const stack = [...CARD, TINTS.danger];
      expect(on(T.dangerText, stack)).toBeGreaterThanOrEqual(AA);
      expect(on(T.text, stack)).toBeGreaterThanOrEqual(AA);
      expect(on(T.muted, stack)).toBeGreaterThanOrEqual(AA);
    });

    test('the all-clear report, tinted green', () => {
      const stack = [...CARD, TINTS.ok];
      expect(on(T.successText, stack)).toBeGreaterThanOrEqual(AA);
      expect(on(T.text, stack)).toBeGreaterThanOrEqual(AA);
      expect(on(T.muted, stack)).toBeGreaterThanOrEqual(AA);
    });

    test('the warn chip, tinted amber', () => {
      const stack = [...CARD, TINTS.warn];
      expect(on(T.primary, stack)).toBeGreaterThanOrEqual(AA);
      expect(on(T.muted, stack)).toBeGreaterThanOrEqual(AA);
    });

    test('a hovered row of the upload table', () => {
      const stack = [...CARD, TINTS.hover];
      expect(on(T.text, stack)).toBeGreaterThanOrEqual(AA);
      expect(on(T.muted, stack)).toBeGreaterThanOrEqual(AA);
    });
  });

  describe('the per-question field clears AA on the form it inherits', () => {
    // It sits inside .qs-question-form on the .qs-panel ground, so its three
    // colours are measured against that and not against white.
    test.each([
      ['the explainer under the input', T.qimgMuted],
      ['an upload that succeeded', T.qimgOk],
      ['an upload that failed', T.qimgBad],
    ])('%s clears AA on the panel ground', (_label, fg) => {
      expect(on(fg, PANEL)).toBeGreaterThanOrEqual(AA);
    });
  });

  test('the premise of "--danger never carries text": --danger is under AA on the surfaces here', () => {
    expect(on(T.danger, [T.surface])).toBeLessThan(AA);
  });
});

test('the panel re-points no GLOBAL token it does not read', () => {
  // --danger-deep was re-pointed here while the panel was paper, copied out of
  // `.qsets--onlight`, which really does render a filled destructive. This one
  // does not, and a token nobody reads is how a palette drifts — the skill says
  // so in as many words about --primary-deep. Only the global re-points are
  // checked: a re-point is a claim about what this panel draws, where an unused
  // `--smed-*` local is just an unused local.
  const block = SMED_CSS.slice(SMED_CSS.indexOf(SMED), SMED_CSS.indexOf('}', SMED_CSS.indexOf(SMED)));
  const repointed = [...block.matchAll(/(--[a-z0-9-]+)\s*:/gi)]
    .map((m) => m[1])
    .filter((name) => !name.startsWith('--smed-'));
  expect(repointed.length).toBeGreaterThan(0);        // the premise
  const body = SMED_CSS.replace(/\/\*[\s\S]*?\*\//g, '').replace(block, '');
  expect(repointed.filter((name) => !new RegExp(`var\\(${name}[,)]`).test(body))).toEqual([]);
});

describe('the per-question field, which inherits the form rather than a theme', () => {
  test('it declares no theme, because the controls around it come from styles.css', () => {
    const jsx = read('components', 'QuestionImageField.jsx');
    expect(jsx).not.toMatch(/data-theme/);
  });

  test('the panel beside it DOES declare one, and it is the editor\'s', () => {
    // The two sit in the same editor and moved together. rejects: one of them
    // left on the other polarity, which is how a seam appears mid-form.
    expect(read('components', 'SetMediaPanel.jsx')).toMatch(/data-theme="dark"/);
    expect(read('components', 'QuestionSetEditor.jsx')).toMatch(/data-theme="dark"/);
  });
});

describe('--danger never carries text', () => {
  // The premise (--danger under AA on the surfaces here) is asserted per skin above.
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
    // Nothing is left outside the block: the filled button's label used to be
    // a bare #FFFFFF (5.41:1 on the paper amber) because styles.css had no
    // "on-primary" token; on dusk the palette's own --bg is that ink, at
    // 8.86:1, so the one exception this test used to allow is gone.
    expect([...new Set(literals.map((h) => h.toUpperCase()))]).toEqual([]);
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
