# Engage2 — Deployment Guide (Canonical)

> This is the single source of truth for deploying Engage2. Older deployment notes
> (`DEPLOYMENT_COMMANDS.md`, `docs/DEPLOYMENT_TO_TEST_PROD.md`, `docs/05-cicd-setup.md`,
> `SECURE_DEPLOYMENT_*.md`, `CLEANUP-GUIDE.md`) are superseded and kept only for history.

## TL;DR

| Task | Command |
|---|---|
| Full dev deploy (backend + frontend) | `./deployall` |
| Backend only (any env) | `./scripts/deploy-clean.sh <stack> <domain> [hosted-zone-id]` |
| Frontend only (dev) | `./scripts/deploy-frontend-eng.sh` |
| Test / Prod | **push to the `test` / `prod` branch** — CI/CD deploys (prod needs manual approval) |

All local deploys use the `adminaccess` AWS SSO profile. If `aws` says the token expired:
`aws sso login --profile adminaccess`.

## Environments

| Env | Stack | Domain | Hosted Zone | Branch | Pipeline |
|---|---|---|---|---|---|
| **dev** | `engdev` | `eng.dev.seibtribe.us` | `ZB9TUA073B5SH` | `dev` | `engagecicd-pipeline-dev` (auto) |
| **test** | `engtest` | `eng.test.seibtribe.us` | `ZB9TUA073B5SH` | `test` | `engagecicd-pipeline-test` (auto) |
| **prod** | `engprod` | `eng.seibtribe.us` | `Z03473042HSYD8BUY4XSL` | `prod` | `engagecicd-pipeline-prod` (manual approval) |

There is **one** infrastructure template — `template-clean.yaml` — parameterized by `StackName`,
`Environment`, `DomainName`, `HostedZoneId`. There are no per-env `template-*.yaml` files.
`config/cicd.json` lists the pipelines but its `domains` block is stale (`engage.*`); the
authoritative domains are the `samconfig-*.toml` values above.

## Local dev deployment (what `./deployall` does)

1. **Backend** — `./scripts/deploy-clean.sh engdev eng.dev.seibtribe.us`
   `sam build -t template-clean.yaml` → `sam deploy` (stack `engdev`). Pulls the GitHub token
   from Secrets Manager and Google OAuth params from SSM (see Secrets below).
2. **Frontend** — `./scripts/deploy-frontend-eng.sh`
   Reads the stack's CloudFormation outputs (API / WebSocket / Cognito), regenerates
   `src/public/config.js`, `npm run build`, `aws s3 sync` to the `${stack}-web` bucket,
   then invalidates CloudFront.

> `deploy-frontend-eng.sh` is hardcoded to the `engdev` stack. Test/prod frontends are built
> and shipped by their CI/CD pipelines, not this script.

## Test / Prod (CI/CD)

Branch-triggered CodePipelines (`main` is **not** a deploy trigger):

```
work on  dev  → push origin dev   → engagecicd-pipeline-dev   → engdev   (auto)
merge    test → push origin test  → engagecicd-pipeline-test  → engtest  (auto)
merge    prod → push origin prod  → engagecicd-pipeline-prod  → engprod  (manual approval)
```

⚠️ Per project policy, **deployments are performed by the maintainer, never automatically.**
Test/prod deploy only via a deliberate push to those branches.

CodeBuild project → buildspec (verified from the deployed pipeline stack, 2026-08-04):

| Pipeline | CodeBuild project | Buildspec |
|---|---|---|
| dev  | `engagecicd-build-dev`  | `buildspec-dev.yml` |
| test | `engagecicd-build-test` | `buildspec-test.yml` |
| prod | `engagecicd-build-prod` | `buildspec-prod.yml` |

The generic `buildspec.yml` is unused by CI (each project pins its env buildspec). The
debug/duplicate variants (`buildspec-secure/simple/test-debug/test-working.yml`) were removed.

## Secrets & configuration (never in source)

| Secret | Where | How to set |
|---|---|---|
| GitHub PAT (issue creation) | Secrets Manager `engage/<env>/github-token` (JSON `{"GITHUB_TOKEN":"…"}`) | `AWS_PROFILE=adminaccess ./scripts/setup-secure-github-token.sh <env>` (hidden prompt) |
| Google OAuth client id/secret | SSM Parameter Store | dev: `/engdev/google/client-{id,secret}` · test/prod: `/eng{test,prod}/oauth/google/client-{id,secret}` |

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
scripts/deploy-cicd.sh             # provision the CI/CD pipeline stack (engagecicd)
```

Removed as stale (referenced dead templates / stacks / the `adfs` profile):
`deploy-dev.sh`, `deploy-test.sh`, `deploy-prod.sh`, `deploy-frontend-dev.sh`, and the
duplicate root-level `deploy-clean.sh`.

## Troubleshooting

- **`aws` token expired** → `aws sso login --profile adminaccess`.
- **Build fails in CI** → CodeBuild logs for the branch's pipeline.
- **Frontend loads stale config** → confirm CloudFront invalidation ran; `config.js` is
  regenerated at deploy from stack outputs (the committed copy is only a dev placeholder).
- **Rollback prod** → revert the commit and re-push `prod`, or roll back the `engprod`
  CloudFormation stack in the console.

## Known follow-ups
- Lambda runtime is `nodejs18.x` (EOL) across all functions — bump to `nodejs22.x` at the
  `Runtime:` line in `template-clean.yaml` Globals, then redeploy + smoke-test.
