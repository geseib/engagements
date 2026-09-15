# Engage2 — Deployment Guide

**The trigger rule and who may deploy which tier live at the top of `CLAUDE.md`.**
That file is the verified version, confirmed by the owner. This one carries the
mechanics: what the pipelines do, where the secrets are, and how to get out of
trouble. Nothing here restates the trigger rule — one copy, in one place, is the
whole point. An earlier version of this file asserted the opposite of `CLAUDE.md`
in three places.

## The tiers

| Tier | Stack | Site | Hosted zone | Gate |
|---|---|---|---|---|
| dev | `engagedev` | https://engage.dev.seibtribe.us | `ZB9TUA073B5SH` | none |
| test | `engagetest` | https://engage.test.seibtribe.us | `ZB9TUA073B5SH` | none |
| prod | `engageprod` | https://engage.seibtribe.us | `Z03473042HSYD8BUY4XSL` | halts at `ApprovalForProd` |

`main` has no pipeline and triggers nothing. The `eng*` / `engdev` stacks are a
retired off-pipeline duplicate — **not** a tier; see the "dead twin" section of
`CLAUDE.md` for the two days that confusion cost.

## There is no deploy script

The pipeline is the deploy. `deployall`, `deploy-frontend-eng.sh`,
`deploy-dev-full.sh` and `update-frontend-env.sh` were deleted in `0968435f`:
every one of them targeted the retired twin.

`scripts/deploy-clean.sh engagedev` survives as an escape hatch for the case
where the pipeline itself is broken. It deploys the **backend only** and refuses
`engagetest`, `engageprod` and every twin stack by name. Read its guard block
before using it — in particular, it refuses to deploy when the Google OAuth
parameters are missing, because doing so deletes the Cognito identity provider.

## What a pipeline run does

Each tier has its own buildspec (`buildspec-dev.yml`, `-test`, `-prod`), bound to
a CodeBuild project by `cicd/pipeline-clean.yaml`. They are self-contained and
call no scripts:

1. `pip3 install aws-sam-cli`, then `cd src && npm ci`
2. Resolve the GitHub PAT from Secrets Manager and the Google OAuth pair from SSM
3. `sam build -t template-clean.yaml`
4. `sam deploy --stack-name $STACK_NAME` with the resolved parameters
5. Read the API, WebSocket and Cognito values back out of the stack with
   `describe-stacks` and write `src/public/config.js` from them
6. **`npm run lint`, then `npm test`** — the gate that did not exist; three
   product-down bugs shipped through this pipeline in two days before it was
   added, every one a clean webpack build
7. `npm run build`, `aws s3 sync dist/`, CloudFront invalidation

`config.js` is generated at deploy time from stack outputs. The committed copy is
only a local placeholder.

## Tags

A tag deploys and simultaneously records what shipped — an immutable
`<tier>-v<semver>` pointer, unlike a branch head that moves.

```bash
git tag dev-v1.3.0  && git push origin dev-v1.3.0
git tag test-v1.3.0 && git push origin test-v1.3.0
git tag prod-v1.3.0 && git push origin prod-v1.3.0   # then approve in the console
```

Only **new** tag pushes trigger. A tag already on the remote does nothing, and
neither does creating one locally without pushing.

```bash
git tag --sort=-creatordate | grep '^prod-'   # what is live, newest first
git show prod-v1.3.0 --stat                   # exactly what shipped
git log --oneline prod-v1.2.0..prod-v1.3.0
```

⚠️ A tag deploys **the commit it points at**, not the tier's branch head. A
`prod-v*` tag placed on a `dev` commit will, after approval, put that dev commit
into production. Tag from the branch you mean to ship.

⚠️ In the remote container, pushes to `refs/tags/*` fail with HTTP 403 while
`refs/heads/*` succeed — so from there a branch push is the only route.

## Secrets and configuration (never in source)

| Secret | Where | How to set |
|---|---|---|
| GitHub PAT (issue creation) | Secrets Manager `engage/<env>/github-token`, JSON `{"GITHUB_TOKEN":"…"}` | `AWS_PROFILE=adminaccess ./scripts/setup-secure-github-token.sh <env>` |
| Google OAuth client id/secret | SSM Parameter Store (dev/test); **prod reads none** | see below |

> ⚠️ `CodeBuildServiceRole`'s inline Secrets Manager statement in
> `cicd/pipeline-clean.yaml` grants only `engage/test/*` and `engage/prod/*` —
> **`engage/dev/*` is missing**. Dev reads it today only because
> `PowerUserAccess` is also attached. If that managed policy is ever removed,
> dev's token retrieval breaks *silently*: `buildspec-dev.yml` swallows the
> failure (`|| echo ""`) and logs a warning instead of failing, so dev keeps
> deploying with issue creation quietly dead. Test and prod `exit 1` instead.

**Google OAuth is wired differently per tier, and an empty secret is destructive.**
`template-clean.yaml` gates it on `HasGoogleOAuth: !Not [!Equals [!Ref GoogleClientSecret, ""]]`,
and `GoogleIdentityProvider` carries `Condition: HasGoogleOAuth` — so deploying
with an empty secret **deletes the Cognito Google provider**.

| Pipeline | Reads from | Passes to `sam deploy` |
|---|---|---|
| dev | `/$STACK_NAME/google/client-*`, falling back to `/engdev/google/client-*` | conditionally — omitted when empty, so CloudFormation keeps the stored value |
| test | `/engtest/google/client-*` | **unconditionally, including empty strings** — an SSM miss actively sets `GoogleClientSecret=""` and deletes the provider on `engagetest` |
| prod | nothing | neither parameter is passed — `engageprod`'s Google config exists only as the stack's stored parameter values, with no SSM copy to restore from |

Issues are filed to `geseib/engagements` (the Lambda default, and `config/cicd.json`).

## Redeploying the pipeline stack itself

```bash
aws sso login --profile adminaccess
./scripts/deploy-cicd.sh          # updates CloudFormation stack `engagecicd`
```

No GitHub token is prompted for — repo access is the CodeStar connection,
authorized once by hand in the console.

> ⚠️ **This is the one script whose mere execution changes trigger behaviour.**
> `cicd/pipeline-clean.yaml` as committed carries `b6929cac`'s tags-only
> `Triggers` blocks, which have deliberately never been applied. Applying them
> makes branch pushes inert — and since tag pushes 403 from the remote
> container, that removes Claude's only deploy route. Do not run this to "sync
> the pipeline" without deciding that question first.

## Troubleshooting

- **`aws` token expired** → `aws sso login --profile adminaccess`.
- **Build fails in CI** → CodeBuild logs for that tier's pipeline.
- **Pipeline did not start after a push** → check the `engage-github-connection`
  is `AVAILABLE` (Developer Tools → Settings → Connections); a `PENDING`
  connection fails at Source. Then check the tier branch name or `<tier>-v*` tag.
- **Frontend loads stale config** → confirm the CloudFront invalidation ran.
- **Google sign-in vanished after a deploy** → the SSM parameters were missing
  and the provider was deleted. Restore the parameters and redeploy. This is the
  failure the guards in `deploy-clean.sh` and the warnings in the buildspecs exist
  for.
- **Rollback prod** → re-tag the last known-good commit
  (`git tag prod-v1.2.1 <good-sha> && git push origin prod-v1.2.1`), then approve;
  or roll back the `engageprod` stack in the console.

## Known follow-ups

- The shared archive (`template-archive.yaml`) is on `nodejs22.x` and requires
  signed AWS requests on every route. It is the one stack deployed by hand, with
  `scripts/deploy-archive.sh`, which refuses to deploy until
  `scripts/archive-access-check.sh preflight` passes for dev, test and prod. See
  `docs/architecture/archive-service.md`.
- `cicd/pipeline-clean.yaml`'s uncommitted-vs-applied drift (above) is still open
  and is the root cause of every stale "tags only" claim this repo has carried.
