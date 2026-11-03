# The Session menu, simplified

Design only, 3 Nov 2026. This changes no application code. The mockup is `index.html`; `node docs/design/session-menu/shoot.js`
renders frames `1-*.png` (it also checks for overflow, clipping and text under the 12px floor; all ten frames came back clean).
The desk reviews are in `reviews.md`.

**The owner, 3 Nov:** *"there is also a bit of clutter in the session menu now at least for call and answer (check the other types as
well). This is part of an event … The agenda tab shows nothing but the link to the agenda screen. The rounds is only the questions
queue and list of all questions, but it also has a ton of options at the bottom (confusing). there used to be a questions and rounds
tabs with rounds showing the previous round where you could go back and see previous rounds or generate the report. really think
through how to provide all the functionality while simplifying the basic views here. advanced setting etc, could be in expanded
sections. remember we want the first experience to be really simple and easy to navigate."*

## 1. What went wrong

- **Rounds is three sections stacked in one scroll.** The current order in `SessionSetupPanel.jsx:852-1367` is: categories →
  running order → a question browser that can run to 60 rows (`:964-1170`) → Rounds so far (`:1173-1259`) → "How the rounds
  run", with twelve controls and notes (`:1261-1365`). The report and the past rounds sit **below the whole question set**. That is
  the "ton of options at the bottom", and it is how the owner lost the Rounds tab he liked.
- **The tab he liked existed.** `410ec35db` (14 Aug), *"Add a Rounds tab, and reopen any round that already happened"*, made the
  tabs Players · Questions · **Rounds** · Settings (`git show 4f746bc96:src/src/config/setupPanel.js:64-74`). Its note read:
  "Third rather than last because it is read mid-session … while Settings is set once and left alone." Later the Session report
  moved to the top of that tab, at the owner's request. `15022a303` (2 Nov, the Phase 2 QA restructure) merged Questions,
  Rounds and the run settings into one "Rounds" tab.
- **The Agenda tab holds one link** (`:695-717`). Both of its buttons already exist outside the menu. *‹ Agenda* is the steps
  strip's first crumb (`WorkflowStrip.jsx:72-88`). *Bring everyone here* is Your part now's main button while the room is on
  another item (`GameHostPage.jsx:7835-7839`).
- **End session is a whole tab** (`:1497-1575`) for one button plus Leave without ending, Main menu, Admin and Sign out.
- **Every type names the parts differently.** The Build Room has Players / Settings (`BuildSessionPanel.jsx:458-461`). The phone
  has Players / Rounds / Questions (`hostRemote.js:663-669`), and its Session card shows "Players & rounds" and "Choose next
  question", two doors into the same panel (`HostRemote.jsx:2052, 2188`).

## 2. The decisions

| # | Decision | Why |
|---|---|---|
| D1 | **The same five sections on every round type, with plain names:** **Up next · Rounds so far · Screens · Joining · How it runs.** A type removes a section or swaps it for its own equivalent (Survey: Close survey / Results; Build Room: Claude / Asks so far); it never renames a shared one. **People** is added only where the frame has no People column (one screen, Survey, Setup), the same rule as `setupPanelTabs` today. | PLAN §3.2a: "only adding or subtracting items that apply". Five short names fit one row of a 600px sheet at 13px. |
| D2 | **Each section opens on a short default view (at most four groups), then one More options line.** When closed, the line names what it holds, e.g. "More options · Category switches · Put aside this session (1) · Goal", so nothing is hidden blind. One expander per section and no nesting. It stays open for the rest of the session once opened (per-viewer `localStorage`, wrapped in try/catch). | Owner: "advanced setting etc, could be in expanded sections". An expander that does not say what is inside is a hiding place, which is the mistake the header comment at `:631-652` records about Help. |
| D3 | **Rounds so far is a section of its own, and the report comes first in it.** Before round 1 it says "The report and each round appear here once a round has been played" and draws no dead button (review R5). Then a late-answers line (Review opens the late list in place), then every round played. Each round opens the shipped `PastRound` dialog with Previous / Next and redo-the-read. | What the owner valued, restored: "go back and see previous rounds or generate the report". |
| D4 | **Up next keeps only the running order and the two ways to add a round.** *Write a question* and *Choose from the set* each open as an inline step with "‹ Up next" to return. The 60-row browser is no longer drawn by default. Categories collapse to one line ("4 of 6 on · 23 questions left · Change"). | impromptu-ask D2 already made the composer an inline step; the browser gets the same treatment. Never a modal inside the sheet (engage-design). |
| D5 | **Events: no Agenda tab.** One line under the header, in every section: **This event · item 3 of 6** with **‹ Agenda**, plus **Bring everyone here** while the room is elsewhere. The menu opens on Up next. | Its two buttons already live in the crumb and in Your part now (§1). The line keeps the menu answering "where am I". |
| D6 | **End session and Main menu move to the sheet's foot**, shown in every section. End session is `--danger-text` and confirmed (the shipped confirm on the page's action). The "Leave without ending" explanation becomes Main menu's tooltip (`HW.mainMenuHint`). | PLAN §3.2b: "End session and Sign out at its foot". The dev QA 2 Nov rule (End session in every phase) holds, because the foot is always there. |
| D7 | **Phone remote folds into Screens** as "Your phone as a remote · Connect your phone". The QR opens inline, with the sign-in words from `config/remoteSignIn.js`. | It is a screen the host drives the room from, and it is set once. One screen surfaces it near the top (PLAN §3.3). |
| D8 | **How it runs shows only Names (where it applies) and Pace by default.** Who is still waiting, Comments on the wall and Workie's voice / approach / briefing go in More options. Every "From the next round" and "waiting for round N" tag stays; "Applies now" is no longer printed, because it is the default (review R4). | Names is the one control that changes what the room learns about a colleague (header note, `:1264-1266`). Pace changes how the room experiences the session. Everything else is tuning. |
| D9 | **Running-order rows show ↑ ↓ ⋯.** ⋯ holds Ask now, Put aside for this session and Remove (Edit / Remove for a Yours row). Browser rows show **Queue** and **Ask next**, with Ask now in ⋯ alongside its warning. | Four or five buttons per row is the wall. The interrupting action sits one step further away, as the "ordered by how much they disturb" note (`:1118-1120`) argues. |
| D10 | **The Build Room and the phone use the same names.** Build Room: **Claude · Asks so far · Screens · Joining** with the same foot. Phone: **Up next · Rounds so far · People**, and its Session card becomes those three doors plus Join code · Room's screen · Main menu. | One menu to learn. The phone's Rounds so far gains the report it never had. |

## 3. Every control, classified, and where it goes

Key: **E** everyday (used while running), **S** set once, **R** rare or advanced. "Default" means the section's default view;
"More" means its More options. Line numbers are in `src/src/components/stage/SessionSetupPanel.jsx` unless another file is named.

### Call & Answer (standalone, two screens), the baseline

| Control (today's tab) | Line | Class | New home |
|---|---|---|---|
| Header: Connected, `?`, ✕ | 619-668 | E | Header, unchanged. `?` opens the guide for the section on show (`TAB_HELP`). |
| Agenda button (Agenda, event) | 699-709 | E | Event line under the header: **‹ Agenda** (it is also the strip's crumb). |
| Bring everyone here (Agenda, event) | 710-714 | E | Event line, only while the room is elsewhere (it is also Your part now's main button). |
| Where the room watches, one / two (Screens) | 725-734 | S | Screens · default |
| Room's window state, Open (Screens) | ScreensGroup | E | Screens · default |
| Room screen size (Screens) | ScreensGroup | S | Screens · More |
| Show / hide scoreboard (Screens) | 744-764 | E | Screens · default (Trivia, C&A). Also stays on the rail's People section. |
| Scoreboard style (Screens) | 768-787 | R | Screens · More |
| Show how this works on the stage (Screens) | 796 | R | Screens · More, renamed "Show how this works on the room's screen" (§3.6) |
| Keyboard shortcuts (Screens) | 799-813 | R | Screens · More (and the `?` guide) |
| Phone QR, URL, who may sign in (Phone remote) | 829-844 | S | Screens · default: "Your phone as a remote", with **Connect your phone** opening the QR inline |
| "Changes wait for the next round" note (Rounds) | 854 | S | How it runs, as its lede |
| Write a question, composer step (Rounds) | 855-859, 925-930 | E | Up next · default (an inline step; one screen gets the host-only choice first, impromptu-ask D8) |
| Own-question status line with Undo (Rounds) | 916-924 | E | Up next, above the running order |
| Categories: remaining count and chips (Rounds) | 861-898 | S | Up next · default **summary line** "4 of 6 on · N left · Change"; the switches are in Up next · More |
| Goal progress (Rounds) | 865-869 | E | Up next: the running order's scope line ("Question 3 of 5") and Up next · More |
| Running order (QueueList), private on one screen (Rounds) | 931-958 | E | Up next · default, first. Five rows, then "Show all". |
| Row: ↑ ↓ (QueueList) | QueueList 317-323 | E | Row |
| Row: Ask next (QueueList) | QueueList 255-266 | E | Row ⋯ (in the order, Ask next is the same as moving to the top) |
| Row: Ask now (QueueList) | QueueList 267-273 | R | Row ⋯, with its "ends the round on screen" line |
| Row: Disable for this session / Remove / Edit and remove own | QueueList 416-452, 533-551 | R | Row ⋯ ("Put aside for this session", Remove, Edit) |
| Put-aside list with Restore (QueueList excluded) | QueueList 645-692 | R | Up next · More, "Put aside this session" |
| Parked and advisory tags (QueueList) | QueueList | E | Row tags, unchanged |
| Question browser: search, category chips, Unasked only, Enabled only (Rounds) | 964-1016 | E/R | **Up next › Choose from the set** step: search, one Category select, "Hide asked" on by default. Enabled only becomes an option in the Category select ("Categories that are on"). |
| "Correct answers are not on this screen" (Rounds) | 1022-1026 | E | The Choose step, shortened to one line |
| Browser count, loading, empty (Rounds) | 1028-1035 | E | The Choose step |
| Browser row: Asked / Off / Queued #n tags | 1071-1098 | E | The Choose step's rows, unchanged |
| Browser row: Queue / Unqueue, Ask next | 1129-1155 | E | The Choose step's rows |
| Browser row: Ask now / Ask again now | 1156-1163 | R | The Choose step, row ⋯ |
| Session report (Rounds so far) | 1192-1194 | E | **Rounds so far · default, first**: the report card, **Open the report** (`handleViewReports`, `GameHostPage.jsx:6688`) |
| Late list with its help `?`, Show / Mark reviewed / Close comments (Rounds so far) | 1196-1213 | E | Rounds so far · default: a one-line count, with **Review** opening `LateList` in place. Close comments stays inside LateList. |
| Rounds played, AI badge, Yours mark, open the round (Rounds so far) | 1224-1258 | E | Rounds so far · default |
| PastRound: Previous / Next / redo the read / spotlight | `PastRound.jsx:180-215` | E | Unchanged, opened from a round row |
| Names: show who wrote each response, plus two notes (How the rounds run) | 1267-1301 | S | How it runs · default (C&A only); the two notes become one |
| Name who is still waiting, with its caution (How the rounds run) | 1303-1336 | R | How it runs · More |
| Comments on the wall (afterRoundSettings) | 541-555 | S | How it runs · More |
| Include items not reviewed in the report (afterRoundSettings) | 557-568 | R | Rounds so far · More (it changes only the report) |
| Workie: voice, approach, briefing chip (afterRoundSettings) | 570-581, `WorkieSettings.jsx` | S | How it runs · More (behind Show on this screen on one screen, as today) |
| Workie: Redo the read on screen, model picker, read-check note | `WorkieSettings.jsx:61-80` | E | **Fork F4.** Recommended: next to Workie's read in the content area (and the Remote), with a copy kept in How it runs · More while a read is up |
| Pace: auto-advance (How the rounds run) | 1345-1361 | S | How it runs · default |
| Join URL, session code (Joining) | 1373-1375 | E | Joining · default, with a QR |
| Copy join link, Show join code (Joining) | 1377, 1385-1387 | E | Joining · default |
| Invite… calendar blob (Joining) | 1382-1384 | R | Joining · More |
| People list, handover grant / refuse / lock, remove / restore, scores (People) | 1425-1492 | E | Unchanged. A section only where there is no People column. Elsewhere it is still the view opened from the rail's "All N, and who left". |
| End session with its note (End session) | 1497-1517 | E | **Foot**, every section, confirmed |
| Leave without ending, Main menu (End session) | 1519-1543 | E | **Foot**: Main menu, with the "session keeps running" hint as its tooltip |
| Admin ↗ (End session) | 1561-1570 | R | **Fork F5.** Recommended: removed from the live menu, since Home has it (`WelcomeScreen.jsx:191`) |
| Sign out (End session) | 1571 | R | **Fork F5.** Recommended: removed from the live menu, since Home has it (`WelcomeScreen.jsx:195`) |

### The other types, by difference from the baseline

| Type | Control | Line | Class | New home |
|---|---|---|---|---|
| C&A event item | Agenda tab | 695-717 | — | Gone; the event line (D5) replaces it |
| C&A one screen | Private reveals (running order, late, Workie, name requests) | 931, 1205, 571, 1481 | E | Unchanged, in their new sections. Screens puts **Connect your phone** near the top. |
| Trivia | Names | 1267 | — | Not offered (`anonymityApplies`, no vote). How it runs default shows Pace only. |
| Trivia | Write a question | — | — | Not offered (impromptu-ask D1: it writes a C&A round) |
| Poll | Scoreboard | 737 | — | Not offered (`BOARD_TYPES`, `scoreboard.js:68`) |
| Wavelength | One / two chooser | ScreensGroup | — | Screens says why it is one screen (`ONE_SCREEN_WHY`); no chooser |
| Survey | Close survey, two-minute warning | 1396-1413 | E | **Close survey** section · default, first |
| Survey | "After it closes" (feedback, report, Workie) | 1414-1417 | S | **How it runs** (D1: the same home as every type) |
| Survey | Report | (main button only) | E | **Results** section · default: the report card, "ready when the survey closes" |
| Survey | End session (only after closing) | 1501-1509 | E | Foot, disabled with "Close the survey first" until it is closed |
| Build Room | Players tab (filters Here / Away / Builders, search) | `BuildSessionPanel.jsx:507-531` | E | People is in the console rail (`BuildConsole.jsx:41-56`). The full list is a view from the rail's link, as on C&A. |
| Build Room | Screens group: choice, room's window, size | `:302-320` | S | Screens · default (size goes in More) |
| Build Room | New link (armed) | `:321-329` | R | Screens · More |
| Build Room | Look here, privately: Build / History | `:537-544` | R | Screens · More; History is also reachable from each row in **Asks so far** |
| Build Room | Join tile, copy, Show on the Stage | `:230-260` | E | Joining · default |
| Build Room | Demo tile, Wi-Fi share, quiet warning, app list, Stop sharing | `:245-258` | S | Joining · More ("Share the demo on this Wi-Fi") |
| Build Room | List names on the room meter | `:550-556` | S | Joining · More |
| Build Room | Claude chip, Connect Claude Code, continue slot | `:561-581` | E | **Claude** · default |
| Build Room | Auto switch ("questions wait for you") | `:582-583` | S | Claude · default |
| Build Room | Posts release gate | `:585-595` | S | Claude · default |
| Build Room | Plugin version, update | `:572-579` | R | Claude · More |
| Build Room | Crew: builders, Crew, crew code, Open to a crew | `:598-615` | S | Claude · More |
| Build Room | Back to the opening | `:620-625` | R | Claude · More |
| Build Room | Report, Wrap up | `:626-629` | E | **Asks so far** · default: report first, then Wrap up |
| Build Room | End session | `:630-635` | E | Foot |
| Build Room | Keys line, foot Close | `:638-648` | R | Screens · More (keys). The foot becomes End session · Main menu, and ✕ closes, as on C&A. |
| Phone Remote | Session card: Players & rounds | `HostRemote.jsx:2188-2192` | E | Card door **People**. Also **Up next** and **Rounds so far** doors. |
| Phone Remote | This round: Choose next question | `HostRemote.jsx:2049-2056` | E | Card door **Up next** (one door, not two) |
| Phone Remote | Categories (inline list) | `HostRemote.jsx:2194-2202, 2263-2282` | S | Up next tab's Categories line, with **Change** opening `RemoteCategoryList` |
| Phone Remote | Join code (QR, copy, Display on screen) | `HostRemote.jsx:2204-2310` | E | Unchanged; "Display on screen" becomes **Show join code** (§3.6) |
| Phone Remote | Present / Big screen | `HostRemote.jsx:2220-2245` | E | "Room's screen" (§3.6), same behaviour |
| Phone Remote | Back to Menu | `HostRemote.jsx:2247-2256` | E | **Main menu** (§3.6) |
| Phone Remote | Players tab (rank, score, tick) | `RemoteSessionPanel.jsx:242-289` | E | **People** tab |
| Phone Remote | Rounds tab: Write a question, round accordion, Workie had | `RemoteSessionPanel.jsx:291-382` | E | **Rounds so far** tab, with the report on top. Write a question moves to Up next. |
| Phone Remote | Questions tab: QueueList (touch), browser | `RemoteSessionPanel.jsx:384-440` | E | **Up next** tab: running order, Write a question, Choose from the set |

**Nothing is removed.** Sign out and Admin are the only controls that leave the live menu, and only if F5 goes as recommended;
both stay one tap away through Main menu, which leaves the session running.

## 4. Forks

| # | Fork | Options | Recommendation |
|---|---|---|---|
| F1 | Tabs or one scrolling page with collapsible sections? | (a) five tabs, each with a default view and More; (b) one scroll of five accordions | **(a) tabs.** A tab bar names every section at once, `?` follows the tab, and the console's links (`ConsoleRail` "All rounds", "Review them") can land on a section. One long scroll is what the owner is complaining about. |
| F2 | Where does End session go? | (a) the foot of every section; (b) keep its tab; (c) under How it runs | **(a) the foot.** It shows in every phase without a tab of its own, matching PLAN §3.2b. |
| F3 | Row actions in the running order and the browser | (a) ↑ ↓ ⋯, with Ask now inside ⋯; (b) keep every button on the row | **(a).** Browser rows keep Queue and Ask next visible because they are the point of that step. Ask now, the interrupting one, is one step further away. |
| F4 | Workie's Redo the read | (a) next to Workie's read in the content area and on the phone, plus a copy in How it runs · More while a read is up; (b) only in the menu, as today | **(a).** Redo is a mid-round action, and PLAN §3.2 moves those out of the Session menu. The menu copy stays until the content-area button ships, so nothing is lost in between. |
| F5 | Sign out and Admin ↗ in a live session | (a) remove them (Home has both, one tap away via Main menu); (b) quiet links in the foot | **(a).** Both are account actions, not session actions. If the owner wants them, (b) costs one small line in the foot. |
| F6 | Survey's second section | (a) **Results**, with the report card and per-question counts; (b) none (the report is on the main button after close) | **(a).** It keeps "the place for the report" in the same slot on every type. |
| F7 | Which section opens first | (a) Up next during play and Rounds so far once the session has ended; (b) always the last one used | **(a).** Links that name a section (`?panel=`, rail links) still win, via `sessionMenuSection`. |
| F8 | End session on the phone | (a) add a foot to the phone's Session panel with End session (confirmed); (b) leave it as it is | **(a), as a follow-up.** PLAN §3.3 lists End session on the Remote for one-screen hosts. I found no End session in the phone's Session card or `RemoteSessionPanel`; check the dock before building it. |

## 5. What changes per type

| Type | Sections | Notable defaults |
|---|---|---|
| C&A standalone, two screens | Up next · Rounds so far · Screens · Joining · How it runs | Names and Pace in How it runs; scoreboard in Screens |
| C&A event item | the same, plus the This event line | Opens on Up next; the Agenda tab is gone |
| C&A one screen | the same, plus People | Private reveals unchanged; Connect your phone near the top of Screens |
| Trivia | the same five (plus People on one screen) | No Names, no Write a question; difficulty on rows; answers never shown |
| Poll | the same five | No Names, no scoreboard |
| Wavelength | the same five, plus People | Screens explains one screen; no scoreboard |
| Survey | Close survey · Results · Screens · Joining · How it runs · People | End session disabled until closed |
| Build Room | Claude · Asks so far · Screens · Joining | People in the rail; Wrap up beside the report |
| Phone Remote | Up next · Rounds so far · People | Session card: those three doors, plus Join code · Room's screen · Main menu |

## 6. Implementation notes

1. **Sections.** `src/src/config/setupPanel.js:77-90` `setupPanelTabs({ survey, event, peopleColumn })` returns
   `up-next, history, screens, joining, run` (with `people` added as now). For a survey it returns `close, results, screens, joining, run`.
   Drop `agenda`, `remote` and `end`. Extend `LEGACY_SECTIONS` (`:98-104`) so that `questions` and `running-order` map to
   `up-next`, `history` to `history` (Rounds so far), `rounds` to `up-next`, `remote` to `screens`, `agenda` to `up-next`,
   `end` to `up-next`, and `settings` to `run`. Every existing deep link then still lands somewhere sensible
   (`sessionMenuSection`, `:111-115`; `ConsoleRail.jsx` `onOpenSection('history')`, which is "All rounds" and "Review them").
2. **Split Rounds.** In `SessionSetupPanel.jsx`, cut `:852-1367` into three blocks: `up-next` (composer, notice, queue,
   and the browser behind a `choosing` state with "‹ Up next", like `ownComposer`), `history` (`:1173-1259`) and `run`
   (`:1261-1365`, plus `afterRoundSettings` without the report toggle). Keep `setup-panel--wide` only for the Choose step.
   Keep the `.setup-panel` class name: HostActionBar's Space guard depends on it (`:84-91`).
3. **One expander.** Add `components/stage/MoreOptions.jsx`: a `<details>`-like button with `aria-expanded`, and the closed
   summary built from the labels of the groups inside, so it can never lie. Mirror its classes on `.setup-fold`
   (`:799`). The open state is per section in `localStorage` (try/catch).
4. **Categories line.** Add `categoriesSummary(catRows)` → "4 of 6 on · 23 questions left" in `config/setupPanel.js` beside
   `questionsRemaining`. "Change" opens More options and focuses the first switch.
5. **Event line.** Replace the `agenda` tabpanel (`:695-717`) with a band under the header, drawn whenever `hasAgenda`.
   It holds `EVENT_WORDS.menuK`, the item's position from `eventAgenda.js` (the place helper, around `:35`), the Agenda
   button and, when `event.onBringHere` exists, Bring everyone here. `TAB_HELP.agenda` is dropped; its guide section
   (`config/help/screens.js:49`) is linked from the host-session-panel guide instead.
6. **Foot.** Move End session (`:1497-1517`, both the survey and round branches) and Main menu into a `setup-panel__foot`
   after `.setup-panel__body`. Main menu's `title` is `HW.mainMenuHint`. F5 removes Admin and Sign out (`:1561-1571`), and
   `onSignOut` / `isAdmin` props become unused.
7. **QueueList row ⋯.** `components/stage/QueueList.jsx:255-273, 533-551`: move Ask next (in the order), Ask now and
   Disable / Remove into one menu button per row. Keep the arms-in-place Remove for Yours rows (`:416-452`). The ⋯ menu
   is an inline popover inside the sheet, never a `Modal`.
8. **Build Room.** `BuildSessionPanel.jsx:458-461` becomes four tabs: `claude`, `asks`, `screens`, `joining`. Move
   `RoomCodes` and the meter Switch into `joining`. Move `WallScreens` (with `extra` going to More) into `screens`. Move the
   Claude and Crew subs (`:561-615`) into `claude`, with Crew, the plugin version and Back to the opening in More. Report and
   Wrap up go in `asks`, with the History list. End goes to the foot. The Players tab goes, because `BuildConsole`'s rail has
   People. Keep `focusGroup` scrolling (`:406-410`) by mapping groups to tabs.
9. **Phone.** `config/hostRemote.js:663-669` changes to `up-next / history / people`. In `RemoteSessionPanel.jsx`, move the
   Write a question button from `:301` into the queue tab, and add a report card on `history` that opens the report (the
   phone already reads `POST /report` for the rounds). In `HostRemote.jsx:2186-2256`, the card's doors become Up next /
   Rounds so far / People / Join code / Room's screen / Main menu, and Categories moves into the Up next tab.
10. **Help and tests.** `TAB_HELP` (`:46-55`) gains `up-next`, `history` and `run`. `config/help/screens.js:49-53` and the
    host-session-panel guide need the new section names; run `node scripts/help-drift.js` and `helpContent.test.js`.
    Tests that click tabs by name (`devQaTwoNov.test.jsx`, `buildSessionPanel.test.jsx`, `endSessionConfirmFlow.test.jsx`,
    the setupPanel tests) need the new names, and End session moves from a tab to the foot. Add one contract test: every
    section's closed More options summary names each group it holds.
