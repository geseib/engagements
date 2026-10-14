/* eslint-env node */
/**
 * skinHarness — the ONE door palette tests use to read colour values (TOOLING-BRIEF §2).
 *
 *   const H = require('../testing/skinHarness');
 *   H.SKINS                     // registry ids (config/skins.js), else the skin files present
 *   H.THEMES                    // ['dark', 'light']
 *   H.role('--accent-text', { skin: 'present', theme: 'dark' })   // '#9CBEF0'
 *   H.channel('--accent-rgb', { skin: 'classic' })                // [246, 169, 76]
 *   H.css('components/QuestionSetsPanel.css')                     // text, comments kept
 *   H.scopeVar(css, '.qsets {', '--qsets-rule', { skin, theme })  // var()/rgb(var()) resolved
 *   H.composite(['#0F1A2E', 'rgba(124,167,230,.16)'])             // the audit's bgOf, as arithmetic
 *   H.ratio(fg, bg); H.AA                                        // 4.5
 *   H.eachSkinTheme((skin, theme) => { … })                      // or describe.each(H.CASES)
 *
 * WHY IT RESOLVES THE CASCADE instead of grepping a block: after Phase 0a a role is not
 * written anywhere as a hex. It is `--accent-text: var(--sk-dark-accent-text)` in
 * styles/roles.css, the value lives on `:root[data-skin="present"]` in styles/skins/present.css,
 * and Classic is the bare-`:root` fallback. So role() builds the real element chain —
 *     <html data-theme="light" data-skin=SKIN class=PROFILE>   (public/index.html:2 is light)
 *       <div data-theme=THEME>
 *         <div data-surface="wall">                            (only with { surface: 'wall' })
 * — matches every top-level rule of the sources against it by specificity and order, and
 * resolves custom properties the way a browser does: a var() inside a custom property is
 * substituted ON THE ELEMENT THAT DECLARES IT and inherited as that value (the `--k` trap,
 * styles/stage.css:96-104). A skin value that reads a ROLE therefore resolves against the
 * <html> element's theme (paper), which is wrong for dusk — role() reproduces that bug
 * faithfully instead of hiding it, which is the point.
 *
 * BEFORE PHASE 0a there are no skin files: the sources are styles.css alone, SKINS is
 * ['classic'], and role('--primary', { theme: 'dark' }) is today's `#F6A94C`. Asking for a
 * skin with no values file throws — a test cannot pass "for both skins" by accident.
 *
 * Plain CommonJS, no dependencies, Node 18 (jest in the pipeline). Not under __tests__/,
 * where jest would run it as a suite.
 */
const fs = require('fs');
const path = require('path');

const AA = 4.5;
const THEMES = ['dark', 'light'];
const DUSK_FIELD = [15, 26, 46];

/* ---- colour: lin/lum/ratio/alphaOver/bgOf lifted verbatim from
        docs/design/admin-redesign/audit.html via references/testing-a-surface.md §1 ---- */
function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function lum(c) { return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]); }
function ratioRgb(a, b) {
  const la = lum(a); const lb = lum(b);
  const h = Math.max(la, lb); const l = Math.min(la, lb);
  return (h + 0.05) / (l + 0.05);
}
function alphaOver(fg, bg, a) { return fg.map((c, i) => c * a + bg[i] * (1 - a)); }
/* Walk UP compositing every alpha layer (DOM version, for tests that build real nodes). */
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
  if (!stack.length) return DUSK_FIELD.slice();
  let out = stack[stack.length - 1][0];
  for (let i = stack.length - 2; i >= 0; i -= 1) out = alphaOver(stack[i][0], out, stack[i][1]);
  return out;
}

const parseHex = (h) => {
  let s = String(h).trim().replace(/^#/, '');
  if (s.length === 3 || s.length === 4) s = s.split('').map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(s.substr(i, 2), 16));
};

/** Any CSS colour this repo writes -> { rgb: [r,g,b], a }. Throws on anything else. */
function parseColor(input) {
  if (Array.isArray(input)) return { rgb: input.slice(0, 3).map(Number), a: input.length > 3 ? Number(input[3]) : 1 };
  const s = String(input).trim();
  if (/^#[0-9a-f]{3,8}$/i.test(s)) {
    let h = s.slice(1);
    if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
    return { rgb: parseHex(h.slice(0, 6)), a: h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1 };
  }
  const m = s.match(/^rgba?\(\s*([^)]*)\)$/i);
  if (m) {
    const parts = m[1].replace(/\s*\/\s*/, ' / ').split(/[\s,]+/).filter((x) => x && x !== '/');
    const nums = parts.map((p) => (p.endsWith('%') ? parseFloat(p) / 100 : parseFloat(p)));
    if (nums.length < 3 || nums.slice(0, 3).some((n) => Number.isNaN(n))) throw new Error(`cannot parse colour "${s}"`);
    return { rgb: nums.slice(0, 3), a: nums.length > 3 ? nums[3] : 1 };
  }
  if (/^white$/i.test(s)) return { rgb: [255, 255, 255], a: 1 };
  if (/^black$/i.test(s)) return { rgb: [0, 0, 0], a: 1 };
  if (/^transparent$/i.test(s)) return { rgb: [0, 0, 0], a: 0 };
  throw new Error(`cannot parse colour "${s}" (resolve var() first: H.role / H.scopeVar)`);
}

const toRgb = (c) => (Array.isArray(c) && c.length === 3 && typeof c[0] === 'number' ? c : parseColor(c).rgb);
/** Contrast ratio of two opaque colours (hex strings, rgb() strings or [r,g,b]). */
function ratio(fg, bg) { return ratioRgb(toRgb(fg), toRgb(bg)); }

/**
 * Composite a paint stack, outermost first, exactly as bgOf walks it: collect layers from
 * the innermost outwards until the first opaque one, then lay them back down. Two audit
 * behaviours are kept on purpose so this and the DOM bgOf never disagree: with NO layer at
 * all the base is the dusk field; with only translucent layers the outermost one is taken
 * as-is (not composited over anything). Start a stack with an opaque ground.
 */
function composite(layers) {
  const parsed = layers.map(parseColor).filter((l) => l.a > 0);
  if (!parsed.length) return DUSK_FIELD.slice();
  let start = 0;
  for (let i = parsed.length - 1; i >= 0; i -= 1) if (parsed[i].a >= 0.999) { start = i; break; }
  let out = parsed[start].rgb.slice();
  for (let i = start + 1; i < parsed.length; i += 1) out = alphaOver(parsed[i].rgb, out, parsed[i].a);
  return out;
}
/** Ratio of a foreground over a composited stack: H.on(H.role('--text'), [bg, tint]). */
function on(fg, layers) { return ratioRgb(toRgb(fg), composite(layers)); }

/* --------------------------------------------------------- the cascade ---- */

function stripComments(css) { return css.replace(/\/\*[\s\S]*?\*\//g, ' '); }

/** Top-level style rules (at-rules skipped) -> [{ selectors[], decls: [{ prop, value, important }] }]. */
function parseRules(css) {
  const text = stripComments(css);
  const rules = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('{', i);
    if (open < 0) break;
    const prelude = text.slice(i, open).trim();
    let depth = 1; let j = open + 1;
    while (j < text.length && depth) { if (text[j] === '{') depth += 1; else if (text[j] === '}') depth -= 1; j += 1; }
    const body = text.slice(open + 1, j - 1);
    i = j;
    if (!prelude || prelude.startsWith('@')) continue;
    const decls = [];
    for (const raw of splitTop(body, ';')) {
      const m = raw.match(/^\s*(--[\w-]+)\s*:([\s\S]*)$/);
      if (!m) continue;
      let value = m[2].trim();
      const important = /!important\s*$/.test(value);
      value = value.replace(/!important\s*$/, '').trim();
      decls.push({ prop: m[1], value, important });
    }
    if (decls.length) rules.push({ selectors: splitTop(prelude, ',').map((s) => s.trim()).filter(Boolean), decls });
  }
  return rules;
}

function splitTop(s, sep) {
  const out = []; let depth = 0; let cur = ''; let q = null;
  for (const ch of s) {
    if (q) { cur += ch; if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === '(' || ch === '[') depth += 1;
    if (ch === ')' || ch === ']') depth -= 1;
    if (ch === sep && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** Parse one selector into compounds [{ tag, root, classes[], attrs[{name, value}], unsupported }] + combinators. */
function parseSelector(sel) {
  const parts = sel.replace(/\s*>\s*/g, ' > ').trim().split(/\s+/);
  const compounds = []; let combinator = ' ';
  for (const p of parts) {
    if (p === '>') { combinator = '>'; continue; }
    const c = { tag: null, root: false, classes: [], attrs: [], unsupported: false, combinator };
    combinator = ' ';
    const re = /^(\*|[a-zA-Z][\w-]*)|\.([\w-]+)|\[([\w-]+)(?:\s*=\s*["']?([^"'\]]*)["']?)?\]|(:root)\b|(:[\w-]+(?:\([^)]*\))?)|(#[\w-]+)/g;
    let consumed = 0; let m;
    while ((m = re.exec(p))) {
      if (m.index !== consumed) { c.unsupported = true; break; }
      consumed = re.lastIndex;
      if (m[1]) c.tag = m[1] === '*' ? null : m[1].toLowerCase();
      else if (m[2]) c.classes.push(m[2]);
      else if (m[3]) c.attrs.push({ name: m[3], value: m[4] });
      else if (m[5]) c.root = true;
      else if (m[6] || m[7]) c.unsupported = true;   // :hover, :not(), #id — never part of a role chain
    }
    if (consumed !== p.length) c.unsupported = true;
    compounds.push(c);
  }
  const spec = [0, 0, 0];
  for (const c of compounds) { spec[1] += c.classes.length + c.attrs.length + (c.root ? 1 : 0); spec[2] += c.tag ? 1 : 0; }
  return { compounds, spec };
}

function matchCompound(c, el) {
  if (c.unsupported) return false;
  if (c.root && !el.root) return false;
  if (c.tag && c.tag !== el.tag) return false;
  for (const k of c.classes) if (!el.classes.includes(k)) return false;
  for (const a of c.attrs) {
    if (!(a.name in el.attrs)) return false;
    if (a.value !== undefined && el.attrs[a.name] !== a.value) return false;
  }
  return true;
}

/** Does `sel` match chain[idx] (chain[0] is <html>)? Right-to-left, as a browser does. */
function matches(parsed, chain, idx) {
  const cs = parsed.compounds;
  function from(ci, ei) {
    if (!matchCompound(cs[ci], chain[ei])) return false;
    if (ci === 0) return true;
    if (cs[ci].combinator === '>') return ei > 0 && from(ci - 1, ei - 1);
    for (let k = ei - 1; k >= 0; k -= 1) if (from(ci - 1, k)) return true;
    return false;
  }
  return from(cs.length - 1, idx);
}

/* --------------------------------------------------------------- engine ---- */

function create(root) {
  const SRC = root || path.join(__dirname, '..');
  const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');
  const exists = (rel) => fs.existsSync(path.join(SRC, rel));

  const skinFiles = exists('styles/skins')
    ? fs.readdirSync(path.join(SRC, 'styles/skins')).filter((f) => /^[a-z][a-z0-9-]*\.css$/.test(f)).sort((a, b) => (a === 'classic.css' ? -1 : b === 'classic.css' ? 1 : a.localeCompare(b)))
    : [];
  const fileIds = skinFiles.map((f) => f.replace(/\.css$/, ''));

  /** Registry ids: config/skins.js, read as TEXT (an ES module jest need not import). */
  function registryIds() {
    if (!exists('config/skins.js')) return null;
    const ids = [...read('config/skins.js').matchAll(/\bid\s*:\s*['"]([a-z][a-z0-9-]{1,23})['"]/g)].map((m) => m[1]);
    return ids.length ? ids : null;
  }
  const SKINS = registryIds() || (fileIds.length ? fileIds : ['classic']);

  /** Cascade order = import order in index.jsx after Phase 0a: skin values, roles, styles.css. */
  const SOURCES = [...skinFiles.map((f) => `styles/skins/${f}`), ...(exists('styles/roles.css') ? ['styles/roles.css'] : []), 'styles.css'].filter(exists);
  let RULES = null;
  function rules() {
    if (RULES) return RULES;
    RULES = [];
    let order = 0;
    for (const src of SOURCES) {
      for (const r of parseRules(read(src))) {
        for (const sel of r.selectors) {
          const parsed = parseSelector(sel);
          RULES.push({ parsed, decls: r.decls, order: order += 1, source: src, selector: sel });
        }
      }
    }
    return RULES;
  }

  function chainFor(opts = {}) {
    const skin = opts.skin || 'classic';
    if (!SKINS.includes(skin)) throw new Error(`skin "${skin}" is not in the registry (${SKINS.join(', ')})`);
    if (skin !== 'classic' && !fileIds.includes(skin)) throw new Error(`skin "${skin}" has no styles/skins/${skin}.css yet`);
    const theme = opts.theme || 'dark';
    if (!THEMES.includes(theme)) throw new Error(`theme must be one of ${THEMES.join(', ')}`);
    const html = { tag: 'html', root: true, classes: opts.profile ? [opts.profile] : [], attrs: { 'data-theme': opts.htmlTheme || 'light', 'data-skin': skin } };
    const chain = [html, { tag: 'div', root: false, classes: [], attrs: { 'data-theme': theme } }];
    if (opts.surface) chain.push({ tag: 'div', root: false, classes: [], attrs: { 'data-surface': opts.surface } });
    return chain;
  }

  /** Computed custom properties of every element in the chain. */
  function computeChain(chain) {
    const all = rules();
    let inherited = {};
    const out = [];
    for (let idx = 0; idx < chain.length; idx += 1) {
      const declared = {};
      for (const r of all) {
        if (!matches(r.parsed, chain, idx)) continue;
        for (const d of r.decls) {
          const prev = declared[d.prop];
          const key = [d.important ? 1 : 0, ...r.parsed.spec, r.order];
          if (!prev || cmp(key, prev.key) >= 0) declared[d.prop] = { value: d.value, key, from: `${r.source} ${r.selector}` };
        }
      }
      const computed = Object.assign({}, inherited);
      const resolving = new Set();
      const done = {};
      const get = (name) => {
        if (name in done) return done[name];
        if (!(name in declared)) return inherited[name];
        if (resolving.has(name)) return undefined;     // cycle = invalid at computed-value time
        resolving.add(name);
        const v = substitute(declared[name].value, get);
        resolving.delete(name);
        done[name] = v;
        return v;
      };
      for (const name of Object.keys(declared)) {
        const v = get(name);
        if (v === undefined) delete computed[name]; else computed[name] = v;
      }
      out.push({ computed, declared });
      inherited = computed;
    }
    return out;
  }

  /** The resolved value of a role (or any custom property) for one skin x theme. */
  function role(name, opts = {}) {
    const chain = chainFor(opts);
    const levels = computeChain(chain);
    const v = levels[levels.length - 1].computed[name];
    if (v === undefined) {
      throw new Error(`${name} does not resolve for skin=${opts.skin || 'classic'} theme=${opts.theme || 'dark'} (sources: ${SOURCES.join(', ')})`);
    }
    return v;
  }

  /** Where a role's winning declaration came from — for failure messages and debugging. */
  function explain(name, opts = {}) {
    const levels = computeChain(chainFor(opts));
    for (let i = levels.length - 1; i >= 0; i -= 1) if (levels[i].declared[name]) return `${levels[i].declared[name].from} (element ${i})`;
    return null;
  }

  function channel(name, opts = {}) {
    const v = role(name, opts);
    const nums = v.match(/-?[\d.]+/g);
    if (!nums || nums.length < 3) throw new Error(`${name} = "${v}" is not a channel triple`);
    return nums.slice(0, 3).map(Number);
  }

  const css = (rel) => read(rel);

  /**
   * A scope-local custom property (e.g. --qsets-rule in `.qsets {`), with every var() it
   * reads resolved: scope-local names from the same block first, then roles for skin x theme.
   * `rgb(var(--slate-rgb) / .28)` comes back as `rgb(155 168 190 / .28)` — parseColor reads it.
   */
  function scopeVar(text, block, name, opts = {}) {
    const start = text.indexOf(block);
    if (start < 0) throw new Error(`no ${block} block`);
    const open = text.indexOf('{', start);
    let depth = 1; let j = open + 1;
    while (j < text.length && depth) { if (text[j] === '{') depth += 1; else if (text[j] === '}') depth -= 1; j += 1; }
    const body = stripComments(text.slice(open + 1, j - 1));
    const local = {};
    for (const raw of splitTop(body, ';')) {
      const m = raw.match(/^\s*(--[\w-]+)\s*:([\s\S]*)$/);
      if (m) local[m[1]] = m[2].trim();
    }
    if (!(name in local)) throw new Error(`${name} not declared in ${block}`);
    const levels = computeChain(chainFor(opts));
    const roles = levels[levels.length - 1].computed;
    const seen = new Set();
    const get = (n) => {
      if (n in local) {
        if (seen.has(n)) return undefined;
        seen.add(n);
        const v = substitute(local[n], get);
        seen.delete(n);
        return v;
      }
      return roles[n];
    };
    const v = get(name);
    if (v === undefined) throw new Error(`${name} in ${block} reads an undeclared custom property`);
    return v;
  }

  const CASES = [];
  for (const s of SKINS) for (const t of THEMES) if (s === 'classic' || fileIds.includes(s)) CASES.push([s, t]);
  function eachSkinTheme(fn) { for (const [s, t] of CASES) fn(s, t); }

  return {
    SRC, SKINS, THEMES, SOURCES, CASES, AA,
    role, explain, channel, css, scopeVar, eachSkinTheme,
    composite, on, ratio, parseColor, parseHex, lin, lum, alphaOver, bgOf,
    create,
  };
}

function cmp(a, b) { for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return a[i] - b[i]; return 0; }

/** Replace every var(--x[, fallback]) with get(--x) (or the fallback). undefined = invalid. */
function substitute(value, get) {
  let out = ''; let i = 0;
  while (i < value.length) {
    const k = value.indexOf('var(', i);
    if (k < 0) { out += value.slice(i); break; }
    out += value.slice(i, k);
    let depth = 1; let j = k + 4;
    while (j < value.length && depth) { if (value[j] === '(') depth += 1; else if (value[j] === ')') depth -= 1; j += 1; }
    const inner = value.slice(k + 4, j - 1);
    const comma = splitTop(inner, ',');
    const name = comma[0].trim();
    let v = get(name);
    if (v === undefined && comma.length > 1) v = substitute(comma.slice(1).join(',').trim(), get);
    if (v === undefined) return undefined;
    out += v;
    i = j;
  }
  return out.replace(/\s+/g, ' ').trim();
}

module.exports = create();
module.exports.create = create;
module.exports.parseSelector = parseSelector;
module.exports.parseRules = parseRules;
