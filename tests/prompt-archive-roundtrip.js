/**
 * A PROMPT MUST SURVIVE A ROUND TRIP THROUGH THE ARCHIVE.
 *
 * Read the archive on 2026-08-15 and every prompt in it was hollow:
 *
 *     "prompt": { "instructions": "", "outputFormat": "", "template": "",
 *                 "scenario": "", "systemPrompt": "", "userPrompt": "",
 *                 "variables": {} }
 *
 * Nine of them, including four the console had reported as successful exports.
 * Two independent faults produced that, and a third would have wrecked the
 * import even if the export had been perfect.
 *
 * ── 1. THE EXPORT FUNCTION COULD NOT READ A PROMPT BODY AT ALL ─────────────
 *
 * A prompt is a TWO-STORE record: the pointer row in DynamoDB, and the body in
 * AI_PROMPTS_BUCKET at `s3Key`. AdminExportToArchiveFunction had neither that
 * environment variable nor any S3 read policy (template-clean.yaml), so the
 * body fetch failed on every prompt, every time — and the pre-338af103 code
 * swallowed the error into `promptContent = {}` and uploaded a metadata-only
 * shell with a 200.
 *
 * ── 2. THE EXPORT COPIED FIVE HAND-PICKED FIELDS ───────────────────────────
 *
 * instructions, outputFormat, template, scenario. That is the ANALYSIS shape.
 * A GENERATION prompt (the 22 `gen-*` rows) keeps its text in basePrompt,
 * contextTemplate, audienceTemplate, categoryTemplate and outputSections, none
 * of which were on the list — so it archived as four empty strings AND reported
 * success. Same data-loss shape as the dropped CSV columns fixed twice before
 * in this area, and the reason the fix is a wholesale body copy rather than a
 * longer allow-list: an allow-list goes stale silently every time
 * create-ai-prompt.js gains a field, and no test can catch it because the
 * export still succeeds.
 *
 * ── 3. THE IMPORT WROTE NO BODY, AND FOUR WRONG VALUES ─────────────────────
 *
 * It wrote the text inline as `systemPrompt`/`userPrompt` — attributes nothing
 * in the product reads — and no S3 object and no `s3Key`. So an imported prompt
 * was bodyless to every consumer: visible in the library, attachable to a set,
 * and silently falling back to the game-type default in a live room. Plus
 * `status: 'inactive'` (outside the active|draft|archived vocabulary, so it
 * matched no filter in the console meant to review it), the game-type ALIAS
 * 'callandanswer' instead of the canonical id, `variables: []` where the export
 * writes an object, and no `promptType`.
 *
 * WHAT THIS FILE ASSERTS. The two real handlers, driven end to end with stubbed
 * AWS and a stubbed archive service: export a prompt, feed exactly what it
 * produced back to import, and require the text to still be there and the row
 * to be shaped the way create-ai-prompt.js shapes one. No UI involved.
 */
const assert = require('assert');
const path = require('path');
const Module = require('module');

const REPO = path.join(__dirname, '..');

// ---- Stubs, installed before anything under test loads ---------------------
const stubs = new Map();
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (stubs.has(request)) return stubs.get(request);
  return realLoad.call(this, request, parent, isMain);
};

class GetCommand { constructor(i) { this.input = i; } }
class PutCommand { constructor(i) { this.input = i; } }
class QueryCommand { constructor(i) { this.input = i; } }
class ScanCommand { constructor(i) { this.input = i; } }
class BatchWriteCommand { constructor(i) { this.input = i; } }
class GetObjectCommand { constructor(i) { this.input = i; } }
class PutObjectCommand { constructor(i) { this.input = i; } }

const TABLE = 'test-table';
const PROMPTS_BUCKET = 'engagetest-ai-prompts';

const ddb = new Map();                 // "PK|SK" -> item
const s3 = new Map();                  // "bucket/key" -> string body
const k = (pk, sk) => `${pk}|${sk}`;

const db = {
  async send(cmd) {
    const name = cmd.constructor.name;
    if (name === 'GetCommand') return { Item: ddb.get(k(cmd.input.Key.PK, cmd.input.Key.SK)) };
    if (name === 'PutCommand') {
      ddb.set(k(cmd.input.Item.PK, cmd.input.Item.SK), cmd.input.Item);
      return {};
    }
    if (name === 'QueryCommand') {
      const v = cmd.input.ExpressionAttributeValues || {};
      return { Items: [...ddb.values()].filter((i) => i.PK === v[':pk']) };
    }
    throw new Error(`Unstubbed DynamoDB command: ${name}`);
  }
};

/*
  THE S3 STUB REFUSES AN UNSET BUCKET, WHICH IS THE WHOLE POINT OF FAULT 1.

  A stub that happily accepts `Bucket: undefined` reproduces neither the live
  misconfiguration nor its symptom, and the test would pass against the
  unconfigured template that caused this. Real S3 rejects it; so does this.
*/
const s3stub = {
  async send(cmd) {
    const { Bucket, Key } = cmd.input;
    if (!Bucket) {
      const e = new Error('Bucket name is required'); e.name = 'InvalidBucketName'; throw e;
    }
    if (cmd.constructor.name === 'PutObjectCommand') {
      s3.set(`${Bucket}/${Key}`, cmd.input.Body);
      return {};
    }
    if (cmd.constructor.name === 'GetObjectCommand') {
      const body = s3.get(`${Bucket}/${Key}`);
      if (body === undefined) {
        const e = new Error(`no such key ${Key}`); e.name = 'NoSuchKey'; throw e;
      }
      return { Body: { transformToString: async () => body } };
    }
    throw new Error(`Unstubbed S3 command: ${cmd.constructor.name}`);
  }
};

stubs.set('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stubs.set('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => db },
  GetCommand, PutCommand, QueryCommand, ScanCommand, BatchWriteCommand,
});
stubs.set('@aws-sdk/client-s3', {
  S3Client: class { send(c) { return s3stub.send(c); } },
  GetObjectCommand, PutObjectCommand,
});

process.env.TABLE_NAME = TABLE;
process.env.ARCHIVE_SERVICE_URL = 'https://archive.test.invalid';

const exportHandler = require(path.join(REPO, 'lambda-functions/admin/export-to-archive.js')).handler;
const importHandler = require(path.join(REPO, 'lambda-functions/admin/import-from-archive.js')).handler;

// ---- A stubbed archive service ---------------------------------------------
const archive = new Map();             // archiveId -> { item, content }
let nextArchiveId = 1;
const realFetch = global.fetch;

global.fetch = async (url, options = {}) => {
  const u = String(url);
  if (u.endsWith('/archive/items') && (options.method || 'GET') === 'POST') {
    const data = JSON.parse(options.body);
    const id = `arc-${nextArchiveId++}`;
    archive.set(id, {
      item: { ArchiveId: id, Title: data.title, Description: data.description, Tags: data.tags },
      content: data.content,
    });
    return { ok: true, status: 200, json: async () => ({ archiveId: id }), text: async () => '' };
  }
  const m = /\/archive\/items\/([^/?]+)$/.exec(u);
  if (m && archive.has(m[1])) {
    const rec = archive.get(m[1]);
    return {
      ok: true, status: 200,
      json: async () => ({ ...rec.item, item: rec.item, downloadUrl: `https://dl.test.invalid/${m[1]}` }),
      text: async () => '',
    };
  }
  const d = /\/\/dl\.test\.invalid\/(.+)$/.exec(u);
  if (d && archive.has(d[1])) {
    const rec = archive.get(d[1]);
    return { ok: true, status: 200, text: async () => rec.content, headers: { get: () => 'application/json' } };
  }
  return { ok: false, status: 404, text: async () => 'not found', json: async () => ({}) };
};

let pass = 0, fail = 0;
function check(label, fn) {
  try { fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}
async function checkAsync(label, fn) {
  try { await fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}
const say = (s) => console.log(s);

// ---- Fixtures --------------------------------------------------------------

/** The ANALYSIS shape — what the summary engine can actually run. */
const ANALYSIS_BODY = {
  id: 'p-analysis', version: 2, name: 'Workie — The Transfer Reader',
  gameType: 'call-and-answer', promptType: 'analysis',
  category: 'lessons-learned',
  instructions: 'Read {responsesText} as foreign material nobody here owns.',
  outputFormat: '## Where it lands\n## What resists',
  variables: { responsesText: 'the answers' },
  isDefault: false, status: 'active', questionSetIds: ['qs-1'], tags: ['demo'],
};

/**
 * The GENERATION shape — five fields, NONE of which the old export copied.
 * This fixture is the entire reason for the wholesale body copy.
 */
const GENERATION_BODY = {
  id: 'p-gen', version: 1, name: 'Custom Trivia Topics',
  gameType: 'trivia', promptType: 'generation',
  basePrompt: 'Generate {count} trivia questions about {subject}.',
  contextTemplate: 'The room is {audience}.',
  audienceTemplate: 'Pitch for {audience}.',
  categoryTemplate: 'Spread across {categories}.',
  outputFormat: 'JSON array',
  outputSections: ['question', 'answer', 'explanation'],
  defaultSettings: { count: 10 },
  isDefault: false, status: 'active', questionSetIds: [], tags: [],
};

function seedPrompt(promptId, body, { s3Key = `prompts/${body.gameType}/${promptId}/v${body.version}.json` } = {}) {
  ddb.set(k('AIPROMPTS', `AIPROMPT#${promptId}`), {
    PK: 'AIPROMPTS', SK: `AIPROMPT#${promptId}`,
    promptId, name: body.name, description: 'seeded',
    gameType: body.gameType, promptType: body.promptType, category: body.category,
    status: body.status, isDefault: body.isDefault, version: body.version,
    s3Key, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z',
  });
  s3.set(`${PROMPTS_BUCKET}/${s3Key}`, JSON.stringify(body, null, 2));
}

const reset = () => { ddb.clear(); s3.clear(); archive.clear(); nextArchiveId = 1; };

const exportPrompt = (id) => exportHandler({
  body: JSON.stringify({ selectedItems: [id], exportType: 'prompts' }),
});
const importPrompt = (archiveId) => importHandler({
  body: JSON.stringify({ selectedItems: [archiveId], importType: 'prompts' }),
});
const parse = (res) => JSON.parse(res.body);
const archivedBody = (archiveId) => JSON.parse(archive.get(archiveId).content);
const importedRow = () => [...ddb.values()].find((i) => i.PK === 'AIPROMPTS' && String(i.promptId).startsWith('imported-'));

(async () => {
  // =========================================================================
  say('\n1. THE MISCONFIGURATION — no bucket means no body, and it must SAY so');

  reset();
  delete process.env.AI_PROMPTS_BUCKET;
  seedPrompt('p1', ANALYSIS_BODY);
  let res = await exportPrompt('p1');
  let out = parse(res).results;

  /*
    REJECTS: the shipped behaviour — swallowing the failed read into
    `promptContent = {}` and uploading a metadata-only shell with a 200. That
    is precisely how nine hollow prompts reached the shared archive while the
    console reported nine successes.
  */
  check('an unconfigured bucket fails the export instead of archiving a shell', () =>
    assert.strictEqual(out.successful.length, 0, `expected no successes, got ${JSON.stringify(out.successful)}`));
  check('...and nothing was uploaded to the archive at all', () =>
    assert.strictEqual(archive.size, 0));

  // REJECTS: reporting a deployment fault as a per-prompt content problem, which
  // sends the operator to look at a prompt that is perfectly fine.
  check('...and the failure names the deployment fault, not the prompt', () => {
    assert.strictEqual(out.failed.length, 1);
    assert.match(out.failed[0].error, /AI_PROMPTS_BUCKET is not set/);
    assert.strictEqual(out.failed[0].step, 'config');
  });

  // =========================================================================
  say('\n2. THE ANALYSIS SHAPE — the text survives export');

  reset();
  process.env.AI_PROMPTS_BUCKET = PROMPTS_BUCKET;
  seedPrompt('p1', ANALYSIS_BODY);
  res = await exportPrompt('p1');
  out = parse(res).results;

  await checkAsync('the export succeeds', async () =>
    assert.strictEqual(out.successful.length, 1, JSON.stringify(out.failed)));

  let body = archivedBody('arc-1');
  // REJECTS: the hollow shell. This is the exact assertion that fails against
  // the archive as it stands today.
  check('instructions and outputFormat are present and NOT empty', () => {
    assert.strictEqual(body.prompt.instructions, ANALYSIS_BODY.instructions);
    assert.strictEqual(body.prompt.outputFormat, ANALYSIS_BODY.outputFormat);
    assert.notStrictEqual(body.prompt.instructions, '');
  });

  // REJECTS: dropping the legacy aliases, which older importers still read.
  check('the legacy systemPrompt/userPrompt aliases are still emitted', () => {
    assert.strictEqual(body.prompt.systemPrompt, ANALYSIS_BODY.instructions);
    assert.strictEqual(body.prompt.userPrompt, ANALYSIS_BODY.outputFormat);
  });

  // REJECTS: putting the aliases BEFORE the spread, where a body that carries a
  // real `systemPrompt` would have it overwritten by its own `instructions`.
  check('...and the aliases cannot shadow a real field', () =>
    assert.strictEqual(body.prompt.variables.responsesText, 'the answers'));

  // =========================================================================
  say('\n3. THE GENERATION SHAPE — the five fields the old export dropped');

  reset();
  seedPrompt('gen1', GENERATION_BODY);
  res = await exportPrompt('gen1');
  out = parse(res).results;
  await checkAsync('a generation prompt exports', async () =>
    assert.strictEqual(out.successful.length, 1, JSON.stringify(out.failed)));

  body = archivedBody('arc-1');
  /*
    REJECTS: the allow-list. Each of these five was silently dropped, and the
    export reported success — so a `gen-*` prompt archived as four empty strings
    and looked like a backup.
  */
  for (const field of ['basePrompt', 'contextTemplate', 'audienceTemplate', 'categoryTemplate', 'outputSections']) {
    check(`${field} survives the export`, () =>
      assert.deepStrictEqual(body.prompt[field], GENERATION_BODY[field],
        `${field} was dropped — the export is back to an allow-list`));
  }
  check('defaultSettings survives too', () =>
    assert.deepStrictEqual(body.prompt.defaultSettings, GENERATION_BODY.defaultSettings));

  // REJECTS: leaving a reader of the archive file to guess which of two
  // incompatible shapes it is holding.
  check('the archive records which SHAPE this prompt is', () =>
    assert.strictEqual(body.metadata.promptType, 'generation'));

  // =========================================================================
  say('\n4. THE ROUND TRIP — import writes a body, not just a row');

  reset();
  seedPrompt('p1', ANALYSIS_BODY);
  await exportPrompt('p1');
  res = await importPrompt('arc-1');
  out = parse(res).results;

  await checkAsync('the import succeeds', async () =>
    assert.strictEqual(out.successful.length, 1, JSON.stringify(out.failed)));

  const row = importedRow();
  check('a row was written', () => assert.ok(row, 'no imported AIPROMPTS row'));

  /*
    REJECTS: the shipped import, which wrote systemPrompt/userPrompt inline and
    no s3Key at all. Every reader in the product follows s3Key; a row without
    one is bodyless, so the prompt appeared in the library, could be attached to
    a question set, and produced nothing in a live room.
  */
  check('the row carries an s3Key', () =>
    assert.ok(row.s3Key, 'imported row has no s3Key — every reader will treat it as bodyless'));
  check('...and an object actually exists at it', () =>
    assert.ok(s3.get(`${PROMPTS_BUCKET}/${row.s3Key}`), `nothing written at ${row.s3Key}`));

  const written = JSON.parse(s3.get(`${PROMPTS_BUCKET}/${row.s3Key}`));
  check('...and the text made it all the way through', () => {
    assert.strictEqual(written.instructions, ANALYSIS_BODY.instructions);
    assert.strictEqual(written.outputFormat, ANALYSIS_BODY.outputFormat);
  });

  // REJECTS: writing the aliases back into the body, which puts two copies of
  // the same text in one record and lets them drift apart on the next edit.
  check('the legacy aliases are NOT written back into the body', () => {
    assert.strictEqual(written.systemPrompt, undefined);
    assert.strictEqual(written.userPrompt, undefined);
  });

  // =========================================================================
  say('\n5. THE FOUR WRONG VALUES ON THE IMPORTED ROW');

  /*
    REJECTS: `status: 'inactive'`. The vocabulary is active | draft | archived —
    update-ai-prompt.js whitelists exactly those, and the library filter and the
    per-set picker both compare exact strings. 'inactive' matched no filter, so
    an imported prompt was invisible in the console meant to review it.
  */
  check("status is 'draft', a status that exists", () =>
    assert.strictEqual(row.status, 'draft'));

  // REJECTS: importing straight to active. Somebody else's text should be read
  // before a room hears it.
  check("...and not 'active'", () => assert.notStrictEqual(row.status, 'active'));

  check('gameType is carried through unchanged when it is already canonical', () =>
    assert.strictEqual(row.gameType, 'call-and-answer'));

  // REJECTS: dropping promptType, without which the console cannot tell an
  // analysis prompt from a generation one.
  check('promptType is carried onto the row', () =>
    assert.strictEqual(row.promptType, 'analysis'));

  // REJECTS: `variables: []` where the export writes an object.
  check('variables keeps the type the export wrote', () =>
    assert.deepStrictEqual(written.variables, ANALYSIS_BODY.variables));

  // REJECTS: importing something as the default for its engagement type. A
  // default runs in every room of that type that has no prompt of its own.
  check('an import is never the default', () =>
    assert.strictEqual(row.isDefault, false));

  // REJECTS: carrying the source environment's question-set pins across. Those
  // ids mean nothing in this environment.
  check('question-set pins do not cross environments', () =>
    assert.deepStrictEqual(row.questionSetIds, []));

  // REJECTS: stamping a ttl. The table expires on `ttl`; prompts are
  // configuration, and prompts authored in Aug 2025 once began vanishing in
  // Aug 2026 for exactly this reason.
  check('no ttl is stamped on a prompt', () =>
    assert.strictEqual(row.ttl, undefined));

  // =========================================================================
  say('\n5b. THE GAME-TYPE ALIASES — the case the old default could not handle');

  /*
    THE ASSERTION THAT USED TO PROVE NOTHING.

    "gameType is the canonical id, not an alias" was first written against a
    fixture whose metadata already said `call-and-answer`, so `metadata.gameType
    || 'callandanswer'` and `normalizeGameType(...)` returned the same string and
    the mutation that reverts the fix SURVIVED. The alias path is only reached
    when the archive carries a non-canonical spelling or none at all — which is
    exactly what an entry written by an older environment does.

    shared/game-types.js canonicalises these; the per-set picker and the library
    filter both compare exact strings, so an alias on the row means the prompt is
    invisible in the type it belongs to.
  */
  const ALIAS_CASES = [
    ['callandanswer', 'call-and-answer'],
    ['call_and_answer', 'call-and-answer'],
    ['quiz', 'trivia'],
    ['polls', 'poll'],
  ];
  for (const [spelling, canonical] of ALIAS_CASES) {
    reset();
    archive.set('arc-alias', {
      item: { ArchiveId: 'arc-alias', Title: 'Aliased (dev)', Description: 'x', Tags: ['dev'] },
      content: JSON.stringify({
        metadata: { promptId: 'a1', name: 'Aliased', gameType: spelling },
        prompt: { instructions: 'text {responsesText}', outputFormat: '## Out' },
      }),
    });
    // eslint-disable-next-line no-await-in-loop
    await importPrompt('arc-alias');
    const aliasRow = importedRow();
    check(`gameType "${spelling}" is stored as "${canonical}"`, () =>
      assert.strictEqual(aliasRow.gameType, canonical,
        'an alias reached the row — the picker compares exact strings and will not find it'));
    // REJECTS: canonicalising the row but not the S3 key, which would scatter
    // one game type's prompts across two prefixes.
    check(`...and its s3Key uses "${canonical}" too`, () =>
      assert.ok(String(aliasRow.s3Key).startsWith(`prompts/${canonical}/`),
        `s3Key is ${aliasRow.s3Key}`));
  }

  // REJECTS: defaulting a missing game type to the alias 'callandanswer', which
  // is what the shipped code did.
  reset();
  archive.set('arc-notype', {
    item: { ArchiveId: 'arc-notype', Title: 'Typeless (dev)', Description: 'x', Tags: ['dev'] },
    content: JSON.stringify({
      metadata: { promptId: 'n1', name: 'Typeless' },
      prompt: { instructions: 'text', outputFormat: '## Out' },
    }),
  });
  await importPrompt('arc-notype');
  check('a missing game type falls back to a CANONICAL id', () => {
    const r = importedRow();
    assert.strictEqual(r.gameType, 'call-and-answer',
      `fell back to ${JSON.stringify(r.gameType)}, which is not a canonical id`);
  });

  // =========================================================================
  say('\n6. A GENERATION PROMPT SURVIVES THE FULL ROUND TRIP');

  reset();
  seedPrompt('gen1', GENERATION_BODY);
  await exportPrompt('gen1');
  res = await importPrompt('arc-1');
  await checkAsync('it imports', async () =>
    assert.strictEqual(parse(res).results.successful.length, 1, JSON.stringify(parse(res).results.failed)));

  const genRow = importedRow();
  const genBody = JSON.parse(s3.get(`${PROMPTS_BUCKET}/${genRow.s3Key}`));

  // REJECTS: any regression that makes the round trip analysis-only. This is the
  // end-to-end version of section 3 and the one that matters for the migration.
  for (const field of ['basePrompt', 'contextTemplate', 'audienceTemplate', 'categoryTemplate', 'outputSections']) {
    check(`${field} survives the FULL round trip`, () =>
      assert.deepStrictEqual(genBody[field], GENERATION_BODY[field]));
  }

  /*
    REJECTS: writing a generation prompt's shape fields to S3 but not to the
    DynamoDB row. The console's list reads promptType and the usability chip off
    the ROW without fetching the body, so a row missing these reads as broken
    even though the body is fine.
  */
  check('the shape fields are on the row too, where the console reads them', () => {
    assert.strictEqual(genRow.basePrompt, GENERATION_BODY.basePrompt);
    assert.deepStrictEqual(genRow.outputSections, GENERATION_BODY.outputSections);
    assert.strictEqual(genRow.promptType, 'generation');
  });

  check('a generation prompt keeps the trivia game type', () =>
    assert.strictEqual(genRow.gameType, 'trivia'));

  // =========================================================================
  say('\n7. AN OLD ARCHIVE ENTRY — aliases only, which is what is in there now');

  /*
    Every prompt written to the archive before this change carries the analysis
    text ONLY as systemPrompt/userPrompt (when it carries anything at all). The
    import must still find it, or re-exporting is the only recovery path for
    entries somebody has already pulled.
  */
  reset();
  archive.set('arc-legacy', {
    item: { ArchiveId: 'arc-legacy', Title: 'Old Prompt (dev)', Description: 'legacy', Tags: ['dev', 'trivia'] },
    content: JSON.stringify({
      metadata: { promptId: 'old1', name: 'Old Prompt', gameType: 'trivia', category: 'general' },
      prompt: { systemPrompt: 'Say something useful about {responsesText}.', userPrompt: '## Summary', variables: {} },
    }),
  });
  res = await importPrompt('arc-legacy');
  await checkAsync('a legacy archive entry imports', async () =>
    assert.strictEqual(parse(res).results.successful.length, 1, JSON.stringify(parse(res).results.failed)));

  const legacyBody = JSON.parse(s3.get(`${PROMPTS_BUCKET}/${importedRow().s3Key}`));
  // REJECTS: dropping the aliases on the import side once the spread was added —
  // which would turn every archive entry written before today into an empty
  // prompt, silently.
  check('...and its text is promoted into the structured fields', () => {
    assert.strictEqual(legacyBody.instructions, 'Say something useful about {responsesText}.');
    assert.strictEqual(legacyBody.outputFormat, '## Summary');
  });

  say(`\n${pass} passed, ${fail} failed`);
  global.fetch = realFetch;
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('harness error:', e); process.exit(2); });
