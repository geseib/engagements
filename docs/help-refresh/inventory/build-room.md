I mapped every Build Room screen and part, checked 22 help claims against the code, and found that B8 (the two-screen console) and B9 (the "Where will the room watch?" chooser) are already built. So they belong with the screens, not under "planned". Nothing in the repo was changed.

On B8/B9: both are in the code (`BuildRoomPage.jsx:1122-1462` and `:1376/1588`), and `docs/design/parity/PLAN.md` itself marks them **Built** (lines 398–399). The host help already describes both correctly. Part 5 lists what is genuinely still unbuilt.

**How people reach help:** the participant has a Help button on the player page (`components/PlayerShell.jsx:90`, `section="player"`). **No Build Room host screen has a Help button**: not the header, not the Session panel, not the console (it only has the notifications bell, `components/console/ConsoleTop.jsx:47`), not the Stage. The host guide `host-build-room` can only be reached from the start screen (`WelcomeScreen.jsx:156`) or the admin page. Other session types get help from their Session panel (`SessionSetupPanel.jsx:520`); `BuildSessionPanel.jsx` has none. The room's window has no help, by design. The only in-place tips are four InfoTips in `BuildRoomPage.jsx`: line 2376 (room brief), 2531 (options editable), 2598 (letters kept), 3575 (Mac "Allow").

Paths below are under `src/src/buildroom/` unless shown in full.

## 1. Build Room screens and parts

Help-entry key: "none" means no help button or InfoTip on that part; "S" means it can only reach help through the start screen.

| Name in the UI | File(s) | Who | Key parts | Help entry | Last change |
|---|---|---|---|---|---|
| New Build Room (create form) | `BuildRoomPage.jsx` `BuildCreate` (l.252) | host | title; who sets the goal ("The room decides" / "I've set the goal"); goal; who can join | S | 10-19 Send B carries a why… |
| Header | `BuildRoomPage.jsx` `RoomHeader`/`HeaderTools` (2186-2325) | host (also seen by the room on Build/History) | Main menu; Host/Stage/Build/History tabs; "The room sees" chips and "See it here" when the window is up; Room's window ↗ and its status; open-ask pill; Open the build; Share demo chip; Claude chip; connection chip; Join code (a toggle); "N joined"; SESSION `\` with plugin dot and asking count | S | 10-19 |
| Host screen, one screen: **Now** column | `BuildRoomPage.jsx` 1574-1680 | host | chooser; "How a Build Room works"; demo nudge; unsent notice; shown talking point; run list; ask path / opening / What's next; Composer | S | 10-19 |
| **Waiting for you** | `BuildRoomPage.jsx` `Queue`/`QueueIdea`/`ReviewCard` (3211-3440), `BuildHeldPosts.jsx` | host | Claude's proposed asks; the room's ideas and filters; held posts (Release to the room / Keep to myself / Release all); "On the wall now" | S | 10-17 (held posts) |
| Side column folds | `BuildRoomPage.jsx` 1718-1740; `screens/Timeline.jsx` | host | Claude activity; The opening; Decided ("Tick to combine"); Timeline; Asks; Screenshots; Room brief; History | InfoTip (brief) | 10-17 |
| Ask path (Ask › Collect › Settle › Change before sending) | `BuildAskPath.jsx`, `BuildActionRow.jsx`, `BuildAskDetail.jsx` | host | Edit wording, Discard, Open voting, Show results, Send B to Claude, pick confirm | InfoTips (options, letters) | 10-19 |
| Decide / send panel | `BuildRoomPage.jsx` `DecidePanel` (2756), `PickConfirm`; `BuildStageDecide.jsx` | host (the Stage version is projected) | Claude gets it as…, direction, Why line, Save for later, Record only, Ask again | none | 10-19 |
| Composer / Ask the room | `BuildRoomPage.jsx` `Composer` (3129), `AskComposer` (3956), `ReadyLibrary`; `readyQuestions.js`; `BuildImage.jsx` | host | Send to Claude (Do now / Keep in mind / Ask Claude), Save for later, Log it; ask kinds Ideas/Choose/Rate; ready questions | none | 10-15 |
| What's next, Decided list, combine | `BuildWhatsNext.jsx` | host | lead move, ticks, combine into one prompt | none | 10-19 |
| Voting and results | `AskPath`, `VoteFromIdeasDialog` (3447), `screens/AskStage.jsx` | host, room | approval vote on ideas, tie, Vote again, put ideas to a vote | none | 10-19 |
| The wheel | `BuildWheel.jsx`, `WheelPanel` (2658) | host, room, phones | spin, landed slice, pick another slice | none | 10-15 |
| Consider and "Sent to Claude" marks | `BuildConsider.jsx`, `sentMarks.js` | host (marks also on phones) | Queue for the room (Yes/no, Feedback, Add to a vote, Add to the open Ideas ask); Send to Claude now or Later; Why | none | 10-19 |
| Talking points | `BuildPoints.jsx`, `BuildPointRequest.jsx`, `BuildPointStage.jsx`, `BuildPointsVote.jsx`, `BuildPointsResults.jsx`, `BuildLaterPoints.jsx` | host, room, phones (Talk it over) | ask Claude for points/research/ideas; show on the Stage; take down; points vote; highlight results | none | 10-15 / 10-17 |
| Run list (work through in turn) | `BuildRun.jsx`, `RunConfirm` | host, room, phones | Next / Skip / Stop, reorder, "Claude hasn't finished…" | none | 10-17 |
| Later list | `BuildLater.jsx`, `BuildLaterPoints.jsx` | host | send, to a vote, remove | none | 10-17 |
| The opening (build brief) | `BuildOpening.jsx` (`OpeningPanel`, `BriefPath`, `WallBrief`) | host, room | nine steps (skip, reword, probe, answer); Start building; Back to the opening | none | 10-15 |
| Room brief | `BuildRoomPage.jsx` `BriefPanel` (2340) | host | who it is for; keep in mind | InfoTip | 10-19 |
| Crew mode / builders | `BuildCrew.jsx` (CrewDialog, CrewBoard, CrewTasks, EarlyLook, RunCrewCodeSwitch), `BuildPlayerCrew.jsx` | host, phones, builders' Claude | builders, tasks, early looks, Run crew code | none | 10-17 / 10-15 |
| Share demo | `BuildWifiShare.jsx`, `wifiShare.js`, `words.js` | host (code shown to room) | chip and panel; nudge; app list (Demo/Mockups/App N); "Also open it to people who are not here"; who opened it, on this network / elsewhere; Remove; Stop sharing | none | **10-21** (plugin 1.24.2) |
| Codes side panel / enlarged QR / J | `components/stage/StageJoinPanel.jsx`, `screens/QrZoom.jsx`, `screens/BuildStageScreen.jsx` 340-368 | host, room | Join code plus demo code beside the moment; Esc; click to enlarge | none | 10-19 |
| Host alert | `BuildHostAlert.jsx`; `HostHome` in `BuildStageScreen.jsx` | host (count visible to room) | header-tab list, Mark all seen, "← Host" badge | none | 10-17 |
| Session panel, **Players** tab | `BuildSessionPanel.jsx` (PlayersList) and `HandoverStrip` | host | Here/Away/Builders filters; Let them take it / Not now / Lock again; Remove / Bring back | none | 10-19 |
| Session panel, **Settings** tab | `BuildSessionPanel.jsx` 509-601 | host | **Screens** (Where the room watches, window row, size, New link pressed twice); **The room** (Join/Demo codes, List names on the room meter); **Claude** (chip, Connect, plugin version, update, review-Claude's-asks switch, Check Claude's posts…); **Crew**; **This session** (Back to the opening, Wrap up, Report, End session); keys line | **none** | 10-19 |
| "Where will the room watch?" (B9) | `components/stage/RoomScreenChooser.jsx` (type build), `config/roomScreen.js` | host | One/Two screens, Help me pick | none | 10-19 |
| Two-screen console (B8) | `BuildConsole.jsx`, `BuildConsoleAsk.jsx`, `buildConsole.js`, `components/console/*` | host | top line (Join, Share demo, Room's window, The room sees, See it here, connection, bell); strip; Your part now / "No main move now"; left slots Waiting for you, People, Later (Points inside), Session; right side Now and folds | none (bell only) | 10-19 (ConsoleTop 10-21) |
| Connect Claude Code dialog | `BuildRoomPage.jsx` `ConnectPanel` (3532); `buildHostApi.js`; `pluginTier.js` | host | install command; mint key and start command (~/build-room/<folder>); Kick off; share repo (crew); review-Claude's-asks switch; Continue prompt; revoke | InfoTip (Mac Allow) | 10-19 |
| Wrap up / End session | `WrapUpPanel` (3778), `EndDialog` (3822) | host | summary, built, links, next steps | none | 10-19 |
| Report | `BuildReport.jsx` | host | What we built, Decisions, Screenshots, Version history, Timeline, Unprompted ideas, Who took part, Who built what; Save report | none | 10-15 |
| Mockup viewer / past-ask window | `MockupViewer.jsx`, `BuildAskDetail.jsx` | host, room | tabs, arrows, Back | none | 10-15 |
| **Stage** | `screens/BuildStageScreen.jsx`, `AskStage.jsx`, `StageIdle.jsx`, `ClaudeStatus.jsx`, `common.jsx` | room (dock is host-only) | rail with join code; meter; ask, wheel, point, run list, brief, crew board; Claude status band; dock (status, Open the build, PRESENT, ← Host, SESSION, main move) | none | 10-19 |
| **Build** screen | `screens/BuildBuildScreen.jsx` | room | "The build so far": latest screenshot, open the build | none | 10-17 |
| **History** screen | `screens/BuildHistoryScreen.jsx` | room | story, filters, Decided so far, Made so far, marks | none | 10-19 |
| Room's window `/present?type=build&k=` | `present/buildwall/BuildWall.jsx`, `useBuildWall.js`, `wallRoom.js`; `PresentPage.jsx` | room | follows Stage/Build/History, codes, size; nothing pressable; one click or F for full screen | none | 10-17 / 10-18 |
| Player page | `BuildPlayer.jsx`, `BuildPlayerPoints.jsx`, `BuildPlayerCrew.jsx`, `buildPlayApi.js` | participant | tabs Now/Ideas/History; Ideas/Choose/Rate with optional why; vote ballot; results/decided; wheel; Watch the build; Open the demo (Didn't open?, remote); "Looks good / Needs a change"; Send an idea to the host (idea statuses); Talk it over; run block; removed / moved; What we built; crew lane, early looks, I have Claude Code | Help button → player guides | 10-19 |
| Claude Code plugin | `src/public/engage-mcp.mjs` (VERSION 1.24.2, l.41; server LATEST_PLUGIN 1.24.2 at `lambda-functions/game/build-store.js:1005`) | Claude | `--install-plugin` (4100); `/engage:connect` (4295), kickoff, continue, share-repo (2227-2236); Stop hook `--checkpoint` git checkpoints (3737, 4279); `--activity` hooks for the doing line (4037, 4286); release-gate replies (1746, 1869); Wi-Fi gateway ports (2548); `.engage/share.json` (2861); cloudflared remote share (3171+) | n/a | **10-21** |
| Local demo scripts | `scripts/build-room-demo/` (server, host, phones, mcp-client, e2e, crew-e2e, remote-e2e) | developers | full story with fake API and the real plugin | n/a | 10-15 / 10-18 |

## 2. Help guides and sections for Build Room

- **`host.js` guide `host-build-room`, "Build Room"** (l.749-819). It sits after the source comment at 732-748, which only goes up to 19 Oct.
  - "What it is" (756)
  - "Before you start" (766): Node 18, git, plugin per site
  - "Connecting Claude" (780): Open Build Room / Install the plugin / Start Claude Code / Kick off
  - "During and after" (795), 13 items: Share demo · What the share opens · People who are not in the room · The room's window · Two screens: your laptop console · Showing the join code · The Stage's buttons · Consider · Sent to Claude marks · History · Releasing Claude's posts · Wrap up · Save report
- **`host.js` general guides that also apply:** "The session panel" (282), "Handing a name over" (517), "Removing someone who left" (564), and the room-size paragraph at 255, which has a Build Room sentence.
- **`player.js:199`**: one "Build Room" list item under Playing › Answering.
- **`technical.js`**: nothing on Build Room. Neither Troubleshooting nor "What you need to run it" covers Node, git, the plugin or cloudflared.

## 3. Coverage gaps

**Host screens with no help at all:**
- the ask path's four steps on one screen
- the Composer and Ask the room, including ready questions and the three ask kinds' options
- What's next and combining decided asks
- voting, results, tie and Vote again; the wheel is named only as "Spin the wheel"
- talking points (the whole Points family)
- the run list
- the opening / build brief (only the goal choice and the strip's "Opening" label are mentioned)
- the Room brief panel
- crew mode (dialog, board, early looks, Run crew code, builder lane)
- the Later list (only mentioned inside the Consider item)
- the header's Claude chip and connection chip
- the review-Claude's-questions switch, in Connect and in Settings › Claude
- List names on the room meter
- the Room codes block in Settings
- the Continue prompt
- the Build screen
- the host alert's list on Build/History
- the End dialog, and the report's own sections
- the mockup viewer and the past-ask window
- the Stop-hook checkpoints, and how they feed the report's Version history

**Participant:** the player page has one paragraph. Nothing covers the Ideas tab and idea statuses, "Looks good / Needs a change", Talk it over, the run block, the phone wheel, Didn't open?, the removed / moved screens, the ended "What we built", or the crew screens (I have Claude Code, Your lane, reactions).

**Claude side:** there is no list of the plugin's slash commands. The Stop hook, the activity hooks, the doing line and cloudflared are not described. The 1.24.2 feature is not mentioned.

**Room:** apart from "The room's window" and the room-size paragraph, nothing covers what the Stage shows in each moment: the Claude status band, the "Sent to Claude" band, or long asks paging.

**Help entry point:** there is no Help button anywhere in the Build Room host UI (see the opening note).

## 4. Stale or imprecise claims

Correct as written (checked against the code):
- Posts that wait for the host include answers (`build-store.js:40`); Claude learns of this with plugin 1.21.0 (`engage-mcp.mjs:1746`).
- Plugin 1.20.0 for `.engage/share.json` and labels; Settings › Claude shows the plugin version (`BuildSessionPanel.jsx:43-59, 536`).
- New link needs two presses (`BuildSessionPanel.jsx:283-288`).
- Open as a tab and the F key (`config/roomScreen.js:123-125`; `PresentPage.jsx:114, 138`).
- "Help me pick" asks three questions (`roomScreen.js:5`).
- The strip labels (`buildConsole.js:124-163`).
- "← Host" goes home in one press and shows the count (`BuildStageScreen.jsx:102-121`).
- The codes are a side panel, not a takeover (`BuildStageScreen.jsx:340-354`).
- Node 18 and git (`words.js:401, 565`).
- The ~/build-room folder (`buildHostApi.js:309`), with git set up by the plugin (`engage-mcp.mjs:3618`).
- One plugin per site (`pluginTier.js`); the two goal choices on the create form.
- Held posts are flagged on your Timeline (`screens/Timeline.jsx:50`).

Stale or imprecise:
1. **"Press again, or Esc, to take them down"** (host.js:806) is wrong on the two-screen console. The console's Join only shows the codes: `BuildRoomPage.jsx:1237` passes `onJoin: showCodes`, not the toggle, and `ConsoleTop.jsx:27` labels it "Show the join code on the wall". Esc is handled only by the laptop's own Stage (`BuildStageScreen.jsx:185-195`), which the console never shows. On the console only **J** takes the codes down (`BuildRoomPage.jsx:548-560, 969`). On one screen the header Join does toggle (`joinChipWords`, 2186).
2. **"Click a code in the panel to enlarge it … and copy the link"** (806) is only half true. The enlarged demo code has no copy (`QrZoom.jsx:34-47`); only the join code has one (`:55`). Clicking to enlarge also works only on the laptop's one-screen Stage (`BuildStageScreen.jsx:352`, controls only).
3. **"People who are not in the room"** (803) leaves out the 21 Oct change (plugin 1.24.2, commit `78599180`). The panel now says per person "on this network" or "elsewhere", with counts (`words.js:461-466`, `BuildWifiShare.jsx:105`), and only with plugin 1.24.2. The help mentions neither the split nor the version.
4. **Consider** (808) lists three ways to queue an item for the room. The code has a fourth, "Add to the open Ideas ask", offered while an Ideas ask is open (`words.js:657, 663`; `BuildRoomPage.jsx:1865` `canIdeas`).
5. **The room's window "never shows a name"** (804) is too absolute. With List names on, the window's data includes names (`present/buildwall/wallRoom.js:36-38`; `BuildWall.jsx:13-14`) and History stops blanking names in the room's text (`build-store.js:1763, 1897-1898`).
6. **Console top line** (805) leaves out the notifications bell added 21 Oct (`ConsoleTop.jsx:47`).
7. **Console Session slot** (805) leaves out "Copy the Continue prompt" and "Back to the opening" (`BuildRoomPage.jsx:1304, 1309`).
8. **`PLAN.md` itself is out of date.** Its status lines 16-18 still list "paging long asks (B9m)" and "the laptop's codes card following the server" as ready to do. Both are built: long-ask paging in commit `504648cf` (`BuildStageScreen.jsx:156-159`), and the codes card following the server at `BuildRoomPage.jsx:465-475`. Commit `08f3277f` also did part of B9m ("Build Room wall: measured").

## 5. Planned but not built (help must not describe these yet)

- **B9m (partly done):** measuring the wall at four sizes and four profiles. The fit/measure checks in commit `08f3277f` still count as unfinished here.
- **D3:** measuring that the dock buttons never move (PLAN 537).
- **B10, Build Room's other standards** (PLAN §3, 686-695):
  - Replace the browser "are you sure?" pop-ups with press-twice-in-place. Five remain: `BuildCrew.jsx:244, 724, 746`; `BuildRoomPage.jsx:3790, 3971`.
  - "Applies …" scope labels on the Settings groups. Only Screens has one (`words.js:612`).
  - A rule for late answers and votes in Build Room.
- **Q5:** paging History on the wall ("Not in B"; the wall shows "and N earlier" instead).
- **Three small rulings still open** (PLAN 13-15): the wording on the share's locked page, a cloned repo's `share.json`, and a player's own "why" on the wall.
- **Ready but not done** (PLAN 15-18): the two phone leaks (an unseen ask named in the timeline, mockups of draft asks); the demo QR and Copy carrying a join link instead of the share key.
- **Trivia, Poll and Survey parity** (PLAN §4). Not Build Room, but listed in the same plan.