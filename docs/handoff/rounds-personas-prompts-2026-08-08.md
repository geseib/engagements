# Rounds, Personas & Prompt Cleanup — 2026-08-08

Design + forensics: `docs/superpowers/specs/2026-08-08-rounds-personas-cleanup-design.md`
(including the executed-cleanup addendum). Eight commits, `f022fe55..97fbd34b` on `dev`.

## What the owner asked for, and what it turned out to be

| Reported | Actual cause |
|---|---|
| "no ability in game to change Workie's prompt type" | The persona picker was specced in `2026-08-07` and never built. No write path **and no read path** — `get-ai-prompts.js` filters `SK begins_with 'AIPROMPT#'`, so `PERSONA#` records were invisible to admin. The handoff's claim that personas were "editable in the admin UI" was false. |
| "no Art custom instruction; adding one didn't change anything" | `edit-question-set.js` guarded `if (x !== null)`, and the form mapped every empty field to `null`. **`null` meant skip.** Clearing anything was a silent no-op, and "Use default prompt" (the empty option) could never detach a prompt. |
| "not every call-and-answer should be Lesson 1, Lesson 2" | Inline ternaries in two files; poll and survey fell through to "Lesson" too, and the host said "Lesson N" on ASK but "Question N" on RESULTS. |
| "a lot that needs cleaning out" | 7 duplicate call-and-answer defaults, 6 trivia, 4 poll — caused by `populate-defaults.js` scanning the **legacy** key while writing the canonical one, so "skip existing" never fired and every run minted another. |

## Naming decision

Default round noun is **`Round`**, not `Lesson`. "Lesson" asserted the content was
didactic, which is false for icebreakers, retros and opinion sets — the same wrong
assumption that made Workie refuse to analyse a holiday-destination round. Art
resolves to **`Artwork`** by image presence, because art is not a game type: it is a
call-and-answer set whose questions carry an `Image`. A per-set `roundNoun` override
lets a genuine lessons set still say "Lesson 3".

| Type | Noun |  | Type | Noun |
|---|---|---|---|---|
| call-and-answer | Round |  | trivia | Question |
| …with image | **Artwork** |  | poll | Poll |
| survey | Question |  | wavelength | Subject |

Art instruction is now *"Name this work of art. Will you be accurate, witty, or make
the room really think?"*

## Deployment

Tag triggers added alongside the existing branch triggers. Pipelines migrated V1 → V2
(required — V1 source actions filter on `BranchName` only).

```bash
git tag dev-v1.3.0 && git push origin dev-v1.3.0     # deploys engagedev
git tag --sort=-creatordate | grep '^prod-'          # what is live in prod
```

Declaring a `Triggers` block **disables default change detection**, so each trigger
declares two `Push` entries — `Branches` and `Tags` inside one `GitPushFilter` are
ANDed, separate entries are ORed. Getting that wrong would have silently killed branch
deploys.

⚠️ **The `engagecicd` stack has NOT been redeployed yet.** The template change is
committed but not applied, so tag triggers are not live. Run `./scripts/deploy-cicd.sh`
(now fixed — it used to pass a `GitHubToken` parameter the template dropped, so every
redeploy failed).

V2 billing is **cheaper here**: ~$2/mo on V1 (3 pipelines, one free) versus ~$0.28/mo
at 20 deploys. Break-even is ~90 deploys/month. Manual approval wait is not billed.

## Live data — engagedev only

Backup: `backups/engagedev-prompts-2026-08-08/` (50 items) taken first.

- 14 duplicate `isDefault` flags cleared → exactly one default per game type
- 11 rows canonicalised to the dashed vocabulary
- 22 generation prompts re-keyed to `AIPROMPT#gen-<gameType>-<scenarioType>` with a
  real `promptId`

**The approved hard-delete was deliberately NOT performed.** Those 22 rows were
described (by me) as "unusable by construction"; they are unusable as *summary*
prompts only, and are in fact the question-generation library `AIScenarioBuilder`
reads. Deleting them would have emptied the AI scenario generator. Re-keyed instead.

**TTL was overstated.** No engagedev prompt row ever carried a `ttl` stamp — the routed
seeder never wrote one and every live prompt came from it. The code defect was real for
anything created through the admin UI, and the fact that nothing carries a stamp is
itself the finding: **no prompt has ever been successfully created through the admin
UI.** With the delete path also broken, the prompt manager was write-only.

## Still to do

1. **Redeploy `engagecicd`** — tag triggers are committed but not live.
2. **Seed the new defaults** — `POST /admin/populate-defaults` `{"overwrite": true}`,
   which adds the art-titles prompt. `SET#famousarttitles` still points at "Custom
   Scenario - Adaptive Analysis". Run **after** the dedup, since the seeder now writes
   one `isDefault` per type.
3. **Run the cleanup on test and prod** — everything above was engagedev only.
4. **Eyeball the icon-dense screens** — still outstanding from the previous session.
5. **The five stale pre-auth Jest suites** — 30 failures, unchanged since before this
   work (verified against a `6cba1525` worktree: 30 failed / 52 passed before,
   30 failed / **65** passed after).

## Landmines found, not fixed

- `gameStats.totalQuestions` is `results.length`, so an AI-summary-only round appears in
  `detailedQuestions` but not in the stats count or `participationRate`'s denominator.
  Left alone deliberately — changing it moves every existing percentage.
- `HostRemote.jsx` passes `gameState.currentQuestionData`, which `get-game.js` never
  returns, so art rounds there fall back to the game-type noun. Needs an API change.
  `playerCount` renders `0` for the same reason.
- Host-side `fetchQuestionSetInstruction` still refetches the whole `/question-sets`
  list per question. The player side is now cached; the host is not.
- `get-question.js`'s `RESULTS#` branch is unreachable — the handler 400s unless state
  starts with `ASK#`.
