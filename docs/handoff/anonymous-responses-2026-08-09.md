# Handoff — anonymous responses, and the state of everything else

**Date:** 2026-08-09. Everything below is on `dev`, **committed but deliberately NOT pushed** past `85ad6043`. Read the "Do not deploy yet" section before you push anything.

Plan: `docs/superpowers/plans/2026-08-09-anonymous-responses.md`
Spec: `docs/superpowers/specs/2026-08-08-host-screen-redesign-design.md` §5.6
SDD ledger: `.superpowers/sdd/2026-08-09-anonymous-responses/progress.md` (git-ignored; per-task briefs, reports and review diffs live beside it)

---

## Test baselines — check before claiming a regression

| Suite | Command | Expected |
|---|---|---|
| Backend | `for t in tests/*.js; do node "$t"; done` | **20 suites, 690 passed, 0 failed** |
| Frontend | `cd src && npx jest __tests__/` | 5 failed suites / 30 failed / 242 passed |
| Build | `cd src && npm run build` | compiles, 2 pre-existing size warnings |
| Template | `sam validate --lint -t template-clean.yaml` | valid |

Aggregate backend counts with `grep -E '^[0-9]+ passed'`, **never** `tail -1` — some suites print a trailing line and `tail -1` silently drops them.

The 5 failing frontend suites are stale and out of scope: they predate the auth system (`useAuth must be used within an AuthProvider`) and call `new WebSocketClient()` on a singleton export.

---

## Where anonymous responses got to

**Tasks 1–6 of 11 are done.** The backend can now complete a full round — redact, vote, reveal. Tasks 7–11 are not started.

| # | Task | Commit | Review |
|---|---|---|---|
| 1 | Redaction gate, both Lambda dirs | `85ad6043` | clean |
| 2 | `anonymousUntilReveal` persists through create | `37eae389` | clean |
| 3 | Redact `GET /games/{id}/answers` | `2c588841` + fix `6de72ea8` | clean after 1 fix round |
| 4 | Redact `POST /games/{id}/start-vote` | `35a922be` | clean |
| 5 | Redact the `playerAnswered` socket frame | `8476e704` + fix `f4c1a8ac` | spec ❌ → fixed; re-review outstanding |
| 6 | `POST /games/{id}/reveal-authors` | `f1d65470` | **not yet reviewed** |

**Tasks 5 and 6 have not completed their review gate.** Re-run them before trusting either:

```
.superpowers/sdd/2026-08-09-anonymous-responses/review-35a922be..8476e704.diff
```

and generate one for Task 6 with
`<skill>/scripts/review-package docs/superpowers/plans/2026-08-09-anonymous-responses.md 8476e704 f1d65470`.

### Remaining tasks

7. **Field Notes must not name an unrevealed author.** `get-ai-summary.js:1175-1176` builds `` `${top.playerName}'s answer, "${top.answer}", earned the most support` `` in code — a deterministic template, not the model. Needs an unattributed fallback while hidden, and the model prompt built from redacted rows.
8. **The report must honour `AuthorsRevealed`.** `get-results.js:414` persists `Winners` by name, so the report can reconstruct attribution even when the response was redacted. A round never revealed must stay unattributed, or a promise made to the room is broken by an artefact produced after everyone leaves.
9. **Setup control** — `src/src/config/anonymity.js` + the form. Offered only for formats that hold a vote, derived from `hostRunsVotePhase()` so the two cannot drift.
10. **Host renders redacted rounds and drives the reveal** — plus hiding standings pre-reveal (attribution by arithmetic) and the `‹ Hide again` display-only step.
11. **Player ballot** — label by position, mark the player's own row by matching submitted text.

---

## Do not deploy yet

`dev` is **held at `85ad6043`** on the remote. Local `dev` carries Tasks 1–6.

Pushing now would deploy a backend that redacts author names with `anonymousUntilReveal` defaulting **ON for every existing game**, while the host UI has no reveal control (that is Task 10). Names would vanish from the vote and results views with no button to bring them back — recoverable only by calling `POST /games/{id}/reveal-authors` by hand.

**Push `dev` once Task 10 lands**, not before.

This already bit once: `prod` was pushed to `2c588841` mid-feature and had to be force-reset to `85ad6043`. The manual approval gate caught it.

---

## Environment state

| Branch | At | Notes |
|---|---|---|
| `main` | `85ad6043` | caught up (was 248 behind). No pipeline attached. |
| `test` | `85ad6043` | deployed, `engagetest` UPDATE_COMPLETE |
| `prod` | `85ad6043` | **staged behind the manual approval gate, not yet approved** |
| `dev` (remote) | `85ad6043` | held — see above |

Prod's pipeline is `Source → ApprovalForProd (Manual) → DeployProd`, so a push stages and waits. `85ad6043` is safe to approve.

**One thing to check after prod deploys:** commit `bdd14fc1` (2026-07-02) enables the API authorizer on admin routes and removes the admin bypass. That is after prod's previous deploy (2025-08-30), so admin access will start depending on real `admins` group membership in Cognito.

`UserPoolV2` landed 2025-08-15, *before* prod's last deploy — so this does **not** replace the pool and existing prod users keep their accounts. An earlier draft of this handoff said otherwise; it was wrong.

### engagetest migrations — one of three applied

**Order matters and the obvious order destroys data.** `cull-ai-prompts` hard-deletes every prompt row with no `promptId` ([cull-ai-prompts.js:192](../../scripts/cull-ai-prompts.js)), which is exactly the 22 `AIPROMPT#GENERATION#*` rows `rekey-generation-prompts` exists to move. Running `cull --apply` first would have destroyed the AI generation prompt library.

- ✅ `rekey-generation-prompts.js engagetest --apply` — **done**, 22 moved, 0 skipped
- ⬜ `cull-ai-prompts.js engagetest --apply` — verified safe now; post-rekey dry run reports `orphans: 0`, leaving `gameType canonicalised: 8`, `isDefault cleared: 6`
- ⬜ `migrate-set-versions.js engagetest --apply` — 5 sets, 0 skipped; legacy `SET#<id>` rows stay in place so rollback is `REMOVE activeVersion, versions`

All take `AWS_PROFILE=adminaccess node scripts/<name>.js engagetest [--apply]` and are dry-run by default.

---

## Landmines found while doing this work

- **Unawaited async `check()` silently drops assertions.** The plan's test template produced bare `check(...)` calls against an async helper; the process exits before the assertion resolves and the check vanishes from the count with **no failure signal**. Caught empirically in Task 5 (21 call sites, 20 executed). Both test files are now verified clean, but any new test appended to `tests/anonymous-round-flow.js` or `tests/anonymity-contract.js` must `await` every call.
- **`seedAnonymousRound` seeds no `CONNECTION#` rows.** Any test asserting on a broadcast must `put()` its own connection, or `sent` stays empty and the assertion passes vacuously. Tasks 4, 5 and 6 each add their own inside their own section; the shared helper is deliberately untouched.
- **`get-answers.js`'s player branch returns no `answers` array at all outside `VOTE#`.** Correct behaviour — players must not see each other's answers during ASK — but it makes any host/player parity check fail if seeded at `ASK`. Pinned by a test so nobody "fixes" it.
- **`message.js` routing makes `playerVoted` unreachable.** `isHostMessage` is checked before `isPlayerMessage` and both match a `VOTE#` prefix, so `handlePlayerMessage`'s `playerVoted` branch is dead code. Pre-existing, unrelated to anonymity, worth its own look.
- **The ballot is positional and stable only by accident** (spec §5.6.5a, risk R1). `submit-vote.js:63` stores `{"0": 1, "1": 2}` and `get-results.js:276` tallies against `answers[index]`; the indices agree only because the answer sort key ends in the author's name. Any re-keying, or an answer arriving mid-round, silently lands votes on the wrong answers. **Independent of anonymity — do not bundle.**
- **`reopen-round` does not exist** (risk R2). A host who advances early cannot recover.

### Deferred minors

- `schema-compliant-manager.js:100` — comment cites `:264` for the `randomizeQuestions` read; it is now `:274`.
- `tests/anonymous-round-flow.js` — duplicate section number "5.".
- No `start-vote` test drives the **not**-hidden branch; covered indirectly elsewhere.
- `get-answers.js` now makes two extra `GetItem` calls per request regardless of role; in `start-vote.js` they could be issued concurrently with the answers Query to save a round-trip.

---

## The host screen redesign — approved, not started

`docs/design/host-redesign/` — 21 mockups, `audit.js` (168 checks over 21 pages × 4 profiles × 2 viewports), `CRITIQUE.md`, `USER-REVIEWS.md`, `USER-REVIEWS-2.md`. Serve it with a static server on any port and open `index.html`; the type is `vh`-scaled so it only tells the truth full-screen.

Reviewed to approval over four rounds — an independent critic and three simulated first-time evaluators who went from two hard noes to unanimous yes. Plans 2–5 are not written yet:

2. Stage shell + four profile ladders + the `fit()` hook
3. Console (operator chrome, question browser, how-to-play beat)
4. Per-state content and the deletions
5. ENDED, plus two verified defects — `isWaitingState('ENDED')` returns `true` so a finished session renders the lobby, and `setGameState('ENDED')` sits inside the `if (confirmed)` branch of the `gameEnded` dialog so declining strands the game.

Spec §8 carries an implementation order and §7 carries 18 testable negatives, most of which map straight onto `audit.js` checks.
