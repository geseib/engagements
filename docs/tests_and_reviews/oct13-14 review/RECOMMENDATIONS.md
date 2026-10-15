# Session 7924 review: what to change, and in what order

Written 2026-10-14 for the product owner and for the agent who will draw the mockups.
It covers the reviewer's companion paper, their interaction spec and HTML mockup, the
app's own 17-page session report, and the code on dev and test.

Code paths are relative to the repo root. Line numbers are from the worktree
`.claude/worktrees/affectionate-bouman-48e07a` (branch `working/build-room-host-redesign`,
the same code as dev and test on 2026-10-14). This is a recommendation only. No code was
changed.

**Updated for version 3 of the mockup (same day).** The owner made decisions after seeing
version 2 and revised the reviewers' spec. They change §3 (the route strip and several rows),
§4.4-4.5 (labels, the whole earlier round, comment targets, report settings) and add §4.6-4.8.
Where the owner's revised spec conflicts with this paper or with version 2, the owner's version
wins, and each conflict is noted where it applies.

---

## 1. Summary

In priority order:

1. **Fix the two things that cost the room's trust.** After a reload, a phone says "You didn't send a response this round" even when the answer is stored (`src/src/PlayerPage.jsx:4270-4274`). And an answer that reaches the server a moment after the host moves on is thrown away while the phone already shows a receipt (`lambda-functions/websocket/message.js:435-438`, `PlayerPage.jsx:2237`).
2. **One "Ask the room" composer, two ways in.** Pressing a Workie icon opens the composer with Workie's words filled in. Pressing "Ask the room" in the dock opens the same composer, blank or with a suggestion picked from a short list. The composer also needs to work on one screen, where today the feature does not appear at all (`src/src/GameHostPage.jsx:1090`, `:7018`).
3. **Give the end of the read a real stop.** On the last page, when Workie has questions ready, the main button becomes "Ask the room" and the second button is "Next round". Earlier in the read, "Next round" needs a second press while questions are still unsent. Today "Next round" sits under every page with nothing to slow it down (`src/src/config/roundStep.js:240`).
4. **Keep everything that arrives late, and label it "Not reviewed".** That covers late answers, late answers to a question for the room, late ideas, and comments added after a round has moved on. The host sees them and can show them or mark them read, and the report lists them.
5. **Let anyone go back to any earlier round, see all of it, and comment.** Phones, laptops and tablets get "Earlier rounds": the question, their own response, every response in vote order, Workie's read, questions for the room and their results, and all feedback. Each comment names its target ("[Theo commented on Maya's response]"). The host's Rounds menu shows the same. Nothing reaches the wall unless the host puts it up.
8. **Show the round's workflow on the host's screens at all times** (owner, 14 Oct, reversing version 2): a slim strip with Setup, the round's loop and Finish, the live step lit, and a line naming what the host is expected to do next (§4.6).
9. **Help the host choose one or two screens at setup**, with the two drawings and "Help me pick" (§4.7).
6. **Make the report a full record of each question for the room.** For each one: what Workie suggested, what was sent and what the host changed, which point of the read it came from, Workie's reason, the results, and the timings.
7. **Show the team's real task on the wall and in the report.** Today the wall shows the history story and leaves out the instruction the room is answering (`src/src/present/presentModel.js:242`).

Open questions for the owner are in §7. The biggest one: should the report list every idea, marked shown or not shown, instead of only the ideas the host picked?

---

## 2. What the run actually showed

The run used both modes. Round 1 was one screen, the default on test. From round 2 the
reviewer added `?surfaces=two` (laptop private, room on `/present`). Many of the
reviewer's points about finding things come from that switch. Session data was read from
`engagetest` (read-only).

| # | What the reviewers said | What it is | Evidence |
|---|---|---|---|
| 1 | Present and the follow-up asks only appeared after a manual URL change. | **One-screen vs two-screen difference**, plus a design question. | Two screens are on by default only on dev (`src/src/config/surfaces.js:24-36`). The laptop offers Present only in two-screen mode (`GameHostPage.jsx:7485`). The laptop shows ask icons and the "asks ready" count only in two-screen mode (`GameHostPage.jsx:1090`, `:6574`, `:7018`). Workie still wrote suggestions in round 1 (`FOLLOWUP#001#SUGGESTED` at 01:07:34Z), but nothing on one screen showed them. The Host Remote does show them in either mode (`src/src/HostRemote.jsx:566`), which is inconsistent. |
| 2 | The first ask reached the phones only after a reload. | **Not an ask-flow bug. Test was redeployed mid-session.** One gap remains. | The test pipeline finished at 01:06:46Z. Players joined at 01:03:59–01:04:52Z and round 1 started at 01:05:09Z, so every phone was still running the 11 Oct bundle (`c0c49ea0`), which predates the question card (`9233513e`, 13 Oct). The first ask went out at 01:12:20Z, and the later asks arrived without a reload. The remaining gap is that a long-open page never learns that a newer version exists. |
| 3 | After a reload, a phone said "You didn't send a response this round" even though the answer was scored. | **Bug.** | The heading reads only `mySubmittedAnswer`, which is local state (`PlayerPage.jsx:372`) and empty after a reload (`:4270-4274`). The rejoin check asks only yes or no (`PlayerPage.jsx:1338-1359`), although the server can return the player's own text with identity proof (`lambda-functions/game/get-answers.js:360-410`). |
| 4 | The wall left out the team's task while answering and voting. | **Bug.** | The wall's ANSWERING moment sets `task` from `q.detail`, which is the history story, not the instruction (`presentModel.js:236-244`). The instruction is `resolveInstruction()` (`src/src/config/instructions.js:41-55`). The story line can also be dropped to make room (`src/src/present/PresentMoments.jsx:130`, `data-drop`). VOTING has no task line at all (`presentModel.js:245-254`). |
| 5 | The report left out the team's tasks. | **Gap.** | The per-round `questionData` has no per-question instruction (`lambda-functions/game/create-report.js:683-694`). Only the set-level one is read (`:1096`), and the report never prints it. |
| 6 | Pressing "Next round" on any page of the read skipped questions that were ready to ask. | **Flow and placement problem.** | Mid-read, the second button is always "Next round" (`roundStep.js:240`). On the last page "Next round" is the main button (`:181`). "3 asks ready" appears only in the status text (`:302`). |
| 7 | "Request feedback" and Ideas / Choose / Rate looked like two systems. | **Flow problem.** | "Request feedback" is the second button on the last page (`roundStep.js:239`), separate from the ask icons. Both ask the room something, through two different doors. |
| 8 | Choose option B was cut off mid-sentence, and A and B overlapped. | **Design question about Workie's suggestions.** | The anchor check tests where an ask came from, not whether an option is a whole sentence. A composer whose fields are open for editing makes a fix one click away (see §4.1). A light "may be cut off" mark in `followup-grounding.js` would help. |
| 9 | Quick Vote cut responses off, so similar openings looked alike. | **Flow problem.** | Rows are cut at 72 characters (`PlayerPage.jsx:3966`). Detailed Vote shows the full text. |
| 10 | Comments in the report quote raw markdown ("## What the room said - \*\*Four answers…"). | **Bug.** | `excerptOf` flattens whitespace but leaves markdown symbols in (`src/src/config/comments.js:156-160`, used at `src/src/components/RoundReport.jsx:235`). Visible on page 4 of the session report. |
| 11 | The wall's feedback moment showed only a title. Ideas showed none until one was picked. | **By design.** | The wall shows only the comment the host puts up (`presentModel.js:291`), and only the ideas the host picks (`lambda-functions/game/followups.js:124`). |
| 12 | The report keeps only the picked ideas, with no names. | **By design (Phase D).** The owner's direction 4 may change this. | `docs/design/followup-icons/PLAN.md` Phase D. `create-report.js:296-306` copies only `Picked`. Unpicked idea rows expire after 7 days (`lambda-functions/game/followup-store.js:16`, `:424`). See §7, question 1. |
| 13 | Workie overclaimed: a made-up "act versus wait" choice in round 4, and wrong counts in rounds 1 and 3. | **Design question about Workie's prompt.** It is outside this flow work. | The report text confirms it (pages 9-11). It belongs in prompt work, not the host flow. |
| 14 | "About this session" described the whole catalogue, including the Negotiation category that had been switched off. | **Minor gap.** | It uses the set's description, not the categories that were active. |
| 15 | In the printed PDF, "Questions for the room" for round 2 sits between the 2nd and 3rd responses. | **Minor print-layout oddity.** | The page order is correct (`src/src/components/GameReport.jsx:775-801`), so the print CSS is the suspect. The cause was not found. |
| 16 | Reordering the queue turned every previewed round into an explicit pick. | **Not checked here.** | Out of scope. Worth its own look. |
| 17 | Present hid names during voting and showed them after; the selected response looked right; targeted comments and the host note reached the report. | **Works as intended.** | — |

Two more problems were found in the code while checking direction 4. The reviewers did
not see them, but they lose data quietly:

- **A late answer is thrown away, and the phone still shows a receipt.** The server drops an answer whose round has moved on and sends nothing back (`message.js:435-438`). The phone marks the answer sent as soon as it leaves for the server (`PlayerPage.jsx:2236-2245`, "The answer reached the socket").
- **A comment typed while the host moves on cannot be sent.** The draft stays on screen (`PlayerPage.jsx:3278-3300`), but the server refuses any comment once the round is no longer on its results (`lambda-functions/game/comments.js:445-450`).

---

## 3. The external proposals: adopt, adapt, defer or reject

| Proposal (spec page / mockup view) | Verdict | Why |
|---|---|---|
| A visible route: Setup → Answer → Vote → Review → Ask room → Wrap up, as a step strip on the host's screen (p.2-3) | **Adopt (owner, 14 Oct)** | Version 2 adapted this away as clutter. The owner reversed that: "the concept is great. i as a host know where i am and what is expected of me." Redrawn as one slim strip, designed in §4.6. It complements the dock: strip = where and what is expected; status line = live counts; main button = the act. |
| A ready check before round 1, with a visible room-screen choice and an "Open Present" button (p.3) | **Adopt** | The fix for finding #1. Setup asks "Where will the room watch?" with the one- and two-screen drawings and "Help me pick" (§4.7). It stores the same switch `surfaces.js` already reads. The owner's revised spec drops the route-preview button; the strip shows the route instead. |
| Owner's revision: the workflow is navigation; "LIVE" marks the room's step, an outline marks the viewed one; "Return to live room" (rev. p.1-3) | **Adopt, limited to looking** | Pressing a step opens a private view; it never sends, opens or closes anything (§4.8). Conflict: the brief for version 3 suggested steps should not navigate; the owner's spec wins. |
| Owner's revision: Players, Questions, Rounds, Settings always visible (rev. p.3-4) | **Adopt** | Drawn as a row in the laptop title bar; the Remote keeps them behind ☰. The owner drew a sidebar; a row keeps the read's width. Either is fine. |
| Owner's revision: settings state their scope: applies now / future picks / locked while live (rev. p.4) | **Adopt** | §4.8. Which settings fall in which scope is open question 9. |
| Owner's revision: "Start round 3" instead of "Next round", "Ask another question" (rev. p.9) | **Adopt** | Still short; names the round. Matches the lobby's "Start round 1". `roundWords.js` gets `startRound(n)`. |
| Owner's revision: "Show this view on Present / Restore live display" (rev. p.11) | **Adopt** | While looking at an earlier step: a quiet "Show this on the wall", labelled "Shown again" on the wall; the status line offers "Back to the live screen". Never reopens answers or votes. |
| Keep the real task visible on the wall in answering and voting (p.4) | **Adopt** | Findings #4 and #5. The wall shows `resolveInstruction()` as the main line. The story becomes the line that can be dropped. |
| "Close answers & start voting" style labels that name what the button does (p.10) | **Reject** | The project rule is plain, short labels kept in `roundWords.js` ("Start voting", "Show results"). The dock's "Next on the screen" line already names the effect. Longer labels break the parity tests and the one-label-per-act rule. |
| Early-close confirmation ("Close with 3 answers") (p.4, 7) | **Already built** | The two-press "arm" ("1 still answering. Press again to start voting.", `roundWords.js:61-63`) does this without a dialog. |
| A Previous / Next page pager inside the read card that never becomes Next round (p.5) | **Adapt** | The laptop pages with the dock today. Keep that, because clickers and the Space key depend on it. Separate the jobs as §4.3 sets out: Next round needs a second press while questions are unsent, and the last page lands on "Ask the room". "Back a page" already exists (`roundWords.js:34`). |
| "Preparing follow-up questions…" → "3 asks ready", with no jump in layout (p.5) | **Adopt** | The status line already says "3 asks ready" (`roundStep.js:302`). Add the "preparing" state so the host knows suggestions are coming. |
| An optional "Ask the room" step with format cards (Ideas, Choose, Rate, Comments), the exact prompt, a privacy line, and "Skip asks and continue" (p.6) | **Adopt and merge** | This is the owner's direction 1. The format cards become the composer's kind switch. "Comments" folds the old "Request feedback" in. The skip is the dock's second button, "Next round". |
| Reconnects that check the saved reply ("Checking your saved reply…") (p.7) | **Adopt** | Finding #3. Restore the player's own answer and ask reply from the server, and show "Checking…" only while that read is in flight. |
| "A preference, not a decision" panels and "No expansion decision recorded" (p.8) | **Reject as a standing panel** | Engage cannot know what a decision is. The host's "Said in the room" note is the honest place for it, and it worked in this run. Keep results as counts. |
| "Select for display & report" on Ideas (p.8, 10) | **Adapt** | Depends on §7, question 1. If every idea goes into the report, the button stays "Put this on the wall" (`src/src/config/followUpWords.js`), and the report marks which ideas were shown. |
| A wrap-up screen with a report preview and the report's scope stated (p.9) | **Adopt (owner's revision)** | Was "later". The owner's revision makes Finish a browsable step: a private preview of the report so far, "Finish the session" as the separate act (rev. p.10). The report still states what it includes and leaves out. |
| Report the original tasks and the active settings (p.11) | **Adopt** | Findings #5 and #14. |
| Keep queue picks and category exceptions clear (p.11) | **Defer** | Out of this flow's scope. Finding #16 should get its own check. The owner's revision replaces this priority with "give edits and transitions an explicit scope", which §4.8 covers. |
| A fixed dock with a "reserved layout track" (p.10) | **Already built** | The dock is already one fixed component, and the Remote reads the same step rules (`roundStep.js:1-23`). |
| Rewritten option text in the mockup's Choose example | **Reject** | Illustration only. The room's options come from the room's answers (`lambda-functions/game/followup-kinds.js:13-14`). |

---

## 4. The owner's four directions, designed

### 4.1 Workie's suggested question = the normal ask, filled in

**Today.** The only way in is a Workie icon beside a point of the read. It opens
`AskPreview` (`src/src/components/AskPreview.jsx`), which shows the question read-only
until the host presses Edit (`:137-161`). There is no blank "Ask the room" on the laptop.
The backend already accepts a question written from scratch: with no suggestion, it is
stored as `origin: 'host'` (`followup-kinds.js:179-186`, `followups.js:184-193`). So this
is mostly a frontend change.

**The design: one composer, `AskComposer` (rename and extend `AskPreview`).**

Three ways in, all opening the same dialog. On the Remote the same content fills a
full-height sheet.

1. **The icon beside a point** (unchanged placement). Opens the composer with that suggestion filled in and selected.
2. **"Ask the room" in the dock** (new; placement in §4.3). Opens the composer with Workie's suggestions listed at the top. If exactly one is unsent, it is selected. Otherwise nothing is selected and the form is blank.
3. **"Ask another"** after a question's results. Today this goes back to the read (`roundStep.js:245-247`). It should open the composer directly, showing the suggestions still unsent.

What the composer shows, top to bottom:

- **Title:** "Ask the room".
- **"Workie suggests"**: up to three cards, each with its kind icon and label, the question, and where it came from ("from Discussion topics, point 3"). Then one plain card, **"Start from blank"**. Picking a card fills the form below. Any other card shows a quiet "Sent" if it has already gone out this round.
- **Kind** (radio cards, each with a one-line job):
  - **Ideas**: "Short written answers. Anonymous."
  - **Choose**: "Pick one of 2 to 4 options. Anonymous."
  - **Rate**: "Agree or disagree with a statement, 1 to 5. Anonymous."
  - **Comments**: "Comment on what we heard, the results or a response. Names are shown." Sending this opens today's feedback beat, which replaces "Request feedback". It has no prompt field, only an optional line saying what to comment on.
- **The words, already editable** (no separate Edit step): the question or statement, and for Choose the options A to D with "Add an option".
- **When the words came from Workie:** an "Edited" chip appears once anything differs, with a "Back to Workie's words" link. The host sees what they changed before the room does.
- **"For you:"** Workie's reason and "From answers 1, 2 and 3", as today (`AskPreview.jsx:205-211`). On one screen this line is folded behind "Why Workie suggests this", because the laptop is the wall.
- **"What the room sees"**: a small phone-shaped preview that updates as the host types.
- **The privacy line for the kind**, for example "Answers are anonymous. Only the ideas you put on the wall are shown to the room."
- **Footer:** "Cancel" (quiet) and **"Send to the room"** (main). While a question is live, Send is greyed and says "Finish the open question first", as today.

**One screen.** Turn the feature on in both modes, and drop the `twoSurfaces` condition at `GameHostPage.jsx:1090` and `:7018`. On one screen the laptop is the wall, so:

- no icons beside points;
- the dock carries "Ask the room";
- the composer opens on the projected screen;
- the "Workie suggests" cards show only the question, without the "For you" reason.

If the host has the Remote open, the Remote shows the icons and the reasons as it does now.

**Data.** The ask row should keep everything the report needs (§4.2), written in `createAsk` (`followup-store.js:224-260`) from the suggestion row it already reads (`followups.js:184-189`):

```
Suggested:   { kind, question | statement, options: [text], why, answers: [n] } | null   // Workie's words at send time
Edits:       ['kind', 'question', 'options'] | []      // worked out on the server from Suggested vs sent
ReadAt:      the read's ForSummaryAt                   // which version of the read it came from
AnchorText:  the bullet's own words                    // "Lena Ortiz asks what the five…"
SentFrom:    'laptop' | 'remote'
RoomSize:    the number of players when it was sent
```

`Suggested`, `AnchorText` and the reason must join the `followup` encryption list
(`lambda-functions/game/tenant-crypto.js:561`). The suggestion row is replaced whenever the
read is redone (`followup-store.js:94-99`). Copying the words onto the ask is therefore the
only way to keep Workie's original wording.

**Edge cases.**

- The read is redone after a question went out: the sent question keeps its own copy.
- Two hosts (laptop and Remote) both press Send: the existing transaction allows only one to go live (`followup-store.js:245-258`).
- Switching kind keeps the words (`AskPreview.jsx:67-77`).
- The kind is Comments while a question is live: refused as Send is today.
- Workie produced nothing: the composer opens blank, with no "Workie suggests" heading.

### 4.2 Every question for the room reaches the report in full

**Today the report carries** the kind, the sent words, the options, the anchor (section heading and point number), the origin, the status, when it was sent, the frozen count, and the picked idea texts (`create-report.js:296-306`). `ReportFollowUps.jsx` prints the kind, where it came from, the words and the counts. It never prints the origin (`src/src/components/ReportFollowUps.jsx:20-58`).

**Gaps:**

| Needed to understand it later | Today | Change |
|---|---|---|
| What Workie suggested, word for word | Lost (not stored on the ask; the suggestion row is replaced on a redo of the read and expires at 30 days) | Store `Suggested` (§4.1). Print "Workie suggested: …" when it differs from what was sent. |
| Whether and how the host changed it | `origin` stored but not printed; no detail | Print "Sent as Workie wrote it", "Edited by the host (question, option B)" or "Written by the host". |
| Where in the read it came from | Section and number only ("Discussion topics, point 3") | Also quote the point itself (`AnchorText`). A number means nothing once the read has changed. |
| Why Workie suggested it, and which answers | Not in the report | Print "Workie's reason: …" and "Drawn from responses 1 and 3", with names only where the round showed names. |
| When it opened and closed; cancelled or closed | `sentAt` only | Add `closedAt` / `cancelledAt` (already on the row, `followup-store.js:280`). |
| How many could answer | Count only ("4 answered") | "4 of 4 in the room answered", using `RoomSize`. |
| Every idea (if the owner agrees) | Picked only; unpicked rows expire at day 7 | Freeze all idea texts onto the ask when it closes (`Ideas: [{id, text, at}]`, sealed), and print them in two groups: "Shown to the room" and "Not shown". See §7, question 1. |
| Late answers to the question | Refused | Listed under "Arrived after the results were shown · not reviewed" (§4.4). |
| The team's task for the round | Missing | Add the per-question instruction to `questionData` and print it under the round title (finding #5). |

The report section keeps its heading "Questions for the room". One question's block
reads:

> **Ideas · from Discussion topics, point 3**
> *"Maya Chen proposes a staged commitment … Can we agree which gate … would justify adding technicians?"*
> **What is one measurable gate Relay should pass before more technicians are added?**
> Workie suggested: "Which gate would justify adding technicians?" · Edited by the host (question)
> Workie's reason: … · Drawn from responses 2 and 4
> Open 01:12–01:14 · 4 of 4 in the room answered
> Shown to the room (1): "In a limited next-stage trial…"
> Not shown (3): …
> Arrived late, not reviewed (0)

### 4.3 Where "Ask the room" sits in the step rules (one main step per moment)

The step rules in `roundStep.js` need these changes. They are the only place both the laptop
and the Remote get their buttons from, and the parity test keeps the two in line.

| Moment | Main button | Second button | Status line |
|---|---|---|---|
| READ, Workie still writing | "Show the read" (greyed) | "Start round N" | "Workie is writing" |
| READ, middle page | "Next page" | "Start round N", **needing a second press while unsent suggestions exist**: "3 questions not asked yet. Press again to start round N." | "Reading page 2 of 6 · Preparing questions" → "· 3 asks ready" |
| READ, last page, unsent suggestions exist | **"Ask the room"** (opens the composer; sends nothing) | "Start round N" (single press: the host has seen the stop) | "Last page · 3 asks ready" |
| READ, last page, no suggestions, or all sent | "Start round N" | **"Ask the room"** (replaces "Request feedback") | "Discussion prompt on screen" |
| ROOM_QUESTION (live) | "Show results" (second press while people are answering) | "Cancel the question" | "2 of 4 answered" |
| ROOM_RESULTS | "Start round N" | "Ask another question" (opens the composer) | "Results are on screen" |
| FEEDBACK (Comments sent) | "Start round N" | "Back to what we heard" | "The room is commenting" |

New labels (in `roundWords.js` and `followUpWords.js`): "Ask the room", "Preparing
questions", "Last page", `armUnasked(n)` → "3 questions not asked yet. Press again for the
next round."

**Edge cases.**

- A clicker or the Space key on the last page opens the composer, never sends. Send needs a deliberate press on the button: Space and Enter only act on the focused button.
- If the composer is closed without sending, the dock is back at "Ask the room / Start round N".
- With the feature off (the route answers 404), the rows behave as they do today, except that "Ask the room" still opens a blank composer if the owner chooses that (§7, question 6).

### 4.4 Late answers, ideas and comments are never lost

**What "late" means.** Anything that reaches the server after its moment has closed:

| Item | Its moment | Late when | Today |
|---|---|---|---|
| Round answer | ASK#nnn | the room is at VOTE#nnn or later | Dropped silently, and the phone shows a receipt (`message.js:435-438`) |
| Answer held offline | ASK#nnn | reconnects after the round moved on | Dropped, with a banner (`src/src/utils/pendingAnswer.js:43-51`, `PlayerPage.jsx:3172-3183`) |
| Answer to a question for the room | while live | after "Show results" or after the round moved on | Refused (`followups.js:291`, `:297`; `followup-store.js:426-444`) |
| Comment | RESULTS#nnn | the room has moved on | Refused (`comments.js:445-450`) |

**What "reviewed" means.** One of three labels, in the owner's words (14 Oct), used on the
host's screens and in the report (never on participants' devices), for every comment and any
item that arrived late:

- **"Not reviewed"**: the default. Nobody has reviewed it during the session.
- **"Reviewed with the room"**: the host put it on the wall.
- **"Reviewed by the host"**: the host opened it and pressed "Mark reviewed", but did not show it.

Not-reviewed items are in the report by default; the host can leave them out (§4.5, report settings).

On-time items are already "in the round": counted, voted on, or in Workie's read. They
carry no label. An on-time idea the host never picked is "Not shown". That is a different
state, and it does not need the late label.

**What the room sees.**

- *Phones, laptops and tablets.* The answer box stays open while the player is typing. If the round closes first, Send still works, and the reply is plain: "Voting has started. Your answer is kept with this round, but it is not in the vote." For a question for the room: "The results are already up. Your answer is kept, but not in the count." The phone's receipt waits for the server's yes. Add an `answerReceived {round, late}` message from `message.js`, and stop marking an answer sent when it merely leaves the phone.
- *The wall.* Nothing, unless the host puts an item up. A late item put up shows a small "Added later" label, and the round's name if it is not the current round.

**What the host sees.**

- *Laptop and Remote dock status line* (no new button): "3 of 4 voted · 1 late answer kept". The count is a link that opens the late list.
- *The late list*: a panel in the History area, grouped by round. Each item shows its words, when it arrived and its label, with two quiet buttons: **"Show on the wall"** and **"Mark reviewed"**. On one screen the panel opens on the projected laptop, so it shows a count only until the host opens it.
- *At the end of the session* (ENDED): the status line reads "2 items not reviewed · Review". The main button stays "Open session report". The host can go to the report without reviewing.

**Data and backend.**

- `message.js` `handlePlayerAnswer`: when the state is past `ASK#nnn` for that round (VOTE, RESULTS or a later round, not ENDED, and within the window in §7, question 4), write `QUESTION#nnn#LATE#<player>` with `Answer`, `AnswerType`, `ArrivedDuring: <state>`, `SubmittedAt`. Use a 30-day ttl, like comments, so it lasts as long as the report needs it. Encrypt it as `answer`. It is never added to votes, scores or the read, and it never touches `session-count.js` (billing), the same rule `followup-store.js:21-23` keeps.
- `followup-store.js`: add a `writeLateAnswer` under `FOLLOWUP#nnn#ASK#<id>#LATE#<player>`, outside the frozen count. An Ideas reply arriving late joins the host's idea list marked "Late".
- `comments.js` `writeComment`: replace the gate at `:445` with "this round has been shown". That means the `ROUND#nnn` row exists and either the state is `RESULTS#nnn`, the room is on a later round, or the session is ENDED within the window. Store `PostedDuring: state.State` and `AddedLater: true` when the room was elsewhere. The membership check stays as it is.
- Review state on all three kinds of row: `Reviewed: 'shown' | 'read' | null`, `ReviewedAt`. Two host routes (Cognito plus `callerMayDriveSession`, answering 404 to anyone else) on the comments function, with no new Lambda because the stack is near its limit: `GET /games/{id}/late` and `POST /games/{id}/late/review { kind, round, ref, how }`. Putting a late item on the wall reuses the comment "feature" route for comments, and the Ideas pick for ideas.
- `create-report.js`: per round, list `late: { answers, askAnswers, comments }` with their labels, under a heading "Arrived late". Names follow the round's Names setting (`isHidden`, `create-report.js:203-205`).

**Edge cases.**

- A late answer from someone who already answered on time: keep only the on-time one; the second is a change and is refused, as now.
- A late joiner who joins during VOTING may still send an answer for this round, labelled late.
- A Redo of Workie's read after late answers arrive does not include them unless the owner wants it to (§7, question 5).
- An event's pause (`EventPaused`) still refuses everything, as now.

### 4.5 Go back to any round: see all of it, and comment

**Today.** The host can browse earlier rounds in the History panel (`PastRound`, `GameHostPage.jsx:8636`, built on the report payload, `src/src/config/sessionHistory.js:12-36`). Phones have no way back. A comment is accepted only while that round's results are on screen.

**The owner, 14 Oct:** participants should "see all of the data" of an earlier round: "the questions, their response, all responses (in order of voting), the AI response, any feedback (the host needs that too when going to the rounds menu)". Comments say what they are about, carry a review label, and can be anonymous.

**Participant devices.**

- A quiet **"Earlier rounds"** link sits in the page header, never as a main button.
- It opens a list: "Round 1 · Churchill Bets Britain on an Unproven Ally · 4 responses · What we heard · 1 question · 5 comments". Only rounds the room has already seen.
- Opening a round shows the **whole round**, in this order, each part with a **"Comment"** beside it:
  1. The question (the task).
  2. Your response (highlighted).
  3. All responses, in the order the vote ranked them, with vote counts, and names only if that round showed names ("Response 3" otherwise).
  4. What we heard (Workie's read, all pages).
  5. Questions for the room, with their results (counts, or the ideas the host showed).
  6. Feedback: every comment, each with what it is about and a "Reply".
- *Phone:* one column; each part folds to one line until tapped. *Tablet and laptop:* three columns: the round's parts on the left, the content in the middle, the feedback beside it.
- **The comment box** shows its target as a chip ("On: Maya's response", with "Change") and a quote of the part. Below the text: **"Send anonymously"** (a tick box): "Your name is hidden from everyone: the room, the wall, the host and the report." Otherwise: "Your name is shown with your comment." When the host has turned on anonymous feedback, the box says "Feedback is anonymous in this session" and the tick box is not shown.
- If the room starts a new answer or question while the player is in an earlier round, a banner says "The room is answering round 4" with **"Go to it"**. A draft is kept, as today's rule requires (`PlayerPage.jsx:3278-3300`).
- Review labels are never shown to participants (open question 14).
- *New public read:* `GET /games/{id}/rounds/{nnn}/review?playerName&clientId`. Membership is checked as for comments. It returns the round shape `/feedback-round` returns, plus the ranked responses, the asks with results, and the round's comments, with that round's anonymity and each comment's anonymity applied.

**Comment targets.** A comment is about exactly one of: the question, a response, What we
heard, a question for the room, or another comment (a reply). Stored as
`Target: { kind: 'question' | 'response' | 'read' | 'ask' | 'comment', ref }`. Today's feedback
beat already carries a "what it is about" field; this generalises it. The report prints one line
per comment, in the owner's form:

> `[Theo commented on Maya's response]: "I like this…"` · Reviewed with the room
> `[Lena Ortiz commented on What we heard]: "…"` · Added later · Reviewed by the host
> `[Maya commented on Lena's comment]: "…"` · Not reviewed
> `[Anonymous commented on the question]: "…"` · Not reviewed

In a round that hid names, a response target reads "on Response 3". A reply to an anonymous
comment reads "on an anonymous comment".

**Host laptop and Remote.**

- **Rounds** (the menu place, today's History) opens the same whole-round view, feedback included, with each comment's label and "Show on the wall" (→ Reviewed with the room) and "Mark reviewed" (→ Reviewed by the host). Each round shows "2 not reviewed".
- A **"Said in the room"** box (today only in the feedback beat, `GameHostPage.jsx:7037`) is available on every round in Rounds, and on any beat of the current round's results.
- Looking at Rounds is a private view in the sense of §4.8: the room keeps its place, and "Back to the room" returns.

**Report settings** (Settings › Report, and shown again beside "Open session report" at the end):

- **"Include items not reviewed"**: on by default. When off, the report leaves out comments and late items marked "Not reviewed", and says how many it left out ("2 comments not reviewed are left out of this report, at the host's choice").
- **"Names on feedback"**: on by default. When off, all feedback in the session is anonymous on the wall and in the report, and each comment box says so.
- **"Send anonymously"** on one comment (the participant's choice): the name is hidden everywhere, the host's own screens included. Recommended: the name is not stored with the comment at all, so it can never be shown later (open question 11). Membership is still checked on send.

**The wall.** Nothing changes unless the host puts a comment up. The featured comment then
shows "On round 1 · Added later" where it applies, what it was about ("On Maya's response"),
and the author, unless the comment is anonymous.

**Report.** Each comment is printed in its round with its "[who on what]" line, its "Added
later" label where it applies, and its review label. The report's scope line states both
report settings.

**Edge cases.**

- Rounds whose names are hidden keep them hidden in the earlier-round view and in comment lines (the anonymity rule applies per round).
- The host turns anonymous feedback on partway through: see open question 12.
- A survey's round 000 keeps its own rules.
- Ending the session closes commenting after the window the owner chooses (§7, question 4).

### 4.6 The workflow strip (owner, 14 Oct)

The owner, on the reviewers' route strip: "im not sure the visual is the greatest but the
concept is great. i as a host know where i am and what is expected of me during the process."
Version 2 had adapted it away; version 3 adopts it with a new drawing.

**What it is.** One slim strip under the laptop's title bar, always visible to the host:

```
✓ Setup › [ Round 2 of 6 ↻  ✓ Answer  ✓ Vote  (What we heard · page 2 of 6 · LIVE)  [Ask · 3 ready] ] › Finish
YOUR PART NOW  Read with the room. Next page turns the page; the questions wait for the end of the read.
```

- Setup and Finish sit outside the loop (once per session). The loop is the same four steps every round: Answer, Vote, What we heard (results and Workie's read), Ask (optional, dashed).
- Done steps are ticked. The live step is filled, with a live dot and its sub-state (results, page N of M, Ideas). Ask shows "3 ready" when Workie has questions.
- **"Your part now"**: one line naming what is expected of the host, ending with the main button's exact label in the button's colour. Wording is fixed per step and lives beside the step rules in `roundWords.js`, so the laptop, Remote and parity test share it.

**What it shows, per moment.**

| Moment | Live step | Your part now |
|---|---|---|
| Setup / lobby | Setup | Choose where the room watches, then **Start round 1** when people have joined. |
| Answering | Answer | Let the room answer, then **Start voting**. |
| Voting | Vote | Let the room vote, then **Show results**. |
| Results | What we heard · results | The results are up. Talk them through, then **What we heard**. |
| Read, middle pages | What we heard · page N of M | Read with the room. **Next page** turns the page; the questions wait for the end of the read. |
| Read, last page | What we heard · page M of M | The read is done. **Ask the room**, or start round 3. (Or the reverse when nothing is unsent.) |
| Composer open | What we heard (live), Ask (viewing) | Drafting a question. The room still sees the read until you press **Send to the room**. |
| Question live | Ask · Ideas | The room is answering. Then **Show results**. |
| Question results | Ask · results | Pick the ideas to show. Then **Start round 3**, or ask another question. |
| Ended | Finish | The session is over. **Open session report**. |

**How it relates to the button bar.** Strip: where the round is and what is expected (fixed
words per step). Status line: live counts and what the room will see next. Main button: the one
act. The strip adds no buttons and no second way to act.

**Pressing a step.** Hover (laptop) or long press (Remote) explains the step. A press opens a
private view of it (§4.8). It never acts.

**Host phone (Remote).** A row of four dots under the Remote's title (done filled, live ringed,
to come empty, optional dashed, viewing orange dashed), with the live step's name and the next
act: "R2 of 6 ●●◉○ What we heard · p. 2 of 6". Tap the row for the step names.

**One screen.** The laptop is projected. Recommended: keep a slimmer strip (step names and the
live step only), because it reveals nothing private and helps the room follow. Drop the "Your
part now" line (it would speak to the host in front of the room). Pressing a step only explains
it; looking at other steps happens on the Remote. Open question 10.

**Never** on the wall or on participants' phones, laptops or tablets; the wall keeps its own
"Round 2 · Voting" heading.

**Data.** None new for the strip itself: it reads the same state `roundStep.js` reads.

### 4.7 Setup: "Where will the room watch?" and "Help me pick" (owner, 14 Oct)

The owner liked version 2's two drawings explaining one and two screens: "maybe this a help me
pick button or such ... a great part of the setup when you first launch the session."

**The choice.** The first thing in the lobby, with Setup live in the strip:

- Heading "Where will the room watch?"
- Two cards, each with its drawing:
  - **Two screens:** "The room watches a second window on the projector or TV. This laptop stays yours: Workie's notes, the icons beside points and late items stay private." With **"Open Present"** in the card.
  - **One screen:** "The projector shows this laptop. Quick to set up, but the room sees everything on it. Your phone's Remote can hold the private notes."
- A link **"Help me pick"** and the line "This browser remembers your choice. Change it any time in Setup or Settings." It stores the switch `surfaces.js` already reads (today only `?surfaces=two`).

**Help me pick** (replaces the two cards in place; no dialog; nothing changes until the host chooses):

1. "Is this laptop connected to the projector or TV?" Yes, by cable or wirelessly / Not yet
2. "Does the projector show its own picture, or a copy of your laptop's screen?" Its own (extended) / A copy (mirrored) / Not sure
3. "Should Workie's notes and suggestions stay private to you?" Yes / It doesn't matter

| Answers | Recommendation |
|---|---|
| Connected, its own picture | **Two screens.** "Press Open Present, drag the new window onto the projector and make it full screen. When the room can see the join code, you are ready." |
| Connected, a copy | **One screen.** If notes should stay private, open the Remote on your phone. |
| Connected, not sure | **Try two screens.** Press Open Present; if the window will not move onto the projector, choose one screen. |
| Not connected yet | **One screen for now.** Switch in Setup once the projector is plugged in. |

Question 3 only changes the wording: when privacy does not matter, one screen is presented as
the simpler choice. The recommendation ends in one button: "Use two screens" / "Use one screen".

**The wall.** Two screens: the new Present window shows the join code, with a foot hint "Drag
this window onto the projector · F for full screen" until it is full screen. One screen: the
laptop shows the join code large, under the slim strip.

### 4.8 Other changes from the owner's revised spec

The owner's revised version of the reviewers' spec (13 pages, "Move through the workflow. Keep
the room anchored.") changes these things against the original:

1. **The workflow is navigation; the live room keeps its place.** Adopted, limited to looking. Pressing a step shows it privately: an earlier step shows what happened, Setup shows the session's settings, Finish shows the report so far, a later step explains what will happen. An orange bar reads "Viewing Setup · the room is still on round 2, What we heard, page 4"; the viewed step has an orange dashed outline; the live step keeps its live dot. While looking, the main button is **"Back to the room"**, which returns to the live view on the same page. The wall and the room's devices never move. State: keep `live` and `viewed` separate in the host page, and keep the live read page when looking elsewhere (the owner's spec says the same). *Conflict:* the brief for version 3 suggested no navigation; the owner's spec wins.
2. **Setup and Finish outside the round loop.** Adopted in the strip.
3. **Players, Questions, Rounds, Settings always visible.** Adopted, as a row in the title bar (the owner drew a sidebar; a row keeps the read's width; on narrow screens it is the compact row the owner's spec describes). Rounds is today's History.
4. **Settings state their scope.** Adopted: session name and room screen "applies now"; categories and picks "from the next round"; the live question, its answers and its ballots are "not while the room is live" and are never reopened by settings (open question 9).
5. **"Start round 3"** replaces "Next round"; **"Ask another question"** replaces "Ask another". `armUnasked(n)` reads "3 questions not asked yet. Press again to start round 3."
6. **"Show this on the wall" / "Back to the live screen"** while looking at an earlier step: a display-only act, labelled "Shown again" on the wall, which never reopens answers or votes.
7. **Finish as a private preview.** Looking at Finish shows the report so far ("Answers and ballots so far 8 / 8") and what it will include; "Finish the session" is the separate act, with one confirmation.
8. **The ask step keeps the room on the read** while the host drafts ("Private draft · live room remains Round 2 Review"). Same as version 2's composer; the strip now shows Ask as "viewing".
9. **The route-preview button and the setup ready-check page are gone**; the strip replaces them.
10. **Priorities:** "Separate viewing from live progress" and "Preserve familiar navigation" become P0; "Give edits and transitions an explicit scope" replaces "Keep queues and category rules understandable". The build order below follows.

Not changed by the owner's revision, and still as in §3: long labels ("Close answers & start
voting") stay rejected; the "A preference, not a decision" panel stays rejected; the in-card
pager stays adapted.

---

## 5. One round, moment by moment

The main reference is **two screens** (laptop private, room on `/present`), with the Remote
open. One-screen differences are marked **[1S]**. Labels are the words to draw.

Every laptop moment carries the workflow strip (§4.6); every Remote moment its row of dots.

**0. Setup: where will the room watch? (once per session).**
- Laptop: "Where will the room watch?" with the two cards and "Help me pick" (§4.7). With two screens, **"Open Present"** in the card.
  - Strip: Setup live. Your part now: "Choose where the room watches, then Start round 1 when people have joined."

**0b. Lobby.**
- Laptop: session title, join code, "Room screen: Two screens · Present is open on the projector · Change", the roster.
  - Dock: main **"Start round 1"**, second "Back to menu". Status: "4 players ready".
- Wall: join code and QR, "4 people here".
- Phone, laptop or tablet: "You're in. The host will start the first round shortly."

**1. Answering.**
- Laptop: the round title, then **"The task:"** with the instruction ("Which long-standing process or structure must be dismantled, who benefits, and how do we bring them with us?").
  - The roster ticks people off as they answer.
  - Dock: main **"Start voting"** (needs a second press with "1 still answering. Press again to start voting."), second "Skip this round". Status: "3 of 4 answered". Next on the screen: "The answers, for voting".
- Wall: "Round 2 · Answering", the title, **the task as the large line**, the story below it (droppable), and the foot "3 of 4 answered on their phone, laptop or tablet".
- Phone: title, task, the answer box. After Send: "Saved. You can change it until voting starts", shown only after the server confirms.

**2. Voting.**
- Laptop: dock main **"Show results"**, second "Next response". Status: "3 of 4 voted · Showing response 1 of 4".
- Wall: the response on screen, "Vote on your phone, laptop or tablet", and the task in one small line at the foot.
- Phone: ballot with **full response text** (Quick Vote rows open to full text when tapped, instead of being cut at 72 characters), and the task in one small line at the top.
- **A late answer arrives now.** The writer's phone: "Voting has started. Your answer is kept with this round, but it is not in the vote." The laptop's status line gains "· 1 late answer kept". Nothing on the wall.

**3. Results.**
- Laptop: dock main **"What we heard"**, second "Show response 1 of 4".
- Wall: the tally with names, if the round shows names.
- Phone: "You wrote response 2" plus the text. After a reload it shows "Checking your answer…" and then the same heading, never "You didn't send a response".
  - A quiet "Add a comment" button (today's "Feedback").

**4. What we heard, pages 1 to N-1.**
- Laptop: the read page. Beside a point that Workie turned into a question, small chips: **"Ideas"**, **"Choose"** or **"Rate"**.
  - Dock: main **"Next page"**, second **"Start round 3"** (needs a second press while questions are unsent: "3 questions not asked yet. Press again to start round 3.").
  - Status: "Reading page 2 of 6 · Preparing questions", then "· 3 asks ready".
- Remote: the topics list with the same chips, and the same dock.
- Wall: the read page, no chips. Foot: "Page 2 of 6".
- Phone: "What we heard is on the main screen." Plus "Add a comment".

**5. What we heard, last page (the stop).**
- Laptop dock: main **"Ask the room"**, second "Start round 3". Status: "Last page · 3 asks ready".
- Wall: unchanged (the last page).

**6. The composer (dialog on the laptop; full-height sheet on the Remote).**
- Title **"Ask the room"**.
- "Workie suggests":
  - Ideas · "What is one measurable gate Relay should pass before more technicians are added?" · from Discussion topics, point 3
  - Choose · "Which should be retired first?" · from Suggested next steps, point 1
  - Rate · "Retire a workaround only when Relay reliably provides its protection." · from Discussion topics, point 2
  - Start from blank
- Kind cards: Ideas / Choose / Rate / Comments, each with its one-line job.
- Editable question. For Choose, the options A to D and "Add an option". An "Edited" chip and "Back to Workie's words".
- "For you: …" and "From answers 1, 2 and 3." **[1S]** folded behind "Why Workie suggests this".
- "What the room sees" (the phone preview). Privacy line for the kind.
- Footer: "Cancel" and **"Send to the room"**.
- Wall while the composer is open: still the read. The room sees nothing until Send. **[1S]** The room sees the dialog itself.
- Opening a chip from step 4 lands here with that suggestion already selected.

**7. Question live.**
- Laptop: the question, its options or scale, and "2 of 4 answered on their phone, laptop or tablet".
  - Dock: main **"Show results"** (needs a second press while people are still answering), second "Cancel the question".
- Wall: "Question for the room · Ideas", the question, and "2 of 4 answered on their phone, laptop or tablet".
- Phone: the question card, "Send", then "Sent. You can change it until the results are shown."
  - A late joiner sees the same card.

**8. Question results.**
- Laptop:
  - Choose: bars and counts. Rate: the average and the spread.
  - Ideas: every idea, each a button **"Put this on the wall"** / "Take it off the wall".
  - Dock: main **"Start round 3"**, second **"Ask another question"** (reopens the composer with the two suggestions still unsent).
- Wall: counts, or the picked ideas, never a name.
- Phone: the result.
  - A reply sent after the results went up: "The results are already up. Your answer is kept, but not in the count."
  - The laptop's results show "1 late answer · not in the count", and for Ideas the late idea joins the list marked "Late".

**9. Next round.** The same sequence starts again.
- A player who is still writing a comment on an earlier round sees "The room is answering round 3 · Go to it", and keeps the draft.

**Side path: going back.**
- Phone → "Earlier rounds" → "Round 1" → "Comment on what we heard" → Send → "Saved. Your name is shown with your comment."
- Laptop History → Round 1 shows "1 comment added later · not reviewed", with "Show on the wall" and "Mark reviewed".
- Wall: unchanged unless shown, then "On round 1 · Added later" with the author.

**End of session.**
- Laptop: dock main **"Open session report"**, second "Back to menu". Status: "2 items not reviewed · Review".
- Report: each round's "Questions for the room" in full (§4.2), plus "Arrived late" and "Added later" with their labels.

---

## 6. Build order

Each phase ships to dev behind the same switches, with tests first, and goes to test for
the owner once it is green. Sizes: S = up to a day, M = 2-3 days, L = about a week.

1. **Trust fixes (S).**
   - Restore the player's own answer after a reload: use `get-answers.js` `getOwnAnswer`, and when `hasAnswered` is true but the text is withheld, show "Your response is in the results".
   - Strip markdown in `excerptOf`.
   - Show the instruction as the wall's task in ANSWERING and VOTING, and put the per-question instruction into the report.
   - Optional: a "A newer version is ready · Reload" banner when the bundle hash changes. That is finding #2's remaining gap.
2. **Orientation (M).** The owner's revised P0s. The workflow strip on the laptop, the dots on the Remote, the slim one-screen strip, with "Your part now" words in `roundWords.js` and the parity test; the setup choice with "Help me pick" (moved up from Polish); the four places in the title bar; `live` vs `viewed` state with the orange "Viewing" bar and "Back to the room"; scope labels on Settings; "Start round N".
3. **One composer, both modes (M).** `AskComposer` with blank and filled-in entries; the step-rule changes in §4.3 (with the parity test); one-screen support; Comments as a fourth kind replacing "Request feedback"; `Suggested` / `Edits` / `ReadAt` / `AnchorText` / `RoomSize` on the ask row.
4. **The report's full record of each question (S).** The `create-report.js` fields and the `ReportFollowUps.jsx` lines in §4.2. If the owner says yes to question 1, freeze all ideas at close.
5. **Late items kept and labelled (M-L).** The `message.js` late row and the server's receipt message; late ask answers; the review state (`Reviewed: 'room' | 'host' | null`, shown as "Reviewed with the room" / "Reviewed by the host" / "Not reviewed") and the two host routes; the status-line count and the late list; the report's "Arrived late".
6. **Earlier rounds for everyone, and comments with targets (L).** The public round-review read with the whole round; the comment gate relaxed to "this round has been shown"; `Target` on comments and replies; "Send anonymously" (no name stored); the two report settings; "Earlier rounds" on phones (one column) and tablets/laptops (three columns); Rounds with feedback and labels for the host; the report's "[who commented on what]" lines; the wall's "On round N · Added later".
7. **Look-ahead extras (S each).** "Show this on the wall" while looking at an earlier step; the Finish preview.
8. **Polish (S each).** Quick Vote expands to full text; a "may be cut off" mark on suggested options; report "About" uses the active categories; check the print layout of the questions section.

---

## 7. Open questions for the owner

1. **Ideas in the report: all of them, or only the picked ones?** Phase D chose picked-only. Direction 4 ("never lost") points the other way.
   *Recommendation:* list all ideas, anonymous, in two groups, "Shown to the room" and "Not shown". Freeze them on the question when it closes, so they outlast the 7-day answer rows. Keep the wall picked-only.
2. **On one screen, should questions for the room appear on the projected laptop?**
   *Recommendation:* yes. Open the composer on the laptop and fold away Workie's "For you" reason. Also add the lobby's "Room screen" choice so hosts find two screens without a URL trick.
3. **Review labels.** *Decided by the owner, 14 Oct:* "Reviewed with the room" (shown on the wall), "Reviewed by the host", "Not reviewed", for comments and late items. Not-reviewed items are in the report by default; the host can leave them out.
4. **How long after the session ends can people add comments or late answers?**
   *Recommendation:* until 24 hours after the end, with a host button "Close comments" to end it sooner. A late answer to a round is accepted only while the session is running.
5. **Should late answers ever reach Workie's read?**
   *Recommendation:* no, not by default. They are listed beside the read, not in it. A host who wants them in can press Redo, and Redo then includes them, with a line in the read saying so.
6. **Should "Ask the room" be offered when Workie made no suggestions, or when the feature switch is off for a tier?**
   *Recommendation:* offer the blank composer whenever the question feature is on for the tier. Keep the tier switch as it is (`FOLLOWUP_ASKS_ENABLED`).
7. **Replace "Request feedback" with the "Comments" kind inside Ask the room?**
   *Recommendation:* yes. It gives the host one door for asking the room anything, and the composer states the difference: comments carry names, the other three kinds are anonymous.
8. **Mid-read "Start round 3": a second press while questions are unsent, or move it into the Session menu?**
   *Recommendation:* the second press. It keeps today's tap count for a host who wants to move on, and it stops the accidental skip the reviewer hit in rounds 3 and 6.
9. **Which settings may change while the room is live?** (raised by the owner's revised spec)
   *Recommendation:* session name and room screen at once; categories, question picks and round count from the next round; the live question, its answers and its ballots never from Settings. A future "reopen" is its own act that says what it does to answers already in.
10. **On one screen, may the host look at other steps on the projected laptop?**
    *Recommendation:* no. On one screen the strip only explains a step, because a private view would be on the wall. Looking happens on the Remote; without one, Setup and Settings open as today and the room sees them.
11. **Can the host ever see who sent an anonymous comment?**
    *Recommendation:* no. The name is not stored with the comment, so nothing can show it. Membership is still checked on send.
12. **If the host turns on anonymous feedback partway through, what happens to comments already sent with names?**
    *Recommendation:* they show as anonymous on the wall and in the report from then on; the names stay stored, so turning it off restores them. Comments sent anonymously by their writer stay anonymous whatever the host does.
13. **In a round that hid names, do earlier-round views and comment lines hide them too?**
    *Recommendation:* yes: "Response 3", and "[Jake commented on Response 3]". The commenter's own name still follows the feedback setting.
14. **Do participants see the review labels?**
    *Recommendation:* no. They are the host's bookkeeping and the report's.
