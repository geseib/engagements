// tests/publishable-text.js
const path = require('path');
const assert = require('assert');
const REPO = path.join(__dirname, '..');
const P = require(path.join(REPO, 'lambda-functions/admin/shared/publishable.js'));
let pass = 0; let fail = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); pass += 1; }
  catch (e) { console.log(`  FAIL  ${name}\n        ${e.message}`); fail += 1; }
}
const question = {
  PK: 'ORG#org_x#SET#s#v2', SK: 'QUESTION#q001', Title: 'Describe the injury', Detail: 'In detail.',
  AnswerDetails: 'The reveal', CustomInstructions: 'Be graphic', optionA: 'Alpha', optionB: 'Beta',
  options: ['one', 'two'], Category: 'c001', School: 'x', Image: '', Active: true, points: 10,
};
const meta = { PK: 'ORG#org_x#SETS', SK: 'SET#s', name: 'Safety', description: 'A rude description', customInstruction: 'ci', aiContextInstruction: 'ai', roundKindBrief: 'rkb', engagementType: 'trivia', promptId: 'p1' };
const categories = [{ PK: 'ORG#org_x#SET#s#v2', SK: 'CATEGORY#c001', Name: 'Injuries', QuestionCount: 1 }];
(async () => {
  console.log('\npublishable text\n');
  // rejects: judging title + body only, which is what shipped — the reveal,
  // the options and the per-question instruction never reached the guardrail.
  await check('questionText carries every judged field, including AnswerDetails with its real casing', () => {
    const t = P.questionText(question);
    for (const s of ['Describe the injury', 'In detail.', 'The reveal', 'Be graphic', 'Alpha', 'Beta', 'one', 'two']) {
      assert.ok(t.includes(s), `missing ${JSON.stringify(s)} in ${JSON.stringify(t)}`);
    }
    assert.ok(!t.includes('c001') && !t.includes('ORG#'), 'keys or ids leaked into the judged text');
  });
  await check('setText carries the set prose and every category name', () => {
    const t = P.setText(meta, categories);
    for (const s of ['Safety', 'A rude description', 'ci', 'ai', 'rkb', 'Injuries']) assert.ok(t.includes(s), `missing ${s}`);
    assert.ok(!t.includes('p1'), 'promptId is not judged text');
  });
  await check('a snapshot holds whole rows without partition keys, and the hash is stable and sensitive', () => {
    const snap = P.buildSnapshot({ source: { scope: 'org', orgId: 'org_x', setId: 's' }, version: 2, meta, categories, questions: [question], checkedAt: 'T' });
    assert.strictEqual(snap.questions[0].PK, undefined, 'PK carried into the snapshot');
    assert.strictEqual(snap.questions[0].SK, 'QUESTION#q001');
    assert.strictEqual(snap.questions[0].points, 10, 'a non-judged field publish needs was dropped');
    assert.strictEqual(snap.meta.PK, undefined);
    const h1 = P.contentHash(snap);
    const h2 = P.contentHash(P.buildSnapshot({ source: { scope: 'org', orgId: 'org_x', setId: 's' }, version: 2, meta, categories, questions: [question], checkedAt: 'LATER' }));
    assert.strictEqual(h1, h2, 'checkedAt changed the hash');
    const edited = { ...question, AnswerDetails: 'A different reveal' };
    const h3 = P.contentHash(P.buildSnapshot({ source: { scope: 'org', orgId: 'org_x', setId: 's' }, version: 2, meta, categories, questions: [edited], checkedAt: 'T' }));
    assert.notStrictEqual(h1, h3, 'an edited reveal did not change the hash');
    assert.match(h1, /^[0-9a-f]{64}$/);
  });
  await check('question order does not change the hash; question identity does', () => {
    const q2 = { ...question, SK: 'QUESTION#q002', Title: 'Second' };
    const a = P.contentHash(P.buildSnapshot({ source: { scope: 'org', orgId: 'o', setId: 's' }, version: 1, meta, categories, questions: [question, q2], checkedAt: 'T' }));
    const b = P.contentHash(P.buildSnapshot({ source: { scope: 'org', orgId: 'o', setId: 's' }, version: 1, meta, categories, questions: [q2, question], checkedAt: 'T' }));
    assert.strictEqual(a, b);
    const renamed = { ...question, SK: 'QUESTION#q003' };
    const c = P.contentHash(P.buildSnapshot({ source: { scope: 'org', orgId: 'o', setId: 's' }, version: 1, meta, categories, questions: [renamed, q2], checkedAt: 'T' }));
    assert.notStrictEqual(a, c, 'a question with the same content but a different identity hashed the same');
  });
  await check('snapshotHasImages is true only when a question carries an Image', () => {
    const none = P.buildSnapshot({ source: { scope: 'org', orgId: 'o', setId: 's' }, version: 1, meta, categories, questions: [question], checkedAt: 'T' });
    const some = P.buildSnapshot({ source: { scope: 'org', orgId: 'o', setId: 's' }, version: 1, meta, categories, questions: [{ ...question, Image: 'sets/s/q001.png' }], checkedAt: 'T' });
    assert.strictEqual(P.snapshotHasImages(none), false);
    assert.strictEqual(P.snapshotHasImages(some), true);
  });
  console.log(`\n${pass} passed, ${fail} failed\n`);
  if (fail) process.exit(1);
})();
