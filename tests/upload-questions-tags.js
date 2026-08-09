/**
 * Tags survive CSV import — lambda-functions/admin/upload-questions.js
 *
 * Every AI builder now suggests tags on generated content (scenarios has for a
 * while; four more were just converted), but upload-questions.js — the CSV
 * importer every builder's output flows through on save — had no tag handling
 * at all (`grep -i tag` returned nothing). Tags were displayed, edited by the
 * admin, and then silently discarded at import.
 *
 * Stubbing follows tests/import-questions-flow.js: hook Module._load BY MODULE
 * NAME (several @aws-sdk packages only exist in the deployed bundle and cannot
 * be resolved from the repo root), and stub only the commands upload-questions.js
 * actually issues: GetCommand, BatchWriteCommand, UpdateCommand.
 */
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');

// ---- Stub the AWS SDK before the handler loads -----------------------------
const Module = require('module');
const stubs = new Map();
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (stubs.has(request)) return stubs.get(request);
  return realLoad.call(this, request, parent, isMain);
};
function stub(name, exports) { stubs.set(name, exports); }

class GetCommand { constructor(i) { this.input = i; this.type = 'get'; } }
class UpdateCommand { constructor(i) { this.input = i; this.type = 'update'; } }
class BatchWriteCommand { constructor(i) { this.input = i; this.type = 'batchWrite'; } }

const TABLE = 'test-table';

// In-memory single-table store, keyed "PK|SK".
const store = new Map();
const k = (item) => `${item.PK}|${item.SK}`;

const fakeDoc = {
  send: async (cmd) => {
    const inp = cmd.input || {};

    if (cmd.type === 'get') {
      return { Item: store.get(`${inp.Key.PK}|${inp.Key.SK}`) };
    }
    if (cmd.type === 'batchWrite') {
      const reqs = inp.RequestItems[TABLE] || [];
      if (reqs.length > 25) throw new Error(`BatchWrite over the 25-item limit: ${reqs.length}`);
      for (const r of reqs) {
        if (r.PutRequest) {
          store.set(k(r.PutRequest.Item), r.PutRequest.Item);
        } else if (r.DeleteRequest) {
          store.delete(`${r.DeleteRequest.Key.PK}|${r.DeleteRequest.Key.SK}`);
        }
      }
      return { UnprocessedItems: {} };
    }
    if (cmd.type === 'update') {
      // Only the activeVersion flip (REPLACE path) issues this; unused here
      // but stubbed so the module never touches the real SDK if it fires.
      return {};
    }
    return { Items: [], Count: 0 };
  },
};

stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => fakeDoc },
  GetCommand, BatchWriteCommand, UpdateCommand,
});

process.env.TABLE_NAME = TABLE;

const { handler } = require(path.join(REPO, 'lambda-functions/admin/upload-questions.js'));

// Silence the handler's very chatty logging unless DEBUG=1.
if (!process.env.DEBUG) console.log = () => {};
const say = (...a) => process.stdout.write(a.join(' ') + '\n');

function reset() {
  store.clear();
}

/** Every stored question row (SK starts with QUESTION#), sorted by QuestionNumber. */
function storedQuestions() {
  return [...store.values()]
    .filter((i) => typeof i.SK === 'string' && i.SK.startsWith('QUESTION#'))
    .sort((a, b) => a.QuestionNumber - b.QuestionNumber);
}

// ---- Tiny test runner -------------------------------------------------------
let passed = 0; let failed = 0;
async function test(name, fn) {
  try { await fn(); passed += 1; say(`  PASS  ${name}`); }
  catch (error) { failed += 1; say(`  FAIL  ${name}\n        ${error.message}`); }
}

// ---- fixtures ----------------------------------------------------------------
const CSV_WITH_TAGS = [
  'Category,Question#,Title,Detail_lesson,School,CustomInstruction,Tags',
  '"Leadership","1","Handling a difficult escalation","Some detail.","Prof Dev","Discuss.","Leadership|remote work|CONFLICT"',
  '"Leadership","2","Running a retrospective","More detail.","Prof Dev","Discuss.","facilitation|leadership"',
].join('\n');

const CSV_WITHOUT_TAGS = [
  'Category,Question#,Title,Detail_lesson,School,CustomInstruction',
  '"Leadership","1","Handling a difficult escalation","Some detail.","Prof Dev","Discuss."',
].join('\n');

const upload = (fileContent, title) => handler({
  requestContext: { http: { method: 'POST' } },
  body: JSON.stringify({ fileName: `${title}.csv`, fileContent, customTitle: title }),
}, { functionName: 'engagedev-admin-upload-questions' });

(async function run() {
  say('\ntags survive CSV import');

  await test('a Tags column is parsed and normalised', async () => {
    reset();
    const res = await upload(CSV_WITH_TAGS, 'Tagged Set');
    assert.strictEqual(res.statusCode, 200, res.body);
    const stored = storedQuestions();
    assert.strictEqual(stored.length, 2);
    assert.deepStrictEqual(stored[0].Tags, ['leadership', 'remote-work', 'conflict'],
      'normalise on write: casing and spacing are canonicalised, "CONFLICT" becomes "conflict"');
    assert.deepStrictEqual(stored[1].Tags, ['facilitation', 'leadership']);
  });

  await test('a CSV with no Tags column still imports, with empty tags', async () => {
    reset();
    const res = await upload(CSV_WITHOUT_TAGS, 'Untagged Set');
    assert.strictEqual(res.statusCode, 200, res.body);
    const stored = storedQuestions();
    assert.strictEqual(stored.length, 1, 'every CSV that imported before must still import');
    assert.deepStrictEqual(stored[0].Tags, [], 'absent column means no tags, not undefined');
  });

  await test('the Tags column is found under common alternate spellings', async () => {
    reset();
    const alt = [
      'Category,Title,Detail_lesson,Keywords',
      '"Ops","Rotating on-call","Detail.","on-call|ops"',
    ].join('\n');
    const res = await upload(alt, 'Alt Set');
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.deepStrictEqual(storedQuestions()[0].Tags, ['on-call', 'ops']);
  });

  await test('junk tags normalise away rather than being stored', async () => {
    reset();
    const junk = [
      'Category,Title,Detail_lesson,Tags',
      '"Ops","Rotating on-call","Detail.","  |---|ops|ops"',
    ].join('\n');
    await upload(junk, 'Junk Set');
    assert.deepStrictEqual(storedQuestions()[0].Tags, ['ops'],
      'blanks and dash-only tokens normalise to nothing; duplicates collapse');
  });

  await test('the Tags column does not steal another column', async () => {
    reset();
    await upload(CSV_WITH_TAGS, 'Tagged Set');
    const first = storedQuestions()[0];
    assert.strictEqual(first.Title, 'Handling a difficult escalation');
    assert.strictEqual(first.Detail, 'Some detail.');
    assert.strictEqual(first.CustomInstructions, 'Discuss.',
      'the loose instruction fallback must not match "Tags"');
  });

  await test('a column merely containing "tag" is not mistaken for the Tags column', async () => {
    // No exact Tags/Keywords/Labels header here — only "Stage", which contains
    // the substring "tag". A loose `includes('tag')` fallback would claim this
    // column and leak its content into Tags; the exact-match fallback must
    // leave tagsIndex unresolved and fall back to [].
    reset();
    const csv = [
      'Category,Title,Detail_lesson,Stage',
      '"Ops","Rotating on-call","Detail.","Planning"',
    ].join('\n');
    const res = await upload(csv, 'Stage Set');
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.deepStrictEqual(storedQuestions()[0].Tags, [],
      'a "Stage" column was mistaken for a Tags column via loose substring matching');
  });

  say(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
})();
