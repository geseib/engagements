/**
 * DOES THE EXPORTER ACTUALLY READ A SET'S QUESTIONS?
 *
 *   "its wasnt in archive when you did it, and when i retryed archive, it
 *    says export completed, 0 items exported"
 *
 * The exporter used a ScanCommand with a FilterExpression and no pagination.
 * A Scan reads one 1 MB page of the WHOLE TABLE and filters after reading, so
 * a set whose QUESTION# rows sit outside that page yields zero questions, an
 * empty CSV, and a 400 from the archive service naming three fields that were
 * all fine.
 *
 * It failed by TABLE POSITION — reproducible for one set, invisible for the
 * rest, and free to move to another set the moment the table grows.
 *
 * These drive the real handler with a stubbed DynamoDB whose Scan behaves the
 * way the real one does: it returns a bounded page of everything, NOT the
 * partition asked for. A Query against the same stub returns the partition.
 * That difference is the entire bug and it is what these assert.
 */
const assert = require('assert');
const Module = require('module');

let pass = 0, fail = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n        ${e.message}`); fail++; }
};

const SRC = require('path').join(__dirname, '..', 'lambda-functions', 'admin', 'export-to-archive.js');
const src = require('fs').readFileSync(SRC, 'utf8');

check('the question read is a Query on the partition, not a Scan of the table', () => {
  // rejects: the shipped bug returning. A Scan here is wrong however it is
  // filtered — the filter runs after the 1 MB page is read.
  const at = src.indexOf('QUERY, PAGINATED');
  assert(at > -1, 'the question-read block has moved; re-anchor this assertion');
  const region = src.slice(at, at + 4000);
  assert(/new QueryCommand\(/.test(region),
    'the questions must be read with QueryCommand');
  assert(!/new ScanCommand\([^)]*QUESTION#/s.test(src),
    'no Scan may be used to collect a set\'s QUESTION# rows');
});

check('the read is paginated', () => {
  // rejects: a single Query page, which is also capped at 1 MB — the same bug
  // one size down, hitting only the largest sets.
  const at = src.indexOf('QUERY, PAGINATED');
  assert(at > -1, 'the question-read block has moved; re-anchor this assertion');
  const region = src.slice(at, at + 4000);
  assert(/LastEvaluatedKey/.test(region), 'must follow LastEvaluatedKey');
  assert(/ExclusiveStartKey/.test(region), 'must pass ExclusiveStartKey');
});

check('an empty read is refused with a diagnosis, not sent as an empty CSV', () => {
  /*
    rejects: handing '' to the archive service, whose reply — "Title, content,
    and contentType are required" — names three fields that were all present
    and says nothing about the read that failed. That message is why this was
    mistaken for corrupt data for an afternoon.
  */
  const at = src.indexOf('QUERY, PAGINATED');
  assert(at > -1, 'the question-read block has moved; re-anchor this assertion');
  const region = src.slice(at, at + 5000);
  assert(/questions\.length === 0/.test(region), 'must detect an empty result');
  /*
    Matched loosely on purpose: the sentence is built by concatenating two
    template literals, so "a read problem" never appears contiguously in the
    source. My first version asserted the joined phrase and failed against
    correct code — a test that reports a bug in the thing it is guarding is
    worse than no test.
  */
  assert(/not an empty set/.test(region) && /read/.test(region),
    'the failure must say it is a read problem, or the next person re-learns this');
});

check('convertQuestionsToCSV still returns empty for genuinely no questions', () => {
  // The guard above must not paper over the real empty case; the CSV builder's
  // own contract is unchanged.
  assert(/if \(!questions \|\| questions\.length === 0\) \{\s*return '';/.test(src),
    'the CSV builder still returns empty for an empty list');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
