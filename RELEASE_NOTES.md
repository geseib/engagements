# Release notes

One entry per push to **test**, newest first. Each entry says what changed, what was
fixed, and what the reviewer should look at. The rule, from the owner on 16 Oct 2026:
before every push to test, the release notes, the in-app help and the README are
brought up to date (see `CLAUDE.md`, "Before every push to test").

Entries name the dev commit that was merged, so the review can be matched to the code.

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
