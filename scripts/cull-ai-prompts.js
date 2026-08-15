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
 *   superseded HARD DELETE duplicate copies of a SHIPPED DEFAULT. Before D17
 *              was fixed, populate-defaults.js checked for existing prompts
 *              under the LEGACY key while writing the current one, so "skip
 *              existing" never fired and EVERY RUN minted a fresh promptId for
 *              the same nineteen prompts. The table therefore holds N copies of
 *              "Lessons Learned - Strategic Insights" and so on, of which the
 *              product can only ever use one. This pass keeps one per name and
 *              proposes the rest for deletion. See the reference gate below —
 *              a copy a question set points at is never proposed.
 *
 *   retired    REPORT (never delete) rows that were seeded by populate-defaults
 *              but whose `name` no longer appears in default-ai-prompts.json.
 *              These are defaults that were removed from the shipped catalogue;
 *              the seeder has no delete path, so they linger. Report-only
 *              because "not in the JSON" is not by itself proof the owner wants
 *              it gone — they may have edited it deliberately in the admin UI.
 *
 * ============================================================================
 * THE REFERENCE GATE — read this before adding another destructive pass
 * ============================================================================
 * A question set points at a prompt by `promptId` on its metadata row
 * (`PK='SETS'`, `SK='SET#<setId>'`, written by upload-questions.js:755 and
 * editable through edit-question-set.js). Deleting a prompt a set references
 * does not error and does not warn the owner: get-ai-summary.js:412-444 finds
 * the id unresolvable, logs a recovery, and silently substitutes the game-type
 * default. The set keeps its promptId, the admin UI keeps showing it as
 * attached, and every future round of that set is summarised by a prompt
 * nobody chose.
 *
 * So every destructive pass in this file reads the SETS partition first and
 * refuses to propose a referenced row. `--force-referenced` overrides it, and
 * exists only so the override has to be typed out.
 *
 * The gate also reports the other direction: a set whose promptId resolves to
 * NO prompt row at all. That set is already running on the fallback; it is not
 * something this script broke, but it is the thing the owner most wants to know
 * about while looking at this output.
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
const forceReferenced = flags.includes('--force-referenced');
const onlyFlag = flags.find((f) => f.startsWith('--only='));
const only = onlyFlag ? onlyFlag.split('=')[1].split(',') : null;
const wants = (pass) => !only || only.includes(pass);

if (!tableName) {
  console.error('usage: cull-ai-prompts.js <table-name> [--apply] [--force-referenced]');
  console.error('       [--only=ttl,gametype,orphans,defaults,superseded,retired]');
  process.exit(2);
}

// The shipped catalogue, so `superseded` and `retired` can tell a seeded
// default from something the owner wrote in the admin UI.
const shippedDefaults = require(
  path.join(REPO, 'lambda-functions', 'admin', 'default-ai-prompts.json')
);
const SHIPPED_BY_NAME = new Map();
for (const [gameType, categories] of Object.entries(shippedDefaults)) {
  for (const [scenario, p] of Object.entries(categories)) {
    SHIPPED_BY_NAME.set(p.name, { gameType, scenario, isDefault: p.isDefault === true });
  }
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

/**
 * Every question-set metadata row, following LastEvaluatedKey to the end.
 *
 * One partition (`PK='SETS'`), same as the prompts, so this is a Query. A set's
 * `promptId` lives ONLY here — the versioned partitions (`SET#<id>#v<n>`) hold
 * questions and categories, and upload-questions.js:909 is explicit that a
 * REPLACE must not overwrite this row precisely because the promptId lives on
 * it. So this one read sees every reference there is.
 */
async function readAllSetRows() {
  const items = [];
  let exclusiveStartKey;

  do {
    const res = await db.send(new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': 'SETS' },
      ExclusiveStartKey: exclusiveStartKey,
    }));
    items.push(...(res.Items || []));
    exclusiveStartKey = res.LastEvaluatedKey;
  } while (exclusiveStartKey);

  return items;
}

/** promptId -> [{ setId, setName }], built from the SETS partition. */
function buildReferenceIndex(setRows) {
  const index = new Map();
  for (const row of setRows) {
    const promptId = String(row.promptId || '').trim();
    if (!promptId) continue;
    const setId = String(row.SK || '').replace('SET#', '');
    if (!index.has(promptId)) index.set(promptId, []);
    index.get(promptId).push({ setId, setName: row.SetName || row.name || setId });
  }
  return index;
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

  // ---- the reference gate, read once and consulted by every delete -------
  const setRows = await readAllSetRows();
  const referencedBy = buildReferenceIndex(setRows);
  const promptIds = new Set(prompts.map((i) => i.promptId).filter(Boolean));
  const isReferenced = (item) =>
    Boolean(item.promptId) && referencedBy.has(String(item.promptId));
  const referencesOf = (item) => referencedBy.get(String(item.promptId)) || [];

  console.log(`[references] ${setRows.length} question set(s); `
    + `${referencedBy.size} distinct promptId(s) referenced`);
  for (const [promptId, sets] of referencedBy) {
    const known = promptIds.has(promptId);
    const owner = prompts.find((p) => p.promptId === promptId);
    console.log(`  ${known ? 'referenced' : 'DANGLING  '}  ${promptId}`
      + `${owner && owner.name ? `  "${owner.name}"` : ''}`
      + `  <- ${sets.map((s) => `${s.setId} ("${s.setName}")`).join(', ')}`);
  }
  const dangling = [...referencedBy.keys()].filter((id) => !promptIds.has(id));
  if (dangling.length) {
    console.log(`  ⚠️ ${dangling.length} set reference(s) resolve to no prompt row. Those sets are `
      + 'ALREADY running on the game-type default, silently (get-ai-summary.js:412-444).');
  }
  summary.push(`sets referencing a prompt: ${referencedBy.size} (${dangling.length} dangling)`);
  console.log('');

  /**
   * Rows an earlier pass has already proposed for deletion, keyed PK|SK.
   *
   * THE ROWS ARE READ ONCE, AT THE TOP, AND EVERY PASS SEES THAT SAME SNAPSHOT
   * — including the rows a previous pass has just deleted. That was harmless
   * while `orphans` was the only destructive pass, because an orphan has no
   * promptId and so is invisible to `defaults` anyway. `superseded` broke it:
   * on a duplicated shipped default where BOTH copies carry isDefault, it
   * deletes one copy and `defaults` then picks that same deleted copy as the
   * survivor and clears the flag off the copy that still exists — leaving the
   * game type with NO default at all, which sends every unattached set of that
   * type to the hardcoded fallback.
   *
   * So a pass that proposes a deletion records it here, and `defaults` skips
   * anything in it. Populated inside `gate`, which every destructive pass
   * already goes through, so a future pass cannot forget to do it.
   */
  const doomed = new Set();

  /**
   * Split a delete proposal into what may go and what the gate holds back.
   * Every destructive pass runs its candidates through this, so there is one
   * place where "referenced" turns into "not deleted".
   */
  const gate = (candidates) => {
    const held = candidates.filter((i) => isReferenced(i) && !forceReferenced);
    const free = candidates.filter((i) => !held.includes(i));
    for (const item of held) {
      console.log(`  HELD BACK (referenced)  ${label(item)}`);
      console.log(`      referenced by: ${referencesOf(item).map((s) => `${s.setId} ("${s.setName}")`).join(', ')}`);
    }
    for (const item of free) doomed.add(`${item.PK}|${item.SK}`);
    return { free, held };
  };

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
    // Runs through the gate for symmetry and for the one case that reaches it:
    // a row whose promptId is an empty string rather than absent would be
    // referenceable. A row with no promptId at all cannot be referenced,
    // because a set stores the id and there is none to store.
    const { free: orphansFree } = gate(orphans);
    for (const item of orphansFree) {
      console.log(`  DELETE  ${label(item)}`);
    }
    if (apply && orphansFree.length) {
      await batchDelete(orphansFree.map((i) => ({ PK: i.PK, SK: i.SK })));
    }
    summary.push(`orphan rows deleted: ${orphansFree.length}`);
    console.log('');
  }

  // ---- pass 5: duplicate copies of a shipped default --------------------
  if (wants('superseded')) {
    // Group the rows that carry a shipped default's exact `name`. That name is
    // the seeder's whole identity mechanism (populate-defaults.js matches on it
    // and reuses the promptId it finds), so two rows sharing one are two copies
    // of the same prompt, not two prompts.
    const byName = new Map();
    for (const item of prompts) {
      if (!item.promptId || !SHIPPED_BY_NAME.has(item.name)) continue;
      if (!byName.has(item.name)) byName.set(item.name, []);
      byName.get(item.name).push(item);
    }

    const doomed = [];
    console.log('[superseded] duplicate copies of a shipped default');
    for (const [name, copies] of byName) {
      if (copies.length <= 1) continue;
      // KEEP, in order: a copy a question set references (deleting it is the
      // failure this gate exists to prevent, and keeping it means the owner's
      // existing attachments keep working); then the copy carrying isDefault;
      // then the oldest, because that is the one the longest-lived sets are
      // most likely to have been pointed at by hand.
      const rank = (i) => [
        isReferenced(i) ? 0 : 1,
        i.isDefault === true ? 0 : 1,
        String(i.createdAt || '9999'),
        String(i.promptId),
      ];
      const sorted = [...copies].sort((a, b) => {
        const ra = rank(a); const rb = rank(b);
        for (let k = 0; k < ra.length; k++) {
          if (ra[k] < rb[k]) return -1;
          if (ra[k] > rb[k]) return 1;
        }
        return 0;
      });
      const [keep, ...lose] = sorted;
      console.log(`  "${name}": ${copies.length} copies — keeping ${keep.promptId}`
        + `${isReferenced(keep) ? ' (referenced by a set)' : ''}`);
      doomed.push(...lose);
    }
    if (!doomed.length) console.log('  no duplicate copies found');

    const { free: supersededFree } = gate(doomed);
    for (const item of supersededFree) console.log(`  DELETE  ${label(item)}`);
    if (apply && supersededFree.length) {
      await batchDelete(supersededFree.map((i) => ({ PK: i.PK, SK: i.SK })));
    }
    summary.push(`superseded duplicates deleted: ${supersededFree.length}`);
    console.log('');
  }

  // ---- pass 6: seeded defaults no longer in the shipped catalogue --------
  if (wants('retired')) {
    // REPORT ONLY. `createdBy: 'system'` is what populate-defaults.js stamps on
    // every row it writes, so it separates a seeded default from something the
    // owner authored in the admin UI. A seeded row whose name has since left
    // default-ai-prompts.json is a default that was withdrawn — but the owner
    // may equally have edited it since, and this script cannot tell the two
    // apart from the metadata row. So it is named, never deleted.
    const retired = prompts.filter((i) =>
      i.createdBy === 'system' && i.name && !SHIPPED_BY_NAME.has(i.name));
    console.log(`[retired] ${retired.length} seeded row(s) whose name is no longer in `
      + 'default-ai-prompts.json');
    for (const item of retired) {
      const refs = referencesOf(item);
      console.log(`  ${label(item)}   ${refs.length
        ? `REFERENCED by ${refs.map((s) => s.setId).join(', ')} — do not remove`
        : 'unreferenced'}`);
    }
    summary.push(`retired-name rows reported: ${retired.length}`);
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
      // A row an earlier pass is deleting cannot be the survivor. See `doomed`.
      if (doomed.has(`${item.PK}|${item.SK}`)) continue;
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
