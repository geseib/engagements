# Simplicity audit: one Call & Answer round, four surfaces

Owner, 2026-10-12, after running session 5479 on dev from the Host Remote: *"Really think deeply on how we can simplify the experience for the host and participants. Moving menus and buttons and having to do the same task differently, having unclear next steps or not moving things forward automatically when they should. Adding clutter or undue extra steps makes for low adoption rate."*

Read against `working/build-room-host-redesign` at `ed987765`. Paths are under `src/src/` unless they start with `lambda-functions/` or `docs/`. "GHP" is `GameHostPage.jsx`. No product code changed. The rules that come out of this are `PRINCIPLES.md`; the revisions and build order are `CHANGES.md`; the mockups are `index.html`.

The four surfaces:

| Surface | What it is | How it learns |
|---|---|---|
| **Host screen** | `GameHostPage.jsx`: the Stage on top, the dock below (`components/stage/Dock.jsx`, `components/HostActionBar.jsx`). Usually the projector. | WebSocket, at once |
| **Stage** | The upper part of the same page; what the room reads. | Same page |
| **Host Remote** | `HostRemote.jsx` on a phone, tablet or laptop. | Polls `/host-state` every 2 s, `/players` every 6 s, the AI summary every 4 s (`remote-parity/NOTES.md` preamble). No socket. |
| **Participant** | `PlayerPage.jsx` on a phone, laptop or tablet. | WebSocket, then a fetch |

---

## 1. The round, moment by moment

Taps count presses that move the round (keyboard Space counts as one). "Arm" is the Remote's tap-again confirm.

### 1.1 Lobby: people are joining

| | Sees | The one next step | Taps |
|---|---|---|---|
| Host screen | QR, join URL, code (GHP:7180); meter "In the room" N (GHP:6520); dock "Ready when you are" (GHP:6903) | **Start First Round** (`config/hostControls.js:442`), disabled until one player and a set | 1 |
| Remote | Status "Not started / Players can join now" (`config/hostRemote.js:850-851`); This round card (Choose next question, Show on the big screen); Scoreboard card; Session card (team switcher, Players & rounds, Categories, Join code, Big screen, Back to Menu) (`HostRemote.jsx:1416-1700`) | **Start First Round** (`hostRemote.js:192`) | 1 |
| Participant | "You're in" / "Joined as {name}." / "Waiting for the game to start. The host will begin the first round." (`PlayerPage.jsx:4303-4344`) | Nothing | 0 |

Second button on the host dock: **Back to Menu** (`hostControls.js:865`). The host does not see which question round 1 will ask on either surface without opening Questions.

### 1.2 Answering (ASK)

| | Sees | Next step | Taps |
|---|---|---|---|
| Host screen | `QuestionCard` (GHP:7245), meter "Answered x / n" (names on U); dock status **"Some are still answering"** / **"Safe to move on"** (GHP:6898-6902) | **Start Voting** (`hostControls.js:453`); secondary **Skip Round** (`:788`) | 1, or 2 with the modal "Proceed to Voting?" (GHP:4385-4391) |
| Remote | Kicker "Collecting responses", headline "Round 3" (`hostRemote.js:854-855`); bar and "10 of 14 answered"; "Still to answer" names (`HostRemote.jsx:1313`); This round card with **Skip round** in red (`:1459-1467`) | **Start Voting** (`hostRemote.js:194-195`) | 1, or 2 (arm: "Tap again to confirm", `HostRemote.jsx:1747`) |
| Participant | Question, "Your task", textarea, "The room will see this response…" (`PlayerPage.jsx:3660-3706`) | **Submit Answer** | 2 (field, submit) |
| Participant, after | **"Application Submitted!"** (`PlayerPage.jsx:3733`), "What you sent", "The host will bring every response up…" | Nothing | |

The two host surfaces say different things about the same fact: the dock says "Some are still answering", the Remote says "10 of 14 answered".

### 1.3 Voting (VOTE)

| | Sees | Next step | Taps |
|---|---|---|---|
| Host screen | "Vote for the best response", recap, response cards, pager (GHP:7276-7320). **Cards cannot be opened: no spotlight in VOTE.** | **Show Results** (`hostControls.js:473`) | 1, or 2 with "Show Results?" modal (GHP:4449-4456) |
| Remote | "Voting"; "x of n voted"; "Still to vote" | **Show Results** | 1 or 2 |
| Participant | "Rank your top three.", Quick ballot by default (`PlayerPage.jsx:467`, `:3827-3974`) | **Submit Votes** | about 7 (Quick) or 5 (Detailed) |
| Participant, after | "Votes Submitted!", "Your ballot", "Who wrote what… goes up on the main screen when voting closes." (`:3788-3812`) | Nothing | |

### 1.4 Results: the tally (`stageBeat` `results`)

| | Sees | Next step | Taps |
|---|---|---|---|
| Host screen | Ranked cards, names, points (GHP:7480-7510), pager, podium. Clicking a card opens `AnswerSpotlight` (GHP:7583) with "2 of 4", Previous / Next (`AnswerSpotlight.jsx:245-263`). Status "Results are on screen". | **What We Heard** (`hostControls.js:485`). → does **not** page unread responses here (GHP:7073); it jumps to the read. | 1; spotlight two and stop: 3 |
| Remote | "Showing results"; "Show on the big screen" opens `RemoteFocusPanel`: Enlarge the question, then every response with its own **Show the room** toggle, amber when on, and "Back to the normal view" (`RemoteFocusPanel.jsx:56-140`); Scoreboard card | **What We Heard** (`hostRemote.js:212-215`) | 1; spotlight two and stop: 5 (open, show, show, back, close) |
| Participant | "Yours was", score card, cue "…this page will not repeat them", then a ghost **Feedback** button with no explanation (`PlayerPage.jsx:4217-4259`) | Nothing, or Feedback | 3 to comment |

Workie starts reading at round close (commit `42974269`), so the read is usually ready before the host presses What We Heard. Neither host surface says so.

### 1.5 What we heard (`field-notes`), pages 1 and 2 of 3

| | Sees | Next step | Taps |
|---|---|---|---|
| Host screen | "What we heard", `AISummaryStatus` paged (GHP:7625-7650); status "Reading page 2 of 3" | **Next Page** (`hostControls.js:600`); secondary **Skip to Next Round** (`:802`) | 1 per page |
| Host screen, read still generating | "Workie is reading the responses…" (`AISummaryStatus.jsx:95`); `notesPages` stays 1 (GHP:6131-6141), so the dock shows **Next Round** and **Request feedback**, status "Discussion prompt on screen". `interceptAdvance` returns false with no markdown (GHP:7075): **Space skips the read with no warning.** | Unclear | |
| Remote | Lead, topics and next steps from the summary JSON (`HostRemote.jsx:1332-1370`), no page, no position | **Next Round** (`hostRemote.js:213-214`): skips every unread page | 1, and the read is lost |
| Participant | **Unchanged.** `stageBeatChanged` reloads the feedback round, gets 409, clears (`PlayerPage.jsx:964-967`, `:1433-1437`); the results card's "this page will not repeat them" stays. `discussionQuestions` (`:1521`) are only inside the Feedback panel, and not shown at all when the summary has markdown (`RoundReport.jsx:403-405`). | Nothing | |

### 1.6 What we heard, last page

| | Sees | Next step | Taps |
|---|---|---|---|
| Host screen | Last page; status "Discussion prompt on screen" | **Next Round**; secondary **Request feedback** (`hostControls.js:828`) | 1 |
| Remote | Same as 1.5 | **Next Round** | 1 |
| Participant | Same as 1.5 | Nothing | |

### 1.7 Feedback round (`feedback`)

| | Sees | Next step | Taps |
|---|---|---|---|
| Host screen | `FeedbackWall`: "What do you make of it?" / "Tap any part of the round on your phone and say what you think." (`FeedbackWall.jsx:31-34`); meter "Comments" N; press an arrival to feature it (GHP:1087) | **Next Round**; secondary **Back to What We Heard** (`hostControls.js:848`) | Opening it: 1 (Request feedback). It **fails silently** when the report cannot be built: console only (GHP:1041-1061). |
| Remote | "Feedback round" and a comment count (`HostRemote.jsx:1372-1381`). It **cannot open** a feedback round (`requestFor` has no feedback case, `hostRemote.js:259-301`), cannot go back, cannot feature a comment. | **Next Round** | |
| Participant | Switches to `FeedbackRoundPanel`: "Read it back, then say what you think. Tap Comment on the summary, on the results, or on any single response." (`FeedbackRoundPanel.jsx:168-171`) | Comment, type, Post comment | 2 |

**There is no feedback question anywhere.** No field, prop or route carries a host's question to the room; the only prompt is the generic "What do you make of it?". This is the owner's "I didn't see a way to get a feedback question, only generic feedback". The follow-up asks backend (`lambda-functions/game/followups.js`, on dev behind `FOLLOWUP_ASKS_ENABLED`) is the answer; it has no screens yet.

### 1.8 Next round, and ENDED

- Host screen: **Next Round** → ASK of the next question. Choosing a specific question first: SESSION › Questions › **Ask next**, 3 clicks (`SessionSetupPanel.jsx:839-847`).
- Remote: **Next Round**; choosing first: **Choose next question** › row › Ask next (`HostRemote.jsx:1419-1427`).
- Participant: straight to ASK. A Feedback draft survives with "The next question is live…" and **Go to the question** (`PlayerPage.jsx:3314`).
- ENDED: host primary **Open Session Report**, secondary **Back to Menu**; the Remote shows "Session complete" and **no button** (`hostRemote.js:217-220`); the participant sees "That's a wrap" and their final score.

---

## 2. The same task, done differently

| Task | Host screen | Remote | Participant | Difference |
|---|---|---|---|---|
| **Decide the next step** | `hostControlsFor` (`config/hostControls.js:694-887`) | `primaryAction` (`config/hostRemote.js:177-223`), a second implementation | n/a | Two functions answer one question. They disagree on field-notes pages, feedback and ENDED (rows below). |
| **Name the round** | `getHostRoundNoun()`: the set's noun, then art, then the type's (GHP:1492, `config/instructions.js:83`) | `roundNounFor(gameType)`: the type's noun only (`hostRemote.js:225-227`) | "Round N" in the header, "Go to the question", "The next question is live" (`PlayerPage.jsx:3273`, `:3314`) | A set that says "Lesson" reads "Next Lesson" on the projector and "Next Round" on the phone. |
| **Advance past Workie's unread pages** | Next Page (`hostControls.js:598-605`); → pages first (GHP:7069-7080) | Next Round, skipping them (`hostRemote.js:212-215`) | n/a | The primary does different things on two devices in the same moment. |
| **Confirm an early advance** | Modal "Proceed to Voting?" / "Proceed to Voting"; "Show Results?" / "Show Results" (GHP:4385-4391, `:4449-4456`; `ConfirmDialog`) | Tap-again on the button itself: "Tap again to confirm" and "4 still answering" (`HostRemote.jsx:1726-1747`, `hostRemote.js:576-583`) | n/a | Different control, different words ("Start Voting" vs "Proceed to Voting"), different place. |
| **Skip a round** | Dock secondary **Skip Round**, **no confirm** (SKIP bypasses the confirm, GHP:4124-4133, `:6386`) | Red **Skip round** in the This round card, tap-again to skip (`HostRemote.jsx:1459-1467`); action label "Skip This Round" (`hostRemote.js:243`) | n/a | Three spellings, two places, one confirms and one does not. |
| **Spotlight a response** | Click a card → modal, "2 of 4", Previous / Next, X (GHP:7493, `AnswerSpotlight.jsx`) | Open "Show on the big screen" → list → **Show the room** per row, amber when on → "Back to the normal view" (`RemoteFocusPanel.jsx`) | n/a | A stepper on one, a list of toggles on the other; no position on the Remote; amber toggles compete with the primary. |
| **Enlarge the question** | Click "Show the full question" (`QuestionCard.jsx:154`) | "Enlarge the question" inside the focus panel (`RemoteFocusPanel.jsx:56-65`) | n/a | Different words, different place. |
| **Turn Workie's page** | → / ← and Next Page | Cannot | n/a | Page index is local state (GHP:429). |
| **Ask the room after the read** | Request feedback (generic) | Cannot | Feedback button vs feedback round panel | The Remote cannot open it; the phone has two doors (its own Feedback button, 3 taps; the host's round, 2) to one composer. |
| **Feature a comment** | Press an arrival in the meter (GHP:1087) | Cannot | n/a | |
| **Remove a player** | SESSION › Players › Remove, no confirm (GHP:3305, `PlayersList.jsx:173-180`) | Cannot | n/a | |
| **Name handover** | Unlock name / Let them take it; **no Not now, no Lock again**; request flag only with the Players tab open (`PlayersList.jsx:121-148`) | Cannot; the request is dropped by `rosterListing` (`hostRemote.js:735-783`) | "Ask the host to hand it over" / "Take over the name" (`JoinNameCollision.jsx`) | Build Room host has all six verbs and a strip; C&A host has four verbs and no strip; Remote none. |
| **Scoreboard** | SESSION › Players › "Show scoreboard on screen"; keys S / V / Esc (`config/setupPanel.js:354-364`, `config/scoreboard.js:253-258`) | A card on every moment: Show/Hide, Next page, three looks (`RemoteScoreboardPanel.jsx`) | No scoreboard view | Hidden on one, always visible on the other. |
| **Who is still answering** | Meter, names on U, subject to anonymity | "Still to answer" chips, always | n/a | Same fact, different rules about names. |
| **Workie's read** | "What We Heard" | "What we heard" (lead, topics, steps) | "AI summary", "Discussion" (`RoundReport.jsx:390`, `:412`) | Three names for one thing. |
| **Response / answer** | "Start Voting", "Response" cards | "Collecting responses" | "Your response", "Submit Answer", "Response N", "Vote this answer 1st" (`PlayerPage.jsx:2724`) | Two nouns on one screen. |
| **Get out of the session** | SESSION › Settings; ENDED's Back to Menu | Session card's Back to Menu | n/a | Remote cannot End session. |
| **The More place** | SESSION button at the dock's right end, class `dock-more` (`Dock.jsx:175-182`), key `\` | No single place: three cards on the round view | n/a | |

---

## 3. Unclear next steps

| # | Moment | Surface | What is unclear | Evidence |
|---|---|---|---|---|
| U1 | What we heard, read still generating | Host screen | Primary reads Next Round and the secondary Request feedback while the room is watching "Workie is reading". Space throws the read away. | GHP:6131-6141, :7075 |
| U2 | What we heard, any page | Remote | The big button skips the read; there is no page button at all. | `hostRemote.js:212-215` |
| U3 | Results | Host screen | → jumps to What We Heard while response pages are unread; on the read, → pages first. The same key means two things in two adjacent moments. | GHP:7073 |
| U4 | Last page | Both | "Request feedback" says nothing about what the room will be asked. Hosts look for a question and find none. | `hostControls.js:828`; owner, 5479 |
| U5 | Feedback round | Remote | Shows a count and Next Round; no way back, no way to feature. | `HostRemote.jsx:1372-1381` |
| U6 | ENDED | Remote | No button and no words beyond "Session complete". The report is one route away and not offered. | `hostRemote.js:217-220` |
| U7 | ASK / VOTE | Host screen | "Safe to move on" is advice, not a step; the primary's own label does not change. | GHP:6898-6902 |
| U8 | Results | Participant | A ghost **Feedback** button below "this page will not repeat them": what it is for is not said. | `PlayerPage.jsx:4250-4257` |
| U9 | What we heard | Participant | The phone does not change at all; the room is told nothing is new. | `PlayerPage.jsx:964-967` |
| U10 | After answering | Participant | "Application Submitted!" in a C&A round with no image; not the product's words. | `PlayerPage.jsx:3733` |
| U11 | Any | Remote | Two amber kinds of button at once when a response is showing (the toggle and the primary). | `RemoteFocusPanel.jsx:57`, `:105`; `HostRemote.css:462-465` |

## 4. Where the system waits for a person when it could move on

Today **nothing moves by itself unless Auto is on** (Session › Settings › "Auto-advance when everyone has responded", off by default, `SessionSetupPanel.jsx:1042-1050`), and Auto lives only in the host page's timer (GHP:5645-5716): a host driving from the Remote with the host page closed gets none of it, and Auto never acts on FEEDBACK (`config/autoMode.js:107-110`, the default case).

| # | Moment | Today | Recommend | Risk |
|---|---|---|---|---|
| A1 | Workie's read arrives on What we heard | Host: shows. Remote: polls every 4 s, shows. Phone: never | **Auto**, every surface | None: it is the beat the host chose |
| A2 | Everyone has answered (ASK) | Status "Safe to move on" | **One tap**: the primary gains a green ring and the status says "Everyone has answered". Auto as today when Auto is on | Auto-opening the vote cuts off a host who wanted to talk first or wait for a late joiner |
| A3 | Everyone has voted (VOTE) | Same | **One tap**, as A2; Auto as today. Open question 2 asks whether to make this auto without Auto | The reveal is a moment a host times; a surprise reveal while the host is talking reads as a glitch |
| A4 | Round closes → read starts | Since `42974269`, automatic | Keep. Say "Workie's read is ready" in the Results status so the host knows the next step costs nothing | None |
| A5 | Results → What we heard | Manual | **Leave manual**, one tap | The tally is where hosts talk; auto would talk over them |
| A6 | Last page of the read | Manual | **Leave manual** | This is a real choice (next round, or ask the room) |
| A7 | Follow-up ask: everyone has answered | Not built | **One tap, offered**: green ring, "Everyone has answered"; open question 3 asks for auto after 4 s | Low: a one-minute poll, nothing to lose; but the room may still be reading |
| A8 | Next round with an ask live | Not built | **Auto close** with its tally (SPEC §4.3.6) | None |
| A9 | Feedback round, Auto on | Auto stops | **Auto** treats FEEDBACK as the last page: Next round after the dwell, unless a comment arrived in the last 20 s | Low; Auto is opt-in |
| A10 | Round changes with a spotlight, scoreboard or name strip up | Spotlight: closed by round-addressed frames (`config/stageFocus.js`) | **Auto close** all three | None |
| A11 | Remote after any action | Waits for the next poll (2 s, 6 s for players) | **Re-read at once** | None |
| A12 | Participant after sending | Waits; says so | Keep, with the new now line (PRINCIPLES R8) | None |

## 5. Clutter

On the Remote's round view today (`HostRemote.jsx:1240-1700`), during an ordinary answering moment, the host sees: the status card, the waiting list, the This round card (**Choose next question**, **Show on the big screen**, **Skip round**), the Scoreboard card (**Show the scoreboard**, **Next page**, three looks), and the Session card (team switcher, **Players & rounds**, **Categories**, **Join code**, **Big screen**, **Back to Menu**). That is **thirteen controls** besides the primary, and the round's own state is the top card only.

| Control | Used per round | Belongs |
|---|---|---|
| Categories, Join code, Big screen (scroll, full screen, open), team switcher, Back to Menu | Rarely; session-level | Behind Session |
| Scoreboard looks (three) and Next page | Once a session | Looks behind Session; one Show scores toggle in Results only |
| Skip round | Rarely; destructive | Behind Session, both surfaces |
| Choose next question | Sometimes, between rounds | Session › Questions; and the fold shows the next round's question so the host need not open it to check |
| Show on the big screen | Every results moment | Becomes the Results moment's stepper card |
| Players & rounds | Sometimes | The status card's count ("See who is here") and Session |

Duplicated information: the round number appears in the bar, the kicker and the headline; the host dock says "Some are still answering" while the meter says "Answered 10 / 14". Competing oranges: the Remote's showing toggles (`hr-btn--primary`), the Stage's amber join code in mockups, the eyebrow.

On the host screen the dock is already disciplined (one primary, at most one secondary by rule, `hostControls.js:738-866`). Its clutter is the **Skip Round** secondary on every ASK and **Back to Menu** in the lobby: both rare, both beside the button pressed every round.

## 6. Taps for one full round

A Call & Answer round: 14 people, all answer and vote; two responses shown and then stopped; a three-page read; then the room is asked once (today: a feedback round). Counted from ASK to the next round's ASK.

| Step | Host screen today | Remote today | Host screen after | Remote after |
|---|---|---|---|---|
| Start voting | 1 | 1 | 1 | 1 |
| Show results | 1 | 1 | 1 | 1 |
| Show two responses, stop | 3 (card, Next, X) | 5 (open, show, show, back, close) | 3 (show, next, stop) | 3 |
| What we heard | 1 | 1 | 1 | 1 |
| Pages 2 and 3 | 2 | cannot | 2 | 2 |
| Ask the room | 1 (Request feedback) | cannot | 2 (Ask the room, Send) | 2 |
| Close the ask | 0 | n/a | 1 (Show results) | 1 |
| Next round | 1 | 1 | 1 | 1 |
| **Total** | **10** | **9**, having skipped the read and the room's say | **12** | **12** |

With one person still answering and one still voting: +2 on the host screen today (two modals), +2 on the Remote today (two arms), +2 on both after (two arms). Choosing a specific next question: +3 on the host screen today, +3 on the Remote today; after, +2 on both (Session › Questions › Ask next, the row opening in place).

The participant: answer 2, vote 7 (Quick) or 5 (Detailed), comment 3 today; after, the follow-up ask is 2 (choose, Send).

The point is not fewer taps. It is the **same** twelve on both host screens, in the same place, with the Remote no longer throwing the read away, and the room asked a real question.

## 7. The ten simplifications, ranked by impact

1. **One decision function for both host screens** (`config/roundStep.js`). Removes every drift in §2's first four rows at once and makes the rest testable. Pending features land once.
2. **The Remote pages Workie's read** (server-held page). Stops the Remote's primary throwing away the read, the fault the host screen was already fixed for.
3. **Ask the room replaces Request feedback**, one panel on both host screens, holding Workie's questions, write your own, and comments on the read. Gives the owner the feedback question and gives the Remote a way to ask at all.
4. **The Remote's round view keeps three things**: the moment's card, the question folded, the primary (and a secondary above it when the moment has one). Thirteen controls move behind one **Session** button.
5. **One stepper for showing responses**, with position, on both. Replaces a list of amber toggles on the Remote; adds the position to the host's modal and publishes it.
6. **One early-advance pattern**: arm and say how many are still in, on both. Removes the modal from the host screen and the "Proceed to Voting" wording.
7. **The read never skips by accident**: while Workie is writing, Next round is the secondary, not the primary. Fixes U1.
8. **Participants always know what now**: one now line per moment from the words file; the phone changes on What we heard; the Feedback button says what it does; "Application Submitted!" goes.
9. **Names in one verb table and one strip**, on both host screens, never on the Stage.
10. **One words file and one round noun**: sentence case, the set's noun first, "What we heard" everywhere (not "AI summary"), "response" for what people write.

## 8. Found in passing

- Request feedback fails silently when the report cannot be built (GHP:1041-1061): the host presses, nothing happens, the reason is in the console.
- `FeedbackRoundPanel` passes no `onSpotlight` to `RoundReport` (`FeedbackRoundPanel.jsx:173-179`), so a response's number badge on the phone does nothing.
- `TYPES_WITH_NO_VOTE_AT_RUNTIME` in `hostRemote.js:102` lacks `poll`, which `hostControls.js` lists; it is documentation only (`runsVotePhase` reads the config), but it is wrong documentation.
- The draft `remote-parity/index.html` labels the ASK primary "Close answers"; the code says "Start Voting". A third spelling in a design that has not shipped; `CHANGES.md` corrects it.
