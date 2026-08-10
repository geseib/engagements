# Resume

After `/clear`, paste the block below.

---

Read `docs/handoff/RESUME.md` in full before doing anything else. It is the whole state.

## Where things stand

`dev` is at **`bbadaa59`**, pushed, and **every commit is deployed to `engagedev`** — five pipeline executions on 2026-08-10, all Succeeded. Verified live after the first: `POST /games/{id}/stage-beat` returns 401 (route exists, behind Cognito) where a nonexistent route returns 404, and `GET /games/{id}` still returns the clean `{"error":"Game not found"}` the root page's code check depends on.

Since the five streams, seven more commits landed — all from the owner running real sessions and saying what was wrong:

| | |
|---|---|
| `182a1b20` | the `SESSION` control moves to the dock's right edge; the feedback labels (measured at **1.07:1** — invisible, not merely dark); the question browser's wide panel, which the mockup had and the build had missed; categories, whose on/off states were inverted; and the Admin ↗ / Host ↗ cross-links |
| `4135eb14` | the welcome screen and Quick Start, the last surfaces in the old style |
| `e1315e4e` | the OAuth return path (see below) |
| `bbadaa59` | all seven auth surfaces |
| `b6929cac` | tag-only pipelines — **committed, NOT applied** |

**`e1315e4e` is worth reading before touching auth.** `rememberReturnPath()` is called with no argument from the Google buttons, which live *on* `/auth` — so it read `/auth` out of `window.location` and overwrote the destination the previous page had stored. `takeReturnPath` then correctly refused `/auth` and fell back to `/`. The destination was not wrong, it was **gone before the callback looked**, and a host scanning the remote QR while signed out landed on a second copy of the host page — a second host WebSocket connection.

Its tests had never reached the code: the helper assigned to `window.location.pathname`, which jsdom 26 silently ignores. They use `history.pushState` now. **This is the landmine below, caught in the wild.**

**One commit is NOT applied: `b6929cac`, the tag-only pipeline change.** The template is committed; the running pipelines still carry their branch triggers until someone runs

```bash
aws cloudformation deploy --template-file cicd/pipeline-clean.yaml --stack-name engagecicd --capabilities CAPABILITY_NAMED_IAM
```

Check before trusting either rule: `aws codepipeline get-pipeline --name engagecicd-pipeline-dev --query 'pipeline.triggers'`.

The last session shipped a five-stream program plus two defect fixes. The design that governs all of it is
`docs/superpowers/specs/2026-08-09-entry-console-scoreboard-design.md` — read its **§0.0 first**, because it records the rule the owner gave mid-session and it governs every UI change from here on:

> **The mockups in `docs/design/` ARE the design.** Specs record decisions, defects and constraints; they do not re-draw a screen. Open the mockups in a browser before writing UI code.
> `python3 -m http.server 8124 --directory docs/design` (`.claude/launch.json` → `all-design-mockups`).

Silence in a mockup is **not** an instruction to delete — the mockups routinely omit shipped behaviour that is correct.

### What shipped

| Commit | |
|---|---|
| `53412404` | **The "What We Heard" defect** — it was never missing; it was taken back ~300ms after the press |
| `b28adac3` | **The root page** — `/` now carries both audiences |
| `10917c7c` | **The report leaderboard** sorted by a field trivia never writes |
| `c542e3d2` | **The remote's AI beat**, the AI text on the phone, and the waiting list |
| `b66d5d89` | **The engagement setup dialog**, extracted and de-lied |
| `36e45851` | **One setup panel** behind SETUP, three tabs, and the SPACE defect |
| `c147ca70` | **The top three** on the room's screen |

Highlights worth carrying forward:

- **The beat defect.** `handleShowResults` wrote `setCurrentQuestionId(questionNumber)` — a round number where every other writer puts the question's id — so `close-round`'s broadcast rewrote it and that changed dep re-fired the reset effect, discarding the beat. Path-dependent: it fired only when the round was closed **from the host page**, never from the remote or a re-sync. It was invisible until `dev-v1.2.0` stopped the host's `CONNECTION#` row being evicted; that fix was correct and exposed this.
- **Copy Invite hardcoded `https://eng.dev.seibtribe.us`** — one environment, and the off-pipeline one being retired. A host running a **prod** session copied an invitation that sent the whole room to dev. Now derived from `window.location` like every other url on the page.
- **The SPACE defect.** `isTypingTarget` covers inputs only and the handler calls `preventDefault()`, which suppresses space-activation of *any* focused button. A host who tabbed to a button and pressed Space advanced the round instead of pressing it. Fixed by event target, not geometry. `HostActionBar` also gained an `event.repeat` guard — a held key or a clicker's auto-repeat fired the primary at the OS repeat rate, and the primary's *meaning* changes between repeats.
- **The trivia timer is deleted.** It never worked: `create-game.js:9`'s destructure never named it and nothing reads a timer. **Do not restore it.**

---

## Deployment — a tag is the deploy

**`b6929cac` made the pipelines tag-triggered only.** All three `Triggers` blocks used to carry a `- Branches:` entry beside the tag one, so `git push origin dev` deployed on its own — which is why `origin/dev` had spent a week 22 commits behind a local branch whose code was already live via tags, and why pushing a branch *and* its tag fired two executions of the same commit.

```
push tag dev-v*    → engagecicd-pipeline-dev   → engagedev   (auto)
push tag test-v*   → engagecicd-pipeline-test  → engagetest  (auto)
push tag prod-v*   → engagecicd-pipeline-prod  → engageprod  (halts at ApprovalForProd)
```

- **Confirm it is applied before relying on it** — see "Where things stand". Until the CFN update runs, a branch push still deploys.
- `BranchName` in each Source action is **not** a trigger; it is the revision a manually-started "Release change" pulls.
- `engagecicd` is **not** deployed by any pipeline — applied by hand, which is why tag-only survives its own bootstrap.
- Never run `./deployall`, `./scripts/deploy-clean.sh` or `./scripts/deploy-frontend-eng.sh`. They target the off-pipeline `engdev` stack.
- **Committing locally is authorised** (owner). **Pushing a `*-v*` tag is the deploy** and needs the owner; prod requires checking first.
- The pipeline execution history is the only reliable record of what is deployed:

```bash
AWS_PROFILE=adminaccess aws codepipeline list-pipeline-executions --pipeline-name engagecicd-pipeline-dev --max-items 5 --query "pipelineExecutionSummaries[].{status:status,rev:sourceRevisions[0].revisionId}" --output table
```

**Beware `--output text` on a scalar query** — it appends a pagination `None` on a second line, so `[ "$s" != "InProgress" ]` is true while the run is still going. That produced one false "finished" reading. Use `--output table`, or query `stageStates[?stageName=='DeployDev'].latestExecution.status | [0]`.

---

## Open with the owner

0. **The confirm-password field is gone from register, reset and change.** The mockups draw one field with a Show toggle, so that is what shipped — but it deletes shipped behaviour, and the trade is real: a typo at registration creates an account with a password the host cannot reproduce, with only the Show toggle standing in the way. Restoring it is small. **Awaiting a ruling.**
1. **Auto-submit on the fourth digit of the join code.** `entry-redesign/RATIONALE.md` §5 specifies it; `01-root.html`'s own live script does **not** — it enables a Join button, and `03-join-unknown-code.html` draws a "Try again" button an auto-submitting field would not need. Built to the mockup. The rationale and the mockup contradict each other.
2. **Do the live defects jump the queue?** (§2 below.) Name collision and rejoin corrupt real sessions.
3. **Archive auth.** `GET https://archive.seibtribe.us/archive/items` returns 200 unauthenticated and CORS advertises `DELETE` with `Origin: *`. `ArchivePanel.jsx` hardcodes that URL **six times** with plain `fetch`, no auth, including DELETE. The service is **not in this repo** and fixing it needs a deploy outside the pipeline.
4. **The parallax hero.** The admin designers cut it and asked to be told they are wrong: between the host and admin redesigns the product loses its whole visual signature in one week.

---

## The streams still to run

### 1. Auth — SHIPPED (`bbadaa59`); what is left

All seven surfaces rebuilt from the `entry-redesign` mockups. **Not a right-side panel**, and the reasoning is recorded in `AuthPage.jsx`'s header: `ProtectedRoute` *early-returns* `<AuthPage>`, so `children` is never rendered and there is nothing behind to slide over. The URL staying put is the tempting part, but that is a destination, not a picture.

Resolved by it: the three disagreeing password validators (the pool declares its own policy at `template-clean.yaml:2290-2294`, and Cognito's `RequireSymbols` takes every printable ASCII non-alphanumeric — the *permissive* rule was the real one, and the strict validators were rejecting passwords the server accepts); the account-enumeration oracle in `forgotPassword`; the approval email nothing sends; the 24–48 hour promise.

**"Forgotten it?" was dead in Chrome** — rendered inside the `<label>`, which forwarded every click to the input. Note the two click tests do **not** catch it: jsdom does not implement label activation forwarding, so they pass with the bug restored. Only the structural test bites, and the file says so.

**Correction to an earlier handoff:** `PendingApproval`'s "Check again" button calling `refreshSession` **did not exist**. The 24–48 hour hardcode was real; the throwing button was not.

Left: **~350 lines of dead legacy CSS in `auth.css`**, kept deliberately — `OAuthCallback.jsx`, `PrivacyPolicyPage.jsx` and `TermsOfServicePage.jsx` still import it and names like `.form-group` are shared with a dozen components. Its own task. Also `13-pending.html`'s "Requested &lt;date&gt;" row, which needs a request time nothing records.

Narrow residual: `passwordPolicy.js`'s symbol test is `/[^A-Za-z0-9]/`, which accepts non-ASCII (`é`, emoji) that Cognito may not count — so a password can pass the browser and be refused by the server. Fails in the safe direction.

### 1b. The welcome screen and Quick Start — SHIPPED (`4135eb14`)

A **page, not a panel** — a panel overlays something and there is nothing behind it. The amber page is gone: `--primary` is the one hero accent, and flooding it left nothing to point with, which is why all four actions read as the same weight. Quick Start stays an overlay, because it genuinely covers something.

`.quickstart-modal` had `borderRadius: 16px` — not a CSS property — so it had been square-cornered since it shipped.

### 2. The live defects — these corrupt real sessions

- **Two players with the same name silently merge.** `join-game.js` keys players by `PLAYER#{playerName}` and returns `isReconnection: true`. The second Chris inherits the first Chris's answers and score, with no warning. `07-join-name-collision.html` is designed; it needs a name-availability check that does not expose the roster.
- **Rejoin never contacts the server** — `handleRejoinConfirm` sets `joined = true` locally and nothing else.
- **Survey cannot be created.** `upload-questions.js:146-157` rejects survey uploads outright, so no survey set can exist. The picker holds it behind `UNPLAYABLE_GAME_TYPES` in `config/gameTypes.js`, with the reason in a comment — **when upload lands, removing the entry is the whole fix.**
- **Poll plays as free-text-then-vote.** `get-question.js:154` forwards options for trivia only, so multiple-choice options in an uploaded poll set are stored and never shown. Adding Poll to the picker exposed this; it did not create it.

### 3. Wavelength — the room's shared vocabulary

**Spec written and committed:** `docs/superpowers/specs/2026-08-09-wavelength-convergence-design.md`. Every decision is made; it needs a plan and a crew.

Wavelength measures **how many words match across the whole team**, not player performance. `totalScore: 0` is *correct* — players have no scores and never should. A word counts only when **everyone who submitted** said it (near-misses show, dimmer); ten words asked for, fewer accepted; **conservative automatic AI clustering**, no host review step; **no team-splitting mechanic** — the product just says *works best with groups of ten or less*.

Four data changes, all named in the spec: "common" means count > 1 rather than everyone; `connectionScore` is words ÷ words and answers no question; matching is exact-string; nothing aggregates across rounds.

**The setup screen's group-size caveat ships WITH this, not before it.** Writing the copy does not make the rule true, and `get-ai-summary.js:866` references an undeclared `commonWords` inside the wavelength pass — a runtime `ReferenceError` any wavelength work lands on top of.

### 4. The ENDED screen — Tiers 0, 2 and 3

**Reviewer recommendation:** `docs/superpowers/reviews/2026-08-09-ended-screen-review.md`. Tier 1 (the podium) shipped; the sort fix shipped. Remaining:

- **Tier 0, and it is the highest-value fix in that document because it is a deletion.** `participationRate` and `votingParticipation` (`get-ai-summary.js:1511`, `:1599`) are interpolated into the **live prompt**, so the model is told every round had 100% participation — and hosts read those summaries out loud. You only count rounds that happened, so the figure can only ever read 100%.
- **Tier 0.** `gameStats.totalPlayers` (`create-report.js:115`) counts `PLAYER#`, `#SCORE` and `#STATE` rows together. Use the `uniquePlayers` set already built at `:512`.
- **The participation sentence.** *"34 of 40 people took part"* needs one server-computed count of distinct answerers that does not exist. **If only one thing ships, ship this** — it is the only claim on that screen currently absent or false.
- Tier 2 (AI session summary) and Tier 3 (wavelength's unison band).

### 5. The remote's unbuilt half

`17-remote.html` draws, and `HostRemote.jsx` does not have: a **`This round`** block (`Choose next question`, `Expand on stage`, `Timer 2:00`, `Skip round`), a **`Session`** block (`Categories`, `Join code`, `Session report`, `Switch game`), and a **full phone question browser including the correct answer** — which is right: *the stage browser shows what a question is about, the remote shows what it says*.

`09-field-notes.html` also draws a `‹ Results` secondary that walks the beat backwards. The server and `stage-beat.js` support `beat: 'results'` in both directions and it is tested; no stage control calls it yet.

**The timer exists nowhere in the product.** It is a new feature — backend field, broadcast, player-side clock — not a control to add.

### 6. Admin — phased, none started

**Scout inventory:** `docs/design/admin-redesign/INVENTORY.md`, a pre-design audit of the current code. Read it before re-deriving anything.

Order is forced by the code, not preference:

1. **The shell, alone** — left vertical nav, top bar, breadcrumb, environment chip. All 22 mockups sit inside it. Two agents touching it collide.
2. **Users** — already its own component, and the most broken: `approveUser`, `updateUserStatus` and `deleteUser` all call **routes that do not exist**, and none is wired to a button; the Enabled badge counts one predicate while the filter matches a value that is not a Cognito group, so a non-zero badge can sit over an empty table.
3. **Settings** — small, self-contained, and it gains the thing the console has never had: which of the three environments is loaded.
4. **Sessions** — there is no session list at all; the tab is a delete box you type a game ID into. `GET /games` exists and admin never calls it.
5. **Question sets + AI generation together** — they share `engagementType` and the builder modals. This is where **a failed generation looks like a success**: on partial failure the builder populates the review UI from partial results and puts `Generation failed:` into a field the review branch never displays.

**Archive and Prompts stay parked** until the archive auth ruling.

Extract each tab as part of its own phase rather than one big invisible refactor — `AdminPage.jsx` is 1,769 lines with four of six tabs inline, sharing one 90-line `useState` block and a root-level modal stack.

---

## Baselines — check before claiming a regression

| Suite | Command | Expected |
|---|---|---|
| Backend | `for t in tests/*.js; do node "$t"; done` | **29 suites, 983 passed, 0 failed** |
| Frontend | `cd src && npx jest __tests__/` | 5 failed suites / 30 failed / **768 passed** |
| Build | `cd src && npm run build` | compiles, 2 pre-existing size warnings |
| Template | `sam validate --lint -t template-clean.yaml` | valid |

Aggregate the backend with `grep -E '^[0-9]+ passed'`, **never** `tail -1`, **and assert the suite count** — a crashed suite prints no result line, so a grep aggregate silently drops it and reports "0 failed". The ten `tests/*.spec.js` files are Playwright and legitimately print no result line. Guard:

```bash
for t in tests/*.js; do out=$(node "$t" 2>&1); echo "$out" | grep -qE '^[0-9]+ passed' || echo "NO RESULT LINE: $t"; done
```

The five failing frontend suites are `AdminPage`, `App`, `GameHostPage`, `PlayerPage`, `WebSocketClient`. **Three of them are broken by a harness bug, not obsolete** — see Landmines.

---

## Landmines

**Tests that look like coverage and assert nothing.** This is the dominant failure mode in this codebase. **For every test, name the implementation it would reject. If the answer is "none", say so rather than padding the count.** Better: break the implementation and watch the test fail. Every stream last session did this, and it caught three tests that asserted nothing — a focus-trap test that passed with the trap deleted (jsdom has no default Tab behaviour), a mount assertion that matched a renamed element, and a source assertion that passed **on a comment**. Run source assertions against comment-stripped code.

**Test the call site, not just the module.** `shortcutsSuppressed()` is the standing example: it is extracted and tested, but deleting an argument from its *call site* reinstates the defect with the whole suite green. `hostOverlays.test.js` now parses the call-site argument object and asserts its contents. Keep that pattern.

**`setupTests.js`'s `window.location` mock is a silent no-op** under jsdom 26 — `delete window.location` returns `false`, so the real `Location` survives and every assignment to `pathname`/`search` is an ignored navigation. It is the root cause of three of the five failing suites. **They are not obsolete; they are broken by a harness bug.** Fixing it is cheap and retires a standing rule — but it moves the frontend baseline, so do it as its own change. Until then, route navigation through `auth/navigate.js`'s `navigateTo` and assert on that.

**jsdom has no layout engine.** Every geometric assertion returns zero and passes unconditionally. Verification is a human in a browser, at the projected size, **varying the configuration and not just the state**.

**`GameHostPage` cannot be rendered in jsdom at all** — it dies on the auth provider. The workaround that now has three successful precedents: extract the surface into its own component that *can* be rendered (`GameSetupDialog`, `SessionSetupPanel`, `Podium`) and put the decision in a pure module (`config/setupPanel.js`, `config/podium.js`, `config/hostControls.js`).

**`hostControlsFor` rewrites an unrecognised phase to `LOBBY`.** Adding a phase without adding it to `HOST_PHASES` produces something that looks like it works and renders the lobby.

**The `resultsBeat` reset effect is fragile on purpose and has already cost one live defect.** Any change that moves one of its deps *without the round moving* knocks the stage back to the tally. The server beat is stamped with the game state it was read for and honoured only while they match — do not reduce it to a bare value, and do not add a re-sync to the `stageBeatChanged` handler.

**Do not delete the expanded-lesson modal.** It is the recovery path for a dropped ASK prompt, which the fitter sacrifices on a dense round.

**Pre-existing, unfixed:** `handlePlayerVote` builds `ROUND#` keys unpadded; `message.js` routing makes `handlePlayerMessage`'s `playerVoted` branch unreachable (`isHostMessage` matches `VOTE#` first); the positional ballot is stable only because the answer sort key ends in the author's name; no `reopen-round` endpoint, so a host who advances early cannot recover; `setGameState('voting')` maps to LOBBY, so the host stage renders the lobby for the duration of the `start-vote` round-trip on every call-and-answer round.

**Two `engagetest` migrations are unrun** — `cull-ai-prompts` and `migrate-set-versions`. Order matters and the obvious order destroys data. Both take `AWS_PROFILE=adminaccess node scripts/<name>.js engagetest [--apply]` and are dry-run by default.

**`ArchiveManager.jsx` and `ArchiveSearch.jsx` are dead** — single-line escaped garbage, not valid JS, imported by nothing. Exclude them from sweeps.

**Orphaned CSS remains** after the panel deletion — `.qr-content`, `.qr-controls`, `.host-roster`, `.question-browser-*`, `.questions-table`. Only rules naming removed elements were deleted; `.category-button` and others are shared with `GameSetupDialog` and `PlayerPage`, so a full sweep needs its own change.

**`Unasked only` in the question browser is session-local.** The server tracks used questions by *round number*, never as set-question ids, and `GET /games/{id}` returns a `usedQuestions` array **nothing ever writes** — reading it would report everything unasked. The filter accumulates ids client-side and resets on reload. A durable fix is a backend change.

---

## Owed: a human in a browser

Nothing below can be asserted in jsdom, and none of it has been checked:

- **A dense revealed RESULTS with the podium** — a call-and-answer round now carries three answer cards *and* a podium. `07-results-trivia.html` at 1280×720 already renders `--fit: 0.55` with `data-clamped="on"` **before** any podium, so that is the state most worth measuring.
- **Contrast at all four display profiles** for the setup panel.
- **The remote QR scanning at 160–180px** from arm's length, on a real phone camera.
- **The full auth round-trip on a phone**, both email/password and Google.
- **A clicker pass** — `Space`/`→` advance and `←` step back with the panel open and closed, since a clicker sends keys with no meaningful `event.target`.
- **The root page's 404 state** was driven against the live dev API and matches; the 900px breakpoint is guarded only by a CSS-text assertion.

## Design sets

`python3 -m http.server 8124 --directory docs/design`

`host-redesign/` (21, plus `CRITIQUE.md` and `USER-REVIEWS-2.md` — this set has **no** `RATIONALE.md`) · `entry-redesign/` (17) · `admin-redesign/` (22, plus `INVENTORY.md`) · `player-redesign/` (23).

Each of the other three carries `RATIONALE.md` and `OPEN-QUESTIONS.md`. The design agents were asked to argue back and did; several of their disagreements were correct and are worth reading before building from them.
