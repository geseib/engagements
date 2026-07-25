---
name: aws-deploy
description: "Use when deploying, validating, debugging, or rolling back the Engagements AWS stack — SAM/CloudFormation templates, Lambda functions, the CloudFront/S3 frontend, or DynamoDB. Triggers on requests to deploy, ship, push to AWS, run sam deploy, check stack status, read Lambda logs, diagnose a failed deploy or 5xx, invalidate CloudFront, or change template-dev.yaml. Also use before editing any Lambda handler, since they live inline inside the template where normal tooling cannot see them."
---

# Deploying the Engagements AWS stack

Full runbook: `docs/AWS_DEPLOYMENT.md`. This skill is the operating procedure.

## Always validate first

```bash
./scripts/validate.sh
```

Needs no AWS credentials. Never skip it — it catches the failure modes this
template is actually prone to, none of which `sam deploy` will warn you about.

## Deploy order is fixed

```bash
./scripts/deploy-dev.sh            # backend first
./scripts/deploy-frontend-dev.sh   # then frontend
```

The frontend script reads the API and WebSocket URLs from the backend stack's
outputs and writes them into `config.js`. Deploying the frontend against a
stack that does not exist, or skipping the frontend after the API URL changed,
ships an app pointed at nothing.

`AWS_PROFILE` defaults to `adfs`; override with `AWS_PROFILE=x ./scripts/...`.

## Five things that will bite you

**1. `sam validate` does not catch duplicate resource keys.**
Duplicate keys are legal YAML. The parser keeps the last one and silently drops
the earlier definition — including its API routes. This repo shipped two
`GetAISummaryFunction` blocks. Always use `--lint`:

```bash
sam validate --template-file template-dev.yaml --region us-east-1 --lint
```

**2. Lambda handlers live inside the template as `InlineCode`.**
~3,700 lines of JavaScript that no linter, formatter, or test runner sees. A
syntax error surfaces at cold start, in production. After editing any handler:

```bash
./scripts/validate.sh   # runs node --check over every inline block
```

**3. You cannot bump the Lambda runtime on its own.**
34 functions run `nodejs16.x` and `require('aws-sdk')`. SDK v2 is bundled in
nodejs16.x but **not** in nodejs18.x or later. Changing the runtime alone
breaks every one of them at cold start with `Cannot find module 'aws-sdk'`.
The runtime bump and the SDK v2 → v3 migration are a single change. See
§6 of the runbook for the staged plan — extract the code from YAML first.

**4. `disable_rollback = true` is set in `samconfig-dev.toml`.**
A failed update stays half-applied instead of reverting. Good for debugging,
bad for production. Check stack status after every deploy.

**5. The DynamoDB table is a stack resource.**
`sam delete`, or a replacement-triggering property change, destroys every game.
Back up before anything destructive:

```bash
aws dynamodb create-backup --table-name <t> --backup-name "pre-deploy-$(date +%Y%m%d-%H%M)"
```

## Diagnosing a failed deploy

```bash
# Why did it fail? Read the earliest FAILED event, not the last one —
# later events are usually rollback noise.
aws cloudformation describe-stack-events --stack-name engagements-v1 \
  --query 'StackEvents[?ResourceStatus==`CREATE_FAILED`||ResourceStatus==`UPDATE_FAILED`].[Timestamp,LogicalResourceId,ResourceStatusReason]' \
  --output table
```

| Symptom | Usual cause |
| --- | --- |
| `Cannot find module 'aws-sdk'` at cold start | runtime bumped past nodejs16.x without the SDK v3 migration |
| A route 404s that you know you defined | duplicate resource key ate the definition — run `--lint` |
| Deploy succeeds, script prints "Unable to fetch API URL" | stack-name drift between script and samconfig |
| Frontend loads but every API call fails | frontend not redeployed after the API URL changed |
| `UPDATE_ROLLBACK_FAILED` | `aws cloudformation continue-update-rollback --stack-name engagements-v1` |
| Certificate stuck in `PENDING_VALIDATION` | Route53 CNAME not yet propagated; ACM waits, so does the stack |

Logs:

```bash
sam logs --stack-name engagements-v1 --name GetGameStateFunction --tail
```

## Changing the frontend

Assets are content-hashed and emitted under `dist/assets/`. That is what lets
CloudFront cache them for a year. If you change the webpack output layout, the
`assets/*` CloudFront behavior in `template-dev.yaml` must change with it, or
files will be cached under the wrong policy.

Keep `config.js` out of the bundle. It is generated per environment at deploy
time and must stay unhashed and uncached.

## Performance guardrails

Before adding a dependency to `src/`, check what it costs:

```bash
cd src && npm run build   # webpack prints per-asset sizes
```

The initial payload is currently ~379 KiB raw / ~98 KiB gzipped. It was 982 KiB
because `html2pdf.js` was imported eagerly for a feature almost nobody uses.
Anything that large belongs behind a dynamic `import()`:

```js
const html2pdf = await import('html2pdf.js').then((m) => m.default ?? m);
```

Do not set `Compress: false` on a CloudFront behavior. All of them are `true`
now, and that is where most of the transfer saving comes from.
