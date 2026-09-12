/**
 * The wavelength unanimity engine — the whole contract, pure.
 *
 * Spec: docs/superpowers/specs/2026-08-09-wavelength-convergence-design.md §7
 * names what is worth writing, and this file is that list:
 *
 *   - the unanimity rule (landed / near-miss / nothing landed)
 *   - the denominator (submitters, not the room)
 *   - the shortest-submission ceiling
 *   - the strongest-non-empty-tier selection
 *   - canonical-label determinism including both tie-breaks
 *   - the clustering contract against a stubbed model: the merge pairs
 *     (database/databases/dbs/DBMS) AND the never-merge pairs (cloud/AWS,
 *     database/storage) — the never-merge cases are the ones that matter,
 *     because a clustering test that only proves things merge passes when
 *     the model merges everything.
 *
 * What each test would reject: an implementation that reverts to count>1
 * (the shipped bug this spec exists to correct), one that counts the room
 * instead of submitters, one that lets a merge proposal invent words or
 * chain overlapping groups, and one whose labels depend on iteration order.
 */
const path = require('path');
const assert = require('assert');

const {
  matchKey,
  canonicalLabel,
  buildClusters,
  applyMerges,
  analyzeWavelength,
  buildMergePrompt,
  parseMergeReply,
} = require(path.join(__dirname, '..', 'lambda-functions/game/wavelength.js'));

let pass = 0, fail = 0;
function check(label, fn) {
  try { fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const sub = (player, ...words) => ({ player, words });
const landed = (a) => a.commonWords.map((w) => w.word);

console.log('\n1. deterministic matching — the "what merges" list and nothing more');

check('case, surrounding punctuation and whitespace collapse', () => {
  assert.strictEqual(matchKey(' Database! '), matchKey('database'));
  assert.strictEqual(matchKey('"TRUST"'), matchKey('trust'));
});

check('hyphenation and spacing variants collapse', () => {
  assert.strictEqual(matchKey('data base'), matchKey('data-base'));
  assert.strictEqual(matchKey('data base'), matchKey('database'));
});

check('different words stay different', () => {
  assert.notStrictEqual(matchKey('database'), matchKey('databases'));
  assert.notStrictEqual(matchKey('cloud'), matchKey('aws'));
});

check('a submission with no letters or digits is nothing', () => {
  assert.strictEqual(matchKey('!!!'), '');
  assert.strictEqual(matchKey('  '), '');
});

console.log('\n2. unanimity — a word lands when EVERYONE WHO SUBMITTED said it');

check('said by all three submitters: lands', () => {
  const a = analyzeWavelength([
    sub('Ada', 'summit', 'ridge'),
    sub('Grace', 'Summit', 'valley'),
    sub('Lin', 'summit!', 'scree'),
  ]);
  // Label: 'summit'/'Summit' tie on frequency and length; alphabetical is by
  // code point, where uppercase sorts first — deterministic is the requirement.
  assert.deepStrictEqual(landed(a), ['Summit']);
  assert.strictEqual(a.teamScore, 1);
});

check('said by two of three: does NOT land (count>1 is the old, wrong game)', () => {
  const a = analyzeWavelength([
    sub('Ada', 'summit'),
    sub('Grace', 'summit'),
    sub('Lin', 'valley'),
  ]);
  assert.deepStrictEqual(landed(a), []);
});

check('everything else still shows, with the number of people who said it', () => {
  const a = analyzeWavelength([
    sub('Ada', 'summit', 'ridge'),
    sub('Grace', 'summit', 'ridge'),
    sub('Lin', 'summit'),
  ]);
  assert.deepStrictEqual(landed(a), ['summit']);
  const ridge = a.words.find((w) => w.word === 'ridge');
  assert.strictEqual(ridge.count, 2);
});

check('a player repeating a word counts once — unanimity asks who, not how often', () => {
  const a = analyzeWavelength([
    sub('Ada', 'db', 'DB', 'db'),
    sub('Grace', 'ridge'),
  ]);
  assert.deepStrictEqual(landed(a), []);
  assert.strictEqual(a.words.find((w) => matchKey(w.word) === 'db').count, 1);
});

console.log('\n3. the denominator is submitters, not the room');

check('someone who submitted nothing usable cannot zero the result', () => {
  const a = analyzeWavelength([
    sub('Ada', 'summit'),
    sub('Grace', 'summit'),
    sub('Ghost'),               // joined, never answered
    sub('Blank', '', '!!!'),    // submitted nothing that is a word
  ]);
  assert.strictEqual(a.submitterCount, 2);
  assert.deepStrictEqual(landed(a), ['summit']);
});

check('the shortest submission is a ceiling — arithmetic, not a bug', () => {
  const a = analyzeWavelength([
    sub('Ada', 'one', 'two', 'three', 'four', 'five'),
    sub('Grace', 'one', 'two', 'three', 'four', 'five'),
    sub('Lin', 'one', 'two'),   // ran dry at two
  ]);
  assert.deepStrictEqual(landed(a).sort(), ['one', 'two']);
});

check('no submitters at all: nothing lands, nothing crashes', () => {
  const a = analyzeWavelength([]);
  assert.strictEqual(a.submitterCount, 0);
  assert.deepStrictEqual(a.commonWords, []);
  assert.deepStrictEqual(a.nearMiss, []);
  assert.strictEqual(a.teamScore, 0);
});

console.log('\n4. the strongest non-empty tier when nothing is unanimous');

check('near-miss is the highest count at least two people share', () => {
  const a = analyzeWavelength([
    sub('Ada', 'summit', 'ridge'),
    sub('Grace', 'summit', 'scree'),
    sub('Lin', 'valley', 'ridge'),
    sub('Mo', 'summit', 'tarn'),
  ]);
  assert.deepStrictEqual(landed(a), []);
  assert.deepStrictEqual(a.nearMiss.map((w) => w.word), ['summit']);
  assert.strictEqual(a.nearMiss[0].count, 3);
});

check('everything unique: near-miss is honestly empty, not padded', () => {
  const a = analyzeWavelength([
    sub('Ada', 'summit'),
    sub('Grace', 'valley'),
  ]);
  assert.deepStrictEqual(a.nearMiss, []);
});

check('near-miss is empty when something DID land', () => {
  const a = analyzeWavelength([
    sub('Ada', 'summit', 'ridge'),
    sub('Grace', 'summit', 'ridge'),
  ]);
  assert.deepStrictEqual(landed(a).sort(), ['ridge', 'summit']);
  assert.deepStrictEqual(a.nearMiss, []);
});

console.log('\n5. the canonical label — deterministic, both tie-breaks');

check('most frequent surface form wins', () => {
  assert.strictEqual(canonicalLabel({ Database: 3, database: 1 }), 'Database');
});

check('frequency tie breaks to the shortest', () => {
  assert.strictEqual(canonicalLabel({ databases: 2, database: 2 }), 'database');
});

check('length tie breaks alphabetically', () => {
  assert.strictEqual(canonicalLabel({ beta: 1, alfa: 1 }), 'alfa');
});

check('the same submissions always produce the same result', () => {
  const submissions = [
    sub('Ada', 'Trust', 'candor', 'data base'),
    sub('Grace', 'trust!', 'Candor', 'database'),
  ];
  assert.deepStrictEqual(analyzeWavelength(submissions), analyzeWavelength(submissions));
});

console.log('\n6. cluster members are recorded — a merge nobody can audit is a merge nobody should trust');

check('every cluster carries its surface forms', () => {
  const a = analyzeWavelength([
    sub('Ada', 'data base'),
    sub('Grace', 'Database'),
  ]);
  const c = a.words[0];
  assert.deepStrictEqual(c.members, ['Database', 'data base']);
});

console.log('\n7. applyMerges — validation is the safety mechanism');

const base = () => buildClusters([
  sub('Ada', 'database', 'cloud'),
  sub('Grace', 'databases', 'aws'),
  sub('Lin', 'dbs', 'storage'),
]);

check('a valid merge unions players and keeps every member', () => {
  const merged = applyMerges(base(), [['database', 'databases', 'dbs']]);
  const c = merged.get(matchKey('database'));
  assert.strictEqual(c.players.size, 3);
  assert.deepStrictEqual(Object.keys(c.surfaces).sort(), ['databases', 'database', 'dbs'].sort());
});

check('a member naming no existing word is dropped, not invented', () => {
  const merged = applyMerges(base(), [['database', 'databases', 'postgres']]);
  assert.strictEqual(merged.get(matchKey('database')).players.size, 2);
  assert.strictEqual(merged.has(matchKey('postgres')), false);
});

check('a group left with one real key merges nothing', () => {
  const merged = applyMerges(base(), [['database', 'mongodb']]);
  assert.strictEqual(merged.get(matchKey('database')).players.size, 1);
  assert.strictEqual(merged.size, base().size);
});

check('overlapping groups cannot chain distinct ideas together', () => {
  // If the model says {database, databases} and then {databases, storage},
  // honouring both would fold storage into database THROUGH databases.
  const merged = applyMerges(base(), [
    ['database', 'databases'],
    ['databases', 'storage'],
  ]);
  assert.ok(merged.has(matchKey('storage')), 'storage was chained away');
  assert.strictEqual(merged.get(matchKey('database')).players.size, 2);
});

check('the input map is not mutated', () => {
  const before = base();
  applyMerges(before, [['database', 'databases', 'dbs']]);
  assert.strictEqual(before.get(matchKey('database')).players.size, 1);
});

console.log('\n8. the clustering contract, end to end against a stubbed model');

// The fixture the spec names: db/dbs/DBMS/database are ONE idea; cloud/AWS and
// database/storage are NOT. The stubbed model proposes exactly the right merge —
// the assertions that matter are that the never-merge pairs SURVIVE, because
// nothing downstream may repair an over-eager model.
check('merge pairs merge, never-merge pairs never do', () => {
  const submissions = [
    sub('Ada', 'database', 'cloud', 'fast'),
    sub('Grace', 'databases', 'AWS', 'performance'),
    sub('Lin', 'DBMS', 'cloud', 'fast'),
  ];
  const modelReply = 'Here you go:\n```json\n[["database", "databases", "DBMS"]]\n```';
  const a = analyzeWavelength(submissions, { merges: parseMergeReply(modelReply) });

  /* The label is the form the model nominated by putting it FIRST — `database`.
     This assertion used to read ['DBMS'], because with all three surfaces at
     count 1 the old rule fell through to "shortest wins". That rule is still
     the fallback, but a nomination outranks it now (see 8b): an abbreviation
     winning on length is the same defect as a misspelling winning on
     alphabetical order, and `database` is what a room can read from the back. */
  assert.deepStrictEqual(landed(a), ['database']);
  assert.notStrictEqual(matchKey('cloud'), matchKey('aws'));
  assert.ok(a.words.find((w) => w.word === 'cloud' && w.count === 2), 'cloud merged away');
  assert.ok(a.words.find((w) => w.word === 'AWS' && w.count === 1), 'AWS merged away');
  assert.ok(a.words.find((w) => w.word === 'fast' && w.count === 2), 'fast merged away');
  assert.ok(a.words.find((w) => w.word === 'performance'), 'performance merged away');
});

check('the prompt states the tie-break and lists every entry', () => {
  const prompt = buildMergePrompt(['database', 'cloud']);
  assert.ok(/WHEN IN DOUBT, DO NOT MERGE/.test(prompt));
  assert.ok(prompt.includes('- database') && prompt.includes('- cloud'));
});

/*
  SAME ROOT, DIFFERENT FORM — widened 2026-08-28 on the owner's call, after a
  session where `better` and `betterment` were counted as two answers:
  "wavelength did not refine the list for mispellings or like words".

  The original contract said "plurals and inflections of one term", which reads
  as INFLECTION only — betterment is a DERIVATION, so a model following the
  letter of that prompt was right to leave the pair alone. The line moves to the
  root: one root, one answer, whatever suffix it is wearing.

  This is the loosest the merge rule has ever been, so the never-merge half is
  asserted alongside it rather than assumed. Two different roots stay two
  answers however closely related they are, and that is what stops the widening
  from becoming "merge anything that looks similar".
*/
check('the prompt merges different forms built from one root', () => {
  const prompt = buildMergePrompt(['better', 'betterment']);
  assert.ok(/root/i.test(prompt),
    'the merge rule is still stated as inflection-only — betterment stays split');
});

// rejects: a widening that also collapses distinct roots. The spec's one
// unbreakable rule is that a merge must never manufacture agreement.
check('and still refuses two different roots, however related', () => {
  const prompt = buildMergePrompt(['cloud', 'AWS']);
  assert.ok(/NEVER merge/.test(prompt));
  assert.ok(/different roots?/i.test(prompt),
    'nothing in the prompt tells the model that a shared meaning is not a shared root');
});

/*
  THE LABEL IS THE SPELLING A ROOM SHOULD READ, NOT THE ONE THAT SORTED FIRST.

  Observed on dev: score, scoer and scroe merged correctly and the wall printed
  "scoer". The tie-break is most-frequent, then shortest, then alphabetical —
  and with every surface at count 1 and length 5, alphabetical picked the typo.
  The owner's ask: "i would like it to pick the correct spelling for the label
  not the one mispelled".

  The engine has no dictionary and cannot know. The MODEL already does — it is
  being asked which of these words are the same term, and which spelling is the
  real one is the same kind of judgment. So it nominates, by putting the
  canonical form FIRST in the group, and the engine validates: a nomination that
  is not a surface the room actually said is ignored and the deterministic rule
  stands. The model can no more invent a label than it can invent a merge.

  Frequency deliberately does NOT win here. A label is a heading, not a
  quotation — every member is still listed in the "Counted together" tooltip —
  so three people spelling it wrong should not put the typo on a projector.
*/
console.log('\n8b. the merged cluster is labelled with the spelling the model nominates');

check('the nominated form becomes the label, over the alphabetical tie-break', () => {
  const submissions = [
    sub('Ada', 'score'),
    sub('Grace', 'scoer'),
    sub('Lin', 'scroe'),
  ];
  // All three are length 5 and count 1, so the old rule returns 'scoer'.
  const a = analyzeWavelength(submissions, { merges: [['score', 'scoer', 'scroe']] });
  assert.deepStrictEqual(landed(a), ['score'],
    'the wall is still showing whichever misspelling sorted first');
});

// rejects: a nomination the room never said becoming a label the room never saw.
check('a nomination nobody submitted is ignored, and the old rule stands', () => {
  const submissions = [
    sub('Ada', 'score'),
    sub('Grace', 'scoer'),
    sub('Lin', 'scroe'),
  ];
  const a = analyzeWavelength(submissions, { merges: [['SCORING', 'scoer', 'score', 'scroe']] });
  assert.ok(['scoer', 'score', 'scroe'].includes(landed(a)[0]),
    `the label is "${landed(a)[0]}", which nobody wrote`);
});

check('the deterministic rule is unchanged when nothing is nominated', () => {
  const submissions = [sub('Ada', 'ridge'), sub('Grace', 'ridges')];
  // No merges at all: two clusters, each labelled by its own single surface.
  const a = analyzeWavelength(submissions);
  assert.deepStrictEqual(a.words.map((w) => w.word).sort(), ['ridge', 'ridges']);
});

check('the prompt asks for the correct spelling first', () => {
  const prompt = buildMergePrompt(['score', 'scoer']);
  assert.ok(/first/i.test(prompt),
    'nothing tells the model that position in the group means anything');
  assert.ok(/spelling|canonical|correct/i.test(prompt),
    'the model is not told WHICH form to put first');
});

console.log('\n9. parseMergeReply — strict about shape, tolerant about wrapping');

check('fenced JSON parses', () =>
  assert.deepStrictEqual(parseMergeReply('```json\n[["a","b"]]\n```'), [['a', 'b']]));

check('bare JSON with prose around it parses', () =>
  assert.deepStrictEqual(parseMergeReply('Sure! [["a","b"]] — done.'), [['a', 'b']]));

check('an empty merge set is an answer, not an error', () =>
  assert.deepStrictEqual(parseMergeReply('[]'), []));

check('garbage, prose and wrong shapes come back as []', () => {
  assert.deepStrictEqual(parseMergeReply('I could not decide'), []);
  assert.deepStrictEqual(parseMergeReply('{"a":"b"}'), []);
  assert.deepStrictEqual(parseMergeReply('[["only-one"]]'), []);
  assert.deepStrictEqual(parseMergeReply('[[1,2]]'), []);
  assert.deepStrictEqual(parseMergeReply(null), []);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
