# Build Room: the bigger changes, tested for simplicity

Design only. Nothing in `src/` or `lambda-functions/` changes in this pass. The owner
chooses from this before anything is built. The mockup is `mockup.html` in this folder.

Owner, 25 Oct 2026: *"Let's start on the bigger changes really thinking through if the
change simplifies and improves the experience."*

Input: the host UX review of 25 Oct (items 10–20 and 22 of its §6; items 1–9 and 21
shipped in dev `172baad9`, see the top entry of `RELEASE_NOTES.md`). The owner rules this
plan must not break are listed in §4.

---

## 1. What the page does today, measured

Counted on `172baad9` (after the quick wins). Method: the real `BuildRoomPage` rendered in
jsdom, with each state built by the real server's pure half (`build-store.js`
`roomFromRows` + `hostView`), the same way `__tests__/buildCapabilities.test.jsx` builds
its fixtures. A control is a button, input, select, textarea, link, summary, tab or switch
that is not inside a closed fold. The scratch test was not kept.

| State | One screen | Console (two screens) | Words on screen | Orange |
|---|---|---|---|---|
| **First view**: new room, Claude not connected | **59** | 57 | 412 | 1 (Connect) |
| New room, Claude connected | 58 | 56 | 367 | 1 |
| Opening, step 2 | 56 | 54 | 323 | 1 |
| Building, between asks, 3 phone ideas waiting | **76** | 75 | 307 | 1 |
| Building, an ask live | 46 | 44 | 245 | 1 |
| Building, an ask at results | 52 | 57 | 289–344 | 1 (one screen) |

The quick wins fixed the three orange buttons; they did not change the count. The review's
59 on the first view still holds, control for control.

**Where the 59 come from (one screen, first view):**

| Group | Controls | Needed on the first view? |
|---|---|---|
| Header: Main menu, four screens, Room's window ↗, its status, Open as a tab, Open the build, Join, 4 joined, Help, SESSION | 13 | Mostly. "Open the build" has nothing to open yet (F17) |
| How a Build Room works (Connect) + Where will the room watch? (Open the room's window, Use two screens, Use one screen, Help me pick) | 5, in two panels | Yes, but as one thing, not two |
| The opening card: the question, Ask the room to pick, Spin, Pick for the room, Edit the list, Skip, Show the brief on the wall, Start building | 8 | Yes |
| The composer: the box, Don't show the room, Send to Claude, Send to Claude as, Save for later, Log it as, Also tell Claude, Log it, Ideas, Choose, Rate | 11 | No. Nothing has happened to log or tell |
| Waiting for you: All, Claude 0, Room 0, You 0, Later 0, Points 0 | 6 | No. All six are empty |
| The opening fold and its nine brief lines | 10 | Partly. It repeats the opening card |
| Decided 0, Timeline 0, Asks 0, Screenshots 0, Room brief 0, History 0 | 6 | No. All six are empty |

So **29 of the 59 are empty lists or tools for things that have not happened.** That is the
simplification available without a mode, a palette or a preset.

**Between asks with three ideas, 76:** each idea carries 8 controls (tick, Consider, Send to
Claude, Send to Claude as, Ask the room, Save for later, Acknowledge, Dismiss, Reply), so
three ideas are 27 of the 76.

**The opening's nine steps and what each gives Claude** (`build-store.js:111`). Each decided
step lands on one line of the brief, which Claude reads on `room_status` and receives in
full, as Do now, at Start building (`build-room.js:1380`).

| # | Step | Brief line | What else depends on it |
|---|---|---|---|
| 1 | What are we making? (Choose, 6 kinds, wheel) | Making | **The kind of build**: steps 2–7 switch to a game's, a training site's, a document's or a dashboard's own words (`OPENING_BY_KIND`), and the ready questions follow the kind |
| 2 | Who is it for? | For | Claude's draft of the brief needs 2, 3 and 4 (`readyForDraft`) |
| 3 | What problem do they have today? | The problem | as 2 |
| 4 | It is launch day. Write the headline. | Good looks like | as 2 |
| 5 | How will we know it worked? | We will know | — |
| 6 | What must it never do? | Never (each a Keep in mind rule) | — |
| 7 | What is the smallest version we could show today? | First build | What Claude builds first |
| 8 | Tools, frameworks, libraries, styles (host answers by default) | Tools and style | — |
| 9 | How should it look and feel? | Look and feel | — |

**Capabilities:** 21 ids in `capabilities.js`, held by `buildCapabilities.test.jsx` on both
the one-screen page and the console, in three moments. Any plan here must keep all 21
reachable on both.

**Decisions before Claude's first direction (Start building),** on the path the review
walked (create, connect, step 1 as Choose with a tie, step 2 as Ideas, step 3 answered by
the host, start): create 5, first view 2 (which screen, connect or open first), step 1: 4,
step 2: 4, step 3: 1, start and confirm 2. **About 18.**

---

## 2. The test, item by item

Each item is asked five things: does it remove what a first-time host meets, or only move
it (counted where possible); does it add a concept; does an expert lose anything; what does
it cost to build and keep consistent; and could something smaller get most of it.

### 10. A setup checklist that gates the opening, with "Practise without Claude"

- **Removes:** the two first-view panels become one card with three rows (Connect Claude
  Code, the join code, the room's screen). 5 controls in two panels become 3–4 in one.
  The ranking question the review found ("Connect first or open the opening?") goes away
  because the card answers it.
- **The gate does not pay for itself.** Since `172baad9` a send without Claude says
  **Queued for Claude** everywhere and is delivered when Claude calls in; the brief is
  read on `room_status`. Nothing is lost by framing first. A gate adds a state (gated,
  practising, live) to every screen and test, and blocks a real case: the host frames the
  build with the room while a colleague gets Claude Code running. "Practise without
  Claude" would then be a second button for what an ungated room already does.
- **Expert:** loses nothing, and does not have to click through a gate every session.
- **Cost:** S–M. The card replaces `HowItWorks` and `RoomScreenChooser` on the Host
  screen; it reuses the Connect dialog, `toggleCodes` and `chooseRoom`.
- **Verdict: BUILD SMALLER.** One **"Before the room starts"** card, no gate. Its rows
  turn green as they happen (owner, 23 Oct: "turn step 3 green and indicate hey, you are
  done and connected"). One screen is the default without asking; **Use two screens** is a
  visible row, never buried (owner, 19 Oct: "a very difficult experience finding the 2
  screen capability"). Connect is the card's orange until Claude connects. The card folds
  to one line, "Claude connected · 4 joined · One screen", once Claude has connected.
  "Practise without Claude" is not built: the card says "You can start the opening now.
  Anything you send waits for Claude."

### 11. Simple / Full mode

- **Removes:** about what item 18 removes, by a different route.
- **Adds a concept:** a mode the host must know they are in, plus "Switch to Full?"
  prompts. Help, the review's screenshots and the owner's own reports would all need to
  say which mode they were in.
- **Expert:** keeps everything in Full, but a host who helps a newcomer sees a different
  page from the one they know.
- **Cost:** the largest here, forever. The Host screen and the console are already two
  layouts. Two modes make four, and the capabilities test (owner, 17 Oct: "we dont lose
  capabilities in the build room") would have to walk each one. The owner's own rule
  (12 Oct): *"having to do the same task differently ... makes for low adoption rate."*
  A mode is exactly the same task done differently.
- **Smaller change:** show a panel when it has something in it (item 18). That needs no
  switch and applies to both layouts at once, because the console reuses the same panels.
- **Verdict: MERGE INTO 18.** No mode switch.

### 12. A three-step default opening

- **Removes:** six steps from the default path, and the "when do I stop?" decision the
  review found.
- **Three is too few.** Making, For and First build drop The problem and Good looks like,
  which are the working-backwards core the owner asked for by name (6 Oct: "who is this
  for. what problems exist, what would good look like"). They are also what Claude's draft
  of the brief waits for (`readyForDraft` needs For, The problem and Good looks like), so
  three steps would switch the draft off.
- **Expert:** nothing lost if the other steps are one click away and still fill the brief.
- **Cost:** S–M. Mark five steps as the core in `OPENING_STEPS`; the panel counts "step 2
  of 5" and, after the fifth, says the core is framed. The other four sit under **4 more
  questions** on the same card. Step 1's kind still reshapes the rest.
- **Keep the confirm.** The review proposes dropping the Start building confirm once the
  steps are done. The owner asked for it (6 Oct, after a stray click ended an opening). It
  costs one press and stays.
- **Verdict: BUILD SMALLER.** A five-step core: **Making → For → The problem → Good looks
  like → First build.** We will know, Never, Tools and style and Look and feel are one
  click away and still fill the brief.

### 13. One loop model everywhere

- **Removes:** four models. Today they are How a Build Room works (Connect › Kick off ›
  Claude asks › Wrap up), the console strip (Opening › Ask, Collect, Settle, Send to
  Claude › Wrap up), the ask path (1 Ask, 2 The room is choosing, 3 Settle, 4 Change before
  sending) and the public page (Ask → Decide → Build → Test → Remember).
- **Adds:** nothing. It is words.
- **Cost:** S. One constant in `words.js` read by the strip (`buildConsole.js`), the ask
  path's step heads, the setup card and the help. The public page describes the whole
  method rather than one ask, so it keeps its own words and gets one line that maps them.
- **Verdict: BUILD SMALLER**, as a copy pass inside phase 1. The words: **Ask · Collect ·
  Settle · Send to Claude** for one ask; **Opening › asks › Wrap up** for the session. Step
  4 of the ask path keeps "Change before sending" as its button, not as its name.

### 14. The Ask the room dialog

- **Yes/No:** the library lists Yes/No questions, but the form has no Yes/No tab, so a
  Yes/No quietly becomes a two-option Choose. The owner asked for the kind to be stored
  (24 Oct: "some are yes no. we need to store that info"). A fourth tab removes that
  surprise rather than adding a concept.
- **"Claude gets it as" and the private note:** the host is asked this twice, once here
  and again at Send (step 4 of the ask path shows the kind beside every send; owner,
  23 Oct). The first time is the redundant one. Moving it under **More options**, with the
  question's own value or Do now as the default, removes a decision without removing the
  choice. This does not undo the owner's approval of the four kinds (5 Oct): they are all
  still offered, at the moment they matter.
- **"Recommended questions for the moment":** needs a ranking rule that does not exist
  yet. The library already narrows by the kind of build, and Asked already marks what was
  used. Not worth building now.
- **Count (a Choose ask):** the form has 17 controls today and would have 12 (kind 4,
  question, context, options 2×2 with add, More options, Cancel, Ask the room).
- **Verdict: BUILD SMALLER.** A Yes/No tab with wider tabs; "Claude gets it as", the note
  and Save as a draft under one More options. No recommendations.

### 15. A prefilled wrap-up, and end-of-session moves

- **Removes:** four blank fields, the `label | https://…` syntax, and the console's "No
  main move now" after the wrap-up is saved.
- **The cheapest prefill is Claude.** The `wrap-up` prompt card already tells Claude to
  write the outcome with `wrap_up`, but it is reached only through the Connect window. The
  smaller change is a button, **Ask Claude to wrap up**, which posts that prompt as Do now
  (as "Ask Claude to draft the brief" already does in the opening). Without Claude
  connected, **Write it myself** opens the dialog prefilled from the session: the brief's
  headline as the summary, the decided asks as What we built (`combineText`), and the
  newest showing link as a link.
- **Moves:** What's next gains **Wrap up** as its last move once something has been sent.
  Once a wrap-up exists it leads **Check the report**, then **End session**, on both
  layouts. One screen already has these in a bar; the console does not.
- **Links:** one row per link with two boxes, label and address, instead of the pipe.
- **Verdict: BUILD**, at that size.

### 16. The report: the brief, no internal prompt text, wheel and held-back marks

- Held-back marks shipped in `172baad9`. What is left is three fixes, not features: a
  **Build brief** section, the Start building line printed as "Start building: Claude got
  the brief" rather than the raw prompt, and **Settled by the wheel** under a decision
  whose method was the wheel.
- No new concept; the report is what the room keeps.
- **Verdict: BUILD.** Cost S.

### 17. A command palette

- **Adds:** a new concept, a new key, and a second place where every capability lives. The
  Session panel and the keys (Space, 1–4, P, `\`, J) already reach everything.
- **Who it is for:** experts. The Build Room has very few of those yet, and the owner has
  not asked for one. The owner's rule (R10, 12 Oct): *"A new feature folds into an existing
  moment before it adds a button."*
- **Smaller:** the owner disliked a Space hint that looks like a button (25 Oct). A **?**
  list of the keys, from the existing Help, answers both that and "what can I press".
- **Verdict: DROP.** Revisit after item 18 has shipped and hosts say what they cannot find.

### 18. Reveal by event (absorbs 11)

- **Removes,** with nothing moved behind a switch:
  - empty folds (Decided, Timeline, Asks, Screenshots, Room brief, History) are not drawn
    until they have something in them (`HistoryStack` already skips an empty Decided);
    *28 Oct 2026, owner: "go on the right column, and fold Decided": the folds are now three
    sections, Claude now, The brief and History (chips All, Decided, Asks, Screenshots,
    Claude), and Decided no longer opens by itself (it did under host-flow H1);*
  - empty queue filters are not drawn, and with one source there are no filters at all;
  - Later appears with its first item, and Points when Claude posts one;
  - the composer is one line, **Tell Claude…** with **Ask the room** beside it, and opens
    when clicked;
  - "Open the build" waits for a build link (F17);
  - an idea row shows **Send to Claude**, **Ask the room** and **More** (Save for later,
    Acknowledge, Dismiss, Reply, Send to Claude as). Its words open Consider. This keeps
    the owner's four routes on every item (5 Oct), with three on the row instead of eight.
- **Count:** the first view goes from 59 to about 33 (with item 10's card and the
  one-line composer). Between asks with three ideas, from
  76 to about 37.
- **Nothing moves.** The three columns keep their place; an empty column shows one quiet
  line ("Waiting for you: nothing yet"), so nothing jumps when a list fills. The owner's
  complaint (12 Oct) was "moving menus and buttons", and showing by state must not become
  that.
- **Adds:** no concept. Things appear when they are true.
- **Expert:** loses no capability. Two need a door that does not depend on content:
  **Ask Claude for points** (today a button inside an empty Points tab) moves to What's
  next and the composer's More; **Later** stays a way to save (Save for later), so the
  list appearing with its first item loses nothing. The capabilities test already walks
  fixtures with every list filled, and gains one empty-room walk asserting these two doors.
- **Cost:** M, and once. The rules live in the shared panels, so the console gets them
  without a second layout.
- **Verdict: BUILD.** This is the biggest win in the review.

### 19. Presets (Workshop, Hackathon, Exec demo, Just build)

- **Adds:** a concept and four names to explain, for a create page that already has four
  choices with good defaults. Each preset would be a bundle of settings the host must
  later find and change one by one anyway.
- The owner shelved the same idea for events (agenda RATIONALE decision 10: "templates —
  shelf that one for now").
- **Verdict: DROP.** Sensible defaults already do this.

### 20. No host header on the projected one-screen Build and History

- The header was designed to be the same on all four screens (owner, 5 Oct;
  `build-room-host-redesign/RATIONALE.md` §3), and to be room-safe: on Build and History
  it names nobody, and what waits shows only as a count (§5). The one leak the review
  found, the wheel naming the spinner, shipped as a fix in `172baad9`.
- Removing it on one screen leaves the host with no way back except a key.
- The real fix for a room that should not see host chrome is two screens, which exists
  (owner, 19 Oct) and which item 10's card now offers on the first view.
- **Verdict: DROP.** Item 18's "Open the build" rule also trims the header.

### 22. A practice room with a fake Claude

- **The risk is the review's own S1.** F1 was "Claude appears to be working when it isn't
  connected". A fake Claude posting plans, updates and screenshots teaches a host the
  opposite of what the real room does, and every screen would need a "this is pretend"
  state so the room is not misled.
- The owner's precedent for events: a rehearsal that is "simple", with "no practice
  answers" (agenda RATIONALE decision 9).
- **Cost:** L. A scripted agent exists only as a developer demo
  (`scripts/build-room-demo/mcp-client.js`).
- **What a host needs is covered by 10:** the room runs end to end without Claude (opening,
  asks, wheel, sends marked Queued for Claude), so a host can rehearse with two phones.
- **Verdict: DROP**, and merge the intent into 10's line "You can start the opening now."

---

## 3. Verdicts at a glance

| # | Item | Verdict | Why, in one line |
|---|---|---|---|
| 10 | Setup checklist gating the opening | **Build smaller** | One card, three rows, no gate: Queued for Claude already makes framing first safe |
| 11 | Simple / Full mode | **Merge into 18** | A mode is "the same task done differently" and doubles every layout to test |
| 12 | Three-step opening | **Build smaller** | Five core steps; three drop The problem and Good looks like, and Claude's draft with them |
| 13 | One loop model | **Build smaller** | A words pass, one constant, inside phase 1 |
| 14 | Ask the room dialog | **Build smaller** | A Yes/No tab; "Claude gets it as" under More, because Send asks again |
| 15 | Prefilled wrap-up, end moves | **Build** | Ask Claude to wrap up, a prefilled fallback, Report and End lead on both layouts |
| 16 | Report fixes | **Build** | Three small fixes to what the room keeps |
| 17 | Command palette | **Drop** | A new concept for experts who are not here yet; a ? key list covers it |
| 18 | Reveal by event | **Build** | Removes 29 of 59 first-view controls with no new concept |
| 19 | Presets | **Drop** | Defaults already do it; the owner shelved templates |
| 20 | No header on projected Build/History | **Drop** | Header is room-safe by design; two screens is the real fix |
| 22 | Practice room, fake Claude | **Drop** | Fake activity repeats F1; an ungated room is the rehearsal |

---

## 4. Owner rules this plan keeps

| Rule | Where it came from | How the plan keeps it |
|---|---|---|
| The host decides; nothing opens or sends by itself | 5 Oct (mockups never auto-open), 7 Oct (who decides) | No auto-start after the opening; Ask Claude to wrap up is a press |
| Review Claude's questions is on by default | 4 Oct | Untouched |
| No names on projected screens unless List names | help, `build-room.js:559`; review F10 | Untouched; item 20 dropped because the header is already room-safe |
| One orange button | 11 Oct; PRINCIPLES R3 | The setup card's Connect while Claude is away, then the opening's lead, then the ask's |
| Space presses the lead move | 7 Oct | Unchanged, and the ? key list says so instead of a button-like hint (25 Oct) |
| Two screens exist for Call & Answer and Build Room | 19 Oct | Offered as a visible row on the first view |
| The Start building confirm | 6 Oct | Kept |
| Four kinds of message to Claude | 5 Oct; options beside every send, 23 Oct | All four kept; asked once, at Send |
| Every item has the same routes | 5 Oct (RATIONALE §3) | The idea row keeps Send to Claude and Ask the room, with the rest under More |
| Nothing Build Room does is lost | 17 Oct; `capabilities.js` | All 21 ids reachable on both layouts; one new empty-room walk |
| A feature folds into a moment before it adds a button | 12 Oct, R10 | Drops 17 and 19; 15 adds no button that does not replace one |

---

## 5. Recommended set and order

Each phase ships on its own, on both layouts, with the frontend suite,
`buildCapabilities.test.jsx`, `tests/build-room-copy.js` and `npm run build` green. Targets
are measured the way §1 measured them: the same jsdom count, the same fixtures, kept this
time as `__tests__/buildRoomCounts.test.jsx` so the targets cannot drift.

### Phase 1: the first view (10 smaller, 13, and 18's first half)

- The **Before the room starts** card, replacing How a Build Room works and the screen
  chooser.
- Empty folds and empty queue filters are not drawn; "Open the build" waits for a link.
- The composer is one line, **Tell Claude…** with **Ask the room**, and opens when clicked
  (its nine other controls are 9 of the 23 this phase removes).
- The one loop vocabulary across the strip, the ask path, the card and the help.

| Target | Today | After |
|---|---|---|
| Controls on the first view (one screen) | 59 | **≤ 36** |
| Controls on the first view (console) | 57 | **≤ 36** |
| Words on the first view | 412 | **≤ 250** |
| Panels before the opening card | 2 | **1** |
| Choices on the first view before the opening (which screen; connect or open first) | 2 | **0**: one ranked lead, one screen by default |
| Loop models a host meets | 4 | **1** (plus the public page, mapped) |

### Phase 2: the opening and between asks (12 smaller, 18's second half)

- The five-step core, with "4 more questions" on the card and in the brief.
- The idea row with three routes; Later and Points appear when
  used; Ask Claude for points moves to What's next and the composer's More.

| Target | Today | After |
|---|---|---|
| Controls on the first view | ≤ 36 after phase 1 | **≤ 33** (the brief path shows 5 lines and "4 more") |
| Controls between asks, three ideas | 76 | **≤ 40** |
| Controls per idea | 8 (+ tick) | **3** (+ tick) |
| Opening steps on the default path | 9 | **5** |
| Decisions before Start building (the review's path) | about 18 | **≤ 16** (phase 1 takes the two first-view choices; the create page's five are untouched) |
| Presses from a connected first view to the first opening ask live | 1, not orange while Claude is away | **1**, the orange one |

### Phase 3: asking and finishing (14 smaller, 15, 16)

- The Ask the room dialog: Yes/No, wider tabs, More options.
- Ask Claude to wrap up; Write it myself prefilled; Wrap up, Check the report and End
  session as What's next moves on both layouts; links as two boxes.
- The report's brief section, plain Start building line, wheel marks.

| Target | Today | After |
|---|---|---|
| Controls in the Ask the room form (a Choose) | 17 | **≤ 12** |
| Decisions to write your own ask | 3 (kind, Claude gets it as, Ask) | **2** (kind, Ask) |
| Blank wrap-up fields when Claude is connected | 4 | **0** (one press) |
| Console states with "No main move" after the wrap-up | 1 | **0** |
| Internal prompt text in the report | 1 line | **0** |

Not in any phase: 11 (merged), 17, 19, 20, 22 (dropped). The ? key list is a half-day that
can ride phase 3 if the owner wants it.

---

## 6. Questions only the owner can answer

1. **Gate or no gate.** Should the opening wait until Claude Code has connected, as the
   review proposed? This plan says no: the room can frame the build first and every send
   waits as Queued for Claude.
2. **The five core steps.** Making, For, The problem, Good looks like, First build, with We
   will know, Never, Tools and style and Look and feel one click away. Is that the right
   five?
3. **Three routes on an idea.** Send to Claude and Ask the room on the row, the idea's
   words opening Consider, and Save for later, Acknowledge, Dismiss and Reply under More.
   Is that an acceptable reading of "every item has the same routes"?
