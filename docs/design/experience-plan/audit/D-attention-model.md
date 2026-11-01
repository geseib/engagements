# D. The attention model — what asks for a person, and where it shows

Audit, 1 Nov 2026. Read-only on application code. Measured against the `engage-design`
skill (component library, hard rules) and the shipped code. Every claim has a `file:line`.
**[inf]** marks an inference I did not run in a browser.

Owner's trigger, verbatim: *"a user moved machines and requested to take over their name on
another device. this was no where visable for the host in two screen mode. when i brought up
the list of people there was no indication. i needed to get full list of people which brought
up the old right hand settings menu and there was the request. why wasnt the alert with the
alarm bell, or anywhere the players name was listed."*

---

## 1. The takeover case, end to end

| Step | What happens | Evidence |
|---|---|---|
| 1 | Player B joins as "Sam"; the server refuses with `NAME_TAKEN`. | `lambda-functions/game/join-game.js:331` (`nameConflictResponse('NAME_TAKEN', …)`) |
| 2 | B sees `JoinNameCollision` (`role="alert"`) and taps **Ask the host to hand it over**. | `src/src/components/JoinNameCollision.jsx:170`, `PlayerPage.jsx:2838-2856` |
| 3 | `POST …/handover-request` writes `HandoverRequestedBy/At` onto Sam's **player row** and calls `notifyHost({type:'handoverRequested'})`. | `lambda-functions/game/request-handover.js:106-131` |
| 4 | `notifyHost` posts to every live HOST socket. If none is connected it logs and returns `sent:false`; nothing is queued. | `lambda-functions/game/host-notify.js:51-54` |
| 5 | The host page does nothing but refetch the roster. The comment says outright: *"There is no toast — … the decision belongs where the two buttons that answer it already are."* | `src/src/GameHostPage.jsx:2840-2849` |
| 6 | The roster row gains `handoverRequested: true`. | `src/src/config/setupPanel.js:305-313` |
| 7 | The **only** C&A/Trivia/Poll/Survey component that reads that flag is `PlayersList`, which prints "Asking to take this name" and tints the row. | `src/src/components/stage/PlayersList.jsx:118,126-130`; `styles.css:821` |
| 8 | `PlayersList` is mounted in one place for these engagements: the **Players tab of the Session panel** (`SessionSetupPanel`, the right-hand `<aside>` the owner calls "the old right hand settings menu"). It is passed no `askingFirst`, no `onRefuse`, no `onLock`, so the asker is not even lifted to the top and there is no **Not now**. | `src/src/components/stage/SessionSetupPanel.jsx:480,613-633` |
| 9 | Two-screen console: the rail's **People** section is built by `consolePeopleFor`, which reduces each player to `{name, state}` — the handover flag is dropped before it reaches the rail. Its "All players" link is what opens the Session panel. | `src/src/config/consoleRail.js:44-68` (lines 51, 63); `components/console/ConsoleRail.jsx:76-84`; `GameHostPage.jsx:8218-8228,8433` |
| 10 | Player B is never told when the host grants: `grant-handover.js` notifies only hosts (`playersChanged`). B must tap **Take over the name** again by hand. | `lambda-functions/game/grant-handover.js:78-79`; `JoinNameCollision.jsx:92-105` |

### Why it misses the bell (exact reason)

1. **The bell is an account inbox, not a session channel.** It lists stored rows under
   `USER#<sub>#NOTIFY` plus "live" entries computed from org/platform state
   (`lambda-functions/game/notifications.js:1-46`, `admin/orgs/my-notifications.js:110-157`).
   `KINDS` has no session kind at all — only drafts, Claude's set, and auto-reports
   (`notifications.js:68-78`). `request-handover.js` never calls `notify()`.
2. **It is polled, not pushed:** once on mount, on focus (≥60 s apart), and every 5 minutes
   (`NotificationsBell.jsx:36-37,63-68`). It has no WebSocket subscription, so even a session
   kind would arrive up to 5 minutes late.
3. **Its links all point away from the session.** `destinationOf` knows `draft`, `section`,
   `invites`, `build` — every one a console or Build Room URL (`utils/notificationsApi.js`
   `destinationOf`), and on the two-screen console a click opens a **new tab**
   (`ConsoleTop.jsx:66`, `HostNotificationsBell.jsx:23-35`). There is no "go to this person in
   this session" destination.
4. The host page comment at `GameHostPage.jsx:2843-2845` records the decision not to alert.

### Why it misses every list the name appears in (exact reason)

The handover state lives only in `rosterRows` → `PlayersList`. Every other list of names on the
host's private screens is built from bare names:

| List | Built from | Flag? |
|---|---|---|
| Console rail · People | `consolePeopleFor` → `{name,state}` (`consoleRail.js:51,63`) | No |
| Console Lobby panel ("Joined so far") | `players.map(p => p.name)` (`GameHostPage.jsx:8344`; `console/panels/SimplePanels.jsx:18-20`) | No |
| Workflow strip "Players N" place (one-screen two-surface title bar) | `players.length` (`GameHostPage.jsx:8486-8490`) | No count of askers |
| Dock SESSION button | `Dock` supports `setupCount` (`stage/Dock.jsx:124-127,255-264`), but **GameHostPage never passes it** — only the Build Room does (`buildroom/screens/BuildStageScreen.jsx:357`) | No |
| Phone remote · Players tab | `RemoteSessionPanel.jsx:235-250`; the remote holds no WebSocket (`HostRemote.jsx:216,501`) and `config/hostRemote.js` has no `handover` | No |
| Session panel · Players tab | `PlayersList` | **Yes** (only here) |

### It was designed and not built

- `docs/design/two-surface/PLAN.md:473` (task 3.6) specifies `NameRequestStrip.jsx` "above the
  dock" plus `config/nameActions.js`; `:486` makes "A name request appears in the strip above the
  dock and never on the wall" an owner verification step; `:497` (task 4.3) puts a request strip
  on the Remote. Neither file exists (`git log -S NameRequestStrip` finds only the plan commits
  `06be492ee`, `6e8af6d31`).
- **The Build Room shipped exactly this.** `HandoverStrip` (`buildroom/BuildSessionPanel.jsx:135-162`,
  `role="region"`, names the person, **See in Players / Not now / Let them take it**) is rendered
  on the Build console and the Host screen (`BuildRoomPage.jsx:1417,1590`), plus an "asking"
  pill (`:2407-2408`), a count on the Session button (`:2429`) and on the Stage dock
  (`BuildStageScreen.jsx:357`), with `askingFirst` lifting the row (`BuildSessionPanel.jsx:497-501`).
  Call & Answer, Trivia, Polls and Surveys got none of it.
- **The help says it is there.** `config/help/host-running.js:628`: *"Their row on your Players
  tab now reads 'asking to take this name', and **SESSION** on the dock shows a count."* No count
  is passed outside the Build Room, and the two-screen console has no Dock at all
  (`HostConsole.jsx:84` uses `ConsoleFooter`). This contradicts what shipped.

### Two smaller holes on the same path

- The player's screen advances to "Asked the host…" **even when the request failed**
  (`PlayerPage.jsx:2848-2855`: the `catch` logs and falls through; `res.ok` is never checked).
  A failed ask reads to the player as a sent one.
- In C&A there is no **Not now** (`SessionSetupPanel.jsx:613-618`), and the request has no
  expiry, so an ignored coincidental ask stays on the row "Asking to take this name" for the
  rest of the session (`request-handover.js:110` writes no ttl/expiry) **[inf: no clearing path
  found besides grant]**.

---

## 2. Inventory

Columns: **Bell** = reaches the inbox. **Next to it** = shown beside the person/item it concerns.
**Life** = persists until acted on, or vanishes. **2-screen** = a two-screen host sees it without
hunting (opening a panel/tab counts as hunting).

### 2a. In a session (host)

| # | Event | Producer | Surfaces & control | Bell | Next to it | Life | 2-screen |
|---|---|---|---|---|---|---|---|
| 1 | **Name takeover asked** | `game/request-handover.js:106-131` → WS `handoverRequested` | Session panel › Players: printed flag + amber row tint (`PlayersList.jsx:118,126-130`). Build Room only: strip, pill, counts (§1). | No | Only in Players tab | Persists on the player row; no expiry | **No** |
| 2 | Name unlocked (host granted) → player | `game/grant-handover.js:78` (hosts only) | Player is not told; `JoinNameCollision` note says "tap Take over" (`JoinNameCollision.jsx:93-95`) | n/a | — | Pull only | n/a |
| 3 | Late answer / late comment / ask after its round | `game/late-list.js:305,327,362`; `game/comments.js:922`; `websocket/message.js:841`; `game/followups.js:261,347` | Console rail **Late & not reviewed** with an accent-coloured count (`ConsoleRail.jsx:106`, `HostConsole.css:24`); footer status link "Review" (`ConsoleFooter.jsx:25-32`); one-screen Dock status link (`Dock.jsx:141`); Rounds tab `LateList` | No | Yes (rail lists first 3 with Show / Mark reviewed, `ConsoleRail.jsx:107-122`) | Persists until reviewed | **Yes** — the one event done right |
| 4 | Workie read uses unsupported words (read check) | `game/get-ai-summary.js` (`readCheck`) | `ReadCheckNote` `role="status"`, muted: console Read panel (`console/panels/ReadPanel.jsx:58`, class `hc-muted`), Session panel › Workie (`stage/WorkieSettings.jsx:77`), Remote (`HostRemote.jsx:1718`) | No | Yes (under the read) | With the read | Yes, but muted 12-13px |
| 5 | **Workie read failed** | `game/get-ai-summary.js:1360` → `aiSummaryError`; client `GameHostPage.jsx:3185-3194` | One-screen stage: `AISummaryStatus` `role="alert"` with Retry/Redo (`GameHostPage.jsx:9225-9235`, `AISummaryStatus.jsx:82`). **Console:** `ReadPanel` takes no failure/retry prop (`ReadPanel.jsx:48`; call sites `GameHostPage.jsx:8307,8358`), and `notesReadyFor` treats a failure as "ready" (`config/hostControls.js:844-845`), so the strip stops saying "Workie writing" | No | — | Until next read | **No** — an empty "Workie's read" card, no retry **[inf: rendered state not run]** |
| 6 | Read ready | `aiSummaryReady` | Strip "Workie writing" clears (`config/workflowStrip.js:71`); primary enables | No | Yes | — | Yes |
| 7 | Host socket lost | `GameHostPage.jsx:954` (`wsConnected`) | Console rail Tools summary "Offline", muted 12px, no `alert` class (`ConsoleRail.jsx:127`); one-screen: Session panel header icon only (`SessionSetupPanel.jsx:500-507`) | No | — | While offline | Weak. Every push in this table (incl. #1) is lost meanwhile; recovery relies on a refetch at reconnect (`GameHostPage.jsx:2822-2826,3827`) **[inf]** |
| 8 | Room's window closed / not visible | host-state poll every 10 s (`GameHostPage.jsx:1348`) | `RoomWindowStatus` on the console top line, `role="status"` + `aria-live` note (`ConsoleTop.jsx:39-46`, `stage/RoomWindowStatus.jsx:52-56`) | No | Yes | While true | Yes |
| 9 | Player joined / left | `game/join-game.js:568`; `websocket/schema-compliant-manager.js:624` | Counts only. C&A rows carry no here/away (`setupPanel.js:305-313`); Build Room shows "here now / away" (`BuildSessionPanel.jsx:146`) | No | No | — | Count only |
| 10 | Player removed/restored on host's other device | `playerRemoved`/`playerRestored` (`GameHostPage.jsx:2854-2862`) | Refetch; "removed from the room" list in Players tab (`PlayersList.jsx:239-267`) | No | Players tab | Persists | No (tab) |
| 11 | Host button refused | `sessionActionError` | Console footer status, tone error, **no aria-live** (`GameHostPage.jsx:8442-8444`, `ConsoleFooter.jsx:68-69`); one-screen Dock status `aria-live="polite"` (`Dock.jsx:144-147`) | No | Yes (by the button) | Until next action | Yes |
| 12 | Survey progress / closing / closed | `game/survey-answers.js`, `game/survey-host.js` | Counts on console and wall | No | — | — | Yes (informational) |
| 13 | Agenda item moved on elsewhere | `eventItemPaused/Started`, `eventEnded` (`GameHostPage.jsx:3203-3205`) | Dock offers "Bring everyone back" | No | Yes | Until acted | Yes |
| 14 | Build Room: Claude's asks / room ideas waiting | `buildroom/buildScreens.js:46-60` (`waitingCount`) | Count on Host tab & Stage dock (`BuildStageScreen.jsx:117`), "Waiting for you · n" (`BuildRoomPage.jsx:1715`), queue cards | No | Yes (queue) | Until decided | Yes |
| 15 | Build Room: Claude's question set unsaved | `game/build-room.js:2824` → `notify(quiet)` | Bell, written read; unread reminder 2 days before session end (`notifications.js:58-65,206-222`) | **Yes** | — | Reminder | Bell |
| 16 | Build Room: handover | as #1 | Strip + pill + 2 counts (§1) | No | Yes | Until answered | **Yes** |
| 17 | Team invitation (for the signed-in host) | `my-notifications.js` invite entries | `PendingInvites` bar on Welcome (`WelcomeScreen.jsx:192`), App/PendingApproval, Build Room Host screen (`BuildRoomPage.jsx:1416,1587`); bell live entry | Yes | — | Live | Bell only on GameHostPage (no bar there) |

### 2b. Outside a session (host / org admin / platform admin)

| # | Event | Producer | Surfaces | Bell | Persists |
|---|---|---|---|---|---|
| 18 | AI draft ready / partial / failed | `admin/shared/generation-drafts.js:427` | Bell stored row, reminder 5 d before expiry (`notifications.js:55-56,80-85`); `GenerationJobPanel` in place | Yes | Yes |
| 19 | Report auto-built / could not be built | `game/report-sweep.js:365,382` | Bell only; Reports section | Yes | Yes (30-day ttl) |
| 20 | Sets sent back by content check | `my-notifications.js:60-66` (live) | Bell; Question sets nav **badge** (`AdminPage.jsx:1835`) | Yes | Live |
| 21 | People waiting to host / invites expiring / cap reached (org admin) | `my-notifications.js:68-88` | Bell; nav badge for accounts (`AdminPage.jsx:1852`) | Yes | Live |
| 22 | Platform: accounts, plan requests, moderation | `my-notifications.js:98-106` | Bell; nav badge/count (`AdminPage.jsx:1843-1852`, `AdminShell.jsx:134-140`) | Yes | Live |
| 23 | Monitoring alarm | `monitoring/evaluate-monitors.js:62` | SNS email, outside the app | No | — |

### 2c. Participant

| # | Event | Surfaces & control |
|---|---|---|
| 24 | Name taken / unverified | `JoinNameCollision` `role="alert"` + `aria-live` step note (`JoinNameCollision.jsx:170-183`) |
| 25 | Answer/vote submit failed, vote incomplete, voting closed | **`alert()`** (`PlayerPage.jsx:2591,2674,2687,2698,2726,2750`) |
| 26 | Handover ask failed | Silently reported as sent (`PlayerPage.jsx:2848-2855`) |

---

## 3. `window.alert` / `confirm` (breaks the visual language)

Grep of `src/src` excluding tests and comments. 44 live calls.

**`alert()` — 14**
- Player, mid-round: `PlayerPage.jsx:2591, 2674, 2687, 2698, 2726, 2750`
- Host, session list/edit: `GameHostPage.jsx:5613, 5787, 5827, 5857, 6043, 6053`
- `components/QuickstartMenu.jsx:290`, `components/GameReport.jsx:270`

**`window.confirm()` — 30** (2 sign-out, 10 decisions, 18 dirty-close guards)
- Sign out: `AdminPage.jsx:972`, `GameHostPage.jsx:1014`
- Destructive/decision (should be the small confirm `Modal`, hard rule 12): `components/OverviewPanel.jsx:371,388`, `components/UserManagement.jsx:443,585`, `components/DiscountCodesPanel.jsx:43`, `components/SessionsPanel.jsx:170,212`, `components/DraftReview.jsx:212`, `components/SurveyAIBuilder.jsx:283`, `components/PollAIBuilder.jsx:332`
- Dirty-close guards inside a `Modal` (the `requestClose()` confirm, done natively): `SurveyAIBuilder.jsx:350`, `AIScenarioBuilder.jsx:1092`, `EventDetailsDialog.jsx:92`, `OrgBillingDrawer.jsx:161`, `DiscountCodesPanel.jsx:110`, `EventItemDialog.jsx:273`, `PollAIBuilder.jsx:446`, `TriviaAIBuilder.jsx:429`, `PlanRequestsPanel.jsx:164`, `NewSetDialog.jsx:35`, `AddQuestionsDialog.jsx:80`, `PlatformOrgsPanel.jsx:331`, `PlanRequestDialog.jsx:63`, `buildroom/BuildRoomPage.jsx:4433,4759`, `buildroom/BuildCrew.jsx:244,724,746`

No `window.prompt`. No audio anywhere (`config/help/technical.js:138-139`). No browser
Notification API, no `document.title` badge (only `GameReport.jsx:234`), no toast component.

---

## 4. Gaps

1. **No session-scoped "needs you" channel.** The bell is account-scoped and polled; session
   pushes go to `notifyHost` and each page decides alone what to draw. There is no shared idea of
   "pending host decisions in this session".
2. **Flags live only on the list that is behind a door.** Takeover and removals render only in the
   Session panel's Players tab; every visible list of names (rail, lobby, remote) is built from
   bare names (§1 table).
3. **The two-screen console lost things the one-screen stage has:** AI-read failure + Retry (#5),
   and the Dock's SESSION-count hook (#1). The console has no dock and no strip slot for alerts.
4. **The phone remote is blind to every push** (no socket) and has no handover data.
5. **The player is never told the outcome** of an ask (granted / not now arrives only on retry),
   and a failed ask looks sent.
6. **Offline is quiet.** A dropped host socket loses every push in §2a, and says so in muted 12px
   in a rail summary.
7. **Help contradicts shipped behaviour** (`host-running.js:628`).

## 5. Inconsistent treatments (same urgency, different style)

| Urgency | Treatments in use |
|---|---|
| "A person is waiting on you right now" | Build Room handover: named strip with three buttons + two counts. C&A handover: a printed chip inside a closed side panel. Late item: accent count in an always-visible rail summary. Claude's ask: count on a tab. |
| "Something failed, act" | AI read: `role="alert"` card with Retry (stage only). Late-button refusal: `role="alert"` line in rail (`ConsoleRail.jsx:125`). Host action refused: footer status, no live region on the console. Player submit failure: native `alert()`. |
| "Background thing needs you later" | Bell (drafts, reports, Claude's set). Nav badges (flagged sets, accounts, plan requests). `PendingInvites` bar (some pages only). Same facts sometimes in two (bell + badge), invites in bell on the host page but bar elsewhere. |
| Error tone | `StatusMessage` always renders `role="status"` + `aria-live="polite"`, even for errors (`StatusMessage.jsx:20`); `AISummaryStatus` and `LateList` use `role="alert"`. |
| Dirty-close confirm | Native `window.confirm` in 18 dirty-close guards vs. in-Modal confirm elsewhere (`AIPromptManager.jsx:1452` records the conversion of its own). |
| Rail section counts | `Section` accepts `alert` but only Late passes it (`ConsoleRail.jsx:22,106`); People and Tools (Offline) never go amber. |

## 6. Ranked top 10

| # | Fix direction (one line) | Evidence |
|---|---|---|
| 1 | Port the Build Room's `HandoverStrip` to the C&A/Trivia/Poll/Survey host — console main area above the panel and one-screen above the dock (the planned `NameRequestStrip`). | `BuildSessionPanel.jsx:135-162`; `two-surface/PLAN.md:473,486` |
| 2 | Carry `handoverRequested` through `consolePeopleFor` and the Lobby panel so the flag + action appear wherever the name is listed, and open the rail's People section (amber `alert`) while anyone is asking. | `consoleRail.js:51,63`; `SimplePanels.jsx:20`; `ConsoleRail.jsx:76` |
| 3 | Define a session-scoped "waiting on you" count (handover, late, failed read) and show it on a fixed console spot and the Dock's existing `setupCount`. | `Dock.jsx:124-127`; `GameHostPage.jsx` (no `setupCount`) |
| 4 | Give the console's Read panel the failure + Retry/Redo that `AISummaryStatus` gives the stage. | `ReadPanel.jsx:48`; `GameHostPage.jsx:9225-9235` |
| 5 | Decide the bell's scope explicitly: either a session kind (pushed, deep-linking into the live session without a new tab) or a documented rule that in-session asks never go there — and say which in help. | `notifications.js:68-78`; `NotificationsBell.jsx:36-37`; `HostNotificationsBell.jsx:23-35` |
| 6 | Wire **Not now** and `askingFirst` in `SessionSetupPanel`'s `PlayersList`, and give an ask an expiry. | `SessionSetupPanel.jsx:613-618`; `PlayersList.jsx:46-48,153-162` |
| 7 | Tell the asker the outcome (push or poll), and check `res.ok` before saying "Asked the host". | `grant-handover.js:78`; `PlayerPage.jsx:2843-2855` |
| 8 | Make host offline loud (amber rail/top-line state) and refetch the roster and late list on reconnect. | `ConsoleRail.jsx:127`; `SessionSetupPanel.jsx:500-507` |
| 9 | Replace the six player `alert()`s and the host session-list `alert()`s with inline `StatusMessage`/dock status; move the 10 decision `confirm()`s to the small confirm Modal. | §3 |
| 10 | Fix the help (`host-running.js:628`) now, and give the phone remote the handover flag + verbs (PLAN 4.3). | `host-running.js:628`; `RemoteSessionPanel.jsx:235-250`; `PLAN.md:497` |
