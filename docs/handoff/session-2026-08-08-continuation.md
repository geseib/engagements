# Session Handoff — 2026-08-08

Read this with `docs/handoff/rounds-personas-prompts-2026-08-08.md` (earlier in the
same session) and the two specs below. Everything here is on `dev` and deployed to
**engagedev**; **engagetest has code but NOT data** (see Outstanding #3).

Specs written this session:
- `docs/superpowers/specs/2026-08-08-rounds-personas-cleanup-design.md`
- `docs/superpowers/specs/2026-08-08-question-set-versioning-design.md`

---

## Test baselines — check these before claiming a regression

| Suite | Command | Expected |
|---|---|---|
| Backend | `for t in tests/*.js; do node "$t"; done` | **617 passing, 0 failing, 17 suites** |
| Frontend | `cd src && npx jest __tests__/` | **5 failed suites / 30 failed / 242 passed** |
| Build | `cd src && npm run build` | compiles, 2 pre-existing size warnings |
| Template | `sam validate --lint -t template-clean.yaml` | valid |

**The 5 failing frontend suites are stale and out of scope** — they predate the auth
system (`useAuth must be used within an AuthProvider` ×78) and call
`new WebSocketClient()` on a singleton export (×10). They fail identically at
`6cba1525`, verified with a worktree. Do not "fix" them as part of other work.

**Aggregating backend counts:** use `grep -E '^[0-9]+ passed'`, not `tail -1` — some
suites print a trailing line and `tail -1` silently drops them (this cost a false
"554 vs 584" scare mid-session).

---

## Shipped and deployed to engagedev

`f022fe55` … `5363a6db`, all pushed. Highlights, with the non-obvious bits:

- **Round labels** — "Round"/"Artwork" replace "Lesson"; art is detected by image
  presence, not a game type. Fixed a player badge that rendered blank and per-set
  instructions that never reached players at all.
- **Question-set edit** — `null` used to mean "skip" in the lambda, so clearing any
  field was a silent no-op. Now a diff: omitted = untouched, `''` = clear.
- **Prompt system** — TTL removed (prompts were configured to self-delete), one
  game-type vocabulary, delete path fixed, picker filtered to the set's type.
- **Workie output shape** — prompts can declare `outputSections`; the art prompt is
  the reference example. `AnswerDetails` (the artwork reveal) had **never** reached
  the table from any CSV import.
- **Versioned question sets** — `SET#<id>#v<n>`, games pin a version, replace is a
  version bump. **11 runtime readers**, not the 6 first identified.
- **Host UX** — the advance button was below the fold in 12 of 12 game states, and
  the Game Info panel was covering the content column.
- **Phone remote** — standalone; also fixed `get-results.js`, which had four exits,
  only two of which wrote state and **none** of which broadcast.
- **CI/CD** — tag triggers (`dev-v*`/`test-v*`/`prod-v*`) on Pipeline V2.

---

## Outstanding

1. **Admin/Home nav buttons** (started, nothing written). The owner asked for an
   Admin button visible only to administrators, and a Home button on admin screens.
   **Investigation finding, important:** `lambda-functions/auth/authorizer.js:96-116`
   ALREADY enforces groups server-side — `admin/*` requires the `admins` group, with
   a deliberate carve-out for `admin/clear-game` (hosts reset their own games).
   `AuthContext.isAdmin()` and `<ProtectedRoute requireAdmin>` also already exist.
   So **hiding the button is pure UX, not a security fix** — a host calling
   `/admin/*` directly is already denied. Build it as navigation, and don't let
   anyone frame the hidden button as the access control.

2. **`engagecicd` stack not redeployed** — tag triggers are committed but NOT live.
   `./scripts/deploy-cicd.sh` (now fixed; it used to pass a `GitHubToken` parameter
   the template no longer declares). Applying the current template also **deletes**
   the stack's broken connection — a resource deletion, so run it deliberately.

3. **engagetest has code but not data.** The prompt cleanup (isDefault dedup,
   game-type canonicalisation, generation-prompt re-key, art prompt seeding) ran
   against **engagedev only**. Workie on engagetest behaves like engagedev did this
   morning. Scripts: `scripts/cull-ai-prompts.js`, `scripts/rekey-generation-prompts.js`,
   `scripts/migrate-set-versions.js` — all dry-run by default, all idempotent.

4. **Art set needs re-importing** to pick up `AnswerDetails`. Use
   `sets/cleaned/famous-art-titles.csv` (self-hosted images + reveals + per-question
   instructions), NOT `sets/famous-art-titles.csv` (still hotlinks Wikimedia). With
   versioning live this is now a version bump that keeps the set's id, prompt,
   persona and instructions.

5. **Media/wave 2 not started** — `<env>-media` bucket, presigned uploads, and the
   in-use / missing / orphaned panel. Design is written; see the versioning spec's
   media section. Key decisions already made: images are keyed **per set, not per
   version**; a bare filename in the CSV is a *commitment to upload*, a URL is a
   *disclaimer*; the importer stores the key (`sets/<setId>/<file>`), not a URL.

6. **Two background tasks** the owner started, running independently: the
   unreachable RESULTS branch in `get-question.js`, and porting the other four AI
   builders off the 30s gateway.

---

## Known landmines

- **`.outer-container` had `width:100%` AND `margin-right:320px`** — over-constrained,
  so the gutter was silently discarded. Fixed, but the pattern may recur elsewhere.
- **`next-question.js` has no `ConditionExpression`.** Sequential double-advance is
  idempotent; **concurrent** double-advance silently consumes a question without
  showing it. `action: 'skip'` bypasses the state guard entirely. Mitigated in the
  remote with a cooldown; the real fix is a conditional write on `LessonNumber`.
- **`websocket/connect.js` evicts EVERY existing HOST connection** when a new one
  arrives with `isHost=true` — a second host client starts a reconnect war. This is
  why the remote polls instead of opening a socket.
- **`gameTypes.js` `phases` disagreed with the running code for 2 of 5 types** and
  nothing caught it because `hasVotePhase()` had no runtime reader. Corrected to
  describe reality. **Open product question: should a survey have a vote phase?**
  It does today only because it isn't in the skip list.
- **Two CodeStar connections share the name `engage-github-connection`** — one
  AVAILABLE, one in ERROR. The pipelines are pinned to the good one **by API**,
  which is drift; the template fix is committed but not applied (Outstanding #2).
- **`ArchiveManager.jsx` / `ArchiveSearch.jsx`** are single-line escaped garbage,
  not valid JS. Nothing imports them. Exclude from sweeps.
- **`Category` in the archive means two things** — the exporter writes the game
  type, the upload modal writes a topic. Filtering works around it; the exporter
  should write an explicit `GameType`.

---

## Process notes that saved time

- **Watch a specific pipeline execution id, never a stage's latest state.** Two false
  readings this session came from polling `stageStates[...]` and catching the
  *previous* run's status. `list-pipeline-executions --max-items 1` → compare the
  execution **id** against a baseline captured before the push.
- **Working directory persists between Bash calls.** A `cd src` in one call silently
  broke three later commands that assumed the repo root.
- **A subagent flagging a cross-agent conflict is usually right to escalate and
  wrong about the cause.** One correctly refused to touch another agent's file over a
  failing test; the contract had survived the refactor and only the source-check's
  pinned filename was stale.
