/**
 * A SURVEY QUESTION IN THE SET EDITOR — `.sqf`, components/SurveyQuestionFields.css.
 *
 * Named "Palette", never "Token": `.gitignore:35` is an unanchored `*token*`, so
 * a file named for tokens is invisible to git — it passes locally and never
 * reaches CI. Do not rename it.
 *
 * WHAT IS MEASURED. The sheet paints three places, all inside the set editor
 * (`.qs-editor`, which declares `data-theme="dark"` on its own root — see
 * questionSetEditorPalette.test.js — so it is dusk on both of its mounts):
 *
 *   - a survey question's row in the Questions panel: the Kind chip, the answer
 *     preview under the title, and Required / Optional — on the row, and on the
 *     row's changed and removed tints;
 *   - the Add question menu, floating over the panel;
 *   - the question dialog's kind bar and each kind's fields.
 *
 * Every ground is READ from the rule that paints it (styles.css,
 * QuestionSetEditor.css, and this sheet), and every colour from the token block
 * that declares it, so a later repaint is measured here rather than found on
 * the owner's screen. The checks — `lin`, `lum`, `ratio`, `alphaOver`, `bgOf` —
 * are lifted verbatim from docs/design/admin-redesign/audit.html, as the other
 * palette tests lift them.
 *
 * jsdom has no layout engine and loads no stylesheet. Green here means the
 * palette clears AA and the sheet keeps its namespace and ladder; it cannot
 * prove how a browser draws any of it.
 */
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const GLOBAL_CSS = read('styles.css');
const EDITOR_CSS = read('components', 'QuestionSetEditor.css');
const SQF_CSS = read('components', 'SurveyQuestionFields.css');

/* ---- colour: lifted verbatim from docs/design/admin-redesign/audit.html ---- */
function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function lum(c) { return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]); }
function ratio(a, b) {
  const la = lum(a); const lb = lum(b);
  const h = Math.max(la, lb); const l = Math.min(la, lb);
  return (h + 0.05) / (l + 0.05);
}
function alphaOver(fg, bg, a) { return fg.map((c, i) => c * a + bg[i] * (1 - a)); }
/* Walk UP compositing every alpha layer. Reading only the element's own
   background is how dark-on-dark passes an audit. */
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

/* ---- values, READ rather than retyped ------------------------------------ */
const parseHex = (h) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16));

function blockOf(css, head) {
  const text = strip(css);
  const start = text.indexOf(head);
  if (start < 0) throw new Error(`no "${head}" block`);
  return text.slice(start, text.indexOf('}', start));
}
function ruleBody(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = strip(css).match(new RegExp(`(^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`));
  if (!m) throw new Error(`no rule for "${selector}" — renamed?`);
  return m[2];
}

const DUSK = blockOf(GLOBAL_CSS, '[data-theme="dark"] {');
const ROOT = blockOf(GLOBAL_CSS, ':root {');
const EDITOR = blockOf(EDITOR_CSS, '.qs-editor {');
const SCOPE = blockOf(SQF_CSS, '.sqf {');

/** A token as the survey fields see it: their own scope, then the editor's, then dusk, then :root. */
function resolve(name) {
  for (const block of [SCOPE, EDITOR, DUSK, ROOT]) {
    const hex = block.match(new RegExp(`${name}\\s*:\\s*(#[0-9A-Fa-f]{6})`));
    if (hex) return hex[1].toUpperCase();
    const rgba = block.match(new RegExp(`${name}\\s*:\\s*(rgba\\([^)]*\\))`));
    if (rgba) return rgba[1];
  }
  throw new Error(`${name} is declared by no block the survey fields can see`);
}

/** The ground a rule paints, or null when it paints none and what is beneath shows. */
function groundOf(css, selector) {
  const bg = ruleBody(css, selector).match(/background(?:-color)?:\s*var\((--[\w-]+)\)/);
  return bg ? resolve(bg[1]) : null;
}
/** The ink a rule draws its text in. */
function inkOf(css, selector) {
  const fg = ruleBody(css, selector).match(/(?:^|;)\s*color:\s*var\((--[\w-]+)\)/);
  if (!fg) throw new Error(`"${selector}" draws no ink of its own`);
  return resolve(fg[1]);
}

function composited(layers) {
  document.body.innerHTML = '';
  let host = document.body;
  for (const background of layers.filter(Boolean)) {
    const el = document.createElement('div');
    el.style.backgroundColor = background;
    host.appendChild(el);
    host = el;
  }
  return bgOf(host, window);
}
const on = (fgHex, layers) => ratio(parseHex(fgHex), composited(layers));
const AA = 4.5;

const T = {
  bg: resolve('--bg'),
  text: resolve('--text'),
  muted: resolve('--muted'),
  primary: resolve('--primary'),
};

/* The real paint stack, as questionSetEditorPalette.test.js reads it: the
   console's dusk field, the editor's card, the Questions panel cut into it as
   a well, a question row raised back out of it — and the dialog on the card. */
const CARD = [T.bg, groundOf(EDITOR_CSS, '.admin-section.qs-editor')];
const PANEL = [...CARD, groundOf(GLOBAL_CSS, '.qs-editor .qs-panel')];
const ROW = [...PANEL, groundOf(GLOBAL_CSS, '.qs-question-row')];
const CHANGED = [...ROW, resolve('--qs-tint-warn')];
const REMOVED = [...ROW, resolve('--qs-tint-danger')];
const DIALOG = [...CARD, groundOf(EDITOR_CSS, '.qs-editor .modal-content')];
const MENU = [...PANEL, groundOf(SQF_CSS, '.sqf-menu')];

describe('the sheet sits on the editor\'s dusk ground', () => {
  test('the editor root declares the dark theme, which every measurement below assumes', () => {
    const jsx = strip(read('components', 'QuestionSetEditor.jsx'));
    const root = jsx.match(/<div className="[^"]*qs-editor"[^>]*>/);
    expect(root).not.toBeNull();
    expect(root[0]).toMatch(/data-theme="dark"/);
  });

  test('the component that renders it imports it, and it is mounted only by the Questions panel', () => {
    // rejects: a sheet nobody imports (every rule dead in the bundle), and a
    // mount outside the editor, where none of these grounds would be true.
    expect(read('components', 'SurveyQuestionFields.jsx')).toMatch(/import '\.\/SurveyQuestionFields\.css';/);
    const mounts = ['components/QuestionsPanel.jsx', 'components/QuestionSetEditor.jsx', 'AdminPage.jsx']
      .filter((file) => read(...file.split('/')).includes("from './SurveyQuestionFields'")
        || read(...file.split('/')).includes("from './components/SurveyQuestionFields'"));
    expect(mounts).toEqual(['components/QuestionsPanel.jsx']);
  });

  test('the menu and the number fields paint opaque grounds, so nothing behind them reaches the text', () => {
    expect(groundOf(SQF_CSS, '.sqf-menu')).toMatch(/^#[0-9A-F]{6}$/);
    expect(groundOf(SQF_CSS, '.sqf-num')).toMatch(/^#[0-9A-F]{6}$/);
  });
});

describe('a survey question\'s row in the Questions panel', () => {
  test.each([
    ['the Kind chip\'s word', () => inkOf(SQF_CSS, '.sqf-kind'), ROW],
    ['the Kind chip on a changed row', () => inkOf(SQF_CSS, '.sqf-kind'), CHANGED],
    ['the Kind chip on a removed row', () => inkOf(SQF_CSS, '.sqf-kind'), REMOVED],
    ['the answer preview under the title', () => inkOf(SQF_CSS, '.sqf-prev'), ROW],
    ['the answer preview on a changed row', () => inkOf(SQF_CSS, '.sqf-prev'), CHANGED],
    ['the answer preview on a removed row', () => inkOf(SQF_CSS, '.sqf-prev'), REMOVED],
    ['the preview\'s leading figure ("1–5", "4 options")', () => inkOf(SQF_CSS, '.sqf-prev b'), ROW],
    ['Optional', () => inkOf(SQF_CSS, '.sqf-req'), ROW],
    ['Optional on a changed row', () => inkOf(SQF_CSS, '.sqf-req'), CHANGED],
    ['Required', () => inkOf(SQF_CSS, '.sqf-req.on'), ROW],
    ['Required on a removed row', () => inkOf(SQF_CSS, '.sqf-req.on'), REMOVED],
  ])('%s clears AA', (_label, fg, layers) => {
    expect(on(fg(), layers)).toBeGreaterThanOrEqual(AA);
  });
});

describe('the Add question menu', () => {
  test.each([
    ['a kind\'s name', () => inkOf(SQF_CSS, '.sqf-menu-item b'), () => MENU],
    ['its one sentence', () => inkOf(SQF_CSS, '.sqf-menu-item span'), () => MENU],
    ['a kind\'s name under the pointer or the keyboard',
      () => inkOf(SQF_CSS, '.sqf-menu-item b'), () => [...MENU, groundOf(SQF_CSS, '.sqf-menu-item:hover')]],
    ['its sentence, highlighted',
      () => inkOf(SQF_CSS, '.sqf-menu-item span'), () => [...MENU, groundOf(SQF_CSS, '.sqf-menu-item:hover')]],
    ['a kind\'s name with keyboard focus',
      () => inkOf(SQF_CSS, '.sqf-menu-item b'), () => [...MENU, groundOf(SQF_CSS, '.sqf-menu-item:focus-visible')]],
    ['its sentence with keyboard focus',
      () => inkOf(SQF_CSS, '.sqf-menu-item span'), () => [...MENU, groundOf(SQF_CSS, '.sqf-menu-item:focus-visible')]],
  ])('%s clears AA', (_label, fg, layers) => {
    expect(on(fg(), layers())).toBeGreaterThanOrEqual(AA);
  });
});

describe('the question dialog: the kind bar and each kind\'s fields', () => {
  const pressed = '.sqf-opt[aria-pressed="true"]';
  const segOn = '.sqf-seg button[aria-pressed="true"]';
  test.each([
    ['a kind in the kind bar', () => inkOf(SQF_CSS, '.sqf-opt'), () => DIALOG],
    ['a kind under the pointer', () => inkOf(SQF_CSS, '.sqf-opt'), () => [...DIALOG, groundOf(SQF_CSS, '.sqf-opt:hover')]],
    ['the chosen kind, on the amber', () => inkOf(SQF_CSS, pressed), () => [groundOf(SQF_CSS, pressed)]],
    ['a field label ("Scale", "People can pick")', () => inkOf(SQF_CSS, '.sqf-lab'), () => DIALOG],
    ['the help line under a field', () => inkOf(SQF_CSS, '.sqf-help'), () => DIALOG],
    ['a dimmed aside ("— 2 to 8")', () => inkOf(SQF_CSS, '.sqf-dim'), () => DIALOG],
    ['an option\'s letter', () => inkOf(SQF_CSS, '.sqf-k'), () => DIALOG],
    ['a segment not chosen ("1–10")', () => inkOf(SQF_CSS, '.sqf-seg button'), () => DIALOG],
    ['the chosen segment ("1–5")', () => inkOf(SQF_CSS, segOn), () => [...DIALOG, groundOf(SQF_CSS, segOn)]],
    ['a number in its box ("up to 2")', () => inkOf(SQF_CSS, '.sqf-num'), () => [...DIALOG, groundOf(SQF_CSS, '.sqf-num')]],
    ['a held number box, while its choice is off',
      () => inkOf(SQF_CSS, '.sqf-num:disabled'), () => [...DIALOG, groundOf(SQF_CSS, '.sqf-num:disabled')]],
    ['a switch\'s label ("Needs an answer")', () => inkOf(SQF_CSS, '.sqf-switch'), () => DIALOG],
    ['a switch\'s explanation', () => inkOf(SQF_CSS, '.sqf-switch small'), () => DIALOG],
    ['the remove-an-option control', () => inkOf(SQF_CSS, '.sqf-x'), () => DIALOG],
  ])('%s clears AA', (_label, fg, layers) => {
    expect(on(fg(), layers())).toBeGreaterThanOrEqual(AA);
  });
});

describe('the sheet keeps to the design system', () => {
  test('no hex literal anywhere — every colour is a token or a tint of one', () => {
    const literals = [...strip(SQF_CSS).matchAll(/(?:^|[\s:,(])(#[0-9A-Fa-f]{3,8})\b/g)].map((m) => m[1]);
    expect(literals).toEqual([]);
  });

  test('--danger never carries text here', () => {
    const offenders = strip(SQF_CSS).split('\n')
      .filter((l) => /(^|[^-])\bcolor\s*:\s*var\(--danger\)/.test(l));
    expect(offenders).toEqual([]);
  });

  test('every custom property the sheet uses is declared by styles.css or the sheet itself', () => {
    // Not by QuestionSetEditor.css: an undefined custom property invalidates
    // the whole declaration, so a token borrowed from a sheet that merely
    // happens to be an ancestor today is one import away from vanishing.
    const declared = new Set();
    for (const css of [GLOBAL_CSS, SQF_CSS]) {
      for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:/gi)) declared.add(m[1]);
    }
    const used = [...strip(SQF_CSS).matchAll(/var\((--[a-z0-9-]+)/gi)].map((m) => m[1]);
    expect([...new Set(used)].filter((n) => !declared.has(n))).toEqual([]);
  });

  const roots = () => {
    const out = new Set();
    for (const blk of strip(SQF_CSS).split('}')) {
      const head = blk.split('{')[0];
      if (!head.trim() || head.includes('@')) continue;
      for (const sel of head.split(',')) {
        const m = sel.trim().match(/^[a-zA-Z]*\.([\w-]+)/);
        out.add(m ? m[1] : sel.trim());
      }
    }
    return [...out];
  };

  test('every selector is rooted at the .sqf scope', () => {
    expect(roots().filter((n) => !/^sqf(-|$)/.test(n))).toEqual([]);
  });

  test('styles.css declares nothing in the .sqf scope', () => {
    const global = [...strip(GLOBAL_CSS).matchAll(/\.(sqf[\w-]*)/g)].map((m) => m[1]);
    expect([...new Set(global)]).toEqual([]);
  });

  test.each([['floor', '12px'], ['label', '13px'], ['body', '15px'], ['head', '19px']])(
    '--sqf-t-%s is %s', (step, value) => {
      expect(SCOPE).toMatch(new RegExp(`--sqf-t-${step}:\\s*${value}`));
    },
  );

  test('nothing is set below the 12px floor, and every size is a step of the ladder', () => {
    const px = [...strip(SQF_CSS).matchAll(/font(?:-size)?:[^;]*?(\d+)px/g)].map((m) => Number(m[1]));
    expect(px.filter((n) => n < 12)).toEqual([]);
    const sizes = [...strip(SQF_CSS).matchAll(/font-size:\s*([^;]+);/g)].map((m) => m[1].trim());
    expect(sizes.filter((s) => !/^var\(--sqf-t-(floor|label|body|head)\)$/.test(s))).toEqual([]);
  });

  test('inputs render at the body step, never at the label step', () => {
    // Every text field the survey form draws, including the shape the global
    // `.form-group input[type="text"]` rule (AIPromptManager.css, 14px) matches.
    const rules = [...strip(SQF_CSS).matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .map(([, head, body]) => [head.split(',').map((s) => s.trim()), body]);
    const sizeFor = (selector) => {
      const hit = rules.find(([heads, body]) => heads.includes(selector) && /font-size/.test(body));
      return hit ? hit[1].match(/font-size:\s*([^;]+);/)[1].trim() : null;
    };
    ['.sqf .form-input', '.sqf .form-select', '.sqf .form-group input[type="text"]', '.sqf .form-group select', '.sqf-num']
      .forEach((selector) => expect({ selector, size: sizeFor(selector) })
        .toEqual({ selector, size: 'var(--sqf-t-body)' }));
  });

  test('rows are 36px', () => {
    expect(SCOPE).toMatch(/--sqf-row-h:\s*36px/);
  });
});
