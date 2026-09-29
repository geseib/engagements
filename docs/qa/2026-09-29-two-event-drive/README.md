# Consolidated report: two concurrent events, 5 players each (dev, 29 Sep 2026)

**What ran:** two made-up organisations, one event each, with the same five-item agenda: presentation → Call & Answer → trivia → wavelength → survey. Five fake players joined each event. Both events ran at the same time against **engage.dev.seibtribe.us** (build `16a7887`), driven with Playwright from a Claude Code cloud container.

| | Harbor Light Community Alliance | Brightline Creative |
|---|---|---|
| Who | Non-profit, new team (7 of 11 staff joined this year) | 40-person marketing agency reinventing itself |
| Event / code | Harbor Light Impact Planning Day / **6594** | Brightline Reinvention Offsite / **3685** |
| Workie briefing | **Uploaded `.txt` document** | Key points typed in |
| Special setup | **Trivia order set ahead of time** (5 queued in preview) | **Call & Answer goal = 2 questions** |
| Players | phone ×3, small phone, tablet | phone ×3, small phone, laptop |
| Per-event report | [harbor-light.md](harbor-light.md) | [brightline.md](brightline.md) |

Scope: the mechanics, interaction and presentation of the tools. The question sets and Workie's content are evaluated separately.

## Coverage, and the one environment limit

| Area | Status |
|---|---|
| Sign-up → verify → approval → sign-in, teams, plans | ✅ driven |
| Event create, agenda build (all 5 types), PDF slides, briefing (both routes), goal, shuffle off | ✅ driven |
| Board: Open / preview / Go live / Pause / Resume / End item / End event, at 3 screen sizes | ✅ driven |
| Attendee join-once, agenda, talk + slides, reload recovery | ✅ driven |
| Trivia running order set ahead of time, then honoured live | ✅ verified |
| Survey: 10 players answer every question type, close, results, walkthrough, What We Heard | ✅ played for real |
| C&A answers/votes/results, trivia scoring, wavelength results, Workie's read *with the briefing* | ❌ **not played**: see below |
| Real-time push (phones auto-switching, live counts, instant pause) | ❌ **not observed**: see below |

**Why the gap.** From the container, Chromium's WebSocket handshake to the dev WS API (`h8ipndmk4d…/dev`) returns **HTTP 400**. Node's `ws` library connects through the same proxy with the same headers, so this is the container's egress, not the app. A local relay that would have bridged it was refused by the sandbox's policy, so it was not used. Every page was instead **reloaded after each host step**. Surveys submit over HTTP and were played for real. Everything else a player *sends* goes over the socket and could not arrive.

Two real bugs came out of this degraded mode (items 1 and 2 below). In a room, a phone that drops its connection mid-round is in exactly the state this run forced.

## Findings, most important first

| # | Sev | Who | Finding | Evidence |
|---|---|---|---|---|
| 1 | **High** | player | **An answer sent while offline is silently lost.** `handleSubmitAnswer` (PlayerPage.jsx ~2079) ignores `sendCleanMessage`'s `false` (WebSocketClient.js:296). The phone shows "Application Submitted!" and "If this page reloads, it comes back"; the server holds `answers: []`, and after a reload the answer is gone. It affects C&A, trivia, wavelength and poll answers; votes are probably the same. | `shots/combo-lost-answer.png` |
| 2 | **High** | host | **Running the day leaves every item PAUSED.** Go live on the next item pauses the current one. After all five ran: "0 OF 5 DONE", four PAUSED, the dock suggests "Resume" on the opening talk, and phones list every item (even a closed survey) as PAUSED. Only End-per-item or End-the-event marks them done. | `shots/combo-board-paused.png` |
| 3 | Med | host | **The goal is invisible on the stage.** The header says "ROUND n OF 5"; "Question 1 of 2" is only in SESSION → Questions. Skipping past the goal gives no notice; "That's your 2" appears only on the goal round's results. | `shots/combo-goal.png` |
| 4 | Med | host | **Setting the order ahead of time is hard to find.** Build time only offers "shuffle off". The running order is in SESSION → QUESTIONS (preview), below the category ON/OFF chips and a 6-item list, with no pointer from the agenda. Once found it works perfectly. | `shots/hl-session-panel-questions.png` |
| 5 | Med | host | **Survey "What We Heard" fell back to a generic stub**, with nothing telling the host ("5 responses were submitted… a range of perspectives" plus stock prompts, stored as the ai-summary). A closed survey also offers VOICE / APPROACH "(NEXT QUESTION)". | harbor-light.md |
| 6 | Med | host | **Emphasis is inverted with no answers in.** The emphasised button is "Skip Round" / "Skip Question"; the disabled "Start Voting" / "Show Results" is solid blue and looks live. Skip has no confirmation or undo. | `shots/combo-trivia.png`, `combo-lost-answer.png` |
| 7 | Med | player | **The tablet player layout wastes the screen.** At 820 wide: a narrow top-left column, ~11px text, the rest empty. This held on the agenda, trivia and wavelength screens. | `shots/combo-join.png`, `combo-trivia.png` |
| 8 | Med | player | **Wavelength on a laptop**: 10 stacked inputs, only 2 above the fold at 1280×800. | `shots/combo-wave.png` |
| 9 | Low | player | **The phone header truncates**: "QUESTI…", "QU…", "SUBJ…", "HARBOR LIGHT IMPAC…". The name pill, AGENDA and help crowd the round label. | `combo-trivia`, `combo-wave` |
| 10 | Low | player | **Phone agenda rows are cramped**: "type · leader" squeezed beside the status pill, 3–4 line wraps. | `combo-join` |
| 11 | Low | player | **The C&A prompt is headline-sized on the phone**, pushing the answer box off-screen. The confirmation says "Application Submitted!" for a non-application question. | `combo-lost-answer` |
| 12 | Low | host | **Things are cut off:** "Goes after" select ("1 · Why Brightline must c"); survey "Most…" badge and "Hearing what i…"; portrait-tablet board titles. | `bl-ca-set-picked`, `hl-survey-results`, `combo-board-sizes` |
| 13 | Low | host | **Wording drift:** "Create an organisation" → dialog "Create a team" → button "Create team" → "Organisation plan". The home page says "Events come with the Standard plan", which is wrong for a team. | `home-after-approval` |
| 14 | Low | host | **The personal space is named by a raw UUID** ("74 · 7488f438-…") in the header chip and the console switcher. | `home-after-approval` |
| 15 | Low | host | **Builder:** "Open the stage" and "Run the event" are two orange CTAs with no stated difference. A briefing is not visible on the agenda row. The set picker shows "unversioned" / "v2 · latest". Picking a set pre-fills the room-facing title with "(Demo) …". | `bl-ca-set-picked` |
| 16 | Low | host | **End of day:** "reports are in the session history", with no link. EDIT AGENDA and a dimmed "Go live" remain on an ended day. The console's Events list files an Ended event under "Upcoming". The Sessions list shows raw set ids ("orgY8L…-surveyeventfeedback") and "host Host", with no link to the event. `/admin?section=sessions` lands on Question sets. | brightline.md |
| 17 | Low | player | **The event was set to "Reports: Full"**, but the phone's end screen offers no report or standings. (Standings are listed as not built.) | — |
| 18 | Low | host | **Survey stage contrast:** "FINISHED 5 / 5" is dim green on navy, and the dock status wraps to 3 lines. A closed item shows "Session 1873", a second code beside the event's. | `hl-survey-host-5done` |
| 19 | Low | host | **Sign-up then approval:** the account's registration password stopped working after it was approved (it had been reset during approval). Recovered with Forgotten it?. Worth checking the approval path doesn't reset or require a password. | — |

## What worked well (keep)

- **Agenda building:** about four clicks an item. The Advanced fold's "Changed: …" summary line is the best piece of UI in the flow.
- **Workie briefing:** a document upload became an editable summary in ~4 s. Both routes say plainly that the room never sees it.
- **Preview vs Go live:** rehearse an item without moving the phones, and the prepared session (and its queue) is the one that goes live.
- **The running order**, once found: search → Queue → "5 queued · then automatically", honoured exactly.
- **Presentation slides**: arrow keys, full screen, and phones that follow and can mirror the slide.
- **Join once, all day**: name once, reload-safe, "Not you?" to switch.
- **Two events, two organisations, one host account, side by side**: no cross-talk.
- **The survey end to end**: per-question progress on the stage, an honest close confirmation, clean results and walkthrough.
- **Board fit**: no scrolling at 1024×768, 768×1024 or 1920×1080.

## Suggested next steps

1. Fix #1: show "Not sent — reconnecting" and keep the answer until the socket confirms; or fall back to HTTP. Add a unit test on `sendCleanMessage` returning false.
2. Decide the rule for #2: moving on should mark an item done unless the host explicitly pauses. Make "0 OF 5 DONE" impossible after a full run-through.
3. Put the goal on the stage header ("Round 1 · goal 2 of 5"), and fire the notice when the goal is passed by any route.
4. Link "Set the running order" from the agenda item and from the preview lobby.
5. Re-run this drive from a machine where browser WebSockets work, to cover the ❌ rows. `.claude/skills/engage-event-qa/SKILL.md` is the procedure.
