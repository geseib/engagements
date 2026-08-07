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

## Emoji → Phosphor icon sweep — COMPLETE (committed, NOT yet deployed)
The whole JSX surface is off emoji. ~380 sites across 35 files; `console.*` prefixes
were deliberately left alone (they're logs, not UI). Two dead files were skipped —
see "Known landmines" below.

New shared modules (use these instead of re-deriving anything):
- `src/src/components/Icon.jsx` — ~80 named Phosphor imports (tree-shaken), exports
  `ICONS` for tests. Every icon carries `.ws-icon`, which one rule in `styles.css`
  uses for optical alignment + `flex:none`.
- `src/src/config/gameTypes.js` — **the** registry for the five types
  (`call-and-answer` / `trivia` / `poll` / `wavelength` / `survey`): label, icon,
  accent, blurb, phases. Normalises the `callandanswer` storage spelling. Replaced
  three hand-rolled type→label/icon switches.
- `src/src/components/RankIcon.jsx` — placement mark + `rankLabel()` ordinals.
  Replaced five copies of the same gold/silver/bronze ladder.
- `src/src/components/StatusMessage.jsx` + `src/src/utils/statusTone.js` — status
  banners.

Bugs found and fixed along the way:
1. **Host Remote's advance buttons were dead.** `GameHostPage.jsx` handled
   `NEXT_QUESTION` / `START_VOTING` / `SHOW_RESULTS` by calling bare
   `nextQuestion` / `startVoting` / `showResults` — identifiers that never
   existed. `typeof x === 'function'` on an undeclared name is `'undefined'`, not
   a throw, so the remote silently did nothing. Now routed through
   `remoteActionsRef` (refreshed each render, because the listener is registered
   once and would otherwise capture a stale `gameState`).
2. **Status banners styled by emoji-sniffing.** Three sites did
   `status.includes('✅') ? 'success' : 'error'`. Replaced with `statusTone()`
   (word-based, unit-tested against the 18 real message strings) and explicit
   `saveOk` state on the AdminPage edit path.
3. **Mobile type overflow.** `.parallax__title` at a fixed `4rem` rendered
   "Engagements" ~395px wide inside a 375px phone, clipped both edges; the join
   `h1` did the same. Both are `clamp()` now. Verified at 375px: no horizontal
   overflow, no sub-40px tap targets.
4. **`<Icon>` inside `<option>`** (IssueReportForm) — options are text-only, so
   the icons were reverted to plain labels there.
5. **Player copy was call-and-answer-only.** The vote screen said "Vote for the
   Best Applications" to poll players too; submit confirmations had no poll case.

Test harness: `npm test` had **never run** — no `babel.config.js`, and
`jest.config.js` said `moduleNameMapping` (not a real option, so CSS imports were
never stubbed). Fixed both plus `transformIgnorePatterns` for ESM-only `d3`.
Added `src/src/__tests__/designSystem.test.jsx` — **37 tests, all passing**.
The five pre-existing suites now execute (0 → 33 tests) but mostly fail: they
predate the auth system (`useAuth must be used within an AuthProvider`) and call
`new WebSocketClient()` on what is a singleton export. **Those failures are stale
tests, not regressions** — rewriting them is its own task.

Verification done: production build clean; AST checks confirm every literal
`<Icon name>` resolves, none are stranded inside string literals, and none sit in
text-only elements. Live-rendered the player join screen at 375px and 1280px.
**Not deployed** — host/admin screens need auth + a live backend, so the
icon-dense states (lobby, ASK/VOTE/RESULTS, big-screen, admin) are still
eyeball-pending on engagedev.

## Known landmines
- `src/src/components/ArchiveManager.jsx` and `ArchiveSearch.jsx` are **stored as a
  single line with literal `\n` and `\"` escapes** — not valid JS. Nothing imports
  them and webpack never compiles them, so they're invisible dead weight. They
  were excluded from the sweep. The real archive UI is `ArchivePanel.jsx`.
  Either restore or delete them; don't edit them in place.
- `src/src/AdminPage.jsx.backup` is likewise stale and should go.
- `bundle.js` is 2.04 MiB and `workie.png` is 1.32 MiB (webpack warns on both).

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
1. **Deploy the sweep to engagedev and eyeball it** — the icon-dense screens
   (host lobby, ASK/VOTE/RESULTS, big-screen mode, admin, Field Notes) could not
   be reached locally without auth + a live backend. Frontend deploy command is
   in the runbook below. Watch specifically for icons that look under- or
   over-sized in slots whose CSS used `font-size` to scale the old emoji —
   `styles.css` handles the five known ones (`.success-icon`, `.ai-review-icon`,
   `.type-icon`, `.alert-icon`, `.help-role-icon`) with a `1em` rule, but the
   list came from a static scan, not from seeing them live.
2. **Redesign iteration** — big-screen vertical rhythm/type scale
   (`styles.css` `.*-state.big-screen-mode`) and confirming the standard gutter
   clears the side panel. Still needs the user's screenshots.
3. **Presentation mode** (approved conceptually — build a mockup first). See "Presentation-mode ideas" below.
4. **Stale test suites** — the five pre-existing suites now run but assert against
   a pre-auth UI. Either wrap them in `AuthProvider` and fix the
   `WebSocketClient` singleton assumption, or delete them.
5. **Admin prompt/question-set cleanup** — parked. Full plan in `admin-prompt-cleanup-plan.md`. Headlines: two confusingly-different prompt generators (modal vs inline), inconsistent game-type vocab, AI-prompt key-schema split (delete/advisor read a different DynamoDB key), question-set DELETE is non-atomic/non-paginated/drops UnprocessedItems, no clean REPLACE path (orphan/clutter risk), missing per-type variable exposure, dead lambdas (pbd generator, download-set).
6. **Archive filter** (game type + tags + search; cross-env prompts/questions + backups) — running in a **separate session** (`task_b1a8e720`).
7. **Retire `engdev`** + repoint local `deployall`/`samconfig-dev` from `engdev` → `engagedev`. (875 durable items already migrated engdev→engagedev.) Destructive — confirm before deleting the stack.
8. **SES production access** — user pastes the drafted support reply.
9. **Prompt seeding for other question sets** (fallback covers them until then) + **prompt-content quality** (separate effort; the seeded template asks for lessons/themes, not the "discussion questions" the parser expects, so those come back sparse).

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
