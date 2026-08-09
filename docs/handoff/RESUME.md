# Resume

After `/clear`, paste the block below.

---

Read `docs/handoff/RESUME.md` in full before doing anything else. It is the whole state.

## Where things stand

`dev` is at **`faa90214`**, tagged **`dev-v1.1.0`**, deployed. Three bodies of work shipped together:

- **Anonymous responses** — 11 tasks. Until voting closes nobody sees who wrote what, the host included. A redaction over the existing positional ballot; the gate binds only formats that hold a vote. Voting *closing* reveals the round, and the report attributes every one.
- **AI builders off the 30s API Gateway ceiling** — the four generators poll a job instead of fanning batches inside one request. Tags survive a CSV round trip.
- **The host stage redesign** — both previous layouts replaced by one fixed-height stage. Four literal type ladders on the root element, a reduction ladder that sacrifices chrome before content, no scrolling and no silent clipping.

Plans: `docs/superpowers/plans/2026-08-09-anonymous-responses.md`, `docs/superpowers/plans/2026-08-09-host-stage-shell.md`. Per-task ledgers, briefs and reports are in `.superpowers/sdd/<plan-basename>/` (git-ignored).

## Baselines — check before claiming a regression

| Suite | Command | Expected |
|---|---|---|
| Backend | `for t in tests/*.js; do node "$t"; done` | **27 suites, 919 passed, 0 failed** |
| Frontend | `cd src && npx jest __tests__/` | 5 failed suites / 30 failed / **378 passed** |
| Build | `cd src && npm run build` | compiles, 2 pre-existing size warnings |
| Template | `sam validate --lint -t template-clean.yaml` | valid |

Aggregate the backend with `grep -E '^[0-9]+ passed'`, **never** `tail -1`.

**And assert the suite count.** There are 30 files in `tests/`, of which 27 are node-runnable and print a result line. A crashed suite prints **no** result line, so a grep-based aggregate silently drops it and reports "0 failed". This bit twice in one day — once reporting 17 suites/560 passed when three had crashed. Guard:

```bash
for t in tests/*.js; do out=$(node "$t" 2>&1); echo "$out" | grep -qE '^[0-9]+ passed' || echo "NO RESULT LINE: $t"; done
```

The 5 failing frontend suites are stale and out of scope — they predate the auth system (`useAuth must be used within an AuthProvider`) and call `new WebSocketClient()` on a singleton export. Do not "fix" them. A sixth is yours.

## What is deployed where

| Tier | Commit | Notes |
|---|---|---|
| `dev` | `faa90214` | everything above |
| `test` | `94c2cccd` | `85ad6043` + the archive art-export fix only |
| `prod` | see below | |

**Check prod before assuming.** As of this writing prod was serving `2c588841` — anonymity Tasks 1–3 only, which strips author names from every game including trivia with **no way to restore them**, because the reveal endpoint did not exist yet. A rollback to `85ad6043` was staged at the manual approval gate. Verify what actually got approved:

```bash
for t in dev test prod; do r=$(AWS_PROFILE=adminaccess aws codepipeline list-pipeline-executions --pipeline-name engagecicd-pipeline-$t --max-items 20 --query "pipelineExecutionSummaries[?status=='Succeeded']|[0].sourceRevisions[0].revisionId" --output text); printf "%-5s %s %s\n" "$t" "${r:0:8}" "$(git log --oneline -1 ${r:0:8} 2>/dev/null)"; done
```

The pipeline execution history is the **only** reliable record of what is deployed. Tags are not: the filters are `branches:[dev]` **OR** `tags:[dev-v*]`, so a `dev-v*` tag on *any* branch deploys that commit, and the pipeline takes whatever arrived last regardless of version ordering.

**Pushing a branch and its tag together fires two executions of the same commit.** Push one or the other.

## Deployment rule — not negotiable

**The pipeline is the only route to dev, test or prod.** Never run `./deployall`, `./scripts/deploy-clean.sh` or any deploy script. The only mechanism is a branch push or a `<tier>-v*` tag. Consequence: you cannot get one fix into an environment without shipping everything else on that branch — when `dev` is held, branch from the last released commit and take the fix to a different tier instead.

`CLAUDE.md` reserves deploys to the owner. Ask before pushing any tier; past authorisation was per-action, not standing.

### Proposed: go tag-only. Owner agreed in principle 2026-08-09; not yet implemented.

**The change.** In `cicd/pipeline-clean.yaml`, each of the three pipelines has a `Triggers` block with two `Push` entries — a `Branches` filter and a `Tags` filter (dev at `:304-321`, test at `:364-374`, prod at `:418`). **Delete the `- Branches:` entry from all three, keep `- Tags:`.** The file's own comments record why they are separate entries: `Tags` and `Branches` cannot be combined inside one filter, so they are OR'd — which is exactly why a `dev-v*` tag on *any* branch deploys today.

Note the comment at `:369-370`: when `Triggers` is present the default branch trigger is disabled and has to be restated. So removing the restatement is precisely what yields tag-only, with no other side effect.

**Why.** A push is currently a deploy, and that cost real time on 2026-08-09 in two ways: `dev` was unpushable for hours because it carried a defect, so ~68 commits of finished work existed only on one laptop with no remote copy; and a verified one-line archive fix could not reach the dev environment at all without dragging unfinished work with it. Tag-only decouples "save and share" from "make it live". It is also the structural fix for the incident that started that day — `prod` received a half-finished feature because someone pushed mid-feature.

Apply it to **`dev` as well as test and prod.** Dev is precisely where you most want to push freely without shipping.

**Two weaknesses you are accepting, both real and neither fixable:**

1. **Tags do not sort — last write wins.** Tagging `1.0.4` after `1.0.5` deploys `1.0.4`. Never read the tag list as the record of what is deployed; the pipeline execution history is the only truth (command above).
2. **A tag on any branch deploys.** There is no branch guard available for a tag filter. This is useful — it is how you would get a hotfix into `dev` while `dev` is held — and dangerous, with no technical mitigation, only convention.

Rollback is unaffected and stays easy: the old tag still points at its commit, so re-run the pipeline at that revision. No recommit, no tag surgery.

**Open question before doing it:** how does the `engagecicd` stack itself get deployed? It is defined in this repo but the pipelines deploy the *application* stacks, so changing the pipeline may not be a change the pipeline can make. Establish that first — the pipeline-only rule has to survive its own bootstrap.

## Open with the owner

1. **Does §7.15 yield for trivia?** `docs/design/host-redesign/07-results-trivia.html` answers trivia's round standings with a named roster in the meter; `RoomMeter` refuses names **by test**, under the spec's never-name-a-person rule. Two artefacts disagree and one is the rule. **Trivia currently has no per-round payoff on the room's screen at all.** Recorded in the stage-shell plan under "Open decisions this plan surfaced and could not settle".
2. **Does an approval email exist** when someone is promoted out of `pending`? The entry design assumes something happens; nothing in the code says it does. See `docs/design/entry-redesign/OPEN-QUESTIONS.md`.
3. **Two `engagetest` migrations are unrun** — `cull-ai-prompts` and `migrate-set-versions`. Order matters and the obvious order destroys data: `cull` hard-deletes prompt rows with no `promptId`, which is exactly what `rekey` (already run) existed to move. `cull` is safe now; both take `AWS_PROFILE=adminaccess node scripts/<name>.js engagetest [--apply]` and are dry-run by default.

## Background tasks running in other sessions

- **Secure the public archive API.** Confirmed by probe: unauthenticated `GET https://archive.seibtribe.us/archive/items` returns **200**, and CORS advertises `DELETE` with `Origin: *`. `ArchivePanel.jsx:271` deletes with a plain `fetch`, no auth header. The archive is **not** in this repo's template — it is its own stack (`engage2-archive-service` is a candidate). A fix there may need a deploy outside the pipeline, which needs a deliberate owner decision.
- **Fix the blank player screen after reloading post-vote.** `PlayerPage.jsx:705-723` returns early when `checkPlayerVote` is true, so `answers` stays `[]`; the whole VOTE branch is guarded on `answers.length > 0` (`:1855`) and the "Votes Submitted" panel is *inside* that guard. Result: a blank page until the host advances.
- **Delete the unreachable expanded-lesson modal — STOPPED, and must stay stopped.** Its premise expired. The modal is no longer dead: Task 5 wired `setLessonExpanded(true)` as the recovery for a dropped ASK prompt. The full question is `data-drop`, so the fitter sacrifices it on a dense state, and click-to-expand is the only way back. Deleting it is now a regression. Uncommitted deletions from that session were discarded once already.

## Design work delivered today, not yet built

Three sets, none implemented. Serve them with `python3 -m http.server 8124 --directory docs/design` (there is a `.claude/launch.json` entry, `all-design-mockups`).

- `docs/design/host-redesign/` — the game screen. 21 mockups, `audit.js` at 168 checks / 0 failures. **This is the precedent the other three follow.** `view.html` steps through with arrows; 1–4 switch display profile. Note the audit harness **stalls in the in-app browser** — it hangs with `01-lobby.html` loaded. Not a defect in the mockups.
- `docs/design/entry-redesign/` — root, join and the seven auth flows. 17 mockups, 612 assertions.
- `docs/design/admin-redesign/` — the six admin tabs. 22 mockups, 264 assertions. Press **N** to hide the design notes.
- `docs/design/player-redesign/` — the player's own device, which had **never** been designed. 23 mockups, 690 assertions.

Each carries a `RATIONALE.md` and an `OPEN-QUESTIONS.md`. The design agents were asked to argue back, and did — several of their disagreements were correct and are worth reading before building from them.

## Landmines

**Tests that look like coverage and assert nothing.** Five separate instances in one day. This is the dominant failure mode in this codebase — not tests that fail, tests that quietly stop asserting.

- A crashed suite vanishing from a grep-based count (twice).
- A search test whose fixture short-circuited before the loop it existed to exercise.
- Four of five hook lifecycle tests that would pass against a hook doing nothing.
- A `toMatch` against a 5,200-line file, matching anywhere.
- A source-grep guarding a **Critical** fix that passed against a hook that never published the value.

**For every test, name the implementation it would reject. If the answer is "none", say so rather than padding the count.**

**jsdom has no layout engine.** Every geometric assertion returns zero and passes unconditionally. `audit.js` guards the *mockups*; **nothing automated verifies the React app's geometry.** Verification is a human in a browser. A browser pass found five defects unit tests structurally could not — including `[hidden]` losing to `display:flex`, which made *every* fitter reduction silently inert.

**When you verify in a browser, vary the configuration, not just the state.** A walkthrough of every phase missed a Critical because no measurement was taken with a side panel open — and the panel is opened by the dock's own button.

**`check()` is async in `tests/anonymous-round-flow.js` and `tests/anonymity-contract.js`.** Every call must be `await`ed; a bare call exits before asserting and vanishes from the count with no failure signal.

**`seedAnonymousRound` seeds no `CONNECTION#` rows.** A broadcast assertion needs its own `put()` or it passes vacuously.

**The mockups are the source of truth for values, not the plan's prose.** Two separate reviews found the plan's inline reproduction of a mockup differed from the mockup. Port from the file.

**`hostControlsFor` rewrites an unrecognised phase to `LOBBY`.** Adding a phase without adding it to `HOST_PHASES` produces something that looks like it works and renders the lobby.

**Pre-existing, unfixed:** `handlePlayerVote` builds `ROUND#` keys unpadded (`message.js:493,513,524`); `message.js` routing makes `handlePlayerMessage`'s `playerVoted` branch unreachable; the positional ballot is stable only because the answer sort key ends in the author's name (risk R1); no `reopen-round` endpoint (R2).

## If you want the next piece of UX

The host redesign's plans 3–5 are unwritten: the Console (operator chrome, question browser, how-to-play), per-state content and the deletions, and ENDED. Spec §8 carries the implementation order; §7 carries 18 testable negatives. Start with `superpowers:writing-plans` against `docs/superpowers/specs/2026-08-08-host-screen-redesign-design.md`.

Two things the stage shell handed forward deliberately: **RESULTS has no sacrifice budget** (solo from first paint, no drop groups, so a dense results state clamps and abbreviates an answer), and **the drop-polarity test is file-wide**, so it will misfire when plan 4 adds per-state content — the mockups number per *box*, starting at 1.
