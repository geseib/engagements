---
name: github-flow
description: "Use when working with GitHub on the Engagements repo — opening or updating a pull request, reading or fixing a failing CI run, reviewing a diff before pushing, choosing a branch, or wiring up GitHub Actions. Triggers on requests to commit, push, open a PR, check CI, fix a red build, or set up branch protection and deployment workflows."
---

# GitHub workflow — Engagements

## Branches

| Branch | Purpose |
| --- | --- |
| `main` | source of truth |
| `dev`, `test`, `prod` | environment branches |
| `claude/*` | agent-authored work |

Never push directly to `main`, `prod`, or `test`. Branch, push, open a PR.

## Before you push

CI runs three jobs (`.github/workflows/validate.yml`). Run their local
equivalents first — all of them work without AWS credentials:

```bash
./scripts/validate.sh                          # template + inline handlers
cd src && npm ci && npm run build              # frontend + size budget
shellcheck --severity=warning scripts/*.sh     # shell scripts
```

## What CI checks, and why each check exists

**`validate.sh`** — every check in it was added because the corresponding
defect actually shipped:

- *Duplicate resource keys.* `GetAISummaryFunction` was defined twice; YAML
  keeps the last and silently drops the first. `sam validate` does not catch
  this — only `sam validate --lint` does.
- *Inline JavaScript syntax.* ~3,700 lines of handler code live inside
  `template-dev.yaml` as `InlineCode`, invisible to every normal tool. A typo
  there surfaces at a Lambda cold start in production.
- *aws-sdk v2 on a runtime that does not bundle it.* See `aws-deploy` skill.
- *Stack-name drift* between the deploy scripts and `samconfig-dev.toml`.

**Frontend size budget** — fails if the initial JS payload exceeds 500 KB. It
was 982 KB because `html2pdf.js` was imported eagerly for a feature used on one
screen. Large, rarely-used dependencies belong behind a dynamic `import()`.

**shellcheck** at `--severity=warning` on `scripts/*.sh`.

## Reading a failed CI run

Use the GitHub MCP tools rather than guessing:

```
mcp__github__actions_list        # find the run
mcp__github__get_job_logs        # failed_only: true — go straight to the error
```

For `validate.sh` failures the log names the exact resource, function, or line.
For a size-budget failure the log prints the per-asset breakdown, so the
offending chunk is visible without rebuilding locally.

## Pull requests

Do not open one unless asked. When you do:

- Describe the change and the reasoning, not just the file list.
- Call out anything deliberately left undone — the end-of-life Lambda runtime
  migration is the standing example (see `docs/AWS_DEPLOYMENT.md` §6).
- Note whether the change needs a backend deploy, a frontend deploy, or both.
  Changing an API route means both, in that order.

## Things that do not belong in a commit

`.gitignore` covers these, but they get re-added by accident:

- `node_modules/` — 15,161 files were tracked here once. `src/package-lock.json`
  is committed, so `npm ci` reproduces the tree exactly.
- `src/dist/` — build output with content-hashed names that change every build.
- `src/public/config.js` — generated at deploy time from stack outputs. It pins
  one environment's API endpoints; committing it ships those to every
  environment.
- AWS account identifiers beyond what is already in `samconfig-dev.toml`, and
  anything resembling a credential. Deploys use a named profile
  (`AWS_PROFILE`), never inline keys.

## Adding a deployment workflow

There is deliberately no deploy-on-merge workflow. Adding one requires an AWS
role for GitHub Actions — use OIDC (`aws-actions/configure-aws-credentials` with
`role-to-assume`), not long-lived access keys in secrets. Deploy order is fixed:
backend, then frontend. And note `disable_rollback = true` in
`samconfig-dev.toml`: an automated deploy that fails will leave the stack
half-applied rather than reverting, so gate it on `validate.sh` passing and
alert on failure.
