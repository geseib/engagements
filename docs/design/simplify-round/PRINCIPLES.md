# Running a round: the rules every host and participant screen follows

Owner, 2026-10-12: *"Moving menus and buttons and having to do the same task differently, having unclear next steps or not moving things forward automatically when they should. Adding clutter or undue extra steps makes for low adoption rate."*

These rules apply to the four surfaces of a live round: the **host screen** (`GameHostPage.jsx` and its dock), the **Host Remote** (`HostRemote.jsx`, on a phone, tablet or laptop), the **Stage** (what the room reads; the same page as the host screen) and the **participant's phone, laptop or tablet** (`PlayerPage.jsx`). Each rule names the test that holds it. A rule without a test is a wish.

The evidence for each rule is in `AUDIT.md`; the changes that put them in place are in `CHANGES.md`.

---

## R1. One moment, one decision function

The question "what moment is this round in, and what is the one next step?" is answered **once**, by a pure function, and every host surface draws from it.

- `config/roundStep.js` exports `momentOf(snapshot)` and `roundStep(moment, context)`. The moment is one of the closed set in R2. The step is `{ primary, secondary, status, more }`.
- The host dock (`hostControlsFor`) and the Remote (`primaryAction` today) both become thin readers of `roundStep`. Neither may restate a label, a phase rule or a beat rule.
- **Test:** `__tests__/roundStepParity.test.js` builds the same snapshot for every (game type × moment) pair, feeds it to the dock's reader and the Remote's reader, and asserts the **same `primary.id`, `primary.label`, `secondary.id`, `secondary.label`**. A second test greps `HostRemote.jsx`, `hostRemote.js`, `Dock.jsx` and `GameHostPage.jsx` for the label strings of R6 and fails if any appears as a literal.

*Why:* the Remote's `primaryAction` restated the dock and drifted three ways: it skips Workie's unread pages, it never offers feedback, and it names the round with the game type's noun where the host screen uses the set's (`AUDIT.md` §2).

## R2. The moments are a closed set

`LOBBY → ANSWERING → VOTING → RESULTS → READ (page n of m) → ROOM_QUESTION (live, closed) → NEXT`, plus `ENDED`. A moment is a fact the server can state (state, beat, page, ask status), never a guess one screen makes from its own memory.

- Workie's page is a server fact (the `stage-beat` extension in `remote-parity/NOTES.md` §2), so READ page n of m means the same thing on every surface.
- **Test:** the drift test that already holds `STAGE_BEATS` equal across copies (`tests/feedback-round-beat.js`) is extended to `MOMENTS`; an unknown moment renders the round's last known step with a muted "Waiting for the session" status, never the lobby.

## R3. One next step per moment, in one place, with one orange

- Every moment has **exactly one primary**. It is the one amber element on the screen. On the host screen it is the dock's right-hand button; on the Remote it is the 64 px button in the thumb arc; on a participant's device it is the Send or Vote button.
- **At most one secondary**, and only where the moment has a real second way on (the last page of the read: Ask the room; a live ask: Cancel the question). It sits beside the primary on the host screen and directly above it on the Remote. It is never amber.
- The primary **does not change place** across moments, and its label changes only when its act changes.
- Nothing else on a host screen is amber: not a "showing" toggle, not a join code, not a phase dot. A pressed toggle is blue (`--secondary`) with `aria-pressed`.
- **Test:** `roundStep` returns one primary for every pair (as `hostControls.test.js` does today) and at most one secondary. A palette test reads `HostRemote.css`, `RemoteFocusPanel` and `RemoteScoreboardPanel` markup and fails if any class other than the primary and the sheet's commit button resolves to `var(--primary)`.

## R4. Same task, same control, same words, same behaviour

When a task can be done on two surfaces, it is done with **one shared component** or **one shared rule**, never two implementations.

| Task | The one way |
|---|---|
| Advance the round | `roundStep().primary`; Space and → on the host screen, the big button on the Remote |
| Turn Workie's page | The primary while pages remain; the server holds the page |
| Show one response to the room | One stepper: **Show response 1 of 9**, then **Next response / Back / Stop showing**. Same component on the host screen's spotlight and the Remote |
| Ask the room something after the read | One panel (`FollowUpPanel`), a drawer on the host screen and a sheet on the Remote |
| Act on a name (remove, unlock, let them take it, not now, lock again, bring back) | One verb table (`config/nameActions.js`), one request strip on both host surfaces |
| Confirm an early advance | One rule (`needsConfirmation`) and one pattern: the primary arms and says how many are still answering; a second press goes. No modal on one surface and tap-again on the other |
| Undo a soft act (remove, stop showing) | A notice with **Bring back** / **Undo**, never a confirm dialog |

- **Test:** the host screen and the Remote import the same component or config module for each row; `__tests__/sharedTasks.test.js` asserts the imports (a static read of the two files, as the CSS-contract tests do).

## R5. Move on by itself when nothing can be lost

A screen waits for a person only when the person is deciding something. When the next step is certain and loses nothing, the system takes it.

| Situation | Behaviour | Why it is safe |
|---|---|---|
| Workie's read arrives while the room is on What we heard | Show it at once, on every surface | It is the beat already chosen; nothing is skipped |
| A participant has sent their answer | Their device says what happens next, and moves when the room moves | They have nothing left to do |
| Everyone has voted | The primary turns green and reads **Show results**; with Auto on, it fires after the 4 s grace | Nothing is in flight; the host may still want to time the reveal (open question 2 in `CHANGES.md`) |
| Everyone has answered a follow-up ask | Same as voting | A one-minute poll; nothing is lost |
| The host presses Next round with an ask live | The ask closes with its tally first | Already in the follow-up spec |
| The round changes | Any spotlight, scoreboard and name strip that belonged to the old round closes | They refer to rows the room has left |

The host keeps the moments that shape the room: opening voting, revealing results, moving from the tally to the read, and leaving the read. Each is one tap, never two, when the room is complete.

- **Test:** `autoMode.test.js` gains the "safe without Auto" rows above as a separate export (`alwaysAuto`), and asserts that no row of it is a phase change the host owns (`START`, `FINISH`, `REVEAL`, `FIELD_NOTES`, `NEXT`).

## R6. Words come from one file

- Every label, status line and participant instruction for a round lives in `config/roundWords.js`, as `buildroom/words.js` does for the Build Room. Sentence case, plain words, no exclamation marks, no emoji. "Phone, laptop or tablet", never "phone" alone, when the copy speaks about the room's devices.
- One verb per act: **Start voting**, **Show results**, **What we heard**, **Next page**, **Ask the room**, **Next round** (or the set's own noun: *Next question*, *Next lesson*). The Remote and the host screen take the noun from the same place: the set's `roundNoun`, then the game type's.
- **Test:** a grep test fails on any of those strings appearing as a literal outside `roundWords.js` in `HostRemote.jsx`, `config/hostRemote.js`, `components/stage/*`, `GameHostPage.jsx` and `PlayerPage.jsx`.

## R7. Behind Session (the "More"): what is not on the round's path

The place is called **Session** on both host screens. The host screen already has it: the SESSION button at the right end of the dock (`components/stage/Dock.jsx:179`, key `\`), opening the Players, Questions, Rounds and Settings tabs. The Remote gets one **Session** button, top right, opening the same list in the same order as a sheet. A control belongs behind More when it is used fewer than once per round in a normal session, or when it changes the session rather than the round.

Behind Session: categories, join code and QR (the Stage already shows it in the lobby), the big-screen remote control, team switcher, back to menu, scoreboard look, skip this round, end session, the rounds list, the question list.

On the path (shown in the moment that needs it and nowhere else): the waiting list during answering and voting; the read's pages during What we heard; the response stepper during results; the name request strip whenever someone is asking; the question, folded, at the top of every moment.

- **Test:** `roundStep().more` lists these by id; the Remote's round view renders no button whose id is in `more` outside the Session sheet.

## R8. Participants are never left guessing

Every participant screen states, in one line, **what is happening now** and **what they do next**, including "nothing yet: the host is reading the results with the room". The line comes from `roundWords.js` for the moment.

- After sending an answer or a vote, the device says so and says what comes next ("Sent. Voting opens when the host is ready.").
- When the room is on What we heard or a follow-up ask, the device shows the matching card; the generic **Feedback** button is never the only thing on screen while the host is asking the room a specific question.
- **Test:** `__tests__/playerMomentLine.test.jsx` renders `PlayerPage` for every moment and asserts a non-empty "now" line and, where the participant can act, exactly one primary.

## R9. A request that names a person never reaches the Stage

Name requests, removals and the waiting list are host-only. The Stage shows counts.

## R10. A new feature folds into an existing moment before it adds a button

Before a feature adds a control, its design shows which moment it belongs to and which existing control it replaces or joins. `CHANGES.md` does this for the six pending features. A design that adds a button to the Remote's round view without removing or moving one must say why in its own notes.
