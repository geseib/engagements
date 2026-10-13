/* eslint-env node */
/**
 * skinScan — THE ONE literal-colour / literal-font scanner of the site-skins work.
 *
 * Read by three callers, so they can never disagree about a count:
 *   - scripts/skins/measure.js        (re-derives docs/design/themes/INVENTORY.md)
 *   - scripts/skins/codemod.js        (lowers the allowance pragma it just earned)
 *   - __tests__/skinLiteralsPalette.test.js  (the build-failing gate, SPEC §7)
 * scripts/skins/lib/scan.js re-exports this file; there is no second copy.
 *
 * It lives under src/src/testing/ (not __tests__/, where jest would run it as a
 * suite) and is plain CommonJS with no dependencies, because jest loads it on
 * Node 18 in the pipeline. Regex over text, never postcss: a test must not be
 * able to break on a transitive dependency.
 *
 * The algorithm is TOOLING-BRIEF §1, unchanged:
 *   1. strip comments (keeping newlines, so line numbers survive);
 *   2. split on ; { } — a piece that starts `--name:` is a TOKEN declaration,
 *      anything else a RULE declaration;
 *   3. colour literal = #hex(3..8) | rgb[a]( | hsl[a]( — except rgb(var(--x-rgb) / a)
 *      — plus the words white / black as a value;
 *   4. font literal = a font-family whose value is not var(…)/inherit, or a font:
 *      shorthand naming a family outside var().
 */

const HEX_RE = /#[0-9a-fA-F]{3,8}\b/g;
const FUNC_RE = /\b(rgba?|hsla?)\(/g;
const CHANNEL_RE = /^rgba?\(\s*var\(--[\w-]+-rgb\)/; // rgb(var(--slate-rgb) / .28) is allowed
const NAMED_RE = /(^|[\s:,(])(white|black)(?=$|[\s,;)!])/gi;
const FAMILY_WORDS = /\b(monospace|serif|sans-serif|system-ui|cursive|fantasy|Georgia|Menlo|Monaco|Consolas|Courier|Helvetica|Arial|Inter|Archivo|SFMono-Regular|ui-monospace|-apple-system|BlinkMacSystemFont|Segoe UI|Roboto|Times)\b/;

/** Replace every comment by spaces, keeping newlines so offsets and lines survive. */
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

/** 1-based line of an offset. */
function lineAt(text, offset) {
  let n = 1;
  for (let i = 0; i < offset && i < text.length; i += 1) if (text.charCodeAt(i) === 10) n += 1;
  return n;
}

/**
 * Split stripped CSS into pieces with their start offset and kind.
 * kind: 'token' (a --custom-property declaration), 'rule' (anything else).
 * The selector that governs a piece is tracked so reports can name it.
 */
function pieces(stripped) {
  const out = [];
  const stack = [];
  let start = 0;
  for (let i = 0; i <= stripped.length; i += 1) {
    const ch = stripped[i];
    if (i === stripped.length || ch === ';' || ch === '{' || ch === '}') {
      const text = stripped.slice(start, i);
      if (text.trim()) {
        if (ch === '{') {
          // a selector or at-rule prelude: record as the governing context
          stack.push(text.trim().replace(/\s+/g, ' '));
          out.push({ text, start, kind: 'prelude', selector: stack.slice(0, -1).join(' » ') });
        } else {
          out.push({
            text,
            start,
            kind: /^\s*--[\w-]+\s*:/.test(text) ? 'token' : 'rule',
            selector: stack.join(' » '),
          });
        }
      } else if (ch === '{') {
        stack.push('');
      }
      if (ch === '}') stack.pop();
      start = i + 1;
    }
  }
  return out;
}

/** Every colour literal in one piece of text: [{ literal, index }]. */
function colourLiterals(text) {
  const found = [];
  for (const m of text.matchAll(HEX_RE)) found.push({ literal: m[0], index: m.index });
  for (const m of text.matchAll(FUNC_RE)) {
    const rest = text.slice(m.index);
    if (CHANNEL_RE.test(rest)) continue;
    const close = matchParen(text, m.index + m[0].length - 1);
    found.push({ literal: text.slice(m.index, close + 1), index: m.index });
  }
  // the named words only count as a VALUE (after the colon)
  const colon = text.indexOf(':');
  if (colon >= 0) {
    const value = text.slice(colon + 1);
    for (const m of value.matchAll(NAMED_RE)) {
      found.push({ literal: m[2], index: colon + 1 + m.index + m[1].length, named: true });
    }
  }
  return found.sort((a, b) => a.index - b.index);
}

function matchParen(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')') { depth -= 1; if (depth === 0) return i; }
  }
  return text.length - 1;
}

/** Is this declaration a literal font family? Returns the value or null. */
function fontLiteral(text) {
  const m = text.match(/^\s*(font-family|font)\s*:\s*([\s\S]*)$/i);
  if (!m) return null;
  const prop = m[1].toLowerCase();
  const value = m[2].trim();
  if (prop === 'font-family') {
    if (/^(var\(|inherit\b)/i.test(value)) return null;
    return value;
  }
  // font: shorthand — a quoted family, or a family word, outside var()
  const outside = value.replace(/var\([^)]*\)/g, '');
  if (/["']/.test(outside) || FAMILY_WORDS.test(outside)) return value;
  return null;
}

/**
 * Scan one stylesheet. Returns every finding with its line, so a report and a
 * gate message can name the place, plus the counts measure.js prints.
 *   opts.from / opts.to — 1-based inclusive line window (a styles.css unit)
 */
function scanCss(css, opts = {}) {
  const stripped = stripComments(css);
  const from = opts.from || 1;
  const to = opts.to || Infinity;
  const findings = [];
  for (const p of pieces(stripped)) {
    if (p.kind === 'prelude') continue;
    const lead = p.text.length - p.text.replace(/^\s+/, '').length;
    const line = lineAt(stripped, p.start + lead);
    if (line < from || line > to) continue;
    const decl = p.text.trim();
    const prop = (decl.match(/^([\w-]+)\s*:/) || [])[1] || '';
    for (const c of colourLiterals(p.text)) {
      findings.push({
        type: 'colour', kind: p.kind, literal: c.literal, line: lineAt(stripped, p.start + c.index),
        selector: p.selector, property: prop, declaration: decl, named: !!c.named,
      });
    }
    const f = fontLiteral(p.text);
    if (f) {
      findings.push({
        type: 'font', kind: p.kind, literal: f, line, selector: p.selector, property: prop, declaration: decl,
        shorthand: prop.toLowerCase() === 'font',
      });
    }
    for (const m of p.text.matchAll(/var\(\s*--(primary(?:-deep)?|secondary)\b/g)) {
      findings.push({
        type: m[1] === 'secondary' ? 'secondary' : 'primary', kind: p.kind, literal: m[0],
        line: lineAt(stripped, p.start + m.index), selector: p.selector, property: prop, declaration: decl,
      });
    }
  }
  return { findings, counts: countsOf(findings, css, opts) };
}

function countsOf(findings, css, opts = {}) {
  const c = {
    lines: opts.from ? Math.min(opts.to, css.split('\n').length) - opts.from + 1 : css.split('\n').length,
    ruleLiterals: 0, declLiterals: 0, namedLiterals: 0, fontLiterals: 0, fontShorthand: 0,
    primary: 0, secondary: 0, amberTints: 0, blueTints: 0,
  };
  for (const f of findings) {
    if (f.type === 'colour') {
      if (f.named) c.namedLiterals += 1;
      else if (f.kind === 'token') c.declLiterals += 1;
      else c.ruleLiterals += 1;
      const norm = f.literal.replace(/\s+/g, '');
      if (/^rgba\(246,169,76,/.test(norm)) c.amberTints += 1;
      if (/^rgba\(124,167,230,/.test(norm)) c.blueTints += 1;
    } else if (f.type === 'font') {
      if (f.shorthand) c.fontShorthand += 1; else c.fontLiterals += 1;
    }
    else if (f.type === 'primary') c.primary += 1;
    else if (f.type === 'secondary') c.secondary += 1;
  }
  // The GATE's numbers (SPEC §7) count everything: the named words and the font:
  // shorthand too. INVENTORY.md's columns (ruleLiterals, declLiterals,
  // fontLiterals) were measured without them; both are kept so measure.js can
  // reproduce the inventory exactly and the gate can still see every literal.
  c.colour = c.ruleLiterals + c.declLiterals + c.namedLiterals;
  c.font = c.fontLiterals + c.fontShorthand;
  c.primaryReads = c.primary + c.secondary;
  return c;
}

/* ---------------------------------------------------------------- JSX ---- */

/**
 * JSX/JS literals: quoted colour literals (in '…', "…" or `…`) and
 * fill= / stroke= attributes with a literal colour. Comments are stripped first.
 */
function stripJsComments(src) {
  // conservative: block comments, and line comments that start a line or follow whitespace
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[\s;{}(),])\/\/[^\n]*/g, (m, lead) => lead + ' '.repeat(m.length - lead.length));
}

function scanJsx(src) {
  const stripped = stripJsComments(src);
  const findings = [];
  const QUOTED = /(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g;
  for (const q of stripped.matchAll(QUOTED)) {
    const body = q[2];
    const hits = [];
    for (const m of body.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
      // '#abc' alone or inside a style value; skip URL fragments like '/x#abc'
      if (m.index > 0 && /[\w/]/.test(body[m.index - 1])) continue;
      hits.push(m[0]);
    }
    for (const m of body.matchAll(/\b(rgba?|hsla?)\(/g)) {
      if (CHANNEL_RE.test(body.slice(m.index))) continue;
      hits.push(body.slice(m.index, matchParen(body, m.index + m[0].length - 1) + 1));
    }
    if (/^(white|black)$/i.test(body.trim())) hits.push(body.trim());
    for (const h of hits) findings.push({ type: 'colour', literal: h, line: lineAt(stripped, q.index) });
  }
  // fill={"#fff"} is caught above; fill="white" too. Nothing else to add.
  const dataSkin = [...stripped.matchAll(/data-skin\b|dataset\.skin\b/g)].map((m) => lineAt(stripped, m.index));
  return { findings, counts: { colour: findings.length }, dataSkinLines: dataSkin };
}

/* ----------------------------------------------------------- pragmas ---- */

const FILE_PRAGMA_RE = /\/\*\s*skin-allowance:\s*([^*]*?)\*\//;
const UNIT_PRAGMA_RE = /\/\*\s*skin-allowance\s+(SC-\d\d):\s*([^*]*?)\*\//g;
const JSX_PRAGMA_RE = /\/\/\s*skin-allowance:\s*(.*)$/m;

function parseFields(text) {
  const out = {};
  for (const m of text.matchAll(/(colour|font|primary)\s*=\s*(\d+)/g)) out[m[1]] = Number(m[2]);
  return out;
}

/** The file-level pragma, only if it sits in the FIRST comment block. */
function filePragma(css) {
  const first = css.match(/^\s*(\/\*[\s\S]*?\*\/)/);
  if (!first) return null;
  const m = first[1].match(FILE_PRAGMA_RE);
  return m ? parseFields(m[1]) : null;
}

/** styles.css: one marker per unit; each governs lines to the next marker. */
function unitPragmas(css) {
  const out = [];
  for (const m of css.matchAll(UNIT_PRAGMA_RE)) {
    out.push({ unit: m[1], fields: parseFields(m[2]), line: lineAt(css, m.index) });
  }
  const total = css.split('\n').length;
  out.forEach((u, i) => { u.from = u.line; u.to = i + 1 < out.length ? out[i + 1].line - 1 : total; });
  return out;
}

function jsxPragma(src) {
  const m = src.match(JSX_PRAGMA_RE);
  return m ? parseFields(m[1]) : null;
}

function formatFields(f) {
  const parts = [`colour=${f.colour || 0}`, `font=${f.font || 0}`];
  if (f.primary) parts.push(`primary=${f.primary}`);
  return parts.join(' ');
}

module.exports = {
  stripComments, stripJsComments, lineAt, pieces, colourLiterals, fontLiteral,
  scanCss, scanJsx, countsOf,
  filePragma, unitPragmas, jsxPragma, parseFields, formatFields,
  FILE_PRAGMA_RE, UNIT_PRAGMA_RE, JSX_PRAGMA_RE,
};
