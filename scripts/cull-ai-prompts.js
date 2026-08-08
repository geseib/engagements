#!/usr/bin/env node
/**
 * Repair and cull the AI-prompt inventory.
 *
 *   AWS_PROFILE=adminaccess node scripts/cull-ai-prompts.js <table>            # DRY RUN
 *   AWS_PROFILE=adminaccess node scripts/cull-ai-prompts.js <table> --apply
 *   AWS_PROFILE=adminaccess node scripts/cull-ai-prompts.js <table> --apply --only=ttl
 *
 * Everything lives in one partition (PK='AIPROMPTS'), so this is a paginated
 * Query, not a Scan. Nothing is written without --apply.
 *
 * Four independent passes, each reported separately so you can run them one at
 * a time with --only:
 *
 *   ttl        REMOVE the `ttl` attribute from every AIPROMPT#/PERSONA#/
 *              GAMETYPE# record. THIS IS THE URGENT ONE. The table has TTL
 *              enabled on `ttl` for GAME#/PLAYER# session records, and every
 *              prompt writer used to stamp prompts with now+365d — so prompts
 *              authored in Aug 2025 are being deleted by DynamoDB right now.
 *              The writers no longer stamp it; this strips the live rows.
 *              Touches ONLY the AIPROMPTS partition, so game/player expiry is
 *              unaffected.
 *
 *   gametype   Rewrite legacy `gameType` spellings to the canonical dashed ids
 *              (`callandanswer`→`call-and-answer`, `polls`→`poll`). Readers
 *              normalize already, so this is tidying, not a prerequisite.
 *
 *   orphans    HARD DELETE prompt rows with no `promptId` attribute. These came
 *              from populate-generation-prompts.js writing
 *              `SK: 'AIPROMPT#GENERATION#<scenario>#<gameType>'` and no
 *              `promptId`. They match get-ai-prompts.js's begins_with filter,
 *              so they appear in dropdowns as `<option value={undefined}>` —
 *              and a DOM option with no value reports its LABEL TEXT as its
 *              value, writing garbage like
 *              "Lessons Learned Scenarios (call-and-answer - )" into a question
 *              set's promptId. Owner-approved for hard deletion.
 *
 *   defaults   Clear `isDefault` so exactly ONE prompt per game type keeps it.
 *              Seven call-and-answer prompts and three trivia prompts all claim
 *              it today; findDefaultPromptId used to pick arbitrarily.
 *
 * Style follows scripts/seed-personas.js: dry run by default, --apply to write,
 * paginated reads, UnprocessedItems retried with backoff.
 */
const path = require('path');
const { createRequire } = require('module');

// The AWS SDK is installed under lambda-functions/, not at the repo root.
const REPO = path.join(__dirname, '..');
const lambdaRequire = createRequire(path.join(REPO, 'lambda-functions', 'package.json'));
const { DynamoDBClient } = lambdaRequire('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient, QueryCommand, UpdateCommand, BatchWriteCommand,
} = lambdaRequire('@aws-sdk/lib-dynamodb');
const { normalizeGameType } = require(path.join(REPO, 'lambda-functions', 'admin', 'shared', 'game-types.js'));

const [, , tableName, ...flags] = process.argv;
const apply = flags.includes('--apply');
const onlyFlag = flags.find((f) => f.startsWith('--only='));
const only = onlyFlag ? onlyFlag.split('=')[1].split(',') : null;
const wants = (pass) => !only || only.includes(pass);

if (!tableName) {
  console.error('usage: cull-ai-prompts.js <table-name> [--apply] [--only=ttl,gametype,orphans,defaults]');
  process.exit(2);
}

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const BATCH_LIMIT = 25;             // DynamoDB rejects a BatchWrite over 25.
const MAX_BATCH_ATTEMPTS = 6;       // 1 initial + 5 retries.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Preferred category when more than one prompt claims isDefault for a type.
 * Mirrors PREFERRED_DEFAULT_CATEGORY in lambda-functions/game/get-ai-summary.js
 * so the winner this script keeps is the one the runtime would have picked.
 */
const PREFERRED_DEFAULT_CATEGORY = {
  'call-and-answer': 'lessons-learned',
  trivia: 'general',
  poll: 'general',
  wavelength: 'general',
  survey: 'general',
};

/** Every row in the AIPROMPTS partition, following LastEvaluatedKey to the end. */
async function readAllPromptRows() {
  const items = [];
  let exclusiveStartKey;
  let pages = 0;

  do {
    const res = await db.send(new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': 'AIPROMPTS' },
      ExclusiveStartKey: exclusiveStartKey,
    }));
    items.push(...(res.Items || []));
    exclusiveStartKey = res.LastEvaluatedKey;
    pages++;
  } while (exclusiveStartKey);

  console.log(`read ${items.length} rows from PK=AIPROMPTS in ${pages} page(s)\n`);
  return items;
}

/** BatchWrite with UnprocessedItems retried — a partial success is not an error. */
async function batchDelete(keys) {
  for (let i = 0; i < keys.length; i += BATCH_LIMIT) {
    let pending = keys.slice(i, i + BATCH_LIMIT)
      .map((Key) => ({ DeleteRequest: { Key } }));

    for (let attempt = 1; pending.length && attempt <= MAX_BATCH_ATTEMPTS; attempt++) {
      const res = await db.send(new BatchWriteCommand({
        RequestItems: { [tableName]: pending },
      }));
      pending = (res.UnprocessedItems && res.UnprocessedItems[tableName]) || [];
      if (pending.length) {
        const backoff = 50 * 2 ** (attempt - 1) + Math.floor(Math.random() * 50);
        console.log(`    ${pending.length} unprocessed — retrying in ${backoff}ms`);
        await sleep(backoff);
      }
    }
    if (pending.length) {
      throw new Error(`DynamoDB kept throttling ${pending.length} delete(s) after ${MAX_BATCH_ATTEMPTS} attempts`);
    }
  }
}

const label = (i) => `${i.SK}${i.name ? `  "${i.name}"` : ''}`;

(async () => {
  console.log(`${apply ? 'APPLYING to' : 'DRY RUN against'} table "${tableName}"`);
  if (only) console.log(`passes: ${only.join(', ')}`);
  console.log('');

  const rows = await readAllPromptRows();
  const prompts = rows.filter((i) => String(i.SK).startsWith('AIPROMPT#'));
  const personas = rows.filter((i) => String(i.SK).startsWith('PERSONA#'));
  const lookups = rows.filter((i) => String(i.SK).startsWith('GAMETYPE#'));
  console.log(`  ${prompts.length} prompts, ${personas.length} personas, ${lookups.length} default-lookups\n`);

  const summary = [];

  // ---- pass 1: strip ttl -------------------------------------------------
  if (wants('ttl')) {
    const stamped = rows.filter((i) => i.ttl !== undefined);
    console.log(`[ttl] ${stamped.length} row(s) carry a ttl and will silently expire`);
    for (const item of stamped) {
      const when = new Date(Number(item.ttl) * 1000).toISOString().slice(0, 10);
      const overdue = Number(item.ttl) * 1000 < Date.now() ? '  ⚠️ ALREADY PAST' : '';
      console.log(`  REMOVE ttl  ${label(item)}   (expires ${when})${overdue}`);
      if (apply) {
        await db.send(new UpdateCommand({
          TableName: tableName,
          Key: { PK: item.PK, SK: item.SK },
          // `ttl` is a DynamoDB reserved word.
          UpdateExpression: 'REMOVE #ttl',
          ExpressionAttributeNames: { '#ttl': 'ttl' },
        }));
      }
    }
    summary.push(`ttl stripped: ${stamped.length}`);
    console.log('');
  }

  // ---- pass 2: canonicalise gameType ------------------------------------
  if (wants('gametype')) {
    const drifted = prompts.filter((i) =>
      i.gameType && i.gameType !== normalizeGameType(i.gameType));
    console.log(`[gametype] ${drifted.length} row(s) use a legacy spelling`);
    for (const item of drifted) {
      const to = normalizeGameType(item.gameType);
      console.log(`  ${item.gameType} → ${to}   ${label(item)}`);
      if (apply) {
        await db.send(new UpdateCommand({
          TableName: tableName,
          Key: { PK: item.PK, SK: item.SK },
          UpdateExpression: 'SET gameType = :g',
          ExpressionAttributeValues: { ':g': to },
        }));
      }
    }
    summary.push(`gameType canonicalised: ${drifted.length}`);
    console.log('');
  }

  // ---- pass 3: hard-delete promptId-less rows ---------------------------
  if (wants('orphans')) {
    const orphans = prompts.filter((i) => !i.promptId);
    console.log(`[orphans] ${orphans.length} prompt row(s) have NO promptId attribute (hard delete)`);
    for (const item of orphans) {
      console.log(`  DELETE  ${label(item)}`);
    }
    if (apply && orphans.length) {
      await batchDelete(orphans.map((i) => ({ PK: i.PK, SK: i.SK })));
    }
    summary.push(`orphan rows deleted: ${orphans.length}`);
    console.log('');
  }

  // ---- pass 4: one isDefault per game type ------------------------------
  if (wants('defaults')) {
    // `isDefault` means two different things depending on the kind of prompt,
    // and only one of them matters here.
    //
    // For a SUMMARY prompt it is load-bearing: get-ai-summary.js scans
    // `isDefault = true` to pick the fallback for a game type, so a collision
    // makes that pick arbitrary. For a GENERATION prompt it is only a "Default"
    // badge in AIGenerationPromptEditor.
    //
    // Before the generation rows were re-keyed they lived under
    // AIPROMPT#GENERATION#... and never collided with summary prompts. Now they
    // share the AIPROMPT#<promptId> namespace, so grouping purely by gameType
    // would silently strip badges off the generation library on every run.
    // Scope the dedup to summary prompts and leave generation alone.
    const isGeneration = (i) => String(i.promptId || '').startsWith('gen-')
      || String(i.promptType || '') === 'generation'
      || (!i.template && !i.instructions && !!i.basePrompt);

    const byType = new Map();
    let generationSkipped = 0;
    for (const item of prompts) {
      if (!item.isDefault || !item.promptId) continue;
      if (isGeneration(item)) { generationSkipped++; continue; }
      const t = normalizeGameType(item.gameType);
      if (!byType.has(t)) byType.set(t, []);
      byType.get(t).push(item);
    }

    let cleared = 0;
    console.log('[defaults] resolving isDefault collisions');
    if (generationSkipped) {
      console.log(`  (skipping ${generationSkipped} generation prompt(s) — their isDefault is a badge, not a lookup)`);
    }
    for (const [type, candidates] of byType) {
      if (candidates.length <= 1) {
        console.log(`  ${type}: 1 default — ok (${candidates[0].promptId})`);
        continue;
      }
      // Same ordering the runtime uses, so the survivor is the prompt games
      // were already getting.
      const preferred = PREFERRED_DEFAULT_CATEGORY[type];
      const rank = (i) => [
        i.category === preferred ? 0 : 1,
        i.basePrompt ? 1 : 0,
        String(i.createdAt || '9999'),
        String(i.promptId),
      ];
      const sorted = [...candidates].sort((a, b) => {
        const ra = rank(a), rb = rank(b);
        for (let k = 0; k < ra.length; k++) {
          if (ra[k] < rb[k]) return -1;
          if (ra[k] > rb[k]) return 1;
        }
        return 0;
      });
      const [keep, ...lose] = sorted;
      console.log(`  ${type}: ${candidates.length} defaults — keeping ${keep.promptId} ("${keep.name}")`);
      for (const item of lose) {
        console.log(`    clear isDefault  ${label(item)}`);
        cleared++;
        if (apply) {
          await db.send(new UpdateCommand({
            TableName: tableName,
            Key: { PK: item.PK, SK: item.SK },
            UpdateExpression: 'SET isDefault = :f',
            ExpressionAttributeValues: { ':f': false },
          }));
        }
      }
    }
    summary.push(`isDefault cleared: ${cleared}`);
    console.log('');
  }

  // ---- advisory: prompts that cannot serve as summary prompts -----------
  // Reported only. The shape that matters (template / instructions) lives in
  // S3, not on the DynamoDB record, so this flags the definite cases —
  // records carrying basePrompt — and nothing else.
  const generationShaped = prompts.filter((i) => i.basePrompt);
  if (generationShaped.length) {
    console.log(`[advisory] ${generationShaped.length} prompt(s) are generation-format and can NEVER drive an AI summary.`);
    console.log('           Harmless as generation prompts; only a problem if a question set points at one.');
    for (const item of generationShaped) console.log(`  ${label(item)}`);
    console.log('');
  }

  console.log(summary.join('\n'));
  if (!apply) console.log('\nDry run only. Re-run with --apply to write.');
})().catch((err) => {
  console.error('cull failed:', err);
  process.exit(1);
});
