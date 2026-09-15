# The shared archive service

**One archive serves dev, test and prod.** It backs up Engage (platform) and public question
sets and prompts as full-fidelity snapshots, and any tier can restore any tier's backup into its
own Engage library. Design: `docs/superpowers/specs/2026-09-14-archive-full-fidelity-design.md`.

## Pieces

| Piece | What | Where |
|---|---|---|
| Stack | `engage2-archive-service`, deployed by hand | `template-archive.yaml`, `scripts/deploy-archive.sh` |
| API | HTTP API `9gi7xpycsf`, **every route `AWS_IAM` once locked** (`deploy-archive.sh lock`) | `lambda-functions/archive/*.js` |
| Index | DynamoDB `engage2-archive`, `PK=ARCHIVE`, `SK=ITEM#<id>`; retained; point-in-time recovery | |
| Content | S3 `engage2-archive-content`; versioned (90-day noncurrent); retained | `archive/<type>/<id>.*`, images under `archive/media/<snapshotId>/` |
| Callers | each tier's `admin-export-to-archive`, `admin-import-from-archive`, `admin-archive-items` | `template-clean.yaml`, `lambda-functions/admin/` |

`archive.seibtribe.us` (CloudFront) still exists but is unused: a SigV4 signature covers the Host
header, which CloudFront rewrites, so signed callers use the execute-api endpoint directly.

## Who can do what

- **The browser never calls the archive.** The admin screen calls its own tier's routes, which
  require the tier's sign-in, the `admins` group, and `canManageScope(PLATFORM)`: Engage staff
  with no organisation selected.
- **Each tier's functions sign their calls** with their Lambda role (`shared/archive-client.js`).
  All three tiers deploy the same `execute-api:Invoke` grant, and the archive API id comes from
  one template mapping pinned to `config/archive-service.json`.
- **Organisation content is never archived.** It is encrypted per organisation, and anything
  carrying an encrypted value is refused on export and on import.

## Proving every tier can reach it

```bash
scripts/archive-access-check.sh preflight   # per tier: URL, IAM simulation, a signed list
scripts/archive-access-check.sh verify      # the same, plus: every route requires AWS_IAM, and an unsigned request is refused
scripts/archive-drill.sh engagedev          # back up, delete, restore and check a throwaway set (dev or test)
```

## Deploying it

```bash
aws sso login --profile adminaccess
scripts/deploy-archive.sh preview   # pre-flight, build, and show the change set; nothing is deployed
scripts/deploy-archive.sh lock      # pre-flight, deploy, record the outputs, verify
```

`preview` and `lock` refuse to go on unless `preflight` passes for all three tiers. They also
refuse uncommitted changes to the template or the archive functions: this stack has no pipeline
history, so what is deployed must be a commit. Every change `preview` shows should be `* Modify`
with Replacement `False`, and none should be `- Delete`.

Straight after a deploy that changes the lock, run `scripts/archive-drill.sh engagedev` and then
`scripts/archive-drill.sh engagetest`, with the rollback ready. Before the lock nothing can prove
a signature, because an unlocked archive answers unsigned requests too. `verify` proves each
tier's signed list; the drill proves a signed backup, restore and delete, and removes what it
made.

**Rollback:** `scripts/deploy-archive.sh unlock` deploys the same template with the `ArchiveApi`
lock removed, then shows every tier reaching the archive again. It runs no pre-flight first,
because the failure it exists for — a tier whose signature the locked archive rejects — fails the
pre-flight too. If anything after `lock`'s deploy fails, the script says the archive is locked
and names `unlock`. The table and bucket are retained whatever the template says, so no deploy
here deletes a backup. If a failed deploy leaves the stack in `UPDATE_ROLLBACK_FAILED`, see
`aws cloudformation continue-update-rollback`.

The table and bucket have fixed physical names and `Retain`, so if the stack is ever deleted they
stay behind, and a re-created stack must import them (a CloudFormation IMPORT change set) rather
than create them.
