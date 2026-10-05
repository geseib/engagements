# Build Room host redesign: build plan (Layout B)

Prerequisite: the owner has answered `RATIONALE.md` §9, at least questions 1–3. Scoring
(question 5) is not in this plan except as a gated last step.

Every step below is small, ships on its own behind no flag (each one leaves the page
working), and is verified the same way:

- the frontend suite;
- `tests/build-room-copy.js` (no emoji in Build Room files);
- `npm run build`;
- a render of the touched states in the browser pane, compared with the matching mockup
  here.

A push to `dev` deploys. Push only finished steps, per CLAUDE.md.

## Ground rules

- **Nothing is deleted that a test or the owner relies on.** Every test in
  `__tests__/buildRoomPage.test.jsx` keeps its intent:
  - its 49 tests find controls by role and name, not by position;
  - a moved control keeps its accessible name ("Open to the room", "Answer for the room",
    "Send to Claude", "Close", "Discard", "Reconnect", "Present");
  - a test that clicks a control which now sits inside a closed drawer first opens the
    drawer. That is a one-line helper (`openHost('Ideas')`), not a rewrite.
- **Reuse the stage, do not copy it.**
  - `components/stage/Stage.jsx` takes `rail`, `meter`, `dock` and children slots, and
    owns the profile class and the fitter.
  - `Rail.jsx` and `Dock.jsx` take plain props.
  - The Build Room mounts them. It does not re-cut them in `BuildRoom.css`.
  - The drawer reuses the `SessionSetupPanel` geometry (`styles.css:480+`) through its
    own `.brm-drawer` scope, since that class name is load-bearing for the regular
    stage's keys.
- **The `.brm` scope and `buildRoomPalette.test.js` stay the contract** for every new
  selector. New tints are composited and asserted there.
- **Present stays.** The P key and its test stay; only what Present has to hide shrinks.

## Steps

**1. Host chrome becomes a drawer (no visual change to the stage yet).**
- Add `BuildHostDrawer.jsx` with tabs People, Ideas, Claude, Asks and Record, plus Crew
  while crew mode is on. It has an X, Escape, `\`, a focus trap, and stops at the dock.
- Move into it, unchanged:
  - `IdeasInbox` goes to Ideas;
  - `ClaudeActivity` (full) goes to Claude, with the Connect button and `AutoSwitch`;
  - `AskList` and the `ProposedCard`s go to Asks;
  - `Timeline` and `ShotsPanel` go to Record, as accordions with summary lines;
  - `CrewIncoming`, `CrewTasks` and `RunCrewCodeSwitch` go to Crew.
- The Session row in the drawer footer gets Present, Wrap up, Report and End session.
- **Test:** each moved control is reached through the drawer.
  `buildRoomPage.test.jsx` gains `openHost(tab)`.
- **Mockups:** B9–B12, B6 (second screen).

**2. The rail replaces the header.**
- Mount `Rail` with:
  - phase: Building, Choose, Ideas, Rate, Vote, Results, Wrapped up, Ended;
  - the title;
  - context ("Ask 3 of 3");
  - the join cluster, with the code previewing the QR on hover and pinning it on click.
- Remove the header's eleven controls; step 1 already gave each one its home.
- The Claude status becomes the stage line, plus the drawer header.
- `ConnectionChip`'s states become the host bar (step 6).
- **Test:** the connection tests keep their names and assert on the bar.
- **Mockups:** every B page's rail.

**3. The dock and the one next move.**
- Mount `Dock` with:
  - the room-safe status;
  - the HOST button with its unread badge;
  - one primary and one secondary, from a pure function `nextMove(room, ui)` that
    returns `{ status, primary, secondary, waiting }` in the precedence of RATIONALE §4.
    It is unit-tested on its own, with one case per row of that table.
- Keys:
  - Space fires the primary;
  - R opens review;
  - T opens Tell Claude;
  - none of them fire while typing (the existing `isTyping` guard).
- Remove from the stage:
  - `NextPanel`; its parts are the Tell sheet (step 4) and Ask the room;
  - the stage hint lines;
  - `AskStage`'s host kit. Close and Open voting go to the dock; Edit wording, Reopen and
    Discard go to the ask's row in Asks.
- **Mockups:** B1, B3, B7, B8.

**4. Sheets: direction, spoken answer, Tell Claude.**
- `DecidePanel` renders as a dock sheet. The sentence and Send stay visible; Chosen,
  Fold in, the note and the Send to Claude switch fold into an **Adjust** accordion whose
  summary line states their values.
- Spoken mode (from the dock or from the review card) uses the same sheet.
- `NextPanel`'s Tell form becomes the Tell sheet.
- The stage gives up height through the existing fitter (`fitKey`), not by scrolling.
- **Test:** the decide, spoken and Tell tests keep passing with their current names; one
  new test checks that Adjust's summary names the chosen option.
- **Mockups:** B4, B5, B11.

**5. The review card, collapsed.**
- `ReviewCard` shows the question, the options with their thumbnails, the missing
  preview note, Discard, Answer for the room and Open to the room.
- Its five edit inputs fold into "Edit the question and options".
- Edits still save before Open (the existing `beforeDecide` / `open` order).
- The dock shows "Ask N waiting for you", and its primary becomes Review ask N when no
  ask is live.
- **Mockups:** B2.

**6. Notices.**
- Add `BuildNotices.jsx`:
  - a reducer that diffs successive `GET build/state` results and `buildActivity`
    messages into notices (pure and unit-tested; joins batched every 20s, same-kind
    notices merged);
  - a toast stack (at most three, `role="status"`, alerts `role="alert"`);
  - per-tab unread counts.
- Hidden in Present. Clicking a toast opens its tab.
- The error bar becomes an error toast that stays.
- The connection becomes the host bar.
- No server change is needed: every trigger in `notices.html` is a difference between
  two states the page already fetches.
- **Mockups:** B1, B14, notices.html.

**7. People tab (counts only).**
- The roster with:
  - answers (from answers and votes);
  - ideas (ideas and suggestions);
  - picked (chosen respIds; ideas with status used);
  - feedback (ideas with AboutLogId).
- Count server-side in `hostView` (`build-store.js`), so the page never derives names
  from rows it does not otherwise hold. The tests build fixtures through `hostView`
  already.
- No points.
- **Mockups:** B9 without the Points column.

**8. Polish and measure.**
- Render every state at Room, TV, Call and Table (swap the `d-*` class, per
  `engage2-viewing-the-stage`).
- Check the dock never overlaps and nothing scrolls the page.
- Update `docs/design/AUDIT.md` for the Build Room.
- Push to dev, look on `engage.dev.seibtribe.us`, then test.

**9. (Later, owner question 7) A Build Room view of the remote.**
- `/remote?gameId=X` detects a build session and mounts the drawer panels in
  HostRemote's layout:
  - a status card;
  - the needs-you queue (proposed asks, new ideas, feedback);
  - one sticky primary from `nextMove`.
- It uses the same host routes and the host-ticket socket.
- **Mockups:** A3.

**10. (Gated on owner question 5) Points.**
- Add the chosen rule set as a pure function beside `standings.js`.
- Add the Points column.
- Only if the owner says so, wire the Scoreboard's `S` for build sessions.

## Which component moves where

| Component (BuildRoomPage.jsx unless named) | Today | After |
|---|---|---|
| `RoomHeader`, `AgentChip`, `ConnectionChip` | header | `Rail`; drawer header; host bar |
| `AutoSwitch` | header | Asks tab and Claude tab |
| `ConnectPanel`, `WrapUpPanel`, `EndDialog`, `AskComposer`, `CrewDialog`, `EarlyLookDialog`, `QrZoom` | dialogs | unchanged |
| `ReviewCard` | main column, first | Asks tab, collapsed edit |
| `AskStage` | stage + host kit | stage only; kit split dock / Asks row |
| `ChoiceBoard`, `RatingBoard`, `SuggestBoard`, `Whys` | stage | stage (suggestion Hide moves to the Asks row) |
| `DecidePanel` | under the stage | dock sheet, Adjust accordion |
| `IdleStage`, `WrappedStage` | stage | stage (the activity line joins IdleStage) |
| `JoinFoot` | under the stage | meter column (QR box) + rail code |
| `NextPanel` | under the stage | Tell sheet + dock secondary; Preview + Continue in Claude tab |
| `AskList` | under the stage | Asks and Record tabs |
| `ShotsPanel` | under the stage | Record tab |
| `ClaudeActivity` | right column | stage line (newest) + Claude tab (full) |
| `IdeasInbox` | right column | Ideas tab |
| `Timeline` | right column | Record tab; the wall's filtered timeline unchanged in Present |
| `StageTabs` (BuildCrew.jsx) | above the stage | dock secondary |
| `CrewBoard`, `EarlyLook` | stage | stage |
| `CrewIncoming`, `CrewTasks`, `RunCrewCodeSwitch` | right column / header | Crew tab |
