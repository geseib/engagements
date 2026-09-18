# Public Library Stage 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The human half of the pipeline Stage 1 made honest — Engage staff see what the check could not decide, open the snapshot, approve or reject it, take a published set down — and the two public-library screens: the org console's library of what other organisations have published, and the staff console's list of everything public.

**Architecture:** Four new staff handlers behind `canManageScope(event, PLATFORM, '')` (the `admins` group AND platform mode, the interlock `tenant.js` already enforces for writes to Engage's library): `GET /admin/moderation` lists the `MODERATION` pointer partition oldest-first; `GET /admin/moderation/{sk}` returns the pointer, the org's REVIEW facts and the S3 snapshot with uncertain questions first; `POST /admin/moderation/decide` moves the REVIEW row by a conditional transition and either publishes from the snapshot (the byte-for-byte reviewed content) or rejects with a note; `GET|DELETE /admin/public-library/{publicSetId}` reads a public set's standing and takes it down. Every write goes through Stage 1's shared modules (`set-review`, `publish-set`, `moderation-queue`, `review-log`, `share-stamp`); one new module reads and deletes snapshots. On the frontend, `ModerationPanel` (`.modq`) with its review `Modal`, `ScoreCard` (`.scard`) as a place in the platform console, the platform `publiclibrary` section reusing `QuestionSetsPanel` with an Unpublish action, and the org `library` section reusing `QuestionSetsPanel` on public rows.

**Tech Stack:** Node 22 Lambdas (`lambda-functions/admin`), DynamoDB single table, S3 (`AIPromptsBucket`, prefix `moderation/`), SAM `template-clean.yaml`; React (`src/src`), jest; backend tests are plain node scripts under `tests/` on `tests/helpers/moderation-harness.js`.

**Spec:** `docs/superpowers/specs/2026-09-17-public-library-moderation-design.md` — §1 stage 2 ("the queue, the decision, the snapshot, takedown, the score card, the staff public library, the org public library"), §3.2, §3.3, §5.2, §6.1, §9, §10.4, §10.5, §11, §12, §13. Reports (§6.2, §10.6), content notices (§7, §10.7) and the access log (§8) are Stages 3–5 and are NOT in this plan; where a Stage 2 screen touches them (the notice picker on approve, the score card's reports and access rows, the library's Report action) this plan leaves the seam with a comment naming the stage.

## Global Constraints

- **Never write a partition-key literal** for `SETS`/`GAMES`; keys come from `tenant.js` / `set-version.js` helpers (`tests/no-global-partition-literals.js`). `MODERATION` and `REVIEWLOG#…` are declared in their own modules only.
- **Do not modify** `lambda-functions/admin/shared/tenant.js`, `tenant-crypto.js`, `set-version.js` (any of its three guarded-identical copies), or `question-set-access.js`.
- **No new request header** (CORS `AllowHeaders` untouched — `tests/cors-allows-sent-headers.js`).
- **Staff routes are gated twice:** the authorizer names each route (anchored, never a prefix — a set id can contain `join`, `answer`, `vote`, `games`, and the `{sk}` path segment contains a set id) and returns `['admins']`; every handler re-asks `canManageScope(event, tenant.PLATFORM, '')` and answers 403 otherwise.
- **The decision is conditional:** the REVIEW transition is a conditional Put on the row's current status (`transitionReview`), so two reviewers cannot both decide; the loser sees "already decided by <name>".
- **Approve publishes the snapshot, never the live rows** (`publishSnapshot` with the snapshot read from S3); the org partition is untouched by approve.
- **Takedown never touches the org's REVIEW row** (spec D11 / §5.2): it deletes the public partition, logs `taken-down` with the note, and writes the org `share` stamp conditionally on `share.publicSetId`.
- **Computed keys and `version` are written LAST** in every item literal; caller data never moves a row.
- **Frontend design rules** (`.claude/skills/engage-design/SKILL.md`): one namespaced stylesheet per screen, tokens only, no hex outside the token block, `color: var(--danger)` never, nothing below 12px, rows 36px, tables not cards, every dialog has an X and a bottom exit through one `requestClose`, one `<Modal>`, never a modal from a modal, `table-layout: fixed`, `contentTheme: 'dark'` per section. Palette tests are `*Palette.test.js` (never `*Token*`).
- **Copy rules** from the spec: band words, never scores; the queue head *"N sets the check would not decide on its own. Oldest has waited D days."*; the empty queue *"Nothing is waiting — the check decided everything on its own."*; the takedown modal states the consequence: *"gone for everyone; the organisation keeps their copy and sees your note"*.
- **Every test is watched failing first;** RED and GREEN are literal terminal output in the report. Judge suites by exit code.
- **Baselines hold at every push:** backend suites ≥ 138 / passes ≥ 3999 / 0 failing; frontend suites ≥ 211 / tests ≥ 5059; lint 0 errors / ≤ 10 warnings; build with the 2 known size warnings; `tests/template-validates.js`; `sam validate --template template-clean.yaml --region us-east-1 --lint` (clear `.aws-sam` first).
- **Worktree hygiene:** never `npm install` here; `node_modules` are symlinks to the main checkout.
- **Deploy rule:** a push to `dev` deploys dev; test is merged into, never fast-forwarded (`git checkout -B promote-test origin/test && git merge <sha> && git push origin promote-test:test`). Tests and build first; say which commit went where. The owner's standing instruction (2026-09-17): dev, then test.
- **Commit messages** end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` — a literal project convention, regardless of the model writing the diff.

## File structure

| File | Responsibility |
|---|---|
| `lambda-functions/admin/shared/snapshot-store.js` (new) | read / delete a moderation snapshot in S3 |
| `lambda-functions/admin/moderation-list.js` (new) | `GET /admin/moderation` |
| `lambda-functions/admin/moderation-get.js` (new) | `GET /admin/moderation/{sk}` — pointer + review + snapshot, uncertain first |
| `lambda-functions/admin/moderation-decide.js` (new) | `POST /admin/moderation/decide` — approve / reject |
| `lambda-functions/admin/public-library-item.js` (new) | `GET|DELETE /admin/public-library/{publicSetId}` — standing / takedown |
| `lambda-functions/admin/shared/share-stamp.js` | gains an optional `onlyIfPublicSetId` condition |
| `lambda-functions/admin/get-question-sets.js` | projects `sourceOrgName`, `sourceOrgId`, `sensitivity`, `publicVersion` |
| `lambda-functions/auth/authorizer.js`, `template-clean.yaml` | the four staff routes |
| `src/src/utils/moderationRow.js` (new) | pure: the "why" and "waiting" words for a pointer |
| `src/src/components/ModerationPanel.jsx` + `.css` (new, `.modq`) | the queue table and the review `Modal` |
| `src/src/components/ScoreCard.jsx` + `.css` (new, `.scard`) | a public set's standing, timeline and findings |
| `src/src/components/PublicLibraryPanel.jsx` (new) | the two library screens on top of `QuestionSetsPanel` |
| `src/src/config/consoleSections.js`, `src/src/AdminPage.jsx` | the `publiclibrary` section, the mounts, the score-card place |
| `tests/snapshot-store.js`, `tests/moderation-list.js`, `tests/moderation-get.js`, `tests/moderation-decide.js`, `tests/takedown.js`, `tests/public-projection.js`, `tests/authorizer-staff-routes.js` | backend |
| `src/src/__tests__/moderationRow.test.js`, `moderationPanel.test.jsx`, `modqPalette.test.js`, `scoreCard.test.jsx`, `scardPalette.test.js`, `publicLibraryPanel.test.jsx`, `adminModeration.test.jsx` | frontend |

---

### Task 1: `shared/snapshot-store.js` — read and delete a snapshot

**Files:**
- Create: `lambda-functions/admin/shared/snapshot-store.js`
- Test: `tests/snapshot-store.js`

**Interfaces:**
- Consumes: the harness's S3 stub (`H.state.s3`, a `Map` keyed `${Bucket}/${Key}`; `GetObjectCommand` answers `{ Body: { transformToString } }`; `DeleteObjectCommand` removes the key).
- Produces: `readSnapshot(s3, bucket, key) → object | null` (null when the key is missing or the body is not JSON); `deleteSnapshot(s3, bucket, key) → boolean` (true when a delete was issued; a missing key is not an error).

- [ ] **Step 1: Write the failing test**

```js
// tests/snapshot-store.js
const path = require('path');
const assert = require('assert');
const H = require('./helpers/moderation-harness');
H.install();
const { S3Client } = require('@aws-sdk/client-s3');
const s3 = new S3Client({});
const { readSnapshot, deleteSnapshot } = require(path.join(H.REPO, 'lambda-functions/admin/shared/snapshot-store.js'));
const BUCKET = 'prompts-test';
(async () => {
  console.log('\nsnapshot-store\n');
  await H.test('a stored snapshot reads back as the object that was put', async () => {
    H.reset();
    H.state.s3.set(`${BUCKET}/moderation/org_acme/safety/v2/2026-09-17T10-00-00-000Z.json`, JSON.stringify({ version: 2, questions: [{ SK: 'QUESTION#c001#001', Title: 'Q1' }] }));
    const snap = await readSnapshot(s3, BUCKET, 'moderation/org_acme/safety/v2/2026-09-17T10-00-00-000Z.json');
    assert.strictEqual(snap.version, 2);
    assert.strictEqual(snap.questions[0].Title, 'Q1');
  });
  await H.test('a missing key reads as null, not an error', async () => {
    H.reset();
    assert.strictEqual(await readSnapshot(s3, BUCKET, 'moderation/nope.json'), null);
  });
  await H.test('a body that is not JSON reads as null', async () => {
    H.reset();
    H.state.s3.set(`${BUCKET}/moderation/bad.json`, 'not json');
    assert.strictEqual(await readSnapshot(s3, BUCKET, 'moderation/bad.json'), null);
  });
  await H.test('delete removes the key and tolerates a missing one', async () => {
    H.reset();
    H.state.s3.set(`${BUCKET}/moderation/x.json`, '{}');
    assert.strictEqual(await deleteSnapshot(s3, BUCKET, 'moderation/x.json'), true);
    assert.ok(!H.state.s3.has(`${BUCKET}/moderation/x.json`), 'the key is still there');
    assert.strictEqual(await deleteSnapshot(s3, BUCKET, 'moderation/x.json'), true);
  });
  H.summary();
})();
```

If the harness's `GetObjectCommand` stub throws on a missing key rather than returning an empty body, that throw is what `readSnapshot` must catch; read `tests/helpers/moderation-harness.js` around its `getObject` branch before writing the module and match it.

- [ ] **Step 2: Run it to see it fail**

Run: `node tests/snapshot-store.js`
Expected: `Cannot find module '.../shared/snapshot-store.js'`.

- [ ] **Step 3: Write the module**

```js
// lambda-functions/admin/shared/snapshot-store.js
/**
 * THE SNAPSHOT A PERSON REVIEWS. The check uploads what it judged to
 * `moderation/<orgId>/<setId>/v<n>/<checkedAt>.json` (set-check-worker.js
 * `snapshotKeyFor`); approve publishes THAT object, byte for byte, and reject
 * deletes it (spec §3.3, D9). The bucket's lifecycle rule expires strays in
 * 30 days, so a delete here is a courtesy, not the guarantee.
 */
const { GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

const isMissing = (error) => {
  const name = error && (error.name || error.Code || error.code);
  return name === 'NoSuchKey' || name === 'NotFound' || (error && error.$metadata && error.$metadata.httpStatusCode === 404);
};

async function readSnapshot(s3, bucket, key) {
  if (!bucket || !key) return null;
  let res;
  try {
    res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
  if (!res || !res.Body) return null;
  const text = typeof res.Body.transformToString === 'function' ? await res.Body.transformToString() : String(res.Body);
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

async function deleteSnapshot(s3, bucket, key) {
  if (!bucket || !key) return false;
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  return true;
}

module.exports = { readSnapshot, deleteSnapshot };
```

- [ ] **Step 4: Run the test**

Run: `node tests/snapshot-store.js`
Expected: `4 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add lambda-functions/admin/shared/snapshot-store.js tests/snapshot-store.js
git commit -m "A snapshot can be read back and deleted, and a missing one is null rather than an error

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `moderation-list.js` — `GET /admin/moderation`

**Files:**
- Create: `lambda-functions/admin/moderation-list.js`
- Test: `tests/moderation-list.js`

**Interfaces:**
- Consumes: `listQueue(db, table)` (`shared/moderation-queue.js`; rows sorted by `waitingSince`), `canManageScope(event, PLATFORM, '')` (`shared/tenant.js`).
- Produces: `200 { items: [{ sk, orgId, orgName, setId, title, version, gameType, questionCount, reasons, bands, uncertainQuestionIds, appealMessage, reports, waitingSince, latestAt, publicSetId }], count, oldestWaitingSince }`; `403 { error }` for anyone who is not staff in platform mode.

- [ ] **Step 1: Write the failing test**

```js
// tests/moderation-list.js
const path = require('path');
const assert = require('assert');
const H = require('./helpers/moderation-harness');
H.install();
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const db = DynamoDBDocumentClient.from({});
const T = 'engage-test';
const Q = require(path.join(H.REPO, 'lambda-functions/admin/shared/moderation-queue.js'));
const { handler } = require(path.join(H.REPO, 'lambda-functions/admin/moderation-list.js'));
const parse = (res) => JSON.parse(res.body || '{}');
async function seed() {
  H.reset();
  await Q.upsertQueueRow(db, T, { ref: { scope: 'org', orgId: 'org_acme', setId: 'safety' }, version: 2, reason: 'escalated', orgName: 'Acme', title: 'Safety walkthrough', gameType: 'trivia', questionCount: 30, bands: { HIGH: 0, MEDIUM: 2 }, uncertainQuestionIds: ['q014', 'q022'] }, { now: new Date('2026-09-15T10:00:00.000Z') });
  await Q.upsertQueueRow(db, T, { ref: { scope: 'org', orgId: 'org_beta', setId: 'onboarding' }, version: 1, reason: 'appealed', orgName: 'Beta', title: 'Onboarding', gameType: 'poll', questionCount: 12, appealMessage: 'It is a clinical set.' }, { now: new Date('2026-09-17T09:00:00.000Z') });
}
(async () => {
  console.log('\nGET /admin/moderation\n');
  await H.test('staff in platform mode see the queue oldest first, with the head facts', async () => {
    await seed();
    const res = await handler(H.platformEvent({ method: 'GET' }), H.ctx());
    assert.strictEqual(res.statusCode, 200, res.body);
    const body = parse(res);
    assert.strictEqual(body.count, 2);
    assert.deepStrictEqual(body.items.map((i) => i.setId), ['safety', 'onboarding']);
    assert.strictEqual(body.oldestWaitingSince, '2026-09-15T10:00:00.000Z');
    assert.strictEqual(body.items[0].sk, 'org_acme#safety#v2');
    assert.deepStrictEqual(body.items[0].reasons, ['escalated']);
    assert.strictEqual(body.items[1].appealMessage, 'It is a clinical set.');
  });
  await H.test('an empty queue is an empty list, not an error', async () => {
    H.reset();
    const res = await handler(H.platformEvent({ method: 'GET' }), H.ctx());
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(parse(res), { items: [], count: 0, oldestWaitingSince: null });
  });
  await H.test('an org admin is refused, and so is staff standing inside an org', async () => {
    await seed();
    const org = await handler(H.orgEvent({ orgId: 'org_acme', role: 'owner', method: 'GET' }), H.ctx());
    assert.strictEqual(org.statusCode, 403, org.body);
    const staffInOrg = await handler(H.orgEvent({ orgId: 'org_acme', role: 'owner', method: 'GET', groups: 'admins' }), H.ctx());
    assert.strictEqual(staffInOrg.statusCode, 403, staffInOrg.body);
  });
  H.summary();
})();
```

- [ ] **Step 2: Run it to see it fail**

Run: `node tests/moderation-list.js`
Expected: `Cannot find module '.../moderation-list.js'`.

- [ ] **Step 3: Write the handler**

```js
// lambda-functions/admin/moderation-list.js
/**
 * GET /admin/moderation — the pointer partition, oldest first (spec §6.1).
 *
 * Staff in platform mode only, and asked here as well as in the authorizer:
 * the group says WHO may look, the absence of an active organisation says they
 * are doing so AS Engage (tenant.js `canManageScope`, the same interlock that
 * gates writes to the shared library). A pointer row carries no question text
 * by design (§3.2), so this response never needs decrypting.
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const tenant = require('./shared/tenant');
const { listQueue } = require('./shared/moderation-queue');

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = () => process.env.TABLE_NAME;
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Engage-Org', 'Access-Control-Allow-Methods': 'GET,OPTIONS', 'Content-Type': 'application/json' };
const json = (statusCode, body) => ({ statusCode, headers: cors, body: JSON.stringify(body) });

const project = (row) => ({
  sk: row.SK,
  orgId: row.orgId || '',
  orgName: row.orgName || '',
  setId: row.setId || '',
  title: row.title || '',
  version: row.version || 0,
  gameType: row.gameType || '',
  questionCount: row.questionCount || 0,
  reasons: Array.isArray(row.reasons) ? row.reasons : [],
  bands: row.bands && typeof row.bands === 'object' ? row.bands : {},
  uncertainQuestionIds: Array.isArray(row.uncertainQuestionIds) ? row.uncertainQuestionIds : [],
  appealMessage: row.appealMessage || '',
  reports: row.reports && typeof row.reports === 'object' ? row.reports : null,
  waitingSince: row.waitingSince || null,
  latestAt: row.latestAt || null,
  publicSetId: row.publicSetId || '',
});

exports.handler = async (event) => {
  const method = event.requestContext?.http?.method || event.httpMethod;
  if (method === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (!tenant.canManageScope(event, tenant.PLATFORM, '')) {
    return json(403, { error: 'The moderation queue is for Engage staff acting as Engage.' });
  }
  try {
    const rows = await listQueue(db, TABLE());
    const items = rows.map(project);
    return json(200, { items, count: items.length, oldestWaitingSince: items.length ? items[0].waitingSince : null });
  } catch (error) {
    console.error('❌ moderation list failed:', error);
    return json(500, { error: `Could not read the queue: ${error.message}` });
  }
};
```

Copy the `cors` object from `check-question-set.js` verbatim if it differs from the above — the CORS guard (`tests/cors-allows-sent-headers.js`) compares handlers against the template's `AllowHeaders`.

- [ ] **Step 4: Run the test**

Run: `node tests/moderation-list.js && node tests/cors-allows-sent-headers.js | tail -1`
Expected: `3 passed, 0 failed`; the CORS guard unchanged.

- [ ] **Step 5: Commit**

```bash
git add lambda-functions/admin/moderation-list.js tests/moderation-list.js
git commit -m "Staff acting as Engage can read the moderation queue, oldest first, and nobody else can

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: `moderation-get.js` — `GET /admin/moderation/{sk}`

**Files:**
- Create: `lambda-functions/admin/moderation-get.js`
- Test: `tests/moderation-get.js`

**Interfaces:**
- Consumes: `queueKey(sk)` (`shared/moderation-queue.js`), `readReview(db, table, ref, version)` (`shared/set-review.js`), `readSnapshot` (Task 1), `questionText` and `setText` (`shared/publishable.js`), `readReviewLog(db, table, ref)` (`shared/review-log.js`).
- Produces: `200 { pointer, review: { status, findings, reasons, checkedAt, note, contentHash }, snapshot: { meta: { name, description, engagementType }, categories: [{ id, name }], questions: [{ questionId, category, title, text, findings }] } | null, setFindings: [], log: [...] }` with uncertain questions first; `400` for an `{sk}` that does not parse into one of §3.2's three shapes; `404` when no pointer row exists; `403` for non-staff. The access-log write of spec §8 is Stage 5 — this handler leaves a comment where it goes.

- [ ] **Step 1: Write the failing test**

```js
// tests/moderation-get.js
const path = require('path');
const assert = require('assert');
const H = require('./helpers/moderation-harness');
H.install();
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const db = DynamoDBDocumentClient.from({});
const T = 'engage-test';
process.env.AI_PROMPTS_BUCKET = 'prompts-test';
const Q = require(path.join(H.REPO, 'lambda-functions/admin/shared/moderation-queue.js'));
const R = require(path.join(H.REPO, 'lambda-functions/admin/shared/set-review.js'));
const L = require(path.join(H.REPO, 'lambda-functions/admin/shared/review-log.js'));
const { handler } = require(path.join(H.REPO, 'lambda-functions/admin/moderation-get.js'));
const parse = (res) => JSON.parse(res.body || '{}');
const SRC = { scope: 'org', orgId: 'org_acme', setId: 'safety' };
const KEY = 'moderation/org_acme/safety/v2/2026-09-17T10-00-00-000Z.json';
const SNAPSHOT = {
  version: 2, contentHash: 'c'.repeat(64),
  meta: { name: 'Safety walkthrough', description: 'Site safety', engagementType: 'trivia' },
  categories: [{ SK: 'CATEGORY#c001', Name: 'Injuries' }, { SK: 'CATEGORY#c002', Name: 'PPE' }],
  questions: [
    { SK: 'QUESTION#c001#001', Category: 'Injuries', Title: 'A clean one', Detail: 'Which glove?', optionA: 'Nitrile', optionB: 'None' },
    { SK: 'QUESTION#c001#014', Category: 'Injuries', Title: 'Describe the injury', Detail: 'In detail.', optionA: 'A', optionB: 'B' },
    { SK: 'QUESTION#c002#022', Category: 'PPE', Title: 'Who is to blame', Detail: 'A category of people.', optionA: 'A', optionB: 'B' },
  ],
};
async function seed() {
  H.reset();
  H.state.s3.set(`prompts-test/${KEY}`, JSON.stringify(SNAPSHOT));
  await R.writeReview(db, T, SRC, 2, { status: R.STATUS.ESCALATED, reasons: ['guardrail'], snapshotKey: KEY, contentHash: 'c'.repeat(64), findings: [
    { questionId: 'c001#014', category: 'VIOLENCE', band: 'MEDIUM', explanation: 'Asking for injuries in detail is what was flagged, not the safety topic.' },
    { questionId: 'c002#022', category: 'HATE', band: 'MEDIUM', explanation: 'The question invites an answer about a category of people.' },
    { questionId: '(set)', category: 'VIOLENCE', band: 'LOW' },
  ] });
  await Q.upsertQueueRow(db, T, { ref: SRC, version: 2, reason: 'escalated', orgName: 'Acme', title: 'Safety walkthrough', gameType: 'trivia', questionCount: 3, snapshotKey: KEY, contentHash: 'c'.repeat(64), uncertainQuestionIds: ['c001#014', 'c002#022'] });
  await L.appendReviewEvent(db, T, SRC, 'escalated', { version: 2, reasons: ['guardrail'] });
}
const get = (sk) => handler(H.platformEvent({ method: 'GET', path: { sk: encodeURIComponent(sk) } }), H.ctx());
(async () => {
  console.log('\nGET /admin/moderation/{sk}\n');
  await H.test('the pointer, the review facts and the snapshot come back, uncertain questions first', async () => {
    await seed();
    const res = await get('org_acme#safety#v2');
    assert.strictEqual(res.statusCode, 200, res.body);
    const body = parse(res);
    assert.strictEqual(body.pointer.sk, 'org_acme#safety#v2');
    assert.strictEqual(body.review.status, 'escalated');
    assert.strictEqual(body.snapshot.meta.name, 'Safety walkthrough');
    assert.deepStrictEqual(body.snapshot.categories, [{ id: 'c001', name: 'Injuries' }, { id: 'c002', name: 'PPE' }]);
    assert.deepStrictEqual(body.snapshot.questions.map((q) => q.questionId), ['c001#014', 'c002#022', 'c001#001'], 'uncertain first, then the rest in set order');
    assert.strictEqual(body.snapshot.questions[0].findings[0].band, 'MEDIUM');
    assert.match(body.snapshot.questions[0].findings[0].explanation, /injuries in detail/);
    assert.match(body.snapshot.questions[0].text, /Describe the injury/);
    assert.deepStrictEqual(body.snapshot.questions[2].findings, []);
    assert.strictEqual(body.setFindings.length, 1);
    assert.strictEqual(body.log[0].event, 'escalated');
  });
  await H.test('a snapshot that is gone reads as null and the rest still answers', async () => {
    await seed();
    H.state.s3.clear();
    const res = await get('org_acme#safety#v2');
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(parse(res).snapshot, null);
    assert.strictEqual(parse(res).review.status, 'escalated');
  });
  await H.test('an sk that is not one of the three shapes is a 400, and an unknown row a 404', async () => {
    await seed();
    assert.strictEqual((await get('not a key')).statusCode, 400);
    assert.strictEqual((await get('org_acme#missing#v9')).statusCode, 404);
    assert.strictEqual((await get('PUBLIC#orgacme-safety')).statusCode, 404, 'a well-formed public sk with no row');
  });
  await H.test('an org admin is refused', async () => {
    await seed();
    const res = await handler(H.orgEvent({ orgId: 'org_acme', role: 'owner', method: 'GET', path: { sk: encodeURIComponent('org_acme#safety#v2') } }), H.ctx());
    assert.strictEqual(res.statusCode, 403);
  });
  H.summary();
})();
```

- [ ] **Step 2: Run it to see it fail**

Run: `node tests/moderation-get.js`
Expected: `Cannot find module '.../moderation-get.js'`.

- [ ] **Step 3: Write the handler**

```js
// lambda-functions/admin/moderation-get.js
/**
 * GET /admin/moderation/{sk} — one queued set, opened (spec §6.1, §10.5).
 *
 * The pointer says WHY it is here; the org's REVIEW row says what the check
 * found (findings with the sentence 06 promised); the S3 snapshot is WHAT was
 * judged — and what approve will publish, byte for byte. Uncertain questions
 * come first: a reviewer's job is the handful the check could not decide, not
 * a re-read of the set.
 *
 * Stage 5 (spec §8) adds the access-log write here — opening a snapshot is the
 * moment the organisation's log names the reviewer. The seam is marked below.
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client } = require('@aws-sdk/client-s3');
const tenant = require('./shared/tenant');
const { queueKey } = require('./shared/moderation-queue');
const { readReview } = require('./shared/set-review');
const { readReviewLog } = require('./shared/review-log');
const { readSnapshot } = require('./shared/snapshot-store');
const { questionText } = require('./shared/publishable');

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});
const TABLE = () => process.env.TABLE_NAME;
const BUCKET = () => process.env.AI_PROMPTS_BUCKET || '';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Engage-Org', 'Access-Control-Allow-Methods': 'GET,OPTIONS', 'Content-Type': 'application/json' };
const json = (statusCode, body) => ({ statusCode, headers: cors, body: JSON.stringify(body) });

/** The three shapes of §3.2, and the ref each names. Anything else is refused. */
function parseSk(raw) {
  const sk = String(raw || '').trim();
  let m = /^([A-Za-z0-9_-]+)#([A-Za-z0-9_-]+)#v(\d+)$/.exec(sk);
  if (m) return { sk, ref: { scope: 'org', orgId: m[1], setId: m[2] }, version: Number(m[3]) };
  m = /^PUBLIC#([A-Za-z0-9_-]+)$/.exec(sk);
  if (m) return { sk, ref: { scope: 'public', orgId: '', setId: m[1] }, version: 0 };
  m = /^PLATFORM#([A-Za-z0-9_-]+)$/.exec(sk);
  if (m) return { sk, ref: { scope: 'platform', orgId: '', setId: m[1] }, version: 0 };
  return null;
}

const bareId = (sk) => String(sk || '').replace(/^QUESTION#/, '');
const categoryId = (sk) => String(sk || '').replace(/^CATEGORY#/, '');

/** Uncertain (any finding) first, in set order within each group. */
function shapeSnapshot(snapshot, findings) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const byQuestion = new Map();
  for (const f of findings) {
    if (!f || !f.questionId || f.questionId === '(set)') continue;
    if (!byQuestion.has(f.questionId)) byQuestion.set(f.questionId, []);
    byQuestion.get(f.questionId).push(f);
  }
  const questions = (snapshot.questions || []).map((q) => ({
    questionId: bareId(q.SK),
    category: q.Category || q.category || '',
    title: q.Title || q.title || '',
    text: questionText(q),
    findings: byQuestion.get(bareId(q.SK)) || [],
  }));
  const uncertain = questions.filter((q) => q.findings.length);
  const rest = questions.filter((q) => !q.findings.length);
  return {
    meta: {
      name: (snapshot.meta && (snapshot.meta.name || snapshot.meta.Name)) || '',
      description: (snapshot.meta && (snapshot.meta.description || snapshot.meta.Description)) || '',
      engagementType: (snapshot.meta && snapshot.meta.engagementType) || '',
    },
    categories: (snapshot.categories || []).map((c) => ({ id: categoryId(c.SK), name: c.Name || c.name || '' })),
    questions: [...uncertain, ...rest],
  };
}

exports.handler = async (event) => {
  const method = event.requestContext?.http?.method || event.httpMethod;
  if (method === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (!tenant.canManageScope(event, tenant.PLATFORM, '')) {
    return json(403, { error: 'The moderation queue is for Engage staff acting as Engage.' });
  }
  let raw = event.pathParameters?.sk || '';
  try { raw = decodeURIComponent(raw); } catch { /* keep as sent; parseSk refuses it */ }
  const parsed = parseSk(raw);
  if (!parsed) return json(400, { error: 'That is not a queue entry.' });
  try {
    const row = await db.send(new GetCommand({ TableName: TABLE(), Key: queueKey(parsed.sk) }));
    if (!row || !row.Item) return json(404, { error: 'Nothing is waiting under that entry — it may already be decided.' });
    const pointer = { ...row.Item, sk: row.Item.SK };
    delete pointer.PK; delete pointer.SK;
    const review = parsed.ref.scope === 'org' ? await readReview(db, TABLE(), parsed.ref, parsed.version) : { status: 'unreviewed' };
    const findings = Array.isArray(review.findings) ? review.findings : [];
    const snapshot = pointer.snapshotKey ? await readSnapshot(s3, BUCKET(), pointer.snapshotKey) : null;
    const log = await readReviewLog(db, TABLE(), parsed.ref);
    // Stage 5 (spec §8): append the ORG#<orgId>#ACCESS row and the `access`
    // log event here — idempotent per reviewer / set / day.
    return json(200, {
      pointer,
      review: {
        status: review.status || 'unreviewed',
        findings,
        reasons: Array.isArray(review.reasons) ? review.reasons : [],
        checkedAt: review.checkedAt || null,
        note: review.note || '',
        contentHash: review.contentHash || '',
        declaredNotice: review.declaredNotice || null,
      },
      snapshot: shapeSnapshot(snapshot, findings),
      setFindings: findings.filter((f) => f && f.questionId === '(set)'),
      log,
    });
  } catch (error) {
    console.error('❌ moderation get failed:', error);
    return json(500, { error: `Could not open that entry: ${error.message}` });
  }
};
```

If `readReviewLog` returns rows with a different event field name than `event`, read `shared/review-log.js` and match the test to it (the test asserts `log[0].event === 'escalated'`); do not reshape the log here.

- [ ] **Step 4: Run the test and the neighbours**

Run: `node tests/moderation-get.js && node tests/moderation-list.js | tail -1 && node tests/cors-allows-sent-headers.js | tail -1`
Expected: `4 passed, 0 failed`; neighbours unchanged.

- [ ] **Step 5: Commit**

```bash
git add lambda-functions/admin/moderation-get.js tests/moderation-get.js
git commit -m "Opening a queued set hands the reviewer the pointer, the findings and the snapshot, uncertain questions first

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: `moderation-decide.js` — `POST /admin/moderation/decide`

**Files:**
- Create: `lambda-functions/admin/moderation-decide.js`
- Test: `tests/moderation-decide.js`

**Interfaces:**
- Consumes: `readReview`, `transitionReview(db, table, ref, version, from, patch)` (returns the new row or `null` on a lost race — `patch` is spread before the keys, so it may add `reviewer`, `decidedAt`, `note`, `notice`), `STATUS` (`shared/set-review.js`); `publishSnapshot(db, table, snapshot, { review, sourceOrgName, promptDropped })` → `{ pubRef, publicSetId, publicVersion, rowsPublished, questionCount }` (`shared/publish-set.js`); `writeShareStamp`; `appendReviewEvent`; `deleteQueueRow`, `queueKey`; `readSnapshot`, `deleteSnapshot` (Task 1); `setMetadataKey` (`shared/set-version.js`) for the public row's `sensitivity`.
- Produces: `POST { sk, decision: 'approve' | 'reject', note?, notice? }` → `200 { decision, publicSetId?, publicVersion? }`; `400` bad body or a non-org sk (reported rows are Stage 3); `403` non-staff; `404` no pointer; `409 { error: 'Already decided by <name>', status }` on a lost race or a review not in `escalated | appealed`; `409 { error: 'The snapshot is gone…' }` when approve finds no snapshot.
- On approve: REVIEW ← `passed` (`reviewer`, `note`, `decidedAt`, `notice`); the snapshot is published; `sensitivity` (the notice ids) is written on the public metadata row; the org `share` stamp ← `published`; log `decided` and `published`; queue row deleted; the snapshot is KEPT (D9: deleted on reject/dismiss). On reject: REVIEW ← `flagged` (`reviewer`, `note`); stamp ← `flagged` with the note; snapshot deleted; log `decided`; queue row deleted. The org partition's content rows are never touched.

- [ ] **Step 1: Write the failing test**

```js
// tests/moderation-decide.js
const path = require('path');
const assert = require('assert');
const H = require('./helpers/moderation-harness');
H.install();
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');
const db = DynamoDBDocumentClient.from({});
const T = 'engage-test';
process.env.AI_PROMPTS_BUCKET = 'prompts-test';
const Q = require(path.join(H.REPO, 'lambda-functions/admin/shared/moderation-queue.js'));
const R = require(path.join(H.REPO, 'lambda-functions/admin/shared/set-review.js'));
const L = require(path.join(H.REPO, 'lambda-functions/admin/shared/review-log.js'));
const S = require(path.join(H.REPO, 'lambda-functions/admin/shared/share-stamp.js'));
const V = require(path.join(H.REPO, 'lambda-functions/admin/shared/set-version.js'));
const { publicSetIdFor } = require(path.join(H.REPO, 'lambda-functions/admin/shared/publish-set.js'));
const { handler } = require(path.join(H.REPO, 'lambda-functions/admin/moderation-decide.js'));
const parse = (res) => JSON.parse(res.body || '{}');
const SRC = { scope: 'org', orgId: 'org_acme', setId: 'safety' };
const PUB = publicSetIdFor('org_acme', 'safety');
const KEY = 'moderation/org_acme/safety/v2/2026-09-17T10-00-00-000Z.json';
const SNAPSHOT = {
  version: 2, contentHash: 'c'.repeat(64),
  meta: { name: 'Safety walkthrough', description: 'Site safety', engagementType: 'trivia', promptId: 'org-workie' },
  categories: [{ SK: 'CATEGORY#c001', Name: 'Injuries' }],
  questions: [
    { SK: 'QUESTION#c001#001', Category: 'Injuries', Title: 'A clean one', Detail: 'Which glove?', optionA: 'Nitrile', optionB: 'None', correctAnswer: 'OptionA' },
    { SK: 'QUESTION#c001#014', Category: 'Injuries', Title: 'Describe the injury', Detail: 'In detail.', optionA: 'A', optionB: 'B', correctAnswer: 'OptionA' },
  ],
};
const ORG_ROW = { PK: V.setPartition(SRC, 2), SK: 'QUESTION#c001#001', Title: 'ENCRYPTED-LOOKING', Detail: 'the org copy, untouched' };
async function seed(status = R.STATUS.ESCALATED) {
  H.reset();
  H.state.s3.set(`prompts-test/${KEY}`, JSON.stringify(SNAPSHOT));
  H.seedRow({ ...V.setMetadataKey(SRC), name: 'x', activeVersion: 2, versions: [{ version: 2 }], share: { status: 'escalated', version: 2 } });
  H.seedRow({ ...ORG_ROW });
  await R.writeReview(db, T, SRC, 2, { status, reasons: ['guardrail'], snapshotKey: KEY, contentHash: 'c'.repeat(64), promptDropped: true, findings: [{ questionId: 'c001#014', category: 'VIOLENCE', band: 'MEDIUM', explanation: 'x' }] });
  await Q.upsertQueueRow(db, T, { ref: SRC, version: 2, reason: status === R.STATUS.APPEALED ? 'appealed' : 'escalated', orgName: 'Acme', title: 'Safety walkthrough', gameType: 'trivia', questionCount: 2, snapshotKey: KEY, contentHash: 'c'.repeat(64) });
}
const decide = (body, event = H.platformEvent({ method: 'POST', body, username: 'dai' })) => handler(event, H.ctx());
const rowsUnder = (pk) => H.rowsWhere((r) => r.PK === pk);
(async () => {
  console.log('\nPOST /admin/moderation/decide\n');
  await H.test('approve publishes the snapshot byte for byte, records who decided, and clears the queue', async () => {
    await seed();
    const res = await decide({ sk: 'org_acme#safety#v2', decision: 'approve', note: 'Clinical, not gratuitous.', notice: ['graphic-medical'] });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.deepStrictEqual(parse(res), { decision: 'approve', publicSetId: PUB, publicVersion: 1 });
    const review = await R.readReview(db, T, SRC, 2);
    assert.strictEqual(review.status, 'passed');
    assert.strictEqual(review.reviewer, 'dai');
    assert.strictEqual(review.note, 'Clinical, not gratuitous.');
    assert.deepStrictEqual(review.notice, ['graphic-medical']);
    assert.strictEqual(review.findings.length, 1, 'the findings survive the decision');
    const pubMeta = (await db.send(new GetCommand({ TableName: T, Key: V.setMetadataKey({ scope: 'public', orgId: '', setId: PUB }) }))).Item;
    assert.strictEqual(pubMeta.sourceOrgName, 'Acme');
    assert.deepStrictEqual(pubMeta.sensitivity, ['graphic-medical']);
    assert.strictEqual(pubMeta.promptDropped, true, 'the org Workie never reaches the public copy');
    const pubRows = rowsUnder(V.setPartition({ scope: 'public', orgId: '', setId: PUB }, 1)).filter((r) => String(r.SK).startsWith('QUESTION#'));
    assert.strictEqual(pubRows.length, 2);
    assert.strictEqual(pubRows.find((r) => r.SK === 'QUESTION#c001#014').Detail, 'In detail.', 'published from the snapshot');
    assert.deepStrictEqual(rowsUnder(ORG_ROW.PK).find((r) => r.SK === ORG_ROW.SK), ORG_ROW, 'the org partition is untouched');
    const stamp = await S.readShareStamp(db, T, SRC);
    assert.strictEqual(stamp.status, 'published');
    assert.strictEqual(stamp.publicSetId, PUB);
    const events = (await L.readReviewLog(db, T, SRC)).map((e) => e.event);
    assert.ok(events.includes('decided') && events.includes('published'), `log: ${events}`);
    assert.strictEqual(H.rowsWhere((r) => r.PK === Q.QUEUE_PK).length, 0, 'the queue row is gone');
    assert.ok(H.state.s3.has(`prompts-test/${KEY}`), 'the snapshot is kept on approve (D9)');
  });
  await H.test('reject flags the version with the note, deletes the snapshot, and clears the queue', async () => {
    await seed(R.STATUS.APPEALED);
    const res = await decide({ sk: 'org_acme#safety#v2', decision: 'reject', note: 'Q14 needs the injury detail removed.' });
    assert.strictEqual(res.statusCode, 200, res.body);
    const review = await R.readReview(db, T, SRC, 2);
    assert.strictEqual(review.status, 'flagged');
    assert.strictEqual(review.note, 'Q14 needs the injury detail removed.');
    assert.strictEqual(review.findings.length, 1);
    const stamp = await S.readShareStamp(db, T, SRC);
    assert.strictEqual(stamp.status, 'flagged');
    assert.strictEqual(stamp.note, 'Q14 needs the injury detail removed.');
    assert.ok(!H.state.s3.has(`prompts-test/${KEY}`), 'the snapshot is deleted on reject');
    assert.strictEqual(H.rowsWhere((r) => r.PK === Q.QUEUE_PK).length, 0);
    assert.strictEqual(rowsUnder(V.setPartition({ scope: 'public', orgId: '', setId: PUB }, 1)).length, 0, 'nothing published');
  });
  await H.test('two reviewers cannot both decide: the second sees who did', async () => {
    await seed();
    const first = await decide({ sk: 'org_acme#safety#v2', decision: 'reject', note: 'no' });
    assert.strictEqual(first.statusCode, 200);
    const second = await decide({ sk: 'org_acme#safety#v2', decision: 'approve' }, H.platformEvent({ method: 'POST', body: { sk: 'org_acme#safety#v2', decision: 'approve' }, username: 'ana' }));
    assert.strictEqual(second.statusCode, 404, 'the queue row is gone, so the second reviewer is told nothing is waiting');
    await seed();
    await R.writeReview(db, T, SRC, 2, { status: R.STATUS.PASSED, reviewer: 'dai', findings: [] });
    const stale = await decide({ sk: 'org_acme#safety#v2', decision: 'reject', note: 'late' });
    assert.strictEqual(stale.statusCode, 409, stale.body);
    assert.match(parse(stale).error, /already decided by dai/i);
  });
  await H.test('approve without a snapshot is refused, and nothing changes', async () => {
    await seed();
    H.state.s3.clear();
    const res = await decide({ sk: 'org_acme#safety#v2', decision: 'approve' });
    assert.strictEqual(res.statusCode, 409, res.body);
    assert.strictEqual((await R.readReview(db, T, SRC, 2)).status, 'escalated');
    assert.strictEqual(H.rowsWhere((r) => r.PK === Q.QUEUE_PK).length, 1, 'still queued');
  });
  await H.test('a bad body, a reported-row sk, and a non-staff caller are refused', async () => {
    await seed();
    assert.strictEqual((await decide({ sk: 'org_acme#safety#v2', decision: 'maybe' })).statusCode, 400);
    assert.strictEqual((await decide({ sk: 'org_acme#safety#v2', decision: 'approve', note: 'x'.repeat(501) })).statusCode, 400);
    assert.strictEqual((await decide({ sk: 'PUBLIC#orgacme-safety', decision: 'approve' })).statusCode, 400, 'reported rows are decided in Stage 3');
    const org = await handler(H.orgEvent({ orgId: 'org_acme', role: 'owner', method: 'POST', body: { sk: 'org_acme#safety#v2', decision: 'approve' } }), H.ctx());
    assert.strictEqual(org.statusCode, 403);
  });
  H.summary();
})();
```

`writeReview` keeps a whitelist (`REVIEW_FIELDS`); the `reviewer` written in the stale-decision case goes through `transitionReview`'s patch in the handler, but the test seeds it with `writeReview` — if `reviewer` is not in `REVIEW_FIELDS`, add `'reviewer'`, `'decidedAt'` and `'notice'` to that whitelist in `shared/set-review.js` (a one-line change; it is the review row's own vocabulary) and say so in the report.

- [ ] **Step 2: Run it to see it fail**

Run: `node tests/moderation-decide.js`
Expected: `Cannot find module '.../moderation-decide.js'`.

- [ ] **Step 3: Write the handler**

```js
// lambda-functions/admin/moderation-decide.js
/**
 * POST /admin/moderation/decide — the person's answer (spec §6.1).
 *
 *   approve  REVIEW ← passed (reviewer, note, notice) · publish FROM THE SNAPSHOT
 *            · sensitivity on the public row · share stamp published · log
 *            decided + published · queue row deleted · snapshot kept (D9)
 *   reject   REVIEW ← flagged (reviewer, note) · share stamp flagged with the
 *            note · snapshot deleted · log decided · queue row deleted
 *
 * The REVIEW move is a conditional Put on the row's current status
 * (transitionReview), so two reviewers cannot both decide: the loser is told
 * who did. The org's content rows are never read or written here — approve
 * publishes what was judged, not what the org has since edited.
 *
 * dismiss / take down / keep-with-a-notice are answers to REPORTED rows and
 * arrive with reports (Stage 3); a reported-row sk is refused here.
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client } = require('@aws-sdk/client-s3');
const tenant = require('./shared/tenant');
const { queueKey, deleteQueueRow } = require('./shared/moderation-queue');
const { STATUS, readReview, transitionReview } = require('./shared/set-review');
const { publishSnapshot } = require('./shared/publish-set');
const { writeShareStamp } = require('./shared/share-stamp');
const { appendReviewEvent } = require('./shared/review-log');
const { readSnapshot, deleteSnapshot } = require('./shared/snapshot-store');
const { setMetadataKey } = require('./shared/set-version');

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});
const TABLE = () => process.env.TABLE_NAME;
const BUCKET = () => process.env.AI_PROMPTS_BUCKET || '';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Engage-Org', 'Access-Control-Allow-Methods': 'POST,OPTIONS', 'Content-Type': 'application/json' };
const json = (statusCode, body) => ({ statusCode, headers: cors, body: JSON.stringify(body) });

const NOTE_MAX = 500;
const NOTICE_ID = /^[a-z0-9-]{1,40}$/;
const DECISIONS = ['approve', 'reject'];
const OPEN = [STATUS.ESCALATED, STATUS.APPEALED];

const reviewerOf = (event) => String(event?.requestContext?.authorizer?.lambda?.username || event?.requestContext?.authorizer?.lambda?.userId || 'engage').trim();

/** Only the org shape decides here; PUBLIC# and PLATFORM# rows are reports (Stage 3). */
function parseOrgSk(raw) {
  const m = /^([A-Za-z0-9_-]+)#([A-Za-z0-9_-]+)#v(\d+)$/.exec(String(raw || '').trim());
  return m ? { sk: m[0], ref: { scope: 'org', orgId: m[1], setId: m[2] }, version: Number(m[3]) } : null;
}

function parseBody(event) {
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { error: 'The request body is not JSON.' }; }
  const parsed = parseOrgSk(body.sk);
  if (!parsed) return { error: 'That is not a queue entry this screen decides.' };
  const decision = String(body.decision || '').trim();
  if (!DECISIONS.includes(decision)) return { error: 'The decision must be approve or reject.' };
  const note = String(body.note || '').trim();
  if (note.length > NOTE_MAX) return { error: `The note is over ${NOTE_MAX} characters.` };
  const notice = Array.isArray(body.notice) ? body.notice.map((n) => String(n || '').trim()).filter(Boolean) : [];
  if (notice.length > 7 || notice.some((n) => !NOTICE_ID.test(n))) return { error: 'The content notice is not one this library knows.' };
  return { ...parsed, decision, note, notice };
}

async function writeSensitivity(pubRef, notice) {
  await db.send(new UpdateCommand({
    TableName: TABLE(),
    Key: setMetadataKey(pubRef),
    UpdateExpression: 'SET sensitivity = :n',
    ExpressionAttributeValues: { ':n': notice },
    ConditionExpression: 'attribute_exists(PK)',
  }));
}

exports.handler = async (event) => {
  const method = event.requestContext?.http?.method || event.httpMethod;
  if (method === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (!tenant.canManageScope(event, tenant.PLATFORM, '')) {
    return json(403, { error: 'Decisions are for Engage staff acting as Engage.' });
  }
  const input = parseBody(event);
  if (input.error) return json(400, { error: input.error });
  const { sk, ref, version, decision, note, notice } = input;
  const reviewer = reviewerOf(event);
  try {
    const row = await db.send(new GetCommand({ TableName: TABLE(), Key: queueKey(sk) }));
    if (!row || !row.Item) return json(404, { error: 'Nothing is waiting under that entry — it may already be decided.' });
    const pointer = row.Item;
    const review = await readReview(db, TABLE(), ref, version);
    if (!OPEN.includes(review.status)) {
      return json(409, { error: `Already decided by ${review.reviewer || 'somebody else'}.`, status: review.status });
    }
    const decidedAt = new Date().toISOString();

    if (decision === 'approve') {
      const snapshot = pointer.snapshotKey ? await readSnapshot(s3, BUCKET(), pointer.snapshotKey) : null;
      if (!snapshot) return json(409, { error: 'The snapshot is gone, so there is nothing to publish — ask the organisation to submit it again.' });
      const moved = await transitionReview(db, TABLE(), ref, version, review.status, {
        status: STATUS.PASSED, reviewer, decidedAt, note, ...(notice.length ? { notice } : {}),
      });
      if (!moved) {
        const now = await readReview(db, TABLE(), ref, version);
        return json(409, { error: `Already decided by ${now.reviewer || 'somebody else'}.`, status: now.status });
      }
      const published = await publishSnapshot(db, TABLE(), snapshot, {
        review: moved, sourceOrgName: pointer.orgName || '', promptDropped: review.promptDropped === true,
      });
      if (notice.length) await writeSensitivity(published.pubRef, notice);
      await writeShareStamp(db, TABLE(), ref, {
        version, status: 'published', publicSetId: published.publicSetId, publicVersion: published.publicVersion, contentHash: snapshot.contentHash || review.contentHash,
      });
      await appendReviewEvent(db, TABLE(), ref, 'decided', { version, decision, reviewer, note, notice, publicSetId: published.publicSetId, publicVersion: published.publicVersion });
      await appendReviewEvent(db, TABLE(), ref, 'published', { version, publicSetId: published.publicSetId, publicVersion: published.publicVersion, by: reviewer });
      await deleteQueueRow(db, TABLE(), sk);
      return json(200, { decision, publicSetId: published.publicSetId, publicVersion: published.publicVersion });
    }

    const moved = await transitionReview(db, TABLE(), ref, version, review.status, { status: STATUS.FLAGGED, reviewer, decidedAt, note });
    if (!moved) {
      const now = await readReview(db, TABLE(), ref, version);
      return json(409, { error: `Already decided by ${now.reviewer || 'somebody else'}.`, status: now.status });
    }
    await writeShareStamp(db, TABLE(), ref, { version, status: 'flagged', note, contentHash: review.contentHash });
    if (pointer.snapshotKey) await deleteSnapshot(s3, BUCKET(), pointer.snapshotKey);
    await appendReviewEvent(db, TABLE(), ref, 'decided', { version, decision, reviewer, note });
    await deleteQueueRow(db, TABLE(), sk);
    return json(200, { decision });
  } catch (error) {
    console.error('❌ decide failed:', error);
    return json(500, { error: `Could not record that decision: ${error.message}` });
  }
};
```

`publishSnapshot` reads `review` for the public REVIEW row's facts (`contentHash`); pass the moved row so the public row records `passed` by `reviewer`. If `publishSnapshot` derives `promptDropped` from the snapshot rather than the option, keep the option (it is the check's recorded rule) and read the module to confirm which wins — the test asserts the public metadata's `promptDropped` is `true`.

- [ ] **Step 4: Run the test and the neighbours**

Run: `node tests/moderation-decide.js && node tests/publish-question-set.js | tail -1 && node tests/set-check-job.js | tail -1 && node tests/moderation-queue.js | tail -1`
Expected: `5 passed, 0 failed`; neighbours unchanged.

- [ ] **Step 5: Commit**

```bash
git add lambda-functions/admin/moderation-decide.js tests/moderation-decide.js lambda-functions/admin/shared/set-review.js
git commit -m "A person's decision: approve publishes the snapshot that was judged, reject flags it with the note, and only one reviewer can decide

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

(Drop `shared/set-review.js` from the add if it did not need the whitelist change.)

---

### Task 5: `public-library-item.js` — `GET|DELETE /admin/public-library/{publicSetId}`

**Files:**
- Create: `lambda-functions/admin/public-library-item.js`
- Modify: `lambda-functions/admin/shared/share-stamp.js` (an optional `onlyIfPublicSetId` condition), `tests/helpers/moderation-harness.js` ONLY if its condition evaluator cannot resolve a nested path (`#share.publicSetId`) — then extend it and add one line to `tests/moderation-harness.js` proving it
- Test: `tests/takedown.js`

**Interfaces:**
- Consumes: `setMetadataKey`, `setPartition` (`shared/set-version.js`); `unpublishSet(db, table, source, pubRef)` (`shared/publish-set.js` — batch deletes the public partition and the source PUBLISHED rows); `readReview`, `readReviewLog`; `appendReviewEvent`; `writeShareStamp(db, table, ref, stamp, { onlyIfPublicSetId })`; `queueSk`, `deleteQueueRow`.
- Produces: `GET → 200 { publicSetId, name, description, engagementType, sourceOrgId, sourceOrgName, sourceSetId, sourceVersion, publicVersion, questionCount, contentHash, sensitivity, promptDropped, publishedAt, review: { status, reviewer, decidedAt, note, notice, findings, checkedAt }, log: [...] }`; `404` unknown; `403` non-staff. `DELETE { note } → 200 { takenDown: publicSetId }`; `400` no note; `404` unknown. The org's REVIEW row is never touched (D11); the org `share` stamp becomes `{ status: 'flagged', note, version: sourceVersion }` only if `share.publicSetId` still names this public set; any queue row for the set is deleted; `taken-down` is logged on the org set's log with the note and the reviewer.

- [ ] **Step 1: Write the failing test**

```js
// tests/takedown.js
const path = require('path');
const assert = require('assert');
const H = require('./helpers/moderation-harness');
H.install();
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');
const db = DynamoDBDocumentClient.from({});
const T = 'engage-test';
const V = require(path.join(H.REPO, 'lambda-functions/admin/shared/set-version.js'));
const R = require(path.join(H.REPO, 'lambda-functions/admin/shared/set-review.js'));
const L = require(path.join(H.REPO, 'lambda-functions/admin/shared/review-log.js'));
const S = require(path.join(H.REPO, 'lambda-functions/admin/shared/share-stamp.js'));
const Q = require(path.join(H.REPO, 'lambda-functions/admin/shared/moderation-queue.js'));
const { publicSetIdFor } = require(path.join(H.REPO, 'lambda-functions/admin/shared/publish-set.js'));
const { handler } = require(path.join(H.REPO, 'lambda-functions/admin/public-library-item.js'));
const parse = (res) => JSON.parse(res.body || '{}');
const SRC = { scope: 'org', orgId: 'org_acme', setId: 'safety' };
const PUB = publicSetIdFor('org_acme', 'safety');
const PUBREF = { scope: 'public', orgId: '', setId: PUB };
const FINDINGS = [{ questionId: 'c001#014', category: 'VIOLENCE', band: 'MEDIUM', explanation: 'x' }];
async function seed({ versions = 5, questions = 200 } = {}) {
  H.reset();
  H.seedRow({ ...V.setMetadataKey(SRC), name: 'x', activeVersion: 2, versions: [{ version: 2 }] });
  await R.writeReview(db, T, SRC, 2, { status: R.STATUS.PASSED, findings: FINDINGS, contentHash: 'c'.repeat(64), checkedBy: 'guardrail' });
  await S.writeShareStamp(db, T, SRC, { version: 2, status: 'published', publicSetId: PUB, publicVersion: versions, contentHash: 'c'.repeat(64) });
  H.seedRow({ ...V.setMetadataKey(PUBREF), name: 'Safety walkthrough', description: 'Site safety', engagementType: 'trivia', activeVersion: versions, versions: Array.from({ length: versions }, (_, i) => ({ version: i + 1, createdAt: '2026-09-17T10:00:00.000Z', questionCount: questions })), sourceOrgId: 'org_acme', sourceOrgName: 'Acme', sourceSetId: 'safety', sourceVersion: 2, contentHash: 'c'.repeat(64), questionCount: questions, sensitivity: ['graphic-medical'] });
  for (let v = 1; v <= versions; v += 1) {
    const pk = V.setPartition(PUBREF, v);
    H.seedRow({ PK: pk, SK: 'CATEGORY#c001', Name: 'Injuries' });
    for (let n = 1; n <= questions; n += 1) H.seedRow({ PK: pk, SK: `QUESTION#c001#${String(n).padStart(3, '0')}`, Title: `Q${n}` });
    H.seedRow({ ...R.reviewKey(PUBREF, v), status: 'passed', contentHash: 'c'.repeat(64), version: v });
    H.seedRow({ ...R.publishedKey(SRC, 2), publicSetId: PUB, publicVersion: v, at: '2026-09-17T10:00:00.000Z' });
  }
  await L.appendReviewEvent(db, T, SRC, 'published', { version: 2, publicSetId: PUB, publicVersion: versions });
  await Q.upsertQueueRow(db, T, { ref: SRC, version: 2, reason: 'reported', orgName: 'Acme', title: 'Safety walkthrough', publicSetId: PUB });
}
const publicRows = () => H.rowsWhere((r) => String(r.PK).startsWith(`PUBLIC#SET#${PUB}`) || (r.PK === V.setMetadataKey(PUBREF).PK && r.SK === V.setMetadataKey(PUBREF).SK));
const get = () => handler(H.platformEvent({ method: 'GET', path: { publicSetId: PUB } }), H.ctx());
const del = (body, event) => handler(event || H.platformEvent({ method: 'DELETE', body, path: { publicSetId: PUB }, username: 'dai' }), H.ctx());
(async () => {
  console.log('\nGET|DELETE /admin/public-library/{publicSetId}\n');
  await H.test('GET is the standing of a public set: source, versions, review, notice, log', async () => {
    await seed({ versions: 2, questions: 3 });
    const res = await get();
    assert.strictEqual(res.statusCode, 200, res.body);
    const b = parse(res);
    assert.strictEqual(b.publicSetId, PUB);
    assert.strictEqual(b.sourceOrgName, 'Acme');
    assert.strictEqual(b.sourceVersion, 2);
    assert.strictEqual(b.publicVersion, 2);
    assert.deepStrictEqual(b.sensitivity, ['graphic-medical']);
    assert.strictEqual(b.review.status, 'passed');
    assert.strictEqual(b.review.findings.length, 1);
    assert.strictEqual(b.log[0].event, 'published');
  });
  await H.test('takedown deletes every public row in batches, logs the note, flags the org stamp, and never touches the org REVIEW row', async () => {
    await seed();
    const before = publicRows().length;
    assert.ok(before > 1000, `fixture too small: ${before}`);
    const reviewBefore = JSON.stringify(await R.readReview(db, T, SRC, 2));
    const res = await del({ note: 'Reported for graphic detail; taken down pending an edit.' });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.deepStrictEqual(parse(res), { takenDown: PUB });
    assert.strictEqual(publicRows().length, 0, 'the public partition is gone');
    assert.strictEqual(JSON.stringify(await R.readReview(db, T, SRC, 2)), reviewBefore, 'the org REVIEW row is untouched (D11)');
    const stamp = await S.readShareStamp(db, T, SRC);
    assert.strictEqual(stamp.status, 'flagged');
    assert.strictEqual(stamp.note, 'Reported for graphic detail; taken down pending an edit.');
    assert.strictEqual(stamp.version, 2);
    const events = await L.readReviewLog(db, T, SRC);
    const td = events.find((e) => e.event === 'taken-down');
    assert.ok(td, 'taken-down is logged');
    assert.strictEqual(td.note, 'Reported for graphic detail; taken down pending an edit.');
    assert.strictEqual(td.reviewer, 'dai');
    assert.strictEqual(H.rowsWhere((r) => r.PK === Q.QUEUE_PK).length, 0, 'nothing left to decide');
    assert.strictEqual((await get()).statusCode, 404, 'gone for everyone');
  });
  await H.test('a stale stamp is left alone: the org already re-shared as a different public set', async () => {
    await seed({ versions: 1, questions: 2 });
    await S.writeShareStamp(db, T, SRC, { version: 3, status: 'published', publicSetId: 'somebody-else', publicVersion: 1 });
    const res = await del({ note: 'x' });
    assert.strictEqual(res.statusCode, 200, res.body);
    const stamp = await S.readShareStamp(db, T, SRC);
    assert.strictEqual(stamp.publicSetId, 'somebody-else', 'the condition on share.publicSetId did not apply');
    assert.strictEqual(stamp.status, 'published');
  });
  await H.test('a takedown needs a note, an unknown set is 404, and an org admin is refused', async () => {
    await seed({ versions: 1, questions: 2 });
    assert.strictEqual((await del({})).statusCode, 400);
    assert.strictEqual((await del({ note: 'x'.repeat(501) })).statusCode, 400);
    assert.strictEqual((await handler(H.platformEvent({ method: 'DELETE', body: { note: 'x' }, path: { publicSetId: 'nope' } }), H.ctx())).statusCode, 404);
    const org = await handler(H.orgEvent({ orgId: 'org_acme', role: 'owner', method: 'DELETE', body: { note: 'x' }, path: { publicSetId: PUB } }), H.ctx());
    assert.strictEqual(org.statusCode, 403);
  });
  H.summary();
})();
```

- [ ] **Step 2: Run it to see it fail**

Run: `node tests/takedown.js`
Expected: `Cannot find module '.../public-library-item.js'`.

- [ ] **Step 3: The stamp condition**

In `lambda-functions/admin/shared/share-stamp.js`, change the signature and the command:

```js
async function writeShareStamp(db, tableName, sourceRef, stamp, { now = new Date(), onlyIfPublicSetId = '' } = {}) {
  // …unchanged validation and `share` construction…
  // TAKEDOWN'S GUARD (D11): the stamp is flagged only if the org row still
  // points at the public set being taken down. An org that has since re-shared
  // as a different public set keeps its newer stamp; the takedown still runs.
  const guard = String(onlyIfPublicSetId || '').trim();
  try {
    await db.send(new UpdateCommand({
      TableName: tableName,
      Key: setMetadataKey(sourceRef),
      UpdateExpression: 'SET #share = :share',
      ExpressionAttributeNames: { '#share': 'share' },
      ExpressionAttributeValues: guard ? { ':share': share, ':pub': guard } : { ':share': share },
      ConditionExpression: guard ? 'attribute_exists(PK) AND #share.publicSetId = :pub' : 'attribute_exists(PK)',
    }));
  } catch (error) { /* unchanged: ConditionalCheckFailedException → return null */ }
  return share;
}
```

Run `node tests/share-stamp-and-quota.js` — it must stay green. Then check the harness: `grep -n "publicSetId\|\\." tests/helpers/moderation-harness.js` — if its condition evaluator handles only top-level names, extend it so `#share.publicSetId` resolves through the item's `share` map (a path split on `.` after substituting names), add to `tests/moderation-harness.js` one self-test that `attribute_exists(PK) AND #s.publicSetId = :p` is true and false against a seeded row, and keep `tests/moderation-harness.js` green.

- [ ] **Step 4: Write the handler**

```js
// lambda-functions/admin/public-library-item.js
/**
 * GET|DELETE /admin/public-library/{publicSetId} — a public set's standing,
 * and takedown (spec §5.2, §10.4, §10.5).
 *
 * GET is the score card's data: what the public row says about itself (source
 * org, versions, notice), the org's REVIEW facts for the version it came from,
 * and the review log. Reports (Stage 3) and access rows (Stage 5) join later.
 *
 * DELETE is takedown. It reads `source*` off the public row, deletes the whole
 * public partition in batches (unpublishSet), logs `taken-down` with the note
 * on the org set's log, and flags the org's share stamp ONLY IF it still names
 * this public set (D11). IT NEVER TOUCHES THE ORG'S REVIEW ROW — a Put there
 * would erase the org's own findings and hash; the author's editor reads the
 * note from the stamp and renders 06.
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');
const tenant = require('./shared/tenant');
const { setMetadataKey } = require('./shared/set-version');
const { unpublishSet } = require('./shared/publish-set');
const { readReview } = require('./shared/set-review');
const { readReviewLog, appendReviewEvent } = require('./shared/review-log');
const { writeShareStamp } = require('./shared/share-stamp');
const { queueSk, deleteQueueRow } = require('./shared/moderation-queue');

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = () => process.env.TABLE_NAME;
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Engage-Org', 'Access-Control-Allow-Methods': 'GET,DELETE,OPTIONS', 'Content-Type': 'application/json' };
const json = (statusCode, body) => ({ statusCode, headers: cors, body: JSON.stringify(body) });
const NOTE_MAX = 500;
const reviewerOf = (event) => String(event?.requestContext?.authorizer?.lambda?.username || event?.requestContext?.authorizer?.lambda?.userId || 'engage').trim();

const pubRefOf = (publicSetId) => ({ scope: 'public', orgId: '', setId: String(publicSetId || '').trim() });
const sourceOf = (meta) => ({ scope: 'org', orgId: String(meta.sourceOrgId || ''), setId: String(meta.sourceSetId || '') });

async function readPublicMeta(publicSetId) {
  const id = String(publicSetId || '').trim();
  if (!/^[A-Za-z0-9_-]+$/.test(id)) return null;
  const res = await db.send(new GetCommand({ TableName: TABLE(), Key: setMetadataKey(pubRefOf(id)) }));
  return res && res.Item ? res.Item : null;
}

async function standing(meta, publicSetId) {
  const source = sourceOf(meta);
  const version = Number(meta.sourceVersion) || 0;
  const review = source.orgId && source.setId && version ? await readReview(db, TABLE(), source, version) : { status: 'unreviewed' };
  const log = source.orgId && source.setId ? await readReviewLog(db, TABLE(), source) : [];
  const versions = Array.isArray(meta.versions) ? meta.versions : [];
  const latest = versions.find((v) => Number(v.version) === Number(meta.activeVersion)) || versions[versions.length - 1] || {};
  return {
    publicSetId,
    name: meta.name || '',
    description: meta.description || '',
    engagementType: meta.engagementType || '',
    sourceOrgId: source.orgId,
    sourceOrgName: meta.sourceOrgName || '',
    sourceSetId: source.setId,
    sourceVersion: version,
    publicVersion: Number(meta.activeVersion) || 0,
    questionCount: Number(meta.questionCount) || Number(latest.questionCount) || 0,
    contentHash: meta.contentHash || '',
    sensitivity: Array.isArray(meta.sensitivity) ? meta.sensitivity : [],
    promptDropped: meta.promptDropped === true,
    publishedAt: latest.createdAt || null,
    review: {
      status: review.status || 'unreviewed',
      reviewer: review.reviewer || '',
      decidedAt: review.decidedAt || null,
      note: review.note || '',
      notice: Array.isArray(review.notice) ? review.notice : [],
      findings: Array.isArray(review.findings) ? review.findings : [],
      checkedAt: review.checkedAt || null,
    },
    log,
  };
}

exports.handler = async (event) => {
  const method = event.requestContext?.http?.method || event.httpMethod;
  if (method === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (!tenant.canManageScope(event, tenant.PLATFORM, '')) {
    return json(403, { error: 'The public library is managed by Engage staff acting as Engage.' });
  }
  const publicSetId = String(event.pathParameters?.publicSetId || '').trim();
  try {
    const meta = await readPublicMeta(publicSetId);
    if (!meta) return json(404, { error: 'No such public set.' });

    if (method === 'GET') return json(200, await standing(meta, publicSetId));
    if (method !== 'DELETE') return json(405, { error: 'Method not allowed' });

    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'The request body is not JSON.' }); }
    const note = String(body.note || '').trim();
    if (!note) return json(400, { error: 'A takedown needs a note: the organisation reads it.' });
    if (note.length > NOTE_MAX) return json(400, { error: `The note is over ${NOTE_MAX} characters.` });

    const source = sourceOf(meta);
    const version = Number(meta.sourceVersion) || 0;
    const reviewer = reviewerOf(event);
    await unpublishSet(db, TABLE(), source, pubRefOf(publicSetId));
    if (source.orgId && source.setId) {
      await appendReviewEvent(db, TABLE(), source, 'taken-down', { version, publicSetId, note, reviewer });
      await writeShareStamp(db, TABLE(), source, { version, status: 'flagged', note }, { onlyIfPublicSetId: publicSetId });
      if (version) await deleteQueueRow(db, TABLE(), queueSk(source, version));
    }
    await deleteQueueRow(db, TABLE(), queueSk(pubRefOf(publicSetId), 0));
    return json(200, { takenDown: publicSetId });
  } catch (error) {
    console.error('❌ public-library item failed:', error);
    return json(500, { error: `Could not do that: ${error.message}` });
  }
};
```

`unpublishSet(db, table, source, pubRef)` also deletes the source's PUBLISHED rows and, in Stage 1, wrote an `unpublished` stamp on the org row — read it: if it writes a stamp itself, takedown's `flagged` stamp must come AFTER it (it does above), and the test's "stale stamp" case must still hold (an unconditional `unpublished` stamp inside `unpublishSet` would break D11 — if so, give `unpublishSet` an option `{ stamp: false }` and pass it here; report the change).

- [ ] **Step 5: Run the test and the neighbours**

Run: `node tests/takedown.js && node tests/share-stamp-and-quota.js | tail -1 && node tests/moderation-harness.js | tail -1 && node tests/publish-question-set.js | tail -1`
Expected: `4 passed, 0 failed`; neighbours unchanged.

- [ ] **Step 6: Commit**

```bash
git add lambda-functions/admin/public-library-item.js lambda-functions/admin/shared/share-stamp.js lambda-functions/admin/shared/publish-set.js tests/takedown.js tests/helpers/moderation-harness.js tests/moderation-harness.js
git commit -m "Takedown removes a public set in batches, tells the organisation why through its stamp, and leaves their own review record alone

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

(Add only the files that actually changed.)

---

### Task 6: The projections — `sourceOrgName`, `sensitivity` on the list

**Files:**
- Modify: `lambda-functions/admin/get-question-sets.js` (the per-set projection, beside `share`)
- Test: `tests/public-projection.js`

**Interfaces:**
- Each list row gains `sourceOrgName` (`''` unless the row is a public copy), `sourceOrgId`, `sensitivity` (`[]` default), `promptDropped` (boolean). The org library's "by Meridian Delivery" and the staff library's Unpublish read these.

- [ ] **Step 1: Write the failing test**

```js
// tests/public-projection.js
const path = require('path');
const assert = require('assert');
const H = require('./helpers/moderation-harness');
H.install();
const V = require(path.join(H.REPO, 'lambda-functions/admin/shared/set-version.js'));
const list = require(path.join(H.REPO, 'lambda-functions/admin/get-question-sets.js')).handler;
const parse = (res) => JSON.parse(res.body || '{}');
(async () => {
  console.log('\npublic rows carry their provenance\n');
  await H.test('a public copy lists with the organisation it came from and its notice', async () => {
    H.reset();
    H.seedRow({ ...V.setMetadataKey({ scope: 'public', orgId: '', setId: 'orgacme-safety' }), name: 'Safety walkthrough', engagementType: 'trivia', activeVersion: 1, versions: [{ version: 1, questionCount: 30 }], questionCount: 30, sourceOrgId: 'org_acme', sourceOrgName: 'Acme', sourceSetId: 'safety', sourceVersion: 2, sensitivity: ['graphic-medical'], promptDropped: true });
    const res = await list(H.orgEvent({ orgId: 'org_beta', role: 'member', method: 'GET', path: {} }), H.ctx());
    assert.strictEqual(res.statusCode, 200, res.body);
    const row = parse(res).questionSets.find((s) => s.id === 'orgacme-safety');
    assert.ok(row, 'the public row is listed for another org');
    assert.strictEqual(row.scope, 'public');
    assert.strictEqual(row.sourceOrgName, 'Acme');
    assert.strictEqual(row.sourceOrgId, 'org_acme');
    assert.deepStrictEqual(row.sensitivity, ['graphic-medical']);
    assert.strictEqual(row.promptDropped, true);
    assert.strictEqual(row.canManage, false, 'nobody edits a public copy in place');
  });
  await H.test('an org set without provenance projects the defaults', async () => {
    H.reset();
    const C = require(path.join(H.REPO, 'lambda-functions/admin/shared/tenant-crypto.js'));
    H.seedRow(await C.encryptItem('org_beta', 'set', { ...V.setMetadataKey({ scope: 'org', orgId: 'org_beta', setId: 'own' }), name: 'Own', engagementType: 'trivia', scope: 'org', orgId: 'org_beta', activeVersion: 1, versions: [{ version: 1 }] }));
    const res = await list(H.orgEvent({ orgId: 'org_beta', role: 'member', method: 'GET', path: {} }), H.ctx());
    const row = parse(res).questionSets.find((s) => s.id === 'own');
    assert.strictEqual(row.sourceOrgName, '');
    assert.deepStrictEqual(row.sensitivity, []);
    assert.strictEqual(row.promptDropped, false);
  });
  H.summary();
})();
```

- [ ] **Step 2: Run it to see it fail**

Run: `node tests/public-projection.js`
Expected: the first test FAILS (`sourceOrgName` undefined).

- [ ] **Step 3: Extend the projection**

In `get-question-sets.js`, beside `share: …`, add:

```js
      // PROVENANCE OF A PUBLIC COPY (publish-set.js writes these on the public
      // row): the library says "by <organisation>", and the staff library's
      // takedown names the source. Empty on every other row.
      sourceOrgName: typeof item.sourceOrgName === 'string' ? item.sourceOrgName : '',
      sourceOrgId: typeof item.sourceOrgId === 'string' ? item.sourceOrgId : '',
      // THE CONTENT NOTICE (spec §7): set by a reviewer on approve; its vocabulary
      // and the chips arrive with Stage 4, the ids travel now.
      sensitivity: Array.isArray(item.sensitivity) ? item.sensitivity : [],
      promptDropped: item.promptDropped === true,
```

- [ ] **Step 4: Run the test and the neighbours**

Run: `node tests/public-projection.js && node tests/share-projection.js | tail -1 && node tests/question-set-ownership.js | tail -1`
Expected: `2 passed, 0 failed`; neighbours unchanged.

- [ ] **Step 5: Commit**

```bash
git add lambda-functions/admin/get-question-sets.js tests/public-projection.js
git commit -m "A public row lists with the organisation it came from and the notice it carries

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: The authorizer and the template — four staff routes

**Files:**
- Modify: `lambda-functions/auth/authorizer.js` (beside `PLATFORM_ROUTE`), `template-clean.yaml` (four functions after `AppealQuestionSetFunction`)
- Test: `tests/authorizer-staff-routes.js` (new), `tests/question-set-routes-authorization.js` (extend `MUST_BE_CLOSED`), `tests/template-validates.js`, `tests/kms-grants-match-code.js`, `tests/cors-allows-sent-headers.js`, `sam validate --lint`

**Interfaces:** `requiredGroupsForRoute(method, path)` returns `['admins']` for `admin/moderation`, `admin/moderation/{sk}`, `admin/moderation/decide`, `admin/public-library/{publicSetId}` — by template string and by anchored regex over a concrete path whose segments contain `join`, `answer`, `vote`, `games` or a percent-encoded `#`.

- [ ] **Step 1: Write the failing test**

```js
// tests/authorizer-staff-routes.js
/**
 * THE STAFF ROUTES ARE NAMED, NOT PREFIXED — spec §9.
 * `admin/moderation/{sk}` carries a set id inside its last segment (percent-
 * encoded `org_x%23callandanswer%23v2`), so a generic includes('answer') rule
 * would decide it before an unnamed route could. Every route here must return
 * ['admins'] by template AND by regex over such a path.
 */
const path = require('path');
const assert = require('assert');
const { requiredGroupsForRoute } = require(path.join(__dirname, '..', 'lambda-functions/auth/authorizer.js'));
let pass = 0; let fail = 0;
const check = (name, fn) => { try { fn(); console.log(`  PASS  ${name}`); pass += 1; } catch (e) { console.log(`  FAIL  ${name}\n        ${e.message}`); fail += 1; } };
console.log('\nauthorizer: the staff routes\n');
const CASES = [
  ['GET', 'admin/moderation', ['admin/moderation']],
  ['GET', 'admin/moderation/{sk}', ['admin/moderation/org_x%23callandanswer%23v2', 'admin/moderation/PUBLIC%23partygames', 'admin/moderation/org_x%23joinery%23v1']],
  ['POST', 'admin/moderation/decide', ['admin/moderation/decide']],
  ['GET', 'admin/public-library/{publicSetId}', ['admin/public-library/orgx-callandanswer', 'admin/public-library/orgx-votes']],
  ['DELETE', 'admin/public-library/{publicSetId}', ['admin/public-library/orgx-partygames']],
];
for (const [method, template, concretes] of CASES) {
  check(`${method} ${template} is staff-only by template`, () => assert.deepStrictEqual(requiredGroupsForRoute(method, template), ['admins']));
  for (const p of concretes) {
    check(`${method} ${p} is staff-only despite the id`, () => assert.deepStrictEqual(requiredGroupsForRoute(method, p), ['admins'], 'fell through to a generic rule'));
  }
}
check('a hosts-only caller is not enough for the queue', () => assert.ok(!requiredGroupsForRoute('GET', 'admin/moderation').includes('hosts')));
console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail) process.exit(1);
```

Add to `tests/question-set-routes-authorization.js`'s `MUST_BE_CLOSED`:

```js
  ['GET', '/admin/moderation'],
  ['GET', '/admin/moderation/{sk}'],
  ['POST', '/admin/moderation/decide'],
  ['GET', '/admin/public-library/{publicSetId}'],
  ['DELETE', '/admin/public-library/{publicSetId}'],
```

- [ ] **Step 2: Run them to see them fail**

Run: `node tests/authorizer-staff-routes.js | grep -E 'FAIL|passed'; node tests/question-set-routes-authorization.js | grep -E 'FAIL|passed'`
Expected: the concrete-path cases FAIL (they fall through); the parity suite fails on "not in the template at all" for the four routes.

- [ ] **Step 3: The authorizer**

Directly after the `PLATFORM_ROUTE` block in `requiredGroupsForRoute`:

```js
  // ── MODERATION AND THE PUBLIC LIBRARY (spec §9) ──────────────────────────
  //
  // Engage staff only, and the handler re-asks `canManageScope(event,
  // PLATFORM, '')` — platform MODE, not just the group. Anchored: the queue's
  // {sk} segment carries a set id (percent-encoded `org%23callandanswer%23v2`),
  // exactly the kind of path the generic includes() rules below would decide.
  const STAFF_ROUTE = /^admin\/(moderation(\/[^/]+)?|public-library\/[^/]+)$/;
  if (path === 'admin/moderation'
    || path === 'admin/moderation/{sk}'
    || path === 'admin/moderation/decide'
    || path === 'admin/public-library/{publicSetId}'
    || STAFF_ROUTE.test(path)) {
    return ['admins'];
  }
```

- [ ] **Step 4: The template**

After `AppealQuestionSetFunction`, four functions in this shape (copy the CORS/Auth lines from `AppealQuestionSetFunction`):

```yaml
  ModerationListFunction:
    Type: AWS::Serverless::Function
    Properties:
      FunctionName: !Sub '${StackName}-moderation-list'
      CodeUri: lambda-functions/admin/
      Runtime: nodejs22.x
      Timeout: 30
      Handler: moderation-list.handler
      Environment:
        Variables:
          TABLE_NAME: !Ref GameTable
      Policies:
        - DynamoDBReadPolicy:
            TableName: !Ref GameTable
      Events:
        ModerationList:
          Type: HttpApi
          Properties:
            ApiId: !Ref RestApi
            Path: /admin/moderation
            Method: GET
            Auth:
              Authorizer: CognitoAuthorizer
      Tags:
        Environment: !Ref Environment
        StackName: !Ref StackName

  ModerationGetFunction:
    Type: AWS::Serverless::Function
    Properties:
      FunctionName: !Sub '${StackName}-moderation-get'
      CodeUri: lambda-functions/admin/
      Runtime: nodejs22.x
      Timeout: 30
      Handler: moderation-get.handler
      Environment:
        Variables:
          TABLE_NAME: !Ref GameTable
          AI_PROMPTS_BUCKET: !Ref AIPromptsBucket
      Policies:
        - DynamoDBReadPolicy:
            TableName: !Ref GameTable
        # The snapshot a person reviews (spec §3.3) — read only.
        - S3ReadPolicy:
            BucketName: !Ref AIPromptsBucket
      Events:
        ModerationGet:
          Type: HttpApi
          Properties:
            ApiId: !Ref RestApi
            Path: /admin/moderation/{sk}
            Method: GET
            Auth:
              Authorizer: CognitoAuthorizer
      Tags:
        Environment: !Ref Environment
        StackName: !Ref StackName

  ModerationDecideFunction:
    Type: AWS::Serverless::Function
    Properties:
      FunctionName: !Sub '${StackName}-moderation-decide'
      CodeUri: lambda-functions/admin/
      Runtime: nodejs22.x
      Timeout: 60
      Handler: moderation-decide.handler
      Environment:
        Variables:
          TABLE_NAME: !Ref GameTable
          AI_PROMPTS_BUCKET: !Ref AIPromptsBucket
      Policies:
        - DynamoDBCrudPolicy:
            TableName: !Ref GameTable
        # Approve reads the snapshot to publish it; reject deletes it (D9).
        - S3CrudPolicy:
            BucketName: !Ref AIPromptsBucket
      Events:
        ModerationDecide:
          Type: HttpApi
          Properties:
            ApiId: !Ref RestApi
            Path: /admin/moderation/decide
            Method: POST
            Auth:
              Authorizer: CognitoAuthorizer
      Tags:
        Environment: !Ref Environment
        StackName: !Ref StackName

  PublicLibraryItemFunction:
    Type: AWS::Serverless::Function
    Properties:
      FunctionName: !Sub '${StackName}-public-library-item'
      CodeUri: lambda-functions/admin/
      Runtime: nodejs22.x
      Timeout: 60
      Handler: public-library-item.handler
      Environment:
        Variables:
          TABLE_NAME: !Ref GameTable
      Policies:
        - DynamoDBCrudPolicy:
            TableName: !Ref GameTable
      Events:
        PublicLibraryItemGet:
          Type: HttpApi
          Properties:
            ApiId: !Ref RestApi
            Path: /admin/public-library/{publicSetId}
            Method: GET
            Auth:
              Authorizer: CognitoAuthorizer
        PublicLibraryItemDelete:
          Type: HttpApi
          Properties:
            ApiId: !Ref RestApi
            Path: /admin/public-library/{publicSetId}
            Method: DELETE
            Auth:
              Authorizer: CognitoAuthorizer
      Tags:
        Environment: !Ref Environment
        StackName: !Ref StackName
```

`admin/moderation/decide` and `admin/moderation/{sk}` are distinct HTTP API routes (a literal segment wins over a parameter); both are named above. If `tests/kms-grants-match-code.js` names any of the four (a require chain reaching `tenant-crypto`), add the `kms:Decrypt` statement on `!GetAtt TenantKey.Arn` exactly as `AppealQuestionSetFunction` carries it — that test is the order to do things in.

- [ ] **Step 5: Run everything**

```bash
node tests/authorizer-staff-routes.js | tail -1 && node tests/authorizer-set-routes.js | tail -1 && node tests/authorizer-org-context.js | tail -1 && node tests/question-set-routes-authorization.js | tail -1 && node tests/template-validates.js | tail -1 && node tests/kms-grants-match-code.js | tail -1 && node tests/cors-allows-sent-headers.js | tail -1 && rm -rf .aws-sam && sam validate --template template-clean.yaml --region us-east-1 --lint 2>&1 | tail -1
```
Expected: all pass; the template is valid.

- [ ] **Step 6: Commit**

```bash
git add lambda-functions/auth/authorizer.js template-clean.yaml tests/authorizer-staff-routes.js tests/question-set-routes-authorization.js
git commit -m "The queue, the decision and the public library are staff routes in both halves: named in the authorizer, closed in the template

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: `utils/moderationRow.js` — the queue's words

**Files:**
- Create: `src/src/utils/moderationRow.js`
- Test: `src/src/__tests__/moderationRow.test.js`

**Interfaces:**
- `whyLabel(item) → string` from `reasons`, `uncertainQuestionIds`, `bands`, `appealMessage`, `reports`, `declaredNotice` — band words, never scores (spec §10.5).
- `waitedLabel(sinceIso, nowMs = Date.now()) → 'just now' | 'N minutes' | 'N hours' | 'N days'`.
- `queueHeadline(count, oldestSinceIso, nowMs) → string` — *"N sets the check would not decide on its own. Oldest has waited D days."*; `''` when the count is 0 (the panel shows the empty state instead).

- [ ] **Step 1: Write the failing test**

```js
// src/src/__tests__/moderationRow.test.js
import { whyLabel, waitedLabel, queueHeadline } from '../utils/moderationRow';

const NOW = Date.parse('2026-09-17T12:00:00.000Z');

describe('whyLabel — band words, never scores', () => {
  test('an escalation names how many questions the check could not decide', () => {
    expect(whyLabel({ reasons: ['escalated'], uncertainQuestionIds: ['c001#014', 'c002#022'], bands: { MEDIUM: 2 } })).toBe('2 uncertain questions');
    expect(whyLabel({ reasons: ['escalated'], uncertainQuestionIds: ['c001#014'] })).toBe('1 uncertain question');
    expect(whyLabel({ reasons: ['escalated'], bands: { MEDIUM: 3 } })).toBe('Uncertain (medium ×3)');
  });
  test('an appeal quotes the author, shortened', () => {
    expect(whyLabel({ reasons: ['appealed'], appealMessage: 'It is a clinical safety set.' })).toBe('Appealed: “It is a clinical safety set.”');
    expect(whyLabel({ reasons: ['appealed'], appealMessage: 'x'.repeat(120) })).toBe(`Appealed: “${'x'.repeat(79)}…”`);
    expect(whyLabel({ reasons: ['appealed'] })).toBe('Appealed');
  });
  test('reports, a declared notice and images each say so; several reasons join', () => {
    expect(whyLabel({ reasons: ['reported'], reports: { count: 3, byType: { graphic: 2, inaccurate: 1 } } })).toBe('Reported ×3 · graphic (2), inaccurate (1)');
    expect(whyLabel({ reasons: ['declared'], declaredNotice: 'graphic-medical' })).toBe('Declared: graphic medical');
    expect(whyLabel({ reasons: ['images'] })).toBe('Images');
    expect(whyLabel({ reasons: ['escalated', 'appealed'], uncertainQuestionIds: ['a'], appealMessage: 'Please.' })).toBe('1 uncertain question · Appealed: “Please.”');
    expect(whyLabel({})).toBe('Waiting');
  });
});

describe('waitedLabel and the headline', () => {
  test('rounds to the unit a person would say', () => {
    expect(waitedLabel('2026-09-17T11:59:30.000Z', NOW)).toBe('just now');
    expect(waitedLabel('2026-09-17T11:15:00.000Z', NOW)).toBe('45 minutes');
    expect(waitedLabel('2026-09-17T07:00:00.000Z', NOW)).toBe('5 hours');
    expect(waitedLabel('2026-09-15T10:00:00.000Z', NOW)).toBe('2 days');
    expect(waitedLabel(null, NOW)).toBe('');
  });
  test('the headline is the mockup sentence', () => {
    expect(queueHeadline(5, '2026-09-15T10:00:00.000Z', NOW)).toBe('5 sets the check would not decide on its own. Oldest has waited 2 days.');
    expect(queueHeadline(1, '2026-09-17T11:59:30.000Z', NOW)).toBe('1 set the check would not decide on its own. Oldest has waited just now.');
    expect(queueHeadline(0, null, NOW)).toBe('');
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd src && CI=true npx jest __tests__/moderationRow.test.js 2>&1 | tail -4; cd ..`
Expected: `Cannot find module`.

- [ ] **Step 3: Write the module**

```js
// src/src/utils/moderationRow.js
/**
 * THE QUEUE'S WORDS. A pointer row (shared/moderation-queue.js) says why a set
 * is waiting; this turns it into the one line the table shows — band words,
 * never scores (spec §10.5). Content-notice labels are Stage 4's vocabulary;
 * until then an id reads as its words ("graphic-medical" → "graphic medical").
 */
const APPEAL_MAX = 80;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const humanise = (id) => String(id || '').replace(/[-_]+/g, ' ').trim();

function escalationWords(item) {
  const ids = Array.isArray(item.uncertainQuestionIds) ? item.uncertainQuestionIds : [];
  if (ids.length) return `${plural(ids.length, 'uncertain question')}`;
  const bands = item.bands && typeof item.bands === 'object' ? item.bands : {};
  const parts = ['HIGH', 'MEDIUM', 'LOW'].filter((b) => Number(bands[b]) > 0).map((b) => `${b.toLowerCase()} ×${Number(bands[b])}`);
  return parts.length ? `Uncertain (${parts.join(', ')})` : 'Uncertain';
}

function appealWords(item) {
  const msg = String(item.appealMessage || '').trim();
  if (!msg) return 'Appealed';
  const shown = msg.length > APPEAL_MAX ? `${msg.slice(0, APPEAL_MAX - 1)}…` : msg;
  return `Appealed: “${shown}”`;
}

function reportWords(item) {
  const r = item.reports && typeof item.reports === 'object' ? item.reports : {};
  const count = Number(r.count) || 0;
  const byType = r.byType && typeof r.byType === 'object' ? r.byType : {};
  const types = Object.entries(byType).filter(([, n]) => Number(n) > 0).sort((a, b) => Number(b[1]) - Number(a[1])).map(([t, n]) => `${t} (${Number(n)})`);
  return `Reported${count ? ` ×${count}` : ''}${types.length ? ` · ${types.join(', ')}` : ''}`;
}

export function whyLabel(item = {}) {
  const reasons = Array.isArray(item.reasons) ? item.reasons : [];
  const parts = [];
  if (reasons.includes('escalated')) parts.push(escalationWords(item));
  if (reasons.includes('appealed')) parts.push(appealWords(item));
  if (reasons.includes('reported')) parts.push(reportWords(item));
  if (reasons.includes('declared')) parts.push(`Declared: ${humanise(item.declaredNotice) || 'a content notice'}`);
  if (reasons.includes('images')) parts.push('Images');
  return parts.length ? parts.join(' · ') : 'Waiting';
}

export function waitedLabel(sinceIso, nowMs = Date.now()) {
  if (!sinceIso) return '';
  const ms = nowMs - Date.parse(sinceIso);
  if (!Number.isFinite(ms) || ms < 60 * 1000) return 'just now';
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return plural(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (hours < 24) return plural(hours, 'hour');
  return plural(Math.round(hours / 24), 'day');
}

export function queueHeadline(count, oldestSinceIso, nowMs = Date.now()) {
  const n = Number(count) || 0;
  if (!n) return '';
  return `${plural(n, 'set')} the check would not decide on its own. Oldest has waited ${waitedLabel(oldestSinceIso, nowMs) || 'just now'}.`;
}
```

- [ ] **Step 4: Run the test**

Run: `cd src && CI=true npx jest __tests__/moderationRow.test.js 2>&1 | tail -4; cd ..`
Expected: `8 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/src/utils/moderationRow.js src/src/__tests__/moderationRow.test.js
git commit -m "The queue's words: why a set waits, in band words, and how long

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: `ModerationPanel` — `11` — the queue and the review

**Files:**
- Create: `src/src/components/ModerationPanel.jsx`, `src/src/components/ModerationPanel.css`
- Test: `src/src/__tests__/moderationPanel.test.jsx`, `src/src/__tests__/modqPalette.test.js`; register `['ModerationPanel', 'modq']` in `src/src/__tests__/scopedClassesDeclared.test.js`

**Interfaces:**
- Props: `onOpenScoreCard(publicSetId)` (optional — Stage 2's card is for published sets, so a queue row offers it only when the pointer carries `publicSetId`).
- Network: `GET adminApiUrl('admin/moderation')` on mount and after every decision; `GET adminApiUrl('admin/moderation/<encoded sk>')` when Review opens; `POST adminApiUrl('admin/moderation/decide')` with `{ sk, decision, note }`.
- Copy: the head sentence from `queueHeadline`; the disclosure note *"The check escalates rather than guessing. These are the ones it flagged as uncertain, not the ones it rejected."*; the empty state *"Nothing is waiting — the check decided everything on its own."*; the review modal's title is the set's name; decisions **Approve** and **Reject**, both disabled while a request is in flight; a 409 renders its `error` (*"Already decided by dai."*) and refreshes the list. "Approve with a content notice" is Stage 4 — the seam is a comment beside Approve.
- The review modal is a full-height `Modal` (`overlayClassName="modq modq-scrim"`, `contentClassName="modq-card modq-card--tall"`), X and a bottom exit through one `requestClose`, `closeOnEscape={() => !busy}`.

- [ ] **Step 1: Write the failing tests**

```jsx
// src/src/__tests__/moderationPanel.test.jsx
import React from 'react';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
jest.mock('../auth/authFetch', () => ({ __esModule: true, authFetch: (...args) => global.fetch(...args) }));
import ModerationPanel from '../components/ModerationPanel';

const NOW = Date.parse('2026-09-17T12:00:00.000Z');
const QUEUE = { count: 2, oldestWaitingSince: '2026-09-15T10:00:00.000Z', items: [
  { sk: 'org_acme#safety#v2', orgName: 'Acme', setId: 'safety', title: 'Safety walkthrough', version: 2, gameType: 'trivia', questionCount: 30, reasons: ['escalated'], uncertainQuestionIds: ['c001#014', 'c002#022'], waitingSince: '2026-09-15T10:00:00.000Z' },
  { sk: 'org_beta#onboarding#v1', orgName: 'Beta', setId: 'onboarding', title: 'Onboarding', version: 1, gameType: 'poll', questionCount: 12, reasons: ['appealed'], appealMessage: 'It is a clinical set.', waitingSince: '2026-09-17T09:00:00.000Z' },
] };
const ITEM = { pointer: QUEUE.items[0], review: { status: 'escalated', findings: [], reasons: ['guardrail'], checkedAt: '2026-09-17T10:00:00.000Z', note: '' }, setFindings: [], log: [], snapshot: {
  meta: { name: 'Safety walkthrough', description: 'Site safety', engagementType: 'trivia' },
  categories: [{ id: 'c001', name: 'Injuries' }],
  questions: [
    { questionId: 'c001#014', category: 'Injuries', title: 'Describe the injury', text: 'Describe the injury. In detail.', findings: [{ questionId: 'c001#014', category: 'VIOLENCE', band: 'MEDIUM', explanation: 'Asking for injuries in detail is what was flagged, not the safety topic.' }] },
    { questionId: 'c001#001', category: 'Injuries', title: 'A clean one', text: 'Which glove?', findings: [] },
  ],
} };
const json = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
let decided;
beforeEach(() => {
  window.API_BASE = 'https://api.test/';
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  decided = [];
  global.fetch = jest.fn(async (url, options = {}) => {
    const u = String(url); const method = (options.method || 'GET').toUpperCase();
    if (method === 'POST' && u.endsWith('/admin/moderation/decide')) { decided.push(JSON.parse(options.body)); return json({ decision: 'approve', publicSetId: 'orgacme-safety', publicVersion: 1 }); }
    if (u.endsWith('/admin/moderation')) return json(decided.length ? { count: 1, oldestWaitingSince: QUEUE.items[1].waitingSince, items: [QUEUE.items[1]] } : QUEUE);
    if (u.includes('/admin/moderation/')) return json(ITEM);
    return json({});
  });
});
afterEach(() => { Date.now.mockRestore(); });

test('the head says how many and how long, and each row says why in band words', async () => {
  render(<ModerationPanel />);
  expect(await screen.findByText('2 sets the check would not decide on its own. Oldest has waited 2 days.')).toBeInTheDocument();
  const row = screen.getByText('Safety walkthrough').closest('tr');
  expect(within(row).getByText('Acme')).toBeInTheDocument();
  expect(within(row).getByText('2 uncertain questions')).toBeInTheDocument();
  expect(within(row).getByText('2 days')).toBeInTheDocument();
  expect(within(screen.getByText('Onboarding').closest('tr')).getByText('Appealed: “It is a clinical set.”')).toBeInTheDocument();
  expect(screen.getByText(/these are the ones it flagged as uncertain/i)).toBeInTheDocument();
});
test('an empty queue says the check decided everything, and never lies about an outage', async () => {
  global.fetch = jest.fn(async () => json({ count: 0, oldestWaitingSince: null, items: [] }));
  render(<ModerationPanel />);
  expect(await screen.findByText(/nothing is waiting — the check decided everything on its own/i)).toBeInTheDocument();
  global.fetch = jest.fn(async () => json({ error: 'boom' }, 500));
  render(<ModerationPanel />);
  expect(await screen.findByRole('alert')).toHaveTextContent(/could not read the queue/i);
});
test('Review opens the snapshot with the uncertain question first, and Approve decides and refreshes', async () => {
  render(<ModerationPanel />);
  const row = (await screen.findByText('Safety walkthrough')).closest('tr');
  fireEvent.click(within(row).getByRole('button', { name: /^review$/i }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByRole('heading', { name: /safety walkthrough/i })).toBeInTheDocument();
  const items = within(dialog).getAllByTestId('modq-question');
  expect(items[0]).toHaveTextContent('Describe the injury');
  expect(items[0]).toHaveTextContent(/medium/i);
  expect(items[0]).toHaveTextContent(/injuries in detail/i);
  expect(items[1]).toHaveTextContent('A clean one');
  fireEvent.change(within(dialog).getByRole('textbox', { name: /note/i }), { target: { value: 'Clinical, not gratuitous.' } });
  fireEvent.click(within(dialog).getByRole('button', { name: /^approve$/i }));
  await waitFor(() => expect(decided).toEqual([{ sk: 'org_acme#safety#v2', decision: 'approve', note: 'Clinical, not gratuitous.' }]));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(await screen.findByText('1 set the check would not decide on its own. Oldest has waited 3 hours.')).toBeInTheDocument();
});
test('a lost race says who decided and refreshes; the dialog has an X and a bottom exit', async () => {
  global.fetch = jest.fn(async (url, options = {}) => {
    const u = String(url); const method = (options.method || 'GET').toUpperCase();
    if (method === 'POST') return json({ error: 'Already decided by dai.', status: 'passed' }, 409);
    if (u.endsWith('/admin/moderation')) return json(QUEUE);
    if (u.includes('/admin/moderation/')) return json(ITEM);
    return json({});
  });
  render(<ModerationPanel />);
  const row = (await screen.findByText('Safety walkthrough')).closest('tr');
  fireEvent.click(within(row).getByRole('button', { name: /^review$/i }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: /^reject$/i }));
  expect(await within(dialog).findByText(/already decided by dai/i)).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole('button', { name: /^close$/i }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});
```

```js
// src/src/__tests__/modqPalette.test.js
/* The moderation screen's paint stack, composited and asserted ≥ AA — the same
   text-parsing harness as sharePalette.test.js. Dusk only: the platform console
   sets contentTheme 'dark' for this section. */
const fs = require('fs');
const path = require('path');
const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const GLOBAL_CSS = read('styles.css');
const CSS = read('components', 'ModerationPanel.css');
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
const DUSK = '[data-theme="dark"] {'; const ROOT = ':root {';
const T = { bg: token(GLOBAL_CSS, DUSK, '--bg'), surface: token(GLOBAL_CSS, DUSK, '--surface'), text: token(GLOBAL_CSS, DUSK, '--text'), muted: token(GLOBAL_CSS, DUSK, '--muted'), primary: token(GLOBAL_CSS, ROOT, '--primary'), secondary: token(GLOBAL_CSS, ROOT, '--secondary'), dangerText: token(GLOBAL_CSS, ROOT, '--danger-text'), success: token(CSS, '.modq {', '--modq-success-text') };
const tintAlpha = Number((CSS.match(/--modq-tint-alpha:\s*([\d.]+)/) || [])[1]);
const AA = 4.5;
describe('ModerationPanel palette', () => {
  test.each([
    ['--text on --bg', T.text, T.bg], ['--muted on --bg', T.muted, T.bg], ['--primary on --bg', T.primary, T.bg], ['--secondary on --bg', T.secondary, T.bg],
    ['--text on --surface', T.text, T.surface], ['--muted on --surface', T.muted, T.surface], ['--danger-text on --surface', T.dangerText, T.surface],
    ['--modq-success-text on --surface', T.success, T.surface], ['--bg on --primary (filled Approve)', T.bg, T.primary],
  ])('%s clears AA', (_l, fg, bg) => expect(ratio(hex(fg), hex(bg))).toBeGreaterThanOrEqual(AA));
  test('the uncertain-question tint keeps --text and --muted at AA', () => {
    expect(tintAlpha).toBeGreaterThan(0);
    const tinted = over(hex(T.primary), hex(T.surface), tintAlpha);
    expect(ratio(hex(T.text), tinted)).toBeGreaterThanOrEqual(AA);
    expect(ratio(hex(T.muted), tinted)).toBeGreaterThanOrEqual(AA);
  });
  test('every selector is rooted at .modq, no hex outside the token block, no --danger as text, nothing under 12px, rows 36px', () => {
    const stripped = CSS.replace(/\/\*[\s\S]*?\*\//g, ' ');
    const tokenBlock = stripped.slice(stripped.indexOf('.modq {'), stripped.indexOf('}', stripped.indexOf('.modq {')));
    expect((stripped.replace(tokenBlock, '').match(/#[0-9A-Fa-f]{3,6}\b/g) || [])).toEqual([]);
    expect(stripped).not.toMatch(/color:\s*var\(--danger\)/);
    for (const m of stripped.matchAll(/(\d+(?:\.\d+)?)px/g)) { if (/font-size/.test(stripped.slice(Math.max(0, m.index - 40), m.index))) expect(Number(m[1])).toBeGreaterThanOrEqual(12); }
    for (const sel of stripped.matchAll(/(^|\})\s*([^{@}]+)\{/g)) for (const part of sel[2].split(',')) expect(part.trim()).toMatch(/^\.modq(\b|-)/);
    expect(stripped).toMatch(/--modq-row-h:\s*36px/);
    expect(stripped).toMatch(/table-layout:\s*fixed/);
    expect(GLOBAL_CSS).not.toMatch(/\.modq(\b|-)/);
  });
});
```

Add `['ModerationPanel', 'modq'],` to `SURFACES` in `scopedClassesDeclared.test.js`.

- [ ] **Step 2: Run them to see them fail**

Run: `cd src && CI=true npx jest __tests__/moderationPanel.test.jsx __tests__/modqPalette.test.js __tests__/scopedClassesDeclared.test.js 2>&1 | grep -E '✕|Tests:'; cd ..`
Expected: all three fail (`Cannot find module` / missing stylesheet).

- [ ] **Step 3: Write the component and its stylesheet**

```jsx
// src/src/components/ModerationPanel.jsx
import React, { useCallback, useEffect, useState } from 'react';
import Icon from './Icon';
import Modal from './Modal';
import StatusMessage from './StatusMessage';
import { authFetch } from '../auth/authFetch';
import { adminApiUrl } from '../utils/adminApi';
import { gameTypeLabel } from '../config/gameTypes';
import { whyLabel, waitedLabel, queueHeadline } from '../utils/moderationRow';
import './ModerationPanel.css';

/**
 * MODERATION — docs/design/tenancy-redesign/11-moderation.html.
 *
 * The queue is the pointer partition (spec §3.2): a row per set the check
 * would not decide on its own, oldest first. Review opens the snapshot in a
 * full-height Modal with the uncertain questions first — the reviewer's job is
 * the handful the check could not decide, not a re-read of the set — and the
 * two decisions of Stage 2, Approve and Reject. "Approve with a content notice"
 * arrives with the notice vocabulary (Stage 4, spec §7); dismiss / take down /
 * keep-with-a-notice arrive with reports (Stage 3, spec §6.2).
 *
 * Two reviewers cannot both decide: the server's transition is conditional,
 * and a lost race reads "Already decided by <name>" here and refreshes.
 */
const BAND_WORD = { HIGH: 'flagged', MEDIUM: 'uncertain', LOW: 'low', NONE: '' };
const bandWord = (band) => BAND_WORD[String(band || '').toUpperCase()] || String(band || '').toLowerCase();
const skUrl = (sk) => adminApiUrl(`admin/moderation/${encodeURIComponent(sk)}`);

function ReviewDialog({ sk, onClose, onDecided }) {
  const [state, setState] = useState('loading');   // loading | ready | error
  const [item, setItem] = useState(null);
  const [error, setError] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [verdict, setVerdict] = useState(null);      // the 409 sentence
  const requestClose = () => { if (!busy) onClose(); };

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await authFetch(skUrl(sk));
        const body = await res.json().catch(() => ({}));
        if (!live) return;
        if (!res.ok) { setError(body.error || `Could not open that entry (${res.status}).`); setState('error'); return; }
        setItem(body); setState('ready');
      } catch (e) { if (live) { setError(`Could not open that entry: ${e.message}`); setState('error'); } }
    })();
    return () => { live = false; };
  }, [sk]);

  const decide = async (decision) => {
    setBusy(true); setVerdict(null); setError(null);
    try {
      const res = await authFetch(adminApiUrl('admin/moderation/decide'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sk, decision, note: note.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409) { setVerdict(body.error || 'Already decided.'); onDecided({ refreshOnly: true }); return; }
      if (!res.ok) { setError(body.error || `The decision was not recorded (${res.status}).`); return; }
      onDecided(body);
    } catch (e) {
      setError(`The decision was not recorded: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const title = (item && item.snapshot && item.snapshot.meta.name) || (item && item.pointer && item.pointer.title) || 'Review';
  const questions = (item && item.snapshot && item.snapshot.questions) || [];
  const uncertain = questions.filter((q) => q.findings.length).length;
  return (
    <Modal overlayClassName="modq modq-scrim" contentClassName="modq-card modq-card--tall" labelledBy="modq-title" onClose={requestClose} closeOnBackdrop={false} closeOnEscape={() => !busy}>
      <header className="modq-head">
        <h2 id="modq-title">{title}</h2>
        <button type="button" className="modq-x" onClick={requestClose} aria-label="Close" title="Close" disabled={busy}>×</button>
      </header>
      <div className="modq-body">
        {state === 'loading' && <p className="modq-fine">Opening…</p>}
        {state === 'error' && <StatusMessage message={error} tone="error" className="modq-alert" />}
        {state === 'ready' && item && (
          <>
            <p className="modq-sub">
              {item.pointer.orgName} · {gameTypeLabel(item.snapshot ? item.snapshot.meta.engagementType : item.pointer.gameType)} · {questions.length || item.pointer.questionCount || 0} questions · v{item.pointer.version} · {whyLabel(item.pointer)}
            </p>
            {!item.snapshot && (
              <StatusMessage message="The snapshot is gone, so there is nothing to approve — ask the organisation to submit it again. Reject still records a note." tone="error" className="modq-alert" />
            )}
            {item.setFindings.length > 0 && (
              <p className="modq-note"><strong>The set's own text:</strong> {item.setFindings.map((f) => `${bandWord(f.band)} for ${String(f.category || '').toLowerCase()}`).join('; ')}.</p>
            )}
            <h3 className="modq-h">{uncertain ? `${uncertain} the check could not decide` : 'Every question'}</h3>
            <ul className="modq-list">
              {questions.map((q) => (
                <li key={q.questionId} className={`modq-q${q.findings.length ? ' modq-q--uncertain' : ''}`} data-testid="modq-question">
                  <div className="modq-q-head">
                    <strong>{q.title || q.questionId}</strong>
                    <span className="modq-chip">{q.category}</span>
                    {q.findings.map((f, i) => (
                      <span key={i} className={`modq-chip modq-chip--${bandWord(f.band) || 'none'}`}>{bandWord(f.band)} · {String(f.category || '').toLowerCase()}</span>
                    ))}
                  </div>
                  <p className="modq-q-text">{q.text}</p>
                  {q.findings.map((f, i) => f.explanation && <p key={`e${i}`} className="modq-why">{f.explanation}</p>)}
                </li>
              ))}
            </ul>
            <label className="modq-label" htmlFor="modq-note">Note to the organisation (they read it on reject)</label>
            <textarea id="modq-note" className="modq-textarea" rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
            {verdict && <p className="modq-note" role="status">{verdict}</p>}
            {error && <StatusMessage message={error} tone="error" className="modq-alert" />}
          </>
        )}
      </div>
      <footer className="modq-foot">
        <button type="button" className="modq-btn" onClick={requestClose} disabled={busy}>Close</button>
        {state === 'ready' && !verdict && (
          <>
            <button type="button" className="modq-btn modq-btn--danger" onClick={() => decide('reject')} disabled={busy}>Reject</button>
            {/* Stage 4: "Approve with a content notice" opens the picker inline here. */}
            <button type="button" className="modq-btn modq-btn--primary" onClick={() => decide('approve')} disabled={busy || !item || !item.snapshot}>Approve</button>
          </>
        )}
      </footer>
    </Modal>
  );
}

export default function ModerationPanel({ onOpenScoreCard }) {
  const [queue, setQueue] = useState({ items: [], count: 0, oldestWaitingSince: null });
  const [state, setState] = useState('loading');   // loading | ready | outage
  const [outage, setOutage] = useState('');
  const [open, setOpen] = useState(null);           // the sk under review
  const now = Date.now();

  const load = useCallback(async () => {
    try {
      const res = await authFetch(adminApiUrl('admin/moderation'));
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setOutage(body.error || `Could not read the queue (${res.status}).`); setState('outage'); return; }
      setQueue({ items: body.items || [], count: body.count || 0, oldestWaitingSince: body.oldestWaitingSince || null });
      setState('ready');
    } catch (e) { setOutage(`Could not read the queue: ${e.message}`); setState('outage'); }
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <section className="modq" data-theme="dark">
      <div className="modq-lede">
        {state === 'ready' && queue.count > 0 && <p className="modq-headline">{queueHeadline(queue.count, queue.oldestWaitingSince, now)}</p>}
        <p className="modq-fine">The check escalates rather than guessing. These are the ones it flagged as uncertain, not the ones it rejected.</p>
      </div>
      {state === 'outage' && <div className="modq-outage" role="alert"><Icon name="WarningCircle" weight="fill" size={16} color="var(--danger-text)" /> {outage}</div>}
      {state === 'ready' && queue.count === 0 && <p className="modq-empty">Nothing is waiting — the check decided everything on its own.</p>}
      {state === 'ready' && queue.count > 0 && (
        <table className="modq-tbl">
          <thead>
            <tr><th className="modq-col-set">Set</th><th className="modq-col-org">Organisation</th><th className="modq-col-why">Why it escalated</th><th className="modq-col-wait">Waiting</th><th className="modq-col-act" /></tr>
          </thead>
          <tbody>
            {queue.items.map((item) => (
              <tr key={item.sk} className="modq-row">
                <td>
                  <span className="modq-nm" title={item.title}>{item.title || item.setId}</span>
                  <span className="modq-sub">{gameTypeLabel(item.gameType)} · {item.questionCount || 0} questions · v{item.version}</span>
                </td>
                <td><span className="modq-nm" title={item.orgName}>{item.orgName || item.orgId}</span></td>
                <td><span className="modq-why-cell" title={whyLabel(item)}>{whyLabel(item)}</span></td>
                <td className="modq-wait">{waitedLabel(item.waitingSince, now)}</td>
                <td>
                  <div className="modq-rowact">
                    {onOpenScoreCard && item.publicSetId && (
                      <button type="button" className="modq-btn modq-btn--sm" onClick={() => onOpenScoreCard(item.publicSetId)}>Score card</button>
                    )}
                    <button type="button" className="modq-btn modq-btn--sm modq-btn--primary" onClick={() => setOpen(item.sk)}>Review</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {open && (
        <ReviewDialog sk={open} onClose={() => setOpen(null)} onDecided={() => { setOpen(null); load(); }} />
      )}
    </section>
  );
}
```

In the 409 path `onDecided({ refreshOnly: true })` refreshes the list but the dialog stays open showing the verdict until Close — so `onDecided` in the panel must NOT close when `refreshOnly` is set: use `onDecided={(r) => { if (!(r && r.refreshOnly)) setOpen(null); load(); }}`. Write it that way.

```css
/* src/src/components/ModerationPanel.css
   MODERATION — 11-moderation.html. Scoped under .modq; dusk (the platform
   console sets contentTheme 'dark'). Tokens only.
   MEASURED (asserted in __tests__/modqPalette.test.js):
     --text  #F4EDE4 on --bg #0F1A2E     14.9:1     --muted #9BA8BE on --bg     6.9:1
     --primary #F6A94C on --bg           9.1:1     --secondary #7CA7E6 on --bg 7.0:1
     --text on --surface #1B2942        12.5:1     --muted on --surface        6.1:1
     --danger-text #EF8C86 on --surface  6.1:1     --modq-success-text on --surface 7.8:1
     --bg on --primary (filled Approve)  8.9:1
     the uncertain tint (--primary at --modq-tint-alpha over --surface) keeps --text and --muted ≥ AA */
.modq {
  --modq-t-floor: 12px;
  --modq-t-label: 13px;
  --modq-t-body: 15px;
  --modq-t-head: 19px;
  --modq-row-h: 36px;
  --modq-success-text: #6FD0A4;
  --modq-tint-alpha: 0.08;
  --modq-rule: rgba(155, 168, 190, .20);
  --modq-rule-strong: rgba(155, 168, 190, .34);
  --modq-row-hover: rgba(155, 168, 190, .055);
  color: var(--text);
  font: 400 var(--modq-t-body)/1.45 var(--font-ui);
}
.modq-lede { margin: 0 0 12px; }
.modq-headline { margin: 0 0 4px; font-size: var(--modq-t-head); font-weight: 700; }
.modq-fine { margin: 0; color: var(--muted); font-size: var(--modq-t-label); }
.modq-empty { margin: 24px 0; color: var(--muted); }
.modq-outage { display: flex; gap: 8px; align-items: center; padding: 10px 12px; border: 1px solid var(--modq-rule-strong); border-radius: 6px; color: var(--danger-text); }
.modq-tbl { width: 100%; table-layout: fixed; border-collapse: collapse; }
.modq-tbl th { text-align: left; font-size: var(--modq-t-label); font-weight: 600; color: var(--muted); padding: 0 8px 6px; border-bottom: 1px solid var(--modq-rule-strong); }
.modq-col-set { width: 30%; } .modq-col-org { width: 18%; } .modq-col-why { width: 30%; } .modq-col-wait { width: 10%; } .modq-col-act { width: 12%; }
.modq-row td { height: var(--modq-row-h); padding: 4px 8px; border-bottom: 1px solid var(--modq-rule); vertical-align: middle; overflow: hidden; }
.modq-row:hover td { background: var(--modq-row-hover); }
.modq-nm { display: block; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 600; }
.modq-sub { display: block; color: var(--muted); font-size: var(--modq-t-floor); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.modq-why-cell { display: block; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.modq-wait { color: var(--muted); font-variant-numeric: tabular-nums; }
.modq-rowact { display: flex; gap: 5px; flex-wrap: wrap; }
.modq-rowact > :first-child { margin-left: auto; }
.modq-btn { height: 36px; padding: 0 12px; border-radius: 6px; border: 1px solid var(--modq-rule-strong); background: transparent; color: var(--text); font: 600 var(--modq-t-body)/1 var(--font-ui); cursor: pointer; }
.modq-btn:hover { background: var(--modq-row-hover); }
.modq-btn--sm { height: 28px; padding: 0 10px; font-size: var(--modq-t-label); }
.modq-btn--primary { background: var(--primary); border-color: var(--primary); color: var(--bg); }
.modq-btn--danger { color: var(--danger-text); border-color: rgba(229, 100, 94, .55); }
.modq-btn:disabled { opacity: .6; cursor: default; }
.modq-scrim { position: fixed; inset: 0; z-index: 60; display: flex; align-items: flex-start; justify-content: center; overflow-y: auto; padding: 32px 16px; background: rgba(15, 26, 46, .72); }
.modq-card { width: min(880px, 100%); margin: auto; background: var(--surface); border: 1px solid var(--modq-rule); border-radius: 10px; display: flex; flex-direction: column; }
.modq-card--tall { min-height: min(80vh, 900px); }
.modq-head { display: flex; align-items: flex-start; gap: 12px; padding: 18px 20px 0; }
.modq-head h2 { margin: 0; flex: 1; min-width: 0; font-size: var(--modq-t-head); font-weight: 700; }
.modq-x { flex: none; width: 32px; height: 32px; border: 0; background: transparent; color: var(--muted); font-size: 22px; line-height: 1; cursor: pointer; border-radius: 6px; }
.modq-x:hover { color: var(--text); background: var(--modq-rule); }
.modq-body { padding: 10px 20px; flex: 1; }
.modq-sub { color: var(--muted); font-size: var(--modq-t-label); }
.modq-note { color: var(--primary); }
.modq-h { margin: 14px 0 6px; font-size: var(--modq-t-body); font-weight: 700; }
.modq-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.modq-q { padding: 10px 12px; border: 1px solid var(--modq-rule); border-radius: 6px; }
.modq-q--uncertain { background: rgba(246, 169, 76, var(--modq-tint-alpha)); border-color: rgba(246, 169, 76, .5); }
.modq-q-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.modq-q-text { margin: 6px 0 0; }
.modq-why { margin: 6px 0 0; color: var(--muted); font-size: var(--modq-t-label); }
.modq-chip { display: inline-flex; align-items: center; padding: 2px 7px; border-radius: 999px; border: 1px solid var(--modq-rule-strong); font-size: var(--modq-t-floor); font-weight: 600; color: var(--muted); white-space: nowrap; }
.modq-chip--flagged { color: var(--danger-text); border-color: rgba(229, 100, 94, .55); }
.modq-chip--uncertain { color: var(--primary); border-color: rgba(246, 169, 76, .5); }
.modq-label { display: block; margin: 14px 0 4px; font-size: var(--modq-t-label); color: var(--muted); }
.modq-textarea { width: 100%; box-sizing: border-box; font: inherit; color: var(--text); background: transparent; border: 1px solid var(--modq-rule-strong); border-radius: 6px; padding: 8px; }
.modq-alert { margin: 8px 0; }
.modq-foot { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 20px 18px; border-top: 1px solid var(--modq-rule); }
```

- [ ] **Step 4: Run the suites**

Run: `cd src && CI=true npx jest __tests__/moderationPanel.test.jsx __tests__/modqPalette.test.js __tests__/scopedClassesDeclared.test.js __tests__/modalReachability.test.js 2>&1 | grep -E '✕|Tests:'; cd ..`
Expected: all pass. If a palette pairing fails, adjust the token (never the threshold) and the header numbers.

- [ ] **Step 5: Commit**

```bash
git add src/src/components/ModerationPanel.jsx src/src/components/ModerationPanel.css src/src/__tests__/moderationPanel.test.jsx src/src/__tests__/modqPalette.test.js src/src/__tests__/scopedClassesDeclared.test.js
git commit -m "The moderation queue: what the check could not decide, why in band words, and a review that decides it

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: `ScoreCard` — a public set's standing

**Files:**
- Create: `src/src/components/ScoreCard.jsx`, `src/src/components/ScoreCard.css`
- Test: `src/src/__tests__/scoreCard.test.jsx`, `src/src/__tests__/scardPalette.test.js`; register `['ScoreCard', 'scard']`

**Interfaces:**
- Props: `publicSetId`, `onBack()`, `onTakenDown(publicSetId)`.
- Network: `GET adminApiUrl('admin/public-library/<id>')` on mount; `DELETE` the same URL with `{ note }` from the takedown `Modal`.
- Renders: a back link (*"← Public library"*), the identity line *"Public v{publicVersion} · by {sourceOrgName} · approved by {reviewer}, {date} · content notice: {ids}"* (parts absent when unknown), the timeline from `log` (newest first; event, when, who, note), the latest check's findings (uncertain first — they arrive in set order; sort by band HIGH, MEDIUM, LOW), and **Take down** behind a small `Modal` that states the consequence and requires a note. Reports (Stage 3) and the notice editor (Stage 4) are seams with comments.

- [ ] **Step 1: Write the failing tests**

```jsx
// src/src/__tests__/scoreCard.test.jsx
import React from 'react';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
jest.mock('../auth/authFetch', () => ({ __esModule: true, authFetch: (...args) => global.fetch(...args) }));
import ScoreCard from '../components/ScoreCard';

const CARD = {
  publicSetId: 'orgacme-safety', name: 'Safety walkthrough', description: 'Site safety', engagementType: 'trivia',
  sourceOrgId: 'org_acme', sourceOrgName: 'Acme', sourceSetId: 'safety', sourceVersion: 2, publicVersion: 2, questionCount: 30,
  contentHash: 'c'.repeat(64), sensitivity: ['graphic-medical'], promptDropped: true, publishedAt: '2026-08-19T10:01:00.000Z',
  review: { status: 'passed', reviewer: 'dai', decidedAt: '2026-08-19T10:00:00.000Z', note: 'Clinical, not gratuitous.', notice: ['graphic-medical'], checkedAt: '2026-08-19T09:00:00.000Z',
    findings: [{ questionId: 'c001#001', category: 'VIOLENCE', band: 'LOW' }, { questionId: 'c001#014', category: 'VIOLENCE', band: 'MEDIUM', explanation: 'Injuries in detail.' }] },
  log: [
    { event: 'checked', at: '2026-08-19T09:00:00.000Z', version: 2, outcome: 'escalated' },
    { event: 'decided', at: '2026-08-19T10:00:00.000Z', version: 2, decision: 'approve', reviewer: 'dai', note: 'Clinical, not gratuitous.' },
    { event: 'published', at: '2026-08-19T10:01:00.000Z', version: 2, publicVersion: 2 },
  ],
};
const json = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
let deleted;
beforeEach(() => {
  window.API_BASE = 'https://api.test/';
  deleted = [];
  global.fetch = jest.fn(async (url, options = {}) => {
    const method = (options.method || 'GET').toUpperCase();
    if (method === 'DELETE') { deleted.push(JSON.parse(options.body)); return json({ takenDown: 'orgacme-safety' }); }
    return json(CARD);
  });
});

test('the identity line, the timeline newest first, and the findings uncertain first', async () => {
  render(<ScoreCard publicSetId="orgacme-safety" onBack={() => {}} onTakenDown={() => {}} />);
  expect(await screen.findByRole('heading', { name: /safety walkthrough/i })).toBeInTheDocument();
  const line = screen.getByTestId('scard-identity');
  expect(line).toHaveTextContent('Public v2');
  expect(line).toHaveTextContent('by Acme');
  expect(line).toHaveTextContent(/approved by dai, 19 Aug/i);
  expect(line).toHaveTextContent(/content notice: graphic medical/i);
  const events = screen.getAllByTestId('scard-event');
  expect(events[0]).toHaveTextContent(/published/i);
  expect(events[2]).toHaveTextContent(/checked/i);
  expect(events[1]).toHaveTextContent(/clinical, not gratuitous/i);
  const findings = screen.getAllByTestId('scard-finding');
  expect(findings[0]).toHaveTextContent('c001#014');
  expect(findings[0]).toHaveTextContent(/uncertain/i);
  expect(findings[0]).toHaveTextContent(/injuries in detail/i);
  expect(findings[1]).toHaveTextContent(/low/i);
});
test('Take down states the consequence, needs a note, and hands back the id', async () => {
  const onTakenDown = jest.fn();
  render(<ScoreCard publicSetId="orgacme-safety" onBack={() => {}} onTakenDown={onTakenDown} />);
  fireEvent.click(await screen.findByRole('button', { name: /take down/i }));
  const dialog = await screen.findByRole('dialog');
  expect(dialog).toHaveTextContent(/gone for everyone/i);
  expect(dialog).toHaveTextContent(/keeps their copy and sees your note/i);
  const confirm = within(dialog).getByRole('button', { name: /^take down$/i });
  expect(confirm).toBeDisabled();
  fireEvent.change(within(dialog).getByRole('textbox', { name: /note/i }), { target: { value: 'Reported for graphic detail.' } });
  expect(confirm).toBeEnabled();
  fireEvent.click(confirm);
  await waitFor(() => expect(deleted).toEqual([{ note: 'Reported for graphic detail.' }]));
  await waitFor(() => expect(onTakenDown).toHaveBeenCalledWith('orgacme-safety'));
});
test('the back link calls onBack, and a missing set says so', async () => {
  const onBack = jest.fn();
  render(<ScoreCard publicSetId="orgacme-safety" onBack={onBack} onTakenDown={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: /public library/i }));
  expect(onBack).toHaveBeenCalled();
  global.fetch = jest.fn(async () => json({ error: 'No such public set.' }, 404));
  render(<ScoreCard publicSetId="gone" onBack={() => {}} onTakenDown={() => {}} />);
  expect(await screen.findByRole('alert')).toHaveTextContent(/no such public set/i);
});
```

```js
// src/src/__tests__/scardPalette.test.js
const fs = require('fs');
const path = require('path');
const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const GLOBAL_CSS = read('styles.css');
const CSS = read('components', 'ScoreCard.css');
function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function lum(c) { return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]); }
function ratio(a, b) { const la = lum(a); const lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); }
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16));
function token(css, block, name) { const s = css.indexOf(block); const body = css.slice(s, css.indexOf('}', s)); const m = body.match(new RegExp(`${name}\\s*:\\s*(#[0-9A-Fa-f]{6})`)); if (!m) throw new Error(`${name} not in ${block}`); return m[1]; }
const DUSK = '[data-theme="dark"] {'; const ROOT = ':root {';
const T = { bg: token(GLOBAL_CSS, DUSK, '--bg'), surface: token(GLOBAL_CSS, DUSK, '--surface'), text: token(GLOBAL_CSS, DUSK, '--text'), muted: token(GLOBAL_CSS, DUSK, '--muted'), primary: token(GLOBAL_CSS, ROOT, '--primary'), dangerText: token(GLOBAL_CSS, ROOT, '--danger-text'), success: token(CSS, '.scard {', '--scard-success-text') };
const AA = 4.5;
describe('ScoreCard palette', () => {
  test.each([
    ['--text on --bg', T.text, T.bg], ['--muted on --bg', T.muted, T.bg], ['--primary on --bg', T.primary, T.bg], ['--danger-text on --bg', T.dangerText, T.bg],
    ['--text on --surface', T.text, T.surface], ['--muted on --surface', T.muted, T.surface], ['--scard-success-text on --surface', T.success, T.surface],
  ])('%s clears AA', (_l, fg, bg) => expect(ratio(hex(fg), hex(bg))).toBeGreaterThanOrEqual(AA));
  test('scoped, token-only, no --danger text, 12px floor', () => {
    const stripped = CSS.replace(/\/\*[\s\S]*?\*\//g, ' ');
    const tokenBlock = stripped.slice(stripped.indexOf('.scard {'), stripped.indexOf('}', stripped.indexOf('.scard {')));
    expect((stripped.replace(tokenBlock, '').match(/#[0-9A-Fa-f]{3,6}\b/g) || [])).toEqual([]);
    expect(stripped).not.toMatch(/color:\s*var\(--danger\)/);
    for (const m of stripped.matchAll(/(\d+(?:\.\d+)?)px/g)) { if (/font-size/.test(stripped.slice(Math.max(0, m.index - 40), m.index))) expect(Number(m[1])).toBeGreaterThanOrEqual(12); }
    for (const sel of stripped.matchAll(/(^|\})\s*([^{@}]+)\{/g)) for (const part of sel[2].split(',')) expect(part.trim()).toMatch(/^\.scard(\b|-)/);
    expect(GLOBAL_CSS).not.toMatch(/\.scard(\b|-)/);
  });
});
```

Add `['ScoreCard', 'scard'],` to `SURFACES`.

- [ ] **Step 2: Run them to see them fail**

Run: `cd src && CI=true npx jest __tests__/scoreCard.test.jsx __tests__/scardPalette.test.js 2>&1 | grep -E '✕|Tests:'; cd ..`
Expected: both fail (`Cannot find module`).

- [ ] **Step 3: Write the component and its stylesheet**

```jsx
// src/src/components/ScoreCard.jsx
import React, { useEffect, useState } from 'react';
import Modal from './Modal';
import StatusMessage from './StatusMessage';
import { authFetch } from '../auth/authFetch';
import { adminApiUrl } from '../utils/adminApi';
import { gameTypeLabel } from '../config/gameTypes';
import './ScoreCard.css';

/**
 * THE SCORE CARD — spec §10.5. A PLACE in the platform console, the way the
 * set editor is a place in the org console: it holds a timeline and a table,
 * so it is not a modal. Reached from the staff Public library and from a
 * queue row that carries a publicSetId. Reports (Stage 3) and the notice
 * editor (Stage 4) join the seams marked below.
 */
const BAND_RANK = { HIGH: 0, MEDIUM: 1, LOW: 2 };
const BAND_WORD = { HIGH: 'flagged', MEDIUM: 'uncertain', LOW: 'low' };
const bandWord = (b) => BAND_WORD[String(b || '').toUpperCase()] || String(b || '').toLowerCase();
const day = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '');
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const humanise = (id) => String(id || '').replace(/[-_]+/g, ' ');
const itemUrl = (id) => adminApiUrl(`admin/public-library/${encodeURIComponent(id)}`);

const EVENT_WORDS = {
  checked: (e) => `Checked${e.outcome ? ` — ${e.outcome}` : ''}`,
  escalated: () => 'Sent to a person',
  appealed: (e) => `Appealed${e.appealMessage ? `: “${e.appealMessage}”` : ''}`,
  decided: (e) => `${e.decision === 'approve' ? 'Approved' : 'Rejected'}${e.reviewer ? ` by ${e.reviewer}` : ''}`,
  published: (e) => `Published${e.publicVersion ? ` as public v${e.publicVersion}` : ''}`,
  unpublished: () => 'Unpublished by the organisation',
  'taken-down': (e) => `Taken down${e.reviewer ? ` by ${e.reviewer}` : ''}`,
  reported: (e) => `Reported${e.type ? ` — ${e.type}` : ''}`,
  'notice-set': () => 'Content notice set',
  'notice-cleared': () => 'Content notice cleared',
  access: (e) => `Opened by ${(e.who && e.who.name) || 'Engage'}`,
};
const eventWords = (e) => (EVENT_WORDS[e.event] ? EVENT_WORDS[e.event](e) : e.event);

function TakedownDialog({ name, busy, onClose, onConfirm }) {
  const [note, setNote] = useState('');
  const requestClose = () => { if (!busy) onClose(); };
  return (
    <Modal overlayClassName="scard scard-scrim" contentClassName="scard-dialog" labelledBy="scard-td-title" onClose={requestClose} closeOnBackdrop={() => !busy} closeOnEscape={() => !busy}>
      <header className="scard-head">
        <h2 id="scard-td-title">Take down “{name}”?</h2>
        <button type="button" className="scard-x" onClick={requestClose} aria-label="Close" title="Close" disabled={busy}>×</button>
      </header>
      <div className="scard-body">
        <p>It is gone for everyone. The organisation keeps their copy and sees your note — their editor shows it where the check's own findings would.</p>
        <label className="scard-label" htmlFor="scard-td-note">Note to the organisation (required)</label>
        <textarea id="scard-td-note" className="scard-textarea" rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <footer className="scard-foot">
        <button type="button" className="scard-btn" onClick={requestClose} disabled={busy}>Cancel</button>
        <button type="button" className="scard-btn scard-btn--danger" onClick={() => onConfirm(note.trim())} disabled={busy || !note.trim()}>Take down</button>
      </footer>
    </Modal>
  );
}

export default function ScoreCard({ publicSetId, onBack, onTakenDown }) {
  const [card, setCard] = useState(null);
  const [error, setError] = useState(null);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    setCard(null); setError(null);
    (async () => {
      try {
        const res = await authFetch(itemUrl(publicSetId));
        const body = await res.json().catch(() => ({}));
        if (!live) return;
        if (!res.ok) { setError(body.error || `Could not open that set (${res.status}).`); return; }
        setCard(body);
      } catch (e) { if (live) setError(`Could not open that set: ${e.message}`); }
    })();
    return () => { live = false; };
  }, [publicSetId]);

  const takeDown = async (note) => {
    setBusy(true);
    try {
      const res = await authFetch(itemUrl(publicSetId), { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.error || `Could not take it down (${res.status}).`); setAsking(false); return; }
      setAsking(false);
      if (onTakenDown) onTakenDown(publicSetId);
    } catch (e) { setError(`Could not take it down: ${e.message}`); setAsking(false); } finally { setBusy(false); }
  };

  const identity = card ? [
    `Public v${card.publicVersion || '—'}`,
    card.sourceOrgName ? `by ${card.sourceOrgName}` : '',
    card.review && card.review.reviewer ? `approved by ${card.review.reviewer}${card.review.decidedAt ? `, ${day(card.review.decidedAt)}` : ''}` : (card.publishedAt ? `published ${day(card.publishedAt)}` : ''),
    card.sensitivity && card.sensitivity.length ? `content notice: ${card.sensitivity.map(humanise).join(', ')}` : '',
    // Stage 3: `${reports} reports` joins here.
  ].filter(Boolean).join(' · ') : '';
  const findings = card ? [...(card.review.findings || [])].sort((a, b) => (BAND_RANK[String(a.band).toUpperCase()] ?? 9) - (BAND_RANK[String(b.band).toUpperCase()] ?? 9)) : [];
  const timeline = card ? [...(card.log || [])].sort((a, b) => String(b.at || '').localeCompare(String(a.at || ''))) : [];

  return (
    <section className="scard" data-theme="dark">
      <button type="button" className="scard-back" onClick={onBack}>← Public library</button>
      {error && <div className="scard-outage" role="alert">{error}</div>}
      {card && (
        <>
          <header className="scard-title">
            <h2>{card.name || card.publicSetId}</h2>
            <p className="scard-fine">{gameTypeLabel(card.engagementType)} · {card.questionCount || 0} questions{card.description ? ` · ${card.description}` : ''}</p>
            <p className="scard-identity" data-testid="scard-identity">{identity}</p>
          </header>
          <div className="scard-acts">
            <button type="button" className="scard-btn scard-btn--danger" onClick={() => setAsking(true)}>Take down</button>
            {/* Stage 4: the content-notice editor sits beside Take down. */}
          </div>
          <h3 className="scard-h">Timeline</h3>
          <ol className="scard-timeline">
            {timeline.map((e, i) => (
              <li key={`${e.at}-${i}`} className="scard-event" data-testid="scard-event">
                <span className="scard-when">{when(e.at)}</span>
                <span className="scard-what">{eventWords(e)}{e.version ? ` · v${e.version}` : ''}</span>
                {e.note && <span className="scard-note">“{e.note}”</span>}
              </li>
            ))}
            {!timeline.length && <li className="scard-fine">No events recorded.</li>}
          </ol>
          <h3 className="scard-h">The latest check{card.review.checkedAt ? ` · ${day(card.review.checkedAt)}` : ''}</h3>
          {findings.length ? (
            <table className="scard-tbl">
              <thead><tr><th className="scard-col-q">Question</th><th className="scard-col-b">Band</th><th className="scard-col-c">Category</th><th className="scard-col-w">Why</th></tr></thead>
              <tbody>
                {findings.map((f, i) => (
                  <tr key={i} className="scard-finding" data-testid="scard-finding">
                    <td>{f.questionId === '(set)' ? "The set's own text" : f.questionId}</td>
                    <td><span className={`scard-chip scard-chip--${bandWord(f.band) || 'none'}`}>{bandWord(f.band)}</span></td>
                    <td>{String(f.category || '').toLowerCase()}</td>
                    <td className="scard-why">{f.explanation || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="scard-fine">The check found nothing to say.</p>}
          {/* Stage 3: reports by type, and each report's note (never the reporter). */}
        </>
      )}
      {asking && card && <TakedownDialog name={card.name || card.publicSetId} busy={busy} onClose={() => setAsking(false)} onConfirm={takeDown} />}
    </section>
  );
}
```

```css
/* src/src/components/ScoreCard.css
   THE SCORE CARD — spec §10.5. Scoped under .scard; dusk; tokens only.
   MEASURED (asserted in __tests__/scardPalette.test.js):
     --text on --bg 14.9:1 · --muted on --bg 6.9:1 · --primary on --bg 9.1:1 · --danger-text on --bg 5.4:1
     --text on --surface 12.5:1 · --muted on --surface 6.1:1 · --scard-success-text on --surface 7.8:1 */
.scard {
  --scard-t-floor: 12px;
  --scard-t-label: 13px;
  --scard-t-body: 15px;
  --scard-t-head: 19px;
  --scard-t-title: 24px;
  --scard-row-h: 36px;
  --scard-success-text: #6FD0A4;
  --scard-rule: rgba(155, 168, 190, .20);
  --scard-rule-strong: rgba(155, 168, 190, .34);
  --scard-row-hover: rgba(155, 168, 190, .055);
  color: var(--text);
  font: 400 var(--scard-t-body)/1.45 var(--font-ui);
}
.scard-back { border: 0; background: transparent; color: var(--secondary); font: 600 var(--scard-t-label)/1 var(--font-ui); cursor: pointer; padding: 0; margin: 0 0 10px; }
.scard-title h2 { margin: 0; font-size: var(--scard-t-title); font-weight: 700; }
.scard-fine { margin: 4px 0 0; color: var(--muted); font-size: var(--scard-t-label); }
.scard-identity { margin: 6px 0 0; font-weight: 600; }
.scard-acts { display: flex; gap: 8px; margin: 12px 0; }
.scard-h { margin: 18px 0 6px; font-size: var(--scard-t-head); font-weight: 700; }
.scard-timeline { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.scard-event { display: grid; grid-template-columns: 11ch 1fr; gap: 4px 12px; padding: 6px 0; border-bottom: 1px solid var(--scard-rule); }
.scard-when { color: var(--muted); font-size: var(--scard-t-label); font-variant-numeric: tabular-nums; }
.scard-note { grid-column: 2; color: var(--muted); font-size: var(--scard-t-label); }
.scard-tbl { width: 100%; table-layout: fixed; border-collapse: collapse; }
.scard-tbl th { text-align: left; font-size: var(--scard-t-label); font-weight: 600; color: var(--muted); padding: 0 8px 6px; border-bottom: 1px solid var(--scard-rule-strong); }
.scard-col-q { width: 18%; } .scard-col-b { width: 14%; } .scard-col-c { width: 16%; } .scard-col-w { width: 52%; }
.scard-finding td { height: var(--scard-row-h); padding: 4px 8px; border-bottom: 1px solid var(--scard-rule); vertical-align: middle; }
.scard-why { color: var(--muted); font-size: var(--scard-t-label); }
.scard-chip { display: inline-flex; padding: 2px 7px; border-radius: 999px; border: 1px solid var(--scard-rule-strong); font-size: var(--scard-t-floor); font-weight: 600; color: var(--muted); }
.scard-chip--flagged { color: var(--danger-text); border-color: rgba(229, 100, 94, .55); }
.scard-chip--uncertain { color: var(--primary); border-color: rgba(246, 169, 76, .5); }
.scard-outage { padding: 10px 12px; border: 1px solid var(--scard-rule-strong); border-radius: 6px; color: var(--danger-text); margin: 0 0 12px; }
.scard-btn { height: 36px; padding: 0 12px; border-radius: 6px; border: 1px solid var(--scard-rule-strong); background: transparent; color: var(--text); font: 600 var(--scard-t-body)/1 var(--font-ui); cursor: pointer; }
.scard-btn:hover { background: var(--scard-row-hover); }
.scard-btn--danger { color: var(--danger-text); border-color: rgba(229, 100, 94, .55); }
.scard-btn:disabled { opacity: .6; cursor: default; }
.scard-scrim { position: fixed; inset: 0; z-index: 60; display: flex; align-items: flex-start; justify-content: center; overflow-y: auto; padding: 48px 16px; background: rgba(15, 26, 46, .72); }
.scard-dialog { width: min(560px, 100%); margin: auto; background: var(--surface); border: 1px solid var(--scard-rule); border-radius: 10px; }
.scard-head { display: flex; align-items: flex-start; gap: 12px; padding: 18px 20px 0; }
.scard-head h2 { margin: 0; flex: 1; min-width: 0; font-size: var(--scard-t-head); font-weight: 700; }
.scard-x { flex: none; width: 32px; height: 32px; border: 0; background: transparent; color: var(--muted); font-size: 22px; line-height: 1; cursor: pointer; border-radius: 6px; }
.scard-body { padding: 10px 20px; }
.scard-body p { margin: 0 0 12px; }
.scard-label { display: block; margin: 8px 0 4px; font-size: var(--scard-t-label); color: var(--muted); }
.scard-textarea { width: 100%; box-sizing: border-box; font: inherit; color: var(--text); background: transparent; border: 1px solid var(--scard-rule-strong); border-radius: 6px; padding: 8px; }
.scard-foot { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 20px 18px; border-top: 1px solid var(--scard-rule); }
```

- [ ] **Step 4: Run the suites**

Run: `cd src && CI=true npx jest __tests__/scoreCard.test.jsx __tests__/scardPalette.test.js __tests__/scopedClassesDeclared.test.js 2>&1 | grep -E '✕|Tests:'; cd ..`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/src/components/ScoreCard.jsx src/src/components/ScoreCard.css src/src/__tests__/scoreCard.test.jsx src/src/__tests__/scardPalette.test.js src/src/__tests__/scopedClassesDeclared.test.js
git commit -m "A public set's score card: its standing, its timeline, the latest findings, and take down behind a stated consequence

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: The two library screens — `07` on `QuestionSetsPanel`

**Files:**
- Modify: `src/src/components/QuestionSetsPanel.jsx` (a `rowActions` render prop; the owner chip's title carries `sourceOrgName`)
- Create: `src/src/components/PublicLibraryPanel.jsx`, `src/src/components/PublicLibraryPanel.css` (`.publib`)
- Test: `src/src/__tests__/publicLibraryPanel.test.jsx`, `src/src/__tests__/publibPalette.test.js`, `src/src/__tests__/questionSetsPanel.test.jsx` (one test for `rowActions`); register `['PublicLibraryPanel', 'publib']`

**Interfaces:**
- `QuestionSetsPanel` gains `rowActions?: (set) => ReactNode` — when given, it REPLACES the built-in action group for every row (the Edit/Share/Delete and Open/Copy branches are untouched otherwise); and the owner chip's `title` reads *"Published by {sourceOrgName}"* when the row carries one.
- `PublicLibraryPanel({ questionSets, mode: 'org' | 'platform', onCopy, onPreview, onOpenScoreCard, onUnpublish })` filters `questionSets` to `scope === 'public'`, shows the note *"Sets other teams have published and had reviewed. Copying one makes your organisation its own copy — your own published sets appear here too."* (org) or *"Everything organisations have published. Taking a set down removes it for everyone; the organisation keeps their copy and reads your note."* (platform), and mounts `QuestionSetsPanel` with `rowActions`: org → **Preview** (`onPreview(set)`) and **Copy to my team** (`onCopy(set)`); platform → **Score card** (`onOpenScoreCard(set.id)`) and **Unpublish** (a small `Modal` with the consequence and a required note → `onUnpublish(set, note)`). No Create, no column for copies (D6). "Report a problem" is Stage 3 — a comment marks the seam.

- [ ] **Step 1: Write the failing tests**

Append to `src/src/__tests__/questionSetsPanel.test.jsx`:

```jsx
describe('rowActions', () => {
  test('a caller can replace the row actions, and the owner chip names the publisher', () => {
    const rows = [{ ...SETS[0], id: 'pub', name: 'Public one', canManage: false, scope: 'public', sourceOrgName: 'Meridian Delivery' }];
    mount({ questionSets: rows, rowActions: (set) => <button type="button">Do {set.id}</button> });
    expect(screen.getByRole('button', { name: 'Do pub' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^open$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^copy$/i })).toBeNull();
    expect(within(rowFor('Public one')).getByText('Public')).toHaveAttribute('title', expect.stringMatching(/Meridian Delivery/));
  });
});
```

```jsx
// src/src/__tests__/publicLibraryPanel.test.jsx
import React from 'react';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import PublicLibraryPanel from '../components/PublicLibraryPanel';

const ROWS = [
  { id: 'orgacme-safety', name: 'Safety walkthrough', engagementType: 'trivia', totalQuestions: 30, canManage: false, scope: 'public', activeVersion: 2, sourceOrgName: 'Acme', sensitivity: ['graphic-medical'] },
  { id: 'mine', name: 'Mine', engagementType: 'trivia', totalQuestions: 5, canManage: true, scope: 'org', activeVersion: 1 },
  { id: 'engage', name: 'Engage one', engagementType: 'poll', totalQuestions: 9, canManage: false, scope: 'platform', activeVersion: 1 },
];

test('the org library lists only public sets, says who published each, and offers Preview and Copy', () => {
  const onCopy = jest.fn(); const onPreview = jest.fn();
  render(<PublicLibraryPanel questionSets={ROWS} mode="org" onCopy={onCopy} onPreview={onPreview} />);
  expect(screen.getByText(/your own published sets appear here too/i)).toBeInTheDocument();
  expect(screen.getByText('Safety walkthrough')).toBeInTheDocument();
  expect(screen.queryByText('Mine')).toBeNull();
  expect(screen.queryByText('Engage one')).toBeNull();
  const row = screen.getByText('Safety walkthrough').closest('tr');
  expect(within(row).getByText('Public')).toHaveAttribute('title', expect.stringMatching(/Acme/));
  fireEvent.click(within(row).getByRole('button', { name: /copy to my team/i }));
  expect(onCopy).toHaveBeenCalledWith(expect.objectContaining({ id: 'orgacme-safety' }));
  fireEvent.click(within(row).getByRole('button', { name: /^preview$/i }));
  expect(onPreview).toHaveBeenCalledWith(expect.objectContaining({ id: 'orgacme-safety' }));
});
test('an empty public library says so honestly', () => {
  render(<PublicLibraryPanel questionSets={ROWS.filter((r) => r.scope !== 'public')} mode="org" onCopy={() => {}} onPreview={() => {}} />);
  expect(screen.getByText(/nobody has published a set yet/i)).toBeInTheDocument();
});
test('the staff library offers the score card and Unpublish behind a stated consequence with a required note', async () => {
  const onUnpublish = jest.fn(); const onOpenScoreCard = jest.fn();
  render(<PublicLibraryPanel questionSets={ROWS} mode="platform" onOpenScoreCard={onOpenScoreCard} onUnpublish={onUnpublish} />);
  const row = screen.getByText('Safety walkthrough').closest('tr');
  fireEvent.click(within(row).getByRole('button', { name: /score card/i }));
  expect(onOpenScoreCard).toHaveBeenCalledWith('orgacme-safety');
  fireEvent.click(within(row).getByRole('button', { name: /^unpublish$/i }));
  const dialog = await screen.findByRole('dialog');
  expect(dialog).toHaveTextContent(/gone for everyone/i);
  expect(dialog).toHaveTextContent(/keeps their copy and sees your note/i);
  const confirm = within(dialog).getByRole('button', { name: /^unpublish$/i });
  expect(confirm).toBeDisabled();
  fireEvent.change(within(dialog).getByRole('textbox', { name: /note/i }), { target: { value: 'Reported; taken down pending an edit.' } });
  fireEvent.click(confirm);
  await waitFor(() => expect(onUnpublish).toHaveBeenCalledWith(expect.objectContaining({ id: 'orgacme-safety' }), 'Reported; taken down pending an edit.'));
  fireEvent.click(within(dialog).getByRole('button', { name: /^close$/i }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});
```

```js
// src/src/__tests__/publibPalette.test.js
const fs = require('fs');
const path = require('path');
const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const GLOBAL_CSS = read('styles.css');
const CSS = read('components', 'PublicLibraryPanel.css');
function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function lum(c) { return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]); }
function ratio(a, b) { const la = lum(a); const lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); }
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16));
function token(css, block, name) { const s = css.indexOf(block); const body = css.slice(s, css.indexOf('}', s)); const m = body.match(new RegExp(`${name}\\s*:\\s*(#[0-9A-Fa-f]{6})`)); if (!m) throw new Error(`${name} not in ${block}`); return m[1]; }
const DUSK = '[data-theme="dark"] {'; const ROOT = ':root {';
const T = { bg: token(GLOBAL_CSS, DUSK, '--bg'), surface: token(GLOBAL_CSS, DUSK, '--surface'), text: token(GLOBAL_CSS, DUSK, '--text'), muted: token(GLOBAL_CSS, DUSK, '--muted'), dangerText: token(GLOBAL_CSS, ROOT, '--danger-text') };
describe('PublicLibraryPanel palette', () => {
  test.each([['--text on --bg', T.text, T.bg], ['--muted on --bg', T.muted, T.bg], ['--text on --surface', T.text, T.surface], ['--muted on --surface', T.muted, T.surface], ['--danger-text on --surface', T.dangerText, T.surface]])('%s clears AA', (_l, fg, bg) => expect(ratio(hex(fg), hex(bg))).toBeGreaterThanOrEqual(4.5));
  test('scoped, token-only, no --danger text, 12px floor', () => {
    const stripped = CSS.replace(/\/\*[\s\S]*?\*\//g, ' ');
    const tokenBlock = stripped.slice(stripped.indexOf('.publib {'), stripped.indexOf('}', stripped.indexOf('.publib {')));
    expect((stripped.replace(tokenBlock, '').match(/#[0-9A-Fa-f]{3,6}\b/g) || [])).toEqual([]);
    expect(stripped).not.toMatch(/color:\s*var\(--danger\)/);
    for (const m of stripped.matchAll(/(\d+(?:\.\d+)?)px/g)) { if (/font-size/.test(stripped.slice(Math.max(0, m.index - 40), m.index))) expect(Number(m[1])).toBeGreaterThanOrEqual(12); }
    for (const sel of stripped.matchAll(/(^|\})\s*([^{@}]+)\{/g)) for (const part of sel[2].split(',')) expect(part.trim()).toMatch(/^\.publib(\b|-)/);
    expect(GLOBAL_CSS).not.toMatch(/\.publib(\b|-)/);
  });
});
```

Add `['PublicLibraryPanel', 'publib'],` to `SURFACES`.

- [ ] **Step 2: Run them to see them fail**

Run: `cd src && CI=true npx jest __tests__/questionSetsPanel.test.jsx __tests__/publicLibraryPanel.test.jsx __tests__/publibPalette.test.js 2>&1 | grep -E '✕|Tests:'; cd ..`
Expected: the `rowActions` test fails (the built-in Open/Copy render); the two new suites fail (`Cannot find module`).

- [ ] **Step 3: `QuestionSetsPanel` — the render prop and the publisher's name**

Props: add `rowActions,` after `onShare,` with the doc comment: *"When given, replaces the row's action group entirely — the public library's Preview / Copy and the staff library's Unpublish are not variations of Edit."* In the row, wrap the whole `{set.canManage !== false ? (…) : (…)}` action group as:

```jsx
                          {rowActions ? rowActions(set) : (set.canManage !== false ? (
                            … the existing manageable branch, unchanged …
                          ) : (
                            … the existing Open / Copy branch, unchanged …
                          ))}
```

and on the owner chip (`{setOwnerLabel(set)}`), make its `title` `set.sourceOrgName ? `Published by ${set.sourceOrgName}` : setOwnerTitle(set)`.

- [ ] **Step 4: `PublicLibraryPanel`**

```jsx
// src/src/components/PublicLibraryPanel.jsx
import React, { useState } from 'react';
import Modal from './Modal';
import QuestionSetsPanel from './QuestionSetsPanel';
import './PublicLibraryPanel.css';

/**
 * THE PUBLIC LIBRARY — docs/design/tenancy-redesign/07-public-library.html.
 *
 * Both consoles read the same rows (the public scope of the list) through the
 * same table (QuestionSetsPanel — filters, sorts, the two honest empty states)
 * and differ only in what a row offers: an organisation previews or copies;
 * Engage opens the score card or unpublishes. The copies column of the mockup
 * is out (D6). "Report a problem" (spec §10.6) arrives with reports, Stage 3.
 */
const COPY = {
  org: 'Sets other teams have published and had reviewed. Copying one makes your organisation its own copy — your own published sets appear here too.',
  platform: 'Everything organisations have published. Taking a set down removes it for everyone; the organisation keeps their copy and reads your note.',
};

function UnpublishDialog({ set, busy, onClose, onConfirm }) {
  const [note, setNote] = useState('');
  const requestClose = () => { if (!busy) onClose(); };
  return (
    <Modal overlayClassName="publib publib-scrim" contentClassName="publib-dialog" labelledBy="publib-title" onClose={requestClose} closeOnBackdrop={() => !busy} closeOnEscape={() => !busy}>
      <header className="publib-head">
        <h2 id="publib-title">Unpublish “{set.name}”?</h2>
        <button type="button" className="publib-x" onClick={requestClose} aria-label="Close" title="Close" disabled={busy}>×</button>
      </header>
      <div className="publib-body">
        <p>It is gone for everyone. The organisation keeps their copy and sees your note in their editor.</p>
        <label className="publib-label" htmlFor="publib-note">Note to the organisation (required)</label>
        <textarea id="publib-note" className="publib-textarea" rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <footer className="publib-foot">
        <button type="button" className="publib-btn" onClick={requestClose} disabled={busy}>Close</button>
        <button type="button" className="publib-btn publib-btn--danger" onClick={() => onConfirm(note.trim())} disabled={busy || !note.trim()}>Unpublish</button>
      </footer>
    </Modal>
  );
}

export default function PublicLibraryPanel({ questionSets = [], mode = 'org', onCopy, onPreview, onOpenScoreCard, onUnpublish, loading = false }) {
  const [unpublishing, setUnpublishing] = useState(null);
  const [busy, setBusy] = useState(false);
  const rows = questionSets.filter((s) => (s.scope || 'platform') === 'public');

  const rowActions = (set) => (mode === 'platform' ? (
    <div className="qsets-rowact">
      <button type="button" className="qsets-btn qsets-btn--sm" onClick={() => onOpenScoreCard && onOpenScoreCard(set.id)}>Score card</button>
      <button type="button" className="qsets-btn qsets-btn--sm qsets-btn--ghostdanger" onClick={() => setUnpublishing(set)} title="Remove it for everyone; the organisation keeps their copy">Unpublish</button>
    </div>
  ) : (
    <div className="qsets-rowact">
      <button type="button" className="qsets-btn qsets-btn--sm" onClick={() => onPreview && onPreview(set)} title="Read it. Saving from there makes your organisation its own copy.">Preview</button>
      <button type="button" className="qsets-btn qsets-btn--sm qsets-btn--primary" onClick={() => onCopy && onCopy(set)} title="Take a copy now, without opening it">Copy to my team</button>
      {/* Stage 3: Report a problem (spec §10.6). */}
    </div>
  ));

  const confirmUnpublish = async (note) => {
    setBusy(true);
    try { await onUnpublish(unpublishing, note); setUnpublishing(null); } finally { setBusy(false); }
  };

  return (
    <section className="publib" data-theme="dark">
      <p className="publib-note">{COPY[mode] || COPY.org}</p>
      {rows.length === 0 && !loading ? (
        <p className="publib-empty">Nobody has published a set yet. When an organisation shares one and it passes review, it appears here.</p>
      ) : (
        <QuestionSetsPanel questionSets={rows} loading={loading} rowActions={rowActions} />
      )}
      {unpublishing && <UnpublishDialog set={unpublishing} busy={busy} onClose={() => setUnpublishing(null)} onConfirm={confirmUnpublish} />}
    </section>
  );
}
```

The `qsets-*` classes on the buttons are deliberate: the row lives inside `QuestionSetsPanel`'s table, whose stylesheet owns row actions (reachability, wrapping). `scopedClassesDeclared` checks a component only against its own stylesheet, and `PublicLibraryPanel.jsx` uses `qsets-*` names in `className` — so declare in `PublicLibraryPanel.css` nothing for them, and if the scoped test flags `qsets-*` as undeclared for this component, keep the buttons but add to the test's `SURFACES` entry the allowance its shape supports (read `classesUsed` — it filters by the component's own prefix `publib`, so `qsets-*` is invisible to it).

```css
/* src/src/components/PublicLibraryPanel.css
   THE PUBLIC LIBRARY — 07-public-library.html. Scoped under .publib; the table
   itself is QuestionSetsPanel's (.qsets). Dusk; tokens only.
   MEASURED (asserted in __tests__/publibPalette.test.js): --text/--muted on --bg and
   on --surface, --danger-text on --surface — all ≥ AA. */
.publib {
  --publib-t-label: 13px;
  --publib-t-body: 15px;
  --publib-t-head: 19px;
  --publib-rule: rgba(155, 168, 190, .20);
  --publib-rule-strong: rgba(155, 168, 190, .34);
  --publib-row-hover: rgba(155, 168, 190, .055);
  color: var(--text);
  font: 400 var(--publib-t-body)/1.45 var(--font-ui);
}
.publib-note { margin: 0 0 12px; color: var(--muted); font-size: var(--publib-t-label); max-width: 72ch; }
.publib-empty { margin: 24px 0; color: var(--muted); }
.publib-scrim { position: fixed; inset: 0; z-index: 60; display: flex; align-items: flex-start; justify-content: center; overflow-y: auto; padding: 48px 16px; background: rgba(15, 26, 46, .72); }
.publib-dialog { width: min(560px, 100%); margin: auto; background: var(--surface); border: 1px solid var(--publib-rule); border-radius: 10px; }
.publib-head { display: flex; align-items: flex-start; gap: 12px; padding: 18px 20px 0; }
.publib-head h2 { margin: 0; flex: 1; min-width: 0; font-size: var(--publib-t-head); font-weight: 700; }
.publib-x { flex: none; width: 32px; height: 32px; border: 0; background: transparent; color: var(--muted); font-size: 22px; line-height: 1; cursor: pointer; border-radius: 6px; }
.publib-x:hover { color: var(--text); background: var(--publib-rule); }
.publib-body { padding: 10px 20px; }
.publib-body p { margin: 0 0 12px; }
.publib-label { display: block; margin: 8px 0 4px; font-size: var(--publib-t-label); color: var(--muted); }
.publib-textarea { width: 100%; box-sizing: border-box; font: inherit; color: var(--text); background: transparent; border: 1px solid var(--publib-rule-strong); border-radius: 6px; padding: 8px; }
.publib-foot { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 20px 18px; border-top: 1px solid var(--publib-rule); }
.publib-btn { height: 36px; padding: 0 12px; border-radius: 6px; border: 1px solid var(--publib-rule-strong); background: transparent; color: var(--text); font: 600 var(--publib-t-body)/1 var(--font-ui); cursor: pointer; }
.publib-btn:hover { background: var(--publib-row-hover); }
.publib-btn--danger { color: var(--danger-text); border-color: rgba(229, 100, 94, .55); }
.publib-btn:disabled { opacity: .6; cursor: default; }
```

- [ ] **Step 5: Run the suites**

Run: `cd src && CI=true npx jest __tests__/questionSetsPanel.test.jsx __tests__/publicLibraryPanel.test.jsx __tests__/publibPalette.test.js __tests__/scopedClassesDeclared.test.js __tests__/rowActionsReachable.test.js __tests__/questionSetsPalette.test.js 2>&1 | grep -E '✕|Tests:'; cd ..`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/src/components/QuestionSetsPanel.jsx src/src/components/PublicLibraryPanel.jsx src/src/components/PublicLibraryPanel.css src/src/__tests__/questionSetsPanel.test.jsx src/src/__tests__/publicLibraryPanel.test.jsx src/src/__tests__/publibPalette.test.js src/src/__tests__/scopedClassesDeclared.test.js
git commit -m "The public library, twice: what other teams published with Preview and Copy, and for Engage the same rows with a score card and Unpublish

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: The console — sections, mounts, the score-card place

**Files:**
- Modify: `src/src/config/consoleSections.js` (a `publiclibrary` section between the Shared library and Moderation), `src/src/AdminPage.jsx` (`PLATFORM_SECTION_IDS`; the `library`, `publiclibrary` and `moderation` renderers; the score-card place; the moderation nav count)
- Test: `src/src/__tests__/adminModeration.test.jsx` (new), `src/src/__tests__/adminOneSection.test.jsx` (one platform case for the new section)

**Interfaces:**
- `SECTION.publiclibrary = { id: 'publiclibrary', label: 'Public library', icon: 'Broadcast', title: 'Public library', subtitle: 'Everything organisations have published. Take a set down here; they keep their copy and read your note.', contentTheme: 'dark' }`, listed in `sectionsFor`'s platform group after `SECTION.platformsets`; `PLATFORM_SECTION_IDS` gains `'publiclibrary'`.
- Org console `library`: `<PublicLibraryPanel questionSets={questionSets} mode="org" loading={…} onCopy={handleCopySet} onPreview={handleEditQuestionSet} />` (Preview opens the read-only editor — the same path as the list's Open).
- Platform console `publiclibrary`: `scoreCardId ? <ScoreCard publicSetId={scoreCardId} onBack={() => setScoreCardId('')} onTakenDown={…} /> : <PublicLibraryPanel questionSets={questionSets} mode="platform" onOpenScoreCard={setScoreCardId} onUnpublish={handleUnpublish} />`; `handleUnpublish(set, note)` → `DELETE adminApiUrl('admin/public-library/<id>')` `{ note }` via `authFetch`, then `fetchQuestionSets()`; a failure → `setNotice({ tone: 'error', text })`.
- Platform console `moderation`: `<ModerationPanel onOpenScoreCard={(id) => { setScoreCardId(id); setActiveTab('publiclibrary'); }} />` replaces the placeholder.
- The shell: when `scoreCardId` is set (and `resolvedTab === 'publiclibrary'`), `breadcrumb={{ parentLabel: 'Public library', onBack: () => setScoreCardId('') }}`, `title="Score card"`, `subtitle={undefined}` — the same shape the editor place uses; leaving the section clears `scoreCardId`.
- The `moderation` nav item gets `count` = the queue length: `AdminPage` fetches `GET admin/moderation` once in platform mode (`moderationCount` state) and passes `count: moderationCount || undefined`.

- [ ] **Step 1: Write the failing tests**

```jsx
// src/src/__tests__/adminModeration.test.jsx
// … copy the jest.mock blocks, HOME, and the beforeEach from adminShare.test.jsx verbatim (through `import AdminPage`) …
const PUBLIC_ROWS = { questionSets: [
  { id: 'orgacme-safety', name: 'Safety walkthrough', engagementType: 'trivia', totalQuestions: 30, canManage: false, scope: 'public', activeVersion: 2, sourceOrgName: 'Acme' },
] };
const QUEUE = { count: 1, oldestWaitingSince: '2026-09-15T10:00:00.000Z', items: [{ sk: 'org_acme#safety#v2', orgName: 'Acme', setId: 'safety', title: 'Safety walkthrough', version: 2, gameType: 'trivia', questionCount: 30, reasons: ['escalated'], uncertainQuestionIds: ['c001#014'], waitingSince: '2026-09-15T10:00:00.000Z', publicSetId: '' }] };
const CARD = { publicSetId: 'orgacme-safety', name: 'Safety walkthrough', engagementType: 'trivia', questionCount: 30, sourceOrgName: 'Acme', publicVersion: 2, sourceVersion: 2, sensitivity: [], review: { status: 'passed', reviewer: 'dai', decidedAt: '2026-08-19T10:00:00.000Z', findings: [] }, log: [] };
const json = (body, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(body), json: async () => body });
let deleted;
function serveStaff() {
  deleted = [];
  global.fetch = jest.fn(async (url, options = {}) => {
    const u = String(url); const method = (options.method || 'GET').toUpperCase();
    if (u.includes('/orgs')) return json({ orgs: [HOME] });
    if (u.includes('admin/question-sets')) return json(PUBLIC_ROWS);
    if (u.endsWith('/admin/moderation')) return json(QUEUE);
    if (method === 'DELETE' && u.includes('admin/public-library/')) { deleted.push(JSON.parse(options.body)); return json({ takenDown: 'orgacme-safety' }); }
    if (u.includes('admin/public-library/')) return json(CARD);
    return json({});
  });
}
test('the platform console has a Public library section with Unpublish, and the Moderation nav counts the queue', async () => {
  mockActiveOrg = '~platform'; mockGroups = ['admins', 'hosts'];
  serveStaff();
  window.history.pushState({}, '', '/admin?section=publiclibrary');
  render(<AdminPage />);
  expect(await screen.findByRole('heading', { level: 1, name: /public library/i })).toBeInTheDocument();
  const row = (await screen.findByText('Safety walkthrough')).closest('tr');
  fireEvent.click(within(row).getByRole('button', { name: /^unpublish$/i }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByRole('textbox', { name: /note/i }), { target: { value: 'Taken down pending an edit.' } });
  fireEvent.click(within(dialog).getByRole('button', { name: /^unpublish$/i }));
  await waitFor(() => expect(deleted).toEqual([{ note: 'Taken down pending an edit.' }]));
  const nav = screen.getByRole('navigation', { name: /sections/i });
  await waitFor(() => expect(within(nav).getByText('Moderation').closest('button, a')).toHaveTextContent('1'));
});
test('Score card is a place: the breadcrumb goes back to the Public library', async () => {
  mockActiveOrg = '~platform'; mockGroups = ['admins', 'hosts'];
  serveStaff();
  window.history.pushState({}, '', '/admin?section=publiclibrary');
  render(<AdminPage />);
  const row = (await screen.findByText('Safety walkthrough')).closest('tr');
  fireEvent.click(within(row).getByRole('button', { name: /score card/i }));
  expect(await screen.findByRole('heading', { level: 1, name: /score card/i })).toBeInTheDocument();
  expect(screen.getByTestId('scard-identity')).toHaveTextContent(/by Acme/);
  fireEvent.click(screen.getByRole('button', { name: /^public library$/i }));
  expect(await screen.findByRole('heading', { level: 1, name: /public library/i })).toBeInTheDocument();
});
test('Moderation mounts the queue, and the org console library lists public sets with Copy', async () => {
  mockActiveOrg = '~platform'; mockGroups = ['admins', 'hosts'];
  serveStaff();
  window.history.pushState({}, '', '/admin?section=moderation');
  render(<AdminPage />);
  expect(await screen.findByText(/1 set the check would not decide on its own/i)).toBeInTheDocument();
  mockActiveOrg = HOME.orgId; mockGroups = ['hosts'];
  serveStaff();
  window.history.pushState({}, '', '/admin?section=library');
  render(<AdminPage />);
  expect(await screen.findByRole('button', { name: /copy to my team/i })).toBeInTheDocument();
  expect(screen.queryByText(/sharing is live/i)).toBeNull();
});
```

Add to `adminOneSection.test.jsx`'s platform `describe` (model it on "opens Engage's shared library on its own"; read `mounted()` to see how a panel registers and register `PublicLibraryPanel` the same way):

```jsx
  it('opens the Public library on its own', async () => {
    mockActiveOrg = PLATFORM_MODE;
    window.history.pushState({}, '', '/admin?section=publiclibrary');
    serve();
    render(<AdminPage />);
    await settle();
    await waitFor(() => expect(mounted()).toEqual(['Public library']));
    expect(document.querySelector('h1')).toHaveTextContent('Public library');
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd src && CI=true npx jest __tests__/adminModeration.test.jsx __tests__/adminOneSection.test.jsx 2>&1 | grep -E '✕|Tests:'; cd ..`
Expected: the three new tests fail (no section, no panel); the one-section case fails on the unknown section.

- [ ] **Step 3: Wire it**

`consoleSections.js`: add `SECTION.publiclibrary` (the object above) and insert it in the platform group after `SECTION.platformsets`. `AdminPage.jsx`: `PLATFORM_SECTION_IDS = ['orgs', 'publiclibrary', 'moderation', 'users', 'archive']`; imports for `ModerationPanel`, `ScoreCard`, `PublicLibraryPanel`; state `const [scoreCardId, setScoreCardId] = useState(''); const [moderationCount, setModerationCount] = useState(0);`; an effect that, when `onPlatform`, GETs `admin/moderation` and stores `count` (errors ignored — the badge is a convenience); `handleUnpublish` beside `handleAppeal`:

```jsx
  /** Staff take a public set down: DELETE with the note, then re-read the list. */
  const handleUnpublish = async (set, note) => {
    try {
      const res = await authFetch(adminApiUrl(`admin/public-library/${encodeURIComponent(set.id)}`), {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setNotice({ tone: 'error', text: body.error || `Could not take that down (${res.status}).` });
      }
    } catch (err) {
      setNotice({ tone: 'error', text: `Could not take that down: ${err.message}` });
    } finally {
      await fetchQuestionSets();
    }
  };
```

The renderers (replace the `library` and `moderation` placeholders; add `publiclibrary`):

```jsx
          {resolvedTab === 'library' && activeOrg && (
            <PublicLibraryPanel questionSets={questionSets} mode="org" loading={loadingQuestionSets} onCopy={handleCopySet} onPreview={handleEditQuestionSet} />
          )}
          {resolvedTab === 'publiclibrary' && onPlatform && (
            scoreCardId
              ? <ScoreCard publicSetId={scoreCardId} onBack={() => setScoreCardId('')} onTakenDown={() => { setScoreCardId(''); fetchQuestionSets(); }} />
              : <PublicLibraryPanel questionSets={questionSets} mode="platform" loading={loadingQuestionSets} onOpenScoreCard={setScoreCardId} onUnpublish={handleUnpublish} />
          )}
          {resolvedTab === 'moderation' && onPlatform && (
            <ModerationPanel onOpenScoreCard={(id) => { setScoreCardId(id); setActiveTab('publiclibrary'); }} />
          )}
```

The shell props: `breadcrumb={editingSet ? { parentLabel: 'Question sets', onBack: handleCancelEdit } : (scoreCardId && resolvedTab === 'publiclibrary' ? { parentLabel: 'Public library', onBack: () => setScoreCardId('') } : null)}`, `title={editingSet ? (editingSet.name || editingSet.id) : (scoreCardId && resolvedTab === 'publiclibrary' ? 'Score card' : section.title)}`, `subtitle={editingSet || (scoreCardId && resolvedTab === 'publiclibrary') ? undefined : section.subtitle}`. In `handleNavigate` (the section switch), add `setScoreCardId('')`. In the nav mapping beside the `questionsets` branch, map `moderation` to `{ ...item, count: moderationCount || undefined }`. If `loadingQuestionSets` is not the loading flag's name, use the one `fetchQuestionSets` sets. The library section's `activeOrg` gate mirrors `members`/`billing`.

- [ ] **Step 4: Run the suites**

Run: `cd src && CI=true npx jest __tests__/adminModeration.test.jsx __tests__/adminOneSection.test.jsx __tests__/adminShare.test.jsx __tests__/adminCopyRebind.test.jsx __tests__/closedRoutesUseAuthFetch.test.js 2>&1 | grep -E '✕|Tests:'; npm run lint 2>&1 | tail -2; cd ..`
Expected: all pass; lint 0 errors, ≤ 10 warnings.

- [ ] **Step 5: Commit**

```bash
git add src/src/config/consoleSections.js src/src/AdminPage.jsx src/src/__tests__/adminModeration.test.jsx src/src/__tests__/adminOneSection.test.jsx
git commit -m "The console has both libraries and the queue: an org previews and copies, Engage decides, unpublishes and reads the score card

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: Baselines, dev, test, and the drive

**Files:** none new. This task ships Stage 2 to dev and test and proves it.

- [ ] **Step 1: The full gate**

```bash
rm -rf .aws-sam lambda-functions/admin/.aws-sam lambda-functions/dist; n=0; p=0; f=0; for t in tests/*.js; do case "$t" in *.spec.js) continue;; esac; n=$((n+1)); out=$(node "$t" 2>&1); rc=$?; c=$(printf '%s\n' "$out" | grep -oE '^[0-9]+ passed' | tail -1 | grep -oE '^[0-9]+'); p=$((p+${c:-0})); [ $rc -ne 0 ] && { f=$((f+1)); echo "FAILED: $t"; }; done; echo "suites=$n passed=$p failed=$f"
node tests/no-retired-twin-references.js | tail -1 && node tests/no-global-partition-literals.js | tail -1
cd src && CI=true npx jest 2>&1 | grep -E '^(Tests|Test Suites):' && npm run lint 2>&1 | tail -2 && npm run build 2>&1 | grep -E 'compiled|Failed' | head -1; cd ..
rm -rf .aws-sam && sam validate --template template-clean.yaml --region us-east-1 --lint | tail -1
```
Expected: suites ≥ 138 + 7 (`snapshot-store`, `moderation-list`, `moderation-get`, `moderation-decide`, `takedown`, `public-projection`, `authorizer-staff-routes`), 0 failed; frontend suites ≥ 211 + 8; lint 0 errors / ≤ 10 warnings; build with the 2 known warnings; the template valid.

- [ ] **Step 2: Dev, then test**

```bash
git fetch origin dev test && git merge-tree --write-tree origin/dev HEAD >/dev/null && git push origin HEAD:dev
```
Say: "pushed `<sha>` to `dev`; the dev pipeline is deploying it." Then, per the owner's standing instruction, promote to test: `git checkout -B promote-test origin/test && git merge --no-ff <sha> -m "Merge branch 'dev' into test" && git push origin promote-test:test && git checkout - && git branch -D promote-test`. Say both commits and both tiers. Watch each tier's `bundle.js` `Last-Modified` header move (≈ 17–20 minutes) and probe `GET <api>/admin/moderation` unauthenticated → `401` (was `404`).

- [ ] **Step 3: The drive (spec §13), on dev, then the same on test**

As `qa-host-a` (an org admin) and as staff in platform mode:
1. Share a set with one deliberately violent question → the queue (Moderation) shows it with "N uncertain questions" and how long it waited; Review shows that question first with its band word and sentence.
2. **Reject** with a note → the author's editor (`06`) shows the note leading the banner; the row says "Needs changes".
3. Resubmit after editing → passes → "Public v2"; **or** share a second uncertain set and **Approve** → the row says "Public v1", and the org's Public library lists it "by <org>"; as `qa-host-b`, **Copy to my team** works and **Preview** opens it read-only.
4. Platform Public library → the row → **Score card** shows "approved by <you>, <date>" and the timeline; **Take down** with a note → gone for everyone; `qa-host-a`'s editor shows the note; the score card 404s; the org row reads "Needs changes".
5. Two browser tabs on the same queue item → decide in one → the other's Approve answers "Already decided by <you>" and the list refreshes.

Record the set ids and what you saw. Anything that does not match is a bug in this plan's code, not in the drive.

---

## Self-review notes (run by the author of this plan)

- **Spec coverage, Stage 2 (§1):** the queue (§6.1 list → Task 2; §10.5 table → Task 9), the decision (§6.1 approve/reject, conditional → Task 4), the snapshot (§3.3 read/delete → Task 1; opened → Task 3), takedown (§5.2 → Task 5, D11 pinned), the score card (§10.5 → Task 10 for public sets; queued sets are reviewed in the modal — the card's reports and access rows are Stages 3 and 5), the staff public library (§10.4 → Tasks 11–12 with Unpublish), the org public library (§10.4 → Tasks 11–12 with Preview / Copy; Report is Stage 3), routes and the authorizer (§9 → Task 7), projections the screens need (Task 6), edge cases (§11: the conditional decide, approve after deletion — the snapshot is self-contained and the stamp conditional; the stale-stamp takedown), testing (§12: `moderation-queue` decide branches → Task 4; `takedown.js` with the 200 × 5 fixture → Task 5; `authorizer-*` slug traps → Task 7; palettes and `scopedClassesDeclared` → Tasks 9–11; `adminOneSection` → Task 12), rollout (§13 → Task 13). **Deliberately later:** dismiss / take-down-from-queue / keep-with-a-notice (reported rows, Stage 3); the notice picker on approve and the notice editor on the card (Stage 4 — `decide` already accepts and stores `notice` ids so Stage 4 is a UI change); the access-log write on open (Stage 5 — seam marked in Task 3).
- **Placeholder scan:** none; where a task depends on reading a real shape (`readReviewLog`'s event field, `unpublishSet`'s stamp write, `mounted()`'s registry) the step names the file and what to do with what it finds.
- **Type consistency:** the queue `sk` shapes (Tasks 2–4, 7) are `shared/moderation-queue.js`'s; `POINTER_FIELDS` names (`orgName`, `title`, `uncertainQuestionIds`, `appealMessage`, `reports`, `snapshotKey`, `publicSetId`) are used identically in Tasks 2, 3, 8, 9; the decide body `{ sk, decision, note, notice }` matches Tasks 4 and 9; the card payload of Task 5 matches Task 10's fixture field for field; `rowActions(set)` (Task 11) is what Task 12 mounts; `sourceOrgName` / `sensitivity` (Task 6) are what Tasks 10–11 read.
