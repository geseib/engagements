/**
 * THE RUNNING ORDER, AS ARITHMETIC — lambda-functions/game/question-plan.js.
 *
 * No database, no stubs, no handler. The whole point of the module is that the
 * rule deciding what the room sees next is a pure function, so the rule can be
 * enumerated here rather than inferred from a sequence of stubbed calls.
 *
 * Everything below clusters on one property: THE PEEK AND THE SERVE MUST AGREE.
 * An Up Next that shows a question the handler then does not serve is worse
 * than no Up Next at all — it is a screen that lies, which this repo already
 * treats as a bug class of its own.
 */
const assert = require('assert');
const path = require('path');

const {
  hashString, pickIndex, seedFor, nextFromCategory, planAhead,
} = require(path.join(__dirname, '..', 'lambda-functions/game/question-plan.js'));

let pass = 0, fail = 0;
function check(label, fn) {
  try { fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

/** A category of `n` questions in natural order, cursor at the top. */
const cat = (categoryId, position, n, cursor = 0) => ({
  categoryId,
  position,
  questionCount: n,
  cursor,
  order: Array.from({ length: n }, (_, i) => String(i + 1).padStart(3, '0')),
});

const ids = (plan) => plan.map((p) => p.questionId);

(async () => {
  console.log('\n§1  the hash is the same everywhere, always');

  check('it is deterministic', () => {
    assert.strictEqual(hashString('engage::3'), hashString('engage::3'));
  });

  check('the index it produces is ALWAYS in range', () => {
    /*
      THE PROPERTY, ASSERTED WHERE IT MATTERS — on pickIndex, not on the hash.

      An earlier version of this test checked `hashString(...) >= 0` over 400
      inputs and was worthless: the module carries two unsigned coercions, and
      mutation testing showed EITHER ONE ALONE is sufficient, so removing
      either left the suite green. Only removing both makes hashes negative
      (about half of them, measured over 18,000 pairs) — and the consequence is
      a negative index, an out-of-range read, and `undefined` silently chosen as
      the category.

      So sweep the real function over the real key shape and assert the thing
      the caller depends on. This fails the moment a negative can escape,
      however it got there.
    */
    for (let session = 0; session < 300; session += 1) {
      for (let round = 1; round <= 60; round += 1) {
        const index = pickIndex(`game-${session}`, round, 7);
        assert.ok(index >= 0 && index < 7,
          `pickIndex out of range: ${index} for game-${session} round ${round}`);
      }
    }
  });

  check('different rounds of one session diverge', () => {
    const seen = new Set();
    for (let round = 1; round <= 40; round += 1) seen.add(pickIndex('game-7311', round, 1000));
    // rejects: a hash that ignores the round and pins every round to one
    // category — the failure that looks like "it always asks Pricing".
    assert.ok(seen.size > 25, `only ${seen.size} distinct picks in 40 rounds`);
  });

  check('the seed and round cannot be confused with each other', () => {
    // rejects: concatenating without a separator. 'a1' + 2 and 'a' + 12 would
    // hash identically, marching two unrelated sessions in lockstep.
    assert.notStrictEqual(pickIndex('a1', 2, 997), pickIndex('a', 12, 997));
  });

  check('an empty option list asks for nothing', () => {
    assert.strictEqual(pickIndex('s', 1, 0), -1);
    assert.strictEqual(pickIndex('s', 1, -3), -1);
  });

  console.log('\n§2  the seed exists for every session, including old ones');

  check('a stored seed is used', () => {
    assert.strictEqual(seedFor({ RandomSeed: 'abc' }), 'abc');
  });

  check('a session without one falls back to its game id', () => {
    // rejects: a migration. Every game in flight acquires a deterministic order
    // the moment this ships, with nothing to backfill.
    assert.strictEqual(seedFor({ GameId: '7311' }), '7311');
  });

  check('the fallback is never random', () => {
    // rejects: `Math.random()` as a default, which would make the peek and the
    // serve disagree on every call — invisibly, and only on old sessions.
    const game = { GameId: '7311' };
    assert.strictEqual(seedFor(game), seedFor(game));
  });

  console.log('\n§3  a category hands over its questions in order, skipping spent ones');

  check('it starts at the cursor', () => {
    const r = nextFromCategory(cat('c001', 1, 5, 2), new Set());
    assert.deepStrictEqual(r, { index: 2, questionId: 'QUESTION#c001#003' });
  });

  check('it steps over an already-asked question', () => {
    const r = nextFromCategory(cat('c001', 1, 5, 0), new Set(['QUESTION#c001#001']));
    assert.deepStrictEqual(r, { index: 1, questionId: 'QUESTION#c001#002' });
  });

  check('a category with everything asked is exhausted, not repeated', () => {
    const asked = new Set(['QUESTION#c001#001', 'QUESTION#c001#002']);
    assert.strictEqual(nextFromCategory(cat('c001', 1, 2, 0), asked), null);
  });

  console.log('\n§4  the plan is the real rule, run forward');

  check('it returns the next N in order', () => {
    const plan = planAhead({ seed: 's', categories: [cat('c001', 1, 5)], isRandomized: false }, 3);
    assert.deepStrictEqual(ids(plan),
      ['QUESTION#c001#001', 'QUESTION#c001#002', 'QUESTION#c001#003']);
  });

  check('each step SPENDS its question, so nothing repeats', () => {
    // rejects: planning every step against the same starting snapshot, which
    // returns the same question N times — the most likely way to write this
    // wrong, and it looks plausible in a demo with one category.
    const plan = planAhead({ seed: 's', categories: [cat('c001', 1, 5)], isRandomized: false }, 5);
    assert.strictEqual(new Set(ids(plan)).size, 5);
  });

  check('it does not mutate the caller\'s snapshot', () => {
    // rejects: simulating over the live objects. The handler is about to act on
    // this same state; spending questions in it would corrupt the real round.
    const categories = [cat('c001', 1, 5)];
    planAhead({ seed: 's', categories, isRandomized: false }, 3);
    assert.strictEqual(categories[0].cursor, 0, 'the caller\'s cursor moved');
  });

  check('a short set returns a short list rather than padding', () => {
    // rejects: inventing rows to reach `count`. Running out is the fact the
    // host most wants to see coming.
    const plan = planAhead({ seed: 's', categories: [cat('c001', 1, 2)], isRandomized: false }, 6);
    assert.strictEqual(plan.length, 2);
  });

  check('questions already asked never appear in the plan', () => {
    const plan = planAhead({
      seed: 's',
      categories: [cat('c001', 1, 4)],
      asked: new Set(['QUESTION#c001#002']),
      isRandomized: false,
    }, 3);
    assert.deepStrictEqual(ids(plan),
      ['QUESTION#c001#001', 'QUESTION#c001#003', 'QUESTION#c001#004']);
  });

  console.log('\n§5  the host\'s running order comes first, and is tagged');

  check('queued items lead, in the host\'s order', () => {
    const plan = planAhead({
      seed: 's',
      queue: ['c001#004', 'c001#005'],
      categories: [cat('c001', 1, 5)],
      isRandomized: false,
      resolveQueued: (k) => ({ categoryId: 'c001', title: `T-${k}` }),
    }, 3);
    assert.deepStrictEqual(ids(plan).slice(0, 2),
      ['QUESTION#c001#004', 'QUESTION#c001#005']);
  });

  check('the tag says where each one came from', () => {
    const plan = planAhead({
      seed: 's',
      queue: ['c001#004'],
      categories: [cat('c001', 1, 5)],
      isRandomized: false,
      resolveQueued: () => ({ categoryId: 'c001', title: 'T' }),
    }, 3);
    // rejects: storing the tag on the item. Derived from WHERE it came from, it
    // cannot disagree with reality.
    assert.deepStrictEqual(plan.map((p) => p.source), ['queued', 'auto', 'auto']);
  });

  check('a queued question is not then served again automatically', () => {
    // THE BUG THIS WHOLE THREAD STARTED FROM, in the peek: the plan must show
    // the queued Q004 once, not once as queued and again when the cursor
    // reaches it.
    const plan = planAhead({
      seed: 's',
      queue: ['c001#002'],
      categories: [cat('c001', 1, 4)],
      isRandomized: false,
      resolveQueued: () => ({ categoryId: 'c001', title: 'T' }),
    }, 4);
    assert.deepStrictEqual(ids(plan),
      ['QUESTION#c001#002', 'QUESTION#c001#001', 'QUESTION#c001#003', 'QUESTION#c001#004']);
    assert.strictEqual(new Set(ids(plan)).size, 4);
  });

  check('a queued item already asked is dropped, not listed', () => {
    // rejects: advertising a round that will never happen. The drain discards
    // spent entries, so showing them would promise something it then skips.
    const plan = planAhead({
      seed: 's',
      queue: ['c001#001'],
      asked: new Set(['QUESTION#c001#001']),
      categories: [cat('c001', 1, 3)],
      isRandomized: false,
      resolveQueued: () => ({ categoryId: 'c001', title: 'T' }),
    }, 2);
    assert.deepStrictEqual(ids(plan), ['QUESTION#c001#002', 'QUESTION#c001#003']);
  });

  console.log('\n§6  randomised sets are previewable BECAUSE they are seeded');

  check('the same seed plans the same order twice', () => {
    const snap = () => ({
      seed: 'game-7311',
      categories: [cat('c001', 1, 6), cat('c002', 2, 6), cat('c003', 3, 6)],
      isRandomized: true,
    });
    // rejects: Math.random(). This is the assertion that makes an Up Next
    // honest — without it the peek is a guess and the serve is a different one.
    assert.deepStrictEqual(ids(planAhead(snap(), 8)), ids(planAhead(snap(), 8)));
  });

  check('a different session gets a different order', () => {
    const snap = (seed) => ({
      seed,
      categories: [cat('c001', 1, 6), cat('c002', 2, 6), cat('c003', 3, 6)],
      isRandomized: true,
    });
    // rejects: a constant seed, which would give every session in the product
    // the identical running order.
    assert.notDeepStrictEqual(ids(planAhead(snap('a'), 8)), ids(planAhead(snap('b'), 8)));
  });

  check('planning from round N matches planning through to round N', () => {
    /*
      THE PROPERTY THE WHOLE DESIGN RESTS ON, and the reason the pick is keyed
      on the round number rather than drawn from a stateful generator: what the
      host is shown for round 5 today must be what round 5 actually serves,
      whether it is reached in one hop or four.
    */
    const base = () => ({
      seed: 'game-7311',
      categories: [cat('c001', 1, 6), cat('c002', 2, 6), cat('c003', 3, 6)],
      isRandomized: true,
    });

    const wholeRun = planAhead({ ...base(), roundNumber: 1 }, 5);

    // Now replay it the slow way: serve rounds 1-3 for real, then plan round 4.
    const served = wholeRun.slice(0, 3);
    const asked = new Set(served.map((p) => p.questionId));
    const categories = base().categories.map((c) => {
      const takenHere = served.filter((p) => p.categoryId === c.categoryId).length;
      return { ...c, cursor: c.cursor + takenHere };
    });

    const resumed = planAhead({ ...base(), roundNumber: 4, asked, categories }, 2);
    assert.deepStrictEqual(ids(resumed), ids(wholeRun).slice(3),
      'the plan changed depending on how it was reached');
  });

  check('a randomised set still exhausts every question exactly once', () => {
    // rejects: a pick that can starve a category or revisit one. 18 questions
    // must come out as 18 distinct rounds.
    const plan = planAhead({
      seed: 'game-7311',
      categories: [cat('c001', 1, 6), cat('c002', 2, 6), cat('c003', 3, 6)],
      isRandomized: true,
    }, 40);
    assert.strictEqual(plan.length, 18);
    assert.strictEqual(new Set(ids(plan)).size, 18);
  });

  console.log('\n§7  an unrandomised set walks the categories in position order');

  check('lowest position first, and only moves on when it is spent', () => {
    const plan = planAhead({
      seed: 's',
      categories: [cat('c002', 2, 2), cat('c001', 1, 2)],
      isRandomized: false,
    }, 4);
    assert.deepStrictEqual(ids(plan), [
      'QUESTION#c001#001', 'QUESTION#c001#002',
      'QUESTION#c002#001', 'QUESTION#c002#002',
    ]);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
