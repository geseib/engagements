# Event report: Harbor Light Community Alliance (non-profit, new team)

**Event:** "Harbor Light Impact Planning Day", code **6594**, dev tier, 29 Sep 2026.
**Org:** Harbor Light Community Alliance (team org, Organisation plan).
**Host:** one browser at 1280×800.
**Players (5):**

| Player | Device |
|---|---|
| Maya | phone 390×844 |
| Jordan | phone 390×844 |
| Tasha | small phone 360×740 |
| Ben | tablet 820×1180 |
| Rosa | phone 390×844 |

Scope: the mechanics, interaction and presentation of the tools. The question sets and Workie's writing are evaluated separately.

## The agenda as built

| # | Item | Set / setup | What it tested |
|---|---|---|---|
| 1 | Where Harbor Light stands | Presentation, 5-slide PDF | Slides on stage, phones following |
| 2 | How we want to work together | Call & Answer, "(Demo) The Rules We Wrote Down" | **Workie briefing from an uploaded `.txt`** |
| 3 | Team icebreaker: 80s trivia | Trivia, "80s Trivia v3.1", shuffle **off** | **Question order set ahead of time** (5 queued in preview) |
| 4 | Do we speak the same language? | Wavelength, "AI Jargon" | Word entry |
| 5 | End-of-day survey | Survey, "survey-event-feedback" | Full play, 5/5 finished |

## Coverage

⚠️ **Only partly played.** From this test container, browser WebSockets to the dev WS API fail (HTTP 400), so answers sent over the socket never arrive. That rules out Call & Answer answers and votes, trivia and wavelength submissions, and results scoring for those items. Everything else was driven in real browsers against the real dev backend, with pages reloaded after each host step. The survey submits over HTTP, so it was played for real. The consolidated report explains this in full.

## What worked

- **Agenda building was fast and legible.**
  - New event → Add item → pick a set → Add to agenda. That's four clicks per item.
  - The facts strip (date, place, code, joined) reads at a glance.
- **Briefing from a document is excellent.**
  - Workie turned the `.txt` into an editable 8-point summary in about 4 seconds.
  - The panel says "From harbor-light-briefing.txt" and "Nothing here is ever shown to the room".
- **The Advanced fold summarises what changed.** It says "Changed: questions asked in order", so a host never has to open the fold to know what's been changed.
- **Preview.** Opening the trivia item while the talk was live showed its lobby with "Preview — the phones are not here yet", and every phone stayed on the talk. Going live reused the same session (8589), so the preparation carried over.
- **Question order.** In Session → Questions, search then **Queue** built a 5-question running order, labelled "5 queued · THEN, AUTOMATICALLY". Live play asked them in that exact order (compact disc → ALF → Care Bears).
- **Presentation.** ← / → turn slides and F goes full screen. The phones follow ("Slide 3 of 5"), and "Show the slides here" mirrors the current slide.
- **Join once.** A name typed once carried each phone through every item. A reload returned it to the same round.
- **Survey, host side.** The stage shows per-question bars and an "ALL IN" pill. The close confirmation explains the freeze, and results and the walkthrough are clean.
- **End the event.** The confirmation is clear, and afterwards the board reads "THE DAY IS OVER · 5 OF 5 DONE" and phones "That's the day".

## What didn't

1. **An answer sent while offline is lost, and the phone says it was submitted.**
   - All five phones showed "Application Submitted!" and "If this page reloads, it comes back". The server held `answers: []`, and after a reload the answer was gone.
   - Cause, from the code: `PlayerPage.handleSubmitAnswer` ignores `sendCleanMessage`'s `false`.
   - Evidence: `shots/combo-lost-answer.png`.
2. **Moving on pauses items instead of finishing them.**
   - After every item had run once, the board read **"0 OF 5 DONE"** with four items PAUSED.
   - The dock's next step was "Resume Where Harbor Light stands", the opening talk.
   - Phones listed all five items as PAUSED, including the closed survey.
   - Evidence: `shots/combo-board-paused.png`.
3. **Workie's survey read was a generic fallback**, with nothing telling the host. The closed survey's summary screen also offers "VOICE / APPROACH (NEXT QUESTION)" when there is no next question.
4. **With no answers in, the emphasis is inverted.** "Skip Question" / "Skip Round" is the emphasised button, while the disabled "Show Results" / "Start Voting" is solid blue and looks enabled. Skip has no confirmation.

## Easy vs hard to figure out

| Easy | Hard |
|---|---|
| Creating the event and adding items | Where to set the order ahead of time. The only build-time control is "shuffle off"; the running order lives in SESSION → QUESTIONS, below the category chips and a 6-item auto list, and nothing links there. |
| Uploading the briefing | That a briefing is attached at all: the agenda row doesn't show it. |
| Open vs Go live on the board (the subtitle explains it) | "Open the stage" vs "Run the event" on the builder: two orange buttons with no stated difference. |
| Joining as a player | Knowing an item is finished: you have to End each item yourself, which is easy to miss (see "What didn't" #2). |

## Looks good / could look better

- **Looks good:**
  - The event board at 1024×768, 768×1024 and 1920×1080: no scrolling.
  - Survey result cards.
  - The trivia stage's option tiles.
  - The presentation stage.
- **Could look better:**
  - **Phone agenda rows:** the "type · leader" line is squeezed beside the status pill and wraps to 3–4 lines (`combo-join.png`).
  - **Tablet (820 wide):** the player UI sits in a narrow top-left block with small text and half the screen empty (`combo-join`, `combo-trivia`).
  - **Phone header truncation:** "QUESTI…" / "QU…" / "ROUN…" / "SUBJ…", with the event name cut to "HARBOR LIGHT IMPAC…".
  - **The Call & Answer prompt on a phone** is set at headline size, pushing the answer box below the fold (`combo-lost-answer.png`, right).
  - **The Offline banner** takes 3–4 lines at the top of every phone screen.
  - **The survey stage:** "FINISHED 5 / 5" is dim green on navy, and the dock status wraps to 3 lines.
  - **Survey results:** the "Most…" badge and "Hearing what i…" are truncated.
  - **The ended day's closed survey** shows "Session 1873 · closed", a second 4-digit code next to the event's 6594.
