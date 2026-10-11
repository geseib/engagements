/**
 * THE PURE PIECES OF THE FOLLOW-UP ASKS (docs/design/ca-followup-asks PLAN
 * T2, T4, T9): what one ask is (followup-kinds.js), the numbered answers the
 * suggestion call is given (numbered-answers.js), and the keys
 * (followup-keys.js).
 */
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const K = require(path.join(REPO, 'lambda-functions/game/followup-kinds.js'));
const N = require(path.join(REPO, 'lambda-functions/game/numbered-answers.js'));
const KEYS = require(path.join(REPO, 'lambda-functions/game/followup-keys.js'));
const { aggregate } = require(path.join(REPO, 'lambda-functions/game/survey-aggregate.js'));

let pass = 0, fail = 0;
function check(label, fn) {
  try { fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

console.log('\n1. the kinds (first build: agree and pick-one)');
check('agree and choice only; open and anything else refused with words the host can act on', () => {
  assert.deepStrictEqual([...K.KINDS], ['agree', 'choice']);
  for (const kind of ['open', 'rating', '', undefined]) {
    const r = K.normalizeFollowUp({ kind, question: 'Q?' });
    assert.ok(r.error && /kind must be one of: agree, choice/.test(r.error), JSON.stringify(r));
  }
});
check('an agree statement is trimmed, whitespace folded, capped', () => {
  assert.deepStrictEqual(K.normalizeFollowUp({ kind: 'agree', statement: '  Code can be\n rolled back ' }).value.statement, 'Code can be rolled back');
  assert.match(K.normalizeFollowUp({ kind: 'agree', statement: '' }).error, /Write the statement/);
  assert.match(K.normalizeFollowUp({ kind: 'agree', statement: 'x'.repeat(K.LIMITS.statement + 1) }).error, /at most 300/);
});
check('a pick-one takes 2 to 4 distinct options, each capped', () => {
  const opts = (n) => Array.from({ length: n }, (_, i) => ({ text: `option ${i}`, answer: i + 1 }));
  assert.match(K.normalizeFollowUp({ kind: 'choice', question: 'Q?', options: opts(1) }).error, /at least 2/);
  assert.match(K.normalizeFollowUp({ kind: 'choice', question: 'Q?', options: opts(5) }).error, /at most 4/);
  assert.match(K.normalizeFollowUp({ kind: 'choice', question: 'Q?', options: [{ text: 'A' }, { text: 'a' }] }).error, /same thing/);
  assert.match(K.normalizeFollowUp({ kind: 'choice', question: 'Q?', options: [{ text: 'x'.repeat(121) }, { text: 'b' }] }).error, /at most 120/);
  assert.match(K.normalizeFollowUp({ kind: 'choice', options: opts(2) }).error, /Write the question/);
  const ok = K.normalizeFollowUp({ kind: 'choice', question: ' Which? ', options: [{ text: ' one ', answer: 2 }, 'two', { text: '' }], fromAnswers: [2, 2, 'x', 0, 3], suggestionIndex: 1 });
  assert.deepStrictEqual(ok.value, {
    kind: 'choice', statement: '', question: 'Which?',
    options: [{ text: 'one', answer: 2 }, { text: 'two', answer: null }],
    fromAnswers: [2, 3], suggestionIndex: 1,
  });
});
check('every kind round-trips through the survey shape the phone already draws', () => {
  const agree = K.toSurveyQuestion({ Kind: 'agree', Statement: 'x' });
  assert.deepStrictEqual(agree, { kind: 'yesno', yesLabel: 'Agree', noLabel: 'Disagree', unsure: true, followUpWhen: '' });
  const choice = K.toSurveyQuestion({ kind: 'choice', options: [{ text: 'a' }, { text: 'b' }] });
  assert.deepStrictEqual(choice, { kind: 'choice', options: ['a', 'b'], allowMultiple: false, allowOther: false, maxPicks: 1 });
  assert.strictEqual(K.toSurveyQuestion({ kind: 'open' }), null);
});
check('values are checked with the survey\'s own rules; no clear, no why, no write-in, one pick', () => {
  const agree = { Kind: 'agree', Statement: 'x' };
  const choice = { Kind: 'choice', Options: [{ text: 'a' }, { text: 'b' }, { text: 'c' }] };
  assert.deepStrictEqual(K.checkValue(agree, { v: 'unsure' }), { ok: true, value: { v: 'unsure' } });
  assert.strictEqual(K.checkValue(agree, { v: 'maybe' }).ok, false);
  assert.strictEqual(K.checkValue(agree, { v: 'yes', why: 'because' }).ok, false);
  assert.strictEqual(K.checkValue(agree, null).ok, false);
  assert.deepStrictEqual(K.checkValue(choice, [2]), { ok: true, value: [2] });
  assert.strictEqual(K.checkValue(choice, [0, 1]).ok, false);
  assert.strictEqual(K.checkValue(choice, [3]).ok, false);
  assert.strictEqual(K.checkValue(choice, [{ other: 'lunch' }]).ok, false);
  assert.strictEqual(K.checkValue(choice, 'a').ok, false);
});
check('the tally is the aggregate\'s, in the fixed agree words; counts only', () => {
  const ask = { Kind: 'agree' };
  const q = K.toSurveyQuestion(ask);
  const rows = [{ v: 'yes' }, { v: 'yes' }, { v: 'no' }, { v: 'unsure' }].map((v) => ({ Answers: { q: v } }));
  const { PerQuestion } = aggregate([{ qid: 'q', ...q }], rows);
  assert.deepStrictEqual(K.tallyOf(ask, PerQuestion.q), { n: 4, counts: { agree: 2, unsure: 1, disagree: 1 } });
  const c = { Kind: 'choice', Options: [{ text: 'a' }, { text: 'b' }] };
  const cr = aggregate([{ qid: 'q', ...K.toSurveyQuestion(c) }], [[1], [1], [0]].map((v) => ({ Answers: { q: v } })));
  assert.deepStrictEqual(K.tallyOf(c, cr.PerQuestion.q), { n: 3, counts: [1, 2] });
  assert.ok(!JSON.stringify(K.tallyOf(c, cr.PerQuestion.q)).includes('%'));
});

console.log('\n2. where an ask came from is decided by the server');
const SUGGESTION = {
  type: 'choice', question: 'Which first?', answers: [1, 4], why: 'Settles it.', marks: ['reworded'],
  options: [{ text: 'read every migration', answer: 1, marks: [] }, { text: 'watch dashboards', answer: 4, marks: ['reworded'] }],
};
check('sent as written: suggested; a copied option keeps its answer, a reworded one is the host\'s words', () => {
  const v = K.normalizeFollowUp({ kind: 'choice', question: 'Which first?', options: SUGGESTION.options, suggestionIndex: 0 }).value;
  const r = K.resolveOrigin(v, SUGGESTION);
  assert.strictEqual(r.origin, 'suggested');
  assert.deepStrictEqual(r.options, [{ text: 'read every migration', answer: 1 }, { text: 'watch dashboards', ownWords: true }]);
  assert.deepStrictEqual(r.fromAnswers, [1, 4]);
});
check('one word changed: edited, and the changed option is "your words"', () => {
  const v = K.normalizeFollowUp({ kind: 'choice', question: 'Which first?', options: [{ text: 'read every migration twice', answer: 1 }, { text: 'watch dashboards', answer: 4 }], suggestionIndex: 0 }).value;
  const r = K.resolveOrigin(v, SUGGESTION);
  assert.strictEqual(r.origin, 'edited');
  assert.ok(r.options.every((o) => o.ownWords));
});
check('no suggestion: the host\'s own, every option their words, no answers claimed', () => {
  const v = K.normalizeFollowUp({ kind: 'choice', question: 'Q?', options: [{ text: 'a', answer: 1 }, { text: 'b', answer: 2 }] }).value;
  assert.deepStrictEqual(K.resolveOrigin(v, null), { origin: 'host', options: [{ text: 'a', ownWords: true }, { text: 'b', ownWords: true }], fromAnswers: [] });
});
check('an agree sent as suggested is "suggested"; a changed statement is "edited"', () => {
  const s = { type: 'agree', statement: 'Code can be rolled back', answers: [2], why: '', marks: [] };
  assert.strictEqual(K.resolveOrigin(K.normalizeFollowUp({ kind: 'agree', statement: 'Code can be rolled back' }).value, s).origin, 'suggested');
  assert.strictEqual(K.resolveOrigin(K.normalizeFollowUp({ kind: 'agree', statement: 'Code can always be rolled back' }).value, s).origin, 'edited');
});

console.log('\n3. the numbered answers (no names, the read\'s order)');
const answers = [
  { playerName: 'Ada', answer: 'Read the interface diff' },
  { playerName: 'Grace', answer: 'Security files only' },
  { playerName: 'Linus', answer: 'Watch production' },
  { playerName: 'Barbara', answer: 'Read  every\nline' },
];
const tallies = { 0: { totalScore: 5 }, 1: { totalScore: 9 }, 2: { totalScore: 5 }, 3: { totalScore: 0 } };
check('ranked by points, ties kept in the room\'s order, numbered from 1', () => {
  assert.deepStrictEqual(N.rankAnswers(answers, tallies), [
    { n: 1, text: 'Security files only', points: 9 },
    { n: 2, text: 'Read the interface diff', points: 5 },
    { n: 3, text: 'Watch production', points: 5 },
    { n: 4, text: 'Read every line', points: 0 },
  ]);
});
check('the prompt lines carry the points and never a name, on a named round', () => {
  const text = N.numberedAnswersText(N.rankAnswers(answers, tallies));
  assert.strictEqual(text.split('\n')[0], '1. (9 vote points) "Security files only"');
  assert.ok(text.includes('4. (0 vote points) "Read every line"'));
  for (const a of answers) assert.ok(!text.includes(a.playerName), a.playerName);
});
check('the read\'s own sort, for the same input, gives the same order', () => {
  // get-ai-summary.js generateAISummary: answers.map(...).sort((a, b) => b.score - a.score)
  const read = answers.map((a, idx) => ({ answer: a.answer, score: tallies[idx].totalScore })).sort((a, b) => b.score - a.score);
  assert.deepStrictEqual(N.rankAnswers(answers, tallies).map((a) => a.points), read.map((a) => a.score));
  assert.deepStrictEqual(N.rankAnswers(answers, tallies).slice(0, 3).map((a) => a.text), read.slice(0, 3).map((a) => a.answer));
});

console.log('\n4. the keys');
check('the four row kinds, each prefix ending in #', () => {
  assert.strictEqual(KEYS.suggestedSk('3'), 'FOLLOWUP#003#SUGGESTED');
  assert.strictEqual(KEYS.askSk(3, 'abc123def'), 'FOLLOWUP#003#ASK#abc123def');
  assert.strictEqual(KEYS.answerSk('003', 'abc123def', 'Ada #1'), 'FOLLOWUP#003#ASK#abc123def#A#Ada #1');
  assert.strictEqual(KEYS.asksPrefix(3), 'FOLLOWUP#003#ASK#');
  assert.strictEqual(KEYS.answersPrefix(3, 'abc123def'), 'FOLLOWUP#003#ASK#abc123def#A#');
  assert.strictEqual(KEYS.roundPrefix(30), 'FOLLOWUP#030#');
  assert.ok(!KEYS.askSk(3, 'abc123defg').startsWith(KEYS.askSk(3, 'abc123def') + '#'));
});
check('a segment it cannot vouch for gives null, never a row', () => {
  for (const bad of ['', '0', '000', 'x', '1000', null, '-1']) assert.strictEqual(KEYS.suggestedSk(bad), null, String(bad));
  for (const bad of ['', 'ABC123', 'a#b', 'short', 'x'.repeat(41)]) assert.strictEqual(KEYS.askSk(3, bad), null, bad);
  assert.strictEqual(KEYS.answerSk(3, 'abc123def', '   '), null);
});
check('parse is the inverse, names with # included', () => {
  assert.deepStrictEqual(KEYS.parseFollowUpSk('FOLLOWUP#003#SUGGESTED'), { kind: 'suggested', round: '003' });
  assert.deepStrictEqual(KEYS.parseFollowUpSk('FOLLOWUP#003#ASK#abc123def'), { kind: 'ask', round: '003', askId: 'abc123def' });
  assert.deepStrictEqual(KEYS.parseFollowUpSk('FOLLOWUP#003#ASK#abc123def#A#Ada #1'), { kind: 'answer', round: '003', askId: 'abc123def', playerName: 'Ada #1' });
  assert.deepStrictEqual(KEYS.parseFollowUpSk('FOLLOWUP#LIVE'), { kind: 'live' });
  assert.strictEqual(KEYS.parseFollowUpSk('COMMENT#003#summary##x'), null);
});
check('ask ids sort in the order they were sent', () => {
  const a = KEYS.newAskId(1760000000000, 'aaaaaa');
  const b = KEYS.newAskId(1760000000001, '000000');
  assert.ok(KEYS.isAskId(a) && KEYS.isAskId(b));
  assert.ok(a < b);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
