# Host standards: what every engagement type should do

Written 16 Oct 2026, after the Call & Answer host redesign (session flow v3, phases 1–5,
the host console, results ideas first, Settings regrouped) reached test at `a76fda95`.

Call & Answer is the only type that does all of this today. This file states the rules it
now follows, names the code that holds each one, and says what each other type
(Trivia, Poll, Survey, Build Room) has and lacks. **It is the checklist for bringing
another type up to the same standard.** It is not a design for any one of them.

Each rule says where it lives. Reuse the module; do not copy its logic into a type's page.

---

## 1. Two screens: the room's window and the host's console

**The rule.** Where the room watches a separate window, that window shows only what the
room may see, and the host's laptop becomes private. Where the laptop *is* the room's
screen (one screen), everything on it is treated as public.

- **The room's window holds no state.** `/present?gameId=` renders from public reads
  only (`present/usePresentation.js`) and follows the server. A reload, a dropped
  network or a second copy on another computer lands on the same moment. It never
  imports the signed-in fetch, and no public read carries a private field
  (`tests/present-public-reads.js`).
- **The window reports itself.** It tells the server whether it is visible and full
  screen (`PRESENT_STATUS`). The host sees *on, full screen / open, not full screen /
  hidden / not open*, judged by the server's clock (`config/presentStatus.js`).
  `presenting > 0` is the one fact the laptop uses to know the room has its own window.
- **The laptop is a console, not a copy of the wall** (`components/console/`): top line
  (join code, Room's window ↗, status), the loop of steps, a left rail (queue, people,
  late items, tools) that opens the section the step needs, a main area for the host's
  work, and a footer with the one count, "Your part now" and the buttons.
- **The host chooses, and can change their mind.** Setup asks "Where will the room
  watch?" with a "Help me pick" (`config/roomScreen.js`). The same Screens group sits in
  Settings and at the top of Setup on the strip (`components/stage/ScreensGroup.jsx`),
  so a host can switch mid-session.
- **Which types have it** is one list: `TWO_SURFACE_TYPES` in `config/surfaces.js`.
  Adding a type there is the last step, not the first.
- **One app, different use cases** (owner, 17 Oct). A type joins by taking the shared
  parts (the console, the dock and action bar, the strip, the Screens group, the room's
  window) and supplying its own panels, words and the one function that decides its main
  button. It keeps every capability it had: what is its own lives inside the shared shell's
  panels, never beside it and never dropped to fit (`docs/design/parity/PLAN.md` §2.6, §2.6b).

**What a type needs before it joins `TWO_SURFACE_TYPES`:** a public state read for each
of its moments; a moment model the wall can render (`present/presentModel.js`,
`present/PresentMoments.jsx`); a console main area per step.

## 2. The loop: steps, one main button, "Your part now"

- **The strip** (`config/workflowStrip.js`, `components/stage/WorkflowStrip.jsx`):
  Setup › Round N › the round's steps › Finish. The full strip on the laptop, a slim one
  on one screen, a dot row on the Remote. Pressing a step *views* it privately; an amber
  "Viewing…" bar says where the room still is, and the main button becomes "Back to the
  room". Viewing never moves the room.
- **One main button per moment** (`config/roundStep.js`): every moment has exactly one
  primary and at most one secondary, and the laptop dock, the console footer, the Remote
  and the wall's controls all read the same function. Never decide the next action in a
  page.
- **"Your part now"** ends with the main button's own label (`RW.yourPart` in
  `config/roundWords.js`), so the sentence and the button cannot disagree.
- **Words live in one module per area** (`roundWords.js`, `lateWords.js`,
  `roomScreen.js`, `buildroom/words.js`) with parity tests. No user-facing sentence is
  written inline in a page.

## 3. Confirming: press twice, in place

- An early or lossy advance **arms the button in place**: the first press changes the
  label to "… anyway" and says why ("1 of 3 still writing", "Nobody has voted yet"); a
  second press within 6 s goes ahead; otherwise it settles back. No light modal.
  `arm: { text, confirmLabel, inPlace: true }` on the control; `HostActionBar` and the
  Remote honour it. **An arm without `inPlace` is ignored on the laptop** — that was the
  bug on a question for the room.
- Counts in arm words handle zero ("Nobody has answered yet") and pass the total.
- Real dialogs remain for destructive, irreversible actions only.

## 4. Settings: say when a change takes effect

- Every section carries its scope: **Applies now** or **From the next round**, and a held
  change shows "Waiting for round N". A setting never changes the live question, its
  answers or its ballots.
- Four groups, most used first: **Screens**, **Your phone as a remote**, **The rounds**,
  **Joining**; the rest folds away. A type adds its own sections inside "The rounds"
  rather than a new group.
- The phone remote's box says **who may sign in** (`config/remoteSignIn.js`, following
  the server's `callerMayDriveSession`) and shows an email only while the laptop is
  private (two screens **and** `presenting > 0`).

## 5. Fitting the screen: never scroll, never cut silently

The order, on the stage (`hooks/useStageFit.js`, `hooks/fitPolicy.js`) and on the wall
(`present/PresentStage.jsx`):

1. Shrink the type to the profile's floor (`--fit-min`; a larger profile never draws
   smaller than a smaller one).
2. Give up optional chrome (`[data-drop]`, cheapest first; the meter's column first).
3. Content-specific levers: clamp ideas to two lines; then, **on the wall only**, show
   the top rows and say "and N more ideas". Never the top row, never the heading.
4. Only then clamp, and mark it (`data-fit="miss"`, `data-clamped`).

Where content can outgrow a page, **page it** with a size per profile, measured, and a
printed position ("Responses 1–2 of 6 · page 1 of 3 · ↑ ↓"), never a scrollbar
(`config/stagePaging.js`; results have their own, smaller sizes). The stage refits when
the dock changes height. The text of each card has a pixel floor, so a page size is
the only lever that always holds.

**Measure, do not reason.** Every surface is measured in Chromium against the real
bundle with long content (six entries of 130–320 characters) at **1280×720, 1366×768,
1440×900 and 1920×1080**, on Room, TV, Call and Table; dialogs and sheets at **660 and
375 px** wide. Record the numbers in the commit.

## 6. What the room is shown

- **Only what the room needs now, large and readable** (owner, 17 Oct). One function
  decides it for every room screen, one screen and two, C&A and Build Room:
  `config/roomContent.js` `roomContentFor(moment, profile, data)`. While a question or
  lesson is up the title leads, the lesson sits under it and is never dropped, and the
  question to answer is one "Your turn" band; a generic instruction is left off (owner,
  18 Oct: "the instructions is the optional one"). Voting shows what is voted on; results
  put the bars behind the answers. Call may carry more (the generic line, an ask's detail,
  Workie's read beside the results); in a Build Room Claude's status is on
  every screen and never dropped. The decisions table is in the module's header and
  `docs/design/parity/PLAN.md` §2d.
- **Content before people.** Results lead with the ideas: the idea in full as the
  headline, a share bar relative to the top idea (a proportion, never a score, so it
  holds in hidden-name rounds), and a small credit line. Standings belong to the
  scoreboard, on demand (S, or the console's People section). The podium is for the end.
- **The host can always put the question back up** wherever they can put a response up.
- **The server owns what the wall shows.** Focus (a response, the question, the join
  code) is stored on the round (`question-focus.js`, `stage-focus.js`) and **cleared by
  the server on every phase change** that makes it stale, with a frame to every surface.
  A client never clears it alone.
- **The room never sees an email address**, and never a name in a round that hides
  names, on any surface.

## 7. Nothing that arrives late is lost

- An answer, an answer to a question for the room, or a comment that arrives after its
  moment is **kept, labelled and listed**, not refused (`late-window.js`,
  `late-labels.js`, `late-list.js`; words in `config/lateWords.js`). The person is told
  it was kept and whether it counts.
- Comments stay open until 24 h after the end; the host can **Close comments** sooner.
- The host's **Late & not reviewed** list offers *Show on the wall* and *Mark reviewed*;
  the report shows each round's **Arrived late**, with a setting to leave out what was not
  reviewed.

## 8. Privacy and identity

- Any id a client sees that is derived from a person (an idea id, a late reference) is
  **HMAC-SHA256 under a per-session secret** (`id-secret.js`, METADATA `IdSecret`, made
  lazily, never sent to a client). A plain hash ending in a name can be matched by
  anyone holding the roster.
- Host routes check `callerMayDriveSession`; a Remote sign-in follows the same rule.

## 9. Look and theme

- A surface painted dusk declares it: `data-theme="dark"` on its root, so its tokens
  match its paint under a light page (the session panel's Settings were unreadable in
  light mode until it did). See the `engage-design` skill.
- Tab rows and button rows wrap rather than run off the edge.

## 10. Shipping

- Backend suite, frontend suite, lint and build before every push.
- Walk it on dev in a real browser at the sizes in §5, with bot players
  (`docs/handoff/tools/dev-bot.js`).
- Before test: release notes, in-app help (`config/help/*.js`) and README.

---

## Where each type stands

| Standard | C&A | Trivia | Poll | Survey | Build Room |
|---|---|---|---|---|---|
| Two screens (`TWO_SURFACE_TYPES`) | yes | no | no | no | **partly (17 Oct):** the room's window is built (Session › Settings › Screens; public, no names, follows 2/3/4 from the server); the laptop console waits for the mockup review (B8) |
| Strip + one main button (`roundStep`) | yes | yes | yes | **no strip**; one primary per phase, but Closed and Ended carry two secondaries; words inline | no strip yet (Q17: the ask path); **one function (`buildControls`) feeds C&A's shared action bar** on the Stage |
| Press twice, in place | yes, except Skip | partly: Skip, Ask now, next question use dialogs | partly, as Trivia | no: Close the survey is a dialog (irreversible, allowed by §3) | **partly:** the Stage's early moves arm in place (shared bar); `window.confirm` and modal confirms elsewhere remain (B10) |
| Settings scope labels | yes | yes | yes | shown, but says "From the next round" with no rounds | the new Screens group says Applies now; the rest none (B10) |
| Fit order + measured paging | yes | stage only | stage only; **open answers cut at 6 silently** | walk-through fitted and paged | Stage on the fitter; the room's window measured (144 renders, nothing scrolls); long six-option asks page (17 Oct: ↑ ↓ on the Stage, "and N more options" on the window; 0 of 32 clamped) |
| Late items kept | yes | **kept on the server, unscored**; no rule for what they count | **kept on the server, unvalidated**; no rule | no (refused by design) | no: answers and votes refused; ideas always kept |
| Per-session id secret | Ideas, late refs; answer order is a plain hash (Q9) | late refs | late refs | n/a | not used: ids are random |
| Dusk theme declared (§9) | console and wall yes; one-screen `Stage` no | no (`Stage`) | no (`Stage`) | panels yes; `Stage` no | yes (page root) |

Audited 16 Oct 2026 against `3f07c0e4`; Build Room's column updated 17 Oct for what reached test at `50c2fe45`. Every cell's evidence, with `file:line`, is in
`docs/design/parity/PLAN.md` §1; the Q numbers are that plan's open questions.

### Trivia
Shares the round loop and the stage fitter already. For two screens it needs wall moments
for ASK (options, no answer marked) and RESULTS (the correct answer, the split per
option), and a console main area that shows the correct answer privately before the
reveal — the one thing on the laptop the room must never see on one screen.

### Poll
Shares the loop; the result fills in live on the wall (`PollBoard`). For two screens:
the wall moment for each poll kind (`POLL_KINDS`), with the fit order applied to long
choice labels. Late answers: decide whether a poll keeps them (it has no vote to protect).

### Survey
No rounds, so the strip would be Open › Collecting › Closed rather than round steps; **it
is not built** (survey controls bypass `roundStep`, so no strip renders). Late
answers are deferred by design (owner: surveys out of scope for phase 5). The wall's
walk-through (`SurveyWalkthrough`) already uses the fitter.

### Build Room
**Closest to two screens already.** One page carries four screens — Host, Stage, Build,
History (`buildroom/buildScreens.js`) — and P flips between Host and what the room saw.
Stage, Build and History are already "made to be shown to the room; nothing host-only
renders on them" (`PROJECTED`). So the two-screen version is: open the projected screens
in their own window on the second monitor while the laptop stays on Host.

What that needs:
1. **A public read for the projected screens.** Today they render inside the host's
   signed-in page from host data. A window on the projector must not hold the host's
   session: give Stage / Build / History a public, state-free read like
   `/present` (§1), or route `/present` to a Build Room renderer.
2. **The room's choice of screen moves to the server**, as the wall's focus did (§6),
   so the window follows the host's 2/3/4 keys instead of the laptop's local state.
3. **Window status** (`PRESENT_STATUS`) and the Screens group in the Build Room's
   session panel.
4. Then add `'build'` to `TWO_SURFACE_TYPES` (or its Build Room equivalent).

The audit found two more: the projected screens still carry host controls (the Stage's
dock, picks, Share demo), which must move onto Host as a "Room's dock" read from the same
`stageModel`; and screenshots are private today, so the wall needs its own image read.
The phased plan, tasks and open questions are in `docs/design/parity/PLAN.md` §2.

## Opening the window on the second display for you (built 16 Oct 2026)

`present/roomWindow.js`, used by every "Room's window" link through
`components/stage/RoomWindowLink.jsx` (console top line, Screens group, the Setup
chooser, the dock's PRESENT). Where Chrome or Edge offers the **Window Management API**
and `screen.isExtended` says a second display is attached, a plain click:

1. opens the room's window as a popup **inside the click** (a popup opened after an
   `await` is blocked), with `placed=1`;
2. asks `getScreenDetails()` (the browser asks the person once: "manage windows on all
   your displays") and moves and resizes the popup to fill the other display: never the
   one the laptop page is on, an external one before a built-in one, then the largest;
3. on that window, the **first click goes full screen** (`useClickToFill` in
   `PresentPage.jsx`); a page may only go full screen from a click inside itself, so
   this is the one step placing cannot do. The laptop's window status confirms it.

Anything else (another browser, one display, a modified or middle click, a blocked popup,
a refused permission) falls back to the plain link and "drag it to the projector, press F".
Measured in Chromium with two emulated displays (`--screen-info={1440x900}{1920x1080}`):
the window lands at x=1440, 1920×1080. Any type that joins `TWO_SURFACE_TYPES` gets it
by using `RoomWindowLink`.
