# Build Room host redesign: rationale

Design only, 2026-10-05. Nothing in `src/` changes in this task. The mockups in this
folder are the design (see `index.html`); this file records why they look the way they
do, what was measured, and what the owner still has to decide.

**Viewing:** `python3 -m http.server 8131 --directory docs/design`, then open
`http://localhost:8131/build-room-host-redesign/`. Add `#s1` or `#s2` to any page's URL to
see one screen alone, fitted to the window. Rebuild with
`python3 docs/design/build-room-host-redesign/_src/build.py`.

---

## 1. The owner's brief, restated

> "too much to take in … requiring the host to scroll up and down … keep things minimal
> on the screen … much of the mechanics are here … When can something be collapsed or
> simplified?"

The mechanics stay. What changes is **when** each one is in front of the host and
**where** it lives. Nothing the host can do today is removed (§6 maps every control to
its new place).

## 2. What today's page does, measured

Rendered from fixture state built by the real backend's pure half (`build-store.js`
`roomFromRows` + `hostView`, the shape `GET build/state` returns) with the real
stylesheets, at 1440×900. The renders are in `today/` and on `00-today.html`.

| State | Page height | Header | Stage starts | Host acts at | Buttons |
|---|---|---|---|---|---|
| Claude building | 1260px | 147px (three rows) | 163px | What next? 680–982px | 29 |
| Claude proposes an ask | **1866px** | 147px | **878px**, below the fold | Review card 163–862px | 34 |
| Live ask | 1260px | 147px | 163px | top of the stage | 33 |
| Results to decide | **1822px** | 147px | 163px | Send to Claude ~1100px | 38 |

The fixture is small (four asks, two ideas). A real hour adds an asks table and a
screenshot grid under everything above.

The cause is not any one panel. It is that **every panel is open in every state**: eleven
header controls, three panels under the stage (What next, Asks, Screenshots), and three
in the right column (Claude activity, Ideas inbox, Timeline with its own form). Nothing
tells the host what matters now, and the thing that matters now moves: the review card
pushes the stage down, and the decide panel sits under the stage.

What I could and could not see: I rendered the host page in four states with fixtures
and measured them in the browser pane. I did not sign in to dev or run a live session;
crew, wrapped and ended states were read from the code, not rendered.

## 3. What the other engagement types already do

The regular host stage (`GameHostPage.jsx` + `components/stage/`) solved this problem
once. Its rule, from the code comment at the stage: everything the room sees is inside
`<Stage>`; everything only the host needs is a fixed panel over it, **opened deliberately
and closed by advancing**. CRITIQUE §4 praises "separating the two audiences
*temporally* rather than spatially".

Its parts:

- **Rail** (`Rail.jsx`): phase chip, title, context, join cluster. The code previews the
  QR on hover and pins it on click.
- **Phase bar**: one colour per phase.
- **Main + RoomMeter**: the content, and an answered/voted count in a side column.
- **Dock** (`Dock.jsx`): a room-safe status line, one primary action with its key
  (Space), one secondary, and `SESSION`. The dock is a no-overlay zone (audit A6).
- **Drawer** (`SessionSetupPanel`, `styles.css:480+`): `min(560px, 44vw)`, `#111D33`,
  2px `--primary` edge. It overlays and stops at the dock. Its tabs are Players,
  Questions, Rounds and Settings, and `\` opens it.
- **HostRemote** (`/remote`): the host's second screen on a phone, laptop or tablet.
- **No toasts** anywhere (GameHostPage.jsx says so in a comment).

Today's Build Room uses none of these. It is a dashboard page with a Present toggle. The
redesign brings it onto the same grammar, so a host who has run a trivia round already
knows where everything is.

## 4. The attention model

Four rules. Each mockup follows all four.

**1. The screen is the room's by default.** The rail, the stage and the dock's status
line are room-safe in every state. Host-only things are either inside the drawer
(opened on purpose) or are numbers and buttons in the dock that mean nothing to a reader
at the back of the room.

**2. There is always exactly one next move, and it is always in the same place.** The
dock primary, bottom right, with a key. The order of precedence is:

| When | Dock primary | Secondary |
|---|---|---|
| The connection is down | Reconnect / Sign in again | — |
| Results are showing | Send to Claude (the sheet) | — |
| An ask is live | Close and show results (Space) | Answer for the room |
| Ideas ask, collecting | Open voting (Space) | Answer for the room |
| A proposed ask is waiting | Review ask N (R) | — |
| Crew board, a share waiting | Open the early look | Room asks |
| Between asks | Tell Claude (T) | Ask the room |
| Wrapped | Open the demo | Edit the wrap-up |
| Ended | Open the report | Edit the wrap-up |

A proposed ask that arrives while another ask is live does not take the primary. It
shows as a dashed amber "Ask 4 waiting for you" chip beside the status line, which
matches the dashed amber edge of the proposed card.

**3. What arrives is a notice first and a panel second.** An idea, a join, preview
feedback or a Claude post does not grow a panel on the page. It raises a badge, may show
a short toast, and lands in the drawer tab where it is handled. See §5.

**4. Words open where the decision is.** A direction for Claude, an answer for the room
and a Tell Claude message all need typing. They open as a **sheet** that grows up out of
the dock and leaves the stage above it in view. The host decides while looking at the
results; they are not covered (the container rule: stay inline when a modal would cover
the thing being judged).

### What is always visible, what collapses, and when

| Always (every state) | Collapsed until needed | Only in its state |
|---|---|---|
| Rail: phase, title, join code | The drawer and its five tabs | Review card (Asks tab, proposed) |
| The stage | Edit question and options (accordion) | The direction sheet (results) |
| The dock: status, one primary, HOST badge | Decide → Adjust (chosen, fold in, note, record only) | The spoken sheet (answer for the room) |
| The answered count (meter column) | Asks, Timeline, Screenshots (Record tab accordions) | Crew tab (crew on) |
| | Handled ideas, directions sent | Host bar (connection down) |

### Present (P)

Present stays, with the same key and the same test, but it hides much less, because the
default screen is already close to it. In Present the dock keeps its status line and the
HOST badge (a number), no toasts are drawn, and pressing `\` or HOST leaves Present and
opens the drawer in one move.

## 5. Notices

Full catalogue on `notices.html`. In short:

- **Four tiers.**
  - Ambient: a badge or a count only.
  - Info: a toast for 8s, with the one action that answers it.
  - Action: the item takes the dock and stays until handled.
  - Alert: a host bar or an error toast that stays until dismissed.
- **What triggers one:**
  - someone joined (batched every 20s);
  - an idea arrived;
  - preview feedback (batched per preview);
  - everyone has answered;
  - Claude proposed an ask;
  - Claude is showing something (a preview is ready);
  - Claude has your direction;
  - Claude went quiet when it was expected to act;
  - a crew early look arrived;
  - the connection dropped, the sign-in ran out, or the laptop went offline;
  - an action failed.
- **Stacking.**
  - At most three toasts, newest on top. Older ones fold into "+ N more in the drawer".
  - Notices of the same kind merge ("Jo and Lee sent ideas").
  - Toasts sit in the stage's meter column, under the answered count. They never cover
    the count, the question or the dock. When the drawer is open they move left of it.
- **Acknowledging.**
  - Every toast has an X.
  - Opening the tab a notice points to marks it read and clears its share of the HOST
    badge.
  - Clicking a toast's body opens that tab with the item highlighted.
- **Projector-safe.**
  - No toast is ever drawn in Present.
  - The room learns of each event through the stage it already reads: the count rises,
    the ticker grows, the screenshot changes, the ask opens.
  - Ideas and feedback carry names and never reach the wall, as today.
- **No Notices tab.** A notice points to something that lives in a tab (an idea in
  Ideas, a join in People). A sixth tab would hold a second copy of each. Layout A, which
  has room to spare, does show a Notices feed. This is owner question 3.

## 6. Every element, and where it goes

"Who": R = the room on the projector, H = the host alone. "How often" is per session.

| Element today | Who | When / how often | Where in B |
|---|---|---|---|
| Title, goal | R | always | Rail (goal as context or on the idle stage) |
| Join code | R | always | Rail join cluster; hover shows the QR (as Rail.jsx) |
| Joined count | R+H | always | Meter column on the stage; People tab |
| Claude Code chip | H (R reads it) | always | Stage line "Claude is building / listening"; Claude tab status |
| Connection chip | H | rarely matters | Host bar when not live (B14); drawer header "Live" |
| Auto-open switch | H | once per session | Asks tab, beside the review it skips; also in Claude tab |
| Connect Claude Code | H | once, at start | Claude tab; the first-run How it works panel keeps its button |
| Crew / Open to a crew | H | once | People tab footer (open); Crew tab (while on) |
| Run crew code switch | H | once | Crew tab |
| Wrap up, Report, End session | H | once each | Drawer footer "Session" row; dock primary when wrapped/ended |
| Present toggle | H | a few times | Drawer footer; P key (unchanged) |
| Error bar (with Reconnect / Sign in again) | H | rare | Error toast (stays) or host bar for connection |
| Ended notice bar | R+H | once | Dock status line (B8) |
| How a Build Room works (first run) | H | first session | Stays, in the stage area, until Claude has posted |
| Stage tabs (Room asks / Crew board) | R+H | crew only | Dock secondary (one switch) |
| Review card (proposed) | H | per Claude ask | Asks tab, first; edit fields in an accordion |
| Ask Claude for mockups | H | per choice ask with no preview | Inside the review card, unchanged |
| Answer for the room (proposed/live) | H | sometimes | Review card button; dock secondary when live; opens the spoken sheet |
| Current ask on the stage | R | per ask | Stage, unchanged in content, at the Room ladder |
| Edit wording / Open voting / Reopen / Discard (stage) | H | rare except Open voting | Open voting = dock primary for an Ideas ask; others on the ask's row in Asks |
| Stage hint line | H | every state | Gone from the stage; the dock primary and the sheet's sub-line carry it |
| Suggestion Hide/Show, who said it | H | per suggestion | Asks tab, the open ask's row expands to its suggestions |
| Add what the room said (suggest) | H | sometimes | Same place, and the Record tab's quick log |
| Decide panel | H | per ask | The direction sheet (B4); Adjust holds every control |
| JoinFoot QR + copy link + count | R | always | Meter column (QR box), rail code; People tab has Show QR / Copy link |
| QrZoom | R | at the start | Unchanged; from the rail code or the meter QR |
| What next? Tell Claude | H | between asks | Dock primary "Tell Claude" opens the Tell sheet (B11) |
| Preview the work | H | a few times | Claude tab; and a toast action when a preview lands |
| Copy the Continue prompt | H | when Claude is quiet | Claude tab; the "Claude went quiet" toast |
| Ask the room (Ideas / Choose / Rate) | H | a few times | Dock secondary between asks; Asks tab |
| Asks table | H (R in Present) | reference | Record tab and Asks tab, accordion |
| Screenshots panel | H | reference | Record tab accordion |
| Claude activity (live) | R newest line, H list | always while building | Stage "Right now" line; Claude tab, full list |
| Ideas inbox | H | per idea | Ideas tab; toast on arrival |
| Preview feedback | H | per preview | Ideas tab, grouped under the preview |
| Timeline + quick log | R (filtered) H (full) | reference | Record tab; the wall's filtered timeline is unchanged in Present |
| Crew incoming / early look / tasks | H | crew only | Crew tab; newest share is the dock primary |
| Dialogs (Connect, Wrap up, Crew, Early look, End, Compose) | H | rare | Unchanged: they are already the right container |

## 7. Two layouts, and the recommendation

**B: one screen, stage first, a host drawer (recommended).** Pages B1–B14.

**A: two screens.** A1 and A2 show a control console on the laptop and a separate stage
window on the projector. A3 shows a Build Room remote on a phone, laptop or tablet.

| | A (console + stage window) | B (stage + dock + drawer) |
|---|---|---|
| Mirrored projector (the common room) | Shows the console to the room; needs Present, today's problem | Works: the default screen is room-safe |
| Extended display or screen share | Best: everything open, nothing hidden | Good: share the window; open the drawer when needed |
| One laptop, no projector (a call) | Two windows to arrange every session | One window |
| Matches regular sessions | No; a new grammar | Yes: rail, dock, drawer and `\` |
| Build cost | Two layouts kept in step | One layout; the panels are reusable |
| Focus | Everything open at once, which is the clutter again with more room | One next move, in one place |

**Recommendation: B now, with A3 (the remote) as a later step.** B fixes the reported
problem on the hardware most hosts have, and it teaches nothing new. Its drawer panels
are self-contained, so they can later mount in a Build Room view of `/remote`. That
remote is the real answer for a host whose laptop mirrors to the projector. The console
(A1) is not worth a second layout: it is today's page with more width.

## 8. Players and scores (proposed, not built)

Details are on `scores.html`. Three options:

1. **Counts only.**
2. **Taking part and influence.** Answer 1; idea or suggestion 2 (at most 3 counted per
   ask); preview feedback 1; a suggestion that wins or is chosen +5; an idea that is used
   +3.
3. **Influence only.**

Every rule is countable from rows that exist today. Points never reward picking the
winning option. The People tab (B9) works with any option.

Two of these touch earlier owner rulings:

- **The wall.** The scoreboard is Trivia and Call and Answer only (2026-09-25).
- **Anonymity.** A named +5 on the wall would hint who wrote a winning anonymous
  suggestion. The owner accepted the same side effect for trivia.

## 9. Questions for the owner

1. **Layout.** B (one screen, rail + dock + drawer, like regular sessions) with a Build
   Room remote later, or A (a control screen plus a separate stage window) now?
2. **The mirrored projector.** With the drawer open on a mirrored laptop, the room sees
   it. Should the review card in the Asks tab show a proposed ask's question only after
   the host clicks Review? The mockup does. Or is the room seeing a draft question fine?
3. **Notices.** Toasts plus badges that point into the tabs (recommended), or also a
   sixth "Notices" tab listing everything recent?
4. **Join toasts.** A batched toast for joins ("Wen and 2 others joined"), or the count
   only?
5. **Scores.** Option 1, 2 or 3? On the host's screen only, or on the wall through the
   scoreboard (which would extend it beyond Trivia and Call and Answer)? In the report?
   Points for crew builders?
6. **Claude's activity on the wall.** The newest line ("Editing src/Header.jsx") sits on
   the stage today and in the mockups. Keep it for the room, or host-only?
7. **The remote.** Is a Build Room view of the phone/tablet remote worth building after
   B (PLAN step 9)?
