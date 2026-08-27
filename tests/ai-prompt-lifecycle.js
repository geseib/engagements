/**
 * Regression tests for the AI-prompt admin lifecycle.
 *
 * Runs the REAL create/get/delete handlers against a stubbed AWS SDK, covering
 * the five bugs that made prompts unmanageable:
 *
 *   1. Every prompt writer stamped `ttl = now + 365d` on a table with TTL
 *      enabled, so prompts authored in Aug 2025 were being deleted by DynamoDB
 *      in Aug 2026. Prompts are configuration and must never expire.
 *   2. Two game-type vocabularies (`callandanswer`/`polls` vs
 *      `call-and-answer`/`poll`) meant no poll prompt ever matched a filter.
 *   3. `promptType` was written wrong (defaulted to 'generation' for
 *      hand-written analysis prompts) and ignored on read.
 *   4. A generation-format prompt silently failed the summary gate and fell
 *      back to the default — "I added an Art prompt and nothing changed".
 *   5. delete-ai-prompt.js read a key nothing else writes, so deleting any
 *      normally-created prompt threw "not found".
 *
 * Stubbing note (same as tests/ai-prompt-resolution.js): poisoning
 * require.cache by resolved path silently misses, because several SDK packages
 * these handlers import exist only in the deployed bundle and cannot be
 * resolved locally at all. Intercept Module._load by request name instead.
 */
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');

const Module = require('module');
const stubs = new Map();
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (stubs.has(request)) return stubs.get(request);
  return realLoad.call(this, request, parent, isMain);
};
function stub(name, exports) { stubs.set(name, exports); }

// ---- in-memory table -------------------------------------------------------
const store = new Map();
const key = (pk, sk) => `${pk}|${sk}`;

class GetCommand { constructor(i) { this.input = i; this.type = 'get'; } }
class PutCommand { constructor(i) { this.input = i; this.type = 'put'; } }
class QueryCommand { constructor(i) { this.input = i; this.type = 'query'; } }
class UpdateCommand { constructor(i) { this.input = i; this.type = 'update'; } }
class DeleteCommand { constructor(i) { this.input = i; this.type = 'delete'; } }
class ScanCommand { constructor(i) { this.input = i; this.type = 'scan'; } }

const fakeDoc = {
  send: async (cmd) => {
    const inp = cmd.input || {};
    switch (cmd.type) {
      case 'put':
        store.set(key(inp.Item.PK, inp.Item.SK), inp.Item);
        return {};
      case 'get':
        return { Item: store.get(key(inp.Key.PK, inp.Key.SK)) };
      case 'delete':
        store.delete(key(inp.Key.PK, inp.Key.SK));
        return {};
      case 'update': {
        // Minimal UpdateExpression interpreter: `SET a = :x, #b = :y [REMOVE #z]`.
        // Enough for both the isDefault clear and the archive (status) path —
        // matching only one of them is how a broken archive looked green.
        const item = store.get(key(inp.Key.PK, inp.Key.SK));
        if (!item) return {};
        const expr = inp.UpdateExpression || '';
        const names = inp.ExpressionAttributeNames || {};
        const values = inp.ExpressionAttributeValues || {};
        const resolve = (t) => (t.startsWith('#') ? names[t] : t);

        const setPart = (expr.match(/SET\s+(.*?)(?=\s+REMOVE\b|$)/i) || [])[1];
        if (setPart) {
          for (const clause of setPart.split(',')) {
            const [lhs, rhs] = clause.split('=').map((s) => s.trim());
            if (lhs && rhs && rhs in values) item[resolve(lhs)] = values[rhs];
          }
        }
        const removePart = (expr.match(/REMOVE\s+(.*)$/i) || [])[1];
        if (removePart) {
          for (const t of removePart.split(',')) delete item[resolve(t.trim())];
        }
        return {};
      }
      case 'query': {
        const v = inp.ExpressionAttributeValues || {};
        let items = [...store.values()].filter(
          (i) => i.PK === v[':pk'] && String(i.SK).startsWith(String(v[':sk'] ?? ''))
        );
        // Only `category` / `status` are ever pushed into a FilterExpression now.
        if (/category = :category/.test(inp.FilterExpression || '')) {
          items = items.filter((i) => i.category === v[':category']);
        }
        if (/#status = :status/.test(inp.FilterExpression || '')) {
          items = items.filter((i) => i.status === v[':status']);
        }
        return { Items: items, Count: items.length };
      }
      default:
        return { Items: [], Count: 0 };
    }
  },
};

stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => fakeDoc },
  GetCommand, PutCommand, QueryCommand, UpdateCommand, DeleteCommand, ScanCommand,
});

// ---- in-memory S3 ----------------------------------------------------------
const s3Store = new Map();
stub('@aws-sdk/client-s3', {
  S3Client: class {
    async send(cmd) {
      if (cmd.type === 'put') { s3Store.set(cmd.input.Key, cmd.input.Body); return {}; }
      if (cmd.type === 'delete') { s3Store.delete(cmd.input.Key); return {}; }
      if (cmd.type === 'list') return { Contents: [] };
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
  DeleteObjectsCommand: class { constructor(i) { this.input = i; this.type = 'deleteMany'; } },
  ListObjectsV2Command: class { constructor(i) { this.input = i; this.type = 'list'; } },
});
stub('@aws-sdk/client-bedrock-runtime', {
  BedrockRuntimeClient: class { async send() { throw new Error('bedrock not stubbed'); } },
  InvokeModelCommand: class { constructor(i) { this.input = i; } },
});

process.env.TABLE_NAME = 'test-table';
process.env.AI_PROMPTS_BUCKET = 'test-bucket';

const admin = (f) => require(path.join(REPO, 'lambda-functions', 'admin', f));
const createPrompt = admin('create-ai-prompt.js');
const getPrompts = admin('get-ai-prompts.js');
const deletePrompt = admin('delete-ai-prompt.js');
const { isUsableSummaryPrompt, inferPromptType } = admin('shared/prompt-shape.js');
const { normalizeGameType } = admin('shared/game-types.js');

let pass = 0, fail = 0;
function check(label, fn) {
  try {
    const r = fn();
    // A promise here would resolve after the report is printed and a rejection
    // would surface as an unhandled rejection, not a failure. Use acheck.
    assert(!(r && typeof r.then === 'function'),
      'check() takes a synchronous assertion — use acheck() for async');
    console.log(`  PASS  ${label}`); pass++;
  } catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}
async function acheck(label, fn) {
  try { await fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const post = (body) => createPrompt.handler({ body: JSON.stringify(body) });
const list = (qs) => getPrompts.handler({ queryStringParameters: qs || {} })
  .then((r) => JSON.parse(r.body));

(async () => {
  console.log('AI prompt lifecycle: ttl, vocabulary, promptType, usability, delete\n');

  // === 1. No writer stamps ttl on a prompt =================================
  const created = JSON.parse((await post({
    name: 'Analysis One',
    description: 'a summary prompt',
    gameType: 'callandanswer',          // legacy spelling on the way in
    promptType: 'analysis',
    category: 'lessons-learned',
    instructions: 'Summarise the responses.',
    outputFormat: '## Summary\n{responsesText}',
    isDefault: true,
  })).body);

  const analysisRow = store.get(key('AIPROMPTS', `AIPROMPT#${created.promptId}`));

  check('create-ai-prompt writes no ttl', () =>
    assert.strictEqual(analysisRow.ttl, undefined,
      'a prompt with a ttl will be silently deleted by DynamoDB'));

  check('the isDefault lookup row writes no ttl either', () => {
    const lookups = [...store.values()].filter((i) => String(i.SK).startsWith('GAMETYPE#'));
    assert(lookups.length > 0, 'expected a GAMETYPE# default-lookup row');
    lookups.forEach((l) => assert.strictEqual(l.ttl, undefined));
  });

  check('no row anywhere in the AIPROMPTS partition carries a ttl', () =>
    [...store.values()]
      .filter((i) => i.PK === 'AIPROMPTS')
      .forEach((i) => assert.strictEqual(i.ttl, undefined, `${i.SK} carries a ttl`)));

  // === 2. One vocabulary ==================================================
  check('a legacy gameType is stored canonical', () =>
    assert.strictEqual(analysisRow.gameType, 'call-and-answer',
      'the write path must canonicalise; storing callandanswer re-splits the vocabulary'));

  const genCreated = JSON.parse((await post({
    name: 'Poll Generator',
    gameType: 'poll',                    // dashed/short spelling
    promptType: 'generation',
    basePrompt: 'Generate poll questions about {context}.',
    outputFormat: 'JSON array',
  })).body);

  const pollLegacy = JSON.parse((await post({
    name: 'Poll Analysis',
    gameType: 'polls',                   // legacy plural — the spelling that never matched
    promptType: 'analysis',
    category: 'opinion',
    // {uniqueAnswers} keeps the fixture clean under the receives-responses
    // guard (tests/prompt-save-guards.js) — the spelling is what is under test.
    instructions: 'Analyse the poll: {uniqueAnswers}.',
    outputFormat: '## Summary',
  })).body);

  const byDashed = await list({ gameType: 'poll' });
  const byPlural = await list({ gameType: 'polls' });

  check('both poll spellings return the same prompts', () =>
    assert.deepStrictEqual(
      byDashed.prompts.map((p) => p.promptId).sort(),
      byPlural.prompts.map((p) => p.promptId).sort()));

  check('a "polls"-authored prompt is found by a "poll" filter', () =>
    assert(byDashed.prompts.some((p) => p.promptId === pollLegacy.promptId),
      'this is the bug that meant NO poll prompt ever appeared in the dropdown'));

  const caDashed = await list({ gameType: 'call-and-answer' });
  const caLegacy = await list({ gameType: 'callandanswer' });
  check('call-and-answer and callandanswer return the same set', () =>
    assert.deepStrictEqual(
      caDashed.prompts.map((p) => p.promptId).sort(),
      caLegacy.prompts.map((p) => p.promptId).sort()));

  check('the response reports gameType canonically', () =>
    caDashed.prompts.forEach((p) =>
      assert.strictEqual(p.gameType, normalizeGameType(p.gameType))));

  await acheck('an unknown gameType is rejected, not silently coerced', async () => {
    const res = await post({ name: 'x', gameType: 'banana', template: 't' });
    assert.strictEqual(res.statusCode, 500);
    assert(/Invalid gameType/.test(res.body), res.body);
  });

  // === 3. promptType is written right and honoured on read =================
  check('an explicitly analysis prompt is stored as analysis', () =>
    assert.strictEqual(analysisRow.promptType, 'analysis',
      'AIPromptManager prompts used to be persisted as "generation"'));

  const inferred = JSON.parse((await post({
    name: 'No promptType Sent',
    gameType: 'trivia',
    // promptType deliberately omitted — the old code defaulted to 'generation'
    instructions: 'Analyse the trivia round.',
    outputFormat: '## Summary',
  })).body);
  check('an omitted promptType is inferred from shape, not defaulted to generation', () =>
    assert.strictEqual(
      store.get(key('AIPROMPTS', `AIPROMPT#${inferred.promptId}`)).promptType,
      'analysis'));

  const generationOnly = await list({ promptType: 'generation' });
  const analysisOnly = await list({ promptType: 'analysis' });

  check('promptType=generation actually filters', () =>
    assert.deepStrictEqual(generationOnly.prompts.map((p) => p.promptId), [genCreated.promptId]));

  check('promptType=analysis excludes generation prompts', () =>
    assert(!analysisOnly.prompts.some((p) => p.promptId === genCreated.promptId)));

  await acheck('the two promptType lists partition the inventory', async () => {
    const all = await list({});
    assert.strictEqual(analysisOnly.totalCount + generationOnly.totalCount, all.totalCount,
      'every prompt must be exactly one of analysis or generation');
  });

  await acheck('promptType is respected alongside gameType', async () => {
    const both = await list({ gameType: 'poll', promptType: 'analysis' });
    assert.deepStrictEqual(both.prompts.map((p) => p.promptId), [pollLegacy.promptId]);
  });

  // === 4. Unusable prompts are visible, not silent ========================
  check('a generation-format prompt fails the summary gate', () =>
    assert.strictEqual(isUsableSummaryPrompt({
      basePrompt: 'Generate...', contextTemplate: '...', outputFormat: 'JSON',
    }), false, 'basePrompt alone can never drive a summary'));

  check('an instructions + outputFormat prompt passes the gate', () =>
    assert.strictEqual(isUsableSummaryPrompt({
      instructions: 'Summarise.', outputFormat: '## Summary',
    }), true));

  check('a legacy template prompt passes the gate', () =>
    assert.strictEqual(isUsableSummaryPrompt({ template: 'You are...' }), true));

  check('instructions without outputFormat does NOT pass', () =>
    assert.strictEqual(isUsableSummaryPrompt({ instructions: 'Summarise.' }), false));

  check('inferPromptType reads the shape, not the (possibly wrong) label', () => {
    assert.strictEqual(inferPromptType({ promptType: 'generation', instructions: 'x', outputFormat: 'y' }), 'analysis');
    assert.strictEqual(inferPromptType({ basePrompt: 'x' }), 'generation');
  });

  check('the API flags a generation prompt as unusable for summaries', () => {
    const g = generationOnly.prompts.find((p) => p.promptId === genCreated.promptId);
    assert.strictEqual(g.summaryPromptStatus, 'unusable');
    assert(/generation-format/.test(g.summaryPromptDefect || ''), g.summaryPromptDefect);
  });

  // === 5. Delete works on the canonical key AND the legacy key =============
  /**
   * An ADMIN caller, in this API's real event shape.
   *
   * `DELETE /admin/ai-prompts/{promptId}` is admins-only at the authorizer
   * and, since the tenancy fix, ownership-checked again inside the handler
   * (`canManagePrompt`, shared/prompt-access.js) — platform passes on the
   * scope alone, which needs the `admins` group and no active org. Every row
   * in this file is platform (created above with no caller at all, which
   * create-ai-prompt.js's internal-invocation seam also routes to platform),
   * so every caller here is that administrator, acting for nobody.
   */
  const ADMIN = {
    requestContext: { authorizer: { lambda: {
      userId: 'sub-admin', username: 'admin', groups: 'admins', status: 'enabled',
    } } },
  };
  const del = (id, qs) => deletePrompt.handler({
    ...ADMIN,
    pathParameters: { promptId: id },
    queryStringParameters: qs || {},
  });

  const disposable = JSON.parse((await post({
    name: 'Disposable',
    gameType: 'trivia',
    promptType: 'analysis',
    // {triviaResponses}: clean under the receives-responses guard.
    instructions: 'Judge {triviaResponses}.', outputFormat: 'y',
  })).body);

  const softRes = await del(disposable.promptId);
  check('archiving a normally-created prompt succeeds', () =>
    assert.strictEqual(softRes.statusCode, 200, softRes.body));
  check('the archive lands on the canonical row', () =>
    assert.strictEqual(
      store.get(key('AIPROMPTS', `AIPROMPT#${disposable.promptId}`)).status, 'archived'));

  const hardRes = await del(disposable.promptId, { hardDelete: 'true' });
  check('hard delete removes the canonical row', () => {
    assert.strictEqual(hardRes.statusCode, 200, hardRes.body);
    assert.strictEqual(store.get(key('AIPROMPTS', `AIPROMPT#${disposable.promptId}`)), undefined);
  });

  // A row that genuinely only exists under the old key must still be deletable.
  store.set(key('AI_PROMPT#legacy-1', 'METADATA'), {
    PK: 'AI_PROMPT#legacy-1', SK: 'METADATA',
    promptId: 'legacy-1', name: 'Legacy Row', gameType: 'callandanswer', isDefault: false,
  });
  const legacyRes = await del('legacy-1', { hardDelete: 'true' });
  check('a row stored under the legacy key is still deletable', () => {
    assert.strictEqual(legacyRes.statusCode, 200, legacyRes.body);
    assert.strictEqual(store.get(key('AI_PROMPT#legacy-1', 'METADATA')), undefined);
  });

  const missingRes = await del('does-not-exist', { hardDelete: 'true' });
  check('a genuinely missing prompt still 404s', () =>
    assert.strictEqual(missingRes.statusCode, 404, missingRes.body));

  // === 6. isDefault is unique per game type ===============================
  const secondDefault = JSON.parse((await post({
    name: 'Analysis Two',
    gameType: 'call-and-answer',
    promptType: 'analysis',
    category: 'team-building',          // DIFFERENT category — used to dodge the clear
    instructions: 'Summarise {responsesText}.', outputFormat: '## Summary',
    isDefault: true,
  })).body);

  check('a new default clears the old one across categories', () => {
    const defaults = [...store.values()].filter((i) =>
      i.PK === 'AIPROMPTS' && String(i.SK).startsWith('AIPROMPT#') &&
      i.isDefault && normalizeGameType(i.gameType) === 'call-and-answer');
    assert.strictEqual(defaults.length, 1,
      `expected exactly one call-and-answer default, got ${defaults.length}: ` +
      defaults.map((d) => `${d.promptId}/${d.category}`).join(', '));
    assert.strictEqual(defaults[0].promptId, secondDefault.promptId);
  });

  // === 7. A promptId-less row never reaches the UI as undefined ===========
  store.set(key('AIPROMPTS', 'AIPROMPT#GENERATION#lessons-learned#call-and-answer'), {
    PK: 'AIPROMPTS', SK: 'AIPROMPT#GENERATION#lessons-learned#call-and-answer',
    name: 'Lessons Learned Scenarios', gameType: 'call-and-answer',
    promptType: 'generation', basePrompt: 'Generate...', status: 'active',
    // no promptId — exactly what populate-generation-prompts.js used to write
  });
  const withOrphan = await list({});
  const orphan = withOrphan.prompts.find((p) => p.name === 'Lessons Learned Scenarios');
  check('a promptId-less row gets a synthesized id, never undefined', () => {
    assert(orphan, 'the orphan row should still be listed so admin can see it');
    assert.strictEqual(typeof orphan.promptId, 'string');
    assert(orphan.promptId.length > 0,
      'undefined here becomes the <option> label text and writes garbage into a set');
  });
  check('the orphan row is flagged malformed for the cull script', () =>
    assert.strictEqual(orphan.malformed, true));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('harness error:', e); process.exit(1); });
