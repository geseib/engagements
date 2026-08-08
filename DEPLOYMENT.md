# Engage2 — Deployment Guide (Canonical)

> This is the single source of truth for deploying Engage2. Older deployment notes
> (`DEPLOYMENT_COMMANDS.md`, `docs/DEPLOYMENT_TO_TEST_PROD.md`, `docs/05-cicd-setup.md`,
> `SECURE_DEPLOYMENT_*.md`, `CLEANUP-GUIDE.md`) are superseded and kept only for history.

## TL;DR

| Task | Command |
|---|---|
| Full dev deploy of the **local** `engdev` stack | `./deployall` |
| Backend only (local stacks) | `./scripts/deploy-clean.sh <stack> <domain> [hosted-zone-id]` |
| Frontend only (local `engdev`) | `./scripts/deploy-frontend-eng.sh` |
| Deploy a CI/CD tier | **push the branch, or push a `<tier>-v*` tag** (prod needs manual approval) |

All local deploys use the `adminaccess` AWS SSO profile. If `aws` says the token expired:
`aws sso login --profile adminaccess`.

## Two different sets of environments — do not conflate them

This repo deploys the same `template-clean.yaml` to **two independent families of stacks**.
Reading a stack name off the wrong table is the single most common mistake here.

### 1. `engage*` — the CI/CD tiers (canonical)

Deployed only by CodePipeline. Ground truth is the CodeBuild environment variables in
`cicd/pipeline-clean.yaml`.

| Env | Stack | Domain | Hosted Zone | Pipeline | CodeBuild project | Buildspec |
|---|---|---|---|---|---|---|
| **dev** | `engagedev` | `engage.dev.seibtribe.us` | `ZB9TUA073B5SH` | `engagecicd-pipeline-dev` | `engagecicd-build-dev` | `buildspec-dev.yml` |
| **test** | `engagetest` | `engage.test.seibtribe.us` | `ZB9TUA073B5SH` | `engagecicd-pipeline-test` | `engagecicd-build-test` | `buildspec-test.yml` |
| **prod** | `engageprod` | `engage.seibtribe.us` | `ZB9TUA073B5SH` | `engagecicd-pipeline-prod` | `engagecicd-build-prod` | `buildspec-prod.yml` |

`config/cicd.json`'s `engage.*` domains are **correct** for CI/CD — they are what the pipeline
actually deploys. (An earlier revision of this document called them "stale"; that was wrong.)

### 2. `eng*` — the local off-pipeline stacks

Deployed only by the local scripts below. No pipeline touches them. Being retired.

| Env | Stack | Domain | Hosted Zone | Deployed by |
|---|---|---|---|---|
| dev | `engdev` | `eng.dev.seibtribe.us` | `ZB9TUA073B5SH` | `./deployall`, `deploy-clean.sh`, `deploy-frontend-eng.sh` |
| test | `engtest` | `eng.test.seibtribe.us` | `ZB9TUA073B5SH` | `deploy-clean.sh` (manual only) |
| prod | `engprod` | `eng.seibtribe.us` | `Z03473042HSYD8BUY4XSL` | `deploy-clean.sh` (manual only) |

There is **one** infrastructure template — `template-clean.yaml` — parameterized by `StackName`,
`Environment`, `DomainName`, `HostedZoneId`. There are no per-env `template-*.yaml` files.

## Local dev deployment (what `./deployall` does)

1. **Backend** — `./scripts/deploy-clean.sh engdev eng.dev.seibtribe.us`
   `sam build -t template-clean.yaml` → `sam deploy` (stack `engdev`). Pulls the GitHub token
   from Secrets Manager and Google OAuth params from SSM (see Secrets below).
2. **Frontend** — `./scripts/deploy-frontend-eng.sh`
   Reads the stack's CloudFormation outputs (API / WebSocket / Cognito), regenerates
   `src/public/config.js`, `npm run build`, `aws s3 sync` to the `${stack}-web` bucket,
   then invalidates CloudFront.

> `deploy-frontend-eng.sh` is hardcoded to the `engdev` stack. It cannot ship any CI/CD tier —
> `engagedev` / `engagetest` / `engageprod` frontends are built and shipped by their pipelines.

## CI/CD — what triggers a deploy

Each tier has its own CodePipeline, and **two** triggers start it: a push to the tier's branch,
**or** a push of a tag matching the tier's pattern. Either one is sufficient. `main` is not a
trigger for anything.

```
push origin dev    OR  push tag dev-v*    → engagecicd-pipeline-dev   → engagedev   (auto)
push origin test   OR  push tag test-v*   → engagecicd-pipeline-test  → engagetest  (auto)
push origin prod   OR  push tag prod-v*   → engagecicd-pipeline-prod  → engageprod  (MANUAL APPROVAL)
```

Source access is via the `engage-github-connection` CodeStar connection and its managed webhook.
There are no GitHub Actions workflows and no `AWS::CodePipeline::Webhook` resources in this repo.

### What is automatic and what is not — read this

The older wording here ("deployments are performed by the maintainer, never automatically") was
misleading. Precisely:

- **Automatic, no human gate:** dev and test. The instant `dev`/`test` is pushed, or a `dev-v*` /
  `test-v*` tag is pushed, CodeBuild runs `sam deploy` against `engagedev` / `engagetest`. Nobody
  approves anything.
- **Automatic start, human gate before deploy:** prod. A `prod` branch push or a `prod-v*` tag
  starts `engagecicd-pipeline-prod`, which halts at the `ApprovalForProd` stage. Nothing reaches
  `engageprod` until a human clicks Approve in the CodePipeline console. Tags do **not** bypass
  this.

The maintainer-only policy is about **which refs get pushed**, not about the pipeline. Pushing
`test`/`prod` or a `*-v*` tag *is* the deploy. Treat those pushes as production actions.

### Tag-based releases

A tag both deploys and records what shipped — an immutable `<tier>-v<semver>` pointer, unlike a
branch head that moves.

```bash
# ship the current commit to a tier
git tag dev-v1.3.0  && git push origin dev-v1.3.0
git tag test-v1.3.0 && git push origin test-v1.3.0
git tag prod-v1.3.0 && git push origin prod-v1.3.0   # then approve in the console
```

Only **new** tag pushes trigger. Tags already on the remote (e.g. `pre-merge-backup-dev`) do
nothing, and neither does creating a tag locally without pushing it.

```bash
# what is live in each tier, newest first
git tag --sort=-creatordate | grep '^prod-'
git tag --sort=-creatordate | grep '^test-'
git tag --sort=-creatordate | grep '^dev-'

# exactly what a shipped tag contains
git show prod-v1.3.0 --stat
git log --oneline prod-v1.2.0..prod-v1.3.0
```

⚠️ A tag deploys **the commit the tag points at**, not the tier's branch head. A `prod-v*` tag
placed on a `dev` commit will (after approval) put that dev commit into production. Tag from the
branch you mean to ship.

### Buildspecs

Each CodeBuild project pins its own buildspec; there is no shared/generic one.

| Pipeline | CodeBuild project | Buildspec |
|---|---|---|
| dev  | `engagecicd-build-dev`  | `buildspec-dev.yml` |
| test | `engagecicd-build-test` | `buildspec-test.yml` |
| prod | `engagecicd-build-prod` | `buildspec-prod.yml` |

The unused generic `buildspec.yml` was removed (it referenced a `template-dev.yaml` that does not
exist). The debug/duplicate variants (`buildspec-secure/simple/test-debug/test-working.yml`) were
removed earlier.

### Redeploying the pipeline stack itself

```bash
aws sso login --profile adminaccess
./scripts/deploy-cicd.sh          # updates CloudFormation stack `engagecicd`
```

No GitHub token is prompted for — repo access is the CodeStar connection, authorized once by hand
in the console. (An earlier version of this script passed a `GitHubToken=` parameter the template
does not declare, which made every redeploy fail.)

## Secrets & configuration (never in source)

| Secret | Where | How to set |
|---|---|---|
| GitHub PAT (issue creation) | Secrets Manager `engage/<env>/github-token` (JSON `{"GITHUB_TOKEN":"…"}`) | `AWS_PROFILE=adminaccess ./scripts/setup-secure-github-token.sh <env>` (hidden prompt) |

> ⚠️ `CodeBuildServiceRole`'s inline Secrets Manager statement in `cicd/pipeline-clean.yaml` grants
> only `engage/test/*` and `engage/prod/*` — **`engage/dev/*` is missing**. Dev reads it today only
> because `PowerUserAccess` is also attached to that role. If that managed policy is ever removed
> in a security tightening, dev's token retrieval breaks *silently*: `buildspec-dev.yml` swallows
> the failure (`|| echo ""`) and logs a WARNING instead of failing the build, so dev keeps
> deploying with GitHub issue creation quietly dead. Test and prod `exit 1` instead.
| Google OAuth client id/secret | SSM Parameter Store (dev/test) — **prod reads none** | see the table below |

Google OAuth is wired differently per tier. `template-clean.yaml` gates it on
`HasGoogleOAuth: !Not [!Equals [!Ref GoogleClientSecret, ""]]`, and `GoogleIdentityProvider` has
`Condition: HasGoogleOAuth` — so an **empty** secret deletes the Cognito Google provider.

| Pipeline | Reads from | Passes to `sam deploy` |
|---|---|---|
| dev | `/$STACK_NAME/google/client-*`, falling back to `/engdev/google/client-*` | conditionally — omitted when empty (safe: CloudFormation keeps the stack's previous value) |
| test | `/engtest/google/client-*` | **unconditionally, including empty strings** — an SSM miss actively sets `GoogleClientSecret=""` and deletes the provider on `engagetest` |
| prod | nothing | neither parameter is passed at all — `engageprod`'s Google config lives only in the CloudFormation stack's stored parameter values, with no SSM copy to restore from |

Issues are filed to the `geseib/engagements` repo (Lambda default + `samconfig-*` + `config/cicd.json`).

## Canonical scripts (everything else is deprecated/removed)

```
deployall                          # full dev deploy (backend + frontend)
scripts/deploy-clean.sh            # backend (any env): <stack> <domain> [hosted-zone-id]
scripts/deploy-frontend-eng.sh     # frontend (dev)
scripts/deploy-dev-full.sh         # orchestrator: deploy-clean + update-frontend-env (dev)
scripts/update-frontend-env.sh     # write src/.env from stack outputs
scripts/setup-secure-github-token.sh  # store GitHub PAT in Secrets Manager
scripts/setup-post-confirmation.sh    # wire Cognito post-confirmation trigger (post-deploy)
scripts/deploy-archive.sh          # separate shared archive service (template-archive.yaml)
scripts/deploy-cicd.sh             # provision/update the CI/CD pipeline stack (engagecicd)
```

Removed as stale (referenced dead templates / stacks / the retired `adfs` profile):
`deploy-dev.sh`, `deploy-test.sh`, `deploy-prod.sh`, `deploy-frontend-dev.sh`, the duplicate
root-level `deploy-clean.sh`, `scripts/setup-cicd.sh`, `scripts/setup-cicd-manual.sh` (both
required a `template-cicd.yaml` that does not exist), `buildspec.yml`, and
`cicd/pipeline-secure.yaml` (wrong owner/repo/domains, no dev pipeline, referenced a deleted
`buildspec-secure.yml`, and collided with `pipeline-clean.yaml` on the CodeStar
`ConnectionName: engage-github-connection`). Git history retains all of them.

Still referencing those deleted files, and therefore not to be followed:
`SECURE_DEPLOYMENT_GUIDE.md`, `SECURE_DEPLOYMENT_QUICKSTART.md`, `SAFE_TEST_DEPLOYMENT_PLAN.md`,
`docs/05-cicd-setup.md`, `scripts/test-secure-deployment.sh`. This file supersedes all of them.

## Troubleshooting

- **`aws` token expired** → `aws sso login --profile adminaccess`.
- **Build fails in CI** → CodeBuild logs for the branch's pipeline.
- **Frontend loads stale config** → confirm CloudFront invalidation ran; `config.js` is
  regenerated at deploy from stack outputs (the committed copy is only a dev placeholder).
- **Pipeline did not start after a push** → the trigger filters live in each pipeline's `Triggers`
  block in `cicd/pipeline-clean.yaml`. Check the branch name is exactly `dev`/`test`/`prod` and the
  tag matches `<tier>-v*`. Also check the `engage-github-connection` is `AVAILABLE`
  (Developer Tools → Settings → Connections); a `PENDING` connection fails at Source.
- **Rollback prod** → re-tag the last known-good commit and push it
  (`git tag prod-v1.2.1 <good-sha> && git push origin prod-v1.2.1`), then approve. Or revert the
  commit and re-push `prod`. Or roll back the `engageprod` CloudFormation stack in the console.

## Known follow-ups
- Lambda runtime is `nodejs18.x` (EOL) across all functions — bump to `nodejs22.x` at the
  `Runtime:` line in `template-clean.yaml` Globals, then redeploy + smoke-test.
