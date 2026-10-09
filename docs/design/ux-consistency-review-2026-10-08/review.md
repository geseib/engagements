# Engage: consistency and ease review — 2026-10-08

The owner's complaint: *"there is not a consistency of interface, buttons and messaging move
around too much … making things super easy for the hosts and the participants."*

**How this was reviewed.** It is mostly a reading of the source in this worktree
(`src/src`, Build Room first, then games, surveys, the player shell and the shared
components), checked against `.claude/skills/engage-design/SKILL.md` and the mockups in
`docs/design/`. I opened a separate browser tab on dev. That tab was not signed in, and
I did not sign in, so the **host Build Room (room 4443) was not seen live**. Every host
finding below comes from code, with `file:line`. On the participant side I saw the
rejoin screen for 4443 live; I stopped there and did not rejoin, because rejoining is a
write. I did not measure any widths for this review. The width notes below come from
the stylesheet, so a separate pass at 1280, 660 and 375px is still needed (see Batch 6).

---

## The five biggest problems

1. **The host's main button has no fixed home.** Games put it in one bar at the foot of
   the screen (`components/HostActionBar.jsx`), always in the same place. The Build Room
   puts it inside whichever step is open. It sits on the left of the row for Collect and
   Settle, then jumps to the right for Send (`buildroom/BuildAskPath.jsx:175`, `:218` vs
   `BuildRoomPage.jsx:2386-2388`). It sits on the right of the Stage dock. Most of the
   time there are also **two orange buttons at once**: the step's own one, and the
   composer's "Send to Claude", which is always orange (`BuildRoomPage.jsx:2743`).
2. **One action goes by several names, and several actions share one name.** Sending
   the room's choice to Claude is "Go with B" then "Send to Claude" on the Host screen,
   "To Claude: B" on the Stage, and "Send to Claude" again in the Stage's "Edit" window.
   There are three different controls for "how Claude should take it": a split button
   with a menu, a row of four segments, and a separate on/off switch that is *also*
   labelled "Send to Claude". Holding something back has five names: Queue it, Park,
   For Claude later, Save for later, Later. The wheel has four: Spin, Spin instead,
   Spin the wheel, Spin the wheel instead.
3. **Messages push the page around, then vanish.** Up to seven different notice bars can
   stack above the Host screen's content: errors, load errors, ended, wrapped, the Wi-Fi
   offer, unsent direction, and the "Sent to Claude…" line, which clears itself after 6s
   (`BuildRoomPage.jsx:773-803, 838-845, 610`). Each one shoves the steps and the primary
   button down, and the timed one snaps them back up. Confirmations use three different
   patterns in one column. Games still raise browser `alert()` boxes for errors, and on
   a projector those land in front of the room (`GameHostPage.jsx` has about 20, e.g.
   `:3542, :3946, :4137, :4229`; `PlayerPage.jsx:2300, :2435`).
4. **Pictures leave the app.** Every screenshot that is not tied to a choice opens a new
   browser tab, because `BuildImage` defaults to `linked = true` and opens
   `target="_blank"` (`buildroom/BuildImage.jsx:16, 40`). That covers the Build screen
   whenever the newest picture is not a choice option (`BuildRoomPage.jsx:1592`),
   History pictures (`:1650`), artifacts (`:1679`), review thumbnails (`:1861, :1911`),
   the wrap-up (`:2414`), idle stage (`:2464, :2495`), Screenshots (`:2534`) and the
   timeline (`:2841`). The viewer that already exists (`MockupViewer.jsx`) is only used
   for choice options. **The live demo link is only on the Build screen and the
   wrapped-up stage** (`:1589`, `:2420`). The Host screen, where the host spends their
   time, has "Show the build" (which switches screens) but no link to the demo.
5. **The Build Room is a different product from games and surveys.** It has its own
   button set (`brm-btn` with six variants), its own dialog header (written twice:
   `BuildRoomPage.jsx:3201` and `BuildCrew.jsx:151`, plus hand-made headers in
   `BuildStageDecide.jsx:105`, `BuildOpening.jsx:199` and `BuildAskDetail.jsx:118`), its
   own error bar, and its own words. The Stage uses the stage `.btn` set
   (`BuildRoomPage.jsx:1545-1546`). Participants get two button styles on one page,
   `plr-btn` in the dock and `bpl-send` inline (`BuildPlayer.jsx:233, 760, 827, 1043`).
   The way out is "Main menu", "Back to the main menu" or "Back to Menu", depending on
   where you are.

---

## Principles to adopt (concrete enough to test)

### P1. The primary action lives in one place per surface
- **Host, laptop:** the step's one primary sits **at the right end of the step's action
  row**. That is the row's last element, preceded by secondaries, preceded by ghost and
  destructive buttons. This matches the Stage dock (`Dock.jsx`: secondary, then primary)
  and every dialog footer (Cancel left, primary right).
- **Exactly one `brm-btn--primary` visible on the Host screen at a time.** Every other
  button is secondary, even one that is orange elsewhere. The composer's Send stays
  secondary while an ask path step is open.
- **Participant:** the one thing to press is always in the `PlayerShell` dock. Never inline.
- **Space presses the visible primary everywhere, and it is always the same element.**
- Testable: count `data-next-primary` / `.brm-btn--primary` in rendered states. Read
  the CSS contract for row order.

### P2. Messages have three homes, by kind
| Kind | Where | Lifetime |
|---|---|---|
| Something failed / needs action (error, reconnect, sign in) | **one** status slot under the header, fixed height, reserved even when empty | until dismissed or fixed |
| Confirmation of what the host just did ("Sent to Claude as Do now: …") | **the same row as the button that did it**, replacing the hint text there | until the next action |
| Session state (ended, wrapped up) | the header itself, as a chip beside the title | while true |

No `alert()` and no `window.confirm()` on a host or participant screen. Use
`ConfirmDialog` / `StatusMessage`. Nothing appears above the primary button after it is
on screen.

### P3. Button vocabulary
| Act | Label (exact) | Style | Never |
|---|---|---|---|
| Close an ask and show what came in | **Show results** | primary | Close and show results, Show Results |
| Move from ideas to a vote | **Open voting** | primary | Open the vote |
| Accept the room's winner and give it to Claude | **Send B to Claude** (one button: picks and sends) | primary | Go with B, To Claude: B |
| Send typed words to Claude | **Send to Claude** | primary or secondary per P1, icon `PaperPlaneTilt` always | arrow icon, "To Claude" |
| Hold for later, not sent | **Save for later** (one list, named "Later") | secondary | Park, Queue it, For Claude later |
| Let chance pick | **Spin the wheel** | secondary | Spin, Spin instead, Spin the wheel instead |
| Run the ask again | **Ask again** | secondary | Re-ask…, Vote again, Reopen (keep Reopen only for "same ask, open again") |
| Remove for good | **Discard** / **Delete** | `ghostdanger` in rows, `dangersolid` only inside a confirm | Discard with no confirm in one place and a confirm in another |
| Leave the screen | **Main menu** (House icon) | ghost | Back to Menu, Back to the main menu |
| Close a dialog | X top-right + **Close** (or Cancel when work is unsaved) bottom-left | ghost | Keep it, Keep it running (for plain close) |
| Participant submits | **Send** / **Send my answer** / **Send my votes** | `plr-btn` in dock | Submit Answer, Pick A, Suggest |

**Casing:** sentence case everywhere ("Show results", "Join the session"). No Title Case.
**Icons:** an icon is used only where it is used for that verb everywhere.

### P4. Links and pictures stay in the app
A picture opens the in-app viewer. A link that must leave (the running build, an
external URL) has the `ArrowSquareOut` icon **and** says where it goes ("Open the build
in a new tab"). Nothing opens a tab silently.

### P5. One dialog shell
`Modal` + one shared `DialogHead` (title left, X right) + one footer row (exit left,
primary right). No dialog inside a dialog (SKILL.md §3). Every dialog closes on Esc,
gated on unsaved work. A click on the backdrop does the same thing in every dialog.

### P6. Device-neutral copy
Participants may be on a phone, laptop or tablet. Say "this device" / "your screen", never
"this phone" or "your phone".

---

## Findings

Severity: High = hurts a live session; Med = slows or confuses; Low = polish.
Effort: S < half a day, M ≈ 1–2 days, L = more.

| ID | Surface | Evidence | Problem | Why it hurts | Proposed fix | Sev | Eff |
|---|---|---|---|---|---|---|---|
| F1 | Build Room Host, ask path | `BuildAskPath.jsx:175-183, 218-221, 227` (primary first in row) vs `BuildRoomPage.jsx:2386-2388` (Send step primary pushed right) and `BuildAskPath.jsx:114` (Save wording right) | Primary moves from the left of the row to the right between steps of the same ask | The host's eye and mouse have to hunt on every step while the room waits | P1: primary always at the right end of the row; secondaries to its left | High | S |
| F2 | Build Room Host | `BuildRoomPage.jsx:2743` (`<SendToClaude … primary submit />` always) alongside the step primary (`BuildAskPath.jsx:175, 218`) and What's next lead (`BuildWhatsNext.jsx:77`) | Two orange buttons on screen at once | It is unclear which one moves the session on, and Space presses only one of them | Composer Send is secondary whenever an ask path or What's next lead is shown | High | S |
| F3 | Build Room Host vs Stage | Host: "Go with B" (`BuildAskPath.jsx:219`) then "Send to Claude" (`BuildRoomPage.jsx:2388`). Stage: "To Claude: B" (`buildScreens.js:251`), "To Claude: 3.4" (`:244`). Stage "Edit" opens a window titled "Send to Claude" (`BuildStageDecide.jsx:153`) | One act, three labels across two screens. "Edit" does not say it sends | The host learns two vocabularies. The room watching the Stage sees words that are not on the host's screen | One label: "Send B to Claude". Rename Stage "Edit" to "Change before sending" | High | S |
| F4 | Build Room, all screens | `BuildImage.jsx:16, 40` default `linked=true` → `target="_blank"`. Callers without `onOpen`: `BuildRoomPage.jsx:1592` (when not a choice), `1650, 1679, 1861, 1911, 2414, 2464, 2495, 2534, 2841`; `BuildCrew.jsx:422, 612` | Clicking a screenshot opens a new browser tab (the owner's report) | On a projector the host leaves the app, has to find and close the tab, and the room watches it happen | Make `linked` default `false`. Give every picture `onOpen` into a viewer (extend `MockupViewer` to take a plain image list, not just choice options) | High | M |
| F5 | Build Room Host screen | Demo link only in `BuildScreen` (`BuildRoomPage.jsx:1589`) and `WrappedStage` (`:2420`). Host "Now" card has "Show the build" (screen switch) and "Preview the work" (`:2626-2640`), no link | The live demo is hard to find from where the host works | The host has to switch to the Build screen, which is on the projector, just to open the demo | Put "Open the build" (with `ArrowSquareOut`, title shows the address) in the header beside Join, shown whenever `latestBuild(room).link` exists | High | S |
| F6 | Build Room Host, top of page | `BuildRoomPage.jsx:773-803` (error, load error, ended, wrapped bars), `:838` WifiOffer, `:840-844` unsent notice, `:845` sent line | Up to seven bars can appear above the content and push the ask path down | The primary button moves under the host's cursor. A timed message makes it move twice | P2: one reserved status slot. Ended and wrapped become header chips. The "sent" line moves to the action row | High | M |
| F7 | Build Room Host | `BuildRoomPage.jsx:610` (`setTimeout(() => setSent(''), 6000)`); Composer `said` stays until typing (`:2715, 2759`); Preview "Asked Claude to preview the work." never clears (`:2643`) | Three confirmation behaviours side by side | The host cannot tell whether a message is current | One rule: the confirmation sits by its button and stays until the next action | Med | S |
| F8 | Build Room, "hold for later" | Composer "Queue it" (`:2748`), Queue "Park" (`Queue` at `:2999, 3102`), kind "For Claude, later" (`buildScreens.js:438`), Stage window "Save for later" (`BuildStageDecide.jsx:202`) | Five words for similar holds, and it is unclear whether they are one list or several | The host cannot predict where a held item will turn up | Decide whether there is one list or two. Name them once ("Later" for Claude, "Parked" for ideas) and use only those words | Med | M |
| F9 | Build Room, "how Claude takes it" | Split button + menu (`BuildRoomPage.jsx:2659-2681`); 4-way segment + on/off switch also labelled "Send to Claude" + button "Send to Claude"/"Record decision" (`:2357-2389`); Stage window segment + "Save for later" + "Send to Claude" (`BuildStageDecide.jsx:189-203`) | Three different controls for one choice. A switch and a button share a label | The host has to relearn it in each place. The off switch silently turns the main button into "Record decision" | One control everywhere: the split button (default Do now, menu for the other kinds, plus "Record only") | Med | M |
| F10 | Build Room, Discard | Ask path Discard fires at once, no confirm (`BuildAskPath.jsx:124`). Stage window Discard asks first, in a modal inside a modal (`BuildStageDecide.jsx:199, 206-215`) | The same destructive act is confirmed in one place and not the other. The nested modal breaks SKILL.md §3 | A misclick on the Host screen throws away a live ask | Same confirm everywhere, shown inline as a second step (no nested modal). Offer the reversible neighbour (SKILL.md rule 12) | High | S |
| F11 | Build Room icons | Send icon `PaperPlaneTilt` (`:2672`) vs `ArrowRight` (`:2388`) vs none (`BuildStageDecide.jsx:203`); small Send drops its icon (`:2672`) | The same verb has a different icon in each place | Weakens recognition at a glance from the back of a room | P3: one icon per verb | Low | S |
| F12 | Build Room wheel | "Spin" / "Spin again" (`buildScreens.js:233`), "Spin the wheel instead" (`:254`), "Spin instead" (`BuildAskPath.jsx:180`), "Spin the wheel" (`:221, 227`) | Four labels for one act | Small, but this is the kind of drift the owner describes | "Spin the wheel" / "Spin again" only | Low | S |
| F13 | Build Room Composer | `BuildRoomPage.jsx:2730-2760`: a textarea plus 8 controls (Send split, Queue it, a select, a checkbox, Log it, Ideas, Choose, Rate) | The "Add something" panel reads like a toolbar. Three of the four destinations are buttons and one is a select | It is heavy to scan mid-session, and it competes with the step above it | Two rows: Send to Claude (split) + "More: Queue / Log / Ask the room". Move "Ask the room" kinds into the existing Ask the room dialog | Med | M |
| F14 | Build Room dialogs | Two `DialogHead` copies (`BuildRoomPage.jsx:3201`, `BuildCrew.jsx:151`). Hand-made headers in `BuildStageDecide.jsx:103-105`, `BuildOpening.jsx:199`. Ask detail X is a ghost button (`BuildAskDetail.jsx:118`). X labels vary ("Close" / "Close this window" / "Close the QR") | Each dialog's head looks and reads slightly differently | Inconsistency the owner names directly | One shared `DialogHead` + `DialogFoot` in `components/`, used by every Build Room dialog | Med | S |
| F15 | Build Room dialogs, exits | `QrZoom` has no X and no bottom exit, only "Click anywhere" (`BuildRoomPage.jsx:1751-1765`). `MockupViewer` has a Back button top-left, no X, no bottom exit (`MockupViewer.jsx:63-65, 91-95`). `closeOnBackdrop` is true for some, false for others, and busy-gated for a third set (`grep "<Modal" buildroom/*.jsx`) | Exits differ dialog to dialog | Breaks SKILL.md rule 2 (X and bottom exit). The host does not know whether clicking outside will lose work | P5. Add an X to QrZoom and the viewer. One backdrop rule: closes unless dirty or busy | Med | S |
| F16 | Build Room header | "Main menu" sits inside the More menu (`:1298-1301`), and is also a button in the wrapped bar (`:803`) and "Back to the main menu" in the ended bar (`:793`). Games say "Back to Menu" (`config/hostControls.js:566, 865`; `HostRemote.jsx:1632`) | The way out is named and placed differently on every screen | The host has to hunt for the exit | P3 "Main menu", always at the same spot in the header (left of the title, House icon) | Med | S |
| F17 | Build Room, two button systems | Host `brm-btn` (`BuildRoom.css:100-124`); Stage dock `.btn` / `.btn ghost` (`BuildRoomPage.jsx:1545-1546`); participant `plr-btn` + `bpl-send` + `bpl-send--alt` (`BuildPlayer.jsx:233, 760-769, 827, 1043, 1053`) | One feature uses four button classes | Buttons look and size differently between the Build Room's own screens | Participant: every action button is `plr-btn` / `plr-btn--ghost`. Host: map `brm-btn` variants onto the shared tokens in one place | Med | M |
| F18 | Participant, Build Room Now | `BuildPlayer.jsx:1102`: order is tabs, intro, **Open the build**, question, extras | When Wi-Fi sharing is on, the "Open the build" block sits **above the question** and pushes it down | On a phone the question may drop below the fold right when the room is waiting on this person | When an ask is open, the question comes first. "Open the build" moves under it | High | S |
| F19 | Participant, Build Room watch screen | `BuildPlayer.jsx:1139` hard-codes "Claude is building", while the host uses `claudeState()` (`buildScreens.js:139-174`) with paused / waiting states | Participants are told Claude is building when it may be paused or not connected | It reports a status that may be false. The participant sees no progress and decides nothing is happening | Use `claudeState(room, now)` (it already has the non-host wording) | Med | S |
| F20 | Participant, answer confirmation | Build Room: confirmation is only the disabled button's label ("Picked A", "Votes in": `BuildPlayer.jsx:330-332, 452`). Games: a rest screen "Your answer is counted…" (`PlayerPage.jsx:3755-3762`). Survey: "Your answers are in" (`components/survey/SurveyRunner.jsx:429`) | Three patterns for "your input landed" | People switching between session types do not get the same reassurance. A greyed button is easy to read as "broken" | One pattern: a status line in the dock above the button ("Your pick is in: A. You can change it until the host closes it.") | Med | S |
| F21 | Participant vocabulary | Games "Submit Answer", "Submit Votes", "Join Game" (`PlayerPage.jsx:2892, 2950, 3573, 3654, 3701, 3968`); survey "Send my answers" (`SurveyRunner.jsx:483`); Build "Pick A", "Suggest", "Submit 2 votes" (`BuildPlayer.jsx:234, 332, 453`) | Title Case in games and sentence case elsewhere. Three verbs for one act | Small but visible across a mixed event (agenda) | P3 participant row | Low | S |
| F22 | Participant copy, device | Seen live on dev, laptop-width tab: "This phone joined session 4443 as Wi-Fi tester" (`PlayerPage.jsx:2865`). Also `:3136`, `:4326`. Wall fallback "Answer on your phone" (`components/stage/SurveyCollecting.jsx:29`). Host empty queue "Phones can send an idea…" (`BuildRoomPage.jsx:3014`) | Phone-only wording, which goes against the owner's rule | Laptop and tablet participants are told the wrong thing | P6 sweep: "this device", "your phone, laptop or tablet" | Low | S |
| F23 | Games host and player errors | `alert()` in `GameHostPage.jsx:1808, 3542, 3737, 3756, 3763, 3824, 3847, 3882, 3894, 3946, 3994, 4137, 4229, 4810, 4971`; `window.confirm` sign-out `:724`; `PlayerPage.jsx:2300, 2383, 2396, 2407, 2435, 2459`. Build Room dirty-close uses `window.confirm` (`BuildRoomPage.jsx:3435, 3624`; `BuildCrew.jsx:243, 723, 745`) | Browser system dialogs | On a projector they cover the stage with grey browser chrome. On phones they block the page and read as a crash | P2: `StatusMessage` in the action bar / dock; `ConfirmDialog` for the dirty-close question | High | M |
| F24 | Games host labels | `config/hostControls.js`: "Start Voting", "Show Results", "What We Heard", "Back to Menu", "Next Page", "Open Session Report" (Title Case) next to "Open the survey", "Close the survey", "End the session", "See the results" (sentence case) | Mixed casing in one config file, shown in one bar | Visible every round | Sentence case throughout. Align "Show Results" with the Build Room's term (P3) | Low | S |
| F25 | Cross-app, host primary placement | Games: one fixed `HostActionBar` at the foot of the screen with labels from config (`components/HostActionBar.jsx:5-24`). Build Room: primary inside a scrolling column (`BuildRoom.css:695-707`, `.brm-hostcol` overflow) | Two different mental models for "where do I press next" | A host who runs a trivia round and then a Build Room has to relearn the most important control | Longer term: a Build Room action bar fed by `askPathStep` / `whatsNextMoves`, as games are fed by `hostControls.js`. Short term: P1 | High | L |
| F26 | Build Room Host, columns at laptop width | `BuildRoom.css:638-641, 655-661, 695-707`: three columns ≥1201px, each scrolls itself; two columns 901–1200px; one below 900px | At 1200px and below the page scrolls again, and the ask path and composer can be below the fold. **Not measured live** (no host sign-in in my tab) | Many projectors run at 1280×720 or 1024×768 | Measure at 1280×720, 1024×768 and 660 (per the dialogs-on-screen rule). Keep the current step's action row on screen | Med | M |
| F27 | Build Room Host, step folding | `BuildAskPath.jsx:86-93, 280-294`: done steps fold to one line; the open step's body is the vote board plus actions | Good: one open step, one primary, focus follows (`useNextFocus.js`). Noted as **a pattern to keep**. The board above the buttons still varies in height by ask, so the button's vertical position changes | The button lands at a different height on each ask | Pin the action row to the bottom of the step body (sticky within the column) | Med | S |

---

## What is already right, and should be copied

- **`HostActionBar` + `config/hostControls.js`**: one place, labels from config, a key
  hint line. This is the model for F25.
- **The Build Room ask path's rule**: one open step, one `data-next-primary`, focus
  follows, Space presses it (`BuildAskPath.jsx`, `useNextFocus.js`). Keep the rule; fix
  where the button sits.
- **`PlayerShell` dock** for participants: one bottom slot for the one act.
- **`MockupViewer`**: Esc is Back, arrows flip, Back is named for where you came from.
  Extend it to every picture (F4).

---

## Order of work: small batches, each shippable on its own

1. **Stop leaving the app** (F4 part 1, F5). Set `BuildImage` `linked` to default false.
   Route the Build screen's newest shot and the History/Screenshots pictures into the
   viewer (an image-list mode). Add "Open the build" to the header. *S–M, highest
   visible win for the owner's own complaint.*
2. **One primary, one place** (F1, F2, F27, F11). Reorder action rows so the primary is
   last. Demote the composer Send while a step is open. Pin the step's action row. One
   Send icon. Add a CSS-contract test that counts primaries per state. *S.*
3. **One vocabulary for Build Room** (F3, F12, F8, F16, and the P3 table as a constants
   file `buildroom/words.js`). Rename only; no behaviour change. *S–M, apart from the
   F8 decision (one list or two), which needs the owner first.*
4. **Messages stop moving the page** (F6, F7, F19). Add the reserved status slot,
   header chips for ended/wrapped, confirmations by the button, and `claudeState` on
   the participant screen. *M.*
5. **One dialog shell** (F14, F15, F10). Shared `DialogHead` / `DialogFoot`, X and bottom
   exit everywhere, the same backdrop rule, Discard confirmed the same way with no
   nested modal. *S–M.*
6. **Participant consistency** (F18, F20, F21, F22, F17-participant). Question first;
   one "your answer is in" line in the dock; sentence-case verbs; device-neutral copy;
   `plr-btn` only. Measure at 375, 660 and 1280. *S–M.*
7. **No browser dialogs** (F23, F24). Replace `alert()` / `window.confirm` on host
   and player pages with `StatusMessage` / `ConfirmDialog`. Use sentence case in
   `hostControls.js`. *M, mechanical.*
8. **One host action bar for every session type** (F25, F13, F9). Feed a Build Room
   action bar from `askPathStep` / `whatsNextMoves`, merge the three "how Claude takes
   it" controls into the split button, and slim the composer. *L. Needs a mockup in
   `docs/design/` and the owner's look first.*

## Open questions for the owner
- F8: is "Parked" (room ideas not used now) the same list as "For Claude, later"
  (directions held back)? The code keeps them apart. The words should either merge or
  say clearly that they are two lists.
- F3: should accepting the room's winner send to Claude in **one** press (Stage today),
  or always show the direction box first (Host today)? The label follows that decision.
