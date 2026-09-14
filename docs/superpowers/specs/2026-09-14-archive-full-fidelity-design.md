# Archive: full-fidelity backup and restore for Engage and public content

**Status:** proposed, awaiting owner review of this document
**Date:** 2026-09-14
**Discovery:** read-only audit of the current feature, including a probe that drove the
real `export-to-archive.js` → `import-from-archive.js` handlers against an in-memory
table. Every loss listed in §2 was observed, not inferred.

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
| D4 | Archive service security | **Lock it down in this work**, with one manual deploy that also moves the runtime off Node 18. |

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
  "exportedFrom": { "tier": "dev", "scope": "platform", "setId": "teamretro", "version": 2 },
  "exportedAt": "2026-09-14T15:00:00.000Z",
  "metadata": { "name": "...", "active": false, "roundKind": "...", "…": "every attribute, minus PK/SK" },
  "rows": [ { "SK": "CATEGORY#c001", "…": "…" }, { "SK": "QUESTION#c001#001", "…": "…" } ],
  "media": [ { "key": "sets/teamretro/smile.jpg", "archiveKey": "archive/media/<archiveId>/smile.jpg" } ]
}
```

- `rows` is **every row of the resolved content partition** (`CATEGORY#…`, `QUESTION#…`,
  and any other SK), read by PK with no SK prefix, following
  `copy-question-set.js:147-152`. **PK is dropped and SK is kept**: SK carries the
  structure, including category order, which is the 24-bit host-mask bit order
  (`upload-questions.js:870-881`). PK is rebuilt on import from the target scope.
- Prompts use `"schema": "engage.prompt/1"` with `metadata` (the row, minus PK/SK) and
  `body` (the current S3 body, verbatim).
- The archive item keeps its existing `contentType` (`questionset` / `prompt`) so current
  filters work, and gains tags `schema:engage.set/1`, `scope:<scope>`,
  `source:<scope>/<id>`, `exportedAt:<iso>` so the UI can group snapshots per source.

### 4.2 Export

`POST /admin/export-to-archive` accepts `{scope, id}` pairs, never a bare id — a bare
`setId` means platform (`set-version.js:30-35`), and a request without scope is how public
sets fail today.

For each pair:

1. **Refuse org scope by name**, before any read: `"Organisation content is not archived: it is encrypted per organisation."` Nothing is uploaded.
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
come from the snapshot; `status` is preserved; **`isDefault` is always `false`** and the
`GAMETYPE#…` default pointer is never written — choosing a default is a house decision made
in the UI. The body is written at `promptBodyKey` (`prompt-access.js:69-75`), not the
hand-built key at `import:381`. The existing by-name relink stays as a fallback for sets
whose prompt id is taken. Public prompts have no writer and none exist, so they are
neither exported nor restored.

### 4.4 Restore result

Import answers with what it did, per item, so a restore cannot silently publish content:

```json
{ "restored": [ { "id": "teamretro", "mode": "new-version", "version": 3, "active": true } ],
  "refused":  [ { "archiveId": "…", "reason": "Organisation content is not archived" } ],
  "media":    { "copied": 12, "missing": [ "sets/teamretro/old.png" ] } }
```

### 4.5 Media

- **Export:** for every question `Image` that is a media key (not `https://`, not
  `/`-rooted — the rule in `toMediaKey`, `upload-questions.js:80-91`), `CopyObject` from the
  tier's `${StackName}-media` bucket to
  `engage2-archive-content/archive/media/<archiveId>/<file>`, recorded in `media[]`.
- **Import:** `CopyObject` each back to `sets/<id>/<file>` in the target tier's media
  bucket. The id is preserved, so the key in the question row still matches.
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
- **The archive API id** reaches the main stack through SSM
  (`/engage2-archive-service/api-id`, written by `scripts/deploy-archive.sh`) and a
  `{{resolve:ssm:…}}` dynamic reference — not `!ImportValue`, which would pin the
  hand-deployed stack's export forever.
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
- the per-card Import on the Browse tab is **removed**. `AdminPage.jsx:1701-1705` mounts
  the panel without `onQuestionSetImport`, so `:521-525` has never been reachable, and the
  Import tab already does the same job. Wiring a second route to one action is not needed.

### 4.8 The 41 existing items

All 41 are CSV or JSON from before this change, all tagged `dev`. They keep importing
through the existing path, with two corrections so the legacy path stops doing harm:

- **no suffixes** added to name or description
- **lands inactive.** A legacy item does not record whether the set was active, and the
  alternative is publishing an Engage set to every organisation on an unknown status. The
  owner activates it from the question sets panel.

No migration is run. Re-exporting a platform set once produces a full-fidelity backup.

### 4.9 Removed

- `AdminListLocalArchiveFunction` and `list-local-archive.js` — hard-codes the archive
  stack's table while its IAM covers only `GameTable`, so every call is AccessDenied; no
  caller exists.
- the two `PK:'ARCHIVE'` Put blocks in `export-to-archive.js`
- `kms:Decrypt` on the import function (`template-clean.yaml:4090-4094`) — import never
  touches org content and now refuses it
- an optional sweep script for the existing inert `ARCHIVE` rows, not run automatically

## 5. Rollout — the order matters

**Locking the archive before every tier signs its requests breaks that tier's archive.**
A signed request to an unauthenticated route is accepted, so the app side can ship first
safely; the reverse cannot.

1. **Phase 1 — main app, through the pipeline, every tier.** Snapshot export and import,
   media copy, signed requests, the proxy routes, the admin screen changes, and
   `ARCHIVE_SERVICE_URL` moved to the execute-api endpoint. The archive is still open, so
   everything keeps working. Ship dev → test → prod and confirm a backup and restore on each.
2. **Phase 2 — archive stack, deployed by hand by the owner**, only after Phase 1 is live on
   every tier: `AWS_IAM` on all routes and `Runtime: nodejs22.x`, in one deploy.
   The runtime move is **advisable, not forced**. `tests/template-validates.js:52-64`
   records that `nodejs18.x` fails `sam validate --lint` and that its update path would be
   blocked from 2025-11-01 — but all six archive functions were successfully updated on
   **2026-08-23** (verified 2026-09-14, `aws lambda list-functions`), so updates are not
   blocked in practice. Node 18 no longer receives security patches, and the same deploy
   is the natural place to move off it.
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
   archive client builds a SigV4-signed request against the execute-api host; a frontend
   guard asserts no source file under `src/` calls `archive.seibtribe.us` directly.
9. **Removed**: export issues no write against the main table; the template no longer
   declares `AdminListLocalArchiveFunction`.
10. Baselines hold: backend 113/113, frontend 197 suites / 4898 tests, lint 0 errors / 11
    warnings, build compiles.

## 7. Out of scope

- organisation sets and prompts, by the owner's decision
- per-source keys, deduplication or pagination inside the archive service itself
- public prompts, which have no writer
- removing the `archive.seibtribe.us` CloudFront distribution
- the unpaginated Scan in the archive stack's `list-archive.js` — noted, not required here

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
is locked.
