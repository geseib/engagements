/**
 * A SURVEY SET CAN BE IMPORTED — lambda-functions/admin/upload-questions.js
 *
 * Until Phase 1 the importer refused every survey outright ("Survey upload is
 * not yet supported"), so the builder could only export JSON and no survey set
 * existed anywhere. The contract (docs/design/survey-redesign/
 * IMPLEMENTATION-phase-0-1.md) gives a survey its own branch of the one CSV:
 * twenty fixed columns from Kind to Themes, validated per row with the same
 * sentences the browser's rowProblems says.
 *
 * Everything below drives the REAL handlers — the importer, the editor's read
 * (get-question-set-questions) and the download — against one in-memory table.
 * Only DynamoDB and KMS are stubbed, and the KMS stub refuses a Decrypt whose
 * encryption context disagrees with the blob (tests/helpers/tenant-crypto-stub),
 * so an org-confusion bug fails here rather than in production.
 *
 * rejects: a survey CSV being refused; a row of any kind landing with the wrong
 * attributes, or with attributes its kind does not use; one bad row sinking the
 * whole file, or being dropped without its reason; the survey's `Kind` column
 * being claimed by the importer's loose RoundKind fallback (which would 400 the
 * file as "unrecognised round kinds"); the builder's old JSON export being
 * refused; a JSON upload for any OTHER type being accepted, or refused in words
 * that still talk about surveys; an org survey's options, labels and follow-up
 * question sitting in the clear at rest; an org POLL's options doing the same;
 * the editor or the download being handed an envelope instead of the words.
 */
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const TABLE = 'test-table';

// ---- Stub the SDK by request string, before any handler loads ---------------
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
class QueryCommand { constructor(i) { this.input = i; this.type = 'query'; } }
class UpdateCommand { constructor(i) { this.input = i; this.type = 'update'; } }
class BatchWriteCommand { constructor(i) { this.input = i; this.type = 'batchWrite'; } }
class DeleteCommand { constructor(i) { this.input = i; this.type = 'delete'; } }

const store = new Map(); // "PK|SK" -> Item
const k = (item) => `${item.PK}|${item.SK}`;
const put = (item) => store.set(k(item), item);
const rowsIn = (pk) => [...store.values()].filter((i) => i.PK === pk);

const fakeDoc = {
  send: async (cmd) => {
    const inp = cmd.input || {};
    if (cmd.type === 'get') return { Item: store.get(`${inp.Key.PK}|${inp.Key.SK}`) };
    if (cmd.type === 'put') { put(inp.Item); return {}; }
    if (cmd.type === 'delete') { store.delete(`${inp.Key.PK}|${inp.Key.SK}`); return {}; }
    if (cmd.type === 'update') {
      const key = `${inp.Key.PK}|${inp.Key.SK}`;
      const item = store.get(key) || { ...inp.Key };
      const names = inp.ExpressionAttributeNames || {};
      const values = inp.ExpressionAttributeValues || {};
      const body = String(inp.UpdateExpression || '').replace(/^\s*SET\s+/i, '');
      for (const clause of body.split(/,(?![^(]*\))/)) {
        const [lhsRaw, rhsRaw] = clause.split('=');
        if (!rhsRaw) continue;
        const attr = names[lhsRaw.trim()] || lhsRaw.trim();
        const rhs = rhsRaw.trim();
        const listAppend = rhs.match(/^list_append\(\s*if_not_exists\(([^,]+),\s*([^)]+)\)\s*,\s*(\S+)\s*\)$/);
        if (listAppend) {
          const existing = item[names[listAppend[1].trim()] || listAppend[1].trim()];
          item[attr] = [...(Array.isArray(existing) ? existing : values[listAppend[2].trim()]), ...values[listAppend[3].trim()]];
        } else if (rhs.startsWith(':')) {
          item[attr] = values[rhs];
        }
      }
      store.set(key, item);
      return { Attributes: item };
    }
    if (cmd.type === 'batchWrite') {
      const reqs = inp.RequestItems[TABLE] || [];
      assert.ok(reqs.length <= 25, `BatchWrite over the 25-item limit: ${reqs.length}`);
      for (const r of reqs) {
        if (r.PutRequest) put(r.PutRequest.Item);
        if (r.DeleteRequest) store.delete(`${r.DeleteRequest.Key.PK}|${r.DeleteRequest.Key.SK}`);
      }
      return { UnprocessedItems: {} };
    }
    if (cmd.type === 'query') {
      const v = inp.ExpressionAttributeValues || {};
      const pk = v[':pk'] ?? v[':setpk'] ?? v[':PK'];
      const prefix = v[':sk'] ?? v[':questionPrefix'] ?? v[':prefix'] ?? '';
      const items = [...store.values()]
        .filter((i) => i.PK === pk && String(i.SK).startsWith(String(prefix)))
        .sort((a, b) => String(a.SK).localeCompare(String(b.SK)));
      return { Items: items, Count: items.length };
    }
    return { Items: [], Count: 0 };
  },
};

stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => fakeDoc },
  GetCommand, PutCommand, QueryCommand, UpdateCommand, BatchWriteCommand, DeleteCommand,
});
const { makeKmsStub, mintOrg, forgetAllOrgs } = require('./helpers/tenant-crypto-stub');
stub('@aws-sdk/client-kms', makeKmsStub().exports);

process.env.TABLE_NAME = TABLE;
process.env.TENANT_KMS_KEY_ID = 'alias/engage-tenant';

const A = (f) => require(path.join(REPO, 'lambda-functions', 'admin', f)).handler;
const upload = A('upload-questions.js');
const editorRead = A('get-question-set-questions.js');
const download = A('download-question-set.js');

if (!process.env.DEBUG) { console.log = () => {}; console.warn = () => {}; console.error = () => {}; }
const say = (...a) => process.stdout.write(a.join(' ') + '\n');

let passed = 0; let failed = 0;
async function test(name, fn) {
  try { await fn(); passed += 1; say(`  PASS  ${name}`); }
  catch (error) { failed += 1; say(`  FAIL  ${name}\n        ${error.message}`); }
}

// ---- callers, in this API's real shape (requestContext.authorizer.lambda) ----
const caller = (lambda) => ({ requestContext: { authorizer: { lambda } } });
const ORG = 'org_acme';
const HOST = caller({
  userId: 'sub-ada', username: 'ada', groups: 'hosts', status: 'enabled',
  orgId: ORG, orgRole: 'admin', orgIds: ORG,
});
/** Engage staff with no organisation: writes the platform library, in plaintext. */
const STAFF = caller({ userId: 'sub-eve', username: 'eve', groups: 'admins', status: 'enabled' });

const parse = (res) => { try { return JSON.parse(res.body); } catch { return {}; } };

const isEnvelope = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
  && typeof v.v === 'number' && typeof v.iv === 'string'
  && typeof v.tag === 'string' && typeof v.ct === 'string';

function reset() {
  store.clear();
  forgetAllOrgs();
}

const doUpload = (who, { fileName = 'pulse.csv', fileContent, title = 'Team Pulse', engagementType = 'survey', extra = {} }) =>
  upload({
    ...who,
    body: JSON.stringify({
      fileName, fileContent, customTitle: title, engagementType, topic: 'business-work', ...extra,
    }),
  });

// ---- fixtures -----------------------------------------------------------------
const HEADER = ['Category', 'Question#', 'Title', 'Detail_lesson', 'School', 'CustomInstruction',
  'Kind', 'Required', 'Options', 'AllowMultiple', 'MaxPicks', 'AllowOther', 'Shuffle', 'Scale',
  'LowLabel', 'HighLabel', 'YesLabel', 'NoLabel', 'Unsure', 'FollowUpWhen', 'FollowUpPrompt',
  'RankTop', 'TextLength', 'MaxLength', 'Placeholder', 'Themes', 'Tags'];

/** One CSV line in header order: every cell quoted, Question# bare. */
const line = (cells) => HEADER.map((h) => (h === 'Question#'
  ? String(cells[h] ?? '')
  : `"${String(cells[h] ?? '').replace(/"/g, '""')}"`)).join(',');
const csvOf = (...rows) => [HEADER.join(','), ...rows.map(line)].join('\n');

const RATING = { Category: 'Survey', 'Question#': 1, Title: 'How likely are you to recommend this session?', Kind: 'rating', Required: 'true', Scale: '0-10', LowLabel: 'Not at all likely', HighLabel: 'Extremely likely', Tags: 'nps' };
const CHOICE = { Category: 'Survey', 'Question#': 2, Title: 'Which formats would you want more of?', Kind: 'choice', Options: 'More time for questions|A hands-on breakout|Slides sent a day ahead|A recording afterwards', AllowMultiple: 'true', MaxPicks: '2', AllowOther: 'true', Shuffle: 'false' };
const YESNO = { Category: 'Survey', 'Question#': 3, Title: 'Was the length about right?', Kind: 'yesno', Required: 'true', Unsure: 'true', FollowUpWhen: 'no', FollowUpPrompt: 'What would you cut or add?' };
const RANK = { Category: 'Survey', 'Question#': 4, Title: 'Rank these topics for next time', Kind: 'rank', Options: 'Customer stories|Product roadmap|Team wins|Culture & hiring|Financials', RankTop: '3' };
const TEXT = { Category: 'Survey', 'Question#': 5, Title: 'What would you like to see added?', Kind: 'text', TextLength: 'short', Placeholder: 'One idea is plenty' };
const EVERY_KIND = csvOf(RATING, CHOICE, YESNO, RANK, TEXT);

/** The attributes every question row carries whatever its type. */
const COMMON = new Set(['PK', 'SK', 'Title', 'Detail', 'Category', 'School', 'Image', 'CustomInstructions',
  'Tags', 'OrderInCategory', 'QuestionNumber', 'CategoryQuestionNumber', 'Active']);
const surveyAttrs = (row) => Object.fromEntries(Object.entries(row).filter(([key]) => !COMMON.has(key)));

const questionRows = (pk) => rowsIn(pk)
  .filter((i) => String(i.SK).startsWith('QUESTION#'))
  .sort((a, b) => a.QuestionNumber - b.QuestionNumber);

(async function run() {
  say('\n1. a survey CSV imports, one row of every kind');

  reset();
  const created = await doUpload(STAFF, { fileContent: EVERY_KIND });
  const body = parse(created);
  const rows = questionRows('SET#teampulse#v1');

  await test('the import succeeds', () => assert.strictEqual(created.statusCode, 200, created.body));
  await test('five questions, nothing skipped, one category', () => {
    assert.strictEqual(body.questionCount, 5);
    assert.strictEqual(body.skippedRowCount, 0, JSON.stringify(body.skippedRows));
    assert.strictEqual(body.categoryCount, 1);
    assert.strictEqual(rows.length, 5);
  });
  await test('the set is recorded as a survey', () =>
    assert.strictEqual(store.get('SETS|SET#teampulse').engagementType, 'survey'));
  await test('every row is filed under Survey', () =>
    assert.deepStrictEqual(rows.map((r) => r.Category), ['Survey', 'Survey', 'Survey', 'Survey', 'Survey']));
  await test('rating: kind, required, the 0–10 scale and both labels — and nothing else', () =>
    assert.deepStrictEqual(surveyAttrs(rows[0]), {
      kind: 'rating', required: true, scale: '0-10', lowLabel: 'Not at all likely', highLabel: 'Extremely likely',
    }));
  await test('choice: the list, several picks up to two, a write-in', () =>
    assert.deepStrictEqual(surveyAttrs(rows[1]), {
      kind: 'choice', required: false,
      options: ['More time for questions', 'A hands-on breakout', 'Slides sent a day ahead', 'A recording afterwards'],
      allowMultiple: true, maxPicks: 2, allowOther: true, shuffle: false,
    }));
  await test('yes/no: Not sure, and a follow-up on No', () =>
    assert.deepStrictEqual(surveyAttrs(rows[2]), {
      kind: 'yesno', required: true, yesLabel: '', noLabel: '', unsure: true,
      followUpWhen: 'no', followUpPrompt: 'What would you cut or add?',
    }));
  await test('rank: five items, the top three is enough', () =>
    assert.deepStrictEqual(surveyAttrs(rows[3]), {
      kind: 'rank', required: false,
      options: ['Customer stories', 'Product roadmap', 'Team wins', 'Culture & hiring', 'Financials'], rankTop: 3,
    }));
  await test('text: short, 280 characters by default, a placeholder, themes on', () =>
    assert.deepStrictEqual(surveyAttrs(rows[4]), {
      kind: 'text', required: false, textLength: 'short', maxLength: 280, placeholder: 'One idea is plenty', themes: true,
    }));
  await test('the Kind column is NOT read as a RoundKind override', () => {
    for (const r of rows) assert.ok(!('RoundKind' in r), `row ${r.SK} carries RoundKind ${r.RoundKind}`);
  });
  await test('per-question tags still land', () => assert.deepStrictEqual(rows[0].Tags, ['nps']));

  say('\n2. the category is filled, never asked for');

  await test('a blank Category cell becomes Survey', async () => {
    reset();
    const res = await doUpload(STAFF, { fileContent: csvOf({ ...RATING, Category: '' }), title: 'Blank Cat' });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(questionRows('SET#blankcat#v1')[0].Category, 'Survey');
  });
  await test('a survey CSV with no Category column at all still imports, under Survey', async () => {
    reset();
    const csv = ['Title,Kind,Scale', '"How was it?","rating","1-5"'].join('\n');
    const res = await doUpload(STAFF, { fileContent: csv, title: 'No Cat' });
    assert.strictEqual(res.statusCode, 200, res.body);
    const r = questionRows('SET#nocat#v1')[0];
    assert.strictEqual(r.Category, 'Survey');
    assert.strictEqual(r.kind, 'rating');
    assert.strictEqual(r.scale, '1-5');
  });

  say('\n3. a bad row is skipped with its reason, and the rest import');

  reset();
  const mixed = await doUpload(STAFF, {
    title: 'Mixed',
    fileContent: csvOf(
      RATING,
      { ...CHOICE, 'Question#': 2, Options: 'Only one' },
      { Category: 'Survey', 'Question#': 3, Title: '', Kind: 'slider' },
      { ...RANK, 'Question#': 4, RankTop: '5' },
      TEXT,
    ),
  });
  const mixedBody = parse(mixed);
  await test('the file still imports', () => assert.strictEqual(mixed.statusCode, 200, mixed.body));
  await test('only the two good rows are written', () => {
    assert.strictEqual(mixedBody.questionCount, 2);
    assert.deepStrictEqual(questionRows('SET#mixed#v1').map((r) => r.kind), ['rating', 'text']);
  });
  await test('each skipped row says why, in the contract\'s words, joined with "; "', () =>
    assert.deepStrictEqual(mixedBody.skippedRows, [
      // Every problem on the row at once: the fixture keeps CHOICE's "up to 2".
      { row: 3, reason: "needs at least two options; can't allow 2 picks from 1 options" },
      { row: 4, reason: "needs a title; unknown kind 'slider'" },
      { row: 5, reason: "can't rank the top 5 of 5" },
    ]));
  await test('the message counts the skipped rows', () => assert.match(mixedBody.message, /3 row\(s\) skipped/));
  await test('a file where every row is bad is refused, not created empty', async () => {
    reset();
    const res = await doUpload(STAFF, { fileContent: csvOf({ ...CHOICE, Options: '' }), title: 'All Bad' });
    assert.strictEqual(res.statusCode, 400);
    assert.ok(!store.get('SETS|SET#allbad'), 'an empty set was created');
  });
  await test('a survey CSV with no Kind column is refused, naming the column', async () => {
    reset();
    const csv = ['Category,Title,Detail_lesson', '"Survey","How was it?",""'].join('\n');
    const res = await doUpload(STAFF, { fileContent: csv, title: 'No Kind' });
    assert.strictEqual(res.statusCode, 400);
    assert.match(parse(res).error, /Kind column/);
  });

  say('\n4. the survey builder\'s old JSON export imports');

  const LEGACY = JSON.stringify({
    id: 1727000000000,
    title: 'Q3 Team Health Check',
    description: 'A short pulse survey.',
    questions: [
      { id: 1, question: 'How satisfied are you with your tooling?', type: 'rating', scale: { type: '1-10', lowLabel: 'Very Dissatisfied', highLabel: 'Very Satisfied' }, required: true, tags: ['tooling'] },
      { id: 2, question: 'Which of these slow you down?', type: 'multiple_choice', options: ['Builds', 'Reviews', 'Meetings'], allowMultiple: true, required: true, tags: [] },
      { id: 3, question: 'Your work email?', type: 'text_entry', textType: 'email', placeholder: 'you@example.com', required: false, tags: [] },
      { id: 4, question: 'What would you change first?', type: 'text_entry', textType: 'long', placeholder: 'Please share…', required: false, tags: [] },
    ],
  }, null, 2);

  reset();
  const legacy = await doUpload(STAFF, { fileName: 'survey-Q3_Team_Health_Check-1727000000000.json', fileContent: LEGACY, title: 'Health Check' });
  const legacyRows = questionRows('SET#healthcheck#v1');
  await test('a .json survey export is accepted', () => assert.strictEqual(legacy.statusCode, 200, legacy.body));
  await test('all four questions land, none skipped', () => {
    assert.strictEqual(parse(legacy).skippedRowCount, 0, JSON.stringify(parse(legacy).skippedRows));
    assert.strictEqual(legacyRows.length, 4);
  });
  await test("'rating' keeps its '1-10' scale and labels", () =>
    assert.deepStrictEqual(surveyAttrs(legacyRows[0]), {
      kind: 'rating', required: true, scale: '1-10', lowLabel: 'Very Dissatisfied', highLabel: 'Very Satisfied',
    }));
  await test("'multiple_choice' is a choice with several picks", () => {
    assert.strictEqual(legacyRows[1].kind, 'choice');
    assert.deepStrictEqual(legacyRows[1].options, ['Builds', 'Reviews', 'Meetings']);
    assert.strictEqual(legacyRows[1].allowMultiple, true);
  });
  await test("'text_entry' asking for an email is a short answer", () => {
    assert.strictEqual(legacyRows[2].kind, 'text');
    assert.strictEqual(legacyRows[2].textLength, 'short');
    assert.strictEqual(legacyRows[2].maxLength, 280);
  });
  await test("'text_entry' long stays long", () => assert.strictEqual(legacyRows[3].textLength, 'long'));
  await test('the question text is the Title, under Survey', () => {
    assert.strictEqual(legacyRows[0].Title, 'How satisfied are you with your tooling?');
    assert.strictEqual(legacyRows[0].Category, 'Survey');
  });
  await test('a survey .json that is not JSON is refused with a readable message', async () => {
    reset();
    const res = await doUpload(STAFF, { fileName: 'broken.json', fileContent: '{ "questions": [', title: 'Broken' });
    assert.strictEqual(res.statusCode, 400);
    assert.match(parse(res).error, /not valid JSON/);
  });

  say('\n5. JSON for any other type is still refused — without talking about surveys');

  for (const type of ['trivia', 'poll', 'call-and-answer', 'wavelength']) {
    await test(`a .json upload for ${type} is refused`, async () => {
      reset();
      const res = await doUpload(STAFF, { fileName: 'questions.json', fileContent: LEGACY, engagementType: type, title: 'Json Try' });
      assert.strictEqual(res.statusCode, 400);
      const error = parse(res).error || '';
      assert.match(error, /JSON/);
      assert.ok(!/survey/i.test(error), `the refusal still talks about surveys: ${error}`);
      assert.ok(!store.get('SETS|SET#jsontry'), 'a set was created');
    });
  }
  await test('JSON content under a .csv name is refused for a non-survey type too', async () => {
    reset();
    const res = await doUpload(STAFF, { fileName: 'sneaky.csv', fileContent: LEGACY, engagementType: 'trivia', title: 'Sneaky' });
    assert.strictEqual(res.statusCode, 400);
  });

  say('\n6. an ORG survey is ciphertext at rest and words everywhere a person reads it');

  reset();
  await mintOrg(put, ORG);
  const orgCreated = await doUpload(HOST, { fileContent: EVERY_KIND, title: 'Team Pulse' });
  const orgRows = questionRows(`ORG#${ORG}#SET#teampulse#v1`);
  await test('the org import succeeds', () => assert.strictEqual(orgCreated.statusCode, 200, orgCreated.body));
  await test('options are an ENVELOPE at rest (choice and rank)', () => {
    assert.ok(isEnvelope(orgRows[1].options), `choice options stored as ${JSON.stringify(orgRows[1].options)}`);
    assert.ok(isEnvelope(orgRows[3].options), `rank options stored as ${JSON.stringify(orgRows[3].options)}`);
  });
  await test('lowLabel and highLabel are envelopes at rest', () => {
    assert.ok(isEnvelope(orgRows[0].lowLabel));
    assert.ok(isEnvelope(orgRows[0].highLabel));
  });
  await test('followUpPrompt and placeholder are envelopes at rest', () => {
    assert.ok(isEnvelope(orgRows[2].followUpPrompt));
    assert.ok(isEnvelope(orgRows[4].placeholder));
  });
  await test('no option, label or prompt text appears anywhere in the raw partition', () => {
    const raw = JSON.stringify(rowsIn(`ORG#${ORG}#SET#teampulse#v1`));
    for (const secret of ['A hands-on breakout', 'Product roadmap', 'Extremely likely', 'What would you cut or add?', 'One idea is plenty']) {
      assert.ok(!raw.includes(secret), `"${secret}" is readable at rest`);
    }
  });
  await test('the kind, the scale and the switches stay readable', () => {
    assert.deepStrictEqual(orgRows.map((r) => r.kind), ['rating', 'choice', 'yesno', 'rank', 'text']);
    assert.strictEqual(orgRows[0].scale, '0-10');
    assert.strictEqual(orgRows[1].maxPicks, 2);
    assert.strictEqual(orgRows[2].followUpWhen, 'no');
  });
  await test('the EDITOR is handed the words, not envelopes', async () => {
    const res = await editorRead({ ...HOST, pathParameters: { setId: 'teampulse' } });
    assert.strictEqual(res.statusCode, 200, res.body);
    const qs = parse(res).questions;
    const byKind = Object.fromEntries(qs.map((q) => [q.kind, q]));
    assert.deepStrictEqual(byKind.choice.options,
      ['More time for questions', 'A hands-on breakout', 'Slides sent a day ahead', 'A recording afterwards']);
    assert.strictEqual(byKind.rating.lowLabel, 'Not at all likely');
    assert.strictEqual(byKind.yesno.followUpPrompt, 'What would you cut or add?');
    assert.strictEqual(byKind.text.placeholder, 'One idea is plenty');
    assert.ok(!/"iv":/.test(res.body), 'an envelope reached the editor');
  });

  say('\n7. an ORG poll\'s options are encrypted too — and still download');

  reset();
  await mintOrg(put, ORG);
  const POLL = [
    'Category,Question#,Title,Detail_lesson,School,CustomInstruction,Options,AllowMultiple,Tags',
    '"Delivery",1,"Which release cadence?","","","","Weekly|Fortnightly|Monthly","false","delivery"',
  ].join('\n');
  const pollRes = await doUpload(HOST, { fileName: 'cadence.csv', fileContent: POLL, engagementType: 'poll', title: 'Cadence' });
  const pollRow = questionRows(`ORG#${ORG}#SET#cadence#v1`)[0];
  await test('the org poll imports', () => assert.strictEqual(pollRes.statusCode, 200, pollRes.body));
  await test('its options are an envelope at rest', () =>
    assert.ok(isEnvelope(pollRow.options), `stored as ${JSON.stringify(pollRow.options)}`));
  await test('allowMultiple stays a readable flag', () => assert.strictEqual(pollRow.allowMultiple, false));
  await test('the poll download still carries the options', async () => {
    const res = await download({ ...HOST, pathParameters: { setId: 'cadence' }, queryStringParameters: {} });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.ok(parse(res).content.includes('"Weekly|Fortnightly|Monthly","false"'), parse(res).content);
  });

  say('\n8. a replace inherits the survey type and parses its kinds');

  reset();
  await mintOrg(put, ORG);
  await doUpload(HOST, { fileContent: EVERY_KIND, title: 'Team Pulse' });
  const replaced = await upload({
    ...HOST,
    body: JSON.stringify({
      fileName: 'pulse-v2.csv', replaceSetId: 'teampulse',
      fileContent: csvOf({ ...RATING, Scale: 'stars' }, TEXT),
    }),
  });
  await test('the replace succeeds and writes v2', () => {
    assert.strictEqual(replaced.statusCode, 200, replaced.body);
    assert.strictEqual(parse(replaced).version, 2);
  });
  await test('v2 carries the survey attributes', () => {
    const v2 = questionRows(`ORG#${ORG}#SET#teampulse#v2`);
    assert.deepStrictEqual(v2.map((r) => r.kind), ['rating', 'text']);
    assert.strictEqual(v2[0].scale, 'stars');
  });

  say('\n9. the download is the contract CSV, byte for byte');

  // Written out by hand from the contract — not produced by the module under
  // test — so a change to either the exporter or survey-kinds.js that moves a
  // byte is caught here.
  const EXPECTED_DOWNLOAD = [
    'Category,Question#,Title,Detail_lesson,School,CustomInstruction,Kind,Required,Options,AllowMultiple,MaxPicks,AllowOther,Shuffle,Scale,LowLabel,HighLabel,YesLabel,NoLabel,Unsure,FollowUpWhen,FollowUpPrompt,RankTop,TextLength,MaxLength,Placeholder,Themes,Tags',
    '"Survey",1,"How likely are you to recommend this session?","","","","rating","true","","false","","false","false","0-10","Not at all likely","Extremely likely","","","false","","","","","","","false","nps"',
    '"Survey",2,"Which formats would you want more of?","","","","choice","false","More time for questions|A hands-on breakout|Slides sent a day ahead|A recording afterwards","true","2","true","false","","","","","","false","","","","","","","false",""',
    '"Survey",3,"Was the length about right?","","","","yesno","true","","false","","false","false","","","","","","true","no","What would you cut or add?","","","","","false",""',
    '"Survey",4,"Rank these topics for next time","","","","rank","false","Customer stories|Product roadmap|Team wins|Culture & hiring|Financials","false","","false","false","","","","","","false","","","3","","","","false",""',
    '"Survey",5,"What would you like to see added?","","","","text","false","","false","","false","false","","","","","","false","","","","short","280","One idea is plenty","true",""',
    '',
  ].join('\n');

  const downloadCsv = async (who, setId, query = {}) => {
    const res = await download({ ...who, pathParameters: { setId }, queryStringParameters: query });
    assert.strictEqual(res.statusCode, 200, res.body);
    return parse(res);
  };

  reset();
  await doUpload(STAFF, { fileContent: EVERY_KIND, title: 'Team Pulse' });
  await test('a survey set downloads as CSV by default (no longer JSON)', async () => {
    const out = await downloadCsv(STAFF, 'teampulse');
    assert.strictEqual(out.contentType, 'text/csv');
    assert.match(out.filename, /\.csv$/);
  });
  await test('…and the CSV is exactly the contract header and cells', async () =>
    assert.strictEqual((await downloadCsv(STAFF, 'teampulse')).content, EXPECTED_DOWNLOAD));
  await test('format=json still works when asked for', async () => {
    const out = await downloadCsv(STAFF, 'teampulse', { format: 'json' });
    assert.strictEqual(out.contentType, 'application/json');
    const doc = JSON.parse(out.content);
    assert.strictEqual(doc.metadata.engagementType, 'survey');
    assert.strictEqual(doc.questions.length, 5);
    assert.strictEqual(doc.questions[1].kind, 'choice');
  });
  await test('download → re-upload → the same rows', async () => {
    const { content } = await downloadCsv(STAFF, 'teampulse');
    const again = await doUpload(STAFF, { fileContent: content, title: 'Team Pulse Again' });
    assert.strictEqual(again.statusCode, 200, again.body);
    assert.strictEqual(parse(again).skippedRowCount, 0);
    const strip = (r) => ({ ...surveyAttrs(r), Title: r.Title, Category: r.Category, Tags: r.Tags, QuestionNumber: r.QuestionNumber });
    assert.deepStrictEqual(questionRows('SET#teampulseagain#v1').map(strip), questionRows('SET#teampulse#v1').map(strip));
  });
  await test('an ORG survey downloads the same words it was given', async () => {
    reset();
    await mintOrg(put, ORG);
    await doUpload(HOST, { fileContent: EVERY_KIND, title: 'Team Pulse' });
    const { content } = await downloadCsv(HOST, 'teampulse');
    assert.strictEqual(content, EXPECTED_DOWNLOAD);
    assert.ok(!content.includes('"iv"'), 'an envelope was exported into a cell');
  });
  await test('the optional columns sit between Themes and Tags, as for every other type', async () => {
    reset();
    const header = HEADER.slice(0, -1).concat(['AnswerDetails', 'Tags']);
    const csv = [header.join(','), header.map((h) => {
      const v = { ...RATING, AnswerDetails: 'Shared with the room afterwards' }[h];
      return h === 'Question#' ? String(v) : `"${v ?? ''}"`;
    }).join(',')].join('\n');
    await doUpload(STAFF, { fileContent: csv, title: 'With Reveal' });
    const { content } = await downloadCsv(STAFF, 'withreveal');
    assert.ok(content.split('\n')[0].endsWith(',Placeholder,Themes,AnswerDetails,Tags'), content.split('\n')[0]);
    assert.ok(content.split('\n')[1].endsWith(',"false","Shared with the room afterwards","nps"'), content.split('\n')[1]);
  });
  await test('a CSV built by itemsToSurveyCsv downloads as itself (the draft-set path)', async () => {
    reset();
    const { itemsToSurveyCsv } = require(path.join(REPO, 'lambda-functions/admin/shared/survey-kinds.js'));
    const built = itemsToSurveyCsv([
      { kind: 'rating', title: 'How useful was it?', required: true, scale: '1-5', lowLabel: 'Not useful', highLabel: 'Very useful', tags: ['usefulness'] },
      { kind: 'choice', title: 'Which part helped most?', options: ['The demo', 'The Q&A', 'The "numbers" slide'], allowOther: true },
      { kind: 'yesno', title: 'Would you come again?', unsure: true },
      { kind: 'rank', title: 'Order these', options: ['One', 'Two', 'Three', 'Four'], rankTop: 2 },
      { kind: 'text', title: 'Anything else?' },
    ]);
    const res = await doUpload(STAFF, { fileContent: built, title: 'Built' });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual((await downloadCsv(STAFF, 'built')).content, built);
  });

  say('\n10. the survey templates');

  const template = A('download-template.js');
  const getTemplate = async (query) => {
    const res = await template({ queryStringParameters: query });
    return { res, body: parse(res) };
  };
  const importTemplate = async (content, title) => {
    reset();
    const res = await doUpload(STAFF, { fileContent: content, title });
    assert.strictEqual(res.statusCode, 200, res.body);
    return { body: parse(res), setRows: questionRows(`SET#${title.toLowerCase().replace(/[^a-z0-9]/g, '')}#v1`) };
  };

  await test('type=survey is a CSV now: survey-template.csv', async () => {
    const { res, body: t } = await getTemplate({ type: 'survey' });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(t.filename, 'survey-template.csv');
    assert.ok(t.content.startsWith(`${EXPECTED_DOWNLOAD.split('\n')[0]}\n`), 'not the contract header');
  });
  await test('…with one question of every kind, all under Survey, importing with nothing skipped', async () => {
    const { body: t } = await getTemplate({ type: 'survey' });
    const { body: imported, setRows } = await importTemplate(t.content, 'Every Kind');
    assert.strictEqual(imported.skippedRowCount, 0, JSON.stringify(imported.skippedRows));
    assert.deepStrictEqual(setRows.map((r) => r.kind).sort(), ['choice', 'rank', 'rating', 'text', 'yesno']);
    assert.ok(setRows.every((r) => r.Category === 'Survey'));
  });

  const NAMED = ['presentation-feedback', 'event-feedback', 'workshop-retro', 'training-evaluation', 'team-pulse'];
  for (const id of NAMED) {
    await test(`template=${id} imports with zero skipped rows, 6–8 questions mixing kinds`, async () => {
      const { res, body: t } = await getTemplate({ type: 'survey', template: id });
      assert.strictEqual(res.statusCode, 200, res.body);
      assert.strictEqual(t.filename, `survey-${id}.csv`);
      const { body: imported, setRows } = await importTemplate(t.content, id);
      assert.strictEqual(imported.skippedRowCount, 0, JSON.stringify(imported.skippedRows));
      assert.ok(setRows.length >= 6 && setRows.length <= 8, `${setRows.length} questions`);
      assert.ok(new Set(setRows.map((r) => r.kind)).size >= 3, 'fewer than three kinds');
    });
  }
  await test('presentation-feedback is the mockups\' eight questions, in order', async () => {
    const { body: t } = await getTemplate({ type: 'survey', template: 'presentation-feedback' });
    const { setRows } = await importTemplate(t.content, 'Preso');
    assert.deepStrictEqual(setRows.map((r) => [r.kind, r.Title]), [
      ['rating', 'How useful was today’s session for your work?'],
      ['rating', 'How likely are you to recommend this session to a colleague?'],
      ['choice', 'Which part of the presentation was most valuable to you?'],
      ['choice', 'Which formats would you want more of next time?'],
      ['yesno', 'Was the length about right?'],
      ['rank', 'Rank these topics for the next all-hands'],
      ['text', 'What was the best part of the presentation?'],
      ['text', 'What would you like to see added or changed?'],
    ]);
    assert.strictEqual(setRows[1].scale, '0-10', 'the recommend question is a 0–10 score');
    assert.strictEqual(setRows[3].maxPicks, 2);
    assert.strictEqual(setRows[3].allowOther, true);
    assert.strictEqual(setRows[4].followUpWhen, 'no');
    assert.strictEqual(setRows[5].rankTop, 3);
    assert.strictEqual(setRows[7].textLength, 'short');
  });
  await test('an unknown template id is refused, naming the ones that exist', async () => {
    const { res, body: t } = await getTemplate({ type: 'survey', template: 'nope' });
    assert.strictEqual(res.statusCode, 400);
    for (const id of NAMED) assert.ok(t.error.includes(id), t.error);
  });

  say(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { say('harness error: ' + (e && e.stack || e)); process.exit(2); });
