# The host console: a private laptop screen for two-screen sessions

Date: 2026-10-15. Status: written for the owner's review, not yet built.
Design: `docs/design/host-console/index.html`, the **Full (first draft)** version,
approved by the owner on 15 Oct, with one change: the wall preview becomes a status for
the room's window (below). Read the mockup first; this document says what the mockup
cannot.

## 1. Why

The owner, 15 Oct: "the two screen mode did not adapt most of the guidance from the
reviews ... the reviewer provided a very dashboard like experience, but what im seeing is
just two similar screens one the old way that the host sees and another the room sees ...
the style is not what im wanting you to get from the mockup, but rather the usefulness and
experience the host has at their fingertips. of course we need it to be very simple."

Today, on two screens, the laptop draws the same stage as the wall (projector type sizes,
the room's content in the middle) with the workflow strip added on top. The host
console replaces that on the laptop, on two screens only. One screen is unchanged: the
projected laptop keeps today's stage, because the room sees it.

**Success:** with the wall on the projector, a host can run a whole round from the laptop
without looking up to learn where the room is, what has come in, or what to press next;
the laptop shows their work for the step, never a copy of the wall; and nothing on it
states the same fact twice.

## 2. What the owner decided (15 Oct)

| Question | Decision |
|---|---|
| Show what the wall shows? | First a small live preview; then, on review, **a status for the room's window instead**: "on, full screen" / "open, not full screen" / "not open". The app cannot know a picture is really on the projector. |
| Main area while answering and voting | **Responses as they land** (names hidden while hidden), who is still writing, the host's notes; during voting the ballot in the room's order. |
| Left rail | **Round queue, People, Late & not reviewed, Session tools**: collapsible, the relevant one open for the moment; a section's header opens the full session menu at that section. |
| Top bar | **Two thin lines**: name, join code, room's window, the window status; then the loop alone. "Your part now" moves to the footer. |
| Build approach | **A: a separate console layout** used only on two screens, on the same data and step rules. |
| Version | **Full (first draft)**, over the lean alternative. |

## 3. The layout

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Engagements  Relay expansion        [Join 7924] [Room's window ↗] (● on, full screen) │  line 1
│ ✓ Setup › [ Round 2 of 6 ↻  Answer ● live · Vote · What we heard · Ask ] › Finish │  line 2
├──────────────┬───────────────────────────────────────────────────────────────┤
│ ▸ Round queue│  ROUND 2 · ANSWERING                                          │
│ ▾ People     │  The Meiji Restoration                                         │
│   ✓ Ada      │  ┃ THE TASK  Which long-standing process …                     │
│   … Omar     │  Responses as they land · names hidden        │ For you ·       │
│ ▸ Late (2)   │  [Response 3 · just now] …                     │ background      │
│ ▸ Session    │  [Response 2] …                                │                 │
├──────────────┴───────────────────────────────────────────────────────────────┤
│ 3 of 4 answered   YOUR PART NOW Let the room answer, then Start voting. [Skip] [Start voting] │
└──────────────────────────────────────────────────────────────────────────────┘
```

Laptop type ladder (12 / 13 / 15 / 19 / 24px, `engage-design` §2), dusk, never the
stage's projector ladders. Fits 1366×768 and up without the page scrolling; the main
area and the rail scroll on their own when content is long.

### 3.1 Top, line 1

Session name; **Join 7924** (press: the join QR goes up on the wall, as the rail's code
does today, `qrMode`); **Room's window ↗** (opens `/present`); **the window status**:

| Status | When | Look |
|---|---|---|
| On, full screen | a Present viewer is connected, visible, full screen | green dot |
| Open, not full screen | connected and visible, not full screen | amber, title "Press F on that window" |
| Open, hidden | connected, its tab hidden or minimised | amber, "The room's window is hidden" |
| Not open | no Present viewer connected | grey; pressing it opens one |

The **Session** menu (Players, Questions, Rounds, Settings) is the fourth rail section in
the first draft; nothing else on line 1.

### 3.2 Top, line 2: the loop

The workflow strip as built (`config/workflowStrip.js`, `WorkflowStrip.jsx`), on the
laptop ladder, without "Your part now" (it moves to the footer) and without the four
place links (they move to the rail). Pressing a step still opens the private "Viewing …"
view of it (session flow v3 §4.8), drawn in the console's main area.

### 3.3 Left rail

Four collapsible sections, each with a one-line summary in its header:

| Section | Header summary | Open by itself during | Body |
|---|---|---|---|
| Round queue | "2 of 6" | lobby, between rounds, ended | done / now / next / later rounds with titles; a done round opens its private look-back |
| People | "3 of 4 answered" / "3 of 4 voted" / "4 here" | answering, voting | each person: answered/voted tick or "still writing"; never names beside answers while names are hidden |
| Late & not reviewed | count, amber when above 0 | the read, feedback | the late items and unreviewed comments (session flow v3 Phase 5) |
| Session tools | "● connected" | never by itself | Players, Questions, Rounds, Settings, Remote connections |

Pressing a section's header toggles it; its "All …" link opens the existing Session panel
(`SessionSetupPanel`) at that tab. Which section opens by itself is a pure function of
the moment (`consoleRailFor(moment)`), so the host's own open/close choice holds until the
moment changes.

### 3.4 Main area, by moment

The host's work for the step. Never the wall's layout or type sizes.

| Moment | Main area |
|---|---|
| Lobby | "Where will the room watch?" when not yet chosen (as built); otherwise the join code large, who has joined, and round 1's task |
| Answering | kicker, title, the task; **responses as they land**, newest first, names hidden while hidden (the host's answers route already redacts them); "N still writing"; a side card "For you · background" when the question has one |
| Voting | the ballot in the room's order, the one on the wall outlined; pressing a response puts it on the wall (as the stage cards do today); a side card with the vote bar |
| Results | the tally, names as the round shows them, "on the wall" marked; pressing a response puts it on the wall |
| What we heard | Workie's read, the page on the wall marked; Ask chips beside points; **Ask the room inline** in a right-hand column (the composer's body, not a dialog); "Words from the read" lines are the read itself, pressable |
| A question for the room | its live count, and when closed the results; Ideas to pick for the wall (as `AskStage` does) |
| Feedback | comments as they land, each pressable to the wall (as `RoomMeter` arrivals do) |
| Between rounds | what the round left (picked ideas, comments), and "Up next" with the next round's title and task |
| Ended | the report so far and "Open session report" |

### 3.5 Footer

Left: the live status (`roundStep` `status`), the only place a count appears with the
People header. Middle: "Your part now" (from `workflowStrip`). Right: the second button
and the main button (`HostActionBar`, unchanged: Space, →, ← and the clicker, the
in-place second press). On the first draft the "Next on the wall" line stays under the
status.

## 4. How it is built

### 4.1 Units

| Unit | Job | Depends on |
|---|---|---|
| `components/console/HostConsole.jsx` | the grid: top, loop, rail, main, footer; picks the main panel for the moment | the props below only |
| `components/console/ConsoleTop.jsx` | line 1: name, join, room's window, window status | `presentStatus` |
| `components/console/ConsoleRail.jsx` | the four sections, open state, header summaries | `consoleRailFor(moment)` |
| `components/console/panels/*.jsx` | one per moment family: Answering, Voting, Results, Read (+ inline composer), RoomQuestion, Feedback, Between, Lobby, Ended | the data they show, as props |
| `config/consoleRail.js` | `consoleRailFor(moment)`, the header summaries | none (pure) |
| `config/presentStatus.js` | the window status from the host-state payload | none (pure) |
| `AskComposer` | split into `AskComposerBody` (the form) and the dialog shell, so the console draws the body inline and one screen keeps the dialog | — |

`GameHostPage.jsx` keeps every hook, fetch and handler it has. On two screens, for the
round types, it renders `<HostConsole … />` in place of `<Stage>`; on one screen, and for
surveys and events, it renders `<Stage>` as today. The console receives data and
callbacks, never fetches. This keeps the page the one owner of the live session, and the
console testable on its own.

### 4.2 The window status (the one backend change)

`/present` already joins the socket as a viewer (`websocket/connect.js`,
`Viewer: 'present'`), and `/host-state` already counts them (`presentingCount`). Added:

- The Present page sends `{ messageType: 'PRESENT_STATUS', fullscreen, visible }` on
  connect and whenever `fullscreenchange` or `visibilitychange` fires.
- `message.js` writes `Fullscreen` and `Visible` onto that viewer's own connection row
  (only its own row; a player frame cannot reach it).
- `room-counts.js` `presentingDetail` returns `{ open, fullscreen, visible }` for the
  most recently active viewer; `get-game-state` sends it beside `presenting`.
- The host learns of changes through the existing host-state poll and the
  `presentChanged` frame the viewer's message triggers.

## 5. What does not change

- One screen: the stage, its slim strip, the dock, the composer dialog.
- The step rules (`roundStep`), the words (`roundWords`), the parity test with the Remote.
- The Remote and the wall (`/present`), apart from the window status message.
- Keys: Space, →, ←, the clicker, the in-place second press.

## 6. Testing

- Pure: `consoleRailFor` for every moment; `presentStatus` for the four states.
- Each panel renders its moment from props (React Testing Library), including names
  hidden in an anonymous round and the "on the wall" mark.
- `HostConsole` draws one panel per moment and the footer's button labels come from the
  step (the same labels as the Remote).
- The page renders `HostConsole` only when two screens are on and the type is a round type
  (source scan, as `workflowStripView.test.jsx` does).
- Backend: `PRESENT_STATUS` writes only the sender's own viewer row; a player frame with
  that type changes nothing; `/host-state` carries the detail.
- Walk on dev at 1366×768 and 1440×900: each moment, the rail opening itself, the window
  status through its four states (open, full screen, hide, close the window).

## 7. Not in this piece

- The Window Management API (opening the window full screen on the other display): the
  owner's separate idea, `memory/engage2-second-screen-idea.md`. The status here is ready
  for it.
- The late list's own actions (Show on the wall, Mark reviewed): session flow v3 Phase 5.
  Until then the rail section shows the late count and lists the items without actions.
- A lean variant of the console. The lean mockup stays in the file for reference.
