# Resume

After `/clear`, paste the block below.

---

Read `docs/handoff/RESUME.md` in full before doing anything else. It is the whole state.

## Where things stand

`dev` is at **`0dc39ae9`**, tagged **`dev-v1.2.0`**, deployed and verified in a browser. Today shipped two waves:

**Wave 1 (`dev-v1.1.1`)** — two defects found by the owner running a live session, both reproduced against dev before a line was changed:

- **The answered count only moved on refresh.** On an anonymous round `message.js` strips `playerName` from the `playerAnswered` frame by design, and the meter's numerator was a list of *names*, so it could not grow between re-syncs. `answeredCountFrom` now takes the larger of the server's participation list and the `/answers` rows, which do arrive live.
- **The remote advanced the round and the host screen didn't follow.** Not a missing broadcast — the host's `CONNECTION#` row was deleted by a later `$connect` while its socket stayed open. Every broadcast is a query over those rows, so the page received nothing while reporting `readyState === OPEN` and painting a green "Connected" badge. `connect.js` now claims its row before retiring older ones and only retires *strictly older* ones; `WebSocketClient` no longer orphans a socket; `message.js` and `submit-vote.js` notify every host row rather than `Items[0]`.

**Wave 2 (`dev-v1.2.0`)** — three features on the host stage, built task-by-task with review between each:

- the meter and dock go green and pulse once when everyone has responded;
- the rail's session code opens the player-join QR (hover/focus previews, click pins, only pinned suppresses SPACE);
- the host panel's QR opens the **Host Remote** on the host's own phone, with the OAuth return path that makes signing in land there.

**Verified by the owner in a browser:** the QR popup, the remote QR, the count incrementing live, and the host screen following the remote.

Spec: `docs/superpowers/specs/2026-08-09-host-completion-signal-design.md`. Plan, including what was parked and why: `docs/superpowers/plans/2026-08-09-completion-signal-and-qr.md`.

---

## THE ONE OPEN DEFECT — start here

**There is no "What We Heard" button on the RESULTS screen.** Reported by the owner after `dev-v1.2.0`. It is a defect, not unbuilt work — the button is wired:

- `config/hostControls.js` `case 'RESULTS':` returns `{ id: 'field-notes', label: 'What We Heard', intent: FIELD_NOTES, disabled: false }`.
- `GameHostPage.jsx` `runHostAction` handles `HOST_INTENTS.FIELD_NOTES` by `setResultsBeat('field-notes')`.
- `hostPhase` is `FIELD_NOTES` when `roundPhase === 'RESULTS' && resultsBeat === 'field-notes'`, and that branch renders the "What we heard" kicker and the AI insights.

So the action exists, is not disabled, and has a handler. **Do not "fix" it by adding a second button — find why the existing one is not on screen.** Suspects, cheapest first:

1. **`resultsBeat` is already `'field-notes'` when RESULTS arrives**, so `hostPhase` skips straight past the beat that offers the button and the primary reads "Next Round". It is reset by `useEffect(() => setResultsBeat('results'), [currentQuestionId, gameState])` — and React bails on a `setState` to an identical value, so if neither dep actually *changes* on the way into RESULTS the effect never re-runs.
2. **The round never reaches `RESULTS#nnn`** in the host's React state, so `phaseOfGameState` returns LOBBY. Note `hostControlsFor` rewrites any unrecognised phase to `LOBBY` silently.
3. **The dock is rendering the primary but it is not visible** — check the fitter and `HostActionBar`'s big-screen branch, which already hides its own `kbd` and `hint` in the mode the dock always passes.

Reproduce in a browser with the console open and log `hostPhase`, `resultsBeat` and `gameState` on the RESULTS transition. **jsdom cannot answer this** — it has no layout engine and `GameHostPage` cannot be rendered under test at all (see Landmines).

---

## The streams, and what each needs to start

Six bodies of work. Each is its own spec → plan → execution cycle; do not try to run them from one session. Decisions already made by the owner are recorded here — **treat them as settled, not as suggestions.**

### 1. Wavelength — the room's shared vocabulary

**Spec written and committed:** `docs/superpowers/specs/2026-08-09-wavelength-convergence-design.md`. Every decision is made; it needs a plan and a crew.

The owner corrected the model: wavelength measures **how many words match across the whole team**, not player performance. `totalScore: 0` in `handleWavelengthResults` is *correct* — players have no scores and never should. An earlier note in the session calling that a gap was applying the wrong model.

Rulings: a word counts only when **everyone who submitted** said it (near-misses still show, dimmer); players are asked for ten words and fewer are accepted; matching uses **conservative automatic AI clustering** (no host review step) to catch misspellings and abbreviations of the same term without merging merely-related ones; **no team-splitting mechanic** — the product just says *works best with groups of ten or less*.

Four data changes are needed, all named in the spec: "common" means count > 1 rather than everyone; `connectionScore` is words ÷ words and answers no question; matching is exact-string; nothing aggregates across rounds.

### 2. The live defects — these corrupt real sessions

Not redesign work. **The owner has not yet said whether these jump the queue** — ask.

- **Two players with the same name silently merge.** `join-game.js` keys players by `PLAYER#{playerName}` and returns `isReconnection: true`. The second Chris inherits the first Chris's answers and score, with no warning. No collision UI, no availability endpoint.
- **Rejoin never contacts the server** — `handleRejoinConfirm` sets `joined = true` locally and nothing else.
- **Poll and Survey cannot be created.** The format picker offers three types; `config/gameTypes.js` defines five. **Poll is fully ready** — offer it. **Survey is not**: `upload-questions.js` rejects survey uploads outright, so no survey set can exist and a Survey option would be permanently dead.
- **The trivia timer has never worked.** `create-game.js`'s destructure is a whitelist that omits `triviaTimer`; its own comment says the field "was sent by the frontend for months and silently discarded". Nothing anywhere reads a timer. The setup screen promises players 30 seconds.
- **Event Details is stored, returned to players by `get-game.js`, and rendered by nothing.** Its label says it will be shown to participants.

### 3. The host tools / setup panel — one Console

**Reviewer recommendation on disk:** `docs/superpowers/reviews/2026-08-09-console-review.md`.

Owner ruling: **the pull tabs are deleted.** "As much as I like the pull tab, I think they somewhat distract from the game — primarily the how-to-play one is in the way." Replacement is **one button in the dock**, with everything inside it. Do not argue for keeping the tabs.

The owner's own contents list, all of which exist today in a cumbersome form: category list with on/off selection; question list with search and select-next; **a players tab showing every player and their score**; display selector; report viewer; switch game; one-click copy link; WebSocket status icon.

The reviewer's structure orders it hot→cold and merges categories with the question browser — they are the same job at two zoom levels. Two things it found that the owner does not know: the shipped how-to-play renders for only **three of five game types** (wavelength and survey hosts get an empty panel with a Sign Out button in it), and the SPACE shortcut's typing guard only excludes inputs while the handler calls `preventDefault()`, so **a host who tabs to any focused button and presses Space advances the round** instead of pressing that button.

Do not print the word "Console" — user testing killed it and the dock already says SETUP.

### 4. Top three players

Owner ruling: **top three only, never a full roster**, on the room's screen. A podium, not an attendance record. This resolves the open question that had been sitting unanswered since the redesign shipped.

`RoomMeter` refuses names **by test**, and that test **stands unmodified** — the podium is not rendered by RoomMeter. Put it on the stage; the meter is `null` on RESULTS/ENDED already and is the first thing the fitter sacrifices.

**It must be gated on `standingsVisible(...)`.** A podium during an unrevealed anonymous round is attribution by arithmetic — the exact leak that got the pre-reveal standings meter removed.

Wavelength gets **no podium** (§1).

### 5. The root screen, and setup

**Reviewer recommendation on disk:** `docs/superpowers/reviews/2026-08-09-setup-screen-review.md`. Owner instruction on the mockups generally: *"review those mockups and incorporate the ones that make sense"* — **they are input, not gospel.** Where the app is better, keep the app and say why.

**Root must carry both sides** — player code entry and host/admin sign-in, per `docs/design/entry-redesign/01-root.html`. Today `/` is the host page behind `ProtectedRoute`, so a participant who types the URL hits a sign-in wall and `/play` is the only way in.

**Setup is not a screen** — it is an early-return overlay inside `GameHostPage.jsx` reached only from the welcome screen. Make it a **component, not a route**: `App.jsx` is a `window.location.pathname` switch with no client-side navigation, so a route means a full reload that destroys the session it exists to hand off.

The anonymity copy ruling, which matters because it is a promise about anonymity: `get-results.js` sets `AuthorsRevealed` **unconditionally** on entering RESULTS, and `/reveal-authors` is only an *early* reveal. So the shipped **"Until voting closes" is true** and the mockup's "Until you reveal them" tells the host they hold a switch they do not hold. Adopt the mockup's card layout, keep the shipped sentence.

**Access codes for a game id are deferred** by the owner. The backend accepts and enforces `visibility`/`accessCode` and the participant side is designed, but no host UI sets them and none is wanted yet.

### 6. Admin — phased

**Scout inventory:** the admin design set carries its own `INVENTORY.md`, a pre-design audit of the current code. Read it before re-deriving anything.

The owner wants phases so each lands visibly in dev. The order is forced by the code, not by preference:

1. **The shell, alone** — left vertical nav, top bar, breadcrumb, environment chip. All 22 mockups sit inside it and it replaces the current tab strip wholesale. Two agents touching it collide.
2. **Users** — already its own component. Also the most broken: `approveUser`, `updateUserStatus` and `deleteUser` all call **routes that do not exist**, and none is wired to a button; the Enabled badge counts one predicate while the filter matches a value that is not a Cognito group, so a non-zero badge can sit over an empty table.
3. **Settings** — small, self-contained, and it gains the thing the console has never had: a statement of which of the three environments is loaded.
4. **Sessions** — there is no session list at all; the entire tab is a delete box you type a game ID into. `GET /games` exists and admin never calls it.
5. **Question sets + AI generation together** — they share `engagementType` and the builder modals; splitting them puts two agents in one file. This is where **a failed generation looks like a success**: on partial failure the builder populates the review UI from partial results and puts `Generation failed:` into a field the review branch never displays.

**Archive and Prompts stay parked** until the owner rules on the archive's open API (below).

Extract each tab as part of its own phase rather than doing one big invisible refactor — `AdminPage.jsx` is 1,769 lines with four of six tabs inline, sharing one 90-line `useState` block and a root-level modal stack, so "independent" tabs still collide until they are extracted.

---

## Decisions still open with the owner

1. **Do the live defects (§2) jump the queue?** Name collision and rejoin corrupt real sessions.
2. **Archive auth.** `GET https://archive.seibtribe.us/archive/items` returns 200 unauthenticated and CORS advertises `DELETE` with `Origin: *`. `ArchivePanel.jsx` hardcodes that URL **six times** with plain `fetch`, no auth, including DELETE. The designer marked the Archive mockup *provisional* and refused to draw a delete button on it. The service is **not in this repo** and fixing it needs a deploy outside the pipeline — a deliberate owner decision.
3. **The parallax hero.** The admin designers cut it and asked to be told they are wrong: between the host and admin redesigns the product loses its whole visual signature in one week.

## Resolved since the last handoff

- **"Does an approval email exist when someone is promoted out of `pending`?"** — **No.** There is no SES, no `sendEmail`, nothing, anywhere in `lambda-functions/`. Approval is a client-side group change. Meanwhile `PendingApproval.jsx` hardcodes a "24–48 hours" promise nothing backs, and its "Check again" button calls `refreshSession`, which is not exported from `AuthContext`.
- **"Does §7.15 yield for trivia?"** — superseded by the top-three ruling (§4).

---

## Baselines — check before claiming a regression

| Suite | Command | Expected |
|---|---|---|
| Backend | `for t in tests/*.js; do node "$t"; done` | **28 suites, 927 passed, 0 failed** |
| Frontend | `cd src && npx jest __tests__/` | 5 failed suites / 30 failed / **445 passed** |
| Build | `cd src && npm run build` | compiles, 2 pre-existing size warnings |
| Template | `sam validate --lint -t template-clean.yaml` | valid |

Aggregate the backend with `grep -E '^[0-9]+ passed'`, **never** `tail -1`, **and assert the suite count** — a crashed suite prints no result line, so a grep-based aggregate silently drops it and reports "0 failed". Guard:

```bash
for t in tests/*.js; do out=$(node "$t" 2>&1); echo "$out" | grep -qE '^[0-9]+ passed' || echo "NO RESULT LINE: $t"; done
```

## Deployment rule — not negotiable

**The pipeline is the only route to dev, test or prod.** Never run `./deployall`, `./scripts/deploy-clean.sh` or any deploy script. The only mechanism is a branch push or a `<tier>-v*` tag.

**Pushing a branch and its tag together fires two executions of the same commit. Push one or the other.** Today's two releases were tag-only; `origin/dev` is therefore behind the local branch while the commit objects are on the remote via the tags.

`CLAUDE.md` reserves deploys to the owner. **Ask before pushing any tier** — past authorisation was per-action, not standing.

The pipeline execution history is the **only** reliable record of what is deployed; tags are not, because a `dev-v*` tag on *any* branch deploys and the pipeline takes whatever arrived last regardless of version ordering:

```bash
AWS_PROFILE=adminaccess aws codepipeline list-pipeline-executions --pipeline-name engagecicd-pipeline-dev --max-items 5 --query "pipelineExecutionSummaries[].{status:status,rev:sourceRevisions[0].revisionId}" --output table
```

**Still proposed, agreed in principle, not implemented: go tag-only.** Delete the `- Branches:` entry from all three `Triggers` blocks in `cicd/pipeline-clean.yaml`, keep `- Tags:`. Open question first: how does the `engagecicd` stack itself get deployed? The pipeline-only rule has to survive its own bootstrap.

---

## Landmines

**Tests that look like coverage and assert nothing.** This is the dominant failure mode in this codebase — not tests that fail, tests that quietly stop asserting. **For every test, name the implementation it would reject. If the answer is "none", say so rather than padding the count.**

Today's review loop caught three defects that every passing suite missed, all three introduced by the *plan* rather than by an implementer:

- an ARIA `role="button"` does not get keyboard activation for free, so pressing Space on the focused join code **advanced the round**;
- a same-origin guard written as "reject anything starting `//`" is an **open redirect** — browsers normalise backslashes, so `/\evil.example/steal` passes it;
- the entire OAuth return-path fix was **dead code**: the destination was computed, logged and discarded because the route always passed an `onSuccess` that hardcoded `/`. Twelve passing tests on the module; nothing tested its only call site.

**Test the call site, not just the module.** All three above were invisible to unit tests of the units involved.

**`setupTests.js`'s `window.location` mock is a silent no-op** under jsdom 26 — `delete window.location` returns `false`, so the real `Location` survives, every assignment to `pathname`/`search` is an ignored navigation, and each suite emits a jsdom navigation error to its console. It is the **root cause of three of the five "stale" failing frontend suites** (`App`, `GameHostPage`, `PlayerPage`) that this handoff has been telling everyone not to fix. **They are not obsolete; they are broken by a harness bug.** Fixing it is cheap, makes routing testable, and retires a standing rule — but it moves the frontend baseline, so do it as its own change.

**jsdom has no layout engine.** Every geometric assertion returns zero and passes unconditionally. Nothing automated verifies the React app's geometry; verification is a human in a browser, at the projected size. When you verify, **vary the configuration, not just the state** — a walkthrough of every phase once missed a Critical because no measurement was taken with a side panel open.

**`GameHostPage` cannot be rendered in jsdom at all** — it dies on the auth provider. The established workaround is to extract the decision into a pure module and test that (`config/hostControls.js`, `config/anonymity.js`, `utils/hostOverlays.js`, `utils/qrOverlayClassName.js`). Two tests currently assert against `GameHostPage.jsx` **source text**; that technique is anchored between unique markers rather than matched file-wide, but treat it as a last resort.

**Parked, and worth closing in the console work:** `shortcutsSuppressed()` is extracted and tested, but deleting `qrMode` from its *call site* reinstates the defect with the whole suite green. Assert the argument, not just the call.

**`hostControlsFor` rewrites an unrecognised phase to `LOBBY`.** Adding a phase without adding it to `HOST_PHASES` produces something that looks like it works and renders the lobby.

**Pre-existing, unfixed:** `handlePlayerVote` builds `ROUND#` keys unpadded; `message.js` routing makes `handlePlayerMessage`'s `playerVoted` branch unreachable (`isHostMessage` matches `VOTE#` first); the positional ballot is stable only because the answer sort key ends in the author's name; no `reopen-round` endpoint, so a host who advances early cannot recover.

**Two `engagetest` migrations are unrun** — `cull-ai-prompts` and `migrate-set-versions`. Order matters and the obvious order destroys data. Both take `AWS_PROFILE=adminaccess node scripts/<name>.js engagetest [--apply]` and are dry-run by default.

**Do not delete the expanded-lesson modal.** Its premise expired: it is the recovery path for a dropped ASK prompt, which the fitter sacrifices on a dense round. Deleting it is a regression, and uncommitted deletions from an earlier session were discarded once already.

**`ArchiveManager.jsx` and `ArchiveSearch.jsx` are dead** — single-line escaped garbage, not valid JS, imported by nothing. Exclude them from sweeps.

## Design sets

Serve with `python3 -m http.server 8124 --directory docs/design` (there is a `.claude/launch.json` entry, `all-design-mockups`).

`host-redesign/` (21 mockups, the precedent the others follow) · `entry-redesign/` (17) · `admin-redesign/` (22, plus `INVENTORY.md`) · `player-redesign/` (23, the player's own device, which had never been designed).

Each carries a `RATIONALE.md` and an `OPEN-QUESTIONS.md`. The design agents were asked to argue back and did; several of their disagreements were correct and are worth reading before building from them.
