# Handoff — 2026-08-11

Read this first, then `RESUME.md` for the standing landmines and the deploy runbook.
Everything in `RESUME.md`'s **Landmines** section still applies and is not repeated here.

`dev` is at **`91bf76c9`**, pushed to origin, and the dev pipeline execution for it was
**InProgress** when this was written. **Confirm it succeeded before trusting anything below to
be live:**

```bash
AWS_PROFILE=adminaccess aws codepipeline list-pipeline-executions --pipeline-name engagecicd-pipeline-dev --max-items 3 --query "pipelineExecutionSummaries[].{status:status,rev:sourceRevisions[0].revisionId}" --output table
```

The branch trigger is **still live** (`b6929cac` is committed and NOT applied), so the push
itself was the deploy. Push the branch **or** a tag, never both.

---

## Baselines, as of this commit

| Suite | Command | Expected |
|---|---|---|
| Backend | see below | **37 suites reporting, 1201 passed, 0 failed** |
| Frontend | `cd src && npx jest __tests__/` | 5 failed suites / 31 failed / **1012 passed** |
| Build | `cd src && npm run build` | compiles, 2 pre-existing size warnings |
| Template | `sam validate --lint -t template-clean.yaml` | valid |

The five failing frontend suites are unchanged and pre-existing: `AdminPage`, `App`,
`GameHostPage`, `PlayerPage`, `WebSocketClient`.

**The backend aggregation recipe in the old RESUME.md was wrong and cost two agents time.**
`grep -E '^[0-9]+ failed'` matches **nothing** — the summary line reads `N passed, M failed`, so
the failure count is never line-initial. That grep returns a vacuous zero through any number of
real failures. Use this instead, which also asserts the suite count:

```bash
pass=0; suites=0
for t in tests/*.js; do
  out=$(node "$t" 2>&1 | grep -E "^[0-9]+ passed")
  if [ -n "$out" ]; then suites=$((suites+1)); pass=$((pass+$(echo "$out" | sed 's/ passed.*//'))); fi
done
echo "suites: $suites  passed: $pass"
for t in tests/*.js; do node "$t" 2>&1 | grep -E "^[0-9]+ passed, [1-9]" && echo "  ^^ $t"; done
```

A crashed suite prints no result line and vanishes silently from any aggregate, which is why the
suite count is asserted separately.

---

## What landed (13 commits, `bbadaa59..91bf76c9`)

### Security — four holes, all closed

- **`b0fca92c` / `4d02904e` — `GET /games` published every session's join code.** One unbounded
  query of the whole `GAMES` partition, no authorizer, returning `gameId` (which IS the join
  code) plus title, hostName, `started` and `visibility`. Both halves were required: the
  authorizer on the route **and** an exact-match `path === 'games'` branch in
  `requiredGroupsForRoute`, because the generic `GET + includes('games')` rule returns no
  required groups and would have admitted any pool account including `pending`. The match must
  stay `===`; `startsWith` 401s every participant's session brief. 16 of the 38 assertions exist
  for that one regression.
- **`9df1d5ec` — `?role=host` handed out private sessions' access codes.** Worse than the list,
  and closing the list did not fix it. `role` is a query parameter on a route that must stay
  public. Deleted rather than gated — a full sweep found no caller that ever read the field.
- **`d3aac074`** also closed a player-creation race with `attribute_not_exists(SK)`.

**Still open — `POST /games` is public.** The authorizer half is already correct
(`requiredGroupsForRoute` returns `['hosts','admins']` for POST + games). What remains is two
steps **in separate deploys**, because `buildspec-dev.yml:49-58` ships the API before the
frontend and cached bundles outlive the build:

1. `src/src/GameHostPage.jsx:2783` — `fetch` → `authFetch`. Note
   `tests/games-list-authorization.js:299-301` asserts the bare `fetch(\`${API_BASE}games\`, {`
   still exists as a negative guard; that assertion and its comment must change in the same edit.
   (`QuickstartMenu` is already done.)
2. Then, and only then, add `Auth: Authorizer: CognitoAuthorizer` to `template-clean.yaml` after
   line 221.

### The reported bugs — all diagnosed to root cause

- **`a54c4e81` / `2ed32717` — "answering then switching tabs loses the answer" and "the selection
  resets before submit" were ONE bug, and it had never worked.** `checkPlayerAnswer` read
  `answerData.hasAnswer` from `/answers` — a field that endpoint has never emitted, on an
  endpoint that ignored `player` and `question` entirely. `undefined || false` returned false for
  every player on every call, forever, and the call site then cleared the pending selection
  because `!hasAnswered` was always true. Two agents found this independently from opposite ends.
  The client now reads `/state`'s `answerProgress.answererIds` (the exact counterpart of the
  `votersIds` list that made votes survive a refocus while answers did not), and
  `checkPlayerAnswer` returns `null` rather than `false` when it cannot find out.
- **`fb39b9c8` — "the AI results did not show up" was a transient disconnect, confirmed in
  CloudWatch.** Game 9612 round 001 generated in 4.3s; round 002 reached RESULTS with **zero**
  lambda invocations. Nothing arrived. But the failure path was worse than a hang: the `.catch`
  stopped the spinner and fell through to *"Nothing to read back yet"* — byte-identical to the
  pre-answer empty state, on a projector.
- **`78df15ca` — `participationRate` / `votingParticipation` were interpolated into the LIVE
  prompt** and could not read anything but 100% (`totalParticipants = answers.length`). Hosts read
  those summaries aloud. Also fixed: a `ReferenceError: commonWords is not defined` that killed
  every wavelength round reaching it, and `totalPlayers` counting `PLAYER#`/`#SCORE`/`#STATE`
  rows together (tripling every room).
- **`6627b003` — every AI-generated poll set imported with zero options.** Emitters wrote
  `Option1..Option5`; the importer reads one pipe-separated `Options` column with no fallback.

### Features

- **`8dc99b08` — poll AND wavelength AI summaries were dead.** The handoff recorded poll;
  wavelength's default pointer had no S3 body either. Both authored and installed; all four game
  types now resolve to a prompt with a body present.
- **`e0454415` — the remote's unbuilt half.** See the commit for the three things deliberately
  NOT built and why (`Timer 2:00` is a feature, not a control — there is no timer anywhere in this
  product).
- **`ec27476c` — the VJ persona rewritten.** A/B'd on Haiku against a real question, voice the
  only variable.

---

## Scoring — answered, NOT a bug, patch written but NOT applied

**The rule:** 10 points for a correct answer, plus up to 5 bonus points for answering within 30
seconds, shrinking linearly to zero. Wrong answers score 0. `message.js:414-428`. Difficulty is
stored on all 100 questions of the 80s set but **never scored** — every question is `points: 10`.

The owner's 23-vs-20, decomposed from real rows in game 9612:

| Round | Simon | Garfunkel |
|---|---|---|
| 001 | wrong → 0 | correct, 48.6s → 10 |
| 002 | correct, **14.9s** → 10 + **3** | correct, **31.4s** → 10 |
| 003 | correct, 146s → 10 | wrong → 0 |
| | **23** | **20** |

The whole gap is one speed bonus. Garfunkel missed the cliff by **1.4 seconds**.

**The real defect is disclosure.** `PlayerPage.jsx:2216` renders the breakdown only when
`speedBonus > 0`, so the player who missed the window is the only one never told the window
exists. There is no countdown, no timer and no rules screen anywhere in `src/src`.

**The patch is written out in full** in the scoring agent's report — render the breakdown for
every correct answer including `+ 0 speed bonus` with the elapsed time. `responseTimeMs`,
`basePoints`, `speedBonus` and `isCorrect` are all already in `answers` state at
`PlayerPage.jsx:948-958`, so no data-layer change is needed. **It was not applied** because two
agents held that file at the time. A visible 30-second countdown on ASK is the real fix; the
patch is the smallest change that stops the number looking arbitrary.

### Two scoring findings NOT fixed

1. **Latent double-count.** `get-results.js:729` guards re-scoring by remembering only the single
   most recent round: close 1, then 2, then re-close 1 → `afterRound` is `002`, `002 !== 001`,
   and round 1 is added again. Compounding it, line 707 filters `PointsEarned > 0`, so a player
   who answers wrong never advances the guard at all — **Garfunkel's row is stuck at
   `afterRound: "002"` in live dev data right now.**
2. **A trap.** `calculateTriviaScores` (`GameHostPage.jsx:2361`) is dead twice over — nothing
   references it and it POSTs to `games/{id}/scores`, a route that does not exist in the
   template. But it awards flat points with **no speed bonus**. Revive it and every score
   silently drops from 13 to 10. Delete it rather than leave it.

---

## Waiting on the owner

1. **The roster reveal (designed, NOT built).** Hovering/clicking the room count and the
   answered/voted fractions reveals player names inline, mirroring `Rail.jsx`'s QR pattern
   (hover + focus + click-to-pin; Space deliberately NOT handled, because it is the room's
   advance key and swallowing it created a pin/unpin loop). **The owner chose "name only who is
   still waiting."** That is the sharpest possible conflict with `RoomMeter.jsx`'s documented and
   tested rule that it never names anybody — that rule must be retired *explicitly*, with the
   doc-block rewritten and `stageShell.test.jsx` updated to assert the new rule, not silently
   broken. The design was presented and approval was never given; do not build it without one.
2. **`POST /games`** — the two-step above.
3. **Tag-only pipelines (`b6929cac`)** — still committed and not applied.

## Two background sessions the owner started, both now redundant

- **`task_5beb0010`** ("Fix `?role=host` leaking AccessCode") — **already fixed** by `9df1d5ec`,
  by deletion rather than gating. That session will conflict.
- **`task_d4433a43`** ("Delete stale `AdminPage.jsx.backup`") — done in `91bf76c9`.

---

## One landmine this session added to the list

**A test can pass against the mutation it was written to catch, for a reason that is not obvious.**
`checkPlayerAnswer` has two "could not find out" exits and the suite covered one. The obvious test
for the second — make `/state` fail — passed against the mutation anyway, because a refresh calls
`/state` twice and `checkGameState` bails on the first failure before the branch under test is
ever reached. The test now fails only the **second** call and asserts it got there.

The general rule this repo keeps re-learning: **breaking the implementation and watching the test
go red is the only proof a test does anything.** Six tests that proved nothing were caught in the
two days before this session; one more was caught during it, written by the same process that was
checking for them.
