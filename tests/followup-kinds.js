/**
 * THE PURE PIECES OF THE FOLLOW-UP ASKS (docs/design/ca-followup-asks PLAN
 * T2, reworked for Ideas / Choose / Rate by docs/design/followup-icons A1;
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

console.log('\n1. the kinds (Ideas, Choose, Rate — docs/design/followup-icons)');
check('ideas, choice and rate only; agree and anything else refused with words the host can act on', () => {
  assert.deepStrictEqual([...K.KINDS], ['ideas', 'choice', 'rate']);
  for (const kind of ['agree', 'open', 'rating', '', undefined]) {
    const r = K.normalizeFollowUp({ kind, question: 'Q?' });
    assert.ok(r.error && /kind must be one of: ideas, choice, rate/.test(r.error), JSON.stringify(r));
  }
});
check('a rate statement is trimmed, whitespace folded, capped', () => {
  assert.deepStrictEqual(K.normalizeFollowUp({ kind: 'rate', statement: '  Code can be\n rolled back ' }).value.statement, 'Code can be rolled back');
  assert.match(K.normalizeFollowUp({ kind: 'rate', statement: '' }).error, /Write the statement/);
  assert.match(K.normalizeFollowUp({ kind: 'rate', statement: 'x'.repeat(K.LIMITS.statement + 1) }).error, /at most 300/);
});
check('an ideas question is a question and nothing else', () => {
  assert.deepStrictEqual(K.normalizeFollowUp({ kind: 'ideas', question: ' Which customer first? ', options: [{ text: 'x' }] }).value,
    { kind: 'ideas', statement: '', question: 'Which customer first?', options: [], fromAnswers: [], suggestionIndex: null });
  assert.match(K.normalizeFollowUp({ kind: 'ideas' }).error, /Write the question/);
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
  assert.deepStrictEqual(K.toSurveyQuestion({ Kind: 'rate', Statement: 'x' }),
    { kind: 'rating', scale: '1-5', lowLabel: 'Disagree', highLabel: 'Agree', required: true });
  assert.deepStrictEqual(K.toSurveyQuestion({ kind: 'ideas', question: 'q' }), { kind: 'text', maxLength: 280, required: true });
  const choice = K.toSurveyQuestion({ kind: 'choice', options: [{ text: 'a' }, { text: 'b' }] });
  assert.deepStrictEqual(choice, { kind: 'choice', options: ['a', 'b'], allowMultiple: false, allowOther: false, maxPicks: 1 });
  assert.strictEqual(K.toSurveyQuestion({ kind: 'agree' }), null);
});
check('values are checked with the survey\'s own rules; no clear, no blank idea, no write-in, one pick', () => {
  const rate = { Kind: 'rate', Statement: 'x' };
  const ideas = { Kind: 'ideas', Question: 'q' };
  const choice = { Kind: 'choice', Options: [{ text: 'a' }, { text: 'b' }, { text: 'c' }] };
  assert.deepStrictEqual(K.checkValue(rate, 4), { ok: true, value: 4 });
  for (const bad of [0, 6, 2.5, '4', null]) assert.strictEqual(K.checkValue(rate, bad).ok, false, String(bad));
  assert.deepStrictEqual(K.checkValue(ideas, '  the agencies on fixed budgets '), { ok: true, value: 'the agencies on fixed budgets' });
  assert.strictEqual(K.checkValue(ideas, '   ').ok, false);
  assert.strictEqual(K.checkValue(ideas, 'x'.repeat(281)).ok, false);
  assert.strictEqual(K.checkValue({ Kind: 'agree' }, { v: 'yes' }).ok, false);
  assert.deepStrictEqual(K.checkValue(choice, [2]), { ok: true, value: [2] });
  assert.strictEqual(K.checkValue(choice, [0, 1]).ok, false);
  assert.strictEqual(K.checkValue(choice, [3]).ok, false);
  assert.strictEqual(K.checkValue(choice, [{ other: 'lunch' }]).ok, false);
  assert.strictEqual(K.checkValue(choice, 'a').ok, false);
});
check('the tally is the aggregate\'s: rate gives the five counts and the average; counts only', () => {
  const ask = { Kind: 'rate' };
  const q = K.toSurveyQuestion(ask);
  const rows = [5, 4, 4, 1, 2].map((v) => ({ Answers: { q: v } }));
  const { PerQuestion } = aggregate([{ qid: 'q', ...q }], rows);
  assert.deepStrictEqual(K.tallyOf(ask, PerQuestion.q), { n: 5, counts: [1, 1, 0, 2, 1], mean: 3.2 });
  assert.deepStrictEqual(K.tallyOf(ask, { n: 0 }), { n: 0, counts: [0, 0, 0, 0, 0], mean: null });
  assert.deepStrictEqual(K.tallyOf({ Kind: 'ideas' }, { n: 3 }), { n: 3 });
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
check('a rate sent as suggested is "suggested"; a changed statement is "edited"; ideas the same', () => {
  const s = { type: 'rate', statement: 'Code can be rolled back', answers: [2], why: '', marks: [] };
  assert.strictEqual(K.resolveOrigin(K.normalizeFollowUp({ kind: 'rate', statement: 'Code can be rolled back' }).value, s).origin, 'suggested');
  assert.strictEqual(K.resolveOrigin(K.normalizeFollowUp({ kind: 'rate', statement: 'Code can always be rolled back' }).value, s).origin, 'edited');
  const i = { type: 'ideas', question: 'Which customer first?', answers: [1], why: '', marks: [] };
  assert.strictEqual(K.resolveOrigin(K.normalizeFollowUp({ kind: 'ideas', question: 'Which customer first?' }).value, i).origin, 'suggested');
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

// Session flow v3 §4.2: the ask keeps Workie's words, what the host changed,
// where it was sent from and how many could answer.
check('Workie\'s words are copied as they were, with the reason and the answers', () => {
  const sug = { type: 'choice', question: 'Which first?', options: [{ text: 'A', answer: 1 }, { text: 'B', answer: 2 }], why: 'Two camps.', answers: [1, 2] };
  assert.deepStrictEqual(K.suggestedOf(sug), { kind: 'choice', question: 'Which first?', options: ['A', 'B'], why: 'Two camps.', answers: [1, 2] });
  assert.strictEqual(K.suggestedOf(null), null);
});
check('the edits name what changed: kind, question, options; none when sent as written or from blank', () => {
  const sug = { type: 'choice', question: 'Which first?', options: [{ text: 'A' }, { text: 'B' }] };
  assert.deepStrictEqual(K.editsOf({ kind: 'choice', question: 'Which first?', options: [{ text: 'A' }, { text: 'B' }] }, sug), []);
  assert.deepStrictEqual(K.editsOf({ kind: 'choice', question: 'Which one first?', options: [{ text: 'A' }, { text: 'C' }] }, sug), ['question', 'options']);
  assert.deepStrictEqual(K.editsOf({ kind: 'ideas', question: 'Which first?' }, sug), ['kind']);
  assert.deepStrictEqual(K.editsOf({ kind: 'ideas', question: 'Anything?' }, null), []);
});
check('the send context is checked: laptop or remote, a whole room size, nothing else', () => {
  assert.deepStrictEqual(K.sendContextOf({ sentFrom: 'laptop', roomSize: 4 }), { sentFrom: 'laptop', roomSize: 4 });
  assert.deepStrictEqual(K.sendContextOf({ sentFrom: 'tv', roomSize: -1 }), { sentFrom: null, roomSize: null });
  assert.deepStrictEqual(K.sendContextOf({ roomSize: '4' }), { sentFrom: null, roomSize: 4 });
  assert.deepStrictEqual(K.sendContextOf(undefined), { sentFrom: null, roomSize: null });
});

console.log('\n9. the scale\'s two ends (owner, 16 Oct: "host should be able to change what the high low says")');
check('no ends: the default pair, Disagree to Agree', () => {
  assert.deepStrictEqual(K.normalizeFollowUp({ kind: 'rate', statement: 'x' }).value.ends, { low: 'Disagree', high: 'Agree' });
  assert.deepStrictEqual(K.normalizeFollowUp({ kind: 'rate', statement: 'x', ends: null }).value.ends, { low: 'Disagree', high: 'Agree' });
  assert.deepStrictEqual(K.endsOf({ Kind: 'rate', Statement: 'x' }), { low: 'Disagree', high: 'Agree' });
});
check('custom ends are trimmed, whitespace folded, 1 to 24 characters each, both required', () => {
  assert.deepStrictEqual(K.normalizeFollowUp({ kind: 'rate', statement: 'x', ends: { low: '  Cold ', high: 'Very\n hot' } }).value.ends, { low: 'Cold', high: 'Very hot' });
  assert.deepStrictEqual(K.normalizeFollowUp({ kind: 'rate', statement: 'x', ends: { low: 'a'.repeat(24), high: 'b' } }).value.ends, { low: 'a'.repeat(24), high: 'b' });
  for (const ends of [{ low: '', high: 'Hot' }, { low: 'Cold', high: '   ' }, { low: 'a'.repeat(25), high: 'b' }, { low: 'Cold' }, { low: 3, high: 'Hot' }, 'Cold-Hot']) {
    const r = K.normalizeFollowUp({ kind: 'rate', statement: 'x', ends });
    assert.ok(r.error && /1 to 24 characters/.test(r.error), JSON.stringify(ends));
  }
});
check('only a rate ask carries ends', () => {
  assert.ok(!('ends' in K.normalizeFollowUp({ kind: 'ideas', question: 'q', ends: { low: 'a', high: 'b' } }).value));
});
check('the phone\'s survey question carries the ask\'s own ends, stored or normalized', () => {
  assert.deepStrictEqual(K.toSurveyQuestion({ Kind: 'rate', Statement: 'x', Ends: { low: 'Cold', high: 'Hot' } }),
    { kind: 'rating', scale: '1-5', lowLabel: 'Cold', highLabel: 'Hot', required: true });
  assert.deepStrictEqual(K.toSurveyQuestion({ kind: 'rate', statement: 'x', ends: { low: 'No', high: 'Yes' } }).lowLabel, 'No');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
