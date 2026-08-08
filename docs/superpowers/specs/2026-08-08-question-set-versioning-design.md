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

### Media lifecycle is independent of version lifecycle (owner-specified)

| Operation | Effect on `sets/<setId>/` |
|---|---|
| Upload a new CSV version | **nothing** — media is untouched |
| Delete a version | **nothing** |
| Promote a version | **nothing** |
| Delete the whole set | delete the entire prefix |
| Bulk image upload | add only keys that do not already exist; overwrite is an explicit opt-in |

The owner's words: *"if I delete the question set as a whole, I delete the images too.
And if I upload a new version, I don't want to reimport the images too, just perhaps add
the ones that are missing."*

This is why images are keyed per **set**, not per version. A CSV edit almost always keeps
the artwork; re-uploading 10 files to fix one typo would be absurd, and per-version media
would duplicate every file on every import.

### The CSV names the file; the importer stores the key (owner-specified)

*"The CSV should just reference the image file name, not any prefix. The system should
transform the file name to full prefix in Dynamo so it associates with the question set
id, and is easy to find without much logic."*

Transformation happens **at import**, not at read:

```
CSV       the-enigmatic-smile.jpg
   ↓ upload-questions.js
DynamoDB  Image = "sets/famousarttitles/the-enigmatic-smile.jpg"
```

Every downstream reader — player payload, host, report, AI summary — uses the stored
value directly. No shared resolver, no risk of one of the six readers forgetting to call
it.

**Store the key, not a full URL.** A full URL bakes the environment's CloudFront domain
into the data, so a table restore into another tier or a domain change silently breaks
every image. The key keeps the property that makes this design good: the stored value IS
the S3 key, so "everything belonging to this set" is the same `sets/<setId>/` prefix in
DynamoDB and in S3. The environment's media base comes from config at render time,
exactly as the API URL already does.

**Exactly one place has any logic** — the image render site:

| Stored value | Rendered as |
|---|---|
| `https://…` | as-is — legacy Wikimedia rows |
| `/assets/art/…` | as-is — repo assets in the frontend bundle |
| `sets/<setId>/<file>` | `<mediaBase>/` + value |

The first two rules exist so nothing already imported breaks, and must not be removed.
A bare filename with no prefix is treated as a set-relative key and gets the prefix
applied, so a hand-written CSV that omits it still works.

This also makes "add only the missing images" a set difference between the keys the CSV
references and the keys under the prefix, rather than URL parsing.

### The value type declares ownership (owner's framing)

*"A file name assumes you will upload that file name via the edit question set; a URL
assumes the file will stay external."*

A **filename is a commitment to upload**; a **URL is a disclaimer**. That single rule
decides lifecycle:

| Value | Owner | Deleted with the set |
|---|---|---|
| `the-enigmatic-smile.jpg` | the system — lives in `sets/<setId>/` | **yes** |
| `https://…` | external, permanent | never touched |
| `/assets/art/…` | the repo, shipped in the bundle | never touched |

Because the expected key set is knowable for system-owned images, both failure modes
become detectable — neither is possible for a URL, since nothing says what it *should*
have been:

- **Referenced but not uploaded** → a broken image at game time. Import compares the CSV's
  filenames against the prefix and reports the missing ones *at import*, not mid-session.
  This is a warning, not a rejection: uploading the CSV before the images is a legitimate
  order of work.
- **Uploaded but unreferenced** → orphaned by a dropped row. Surfaced in the media panel
  for one-click removal, which is the owner's "easily removed" requirement.

The media panel therefore shows three states per file: **in use**, **missing** (referenced,
not uploaded), **orphaned** (uploaded, unreferenced).

### Adopting the existing artwork

The 10 art images are currently repo assets at `src/public/assets/art/`, deployed to
`<env>-web` as part of `dist/`. They work, and they are safe from the frontend deploy's
`--delete` precisely because they are part of `dist/` — but they are not admin-manageable.

`scripts/adopt-set-media.js` copies a directory into `sets/<setId>/` and emits a CSV with
the `Image` column rewritten to bare filenames, so the migration is one upload rather than
ten hand-edited URLs. Once versioning ships, that is a version bump, not a re-creation.

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
