/**
 * THE GROUNDING CHECK (lambda-functions/game/followup-grounding.js), against
 * the prototype's own model outputs (docs/design/ca-followup-asks/prototype/
 * prototype-runs.json) and the numbers PROTOTYPE.md measured with the same
 * rule (prototype/check.py):
 *
 *   - 3 of 4 agree statements kept; Sonnet r3's 26-word statement dropped;
 *   - every choice ask marked Reworded (0 of 4 copied exactly);
 *   - Sonnet r2's 115-character question marked long;
 *   - punctuation, case and curly quotes ignored when copying is judged;
 *   - a statement or option naming anybody in the roster dropped;
 *   - (2026-10-13, docs/design/followup-icons) the kinds are Ideas / Choose /
 *     Rate: the prototype's `agree` reads as `rate` and `open` as `ideas` (the
 *     same shapes), and every ask's anchor is checked against the stored read.
 */
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const G = require(path.join(REPO, 'lambda-functions/game/followup-grounding.js'));
const { runs } = require(path.join(REPO, 'docs/design/ca-followup-asks/prototype/prototype-runs.json'));
const { rounds } = require(path.join(REPO, 'docs/design/ca-followup-asks/prototype/rounds.json'));

let pass = 0, fail = 0;
function check(label, fn) {
  try { fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const ALL = ['ideas', 'choice', 'rate'];
// The prototype ran the first build's vocabulary; the shapes are the same.
const RENAME = { agree: 'rate', open: 'ideas' };
const renamed = (asks) => asks.map((a) => ({ ...a, type: RENAME[a.type] || a.type }));
// Marks other than the anchor's: the prototype's reads gave no anchors.
const own = (a) => a.marks.filter((m) => m !== 'unanchored');
/** The B run's answers in the order the call was given them: by points, ties in the room's order. */
function material(roundKey) {
  const r = rounds[roundKey];
  const ranked = r.answers
    .map((a, i) => ({ a, i, p: 3 * a.first + 2 * a.second + a.third }))
    .sort((x, y) => y.p - x.p || x.i - y.i)
    .map((x) => x.a.text);
  return { answers: ranked, names: r.answers.map((a) => a.name) };
}
const run = (name) => runs.find((r) => r.run === name);
const checkRun = (name, opts) => {
  const r = run(name);
  const m = material(r.round);
  return G.checkSuggestions(renamed(r.asks), m.answers, m.names, opts);
};

console.log('\n1. the prototype runs (separate call, v2 rules), every kind allowed');
const hr3 = checkRun('B_haiku_r3', { kinds: ALL });
const hr2 = checkRun('B_haiku_r2', { kinds: ALL });
const sr3 = checkRun('B_sonnet_r3', { kinds: ALL });
const sr2 = checkRun('B_sonnet_r2', { kinds: ALL });

check("Haiku r3's backfill statement is kept, unmarked", () => {
  const rate = hr3.kept.find((a) => a.type === 'rate');
  assert.ok(rate, JSON.stringify(hr3));
  assert.match(rate.statement, /backfill cannot/);
  assert.deepStrictEqual(own(rate), []);
});
check("Sonnet r3's 26-word statement is dropped, as too long", () => {
  assert.ok(!sr3.kept.some((a) => a.type === 'rate'));
  assert.deepStrictEqual(sr3.reasons, { 'too-long': 1 });
  assert.strictEqual(sr3.dropped, 1);
});
check('3 of 4 rate statements survive', () => {
  const n = [hr3, hr2, sr3, sr2].reduce((s, r) => s + r.kept.filter((a) => a.type === 'rate').length, 0);
  assert.strictEqual(n, 3);
});
check('every choice ask is kept and marked reworded', () => {
  for (const r of [hr3, hr2, sr3, sr2]) {
    const choice = r.kept.find((a) => a.type === 'choice');
    assert.ok(choice, 'a choice ask was dropped');
    assert.ok(choice.marks.includes('reworded'), JSON.stringify(choice));
    assert.ok(choice.options.some((o) => o.marks.includes('reworded')));
  }
});
check("Sonnet r2's 115-character question is kept and marked long", () => {
  const ideas = sr2.kept.find((a) => a.type === 'ideas');
  assert.ok(ideas.question.length > 110);
  assert.deepStrictEqual(own(ideas), ['long']);
});
check('every kept ask carries its cited answers and its why, nothing more', () => {
  for (const r of [hr3, hr2, sr3, sr2]) {
    for (const a of r.kept) {
      assert.ok(Array.isArray(a.answers) && a.answers.length);
      assert.strictEqual(typeof a.why, 'string');
      for (const key of Object.keys(a)) assert.ok(['type', 'statement', 'question', 'options', 'answers', 'why', 'anchor', 'marks'].includes(key), key);
    }
  }
});

console.log('\n2. the kinds are Ideas, Choose and Rate');
check('the default kinds keep all three; the first build\'s agree is dropped by reason "type"', () => {
  const r = G.checkSuggestions(run('B_sonnet_r2').asks, material(run('B_sonnet_r2').round).answers, []);
  assert.ok(r.reasons.type >= 1, JSON.stringify(r.reasons));
  const k = checkRun('B_sonnet_r2');
  assert.deepStrictEqual(new Set(k.kept.map((a) => a.type)).size, k.kept.length);
});

console.log('\n3. the copy rule');
const ANSWERS = [
  "Code can be rolled back; a bad backfill can’t. I read every migration line by line.",
  'Ship it to one percent and watch the dashboards.',
  'Senior engineers write the tickets now.',
];
const agree = (statement, answers = [1]) => ({ type: 'rate', statement, answers, why: 'Tests it.' });
check('case, punctuation and curly apostrophes are ignored', () => {
  const r = G.checkSuggestions([agree("code can be rolled back, a bad backfill can't")], ANSWERS, []);
  assert.strictEqual(r.kept.length, 1, JSON.stringify(r));
});
check('a paraphrase is dropped as not copied', () => {
  const r = G.checkSuggestions([agree('Code is reversible but a backfill is not')], ANSWERS, []);
  assert.deepStrictEqual(r.reasons, { 'not-copied': 1 });
});
check('words copied out of order are not copied', () => {
  const r = G.checkSuggestions([agree('a bad backfill can be rolled back')], ANSWERS, []);
  assert.strictEqual(r.kept.length, 0);
});
check('a statement copied from a DIFFERENT answer than the one cited is dropped', () => {
  const r = G.checkSuggestions([agree('Senior engineers write the tickets now', [1])], ANSWERS, []);
  assert.deepStrictEqual(r.reasons, { 'not-copied': 1 });
});
check('citing an answer that does not exist drops the ask', () => {
  const r = G.checkSuggestions([agree('Senior engineers write the tickets now', [9])], ANSWERS, []);
  assert.deepStrictEqual(r.reasons, { answers: 1 });
});
check('an option copied exactly is unmarked; reworded, too long and same-answer options are marked', () => {
  const ask = (options) => ({ type: 'choice', question: 'Which first?', options, answers: [1, 2], why: 'Settles it.' });
  const exact = G.checkSuggestions([ask([{ text: 'read every migration', answer: 1 }, { text: 'Ship it to one percent', answer: 2 }])], ANSWERS, []);
  assert.deepStrictEqual(own(exact.kept[0]), []);
  const reworded = G.checkSuggestions([ask([{ text: 'read the migrations', answer: 1 }, { text: 'Ship it to one percent', answer: 2 }])], ANSWERS, []);
  assert.deepStrictEqual(reworded.kept[0].options.map((o) => o.marks), [['reworded'], []]);
  const long = G.checkSuggestions([ask([{ text: 'I read every migration line by line and more', answer: 1 }, { text: 'watch the dashboards', answer: 2 }])], ANSWERS, []);
  assert.deepStrictEqual(long.kept[0].options[0].marks, ['reworded']);
  const same = G.checkSuggestions([ask([{ text: 'read every migration', answer: 1 }, { text: 'a bad backfill', answer: 1 }])], ANSWERS, []);
  assert.deepStrictEqual(same.kept[0].options[1].marks, ['reworded']);
});
check('a choice with one option, or five, is dropped', () => {
  const one = G.checkSuggestions([{ type: 'choice', question: 'Q?', options: [{ text: 'a', answer: 1 }], answers: [1], why: '' }], ANSWERS, []);
  assert.deepStrictEqual(one.reasons, { fields: 1 });
});
check('more than three asks: the fourth is dropped', () => {
  const s = agree('Senior engineers write the tickets now', [3]);
  const r = G.checkSuggestions([s, s, s, s], ANSWERS, []);
  assert.strictEqual(r.kept.length, 3);
  assert.deepStrictEqual(r.reasons, { 'over-three': 1 });
});

console.log('\n2b. the anchor: a point of the read, or after it');
const READ = '## Discussion topics\n1. Would on-call trust a bot at 3am?\n2. Who would push back first?\n\n## Next steps\n- Run the shadow invoice.';
check('a real section and point is kept as written; case and a trailing colon do not matter', () => {
  const r = G.checkSuggestions([{ ...agree('Ship it to one percent', [2]), anchor: { section: 'discussion topics:', point: 2 } }], ANSWERS, [], { read: READ });
  const { text, ...where } = r.kept[0].anchor;
  assert.deepStrictEqual(where, { section: 'Discussion topics', point: 2 });
  // The point's own words travel with it (session flow v3 §4.2, AnchorText).
  assert.ok(typeof text === 'string' && text.length > 0, 'the anchor carries the point\'s text');
  assert.deepStrictEqual(r.kept[0].marks, []);
});
check('a heading the read never printed, a point past the list, or no anchor: kept, after the read, marked', () => {
  for (const anchor of [{ section: 'Risks', point: 1 }, { section: 'Next steps', point: 2 }, undefined]) {
    const r = G.checkSuggestions([{ ...agree('Ship it to one percent', [2]), anchor }], ANSWERS, [], { read: READ });
    assert.strictEqual(r.kept.length, 1);
    assert.strictEqual(r.kept[0].anchor, null);
    assert.deepStrictEqual(r.kept[0].marks, ['unanchored']);
  }
});

console.log('\n4. nobody is named to the room');
const NAMED = ['Ship it to one percent, Marcus said, and watch it.', 'Aisha keeps the IAM files.'];
check('a statement carrying a roster first name is dropped', () => {
  const r = G.checkSuggestions([agree('Ship it to one percent, Marcus said', [1])], NAMED, ['Marcus Hale', 'Aisha Rahman']);
  assert.deepStrictEqual(r.reasons, { names: 1 });
});
check('a last name counts, and a pick-one option naming someone drops the whole ask', () => {
  const r = G.checkSuggestions([{
    type: 'choice', question: 'Who holds IAM?', answers: [1, 2], why: '',
    options: [{ text: 'Ship it to one percent', answer: 1 }, { text: 'Aisha keeps the IAM files', answer: 2 }],
  }], NAMED, ['Aisha Rahman']);
  assert.deepStrictEqual(r.reasons, { names: 1 });
  const last = G.checkSuggestions([agree('Ship it to one percent', [1])], ['Ship it to one percent'], ['Percent']);
  assert.deepStrictEqual(last.reasons, { names: 1 });
});
check('a name in the host-only why is allowed through', () => {
  const r = G.checkSuggestions([{ ...agree('Ship it to one percent', [1]), why: "Tests Marcus's line." }], NAMED, ['Marcus Hale']);
  assert.strictEqual(r.kept.length, 1);
});
check('an initial is not treated as a name', () => {
  const r = G.checkSuggestions([agree('watch it', [1])], NAMED, ['J. Watch'.replace('Watch', 'W')]);
  assert.strictEqual(r.kept.length, 1);
});

console.log('\n5. it never trusts its input');
check('junk in, nothing kept, nothing thrown', () => {
  for (const junk of [null, 'asks', [null, 1, 'x', { type: 'agree' }, { type: 'nope', answers: [1] }]]) {
    const r = G.checkSuggestions(junk, ANSWERS, null);
    assert.strictEqual(r.kept.length, 0);
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
