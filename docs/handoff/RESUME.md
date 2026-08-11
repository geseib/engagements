# Resume

> ## ⚠️ SUPERSEDED IN PART — read `docs/handoff/2026-08-11-session-handoff.md` FIRST.
>
> `dev` is now at **`91bf76c9`**, deployed. §2 (games list), §3's poll CSV bug, §5 (dead AI
> prompts), §10 (name collision + rejoin), §12's Tier 0 and §13 (the remote) are **DONE**, plus
> the `?role=host` access-code leak and the two player-state bugs reported after this file was
> written. The **Landmines** and **Deployment** sections below are still current and still the
> best part of this document. **One correction: the backend aggregation recipe in Baselines is
> wrong** — `grep -E '^[0-9]+ failed'` matches nothing, because the count is never line-initial.
> The replacement is in the newer handoff.

After `/clear`, paste the block below.

---

Read `docs/handoff/RESUME.md` in full before doing anything else. It is the whole state.

## The standing rule, before anything else

**The mockups in `docs/design/` ARE the design.** Specs and plans record decisions, defects and constraints; they do not re-draw a screen. Open them in a browser before writing UI code — reading the HTML source is not the same as seeing what it renders.

```bash
python3 -m http.server 8124 --directory docs/design
```

`.claude/launch.json` has `all-design-mockups` (8124). Four sets: `host-redesign/` (21, plus `CRITIQUE.md` + `USER-REVIEWS-2.md` — this set has **no** RATIONALE), `entry-redesign/` (17), `admin-redesign/` (22 + `INVENTORY.md`), `player-redesign/` (23). The other three carry `RATIONALE.md` and `OPEN-QUESTIONS.md`.

Silence in a mockup is **not** an instruction to delete — they routinely omit shipped behaviour that is correct.

---

## Where things stand

`dev` is at **`6a4ead84`**. Everything through `bbadaa59` is deployed to dev (`dev-v1.3.0`, `test-v1.3.0` on `1c561149`).

**Two days of work landed:** the five-stream host/entry programme, the 80s trivia set with its VJ persona, and Waves A–C plus half of D of the admin console.

### Deployed and verified in dev
- Root page carries both audiences; setup dialog extracted; one session panel replacing two side panels and two edge tabs; top three on the room's screen; the phone can push *What We Heard* to the projector; all seven auth surfaces rebuilt.
- **80s Trivia** — 100 questions, 8 categories, `quickstart: true`, persona `mtv-vjs` attached. Verified on the SETS row.

### Committed, NOT yet deployed
- `e6665458` the AI variable contract + renderer hardening
- `819bc7e1` the admin shell
- `6a4ead84` **the admin privilege-escalation fix** — see §1
- `b6929cac` tag-only pipelines — **committed and NOT applied**, see §8

---

## THE ORDER

### 1. The admin guard — READ THE CORRECTION BEFORE ACTING

> ## ⚠️ THERE IS NO PRIVILEGE-ESCALATION HOLE. A previous session said there was. It was wrong.
>
> `6a4ead84`'s commit message claims any signed-in account could promote itself to administrator. **That claim is false and is retracted by `df06859c`.**
>
> `CognitoAuthorizer` is **not** a Cognito JWT authorizer despite the name — it is a custom Lambda authorizer (`template-clean.yaml`: `FunctionArn: !GetAtt AuthorizerFunction.Arn`, payload 2.0, simple responses). `lambda-functions/auth/authorizer.js:103-105` already gates every `/admin/*` route to the `admins` group, with `path` stripped of its leading slash, and refuses a disabled user outright at `:141-144`.
>
> The misleading evidence was `manage-users.js`'s `// Skip authorization for now` comment plus the word "Cognito" in the authorizer's name. **Open `auth/authorizer.js` before believing any claim about this API's authorization.** Do not re-raise this.

**And the fix that claim produced would have broken production.** It read `event.requestContext.authorizer.jwt.claims['cognito:groups']` — a shape this API never produces. A simple-response Lambda authorizer puts context at `.authorizer.lambda` with groups **comma-joined into a string**. So `callerGroups()` returned `[]` for every caller including real admins, and the Users tab would have gone dark on deploy.

Reading the wrong shape here **fails closed**, which is why the tests missed it: they built `.jwt.claims` fixtures too. Eighteen green assertions against a fixture nothing generates. **The cleanest example in this repo of a test that proves nothing** — and it was written in the same session as the handoff warning about exactly that.

The expired SSO token is the only reason it reached review instead of dev and test. `dev-v1.3.1` / `test-v1.3.1` were staged locally and have been **deleted**; nothing was pushed.

**What the guard is now, and why keep it:** defence in depth. The upstream check routes by **string prefix** (`path.startsWith('admin')`), so a route mounted at a path that does not begin with `admin` — or one refactor of that single function — silently opens every handler behind it. A handler that knows its own requirement does not depend on how it was reached. It reads this API's real shape first, keeps the JWT shapes as fallbacks so a route later moved onto a native JWT authorizer does not lock out its admins, and `tests/admin-authorization.js` has 19 tests including the one that matters: **an admin can still list users.** Breaking the shape read turns five red.

**Priority: normal.** This ships with everything else. Nothing needs deploying urgently.

### 2. `GET /games` has no authorizer — and something worse behind it

**Plan: `docs/superpowers/plans/2026-08-11-games-list-authorization.md`.** This one IS real, and was verified against the authorizer rather than inferred from a name.

`get-games-list.js:12-31` is one unbounded query of the whole `GAMES` partition returning `gameId` (**which is the join code**), `title`, `hostName`, `gameType`, `questionSetId`, `createdAt`, `lastPlayedAt`, `started`, `visibility`. `AccessCode` is on the row and merely not mapped — luck, not design.

**Blast radius is one caller.** Exactly two call it: `GameHostPage.jsx:2906` (bare `fetch`, no token) and `SessionsPanel.jsx:68` (already `authFetch`). **No player-path caller** — `PlayerPage.jsx` and `RootPage.jsx` never do; `RootPage` makes one request in the whole file, the `GET /games/{code}` 404 check. `QuickstartMenu` uses `POST /games`, a different route.

**The trap that would make the fix look done while failing open:** `authorizer.js:110-114` returns `[]` required groups for `method === 'GET' && path.includes('games')`. Attaching `CognitoAuthorizer` **alone** would therefore admit any pool account including `pending`.

**Recommendation (Option A):** authorize the route, **and** add an exact-match `path === 'games'` branch to `requiredGroupsForRoute` returning `['hosts','admins']`, **and** change `fetch` → `authFetch` at `GameHostPage.jsx:2906`. Two commits in a fixed order — **frontend first**, because `buildspec-dev.yml:49-58` deploys the API before the frontend and cached bundles outlive the build.

**The regression to fear** is `startsWith('games')` instead of `===`, which would 401 every participant's session brief. A unit test asserting `GET /games/{gameId}` still returns `[]` is specified to catch exactly that.

**Three adjacent findings, raised separately and NOT fixed:**
1. **`GET /games/{id}?role=host` hands a private game's access code to anyone** (`get-game.js:72-79` — `role` is an unauthenticated query param). More serious than the list, and closing `/games` does not fix it.
2. **`POST /games` (create) is also public** (`template-clean.yaml:220-221`).
3. `PlayerPage.jsx:1354` calls `/admin/reports/{gameId}`, a route that does not exist in the template.

**Enumerability:** 4-digit ids, no throttling, WAF or `RouteSettings` anywhere in the template. The list turns `entry-redesign/OPEN-QUESTIONS.md` #6's 10,000-guess search into a published directory, and chains: list → every `gameId` → `?role=host` → `AccessCode` → join.

### 3. Question sets + the generation job

**Plan: `docs/superpowers/plans/2026-08-11-admin-question-sets-and-jobs.md`.** Split into zero-backend-now (G1–G6, Q1–Q6), needs-a-contract (B1–B3), and owner-decision (O1–O3), with a size-honesty section naming what exceeds "not a major uplift".

**A live bug worse than anything previously named, and it is zero-backend:** `generatePollCSV` emits `Option1..Option5` (`AdminPage.jsx:843,866`; `PollAIBuilder.jsx:136,143`) while `upload-questions.js:301-304` reads a single pipe-separated `Options` column with **no fallback**. **Every AI-generated poll set imports with zero options.** Fix is in the emitter.

**The headline defect:** a partial generation failure renders as a *success*. The root is `pollGenerationJob` **throwing** — the `Error` discards `completed`, `requested`, `warnings` and `phase`. It should resolve with the terminal job and throw only for transport failures. Note `failJob` writes items and `status:'error'` in one update and does **not** write `warnings`, so the failed screen's warning list comes only from the last progress write — copy must not promise completeness. `AIScenarioBuilder` reaches the same end state via `onProgress:457-461`, not `partialItems`.

**Two things the plan found that change its shape:**
- **The set editor is largely built.** `QuestionSetEditor.jsx` (850 lines) already is the detail place — Details/Questions/Versions/Media, replace preview, `interpretVersionDelete`. Mockup 04 is mostly done.
- **The prompt-picker fix already exists as a tested pure function**, `selectableSummaryPrompts()` at `utils/questionSetEditing.js:330`. The editor uses it; the upload form (`AdminPage.jsx:1406-1407`) does not. One-site change. **Do not "improve" it:** `summaryPromptStatus` returns `'unknown'` unless the fetch passes `includeContent=true`, so status must **annotate, never exclude** — that reasoning is already written down and test-asserted.

Also: a failed set delete is visually identical to a success (`questionSetDeleteStatus` set six times, rendered zero, modal closes regardless). **Nine** CSV serialisers across five files, not three, all with bare `"${value}"` interpolation.

**Constraints on the backend items:** B1 (delete consequence) is buildable **without a GSI** — the table has none, and `findGamesPinnedToVersion` already scans the `GAMES` partition — but the stored report carries a **30-day TTL**, so mockup 14's "Report already saved. Unaffected." is true for thirty days, not forever. B2 (cancel) needs more than an endpoint: **the worker never re-reads the job row**, so a flag would be invisible.

**Cut order if the slice must shrink:** G6 → Q5's tiers → G5.2. **G1–G4 and Q1–Q4 are the floor.**

`AdminPage.jsx` is **1,719** lines now — Sessions, Users and the set editor have already left it.

### 4. Design critics + a tester on the admin work, then deploy it

The owner's gate: *"when you are ready and have good feedback from design critics and a tester, deploy the Admin screen changes."* Waves A–C and half of D are committed and undeployed; §3 completes D.

`docs/design/admin-redesign/audit.js` is 6 assertions × 22 mockups × 2 viewports, and **every check was demonstrated failing before it was trusted**. Reuse it against the built screens.

### 5. Poll's AI prompt is still dead

Same defect fixed for trivia: the pointer at `PK=AIPROMPTS / SK=AIPROMPT#…` carries an `s3Key` whose object **does not exist**, and the record has no inline `template`/`instructions`, so `resolvePromptTemplate` returns null, `get-ai-summary` takes `buildFallback()`, and the round makes **no Bedrock call at all** — canned text, no error, nothing in the logs.

The bucket held bodies for call-and-answer and wavelength only. One repeat of:

```bash
AWS_PROFILE=adminaccess node scripts/install-ai-prompt.js engagedev engagedev-ai-prompts <file.json> --apply
```

`sets/prompt-trivia-vj.json` is the model to copy. The script verifies **both halves** landed, because a pointer without a body is exactly this failure.

### 6-8. Owner decisions — more information needed

See §"Decisions, with the information to make them" below. **The owner has asked for more detail on all three.**

### 9. Auto-submit on the fourth digit — **DECLINED**

The owner does not want it. `entry-redesign/RATIONALE.md` §5 specifies it and `01-root.html`'s own script does not; the mockup's behaviour (a Join button) is what shipped and stays. **Do not re-raise this.**

### 10. The two live session-corrupting defects

- **Two players with the same name silently merge.** `join-game.js` keys players by `PLAYER#{playerName}` and returns `isReconnection: true`. The second Chris inherits the first Chris's answers and score, with no warning. `07-join-name-collision.html` is designed; it needs a name-availability check that does not expose the roster.
- **Rejoin never contacts the server** — `handleRejoinConfirm` sets `joined = true` locally and nothing else.

### 11. Wavelength scoring

**Spec written:** `docs/superpowers/specs/2026-08-09-wavelength-convergence-design.md`. Every decision made; needs a plan and a crew.

Wavelength measures **how many words match across the whole team**, not player performance — `totalScore: 0` is *correct*. A word counts only when **everyone who submitted** said it; ten words asked for, fewer accepted; **conservative automatic AI clustering**, no host review; **no team-splitting** — the product just says *works best with groups of ten or less*.

**The setup screen's group-size caveat ships WITH this, not before it.** Writing the copy does not make the rule true. `get-ai-summary.js:866` references an undeclared `commonWords` in the wavelength pass — a runtime `ReferenceError` any wavelength work lands on top of.

### 12. The ENDED screen — Tiers 0, 2, 3

`docs/superpowers/reviews/2026-08-09-ended-screen-review.md`. Tier 1 (the podium) and the sort fix shipped. Remaining:

- **Tier 0, and the highest-value item in that document because it is a deletion.** `participationRate` and `votingParticipation` (`get-ai-summary.js:1511`, `:1599`) are interpolated into the **live prompt**, so the model is told every round had 100% participation — and hosts read those summaries aloud. You only count rounds that happened, so the figure can only ever read 100%.
- **Tier 0.** `gameStats.totalPlayers` (`create-report.js:115`) counts `PLAYER#`, `#SCORE` and `#STATE` rows together. Use the `uniquePlayers` set already built at `:512`.
- **The participation sentence** — *"34 of 40 people took part"* needs one server-computed count of distinct answerers that does not exist. **If only one thing ships, ship this.**
- Tier 2 (AI session summary), Tier 3 (wavelength's unison band).

### 13. The remote's unbuilt half

`17-remote.html` draws and `HostRemote.jsx` lacks: a `This round` block (`Choose next question`, `Expand on stage`, `Timer 2:00`, `Skip round`), a `Session` block (`Categories`, `Join code`, `Session report`, `Switch game`), and a **full phone question browser including the correct answer** — which is right: *the stage browser shows what a question is about, the remote shows what it says*.

`09-field-notes.html` also draws a `‹ Results` secondary that walks the beat backwards. The server and `stage-beat.js` support `beat: 'results'` both ways and it is tested; no stage control calls it. **The timer exists nowhere in the product** — it is a new feature, not a control to add.

### 14. Auth screens — the remainder

Shipped in `bbadaa59`. Left: **~350 lines of dead legacy CSS in `auth.css`**, kept deliberately because `OAuthCallback.jsx`, `PrivacyPolicyPage.jsx` and `TermsOfServicePage.jsx` still import it and names like `.form-group` are shared with a dozen components. *(A background task was spawned for this — check whether it landed.)*

Narrow residual: `passwordPolicy.js`'s symbol test is `/[^A-Za-z0-9]/`, which accepts non-ASCII (`é`, emoji) that Cognito may not count — a password can pass the browser and be refused by the server. Fails in the safe direction.

### 15. Admin — still parked

- **Archive** — blocked on §"Archive auth" below. *"No UI fixes it."*
- **Prompts as a merged library** — blocked on `POST /admin/ai-prompts/save` aliasing create, so **editing a generation prompt duplicates the record** rather than updating it.
- **The `/builder` route** — the designers cut it deliberately.
- **Survey** — cannot be played; `upload-questions.js` rejects survey uploads outright, so no survey set can exist. The picker holds it behind `UNPLAYABLE_GAME_TYPES` in `config/gameTypes.js` with the reason in a comment — **when upload lands, removing that entry is the whole fix.**

---

## Decisions, with the information to make them

### 6. Confirm-password was removed from three forms

**What changed:** register, reset and change each had a confirm-password field. The `entry-redesign` mockups draw **one** field with a Show toggle, so that is what shipped in `bbadaa59`.

**The risk, stated plainly:** a typo at registration now creates an account with a password the person cannot reproduce. Recovery is the forgot-password flow, which works — but they must first discover they cannot log in. The Show toggle is the only thing standing in the way, and on a shared or projected screen people do not use it.

**Against restoring it:** confirm fields measurably increase abandonment, and people paste into both. The mockup's reasoning is that a visible field beats a second blind one.

**Cost either way:** small. One field per form, and the password component is now shared (`auth/PasswordField.jsx`), so it is one change in one place.

**No default — the owner asked for information, not a recommendation.** If undecided, note that registration is the only one with real consequence; reset and change are recoverable by repeating the flow.

### 7. The parallax hero

**What it was:** three `.webp` layers fetched from `cdn.prod.website-files.com` (a Webflow tenant), occupying ~250px of the fold on the admin page, with the title, user name, Host link and Sign Out absolutely positioned on top in inline styles.

**What happened:** the admin designers cut it and **asked to be told they are wrong** — between the host and admin redesigns the product loses its whole visual signature in one week. `AdminShell` takes a `hero` node; `AdminPage` currently passes none. **Two tests hold both sides open**: one rejects hardcoding the images back, one rejects deleting the slot.

**The three real options:**
1. **Leave it absent.** Cheapest. The console is denser and faster, and loses the signature.
2. **Restore the Webflow images.** Restores the look exactly. Keeps a hard runtime dependency on a third-party CDN nobody here controls, on a console only reachable behind Cognito.
3. **Locally-hosted or generated signature.** The product's own `Ridge` component and `--summit-sky` treatment are already in `styles.css` and cost no network. Keeps the signature, kills the dependency. Small piece of work.

**Recommendation on record: option 3.** The dependency is the problem, not the idea. Restoring is passing a node at one call site.

**Note this also applies to the host page** — the same block was removed there, so whatever is decided should be decided once for both.

### 8. Tag-only pipelines

**What `b6929cac` does:** removes the `- Branches:` entry from all three `Triggers` blocks in `cicd/pipeline-clean.yaml`, leaving only `- Tags:`. After it, `git push origin dev` is **just a push** and only a `<tier>-v*` tag deploys.

**Why it matters:** today both triggers are live, so a branch push *is* a deploy. That is why `origin/dev` spent a week 22 commits behind a branch whose code was already live via tags — work was held back to avoid deploying, which then blocked every unrelated fix on it. Pushing a branch **and** its tag fires two executions of the same commit, racing into the same stack.

**Why it is not applied:** the template is a file; the running pipelines only change when someone runs

```bash
aws cloudformation deploy --template-file cicd/pipeline-clean.yaml --stack-name engagecicd --capabilities CAPABILITY_NAMED_IAM
```

That mutates CI/CD infrastructure, and `CLAUDE.md` reserves deploys to the owner.

**The bootstrap question that had this parked is ANSWERED:** `engagecicd` is not deployed by any pipeline — `SECURE_DEPLOYMENT_QUICKSTART.md:20` applies it by hand. So tag-only survives its own bootstrap; there is no chicken-and-egg.

**What changes for the owner:** pushing a branch becomes safe (share, back up, review without shipping), and every deploy acquires a name you can point at in the execution history. `prod-v*` still halts at `ApprovalForProd` either way.

**To check which rule is in force at any moment:**
```bash
aws codepipeline get-pipeline --name engagecicd-pipeline-dev --query 'pipeline.triggers'
```

### Archive auth — unchanged and still open

`GET https://archive.seibtribe.us/archive/items` returns 200 unauthenticated and CORS advertises `DELETE` with `Origin: *`. `ArchivePanel.jsx` hardcodes that URL **six times** with plain `fetch`, no auth, including DELETE. The service is **not in this repo** and fixing it needs a deploy outside the pipeline. The designer marked the Archive mockup *provisional* and refused to draw a delete button on it.

---

## Deployment — a tag is the deploy

```
push tag dev-v*    → engagecicd-pipeline-dev   → engagedev   (auto)
push tag test-v*   → engagecicd-pipeline-test  → engagetest  (auto)
push tag prod-v*   → engagecicd-pipeline-prod  → engageprod  (halts at ApprovalForProd)
```

- **Until `b6929cac` is applied, a BRANCH PUSH ALSO DEPLOYS.** Confirm with the `get-pipeline` command above before assuming either rule.
- Push the branch **or** the tag, never both — two executions of one commit.
- `BranchName` in each Source action is **not** a trigger; it is the revision a manually-started "Release change" pulls.
- Never run `./deployall`, `./scripts/deploy-clean.sh` or `./scripts/deploy-frontend-eng.sh` — they target the off-pipeline `engdev` stack.
- **Committing locally is authorised.** Pushing a `*-v*` tag is the deploy and needs the owner; prod needs checking first.
- The execution history is the only reliable record of what is deployed:

```bash
AWS_PROFILE=adminaccess aws codepipeline list-pipeline-executions --pipeline-name engagecicd-pipeline-dev --max-items 5 --query "pipelineExecutionSummaries[].{status:status,rev:sourceRevisions[0].revisionId}" --output table
```

**Beware `--output text` on a scalar query** — it appends a pagination `None` on a second line, so `[ "$s" != "InProgress" ]` is true while the run is still going. That produced one false "finished" reading. Use `--output table`, or `stageStates[?stageName=='DeployDev'].latestExecution.status | [0]`.

---

## Baselines

| Suite | Command | Expected |
|---|---|---|
| Backend | `for t in tests/*.js; do node "$t"; done` | **32 suites, 1067 passed, 0 failed** |
| Frontend | `cd src && npx jest __tests__/` | 5 failed suites / 30 failed / **922 passed** |
| Build | `cd src && npm run build` | compiles, 2 pre-existing size warnings |
| Template | `sam validate --lint -t template-clean.yaml` | valid |

Aggregate the backend with `grep -E '^[0-9]+ passed'`, **never** `tail -1`, **and assert the suite count** — a crashed suite prints no result line, so a grep aggregate silently drops it and reports "0 failed". The ten `tests/*.spec.js` are Playwright and legitimately print nothing.

**Anchor the failure grep too, and this bites in the opposite direction.** An unanchored `[0-9]+ failed` matches fixture output *inside a passing suite* — e.g. `❌ Job msogtpgm8muztwr6 failed: Bedrock is having a day`, an intentional error-path fixture — and reports failures that do not exist. One agent lost time to a phantom "6 failed" from exactly this. Use `^[0-9]+ failed`.

The five failing frontend suites are `AdminPage`, `App`, `GameHostPage`, `PlayerPage`, `WebSocketClient`. **Three are broken by a harness bug, not obsolete** — see Landmines. `AdminPage.test.jsx` fails 8/8 on `useAuth must be used within an AuthProvider` and has forever.

---

## Landmines

**Tests that look like coverage and assert nothing.** The dominant failure mode here. **For every test, name the implementation it would reject; if the answer is "none", say so.** Better: break the implementation and watch it fail. Caught doing exactly nothing in the last two days — a focus-trap test that passed with the trap deleted (jsdom has no default Tab), a mount assertion that matched a renamed element, a source assertion that passed **on a comment**, a `waitFor` on an absence that passed before the promise settled, a `forEach` over an empty list, and three tests that never reached their code at all because of the location mock below.

**`setupTests.js`'s `window.location` mock is a silent no-op** under jsdom 26 — `delete window.location` returns `false`, the real `Location` survives, and every assignment to `pathname`/`search` is an ignored navigation. Root cause of three of the five failing suites. **They are not obsolete; they are broken by a harness bug.** Use `window.history.pushState` to move the browser and `auth/navigate.js`'s `navigateTo` for destinations. Fixing the mock moves the baseline — its own change.

**Assert against a fixture the system ACTUALLY PRODUCES.** The sharpest example is one day old: 18 tests for the admin guard built `event.requestContext.authorizer.jwt.claims` events, a shape this API never generates — it uses a simple-response Lambda authorizer whose context lands at `.authorizer.lambda`. Every test passed against a guard that would have 403'd every real administrator. Before trusting an event-shaped fixture, **find the code that emits it** (`auth/authorizer.js:156-166` here) and copy that.

**Verify a claim against the mechanism, not the name.** `CognitoAuthorizer` is a custom Lambda authorizer. A whole phantom vulnerability was reported, committed and nearly deployed because nobody opened the file behind the name.

**Test the call site, not just the module.** `shortcutsSuppressed()` is the standing example: extracted and tested, but deleting an argument from its *call site* reinstates the defect with the whole suite green. `hostOverlays.test.js` now parses the call-site argument object.

**jsdom has no layout engine.** Every geometric assertion returns zero and passes unconditionally. Verification is a human in a browser, at the projected size, **varying the configuration and not just the state**.

**`GameHostPage` and `AdminPage` cannot be rendered in jsdom at all** — both die on the auth provider. The workaround now has **six** precedents: extract the surface into a component that CAN be rendered — `GameSetupDialog`, `SessionSetupPanel`, `Podium`, `WelcomeScreen`, `AdminShell`, `SessionsPanel`.

**The AI prompt split is a two-store contract and nothing reconciles it.** A pointer in DynamoDB, a body in S3. A pointer with a missing body is not a loud failure — the summary lambda falls to `buildFallback()` and the round makes no Bedrock call, silently. Use `scripts/install-ai-prompt.js`, which verifies both halves.

**`ttl` is for SESSION data only** — see `docs/02-data-model.md`. TTL is table-wide, so the attribute is the only thing between a record and deletion. Prompt writers used to stamp `now+365d`, and DynamoDB was silently deleting prompts and personas a year later. Verified clear on both tables 2026-08-10.

**`.gitignore`'s `*token*` / `*secret*` / `*credentials*` are unanchored** and were eating source files — a test named `adminShellTokens.test.js` ran, passed locally and was invisible to git. Source extensions are now exempted; data files are still caught. Check `git check-ignore -v <path>` if a file mysteriously will not stage.

**The `resultsBeat` reset effect is fragile on purpose and has already cost one live defect.** Any change that moves one of its deps *without the round moving* knocks the stage back to the tally. The server beat is stamped with the game state it was read for and honoured only while they match — do not reduce it to a bare value, and do not add a re-sync to the `stageBeatChanged` handler.

**`hostControlsFor` rewrites an unrecognised phase to `LOBBY`** — a phase missing from `HOST_PHASES` renders the lobby and looks like it works.

**Do not delete the expanded-lesson modal** — it is the recovery path for a dropped ASK prompt, which the fitter sacrifices on a dense round.

**Pre-existing, unfixed:** `handlePlayerVote` builds `ROUND#` keys unpadded; `message.js` routing makes `handlePlayerMessage`'s `playerVoted` branch unreachable; the positional ballot is stable only because the answer sort key ends in the author's name; no `reopen-round` endpoint, so a host who advances early cannot recover; `setGameState('voting')` maps to LOBBY, so the stage renders the lobby for the duration of the `start-vote` round-trip on every call-and-answer round.

**Two `engagetest` migrations are unrun** — `cull-ai-prompts` and `migrate-set-versions`. Order matters and the obvious order destroys data. Both are `AWS_PROFILE=adminaccess node scripts/<name>.js engagetest [--apply]`, dry-run by default. The urgent `ttl` pass is already effectively done on both tables.

**`ArchiveManager.jsx` and `ArchiveSearch.jsx` are dead** — the first imports two modules that do not exist, the second is 15KB of escaped one-liner that is not valid JS. Exclude from sweeps.

**Orphaned CSS** remains after the panel deletion (`.qr-content`, `.qr-controls`, `.host-roster`, `.question-browser-*`) and after the admin shell (`.tab-content`, `.tab-btn` in `BuilderPage.css`). `AdminPage.jsx` still imports `BuilderPage.css` because the tab internals depend on it.

**`@aws-sdk/client-s3` is required by admin lambdas and NOT in `lambda-functions/package.json`** — it works only because the Lambda Node 22 runtime bundles SDK v3. Local scripts need `npm install --no-save --prefix lambda-functions @aws-sdk/client-s3`.

---

## Owed: a human in a browser

None of this can be asserted in jsdom and none has been checked:

- **A dense revealed RESULTS with the podium** — `07-results-trivia.html` already renders `--fit: 0.55` with `data-clamped="on"` at 1280×720 *before* a podium exists.
- **The 80s quiz played end to end**, and whether the VJs' banter reads well on a projector.
- **Contrast at all four display profiles** for the session panel.
- **The remote QR at 160–180px** from arm's length on a real phone, then the beat round-trip both ways.
- **A clicker pass** — `Space`/`→` advance and `←` step back with the panel open and closed, since a clicker sends keys with no meaningful `event.target`.
- **The admin console signed in** — every agent so far has been blocked by the sign-in wall and none entered credentials.

## Scripts worth knowing

| | |
|---|---|
| `scripts/install-question-set.js` | Installs a CSV set by invoking the **real** `upload-questions` handler in-process. Dry-run by default. `--persona` and `--quickstart` are applied after, because the importer writes neither. |
| `scripts/install-ai-prompt.js` | Installs a prompt by invoking the **real** `create-ai-prompt` handler. Verifies **both** halves landed. |
| `scripts/seed-personas.js` | Seeds `SEED_PERSONAS` from `lambda-functions/game/personas.js`. Never overwrites without `--overwrite`. |
| `scripts/cull-ai-prompts.js` | Four passes; `--only=ttl` is the urgent one. |
| `scripts/migrate-set-versions.js` | Copies; legacy rows stay, so rollback needs no restore. |

All take `<table>` and are dry-run until `--apply`.
