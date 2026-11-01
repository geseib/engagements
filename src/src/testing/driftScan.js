/* eslint-env node */
/**
 * THE DRIFT SCANNER (docs/design/experience-plan/PLAN.md §5.3, Phase 0).
 *
 * One scanner for the experience-plan ratchets, shared by the jest guards
 * (src/src/__tests__/driftRatchets.test.js and helpTruth.test.js; colour literals are
 * skinLiteralsPalette.test.js) and by `node scripts/drift-baselines.js`, so the
 * numbers a reviewer reads are the numbers the gate holds. Each guard counts one kind
 * of drift per file; src/src/testing/driftAllowances.js records the count each file may
 * have, and the guards fail in both directions, like the skins gate
 * (__tests__/skinLiteralsPalette.test.js):
 *   count > allowance  ->  fail: "N new <thing> in X", with each one's line and the fix
 *   count < allowance  ->  fail: "lower X's allowance to N", so an allowance never goes stale
 *
 * What it reads: JavaScript through @babel/parser (so comments and identifiers never
 * count), and CSS through the skins scanner's comment stripper. Tests are never scanned:
 * __tests__/, testing/, *.test.js(x), *.spec.js(x) and setupTests.js are skipped.
 *
 * Plain CommonJS on purpose: the node script requires it without babel.
 */
const fs = require('fs');
const path = require('path');
const { parse } = require('@babel/parser');
const { stripComments, lineAt } = require('./skinScan');

const SRC = path.join(__dirname, '..');

/* ------------------------------------------------------------- files ---- */

const SKIP_DIRS = ['node_modules', '__tests__', 'testing'];
const isTestFile = (r) => /\.(test|spec)\.(jsx?|mjs)$/.test(r) || /(^|\/)setupTests\.js$/.test(r);

function walk(dir, pred, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.includes(e.name)) continue;
      walk(p, pred, out);
    } else if (pred(p)) out.push(p);
  }
  return out;
}
const rel = (p) => path.relative(SRC, p).split(path.sep).join('/');
const read = (r) => fs.readFileSync(path.join(SRC, r), 'utf8');

/** Every application script under src/src, relative and sorted. */
function jsFiles() {
  return walk(SRC, (p) => /\.(jsx?|mjs)$/.test(p)).map(rel).filter((r) => !isTestFile(r)).sort();
}
/** Every stylesheet under src/src except the skin values files (they ARE the values). */
function cssFiles() {
  return walk(SRC, (p) => p.endsWith('.css')).map(rel).filter((r) => !r.startsWith('styles/skins/')).sort();
}

/* ----------------------------------------------------------- the AST ---- */

const astCache = new Map();
function ast(r, src) {
  const key = r + '\0' + src.length;
  if (astCache.has(key)) return astCache.get(key);
  const tree = parse(src, {
    sourceType: 'unambiguous',
    errorRecovery: true,
    plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator', 'dynamicImport', 'topLevelAwait'],
  });
  astCache.set(key, tree);
  return tree;
}

/** Visit every node, depth first, with its parent and the chain of ancestors (nearest last). */
function visit(node, fn, parent = null, anc = []) {
  if (!node || typeof node.type !== 'string') return;
  fn(node, parent, anc);
  anc.push(node);
  for (const k of Object.keys(node)) {
    if (k === 'loc' || k === 'leadingComments' || k === 'trailingComments' || k === 'innerComments' || k === 'extra') continue;
    const v = node[k];
    if (Array.isArray(v)) { for (const c of v) if (c && typeof c.type === 'string') visit(c, fn, node, anc); }
    else if (v && typeof v.type === 'string') visit(v, fn, node, anc);
  }
  anc.pop();
}

/* ------------------------------------------- guard: browser dialogs ---- */

const DIALOG_NAMES = ['alert', 'confirm'];

/**
 * Calls to the browser's own alert/confirm: `alert(…)`, `confirm(…)`, `window.alert(…)`,
 * `window.confirm(…)` (also via globalThis/self). A bare `confirm(…)` does not count when
 * the file binds its own `confirm` (a hook's function, a parameter), since that is not
 * the browser's dialog.
 */
function scanDialogs(src, r = 'x.js') {
  const tree = ast(r, src);
  const bound = new Set();
  visit(tree, (n) => {
    if ((n.type === 'VariableDeclarator' || n.type === 'FunctionDeclaration') && n.id) collectIds(n.id, bound);
    if (/Function/.test(n.type) && n.params) n.params.forEach((p) => collectIds(p, bound));
    if (n.type === 'ImportSpecifier' || n.type === 'ImportDefaultSpecifier') bound.add(n.local.name);
  });
  const found = [];
  visit(tree, (n) => {
    if (n.type !== 'CallExpression' && n.type !== 'OptionalCallExpression') return;
    const c = n.callee;
    let name = null;
    if (c.type === 'Identifier' && DIALOG_NAMES.includes(c.name) && !bound.has(c.name)) name = c.name;
    if ((c.type === 'MemberExpression' || c.type === 'OptionalMemberExpression') && !c.computed
      && c.object.type === 'Identifier' && ['window', 'globalThis', 'self'].includes(c.object.name)
      && DIALOG_NAMES.includes(c.property.name)) name = `${c.object.name}.${c.property.name}`;
    if (name) found.push({ line: n.loc.start.line, literal: `${name}(` });
  });
  return found;
}
function collectIds(p, out) {
  if (!p) return;
  if (p.type === 'Identifier') out.add(p.name);
  else if (p.type === 'ObjectPattern') p.properties.forEach((q) => collectIds(q.value || q.argument, out));
  else if (p.type === 'ArrayPattern') p.elements.forEach((q) => collectIds(q, out));
  else if (p.type === 'AssignmentPattern') collectIds(p.left, out);
  else if (p.type === 'RestElement') collectIds(p.argument, out);
}

/* ---------------------------------------------- guard: close glyph ---- */

const CLOSE_GLYPHS = ['×', '✕', '✖', '╳'];

/**
 * A JSX element whose whole text is a close glyph: <button>×</button>, <span>✕</span>,
 * <button>{'×'}</button>, `&times;` (babel decodes it to ×). The glyph inside a
 * sentence ("2 × 3") does not count; only an element that holds the glyph alone.
 */
function scanCloseGlyphs(src, r = 'x.jsx') {
  const tree = ast(r, src);
  const found = [];
  visit(tree, (n) => {
    if (n.type !== 'JSXElement') return;
    const kids = n.children.filter((k) => !(k.type === 'JSXText' && !k.value.trim()));
    if (kids.length !== 1) return;
    const k = kids[0];
    let text = null;
    if (k.type === 'JSXText') text = k.value.trim();
    if (k.type === 'JSXExpressionContainer' && k.expression.type === 'StringLiteral') text = k.expression.value.trim();
    if (text && CLOSE_GLYPHS.includes(text)) {
      const tag = n.openingElement.name.name || 'element';
      found.push({ line: n.loc.start.line, literal: `<${tag}>${text}</${tag}>` });
    }
  });
  return found;
}

/* -------------------------------------------- guard: button classes ---- */

/**
 * A BUTTON CLASS is a class selector whose name has `btn`, `button` or `buttons` as one
 * of its hyphen/underscore-separated words (`.btn`, `.qsets-btn--primary`,
 * `.start-button-row`).
 *
 * Its FAMILY is the name up to and including that first btn/button word; everything
 * after it (a variant, a BEM --modifier or __element) is a member of the family:
 *   .qsets-btn--primary  .qsets-btn-ghost  -> qsets-btn
 *   .btn  .btn-secondary  .btn--sm         -> btn
 *   .um-row__button--danger                -> um-row__button
 * Simple on purpose: it over-counts a little (a layout class like .button-row is a
 * family of its own) and that is fine for a number that may only fall.
 *
 * A PRIMARY CLASS is a button class with a later `primary` word, written either way the
 * plan names: `*btn*--primary` or `*-btn-primary` (also `button`).
 */
const BTN_WORD = /^(btn|button|buttons)$/i;

function buttonFamily(name) {
  const words = name.split(/(--|__|-|_)/); // keeps separators
  for (let i = 0; i < words.length; i += 2) {
    if (BTN_WORD.test(words[i])) return words.slice(0, i + 1).join('');
  }
  return null;
}
function isPrimaryClass(name) {
  return /(^|[-_])(btn|button)s?([-_][\w]+?)*?(--|[-_])primary($|[-_])/i.test(name) && buttonFamily(name) !== null;
}

/** Class names declared in a stylesheet's selectors, with their line. */
function cssClasses(css) {
  const text = stripComments(css);
  const out = [];
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '{') {
      const prelude = text.slice(start, i);
      if (!/^\s*@/.test(prelude)) {
        for (const m of prelude.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)) {
          out.push({ name: m[1], line: lineAt(text, start + m.index) });
        }
      }
      start = i + 1;
    } else if (ch === '}' || ch === ';') start = i + 1;
  }
  return out;
}

function scanButtonClasses(css) {
  const families = new Set();
  const primaries = new Map();
  for (const c of cssClasses(css)) {
    const fam = buttonFamily(c.name);
    if (!fam) continue;
    families.add(fam);
    if (isPrimaryClass(c.name) && !primaries.has(c.name)) primaries.set(c.name, c.line);
  }
  return {
    families: [...families].sort(),
    primaries: [...primaries].map(([name, line]) => ({ line, literal: `.${name}` })),
  };
}

/* --------------------------------------------- guard: banned words ---- */

/**
 * The right-hand column of PLAN §3.6, as data. Each entry is one replaced label, the
 * word that replaces it, and how to match it:
 *   phrase  the words anywhere in a piece of text (word-bounded; `cs` = case-sensitive)
 *   label   the WHOLE text is that word (after trimming arrows, ellipses and colons).
 *           Used for words too common to ban outright ("Settings", "Results", "stage"):
 *           only a button or heading that says just that word counts.
 * Not guarded, on purpose: "engagement" (New engagement keeps it), "screen" inside a
 * sentence (the approved term is "the room's screen"), "Join 1234" (always a template).
 */
const BANNED_WORDS = [
  // Main menu
  { say: 'Main menu', not: 'Back to Menu', re: /\bback to menu\b/i },
  { say: 'Main menu', not: 'All sessions', re: /\ball sessions\b/i },
  { say: 'Main menu', not: 'Main screen', re: /\bmain screen\b/i },
  { say: 'Main menu', not: 'Back to the console', re: /\bback to the console\b/i },
  // Agenda
  { say: 'Agenda', not: 'Back to the agenda', re: /\bback to the agenda\b/i },
  // Session menu
  { say: 'Session menu', not: 'SESSION', re: /(^|[^\w-])SESSION([^\w-]|$)/ },
  { say: 'Session menu', not: 'Session setup', re: /\bsession setup\b/i },
  { say: 'Session menu', not: 'Session panel', re: /\bsession panel\b/i },
  { say: 'Session menu', not: 'Session tools', re: /\bsession tools\b/i },
  { say: 'Session menu', not: 'All settings', re: /\ball settings\b/i },
  { say: 'Session menu', not: 'Settings', label: 'Settings' },
  // People
  { say: 'People', not: 'Players', label: 'Players' },
  { say: 'People', not: 'All players', re: /\ball players\b/i },
  { say: 'People', not: 'Joined so far', re: /\bjoined so far\b/i },
  { say: 'People', not: 'Players & rounds', re: /\bplayers (&|and) rounds\b/i },
  // The room's screen
  { say: 'The room\'s screen', not: 'big screen', re: /\bbig screen\b/i },
  { say: 'The room\'s screen', not: 'projector', re: /\bprojector\b/i },
  { say: 'The room\'s screen', not: 'Presentation', re: /\bPresentation\b/ },
  { say: 'The room\'s screen', not: 'PRESENT', re: /\bPRESENT(ING)?\b/ },
  { say: 'The room\'s screen', not: 'stage', label: 'stage' },
  { say: 'The room\'s screen', not: 'wall', label: 'wall' },
  { say: 'The room\'s screen', not: 'screen', label: 'screen' },
  // Show join code / Hide join code
  { say: 'Show join code', not: 'Put the join code back on the stage', re: /\bput the join code back on the stage\b/i },
  { say: 'Show join code', not: 'Display on screen', re: /\bdisplay on screen\b/i },
  { say: 'Show join code', not: 'Show QR', re: /\b(show|hide) QR\b/i },
  // Workie's read
  { say: 'Workie\'s read', not: 'AI summary', re: /\bAI summary\b/i },
  { say: 'Workie\'s read', not: 'the summary', re: /\bthe summary\b/i },
  // Session
  { say: 'Session', not: 'Game ID', re: /\bgame id\b/i },
  { say: 'Session', not: 'Join Game', re: /\bjoin game\b/i },
  { say: 'Session', not: 'game', re: /(?<![\w-])games?(?![\w-])/i },
  // Reports
  { say: 'Reports', not: 'Your reports', re: /\byour reports\b/i },
  { say: 'Reports', not: 'Session reports', re: /\bsession reports\b/i },
  { say: 'Reports', not: 'Results', label: 'Results' },
  // Comments
  { say: 'Comment on this round', not: 'Feedback', label: 'Feedback' },
  { say: 'Comment on this round', not: 'Comment', label: 'Comment' },
  // Moving a name
  { say: 'Use my name on this device', not: 'Ask the host to hand it over', re: /\bask the host to hand it over\b/i },
  { say: 'Use my name on this device', not: 'Take over the name', re: /\btake over the name\b/i },
  { say: 'wants their name on a new device', not: 'Asking to take this name', re: /\basking to take this name\b/i },
  { say: 'wants their name on a new device', not: 'Unlock name', re: /\bunlock name\b/i },
];

/**
 * The allow-list. Text that says a label CHANGED may name the old one ("the Session
 * menu, which used to be called SESSION"): help's "what changed" notes.
 */
const WHAT_CHANGED = /\b(used to (say|be called|read)|was called|were called|formerly|renamed|now called|no longer (says|called))\b/i;

/** Which files the banned-words guard reads: every .jsx, and the words/config files. */
function isWordsFile(r) {
  return r.endsWith('.jsx') || r.startsWith('config/') || /words?\.js$/i.test(r) || /Words\.js$/.test(r);
}

const labelOf = (t) => t.replace(/\s+/g, ' ').trim().replace(/^[←→‹›«»<>·•\s]+|[←→‹›«»<>·•…:.\s]+$/g, '');

/*
 * Which text is USER-FACING. All JSX text is. A string literal or template piece is
 * when it reads like words, i.e. it has a capital letter or a space between letters
 * ('game', '/games/', 'qsets-btn' are code, 'Back to Menu' is not), and it is not in a
 * place that only code reads: an attribute or object key below, a comparison
 * (`phase === 'Results'`), a switch case, an import or require.
 */
const CODE_ATTRS = /^(className|class|id|key|type|name|role|htmlFor|href|src|rel|target|method|action|data-[\w-]+|testid|data-testid|autoComplete|inputMode|lang|dir|form|accept|pattern|encType|viewBox|d|fill|stroke|xmlns|style)$/;
const CODE_KEYS = /^(className|class|id|key|type|kind|phase|icon|href|path|url|route|to|src|testid|tab|view|mode|status|method|action|role|variant|look|size|tone|level)$/;

function isCodePlace(n, parent, anc) {
  if (!parent) return false;
  if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(parent.type)) return true;
  if ((parent.type === 'ObjectProperty' || parent.type === 'ClassProperty') && parent.key === n) return true;
  if (parent.type === 'ObjectProperty' && parent.value === n && !parent.computed && parent.key && CODE_KEYS.test(parent.key.name || parent.key.value || '')) return true;
  if (parent.type === 'BinaryExpression' && /^[!=]==?$/.test(parent.operator)) return true;
  if (parent.type === 'SwitchCase' && parent.test === n) return true;
  if (parent.type === 'MemberExpression' && parent.property === n) return true;
  if (parent.type === 'CallExpression' && parent.callee.type === 'Identifier' && parent.callee.name === 'require') return true;
  for (let i = anc.length - 1; i >= 0; i -= 1) {
    const a = anc[i];
    if (a.type === 'CallExpression' && a.callee.type === 'MemberExpression' && a.callee.object.type === 'Identifier' && a.callee.object.name === 'console') return true;
    if (a.type === 'JSXAttribute') return CODE_ATTRS.test(a.name.name && (a.name.name.name || a.name.name));
    if (a.type === 'JSXElement' || a.type === 'Program') break;
  }
  return false;
}
const readsLikeWords = (t) => /[A-Z]/.test(t) || /[A-Za-z]\s+[A-Za-z]/.test(t);

/** Every piece of user-facing text in a file: JSX text, and string or template text that reads like words. */
function texts(src, r) {
  const tree = ast(r, src);
  const out = [];
  visit(tree, (n, parent, anc) => {
    if (n.type === 'JSXText') { if (n.value.trim()) out.push({ text: n.value, line: n.loc.start.line }); return; }
    let text = null;
    if (n.type === 'StringLiteral') text = n.value;
    else if (n.type === 'TemplateElement') text = n.value.cooked;
    else return;
    if (!text || !text.trim() || !readsLikeWords(text)) return;
    const owner = n.type === 'TemplateElement' ? anc[anc.length - 1] : n; // the TemplateLiteral
    const ownerParent = n.type === 'TemplateElement' ? anc[anc.length - 2] : parent;
    if (isCodePlace(owner, ownerParent, n.type === 'TemplateElement' ? anc.slice(0, -1) : anc)) return;
    out.push({ text, line: n.loc.start.line });
  });
  return out;
}

/** Banned-word occurrences in one file: [{ line, literal, not, say }]. */
function scanBannedWords(src, r = 'x.jsx') {
  const found = [];
  for (const t of texts(src, r)) {
    if (WHAT_CHANGED.test(t.text)) continue;
    for (const w of BANNED_WORDS) {
      if (w.label) {
        const l = labelOf(t.text);
        const shouting = l === l.toUpperCase() && w.label !== w.label.toUpperCase(); // a constant, not a label
        if (!shouting && l.toLowerCase() === w.label.toLowerCase()) found.push({ line: t.line, literal: l, not: w.not, say: w.say });
      } else {
        const g = new RegExp(w.re.source, w.re.flags.includes('g') ? w.re.flags : w.re.flags + 'g');
        for (const m of t.text.matchAll(g)) found.push({ line: t.line, literal: m[0].trim(), not: w.not, say: w.say });
      }
    }
  }
  return found;
}

/** Group banned-word occurrences by the replaced label: { 'Back to Menu': 2, … }. */
function bannedCounts(found) {
  const c = {};
  for (const f of found) c[f.not] = (c[f.not] || 0) + 1;
  return c;
}

/* ------------------------------------------------ guard: help truth ---- */

/**
 * Help sentences known to describe a control that does not do what they say. Each one is
 * a regex over help text and the reason it is false. Phase 1a fixes the first; the count
 * may only fall, and a new false claim found later is added here with its reason.
 */
const FALSE_HELP_CLAIMS = [
  {
    id: 'session-dock-count',
    re: /\*\*SESSION\*\*[^.]*\b(shows|carries) a (count|number)\b/i,
    why: 'SESSION on the dock shows no count on Call & Answer, and on two screens there is no dock (PLAN §1 #1; audit A §2.3). Phase 1a replaces it with the Needs-you line.',
  },
];

function scanHelpClaims(src, r) {
  const found = [];
  for (const t of texts(src, r)) {
    for (const c of FALSE_HELP_CLAIMS) if (c.re.test(t.text)) found.push({ line: t.line, literal: c.id, why: c.why });
  }
  return found;
}

/* ------------------------------------------------- the ratchet ---- */

/**
 * One per-file ratchet check: returns problem strings (empty = green).
 * `what` names the thing counted ("browser dialog(s)"); `fix` is the sentence saying how
 * to remove one; `allowanceKey` is where the number lives in driftAllowances.js.
 */
function ratchet({ file, found, allowed, what, fix, allowanceKey }) {
  const have = found.length;
  const a = allowed || 0;
  if (have > a) {
    const list = found.map((f) => `    line ${f.line}  ${f.literal}${f.not ? `  (say "${f.say}")` : ''}`).join('\n');
    return [`${have - a} new ${what} in ${file} (allowance ${a}, found ${have}):\n${list}\n  fix: ${fix}`];
  }
  if (have < a && have === 0) {
    return [`remove ${file} from src/src/testing/driftAllowances.js → ${allowanceKey} (it says ${a}, and none are left). \`node scripts/drift-baselines.js --module\` prints the whole file at today's counts.`];
  }
  if (have < a) {
    return [`lower ${file}'s allowance to ${have} in src/src/testing/driftAllowances.js → ${allowanceKey} (it says ${a}). Nice: one fewer. \`node scripts/drift-baselines.js\` prints every current count.`];
  }
  return [];
}

/* --------------------------------------------- today's numbers ---- */

/** Every guard's count per file, as driftAllowances.js records them. */
function measure() {
  const js = jsFiles();
  const out = { dialogs: {}, closeGlyphs: {}, primaryButtons: {}, buttonFamilies: 0, bannedWords: {}, helpFalseClaims: {} };
  for (const r of js) {
    const src = read(r);
    const d = scanDialogs(src, r).length;
    if (d) out.dialogs[r] = d;
    if (r.endsWith('.jsx')) {
      const g = scanCloseGlyphs(src, r).length;
      if (g) out.closeGlyphs[r] = g;
    }
    if (isWordsFile(r)) {
      const b = bannedCounts(scanBannedWords(src, r));
      if (Object.keys(b).length) out.bannedWords[r] = sortKeys(b);
    }
    if (r.startsWith('config/help/')) {
      const h = scanHelpClaims(src, r).length;
      if (h) out.helpFalseClaims[r] = h;
    }
  }
  const families = new Set();
  for (const r of cssFiles()) {
    const { families: f, primaries } = scanButtonClasses(read(r));
    f.forEach((x) => families.add(x));
    if (primaries.length) out.primaryButtons[r] = primaries.length;
  }
  out.buttonFamilies = families.size;
  out.buttonFamilyNames = [...families].sort();
  return out;
}
const sortKeys = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));

module.exports = {
  SRC, jsFiles, cssFiles, read, isWordsFile,
  scanDialogs, scanCloseGlyphs, scanButtonClasses, buttonFamily, isPrimaryClass, cssClasses,
  scanBannedWords, bannedCounts, BANNED_WORDS, WHAT_CHANGED, labelOf,
  scanHelpClaims, FALSE_HELP_CLAIMS,
  ratchet, measure,
};
