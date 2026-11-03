# Audit B: the host's one-screen view, the room's window and the phone Remote

Auditor B, 1 Nov 2026, read against `d17943b23` (branch `working/parity-plan`). Read-only:
no application code was changed. Method: source reading, checked against the prior
design docs, plus GitHub issues #43 and #48 read over the REST API. **Nothing here was
seen in a browser.** Where a claim rests on reading rather than on a line that says it,
it is marked *(inference)*.

The two-screen console (`components/console/*`) belongs to audit A. Where this audit
touches it, it says so and gives the line, so the two audits can be checked against each
other.

Path note: the brief names `src/src/components/HostRemote.jsx`. The file is
`src/src/HostRemote.jsx` (with `src/src/HostRemote.css`).

---

## 0. The facts that frame everything else

1. **Only Call & Answer and Build Room ever get two screens.** `TWO_SURFACE_TYPES =
   ['call-and-answer', 'build']` (`config/surfaces.js:25`), and `twoSurfacesFor` returns
   false for any other type (`surfaces.js:58-63`). So for **Trivia, Poll, Wavelength and
   Survey the laptop is always the room's screen**, whatever the host chose. Every
   one-screen privacy hazard below applies to those four types every time, not as an
   option.
2. **`useConsole` lists types that can never reach it.** `GameHostPage.jsx:1272` turns on
   the console for `['call-and-answer', 'trivia', 'poll', 'wavelength']`, but it also
   requires `twoSurfaces`, which is false for the last three. In practice the console is
   Call & Answer only. This is dead intent, not a bug, but anyone reading line 1272 will
   think Trivia has a console.
3. **There are three different laptop layouts for a round type, not two:**
   - **Console** (`GameHostPage.jsx:8401-8452`): two screens, C&A, not an event item.
   - **Stage, wall-styled, privately on a laptop** (`:8454-9397` with `twoSurfaces`
     true): a C&A **event item** on two screens. `useConsole` needs `!eventCode`
     (`:1272`), so the host gets the projector layout on their private laptop, with the
     full strip and its "places" links (`:8482-8490`) and PRESENT in the dock (`:8566`).
   - **Stage on one screen** (`:8454-9397` with `twoSurfaces` false): every other case.
4. **Build Room has its own page and its own idea of "one screen".** It lives at `/build`
   (`buildroom/BuildRoomPage.jsx`), not in `GameHostPage`. On one screen it keeps a
   private **Host** screen and switches the projector between room screens (Stage, Build,
   History) with P and 1-4 (`BuildRoomPage.jsx:726-747`, `:1520-1620`). The round types
   have no private screen on one screen at all: the laptop *is* the stage, and every
   private thing lives in an overlay the room can see.
5. **The intended rule is written down and is not what ships.** Host standards §1:
   "Where the laptop *is* the room's screen (one screen), everything on it is treated as
   public" (`docs/design/host-standards/README.md:16-18`). The Session panel's own header
   comment says it holds "everything the host needs and the room does not, behind one
   dock button" (`components/stage/SessionSetupPanel.jsx:38`). On one screen that panel
   is drawn over the projected stage.

---

## 1. Map of each surface

### 1.1 The host's one-screen view (round types): `<Stage>`

Shell: `components/stage/Stage.jsx:98-112`: `.stage` grid of rail, strip, main (content +
meter), dock, and an overlay layer. It is fixed height and never scrolls
(`styles/stage.css:138`). The root declares **no `data-theme`** (`Stage.jsx:98`), which
host standards §9 records as open.

| Region | What lives there | Where |
|---|---|---|
| **Rail** (top) | Phase chip (Lobby / Answering / Voting / Results / What we heard / Closed / Complete), session title, category / "Round N of M" / goal, JOIN + URL + code. Hover on the code previews the QR; a click pins it | `stage/Rail.jsx:3-12, 21-118`; wired `GameHostPage.jsx:8524-8544` |
| **Strip** | `WorkflowStrip` in `slim` mode on one screen. Pressing a step to view it privately is turned off on one screen (`viewing` needs `twoSurfaces`) | `GameHostPage.jsx:8478-8495, 7225` |
| **View slot** | The "Where will the room watch?" chooser in the C&A lobby until this browser has chosen; otherwise `StepView` (two screens only) | `:8496-8523, 7229-7231` |
| **Content** (per phase) | see the table below | `:8674-9396` |
| **Meter** (right column) | LOBBY "In the room N" + hover "Already joined" names; ASK "Answered n/N"; VOTE "Voted n/N"; FEEDBACK and RESULTS/FIELD_NOTES with comments: "Comments N" + arrivals (comment text, no author) + the host's "said in the room" composer; Survey "Finished n/N" + per-question rows + "still going" names | `:7562-7623, 7666-7671, 7708-7779`; `stage/RoomMeter.jsx` |
| **Dock** (bottom) | Status line (with the late link), progress mirror, hint, `HostActionBar` (secondary, primary + key cap), `?`, AGENDA (events), PRESENT (two screens only), SESSION | `stage/Dock.jsx:132-268`; wired `GameHostPage.jsx:8555-8616` |
| **Overlay** | The scoreboard (Trivia and C&A) | `:8627-8638` |
| **Siblings over the stage** | Session panel (`SessionSetupPanel`), the Ask the room composer, the QR modal, the expanded question, `ConfirmDialog`, `PastRound`, the leave guard, the loading overlay, `InviteDialog` | `:9411-9810` |

Content per type and phase (`GameHostPage.jsx`):

| Phase | Call & Answer | Trivia | Poll | Wavelength | Survey | Event item |
|---|---|---|---|---|---|---|
| LOBBY | Chooser (first visit) then QR + code (`:8680-8716`) | QR + code | QR + code | QR + code | n/a: COLLECTING shows `SurveyCollecting` with its own QR (`:8723-8732`) | QR; "Running order" door while previewing (`:8701-8706`); primary "Bring everyone here" (`:7185-7212`) |
| ASK | `QuestionCard` with `roomContentFor('ANSWERING')` (`:8757-8768`) | `QuestionCard` | `QuestionCard` + live `PollBoard` (`:8772-8774`) | `QuestionCard` | (COLLECTING) | as its type |
| VOTE | Cue, recap, numbered ballot cards, one-screen `AnswerSpotlight`, `Pager` (`:8776-8883`) | none (no vote) | none | none | none | as its type |
| RESULTS | Recap, "The room's pick" + runners-up with bars, "and N more", "Talk about it" (`:8995-9122`) | `QuestionCard phase="REVEAL"` (`:8971-8981`) | Frozen `PollBoard` (`:8957-8962`) | `WavelengthConvergence` (`:8982-8993`) | CLOSED: `SurveyClosed` counts (`:8736-8742`) | as its type |
| FIELD_NOTES | `AISummaryStatus`: writing / read / **failed + Retry** / didn't run + Redo, paged (`:9208-9261`) | same | same | same | n/a | same |
| FEEDBACK | `FeedbackWall` (+ the featured quote) (`:9310-9316`) | same | same | same | n/a | same |
| ASKING (question for the room) | `AskStage` (`:9320-9322`) | n/a | n/a | n/a | n/a | n/a |
| ENDED | "Session complete", rounds played, people, `Podium` (`:9335-9391`) | Podium | Podium | `WavelengthSessionVocabulary`, no podium (`:9374-9380`) | `SurveyClosed ended` | as its type |

Mid-round QR: on one screen during a round, J (or the panel's join button) puts the QR in
a **side panel** beside the content (`StageJoinPanel`, `:8675-8677`, `:7981-7996`); in the
lobby and on two screens the QR is the full modal (`:9642-9688`).

### 1.2 The Session panel (one screen and two)

`components/stage/SessionSetupPanel.jsx`, mounted at `GameHostPage.jsx:9431-9593`. It is a
right-hand `aside` dialog with a scrim, `data-theme="dark"` (`:468-488`), opened by the
dock's SESSION or by `\`. On two screens it is also opened by the strip's places (Stage
path) or by the console rail's links (`ConsoleRail.jsx:66,76,106,129-131`).

| Part | Contents | Lines |
|---|---|---|
| Header | Brand mark, "Session setup", **the only WebSocket status on the host page** ("Connected" / "Connecting…"), `?` (opens the current tab's guide), ✕ | `:489-549` |
| Tabs | Players · Questions · Rounds · Settings (`config/setupPanel.js:25-34`). It opens on **Players** unless a place was asked for (`GameHostPage.jsx:9435-9437`) | `:551-566` |
| Players | Scoreboard toggle ("Show scoreboard on screen", which closes the panel), then `PlayersList`: rank, name, points, done tick, **"Asking to take this name" flag**, Let them take it / Unlock name, Remove, the removed list with Bring back | `:569-636`; `stage/PlayersList.jsx:107-180` |
| Questions | Categories, then "Choose the next question" (the browser; options and answers are withheld because the panel may be projected, `config/setupPanel.js` header) and the running order | `:639-926` |
| Rounds | "Session report", then **Late & not reviewed** (`LateList`: kind, text, who, Show on the wall, Mark reviewed, Close comments), then the rounds played | `:928-1010` |
| Settings | Screens (one/two screens for C&A only, room's window, room screen size); "Your phone as a remote" (QR + URL + who may sign in); The rounds (Names, Feedback, Report, **Workie** incl. Redo and the **read-check warning**, Pace, Scoreboard style); Joining (URL, Copy, Invite…, "Put the join code back on the stage"); fold "Session: back to menu, end it, sign out" (Show how this works on the stage, Back to Menu, End session, Admin ↗, Sign out); fold "Keyboard shortcuts" | `:1012-1342`; `stage/WorkieSettings.jsx:56-128` |

### 1.3 The room's window (`/present`) and what the room sees on one screen

- **One screen:** the room sees the whole laptop: rail, strip, content, meter, **dock**
  (all host buttons, the status line and the late link), and anything opened over the
  stage: the Session panel, the QR modal, the composer, `PastRound`, `ConfirmDialog`.
- **Two screens, round types:** `/present?gameId=` (`PresentPage.jsx:128-131`,
  `CallPresentPage :133-239`). Moments come from `present/presentModel.js:280-470`, drawn
  by `present/PresentMoments.jsx:691-722`: LOBBY/JOIN, ANSWERING, VOTING (overview) /
  VOTE_RESPONSE (one at a time), QUESTION_FOCUS, RESULTS (tally) / RESPONSES (one result),
  READ / READ_WAIT ("Workie is writing…"), FEEDBACK, ROOM_QUESTION / ROOM_RESULTS, ENDED,
  NOT_FOUND. Overlays: the scoreboard (`:168-182`), a mouse-shown strip with ‹ Back,
  Show/Hide QR (J), Forward › for a signed-in host, or a note saying why the keys do
  nothing (`:191-209`), and the safety ask (`:215-227`).
  - **A survey on `/present`** maps to `OTHER` ("This session shows on the host's
    screen", `PresentMoments.jsx:719`; `roundStep.js:87`).
  - **Trivia, Poll and Wavelength on `/present`** are not offered (no PRESENT link), but
    the page renders any game id; its moments are C&A-shaped (no correct-answer reveal,
    no `PollBoard`) *(inference from `presentModel.js` having no type branch apart from
    survey ENDED, `:451`)*.
- **Two screens, Build Room:** `/present?…&type=build&k=` renders `BuildWall`
  (`PresentPage.jsx:117-131`).
- **One screen, Build Room:** the projector shows whichever of Stage / Build / History is
  up. The Stage carries the host's dock (status, HostActionBar, mockups cue, HOST with
  an alert, Room's window, SESSION **with an asking-to-take-a-name count**)
  (`buildroom/screens/BuildStageScreen.jsx:339-364`). The Host screen is private: the
  request strip and the team invitation bar draw there only (`BuildRoomPage.jsx:1585-1591`).

### 1.4 The host's phone Remote (`/remote`)

`HostRemote.jsx:1420-2196`, `data-theme="dark"` (`:1441`). There is no WebSocket: it polls
`/host-state` every 2 s, `/players` every 6 s, the read every 4 s (`:102-114`).

| Region | Contents | Lines |
|---|---|---|
| Bar (sticky) | ← back (inside a list), code + title, **Live / Offline** chip, `?`, **the bell** | `:1442-1488` |
| Step dots | `RemoteStepDots` from the same `workflowStrip` | `:1489, 1017-1020` |
| Status card | Phase kicker + headline, goal progress, progress meter "n of N answered" + "Everyone is in", or the roster count | `:1583-1620` |
| Goal reached | flash | `:1625-1630` |
| Still waiting | Names of who has not answered/voted, with a "Private" note | `:1639-1653` |
| What we heard | Page position + dots + Back a page, lead, topics, next steps, Ask the room icons, **read-check note**, "Full notes… in the report", context hint | `:1658-1726` |
| Question for the room | Kicker, the question, the answered count | `:1731-1741` |
| Feedback round | Kicker, "N comments so far", the host's room note composer | `:1776-1788` |
| Errors / notices | `hr-flash` | `:1790-1801` |
| This round card | Choose next question → list; Show on the big screen → `RemoteFocusPanel` (question, a response, voting tallies) | `:1821-1886` |
| Scoreboard card | Show/Hide the scoreboard, Next page, look | `:1891-1898`; `components/RemoteScoreboardPanel.jsx` |
| Session card | Team switcher; Players & rounds; Categories; Join code (QR, Copy link, "Display on screen" / "Take it off the screen"); **Present / Presenting** (two screens) **or Big screen** (one screen: Top, Results, Bottom, Full screen); Back to Menu | `:1912-2135` |
| Lists | `RemoteSessionPanel` (players, rounds, questions with correct answers) | `:1541-1580` |
| Dock (thumb) | One secondary above the primary, press-twice arming, a hint, **status text only while idle** | `:2143-2193` |

Types: a survey is read as "nothing to press" (`config/hostRemote.js:121-126`); Build Room
is refused (`config/surfaces.js:16-19`, `HostRemote.jsx:2006-2007`;
`config/roomScreen.js:48-50` says "a Build Room, which has no Remote"). Event items are
not modelled at all: `HostRemote.jsx` contains no event handling apart from the goal
(`:492, :1622`).

---

## 2. Host actions and host-attention events, by surface

The columns are: **1S** = one-screen stage (+ Session panel); **Win** = what the room sees;
**Remote**; **Console** (audit A's surface, where seen); **Build** = Build Room on one
screen.

### 2.1 Attention events (things that should reach the host)

| Event | 1S (round types) | Remote | Console (cross-ref A) | Build Room | Notes |
|---|---|---|---|---|---|
| **Someone asks to take a name** | The socket's `handoverRequested` only re-reads players (`GameHostPage.jsx:2846-2848`). It is visible **only** as a row flag inside Session › Players (`PlayersList.jsx:125-129`), in score order: `askingFirst` is not passed (`SessionSetupPanel.jsx:613-619`, default false at `PlayersList.jsx:48`). No dock count (`setupCount` is not passed, `GameHostPage.jsx:8556-8578`). No Not now, no Lock again (`onRefuse` / `onLock` not passed). | **None.** No flag, no strip, no verbs (`RemoteSessionPanel.jsx` has no handover; recorded in `remote-parity/NOTES.md` §1, 12 Oct) | None in the rail or top line (`ConsoleRail.jsx`, `ConsoleTop.jsx`: no handover); only by opening Session › Players | `HandoverStrip` on the Host screen: name, here/away, joined time, **See in Players / Not now / Let them take it** (`BuildSessionPanel.jsx:135-162`; `BuildRoomPage.jsx:1589-1591`); SESSION on the Stage dock carries the count (`BuildStageScreen.jsx:357-358`) | The owner's example. `remote-parity` open questions 1 and 2 recommended Not now / Lock again and a strip for round types (12 Oct). **Not built: drift from recorded intent.** It never reaches the bell either: the bell is the account inbox (`NotificationsBell.jsx:18-27`), not session events. |
| **Late answer / comment arrives** | Dock status "… · 1 late answer kept" with a link to the list (`GameHostPage.jsx:8075-8078`; `Dock.jsx` `statusLink`); the list is Session › Rounds › Late (`SessionSetupPanel.jsx:956-967`) | Count is in `step.status`, which is drawn **only when the dock is idle** (`HostRemote.jsx:2191`; read `:978-1002`). No list, no Show on the wall, no Mark reviewed | Rail section "Late & not reviewed" with count, alert style, the first 3 with both buttons (`ConsoleRail.jsx:106-126`); footer `onReviewLate` (`GameHostPage.jsx:8448`) | n/a (ideas kept; answers refused, host standards table) | Three shapes for one fact. On one screen the review happens in front of the room (§2.3). |
| **Workie read-check warning** ("Workie used words the room's answers don't support…") | Session › Settings › The rounds › Workie, beside Redo, FIELD_NOTES only (`WorkieSettings.jsx:76`; passed `GameHostPage.jsx:9589-9590`, whose comment calls it "the only host-only place for it" on one screen) | Under the read (`HostRemote.jsx:1718`) | `ReadPanel` (`console/panels/ReadPanel.jsx:58`) | n/a | **Privacy hazard, reproduced in #48**: one screen + Session › Settings showed it. `ReadCheckNote.jsx:5-9` says "Never the stage… the room never sees what the host is asked to fix". |
| **Workie's read failed / didn't run** | On the stage itself: failure headline + detail + Retry; "Workie's read didn't run" + Redo (`AISummaryStatus.jsx:80-127`) | **No failure state.** `fieldNotesFrom` has no failure branch (`config/hostRemote.js:777-790`), so a failed read reads "Workie is reading the responses…" indefinitely *(inference)*. No Retry, no Redo | `ReadPanel` has no failure or retry (`ReadPanel.jsx:51-58`); `/present` shows READ_WAIT "Workie is writing…" (`PresentMoments.jsx:713`) *(inference: on two screens a failure is shown nowhere; audit A to confirm)* | n/a | Redo also lives in Session › Settings (`WorkieSettings.jsx:62-74`): two places on one screen, none on the Remote. |
| **AI read ready** | It appears on the stage. The dock primary becomes Next page / Next round | Notes render on poll | Main area | n/a | No cue when the host is elsewhere *(inference)*. |
| **Join** | LOBBY meter count + hover names (`:7563-7566, 7709`); during a round only the meter's denominator moves | Roster count / "n of N" | People section | Players | No per-arrival cue on any round-type surface. |
| **Leave / away** | No presence shown. Sockets `playerLeft` / `playersChanged` re-read (`:2834, 2866`); `PlayersList` shows no connected state for C&A | None | None (`consoleRail.js` uses answered/voted only) | "here now / away" (`BuildSessionPanel.jsx:148`) | A parity gap with Build Room. |
| **Host connection** | **Only** in the Session panel header (`SessionSetupPanel.jsx:499-510`). Nothing on the stage when it drops | "Live / Offline" chip in the bar (`HostRemote.jsx:1465-1473`) | Rail › Session tools summary "● Connected" (`ConsoleRail.jsx:127`) | RoomHeader `connection` + Reconnect (`BuildRoomPage.jsx:1571-1572, 1592-1601`) | On one screen the host learns of a drop only by opening the panel. |
| **Room's window up / not full screen** | n/a (one screen); PRESENT/PRESENTING in the dock on two-screen Stage (`Dock.jsx:239-248`) | "Present / Presenting" (`HostRemote.jsx:2016`) | `RoomWindowStatus` in the top line (`ConsoleTop.jsx:40-47`) | dock "Room's window" + header | Fine. |
| **Account inbox (drafts, invites)** | **No bell**, on purpose (`HostNotificationsBell.jsx:17-18`) | Bell (`HostRemote.jsx:1487`) | Bell (`ConsoleTop.jsx:66`) | `PendingInvites` bar on Host only | A one-screen host has no inbox mid-session. Correct for privacy, but nothing replaces it. |
| **Goal reached** | Rail goal turns amber (`Rail.jsx:44-53`); dock status notice (`GameHostPage.jsx:8560`) | flash (`HostRemote.jsx:1625-1630`) | footer status | n/a | Consistent enough. |

### 2.2 Host actions

| Action | 1S label / control / place | Remote | Console (cross-ref) | Window strip | Build 1S |
|---|---|---|---|---|---|
| Advance | Dock primary (amber) + SPACE cap, from `roundStep` | Thumb primary, press twice to confirm | Footer `HostActionBar` | Forward › | Stage dock primary |
| Step back | ← key (hint only on FIELD_NOTES / FEEDBACK, `:8607-8613`); **no button** | Back a page (read only, `:1677-1687`) | ← key | ‹ Back button | — |
| Join code up / down | Rail code: hover previews, click pins (`Rail.jsx:76-99`); J = side panel in rounds (`:1401-1413`); Settings › Joining **"Put the join code back on the stage"**, which actually toggles in rounds (`SessionSetupPanel.jsx:1244-1246`; `GameHostPage.jsx:7988-7991`) | Session › Join code › "Display on screen" / "Take it off the screen" (`:2083-2095`) | "Join 1234" in the top line, shows only (`GameHostPage.jsx:8406`) | "Show QR (J)" / "Hide QR (J)" | J, Esc; header Join chip |
| Show one response | Click a card → `AnswerSpotlight` on the laptop (`:8840, 8861-8872, 9158-9204`) | This round › "Show on the big screen" → list (`:1843-1885`) | `ResponsesPanel` `onPutOnWall` | ‹ › step | — |
| Put the question back up | Click the recap → expanded question overlay (`:8790, 9709-9757`) | `RemoteFocusPanel` | `onQuestionToWall` | — | — |
| Scoreboard | Session › Players "Show scoreboard on screen" (`setupPanel.js:354-365`); S, V | "Show the scoreboard" / "Hide the scoreboard" (`RemoteScoreboardPanel.jsx:49`) | People › "Show scoreboard" / "Hide scoreboard" (`consoleWords.js:49-50`) | — | n/a |
| Choose next question | Session › Questions (no answers) | "Choose next question" (with correct answers) | Rail › Session tools › Questions | — | — |
| Categories | Session › Questions › Categories | Session › Categories | via panel | — | — |
| Names: grant / remove / restore | Session › Players row buttons | **none** | via panel | — | Players + strip, with Not now and Lock again |
| Late: show / mark reviewed | Session › Rounds › Late | **none** | Rail late section + panel | — | — |
| Redo Workie's read | Stage fallback Redo (`AISummaryStatus.jsx:123-126`) **and** Session › Settings › Workie (`WorkieSettings.jsx:62-74`); failure Retry on the stage | **none** | Settings only *(inference)* | — | — |
| Ask the room | Composer dialog over the stage, `oneScreen` folds Workie's reasons (`GameHostPage.jsx:9411-9429`; `AskComposer.jsx:396-399`) | Icons under the read → sheet (`:1705-1760`) | Inline beside the read (`:8271-8287, 8306-8308`) | — | Composer on Host |
| Report | ENDED primary; Session › Rounds › "Session report" (`SessionSetupPanel.jsx:952-954`) | **none** (`HostRemote.jsx:1900-1911` says so) | `EndedPanel` | — | Now card |
| End session | Session › Settings › fold › "End session" (`:1292-1294`) | **none** ("end" is in `MORE_IDS`, `roundStep.js:44-47`, but the Session card has no End) | via panel | — | Now card |
| Leave | Settings fold "Back to Menu" (`:1279`); in an event, AGENDA (`Dock.jsx:217-228`) | "Back to Menu" (`:2030-2040`) | "← All sessions", which goes to the start screen (#43) | — | "Main menu" |
| Room screen choice | C&A lobby chooser; Settings › Screens (C&A only) | Present link only if this phone's browser stored "two" (`twoSurfacesHere`, `:2007`) | Settings › Screens | — | Setup card + Settings › Screens |
| Display size | Settings › Screens › Room screen size | "Big screen" › "Full screen", which toggles the **profile**, not full screen (`GameHostPage.jsx:1843-1849`) | Settings | F (full screen) | Settings |
| Help | Dock `?` (`Dock.jsx:183`) and panel header `?` | Bar `?` | Top line `?` | — | Dock `?` "build-stage" |

### 2.3 Privacy hazards on one screen (the room can read the laptop)

Ranked by what could escape:

1. **Workie's read-check warning** in Session › Settings (above). Reproduced on test in
   #48 ("exposed the same warning while One screen was pressed"). The code's own comment
   at `GameHostPage.jsx:9589` is the false premise: it calls the Session panel "the only
   host-only place" on one screen.
2. **The late list**, Session › Rounds: each late answer's full text plus its author when
   the round named authors (`LateList.jsx:22-45`; the server withholds the name in a
   hidden round, `lambda-functions/game/late-list.js:175,188`). The host reviews and
   decides "Mark reviewed" with the room reading.
3. **A name-takeover request**: the person's name flagged "Asking to take this name" in
   front of the room (`PlayersList.jsx:125-129`), and the host's decision made in public.
   Build Room deliberately keeps this on the private Host screen
   (`BuildRoomPage.jsx:1588`: "named, on the Host screen only").
4. **Workie's settings**: the voice and approach pickers, and "Briefing on: Workie has
   your briefing" (`WorkieSettings.jsx:118-124`), visible whenever Settings is open.
   This was moved *off* the stage for exactly this reason (QA drive #21,
   `WorkieSettings.jsx:6-14`), into a panel the room still sees on one screen.
5. **The phone-remote QR and URL**, Settings › "Your phone as a remote"
   (`SessionSetupPanel.jsx:1048-1063`). The route is signed in, so this is low risk; the
   email is already held back unless the laptop is private (`remoteSignIn` with
   `privateScreen: twoSurfaces && presenting > 0`, `GameHostPage.jsx:6354`). That is the
   right precedent, applied in one place only.
6. **Scores and the full roster**, Players tab, which opens by default (`:9437`).
   Allowed by the owner's 25 Sep ruling, but it is on screen whenever the host opens
   SESSION for any other reason.
7. **The question browser's upcoming titles**, Questions tab (answers and options are
   already withheld for this reason, `config/setupPanel.js` header). It still spoils
   what is coming.
8. **`window.confirm` for Sign out** (`GameHostPage.jsx:1014`): a browser dialog on the
   projector. Most `alert()` calls have been removed from the live stage; the remaining
   15 matches are in setup and editing paths (`:5613, 5787, 5827, 5857, 6043, 6053`).

Precedents that already get it right, and should become the rule: `AskComposer`'s
`oneScreen` fold (`AskComposer.jsx:396-399`), `remoteSignIn`'s `privateScreen`
(`GameHostPage.jsx:6354`), and the Build Room's private Host screen.

---

## 3. Inconsistencies across views and session types

### 3.1 One act, several names

| Act | Names in use | Where |
|---|---|---|
| The thing the room watches | stage, wall, screen, big screen, room's window, projector, Presentation, PRESENT | "Put the join code back on the stage" (`SessionSetupPanel.jsx:1245`), "Show how this works on the stage" (`:1258`), "Redo the read on screen" (`WorkieSettings.jsx:72`), "Show on the big screen" (`HostRemote.jsx:1851`), "Display on screen" (`:2093`), "Room's window" (`ConsoleTop.jsx:46`), dock "PRESENT" (`Dock.jsx:247`), "Show scoreboard on screen" (`setupPanel.js:361`). The owner ruled "the room's window" on 22 Oct (#43). |
| The host's panel | SESSION (dock), "Session setup" (panel heading, `SessionSetupPanel.jsx:492`), "Session panel" (aria, `Dock.jsx:257`), "Session tools" (console rail, `consoleWords.js:10`), "Session" (Remote card), "SETUP" (stale comment, `config/setupPanel.js:12`) | |
| Join code | JOIN chip, "Put the join code back on the stage", "Display on screen", "Show QR (J)", "Join 1234", "Join code" | above |
| Scoreboard | "Show scoreboard on screen" / "Show scoreboard" / "Show the scoreboard" | §2.2 |
| Leave | "Back to Menu" (panel, Remote), "← All sessions" (console), "Main menu" (Build), "Back to the agenda" (event) | The 8 Oct review's P3 ruled "Main menu" for every one (`ux-consistency-review-2026-10-08/review.md` P3). |
| Players list | Players (tab), People (console), "Players & rounds" (Remote) | |
| Display size | "Room screen size" (Settings), "Full screen" (Remote, which changes the profile) | `config/roomScreen.js` SCREEN_WORDS; `GameHostPage.jsx:1843-1849` |

### 3.2 Things that move between phases, modes or types

- **The QR has three behaviours on one page.** Lobby: full modal. One screen in a round:
  side panel. Two screens: pinned everywhere, a click anywhere takes it down
  (`GameHostPage.jsx:1371-1413, 7981-7996, 9642-9688`). The same rail code does a hover
  preview on one screen and pins on two (`:8538-8539`).
- **Where the host's private material lives depends on the type.** Build Room: a private
  Host screen. Round types: an overlay on the public stage. C&A two screens: the console.
  C&A event on two screens: the wall-style stage on the private laptop.
- **The "Where will the room watch?" chooser** appears only for C&A outside an event
  (`:7229-7231`). An event item silently inherits the browser's stored choice. Trivia,
  Poll and Wavelength get Settings › Screens with the size only (`ScreensGroup.jsx:24-25,
  101-102`), and nothing tells the host why the choice is missing.
- **Session panel entry points change with the mode:** dock SESSION only (one screen);
  dock + strip places (two-screen Stage, `:8486-8490`); rail links (console). `\` works in
  all of them (`useSessionPanelKey`).
- **Redo moves:** on the stage in the fallback state, in Settings otherwise; Retry only on
  the stage in the failure state.
- **Step back** is a key everywhere on the laptop, and a button only on the window's
  strip and (for read pages) on the Remote.

### 3.3 Parity gaps (exists on one surface, missing on another)

| Capability | Has it | Missing on |
|---|---|---|
| Name takeover strip, Not now, Lock again, here/away | Build Room | C&A / Trivia / Poll / Wavelength laptop, console, Remote |
| Name verbs at all (grant, remove, restore) | Laptop panel, Build | Remote (`remote-parity/NOTES.md` §1) |
| Late list actions | Laptop panel, console rail | Remote (count only, and only while idle) |
| Workie failure + Retry / Redo | Stage | Remote, console *(inference)* |
| Host notes "For you" (question background) | Console, two screens only (`GameHostPage.jsx:8288-8290`; fetched only when `twoSurfaces`, `:1329-1351`) | One screen, Remote. Yet `ROOM_WORDS.oneBody` tells the one-screen host "Your phone's Remote can hold the private notes" (`config/roomScreen.js:19`). The Remote holds the read and its warning, not the host notes. |
| End session, Session report | Laptop | Remote |
| Connection status on the main view | Remote, console, Build | One-screen stage |
| Inbox bell | Remote, console, start screen | One-screen stage (by design) |
| Survey control | Laptop | Remote ("nothing to press", `config/hostRemote.js:121-126`), `/present` ("shows on the host's screen") |
| Event awareness ("Bring everyone here" with its confirm) | Laptop dock (`GameHostPage.jsx:7185-7212`) | Remote. *(inference: on a planned event item the Remote's primary is the plain lobby Start, from `remoteStep`, which has no event model; verify before relying on it.)* |
| Correct trivia answer, private, during the round | Remote browser (not the live question) | Laptop one screen (impossible there), console (Trivia has none) |
| Remote "Big screen" scroll | — | Top / Results / Bottom are dead: the stage is `100dvh` with `overflow:hidden` (`styles/stage.css:133,138`), and the `.results-container` selectors the handler looks for exist nowhere else (`GameHostPage.jsx:1831-1842`; grep: only this file) |

### 3.4 Keyboard shortcuts

| Key | One-screen stage | Two-screen Stage / console | `/present` (signed-in host) | Build Room |
|---|---|---|---|---|
| Space / → | advance; → pages first on FIELD_NOTES | same | forward / step | Space = primary |
| ← | back a beat / page | same | back | — |
| J | QR side panel, **rounds only; does nothing in the lobby** (`:1398-1413`) | pins / unpins on every screen (`:1381-1396`) | toggles (`presentControls.js:282`) | toggles codes (`BuildRoomPage.jsx:563`) |
| S / V | scoreboard / its look | same | — | — |
| `\` | Session panel | same | — | same (`BuildRoomPage.jsx:589`) |
| Esc | closes QR / dialogs | same | cancels the safety ask | hides codes (`:579`) |
| F | — | — | full screen | (window) |
| 1-4, P | — | — | — | screens, flip Host ↔ room |
| Enter (+Ctrl) | opens a card | — | confirms | Ctrl+Enter sends to Claude |

The Settings "Keyboard shortcuts" fold (`SessionSetupPanel.jsx:1327-1341`) **omits J**,
the one key the owner asked for twice (13 and 18 Oct).

---

## 4. Top 10 problems, ranked by impact on the host

1. **Host-private material is drawn over the projected stage on one screen**: the
   read-check warning, late answers, takeover requests, Workie settings (§2.3; #48).
   It hits every Trivia, Poll, Wavelength and Survey session, because those types never
   get two screens.
   *Fix direction:* treat the Session panel as public on one screen, as host standards
   §1 already says. Gate the private parts behind an explicit "the room can see this"
   reveal, or send them to the Remote, using the `privateScreen` precedent.
2. **A name-takeover request has no cue on any round-type surface.** It shows only as a
   row flag in an unsorted Players tab, has no Not now or Lock again, and is invisible on
   the Remote and in the console. Build Room solved this with `HandoverStrip` and a dock
   count.
   *Fix direction:* one shared attention slot (the dock's `setupCount` already exists)
   plus Build Room's strip, on a private surface. Wire `onRefuse` / `onLock` /
   `askingFirst`.
3. **There is no single home for host-attention events.** Late items are a dock link on
   one screen, a rail section on the console and an idle-only status on the Remote.
   Connection status is in the panel header, the rail and a bar chip. The read warning is
   in Settings, the read panel and under the read. The bell holds none of these.
   *Fix direction:* define one "needs you" list fed by one model, drawn in a fixed slot on
   each surface (counted in public, named in private).
4. **Three laptop layouts for one type** (console, wall-style Stage on a private laptop
   for event items, one-screen Stage), and a fourth model for Build Room. The host
   relearns where things are as the mode or the type changes.
   *Fix direction:* the console for every private laptop, including event items, and the
   Stage only where the laptop is the room's screen.
5. **The phone Remote cannot act on what it shows**: no name verbs, no late actions, no
   End session, no report, no Workie Retry or Redo, no failure state. Yet the one-screen
   copy sends the host to the Remote for privacy (`roomScreen.js:19, 79`).
   *Fix direction:* close the Remote gaps that one-screen privacy depends on first
   (attention list, read failure, names, late items).
6. **Workie's read failing is handled differently on every surface**: Retry on the stage,
   nothing on the Remote ("reading…" forever, inference) and nothing on the console or
   the window *(inference)*. Redo sits in two places on one screen.
   *Fix direction:* one failure model (`AISummaryStatus`'s states) shared by the Remote,
   the console and the window, and one place for Redo.
7. **Vocabulary for the room's screen and for the host's panel drifts** (stage / wall /
   big screen / room's window / PRESENT; SESSION / Session setup / Session tools), against
   the 22 Oct naming ruling.
   *Fix direction:* one word list (`roundWords`-style) for these nouns and verbs, with a
   parity test across the stage, panel, console, Remote and window.
8. **The QR / join code behaves three ways, and its labels lie**: "Put the join code back
   on the stage" hides it when it is up, J does nothing in the one-screen lobby, and the
   console's Join only shows the code.
   *Fix direction:* one toggle with one label pair everywhere ("Show join code" / "Hide
   join code"), on every surface and in every phase.
9. **The type decides features silently.** The room-screen chooser is C&A-only and is
   skipped in events. Trivia, Poll and Wavelength cannot choose two screens and nothing
   says so. Host notes exist only on two screens. Survey has no Remote and no window
   moment.
   *Fix direction:* show a disabled choice with its reason, as the scoreboard button
   already does ("disabled with its reason"), rather than leaving it absent.
10. **Dead and misleading controls on the Remote and in the help list**: the Big screen
    scroll buttons cannot work against a fixed stage, "Full screen" changes the display
    profile, the shortcuts list omits J, and `useConsole` names types that can never
    reach it.
    *Fix direction:* remove the scroll trio, rename or replace "Full screen" with "Room
    screen size", add J to the list, and narrow line 1272 to what `TWO_SURFACE_TYPES`
    allows.

---

## Appendix: prior intent that this audit checked against

- `docs/design/host-standards/README.md` §1 (one screen is public), §2 (one main button),
  §9 (dusk declared; `Stage` still has none, `Stage.jsx:98`).
- `docs/design/remote-parity/NOTES.md` §1: the takeover gap, recommended fixes, open
  questions 1-2 (unbuilt for round types); §2: Workie pages on the Remote (built:
  `HostRemote.jsx:1665-1688`).
- `docs/design/parity/PLAN.md` §2a: the dock that holds still (built: `Dock.jsx`
  fixed slots, comment at `:112-131`).
- `docs/design/ux-consistency-review-2026-10-08/review.md` P1-P3: one primary per
  surface, three homes for messages, button vocabulary ("Main menu"). P2's "one status
  slot" has not reached the round types.
- GitHub #43 (Dock's aria "Presentation" fixed: `Dock.jsx:242` now says "room's window";
  console "All sessions" target still open) and #48 (the one-screen read-warning exposure,
  reproduced on test at `043a7c93`).
