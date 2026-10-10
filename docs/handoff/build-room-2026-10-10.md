# Build Room handoff — 2026-10-10

Read this first in a new session. Worktree: `.claude/worktrees/affectionate-bouman-48e07a`, branch `working/build-room-host-redesign` (a push of it to `dev` deploys dev).

## Where each tier is (end of 2026-10-10)

| Tier | Commit | What it carries |
|---|---|---|
| **prod** | `324fd05d` **waiting at ApprovalForProd** (owner) | Prod itself still runs the late-September release. **Its Cognito web client has no WriteAttributes** (verified live): a signed-in user can rewrite their own `custom:status` / `custom:role`. Fixed on dev and test (`7b2543ee`); prod needs a run. |
| **test** | `f59cbeb5` (= dev `173ffc34`) | Everything below. Pool client WriteAttributes `email, name` verified live. |
| **dev** | `173ffc34` | `324fd05d` + copy pass, plugin update notice, Host · N alert, phone viewer portal, popovers follow their anchor, dates to 2099, **one plugin per tier (1.16.0)**, Revy review fixes (counts, status, report, wrap-up, one pick), Before you start, README/help without emoji, invite notice (pending accounts, verified email), Cognito WriteAttributes, **Share demo**. |
| **branch head** | = dev | Nothing unpushed except this note. |

Promotion rules: test is MERGED into (never fast-forward); prod is a fast-forward of test (`git push origin origin/test:refs/heads/prod`) and halts at the owner's gate. Watch pipelines with `AWS_PROFILE=adminaccess`. Promote from a scratch `git worktree add <tmp> origin/test` so the working branch is never disturbed.

## Next, in order

1. **Prod** — recommend soon (the WriteAttributes hole). Owner said "prod will wait"; ask, then fast-forward test → prod; it halts at the gate.
2. **Owner calls on Share demo**: (a) should the Host-screen nudge take the one orange from What's next (built: plain)? (b) the header chip now opens its own popover (reverses 2026-10-09 "controls only in Settings") — OK? (c) screenshots-only rooms can share with no address (Claude is never asked for its local link) — leave or prompt Claude?
3. **Invite**: accounts in NO group (App.jsx "Access Pending") still cannot see invites — owner ruling needed to open the routes to them.
4. **Not yet seen in a browser**: the Connect window's plugin-version line (owner not signed in on dev in the pane), the Share demo Stage frame and the phones' shared state (need a live plugin LAN share). Walked on test room 5815: the Host nudge (12–647 at 659), the chip popover (16–436 at 659), the Build screen's "Only this laptop can open it.", narrow (≤480) moves the tools into Session.
5. **Remote demo (tunnel) — parked, not requested to build.** Share demo is Wi-Fi only, so people on Zoom or another network get the fallback line and screenshots. The owner raised a tunnel on 2026-10-07 (keeps local backends working) and called it a security issue first; the options and the hardening ideas (the Wi-Fi gateway's key in front, short-lived, ends at wrap-up, or Cloudflare Access) are in `docs/design/build-room-lan-share/LATER.md`. If the owner wants it: mockups and a threat model before any code.
6. **Flaky**: tests/engagement-session-list.js once 8 vs 9 (task chip task_525c10e7); hostRemotePreview once under load.

## Owner rulings 2026-10-10 (late)

- Plugin per tier approved and shipped. Install command only when signed in (Connect window), never on the public page.
- Share demo: nudge in both places (Host Now column AND the header chip on Build/History; a grey line in the Stage HOST list); "demo" when shared, "build" for the laptop link; no participant "Ask to try it"; no plugin change for it.
- Points vote opens on one pick.
- Invite: option A bar (Host screen only), Accept only, pending accounts may see/accept, accepting never approves hosting.
- README/help: no emoji in the UI; Icon where it carries meaning.

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
