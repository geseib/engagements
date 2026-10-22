I've inventoried the host-facing classic screens and compared them with the help guides. Overall the help is in reasonable shape, but four areas are missing entirely: events, surveys, the Create engagement form beyond its first four fields, and the room's window lobby. I also found 12 claims that are wrong or partly wrong against the code. Only two host screens have a help button at all, and both open the host guide list rather than a specific guide.

Two things to know when reading the table:
- **"Last change" dates:** the repo history starts at root commit `ffceee0f` on 2026-10-15, which imports 2,852 files. A date of 2026-10-15 means "no change since the import", not a real edit on that day.
- **Two screens only exists for Call & Answer.** `config/surfaces.js:26` limits two screens to `call-and-answer` and `build`. The host page's console check (`GameHostPage.jsx:1196`) also lists trivia, poll and wavelength, but the two-screen flag is already false for those. So every two-screen row below is Call & Answer only, and only outside events.

## (1) Host screens and parts

All paths are under `/home/user/engagements/src/src/`. "Help" means a HelpButton on that surface.

| Screen / part (UI name) | File(s) | Reached from | Types | Key parts | Help → id | Last change |
|---|---|---|---|---|---|---|
| Start screen ("Start an engagement") | `components/WelcomeScreen.jsx` | `/` when no session is open | all | Create engagement, Quick start, Build Room (out of scope); Rejoin a session (4-digit code + Continue); Your library: Question sets / Sessions / Reports; org switcher; bell; Sign out; Admin console or "Question sets & team" | **yes** → `section="host"` (opens the host guide list, with a reports menu) | 2026-10-21 (bell) |
| Events block ("Run an event") | `components/WelcomeEvents.jsx` | start screen | events | New event; list of live/upcoming events; "See how" (plan upsell) | no | 2026-10-15 |
| New event / Event details dialog | `components/EventDetailsDialog.jsx` | Run an event › New event; Create engagement › Event format | events | Name, Date, Starts, Time zone, Who can join, Reports for attendees | no | 2026-10-15 |
| Event agenda (`/host/event/NNNN/agenda`) | `components/event/HostEventAgenda.jsx`, `EventBuilder.jsx`, `EventItemDialog.jsx` | after saving an event; AGENDA on the dock | events | Agenda table, Add item (Item / Break / Talks), drag to reorder, item dialog (Plays, Set, Order, Planned length, slides PDF) | no | 2026-10-15 |
| Event stage (`/host/event/NNNN`) | `components/event/EventStage.jsx` | agenda | events | AGENDA, EDIT AGENDA, END EVENT, JOIN, Live now / Next, slide deck (Next slide, Present full screen), "End the event?" dialog | no | 2026-10-15 |
| Create engagement ("New engagement" / "Start a new engagement") | `components/GameSetupDialog.jsx`, `SessionOptions.jsx`, `BriefingField.jsx` | start screen › Create engagement | C&A, Trivia, Poll, Wavelength, Survey (+ Build Room / Event buttons) | Event title; Format buttons; Question set select; "Your question sets" / "Make a question set"; Categories grid; Workie's briefing (C&A only, document upload); Advanced (Anonymous responses, Names [survey], Shuffle the question order, Goal, Workie's voice, Summary approach, Instructions for Workie, What people see when they join); a "Discard?" confirm at the foot; "Nobody can join until you start it" | no | 2026-10-15 |
| Edit session | same dialog, `mode="edit"` | Sessions › Edit | same | Format and set locked, categories editable | no | 2026-10-15 |
| Your question sets (host dialog) | `components/HostQuestionSetsDialog.jsx` (+ `QuestionSetEditor`, `DraftReview`) | start screen › Question sets; Create › Your question sets | all | Set list with Quickstart chip, Edit questions, Rename, Copy and edit (house sets), Delete, Review (AI draft), New question set, "Review AI draft" | no | 2026-10-21 |
| Quick start ("Pick a set and go") | `components/QuickstartMenu.jsx` | start screen › Quick start | C&A, Trivia, Wavelength, Poll (no Survey) | "Where the room watches" One/Two screens (shown when any C&A set is listed) with a hint line; set carousels per type; one press creates and starts; on two screens it opens the room's window during that press; blocked-popup note | no | 2026-10-18 |
| Your sessions | `components/SessionHistoryPanel.jsx` (shown inline in `GameHostPage.jsx` ~6749) | start screen › Sessions | all | Search, type filter; per row Report / Results (survey) / Edit / Start / Continue / Open, Link, Invite | no | 2026-10-15 |
| Session reports (same list, reports mode) | same | Settings › Session report; report › Browse all | all | — | no | 2026-10-15 |
| Your reports (saved) | `components/HostReportsDialog.jsx` → `ReportsPanel.jsx` | start screen › Reports; also `/reports` | all | Saved PDFs, link + passkey | no | 2026-10-15 |
| Invite dialog | `components/InviteDialog.jsx` | Sessions › Invite; Settings › Joining › Invite | all | — | no | 2026-10-15 |
| Session report | `components/GameReport.jsx`, `RoundReport.jsx`, `ReportLate.jsx`, `ReportFollowUps.jsx`, `TalkingPointsReport.jsx`, `ReportSavedDialog.jsx` | Rounds tab › Session report; ENDED primary "Open Session Report"; Sessions › Report | all | About this session, Who was here, What we heard, Final Scores, Survey results, Arrived late, Save report (Keep for 90 days / 1 year) → "Report saved" (Link, Passkey) | no | 2026-10-16 |
| Survey results / Walk through | `components/SurveyResultsPanel.jsx`, `stage/SurveyWalkthrough.jsx` | dock "See the results" / "Walk through"; Sessions › Results | Survey | Cut sheet, then a presenter one question at a time (→/Space next) | no | 2026-10-15 |
| Host page: one-screen stage shell | `GameHostPage.jsx` (`<Stage>` ~8281), `stage/Stage.jsx`, `Rail.jsx`, `RoomMeter.jsx`, `WorkflowStrip.jsx` (slim) | open or continue a session on One screen (all non-C&A types always) | all | Rail (title, JOIN code: hover preview / click to pin), slim step strip, room meter (U shows names, press an arrival to feature a comment), content, dock | no | 2026-10-19 |
| Lobby | `GameHostPage.jsx` ~8506 | Start | round types | "Scan to join · no app, no account", QR, URL, Session/Event code; "Set the running order" (event preview only) | no | 2026-10-19 |
| Where will the room watch? (chooser) | `stage/RoomScreenChooser.jsx`, `config/roomScreen.js` | lobby, until this browser has chosen (or when reopened) | **C&A only**, not events | Two screens / One screen, Open the room's window, Help me pick (3 questions + recommendation), Keep this choice | no | 2026-10-19 |
| ASK | `QuestionCard.jsx` (room content v2 for C&A), `stage/PollBoard.jsx` (poll, live) | Start round N / Next | all round types | Title / lesson / "Your turn" band; poll bars filling live; click to expand → expanded-lesson modal | no | 2026-10-18 |
| VOTE | `GameHostPage.jsx` ~8602, `StageGathering`, `Pager`, `AnswerSpotlight` | Start voting | C&A only (the only type with a vote phase) | Cue kicker, question recap (click to put back), every answer numbered (click → spotlight), ↑/↓ to page | no | 2026-10-19 |
| RESULTS | `GameHostPage.jsx` ~8734; `PollBoard`, `QuestionCard REVEAL` (trivia), `WavelengthConvergence` | Show results | per type | C&A: "The room's pick" + runners-up with share fill, credit line, "Talk about it", "and N more answers", spotlight. Trivia: correct row + shares. Poll: final board. Wavelength: ranked terms. | no | 2026-10-19 |
| "What we heard" (Workie's read) | `AISummaryStatus.jsx` | dock "What we heard" | C&A (non-trivia rounds) | Paged read (→ pages before it advances, ← back), Ask-the-room icons, Retry/Redo on failure | no | 2026-10-15 |
| Feedback round / featured comment | `stage/FeedbackWall.jsx`, `RoomMeter` | "Request feedback" | C&A | Counts and arrivals; the comment you put up, with "take down" | no | 2026-10-15 |
| Ask the room composer | `components/AskComposer.jsx`, `FollowUpCard.jsx`, `stage/AskStage.jsx` (ASKING) | dock "Ask the room"; Workie icons | C&A | Kinds Ideas / Choose / Rate / Comments; Rate ends picker; "Back to Workie's words"; Send; on stage: Cancel the question / Ask another / pick an idea | no | 2026-10-16 |
| Scoreboard overlay | `stage/scoreboard/*` | S; Players tab "Show scoreboard on screen"; console People; remote | Trivia, C&A | Departure / Olympic / Tote looks (V), ←/→ pages, close | no | 2026-10-15 |
| ENDED | `GameHostPage.jsx` ~9161, `Podium`, `WavelengthSessionVocabulary`, `SurveyCollecting` / `SurveyClosed` | End | all | "Session complete", rounds played, people count, podium (vocabulary for wavelength); survey shows counts only | no | 2026-10-19 |
| Survey COLLECTING / CLOSED | `stage/SurveyCollecting.jsx`; controls in `config/hostControls.js` | Open the survey | Survey | QR stays up; Two-minute warning; Close the survey; See the results / Walk through | no | 2026-10-15 |
| Dock | `stage/Dock.jsx`, `HostActionBar.jsx`, `config/roundStep.js`, `config/hostControls.js` | bottom of the one-screen stage | all | Status line (late-count link), progress, hint, primary/secondary with SPACE chip, press-twice early-advance ("… anyway"), AGENDA (events), PRESENT (events on two screens), **SESSION** (\\) | no | 2026-10-19 |
| Session panel | `stage/SessionSetupPanel.jsx`, `config/setupPanel.js` | dock SESSION, \\, strip places, console Session tools | all | 4 tabs (below); header Help + ✕ | **yes** → `section="host"` | 2026-10-16 |
| · Players tab | `stage/PlayersList.jsx` | panel | all | Show scoreboard on screen; roster in score order with pts and answered tick; Unlock name / Let them take it; "Asking to take this name" / "Unlocked for one handover"; Remove / Restore | (panel's) | 2026-10-15 |
| · Questions tab | SessionSetupPanel ~630–930, `QueueList.jsx` | panel | round types | Categories (live toggles + counts); running order (Up next, Queue / Unqueue, Ask next); "Choose the next question": search, asked / off tags, Ask now / Ask again now | (panel's) | — |
| · Rounds tab | SessionSetupPanel ~930, `LateList.jsx`, `PastRound.jsx` | panel; dock late link | all | Session report button; "Late & not reviewed" (Show on the wall, Mark reviewed, Close comments); round list with AI badge → past-round view (1–9, ←/→, Esc) | (panel's) | 2026-10-16 |
| · Settings tab | SessionSetupPanel ~1000–1320, `ScreensGroup.jsx`, `WorkieSettings.jsx` | panel | all (Screens choice C&A only) | Screens (Where the room watches, Room's window status / Open ↗ / Open as a tab, Room screen size); Your phone as a remote (QR + who may sign in); The rounds (Names, Feedback, Report "Include items not reviewed", Workie voice / approach / Redo with…, Pace auto-advance, Scoreboard style); Joining (Players join at, copy, Invite, show join code); fold "Session: back to menu, end it, sign out" (Show how this works on the stage, Back to Menu, End session, Admin ↗); fold "Keyboard shortcuts" | (panel's) | 2026-10-16 |
| Two-screen console | `console/HostConsole.jsx`, `ConsoleTop.jsx`, `ConsoleRail.jsx`, `ConsoleFooter.jsx`, `panels/*`, `config/consoleWords.js` | Two screens chosen (C&A, not events) | **C&A only** | Top line: ← All sessions, title, Join NNNN, Room's window ↗ + status + Open as a tab + note line, bell. Loop strip (look privately / Back to the room). Rail: Round queue, People (Show/Hide scoreboard), Late & not reviewed, Session tools. "Your part now" card. Main: Lobby / Responses / Ballot / Results / Read / Feedback / Room question / Ended panels. | **no** | 2026-10-21 (top line) |
| Step view (looking privately, incl. Setup) | `stage/StepView.jsx` | press a strip step (two screens only) | C&A | "Looking without moving the room", Screens group, All settings | no | 2026-10-16 |
| Room's window link / placement | `present/roomWindow.js`, `stage/RoomWindowLink.jsx`, `RoomWindowStatus.jsx`, `config/presentStatus.js` | console top, Screens group, chooser, dock PRESENT, Quick start | C&A | Places the window on the 2nd display (Chrome/Edge); `placed=1` → first click fills the screen; states On, full screen / Open, not full screen / Hidden / Not open; Open as a tab | no | 2026-10-18 (roomWindow) / 2026-10-19 |
| QR side panel / pinned QR | `stage/StageJoinPanel.jsx`; expanded-QR overlay `GameHostPage.jsx` ~9466 | J, Show join code, rail code | one screen during a round: side panel; otherwise overlay | URL, code, click to copy | no | 2026-10-19 |
| Answer spotlight | `components/AnswerSpotlight.jsx` | click an answer (one screen) | C&A | ←/→, 1–9, Esc | no | 2026-10-18 |
| Dialogs | `ConfirmDialog.jsx` + `hostControls.js:399` ("End this session?"); "Leave this session?" `GameHostPage.jsx` ~9425; loading overlay | End session; Back to Menu mid-session | all | ← cancels, → confirms; Stay in the session / Back to Menu | no | 2026-10-15 |
| Notifications bell | `HostNotificationsBell.jsx`, `NotificationsBell.jsx` | start screen, console top, remote | all | Opens a new tab from a session | no | 2026-10-21 |
| Phone remote (`/remote`) | `HostRemote.jsx`, `config/hostRemote.js`, `Remote*.jsx` | Settings › Your phone as a remote QR | round types (refuses build) | Code entry; step dots; bell; This round (Choose next question, focus panel, waiting names, Workie notes, Ask composer, Feedback round + room note); scoreboard panel; Session card (Players & rounds, Categories, Join code, Present / Big screen, Back to Menu); tabs Players / Rounds / Questions | no | 2026-10-21 |

**Keyboard shortcuts on the host page:**
- Space or → advances (HostActionBar); → turns pages before it advances.
- ← steps back; ↑/↓ pages (Pager).
- U shows names on the room meter (`RoomMeter.jsx:257`); J shows the join code (`GameHostPage.jsx:1306/1325`).
- S, V and Esc work the scoreboard; \\ opens the panel; F is full screen.
- 1–9 and ←/→ work in the spotlight and past-round views.

The in-panel "Keyboard shortcuts" list (`SessionSetupPanel.jsx:1309`) leaves out U, J, F and ↑/↓.

## (2) Host help guides (`config/help/host.js`)

| id | title | sections |
|---|---|---|
| host-quick-start | Quick start | The shape of it · Step 1 — Create · Step 2 — Start, and get people in · Step 3 — Run the rounds (keys) · Step 4 — Results · Common questions |
| host-game-setup | Setting a session up | Choosing a question set · Quick start · Categories · Settings worth a look before you start |
| host-running-engagements | Running the room | The session panel · Two screens: your laptop console · Choosing what to ask next · Running it from your phone · Going back over a round |
| host-late-items | Late answers and comments | What is kept · Late & not reviewed · In the report |
| host-player-management | Managing players | The Players tab · Handing a name over · Removing someone who left |
| host-reporting | Results and reports | What the AI writes · The session report · How long the data lasts |
| host-build-room | Build Room (out of scope) | — |
| host-plan | What counts toward your plan | When a session counts · Where to see it · Nothing is ever stopped mid-session · If nothing starts |

Other guides that are relevant to hosts:
- `technical.js`: technical-troubleshooting; technical-requirements (Hosts, Running it on a video call).
- `player.js`: player-playing (lists the types).

Neither HelpButton targets a specific guide. Both pass `section="host"`, which opens the role index.

## (3) Coverage map and gaps

**Covered:**
- **Start screen:** quick-start › The shape of it (notes). Rejoin by code is only implied.
- **Create engagement:** quick-start › Step 1, and game-setup › Choosing / Categories. Partial: Workie's briefing, the whole Advanced section, the Format buttons and the Discard confirm are **NOT COVERED**.
- **Question sets dialog:** game-setup › Choosing a question set and Quick start (stale, see below).
- **Quick start:** quick-start note, game-setup › Quick start, running › the Chrome note.
- **Sessions list:** quick-start note "Coming back to a session".
- **Reports:** reporting › The session report.
- **Lobby:** quick-start › Step 2.
- **ASK / VOTE / RESULTS:** quick-start › Step 3 and Step 4, and the game-setup content paragraph.
- **What we heard / Ask the room:** reporting › What the AI writes.
- **Scoreboard:** Step 3 keys and Step 4.
- **Session panel and its tabs:** running › The session panel. Players: player-management. Rounds: running › Going back over a round, and late-items. Settings: game-setup › Settings worth a look.
- **Two-screen console:** running › Two screens. Room's window status, Open as a tab and second-display placement are covered in the same section.
- **Phone remote:** running › Running it from your phone.
- **Session report:** reporting.

**NOT COVERED:**
- **Events:** New event, agenda, event stage, AGENDA / END EVENT. Only one line mentions F on slides.
- **Survey flow:** Open / Close the survey, Two-minute warning, See the results / Walk through. Only one sentence covers surveys.
- **Per-type stages:** the poll board, trivia's reveal and wavelength results / vocabulary.
- **The room's window lobby** (the 18 Oct redesign: title hero, event details, QR on the right).
- **"Where will the room watch?" chooser and "Help me pick".** Mentioned only in the Build Room guide.
- **Feedback round** ("Request feedback"), featuring a comment, and the Comments kind in Ask the room.
- **Running order:** Queue, Ask next, Set the running order, Ask now / Ask again now.
- **The one-screen step strip** (slim) and Step view.
- **Leave / End dialogs** (Leave this session?, End this session?).
- **Smaller pieces:** the Invite dialog, the expanded-lesson modal, Workie settings in Settings (voice, approach, Redo with…, model compare), and the J key for classic sessions.
- **Type limits:** the help never says two screens / the console is Call & Answer only, or that Quick start has no Survey.
- **Help access on two screens:** the console has no help button. Help is reachable only through the Session panel. A comment at `WelcomeScreen.jsx:~150` says the button also sits in "the console's" header; it does not.

## (4) Stale claims, with citations

1. **Dock button name.** host.js:287 says "use the SETUP control on the dock". The dock button is labelled **SESSION**, with the tooltip "Session panel — backslash key" (`stage/Dock.jsx:~143–146`).
2. **Set row buttons.** host.js:196 says the Edit button reads "New version" or "Fork". Neither string exists in any component. The host dialog shows "Edit questions" / "Rename" / "Copy and edit" / "Review" (`HostQuestionSetsDialog.jsx` ~725–850). The console panel shows "Edit" / "Open" (`QuestionSetsPanel.jsx:752, 797`).
3. **Quickstart tooltip.** host.js:214 quotes the tooltip "Show this set in the host's quickstart menu". That text is only in the admin console's panel (`QuestionSetsPanel.jsx:581`). The host's own dialog says "Click to offer this set on the quickstart menu" (`HostQuestionSetsDialog.jsx:682`). Separately, the Quick start empty state still tells hosts to "go to Admin → Question Sets and check the 'Quickstart' box" (`QuickstartMenu.jsx:~260`); that is stale code text, not help.
4. **Overflow line on results.** host.js:146 says the wall says "and N more ideas". The code says "and N more **answers**" (`GameHostPage.jsx:8939`, `present/PresentMoments.jsx:335`). The same line implies points always show, but points are hidden while names are hidden (`showPoints = standingsVisible(...)`, `GameHostPage.jsx:8883`; `roomContent.js` "no counts where names are hidden").
5. **Phone remote.** host.js:397 says Switch game is on the round view. The remote's button is "**Back to Menu**" (`HostRemote.jsx:~2004`). host.js:383 says "jump to the big-screen pad"; on two screens that button is now "Present / Presenting" (`HostRemote.jsx:1967–1991`). The remote's scoreboard panel, Workie notes, Ask composer and feedback round are not mentioned.
6. **Settings groups.** host.js:296 lists The rounds as "names, pace, feedback, scoreboard style". It also holds the Report setting and the Workie controls (`SessionSetupPanel.jsx:1140–1167`). The fold the help calls "Session details" is "Session: back to menu, end it, sign out" (`:1233`).
7. **Where "← All sessions" goes.** host.js:313 says it goes "back to your sessions". It runs `handleSwitchGame()`, which shows the **start screen**, not the Sessions list (`GameHostPage.jsx:5479–5494`). The tooltip text in code repeats the claim (`consoleWords.js` `allSessionsHint`). Either the destination or both texts should change.
8. **Ask the room kinds.** host.js:616 says the kinds are Ideas, Choose or Rate. The composer has four: `['ideas','choice','rate','comments']` (`followUpWords.js:72`).
9. **Room content rule scope.** host.js:255 says "On every size the room sees only what it needs … The same rule holds on one screen and on the room's window", with no type limit. On the one-screen stage only Call & Answer uses the roomContent rule; "Other types keep the card's own DOM" (`GameHostPage.jsx:8575–8582`). The same paragraph also says Screens sits "at the top of Setup on the step strip", but the Setup step can only be opened on two screens (`GameHostPage.jsx:7064`).
10. **Two screens type limit.** host.js:241 and 302–352 never say two screens is Call & Answer only (`config/surfaces.js:26`; the chooser is C&A only, `GameHostPage.jsx:7066`). Similarly, host.js:340 says "Quick start shows where the room watches", but only when a C&A set is listed (`QuickstartMenu.jsx:~305`).
11. **Old setting name and video-call advice.** technical.js:133 and :163 still say "display profile". The UI calls it **Room screen size** (`roomScreen.js:111`), and host.js:241 itself notes the rename. technical.js:164 says "Share the browser window showing the session"; the current advice is Open as a tab and share that tab (`roomScreen.js:123–125`).
12. **Wavelength word cloud.** player.js:197 says "Everyone's words become one cloud", and player.js:307 says "The shared word cloud is the result". The stage now shows ranked terms; the code comment says "The packed word cloud is gone from the stage" (`GameHostPage.jsx:8807–8818`).

**Smaller wording drift:**
- host.js:261 calls the toggle "Show who wrote each response". The UI reads "…from the start" (`SessionSetupPanel.jsx`).
- host.js:57–59 says "Pick the kind of session". The control is labelled "Format".
- host.js:362 names "Choose the next question" as an action. It is a heading; the actions are Ask now / Queue / Ask next.

**Checked and still accurate** (13 spot-checks, including all the recent areas you listed):
- "Your part now" card (`ConsoleFooter.jsx`).
- Rail sections and Show / Hide scoreboard (`ConsoleRail.jsx`).
- Room's window states (`presentStatus.js`).
- Open as a tab and second-display placement (`RoomWindowStatus.jsx`, `roomWindow.js`).
- Click-to-fill cue "Click anywhere to fill the screen" (`PresentPage.jsx:86`).
- Lesson-leads rule and the "Your turn" band (`roomContent.js`).
- QR side panel on one screen with J (`GameHostPage.jsx:7818–7833`).
- Bell on the start screen, console top line and remote, opening a new tab (`ConsoleTop.jsx:41`, `HostRemote.jsx:977`).
- Phone sign-in wording (`remoteSignIn.js`).
- Late words (`lateWords.js`).
- Early-advance "… anyway" (`roundWords.js`).
- Handover labels (`PlayersList.jsx`).
- U key (`RoomMeter.jsx:257`).