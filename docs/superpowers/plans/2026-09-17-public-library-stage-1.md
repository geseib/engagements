# Public Library — Stage 1 Implementation Plan (the pipeline made honest)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An org admin can submit a set for review from the console; a job checks everything publish will copy, publishes on pass in the same run, and the console shows "needs changes" with the exact questions, or "public v2" — with every review recorded.

**Architecture:** `check-question-set.js` becomes the AI builders' three-mode job handler (POST creates and self-invokes, GET polls tenant-scoped, `__workerMode` works). A new `shared/set-check-worker.js` builds a plaintext snapshot of the version, judges it through the guardrail via one `shared/publishable.js` definition of the published surface, writes the per-version `REVIEW` row, a `share` stamp on the org set row, an append-only review-log event, a queue pointer on escalation, and publishes from the snapshot through `shared/publish-set.js`. The console adds a "Who can see it" column, a share dialog (`05`) and the editor's needs-changes state (`06`).

**Tech Stack:** Node 22 Lambda (AWS SDK v3: lib-dynamodb, client-s3, client-bedrock-runtime, client-lambda), DynamoDB single table (no GSIs), S3, Bedrock Guardrails + Haiku, React 18 + jest/@testing-library, SAM template `template-clean.yaml`.

**Spec:** `docs/superpowers/specs/2026-09-17-public-library-moderation-design.md` — §0 (decisions D1–D14, what exists), §2 (lifecycle), §3.1–3.4 (rows), §4 (the check), §5.1–5.2 (publish/unpublish), §9 (routes), §10.1–10.3 (screens), §12 (testing). Stage 2+ (queue screen, decide, takedown, score card, reports, notices, access log) is NOT in this plan.

## Global Constraints

- **Never write a partition-key literal** for `SETS`/`GAMES`; keys come from `tenant.js` / `set-version.js` helpers (`tests/no-global-partition-literals.js`). The two new partitions (`MODERATION`, `REVIEWLOG#…`) are declared in their own modules, NOT in `tenant.js` — that file is triplicated across bundles with a drift guard and no runtime reader needs these partitions.
- **Do not modify** `lambda-functions/admin/shared/tenant.js`, `tenant-crypto.js`, `set-version.js`, or `question-set-access.js`. Everything here calls them.
- **No new request header** (CORS `AllowHeaders` untouched — `tests/cors-allows-sent-headers.js`).
- **`admins` is the platform group; customers are `hosts`; org role is a DynamoDB fact.** Submit/appeal require org role `admin`/`owner` via `tenant.canManageScope(event, tenant.ORG, orgId, 'admin')`.
- **A public copy never references an org Workie** (spec D5): the worker drops `promptId` unless it exists in the platform prompt partition.
- **Frontend design rules** (`.claude/skills/engage-design/SKILL.md`): one namespaced stylesheet per screen, tokens only, no hex outside the token block, `color: var(--danger)` never, nothing below 12px, rows 36px, every dialog has an X and a bottom exit through one `requestClose`, one `<Modal>`, no modal from a modal, `table-layout: fixed`. Palette tests are named `*Palette.test.js` (never `*Token*` — `.gitignore` hides it).
- **Copy rules** from the spec: escalated → *"Gone to a person at Engage. The outcome will show on this set's row."* (never "you'll hear back"); band words, never scores.
- **Every test is watched failing first.** Run the failing step before the implementing step; a green test never seen red proves nothing.
- **Baselines hold at every push.** Backend node suites (count AND pass count), frontend jest, `npm run lint` (0 errors, 11 known `exhaustive-deps` warnings), `npm run build` (2 known size warnings), `tests/template-validates.js`, `sam validate --template template-clean.yaml --region us-east-1 --lint`.
- **Worktree hygiene:** never `npm install` in this worktree (it prunes packages); packages resolve from the main checkout's `node_modules`. Judge suites by exit code AND suite count. Clear `.aws-sam` before `sam validate`.
- **Deploy rule:** a push to `dev` deploys dev. Tests and build first. Say which commit went where. Never run `./deployall` or `scripts/deploy-*.sh`.
- **Commit messages** end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

## File Structure

**Backend — new (`lambda-functions/admin/shared/` unless noted):**
| file | responsibility |
|---|---|
| `publishable.js` | the published surface of a set: which fields leave the org, the text the guardrail judges, the snapshot shape, the content hash |
| `review-log.js` | append-only review events per set, `PK=REVIEWLOG#<scope>#<orgId|->#<setId>` |
| `moderation-queue.js` | the pointer partition `PK=MODERATION`, stable SK, upsert/delete/list |
| `share-stamp.js` | the `share` map on the org set's METADATA row, written with `UpdateCommand` only |
| `check-quota.js` | per-org daily submit cap and guardrail-unit counter (`ORG#<org>` / `CHECKS#<yyyy-mm-dd>`) |
| `finding-explanations.js` | one Haiku sentence per flagged/escalated question, band-sentence fallback |
| `publish-set.js` | `publishSnapshot` (the one publish routine, used by the worker and by `POST /publish`) and `unpublishSet` (batched deletes) |
| `set-check-worker.js` | the worker: snapshot → S3 → guardrail → explanations → outcome rows → publish on pass |
| `lambda-functions/admin/appeal-question-set.js` | `POST /question-sets/{setId}/appeal` |
| `tests/helpers/moderation-harness.js` | the AWS stub harness (DynamoDB with conditions and updates, KMS, S3, Bedrock, Lambda) |

**Backend — modified:** `shared/set-review.js` (`beginCheck`, `abandonCheck`, `transitionReview`, `isUnfinished`), `shared/content-guardrail.js` (`checkQuestions` honours `q.text`, `onEach`, `budget`; new `checkText`), `check-question-set.js` (rewritten as the job handler), `publish-question-set.js` (uses `publish-set.js`), `get-set-versions.js` (`checkedAt`, `unfinished`, `reasons`, `published`), `get-question-sets.js` (`share`), `lambda-functions/auth/authorizer.js` (route regex), `template-clean.yaml` (routes, grants, env, lifecycle).

**Frontend — new (`src/src/`):** `utils/shareState.js`, `utils/checkJob.js`, `components/ShareSetDialog.jsx` + `.css` (scope `.share`), `components/SetReviewBanner.jsx` + `.css` (scope `.srev`).

**Frontend — modified:** `components/QuestionSetsPanel.jsx` + `.css` (visibility column, Share action), `components/QuestionSetEditor.jsx` (version chips, Share per version, banner mount, `onShare`/`onAppeal`), `components/QuestionsPanel.jsx` (`data-question-id`, `focusQuestionId`), `AdminPage.jsx` (dialog wiring, badge), `__tests__/scopedClassesDeclared.test.js` (two new surfaces).

---

### Task 0: Baselines and branch

**Files:** none changed.

- [ ] **Step 1: Confirm the worktree is on `origin/dev`'s history**

Run:
```bash
cd /Users/georgeseib/Documents/projects/engage2/.claude/worktrees/goofy-matsumoto-6f1713 && git fetch -q origin dev && git merge --ff-only origin/dev && git log -1 --oneline
```
Expected: a fast-forward (or "Already up to date") and the spec commit `0c81d0b8` (or later) at HEAD.

- [ ] **Step 2: Record the backend baseline**

Run:
```bash
rm -rf .aws-sam; n=0; p=0; for t in tests/*.js; do case "$t" in *.spec.js) continue;; esac; n=$((n+1)); out=$(node "$t" 2>&1); c=$(echo "$out" | grep -oE '^[0-9]+ passed' | tail -1 | grep -oE '^[0-9]+'); p=$((p+${c:-0})); echo "$out" | grep -qE '[1-9][0-9]* failed' && echo "FAILED: $t"; done; echo "suites=$n passed=$p"
```
Expected: `suites=<N> passed=<P>` and no `FAILED:` lines. Write the two numbers at the top of your working notes; every later push must show the same `N` or higher and `P` or higher, and zero `FAILED:`.

- [ ] **Step 3: Record the frontend baseline**

Run:
```bash
cd src && CI=true npx jest 2>&1 | grep -E '^(Tests|Test Suites):' && npm run lint 2>&1 | tail -3 && npm run build 2>&1 | grep -E 'warning|Compiled|Failed' | head -5; cd ..
```
Expected: `Test Suites: <S> passed`, `Tests: <T> passed`, lint `0 errors`, build compiled with the 2 known size warnings. Record `S` and `T`.

---

### Task 1: The moderation harness

**Files:**
- Create: `tests/helpers/moderation-harness.js`
- Test: `tests/moderation-harness.js`

**Interfaces:**
- Produces: `install()` (patches `Module._load` for the AWS SDKs — call BEFORE requiring any handler), `state` (`ddb: Map`, `s3: Map`, `guardrailReplies: []`, `haikuReplies: []`, `dispatched: []`, `sentGuardrail: []`, `sentHaiku: []`), `reset()`, `seedRow(item)`, `rowsWhere(fn)`, `test(name, fn)`, `summary()`, `orgEvent({orgId, role, method, setId, body, jobId, userId, username})`, `platformEvent({...})`, `ctx({functionName, remainingMs})`.

The stub must evaluate the three condition shapes this plan writes (`attribute_not_exists(#s) OR #s <> :checking OR checkedAt < :stale`; `#s = :from`; `#n < :cap`) and apply `SET`/`ADD`/`REMOVE` update expressions, because a harness that ignores conditions passes the lock test unconditionally.

- [ ] **Step 1: Write the failing self-test**

```js
// tests/moderation-harness.js
const path = require('path');
const assert = require('assert');
const H = require('./helpers/moderation-harness');
H.install();
const { PutCommand, UpdateCommand, QueryCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const db = DynamoDBDocumentClient.from({});

(async () => {
  console.log('\nmoderation harness\n');
  await H.test('a conditional put refuses when the condition is false', async () => {
    H.reset();
    await db.send(new PutCommand({ TableName: 't', Item: { PK: 'A', SK: 'REVIEW', status: 'checking', checkedAt: '2026-09-17T10:00:00.000Z' } }));
    let refused = null;
    try {
      await db.send(new PutCommand({
        TableName: 't', Item: { PK: 'A', SK: 'REVIEW', status: 'checking' },
        ConditionExpression: 'attribute_not_exists(#s) OR #s <> :checking OR checkedAt < :stale',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':checking': 'checking', ':stale': '2026-09-17T09:00:00.000Z' },
      }));
    } catch (e) { refused = e; }
    assert.ok(refused && refused.name === 'ConditionalCheckFailedException', 'the stale lock was not refused');
  });
  await H.test('the same put succeeds once the row is stale', async () => {
    H.reset();
    await db.send(new PutCommand({ TableName: 't', Item: { PK: 'A', SK: 'REVIEW', status: 'checking', checkedAt: '2026-09-17T08:00:00.000Z' } }));
    await db.send(new PutCommand({
      TableName: 't', Item: { PK: 'A', SK: 'REVIEW', status: 'checking', checkedAt: 'now' },
      ConditionExpression: 'attribute_not_exists(#s) OR #s <> :checking OR checkedAt < :stale',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':checking': 'checking', ':stale': '2026-09-17T09:00:00.000Z' },
    }));
    assert.strictEqual(H.state.ddb.get('A|REVIEW').checkedAt, 'now');
  });
  await H.test('SET and ADD update expressions apply, and a failed ADD condition throws', async () => {
    H.reset();
    await db.send(new UpdateCommand({
      TableName: 't', Key: { PK: 'ORG#o', SK: 'CHECKS#2026-09-17' },
      UpdateExpression: 'SET #share = :share ADD submits :one',
      ExpressionAttributeNames: { '#share': 'share' },
      ExpressionAttributeValues: { ':share': { status: 'checking' }, ':one': 1 },
    }));
    const row = H.state.ddb.get('ORG#o|CHECKS#2026-09-17');
    assert.deepStrictEqual(row.share, { status: 'checking' });
    assert.strictEqual(row.submits, 1);
    let refused = null;
    try {
      await db.send(new UpdateCommand({
        TableName: 't', Key: { PK: 'ORG#o', SK: 'CHECKS#2026-09-17' },
        UpdateExpression: 'ADD submits :one',
        ConditionExpression: 'attribute_not_exists(submits) OR submits < :cap',
        ExpressionAttributeValues: { ':one': 1, ':cap': 1 },
      }));
    } catch (e) { refused = e; }
    assert.ok(refused && refused.name === 'ConditionalCheckFailedException', 'the cap was not enforced');
  });
  await H.test('a query returns the partition, prefix-filtered, in SK order', async () => {
    H.reset();
    H.seedRow({ PK: 'MODERATION', SK: 'b', x: 1 });
    H.seedRow({ PK: 'MODERATION', SK: 'a', x: 2 });
    H.seedRow({ PK: 'OTHER', SK: 'a', x: 3 });
    const res = await db.send(new QueryCommand({
      TableName: 't', KeyConditionExpression: 'PK = :pk', ExpressionAttributeValues: { ':pk': 'MODERATION' },
    }));
    assert.deepStrictEqual(res.Items.map((i) => i.SK), ['a', 'b']);
  });
  await H.test('S3 put then get round-trips a string body', async () => {
    H.reset();
    const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
    const s3 = new S3Client({});
    await s3.send(new PutObjectCommand({ Bucket: 'b', Key: 'k', Body: '{"a":1}' }));
    const got = await s3.send(new GetObjectCommand({ Bucket: 'b', Key: 'k' }));
    assert.strictEqual(await got.Body.transformToString(), '{"a":1}');
  });
  H.summary();
})();
```

- [ ] **Step 2: Run it to see it fail**

Run: `node tests/moderation-harness.js`
Expected: `Cannot find module './helpers/moderation-harness'`.

- [ ] **Step 3: Write the harness**

```js
// tests/helpers/moderation-harness.js
/**
 * STUB HARNESS FOR THE MODERATION PIPELINE — check job, appeal, publish-from-
 * snapshot, and (later) the queue decisions.
 *
 * Why not reuse generation-job-harness.js: its DynamoDB stub knows Get/Put/
 * Update only and evaluates no conditions, and the whole point of the check
 * job's lock is a ConditionExpression. A harness that ignores conditions would
 * pass the lock test whether or not the lock existed.
 *
 * `install()` MUST run before the handler under test is required.
 */
const Module = require('module');
const path = require('path');
const REPO = path.join(__dirname, '..', '..');
const cryptoStub = require('./tenant-crypto-stub');

const state = {
  ddb: new Map(), s3: new Map(),
  guardrailReplies: [], sentGuardrail: [],
  haikuReplies: [], sentHaiku: [],
  dispatched: [], lambdaShouldFail: false,
  passed: 0, failed: 0,
};
const rowKey = (pk, sk) => `${pk}|${sk}`;
class Cmd { constructor(kind, input) { this.kind = kind; this.input = input; } }
class GetCommand extends Cmd { constructor(i) { super('get', i); } }
class PutCommand extends Cmd { constructor(i) { super('put', i); } }
class UpdateCommand extends Cmd { constructor(i) { super('update', i); } }
class DeleteCommand extends Cmd { constructor(i) { super('delete', i); } }
class QueryCommand extends Cmd { constructor(i) { super('query', i); } }
class BatchWriteCommand extends Cmd { constructor(i) { super('batchWrite', i); } }

const conditionFailed = () => Object.assign(new Error('The conditional request failed'), { name: 'ConditionalCheckFailedException' });
const resolveName = (token, names) => (names && names[token]) || token;
const resolveValue = (token, values) => (values && token in values ? values[token] : token);

/** One-level `A OR B OR C` / `A AND B`; clauses: attribute_(not_)exists, =, <>, <, <=, >, >=, IN. */
function evalCondition(expr, item, names, values) {
  const or = expr.split(/\s+OR\s+/);
  if (or.length > 1) return or.some((c) => evalCondition(c, item, names, values));
  const and = expr.split(/\s+AND\s+/);
  if (and.length > 1) return and.every((c) => evalCondition(c, item, names, values));
  const c = expr.trim().replace(/^\((.*)\)$/, '$1');
  let m;
  if ((m = /^attribute_not_exists\((.+)\)$/.exec(c))) return !item || !(resolveName(m[1], names) in item);
  if ((m = /^attribute_exists\((.+)\)$/.exec(c))) return Boolean(item) && resolveName(m[1], names) in item;
  if ((m = /^(\S+)\s+IN\s+\((.+)\)$/.exec(c))) {
    const v = item ? item[resolveName(m[1], names)] : undefined;
    return m[2].split(',').map((s) => resolveValue(s.trim(), values)).includes(v);
  }
  if ((m = /^(\S+)\s*(<>|<=|>=|=|<|>)\s*(\S+)$/.exec(c))) {
    const left = item ? item[resolveName(m[1], names)] : undefined;
    const right = resolveValue(m[3], values);
    if (left === undefined) return false;
    switch (m[2]) {
      case '=': return left === right; case '<>': return left !== right;
      case '<': return left < right; case '<=': return left <= right;
      case '>': return left > right; case '>=': return left >= right;
      default: return false;
    }
  }
  throw new Error(`moderation-harness: unsupported condition ${JSON.stringify(c)}`);
}

/** `SET a = :x, #n = :y ADD c :n REMOVE d` — each keyword section optional. */
function applyUpdate(item, input) {
  const expr = String(input.UpdateExpression);
  const names = input.ExpressionAttributeNames || {};
  const values = input.ExpressionAttributeValues || {};
  const sections = {};
  const re = /\b(SET|ADD|REMOVE)\b/g;
  const parts = expr.split(re).map((s) => s.trim()).filter(Boolean);
  for (let i = 0; i < parts.length; i += 2) sections[parts[i]] = parts[i + 1] || '';
  for (const assignment of (sections.SET || '').split(/,\s*/).filter(Boolean)) {
    const [lhs, rhs] = assignment.split(/\s*=\s*/);
    item[resolveName(lhs, names)] = resolveValue(rhs, values);
  }
  for (const add of (sections.ADD || '').split(/,\s*/).filter(Boolean)) {
    const [lhs, rhs] = add.trim().split(/\s+/);
    const k = resolveName(lhs, names);
    item[k] = (Number(item[k]) || 0) + Number(resolveValue(rhs, values));
  }
  for (const rem of (sections.REMOVE || '').split(/,\s*/).filter(Boolean)) delete item[resolveName(rem, names)];
}

const docClient = {
  send: async (cmd) => {
    const inp = cmd.input || {};
    switch (cmd.kind) {
      case 'get': { const it = state.ddb.get(rowKey(inp.Key.PK, inp.Key.SK)); return { Item: it ? JSON.parse(JSON.stringify(it)) : undefined }; }
      case 'put': {
        const k = rowKey(inp.Item.PK, inp.Item.SK);
        if (inp.ConditionExpression && !evalCondition(inp.ConditionExpression, state.ddb.get(k), inp.ExpressionAttributeNames, inp.ExpressionAttributeValues)) throw conditionFailed();
        state.ddb.set(k, JSON.parse(JSON.stringify(inp.Item))); return {};
      }
      case 'update': {
        const k = rowKey(inp.Key.PK, inp.Key.SK);
        const existing = state.ddb.get(k);
        if (inp.ConditionExpression && !evalCondition(inp.ConditionExpression, existing, inp.ExpressionAttributeNames, inp.ExpressionAttributeValues)) throw conditionFailed();
        const item = existing ? JSON.parse(JSON.stringify(existing)) : { ...inp.Key };
        applyUpdate(item, inp);
        state.ddb.set(k, item);
        return { Attributes: JSON.parse(JSON.stringify(item)) };
      }
      case 'delete': {
        const k = rowKey(inp.Key.PK, inp.Key.SK);
        if (inp.ConditionExpression && !evalCondition(inp.ConditionExpression, state.ddb.get(k), inp.ExpressionAttributeNames, inp.ExpressionAttributeValues)) throw conditionFailed();
        state.ddb.delete(k); return {};
      }
      case 'batchWrite': {
        for (const reqs of Object.values(inp.RequestItems || {})) {
          for (const r of reqs) {
            if (r.PutRequest) state.ddb.set(rowKey(r.PutRequest.Item.PK, r.PutRequest.Item.SK), JSON.parse(JSON.stringify(r.PutRequest.Item)));
            else if (r.DeleteRequest) state.ddb.delete(rowKey(r.DeleteRequest.Key.PK, r.DeleteRequest.Key.SK));
          }
        }
        return { UnprocessedItems: {} };
      }
      case 'query': {
        const v = inp.ExpressionAttributeValues || {};
        const pk = v[':pk']; const prefix = v[':sk'] || '';
        const items = [...state.ddb.values()]
          .filter((i) => i.PK === pk && String(i.SK).startsWith(String(prefix)))
          .sort((a, b) => (a.SK < b.SK ? -1 : a.SK > b.SK ? 1 : 0))
          .map((i) => JSON.parse(JSON.stringify(i)));
        if (inp.ScanIndexForward === false) items.reverse();
        return { Items: items, Count: items.length };
      }
      default: throw new Error(`moderation-harness: unexpected command ${cmd.kind}`);
    }
  },
};

class S3Client {
  async send(cmd) {
    const { Bucket, Key, Body } = cmd.input;
    const k = `${Bucket}/${Key}`;
    if (cmd.kind === 'putObject') { state.s3.set(k, String(Body)); return {}; }
    if (cmd.kind === 'getObject') {
      if (!state.s3.has(k)) throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' });
      const body = state.s3.get(k);
      return { Body: { transformToString: async () => body } };
    }
    if (cmd.kind === 'deleteObject') { state.s3.delete(k); return {}; }
    throw new Error(`moderation-harness: unexpected S3 command ${cmd.kind}`);
  }
}
class PutObjectCommand extends Cmd { constructor(i) { super('putObject', i); } }
class GetObjectCommand extends Cmd { constructor(i) { super('getObject', i); } }
class DeleteObjectCommand extends Cmd { constructor(i) { super('deleteObject', i); } }

class ApplyGuardrailCommand extends Cmd { constructor(i) { super('guardrail', i); } }
class InvokeModelCommand extends Cmd { constructor(i) { super('invokeModel', i); } }
class BedrockRuntimeClient {
  async send(cmd) {
    if (cmd.kind === 'guardrail') {
      state.sentGuardrail.push(cmd.input);
      const next = state.guardrailReplies.shift();
      if (next instanceof Error) throw next;
      return next || { action: 'NONE', assessments: [] };
    }
    if (cmd.kind === 'invokeModel') {
      state.sentHaiku.push(JSON.parse(Buffer.from(cmd.input.body).toString('utf8')));
      const next = state.haikuReplies.shift();
      if (next instanceof Error) throw next;
      const text = typeof next === 'string' ? next : 'Flagged for its treatment, not its subject.';
      return { body: new TextEncoder().encode(JSON.stringify({ content: [{ type: 'text', text }] })) };
    }
    throw new Error(`moderation-harness: unexpected Bedrock command ${cmd.kind}`);
  }
}
class InvokeCommand extends Cmd { constructor(i) { super('invoke', i); } }
class LambdaClient {
  async send(cmd) {
    if (state.lambdaShouldFail) throw new Error('AccessDeniedException');
    state.dispatched.push({
      FunctionName: cmd.input.FunctionName, InvocationType: cmd.input.InvocationType,
      payload: JSON.parse(Buffer.from(cmd.input.Payload).toString('utf8')),
    });
    return {};
  }
}

/** A guardrail reply that flags `category` at `band`. */
const guardrailHit = (category, band) => ({
  action: 'GUARDRAIL_INTERVENED',
  assessments: [{ contentPolicy: { filters: [{ type: category, confidence: band, action: 'BLOCKED' }] } }],
});
const guardrailClean = () => ({ action: 'NONE', assessments: [] });

function install() {
  process.env.TABLE_NAME = 'engage-test';
  process.env.AWS_REGION = 'us-east-1';
  process.env.ACCOUNT_ID = '000000000000';
  process.env.TENANT_KMS_KEY_ID = 'alias/test-tenant-key';
  process.env.CONTENT_GUARDRAIL_ID = 'gr-test';
  process.env.CONTENT_GUARDRAIL_VERSION = 'DRAFT';
  process.env.AI_PROMPTS_BUCKET = 'prompts-test';
  const kms = cryptoStub.makeKmsStub();
  const stubs = new Map([
    ['@aws-sdk/client-dynamodb', { DynamoDBClient: class {} }],
    ['@aws-sdk/lib-dynamodb', {
      DynamoDBDocumentClient: { from: () => docClient },
      GetCommand, PutCommand, UpdateCommand, DeleteCommand, QueryCommand, BatchWriteCommand,
    }],
    ['@aws-sdk/client-kms', kms.exports],
    ['@aws-sdk/client-s3', { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand }],
    ['@aws-sdk/client-bedrock-runtime', { BedrockRuntimeClient, ApplyGuardrailCommand, InvokeModelCommand }],
    ['@aws-sdk/client-lambda', { LambdaClient, InvokeCommand }],
  ]);
  const realLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (stubs.has(request)) return stubs.get(request);
    return realLoad.call(this, request, parent, isMain);
  };
  cryptoStub.installTestKeyLoader();
}
function reset() {
  state.ddb.clear(); state.s3.clear();
  state.guardrailReplies = []; state.sentGuardrail = [];
  state.haikuReplies = []; state.sentHaiku = [];
  state.dispatched = []; state.lambdaShouldFail = false;
  cryptoStub.forgetAllOrgs();
  cryptoStub.installTestKeyLoader();
}
const seedRow = (item) => state.ddb.set(rowKey(item.PK, item.SK), JSON.parse(JSON.stringify(item)));
const rowsWhere = (fn) => [...state.ddb.values()].filter(fn);

/** An authorised HTTP event from an org member. `role` defaults to owner. */
function orgEvent({
  orgId, role = 'owner', method = 'POST', setId = '', body, jobId, path: pathParams = {},
  userId = 'sub-amara', username = 'amara', groups = 'hosts',
} = {}) {
  return {
    requestContext: {
      http: { method },
      authorizer: { lambda: { username, userId, groups, status: 'enabled', orgId, orgRole: role, orgIds: orgId } },
    },
    pathParameters: { ...(setId ? { setId } : {}), ...(jobId ? { jobId } : {}), ...pathParams },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  };
}
/** Engage staff in platform mode: `admins`, no active org. */
function platformEvent({ method = 'GET', body, path: pathParams = {}, userId = 'sub-dai', username = 'dai' } = {}) {
  return {
    requestContext: {
      http: { method },
      authorizer: { lambda: { username, userId, groups: 'admins', status: 'enabled', orgId: '', orgRole: '' } },
    },
    pathParameters: pathParams,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  };
}
const ctx = ({ functionName = 'engagetest-check-question-set', remainingMs = 800000 } = {}) => ({
  functionName, getRemainingTimeInMillis: () => remainingMs,
});
async function test(name, fn) {
  try { await fn(); state.passed += 1; console.log(`  PASS  ${name}`); }
  catch (error) { state.failed += 1; console.log(`  FAIL  ${name}\n        ${error.message}`); }
}
function summary() {
  console.log(`\n${state.passed} passed, ${state.failed} failed\n`);
  if (state.failed > 0) process.exit(1);
}
module.exports = {
  REPO, state, install, reset, seedRow, rowsWhere, orgEvent, platformEvent, ctx, test, summary,
  guardrailHit, guardrailClean, plainRow: cryptoStub.plainRow, plainRowAuto: cryptoStub.plainRowAuto,
};
```

- [ ] **Step 4: Run the self-test**

Run: `node tests/moderation-harness.js`
Expected: `5 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add tests/helpers/moderation-harness.js tests/moderation-harness.js
git commit -m "A stub harness that evaluates conditions, for the moderation pipeline's suites

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `publishable.js` — what leaves the org when a set is published

**Files:**
- Create: `lambda-functions/admin/shared/publishable.js`
- Test: `tests/publishable-text.js`

**Interfaces:**
- Produces: `QUESTION_FIELDS`, `SET_FIELDS`, `questionText(row) → string`, `setText(meta, categories) → string`, `buildSnapshot({ source, version, meta, categories, questions, checkedAt }) → snapshot`, `contentHash(snapshot) → hex sha256`, `snapshotHasImages(snapshot) → boolean`, `stripKeys(row) → row without PK/SK`.
- A snapshot is `{ source: {scope, orgId, setId}, version, checkedAt, meta, categories: [{SK, ...}], questions: [{SK, ...}] }` — WHOLE plaintext rows (publish copies them), with `questionText`/`setText` reading only the judged fields.

- [ ] **Step 1: Write the failing test**

```js
// tests/publishable-text.js
const path = require('path');
const assert = require('assert');
const REPO = path.join(__dirname, '..');
const P = require(path.join(REPO, 'lambda-functions/admin/shared/publishable.js'));
let pass = 0; let fail = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); pass += 1; }
  catch (e) { console.log(`  FAIL  ${name}\n        ${e.message}`); fail += 1; }
}
const question = {
  PK: 'ORG#org_x#SET#s#v2', SK: 'QUESTION#q001', Title: 'Describe the injury', Detail: 'In detail.',
  AnswerDetails: 'The reveal', CustomInstructions: 'Be graphic', optionA: 'Alpha', optionB: 'Beta',
  options: ['one', 'two'], Category: 'c001', School: 'x', Image: '', Active: true, points: 10,
};
const meta = { PK: 'ORG#org_x#SETS', SK: 'SET#s', name: 'Safety', description: 'A rude description', customInstruction: 'ci', aiContextInstruction: 'ai', roundKindBrief: 'rkb', engagementType: 'trivia', promptId: 'p1' };
const categories = [{ PK: 'ORG#org_x#SET#s#v2', SK: 'CATEGORY#c001', Name: 'Injuries', QuestionCount: 1 }];
(async () => {
  console.log('\npublishable text\n');
  // rejects: judging title + body only, which is what shipped — the reveal,
  // the options and the per-question instruction never reached the guardrail.
  await check('questionText carries every judged field, including AnswerDetails with its real casing', () => {
    const t = P.questionText(question);
    for (const s of ['Describe the injury', 'In detail.', 'The reveal', 'Be graphic', 'Alpha', 'Beta', 'one', 'two']) {
      assert.ok(t.includes(s), `missing ${JSON.stringify(s)} in ${JSON.stringify(t)}`);
    }
    assert.ok(!t.includes('c001') && !t.includes('ORG#'), 'keys or ids leaked into the judged text');
  });
  await check('setText carries the set prose and every category name', () => {
    const t = P.setText(meta, categories);
    for (const s of ['Safety', 'A rude description', 'ci', 'ai', 'rkb', 'Injuries']) assert.ok(t.includes(s), `missing ${s}`);
    assert.ok(!t.includes('p1'), 'promptId is not judged text');
  });
  await check('a snapshot holds whole rows without partition keys, and the hash is stable and sensitive', () => {
    const snap = P.buildSnapshot({ source: { scope: 'org', orgId: 'org_x', setId: 's' }, version: 2, meta, categories, questions: [question], checkedAt: 'T' });
    assert.strictEqual(snap.questions[0].PK, undefined, 'PK carried into the snapshot');
    assert.strictEqual(snap.questions[0].SK, 'QUESTION#q001');
    assert.strictEqual(snap.questions[0].points, 10, 'a non-judged field publish needs was dropped');
    assert.strictEqual(snap.meta.PK, undefined);
    const h1 = P.contentHash(snap);
    const h2 = P.contentHash(P.buildSnapshot({ source: { scope: 'org', orgId: 'org_x', setId: 's' }, version: 2, meta, categories, questions: [question], checkedAt: 'LATER' }));
    assert.strictEqual(h1, h2, 'checkedAt changed the hash');
    const edited = { ...question, AnswerDetails: 'A different reveal' };
    const h3 = P.contentHash(P.buildSnapshot({ source: { scope: 'org', orgId: 'org_x', setId: 's' }, version: 2, meta, categories, questions: [edited], checkedAt: 'T' }));
    assert.notStrictEqual(h1, h3, 'an edited reveal did not change the hash');
    assert.match(h1, /^[0-9a-f]{64}$/);
  });
  await check('question order does not change the hash; question identity does', () => {
    const q2 = { ...question, SK: 'QUESTION#q002', Title: 'Second' };
    const a = P.contentHash(P.buildSnapshot({ source: { scope: 'org', orgId: 'o', setId: 's' }, version: 1, meta, categories, questions: [question, q2], checkedAt: 'T' }));
    const b = P.contentHash(P.buildSnapshot({ source: { scope: 'org', orgId: 'o', setId: 's' }, version: 1, meta, categories, questions: [q2, question], checkedAt: 'T' }));
    assert.strictEqual(a, b);
  });
  await check('snapshotHasImages is true only when a question carries an Image', () => {
    const none = P.buildSnapshot({ source: { scope: 'org', orgId: 'o', setId: 's' }, version: 1, meta, categories, questions: [question], checkedAt: 'T' });
    const some = P.buildSnapshot({ source: { scope: 'org', orgId: 'o', setId: 's' }, version: 1, meta, categories, questions: [{ ...question, Image: 'sets/s/q001.png' }], checkedAt: 'T' });
    assert.strictEqual(P.snapshotHasImages(none), false);
    assert.strictEqual(P.snapshotHasImages(some), true);
  });
  console.log(`\n${pass} passed, ${fail} failed\n`);
  if (fail) process.exit(1);
})();
```

- [ ] **Step 2: Run it to see it fail**

Run: `node tests/publishable-text.js`
Expected: `Cannot find module '.../shared/publishable.js'`.

- [ ] **Step 3: Write the module**

```js
// lambda-functions/admin/shared/publishable.js
/**
 * THE PUBLISHED SURFACE OF A SET — one definition, three readers.
 *
 * The check judges this, the record hashes this, and publish copies the rows
 * this is drawn from. Before this module the check read title + body only:
 * `answerDetails` was read off a row that stores `AnswerDetails`, so the reveal
 * never reached the guardrail, and options, per-question instructions, the set
 * prose and the category names shipped to the public library unjudged while
 * 05-share-review.html said "reads the whole set". Spec §4.1.
 *
 * A snapshot holds WHOLE plaintext rows (minus partition keys) because publish
 * copies whole rows; `questionText`/`setText` read only the fields a person
 * could see, so ids and keys are never sent to a model.
 */
const crypto = require('crypto');

/** Question fields a room can see. Case is the row's case. */
const QUESTION_FIELDS = Object.freeze([
  'Title', 'Detail', 'AnswerDetails', 'CustomInstructions',
  'optionA', 'optionB', 'optionC', 'optionD', 'optionE', 'optionF', 'options',
]);
/** The editable set prose (`edit-question-set.js` OPTIONAL_FIELDS that are text). */
const SET_FIELDS = Object.freeze([
  'name', 'description', 'customInstruction', 'aiContextInstruction', 'roundKindBrief',
]);

const asText = (v) => {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.map(asText).filter(Boolean).join('\n');
  if (typeof v === 'object') return '';
  return String(v).trim();
};

function questionText(row) {
  return QUESTION_FIELDS.map((f) => asText(row && row[f])).filter(Boolean).join('\n');
}
function setText(meta, categories = []) {
  const prose = SET_FIELDS.map((f) => asText(meta && meta[f]));
  const names = (categories || []).map((c) => asText(c && c.Name));
  return [...prose, ...names].filter(Boolean).join('\n');
}
function stripKeys(row) {
  if (!row || typeof row !== 'object') return row;
  const { PK, ...rest } = row; // eslint-disable-line no-unused-vars
  return rest;
}
const bySk = (a, b) => (a.SK < b.SK ? -1 : a.SK > b.SK ? 1 : 0);

function buildSnapshot({ source, version, meta, categories = [], questions = [], checkedAt }) {
  return {
    source: { scope: source.scope, orgId: source.orgId || '', setId: source.setId },
    version: version === undefined ? null : version,
    checkedAt: checkedAt || new Date().toISOString(),
    meta: stripKeys(meta),
    categories: categories.map(stripKeys).sort(bySk),
    questions: questions.map(stripKeys).sort(bySk),
  };
}
/** Deterministic JSON: keys sorted at every level. */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}
const pick = (row, fields) => Object.fromEntries(fields.filter((f) => row && f in row).map((f) => [f, row[f]]));

/** sha256 over the JUDGED surface, so an edit to a reveal changes it and a re-check date does not. */
function contentHash(snapshot) {
  const judged = {
    set: pick(snapshot.meta || {}, SET_FIELDS),
    categories: (snapshot.categories || []).map((c) => ({ SK: c.SK, Name: c.Name })).sort(bySk),
    questions: (snapshot.questions || []).map((q) => ({ SK: q.SK, ...pick(q, QUESTION_FIELDS) })).sort(bySk),
  };
  return crypto.createHash('sha256').update(canonical(judged)).digest('hex');
}
const snapshotHasImages = (snapshot) => (snapshot.questions || []).some((q) => asText(q.Image) !== '');

module.exports = {
  QUESTION_FIELDS, SET_FIELDS, questionText, setText, stripKeys, buildSnapshot, contentHash, snapshotHasImages, canonical,
};
```

- [ ] **Step 4: Run the test**

Run: `node tests/publishable-text.js`
Expected: `5 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add lambda-functions/admin/shared/publishable.js tests/publishable-text.js
git commit -m "One definition of what leaves the org when a set is published

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: `review-log.js` — every review is a record

**Files:**
- Create: `lambda-functions/admin/shared/review-log.js`
- Test: `tests/review-log.js`

**Interfaces:**
- Produces: `EVENTS` (frozen list), `reviewLogPk(ref) → 'REVIEWLOG#<scope>#<orgId|->#<setId>'`, `appendReviewEvent(db, tableName, ref, event, data = {}, { now } = {}) → item`, `readReviewLog(db, tableName, ref) → items oldest-first`.
- Rows: `PK = reviewLogPk(ref)`, `SK = <ISO>#<seq6>#<event>` where `seq` is a per-process counter so two events in one millisecond keep their order. No TTL.

- [ ] **Step 1: Write the failing test**

```js
// tests/review-log.js
const path = require('path');
const assert = require('assert');
const H = require('./helpers/moderation-harness');
H.install();
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const db = DynamoDBDocumentClient.from({});
const L = require(path.join(H.REPO, 'lambda-functions/admin/shared/review-log.js'));
const ORG = { scope: 'org', orgId: 'org_acme', setId: 'pricing' };
(async () => {
  console.log('\nreview log\n');
  await H.test('the partition names the set once per scope, and platform has no org segment', () => {
    assert.strictEqual(L.reviewLogPk(ORG), 'REVIEWLOG#org#org_acme#pricing');
    assert.strictEqual(L.reviewLogPk({ scope: 'platform', setId: 'lessons' }), 'REVIEWLOG#platform#-#lessons');
    assert.strictEqual(L.reviewLogPk({ scope: 'public', setId: 'orgacme-pricing' }), 'REVIEWLOG#public#-#orgacme-pricing');
  });
  await H.test('events append in order, even inside one millisecond, and read back oldest first', async () => {
    H.reset();
    const now = new Date('2026-09-17T10:00:00.000Z');
    await L.appendReviewEvent(db, 'engage-test', ORG, 'checked', { version: 2, outcome: 'escalated' }, { now });
    await L.appendReviewEvent(db, 'engage-test', ORG, 'escalated', { version: 2 }, { now });
    await L.appendReviewEvent(db, 'engage-test', ORG, 'decided', { version: 2, decision: 'approve' }, { now: new Date('2026-09-18T10:00:00.000Z') });
    const log = await L.readReviewLog(db, 'engage-test', ORG);
    assert.deepStrictEqual(log.map((e) => e.event), ['checked', 'escalated', 'decided']);
    assert.strictEqual(log[0].outcome, 'escalated');
    assert.strictEqual(log[0].ttl, undefined, 'the record must not expire');
  });
  await H.test('an unknown event name is refused rather than stored', async () => {
    H.reset();
    await assert.rejects(() => L.appendReviewEvent(db, 'engage-test', ORG, 'looked-at', {}), /refusing/);
  });
  H.summary();
})();
```

- [ ] **Step 2: Run it to see it fail**

Run: `node tests/review-log.js`
Expected: `Cannot find module '.../shared/review-log.js'`.

- [ ] **Step 3: Write the module**

```js
// lambda-functions/admin/shared/review-log.js
/**
 * EVERY REVIEW IS A RECORD — spec §3.4.
 *
 * The version's REVIEW row is the gate and is rewritten on every check; this
 * partition is the memory. Append-only, platform-owned, plaintext, no TTL. It
 * holds nothing an author has not already asked to make public, except a
 * reporter's own note.
 *
 * Declared HERE and not in tenant.js: that file is triplicated across the game,
 * websocket and admin bundles with a drift guard, and no runtime reader needs
 * this partition.
 */
const { PutCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');

const EVENTS = Object.freeze([
  'checked', 'escalated', 'appealed', 'decided', 'reported', 'taken-down',
  'unpublished', 'published', 'notice-set', 'notice-cleared', 'access',
]);
const clean = (v) => (typeof v === 'string' ? v.trim() : '');

function reviewLogPk(ref) {
  const scope = clean(ref && ref.scope) || 'platform';
  const orgId = scope === 'org' ? clean(ref && ref.orgId) : '';
  const setId = clean(ref && ref.setId);
  if (!setId) throw new Error('review-log: a set id is required');
  if (scope === 'org' && !orgId) throw new Error('review-log: scope "org" requires an orgId');
  return `REVIEWLOG#${scope}#${orgId || '-'}#${setId}`;
}
let seq = 0;
async function appendReviewEvent(db, tableName, ref, event, data = {}, { now = new Date() } = {}) {
  if (!EVENTS.includes(event)) throw new Error(`review-log: refusing to record event ${JSON.stringify(event)}`);
  seq = (seq + 1) % 1000000;
  const at = now.toISOString();
  const item = {
    PK: reviewLogPk(ref),
    SK: `${at}#${String(seq).padStart(6, '0')}#${event}`,
    event, at, ...data,
  };
  await db.send(new PutCommand({ TableName: tableName, Item: item }));
  return item;
}
async function readReviewLog(db, tableName, ref) {
  const items = [];
  let ExclusiveStartKey;
  do {
    const res = await db.send(new QueryCommand({ // eslint-disable-line no-await-in-loop
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': reviewLogPk(ref) },
      ExclusiveStartKey,
    }));
    items.push(...((res && res.Items) || []));
    ExclusiveStartKey = res && res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}
module.exports = { EVENTS, reviewLogPk, appendReviewEvent, readReviewLog };
```

- [ ] **Step 4: Run the test**

Run: `node tests/review-log.js`
Expected: `3 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add lambda-functions/admin/shared/review-log.js tests/review-log.js
git commit -m "An append-only review log per set, so a re-check loses nothing

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: `moderation-queue.js` — the pointer partition

**Files:**
- Create: `lambda-functions/admin/shared/moderation-queue.js`
- Test: `tests/moderation-queue.js`

**Interfaces:**
- Produces: `QUEUE_PK = 'MODERATION'`, `queueSk(ref, version) → '<orgId>#<setId>#v<n>' | 'PLATFORM#<setId>' | 'PUBLIC#<publicSetId>'`, `upsertQueueRow(db, tableName, { ref, version, reason, ...fields }, { now }) → item` (creates or bumps: `reasons` grows as a set, `latestAt` moves, `waitingSince` is kept from the first write), `deleteQueueRow(db, tableName, sk)`, `listQueue(db, tableName) → items oldest-first by waitingSince`.
- A row is a pointer (spec §3.2): title, org, counts, bands, `snapshotKey` — never question text.

- [ ] **Step 1: Write the failing test**

```js
// tests/moderation-queue.js
const path = require('path');
const assert = require('assert');
const H = require('./helpers/moderation-harness');
H.install();
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const db = DynamoDBDocumentClient.from({});
const Q = require(path.join(H.REPO, 'lambda-functions/admin/shared/moderation-queue.js'));
const ORG = { scope: 'org', orgId: 'org_acme', setId: 'pricing' };
(async () => {
  console.log('\nmoderation queue\n');
  await H.test('the SK is stable per set version and carries no timestamp', () => {
    assert.strictEqual(Q.queueSk(ORG, 2), 'org_acme#pricing#v2');
    assert.strictEqual(Q.queueSk({ scope: 'platform', setId: 'lessons' }), 'PLATFORM#lessons');
    assert.strictEqual(Q.queueSk({ scope: 'public', setId: 'orgacme-pricing' }), 'PUBLIC#orgacme-pricing');
  });
  await H.test('a repeat upsert bumps the row: reasons union, latestAt moves, waitingSince stays', async () => {
    H.reset();
    const t1 = new Date('2026-09-17T10:00:00.000Z'); const t2 = new Date('2026-09-18T10:00:00.000Z');
    await Q.upsertQueueRow(db, 'engage-test', { ref: ORG, version: 2, reason: 'escalated', title: 'Pricing', orgName: 'Acme', questionCount: 30, bands: { VIOLENCE: 'MEDIUM' } }, { now: t1 });
    await Q.upsertQueueRow(db, 'engage-test', { ref: ORG, version: 2, reason: 'appealed', appealMessage: 'It is a history set.' }, { now: t2 });
    const rows = H.rowsWhere((r) => r.PK === 'MODERATION');
    assert.strictEqual(rows.length, 1, 'a repeat made a second row');
    assert.deepStrictEqual([...rows[0].reasons].sort(), ['appealed', 'escalated']);
    assert.strictEqual(rows[0].waitingSince, t1.toISOString());
    assert.strictEqual(rows[0].latestAt, t2.toISOString());
    assert.strictEqual(rows[0].title, 'Pricing', 'a bump dropped the pointer fields');
    assert.strictEqual(rows[0].appealMessage, 'It is a history set.');
  });
  await H.test('listQueue returns oldest-waiting first and deleteQueueRow removes one', async () => {
    H.reset();
    await Q.upsertQueueRow(db, 'engage-test', { ref: { scope: 'org', orgId: 'org_b', setId: 'x' }, version: 1, reason: 'escalated', title: 'B' }, { now: new Date('2026-09-18T00:00:00.000Z') });
    await Q.upsertQueueRow(db, 'engage-test', { ref: ORG, version: 2, reason: 'escalated', title: 'A' }, { now: new Date('2026-09-17T00:00:00.000Z') });
    const list = await Q.listQueue(db, 'engage-test');
    assert.deepStrictEqual(list.map((r) => r.title), ['A', 'B']);
    await Q.deleteQueueRow(db, 'engage-test', Q.queueSk(ORG, 2));
    assert.strictEqual((await Q.listQueue(db, 'engage-test')).length, 1);
  });
  await H.test('a row never carries question text', async () => {
    H.reset();
    await Q.upsertQueueRow(db, 'engage-test', { ref: ORG, version: 2, reason: 'escalated', title: 'T', questions: [{ Title: 'secret' }], snapshot: { x: 1 } });
    const [row] = H.rowsWhere((r) => r.PK === 'MODERATION');
    assert.strictEqual(row.questions, undefined);
    assert.strictEqual(row.snapshot, undefined);
  });
  H.summary();
})();
```

- [ ] **Step 2: Run it to see it fail**

Run: `node tests/moderation-queue.js`
Expected: `Cannot find module '.../shared/moderation-queue.js'`.

- [ ] **Step 3: Write the module**

```js
// lambda-functions/admin/shared/moderation-queue.js
/**
 * THE QUEUE IS A POINTER PARTITION — spec §3.2, decision D4.
 *
 * The table has no GSIs, so "every version waiting for a person" cannot be
 * queried from the REVIEW rows. One small row per waiting item, found by a
 * Query on `PK = MODERATION`. The SK is STABLE (no timestamp) so a repeat
 * report or an appeal bumps the row instead of re-keying it; `waitingSince`
 * is an attribute and the list sorts in memory — at tens of rows that is free.
 *
 * No TTL: a queue row must not vanish. Only a decision deletes it.
 * NEVER question text: the snapshot lives in S3 (`snapshotKey`).
 */
const { GetCommand, PutCommand, DeleteCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');

const QUEUE_PK = 'MODERATION';
const REASONS = Object.freeze(['escalated', 'appealed', 'reported', 'declared', 'images']);
/** Fields a pointer may carry. Anything else — snapshots, questions — is refused by omission. */
const POINTER_FIELDS = Object.freeze([
  'orgId', 'orgName', 'setId', 'title', 'version', 'gameType', 'questionCount',
  'bands', 'uncertainQuestionIds', 'appealMessage', 'reports', 'snapshotKey', 'contentHash', 'publicSetId',
]);
const clean = (v) => (typeof v === 'string' ? v.trim() : '');

function queueSk(ref, version) {
  const scope = clean(ref && ref.scope) || 'platform';
  const setId = clean(ref && ref.setId);
  if (!setId) throw new Error('moderation-queue: a set id is required');
  if (scope === 'org') {
    const orgId = clean(ref && ref.orgId);
    if (!orgId) throw new Error('moderation-queue: scope "org" requires an orgId');
    const v = Number(version);
    return `${orgId}#${setId}#v${Number.isFinite(v) && v > 0 ? v : 0}`;
  }
  if (scope === 'public') return `PUBLIC#${setId}`;
  return `PLATFORM#${setId}`;
}
const queueKey = (sk) => ({ PK: QUEUE_PK, SK: sk });

async function upsertQueueRow(db, tableName, { ref, version, reason, ...fields }, { now = new Date() } = {}) {
  if (!REASONS.includes(reason)) throw new Error(`moderation-queue: refusing reason ${JSON.stringify(reason)}`);
  const sk = queueSk(ref, version);
  const existing = (await db.send(new GetCommand({ TableName: tableName, Key: queueKey(sk) }))).Item;
  const at = now.toISOString();
  const pointer = Object.fromEntries(POINTER_FIELDS.filter((f) => f in fields).map((f) => [f, fields[f]]));
  const item = {
    ...(existing || {}),
    ...pointer,
    ...queueKey(sk),
    scope: clean(ref.scope) || 'platform',
    setId: clean(ref.setId),
    ...(ref.scope === 'org' ? { orgId: clean(ref.orgId), version: Number(version) } : {}),
    reasons: [...new Set([...((existing && existing.reasons) || []), reason])],
    waitingSince: (existing && existing.waitingSince) || at,
    latestAt: at,
  };
  await db.send(new PutCommand({ TableName: tableName, Item: item }));
  return item;
}
async function deleteQueueRow(db, tableName, sk) {
  await db.send(new DeleteCommand({ TableName: tableName, Key: queueKey(sk) }));
}
async function listQueue(db, tableName) {
  const items = [];
  let ExclusiveStartKey;
  do {
    const res = await db.send(new QueryCommand({ // eslint-disable-line no-await-in-loop
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': QUEUE_PK },
      ExclusiveStartKey,
    }));
    items.push(...((res && res.Items) || []));
    ExclusiveStartKey = res && res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items.sort((a, b) => String(a.waitingSince).localeCompare(String(b.waitingSince)));
}
module.exports = { QUEUE_PK, REASONS, POINTER_FIELDS, queueSk, queueKey, upsertQueueRow, deleteQueueRow, listQueue };
```

- [ ] **Step 4: Run the test**

Run: `node tests/moderation-queue.js`
Expected: `4 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add lambda-functions/admin/shared/moderation-queue.js tests/moderation-queue.js
git commit -m "The moderation queue is a pointer partition with a stable key

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: `share-stamp.js` and `check-quota.js`

**Files:**
- Create: `lambda-functions/admin/shared/share-stamp.js`, `lambda-functions/admin/shared/check-quota.js`
- Test: `tests/share-stamp-and-quota.js`

**Interfaces:**
- `share-stamp.js` produces `SHARE_STATUSES` (`checking | passed | published | flagged | escalated | appealed | unpublished`), `writeShareStamp(db, tableName, sourceRef, stamp, { now }) → stamp` — `UpdateCommand SET #share = :share, updatedAt untouched`; the stamp is `{ version, status, at, publicSetId?, publicVersion?, note?, contentHash?, jobId? }` and REPLACES the map (one writer per event, no merge ambiguity). `readShareStamp(meta) → stamp | null`.
- `check-quota.js` produces `DEFAULT_DAILY_CAP = 20`, `reserveSubmit(db, tableName, orgId, { cap, now }) → { ok: true, submits } | { ok: false, cap }` (conditional ADD on `PK = ORG#<orgId>`, `SK = CHECKS#<yyyy-mm-dd>`), `recordUnits(db, tableName, orgId, units, { now })` (plain ADD on the same row).

- [ ] **Step 1: Write the failing test**

```js
// tests/share-stamp-and-quota.js
const path = require('path');
const assert = require('assert');
const H = require('./helpers/moderation-harness');
H.install();
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const db = DynamoDBDocumentClient.from({});
const S = require(path.join(H.REPO, 'lambda-functions/admin/shared/share-stamp.js'));
const K = require(path.join(H.REPO, 'lambda-functions/admin/shared/check-quota.js'));
const ORG = { scope: 'org', orgId: 'org_acme', setId: 'pricing' };
(async () => {
  console.log('\nshare stamp and check quota\n');
  await H.test('the stamp is written by UpdateCommand onto the metadata row and touches nothing else', async () => {
    H.reset();
    H.seedRow({ PK: 'ORG#org_acme#SETS', SK: 'SET#pricing', name: { iv: 'x', ct: 'y', tag: 'z' }, activeVersion: 2 });
    await S.writeShareStamp(db, 'engage-test', ORG, { version: 2, status: 'checking', jobId: 'j1' }, { now: new Date('2026-09-17T10:00:00.000Z') });
    const row = H.state.ddb.get('ORG#org_acme#SETS|SET#pricing');
    assert.deepStrictEqual(row.share, { version: 2, status: 'checking', jobId: 'j1', at: '2026-09-17T10:00:00.000Z' });
    assert.deepStrictEqual(row.name, { iv: 'x', ct: 'y', tag: 'z' }, 'the ciphertext name was rewritten');
    assert.strictEqual(row.activeVersion, 2);
  });
  await H.test('a later stamp replaces the map rather than merging stale fields into it', async () => {
    H.reset();
    H.seedRow({ PK: 'ORG#org_acme#SETS', SK: 'SET#pricing' });
    await S.writeShareStamp(db, 'engage-test', ORG, { version: 2, status: 'published', publicSetId: 'orgacme-pricing', publicVersion: 1 });
    await S.writeShareStamp(db, 'engage-test', ORG, { version: 3, status: 'flagged' });
    const row = H.state.ddb.get('ORG#org_acme#SETS|SET#pricing');
    assert.strictEqual(row.share.publicSetId, undefined, 'a flagged v3 still claimed a public id');
    assert.strictEqual(row.share.status, 'flagged');
  });
  await H.test('an unknown status is refused', async () => {
    H.reset();
    await assert.rejects(() => S.writeShareStamp(db, 'engage-test', ORG, { version: 1, status: 'live' }), /refusing/);
  });
  await H.test('the daily cap admits `cap` submits and refuses the next', async () => {
    H.reset();
    const now = new Date('2026-09-17T10:00:00.000Z');
    for (let i = 1; i <= 3; i += 1) {
      const r = await K.reserveSubmit(db, 'engage-test', 'org_acme', { cap: 3, now }); // eslint-disable-line no-await-in-loop
      assert.deepStrictEqual(r, { ok: true, submits: i });
    }
    assert.deepStrictEqual(await K.reserveSubmit(db, 'engage-test', 'org_acme', { cap: 3, now }), { ok: false, cap: 3 });
    const nextDay = await K.reserveSubmit(db, 'engage-test', 'org_acme', { cap: 3, now: new Date('2026-09-18T00:00:01.000Z') });
    assert.deepStrictEqual(nextDay, { ok: true, submits: 1 }, 'the cap did not reset with the UTC day');
    assert.ok(H.state.ddb.has('ORG#org_acme|CHECKS#2026-09-17'), 'the counter is not on the org partition');
  });
  await H.test('units accumulate on the same day row', async () => {
    H.reset();
    const now = new Date('2026-09-17T10:00:00.000Z');
    await K.reserveSubmit(db, 'engage-test', 'org_acme', { cap: 20, now });
    await K.recordUnits(db, 'engage-test', 'org_acme', 31, { now });
    await K.recordUnits(db, 'engage-test', 'org_acme', 2, { now });
    assert.strictEqual(H.state.ddb.get('ORG#org_acme|CHECKS#2026-09-17').units, 33);
  });
  H.summary();
})();
```

- [ ] **Step 2: Run it to see it fail**

Run: `node tests/share-stamp-and-quota.js`
Expected: `Cannot find module '.../shared/share-stamp.js'`.

- [ ] **Step 3: Write both modules**

```js
// lambda-functions/admin/shared/share-stamp.js
/**
 * THE `share` STAMP ON THE ORG SET'S METADATA ROW — spec §3.1.
 *
 * The list's cache: "Who can see it" reads this and nothing else, so the list
 * is not one REVIEW read per version per set. The per-version REVIEW row stays
 * the gate and the PUBLISHED row stays the Versions panel's fact.
 *
 * Written with UpdateCommand on the ONE attribute, never by a read-modify-write
 * Put of the row: the row's other fields are ciphertext under the org's key,
 * and a platform-mode caller (takedown, later) must be able to write this
 * without holding that key and without touching anything else.
 *
 * The map is REPLACED, not merged. Each writer knows the whole truth of the
 * moment it writes; a merge would let a flagged v3 keep v2's publicSetId.
 */
const { UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { setMetadataKey } = require('./set-version');

const SHARE_STATUSES = Object.freeze(['checking', 'passed', 'published', 'flagged', 'escalated', 'appealed', 'unpublished']);
const FIELDS = Object.freeze(['version', 'status', 'publicSetId', 'publicVersion', 'note', 'contentHash', 'jobId', 'reasons']);

async function writeShareStamp(db, tableName, sourceRef, stamp, { now = new Date() } = {}) {
  if (!SHARE_STATUSES.includes(stamp && stamp.status)) {
    throw new Error(`share-stamp: refusing status ${JSON.stringify(stamp && stamp.status)}`);
  }
  const share = Object.fromEntries(FIELDS.filter((f) => stamp[f] !== undefined && stamp[f] !== null).map((f) => [f, stamp[f]]));
  share.at = now.toISOString();
  await db.send(new UpdateCommand({
    TableName: tableName,
    Key: setMetadataKey(sourceRef),
    UpdateExpression: 'SET #share = :share',
    ExpressionAttributeNames: { '#share': 'share' },
    ExpressionAttributeValues: { ':share': share },
  }));
  return share;
}
const readShareStamp = (meta) => (meta && meta.share && typeof meta.share === 'object' ? meta.share : null);
module.exports = { SHARE_STATUSES, writeShareStamp, readShareStamp };
```

```js
// lambda-functions/admin/shared/check-quota.js
/**
 * SUBMITS ARE A COST THE ORG CONTROLS AND ENGAGE PAYS — spec §4.2.
 *
 * One row per org per UTC day beside the usage ledger (`shared/usage.js` keys
 * the monthly ledger under the same ORG#<id> partition): `submits` is raised
 * by a CONDITIONAL add, so the cap is enforced by DynamoDB and not by a read
 * that two requests can both pass; `units` counts guardrail calls for the
 * ledger. UTC, for the reason usage.js gives: the answer must not depend on
 * which region a Lambda ran in.
 */
const { UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { orgPk } = require('./tenant');

const DEFAULT_DAILY_CAP = 20;
const dayOf = (now) => now.toISOString().slice(0, 10);
const key = (orgId, now) => ({ PK: orgPk(orgId), SK: `CHECKS#${dayOf(now)}` });

async function reserveSubmit(db, tableName, orgId, { cap = DEFAULT_DAILY_CAP, now = new Date() } = {}) {
  try {
    const res = await db.send(new UpdateCommand({
      TableName: tableName,
      Key: key(orgId, now),
      // `day` is a DynamoDB reserved word; alias it or the write is refused live
      // while a stub that ignores names passes it.
      UpdateExpression: 'ADD submits :one SET orgId = :org, #day = :day',
      ConditionExpression: 'attribute_not_exists(submits) OR submits < :cap',
      ExpressionAttributeNames: { '#day': 'day' },
      ExpressionAttributeValues: { ':one': 1, ':cap': cap, ':org': orgId, ':day': dayOf(now) },
      ReturnValues: 'ALL_NEW',
    }));
    return { ok: true, submits: Number((res && res.Attributes && res.Attributes.submits) || 0) };
  } catch (e) {
    if (e && e.name === 'ConditionalCheckFailedException') return { ok: false, cap };
    throw e;
  }
}
async function recordUnits(db, tableName, orgId, units, { now = new Date() } = {}) {
  const n = Math.max(0, Math.trunc(Number(units) || 0));
  if (!n) return;
  await db.send(new UpdateCommand({
    TableName: tableName,
    Key: key(orgId, now),
    UpdateExpression: 'ADD units :n',
    ExpressionAttributeValues: { ':n': n },
  }));
}
module.exports = { DEFAULT_DAILY_CAP, reserveSubmit, recordUnits };
```

Note: `orgPk` is exported by `tenant.js` (`ORG#<id>`); the harness's update applier handles `ADD … SET …` in either order because it splits on the keywords.

- [ ] **Step 4: Run the test**

Run: `node tests/share-stamp-and-quota.js`
Expected: `5 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add lambda-functions/admin/shared/share-stamp.js lambda-functions/admin/shared/check-quota.js tests/share-stamp-and-quota.js
git commit -m "The list's share stamp, and a daily submit cap the database enforces

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: The lock, the abandon, and the transition — `set-review.js`

**Files:**
- Modify: `lambda-functions/admin/shared/set-review.js` (append after `readReviews`, before `mayPublish`; extend `module.exports`)
- Test: `tests/set-check-lock.js`

**Interfaces:**
- Produces: `STALE_CHECK_MS = 15 * 60 * 1000`, `beginCheck(db, tableName, ref, version, { jobId, now }) → boolean` (conditional Put of `checking`: succeeds when no row, a non-checking row, or a checking row older than 15 minutes), `abandonCheck(db, tableName, ref, version, { jobId })` (conditional Delete of a `checking` row that carries this `jobId` — used when the worker cannot be dispatched), `transitionReview(db, tableName, ref, version, from, patch) → item | null` (conditional Put when `status IN (from...)`; `from` is a string or array), `isUnfinished(review, nowMs) → boolean`.

- [ ] **Step 1: Write the failing test**

```js
// tests/set-check-lock.js
const path = require('path');
const assert = require('assert');
const H = require('./helpers/moderation-harness');
H.install();
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const db = DynamoDBDocumentClient.from({});
const R = require(path.join(H.REPO, 'lambda-functions/admin/shared/set-review.js'));
const REF = { scope: 'org', orgId: 'org_acme', setId: 'pricing' };
const T = 'engage-test';
(async () => {
  console.log('\nthe check lock\n');
  await H.test('the first submit takes the lock; a second, ten minutes later, is refused', async () => {
    H.reset();
    const t0 = new Date('2026-09-17T10:00:00.000Z');
    assert.strictEqual(await R.beginCheck(db, T, REF, 2, { jobId: 'j1', now: t0 }), true);
    assert.strictEqual(await R.beginCheck(db, T, REF, 2, { jobId: 'j2', now: new Date(t0.getTime() + 10 * 60000) }), false);
    assert.strictEqual((await R.readReview(db, T, REF, 2)).jobId, 'j1', 'the second submit overwrote the first');
  });
  await H.test('a checking row older than fifteen minutes is stale and can be taken again', async () => {
    H.reset();
    const t0 = new Date('2026-09-17T10:00:00.000Z');
    await R.beginCheck(db, T, REF, 2, { jobId: 'j1', now: t0 });
    assert.strictEqual(await R.beginCheck(db, T, REF, 2, { jobId: 'j2', now: new Date(t0.getTime() + 16 * 60000) }), true);
    assert.strictEqual((await R.readReview(db, T, REF, 2)).jobId, 'j2');
  });
  await H.test('a flagged version can be re-submitted at once', async () => {
    H.reset();
    await R.writeReview(db, T, REF, 2, { status: R.STATUS.FLAGGED });
    assert.strictEqual(await R.beginCheck(db, T, REF, 2, { jobId: 'j3' }), true);
  });
  await H.test('abandonCheck removes only the checking row that carries the failed job', async () => {
    H.reset();
    await R.beginCheck(db, T, REF, 2, { jobId: 'j1' });
    await R.abandonCheck(db, T, REF, 2, { jobId: 'other' });
    assert.strictEqual((await R.readReview(db, T, REF, 2)).status, R.STATUS.CHECKING, 'a foreign jobId removed the lock');
    await R.abandonCheck(db, T, REF, 2, { jobId: 'j1' });
    assert.strictEqual((await R.readReview(db, T, REF, 2)).status, R.STATUS.UNREVIEWED);
  });
  await H.test('transitionReview moves flagged to appealed and refuses from any other state', async () => {
    H.reset();
    await R.writeReview(db, T, REF, 2, { status: R.STATUS.FLAGGED, findings: [{ questionId: 'q1', category: 'VIOLENCE', band: 'HIGH' }] });
    const moved = await R.transitionReview(db, T, REF, 2, R.STATUS.FLAGGED, { status: R.STATUS.APPEALED, appealMessage: 'history' });
    assert.strictEqual(moved.status, R.STATUS.APPEALED);
    assert.strictEqual(moved.findings.length, 1, 'the findings were lost on transition');
    assert.strictEqual(await R.transitionReview(db, T, REF, 2, R.STATUS.FLAGGED, { status: R.STATUS.APPEALED }), null);
    const passed = await R.transitionReview(db, T, REF, 2, [R.STATUS.ESCALATED, R.STATUS.APPEALED], { status: R.STATUS.PASSED, decidedBy: 'dai' });
    assert.strictEqual(passed.status, R.STATUS.PASSED);
  });
  await H.test('isUnfinished is true only for a checking row past the stale window', () => {
    const now = Date.parse('2026-09-17T10:20:00.000Z');
    assert.strictEqual(R.isUnfinished({ status: 'checking', checkedAt: '2026-09-17T10:00:00.000Z' }, now), true);
    assert.strictEqual(R.isUnfinished({ status: 'checking', checkedAt: '2026-09-17T10:10:00.000Z' }, now), false);
    assert.strictEqual(R.isUnfinished({ status: 'flagged', checkedAt: '2026-09-17T09:00:00.000Z' }, now), false);
  });
  H.summary();
})();
```

- [ ] **Step 2: Run it to see it fail**

Run: `node tests/set-check-lock.js`
Expected: `FAIL` on every test with `R.beginCheck is not a function`.

- [ ] **Step 3: Add the functions**

Add `DeleteCommand` to the lib-dynamodb import at the top of `set-review.js`, then insert before `const mayPublish = …`:

```js
/** After this, a `checking` row is a check that did not finish, not one in progress. */
const STALE_CHECK_MS = 15 * 60 * 1000;
const isConditionFailure = (e) => e && (e.name === 'ConditionalCheckFailedException' || e.code === 'ConditionalCheckFailedException');

/**
 * THE LOCK. A second submit while one runs would overwrite `checking` and
 * re-run every guardrail call at Engage's expense; a crashed worker would leave
 * `checking` for ever. So the write is conditional: it succeeds when nobody is
 * checking, or when the check that was is older than STALE_CHECK_MS. Readers
 * render a stale `checking` as "didn't finish — submit again" (`isUnfinished`).
 */
async function beginCheck(db, tableName, ref, version, { jobId, now = new Date() } = {}) {
  const item = {
    ...reviewKey(ref, version),
    version: version === null || version === undefined ? null : version,
    status: STATUS.CHECKING,
    checkedAt: now.toISOString(),
    ...(jobId ? { jobId } : {}),
  };
  try {
    await db.send(new PutCommand({
      TableName: tableName,
      Item: item,
      ConditionExpression: 'attribute_not_exists(#s) OR #s <> :checking OR checkedAt < :stale',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: {
        ':checking': STATUS.CHECKING,
        ':stale': new Date(now.getTime() - STALE_CHECK_MS).toISOString(),
      },
    }));
    return true;
  } catch (e) {
    if (isConditionFailure(e)) return false;
    throw e;
  }
}
/** Release a lock this job took and could not use (the worker failed to dispatch). */
async function abandonCheck(db, tableName, ref, version, { jobId } = {}) {
  try {
    await db.send(new DeleteCommand({
      TableName: tableName,
      Key: reviewKey(ref, version),
      ConditionExpression: '#s = :checking AND jobId = :job',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':checking': STATUS.CHECKING, ':job': String(jobId || '') },
    }));
  } catch (e) {
    if (!isConditionFailure(e)) throw e;
  }
}
/**
 * Move a version from one state to another, keeping what the row holds.
 * Conditional on the current state so two decisions cannot both apply.
 * Returns the new row, or null when the version was not in `from`.
 */
async function transitionReview(db, tableName, ref, version, from, patch = {}) {
  const froms = (Array.isArray(from) ? from : [from]).filter((s) => WRITABLE.includes(s));
  if (!froms.length) throw new Error('set-review: transitionReview needs at least one valid source status');
  if (!WRITABLE.includes(patch.status)) throw new Error(`set-review: refusing to write status ${JSON.stringify(patch.status)}`);
  const current = await readReview(db, tableName, ref, version);
  if (!froms.includes(current.status)) return null;
  const item = { ...current, ...reviewKey(ref, version), ...patch, transitionedAt: new Date().toISOString() };
  const values = { ':s0': current.status };
  try {
    await db.send(new PutCommand({
      TableName: tableName,
      Item: item,
      ConditionExpression: '#s = :s0',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: values,
    }));
    return item;
  } catch (e) {
    if (isConditionFailure(e)) return null;
    throw e;
  }
}
const isUnfinished = (review, nowMs = Date.now()) => Boolean(review)
  && review.status === STATUS.CHECKING
  && Boolean(review.checkedAt)
  && (nowMs - Date.parse(review.checkedAt)) > STALE_CHECK_MS;
```

Extend `module.exports` with `STALE_CHECK_MS, beginCheck, abandonCheck, transitionReview, isUnfinished`.

- [ ] **Step 4: Run the test, then the suites that already use this module**

Run: `node tests/set-check-lock.js && node tests/publish-question-set.js | tail -2 && node tests/copied-set-review.js | tail -2`
Expected: `6 passed, 0 failed`, and the two existing suites unchanged from baseline.

- [ ] **Step 5: Commit**

```bash
git add lambda-functions/admin/shared/set-review.js tests/set-check-lock.js
git commit -m "A submit takes a lock on the version, stale after fifteen minutes

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: The guardrail judges the published surface — `content-guardrail.js`

**Files:**
- Modify: `lambda-functions/admin/shared/content-guardrail.js` (`checkQuestions`; add `checkText`)
- Test: `tests/content-guardrail.js` (append a section)

**Interfaces:**
- `checkQuestions(questions, { onEach, budget } = {})`: each question is `{ id, text }` (the worker builds `text` with `publishable.questionText`); the legacy `{title, questionDetail, answerDetails}` shape still works. `onEach(index, total, result)` is called after every question; `budget()` returning `false` stops the loop cleanly and the result gains `stopped: true` with a `TIMEOUT` finding and `outcome: ESCALATED`.
- `checkText(text, subject) → { outcome, findings, checked: 1, clean }` — set-level prose judged on `SET_CATEGORIES`.

- [ ] **Step 1: Append the failing tests**

Append to `tests/content-guardrail.js`, immediately before the final summary line (find `passed,` near the end):

```js
  say('\n6. the published surface');
  // rejects: reading title + body and dropping the rest — the exact defect
  // that let the reveal and the options ship unjudged.
  await check('a question with `text` is judged on that text, verbatim', async () => {
    guardrailReplies = [{ action: 'NONE', assessments: [] }];
    sentCommands = [];
    await G.checkQuestions([{ id: 'q1', text: 'Title\nBody\nThe reveal\noptionA' }]);
    assert.strictEqual(sentCommands[0].content[0].text.text, 'Title\nBody\nThe reveal\noptionA');
  });
  await check('onEach fires per question and budget() stops the loop as an escalation', async () => {
    guardrailReplies = [{ action: 'NONE', assessments: [] }, { action: 'NONE', assessments: [] }, { action: 'NONE', assessments: [] }];
    const seen = [];
    let calls = 0;
    const r = await G.checkQuestions(
      [{ id: 'a', text: 'a' }, { id: 'b', text: 'b' }, { id: 'c', text: 'c' }],
      { onEach: (i, n) => seen.push(`${i}/${n}`), budget: () => { calls += 1; return calls <= 2; } },
    );
    assert.deepStrictEqual(seen, ['1/3', '2/3']);
    assert.strictEqual(r.stopped, true);
    assert.strictEqual(r.outcome, G.OUTCOME.ESCALATED);
    assert.ok(r.findings.some((f) => f.category === 'TIMEOUT'), 'no TIMEOUT finding');
    assert.strictEqual(r.checked, 2);
  });
  await check('checkText judges set-level prose on the set categories', async () => {
    guardrailReplies = [{ action: 'GUARDRAIL_INTERVENED', assessments: [{ contentPolicy: { filters: [{ type: 'INSULTS', confidence: 'HIGH' }] } }] }];
    const r = await G.checkText('A rude description', '(set)');
    assert.strictEqual(r.outcome, G.OUTCOME.FLAGGED);
    assert.deepStrictEqual(r.findings, [{ questionId: '(set)', category: 'INSULTS', band: 'HIGH' }]);
  });
```

- [ ] **Step 2: Run it to see it fail**

Run: `node tests/content-guardrail.js | tail -8`
Expected: the three new checks `FAIL` (`text` not read; `onEach` never called; `G.checkText is not a function`); every earlier check still passes.

- [ ] **Step 3: Change `checkQuestions` and add `checkText`**

Replace the body of `checkQuestions` from `const findings = [];` to its `return` with:

```js
  const findings = [];
  let outcome = OUTCOME.PASSED;
  let clean = 0;
  let checked = 0;
  let stopped = false;

  for (const q of questions) {
    // A budget answers "is there time for one more call". Stopping cleanly
    // and escalating beats being killed mid-call: the row still gets an
    // outcome, and a person sees why. (Spec §4.2.)
    if (typeof budget === 'function' && !budget()) {
      stopped = true;
      findings.push({ questionId: null, category: 'TIMEOUT', band: 'NONE' });
      outcome = worst(outcome, OUTCOME.ESCALATED);
      break;
    }
    const subject = q.id || q.SK || '(unidentified)';
    // `text` is the published surface (shared/publishable.js). The legacy
    // three-field shape stays for callers that predate it.
    const text = typeof q.text === 'string' && q.text
      ? q.text
      : [q.title || q.Title, q.questionDetail || q.Detail, q.answerDetails || q.AnswerDetails].filter(Boolean).join('\n');
    // eslint-disable-next-line no-await-in-loop
    const r = await evaluate(text, { categories: SET_CATEGORIES, subject });
    checked += 1;
    if (r.findings.length === 0) clean += 1;
    findings.push(...r.findings);
    outcome = worst(outcome, r.outcome);
    if (typeof onEach === 'function') onEach(checked, questions.length, r);
  }

  return { outcome, findings, checked, clean, stopped };
```

and change the signature to `async function checkQuestions(questions = [], { onEach, budget } = {}) {`. Add after `checkPromptText`:

```js
/** Set-level prose — name, description, instructions, category names — judged as one subject. */
async function checkText(text, subject = '(set)') {
  const r = await evaluate(text, { categories: SET_CATEGORIES, subject });
  return { ...r, checked: 1, clean: r.findings.length === 0 ? 1 : 0 };
}
```

and export `checkText`.

- [ ] **Step 4: Run the suite**

Run: `node tests/content-guardrail.js | tail -3`
Expected: every check passes; the count is the baseline plus 3.

- [ ] **Step 5: Commit**

```bash
git add lambda-functions/admin/shared/content-guardrail.js tests/content-guardrail.js
git commit -m "The guardrail judges the text publish copies, reports progress, and stops on budget

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: `finding-explanations.js` — the sentence `06` promises

**Files:**
- Create: `lambda-functions/admin/shared/finding-explanations.js`
- Test: `tests/finding-explanations.js`

**Interfaces:**
- Produces: `explainFindings(bedrock, InvokeModelCommand, snapshot, findings, { limit = 12 } = {}) → findings` — each finding on a real question (not `EMPTY`/`ERROR`/`UNCONFIGURED`/`TIMEOUT`, and not the `(set)` subject) gains `explanation` (≤ 240 chars, plain text). One Haiku call per finding, at most `limit` calls (the rest get the fallback). `bandSentence(finding) → string` is the fallback and is exported for the client copy to mirror.
- Consumes: `snapshot.questions[].SK` = `QUESTION#<id>` and `publishable.questionText`.

- [ ] **Step 1: Write the failing test**

```js
// tests/finding-explanations.js
const path = require('path');
const assert = require('assert');
const H = require('./helpers/moderation-harness');
H.install();
const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
const E = require(path.join(H.REPO, 'lambda-functions/admin/shared/finding-explanations.js'));
const bedrock = new BedrockRuntimeClient({});
const snapshot = {
  questions: [
    { SK: 'QUESTION#q001', Title: 'Describe the worst injury you have seen on site', Detail: 'and what caused it.' },
    { SK: 'QUESTION#q002', Title: 'Which crew is usually the problem?', Detail: '' },
  ],
};
(async () => {
  console.log('\nfinding explanations\n');
  await H.test('a flagged question gets one Haiku sentence, trimmed to 240 characters of plain text', async () => {
    H.reset();
    H.state.haikuReplies = ['<b>Asking a room to describe injuries in detail</b> is what was flagged, not the safety topic.'];
    const out = await E.explainFindings(bedrock, InvokeModelCommand, snapshot, [{ questionId: 'q001', category: 'VIOLENCE', band: 'HIGH' }]);
    assert.strictEqual(out[0].explanation, 'Asking a room to describe injuries in detail is what was flagged, not the safety topic.');
    assert.strictEqual(H.state.sentHaiku.length, 1);
    const prompt = H.state.sentHaiku[0].messages[0].content;
    assert.ok(prompt.includes('Describe the worst injury'), 'the question text was not in the prompt');
    assert.ok(prompt.includes('VIOLENCE') && prompt.includes('HIGH'), 'category and band were not in the prompt');
  });
  await H.test('a Bedrock error falls back to the band sentence and never throws', async () => {
    H.reset();
    H.state.haikuReplies = [new Error('ThrottlingException')];
    const out = await E.explainFindings(bedrock, InvokeModelCommand, snapshot, [{ questionId: 'q002', category: 'HATE', band: 'MEDIUM' }]);
    assert.strictEqual(out[0].explanation, E.bandSentence({ category: 'HATE', band: 'MEDIUM' }));
    assert.match(out[0].explanation, /unsure|medium/i);
  });
  await H.test('system findings and the set subject are left alone, and the call limit holds', async () => {
    H.reset();
    H.state.haikuReplies = ['one', 'two'];
    const out = await E.explainFindings(bedrock, InvokeModelCommand, snapshot, [
      { questionId: null, category: 'TIMEOUT', band: 'NONE' },
      { questionId: '(set)', category: 'INSULTS', band: 'HIGH' },
      { questionId: 'q001', category: 'VIOLENCE', band: 'HIGH' },
      { questionId: 'q002', category: 'HATE', band: 'MEDIUM' },
    ], { limit: 1 });
    assert.strictEqual(out[0].explanation, undefined);
    assert.strictEqual(out[1].explanation, undefined);
    assert.strictEqual(out[2].explanation, 'one');
    assert.strictEqual(out[3].explanation, E.bandSentence(out[3]), 'the second finding should have used the fallback');
    assert.strictEqual(H.state.sentHaiku.length, 1);
  });
  H.summary();
})();
```

- [ ] **Step 2: Run it to see it fail**

Run: `node tests/finding-explanations.js`
Expected: `Cannot find module '.../shared/finding-explanations.js'`.

- [ ] **Step 3: Write the module**

```js
// lambda-functions/admin/shared/finding-explanations.js
/**
 * THE SENTENCE 06-share-rejected.html PROMISES — spec §4.3.
 *
 * Bedrock Guardrails returns a category and a band. The mockup shows a
 * sentence that separates WHAT was flagged from the SUBJECT ("asking a room to
 * describe injuries in detail is the part that was flagged, not the safety
 * topic"), and its rationale calls that sentence load-bearing: without it the
 * author concludes the checker is broken. So for flagged and escalated
 * questions only — a handful per set — one Haiku call each writes it.
 *
 * The output is UNTRUSTED TEXT about the author's own content: tags are
 * stripped, it is capped, and it is rendered as text, never markup. The
 * fallback is the band sentence, so a Bedrock failure costs nothing but prose.
 */
const { questionText } = require('./publishable');

const HAIKU = () => `arn:aws:bedrock:${process.env.AWS_REGION || 'us-east-1'}:${process.env.ACCOUNT_ID}:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0`;
const SYSTEM_CATEGORIES = Object.freeze(['EMPTY', 'ERROR', 'UNCONFIGURED', 'TIMEOUT', 'SNAPSHOT']);
const MAX_CHARS = 240;

const CATEGORY_WORDS = Object.freeze({
  VIOLENCE: 'violence or injury', SEXUAL: 'sexual content', HATE: 'hateful content',
  INSULTS: 'insulting or harassing language', MISCONDUCT: 'dangerous or criminal instructions',
});
function bandSentence(finding) {
  const what = CATEGORY_WORDS[String(finding.category || '').toUpperCase()] || 'this category';
  return String(finding.band || '').toUpperCase() === 'HIGH'
    ? `The check was confident this question contains ${what}.`
    : `The check was unsure (medium confidence) whether this question contains ${what}, so a person will look.`;
}
const plain = (s) => String(s || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_CHARS);
const questionById = (snapshot, id) => (snapshot.questions || []).find((q) => String(q.SK) === `QUESTION#${id}`);

async function explainOne(bedrock, InvokeModelCommand, question, finding) {
  const prompt = [
    `A content check for a workplace quiz flagged this question for ${finding.category} at ${finding.band} confidence.`,
    'In ONE sentence of at most 200 characters, say which part of the question was flagged and separate it from the subject the question is about.',
    'Plain text only. Do not quote the question back. Do not address the reader.',
    '',
    'QUESTION:',
    questionText(question),
  ].join('\n');
  const res = await bedrock.send(new InvokeModelCommand({
    modelId: HAIKU(),
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 160,
      temperature: 0.2,
      messages: [{ role: 'user', content: prompt }],
    }),
  }));
  const body = JSON.parse(new TextDecoder().decode(res.body));
  const text = (body.content || []).filter((c) => c.type === 'text').map((c) => c.text).join(' ');
  return plain(text);
}

async function explainFindings(bedrock, InvokeModelCommand, snapshot, findings = [], { limit = 12 } = {}) {
  let calls = 0;
  const out = [];
  for (const f of findings) {
    const category = String(f.category || '').toUpperCase();
    const q = f.questionId && f.questionId !== '(set)' ? questionById(snapshot, f.questionId) : null;
    if (SYSTEM_CATEGORIES.includes(category) || !q) { out.push({ ...f }); continue; }
    let explanation = '';
    if (calls < limit) {
      calls += 1;
      try {
        explanation = await explainOne(bedrock, InvokeModelCommand, q, f); // eslint-disable-line no-await-in-loop
      } catch (error) {
        console.warn(`⚠️ explanation for ${f.questionId} failed: ${error.message}`);
      }
    }
    out.push({ ...f, explanation: explanation || bandSentence(f) });
  }
  return out;
}
module.exports = { explainFindings, bandSentence, MAX_CHARS, SYSTEM_CATEGORIES };
```

- [ ] **Step 4: Run the test**

Run: `node tests/finding-explanations.js`
Expected: `3 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add lambda-functions/admin/shared/finding-explanations.js tests/finding-explanations.js
git commit -m "A flagged question gets the sentence the rejection screen promises

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: `publish-set.js` — one publish routine, and `publish-question-set.js` on top of it

**Files:**
- Create: `lambda-functions/admin/shared/publish-set.js`
- Modify: `lambda-functions/admin/publish-question-set.js` (the `share` and `unpublish` bodies)
- Test: `tests/publish-question-set.js` (existing suite stays green; one premise corrected; new checks)

**Interfaces:**
- Produces: `publicSetIdFor(orgId, setId)` (moved from the handler, same derivation), `platformPromptExists(db, tableName, promptId) → boolean`, `publishSnapshot(db, tableName, snapshot, { review, sourceOrgName, promptDropped }) → { pubRef, publicSetId, publicVersion, rowsPublished, questionCount }`, `unpublishSet(db, tableName, source, pubRef) → { removed }`.
- Consumes: `publishable.buildSnapshot` shape; `set-review` (`publishedKey`, `writeReview`, `STATUS`); `ddb-delete` (`collectPartitionKeys`, `batchDeleteKeys`); `set-version` (`setRef`, `setPartition`, `setMetadataKey`, `toVersion`, `batchPutItems`); `tenant` (`PUBLIC`, `promptsMetadataPk`, `PLATFORM`).

`publishSnapshot` writes the public partition from the snapshot's rows (so the worker's in-memory snapshot and, in Stage 2, an S3-loaded one publish identically), stamps `sourceOrgId / sourceOrgName / sourceSetId / sourceVersion / contentHash / promptDropped`, writes the public version's own `REVIEW` row (`passed`, the org review's findings — which carry no text — and the hash), and the source version's `PUBLISHED` row. It never copies `share` from the org row.

- [ ] **Step 1: Correct one premise and add the new checks to the existing suite**

In `tests/publish-question-set.js` the check `'the Workie comes with it'` (≈ line 236) predates D5. Change its `seed` to also plant a PLATFORM prompt row so the premise is "a platform Workie comes with it", and add the org-Workie sibling. Replace that check with:

```js
  await check('a PLATFORM Workie comes with it', async () => {
    await seed();
    store.set(key('AIPROMPTS', 'AIPROMPT#p-pricing'), { PK: 'AIPROMPTS', SK: 'AIPROMPT#p-pricing', name: 'Pricing coach' });
    await publish(owner({ version: 2 }));
    assert.strictEqual(publicMeta().promptId, 'p-pricing');
    assert.strictEqual(publicMeta().personaId, 'coach');
    assert.notStrictEqual(publicMeta().promptDropped, true);
  });
  // rejects: shipping a public set that points at a Workie only one
  // organisation can read — every copy would hold a dangling reference (D5).
  await check('an ORG Workie is dropped from the public copy, and the drop is recorded', async () => {
    await seed();
    await publish(owner({ version: 2 }));
    assert.strictEqual(publicMeta().promptId, undefined, 'an org Workie reached the public copy');
    assert.strictEqual(publicMeta().promptDropped, true);
  });
```

Then append, before section 5 (`say('\n5. unpublishing')`):

```js
  say('\n4b. what the copy records');
  await check('the public row names the source organisation, so 07 needs no extra read', async () => {
    await seed();
    store.set(key(`ORG#${ORG}`, 'METADATA'), { ...store.get(key(`ORG#${ORG}`, 'METADATA')), name: 'Acme Learning' });
    await publish(owner({ version: 2 }));
    assert.strictEqual(publicMeta().sourceOrgName, 'Acme Learning');
    assert.match(publicMeta().contentHash || '', /^[0-9a-f]{64}$/, 'no content hash on the public row');
  });
  await check('the org row gets a share stamp and never leaks it into the public row', async () => {
    await seed();
    await publish(owner({ version: 2 }));
    const org = store.get(key(`ORG#${ORG}#SETS`, `SET#${SET}`));
    assert.strictEqual(org.share.status, 'published');
    assert.strictEqual(org.share.publicSetId, 'orgacme-pricing');
    assert.strictEqual(org.share.publicVersion, 1);
    assert.strictEqual(publicMeta().share, undefined, 'the org stamp was copied onto the public row');
  });
  await check('publishing appends to the review log', async () => {
    await seed();
    await publish(owner({ version: 2 }));
    const log = [...store.values()].filter((i) => i.PK === `REVIEWLOG#org#${ORG}#${SET}`);
    assert.ok(log.some((e) => e.event === 'published' && e.publicVersion === 1), 'no published event');
  });
```

And in section 5, after `'DELETE removes the public rows'`, add:

```js
  await check('unpublishing deletes in batches, stamps the org row, and removes the PUBLISHED markers', async () => {
    await seed();
    await publish(owner({ version: 2 }));
    await publish(owner({ version: 2 }));   // two public versions
    batchWrites = 0;
    const res = await publish({ ...owner(), requestContext: { ...owner().requestContext, http: { method: 'DELETE' } } });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.deepStrictEqual(publicRows(), []);
    assert.ok(batchWrites > 0, 'rows were deleted one DeleteCommand at a time');
    assert.strictEqual(store.get(key(`ORG#${ORG}#SETS`, `SET#${SET}`)).share.status, 'unpublished');
    assert.strictEqual(store.has(key(`ORG#${ORG}#SET#${SET}#v2`, 'PUBLISHED')), false, 'the PUBLISHED marker outlived the listing');
  });
```

For that last check the suite's `fakeDoc` needs a counter: add `let batchWrites = 0;` beside `const store = new Map();` and `batchWrites += 1;` as the first line of the `case 'batchWrite':` branch. The suite also needs `UpdateCommand` (the stamp): add `class UpdateCommand { constructor(i) { this.input = i; this.type = 'update'; } }` beside the other command classes, export it in the `@aws-sdk/lib-dynamodb` stub object, and add a `case 'update':` branch to `fakeDoc.send` that applies `SET #share = :share` — for this suite a minimal applier is enough:

```js
      case 'update': {
        const k = key(inp.Key.PK, inp.Key.SK);
        const item = store.get(k) || { ...inp.Key };
        const names = inp.ExpressionAttributeNames || {};
        const values = inp.ExpressionAttributeValues || {};
        for (const part of String(inp.UpdateExpression).replace(/^SET\s+/i, '').split(/,\s*/)) {
          const [lhs, rhs] = part.split(/\s*=\s*/);
          item[names[lhs] || lhs] = values[rhs];
        }
        store.set(k, item);
        return {};
      }
```

- [ ] **Step 2: Run the suite to see the new checks fail**

Run: `node tests/publish-question-set.js | grep -E 'FAIL|passed'`
Expected: `an ORG Workie is dropped…`, `names the source organisation…`, `gets a share stamp…`, `appends to the review log`, `deletes in batches…` all `FAIL`; the rest pass.

- [ ] **Step 3: Write `publish-set.js`**

```js
// lambda-functions/admin/shared/publish-set.js
/**
 * THE ONE PUBLISH ROUTINE — spec §5.1.
 *
 * Two callers: the check worker on `passed`, and the staff decision on
 * `approve` (Stage 2). Both publish FROM A SNAPSHOT — the plaintext rows the
 * check judged — so "the reviewed content is the published content" is a
 * property of the code path and not of a hash comparison. The hash still
 * travels, as a fact for the record.
 *
 * Everything publish-question-set.js said still holds: a public set HAS
 * versions (re-sharing adds one), the public id is DERIVED and stable, org
 * content is decrypted on the way out (the snapshot already is), and an org
 * Workie never comes along (D5).
 */
const { GetCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const tenant = require('./tenant');
const {
  setRef, setPartition, setMetadataKey, toVersion, batchPutItems,
} = require('./set-version');
const { writeReview, publishedKey, STATUS } = require('./set-review');
const { contentHash } = require('./publishable');
const { collectPartitionKeys, batchDeleteKeys } = require('./ddb-delete');

/** Letters and digits of the org id, then the set id: two orgs' `teamretro` stay apart, un-renamed. */
const publicSetIdFor = (orgId, setId) => `${String(orgId).replace(/[^a-zA-Z0-9]/g, '')}-${setId}`;

async function platformPromptExists(db, tableName, promptId) {
  const id = String(promptId || '').trim();
  if (!id) return false;
  const res = await db.send(new GetCommand({
    TableName: tableName,
    Key: { PK: tenant.promptsMetadataPk(tenant.PLATFORM), SK: `AIPROMPT#${id}` },
  }));
  return Boolean(res && res.Item);
}

async function publishSnapshot(db, tableName, snapshot, { review = {}, sourceOrgName = '', promptDropped = false } = {}) {
  const source = setRef(snapshot.source);
  const pubRef = setRef({ scope: tenant.PUBLIC, orgId: '', setId: publicSetIdFor(source.orgId, source.setId) });
  const version = toVersion(snapshot.version);
  const now = new Date().toISOString();

  const existingRes = await db.send(new GetCommand({ TableName: tableName, Key: setMetadataKey(pubRef) }));
  const existing = existingRes.Item;
  const publicVersion = (toVersion(existing && existing.activeVersion) || 0) + 1;
  const targetPk = setPartition(pubRef, publicVersion);

  const copies = [...(snapshot.categories || []), ...(snapshot.questions || [])]
    .filter((row) => row && row.SK && row.SK !== 'REVIEW' && row.SK !== 'PUBLISHED')
    .map((row) => ({ ...row, PK: targetPk }));
  if (!copies.some((row) => String(row.SK).startsWith('QUESTION#'))) {
    throw new Error('publish-set: the snapshot holds no questions');
  }
  await batchPutItems(db, tableName, copies);

  const hash = snapshot.contentHash || contentHash(snapshot);
  // The public version's own review record: the verdict on exactly these rows.
  await writeReview(db, tableName, pubRef, publicVersion, {
    status: STATUS.PASSED,
    findings: Array.isArray(review.findings) ? review.findings : [],
    note: review.note || 'published',
    contentHash: hash,
  });

  const questionCount = copies.filter((row) => String(row.SK).startsWith('QUESTION#')).length;
  const versions = Array.isArray(existing && existing.versions) ? [...existing.versions] : [];
  versions.push({ version: publicVersion, createdAt: now, questionCount });

  const { share, promptId, ...meta } = snapshot.meta || {}; // eslint-disable-line no-unused-vars
  const publicMeta = {
    ...meta,
    ...setMetadataKey(pubRef),
    scope: tenant.PUBLIC,
    orgId: '',
    ...(promptDropped ? { promptDropped: true } : { promptId }),
    personaId: meta.personaId,
    activeVersion: publicVersion,
    versions,
    active: true,
    Quickstart: false,
    sourceOrgId: source.orgId,
    sourceOrgName: sourceOrgName || (existing && existing.sourceOrgName) || '',
    sourceSetId: source.setId,
    sourceVersion: version,
    contentHash: hash,
    publishedAt: now,
    updatedAt: now,
    createdAt: (existing && existing.createdAt) || now,
    // Kept across re-shares; set by later stages.
    ...(existing && existing.sensitivity ? { sensitivity: existing.sensitivity } : {}),
    ...(existing && existing.reports ? { reports: existing.reports } : {}),
  };
  if (publicMeta.promptId === undefined) delete publicMeta.promptId;
  await db.send(new PutCommand({ TableName: tableName, Item: publicMeta }));

  await db.send(new PutCommand({
    TableName: tableName,
    Item: { ...publishedKey(source, version), publicSetId: pubRef.setId, publicVersion, at: now },
  }));

  return { pubRef, publicSetId: pubRef.setId, publicVersion, rowsPublished: copies.length, questionCount };
}

/** Take it out of the library: every public version partition, the public metadata row, and the source's PUBLISHED markers. */
async function unpublishSet(db, tableName, source, pubRef) {
  const metaRes = await db.send(new GetCommand({ TableName: tableName, Key: setMetadataKey(pubRef) }));
  const meta = metaRes.Item;
  if (!meta) return { removed: 0 };
  const keys = [];
  for (const entry of (Array.isArray(meta.versions) ? meta.versions : [])) {
    keys.push(...await collectPartitionKeys(db, tableName, setPartition(pubRef, entry.version))); // eslint-disable-line no-await-in-loop
  }
  keys.push(setMetadataKey(pubRef));
  // The org's own PUBLISHED markers that point at this listing.
  const srcRes = await db.send(new GetCommand({ TableName: tableName, Key: setMetadataKey(source) }));
  const srcVersions = Array.isArray(srcRes.Item && srcRes.Item.versions) ? srcRes.Item.versions : [];
  for (const entry of srcVersions) {
    const k = publishedKey(source, entry.version);
    const row = (await db.send(new GetCommand({ TableName: tableName, Key: k }))).Item; // eslint-disable-line no-await-in-loop
    if (row && row.publicSetId === pubRef.setId) keys.push(k);
  }
  await batchDeleteKeys(db, tableName, keys);
  return { removed: keys.length };
}

module.exports = { publicSetIdFor, platformPromptExists, publishSnapshot, unpublishSet };
```

Check `ddb-delete.js`'s `collectPartitionKeys` returns `[{PK, SK}]` and `batchDeleteKeys` takes that list (both at `lambda-functions/admin/shared/ddb-delete.js:37-69`); adapt the two calls above to their exact signatures if they differ.

- [ ] **Step 4: Rewrite `share` and `unpublish` in `publish-question-set.js`**

Replace the imports and the two functions so the handler builds a snapshot from the org partition and hands it to the routine:

```js
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');
const {
  setMetadataKey, resolvePartitionFromMeta, toVersion, queryPartition, setRef,
} = require('./shared/set-version');
const tenant = require('./shared/tenant');
const { decryptItem } = require('./shared/tenant-crypto');
const { readReview, mayPublish, STATUS } = require('./shared/set-review');
const { buildSnapshot, contentHash } = require('./shared/publishable');
const { publicSetIdFor, platformPromptExists, publishSnapshot, unpublishSet } = require('./shared/publish-set');
const { writeShareStamp } = require('./shared/share-stamp');
const { appendReviewEvent } = require('./shared/review-log');
```

`publicSetId` (the local const) becomes `publicSetIdFor`. In `share()`, from `const { items: rows } = await queryPartition(...)` to the end, replace with:

```js
  const { items: rows } = await queryPartition(db, TABLE(), resolved.pk);
  if (!rows.some((r) => String(r.SK || '').startsWith('QUESTION#'))) return fail(409, 'That version has no questions to share.');

  const plainMeta = await decryptItem(orgId, 'set', meta);
  const questions = [];
  const categories = [];
  for (const row of rows) {
    const sk = String(row.SK || '');
    if (sk.startsWith('QUESTION#')) questions.push(await decryptItem(orgId, 'question', row)); // eslint-disable-line no-await-in-loop
    else if (sk.startsWith('CATEGORY#')) categories.push(row);
  }
  const snapshot = buildSnapshot({ source, version, meta: plainMeta, categories, questions });
  snapshot.contentHash = contentHash(snapshot);

  const promptDropped = Boolean(plainMeta.promptId) && !(await platformPromptExists(db, TABLE(), plainMeta.promptId));
  const orgRow = (await db.send(new GetCommand({ TableName: TABLE(), Key: { PK: tenant.orgPk(orgId), SK: 'METADATA' } }))).Item;
  const published = await publishSnapshot(db, TABLE(), snapshot, {
    review, sourceOrgName: (orgRow && orgRow.name) || '', promptDropped,
  });
  await writeShareStamp(db, TABLE(), source, {
    version, status: 'published', publicSetId: published.publicSetId, publicVersion: published.publicVersion, contentHash: snapshot.contentHash,
  });
  await appendReviewEvent(db, TABLE(), source, 'published', {
    version, publicSetId: published.publicSetId, publicVersion: published.publicVersion, contentHash: snapshot.contentHash, promptDropped,
  });

  console.log(`🌍 published ${orgId}/${setId} v${version} as public ${published.publicSetId} v${published.publicVersion}`);
  return json(201, {
    publicSetId: published.publicSetId,
    publicVersion: published.publicVersion,
    sourceVersion: version,
    rowsPublished: published.rowsPublished,
    promptDropped,
  });
```

The org row's `name` is plaintext (`orgs/create-org.js:107`; there is no `org` entity in `ENCRYPTED_FIELDS`, `tenant-crypto.js:148`), so it is read as-is. Replace `unpublish` with:

```js
async function unpublish(source, pubRef) {
  const { removed } = await unpublishSet(db, TABLE(), source, pubRef);
  if (removed === 0) return json(200, { removed: 0, note: 'That set is not in the public library.' });
  await writeShareStamp(db, TABLE(), source, { version: null, status: 'unpublished' });
  await appendReviewEvent(db, TABLE(), source, 'unpublished', { publicSetId: pubRef.setId, removed });
  console.log(`🌍 unpublished ${pubRef.setId}: ${removed} row(s) removed`);
  return json(200, { removed, publicSetId: pubRef.setId });
}
```

`writeShareStamp` drops `null` fields, so an unpublished stamp is `{status, at}`.

- [ ] **Step 5: Run the suite and its neighbours**

Run: `node tests/publish-question-set.js | tail -3 && node tests/copied-set-review.js | tail -2 && node tests/set-versioning-flow.js | tail -2`
Expected: every check passes (baseline + 5), and the two neighbours are unchanged. If `set-versioning-flow.js` has a drift check listing `publish-question-set.js`'s requires, update its expectation to the new modules.

- [ ] **Step 6: Commit**

```bash
git add lambda-functions/admin/shared/publish-set.js lambda-functions/admin/publish-question-set.js tests/publish-question-set.js
git commit -m "One publish routine, fed a snapshot; unpublish deletes in batches and stamps the row

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: `set-check-worker.js` — the worker

**Files:**
- Create: `lambda-functions/admin/shared/set-check-worker.js`
- Test: `tests/set-check-job.js` (part A — the worker; Task 11 appends part B)

**Interfaces:**
- Produces: `runSetCheck({ db, tableName, s3, bucket, bedrock }, { jobId }, context) → void`, `snapshotKeyFor(source, version, checkedAt) → string`, `BUDGET_FLOOR_MS = 20000`.
- Consumes: a job row written by `createJob` with `kind: 'set-check'`, `callerOrgId`, `callerUserId`, `request: { setId, version, publish, declaredNotice }`; everything from Tasks 2–9.
- Writes, in order: job progress → S3 snapshot → guardrail (per question, then the set prose) → explanations (flagged/escalated only) → units → `REVIEW` row (`status, findings, note, contentHash, snapshotKey, jobId, reasons, checkedAt, checkedBy, promptDropped, declaredNotice`) → log `checked` → on escalation the queue row + log `escalated` → on pass with `publish` the publish + stamp `published` + log `published`, else stamp `{status}` → `completeJob` with `items = findings.map(({questionId, category, band}))` and `meta = { outcome, version, checked, clean, reasons, publicSetId, publicVersion, promptDropped }`. Any thrown error: `REVIEW` ← `escalated` with `reasons: ['error']`, stamp, queue row, log, `failJob`.

- [ ] **Step 1: Write the failing tests (part A)**

```js
// tests/set-check-job.js
/**
 * THE CHECK IS A JOB — admin/check-question-set.js + shared/set-check-worker.js
 * Spec §4 (the check), §2 (the lifecycle), §11 (edge cases).
 */
const path = require('path');
const assert = require('assert');
const H = require('./helpers/moderation-harness');
H.install();
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const { S3Client } = require('@aws-sdk/client-s3');
const { BedrockRuntimeClient } = require('@aws-sdk/client-bedrock-runtime');
const db = DynamoDBDocumentClient.from({});
const s3 = new S3Client({});
const bedrock = new BedrockRuntimeClient({});
const T = 'engage-test';
const REPO = H.REPO;
const C = require(path.join(REPO, 'lambda-functions/admin/shared/tenant-crypto.js'));
const R = require(path.join(REPO, 'lambda-functions/admin/shared/set-review.js'));
const J = require(path.join(REPO, 'lambda-functions/admin/shared/generation-jobs.js'));
const W = require(path.join(REPO, 'lambda-functions/admin/shared/set-check-worker.js'));

const ORG = 'org_acme'; const SET = 'safety';
const SRC = { scope: 'org', orgId: ORG, setId: SET };
const deps = { db, tableName: T, s3, bucket: 'prompts-test', bedrock };

/** An org set at v2 with three questions, encrypted the way upload writes them. */
async function seed({ questions = 3, image = false, promptId = 'p-org', platformPrompt = false, questionCount } = {}) {
  H.reset();
  H.seedRow({ PK: `ORG#${ORG}`, SK: 'METADATA', orgId: ORG, name: 'Acme Learning' });
  const meta = await C.encryptItem(ORG, 'set', {
    PK: `ORG#${ORG}#SETS`, SK: `SET#${SET}`, name: 'Safety walkthrough', description: 'Site induction.',
    engagementType: 'trivia', scope: 'org', orgId: ORG, promptId, activeVersion: 2,
    versions: [{ version: 1 }, { version: 2 }], questionCount: questionCount ?? questions, createdBy: 'sub-amara',
  });
  H.seedRow(meta);
  H.seedRow({ PK: `ORG#${ORG}#SET#${SET}#v2`, SK: 'CATEGORY#c001', Name: 'Injuries', QuestionCount: questions });
  for (let i = 1; i <= questions; i += 1) {
    const q = await C.encryptItem(ORG, 'question', { // eslint-disable-line no-await-in-loop
      PK: `ORG#${ORG}#SET#${SET}#v2`, SK: `QUESTION#q00${i}`, Title: `Question ${i} title`, Detail: `Detail ${i}`,
      AnswerDetails: `Reveal ${i}`, optionA: 'A', optionB: 'B', correctAnswer: 'A', Category: 'c001',
      Image: image && i === 1 ? 'sets/safety/q1.png' : '', Active: true, points: 10,
    });
    H.seedRow(q);
  }
  if (platformPrompt) H.seedRow({ PK: 'AIPROMPTS', SK: 'AIPROMPT#p-plat', name: 'House coach' });
}
async function job(extra = {}) {
  const jobId = J.newJobId();
  await J.createJob(db, T, {
    jobId, kind: 'set-check', requested: 3,
    request: { setId: SET, version: 2, publish: true, declaredNotice: [], ...extra },
    caller: { userId: 'sub-amara', username: 'amara', orgId: ORG, orgRole: 'owner' },
  });
  return jobId;
}
const clean = (n) => Array.from({ length: n }, () => H.guardrailClean());
const review = () => R.readReview(db, T, SRC, 2);
const stamp = () => H.state.ddb.get(`ORG#${ORG}#SETS|SET#${SET}`).share;
const queue = () => H.rowsWhere((r) => r.PK === 'MODERATION');
const logEvents = () => H.rowsWhere((r) => r.PK === `REVIEWLOG#org#${ORG}#${SET}`).map((e) => e.event).sort();
const publicRows = () => H.rowsWhere((r) => String(r.PK).startsWith('PUBLIC#'));

(async () => {
  console.log('\nthe check job — the worker\n');

  await H.test('a clean set passes and is published in the same run, and every record is written', async () => {
    await seed({ promptId: 'p-plat', platformPrompt: true });
    H.state.guardrailReplies = clean(4); // 3 questions + the set prose
    const jobId = await job();
    await W.runSetCheck(deps, { jobId }, H.ctx());
    const r = await review();
    assert.strictEqual(r.status, R.STATUS.PASSED, `review is ${r.status}: ${r.note}`);
    assert.match(r.contentHash, /^[0-9a-f]{64}$/);
    assert.ok(r.snapshotKey && H.state.s3.has(`prompts-test/${r.snapshotKey}`), 'no snapshot in S3');
    assert.strictEqual(stamp().status, 'published');
    assert.strictEqual(stamp().publicSetId, 'orgacme-safety');
    assert.ok(publicRows().some((row) => row.SK === 'QUESTION#q001' && row.Title === 'Question 1 title'), 'the public copy is missing or ciphertext');
    assert.deepStrictEqual(logEvents(), ['checked', 'published']);
    const j = await J.getJob(db, T, jobId);
    assert.strictEqual(j.status, 'complete');
    assert.strictEqual(j.meta.outcome, 'passed');
    assert.strictEqual(j.meta.publicVersion, 1);
    assert.strictEqual(H.state.ddb.get(`ORG#${ORG}|CHECKS#${new Date().toISOString().slice(0, 10)}`).units, 4, 'units were not recorded');
    assert.strictEqual(queue().length, 0);
  });

  await H.test('the guardrail is sent the published surface: the reveal and the options, not just title and body', async () => {
    await seed({ questions: 1 });
    H.state.guardrailReplies = clean(2);
    await W.runSetCheck(deps, { jobId: await job() }, H.ctx());
    const sent = H.state.sentGuardrail.map((c) => c.content[0].text.text);
    assert.ok(sent[0].includes('Reveal 1') && sent[0].includes('A\nB'), `judged text was ${JSON.stringify(sent[0])}`);
    assert.ok(sent[1].includes('Safety walkthrough') && sent[1].includes('Injuries'), 'the set prose and category name were not judged');
  });

  await H.test('a HIGH band flags the version, names the question with an explanation, and publishes nothing', async () => {
    await seed();
    H.state.guardrailReplies = [H.guardrailHit('VIOLENCE', 'HIGH'), ...clean(3)];
    H.state.haikuReplies = ['Asking a room to describe injuries in detail is what was flagged, not the safety topic.'];
    const jobId = await job();
    await W.runSetCheck(deps, { jobId }, H.ctx());
    const r = await review();
    assert.strictEqual(r.status, R.STATUS.FLAGGED);
    assert.strictEqual(r.findings[0].questionId, 'q001');
    assert.match(r.findings[0].explanation, /injuries in detail/);
    assert.strictEqual(H.state.sentHaiku.length, 1, 'one explanation per flagged question');
    assert.deepStrictEqual(publicRows(), []);
    assert.strictEqual(stamp().status, 'flagged');
    assert.strictEqual(queue().length, 0, 'a flagged set is not a queue item');
    const j = await J.getJob(db, T, jobId);
    assert.strictEqual(j.meta.outcome, 'flagged');
    assert.ok(!JSON.stringify(j.items).includes('Question 1 title'), 'question text leaked into the job items');
    assert.deepStrictEqual(Object.keys(j.items[0]).sort(), ['band', 'category', 'questionId']);
  });

  await H.test('a MEDIUM band escalates: a pointer in the queue, no text on it, nothing published', async () => {
    await seed();
    H.state.guardrailReplies = [H.guardrailClean(), H.guardrailHit('HATE', 'MEDIUM'), ...clean(2)];
    await W.runSetCheck(deps, { jobId: await job() }, H.ctx());
    assert.strictEqual((await review()).status, R.STATUS.ESCALATED);
    const [row] = queue();
    assert.ok(row, 'no queue row');
    assert.strictEqual(row.SK, `${ORG}#${SET}#v2`);
    assert.deepStrictEqual(row.reasons, ['escalated']);
    assert.strictEqual(row.title, 'Safety walkthrough');
    assert.strictEqual(row.orgName, 'Acme Learning');
    assert.deepStrictEqual(row.bands, { HATE: 'MEDIUM' });
    assert.ok(row.snapshotKey, 'the queue row does not point at the snapshot');
    assert.ok(!JSON.stringify(row).includes('Question 2 title'), 'question text on the queue row');
    assert.strictEqual(stamp().status, 'escalated');
    assert.deepStrictEqual(logEvents(), ['checked', 'escalated']);
    assert.deepStrictEqual(publicRows(), []);
  });

  await H.test('a declared notice, or an image, sends a clean set to a person with the reason named', async () => {
    await seed();
    H.state.guardrailReplies = clean(4);
    await W.runSetCheck(deps, { jobId: await job({ declaredNotice: ['graphic-medical'] }) }, H.ctx());
    assert.strictEqual((await review()).status, R.STATUS.ESCALATED);
    assert.deepStrictEqual((await review()).reasons, ['declared']);
    await seed({ image: true });
    H.state.guardrailReplies = clean(4);
    await W.runSetCheck(deps, { jobId: await job() }, H.ctx());
    assert.deepStrictEqual((await review()).reasons, ['images']);
    assert.deepStrictEqual(publicRows(), []);
  });

  await H.test('an org Workie is dropped from the public copy; the dialog was told in advance', async () => {
    await seed({ promptId: 'p-org' });
    H.state.guardrailReplies = clean(4);
    const jobId = await job();
    await W.runSetCheck(deps, { jobId }, H.ctx());
    const pub = publicRows().find((r) => r.PK === 'PUBLIC#SETS');
    assert.strictEqual(pub.promptId, undefined);
    assert.strictEqual(pub.promptDropped, true);
    assert.strictEqual((await J.getJob(db, T, jobId)).meta.promptDropped, true);
  });

  await H.test('running out of budget stops cleanly and escalates with the reason', async () => {
    await seed({ questions: 3 });
    H.state.guardrailReplies = clean(4);
    let remaining = 100000;
    const ctx = { functionName: 'fn', getRemainingTimeInMillis: () => { const r = remaining; remaining = 1000; return r; } };
    await W.runSetCheck(deps, { jobId: await job() }, ctx);
    const r = await review();
    assert.strictEqual(r.status, R.STATUS.ESCALATED);
    assert.ok(r.reasons.includes('timeout'), `reasons were ${r.reasons}`);
    assert.ok(H.state.sentGuardrail.length < 4, 'the loop did not stop');
  });

  await H.test('a snapshot upload failure escalates and publishes nothing', async () => {
    await seed();
    H.state.guardrailReplies = clean(4);
    const failingS3 = { send: async () => { throw new Error('AccessDenied'); } };
    await W.runSetCheck({ ...deps, s3: failingS3 }, { jobId: await job() }, H.ctx());
    assert.strictEqual((await review()).status, R.STATUS.ESCALATED);
    assert.deepStrictEqual((await review()).reasons, ['snapshot']);
    assert.deepStrictEqual(publicRows(), []);
  });

  await H.test('an unexpected error fails toward a person and fails the job with a reason', async () => {
    H.reset();
    const jobId = await job(); // no set rows at all
    await W.runSetCheck(deps, { jobId }, H.ctx());
    const r = await review();
    assert.strictEqual(r.status, R.STATUS.ESCALATED);
    assert.deepStrictEqual(r.reasons, ['error']);
    assert.strictEqual(queue().length, 1);
    const j = await J.getJob(db, T, jobId);
    assert.strictEqual(j.status, 'error');
    assert.match(j.errorMessage, /no longer exists/);
  });

  // Part B (the handler) is appended by Task 11 below this line.
  H.summary();
})();
```

- [ ] **Step 2: Run it to see it fail**

Run: `node tests/set-check-job.js`
Expected: `Cannot find module '.../shared/set-check-worker.js'`.

- [ ] **Step 3: Write the worker**

```js
// lambda-functions/admin/shared/set-check-worker.js
/**
 * THE CHECK, RUN AS A WORKER — spec §4.
 *
 * Invoked with `InvocationType: 'Event'` and no authorizer context: WHO asked
 * is read from the job row, which only the authorised POST could have written
 * (generation-jobs.js, createJob). Everything the worker decides lands in rows
 * — the REVIEW row, the share stamp, the log, the queue — never only in the
 * job response, so a closed browser changes nothing.
 *
 * Order matters and is deliberate:
 *   snapshot → S3        so a person can review exactly what was judged
 *   guardrail            per question, then the set prose as one more subject
 *   explanations         flagged/escalated only — a handful of Haiku calls
 *   REVIEW row           the gate
 *   log, queue, publish  the record, the person, the library
 *
 * Everything unknown fails toward a person (spec §11): a thrown error, a
 * snapshot that would not upload, an image the text filters cannot see, a
 * declared notice, a budget that ran out — each escalates with its reason.
 */
const { GetCommand } = require('@aws-sdk/lib-dynamodb');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const { InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
const tenant = require('./tenant');
const { setRef, setMetadataKey, resolvePartitionFromMeta, toVersion, queryPartition } = require('./set-version');
const { decryptItem } = require('./tenant-crypto');
const { writeReview, STATUS } = require('./set-review');
const { checkQuestions, checkText, OUTCOME } = require('./content-guardrail');
const { buildSnapshot, contentHash, questionText, setText, snapshotHasImages } = require('./publishable');
const { explainFindings } = require('./finding-explanations');
const { publishSnapshot, platformPromptExists } = require('./publish-set');
const { writeShareStamp } = require('./share-stamp');
const { appendReviewEvent } = require('./review-log');
const { upsertQueueRow } = require('./moderation-queue');
const { recordUnits } = require('./check-quota');
const { getJob, updateJobProgress, completeJob, failJob } = require('./generation-jobs');

const BUDGET_FLOOR_MS = 20000;
const AS_STATUS = { [OUTCOME.PASSED]: STATUS.PASSED, [OUTCOME.FLAGGED]: STATUS.FLAGGED, [OUTCOME.ESCALATED]: STATUS.ESCALATED };
const worstOf = (a, b) => {
  const rank = { [OUTCOME.FLAGGED]: 0, [OUTCOME.ESCALATED]: 1, [OUTCOME.PASSED]: 2 };
  return rank[a] <= rank[b] ? a : b;
};
const snapshotKeyFor = (source, version, checkedAt) => `moderation/${source.orgId}/${source.setId}/v${version}/${String(checkedAt).replace(/[:.]/g, '-')}.json`;
const minimalFinding = ({ questionId, category, band }) => ({ questionId: questionId === undefined ? null : questionId, category, band });

async function runSetCheck({ db, tableName, s3, bucket, bedrock }, { jobId }, context) {
  const job = await getJob(db, tableName, jobId);
  if (!job) { console.error(`🔎 check job ${jobId}: no job row`); return; }
  const orgId = job.callerOrgId;
  const request = job.request || {};
  const source = setRef({ scope: tenant.ORG, orgId, setId: request.setId });
  const version = toVersion(request.version);
  const checkedAt = new Date().toISOString();
  const declaredNotice = Array.isArray(request.declaredNotice) ? request.declaredNotice : [];
  const reasons = [];
  let findings = []; let checked = 0; let clean = 0;

  try {
    await updateJobProgress(db, tableName, jobId, { completed: 0, phase: 'Reading the set…' });
    const meta = (await db.send(new GetCommand({ TableName: tableName, Key: setMetadataKey(source) }))).Item;
    if (!meta) throw new Error('That set no longer exists');
    const resolved = resolvePartitionFromMeta(source, meta, version);
    const { items: rows } = await queryPartition(db, tableName, resolved.pk);
    const plainMeta = await decryptItem(orgId, 'set', meta);
    const questions = []; const categories = [];
    for (const row of rows) {
      const sk = String(row.SK || '');
      if (sk.startsWith('QUESTION#')) questions.push(await decryptItem(orgId, 'question', row)); // eslint-disable-line no-await-in-loop
      else if (sk.startsWith('CATEGORY#')) categories.push(row);
    }
    const snapshot = buildSnapshot({ source, version, meta: plainMeta, categories, questions, checkedAt });
    snapshot.contentHash = contentHash(snapshot);
    const promptDropped = Boolean(plainMeta.promptId) && !(await platformPromptExists(db, tableName, plainMeta.promptId));

    let snapshotKey = snapshotKeyFor(source, version, checkedAt);
    try {
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: snapshotKey, Body: JSON.stringify(snapshot), ContentType: 'application/json' }));
    } catch (error) {
      console.warn(`⚠️ snapshot upload failed for ${orgId}/${source.setId} v${version}: ${error.message}`);
      reasons.push('snapshot');
      snapshotKey = null;
    }
    if (snapshotHasImages(snapshot)) reasons.push('images');
    if (declaredNotice.length) reasons.push('declared');

    const remaining = () => (context && typeof context.getRemainingTimeInMillis === 'function' ? context.getRemainingTimeInMillis() : Infinity);
    const result = await checkQuestions(
      questions.map((q) => ({ id: String(q.SK).replace('QUESTION#', ''), text: questionText(q) })),
      {
        budget: () => remaining() > BUDGET_FLOOR_MS,
        onEach: (i, n) => {
          if (i % 5 === 0 || i === n) updateJobProgress(db, tableName, jobId, { completed: i, phase: `Checking ${i} of ${n}` }).catch(() => {});
        },
      },
    );
    const setResult = await checkText(setText(plainMeta, categories), '(set)');
    findings = [...result.findings, ...setResult.findings];
    checked = result.checked + setResult.checked;
    clean = result.clean + setResult.clean;
    if (result.stopped) reasons.push('timeout');
    if (findings.some((f) => String(f.band).toUpperCase() === 'MEDIUM')) reasons.push('guardrail');

    let status = AS_STATUS[worstOf(result.outcome, setResult.outcome)] || STATUS.ESCALATED;
    if (status !== STATUS.FLAGGED && reasons.length) status = STATUS.ESCALATED;
    if (status !== STATUS.PASSED) findings = await explainFindings(bedrock, InvokeModelCommand, snapshot, findings);

    await recordUnits(db, tableName, orgId, checked);
    await writeReview(db, tableName, source, version, {
      status, findings, note: `${clean}/${checked} clean`, jobId,
      contentHash: snapshot.contentHash, snapshotKey, reasons, checkedAt, checkedBy: job.callerUserId || null,
      promptDropped, declaredNotice,
    });
    await appendReviewEvent(db, tableName, source, 'checked', {
      version, outcome: status, reasons, checked, clean, contentHash: snapshot.contentHash, snapshotKey,
      findings: findings.map(minimalFinding), by: job.callerUserId || null,
    });

    let published = null;
    if (status === STATUS.ESCALATED) {
      const bands = {};
      for (const f of findings) if (f.band && f.band !== 'NONE') bands[f.category] = f.band;
      await upsertQueueRow(db, tableName, {
        ref: source, version, reason: 'escalated',
        orgId, orgName: await orgName(db, tableName, orgId), setId: source.setId, title: plainMeta.name || source.setId,
        gameType: plainMeta.engagementType || '', questionCount: questions.length, bands,
        uncertainQuestionIds: findings.filter((f) => f.questionId && f.questionId !== '(set)').map((f) => f.questionId),
        snapshotKey, contentHash: snapshot.contentHash,
      });
      await appendReviewEvent(db, tableName, source, 'escalated', { version, reasons });
      await writeShareStamp(db, tableName, source, { version, status: 'escalated', contentHash: snapshot.contentHash, reasons, jobId });
    } else if (status === STATUS.PASSED && request.publish !== false) {
      published = await publishSnapshot(db, tableName, snapshot, {
        review: { findings, note: `${clean}/${checked} clean` }, sourceOrgName: await orgName(db, tableName, orgId), promptDropped,
      });
      await writeShareStamp(db, tableName, source, {
        version, status: 'published', publicSetId: published.publicSetId, publicVersion: published.publicVersion, contentHash: snapshot.contentHash,
      });
      await appendReviewEvent(db, tableName, source, 'published', {
        version, publicSetId: published.publicSetId, publicVersion: published.publicVersion, contentHash: snapshot.contentHash, promptDropped,
      });
    } else {
      await writeShareStamp(db, tableName, source, { version, status, contentHash: snapshot.contentHash, jobId });
    }

    await completeJob(db, tableName, jobId, {
      items: findings.map(minimalFinding),
      meta: {
        outcome: status, version, checked, clean, reasons, promptDropped,
        publicSetId: published ? published.publicSetId : null,
        publicVersion: published ? published.publicVersion : null,
      },
    });
    console.log(`🔎 ${orgId}/${source.setId} v${version}: ${status} (${clean}/${checked} clean)${published ? ` → public ${published.publicSetId} v${published.publicVersion}` : ''}`);
  } catch (error) {
    console.error(`❌ check job ${jobId} failed:`, error);
    try {
      await writeReview(db, tableName, source, version, {
        status: STATUS.ESCALATED, findings, note: error.message, jobId, reasons: ['error'], checkedAt, checkedBy: job.callerUserId || null,
      });
      await appendReviewEvent(db, tableName, source, 'checked', { version, outcome: STATUS.ESCALATED, reasons: ['error'], error: error.message });
      await upsertQueueRow(db, tableName, {
        ref: source, version, reason: 'escalated', orgId, setId: source.setId, title: source.setId, questionCount: 0, bands: {}, orgName: await orgName(db, tableName, orgId),
      });
      await appendReviewEvent(db, tableName, source, 'escalated', { version, reasons: ['error'] });
      await writeShareStamp(db, tableName, source, { version, status: 'escalated', reasons: ['error'], jobId });
    } catch (inner) {
      console.error(`❌ and could not record the failure: ${inner.message}`);
    }
    await failJob(db, tableName, jobId, `The check could not finish: ${error.message}`);
  }
}
async function orgName(db, tableName, orgId) {
  try {
    const row = (await db.send(new GetCommand({ TableName: tableName, Key: { PK: tenant.orgPk(orgId), SK: 'METADATA' } }))).Item;
    return (row && row.name) || '';
  } catch { return ''; }
}
module.exports = { runSetCheck, snapshotKeyFor, BUDGET_FLOOR_MS };
```

Org names are plaintext on the `ORG#<id>/METADATA` row (`orgs/create-org.js:107`, and `org` is not an entity in `ENCRYPTED_FIELDS`), so no decrypt is needed there.

- [ ] **Step 4: Run the suite**

Run: `node tests/set-check-job.js`
Expected: `9 passed, 0 failed`. If the unit count in the first test differs, it is because `checkText` counts as one — `checked` is questions + 1; keep the assertion at 4 and fix the code, not the test.

- [ ] **Step 5: Commit**

```bash
git add lambda-functions/admin/shared/set-check-worker.js tests/set-check-job.js
git commit -m "The check worker: snapshot, guardrail, explanations, and every record, publishing on pass

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: `check-question-set.js` — the three-mode handler

**Files:**
- Modify: `lambda-functions/admin/check-question-set.js` (rewrite the handler body; keep the header comment's first paragraph and replace the "SYNCHRONOUS, FOR NOW" section with the job note below)
- Test: `tests/set-check-job.js` (part B appended before `H.summary()`)

**Interfaces:**
- `POST /question-sets/{setId}/check { version?, publish?: boolean (default true), declaredNotice?: string[] }` → `202 { jobId, version, status: 'queued' }` | `403` | `404` | `409 { error, status: 'checking' }` | `429 { error, cap }` | `500`.
- `GET /question-sets/{setId}/check/{jobId}` → `200 jobToResponse(job)` when the caller's org matches the job's; else `404`.
- `__workerMode` → `runSetCheck`.
- Reads `process.env.CHECK_DAILY_CAP` (default `DEFAULT_DAILY_CAP`).

- [ ] **Step 1: Append the failing tests (part B)**

Insert before `H.summary();` in `tests/set-check-job.js`:

```js
  console.log('\nthe check job — the handler\n');
  const handler = require(path.join(REPO, 'lambda-functions/admin/check-question-set.js')).handler;
  const parse = (res) => JSON.parse(res.body || '{}');
  const post = (extra = {}) => H.orgEvent({ orgId: ORG, role: 'owner', method: 'POST', setId: SET, body: { version: 2, ...extra } });
  const get = (jobId, orgId = ORG) => H.orgEvent({ orgId, role: 'member', method: 'GET', setId: SET, jobId });

  await H.test('a plain member cannot submit', async () => {
    await seed();
    const res = await handler(H.orgEvent({ orgId: ORG, role: 'member', method: 'POST', setId: SET, body: { version: 2 } }), H.ctx());
    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(H.state.dispatched.length, 0);
  });
  await H.test('an owner gets 202, a lock, a job carrying the org, a dispatch, and a checking stamp', async () => {
    await seed();
    const res = await handler(post(), H.ctx());
    assert.strictEqual(res.statusCode, 202, res.body);
    const { jobId } = parse(res);
    assert.ok(jobId);
    assert.strictEqual((await review()).status, R.STATUS.CHECKING);
    assert.strictEqual((await review()).jobId, jobId);
    const j = await J.getJob(db, T, jobId);
    assert.strictEqual(j.callerOrgId, ORG);
    assert.strictEqual(j.kind, 'set-check');
    assert.deepStrictEqual(j.request, { setId: SET, version: 2, publish: true, declaredNotice: [] });
    assert.deepStrictEqual(H.state.dispatched[0].payload, { __workerMode: true, jobId });
    assert.strictEqual(H.state.dispatched[0].InvocationType, 'Event');
    assert.strictEqual(stamp().status, 'checking');
  });
  await H.test('a second submit while one runs is refused with 409', async () => {
    await seed();
    await handler(post(), H.ctx());
    const res = await handler(post(), H.ctx());
    assert.strictEqual(res.statusCode, 409);
    assert.strictEqual(parse(res).status, 'checking');
    assert.strictEqual(H.state.dispatched.length, 1);
  });
  await H.test('the poll is tenant-scoped: another org gets 404, the same org reads the job', async () => {
    await seed();
    const { jobId } = parse(await handler(post(), H.ctx()));
    assert.strictEqual((await handler(get(jobId, 'org_rival'), H.ctx())).statusCode, 404);
    const mine = await handler(get(jobId), H.ctx());
    assert.strictEqual(mine.statusCode, 200);
    assert.strictEqual(parse(mine).jobId, jobId);
    assert.strictEqual((await handler(get('nope'), H.ctx())).statusCode, 404);
  });
  await H.test('a dispatch failure releases the lock and fails the job with a reason', async () => {
    await seed();
    H.state.lambdaShouldFail = true;
    const res = await handler(post(), H.ctx());
    assert.strictEqual(res.statusCode, 500);
    assert.strictEqual((await review()).status, R.STATUS.UNREVIEWED, 'the lock outlived the failed dispatch');
    const j = await J.getJob(db, T, parse(res).jobId);
    assert.strictEqual(j.status, 'error');
  });
  await H.test('the daily cap answers 429 and leaves no lock', async () => {
    await seed();
    process.env.CHECK_DAILY_CAP = '1';
    await handler(post(), H.ctx());
    await R.abandonCheck(db, T, SRC, 2, { jobId: (await review()).jobId });
    const res = await handler(post(), H.ctx());
    delete process.env.CHECK_DAILY_CAP;
    assert.strictEqual(res.statusCode, 429);
    assert.strictEqual(parse(res).cap, 1);
    assert.strictEqual((await review()).status, R.STATUS.UNREVIEWED);
  });
  await H.test('worker mode runs the check end to end through the handler', async () => {
    await seed({ promptId: '' });
    H.state.guardrailReplies = clean(4);
    const { jobId } = parse(await handler(post(), H.ctx()));
    await handler({ __workerMode: true, jobId }, H.ctx());
    assert.strictEqual((await review()).status, R.STATUS.PASSED);
    assert.strictEqual(stamp().status, 'published');
  });
```

- [ ] **Step 2: Run it to see part B fail**

Run: `node tests/set-check-job.js | grep -E 'FAIL|passed'`
Expected: part A passes; part B fails (`202` expected, handler still synchronous; `dispatched` empty).

- [ ] **Step 3: Rewrite the handler**

```js
// lambda-functions/admin/check-question-set.js — everything below the header comment
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client } = require('@aws-sdk/client-s3');
const { BedrockRuntimeClient } = require('@aws-sdk/client-bedrock-runtime');
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
const { setMetadataKey, resolvePartitionFromMeta, toVersion, setRef } = require('./shared/set-version');
const tenant = require('./shared/tenant');
const { callerUserId } = require('./shared/question-set-access');
const { callerUsername } = require('./shared/require-admin');
const { beginCheck, abandonCheck } = require('./shared/set-review');
const { reserveSubmit, DEFAULT_DAILY_CAP } = require('./shared/check-quota');
const { writeShareStamp } = require('./shared/share-stamp');
const { newJobId, createJob, getJob, jobToResponse, failJob } = require('./shared/generation-jobs');
const { runSetCheck } = require('./shared/set-check-worker');

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
const s3 = new S3Client({ region: process.env.AWS_REGION });
const bedrock = new BedrockRuntimeClient({ region: process.env.AWS_REGION || 'us-east-1' });
const lambda = new LambdaClient({ region: process.env.AWS_REGION });
const TABLE = () => process.env.TABLE_NAME;

const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const json = (statusCode, body) => ({ statusCode, headers: cors, body: JSON.stringify(body) });
const fail = (statusCode, error) => json(statusCode, { error });

exports.handler = async (event, context) => {
  // The worker: invoked with InvocationType 'Event', against the full 900s.
  if (event && event.__workerMode === true) {
    await runSetCheck({ db, tableName: TABLE(), s3, bucket: process.env.AI_PROMPTS_BUCKET, bedrock }, { jobId: event.jobId }, context);
    return { statusCode: 200, body: 'ok' };
  }
  const method = String(event?.requestContext?.http?.method || 'POST').toUpperCase();
  if (method === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };

  const setId = String(event?.pathParameters?.setId || '').trim();
  if (!setId) return fail(400, 'Which set?');
  const orgId = tenant.callerOrgId(event);
  if (!orgId) return fail(400, 'Choose an organisation before checking a question set.');

  // THE POLL, TENANT-SCOPED. A job id is not a capability: only the org that
  // asked may read the answer. Anything else is "not found", never "not yours".
  const jobIdParam = event?.pathParameters?.jobId;
  if (method === 'GET' || jobIdParam) {
    if (!jobIdParam) return fail(400, 'jobId is required');
    const job = await getJob(db, TABLE(), jobIdParam);
    if (!job || job.kind !== 'set-check' || job.callerOrgId !== orgId) return fail(404, 'Job not found or expired');
    return json(200, jobToResponse(job));
  }

  // The same bar as publishing: this is the step before it.
  if (!tenant.canManageScope(event, tenant.ORG, orgId, 'admin')) {
    return fail(403, 'Only an owner or admin of this organisation can submit a set for review.');
  }
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch { return fail(400, 'That request body is not JSON.'); }
  const source = setRef({ scope: tenant.ORG, orgId, setId });

  try {
    const meta = (await db.send(new GetCommand({ TableName: TABLE(), Key: setMetadataKey(source) }))).Item;
    if (!meta) return fail(404, 'That set is not one of yours.');
    const resolved = resolvePartitionFromMeta(source, meta, toVersion(body.version));
    const version = resolved.version;

    const cap = Number(process.env.CHECK_DAILY_CAP) || DEFAULT_DAILY_CAP;
    const quota = await reserveSubmit(db, TABLE(), orgId, { cap });
    if (!quota.ok) return json(429, { error: `This organisation has used today's ${cap} checks. Try again tomorrow.`, cap });

    const jobId = newJobId();
    if (!await beginCheck(db, TABLE(), source, version, { jobId })) {
      return json(409, { error: 'This version is already being checked.', status: 'checking' });
    }
    const request = {
      setId, version,
      publish: body.publish !== false,
      declaredNotice: Array.isArray(body.declaredNotice) ? body.declaredNotice.map(String).slice(0, 8) : [],
    };
    await createJob(db, TABLE(), {
      jobId, kind: 'set-check', requested: Number(meta.questionCount) || 0, request,
      caller: { userId: callerUserId(event), username: callerUsername(event), orgId, orgRole: tenant.callerOrgRole(event) },
    });
    try {
      await lambda.send(new InvokeCommand({
        FunctionName: context.functionName,
        InvocationType: 'Event',
        Payload: Buffer.from(JSON.stringify({ __workerMode: true, jobId })),
      }));
    } catch (error) {
      console.error('❌ Failed to dispatch the check worker:', error);
      await abandonCheck(db, TABLE(), source, version, { jobId });
      await failJob(db, TABLE(), jobId, `Could not start the content check: ${error.message}`);
      return json(500, { error: `Could not start the content check: ${error.message}`, jobId });
    }
    await writeShareStamp(db, TABLE(), source, { version, status: 'checking', jobId });
    console.log(`🔎 dispatched check ${jobId} for ${orgId}/${setId} v${version}`);
    return json(202, { jobId, version, status: 'queued' });
  } catch (error) {
    console.error('check error:', error);
    return fail(500, `Could not check that set: ${error.message}`);
  }
};
```

Replace the header's "SYNCHRONOUS, FOR NOW" section with: *"A JOB. The POST takes the lock and the quota, writes the job row with the caller, self-invokes, and answers 202. The worker (`shared/set-check-worker.js`) does everything else against the function's 900s. `checking` older than fifteen minutes reads as unfinished (`set-review.isUnfinished`)."* Confirm `newJobId` is in `generation-jobs.js`'s `module.exports` (line ~228); if not, export it there.

- [ ] **Step 4: Run the suite**

Run: `node tests/set-check-job.js | tail -3`
Expected: `16 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add lambda-functions/admin/check-question-set.js tests/set-check-job.js
git commit -m "Submitting a set for review is a job: a lock, a quota, a tenant-scoped poll

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: `appeal-question-set.js` — "Ask for a human review"

**Files:**
- Create: `lambda-functions/admin/appeal-question-set.js`
- Test: `tests/appeal-question-set.js`

**Interfaces:**
- `POST /question-sets/{setId}/appeal { version?, message? }` → `200 { version, status: 'appealed' }` | `403` | `404` | `409 { error, status }` (not `flagged`) | `400`. Org admin/owner only. `message` ≤ 500 chars, stored as `appealMessage` on the `REVIEW` row, the queue row and the log.
- Writes: `transitionReview(flagged → appealed)`, queue row `reason: 'appealed'` (with the pointer fields read off the review row and the set), log `appealed`, stamp `{ version, status: 'appealed' }`.

- [ ] **Step 1: Write the failing test**

```js
// tests/appeal-question-set.js
const path = require('path');
const assert = require('assert');
const H = require('./helpers/moderation-harness');
H.install();
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const db = DynamoDBDocumentClient.from({});
const T = 'engage-test';
const C = require(path.join(H.REPO, 'lambda-functions/admin/shared/tenant-crypto.js'));
const R = require(path.join(H.REPO, 'lambda-functions/admin/shared/set-review.js'));
const handler = require(path.join(H.REPO, 'lambda-functions/admin/appeal-question-set.js')).handler;
const ORG = 'org_acme'; const SET = 'safety';
const SRC = { scope: 'org', orgId: ORG, setId: SET };
const parse = (res) => JSON.parse(res.body || '{}');
async function seed(status = R.STATUS.FLAGGED) {
  H.reset();
  H.seedRow({ PK: `ORG#${ORG}`, SK: 'METADATA', orgId: ORG, name: 'Acme Learning' });
  H.seedRow(await C.encryptItem(ORG, 'set', {
    PK: `ORG#${ORG}#SETS`, SK: `SET#${SET}`, name: 'Safety walkthrough', engagementType: 'trivia', scope: 'org', orgId: ORG,
    activeVersion: 2, versions: [{ version: 2 }], questionCount: 30,
  }));
  await R.writeReview(db, T, SRC, 2, {
    status, findings: [{ questionId: 'q014', category: 'VIOLENCE', band: 'HIGH', explanation: 'x' }],
    contentHash: 'a'.repeat(64), snapshotKey: 'moderation/org_acme/safety/v2/t.json',
  });
}
const post = (body, role = 'owner') => H.orgEvent({ orgId: ORG, role, method: 'POST', setId: SET, body });
(async () => {
  console.log('\nappealing a flagged version\n');
  await H.test('a flagged version becomes appealed, keeps its findings, and joins the queue with the message', async () => {
    await seed();
    const res = await handler(post({ version: 2, message: 'It is a clinical safety set.' }), H.ctx());
    assert.strictEqual(res.statusCode, 200, res.body);
    const r = await R.readReview(db, T, SRC, 2);
    assert.strictEqual(r.status, R.STATUS.APPEALED);
    assert.strictEqual(r.findings.length, 1, 'findings lost');
    assert.strictEqual(r.appealMessage, 'It is a clinical safety set.');
    const [row] = H.rowsWhere((x) => x.PK === 'MODERATION');
    assert.ok(row, 'no queue row');
    assert.deepStrictEqual(row.reasons, ['appealed']);
    assert.strictEqual(row.appealMessage, 'It is a clinical safety set.');
    assert.strictEqual(row.title, 'Safety walkthrough');
    assert.strictEqual(row.snapshotKey, 'moderation/org_acme/safety/v2/t.json');
    assert.strictEqual(H.state.ddb.get(`ORG#${ORG}#SETS|SET#${SET}`).share.status, 'appealed');
    assert.ok(H.rowsWhere((x) => x.PK === `REVIEWLOG#org#${ORG}#${SET}` && x.event === 'appealed').length === 1);
  });
  await H.test('only a flagged version can be appealed', async () => {
    for (const status of [R.STATUS.PASSED, R.STATUS.ESCALATED, R.STATUS.CHECKING]) {
      await seed(status); // eslint-disable-line no-await-in-loop
      const res = await handler(post({ version: 2 }), H.ctx()); // eslint-disable-line no-await-in-loop
      assert.strictEqual(res.statusCode, 409, `${status} was appealable`);
      assert.strictEqual(parse(res).status, status);
    }
  });
  await H.test('a member cannot appeal; the message is capped at 500 characters', async () => {
    await seed();
    assert.strictEqual((await handler(post({ version: 2 }, 'member'), H.ctx())).statusCode, 403);
    const res = await handler(post({ version: 2, message: 'x'.repeat(900) }), H.ctx());
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual((await R.readReview(db, T, SRC, 2)).appealMessage.length, 500);
  });
  H.summary();
})();
```

- [ ] **Step 2: Run it to see it fail**

Run: `node tests/appeal-question-set.js`
Expected: `Cannot find module '.../appeal-question-set.js'`.

- [ ] **Step 3: Write the handler**

```js
// lambda-functions/admin/appeal-question-set.js
/**
 * "ASK FOR A HUMAN REVIEW" — 06-share-rejected.html, spec §2 and §9.
 *
 *   POST /question-sets/{setId}/appeal   { version, message }
 *
 * Only a FLAGGED version can be appealed: an escalated one is already with a
 * person, a passed one has nothing to appeal. The transition is conditional on
 * the current state, so a check finishing at the same moment cannot be
 * overwritten. The findings stay on the row — the reviewer needs them.
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { setMetadataKey, resolvePartitionFromMeta, toVersion, setRef } = require('./shared/set-version');
const tenant = require('./shared/tenant');
const { decryptItem } = require('./shared/tenant-crypto');
const { readReview, transitionReview, STATUS } = require('./shared/set-review');
const { upsertQueueRow } = require('./shared/moderation-queue');
const { appendReviewEvent } = require('./shared/review-log');
const { writeShareStamp } = require('./shared/share-stamp');
const { callerUserId } = require('./shared/question-set-access');

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
const TABLE = () => process.env.TABLE_NAME;
const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const json = (statusCode, body) => ({ statusCode, headers: cors, body: JSON.stringify(body) });
const fail = (statusCode, error) => json(statusCode, { error });
const MESSAGE_MAX = 500;

exports.handler = async (event) => {
  const method = String(event?.requestContext?.http?.method || 'POST').toUpperCase();
  if (method === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  const setId = String(event?.pathParameters?.setId || '').trim();
  if (!setId) return fail(400, 'Which set?');
  const orgId = tenant.callerOrgId(event);
  if (!orgId) return fail(400, 'Choose an organisation first.');
  if (!tenant.canManageScope(event, tenant.ORG, orgId, 'admin')) {
    return fail(403, 'Only an owner or admin of this organisation can ask for a human review.');
  }
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch { return fail(400, 'That request body is not JSON.'); }
  const message = String(body.message || '').trim().slice(0, MESSAGE_MAX);
  const source = setRef({ scope: tenant.ORG, orgId, setId });

  try {
    const meta = (await db.send(new GetCommand({ TableName: TABLE(), Key: setMetadataKey(source) }))).Item;
    if (!meta) return fail(404, 'That set is not one of yours.');
    const version = resolvePartitionFromMeta(source, meta, toVersion(body.version)).version;
    const current = await readReview(db, TABLE(), source, version);
    if (current.status !== STATUS.FLAGGED) {
      return json(409, { error: 'Only a version the check flagged can be sent to a person.', status: current.status });
    }
    const moved = await transitionReview(db, TABLE(), source, version, STATUS.FLAGGED, {
      status: STATUS.APPEALED, appealMessage: message, appealedBy: callerUserId(event) || null, appealedAt: new Date().toISOString(),
    });
    if (!moved) return json(409, { error: 'This version changed while you were writing. Reload and try again.', status: current.status });

    const plainMeta = await decryptItem(orgId, 'set', meta);
    const orgRow = (await db.send(new GetCommand({ TableName: TABLE(), Key: { PK: tenant.orgPk(orgId), SK: 'METADATA' } }))).Item;
    const bands = {};
    for (const f of moved.findings || []) if (f.band && f.band !== 'NONE') bands[f.category] = f.band;
    await upsertQueueRow(db, TABLE(), {
      ref: source, version, reason: 'appealed',
      orgId, orgName: (orgRow && orgRow.name) || '', setId, title: plainMeta.name || setId,
      gameType: plainMeta.engagementType || '', questionCount: Number(meta.questionCount) || 0, bands,
      uncertainQuestionIds: (moved.findings || []).map((f) => f.questionId).filter((id) => id && id !== '(set)'),
      snapshotKey: moved.snapshotKey || null, contentHash: moved.contentHash || null, appealMessage: message,
    });
    await appendReviewEvent(db, TABLE(), source, 'appealed', { version, message, by: callerUserId(event) || null });
    await writeShareStamp(db, TABLE(), source, { version, status: 'appealed', contentHash: moved.contentHash });
    console.log(`🙋 ${orgId}/${setId} v${version} appealed`);
    return json(200, { version, status: STATUS.APPEALED });
  } catch (error) {
    console.error('appeal error:', error);
    return fail(500, `Could not send that for review: ${error.message}`);
  }
};
```

- [ ] **Step 4: Run the test**

Run: `node tests/appeal-question-set.js`
Expected: `3 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add lambda-functions/admin/appeal-question-set.js tests/appeal-question-set.js
git commit -m "A flagged version can be sent to a person, with the author's message

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: The projections — `get-set-versions.js` and `get-question-sets.js`

**Files:**
- Modify: `lambda-functions/admin/get-set-versions.js:96-125` (the `versions` map), `lambda-functions/admin/get-question-sets.js:100-180` (the per-set projection)
- Test: `tests/share-projection.js`

**Interfaces:**
- Versions: each entry gains `checkedAt`, `reasons` (array), `unfinished` (boolean, `isUnfinished`), `note`, and `published: { publicSetId, publicVersion, at } | null` (one `GetCommand` on `publishedKey(found.ref, version)` per version).
- Sets: each row gains `share: item.share || null` — the stamp, verbatim.

- [ ] **Step 1: Write the failing test**

```js
// tests/share-projection.js
const path = require('path');
const assert = require('assert');
const H = require('./helpers/moderation-harness');
H.install();
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const db = DynamoDBDocumentClient.from({});
const T = 'engage-test';
const C = require(path.join(H.REPO, 'lambda-functions/admin/shared/tenant-crypto.js'));
const R = require(path.join(H.REPO, 'lambda-functions/admin/shared/set-review.js'));
const versions = require(path.join(H.REPO, 'lambda-functions/admin/get-set-versions.js')).handler;
const list = require(path.join(H.REPO, 'lambda-functions/admin/get-question-sets.js')).handler;
const ORG = 'org_acme'; const SET = 'safety';
const SRC = { scope: 'org', orgId: ORG, setId: SET };
const parse = (res) => JSON.parse(res.body || '{}');
async function seed() {
  H.reset();
  H.seedRow(await C.encryptItem(ORG, 'set', {
    PK: `ORG#${ORG}#SETS`, SK: `SET#${SET}`, name: 'Safety', engagementType: 'trivia', scope: 'org', orgId: ORG,
    activeVersion: 3, versions: [{ version: 2, questionCount: 30 }, { version: 3, questionCount: 31 }], questionCount: 31,
    share: { version: 3, status: 'flagged', at: '2026-09-17T10:00:00.000Z', contentHash: 'c'.repeat(64) },
  }));
  await R.writeReview(db, T, SRC, 2, { status: R.STATUS.PASSED, checkedAt: '2026-09-01T10:00:00.000Z' });
  H.seedRow({ ...R.publishedKey(SRC, 2), publicSetId: 'orgacme-safety', publicVersion: 1, at: '2026-09-01T10:01:00.000Z' });
  await R.writeReview(db, T, SRC, 3, { status: R.STATUS.CHECKING, checkedAt: '2026-09-17T09:00:00.000Z', reasons: [] });
}
const ev = (method, extra = {}) => H.orgEvent({ orgId: ORG, role: 'member', method, setId: SET, ...extra });
(async () => {
  console.log('\nshare projections\n');
  await H.test('the version list says which version is public, and which check never finished', async () => {
    await seed();
    const res = await versions(ev('GET'), H.ctx());
    assert.strictEqual(res.statusCode, 200, res.body);
    const [v2, v3] = parse(res);
    assert.deepStrictEqual(v2.published, { publicSetId: 'orgacme-safety', publicVersion: 1, at: '2026-09-01T10:01:00.000Z' });
    assert.strictEqual(v2.review, 'passed');
    assert.strictEqual(v3.published, null);
    assert.strictEqual(v3.review, 'checking');
    assert.strictEqual(v3.unfinished, true, 'a check from hours ago still reads as running');
    assert.strictEqual(v3.checkedAt, '2026-09-17T09:00:00.000Z');
    assert.deepStrictEqual(v3.reasons, []);
  });
  await H.test('the set list carries the share stamp verbatim', async () => {
    await seed();
    const res = await list(ev('GET', { path: {} }), H.ctx());
    assert.strictEqual(res.statusCode, 200, res.body);
    const set = parse(res).questionSets.find((s) => s.id === SET);
    assert.ok(set, 'the org set is not listed');
    assert.deepStrictEqual(set.share, { version: 3, status: 'flagged', at: '2026-09-17T10:00:00.000Z', contentHash: 'c'.repeat(64) });
    assert.strictEqual(set.activeVersion, 3);
  });
  H.summary();
})();
```

If `get-question-sets.js` reads `pathParameters` or query strings for scope, mirror what `tests/question-set-ownership.js` passes in its event (open it and copy its event shape into `ev`).

- [ ] **Step 2: Run it to see it fail**

Run: `node tests/share-projection.js`
Expected: both tests `FAIL` (`published` undefined; `share` undefined).

- [ ] **Step 3: Extend both projections**

In `get-set-versions.js`, import `publishedKey` and `isUnfinished` from `./shared/set-review` and, after `const reviews = await readReviews(...)`, add:

```js
    // WHERE EACH VERSION WENT. One GetItem per version: this is the editor's
    // Versions panel, not the list, and a set has a handful of versions.
    const published = new Map();
    for (const e of entries) {
      const res = await db.send(new GetCommand({ TableName: tableName, Key: publishedKey(found.ref, e.version) })); // eslint-disable-line no-await-in-loop
      published.set(e.version, res && res.Item
        ? { publicSetId: res.Item.publicSetId, publicVersion: res.Item.publicVersion, at: res.Item.at }
        : null);
    }
```

and in the `versions` map add, beside `review:`:

```js
      checkedAt: (reviews.get(entry.version) || {}).checkedAt || null,
      reasons: (reviews.get(entry.version) || {}).reasons || [],
      note: (reviews.get(entry.version) || {}).note || '',
      unfinished: isUnfinished(reviews.get(entry.version)),
      published: published.get(entry.version) || null,
```

In `get-question-sets.js`, beside `activeVersion: toVersion(item.activeVersion),` add:

```js
      // THE SHARE STAMP, VERBATIM. The list's "Who can see it" reads this and
      // nothing else (shared/share-stamp.js) — the alternative is one REVIEW
      // read per version per set on every list load.
      share: item.share && typeof item.share === 'object' ? item.share : null,
```

- [ ] **Step 4: Run the test and the neighbours**

Run: `node tests/share-projection.js && node tests/set-versioning-flow.js | tail -2 && node tests/question-set-ownership.js | tail -2`
Expected: `2 passed, 0 failed`; neighbours unchanged.

- [ ] **Step 5: Commit**

```bash
git add lambda-functions/admin/get-set-versions.js lambda-functions/admin/get-question-sets.js tests/share-projection.js
git commit -m "The version list says where each version went; the set list carries the share stamp

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 14: The authorizer names the new routes

**Files:**
- Modify: `lambda-functions/auth/authorizer.js:473-478`
- Test: `tests/authorizer-set-routes.js`

**Interfaces:** `requiredGroupsForRoute(method, path)` returns `['hosts', 'admins']` for `question-sets/{setId}/check/{jobId}` and `question-sets/{setId}/appeal`, by template string and by regex over a concrete id — including ids that contain `join`, `answer`, `vote` or `games`.

- [ ] **Step 1: Write the failing test**

```js
// tests/authorizer-set-routes.js
/**
 * THE SET ROUTES DO NOT FALL THROUGH — spec §9, review finding R3.
 *
 * After the named set routes, authorizer.js has two generic rules:
 * `path.includes('games')` and `path.includes('join'|'answer'|'vote')` — the
 * second returns [] and hasPermission([]) is TRUE. A set slugged
 * `callandanswer` or `partygames` satisfies them by accident. Every route
 * added under question-sets/ must be matched before them, by template AND by
 * regex, or it is open to every token holder including `pending`.
 */
const path = require('path');
const assert = require('assert');
const { requiredGroupsForRoute } = require(path.join(__dirname, '..', 'lambda-functions/auth/authorizer.js'));
let pass = 0; let fail = 0;
const check = (name, fn) => { try { fn(); console.log(`  PASS  ${name}`); pass += 1; } catch (e) { console.log(`  FAIL  ${name}\n        ${e.message}`); fail += 1; } };
console.log('\nauthorizer: the set routes\n');
const TRAPS = ['callandanswer', 'partygames', 'joinery', 'votes', 'answers2026'];
const ROUTES = [
  ['POST', 'question-sets/{setId}/check', (id) => `question-sets/${id}/check`],
  ['GET', 'question-sets/{setId}/check/{jobId}', (id) => `question-sets/${id}/check/m1abc-xyz_9`],
  ['POST', 'question-sets/{setId}/appeal', (id) => `question-sets/${id}/appeal`],
  ['POST', 'question-sets/{setId}/publish', (id) => `question-sets/${id}/publish`],
  ['DELETE', 'question-sets/{setId}/publish', (id) => `question-sets/${id}/publish`],
];
for (const [method, template, concrete] of ROUTES) {
  check(`${method} ${template} requires a group by template`, () =>
    assert.deepStrictEqual(requiredGroupsForRoute(method, template), ['hosts', 'admins']));
  for (const id of TRAPS) {
    check(`${method} ${concrete(id)} requires a group despite the id`, () =>
      assert.deepStrictEqual(requiredGroupsForRoute(method, concrete(id)), ['hosts', 'admins'],
        'fell through to a generic includes() rule'));
  }
}
check('a set route nobody named is still not open by accident', () =>
  assert.notDeepStrictEqual(requiredGroupsForRoute('POST', 'question-sets/callandanswer/report'), []));
console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail) process.exit(1);
```

- [ ] **Step 2: Run it to see it fail**

Run: `node tests/authorizer-set-routes.js | grep -E 'FAIL|passed'`
Expected: the `check/{jobId}` and `appeal` cases with trap ids `FAIL` (they return `[]`); publish/check cases pass.

- [ ] **Step 3: Extend the rule**

Replace lines 473–478 of `authorizer.js` with:

```js
  // Template strings AND a regex over a concrete id, for the reason the copy
  // route gives. The poll (`check/{jobId}`) and the appeal were added with the
  // check job (docs/superpowers/specs/2026-09-17-public-library-moderation-design.md §9);
  // tests/authorizer-set-routes.js drives every one of these with set ids that
  // contain `answer`, `games`, `join` and `vote`.
  const PUBLISH_ROUTE = /^question-sets\/[^/]+\/(publish|check(\/[A-Za-z0-9_-]+)?|appeal)$/;
  if (path === 'question-sets/{setId}/publish'
    || path === 'question-sets/{setId}/check'
    || path === 'question-sets/{setId}/check/{jobId}'
    || path === 'question-sets/{setId}/appeal'
    || PUBLISH_ROUTE.test(path)) {
    return ['hosts', 'admins'];
  }
```

The last check in the test ("nobody named") passes today only because the trailing default requires a group — read the function's final `return` to confirm; if `report` under a trap id returns `[]`, the fix is in Stage 3 and this check should be moved there rather than weakened.

- [ ] **Step 4: Run the test and the authorizer suites**

Run: `node tests/authorizer-set-routes.js | tail -2 && node tests/authorizer-org-context.js | tail -2 && node tests/authorizer-identity-source.js | tail -2 && node tests/question-set-routes-authorization.js | tail -2`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add lambda-functions/auth/authorizer.js tests/authorizer-set-routes.js
git commit -m "The poll and the appeal are named in the authorizer, ahead of the rules a set id can satisfy

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 15: The template — routes, grants, environment, lifecycle

**Files:**
- Modify: `template-clean.yaml` (`CheckQuestionSetFunction` ≈ line 1092; `AIPromptsBucket`; a new `AppealQuestionSetFunction` after `PublishQuestionSetFunction`)
- Test: `tests/question-set-routes-authorization.js` (extend `MUST_BE_CLOSED`), `tests/template-validates.js`, `tests/kms-grants-match-code.js`, `sam validate --lint`

- [ ] **Step 1: Extend the parity suite first (it must fail)**

In `tests/question-set-routes-authorization.js` add to `MUST_BE_CLOSED`:

```js
  ['POST', '/question-sets/{setId}/check'],
  ['GET', '/question-sets/{setId}/check/{jobId}'],
  ['POST', '/question-sets/{setId}/appeal'],
  ['POST', '/question-sets/{setId}/publish'],
  ['DELETE', '/question-sets/{setId}/publish'],
```

Run: `node tests/question-set-routes-authorization.js | grep -E 'FAIL|passed'`
Expected: `GET /question-sets/{setId}/check/{jobId}` and `POST …/appeal` `FAIL` on "not in the template at all"; the literal-name checks for those two pass already (Task 14).

- [ ] **Step 2: Edit the check function**

In `CheckQuestionSetFunction`: set `Timeout: 900`; add to `Environment.Variables`:

```yaml
          AI_PROMPTS_BUCKET: !Ref AIPromptsBucket
          ACCOUNT_ID: !Ref AWS::AccountId
          CHECK_DAILY_CAP: '20'
```

(`CONTENT_GUARDRAIL_ID` / `CONTENT_GUARDRAIL_VERSION` are already global — line ~132; confirm with `grep -n CONTENT_GUARDRAIL_ID template-clean.yaml`). Extend `Policies` — keep the existing KMS and ApplyGuardrail statement and add, inside the same `Statement` list:

```yaml
            # THE WORKER. The POST self-invokes this function with
            # InvocationType 'Event' so the check runs against the 900s above
            # and never against the HTTP API's 30s ceiling.
            - Effect: Allow
              Action: lambda:InvokeFunction
              Resource: !Sub 'arn:aws:lambda:${AWS::Region}:${AWS::AccountId}:function:${StackName}-check-question-set'
            # The sentence 06-share-rejected.html promises: one Haiku call per
            # flagged question (shared/finding-explanations.js).
            - Effect: Allow
              Action:
                - bedrock:InvokeModel
              Resource:
                - !Sub 'arn:aws:bedrock:${AWS::Region}:${AWS::AccountId}:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0'
                - !Sub 'arn:aws:bedrock:*::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0'
```

then add beside `DynamoDBCrudPolicy`:

```yaml
        # The snapshot a person reviews (spec §3.3) lives under moderation/ in
        # the prompts bucket; the lifecycle rule below expires it in 30 days.
        - S3CrudPolicy:
            BucketName: !Ref AIPromptsBucket
```

Copy the exact `foundation-model` ARN form from the existing Haiku statement in the template (`grep -n 'claude-haiku-4-5' template-clean.yaml`) — if that statement lists only the inference profile, list only the inference profile. Add the poll route to `Events`:

```yaml
        CheckSetJob:
          Type: HttpApi
          Properties:
            ApiId: !Ref RestApi
            Path: /question-sets/{setId}/check/{jobId}
            Method: GET
            Auth:
              Authorizer: CognitoAuthorizer
```

- [ ] **Step 3: Add the appeal function**

After `PublishQuestionSetFunction`'s block:

```yaml
  AppealQuestionSetFunction:
    Type: AWS::Serverless::Function
    Properties:
      FunctionName: !Sub '${StackName}-appeal-question-set'
      CodeUri: lambda-functions/admin/
      Runtime: nodejs22.x
      Timeout: 30
      Handler: appeal-question-set.handler
      Environment:
        Variables:
          TABLE_NAME: !Ref GameTable
      Policies:
        # Decrypt only: it reads the set's name for the queue pointer and
        # writes nothing into an org partition but the plaintext share stamp.
        - Version: '2012-10-17'
          Statement:
            - Effect: Allow
              Action: [ kms:Decrypt ]
              Resource: !GetAtt TenantKey.Arn
        - DynamoDBCrudPolicy:
            TableName: !Ref GameTable
      Events:
        AppealSet:
          Type: HttpApi
          Properties:
            ApiId: !Ref RestApi
            Path: /question-sets/{setId}/appeal
            Method: POST
            Auth:
              Authorizer: CognitoAuthorizer
      Tags:
        Environment: !Ref Environment
        StackName: !Ref StackName
```

- [ ] **Step 4: The bucket lifecycle rule**

In `AIPromptsBucket.Properties` add:

```yaml
      LifecycleConfiguration:
        Rules:
          # Moderation snapshots (spec D9): deleted on decision by the handler;
          # this is the backstop for one that was never decided.
          - Id: moderation-snapshots-30d
            Status: Enabled
            Prefix: moderation/
            ExpirationInDays: 30
            NoncurrentVersionExpiration:
              NoncurrentDays: 30
```

- [ ] **Step 5: Validate everything**

Run:
```bash
node tests/question-set-routes-authorization.js | tail -2 && node tests/template-validates.js | tail -2 && node tests/kms-grants-match-code.js | tail -2 && node tests/cors-allows-sent-headers.js | tail -2 && rm -rf .aws-sam && sam validate --template template-clean.yaml --region us-east-1 --lint 2>&1 | tail -3
```
Expected: all pass; `sam validate` prints the template is valid. If `kms-grants-match-code.js` names `appeal-question-set.js`, it is because the handler requires `tenant-crypto` — the grant above satisfies it.

- [ ] **Step 6: Commit**

```bash
git add template-clean.yaml tests/question-set-routes-authorization.js
git commit -m "The check function self-invokes, keeps its snapshot in S3, and asks Haiku; the appeal route exists

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 16: `utils/shareState.js` and `utils/checkJob.js` — the client's two pure readers

**Files:**
- Create: `src/src/utils/shareState.js`, `src/src/utils/checkJob.js`
- Test: `src/src/__tests__/shareState.test.js`, `src/src/__tests__/checkJob.test.js`

**Interfaces:**
- `shareStateOf(set, nowMs = Date.now()) → { key, label, title }` with `key ∈ private | public | behind | checking | unfinished | flagged | waiting | passed`. Reads `set.share` (the stamp) and `set.activeVersion`. `STALE_CHECK_MS = 15 * 60 * 1000` mirrors the server.
- `versionChip(entry) → { key, label }` for a Versions-panel entry (`entry.review`, `entry.published`, `entry.unfinished`): `public | flagged | checking | unfinished | waiting | passed | unshared`.
- `interpretCheckJob(job) → { outcome: running | passed | flagged | escalated | failed, phase, completed, requested, meta, error, terminal }` — reads `job.status` and `job.meta.outcome`; never derives the outcome from `items.length` (a clean pass has zero items).

- [ ] **Step 1: Write the failing tests**

```js
// src/src/__tests__/shareState.test.js
import { shareStateOf, versionChip, STALE_CHECK_MS } from '../utils/shareState';

const NOW = Date.parse('2026-09-17T10:20:00.000Z');
const at = (minutesAgo) => new Date(NOW - minutesAgo * 60000).toISOString();

describe('shareStateOf — the "Who can see it" column', () => {
  test('no stamp is private', () => {
    expect(shareStateOf({}).key).toBe('private');
    expect(shareStateOf({ share: null }).label).toBe('Private');
  });
  test('a published stamp at the active version is public, and names the version', () => {
    const s = shareStateOf({ activeVersion: 2, share: { status: 'published', version: 2, publicVersion: 1, at: at(60) } });
    expect(s).toMatchObject({ key: 'public', label: 'Public v2' });
  });
  test('a newer active version than the published one reads as behind, naming both', () => {
    const s = shareStateOf({ activeVersion: 3, share: { status: 'published', version: 2, at: at(60) } });
    expect(s.key).toBe('behind');
    expect(s.label).toBe('Public, behind (v3 not shared)');
    expect(s.title).toMatch(/v2 is public/);
  });
  test('checking is running inside fifteen minutes and unfinished after', () => {
    expect(shareStateOf({ share: { status: 'checking', version: 2, at: at(5) } }, NOW).key).toBe('checking');
    expect(shareStateOf({ share: { status: 'checking', version: 2, at: at(16) } }, NOW)).toMatchObject({ key: 'unfinished', label: "Didn't finish" });
    expect(STALE_CHECK_MS).toBe(15 * 60 * 1000);
  });
  test('flagged is needs changes; escalated and appealed are waiting for Engage; passed is checked', () => {
    expect(shareStateOf({ share: { status: 'flagged', version: 2 } }).label).toBe('Needs changes');
    expect(shareStateOf({ share: { status: 'escalated', version: 2 } }).label).toBe('Waiting for Engage');
    expect(shareStateOf({ share: { status: 'appealed', version: 2 } }).key).toBe('waiting');
    expect(shareStateOf({ share: { status: 'passed', version: 2 } }).label).toBe('Checked');
    expect(shareStateOf({ share: { status: 'unpublished' } }).key).toBe('private');
  });
});
describe('versionChip — the Versions panel', () => {
  test('a version that went public says so; the rest follow the review', () => {
    expect(versionChip({ review: 'passed', published: { publicVersion: 1 } })).toEqual({ key: 'public', label: 'public' });
    expect(versionChip({ review: 'flagged', published: null })).toEqual({ key: 'flagged', label: 'needs changes' });
    expect(versionChip({ review: 'checking', published: null, unfinished: false })).toEqual({ key: 'checking', label: 'checking…' });
    expect(versionChip({ review: 'checking', published: null, unfinished: true })).toEqual({ key: 'unfinished', label: "didn't finish" });
    expect(versionChip({ review: 'escalated', published: null })).toEqual({ key: 'waiting', label: 'waiting for Engage' });
    expect(versionChip({ review: 'unreviewed', published: null })).toEqual({ key: 'unshared', label: 'not shared' });
  });
});
```

```js
// src/src/__tests__/checkJob.test.js
import { interpretCheckJob } from '../utils/checkJob';

describe('interpretCheckJob', () => {
  test('a running job is running whatever its items say', () => {
    expect(interpretCheckJob({ status: 'running', phase: 'Checking 4 of 30', completed: 4, requested: 30, items: [] }))
      .toMatchObject({ outcome: 'running', terminal: false, phase: 'Checking 4 of 30', completed: 4, requested: 30 });
  });
  test('a complete job reports the worker\'s outcome, not the item count', () => {
    expect(interpretCheckJob({ status: 'complete', items: [], meta: { outcome: 'passed', publicSetId: 'x-y', publicVersion: 1 } }))
      .toMatchObject({ outcome: 'passed', terminal: true, meta: { publicSetId: 'x-y' } });
    expect(interpretCheckJob({ status: 'complete', items: [{ questionId: 'q1' }], meta: { outcome: 'flagged' } }).outcome).toBe('flagged');
    expect(interpretCheckJob({ status: 'complete', items: [], meta: { outcome: 'escalated', reasons: ['declared'] } }).outcome).toBe('escalated');
  });
  test('an errored job is failed with its message', () => {
    expect(interpretCheckJob({ status: 'error', errorMessage: 'The check could not finish: boom' }))
      .toMatchObject({ outcome: 'failed', terminal: true, error: 'The check could not finish: boom' });
  });
  test('nothing at all is running', () => {
    expect(interpretCheckJob(null).outcome).toBe('running');
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd src && CI=true npx jest __tests__/shareState.test.js __tests__/checkJob.test.js 2>&1 | tail -6; cd ..`
Expected: both suites fail with `Cannot find module`.

- [ ] **Step 3: Write the modules**

```js
// src/src/utils/shareState.js
/**
 * "WHO CAN SEE IT" — the one place the share stamp is turned into words.
 *
 * The stamp (`set.share`) is written by the server on every event of the
 * share lifecycle (lambda-functions/admin/shared/share-stamp.js). The list
 * reads it and nothing else, so the list does not become one read per version
 * per set. `STALE_CHECK_MS` mirrors set-review.js: a `checking` older than this
 * did not finish, and saying "checking…" for it would be an empty state that
 * lies.
 */
export const STALE_CHECK_MS = 15 * 60 * 1000;

const PRIVATE = { key: 'private', label: 'Private', title: 'Only your organisation can see this set.' };

export function shareStateOf(set, nowMs = Date.now()) {
  const share = set && set.share && typeof set.share === 'object' ? set.share : null;
  if (!share || !share.status) return PRIVATE;
  const active = Number(set.activeVersion) || null;
  const shared = Number(share.version) || null;
  switch (share.status) {
    case 'published': {
      if (active && shared && active > shared) {
        return {
          key: 'behind',
          label: `Public, behind (v${active} not shared)`,
          title: `v${shared} is public; your v${active} has not been shared. Submit it for review to update the library.`,
        };
      }
      return { key: 'public', label: `Public v${shared || ''}`.trim(), title: 'In the public library. Anyone using Engage can read and copy it.' };
    }
    case 'checking': {
      const age = share.at ? nowMs - Date.parse(share.at) : 0;
      return age > STALE_CHECK_MS
        ? { key: 'unfinished', label: "Didn't finish", title: 'The content check did not finish. Submit it again.' }
        : { key: 'checking', label: 'Checking…', title: 'The content check is running.' };
    }
    case 'flagged':
      return { key: 'flagged', label: 'Needs changes', title: 'Not published. Open the set to see exactly what was flagged.' };
    case 'escalated':
    case 'appealed':
      return { key: 'waiting', label: 'Waiting for Engage', title: 'A person at Engage is looking at this version. The outcome will show here.' };
    case 'passed':
      return { key: 'passed', label: 'Checked', title: 'Passed the content check and not published.' };
    default:
      return PRIVATE;
  }
}

/** The chip beside a version in the editor's Versions panel. */
export function versionChip(entry) {
  if (entry && entry.published) return { key: 'public', label: 'public' };
  switch (entry && entry.review) {
    case 'flagged': return { key: 'flagged', label: 'needs changes' };
    case 'checking': return entry.unfinished ? { key: 'unfinished', label: "didn't finish" } : { key: 'checking', label: 'checking…' };
    case 'escalated':
    case 'appealed': return { key: 'waiting', label: 'waiting for Engage' };
    case 'passed': return { key: 'passed', label: 'checked' };
    default: return { key: 'unshared', label: 'not shared' };
  }
}
```

```js
// src/src/utils/checkJob.js
/**
 * THE CHECK JOB, READ. `interpretGenerationJob` decides "complete vs empty
 * failure" from `items.length`, which is right for a generator and wrong here:
 * a clean pass has ZERO items. The worker writes its verdict to `meta.outcome`
 * (lambda-functions/admin/shared/set-check-worker.js) and that is what this reads.
 */
export function interpretCheckJob(job) {
  const j = job && typeof job === 'object' ? job : {};
  const status = typeof j.status === 'string' ? j.status : '';
  const meta = j.meta && typeof j.meta === 'object' ? j.meta : {};
  let outcome = 'running';
  if (status === 'error') outcome = 'failed';
  else if (status === 'complete') outcome = ['passed', 'flagged', 'escalated'].includes(meta.outcome) ? meta.outcome : 'failed';
  return {
    outcome,
    terminal: outcome !== 'running',
    phase: j.phase || '',
    completed: Number(j.completed) || 0,
    requested: Number(j.requested) || 0,
    items: Array.isArray(j.items) ? j.items : [],
    meta,
    error: j.errorMessage || j.error || null,
    jobId: j.jobId || null,
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `cd src && CI=true npx jest __tests__/shareState.test.js __tests__/checkJob.test.js 2>&1 | tail -4; cd ..`
Expected: both suites pass (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/src/utils/shareState.js src/src/utils/checkJob.js src/src/__tests__/shareState.test.js src/src/__tests__/checkJob.test.js
git commit -m "The client reads the share stamp and the check job in one place each

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 17: The list — "Who can see it", and Share

**Files:**
- Modify: `src/src/components/QuestionSetsPanel.jsx` (props ≈ `:100-135`; the `<thead>` ≈ `:330-340`; the row ≈ `:400-520`), `src/src/components/QuestionSetsPanel.css` (`:309-327` chip variants; add a column width)
- Test: `src/src/__tests__/questionSetsPanel.test.jsx` (new `describe`), `src/src/__tests__/questionSetsPalette.test.js` (one pairing)

**Interfaces:**
- New props: `showVisibility = false` (org consoles only — AdminPage passes `Boolean(activeOrg)`), `onShare` (`(set) => void`; the row action renders only when `onShare` is given AND `set.canManage !== false` AND `showVisibility`).
- The column header is `Who can see it`; the cell is `<span className="qsets-chip qsets-chip--vis-<key>" title={title}>{label}</span>` from `shareStateOf(set)`.

- [ ] **Step 1: Write the failing tests**

Append to `src/src/__tests__/questionSetsPanel.test.jsx`:

```js
describe('who can see it', () => {
  const NOW = Date.parse('2026-09-17T10:20:00.000Z');
  const VIS = [
    { ...SETS[0], id: 'priv', name: 'Private one', canManage: true },
    { ...SETS[0], id: 'pub', name: 'Public one', canManage: true, activeVersion: 2, share: { status: 'published', version: 2, publicVersion: 1, at: '2026-09-17T09:00:00.000Z' } },
    { ...SETS[0], id: 'flag', name: 'Flagged one', canManage: true, share: { status: 'flagged', version: 2, at: '2026-09-17T09:00:00.000Z' } },
    { ...SETS[0], id: 'engage', name: 'Engage one', canManage: false, scope: 'platform' },
  ];
  beforeAll(() => { jest.spyOn(Date, 'now').mockReturnValue(NOW); });
  afterAll(() => { Date.now.mockRestore(); });
  test('the column is absent unless the console asks for it', () => {
    mount({ questionSets: VIS });
    expect(screen.queryByRole('columnheader', { name: /who can see it/i })).toBeNull();
    expect(screen.queryByText('Needs changes')).toBeNull();
  });
  test('each row says who can see it, from the share stamp', () => {
    mount({ questionSets: VIS, showVisibility: true });
    expect(screen.getByRole('columnheader', { name: /who can see it/i })).toBeInTheDocument();
    expect(within(rowFor('Private one')).getByText('Private')).toBeInTheDocument();
    expect(within(rowFor('Public one')).getByText('Public v2')).toBeInTheDocument();
    expect(within(rowFor('Flagged one')).getByText('Needs changes')).toHaveAttribute('title', expect.stringMatching(/what was flagged/));
  });
  test('Share is offered on rows you manage, and calls back with the set', () => {
    const onShare = jest.fn();
    mount({ questionSets: VIS, showVisibility: true, onShare });
    fireEvent.click(within(rowFor('Private one')).getByRole('button', { name: /^share$/i }));
    expect(onShare).toHaveBeenCalledWith(expect.objectContaining({ id: 'priv' }));
    expect(within(rowFor('Engage one')).queryByRole('button', { name: /^share$/i })).toBeNull();
  });
  test('without onShare there is no Share button, even with the column', () => {
    mount({ questionSets: VIS, showVisibility: true });
    expect(screen.queryByRole('button', { name: /^share$/i })).toBeNull();
  });
});
```

Add to `questionSetsPalette.test.js`'s `pairs` array:

```js
    ['--secondary on the work field (the Waiting for Engage chip)', T.secondary, FIELD],
```

and to `T`: `secondary: token(GLOBAL_CSS, ROOT, '--secondary'),`.

- [ ] **Step 2: Run them to see them fail**

Run: `cd src && CI=true npx jest __tests__/questionSetsPanel.test.jsx __tests__/questionSetsPalette.test.js 2>&1 | grep -E '✕|Tests:'; cd ..`
Expected: the four new list tests fail (no column, no button); the palette pairing passes already (it is a token check) — that is fine, it pins the colour the CSS below uses.

- [ ] **Step 3: Implement**

In `QuestionSetsPanel.jsx`: import `{ shareStateOf } from '../utils/shareState'`; add the two props after `onCopy`:

```jsx
  /**
   * The share lifecycle, org consoles only. `showVisibility` adds the "Who
   * can see it" column read from the server's share stamp (utils/shareState);
   * `onShare` adds the row action that opens the share dialog. Engage's own
   * library never goes through this pipeline, so the platform console passes
   * neither.
   */
  showVisibility = false,
  onShare,
```

In `<thead>` after the `State` header: `{showVisibility && <th className="qsets-col-vis">Who can see it</th>}`. In the row, after the `State` cell (the one holding the owner chip), add:

```jsx
                      {showVisibility && (() => {
                        const vis = shareStateOf(set);
                        return (
                          <td className="qsets-vis">
                            <span className={`qsets-chip qsets-chip--vis-${vis.key}`} title={vis.title}>{vis.label}</span>
                          </td>
                        );
                      })()}
```

In the `canManage !== false` action group, before the Delete button:

```jsx
                              {showVisibility && onShare && (
                                <button
                                  type="button"
                                  className="qsets-btn qsets-btn--sm"
                                  onClick={() => onShare(set)}
                                  title="Submit the active version for the content check; it goes public if it passes"
                                >
                                  Share
                                </button>
                              )}
```

In `QuestionSetsPanel.css` after line 327:

```css
/* "Who can see it" (utils/shareState.js). Six values, three tones: the quiet
   ones borrow --muted, the ones that need an action borrow --primary, the one
   that is somebody else's turn borrows --secondary (7.0:1 on --bg, asserted). */
.qsets-col-vis { width: 15%; }
.qsets-chip--vis-private { color: var(--muted); border-style: dashed; }
.qsets-chip--vis-public { color: var(--qsets-success-text); border-color: rgba(79, 178, 134, .5); }
.qsets-chip--vis-behind,
.qsets-chip--vis-flagged,
.qsets-chip--vis-unfinished { color: var(--primary); border-color: rgba(246, 169, 76, .5); }
.qsets-chip--vis-checking,
.qsets-chip--vis-passed { color: var(--muted); }
.qsets-chip--vis-waiting { color: var(--secondary); border-color: rgba(124, 167, 230, .5); }
```

Check the table's `table-layout: fixed` column widths still sum sensibly (`.qsets-col-*` rules near `:280`): reduce `.qsets-col-set` by 15% when the column is present is not possible in CSS alone, so instead make the visibility column take from the description: set `.qsets-col-vis { width: 13% }` and `.qsets-col-set { width: 33% }` if the set column was 46%. Read the existing widths and keep the total ≤ 100%.

- [ ] **Step 4: Run the suites**

Run: `cd src && CI=true npx jest __tests__/questionSetsPanel.test.jsx __tests__/questionSetsPalette.test.js __tests__/rowActionsReachable.test.js 2>&1 | grep -E '✕|Tests:'; cd ..`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/src/components/QuestionSetsPanel.jsx src/src/components/QuestionSetsPanel.css src/src/__tests__/questionSetsPanel.test.jsx src/src/__tests__/questionSetsPalette.test.js
git commit -m "The set list says who can see each set, and offers Share on the rows you manage

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 18: `ShareSetDialog` — `05`

**Files:**
- Create: `src/src/components/ShareSetDialog.jsx`, `src/src/components/ShareSetDialog.css`
- Test: `src/src/__tests__/shareSetDialog.test.jsx`, `src/src/__tests__/sharePalette.test.js`; register `['ShareSetDialog', 'share']` in `src/src/__tests__/scopedClassesDeclared.test.js`

**Interfaces:**
- Props: `set` (a list row: `id`, `name`, `engagementType`, `totalQuestions`, `activeVersion`, `promptId`), `version` (number | null → active), `onClose()`, `onOutcome({ outcome, meta })` (called once when the job goes terminal, whether or not the dialog is still open), `onNeedsChanges()` (called for `flagged`; AdminPage opens the editor).
- Network: `POST ${adminApiUrl('question-sets/<id>/check')}` body `{ version, publish: true }`; poll with `pollGenerationJob(adminApiUrl('question-sets/<id>/check'), jobId, { label: 'Content check', onProgress })`; outcome via `interpretCheckJob`.
- States: `idle` → `submitting` → `running` → `passed | escalated | flagged | failed`; `409` → an inline sentence, stays idle; `429` → sentence; other errors → `StatusMessage`.

- [ ] **Step 1: Write the failing tests**

```jsx
// src/src/__tests__/shareSetDialog.test.jsx
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
jest.mock('../auth/authFetch', () => ({ __esModule: true, authFetch: (...args) => global.fetch(...args) }));
jest.mock('../utils/aiBatchClient', () => ({
  __esModule: true,
  pollGenerationJob: jest.fn(),
}));
import { pollGenerationJob } from '../utils/aiBatchClient';
import ShareSetDialog from '../components/ShareSetDialog';

const SET = { id: 'safety', name: 'Safety walkthrough', engagementType: 'trivia', totalQuestions: 30, activeVersion: 2 };
const jsonResponse = (status, body) => Promise.resolve({ ok: status < 400, status, json: async () => body });
beforeEach(() => { window.API_BASE = 'https://api.test/'; global.fetch = jest.fn(); pollGenerationJob.mockReset(); });

test('reads like the mockup, and has an X and a Cancel that both close', () => {
  const onClose = jest.fn();
  render(<ShareSetDialog set={SET} onClose={onClose} onOutcome={() => {}} />);
  expect(screen.getByRole('heading', { name: /share “Safety walkthrough” publicly/i })).toBeInTheDocument();
  expect(screen.getByText(/every question is checked first/i)).toBeInTheDocument();
  expect(screen.getByText(/goes to a person at Engage/i)).toBeInTheDocument();
  expect(screen.getByText(/publishing copies the set/i)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /^close$/i }));
  fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
  expect(onClose).toHaveBeenCalledTimes(2);
});
test('submit posts the version with publish, then polls, then says it is in the library', async () => {
  global.fetch.mockReturnValueOnce(jsonResponse(202, { jobId: 'j1', version: 2, status: 'queued' }));
  pollGenerationJob.mockImplementation(async (url, jobId, { onProgress }) => {
    onProgress({ status: 'running', phase: 'Checking 12 of 30', completed: 12, requested: 30 });
    return { status: 'complete', items: [], meta: { outcome: 'passed', publicSetId: 'orgacme-safety', publicVersion: 1 } };
  });
  const onOutcome = jest.fn();
  render(<ShareSetDialog set={SET} onClose={() => {}} onOutcome={onOutcome} />);
  fireEvent.click(screen.getByRole('button', { name: /submit for review/i }));
  expect(global.fetch).toHaveBeenCalledWith('https://api.test/question-sets/safety/check', expect.objectContaining({ method: 'POST', body: JSON.stringify({ version: 2, publish: true }) }));
  await screen.findByText(/now in the public library/i);
  expect(pollGenerationJob).toHaveBeenCalledWith('https://api.test/question-sets/safety/check', 'j1', expect.objectContaining({ label: 'Content check' }));
  expect(onOutcome).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'passed' }));
});
test('escalated says a person has it and where the outcome will show — never "you will hear back"', async () => {
  global.fetch.mockReturnValueOnce(jsonResponse(202, { jobId: 'j2', version: 2 }));
  pollGenerationJob.mockResolvedValue({ status: 'complete', items: [], meta: { outcome: 'escalated', reasons: ['guardrail'] } });
  render(<ShareSetDialog set={SET} onClose={() => {}} onOutcome={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: /submit for review/i }));
  const p = await screen.findByText(/gone to a person at Engage/i);
  expect(p.textContent).toMatch(/outcome will show on this set's row/i);
  expect(document.body.textContent).not.toMatch(/hear back/i);
});
test('flagged closes onto the editor via onNeedsChanges', async () => {
  global.fetch.mockReturnValueOnce(jsonResponse(202, { jobId: 'j3', version: 2 }));
  pollGenerationJob.mockResolvedValue({ status: 'complete', items: [{ questionId: 'q014', category: 'VIOLENCE', band: 'HIGH' }], meta: { outcome: 'flagged' } });
  const onNeedsChanges = jest.fn();
  render(<ShareSetDialog set={SET} onClose={() => {}} onOutcome={() => {}} onNeedsChanges={onNeedsChanges} />);
  fireEvent.click(screen.getByRole('button', { name: /submit for review/i }));
  await waitFor(() => expect(onNeedsChanges).toHaveBeenCalled());
});
test('409 and 429 are sentences, not errors, and leave Submit available', async () => {
  global.fetch.mockReturnValueOnce(jsonResponse(409, { error: 'This version is already being checked.', status: 'checking' }));
  render(<ShareSetDialog set={SET} onClose={() => {}} onOutcome={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: /submit for review/i }));
  await screen.findByText(/already being checked/i);
  expect(screen.getByRole('button', { name: /submit for review/i })).toBeEnabled();
  global.fetch.mockReturnValueOnce(jsonResponse(429, { error: "This organisation has used today's 20 checks. Try again tomorrow.", cap: 20 }));
  fireEvent.click(screen.getByRole('button', { name: /submit for review/i }));
  await screen.findByText(/used today's 20 checks/i);
});
test('closing while the job runs keeps it running and still reports the outcome', async () => {
  global.fetch.mockReturnValueOnce(jsonResponse(202, { jobId: 'j4', version: 2 }));
  let finish;
  pollGenerationJob.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const onClose = jest.fn(); const onOutcome = jest.fn();
  const { unmount } = render(<ShareSetDialog set={SET} onClose={onClose} onOutcome={onOutcome} />);
  fireEvent.click(screen.getByRole('button', { name: /submit for review/i }));
  await screen.findByText(/checking/i);
  expect(screen.getByText(/closing this keeps the check running/i)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /^close$/i }));
  expect(onClose).toHaveBeenCalled();
  unmount();
  await act(async () => { finish({ status: 'complete', items: [], meta: { outcome: 'passed' } }); });
  expect(onOutcome).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'passed' }));
});
```

```js
// src/src/__tests__/sharePalette.test.js
/* The share dialog's paint stack: every pairing composited and asserted ≥ AA.
   Same harness as questionSetsPalette.test.js. */
const fs = require('fs');
const path = require('path');
const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const GLOBAL_CSS = read('styles.css');
const CSS = read('components', 'ShareSetDialog.css');
function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function lum(c) { return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]); }
function ratio(a, b) { const la = lum(a); const lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); }
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16));
function token(css, block, name) {
  const start = css.indexOf(block); const body = css.slice(start, css.indexOf('}', start));
  const m = body.match(new RegExp(`${name}\\s*:\\s*(#[0-9A-Fa-f]{6})`));
  if (!m) throw new Error(`${name} not in ${block}`);
  return m[1];
}
const DUSK = '[data-theme="dark"] {'; const ROOT = ':root {';
const T = { bg: token(GLOBAL_CSS, DUSK, '--bg'), surface: token(GLOBAL_CSS, DUSK, '--surface'), text: token(GLOBAL_CSS, DUSK, '--text'), muted: token(GLOBAL_CSS, DUSK, '--muted'), primary: token(GLOBAL_CSS, ROOT, '--primary'), dangerText: token(GLOBAL_CSS, ROOT, '--danger-text'), success: token(CSS, '.share {', '--share-success-text') };
const AA = 4.5;
describe('ShareSetDialog palette', () => {
  test.each([
    ['--text on --surface', T.text, T.surface],
    ['--muted on --surface', T.muted, T.surface],
    ['--primary on --surface', T.primary, T.surface],
    ['--danger-text on --surface', T.dangerText, T.surface],
    ['--share-success-text on --surface', T.success, T.surface],
    ['--bg on --primary (the filled Submit)', T.bg, T.primary],
  ])('%s clears AA', (_l, fg, bg) => expect(ratio(hex(fg), hex(bg))).toBeGreaterThanOrEqual(AA));
  test('every selector is rooted at .share, no hex outside the token block, no --danger as text, nothing under 12px', () => {
    const stripped = CSS.replace(/\/\*[\s\S]*?\*\//g, ' ');
    const tokenBlock = stripped.slice(stripped.indexOf('.share {'), stripped.indexOf('}', stripped.indexOf('.share {')));
    const outside = stripped.replace(tokenBlock, '');
    expect(outside.match(/#[0-9A-Fa-f]{3,6}\b/g) || []).toEqual([]);
    expect(stripped).not.toMatch(/color:\s*var\(--danger\)/);
    for (const m of stripped.matchAll(/(\d+(?:\.\d+)?)px/g)) { if (/font-size/.test(stripped.slice(Math.max(0, m.index - 40), m.index))) expect(Number(m[1])).toBeGreaterThanOrEqual(12); }
    for (const sel of stripped.matchAll(/(^|\})\s*([^{@}]+)\{/g)) {
      for (const part of sel[2].split(',')) expect(part.trim()).toMatch(/^\.share(\b|-)/);
    }
    expect(GLOBAL_CSS).not.toMatch(/\.share(\b|-)/);
  });
});
```

Add `['ShareSetDialog', 'share'],` to `SURFACES` in `scopedClassesDeclared.test.js`.

- [ ] **Step 2: Run them to see them fail**

Run: `cd src && CI=true npx jest __tests__/shareSetDialog.test.jsx __tests__/sharePalette.test.js __tests__/scopedClassesDeclared.test.js 2>&1 | grep -E '✕|Tests:'; cd ..`
Expected: all three fail (`Cannot find module`, missing stylesheet).

- [ ] **Step 3: Write the component and its stylesheet**

```jsx
// src/src/components/ShareSetDialog.jsx
import React, { useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import Modal from './Modal';
import StatusMessage from './StatusMessage';
import { authFetch } from '../auth/authFetch';
import { adminApiUrl } from '../utils/adminApi';
import { pollGenerationJob } from '../utils/aiBatchClient';
import { interpretCheckJob } from '../utils/checkJob';
import { gameTypeLabel } from '../config/gameTypes';
import './ShareSetDialog.css';

/**
 * SHARING A SET PUBLICLY — docs/design/tenancy-redesign/05-share-review.html.
 *
 * The copy is the mockup's, verbatim, because it is the promise the backend
 * keeps: every question is checked first; pass → the library; flagged → the
 * questions and why; unsure → a person at Engage. One addition (spec §10.1):
 * the Workie note, when the set's prompt is not one of Engage's.
 *
 * The check is a JOB. Submit answers 202 and this dialog becomes the progress
 * panel; closing it keeps the job running — the outcome lands in rows, not in
 * this window — so `onOutcome` fires even after unmount and the list refreshes.
 * "You'll hear back" is never said: there is no channel that could keep it.
 */
const checkUrl = (setId) => adminApiUrl(`question-sets/${encodeURIComponent(setId)}/check`);

export default function ShareSetDialog({ set, version = null, onClose, onOutcome, onNeedsChanges }) {
  const [state, setState] = useState('idle');       // idle | submitting | running | passed | escalated | failed
  const [note, setNote] = useState('');              // the 409/429 sentence
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState({ phase: '', completed: 0, requested: 0 });
  const [meta, setMeta] = useState({});
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  const safe = (fn) => { if (mounted.current) fn(); };

  const targetVersion = version || set.activeVersion || null;
  const busy = state === 'submitting' || state === 'running';
  const canClose = () => true; // closing keeps the job running

  const submit = async () => {
    setNote(''); setError(null); setState('submitting');
    let jobId;
    try {
      const res = await authFetch(checkUrl(set.id), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: targetVersion, publish: true }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409 || res.status === 429) { setNote(body.error || 'Not right now.'); setState('idle'); return; }
      if (!res.ok) { setError(body.error || `The check could not start (${res.status}).`); setState('idle'); return; }
      jobId = body.jobId;
    } catch (e) {
      setError(`The check could not start: ${e.message}`); setState('idle'); return;
    }
    setState('running');
    let job;
    try {
      job = await pollGenerationJob(checkUrl(set.id), jobId, {
        label: 'Content check',
        onProgress: (j) => safe(() => setProgress({ phase: j.phase || '', completed: j.completed || 0, requested: j.requested || 0 })),
      });
    } catch (e) {
      safe(() => { setError(e.message); setState('failed'); });
      return;
    }
    const read = interpretCheckJob(job);
    if (onOutcome) onOutcome({ outcome: read.outcome, meta: read.meta, items: read.items });
    if (read.outcome === 'flagged') { if (onNeedsChanges) onNeedsChanges(read); safe(() => onClose && onClose()); return; }
    safe(() => { setMeta(read.meta || {}); setError(read.error); setState(read.outcome === 'failed' ? 'failed' : read.outcome); });
  };

  return (
    <Modal
      overlayClassName="share share-scrim"
      contentClassName="share-card"
      labelledBy="share-title"
      onClose={() => onClose && onClose()}
      closeOnBackdrop={canClose}
      closeOnEscape={canClose}
    >
      <header className="share-head">
        <h2 id="share-title">Share “{set.name}” publicly</h2>
        <button type="button" className="share-x" onClick={() => onClose && onClose()} aria-label="Close" title="Close">×</button>
      </header>

      {state === 'idle' || state === 'submitting' ? (
        <div className="share-body">
          <p className="share-sub">
            {gameTypeLabel(set.engagementType)} · {set.totalQuestions || 0} questions · version {targetVersion || '—'}
          </p>
          <p>Anyone using Engage will be able to find this set, read every question in it, and copy it into their own team.</p>
          <div className="share-callout">
            <strong>Every question is checked first.</strong> An automated review reads the whole set looking for material
            that should not be published without a person seeing it: violence, sexual content, harassment, and content that
            targets a group. It usually finishes in under a minute.
          </div>
          <dl className="share-outcomes">
            <dt>If it passes</dt><dd>The set appears in the public library. You can unpublish it at any time.</dd>
            <dt>If something is flagged</dt><dd>Nothing is published. You get the specific questions and the reason for each, and you can edit and resubmit.</dd>
            <dt>If the check is unsure</dt><dd>It goes to a person at Engage. The outcome will show on this set's row.</dd>
          </dl>
          {set.promptId && set.promptScope !== 'platform' && (
            <p className="share-note">Published without your Workie — Engage's default is used for the public copy.</p>
          )}
          <p className="share-fine">Publishing copies the set. The public copy does not change when you edit yours, and nobody who copies it can change yours.</p>
          {note && <p className="share-note" role="status">{note}</p>}
          <StatusMessage message={error} tone="error" className="share-alert" />
          <footer className="share-foot">
            <button type="button" className="share-btn" onClick={() => onClose && onClose()}>Cancel</button>
            <button type="button" className="share-btn share-btn--primary" onClick={submit} disabled={busy}>
              {state === 'submitting' ? 'Starting…' : 'Submit for review'}
            </button>
          </footer>
        </div>
      ) : null}

      {state === 'running' && (
        <div className="share-body share-running" aria-live="polite">
          <p className="share-bignum">
            {progress.completed}{progress.requested > 0 && <span className="share-of"> / {progress.requested}</span>}
          </p>
          <p className="share-phase">{progress.phase || 'Checking…'}</p>
          <p className="share-fine">Closing this keeps the check running. The outcome shows on this set's row.</p>
          <footer className="share-foot">
            <button type="button" className="share-btn" onClick={() => onClose && onClose()}>Close — this keeps running</button>
          </footer>
        </div>
      )}

      {state === 'passed' && (
        <div className="share-body share-done">
          <p className="share-result share-result--ok"><Icon name="CheckCircle" weight="fill" size={18} color="var(--share-success-text)" /> Now in the public library{meta.publicVersion ? ` as version ${meta.publicVersion}` : ''}.</p>
          {meta.promptDropped && <p className="share-fine">Published without your Workie — Engage's default is used.</p>}
          <footer className="share-foot"><button type="button" className="share-btn share-btn--primary" onClick={() => onClose && onClose()}>Done</button></footer>
        </div>
      )}
      {state === 'escalated' && (
        <div className="share-body share-done">
          <p className="share-result"><Icon name="UserCircle" weight="fill" size={18} color="var(--primary)" /> Gone to a person at Engage. The outcome will show on this set's row.</p>
          <footer className="share-foot"><button type="button" className="share-btn share-btn--primary" onClick={() => onClose && onClose()}>Done</button></footer>
        </div>
      )}
      {state === 'failed' && (
        <div className="share-body share-done">
          <StatusMessage message={error || 'The check did not finish. Submit it again.'} tone="error" className="share-alert" />
          <footer className="share-foot">
            <button type="button" className="share-btn" onClick={() => onClose && onClose()}>Close</button>
            <button type="button" className="share-btn share-btn--primary" onClick={() => setState('idle')}>Try again</button>
          </footer>
        </div>
      )}
    </Modal>
  );
}
```

`set.promptScope` is not projected today; the note therefore renders whenever `promptId` is set and the projection says nothing — until `get-question-sets.js` projects `promptScope` (a Stage 2 item), which makes the condition exact. Note it in the component comment.

```css
/* src/src/components/ShareSetDialog.css
   THE SHARE DIALOG — 05-share-review.html. Scoped under .share; tokens only.
   MEASURED (asserted in __tests__/sharePalette.test.js):
     --text  #F4EDE4 on --surface #1B2942   12.53:1
     --muted #9BA8BE on --surface            6.06:1
     --primary #F6A94C on --surface          7.6:1
     --share-success-text #6FD0A4 on --surface  7.9:1
     --bg on --primary (filled Submit)       8.86:1 */
.share {
  --share-t-floor: 12px;
  --share-t-label: 13px;
  --share-t-body: 15px;
  --share-t-head: 19px;
  --share-success-text: #6FD0A4;
  --share-rule: rgba(155, 168, 190, .20);
  --share-tint: rgba(246, 169, 76, .09);
  color: var(--text);
  font: 400 var(--share-t-body)/1.5 var(--font-ui);
}
.share-scrim {
  position: fixed; inset: 0; z-index: 60;
  display: flex; align-items: flex-start; justify-content: center;
  overflow-y: auto; padding: 48px 16px;
  background: rgba(15, 26, 46, .72);
}
.share-card {
  width: min(640px, 100%); margin: auto;
  background: var(--surface); border: 1px solid var(--share-rule); border-radius: 10px;
}
.share-head { display: flex; align-items: flex-start; gap: 12px; padding: 20px 20px 0; }
.share-head h2 { margin: 0; flex: 1; min-width: 0; font-size: var(--share-t-head); font-weight: 700; line-height: 1.3; }
.share-x { flex: none; width: 32px; height: 32px; border: 0; background: transparent; color: var(--muted); font-size: 22px; line-height: 1; cursor: pointer; border-radius: 6px; }
.share-x:hover { color: var(--text); background: var(--share-rule); }
.share-body { padding: 12px 20px 20px; }
.share-body p { margin: 0 0 12px; }
.share-sub { color: var(--muted); font-size: var(--share-t-label); }
.share-callout { padding: 12px 14px; border-radius: 8px; background: var(--share-tint); border: 1px solid var(--share-rule); margin: 0 0 14px; }
.share-outcomes { display: grid; grid-template-columns: max-content 1fr; gap: 6px 16px; margin: 0 0 14px; }
.share-outcomes dt { color: var(--muted); font-size: var(--share-t-label); }
.share-outcomes dd { margin: 0; }
.share-note { color: var(--primary); }
.share-fine { color: var(--muted); font-size: var(--share-t-label); }
.share-foot { display: flex; justify-content: flex-end; gap: 8px; padding-top: 8px; border-top: 1px solid var(--share-rule); }
.share-btn { height: 36px; padding: 0 14px; border-radius: 6px; border: 1px solid var(--share-rule); background: transparent; color: var(--text); font: 600 var(--share-t-body)/1 var(--font-ui); cursor: pointer; }
.share-btn:hover { background: var(--share-rule); }
.share-btn--primary { background: var(--primary); border-color: var(--primary); color: var(--bg); }
.share-btn--primary:disabled { opacity: .6; cursor: default; }
.share-running { text-align: center; }
.share-bignum { font-size: 30px; font-weight: 700; margin: 8px 0 0; font-variant-numeric: tabular-nums; }
.share-of { color: var(--muted); font-size: var(--share-t-head); }
.share-phase { color: var(--muted); }
.share-result { display: flex; align-items: center; gap: 8px; font-weight: 600; }
.share-result--ok { color: var(--share-success-text); }
.share-alert { margin: 0 0 12px; }
@media (max-width: 560px) { .share-outcomes { grid-template-columns: 1fr; } }
```

`--font-ui` is declared in `styles.css` (`grep -n -- '--font-ui' src/src/styles.css`); if it is not, use `var(--font-ui, system-ui, sans-serif)` — never a raw family alone.

- [ ] **Step 4: Run the suites**

Run: `cd src && CI=true npx jest __tests__/shareSetDialog.test.jsx __tests__/sharePalette.test.js __tests__/scopedClassesDeclared.test.js __tests__/modalReachability.test.js 2>&1 | grep -E '✕|Tests:'; cd ..`
Expected: all pass. If `modalReachability` asserts scrim rules by class, its list may need `share-scrim` added the way it names `qsets-scrim`.

- [ ] **Step 5: Commit**

```bash
git add src/src/components/ShareSetDialog.jsx src/src/components/ShareSetDialog.css src/src/__tests__/shareSetDialog.test.jsx src/src/__tests__/sharePalette.test.js src/src/__tests__/scopedClassesDeclared.test.js
git commit -m "The share dialog: the mockup's promise, then the job's progress, then the outcome in place

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 19: `SetReviewBanner` — `06`, the editor's needs-changes state

**Files:**
- Create: `src/src/components/SetReviewBanner.jsx`, `src/src/components/SetReviewBanner.css`
- Test: `src/src/__tests__/setReviewBanner.test.jsx`, `src/src/__tests__/srevPalette.test.js`; register `['SetReviewBanner', 'srev']` in `scopedClassesDeclared.test.js`

**Interfaces:**
- Props: `entry` (the Versions-panel entry for the submitted version: `version`, `review`, `reviewFindings[]` with `explanation`, `note`, `reasons`, `checkedAt`, `questionCount`), `share` (the set's stamp — its `note` is the staff note), `busy`, `onResubmit(version)`, `onAppeal(version, message)`, `onFocusQuestion(questionId)`.
- Renders nothing unless `entry.review ∈ flagged | escalated | appealed` or `share.status === 'flagged'`. Token-only; declares no `data-theme`; measured on BOTH grounds.

- [ ] **Step 1: Write the failing tests**

```jsx
// src/src/__tests__/setReviewBanner.test.jsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import SetReviewBanner from '../components/SetReviewBanner';

const FLAGGED = {
  version: 2, review: 'flagged', checkedAt: '2026-08-19T10:00:00.000Z', questionCount: 30, reasons: [],
  reviewFindings: [
    { questionId: 'q014', category: 'VIOLENCE', band: 'HIGH', explanation: 'Asking a room to describe injuries in detail is what was flagged, not the safety topic.' },
    { questionId: 'q022', category: 'HATE', band: 'HIGH', explanation: 'The question invites an answer about a category of people rather than a practice.' },
  ],
};
test('renders nothing for a version with nothing to say', () => {
  const { container } = render(<SetReviewBanner entry={{ version: 2, review: 'passed', reviewFindings: [] }} share={null} />);
  expect(container).toBeEmptyDOMElement();
});
test('a flagged version says what was not published, names each question with its sentence, and counts the rest', () => {
  const onFocusQuestion = jest.fn();
  render(<SetReviewBanner entry={FLAGGED} share={{ status: 'flagged', version: 2 }} onFocusQuestion={onFocusQuestion} onResubmit={() => {}} onAppeal={() => {}} />);
  expect(screen.getByRole('status')).toHaveTextContent(/this set was not published/i);
  expect(screen.getByRole('status')).toHaveTextContent(/2 of 30 questions were flagged on 19 Aug/i);
  expect(screen.getByRole('status')).toHaveTextContent(/nothing was shared, and your copy is untouched/i);
  expect(screen.getByText(/injuries in detail/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /edit q014/i }));
  expect(onFocusQuestion).toHaveBeenCalledWith('q014');
  expect(screen.getByText(/the other 28 questions passed/i)).toBeInTheDocument();
});
test('Resubmit and Ask for a human review call back with the version and the message', () => {
  const onResubmit = jest.fn(); const onAppeal = jest.fn();
  render(<SetReviewBanner entry={FLAGGED} share={{ status: 'flagged', version: 2 }} onResubmit={onResubmit} onAppeal={onAppeal} onFocusQuestion={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: /resubmit/i }));
  expect(onResubmit).toHaveBeenCalledWith(2);
  fireEvent.click(screen.getByRole('button', { name: /ask for a human review/i }));
  fireEvent.change(screen.getByRole('textbox', { name: /tell engage why/i }), { target: { value: 'It is a clinical safety set.' } });
  fireEvent.click(screen.getByRole('button', { name: /^send$/i }));
  expect(onAppeal).toHaveBeenCalledWith(2, 'It is a clinical safety set.');
});
test('a staff note leads the banner; waiting states say so and offer no appeal', () => {
  render(<SetReviewBanner entry={{ ...FLAGGED, review: 'flagged' }} share={{ status: 'flagged', version: 2, note: 'Q14 needs the injury detail removed.' }} onResubmit={() => {}} onAppeal={() => {}} onFocusQuestion={() => {}} />);
  expect(screen.getByRole('status').textContent.indexOf('Q14 needs')).toBeLessThan(screen.getByRole('status').textContent.indexOf('not published'));
  render(<SetReviewBanner entry={{ ...FLAGGED, review: 'appealed' }} share={{ status: 'appealed', version: 2 }} />);
  expect(screen.getByText(/waiting for a person at Engage/i)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /ask for a human review/i })).toBeNull();
});
```

```js
// src/src/__tests__/srevPalette.test.js
/* The needs-changes banner sits inside the set editor, which is part-paper:
   it declares no theme of its own, so every pairing is asserted on BOTH grounds. */
const fs = require('fs');
const path = require('path');
const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const GLOBAL_CSS = read('styles.css');
const CSS = read('components', 'SetReviewBanner.css');
function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function lum(c) { return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]); }
function ratio(a, b) { const la = lum(a); const lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); }
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16));
const over = (fg, bg, a) => fg.map((c, i) => c * a + bg[i] * (1 - a));
function token(css, block, name) {
  const start = css.indexOf(block); const body = css.slice(start, css.indexOf('}', start));
  const m = body.match(new RegExp(`${name}\\s*:\\s*(#[0-9A-Fa-f]{6})`));
  if (!m) throw new Error(`${name} not in ${block}`);
  return m[1];
}
const DUSK = '[data-theme="dark"] {'; const PAPER = '[data-theme="light"] {'; const ROOT = ':root {';
const grounds = {
  dusk: { bg: hex(token(GLOBAL_CSS, DUSK, '--bg')), text: hex(token(GLOBAL_CSS, DUSK, '--text')), muted: hex(token(GLOBAL_CSS, DUSK, '--muted')) },
  paper: { bg: hex(token(GLOBAL_CSS, PAPER, '--bg')), text: hex(token(GLOBAL_CSS, PAPER, '--text')), muted: hex(token(GLOBAL_CSS, PAPER, '--muted')) },
};
const dangerText = hex(token(GLOBAL_CSS, ROOT, '--danger-text'));
const tintAlpha = Number((CSS.match(/--srev-tint-alpha:\s*([\d.]+)/) || [])[1]);
const AA = 4.5;
describe.each(Object.entries(grounds))('on %s', (_name, g) => {
  const tinted = over(hex(token(GLOBAL_CSS, ROOT, '--danger')), g.bg, tintAlpha);
  test('the banner tint is declared and the text on it clears AA', () => {
    expect(tintAlpha).toBeGreaterThan(0);
    expect(ratio(g.text, tinted)).toBeGreaterThanOrEqual(AA);
    expect(ratio(g.muted, tinted)).toBeGreaterThanOrEqual(AA);
  });
  test('the flagged-question heading colour clears AA on the tint', () => {
    // --danger-text is a dusk-derived token; on paper the sheet must swap it.
    const flaggedInk = _name === 'paper' ? hex((CSS.match(/--srev-flag-ink-paper:\s*(#[0-9A-Fa-f]{6})/) || [])[1] || '#000000') : dangerText;
    expect(ratio(flaggedInk, tinted)).toBeGreaterThanOrEqual(AA);
  });
});
test('every selector is rooted at .srev and no --danger carries text', () => {
  const stripped = CSS.replace(/\/\*[\s\S]*?\*\//g, ' ');
  expect(stripped).not.toMatch(/color:\s*var\(--danger\)/);
  for (const sel of stripped.matchAll(/(^|\})\s*([^{@}]+)\{/g)) for (const part of sel[2].split(',')) expect(part.trim()).toMatch(/^(\.srev(\b|-)|\[data-theme="light"\] \.srev)/);
  expect(GLOBAL_CSS).not.toMatch(/\.srev(\b|-)/);
});
```

Add `['SetReviewBanner', 'srev'],` to `SURFACES`.

- [ ] **Step 2: Run them to see them fail**

Run: `cd src && CI=true npx jest __tests__/setReviewBanner.test.jsx __tests__/srevPalette.test.js 2>&1 | grep -E '✕|Tests:'; cd ..`
Expected: both fail (`Cannot find module`).

- [ ] **Step 3: Write the component and its stylesheet**

```jsx
// src/src/components/SetReviewBanner.jsx
import React, { useState } from 'react';
import Icon from './Icon';
import './SetReviewBanner.css';

/**
 * A SET THAT NEEDS CHANGES — docs/design/tenancy-redesign/06-share-rejected.html.
 *
 * Not a screen: the editor's state when the submitted version is flagged, was
 * rejected by a person, or was taken down (the staff note leads, spec §10.2).
 * The rejection NAMES the questions and QUOTES the finding's sentence — "two
 * of thirty is a five-minute edit; 'your set was rejected' is an abandoned
 * feature" (RATIONALE §3). The sentence is model-written text about the
 * author's own content; it is rendered as text, never markup.
 *
 * TOKEN-ONLY AND THEME-AGNOSTIC, deliberately. This sits inside the set
 * editor, which is still part-paper on the monolith stylesheet; declaring
 * `data-theme="dark"` here would make a dusk island in a paper form — the
 * defect the player shell just had removed, mirrored. Every pairing is asserted
 * on both grounds in __tests__/srevPalette.test.js.
 */
const day = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '');
const byQuestion = (findings) => {
  const map = new Map();
  for (const f of findings || []) {
    if (!f.questionId || f.questionId === '(set)') continue;
    if (!map.has(f.questionId)) map.set(f.questionId, []);
    map.get(f.questionId).push(f);
  }
  return [...map.entries()];
};
const label = (id) => `Q${String(id).replace(/^q0*/i, '')}`;

export default function SetReviewBanner({ entry, share, busy = false, onResubmit, onAppeal, onFocusQuestion }) {
  const [asking, setAsking] = useState(false);
  const [message, setMessage] = useState('');
  const review = entry && entry.review;
  const staffNote = share && share.note;
  const waiting = review === 'escalated' || review === 'appealed';
  const flagged = review === 'flagged' || (share && share.status === 'flagged');
  if (!waiting && !flagged) return null;

  if (waiting) {
    return (
      <section className="srev srev--waiting" role="status">
        <Icon name="UserCircle" weight="fill" size={18} color="var(--primary)" />
        <p>Waiting for a person at Engage to look at version {entry.version}. The outcome will show here.</p>
      </section>
    );
  }
  const questions = byQuestion(entry.reviewFindings);
  const setFindings = (entry.reviewFindings || []).filter((f) => f.questionId === '(set)');
  const total = Number(entry.questionCount) || 0;
  const passed = total ? total - questions.length : null;
  return (
    <section className="srev" role="status">
      <div className="srev-lead">
        <Icon name="Warning" weight="fill" size={18} color="var(--srev-flag-ink)" />
        <p>
          {staffNote && <><strong>From Engage:</strong> {staffNote} </>}
          <strong>This set was not published.</strong>{' '}
          {questions.length} of {total || '—'} questions were flagged{entry.checkedAt ? ` on ${day(entry.checkedAt)}` : ''}.
          Nothing was shared, and your copy is untouched — it is still private to your organisation and still usable in your own sessions.
        </p>
      </div>
      <h3 className="srev-h">What was flagged</h3>
      <ul className="srev-list">
        {questions.map(([id, findings]) => (
          <li key={id} className="srev-item">
            <div className="srev-item-head">
              <strong>{label(id)}</strong>
              {onFocusQuestion && (
                <button type="button" className="srev-btn srev-btn--sm" onClick={() => onFocusQuestion(id)}>Edit {label(id)}</button>
              )}
            </div>
            {findings.map((f, i) => (
              <p key={i} className="srev-why">{f.explanation || `Flagged for ${String(f.category || '').toLowerCase()}.`}</p>
            ))}
          </li>
        ))}
        {setFindings.map((f, i) => (
          <li key={`set-${i}`} className="srev-item">
            <div className="srev-item-head"><strong>The set's own text</strong></div>
            <p className="srev-why">{f.explanation || `The set's name, description or category names were flagged for ${String(f.category || '').toLowerCase()}.`}</p>
          </li>
        ))}
        {passed !== null && passed >= 0 && (
          <li className="srev-item srev-item--ok">
            <Icon name="Check" weight="bold" size={14} color="currentColor" /> The other {passed} questions passed. They are unchanged and need no attention.
          </li>
        )}
      </ul>
      <div className="srev-acts">
        {onResubmit && (
          <button type="button" className="srev-btn srev-btn--primary" disabled={busy} onClick={() => onResubmit(entry.version)}>Resubmit</button>
        )}
        {onAppeal && !asking && (
          <div className="srev-appeal">
            <p><strong>Think this is wrong?</strong> Ask a person to look at it. Automated review is deliberately cautious, and a set about safety is exactly the kind it gets wrong.</p>
            <button type="button" className="srev-btn" disabled={busy} onClick={() => setAsking(true)}>Ask for a human review</button>
          </div>
        )}
        {onAppeal && asking && (
          <div className="srev-appeal">
            <label htmlFor="srev-msg">Tell Engage why (optional)</label>
            <textarea id="srev-msg" className="srev-msg" maxLength={500} rows={3} value={message} onChange={(e) => setMessage(e.target.value)} />
            <div className="srev-acts">
              <button type="button" className="srev-btn" onClick={() => setAsking(false)}>Cancel</button>
              <button type="button" className="srev-btn srev-btn--primary" disabled={busy} onClick={() => onAppeal(entry.version, message.trim())}>Send</button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
```

```css
/* src/src/components/SetReviewBanner.css
   THE NEEDS-CHANGES STATE — 06-share-rejected.html. Scoped under .srev.
   THEME-AGNOSTIC: no data-theme, tokens only, so it renders correctly inside the
   part-paper editor and on dusk alike. The tint is --danger at --srev-tint-alpha
   over whatever ground it lands on; both composites are asserted in
   __tests__/srevPalette.test.js. --danger-text (#EF8C86) is a dusk ink and fails
   on paper, so the flagged ink is swapped under [data-theme="light"]. */
.srev {
  --srev-t-floor: 12px;
  --srev-t-label: 13px;
  --srev-t-body: 15px;
  --srev-t-head: 17px;
  --srev-tint-alpha: 0.10;
  --srev-rule: rgba(155, 168, 190, .28);
  --srev-flag-ink: var(--danger-text);
  --srev-flag-ink-paper: #9B2C27;
  display: block; margin: 0 0 16px; padding: 14px 16px; border-radius: 8px;
  background: rgba(229, 100, 94, .10);
  border: 1px solid var(--srev-rule);
  color: var(--text);
  font: 400 var(--srev-t-body)/1.5 var(--font-ui);
}
[data-theme="light"] .srev { --srev-flag-ink: var(--srev-flag-ink-paper); }
.srev--waiting { display: flex; align-items: center; gap: 10px; background: transparent; }
.srev p { margin: 0; }
.srev-lead { display: flex; gap: 10px; align-items: flex-start; }
.srev-h { margin: 14px 0 6px; font-size: var(--srev-t-head); font-weight: 700; }
.srev-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.srev-item { padding: 10px 12px; border: 1px solid var(--srev-rule); border-radius: 6px; }
.srev-item--ok { color: var(--muted); display: flex; gap: 8px; align-items: center; }
.srev-item-head { display: flex; align-items: center; gap: 10px; }
.srev-item-head strong { color: var(--srev-flag-ink); }
.srev-item-head .srev-btn { margin-left: auto; }
.srev-why { color: var(--muted); font-size: var(--srev-t-label); margin-top: 4px; }
.srev-acts { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-top: 12px; }
.srev-appeal { flex: 1 1 100%; padding-top: 10px; border-top: 1px solid var(--srev-rule); }
.srev-appeal label { display: block; font-size: var(--srev-t-label); color: var(--muted); margin: 0 0 4px; }
.srev-msg { width: 100%; box-sizing: border-box; font: inherit; color: var(--text); background: transparent; border: 1px solid var(--srev-rule); border-radius: 6px; padding: 8px; }
.srev-btn { height: 36px; padding: 0 12px; border-radius: 6px; border: 1px solid var(--srev-rule); background: transparent; color: var(--text); font: 600 var(--srev-t-body)/1 var(--font-ui); cursor: pointer; }
.srev-btn--sm { height: 28px; font-size: var(--srev-t-label); }
.srev-btn--primary { background: var(--primary); border-color: var(--primary); color: #0F1A2E; }
.srev-btn:disabled { opacity: .6; cursor: default; }
```

The filled button's ink is `#0F1A2E` literally (not `var(--bg)`): on paper `--bg` is near-white and the primary fill would carry white at 1.96:1 — the CountField incident. It is the one hex outside the token block and the palette test's hex rule for this sheet must allow it by naming it: add `expect((stripped.match(/#[0-9A-Fa-f]{6}\b/g) || []).filter((h) => h !== '#0F1A2E' && h !== '#9B2C27' ...))` — or, cleaner, declare `--srev-on-primary: #0F1A2E` in the token block and use `var(--srev-on-primary)`; do the latter.

- [ ] **Step 4: Run the suites**

Run: `cd src && CI=true npx jest __tests__/setReviewBanner.test.jsx __tests__/srevPalette.test.js __tests__/scopedClassesDeclared.test.js 2>&1 | grep -E '✕|Tests:'; cd ..`
Expected: all pass. If the paper `--muted #5E6167` on the tint over `#FBF7F1` falls under 4.5:1, lower `--srev-tint-alpha` to `0.07` — the test tells you the number; never loosen the threshold.

- [ ] **Step 5: Commit**

```bash
git add src/src/components/SetReviewBanner.jsx src/src/components/SetReviewBanner.css src/src/__tests__/setReviewBanner.test.jsx src/src/__tests__/srevPalette.test.js src/src/__tests__/scopedClassesDeclared.test.js
git commit -m "The editor's needs-changes state names the questions, quotes the reason, and offers a person

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 20: The editor — version chips, Share per version, the banner, and "Edit Q14"

**Files:**
- Modify: `src/src/components/QuestionSetEditor.jsx` (props ≈ `:130-160`; the Versions panel ≈ `:1285-1345`; the `<QuestionsPanel` mount ≈ `:1274`), `src/src/components/QuestionsPanel.jsx` (the `<li>` ≈ `:936`; props ≈ the `export default function QuestionsPanel({` block)
- Test: `src/src/__tests__/setEditorShare.test.jsx`

**Interfaces:**
- Editor props added: `onShare(version)` (renders a "Share publicly" button per version and "Resubmit" in the banner), `onAppeal(version, message)` (returns a promise; the editor reloads versions after it resolves), `canShare = false` (AdminPage passes `Boolean(activeOrg) && !onPlatform && questionSet.canManage !== false`).
- Each version row gains `<span className={`qs-version-chip qs-version-chip--${chip.key}`}>{chip.label}</span>` from `versionChip(v)` (`utils/shareState`) — declared in `styles.css` beside `.qs-version-active-badge` (the editor's rules live there today; a new scoped sheet for one chip would be a second seam).
- The banner mounts above the Questions panel (below the four metadata panels) with `entry = versions.find(v => v.version === (questionSet.share?.version ?? activeVersion))`.
- `QuestionsPanel` gains `focusQuestionId` (string | null): when it changes and a row with `row.sk === \`QUESTION#${focusQuestionId}\`` exists, the row gets `data-question-id`, is scrolled into view (`el.scrollIntoView({ block: 'center' })` guarded for jsdom) and carries class `focused` for 2 seconds.

- [ ] **Step 1: Write the failing test**

Copy the `authFetch`/`fetch` mock and the `questionSet` fixture from the existing editor suite (`ls src/src/__tests__ | grep -iE 'questionSetEditor|editor'` — open the one that mounts `QuestionSetEditor` and reuse its `beforeEach` fetch router verbatim), then add:

```jsx
// src/src/__tests__/setEditorShare.test.jsx
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
// … the mocks copied from the existing editor suite go here …
import QuestionSetEditor from '../components/QuestionSetEditor';

const VERSIONS = [
  { version: 1, createdAt: '2026-08-01T10:00:00.000Z', questionCount: 30, categoryCount: 3, isActive: false, review: 'passed', reviewFindings: [], published: { publicSetId: 'orgacme-safety', publicVersion: 1, at: '2026-08-02T10:00:00.000Z' }, pinnedByGames: [], unfinished: false, reasons: [] },
  { version: 2, createdAt: '2026-08-19T10:00:00.000Z', questionCount: 30, categoryCount: 3, isActive: true, review: 'flagged', reviewFindings: [{ questionId: 'q014', category: 'VIOLENCE', band: 'HIGH', explanation: 'Injuries in detail.' }], published: null, pinnedByGames: [], unfinished: false, reasons: [] },
];
const SET = { id: 'safety', name: 'Safety walkthrough', engagementType: 'trivia', activeVersion: 2, canManage: true, scope: 'org', share: { status: 'flagged', version: 2, at: '2026-08-19T10:00:00.000Z' } };
// Route GET …/question-sets/safety/versions → VERSIONS in the copied fetch router.

test('each version says where it went, and Share publicly asks for that version', async () => {
  const onShare = jest.fn();
  render(<QuestionSetEditor questionSet={SET} canShare onShare={onShare} onAppeal={jest.fn()} onCancel={() => {}} />);
  const v1 = await screen.findByTestId('version-1');
  expect(within(v1).getByText('public')).toBeInTheDocument();
  const v2 = await screen.findByTestId('version-2');
  expect(within(v2).getByText('needs changes')).toBeInTheDocument();
  fireEvent.click(within(v1).getByRole('button', { name: /share publicly/i }));
  expect(onShare).toHaveBeenCalledWith(1);
});
test('the needs-changes banner shows for the flagged version and Edit Q014 focuses the row', async () => {
  render(<QuestionSetEditor questionSet={SET} canShare onShare={jest.fn()} onAppeal={jest.fn()} onCancel={() => {}} />);
  const banner = await screen.findByRole('status');
  expect(banner).toHaveTextContent(/not published/i);
  fireEvent.click(within(banner).getByRole('button', { name: /edit q014/i }));
  const row = await screen.findByTestId('question-13'); // q014 is the 14th row in the fixture
  expect(row).toHaveAttribute('data-question-id', 'q014');
  expect(row.className).toMatch(/focused/);
});
test('without canShare there is no Share button and no banner actions', async () => {
  render(<QuestionSetEditor questionSet={{ ...SET, canManage: false }} onCancel={() => {}} />);
  await screen.findByTestId('version-1');
  expect(screen.queryByRole('button', { name: /share publicly/i })).toBeNull();
  expect(screen.queryByRole('button', { name: /resubmit/i })).toBeNull();
});
```

The second test needs the questions route in the copied router to return at least 14 questions whose 14th has `SK: 'QUESTION#q014'` (or whatever field the router's fixture uses to populate `row.sk` — read `QuestionsPanel.jsx:452-466` to see which response field becomes `sk`).

- [ ] **Step 2: Run it to see it fail**

Run: `cd src && CI=true npx jest __tests__/setEditorShare.test.jsx 2>&1 | grep -E '✕|✓|Tests:'; cd ..`
Expected: all three fail (no chips, no Share button, no banner).

- [ ] **Step 3: Implement**

`QuestionSetEditor.jsx` — imports: `import SetReviewBanner from './SetReviewBanner'; import { versionChip } from '../utils/shareState';`. Props: add `canShare = false, onShare, onAppeal,` after `onDirtyChange`. State: `const [focusQuestionId, setFocusQuestionId] = useState(null); const [appealBusy, setAppealBusy] = useState(false);`. Above the `<QuestionsPanel` mount:

```jsx
      {/* ============================================ 2b. NEEDS CHANGES === */}
      {showVersions && (() => {
        const shared = questionSet && questionSet.share;
        const target = (shared && Number(shared.version)) || activeVersion;
        const entry = versions.find((v) => v.version === target);
        if (!entry) return null;
        return (
          <SetReviewBanner
            entry={entry}
            share={shared || null}
            busy={appealBusy}
            onResubmit={canShare && onShare ? (v) => onShare(v) : undefined}
            onAppeal={canShare && onAppeal ? async (v, message) => {
              setAppealBusy(true);
              try { await onAppeal(v, message); await loadVersions(); } finally { setAppealBusy(false); }
            } : undefined}
            onFocusQuestion={(id) => setFocusQuestionId(id)}
          />
        );
      })()}
```

Pass `focusQuestionId={focusQuestionId}` to `<QuestionsPanel>`. In the Versions row, inside `.qs-version-id` after the active badge:

```jsx
                  {(() => { const chip = versionChip(v); return (
                    <span className={`qs-version-chip qs-version-chip--${chip.key}`} title={chip.key === 'public' ? `Public as ${v.published.publicSetId} v${v.published.publicVersion}` : undefined}>
                      {chip.label}
                    </span>
                  ); })()}
```

and in `.qs-version-actions`, before Promote:

```jsx
                  {canShare && onShare && (
                    <button
                      className="btn-secondary btn-small"
                      onClick={() => onShare(v.version)}
                      disabled={busyVersion === v.version || v.review === 'checking'}
                      title={v.published ? 'Share this version again' : 'Submit this version for the content check; it goes public if it passes'}
                    >
                      <Icon name="Broadcast" weight="bold" size={14} color="currentColor" /> Share publicly
                    </button>
                  )}
```

`styles.css`, beside `.qs-version-active-badge` (`grep -n 'qs-version-active-badge' src/src/styles.css`):

```css
.qs-version-chip { display: inline-block; margin-left: 8px; padding: 1px 8px; border-radius: 999px; border: 1px solid rgba(155,168,190,.34); font-size: 12px; color: var(--muted); }
.qs-version-chip--public { color: var(--success); border-color: rgba(79,178,134,.5); }
.qs-version-chip--flagged, .qs-version-chip--unfinished { color: var(--danger-deep); border-color: rgba(229,100,94,.5); }
.qs-version-chip--waiting { color: var(--secondary); }
```

(`--danger-deep #B03A34` is 5.7:1 on paper `--bg` and 4.6:1 on white; `--success #4FB286` on paper is 2.6:1 — **not** text-safe on paper.) So on the paper editor use `#1E7A52` for the public chip: declare `.qs-version-chip--public { color: #1E7A52; }` and add a pairing to `__tests__/questionSetsPalette.test.js`? That file measures dusk. Instead add three lines to the editor's existing palette coverage if one exists (`grep -l 'qs-version' src/src/__tests__/*Palette*`); if none does, add `setEditorChipsPalette.test.js` asserting `#1E7A52` and `--danger-deep` ≥ 4.5:1 on `--bg` paper and on `#FFFFFF`, using the `srevPalette.test.js` helpers.

`QuestionsPanel.jsx`: add prop `focusQuestionId = null`; add:

```jsx
  const [focusedSk, setFocusedSk] = useState(null);
  useEffect(() => {
    if (!focusQuestionId) return undefined;
    const sk = `QUESTION#${focusQuestionId}`;
    setFocusedSk(sk);
    const el = document.querySelector(`[data-question-id="${focusQuestionId}"]`);
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center' });
    const t = setTimeout(() => setFocusedSk(null), 2000);
    return () => clearTimeout(t);
  }, [focusQuestionId]);
```

and on the `<li>`: `data-question-id={String(row.sk || '').replace('QUESTION#', '') || undefined}` and append `${row.sk === focusedSk ? ' focused' : ''}` to its className. `.qs-question-row.focused { outline: 2px solid var(--primary); outline-offset: 2px; }` in `styles.css` beside `.qs-question-row`.

- [ ] **Step 4: Run the suites**

Run: `cd src && CI=true npx jest __tests__/setEditorShare.test.jsx $(ls __tests__ | grep -iE 'questionSetEditor|questionsPanel' | sed 's#^#__tests__/#') 2>&1 | grep -E '✕|Tests:'; cd ..`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/src/components/QuestionSetEditor.jsx src/src/components/QuestionsPanel.jsx src/src/styles.css src/src/__tests__/setEditorShare.test.jsx
git commit -m "The editor says where each version went, shares one, and shows what needs changing

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 21: `AdminPage` — wiring and the badge

**Files:**
- Modify: `src/src/AdminPage.jsx` (state near the other dialogs ≈ `:200-260`; the list mount ≈ `:1624-1676`; the editor mount ≈ `:1496`; the nav mapping ≈ `:1425-1436`)
- Test: `src/src/__tests__/adminShare.test.jsx`

**Interfaces:**
- State `sharing: { set, version } | null`; `<ShareSetDialog>` rendered when set, with `onOutcome={() => fetchQuestionSets()}` and `onNeedsChanges={() => handleEditQuestionSet(sharing.set)}`.
- List: `showVisibility={Boolean(activeOrg) && !onPlatform}`, `onShare={activeOrg && !onPlatform ? (set) => setSharing({ set, version: null }) : undefined}`.
- Editor: `canShare={Boolean(activeOrg) && !onPlatform && editingSet?.canManage !== false}`, `onShare={(version) => setSharing({ set: editingSet, version })}`, `onAppeal={handleAppeal}`.
- `handleAppeal(version, message)`: `POST ${adminApiUrl('question-sets/<id>/appeal')}` `{ version, message }`; on `!ok` → `setNotice({ tone: 'error', text })` (whatever the page's notice shape is — read `setNotice(` call sites); then `fetchQuestionSets()`.
- Nav: the `questionsets` item gets `badge: flaggedCount || undefined` where `flaggedCount = questionSets.filter((s) => s.share && s.share.status === 'flagged').length`; `count` stays as it is.

- [ ] **Step 1: Write the failing test**

Model the mocks on `__tests__/adminOneSection.test.jsx:10-70` (copy its `jest.mock` blocks and the `HOME` org fixture; route `GET …/orgs` to `{ orgs: [HOME] }` and `GET …admin/question-sets` to the fixture below; every other GET to `{}` / `[]`).

```jsx
// src/src/__tests__/adminShare.test.jsx
// … mocks copied from adminOneSection.test.jsx …
import AdminPage from '../AdminPage';
const SETS = { questionSets: [
  { id: 'safety', name: 'Safety walkthrough', engagementType: 'trivia', totalQuestions: 30, canManage: true, scope: 'org', activeVersion: 2, share: { status: 'flagged', version: 2, at: '2026-08-19T10:00:00.000Z' } },
  { id: 'clean', name: 'Clean one', engagementType: 'trivia', totalQuestions: 5, canManage: true, scope: 'org', activeVersion: 1 },
] };
test('an org console shows who can see each set, badges the flagged count, and Share opens the dialog', async () => {
  mockActiveOrg = HOME.orgId; mockGroups = ['hosts'];
  render(<AdminPage />);
  expect(await screen.findByRole('columnheader', { name: /who can see it/i })).toBeInTheDocument();
  expect(screen.getByText('Needs changes')).toBeInTheDocument();
  const nav = screen.getByRole('navigation');
  expect(within(nav).getByText('1')).toHaveClass('adm-nav-badge');
  const row = screen.getByText('Clean one').closest('tr');
  fireEvent.click(within(row).getByRole('button', { name: /^share$/i }));
  expect(await screen.findByRole('heading', { name: /share “Clean one” publicly/i })).toBeInTheDocument();
});
test('the platform console has neither the column nor Share', async () => {
  mockActiveOrg = '~platform'; mockGroups = ['admins', 'hosts'];
  render(<AdminPage />);
  await screen.findByRole('table');
  expect(screen.queryByRole('columnheader', { name: /who can see it/i })).toBeNull();
  expect(screen.queryByRole('button', { name: /^share$/i })).toBeNull();
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd src && CI=true npx jest __tests__/adminShare.test.jsx 2>&1 | grep -E '✕|Tests:'; cd ..`
Expected: the first test fails (no column / no dialog); the second passes already.

- [ ] **Step 3: Wire it**

Imports: `import ShareSetDialog from './components/ShareSetDialog'; import { adminApiUrl } from './utils/adminApi';`. State beside `deletingSet`: `const [sharing, setSharing] = useState(null);`. Handler beside `handleCopySet`:

```jsx
  /** "Ask for a human review" — POST the appeal, then re-read the list so the row says Waiting. */
  const handleAppeal = async (version, message) => {
    if (!editingSet) return;
    const res = await authFetch(adminApiUrl(`question-sets/${encodeURIComponent(editingSet.id)}/appeal`), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version, message }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setNotice({ tone: 'error', text: body.error || `Could not send that for review (${res.status}).` });
    }
    await fetchQuestionSets();
  };
```

(match `setNotice`'s existing argument shape — `grep -n 'setNotice(' src/src/AdminPage.jsx | head -3`). List props: add `showVisibility={Boolean(activeOrg) && !onPlatform}` and `onShare={activeOrg && !onPlatform ? (set) => setSharing({ set, version: null }) : undefined}`. Editor props: add `canShare={Boolean(activeOrg) && !onPlatform && editingSet.canManage !== false}`, `onShare={(version) => setSharing({ set: editingSet, version })}`, `onAppeal={handleAppeal}`. Render, next to the delete dialog's mount:

```jsx
      {sharing && (
        <ShareSetDialog
          set={sharing.set}
          version={sharing.version}
          onClose={() => setSharing(null)}
          onOutcome={() => { fetchQuestionSets(); }}
          onNeedsChanges={() => { handleEditQuestionSet(sharing.set); }}
        />
      )}
```

Nav mapping: replace the `questionsets` branch with

```jsx
            (item.id === 'questionsets'
              ? {
                ...item,
                count: questionSets.length || undefined,
                // The one number in this console that decays if nobody looks:
                // sets the check sent back. Absent when zero (spec §10.3).
                badge: questionSets.filter((s) => s.share && s.share.status === 'flagged').length || undefined,
              }
              : item)),
```

- [ ] **Step 4: Run the page suites**

Run: `cd src && CI=true npx jest __tests__/adminShare.test.jsx __tests__/adminOneSection.test.jsx __tests__/closedRoutesUseAuthFetch.test.js 2>&1 | grep -E '✕|Tests:'; cd ..`
Expected: all pass. `closedRoutesUseAuthFetch` scans for bare `fetch(` on closed routes — the two new calls go through `authFetch`.

- [ ] **Step 5: Commit**

```bash
git add src/src/AdminPage.jsx src/src/__tests__/adminShare.test.jsx
git commit -m "The console wires the share dialog, the appeal, and the needs-changes badge

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 22: Baselines, dev, and the drive

**Files:** none new. This task ships Stage 1 to dev and proves it there.

- [ ] **Step 1: The full backend and frontend baselines**

Run the exact commands from Task 0 steps 2–3. Expected: suites ≥ baseline `N` + 10 (harness, publishable, review-log, moderation-queue, share-stamp-and-quota, set-check-lock, finding-explanations, set-check-job, appeal-question-set, share-projection, authorizer-set-routes), passes ≥ baseline, zero `FAILED:`; frontend suites ≥ `S` + 9, tests ≥ `T`; lint 0 errors / 11 warnings; build with the 2 known size warnings. Then:

```bash
node tests/no-retired-twin-references.js | tail -2 && node tests/no-global-partition-literals.js | tail -2 && rm -rf .aws-sam && sam validate --template template-clean.yaml --region us-east-1 --lint | tail -1
```

- [ ] **Step 2: Bring `origin/dev` in and push dev (this deploys)**

```bash
git fetch origin dev && git merge origin/dev
```
Resolve any conflict (the only likely one is `template-clean.yaml`), re-run Step 1 if anything merged, then:

```bash
git push origin HEAD:dev
```
Say in the reply: "pushed `<sha>` to `dev`; the dev pipeline is deploying it." Then watch:

```bash
aws codepipeline list-pipeline-executions --pipeline-name engagecicd-pipeline-dev --max-items 1 \
  --query 'pipelineExecutionSummaries[0].[status,sourceRevisions[0].revisionId]' --output text --profile adminaccess
```
until `Succeeded`. (If SSO has expired the owner runs `aws sso login --profile adminaccess`.)

- [ ] **Step 3: Prove the deploy, not the code**

```bash
aws lambda get-function-configuration --function-name engagedev-check-question-set --query '[Timeout,Environment.Variables.AI_PROMPTS_BUCKET,LastModified]' --output text --profile adminaccess
aws lambda get-function-configuration --function-name engagedev-appeal-question-set --query LastModified --output text --profile adminaccess
API=https://ouv6fztlig.execute-api.us-east-1.amazonaws.com/dev
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$API/question-sets/callandanswer/appeal"            # expect 401, never 200
curl -s -o /dev/null -w '%{http_code}\n' "$API/question-sets/partygames/check/abc"                     # expect 401
curl -s https://engage.dev.seibtribe.us/bundle.js | LC_ALL=C grep -c -F 'Submit for review'           # expect ≥ 1
```

- [ ] **Step 4: Drive it in the browser on dev**

As a host who owns a personal org (or a QA org admin — `scripts/create-test-users.sh engagedev adminaccess` makes `qa-host-a@example.com` if none exists):

1. Question sets → a clean set → **Share** → the dialog reads like `05` → Submit → progress → "Now in the public library". The row says **Public v1**. Public library (org console) lists it badged Public; another org can Copy it.
2. Upload a small set with one deliberately violent question → Share → the dialog closes onto the editor → the `06` banner names the question with a sentence → Edit Qn focuses the row → fix it → Resubmit → passes.
3. Re-flag a set → **Ask for a human review** → the row says **Waiting for Engage**; in DynamoDB `PK=MODERATION` has one row with no question text; S3 `moderation/<org>/<set>/v<n>/` holds the snapshot.
4. Submit the same version twice quickly → the second says "already being checked".
5. Question sets nav shows the flagged count as a badge.

Record what you saw, with the set ids, in the reply. Anything that does not match is a bug in this plan's code, not in the drive.

- [ ] **Step 5: Commit nothing further; report**

State the commit on dev, the baselines before and after, and the five drive results. Stage 2's plan starts from here.

---

## Self-review notes (run by the author of this plan)

- **Spec coverage, Stage 1:** §2 lifecycle (Tasks 10–12), §3.1 stamp (5, 9, 10), §3.2 queue writes (4, 10, 12), §3.3 snapshot (10; S3 read is Stage 2), §3.4 log (3; every writer appends), §4.1 publishable + images + Workie (2, 7, 10), §4.2 job + lock + poll + budget + units + cap (5, 6, 10, 11), §4.3 explanations (8), §4.4 declared notice — API only (10, 11); the checkbox needs the vocabulary and is Stage 4, §5.1 publish routine (9), §5.2 unpublish batches + stamp (9), §9 routes and authorizer (14, 15), §10.1 (18), §10.2 (19, 20), §10.3 column + chips + badge (17, 20, 21), §11 edge cases (10 tests), §12 tests (every task), §13 dev (22). **Not in Stage 1:** takedown, the queue screen, decide, the score card, the staff/org public library screens, reports, notices, the access log — Plan 2 onward.
- **Placeholder scan:** no TBD/TODO; two places say "read the file and match the shape" with the exact command to run (`setNotice` argument shape; the editor suite's fetch router) — instructions, not gaps.
- **Type consistency:** `share` stamp fields (`version, status, at, publicSetId, publicVersion, note, contentHash, jobId, reasons`) are the same in Tasks 5, 9, 10, 12, 13, 16; `reasons` values (`guardrail | declared | images | timeout | snapshot | error`) in 10 and 16; `interpretCheckJob` outcomes (`running | passed | flagged | escalated | failed`) in 16 and 18; `versionChip` keys in 16 and 20; queue `reasons` (`escalated | appealed`) in 4, 10, 12.
