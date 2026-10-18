# Release notes

One entry per push to **test**, newest first. Each entry says what changed, what was
fixed, and what the reviewer should look at. The rule, from the owner on 16 Oct 2026:
before every push to test, the release notes, the in-app help and the README are
brought up to date (see `CLAUDE.md`, "Before every push to test").

Entries name the dev commit that was merged, so the review can be matched to the code.

---

## 18 Oct 2026: room screens redrawn, Claude's posts wait for the host, and remote share

**Test:** merge of dev `8b39973e` (and the notes, help and README commit after it). This is the first push to test since 17 Oct's third; it carries everything dev gained since, from several sessions. Plans: `docs/design/parity/PLAN.md` §2c and §2d; room screens mockup `docs/design/room-content-v2/`; remote share `docs/superpowers/specs/2026-10-16-build-room-remote-share-design.md`.

### New

- **Room screens show what the room reads and takes away** (owner, 18 Oct: "you provided the biggest text with the generic room instructions, not the changing lesson… the instructions is the optional one. the title often is nice to have big too"; and "nice to see a bar chart results but not at the expense of seeing what was voted on"). One rule (`config/roomContent.js`) for the one-screen stage and the room's window, on every size:
  - **A question or lesson is up:** the **title** is the biggest text and the **lesson** sits under it, never dropped. The question to answer is one **Your turn** band: the question's own instruction, or the question pulled from the front of the lesson when it opens with one ("Describe how you…"). A general instruction ("answer on your phone") is left off Room, TV and Table; Call keeps it small. ALL-CAPS titles show in title case.
  - **Voting:** every answer whole and numbered when they fit on one screen; otherwise answer 1, as before. The title stays as the reminder. No tally while voting.
  - **Results:** the room's pick in full, the runners-up with their text, the bar the fill behind each answer measured against the pick. **No counts or percentages while names are hidden**; a named round keeps the credit and points. A *Talk about it* line at the foot never asks who wrote anything.
  - **Put one up:** click an answer or a result, or step with → and ←; chips (voting) or a ladder of bars (results) show where it sits; Esc goes back to all of them.
  - **Show QR is a panel beside what is up**, not a cover, on one screen and on the room's window, from J, the rail, the Presentation's strip or the phone remote. It is now its own fact on the server (`stageFocus.join`), so the answer on the wall stays up with it.
  - **Build Room:** each option shows its detail on every size; **no tally while the ask is open**; on the result the votes rise inside the options, the pick is marked *The room's pick* with the room's best reason, and the Stage shows *Sent to Claude* with the direction until Claude says what it is doing.
- **Remote share** (owner, 16 Oct design; walked by the owner on dev 18 Oct). Share demo has a switch, **Also open it to people who are not here** (off by default). People on Zoom or another network get the same **Open the demo** button, each with their own key. The panel lists who opened it and on how many devices, with **Remove**; starting and failed states say why. The plugin downloads a pinned, hash-checked Cloudflare tool on first use, runs one tunnel per session, goes live only once reachable, and never leaves it running. The tunnel forwards to the demo and keeps the Wi-Fi share's folder rules. Phones see *Not here? Opening soon.* while it starts.
- **Claude's posts wait in the host's queue** (owner: "have things get to the host queue to release to the room"). Claude's updates, showings, answers and screenshots arrive in **Waiting for you** with **Release to the room**, **Keep to myself** and **Release all**; nothing reaches phones or room screens until released, and a released post takes its place at the time it happened. Claude's live status is never held. Switch: Session › Settings › Claude › *Check Claude's posts before the room sees them* (on by default).
- **The Stage while Claude works** (I9, I10): *Sent to Claude* until Claude picks it up, then a row (Building / Testing / Fixing / Checking / Saved), the last test counts, and the last four things Claude's tools did (file and program names only). These tool lines now reach the room's window.
- **Which plugin is running, everywhere:** Claude Code says it on connect; Settings › Claude always shows it and whether it is the latest.
- **Plugin 1.24.1** carries all of the Build Room changes above (1.21 release gate, 1.22 remote share, 1.23 version everywhere, 1.24 the work row, 1.24.1 tunnel errors).
- **Room's window lobby:** the session title large with the event details under it; the QR on the right with the address and code. Quick start writes the set's description into Event Details.
- **Quick start shows Where the room watches** (one screen or two) and, on two, opens the room's window on the other display in the same press; a placed window says *Click anywhere to fill the screen*.
- **Two-screen console:** the next step is a *Your part now* card at the top of the centre; leaving is *← All sessions* on the top line.

### Fixed

- The visitor pages name the real button (*press Open the demo*) and no longer say the demo is only for people in the room.
- The console's first row read *The question · On the wall now* while the wall showed the results; it now says *The results*. The strip draws its dot (*What we heard · results*).
- A Workie read landing after *Workie is writing* no longer replays *Results · Look up* over its first page; the read on the wall is larger.
- The laptop's codes card now follows the server when an ask opens; the stage refits once web fonts load.

### What to look at

1. **Update the plugin** from Connect Claude Code and restart Claude Code; Session › Settings › Claude says **1.24.1, the latest**.
2. **A lesson round** (a Call & Answer lesson set, Room size): the title is the big text, the lesson under it, the question in *Your turn*; no "answer on your phone" line. Switch to **Call**: the general instruction appears, small.
3. **Voting** with up to six short answers: all of them numbered on screen. Click one: it fills the screen with chips; → steps, Esc goes back.
4. **Results:** *The room's pick* in full, bars behind the answers, no numbers while names are hidden. Open one: its place and the ladder.
5. **Show QR** (J) during answering, then during voting with an answer up: the QR panel comes in beside the content and the answer stays up. Do the same from the phone remote and on the room's window (two screens).
6. **Build Room, a Choose ask:** each option's detail on Room, no counts while open. Show results: bars inside the options, *The room's pick* with a quoted reason; send it: *Sent to Claude* until Claude picks it up.
7. **The queue:** ask Claude to post progress and a screenshot; both wait in *Waiting for you*; release one, keep the other.
8. **Remote share:** turn on *Also open it to people who are not here*; a phone on mobile data opens the demo from *Open the demo*; the panel lists it; **Remove** ends it; turning it off closes the address.

### Known gaps

- *Talk about it* is always the fixed line; Workie's discussion topic is not wired in yet.
- Call keeps one column (the mockup's two-column Call layout is not built); no highlighted phrases in lessons.
- TV and Table were checked by tests, not in a browser; the room's window was rendered in Chromium on Room and Call at 1280×720 and 1920×1080, the one-screen stage on Room at 1920×1080.
- The room's window cannot page a long Build Room ask; it shows the first page and how many more.
- Remote share: some company networks block Cloudflare's address; no uptime promise; the macOS unpack and a system proxy are untested in CI; on Windows a tunnel left by a crash is not cleaned up at the next start; History links stay Wi-Fi links.
- The two-screen laptop console for Build Room still waits for the owner's review of its mockup.

## 17 Oct 2026 (third push): Build Room's History marks, a share that opens only the demo, the room's window, and a dock that holds still

**Test:** merge of dev `ad049d6e` (and the notes, help and README commit after it). **Review tag:** `reviewable/2026-10-17-…` (named in the push). Plan: `docs/design/parity/PLAN.md` (§2.8, §2a, §2b, §2.9, §2.9a).

### New

- **History says what the room gave and what reached Claude.** Every idea from the room that was used, and every ask the room saw, decided or not, on the host's History and on every phone's History tab. Each carries one mark: *chosen by the room* or *not chosen*, *sent to Claude as written*, *reworded by the host*, *for Claude, later*, *sent later, in other words* (a decision kept back and then combined), *with the room*, or *closed, nothing sent to Claude*. No names anywhere; a phone marks its own ideas as *yours*. The server now records, at the moment of sending, which idea or ask each thing came from and whether the host changed the words. *Made so far* counts used ideas by the same rule.
- **The room's window for Build Room.** Session › Settings › **Screens** › **Room's window** opens Stage, Build or History in its own window (on the second display in Chrome). It needs no sign-in, carries no host data and never shows a name; it follows the screen the host picks (2, 3, 4, P, the header tabs) and the codes card, and reports whether it is open and full screen. **New link** (press twice) cuts off every open window. The full two-screen laptop console waits for the owner's review of its mockup (`docs/design/build-room-console/index.html`).
- **Plugin 1.20.0: each shared server says what it is.** The share panel names servers *Demo*, *Mockups* (or *Mockups · Ask 3*) instead of App 1 and App 2. A project file `.engage/share.json` (`demo`, `mockups`, `label`) names them and wins over any guess; Claude can mark a link it posts as the demo or a mockup. Each session takes its Wi-Fi ports from a block set by its code (`ENGAGE_LAN_PORT` still overrides), every gateway response carries `X-Engage-Session`, the gateway's own pages name the session, and the plugin writes `.engage/share-status.json` listing what is shared.
- **Two design documents for the owner:** the Build Room console mockup (`docs/design/build-room-console/`) and remote share, security first (`docs/design/build-room-remote-share/DESIGN.md`). Nothing from either is built.

### Fixed

- **Share demo opened a folder of mockups, not the playable demo** (dev game 1215). The host's Open the build, QR and codes card went to each server's root; they now open the page Claude showed, as the phones always did.
- **The share let the room browse a whole folder.** Plugin 1.19.0 opens a page only inside the folders of the pages Claude linked (a page may still load its own files and API), never shows a folder listing (compressed ones too), and Claude is told to serve only the demo's and the mockups' own folders.
- **The Stage's bottom row moved under the pointer.** The *Press Space to …* hint appeared on hover and pushed Host and Session sideways; buttons came and went between moments. The Stage now uses the same dock and action bar as Call & Answer: fixed slots, Host and Session last, nothing changes on hover, and an early move (Show results while people are still answering, Next before Claude has finished) asks for a second press in place instead of a dialog.
- **The way back from the Stage was hidden.** With a count, Host opened a list instead of going home; it now goes to the Host screen in one press and keeps its count as a badge. The header's list on Build and History stays.

### What to look at

1. **Update the dev/test plugin** from the Build Room's **Connect** panel and restart Claude Code; Session › Claude should say **1.20.0** with no out-of-date notice.
2. **Share demo.** Have Claude show a demo served from a folder that also holds mockups. **Open the build** and the QR open the demo page itself. Remove the page name from the Wi-Fi address: it says *Not part of the shared build*, never a file list. The share panel names the servers *Demo* and *Mockups*. Write `.engage/share.json` with a `demo` link: Open the build follows it within a few seconds.
3. **History.** Send one idea to Claude, put two ideas to a vote, change the words of the winner before sending, and leave one ask open. On History (host) and a phone's History tab: the sent idea reads *sent to Claude as written*, the vote's two ideas *chosen by the room* and *not chosen*, the decision ends *reworded by the host*, the open ask reads *with the room*, and no name appears. The phone that sent an idea sees *yours* beside it.
4. **The room's window.** Session › Settings › Screens › **Room's window**: on a second display in Chrome it lands there; click once for full screen; the status says *on, full screen*. Press 2, 3, 4: the window follows. Reload it: same screen. Open it on another computer with the same link: both follow. **New link** twice: the old windows say their link has changed.
5. **The Stage dock.** Move between moments and hover the dock: nothing moves. At 3 of 4 answered, **Show results** asks for a second press. With something waiting, **← Host** goes home in one press.

### Known gaps

- The two-screen laptop console (B8) is not built: it waits for the owner's review of the mockup and its five questions. Until then the laptop on two screens is the same Host page.
- On the Stage and the room's window, a long ask with six long options is still cut at 1280×720 (marked, not paged).
- The window follows the codes card the server clears when an ask opens; the laptop's own codes card does not yet.
- The dock's stillness is held by tests, not yet measured in a browser on the signed-in page.
- Phones still receive two things the room's window now hides: a *Claude proposed a question* timeline entry for an ask the room has not seen, and mockups for asks still being drafted.
- Remote share (people off this Wi-Fi) is designed, not built.

## 17 Oct 2026 (second push): review #35, the verdict counts and four end-of-session fixes

**Test:** merge of dev `00cc0aee` (and the notes and help commit after it). **Review tag:** `reviewable/2026-10-17-…` (named in the push).

### New

- **The Verdict Board prompt is installed on test and dev** (v3, same prompt id, so Ready or Not picks it up with no other change). It sorts each answer by the verdict it opens with: a conditional yes ("yes, bounded", "pilot only", "only after", "fine if") is *Clears only if*; "no", "not yet", "unknown", "unproven" or "I cannot judge this from what was shown" is *Not shown to clear*; a plain yes is *Clears*; *No verdict* only when no verdict is given anywhere. No-verdict answers are never named or quoted, and a quote is only ever credited to the person whose answer contains it.

### Fixed

- **An empty round was reported as "expired"** (review #35). A round nobody answered, reported minutes later, carried an *Incomplete record* note saying its responses had expired under the seven-day retention. A round younger than seven days with no answers now reads as complete; the note still appears for a round old enough to have lost its answers.
- **"The responses could not be loaded" on a round nobody answered** (review #35). After the end, opening that round from **Something to add?** now says nobody responded. A round that has answers but whose results were never shown is still not opened: its authors were never revealed to the room.
- **A player who reloaded or rejoined after the end saw "Final score 0"** (review #35) while the host and the report said 6. The closing screen now reads the final score and standing from the server.
- **An earlier round opened after the end was headed only "Round 1"** (review #35). The heading is now the round's question; the top line still says *Round 1 · Feedback*.

Not changed: **Keep for 90 days** is right. The 30-day expiry the review found is the session's working copy of the report; the saved report's own record expires 90 days after the save (checked on test: 15 Jan 2027 for session 5963).

### What to look at

1. **Verdict counts.** Run *(Demo) Ready or Not* with the Demo, Deploy and Data answers quoted in issue #35. Expect Demo **Clears: 0. Clears only if: 4. Not shown to clear: 0. No verdict: 0.** and Data **0 / 0 / 4 / 0**; Deploy puts Lena's "fine if" under *Clears only if*. Press **Redo** two or three times on each: the wording may change, the counts should not. No *No verdict* bullet names anyone, and every named quote is from that person's own answer.
2. **An empty round.** Start one more round, let nobody answer, never show results, end the session and generate the report straight away: there is no *Incomplete record* note, and the round says *No answers recorded for this question.*
3. **The same round on a phone.** After the end, open it under **Something to add?**: the panel is headed by the round's question and says nobody responded; there is no *Try again*.
4. **Final score after a reload.** After the end, reload a player's page and rejoin as the same name: *Final score* and *Final standing* match the host's standings.
5. **Earlier rounds.** Open Round 1 from **Something to add?**: the heading is that round's question, the top line *Round 1 · Feedback*.

### Known gaps

- Workie runs at a fixed temperature for every prompt, so a Redo can still reword the read; only which side each answer falls on is pinned down.
- After the end, a trivia, wavelength or poll round's responses still do not load in the comment panel (Call & Answer only); its heading now shows the question.
- The fixes were checked by the test suites and not yet walked on dev in a browser.

## 17 Oct 2026: the room's window opens on the second display, and the fixes from review #34

**Test:** merge of dev `b5be600d` (and the notes, help and README commit after it). **Review tag:** `reviewable/2026-10-17-…` (named in the push).

### New

- **The room's window opens on the second display for you.** In Chrome or Edge, with the projector or TV connected as a second display (extended, not mirrored), **Room's window ↗** opens the window on that display and fills it. The first time, the browser asks to *manage windows on all your displays*: allow it. Then one click on the room's window makes it full screen. The same happens from Settings › Screens, the Setup chooser and the dock's PRESENT. Other browsers, one display, a refused permission or a blocked popup: it opens beside you as before; drag it over and press F.
- **Comments after the end can be reached** (review #34). When the session ends, each phone's closing screen says **Something to add?** and lists the rounds, for as long as comments are open (24 hours, or until the host presses Close comments). The comment panel opened from there stays open, shows that round's results and Workie's read, and marks the comment as added later.

### Fixed

- **Workie's verdict counts on Ready or Not blurred conditions and "unknown"** (review #34). The Verdict Board now counts four ways: *Clears*, *Clears only if*, *Not shown to clear*, *No verdict*. "Not yet", "Unknown" and "Unproven" count as not shown, never as a failure, and an answer that opens "Not yet" is never a clear. Conditions are quoted and never treated as met; a side counted at zero is never described; next steps are suggestions. **This is a stored prompt: it takes effect only once it is installed on test** (see Known gaps).
- **"Pick the ideas to show" after a Choose or Rate question** (review #34). After a question for the room, "Your part now" says *Pick the ideas to show* for Ideas only; Choose and Rate say *The room's answer is up*.
- **The host's response list could lag behind its count** (review #34: "3 of 4" answered while the list said *No responses yet*, until a reload). The host's list now reads the answer that was just announced, and while the count is ahead of the list during answering, the console fetches the list again (at 1.5, 3 and 6 seconds, up to five times a round).

### What to look at

1. **Second display.** In Chrome on a laptop with a projector, TV or iPad connected as an *extended* display, start a two-screen Call & Answer session and press **Room's window ↗**. Allow the browser's prompt. The window should open on the other display, filling it; click it once and it goes full screen; the console's status reads *on, full screen*. Try the same from Settings › Screens.
2. **Without a second display**, or in Safari or Firefox, the same button should open the window beside you, exactly as before.
3. **Comments after the end.** Join on a phone, play two rounds, then end the session from the host. The phone shows **Something to add?** with Round 1 and Round 2. Open Round 1: its responses and Workie's read load, the header says *Round 1 · Feedback*, and a comment posts and is marked *added later*. On the host, **Close comments** (Rounds tab), then reload the phone: the section is gone.
4. **"Your part now"** after a Choose and after a Rate question for the room: neither says *Pick the ideas*. After an Ideas question it still does.
5. **Response list.** Answer quickly from three or four phones at once during a round: the console's list should match the count within a few seconds without a reload.
6. **Verdict counts** (only once the prompt is installed): play rounds 2, 5 and 6 of Ready or Not with the answers quoted in issue #34 and check the count line and the bullets agree.

### Known gaps

- **The Verdict Board prompt is not installed on test by this push.** Prompts are stored records: someone with admin rights re-posts `demo-sets/ready-or-not.prompt.json` (see `demo-sets/README.md`) or runs `scripts/install-ai-prompt.js`. Until then Workie on test counts three ways as before.
- The response-list lag was not reproduced on dev from a fresh page; the fix covers every path that leaves the list behind, but has not been seen failing and then recovering.
- Second-display placement was checked in Chromium with two emulated displays, not yet on a real second monitor.
- After the end, a trivia, wavelength or poll round's responses do not load in the comment panel yet (Call & Answer only); the comment box still works.

---

## 16 Oct 2026: late answers and comments, results ideas first, Settings regrouped, Rate ends

**Test:** merge of dev `7e73d851` (and the notes and README commit after it). **Review tag:** `reviewable/2026-10-16-…` (named in the push).

### New

- **Nothing that arrives late is lost** (session flow v3, phase 5).
  - An answer to a question for the room sent after its results are up is kept; the phone says "The results are already up. Your answer is kept, but not in the count."
  - Once a round's results have been shown, people can keep commenting on it, marked "added later", until 24 hours after the session ends. After the end the host can press **Close comments** to stop them sooner.
  - **Late & not reviewed**: a list in the Rounds tab and in the two-screen console's left rail. Each item says who and when ("during Round 3 · Voting") and carries a label: *Not reviewed*, *Reviewed by the host* (**Mark reviewed**) or *Reviewed with the room* (**Show on the wall**). The status line counts what is waiting, e.g. "4 late answers kept".
  - The report shows each round's **Arrived late** items with their labels. **Settings › Report › Include items not reviewed** (on by default) leaves the unreviewed ones out when turned off, and says how many. Redoing Workie's read includes late answers and says so.
- **Results, ideas first**, on the room's window and on one screen: each idea in full as the headline, a bar for how much the room backed it (compared with the top idea), and a small credit line with the points and the name, the name only while names show. The heading reads "What the room backed". The people podium is off the results; the scoreboard is on demand (**S**, or **Show scoreboard** in the console's People section).
- **Put the question back up.** During voting and results, the question line above the cards (one screen) or the console's first row, "The question", puts the question on the wall.
- **The console marks the read.** The part of Workie's read the wall is showing is marked "On the wall".
- **Press twice, in place.** The "Proceed to voting?" dialog and its two relatives are gone. Advancing early changes the button to "Start voting anyway" / "Show results anyway" and says who is still at it: "1 of 3 still writing", or "Nobody has voted yet". Press again within a few seconds to go ahead. A question for the room's **Show results** now asks the same way on the laptop.
- **Settings, regrouped** into four groups, most used first: **Screens** (one or two screens, the room's window, room screen size, which was "Display profile"), **Your phone as a remote**, **The rounds** and **Joining**; session details and keys fold away. The Screens group also sits at the top of **Setup** on the step strip, so a host can switch between one and two screens mid-session.
- **Who may sign in on the phone.** The remote box says who may drive the session (any host or admin of the team; on a personal space, only you) and who is signed in on this laptop. It shows the email only while the room's window is up on two screens; otherwise the name, because the room may be watching the laptop.
- **Rate names its ends.** In Ask the room, a Rate question has "1 means" and "5 means" menus (Disagree/Agree, No/Yes, Low/High, Unlikely/Likely, Hard/Easy), or Custom for your own words (up to 24 characters each). Phones, the wall, the console and the report show them.

### Fixed

- **Privacy:** an idea's id, and a late item's reference, were a plain hash ending in the player's name, so someone holding the roster could match an idea to its author. They are now keyed by a secret made per session that never leaves the server.
- **The wall's results cut off long ideas** (five ideas of ~120 characters at 1280×720 lost the top and bottom rows). The wall now shrinks the type, then holds ideas to two lines, then shows the top ones with "and N more ideas". The top idea and the heading are never cut.
- **One-screen results ran off the stage** at laptop sizes. Results now show fewer ideas per page than voting does (Room 2, Call 2, TV 1, Table 3), measured to fit at 1280×720, 1366×768 and 1440×900; ↑ ↓ pages through the rest. A crowded dock drops the SPACE hint before it wraps a button to a third row.
- **A question put on the wall stayed up after the round moved on** (ASK to VOTE, and VOTE to RESULTS). It now comes down. With the question up during voting, **Next response** now goes to Response 1 instead of skipping it.
- **The session panel's Settings were hard to read in the light theme** (dark labels on the navy panel), and below about 660px wide the **Settings** tab sat off the edge of the screen. Both fixed.
- **A question for the room closed on one press** on the laptop even with nobody answered. It now asks twice.
- Late round answers two or more rounds past the last round row were missed by the late list and the report.

### What to look at

1. **Results on one screen.** On engage.test, run a Call & Answer round with six people and long answers (two or three lines each). On Results, try Settings › Screens › Room screen size at Room, TV and Table on a 1366×768 or 1280×720 laptop: nothing runs under the dock, and ↑ ↓ pages through the rest.
2. **Results on two screens.** Switch to **Two screens** from Setup, press **Room's window ↗**, and look at the same results there at Room, TV and Table: every visible idea is whole, the top one is outlined, and on TV the foot says "and 3 more ideas".
3. **Press twice.** In voting with nobody voted yet, press **Show results** once: it reads "Show results anyway" with "Nobody has voted yet. Press again to show results." Wait six seconds and it settles back; press twice to go ahead. Do the same on a question for the room.
4. **Settings.** Open the session panel (**\\**) › Settings: four groups in order, everything readable in both light and dark mode. Make the window about 660px and 375px wide: all four tabs can be reached.
5. **Who may sign in.** On two screens with the room's window closed, the remote box shows your name; open the room's window and it shows your email; switch to one screen and it shows the name again.
6. **Rate ends.** After a round's read, Ask the room › Rate: pick "Low" in "1 means" and "5 means" follows to "High"; try Custom with your own words. Send it: the phone, the wall and the console show the ends; after the session the report does too.
7. **Late items.** Show a question for the room's results, then answer it from a phone: the phone says it is kept; the host's status line counts it; it is in **Late & not reviewed** (Rounds tab, and the console's rail on two screens) as *Not reviewed*. Press **Mark reviewed**. Comment on a finished round from a phone after the room has moved on. End the session, press **Close comments**, then open the report and look for **Arrived late**; turn off **Include items not reviewed** and make the report again.
8. **The question on the wall.** During voting, press the question line (one screen) or "The question" in the console: the wall shows the question. Press **Next response**: it goes to Response 1. Start voting from a round where the question was up at answering: it comes down.

### Known gaps

- Results show fewer ideas per page than before, so a big round on TV is one idea per page.
- After a question for the room's results, "Your part now" says "Pick the ideas to show" even for a Choose or Rate question.
- The two-screen console is for a laptop; at phone widths use the Remote.
- A late round answer has no wall view yet, so it can only be marked reviewed. **Show on the wall** is offered only for the round the wall is on.
- **Close comments** is only offered once the session has ended.
- Ideas picked in a session that was live when this deployed stop matching their ideas (the ids changed).
- Settings held for the next round are lost on a reload; the phone cannot tell which response number is its own after a reload.

---

## 16 Oct 2026: Share demo holds steady when two plugins are running

**Test:** merge of dev `d0b8443b` (and the notes and help commit after it). **Review tag:** `reviewable/2026-10-16-…` (named in the push).

### New

- **Engage plugin 1.18.0.** Each plugin copy now names itself when it reports the
  Wi-Fi share. The host's Session panel says the plugin is out of date until it is
  updated from **Connect**.

### Fixed

- **Share demo's count flipped between 0 and 1, and a participant's Open the build
  link swapped addresses every few seconds.** Two plugin copies were sharing one room:
  an old prod plugin (1.14.0) beside the test plugin, each with its own address, key and
  count. The room now stays with the copy that holds it; any other copy is told to stop
  and closes its address. If the copy holding the room goes quiet for 30 seconds, the
  next one takes over.

### What to look at

1. **Update the test plugin** from the Build Room's **Connect** panel and restart Claude Code. Session › Claude should show 1.18.0 and no out-of-date notice.
2. **Steady count.** Connect a folder, let Claude show the running app, press **Share demo**, and open the build from a phone, laptop or tablet on the same Wi-Fi. Watch the host's chip and the participant's screen for a minute: the count stays at 1 and the link does not change.
3. **A second window.** Open a second Claude Code window on the same folder and connect it. The count and the link still do not change, and the second window does not open its own address.
4. **Hand-over.** Quit the window that was sharing. Within about 30 seconds the other one takes over: the chip shows *On* again, and participants get a new link (the old one stops working).

### Known gaps

- An old plugin (1.17.0 or earlier) alongside another old one still flips as before; the fix needs at least one copy on 1.18.0.
- After a hand-over the participant must press **Open the build** again: the new copy has a new key.
- The prod tier still serves plugin 1.14.0 until prod is promoted.

---

## 16 Oct 2026: the host console on two screens

**Test:** merge of dev `0e137d29` (and the help and notes commit after it). **Review tag:** `reviewable/2026-10-16-…` (named in the push).

### New

- **The host console (two screens only).** When the room's screen is a separate
  window (Present), the host's laptop no longer shows a copy of the wall. It shows a
  private console:
  - **Top line:** the session name, **Join 4473** (puts the join code on the wall), **Room's window ↗** (opens it), and a status that says whether the room's window is really up: *on, full screen*, *open, not full screen*, *hidden*, or *not open*.
  - **The loop:** the round's steps across the top. Pressing a step lets the host look at it privately; the room stays where it is.
  - **Left rail:** Round queue, People, Late & not reviewed, Session tools. The section that matters for the step opens by itself; a header's link opens the session menu at that tab.
  - **Main area:** the host's work for the step: responses as they land (names hidden while hidden), the ballot in the room's order, results with points, Workie's read with **Ask the room** beside it, the question for the room, comments as they land.
  - **Footer:** the one count for the step, "Your part now", "Next on the wall", and the buttons. Space, →, ← and the clicker work as before.
- **The room's window reports itself.** The Present page tells the server whether it is full screen and visible; the host's status is judged by the server's clock, so a wrong laptop clock cannot flip it.
- **Late answers are kept** (session flow v3, phase 5, step 1). An answer that arrives after its round has moved on is stored as late instead of being lost. The phone says "Kept, but late." If voting started while someone was still writing, the phone offers "Send it anyway".

### Fixed

- The Ask the room composer could be painted over by the step strip and the dock on one screen; it now sits above them.
- In-app help said players cannot vote for their own answer. They can (owner ruling, 11 Oct); the help now says so.

### What to look at

1. **Two screens, Call & Answer.** Two screens is only switched on for Call & Answer today (`config/surfaces.js`), so that is where the console appears. Start a session, open **Room's window ↗**, and run a full round: lobby, answering, voting, results, What we heard, Ask the room, a question for the room.
2. **The room's-window status.** Open the room's window in another tab: background tab → *hidden*; front → *open, not full screen*; press F on it → *on, full screen*; close it → *not open* within about 10 seconds.
3. **Keys.** After clicking a response to put it on the wall, Space and → must still move the room on. The "press again" warning on **Start round N** mid-read must work with two presses.
4. **Names.** On a round that hides names, no name appears beside any response, during answering or voting, and the People list never shows "still writing" next to someone who has answered.
5. **Laptop sizes.** 1366×768 and 1440×900: nothing scrolls sideways, and the footer's main button is always on screen. Ask the room's **Send** stays on screen while the read scrolls.
6. **One screen unchanged.** Switch to one screen (Settings) and confirm the stage, the slim strip and the dock are as before.
7. **Late answers.** On a phone, answer after the host has started voting: the phone should say the answer is kept but not in the vote.

### Known gaps

- Late & not reviewed is always empty until phase 5 adds the late list.
- Workie's read shows the whole text; it does not mark which page is on the wall.
- *On, full screen* could not be shown in the build's browser pane (it blocks full screen); please check it on a real second display.
