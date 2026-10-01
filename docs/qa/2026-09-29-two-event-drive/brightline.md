# Event report: Brightline Creative (marketing agency reinventing itself)

**Event:** "Brightline Reinvention Offsite", code **3685**, dev tier, 29 Sep 2026. It ran at the same time as Harbor Light's event (6594).
**Org:** Brightline Creative (team org, Organisation plan).
**Host:** one browser at 1280×800.
**Players (5):**

| Player | Device |
|---|---|
| Alex | phone 390×844 |
| Sam | phone 414×896 |
| Priti | small phone 360×740 |
| Omar | phone 390×844 |
| Chloe | laptop 1280×800 |

Scope: mechanics and presentation only. The question sets and Workie's content are evaluated separately.

## The agenda as built

| # | Item | Set / setup | What it tested |
|---|---|---|---|
| 1 | Why Brightline must change | Presentation, 5-slide PDF | Slides |
| 2 | What should Brightline be known for? | Call & Answer, "(Demo) What We Should Be Known For" | **Goal of 2 questions**, plus a **Workie briefing typed by hand** |
| 3 | GenAI Know-How Quiz | Trivia, "(Demo) GenAI From Three Angles" | Left unplayed on purpose, to see how the end of the day treats it |
| 4 | Speaking the same language | Wavelength, "AI Jargon" | Word entry on a laptop and a small phone |
| 5 | Offsite pulse check | Survey, "survey-event-feedback" | Full play, 5/5 |

Coverage has the same limit as Harbor Light: answers sent over the WebSocket couldn't be delivered from this container. See the consolidated report.

## What worked

- **The goal is easy to set.**
  - Advanced → Goal shows "2 of 5 questions" beside the input, and the fold summary reads "Changed: a goal of 2 questions".
  - The agenda row shows "2 of 5 questions", and the session received `target: 2`.
- **The typed briefing** has a live "435/1,500 characters" counter and the same "never shown to the room" note as the upload route.
- **Two events at once, one host account.**
  - Two host screens in two organisations ran side by side with no interference.
  - Go live on one board never moved the other event's phones.
- **The laptop player (Chloe)** got a usable, centred layout on every screen.
- **Survey:** 5/5 finished, the counts are correct after a reload, and the results page renders.

## What didn't

1. **The goal is hidden while playing.**
   - The stage header says **"ROUND 1 OF 5"** throughout. The goal's progress ("Question 1 of 2") appears only in SESSION → Questions (and on the phone remote).
   - Skipping rounds 1 and 2 passed the goal **silently**. The stage then read "ROUND 3 OF 5", and only the panel said "Question 3 · your goal was 2".
   - The "That's your 2" notice fires only on the results of the goal round, so a host who skips or ends early never sees it.
   - Evidence: `shots/combo-goal.png`.
2. **Silent answer loss,** as in the Harbor Light report. The phone shows "Application Submitted!"; the server has nothing.
3. **"Go live" survives the end of the day.** The unplayed trivia item still shows a (dimmed) "Go live" on the "THE DAY IS OVER" board. The header reads "4 OF 5 DONE" with nothing saying the fifth was skipped.
4. **Picking a set pre-fills a room-facing title with "(Demo) …".** The dialog itself says the title is what the room sees.

## Easy vs hard to figure out

| Easy | Hard |
|---|---|
| Setting the goal (it sits under Advanced, but the summary line reports it) | Seeing progress against the goal during play |
| Writing the briefing yourself | Telling "Open the stage" from "Run the event" |
| Leaving the talk for the next item with the dock's "Go live: Call & Answer" | Knowing that leaving the talk from the board (not the dock) leaves it PAUSED rather than DONE |
| | The set picker's "unversioned" / "v2 · latest": version jargon at the moment of choosing |

## Looks good / could look better

- **Looks good:**
  - The event board, and its fit at every size tested.
  - The survey stage on a laptop.
  - Wavelength's sticky "Submit Words (n/10)" bar, with its plain rule ("A word counts only when everyone says it").
- **Could look better:**
  - **Wavelength on a 1280×800 laptop:** only Word 1 and Word 2 are above the fold (`combo-wave.png`).
  - **Wavelength stage while answering:** the subject and "0 / 5" over a large empty area.
  - **Item dialog:** "Goes after" is cut to "1 · Why Brightline must c" (`bl-ca-set-picked.png`).
  - **Portrait-tablet board (768):** titles and meta truncate ("Why Brightline must chan…", "Call …") (`combo-board-sizes.png`).
  - **Small-phone header (360):** reduced to "SUBJ…", with the name, AGENDA and help crowding it.
