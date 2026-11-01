#!/usr/bin/env node
/**
 * Today's count for every experience-plan drift guard (docs/design/experience-plan/PLAN.md
 * §5.3), beside the allowance src/src/testing/driftAllowances.js records for it.
 *
 *   node scripts/drift-baselines.js            totals, then every allowance that differs
 *   node scripts/drift-baselines.js --all      every file's count, not only the differences
 *   node scripts/drift-baselines.js --module   the whole allowances file at today's counts,
 *                                              to review and redirect into place:
 *        node scripts/drift-baselines.js --module > src/src/testing/driftAllowances.js
 *
 * For a reviewer after a merge: the guards fail when a count rises (new drift) AND when
 * it falls without the allowance following it. A falling number is the good case; lower
 * the allowance. A rising one is new drift: fix the code, do not raise the number, unless
 * the owner has agreed to it.
 *
 * Colour literals keep their allowances in the files themselves (skin-allowance pragmas);
 * this prints their JSX total for the record, and `node scripts/skins/seed-allowances.js`
 * is the tool for them.
 */
const path = require('path');
const D = require('../src/src/testing/driftScan');
const S = require('../src/src/testing/skinScan');

const args = process.argv.slice(2);
const today = D.measure();

const GUARDS = [
  ['dialogs', 'Browser dialogs (alert/confirm calls)'],
  ['closeGlyphs', 'Close glyph (an element whose text is × or ✕)'],
  ['primaryButtons', 'Primary button classes (per stylesheet)'],
  ['bannedWords', 'Banned words (PLAN §3.6, per file per replaced label)'],
  ['helpFalseClaims', 'Help truth (known false help claims)'],
];

function moduleText(m) {
  const body = {
    buttonFamilies: m.buttonFamilies,
    dialogs: m.dialogs,
    closeGlyphs: m.closeGlyphs,
    primaryButtons: m.primaryButtons,
    bannedWords: m.bannedWords,
    helpFalseClaims: m.helpFalseClaims,
    buttonFamilyNames: m.buttonFamilyNames,
  };
  return `/* eslint-env node */
/**
 * THE DRIFT ALLOWANCES (docs/design/experience-plan/PLAN.md §5.3, Phase 0).
 *
 * The count of each kind of drift each file may have. Every number may only go DOWN,
 * and must go down in the same change that lowers the count: the guards in
 * src/src/__tests__/driftRatchets.test.js and helpTruth.test.js fail when a count is above its allowance (new drift)
 * and when it is below (a stale allowance). Regenerate after a merge with
 *   node scripts/drift-baselines.js --module > src/src/testing/driftAllowances.js
 * and read the diff: every number in it should have fallen.
 *
 * buttonFamilies is one total across all stylesheets (see driftScan.js for "family");
 * buttonFamilyNames only lets a failure name the new family, it is not a ratchet itself.
 * Not named *token*: .gitignore has an unanchored \`*token*\`.
 */
module.exports = ${JSON.stringify(body, null, 2)};
`;
}

if (args.includes('--module')) {
  process.stdout.write(moduleText(today));
  process.exit(0);
}

let recorded = {};
try { recorded = require('../src/src/testing/driftAllowances'); } catch (e) { /* first run */ }

const total = (o) => Object.values(o || {}).reduce((a, v) => a + (typeof v === 'number' ? v : total(v)), 0);
const flat = (o) => {
  const out = {};
  for (const [f, v] of Object.entries(o || {})) {
    if (typeof v === 'number') out[f] = v;
    else for (const [k, n] of Object.entries(v)) out[`${f}  "${k}"`] = n;
  }
  return out;
};

let jsxColour = 0;
let jsxColourFiles = 0;
for (const r of D.jsFiles()) {
  const n = S.scanJsx(D.read(r)).findings.length;
  if (n) { jsxColour += n; jsxColourFiles += 1; }
}

console.log('Experience-plan drift guards: today vs. allowance (src/src/testing/driftAllowances.js)\n');
console.log(`  Colour literals in JSX/JS inline styles: ${jsxColour} in ${jsxColourFiles} files (allowances are in-file pragmas; see scripts/skins/seed-allowances.js)`);
console.log(`  Button class families (total): ${today.buttonFamilies}   allowance ${recorded.buttonFamilies ?? '(none)'}`);
let differs = 0;
if (recorded.buttonFamilies !== undefined && recorded.buttonFamilies !== today.buttonFamilies) differs += 1;
for (const [key, title] of GUARDS) {
  const t = flat(today[key]);
  const a = flat(recorded[key]);
  console.log(`  ${title}: ${total(today[key])} in ${Object.keys(today[key]).length} files   allowance ${total(recorded[key])}`);
  const names = [...new Set([...Object.keys(t), ...Object.keys(a)])].sort();
  for (const n of names) {
    const now = t[n] || 0;
    const was = a[n] || 0;
    if (now !== was) {
      differs += 1;
      console.log(`      ${now < was ? 'LOWER ' : 'ROSE  '} ${n}: ${was} -> ${now}`);
    } else if (args.includes('--all')) console.log(`             ${n}: ${now}`);
  }
}
console.log(differs
  ? `\n${differs} allowance(s) differ. Lowered counts: run with --module, redirect it into place and commit. Risen counts are new drift: fix the code (${path.join('src', 'src', 'testing', 'driftScan.js')} says what counts).`
  : '\nEvery allowance matches today\'s count.');
