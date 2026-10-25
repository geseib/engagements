/**
 * EVERY TEMPLATE A PERSON CAN DOWNLOAD IMPORTS UNCHANGED — and says what the
 * authoring rules say.
 *
 *   node tests/template-roundtrip.js
 *
 * lambda-functions/admin/download-template.js serves a CSV per set type, and
 * src/src/config/aiAuthoringPrompt.js is the prompt a host pastes beside that
 * CSV into somebody else's AI. Agents COPY EXAMPLES: a template whose every
 * trivia row is correct on OptionA, or whose call-and-answer instructions are
 * personal ("How would you apply…"), teaches the AI the opposite of the prompt
 * it was handed. So this downloads every template, uploads it through the REAL
 * importer (upload-questions.js, DynamoDB and KMS stubbed) and asserts:
 *
 *   §1 it imports with every row kept and nothing skipped;
 *   §2 the rows obey the authoring rules for their type;
 *   §3 the header the authoring prompt dictates is the template's header;
 *   §4 the AI scenario CSV (shared/generated-set.js) carries RoundKind and the
 *      importer stores it per row.
 *
 * Grown from the audit's scratch harness (tmpl-roundtrip.js, 2026-10-25).
 */
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const TABLE = 'test-table';

// ---- Stub the SDK by request string, before any handler loads ---------------
const Module = require('module');
const stubs = new Map();
const realLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (stubs.has(request)) return stubs.get(request);
  return realLoad.call(this, request, parent, isMain);
};
const stub = (name, exports) => stubs.set(name, exports);

class GetCommand { constructor(i) { this.input = i; this.type = 'get'; } }
class PutCommand { constructor(i) { this.input = i; this.type = 'put'; } }
class QueryCommand { constructor(i) { this.input = i; this.type = 'query'; } }
class UpdateCommand { constructor(i) { this.input = i; this.type = 'update'; } }
class BatchWriteCommand { constructor(i) { this.input = i; this.type = 'batchWrite'; } }
class DeleteCommand { constructor(i) { this.input = i; this.type = 'delete'; } }

const store = new Map(); // "PK|SK" -> Item
const keyOf = (item) => `${item.PK}|${item.SK}`;
const put = (item) => store.set(keyOf(item), item);
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
        if (rhs.startsWith(':')) item[attr] = values[rhs];
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
const { makeKmsStub, forgetAllOrgs } = require(path.join(REPO, 'tests', 'helpers', 'tenant-crypto-stub'));
stub('@aws-sdk/client-kms', makeKmsStub().exports);

process.env.TABLE_NAME = TABLE;
process.env.TENANT_KMS_KEY_ID = 'alias/engage-tenant';

const admin = (f) => require(path.join(REPO, 'lambda-functions', 'admin', f));
const upload = admin('upload-questions.js').handler;
const template = admin('download-template.js').handler;
const { scenariosToCsv } = admin(path.join('shared', 'generated-set.js'));

/** One CSV line → cells. Quote-aware, `""` is a quote; the templates never break a cell across lines. */
function parseCSVLine(line) {
  const cells = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i += 1; } else if (ch === '"') quoted = false; else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { cells.push(cur); cur = ''; } else cur += ch;
  }
  cells.push(cur);
  return cells;
}
const { authoringPrompt } = require(path.join(REPO, 'src', 'src', 'config', 'aiAuthoringPrompt.js'));

if (!process.env.DEBUG) { console.log = () => {}; console.warn = () => {}; console.error = () => {}; }
const say = (...a) => process.stdout.write(`${a.join(' ')}\n`);

let passed = 0;
let failed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; say(`  PASS  ${name}`); } catch (error) { failed += 1; say(`  FAIL  ${name}\n        ${error.message}`); }
}

/** Engage staff with no organisation: writes the platform library, in plaintext. */
const STAFF = { requestContext: { authorizer: { lambda: { userId: 'sub-eve', username: 'eve', groups: 'admins', status: 'enabled' } } } };
const parse = (res) => { try { return JSON.parse(res.body); } catch { return {}; } };

/** The importer's engagement type for each template. Art Title is a call-and-answer set. */
const TEMPLATES = [
  { type: 'trivia', engagementType: 'trivia' },
  { type: 'call-and-answer', engagementType: 'call-and-answer' },
  { type: 'wavelength', engagementType: 'wavelength' },
  { type: 'art-title', engagementType: 'call-and-answer' },
  { type: 'poll', engagementType: 'poll' },
  { type: 'survey', engagementType: 'survey' },
  ...['presentation-feedback', 'event-feedback', 'workshop-retro', 'training-evaluation', 'team-pulse']
    .map((id) => ({ type: 'survey', template: id, engagementType: 'survey' })),
];

/** Download one template, import it unchanged, and return what landed. */
async function roundTrip({ type, template: templateId, engagementType }) {
  store.clear();
  forgetAllOrgs();
  const res = await template({ queryStringParameters: { type, ...(templateId ? { template: templateId } : {}) } });
  assert.strictEqual(res.statusCode, 200, `template ${type} answered ${res.statusCode}`);
  const file = parse(res);
  const title = `Template ${type} ${templateId || ''}`.trim();
  const imported = await upload({
    ...STAFF,
    body: JSON.stringify({
      fileName: file.filename, fileContent: file.content, customTitle: title,
      engagementType, topic: 'business-work',
    }),
  });
  const body = parse(imported);
  const setId = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const rows = [...store.values()]
    .filter((i) => String(i.SK).startsWith('QUESTION#') && String(i.PK).startsWith('SET#'))
    .sort((a, b) => a.QuestionNumber - b.QuestionNumber);
  const lines = file.content.split('\n').filter((l) => l.trim());
  return { file, status: imported.statusCode, body, rows, setId, dataRows: lines.length - 1, header: lines[0] };
}

const label = (t) => (t.template ? `${t.type} (${t.template})` : t.type);

(async () => {
  say('§1 every template imports unchanged, every row kept');
  const results = {};
  for (const t of TEMPLATES) {
    // eslint-disable-next-line no-await-in-loop
    const r = await roundTrip(t);
    results[label(t)] = r;
    // eslint-disable-next-line no-await-in-loop
    await check(`${label(t)}: 200, ${r.dataRows} rows in, ${r.dataRows} questions stored, none skipped`, () => {
      assert.strictEqual(r.status, 200, `import answered ${r.status}: ${r.body.error || ''}`);
      assert.strictEqual(r.rows.length, r.dataRows, `stored ${r.rows.length} of ${r.dataRows}`);
      const skipped = r.body.skippedRows || [];
      assert.strictEqual(Array.isArray(skipped) ? skipped.length : Number(skipped) || 0, 0, `skipped: ${JSON.stringify(skipped)}`);
    });
  }

  say('§2 the rows obey the authoring rules they are an example of');
  const trivia = results.trivia;
  await check('trivia: the correct letter varies across rows', () => {
    const letters = trivia.rows.map((q) => q.CorrectAnswer || q.correctAnswer);
    assert.ok(letters.every(Boolean), `a row has no correct answer: ${JSON.stringify(letters)}`);
    assert.ok(new Set(letters).size >= 3, `the template teaches one letter: ${JSON.stringify(letters)}`);
  });
  await check('trivia: options A–D filled on every row, E and F left empty', () => {
    const [header, ...data] = trivia.file.content.split('\n').filter((l) => l.trim()).map(parseCSVLine);
    const at = (name) => header.indexOf(name);
    for (const cells of data) {
      for (const o of ['optionA', 'optionB', 'optionC', 'optionD']) assert.ok(cells[at(o)].trim(), `${o} is empty on "${cells[at('title')]}"`);
      for (const o of ['optionE', 'optionF']) assert.strictEqual(cells[at(o)].trim(), '', `${o} is filled on "${cells[at('title')]}"`);
    }
  });
  await check('trivia: one row shows the optional Background column, and it is stored', () => {
    assert.ok(/,Background$/.test(trivia.header), `header: ${trivia.header}`);
    assert.ok(trivia.rows.some((q) => String(q.Background || '').trim()), 'no row carries a Background');
  });

  const ca = results['call-and-answer'];
  await check('call-and-answer: every instruction is a forward-looking question through the team\'s lens', () => {
    for (const q of ca.rows) {
      const text = String(q.CustomInstructions || '');
      assert.ok(/\?$/.test(text.trim()), `not a question: "${text}"`);
      assert.ok(/\bour (team|organisation|organization|group)\b/i.test(text), `not the team's lens: "${text}"`);
      assert.ok(!/\b(recall a time|a time you|how would you|in your current)\b/i.test(text), `personal: "${text}"`);
    }
  });
  await check('call-and-answer: three categories, and no lesson is the old "greatest of all time" boilerplate', () => {
    assert.strictEqual(new Set(ca.rows.map((q) => q.Category)).size, 3);
    for (const q of ca.rows) {
      assert.ok(!/\b(greatest|most effective|best)\b/i.test(q.Title), `superlative title: ${q.Title}`);
      assert.ok(!/\bConsider (different|methods|frameworks)\b/.test(q.Detail), `boilerplate lesson: ${q.Detail}`);
    }
  });

  const wl = results.wavelength;
  await check('wavelength: a 1–4 word subject, no framing detail, the fixed instruction', () => {
    for (const q of wl.rows) {
      const words = String(q.Title).trim().split(/\s+/).length;
      assert.ok(words >= 1 && words <= 4, `"${q.Title}" is ${words} words`);
      assert.strictEqual(String(q.Detail || ''), '', `"${q.Title}" carries framing: ${q.Detail}`);
      assert.strictEqual(q.CustomInstructions, 'Enter up to 10 words or short phrases that come to mind when you think about this subject.');
    }
  });

  const art = results['art-title'];
  await check('art-title: no lesson shown to players, the reveal and the image kept', () => {
    for (const q of art.rows) {
      assert.strictEqual(String(q.Detail || ''), '', `${q.Title} shows a lesson during ASK`);
      assert.ok(/^Real title:/.test(String(q.AnswerDetails || '')), `${q.Title} has no reveal`);
      assert.ok(String(q.Image || '').trim(), `${q.Title} has no image`);
    }
  });

  say('§3 the header the authoring prompt dictates is the header the template carries');
  for (const [name, type] of [['trivia', 'trivia'], ['call-and-answer', 'call-and-answer'], ['wavelength', 'wavelength'],
    ['art-title', 'art-title'], ['poll', 'poll'], ['survey', 'survey']]) {
    // eslint-disable-next-line no-await-in-loop
    await check(`${name}: the prompt names the template's header`, () => {
      const text = authoringPrompt(type);
      assert.strictEqual(typeof text, 'string', `no authoring prompt for ${type}`);
      // The optional trailing Background column is the one allowed difference.
      const header = results[name].header.replace(/,Background$/, '');
      assert.ok(text.includes(header), `prompt does not carry:\n        ${header}`);
    });
  }

  say('§4 the AI scenario CSV carries the round kind per row');
  await check('scenariosToCsv writes RoundKind when given one, and the importer stores it per row', async () => {
    const csv = scenariosToCsv([
      { title: 'Stop the line', category: 'Quality', detail: 'Anyone may stop production.', customInstructions: 'Where could our team do this?', tags: ['lean'] },
      { title: 'Blameless review', category: 'Learning', detail: 'Fix the system, not the person.', customInstructions: 'What would our team change?', tags: [] },
    ], { roundKind: 'apply' });
    assert.ok(csv.split('\n')[0].endsWith(',RoundKind'), csv.split('\n')[0]);
    store.clear();
    forgetAllOrgs();
    const res = await upload({ ...STAFF, body: JSON.stringify({ fileName: 'kind.csv', fileContent: csv, customTitle: 'Kind Roundtrip', engagementType: 'call-and-answer', topic: 'business-work' }) });
    assert.strictEqual(res.statusCode, 200, parse(res).error);
    const stored = [...store.values()].filter((i) => String(i.SK).startsWith('QUESTION#'));
    assert.strictEqual(stored.length, 2);
    for (const q of stored) assert.strictEqual(q.RoundKind, 'apply');
  });
  await check('scenariosToCsv with no round kind writes no RoundKind column (unchanged shape)', () => {
    const csv = scenariosToCsv([{ title: 'T', category: 'C', detail: 'D' }]);
    assert.strictEqual(csv.split('\n')[0], 'Category,Question#,Title,Detail_lesson,School,CustomInstruction,Tags,Background');
  });

  say(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
