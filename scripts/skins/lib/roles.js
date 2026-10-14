/**
 * The role vocabulary (SPEC §3-§4) as the codemod and the equivalence check use it:
 * what each role is FOR (so a proposal fits the property it lands on), whether choosing it
 * is a judgement call (accent vs action vs warn vs info — never automatic), and its
 * channel form for tints.
 *
 * VALUES are never typed here. They are resolved through skinHarness from the real
 * styles/skins + styles/roles.css when they exist; before Phase 0a they come from the
 * SPEC §4 fixture (scripts/skins/fixtures/spec-skins), and every tool says so.
 */
const fs = require('fs');
const path = require('path');
const H = require('../../../src/src/testing/skinHarness');
const C = require('./common');

const FIXTURE = path.join(__dirname, '..', 'fixtures', 'spec-skins', 'src');

// kind: ground (backgrounds), ink (text), line (borders/rules), fill (marks, bars, borders).
// decide: the codemod never applies it on an exact match alone.
const ROLES = [
  { name: '--bg', kind: 'ground' },
  { name: '--surface', kind: 'ground' },
  { name: '--surface-2', kind: 'ground' },
  { name: '--scrim', kind: 'ground' },
  { name: '--row-hover', kind: 'ground' },
  { name: '--row-selected', kind: 'ground', decide: true },
  { name: '--text', kind: 'ink' },
  { name: '--muted', kind: 'ink' },
  { name: '--success-text', kind: 'ink' },
  { name: '--danger-text', kind: 'ink' },
  { name: '--accent-text', kind: 'ink', decide: true },
  { name: '--eyebrow-color', kind: 'ink', decide: true },
  { name: '--on-accent', kind: 'ink', decide: true },
  { name: '--on-action', kind: 'ink', decide: true },
  { name: '--rule', kind: 'line' },
  { name: '--rule-strong', kind: 'line' },
  { name: '--accent', kind: 'fill', decide: true, channel: '--accent-rgb' },
  { name: '--action', kind: 'fill', decide: true },
  { name: '--action-hover', kind: 'fill', decide: true },
  { name: '--accent-hover', kind: 'fill', decide: true },
  { name: '--info', kind: 'fill', decide: true, channel: '--info-rgb' },
  { name: '--warn', kind: 'fill', decide: true, channel: '--warn-rgb' },
  { name: '--success', kind: 'fill', channel: '--success-rgb' },
  { name: '--danger', kind: 'fill', channel: '--danger-rgb' },
  { name: '--danger-deep', kind: 'fill' },
  { name: '--gold', kind: 'fill', decide: true },
  { name: '--silver', kind: 'fill' },
  { name: '--bronze', kind: 'fill' },
  { name: '--phase-ask', kind: 'fill', decide: true },
  { name: '--phase-vote', kind: 'fill', decide: true },
  { name: '--phase-results', kind: 'fill', decide: true },
];
// tints with no colour role of their own
const CHANNELS = [
  { name: '--slate-rgb', role: 'slate' },
  { name: '--success-rgb', role: 'success' },
  { name: '--danger-rgb', role: 'danger' },
  { name: '--info-rgb', role: 'info', decide: true },
  { name: '--warn-rgb', role: 'warn', decide: true },
  { name: '--accent-rgb', role: 'accent', decide: true },
  // PROPOSED for Phase 0a, not in SPEC §4 (see docs/design/themes/README.md "Gaps found"):
  // 32 rgba(15,26,46,a) scrims/shadows and 8 rgba(244,237,228,a) text tints have no
  // Classic-identical channel otherwise. Matched only if roles.css declares them.
  { name: '--shade-rgb', role: 'shade' },
  { name: '--glow-rgb', role: 'glow' },
];

/** Which role kinds fit a property (or a custom property, by its name). */
function kindsFor(property, kind) {
  const p = String(property || '').toLowerCase();
  if (kind === 'token' || p.startsWith('--')) {
    if (/-(rule|line|border|hair|divider)(-|$)/.test(p)) return ['line', 'fill'];
    if (/-(text|ink|fg|copy|label|muted)(-|$)/.test(p)) return ['ink'];
    if (/-(bg|surface|ground|field|tint|hover|sel|selected|scrim|panel|card|fill)(-|$)/.test(p)) return ['ground', 'fill'];
    return ['ground', 'ink', 'line', 'fill'];
  }
  if (/^(color|caret-color|-webkit-text-fill-color|text-decoration-color)$/.test(p)) return ['ink', 'fill'];
  if (/^background/.test(p)) return ['ground', 'fill'];
  if (/^(border|outline|column-rule|box-shadow|text-shadow)/.test(p)) return ['line', 'fill'];
  if (/^(fill|stroke|accent-color)$/.test(p)) return ['fill', 'ink'];
  return ['ground', 'ink', 'line', 'fill'];
}

/**
 * The role values to match against: { source, fixture: bool, X (a harness) }.
 * Uses <root>/styles/roles.css when present, else the SPEC fixture (pre-0a).
 */
function roleSource(root = C.SRC) {
  if (fs.existsSync(path.join(root, 'styles', 'roles.css'))) return { X: H.create(root), fixture: false, source: root };
  return { X: H.create(FIXTURE), fixture: true, source: FIXTURE };
}

/** Canonical colour key: "r,g,b,a" rounded. null when not a single colour. */
function colourKey(value) {
  try {
    const c = H.parseColor(value);
    return `${c.rgb.map((v) => Math.round(v)).join(',')},${Math.round(c.a * 1000) / 1000}`;
  } catch (_) { return null; }
}

/** Classic values of every role and channel, per theme: { theme: { name: value } }. */
function classicTable(src, themes) {
  const out = {};
  for (const t of themes) {
    out[t] = {};
    for (const r of ROLES) { try { out[t][r.name] = src.X.role(r.name, { skin: 'classic', theme: t }); } catch (_) { /* not declared */ } }
    for (const c of CHANNELS) { try { out[t][c.name] = src.X.role(c.name, { skin: 'classic', theme: t }); } catch (_) { /* not declared */ } }
  }
  return out;
}

module.exports = { ROLES, CHANNELS, kindsFor, roleSource, colourKey, classicTable, FIXTURE };
