/**
 * A PROMPT MUST SURVIVE A ROUND TRIP THROUGH THE ARCHIVE.
 *
 * On 2026-08-15 every prompt in the archive was hollow (instructions, outputFormat, template
 * and scenario all ''), nine of them reported as successful exports. Three faults produced
 * that. The export function could not read a body at all (no AI_PROMPTS_BUCKET, no S3
 * policy). It copied five hand-picked ANALYSIS fields, so a GENERATION prompt's basePrompt,
 * contextTemplate, audienceTemplate, categoryTemplate and outputSections were dropped. And the
 * import wrote no body, a status outside the vocabulary, a game-type alias and no promptType.
 *
 * SINCE 2026-09-15 THE ARCHIVE HOLDS A SNAPSHOT. The row and its S3 body travel verbatim in an
 * `engage.prompt/1` envelope (docs/superpowers/specs/2026-09-14-archive-full-fidelity-design.md
 * §4.1), and a restore puts both back under the ORIGINAL id with the status it had. It never
 * makes a prompt a default and never takes default status away (A9). Items written before
 * that, `{metadata, prompt}` JSON, still import through the legacy path as a draft copy under
 * a new id. Sections 5b and 7 keep that path honest.
 *
 * Drives the REAL handlers against tests/helpers/archive-harness.js.
 */
const h = require('./helpers/archive-harness');
const assert = require('assert');
const path = require('path');

const REPO = path.join(__dirname, '..');
const { promptKey } = require(path.join(REPO, 'lambda-functions/admin/shared/prompt-access.js'));
const link = require(path.join(REPO, 'lambda-functions/admin/shared/archive-prompt-link.js'));
const exportHandler = require(path.join(REPO, 'lambda-functions/admin/export-to-archive.js')).handler;
const importHandler = require(path.join(REPO, 'lambda-functions/admin/import-from-archive.js')).handler;

const { check, finish } = h.checker();
const PROMPTS_BUCKET = process.env.AI_PROMPTS_BUCKET;
const PROMPTS_PK = promptKey({ scope: 'platform', promptId: 'x' }).PK;

/** The ANALYSIS shape: what the summary engine can actually run. */
const ANALYSIS_BODY = {
  id: 'p-analysis', version: 2, name: 'Workie — The Transfer Reader',
  gameType: 'call-and-answer', promptType: 'analysis', category: 'lessons-learned',
  instructions: 'Read {responsesText} as foreign material nobody here owns.',
  outputFormat: '## Where it lands\n## What resists',
  variables: { responsesText: 'the answers' },
  isDefault: false, status: 'active', questionSetIds: ['qs-1'], tags: ['demo'],
};

/** The GENERATION shape: five fields, none of which the old export copied. */
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
const SHAPE_FIELDS = ['basePrompt', 'contextTemplate', 'audienceTemplate', 'categoryTemplate', 'outputFormat', 'outputSections', 'defaultSettings'];

/** A row shaped the way create-ai-prompt.js writes one: the shape fields mirrored onto the row. */
function seed(promptId, body) {
  const mirrored = Object.fromEntries(SHAPE_FIELDS.filter((f) => body[f] !== undefined).map((f) => [f, body[f]]));
  h.seedPrompt({
    promptId,
    body,
    row: {
      name: body.name, description: 'seeded', gameType: body.gameType, promptType: body.promptType, category: body.category,
      status: body.status, isDefault: body.isDefault, version: body.version, questionSetIds: body.questionSetIds,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z', ...mirrored,
    },
  });
}
const exportPrompt = async (id) => JSON.parse((await exportHandler(h.adminEvent({ selectedItems: [id], exportType: 'prompts' }))).body).results;
const importItem = async (archiveId) => JSON.parse((await importHandler(h.adminEvent({ selectedItems: [archiveId] }))).body);
const envelopeOf = (archiveId) => JSON.parse(h.archive.get(archiveId).content);
const rowOf = (promptId) => h.get(PROMPTS_PK, `AIPROMPT#${promptId}`);
const bodyAt = (s3Key) => JSON.parse(h.objects.get(`${PROMPTS_BUCKET}/${s3Key}`).Body);
const importedRow = () => h.rows(PROMPTS_PK).find((row) => String(row.promptId).startsWith('imported-'));
const legacyItem = (title, content) => h.seedArchiveItem({ contentType: 'prompt', title, description: 'x', tags: ['dev'], content: JSON.stringify(content) });

(async () => {
  console.log('\n1. THE MISCONFIGURATION — no bucket means no body, and it must SAY so');
  h.reset();
  seed('p1', ANALYSIS_BODY);
  delete process.env.AI_PROMPTS_BUCKET;
  let out = await exportPrompt('p1');
  process.env.AI_PROMPTS_BUCKET = PROMPTS_BUCKET;
  // rejects: archiving a metadata-only shell with a 200, which is how nine hollow prompts arrived.
  await check('an unconfigured bucket fails the export instead of archiving a shell', () => assert.strictEqual(out.successful.length, 0));
  await check('...and nothing was uploaded to the archive at all', () => assert.strictEqual(h.archive.size, 0));
  await check('...and the failure names the deployment fault, not the prompt', () => {
    assert.match(out.failed[0].error, /AI_PROMPTS_BUCKET is not set/);
    assert.strictEqual(out.failed[0].step, 'config');
  });

  console.log('\n2. THE ANALYSIS SHAPE — row and body travel verbatim');
  h.reset();
  seed('p1', ANALYSIS_BODY);
  out = await exportPrompt('p1');
  await check('the export succeeds', () => assert.strictEqual(out.successful.length, 1, JSON.stringify(out.failed)));
  let env = envelopeOf(out.successful[0].archiveId);
  await check('instructions and outputFormat are present and NOT empty', () => {
    assert.strictEqual(env.body.instructions, ANALYSIS_BODY.instructions);
    assert.strictEqual(env.body.outputFormat, ANALYSIS_BODY.outputFormat);
  });
  // rejects: an allow-list, or aliases added to the body, in either direction.
  await check('the body is exactly the stored body — nothing added, nothing dropped', () => assert.deepStrictEqual(env.body, ANALYSIS_BODY));
  await check('the row travels too, with its status and shape', () => {
    assert.deepStrictEqual([env.metadata.status, env.metadata.promptType], ['active', 'analysis']);
  });

  console.log('\n3. THE GENERATION SHAPE — the fields the old export dropped');
  h.reset();
  seed('gen1', GENERATION_BODY);
  out = await exportPrompt('gen1');
  env = envelopeOf(out.successful[0].archiveId);
  for (const field of SHAPE_FIELDS) {
    // eslint-disable-next-line no-await-in-loop
    await check(`${field} survives the export`, () => assert.deepStrictEqual(env.body[field], GENERATION_BODY[field]));
  }
  await check('the archive records which SHAPE this prompt is', () => assert.strictEqual(env.metadata.promptType, 'generation'));

  console.log('\n3b. A GENERATION PROMPT WHOSE TEXT LIVES ON ITS ROW');
  h.reset();
  h.seedPrompt({ promptId: 'gen-trivia', row: { name: 'Custom Trivia Topics', gameType: 'trivia', promptType: 'generation', basePrompt: 'Generate {count} questions' } });
  out = await exportPrompt('gen-trivia');
  await check('it is archived with no body, because the row IS the prompt', () => {
    assert.strictEqual(out.successful.length, 1, JSON.stringify(out.failed));
    const rowOnly = envelopeOf(out.successful[0].archiveId);
    assert.strictEqual(rowOnly.body, null);
    assert.strictEqual(rowOnly.metadata.basePrompt, 'Generate {count} questions');
  });

  console.log('\n4. THE ROUND TRIP — the same prompt, under the same id');
  h.reset();
  seed('p1', { ...ANALYSIS_BODY, isDefault: true });
  out = await exportPrompt('p1');
  h.table.clear();
  let back = await importItem(out.successful[0].archiveId);
  const row = rowOf('p1');
  await check('it restores under its original id', () => {
    assert.deepStrictEqual(back.results.failed, []);
    assert.ok(row, 'no row under p1');
    assert.strictEqual(back.results.successful[0].mode, 'created');
  });
  await check('the row points at a body that exists', () => assert.ok(row.s3Key && h.objects.get(`${PROMPTS_BUCKET}/${row.s3Key}`)));
  const written = bodyAt(row.s3Key);
  await check('...and the text made it all the way through', () => {
    assert.strictEqual(written.instructions, ANALYSIS_BODY.instructions);
    assert.deepStrictEqual(written.variables, ANALYSIS_BODY.variables);
  });
  await check('no legacy aliases were invented', () => {
    assert.strictEqual(written.systemPrompt, undefined);
    assert.strictEqual(written.userPrompt, undefined);
  });

  console.log('\n5. WHAT A RESTORE KEEPS, AND WHAT IT NEVER DOES');
  await check('the status it had is kept', () => assert.strictEqual(row.status, 'active'));
  // rejects: a recreated prompt becoming a default. A default runs in every room of its type.
  await check('a recreated prompt is not a default, even when the backup was one', () => assert.strictEqual(row.isDefault, false));
  await check('its question-set links are kept, because set ids survive a restore', () => assert.deepStrictEqual(row.questionSetIds, ANALYSIS_BODY.questionSetIds));
  await check('no ttl is stamped on a prompt', () => assert.strictEqual(row.ttl, undefined));
  await check('the game type is canonical', () => assert.strictEqual(row.gameType, 'call-and-answer'));
  h.reset();
  seed('p1', { ...ANALYSIS_BODY, isDefault: true });
  out = await exportPrompt('p1');
  back = await importItem(out.successful[0].archiveId);
  // rejects: a restore silently un-defaulting the live default, which changes every room of that type.
  await check('restoring over the live default makes a new version and leaves it the default', () => {
    assert.strictEqual(back.results.successful[0].mode, 'new-version');
    assert.deepStrictEqual([rowOf('p1').isDefault, rowOf('p1').version], [true, 3]);
  });

  console.log('\n5b. LEGACY ITEMS — the game-type aliases, and no suffix');
  const ALIAS_CASES = [['callandanswer', 'call-and-answer'], ['call_and_answer', 'call-and-answer'], ['quiz', 'trivia'], ['polls', 'poll']];
  for (const [spelling, canonical] of ALIAS_CASES) {
    h.reset();
    const id = legacyItem('Aliased (dev)', { metadata: { promptId: 'a1', name: 'Aliased', gameType: spelling }, prompt: { instructions: 'text {responsesText}', outputFormat: '## Out' } });
    // eslint-disable-next-line no-await-in-loop
    await importItem(id);
    const aliasRow = importedRow();
    // eslint-disable-next-line no-await-in-loop
    await check(`gameType "${spelling}" is stored as "${canonical}", in the row and in its s3Key`, () => {
      assert.strictEqual(aliasRow.gameType, canonical);
      assert.ok(String(aliasRow.s3Key).startsWith(`prompts/${canonical}/`), aliasRow.s3Key);
    });
  }
  await check('a legacy prompt is a draft copy, never a default, with no suffix on its name', () => {
    const legacy = importedRow();
    assert.deepStrictEqual([legacy.status, legacy.isDefault, legacy.name], ['draft', false, 'Aliased']);
    assert.deepStrictEqual(legacy.questionSetIds, []);
  });
  h.reset();
  await importItem(legacyItem('Typeless (dev)', { metadata: { promptId: 'n1', name: 'Typeless' }, prompt: { instructions: 'text', outputFormat: '## Out' } }));
  await check('a legacy item with no game type falls back to a CANONICAL id', () => assert.strictEqual(importedRow().gameType, 'call-and-answer'));

  console.log('\n6. A GENERATION PROMPT SURVIVES THE FULL ROUND TRIP');
  h.reset();
  seed('gen1', GENERATION_BODY);
  out = await exportPrompt('gen1');
  h.table.clear();
  back = await importItem(out.successful[0].archiveId);
  await check('it restores', () => assert.deepStrictEqual(back.results.failed, []));
  const genRow = rowOf('gen1');
  const genBody = bodyAt(genRow.s3Key);
  for (const field of SHAPE_FIELDS) {
    // eslint-disable-next-line no-await-in-loop
    await check(`${field} survives the FULL round trip, in the body and on the row`, () => {
      assert.deepStrictEqual(genBody[field], GENERATION_BODY[field]);
      assert.deepStrictEqual(genRow[field], GENERATION_BODY[field]);
    });
  }
  await check('it keeps the trivia game type and its shape', () => assert.deepStrictEqual([genRow.gameType, genRow.promptType], ['trivia', 'generation']));

  console.log('\n7. AN OLD ARCHIVE ENTRY — aliases only, which is what the archive held before');
  h.reset();
  const oldId = legacyItem('Old Prompt (dev)', { metadata: { promptId: 'old1', name: 'Old Prompt', gameType: 'trivia', category: 'general' }, prompt: { systemPrompt: 'Say something useful about {responsesText}.', userPrompt: '## Summary', variables: {} } });
  back = await importItem(oldId);
  await check('a legacy archive entry imports', () => assert.strictEqual(back.results.successful.length, 1, JSON.stringify(back.results.failed)));
  await check('...and its text is promoted into the structured fields', () => {
    const legacyBody = bodyAt(importedRow().s3Key);
    assert.strictEqual(legacyBody.instructions, 'Say something useful about {responsesText}.');
    assert.strictEqual(legacyBody.outputFormat, '## Summary');
  });

  console.log('\n8. THE SET-TO-PROMPT LINK, BY NAME');
  // rejects: split(':')[1], which truncates the four demo prompts whose names contain a colon.
  await check('a prompt name containing a colon survives the tag round trip', () => {
    const name = 'Workie - Knowledge Organization: Make the Distinction Land';
    assert.strictEqual(link.promptNameFromTags([link.promptLinkTag(name)]), name);
  });
  await check('a set with no prompt gets no tag', () => {
    assert.strictEqual(link.promptLinkTag(''), null);
    assert.strictEqual(link.promptLinkTag(undefined), null);
    assert.strictEqual(link.promptNameFromTags(['dev', 'trivia', 'questions:12']), '');
  });
  await check('missing or malformed tags are not a crash', () => {
    assert.strictEqual(link.promptNameFromTags(undefined), '');
    assert.strictEqual(link.promptNameFromTags('prompt:x'), '');
    assert.strictEqual(link.promptNameFromTags([null, 7]), '');
  });
  // Prompts imported before 2026-09-15 carry " (Imported <date>)" in their names; a relink must still find them.
  await check('a suffix older imports added does not break the match', () => {
    const { promptId, matched } = link.resolveLocalPromptId('Workie - The Verdict Board', [{ promptId: 'local-1', name: 'Workie - The Verdict Board (Imported 2026-08-15)' }]);
    assert.deepStrictEqual([matched, promptId], [1, 'local-1']);
  });
  await check('case and whitespace do not decide the link', () => {
    assert.strictEqual(link.resolveLocalPromptId('Workie - The Verdict Board', [{ promptId: 'local-2', name: 'workie  -  the   verdict board' }]).promptId, 'local-2');
  });
  // rejects: guessing. An unlinked set falls back to the default; a wrongly linked one says another set's words.
  await check('no match links nothing, rather than guessing', () => {
    const { promptId, matched } = link.resolveLocalPromptId('Nobody Home', [{ promptId: 'a', name: 'Workie - The Verdict Board' }, { promptId: 'b', name: 'Trivia - Round Call' }]);
    assert.deepStrictEqual([promptId, matched], ['', 0]);
  });
  await check('an ambiguous match is reported as ambiguous', () => {
    const { promptId, matched } = link.resolveLocalPromptId('Twin', [{ promptId: 'first', name: 'Twin' }, { promptId: 'second', name: 'Twin' }]);
    assert.deepStrictEqual([matched, promptId], [2, 'first']);
  });
  await check('an empty name matches nothing, not the unnamed rows', () => {
    assert.strictEqual(link.resolveLocalPromptId('', [{ promptId: 'x', name: '' }]).matched, 0);
    assert.strictEqual(link.resolveLocalPromptId('   ', [{ promptId: 'x' }]).matched, 0);
  });

  finish();
})().catch((e) => { console.error('harness error:', e); process.exit(2); });
