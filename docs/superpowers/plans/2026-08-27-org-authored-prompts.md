# Org-authored Workies — wiring `prompt-access.js` to the two handlers that need it

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Date:** 2026-08-27
**Status:** proposed. **No code has been changed by this plan.**
**Spec (binding):** [`docs/superpowers/specs/2026-08-25-public-library-design.md`](../specs/2026-08-25-public-library-design.md) — D2, §3, §6a.
**Handoff:** [`docs/handoff/public-library-2026-08-27.md`](../../handoff/public-library-2026-08-27.md) — §1 rules 1 and 5, §2, §3 item 1, §5.
**Branch at time of writing:** `working/engagements-multitenant-saas-832f3f`, base `b74ad1e9`.

**Goal.** `lambda-functions/admin/shared/prompt-access.js` is complete and tested and **nothing calls it**. `create-ai-prompt.js` still writes to the bare `AIPROMPTS` partition, so an organisation cannot author a Workie at all. This plan wires the two handlers that together make an org Workie *writable and then visible*: create, and list. Both, in one change — a new org prompt written into `ORG#<org>#AIPROMPTS` is invisible the moment it is written if the list still runs one Query on `PK = 'AIPROMPTS'`.

**Explicitly NOT in this plan:** `update-ai-prompt.js`, `delete-ai-prompt.js`, publishing a prompt, the resolver (`game/get-ai-summary.js`), `ai-prompt-advisor.js`, `export-to-archive.js`, any UI, any `src/` change. Those are handoff §3 items 2–4 and stay there.

---

## 0. The five facts this plan is built on, each verified today

**F1 — `prompt-access.js` is already correct and already tested.** `tests/prompt-scoping.js` is **20 passed, 0 failed** and covers the key shapes, the S3 body key, `createPromptRef`'s four branches, `canManagePrompt`, and `findPromptForCaller`'s read guard. This plan adds no logic to that module and changes none of it. It calls it.

**F2 — every existing caller of `create-ai-prompt.handler` in the suite passes an event with no `requestContext` at all.** `tests/ai-prompt-lifecycle.js:167` — `const post = (body) => createPrompt.handler({ body: JSON.stringify(body) })`. Same in `tests/ai-prompt-status-update.js:201` and `tests/prompt-variable-gates.js:184`. No groups and no org is `createPromptRef`'s **internal seam**, which returns platform. So every existing prompt suite keeps writing to `PK = 'AIPROMPTS'` and stays green. That is not luck — it is the seam doing exactly the job its comment claims.

**F3 — `ENCRYPTED_FIELDS` has no `prompt` entity, and `fieldsFor` throws on an unknown one.** `lambda-functions/admin/shared/tenant-crypto.js:518-527`. So `encryptItem(orgId, 'prompt', item)` throws *today*. The spec requires the entity (§3: "`ENCRYPTED_FIELDS` gains a `prompt` entity"); adding it is three byte-identical file edits plus the drift guard at `tests/tenant-crypto.js:493-509`.

**F4 — neither Lambda has any KMS grant.** `AdminCreateAIPromptFunction` (`template-clean.yaml:3662-3695`, `Policies` at `:3673-3677`) and `AdminGetAIPromptsFunction` (`:3606-3632`, `Policies` at `:3617-3621`) carry only `DynamoDBCrudPolicy` and `S3CrudPolicy`. `tests/kms-grants-match-code.js` walks the require graph and will go red the moment either handler requires `tenant-crypto`, and only then — it ignores functions that do not reach it. That is the guard, and it is why the code edit comes *before* the template edit in Tasks 6 and 7.

**F5 — `POST /admin/ai-prompts` is admins-only, deliberately, and that blocks the whole feature.** `lambda-functions/auth/authorizer.js` lists `'GET admin/ai-prompts'` in `HOST_ADMIN_ROUTES` (`:300`) and **not** the POST. Its comment at `:277-280` says why: *"NOT included: the prompt LIBRARY writes … Those shape what the AI does for everybody, and they stay Engage's."* A host in an org is therefore refused by the authorizer before `create-ai-prompt.js` ever runs. **This is a genuine conflict between the approved spec and a documented deliberate decision, and it is the owner's to rule on.** Task 8 carries the change and is gated on that ruling; Tasks 1–7 and 9 do not depend on it.

---

## Global Constraints

- **Never deploy from this plan.** Tasks 6, 7 and 8 change `template-clean.yaml` / `authorizer.js`, which are deploy-bearing. The plan stops at a green suite; deployment is a separate decision under CLAUDE.md's rules.
- **Do not modify `lambda-functions/admin/shared/prompt-access.js`.** It is the proven reference and `tests/prompt-scoping.js` is its regression guard. If a task seems to need a change there, stop and ask — two of the divergences in §4 below are candidates, and both are the owner's call.
- **Do not modify `lambda-functions/admin/shared/tenant.js`.** `promptsMetadataPk`, `personasPk` and `canManageScope` are already correct. Six copies would have to change in step (three bundles × two files) and nothing here needs it.
- **Never write a partition-key literal.** `tenant.js:1-10`: *"Nothing else in the codebase may write a `'SETS'` or `'GAMES'` literal."* Every new partition key in this plan comes from `promptKey(ref).PK`. **The two exceptions are deliberate and stay literal:** the `isDefault` sweep and the `GAMETYPE#…#CATEGORY#…` pointer in `create-ai-prompt.js`, which are platform-only by decision (spec §6a) — see Task 2.
- **Out of scope, do not touch:** `update-ai-prompt.js`, `delete-ai-prompt.js`, `get-ai-summary.js`, `ai-prompt-advisor.js`, `export-to-archive.js`, `import-from-archive.js`, `get-personas.js`, `migrate-ai-prompts.js`, `populate-*.js`, anything under `src/`.
- **Backend test baseline, measured on this worktree today: 102 suites, 3265 passed, 0 failed.** Command:
  ```bash
  for t in tests/*.js; do case "$t" in *.spec.js) continue;; esac; node "$t"; done 2>&1 \
    | grep -E '^[0-9]+ passed' | awk '{p+=$1; f+=$3; n++} END {print n" suites, "p" passed, "f" failed"}'
  ```
  Aggregate with `grep -E '^[0-9]+ passed'`, never `tail -1`.
- **Per-suite baselines for every suite this plan touches or risks:**
  | Suite | Now |
  |---|---|
  | `tests/prompt-scoping.js` | 20 passed, 0 failed |
  | `tests/ai-prompt-lifecycle.js` | 29 passed, 0 failed |
  | `tests/ai-prompt-status-update.js` | 22 passed, 0 failed |
  | `tests/prompt-variable-gates.js` | 31 passed, 0 failed |
  | `tests/prompt-save-guards.js` | 10 passed, 0 failed |
  | `tests/kms-grants-match-code.js` | 111 passed, 0 failed |
  | `tests/tenant-crypto.js` | 83 passed, 0 failed |
  | `tests/tenant-crypto-wiring.js` | 32 passed, 0 failed |
- **The 11 `tests/*.spec.js` files are Playwright** and cannot run under plain `node`. Excluded from the baseline. Do not "fix" them.
- **No `src/` change, so the frontend suite must be untouched.** Handoff §5's figures (189 suites / 4720 tests) are the reference; do not re-run it per task, only in Task 9.
- **Every test is watched failing first.** Handoff §5: *"a green test that was never seen red proves nothing about the thing it names."* Every task below has an explicit Step 2 with the **exact expected failure text**. If the red you get does not match the red the step predicts, the test is not testing what it names — fix the test, not the expectation.
- **House test style.** `tests/*.js` are standalone node scripts with their own `check()` harness, run as `node tests/<file>.js`, ending with `console.log(\`\n${pass} passed, ${fail} failed\`)` and `process.exit(fail ? 1 : 0)`. There is no jest for the backend. Every new assertion carries a `// rejects:` comment naming the implementation change it would catch; if the answer is "nothing", the test is not written.
- **Commit after every task.** Conventional-commit subject with a leading emoji, matching repo style. End every commit message with:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- **`node_modules` in this worktree may be symlinks to the main checkout.** Do not run `npm install` anywhere in this worktree.

---

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `tests/org-authored-prompts.js` | The two real handlers driven end to end against stubbed AWS: where a new Workie lands, who is refused, what the list returns across scopes, and what is ciphertext at rest. |

**Modified:**

| File | Change | Task |
|---|---|---|
| `lambda-functions/admin/create-ai-prompt.js` | Scope resolution, orgless refusal, scoped PK, owner stamp, `isDefault` refusal, scoped S3 key, provenance, org encryption | 1, 2, 3, 6 |
| `lambda-functions/admin/get-ai-prompts.js` | One Query per readable scope, merged and ordered, `scope`/`orgId` projected, org decryption | 4, 7 |
| `lambda-functions/admin/shared/tenant-crypto.js` | `ENCRYPTED_FIELDS.prompt` | 5 |
| `lambda-functions/game/tenant-crypto.js` | byte-identical copy of the above | 5 |
| `lambda-functions/websocket/tenant-crypto.js` | byte-identical copy of the above | 5 |
| `tests/tenant-crypto.js` | the `prompt` entity's "exactly the agreed set" assertion | 5 |
| `template-clean.yaml` | `kms:Decrypt` on `AdminCreateAIPromptFunction` and `AdminGetAIPromptsFunction` | 6, 7 |
| `lambda-functions/auth/authorizer.js` | `POST admin/ai-prompts` reachable by hosts — **OWNER RULING REQUIRED** | 8 |

**Deliberately NOT modified — and each absence is a decision, not an omission:**

| File | Why it stays as it is |
|---|---|
| `lambda-functions/admin/shared/prompt-access.js` | complete and tested (F1). This plan calls it. |
| `lambda-functions/admin/shared/tenant.js` | `promptsMetadataPk` / `personasPk` already say the right thing. |
| `lambda-functions/game/get-ai-summary.js` | The resolver. `:398`'s Scan is `FilterExpression: 'PK = :pk'` with `:pk = 'AIPROMPTS'`, and it **must keep working untouched** — spec §6a. Task 2 is what guarantees an org row can never appear in its result. |
| `tests/prompt-scoping.js` | the module contract. See §3 for why the new tests are a new file. |

---

## 1. Why a new test file and not an extension of `tests/prompt-scoping.js`

`tests/prompt-scoping.js` requires `prompt-access.js` **directly**, at module top, with no `Module._load` interception and no AWS stubs. It is a pure module contract: 20 assertions about key shapes and access rules, none of which loads a handler.

Driving `create-ai-prompt.handler` requires the stub apparatus to be installed **before any handler loads** (`tests/ai-prompt-lifecycle.js:29-35` explains why: several `@aws-sdk` packages cannot be resolved from the repo root at all, so `require.cache` poisoning silently misses and `Module._load` interception by request name is the only thing that works). Bolting that onto `prompt-scoping.js` would put a load-order constraint on a file that currently has none, and would make a failure in the stub apparatus look like a failure of the access module.

The repo already makes exactly this split and says why: `tests/tenant-crypto.js` proves the module, `tests/tenant-crypto-wiring.js` drives the handlers, and the latter's header states the reason — *"Every one of those assertions stays green while not a single handler calls it. This file is the other half."* That is precisely the situation here: `prompt-scoping.js` is 20 green assertions about a module nothing calls.

**So: `tests/org-authored-prompts.js`, new, modelled on `tests/ai-prompt-lifecycle.js`'s stub block (DynamoDB + in-memory S3) with `tests/tenant-crypto-wiring.js`'s KMS stub added for Tasks 6–7. `tests/prompt-scoping.js` is not edited by any task in this plan.**

---

## 2. The seven hazards, and what this plan does about each

Each is a way to ship something that looks right.

### H1 — the `isDefault` sweep (`create-ai-prompt.js:246-315`)

**The hazard.** The block queries `PK = 'AIPROMPTS'`, clears `isDefault` on every other prompt of that game type, and writes a `GAMETYPE#<t>#CATEGORY#<c>` pointer row into the same bare partition. Spec §6a and `tenant.js:114-131` both state: **there is no org-level default prompt**, and the sweep and `get-ai-summary.js:398`'s Scan keeping working untouched *is the point*. An org-scoped prompt marked `isDefault` must neither clear platform defaults nor write that pointer.

**What this plan does: REFUSE the request, `400`, before any write.** Not silent ignore, not store-and-skip.

**Why refuse rather than ignore.** The house rule is written in this very file, at `create-ai-prompt.js:99-101`:

> *"Reject a malformed shape at the door rather than storing something that will be silently ignored at runtime — 'I set it and nothing changed' is the exact complaint this whole area exists to fix."*

A silent ignore is that complaint, restated. Worse, it is *undetectable*: `get-ai-summary.js:398` is a Scan with `PK = :pk` equality against `'AIPROMPTS'`, so an `ORG#x#AIPROMPTS` row carrying `isDefault: true` could never be selected by the resolver no matter what. Storing `true` would put a claim on the row that nothing in the product can honour and that a lister would happily render as a badge.

**Why not store `isDefault: false` silently.** Same objection, one step weaker: the caller asked for something and got no signal.

**What the caller sees:**
```
400
{ "error": "A Workie owned by an organisation cannot be a default. The default Workie for a game type is Engage's house choice; your organisation's Workie is chosen by naming it on a question set." }
```
and **nothing is written** — the refusal returns before the S3 `PutObject`, so there is no orphaned body.

**What stays untouched.** The whole `if (isDefault)` block keeps its four `'AIPROMPTS'` literals verbatim. It can now only be reached when `ref.scope === 'platform'` (public cannot be created — `tenant.canManageScope` returns `false` for `PUBLIC` — and org is refused above), and Task 2 adds a defensive guard that says so in code.

### H2 — `s3Key` is hardcoded to the platform form (`create-ai-prompt.js:149`)

**The hazard.** `const s3Key = \`prompts/${gameType}/${promptId}/v${version}.json\``. Handoff §1 rule 5: *"Scoping a DynamoDB partition does not reach S3… Scoping the partition alone would have left two orgs overwriting each other's Workie text."*

**What this plan does (Task 3):** `const s3Key = promptBodyKey(ref, gameType, version);`. `promptBodyKey` returns `prompts/<gameType>/<id>/v<n>.json` unchanged for platform — zero migration in S3 — and `prompts/org/<orgId>/…` / `prompts/public/…` for the other two. The **scoped key is what is stored on the row**, which is what keeps `update-ai-prompt.js:271`'s "read the stored key rather than rebuilding it" coupling safe when that handler is wired later (spec §6a says this explicitly).

### H3 — `PK: 'AIPROMPTS'` (`create-ai-prompt.js:205`), the S3 `Metadata` block and `metadata.author: 'admin'` (`:182`)

**The hazard.** Handoff §1 rule 1: *"A hard-coded `PK: 'SETS'` is a platform-only read."* The same is true of a write.

**What this plan does:**
- **Task 1:** `PK: promptKey(ref).PK`, and the row gains `...promptOwnerStamp(event, ref)` — `{scope, orgId?, createdBy?}` — which is what `canManagePrompt` reads back off the row.
- **Task 3:** the S3 object's user-`Metadata` gains `scope` and (when present) `orgId`, so an object found in the bucket is attributable without a table lookup, and `promptContent.metadata.author` stops being the constant string `'admin'`.

  `metadata.author: 'admin'` is a **lie the moment a host in an organisation authors a prompt**, and the body is the copy that travels: it is what `get-ai-prompts?includeContent=true` returns, what `export-to-archive.js` copies wholesale, and what a published Workie would carry. Verified that **nothing in `lambda-functions/` or `src/` reads `metadata.author`** — `grep -rn "metadata\.author" lambda-functions src/src` returns nothing — so replacing its value is additive in practice.

### H4 — a host with no organisation must be REFUSED, not defaulted

**The hazard.** `createPromptRef` returns `null` for a real host (groups present) with no `orgId`. Today every failure in this handler falls into one `catch` and returns `500 {error: 'Failed to create AI prompt', message}`, which is indistinguishable from a Bedrock outage.

**The sets precedent, matched exactly.** `upload-questions.js:700-709`:
```js
targetRef = createSetRef(event, setId, requestedScope(event));
if (!targetRef) {
  return {
    statusCode: 403,
    body: JSON.stringify({ error: 'Choose an organisation before creating a question set.' }),
    headers: { 'Access-Control-Allow-Origin': '*' }
  };
}
```
**403, same structure, noun changed:**
```
403
{ "error": "Choose an organisation before creating a Workie." }
```
"Workie" is the product's own noun for this object and is already user-facing (`AdminPage.jsx:82`, `:1588`; `HostRemote.jsx:801`). `tenant.requireOrg` returns a third wording (`'Choose an organisation before doing this.'`) — the `upload-questions` wording is the closer match because this is the same act, creating a thing.

`403` and not `400`: the request is well-formed; the caller is standing in the wrong place.

### H5 — `get-ai-prompts.js` does ONE Query on `PK = 'AIPROMPTS'` (`:45-52`)

Four sub-questions, all resolved in Task 4.

**Ordering.** `readablePromptRefs(event, '')` already encodes the rank and the reason — org (0), platform (1), public (2), *"so a team's own Workie wins a name it shares with Engage's… your own content is what you meant."* The merged list is sorted **by scope rank first, then `updatedAt` descending within each block**, replacing the flat `updatedAt` sort at `:171`. For a caller with no organisation the refs are `[platform, public]` and there are zero public prompt rows in any tier today, so **the ordering is byte-identical to today's for every current caller** — this is a correct-tomorrow change with no behaviour change now. Rejected: keeping the flat `updatedAt` sort, which interleaves a team's four Workies with Engage's twenty-two and makes "ours" unfindable in exactly the surface built to show them.

**De-duplication: none. Deliberately.** `get-question-sets.js:70-78` — the multi-scope list that already shipped — does not de-duplicate either; it returns every row from every readable partition and projects `scope` and `orgId` on each so the client can tell them apart. Two further reasons here: `generatePromptId()` is `Date.now().toString(36) + random`, so a natural collision is not a thing that happens; and the only way the same `promptId` *can* land in two partitions is publishing (handoff §3 item 3, out of scope), where seeing both the org original and the public copy is the correct answer, not a duplicate to hide. **Consequence to carry forward to the UI stage:** `PromptLibraryPanel.jsx:551` renders `<tr key={prompt.promptId || prompt.name}>`, which would produce a duplicate React key the day publishing lands. Noted in §4; not fixed here, because no `src/` change is in scope and nothing can produce the collision yet.

**The response must carry `scope` and `orgId`.** Otherwise a client holding `promptId` alone cannot address the row — `teamretro` in an org and `teamretro` on the platform are two prompts, and `update-ai-prompt.js` will need the pair. Projected on every row, **derived from the `ref` that named the partition**, never inferred by the client. (`get-question-sets.js:77` prefers the row's own `scope` attribute with the ref as fallback; prompts take the ref directly because the partition cannot disagree with itself, and because `promptOwnerStamp` writes `scope` unconditionally so there is no legacy-absence case where the row is the more informative of the two. See §4 for the divergence this exposes.)

**The filters.** Confirmed by reading the code:
- `category` and `status` are pushed into a `FilterExpression`, which is **per-`QueryCommand`**, so it applies correctly to each partition on its own — provided each Query gets its **own** input object. **The current code mutates one shared `dynamoQuery.ExpressionAttributeValues[':pk']`; reusing that object across a `Promise.all` and reassigning `:pk` between sends is a real race in which all N queries can read the last `:pk` written.** Task 4 replaces it with a `buildQuery(pk)` function that returns a fresh object per ref. This is the single most likely way to implement Task 4 wrongly.
- `gameType` and `promptType` are JS filters over the array (`:79-94`) and are order-independent, so they run **after** the merge, once, exactly as today.
- `begins_with(SK, 'AIPROMPT#')` is unchanged and is what keeps personas and pointer rows out — see H7.

### H6 — encryption

**Determined, not guessed.** Three things checked:

1. **The sets precedent encrypts.** `upload-questions.js` calls `encryptItem(orgId, 'set', …)` for org-scoped writes; `get-question-sets.js:55-60` decrypts **per scope**, gated on `ref.scope !== ORG || !ref.orgId`, with the comment *"Platform and public rows are left alone: they were never encrypted."*
2. **The spec requires it, twice.** §3: *"**Org prompts are encrypted** for the same reason org sets are; platform and public prompts are not. `ENCRYPTED_FIELDS` gains a `prompt` entity."* §6a: *"the S3 key gains the scope prefix, **and org bodies are encrypted before `PutObject`**"*, with the reasoning that `ENCRYPTED_FIELDS` alone would encrypt the row and leave the text in the clear.
3. **It does not exist yet.** `ENCRYPTED_FIELDS` has no `prompt` key (F3), and neither Lambda has `kms:Decrypt` (F4).

**So: yes, both the row and the S3 body, for org scope only.** The helpers, named exactly:

| What | Helper | Where |
|---|---|---|
| the DynamoDB row | `encryptItem(orgId, 'prompt', dynamoItem)` | `create-ai-prompt.js`, Task 6 |
| the S3 body | `encryptValue(orgId, promptContent)` → `JSON.stringify(envelope)` as the `Body` | `create-ai-prompt.js`, Task 6 |
| the row, on read | `decryptItem(ref.orgId, 'prompt', item)` per org partition | `get-ai-prompts.js`, Task 7 |
| the body, on read | `decryptValue(ref.orgId, JSON.parse(text))` | `get-ai-prompts.js`, Task 7 |

`decryptValue`'s passthrough rule (`tenant-crypto.js:499-500`) means a body that is a plain document — every platform body that exists — passes through untouched, so the reader needs no branch on scope for the *body*; it needs one only to know which `orgId` to name.

**The cost, stated plainly, because it exceeds the two-handler scope:** three byte-identical `tenant-crypto.js` copies plus the drift guard, and two `Policies` blocks in `template-clean.yaml`. **Tasks 5, 6 and 7 are separable as a unit** — if the owner cuts them, Tasks 1–4 and 8–9 still ship and are correct; the only loss is that an org's Workie prose sits readable at rest until they land, and `decryptValue`'s passthrough makes switching it on later free.

**What encryption cannot break.** Every other prompt reader — `ai-prompt-advisor.js:154`, `update-ai-prompt.js:109`, `delete-ai-prompt.js:30`, `export-to-archive.js:258,375`, `get-ai-summary.js:281,315` — reads `PK: 'AIPROMPTS'` hard-coded, so none of them can reach an org row at all and none can meet an envelope. The blast radius is exactly the two handlers in this plan.

### H7 — personas and the default-pointer rows stay platform-only ON PURPOSE

Confirmed, three ways, and nothing in this plan disturbs any of them:

- **`tenant.personasPk()` is not called by either handler.** `grep -n "personasPk" lambda-functions/admin/create-ai-prompt.js lambda-functions/admin/get-ai-prompts.js` returns nothing before and after this plan. Personas are read by `get-personas.js:74` (`':pk': 'AIPROMPTS'`, `':sk': 'PERSONA#'`), which this plan does not touch.
- **The `GAMETYPE#…#CATEGORY#…` pointer keeps its literal partition.** Task 2 leaves `create-ai-prompt.js:296-308` byte-identical and adds a guard so the block is unreachable for a non-platform scope.
- **`get-ai-summary.js:394-401`'s Scan still works.** It is `FilterExpression: 'PK = :pk AND isDefault = :isDefault'` with `':pk': 'AIPROMPTS'`. Two independent reasons it is unaffected: an org prompt lands in a different `PK` and can never match the equality; and Task 2 refuses `isDefault` for org scope outright, so no org row can ever carry `isDefault: true` in the first place. **Task 2 asserts the second of those directly** — see its Step 1, case *"an org prompt row never carries isDefault: true"*.
- **The list keeps `begins_with(SK, 'AIPROMPT#')`**, so no persona row and no pointer row can enter the merged result even though the platform partition holds all three shapes.

---

## 3. Order of work

| # | Task | Files | Ships alone? |
|---|---|---|---|
| 1 | Where a new Workie goes, and who is refused | `create-ai-prompt.js`, new test | yes |
| 2 | `isDefault` is refused for an org; the sweep stays platform-only | `create-ai-prompt.js`, test | after 1 |
| 3 | The body lands at a scoped S3 key, and says whose it is | `create-ai-prompt.js`, test | after 1 |
| 4 | The list reads every scope the caller may read | `get-ai-prompts.js`, test | yes |
| 5 | `ENCRYPTED_FIELDS` gains a `prompt` entity | 3× `tenant-crypto.js`, `tests/tenant-crypto.js` | yes |
| 6 | An org's Workie is ciphertext at rest — row and body | `create-ai-prompt.js`, `template-clean.yaml`, test | after 5 |
| 7 | The list unwraps an org's Workie | `get-ai-prompts.js`, `template-clean.yaml`, test | after 5, 6 |
| 8 | A host may knock on `POST /admin/ai-prompts` — **OWNER RULING** | `authorizer.js`, test | after 1 |
| 9 | Full verification | — | last |

Task 8 is last among the code tasks on purpose: it opens the door, and the room behind it should be right before anyone walks in.

---

### Task 1: Where a new Workie goes, and who is refused

`create-ai-prompt.js` writes `PK: 'AIPROMPTS'` unconditionally, which is a platform-only write (handoff §1 rule 1). This task makes the partition a consequence of who is asking, and makes an orgless host a refusal rather than a silent publication to the shared library.

**Files:**
- Modify: `lambda-functions/admin/create-ai-prompt.js` — imports (after `:8`), the block at `:144-151`, `PK` at `:205`, the item at `:204-237`, the result at `:317-323`
- Create: `tests/org-authored-prompts.js`

**Interfaces:**
- Consumes: `createPromptRef(event, promptId, requestedScope)`, `promptKey(ref)`, `promptOwnerStamp(event, ref)` from `./shared/prompt-access`; `requestedScope(event)` from `./shared/question-set-access`.
- Produces: `201 { promptId, s3Key, version, scope, orgId, status: 'created', message }` — `scope` is `'platform'` or `'org'`, `orgId` is a string or `null`.
- Produces: `403 { error: 'Choose an organisation before creating a Workie.' }` when `createPromptRef` returns `null`.

- [ ] **Step 1: Write the failing test**

Create `tests/org-authored-prompts.js`. The stub block is lifted from `tests/ai-prompt-lifecycle.js:29-141` (`Module._load` by request name, the in-memory DynamoDB `fakeDoc`, the in-memory S3). Write it in full:

```js
/**
 * ORG-AUTHORED WORKIES, END TO END — create-ai-prompt.js and get-ai-prompts.js
 *
 * `admin/shared/prompt-access.js` has been complete and tested since the public
 * library work (tests/prompt-scoping.js, 20 assertions) and NOTHING CALLED IT.
 * `create-ai-prompt.js` wrote `PK: 'AIPROMPTS'` unconditionally, so an
 * organisation could not author a Workie at all.
 *
 * tests/prompt-scoping.js proves the MODULE. Every one of its assertions stays
 * green while not a single handler calls it. This file is the other half: the
 * REAL handlers, driven against stubbed AWS, looking at what is actually in the
 * store afterwards.
 *
 * Stubbing note (from tests/ai-prompt-lifecycle.js:29-35): poisoning
 * require.cache by resolved path silently misses, because several SDK packages
 * these handlers import exist only in the deployed bundle. Intercept
 * Module._load by request NAME instead, before any handler loads.
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
      case 'put': store.set(key(inp.Item.PK, inp.Item.SK), inp.Item); return {};
      case 'get': return { Item: store.get(key(inp.Key.PK, inp.Key.SK)) };
      case 'delete': store.delete(key(inp.Key.PK, inp.Key.SK)); return {};
      case 'update': {
        const k = key(inp.Key.PK, inp.Key.SK);
        const item = store.get(k) || { ...inp.Key };
        const names = inp.ExpressionAttributeNames || {};
        const values = inp.ExpressionAttributeValues || {};
        for (const clause of String(inp.UpdateExpression || '').replace(/^SET /, '').split(',')) {
          const m = clause.trim().match(/^(#?[\w.]+)\s*=\s*(.+)$/);
          if (!m) continue;
          const attr = names[m[1]] || m[1];
          if (m[2].trim().startsWith(':')) item[attr] = values[m[2].trim()];
        }
        store.set(k, item);
        return { Attributes: item };
      }
      case 'query': {
        const v = inp.ExpressionAttributeValues || {};
        const items = [...store.values()].filter((i) =>
          i.PK === v[':pk'] && String(i.SK).startsWith(String(v[':sk'] ?? '')));
        return { Items: items, Count: items.length };
      }
      default: return { Items: [], Count: 0 };
    }
  },
};

stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => fakeDoc },
  GetCommand, PutCommand, QueryCommand, UpdateCommand, DeleteCommand, ScanCommand,
});

// ---- in-memory S3 ----------------------------------------------------------
const s3Store = new Map();     // key -> Body string
const s3Meta = new Map();      // key -> the Metadata block the handler sent
stub('@aws-sdk/client-s3', {
  S3Client: class {
    async send(cmd) {
      if (cmd.type === 'put') {
        s3Store.set(cmd.input.Key, cmd.input.Body);
        s3Meta.set(cmd.input.Key, cmd.input.Metadata || {});
        return {};
      }
      if (cmd.type === 'get') {
        const body = s3Store.get(cmd.input.Key);
        if (!body) { const e = new Error('NoSuchKey'); e.name = 'NoSuchKey'; throw e; }
        return { Body: { transformToString: async () => body } };
      }
      if (cmd.type === 'list') return { Contents: [] };
      return {};
    }
  },
  PutObjectCommand: class { constructor(i) { this.input = i; this.type = 'put'; } },
  GetObjectCommand: class { constructor(i) { this.input = i; this.type = 'get'; } },
  DeleteObjectCommand: class { constructor(i) { this.input = i; this.type = 'delete'; } },
  DeleteObjectsCommand: class { constructor(i) { this.input = i; this.type = 'deleteMany'; } },
  ListObjectsV2Command: class { constructor(i) { this.input = i; this.type = 'list'; } },
});

process.env.TABLE_NAME = 'test-table';
process.env.AI_PROMPTS_BUCKET = 'test-bucket';

const admin = (f) => require(path.join(REPO, 'lambda-functions', 'admin', f));
const createPrompt = admin('create-ai-prompt.js');
const getPrompts = admin('get-ai-prompts.js');

if (!process.env.DEBUG) { console.log = () => {}; console.warn = () => {}; console.error = () => {}; }
const say = (...a) => process.stdout.write(a.join(' ') + '\n');

let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); say(`  PASS  ${label}`); pass++; }
  catch (e) { say(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

// ---- callers, IN THIS API'S REAL SHAPE -------------------------------------
// `requestContext.authorizer.lambda`, groups comma-joined. See require-admin.js.
const ORG = 'org_acme';
const caller = (lambda) => ({ requestContext: { authorizer: { lambda } } });
const HOST = caller({
  userId: 'sub-amara', username: 'amara', groups: 'hosts', status: 'enabled',
  orgId: ORG, orgRole: 'owner', orgIds: ORG,
});
const ORGLESS_HOST = caller({
  userId: 'sub-rob', username: 'rob', groups: 'hosts', status: 'enabled',
});
const STAFF = caller({ userId: 'sub-g', username: 'g', groups: 'admins', status: 'enabled' });
/** No groups and no org: a script, the seed, the suite's own direct calls. */
const INTERNAL = {};

const BODY = {
  name: 'Retro Workie',
  description: 'what the room learned',
  gameType: 'call-and-answer',
  promptType: 'analysis',
  category: 'lessons-learned',
  instructions: 'Summarise the responses.',
  outputFormat: '## Summary\n{responsesText}',
};

const post = (who, body) =>
  createPrompt.handler({ ...who, body: JSON.stringify({ ...BODY, ...body }) });
const parse = (res) => { try { return JSON.parse(res.body); } catch { return {}; } };

(async () => {
  say('\norg-authored Workies\n');

  say('1. where a new Workie goes');

  // rejects: PK: 'AIPROMPTS' staying hard-coded, which writes a customer's
  // Workie into the library every other customer reads.
  store.clear(); s3Store.clear(); s3Meta.clear();
  const orgRes = await post(HOST, {});
  const orgBody = parse(orgRes);
  await check('a host in an org creates a prompt (201)', () =>
    assert.strictEqual(orgRes.statusCode, 201, orgRes.body));
  await check('…and the row lands in the ORG partition', () =>
    assert.ok(store.get(`ORG#${ORG}#AIPROMPTS|AIPROMPT#${orgBody.promptId}`),
      `nothing at ORG#${ORG}#AIPROMPTS — keys present: ${[...store.keys()].join(' | ')}`));
  await check('…and NOT in the platform partition', () =>
    assert.strictEqual(store.get(`AIPROMPTS|AIPROMPT#${orgBody.promptId}`), undefined,
      'the org host wrote into the shared library'));

  // rejects: dropping promptOwnerStamp, which leaves canManagePrompt reading a
  // row that does not say whose it is.
  await check('the row is stamped with scope, orgId and the creator', () => {
    const row = store.get(`ORG#${ORG}#AIPROMPTS|AIPROMPT#${orgBody.promptId}`);
    assert.strictEqual(row.scope, 'org', `scope was ${JSON.stringify(row.scope)}`);
    assert.strictEqual(row.orgId, ORG);
    assert.strictEqual(row.createdBy, 'sub-amara');
  });

  // rejects: a response the client cannot address the new row with. A promptId
  // alone no longer names one partition.
  await check('the response carries the pair, not just the id', () => {
    assert.strictEqual(orgBody.scope, 'org');
    assert.strictEqual(orgBody.orgId, ORG);
  });

  // rejects: Engage staff losing the ability to author house content.
  store.clear(); s3Store.clear(); s3Meta.clear();
  const staffBody = parse(await post(STAFF, {}));
  await check('staff with no org still write PLATFORM, at the bare key', () =>
    assert.ok(store.get(`AIPROMPTS|AIPROMPT#${staffBody.promptId}`),
      `keys present: ${[...store.keys()].join(' | ')}`));

  // rejects: closing the seam every seed script, worker and existing test comes
  // through — see tests/ai-prompt-lifecycle.js, which passes no requestContext.
  store.clear(); s3Store.clear(); s3Meta.clear();
  const internalBody = parse(await post(INTERNAL, {}));
  await check('an internal caller (no groups, no org) still writes platform', () =>
    assert.ok(store.get(`AIPROMPTS|AIPROMPT#${internalBody.promptId}`),
      `keys present: ${[...store.keys()].join(' | ')}`));

  say('\n2. who is refused');

  /*
    A REAL host with no organisation is REFUSED rather than defaulted. This is
    the branch that, on the sets side, silently published every customer's
    generated content to the shared library for weeks.
  */
  // rejects: defaulting an orgless host to platform; and returning the generic
  // 500 that every other failure in this handler returns.
  store.clear(); s3Store.clear(); s3Meta.clear();
  const refused = await post(ORGLESS_HOST, {});
  await check('an orgless host is refused with 403, not 500 and not 201', () =>
    assert.strictEqual(refused.statusCode, 403, refused.body));
  await check('…with the sets wording, noun changed', () =>
    assert.strictEqual(parse(refused).error,
      'Choose an organisation before creating a Workie.'));
  await check('…and nothing was written to DynamoDB', () =>
    assert.strictEqual(store.size, 0, `wrote ${[...store.keys()].join(' | ')}`));
  await check('…and no orphan body was left in S3', () =>
    assert.strictEqual(s3Store.size, 0, `wrote ${[...s3Store.keys()].join(' | ')}`));

  // rejects: `?scope=platform` from an org host being an escalation rather than
  // a refusal.
  store.clear(); s3Store.clear(); s3Meta.clear();
  const escalation = await createPrompt.handler({
    ...HOST, body: JSON.stringify({ ...BODY, scope: 'platform' }),
  });
  await check('an org host asking for platform is refused', () =>
    assert.strictEqual(escalation.statusCode, 403, escalation.body));
  await check('…and wrote nothing', () =>
    assert.strictEqual(store.size, 0, `wrote ${[...store.keys()].join(' | ')}`));

  say(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/org-authored-prompts.js`

Expected — **six FAIL lines, and their exact shapes matter**:
- `…and the row lands in the ORG partition` → `nothing at ORG#org_acme#AIPROMPTS — keys present: AIPROMPTS|AIPROMPT#…`
- `…and NOT in the platform partition` → `the org host wrote into the shared library`
- `the row is stamped with scope, orgId and the creator` → `scope was undefined`
- `the response carries the pair, not just the id` → `undefined !== 'org'`
- `an orgless host is refused with 403, not 500 and not 201` → `201 !== 403`
- `…with the sets wording, noun changed` → `undefined !== 'Choose an organisation before creating a Workie.'`
- `an org host asking for platform is refused` → `201 !== 403`

If instead the run dies with a `require` error, the stub block is loading after a handler — check that every `stub(...)` call precedes the `admin(...)` requires.

- [ ] **Step 3: Write minimal implementation**

In `lambda-functions/admin/create-ai-prompt.js`, after the import at `:8`:

```js
const {
  createPromptRef, promptKey, promptOwnerStamp,
} = require('./shared/prompt-access');
const { requestedScope } = require('./shared/question-set-access');
```

`requestedScope` lives in `question-set-access.js` and is generic — it reads `scope` from the query string, the path or the body. `upload-questions.js:700` imports it from the same place for the same purpose; there is one parser, not two.

Immediately after `const version = 1;` at `:146`, and **before** `const s3Key = …` at `:149`:

```js
    /*
      WHICH LIBRARY DOES THIS WORKIE GO IN?

      `createPromptRef` has the rule and the reasoning (shared/prompt-access.js):
      an acting organisation wins; Engage staff with no org selected are
      maintaining the house library; a script or worker with no groups and no
      org keeps writing platform, which is the seam every seed and every
      existing test in tests/ai-prompt-lifecycle.js comes through.

      It returns null for a REAL host with no organisation, and this refuses
      rather than defaulting — silently writing a customer's Workie into the
      library every other customer reads is the exact failure tenant.js exists
      to prevent. Same status and same sentence as the sets side
      (upload-questions.js:700-709), noun changed.
    */
    const ref = createPromptRef(event, promptId, requestedScope(event));
    if (!ref) {
      return {
        statusCode: 403,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Methods': 'POST, OPTIONS'
        },
        body: JSON.stringify({ error: 'Choose an organisation before creating a Workie.' })
      };
    }
    const promptStamp = promptOwnerStamp(event, ref);
```

Replace `PK: 'AIPROMPTS',` at `:205` with:

```js
      PK: promptKey(ref).PK,
```

and add the stamp to the same item, immediately after the `updatedAt: timestamp` line at `:231` (inside the object, before the closing brace and its `ttl` comment):

```js
      updatedAt: timestamp,
      // WHOSE WORKIE THIS IS — scope, org and creator, written together.
      // `canManagePrompt` reads all three back OFF THE ROW, so a row that does
      // not carry them cannot be managed by anybody.
      ...promptStamp,
```

Replace the `result` object at `:317-323`:

```js
    const result = {
      promptId,
      s3Key,
      version,
      // THE OTHER HALF OF THE REFERENCE. A promptId alone no longer names one
      // partition, so the client must round-trip the pair.
      scope: ref.scope,
      orgId: ref.orgId || null,
      status: 'created',
      message: 'AI prompt created successfully'
    };
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node tests/org-authored-prompts.js | tail -2
node tests/ai-prompt-lifecycle.js | tail -2
node tests/ai-prompt-status-update.js | tail -2
node tests/prompt-variable-gates.js | tail -2
node tests/prompt-save-guards.js | tail -2
node tests/prompt-scoping.js | tail -2
```
Expected: `13 passed, 0 failed` · `29 passed, 0 failed` · `22 passed, 0 failed` · `31 passed, 0 failed` · `10 passed, 0 failed` · `20 passed, 0 failed`.

The four existing prompt suites must be **unchanged**, not merely green. They all call the handler with no `requestContext`, which is the internal seam, so they keep writing to `AIPROMPTS` — that is F2, asserted.

- [ ] **Step 5: Commit**

```bash
git add lambda-functions/admin/create-ai-prompt.js tests/org-authored-prompts.js
git commit -m "$(cat <<'EOF'
✨ A Workie is created in the caller's library, not always Engage's

`prompt-access.js` has been complete and tested since the public-library
work and nothing called it. `create-ai-prompt.js` wrote `PK: 'AIPROMPTS'`
unconditionally — a platform-only write — so an organisation could not
author a Workie at all.

The partition is now a consequence of who is asking: `createPromptRef`
gives an org host their own library, gives Engage staff with no active
org the house one, and keeps the internal seam (no groups, no org) on
platform, which is how every seed script and every existing prompt test
still writes where it always did.

A REAL host with no organisation is refused with 403 and the sets
sentence rather than defaulted to platform. Defaulting is the branch
that silently published customers' generated sets to the shared library
for weeks.

The row carries scope/orgId/createdBy because `canManagePrompt` reads
them back off the row, and the response carries the scope pair because a
promptId alone no longer names one partition.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `isDefault` is refused for an org, and the sweep stays platform-only

Spec §6a: *"there is no org-level default … `create-ai-prompt.js:257`'s sweep and `get-ai-summary.js:366`'s Scan both keep working unchanged, which is the point."* This task makes that true in code rather than by luck, and makes the caller see the rule instead of a silent no-op.

**Files:**
- Modify: `lambda-functions/admin/create-ai-prompt.js` — a refusal after the `ref` block from Task 1; a guard on `:246`
- Test: `tests/org-authored-prompts.js` (append section 3)

**Interfaces:**
- Produces: `400 { error: "A Workie owned by an organisation cannot be a default. The default Workie for a game type is Engage's house choice; your organisation's Workie is chosen by naming it on a question set." }` when `ref.scope !== 'platform'` and `isDefault` is truthy. Nothing is written.
- Unchanged: the four `'AIPROMPTS'` literals at `:261`, `:279`, `:299` and the `GAMETYPE#${gameType}#CATEGORY#${category}` SK at `:295`.

- [ ] **Step 1: Write the failing test**

Append to `tests/org-authored-prompts.js`, immediately before the final `say(\`\n${pass} passed…\`)`:

```js
  say('\n3. there is no org-level default');

  /*
    The bare AIPROMPTS partition holds three row shapes and only prompts move.
    The GAMETYPE#…#CATEGORY#… pointer answers "what does Engage use when a set
    names nothing", which is a house decision by definition, and
    get-ai-summary.js's findDefaultPromptId is a SCAN with `PK = :pk` equality
    against 'AIPROMPTS' — an ORG# row could never match it however it were
    stamped. So a stored `isDefault: true` on an org row would be a claim
    nothing in the product can honour.

    The house rule for that is written in this very handler, at
    create-ai-prompt.js:99-101: reject at the door rather than storing something
    that will be silently ignored at runtime.
  */
  // rejects: silently ignoring isDefault, which is "I set it and nothing
  // changed" — the exact complaint this area exists to fix.
  store.clear(); s3Store.clear(); s3Meta.clear();
  const orgDefault = await post(HOST, { isDefault: true });
  await check('an org prompt asking to be the default is refused with 400', () =>
    assert.strictEqual(orgDefault.statusCode, 400, orgDefault.body));
  await check('…and the refusal names the rule', () =>
    assert.match(parse(orgDefault).error, /cannot be a default/));
  await check('…and wrote no row at all', () =>
    assert.strictEqual(store.size, 0, `wrote ${[...store.keys()].join(' | ')}`));
  await check('…and left no orphan body in S3', () =>
    assert.strictEqual(s3Store.size, 0, `wrote ${[...s3Store.keys()].join(' | ')}`));

  // rejects: the sweep clearing a platform default from an org partition, or
  // the GAMETYPE# pointer being written into one.
  store.clear(); s3Store.clear(); s3Meta.clear();
  const houseDefault = parse(await post(STAFF, { isDefault: true }));
  await check('a PLATFORM prompt may still be the default', () =>
    assert.ok(store.get(`AIPROMPTS|AIPROMPT#${houseDefault.promptId}`),
      `keys present: ${[...store.keys()].join(' | ')}`));
  await check('…and its pointer row is in the BARE partition, unchanged', () => {
    const pointers = [...store.values()].filter((i) => String(i.SK).startsWith('GAMETYPE#'));
    assert.strictEqual(pointers.length, 1, `got ${pointers.length} pointer rows`);
    assert.strictEqual(pointers[0].PK, 'AIPROMPTS',
      `the default pointer moved to ${pointers[0].PK} — get-ai-summary's Scan cannot see it there`);
  });

  /*
    THE SCAN'S SAFETY, ASSERTED DIRECTLY. findDefaultPromptId (get-ai-summary.js
    :394-401) filters `PK = 'AIPROMPTS' AND isDefault = true`. Two independent
    things keep an org row out of it, and this asserts the second: no org row
    can carry isDefault: true, because the request is refused.
  */
  // rejects: storing isDefault: true on an org row "harmlessly".
  store.clear(); s3Store.clear(); s3Meta.clear();
  await post(HOST, {});
  await post(HOST, { isDefault: false });
  await check('no org prompt row anywhere carries isDefault: true', () =>
    [...store.values()]
      .filter((i) => String(i.PK).startsWith('ORG#'))
      .forEach((i) => assert.notStrictEqual(i.isDefault, true,
        `${i.PK}/${i.SK} claims a default the resolver can never honour`)));
  await check('no GAMETYPE# pointer was written outside the bare partition', () =>
    [...store.values()]
      .filter((i) => String(i.SK).startsWith('GAMETYPE#'))
      .forEach((i) => assert.strictEqual(i.PK, 'AIPROMPTS', `pointer at ${i.PK}`)));
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/org-authored-prompts.js`

Expected — **four FAIL lines**:
- `an org prompt asking to be the default is refused with 400` → `201 !== 400`
- `…and the refusal names the rule` → `The input did not match the regular expression /cannot be a default/. Input: undefined` (or the create success message)
- `…and wrote no row at all` → `wrote ORG#org_acme#AIPROMPTS|AIPROMPT#… | ORG#org_acme#AIPROMPTS|GAMETYPE#call-and-answer#CATEGORY#lessons-learned`

  **That second key is the bug in one line** — the pointer row landed in the org partition, where `get-ai-summary.js`'s Scan can never see it.
- `…and left no orphan body in S3` → `wrote prompts/org/org_acme/…`

The two platform cases and the last two must already PASS at this point — they are the "nothing else moved" half and must be seen green before the fix as well as after.

- [ ] **Step 3: Write minimal implementation**

In `lambda-functions/admin/create-ai-prompt.js`, immediately after the `const promptStamp = …` line added in Task 1:

```js
    /*
      THERE IS NO ORG-LEVEL DEFAULT, AND THIS REFUSES RATHER THAN IGNORING.

      The bare AIPROMPTS partition holds three row shapes and only prompts move
      (shared/tenant.js:114-131). The GAMETYPE#…#CATEGORY#… pointer below
      answers "what does Engage use when a set names nothing" — a house decision
      by definition — and `findDefaultPromptId` (game/get-ai-summary.js:394) is
      a SCAN with `PK = :pk` equality against 'AIPROMPTS'. An ORG# row can never
      match it, whatever is stamped on it.

      So storing `isDefault: true` on an org row would be a claim nothing in the
      product can honour, and the caller would never find out. That is exactly
      the failure the guard at the top of this file names: "I set it and nothing
      changed". An organisation's Workie is chosen EXPLICITLY by naming it on a
      question set, or it is not used.

      400 and not 403: the caller may create here, they just asked for something
      that does not exist. Returned BEFORE the S3 PutObject so there is no
      orphaned body.
    */
    if (isDefault && ref.scope !== 'platform') {
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Methods': 'POST, OPTIONS'
        },
        body: JSON.stringify({
          error: 'A Workie owned by an organisation cannot be a default. '
            + "The default Workie for a game type is Engage's house choice; "
            + "your organisation's Workie is chosen by naming it on a question set."
        })
      };
    }
```

Then change the sweep's condition at `:246` from `if (isDefault) {` to:

```js
    // `ref.scope === 'platform'` is redundant with the refusal above and is
    // written anyway: this block queries and writes the BARE partition by
    // literal, four times, and a future edit that relaxes the refusal must trip
    // over this line rather than quietly start sweeping the wrong library.
    if (isDefault && ref.scope === 'platform') {
```

**Everything inside that block stays byte-identical**, including the `':pk': 'AIPROMPTS'` at `:261`, the `PK: 'AIPROMPTS'` at `:279` and `:299`, and the `GAMETYPE#${gameType}#CATEGORY#${category}` SK at `:295`. Those four literals are the platform-only decision and are the two exceptions to the no-literals rule.

- [ ] **Step 4: Run tests to verify they pass**

```bash
node tests/org-authored-prompts.js | tail -2
node tests/ai-prompt-lifecycle.js | tail -2
node tests/ai-prompt-defaults.js | tail -2
node tests/ai-prompt-resolution.js | tail -2
```
Expected: `21 passed, 0 failed` for the new suite; the other three unchanged from their baselines.

`tests/ai-prompt-lifecycle.js` is the one that matters most here: its first case creates a prompt with `isDefault: true` through the internal seam and asserts the `GAMETYPE#` pointer row exists with no ttl. If that suite drops a test, the guard was written as `ref.scope === tenant.ORG` (excluding the internal seam by accident) rather than `=== 'platform'`.

- [ ] **Step 5: Commit**

```bash
git add lambda-functions/admin/create-ai-prompt.js tests/org-authored-prompts.js
git commit -m "$(cat <<'EOF'
🚫 An organisation's Workie cannot be a default, and says so

Scoping the prompt partition without this would have written the
GAMETYPE#…#CATEGORY#… default pointer into ORG#<org>#AIPROMPTS, where
`findDefaultPromptId` — a Scan with `PK = 'AIPROMPTS'` equality — can
never see it. The org row would claim a default nothing could honour and
the caller would get a 201.

There is no org-level default by decision (spec §6a): a house default
answers "what does Engage use when a set names nothing", and an
organisation's Workie is chosen explicitly by naming it on a question
set. So the request is refused with 400 and a sentence that says which
rule was hit, before anything is written — no row, no orphan S3 body.

Refused rather than silently ignored because this handler's own guard at
:99 already states the rule: reject a shape at the door rather than
storing something that will be silently ignored at runtime.

The sweep keeps its four bare-partition literals verbatim and gains a
redundant `scope === 'platform'` term, so a future edit that relaxes the
refusal trips over it instead of quietly sweeping the wrong library.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: The body lands at a scoped S3 key, and says whose it is

Handoff §1 rule 5: *"Scoping a DynamoDB partition does not reach S3 … Scoping the partition alone would have left two orgs overwriting each other's Workie text."* `promptBodyKey` is the other half of the fix and this task calls it.

**Files:**
- Modify: `lambda-functions/admin/create-ai-prompt.js` — the import from Task 1, `:149`, `:181-186`, `:195-200`
- Test: `tests/org-authored-prompts.js` (append section 4)

**Interfaces:**
- Consumes: `promptBodyKey(ref, gameType, version)` from `./shared/prompt-access`.
- Produces: `s3Key` of the form `prompts/<gameType>/<id>/v<n>.json` (platform, unchanged) or `prompts/org/<orgId>/<gameType>/<id>/v<n>.json` (org). The **scoped key is stored on the row**, which is what keeps `update-ai-prompt.js:271`'s read-the-stored-key coupling correct later.
- Produces: `promptContent.metadata = { author: <creator sub or 'admin'>, scope, orgId?, createdBy: 'admin-interface', format }`.
- Produces: S3 object user-`Metadata` gains `scope` and, for org scope, `orgId`.

- [ ] **Step 1: Write the failing test**

Append to `tests/org-authored-prompts.js`, before the final report:

```js
  say('\n4. the body is in S3, which the partition does not reach');

  /*
    The prompt TEXT is not in the DynamoDB row — only `s3Key` is. Two orgs whose
    slugs collide would overwrite each other's Workie text, and the row's
    partition scoping does not touch it. Platform keys are unchanged, which is
    what makes this zero migration in S3 as well.
  */
  // rejects: `prompts/${gameType}/${promptId}/v${version}.json` staying
  // hard-coded — the collision, and an org's text in the platform namespace.
  store.clear(); s3Store.clear(); s3Meta.clear();
  const bodyOrg = parse(await post(HOST, {}));
  await check('an org body is written under prompts/org/<orgId>/', () =>
    assert.strictEqual(bodyOrg.s3Key,
      `prompts/org/${ORG}/call-and-answer/${bodyOrg.promptId}/v1.json`,
      `s3Key was ${bodyOrg.s3Key}`));
  await check('…and that is the object that actually exists', () =>
    assert.ok(s3Store.has(bodyOrg.s3Key),
      `objects present: ${[...s3Store.keys()].join(' | ')}`));
  // rejects: storing the platform key on an org row, which would make
  // update-ai-prompt.js (which reads the stored key) rewrite the wrong object.
  await check('…and the ROW stores the scoped key, not a rebuilt one', () => {
    const row = store.get(`ORG#${ORG}#AIPROMPTS|AIPROMPT#${bodyOrg.promptId}`);
    assert.strictEqual(row.s3Key, bodyOrg.s3Key);
  });

  // rejects: changing the platform key shape, which would orphan every body
  // stored since 2025.
  store.clear(); s3Store.clear(); s3Meta.clear();
  const bodyPlatform = parse(await post(STAFF, {}));
  await check('a platform body keeps the path it has always had', () =>
    assert.strictEqual(bodyPlatform.s3Key,
      `prompts/call-and-answer/${bodyPlatform.promptId}/v1.json`,
      `s3Key was ${bodyPlatform.s3Key}`));

  say('\n5. the body says whose it is');

  /*
    `metadata.author` was the constant string 'admin' on every prompt ever
    written. The body is the copy that TRAVELS — it is what includeContent
    returns, what export-to-archive copies wholesale, and what a published
    Workie would carry — so a constant there is a lie that outlives the row.
  */
  // rejects: metadata.author staying the constant 'admin' for a host-authored
  // org Workie.
  store.clear(); s3Store.clear(); s3Meta.clear();
  const stamped = parse(await post(HOST, {}));
  await check('the S3 body names the real author and the library', () => {
    const doc = JSON.parse(s3Store.get(stamped.s3Key));
    assert.strictEqual(doc.metadata.author, 'sub-amara',
      `author was ${JSON.stringify(doc.metadata.author)}`);
    assert.strictEqual(doc.metadata.scope, 'org');
    assert.strictEqual(doc.metadata.orgId, ORG);
  });
  // rejects: an object in the bucket that cannot be attributed without a table
  // lookup.
  await check('the S3 object metadata carries the pair too', () => {
    const meta = s3Meta.get(stamped.s3Key);
    assert.strictEqual(meta.scope, 'org', `scope was ${JSON.stringify(meta.scope)}`);
    assert.strictEqual(meta.orgId, ORG);
  });
  // rejects: writing `orgId: undefined` into S3 user metadata on a platform
  // object, which the SDK sends as the literal string "undefined".
  store.clear(); s3Store.clear(); s3Meta.clear();
  const housed = parse(await post(STAFF, {}));
  await check('a platform object carries scope and NO orgId key', () => {
    const meta = s3Meta.get(housed.s3Key);
    assert.strictEqual(meta.scope, 'platform');
    assert.ok(!('orgId' in meta), `orgId present as ${JSON.stringify(meta.orgId)}`);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/org-authored-prompts.js`

Expected — **six FAIL lines**:
- `an org body is written under prompts/org/<orgId>/` → `s3Key was prompts/call-and-answer/<id>/v1.json`
- `…and that is the object that actually exists` → `objects present: prompts/call-and-answer/<id>/v1.json`
- `…and the ROW stores the scoped key, not a rebuilt one` → `'prompts/call-and-answer/…' !== 'prompts/org/org_acme/…'`
- `the S3 body names the real author and the library` → `author was "admin"`
- `the S3 object metadata carries the pair too` → `scope was undefined`
- `a platform object carries scope and NO orgId key` → `undefined !== 'platform'`

`a platform body keeps the path it has always had` must **pass before and after**. It is the zero-migration guard; if it ever goes red, every stored body has been orphaned.

- [ ] **Step 3: Write minimal implementation**

Widen the Task 1 import to include `promptBodyKey`:

```js
const {
  createPromptRef, promptKey, promptBodyKey, promptOwnerStamp,
} = require('./shared/prompt-access');
```

Replace `:148-149`:

```js
    // WHERE THE TEXT GOES. Scoping the DynamoDB partition does not reach S3 —
    // the row stores only `s3Key`, so without this two organisations whose
    // slugs collide overwrite each other's Workie text. Platform keeps the
    // exact path it has always had, which is what makes this zero migration in
    // S3 as well as in the table.
    const s3Key = promptBodyKey(ref, gameType, version);
```

Replace the `metadata` block at `:181-185`:

```js
      metadata: {
        // WHO, and WHICH LIBRARY. `author` was the constant string 'admin' on
        // every prompt ever written, which is a lie the moment a host in an
        // organisation authors one — and the body is the copy that TRAVELS:
        // includeContent returns it, export-to-archive copies it wholesale, and
        // a published Workie would carry it. Nothing reads this field today
        // (verified: no `metadata.author` reader in lambda-functions or src),
        // so correcting it is additive.
        author: promptStamp.createdBy || 'admin',
        scope: ref.scope,
        ...(ref.orgId ? { orgId: ref.orgId } : {}),
        createdBy: 'admin-interface',
        format: basePrompt ? 'generation' : (template ? 'legacy' : 'structured')
      }
```

Replace the `Metadata` block in the `PutObjectCommand` at `:195-200`:

```js
      Metadata: {
        promptId: promptId,
        gameType: gameType,
        version: version.toString(),
        status: status,
        // So an object found in the bucket is attributable without a table
        // lookup. `orgId` is spread conditionally: S3 user metadata values must
        // be strings, and an absent one sent as `undefined` arrives as the
        // literal four-letter word.
        scope: ref.scope,
        ...(ref.orgId ? { orgId: ref.orgId } : {})
      }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node tests/org-authored-prompts.js | tail -2
node tests/ai-prompt-lifecycle.js | tail -2
node tests/prompt-archive-roundtrip.js | tail -2
```
Expected: `28 passed, 0 failed` for the new suite; the other two unchanged from their baselines.

`tests/prompt-archive-roundtrip.js` is the guard that the body shape still round-trips through export and import.

- [ ] **Step 5: Commit**

```bash
git add lambda-functions/admin/create-ai-prompt.js tests/org-authored-prompts.js
git commit -m "$(cat <<'EOF'
🗝️ An org's Workie text gets its own S3 key, and the body says whose it is

Scoping a DynamoDB partition does not reach S3. The row stores only
`s3Key` and the key was `prompts/<gameType>/<promptId>/v<n>.json` with no
org component, so two organisations whose slugs collide would have
overwritten each other's Workie text with the partitions looking
perfectly isolated.

`promptBodyKey` adds the segment. Platform keys are byte-identical to
what they have always been, so this is zero migration in S3 as it is in
the table, and the SCOPED key is what lands on the row — which is what
keeps update-ai-prompt.js's read-the-stored-key coupling correct when
that handler is wired.

`metadata.author` stops being the constant 'admin'. The body is the copy
that travels — includeContent returns it, the archive export copies it
wholesale, a published Workie would carry it — so a constant author is a
lie that outlives the row it came from.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: The list reads every scope the caller may read

Without this, Tasks 1–3 write a row nobody can see. `get-ai-prompts.js` runs one Query on `PK = 'AIPROMPTS'`; it becomes one Query per readable scope, merged.

**Files:**
- Modify: `lambda-functions/admin/get-ai-prompts.js` — imports (after `:5`), `:44-77`, `:110-136`, `:139-157`, `:171`
- Test: `tests/org-authored-prompts.js` (append section 6)

**Interfaces:**
- Consumes: `readablePromptRefs(event, '')`, `promptKey(ref)` from `./shared/prompt-access`.
- Produces: each element of `prompts[]` gains `scope` (`'org' | 'platform' | 'public'`) and `orgId` (string or `null`), derived from the ref that named the partition.
- Produces: the array is sorted **by scope rank (org 0, platform 1, public 2) then `updatedAt` descending**.
- Unchanged: `begins_with(SK, 'AIPROMPT#')`, the `category`/`status` `FilterExpression`, the JS `gameType`/`promptType` filters, `decorate`, `includeContent`, the `filters` echo in the response.

- [ ] **Step 1: Write the failing test**

Append to `tests/org-authored-prompts.js`, before the final report:

```js
  say('\n6. the list reads every library the caller may read');

  const list = (who, qs) =>
    getPrompts.handler({ ...who, queryStringParameters: qs || {} })
      .then((r) => ({ status: r.statusCode, body: JSON.parse(r.body) }));

  /*
    A new org Workie is invisible the moment it is written if the list still
    runs one Query on PK = 'AIPROMPTS'. That is why create and list are one
    change.
  */
  store.clear(); s3Store.clear(); s3Meta.clear();
  const mine = parse(await post(HOST, { name: 'Ours' }));
  const house = parse(await post(STAFF, { name: 'Engage house' }));

  // rejects: the single Query on the bare partition, which is a platform-only
  // read and makes every org Workie invisible to its own author.
  const asHost = await list(HOST);
  await check('a host sees their own org Workie', () =>
    assert.ok(asHost.body.prompts.some((p) => p.promptId === mine.promptId),
      `ids returned: ${asHost.body.prompts.map((p) => p.promptId).join(', ') || '(none)'}`));
  await check('…and Engage\'s, in the same list', () =>
    assert.ok(asHost.body.prompts.some((p) => p.promptId === house.promptId)));
  // rejects: a client that holds a promptId and cannot tell which library it
  // came from — the pair is the reference, the id alone is not.
  await check('every row carries the scope pair', () => {
    const ours = asHost.body.prompts.find((p) => p.promptId === mine.promptId);
    const theirs = asHost.body.prompts.find((p) => p.promptId === house.promptId);
    assert.strictEqual(ours.scope, 'org', `ours.scope was ${JSON.stringify(ours.scope)}`);
    assert.strictEqual(ours.orgId, ORG);
    assert.strictEqual(theirs.scope, 'platform');
    assert.strictEqual(theirs.orgId, null);
  });
  // rejects: a flat updatedAt sort, which interleaves a team's own Workies with
  // Engage's twenty-two and makes "ours" unfindable in the surface built to
  // show them. readablePromptRefs already encodes the rank and the reason.
  await check('the caller\'s own library comes first', () =>
    assert.strictEqual(asHost.body.prompts[0].scope, 'org',
      `first row was ${asHost.body.prompts[0].scope}`));

  // rejects: probing a partition the caller cannot read, which would turn
  // "absent" into "forbidden" and confirm another org's Workie exists.
  const OTHER = caller({
    userId: 'sub-zed', username: 'zed', groups: 'hosts', status: 'enabled',
    orgId: 'org_globex', orgRole: 'owner', orgIds: 'org_globex',
  });
  const asOther = await list(OTHER);
  await check('another organisation does not see it — absent, not forbidden', () => {
    assert.strictEqual(asOther.status, 200);
    assert.ok(!asOther.body.prompts.some((p) => p.promptId === mine.promptId),
      'org_globex can read org_acme\'s library');
  });
  await check('…but still sees the shared Engage library', () =>
    assert.ok(asOther.body.prompts.some((p) => p.promptId === house.promptId)));

  /*
    THE FILTERS. `category` and `status` are pushed into a FilterExpression,
    which is PER QUERY — so each partition needs its OWN input object. Sharing
    one object across a Promise.all and reassigning `:pk` between sends is a
    race in which every query can read the last `:pk` written.
  */
  // rejects: a shared, mutated query object; and a FilterExpression that stops
  // being applied to the org partition.
  store.clear(); s3Store.clear(); s3Meta.clear();
  await post(HOST, { name: 'Org lessons', category: 'lessons-learned' });
  await post(HOST, { name: 'Org retro', category: 'retro' });
  await post(STAFF, { name: 'House lessons', category: 'lessons-learned' });
  const filtered = await list(HOST, { category: 'lessons-learned' });
  await check('the category filter applies to EVERY partition', () => {
    const names = filtered.body.prompts.map((p) => p.name).sort();
    assert.deepStrictEqual(names, ['House lessons', 'Org lessons'],
      `got ${JSON.stringify(names)}`);
  });
  // rejects: the JS gameType/promptType filters being applied per-partition
  // and losing rows, or being dropped in the merge.
  const byType = await list(HOST, { gameType: 'callandanswer' });
  await check('the legacy gameType spelling still matches across scopes', () =>
    assert.strictEqual(byType.body.prompts.length, 3,
      `got ${byType.body.prompts.length}`));

  /*
    PERSONAS AND THE DEFAULT POINTER SHARE THE BARE PARTITION AND MUST NOT
    APPEAR. `begins_with(SK, 'AIPROMPT#')` is what keeps them out and must stay.
  */
  // rejects: dropping the SK prefix condition while widening the query, which
  // would put personas and GAMETYPE# pointer rows in the prompt library.
  store.clear(); s3Store.clear(); s3Meta.clear();
  await post(STAFF, { isDefault: true });
  store.set('AIPROMPTS|PERSONA#sage', { PK: 'AIPROMPTS', SK: 'PERSONA#sage', name: 'Sage' });
  const clean = await list(HOST);
  await check('no persona and no default-pointer row enters the list', () =>
    clean.body.prompts.forEach((p) => {
      assert.ok(!String(p.SK).startsWith('PERSONA#'), `persona leaked: ${p.SK}`);
      assert.ok(!String(p.SK).startsWith('GAMETYPE#'), `pointer leaked: ${p.SK}`);
    }));
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/org-authored-prompts.js`

Expected — **six FAIL lines**:
- `a host sees their own org Workie` → `ids returned: <house id only>` — this is the headline: the Workie was written successfully and cannot be seen.
- `every row carries the scope pair` → `Cannot read properties of undefined (reading 'scope')` (the org row is not in the list at all)
- `the caller's own library comes first` → `first row was undefined`
- `the category filter applies to EVERY partition` → `got ["House lessons"]`
- `the legacy gameType spelling still matches across scopes` → `got 1`

`another organisation does not see it` and `no persona and no default-pointer row enters the list` must **pass before and after** — they are the "nothing widened too far" half.

- [ ] **Step 3: Write minimal implementation**

In `lambda-functions/admin/get-ai-prompts.js`, after the import at `:5`:

```js
const { readablePromptRefs, promptKey } = require('./shared/prompt-access');
const { PLATFORM, ORG, PUBLIC } = require('./shared/tenant');
```

Replace `:44-77` (from `// Get prompt metadata…` through `console.log(\`📊 Found …\`);`):

```js
    /*
      EVERY LIBRARY THIS CALLER MAY SEE, MERGED — not one partition any more.

      `readablePromptRefs` is the authority (shared/prompt-access.js ->
      tenant.js): the caller's own org, then the platform library, then public.
      Platform is in that list for EVERYBODY with an account, which is what
      keeps Engage's Workies available to every organisation.

      One Query per scope, run CONCURRENTLY: they hit different partitions, so
      sequential awaits would only add latency. Three at most.

      A FRESH INPUT OBJECT PER REF, and that is not a style preference. The
      FilterExpression and its values are per-QueryCommand; sharing one object
      across a Promise.all and reassigning `:pk` between sends is a race in
      which every query can end up reading the last `:pk` written.

      `promptKey(ref).PK` rather than a literal: nothing outside tenant.js may
      spell a partition key, and a hand-built 'ORG#'+id+'#AIPROMPTS' here is
      exactly the drift that ends with two spellings of one partition.

      `begins_with(SK, 'AIPROMPT#')` STAYS. The bare partition also holds
      PERSONA#<id> rows and the GAMETYPE#…#CATEGORY#… default pointer, both of
      which are platform-only by decision (tenant.js:114-131); this condition is
      the only thing keeping them out of the prompt library.
    */
    const buildQuery = (pk) => {
      const q = {
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: { ':pk': pk, ':sk': 'AIPROMPT#' }
      };
      // Only `category` and `status` are exact-match, so only they can be
      // pushed down into a FilterExpression. `gameType` and `promptType` need
      // normalisation / shape-inference and are applied in JS below — a
      // FilterExpression on the raw stored value is exactly what made a
      // `poll`-spelled filter miss every `polls`-spelled row.
      const filterExpressions = [];
      if (category) {
        filterExpressions.push('category = :category');
        q.ExpressionAttributeValues[':category'] = category;
      }
      if (status) {
        filterExpressions.push('#status = :status');
        q.ExpressionAttributeValues[':status'] = status;
        q.ExpressionAttributeNames = { '#status': 'status' };
      }
      if (filterExpressions.length > 0) q.FilterExpression = filterExpressions.join(' AND ');
      return q;
    };

    const refs = readablePromptRefs(event, '');
    const perScope = await Promise.all(refs.map(async (ref) => {
      const res = await dynamodb.send(new QueryCommand(buildQuery(promptKey(ref).PK)));
      // The ref travels with the row: it named the partition, so it cannot
      // disagree with where the row actually is.
      return ((res && res.Items) || []).map((item) => ({ item, ref }));
    }));

    let promptsMetadata = perScope.flat();

    console.log(`📊 Found ${promptsMetadata.length} prompt metadata records across ${refs.length} scope(s)`);
```

The three JS-filter blocks at `:79-94` change only in that they now filter `{item, ref}` pairs. Replace their predicates:

```js
    if (gameType && gameType !== 'all') {
      const wanted = normalizeGameType(gameType);
      const before = promptsMetadata.length;
      promptsMetadata = promptsMetadata.filter(({ item }) => normalizeGameType(item.gameType) === wanted);
      console.log(`🎮 gameType "${gameType}" → "${wanted}": ${before} → ${promptsMetadata.length}`);
    }

    if (promptType && promptType !== 'all') {
      const before = promptsMetadata.length;
      promptsMetadata = promptsMetadata.filter(({ item }) => inferPromptType(item) === promptType);
      console.log(`🏷️ promptType "${promptType}": ${before} → ${promptsMetadata.length}`);
    }
```

`decorate` gains the ref. Change its signature at `:110` and add two fields **after** the `...prompt` spread so they win:

```js
    const decorate = (prompt, promptContent, ref) => {
```
and inside the returned object, immediately after `...(promptContent ? { promptContent } : {}),`:

```js
        // THE OTHER HALF OF THE REFERENCE. `retro` in an organisation and
        // `retro` on the platform are two different Workies, so a client that
        // holds only a promptId cannot address either. Taken from the REF that
        // named the partition — a row cannot disagree with where it is.
        scope: ref.scope,
        orgId: ref.orgId || null,
```

Replace the enrichment map at `:139-157`:

```js
    const enrichedPrompts = await Promise.all(promptsMetadata.map(async ({ item: prompt, ref }) => {
      try {
        if (prompt.s3Key && queryParams.includeContent === 'true') {
          const s3Response = await s3Client.send(new GetObjectCommand({
            Bucket: aiPromptsBucket,
            Key: prompt.s3Key
          }));
          const content = await s3Response.Body.transformToString();
          return decorate(prompt, JSON.parse(content), ref);
        }
        return decorate(prompt, null, ref);
      } catch (s3Error) {
        console.warn(`⚠️ Could not fetch S3 content for ${prompt.s3Key}:`, s3Error.message);
        return decorate(prompt, null, ref);
      }
    }));
```

Replace the sort at `:171`:

```js
    // ORG, THEN PLATFORM, THEN PUBLIC — and newest first within each.
    //
    // `readablePromptRefs` already encodes this rank and the reason for it:
    // your own content is what you meant. A flat updatedAt sort interleaves a
    // team's four Workies with Engage's twenty-two, in the one surface built to
    // show them their own.
    //
    // For a caller with no organisation the refs are [platform, public] and
    // there are no public prompt rows yet, so this orders identically to the
    // flat sort it replaces for every caller that exists today.
    const SCOPE_RANK = { [ORG]: 0, [PLATFORM]: 1, [PUBLIC]: 2 };
    enrichedPrompts.sort((a, b) =>
      ((SCOPE_RANK[a.scope] ?? 9) - (SCOPE_RANK[b.scope] ?? 9))
      || (new Date(b.updatedAt) - new Date(a.updatedAt)));
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node tests/org-authored-prompts.js | tail -2
node tests/ai-prompt-lifecycle.js | tail -2
node tests/ai-prompt-status-update.js | tail -2
```
Expected: `37 passed, 0 failed` for the new suite; the other two unchanged from their baselines.

`tests/ai-prompt-status-update.js` is the guard on the `status` FilterExpression: its header at `:15` says *"get-ai-prompts.js:64 filters on it, the library's select…"*. If it drops a test, the filter was not carried into `buildQuery`.

- [ ] **Step 5: Commit**

```bash
git add lambda-functions/admin/get-ai-prompts.js tests/org-authored-prompts.js
git commit -m "$(cat <<'EOF'
👁️ The prompt library lists every scope the caller may read

A new org Workie was invisible the moment it was written: the list ran
one Query on `PK = 'AIPROMPTS'`, which is a platform-only read. That is
why this ships with the create-side scoping rather than after it.

One Query per readable scope, concurrent, merged, ordered org → platform
→ public with newest first inside each block. Every row now carries
`scope` and `orgId` taken from the ref that named the partition, because
`retro` in an organisation and `retro` on the platform are two Workies
and a promptId alone addresses neither.

Each Query gets a FRESH input object. The old code mutated one shared
`:pk`, which under Promise.all is a race where every query can read the
last value written.

Deliberately no de-duplication: `get-question-sets.js` — the multi-scope
list that already shipped — does not either. Seeing an org original and
its public copy side by side is the answer, not a duplicate to hide.

`begins_with(SK, 'AIPROMPT#')` stays and is asserted: personas and the
GAMETYPE# default pointer share the bare partition and are platform-only
by decision.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `ENCRYPTED_FIELDS` gains a `prompt` entity

Spec §3: *"**Org prompts are encrypted** for the same reason org sets are; platform and public prompts are not. `ENCRYPTED_FIELDS` gains a `prompt` entity."* Today there is none and `fieldsFor` throws on an unknown entity (`tenant-crypto.js:518-527`), so `encryptItem(orgId, 'prompt', …)` cannot be called at all.

**This task changes no handler. It only makes Tasks 6 and 7 possible.**

**Files:**
- Modify: `lambda-functions/admin/shared/tenant-crypto.js` — the `ENCRYPTED_FIELDS` object at `:144-270`, and the plaintext-rationale comment at `:137-139`
- Modify: `lambda-functions/game/tenant-crypto.js` — **byte-identical**
- Modify: `lambda-functions/websocket/tenant-crypto.js` — **byte-identical**
- Modify: `tests/tenant-crypto.js` — one assertion in section 1

**Interfaces:**
- Produces: `ENCRYPTED_FIELDS.prompt = ['audienceTemplate', 'basePrompt', 'categoryTemplate', 'contextTemplate', 'description', 'name', 'outputFormat', 'outputSections', 'scenario']`.
- Unchanged: every other entity, and the three copies stay byte-identical (`tests/tenant-crypto.js:493-509` fails the build if they drift).

**Why exactly those fields, and why the rest stay plaintext.** Read the row `create-ai-prompt.js` writes at `:204-237`. `template` and `instructions` are **not** on it — they go only to S3 — so they are not in this list.

| Field | Plaintext? | Why |
|---|---|---|
| `name`, `description` | encrypt | The same two strings `ENCRYPTED_FIELDS.set` already encrypts. |
| `basePrompt`, `contextTemplate`, `audienceTemplate`, `categoryTemplate`, `outputFormat`, `outputSections`, `scenario` | encrypt | Customer-authored prose. A Workie *is* the content. `outputSections` is an array of `{heading, guidance}`; `encryptValue` JSON-serialises, so it round-trips as an array. |
| `category`, `status` | **plaintext** | `get-ai-prompts.js` pushes both into a `FilterExpression` as equality matches. An encrypted value cannot be matched by an equality filter — the same argument the `Name` note at `:128` already makes for the category mask. |
| `gameType`, `promptType`, `promptId`, `s3Key`, `version`, `isDefault` | plaintext | Structural: vocabulary, pointers, flags. |
| `tags`, `questionSetIds` | plaintext | Labels and identifiers, not prose. |
| `defaultSettings` | plaintext | Model configuration (temperature, token budget), not content. |
| `scenarioType` | plaintext | An enum-ish label beside `scenario`. |
| `orgId`, `createdBy`, `scope`, `createdAt`, `updatedAt` | plaintext | Who and when — the guard needs these *before* it can know whether the caller may have the key. `:117-120` already says this. |

- [ ] **Step 1: Write the failing test**

In `tests/tenant-crypto.js`, in section 1, immediately after the `set fields are exactly the agreed set` check (ends at `:139`), insert:

```js
// A WORKIE IS THE CONTENT. `name` and `description` are the same two strings
// the `set` entity already encrypts; the template fields are the prose the
// customer wrote. `category` and `status` stay plaintext because
// get-ai-prompts.js pushes both into a FilterExpression as equality matches,
// and an encrypted value cannot be matched by one — the same argument the
// category `Name` note above makes for the 24-bit mask.
check('prompt fields are exactly the agreed set', () =>
  assert.deepStrictEqual([...C.ENCRYPTED_FIELDS.prompt].sort(),
    ['audienceTemplate', 'basePrompt', 'categoryTemplate', 'contextTemplate',
     'description', 'name', 'outputFormat', 'outputSections', 'scenario'].sort()));
check('a prompt\'s filterable columns are deliberately NOT encrypted', () => {
  assert.ok(!C.ENCRYPTED_FIELDS.prompt.includes('category'),
    'category is an equality FilterExpression in get-ai-prompts.js');
  assert.ok(!C.ENCRYPTED_FIELDS.prompt.includes('status'),
    'status is an equality FilterExpression in get-ai-prompts.js');
  assert.ok(!C.ENCRYPTED_FIELDS.prompt.includes('gameType'));
  assert.ok(!C.ENCRYPTED_FIELDS.prompt.includes('s3Key'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/tenant-crypto.js 2>&1 | grep -E 'FAIL|passed,'`

Expected — **two FAIL lines**:
- `prompt fields are exactly the agreed set` → `Cannot read properties of undefined (reading 'sort')` — because `ENCRYPTED_FIELDS.prompt` does not exist.
- `a prompt's filterable columns are deliberately NOT encrypted` → `Cannot read properties of undefined (reading 'includes')`

and `85 passed, 2 failed`.

- [ ] **Step 3: Write minimal implementation**

In **all three** `tenant-crypto.js` files, insert into `ENCRYPTED_FIELDS` immediately after the `set` entity (which ends at `:156` in the admin copy):

```js
  /** An AI prompt — a Workie: PK=<scope>AIPROMPTS, SK=AIPROMPT#<id>.
   *
   *  ORG SCOPE ONLY, like every other entity here — platform and public prompts
   *  are deliberately plaintext, for the reason upload-questions.js gives about
   *  the shared libraries: encrypting content the whole product depends on
   *  would make it unreadable, and there is no org to key it to.
   *
   *  `name` and `description` are the same two strings the `set` entity above
   *  encrypts. The template fields are the prose the customer wrote, and a
   *  Workie IS that prose — the row is the mirror of the S3 body, which
   *  create-ai-prompt.js encrypts separately because a partition does not reach
   *  a bucket.
   *
   *  `category` and `status` STAY PLAINTEXT and that is not an oversight:
   *  get-ai-prompts.js pushes both into a FilterExpression as equality matches,
   *  and an encrypted value cannot be matched by an equality filter. Same
   *  argument as the category `Name` note above. `gameType`, `promptType`,
   *  `s3Key`, `version`, `isDefault`, `tags`, `questionSetIds` and
   *  `defaultSettings` are vocabulary, pointers, flags, labels and model
   *  configuration — the "identifiers, timestamps and counts" the privacy page
   *  already concedes are visible.
   *
   *  `template` and `instructions` are absent because they are not on the row:
   *  create-ai-prompt.js writes those only to the S3 body. */
  prompt: Object.freeze([
    'name',
    'description',
    'basePrompt',
    'contextTemplate',
    'audienceTemplate',
    'categoryTemplate',
    'outputFormat',
    'outputSections',
    'scenario',
  ]),
```

Then correct the plaintext-rationale table at `:137-139`, which currently gives a reason that D2 overturns. Replace:

```
 *   PersonaName/Id,      Platform configuration. A persona has no tenant —
 *   promptId             see tenant.js on why PK='AIPROMPTS' is untouched.
```
with:

```
 *   PersonaName/Id       Platform configuration. A persona is a VOICE Engage
 *                        curates and stays platform-only by decision —
 *                        tenant.js:personasPk says so in code.
 *   promptId             A pointer, not prose. The Workie it names is scoped
 *                        and encrypted under the `prompt` entity below; the id
 *                        itself is how a row is found at all.
```

**Copy the whole file, do not hand-edit three times.** After editing the admin copy:

```bash
cp lambda-functions/admin/shared/tenant-crypto.js lambda-functions/game/tenant-crypto.js
cp lambda-functions/admin/shared/tenant-crypto.js lambda-functions/websocket/tenant-crypto.js
```
The three are byte-identical by design; `tests/tenant-crypto.js:493-509` fails if they drift.

- [ ] **Step 4: Run tests to verify they pass**

```bash
node tests/tenant-crypto.js | tail -2
node tests/tenant-crypto-wiring.js | tail -2
node tests/tenant-keys.js | tail -2
node tests/tenant-infrastructure.js | tail -2
```
Expected: `87 passed, 0 failed` for `tenant-crypto.js` (83 + 2 new + the drift checks still passing); the others unchanged from their baselines.

If `the copies have drifted — one bundle is running different rules` appears, the `cp` was not run or was run before the edit.

- [ ] **Step 5: Commit**

```bash
git add lambda-functions/admin/shared/tenant-crypto.js lambda-functions/game/tenant-crypto.js lambda-functions/websocket/tenant-crypto.js tests/tenant-crypto.js
git commit -m "$(cat <<'EOF'
🔐 ENCRYPTED_FIELDS gains a prompt entity

An organisation can now author a Workie, and a Workie is prose the
customer wrote — the same kind of content as a set's customInstruction.
There was no `prompt` entity at all, and `fieldsFor` throws on an unknown
one, so `encryptItem(orgId, 'prompt', …)` could not be called.

`category` and `status` stay plaintext deliberately: get-ai-prompts.js
pushes both into a FilterExpression as equality matches and an encrypted
value cannot be matched by one. Same argument the category `Name` note
already makes for the 24-bit mask.

Also corrects the plaintext rationale, which cited "a persona has no
tenant … PK='AIPROMPTS' is untouched" as the reason prompt material stays
readable. D2 overturned the second half of that sentence; the persona
half still stands and now says so on its own.

Three byte-identical copies, as ever. No handler calls this yet.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: An org's Workie is ciphertext at rest — row and body

Spec §6a: *"the S3 key gains the scope prefix, **and org bodies are encrypted before `PutObject`**."* Task 3 did the key; this does the ciphertext. Depends on Task 5.

**Files:**
- Modify: `lambda-functions/admin/create-ai-prompt.js` — one import, the `PutObjectCommand` body at `:190-201`, the `PutCommand` at `:240-243`
- Modify: `template-clean.yaml` — `AdminCreateAIPromptFunction`'s `Policies` at `:3673-3677`
- Test: `tests/org-authored-prompts.js` (append section 7)

**Interfaces:**
- Consumes: `encryptItem(orgId, 'prompt', item)` and `encryptValue(orgId, value)` from `./shared/tenant-crypto`.
- Produces: for `ref.scope === 'org'`, the DynamoDB row's nine `prompt` fields are envelopes (`{v, iv, tag, ct}`), and the S3 object's `Body` is `JSON.stringify(<envelope>)` rather than the document.
- Unchanged for platform: the row is plaintext and the S3 `Body` is the pretty-printed document, exactly as today.

- [ ] **Step 1: Write the failing test**

First, add the KMS stub to `tests/org-authored-prompts.js`. Insert it **before** the `process.env.TABLE_NAME` line, and add the `mintOrg` helper after the callers block. Both are lifted from `tests/tenant-crypto-wiring.js:111-172` and `:216-231`:

```js
// ---- a KMS that behaves the way the key policy will ------------------------
const nodeCrypto = require('crypto');
class GenerateDataKeyCommand { constructor(i) { this.input = i; } }
class DecryptCommand { constructor(i) { this.input = i; } }
const wrap = (orgId, key) =>
  Buffer.from(JSON.stringify({ orgId, key: key.toString('base64') }), 'utf8');

stub('@aws-sdk/client-kms', {
  KMSClient: class {
    async send(command) {
      if (command instanceof GenerateDataKeyCommand) {
        const orgId = command.input.EncryptionContext?.orgId;
        assert.ok(orgId, 'GenerateDataKey must bind an orgId');
        const k2 = nodeCrypto.randomBytes(32);
        return { Plaintext: k2, CiphertextBlob: wrap(orgId, k2) };
      }
      if (command instanceof DecryptCommand) {
        const ctx = command.input.EncryptionContext?.orgId;
        if (!ctx) throw new Error('AccessDeniedException: no orgId in encryption context');
        const blob = JSON.parse(Buffer.from(command.input.CiphertextBlob).toString('utf8'));
        if (blob.orgId && blob.orgId !== ctx) {
          throw new Error('InvalidCiphertextException: encryption context mismatch');
        }
        return { Plaintext: Buffer.from(blob.key, 'base64') };
      }
      throw new Error('unexpected KMS command');
    }
  },
  GenerateDataKeyCommand,
  DecryptCommand,
});
```

and beside `process.env.TABLE_NAME`:

```js
process.env.TENANT_KMS_KEY_ID = 'alias/engage-tenant';
```

and after the callers block:

```js
/** Is this value the envelope shape tenant-crypto writes? */
const isEnvelope = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
  && typeof v.v === 'number' && typeof v.iv === 'string'
  && typeof v.tag === 'string' && typeof v.ct === 'string';

/**
 * Mint the org exactly as create-org does: ONE GenerateDataKey, and the wrapped
 * blob onto ORG#<id>/METADATA, which every tenant-crypto copy's default loader
 * reads through the stubbed DynamoDB.
 */
async function mintOrg(orgId) {
  const C = require(path.join(REPO, 'lambda-functions/admin/shared/tenant-crypto.js'));
  const blob = await C.createOrgDataKey(orgId);
  store.set(key(`ORG#${orgId}`, 'METADATA'),
    { PK: `ORG#${orgId}`, SK: 'METADATA', orgId, dataKeyCiphertext: blob });
  C.forgetOrg(orgId);
}
```

**Every `store.clear()` in an org case from here on must be followed by `await mintOrg(ORG);`** — the data key lives on a row in the same store. Update the earlier sections' org cases accordingly (Tasks 1–4's org cases: add `await mintOrg(ORG);` after each `store.clear()` that is followed by a `post(HOST, …)`).

Then append section 7:

```js
  say('\n7. an org\'s Workie is ciphertext at rest');

  /*
    docs/design/tenancy-redesign/08-privacy.html: "Engage staff browsing the
    database see identifiers and ciphertext, not your questions." A Workie is
    prose the customer wrote. A field shipping in plaintext breaks NOTHING —
    the product behaves identically and every other test passes — so these
    assertions are about BYTES AT REST, not about what the handler returns.
  */
  // rejects: dropping the encryptItem call, or gating it on something other
  // than the ref's scope.
  store.clear(); s3Store.clear(); s3Meta.clear();
  await mintOrg(ORG);
  const secret = parse(await post(HOST, {
    name: 'What we got wrong in Q3', description: 'the honest one',
  }));
  await check('the org row\'s name and description are ENVELOPES, not sentences', () => {
    const row = store.get(`ORG#${ORG}#AIPROMPTS|AIPROMPT#${secret.promptId}`);
    assert.ok(isEnvelope(row.name), `name stored as ${JSON.stringify(row.name)}`);
    assert.ok(isEnvelope(row.description), `description stored as ${JSON.stringify(row.description)}`);
  });
  // rejects: encrypting the columns the list filters on, which would silently
  // make every category and status filter return nothing for org prompts.
  await check('…but category, status and s3Key are still readable', () => {
    const row = store.get(`ORG#${ORG}#AIPROMPTS|AIPROMPT#${secret.promptId}`);
    assert.strictEqual(row.category, 'lessons-learned');
    assert.strictEqual(row.status, 'active');
    assert.strictEqual(row.s3Key, secret.s3Key);
    assert.strictEqual(row.orgId, ORG);
  });
  /*
    THE S3 HALF. ENCRYPTED_FIELDS alone encrypts the row and leaves the TEXT in
    the clear, in a shared bucket, beside a row that is ciphertext. That is the
    exact mistake spec §3 names.
  */
  // rejects: encrypting the row and forgetting the body.
  await check('the S3 body is an envelope, and the prose is not in it', () => {
    const raw = s3Store.get(secret.s3Key);
    assert.ok(!raw.includes('What we got wrong in Q3'),
      'the Workie name is sitting in the bucket in plaintext');
    assert.ok(!raw.includes('Summarise the responses.'),
      'the Workie instructions are sitting in the bucket in plaintext');
    assert.ok(isEnvelope(JSON.parse(raw)), `body was ${raw.slice(0, 80)}`);
  });

  // rejects: encrypting PLATFORM content, which would make the shared library
  // unreadable by everybody — upload-questions.js says why.
  store.clear(); s3Store.clear(); s3Meta.clear();
  const open = parse(await post(STAFF, { name: 'Engage house Workie' }));
  await check('a platform row is still plaintext', () => {
    const row = store.get(`AIPROMPTS|AIPROMPT#${open.promptId}`);
    assert.strictEqual(row.name, 'Engage house Workie');
  });
  await check('…and its S3 body is still the readable document', () => {
    const doc = JSON.parse(s3Store.get(open.s3Key));
    assert.strictEqual(doc.name, 'Engage house Workie');
  });
```

- [ ] **Step 2: Run test to verify it fails, and watch `kms-grants-match-code.js` fail too**

Run: `node tests/org-authored-prompts.js`

Expected — **three FAIL lines**:
- `the org row's name and description are ENVELOPES, not sentences` → `name stored as "What we got wrong in Q3"`
- `the S3 body is an envelope, and the prose is not in it` → `the Workie name is sitting in the bucket in plaintext`

and `…but category, status and s3Key are still readable` plus both platform cases **passing already** — they are the "nothing over-encrypted" half.

Then write the implementation code **first**, run `node tests/kms-grants-match-code.js`, and expect it to go from **111 passed, 0 failed** to **114 passed, 1 failed** with:

```
  FAIL - AdminCreateAIPromptFunction may decrypt
    it reaches tenant-crypto but has no kms:Decrypt — it will throw
    AccessDeniedException the first time a real tenant uses it, and nothing
    in the local suite can see that because KMS is stubbed
```

**That red line is the whole reason the template edit is in this task**, and it is the only thing in the repo that can see the failure. Do not add the policy before seeing it.

- [ ] **Step 3: Write minimal implementation**

In `lambda-functions/admin/create-ai-prompt.js`, beside the Task 1 imports:

```js
const { encryptItem, encryptValue } = require('./shared/tenant-crypto');
```

Replace the `PutObjectCommand` block at `:188-201`:

```js
    /*
      ORG BODIES ARE ENCRYPTED BEFORE PutObject.

      `ENCRYPTED_FIELDS` alone encrypts the ROW and leaves the TEXT in the
      clear, in a shared bucket, beside a row that is ciphertext — and the text
      is the content-dense half. The whole document is wrapped as one envelope
      rather than field by field: the body is read back whole, by one reader,
      and a per-field envelope inside a JSON document buys nothing.

      Platform and public bodies are plaintext by decision, the same one
      upload-questions.js states for the shared libraries: encrypting content
      the whole product depends on would make it unreadable, and there is no org
      to key it to.
    */
    const s3Body = ref.orgId
      ? JSON.stringify(await encryptValue(ref.orgId, promptContent))
      : JSON.stringify(promptContent, null, 2);

    console.log(`💾 Saving prompt content to S3: ${s3Key}`);
    await s3Client.send(new PutObjectCommand({
      Bucket: aiPromptsBucket,
      Key: s3Key,
      Body: s3Body,
      ContentType: 'application/json',
      Metadata: {
        promptId: promptId,
        gameType: gameType,
        version: version.toString(),
        status: status,
        scope: ref.scope,
        ...(ref.orgId ? { orgId: ref.orgId } : {})
      }
    }));
```

Replace the `PutCommand` at `:239-243`:

```js
    console.log(`💾 Saving prompt metadata to DynamoDB`);
    await dynamodb.send(new PutCommand({
      TableName: tableName,
      // Org rows only. `encryptItem` needs an orgId and throws without one, and
      // a platform row must stay readable by every organisation.
      Item: ref.orgId ? await encryptItem(ref.orgId, 'prompt', dynamoItem) : dynamoItem
    }));
```

Then, in `template-clean.yaml`, add to `AdminCreateAIPromptFunction`'s `Policies` (currently at `:3673-3677`), as the **first** entry, copying the block verbatim from `AdminUploadQuestionsFunction:3102-3109`:

```yaml
      Policies:
        # Tenant content is encrypted per organisation. This function reads or
        # writes some, so it needs to unwrap that org's data key — and ONLY with
        # an orgId encryption context, which the key policy makes mandatory.
        - Version: '2012-10-17'
          Statement:
            - Effect: Allow
              Action: [ kms:Decrypt ]
              Resource: !GetAtt TenantKey.Arn
        - DynamoDBCrudPolicy:
            TableName: !Ref GameTable
        - S3CrudPolicy:
            BucketName: !Ref AIPromptsBucket
```

`kms:Decrypt` only, never `GenerateDataKey` — minting is `create-org.js` and `personal-org.js` alone, and `tests/kms-grants-match-code.js` section 3 will fail if `GenerateDataKey` appears here.

- [ ] **Step 4: Run tests to verify they pass**

```bash
node tests/org-authored-prompts.js | tail -2
node tests/kms-grants-match-code.js | tail -2
node tests/tenant-crypto-wiring.js | tail -2
node tests/ai-prompt-lifecycle.js | tail -2
node tests/template-validates.js | tail -2
sam validate --template template-clean.yaml --region us-east-1 --lint
```
Expected: `42 passed, 0 failed` for the new suite; `114 passed, 0 failed` for `kms-grants-match-code.js` (111 + the three new checks for `AdminCreateAIPromptFunction`); the rest unchanged; `sam validate` clean.

`tests/ai-prompt-lifecycle.js` must stay at 29: it drives the internal seam, which is platform, so nothing it writes is ever encrypted.

- [ ] **Step 5: Commit**

```bash
git add lambda-functions/admin/create-ai-prompt.js template-clean.yaml tests/org-authored-prompts.js
git commit -m "$(cat <<'EOF'
🔒 An organisation's Workie is ciphertext at rest, row and body

Org sets are encrypted per tenant; org Workies are the same kind of
content — prose the customer wrote — and were landing in the table and
the bucket in the clear.

Both halves, because either alone is a false sense of the other.
`ENCRYPTED_FIELDS` encrypts the row; the TEXT is in S3 and the partition
does not reach it, so the body is wrapped whole before PutObject. A row
of ciphertext beside a bucket object anyone can read protects nothing.

`category` and `status` stay readable on purpose — get-ai-prompts.js
filters on both with equality — and platform bodies are untouched, so
the shared library stays readable by everybody.

The template grant is in this commit and not a later one because
tests/kms-grants-match-code.js is the only thing in the repo that can see
the failure: it walks the require graph and goes red the moment a handler
acquires tenant-crypto without kms:Decrypt. That red was watched.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: The list unwraps an org's Workie

Task 6 makes the row and body ciphertext. Without this the library renders `{v:1, iv:…}` where a name should be. Depends on Tasks 4, 5 and 6.

**Files:**
- Modify: `lambda-functions/admin/get-ai-prompts.js` — one import, the per-scope map from Task 4, the enrichment map from Task 4
- Modify: `template-clean.yaml` — `AdminGetAIPromptsFunction`'s `Policies` at `:3617-3621`
- Test: `tests/org-authored-prompts.js` (append section 8)

**Interfaces:**
- Consumes: `decryptItem(orgId, 'prompt', item)`, `decryptValue(orgId, value)` from `./shared/tenant-crypto`.
- Produces: for org rows, `name`/`description`/the template fields come back as strings; for `includeContent=true`, `promptContent` is the document, not an envelope.
- Unchanged for platform and public: no `orgId` exists to name, and `decryptValue`'s passthrough would return the plaintext regardless — but calling it would throw for want of an orgId, which is why the branch is on `ref.orgId` and not on the value.

- [ ] **Step 1: Write the failing test**

Append to `tests/org-authored-prompts.js`:

```js
  say('\n8. …and the list unwraps it');

  // rejects: encrypting on write and forgetting to decrypt on read, which
  // renders `{v:1,iv:…}` where the Workie's name should be.
  store.clear(); s3Store.clear(); s3Meta.clear();
  await mintOrg(ORG);
  const wrapped = parse(await post(HOST, {
    name: 'What we got wrong in Q3', description: 'the honest one',
  }));
  const readBack = await list(HOST);
  await check('the org Workie comes back as sentences, not envelopes', () => {
    const row = readBack.body.prompts.find((p) => p.promptId === wrapped.promptId);
    assert.ok(row, `ids returned: ${readBack.body.prompts.map((p) => p.promptId).join(', ') || '(none)'}`);
    assert.strictEqual(row.name, 'What we got wrong in Q3',
      `name came back as ${JSON.stringify(row.name)}`);
    assert.strictEqual(row.description, 'the honest one');
  });

  // rejects: decrypting the row and leaving the BODY wrapped, so the picker's
  // shape preview and the summary engine both read an envelope.
  const withContent = await list(HOST, { includeContent: 'true' });
  await check('includeContent unwraps the S3 body too', () => {
    const row = withContent.body.prompts.find((p) => p.promptId === wrapped.promptId);
    assert.ok(row.promptContent, 'no promptContent on the row');
    assert.strictEqual(row.promptContent.name, 'What we got wrong in Q3',
      `promptContent.name was ${JSON.stringify(row.promptContent && row.promptContent.name)}`);
    assert.strictEqual(row.promptContent.instructions, 'Summarise the responses.');
  });

  // rejects: naming an orgId on a platform partition, which `requireOrgId`
  // throws on — the whole list would 500 for every caller.
  store.clear(); s3Store.clear(); s3Meta.clear();
  const plain = parse(await post(STAFF, { name: 'Engage house Workie' }));
  const staffList = await list(STAFF, { includeContent: 'true' });
  await check('a platform-only list still succeeds and reads plainly', () => {
    assert.strictEqual(staffList.status, 200, JSON.stringify(staffList.body));
    const row = staffList.body.prompts.find((p) => p.promptId === plain.promptId);
    assert.strictEqual(row.name, 'Engage house Workie');
    assert.strictEqual(row.promptContent.name, 'Engage house Workie');
  });

  /*
    THE MIGRATION, WHICH IS THE PASSTHROUGH RULE. There is no backfill: a row
    written into an org partition before encryption landed is plaintext and must
    keep reading.
  */
  // rejects: a decrypt that throws on plaintext, which would take out every row
  // written before this change.
  store.clear(); s3Store.clear(); s3Meta.clear();
  await mintOrg(ORG);
  store.set(key(`ORG#${ORG}#AIPROMPTS`, 'AIPROMPT#legacy'), {
    PK: `ORG#${ORG}#AIPROMPTS`, SK: 'AIPROMPT#legacy', promptId: 'legacy',
    name: 'Written before the cipher', gameType: 'call-and-answer',
    status: 'active', scope: 'org', orgId: ORG,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  });
  const mixed = await list(HOST);
  await check('a plaintext org row written before encryption still reads', () => {
    const row = mixed.body.prompts.find((p) => p.promptId === 'legacy');
    assert.ok(row, 'the pre-cipher row vanished from the list');
    assert.strictEqual(row.name, 'Written before the cipher');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/org-authored-prompts.js`

Expected — **two FAIL lines**:
- `the org Workie comes back as sentences, not envelopes` → `name came back as {"v":1,"iv":"…","tag":"…","ct":"…"}`
- `includeContent unwraps the S3 body too` → `promptContent.name was undefined` (the body parses to an envelope, which has no `name`)

The platform case and the pre-cipher case must **pass before and after** — they are the "did not over-reach" and "the passthrough migration still holds" halves.

Then, with the implementation written, `node tests/kms-grants-match-code.js` goes to **117 passed, 1 failed**:
```
  FAIL - AdminGetAIPromptsFunction may decrypt
```
Add the template policy only after seeing that line.

- [ ] **Step 3: Write minimal implementation**

In `lambda-functions/admin/get-ai-prompts.js`, beside the Task 4 imports:

```js
const { decryptItem, decryptValue } = require('./shared/tenant-crypto');
```

In the per-scope map from Task 4, replace the body of the `refs.map` callback:

```js
    const perScope = await Promise.all(refs.map(async (ref) => {
      const res = await dynamodb.send(new QueryCommand(buildQuery(promptKey(ref).PK)));
      const items = (res && res.Items) || [];
      /*
        DECRYPT PER SCOPE, BEFORE ANYTHING PROJECTS A FIELD.

        Done here rather than in `decorate` because the org is a property of the
        PARTITION this Query named, and one `ref` covers every row it returned —
        the same shape get-question-sets.js:54-60 uses.

        Platform and public rows are left alone: they were never encrypted, and
        while `decryptValue` would pass their plaintext through regardless,
        calling it would demand an orgId there is none of. A prompt written into
        an org partition before this landed is still plaintext and passes
        straight through. That is the migration: no backfill, both forms
        coexisting in one Query result.
      */
      if (!ref.orgId) return items.map((item) => ({ item, ref }));
      const out = [];
      for (const item of items) {
        out.push({ item: await decryptItem(ref.orgId, 'prompt', item), ref });
      }
      return out;
    }));
```

In the enrichment map from Task 4, unwrap the body:

```js
        if (prompt.s3Key && queryParams.includeContent === 'true') {
          const s3Response = await s3Client.send(new GetObjectCommand({
            Bucket: aiPromptsBucket,
            Key: prompt.s3Key
          }));
          const content = await s3Response.Body.transformToString();
          // An org body was wrapped whole before PutObject
          // (create-ai-prompt.js). `decryptValue` returns anything that is not
          // an envelope unchanged, so a platform body and a pre-cipher org body
          // both pass straight through.
          const parsed = JSON.parse(content);
          const doc = ref.orgId ? await decryptValue(ref.orgId, parsed) : parsed;
          return decorate(prompt, doc, ref);
        }
```

Then, in `template-clean.yaml`, add to `AdminGetAIPromptsFunction`'s `Policies` (currently at `:3617-3621`), as the **first** entry, the same verbatim block:

```yaml
      Policies:
        # Tenant content is encrypted per organisation. This function reads or
        # writes some, so it needs to unwrap that org's data key — and ONLY with
        # an orgId encryption context, which the key policy makes mandatory.
        - Version: '2012-10-17'
          Statement:
            - Effect: Allow
              Action: [ kms:Decrypt ]
              Resource: !GetAtt TenantKey.Arn
        - DynamoDBCrudPolicy:
            TableName: !Ref GameTable
        - S3CrudPolicy:
            BucketName: !Ref AIPromptsBucket
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node tests/org-authored-prompts.js | tail -2
node tests/kms-grants-match-code.js | tail -2
node tests/ai-prompt-lifecycle.js | tail -2
node tests/ai-prompt-status-update.js | tail -2
node tests/template-validates.js | tail -2
sam validate --template template-clean.yaml --region us-east-1 --lint
```
Expected: `46 passed, 0 failed` for the new suite; `117 passed, 0 failed` for `kms-grants-match-code.js`; the rest unchanged; `sam validate` clean.

- [ ] **Step 5: Commit**

```bash
git add lambda-functions/admin/get-ai-prompts.js template-clean.yaml tests/org-authored-prompts.js
git commit -m "$(cat <<'EOF'
🔓 The prompt library unwraps an organisation's Workie

Encrypting on write without decrypting on read renders `{v:1,iv:…}` where
a Workie's name should be. Both halves land together.

Decryption is per SCOPE, not per row: the org is a property of the
partition the Query named, so one ref covers everything it returned —
the shape get-question-sets.js already uses. Platform and public rows are
left alone; `decryptValue` would pass their plaintext through anyway, but
calling it would demand an orgId there is none of.

The S3 body is unwrapped the same way, and the passthrough rule carries
the migration: a prompt written into an org partition before the cipher
landed is plaintext, and reads. Asserted, not assumed.

Second half of the kms:Decrypt pair, again added only after
tests/kms-grants-match-code.js was watched failing on this exact
function.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: A host may knock on `POST /admin/ai-prompts` — **OWNER RULING REQUIRED**

> **⚠️ DO NOT IMPLEMENT THIS TASK WITHOUT THE OWNER'S EXPLICIT RULING.** It reverses a decision that is written down, argued, and deliberate. Everything else in this plan is a consequence of the approved spec; this is not.

**The conflict, stated plainly.**

`lambda-functions/auth/authorizer.js:277-280` says:

> *"NOT included: the prompt LIBRARY writes (`POST/PUT/DELETE admin/ai-prompts…`, `ai-prompt-advisor`, `ai-generate-prompt`). Those shape what the AI does for everybody, and they stay Engage's. The read is here because the builders offer a summary prompt to choose from and cannot without it."*

So `'GET admin/ai-prompts'` is in `HOST_ADMIN_ROUTES` (`:300`) and `POST admin/ai-prompts` is not; it falls through to `if (path.startsWith('admin')) return ['admins'];` (`:357-358`). **A host in an organisation is refused by the authorizer before `create-ai-prompt.js` ever runs.** Tasks 1–7 are, from the product's point of view, unreachable by the only person they are for.

Against that stands the approved spec's **D2** — *"An organisation can author its own Workie"* — and the handoff §4's owner test: *"sharing a question set and a prompt created by a user in an org who is not an engage admin."*

**The argument that the reason has expired**, offered for the owner to accept or reject: the authorizer's stated reason is that a prompt write *"shape[s] what the AI does for everybody"*. That was true when there was one partition. After Task 1 an org's write shapes what the AI does **for that organisation only** — it lands in `ORG#<org>#AIPROMPTS`, is invisible to every other tenant (`findPromptForCaller` never probes an unreadable scope), and cannot become a default (Task 2). This is the same expiry the AI builders went through in the block immediately above, for the same reason: *"That reason has expired. A generation now happens inside an organisation."*

**What it does NOT open.** `PUT`/`DELETE /admin/ai-prompts/{promptId}`, `ai-prompt-advisor` and `ai-generate-prompt` stay admins-only. Those are handoff §3 item 2 and are out of scope; opening the POST without them means a host can author a Workie and not yet edit or retire it, which is an incomplete surface — **name that to the owner as part of the ruling.**

**Files:**
- Modify: `lambda-functions/auth/authorizer.js` — `HOST_ADMIN_ROUTES`, beside `:300`
- Test: `tests/host-ai-builder-routes.js` (the existing suite for this list — read it first and match its shape)

**Interfaces:**
- Produces: `requiredGroupsForRoute('POST', 'admin/ai-prompts')` returns `['hosts', 'admins']`.
- Unchanged: `PUT admin/ai-prompts/{promptId}`, `DELETE admin/ai-prompts/{promptId}`, `POST admin/ai-prompt-advisor`, `POST admin/ai-generate-prompt` all still return `['admins']`.

- [ ] **Step 0: Get the ruling.** Do not proceed without it. If the ruling is "no", stop here and record it in the plan; Tasks 1–7 and 9 stand on their own and the feature waits for a UI that runs as an Engage admin.

- [ ] **Step 1: Write the failing test**

Read `tests/host-ai-builder-routes.js` first and match its harness exactly. Append:

```js
  // rejects: opening the whole prompt library to hosts by prefix rather than by
  // exact pair — PUT and DELETE must stay Engage's until copy-on-write lands.
  check('a host may CREATE a Workie', () =>
    assert.deepStrictEqual(requiredGroupsForRoute('POST', 'admin/ai-prompts').sort(),
      ['admins', 'hosts']));
  check('…and may still read the library', () =>
    assert.deepStrictEqual(requiredGroupsForRoute('GET', 'admin/ai-prompts').sort(),
      ['admins', 'hosts']));
  check('…but may NOT edit one yet', () =>
    assert.deepStrictEqual(requiredGroupsForRoute('PUT', 'admin/ai-prompts/{promptId}'),
      ['admins']));
  check('…nor delete one', () =>
    assert.deepStrictEqual(requiredGroupsForRoute('DELETE', 'admin/ai-prompts/{promptId}'),
      ['admins']));
  check('…nor reach the advisor or the prompt generator', () => {
    assert.deepStrictEqual(requiredGroupsForRoute('POST', 'admin/ai-prompt-advisor'), ['admins']);
    assert.deepStrictEqual(requiredGroupsForRoute('POST', 'admin/ai-generate-prompt'), ['admins']);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/host-ai-builder-routes.js 2>&1 | grep -E 'FAIL|passed,'`

Expected — **one FAIL line**: `a host may CREATE a Workie` → `['admins'] deepStrictEqual ['admins','hosts']`. The other four must pass already; they are the "did not widen too far" half and are the reason this is five assertions and not one.

- [ ] **Step 3: Write minimal implementation**

In `lambda-functions/auth/authorizer.js`, replace the entry at `:298-300`:

```js
  /*
    READ, AND NOW CREATE. Writing the SHARED library is still Engage's.

    The reason this POST was excluded was that a prompt write "shapes what the
    AI does for everybody". That was true of ONE partition. An organisation's
    prompt now lands in `ORG#<org>#AIPROMPTS`, is invisible to every other
    tenant, and cannot be a default — so it shapes what the AI does for THAT
    organisation and nobody else. The same expiry the AI builders went through
    immediately above, for the same reason.

    STILL EXACT PAIRS, and PUT/DELETE are deliberately absent: editing a Workie
    you do not own needs copy-on-write, which is not built. A host may author
    one and read the library; they may not yet change or retire one.
  */
  'GET admin/ai-prompts',
  'POST admin/ai-prompts',
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node tests/host-ai-builder-routes.js | tail -2
node tests/admin-authorization.js | tail -2
node tests/authorizer-identity-source.js | tail -2
node tests/authorizer-org-context.js | tail -2
node tests/question-set-routes-authorization.js | tail -2
```
Expected: `host-ai-builder-routes.js` up by 5; the other four unchanged from their baselines.

- [ ] **Step 5: Commit**

```bash
git add lambda-functions/auth/authorizer.js tests/host-ai-builder-routes.js
git commit -m "$(cat <<'EOF'
🚪 A host in an organisation may create a Workie

Approved by the owner on <DATE>, reversing the exclusion this list has
carried since the AI builders were opened.

The reason for the exclusion was that a prompt write "shapes what the AI
does for everybody". That was a fact about ONE partition. An
organisation's prompt now lands in ORG#<org>#AIPROMPTS, is invisible to
every other tenant, and cannot be a default — so it shapes what the AI
does for that organisation and nobody else. Same expiry the AI builders
went through, for the same reason.

POST only, as an exact pair. PUT and DELETE stay Engage's: editing a
Workie you do not own needs copy-on-write, which is not built, so a host
can author one and read the library and not yet change or retire one.
Four assertions guard that boundary and were watched passing before the
change as well as after.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Full verification

**Files:** none modified.

- [ ] **Step 1: The whole backend suite**

```bash
for t in tests/*.js; do case "$t" in *.spec.js) continue;; esac; node "$t"; done 2>&1 \
  | grep -E '^[0-9]+ passed' | awk '{p+=$1; f+=$3; n++} END {print n" suites, "p" passed, "f" failed"}'
```
Expected with all nine tasks landed: **103 suites, 3324 passed, 0 failed**.

| | suites | passed |
|---|---|---|
| baseline today | 102 | 3265 |
| `tests/org-authored-prompts.js` (new) | +1 | +46 |
| `tests/tenant-crypto.js` (Task 5) | | +2 |
| `tests/kms-grants-match-code.js` (Tasks 6, 7 — 3 checks per newly covered function) | | +6 |
| `tests/host-ai-builder-routes.js` (Task 8) | | +5 |
| **total** | **103** | **3324** |

Without Task 8 (owner ruling withheld): **103 suites, 3319 passed**. Without Tasks 5–7 as well: **103 suites, 3265 + 28 = 3293 passed**, and `tests/org-authored-prompts.js` ends at section 6.

**The failure count is the load-bearing number: it must be 0.** If the passed count differs from the prediction, find which suite moved and why before treating it as a rounding difference — a suite that quietly *lost* tests is exactly what this plan is built to catch.

- [ ] **Step 2: No partition-key literal escaped**

```bash
grep -n "'AIPROMPTS'" lambda-functions/admin/create-ai-prompt.js lambda-functions/admin/get-ai-prompts.js
```
Expected: **exactly three hits, all in `create-ai-prompt.js`** — the `isDefault` sweep's Query `:pk` (`:261`), the sweep's `UpdateCommand` key (`:279`), and the `GAMETYPE#…` pointer `PutCommand` (`:299`). It is four today; Task 1 removes the one at `:205`. **Zero hits in `get-ai-prompts.js`.** Any other hit is a platform-only read or write that survived, which is handoff §1 rule 1.

- [ ] **Step 3: The template still deploys**

```bash
node tests/template-validates.js | tail -2
sam validate --template template-clean.yaml --region us-east-1 --lint
```
Handoff §1 rule 7: `tests/template-validates.js` alone is not enough — a resource that fails to deploy takes the pipeline with it.

- [ ] **Step 4: The frontend is untouched**

No `src/` file is in this plan's File Structure. Confirm against the plan's base commit — **not** against `main`, which is ~170 commits behind this branch and would show the whole tenancy work:
```bash
git diff --stat b74ad1e9 -- src/
```
Expected: no output. If there is any, something outside this plan's scope was changed.

- [ ] **Step 5: Record what is now true, and what is still not**

Append to `docs/handoff/public-library-2026-08-27.md` §0's status table — flip **Prompt scoping foundation** to usable and **Org-authored prompts** to built — and strike item 1 from §3, leaving items 2–6. State plainly what still does not work:

- **`update-ai-prompt.js` and `delete-ai-prompt.js` are still platform-only** (`:109`, `:30`). A host can author a Workie and cannot edit or retire it. Handoff §3 item 2.
- **`get-ai-summary.js` cannot resolve an org Workie** — `:281` and `:315` read `PK: 'AIPROMPTS'` hard-coded, and `:1076` reads the provenance the same way. So an org Workie is authorable and listable and **is not used in a live room**. Handoff §3 item 6.
- **There is still no UI.** No `src/` change was made.

---

## 4. Adjacent findings — raise separately, do not fold in

Four things found while grounding this plan. **None is fixed by any task above**, and two are the owner's call because they mean editing a module the handoff calls complete.

**A1 — `canManagePrompt` has no fail-closed branch for a half-stamped row, and `canManageSet` does.** `question-set-access.js:174-189` reads a row with an `orgId` and no `scope` as **org**, deliberately, with a long comment: *"Reading it as platform would publish one team's content to every other team, silently, with no error anywhere — a fail-OPEN produced by a missing field."* `prompt-access.js:canManagePrompt` does `const scope = clean(item.scope) || tenant.PLATFORM` with no such branch, so a row carrying `orgId: 'X'` and no `scope` reads as platform and becomes manageable by any Engage admin with no active org. `promptOwnerStamp` writes both together so it should be unreachable — which is exactly what the sets comment says about its own branch. **This is the "two libraries with two different permission models" the module's own header warns about.** One-line fix in `prompt-access.js`; not taken here because that module is out of scope by instruction.

**A2 — `promptOwnerStamp` writes `scope: 'platform'` where `ownerStamp` deliberately writes nothing.** `question-set-access.js:376-380`: *"PLATFORM IS STAMPED AS AN ABSENCE… Writing the string would put a new attribute on new platform rows that the ~41 existing ones do not have, so 'unstamped' and 'platform' would stop being the same thing and every reader would need both branches."* `promptOwnerStamp` returns `{scope, …}` unconditionally, so after Task 1 new platform prompt rows carry `scope: 'platform'` and the existing ones carry nothing. Nothing breaks — `canManagePrompt` normalises absence to platform — but the two modules now disagree about a rule one of them argued for at length. Task 4 sidesteps it by projecting `scope` from the ref rather than the row. Same file, same ruling, as A1.

**A3 — `PromptLibraryPanel.jsx:551` renders `<tr key={prompt.promptId || prompt.name}>`.** Harmless today: `generatePromptId()` is time-plus-random and nothing copies a prompt between partitions. The day publishing lands (handoff §3 item 3) the org original and its public copy share a `promptId`, and React gets a duplicate key. **Belongs to the UI stage**, listed here so it is found by the person building it rather than by a rendering bug.

**A4 — `POST /admin/ai-prompts/save` routes to the same function and HAS A LIVE CALLER.** `template-clean.yaml:3687-3692` maps it to `AdminCreateAIPromptFunction`, and `src/src/components/AIGenerationPromptEditor.jsx:209` posts to it from the admin console. **So the generation-prompt editor inherits every change in Tasks 1, 2, 3 and 6 without appearing anywhere in this plan's File Structure**, and one consequence is user-visible:

- An **Engage admin with an active organisation selected** currently saves into `PK: 'AIPROMPTS'`. After Task 1 they save into that org's partition instead (if they hold a role there) or get the 403 (if they do not). That is `canManageScope`'s interlock working exactly as its comment describes — *"an Engage admin standing in TeamG… their rename changed the shared library every organisation reads"* — but it is a change to a shipped surface, and the editor's error path shows `data.error` from a non-`ok` response, so the person sees "Choose an organisation before creating a Workie." rather than a silent failure. **Verify this against the console before deploying Task 1**, and if it is unwanted the answer is a `scope` in the editor's payload, not a relaxation in the handler.
- Separately and pre-existing: that editor's `isEditing` branch also posts to `/save`, and `create-ai-prompt.js:144` mints a **fresh** `promptId` regardless of the one in the body — so "editing" a generation prompt there has always created a second row. Not caused by this plan and not fixed by it. Its own ticket.

---

## 5. What this plan does NOT do

- **No copy-on-write.** Editing a Workie you do not own should copy it into your org first, mirroring `QuestionSetEditor`. That is handoff §3 item 2 and needs `update-ai-prompt.js`, which is out of scope.
- **No resolver change.** `get-ai-summary.js` still reads `PK: 'AIPROMPTS'` hard-coded in four places, so an org Workie is authorable, listable and **unusable in a live room**. Handoff §3 item 6 already says to assume the set-side pin is broken until a test says otherwise; nothing here changes that.
- **No publishing.** A public Workie needs `checkPromptText` and a copy handler. Handoff §3 item 3.
- **No UI.** Nothing in `src/` is touched, so nobody can do any of this through the product.
- **No migration, anywhere.** Platform DynamoDB keys and platform S3 keys are byte-identical to what they are today, which is asserted in Tasks 1 and 3 and is the whole trick.
