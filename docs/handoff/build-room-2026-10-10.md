# Build Room handoff — 2026-10-10

Read this first in a new session. Worktree: `.claude/worktrees/affectionate-bouman-48e07a`, branch `working/build-room-host-redesign` (a push of it to `dev` deploys dev).

## Where each tier is

| Tier | Commit | What it carries |
|---|---|---|
| **prod** | `324fd05d` **waiting at ApprovalForProd** (owner) | Everything below through the doing line. Prod itself is still on the late-September release: the earlier run `a011c0fc` was approved but failed `npm test` on the expiring Events fixture (fixed since). |
| **test** | `324fd05d` (checked on room 4465) | History window, Stage decide, UX batches 2-3, talking points (plugin flow), Session panel, three-line player rows, option detail to Claude, the doing line (plugin 1.14.0). |
| **dev** | `86e2298f` (walked) | test + copy pass (Orwell) + plugin update notice (plugin 1.15.0). |
| **branch head** | `ade44c8c` (not pushed) | dev + Host · N alert (+ "The room chose: …" on the Stage). Full gates were running when this was written — rerun them before pushing. |

Promotion rules: test is MERGED into (never fast-forward); prod is a fast-forward of test (`git push origin origin/test:refs/heads/prod`) and halts at the owner's gate. Watch pipelines with `AWS_PROFILE=adminaccess` (the owner must `aws sso login --profile adminaccess` when it expires — the CLI then returns nothing/errors).

## Next, in order

1. **Push `ade44c8c` to dev** after gates; walk the Host · N alert on room 4443: amber when a question or ready mockups wait, grey otherwise; the list folds by kind and each line jumps (ideas → Waiting for you on Room; asks → that card); Mark all seen; seen shared across devices; nothing named on Stage/Build; **measure the list at ~660 and 375 px**; check "The room chose: …" on the Stage after a vote from Points.
2. **Promote dev → test** (copy pass, update notice, alert), check test, then prod at the owner's gate.
3. **Plugin per tier** — proposed, **awaiting the owner's yes**: prod stays `engage`; dev serves `engage-dev`, test `engage-test` (same file, name from the tier); the installer installs the tier it was run from beside prod; `/engage-<tier>:connect` writes `enabledPlugins` in the project's `.claude/settings.local.json` (own tier on, others off); each plugin's hooks/tools act only for a project connected to its own tier; the Connect window shows the tier's own commands. Claude Code docs (plugins/install, plugins/loading): one plugin id can't hold two versions; scopes control enablement only; differently named plugins coexist. Verify by test: both plugins' hooks fire; per-folder enable takes effect without restart.
4. **Reviewer feedback** (owner mentioned, not yet pasted): a persistent notice for a pending team invite (so it isn't lost while someone creates their first Build Room), and clear setup/requirements for Claude Code before starting (Claude Code, Node 18+, the plugin, where to run the command). Ask the owner to paste it, then mockups → plan.
5. **Expiring test dates** — a separate session (task_8e0ea9d6, started by the owner) is fixing nine test files with hard-coded 2026 dates; check its result before the next promotion.

## What was built this stretch (all on dev or later)

- **Talking points** (Research, Ideas, Claude's own points; Points tab; Show on Stage + take-down vote offer; multi-pick vote + highlight; run list with runId; report section). Spec `docs/superpowers/specs/2026-10-09-build-room-talking-points-design.md`; interfaces `docs/superpowers/plans/2026-10-09-talking-points-task1-interfaces.md`. Repo record `build-room/<code>-<date>/<name>/`.
- **Session panel** (shared `PlayersList`; Unlock / Let them take it / Not now / Lock again / Remove / Bring back incl. builders; request strip; organised Settings; every host device notified). Plan `docs/superpowers/plans/2026-10-09-build-room-session-panel.md`. Player rows are three lines, one state at a time.
- **What Claude is doing** (one line from Claude's task list or Claude itself; helper line; steps in History; refused lines answered in words). Plan `docs/superpowers/plans/2026-10-10-build-room-doing-line.md` (+ Findings, + "Next" rulings). Plugin hooks: PostToolUse (TaskCreate/TaskUpdate and TodoWrite), PreToolUse Agent|Task, SubagentStop.
- **Copy pass** (`docs/design/build-room-copy-pass/index.html`): Stage ≤12 words a line; one "Ask the room" move; tooltips Host-only (focusable info buttons where needed); Stage Space hint on hover/focus only.
- **Plugin update notice** (1.15.0): `X-Engage-Plugin` header from the plugin only; host sees "Claude's plugin is out of date. Update" + dot on SESSION; Claude told via `pluginNote`.
- **Host · N alert** (`docs/design/build-room-host-alert/index.html`): seen on its own `BUILD#SEEN` row, conditional writes; amber token `--brm-alert-amber` (never `--primary`).

## Owner rulings to keep (2026-10-08 → 10)

- One orange per screen; primary right-most; words from `src/src/buildroom/words.js`; RETIRED words enforced by `tests/build-room-copy.js`.
- Orwell's rules: fewest words, especially Stage and Build Room; tooltips only when truly needed, Host screen only.
- Laptops, tablets and phones — never phones only.
- Every DynamoDB row carries the session ttl; lasting artifacts live in the repo and the report.
- Mockups before UI code; measure dialogs at ~660/375 px on dev.
- Talking points: Space never sends from ticks; 2+ ticked → Put N to a vote is orange.
- Doing line: History keeps the task item's own words ("Done: …"); helper line shows to the room; commands folded and remembered.
- Host alert: amber whenever something waits on the host; "Claude finished" not counted; "See them →".
- Parked for the push-and-teamwork spec (`docs/design/build-room-lan-share/LATER.md`): push every commit to `build-room/<code>`; Try it in a separate worktree; crew asks via host approval; crew parity.

## Gotchas met this stretch

- A jest click racing a busy page fails only in CI — wait for not-disabled first.
- Hard-coded dates in fixtures expire and fail the pipeline (`adminOneSection` broke 2026-10-10).
- Worktree agents: symlink `src/node_modules`, `scripts/ci/node_modules` (esbuild) and set `NODE_PATH` to the main worktree's; never `npm install`.
- The browser can't send `X-Engage-Plugin` (CORS) — only the Node plugin does.
- Owner's Claude Code (2.1.294) uses TaskCreate/TaskUpdate, not TodoWrite.
