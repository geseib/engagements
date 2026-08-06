# Engage2 Refresh — Session Handoff

**Read this first.** It's the current-state snapshot + prioritized remaining work for the Engage2 stabilize/refresh effort. Companion docs in this folder:
- `warm-summit-design-spec.md` — the approved visual redesign spec (photo-hero direction) + current-design audit.
- `admin-prompt-cleanup-plan.md` — the parked admin prompt/question-set cleanup plan (with DynamoDB-hygiene bugs).

Also see repo `DEPLOYMENT.md` (canonical deploy guide) and `docs/AUTH.md`.

---

## Environment truth (important)
- **Canonical tiers are the `engage*` stacks** (CI/CD-managed): `engagedev`/`engagetest`/`engageprod` on `engage.dev`/`engage.test`/`engage.seibtribe.us`. The `eng*` stack `engdev` (`eng.dev.seibtribe.us`) is an **off-pipeline duplicate being retired** — don't confuse them.
- **AWS:** profile `adminaccess` (SSO — `aws sso login --profile adminaccess` when it expires).
- **engagedev facts:** pool `us-east-1_7VC2YyGnU` (domain `engagedev-auth-v2`), REST API `ouv6fztlig`, WebSocket `h8ipndmk4d`, CloudFront `E2ZF54R3GKDUQJ`, buckets `engagedev-web` / `engagedev-ai-prompts` / `engagedev-reports`, DynamoDB table `engagedev`.
- **Git:** branch `dev`. Latest commits: `799f145a` Workie fallback · `f09b511f` infra (repo fix, node22, IAM, docs) · `0aa70978` realtime+Workie async · `7eaad7ee` design foundation · `1a96974c` auth/forgot-password · `e5df3307` repo hygiene.

## Done & committed
- **Repo hygiene** — untracked ~33k vendored `node_modules`/`dist`; removed stale scripts/buildspecs/backup template.
- **CI fix** — GitHub repo corrected to `geseib/engagements` everywhere.
- **Runtime** — Lambda `nodejs18.x → nodejs22.x` (single change point in `template-clean.yaml` Globals).
- **Docs** — canonical `DEPLOYMENT.md` + superseded banners on the old deploy docs.
- **Auth** — self-service **forgot-password** flow (`src/src/auth/ForgotPasswordForm.jsx` + `forgotPassword`/`confirmPassword` in `AuthContext`). Deployed to engagedev.
- **Player client** — reconnection/state-recovery engine (heartbeat, resume handlers, monotonic phase guard, rejoin prompt, resilient broadcast, connection dedup).
- **Workie async backend** — Haiku-4.5-primary, 202 + self-invoke worker + `aiSummaryReady`/`aiSummaryError` WebSocket delivery, memoized renderer.
- **Design foundation** — Warm Summit tokens, palette/gradient kill, Archivo Expanded + Inter fonts, `Icon` (Phosphor) + `Ridge` (SVG) components.

## Done & DEPLOYED but UNCOMMITTED (mid-iteration — needs review then commit)
- **Big-screen redesign + polish pass** in `src/src/GameHostPage.jsx` + `src/src/styles.css`, plus the `React`-import fix in `Icon.jsx`/`Ridge.jsx`. Deployed to engagedev **frontend** via direct `aws s3 sync` (not the pipeline).
- Open visual items: big-screen **vertical rhythm / type scale** and confirming the **standard-view gutter** clears the side panel — waiting on the user's screenshots to iterate. Then commit.

## Fixed live (verified)
- **Workie** — was blank because the `engagedev-ai-prompts` bucket was empty (missing prompt template) + old sync backend deployed + unreachable fallback. Fixed by: surgically updating `engagedev-get-ai-summary` code + adding `lambda:InvokeFunction`/`execute-api:ManageConnections` IAM (policy `WorkieAsyncPolicy`); making the fallback **always-reachable + data-driven** (answer count + votes + top response); seeding the missing prompt at `s3://engagedev-ai-prompts/prompts/callandanswer/md9ih6msyezugcusipp/v1.json`. Verified real Haiku 4.5 output on game `9639`. **NOT a Bedrock license issue** — models are ACTIVE.
- **Password-reset email** — engagedev pool now sends via **SES** (`DEVELOPER`, from `no-reply@seibtribe.us`). `seibtribe.us` domain verified (DKIM in Route53); `george@seibtribe.com` verified as sandbox recipient. Reset codes deliver. SES **production-access request filed** (draft reply is in the session; **user must paste it** into the AWS Support case for any-recipient delivery).
- **Logins** — `george@seibtribe.com` (in `admins`, password via reset) and Google `george.seib@gmail.com` (in `admins`). Google OAuth redirect URI for engagedev was added to the shared Google client. **engagetest** got its own dedicated Google client (`…ch8ll…`).

## Secrets rotated / config fixed
- Leaked GitHub PAT (`.env.github`) — rotated; lives in Secrets Manager `engage/dev/github-token`.
- Leaked Google/Gemini API key (was in `.codex/config.toml`) — revoked; `.codex/` + `AGENTS.md` removed.
- `~/.aws/config` `[profile adminaccess]` SSO-URL conflict — fixed (backup at `~/.aws/config.bak.*`).

---

## Remaining work (prioritized)
1. **Redesign iteration** — get the user's big-screen + standard screenshots; tune vertical rhythm/type scale (`styles.css` `.*-state.big-screen-mode` ~6878) and confirm the standard gutter. Then **commit** the redesign (GameHostPage.jsx, styles.css, Icon.jsx, Ridge.jsx).
2. **Presentation mode** (approved conceptually — build a mockup first). See "Presentation-mode ideas" below.
3. **Admin prompt/question-set cleanup** — parked. Full plan in `admin-prompt-cleanup-plan.md`. Headlines: two confusingly-different prompt generators (modal vs inline), inconsistent game-type vocab, AI-prompt key-schema split (delete/advisor read a different DynamoDB key), question-set DELETE is non-atomic/non-paginated/drops UnprocessedItems, no clean REPLACE path (orphan/clutter risk), missing per-type variable exposure, dead lambdas (pbd generator, download-set).
4. **Archive filter** (game type + tags + search; cross-env prompts/questions + backups) — running in a **separate session** (`task_b1a8e720`).
5. **Retire `engdev`** + repoint local `deployall`/`samconfig-dev` from `engdev` → `engagedev`. (875 durable items already migrated engdev→engagedev.) Destructive — confirm before deleting the stack.
6. **SES production access** — user pastes the drafted support reply.
7. **Prompt seeding for other question sets** (fallback covers them until then) + **prompt-content quality** (separate effort; the seeded template asks for lessons/themes, not the "discussion questions" the parser expects, so those come back sparse).

## Presentation-mode ideas (for item 2)
Big screen = a **presentation surface** (projector or Zoom share), driven like a slideshow, not a dashboard:
- **A. Auto-hide chrome:** after ~4s idle, fade out the side tabs, QR+scores panel, Vote/Skip buttons, Big-Screen toggle, and hide the cursor. Mouse move / key / **spacebar** reveals for ~10s. Lobby keeps the QR always up; questions hide it; results keep the leaderboard (it's the content).
- **B. Kill click-to-expand; auto-fit BIG text.** Question/prompt always at max readable size (short → huge, long → still fits). Category becomes a small kicker.
- **C. Spacebar / → = advance** (works with a presenter's clicker).
- **D.** One design for room *and* small Zoom tile (high relative contrast; auto-hide maximizes content area).
- **E.** A tiny always-on state cue (e.g. amber `● 18 answered`).
Recommend A+B core, C as a cheap add. Build a mockup to tune the ~4s/~10s timings before wiring in.

## Deploy runbook (dev only; user handles test/prod)
- **Frontend → engagedev:** `cd src && npm run build && AWS_PROFILE=adminaccess aws s3 sync dist/ s3://engagedev-web/ --delete && AWS_PROFILE=adminaccess aws cloudfront create-invalidation --distribution-id E2ZF54R3GKDUQJ --paths "/*"`. (Committed `src/public/config.js` targets engagedev.)
- **Backend, one function (surgical, safe on the CI-managed stack):** `sam build -t template-clean.yaml <LogicalId>` → `(cd .aws-sam/build/<LogicalId> && zip -qr /tmp/fn.zip .)` → `AWS_PROFILE=adminaccess aws lambda update-function-code --function-name engagedev-<name> --zip-file fileb:///tmp/fn.zip`. ⚠️ Avoid a full local `sam deploy` to engagedev — it can reset Google-OAuth params on the CI-managed stack.

## Design mockups (approved direction = photo hero)
- Photo-hero (APPROVED): https://claude.ai/code/artifact/b1f15735-ca17-4347-8214-0d791dcbadf9
- Vector-ridge (alt): https://claude.ai/code/artifact/569a6ea7-3404-4411-9567-c6f8dd51a8a4
