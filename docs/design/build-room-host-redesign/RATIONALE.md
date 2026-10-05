# Build Room host redesign: rationale (second pass)

Design only. Nothing in `src/` changes in this task. The mockups are the design; this file
records why they look the way they do, what was measured, and what the owner still has to
decide.

**Viewing:**

```bash
python3 -m http.server 8131 --directory docs/design
```

Then open `http://localhost:8131/build-room-host-redesign/`. Add `#s1` to a page's URL to
see the screen alone, fitted to the window.

Rebuild with `_src/build2.py` (second pass) and `_src/build.py` (first pass, kept as
`first-pass.html` and the `b-`/`a-` pages).

---

## 1. The brief, both rounds

Round 1 (2026-10-05):

> "too much to take in … requiring the host to scroll up and down … keep things minimal
> on the screen … much of the mechanics are here … When can something be collapsed or
> simplified?"

Round 2, on the first pass:

> "I like the idea that Claude and humans asks/ideas/input queue up together. The ability
> to send ideas to the room for feedback or vote, … sending ideas to Claude Code is also
> a good option. … the present button is not useful as is. … there was an artifact section
> in the original that we could review back through, might need to have it avail to the
> participants as well. … this history of decision and actions is great as well. … present
> is really switching to the local live view of the development server page … iframe the
> page in a header that allows you to switch back to the tab of the host screen."

The first pass (`first-pass.html`) answered round 1 with the regular stage's layout: a
rail, a stage, a dock with one next move, and a tabbed drawer. It kept two things apart
that the owner wants together, ideas in one tab and Claude's asks in another. It buried
the history in a Record tab. And it treated Present as a way to hide controls rather than
a choice of what to show. The second pass rebuilds around the owner's words.

## 2. What today's page does, measured

Rendered from fixture state built by the real backend's pure half (`build-store.js`
`roomFromRows` + `hostView`) with the real stylesheets, at 1440×900. The renders are in
`today/` and on `00-today.html`.

| State | Page height | Stage starts | Host acts at | Buttons |
|---|---|---|---|---|
| Claude building | 1260px | 163px | What next? 680–982px | 29 |
| Claude proposes an ask | 1866px | **878px** (below the fold) | review card 163–862px | 34 |
| Live ask | 1260px | 163px | top of the stage | 33 |
| Results to decide | 1822px | 163px | Send to Claude ~1100px | 38 |

The header is 147px (three rows, eleven controls). Six to eight panels are open in every
state.

## 3. The model: three nouns and four screens

Everything on today's page is one of these (`c0-model.html`).

**The queue: waiting for you.** One list of everything that needs a decision, whoever it
came from:

- **Claude:** proposed asks, which sort first because Claude is waiting on them.
- **The room:** ideas sent from phones, and "Needs a change" feedback on a preview.
- **You:** notes the host queued.
- **The crew:** early looks and requests for help.

Every item has the same routes:

| Route | What it does |
|---|---|
| **Ask the room** | Open it (a Claude ask). Put several to a vote. Ask for ratings. Ask the room for ideas on it. |
| **Send to Claude** | As a direction, with the host's words added if wanted. |
| **Decide yourself** | Answer for the room, as today's "said out loud". |
| **Later / Dismiss** | Dismissed items can be restored, as ideas can today. |

Tick several items to route them together. The main use is "put these three ideas to a
vote". With "mockups first" on, the dialog's button reads **Ask Claude for 3 mockups**,
not Open. The vote waits in the queue, hidden from the room, while Claude fills each
option, and then it opens by itself or waits for the host (C3b).

**Now.** One card: what Claude or the room is doing at this moment. While Claude builds
it shows the live activity, with Show the build and Preview the work. While an ask is live
it shows the counts, Close, Answer for the room and Edit. At results it shows the
direction sentence, Adjust and Send to Claude.

**History.** Every decision and action, with the artifacts at the moment they were made,
and the chain from an idea to its vote, to the direction, to what Claude built. The same
story appears in four places:

- the Host screen's right column (editable);
- the History screen (projectable);
- the phone's History tab;
- the report.

**Four screens in one header, instead of Present:**

| Screen | Key | What it is | For |
|---|---|---|---|
| Host | 1 | Now, the composer, the queue, History | the host |
| Stage | 2 | the current ask or results, big, with Close in the dock | the room, during an ask |
| Build | 3 | the live product from the local dev server, framed under the header | the room, while Claude builds |
| History | 4 | the story, and the artifacts grid | the room, looking back; the closing screen |

The header is the same on all four: the title, the four tabs, an ask pill when an ask is
open, Claude's status, the join code (QR on hover) and a menu. The menu holds Connect
Claude Code, Crew, Wrap up, Report and End session. **P** flips between Host and the
last screen shown to the room, so the existing key keeps meaning "show the room".

## 4. Why this focuses attention

- **One place for "what do I do next".** On the Host screen it is the top of the queue
  plus the Now card. Today the next move can be anywhere from 163px to 1100px down a
  scrolling page.
- **One way to route anything.** Today an idea has Send to Claude / Add to current ideas /
  Dismiss, a Claude ask has Open / Discard / Answer, a timeline note has Send to Claude,
  and preview feedback has nothing at all. In the queue, every item offers the same four
  routes in the same order. A host learns them once.
- **One composer.** Today Tell Claude, the timeline's "Log what the room said" and the Ask
  the room buttons are three separate forms. Now the host types once and picks where it
  goes: Send to Claude, Ask the room, Queue it, or Log it into History.
- **The room sees what the host chooses.** Stage, Build and History are made to be
  projected. Choosing a screen is a clearer act than toggling Present, and it is what the
  owner said presenting really is.
- **Nothing scrolls the page.** Each Host column scrolls on its own, and the queue
  collapses to "+ N more".

### What is always visible, what collapses

| Always, on every screen | On the Host screen | Collapsed until needed |
|---|---|---|
| Header: title, four tabs, ask pill, Claude status, join code | Now, the composer, the queue, History | Review fields (Edit on a Claude ask) |
| The Host tab's count of what is waiting | | Decide → Adjust (chosen, fold in, note, record only) |
| | | Queue beyond its first items ("+ N more") |
| | | People and Claude activity (tabs beside History) |
| | | Handled and dismissed items |

## 5. The projector rule, and notices

Stage, Build and History are made to be seen. On them, anything waiting for the host
shows **only as a number on the Host tab** and the ask pill. Names, and the text of ideas,
feedback and proposed asks, appear only on the Host screen. A proposed ask's question
never reaches the wall before the host opens it.

On the Host screen the queue itself is the notice, so toasts are rarely needed. The
first pass's tiers (`notices.html`) still apply:

- **Ambient:** counts only.
- **Info:** a short toast, Host screen only.
- **Action:** the queue's top item, and the Host tab count.
- **Alert:** a bar under the header for the connection, on every screen. The connection
  is host-only, but when it drops the room is not seeing changes either.

## 6. The Build screen: the owner's idea, and what was measured

The live product, framed under the Engage header. During a Choose ask whose options have
local links, Choice A and Choice B get tabs, so the room sees each one running. A small
room-safe pill over the frame shows that an ask is open and how many have answered.

**Measured 2026-10-05 in the desktop app's browser pane (Chromium 152).** An https page
framed `http://localhost:8131`. The frame stayed blank and a `fetch` to the same address
failed. The local server's log shows neither request arrived, and no permission prompt
appeared. The server itself was up (`curl` returned 200).

This is consistent with Chrome's local network access protection: public sites need the
user's permission to reach localhost, and Chrome asks with a one-time prompt. The
embedded pane may not be able to show that prompt. Not yet tested: the owner's Chrome,
Edge, Safari and Firefox, and dev servers that send `X-Frame-Options` (Rails and Django
do by default).

So:

- **PLAN step 0 is a spike on the owner's browsers** before anything is built.
- **The design never shows a blank frame.** C8: when the frame does not load, the screen
  shows the newest screenshot, the permission step, and "Open the build in a new tab".
- **Phones never get localhost links**, as today (`publicUrl` strips them). They get the
  screenshots instead.

## 7. Artifacts, for the host and for participants

"Artifacts" is the repo's own word for a room's screenshots and timeline entries (the
delete rule, `gateArtifactDelete` in `build-room.js`). Today they are the Screenshots
panel on the host page and "Screenshots along the way" in the report.

In the second pass they live in History, inline at the moment they arrived (C9). They are
also a grid filter (C10). Each artifact says what it was for: an ask's mockup with its
letter, a progress shot with its time, or a preview link marked "on this laptop only".

**Phones already receive every screenshot** in their state (`publicView` returns
`images`), but `BuildPlayer.jsx` shows only option images and the finals. A phone History
tab with decisions and pictures (C11) is front-end work only. Preview feedback ("Looks
good / Needs a change") moves onto the preview it is about.

## 8. What is new behaviour, and what is only layout

| Piece | Exists today | New |
|---|---|---|
| Queue of Claude asks, ideas, feedback | all three exist (proposed asks; ideas; ideas with AboutLogId) | showing them as one list; a "Later" state |
| Host's own queue items | — | a host-created idea (Source host) |
| Send to Claude from any item | ideas (`direct`), the log (`forAgent`) | the same for feedback and host notes |
| Put ideas to a vote | an idea can join an open Ideas ask (`suggest`) | create a Choose or Rate ask from selected ideas and mark them promoted |
| Mockups before the vote | a proposed ask can ask Claude for mockups; `share_image` fills each option | the vote is created proposed and waits; optional open-when-all-are-in, done on the server (C3b) |
| History chain | idea `promoted`; decision `chosen`; delivery `deliveredAt`; feedback `AboutLogId` | a `RelatesTo` on log rows, so idea → ask → decision → showing can be drawn |
| Four screens | Present toggle; the stage | the header, the Build frame, the History screen |
| Phone History tab | images and log already in `publicView` | the tab and gallery; "In a vote now" and "Sent to Claude" idea states |

## 9. Players and scores

Unchanged from the first pass (`scores.html`). Three options:

1. **Counts only.**
2. **Taking part and influence.** Recommended if points are wanted.
3. **Influence only.**

A People tab sits beside History on the Host screen. The second pass adds one candidate
rule to option 2: an idea put to a vote by the host +2, and +5 if it wins.

## 10. Every element, and where it goes

| Today | Second pass |
|---|---|
| Header: join code, joined count | Header join cluster |
| Header: Claude chip, connection chip | Header Claude status; the connection bar when it drops |
| Header: Auto switch, Connect Claude Code, Crew, Wrap up, Report, End | Header menu (Auto also on the Claude tab) |
| Present toggle, P | The four screens; P flips between Host and the last projected screen |
| Error bar | A toast on the Host screen that stays; the connection bar on every screen |
| How a Build Room works (first run) | The Now card, until Claude first posts |
| Review card (proposed) | The queue's top item; Edit opens the review fields in place |
| Ask Claude for mockups | On that item, as today; and a switch when putting ideas to a vote |
| Answer for the room | A route on a Claude ask; a button on the live Now card |
| The current ask (stage) | The Stage screen; summarised in the Now card |
| Edit wording, Open voting, Close, Reopen, Discard | The Now card (Close on the Stage dock too) |
| Suggestions with Hide/Show, add what the room said | The Now card for an Ideas ask (expand), and the composer's Log it |
| Decide panel | The Now card at results, with Adjust |
| JoinFoot QR + link, QrZoom | The Stage meter; header code (QR on hover, click to pin) |
| What next? (Tell Claude, Preview, Continue prompt, Ask the room) | The composer; Preview on the Now card; Continue on the Claude tab |
| Asks table | History, Decisions filter (with Reopen on the Host column) |
| Screenshots panel | History, Artifacts filter (C10), remove with the delete rule |
| Claude activity | The Now card (newest three) and the Claude tab (full) |
| Ideas inbox (new, handled) | The queue (Room filter); handled ones under Dismissed |
| Timeline + quick log | History; the quick log is the composer's Log it |
| Crew board, StageTabs | The Stage screen shows the crew board in crew mode |
| CrewIncoming, early look, tasks | Queue items (Crew filter); the Crew dialog keeps settings and tasks |
| Wrapped stage | The History screen's closing side column (C12) |
| Dialogs: Connect, Wrap up, Crew, Early look, End, Compose | Unchanged; Compose also opens from "Ask the room" |

## 11. Owner rulings so far (2026-10-05)

- **Mockups before a vote: auto-open is on by default.** With "mockups first", the vote
  opens to the room by itself when the last picture arrives. The host can turn it off per
  vote in the dialog (C3b shows that case).
- **The default vote is Pick one (A, B, C).** Pick up to 2 and Rate each stay available in
  the dialog.

## 12. Questions for the owner

1. **The shape.** One queue, one composer, one History, and four screens (Host, Stage,
   Build, History) in a header. Is that the direction?
2. **The Host screen on the wall.** On a mirrored projector the room can glimpse the Host
   screen, including the queue's ideas with names. Is that fine, or should a proposed
   ask's text and names be hidden until hovered?
3. **Switching screens for the host.** When an ask opens, should the room's view switch to
   Stage by itself? And when the host sends a direction, should it go back to Build?
4. ~~**Putting ideas to a vote.**~~ Answered by the owner, 2026-10-05: **Pick one (A/B/C)
   is the default**; Pick up to 2 and Rate each stay as choices in the dialog.
5. **The Build screen.** Is it fine that it needs a one-time browser permission and does
   not work in Safari, with the new-tab fallback? See PLAN step 0 for the spike.
6. **History on phones.** Show everything the wall shows, or decisions and pictures only?
7. **Scores.** Option 1, 2 or 3; on the wall or not; in the report or not (as in the
   first pass).
