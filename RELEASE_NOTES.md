# Release notes

One entry per push to **test**, newest first. Each entry says what changed, what was
fixed, and what the reviewer should look at. The rule, from the owner on 16 Oct 2026:
before every push to test, the release notes, the in-app help and the README are
brought up to date (see `CLAUDE.md`, "Before every push to test").

Entries name the dev commit that was merged, so the review can be matched to the code.

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
