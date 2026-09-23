/**
 * THE ONE FUNCTION THAT COUNTS A SURVEY.
 *
 * lambda-functions/game/survey-aggregate.js turns a survey's decrypted
 * response rows into the frozen results that close writes to SURVEY#RESULTS.
 * docs/design/survey-redesign/IMPLEMENTATION-phase-2.md, §2 "Aggregate" and
 * "Answer values", and Track B.
 *
 * The fixture reproduces the mockups' own survey — the numbers in
 * docs/design/survey-redesign/_src/content.py that the results page (30),
 * the wall (s-02..s-06) and the report (34) all draw — so the function and the
 * pictures cannot drift apart:
 *
 *   q1 rating 1–5      [1,2,6,15,14]            n 38, mean 4.03
 *   q2 rating 0–10     6 / 13 / 18              n 37, score +32
 *   q3 choice, one     [14,11,7,4,2]            n 38
 *   q4 choice, two     [22,17,12,9] + 3 other   n 36 (shares sum past 100%)
 *   q5 yes/no          24 / 11 / 3, why on No   n 38
 *   q6 rank top 3 of 5 firsts [13,12,5,3,2]     n 35, places 2.1 2.3 2.9 3.6 4.1
 *   q7 text            31 answers
 *   q8 text            27 answers
 *   42 rows: 38 finished, 3 partway, 1 that never answered anything
 *
 * // rejects: a second counting rule (unplaced = last, a rounding of its own),
 * //          a text id that follows arrival order, a name or respondent id
 * //          leaking into the frozen results, a bad row that throws, and a
 * //          second copy of this arithmetic anywhere else in the product.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const MODULE = path.join(REPO, 'lambda-functions/game/survey-aggregate.js');

let pass = 0; let fail = 0;
function check(label, fn) {
  try { fn(); console.log(`  PASS  ${label}`); pass++; } catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

let aggregate;
try {
  ({ aggregate } = require(MODULE));
} catch (e) {
  aggregate = () => { throw new Error(`survey-aggregate.js did not load: ${e.message}`); };
}

// ── The mockups' survey ───────────────────────────────────────────────────

const QID = (n) => `c001#00${n}`;
const Q1 = QID(1); const Q2 = QID(2); const Q3 = QID(3); const Q4 = QID(4);
const Q5 = QID(5); const Q6 = QID(6); const Q7 = QID(7); const Q8 = QID(8);

const QUESTIONS = [
  { qid: Q1, kind: 'rating', required: true, scale: '1-5', title: 'How useful was today’s session for your work?' },
  { qid: Q2, kind: 'rating', required: false, scale: '0-10', title: 'How likely are you to recommend this session to a colleague?' },
  { qid: Q3, kind: 'choice', required: true, allowMultiple: false,
    options: ['Live demo of the new console', 'The three customer case studies, with their renewal numbers',
      'Pricing roadmap for FY27', 'The open Q&A', 'Hiring plan update'],
    title: 'Which part of the presentation was most valuable to you?' },
  { qid: Q4, kind: 'choice', required: false, allowMultiple: true, maxPicks: 2, allowOther: true,
    options: ['More time for questions', 'A hands-on breakout', 'Slides sent a day ahead', 'A recording afterwards'],
    title: 'Which formats would you want more of next time?' },
  { qid: Q5, kind: 'yesno', required: true, unsure: true, followUpWhen: 'no',
    followUpPrompt: 'What would you cut or add?', title: 'Was the length about right?' },
  { qid: Q6, kind: 'rank', required: false, rankTop: 3,
    options: ['Customer stories', 'Product roadmap', 'Team wins', 'Culture & hiring', 'Financials'],
    title: 'Rank these topics for the next all-hands' },
  { qid: Q7, kind: 'text', required: false, textLength: 'long', maxLength: 500, themes: true,
    title: 'What was the best part of the presentation?' },
  { qid: Q8, kind: 'text', required: false, textLength: 'short', maxLength: 280, themes: true,
    title: 'What would you like to see added or changed?' },
];

/** `[[value, times], …]` → a flat list of values. */
const expand = (pairs) => pairs.flatMap(([v, times]) => Array.from({ length: times }, () => v));
const range = (lo, hi) => Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);

// q1: 1–5, [1,2,6,15,14]
const q1Values = expand([[1, 1], [2, 2], [3, 6], [4, 15], [5, 14]]);
// q2: 0–10 — 0–6 six, 7–8 thirteen, 9–10 eighteen
const q2Values = expand([[3, 1], [4, 1], [5, 2], [6, 2], [7, 6], [8, 7], [9, 8], [10, 10]]);
// q3: pick one, [14,11,7,4,2]
const q3Values = expand([[[0], 14], [[1], 11], [[2], 7], [[3], 4], [[4], 2]]);
// q4: up to two, [22,17,12,9] + 3 written in, 36 people
const q4Values = [
  ...expand([[[0, 1], 10], [[0, 2], 6], [[0, 3], 4], [[1, 2], 4], [[1, 3], 2]]),
  [0, { other: 'A one-page summary we can forward' }],
  [0], [1], [2], [2], [3], [3], [3],
  [{ other: 'Shorter, and on a Monday' }],
  [{ other: 'Lunch provided' }],
];
// q5: 24 yes, 11 no (9 say why), 3 not sure
const NO_WHYS = [
  'Cut the roadmap section in half and give that time to questions.',
  'Too long for a Tuesday afternoon. 30 minutes would have done it.',
  'Needed longer on the demo, less on hiring.',
  'Add ten minutes of breakouts and it would be the right length.',
  'The hiring update could have been an email.',
  'Pricing ran over and squeezed the Q&A.',
  'Forty minutes of slides is a lot before any discussion.',
  'Too short on the customer stories.',
  'Split it into two sessions.',
];
const q5Values = [
  ...expand([[{ v: 'yes' }, 24]]),
  ...NO_WHYS.map((why) => ({ v: 'no', why })),
  { v: 'no' }, { v: 'no' },
  ...expand([[{ v: 'unsure' }, 3]]),
];
// q6: top 3 of 5 — firsts [13,12,5,3,2]; averages 2.10 2.30 2.90 3.59 4.11
const q6Values = expand([
  [[0, 1, 2], 6], [[0, 1, 3], 1], [[0, 1, 4], 1], [[0, 2, 1], 2], [[0, 2, 3], 2], [[0, 3, 1], 1],
  [[1, 0, 2], 4], [[1, 0, 3], 2], [[1, 2, 0], 2], [[1, 2, 3], 1], [[1, 3, 0], 1], [[1, 3, 2], 1], [[1, 4, 2], 1],
  [[2, 0, 1], 2], [[2, 1, 0], 1], [[2, 3, 0], 2],
  [[3, 0, 2], 1], [[3, 1, 0], 1], [[3, 4, 0], 1],
  [[4, 0, 2], 1], [[4, 1, 0], 1],
]);
// q7: 31 open answers; q8: 27
const Q7_TEXTS = [
  'Seeing the console actually run beat every slide about it.',
  'The renewal figures on the big account were the first time I understood why pricing matters.',
  'Appreciated that the Q2 miss was named and not dressed up.',
  'Didn’t drag. Forty minutes felt like twenty.',
  ...range(5, 31).map((k) => `Best part, answer ${k}: the demo made it concrete (${k * 7}).`),
];
const Q8_TEXTS = [
  'Give Q&A twenty minutes, not five.',
  'A pre-read the day before so we can come with questions.',
  'The roadmap part could be half as long.',
  'Ten minutes in teams to talk about what it means for us.',
  ...range(5, 27).map((k) => `Change, answer ${k}: more time for questions (${k * 3}).`),
];

// Who answered what: rows 0–37 finished, 38–40 stopped partway, 41 never answered.
const ASSIGN = [
  [Q1, range(0, 37), q1Values],
  [Q2, [...range(0, 33), 38, 39, 40], q2Values],
  [Q3, range(0, 37), q3Values],
  [Q4, [...range(0, 32), 38, 39, 40], q4Values],
  [Q5, range(0, 37), q5Values],
  [Q6, [...range(0, 31), 38, 39, 40], q6Values],
  [Q7, range(0, 30), Q7_TEXTS],
  [Q8, range(5, 31), Q8_TEXTS],
];

const PEOPLE = ['Aisha Bello', 'Aleksandra Wiśniewska', 'Bartholomew Okonkwo-Fitzgerald', 'Dana Whitfield',
  'Lee Chen', 'Marcus Ola', 'Priya Raghavan', 'Sam Keller', 'Tomás Ferreira', 'Wes Duncan'];
const SESSION = '2026-09-22T13:55:04.117Z';
const respondentId = (i) => `r_${crypto.createHash('sha256').update(`resp-${i}`).digest('base64url').slice(0, 22)}`;
const clientId = (i) => `client-${i}-7c1e9a3b`;
const stamp = (i, s) => `2026-09-22T14:${String(10 + (i % 40)).padStart(2, '0')}:${s}.000Z`;

function buildRows() {
  const rows = range(0, 41).map((i) => ({
    // everything a stored row might carry that is NOT an answer
    PK: 'GAME#4821',
    SK: `SURVEY#RESP#${respondentId(i)}`,
    Name: PEOPLE[i % PEOPLE.length],
    ClientId: clientId(i),
    StartedAt: stamp(i, '11'),
    CompletedAt: i < 38 ? stamp(i, '47') : undefined,
    UpdatedAt: stamp(i, '52'),
    Session: SESSION,
    Rev: 3 + (i % 5),
    ttl: 1790000000 + i,
    Answers: {},
    Answered: [],
    Complete: i < 38,
  }));
  for (const [qid, who, values] of ASSIGN) {
    assert.strictEqual(who.length, values.length, `fixture: ${qid} assigns ${values.length} values to ${who.length} rows`);
    who.forEach((row, k) => {
      rows[row].Answers[qid] = values[k];
      rows[row].Answered.push(qid);
    });
  }
  rows[41].Answers[Q1] = null; // cleared the only answer they gave
  return rows;
}

/** A seeded Fisher–Yates, so a shuffle is reproducible. */
function shuffled(list, seed) {
  const out = list.slice();
  let s = seed;
  const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const sum = (list) => list.reduce((a, b) => a + b, 0);
const run = () => aggregate(QUESTIONS, buildRows());

// ── The totals ──────────────────────────────────────────────────────────────

check('the fixture itself adds up to the mockup (so a failure below is the function, not the data)', () => {
  assert.deepStrictEqual([q1Values.length, q2Values.length, q3Values.length, q4Values.length,
    q5Values.length, q6Values.length, Q7_TEXTS.length, Q8_TEXTS.length], [38, 37, 38, 36, 38, 35, 31, 27]);
});

check('the result has exactly N, Finished, Order, PerQuestion, Texts', () => {
  assert.deepStrictEqual(Object.keys(run()), ['N', 'Finished', 'Order', 'PerQuestion', 'Texts']);
});

check('N counts rows with at least one answer (41); Finished counts Complete rows (38)', () => {
  const out = run();
  assert.strictEqual(out.N, 41);
  assert.strictEqual(out.Finished, 38);
});

check('Order is the qids in question order, and PerQuestion has one entry for each', () => {
  const out = run();
  assert.deepStrictEqual(out.Order, QUESTIONS.map((q) => q.qid));
  assert.deepStrictEqual(Object.keys(out.PerQuestion), out.Order);
});

check('every entry says its kind', () => {
  const out = run();
  assert.deepStrictEqual(out.Order.map((q) => out.PerQuestion[q].kind),
    ['rating', 'rating', 'choice', 'choice', 'yesno', 'rank', 'text', 'text']);
});

// ── Rating ──────────────────────────────────────────────────────────────────

check('q1 rating 1–5: counts [1,2,6,15,14], n 38, mean 4.03, 76% in the top two', () => {
  const r = run().PerQuestion[Q1];
  assert.deepStrictEqual(r.counts, [1, 2, 6, 15, 14]);
  assert.strictEqual(r.n, 38);
  assert.strictEqual(r.mean, 4.03);
  assert.strictEqual(r.topTwo, 76);
  assert.strictEqual(r.scale, '1-5');
  assert.strictEqual(r.promoters, undefined, 'only 0–10 carries the recommend split');
});

check('q2 rating 0–10: 11 counts, detractors 6 / passives 13 / promoters 18, n 37, score +32', () => {
  const r = run().PerQuestion[Q2];
  assert.strictEqual(r.counts.length, 11);
  assert.deepStrictEqual(r.counts, [0, 0, 0, 1, 1, 2, 2, 6, 7, 8, 10]);
  assert.strictEqual(r.n, 37);
  assert.deepStrictEqual([r.detractors, r.passives, r.promoters], [6, 13, 18]);
  assert.strictEqual(r.score, 32);
  assert.strictEqual(r.topTwo, 49, 'top two of 0–10 is 9 and 10');
});

check('a stars question counts 1–5; a 1–10 question counts 1–10', () => {
  const qs = [{ qid: 's', kind: 'rating', scale: 'stars' }, { qid: 't', kind: 'rating', scale: '1-10' }];
  const out = aggregate(qs, [{ Answers: { s: 5, t: 10 } }, { Answers: { s: 1, t: 1 } }, { Answers: { s: 0, t: 0 } }]);
  assert.deepStrictEqual(out.PerQuestion.s.counts, [1, 0, 0, 0, 1]);
  assert.strictEqual(out.PerQuestion.s.n, 2, 'a 0 is off the stars scale');
  assert.strictEqual(out.PerQuestion.t.counts.length, 10);
  assert.strictEqual(out.PerQuestion.t.n, 2, 'a 0 is off the 1–10 scale');
  assert.strictEqual(out.PerQuestion.t.mean, 5.5);
});

check('a rating question with no scale reads as 1–5 (the contract default)', () => {
  const out = aggregate([{ qid: 'r', kind: 'rating' }], [{ Answers: { r: 5 } }, { Answers: { r: 6 } }]);
  assert.strictEqual(out.PerQuestion.r.scale, '1-5');
  assert.deepStrictEqual(out.PerQuestion.r.counts, [0, 0, 0, 0, 1]);
  assert.strictEqual(out.PerQuestion.r.n, 1);
});

check('the recommend score rounds half away from zero, both ways', () => {
  // 1 promoter, 7 detractors of 8 → −75 exactly; 3 of 8 vs 0 → +37.5 → +38; 0 vs 3 of 8 → −37.5 → −38
  const q = [{ qid: 'p', kind: 'rating', scale: '0-10' }];
  const rows = (vals) => vals.map((v) => ({ Answers: { p: v } }));
  assert.strictEqual(aggregate(q, rows([10, 0, 0, 0, 0, 0, 0, 0])).PerQuestion.p.score, -75);
  assert.strictEqual(aggregate(q, rows([10, 10, 10, 7, 7, 7, 7, 7])).PerQuestion.p.score, 38);
  assert.strictEqual(aggregate(q, rows([0, 0, 0, 7, 7, 7, 7, 7])).PerQuestion.p.score, -38);
});

check('an unanswered rating has n 0 and no mean, share or score (null, not NaN)', () => {
  const out = aggregate([{ qid: 'p', kind: 'rating', scale: '0-10' }], []);
  const r = out.PerQuestion.p;
  assert.strictEqual(r.n, 0);
  assert.strictEqual(r.mean, null);
  assert.strictEqual(r.topTwo, null);
  assert.strictEqual(r.score, null);
  assert.deepStrictEqual([r.detractors, r.passives, r.promoters], [0, 0, 0]);
});

// ── Choice ──────────────────────────────────────────────────────────────────

check('q3 pick one: counts [14,11,7,4,2], n 38, no write-ins', () => {
  const c = run().PerQuestion[Q3];
  assert.deepStrictEqual(c.counts, [14, 11, 7, 4, 2]);
  assert.strictEqual(c.n, 38);
  assert.strictEqual(c.other, 0);
  assert.deepStrictEqual(c.otherIds, []);
});

check('q4 pick up to two: 36 answered, counts [22,17,12,9], other 3, shares sum past 100%', () => {
  const out = run();
  const c = out.PerQuestion[Q4];
  assert.strictEqual(c.n, 36);
  assert.deepStrictEqual(c.counts, [22, 17, 12, 9]);
  assert.strictEqual(c.other, 3);
  assert.ok(sum(c.counts) + c.other > c.n, `picks ${sum(c.counts) + c.other} should exceed people ${c.n}`);
  assert.strictEqual(c.otherIds.length, 3);
  assert.deepStrictEqual(out.Texts[Q4].map((t) => t.id).sort(), c.otherIds.slice().sort());
  assert.deepStrictEqual(out.Texts[Q4].map((t) => t.text).sort(),
    ['A one-page summary we can forward', 'Lunch provided', 'Shorter, and on a Monday']);
  assert.ok(out.Texts[Q4].every((t) => !('v' in t)), 'a write-in carries no v');
});

// ── Yes / no ────────────────────────────────────────────────────────────────

check('q5 yes/no: 24 / 11 / 3, n 38, the nine whys filed under no', () => {
  const out = run();
  const y = out.PerQuestion[Q5];
  assert.deepStrictEqual(y.counts, { yes: 24, no: 11, unsure: 3 });
  assert.strictEqual(y.n, 38);
  assert.deepStrictEqual(Object.keys(y.whys), ['yes', 'no', 'unsure']);
  assert.strictEqual(y.whys.no.length, 9);
  assert.deepStrictEqual([y.whys.yes, y.whys.unsure], [[], []]);
  const byId = new Map(out.Texts[Q5].map((t) => [t.id, t]));
  for (const id of y.whys.no) assert.strictEqual(byId.get(id).v, 'no', id);
  assert.deepStrictEqual(out.Texts[Q5].map((t) => t.text).sort(), NO_WHYS.slice().sort());
});

// ── Rank ────────────────────────────────────────────────────────────────────

check('q6 rank: firsts [13,12,5,3,2] summing to 35, n 35', () => {
  const r = run().PerQuestion[Q6];
  assert.strictEqual(r.n, 35);
  assert.deepStrictEqual(r.firsts, [13, 12, 5, 3, 2]);
  assert.strictEqual(sum(r.firsts), 35);
});

check('q6 rank: average places are the mockup’s 2.1 2.3 2.9 3.6 4.1 and sum to 15 ± 0.05', () => {
  const r = run().PerQuestion[Q6];
  assert.deepStrictEqual(r.avgPlace, [2.1, 2.3, 2.9, 3.59, 4.11]);
  assert.deepStrictEqual(r.avgPlace.map((a) => Math.round(a * 10) / 10), [2.1, 2.3, 2.9, 3.6, 4.1]);
  assert.ok(Math.abs(sum(r.avgPlace) - 15) <= 0.05, `sum ${sum(r.avgPlace)}`);
});

check('q6 rank: placeHist counts explicit places 1st–5th; firsts is its first column; the rest are unplaced', () => {
  const r = run().PerQuestion[Q6];
  assert.strictEqual(r.placeHist.length, 5);
  r.placeHist.forEach((h, i) => {
    assert.strictEqual(h.length, 5);
    assert.strictEqual(h[0], r.firsts[i]);
    assert.deepStrictEqual(h.slice(3), [0, 0], 'a top-3 ranking places nothing 4th or 5th');
    assert.strictEqual(sum(h) + r.unplaced[i], r.n);
  });
  // every respondent placed exactly three
  assert.strictEqual(sum(r.placeHist.map(sum)), 35 * 3);
});

check('unplaced items share the mean of the unfilled places (top 3 of 5 → 4.5 each)', () => {
  const q = [{ qid: 'k', kind: 'rank', rankTop: 3, options: ['a', 'b', 'c', 'd', 'e'] }];
  const r = aggregate(q, [{ Answers: { k: [2, 0, 4] } }]).PerQuestion.k;
  assert.deepStrictEqual(r.avgPlace, [2, 4.5, 1, 4.5, 3]);
  assert.deepStrictEqual(r.unplaced, [0, 1, 0, 1, 0]);
  // a full ranking (of a rank-all question) leaves nothing unplaced; a single
  // pick shares 2..5 → 3.5
  const all = [{ qid: 'k', kind: 'rank', options: ['a', 'b', 'c', 'd', 'e'] }];
  const full = aggregate(all, [{ Answers: { k: [4, 3, 2, 1, 0] } }]).PerQuestion.k;
  assert.deepStrictEqual(full.avgPlace, [5, 4, 3, 2, 1]);
  const one = aggregate(q, [{ Answers: { k: [1] } }]).PerQuestion.k;
  assert.deepStrictEqual(one.avgPlace, [3.5, 1, 3.5, 3.5, 3.5]);
});

// rejects: counting 4th and 5th places on a top-3 question. The dev run saved
// [0,1,2,3,4] against rankTop 3; the PUT now refuses it, and a row that slipped
// past is a value that does not fit its question — ignored WHOLE, like any other.
check('a ranking longer than rankTop is ignored whole; exactly rankTop, or fewer, counts', () => {
  const q = [{ qid: 'k', kind: 'rank', rankTop: 3, options: ['a', 'b', 'c', 'd', 'e'] }];
  const r = aggregate(q, [
    { Answers: { k: [2, 0, 4] } },
    { Answers: { k: [0, 1, 2, 3, 4] } },
    { Answers: { k: [1, 0, 2, 3] } },
  ]);
  const k = r.PerQuestion.k;
  assert.strictEqual(k.n, 1);
  assert.strictEqual(r.N, 1, 'a row whose only answer was ignored still counted as answering');
  assert.deepStrictEqual(k.firsts, [0, 0, 1, 0, 0]);
  assert.deepStrictEqual(k.avgPlace, [2, 4.5, 1, 4.5, 3]);
  k.placeHist.forEach((h) => assert.deepStrictEqual(h.slice(3), [0, 0], 'a 4th or 5th place was counted'));
  const short = aggregate(q, [{ Answers: { k: [3] } }]).PerQuestion.k;
  assert.strictEqual(short.n, 1);
});

check('an unanswered rank has null average places, not NaN', () => {
  const r = aggregate([{ qid: 'k', kind: 'rank', options: ['a', 'b', 'c'] }], []).PerQuestion.k;
  assert.strictEqual(r.n, 0);
  assert.deepStrictEqual(r.avgPlace, [null, null, null]);
  assert.deepStrictEqual(r.firsts, [0, 0, 0]);
});

// ── Text ────────────────────────────────────────────────────────────────────

check('q7 / q8 text: n 31 / 27, with exactly as many answerIds and Texts entries', () => {
  const out = run();
  for (const [qid, n, texts] of [[Q7, 31, Q7_TEXTS], [Q8, 27, Q8_TEXTS]]) {
    const t = out.PerQuestion[qid];
    assert.strictEqual(t.n, n, qid);
    assert.strictEqual(t.answerIds.length, n, qid);
    assert.strictEqual(out.Texts[qid].length, n, qid);
    assert.deepStrictEqual(t.answerIds, out.Texts[qid].map((e) => e.id), qid);
    assert.deepStrictEqual(out.Texts[qid].map((e) => e.text).sort(), texts.slice().sort(), qid);
  }
});

check('text ids are <qid>:<k>, k counting from 0 in the order Texts lists them', () => {
  const out = run();
  for (const [qid, list] of Object.entries(out.Texts)) {
    list.forEach((e, k) => assert.strictEqual(e.id, `${qid}:${k}`));
  }
  assert.deepStrictEqual(Object.keys(out.Texts), [Q4, Q5, Q7, Q8], 'only questions with words, in question order');
});

check('text ids do not follow arrival order (the fixture’s row order is not the id order)', () => {
  const out = run();
  const idOrder = out.Texts[Q7].map((e) => e.text);
  assert.notDeepStrictEqual(idOrder, Q7_TEXTS, 'ids were handed out in row order');
});

check('an answer is trimmed; a blank one is no answer at all', () => {
  const q = [{ qid: 't', kind: 'text', maxLength: 500 }];
  const out = aggregate(q, [{ Answers: { t: '  hello  ' } }, { Answers: { t: '   ' } }, { Answers: { t: '' } }]);
  assert.strictEqual(out.PerQuestion.t.n, 1);
  assert.deepStrictEqual(out.Texts.t, [{ id: 't:0', text: 'hello' }]);
  assert.strictEqual(out.N, 1);
});

// ── Partial rows, order, privacy ────────────────────────────────────────────

check('a row holding only q1 counts toward q1 alone', () => {
  const out = aggregate(QUESTIONS, [{ Answers: { [Q1]: 4 }, Answered: [Q1], Complete: false }]);
  assert.strictEqual(out.N, 1);
  assert.strictEqual(out.Finished, 0);
  assert.strictEqual(out.PerQuestion[Q1].n, 1);
  for (const qid of out.Order.filter((q) => q !== Q1)) assert.strictEqual(out.PerQuestion[qid].n, 0, qid);
  assert.deepStrictEqual(out.Texts, {});
});

check('the same rows in any order give byte-identical output', () => {
  const rows = buildRows();
  const want = JSON.stringify(aggregate(QUESTIONS, rows));
  for (const seed of [1, 7, 42, 20260923]) {
    assert.strictEqual(JSON.stringify(aggregate(QUESTIONS, shuffled(buildRows(), seed))), want, `seed ${seed}`);
  }
  assert.strictEqual(JSON.stringify(aggregate(QUESTIONS, buildRows().reverse())), want, 'reversed');
});

check('the output carries no respondent id, name, clientId, timestamp or session stamp', () => {
  const json = JSON.stringify(run());
  const leaks = [];
  range(0, 41).forEach((i) => {
    for (const s of [respondentId(i), clientId(i), stamp(i, '11'), stamp(i, '47'), stamp(i, '52')]) {
      if (json.includes(s)) leaks.push(s);
    }
  });
  for (const s of [...PEOPLE, SESSION, 'SURVEY#RESP#', 'GAME#4821', 'r_']) if (json.includes(s)) leaks.push(s);
  for (const key of ['Name', 'ClientId', 'StartedAt', 'CompletedAt', 'UpdatedAt', 'Session', 'Rev', 'ttl', 'SK', 'PK']) {
    if (json.includes(`"${key}"`)) leaks.push(`key ${key}`);
  }
  assert.deepStrictEqual(leaks, []);
});

check('the rows it was given are not changed', () => {
  const rows = buildRows();
  const before = JSON.stringify(rows);
  aggregate(QUESTIONS, rows);
  assert.strictEqual(JSON.stringify(rows), before);
});

// ── Bad input never throws ──────────────────────────────────────────────────

check('nothing to count: no questions, no rows, or not arrays at all', () => {
  const empty = { N: 0, Finished: 0, Order: [], PerQuestion: {}, Texts: {} };
  assert.deepStrictEqual(aggregate(), empty);
  assert.deepStrictEqual(aggregate(null, null), empty);
  assert.deepStrictEqual(aggregate('x', 'y'), empty);
  assert.deepStrictEqual(aggregate([], []), empty);
});

check('malformed rows and values are ignored, never thrown on, and never counted', () => {
  const junk = [
    null, undefined, 'a row', 42, [], { Answers: null }, { Answers: [] }, { Answers: 'x' }, {},
    { Answers: { [Q1]: 'five' } }, { Answers: { [Q1]: 9 } }, { Answers: { [Q1]: 0 } }, { Answers: { [Q1]: 4.5 } },
    { Answers: { [Q1]: [4] } }, { Answers: { [Q1]: true } }, { Answers: { [Q1]: NaN } },
    { Answers: { [Q2]: 11 } }, { Answers: { [Q2]: -1 } },
    { Answers: { [Q3]: [99] } }, { Answers: { [Q3]: [0, 1] } }, { Answers: { [Q3]: [] } }, { Answers: { [Q3]: 0 } },
    { Answers: { [Q3]: [{ other: 'not offered' }] } }, { Answers: { [Q3]: ['0'] } }, { Answers: { [Q3]: [-1] } },
    { Answers: { [Q4]: [0, 0] } }, { Answers: { [Q4]: [0, 1, 2] } }, { Answers: { [Q4]: [{ other: 'x' }, 0] } },
    { Answers: { [Q4]: [0, { other: 42 }] } }, { Answers: { [Q4]: [0, { other: 'x'.repeat(281) }] } },
    { Answers: { [Q4]: [0, null] } }, { Answers: { [Q4]: [1.5] } },
    { Answers: { [Q5]: 'yes' } }, { Answers: { [Q5]: { v: 'maybe' } } }, { Answers: { [Q5]: { v: 'yes', why: 'no follow-up on yes' } } },
    { Answers: { [Q5]: { v: 'no', why: 'x'.repeat(281) } } }, { Answers: { [Q5]: { v: 'no', why: 7 } } }, { Answers: { [Q5]: [] } },
    { Answers: { [Q6]: [0, 0] } }, { Answers: { [Q6]: [9] } }, { Answers: { [Q6]: [] } }, { Answers: { [Q6]: 'abc' } },
    { Answers: { [Q6]: [0, 1, 2, 3, 4, 0] } }, { Answers: { [Q6]: [0, '1'] } },
    { Answers: { [Q7]: 42 } }, { Answers: { [Q7]: { text: 'hi' } } }, { Answers: { [Q7]: 'x'.repeat(501) } },
    { Answers: { [Q8]: 'y'.repeat(281) } },
    { Answers: { 'no-such-qid': 5, __proto__: { [Q1]: 5 } } },
    { Answers: JSON.parse(`{"__proto__": {"${Q1}": 5}, "constructor": 3}`) },
    { Answers: { [Q1]: undefined, [Q7]: null } },
  ];
  let out;
  assert.doesNotThrow(() => { out = aggregate(QUESTIONS, junk); });
  assert.strictEqual(out.N, 0, 'nothing valid was answered');
  assert.strictEqual(out.Finished, 0);
  for (const qid of out.Order) assert.strictEqual(out.PerQuestion[qid].n, 0, qid);
  assert.deepStrictEqual(out.Texts, {});
  assert.deepStrictEqual(out.PerQuestion[Q1].counts, [0, 0, 0, 0, 0]);
  assert.deepStrictEqual(out.PerQuestion[Q5].counts, { yes: 0, no: 0, unsure: 0 });
});

check('a bad value for one question does not cost the same row its good answers', () => {
  const out = aggregate(QUESTIONS, [{ Answers: { [Q1]: 5, [Q3]: [99], [Q7]: 'Fine.' }, Complete: true }]);
  assert.strictEqual(out.N, 1);
  assert.strictEqual(out.PerQuestion[Q1].n, 1);
  assert.strictEqual(out.PerQuestion[Q3].n, 0);
  assert.strictEqual(out.PerQuestion[Q7].n, 1);
});

check('unsure is only counted where it is offered', () => {
  const q = [{ qid: 'y', kind: 'yesno' }];
  const out = aggregate(q, [{ Answers: { y: { v: 'unsure' } } }, { Answers: { y: { v: 'yes' } } }]);
  assert.strictEqual(out.PerQuestion.y.n, 1);
  assert.deepStrictEqual(out.PerQuestion.y.counts, { yes: 1, no: 0, unsure: 0 });
});

check('a why is kept only where the question asks for one; "any" asks on every answer', () => {
  const q = [{ qid: 'y', kind: 'yesno', unsure: true, followUpWhen: 'any' }];
  const out = aggregate(q, [
    { Answers: { y: { v: 'unsure', why: 'Depends on the day.' } } },
    { Answers: { y: { v: 'yes', why: '  Right length.  ' } } },
    { Answers: { y: { v: 'no', why: '   ' } } },
  ]);
  const y = out.PerQuestion.y;
  assert.strictEqual(y.n, 3);
  assert.deepStrictEqual([y.whys.yes.length, y.whys.no.length, y.whys.unsure.length], [1, 0, 1]);
  assert.deepStrictEqual(out.Texts.y.map((t) => [t.v, t.text]).sort(), [['unsure', 'Depends on the day.'], ['yes', 'Right length.']]);
});

check('a question with missing optional fields still counts with the defaults', () => {
  const qs = [
    { qid: 'c', kind: 'choice', options: ['a', 'b'] },          // single pick, no other
    { qid: 'o', kind: 'choice' },                               // no options: nothing can match
    { qid: 't', kind: 'text' },                                 // no maxLength: the 2000 cap
    { qid: 'k', kind: 'rank', options: ['a', 'b', 'c'] },       // no rankTop
    { qid: 'y', kind: 'yesno' },                                // no unsure, no follow-up
  ];
  const out = aggregate(qs, [{ Answers: { c: [1], o: [0], t: 'z'.repeat(1500), k: [2, 0, 1], y: { v: 'no' } } }]);
  assert.deepStrictEqual(out.PerQuestion.c.counts, [0, 1]);
  assert.strictEqual(out.PerQuestion.o.n, 0);
  assert.deepStrictEqual(out.PerQuestion.o.counts, []);
  assert.strictEqual(out.PerQuestion.t.n, 1);
  assert.deepStrictEqual(out.PerQuestion.k.avgPlace, [2, 3, 1]);
  assert.deepStrictEqual(out.PerQuestion.y.counts, { yes: 0, no: 1, unsure: 0 });
});

check('an unknown kind or a question without a qid is carried as nothing, not thrown on', () => {
  const qs = [null, { kind: 'rating' }, { qid: '', kind: 'rating' }, { qid: 'u', kind: 'slider' }, { qid: 'r', kind: 'rating' },
    { qid: 'r', kind: 'text' }];
  let out;
  assert.doesNotThrow(() => { out = aggregate(qs, [{ Answers: { u: 3, r: 3 } }]); });
  assert.deepStrictEqual(out.Order, ['u', 'r'], 'the first of a duplicated qid wins');
  assert.deepStrictEqual(out.PerQuestion.u, { kind: 'slider', n: 0 });
  assert.strictEqual(out.PerQuestion.r.kind, 'rating');
  assert.strictEqual(out.N, 1);
});

// ── One place for this arithmetic ───────────────────────────────────────────

/**
 * Files that READ a frozen result's fields and are allowed to name them. A
 * renderer (Phase 3) that shows `avgPlace` from SURVEY#RESULTS belongs here,
 * with the reason; one that works a place, a share or a mean out for itself
 * does not — it moves into survey-aggregate.js instead.
 */
const READERS = new Map([]);

const OWN = 'lambda-functions/game/survey-aggregate.js';
function sourcesUnder(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '.aws-sam' || e.name === 'build') continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(c|m)?jsx?$/.test(e.name) && !/\.test\.jsx?$/.test(e.name) && !full.includes(`${path.sep}__tests__${path.sep}`)) {
        out.push(path.relative(REPO, full).split(path.sep).join('/'));
      }
    }
  };
  walk(path.join(REPO, dir));
  return out;
}
const SOURCES = [...sourcesUnder('lambda-functions'), ...sourcesUnder('src/src')];

check('the guard can see the aggregate itself (so an empty result below means something)', () => {
  assert.ok(SOURCES.includes(OWN), `${OWN} not among ${SOURCES.length} scanned files`);
  assert.ok(/\bavgPlace\b/.test(fs.readFileSync(path.join(REPO, OWN), 'utf8')));
});

check('nothing else under lambda-functions/ or src/src/ names avgPlace, topTwo or placeHist', () => {
  const offenders = SOURCES.filter((f) => f !== OWN && !READERS.has(f))
    .filter((f) => /\b(avgPlace|topTwo|placeHist)\b/.test(fs.readFileSync(path.join(REPO, f), 'utf8')));
  assert.deepStrictEqual(offenders, [], 'survey arithmetic belongs in survey-aggregate.js; a pure reader goes in READERS with its reason');
});

check('no survey file works out a mean or an average of its own', () => {
  // `mean = total / n`, `avg: sum / count`, `averagePlace = …/…` — a division
  // assigned to a mean-ish name, in any file whose path names a survey
  // (survey-*.js, components/survey/, useSurvey*). Matching on the path, not on
  // the word: "survey" is a game type, so dozens of files mention it, and two of
  // them average trivia scores (get-ai-summary.js, PromptVariableInspector.jsx).
  const MEAN = /\b(mean|avg\w*|average\w*)\s*(?::|=(?!=))[^;\n]*[^/*\s]\s*\/\s*[^/*\s]/i;
  const offenders = SOURCES.filter((f) => f !== OWN && !READERS.has(f) && /survey/i.test(f))
    .filter((f) => fs.readFileSync(path.join(REPO, f), 'utf8').split('\n')
      .some((line) => MEAN.test(line.replace(/\/\/.*$/, ''))));
  assert.deepStrictEqual(offenders, [], 'a survey mean belongs in survey-aggregate.js');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
