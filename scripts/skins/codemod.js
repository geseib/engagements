#!/usr/bin/env node
/**
 * codemod.js — move one stylesheet (or one styles.css unit) from literals to roles.
 *
 * It NEVER decides an accent-vs-action question on its own (SPEC §4.4). Two modes:
 *
 *   --report  lists every literal and every var(--primary…)/var(--secondary) with line,
 *             selector, property and a PROPOSAL, and writes
 *             docs/design/themes/records/<unit>.decisions.json:
 *               auto[]    applied without asking — an exact, unambiguous role match
 *                         (rgba(155,168,190,.20) on a rule -> var(--rule)) or a channel form
 *                         of a status/slate tint (rgba(229,100,94,.55) -> rgb(var(--danger-rgb) / .55)).
 *                         Both are pixel-identical in Classic by construction.
 *               decide[]  one entry per judgement, `choice: null`. Every --primary/--secondary,
 *                         every amber/blue tint, every literal with no unique match, every font.
 *   --apply   applies auto[] and every filled decide[] choice; refuses while any choice is
 *             null; lowers the file's skin-allowance pragma to the new count; records the
 *             Classic deltas the choices introduce (a choice whose Classic value differs).
 *
 * Choices (decide[].choice):
 *   a role name     action | accent | accent-text | info | warn | muted | rule | font-mono | …
 *                   (a tint with alpha < 1 becomes the channel form rgb(var(--x-rgb) / a) when
 *                   the role has one: accent, info, warn, success, danger, slate)
 *   keep:<reason>   leave it; it stays inside the allowance. The reason goes in the record.
 *   raw:<css>       replace the literal with exactly this text (escape hatch; say why)
 *
 * Roles are resolved from styles/roles.css; before Phase 0a from the SPEC §4 fixture, and
 * --apply then refuses (var(--rule) would not resolve on a real page) unless --allow-pre0a
 * is given, which only a scratch copy should ever see.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const S = require('./lib/scan');
const C = require('./lib/common');
const P = require('./lib/pragma');
const R = require('./lib/roles');
const { rangesFor } = require('./lib/units');

const RECORDS = path.join(C.REPO, 'docs', 'design', 'themes', 'records');

const HELP = `usage:
  node scripts/skins/codemod.js --report --file <css> [--range SC-xx] [--theme dark|light|both] [--unit <id>]
  node scripts/skins/codemod.js --apply  --file <css> [--range SC-xx] --decisions <json>
  node scripts/skins/codemod.js --report --tokens-only --file <css>     (Phase 0b: token declarations only)

  --file <css>       relative to src/src (or a repo path)
  --range SC-xx      one styles.css unit (by its skin-allowance marker / banner)
  --theme            the theme(s) this sheet renders in; matches must hold in every one (default dark)
  --unit <id>        names the record: records/<id>.decisions.json (default: from the file/range)
  --out <json>       write the decisions file somewhere else
  --decisions <json> the filled decisions file for --apply
  --tokens-only      only --custom-property declarations (never rules)
  --root <dir>       another src/src (a scratch copy)
  --allow-pre0a      let --apply write roles that do not exist yet (scratch copies only)
  --json             print the report as JSON
  --selftest         round trip on a fixture: report, fill, apply -> allowance 0, all Classic-identical
  --selftest --plant   a decision is left null; --apply must refuse and the self-test must fail
  --help`;

const ROLE_BY_SHORT = Object.fromEntries(R.ROLES.map((r) => [r.name.slice(2), r]));
const CHANNEL_OF = { accent: '--accent-rgb', info: '--info-rgb', warn: '--warn-rgb', success: '--success-rgb', danger: '--danger-rgb', slate: '--slate-rgb', shade: '--shade-rgb', glow: '--glow-rgb' };

function themesOf(o) {
  const t = o.theme || 'dark';
  return t === 'both' ? ['dark', 'light'] : [t];
}

function unitIdOf(rel, range) {
  if (range) return range;
  return path.basename(rel).replace(/\.css$/, '');
}

function colOf(text, offset) { return offset - (text.lastIndexOf('\n', offset - 1) + 1); }

function alphaText(literal) {
  const m = literal.match(/^rgba?\(([^)]*)\)$/i);
  if (!m) return null;
  const parts = m[1].replace(/\s*\/\s*/, ' / ').split(/[\s,]+/).filter((x) => x && x !== '/');
  return parts.length > 3 ? parts[3] : null;
}

/** Heuristic proposal text (shown, never applied without a decision). TOOLING-BRIEF §3. */
function propose(f, candidates) {
  const sel = (f.selector || '').toLowerCase();
  const prop = (f.property || '').toLowerCase();
  const isBg = /^background/.test(prop) || /-(bg|fill)$/.test(prop);
  const isInk = /^(color|caret-color)$/.test(prop) || /-(text|ink)$/.test(prop);
  const isLine = /^(border|outline|box-shadow|column-rule)/.test(prop) || /-(rule|border)$/.test(prop);
  if (f.type === 'font') return /mono|menlo|consolas|courier|sfmono/i.test(f.literal) ? 'font-mono' : 'keep:<why this family>';
  if (f.type === 'secondary') {
    if (/(^|[\s.>:])a\b|link|connected|ws-/.test(sel)) return 'info';
    return 'info';
  }
  const lit = String(f.literal).replace(/\s+/g, '');
  const blue = /^rgba?\(124,167,230/.test(lit) || /^#7CA7E6$/i.test(lit);
  if (blue) return 'info';
  const amber = f.type === 'primary' || /^rgba?\(246,169,76/.test(lit) || candidates.some((c) => ['accent', 'action', 'warn'].includes(c.role.replace(/^--/, '')));
  if (amber) {
    if (isBg && /btn|button|primary|\bgo\b|cta|submit/.test(sel)) return 'action';
    if (isInk) return 'accent-text';
    if (isLine || isBg) return 'accent';
    return 'accent';
  }
  if (candidates.length) return candidates[0].role.replace(/^--/, '').replace(/-rgb$/, '');
  return 'keep:<why>';
}

function nearestRoles(rgb, kinds, table, themes) {
  const out = [];
  for (const r of R.ROLES.filter((x) => kinds.includes(x.kind))) {
    const v = table[themes[0]][r.name];
    if (!v) continue;
    try {
      const c = R.colourKey(v).split(',').slice(0, 3).map(Number);
      const d = Math.sqrt(c.reduce((a, x, i) => a + (x - rgb[i]) ** 2, 0));
      out.push({ role: r.name, distance: Math.round(d) });
    } catch (_) { /* gradient etc. */ }
  }
  return out.sort((a, b) => a.distance - b.distance).slice(0, 3);
}

/** Does choosing `role` for this finding keep Classic identical in every theme? */
function classicVerdict(f, roleName, table, themes) {
  const notes = [];
  for (const t of themes) {
    const v = table[t][roleName];
    if (v === undefined) { notes.push(`${t}: ${roleName} undeclared`); continue; }
    let before = f.literal;
    if (f.type === 'primary' || f.type === 'secondary') before = f.aliasValue;
    const k1 = R.colourKey(before);
    let k2 = R.colourKey(v);
    if (roleName.endsWith('-rgb')) {
      const a = alphaText(f.literal);
      k2 = R.colourKey(`rgba(${v.split(/[\s,]+/).join(',')},${a == null ? 1 : a})`);
      if (k1 && k2 && k1 !== k2) { notes.push(`${t}: ${before} -> rgba(${k2})`); continue; }
    }
    if (!k1 || !k2) { notes.push(`${t}: not comparable`); continue; }
    if (k1 !== k2) notes.push(`${t}: ${before} -> ${v}`);
  }
  return notes.length ? `Classic differs (${notes.join('; ')})` : 'Classic same';
}

function analyse(root, o) {
  const rel = C.relCss(o.file, root);
  const text = fs.readFileSync(path.join(root, rel), 'utf8');
  let range = null;
  if (o.range) {
    range = rangesFor(text).find((r) => r.id === o.range);
    if (!range) throw new Error(`no unit ${o.range} in ${rel}`);
  }
  const themes = themesOf(o);
  const src = R.roleSource(root);
  const table = R.classicTable(src, themes);
  const aliases = {};
  for (const t of themes) {
    aliases[t] = {};
    for (const n of ['--primary', '--primary-deep', '--secondary']) {
      try { aliases[t][n] = H0(root).role(n, { skin: 'classic', theme: t }); } catch (_) { /* none */ }
    }
  }
  const scan = S.scanCss(text, range || {});
  let findings = scan.findings;
  if (o['tokens-only']) findings = findings.filter((f) => f.kind === 'token');
  const auto = []; const decide = [];
  for (const f of findings) {
    const id = `${f.line}:${colOf(text, f.offset)}`;
    const base = { id, line: f.line, col: colOf(text, f.offset), type: f.type, kind: f.kind, selector: f.selector, property: f.property, literal: f.literal };
    if (f.type === 'primary' || f.type === 'secondary') {
      const name = f.literal.replace(/^var\(\s*/, '');
      f.aliasValue = aliases[themes[0]][name];
      const cands = (f.type === 'primary' ? ['--action', '--accent', '--accent-text'] : ['--info', '--accent'])
        .map((r) => ({ role: r, classic: classicVerdict(f, r, table, themes) }));
      decide.push({ ...base, why: `${name} read (accent-vs-action decision, SPEC §4.4)`, candidates: cands, proposal: propose(f, cands), choice: null });
      continue;
    }
    if (f.type === 'font') {
      decide.push({ ...base, why: 'literal font family', candidates: [{ role: '--font-mono', classic: 'Classic same when the stack is a mono stack (renders the first available face)' }], proposal: propose(f, []), choice: null });
      continue;
    }
    const key = R.colourKey(f.literal);
    if (!key) {
      decide.push({ ...base, why: 'not a parseable single colour', candidates: [], proposal: 'keep:<why>', choice: null });
      continue;
    }
    const kinds = R.kindsFor(f.property, f.kind);
    const exact = R.ROLES.filter((r) => kinds.includes(r.kind) && themes.every((t) => table[t][r.name] && R.colourKey(table[t][r.name]) === key));
    if (exact.length === 1 && !exact[0].decide) {
      auto.push({ ...base, replacement: `var(${exact[0].name})`, why: `exact ${exact[0].name} in ${themes.join('+')}` });
      continue;
    }
    if (exact.length) {
      const cands = exact.map((r) => ({ role: r.name, classic: 'Classic same' }));
      decide.push({ ...base, why: `matches ${exact.length > 1 ? 'several roles' : 'a judgement role'}: ${exact.map((r) => r.name).join(', ')}`, candidates: cands, proposal: propose(f, cands), choice: null });
      continue;
    }
    const [r, g, b, a] = key.split(',').map(Number);
    const chan = R.CHANNELS.filter((c) => themes.every((t) => table[t][c.name] && table[t][c.name].split(/[\s,]+/).map(Number).join(',') === `${r},${g},${b}`));
    if (chan.length && a < 1) {
      const sure = chan.filter((c) => !c.decide);
      if (chan.length === 1 && sure.length === 1) {
        auto.push({ ...base, replacement: `rgb(var(${sure[0].name}) / ${alphaText(f.literal)})`, why: `channel ${sure[0].name}, Classic-identical` });
        continue;
      }
      const cands = chan.map((c) => ({ role: c.name, classic: 'Classic same' }));
      if (!chan.some((c) => c.name === '--accent-rgb')) cands.push({ role: '--accent-rgb', classic: classicVerdict(f, '--accent-rgb', table, themes) });
      decide.push({ ...base, why: `tint of ${chan.map((c) => c.role).join(' / ')} (SPEC §4.4: accent, warn or info?)`, candidates: cands, proposal: propose(f, cands), choice: null });
      continue;
    }
    const near = nearestRoles([r, g, b], kinds, table, themes);
    decide.push({ ...base, why: 'no role has this value', candidates: near.map((n) => ({ role: n.role, classic: `Classic differs (distance ${n.distance})` })), proposal: 'keep:<why> (or a scope-local alias, SPEC §4.2 "near-variants")', choice: null });
  }
  return { rel, text, range, themes, src, auto, decide, before: scan.counts };
}

let H0cache = null;
function H0(root) {
  if (!H0cache || H0cache.root !== root) H0cache = { root, X: require('../../src/src/testing/skinHarness').create(root) };
  return H0cache.X;
}

function gitHead() {
  try { return execFileSync('git', ['-C', C.REPO, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(); } catch (_) { return null; }
}

function report(root, o) {
  const a = analyse(root, o);
  const unit = o.unit || unitIdOf(a.rel, o.range);
  const doc = {
    unit, file: a.rel, range: o.range || null, themes: a.themes, tokensOnly: !!o['tokens-only'],
    base: gitHead(), roleSource: a.src.fixture ? 'SPEC §4 fixture (Phase 0a not landed)' : 'styles/roles.css',
    before: S.gateCounts(a.before),
    auto: a.auto,
    decide: a.decide,
  };
  return { a, doc };
}

/* --------------------------------------------------------------- apply ---- */

function replacementFor(entry, choice, table, themes) {
  const c = String(choice).trim();
  if (c.startsWith('keep:')) {
    if (!c.slice(5).trim() || /<why/.test(c)) throw new Error(`${entry.id}: keep needs a reason`);
    return null;
  }
  if (c.startsWith('raw:')) return c.slice(4);
  const short = c.replace(/^--/, '').replace(/^var\((--)?/, '').replace(/\)$/, '');
  if (entry.type === 'primary' || entry.type === 'secondary') return `var(--${short}`;
  if (entry.type === 'font') {
    if (entry.property.toLowerCase() === 'font') throw new Error(`${entry.id}: a font: shorthand needs raw:<shorthand with var(--${short})>`);
    return `var(--${short})`;
  }
  const alpha = alphaText(entry.literal);
  const parsed = R.colourKey(entry.literal);
  const a = parsed ? Number(parsed.split(',')[3]) : 1;
  if (a < 1) {
    const ch = CHANNEL_OF[short.replace(/-rgb$/, '')];
    if (!ch) throw new Error(`${entry.id}: ${entry.literal} is a tint and --${short} has no channel form; use raw: or keep:`);
    return `rgb(var(${ch}) / ${alpha})`;
  }
  if (short.endsWith('-rgb')) return `rgb(var(--${short}))`;
  if (!ROLE_BY_SHORT[short] && !/^font-/.test(short)) {
    const known = Object.values(table[themes[0]] || {}).length;
    if (known) throw new Error(`${entry.id}: unknown role --${short}`);
  }
  return `var(--${short})`;
}

function apply(root, o) {
  if (!o.decisions) throw new Error('--apply needs --decisions <json>');
  const doc = JSON.parse(fs.readFileSync(path.resolve(o.decisions), 'utf8'));
  const rel = C.relCss(o.file || doc.file, root);
  if (rel !== doc.file) throw new Error(`decisions are for ${doc.file}, not ${rel}`);
  const src = R.roleSource(root);
  if (src.fixture && !o['allow-pre0a']) {
    throw new Error('styles/roles.css does not exist yet (Phase 0a). Applying would write var(--role) that no page can resolve. Nothing changed. (--allow-pre0a is for scratch copies.)');
  }
  const open = doc.decide.filter((d) => d.choice === null || d.choice === undefined || d.choice === '');
  if (open.length) throw new Error(`${open.length} decision(s) still null: ${open.slice(0, 8).map((d) => d.id).join(', ')}${open.length > 8 ? ', …' : ''}. Fill them in ${o.decisions}`);
  let text = fs.readFileSync(path.join(root, rel), 'utf8');
  const lines = text.split('\n');
  const lineStart = []; let acc = 0;
  for (const l of lines) { lineStart.push(acc); acc += l.length + 1; }
  const themes = doc.themes;
  const table = R.classicTable(src, themes);
  const edits = []; const deltas = []; const kinds = {};
  const stale = [];
  for (const e of [...doc.auto.map((x) => ({ ...x, choice: x.replacement, isAuto: true })), ...doc.decide]) {
    const offset = lineStart[e.line - 1] + e.col;
    if (text.slice(offset, offset + e.literal.length) !== e.literal) { stale.push(e.id); continue; }
    let rep;
    if (e.isAuto) rep = e.replacement;
    else {
      rep = replacementFor(e, e.choice, table, themes);
      const k = String(e.choice).startsWith('keep:') ? 'keep' : String(e.choice).startsWith('raw:') ? 'raw' : String(e.choice).replace(/^--/, '');
      kinds[k] = (kinds[k] || 0) + 1;
      if (rep !== null && !String(e.choice).startsWith('raw:')) {
        const roleName = `--${String(e.choice).replace(/^--/, '')}`;
        const v = e.type === 'font' ? 'Classic same' : classicVerdict({ ...e, aliasValue: aliasOf(root, e, themes) }, CHANNEL_OF[roleName.slice(2)] && R.colourKey(e.literal) && Number(R.colourKey(e.literal).split(',')[3]) < 1 ? CHANNEL_OF[roleName.slice(2)] : roleName, table, themes);
        if (v !== 'Classic same') deltas.push(`${e.id} ${e.selector} ${e.property}: ${e.literal} -> ${e.choice}: ${v}`);
      }
      if (String(e.choice).startsWith('raw:')) deltas.push(`${e.id} ${e.selector} ${e.property}: ${e.literal} -> ${rep} (raw: check by hand)`);
    }
    if (rep !== null) edits.push({ offset, length: e.literal.length, text: rep });
  }
  if (stale.length) throw new Error(`the file changed since --report (${stale.length} entries no longer match, e.g. ${stale.slice(0, 5).join(', ')}). Re-run --report.`);
  edits.sort((x, y) => y.offset - x.offset);
  for (const ed of edits) text = text.slice(0, ed.offset) + ed.text + text.slice(ed.offset + ed.length);

  // lower the pragma to the new count
  let range = null;
  if (doc.range) range = rangesFor(text).find((r) => r.id === doc.range);
  const after = S.gateCounts(S.scanCss(text, range || {}).counts);
  if (doc.range) {
    const marked = S.unitPragmas(text).find((m) => m.unit === doc.range);
    if (marked) {
      for (const k of ['colour', 'font', 'primary']) if (after[k] > (marked.fields[k] || 0)) throw new Error(`${doc.range}: ${k} would rise to ${after[k]}`);
      text = P.setUnitPragmas(text, { [doc.range]: after });
    }
  } else {
    const old = S.filePragma(text);
    if (old || after.colour || after.font || after.primary) {
      for (const k of ['colour', 'font', 'primary']) if (old && after[k] > (old[k] || 0)) throw new Error(`${rel}: ${k} would rise to ${after[k]}`);
      text = P.setFilePragma(text, after);
    }
  }
  fs.writeFileSync(path.join(root, rel), text);
  doc.applied = { at: new Date().toISOString(), after, decisionsByKind: kinds, classicDeltas: deltas, edits: edits.length };
  fs.writeFileSync(path.resolve(o.decisions), `${JSON.stringify(doc, null, 2)}\n`);
  return doc;
}

function aliasOf(root, e, themes) {
  if (e.type !== 'primary' && e.type !== 'secondary') return undefined;
  const name = e.literal.replace(/^var\(\s*/, '');
  try { return H0(root).role(name, { skin: 'classic', theme: themes[0] }); } catch (_) { return undefined; }
}

/* ------------------------------------------------------------ self-test ---- */

function runSelftest(plant) {
  const tmp = C.tmpDir('codemod');
  // a scratch src: today's styles.css + the SPEC fixture skins and roles + the fixture sheet
  fs.copyFileSync(path.join(C.SRC, 'styles.css'), path.join(tmp, 'styles.css'));
  fs.cpSync(path.join(R.FIXTURE, 'styles'), path.join(tmp, 'styles'), { recursive: true });
  fs.cpSync(path.join(R.FIXTURE, 'config'), path.join(tmp, 'config'), { recursive: true });
  fs.copyFileSync(path.join(__dirname, 'fixtures', 'codemod', 'Chip.css'), path.join(tmp, 'Chip.css'));
  const out = path.join(tmp, 'Chip.decisions.json');
  const { doc } = report(tmp, { file: 'Chip.css', theme: 'dark' });
  const fills = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'codemod', 'Chip.choices.json'), 'utf8'));
  for (const d of doc.decide) d.choice = fills[d.id] === undefined ? null : fills[d.id];
  if (plant) doc.decide[0].choice = null;
  fs.writeFileSync(out, JSON.stringify(doc, null, 2));
  let applied = null; let err = null;
  try { applied = apply(tmp, { file: 'Chip.css', decisions: out }); } catch (e) { err = e.message; }
  const css = fs.readFileSync(path.join(tmp, 'Chip.css'), 'utf8');
  C.selftest('codemod', [
    ['the report auto-maps the exact rule, the slate tint and the danger tint', () => C.assert(doc.auto.length === 3, JSON.stringify(doc.auto.map((x) => x.literal)))],
    ['every --primary, the amber and blue tints and the font are DECIDE', () => C.assert(doc.decide.length === 6, JSON.stringify(doc.decide.map((x) => `${x.id} ${x.literal}`)))],
    ['every decision is filled from the fixture', () => C.assert(doc.decide.every((d) => d.choice !== null), JSON.stringify(doc.decide.filter((d) => d.choice === null).map((d) => d.id)))],
    ['apply succeeds', () => C.assert(!err, err)],
    ['the allowance pragma is lowered to zero', () => C.assert(/^\/\* skin-allowance: colour=0 font=0 primary=0 \*\//.test(css), css.split('\n')[0])],
    ['no Classic delta is introduced by Classic-preserving choices', () => C.assert(applied && applied.applied.classicDeltas.length === 0, JSON.stringify(applied && applied.applied.classicDeltas))],
    ['the channel form is written', () => C.assert(/rgb\(var\(--danger-rgb\) \/ \.55\)/.test(css) && /rgb\(var\(--warn-rgb\) \/ \.5\)/.test(css), css)],
    ['an unfilled report refuses to apply', () => {
      const t2 = C.tmpDir('codemod-null');
      fs.cpSync(tmp, t2, { recursive: true });
      fs.copyFileSync(path.join(__dirname, 'fixtures', 'codemod', 'Chip.css'), path.join(t2, 'Chip.css'));
      const r2 = report(t2, { file: 'Chip.css' }).doc;
      fs.writeFileSync(path.join(t2, 'd.json'), JSON.stringify(r2));
      let threw = false; try { apply(t2, { file: 'Chip.css', decisions: path.join(t2, 'd.json') }); } catch (e) { threw = /still null/.test(e.message); }
      C.assert(threw, 'apply did not refuse');
    }],
  ]);
}

/* ---------------------------------------------------------------- main ---- */

function printReport(a, doc, file) {
  console.log(`# ${doc.file}${doc.range ? ` ${doc.range}` : ''} — themes ${doc.themes.join('+')}, roles from ${doc.roleSource}`);
  console.log(`before: colour=${doc.before.colour} font=${doc.before.font} primary=${doc.before.primary}`);
  console.log(`\n## auto (${doc.auto.length}) — exact or channel, Classic-identical`);
  for (const x of doc.auto) console.log(`  ${x.id}  ${x.selector}  ${x.property}: ${x.literal}  ->  ${x.replacement}   (${x.why})`);
  console.log(`\n## DECIDE (${doc.decide.length}) — fill "choice" in ${file}`);
  for (const d of doc.decide) {
    console.log(`  ${d.id}  ${d.selector}  ${d.property}: ${d.literal}\n      why: ${d.why}\n      proposal: ${d.proposal}${d.candidates.length ? `\n      candidates: ${d.candidates.map((c) => `${c.role} [${c.classic}]`).join(' · ')}` : ''}`);
  }
}

function main() {
  const o = C.args();
  if (o.help) { console.log(HELP); return; }
  if (o.selftest) { runSelftest(!!o.plant); return; }
  const root = o.root ? path.resolve(o.root) : C.SRC;
  if (o.report) {
    if (!o.file) { console.log(HELP); process.exit(2); }
    const { a, doc } = report(root, o);
    const file = o.out ? path.resolve(o.out) : path.join(RECORDS, `${doc.unit}.decisions.json`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file) && !o.force) {
      const prev = JSON.parse(fs.readFileSync(file, 'utf8'));
      const filled = prev.decide.filter((d) => d.choice !== null).length;
      if (filled) {
        // keep the worker's filled choices for entries that still exist
        const byId = Object.fromEntries(prev.decide.map((d) => [`${d.id}|${d.literal}`, d]));
        for (const d of doc.decide) { const p = byId[`${d.id}|${d.literal}`]; if (p && p.choice !== null) { d.choice = p.choice; } }
      }
    }
    fs.writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
    if (o.json) console.log(JSON.stringify(doc, null, 2)); else printReport(a, doc, file.startsWith(C.REPO) ? path.relative(C.REPO, file) : file);
    if (a.src.fixture) console.log('\nNOTE: roles came from the SPEC fixture — Phase 0a has not landed; --apply will refuse on this tree.');
    return;
  }
  if (o.apply) {
    try {
      const doc = apply(root, o);
      console.log(`applied ${doc.applied.edits} edit(s) to ${doc.file}${doc.range ? ` ${doc.range}` : ''}`);
      console.log(`allowance now colour=${doc.applied.after.colour} font=${doc.applied.after.font} primary=${doc.applied.after.primary}`);
      console.log(`decisions: ${Object.entries(doc.applied.decisionsByKind).map(([k, v]) => `${k} ${v}`).join(' · ') || 'none'}`);
      console.log(doc.applied.classicDeltas.length ? `CLASSIC DELTAS (record each, or change the choice):\n  ${doc.applied.classicDeltas.join('\n  ')}` : 'classic deltas: none');
    } catch (e) {
      console.error(`refused: ${e.message}`);
      process.exit(1);
    }
    return;
  }
  console.log(HELP);
}

if (require.main === module) main();
module.exports = { analyse, report, apply };
