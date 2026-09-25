/**
 * The Workie default must be found wherever DynamoDB puts it.
 *
 * Seen on dev 2026-09-25 (session 3255): every "What We Heard" summary, every
 * game type, came back as the data-driven template. `findDefaultPromptId` ran
 * ONE table Scan with `FilterExpression: PK = :pk AND isDefault = :isDefault`.
 * A Scan reads 1 MB and filters afterwards, so it saw the first 1,987 of
 * 6,083 rows — none of them AIPROMPTS defaults — and logged "No default prompt
 * found for trivia, using hardcoded fallback: trivia-basic". No `trivia-basic`
 * row exists, so the template was unavailable and Bedrock never ran. Test (726
 * rows) and prod (587) still fit in one page, and would go the same way once
 * they grow.
 *
 * The fake here cuts each page BEFORE filtering (tests/helpers/paged-table.js),
 * and puts filler rows ahead of the prompts so the table's first page holds
 * none of them — dev's shape. The AIPROMPTS partition is itself three pages
 * long, so a lookup that reads one page of the partition fails too.
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const assert = require('assert');
const Module = require('module');
const { createPagedTable, commands } = require('./helpers/paged-table');

const REPO = path.join(__dirname, '..');

const stubs = new Map();
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (stubs.has(request)) return stubs.get(request);
  return realLoad.call(this, request, parent, isMain);
};
const stub = (name, exports) => stubs.set(name, exports);

const table = createPagedTable({ pageSize: 3 });

// Filler that sorts ahead of AIPROMPTS: the table Scan's first pages are all
// session rows, as dev's first page was.
for (let n = 0; n < 7; n++) {
  table.put({ PK: `A-SESSION#${n}`, SK: 'METADATA', GameType: 'trivia' });
}

const prompt = (id, fields) => ({
  PK: 'AIPROMPTS', SK: `AIPROMPT#${id}`, promptId: id, name: id,
  s3Key: `prompts/${id}/v1.json`, isDefault: false, ...fields,
});

// AIPROMPTS in SK order, three rows per page:
//   page 1  aa-cna-plain · ab-poll-plain · ac-trivia-old (a default, wrong category)
//   page 2  ad-plain · ae-plain · af-plain
//   page 3  zx-plain · zy-cna-default · zz-trivia-default (the preferred one)
//   page 4  PERSONA#house
const ROWS = [
  prompt('aa-cna-plain', { gameType: 'call-and-answer', category: 'lessons-learned' }),
  prompt('ab-poll-plain', { gameType: 'poll', category: 'general' }),
  prompt('ac-trivia-old', {
    gameType: 'trivia', category: 'other', isDefault: true, createdAt: '2025-01-01T00:00:00Z',
  }),
  prompt('ad-plain', { gameType: 'trivia', category: 'general' }),
  prompt('ae-plain', { gameType: 'trivia', category: 'general' }),
  prompt('af-plain', { gameType: 'survey', category: 'general' }),
  prompt('zx-plain', { gameType: 'poll', category: 'general' }),
  prompt('zy-cna-default', {
    gameType: 'callandanswer', category: 'lessons-learned', isDefault: true, createdAt: '2025-06-01T00:00:00Z',
  }),
  prompt('zz-trivia-default', {
    gameType: 'trivia', category: 'general', isDefault: true, createdAt: '2025-06-01T00:00:00Z',
  }),
  { PK: 'AIPROMPTS', SK: 'PERSONA#house', personaId: 'house', isDefault: true },
];
ROWS.forEach((row) => table.put(row));

stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => table },
  ...commands,
});

const s3Bodies = {
  'prompts/zz-trivia-default/v1.json': {
    name: 'Trivia house default', instructions: 'Summarise the round.', outputFormat: '## Summary',
  },
};
stub('@aws-sdk/client-s3', {
  S3Client: class {
    async send(cmd) {
      const body = s3Bodies[cmd.input.Key];
      if (!body) { const e = new Error('NoSuchKey'); e.name = 'NoSuchKey'; throw e; }
      return { Body: { transformToString: async () => JSON.stringify(body) } };
    }
  },
  GetObjectCommand: class { constructor(i) { this.input = i; } },
  PutObjectCommand: class { constructor(i) { this.input = i; } },
});
stub('@aws-sdk/client-bedrock-runtime', {
  BedrockRuntimeClient: class { async send() { throw new Error('bedrock not stubbed'); } },
  InvokeModelCommand: class { constructor(i) { this.input = i; } },
});
stub('@aws-sdk/client-lambda', {
  LambdaClient: class { async send() { return {}; } },
  InvokeCommand: class { constructor(i) { this.input = i; } },
});
stub('@aws-sdk/client-apigatewaymanagementapi', {
  ApiGatewayManagementApiClient: class { async send() { return {}; } },
  PostToConnectionCommand: class { constructor(i) { this.input = i; } },
});

process.env.TABLE_NAME = 'test-table';
process.env.AI_PROMPTS_BUCKET = 'test-bucket';

const mod = require(path.join(REPO, 'lambda-functions', 'game', 'get-ai-summary.js'));

let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

// Run one lookup and return what it resolved plus the reads it made.
async function lookup(gameType) {
  const from = table.log.length;
  const warnings = [];
  const realWarn = console.warn;
  console.warn = (...args) => { warnings.push(args.join(' ')); };
  try {
    const id = await mod.findDefaultPromptId(gameType);
    return { id, reads: table.log.slice(from), warnings };
  } finally {
    console.warn = realWarn;
  }
}

(async () => {
  console.log('findDefaultPromptId: the default is found on any page, and only a genuine miss falls back\n');

  const trivia = await lookup('trivia');

  await check('a trivia default that sits past the first page is found', () =>
    assert.strictEqual(trivia.id, 'zz-trivia-default',
      `got ${trivia.id} — "trivia-basic" is the dev symptom: the lookup read one page and gave up`));

  await check('candidates from every page are ranked together (the page-1 default does not win by position)', () =>
    assert.notStrictEqual(trivia.id, 'ac-trivia-old'));

  await check('the multi-default warning still names both trivia defaults, found on different pages', () => {
    const line = trivia.warnings.find((w) => /claim isDefault for trivia/.test(w));
    assert(line, `no multi-default warning; warnings: ${JSON.stringify(trivia.warnings)}`);
    assert(/\b2 prompts\b/.test(line) && /ac-trivia-old/.test(line) && /zz-trivia-default/.test(line), line);
  });

  await check('the lookup reads the AIPROMPTS partition, never the whole table', () => {
    assert.strictEqual(trivia.reads.filter((r) => r.kind === 'scan').length, 0,
      'a table Scan reads every session row on the platform to find ~a dozen prompts');
    const queries = trivia.reads.filter((r) => r.kind === 'query');
    assert(queries.length > 0, 'no Query was issued');
    queries.forEach((q) => assert.strictEqual(q.input.ExpressionAttributeValues[':pk'], 'AIPROMPTS'));
  });

  await check('it follows LastEvaluatedKey to the end of the partition', () => {
    const queries = trivia.reads.filter((r) => r.kind === 'query');
    assert(queries.length >= 2, `read ${queries.length} page(s)`);
    assert.strictEqual(queries[queries.length - 1].more, false, 'stopped with pages still unread');
    queries.slice(1).forEach((q) => assert(q.input.ExclusiveStartKey, 'a later page was read without a start key'));
  });

  const cna = await lookup('call-and-answer');
  await check('a call-and-answer default past the first page is found (legacy "callandanswer" spelling)', () =>
    assert.strictEqual(cna.id, 'zy-cna-default', `got ${cna.id}`));

  const wavelength = await lookup('wavelength');
  await check('with no default on ANY page, the hardcoded fallback still applies', () =>
    assert.strictEqual(wavelength.id, 'lessons-learned', `got ${wavelength.id}`));

  await check('...and only after every page has been read', () => {
    const reads = wavelength.reads.filter((r) => r.kind === 'query' || r.kind === 'scan');
    assert(reads.length > 0, 'nothing was read');
    assert.strictEqual(reads[reads.length - 1].more, false,
      'fell back while LastEvaluatedKey still said there was more');
  });

  // Take every trivia default away: trivia's own fallback id comes back.
  const saved = ['ac-trivia-old', 'zz-trivia-default'].map((id) => table.get('AIPROMPTS', `AIPROMPT#${id}`));
  saved.forEach((row) => table.put({ ...row, isDefault: false }));
  const noTrivia = await lookup('trivia');
  await check('trivia with no default anywhere falls back to "trivia-basic"', () =>
    assert.strictEqual(noTrivia.id, 'trivia-basic', `got ${noTrivia.id}`));
  saved.forEach((row) => table.put(row));

  // End to end: the default is not just named, its template is loaded.
  const resolved = await mod.resolvePromptTemplate(undefined, 'trivia');
  await check('resolvePromptTemplate hands back the page-3 default\'s template, so Bedrock runs', () => {
    assert(resolved && resolved.promptData, 'no template — the caller would emit buildFallbackSummary');
    assert.strictEqual(resolved.promptId, 'zz-trivia-default');
    assert.strictEqual(resolved.promptData.name, 'Trivia house default');
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('harness error:', e); process.exit(1); });
