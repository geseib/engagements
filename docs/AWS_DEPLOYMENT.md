# AWS Deployment Runbook

How the Engagements stack is built, deployed, verified, and rolled back.

---

## 1. What gets deployed

One SAM stack (`engagements-v1`, us-east-1) plus a static frontend uploaded to
the S3 bucket that stack creates.

| Piece | Where it lives | Deployed by |
| --- | --- | --- |
| 37 Lambda functions | `template-dev.yaml` (`InlineCode`) | `scripts/deploy-dev.sh` |
| HTTP API + WebSocket API | `template-dev.yaml` | `scripts/deploy-dev.sh` |
| DynamoDB table | `template-dev.yaml` | `scripts/deploy-dev.sh` |
| CloudFront + S3 + ACM + Route53 | `template-dev.yaml` | `scripts/deploy-dev.sh` |
| React app | `src/` | `scripts/deploy-frontend-dev.sh` |

**Backend before frontend, always.** The frontend script reads the API and
WebSocket URLs out of the stack's CloudFormation outputs and bakes them into
`config.js`. If the stack does not exist, or its outputs have changed, the
frontend must be redeployed to pick them up.

---

## 2. Configuration lives in one place

`samconfig-dev.toml` is the source of truth for stack name, region, artifact
bucket, and the `DomainName` / `HostedZoneId` parameter overrides.

Both deploy scripts *read* the stack name and region from it. Do not hardcode a
stack name in a script — the two previously disagreed (`quiz-game-dev` in the
script vs `engagements-v1` in the config), which meant every output lookup
silently failed and the deploy reported "Unable to fetch API URL" on success.
`scripts/validate.sh` now fails the build if a script reintroduces a literal
stack name.

```toml
stack_name = "engagements-v1"
region     = "us-east-1"
parameter_overrides = "DomainName=engagements.sb.seibtribe.us HostedZoneId=Z03473042HSYD8BUY4XSL"
```

---

## 3. Deploying

```bash
# Validate first — needs no AWS credentials.
./scripts/validate.sh

# Backend, then frontend.
./scripts/deploy-dev.sh
./scripts/deploy-frontend-dev.sh
```

`AWS_PROFILE` defaults to `adfs` but is overridable:

```bash
AWS_PROFILE=my-sso-profile ./scripts/deploy-dev.sh
```

Extra arguments to `deploy-dev.sh` are passed through to `sam deploy`:

```bash
./scripts/deploy-dev.sh --no-execute-changeset   # review the changeset first
./scripts/deploy-dev.sh --guided                 # reconfigure samconfig
```

### What `deploy-frontend-dev.sh` does, and why the order matters

`index.html` names content-hashed asset files. If the two are uploaded in the
wrong order, a client loading the page mid-deploy gets an `index.html` pointing
at objects that are missing on one side of the cutover. The script therefore:

1. uploads `assets/` **without** `--delete` — new files land, old ones survive
2. uploads `index.html` and `config.js` — the atomic cutover
3. re-syncs `assets/` **with** `--delete` — prunes what nothing references now

---

## 4. Validating before you deploy

```bash
./scripts/validate.sh            # errors fail, warnings report
STRICT=1 ./scripts/validate.sh   # warnings fail too (used in CI)
```

It checks five things:

**Duplicate resource keys.** A duplicate key is *not* a YAML error. The parser
keeps the last block and silently discards the earlier one. This repo shipped
two `GetAISummaryFunction` definitions for exactly this reason, and one of them
was dead code for as long as both existed.

> `sam validate` passes on a template with duplicate keys.
> Only `sam validate --lint` catches them. Use `--lint`.

**cfn-lint findings**, via `sam validate --lint`.

**Inline JavaScript syntax.** About 3,700 lines of handler code live inside the
template as `InlineCode`, where no linter, formatter, or test runner can reach
it. `validate.sh` extracts each block and runs `node --check` over it, so a
syntax error is caught here instead of at a Lambda cold start in production.

**Runtime vs SDK version.** See §6 — `require('aws-sdk')` throws on nodejs18.x
and later.

**Stack-name drift** between the scripts and `samconfig-dev.toml`.

---

## 5. Verifying a deploy

```bash
STACK=engagements-v1

# Stack settled cleanly?
aws cloudformation describe-stacks --stack-name $STACK \
  --query 'Stacks[0].StackStatus' --output text
# Expect CREATE_COMPLETE or UPDATE_COMPLETE.

# Endpoints
aws cloudformation describe-stacks --stack-name $STACK \
  --query 'Stacks[0].Outputs' --output table

# Smoke test: this should return the question sets, not a 5xx.
API=$(aws cloudformation describe-stacks --stack-name $STACK \
  --query "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue" --output text)
curl -sS "$API/question-sets" | head -c 400

# Confirm compression is actually being applied at the edge.
SITE=$(aws cloudformation describe-stacks --stack-name $STACK \
  --query "Stacks[0].Outputs[?OutputKey=='WebsiteUrl'].OutputValue" --output text)
curl -sS -H 'Accept-Encoding: gzip' -o /dev/null -D- "$SITE/assets/vendor.*.js" \
  | grep -i 'content-encoding'
# Expect: content-encoding: gzip
```

If a Lambda is misbehaving, its logs are the fastest signal:

```bash
sam logs --stack-name engagements-v1 --name GetGameStateFunction --tail
aws logs tail /aws/lambda/<physical-function-name> --follow --since 10m
```

---

## 6. Known issue: end-of-life Lambda runtimes

`validate.sh` reports this as a warning on every run. It is real, it has a
deadline, and it is deliberately not fixed yet.

**State today.** 34 functions inherit `nodejs16.x` from `Globals`; 3 override to
`nodejs18.x`. Both are past their AWS deprecation date.

| Runtime | Deprecated | Create blocked | Update blocked |
| --- | --- | --- | --- |
| nodejs16.x | 2024-06-12 | 2027-02-01 | 2027-03-03 |
| nodejs18.x | 2025-09-01 | 2027-02-01 | 2027-03-03 |

Existing functions keep running past these dates; what stops is your ability to
*create* and then to *update* them. After the update cutoff this stack can no
longer be deployed at all.

**Why you cannot just bump the runtime.** The AWS SDK for JavaScript v2 is
bundled into the nodejs16.x runtime image. It is **not** bundled into
nodejs18.x or later. Every one of the 34 functions starts with:

```js
const AWS = require('aws-sdk');
const db = new AWS.DynamoDB.DocumentClient();
```

Changing `Globals.Function.Runtime` to `nodejs22.x` without touching the code
would make all 34 fail at cold start with `Cannot find module 'aws-sdk'`. The
runtime bump and the SDK v2 → v3 migration are one change, not two.
`validate.sh` check 4 exists to catch exactly this mistake.

**Migration shape.** Per function:

```js
// Before — SDK v2, bundled only in nodejs16.x
const AWS = require('aws-sdk');
const db = new AWS.DynamoDB.DocumentClient();

const result = await db.get({ TableName, Key: { PK, SK } }).promise();
const item = result.Item;

// After — SDK v3, bundled in nodejs18.x and later
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');
const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const result = await db.send(new GetCommand({ TableName, Key: { PK, SK } }));
const item = result.Item;
```

Command mapping for what this codebase uses:

| v2 | v3 command | from |
| --- | --- | --- |
| `db.get(...)` | `GetCommand` | `@aws-sdk/lib-dynamodb` |
| `db.put(...)` | `PutCommand` | `@aws-sdk/lib-dynamodb` |
| `db.query(...)` | `QueryCommand` | `@aws-sdk/lib-dynamodb` |
| `db.update(...)` | `UpdateCommand` | `@aws-sdk/lib-dynamodb` |
| `db.delete(...)` | `DeleteCommand` | `@aws-sdk/lib-dynamodb` |
| `db.batchWrite(...)` | `BatchWriteCommand` | `@aws-sdk/lib-dynamodb` |
| `new AWS.ApiGatewayManagementApi(...)` | `ApiGatewayManagementApiClient` + `PostToConnectionCommand` | `@aws-sdk/client-apigatewaymanagementapi` |
| `new AWS.S3(...)` | `S3Client` + `PutObjectCommand` | `@aws-sdk/client-s3` |

Three behavioural differences to watch for:

- `.promise()` is gone; `db.send(command)` already returns a promise.
- Errors carry `err.name` rather than `err.code`. Any
  `if (err.code === 'ConditionalCheckFailedException')` must become `err.name`.
- v3 marshalls automatically only through `lib-dynamodb`. Using
  `client-dynamodb` directly means hand-writing `{ S: "..." }` attribute values.

**Recommended sequencing.** Do not attempt all 37 in one commit — there is no
test coverage over the inline handlers, so a regression is invisible until a
game breaks mid-session.

1. **Extract the inline code first.** Move each handler out of the YAML into
   `functions/<name>/index.js` with `CodeUri`, so it becomes lintable,
   testable, and reviewable in a normal diff. This is the change that makes
   everything after it safe, and it is behaviour-preserving on its own.
2. Add unit tests over the handlers with the highest blast radius:
   `SetGameStateFunction`, `SubmitVotesFunction`, `GetGameStateFunction`,
   `UpdateScoresFunction`.
3. Migrate to SDK v3 and bump the runtime, in batches, deploying to a
   throwaway stack between batches (`--stack-name engagements-migrate`).
4. Delete the throwaway stack.

Until step 1 lands, `scripts/validate.sh` is the only automated check standing
between a typo in that YAML and a production cold-start failure.

---

## 7. Rolling back

CloudFormation rolls back automatically on a failed update — **except** that
this stack sets `disable_rollback = true` in `samconfig-dev.toml`. That setting
is useful while iterating (the failed resource is left in place to inspect) and
dangerous in production (a half-applied update stays half-applied).

To roll back by hand:

```bash
# What changed, and when?
aws cloudformation describe-stack-events --stack-name engagements-v1 \
  --max-items 40 \
  --query 'StackEvents[?ResourceStatus!=`UPDATE_COMPLETE`].[Timestamp,LogicalResourceId,ResourceStatus,ResourceStatusReason]' \
  --output table

# Roll the stack back to its last good state.
aws cloudformation cancel-update-stack --stack-name engagements-v1     # if still updating
aws cloudformation continue-update-rollback --stack-name engagements-v1 # if stuck in UPDATE_ROLLBACK_FAILED
```

Frontend rollback is a redeploy from the previous commit:

```bash
git checkout <last-good-sha> -- src/
./scripts/deploy-frontend-dev.sh
```

This is safe because assets are content-hashed: the old build's filenames are
different from the new one's, so re-uploading restores the exact previous
bytes rather than mutating a shared `bundle.js`.

**Data is not covered by any of this.** The DynamoDB table is a stack resource.
Deleting the stack deletes the table and every game in it. Before any
destructive operation:

```bash
aws dynamodb create-backup \
  --table-name <table-name> \
  --backup-name "pre-deploy-$(date +%Y%m%d-%H%M)"
```

---

## 8. Cost and performance notes

- **CloudFront caching.** `assets/*` is content-hashed and served with the
  managed *CachingOptimized* policy. Everything else — `index.html`,
  `config.js`, and all `/games`, `/questions`, `/admin` API paths — uses
  *CachingDisabled*, which is correct: those are per-request and per-deploy.
- **Compression** is on for every behavior. It was off everywhere before, which
  meant ~1.15 MB of JavaScript went over the wire uncompressed on each cold
  load. Do not set `Compress: false` again to "rule it out" while debugging.
- **`workie.png` is 1.35 MB**, larger than the entire compressed JS payload.
  Converting it to WebP, or resizing it to its displayed dimensions, is the
  single largest remaining transfer win.
- **PriceClass_100** limits edge locations to North America and Europe. Widen
  it only if you have users elsewhere.

---

## 9. Quick reference

```bash
./scripts/validate.sh                  # pre-flight, no credentials needed
./scripts/deploy-dev.sh                # backend
./scripts/deploy-frontend-dev.sh       # frontend (run after backend)

sam validate --template-file template-dev.yaml --lint   # the linting that matters
sam logs --stack-name engagements-v1 --name <Fn> --tail

aws cloudformation describe-stacks --stack-name engagements-v1 \
  --query 'Stacks[0].Outputs' --output table
```
