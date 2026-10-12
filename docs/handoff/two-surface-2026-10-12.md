# Handoff: two surfaces, Call & Answer, Claude 5.5 — 2026-10-12

Read this first in a new session. Worktree `.claude/worktrees/affectionate-bouman-48e07a`,
branch `working/build-room-host-redesign`. Read the repo `CLAUDE.md` (deploy rules: a push to
`dev` deploys dev; test is MERGED into; prod is a fast-forward of test and halts at the owner's gate).

## Where each tier is (end of 2026-10-12)

| Tier | Commit | Notes |
|---|---|---|
| prod | `324fd05d` | Unchanged, waiting at ApprovalForProd. Owner said "not yet". Still lacks the Cognito WriteAttributes fix. |
| test | `c0c49ea0` | Merged dev of 11 Oct + test's own federation rule. Claude 5.5 switch + model picker, usage stats, Advisor fixes + shuffle, plugin 1.17.0, Share demo, two codes, Gathering fix. New C&A prompt `mv455iv02awft6oxyow` installed. **5.5 not yet proven on test** (no Claude call since deploy). |
| dev | `1359cc2b` | All of test + follow-up asks backend (`7a99e0b2`), console Overview + scope tabs + team approval (paid teams only, `3845646e`), Remote live list + Workie starts at round close (`ed987765`), sign-in expiry fix + Google PKCE (`1359cc2b`). |
| branch head | `e1ce95ae` + uncommitted | Phase 1 of the two-surface build IN PROGRESS (see below). Nothing after `1359cc2b` is on dev. |

AWS: `AWS_PROFILE=adminaccess`. When remote, sign in with a device code:
`aws sso login --profile adminaccess --use-device-code --no-browser` (the owner approves at
`https://d-90663aa3e9.awsapps.com/start/#/device?user_code=…` on their phone; codes last ~10 min).

## Next, in order

1. **Phase 1 of the two-surface build** (`docs/design/two-surface/PLAN.md` "Phase 1" and "First phase in
   detail"). A subagent in the previous session was mid-way: committed `abfc044f` (round words) and
   `e1ce95ae` (`roundStep`); **uncommitted edits** exist in `GameHostPage.jsx`, `config/hostControls.js`,
   `config/roundStep.js`, `config/roundWords.js` and four host tests. First: `git status` / `git diff` —
   if the previous agent's work is still being written (files changing), wait; otherwise review the diff,
   finish Phase 1 from the plan (server facts on stage-beat/stage-focus + get-game-state, counts-only
   room view, Remote paging the read, read never skipped, Remote ENDED action, parity test), run all
   gates, push to dev, give the owner the plan's verification list.
2. **Owner to test on dev**: Google sign-in (the new PKCE code flow has never run against Cognito —
   roll back `auth/googleSignIn.js` + `OAuthCallback.jsx` if it fails); a host screen open > 1 hour then
   Next Round; a session ended elsewhere → "Open Session Report".
3. **Confirm Claude 5.5 on test**: after the owner's agents run any AI feature on test, check
   `/aws/lambda/engagetest-*` logs for `"event":"claude-route"` lines (served by `claude-haiku-5-5` /
   `claude-sonnet-5-5`) and no `claude-route-fallback`.
4. **Phases 2–6** of the two-surface plan, one at a time, each gated and pushed to dev, owner verifies.
5. Later / parked: plugin distribution + attestation (F3 in `docs/reviews/plugin-security-review-2026-10-11.md`;
   the served plugin is minified so its hash differs from source — serve the readable file and publish its
   hash); promote dev → test when the owner asks; prod when the owner asks.

## Approved designs (build from these, in this order of authority)

- `docs/design/two-surface/` — **APPROVED 2026-10-12**: NOTES.md (with the owner's ruling at the top),
  prototype.html (published privately at https://claude.ai/artifact/QY1rU3LTCekLsXaduDoJBj), PLAN.md.
  Presentation (16:9, never scrolls, no controls) + Dashboard (laptop) + Remote (phone); default setup =
  laptop + projector (presenter view); the response navigator `[1–27] 28 29 | 30 | 31 32 [33–60]`.
  **Ruling: the navigator also works during VOTE — names always hidden, no scores, the phones' shuffled
  voting order and numbers (`answer-order.js`).** The 12 open questions are taken as their recommendations.
- `docs/design/simplify-round/` — principles R1–R10 (one `roundStep()`, one words file, one orange,
  arm-to-confirm, Session menu, auto-advance rules); superseded where two-surface differs.
- `docs/design/remote-parity/`, `docs/design/ca-followup-asks/` — folded into the two-surface phases.
- `docs/design/admin-landing/` — BUILT (console Overview, scope tabs).

## Owner rulings this stretch (keep)

- **Simplicity first** (memory `engage2-simplicity-first`): same task the same way everywhere, one next
  step, auto-advance when safe, no clutter; count taps per round.
- Self-voting allowed. Paid teams only approve hosting for their invitees; existing never-approved
  accounts become invite-only when they accept an invitation.
- Claude models: Engage-wide switch, Anthropic 5.5 default (Haiku 4.5→5.5, Sonnet 4.6→5.5), Bedrock
  fallback; Workload Identity Federation, no API key. Dev rule `fdrl_01Fgi2W7zco8f1k4HAPabtzn`
  (subject `role/engagedev-*`), test rule `fdrl_01SmE8ZCp94cd1kLFLwTgaRP` (`role/engagetest-*`);
  ids in `buildspec-dev.yml` / `buildspec-test.yml`. Prod stays Bedrock.
- Follow-up asks: measured on dev session 5479 — 5/5 rounds produced a sendable ask (Sonnet 5.5); build
  the UI (now Phase 5 of two-surface); add a bracketed lead-in for fragment agree statements.
- Share demo: nudge takes the orange; chip popover stays; Share demo only when a running app exists.
- Two codes in Build Room Settings: option C as ruled (built, on dev).

## Known gaps not yet fixed

- Survey reads still start only from the host page; the Remote shows "Workie is reading…" forever if
  the worker fails (no `aiSummaryError` listener); the Advisor prompt says "Player voted" (voter-name
  field) — needs an anonymity decision before naming voters.
- From the simplify audit: Request feedback fails silently when the report can't be built; → on the
  tally skips unread response pages; no response can be opened during voting on the host screen (now
  covered by the VOTE navigator ruling); `FeedbackRoundPanel` passes no `onSpotlight`.

## Tools

- Scripted players for dev sessions: `node <scratchpad>/player/player.mjs join|status|answer|answers|vote|wait|comment`
  (built last session at
  `/private/tmp/claude-501/-Users-georgeseib-Documents-projects-engage2/61b6e303-5b4b-4621-9b0c-f921f87a0f5e/scratchpad/player/player.mjs`;
  may be cleaned up — it reproduces PlayerPage: join over HTTP, answers over the websocket
  `ANSWER#nnn`, votes over HTTP with 0-based positions in the shuffled order). Persona subagents' `comment`
  calls were blocked by the auto-mode classifier; ask the owner before relying on it.
- Gate runner: run all `tests/*.js` in parallel with exit codes (macOS `xargs -I` hits a length limit;
  use `xargs -n 1 bash -c 'run "$0"'`); ignore only `tests/verify-question-set-ui.spec.js` (Playwright).
- Gate in a separate worktree when the main one has in-flight work: `git worktree add --detach <path> <commit>`
  and symlink `node_modules`, `lambda-functions/node_modules`, `lambda-functions/{websocket,auth,admin}/node_modules`,
  `src/node_modules`, `scripts/ci/node_modules` from this worktree.
