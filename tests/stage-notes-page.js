/**
 * WORKIE'S PAGE AS A SERVER FACT — the pure rule (two-surface PLAN 1.8).
 *
 * `lambda-functions/game/stage-notes.js` decides what a turn of the read does
 * to the stored page: an absolute page from the host page, a relative step
 * from the Remote, or a measured plan (Phase 2). It stores integers and one
 * validated key — never text — and refuses junk. The frontend mirror
 * `src/src/config/stageNotes.js` carries the same rule; §5 holds the two
 * shared blocks textually identical.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const { applyNotes, MAX_PLAN_ENTRIES } = require(path.join(REPO, 'lambda-functions/game/stage-notes.js'));

let pass = 0;
let fail = 0;
function check(label, fn) {
  try { fn(); console.log(`  PASS  ${label}`); pass++; } catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const ok = (r) => { assert.strictEqual(r.ok, true, JSON.stringify(r)); return r; };
const refused = (r, status) => { assert.strictEqual(r.ok, false, JSON.stringify(r)); assert.strictEqual(r.status, status, JSON.stringify(r)); };

console.log('\n1. an absolute page, from the host page');
check('page 2 of 3 is stored as given', () => {
  const r = ok(applyNotes({}, { notesPage: 2, notesPages: 3 }));
  assert.deepStrictEqual([r.page, r.pages], [2, 3]);
});
check('a page past the end is clamped to the last', () => {
  const r = ok(applyNotes({}, { notesPage: 9, notesPages: 3 }));
  assert.deepStrictEqual([r.page, r.pages], [2, 3]);
});
check('a page with no count keeps the stored count, and clamps to it', () => {
  const r = ok(applyNotes({ pages: 4 }, { notesPage: 7 }));
  assert.deepStrictEqual([r.page, r.pages], [3, 4]);
});
check('a page with no count and none stored is kept, count unknown', () => {
  const r = ok(applyNotes({}, { notesPage: 1 }));
  assert.deepStrictEqual([r.page, r.pages], [1, null]);
});
check('a new absolute count drops a measured plan that no longer matches', () => {
  const r = ok(applyNotes({ page: 0, pages: 5, plan: [2, 3], planKey: 'k1' }, { notesPage: 1, notesPages: 2 }));
  assert.deepStrictEqual([r.page, r.pages, r.plan, r.planKey], [1, 2, null, null]);
});

console.log('\n2. a relative step, from the Remote');
check('next from page 0 of 3 is page 1', () => {
  const r = ok(applyNotes({ page: 0, pages: 3 }, { step: 'next' }));
  assert.deepStrictEqual([r.page, r.pages], [1, 3]);
});
check('next on the last page stays on the last page', () => {
  assert.strictEqual(ok(applyNotes({ page: 2, pages: 3 }, { step: 'next' })).page, 2);
});
check('prev on the first page stays on the first page', () => {
  assert.strictEqual(ok(applyNotes({ page: 0, pages: 3 }, { step: 'prev' })).page, 0);
});
check('prev from page 2 is page 1', () => {
  assert.strictEqual(ok(applyNotes({ page: 2, pages: 3 }, { step: 'prev' })).page, 1);
});
check('a step with no known count is a 409, never a guess', () => {
  refused(applyNotes({}, { step: 'next' }), 409);
  refused(applyNotes({ page: 0 }, { step: 'prev' }), 409);
});
check('a stored page past a smaller count is clamped before stepping', () => {
  assert.strictEqual(ok(applyNotes({ page: 8, pages: 3 }, { step: 'prev' })).page, 1);
});

console.log('\n3. a measured plan (Phase 2 publishes it)');
check('pages are the sum of the plan', () => {
  const r = ok(applyNotes({ page: 0 }, { notesPlan: [1, 2, 1], planKey: 'sum-k' }));
  assert.deepStrictEqual([r.page, r.pages, r.plan, r.planKey], [0, 4, [1, 2, 1], 'sum-k']);
});
check('the stored page is clamped into a smaller plan', () => {
  assert.strictEqual(ok(applyNotes({ page: 6, pages: 7 }, { notesPlan: [1, 1], planKey: 'k' })).page, 1);
});
check(`a plan of more than ${MAX_PLAN_ENTRIES} sections is refused`, () => {
  refused(applyNotes({}, { notesPlan: new Array(MAX_PLAN_ENTRIES + 1).fill(1), planKey: 'k' }), 400);
});
for (const bad of [[0], [10], [1.5], ['2'], [], 'nope', null]) {
  check(`plan ${JSON.stringify(bad)} is refused`, () => refused(applyNotes({}, { notesPlan: bad, planKey: 'k' }), 400));
}
for (const key of [undefined, '', 'has space', 'x'.repeat(65), 42, '<script>']) {
  check(`planKey ${JSON.stringify(key)} is refused`, () => refused(applyNotes({}, { notesPlan: [1], planKey: key }), 400));
}

console.log('\n4. junk is refused, and nothing stored is text');
for (const body of [
  {}, { notesPage: -1 }, { notesPage: 1.5 }, { notesPage: '2' }, { notesPage: 1, notesPages: 0 },
  { notesPage: 1, notesPages: 100 }, { step: 'forward' }, { step: 'next', notesPage: 1 },
  { notesPage: 0, notesPlan: [1], planKey: 'k' }, null, 'next',
]) {
  check(`body ${JSON.stringify(body)} is a 400`, () => refused(applyNotes({}, body), 400));
}
check('every stored value is an integer, an integer list, null, or the validated key', () => {
  const results = [
    applyNotes({}, { notesPage: 1, notesPages: 3 }),
    applyNotes({ page: 0, pages: 3 }, { step: 'next' }),
    applyNotes({}, { notesPlan: [2, 1], planKey: 'abc_1-2:x' }),
  ];
  for (const r of results) {
    for (const [k, v] of Object.entries(r)) {
      if (k === 'ok') continue;
      if (k === 'planKey') { assert.ok(v === null || /^[A-Za-z0-9:_-]{1,64}$/.test(v), `planKey ${v}`); continue; }
      if (Array.isArray(v)) { assert.ok(v.every(Number.isInteger), `${k} ${v}`); continue; }
      assert.ok(v === null || Number.isInteger(v), `${k} is ${typeof v}`);
    }
  }
});
check('a junk stored record does not throw', () => {
  ok(applyNotes({ page: 'x', pages: 'y', plan: 'z' }, { notesPage: 0 }));
});

console.log('\n5. the frontend mirror carries the same rule, word for word');
const block = (file) => {
  const src = fs.readFileSync(path.join(REPO, file), 'utf8');
  const m = /\/\/ ── shared:stage-notes BEGIN[^\n]*\n([\s\S]*?)\/\/ ── shared:stage-notes END/.exec(src);
  return m ? m[1] : null;
};
const server = block('lambda-functions/game/stage-notes.js');
const client = block('src/src/config/stageNotes.js');
check('both files carry the shared block', () => {
  assert.ok(server, 'no shared block in lambda-functions/game/stage-notes.js');
  assert.ok(client, 'no shared block in src/src/config/stageNotes.js');
});
check('the two blocks are identical', () => assert.strictEqual(client, server));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
