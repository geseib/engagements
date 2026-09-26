# Archive full fidelity — what is live, and what is left

**Status on 2026-09-18:** live on **dev** and **test**, proven there. **Not on prod.** The archive service itself is **not locked yet**.

- Spec: `docs/superpowers/specs/2026-09-14-archive-full-fidelity-design.md` (§0 holds the owner-approved amendments A1–A14)
- Plan: `docs/superpowers/plans/2026-09-15-archive-full-fidelity.md` (Tasks 1–12 and 14 are built; 13 and 15 are the live steps)
- Implementation commits: `a76883ab..2abf9559`, carried to dev and test inside the public-library release (`bc078d6e` on dev, `5bdd786b` on test)

## What it does now

- A backup of an Engage (platform) or public question set or prompt is a full snapshot — every row of the live version, with the images those rows point at copied beside it. Legacy CSV and JSON items still restore.
- A restore lands in the Engage library as a new version and then switches to it. A set that is gone is recreated under its own id. An image is never written over.
- Organisation content is never archived. Anything carrying an encrypted value is refused on export and on import.
- One archive serves all three tiers. Each tier's `admin-export-to-archive`, `admin-import-from-archive` and `admin-archive-items` sign their calls to the execute-api host; the admin screen goes through its own tier's routes and never calls the archive service directly (guard test: `src/src/__tests__/archiveNoDirectCalls.test.js`).
- The archive id lives in one place: the `ArchiveService` mapping in `template-clean.yaml`, pinned to `config/archive-service.json` by `tests/archive-infrastructure.js`.

## The three scripts

```bash
scripts/archive-access-check.sh preflight [stack...]   # every tier: URL, IAM simulation, a relay list
scripts/archive-access-check.sh verify    [stack...]   # the same, plus every route AWS_IAM and a stranger refused
scripts/archive-drill.sh engagedev|engagetest          # back up, delete, restore, check, remove; refuses engageprod
scripts/deploy-archive.sh preview|lock|unlock          # the archive stack, by hand; no pipeline reaches it
```

`tests/archive-scripts.js` runs all three against stubbed `aws`, `curl` and `sam`, in throwaway repos. It needs `bash` and `jq`; it skips without them.

## Proven live on 2026-09-18

- `preflight engagedev engagetest` → `all checks passed`; each relay listed the archive (42 items).
- `archive-drill.sh engagedev` and `archive-drill.sh engagetest` → `drill passed`, with no `LEFT BEHIND` line: a set with an image was backed up, deleted, restored under its original id at version 1 and still inactive, with all five content rows and the image back, then everything the drill made was removed.
- No `PUBLIC#SETS` row on any tier carries an encrypted value (dev has 4 public sets, test and prod none), so nothing is refused for that reason today.

## What is left

1. **Prod.** Prod is still on `3fec8171` (2026-09-14) and does not have the signed archive client. Prod takes it whenever the next release goes out; nothing archive-specific has to happen first. Afterwards, run `scripts/archive-access-check.sh preflight engageprod` — it is read-only. **Never run the drill on prod.**
2. **The lock (plan Task 15).** It needs the owner's explicit yes and prod passing the pre-flight. The run is:
   ```bash
   scripts/deploy-archive.sh preview   # read the change set: every change * Modify with Replacement False, none - Delete
   scripts/deploy-archive.sh lock
   scripts/archive-drill.sh engagedev && scripts/archive-drill.sh engagetest
   ```
   If anything after the deploy fails, `scripts/deploy-archive.sh unlock` removes only the lock. The table and bucket are retained whatever the template says, so no deploy here can delete a backup. Plan Task 15 carries the full runbook.
3. **Follow-ups, none blocking** (they came out of the reviews):
   - `upload-questions.js`'s replace path copies legacy rows to a literal `v1` and writes at `nextVersion` without checking the partition is empty — the same mixing bug the restore path now avoids with `firstEmptyVersion`. Pre-existing.
   - `archive-restore.js`: the A10 seed is lost if an unversioned row carries `versions: []`; `VERSION_PROBES` (10) exceeds `delete-question-set.js`'s sweep (5); `firstEmptyVersion` reads without `ConsistentRead`.
   - `import-from-archive.js` reports `media.skipped`, but a key like `sets/<id>/sub/x.png` is described as "not stored under sets/", which is not quite what happened.
   - A relayed archive refusal is now logged, but there is still no audit trail of who deleted a backup beyond that log line.

## Traps worth knowing

- **bash 3.2.** macOS `/bin/bash` brace-expands escaped JSON inside a quoted `"$(…)"` used as an argument, which silently split one `get-item` into two half-key reads. Assign the read to a variable first; `tests/archive-scripts.js` now refuses a key missing `PK` or `SK`.
- **`tests/no-retired-twin-references.js`** fails on any tracked file that says a branch push is inert — the old "only a tag deploys" wording, in any phrasing it matches (say "nothing is deployed" instead), including plans and briefs. It reads `git ls-files`, so an untracked new file is not scanned until it is staged.
- **The archive bucket is versioned** with a 90-day noncurrent expiry, so anything deleted there — a drill's copies included — remains as a noncurrent version for 90 days.
