/**
 * Every repo prompt that declares outputSections declares a shape the engine
 * accepts. normalizeOutputSections returns null for ANY section over a limit
 * (e.g. guidance > 600 chars), and the engine then silently falls back to the
 * default three headings — the prompt's whole layout is lost with no error.
 *
 * rejects: 2026-10-31, tightening the Verdict Board for issue #48 pushed one
 * section's guidance to 624 characters, which would have dropped its four
 * sections on every tier.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const suiteFinished = require('./helpers/finish-guard');

const REPO = path.join(__dirname, '..');
const { normalizeOutputSections, MAX_GUIDANCE_CHARS } = require(path.join(REPO, 'lambda-functions', 'game', 'prompt-shape.js'));

let pass = 0; let fail = 0;
const check = (label, fn) => {
  try { fn(); console.log(`  PASS  ${label}`); pass++; } catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
};

console.log('\nrepo prompt shapes\n');
const files = ['demo-sets', path.join('prompts', 'tier-defaults')]
  .flatMap((dir) => (fs.existsSync(path.join(REPO, dir)) ? fs.readdirSync(path.join(REPO, dir)) : [])
    .filter((f) => f.endsWith('.prompt.json'))
    .map((f) => path.join(dir, f)));

check('found the repo prompt files', () => assert.ok(files.length > 0));

for (const file of files) {
  const prompt = JSON.parse(fs.readFileSync(path.join(REPO, file), 'utf8'));
  if (!Array.isArray(prompt.outputSections) || !prompt.outputSections.length) continue;
  check(`${file}: its declared sections are accepted`, () => {
    const over = prompt.outputSections.filter((s) => String(s.guidance || '').length > MAX_GUIDANCE_CHARS)
      .map((s) => `"${s.heading}" ${String(s.guidance).length} chars`);
    assert.deepStrictEqual(over, [], `guidance over ${MAX_GUIDANCE_CHARS}: ${over.join(', ')}`);
    assert.ok(normalizeOutputSections(prompt.outputSections), 'normalizeOutputSections rejected the shape');
  });
}

console.log(`\n${pass} passed, ${fail} failed`);
suiteFinished();
process.exit(fail ? 1 : 0);
