#!/usr/bin/env node
/**
 * RELEASE NOTES HAVE A SHAPE A REVIEWER CAN USE (owner, 2026-10-16: notes, help and
 * README are updated before every push to test; CLAUDE.md "Before every push to test").
 *
 * This cannot know whether the newest entry is current. It holds the shape: the
 * file exists, entries are "## " headings newest first, and the newest one has the
 * four parts the reviewer reads — New, Fixed, What to look at (numbered), Known gaps.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const file = path.join(__dirname, '..', 'RELEASE_NOTES.md');
let pass = 0; let fail = 0;
function check(label, fn) {
  try { fn(); pass += 1; console.log(`  ok   - ${label}`); } catch (e) { fail += 1; console.log(`  FAIL - ${label}\n         ${e.message}`); }
}

console.log('\nrelease-notes\n');
const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
const entries = text.split(/^## /m).slice(1);
const newest = entries[0] || '';

check('RELEASE_NOTES.md exists and has at least one entry', () => {
  assert.ok(text.length > 0, 'RELEASE_NOTES.md is missing');
  assert.ok(entries.length >= 1, 'no "## " entry');
});
check('the newest entry names its date first', () => {
  assert.match(newest, /^\d{1,2} [A-Z][a-z]{2} \d{4}/, `heading starts "${newest.split('\n')[0]}"`);
});
for (const part of ['New', 'Fixed', 'What to look at', 'Known gaps']) {
  check(`the newest entry has "### ${part}"`, () => {
    assert.ok(new RegExp(`^### ${part}\\s*$`, 'm').test(newest), `missing "### ${part}"`);
  });
}
check('What to look at is a numbered list', () => {
  const look = newest.split(/^### What to look at\s*$/m)[1] || '';
  assert.ok(/^1\. /m.test(look), 'no "1. " step');
});
check('the newest entry names the dev commit it merged', () => {
  assert.match(newest, /dev `[0-9a-f]{7,}`/, 'no "dev `<sha>`"');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
