/**
 * A QUESTION'S BACKGROUND NEVER REACHES THE LOGS — on the editor's read.
 *
 * ── THE LEAK ───────────────────────────────────────────────────────────────
 *
 * `admin/get-question-set-questions.js` is the read the console editor and the
 * host remote's question browser load a set from. It carried a DEBUG block that
 * printed the FIRST QUESTION ROW WHOLE — `console.log('🔍 Sample raw item:',
 * questionsRes.Items[0])` — and it printed it AFTER `decryptItems`, so for an
 * organisation's set every boundary field went to CloudWatch in the clear:
 * the title, the detail, the options, AnswerDetails, and since the
 * question-background work, Background.
 *
 * question-background spec, "Logging": *"Background content is never logged.
 * Lengths only."* Background is ENCRYPTED at rest for an org set
 * (ENCRYPTED_FIELDS.question); decrypting it and then logging it is not
 * encrypting it.
 *
 * ── THE RULE ───────────────────────────────────────────────────────────────
 *
 * The read says WHAT HAPPENED — which set, which category, how many questions.
 * Never what a question says.
 *
 * rejects: the Background sentinel, or any other question content (title,
 *          detail, answer details), in any console output at unlimited depth
 *          while an org set or a platform set is read; a fix that drops
 *          Background from the editor's payload (the editor must still load it
 *          to edit it); a fix that silences the trace (it must still name the
 *          set and the count).
 *
 * FIXTURES ARE PRODUCED, NOT WRITTEN: both sets are created by the real
 * upload-questions.js from a CSV, so the org set's rows are envelopes made by
 * the real encryptItem, and the read decrypts them through the real
 * decryptItems.
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const util = require('util');
const crypto = require('crypto');
const assert = require('assert');

const REPO = path.join(__dirname, '..');

// ---- Stub the AWS SDK before any handler loads -----------------------------
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
const store = new Map();
const k = (item) => `${item.PK}|${item.SK}`;

/** Only the UpdateExpression shapes upload-questions.js's activeVersion flip issues. */
function applyUpdate(inp) {
  const key = `${inp.Key.PK}|${inp.Key.SK}`;
  const item = { ...(store.get(key) || { PK: inp.Key.PK, SK: inp.Key.SK }) };
  const names = inp.ExpressionAttributeNames || {};
  const values = inp.ExpressionAttributeValues || {};
  const body = String(inp.UpdateExpression).replace(/^\s*SET\s+/i, '');
  for (const clause of body.split(/,(?![^(]*\))/)) {
    const [lhsRaw, rhsRaw] = clause.split('=');
    if (!rhsRaw) continue;
    const attr = names[lhsRaw.trim()] || lhsRaw.trim();
    const rhs = rhsRaw.trim();
    const listAppend = rhs.match(/^list_append\(\s*if_not_exists\(([^,]+),\s*([^)]+)\)\s*,\s*(\S+)\s*\)$/);
    if (listAppend) {
      const existing = item[names[listAppend[1].trim()] || listAppend[1].trim()];
      const seed = values[listAppend[2].trim()];
      const entry = values[listAppend[3].trim()];
      item[attr] = [...(Array.isArray(existing) ? existing : seed), ...entry];
      continue;
    }
    item[attr] = values[rhs];
  }
  store.set(key, item);
  return { Attributes: item };
}

const fakeDoc = {
  send: async (cmd) => {
    const inp = cmd.input || {};
    if (cmd.type === 'get') return { Item: store.get(`${inp.Key.PK}|${inp.Key.SK}`) };
    if (cmd.type === 'put') { store.set(k(inp.Item), inp.Item); return {}; }
    if (cmd.type === 'delete') { store.delete(`${inp.Key.PK}|${inp.Key.SK}`); return {}; }
    if (cmd.type === 'update') return applyUpdate(inp);
    if (cmd.type === 'batchWrite') {
      for (const r of inp.RequestItems[TABLE] || []) {
        if (r.PutRequest) store.set(k(r.PutRequest.Item), r.PutRequest.Item);
        else if (r.DeleteRequest) store.delete(`${r.DeleteRequest.Key.PK}|${r.DeleteRequest.Key.SK}`);
      }
      return { UnprocessedItems: {} };
    }
    if (cmd.type === 'query') {
      const v = inp.ExpressionAttributeValues || {};
      const pk = v[':pk'] ?? v[':setpk'];
      const prefix = v[':sk'] ?? v[':questionPrefix'];
      let items = [...store.values()].filter((i) => i.PK === pk);
      if (prefix) items = items.filter((i) => String(i.SK).startsWith(prefix));
      items.sort((a, b) => String(a.SK).localeCompare(String(b.SK)));
      return { Items: items, Count: items.length };
    }
    return { Items: [], Count: 0 };
  },
};

const { makeKmsStub, installTestKeyLoader } = require('./helpers/tenant-crypto-stub');
const kmsStub = makeKmsStub();
stub('@aws-sdk/client-kms', kmsStub.exports);
installTestKeyLoader();
stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => fakeDoc },
  GetCommand, PutCommand, DeleteCommand, QueryCommand,
  ScanCommand, UpdateCommand, BatchWriteCommand,
});

process.env.TABLE_NAME = TABLE;

const upload = require(path.join(REPO, 'lambda-functions', 'admin', 'upload-questions.js')).handler;
const getQuestions = require(path.join(REPO, 'lambda-functions', 'admin', 'get-question-set-questions.js')).handler;

// ---- Harness ----------------------------------------------------------------

const say = (...a) => process.stdout.write(a.join(' ') + '\n');
let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); say(`  ok   - ${label}`); pass += 1; } catch (e) { say(`  FAIL - ${label}\n         ${e.message}`); fail += 1; }
}

/**
 * Everything the console prints while `fn` runs, formatted the way the Lambda
 * runtime formats it (util.format) but with no depth, array or string limit —
 * printing is what leaks, and a default inspect's truncation is luck, not
 * redaction. Same capture as answer-content-not-logged.js.
 */
const FORMAT = { depth: Infinity, maxArrayLength: Infinity, maxStringLength: Infinity, breakLength: Infinity };
const LEVELS = ['log', 'info', 'warn', 'error', 'debug'];
async function captureLogs(fn) {
  const lines = [];
  const orig = {};
  for (const level of LEVELS) {
    orig[level] = console[level];
    console[level] = (...args) => lines.push(util.formatWithOptions(FORMAT, ...args));
  }
  let out;
  try { out = await fn(); } finally { Object.assign(console, orig); }
  return { out, logs: lines.join('\n') };
}

/** A string no fixture, id or log template could contain by accident. */
const marker = (tag) => `zq${tag}${crypto.randomBytes(4).toString('hex')}`;

function assertNotLogged(logs, needle, what) {
  const at = logs.indexOf(needle);
  if (at < 0) return;
  const lineStart = logs.lastIndexOf('\n', at) + 1;
  const lineEnd = logs.indexOf('\n', at);
  const line = logs.slice(lineStart, lineEnd < 0 ? undefined : lineEnd).slice(0, 300);
  assert.fail(`${what} reached the logs:\n         ${line}`);
}

const parse = (res) => JSON.parse(res.body);

/** An org ADMIN in this API's real event shape — see set-versioning-flow.js. */
const orgAdmin = () => ({
  requestContext: {
    authorizer: { lambda: { username: 'ada', userId: 'sub-ada', groups: 'admins', status: 'enabled', orgId: 'org_nw', orgRole: 'admin' } },
  },
});
/**
 * No groups and no org: the internal-invocation seam that writes PLATFORM
 * content (question-set-access.js:createSetRef), as the seed scripts do.
 */
const internal = () => ({ requestContext: {} });

function csvFor(s) {
  return [
    'Category,Question#,Title,Detail_lesson,School,CustomInstruction,AnswerDetails,Background,Tags',
    `"Delivery",1,"${s.title}","${s.detail}","Engineering","Name one thing.","${s.answer}","${s.background}","release"`,
  ].join('\n');
}

async function createSet(caller, title, sentinels) {
  const res = await captureLogs(() => upload({
    ...caller,
    body: JSON.stringify({
      fileName: `${title}.csv`, fileContent: csvFor(sentinels), customTitle: title,
      engagementType: 'call-and-answer', topic: 'business-work',
    }),
  }));
  assert.strictEqual(res.out.statusCode, 200, `create failed: ${res.out.body}`);
  return parse(res.out).setId;
}

const sentinelsFor = (tag) => ({
  title: marker(`${tag}title`).toUpperCase(),
  detail: marker(`${tag}detail`),
  answer: marker(`${tag}answer`),
  background: marker(`${tag}background`),
});

(async () => {
  for (const [label, caller, reader] of [
    ['an organisation\'s set (encrypted at rest)', orgAdmin(), orgAdmin()],
    ['a platform set', internal(), orgAdmin()],
  ]) {
    say(`\n  -- ${label} --`);
    const s = sentinelsFor(label.startsWith('an org') ? 'o' : 'p');
    // A plain set title: the setId is derived from it and the trace names the
    // setId, so a sentinel here would be a false leak.
    const setId = await createSet(caller, label.startsWith('an org') ? 'Logging Org Set' : 'Logging Platform Set', s);

    // Guard against a vacuous pass: the org rows really are envelopes, so a
    // Background in the logs could only have come from the read's decrypt.
    if (label.startsWith('an org')) {
      await check('the stored row holds Background as an envelope, not text', () => {
        const row = [...store.values()].find((i) => String(i.SK).startsWith('QUESTION#') && String(i.PK).includes(setId));
        assert.ok(row, 'no question row was stored');
        assert.ok(row.Background && typeof row.Background === 'object' && typeof row.Background.ct === 'string',
          `Background is not an envelope: ${JSON.stringify(row.Background)}`);
      });
    }

    const { out, logs } = await captureLogs(() => getQuestions({
      ...reader, pathParameters: { setId }, queryStringParameters: {},
    }));

    await check('the read succeeds', () => assert.strictEqual(out.statusCode, 200, out.body));

    // rejects: fixing the log by dropping the field — the editor loads
    // Background from this read in order to edit it.
    await check('the editor is still handed the Background, in the clear', () => {
      const q = parse(out).questions[0];
      assert.strictEqual(q.Background, s.background);
    });

    // THE LEAK.
    await check('Background is never logged', () => assertNotLogged(logs, s.background, 'Background'));
    await check('nor is any other question content', () => {
      assertNotLogged(logs, s.title, 'the title');
      assertNotLogged(logs, s.detail, 'the detail');
      assertNotLogged(logs, s.answer, 'the answer details');
    });

    // rejects: silencing the trace instead of reducing it.
    await check('the trace still says which set and how many questions', () => {
      assert.ok(logs.includes(`Getting questions for set: ${setId}`), `no request line in:\n${logs}`);
      assert.ok(logs.includes(`Found 1 questions for set ${setId}`), `no count line in:\n${logs}`);
    });
  }

  say(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})().catch((e) => { process.stdout.write(`harness error: ${e && e.stack}\n`); process.exit(1); });
