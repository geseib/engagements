/**
 * Question-set IMPORT regression tests — lambda-functions/admin/upload-questions.js
 *
 * Runs the REAL handler against a stubbed DynamoDB document client.
 *
 * Stubbing follows tests/ai-prompt-resolution.js: hook Module._load BY MODULE
 * NAME. The require.cache-by-resolved-path trick used in art-title-flow.js
 * silently misses, because several @aws-sdk packages only exist in the deployed
 * bundle and cannot be resolved from the repo root at all.
 *
 * What these tests pin down:
 *   - every well-formed row lands in Dynamo (call-and-answer + trivia)
 *   - commas, escaped quotes and non-ASCII survive the CSV round trip
 *   - an empty optional column does not shift its neighbours
 *   - a missing required column fails BEFORE any write (no partial data)
 *   - re-importing an existing set id is refused (documented current behaviour)
 *   - a 160-question set is written in batches, not one request per question
 *   - UnprocessedItems are retried rather than dropped
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
class PutCommand { constructor(i) { this.input = i; this.type = 'put'; } }
class DeleteCommand { constructor(i) { this.input = i; this.type = 'delete'; } }
class QueryCommand { constructor(i) { this.input = i; this.type = 'query'; } }
class ScanCommand { constructor(i) { this.input = i; this.type = 'scan'; } }
class UpdateCommand { constructor(i) { this.input = i; this.type = 'update'; } }
class BatchWriteCommand { constructor(i) { this.input = i; this.type = 'batchWrite'; } }

const TABLE = 'test-table';

// In-memory single-table store + a log of every command the handler issued.
const store = new Map();          // "PK|SK" -> Item
const log = [];                   // { type, ... }
let failNextWrite = null;         // () => boolean, throw on matching write
let deferOnce = new Set();        // keys to return once as UnprocessedItems

function resetDb() {
  store.clear();
  log.length = 0;
  failNextWrite = null;
  deferOnce = new Set();
}
const k = (item) => `${item.PK}|${item.SK}`;

const fakeDoc = {
  send: async (cmd) => {
    const inp = cmd.input || {};
    log.push({ type: cmd.type, input: inp });

    if (cmd.type === 'get') {
      return { Item: store.get(`${inp.Key.PK}|${inp.Key.SK}`) };
    }
    if (cmd.type === 'put') {
      if (failNextWrite && failNextWrite(inp.Item)) {
        throw new Error('simulated Dynamo failure');
      }
      store.set(k(inp.Item), inp.Item);
      return {};
    }
    if (cmd.type === 'delete') {
      store.delete(`${inp.Key.PK}|${inp.Key.SK}`);
      return {};
    }
    if (cmd.type === 'batchWrite') {
      const reqs = inp.RequestItems[TABLE] || [];
      if (reqs.length > 25) throw new Error(`BatchWrite over the 25-item limit: ${reqs.length}`);
      const unprocessed = [];
      for (const r of reqs) {
        if (r.PutRequest) {
          const item = r.PutRequest.Item;
          if (failNextWrite && failNextWrite(item)) throw new Error('simulated Dynamo failure');
          if (deferOnce.has(k(item))) {         // pretend Dynamo throttled this one
            deferOnce.delete(k(item));
            unprocessed.push(r);
            continue;
          }
          store.set(k(item), item);
        } else if (r.DeleteRequest) {
          store.delete(`${r.DeleteRequest.Key.PK}|${r.DeleteRequest.Key.SK}`);
        }
      }
      return unprocessed.length
        ? { UnprocessedItems: { [TABLE]: unprocessed } }
        : { UnprocessedItems: {} };
    }
    if (cmd.type === 'query') {
      const v = inp.ExpressionAttributeValues || {};
      const items = [...store.values()].filter((i) => i.PK === v[':setpk'] || i.PK === v[':pk']);
      return { Items: items, Count: items.length };
    }
    return { Items: [], Count: 0 };
  },
};

stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => fakeDoc },
  GetCommand, PutCommand, DeleteCommand, QueryCommand,
  ScanCommand, UpdateCommand, BatchWriteCommand,
});

process.env.TABLE_NAME = TABLE;

const { handler } = require(path.join(REPO, 'lambda-functions', 'admin', 'upload-questions.js'));

// Silence the handler's very chatty logging unless DEBUG=1.
if (!process.env.DEBUG) console.log = () => {};
const say = (...a) => process.stdout.write(a.join(' ') + '\n');

// ---- helpers ---------------------------------------------------------------
const invoke = (body) => handler({ body: JSON.stringify(body) });
const parse = (res) => JSON.parse(res.body);
const questionsOf = (setId) =>
  [...store.values()]
    .filter((i) => i.PK === `SET#${setId}` && String(i.SK).startsWith('QUESTION#'))
    .sort((a, b) => a.SK.localeCompare(b.SK));
const writeCount = () =>
  log.filter((c) => c.type === 'put' || c.type === 'batchWrite').length;

let pass = 0, fail = 0;
function check(label, fn) {
  try { fn(); say(`  PASS  ${label}`); pass++; }
  catch (e) { say(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

// ---- fixtures --------------------------------------------------------------
const CAA_HEADER = 'Category,Question#,Title,Detail_lesson,School,CustomInstruction,Image';
const CAA_CSV = [
  CAA_HEADER,
  '"Leadership",1,"MOST EFFECTIVE STYLE","Inspiring others to achieve.","School of Management","How would you apply this?",',
  '"Leadership",2,"HARDEST FEEDBACK","Telling the truth kindly.","School of Management","Give an example.",',
  '"Innovation",1,"GREATEST METHOD","Design thinking, lean startup.","School of Innovation","What would you try?",',
].join('\n');

const TRIVIA_CSV = [
  'Category,Title,QuestionDetail,OptionA,OptionB,OptionC,OptionD,CorrectAnswer,AnswerDetails,Difficulty',
  '"Business","SWOT purpose","What is a SWOT analysis for?","Evaluate strengths, weaknesses, opportunities, threats","Calculate ratios","Manage performance","Design campaigns","OptionA","A strategic planning tool.","medium"',
  '"Technology","Web language","Which language runs in the browser?","JavaScript","COBOL","Fortran","Pascal","OptionA","JavaScript is the client-side default.","easy"',
].join('\n');

// ---- tests -----------------------------------------------------------------
(async () => {
  say('question-set import: upload-questions.js\n');

  // 1. well-formed call-and-answer CSV -------------------------------------
  resetDb();
  {
    const res = await invoke({
      fileName: 'greatest-hits.csv', fileContent: CAA_CSV,
      customTitle: 'Greatest Hits', engagementType: 'call-and-answer',
    });
    const body = parse(res);
    check('call-and-answer CSV returns 200', () => assert.strictEqual(res.statusCode, 200, res.body));
    check('all 3 rows imported', () => assert.strictEqual(body.questionCount, 3));
    check('2 categories detected', () => assert.strictEqual(body.categoryCount, 2));
    check('3 QUESTION# items written', () => assert.strictEqual(questionsOf('greatesthits').length, 3));
    check('set metadata written under SETS/SET#greatesthits', () =>
      assert.ok(store.get('SETS|SET#greatesthits'), 'no metadata row'));
    check('question numbering is category-relative', () => {
      const sks = questionsOf('greatesthits').map((q) => q.SK);
      assert.deepStrictEqual(sks, ['QUESTION#c001#001', 'QUESTION#c001#002', 'QUESTION#c002#001']);
    });
    check('Detail / School / CustomInstructions land on the item', () => {
      const q = store.get('SET#greatesthits|QUESTION#c001#001');
      assert.strictEqual(q.Detail, 'Inspiring others to achieve.');
      assert.strictEqual(q.School, 'School of Management');
      assert.strictEqual(q.CustomInstructions, 'How would you apply this?');
    });
  }

  // 2. trivia CSV: options + correct answer --------------------------------
  resetDb();
  {
    const res = await invoke({
      fileName: 'tech-trivia.csv', fileContent: TRIVIA_CSV,
      customTitle: 'Tech Trivia', engagementType: 'trivia',
    });
    check('trivia CSV returns 200', () => assert.strictEqual(res.statusCode, 200, res.body));
    check('both trivia rows imported', () => assert.strictEqual(parse(res).questionCount, 2));
    const q = store.get('SET#techtrivia|QUESTION#c001#001');
    check('trivia options survive', () => {
      assert.strictEqual(q.optionA, 'Evaluate strengths, weaknesses, opportunities, threats');
      assert.strictEqual(q.optionB, 'Calculate ratios');
      assert.strictEqual(q.optionD, 'Design campaigns');
    });
    check('correctAnswer survives', () => assert.strictEqual(q.correctAnswer, 'OptionA'));
    check('difficulty survives', () => assert.strictEqual(q.difficulty, 'medium'));
    check('answer details survive', () => assert.strictEqual(q.Detail, 'What is a SWOT analysis for?'));
  }

  // 3. commas and escaped quotes -------------------------------------------
  resetDb();
  {
    const csv = [
      CAA_HEADER,
      '"Ethics",1,"THE ""RIGHT"" CALL","She said ""we ship it"", then left, quietly.","Law, Ethics & Policy","Quote a moment, then explain ""why"".",',
    ].join('\n');
    const res = await invoke({
      fileName: 'quotes.csv', fileContent: csv,
      customTitle: 'Quotes', engagementType: 'call-and-answer',
    });
    check('quoted/comma CSV returns 200', () => assert.strictEqual(res.statusCode, 200, res.body));
    const q = store.get('SET#quotes|QUESTION#c001#001');
    check('escaped quotes survive in Title', () =>
      assert.strictEqual(q.Title, 'THE "RIGHT" CALL'));
    check('commas + escaped quotes survive in Detail', () =>
      assert.strictEqual(q.Detail, 'She said "we ship it", then left, quietly.'));
    check('comma inside a quoted field does not split the column', () =>
      assert.strictEqual(q.School, 'Law, Ethics & Policy'));
    check('escaped quotes survive in CustomInstructions', () =>
      assert.strictEqual(q.CustomInstructions, 'Quote a moment, then explain "why".'));
  }

  // 4. non-ASCII ------------------------------------------------------------
  resetDb();
  {
    const csv = [
      CAA_HEADER,
      '"Café Culture",1,"L\'ESPRIT D\'ESCALIER","Ça alors — 日本語 · Ελληνικά · emoji 🎯 · naïve résumé.","École Normale","Répondez en français, s\'il vous plaît.",',
    ].join('\n');
    const res = await invoke({
      fileName: 'intl.csv', fileContent: csv,
      customTitle: 'Intl Set', engagementType: 'call-and-answer',
    });
    check('non-ASCII CSV returns 200', () => assert.strictEqual(res.statusCode, 200, res.body));
    const q = store.get('SET#intlset|QUESTION#c001#001');
    check('non-ASCII detail survives byte-for-byte', () =>
      assert.strictEqual(q.Detail, 'Ça alors — 日本語 · Ελληνικά · emoji 🎯 · naïve résumé.'));
    check('non-ASCII category survives', () => assert.strictEqual(q.Category, 'Café Culture'));
    check('apostrophes survive', () => assert.strictEqual(q.Title, "L'ESPRIT D'ESCALIER"));
  }

  // 4b. a title with no ASCII alphanumerics must not collapse to an empty id
  resetDb();
  {
    const csv = [CAA_HEADER, '"日本",1,"侘寂","不完全の美。","京都","日本語で答えてください。",'].join('\n');
    const res = await invoke({
      fileName: 'jp.csv', fileContent: csv,
      customTitle: '日本語セット', engagementType: 'call-and-answer',
    });
    check('a fully non-ASCII set title still yields 200', () =>
      assert.strictEqual(res.statusCode, 200, res.body));
    check('setId never collapses to the empty string', () => {
      const id = parse(res).setId;
      assert.ok(id && id.length > 0, `setId was ${JSON.stringify(id)} — SK would be bare "SET#"`);
    });
    check('questions hang off a non-empty partition key', () => {
      const bad = [...store.values()].filter((i) => i.PK === 'SET#');
      assert.strictEqual(bad.length, 0, `${bad.length} items written under the bare "SET#" partition`);
    });
  }

  // 5. empty optional column must not shift its neighbours -------------------
  resetDb();
  {
    // Image is the trailing optional column; CustomInstruction empty in row 2;
    // Detail_lesson empty in row 3 (the Art Title shape).
    const csv = [
      CAA_HEADER,
      '"Renaissance",1,"THE SMILE","A portrait.","Leonardo, c. 1503","Invent a title.","https://example.test/a.jpg"',
      '"Renaissance",2,"THE NIGHT","A sky.","Van Gogh, 1889",,"https://example.test/b.jpg"',
      '"Renaissance",3,"THE WAVE",,"Hokusai, c. 1831",,"https://example.test/c.jpg"',
    ].join('\n');
    const res = await invoke({
      fileName: 'art.csv', fileContent: csv,
      customTitle: 'Art Titles', engagementType: 'call-and-answer',
    });
    check('CSV with empty optional cells returns 200', () => assert.strictEqual(res.statusCode, 200, res.body));
    check('all 3 art rows imported', () => assert.strictEqual(parse(res).questionCount, 3));
    const [a, b, c] = questionsOf('arttitles');
    check('row 1 keeps every column in place', () => {
      assert.strictEqual(a.School, 'Leonardo, c. 1503');
      assert.strictEqual(a.CustomInstructions, 'Invent a title.');
      assert.strictEqual(a.Image, 'https://example.test/a.jpg');
    });
    check('empty CustomInstruction does not pull Image left', () => {
      assert.strictEqual(b.School, 'Van Gogh, 1889');
      assert.strictEqual(b.CustomInstructions, '');
      assert.strictEqual(b.Image, 'https://example.test/b.jpg');
    });
    check('two empty cells still keep School and Image aligned', () => {
      assert.strictEqual(c.Detail, '');
      assert.strictEqual(c.School, 'Hokusai, c. 1831');
      assert.strictEqual(c.Image, 'https://example.test/c.jpg');
    });
  }

  // 6. missing required column -> clean failure, ZERO writes -----------------
  resetDb();
  {
    const csv = [
      'Question#,Title,Detail_lesson,School,CustomInstruction',   // no Category
      '1,"A TITLE","Some detail.","A School","Do a thing."',
    ].join('\n');
    const res = await invoke({
      fileName: 'broken.csv', fileContent: csv,
      customTitle: 'Broken Set', engagementType: 'call-and-answer',
    });
    check('missing Category is rejected with 400', () => assert.strictEqual(res.statusCode, 400, res.body));
    check('the error names the missing column', () =>
      assert.match(parse(res).error, /Category/, parse(res).error));
    check('the error echoes the detected headers', () =>
      assert.match(parse(res).error, /Detected headers/));
    check('nothing at all was written', () =>
      assert.strictEqual(store.size, 0, `${store.size} items leaked from a rejected import`));
    check('no write command was even issued', () =>
      assert.strictEqual(writeCount(), 0, `${writeCount()} write commands issued`));
  }

  // 6b. header-only / empty CSV
  resetDb();
  {
    const res = await invoke({
      fileName: 'empty.csv', fileContent: CAA_HEADER,
      customTitle: 'Empty Set', engagementType: 'call-and-answer',
    });
    check('a header-only CSV is rejected with 400', () => assert.strictEqual(res.statusCode, 400, res.body));
    check('header-only CSV writes nothing', () => assert.strictEqual(store.size, 0));
  }

  // 6c. malformed request body -> 400, not a 500 stack leak
  resetDb();
  {
    const res = await handler({ body: JSON.stringify({ fileName: 'x.csv' }) }); // no fileContent
    check('a request with no fileContent fails as 400, not 500', () =>
      assert.strictEqual(res.statusCode, 400, res.body));
    check('missing-body import writes nothing', () => assert.strictEqual(store.size, 0));
  }

  // 7. re-importing the same set id -----------------------------------------
  resetDb();
  {
    const first = await invoke({
      fileName: 'greatest-hits.csv', fileContent: CAA_CSV,
      customTitle: 'Greatest Hits', engagementType: 'call-and-answer',
    });
    assert.strictEqual(first.statusCode, 200, first.body);
    const afterFirst = store.size;

    // Same title -> same slug -> same set id.
    const second = await invoke({
      fileName: 'greatest-hits-v2.csv', fileContent: CAA_CSV,
      customTitle: 'Greatest Hits', engagementType: 'call-and-answer',
    });
    // DOCUMENTED CURRENT BEHAVIOUR: upload refuses; there is no REPLACE path,
    // so re-import is a hard 400 rather than an overwrite or a duplicate.
    check('re-import of an existing set id is refused with 400', () =>
      assert.strictEqual(second.statusCode, 400, second.body));
    check('the refusal explains the set already exists', () =>
      assert.match(parse(second).error, /already exists/i));
    check('the refused re-import changed nothing in the table', () =>
      assert.strictEqual(store.size, afterFirst));
    check('no duplicate question rows were created', () =>
      assert.strictEqual(questionsOf('greatesthits').length, 3));

    // And the known orphan hazard: metadata gone, question rows still present
    // (what a failed/partial DELETE leaves behind) -> the guard does not catch it.
    store.delete('SETS|SET#greatesthits');
    const third = await invoke({
      fileName: 'greatest-hits.csv', fileContent: CAA_CSV,
      customTitle: 'Greatest Hits', engagementType: 'call-and-answer',
    });
    check('orphaned question rows do NOT block a re-import (known Bug D)', () =>
      assert.strictEqual(third.statusCode, 200, third.body));
    check('re-import over identical orphans overwrites rather than duplicates', () =>
      assert.strictEqual(questionsOf('greatesthits').length, 3));
  }

  // 8. a 160-question set: batched writes, not one request per question ------
  resetDb();
  {
    const rows = [CAA_HEADER];
    for (let i = 1; i <= 160; i++) {
      const cat = `Cat${String(Math.ceil(i / 40)).padStart(2, '0')}`;
      rows.push(`"${cat}",${i},"TITLE ${i}","Detail for question ${i}.","School","Instruction ${i}",`);
    }
    const res = await invoke({
      fileName: 'big.csv', fileContent: rows.join('\n'),
      customTitle: 'Big Set', engagementType: 'call-and-answer',
    });
    check('a 160-question set imports', () => assert.strictEqual(res.statusCode, 200, res.body));
    check('all 160 questions land in the table', () =>
      assert.strictEqual(questionsOf('bigset').length, 160));
    check('all 4 categories land in the table', () =>
      assert.strictEqual([...store.values()].filter((i) => String(i.SK).startsWith('CATEGORY#')).length, 4));
    check('160 questions are written in batches, not 160 requests', () => {
      const writes = writeCount();
      assert.ok(writes <= 20, `${writes} write requests for 160 questions + 4 categories + metadata`);
    });
    check('no batch exceeds the 25-item BatchWrite limit', () => {
      for (const c of log.filter((x) => x.type === 'batchWrite')) {
        assert.ok(c.input.RequestItems[TABLE].length <= 25);
      }
    });
    check('the last question is numbered correctly within its category', () =>
      assert.ok(store.get('SET#bigset|QUESTION#c004#040'), 'QUESTION#c004#040 missing'));
  }

  // 9. UnprocessedItems must be retried, never dropped -----------------------
  resetDb();
  {
    const rows = [CAA_HEADER];
    for (let i = 1; i <= 60; i++) {
      rows.push(`"Cat",${i},"TITLE ${i}","Detail ${i}.","School","Instruction ${i}",`);
    }
    // Dynamo "throttles" three items the first time it sees them.
    deferOnce = new Set([
      'SET#retryset|QUESTION#c001#005',
      'SET#retryset|QUESTION#c001#030',
      'SET#retryset|QUESTION#c001#058',
    ]);
    const res = await invoke({
      fileName: 'retry.csv', fileContent: rows.join('\n'),
      customTitle: 'Retry Set', engagementType: 'call-and-answer',
    });
    check('import survives throttled writes', () => assert.strictEqual(res.statusCode, 200, res.body));
    check('throttled items are retried, not silently dropped', () =>
      assert.strictEqual(questionsOf('retryset').length, 60,
        `only ${questionsOf('retryset').length}/60 questions persisted`));
  }

  // 10. rows the importer skips must be reported, not silently swallowed -----
  resetDb();
  {
    const csv = [
      CAA_HEADER,
      '"Leadership",1,"A GOOD ROW","Detail.","School","Instruction.",',
      ',2,"NO CATEGORY","Detail.","School","Instruction.",',            // dropped: no Category
      '"Leadership",3,,"Detail.","School","Instruction.",',              // dropped: no Title
      '"Leadership",4,"ANOTHER GOOD ROW","Detail.","School","Inst.",',
    ].join('\n');
    const res = await invoke({
      fileName: 'partial.csv', fileContent: csv,
      customTitle: 'Partial Set', engagementType: 'call-and-answer',
    });
    const body = parse(res);
    check('rows missing Category/Title are dropped, the rest import', () =>
      assert.strictEqual(body.questionCount, 2, JSON.stringify(body)));
    check('the response reports how many rows were skipped', () =>
      assert.strictEqual(body.skippedRowCount, 2,
        `skippedRowCount was ${body.skippedRowCount} — silent truncation`));
    check('the response says which rows were skipped', () =>
      assert.ok(Array.isArray(body.skippedRows) && body.skippedRows.length === 2,
        `skippedRows was ${JSON.stringify(body.skippedRows)}`));
  }

  // 11. a mid-import failure must not leave a browsable half-set -------------
  resetDb();
  {
    failNextWrite = (item) => String(item.SK) === 'QUESTION#c001#002';
    const res = await invoke({
      fileName: 'boom.csv', fileContent: CAA_CSV,
      customTitle: 'Boom Set', engagementType: 'call-and-answer',
    });
    failNextWrite = null;
    check('a failed write surfaces as a 500', () => assert.strictEqual(res.statusCode, 500, res.body));
    check('no set metadata is left pointing at a half-written set', () =>
      assert.strictEqual(store.get('SETS|SET#boomset'), undefined,
        'metadata row survived a failed import — the set lists as importable but is incomplete'));
    check('a failed import leaves no orphan rows in the SET# partition', () => {
      const orphans = [...store.values()].filter((i) => i.PK === 'SET#boomset');
      assert.strictEqual(orphans.length, 0,
        `${orphans.length} orphan rows left behind: ${orphans.map((o) => o.SK).join(', ')}`);
    });
  }

  // 12. CRLF line endings (Excel-exported CSV) -------------------------------
  resetDb();
  {
    const res = await invoke({
      fileName: 'excel.csv', fileContent: CAA_CSV.replace(/\n/g, '\r\n'),
      customTitle: 'Excel Set', engagementType: 'call-and-answer',
    });
    check('a CRLF CSV imports all rows', () => assert.strictEqual(parse(res).questionCount, 3, res.body));
    check('CRLF does not leave a stray CR on the last column', () => {
      const q = store.get('SET#excelset|QUESTION#c001#001');
      assert.strictEqual(q.CustomInstructions, 'How would you apply this?');
    });
  }

  say(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { process.stdout.write(`harness error: ${e && e.stack}\n`); process.exit(1); });
