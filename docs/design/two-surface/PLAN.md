# Two surfaces: implementation plan

**For:** `docs/design/two-surface/PLAN.md`. **Branch:** `working/build-room-host-redesign` at `c8c62e85`.
**Inputs:** `two-surface/NOTES.md`, which was approved 2026-10-12 together with the owner's ruling on the navigator during voting, and `prototype.html`. Also `simplify-round/` (PRINCIPLES R1–R10, AUDIT, CHANGES), `remote-parity/NOTES.md` and `ca-followup-asks/` (SPEC, PLAN).
**Status:** none of `simplify-round` is built yet. `config/roundStep.js` and `config/roundWords.js` do not exist. The follow-up asks backend is on dev up to PLAN Phase 3 plus T12, which is next-question closing a live ask. T1 (the `ask` beat) and T19 (the report) are not built.

Paths are relative to the repo root. `src/src/` is the frontend. "GHP" means `src/src/GameHostPage.jsx` (8,211 lines).

---

## 0. Shape of the work

| # | Phase | What the owner can test on dev afterwards | Template / resources |
|---|---|---|---|
| 1 | **Shared foundations.** `roundWords.js`, `roundStep()`, a parity test across the host page and the Remote. The server now holds Workie's page, the response part and the voting-order focus, and returns them from get-game-state. A counts-only "room view" of the public reads. | Same labels on host page and Remote. The Remote can page through Workie's read. The read is never skipped by accident. The Remote's ENDED screen has a button. | **0**: code only, on existing functions |
| 2 | **Presentation** `/present?gameId=`. A 16:9 canvas that never scrolls. It follows server facts, reconnects, and covers four profiles, every moment, the navigator (including VOTE mode) and the measured pages. The **Present** button replaces **Big screen** (flagged). | Open Present on a second screen and run a round from the old host page or the Remote. The wall follows. | **0**: websocket `connect.js` and two read handlers, code only |
| 3 | **Dashboard.** The host page reshaped behind the flag: preview, next step, responses table with Show, read pages, people and name verbs, question fold, arm-to-confirm, Session menu. | Run a whole round from the laptop with the projector on Present. | **0** |
| 4 | **Remote** rebuilt from the Dashboard's pieces (narrow skin, Session sheet). | The same round from a phone. Same words, same order, same taps. | **0** |
| 5 | **Ask the room**: Dashboard column, Remote sheet, presentation moments, phone card, report, participant "now" lines. | After the read, send a question to the room, show its results, see it in the report. | **0**: existing `/followups/{proxy+}` and `/followup-play/{proxy+}` |
| 6 | **Host notes and cleanup.** Host notes route, retire Big screen, `postMessage`, the spotlight overlay, the in-page Stage for supported types, then the flag. | Add a note from the fold; it appears in the report. The old paths are gone. | **+1 HttpApi event** on the comments function (count first) |

Changes from the suggested order, with reasons:

- **Name verbs move from Phase 6 into Phases 3–4.** The Dashboard's people panel and the Remote's Session › People are the screens those verbs live on (CHANGES step 8, R4). Building the panels without the verb table means building them twice. Phase 6 keeps only the host-notes route, which needs a template change, plus the deletions.
- **Workie's page as a server fact and the response focus/part move into Phase 1** (remote-parity B, CHANGES steps 6–7). The presentation cannot exist without them, and they give the owner the "Remote pages the read" fix in the first shipment.
- **The arm-to-confirm pattern** (CHANGES step 5) and the **green ring and safe automatic advances** (step 12) land with the Dashboard dock in Phase 3, because they replace `ConfirmDialog` calls inside GHP.
- **Participants' "now" line** (CHANGES step 10) lands in Phase 5, next to the phone's follow-up card that R8 is about.
- **Scope is Call & Answer first.** `roundStep()` covers every round type in Phase 1, and the parity test runs over all of them. The Presentation, Dashboard and new Remote are switched on per game type, starting with `call-and-answer`. Trivia and poll follow as Phase 7, using the same parts plus `PollBoard` and trivia options. Surveys, Wavelength, Build Room and events stay on their current pages.

---

## 1. Binding rules for every phase

- **Tests first.** Each task's test fails for the right reason before any code is written.
  - Frontend: `cd src && npm test -- <pattern> && npm run lint && npm run build`, on **Node 18**. No `Object.groupBy`, `Array.prototype.toSorted` or other APIs newer than Node 18.
  - Backend: `node tests/<file>.js`, judged by exit code. Async suites arm `tests/helpers/finish-guard.js`.
  - Any frontend change also runs every `tests/*.js`, because several backend tests read frontend source.
- **Never `npm install` in the worktree.** The pipeline is the only deploy route. The main session pushes `dev` after the suites, lint and build pass, and names the commit.
- **One orange per screen** (R3). The Presentation has **none**: no `var(--primary)` anywhere in its stylesheet. A pressed toggle is blue `--secondary` with `aria-pressed`. `--danger` never carries text; use `--danger-text`.
- **Words.**
  - Plain, sentence case, no exclamation marks, no emoji.
  - Every round label comes from `config/roundWords.js` (R6).
  - Say "phone, laptop or tablet" when the copy is about the room's devices.
- **Warm Summit** (`.claude/skills/engage-design`).
  - One stylesheet per surface, scoped: `.present`, `.dash`, the existing `.hr`.
  - Declare `data-theme` on the root. Colour comes from tokens only.
  - Add a `*Palette.test.js` per stylesheet. Never name a test file `*token*` (`.gitignore` swallows it).
  - Laptop ladder 12/13/15/19/24/30. Stage ladders only inside `.present`.
  - Every dialog and sheet is **measured at 660 px and 375 px** (bounding rect against `innerWidth`) and has an X plus a bottom exit through one `requestClose()`.
- **Names and anonymity.** Requests that name a person never reach the Presentation (R9). The VOTE navigator **never** shows a name, points, rank or vote count, whatever the round's names setting.
- **Data.**
  - Every new DynamoDB attribute goes on a row that already carries the session TTL: ROUND# uses `if_not_exists(#ttl)`, and STATE carries the session ttl. Every new row type carries `ttl`.
  - Org content is sealed with `tenant-crypto`. The new stage facts are integers and enums with no org content; a test asserts this.
  - Query only, never Scan.
- **Guarded-identical copies** are edited together in one commit, and their drift tests are extended:
  - `stage-beats.js` ↔ `STAGE_BEATS`
  - `answer-order.js` ×2
  - `session-ttl.js` ×2
  - `tenant-crypto.js` ×3
  - `comment-keys.js` ↔ `src/src/config/comments.js`
  - the new `FOCUS_PHASES`, mirrored in `config/stageFocus.js`

---

## 2. Decisions and risks

### D1. How the Presentation fits, and who publishes the counts

There are three facts, each with one owner:

| Fact | Owner | Agreement |
|---|---|---|
| **Shape**: how many parts a response splits into; how many pages each read section splits into | **Measured once by a signed-in surface** and stored on the server | Every surface reads the stored number |
| **Slices**: which sentences are in part 2, which bullets are on page 3 | A **pure function of the shape**: `splitEven(sentences, k)` and `splitEven(blocks, k)`, as in the prototype's `splitEven` | Identical everywhere by construction |
| **Size**: the shrink within the profile's `--fit-min` | **Local to each screen**, measured in its own DOM | No agreement needed |

How measurement works:

- The Presentation renders a **fixed 1920×1080 logical canvas**, scaled with `transform: scale()` to the window.
- The profile ladders are restated as **px literals resolved at 1080 px** on `.present[data-profile=…]`. This follows the precedent of `.stage-ladder-table` (`styles/stage.css`, `__tests__/stageLadderScope.test.js`). There are no `vh` units inside the canvas.
- Fonts are web fonts (Inter and Archivo from Google Fonts). So the same component measures the same in any browser, up to sub-pixel differences.
- `PresentMeasurer`, a hidden off-screen canvas of the same component, runs on **signed-in surfaces only**: the host page or Dashboard, and the Remote. It runs after `document.fonts.ready`. It decides `k` with a **6 % margin** (split when content exceeds 94 % of the box), so a sub-pixel difference elsewhere is absorbed by the local shrink, not by a different split.
- The measurer publishes `parts` with the Show press (`/stage-focus`) and the read's `plan` (`/stage-beat`).

Why not NOTES Q12's recommendation (the Presentation publishes the count back): the Presentation is unauthenticated (D3). Publishing from it needs either a public write grant on a route that moves the room, or a new Presentation-key mechanism plus a public route. The first goes against the reasoning in `stage-beat.js`'s header ("THE BEAT IS A WRITE GRANT"). The second costs template resources.

What the Presentation does in edge cases:

- **No published shape yet** (nobody signed in has measured): it computes `k` locally for display only.
- **A slice still overflows at `--fit-min`:** drop the optional block (Background), then shrink to the profile's `--floor`, then mark `data-fit="miss"`. It never scrolls and never clips silently. A dev-only `?fitcheck=1` view lists every miss.

Workie's read: pages are the read's sections, in the recommended order (Q4 below). `plan` is `[k₁…kₙ]`, the number of pages per section. `pages = Σk`. A `planKey` (a hash of the summary's `updatedAt` and the profile) discards a stale plan.

### D2. The profile becomes a session fact

Today the profile is per browser (`config/displayProfile.js`, localStorage). The measurer and the wall have to agree on it, so it moves to `STATE.StageProfile`. It is set in Session › Settings › Display on the Dashboard or Remote, and returned by get-game-state. The Presentation offers no picker. The old host page keeps its local choice when the flag is off.

### D3. Presentation auth: none for display, optional for keys

- **Display reads public routes only:** `GET /state?view=room`, `GET /answers?view=room`, `POST /games/get-results` (read route), `GET /ai-summary`, `GET /followup-play/live?view=room`, and `GET /players` for the scoreboard overlay only.
- **No new disclosure.** Each of those is already readable by anyone holding the four-digit code.
- **What the room view adds:** `roomCounts` (counts only) and a forced name redaction on `/answers` during VOTE.
- **Verified leak points that the plan closes:**
  1. Public `/answers` during VOTE returns `playerName`/`name` on a round that is not hidden (`get-answers.js:221-232`, `:271`). `view=room` strips them on the server whatever the round's setting.
  2. The progress blocks with `answererIds` and `votersIds` live inside the host branch of `get-game-state.js` (`:506-700`). The new `roomCounts` must never copy the id lists.
- **Keys and clicker** (the one-screen fallback). They work only when the browser holding the Presentation is signed in as a host who may drive the session; the server enforces this through `callerMayDriveSession` on the existing routes. Only `src/src/present/presentControls.js` may import `authFetch`. The display modules may not, which a static import test holds. Unsigned, the keys do nothing and no strip appears.
- **Frames are refetch signals only.** The Presentation ignores every frame payload except `type` and round number, and refetches the public reads.

### D4. Several Presentations open at once

All of them follow; there is no leader. The problem is `websocket/connect.js:70-90`: its dedup deletes older `PLAYER` rows with the same `PlayerName`. Every name-less socket is `PlayerName: null`, so a second Presentation evicts the first, which then goes silent while showing "connected".

Fix in Phase 2: a viewer connection.

- The socket connects with `viewer=present&viewerId=<uuid per tab>`.
- The row stays `ConnectionType: 'PLAYER'`, so every public broadcast still reaches it. It gains `Viewer: 'present'` and `ViewerId`.
- Dedup filters on `ViewerId` for viewers. Non-viewer dedup adds `attribute_not_exists(ViewerId)`.
- The host door of get-game-state adds `presenting: <count of viewer rows>`. This drives "Presenting on screen 2" and the lobby's "Present first" primary.

### D5. The VOTE navigator (owner ruling)

- `/stage-focus` accepts `focus:'answer'` during VOTE.
- **The server stamps `StageFocusPhase` from STATE.** The client cannot claim it.
- During VOTE the index is the **display position** (the `answer-order.js` shuffle, which public `/answers` already returns), so "Response 3" matches every ballot.
- During RESULTS the index is **tally order** via `assignPlacements` (`config/podium.js`); ties fall back to display order.
- get-game-state returns a focus only when its stamped phase equals the current phase. A legacy row with no stamp reads as RESULTS. So a VOTE focus on display position 3 can never become tally rank 4, a named response, after Show results.
- The Presentation's VOTE card shows "Response 6 · name hidden", with mini cards showing the number and first words. There are no points and no track counts other than "Response 6 of 8".

**Suspected existing mismatch, to verify in task 1.13:** the Remote's focus list loads `/answers/host` (display order, `HostRemote.jsx:626`). The host page's spotlight indexes its own tally-ordered rows (`GHP:4595`, `assignPlacements`). At RESULTS, "Show response 2" on the Remote may put a different response on the wall. `config/navigatorOrder.js` fixes this by giving one definition to both.

### D6. The transition: flag, dev only first

- Add `src/src/config/surfaces.js` with `twoSurfacesOn({ env: window.ENV, search, storage, gameType })`.
  - **On by default when `window.ENV === 'development'`**, and only for supported game types (C&A first).
  - `?surfaces=two|classic` overrides it and is remembered per browser, so the owner can try it on test without a deploy flag.
- `/present` itself is live on every tier from Phase 2. It is read-only and has no button pointing to it unless the flag is on.
- With the flag off, GHP and HostRemote behave as today except for Phase 1's shared fixes, which are deliberate improvements on every tier: words, roundStep, Workie paging, notes-ready.
- Ask the room UI is gated by **both** the flag and `FOLLOWUP_ASKS_ENABLED`. The backend's flag answers 404 when off; the UI treats 404 as "not offered".

### D7. Keyboard and clicker

| Surface | Primary | Back | Other |
|---|---|---|---|
| Dashboard | Space / → / PageDown | ← / PageUp | Esc = stop showing, cancel or disarm; `\` = Session (existing) |
| Presentation (signed in only) | Space / → / PageDown | ← / PageUp | F = full screen (`hooks/useFullscreenKey.js`) |

- Moving the mouse on the Presentation shows the status/secondary/primary strip for 3 s, only when signed in.
- Debounce is 250 ms per key, so a clicker's double pulse is one press.
- The arm pattern makes an early advance two presses on every surface. The Presentation's strip shows the armed text.
- Keys never act while a text field has focus (`pageIntentFor` already does this in `config/stagePaging.js`).

### D8. Who runs Auto

Auto stays in the Dashboard (GHP's timer, `GHP:5645-5716`). The Remote and Presentation never run it. `alwaysAuto` (R5) rows are server-driven or safe from any surface.

Risk: two Dashboards open with Auto on. Mitigation: next-question is already idempotent on the round. Write it down; no lock.

### D9. Other risks

| Risk | Mitigation |
|---|---|
| A measurer and a stale `plan` after the read is regenerated | `planKey` includes the summary's `updatedAt`; readers ignore a plan with another key |
| Two Dashboards or a Dashboard plus Remote stepping at once | Server `rev` (`ADD … :one`); frames apply only if `rev` is newer; steps are relative to the stored page (remote-parity §2 risks) |
| Load from the Presentation polling | Socket first. Poll `/state?view=room` every 3 s only in ANSWERING and VOTING (progress frames are host-only), 10 s otherwise. Debounce refetches by 400 ms. `roomCounts` is computed only for `view=room` |
| Owner sees old and new together during Phases 2–3 | Phase 2 swaps GHP's FIELD_NOTES block for the shared `ReadPage` (flag on), so laptop and wall show the same page |
| Label case change (Start Voting → Start voting) breaks many existing tests | Expected. Phase 1 updates `hostControls.test.js`, `hostRemote*.test.*`, dock tests and any backend test reading those strings, in the same commit as `roundWords.js` |
| GHP is 8k lines | Phase 3 replaces only the render tree under the flag; state, socket, handlers, Auto and SessionSetupPanel stay. Classic code is deleted in Phase 6, not before |

### Open questions in NOTES.md: working assumptions

These are taken as approved unless the owner says otherwise.

1. **Default setup:** (a) Dashboard plus Present. The lobby's primary is **Present** until `presenting > 0`, then **Start round 1**. A session may start without a Presentation; the status says "Not presenting".
2. **One screen, no phone:** keys plus the 3 s strip (signed in). The lobby says "For one screen, use your phone as the remote", with its QR on the Dashboard, never on the wall.
3. **Navigator order:** tally order in RESULTS. In VOTE it is the voting order, per the ruling.
4. **Read page order:** what was said, how the room voted, next steps, **discussion topics last**. Sections are matched by heading through a small map in `present/readPlan.js`; an unknown heading keeps its place.
5. **Smallest response text:** the profile's secondary size (Room 40 px at 1080), then parts.
6. **Background on the wall:** shown, dropped first when space runs out, hidden when the set marks it private. The author's private Background note for Workie is a different field: host branch only, shown in the Dashboard/Remote fold. NOTES §8 lists it in the approved fold; this reverses the 2026-09-25 decision for the session's host only.
7. **Who has not answered:** shown on the Dashboard (host only); counts only on the wall. The Dashboard's dock line follows CHANGES Q17: names only when the round allows.
8. **Presentation sign-in:** none (D3).
9. **Window Management API:** progressive, Phase 3. Phase 2 ships the plain link and the hint.
10. **Show results when everyone has answered a room question:** automatic only with Auto on.
11. **Superseded by the ruling** (D5).
12. **Part as a server fact:** yes, on `/stage-focus`. Published by the signed-in measurer, not the Presentation (D1).

New assumptions:

- During VOTE the Dashboard's response list also hides names (numbers and first words). This matches the wall and protects setup (c), where the host shares a window and might share the wrong one.
- The Scoreboard overlay follows `STATE.Scoreboard` on the Presentation, with the existing `standingsVisible` rule.

---

## Phase 1: Shared foundations

**Goal:** one decision function and one words file, read by the existing host page and the existing Remote, plus every server fact the Presentation needs. The Remote learns to page Workie's read.

### Frontend: words and the decision function

**1.1 `src/src/config/roundWords.js` (new)**

- Every label, status and participant line for a round: Start voting, Show results, What we heard, Next page, Next round (taking the set's `roundNoun`), Show response 1 of N, Next response, Next part, Stop showing, Show the read, Workie is writing, Open session report, Back to menu, the arm texts ("4 still answering. Press again to start voting."), and moment statuses.
- Words for VOTE, the presentation's foot lines and "N answers are on your phone, laptop or tablet."
- Test `__tests__/roundWords.test.js`: sentence case; no `!`; no emoji code points; any device word is the three-device phrase; noun substitution (Lesson → "Next lesson").

**1.2 `src/src/config/roundStep.js` (new): `momentOf(snapshot)`**

- Moments: `LOBBY, ANSWERING, VOTING, RESULTS, RESPONSES, READ, COMPOSE, ROOM_QUESTION, ROOM_RESULTS, ENDED, UNKNOWN`. Survey and other phases pass through as `OTHER`.
- `snapshot` is a normalised object: `{ gameType, state, stageBeat, notes:{page,pages,ready}, focus:{focus,index,part,parts,phase}, progress:{received,total,allIn}, playerCount, answerCount, roundNoun, presenting, ask, compose }`.
- Unknown input gives `UNKNOWN` plus the "Waiting for the session" status, never LOBBY (R2).
- Test `__tests__/roundStepMoment.test.js`: a table of states.

**1.3 `roundStep(moment, ctx)`**

- Returns `{ primary:{id,label,arm?,disabled?,hint?}, secondary|null, status:{text,tone}, next, more:[ids] }`.
- Covers C&A, trivia, poll and wavelength.
- Rules:
  - The read never skips by accident (CHANGES step 1): READ with `notes.ready === false` gives primary **Show the read**, disabled, hint "Workie is writing", and secondary **Next round**.
  - RESULTS gives **What we heard**, with secondary **Show response 1 of N** when `answerCount > 0`.
  - RESPONSES gives **Next part / Next response / What we heard** on the last one, with secondary **Stop showing**.
  - ASK/VOTE primaries carry `arm` when `!allIn`.
  - ENDED gives **Open session report**, with secondary **Back to menu**.
  - `next` is the one line for "Next on the screen".
- Test `__tests__/roundStep.test.js`: exactly one primary per (type × moment); at most one secondary; `more` lists the R7 ids; labels come only from roundWords.

**1.4 Adapters**

- `snapshotFromHostPage({...hostControlsFor inputs})` in `config/hostControls.js`.
- `snapshotFromHostState(json, extras)` in `config/hostRemote.js`.
- `hostControlsFor` becomes a reader of `roundStep` for round types. The survey and build branches stay as they are.
- Update `__tests__/hostControls.test.js` and `hostControlsGoal.test.js` for sentence case.

**1.5 Remote reads roundStep**

- Delete `primaryAction` and `ACTIONS` labels in `config/hostRemote.js`. `requestFor` stays as the id → request map.
- `HostRemote.jsx` renders `primary` and the new secondary slot `hr-sec` above it, plus ENDED's primary.
- Update `hostRemote.test.js`, `hostRemoteScreen.test.jsx`, `hostRemoteGoal.test.jsx`.

**1.6 Parity test `__tests__/roundStepParity.test.js` (new, R1)**

- For every (type × moment), build equivalent inputs through both adapters and assert the same `primary.id/label` and `secondary.id/label`.
- A second block greps `HostRemote.jsx`, `config/hostRemote.js`, `components/stage/Dock.jsx`, `components/HostActionBar.jsx` and `GameHostPage.jsx` for the roundWords label literals and fails on any hit.

**1.7 `src/src/config/navigatorOrder.js` (new)**

- `voteOrder(answers)` is the identity over `/answers` (already shuffled).
- `tallyOrder(voteTallies)` uses `assignPlacements`, with ties broken by display position.
- `responseAt(order, index)`.
- Test `__tests__/navigatorOrder.test.js` with ties, empty input and a tally missing an answer.

### Backend: server facts (no template change)

**1.8 `lambda-functions/game/stage-notes.js` (new, pure)**

- `applyNotes(record, body)` handles three shapes:
  - absolute `{notesPage}`
  - relative `{step:'next'|'prev'}`, which refuses with 409 when `pages` is unknown
  - plan `{notesPlan:[ints ≤ 12 entries, each 1..9], planKey}`, which sets `pages = Σplan` and clamps `page`
- Validates integers.
- Mirror as `src/src/config/stageNotes.js`. The drift is held by a text test in `tests/stage-notes-page.js`, in the style of `tests/feedback-round-beat.js`.
- Test `tests/stage-notes-page.js`: clamping; a step past either end; the plan sum; junk refused; no string content stored.

**1.9 `stage-beat.js`**

- Accept the notes shapes, only when the stored `StageBeat` is `field-notes`. Use a `ConditionExpression`; otherwise 409 "The room is not on What we heard".
- Write `StageNotesPage`, `StageNotesPages`, `StageNotesPlan`, `StageNotesKey`, `StageNotesRev` (`ADD`), with the existing `if_not_exists(#ttl)`. UPDATE, never PUT.
- Accept `{ profile }` with no beat. It writes `STATE.StageProfile`, enum from `PROFILES`, needs no new IAM (Crud), and broadcasts `stageProfileChanged`.
- Broadcast `stageBeatChanged` with `notesPage`, `notesPages`, `plan`, `planKey`, `rev`.
- Test: extend `tests/stage-beat-flow.js` with the beat writes still unchanged, the notes shapes, the 409 off-beat, a rival org's host getting 404, rev monotonic, ttl present, and the profile write.

**1.10 `stage-focus.js`**

- Read STATE alongside METADATA.
- `answer` focus is allowed only on `VOTE#n` or `RESULTS#n` of that `questionNumber`; otherwise 409.
- Stamp `StageFocusPhase`.
- Accept `part` and `parts` (integers, `0 ≤ part < parts ≤ 9`). Add `StageFocusRev`.
- Add the closed set `FOCUS_PHASES = ['VOTE','RESULTS']`, mirrored in `config/stageFocus.js`.
- Test: extend `tests/stage-focus-flow.js`; new `tests/stage-focus-vote.js` covering a VOTE stamp, a client-claimed phase ignored, part bounds, and a focus outside a round refused.

**1.11 `get-game-state.js`**

- Both doors return:
  - `stageNotes: {page,pages,plan,planKey,rev}`
  - `stageFocus: {focus,index,part,parts,phase,rev}`, with `focus`/`index` kept for old clients. A focus whose phase does not match the current phase reads as `none`.
  - `stageProfile`
- The public door with `?view=room` adds `roomCounts: {joined, answered, voted}`. Counting moves into a new helper `lambda-functions/game/room-counts.js` (Query `PLAYER#` and the round's `ANSWER#`/`VOTE#` rows, `isPresent`). It returns counts only.
- The host door adds `presenting` once D4 lands; Phase 1 returns `0`.
- Tests:
  - Extend `tests/get-game-host-state.js`, keeping §4's metadata equality.
  - New `tests/present-public-reads.js` part 1: `view=room` has no `questionQueue`, `target`, `answererIds`, `votersIds`, Background, or any player name. `roomCounts` are integers. Without `view=room` the body is byte-identical to today's.

**1.12 `get-answers.js`**

- Public `?view=room` always applies `redactAnswers` and drops `submittedAt`, in every phase.
- Test: `tests/present-public-reads.js` part 2. On a named round during VOTE, `view=room` has no `playerName`/`name`. Without the parameter the behaviour is unchanged.

### Frontend: publish and follow

**1.13 `config/stageFocus.js` and GHP's spotlight**

- `normaliseFocus` carries `part`, `parts`, `phase`, `rev`. `focusFromFrame` drops stale `rev`. `focusRequest` takes `part`/`parts`.
- GHP's spotlight index is mapped through `navigatorOrder.tallyOrder`. The Remote's `RemoteFocusPanel` list is ordered with the same function. This fixes the suspected D5 mismatch: confirm first with a failing test in `__tests__/remoteFocusPanel.test.jsx`.

**1.14 GHP publishes Workie's page (remote-parity B)**

- On a key, dock or Auto turn in FIELD_NOTES, post the absolute `notesPage` and its own `notesPages` (old line budget; no plan in Phase 1). Apply `stageBeatChanged` notes frames with a newer `rev`, and never re-publish them (the `publishFocus` no-loop rule).
- Hydrate from `stageNotes` on reload.
- Test: `__tests__/stageNotesSync.test.jsx` covers publish on turn, apply on frame, no echo, and reload restores.

**1.15 Remote pages the read**

- On READ with `pages > 1`: "Page n of m" plus dots. The primary is **Next page**, from roundStep, until the last page. The plain secondary is **Next round** in `hr-sec`. **Back a page** is in the body card. Each press posts `{step}`, then re-reads `/host-state` at once (A11).
- Test: `__tests__/hostRemoteNotesPaging.test.jsx`.

### Verification on dev (owner)

1. Start a C&A session on `engage.dev.seibtribe.us` with the host page on the laptop and the Remote on a phone. Every primary and secondary reads the same on both, in sentence case.
2. Press Show results while the read is still writing. Both show **Show the read** greyed with "Workie is writing", and Next round as the plain second button. Space does not skip the read.
3. On What we heard, press Next page on the phone. The laptop turns the page. Press → on the laptop; the phone says "Page 3 of 3".
4. Reload the host page on page 2. It comes back on page 2.
5. At RESULTS, show response 2 from the phone. The laptop shows the same response (D5 fix).
6. End the session. The phone offers **Open session report**.

---

## Phase 2: The Presentation

### Server

**2.1 Viewer connections (D4)**

- In `lambda-functions/websocket/connect.js`, `viewer=present&viewerId=…` stores `Viewer`, `ViewerId` and `ConnectionType:'PLAYER'`. Dedup is per `ViewerId`. Name-less non-viewer dedup excludes viewer rows.
- `get-game-state.js` host door: `presenting` = Query `CONNECTION#` filtered `Viewer = 'present'`.
- Test `tests/viewer-connections.js`: two viewers survive each other; a reconnecting viewer retires only its own older row; a player named "null" is unaffected; host dedup is unchanged; `presenting` counts viewers.

### Pure pieces (jest, no DOM)

**2.2 `src/src/present/navigatorWindow.js`**

- `navigatorWindow(index, total)` → `{ left:[mini|range], right:[...] }` with at most two minis per side and one range chip.
- Test cases are taken from NOTES §5:
  - 4 → no ranges
  - 8 at #6 → `[1–3] 4 5 | 6 | 7 8`
  - 20 at #10 → `[1–7] 8 9 | 10 | 11 12 [13–20]`
  - 60 at #30 → `[1–27] 28 29 | 30 | 31 32 [33–60]`
- `track(index,total)`: ticks up to 24, then a bar with a marker.
- Test `__tests__/navigatorWindow.test.js`.

**2.3 `present/presentFit.js`**

- `sentencesOf(text)`, `splitEven(items,k)` (stable, deterministic), `minimalK(fits, maxK=9)` with an injected predicate, `readSections(markdown)`, `orderSections(sections)` (Q4), `readPlanPages(sections, plan)`.
- Test `__tests__/presentFit.test.js`: `minimalK` with fake `fits`; `splitEven` balanced and order-preserving; a plan over the 5479 read fixture gives the expected pages; topics last; an unknown heading keeps its place.

**2.4 `present/presentModel.js`**

- `presentModel(publicSnapshot)` → `{ moment, props }` for LOBBY, ANSWERING, VOTING, VOTE_RESPONSE, RESULTS, RESPONSES, READ, QUESTION_FOCUS, SCOREBOARD, ENDED, WAITING.
- In VOTE it carries no name field, even if input has one: a defensive strip at the boundary.
- Test `__tests__/presentModel.test.js`:
  - each moment
  - a VOTE fixture with names gives no name anywhere in `JSON.stringify(model)`
  - RESULTS honours `stageLabelFor` with `authorsHidden`
  - counts only in ANSWERING

### Components and CSS

**2.5 `present/present.css` (scope `.present`, `data-theme="dark"`)**

- The canvas is exactly `1920px × 1080px`, scaled by `--present-scale`.
- Ladders are px literals per `data-profile`, resolved at 1080 from `styles/stage.css:43-86` (Room hero 91, primary 60, secondary 40, body 30, meta 21; TV, Call and Table likewise), with `--fit-min`.
- Contract test `__tests__/presentNeverScrolls.test.js` (text-read CSS):
  - root and canvas are `overflow:hidden`
  - no `overflow*: auto|scroll`, `position: sticky`, `vh`/`vw`/`dvh` inside `.present`
  - the html lock class `present-locked` sets `overflow:hidden` on html and body
  - every `--L-*` exists for all four profiles
  - Room's secondary ≥ 40 px (Q5)
- `__tests__/presentPalette.test.js`: AA composited; no `var(--primary)`; no hex outside the token block; selectors rooted at `.present`.

**2.6 `present/PresentStage.jsx`**

- Owns the canvas, the scale-to-window (resize observer), the profile, `present-locked` on mount and removed on unmount.
- `useMeasuredFit(ref)` is the DOM shrink within `--fit-min`, then drop `[data-drop]`, then shrink to `--floor`, then `data-fit="miss"`.
- Test `__tests__/presentStage.test.jsx`: lock class added and removed; no `<button>`, `<a>` or `role="button"` in the rendered output (never shows a control); the fitter is called with the profile.

**2.7 Moments in `present/moments/`**

| Component | Notes |
|---|---|
| `PresentLobby.jsx` | Join URL, code, QR via the existing QR component, "N joined" |
| `PresentAnswering.jsx` | Category, title, Background `data-drop`, task, meter, "x of n answered" |
| `PresentVoting.jsx` | Title, "N answers are on your phone, laptop or tablet", meter, "x of n voted" |
| `PresentTally.jsx` | Top 5 and "and N more responses" |
| `ResponseNavigator.jsx` | Card, flanks, track, "Response 6 of 8", "Part 1 of 2"; a `vote` mode with no name, points or rank |
| `ReadPage.jsx` | Section page, "continued", foot segments, "Page 2 of 4", topics with large numerals |
| `PresentQuestionFocus.jsx` | |
| `PresentEnded.jsx` | |

- The scoreboard reuses `components/stage/scoreboard/Scoreboard.jsx`, using `standingsVisible`.
- Test `__tests__/presentMoments.test.jsx`: words from roundWords; one position indicator per paged thing; VOTE mode markup has no points class or element.

**2.8 `present/usePresentation.js`**

- Public reads (D3).
- Viewer socket through the existing `WebSocketClient.js` with backoff.
- Polls every 3 s during ANSWERING/VOTING and every 10 s otherwise.
- Refetches on frames, `online` and `visibilitychange`, debounced 400 ms. Applies `rev`.
- Holds no state of its own beyond the last snapshot.
- Test `__tests__/usePresentation.test.jsx`: a frame triggers a refetch and its payload is ignored; reconnect refetches; a stale `rev` is dropped; a 404 game shows "This session has ended or the code is wrong".

**2.9 `src/src/PresentPage.jsx` and route**

- In `App.jsx`, `path === '/present'` is public, lazy-loaded, and outside `ProtectedRoute`.
- Renders `<PresentStage>` with `presentModel(usePresentation(gameId))`.
- Test `__tests__/presentRoute.test.jsx`: public; no sign-in redirect.

**2.10 `present/PresentMeasurer.jsx` (D1)**

- A hidden off-screen `.present` canvas at the session profile.
- Exposes `measureParts(text)` and `measurePlan(markdown)` after `document.fonts.ready`. Publishes `plan` when the server's `planKey` differs.
- Mounted by GHP (flag on) and the Remote.
- Test `__tests__/presentMeasurer.test.jsx` with stubbed `fits`: publishes once per `planKey` and not on an equal plan.

**2.11 `present/presentControls.js` (D7)**

- Signed-in keys and the 3 s strip on the Presentation.
- Static test `__tests__/presentImports.test.js`: only this file under `present/` imports `authFetch`, `/host-state` or `/answers/host`.

### Present button and transitional wiring (flag on)

**2.12 `config/surfaces.js` (D6)**

- Test `__tests__/surfaces.test.js`: dev on; test and prod off; the override is remembered; unsupported types are off.

**2.13 GHP**

- Header/Session gains **Present**: `<a href="/present?gameId=…" target="_blank" rel="noopener">`, with the hint "Drag it to the second screen and press F".
- The lobby's primary is Present while `presenting === 0` (roundStep `ctx.presenting`).
- FIELD_NOTES renders the shared `ReadPage` scaled in the stage area, so laptop and wall agree. The measurer publishes the plan.
- Show response sends `parts` from the measurer.

**2.14 Remote**

- **Big screen** (`HostRemote.jsx:1622`) becomes **Present** (a link) under the flag.
- `RemoteFocusPanel` gains the VOTE list for testing the navigator: numbers and first words, never names. It is retired in Phase 4.
- Test: extend `hostRemoteSession.test.jsx` and `remoteFocusPanel.test.jsx` (VOTE has no names).

**Resource impact:** 0.

### Verification on dev (owner)

1. Open the host page and press **Present**. Drag the window to the projector and press F.
2. Room / TV / Call / Table from Session › Settings (or the Remote) change the wall at once.
3. Lobby shows the code, QR and joined count. Answering shows counts only. Voting shows the question and count.
4. From the Remote during voting, show response 3. The wall reads "Response 3 · name hidden" with no points, and ballots read "Response 3" for the same text.
5. Show results: the tally shows. Show response 1: the long one splits into "Part 1 of 2".
6. What we heard pages match the laptop's.
7. Open a second Presentation tab: both follow.
8. Turn off Wi-Fi for 10 s: it comes back on the same moment.
9. Reload anywhere: same moment.
10. Nothing on the wall ever scrolls.

---

## Phase 3: The Dashboard

GHP keeps its state, socket, handlers, Auto and `SessionSetupPanel`. Under the flag, the Stage render tree is replaced by `<HostDashboard>`.

| # | Task | Files | Tests (first) |
|---|---|---|---|
| 3.1 | Layout shell. Header: session name, round dots, moment, Present/"Presenting on screen 2" (chip, blue), Session. Left: preview, navigator row, next line, fold. Right: moment panel. Footer: dock. | `components/dashboard/HostDashboard.jsx`, `dashboard.css` (`.dash`, laptop ladder) | `dashboardPalette.test.js`; `hostDashboard.test.jsx` (regions present, one primary, nothing else amber) |
| 3.2 | `StagePreview`: `PresentStage` scaled to the column, driven by `usePresentation` (the same public reads as the wall, so it is true by construction) | `components/dashboard/StagePreview.jsx` | `stagePreview.test.jsx` (same model as the Presentation for one fixture) |
| 3.3 | `NavigatorRow`: ‹ Response 6 of 8 · part 1 of 2 › or ‹ Page 2 of 4 ›. Posts focus/notes. Shared with the Remote. | `components/round/NavigatorRow.jsx` | `navigatorRow.test.jsx` |
| 3.4 | Moment panel, one component with two skins (`skin="dash"|"remote"`): lobby names; who is still to act; `ResponsesTable` with Show per row (pressed blue, `aria-pressed`, voting order without names in VOTE, tally order with names as allowed in RESULTS); read page list; live tally | `components/round/MomentPanel.jsx`, `ResponsesTable.jsx`, `ReadPageList.jsx` | `momentPanel.test.jsx` (VOTE has no names; Show sends index, part 0 and measured parts) |
| 3.5 | Dock: `HostActionBar` reads `roundStep`. Arm replaces `ConfirmDialog` for start-vote and show-results (CHANGES step 5). Green ring when all in (step 12). Skip moves to Session › This round with a second press. | `components/HostActionBar.jsx`, GHP (`handleFinishQuestion`, `handleShowResults`, SKIP), `config/autoMode.js` (`alwaysAuto`) | `hostActionBarArm.test.jsx`; `autoMode.test.js` (R5 rows, no host-owned phase change) |
| 3.6 | Name verbs (CHANGES step 8): `config/nameActions.js` (state → verbs → route body); `NameRequestStrip.jsx` above the dock; `PlayersList` wired with `onLock`/`onRefuse`; Remove gives an undo notice | `config/nameActions.js`, `components/round/NameRequestStrip.jsx`, `components/stage/PlayersList.jsx`, `SessionSetupPanel.jsx` | `nameActions.test.js`; `nameRequestStrip.test.jsx` |
| 3.7 | Question fold: task, detail, private Background (host branch field `background` in `get-game-state.js` host door only), set. Remembered open per session. "Show on the wall" (focus `question`). | `components/round/QuestionFold.jsx`, `lambda-functions/game/get-game-state.js` | `tests/present-public-reads.js` (public never carries `background`); `questionFold.test.jsx` |
| 3.8 | Keys (D7) and Esc. Session menu = the existing SESSION panel, plus Present and the Remote QR. | GHP key handler | `dashboardKeys.test.jsx` |
| 3.9 | Window Management API placement (progressive) | `components/dashboard/presentWindow.js` | `presentWindow.test.js` (feature-detect fallback) |
| 3.10 | Shared-task static test (R4): Dashboard and Remote import the same modules for each task | `__tests__/sharedTasks.test.js` | itself |

- Dialogs and sheets (Session, arm notices, undo) are measured at 660/375.
- **Resource impact:** 0.

### Verification on dev (owner)

1. A full C&A round from the laptop with the projector on Present. Count the taps against AUDIT §6: 12.
2. Start voting with one person still answering: the button arms and the second press goes. There is no modal.
3. A name request appears in the strip above the dock and never on the wall.
4. The preview always matches the wall.

---

## Phase 4: The Remote, rebuilt from the same pieces

| # | Task | Files | Tests |
|---|---|---|---|
| 4.1 | Round view keeps three things: the moment card (`MomentPanel skin="remote"`), the fold, and the dock (64 px primary, secondary above). A small `StagePreview`. Session button at top right opens a sheet in R7 order (People, Questions, Rounds, Settings incl. Display profile, Present link, Join code, Skip round, End session, Back to menu). | `HostRemote.jsx`, `HostRemote.css`, `components/RemoteSessionPanel.jsx` | `hostRemoteSession.test.jsx`; palette test (R3: only primary and sheet commit resolve to `--primary`); `.hr-btn--danger` → `--danger-text` |
| 4.2 | Navigator row and responses table replace `RemoteFocusPanel` | delete `components/RemoteFocusPanel.jsx` (in Phase 6) | `remoteNavigator.test.jsx` |
| 4.3 | People: verbs from `nameActions.js`; request strip above the status card; re-read `/players` at once after an action; server's 409 message in `hr-flash` | `RemoteSessionPanel.jsx`, `config/hostRemote.js` (`rosterListing` passes `handover`, `departed`) | `hostRemote.test.js`; strip test |
| 4.4 | Viewer socket for prompt refetch (A11): Remote connects as `viewer=remote`, so it re-reads `/host-state` on frames. The 2 s poll remains the fallback. | `HostRemote.jsx`, `connect.js` (`Viewer` enum adds `remote`; not counted in `presenting`) | `tests/viewer-connections.js` extended |
| 4.5 | Parity extended: render Dashboard and Remote for each moment fixture; same primary, secondary, status and navigator text | `__tests__/surfaceParity.test.jsx` | itself |

- Sheets are measured at 375.
- **Resource impact:** 0.

### Verification on dev (owner)

1. Run the same round from a phone only, with the Presentation on the projector.
2. The phone and the laptop show the same words at every moment.
3. Thirteen controls are gone from the round view; Session holds them.

---

## Phase 5: Ask the room

Built on the existing backend (`followups.js`, `followup-*`). PLAN tasks are revised per CHANGES §2.

| # | Task | Files | Tests |
|---|---|---|---|
| 5.1 | `ask` beat in every copy (PLAN T1) | `lambda-functions/game/stage-beats.js`, `config/hostControls.js` `STAGE_BEATS`/`PHASE_FOR_BEAT`, `config/hostRemote.js` `BEATS_PAST_THE_READ_BACK` | `tests/feedback-round-beat.js`; `hostRemote.test.js` |
| 5.2 | Send sets the beat to `ask`; cancel returns `field-notes` (the NOT YET note in `followups.js` header) | `followups.js` | `tests/followups-routes.js` extended |
| 5.3 | Public `live?view=room` adds `answeredCount` (count only, never a tally while live) | `followups.js` `phoneWire` | `tests/followups-routes.js` (no tally while live; no `why`) |
| 5.4 | Fragment mark: under 5 words or a conjunction start → marked "Reads as part of a sentence" and sorted last; under 4 dropped | `followup-grounding.js` | `tests/followup-grounding.js` |
| 5.5 | Words into `roundWords.js` (PLAN T13): Ask the room (N ready), Send to the room, Back to the read, Show results, Cancel the question, Ask another | `config/roundWords.js` | `roundWords.test.js`; copy test: no "Request feedback" with flag on |
| 5.6 | `roundStep`: last read page gives secondary **Ask the room (N ready)**; COMPOSE (control only) gives Send / Back to the read; ROOM_QUESTION gives Show results (arm when not all in) / Cancel the question; ROOM_RESULTS gives Next round / Ask another | `config/roundStep.js` | `roundStep.test.js`, parity |
| 5.7 | `FollowUpPanel` with a container prop: Dashboard right column, Remote sheet. List, editor, "Your words" mark, one `requestClose()`. | `components/round/FollowUpPanel.jsx`, `.css` | rendering tests; `followUpPanelPalette.test.js`; 660/375 |
| 5.8 | Presentation moments `PresentAsk.jsx` (live: statement or question + options + answered count) and `PresentAskResults.jsx` (counts as bars, **no %**). COMPOSE keeps the read's last page. | `present/moments/` | `presentAsk.test.jsx` |
| 5.9 | Phone card (PLAN T17): `FollowUpCard` via `toSurveyQuestion`, `YesNoInput`/`ChoiceInput`, change until closed, counts after. Comment link hidden while an ask is live. **Now line per moment** (CHANGES step 10) from roundWords. | `PlayerPage.jsx`, `components/FollowUpCard.jsx` | `followUpCard.test.jsx`; `playerMomentLine.test.jsx` (R8) |
| 5.10 | Report (PLAN T19): follow-up section with counts, origin and cancelled; no names | `create-report.js`, `RoundReport.jsx`, `GameReport.jsx`, PDF | `tests/session-report-*.js` extended |

- Gate: two-surface flag **and** the backend flag (404 → not offered).
- **Resource impact:** 0.

### Verification on dev (owner)

1. On the read's last page, open Ask the room with 2 ready on the Dashboard or Remote, and send one. The wall shows it with an answered count.
2. Phones show the card. Show results gives bars.
3. Next round closes a live ask with its tally.
4. The report lists it.

---

## Phase 6: Host notes and cleanup

| # | Task | Files | Tests |
|---|---|---|---|
| 6.1 | `POST /games/{id}/comments/host` on the comments function: `callerMayDriveSession`; `AuthorRole:'host'`; any started round; `question` anchor added to `comment-keys.js` ↔ `config/comments.js`; `shareWithRoom`; encrypted; 30-day `ttl`. **Count resources before and after** (one HttpApi event, about 1–2). | `template-clean.yaml`, `comments.js`, `comment-keys.js`, `src/src/config/comments.js` | `tests/comments-host-note.js` (rival org 404; no name or email stored; ttl; sealed); drift test |
| 6.2 | "Add a note" at the fold's foot (Dashboard and Remote) as a sheet. Report prints "Host note" first, with no name. | `QuestionFold.jsx`, `create-report.js`, `GameReport.jsx`, `RoundReport.jsx` | sheet tests at 660/375; report test |
| 6.3 | Retire: Remote `postMessage` and Big screen (`HostRemote.jsx:1057-1071`, `:1622`); GHP `REMOTE_COMMAND` (`:1182`); `RemoteFocusPanel`; `AnswerSpotlight` overlay and `utils/answerSpotlight.js`; `TYPES_WITH_NO_VOTE_AT_RUNTIME`; the in-page Stage moments for supported types; `stagePaging` line budgets where no longer read | listed files | delete their tests; add `__tests__/retiredPaths.test.js` (grep: no `REMOTE_COMMAND`, no `window.open(` of `/host`) |
| 6.4 | Flag default on for every tier (after the owner approves on test), then remove the classic path one release later | `config/surfaces.js`, GHP | `surfaces.test.js` |

### Verification on dev (owner)

1. Add a note during answering. It is in the report under that round, labelled Host note.
2. The Remote has no Big screen.
3. Classic path checked once more with `?surfaces=classic` before the flag is removed.

---

## Phase 7 (later): Trivia and poll on the Presentation

Same model and components, plus trivia options with the correct answer only from RESULTS (existing public rule) and `PollBoard`. Extend `surfaces.js` types and `presentModel` tests.

---

## First phase in detail (hand this to the implementer)

**Branch:** `working/build-room-host-redesign`. Read CLAUDE.md, `simplify-round/PRINCIPLES.md` (R1, R2, R3, R6) and `remote-parity/NOTES.md` §2.

**Rules:**
- Node 18 for jest. Never `npm install`.
- Each task: write the test, see it fail, implement, see it pass, commit (one commit per task, with the Co-Authored-By line).
- Run the full gates before handing back: `for f in tests/*.js; do node "$f" || echo FAIL $f; done`, then `cd src && npm test && npm run lint && npm run build`.
- Do not push; the main session deploys dev.

**Order (each 2–5 minutes where marked; the rest are larger):**

1. **roundWords** (5 min)
   - `src/src/__tests__/roundWords.test.js`: sentence case; no `!`; no emoji (`/\p{Extended_Pictographic}/u`); `deviceWords === 'phone, laptop or tablet'`; `nextRound('Lesson') === 'Next lesson'`.
   - Then `src/src/config/roundWords.js`.
2. **momentOf** (5 min)
   - `roundStepMoment.test.js`: table over `CREATED`, `STARTED`, `ASK#003`, `VOTE#003`, `RESULTS#003` × beat (`results`, `field-notes`, `feedback`, unknown) × focus (`none`, `answer`), `ENDED`, garbage. Unknown gives `UNKNOWN`, never `LOBBY`.
3. **roundStep primaries** (larger)
   - `roundStep.test.js`: for each type in `['call-and-answer','trivia','poll','wavelength']` × moment: exactly one primary, at most one secondary, labels found in `roundWords`.
   - Cases: READ not-ready (disabled, hint, Next round secondary); RESPONSES last-part (What we heard); ASK not all in (`arm` with count text); ENDED (Open session report + Back to menu); `next` non-empty.
4. **Adapters and readers**
   - Add `snapshotFromHostPage` to `config/hostControls.js` and make `hostControlsFor` delegate for round types.
   - Fix the label expectations in `hostControls.test.js` and `hostControlsGoal.test.js`.
   - Add `snapshotFromHostState` to `config/hostRemote.js`; delete `primaryAction` and its `ACTIONS` labels; update `hostRemote.test.js`.
5. **HostRemote reads roundStep**
   - Render the `hr-sec` secondary and ENDED's primary.
   - Update `hostRemoteScreen.test.jsx` and `hostRemoteGoal.test.jsx`.
6. **Parity test**
   - `roundStepParity.test.js` as in task 1.6, including the literal-grep block over the five files.
7. **navigatorOrder** (5 min)
   - Test, then `config/navigatorOrder.js` reusing `assignPlacements` from `config/podium.js`.
8. **Backend notes helper** (5 min)
   - `tests/stage-notes-page.js` (pure cases plus the text-drift check against `src/src/config/stageNotes.js`).
   - Then `lambda-functions/game/stage-notes.js` and its frontend mirror.
9. **stage-beat.js**
   - Extend `tests/stage-beat-flow.js` first: absolute, step, plan; 409 when not on `field-notes`; `profile` → `STATE.StageProfile`; frame carries `rev`; ttl kept; 404 for a rival org.
   - Then the handler, using a `ConditionExpression` on `StageBeat`.
10. **stage-focus.js**
    - Write `tests/stage-focus-vote.js` and extend `tests/stage-focus-flow.js`.
    - Then: STATE read in `Promise.all` with METADATA; phase stamp; part/parts bounds; `FOCUS_PHASES` exported and mirrored in `config/stageFocus.js`, with the drift assertion added to the new test.
11. **get-game-state.js and room-counts.js**
    - New `tests/present-public-reads.js` (§1 `/state?view=room` keys; §2 non-room body unchanged).
    - Extend `tests/get-game-host-state.js` for `stageNotes`, `stageFocus` (phase filter: a VOTE-stamped focus reads `none` on RESULTS), `stageProfile`, and `presenting: 0`.
    - Then the code. `room-counts.js` must take only counts from the Query results.
12. **get-answers.js `view=room`**
    - `tests/present-public-reads.js` §3: a named round in VOTE with `view=room` has no `playerName`, `name` or `submittedAt`; without it, unchanged.
    - Then the code.
13. **Frontend focus**
    - `stageFocus.test.js` extended (part, parts, phase, rev, stale-rev drop).
    - `remoteFocusPanel.test.jsx`: a failing case proving the Remote orders by tally at RESULTS.
    - Then `config/stageFocus.js`, GHP spotlight and `RemoteFocusPanel` through `navigatorOrder`.
14. **GHP publishes and follows Workie's page**
    - `stageNotesSync.test.jsx`, then the GHP changes: publish on key, dock and Auto turns; apply newer-rev frames; hydrate from `stageNotes`; never echo.
15. **Remote paging**
    - `hostRemoteNotesPaging.test.jsx`, then `HostRemote.jsx`: position, dots, Next page primary, Back a page, Next round secondary, immediate re-read after a press.
16. **Gates and hand-back**
    - Run every gate.
    - Report the commits, the test counts (backend files passed, jest suites and tests), and the owner's dev checklist from Phase 1.
    - **No template change in this phase.** If any task seems to need one, stop and report.

---

### Critical files for implementation
- /Users/georgeseib/Documents/projects/engage2/.claude/worktrees/affectionate-bouman-48e07a/src/src/config/hostControls.js (and the new `src/src/config/roundStep.js`, `roundWords.js`)
- /Users/georgeseib/Documents/projects/engage2/.claude/worktrees/affectionate-bouman-48e07a/src/src/config/hostRemote.js and /Users/georgeseib/Documents/projects/engage2/.claude/worktrees/affectionate-bouman-48e07a/src/src/HostRemote.jsx
- /Users/georgeseib/Documents/projects/engage2/.claude/worktrees/affectionate-bouman-48e07a/lambda-functions/game/stage-beat.js and /Users/georgeseib/Documents/projects/engage2/.claude/worktrees/affectionate-bouman-48e07a/lambda-functions/game/stage-focus.js
- /Users/georgeseib/Documents/projects/engage2/.claude/worktrees/affectionate-bouman-48e07a/lambda-functions/game/get-game-state.js and /Users/georgeseib/Documents/projects/engage2/.claude/worktrees/affectionate-bouman-48e07a/lambda-functions/game/get-answers.js
- /Users/georgeseib/Documents/projects/engage2/.claude/worktrees/affectionate-bouman-48e07a/lambda-functions/websocket/connect.js (Phase 2 viewer connections) and /Users/georgeseib/Documents/projects/engage2/.claude/worktrees/affectionate-bouman-48e07a/src/src/GameHostPage.jsx