/**
 * THE SEEDED GENERATION PROMPTS (lambda-functions/admin/populate-generation-prompts.js)
 * say only what a generator actually reads.
 *
 *   1. `outputFormat` is read by nothing — every generator writes through a
 *      tool schema — so it carries one note saying so, never a JSON-array
 *      instruction (the wavelength one asked for "One sentence of framing",
 *      which the game forbids).
 *   2. The trivia and poll rows are read by nothing either (TriviaAIBuilder and
 *      PollAIBuilder send no promptId; their handlers look no row up), and say so.
 *   3. The wavelength spec is ONE module (shared/wavelength-spec.js) and carries
 *      no example subjects, which came back as output.
 *
 * Plain node; judged by exit code.
 */
const path = require('path');
const assert = require('assert');
const fs = require('fs');

const REPO = path.join(__dirname, '..');
const ADMIN = path.join(REPO, 'lambda-functions/admin');
const { generationPrompts } = require(path.join(ADMIN, 'populate-generation-prompts.js'));
const { WAVELENGTH_SPEC } = require(path.join(ADMIN, 'shared/wavelength-spec.js'));

let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); } catch (error) { failed += 1; console.log(`  FAIL  ${name}\n        ${error.message}`); }
}

const rows = Object.entries(generationPrompts)
  .flatMap(([gameType, byType]) => Object.entries(byType).map(([type, row]) => ({ gameType, type, row })));

test('all 22 rows are still seeded', () => {
  assert.strictEqual(rows.length, 22);
});

test('no outputFormat asks for JSON or framing; every one says the schema is the contract', () => {
  const notes = new Set(rows.map(({ row }) => row.outputFormat));
  assert.strictEqual(notes.size, 1, 'one note, the same on every row');
  const [note] = [...notes];
  assert.match(note, /schema/);
  assert.ok(!/JSON|framing/i.test(note), note);
});

test('the trivia and poll rows say they are not used by their builders', () => {
  for (const { gameType, type, row } of rows) {
    const unused = /Not used by the trivia\/poll builders/.test(row.description);
    assert.strictEqual(unused, gameType === 'trivia' || gameType === 'poll', `${gameType}/${type}: ${row.description}`);
  }
});

test('the poll rows describe a typed instant poll, not voting', () => {
  for (const { row } of rows.filter((r) => r.gameType === 'poll')) {
    assert.ok(!/voting/i.test(`${row.description} ${row.tags.join(' ')}`), row.description);
    assert.match(row.basePrompt, /instant poll questions/);
  }
});

test('every wavelength row starts from the one shared spec', () => {
  for (const { row } of rows.filter((r) => r.gameType === 'wavelength')) {
    assert.ok(row.basePrompt.startsWith(WAVELENGTH_SPEC), row.basePrompt.slice(0, 80));
  }
});

test('the spec gives no example subjects, and only one backend file spells it out', () => {
  assert.ok(!/Remote Work|Customer Trust|e\.g\./.test(WAVELENGTH_SPEC), WAVELENGTH_SPEC);
  for (const file of ['populate-generation-prompts.js', 'ai-generate-scenarios.js']) {
    const source = fs.readFileSync(path.join(ADMIN, file), 'utf8');
    assert.ok(!source.includes('word-association alignment game. Each item'), `${file} still carries its own copy`);
  }
});

console.log(`\n${failed ? `${failed} failed` : 'all passed'}`);
if (failed) process.exit(1);
