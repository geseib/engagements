/**
 * ONE FIXTURE TABLE, RUN THROUGH BOTH COPIES OF THE QUEUE RULES.
 *
 * The ordering lives twice on purpose — `src/src/config/questionQueue.js` for
 * the two host surfaces, `lambda-functions/game/queue-order.js` for the handler
 * — because a Lambda bundle is per-directory and cannot import ESM out of
 * `src/`. `set-version.js` has the same shape in three directories.
 *
 * Duplication is only survivable if something fails when the copies drift, and
 * that is this file's entire job. Every case below is asserted THREE ways:
 *
 *   1. the frontend copy produces the expected result,
 *   2. the Lambda copy produces the expected result,
 *   3. the two produce the same thing as each other.
 *
 * (3) is not implied by (1) and (2) — a case both copies get wrong identically
 * would still pass (3), and a case the table forgot to pin would still pass (1)
 * and (2) vacuously. Keeping all three means "they agree" and "they are right"
 * are separate failures with separate messages.
 *
 * HOW THE ESM COPY IS LOADED. `node tests/x.js` is CommonJS and the frontend
 * module is ESM importing `questionKey` from `config/setupPanel.js`, so it is
 * read as text, its `import`/`export` keywords stripped, and evaluated together
 * with setupPanel's own source. That means the frontend copy is exercised with
 * the REAL `questionKey` — which is the point of R1: the queue must not carry
 * its own idea of what a question id looks like. The loader refuses loudly if
 * either file grows an import it cannot follow, because silently falling back
 * to a stub would turn this whole file into theatre.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');

const API = [
  'QUEUE_OPS', 'QUEUE_MAX', 'normaliseQueue', 'queueEnqueue', 'queueRemove',
  'queueMove', 'queueDrop', 'applyQueueOp', 'queuePosition', 'queueRows',
  'queueSummary',
];

function loadFrontendCopy() {
  const setupSource = fs.readFileSync(
    path.join(REPO, 'src/src/config/setupPanel.js'), 'utf8');
  const queueSource = fs.readFileSync(
    path.join(REPO, 'src/src/config/questionQueue.js'), 'utf8');

  const queueImports = queueSource.match(/^import\s.*$/gm) || [];
  if (queueImports.length !== 1 || !/\bquestionKey\b.*['"]\.\/setupPanel['"]/.test(queueImports[0])) {
    throw new Error(
      'questionQueue.js imports something this loader cannot follow:\n  '
      + queueImports.join('\n  ')
      + '\nEither keep it importing only questionKey from ./setupPanel, or teach '
      + 'this loader the new dependency. Do not stub it out — R1 is the reason '
      + 'the import is there.'
    );
  }
  if (/^import\s/m.test(setupSource)) {
    throw new Error('setupPanel.js grew an import; this loader evaluates it verbatim.');
  }

  const strip = (source) => source
    .replace(/^import\s.*$/gm, '')
    .replace(/^export\s+/gm, '');

  // eslint-disable-next-line no-new-func
  return new Function(
    `${strip(setupSource)}\n${strip(queueSource)}\nreturn { ${API.join(', ')} };`
  )();
}

const front = loadFrontendCopy();
const back = require(path.join(REPO, 'lambda-functions/game/queue-order.js'));

/* ---- Harness -------------------------------------------------------------- */

let pass = 0, fail = 0;
function check(label, fn) {
  try { fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

/**
 * A result shrunk to the three things the contract promises. `refused` is
 * included rather than ignored because "nothing happened" and "nothing happened
 * BECAUSE THE QUEUE IS FULL" are different answers to the host, and a test that
 * only compares the array cannot tell them apart.
 */
const shape = (result) => ({
  queue: result.queue,
  changed: result.changed,
  refused: result.refused,
});

/* ---- The table ------------------------------------------------------------ */

const FULL = Array.from({ length: 24 }, (_, i) => `c001#${String(i + 1).padStart(3, '0')}`);
const THREE = ['c001#001', 'c001#002', 'c001#003'];
const FIVE = ['q1', 'q2', 'q3', 'q4', 'q5'];

/**
 * `identity: 'same'` asserts R8's other half — a no-op hands BACK the array it
 * was given. The retry loop reads `changed` to decide whether it has anything
 * to write, and React's `===` bailout reads the reference; a copy-on-no-op
 * passes every value assertion here and quietly costs a write and a re-render
 * for every button press that could not do anything.
 */
const CASES = [
  /* -- R1: one spelling ---------------------------------------------------- */
  {
    name: 'R1 add strips the QUESTION# prefix',
    fn: 'applyQueueOp', args: [[], { op: 'add', questionKey: 'QUESTION#c005#001' }],
    expect: { queue: ['c005#001'], changed: true, refused: null },
  },
  {
    name: 'R1 the prefixed and bare spellings are ONE key, so the second add is a duplicate',
    fn: 'applyQueueOp', args: [['c005#001'], { op: 'add', questionKey: 'QUESTION#c005#001' }],
    expect: { queue: ['c005#001'], changed: false, refused: 'duplicate' },
    identity: 'same',
  },
  {
    name: 'R1 remove finds a bare key by its prefixed spelling',
    fn: 'applyQueueOp', args: [['c005#001', 'c005#002'], { op: 'remove', questionKey: 'QUESTION#c005#001' }],
    expect: { queue: ['c005#002'], changed: true, refused: null },
  },
  {
    name: 'R1 surrounding whitespace is not a third spelling',
    fn: 'applyQueueOp', args: [['c005#001'], { op: 'add', questionKey: '  QUESTION#c005#001  ' }],
    expect: { queue: ['c005#001'], changed: false, refused: 'duplicate' },
    identity: 'same',
  },
  {
    name: 'R1 normalise folds both spellings and drops the junk',
    fn: 'normaliseQueue', args: [['QUESTION#a', 'a', '', null, undefined, 'b', 'QUESTION#b']],
    expect: ['a', 'b'],
  },
  {
    name: 'normalise leaves an already-canonical list alone, by reference',
    fn: 'normaliseQueue', args: [THREE],
    expect: THREE, identity: 'same',
  },
  {
    name: 'normalise of a non-array is an empty queue, not a throw',
    fn: 'normaliseQueue', args: [undefined],
    expect: [],
  },

  /* -- R2: set semantics --------------------------------------------------- */
  {
    name: 'R2 add appends to the TAIL, in press order',
    fn: 'applyQueueOp', args: [['q1'], { op: 'add', questionKey: 'q2' }],
    expect: { queue: ['q1', 'q2'], changed: true, refused: null },
  },
  {
    name: 'R2 a duplicate is refused with its reason, not deduped later',
    fn: 'applyQueueOp', args: [THREE, { op: 'add', questionKey: 'c001#002' }],
    expect: { queue: THREE, changed: false, refused: 'duplicate' },
    identity: 'same',
  },
  {
    name: 'R2 an empty key adds nothing',
    fn: 'applyQueueOp', args: [THREE, { op: 'add', questionKey: '   ' }],
    expect: { queue: THREE, changed: false, refused: 'no-key' },
    identity: 'same',
  },

  /* -- R3: clamping, and never a wrap -------------------------------------- */
  {
    name: 'R3 earlier at the head is a no-op — NOT a wrap to the tail',
    fn: 'applyQueueOp', args: [FIVE, { op: 'earlier', questionKey: 'q1' }],
    expect: { queue: FIVE, changed: false, refused: 'at-edge' },
    identity: 'same',
  },
  {
    name: 'R3 later at the tail is a no-op — NOT a wrap to the head',
    fn: 'applyQueueOp', args: [FIVE, { op: 'later', questionKey: 'q5' }],
    expect: { queue: FIVE, changed: false, refused: 'at-edge' },
    identity: 'same',
  },
  {
    name: 'R3 a one-item queue cannot move in either direction',
    fn: 'applyQueueOp', args: [['q1'], { op: 'later', questionKey: 'q1' }],
    expect: { queue: ['q1'], changed: false, refused: 'at-edge' },
    identity: 'same',
  },

  /* -- R4: a neighbour SWAP, not a splice ---------------------------------- */
  {
    name: 'R4 move 4 earlier gives [1,2,4,3,5] — the owner\'s own example',
    fn: 'applyQueueOp', args: [FIVE, { op: 'earlier', questionKey: 'q4' }],
    expect: { queue: ['q1', 'q2', 'q4', 'q3', 'q5'], changed: true, refused: null },
  },
  {
    name: 'R4 move 2 later gives [1,3,2,4,5]',
    fn: 'applyQueueOp', args: [FIVE, { op: 'later', questionKey: 'q2' }],
    expect: { queue: ['q1', 'q3', 'q2', 'q4', 'q5'], changed: true, refused: null },
  },
  {
    name: 'R4 earlier then later returns the list to where it started',
    fn: 'roundTrip', args: [FIVE, 'q3'],
    expect: FIVE,
  },

  /* -- R5: a stale surface cannot resurrect anything ----------------------- */
  {
    name: 'R5 remove of a key that is not queued does nothing',
    fn: 'applyQueueOp', args: [THREE, { op: 'remove', questionKey: 'c009#009' }],
    expect: { queue: THREE, changed: false, refused: 'not-queued' },
    identity: 'same',
  },
  {
    name: 'R5 earlier on a key that is not queued does NOT insert it',
    fn: 'applyQueueOp', args: [THREE, { op: 'earlier', questionKey: 'c009#009' }],
    expect: { queue: THREE, changed: false, refused: 'not-queued' },
    identity: 'same',
  },
  {
    name: 'R5 later on a key that is not queued does NOT insert it',
    fn: 'applyQueueOp', args: [THREE, { op: 'later', questionKey: 'c009#009' }],
    expect: { queue: THREE, changed: false, refused: 'not-queued' },
    identity: 'same',
  },
  {
    name: 'R5 add is the ONE op that may reach a key the queue does not hold',
    fn: 'applyQueueOp', args: [THREE, { op: 'add', questionKey: 'c009#009' }],
    expect: { queue: [...THREE, 'c009#009'], changed: true, refused: null },
  },

  /* -- R6: the cap, refused with its reason -------------------------------- */
  {
    name: 'R6 the 24th add still lands',
    fn: 'applyQueueOp', args: [FULL.slice(0, 23), { op: 'add', questionKey: 'c001#024' }],
    expect: { queue: FULL, changed: true, refused: null },
  },
  {
    name: 'R6 the 25th is refused as "full", not silently dropped',
    fn: 'applyQueueOp', args: [FULL, { op: 'add', questionKey: 'c001#099' }],
    expect: { queue: FULL, changed: false, refused: 'full' },
    identity: 'same',
  },
  {
    name: 'R6 a full queue can still be reordered and emptied',
    fn: 'applyQueueOp', args: [FULL, { op: 'remove', questionKey: FULL[0] }],
    expect: { queue: FULL.slice(1), changed: true, refused: null },
  },

  /* -- R7: the closed enum ------------------------------------------------- */
  {
    name: 'R7 an op nobody has heard of is refused by name',
    fn: 'applyQueueOp', args: [THREE, { op: 'shuffle', questionKey: 'c001#001' }],
    expect: { queue: THREE, changed: false, refused: 'unknown-op' },
    identity: 'same',
  },
  {
    name: 'R7 a missing op is refused the same way',
    fn: 'applyQueueOp', args: [THREE, {}],
    expect: { queue: THREE, changed: false, refused: 'unknown-op' },
    identity: 'same',
  },
  {
    name: 'R7 "clear" is not an op — the enum is the four in QUEUE_OPS',
    fn: 'applyQueueOp', args: [THREE, { op: 'clear' }],
    expect: { queue: THREE, changed: false, refused: 'unknown-op' },
    identity: 'same',
  },

  /* -- queueDrop: the server's own removal --------------------------------- */
  {
    name: 'drop takes the head, which is what the drain does after serving it',
    fn: 'queueDrop', args: [THREE, 'c001#001'],
    expect: { queue: ['c001#002', 'c001#003'], changed: true, refused: null },
  },
  {
    name: 'drop takes several at once, so a run of dead entries costs one write',
    fn: 'queueDrop', args: [FIVE, ['q1', 'q3', 'q5']],
    expect: { queue: ['q2', 'q4'], changed: true, refused: null },
  },
  {
    name: 'drop of nothing that is queued leaves the list alone',
    fn: 'queueDrop', args: [THREE, ['nope']],
    expect: { queue: THREE, changed: false, refused: 'not-queued' },
    identity: 'same',
  },

  /* -- the read-only projections ------------------------------------------- */
  { name: 'position is 1-based', fn: 'queuePosition', args: [THREE, 'c001#002'], expect: 2 },
  { name: 'position of an unqueued key is 0', fn: 'queuePosition', args: [THREE, 'nope'], expect: 0 },
  {
    name: 'position accepts the prefixed spelling too',
    fn: 'queuePosition', args: [THREE, 'QUESTION#c001#003'], expect: 3,
  },
  {
    name: 'summary counts, and says when the cap is reached',
    fn: 'queueSummary', args: [FULL],
    expect: { count: 24, remaining: 0, full: true, nextKey: FULL[0] },
  },
  {
    name: 'summary of an empty queue has no next key',
    fn: 'queueSummary', args: [[]],
    expect: { count: 0, remaining: 24, full: false, nextKey: null },
  },
  {
    name: 'rows carry the clamp, so no surface re-derives the edges',
    fn: 'queueRows',
    args: [THREE, { questions: [{ id: 'QUESTION#c001#002', title: 'Two', category: 'Pricing' }] }],
    expect: [
      { key: 'c001#001', position: 1, title: '', category: '', canMoveEarlier: false, canMoveLater: true, missing: true },
      { key: 'c001#002', position: 2, title: 'Two', category: 'Pricing', canMoveEarlier: true, canMoveLater: true, missing: false },
      { key: 'c001#003', position: 3, title: '', category: '', canMoveEarlier: true, canMoveLater: false, missing: true },
    ],
  },
];

/**
 * `roundTrip` is not part of the API — it is a two-step composition the table
 * needs in order to say "earlier then later is where you started", which is the
 * property that separates a swap from a splice-to-index once the list is longer
 * than three.
 */
const invoke = (copy, fn, args) => {
  if (fn === 'roundTrip') {
    const [queue, key] = args;
    const up = copy.applyQueueOp(queue, { op: 'earlier', questionKey: key });
    return copy.applyQueueOp(up.queue, { op: 'later', questionKey: key }).queue;
  }
  const result = copy[fn](...args);
  return (result && typeof result === 'object' && 'changed' in result) ? shape(result) : result;
};

/* ========================================================================== */

console.log('\n1. the two copies expose the same API');

check('both export every name', () => {
  for (const name of API) {
    assert.ok(name in front, `frontend copy is missing ${name}`);
    assert.ok(name in back, `Lambda copy is missing ${name}`);
  }
});
check('QUEUE_MAX is 24 in both — the same 24 as the host masks', () => {
  assert.strictEqual(front.QUEUE_MAX, 24);
  assert.strictEqual(back.QUEUE_MAX, 24);
});
check('QUEUE_OPS is the same closed enum in both', () => {
  assert.deepStrictEqual(front.QUEUE_OPS, ['add', 'remove', 'earlier', 'later']);
  assert.deepStrictEqual(back.QUEUE_OPS, front.QUEUE_OPS);
});

console.log('\n2. every case, through both copies');

for (const testCase of CASES) {
  const label = testCase.name;

  const frontResult = invoke(front, testCase.fn, testCase.args);
  const backResult = invoke(back, testCase.fn, testCase.args);

  check(`frontend · ${label}`, () =>
    assert.deepStrictEqual(frontResult, testCase.expect));
  check(`lambda   · ${label}`, () =>
    assert.deepStrictEqual(backResult, testCase.expect));
  check(`agree    · ${label}`, () =>
    assert.deepStrictEqual(frontResult, backResult,
      'the two copies have drifted — fix BOTH, they are a mirror'));

  if (testCase.identity === 'same') {
    const input = testCase.args[0];
    const queueOf = (r) => (Array.isArray(r) ? r : r.queue);
    check(`identity · ${label}`, () => {
      assert.strictEqual(queueOf(frontResult), input,
        'frontend copy returned a COPY for a no-op; the retry loop and React both read the reference');
      assert.strictEqual(queueOf(backResult), input,
        'Lambda copy returned a COPY for a no-op; the retry loop reads the reference');
    });
  }
}

console.log('\n3. a change always yields a NEW array (R8, the other direction)');

check('the input array is never mutated in place', () => {
  const original = ['q1', 'q2', 'q3'];
  const before = [...original];
  front.applyQueueOp(original, { op: 'later', questionKey: 'q1' });
  back.applyQueueOp(original, { op: 'later', questionKey: 'q1' });
  front.queueDrop(original, 'q2');
  back.queueDrop(original, 'q2');
  // Mutating in place would make the optimistic surface and the server's
  // re-read the same object, so a failed conditional would replay the op
  // against a list that has ALREADY had it applied.
  assert.deepStrictEqual(original, before);
});

check('a changed queue is a different object from the one passed in', () => {
  const original = ['q1', 'q2'];
  assert.notStrictEqual(front.applyQueueOp(original, { op: 'later', questionKey: 'q1' }).queue, original);
  assert.notStrictEqual(back.applyQueueOp(original, { op: 'later', questionKey: 'q1' }).queue, original);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
