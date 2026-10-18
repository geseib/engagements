# Build Room host walk-through on dev, 18 Oct 2026

Read-only walk. No code changed; this report and its screenshots were committed afterwards.

- **Where:** https://engage.dev.seibtribe.us, signed in as the QA host (`hosts`). The code was read from `origin/dev` at `b84aa54a`. The dev bundle carries this week's strings, such as Settings › Screens and the shared dock. I could not check the pipeline: there is no AWS CLI in this container.
- **Sessions I made:**
  - Build Room **8675** (1366×768), with bots Ada, Ben and Cleo joined over HTTP.
  - Build Room **8301** (1440×900), with nobody joined.
  - Call & Answer **2685** (Quick start "Greatest Hits", two screens), with the same three bots. Its round 1 is still open.
  - Claude Code was never connected.
- **How I measured:** Playwright and Chromium. Every position below comes from `getBoundingClientRect`, written as x,y,width or "x+width".
- **Screenshots:** `shots/` beside this file. Files are cited below by name.
- **Bots:** they joined with `POST /games/{id}/players`. They answered, rated and voted with `build-play/respond` and `build-play/vote`, using the script a throwaway script (not kept). Joining took nothing special.

---

## The five changes that would most reduce the cumbersome feeling, in order

1. **Give the Host screen one fixed place for the main button, as C&A's console footer does.**
   - Today the Host screen has no footer. Its main button sits inside the ask card, and the card scrolls. Measured positions of the main button:

     | Moment | Size | Main button at |
     |---|---|---|
     | Opening | 1366 | 33,857 (below the fold) |
     | Ask live | 1366 | 360,640 (only after the column auto-scrolls) |
     | Results | 1366 | 330,716 |
     | Results | 1440 | 345,743 |

   - The Stage puts the same action somewhere else, in its dock at 701–966 on the right (1366).
   - So the host learns two places for one action, and on Host the place moves with every moment.
   - C&A keeps its main button pinned at the right edge of a fixed footer (right edge x=1350 at 1366), with "Your part now" next to it.
   - This is B8 (the shared `HostConsole` and `ConsoleFooter` on `buildControls`).
2. **Fix the Stage dock's slots so arming and long labels cannot move or hide anything.**
   - At 1366, pressing Show results with nobody answered arms the button. The arm text then pushes Spin the wheel from 400 to 563 and the main button from 701 to 863 (its width grows from 265 to 359).
   - It also pushes **← HOST from 1091 to 1347 and SESSION from 1232 to 1489, off the 1366 screen.** The way home disappears at the moment the host is unsure.
   - "Send the top idea to Claude" makes the dock wrap:
     - its height goes from 93 to 146 and its top from y=675 to y=622;
     - the status line jumps to a line of its own;
     - the SPACE key cap disappears (its width becomes 0);
     - the main button's right edge moves from 966 to 1067.
   - C&A's arm moves its buttons 21 px, and nothing leaves the screen.
   - This is D1 rule 1 ("fixed slots, fixed order"). Hover is already stable, and HOST already goes home in one press. These numbers are the D3 measurement that has not been done.
3. **Hold the header still and put the room's window on it.**
   - The SESSION button's x moves between 590 and 790 depending on screen and moment:

     | Where | SESSION x |
     |---|---|
     | Host, between asks | 658 |
     | Build or History (no "Live" chip) | 590 (−68) |
     | Host with an ask open (the "Ask 1 · 0 of 3" pill) | 788–790 (+130) |

   - Join moves by the same amounts.
   - The room's window link and its status exist only inside Session › Settings › Screens. C&A has them on its top line all the time ("Join 2685 · Room's window ↗ · Room's window: not open"; ca-setup-two-screens-1366.png).
   - The ConsoleTop part of this is B8. Fixed header slots are not planned.
4. **Plain words in Screens, and tell the host to click the room's window to fill the screen.**
   - "Stops every window opened with the old link." sits alone beside a "New link" button and gives no reason to press it.
   - The room's window, placed or not, shows nothing that tells the host one click fills the screen (wall-placed-1366.png is identical to wall-plain-1366.png).
   - The laptop gives two different instructions, and both are tooltips only:
     - the status hint says "Press F on that window" (`config/presentStatus.js:16`);
     - the placing link says "Click it once to fill the screen" (`RoomWindowLink.jsx:23`).
   - Rewrites are under **Words** and **Two screens** below. None of this is planned.
5. **Stop the Host page scrolling into a blank cream area.**
   - On the first screen, a mouse wheel over the middle column (Waiting for you) scrolls the whole document. It moves 419 px at 1366×768 and 258 px at 1440×900. The header goes off the top, and a blank cream (light-theme) band fills the bottom half (host-1366-wheel-middle.png).
   - Cause: `.brm .brm-sr` is `position: absolute`, and the composer's hidden label ("Tell Claude, or log what the room said") has no positioned ancestor inside the scrolling `.brm-hostcol`. So it lands at y=1186 and stretches the page.
   - The fix is one line: `position: relative` on `.brm-hostcol`. Not planned.

There is also a **high bug that is not a "cumbersome" item: the opening ends after its first question.** It is described under Bugs, and fixing it matters more than any of the five.

---

## Moves (controls that change place)

| # | Sev | Screen / size | What moves, measured | Shot | What C&A does |
|---|---|---|---|---|---|
| M1 | high | Stage, 1366 | Choice ask, 0 of 3 answered, first press of Show results (arm): Spin the wheel 400→563, main button 701→863 (width 265→359), ← HOST 1091→1347, SESSION 1232→1489, both **off-screen**. Back to 400/701/1091/1232 when it settles after 6 s | stage-ask-live-1366 → stage-show-results-armed-1366 → stage-after-settle-1366 | Arm on Start voting: buttons −21 px, main button width 173→231, everything stays on screen (ca-answer-armed-1366) |
| M2 | medium | Stage, 1366 | Ideas results, "Send the top idea to Claude": the dock wraps. Height 93→146, top 675→622, status moves to its own line (43,635), SPACE cap goes to width 0, main button's right edge 966→1067, secondary 400→238 | stage-ideas-results-1366 | Footer stays one row, 69 px |
| M3 | low | Stage, 1366/1440 | The main button's left edge follows its label: Show results 701, Open voting 711, Send B to Claude 653, Send the top idea 635. Right edge 966 except in M2. At 1440: Show results 758 (live) → armed 657 (no secondary, right edge 1036 held) → "Send 3.7 to Claude" 688 | stage-rate-live-1440, stage-rate-armed-1440, stage-rate-results-1440 | Main button right-aligned at 1350; its left edge also follows its label |
| M4 | medium | Host, 1366 | The main button changes place every moment (inside the scrolling card): opening "Ask the room to pick" 33,857 (below the fold); ask live "Show results" 360,640; results "Send B to Claude" 330,716; between asks "Connect" 392,453 (in What's next). At 1440: results 345,743 | first-screen-1366, host-opening-ask-live-1366, host-results-1366, host-after-send-1366, host-rate-results-1440 | One footer slot, every moment |
| M5 | medium | Header, 1366 | SESSION x: Host 658, Build/History 590, Host with an ask open 788–790. Join: 429 / 361 / 559–562. Causes: the "Ask N · …" pill (122–132 px wide, its width changing with the moment) is put in front, and the "Live" chip is shown on Host only | first-screen-1366, build-1366, host-opening-ask-live-1366, host-results-1366 | Top line fixed: Join 880, Room's window 992, status 1146 |
| M6 | medium | All screens | The way home and SESSION change corners between screens: on Host, Build and History, SESSION is top-left (658,63) and Host is a top-right tab (1093,16). On Stage the header is gone and they become ← HOST (1091,700) and SESSION (1232,700) at bottom right | stage-1366 vs build-1366 | One console; Session tools in the left rail |
| M7 | low | Host, 1366 | Opening an ask auto-scrolls the left column and the prompt goes out of view above (the path head at y=−820) | host-opening-ask-live-1366 | Task stays at the top of the main area (ca-answer-1366) |
| M8 | low | Session › Screens, 1366 | New link → "New link anyway": the button grows left 1270→1218 (width 76→128). The line beside it changes and wraps to two lines | panel-newlink-armed-1366 | Same pattern |

## Hard to find

| # | Sev | Screen / size | Finding | Shot | What C&A does |
|---|---|---|---|---|---|
| F1 | high | Host, 1366 and 1440 | The first screen's main button ("Ask the room to pick") is below the fold: y=857 at 1366 (viewport 768), y=847 at 1440 (barely in). "Start building" is at y=1068 / 1039. The first thing in view is "How a Build Room works" and Connect Claude Code | first-screen-1366, first-screen-1440 | Footer main button "Start round 1" in view at once (ca-first-screen-1366) |
| F2 | high | All | The room's window (link and status) is only in Session › Settings › Screens, behind `\` or SESSION, then the Settings tab. The panel opens on **Players** by default | panel-players-1366, panel-settings-1366 | On the top line at all times |
| F3 | medium | Host | Nothing on Host says which screen the room's window is showing. I left it on History by pressing 4, then 1. The window kept showing History while the laptop showed Host, with no cue on the laptop | wall-plain-1366 (History), first-screen-1366 | Console says "Next on the wall: …" in the footer status |
| F4 | medium | Stage, between asks | The Stage dock has no main button between asks (only ← HOST and SESSION). Host's What's next offers Connect with "Space does the first", but Space on the Stage does nothing (measured: no screen change, no dialog) | stage-between-asks-1366, stage-between-asks-1440, host-after-send-1366 | Footer always has the next action |
| F5 | low | Host, ask live | 9 buttons in one ask card at 1366 (6 × Pick this, Answer for the room, Spin the wheel, Show results). The main button is the last one | host-opening-ask-live-1366 | One primary, one secondary |

## Words (jargon or unclear, with a plain rewrite)

| # | Sev | Where | Today | Proposed |
|---|---|---|---|---|
| W1 | high | Settings › Screens (`W.wallNewLinkHint`, words.js:585) | "Stops every window opened with the old link." | Label the row "Link shared by mistake?", with the hint "Make a new link. The room's window goes blank until you open it again from here." The armed line (`wallNewLinkWhy`) is fine |
| W2 | medium | Settings › Screens | "Room's window" three times in one row: the label, the status "Room's window: not open" and the button "Room's window ↗" | Label "Room's window". Status "Not open" / "Open, not full screen: click it once to fill". Button "Open ↗" (`SCREEN_WORDS.open` already exists) |
| W3 | medium | Room's window status vs the placing link | "Press F on that window" (`presentStatus.js:16`, a tooltip) vs "Click it once to fill the screen" (`RoomWindowLink.jsx:23`, a tooltip) | One instruction, shown as text: "Click the room's window once to fill the screen (or press F)" |
| W4 | medium | Session panel header (`BuildSessionPanel.jsx:456`) | Green "Connected" while Claude is "Waiting for Claude Code" a few lines below | "Live updates on". Or drop it, since the header already shows Live |
| W5 | medium | Host ask path (`BuildAskPath.jsx:190`, inline) | "Next: 3 Settle · 4 Send to Claude" — "3" and "4" read as the keys 3 (Build) and 4 (History) | "Next: settle the answer, then send it to Claude" (no numbers). "Settle" → "Decide" |
| W6 | low | History filters (`BuildHistoryScreen.jsx:34-35`, inline) | "Artifacts · 0", "Full timeline" | "Pictures and links", "Everything that happened" |
| W7 | low | Timeline | "SYSTEM Asked the room: …", "SYSTEM Closed: …" | "You asked the room: …", "Answers closed: …" |
| W8 | low | Host results hint | "Press Space to send, as Keep in mind" | "Press Space to send to Claude (Claude keeps it in mind)" |
| W9 | low | Stage, ideas results | Meter reads "ANSWERED 3/3" on a vote (`buildScreens.js:463` is always 'Answered') | "VOTED 3/3" |
| W10 | low | Stage dock, rating | "Send 3.7 to Claude" | "Send the rating (3.7) to Claude" |
| W11 | low | Settings › Claude | Notes describe opposite states: "Off: the Stage shows only the count." (List names) vs "On: Claude's questions skip your review." (Auto-open, which is off) | Describe the current state, or always the "On" state |
| W12 | low | Words module rule (standards §2) | Inline user-facing words: `BuildAskPath.jsx:190,319` ('3 Settle', 'Settle'), `BuildHistoryScreen.jsx:34-35`, `buildScreens.js:463,531,536,541` (meter headings and status lines) | Move into `buildroom/words.js` |

## Two screens / the room's window

| # | Sev | Screen / size | Finding | Shot | What C&A does |
|---|---|---|---|---|---|
| T1 | high | Room's window, 1366 | `/present?gameId=8675&type=build&k=…` and the same with `&placed=1` render identically. Nothing says "click once to fill the screen". `useClickToFill` is wired (`PresentPage.jsx:96`) but has no visible cue. The laptop then says "Room's window: open, not full screen" (measured after 9 s), with the fix only in a tooltip | wall-plain-1366, wall-placed-1366 | Same gap: C&A's window has no cue either. But C&A's status sits on the top line where the host sees it |
| T2 | medium | Room's window | The window follows 2/3/4 in about 1.5 s (measured 1526 ms for 2). P on the laptop does not move it (by design, Q4). But a window opened later shows whatever 2/3/4 was pressed last, here History with no heading. Nothing on the window says which screen it is | wall-plain-1366, wall-build-1366 | n/a |
| T3 | medium | Settings › Screens | No one-screen / two-screen choice, and no "Where will the room watch?" before the first ask | panel-settings-1366, first-screen-1366 | Setup asks first, with Help me pick (ca-first-screen-1366) |
| T4 | low | Room's window, results | The window carries no buttons (0 measured). The one-screen Stage still shows "Pick this" / "Choose this instead" to the room | wall-results-1366 vs stage-results-1366 | n/a (by design on one screen, §2.5) |

## Doesn't match C&A (with the standard's section)

| # | Sev | Screen / size | Finding | Shot | Standard / C&A |
|---|---|---|---|---|---|
| C1 | high | Host | No footer, no "Your part now", no strip on the Host screen. The ask path (1 Ask · 2 The room chose · 3 Settle) is the only "where am I" | host-results-1366 | §1 console, §2 loop + "Your part now" |
| C2 | high | Stage, Ideas | **Open voting with 0 ideas does not arm.** One press opened voting with no ideas. Bots' later suggestions got 409 "Answers are closed". `armFor` (`buildControls.js:61-69`) arms only `close` and the run list's next step | stage-ideas-live-1366, then stage-open-voting-armed-1366 (taken after the press: it did not arm) and stage-ideas-3-1366 | §3: C&A *disables* Start voting at 0 ("Nobody has answered yet", ca-answer-1366) and arms at 1 of 3 ("2 of 3 still writing. Press again…") |
| C3 | medium | Stage, choice with 0 players | Show results with 0 of 0 present closed at once (no arm: `stillToAct` returns null when the total is 0) | stage-choice-press-1440 | C&A cannot advance with nobody there |
| C4 | medium | Session › Settings | Only Screens carries a scope ("Applies now"). The room shows "Who can get in, and what they can open"; Claude and Crew show none; This session shows "Going back, finishing, stopping" | panel-settings-1366, -mid, -end | §4 every section carries its scope |
| C5 | medium | Session › Settings | Groups are Screens, The room, Claude, Crew, This session. There is no "Your phone as a remote" group | panel-settings-1366 | §4 four groups |
| C6 | low | Stage | The one-screen Stage shows host-only controls to the room: "Pick this" on every option and ballot row, "Choose this instead" / "Choose this idea instead" on results | stage-ask-live-1366, stage-voting-3-ideas-1366, stage-results-1366 | §1 one screen = public. Kept by design in PLAN §2.5 |
| C7 | low | Host composer → Ask the room | "Ideas" / "Choose" / "Rate" in the composer opens a modal dialog | host-ideas-compose-1366 | PLAN §2.6b: C&A's Ask the room composer sits inline |

## Bugs

| # | Sev | Screen / size | Finding | Shot |
|---|---|---|---|---|
| B1 | **high** | Opening, both sizes | **The opening ends after its first question.** On a new session the wall read says `opening.phase: "opening"`. After "Ask the room to pick" (step 1 of 9) it says `"building"` while the ask is still live. Reproduced on 8301. "The opening" disappears from the right column. After sending, the Now card says "Started building too soon? Back to the opening". Steps 2–9 are skipped, and Claude never receives the "framed the build" Do now. Cause: new sessions never write `Phase: 'opening'` (only `opening/resume` does, `build-room.js:1116`), and `phaseOf` (`build-store.js:189-192`) reads `'building'` as soon as any ask exists. `tests/build-room.js:1210` decides step 1 but never checks the phase, because `seed()` writes no Phase | host-opening-ask-live-1440, host-opening-ask-live-1366, host-after-send-1366 |
| B2 | medium | Host, 1366 / 1440 | The page itself scrolls 419 px / 258 px into a blank cream area (see top five, item 5). `.brm-sr` label at y=1186 with no positioned ancestor | host-1366-wheel-middle, host-1366-scrolled |
| B3 | medium | Host composer | Text typed in "Add something" is not carried into the Ask the room dialog: Question is empty. After asking, the composer still holds the old text | host-ideas-compose-1366, host-rate-compose-1440 |
| B4 | medium | Stage, voting | The voting moment always offers "Spin the wheel" as the secondary, even with 0 ideas on the ballot (`buildScreens.js:531` sets `secondary: instead` unconditionally) | stage-ideas-3-1366 (taken at 0 ideas) |
| B5 | low | Ask the room dialog | The Ideas / Choose / Rate tabs touch, with no gap. The search box is the first input, so a typed question can land in the search ("No ready question matches") | host-rate-compose-1440 |

---

## Already planned (do not redo; map findings to `docs/design/parity/PLAN.md`)

| Finding | PLAN item | Status in PLAN |
|---|---|---|
| C1, M4, top five item 1 (no footer, main button moves on Host) | B8: `HostConsole`, `ConsoleFooter` + `HostActionBar` on `buildControls` | Not started; waits on B7a mockup |
| F2, M5 part (window link and status not on the top line) | B8 `ConsoleTop` (Join, Room's window, status, "The room sees") | Not started |
| F3 (which screen the room sees) | B8 "The room sees: Stage · Build · History" chips | Not started |
| T3 (no one/two-screen choice) | B9 remainder: chooser, `TWO_SURFACE_TYPES`, help | Part built |
| M1, M2, M3 (dock moves, overflow, wrap) | D1 rule 1 (fixed slots) and rule 3; D3 (measure Build Room and C&A) | D1 marked built, but slots not fixed at 1366; D3 not done. These numbers are D3's first data |
| M6 (HOST on the Stage) | D2 | Built: one press home works (measured). The corner change remains |
| C4 (scope labels) | B10 / Q7 | Not started |
| C6, T4 (controls on the one-screen Stage) | §2.5 (kept on one screen by design) | n/a |
| C7 (dialog composer) | §2.6b row "The Composer … Main area, always present" | With B8 |
| Ask path as a strip | Q17 / B8 | With B8 |
| Bots' late suggestions refused (409) | Q8 (refuse, close the race) | Ruled |
| History on the wall cut and "and N earlier" | B7 / B9m | Built / measure pending |
| `window.confirm` and modal confirms | B10 | Not started |

**Not in the plan (new from this walk):** B1 (opening phase), B2 (page scroll), B3 (composer text), B4 (Spin with no ideas), C2/C3 (Open voting arm, zero-total close), W1–W12 (words), T1/W3 (the visible fill-the-screen cue), M5 (header slots), F1 (first-screen main button below the fold), F4 (Space and the main button on the Stage between asks).
