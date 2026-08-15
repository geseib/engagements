# CLAUDE.md - Engage2 Project Context

## **🚨 DEPLOYMENT RULE 🚨**

**Claude may deploy DEV and TEST. PROD may be started, and halts at the owner's approval gate.**

Changed 2026-08-12 by the owner, in two steps: dev first, then test and prod. The owner's
reasoning, verbatim: *"Prod pipeline has a human gate for me to approve, so dont worry that you
will break things. i wont approve if test doesnt already look acceptable so prod is safely
protected."*

| Tier | Who may deploy it — **by tag OR by branch push, both of which deploy** |
|---|---|
| **dev** (`dev-v*` tag, or a push to `dev`) | **Claude deploys freely and often.** Baselines must hold first. In practice this means pushing the branch, since tag pushes 403 from the remote container. |
| **test** (`test-v*` tag, or a push to `test`) | **Claude may deploy** once the work looks close to right on dev. Test is the owner's review surface — put things there when they are worth looking at, not when they are perfect. |
| **prod** (`prod-v*` tag, or a push to `prod`) | **Claude may start it.** It halts at `ApprovalForProd` and does not proceed without the owner. Only start it for work that has already been through test. |

What the widened permission does **not** change:
- **Tests and build first, every tier.** The backend suite, the frontend suite and
  `npm run build` all run and the baselines hold before anything is pushed. A red suite is not
  a deploy, on any tier.
- **Test before prod.** Never start prod for something that has not sat on test. The owner's
  protection is that they will not approve what test has not shown them — do not lean on it as
  a substitute for looking.
- **Say what you deployed.** Name the commit and the tier in the reply. The pipeline execution
  history is the only reliable record of what is live.
- **Push the branch or the tag, never both at once** — both trigger, so doing both fires two
  executions of one commit into the same stack.
- **Never run `./deployall`, `./scripts/deploy-clean.sh` or `./scripts/deploy-frontend-eng.sh`.**
  They target the off-pipeline `engdev` stack, not the CI/CD tiers.

## **WHAT COUNTS AS A DEPLOY — read this before believing the template**

**BOTH a `<tier>-v*` TAG AND A PUSH TO THE TIER BRANCH DEPLOY.** Confirmed by the owner
2026-08-12. `git push origin dev` reaches the dev environment on its own; no tag is required.

**The template in this repo says otherwise and the template is not what is running.**
`cicd/pipeline-clean.yaml` was changed by `b6929cac` to carry only `- Tags:` in each `Triggers`
block, and `docs/handoff/RESUME.md` has always recorded that this commit was **committed and
never applied**. The running pipelines still carry their `- Branches:` entry. Reading the
template and concluding "branch pushes are inert" is wrong, and an earlier version of this file
said exactly that.

Consequences that actually matter:

- **A branch push is a deploy.** Pushing work to `dev` to share it, back it up, or get it
  reviewed also ships it. There is no "just push it" on a tier branch.
- **Push the branch OR the tag, never both.** Both trigger, so doing both fires two executions
  of the same commit into the same stack.
- **`main` has no pipeline** and triggers nothing.

To re-check at any time — and do re-check before trusting either rule:
```bash
aws codepipeline get-pipeline --name engagecicd-pipeline-dev --query 'pipeline.triggers'
```

If that comes back tags-only, `b6929cac` has finally been applied and this section needs
rewriting again.

**Known environment limitation:** in the Claude Code remote container, pushes to `refs/tags/*`
fail with **HTTP 403** while pushes to `refs/heads/*` succeed. Verified four ways, including a
`--dry-run` tag push that succeeds where the real one does not. So from that environment a
branch push is the only deploy route available, which — given the rule above — works.

Never run `./deployall`, `./scripts/deploy-clean.sh` or `./scripts/deploy-frontend-eng.sh`. They
target the off-pipeline `engdev` stack, not the CI/CD tiers.

## Project Overview
Real-time engagement platform for strategic thinking sessions with AWS serverless architecture.

## Tech Stack
- **Frontend**: React, WebSockets, QR codes
- **Backend**: AWS Lambda (Node.js), DynamoDB, API Gateway, WebSocket API
- **Infrastructure**: SAM (Serverless Application Model), CloudFormation
- **Deployment**: CodePipeline per tier, **triggered by git tags only**

## Deployment Strategy
Three CodePipelines, one per tier, each started by **one thing: a tag**. A branch push shares
code and deploys nothing. See `DEPLOYMENT.md` for the full picture.

| Tier | Stack | Trigger | Gate |
|---|---|---|---|
| **dev** | `engagedev` | `dev-v*` tag | none — deploys immediately |
| **test** | `engagetest` | `test-v*` tag | none — deploys immediately |
| **prod** | `engageprod` | `prod-v*` tag | halts at `ApprovalForProd` until a human approves |

- **Flow**: `dev` → `test` → `prod`
- `main` triggers nothing and has no pipeline attached.
- The `engagecicd` stack itself is **not** deployed by any pipeline — it is applied by hand with
  `aws cloudformation deploy --template-file cicd/pipeline-clean.yaml --stack-name engagecicd`.
- The `eng*` / `engdev` stacks are an off-pipeline duplicate being retired. Not a CI/CD tier.

## Architecture Overview

### Database Design
- Single-table DynamoDB pattern
- Key prefixes: `GAME#`, `PLAYER#`, `GAMES`
- TTL: 90 days (creation), 7 days (active)

### Game Flow
```
Create → Start (players join) → Questions (ASK/VOTE/RESULTS) → End
```
- **Trivia**: ASK → RESULTS (no voting)
- **Polls**: ASK → VOTE → RESULTS

### Real-time Features
- WebSocket connections for live updates
- Host/player synchronization
- Automatic stale connection cleanup

### Category System
- Bitmask implementation (3×8 bits = 24 categories)
- Stored as HostMask1/2/3 in database
- Frontend uses Set for active categories

## Project Structure
```
/lambda-functions/
  /websocket/          # WebSocket handlers
  /game/               # Game APIs
  /admin/              # Admin functions, AI generation
/src/src/              # React frontend
  GameHostPage.jsx     # Host interface
  GamePlayerPage.jsx   # Player interface
  /components/         # Reusable UI components
/template-clean.yaml   # SAM infrastructure
```

## Common Commands

### Development
```bash
# Deploy all (backend + frontend)
./deployall

# Deploy backend only
./scripts/deploy-clean.sh engdev eng.dev.seibtribe.us

# Deploy frontend only
./scripts/deploy-frontend-eng.sh

# Local development
npm start              # Frontend dev server
sam local start-api    # Local API testing

# Debugging
sam logs -n [FunctionName] --stack-name engdev --tail
```

### Testing
```bash
# Create game
curl -X POST https://api.dev.domain.com/games \
  -H "Content-Type: application/json" \
  -d '{"eventTitle":"Test","gameType":"trivia","questionSetId":"tech"}'

# Get game state
curl https://api.dev.domain.com/games/{gameId}?role=host

# Clear games (dev only)
curl -X DELETE https://api.dev.domain.com/admin/clear-all-games
```

## Environment URLs

## **🚨 `eng.dev.seibtribe.us` IS NOT THE DEV SITE. `engage.dev.seibtribe.us` IS. 🚨**

Every URL previously in this table was wrong, and the dev one wrongly named the **retired
`engdev` stack**. Read from live AWS on 2026-08-15 — CloudFront aliases, the S3 origin behind
each, and the `config.js` each site actually loads. Re-derive rather than trust this table:

```bash
aws cloudfront list-distributions \
  --query 'DistributionList.Items[].{Alias:Aliases.Items[0],Origin:Origins.Items[0].DomainName}' --output table
aws s3 cp s3://engagedev-web/config.js -      # what the dev site is really pointed at
```

| Environment | Frontend | API | Cognito pool | Bucket |
|---|---|---|---|---|
| **dev** | https://engage.dev.seibtribe.us | `https://ouv6fztlig.execute-api.us-east-1.amazonaws.com/dev/` | `us-east-1_7VC2YyGnU` | `engagedev-web` |
| **test** | https://engage.test.seibtribe.us | `https://69abatw833.execute-api.us-east-1.amazonaws.com/test/` | `us-east-1_JKKUmbQte` | `engagetest-web` |
| **prod** | https://engage.seibtribe.us | `https://tlx3bee2sa.execute-api.us-east-1.amazonaws.com/prod/` | `us-east-1_N08nHLohH` | `engageprod-web` |

`api.test.seibtribe.us`, `api.seibtribe.us`, `eng.test.seibtribe.us` and `eng.seibtribe.us`
resolve to nothing — there is no CloudFront alias or API custom domain for any of them.

### The dead twin, and the two days it cost

| | `eng.dev.seibtribe.us` | `engage.dev.seibtribe.us` |
|---|---|---|
| bucket | `engdev-web` | `engagedev-web` |
| last built | **2026-07-02** | every dev deploy |
| pipeline | **none** | `engagecicd-pipeline-dev` |
| Cognito pool | `us-east-1_ow22HbCT0` (`engdev-users`) | `us-east-1_7VC2YyGnU` (`engagedev-users`) |

`eng.dev.seibtribe.us` is the off-pipeline `engdev` stack this file already says is being
retired — but the table above sent everyone to it anyway. It is frozen at a July 2 bundle, so
**every change shipped since then is invisible there** and the site reads as "the deploy did
nothing". Its bundle even carries the **test** pool id, baked in at build time.

This is the concrete reason for the standing rule against `./deployall`,
`./scripts/deploy-clean.sh` and `./scripts/deploy-frontend-eng.sh`: they publish to
`engdev-web`, which is the dead twin.

### Password reset: which ACCOUNTS exist, never which pool is configured how

Reset worked on test and not on dev, and there is no configuration difference between them.
All three pools are plain `COGNITO_DEFAULT`, identically configured, and **SES is not in the
path at all** — which is why the SES account showed zero sends and why two sessions were spent
chasing a delivery fault that never existed.

`ForgotPassword` can only reset an account that HAS a password. Two states have none:

| Status | Why there is no password |
|---|---|
| `EXTERNAL_PROVIDER` | Federated (Google). The password lives at Google. |
| `FORCE_CHANGE_PASSWORD` | Admin-created; the temporary password was never exchanged. |

Test had two `CONFIRMED` native accounts (`george+1@`, `george+3@seibtribe.com`) and dev had
**none** — two federated identities plus one account stuck in `FORCE_CHANGE_PASSWORD` since it
was created on 2026-08-05. That was the whole difference.

**Fixed 2026-08-15**: `044864f8-10c1-70ff-1344-85423e394cfb` (`george@seibtribe.com`, `admins`)
was moved to `CONFIRMED` with `admin-set-user-password --permanent`, using a throwaway password
that was never recorded — the point was only to leave the account resettable so the owner sets
their own via the emailed code. Reset on dev now works for `george@seibtribe.com`.

`george.seib@gmail.com` still cannot be reset on **either** tier, and never could: it is
federated-only in both pools. Sign in with **Google** for that identity — it is in `admins` on
dev.

### Telling a sent code from a silent no-op

`PreventUserExistenceErrors` is **ENABLED** on every app client, so `ForgotPassword` answers
with a masked `CodeDeliveryDetails` whether or not it sent anything. The response cannot be
used as evidence. This pair can:

```bash
aws cognito-idp confirm-forgot-password --client-id <id> --username <email> \
  --confirmation-code 000000 --password 'Zz9!aQwErTy123'
```

| Exception | Meaning |
|---|---|
| `CodeMismatchException` | A real pending code exists — the email WAS sent. |
| `ExpiredCodeException` | No code was ever issued — nothing was sent. |

Verify against a deliberately nonexistent address as a control; it returns `ExpiredCode`, which
is the "nothing to reset" signature. Note this burns one wrong-code attempt against the rate
limit, so use it sparingly rather than in a loop.

## Authentication System
- **AWS Cognito** for user authentication and authorization
- **User Groups**: `admins`, `hosts`, `pending`
- **Public Access**: Players can join sessions without login
- **Protected Routes**: Host/admin features require authentication
- **Social Providers**: Google, Facebook, Amazon, Apple (configured via Cognito Console)

### Setup Authentication
1. Deploy SAM template: `./deployall` or `./scripts/deploy-clean.sh engdev eng.dev.seibtribe.us`
2. Update frontend environment: `./scripts/update-frontend-env.sh engdev`
3. **Configure Social Providers (Optional)**: In AWS Cognito Console, add Google/Facebook/Amazon/Apple providers
4. **Update UserPoolClient**: Add social providers to SupportedIdentityProviders in template-clean.yaml if configured
5. Create admin user via Cognito Console or registration form
6. Add user to `admins` group

### User Management
- **Admins**: Can create/manage users, access all features
- **Hosts**: Can create and manage game sessions
- **Pending**: Newly registered users awaiting approval
- **Registration**: Users register → pending group → admin approval → hosts/admins group

## AI Integration
- AWS Bedrock (Claude 3 Haiku) for result summaries
- Prompt generation and customization via admin UI
- GitHub issue creation for feedback

## Question Formats

### Trivia Questions
```javascript
{
  id: timestamp,
  title: "Short title",
  questionDetail: "Full question text",
  category: "Category",
  optionA-D: "Answer choices",
  correctAnswer: "OptionA", // Must be OptionA/B/C/D
  answerDetails: "Explanation",
  difficulty: "easy|medium|hard"
}
```

### Poll Questions
```javascript
{
  id: timestamp,
  title: "Question/prompt",
  detail: "Background context",
  category: "Category",
  customInstructions: "Response guidance"
}
```

## Active Issues
- Category bitmask showing zeros (debug logging added)
- Categories flashing then deactivating
- Player dates showing 1969 epoch time

## Recent Changes
- **Authentication System**: Upgraded to UserPoolV2 with mutable email attributes to fix Google OAuth
- **Documentation**: See `docs/AUTHENTICATION_RECOVERY.md` for post-deployment steps
- **Domain Change**: Cognito domain changed from `engdev-auth` to `engdev-auth-v2`

## Data Flow Pattern
1. **Action**: Host triggers via HTTP API
2. **Persist**: API updates DynamoDB
3. **Notify**: WebSocket broadcasts to clients
4. **Refresh**: Clients fetch fresh data via HTTP

## Performance Notes
- Connection pooling for DynamoDB
- Request deduplication for rapid calls
- Question data caching in component state
- WebSocket notification batching

---
*Last Updated: 2025-07-28*