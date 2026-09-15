# Archive: full-fidelity backup and restore for Engage and public content

**Status:** approved by the owner 2026-09-15, with three amendments (below)
**Date:** 2026-09-14, amended 2026-09-15
**Discovery:** read-only audit of the current feature, including a probe that drove the
real `export-to-archive.js` → `import-from-archive.js` handlers against an in-memory
table. Every loss listed in §2 was observed, not inferred.

## 0. Amendments on approval (2026-09-15)

The owner approved with: *"yes, update node, secure and make sure that all tiers can access
dev/test/prod. this is primarily for protecting."* Those three instructions, plus what
planning found in the code, changed the sections marked below. The body of this document
is the amended version; this list is only the trail.

| # | Change | Where |
|---|---|---|
| A1 | The runtime move to `nodejs22.x` is **required**, not advisable | D4, §5 |
| A2 | **Every tier reaches the archive** is a checked property: a pre-flight proves each tier signs and may invoke before the lock, the archive deploy refuses to lock otherwise, and a post-lock check proves each tier still gets in | §4.6, §5 |
| A3 | Protection hardening in the lock-down deploy: `Retain` on the archive table and bucket, point-in-time recovery on the table, browser CORS removed | §4.6 |
| A4 | Media is filed under a **snapshot id minted by export** — the archive id does not exist until the upload, which happens after the copy | §4.1, §4.5 |
| A5 | The archive API id reaches the main stack through a template `Mappings` entry pinned by a test against `config/archive-service.json`, **not SSM**: an SSM parameter would have to be created by hand before Phase 1 could deploy on any tier | §4.6 |
| A6 | Export also requires `canManageScope(PLATFORM)`; a bare id is accepted and means platform, which is what the prompt manager's *Copy to archive* sends | §4.2 |
| A7 | **Any encrypted value refuses the item**, on export and on import. `publish-question-set.js` spreads the org's metadata row into the public row, so a public set's `name` can be ciphertext | §4.2, §4.3 |
| A8 | A prompt whose text lives on its row (the `gen-*` rows, no `s3Key`) is archived with `body: null` | §4.1, §4.2 |
| A9 | A restore **never changes which prompt is a default**: a recreated prompt is not a default, an existing prompt keeps its current `isDefault` | §4.3 |
| A10 | Restoring into an unversioned set snapshots its legacy rows to `v1` first, as a replace does, so the superseded content stays reachable | §4.3 |
| A11 | A restore never overwrites an image that already exists in the tier's media bucket | §4.5 |
| A12 | `REVIEW` and `PUBLISHED` rows (publication lifecycle, not content) are not archived | §4.1 |
| A13 | A legacy CSV whose name matches an existing set is refused — with no suffix there is no automatic rename | §4.8 |
| A14 | The admin screen shows which tier each backup came from, filters by tier, and confirms before an import | §4.7 |

## 1. What this is for

The owner's request: make archiving question sets and prompts "as robust as the question
set capabilities", for **public and Engage (platform) content only**.

Organisation content is out of scope on purpose. Org sets and org prompts are encrypted
per organisation — `tenant-crypto.js` wraps a per-org data key under one KMS key with a
mandatory `orgId` encryption context — and archiving ciphertext, or decrypting it outside
its organisation, is a key-management problem the owner has chosen not to take on.

A backup is only worth having if restoring it gives back what was saved. Today it does
not, and the store it lives in can be deleted by anyone who finds its address.

## 2. What is broken today

### 2.1 A backup loses most of what it was meant to keep

| Content | What a restore does today | Cause |
|---|---|---|
| Poll questions | every option lost; `options: []`, `allowMultiple: false` | poll falls into the 4-column CSV branch (`export-to-archive.js:640-672`) |
| Trivia options E and F | dropped; `correctAnswer: OptionE` points at nothing | trivia branch writes A–D only (`:623-635`) |
| Uploaded images | key string kept, object never copied, image broken | S3 object not archived; `toMediaKey` re-keys to a new set id |
| Set settings | `customInstruction`, `aiContextInstruction`, `personaId`, `roundNoun`, `roundKind`, `roundKindBrief`, `Quickstart`, `isAIGenerated`, version history all reset | import passes a synthetic `{body}` to `upload-questions` (`import-from-archive.js:192-214`) |
| Active status | **forced active** — a deactivated Engage set goes live for every organisation | `upload-questions.js:842` (`active: isAIGenerated ? false : true`), import passes `isAIGenerated: false` |
| Identity | always a new set, slug `<name>importedYYYYMMDD`; nothing pinned to the original id is restored | `import-from-archive.js:195-197` |
| Names | ` (Imported …)` and `Exported from … environment` appended on every trip | `export:273-274`, `import:195-204` |
| Public sets | listed on the export tab, fail with "not found" | export reads the platform key only (`export:159-162`) |
| Prompts | new id, status forced `draft`, default pointer never archived, row and body drift apart | `import:296-437` |

### 2.2 The backup store has no authentication

`template-archive.yaml` declares no authorizer on any of its six routes — including
`POST`, `PUT` and `DELETE /archive/items/{archiveId}` — behind the public domain
`archive.seibtribe.us`. `ArchivePanel.jsx` calls all of them with a plain `fetch`
(`:76, :142, :170, :195, :233, :271`). The discovery read all 41 archived items without
credentials. Anyone who learns the address can read, overwrite or delete every backup.

### 2.3 The scope boundary holds by accident, not by rule

Export happens to refuse org content only because it reads the platform key and an org id
is therefore "not found". Import writes to `PK 'SETS'` unconditionally, with no creator,
and applies only the route's `admins` gate — not the tenant interlock
`canManageScope(event, PLATFORM)` (`admins` **and** no active organisation). An Engage
admin standing inside a customer team can reach both routes.

## 3. Decisions (approved by the owner, 2026-09-14)

| # | Decision | Chosen |
|---|---|---|
| D1 | Approach | **Full snapshot in the main app.** The archive service stays a blob store. |
| D2 | Restoring a set whose id exists | **New version of the existing set, then make it current.** Recreate under the original id when it does not exist. |
| D3 | Restoring a public set | **Lands in Engage's library** as a house copy. No new public writer. |
| D4 | Archive service security | **Lock it down in this work**, with one manual deploy that also moves the runtime off Node 18 (required — A1), after every tier is proven able to reach it (A2). |

Defaults stated to the owner and not overridden:

- **Images are copied** into the archive, so a backup restores on any tier.
- **Every snapshot is kept**, not only the latest.
- **The dead `list-local-archive` route is deleted.**
- **A restored prompt never becomes a default** automatically.
- **A restored set keeps the active status it had** when backed up.

## 4. Design

### 4.1 The snapshot envelope

Export stores one JSON document per item. It is **wholesale, not an allow-list**: every
attribute of every row is copied. An allow-list is what dropped `Image`, `AnswerDetails`,
poll options and trivia E/F — each new field became a new silent loss. Copying rows
verbatim makes the next field survive without anyone remembering it.

```json
{
  "schema": "engage.set/1",
  "snapshotId": "5b0c…",
  "exportedFrom": { "tier": "dev", "scope": "platform", "setId": "teamretro", "version": 2 },
  "exportedAt": "2026-09-14T15:00:00.000Z",
  "metadata": { "name": "...", "active": false, "roundKind": "...", "…": "every attribute, minus PK/SK" },
  "rows": [ { "SK": "CATEGORY#c001", "…": "…" }, { "SK": "QUESTION#c001#001", "…": "…" } ],
  "media": [ { "key": "sets/teamretro/smile.jpg", "archiveKey": "archive/media/<snapshotId>/sets/teamretro/smile.jpg" } ],
  "links": { "promptName": "Workie - The Verdict Board" }
}
```

- `rows` is **every row of the resolved content partition** (`CATEGORY#…`, `QUESTION#…`,
  and any other SK), read by PK with no SK prefix, following
  `copy-question-set.js:147-152`. **PK is dropped and SK is kept**: SK carries the
  structure, including category order, which is the 24-bit host-mask bit order
  (`upload-questions.js:870-881`). PK is rebuilt on import from the target scope.
  The two publication-lifecycle rows, `REVIEW` and `PUBLISHED` (`shared/set-review.js:75-78`),
  are the only rows left out (A12): they record a verdict about a version in another
  library, not content.
- `snapshotId` is minted by export and names the media folder (A4).
- `links.promptName` carries the linked prompt's name, for the relink fallback in §4.3.
- Prompts use `"schema": "engage.prompt/1"` with `metadata` (the row, minus PK/SK) and
  `body` (the current S3 body, verbatim — or `null` for a prompt whose text lives on the row
  itself, A8).
- The archive item keeps its existing `contentType` (`questionset` / `prompt`) so current
  filters work, and gains tags `schema:engage.set/1`, `scope:<scope>`,
  `source:<scope>/<id>`, `exportedAt:<iso>` so the UI can group snapshots per source.

### 4.2 Export

`POST /admin/export-to-archive` requires `canManageScope(event, PLATFORM)` (A6) and accepts
`{scope, id}` pairs. A bare id is still accepted and **means platform** — the house rule
(`set-version.js:30-35`) and exactly what the prompt manager's *Copy to archive* sends. The
archive screen sends pairs, because a request without scope is how public sets fail today.

For each pair:

1. **Refuse org scope by name**, before any read: `"Organisation content is not archived: it is encrypted per organisation."` Nothing is uploaded.
   **Refuse any item carrying an encrypted value** anywhere in its metadata or rows (A7),
   detected with `tenant-crypto.js`'s `isEnvelope`.
2. Build every key through `tenant.js` / `set-version.js` / `prompt-access.js`. No
   partition literals — `tests/no-global-partition-literals.js` enforces `SETS`/`GAMES`,
   and this work removes the existing `PK:'AIPROMPTS'` literals at `export:375` and
   `import:398` too.
3. Resolve the active version, read the metadata row and the whole content partition,
   refuse an empty read (existing rule, `export:227-236`).
4. Copy media (§4.5), build the envelope, upload.
5. **Write nothing to the main table.** The `PK:'ARCHIVE'` rows (`export:323-346`,
   `:571-594`) are read by nothing and are removed.

### 4.3 Import and restore

`POST /admin/import-from-archive` requires `canManageScope(event, PLATFORM)` in the
handler, not only the route's `admins` gate. Detection is by content: a JSON body with a
`schema` field takes the snapshot path; anything else takes the legacy path (§4.8).

**Every restore lands in PLATFORM.** A platform item restores to platform; a public item
restores to platform as a house copy (D3). An item whose envelope says `scope: org` is
refused, though export never creates one.

**Sets — id exists on this tier (D2):**

0. If the set has never been versioned, copy its legacy `SET#<id>` rows to `SET#<id>#v1`
   and seed `versions[]` with that entry first — exactly what `upload-questions.js:776-798`
   does before a replace (A10).
1. Write the snapshot `rows` to a new content partition `SET#<id>#v<n+1>`, keys via
   `setContentPk`.
2. Append to `versions[]`:
   `{ version: n+1, createdAt, questionCount, categoryCount, sourceFile: "archive:<archiveId>", note: "Restored from archive <archiveId>, exported <exportedAt> from <tier>" }`.
3. Apply the snapshot's metadata settings to the live row, then flip `activeVersion` to
   `n+1` atomically — the same flip `upload-questions.js:1073-1124` uses for a replace.
4. The previous version is untouched, so the owner can roll back from the versions screen.

**Sets — id does not exist:** create the metadata row under the **original id** with the
content at `SET#<id>#v1` and a single `versions[]` entry. The snapshot holds one version's
content; the archived `versions[]` list refers to content that was not saved, so it is not
restored. The original version number is recorded in the note.

**Restoring into platform strips org-shaped attributes.** Platform rows carry no `scope`
or `orgId` — "that absence IS the platform marker" — and commit `abe1334d` exists because a
half-stamped row once read as the wrong scope. So a restored platform row drops top-level
`scope`, `orgId`, `sourceOrgId` and `publishedAt`, and keeps provenance only in one nested,
non-routing object:
`restoredFrom: { archiveId, scope, setId, tier, exportedAt, sourceOrgId? }`.

**Fields on restore:**

| Field | Restored as |
|---|---|
| Settings (`name`, `description`, `customInstruction`, `aiContextInstruction`, `personaId`, `roundNoun`, `roundKind`, `roundKindBrief`, `engagementType`, `Quickstart`, `isAIGenerated`, `promptId`) | from the snapshot, **no suffixes** |
| `active` | from the snapshot. The import result lists every set that became active, because an active platform set is live for every organisation. |
| `createdBy` / `createdByName` | preserved. Platform manageability is decided by scope, not by creator, so a creator id from another tier grants nothing. |
| `restoredBy` / `restoredAt` | stamped with the importing staff member |

**Prompts** follow the same rule as sets. If the original `promptId` exists on this tier,
the snapshot becomes a new version of **that** prompt, as `update-ai-prompt.js` mints one,
and the previous body stays in S3. If it does not exist, the prompt is recreated under the
original id. Either way the id is kept, which keeps set → prompt links by id. Row and body
come from the snapshot; `status` is preserved; **a restore never changes which prompt is a
default** (A9) — a recreated prompt has `isDefault: false`, an existing prompt keeps the
`isDefault` it has now, and the `GAMETYPE#…` default pointer is never written. Choosing a
default is a house decision made in the UI, in both directions: a restore that silently
un-defaulted the live default would change every room of that type. The body is written at `promptBodyKey` (`prompt-access.js:69-75`), not the
hand-built key at `import:381`. A restored set keeps its `promptId` when that prompt exists
on this tier; otherwise it is relinked by `links.promptName` through the existing
`archive-prompt-link.js`, and left unlinked when nothing matches. Public prompts have no
writer and none exist, so they are neither exported nor restored. Any envelope carrying an
encrypted value is refused before anything is written (A7).

### 4.4 Restore result

Import answers with what it did, per item, so a restore cannot silently publish content.
`results.successful` / `results.failed` keep their current names so existing callers keep
working; a refusal is a `failed` entry with `refused: true`:

```json
{ "results": {
    "successful": [ { "archiveId": "…", "kind": "set", "id": "teamretro", "name": "Team Retro",
                      "mode": "new-version", "version": 3, "active": true } ],
    "failed":     [ { "archiveId": "…", "refused": true, "error": "Organisation content is not archived: …" } ],
    "totalRequested": 2 },
  "becameActive": [ { "id": "teamretro", "name": "Team Retro" } ],
  "media": { "copied": 12, "kept": 3, "missing": [ "sets/teamretro/old.png" ] } }
```

### 4.5 Media

- **Export:** for every question `Image` that is a media key (not `https://`, not
  `/`-rooted — `isMediaKey` in `shared/set-media.js`, the read side of `toMediaKey`),
  `CopyObject` from the tier's `${StackName}-media` bucket to
  `engage2-archive-content/archive/media/<snapshotId>/<key>`, recorded in `media[]` (A4).
- **Import:** `CopyObject` each back to exactly the key the row names, in the target tier's
  media bucket — **unless an object is already there**, which is kept and counted (A11). The
  id is preserved, so the key in the question row still matches. Only `sets/<id>/<file>`
  keys are ever written.
- Missing-versus-forbidden is only distinguishable with `s3:ListBucket` on the bucket (S3
  answers 403, not 404, for an absent key otherwise), so both functions are granted it.
- A **missing object is reported, never fatal**, on either side — media already outlives
  its set (`delete-question-set.js` never touches S3), and a restore should not fail over one
  lost image.
- No inline base64: the archive API is API Gateway → Lambda, with a 6 MB payload limit.
- Deleting an archive item orphans its media objects. That costs storage, not correctness,
  and is left alone.

### 4.6 Locking down the archive service (D4)

**Mechanism: AWS IAM on the archive, with every browser call going through the main app.**

One archive service is shared by all three tiers (`ARCHIVE_SERVICE_URL` is the same
constant in every tier), while each tier has its own Cognito user pool. A Cognito or JWT
authorizer on the archive would have no single pool to trust. IAM does not have that
problem: the archive trusts the AWS account, and **who may act** is decided in the main app,
where the tenant rules already live.

- **Archive stack:** every route gets `AWS_IAM` authorization. Nothing is callable without a
  signed request from an AWS principal.
- **Main stack:** the handlers that call the archive sign their requests with SigV4
  (`@smithy/signature-v4` and `@aws-crypto/sha256-js`, already present in the admin bundle
  through the AWS SDK — declared explicitly in `lambda-functions/admin/package.json` so the
  build does not depend on a transitive copy). Their roles get `execute-api:Invoke` on the
  archive API's `/archive/*` routes.
- **Signed calls go to the regional `execute-api` endpoint, not `archive.seibtribe.us`.**
  CloudFront rewrites the `Host` header, and SigV4 signs it, so a signed request through the
  CloudFront domain fails. `ARCHIVE_SERVICE_URL` becomes the execute-api URL. The CloudFront
  distribution is then unused; removing it is left for later.
- **The archive API id** reaches the main stack through a template `Mappings` entry
  (`ArchiveService → Api → Id`), pinned by a test against `config/archive-service.json`, which
  `scripts/deploy-archive.sh` writes from the stack's output (A5). Not `!ImportValue`, which
  would pin the hand-deployed stack's export forever; not SSM, which would need a parameter
  created by hand before Phase 1 could deploy anywhere; not a template `Parameter` default,
  which a stack update silently keeps at its previous value.
- **Every tier reaches the archive (A2).** All three tiers deploy the same template, so
  each tier's export, import and proxy functions get the same `execute-api:Invoke` grant.
  `scripts/archive-access-check.sh` proves it against live AWS: `preflight` checks, per tier,
  that each function names the execute-api URL, that IAM simulation allows its calls, and
  that the tier's proxy lists the archive with a signed request; `verify` additionally
  checks that an unsigned request is refused. `scripts/deploy-archive.sh` runs `preflight`
  before deploying and `verify` after, and refuses to deploy when `preflight` fails.
- **Hardening in the same deploy (A3):** `DeletionPolicy`/`UpdateReplacePolicy: Retain` on
  `ArchiveTable` and `ArchiveBucket`, so no template edit or stack deletion can destroy the
  backups; point-in-time recovery on the table (35 days, matching the bucket's existing
  90-day noncurrent-version retention for content); the API's `CorsConfiguration` removed,
  since no browser calls it any more.
- **New main-stack admin routes** proxy the reads and deletes the browser does today: list,
  get, search, delete. Each is `CognitoAuthorizer` + `admins` at the route and
  `canManageScope(event, PLATFORM)` in the handler.
- **The manual "Upload New Item" form is removed.** It stores `document`, `template` and
  `report` types that nothing can import. Uploads happen only through export.

### 4.7 The admin screen

`ArchivePanel.jsx`:

- all six direct `fetch` calls become `authFetch` to the main-stack routes; the
  `archive.seibtribe.us` literal leaves the frontend
- export sends `{scope, id}` pairs; public sets become exportable
- items show their scope and group snapshots per source, newest first
- import handles a mixed selection by item, not by the type of the first item
  (`:343-344` today)
- the restore result (§4.4) is shown, including which sets became active
- each item shows the tier it came from, the list filters by tier, and an import is confirmed
  first, naming the tier it will write to (A14) — every tier reads every tier's backups, so
  "which environment is this from" is the first question
- the per-card Import on the Browse tab is **removed**. `AdminPage.jsx:1701-1705` mounts
  the panel without `onQuestionSetImport`, so `:521-525` has never been reachable, and the
  Import tab already does the same job. Wiring a second route to one action is not needed.

### 4.8 The 41 existing items

All 41 are CSV or JSON from before this change, all tagged `dev`. They keep importing
through the existing path, with two corrections so the legacy path stops doing harm:

- **no suffixes** added to name or description
- **lands inactive.** A legacy item does not record whether the set was active, and the
  alternative is publishing an Engage set to every organisation on an unknown status. The
  owner activates it from the question sets panel. Implemented as an additive
  `startInactive` flag on `upload-questions.js`, so there is no moment at which the set is
  live.
- **a name collision is refused** with the upload's own "already exists" message (A13).
  Without the suffix there is no automatic rename, and overwriting a live set from a CSV of
  unknown vintage is not a restore.

No migration is run. Re-exporting a platform set once produces a full-fidelity backup.

### 4.9 Removed

- `AdminListLocalArchiveFunction` and `list-local-archive.js` — hard-codes the archive
  stack's table while its IAM covers only `GameTable`, so every call is AccessDenied; no
  caller exists.
- the two `PK:'ARCHIVE'` Put blocks in `export-to-archive.js`
- `kms:Decrypt` on the import function (`template-clean.yaml:4090-4094`) — import never
  touches org content and now refuses it
- `DynamoDBCrudPolicy` on the export function, narrowed to `DynamoDBReadPolicy` — export
  writes nothing to the main table
- an optional sweep script for the existing inert `ARCHIVE` rows, not run automatically

## 5. Rollout — the order matters

**Locking the archive before every tier signs its requests breaks that tier's archive.**
A signed request to an unauthenticated route is accepted, so the app side can ship first
safely; the reverse cannot.

1. **Phase 1 — main app, through the pipeline, every tier.** Snapshot export and import,
   media copy, signed requests, the proxy routes, the admin screen changes, and
   `ARCHIVE_SERVICE_URL` moved to the execute-api endpoint. The archive is still open, so
   everything keeps working. Ship dev → test → prod and confirm a backup and restore on each.
2. **Phase 2 — archive stack, deployed by hand**, only after Phase 1 is live on every tier
   and `scripts/archive-access-check.sh preflight` passes for all three: `AWS_IAM` on all
   routes, `Runtime: nodejs22.x` (required, A1) and the hardening in §4.6 (A3), in one
   deploy through `scripts/deploy-archive.sh`, which runs the pre-flight itself and
   `verify` afterwards. `tests/template-validates.js` moves `template-archive.yaml` from
   *reported* to *enforced* in the same change. (`nodejs18.x` fails `sam validate --lint`;
   all six functions were nevertheless updated successfully on 2026-08-23, so updates are
   not blocked — but Node 18 receives no security patches.)
3. **Rollback of Phase 2** is a redeploy of the archive stack without `AWS_IAM`. Phase 1
   keeps working against an open archive.

## 6. Testing

Backend suites are standalone node scripts (`node tests/<file>.js`), written test-first.

1. **Scope boundary** (`tests/archive-scope-boundary.js`): an org set and an org prompt are
   refused by name on export and nothing is uploaded; a public set exports with a
   `scope:public` tag; an envelope claiming `scope: org` is refused on import; a caller with
   an active organisation is refused by `canManageScope(PLATFORM)`; no import ever writes an
   `ORG#` or `PUBLIC#` key.
2. **Set round trip** (`tests/archive-set-snapshot-roundtrip.js`): poll, trivia (six
   options, `correctAnswer: OptionE`) and call-and-answer sets seeded with every field in
   §2.1, categories in a non-alphabetical order, `activeVersion: 2`, `active: false`. Export,
   clear the store, import; assert every question attribute, category order, every setting,
   the original id, `active: false`, and no suffixes. A second round trip is byte-identical
   to the first.
3. **Restore into an existing id**: a new version is written and made current, the previous
   version is intact, and a game pinned to the previous version still reads it.
4. **Public restores to platform**: the restored row carries no top-level `scope`, `orgId`,
   `sourceOrgId` or `publishedAt`, and `restoredFrom` holds the provenance.
5. **Media**: objects copied out and back; `https://` and `/assets` images untouched; a
   missing object is reported and the restore still succeeds.
6. **Prompt round trip** (extends `tests/prompt-archive-roundtrip.js`): row and body verbatim,
   original id reused, status preserved, `isDefault` false, no default pointer written.
7. **Legacy**: a CSV-era item still imports, without suffixes, and inactive.
8. **Security**: each proxy route refuses a caller who cannot manage platform content; the
   archive client's signature is checked by an independent SigV4 computation over the
   request it actually sends; a frontend guard asserts no source file under `src/` calls
   `archive.seibtribe.us` directly.
9. **Removed**: export issues no write against the main table; the template no longer
   declares `AdminListLocalArchiveFunction`.
10. **Protection (amendments)**: an item carrying an encrypted value is refused on export
    and import (A7); a restore over the live default prompt leaves it the default (A9); a
    restore into an unversioned set leaves its legacy content reachable as `v1` (A10); an
    existing image is never overwritten (A11); a legacy CSV colliding with a live set is
    refused and changes nothing (A13).
11. **Every tier (A2)**: `tests/archive-infrastructure.js` asserts that every function the
    access check names exists in the template with the execute-api URL and the invoke grant,
    that the mapped API id matches `config/archive-service.json`, that the archive template
    is locked, on `nodejs22.x` and retained, and that `deploy-archive.sh` runs `preflight`
    before `sam deploy` and `verify` after. Live, `archive-access-check.sh` and a restore
    drill on dev and test prove it against real AWS.
12. Baselines hold: backend 113/113 plus the new suites, frontend 197 suites / 4898 tests plus
    the new ones, lint 0 errors / 11 warnings, build compiles.

## 7. Out of scope

- organisation sets and prompts, by the owner's decision
- per-source keys, deduplication or pagination inside the archive service itself
- public prompts, which have no writer
- removing the `archive.seibtribe.us` CloudFront distribution
- the unpaginated Scan in the archive stack's `list-archive.js` — noted, not required here
- the publish flow copying an organisation's encrypted metadata into the public row
  (`publish-question-set.js` spreads `...meta` without `decryptItem`) — a separate bug; this
  work only refuses to archive its result (A7)
- a tier-restricted delete. Every tier may delete any backup, as it may read any; a deleted
  item stays recoverable through the bucket's noncurrent versions (90 days) and the table's
  point-in-time recovery (35 days)

## 8. Verified against live AWS (2026-09-14)

Each assumption the design rests on was checked with the `adminaccess` profile, account
`239601476690`:

| Assumption | Result | Evidence |
|---|---|---|
| All three tiers and the archive run in one AWS account | **Holds** | `engagedev`, `engagetest`, `engageprod` and `engage2-archive-service` all resolve in `239601476690` |
| The archive bucket's policy does not deny main-stack roles | **Holds** | `engage2-archive-content` has no bucket policy (`NoSuchBucketPolicy`); identity policies on the main-stack roles are sufficient |
| The archive stack's runtime | **`nodejs18.x`, updatable** | all six functions on `nodejs18.x`, last modified 2026-08-23 — see §5 step 2 |

One assumption remains for Phase 1 to prove rather than for inspection to settle: that
API Gateway accepts a SigV4-signed request on a route with no authorizer. The rollout in
§5 depends on it, and the first dev deploy of Phase 1 demonstrates it before the archive
is locked — `archive-access-check.sh preflight engagedev` lists the archive through dev's
signed proxy.

Not yet checked live, because the SSO session had expired when planning reached it: whether
any `PUBLIC#SETS` row on any tier already carries an encrypted `name`. A7 refuses such an
item either way; the check only tells the owner whether the publish flow has already
produced one.
