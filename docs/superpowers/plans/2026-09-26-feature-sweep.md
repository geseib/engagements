# Feature sweep, 26 Sep 2026: plan

Four owner requests of 26 Sep 2026, built by maker/checker agents on top of
the bug sweep (`2026-09-26-bugsweep.md`). Each task branches from the bug
sweep's integration branch, so the fixes are already under it.

**Research (current state, file:line):**
`/Users/georgeseib/Documents/projects/engage2/.claude/worktrees/bugsweep-integration/.superpowers/sdd/2026-09-26-bugsweep/feature-research.md`,
sections F1–F4. Read your feature's section before you start. Its "Current
state" references are on `origin/dev ef38018e`; re-read the lines before you
change them.

**The owner's rulings (26 Sep 2026). These are binding:**
- **Survey results have no minimum group size anywhere.** The console, the
  saved report and the share link show every chart and every open answer,
  even under 5 answers. Names still never appear on the report, the wall or
  the share link (the Names ruling in `src/src/config/surveyNames.js`).
- **Player feedback.** The player's own "Feedback" button works on any round
  whose results are showing, without the host opening feedback mode.
  Host-triggered feedback mode stays exactly as it is.
- **Scoreboard.** A visible close button sits on the board itself, so the room
  sees it too. The S, Esc and Space keys keep working.
- **No mockup pass for these four.** Build from the research and the existing
  design language; the owner reviews on dev.

## Global Constraints

Everything in the bug sweep plan's Global Constraints applies: worktree
discipline, TDD, the test commands, never `npm install`, Node 18, identical
copies, no bare partition literals, 404 refusals on host routes, copy style,
commit format, and scope. On top of that:
- **Run the FULL frontend suite before reporting DONE**
  (`cd src && npm test`, and read the `Test Suites:` line). The bug sweep
  found a cross-suite contract, `promptWorkbench.test.js`, that only the full
  run catches.
- **Design system.** Follow `.claude/skills/engage-design/SKILL.md`:
  - use tokens only, and no hex outside a token block;
  - obey the container rule;
  - dialog exits: one `requestClose()`, an X and a bottom exit, and never a
    modal opened from a modal;
  - measure contrast (≥ 4.5:1) and add a palette/CSS-contract test for any new
    stylesheet, following that file's own examples.
- **Player screens** work at phone, tablet (≥768px) and laptop (≥1200px)
  through `PlayerSurface.css`'s ladders.
- **Stage screens** respect the display profiles (`d-room`, `d-tv`, `d-call`,
  `d-table`) and reduced motion.

---

### Task 1: The scoreboard has a close button on the board

**Request:** "add a way to click the scoreboard off back to what was showing
before."

**Today:** the scoreboard closes three ways:
- the keys S, Esc and Space on the stage;
- the Players-tab toggle in `SessionSetupPanel.jsx` (~1044–1052);
- the phone remote's `RemoteScoreboardPanel.jsx`.

Closing publishes `{ open: false }` through the existing
`POST /games/{id}/scoreboard` (`GameHostPage.jsx` ~6164,
`publishScoreboard`). There is no click target on the board.

**Required:**
1. **A close button.** It sits on the scoreboard overlay (`sb-rail` or the
   board's frame) and is drawn in every one of the three looks (departure,
   Olympic, tote), in each look's own style.
   - It is visible to the room (owner's ruling), but quiet enough not to
     compete with the standings.
   - It has an accessible name ("Close scoreboard").
2. **Closing** calls the same `publishScoreboard({ open: false })` path the
   keys use. The stage returns to exactly what was showing before, as the
   keys already do, and every connected screen follows through the existing
   broadcast.
3. **Clicking the button never advances the round.** This mirrors the
   Space-does-not-advance rule in `scoreboardHostKeys.test.jsx`.
4. **Hidden where it does not belong.** The button appears only where the
   board is shown on the host's stage (the host is the one who can publish);
   it does not appear on a player's phone, laptop or tablet.

**Tests:**
- A click closes the board and does not advance the round.
- The button renders in all three looks.
- It is absent from player surfaces.
- Keys still work.
- Add the CSS contract for any new style.

### Task 2: The report opens with the session's details and who was there

**Request:** "for session report it would be nice to have it start with event
info if given, attendee list. what they are being asked to do in the session."

**Today:** the report opens with the title, date and counts.
- Event details (`sessionMeta.Details` / `EventDetails`, 300 characters), the
  set's description, and the roster (`playerPerformance`) are all already
  available in `create-report.js`, but are not shown up front.
- `GameReport.jsx` ~399 is the title `<dl>`.
- The report is rebuilt on the host page (`GameHostPage.jsx` ~4337–4349);
  a field that is not forwarded there never reaches the report.

**Required:**
1. **"About this session"** sits under the title:
   - the event details, verbatim, when present;
   - "What people were asked to do": the session's details and/or the question
     set's description, when present;
   - the whole block is omitted when both are empty, following the
     conditional-block pattern at `GameReport.jsx` ~401–407.
2. **"Who was here"** is a roster of names only, in join order, from the
   players who joined.
   - The Final Scores section keeps ranking; do not duplicate scores.
   - The roster says who joined. It never says who answered what, so rounds
     with hidden authors remain redacted as they are today.
3. **The new fields are threaded end to end:**
   - `create-report.js` `reportData`;
   - the host page's report rebuild;
   - the saved PDF, which reuses the page, with the print/keep-together rules
     the caveat block uses (`report-keep`, `GameReport.css`);
   - decrypted org text where the session's fields are encrypted, as the
     report already handles the title.

**Tests:**
- A report with details and roster shows both blocks.
- A report with neither omits them.
- A hidden-author round still shows no attribution.
- The rebuild path carries the new fields.
- A backend test that `reportData` carries the details (decrypted for an org
  session).

### Task 3: Survey results: the read route and the host's results screens

**Request:** "for the survey there is no showing of what the results and tally
of each question was. things like average score, % and count for choices, list
of feedback with open text."

**Today:**
- The tallies are built and frozen: `survey-aggregate.js` writes
  `SURVEY#RESULTS`, with per-question figures and texts, and it is privacy-safe
  by construction (see the file header).
- Nothing reads them back:
  - there is no GET route;
  - there is no console or stage rendering;
  - the report has no survey section.
- The design is complete in `docs/design/survey-redesign/`:
  - results mockups 30 (results) and 31 (open answers);
  - the stage and kind renders `s-02`…`s-06`, as the research lists;
  - `PLAN.md` "Phase 3".

**Required** (build from those mockups; they are the design):
1. **The read route.** Add `GET /games/{gameId}/survey-results`, as `PLAN.md`
   names it:
   - host-only: Cognito, `callerMayDriveSession`, 404 when refused;
   - it reads `SURVEY#RESULTS` and the text pages, and decrypts;
   - it returns per-question results for every kind: rating and 0–10 (average
     and distribution), choice and yes/no (count and % per option), rank, and
     text (the full list);
   - it NEVER returns a name, in any Names mode. It reads only `SURVEY#RESULTS`
     and never the respondent rows;
   - no minimum group size (owner's ruling).
2. **`KindResult` components**, one per kind, each rendered from the
   aggregate shape, as the mockups draw them.
3. **The host's results page and open-answers page** (mockups 30 and 31).
   They are reachable wherever the mockups and `PLAN.md` place them, from the
   survey session once results exist.
4. **Out of scope:**
   - the report section (Task 4);
   - the AI read (Phase 4);
   - the share link (Phase 5);
   - CSV export.

**Tests:**
- Route authorization: anonymous and other-org callers get 404; the owner
  gets 200.
- A privacy test: the response contains no name in the Named mode, with
  seeded respondent names searched for in the body.
- Each kind renders from the aggregate fixture used by
  `tests/survey-aggregate.js`.
- An empty survey renders a plain "No answers yet".

### Task 4: Survey results in the report (after Tasks 2 and 3)

**Request:** "this should also be what the report shows, not who filled in the
survey."

**Required:**
1. **`create-report.js`** gains the survey section, read from
   `SURVEY#RESULTS`: the same per-question results as Task 3, with no names in
   any Names mode and no minimum group size.
2. **`GameReport.jsx`** renders it, after Task 2's opening block, as mockup 34
   (`docs/design/survey-redesign/34-report.html`) draws it. Reuse Task 3's
   `KindResult` components, or print-friendly variants of them, rather than
   drawing the charts a second time.
3. **A survey report does not list who finished or who answered what.**
   Task 2's "Who was here" roster lists who joined. For a survey in the
   Anonymous Names mode, leave the roster out, because a roster beside
   anonymous answers invites guessing. Say this plainly in a code comment.

**Tests:**
- A survey report carries every question's results.
- No respondent name appears anywhere in the report JSON or the rendered text,
  for each Names mode.
- An anonymous survey has no roster.
- The saved PDF path uses the same render.

### Task 5: Players can open feedback from their own results screen

**Request:**
- "feedback comments … turned on in the player screen as soon as the results
  are shown";
- "comment on the ai feedback as well as general feedback";
- "reread the question and responses, when they click on them";
- "via a button on the player results screen, or if triggered by the host it
  can switch to feedback mode as current setup."

**Today:**
- Section-anchored commenting already exists on the host-triggered feedback
  beat: `FeedbackRoundPanel` and `RoundReport` handle Workie's summary, the
  results, and the responses to reread.
- `submitComment` (`PlayerPage.jsx` ~1119–1137) is the player's comment call.
- `lambda-functions/game/comments.js` refuses a comment unless the round's
  `StageBeat` is `feedback` (~284–297 and ~488–494). The header of that file
  warns against weakening this gate silently.

**Required:**
1. **Backend.** `comments.js` also accepts a comment when the session's current
   phase is `RESULTS#<nnn>` and the comment is for round `<nnn>` (owner's
   ruling).
   - Keep every other check: the player is in the session, the anchors are
     valid, the length limit (`MAX_COMMENT`), and the anonymity rules.
   - The feedback-beat path is unchanged.
   - Update the file's header comment to say exactly what is allowed now, and
     that the owner decided it on 26 Sep 2026.
2. **Frontend.** Every ordinary RESULTS screen on the player's phone, laptop
   or tablet gets a "Feedback" button (the `RESULTS#` arm, `PlayerPage.jsx`
   ~3169+).
   - It opens the same `FeedbackRoundPanel` for that one player, with Workie's
     read, general feedback, and the question and responses to tap and reread.
   - Closing it returns the player to the results screen.
   - When the host triggers feedback mode, phones switch as they do today.
   - When the round leaves RESULTS while a player is writing, the panel says
     so plainly and keeps the typed text until they close it. It never
     silently discards a comment.
3. **Stage and reports.**
   - A comment made this way appears in the stage's arrivals (`RoomMeter`) the
     same as a beat-triggered one; check that the arrivals do not depend on
     the beat.
   - It reaches the reports, and the host can feature it on the wall as
     today.

**Tests:**
- Backend: a comment is accepted on RESULTS for the current round without the
  feedback beat. It is refused for a round that is not on RESULTS, and refused
  when the session is on ASK/VOTE. The feedback-beat path still works.
- Frontend: the button appears on the results screens, opens the panel,
  rereading works, the round moving on keeps the draft, and the host-triggered
  mode is unchanged.
- The arrivals show a player-initiated comment.

### Task 6: The phone remote says up front when this account cannot run the session

**Bug (reported 26 Sep 2026):** "when logging in i can see the players, the
questions, but there is an error when trying to move the game forward or make
any changes."

**Root cause.** The investigation is in
`.superpowers/sdd/2026-09-26-bugsweep/remote-bug-rootcause.md`.
- Every remote write goes through `authFetch` to a Cognito route.
  `callerMayDriveSession` (`tenant.js` ~323–330) refuses the write with
  `404 "Game not found"` when neither the phone's active team nor any of the
  signed-in account's memberships owns the session.
- The public reads (`/state`, `/players`) use plain `fetch`, so they still
  work.
- The team-mismatch case within one account is already fixed on dev
  (`a0987e3d`: `ActiveOrgSwitcher` on the remote, plus a membership fallback).
- The remaining live causes, most likely first:
  1. the phone is signed in as a DIFFERENT ACCOUNT from the one that created
     the session (the owner has two admin identities);
  2. the account is not a member of the session's team;
  3. an expired sign-in, which gives 401.
- The remote lets the host tap and then fails. Its 404 hint
  (`sessionActionMessage`, `config/hostRemote.js` ~909–924) says to switch
  team, which does not help for cause 1.

**Required:**
1. **Check up front.** When the remote opens signed in, it calls the
   authenticated `GET /games/{gameId}/host-details` (added by bug-sweep
   Task 1, with Cognito, `callerMayDriveSession` and a 404 refusal) through
   `authFetch`.
   - **200:** the account can run the session, and nothing changes.
   - **404 while the public state read shows the session exists:** show one
     plain banner naming the signed-in account's email, for example: "You're
     signed in as a@b.com. That account can't run this session. Sign in with
     the account that created it, or switch team under Session if it belongs
     to another of your teams." Disable the write controls with that reason
     shown; never let them be tapped only to fail. Offer "Sign in as someone
     else", reusing the app's existing sign-out/sign-in path, and re-check
     after the team switcher changes team.
   - **401, or no token:** "Your sign-in has run out. Sign in again", with the
     sign-in action. Keep the controls disabled.
2. **Name the account in failures.** The existing dispatch failure copy for a
   404 on a live session also names the signed-in account, so a failure that
   still happens (for example, the owner removes you mid-session) explains
   itself.
3. **Leave the rest alone.** No change to `callerMayDriveSession` or any
   backend refusal. This is a remote-only change.

**Tests** (jest, `src/src/__tests__/`, extending `hostRemoteOrgScope.test.jsx`
and `hostRemoteFailureCopy.test.jsx` where they fit):
- 200: the controls are enabled and there is no banner.
- 404 with a live state: the banner names the email, the controls are
  disabled, and "Sign in as someone else" is present.
- A team switch triggers a re-check, which enables the controls on 200.
- 401: the sign-in-again banner.
- The dispatch 404 copy names the account.

### Task 7: Host-only session data leaves the public reads (security)

**Bug (found 26 Sep 2026 while tracing the remote).** Two public routes (no
authorizer) return host-only data to anyone who adds a flag to the URL. This
is the same class of hole bug-sweep Task 1 closed on `GET /games/{id}`: a
query parameter is a claim, not an identity.
- **`GET /games/{gameId}/state?includeHostData=true`** (`get-game-state.js`
  ~439) returns:
  - the queued running order (`questionQueue`, the same data
    `GET /games/{id}/queue` returns; that route was put behind sign-in on
    23 Sep, so this flag walks around that lock);
  - the category counts and host masks;
  - answer and voting progress.
- **`GET /games/{gameId}/answers?role=host`** (`get-answers.js` ~174) returns
  every answer to a question, with player names in non-anonymous rounds, at any
  phase. The player branch shows answers only during VOTE.
- **Callers:** the stage (`GameHostPage.jsx` ~2382, ~2844, ~3217 for `/state`;
  find its `/answers?role=host` readers) and the phone remote
  (`HostRemote.jsx` ~209 `/state`, ~407 `/answers`).
- **The owner's concern:** a team's questions may be private customer
  material. Anyone holding a 4-digit code, including a player in the room or
  someone who guesses a code, must not see upcoming questions or host views.

**Required:**
1. **Audit first.** List every PUBLIC route handler under `lambda-functions/`
   (template events with no `Auth`) that changes what it returns based on a
   query parameter or header claim (`role`, `includeHostData`, `isHost`,
   `debug`, `host`, and so on). Record the list in your report with file:line,
   what each claim unlocks, and whether it is host-only. Fix every host-only
   one you find, not only the two above.
2. **The fix pattern (precedent: bug-sweep Task 1's
   `GET /games/{gameId}/host-details`, and `/ai-summary/host`):**
   - the public route stops honouring the claim, and returns exactly what a
     player may see;
   - the host-only payload moves to an authenticated sibling route (for
     example `GET /games/{gameId}/host-state` and
     `GET /games/{gameId}/answers/host`), with the Cognito authorizer, an
     `authorizer.js` rule of the precedent's shape, `callerMayDriveSession`,
     and a uniform 404 on refusal, with no identity refused before any read;
   - keep the payload shapes identical, so the callers change only their URL
     and use `authFetch` instead of `fetch`;
   - CORS stays as it is; add no new header.
3. **Switch every caller:** the stage and the phone remote, plus any other
   reader the audit finds. Players' own reads keep working unchanged.
4. **Polling cost.** The remote polls `/state` every 2 seconds. It needs the
   host payload from the authenticated route, but that one read must not
   double into two requests per poll. Read either the authenticated route
   alone (it can carry the public fields too), or read it on the same cadence
   in place of the public one. Say which, and why.
5. **Another task (Task 6)** is changing `HostRemote.jsx`'s access check and
   gating in a separate worktree. Keep your `HostRemote.jsx` change to the
   read URLs and `fetch` → `authFetch`, so the two merge cleanly.

**Tests:**
- For each route fixed: an anonymous caller with the flag gets only the
  player-safe payload. Search the body for seeded queue question ids and titles
  and for answer texts with names, and assert they are absent.
- The authenticated sibling: anonymous and other-org callers get 404; the owner
  gets the full payload.
- The stage and the remote call the new routes with auth. Extend
  `hostAnswerProgress.test.js` and `hostAnswererSyncCallSite.test.js`, which
  pin `answerProgress` under `includeHostData`.
- The route inventory and api.md regenerate
  (`node scripts/generate-api-doc.js`, then `--check` exits 0), and
  `tests/cors-allows-sent-headers.js` passes.
