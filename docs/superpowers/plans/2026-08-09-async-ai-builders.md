# Async AI Builders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move trivia, poll, survey and question generation off the HTTP request so they stop racing API Gateway's hard 30s integration timeout, and make AI-suggested tags survive all the way into the question set.

**Architecture:** Each of the four Lambdas becomes a three-mode handler — `POST` creates a job row and returns `202 {jobId}`, a self-invoked `Event` worker does the generation against the function's own 900s timeout, and the client polls `GET /{jobId}`. The shared skeleton is extracted once into `shared/generation-handler.js` as a factory, so each Lambda contributes only its own tool schema, prompt and item normalizer. Bedrock output moves from regex-scraped prose to tool use.

**Tech Stack:** Node.js 22 (CommonJS), AWS SDK v3, Bedrock (Sonnet 4.6 with Haiku 4.5 fallback), DynamoDB single-table, SAM/CloudFormation, React 18, plain `node` test scripts.

**Spec:** `docs/superpowers/specs/2026-08-09-async-ai-builders-design.md`

## Global Constraints

- **Never deploy.** The owner deploys. Do not run `deployall`, `deploy-clean.sh`, `sam deploy`, or any pipeline trigger.
- **Do not touch the host redesign's files.** In flight on `dev`, concurrently: `src/src/GameHostPage.jsx`, `docs/design/host-redesign/**`, `lambda-functions/game/anonymity.js`, `lambda-functions/websocket/anonymity.js`, `lambda-functions/websocket/start-vote.js`, `tests/anonymity-contract.js`, `tests/vote-state-broadcast.js`. None of them appear in this plan; if a task seems to need one, stop and ask.
- **Backend test baseline: 652 passing, 0 failing, 19 suites.** Command:
  `for t in tests/*.js; do case "$t" in *.spec.js) continue;; esac; node "$t"; done 2>&1 | grep -E '^[0-9]+ passed' | awk '{p+=$1; f+=$3; n++} END {print n" suites, "p" passed, "f" failed"}'`
  Aggregate with `grep -E '^[0-9]+ passed'`, never `tail -1` — some suites print a trailing line and `tail -1` silently drops them.
- **The 11 `tests/*.spec.js` files are Playwright** and cannot run under plain `node`. Excluded from the baseline command above. Do not "fix" them.
- **The 5 failing frontend Jest suites are stale and out of scope.** They predate the auth system. `cd src && npx jest __tests__/` ⇒ 5 failed suites / 30 failed / 242 passed, before and after this work.
- **`node_modules` in this worktree are symlinks to the main checkout.** Do not run `npm install` anywhere in this worktree — it would write through the symlink into the main repo.
- **DynamoDB question fields are PascalCase** (`Title`, `Detail`, `Category`, `School`, `CustomInstructions`, `Active`, `QuestionNumber`, `AnswerDetails`, `OptionA`…`OptionF`, `CorrectAnswer`, `Difficulty`, `Options`, `AllowMultiple`). The new field is `Tags`, an array of strings.
- **Multi-value CSV cells are `|`-separated** — `upload-questions.js` already splits `Options` that way. `Tags` follows the same convention.
- **Tags are normalized on write, tolerated on read.** Always go through `normalizeTags` from `lambda-functions/admin/shared/tags.js` (backend) or `src/src/utils/tags.js` (frontend). Never compare raw tag strings.
- **Commit after every task.** Conventional-commit subject with a leading emoji, matching repo style. End every commit message with:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- **Do not modify `lambda-functions/admin/ai-generate-scenarios.js`.** It is the proven reference and its test (`tests/scenario-generation-job.js`, 30/30) is the regression guard for every shared-file change in this plan.

---

## File Structure

**Created:**
| File | Responsibility |
|---|---|
| `lambda-functions/admin/shared/generation-handler.js` | The three-mode handler + worker loop, once. Consumed by all four converted Lambdas. |
| `tests/helpers/generation-job-harness.js` | AWS stubs, tool-use response shaping, test runner and job driver, shared by the four new suites. |
| `tests/trivia-generation-job.js` | Trivia conversion contract. |
| `tests/poll-generation-job.js` | Poll conversion contract. |
| `tests/question-generation-job.js` | Question/AIAssistant conversion contract, both bulk and refine modes. |
| `tests/survey-generation-job.js` | Survey conversion contract + the `meta` envelope. |
| `tests/upload-questions-tags.js` | Optional `Tags` column parses; absent column still imports. |

**Modified:**
| File | Change |
|---|---|
| `lambda-functions/admin/shared/generation-jobs.js` | Optional `meta` on update/complete/response. |
| `lambda-functions/admin/shared/structured-generation.js` | Per-kind entries in `PER_ITEM_TOKENS`. |
| `lambda-functions/admin/shared/bedrock-utils.js` | Delete `invokeClaudeWithRetry`, `planTopicList`, `buildTopicAssignmentText` (unreferenced after conversion). |
| `lambda-functions/admin/ai-generate-{trivia,polls,questions,survey}.js` | Full conversion. |
| `lambda-functions/admin/upload-questions.js` | Optional `Tags` column → `Tags` array. |
| `src/src/utils/aiBatchClient.js` | Delete `planGenerationTopics`, `dropNearDuplicates`, `runWithConcurrency`. |
| `src/src/components/{TriviaAIBuilder,PollAIBuilder,SurveyAIBuilder,AIAssistant}.jsx` | Job polling + tag editor. |
| `src/src/AdminPage.jsx` | `Tags` column in three CSV generators. |
| `src/src/BuilderPage.jsx` | `Tags` column in `generateCSVContent`. |
| `template-clean.yaml` | 4× `GET /{jobId}` route, 4× self-scoped `lambda:InvokeFunction`. |

---

### Task 1: Optional `meta` on job records

Only the survey builder needs a set-level result (an AI-improved title and description), but the field is declared generically because "something true of the result set rather than its items" is not survey-specific.

**Files:**
- Modify: `lambda-functions/admin/shared/generation-jobs.js:91-108` (`updateJobProgress`), `:110-126` (`completeJob`), `:162-176` (`jobToResponse`)
- Test: `tests/scenario-generation-job.js` (add one case; this file is also the guard that the change did not disturb scenarios)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `updateJobProgress(dynamodb, tableName, jobId, { completed, phase, items, warnings, meta })` — `meta` is an optional plain object; written only when it is a non-null object.
  - `completeJob(dynamodb, tableName, jobId, { items, warnings = [], meta })` — same rule.
  - `jobToResponse(item)` gains `meta: item.meta || null`.
  - `failJob` is unchanged and must not clear `meta`.

- [ ] **Step 1: Write the failing test**

Append to `tests/scenario-generation-job.js`, immediately before the final `console.log(\`\n${passed} passed…\`)` line:

```js
  console.log('\njob records carry an optional set-level meta');

  await test('a job with no meta polls cleanly as meta: null', async () => {
    reset();
    bedrockHandler = () => toolResponse(makeItems(2, 'nometa'));
    const { job } = await runJob({ scenarioType: 'custom', engagementType: 'call-and-answer', count: 2 });
    assert.strictEqual(job.meta, null, 'absent meta must poll as null, not undefined');
    assert.strictEqual(job.status, 'complete');
  });

  await test('meta written by a worker survives to the poll payload', async () => {
    reset();
    const {
      newJobId, createJob, updateJobProgress, completeJob, getJob, jobToResponse,
    } = require(path.join(REPO, 'lambda-functions/admin/shared/generation-jobs.js'));
    const jobId = newJobId();
    await createJob(docClient, 'engage-test', { jobId, kind: 'test', requested: 1 });
    await updateJobProgress(docClient, 'engage-test', jobId, {
      completed: 0, phase: 'x', meta: { title: 'Improved Title', description: 'Improved description' },
    });
    await completeJob(docClient, 'engage-test', jobId, { items: [{ title: 'a' }] });
    const res = jobToResponse(await getJob(docClient, 'engage-test', jobId));
    assert.deepStrictEqual(res.meta, { title: 'Improved Title', description: 'Improved description' },
      'meta written mid-run must survive completeJob');
  });

  await test('failJob keeps meta and partial items', async () => {
    reset();
    const {
      newJobId, createJob, updateJobProgress, failJob, getJob, jobToResponse,
    } = require(path.join(REPO, 'lambda-functions/admin/shared/generation-jobs.js'));
    const jobId = newJobId();
    await createJob(docClient, 'engage-test', { jobId, kind: 'test', requested: 3 });
    await updateJobProgress(docClient, 'engage-test', jobId, { meta: { title: 'Kept' } });
    await failJob(docClient, 'engage-test', jobId, 'bedrock exploded', { items: [{ title: 'partial' }] });
    const res = jobToResponse(await getJob(docClient, 'engage-test', jobId));
    assert.deepStrictEqual(res.meta, { title: 'Kept' }, 'a failure must not discard set-level meta');
    assert.strictEqual(res.items.length, 1);
    assert.match(res.error, /bedrock exploded/);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/scenario-generation-job.js 2>&1 | grep -E 'FAIL|passed,'`
Expected: three FAIL lines — the first reporting `undefined !== null` for `job.meta`, the others reporting `meta` missing from the response.

- [ ] **Step 3: Write minimal implementation**

In `updateJobProgress`, after the `warnings` line inside the builder block:

```js
  if (Array.isArray(warnings)) { sets.push('warnings = :warnings'); values[':warnings'] = warnings; }
  // Set-level result, distinct from the items: the survey builder's AI-improved
  // title and description. Written only when a worker actually produced one, so
  // every existing caller is unaffected.
  if (meta && typeof meta === 'object') { sets.push('#meta = :meta'); names['#meta'] = 'meta'; values[':meta'] = meta; }
```

and widen its destructure to `{ completed, phase, items, warnings, meta }`.

In `completeJob`, replace the fixed `UpdateCommand` with a built one so `meta` stays optional:

```js
async function completeJob(dynamodb, tableName, jobId, { items, warnings = [], meta }) {
  const sets = [
    '#status = :status', '#items = :items', 'warnings = :warnings',
    'completed = :completed', 'phase = :phase', 'updatedAt = :now',
  ];
  const names = { '#status': 'status', '#items': 'items' };
  const values = {
    ':status': STATUS.COMPLETE,
    ':items': items,
    ':warnings': warnings,
    ':completed': items.length,
    ':phase': `Generated ${items.length} of ${items.length}`,
    ':now': new Date().toISOString(),
  };
  // Omitted meta must LEAVE an earlier one alone, not overwrite it with null —
  // the survey worker writes meta on its first pass and completes much later.
  if (meta && typeof meta === 'object') { sets.push('#meta = :meta'); names['#meta'] = 'meta'; values[':meta'] = meta; }

  await dynamodb.send(new UpdateCommand({
    TableName: tableName,
    Key: jobKey(jobId),
    UpdateExpression: `SET ${sets.join(', ')}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  }));
}
```

In `jobToResponse`, add after `warnings`:

```js
    meta: item.meta || null,
```

`meta` is a DynamoDB reserved word, which is why every reference uses the `#meta` alias.

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/scenario-generation-job.js 2>&1 | tail -3`
Expected: `33 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add lambda-functions/admin/shared/generation-jobs.js tests/scenario-generation-job.js
git commit -m "$(cat <<'EOF'
✨ Job records carry an optional set-level meta

The survey builder needs the AI's improved title and description to
survive to the client, and those describe the result SET, not any one
item. `meta` is additive: written only when a worker supplies a non-null
object, never cleared by completeJob or failJob, and reported as null
when absent. Every existing caller omits it, so the scenarios path is
unchanged — asserted by the new "no meta polls cleanly" case.

`meta` is a DynamoDB reserved word; all references use a #meta alias.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: The shared generation-handler factory

The scenarios handler carries ~200 lines of job plumbing that is identical for every builder. Copying it four times would mean four places to fix the next bug. Extract it once.

`ai-generate-scenarios.js` is deliberately **not** migrated onto the factory in this plan — it is proven and deployed, and its inline copy is the regression guard for the factory's behaviour. Migrating it is a follow-up once the four converted builders are proven in dev.

**Files:**
- Create: `lambda-functions/admin/shared/generation-handler.js`
- Modify: `lambda-functions/admin/shared/structured-generation.js:46` (`PER_ITEM_TOKENS`)
- Test: covered by Tasks 3-6; no standalone test (the factory has no behaviour without a config)

**Interfaces:**
- Consumes: `generation-jobs.js` (Task 1), `structured-generation.js`.
- Produces:
  ```js
  makeGenerationHandler({
    kind,          // string, stored on the job row, e.g. 'trivia'
    tokenKind,     // key into PER_ITEM_TOKENS, e.g. 'trivia'
    parseRequest,  // (payload) => ({ total, config }) — validates + clamps
    buildTool,     // (config) => Bedrock tool schema
    buildPrompt,   // ({ config, count, alreadyUsedTitles, isFirstPass }) => string
    normalizeItem, // (raw, config) => item, or null to drop
    extractMeta,   // optional: (toolInput, config) => object|null, first pass only
    titleOf,       // optional: (item) => string, defaults to item.title
  }) => async (event, context) => response
  ```
  Every converted Lambda's `exports.handler` is the return value of one call.
- `PER_ITEM_TOKENS` gains: `trivia: 380`, `poll: 260`, `survey: 200`, `question: 420`.

- [ ] **Step 1: Add the per-kind token costs**

In `lambda-functions/admin/shared/structured-generation.js`, replace the `PER_ITEM_TOKENS` constant:

```js
/**
 * With the length limits enforced below, an item costs roughly this much.
 *
 * Keyed by engagement type for the scenario builder and by generation kind for
 * the others. Measured against real output: a trivia question carries 4-6
 * options plus an explanation, a poll carries 3-5 short options and no
 * explanation, a survey question is mostly a scale or a placeholder.
 */
const PER_ITEM_TOKENS = {
  wavelength: 110,
  survey: 200,
  poll: 260,
  trivia: 380,
  question: 420,
  default: 420,
};
```

`perItemTokens`, `itemsPerCall` and `maxTokensFor` already read this map and need no change. Scenario callers pass `engagementType`; the converted builders pass their `tokenKind`.

- [ ] **Step 2: Write the factory**

Create `lambda-functions/admin/shared/generation-handler.js`:

```js
/**
 * The generation-job handler, once.
 *
 * WHY THIS EXISTS. `RestApi` is an `AWS::Serverless::HttpApi`, whose 30-second
 * integration timeout is a hard, non-configurable ceiling — while the Lambdas
 * behind it are configured for 900s. Generation that runs inside the request
 * races a wall clock it cannot see, and when it loses, API Gateway returns its
 * own non-JSON 503 while the Lambda is still working. That is the "HTTP 503"
 * the AI builders reported. Shrinking the batch could not help: the per-call
 * token floor was already above the ceiling.
 *
 * So the request stops generating. POST creates a job and returns 202, a
 * self-invoked Event worker does the slow part against the full 900s, and the
 * client polls. See shared/generation-jobs.js for why polling and not
 * WebSocket.
 *
 * ai-generate-scenarios.js carries its own inline copy of this flow. It is
 * deliberately NOT migrated here: it is the proven, deployed reference, and its
 * test suite is what guards this factory's behaviour. Migrating it is a
 * follow-up once the four builders converted onto this factory are proven.
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');

const { itemsPerCall, maxTokensFor, perItemTokens, invokeStructured } = require('./structured-generation');
const {
  newJobId, createJob, updateJobProgress, completeJob, failJob, getJob, jobToResponse,
} = require('./generation-jobs');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const json = (statusCode, body) => ({ statusCode, body: JSON.stringify(body), headers: CORS });

/** Observed Sonnet throughput on this account. Used only to budget the deadline. */
const OUTPUT_TOKENS_PER_SEC = 45;

const titleTokens = (title) =>
  String(title || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);

/**
 * Safety net only — prompt-level avoidance is the primary dedup mechanism, so
 * this is deliberately conservative. The old client-side threshold (4+ tokens,
 * 80% overlap) is a hair trigger on real titles: two questions differing only in
 * their last word are usually two questions. Identical token sets are always
 * caught; anything looser needs 5+ tokens and 90% overlap.
 */
function isNearDuplicate(title, keptTokenSets) {
  const tokens = titleTokens(title);
  if (tokens.length === 0) return false;
  const set = new Set(tokens);
  return keptTokenSets.some((prev) => {
    const overlap = tokens.filter((t) => prev.has(t)).length;
    const sameSet = overlap === set.size && overlap === prev.size;
    const high = Math.min(set.size, prev.size) >= 5 && overlap / Math.min(set.size, prev.size) >= 0.9;
    return sameSet || high;
  });
}

function makeGenerationHandler(config) {
  const {
    kind, tokenKind,
    parseRequest, buildTool, buildPrompt, normalizeItem,
    extractMeta = null,
    titleOf = (item) => item?.title,
  } = config;

  const tableName = process.env.TABLE_NAME;
  const dynamodb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
  });
  const bedrockClient = new BedrockRuntimeClient({ region: process.env.AWS_REGION });
  const lambda = new LambdaClient({ region: process.env.AWS_REGION });

  async function runWorker(event, context) {
    const { jobId, payload } = event;
    const produced = [];
    const keptTokenSets = [];
    const warnings = [];
    let meta = null;

    try {
      const { total, config: reqConfig } = parseRequest(payload);
      const perCall = itemsPerCall(tokenKind);
      const tool = buildTool(reqConfig);

      await updateJobProgress(dynamodb, tableName, jobId, {
        completed: 0,
        phase: total <= perCall
          ? `Generating ${total} in a single pass...`
          : `Generating ${total} in ${Math.ceil(total / perCall)} passes...`,
      });

      let isFirstPass = true;
      while (produced.length < total) {
        const chunkSize = Math.min(perCall, total - produced.length);

        // Stop cleanly rather than being killed mid-call: a partial result that
        // is saved beats a full result that is lost.
        const estimatedMs = ((chunkSize * perItemTokens(tokenKind)) / OUTPUT_TOKENS_PER_SEC) * 1000 * 1.5 + 30000;
        const remainingMs = typeof context?.getRemainingTimeInMillis === 'function'
          ? context.getRemainingTimeInMillis()
          : Infinity;
        if (remainingMs < estimatedMs) {
          warnings.push(`Stopped after ${produced.length} of ${total} to stay inside the function time limit. Run again to generate more.`);
          break;
        }

        const promptFor = (count) => buildPrompt({
          config: reqConfig,
          count,
          alreadyUsedTitles: produced.map(titleOf).filter(Boolean),
          isFirstPass,
        });

        let result;
        try {
          result = await invokeStructured(bedrockClient, InvokeModelCommand, {
            prompt: promptFor(chunkSize),
            tool,
            maxTokens: maxTokensFor(tokenKind, chunkSize),
          });
        } catch (error) {
          if (error.name === 'OutputTruncatedError' && chunkSize > 1) {
            // Truncation means this chunk was too ambitious, not that the run is
            // doomed. Halving is cheaper than failing the whole job.
            warnings.push(`A pass of ${chunkSize} exceeded the output budget; continuing in smaller passes.`);
            const halved = Math.max(1, Math.floor(chunkSize / 2));
            result = await invokeStructured(bedrockClient, InvokeModelCommand, {
              prompt: promptFor(halved),
              tool,
              maxTokens: maxTokensFor(tokenKind, halved),
            });
          } else {
            throw error;
          }
        }

        // Set-level output (e.g. an improved survey title) is asked for on the
        // FIRST pass only — re-deriving it per chunk invites the model to
        // contradict itself — and is written immediately so it survives a later
        // failure.
        if (isFirstPass && extractMeta) {
          const extracted = extractMeta(result, reqConfig);
          if (extracted && typeof extracted === 'object' && Object.keys(extracted).length > 0) {
            meta = extracted;
          }
        }
        isFirstPass = false;

        const batch = Array.isArray(result?.items) ? result.items : [];
        if (batch.length === 0) {
          warnings.push('A generation pass returned no items; stopping early.');
          break;
        }

        let added = 0;
        for (const raw of batch) {
          if (produced.length >= total) break;
          const item = normalizeItem(raw, reqConfig);
          if (!item) continue;
          const title = titleOf(item);
          if (!title) continue;
          if (isNearDuplicate(title, keptTokenSets)) {
            console.warn(`⚠️ Dropping near-duplicate: "${title}"`);
            continue;
          }
          keptTokenSets.push(new Set(titleTokens(title)));
          produced.push(item);
          added += 1;
        }

        await updateJobProgress(dynamodb, tableName, jobId, {
          completed: produced.length,
          phase: `Generated ${produced.length} of ${total}...`,
          items: produced,
          warnings,
          meta,
        });

        // No forward progress means another pass will not help either.
        if (added === 0) {
          warnings.push('A generation pass produced only duplicates; stopping early.');
          break;
        }
      }

      await completeJob(dynamodb, tableName, jobId, { items: produced, warnings, meta });
      console.log(`✅ Job ${jobId} complete: ${produced.length} items`);
    } catch (error) {
      console.error(`❌ Job ${jobId} failed:`, error);
      await failJob(dynamodb, tableName, jobId, error.message, { items: produced });
    }
  }

  return async function handler(event, context) {
    // Async worker: invoked with InvocationType 'Event', so it runs against the
    // Lambda's own 900s timeout and never touches API Gateway's 30s ceiling.
    if (event && event.__workerMode === true) {
      await runWorker(event, context);
      return { statusCode: 200, body: 'ok' };
    }

    const method = event?.requestContext?.http?.method || event?.httpMethod;
    if (method === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

    try {
      const jobIdParam = event?.pathParameters?.jobId || event?.queryStringParameters?.jobId;
      if (method === 'GET' || jobIdParam) {
        if (!jobIdParam) return json(400, { error: 'jobId is required' });
        const item = await getJob(dynamodb, tableName, jobIdParam);
        if (!item) return json(404, { error: 'Job not found or expired' });
        return json(200, jobToResponse(item));
      }

      if (!event.body) return json(400, { error: 'No request body provided' });
      const payload = JSON.parse(event.body);

      const { total } = parseRequest(payload);
      const jobId = newJobId();

      await createJob(dynamodb, tableName, {
        jobId, kind, requested: total, request: { kind, count: total },
      });

      try {
        await lambda.send(new InvokeCommand({
          FunctionName: context.functionName,
          InvocationType: 'Event',
          Payload: Buffer.from(JSON.stringify({ __workerMode: true, jobId, payload })),
        }));
      } catch (error) {
        // The job row already exists, so surface the failure there too — a
        // client polling a job that will never start deserves an explanation.
        console.error('❌ Failed to dispatch generation worker:', error);
        await failJob(dynamodb, tableName, jobId, `Could not start generation worker: ${error.message}`);
        return json(500, { error: `Could not start generation: ${error.message}`, jobId });
      }

      console.log(`🚀 Dispatched ${kind} generation job ${jobId} for ${total} items`);
      return json(202, { jobId, status: 'queued', requested: total });
    } catch (error) {
      console.error(`❌ AI ${kind} generation error:`, error);
      return json(500, { error: `Failed to generate ${kind}: ${error.message || 'unexpected error'}` });
    }
  };
}

module.exports = { makeGenerationHandler, isNearDuplicate, titleTokens, CORS, OUTPUT_TOKENS_PER_SEC };
```

- [ ] **Step 3: Verify the shared change did not disturb scenarios**

Run: `node tests/scenario-generation-job.js 2>&1 | tail -3`
Expected: `33 passed, 0 failed` — unchanged from Task 1. `PER_ITEM_TOKENS` gained keys but `wavelength` and `default` are untouched, so scenario chunk sizing is identical.

- [ ] **Step 4: Verify the factory parses**

Run: `node -e "const m=require('./lambda-functions/admin/shared/generation-handler.js'); console.log(typeof m.makeGenerationHandler)"`
Expected: `function`

- [ ] **Step 5: Commit**

```bash
git add lambda-functions/admin/shared/generation-handler.js lambda-functions/admin/shared/structured-generation.js
git commit -m "$(cat <<'EOF'
✨ Extract the generation-job handler into a shared factory

The scenarios handler carries ~200 lines of job plumbing — 202 dispatch,
Event worker, deadline budgeting, truncation halving, incremental
progress — that is identical for every builder. Copying it into four
more files would mean five places to fix the next bug.

makeGenerationHandler() takes the parts that genuinely differ (tool
schema, prompt, item normalizer) and owns everything else. It also gains
one capability scenarios does not need: extractMeta, for set-level output
asked of the first pass only.

ai-generate-scenarios.js is deliberately NOT migrated. It is proven and
deployed, and its 33-test suite is what guards this factory's behaviour;
migrating it is a follow-up once the four converted builders are proven.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Shared test harness (created in Task 3, imported by Tasks 4-6)

Tasks 3-6 each drive a real handler with Bedrock, DynamoDB and Lambda stubbed. The
stub machinery is identical for all four, so it lives in one module rather than being
pasted four times.

**Created in Task 3** (its first consumer proves it) at
`tests/helpers/generation-job-harness.js`:

```js
/**
 * Shared stub harness for the async generation-job Lambdas.
 *
 * The four converted builders (trivia, polls, questions, survey) differ only in
 * their tool schema, prompt and item shape — the AWS surface they touch is
 * identical, so stubbing it four times would mean four places to fix a stub bug.
 *
 * `install()` MUST run before the handler under test is required: it patches
 * Module._load to intercept the AWS SDK by module name, which only affects
 * requires that happen afterwards.
 *
 * tests/scenario-generation-job.js deliberately keeps its own inline copy. It is
 * the reference suite for the pattern and predates this helper; coupling it here
 * would mean a bug in this file could mask a regression in the one handler that
 * is already deployed.
 */
const Module = require('module');

const state = {
  ddb: new Map(),
  bedrockCalls: [],
  bedrockHandler: () => { throw new Error('no bedrock handler installed'); },
  dispatched: [],
  lambdaShouldFail: false,
  passed: 0,
  failed: 0,
};

const rowKey = (pk, sk) => `${pk}|${sk}`;

class GetCommand { constructor(input) { this.kind = 'get'; this.input = input; } }
class PutCommand { constructor(input) { this.kind = 'put'; this.input = input; } }
class UpdateCommand { constructor(input) { this.kind = 'update'; this.input = input; } }
class InvokeModelCommand { constructor(input) { this.input = input; } }
class InvokeCommand { constructor(input) { this.input = input; } }

/** Minimal `SET a = :x, #n = :y` applier — enough for the job record. */
function applyUpdate(item, input) {
  const expr = String(input.UpdateExpression).replace(/^SET\s+/i, '');
  for (const part of expr.split(/,\s*/)) {
    const [lhs, rhs] = part.split(/\s*=\s*/);
    const name = (input.ExpressionAttributeNames || {})[lhs] || lhs;
    item[name] = input.ExpressionAttributeValues[rhs];
  }
}

const docClient = {
  send: async (cmd) => {
    const { Key, Item } = cmd.input;
    if (cmd.kind === 'get') return { Item: state.ddb.get(rowKey(Key.PK, Key.SK)) || undefined };
    if (cmd.kind === 'put') { state.ddb.set(rowKey(Item.PK, Item.SK), { ...Item }); return {}; }
    if (cmd.kind === 'update') {
      const k = rowKey(Key.PK, Key.SK);
      const existing = state.ddb.get(k) || { ...Key };
      applyUpdate(existing, cmd.input);
      state.ddb.set(k, existing);
      return {};
    }
    throw new Error(`unexpected command ${cmd.kind}`);
  },
};

class BedrockRuntimeClient {
  async send(cmd) {
    const body = JSON.parse(cmd.input.body);
    state.bedrockCalls.push({ modelId: cmd.input.modelId, body, prompt: body.messages[0].content });
    return state.bedrockHandler(state.bedrockCalls.length, body);
  }
}

class LambdaClient {
  async send(cmd) {
    if (state.lambdaShouldFail) throw new Error('AccessDeniedException');
    state.dispatched.push({
      FunctionName: cmd.input.FunctionName,
      InvocationType: cmd.input.InvocationType,
      payload: JSON.parse(Buffer.from(cmd.input.Payload).toString('utf8')),
    });
    return {};
  }
}

/** Patch the AWS SDK by module name. Call BEFORE requiring the handler. */
function install() {
  process.env.TABLE_NAME = 'engage-test';
  process.env.ACCOUNT_ID = '000000000000';
  process.env.AWS_REGION = 'us-east-1';

  const stubs = new Map([
    ['@aws-sdk/client-dynamodb', { DynamoDBClient: class {} }],
    ['@aws-sdk/lib-dynamodb', {
      DynamoDBDocumentClient: { from: () => docClient },
      GetCommand, PutCommand, UpdateCommand,
    }],
    ['@aws-sdk/client-bedrock-runtime', { BedrockRuntimeClient, InvokeModelCommand }],
    ['@aws-sdk/client-lambda', { LambdaClient, InvokeCommand }],
  ]);

  const realLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (stubs.has(request)) return stubs.get(request);
    return realLoad.call(this, request, parent, isMain);
  };
}

function reset() {
  state.ddb.clear();
  state.bedrockCalls = [];
  state.dispatched = [];
  state.lambdaShouldFail = false;
}

/** Shape a Bedrock tool-use response. `extra` merges into the tool input. */
const toolResponse = (items, stopReason = 'tool_use', extra = {}) => ({
  body: new TextEncoder().encode(JSON.stringify({
    stop_reason: stopReason,
    content: [{ type: 'tool_use', name: 'emit_items', input: { items, ...extra } }],
  })),
});

async function test(name, fn) {
  try { await fn(); state.passed += 1; console.log(`  PASS  ${name}`); }
  catch (error) { state.failed += 1; console.log(`  FAIL  ${name}\n        ${error.message}`); }
}

/** Print the tally in the format the repo's aggregate command greps for. */
function summary() {
  console.log(`\n${state.passed} passed, ${state.failed} failed\n`);
  if (state.failed > 0) process.exit(1);
}

/**
 * Build the POST/worker/poll driver for one handler. Each suite calls this once
 * with its own handler and function name.
 */
function makeRunner(handler, functionName) {
  const postEvent = (body) => ({ requestContext: { http: { method: 'POST' } }, body: JSON.stringify(body) });
  const ctx = (remainingMs = 900000) => ({ functionName, getRemainingTimeInMillis: () => remainingMs });

  /** Start a job over HTTP, then run the worker the way Lambda's Event invoke would. */
  async function runJob(body, workerCtx = ctx()) {
    const started = await handler(postEvent(body), ctx());
    const { jobId } = JSON.parse(started.body);
    await handler({ __workerMode: true, jobId, payload: body }, workerCtx);
    const polled = await handler(
      { requestContext: { http: { method: 'GET' } }, pathParameters: { jobId } },
      ctx(),
    );
    return { started, jobId, job: JSON.parse(polled.body) };
  }

  return { postEvent, ctx, runJob };
}

module.exports = { state, install, reset, toolResponse, test, summary, makeRunner, docClient };
```

**How each suite uses it** — this preamble opens Tasks 3, 4, 5 and 6, substituting only
the handler path and function name:

```js
const path = require('path');
const assert = require('assert');
const harness = require('./helpers/generation-job-harness');

const REPO = path.join(__dirname, '..');
harness.install();                                     // MUST precede the require below

const { handler } = require(path.join(REPO, 'lambda-functions/admin/ai-generate-trivia.js'));

const { state, reset, toolResponse, test, summary } = harness;
const { postEvent, ctx, runJob } = harness.makeRunner(handler, 'engagedev-admin-ai-generate-trivia');
```

Read counters through `state` — `state.bedrockCalls`, `state.dispatched` — and set
behaviour with `state.bedrockHandler = ...` and `state.lambdaShouldFail = true`. They
are properties of a shared object, so destructuring them into local `let`s would read a
stale snapshot.

**The eight common cases** — written once here, included in all four suites. Substitute
`BASE`, the suite's `makeItems` factory name, and the count field (`count` for Tasks 3-4,
`questionCount` for Tasks 5-6):

```js
  console.log('\nthe HTTP request no longer generates');

  await test('POST returns 202 with a jobId instead of items', async () => {
    reset();
    const res = await handler(postEvent({ ...BASE, count: 10 }), ctx());
    assert.strictEqual(res.statusCode, 202, `expected 202, got ${res.statusCode}`);
    const body = JSON.parse(res.body);
    assert.ok(body.jobId, 'no jobId returned');
    assert.strictEqual(body.requested, 10);
  });

  await test('the HTTP request performs ZERO Bedrock calls (this is the 503 fix)', async () => {
    reset();
    await handler(postEvent({ ...BASE, count: 40 }), ctx());
    assert.strictEqual(state.bedrockCalls.length, 0,
      `request path called Bedrock ${state.bedrockCalls.length} times; it must not touch the 30s gateway budget`);
  });

  await test('the worker is dispatched as an async Event invoke', async () => {
    reset();
    await handler(postEvent({ ...BASE, count: 5 }), ctx());
    assert.strictEqual(state.dispatched.length, 1);
    assert.strictEqual(state.dispatched[0].InvocationType, 'Event',
      'RequestResponse would put the 900s worker back inside the 30s request');
    assert.strictEqual(state.dispatched[0].payload.__workerMode, true);
  });

  await test('a failed self-invoke marks the job with a readable error', async () => {
    reset();
    state.lambdaShouldFail = true;
    const res = await handler(postEvent({ ...BASE, count: 5 }), ctx());
    assert.strictEqual(res.statusCode, 500);
    const { jobId } = JSON.parse(res.body);
    const polled = await handler({ requestContext: { http: { method: 'GET' } }, pathParameters: { jobId } }, ctx());
    const job = JSON.parse(polled.body);
    assert.strictEqual(job.status, 'error');
    assert.match(job.error, /Could not start generation worker/);
  });

  console.log('\nlong runs behave');

  await test('later passes are told what earlier passes produced', async () => {
    reset();
    let call = 0;
    state.bedrockHandler = () => { call += 1; return toolResponse(makeItems(8, `pass${call}`)); };
    await runJob({ ...BASE, count: 16 });
    assert.ok(state.bedrockCalls.length >= 2, 'expected more than one pass');
    assert.match(state.bedrockCalls[1].prompt, /ALREADY (GENERATED|ASKED)/,
      'parallel batches blind to each other is what produced duplicates');
    assert.match(state.bedrockCalls[1].prompt, /pass1/);
  });

  await test('truncation halves the pass instead of failing the job', async () => {
    reset();
    let call = 0;
    state.bedrockHandler = (n) => {
      call = n;
      if (n === 1) return toolResponse([], 'max_tokens');
      return toolResponse(makeItems(4, 'halved'));
    };
    const { job } = await runJob({ ...BASE, count: 8 });
    assert.ok(call >= 2, 'a truncated pass must be retried smaller, not surfaced as a parse error');
    assert.strictEqual(job.status, 'complete');
    assert.ok(job.warnings.some((w) => /output budget/.test(w)));
  });

  await test('a mid-run Bedrock failure keeps what was already generated', async () => {
    reset();
    state.bedrockHandler = (n) => {
      if (n === 1) return toolResponse(makeItems(8, 'kept'));
      throw new Error('Bedrock is having a day');
    };
    const { job } = await runJob({ ...BASE, count: 24 });
    assert.strictEqual(job.status, 'error');
    assert.strictEqual(job.items.length, 8, 'partial output and an explanation beats a bare error');
  });

  await test('the worker stops cleanly when the function is nearly out of time', async () => {
    reset();
    state.bedrockHandler = () => toolResponse(makeItems(8, 'rush'));
    const { job } = await runJob({ ...BASE, count: 40 }, ctx(5000));
    assert.strictEqual(job.status, 'complete', 'running out of time must not lose the run');
    assert.ok(job.warnings.some((w) => /time limit/.test(w)));
  });
```

Every suite ends with `summary();` instead of its own tally block.

---

### Task 3: Convert `ai-generate-trivia.js`

Also fixes the defect found during design: `TriviaAIBuilder.jsx:87` has always sent `numberOfCategories` and `mustHaveCategories`, and the handler has never read them.

**Files:**
- Modify: `lambda-functions/admin/ai-generate-trivia.js` (full rewrite, 200 → ~150 lines)
- Test: `tests/trivia-generation-job.js` (create)

**Interfaces:**
- Consumes: `makeGenerationHandler` (Task 2), `normalizeTags`, `tagGuidance`.
- Produces: item shape `{ id, active, title, questionDetail, category, answerDetails, school, optionA…optionF, correctAnswer, difficulty, tags }`. `correctAnswer` is an `OptionX` string, or an array of them when `numCorrect > 1`. This shape is what `AdminPage.generateTriviaCSV` consumes.

- [ ] **Step 1: Write the failing test**

First create `tests/helpers/generation-job-harness.js` exactly as given in the "Shared
test harness" section above — Tasks 4, 5 and 6 import it unchanged.

Then create `tests/trivia-generation-job.js`, opening with the standard preamble from
that section (handler `ai-generate-trivia.js`, function name
`engagedev-admin-ai-generate-trivia`), followed by the eight common cases and these
trivia-specific fixtures and cases:

```js
const { handler } = require(path.join(REPO, 'lambda-functions/admin/ai-generate-trivia.js'));

const TOPICS = [
  'photosynthesis', 'the Bretton Woods system', 'plate tectonics', 'the Silk Road',
  'antibiotic resistance', 'the Marshall Plan', 'binary search trees', 'the Doppler effect',
];

const makeTrivia = (n, prefix, extra = {}) =>
  Array.from({ length: n }, (_, i) => ({
    title: `${prefix} ${TOPICS[i % TOPICS.length]}`,
    questionDetail: `What is the significance of ${TOPICS[i % TOPICS.length]}?`,
    category: `Category ${(i % 3) + 1}`,
    answerDetails: 'Because of the reason given.',
    school: 'General Knowledge',
    optionA: 'First', optionB: 'Second', optionC: 'Third', optionD: 'Fourth',
    correctAnswer: 'OptionA',
    difficulty: 'medium',
    tags: ['Science', 'general knowledge'],
    ...extra,
  }));

const BASE = { topic: 'general science', difficulty: 'medium', numChoices: 4, numCorrect: 1 };

(async function run() {
  // ---- the eight common cases from the "Shared test harness" section ----

  console.log('\ntrivia keeps its own item shape');

  await test('correctAnswer stays an OptionX id, not the answer text', async () => {
    reset();
    state.bedrockHandler = () => toolResponse(makeTrivia(3, 'q'));
    const { job } = await runJob({ ...BASE, count: 3 });
    assert.strictEqual(job.items.length, 3);
    for (const item of job.items) {
      assert.match(item.correctAnswer, /^Option[A-F]$/, `correctAnswer must be an option id, got ${item.correctAnswer}`);
      assert.ok(item.questionDetail, 'questionDetail is what players actually see');
      assert.ok(item.optionA && item.optionD, 'four choices requested, four expected');
    }
  });

  await test('numCorrect > 1 produces an array of option ids', async () => {
    reset();
    state.bedrockHandler = () => toolResponse(makeTrivia(2, 'multi', { correctAnswer: ['OptionA', 'OptionC'] }));
    const { job } = await runJob({ ...BASE, count: 2, numCorrect: 2 });
    for (const item of job.items) {
      assert.ok(Array.isArray(item.correctAnswer), 'multi-answer trivia must keep an array');
      assert.deepStrictEqual(item.correctAnswer, ['OptionA', 'OptionC']);
    }
  });

  await test('the tool schema asks for exactly numChoices options', async () => {
    reset();
    state.bedrockHandler = () => toolResponse(makeTrivia(2, 'six', { optionE: 'Fifth', optionF: 'Sixth' }));
    await runJob({ ...BASE, count: 2, numChoices: 6 });
    const props = state.bedrockCalls[0].body.tools[0].input_schema.properties.items.items.properties;
    assert.ok(props.optionE && props.optionF, 'numChoices=6 must expose optionE/optionF');
    reset();
    state.bedrockHandler = () => toolResponse(makeTrivia(2, 'four'));
    await runJob({ ...BASE, count: 2, numChoices: 4 });
    const four = state.bedrockCalls[0].body.tools[0].input_schema.properties.items.items.properties;
    assert.ok(!four.optionE, 'numChoices=4 must NOT offer a fifth option');
  });

  console.log('\ncategory configuration is finally honoured');

  await test('numberOfCategories reaches the prompt (it never used to)', async () => {
    reset();
    state.bedrockHandler = () => toolResponse(makeTrivia(5, 'cat'));
    await runJob({ ...BASE, count: 5, numberOfCategories: 4, mustHaveCategories: 'Physics, Chemistry' });
    const prompt = state.bedrockCalls[0].prompt;
    assert.match(prompt, /EXACTLY 4 categories/, 'the trivia UI has always sent this and the handler always dropped it');
    assert.match(prompt, /Physics, Chemistry/);
  });

  await test('the category clamp uses the TOTAL, never the chunk size', async () => {
    reset();
    // One item per pass is the case that used to collapse the clamp to 1.
    state.bedrockHandler = () => toolResponse(makeTrivia(1, 'solo'));
    await runJob({ ...BASE, count: 1, numberOfCategories: 5 });
    const prompt = state.bedrockCalls[0].prompt;
    assert.match(prompt, /EXACTLY 1 categories/,
      'one item genuinely cannot span 5 categories — but the clamp must come from the total, not the chunk');

    reset();
    state.bedrockHandler = () => toolResponse(makeTrivia(20, 'many'));
    await runJob({ ...BASE, count: 20, numberOfCategories: 5 });
    assert.match(state.bedrockCalls[0].prompt, /EXACTLY 5 categories/,
      'a 20-item request must keep all 5 categories even though it is generated in passes');
  });

  console.log('\ntags');

  await test('tags are normalised onto every question', async () => {
    reset();
    state.bedrockHandler = () => toolResponse(makeTrivia(3, 'tagged'));
    const { job } = await runJob({ ...BASE, count: 3 });
    for (const item of job.items) {
      assert.deepStrictEqual(item.tags, ['science', 'general-knowledge'],
        'normalise on write: "Science" and "general knowledge" are stored canonical');
    }
  });

  await test('the prompt asks for tags', async () => {
    reset();
    state.bedrockHandler = () => toolResponse(makeTrivia(2, 'tp'));
    await runJob({ ...BASE, count: 2 });
    assert.match(state.bedrockCalls[0].prompt, /TAGS:/);
    assert.match(state.bedrockCalls[0].prompt, /kebab-case/);
  });

  summary();
})();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/trivia-generation-job.js 2>&1 | tail -5`
Expected: every case FAILs — the current handler returns 200 with `questions`, never 202, and calls Bedrock inside the request.

- [ ] **Step 3: Write the implementation**

Replace `lambda-functions/admin/ai-generate-trivia.js` entirely:

```js
/**
 * AI trivia generation — asynchronous, structured, tag-suggesting.
 *
 * THE BUG THIS REPLACES. Generation ran inside the HTTP request, and `RestApi`
 * is an AWS::Serverless::HttpApi whose 30s integration timeout is a hard
 * ceiling. The client worked around it by fanning out parallel three-question
 * batches, but every one of those calls raced the same wall clock, and each was
 * blind to the other batches — which is why duplicates appeared and why a
 * "Batch N of M: HTTP 503" could not be retried into success.
 *
 * Now: POST creates a job and returns 202, a self-invoked worker generates
 * against the full 900s, and the client polls. Passes run in sequence and each
 * one is told what the previous ones wrote, so duplicate avoidance is a
 * property of the prompt rather than a client-side filter.
 *
 * ALSO FIXED: numberOfCategories and mustHaveCategories. TriviaAIBuilder has
 * sent both on every request since it was written; this handler never
 * destructured them, so the category controls in the trivia UI have never done
 * anything at all.
 */

const { makeGenerationHandler } = require('./shared/generation-handler');
const { tagGuidance } = require('./shared/structured-generation');
const { normalizeTags } = require('./shared/tags');

const MAX_COUNT = 100;
const OPTION_KEYS = ['optionA', 'optionB', 'optionC', 'optionD', 'optionE', 'optionF'];

function parseRequest(payload) {
  const total = Math.min(Math.max(parseInt(payload.count, 10) || 1, 1), MAX_COUNT);
  const numChoices = Math.min(Math.max(parseInt(payload.numChoices, 10) || 4, 2), 6);
  const numCorrect = Math.min(Math.max(parseInt(payload.numCorrect, 10) || 1, 1), numChoices);
  // Clamp against the TOTAL, not the chunk. Clamping against a chunk is what
  // collapsed the scenario builder's category count to 1 on every pass.
  const categories = Math.min(parseInt(payload.numberOfCategories, 10) || 3, 24, Math.max(total, 1));
  return {
    total,
    config: {
      topic: payload.topic || 'general knowledge',
      category: payload.category || '',
      audience: payload.audience || '',
      difficulty: payload.difficulty || 'medium',
      customPrompt: payload.customPrompt || '',
      numChoices, numCorrect, categories,
      mustHaveCategories: payload.mustHaveCategories || '',
    },
  };
}

function buildTool(config) {
  const optionKeys = OPTION_KEYS.slice(0, config.numChoices);
  const optionProps = {};
  for (const key of optionKeys) {
    optionProps[key] = { type: 'string', description: `Answer choice ${key.slice(-1)}.` };
  }
  const correctAnswer = config.numCorrect > 1
    ? {
        type: 'array',
        items: { type: 'string', enum: optionKeys.map((k) => `Option${k.slice(-1)}`) },
        description: `Exactly ${config.numCorrect} correct option ids, e.g. ["OptionA","OptionC"].`,
      }
    : {
        type: 'string',
        enum: optionKeys.map((k) => `Option${k.slice(-1)}`),
        description: 'The correct option id, e.g. "OptionA". NOT the answer text.',
      };

  return {
    name: 'emit_items',
    description: 'Return the generated trivia questions as structured data.',
    input_schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          description: 'The generated trivia questions, in order.',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Short descriptive title for the question, 3-10 words.' },
              questionDetail: { type: 'string', description: 'The actual question text shown to players, 200 characters maximum.' },
              category: { type: 'string', description: 'The category this question belongs to. Use only the categories requested.' },
              ...optionProps,
              correctAnswer,
              answerDetails: { type: 'string', description: 'Why the correct answer is correct, 1-3 sentences, 300 characters maximum.' },
              school: { type: 'string', description: 'Broader subject area, e.g. "General Knowledge".' },
              difficulty: { type: 'string', enum: ['easy', 'medium', 'hard'], description: 'Difficulty of this question.' },
              tags: { type: 'array', items: { type: 'string' }, description: '3-6 lowercase kebab-case tags for filtering and search.' },
            },
            required: ['title', 'questionDetail', 'category', ...optionKeys, 'correctAnswer', 'answerDetails', 'difficulty', 'tags'],
          },
        },
      },
      required: ['items'],
    },
  };
}

function buildPrompt({ config, count, alreadyUsedTitles }) {
  let p = `You are an expert trivia question creator. Create ${count} trivia questions about ${config.topic}.`;
  if (config.category) p += `\nCategory: ${config.category}.`;
  if (config.audience) p += `\nTarget audience: ${config.audience}.`;
  p += `\nDifficulty level: ${config.difficulty}.`;
  p += `\nEach question has exactly ${config.numChoices} answer choices.`;
  if (config.numCorrect > 1) p += `\nEach question has exactly ${config.numCorrect} correct answers.`;
  if (config.customPrompt) p += `\n\nAdditional Requirements: ${config.customPrompt}`;

  p += `\n\nOrganize questions into EXACTLY ${config.categories} categories - no more, no less.`;
  if (config.mustHaveCategories) p += `\nMust include these categories: ${config.mustHaveCategories}`;

  if (alreadyUsedTitles.length > 0) {
    p += `\n\nALREADY GENERATED for this set — do not repeat, rephrase, or write a near-variant of any of these:\n`;
    p += alreadyUsedTitles.map((t) => `- ${t}`).join('\n');
  }

  p += [
    '',
    '',
    'LENGTH LIMITS (hard limits, not targets):',
    '- title: 3-10 words, a label for the question, not the question itself.',
    '- questionDetail: the question as asked, 200 characters maximum.',
    '- answerDetails: 1-3 sentences, 300 characters maximum.',
    '- each option: 60 characters maximum.',
    'Write only what the content needs; do not pad to reach a limit.',
    '',
    'The wrong answers must be plausible. An option nobody would pick is a wasted option.',
  ].join('\n');
  p += tagGuidance();
  p += `\n\nReturn the questions by calling the emit_items tool. Do not write prose.`;
  return p;
}

function normalizeItem(raw, config) {
  const title = String(raw?.title || '').trim();
  if (!title) return null;

  const optionKeys = OPTION_KEYS.slice(0, config.numChoices);
  const valid = new Set(optionKeys.map((k) => `Option${k.slice(-1)}`));

  // The model occasionally answers with the option TEXT instead of its id. Map
  // it back rather than dropping the question; an unmappable answer falls back
  // to OptionA, which is what the old handler did unconditionally.
  const toId = (value) => {
    const s = String(value || '').trim();
    if (valid.has(s)) return s;
    const match = optionKeys.find((k) => String(raw?.[k] || '').trim() === s);
    return match ? `Option${match.slice(-1)}` : null;
  };

  let correctAnswer;
  if (config.numCorrect > 1) {
    const list = (Array.isArray(raw?.correctAnswer) ? raw.correctAnswer : [raw?.correctAnswer])
      .map(toId).filter(Boolean);
    correctAnswer = list.length > 0 ? list : ['OptionA'];
  } else {
    const single = Array.isArray(raw?.correctAnswer) ? raw.correctAnswer[0] : raw?.correctAnswer;
    correctAnswer = toId(single) || 'OptionA';
  }

  const item = {
    id: Date.now() + Math.random(),
    active: true,
    title,
    questionDetail: String(raw?.questionDetail || title).trim(),
    category: String(raw?.category || config.category || 'General').trim(),
    answerDetails: String(raw?.answerDetails || '').trim(),
    school: String(raw?.school || 'General Knowledge').trim(),
    correctAnswer,
    difficulty: String(raw?.difficulty || config.difficulty || 'medium').trim(),
    tags: normalizeTags(raw?.tags),
  };
  // Always emit all six keys — generateTriviaCSV writes a fixed-width row.
  for (const key of OPTION_KEYS) {
    item[key] = optionKeys.includes(key) ? String(raw?.[key] || '').trim() : '';
  }
  return item;
}

exports.handler = makeGenerationHandler({
  kind: 'trivia',
  tokenKind: 'trivia',
  parseRequest,
  buildTool,
  buildPrompt,
  normalizeItem,
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/trivia-generation-job.js 2>&1 | tail -3`
Expected: `16 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add lambda-functions/admin/ai-generate-trivia.js tests/helpers/generation-job-harness.js tests/trivia-generation-job.js
git commit -m "$(cat <<'EOF'
✨ Trivia generation moves off the 30s gateway

POST now returns 202 + a jobId and a self-invoked worker generates
against the function's own 900s timeout. The client's parallel
three-question batches are gone: passes run in sequence and each is told
what the previous ones wrote, so duplicate avoidance is a property of the
prompt rather than a client-side filter applied after the fact.

Output moves from regex-scraped prose to tool use, with the option ids
declared as an enum — the old prompt had to beg "correctAnswer must be
the option ID, not the answer text" and the parser had no way to check.

Also fixes numberOfCategories/mustHaveCategories. TriviaAIBuilder has
sent both on every request since it was written and this handler never
destructured them, so the trivia category controls have never done
anything. Clamped against the total, not the chunk.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Convert `ai-generate-polls.js`

**Files:**
- Modify: `lambda-functions/admin/ai-generate-polls.js` (full rewrite, 182 → ~120 lines)
- Test: `tests/poll-generation-job.js` (create)

**Interfaces:**
- Consumes: `makeGenerationHandler` (Task 2).
- Produces: item shape `{ id, active, title, category, detail, school, customInstructions, options[], allowMultiple, tags }` — what `AdminPage.generatePollCSV` consumes.

- [ ] **Step 1: Write the failing test**

Create `tests/poll-generation-job.js`, opening with the standard preamble from the "Shared test harness" section (handler `ai-generate-polls.js`, function name `engagedev-admin-ai-generate-polls`), followed by the eight common cases and these poll-specific fixtures and cases:

```js
const SUBJECTS = [
  'hybrid work schedules', 'meeting-free Fridays', 'open plan offices', 'annual review cadence',
  'internal tooling budget', 'on-call compensation', 'team offsite formats', 'promotion transparency',
];

const makePolls = (n, prefix, extra = {}) =>
  Array.from({ length: n }, (_, i) => ({
    title: `${prefix} ${SUBJECTS[i % SUBJECTS.length]}`,
    category: `Category ${(i % 3) + 1}`,
    detail: 'Some background for the question.',
    school: 'General Context',
    customInstructions: 'Pick the option closest to your view.',
    options: ['Strongly agree', 'Agree', 'Neutral', 'Disagree'],
    allowMultiple: false,
    tags: ['Workplace', 'team culture'],
    ...extra,
  }));

const BASE = { topic: 'workplace preferences', difficulty: 'medium', allowMultiple: false };


  console.log('\npolls keep their own item shape');

  await test('options survive as an array and are never empty', async () => {
    reset();
    state.bedrockHandler = () => toolResponse(makePolls(3, 'p'));
    const { job } = await runJob({ ...BASE, count: 3 });
    for (const item of job.items) {
      assert.ok(Array.isArray(item.options), 'options must stay an array');
      assert.ok(item.options.length >= 2, 'a poll with fewer than two options is not a poll');
      assert.strictEqual(item.allowMultiple, false);
    }
  });

  await test('a poll returning too few options is dropped, not shipped broken', async () => {
    reset();
    state.bedrockHandler = () => toolResponse([
      ...makePolls(2, 'ok'),
      { ...makePolls(1, 'bad')[0], options: ['Only one'] },
    ]);
    const { job } = await runJob({ ...BASE, count: 3 });
    assert.ok(job.items.every((i) => i.options.length >= 2),
      'the old handler substituted ["Option 1","Option 2","Option 3"] and shipped a placeholder poll');
  });

  await test('allowMultiple is requested and preserved', async () => {
    reset();
    state.bedrockHandler = () => toolResponse(makePolls(2, 'multi', { allowMultiple: true }));
    const { job } = await runJob({ ...BASE, count: 2, allowMultiple: true });
    assert.match(state.bedrockCalls[0].prompt, /multiple selections/);
    assert.ok(job.items.every((i) => i.allowMultiple === true));
  });

  await test('allowMultiple stays false when the request did not ask for it', async () => {
    reset();
    state.bedrockHandler = () => toolResponse(makePolls(2, 'single', { allowMultiple: true }));
    const { job } = await runJob({ ...BASE, count: 2, allowMultiple: false });
    assert.ok(job.items.every((i) => i.allowMultiple === false),
      'a model volunteering multi-select must not override an explicit single-select request');
  });

  await test('tags are normalised onto every poll', async () => {
    reset();
    state.bedrockHandler = () => toolResponse(makePolls(3, 'tagged'));
    const { job } = await runJob({ ...BASE, count: 3 });
    for (const item of job.items) {
      assert.deepStrictEqual(item.tags, ['workplace', 'team-culture']);
    }
  });
```

Wrap the eight common cases and the ones above in `(async function run() { … summary(); })();`, exactly as Task 3 does.


- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/poll-generation-job.js 2>&1 | tail -5`
Expected: all cases FAIL; the current handler returns 200 with `questions`.

- [ ] **Step 3: Write the implementation**

Replace `lambda-functions/admin/ai-generate-polls.js`:

```js
/**
 * AI poll generation — asynchronous, structured, tag-suggesting.
 *
 * Same fix as trivia: generation ran inside the HTTP request against API
 * Gateway's hard 30s integration timeout, worked around with parallel batches
 * that each raced the same clock and were blind to each other. POST now returns
 * 202 + a jobId; a self-invoked worker generates against the full 900s.
 *
 * The old handler's option fallback is gone. When the model returned no usable
 * options it substituted ["Option 1","Option 2","Option 3"] and shipped that as
 * a poll — a placeholder that looks like content and reaches players. A poll
 * with fewer than two real options is now dropped, and the pass simply produces
 * one fewer item.
 */

const { makeGenerationHandler } = require('./shared/generation-handler');
const { tagGuidance } = require('./shared/structured-generation');
const { normalizeTags } = require('./shared/tags');

const MAX_COUNT = 100;
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 5;

function parseRequest(payload) {
  const total = Math.min(Math.max(parseInt(payload.count, 10) || 1, 1), MAX_COUNT);
  return {
    total,
    config: {
      topic: payload.topic || 'general topics',
      category: payload.category || '',
      audience: payload.audience || '',
      difficulty: payload.difficulty || 'medium',
      allowMultiple: payload.allowMultiple === true,
      customPrompt: payload.customPrompt || '',
    },
  };
}

function buildTool(config) {
  return {
    name: 'emit_items',
    description: 'Return the generated poll questions as structured data.',
    input_schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          description: 'The generated poll questions, in order.',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'The poll question itself, 3-20 words.' },
              category: { type: 'string', description: 'The category this poll belongs to.' },
              detail: { type: 'string', description: 'Background or context, 1-3 sentences, 300 characters maximum.' },
              school: { type: 'string', description: 'Broader subject area.' },
              customInstructions: { type: 'string', description: 'What the participant should do, one sentence.' },
              options: {
                type: 'array',
                items: { type: 'string' },
                minItems: MIN_OPTIONS,
                maxItems: MAX_OPTIONS,
                description: `${MIN_OPTIONS}-${MAX_OPTIONS} answer options, each 60 characters maximum. They must be genuinely distinct.`,
              },
              allowMultiple: {
                type: 'boolean',
                description: config.allowMultiple
                  ? 'True where picking several options is genuinely useful.'
                  : 'Always false for this set.',
              },
              tags: { type: 'array', items: { type: 'string' }, description: '3-6 lowercase kebab-case tags for filtering and search.' },
            },
            required: ['title', 'category', 'detail', 'customInstructions', 'options', 'allowMultiple', 'tags'],
          },
        },
      },
      required: ['items'],
    },
  };
}

function buildPrompt({ config, count, alreadyUsedTitles }) {
  let p = `You are an expert poll question creator. Create ${count} poll questions about ${config.topic}.`;
  if (config.category) p += `\nCategory: ${config.category}.`;
  if (config.audience) p += `\nTarget audience: ${config.audience}.`;
  p += `\nComplexity level: ${config.difficulty}.`;
  p += config.allowMultiple
    ? `\nSome questions should allow multiple selections where that genuinely helps.`
    : `\nEvery question is single-select. Set allowMultiple to false on all of them.`;
  if (config.customPrompt) p += `\n\nAdditional Requirements: ${config.customPrompt}`;

  if (alreadyUsedTitles.length > 0) {
    p += `\n\nALREADY GENERATED for this set — do not repeat, rephrase, or write a near-variant of any of these:\n`;
    p += alreadyUsedTitles.map((t) => `- ${t}`).join('\n');
  }

  p += [
    '',
    '',
    'LENGTH LIMITS (hard limits, not targets):',
    '- title: the question itself, 3-20 words.',
    '- detail: 1-3 sentences, 300 characters maximum.',
    '- customInstructions: one sentence.',
    `- options: ${MIN_OPTIONS}-${MAX_OPTIONS} of them, 60 characters each.`,
    'Write only what the content needs; do not pad to reach a limit.',
    '',
    'A poll measures opinion, so it has no correct answer. Options must cover the',
    'realistic range of views and must not overlap.',
  ].join('\n');
  p += tagGuidance();
  p += `\n\nReturn the questions by calling the emit_items tool. Do not write prose.`;
  return p;
}

function normalizeItem(raw, config) {
  const title = String(raw?.title || '').trim();
  if (!title) return null;

  const options = (Array.isArray(raw?.options) ? raw.options : [])
    .map((o) => String(o || '').trim())
    .filter(Boolean)
    .slice(0, MAX_OPTIONS);
  // A poll with one option is not a poll. Dropping it costs one item; the old
  // placeholder fallback cost a question set that looked complete and was not.
  if (options.length < MIN_OPTIONS) return null;

  return {
    id: Date.now() + Math.random(),
    active: true,
    title,
    category: String(raw?.category || config.category || 'General').trim(),
    detail: String(raw?.detail || '').trim(),
    school: String(raw?.school || 'General Context').trim(),
    customInstructions: String(raw?.customInstructions || '').trim(),
    options,
    // An explicit single-select request wins over a model that volunteers
    // multi-select.
    allowMultiple: config.allowMultiple ? raw?.allowMultiple === true : false,
    tags: normalizeTags(raw?.tags),
  };
}

exports.handler = makeGenerationHandler({
  kind: 'poll',
  tokenKind: 'poll',
  parseRequest,
  buildTool,
  buildPrompt,
  normalizeItem,
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/poll-generation-job.js 2>&1 | tail -3`
Expected: `15 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add lambda-functions/admin/ai-generate-polls.js tests/poll-generation-job.js
git commit -m "$(cat <<'EOF'
✨ Poll generation moves off the 30s gateway

Same conversion as trivia: 202 + jobId, self-invoked worker, sequential
passes that can see each other's titles, tool-use output instead of a
regex over prose.

Drops the option fallback. When the model returned nothing usable the old
handler substituted ["Option 1","Option 2","Option 3"] and shipped it as
a poll — placeholder text that looks like content and reaches players. A
poll with fewer than two real options is now dropped instead.

An explicit single-select request also now wins over a model that
volunteers allowMultiple: true.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Convert `ai-generate-questions.js`

This is the AIAssistant endpoint. It has two modes: bulk generation, and refining one existing question. Both go through the job.

**Files:**
- Modify: `lambda-functions/admin/ai-generate-questions.js` (full rewrite, 211 → ~160 lines)
- Test: `tests/question-generation-job.js` (create)

**Interfaces:**
- Consumes: `makeGenerationHandler` (Task 2), `normalizeGameType` from `shared/game-types.js`.
- Produces: item shape varies by `engagementType` — trivia adds `optionA`…`optionD`/`correctAnswer`/`answerDetails`/`difficulty`, poll adds `options[]`/`allowMultiple`, wavelength and call-and-answer carry the base `{ id, active, title, category, detail, school, customInstructions, tags }`.

- [ ] **Step 1: Write the failing test**

Create `tests/question-generation-job.js`, opening with the standard preamble from the "Shared test harness" section (handler `ai-generate-questions.js`, function name `engagedev-admin-ai-generate-questions`). Its BASE uses `questionCount`, not `count`, so substitute that in the eight common cases. Then add these question-specific fixtures and cases:

```js
const makeQuestions = (n, prefix, extra = {}) =>
  Array.from({ length: n }, (_, i) => ({
    title: `${prefix} ${['delegation', 'prioritisation', 'feedback', 'conflict', 'scoping', 'estimation'][i % 6]}`,
    category: `Category ${(i % 3) + 1}`,
    detail: 'A short scenario for discussion.',
    school: 'Business School',
    customInstructions: 'Discuss with your team.',
    tags: ['Leadership', 'team dynamics'],
    ...extra,
  }));

const BASE = { engagementType: 'call-and-answer', userInput: 'leadership scenarios for new managers' };


  console.log('\nthe item shape follows the engagement type');

  await test('trivia questions get options and an option-id answer', async () => {
    reset();
    state.bedrockHandler = () => toolResponse(makeQuestions(2, 'triv', {
      optionA: 'A', optionB: 'B', optionC: 'C', optionD: 'D',
      correctAnswer: 'OptionB', answerDetails: 'Because B.', difficulty: 'medium',
    }));
    const { job } = await runJob({ ...BASE, engagementType: 'trivia', questionCount: 2 });
    for (const item of job.items) {
      assert.match(item.correctAnswer, /^Option[A-D]$/);
      assert.ok(item.optionA && item.optionD);
      assert.ok(item.answerDetails);
    }
    const props = state.bedrockCalls[0].body.tools[0].input_schema.properties.items.items.properties;
    assert.ok(props.optionA, 'the trivia tool schema must expose options');
  });

  await test('poll questions get options, and the schema does NOT offer trivia fields', async () => {
    reset();
    state.bedrockHandler = () => toolResponse(makeQuestions(2, 'poll', { options: ['Yes', 'No', 'Unsure'] }));
    const { job } = await runJob({ ...BASE, engagementType: 'poll', questionCount: 2 });
    assert.ok(job.items.every((i) => Array.isArray(i.options) && i.options.length >= 2));
    const props = state.bedrockCalls[0].body.tools[0].input_schema.properties.items.items.properties;
    assert.ok(!props.correctAnswer, 'a poll has no correct answer; the schema must not invite one');
  });

  await test('wavelength gets subject-sized guidance, not scenario-sized', async () => {
    reset();
    state.bedrockHandler = () => toolResponse(makeQuestions(4, 'wave'));
    await runJob({ ...BASE, engagementType: 'wavelength', questionCount: 4 });
    assert.match(state.bedrockCalls[0].prompt, /1-4 words/,
      'a wavelength subject is a short phrase, not a question');
  });

  await test('game-type spellings are normalised, not string-compared', async () => {
    reset();
    state.bedrockHandler = () => toolResponse(makeQuestions(2, 'alias', {
      optionA: 'A', optionB: 'B', optionC: 'C', optionD: 'D', correctAnswer: 'OptionA',
    }));
    // Whatever legacy spelling the client sends must resolve to the same shape.
    const { job } = await runJob({ ...BASE, engagementType: 'Trivia', questionCount: 2 });
    assert.ok(job.items.every((i) => /^Option[A-D]$/.test(i.correctAnswer)),
      'comparing raw game-type strings is exactly what silently breaks these lookups');
  });

  console.log('\nrefining one existing question');

  await test('refine mode forwards the existing question into the prompt', async () => {
    reset();
    state.bedrockHandler = () => toolResponse(makeQuestions(1, 'refined'));
    const { job } = await runJob({
      ...BASE,
      questionCount: 1,
      existingQuestion: { title: 'Original title', category: 'Ops', detail: 'Original detail' },
      userInput: 'make it more concrete',
    });
    assert.strictEqual(job.items.length, 1, 'refine produces exactly one replacement');
    assert.match(state.bedrockCalls[0].prompt, /EXISTING QUESTION/);
    assert.match(state.bedrockCalls[0].prompt, /Original title/);
    assert.match(state.bedrockCalls[0].prompt, /make it more concrete/);
  });

  await test('refine mode ignores a count above one', async () => {
    reset();
    state.bedrockHandler = () => toolResponse(makeQuestions(5, 'many'));
    const { job } = await runJob({
      ...BASE, questionCount: 5,
      existingQuestion: { title: 'Original', category: 'Ops', detail: 'd' },
    });
    assert.strictEqual(job.items.length, 1, 'refining one question cannot produce five');
  });

  await test('refine mode never sends the ALREADY GENERATED block', async () => {
    reset();
    state.bedrockHandler = () => toolResponse(makeQuestions(1, 'r'));
    await runJob({
      ...BASE, questionCount: 1,
      existingQuestion: { title: 'Original', category: 'Ops', detail: 'd' },
    });
    assert.ok(!/ALREADY GENERATED/.test(state.bedrockCalls[0].prompt),
      'there is nothing to avoid when replacing a single question');
  });

  await test('tags are normalised onto every question', async () => {
    reset();
    state.bedrockHandler = () => toolResponse(makeQuestions(3, 'tagged'));
    const { job } = await runJob({ ...BASE, questionCount: 3 });
    for (const item of job.items) {
      assert.deepStrictEqual(item.tags, ['leadership', 'team-dynamics']);
    }
  });
```

Wrap the eight common cases and the ones above in `(async function run() { … summary(); })();`, exactly as Task 3 does.


- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/question-generation-job.js 2>&1 | tail -5`
Expected: all cases FAIL.

- [ ] **Step 3: Write the implementation**

Replace `lambda-functions/admin/ai-generate-questions.js`:

```js
/**
 * AI question generation (the AIAssistant endpoint) — asynchronous, structured.
 *
 * Same 30s-gateway fix as the other builders. This one had the worst token
 * budget of the four: max_tokens was `1000 + count * 700`, i.e. 1700 even at
 * count=1, and at the ~45 output tokens/sec this account measures from Sonnet
 * that is ~38 seconds of generation before the response exists — already past
 * API Gateway's ceiling at the smallest possible request.
 *
 * Two modes, both routed through the job so there is no synchronous path left
 * racing the ceiling:
 *   - bulk: generate `questionCount` new questions.
 *   - refine: rewrite ONE existing question from the user's feedback.
 *
 * Item shape follows the engagement type, resolved through normalizeGameType
 * rather than compared as a raw string — comparing raw game-type spellings is
 * exactly what has silently broken lookups elsewhere in this codebase.
 */

const { makeGenerationHandler } = require('./shared/generation-handler');
const { tagGuidance } = require('./shared/structured-generation');
const { normalizeTags } = require('./shared/tags');
const { normalizeGameType } = require('./shared/game-types');

const MAX_COUNT = 50;

function parseRequest(payload) {
  const existing = payload.existingQuestion || null;
  // Refining one question produces exactly one question, whatever was asked.
  const total = existing
    ? 1
    : Math.min(Math.max(parseInt(payload.questionCount, 10) || 1, 1), MAX_COUNT);
  return {
    total,
    config: {
      gameType: normalizeGameType(payload.engagementType),
      userInput: String(payload.userInput || '').trim(),
      existingQuestion: existing,
      context: payload.context || {},
    },
  };
}

const baseProps = {
  title: { type: 'string', description: 'The question or subject.' },
  category: { type: 'string', description: 'The category this question belongs to.' },
  detail: { type: 'string', description: 'Context or the scenario itself, 2-4 sentences, 350 characters maximum.' },
  school: { type: 'string', description: 'Broader subject area.' },
  customInstructions: { type: 'string', description: 'What the participant should do, 1-2 sentences.' },
  tags: { type: 'array', items: { type: 'string' }, description: '3-6 lowercase kebab-case tags for filtering and search.' },
};
const baseRequired = ['title', 'category', 'detail', 'customInstructions', 'tags'];

function buildTool(config) {
  let properties = { ...baseProps };
  let required = [...baseRequired];

  if (config.gameType === 'trivia') {
    properties = {
      ...properties,
      questionDetail: { type: 'string', description: 'The question text shown to players, 200 characters maximum.' },
      optionA: { type: 'string', description: 'Answer choice A.' },
      optionB: { type: 'string', description: 'Answer choice B.' },
      optionC: { type: 'string', description: 'Answer choice C.' },
      optionD: { type: 'string', description: 'Answer choice D.' },
      correctAnswer: {
        type: 'string',
        enum: ['OptionA', 'OptionB', 'OptionC', 'OptionD'],
        description: 'The correct option id. NOT the answer text.',
      },
      answerDetails: { type: 'string', description: 'Why the correct answer is correct, 1-3 sentences.' },
      difficulty: { type: 'string', enum: ['easy', 'medium', 'hard'], description: 'Difficulty of this question.' },
    };
    required = [...required, 'questionDetail', 'optionA', 'optionB', 'optionC', 'optionD', 'correctAnswer', 'answerDetails', 'difficulty'];
  } else if (config.gameType === 'poll') {
    properties = {
      ...properties,
      options: {
        type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 5,
        description: '2-5 genuinely distinct answer options, 60 characters each.',
      },
      allowMultiple: { type: 'boolean', description: 'True only where picking several options is genuinely useful.' },
    };
    required = [...required, 'options', 'allowMultiple'];
  }

  return {
    name: 'emit_items',
    description: 'Return the generated questions as structured data.',
    input_schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          description: 'The generated questions, in order.',
          items: { type: 'object', properties, required },
        },
      },
      required: ['items'],
    },
  };
}

function lengthGuidanceFor(gameType) {
  if (gameType === 'wavelength') {
    return [
      '',
      '',
      'LENGTH LIMITS (hard limits, not targets):',
      '- title: the subject, 1-4 words. Not a question and not a sentence.',
      '- detail: one short scenario introducing the subject, 200 characters maximum.',
      '- customInstructions: "What are the first 10 words you think of when you think of this word?"',
      '',
      'Wavelength is a word-association alignment game: every participant lists words',
      'for the subject and the game measures overlap. Do not write questions or',
      'anything with a correct answer.',
    ].join('\n');
  }
  return [
    '',
    '',
    'LENGTH LIMITS (hard limits, not targets):',
    '- title: 3-10 words. Do not use a colon to bolt a subtitle onto the title.',
    '- detail: 2-4 sentences, 350 characters maximum.',
    '- customInstructions: 1-2 sentences, 200 characters maximum.',
    'Write only what the content needs; do not pad to reach a limit.',
  ].join('\n');
}

function buildPrompt({ config, count, alreadyUsedTitles }) {
  const { gameType, existingQuestion, context, userInput } = config;
  let p = 'You are an expert educational content creator.\n\n';

  if (existingQuestion) {
    p += `Improve the following ${gameType} question based on the user's feedback.\n\n`;
    p += 'EXISTING QUESTION:\n';
    for (const [label, value] of [
      ['Title', existingQuestion.title],
      ['Category', existingQuestion.category],
      ['Detail', existingQuestion.detail],
      ['Correct Answer', existingQuestion.correctAnswer],
      ['Answer Explanation', existingQuestion.answerDetails],
    ]) {
      if (value) p += `${label}: ${value}\n`;
    }
    if (Array.isArray(existingQuestion.options) && existingQuestion.options.length > 0) {
      p += `Options: ${existingQuestion.options.join(', ')}\n`;
    }
    for (const key of ['optionA', 'optionB', 'optionC', 'optionD']) {
      if (existingQuestion[key]) p += `${key}: ${existingQuestion[key]}\n`;
    }
    p += `\nUSER FEEDBACK: ${userInput}\n`;
    p += '\nReturn exactly ONE improved question.';
  } else {
    p += `Create ${count} high-quality ${gameType} questions.\n\nREQUIREMENTS: ${userInput}\n`;
    if (context?.title) p += `Question Set Title: ${context.title}\n`;
    if (context?.description) p += `Description: ${context.description}\n`;
    if (context?.customInstructions) p += `Set Instructions: ${context.customInstructions}\n`;
    if (context?.aiContextInstructions) p += `Additional Context: ${context.aiContextInstructions}\n`;

    if (alreadyUsedTitles.length > 0) {
      p += `\nALREADY GENERATED for this set — do not repeat, rephrase, or write a near-variant of any of these:\n`;
      p += alreadyUsedTitles.map((t) => `- ${t}`).join('\n');
    }
  }

  p += lengthGuidanceFor(gameType);
  p += tagGuidance();
  p += `\n\nReturn the questions by calling the emit_items tool. Do not write prose.`;
  return p;
}

function normalizeItem(raw, config) {
  const title = String(raw?.title || '').trim();
  if (!title) return null;

  const item = {
    id: Date.now() + Math.random(),
    active: true,
    title,
    category: String(raw?.category || 'General').trim(),
    detail: String(raw?.detail || '').trim(),
    school: String(raw?.school || 'Business School').trim(),
    customInstructions: String(raw?.customInstructions || '').trim(),
    tags: normalizeTags(raw?.tags),
  };

  if (config.gameType === 'trivia') {
    const valid = new Set(['OptionA', 'OptionB', 'OptionC', 'OptionD']);
    const answer = String(raw?.correctAnswer || '').trim();
    item.questionDetail = String(raw?.questionDetail || title).trim();
    item.optionA = String(raw?.optionA || '').trim();
    item.optionB = String(raw?.optionB || '').trim();
    item.optionC = String(raw?.optionC || '').trim();
    item.optionD = String(raw?.optionD || '').trim();
    item.correctAnswer = valid.has(answer) ? answer : 'OptionA';
    item.answerDetails = String(raw?.answerDetails || '').trim();
    item.difficulty = String(raw?.difficulty || 'medium').trim();
  } else if (config.gameType === 'poll') {
    const options = (Array.isArray(raw?.options) ? raw.options : [])
      .map((o) => String(o || '').trim()).filter(Boolean).slice(0, 5);
    if (options.length < 2) return null;
    item.options = options;
    item.allowMultiple = raw?.allowMultiple === true;
  }

  return item;
}

exports.handler = makeGenerationHandler({
  kind: 'question',
  tokenKind: 'question',
  parseRequest,
  buildTool,
  buildPrompt,
  normalizeItem,
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/question-generation-job.js 2>&1 | tail -3`
Expected: `18 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add lambda-functions/admin/ai-generate-questions.js tests/question-generation-job.js
git commit -m "$(cat <<'EOF'
✨ Question generation moves off the 30s gateway

The AIAssistant endpoint had the worst token budget of the four:
max_tokens was 1000 + count * 700, so even a single question asked for
1700 tokens — roughly 38s at this account's measured Sonnet throughput,
already past API Gateway's 30s ceiling at the smallest possible request.
Shrinking the batch could never have helped.

Both modes now route through the job, including single-question refine,
so no synchronous path is left racing the ceiling.

Engagement type resolves through normalizeGameType instead of raw string
comparison, and the tool schema follows it: trivia gets options and an
enum'd option-id answer, polls get options with no correct answer, and
wavelength gets subject-sized guidance instead of scenario-sized.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Convert `ai-generate-survey.js` with the meta envelope

The survey endpoint is the most exposed of the four: a single un-chunked call for up to 50 questions, whose own source comments admit counts above ~10 risk the timeout.

**Files:**
- Modify: `lambda-functions/admin/ai-generate-survey.js` (full rewrite, 173 → ~150 lines)
- Test: `tests/survey-generation-job.js` (create)

**Interfaces:**
- Consumes: `makeGenerationHandler` with `extractMeta` (Task 2), `meta` support (Task 1).
- Produces: item shape `{ id, question, type, scale, options[], allowMultiple, textType, placeholder, required, tags }` and `meta` of `{ title, description }`. `SurveyAIBuilder` (Task 9) assembles the envelope from these.

- [ ] **Step 1: Write the failing test**

Create `tests/survey-generation-job.js`, opening with the standard preamble from the "Shared test harness" section (handler `ai-generate-survey.js`, function name `engagedev-admin-ai-generate-survey`). Its BASE uses `questionCount`, not `count`, so substitute that in the eight common cases. Then add these survey-specific fixtures and cases:

```js
const makeSurvey = (n, prefix, extra = {}) =>
  Array.from({ length: n }, (_, i) => ({
    question: `${prefix} how satisfied are you with ${['onboarding', 'tooling', 'communication', 'workload', 'growth', 'recognition'][i % 6]}?`,
    type: ['rating', 'multiple_choice', 'text_entry'][i % 3],
    scale: { type: '1-5', lowLabel: 'Low', highLabel: 'High' },
    options: ['Yes', 'No', 'Unsure'],
    allowMultiple: false,
    textType: 'short',
    placeholder: 'Your answer',
    required: true,
    tags: ['Employee Experience', 'onboarding'],
    ...extra,
  }));

// The harness's toolResponse takes tool-input extras as its third argument.
const toolResponseWithMeta = (items, meta = {}) => toolResponse(items, 'tool_use', meta);

const BASE = {
  title: 'Q3 Team Health Check',
  description: 'A short pulse survey.',
  topic: 'team health',
  audience: 'engineering',
  purpose: 'find friction',
  includeRating: true, includeMultipleChoice: true, includeTextEntry: true,
};


  console.log('\nsurvey keeps its own question shape');

  await test('question types, scales and text types survive', async () => {
    reset();
    state.bedrockHandler = () => toolResponseWithMeta(makeSurvey(6, 'q'));
    const { job } = await runJob({ ...BASE, questionCount: 6 });
    assert.strictEqual(job.items.length, 6);
    for (const item of job.items) {
      assert.ok(['rating', 'multiple_choice', 'text_entry'].includes(item.type));
      assert.ok(item.scale && item.scale.type, 'a rating question is useless without its scale');
      assert.ok(typeof item.required === 'boolean');
    }
  });

  await test('question ids are sequential from 1', async () => {
    reset();
    state.bedrockHandler = () => toolResponseWithMeta(makeSurvey(5, 'seq'));
    const { job } = await runJob({ ...BASE, questionCount: 5 });
    assert.deepStrictEqual(job.items.map((i) => i.id), [1, 2, 3, 4, 5],
      'SurveyAIBuilder renders by index; ids must not be timestamps');
  });

  await test('excluded question types are not requested', async () => {
    reset();
    state.bedrockHandler = () => toolResponseWithMeta(makeSurvey(3, 'norating'));
    await runJob({ ...BASE, questionCount: 3, includeRating: false });
    const prompt = state.bedrockCalls[0].prompt;
    assert.ok(!/rating scale questions/.test(prompt), 'a type the admin unticked must not be requested');
    assert.match(prompt, /multiple choice questions/);
  });

  console.log('\nthe AI may improve the survey framing');

  await test('an improved title and description reach the poll payload', async () => {
    reset();
    state.bedrockHandler = () => toolResponseWithMeta(makeSurvey(4, 'meta'), {
      surveyTitle: 'Q3 Engineering Health Pulse',
      surveyDescription: 'Twelve questions on tooling, workload and growth.',
    });
    const { job } = await runJob({ ...BASE, questionCount: 4 });
    assert.deepStrictEqual(job.meta, {
      title: 'Q3 Engineering Health Pulse',
      description: 'Twelve questions on tooling, workload and growth.',
    });
  });

  await test('framing is asked for on the FIRST pass only', async () => {
    reset();
    let call = 0;
    state.bedrockHandler = (n) => {
      call = n;
      return toolResponseWithMeta(makeSurvey(20, `pass${n}`), n === 1
        ? { surveyTitle: 'First', surveyDescription: 'First description' }
        : {});
    };
    const { job } = await runJob({ ...BASE, questionCount: 40 });
    assert.ok(call >= 2, 'expected more than one pass');
    assert.match(state.bedrockCalls[0].prompt, /surveyTitle/,
      'the first pass must be asked for the framing');
    assert.ok(!/surveyTitle/.test(state.bedrockCalls[1].prompt),
      're-deriving the framing per pass invites the model to contradict itself');
    assert.strictEqual(job.meta.title, 'First');
  });

  await test('no framing returned leaves meta null so the client falls back', async () => {
    reset();
    state.bedrockHandler = () => toolResponseWithMeta(makeSurvey(3, 'nometa'));
    const { job } = await runJob({ ...BASE, questionCount: 3 });
    assert.strictEqual(job.meta, null,
      'an improved title is an improvement, not a dependency');
  });

  await test('blank framing is treated as no framing', async () => {
    reset();
    state.bedrockHandler = () => toolResponseWithMeta(makeSurvey(3, 'blank'), {
      surveyTitle: '   ', surveyDescription: '',
    });
    const { job } = await runJob({ ...BASE, questionCount: 3 });
    assert.strictEqual(job.meta, null, 'a blank title must not overwrite the typed one');
  });

  await test('framing written on pass 1 survives a failure on pass 2', async () => {
    reset();
    state.bedrockHandler = (n) => {
      if (n === 1) return toolResponseWithMeta(makeSurvey(20, 'kept'), { surveyTitle: 'Survived', surveyDescription: 'd' });
      throw new Error('Bedrock is having a day');
    };
    const { job } = await runJob({ ...BASE, questionCount: 40 });
    assert.strictEqual(job.status, 'error');
    assert.strictEqual(job.meta.title, 'Survived');
    assert.strictEqual(job.items.length, 20);
  });

  await test('tags are normalised onto every survey question', async () => {
    reset();
    state.bedrockHandler = () => toolResponseWithMeta(makeSurvey(3, 'tagged'));
    const { job } = await runJob({ ...BASE, questionCount: 3 });
    for (const item of job.items) {
      assert.deepStrictEqual(item.tags, ['employee-experience', 'onboarding']);
    }
  });
```

Wrap the eight common cases and the ones above in `(async function run() { … summary(); })();`, exactly as Task 3 does.


- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/survey-generation-job.js 2>&1 | tail -5`
Expected: all cases FAIL.

- [ ] **Step 3: Write the implementation**

Replace `lambda-functions/admin/ai-generate-survey.js`:

```js
/**
 * AI survey generation — asynchronous, structured, tag-suggesting.
 *
 * This was the most exposed of the four builders. Unlike trivia and polls it
 * was never chunked at all: one call for up to 50 questions, against API
 * Gateway's hard 30s integration timeout. Its own source comment admitted that
 * counts above ~10 risked the ceiling and that fixing it "needs a design
 * change". This is that change.
 *
 * The survey is also the only builder whose result has a shape of its own — a
 * title and description wrapping the questions, which the model is allowed to
 * improve on. Job records store a flat `items` array, so the framing travels in
 * the job's optional `meta` (see shared/generation-jobs.js). It is asked for on
 * the FIRST pass only: re-deriving it per chunk invites the model to contradict
 * itself, and writing it immediately means it survives a later failure.
 *
 * If the model returns no framing, `meta` stays null and SurveyAIBuilder falls
 * back to whatever the admin typed. An improved title is an improvement, not a
 * dependency.
 */

const { makeGenerationHandler } = require('./shared/generation-handler');
const { tagGuidance } = require('./shared/structured-generation');
const { normalizeTags } = require('./shared/tags');

const MAX_COUNT = 50;
const QUESTION_TYPES = ['rating', 'multiple_choice', 'text_entry'];

/** Survey questions are numbered 1..n; SurveyAIBuilder renders by index. */
let sequence = 0;

function parseRequest(payload) {
  // Reset per job. A warm container would otherwise keep counting from the
  // previous run's last question and hand SurveyAIBuilder ids starting at 43.
  sequence = 0;
  const total = Math.min(Math.max(parseInt(payload.questionCount, 10) || 1, 1), MAX_COUNT);
  const types = [];
  if (payload.includeRating) types.push('rating');
  if (payload.includeMultipleChoice) types.push('multiple_choice');
  if (payload.includeTextEntry) types.push('text_entry');
  return {
    total,
    config: {
      title: String(payload.title || '').trim(),
      description: String(payload.description || '').trim(),
      topic: String(payload.topic || '').trim(),
      audience: String(payload.audience || '').trim(),
      purpose: String(payload.purpose || '').trim(),
      customPrompt: String(payload.customPrompt || '').trim(),
      // An admin who unticks every box gets all three rather than none.
      types: types.length > 0 ? types : QUESTION_TYPES,
    },
  };
}

function buildTool(config) {
  return {
    name: 'emit_items',
    description: 'Return the generated survey questions as structured data.',
    input_schema: {
      type: 'object',
      properties: {
        // Optional and first-pass only. Declared on every call because the tool
        // schema is built once per job; the PROMPT is what asks for it.
        surveyTitle: { type: 'string', description: 'An improved title for the survey as a whole. Omit unless it genuinely improves on the one given.' },
        surveyDescription: { type: 'string', description: 'An improved one-or-two sentence description of the survey as a whole.' },
        items: {
          type: 'array',
          description: 'The generated survey questions, in order.',
          items: {
            type: 'object',
            properties: {
              question: { type: 'string', description: 'The question text, 200 characters maximum.' },
              type: { type: 'string', enum: config.types, description: 'The question type. Use only the types listed.' },
              scale: {
                type: 'object',
                properties: {
                  type: { type: 'string', description: 'Scale range, e.g. "1-5" or "1-10".' },
                  lowLabel: { type: 'string', description: 'Label for the low end.' },
                  highLabel: { type: 'string', description: 'Label for the high end.' },
                },
                description: 'Required for rating questions; ignored otherwise.',
              },
              options: { type: 'array', items: { type: 'string' }, description: '2-6 options. Required for multiple_choice; empty otherwise.' },
              allowMultiple: { type: 'boolean', description: 'Multiple_choice only: may the respondent pick several?' },
              textType: { type: 'string', enum: ['short', 'long', 'email', 'number'], description: 'Text_entry only: the kind of input expected.' },
              placeholder: { type: 'string', description: 'Text_entry only: placeholder text.' },
              required: { type: 'boolean', description: 'Must the respondent answer this question?' },
              tags: { type: 'array', items: { type: 'string' }, description: '3-6 lowercase kebab-case tags for filtering and search.' },
            },
            required: ['question', 'type', 'required', 'tags'],
          },
        },
      },
      required: ['items'],
    },
  };
}

const TYPE_LABELS = {
  rating: 'rating scale questions (1-5, 1-10, etc.)',
  multiple_choice: 'multiple choice questions',
  text_entry: 'text entry questions (short and long form)',
};

function buildPrompt({ config, count, alreadyUsedTitles, isFirstPass }) {
  let p = `You are an expert survey designer. Create ${count} survey questions.`;
  if (config.title) p += `\nSurvey title: "${config.title}".`;
  if (config.topic) p += `\nTopic: ${config.topic}.`;
  if (config.description) p += `\nDescription: ${config.description}`;
  if (config.audience) p += `\nTarget audience: ${config.audience}.`;
  if (config.purpose) p += `\nPurpose: ${config.purpose}.`;
  p += `\n\nUse ONLY these question types: ${config.types.map((t) => TYPE_LABELS[t]).join(', ')}.`;
  if (config.customPrompt) p += `\n\nAdditional Requirements: ${config.customPrompt}`;

  if (alreadyUsedTitles.length > 0) {
    p += `\n\nALREADY ASKED in this survey — do not repeat or rephrase any of these:\n`;
    p += alreadyUsedTitles.map((t) => `- ${t}`).join('\n');
  }

  if (isFirstPass) {
    p += [
      '',
      '',
      'SURVEY FRAMING: you may also return surveyTitle and surveyDescription to',
      'improve the survey\'s own framing. Return them ONLY if they genuinely',
      'improve on what was given; omit them otherwise. Do not restate the topic.',
    ].join('\n');
  }

  p += [
    '',
    '',
    'LENGTH LIMITS (hard limits, not targets):',
    '- question: one question, 200 characters maximum. Ask one thing, not two.',
    '- options: 2-6 of them, 60 characters each, mutually exclusive.',
    '- placeholder: a short hint, 60 characters maximum.',
    'Write only what the content needs; do not pad to reach a limit.',
    '',
    'Avoid leading questions and double-barrelled questions. A rating question',
    'must carry a scale with labelled ends.',
  ].join('\n');
  p += tagGuidance();
  p += `\n\nReturn the questions by calling the emit_items tool. Do not write prose.`;
  return p;
}

function normalizeItem(raw, config) {
  const question = String(raw?.question || '').trim();
  if (!question) return null;

  const type = config.types.includes(raw?.type) ? raw.type : config.types[0];
  sequence += 1;

  return {
    id: sequence,
    question,
    type,
    scale: raw?.scale && typeof raw.scale === 'object'
      ? {
          type: String(raw.scale.type || '1-5').trim(),
          lowLabel: String(raw.scale.lowLabel || 'Low').trim(),
          highLabel: String(raw.scale.highLabel || 'High').trim(),
        }
      : { type: '1-5', lowLabel: 'Low', highLabel: 'High' },
    options: (Array.isArray(raw?.options) ? raw.options : [])
      .map((o) => String(o || '').trim()).filter(Boolean).slice(0, 6),
    allowMultiple: raw?.allowMultiple === true,
    textType: ['short', 'long', 'email', 'number'].includes(raw?.textType) ? raw.textType : 'short',
    placeholder: String(raw?.placeholder || '').trim(),
    required: raw?.required !== false,
    tags: normalizeTags(raw?.tags),
  };
}

/** First pass only; blanks are treated as "no improvement offered". */
function extractMeta(toolInput) {
  const title = String(toolInput?.surveyTitle || '').trim();
  const description = String(toolInput?.surveyDescription || '').trim();
  if (!title && !description) return null;
  const meta = {};
  if (title) meta.title = title;
  if (description) meta.description = description;
  return meta;
}

exports.handler = makeGenerationHandler({
  kind: 'survey',
  tokenKind: 'survey',
  parseRequest,
  buildTool,
  buildPrompt,
  normalizeItem,
  extractMeta,
  // The near-duplicate net keys on `question`, not `title`.
  titleOf: (item) => item?.question,
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/survey-generation-job.js 2>&1 | tail -3`
Expected: `17 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add lambda-functions/admin/ai-generate-survey.js tests/survey-generation-job.js
git commit -m "$(cat <<'EOF'
✨ Survey generation moves off the 30s gateway

The most exposed of the four: unlike trivia and polls it was never
chunked at all — one call for up to 50 questions against a 30s ceiling.
Its own source comment admitted counts above ~10 risked the timeout and
that fixing it "needs a design change". This is that change.

The survey is also the only builder whose result has a shape of its own,
so the AI-improved title and description travel in the job's optional
meta. Asked for on the first pass only, written immediately so it
survives a later failure, and omitted entirely when the model has no
improvement to offer — in which case the builder falls back to whatever
the admin typed.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Persist tags through CSV import

Tags generated by every builder — including scenarios, today — are discarded at upload. `upload-questions.js` has no tag handling at all.

**Files:**
- Modify: `lambda-functions/admin/upload-questions.js:257-320` (column mapping), `:365-400` (row parsing)
- Test: `tests/upload-questions-tags.js` (create)

**Interfaces:**
- Consumes: `normalizeTags` from `shared/tags.js`.
- Produces: each stored question gains `Tags: string[]` (PascalCase, matching `Title`/`Detail`/`Category`). Absent column ⇒ `Tags: []`.

- [ ] **Step 1: Write the failing test**

Create `tests/upload-questions-tags.js` using the same `Module._load` stub harness as `tests/scenario-generation-job.js:23-95`, stubbing DynamoDB only, then:

```js
const { handler } = require(path.join(REPO, 'lambda-functions/admin/upload-questions.js'));

const CSV_WITH_TAGS = [
  'Category,Question#,Title,Detail_lesson,School,CustomInstruction,Tags',
  '"Leadership","1","Handling a difficult escalation","Some detail.","Prof Dev","Discuss.","Leadership|remote work|CONFLICT"',
  '"Leadership","2","Running a retrospective","More detail.","Prof Dev","Discuss.","facilitation|leadership"',
].join('\n');

const CSV_WITHOUT_TAGS = [
  'Category,Question#,Title,Detail_lesson,School,CustomInstruction',
  '"Leadership","1","Handling a difficult escalation","Some detail.","Prof Dev","Discuss."',
].join('\n');

const upload = (fileContent, title) => handler({
  requestContext: { http: { method: 'POST' } },
  body: JSON.stringify({ fileName: `${title}.csv`, fileContent, customTitle: title }),
}, { functionName: 'engagedev-admin-upload-questions' });

(async function run() {
  console.log('\ntags survive CSV import');

  await test('a Tags column is parsed and normalised', async () => {
    reset();
    const res = await upload(CSV_WITH_TAGS, 'Tagged Set');
    assert.strictEqual(res.statusCode, 200, res.body);
    const stored = storedQuestions();
    assert.strictEqual(stored.length, 2);
    assert.deepStrictEqual(stored[0].Tags, ['leadership', 'remote-work', 'conflict'],
      'normalise on write: casing and spacing are canonicalised, "CONFLICT" becomes "conflict"');
    assert.deepStrictEqual(stored[1].Tags, ['facilitation', 'leadership']);
  });

  await test('a CSV with no Tags column still imports, with empty tags', async () => {
    reset();
    const res = await upload(CSV_WITHOUT_TAGS, 'Untagged Set');
    assert.strictEqual(res.statusCode, 200, res.body);
    const stored = storedQuestions();
    assert.strictEqual(stored.length, 1, 'every CSV that imported before must still import');
    assert.deepStrictEqual(stored[0].Tags, [], 'absent column means no tags, not undefined');
  });

  await test('the Tags column is found under common alternate spellings', async () => {
    reset();
    const alt = [
      'Category,Title,Detail_lesson,Keywords',
      '"Ops","Rotating on-call","Detail.","on-call|ops"',
    ].join('\n');
    const res = await upload(alt, 'Alt Set');
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.deepStrictEqual(storedQuestions()[0].Tags, ['on-call', 'ops']);
  });

  await test('junk tags normalise away rather than being stored', async () => {
    reset();
    const junk = [
      'Category,Title,Detail_lesson,Tags',
      '"Ops","Rotating on-call","Detail.","  |---|ops|ops"',
    ].join('\n');
    await upload(junk, 'Junk Set');
    assert.deepStrictEqual(storedQuestions()[0].Tags, ['ops'],
      'blanks and dash-only tokens normalise to nothing; duplicates collapse');
  });

  await test('the Tags column does not steal another column', async () => {
    reset();
    await upload(CSV_WITH_TAGS, 'Tagged Set');
    const first = storedQuestions()[0];
    assert.strictEqual(first.Title, 'Handling a difficult escalation');
    assert.strictEqual(first.Detail, 'Some detail.');
    assert.strictEqual(first.CustomInstructions, 'Discuss.',
      'the loose instruction fallback must not match "Tags"');
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
})();
```

`storedQuestions()` is a helper over the stubbed DynamoDB map: collect every `put`/`batchWrite` item whose `SK` starts with `QUESTION#`, sorted by `QuestionNumber`. Write it against whatever write commands `upload-questions.js` actually issues — read the file first and stub exactly those.

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/upload-questions-tags.js 2>&1 | tail -5`
Expected: the first, third and fourth cases FAIL with `Tags` undefined. The second may pass trivially (also `undefined`, not `[]`) — that is why it asserts `[]` explicitly.

- [ ] **Step 3: Write the implementation**

In `lambda-functions/admin/upload-questions.js`, add the require at the top with the other shared imports:

```js
const { normalizeTags } = require('./shared/tags');
```

In the column-mapping block, after `let imageIndex = getColumnIndex('Image');`:

```js
    // Optional Tags column. Every AI builder now suggests tags, and until this
    // existed they were displayed, edited and then silently dropped at import.
    let tagsIndex = getColumnIndex('Tags');
```

In the fallback block, after the `imageIndex` fallback:

```js
    // Tags / Keywords / Labels. Deliberately an EXACT-ish match rather than a
    // loose `includes` — a loose match on "tag" would also claim a column like
    // "Stage", and the instruction fallback below must not claim "Tags" either.
    if (tagsIndex === -1) tagsIndex = headers.findIndex(h => {
      const hl = h.toLowerCase().trim();
      return hl === 'tags' || hl === 'tag' || hl === 'keywords' || hl === 'labels';
    });
```

Verify the ordering: `customInstructionIndex`'s fallback is `h.toLowerCase().includes('instruction')`, which does not match `Tags`/`Keywords`, so no conflict. Add `tagsIndex` to the column-mapping log block:

```js
    console.log(`  Tags: ${tagsIndex >= 0 ? headers[tagsIndex] : 'NOT FOUND'} (index: ${tagsIndex})`);
```

In the row-parsing loop, alongside the other `cell(...)` extractions:

```js
        const tagsCell = cell(values, tagsIndex);
```

and in `baseQuestion`, after `CustomInstructions`:

```js
            // Pipe-separated, matching the Options column's convention.
            // normalizeTags also accepts a comma string, so a hand-edited CSV
            // using commas inside a quoted cell still works.
            Tags: normalizeTags(tagsCell.includes('|') ? tagsCell.split('|') : tagsCell),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/upload-questions-tags.js 2>&1 | tail -3`
Expected: `5 passed, 0 failed`

- [ ] **Step 5: Verify no import regression**

Run: `node tests/import-questions-flow.js 2>&1 | tail -3`
Expected: unchanged from baseline — the `Tags` column is additive and optional.

- [ ] **Step 6: Commit**

```bash
git add lambda-functions/admin/upload-questions.js tests/upload-questions-tags.js
git commit -m "$(cat <<'EOF'
✨ Tags survive CSV import

Every AI builder suggests tags and the scenarios builder has let you edit
them for a while, but upload-questions.js had no tag handling whatsoever
— `grep -i tag` returned nothing — so they were displayed, edited, and
then silently discarded at import.

The Tags column is optional and pipe-separated, matching the Options
column's existing convention. An absent header yields [], so every CSV
that imported before still imports identically. Values are normalised on
write through the shared vocabulary, because the stored data is not
consistently cased and raw string comparison silently matches nothing.

The Tags fallback matches exact spellings only: a loose `includes('tag')`
would also claim a column named "Stage".

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Write tags into the generated CSVs

Task 7 taught the importer to read tags. Nothing writes them yet.

**Files:**
- Modify: `src/src/AdminPage.jsx:614-637` (`generateScenariosCSV`), `:684-713` (`generateTriviaCSV`), `:760-790` (`generatePollCSV`)
- Modify: `src/src/BuilderPage.jsx:153-181` (`generateCSVContent`, all four branches)
- Modify: `src/src/components/TriviaAIBuilder.jsx:151` (`generateTriviaCSV`, the local-download variant)

**Interfaces:**
- Consumes: item `tags` arrays produced by Tasks 3-6.
- Produces: a trailing `Tags` column, `|`-joined, in every generated CSV — the format Task 7's parser reads.

- [ ] **Step 1: Add a shared serializer to `src/src/utils/tags.js`**

```js
/**
 * Tags → one CSV cell. Pipe-separated, matching the Options column's existing
 * convention in upload-questions.js. Normalising first guarantees kebab-case,
 * which is also why this is safe inside the naive `"${value}"` interpolation
 * the CSV generators use: a normalised tag cannot contain a quote or a comma.
 */
export const tagsToCsvCell = (tags) => normalizeTags(tags).join('|');
```

- [ ] **Step 2: Update the five generators**

In `src/src/AdminPage.jsx`, import it alongside the existing imports:

```js
import { tagsToCsvCell } from './utils/tags';
```

`generateScenariosCSV` — append to the header and the row:

```js
    const headers = 'Category,Question#,Title,Detail_lesson,School,CustomInstruction,Tags';
```
```js
        rows.push(`"${category}","${questionNumber}","${scenario.title}","${scenario.detail}","${scenario.school || 'Professional Development'}","${scenario.customInstructions || ''}","${tagsToCsvCell(scenario.tags)}"`);
```

`generateTriviaCSV`:

```js
    const headers = 'Category,Question#,Title,QuestionDetail,AnswerDetails,School,OptionA,OptionB,OptionC,OptionD,OptionE,OptionF,CorrectAnswer,Difficulty,Tags';
```
and append `,"${tagsToCsvCell(trivia.tags)}"` to the `rows.push(...)` template.

`generatePollCSV`:

```js
    const headers = 'Category,Question#,Title,Detail_lesson,School,CustomInstruction,Option1,Option2,Option3,Option4,Option5,AllowMultiple,Tags';
```
and append `,"${tagsToCsvCell(poll.tags)}"` to the `rows.push(...)` template.

In `src/src/BuilderPage.jsx`, import `tagsToCsvCell` from `./utils/tags` and append `,Tags` to all four `headers` strings and `,"${tagsToCsvCell(q.tags)}"` to all four row templates.

In `src/src/components/TriviaAIBuilder.jsx`, do the same for its local `generateTriviaCSV` download.

- [ ] **Step 3: Verify the round trip by hand**

Run:
```bash
node -e "
const { normalizeTags } = require('./lambda-functions/admin/shared/tags.js');
const cell = normalizeTags(['Leadership','remote work','CONFLICT']).join('|');
console.log('cell:', JSON.stringify(cell));
console.log('round trip:', normalizeTags(cell.split('|')));
"
```
Expected:
```
cell: "leadership|remote-work|conflict"
round trip: [ 'leadership', 'remote-work', 'conflict' ]
```

- [ ] **Step 4: Verify the frontend still builds**

Run: `cd src && npm run build 2>&1 | tail -20; cd ..`
Expected: compiles, 2 pre-existing size warnings, no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/src/utils/tags.js src/src/AdminPage.jsx src/src/BuilderPage.jsx src/src/components/TriviaAIBuilder.jsx
git commit -m "$(cat <<'EOF'
✨ Write tags into every generated CSV

Task 7 taught the importer to read a Tags column; this writes one. All
five CSV generators gain a trailing pipe-separated Tags cell.

Pipe-separated matches the Options column's existing convention, and
normalising before serialising guarantees kebab-case — which is also what
makes this safe inside the naive `"${value}"` interpolation these
generators use, since a normalised tag cannot contain a quote or comma.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Convert the four builder components

**Files:**
- Modify: `src/src/components/TriviaAIBuilder.jsx:32-116`, `src/src/components/PollAIBuilder.jsx:30-110`, `src/src/components/AIAssistant.jsx:15-104`, `src/src/components/SurveyAIBuilder.jsx:33-67`
- Modify: `src/src/utils/aiBatchClient.js` (delete the three dead exports)

**Interfaces:**
- Consumes: `startGenerationJob(url, payload, {label, onStatus}) => {jobId, requested}` and `pollGenerationJob(url, jobId, {label, onStatus, onProgress}) => job`, both already exported. `job` is `{jobId, status, phase, requested, completed, items, warnings, meta, error, updatedAt}`.
- Produces: unchanged `onTriviaGenerated` / `onPollGenerated` / `onQuestionsGenerated` / `onSurveyGenerated` payloads, so `AdminPage.jsx` and `BuilderPage.jsx` need no change.

- [ ] **Step 1: Replace `TriviaAIBuilder.handleConfigSubmit`**

Replace lines 32-116 with:

```js
  const handleConfigSubmit = async () => {
    setIsGenerating(true);
    setGenerationStatus('Starting generation...');
    setStep(2);

    // Generation runs as a background job. It cannot run inside the request:
    // API Gateway's 30s integration timeout is a hard ceiling and a full set
    // takes minutes, which is what produced the "HTTP 503 - retrying" loop.
    const endpoint = `${API_BASE}admin/ai-generate-trivia`;
    try {
      const { jobId } = await startGenerationJob(endpoint, {
        topic: triviaConfig.topic,
        audience: triviaConfig.audience,
        difficulty: triviaConfig.difficulty,
        count: triviaConfig.count,
        numChoices: triviaConfig.numChoices,
        numCorrect: triviaConfig.numCorrect,
        numberOfCategories: triviaConfig.numberOfCategories,
        mustHaveCategories: triviaConfig.mustHaveCategories,
        customPrompt: triviaConfig.customPrompt
      }, { label: 'Generation', onStatus: setGenerationStatus });

      const job = await pollGenerationJob(endpoint, jobId, {
        label: 'Generation',
        onStatus: setGenerationStatus,
        // Show questions as they land rather than a spinner for minutes.
        onProgress: (update) => {
          if (Array.isArray(update.items) && update.items.length > 0) {
            setGeneratedTrivia(update.items);
          }
        }
      });

      setGeneratedTrivia(job.items);
      setCurrentTriviaIndex(0);
      setGenerationStatus(
        job.warnings?.length
          ? `Generated ${job.items.length} trivia questions. ${job.warnings.join(' ')}`
          : `Generated ${job.items.length} trivia questions successfully`
      );
    } catch (error) {
      console.error('AI trivia generation error:', error);
      // A failed job still returns whatever it managed to generate.
      if (error.partialItems?.length) {
        setGeneratedTrivia(error.partialItems);
        setCurrentTriviaIndex(0);
      }
      setGenerationStatus(`Generation failed: ${error.message}`);
    } finally {
      setIsGenerating(false);
    }
  };
```

and change line 3 to:

```js
import { startGenerationJob, pollGenerationJob } from '../utils/aiBatchClient';
```

- [ ] **Step 2: Do the same for `PollAIBuilder` and `AIAssistant`**

`PollAIBuilder`: identical structure, endpoint `admin/ai-generate-polls`, payload `{topic, category, audience, difficulty, count, allowMultiple, customPrompt}`, state setters `setGeneratedPolls` / `setCurrentPollIndex`.

`AIAssistant`: endpoint `admin/ai-generate-questions`, payload:

```js
      const { jobId } = await startGenerationJob(endpoint, {
        engagementType,
        userInput: userInput.trim(),
        questionCount: isBulkGeneration ? bulkCount : 1,
        existingQuestion: isBulkGeneration ? null : questionSet.questions[questionIndex],
        context: {
          title: questionSet.title,
          description: questionSet.description,
          customInstructions: questionSet.customInstructions,
          aiContextInstructions: questionSet.aiContextInstructions
        }
      }, { label: 'Generation', onStatus: setGenerationStatus });
```

`AIAssistant` has no list state to stream into, so its `onProgress` reports counts only:

```js
        onProgress: (update) => {
          if (update.completed > 0) {
            setGenerationStatus(`Generated ${update.completed} of ${update.requested}...`);
          }
        }
```

and it calls `onQuestionsGenerated(job.items)` on success.

- [ ] **Step 3: Convert `SurveyAIBuilder`, rebuilding the envelope**

Replace lines 33-67 with:

```js
  const handleConfigSubmit = async () => {
    setIsGenerating(true);
    setGenerationStatus('Starting generation...');
    setStep(2);

    // Surveys used to be a single un-chunked call for up to 50 questions
    // against API Gateway's 30s ceiling. Now a background job, chunked.
    const endpoint = `${API_BASE}admin/ai-generate-survey`;

    // The job stores a flat item list; the survey's own framing travels in
    // `meta`. Prefer what the AI improved, fall back to what was typed.
    const assemble = (items, meta) => ({
      id: Date.now(),
      title: meta?.title || surveyConfig.title,
      description: meta?.description || surveyConfig.description,
      topic: surveyConfig.topic,
      audience: surveyConfig.audience,
      purpose: surveyConfig.purpose,
      createdAt: new Date().toISOString(),
      questions: items
    });

    try {
      const { jobId } = await startGenerationJob(endpoint, {
        title: surveyConfig.title,
        description: surveyConfig.description,
        topic: surveyConfig.topic,
        audience: surveyConfig.audience,
        purpose: surveyConfig.purpose,
        questionCount: surveyConfig.questionCount,
        includeRating: surveyConfig.includeRating,
        includeMultipleChoice: surveyConfig.includeMultipleChoice,
        includeTextEntry: surveyConfig.includeTextEntry,
        customPrompt: surveyConfig.customPrompt
      }, { label: 'Survey generation', onStatus: setGenerationStatus });

      const job = await pollGenerationJob(endpoint, jobId, {
        label: 'Survey generation',
        onStatus: setGenerationStatus,
        onProgress: (update) => {
          if (Array.isArray(update.items) && update.items.length > 0) {
            setGeneratedSurvey(assemble(update.items, update.meta));
          }
        }
      });

      setGeneratedSurvey(assemble(job.items, job.meta));
      setCurrentQuestionIndex(0);
      setGenerationStatus(
        job.warnings?.length
          ? `Generated survey with ${job.items.length} questions. ${job.warnings.join(' ')}`
          : `Generated survey with ${job.items.length} questions successfully`
      );
    } catch (error) {
      console.error('AI survey generation error:', error);
      if (error.partialItems?.length) {
        setGeneratedSurvey(assemble(error.partialItems, null));
        setCurrentQuestionIndex(0);
      }
      setGenerationStatus(`Generation failed: ${error.message}`);
    } finally {
      setIsGenerating(false);
    }
  };
```

and change line 3 to `import { startGenerationJob, pollGenerationJob } from '../utils/aiBatchClient';`.

- [ ] **Step 4: Add the tag editor to each builder**

Copy the pattern from `src/src/components/AIScenarioBuilder.jsx:930-965` into each builder's review step, bound to the current item. Each builder needs the `tagDraft` state that pattern relies on:

```js
  // Raw text of the tag field while it is being edited. null = not editing, so
  // the input falls back to the item's stored tags. Normalising on every
  // keystroke would eat the hyphen out of "remote-" as it is typed.
  const [tagDraft, setTagDraft] = useState(null);
```

and imports `import { normalizeTags } from '../utils/tags';`. On blur, commit with the builder's existing edit handler — `handleTriviaEdit(currentTriviaIndex, 'tags', normalizeTags(tagDraft))` and its equivalents.

- [ ] **Step 5: Delete the dead client helpers**

In `src/src/utils/aiBatchClient.js`, delete `planGenerationTopics` (lines 90-118), `dropNearDuplicates` and its `titleTokens` helper (lines 120-154), and `runWithConcurrency` (lines 240-256). Update the file's header comment, which still describes the batching strategy that no longer exists:

```js
// Shared client helpers for AI generation endpoints.
//
// Generation does NOT run inside the HTTP request. API Gateway's ~30s
// integration timeout is a hard ceiling and a full set takes minutes, so every
// builder POSTs to start a job, gets a 202 + jobId back, and polls. These
// helpers own the POST retry policy and the polling loop.
```

- [ ] **Step 6: Verify nothing still references the deleted helpers**

Run: `grep -rn "planGenerationTopics\|dropNearDuplicates\|runWithConcurrency\|postGenerationBatch" src/src/`
Expected: only `postGenerationBatch`, and only inside `aiBatchClient.js` itself (`startGenerationJob` uses it).

- [ ] **Step 7: Verify the build and the frontend test baseline**

Run: `cd src && npm run build 2>&1 | tail -20 && npx jest __tests__/ 2>&1 | tail -6; cd ..`
Expected: build compiles with the 2 pre-existing size warnings; Jest shows the unchanged baseline of 5 failed suites / 30 failed / 242 passed.

- [ ] **Step 8: Commit**

```bash
git add src/src/components/TriviaAIBuilder.jsx src/src/components/PollAIBuilder.jsx src/src/components/AIAssistant.jsx src/src/components/SurveyAIBuilder.jsx src/src/utils/aiBatchClient.js
git commit -m "$(cat <<'EOF'
✨ The four AI builders poll a job instead of fanning out batches

Each builder's CHUNK_SIZE / MAX_PARALLEL / runWithConcurrency block
collapses to startGenerationJob + pollGenerationJob. Partial results
stream into view as they land, so a multi-minute run no longer looks
identical to a hung one, and a failed job still shows whatever it managed
to generate rather than only an error.

SurveyAIBuilder rebuilds its envelope from the job's items plus the
optional meta, preferring the AI's improved title and description and
falling back to whatever was typed.

Deletes planGenerationTopics, dropNearDuplicates and runWithConcurrency.
Sequential passes that can see each other's titles are what the topic
planning round trip was approximating, and they do it without an extra
Bedrock call.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Template routes, dead backend code, full verification

**Files:**
- Modify: `template-clean.yaml` — the four function blocks at `:871` (Questions), `:975` (Trivia), `:1020` (Polls), `:1065` (Survey)
- Modify: `lambda-functions/admin/shared/bedrock-utils.js`

**Interfaces:**
- Consumes: everything above.
- Produces: deployable template. The owner deploys — do not.

- [ ] **Step 1: Add the poll route and self-invoke policy to each of the four functions**

For each function, add to its `Policies` list (after the Bedrock statement):

```yaml
        # Async generation: self-invoke worker (Event). Generation cannot run
        # inside the request — API Gateway's 30s integration timeout is a hard
        # ceiling. POST returns 202 and this invoke does the work against the
        # 900s function timeout.
        - Version: '2012-10-17'
          Statement:
            - Effect: Allow
              Action: lambda:InvokeFunction
              Resource: !Sub 'arn:aws:lambda:${AWS::Region}:${AWS::AccountId}:function:${StackName}-admin-ai-generate-trivia'
```

and to its `Events` map:

```yaml
        # Job status poll. The admin builders have no gameId and no WebSocket,
        # so results come back by polling rather than by broadcast.
        AdminAIGenerateTriviaStatusEvent:
          Type: HttpApi
          Properties:
            ApiId: !Ref RestApi
            Path: /admin/ai-generate-trivia/{jobId}
            Method: GET
            Auth:
              Authorizer: CognitoAuthorizer
```

Substitute per function — the ARN suffix, the event logical id and the path must each match that function's own name:

| Function | ARN suffix / path | Event logical id |
|---|---|---|
| `AdminAIGenerateTriviaFunction` | `ai-generate-trivia` | `AdminAIGenerateTriviaStatusEvent` |
| `AdminAIGeneratePollsFunction` | `ai-generate-polls` | `AdminAIGeneratePollsStatusEvent` |
| `AdminAIGenerateSurveyFunction` | `ai-generate-survey` | `AdminAIGenerateSurveyStatusEvent` |
| `AdminAIGenerateQuestionsFunction` | `ai-generate-questions` | `AdminAIGenerateQuestionsStatusEvent` |

A self-scoped ARN, not `'*'`: each function may invoke only itself. All four already have `Timeout: 900`, `MemorySize: 1024`, `DynamoDBCrudPolicy` and `TABLE_NAME`; `ACCOUNT_ID` comes from `Globals`.

- [ ] **Step 2: Validate the template**

Run: `sam validate --lint -t template-clean.yaml`
Expected: `template-clean.yaml is a valid SAM Template`

- [ ] **Step 3: Confirm all eight additions landed**

Run:
```bash
grep -c "lambda:InvokeFunction" template-clean.yaml
grep -n "{jobId}" template-clean.yaml
```
Expected: `lambda:InvokeFunction` count is 5 (scenarios + the four new); five `{jobId}` paths, one per builder.

- [ ] **Step 4: Delete the now-dead bedrock-utils exports**

Confirm first:

Run: `grep -rn "invokeClaudeWithRetry\|planTopicList\|buildTopicAssignmentText" lambda-functions/ tests/ | grep -v "shared/bedrock-utils.js"`
Expected: no output.

Then delete those three functions from `lambda-functions/admin/shared/bedrock-utils.js` and remove them from its `module.exports`. Keep `retryWithBackoff` — `structured-generation.js` uses it. Update the file's header comment if it describes the deleted helpers.

- [ ] **Step 5: Run the whole backend suite**

Run:
```bash
for t in tests/*.js; do case "$t" in *.spec.js) continue;; esac; node "$t"; done 2>&1 | grep -E '^[0-9]+ passed' | awk '{p+=$1; f+=$3; n++} END {print n" suites, "p" passed, "f" failed"}'
```
Expected: `24 suites, 0 failed`, with a total of at least 652 + 3 (Task 1) + 16 + 15 + 18 + 17 + 5 = 726 passing. **Any failure count above 0 blocks this task.**

- [ ] **Step 6: Confirm no host-redesign file was touched**

Run:
```bash
git diff --name-only dev...HEAD | grep -E "GameHostPage|host-redesign|anonymity|start-vote|vote-state-broadcast|anonymity-contract" || echo "clean — no host redesign files touched"
```
Expected: `clean — no host redesign files touched`

- [ ] **Step 7: Commit**

```bash
git add template-clean.yaml lambda-functions/admin/shared/bedrock-utils.js
git commit -m "$(cat <<'EOF'
🔧 Poll routes and self-invoke policies for the four AI builders

Each converted function gains GET /admin/ai-generate-<x>/{jobId} behind
the Cognito authorizer, and a lambda:InvokeFunction policy scoped to its
own ARN — each function may invoke only itself, never '*'.

Also deletes invokeClaudeWithRetry, planTopicList and
buildTopicAssignmentText from bedrock-utils. The four converted handlers
were their only callers; retryWithBackoff stays, since
structured-generation.js uses it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Post-implementation notes for the owner

Deployment is yours. When you do deploy:

1. The four functions gain a new IAM policy and a new route, so this is a `sam deploy`, not a code-only push.
2. Nothing here is a data migration. Job rows are new, TTL'd at 3 days, and written under `PK: 'AIJOBS'`.
3. Existing question sets are unaffected. `Tags` is additive — sets imported before this change simply have no `Tags` attribute, and `normalizeTags(undefined)` returns `[]` everywhere it is read.
4. Worth a smoke test in dev: generate 20 trivia questions and watch them stream in. Under the old code that was 7 parallel batches racing a 30s ceiling; it should now be a small number of sequential passes with visible progress.

## Follow-ups deliberately not done here

- **Migrate `ai-generate-scenarios.js` onto `makeGenerationHandler`.** It keeps its inline copy for now because it is proven, deployed, and its 33-test suite is what guards the factory. Worth doing once the four converted builders are proven in dev.
- **Consume tags in the question-set browse UI.** This change makes tags persist; nothing filters on them yet. `tagsMatch` in `shared/tags.js` already exists for it.
- **Naive CSV quoting.** A `"` in any field still breaks the row in every generator. Pre-existing and unrelated; the `Tags` column is kebab-case so it cannot make it worse.
