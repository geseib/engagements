/**
 * scripts/apply-generation-prompts.js — the plan and the item it writes.
 *
 *   1. a missing row is created, shaped as the seeder writes it
 *   2. a matching row is kept; a differing one is reported with its fields
 *   3. an update keeps the live row's identity and createdAt
 *   4. the repo carries all 22 generation prompts, each with a basePrompt
 */
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const script = require(path.join(REPO, 'scripts', 'apply-generation-prompts.js'));
const { generationPrompts } = require(path.join(REPO, 'lambda-functions', 'admin', 'populate-generation-prompts.js'));
const { normalizeGameType } = require(path.join(REPO, 'lambda-functions', 'admin', 'shared', 'game-types.js'));

let pass = 0; let fail = 0;
const check = (label, fn) => {
  try { fn(); console.log(`  PASS  ${label}`); pass++; } catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
};

console.log('\napply-generation-prompts\n');
const repo = script.repoRows(generationPrompts, normalizeGameType);
const first = repo[0];

check('the repo carries 22 generation prompts, each with an id and a basePrompt', () => {
  assert.strictEqual(repo.length, 22);
  for (const r of repo) {
    assert.match(r.promptId, /^gen-[a-z-]+$/);
    assert.ok(r.basePrompt, r.promptId);
    assert.strictEqual(r.SK, `AIPROMPT#${r.promptId}`);
  }
});

check('missing rows are created; matching rows are kept', () => {
  const live = { [first.promptId]: { ...first, createdAt: '2026-08-01T00:00:00Z' } };
  const p = script.plan(repo, live);
  assert.strictEqual(p[0].action, 'keep');
  assert.ok(p.slice(1).every((e) => e.action === 'create'));
});

check('a differing row is an update naming its text fields; settings alone are not a difference', () => {
  const live = { [first.promptId]: { ...first, basePrompt: 'old text', tags: ['x'] } };
  const e = script.plan(repo, live)[0];
  assert.deepStrictEqual([e.action, e.changed], ['update', ['basePrompt']]);
  const tuned = script.plan(repo, { [first.promptId]: { ...first, defaultSettings: { difficulty: 'hard' } } })[0];
  assert.strictEqual(tuned.action, 'keep');
});

check('an update keeps the tier\'s settings', () => {
  const live = { [first.promptId]: { ...first, basePrompt: 'old', defaultSettings: { difficulty: 'hard' }, tags: ['mine'] } };
  const item = script.itemFor(script.plan(repo, live)[0], '2026-10-25T00:00:00Z');
  assert.deepStrictEqual([item.defaultSettings, item.tags, item.basePrompt], [{ difficulty: 'hard' }, ['mine'], first.basePrompt]);
});

check('an update keeps createdAt and identity, takes the repo text', () => {
  const live = { [first.promptId]: { ...first, basePrompt: 'old text', createdAt: '2026-08-01T00:00:00Z', version: '1.0.0' } };
  const item = script.itemFor(script.plan(repo, live)[0], '2026-10-25T00:00:00Z');
  assert.strictEqual(item.createdAt, '2026-08-01T00:00:00Z');
  assert.strictEqual(item.basePrompt, first.basePrompt);
  assert.strictEqual(item.SK, first.SK);
  assert.strictEqual(item.updatedAt, '2026-10-25T00:00:00Z');
});

check('a create is shaped as the seeder writes it', () => {
  const item = script.itemFor(script.plan(repo, {})[0], '2026-10-25T00:00:00Z');
  assert.deepStrictEqual(
    [item.PK, item.promptType, item.version, item.createdAt],
    ['AIPROMPTS', 'generation', '1.0.0', '2026-10-25T00:00:00Z'],
  );
});

// rejects: prod, 2026-10-28 — every row written was reported MISMATCH because
// DynamoDB handed `defaultSettings` back with its keys in another order.
check('a map read back with its keys in another order is the same value', () => {
  assert.ok(script.same({ count: 10, difficulty: 'medium' }, { difficulty: 'medium', count: 10 }));
  assert.ok(script.same({ a: { y: 1, x: [1, 2] } }, { a: { x: [1, 2], y: 1 } }));
  assert.ok(script.same(undefined, null));
});

check('a real difference is still a difference, and array order still counts', () => {
  assert.ok(!script.same({ count: 10 }, { count: 11 }));
  assert.ok(!script.same(['a', 'b'], ['b', 'a']));
  assert.ok(!script.same({ count: 10 }, { count: 10, extra: true }));
});

check('a live row whose settings differ only in key order is kept, not updated', () => {
  const settings = first.defaultSettings && typeof first.defaultSettings === 'object' ? first.defaultSettings : { a: 1, b: 2 };
  const reordered = Object.fromEntries(Object.entries(settings).reverse());
  const row = { ...first, defaultSettings: settings };
  const p = script.plan([row], { [first.promptId]: { ...row, defaultSettings: reordered } });
  assert.strictEqual(p[0].action, 'keep');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
