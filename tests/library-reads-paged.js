/**
 * Reads over partitions that grow with the whole platform must follow
 * LastEvaluatedKey to the end.
 *
 * The Workie default (tests/ai-summary-default-prompt-paged.js) went blind on
 * dev because its read stopped at the first 1 MB page. The same shape — one
 * Query or Scan, `.Items` taken as the whole answer — sits in every reader of
 * a library that every organisation adds to:
 *
 *   admin/get-ai-prompts.js        the prompt library list
 *   admin/create-ai-prompt.js      the one-default-per-game-type sweep
 *   admin/update-ai-prompt.js      the same sweep on edit
 *   admin/populate-defaults.js     the "already seeded?" check
 *   admin/get-question-sets.js     the set library
 *   game/get-question-sets.js      the host's set picker
 *   admin/orgs/platform-orgs.js    the platform's organisation list
 *   archive/list-archive.js        the archive list (a table Scan)
 *
 * None has crossed 1 MB yet — the largest partition on any tier is ~185 KB —
 * so each is a silent truncation waiting for growth: a sweep that leaves two
 * defaults, a seeder that duplicates, a picker missing sets. The fake cuts
 * pages of three rows BEFORE filtering (tests/helpers/paged-table.js), so each
 * reader here is handed a boundary in the middle of what it must see.
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const assert = require('assert');
const Module = require('module');
const { createPagedTable, commands } = require('./helpers/paged-table');

const REPO = path.join(__dirname, '..');
const LF = path.join(REPO, 'lambda-functions');

const stubs = new Map();
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (stubs.has(request)) return stubs.get(request);
  return realLoad.call(this, request, parent, isMain);
};
const stub = (name, exports) => stubs.set(name, exports);

const table = createPagedTable({ pageSize: 3 });
stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', { DynamoDBDocumentClient: { from: () => table }, ...commands });

const s3Store = new Map();
stub('@aws-sdk/client-s3', {
  S3Client: class {
    async send(cmd) {
      if (cmd.type === 'put') { s3Store.set(cmd.input.Key, cmd.input.Body); return {}; }
      if (cmd.type === 'get') {
        const body = s3Store.get(cmd.input.Key);
        if (!body) { const e = new Error('NoSuchKey'); e.name = 'NoSuchKey'; throw e; }
        return { Body: { transformToString: async () => body } };
      }
      return {};
    }
  },
  PutObjectCommand: class { constructor(i) { this.input = i; this.type = 'put'; } },
  GetObjectCommand: class { constructor(i) { this.input = i; this.type = 'get'; } },
  DeleteObjectCommand: class { constructor(i) { this.input = i; this.type = 'delete'; } },
});
stub('@aws-sdk/client-kms', {
  KMSClient: class { async send() { throw new Error('no KMS in this suite'); } },
  GenerateDataKeyCommand: class {}, DecryptCommand: class {},
});

process.env.TABLE_NAME = 'test-table';
process.env.AI_PROMPTS_BUCKET = 'test-bucket';

// Engage staff with no active organisation: canManageScope(PLATFORM).
const STAFF = (method, extra = {}) => ({
  requestContext: {
    http: { method },
    authorizer: { lambda: { userId: 'sub-g', username: 'g', groups: 'admins', status: 'enabled' } },
  },
  ...extra,
});

const load = (rel) => require(path.join(LF, rel));

let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}
const reset = () => { table.store.clear(); table.log.length = 0; s3Store.clear(); };
const body = (res) => JSON.parse(res.body);
const pad = (n) => String(n).padStart(2, '0');

// A usable summary prompt row, with its S3 body.
const promptRow = (id, fields = {}) => {
  const s3Key = `prompts/${id}/v1.json`;
  s3Store.set(s3Key, JSON.stringify({ name: id, instructions: 'Summarise.', outputFormat: '## Summary' }));
  table.put({
    PK: 'AIPROMPTS', SK: `AIPROMPT#${id}`, promptId: id, name: id, gameType: 'trivia',
    category: 'general', promptType: 'analysis', status: 'active', isDefault: false,
    s3Key, version: 1, createdAt: '2025-01-01T00:00:00Z', ...fields,
  });
};

(async () => {
  console.log('library readers: every page of a platform-wide partition is read\n');

  // ── get-ai-prompts: the list ────────────────────────────────────────────
  reset();
  for (let n = 1; n <= 8; n++) promptRow(`p${pad(n)}`, { status: n === 8 ? 'archived' : 'active' });
  const getPrompts = load('admin/get-ai-prompts.js');
  const all = body(await getPrompts.handler(STAFF('GET', { queryStringParameters: {} })));
  await check('get-ai-prompts lists all eight platform prompts across three pages', () => {
    const ids = (all.prompts || all.items || all).map((p) => p.promptId).sort();
    assert.deepStrictEqual(ids, ['p01', 'p02', 'p03', 'p04', 'p05', 'p06', 'p07', 'p08']);
  });
  const archived = body(await getPrompts.handler(STAFF('GET', { queryStringParameters: { status: 'archived' } })));
  await check('a status filter finds the one archived prompt on the last page', () => {
    const ids = (archived.prompts || archived.items || archived).map((p) => p.promptId);
    assert.deepStrictEqual(ids, ['p08'], 'the first page, filtered, is empty — and was taken as the answer');
  });

  // ── create-ai-prompt: the one-default sweep ─────────────────────────────
  reset();
  for (let n = 1; n <= 7; n++) promptRow(`p${pad(n)}`);
  promptRow('p08', { isDefault: true });
  const createPrompt = load('admin/create-ai-prompt.js');
  const created = await createPrompt.handler(STAFF('POST', {
    body: JSON.stringify({
      name: 'New trivia default', gameType: 'trivia', promptType: 'analysis', category: 'general',
      instructions: 'Summarise the round: {triviaResponses}', outputFormat: '## Summary', isDefault: true,
    }),
  }));
  await check('create-ai-prompt answers 2xx', () =>
    assert(created.statusCode < 300, `got ${created.statusCode}: ${created.body}`));
  await check('creating a trivia default clears the old default on page 3', () =>
    assert.strictEqual(table.get('AIPROMPTS', 'AIPROMPT#p08').isDefault, false,
      'two trivia defaults now exist — the sweep read one page'));

  // ── update-ai-prompt: the same sweep on edit ────────────────────────────
  reset();
  for (let n = 1; n <= 7; n++) promptRow(`p${pad(n)}`);
  promptRow('p08', { isDefault: true });
  const updatePrompt = load('admin/update-ai-prompt.js');
  const updated = await updatePrompt.handler(STAFF('PUT', {
    pathParameters: { promptId: 'p01' },
    body: JSON.stringify({ isDefault: true }),
  }));
  await check('update-ai-prompt answers 2xx', () =>
    assert(updated.statusCode < 300, `got ${updated.statusCode}: ${updated.body}`));
  await check('making p01 the trivia default clears the old default on page 3', () => {
    assert.strictEqual(table.get('AIPROMPTS', 'AIPROMPT#p01').isDefault, true);
    assert.strictEqual(table.get('AIPROMPTS', 'AIPROMPT#p08').isDefault, false,
      'two trivia defaults now exist — the sweep read one page');
  });

  // ── populate-defaults: the "already seeded" check ───────────────────────
  reset();
  const defaults = require(path.join(LF, 'admin', 'default-ai-prompts.json'));
  const seededNames = Object.values(defaults).flatMap((cats) => Object.values(cats).map((p) => p.name));
  // Every default already exists, under ids that sort AFTER six filler rows,
  // so all of them are past the first page.
  for (let n = 1; n <= 6; n++) promptRow(`a${pad(n)}`);
  seededNames.forEach((name, i) => promptRow(`z${pad(i)}`, { name }));
  const before = [...table.store.values()].filter((r) => String(r.SK).startsWith('AIPROMPT#')).length;
  const populate = load('admin/populate-defaults.js');
  const seeded = await populate.handler(STAFF('POST', { body: JSON.stringify({}) }));
  await check('populate-defaults answers 2xx', () =>
    assert(seeded.statusCode < 300, `got ${seeded.statusCode}: ${seeded.body}`));
  await check('re-running the seeder creates no duplicate of a prompt stored past page 1', () => {
    const after = [...table.store.values()].filter((r) => String(r.SK).startsWith('AIPROMPT#')).length;
    assert.strictEqual(after, before, `${after - before} duplicate prompt(s) minted`);
  });

  // ── the set library (admin) and the set picker (game) ───────────────────
  reset();
  for (let n = 1; n <= 8; n++) {
    table.put({ PK: 'SETS', SK: `SET#set${pad(n)}`, name: `Set ${n}`, active: true, gameType: 'trivia' });
    table.put({ PK: `SET#set${pad(n)}`, SK: 'CATEGORY#general', name: 'General', questionCount: 3 });
  }
  const wantSets = ['set01', 'set02', 'set03', 'set04', 'set05', 'set06', 'set07', 'set08'];
  const adminSets = await load('admin/get-question-sets.js').handler(STAFF('GET', { pathParameters: {} }));
  await check('admin/get-question-sets lists all eight platform sets', () => {
    assert.strictEqual(adminSets.statusCode, 200, adminSets.body);
    const b = body(adminSets);
    const ids = (b.questionSets || b.sets || b).map((s) => s.id).sort();
    assert.deepStrictEqual(ids, wantSets);
  });
  const gameSets = await load('game/get-question-sets.js').handler(STAFF('GET'));
  await check('game/get-question-sets offers the host all eight platform sets', () => {
    assert.strictEqual(gameSets.statusCode, 200, gameSets.body);
    const b = body(gameSets);
    const ids = (b.questionSets || b.sets || b).map((s) => s.id).sort();
    assert.deepStrictEqual(ids, wantSets);
  });

  // ── the platform's organisation list ────────────────────────────────────
  reset();
  for (let n = 1; n <= 8; n++) {
    table.put({ PK: 'ORGS', SK: `ORG#org_${pad(n)}`, orgId: `org_${pad(n)}`, name: `Org ${n}`, plan: 'team', status: 'active' });
  }
  const orgs = await load('admin/orgs/platform-orgs.js').handler(STAFF('GET'));
  await check('platform-orgs lists all eight organisations', () => {
    assert.strictEqual(orgs.statusCode, 200, orgs.body);
    const b = body(orgs);
    const ids = (b.orgs || b.items || b).map((o) => o.orgId).sort();
    assert.deepStrictEqual(ids, ['org_01', 'org_02', 'org_03', 'org_04', 'org_05', 'org_06', 'org_07', 'org_08']);
  });

  // ── the archive list: a table Scan ──────────────────────────────────────
  reset();
  // Other rows share the archive table and sort ahead of ARCHIVE.
  for (let n = 1; n <= 5; n++) table.put({ PK: `AAA#${n}`, SK: 'X' });
  for (let n = 1; n <= 4; n++) {
    table.put({ PK: 'ARCHIVE', SK: `ITEM#${n}`, Title: `Item ${n}`, ContentType: 'questionset', CreatedAt: `2026-09-0${n}T00:00:00Z` });
  }
  const archive = await load('archive/list-archive.js').handler({ queryStringParameters: { type: 'questionset' } });
  await check('list-archive returns all four archive items, not the first page\'s none', () => {
    assert.strictEqual(archive.statusCode, 200, archive.body);
    assert.deepStrictEqual(body(archive).items.map((i) => i.SK).sort(), ['ITEM#1', 'ITEM#2', 'ITEM#3', 'ITEM#4']);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('harness error:', e); process.exit(1); });
