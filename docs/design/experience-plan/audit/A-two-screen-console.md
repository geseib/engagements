# Audit A — the host's two-screen console during a live session

Auditor: senior UX audit, read-only on application code. Written 1 Nov 2026 against the
working tree at `d17943b23` (`working/parity-plan`). Every claim carries `file:line`; paths
under `src/src/` unless they start `lambda-functions/` or `docs/`. **[inferred]** marks
anything reasoned from code rather than read directly or seen in a browser. No browser walk
was done for this audit.

Owner's prompt (1 Nov 2026): a player who moved machines asked to take over their name, and
on two screens "this was nowhere visible for the host … When I brought up the list of
people there was no indication. I needed to get the full list of people, which brought up
the old right-hand settings menu, and there was the request. Why wasn't the alert with the
alarm bell, or anywhere the player's name was listed?"

Rules this audit measures drift against: `docs/superpowers/specs/2026-10-15-host-console-design.md`
(the console spec), `docs/design/host-standards/README.md`, `docs/design/parity/PLAN.md`,
`docs/design/remote-parity/NOTES.md`, `docs/design/two-surface/PLAN.md`,
`docs/design/session-start/README.md` (newest proposal, mockups only), the `engage-design`
skill.

---

## 0. First finding: "the two-screen console" is one type, not six

Which session types get the console is decided in two places that disagree in intent and
agree only by accident.

| Gate | Code | Effect |
|---|---|---|
| `TWO_SURFACE_TYPES = ['call-and-answer', 'build']` | `config/surfaces.js:26` | `twoSurfacesFor` returns `false` for every other type (`surfaces.js:59-64`), whatever the host chose |
| `useConsole = twoSurfaces && !eventCode && ['call-and-answer','trivia','poll','wavelength'].includes(...)` | `GameHostPage.jsx:1272` | lists Trivia, Poll, Wavelength — but `twoSurfaces` is already `false` for them, so those three entries are dead |
| Build Room | `buildroom/BuildConsole.jsx:178-201` on `BuildRoomPage.jsx:1363-1417` | its own page; reuses `HostConsole` with `variant="hc--build"` |

So, per type, on a laptop whose host chose **Two screens**:

| Type | What the host's laptop renders | Evidence |
|---|---|---|
| Call & Answer (standalone) | `HostConsole` | `GameHostPage.jsx:8400-8452` |
| Call & Answer **inside an event** | the wall-style `<Stage>` with the *full* strip and its four place links, plus a PRESENT dock item — a third layout | `useConsole` needs `!eventCode` (`:1272`); `places={twoSurfaces ? setupPanelTabs()…}` (`:8486-8490`); `present=` (`:8566`) |
| Trivia, Poll, Wavelength | one-screen `<Stage>`; the Screens group offers only the size (`offerChoice` false) | `surfaces.js:59-60`; `GameHostPage.jsx:6359`; `SessionSetupPanel.jsx:287-288` |
| Survey | one-screen `<Stage>` (moment is `OTHER`; no strip) | `config/roundStep.js:87`; host-standards README "Survey … no strip" |
| Build Room | `BuildConsole` (HostConsole variant) with its own rail slots, side column and Session panel | `BuildConsole.jsx:1-25`, `BuildRoomPage.jsx:1363-1400` |
| Event agenda (`HostEventAgenda`) | its own page; no console, no People, no bell | `components/event/HostEventAgenda.jsx` (grep: no `Bell`, no players) |

**Doc drift:** `docs/design/session-start/README.md` Q2 says "Trivia, poll and wavelength
already get the console (`useConsole`, `GameHostPage.jsx:1272`)". They do not — the
`twoSurfacesFor` gate at `:1254` stops them first. A synthesizer should not plan from Q2.

The rest of this audit is therefore mostly about **Call & Answer's console**, with the Build
Room console as the comparison case (same shell, different contents), and the one-screen
Stage, the Session panel and the phone Remote as the "elsewhere" surfaces.

---

## 1. Map: regions and what lives in them

### 1.1 The shell (both console types)

`components/console/HostConsole.jsx:73-90`, grid in `HostConsole.css:3`
(`"top top" "loop loop" "rail now" "rail main"`, rail 260px). Root carries
`data-theme="dark"` (`HostConsole.jsx:81`).

| Region | Component | Contents (C&A) | Contents (Build Room) |
|---|---|---|---|
| **Top line** | `ConsoleTop.jsx:14-69` | `← All sessions` (only when the footer holds a LEAVE control, `HostConsole.jsx:45-58,77-78`; `ConsoleTop.jsx:20-25`) · "Engagements" · session name · **Join NNNN** (`:31-35`, press pins the QR, `GameHostPage.jsx:8406`) · **Room's window ↗** + status pill (`RoomWindowStatus.jsx:26-59`) · `?` help + report a bug (`ConsoleTop.jsx:54-63`) · **bell**, last (`:66`) | same, plus `topExtra`: Share demo, "The room sees Stage 2 · Build 3 · History 4", See it here, **connection chip with Reconnect** (`BuildRoomPage.jsx:1330-1345`); leave label "Main menu" |
| **Loop** | `WorkflowStrip` with `places={null} hidePart` (`HostConsole.jsx:83`) | Setup › Round N › Answer · Vote · What we heard · Ask › Finish; press = private "Viewing…" | the ask path (Opening › Ask n: Ask, Collect/Vote, Settle, Send › Wrap up), dimmed between asks (`stripIdle`) |
| **"Your part now" card** | `ConsoleFooter.jsx:44-90` (named footer, drawn top-centre since 18 Oct) | kicker, the `part` sentence, status line (count + late link, `:25-35`), "Next on the wall", `HostActionBar` (primary/secondary; status suppressed, `:19,77`) | same plus `emptyLabel` "No main move now" (`:85`) and `extra` (Mockups ready) |
| **Rail** | `ConsoleRail.jsx:35-136` | four `<details>` sections, one auto-opened per moment (`config/consoleRail.js:9-25`): **Round queue** (`:66-75`), **People** (`:76-102`, + scoreboard toggle `:89-101`), **Late & not reviewed** (`:106-126`), **Session tools** (`:127-133`: Questions, Rounds, Settings) | `BuildConsoleRail` (`BuildConsole.jsx:93-108`): **Waiting for you**, **People** (+ All players · Away · Builders, `:37-62`), **Later** (Points inside), **Session** (Connect Claude, plugin, crew, look here, Screens · Players · Settings, Wrap up · Report · **End session**, `:69-91`) |
| **Main** | `consolePanel` (`GameHostPage.jsx:8292-8367`) | one panel per moment, below | the moment's panels + **HandoverStrip** + PendingInvites bar + error bar (`BuildRoomPage.jsx:1416-1425`) |
| **Side** | `hc-side` (`HostConsole.jsx:87`) | not used | Claude now, brief, History folds |
| **Overlays over the console** | siblings in `GameHostPage.jsx` | **Session panel** (`SessionSetupPanel`, fixed right, `width:min(560px,44vw)`, `z-index:1000`, `styles.css:493-507`), the **pinned QR overlay** (`:9636-9680`), confirm dialogs, report | `BuildSessionPanel`, dialogs |

### 1.2 C&A main area, by phase

`consoleMoment` comes from `roundStep` (`GameHostPage.jsx:8181`; moments `config/roundStep.js:35-38,81-112`).
Precedence before the moment switch: the inline composer (`:8306-8308`), then a strip step
being viewed (`:8309-8328`, `StepView`), then the lobby's "Where will the room watch?"
(`:8329-8341`, C&A standalone only, `:7229-7231`).

| Phase / moment | Main panel | Rail section auto-open | "Your part now" primary (from `roundStep`) |
|---|---|---|---|
| Lobby (`LOBBY`) | `LobbyPanel`: "Joined so far", code at 24px (not pressable), bare list of names, first task (`SimplePanels.jsx:12-25`); or `RoomScreenChooser` if no stored choice | Round queue | Start round 1 |
| Answer (`ANSWERING`) | `ResponsesPanel` phase ASK: lesson, "Your turn"/"The task", responses newest first, "N still writing", side card "For you" if host notes (`GameHostPage.jsx:8345-8346`; `ResponsesPanel.jsx`) | People | Start voting (armed in place if early) |
| Vote (`VOTING`, `VOTE_RESPONSES`) | `ResponsesPanel` phase VOTE: "The ballot, in the order the room sees it", "The question" row, press → wall (`:8347-8351`) | People | Show results / Next response |
| Results (`RESULTS`, `RESPONSES`) | `ResponsesPanel` phase RESULTS: "The results" row, tally, points when names shown (`:8352-8355`) | People | What we heard / Next response |
| What we heard (`READ`) | `ReadPanel`: markdown only, page on the wall marked (`:8356-8358`; `ReadPanel.jsx:51-86`) | Late | Next page / Ask the room / next round |
| Ask the room composing | `ReadPanel` + inline `AskComposerBody` (`:8270-8287`, `:8306-8308`) | (unchanged) | — |
| Question for the room (`ROOM_QUESTION`/`ROOM_RESULTS`) | `RoomQuestionPanel` wrapping `AskStage` (`:8361-8363`) | People / Round queue | Close / pick |
| Feedback (`FEEDBACK`) | `FeedbackPanel`: comments, press to feature (`SimplePanels.jsx:37-58`; `:8359-8360`) | Late | next round |
| **Between rounds** | **no panel** — there is no between-rounds moment; RESULTS leads straight to the next round. `ResponsesPanel`'s `upNext` card exists (`ResponsesPanel.jsx` `upNext` prop) but `GameHostPage` never passes it | — | Start round N+1 |
| End (`ENDED`) | `EndedPanel`: "The report so far" + one "Open session report" button (`SimplePanels.jsx:61-68`) | Round queue | Report / leave (leave lifted to top line) |
| `OTHER`, `UNKNOWN`, `COMPOSE` | **`null` — an empty main area** (`:8366-8367`) | none (`consoleRailFor` returns null) | per `roundStep` |

Spec items not built (§3.3-3.4 of the console spec): voting side card with the vote bar;
"Between rounds … Up next"; Session tools' "Players … Remote connections" (rail has only
Questions, Rounds, Settings, `ConsoleRail.jsx:129-131`); "a section's header opens the full
session menu at that section" (built instead as a link that appears only when the section
is expanded, `ConsoleRail.jsx:25`).

---

## 2. Inventory

### 2.1 Host actions

"Console" = C&A two-screen console. "1-screen" = `<Stage>` + `Dock`. "Panel" = Session panel
(`SessionSetupPanel`, the "old right-hand settings menu"). "Remote" = `HostRemote.jsx`.

| Action | Console: where / style | Elsewhere: where / style | Notes |
|---|---|---|---|
| Advance the round (Start round N, Start voting, Show results, What we heard, Next page, Next response) | "Your part now" card, top centre, `HostActionBar` orange primary; Space/→/clicker (`ConsoleFooter.jsx:76-83`) | 1-screen: bottom `Dock`, big-screen HostActionBar + KeyCap (`Dock.jsx`, `GameHostPage.jsx:8556-8566`); Remote: `hr-btn--primary` | same function (`roundStep`) everywhere — the one consistent control. **Position differs: top-centre on console, bottom dock on 1-screen** |
| Skip / secondary | beside primary in the card | dock; Remote | |
| View a step privately | strip press → `StepView` in main (`:8309-8328`) | 1-screen: same `StepView` in the stage's `view` slot (`:8506-8524`) | |
| Back to the room (while viewing) | primary becomes "Back to the room" (`:7238-7245`) | same | |
| Put a response / the question / results on the wall | press a `hc-resp` row (`ResponsesPanel.jsx`) | 1-screen: stage cards open `AnswerSpotlight` overlay; Remote: its own list | |
| Feature a comment | press a row in `FeedbackPanel` | 1-screen: `RoomMeter` arrivals | |
| Show join code | top line **Join NNNN** → **full-screen QR overlay over the console** as well as the wall (`:8406`, `:9636-9680`) | 1-screen: Rail join block hover/pin; Panel › Settings › Joining; J key; Remote "Join code" panel | 4 doors; on the private console it is still a takeover |
| Open / check the room's window | top line link + pill | StepView Setup's `ScreensGroup`; Panel › Settings › Screens (`SessionSetupPanel.jsx:1025-1047`) | 3 places, same part |
| Switch one/two screens | Setup step (StepView `ScreensGroup`) | Panel › Settings › Screens | |
| Show/hide scoreboard | rail **People** › "Show scoreboard" `hc-btn` (`ConsoleRail.jsx:89-101`) | Panel › Players tab button that also closes the panel (`SessionSetupPanel.jsx:590-605`); S key; Remote scoreboard panel | 4 doors, 3 styles |
| Late item: Show on the wall / Mark reviewed | rail **Late** first 3 rows, `hc-link` (`ConsoleRail.jsx:106-126`) | Panel › **Rounds** tab `LateList`; footer status link "N late …" (`ConsoleFooter.jsx:25-35`) → Panel Rounds; 1-screen dock `statusLink` | late items filed under "Rounds" |
| Close comments | **only** Panel › Rounds › LateList | — | |
| Ask the room (compose / send) | inline composer in main (`:8270-8287`) | 1-screen: `AskComposer` dialog (`:9408-9426`) | |
| **Grant a name handover** ("Let them take it" / "Unlock name") | **not in the console**. Only Panel › Players row (`PlayersList.jsx:139-151`, wired `SessionSetupPanel.jsx:610-617`, `GameHostPage.jsx:9457`) | Build Room: `HandoverStrip` in console main + its panel; Remote: **none** | see §2.3 |
| Refuse ("Not now") / "Lock again" | **not available anywhere in C&A** — `SessionSetupPanel` passes no `onRefuse`/`onLock` (`SessionSetupPanel.jsx:610-617`) | Build Room only (`BuildSessionPanel.jsx:420`, strip `:157`) | |
| Remove / Bring back a player | Panel › Players only | Build Room panel; Remote: none (`RemoteSessionPanel.jsx:210-256`, read-only) | |
| Questions: browse, queue, disable | rail Session tools › Questions → Panel › Questions | 1-screen: SESSION → Panel | |
| Categories on/off | Panel › Questions (inferred from props `GameHostPage.jsx:9466-9475`) | | |
| Workie: retry a failed read / Redo / model / persona | **not in the console main**; Redo + model picker only in Panel › Settings › The rounds › `WorkieSettings`, FIELD_NOTES only (`GameHostPage.jsx:9575-9591`; `SessionSetupPanel.jsx:1172`) | 1-screen: `AISummaryStatus` on the stage has Retry and Redo (`GameHostPage.jsx:9225-9238`; `AISummaryStatus.jsx:63-83`); Remote: "Workie is reading…" only | |
| Regenerate a past round's read | Panel › Rounds | | |
| Session report | ENDED panel button; Panel › Rounds "Session report" (`SessionSetupPanel.jsx:953`) | | |
| Leave (session keeps running) | top line **"← All sessions"** (only when the step offers LEAVE) | Panel › Settings fold **"Back to Menu"** (`SessionSetupPanel.jsx:1251,1279`); 1-screen dock secondary "Back to Menu" (`config/hostControls.js:624,1052`); Remote "Back to Menu" (`HostRemote.jsx:2039`); Build "Main menu" | 3 labels for one act |
| **End session** | **only** Panel › Settings › folded "Session: back to menu, end it, sign out" › red `btn-danger` (`SessionSetupPanel.jsx:1250-1295`) | Build console: rail Session slot "End session" `hc-link bc-end` (`BuildConsole.jsx:84-89`) | 3 levels deep in C&A, one click in Build |
| Help / report a bug | top line `?` (`ConsoleTop.jsx:54-63`) | Panel header `?` (`SessionSetupPanel.jsx` header); ScreensGroup `?`; Late `?`; 1-screen dock `?` | |
| Open the Session panel | rail links only (All players, Rounds and questions, Review them, Questions/Rounds/Settings), StepView "All settings", `\` key | 1-screen: **SESSION** button on the dock (`Dock.jsx:252-265`); event-two-screen Stage: strip place links "Players N · Questions · Rounds · Settings" (`GameHostPage.jsx:8486-8490`) | no labelled button on the console |
| Sign out | Panel › Settings fold, `window.confirm` (`GameHostPage.jsx:1014`) | | browser dialog, breaks AUDIT.md rule |

### 2.2 Host-attention events

How each event reaches the host page, and where (if anywhere) the console shows it.
Socket handlers are in `GameHostPage.jsx:2822-3243`.

| Event | Arrives as | Console (C&A) | Style there | Elsewhere | Verdict |
|---|---|---|---|---|---|
| **Name takeover request** | WS `handoverRequested` → `fetchPlayers` only (`:2839-2849`); roster row `handover:{requested,open}` (`get-players.js:240-242`) | **Nowhere.** Not People, not Lobby, not footer, not bell, not top line | — | Panel › Players: amber-tint row + "Asking to take this name" chip, **in score order** (no `askingFirst`) (`PlayersList.jsx:118-130`; `styles.css:821,886-890`). Build console: amber `HandoverStrip` in main (`BuildRoomPage.jsx:1417`). Build 1-screen: dock SESSION count (`BuildStageScreen.jsx:357`). Remote: nowhere | **Broken — see §2.3** |
| Late answer / late comment | WS `lateAnswerKept`, `lateChanged`, `commentPosted` → `loadLate` (`:3106-3115`) | rail **Late** count, amber when > 0 (`ConsoleRail.jsx:106`, `.hc-count.is-alert` `HostConsole.css:24`); footer status ends "· N late …" as link | 12px amber count in a section header that is auto-open only at READ/FEEDBACK | Panel › Rounds LateList; 1-screen dock status link; Remote status line (`HostRemote.jsx:974-1012`) | Visible but small; the only rail section with an alert style |
| Answered / voted progress | `playerAnswered`, `playerVoted` | People header "9 of 12 answered" 12px (`consoleRail.js:28-32`) **and** footer status line (said twice) | muted 12px / bold 13px | 1-screen RoomMeter + "Safe to move on"; Remote meter + **"Everyone is in"** with check (`HostRemote.jsx:1605-1611`) | Console weakest of three (also in session-start README §1b) |
| Someone joined | `playerJoined` → refetch | Lobby: name appended to bare list; in a round: People count/list changes, no "joined since" cue | none | — | silent mid-round |
| Someone left / went away | `playerLeft` → refetch (`:2834-2838`); server sends `isConnected` per row (`get-players.js:233`) | **Nothing.** `isConnected` is read by no C&A host surface (grep: only Build Room) | — | Build: "here now / away", Away filter (`BuildSessionPanel.jsx:147`, `BuildConsole.jsx:57`) | gap |
| Player removed/restored on another device | `playerRemoved`/`playerRestored` → refetch | People list changes silently | — | Panel "Who left" list | |
| Room's window closed / hidden / not full screen | host door `presentDetail` | top line pill: green on / amber windowed or hidden / **grey "Not open"** (`config/presentStatus.js:28-31`) | a closed window mid-round is grey, i.e. the calmest tone | ScreensGroup in Setup and Panel | closed-mid-round is not an alert |
| Host's own connection lost | `wsConnected` (`:954`) | rail **Session tools** header "● Connected"/"Offline" (`ConsoleRail.jsx:127`) — a section that **never opens by itself** and gets no `alert` | plain muted 12px | Panel header Broadcast/WifiSlash chip; Remote header "Live/Offline" always visible (`HostRemote.jsx:1472`); Build console top-line chip **with Reconnect** (`BuildRoomPage.jsx:1345`) | buried |
| AI read writing | `loadingAIInsights` | `ReadPanel` shows heading "Workie's read" over an **empty body** (`ReadPanel.jsx:57-61`) | — | 1-screen `AISummaryStatus` "writing" state; Remote "Workie is reading the responses…" (`HostRemote.jsx:1690`) | no waiting state on console |
| **AI read failed** | WS `aiSummaryError` / empty fetch → `aiSummaryFailure` (`:3185-3195`, `:3160-3165`) | **Nothing.** `ReadPanel` is never passed `failure`, `onRetry` or `onRedo` (`:8358`) | — | 1-screen: `AISummaryStatus` red `role="alert"` with headline, Retry, Redo (`AISummaryStatus.jsx:80-83`); Panel › Settings Redo (FIELD_NOTES only) | gap; primary is unlocked because a failure counts as "ready" (`:7121-7127`), so the host walks past a blank read |
| AI read ready | `aiSummaryReady` | `ReadPanel` fills | — | — | |
| Workie read-check warning (read uses words the answers do not support) | `readCheck` on the summary (`:2332-2335`) | `ReadCheckNote` muted line under the heading (`ReadPanel.jsx:58`) | `hc-muted` 13px | 1-screen: only in Panel › Settings `WorkieSettings` beside Redo (`:9589-9590`, "on one screen the only host-only place") | same fact, different place per mode; no action beside it on console |
| Survey response / closing soon / closed | `surveyProgress`, `surveyClosingSoon`, `surveyClosed` (`:3228-3250`) | n/a — surveys never get the console | — | 1-screen stage | |
| Ask-the-room answers | `followUpChanged` | `AskStage` live count in main | — | 1-screen | |
| Event moved on (item paused/started, day ended) | `eventItem*`, `eventEnded` (`:3203-3205`) | n/a — event items never get the console | — | dock "Bring everyone back" | |
| Session ended elsewhere | `gameEnded` → ENDED, `closeAllSidePanels()` (`:3207-3215`) | main becomes `EndedPanel` | — | | |
| Action refused (409 etc.) | `sessionActionError` | footer status, tone error (`GameHostPage.jsx:8438-8441`) | | 1-screen dock hint | consistent |
| Handover grant failed | `grantNameHandover` non-2xx | **console.error only** (`:4113-4116`) | — | Build: server message in its error bar | silent failure |
| Build Room asks waiting, plugin outdated, Claude offline | Build page state | Build rail "Waiting for you" (alert count), Session slot "Claude offline", top chip | `hc-count is-alert` | Build 1-screen header tab `BuildHostAlert` | Build has a "waiting for you" concept; C&A has none |
| Account inbox (AI drafts ready, invites, team requests) | `GET /me/notifications/list`, polled 5 min (`NotificationsBell.jsx:12-37`) | the **bell**, top line | bell + count | Remote header (`HostRemote.jsx:1487`); admin console top line | bell carries **no session events at all** |

### 2.3 The takeover case, end to end

1. **Player is refused.** `join-game.js` answers 409 `NAME_TAKEN`; the client classifies it
   (`components/joinResult.js:65-77`) and shows `JoinNameCollision` with the dock action
   "Ask the host to hand it over" (`JoinNameCollision.jsx:29-44`).
2. **Player asks.** `PlayerPage.jsx:2838-2856` POSTs `/players/{name}/handover-request`.
3. **Server records and pings.** `lambda-functions/game/request-handover.js:106-115` sets
   `HandoverRequestedBy/At` on the existing PLAYER row; `:124-132` calls `notifyHost` with
   `{ type: 'handoverRequested', playerName }`, which posts to **every host connection**
   (`host-notify.js`). It writes **no notification row**; the bell's source,
   `admin/orgs/my-notifications.js`, has no session or handover kind.
4. **Host page receives the frame** and does only `fetchPlayers('websocket-handover-request')`
   (`GameHostPage.jsx:2846-2849`). The comment there is the design decision verbatim:
   *"There is no toast — the host is running a room, and the decision belongs where the two
   buttons that answer it already are."*
5. **The flag lands on `players[i].handover`** (`get-players.js:240-242`; transform keeps it,
   `GameHostPage.jsx:4033-4042`).
6. **Who reads `handover` on the C&A page:** exactly one function, `rosterRows`
   (`config/setupPanel.js:294-313`), called only inside `SessionSetupPanel`'s Players tab,
   which renders `PlayersList` (`SessionSetupPanel.jsx:610-617`).
7. **Who drops it on the console:**
   - rail People: `consolePeopleFor` maps each player to `{ name, state }` and discards the
     rest (`config/consoleRail.js:48,51,63-66`); `ConsoleRail` draws ✓ / … and a meta word
     (`ConsoleRail.jsx:78-83`). The section's summary never takes `alert` (`:76`).
   - Lobby: `LobbyPanel` gets `players.map(p => p.name)` (`GameHostPage.jsx:8344`).
   - Footer status: `roundStep` knows nothing about players' handover state.
   - Top line / bell: account inbox only (step 3).
   - There is no dock on the console (`ConsoleFooter.jsx:51-57` publishes `--dock-measured: 0`),
     so even the Build Room's "SESSION shows a count" mechanism (`Dock.jsx:123-127,252-265`)
     has no place to appear — and C&A's one-screen Dock is never passed `setupCount` either
     (`GameHostPage.jsx:8556-8566`; only `BuildStageScreen.jsx:357` passes it).
8. **The only door** is a rail link: People section (must be expanded) › "All players"
   (`ConsoleRail.jsx:76`, `CW.allPlayers`) → `openSetupAt('players')` (`GameHostPage.jsx:481-484`)
   → the Session panel, fixed to the right edge over the console (`styles.css:493-507`), Players
   tab. There, the asking row is tinted amber with a 12px amber chip, **in score order** — the
   `askingFirst` prop that would lift it under an "Asking to take a name" heading
   (`PlayersList.jsx:46-48,84-85,220-224`) is not passed (`SessionSetupPanel.jsx:610-617`).
   With 30 players and a newcomer on 0 points, the row is at the bottom **[inferred]**.
9. **Host grants.** "Let them take it" → `grantNameHandover(name, true)` (`GameHostPage.jsx:4103-4121`)
   → `grant-handover.js`. On failure, nothing is shown to the host (`:4113-4116`).
   There is no "Not now", so a coincidental namesake leaves the asker stuck on "asked" with no
   answer ever arriving **[inferred from the player's `declined` stage only being set by a
   refusal, `PlayerPage.jsx:2887`]**.

**Why it only shows in the full list:** it was built that way on purpose (step 4's comment),
before the console existed (15 Oct). The Build Room later added a named strip and a dock count
(S6a), and `docs/design/remote-parity/NOTES.md` (12 Oct) already recommended "give the host
screen a strip outside the Build Room" (open question 2) and wiring `onRefuse`/`onLock` in
`SessionSetupPanel` (open question 1). `docs/design/parity/PLAN.md:298` even describes the Build
console's strip as "the request strip above the footer, as C&A's" — C&A has none. The C&A
console inherited the original "no toast" rule, and its People list was built from names only.

**The help is wrong for C&A:** `config/help/host-running.js:192` and `:628` tell the host
"**SESSION** on the dock shows a count" when someone asks. That is true only in a Build Room;
on C&A one screen the dock is not passed the count, and the console has no dock.

---

## 3. Inconsistencies

### 3.1 Same act, different label

| Act | Labels in use | Where |
|---|---|---|
| Leave, session keeps running | "← All sessions" · "Back to Menu" · "Back to menu" · "Main menu" | `consoleWords.js` `allSessions`; `SessionSetupPanel.jsx:1279`; `hostControls.js:624,1052`; `roundWords.js:65`; `HostRemote.jsx:2039`; Build `leaveLabel` |
| The settings overlay itself | "Session panel" (dock aria/title), "SESSION" (dock), "Session setup" (tablist aria, close aria "Close setup"), "Session tools" (rail), "Session" (Build rail), "All settings" (StepView) | `Dock.jsx:257-263`; `SessionSetupPanel.jsx:546,551`; `consoleWords.js` `tools`; `StepView.jsx:48` |
| Rail link to the Rounds tab | "Rounds and questions" (opens Rounds only, not Questions) · "Rounds" · "Review them" | `ConsoleRail.jsx:66,106,130`; `consoleWords.js` |
| The rail's fourth slot | C&A "Session tools", summary = socket connection · Build "Session", summary = Claude connection | `ConsoleRail.jsx:127`; `BuildRoomPage.jsx:1380` |
| Players list | "People" (rail) · "All players" (link) · "Players" (tab) · "Joined so far" (lobby) · "Players N" (event strip place) | |
| Handover verbs | C&A: "Unlock name / Let them take it", Remove. Build: + "Not now", "Lock again", "See in Players" | `PlayersList.jsx:107-170` |
| Everyone answered | Remote "Everyone is in" · 1-screen "Safe to move on" · console: no state | `HostRemote.jsx:1609`; session-start README §1b |

### 3.2 Same thing, different position or style

- **The main button moves between modes**: top-centre card on the console (`ConsoleFooter`,
  owner 18 Oct), bottom dock on one screen. A host who switches mode mid-session (offered in
  Setup) finds it elsewhere.
- **Connection state**: console = collapsed rail header text; Panel = header chip with icon;
  Remote = permanent header word; Build console = top-line chip with Reconnect.
- **Workie failure**: red alert with Retry/Redo on one screen; absent on the console.
- **Read-check note**: in the read on the console; inside Settings › Workie on one screen.
- **Scoreboard toggle**: `hc-btn` in rail People; a button in Panel Players that also closes
  the panel; S key; Remote panel.
- **End session**: red button, 3 levels deep in C&A (Panel › Settings › fold); a plain
  `hc-link` in the Build rail.
- **Join code**: on the private console, "Join NNNN" pins a full-viewport QR overlay over the
  host's own screen (`:9636-9680`); the lobby's big code beside it is not pressable.
- **Session panel paints raw hex** (`background:#111D33; color:#F4EDE4`, `styles.css:502-504`)
  while the console is token-only; two dusks side by side (engage-design rule 4).

### 3.3 Controls that move between phases

- **The rail re-opens a different section on every moment** and discards the host's choice
  (`ConsoleRail.jsx:55-57`, `consoleRail.js:9-21`): People during a round, Late at the read,
  Queue at lobby/end. "All players", "Review them" and "Rounds and questions" are links at the
  foot of whichever section is open, so the door to the Players tab is visible only while
  People happens to be open.
- **"← All sessions" appears and disappears**: only when the step's controls include a LEAVE
  (`HostConsole.jsx:45-58`) — lobby and end, not mid-round.
- **Scoreboard button lives inside People**, so it vanishes whenever People is auto-collapsed
  (READ, FEEDBACK, lobby, end).
- **Main area during Ask-the-room composing** is the read whichever beat the wall is on
  (`:8303-8308`).

### 3.4 Duplicate surfaces

- **Three "session panels"**: `SessionSetupPanel` (C&A, right overlay), `BuildSessionPanel`
  (Build), `RemoteSessionPanel` (phone, read-only players). Same tabs, different verbs.
- **Players shown in four places on one console**: Lobby list, rail People, Panel Players, and
  (event mode) strip place.
- **Late items in three**: rail Late (first 3 with actions), footer status link, Panel › Rounds.
- **The answered count twice**: People header and footer status (contradicts spec §3.5's "the
  only place a count appears with the People header" only in that it is said twice, small).
- **Room's window in three**: top line, Setup's ScreensGroup, Panel Settings.
- **Help in four**: top `?`, Panel `?`, ScreensGroup `?`, Late `?`.

### 3.5 Dead ends

- `OTHER` / `UNKNOWN` / `COMPOSE` → empty main area (`GameHostPage.jsx:8366-8367`).
- A failed Workie read → blank "Workie's read" card, primary enabled, no retry on the console.
- A namesake's handover ask in C&A → no "Not now"; the asker waits indefinitely.
- `ResponsesPanel` `upNext` and the spec's between-rounds panel → never wired.
- Trivia/Poll/Wavelength in `useConsole`'s list → unreachable code.
- Bell click opens the **admin console in a new tab** (`HostNotificationsBell.jsx:23-35`) —
  never anything in the live session.

### 3.6 Reachable only through the old right-hand menu (Session panel)

Handover grant · Remove / Bring back · Who left · Close comments · Full late list · Questions
queue and categories · Regenerate a past round · Workie Redo, persona, prompt, model · All
settings except Screens · Anonymity, wall comments, Auto · Your phone as a remote · End session
· Sign out · Keyboard shortcuts · Show how this works on the stage. On the console the panel has
no labelled opener — only rail links, StepView's "All settings" and the `\` key. And when it
opens it covers the right ~44% of the console, which is where the "Your part now" buttons sit
(`HostConsole.css:3` right column; `styles.css:496-498`) **[inferred: not measured]**.

---

## 4. Top 10 problems, ranked by user impact

| # | Problem | Evidence | Fix direction (one line) |
|---|---|---|---|
| 1 | **A person asking for their name is invisible on the console** (and on C&A one screen, and on the Remote); the only sign is a tinted row in score order inside the Session panel | §2.3; `consoleRail.js:63-66`; `SessionSetupPanel.jsx:610-617`; `GameHostPage.jsx:2846-2849` | One host-attention channel: every "needs you" event renders as a named strip in the console's main area (reuse `HandoverStrip`) and flags the person wherever their name is listed. |
| 2 | **No session-level attention model**: the bell is an account inbox; the rail has one amber count (Late); connection, window, failed read, handover each have a different (or no) signal | §2.2 table; `NotificationsBell.jsx:12-33`; `ConsoleRail.jsx:106,127` | Define one "Waiting for you" queue per session (Build Room already has the slot) and decide explicitly what, if anything, the bell carries during a live session. |
| 3 | **Failed or pending Workie read is blank on the console**, with the primary unlocked | `ReadPanel.jsx:51-61`; `GameHostPage.jsx:8358,7121-7127,9225-9238` | Render `AISummaryStatus`'s writing/failed states (Retry, Redo) in `ReadPanel`. |
| 4 | **Too much lives only in the right-hand Session panel**, which has no labelled opener on the console and covers the action card when open | §3.6; `styles.css:493-507` | Give every live-session capability a fixed home on the console; reserve the panel for set-once settings. |
| 5 | **Rail sections re-open by moment and hide their doors** (All players, scoreboard, Review them) | `ConsoleRail.jsx:55-57,25`; `consoleRail.js:9-21` | Keep the rail's sections stable and their doors always visible; open by moment only as a highlight, never by collapsing the host's choice. |
| 6 | **Three layouts for "two screens" in one product**: console (C&A), Stage-with-strip (C&A in an event), one-screen Stage (every other type), plus the Build variant | §0 table; `GameHostPage.jsx:1254,1272,8486` | One console for every type that can have a wall; types differ by panels, never by shell. |
| 7 | **Handover verbs differ by type** (no Not now / Lock again in C&A) and grant failures are silent; help claims a dock count that does not exist | `PlayersList.jsx:107-170`; `GameHostPage.jsx:4113-4116`; `host-running.js:192,628` | Wire `onRefuse`/`onLock`/`askingFirst` everywhere `PlayersList` is used and fix the help in the same change. |
| 8 | **Connection loss and a closed room's window are calm, buried signals** | `ConsoleRail.jsx:127`; `presentStatus.js:31`; vs Build `BuildRoomPage.jsx:1345` | Put both on the top line as states with an action (Reconnect / Open), alerting when they break mid-round. |
| 9 | **Same act, many labels and positions** (leave ×4, the panel ×6 names, End session 3 deep vs 1 click, main button top vs bottom) | §3.1, §3.2 | One words table for host chrome (leave, session, players, end) and one position per act across console, one screen, Remote and Build. |
| 10 | **Room progress is weakest on the console** (12px count said twice, no "everyone's in", no join/leave cues, `isConnected` unused) | `consoleRail.js:28-32`; `ConsoleFooter.jsx:25-35`; `HostRemote.jsx:1605-1611`; `get-players.js:233` | Adopt the session-start pulse tile and show here/away and "joined since this round" against names. |

---

## Appendix: files read

`GameHostPage.jsx` (481-506, 954, 1014, 1240-1300, 2815-3250, 4017-4121, 6354-6382, 6650-6690,
7115-7140, 7225-7245, 8124-8170, 8179-8470, 8470-8566, 8664-8680, 9400-9600, 9625-9665);
`components/console/{HostConsole,ConsoleTop,ConsoleRail,ConsoleFooter}.jsx`,
`console/panels/{SimplePanels,ResponsesPanel,ReadPanel}.jsx`, `console/HostConsole.css`;
`components/stage/{StepView,ScreensGroup,PlayersList,SessionSetupPanel,Dock,RoomWindowStatus}.jsx`;
`components/{JoinNameCollision.jsx,joinResult.js,HostNotificationsBell.jsx,NotificationsBell.jsx,HostActionBar.jsx,RemoteSessionPanel.jsx}`;
`config/{surfaces,consoleRail,consoleWords,setupPanel,roundStep,presentStatus,hostRemote}.js`;
`config/help/host-running.js:180-650`; `buildroom/{BuildConsole.jsx,buildConsole.js,BuildSessionPanel.jsx,BuildRoomPage.jsx (697,1330-1425,1575-1600)}`;
`HostRemote.jsx` (selected); `lambda-functions/game/{request-handover,host-notify,get-players}.js`,
`admin/orgs/my-notifications.js`; `styles.css:493-507,821-890`; docs listed at the top.
