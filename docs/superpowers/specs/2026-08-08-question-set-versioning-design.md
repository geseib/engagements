# Question Set Versioning, Replace & Media — Design

**Date:** 2026-08-08
**Status:** Approved (owner chose versioned sets, warn-on-delete, dedicated media bucket)
**Branch:** `dev`

## Problem

The question-set admin can edit five fields. Everything else set at creation —
engagement type until today, the questions themselves, images — is unreachable after
import. Re-importing an existing set id is a hard dead end:

```
upload-questions.js:399
"Question set X already exists. Please use a different title or delete the existing set first."
```

So the only way to fix a typo in one row is to delete the whole set and re-upload,
which loses the set id, its prompt, its persona and its instructions.

Two hazards make a naive fix dangerous:

1. **A live game reads questions at runtime.** `next-question.js:119,225,521,548`,
   `get-question.js:84`, `get-categories.js:26`, `select-question.js:26` all read
   `PK=SET#<setId>` while a game is in play. Games do not snapshot at start. Replacing
   a set under a running game changes its questions mid-session.
2. **Delete-then-write destroys data on failure.** If the new CSV fails halfway, the
   old questions are already gone.

## Approach — versioned sets

Versioning solves both at once. A game pins the version it started on, so replacing a
set cannot disturb a running game, and the old version remains as the rollback.

### Key schema

```
PK = SETS              SK = SET#<setId>              set metadata (unchanged location)
PK = SET#<setId>#v<n>  SK = QUESTION#<cat>#<num>     questions, per version
PK = SET#<setId>#v<n>  SK = CATEGORY#<cat>          categories, per version
```

Set metadata gains:

```
activeVersion: 3
versions: [{ version, createdAt, questionCount, sourceFile, note }]
```

**Legacy compatibility.** Existing data lives at `PK=SET#<setId>` with no version. A
reader resolves in this order:

1. the game's pinned `QuestionSetVersion` → `SET#<setId>#v<n>`
2. the set's `activeVersion` → `SET#<setId>#v<n>`
3. legacy `SET#<setId>` — no version anywhere

Step 3 must stay until every environment is migrated. `scripts/migrate-set-versions.js`
copies each legacy set to `#v1`, sets `activeVersion: 1`, and leaves the legacy items in
place — a copy, not a move, so a rollback needs no restore. A later sweep removes them.

### Game pinning

`create-game.js` → `schema-compliant-manager.js` writes `QuestionSetVersion` alongside
`QuestionSetId`, resolved from `activeVersion` at creation. This is the same fixed-
whitelist problem as `PersonaId` (D9) — unknown fields are dropped, so all three edit
points are required.

A game with no `QuestionSetVersion` (every existing game) falls through to `activeVersion`,
then legacy. No backfill needed.

### Replace = write a new version

```
1. parse + validate the ENTIRE csv          reject on any error, touch nothing
2. write questions + categories to #v<n+1>  batched, UnprocessedItems retried
3. flip activeVersion to n+1                one write, the atomic moment
4. append to versions[]
```

A failure before step 3 leaves an orphaned version and a fully intact live set. Step 3 is
a single attribute write, so there is no half-flipped state. This is the atomicity the
owner picked, and it is why nothing needs a snapshot.

### Deleting a version

Any version may be deleted, including a non-active one, which is what makes versioning
survivable — otherwise every replace accumulates forever.

**Warn on delete, not on replace.** Replace is safe by construction. Delete is not: a
running game pinned to v2 breaks if v2 is removed. So `DELETE .../versions/{n}` checks
for non-ended games with `QuestionSetVersion = n` and warns, naming them. Deleting the
**active** version is refused outright unless another version is promoted first.

Deleting the whole set removes every version and the media prefix.

## Media

New bucket `<env>-media`, served through CloudFront. **Not `<env>-web`** — the frontend
deploy runs `aws s3 sync dist/ --delete`, which would erase every uploaded image.

```
s3://<env>-media/sets/<setId>/<filename>
```

Flat per set, **not per version.** Versions share images because a CSV edit usually keeps
the artwork; making images per-version would duplicate every file on every re-import.
The cost is that dropping a row can orphan an image, which is why the editor lists the
prefix and allows removal — the owner's stated requirement.

- `list` → `ListObjectsV2` on `sets/<setId>/`
- `delete one` → `DeleteObject`
- `delete set` → paginated `ListObjectsV2` + `DeleteObjects` in batches of 1000

Upload uses a **presigned PUT** issued by an admin-authorised lambda. API Gateway caps
payloads at 10 MB and base64 inflates by a third; artwork exceeds that. The browser PUTs
straight to S3, so the bucket needs CORS for the app origins.

## Admin rework

Everything settable at creation becomes editable: name, description, engagement type,
custom instruction, AI context, prompt, persona, round noun, categories — plus the
questions themselves via CSV replace.

- **Download** the current version as CSV. `download-question-set.js` already lost `Image`
  and `AnswerDetails` on the call-and-answer branch (fixed today in `f6b5c3b0`); the
  round-trip must be lossless or replace becomes a data-destroying operation.
- **Upload** a CSV → new version, with a diff preview before the flip.
- **Versions panel** — list, promote, delete, with the active one marked.
- **Media panel** — thumbnails from the prefix, upload, delete.

## Testing

Plain-Node, real handlers, `Module._load` stubs, matching the existing 14 suites / 437
assertions.

- a legacy set with no version still resolves (the migration-safety case)
- a game pinned to v1 keeps reading v1 after the set is replaced — the whole point
- a validation failure writes nothing and leaves `activeVersion` untouched
- deleting the active version is refused; deleting a pinned version warns and names games
- CSV download → upload round-trips `Image` and `AnswerDetails` without loss
- media delete-by-prefix paginates past 1000 keys

## Out of scope

- Removing the legacy `SET#<setId>` items (a later sweep, after every env is migrated).
- Per-version media.
- Diffing question CONTENT between versions beyond counts.
