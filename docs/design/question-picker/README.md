# Choose a question: one door, one picker, one way back

Design only, 5 Nov 2026. This changes no application code. The mockup is `index.html`. `node docs/design/question-picker/shoot.js`
renders frames `1-*.png`, and checks for overflow, clipping and text under the 12px floor (all seven frames came back clean).
The desk reviews are in `reviews.md`. This was studied against `origin/working/parity-plan` at `e85257f13`, whose ancestor is
dev's `9149c060`.

**The owner, 5 Nov:** *"it seems like a lot of work on the sessions menu to get to pick questions. i had to dig through and then
to get back was confusing as well. is there a way to make this easier to navigate?"*

## 1. The path a host takes today

The job: during round 3, see what comes next, pick "Pricing we would change" from the set to ask next, and get back to running
the round. Counts are clicks and key presses; typing in a search box is not counted. Lines are in
`src/src/components/stage/SessionSetupPanel.jsx` unless another file is named.

### (a) Seeing what is next

| Surface | Steps | How |
|---|---|---|
| Two screens (console) | 0 | The rail's Round queue header says "3 of 8 · next: …" while closed (`config/consoleRail.js:119-150`). It is open by default only in LOBBY, ROOM_RESULTS and ENDED; during answering and voting People is open instead (`consoleRail.js:11-23`). |
| One screen (stage) | 3 | Session (1). Up next's running order is behind `PrivateReveal` (`:932-937`): Show on this screen (2), then Show it (3) (`components/needs/PrivateReveal.jsx:80-93`). |
| Phone Remote | 2 + a scroll | Scroll to the Session card, then Up next (`HostRemote.jsx:2196-2203`). |

### (b) Picking a specific question, and (c) getting back

| Route | Steps | Path |
|---|---|---|
| Console, from the rail | **9** | Open Round queue (1). **Rounds and questions** (2) opens the Session menu at **Rounds so far**, not Up next (`components/console/ConsoleRail.jsx:185-186`, `onOpenSection('history')`; the label is `config/consoleWords.js:21`). Click the Up next tab (3), then Choose from the set (4, `:974-977`). Open the Category select (5) and pick a category (6, `:805-812`). Ask next (7, `:875-885`). Esc goes back to Up next (8, `:467-470`), and a second Esc closes the menu (9, `:472-476`). |
| Console, from the top bar | **5** (6–7 with a filter) | Session menu (1, `ConsoleTop.jsx:147-158`). It opens on Up next (`config/setupPanel.js:130-140`). Choose from the set (2), Ask next (3), ‹ Up next (4, `:786-788`), ✕ (5, `:1407-1414`). |
| One screen | **7** | Session (1), Choose from the set (2), Show on this screen (3), Show it (4, `:789-793` via `PrivateReveal`), Ask next (5), Esc (6), Esc (7). The phone is never offered in this step. |
| Phone Remote | **5**, two of them scrolls | Scroll to the Session card (1), Up next (2), scroll past the running order, Write a question and Categories to the browser (3, `components/RemoteSessionPanel.jsx:424-500`), Ask next (4), ← (5, `HostRemote.jsx:1631-1640`). |

### Every place the way back is unclear

1. **The rail's link misnames where it goes.** "Rounds and questions" lands on Rounds so far, which has no questions. The help
   calls the same link "All rounds" (`config/help/host-two-screens.js:346`), so the words have already drifted apart.
2. **The browser is a step inside one tab of a sheet.** You can only find it if you know it lives in Up next. Clicking any
   other tab drops the step without saying so (`:1457`, `setChoosing(false)`).
3. **Esc means two things.** The first Esc goes back to Up next and the second closes the menu (`:467-476`). The visible way
   back is a 13px tertiary text button, "‹ Up next". Nothing in the step says it is a step.
4. **Closing loses context.** A click on the scrim closes the whole menu (`:1364`). The panel then unmounts, so the search,
   the category and the step itself are gone (`:423, :431, :441, :443` are local state). Reopening lands on Up next, not on the
   list the host was reading.
5. **Ask next gives no answer you can see.** The list stays open, and the only sign is a "Queued #1" tag on the row. The
   running order that changed is one level up, out of sight. On the phone, Ask next also leaves the list open
   (`HostRemote.jsx:1441`), while Ask now closes it (`:1379`), so the two actions behave differently.
6. **The Q key buries itself too.** Q opens the composer by opening the Session menu at Up next (`GameHostPage.jsx:5061-5071`).
   The help still says "opens at Rounds" (`host-two-screens.js:425`), which is stale since the 3 Nov sections.
7. **One screen has no private route.** The Choose step offers only "Show on this screen". The impromptu ask already asks
   first, with a phone option (`components/OwnQuestionChoice.jsx`), and the picker should do the same.
8. **The phone has no category filter.** Its search reads titles only (`config/hostRemote.js:441-445`). The laptop's filter
   can already match the question text (`config/setupPanel.js:373-386`, `matchDetail`), but nobody passes it.

## 2. The proposal

**One picker, named "Choose a question", on every surface. One key opens it, there is a door wherever the host is already
looking, and there is one way back.**

| # | Decision | Why |
|---|---|---|
| D1 | **One component, `QuestionPicker`, takes over the content area** and nothing else. The top bar, Your part now (with its main button and Space) and the rail stay where they are and stay live. The rail's queue updates as you queue. | Experience plan: one look, nothing moves. The host keeps the round in view while choosing. A modal over the whole page would cover the round being judged, and a sheet inside the menu is how it got buried. |
| D2 | **C opens it**, with Q's guards: never while typing, never with a modifier, never on a key repeat, never under a dialog (`useOwnQuestionKey.js:16-22`). C is free: the host keys are Space/→, ←, J, S, V, U, `\`, Q and F (`host-two-screens.js:419-426`, `RoomMeter.jsx:257`). | The one question hosts ask mid-round gets a key, as writing one (Q) already has. |
| D3 | **Three doors, all opening the same picker.** (1) The rail's Round queue: **Choose a question C** beside **Write a question Q**. (2) Your part now: one quiet line, **Change what's next C**, which does not repeat the title (the rail says it; hard rule 5). (3) Session menu › Up next: **Choose a question** opens the picker. The menu's inline copy (`:783-912`) is deleted. | One door per job, in the places the host already looks. The menu keeps a link, not a copy. |
| D4 | **Rail rows that are not yet played can be clicked.** A click opens the picker with that slot's question in the preview. The rail link is renamed **All rounds**, the help's word, because it opens Rounds so far. | "Swap this one" takes one click, and the link says where it goes. |
| D5 | **The picker's layout**: a crumb and ✓ Done in the header; filters on the left (search, Not asked / All, categories as checkboxes with counts); the list in the middle; a preview on the right. The list starts with **"The set would serve next"** (the next three the set would pick, from `upNext`), then every unasked question. Rows offer **Queue** and **Ask next**; a queued row shows "Queued #n" with **Unqueue**; **Ask now…** sits in ⋯ with its warning. Search matches titles and question text. | Everything needed to decide is on one screen: search, categories, preview. The "top N unasked" the owner floated lives here instead of in the rail (fork F3). |
| D6 | **One way back, always one press.** The crumb names where Back goes: "‹ Round 3 · Answer" when it was opened from the round, or "‹ Session menu" when it was opened from the menu. **Esc**, **✓ Done** and the crumb all return there, and **focus returns to the opener**. Inside the search box, Esc clears the text first, the standard search-field behaviour, and the footer says so. | The owner's "to get back was confusing". |
| D7 | **Ask next returns you to the round. Queue keeps the picker open.** On return, Your part now's status line reads "Next: Pricing we would change · Undo" (polite live region), and the rail row fades in once. After several Queues, Done says "3 queued · Undo". | The common intent is "this one next, then back to work". Queueing several is the case for staying. Undo makes either one safe. |
| D8 | **The picker keeps its state for the session.** Search, filters and scroll position live on the page, not in the component, so closing and reopening returns the same list. They are cleared when the session changes. | The context loss in §1.4. |
| D9 | **One screen asks first.** C or any door opens a small private choice in `OwnQuestionChoice`'s shape: **Choose on your phone** first (Connect your phone, until the laptop can tell that a Remote is connected; `GameHostPage.jsx:9504` passes `remoteConnected={false}` today), or **Show them here — the room will see the titles and the questions**. Shown here, an amber line reads "The room can see this list" with **Hide** and **Use my phone instead**. It is asked again each time it is opened (fork F5). Correct answers are never drawn on any surface (`browserRow`'s allow-list). | Experience plan principle 3, as impromptu-ask D8 applied it. |
| D10 | **The phone gets the same picker as a full sheet.** The round view has one line above the dock, "Next: … · Change", since the phone has no rail. Up next's tab keeps the running order plus **Choose a question** and **Write a question**, and the browser is no longer stacked under them. The sheet has ‹ Round (or ‹ Up next) in the sticky bar, search, and **Show** / **Category** selects. **Ask next returns to the round** with the flash and Undo, as Ask now already does. The dock stays live. | One picker to learn, the same way back. |

Proposed counts: **2 steps** (C or a door, then Ask next) on two screens and on the phone, and **3** on one screen (the
private choice). Seeing what is next on one screen goes through the phone line or the choice, never through a reveal.

## 3. Forks

| # | Fork | Options | Recommendation |
|---|---|---|---|
| F1 | Where the picker lives on two screens | (a) over the content area, with the rail and Your part now live; (b) a full-height Modal; (c) keep it inside the Session menu, but as its own tab | **(a).** (b) covers the round and the queue that confirms the pick. (c) is the dig the owner described. |
| F2 | What Ask next does | (a) closes and returns to the round, while Queue stays open; (b) both stay open until Done; (c) both close | **(a).** The phone's Ask now already returns (`HostRemote.jsx:1379`), and the two should agree. Undo covers the stray press. |
| F3 | Top N unasked in the rail's queue | (a) no new rows in the rail: the link, clickable planned rows, and "The set would serve next" at the top of the picker; (b) three suggestion rows with Ask next under the queue | **(a).** The rail was made quieter on 5 Nov (`9149c060`). Three extra rows with buttons would bring that noise back, and the planned rows already show what the set will serve. |
| F4 | Categories in the picker | (a) view-only filters, with switched-off categories listed and marked "off", and a link to Up next › Categories for the session switch; (b) the filters also switch categories for the session | **(a).** A filter that changes what the game serves is a hidden side effect. The switches stay where they are (Up next › More options). |
| F5 | One-screen choice: remember it? | (a) ask every time; (b) remember for the session like People (`PrivateReveal` `remember`) | **(a).** People shows who is present. This list shows content the room has not seen yet, and a remembered "show" would put it up unasked in the next round. "Use my phone instead" is always one press away. |
| F6 | The key | (a) C; (b) N for "next"; (c) none, doors only | **(a).** "Choose" matches the label. N reads like "next round", which Space already does. |
| F7 | Trivia and Poll | (a) the same picker, where trivia rows show difficulty and the preview shows the options but never the answer; (b) C&A only, as Q is | **(a).** Every set-based type has the browser today. Survey, Wavelength and the Build Room have none and get no C. |

## 4. Implementation notes

1. **The component.** Add `src/src/components/stage/QuestionPicker.jsx` and `QuestionPicker.css`, scoped `.qpk`, with
   `data-theme="dark"`. Move into it the Choose step's body (`SessionSetupPanel.jsx:783-912`), `browserRow` and
   `filterBrowserRows` from `config/setupPanel.js`. Pass `matchDetail: true`. Change `category` to a set, so several can be
   ticked, and keep `'__on'` as "categories that are on". Draw the "serve next" group from `upNext` filtered to
   `source === 'auto'`. Use the ladder (12/13/15/19), 48px rows and token colours only. Add a `questionPickerPalette.test.js`
   in the `questionSetsPalette.test.js` pattern.
2. **State on the page, not in the picker.** In `GameHostPage.jsx`, add
   `picker = { open, from: 'rail'|'part'|'menu'|'key'|'row', focusKey }`, plus `pickerView = { search, cats, show }`. Keep the
   opener with `document.activeElement` on open, as the menu does (`SessionSetupPanel.jsx:450-458`). On close, focus the
   opener if it still exists. When `from === 'menu'`, call `openSetupAt('up-next')` and focus `[data-testid="up-next-choose"]`.
   Opening from the menu closes the sheet first, so that two surfaces never stack.
3. **Where it renders.** On the console it goes in the content slot of `HostConsole`. The strip stays above it, and the
   rail, Your part now and the top bar keep rendering. On the stage (one screen) it goes over the Stage's content, under the
   title bar and above the Dock. It is not a `Modal` and does not trap focus. Add `.qpk` beside `.setup-panel` in
   `HostActionBar.jsx`'s key-landed guard (`:279, :308, :328`): Space on a focused picker control presses that control, and
   Space anywhere else still advances. `runHostAction` already calls `closeAllSidePanels()` (`GameHostPage.jsx:6963`). Have it
   close the picker as well, because a phase change makes the asked marks stale.
4. **The key.** Add `components/stage/useQuestionPickerKey.js`, a copy of `useOwnQuestionKey.js` with `c`/`C`, on
   `document`. Its `enabled` is Q's (`GameHostPage.jsx:7279-7287`) without the C&A-only term, and it is false for survey,
   Wavelength, Build Room and ENDED. Inside the picker, handle ↑/↓, Enter (Ask next on the selected row), `/` (focus the
   search) and Esc, all on the picker's root.
5. **Doors.** `ConsoleRail.jsx` gets an `onChoose` prop, which draws the link beside `rail-write` (`:198`) and makes planned
   rows buttons calling `onChoose({ focusKey })`. Change `CW.allRounds` to `'All rounds'` (`consoleWords.js:21`).
   `ConsoleFooter.jsx` and `Dock` get an `onChangeNext` prop that draws the quiet line, only while a next round exists and
   the session has not ended. In `SessionSetupPanel.jsx`, delete the `choosing` state and step (`:423, :783-912, :1371`
   wide class). `up-next-choose` calls `onChoose()`. Rename `MENU_WORDS.choose` to "Choose a question".
6. **Ask next and Undo.** Ask next calls `handleQueueFirst` (`GameHostPage.jsx:4950`), closes the picker, and sets
   `pickNotice = { title, undo }`. Undo replays the inverse op: `remove` if the row was not queued before, or `move` back to
   its old index if it was, against the current `queueVersion`. Queue calls `handleQueueQuestion` and stays open. Show the
   notice in Your part now's status slot with `role="status"`, and let it fade after about 8s (the Undo is also in the
   running order's ⋯ for as long as the row is queued).
7. **One screen.** Generalise `OwnQuestionChoice.jsx` into a `PrivateChoice` (a title, the two options and the phone
   handler), used by both Q and C. "Connect your phone" calls `openSetupAt('remote')`, as the one-screen bell does
   (`GameHostPage.jsx:9505`). The amber line's Hide closes the list back to the choice.
8. **Phone.** In `RemoteSessionPanel.jsx`'s Up next tab (`:424-500`), replace the inline `RemoteQuestionBrowser` with a
   **Choose a question** button. In `HostRemote.jsx`, add `panelTab === 'choose'`, which renders `RemoteQuestionBrowser` as
   the sheet. The sticky back (`:1631-1640`) gets a visible label: "Round" when opened from the round line, "Up next" when
   opened from the tab. `filterRemoteRows` (`hostRemote.js:441`) gains detail and category matching. Add the two selects.
   `onAskNext` sets `setPanelTab(null)` and a notice with Undo (`:1441`). Add the round view's next line from `plan.upNext[0]`.
9. **Help, notes, tests.** Update `config/help/host-two-screens.js:346` and `:419-426` (add C, and fix Q's "opens at
   Rounds"), `host-running.js:479`, and the phone guide. Run `node scripts/help-drift.js` and `helpContent.test.js`. Tests that
   drive `choose-step` / `choose-back` (`sessionSetupPanel.test.jsx`, `queueCallSite.test.jsx`, `sessionMenuInventory.test.jsx`)
   move to a `questionPicker.test.jsx`. Add contract tests that: every door opens the same component; Esc, Done and the crumb
   each close in one press and restore focus to the opener; reopening keeps the search; on one screen no row renders before
   a choice; no row or preview carries `correctAnswer`.
