# Session start and live stats (Call & Answer)

Mockups only. No application code was changed. Open `index.html`; every frame is drawn
at its real size, and the `1-*.png` files are screenshots of those frames. The desk
review and what it changed are in `reviews.md`.

Owner, 1 Nov 2026:

> 1. "when call and answer starts and the QR code comes up it is very different experience
>    than expected for choosing two screen vs 1 screen. why is the experience nice once it's
>    in two screen and i click setup. this should be the start of the session making these
>    screen adjustments and offering the QR code."
> 2. "when in two screen mode it still could be less bland and utilitarian. as the host needs
>    to see important stats. 1 how many have answered or have they all answered. another
>    useful item would be how long the host has given the room."

---

## 1. The problem: what happens today

### 1a. Starting a Call & Answer session

Line numbers are for the working tree on 1 Nov 2026.

1. **Create.** New engagement → `handleStartNewGame` (`GameHostPage.jsx:5883`). For a
   round type, it does not start the session. It opens the session list with "Created …
   press Start when the room is ready" (`GameHostPage.jsx:5974-5979`;
   `SessionHistoryPanel.jsx:255-275`).
2. **Start.** Start on the row → `startSession` (`GameHostPage.jsx:5682`) → `POST /start`
   → `switchToGame`. The page is now in `LOBBY` (`config/roundStep.js:85`). **Nothing asks
   about screens at this point.** The Start button does not know or say which mode it
   will open.
3. **Which screen the host lands on depends on a value they never saw.**
   `twoSurfacesFor(roomScreenChoice, …)` (`GameHostPage.jsx:1254`; `config/surfaces.js:59-64`)
   reads the choice this browser stored. With no choice stored, the default is **two
   screens on dev and one screen on test and prod** (`surfaces.js:63`). So the owner gets
   one flow on dev and a different one on test.
   - **One screen (test/prod default, or chosen earlier):** the full stage lobby, with a
     512px QR, "Scan to join · no app, no account", the address and the code
     (`GameHostPage.jsx:8679-8700`). This is "the QR code comes up". If no choice is stored,
     the chooser is drawn **in the stage's overlay slot, over that QR, on the screen the
     room is watching** (`GameHostPage.jsx:8496-8504`; `showRoomScreen` at `:7229-7231`).
     The host makes a private setup decision in public, on top of the join screen.
   - **Two screens:** the host console (`GameHostPage.jsx:8400-8452`). In the lobby its
     main area is `LobbyPanel`: "Joined so far", the code at 24px, a bare list of names
     and the first task (`components/console/panels/SimplePanels.jsx:12-24`). The room's
     window is **not** open. The host has to find "Room's window ↗" on the top line
     (`console/ConsoleTop.jsx:39-46`). Only Quick start opens it as the session starts
     (`QuickstartMenu.jsx:183-185`, `openPendingRoomWindow`); Start on the session list
     does not.
4. **The nice flow is somewhere else.** On two screens, pressing **Setup** in the strip
   opens `StepView` (`components/stage/StepView.jsx:35-49, 73`). It shows the Screens
   group: one screen or two as a segment, the room's window with its real state and
   Open ↗ / Open as a tab, and the room screen size (`components/stage/ScreensGroup.jsx`,
   fed by `setupScreens` at `GameHostPage.jsx:6356-6364`). It also shows the session name,
   the set and how many have joined. **This is the screen the owner likes, and the host
   only reaches it by going back after the session has already started.** The chooser's own
   words send the host there: "Change it any time in Setup" (`config/roomScreen.js:31`).
5. **The join code has three ways up, and they behave differently by mode:** the stage
   lobby (one screen), the expanded-QR overlay (`GameHostPage.jsx:9636-9680`, opened by
   `Join 7924` on the console's top line, `:8406`), and the room's window lobby
   (`present/PresentMoments.jsx:133-165`). Which one the host sees first depends on step 3.

**In one sentence:** the session starts by showing a QR and then asks the setup question
(or never asks it), when it should ask the setup question and then show the QR.

### 1b. The two-screen console during a round

- **The answered count is said twice, both times small.** The People header,
  "9 of 12 answered" at 12px (`config/consoleRail.js:28-32`), and Your part now's status
  line at 13px (`console/ConsoleFooter.jsx:67-72`, from `roundStep`'s status). Neither
  has a bar, a numeral or an "everyone's in" state. The one-screen stage has the room
  meter (`GameHostPage.jsx:7562-7578`, `RoomMeter.jsx`) and the dock's "Safe to move on"
  (`:8040-8053`). **The Remote already does this better**: a meter, "12 of 14 answered",
  and *Everyone is in* with a check (`HostRemote.jsx:1595-1612`).
- **There is no timer anywhere in Call & Answer.** A search of `src/src` and
  `lambda-functions` for timer, countdown, timeLimit and duration finds only socket
  heartbeats, the arm-to-confirm timeout and Auto's grace (`config/autoMode.js:38`).
  `docs/handoff/RESUME.md:193` already said so: "The timer exists nowhere in the product —
  it is a new feature, not a control to add." The host cannot say how long the room has,
  and neither the console, the wall nor the phones can show it.
- **The round's start time already exists.** `next-question.js:1219` writes `StartedAt`
  on the round's REF row when a round opens. `get-game-state.js:376` returns it as
  `currentQuestion.startedAt`. So "open for 1:24" needs no backend change. A time
  *limit* does.
- **Late arrivals are scattered.** Late items are a rail section, collapsed during
  answering (`consoleRail.js:12-24`, `ConsoleRail.jsx:121-146`). People who joined
  mid-round are not called out anywhere, although each player row carries `JoinedAt`
  (`schema-compliant-manager.js:583`).

---

## 2. Decisions

### D1. Start opens Setup. Setup is the lobby. (A1–A8)

One start for both modes. Three steps, the first two folding to one line once done:

1. **Where the room watches.** The existing chooser, with its drawings and *Help me pick*
   (`RoomScreenChooser.jsx`), moved into step 1. It is shown only when this browser has
   not chosen.
2. **Put the room's screen up.**
   - *Two screens:* the Screens group's window row and size row, drawn as a checklist of
     what the app can verify: Open, Full screen (`presentStatus.js`; never "the projector
     is on"). The one orange button is Your part now's **Open the room's window ↗**.
   - *One screen:* a check, not a window. The size (Room/TV/Call/Table), and a plain
     banner: *The room sees this screen from now on.* **Show the join code** moves from
     Setup to the stage.
3. **The room joins.** How many are in (the setup's one 30px numeral), who arrived in the
   last minute (named in text), and what round 1 is. On two screens the QR is on the
   room's window, and the preview column shows it. On one screen the stage lobby is
   today's, reached after step 2 (A6).

**The QR is not drawn until step 3.** Before that the preview is dimmed and says "Nothing
yet". That answers "the QR code comes up" before setup is done.

**Your part now leads every step,** so the console's grammar holds from the first second:
"Choose where the room watches" → "Open the room's window" → "Start round 1 when the room
is in". The empty slot for Start round 1 is held and named ("Start round 1 · after setup"),
using the held-slot pattern already shipped for the Build Room (`ConsoleFooter.jsx`
`emptyLabel`, `.hc-nomove`).

**No rail during setup.** Before round 1 the rail has nothing the host needs, so Setup
takes the full width. The rail appears with round 1.

**Setup in the strip stays.** It reopens the same panel mid-session, with step 3 folded,
so the owner's "nice" screen is the same screen at the start and in the middle.

### D2. A returning host is one click faster (A7, A8)

Start on the session list says what it will do: **Start · two screens**, with *Two
screens, like last time · One screen this time* under the list. Because Start is a click,
it can open the room's window in the same click: open a blank popup inside the click,
start the session, then send the popup to `/present` and place it. Quick start already
does exactly this (`openPendingRoomWindow`, `present/roomWindow.js:118-131`). The host
lands on A8: steps 1 and 2 done, and the one thing a page cannot do for them (full screen
needs a click on the window itself) said as the status, not as a blocker. If the popup
was blocked, Setup opens at step 2 (A2).

For a one-screen returning host: **Start · one screen** lands on A6 directly, the stage
lobby.

### D3. The pulse: three tiles under Your part now (B1–B5)

Each tile has one fact, and each fact keeps the same place in every phase:

| Tile | Answering | Voting | Results |
|---|---|---|---|
| **1 · the room** | *Answered* 9 of 12, bar, "3 still writing" → green **Everyone's in** with a check | *Voted* 7 of 12, bar, "5 still voting" → Everyone's in | *This round*: 12 answered · 11 voted |
| **2 · time** | ring, **0:47 left of 2:00**, +1 min → amber **Time's up · 0:18 over** | the voting time, if one was set | *Took 2:14 · 2:00 given* · voting took 1:21 |
| **3 · since this round opened** | **+2 joined** (names), late items · Review | same | *Late*: 1 answer · Review |

- **One fact, once.** The count leaves the People header ("12 here" instead) and the
  status line. The rail keeps the names, the tile keeps the number (engage-design hard
  rule 5).
- **One numeral per panel** (the 30px step): the room's count. Time and arrivals use the
  24px step.
- **Calm:** dusk surfaces, the info blue for progress, green only for everyone's in, amber
  only for time's up (`--warn`, "a status, not the accent", `classic.css:70`). No
  animation beyond the ring draining, which moves in 10 s steps under reduced motion.
- **With no time set,** tile 2 shows the elapsed time: *Open for 1:24 · no limit*. That
  comes from `currentQuestion.startedAt`, which already exists, and can ship first.

### D4. The minimal timer (B3, B6, B7, C2, C3)

- **Chosen as the round opens:** a chip beside each opening move (*Start round N*,
  *Start voting*). Presets only: No limit, 1, 2, 3, 5 min. It remembers per session and
  per step, and the last value carries to the host's next session (A8 shows "2 min").
  **No limit** is the default and a first-class choice.
- **Advisory by default.** At zero nothing closes. The tile turns amber and counts over,
  and Your part now says "Time's up. Start voting, or give them another minute." Start
  voting keeps its in-place arm. *Close answering when time is up* is an opt-in tick. If
  Auto is on, it acts on its own rules, as today.
- **+1 min**: one press, on the console (key `+` or `=`) and on the Remote.
- **The wall and the phones see words, not seconds** (ticked by default): "About a minute
  left", "30 seconds left", "Time's up: finish your sentence". A thin draining bar sits in
  the wall's counts foot, beside the pips (`PresentMoments.jsx:64-71` `CountsFoot`), and
  under the phone's answer box. Never red.

### D5. Phone and small laptop (C1–C6)

- **The Remote** mirrors Setup's state (the screens are read-only there, because they are
  a laptop fact) and can start round 1 with the time chip (C1). During answering it gains
  the time card and +1 min next to the meter it already has (C2).
- **The player's phone** shows the time line only when the host ticked it (C3).
- **The host page at 390** stacks Setup, and the preview folds away (C4).
- **At 1280×720** the setup and the console fit without scrolling. The pulse keeps its
  order, and tile 3's names truncate first, with the full list in `title` (C5, C6).

---

## 3. What is new and what is reused

| Reused, unchanged or moved | New |
|---|---|
| `RoomScreenChooser` (drawings, words, Help me pick, `recommendRoomScreen`), moved into step 1 | `SessionSetup` panel: three steps, fold-to-one-line, preview column |
| `ScreensGroup`'s `ScreenChoiceRow`, `RoomWindowRow`, size select (`ScreensGroup.jsx:32-112`) | Step 2 as a checklist (Open / Full screen) built from `presentStatusFrom` |
| `RoomWindowStatus` on the top line; `presentStatus.js` words | "Opened on this screen?" line (M2) |
| `openPendingRoomWindow` (Quick start) | Start on the session list opening the window in its own click; "Start · two screens" label |
| `PresentLobby` on the room's window (A4) | Dimmed preview of what the room will see |
| Stage lobby (A6), dock, `Start round 1` + its hints | Time chip beside opening moves; popover (radiogroup + 2 ticks) |
| `ConsoleFooter` (Your part now), the held slot `emptyLabel` | The pulse row (3 tiles) in the console grid |
| `ConsoleRail` sections, People names via `consolePeopleFor` | People header says "12 here" during rounds (count moves to the tile) |
| `roomIsComplete` / `everybodyIn` (`GameHostPage.jsx:8040`) | "Everyone's in" tile state on the console |
| HostRemote meter + Everyone is in (`HostRemote.jsx:1595-1612`) | Remote time card and +1 min |
| Late list, `lateCounts.notReviewed` | "Joined since this round opened" |
| Wall `CountsFoot` pips | Wall and phone time line in words |

---

## 4. Forks, each with a recommendation

| # | Fork | Options | Recommendation |
|---|---|---|---|
| F1 | Where setup lives | (a) Setup is the lobby: Start opens it (drawn). (b) Keep today's lobby and auto-open Setup as an overlay. (c) Setup as a dialog before the session starts. | **(a).** One place, and the same screen mid-session. (b) keeps two lobbies. (c) puts a modal over the moment the room is joining, and a modal cannot show the live count. |
| F2 | Timer: advisory or binding | (a) Advisory, with an opt-in *Close when time is up* (drawn). (b) Always closes at zero. (c) Display only, no +1 min. | **(a).** Facilitators stretch time when a room is flowing. A binding timer also fails WCAG 2.2.1 for people who need longer. |
| F3 | Time on the wall | (a) Words + bar, on by default (drawn). (b) Exact seconds. (c) Off by default. | **(a).** The room should think, not race. Seconds are for the host only. |
| F4 | Where the time is chosen | (a) Chip beside the opening move (drawn). (b) Per question in the set editor. (c) One session-wide setting. | **(a) now**, with (b) later as a default the chip starts from. (c) is too coarse: a warm-up and a hard question need different time. |
| F5 | Returning host's Start | (a) Start opens the window in the same click (drawn). (b) Start lands on Setup with Open as the main button. | **(a)**, falling back to (b) when the popup is blocked. That is the "one click faster". |
| F6 | The default with no stored choice | (a) Always ask (step 1) on every tier (drawn). (b) Keep the dev-only two-screen default (`surfaces.js:63`). | **(a).** The env default is why dev and test feel different to the owner. Remove it for the lobby. Keep `?surfaces=` for testing. |
| F7 | Rail during setup | (a) Hidden until round 1 (drawn). (b) Shown, with People collapsed. | **(a).** It only repeats step 3's count and names. |
| F8 | One screen: the Remote's address on a projected page | (a) Address text only (drawn). (b) A small QR. | **(a).** Players scan any QR on the wall, and a second QR there is a wrong door. |

## Open questions

- **Q1.** Events: `useConsole` and `showRoomScreen` both exclude event items
  (`GameHostPage.jsx:1272, 7229`). Does an event's item get this setup once per day
  (recommended: once, at the event's first item) or per item?
- **Q2.** Trivia, poll and wavelength already get the console (`useConsole`,
  `GameHostPage.jsx:1272`) but not the chooser (`showRoomScreen` is Call & Answer only).
  Should Setup-as-lobby cover them now? Recommended: yes for the pulse. Setup follows
  `TWO_SURFACE_TYPES`.
- **Q3.** Should the voting timer default to the answering time, or to No limit?
  Recommended: No limit. Voting is short, and a second chip choice is a press.
- **Q4.** Should "Time's up" make a sound on the laptop? Recommended: no. The console is
  glanced at, and a room hears a laptop chime.
- **Q5.** Should the host see "leading so far" during voting? Not drawn. It is a spoiler
  even on a private screen, and the owner did not ask for it.
- **Q6.** Tile 3 says "1 late answer from round 1". Maya (reviews M5) did not understand
  "late". The labels are the owner's (`lateWords.js`); a different word belongs in that
  file, not here.

---

## 5. Implementation note

### Components to change

| File | Change |
|---|---|
| `components/console/panels/SimplePanels.jsx` `LobbyPanel` | Replace with `SessionSetup` (new, `components/console/panels/SessionSetup.jsx`). Its steps are `RoomScreenChooser` (step 1, only when no stored choice), `RoomWindowRow` + the size select (step 2), and joiners (step 3). |
| `components/stage/StepView.jsx` | Setup draws `SessionSetup` with step 3 folded, so the start and mid-session are one component. |
| `GameHostPage.jsx` | During `LOBBY`, render `SessionSetup` for C&A in **both** modes until steps 1–2 are done. One screen then shows the stage lobby (drop the chooser from the stage's `view`, `:8496-8504`). Make `showRoomScreen` part of Setup. Pass `twoSurfacesFor` an env of `undefined` for the lobby (F6). |
| `components/SessionHistoryPanel.jsx` | Start's label from the stored choice; open the pending window inside the click (copy `QuickstartMenu.jsx:183-200`); "One screen this time". |
| `components/console/HostConsole.jsx` + `.css` | A `pulse` grid area between `now` and `main`; a `setup` variant with no rail. |
| `components/console/ConsolePulse.jsx` (new) | The three tiles. Pure props: `{ moment, players, responded, everyoneIn, time: { givenMs, startedAt, extendedMs } \| null, arrivals: [names], late }`. |
| `config/consoleRail.js` `peopleSummary` | "N here" in every phase (the count moves to the tile). |
| `config/consoleWords.js`, `config/roundWords.js` | The new words ("Everyone's in", "Time's up", "+1 min", "About a minute left" …), one file each, as today. |
| `components/HostActionBar.jsx` / `ConsoleFooter.jsx` | An optional `timeChip` slot before the primary on opening moves; `+`/`=` key for +1 min (keys free today). |
| `HostRemote.jsx` | Setup card (read-only screens) in LOBBY; time card + +1 min next to the meter. |
| `present/PresentMoments.jsx` `CountsFoot`; `PlayerPage.jsx` | The time line, when the host's `showOnWall` is on. |

### Data: what exists and what is new

| Need | Exists today? |
|---|---|
| Joined count, names | **Yes.** `players` (`GameHostPage.jsx:286`). |
| Answered count | **Yes.** `answeredCount` (`:424`), names behind `consolePeopleFor`'s anonymity guard (`:8218`). |
| Voted count | **Yes.** `playersWhoVoted` (`:451`). |
| Everyone's in | **Yes.** `everybodyIn` / `roomIsComplete` (`:8040`). |
| Late items | **Yes.** `lateCounts.notReviewed` (`:1491`). |
| Room's window state | **Yes.** `presentDetail` (`:1297`), `presentStatusFrom`. |
| Answering started at | **Yes.** `currentQuestion.startedAt` (`get-game-state.js:376`, written `next-question.js:1219`). Enough for "open for 1:24" and for "joined since this round opened" (`JoinedAt` per player, `schema-compliant-manager.js:583`; check the host's `players` frames carry it, or read it from `playerPerformance`, `GameHostPage.jsx:6244`). |
| Voting started at | **Partly.** STATE `UpdatedAt` is set on every transition, but it is not a reliable phase stamp. Add `PhaseStartedAt` to STATE where the vote opens. |
| Time limit, extensions, show-on-wall | **No.** New STATE fields written by the opening call: `TimeLimitMs`, `TimeExtendedMs` (+1 min appends), `TimeOnWall` (bool), `TimeCloses` (bool). They go out in the existing phase frame and in `get-game-state`, including `?view=room`, so the wall and the phones get them. A small `POST /games/{id}/time` handles +1 min. The **server's** clock is the reference: send `serverNow` with the state, as `presentStatus` does with `ageMs`, so a skewed laptop cannot misreport time left. |
| Remembered chip value | Session: STATE (so the Remote agrees). The host's next session: `localStorage`, like the screen choice. |
| Close at zero (opt-in) | A server-side check when time is up, or the host page firing the existing advance through `runHostAction`, as Auto does. Prefer the host page, which matches Auto (`autoMode.js`), and say on the Remote that it needs the laptop open. |

### Ship order

1. **Setup is the lobby** (D1, F6), with no backend change.
2. **The pulse with elapsed time** (D3 without a limit), with no backend change.
3. **Returning host's Start** (D2).
4. **The timer** (D4): STATE fields, +1 min route, wall and phone line.

### Tests that should hold it

- A `SessionSetup` render test: step 1 only with no stored choice; the QR or preview is
  not drawn before step 3; the step names carry their state (reviews L5).
- `consolePulse` pure tests: the tile facts per moment; everyone's in; time's up; no
  limit shows elapsed.
- A `*Palette.test.js` for the pulse and setup stylesheets (never `*Token*`, which is
  ignored by git). Use the contrast figures from reviews L9.
- A help update (`config/help/host-two-screens.js:122`, `host-setup.js:595`): the lobby
  no longer "asks"; Start does.
