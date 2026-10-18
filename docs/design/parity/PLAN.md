# Parity: bringing Trivia, Poll, Survey and Build Room up to the host standards

Written 16 Oct 2026 on `working/parity-plan`, branched from `working/build-room-host-redesign`
at `3f07c0e4`.

**Status, 17 Oct 2026.** On test at `50c2fe45` (dev `448d260a`), with release notes:
H1–H5 (History marks), the Share demo fixes (host link, plugin 1.19.0 scopes, 1.20.0
labels and per-session ports: §2b S1–S3), B1–B7 (the room's window and its server), D1–D2
(the still dock on C&A's shared parts). The owner ruled on every open question through Q19.
**Waiting on the owner:** the console mockup and its five questions
(`docs/design/build-room-console/`, gates B8); (remote share is being built by another session from the design the owner approved on
16 Oct, `docs/superpowers/specs/2026-10-16-build-room-remote-share-design.md`; this plan's
`DESIGN.md` is superseded); three small rulings (the label on
the share's locked page, a cloned repo's `share.json`, a player's own "why" on the wall).
**Ready without a ruling:** the two phone leaks the wall work found (an unseen ask named in
the timeline, mockups of draft asks), paging long asks (B9m), the laptop's codes card
following the server, D3 on the signed-in page, and the demo QR and Copy carrying a join
link instead of the share key. **Not started:** B8–B10, Trivia, Poll, Survey (§4).

Inputs: `docs/design/host-standards/README.md` (the standards, and the table this plan
corrected), `docs/design/two-surface/PLAN.md`, `docs/superpowers/specs/2026-10-15-host-console-design.md`.

Paths are relative to the repo root; `src/src/` is the frontend. Every claim about today's
code carries a `file:line` read on this branch.

---

## 0. Summary

| Phase | What | Template resources | Owner can test on dev |
|---|---|---|---|
| **D1–D3** | **The dock holds still; HOST always goes back to Host**, by Build Room taking C&A's shared dock and console (§2a, §2.6; owner 17 Oct). Lands with B6–B9 | 0 | Hover the dock and change moments: no button moves; one click on HOST from the Stage |
| **H1–H5** | **Build Room History: every used contribution and every ask, marked when a version went to Claude** (§2.8) | 0 | Send an idea, vote on ideas, combine two decisions: History shows each with its mark |
| **B1–B9** | **Build Room two-screen mode** (§2) | **0** (both build routes are `{proxy+}`) | Open the room's window on the projector; 2/3/4 on the laptop move it; the laptop stays on Host |
| B10 | Build Room's other standards: in-place confirms, scope labels, late answers, theme already done (§3) | 0 | Press twice instead of dialogs; Settings say when a change applies |
| T1–T5 | Trivia on two screens (§4.1) | 0 | A trivia round with the wall on the projector; the correct answer only on the laptop |
| P1–P4 | Poll on two screens (§4.2) | 0 | A poll on the wall; open answers paged, never cut |
| S1–S4 | Survey: the strip, the words, then two screens (§4.3) | 0 | Open › Collecting › Closed on the strip |

**Why Build Room first holds up, with one correction.** The owner's reading is right about
the *shape*: the four screens already exist (`buildroom/buildScreens.js:17-25`) and the
projected three are already drawn as room-safe. What makes it more than a toggle is that
**all three projected screens are drawn today from the host's signed-in read and still
carry host controls**:

- Every screen renders from one `authFetch` read, `GET games/{id}/build/state`
  (`buildroom/buildHostApi.js:45,91`), whose `hostView` carries player names, idea authors,
  voters, decision notes and the LAN key link (`lambda-functions/game/build-store.js:1489-1527`).
  The page hides names in components, not in data (`BuildRoomPage.jsx:2750,2773,2805`).
- Screenshots are private, read only through the signed-in route
  (`buildHostApi.js:74-83`; template comment `template-clean.yaml:4302-4304`).
- The Stage carries the host's dock (primary, secondary, extras, Host alert, SESSION:
  `BuildRoomPage.jsx:2092-2104`), clickable picks that open the decide window
  (`:2037-2045, :2111-2113`); Build carries **Share demo** (`:2150-2152`).
- "Which screen the room sees" is React state on the laptop (`BuildRoomPage.jsx:395-400`),
  with no server field anywhere (`build-store.js`, `build-room.js`: no screen/focus state).
- There is no seatless public read: every `/build-play/*` call needs a `PLAYER#` row and
  a matching clientId, else 403 (`build-room.js:2779-2784`, `playerFrom` `:261-271`).

So the work is: a wall read with no host data, a server-owned wall screen, the projected
screens split from their controls, and the controls moved onto Host. All of it fits inside
the existing `BuildRoomFunction` routes, so **the template does not change**.

---

## 1. Audit results (the table, corrected)

The table in `docs/design/host-standards/README.md` is updated in the same commit. Each
changed cell, with the evidence:

### Survey ("not checked" cells)

| Cell | Was | Is | Evidence |
|---|---|---|---|
| Strip + one main button | not checked | **No strip; one primary per phase, but two phases carry two secondaries** | Survey bypasses `roundStep`: `hostControlsFor` routes it to `surveyControlsFor` (`config/hostControls.js:816-837`); `momentOf` reads `SURVEY#` as OTHER (`config/roundStep.js:87`). `surveyControlsFor` returns no step, so `workflow` is null (`GameHostPage.jsx:6952-6954`) and `LIVE_STEP` has no OTHER entry (`config/workflowStrip.js:21-34,113-114`). CLOSED and ENDED offer What We Heard / See the results / Walk through (`hostControls.js:559-567, 582-591, 915-931`). Labels are inline in `hostControls.js`, not in a words module. The README's "Open › Collecting › Closed" strip does not exist. |
| Press twice, in place | not checked | **No** (one dialog, which §3 permits) | Close the survey carries `confirm` with `irreversible: true` (`hostControls.js:361-373, 548`) and renders as `ConfirmDialog` (`GameHostPage.jsx:7105-7111, 6171-6189`). No survey control has `arm`. Closing cannot be undone, so the dialog is allowed by §3. |
| Settings scope labels | not checked | **Shown, and wrong** | One generic `scope(keys)` helper labels sections (`SessionSetupPanel.jsx:286-296`; words `roundWords.js:190-192`). Changes are held only in `ASK#/VOTE#/RESULTS#` (`GameHostPage.jsx:738, 752-761`), so on a survey a Feedback change applies at once but is labelled "From the next round". |

### Build Room ("not checked" cells, and the rest of its column)

| Cell | Was | Is | Evidence |
|---|---|---|---|
| Press twice, in place | not checked | **No** | `window.confirm` ×5 (`BuildCrew.jsx:243,723,745`; `BuildRoomPage.jsx:4069,4250`); modal confirms ×7 (`PickConfirm` `BuildRoomPage.jsx:2675`, `EndDialog` `:4107`, `StartBuildingConfirm` `BuildOpening.jsx:197`, `RunConfirm` `BuildRun.jsx:83`, `TakeDownOffer` `BuildPointStage.jsx:51`, the crew code switch `BuildCrew.jsx:190-208`, Discard `BuildStageDecide.jsx:209-215`). In-place only for Delete entry (`BuildRoomPage.jsx:3474-3486`), Remove screenshot (`:3157-3166`) and re-mint (`:3821, 3963`). No `arm`/`inPlace` anywhere in `buildroom/`. |
| Per-session id secret | not checked | **Not used; ids are random** | `id-secret.js` users are only `followups.js`, `followup-store.js`, `late-list.js`. Build ids are `crypto.randomBytes(6)` (`build-store.js:304`), time keys (`:306`), counters (`build-room.js:293-294`). Server-side answer and vote sort keys embed the plain player name (`build-store.js:314-315`), as do builder seats (`build-crew.js:38`). Nothing a client sees is a hash of a name, so the rule is met by randomness; the plain-name keys stay server-side. |
| Strip + one main button | no (own `buildScreens`) | **No strip; one function decides the Stage's moves** | `stageModel` returns one primary and at most one secondary per moment, plus `extras` for the run list (`buildScreens.js:370-508`, extras `:400`). It does not use `roundStep`/`workflowStrip`/`HostActionBar` (none imported in `buildroom/`). |
| Settings scope labels | own panel | **None** | `BuildSessionPanel.jsx` has Players and Settings tabs (`:353-354`) and groups The room / Claude / Crew / This session (`:419-489`) with no scope labels. |
| Fit + paging | not measured | **Stage only** | The Stage screen uses `components/stage/Stage` → `useStageFit` (`Stage.jsx:52`; `BuildRoomPage.jsx:2063-2109`). Build and History do not (`BuildRoomPage.jsx:2130-2168, 2254-2323`), and nothing in `buildroom/` pages (`stagePaging`) or marks a miss (`data-fit`). |
| Late items kept | no | **No, except ideas** | Answers after close: 409 (`build-room.js:2832, 2835`); votes outside voting: 409 (`:2863`). Ideas are always kept (`:2801-2827`). Respond/vote writes are unconditioned `put`s checked against the room as read at `:2799`, so an answer racing a close can still land. |

### Cells marked "yes" or "no" that the code contradicts

| Cell | Was | Is | Evidence |
|---|---|---|---|
| Late items, Trivia and Poll | no | **Kept on the server; no host decision on what they count for** | `handlePlayerAnswer` checks lateness before any type branch (`websocket/message.js:455-462`) and stores any type's late answer (`keepLateAnswer`, `:755-791`). `answerTiming` has no type check (`websocket/late-answer.js:17-25`). Trivia scoring and poll validation run only after that branch, so late trivia is kept unscored and late poll unvalidated. |
| Press twice, Trivia and Poll | yes | **Partly** | Advances arm in place (`roundStep.js:157-177, 182, 230-236, 303`). Skip's arm has no `inPlace` (`roundStep.js:261, 280`) and becomes a `ConfirmDialog` on the laptop (`hostControls.js:809-814, 826-828`). Ask now and next question also use dialogs (`GameHostPage.jsx:4540-4546, 4711-4719`). Same for C&A's Skip. |
| Fit, Poll | stage only | **Stage only; open answers cut silently** | `PollBoard` draws `TEXT_ON_WALL = 6` open answers (`components/stage/PollBoard.jsx:31, 48`) with no pager and no "and N more", against §5. |
| Per-session id secret, Trivia and Poll | — | **Late refs only** | `late-list.js:53,146,345` keys late refs under the secret for every type. |
| Per-session id secret, C&A | Ideas, late refs | **Also: the room's answer order is a plain hash of the author** | `game/answer-order.js:59-62` is `sha256(gameId#round#author)`. Anyone with the roster and the public `/answers` order can test which name is "Response N". Not in scope here; listed as Q9. |

### A row the table lacked: the dusk theme (§9)

The one-screen `Stage` is painted dusk but does not declare it: `<main className="stage">`
(`components/stage/Stage.jsx:98`) re-sets five tokens in CSS (`styles/stage.css:1309-1313`).
That stage carries C&A on one screen, Trivia, Poll and the survey's live screens. Declared:
the session panel (`SessionSetupPanel.jsx:473`), survey panels (`SurveyResultsPanel.jsx:62`,
`SurveyOpenAnswersPanel.jsx:38`), the console (`HostConsole.jsx:38`), the wall
(`PresentStage.jsx:179`) and Build Room's root (`BuildRoomPage.jsx:999`).

---

## 2. Build Room two-screen mode

### 2.1 What it is

```
LAPTOP (the shared host console, private)             PROJECTOR (/present?type=build…)
┌───────────────────────────────────────────────┐     ┌──────────────────────────────────┐
│ Join 7924 · Room's window ↗ · ● on, full screen│     │ Stage / Build / History,          │
│ The room sees: [Stage] [Build] [History]  2 3 4│ ──▶ │ drawn from a public wall read,    │
│ rail │ Build Room's panels (Now, the ask path…) │     │ following the server's choice.    │
│ footer: status · Your part now · [2nd] [MAIN]  │     │ No buttons. Reload lands on the   │
└───────────────────────────────────────────────┘     │ same screen.                      │
                                                      └──────────────────────────────────┘
```

- **One screen is unchanged.** Host / Stage / Build / History on one page, P and 1–4 as
  today, the Stage's dock on the Stage.
- **Two screens:** the laptop stays on Host. 2 / 3 / 4 (and the "room sees" chips) write the
  wall's screen to the server; the window follows. P is not needed (Q4).
- The laptop is C&A's shared host console with Build Room's panels (§2.6). Its footer's
  buttons and the one-screen Stage dock's come from one function, `buildControls`, so the
  two can never disagree. Nothing the Host screen does today is lost (§2.6b).

### 2.2 The wall read (public, stateless, no host data)

A new branch in `routePlay`, **before** the seat check (`build-room.js:2779-2784`):

| Route | Auth | Returns |
|---|---|---|
| `GET /games/{id}/build-play/wall?k=<wallKey>` | none; `k` must equal `BUILD#STATE.WallKey` (Q1) | `wallView` |
| `GET /games/{id}/build-play/wall/images/{imageId}?k=<wallKey>` | as above | the image, only if `wallView` lists it |

Both ride the existing public `build-play/{proxy+}` GET event (`template-clean.yaml:4342-4347`).
**Resource impact: 0.**

`wallView` (new, `build-store.js`) is an **allowlist**, built for exactly what the three
projected screens read. It starts from `publicView` (`build-store.js:1530-1582`, already
nameless) and changes it:

| Field | From | Note |
|---|---|---|
| `gameId, title, state, playerCount, rev` | as `publicView` | |
| `current` | `askView(ask, 'public')` (`build-store.js:620-640`) | no voters, no why names |
| `asks` (decided only) | **new `askView(ask, 'wall')`**: prompt, kind, options (label, title, detail, imageId), result counts, decision {direction, chosen, method, sentToAgent, heldForLater, deliveredAt, decidedAt}, `fromIdeas` as a count, `fromQuestion`, `source` | History's "Decided so far" and `decisionChain` read these (`buildScreens.js:768-792`). Never `decision.note`, `claudeNote`, `claudeGets`, voters |
| `log` | `publicView`'s filtered log (`build-store.js:1561-1567`) | no notes, no directions |
| `images` | as `publicView` | only ids the wall may fetch |
| `outcome, doing, shownPoint, run, lan` | as `publicView` (`lanPublicView`, never the key link) | |
| `opening` + the **agreed** brief | new subset | `WallBrief` reads it; never `briefDraft` or `brief.later` |
| `ideaCounts` | `{ total, used }` | History's "Made so far" (`BuildRoomPage.jsx:2263-2264`); never idea text or authors |
| `players` | names **only** when the `listNames` setting is on | the Stage meter's opt-in list (`BuildRoomPage.jsx:2014-2017`) |
| `wallComment` | only while fresh (`WALL_COMMENT_MS`, `BuildRoomPage.jsx:3770-3775`) | the host chose it for the wall |
| `crew` | the crew board as `CrewBoard host={false}` reads it (`BuildRoomPage.jsx:2027`) | Stage's crew board. B2 first lists what the phones' crew reads carry; crew log lines name builders (`build-room.js:2754`), see Q12 |
| `wall` | `{ screen, codes, profile, rev }` (§2.3) | |

Never in it: `seen`, `ideas`, `activity`, `points.items`, `settings` beyond `listNames`,
`plugin`, any email, `IdSecret`, the agent key.

### 2.3 The server owns which screen the room sees

New attributes on the existing `BUILD#STATE` row (written through `touchState`,
`build-store.js:122-149`, which keeps the row's TTL):

- `WallScreen`: `stage | build | history` (default `stage`).
- `WallCodes`: `none | join | both`: the codes card that is local today (`codesUp`,
  `BuildRoomPage.jsx:2021-2022`).
- `WallProfile`: `room | tv | call | table`: today per browser (`loadProfile(window.localStorage…)`,
  `BuildRoomPage.jsx:1914`). The window must not hold its own choice.
- `WallRev`: `ADD 1` on every write; the wall drops an older rev.

Written by a new host route `POST /games/{id}/build/wall` `{screen?, codes?, profile?}`
inside `routeHost` behind `hostOnly()` (`build-room.js:2642-2725`). Rides the existing
`build/{proxy+}` POST event. **Resource impact: 0.** It announces `buildChanged` (`toAll`,
`build-room.js:151-153`), which already reaches every connection on the session,
`/present` viewer rows included (`survey-broadcast.js:16, 80`).

**Cleared by the server, never by a client alone** (§6 of the standards):

| Event | Server sets |
|---|---|
| An ask opens (respond/vote becomes live) | `WallCodes = none` (the codes card yields to the ask) |
| The session ends | `WallCodes = none`; the wall draws `ENDED` from `state` |
| Back to the opening | `WallScreen = stage` |

The wall's History filter stays local to the window and fixed at **Everything**; there is
no one at the projector to press it (Q5).

### 2.4 The window: `/present?gameId=…&type=build&k=…`

One URL family for "the room's window", so `RoomWindowLink`, `roomWindow.js`'s shared
window name (`present/roomWindow.js:23`), `placed=1` and `useClickToFill`
(`PresentPage.jsx:48-74`) all apply unchanged. `PresentPage` dispatches on `type=build`
to a lazy `BuildWall` before it starts `usePresentation` (whose reads are C&A's and whose
`FOLLOW_FRAMES` lack `buildChanged`, `usePresentation.js:43-48`).

`useBuildWall(gameId, k)`:

- reads `build-play/wall` only; images through `build-play/wall/images/…` via an
  `ImageLoader` provider (today's loader is signed in, `BuildRoomPage.jsx:388, 996`);
- connects with the same viewer socket as `/present` (`viewer=present&viewerId=…`,
  `WebSocketClient.js:50,66-67`; `connect.js:20-26, 71`), so it never counts as a player
  and never as a host;
- refetches on `buildChanged`, on `online` and `visibilitychange`, debounced 400 ms; polls
  every 8 s as the host page does (`BuildRoomPage.jsx:599`);
- sends `PRESENT_STATUS` exactly as `usePresentation` does (`usePresentation.js:199-223`),
  by sharing that code (extract `present/presentStatusReporter.js`), not copying it.
- 403 (bad or retired key) shows "This window's link has changed. Open the room's window
  again from the laptop."; 404 shows the existing "ended or the code is wrong".

**The import rule.** The wall must never import the signed-in fetch. Today
`buildScreens.js` imports `safeHref` from `buildHostApi.js` (`buildScreens.js:13`), which
imports `authFetch` (`buildHostApi.js:17`): a wall built on `buildScreens.js` would pull the
signed-in fetch into its bundle. Move `safeHref` to a pure `buildroom/links.js`, re-exported
from `buildHostApi.js` so nothing else changes. The existing guard reads only `present/`
files one level deep (`__tests__/presentStage.test.jsx:216-226`); add a **transitive** import
walk from `present/build/BuildWall.jsx`.

### 2.5 The projected screens, split from their controls

`BuildStage`, `BuildScreen` and `HistoryScreen` live inside `BuildRoomPage.jsx`
(`:1913, 2130, 2254`) and take `api`, `run` and the host's room. Move them to
`buildroom/screens/` as **display components** that take a `room` in `wallView` shape and an
optional `controls` object:

- one screen: the page passes the host's room and `controls` (dock, picks, decide window,
  Share demo, Host alert, SESSION): identical to today;
- the wall: `wallView` and no `controls`: no `<button>`, no link that acts (the build link
  and QR stay: they are for the room).

Drop from the wall: the Host alert (computed from host-only `seen` and proposed asks,
`buildScreens.js:97-129`), "Press Space to…" hints, the wheel's pick buttons
(`BuildRoomPage.jsx:2039-2045`), History's clickable decided items (`:2303`).

### 2.6 One app: Build Room on Call & Answer's parts (owner, 17 Oct)

Owner, 17 Oct: *"this depends on the 1 screen 2 screen work that should make the look and
feel similar to call and answer ... be mindful of the cross room type integration work. we
want these to feel like the same app, just different use case experiences."*

So Build Room does not grow its own dock or its own two-screen laptop. It takes the shared
parts C&A uses and supplies only what is its own: its panels, its words, and one function
that decides its main button.

| Surface | Shared part (as C&A uses it) | What Build Room supplies |
|---|---|---|
| The decision of what the main button does | `roundStep` → `controls` read by every surface | **`buildControls(room, current, now, …)`**: `stageModel`'s moves in the `controls` shape (`primary`, `secondary`, `arm: { inPlace: true }`), so `HostActionBar` reads it unchanged. One function, as `roundStep` is for rounds |
| One screen: the Stage's dock | `components/stage/Dock` + `HostActionBar` (Space, →, ←, the clicker, press twice in place) | the controls; the dock's fixed right-hand items are **Host** and **Session** |
| Two screens: the laptop | `components/console/HostConsole`: `ConsoleTop` (name, Join, Room's window ↗, window status), `ConsoleRail` (sections), main area, `ConsoleFooter` (status, "Your part now", `HostActionBar`) | **panels** for the main area (the Host screen's Now column, the ask path, What's next, the decide window inline); **rail sections** mapped onto `CONSOLE_SECTIONS` (`config/consoleRail.js:7`): queue → Waiting for you, people → People, late → Later, tools → Session; "The room sees: Stage · Build · History" in `ConsoleTop` with 2/3/4 |
| The loop line | `WorkflowStrip` | the ask path: Ask › Collect › Settle › Send to Claude (`askPathStep`, `buildScreens.js:894-901`) as its steps: Q17 |
| Screens and the room's window | `ScreensGroup`, `RoomWindowLink`, `presentStatus`, `roomScreen` | nothing new |
| Words | one module per area | `buildroom/words.js` (as today) |

What stays Build Room's own because the use case is different: Claude's one status line
and the doing line, the queue of Claude's questions and mockups, the Build screen, History
and the Later list. They live inside the shared shell's panels, not beside it.

The two-screen laptop also needs, as before: "The room sees" posting `build/wall` (the chip
follows the server's `wall.screen`); Show codes posting `codes`; `presenting` /
`presentDetail` on the build host read (host audience only, from `room-counts.js`
`presentingDetail`, `:101-121`, same `CodeUri`), refetched on the existing
`presentChanged` frame (`message.js:748-749`).

**Design first.** C&A's console was approved from a mockup
(`docs/design/host-console/index.html`). Build Room's gets the same: a mockup of the
two-screen laptop and the one-screen Stage dock in the console's visual system, for the
owner's review before B8 (task B7a).

### 2.6b Nothing Build Room does today is lost (owner, 17 Oct)

Owner, 17 Oct: *"just makes sure as we integrate, we dont lose capabilities in the build
room."* Every capability below keeps a way in on **both** setups. Where a capability's
place changes, the table says where it goes; nothing is dropped to fit the shared shell.

| Capability today | Where it is today | One screen, after | Two screens (laptop console), after |
|---|---|---|---|
| The ask's moves: Open voting, Show results, Spin / Spin again, Send B to Claude, Change before sending, Reopen, Take it down, Save for later, the points vote (Send highlighted, Work in turn, Save the rest, Close this vote), the run list (Next, Skip, Stop), Hide the codes | Stage dock (`stageModel`, `buildScreens.js:370-508`) and the Host screen's path | Stage dock: the shared bar on `buildControls`; a third move under the bar's secondary or Session, never dropped | Console footer: the same `buildControls` |
| The ask path: Ask › Collect › Settle › Send, the decide panel, the host's pick (PickConfirm), answering for the room, kept drafts per ask | Host screen (`BuildAskPath`, `BuildStageDecide`, `PickConfirm`) | Host screen, unchanged | Main-area panel for the ask; the strip shows the path (Q17) |
| Picking on the board (an option or a wheel slice opens the send window) | Stage (`boardPick`, `BuildRoomPage.jsx`) | Stage, unchanged | The board is on the wall, which has no controls: the pick moves to the console's ask panel (the same options, pressable) |
| The Composer: Send to Claude as Do now / Keep in mind / Ask Claude, Save for later, Log it (with Also tell Claude), Ask the room (Ideas, Choose, Rate), Combine's lines and their sources | Host screen (`Composer`, `NowBuilding`) | unchanged | Main area, always present between asks (as C&A's Ask the room composer sits inline) |
| What's next moves, Decided (tick to combine), Timeline (edit, delete), Asks list, Screenshots (remove), Room brief | Host screen stack (`BuildRoomPage.jsx:1240-1246`, `BuildWhatsNext`) | unchanged | Main area and rail: What's next in the panel; Decided, Timeline, Asks, Screenshots, Room brief as rail sections or the panel's folds |
| The queue: Claude's asks (open, open next, edit, discard, ask for mockups), the room's ideas (send, add to the Ideas ask, acknowledge, put on the wall, later, dismiss, to a vote), filters | Host screen (`Queue`, `QueueIdea`, `ReviewCard`) | unchanged | Rail section "Waiting for you" (the `queue` slot), opening into the main area |
| The Later list (send, to a vote, remove) | Host screen (`BuildLater`) | unchanged | Rail section (the `late` slot is Build Room's Later) |
| Talking points and research or ideas requests; the run list | Host screen (`BuildPoints`, `BuildRun`, `BuildPointStage`) | unchanged | Main-area panel and the footer's run moves |
| The opening: the brief, its steps, Start building | Host screen (`BuildOpening`, `OpeningPanel`) | unchanged | Main-area panel while the room frames the build |
| The crew: builders, early looks (put on the wall), run crew code | Host screen and Stage (`BuildCrew`, `CrewBoard`, `EarlyLook`) | unchanged | Rail section and panel; the board itself on the wall |
| Share demo on this Wi-Fi, the codes card, the enlarged QR | Build screen, header chip, Stage (`BuildWifiShare`, `WallCodes`, `QrZoom`) | unchanged | `ConsoleTop`'s Join and a Share demo item; the codes go on the wall by `codes` |
| Claude's status, the doing line and steps, the plugin's update dot, Continue prompt, Connect Claude (session key) | Header chip, Now column (`AgentChip`, `StepsFold`, `ConnectPanel`) | unchanged | `ConsoleTop` (status) and the Session rail section (Connect) |
| The Host alert (what waits, Mark all seen) | Header tab and the Stage dock's HOST | Header tab only; HOST on the Stage goes home in one press (Q16) | Rail section "Waiting for you" and its count |
| Players: handover requests (grant, refuse), remove, Away, Builders; team invitations | Session panel, `HandoverStrip`, `PendingInvites` | unchanged | Rail "People" and the Session section; the request strip above the footer, as C&A's |
| Settings: codes, List names on the room meter, Claude, Crew, Back to the opening, Wrap up, Report, End session | `BuildSessionPanel.jsx:419-489` | unchanged, plus Screens first | the same panel from the Session rail section |
| History (filters, the ask window, the mockup viewer), the Build screen (latest shot, open the build) | Build / History screens | unchanged | on the wall (read-only); the laptop opens the same views privately from the rail |
| The report, wrap-up, end | Session panel, wrapped bar | unchanged | Session section; the footer's ended moment |
| Releasing Claude's posts (§2c): Release to the room, Keep to myself, Release all, the "Check Claude's posts" switch | Host screen's queue (`BuildHeldPosts`), Session › Settings › Claude | unchanged | Rail section "Waiting for you"; the same Session panel |

**How it is held.** A list, `buildroom/capabilities.js`, names every row above with an id.
Each entry point carries `data-capability="<id>"`. A test renders the page on one screen
and the console on two (B8) with a fixture that switches every capability on, and fails if
any id has no entry point on either. A capability is removed only by the owner, by taking
its id off the list in the same commit.

### 2.7 Choosing, and the Screens group

- `BuildSessionPanel.jsx` Settings gains **Screens** as its first group, reusing
  `components/stage/ScreensGroup.jsx` (props `choice, offerChoice, onChoose, presentHref,
  presentDetail, profile, onProfileChange`, `:31-39`; it imports only `roomScreen`,
  `presentStatus` and `RoomWindowLink`). Scope: **Applies now**. `onProfileChange` posts
  `build/wall {profile}`.
- "Where will the room watch?" (`RoomScreenChooser.jsx`) shows once on the Host screen
  before the first ask if no choice is stored. The choice stays per browser in
  `engage.surfaces` (`config/roomScreen.js:73-91`), as for C&A.

### 2.8 History: what the room gave, and what reached Claude (owner, 16 Oct)

Owner, 16 Oct: *"history needs to include user contributions that are used. same for any
asks. we need to mark them if we send some version to claude."*

**What History misses today:**

| A room contribution reaches Claude by… | Recorded as | On History today |
|---|---|---|
| **Send** on an idea (`direct`) | idea row `Status: promoted, PromotedVia: claude`; a log entry `kind: 'idea', forAgent: true`, the idea's text (`build-room.js:811-845`) | **Nothing.** `roomStory` draws `showing`, `verbal`, `milestone`, `outcome`, `image` and `step` only (`buildScreens.js:799-811`) |
| **Add to the open Ideas ask** (`suggest`) | a response row `Source: 'idea'`, with no link back to the idea (`build-room.js:813-820`) | Only if it wins the vote, and then not as the room member's idea |
| **Vote from ideas** (`asks-from-ideas`) | `ask.FromIdeas` ids; options built in that order (`build-room.js:1055-1085`; `build-store.js:756-769`) | "N ideas from the room" in the chain (`buildScreens.js:772`); not which idea won |
| **Combine** decided asks, or a direction the host writes from an idea | a `direction` log entry, with no link to its sources (`build-room.js:795-801`) | **Nothing**: the room's log drops `direction` (`build-store.js:1561-1567`) |
| A decision whose words the host **changed** before sending | `decision.direction` only | The changed words, unmarked |

Every ask, decided or not, should appear too. Today only decided asks are drawn
(`buildScreens.js:820-833`).

**The rule.** History lists every room contribution that was used, and every ask that went
to the room. Each one carries **one mark** saying what happened to it:

| Mark | When |
|---|---|
| **Sent to Claude** | its words went as written (a sent idea; a decision with the default direction) |
| **Sent to Claude, reworded** | a version went: the host changed the words, or it went into a combined direction |
| **Chosen by the room** → then one of the two above | it won a vote or an Ideas ask |
| **In a vote, not chosen** | it was an option or a suggestion that lost |
| **Saved for later** | held for Claude, not yet sent (`as: 'later'`, `heldForLater`) |
| **Not sent** | a decision recorded only (`sentToAgent: false`), or an ask closed without a decision |

The marks Claude has it / waiting for Claude stay as they are (`decisionChain`,
`buildScreens.js:788-790`). On the wall a contribution is "An idea from the room", never a
name. On a phone's own History it also says "Yours" (the existing `mine`, `buildScreens.js:831`).

**What the server must record.** Provenance is stamped when something is sent, never
guessed from text later:

- the `direct` idea log entry gains `IdeaId` and `AsWritten: true`;
- a `suggest` response row gains `IdeaId`, so a winning suggestion leads back to its idea;
- each option made by `voteFromIdeas` gains `ideaId`;
- `POST directions` accepts `fromIdeaIds` / `fromAskIds` (the composer sends what it was
  filled from: Combine's ticked asks, an idea opened in the composer). The server checks
  those ids exist and stores `From` on the log entry, with
  `AsWritten = (text === the source's own text)`;
- `decide` stores `Reworded: true` when the sent direction differs from the server's own
  default for that pick (`questionAnswer`, `build-store.js`).

Sessions made before this have none of it. Where `PromotedVia: 'claude'` or `FromIdeas`
exists, History says "Sent to Claude" or "In a vote" with no reworded mark. It never
claims "as written" without the stamp.

**Tasks** (one screen and the wall both draw History, so these come **before B2**, and
`wallView` carries the new fields from the start):

| # | Task | Files | Tests (first) |
|---|---|---|---|
| H1 | **Built** (`working/parity-plan`). Stamp provenance (the five bullets above) | `build-room.js`, `build-store.js` (`voteFromIdeas`, `logView`, `askView`) | `tests/build-provenance.js`: each route stamps its ids; a forged `fromIdeaIds` → 400; `AsWritten` true only for identical text; `Reworded` set when the host changed a decision |
| H2 | **Built.** `contributionsOf(room)`, and `askOutcome(ask, room)` for every ask the room saw: every used idea, with its mark and where it went (ask n, direction, later) | `buildScreens.js` (pure) | `__tests__/buildContributions.test.js`: one fixture per row of the first table; old rows with no stamps never read as "as written" |
| H3 | **Built.** `roomStory` draws contributions (a `gave` item: the idea and its mark, under the ask or step it fed) and every ask that reached the room, decided or not, with its mark | `buildScreens.js`, `BuildRoomPage.jsx` (`StoryItem`) | extend the `roomStory` tests: sent idea present; losing option "In a vote, not chosen"; combined direction marks each source ask "reworded"; no name anywhere in the wall's story |
| H4 | **Built.** The marks' words; "Made so far" counts used by the same rule | `buildroom/words.js`, `HistoryScreen` | words parity test; count matches `contributionsOf` |
| H5 | **Built** (phones; the wall reuses `roomHistory` in B2). The public and wall views carry the stamps with no names (ids and marks only) | `build-store.js` (`publicView`, later `wallView`) | B2's no-names scan covers the new fields |

### 2.9 Tasks

Each task: test first, see it fail for the right reason, implement, commit. Gates per the
standards §10. **No task touches `template-clean.yaml`; if one seems to, stop and report.**

| # | Task | Files | Tests (write first) |
|---|---|---|---|
| B1 | **Built.** `WallKey` minted on the host's first `GET build/state` by a conditional write through `touchState` (ttl kept, no Rev bump); on that read only; `POST build/wall {rotate:true}` mints a new one. API in §2.9a | `build-store.js`, `build-room.js` | `tests/build-wall-key.js` (12): host read carries it; agent, builder, phone and wall reads never do; a racing mint keeps the winner's; rotate retires the old key |
| B2 | **Built.** `wallView` (allowlist) + `build-play/wall` and `wall/images/{id}` ahead of the seat check; History is `roomHistory`'s asks with the existing `'wall'` audience. Fields in §2.9a | `build-store.js`, `build-room.js` | `tests/build-wall-read.js` (28): 403/404 cases; the fixture's private strings and names absent; names only with `listNames`; unlisted image → 404; no `IdSecret`, no `@` |
| B3 | **Built.** `WallScreen/WallCodes/WallProfile/WallRev` on `BUILD#STATE`, `POST build/wall` behind `hostOnly()`, cleared by the server on opening an ask (`makeCurrent`, re-ask), back to the opening, and (read-side) on the end | `build-room.js`, `build-store.js` | `tests/build-wall-screen.js` (15): host writes, Claude/builder 403, phone 404; junk 400; rev monotonic; ttl kept; clears; `buildChanged` reaches the `/present` row |
| B4 | **Built.** `presenting` / `presentDetail` on the host's `GET build/state` only, from `room-counts.js`, failing soft to `0`/`null` | `build-room.js` (`windowStatus`) | in `tests/build-wall-read.js`: host read carries them; agent, phone and wall do not; fails soft; a viewer row is not in `playerCount` |
| B5 | **Built** (`worktree-agent-ada9445699ced6a3f`): `links.js`, re-exported from `buildHostApi.js`; the walk starts at `buildScreens.js`, `links.js` and every file in `screens/` (`BuildWall.jsx` joins with B7) and also refuses `buildHostApi.js` itself. `safeHref` to `buildroom/links.js`; transitive import test | `buildroom/links.js`, `buildHostApi.js`, `buildScreens.js` | `__tests__/buildWallImports.test.js`: walking imports from `present/build/BuildWall.jsx` reaches no `authFetch`, `hostTicketClient`, `/build/state` |
| B6 | **Built** (`worktree-agent-ada9445699ced6a3f`): `screens/BuildStageScreen`, `BuildBuildScreen`, `BuildHistoryScreen` (+ `AskStage`, `StageIdle`, `QrZoom`, `Timeline`, `common`, moved unchanged), `useStageMoves.js`, `capabilities.js` with its one-screen test; no controls renders nothing pressable (host-view fixtures; the no-names half waits for B2's `wallView`). Split the three screens into `buildroom/screens/` with optional `controls`; lift `doMove` into `useStageMoves`; **with D1 and D2** (the shared dock on `buildControls`, Host in one press); `capabilities.js` and its one-screen half of the test land here, so the refactor is checked against the list before anything moves | `BuildRoomPage.jsx`, `buildroom/screens/{BuildStageScreen,BuildBuildScreen,BuildHistoryScreen}.jsx`, `buildroom/useStageMoves.js` | existing Build Room suites unchanged and green; `__tests__/buildScreensDisplay.test.jsx`: each screen with a `wallView` fixture and no controls renders no `button`/`role=button` and no name |
| B7 | **Built** (`worktree-agent-ac42d9e4d6bf6a196`): in `present/buildwall/` (not `present/build/`: `.gitignore` swallows every `build/`), with `wallRoom.js` (the wall read in the screens' shape), History's "and N earlier" fit, Settings › Screens' link to it, and 2/3/4, P, the tabs and Show codes posting `build/wall`. `BuildWall` + `useBuildWall` + `present/presentStatusReporter.js`; `PresentPage` dispatch on `type=build` | `present/build/*`, `PresentPage.jsx`, `usePresentation.js` | `__tests__/buildWall.test.jsx`: follows `wall.screen`; a `buildChanged` frame refetches and its payload is ignored; stale rev dropped; 403 copy; PRESENT_STATUS sent on fullscreen change; `presentRoute` test still public |
| B7a | **Mockup ready for the owner's review: docs/design/build-room-console/index.html** (five questions for the owner at the foot of its view 4). **Mockup** of the two-screen laptop (the shared console with Build Room's panels and rail) and the one-screen Stage dock, in the console's visual system, beside `docs/design/host-console/`; owner's review before B8 | `docs/design/build-room-console/index.html` | the owner's approval, recorded in the plan |
| B8 | Laptop two-screen mode **on the shared `HostConsole`** (§2.6), **with every capability of §2.6b reachable**: `ConsoleTop` with Join, Room's window, status and "The room sees" + 2/3/4 → server; `ConsoleRail` with Build Room's sections; Build Room panels in the main area; `ConsoleFooter` + `HostActionBar` on `buildControls`; codes → server; `presentChanged` refetch | `BuildRoomPage.jsx`, `buildroom/panels/*.jsx`, `buildroom/consoleRail.js` (the section mapping), `buildroom/words.js` | `__tests__/buildTwoScreen.test.jsx`: on two screens the page renders `HostConsole`; 2/3/4 post `build/wall`; the footer's labels equal `buildControls`' for each moment fixture (parity with the one-screen dock); one screen unchanged; `__tests__/buildCapabilities.test.jsx`: every id in `capabilities.js` has an entry point on one screen and on two |
| B9 | **Screens group built in part** (with B7): first in Settings, Applies now, the room's window link and status, the size posting `{profile}`, New link (rotate, armed in place); the chooser, `TWO_SURFACE_TYPES`, help and notes still to do. Screens group in `BuildSessionPanel`, the chooser, `'build'` added to `TWO_SURFACE_TYPES`; words, help (`config/help/`), release notes | `BuildSessionPanel.jsx`, `config/surfaces.js`, `config/roomScreen.js` (href with type), help | `surfaces.test.js` (build on dev, off on test/prod by default); `buildSessionPanel` Screens test; panel measured at 660/375 |
| B9m | **Measure** (standards §5): the wall at 1280×720, 1366×768, 1440×900, 1920×1080 × Room/TV/Call/Table, with long asks (six options of 130–320 chars), a 40-entry History, a tall screenshot. History on the wall shows the newest entries that fit and "and N earlier" (fit lever 3); never scrolls | `buildroom/screens/*`, `BuildRoom.css` | numbers in the commit; `data-fit="miss"` count zero |

Order: H1→H5 (History, §2.8; useful on one screen at once), then B1→B2→B3→B4 (server,
one deploy), B5→B6 (refactor, no behaviour change, one deploy), B7→B8→B9→B9m. Each arrow is a dev push the owner can look at; B6's push must
look identical to today.

### 2.9a The wall's API as built (B1–B4, 17 Oct)

What the frontend (B5–B9) builds to. All four ride the existing `build/{proxy+}` and
`build-play/{proxy+}` events: **resource impact 0**, `template-clean.yaml` untouched.

**`GET /games/{id}/build/state`** (host, signed in): the existing body plus, **for the host
only** (never Claude's key, a builder's key, a phone or the wall):

| Field | Shape |
|---|---|
| `wallKey` | 43-char base64url string (32 bytes). Minted on the first host read; stable until rotated |
| `wall` | `{ screen: 'stage'\|'build'\|'history', codes: 'none'\|'join'\|'both', profile: 'room'\|'tv'\|'call'\|'table', rev: n }` |
| `presenting` | integer: `/present` viewer rows on the session (`0` if the read fails) |
| `presentDetail` | `{ open, fullscreen, visible, statusAt, ageMs }` as C&A's (`room-counts.js presentingDetail`), or `null` if the read fails |

**`POST /games/{id}/build/wall`** (host only) `{ screen?, codes?, profile?, rotate? }`: at
least one. Each field is one of the enums above; `rotate` is a boolean. Junk → **400**;
Claude's key or a builder's → **403**; codes other than `none` after the end → **409** (the
screen and profile may still move after the end). Writes through `touchState` (ttl kept,
`Rev` +1, `WallRev` +1 on every write, the same value again included) and announces
`buildChanged {type, gameId, rev}` to every connection, `/present` rows included. Reply:
`{ wall }`, plus `{ wallKey }` (the new one) when it rotated. A rotate makes every open
window's next read 403.

**Cleared by the server:** opening an ask (`makeCurrent`: create live, open, open next,
from ideas, from Later, from points, the revote; and the re-ask) sets `WallCodes = none`
and `WallRev +1`; back to the opening (`POST build/opening/resume`) sets `WallScreen = stage`
and `WallRev +1`; an ENDED session **reads** as `codes: 'none'` on every read (the end is
written by the shared `session-end.js`, which this task did not touch; the stored value is
left, the read decides).

**`GET /games/{id}/build-play/wall?k=<wallKey>`** (no seat, no sign-in): `k` must equal
`BUILD#STATE.WallKey`, compared in constant time; missing, wrong, or no key minted yet →
**403** `{ error, code: 'wall-key' }`; not a build session → **404**. Any other method →
404. The body (`build-store.js wallView`, an allowlist):

| Field | What it is |
|---|---|
| `gameId, title, goal, state, playerCount, rev` | as the phones' read (`goal` is the session's details, which the header shows; added because the projected screens read it) |
| `players` | `[]`, or the joined names when **List names on the room meter** is on |
| `current` | the open/results/decided ask as `askView(…, 'public')`; wheel `spinner` and `spins[].by` are `''` unless List names is on (`'host'` stays); option `url`s only if not a laptop address |
| `history` | `roomHistory`: `{ asks (audience 'wall', with stamps, same url and wheel rule), ideas (used ones, text only), sent }` |
| `ideaCounts` | `{ total, used }`: every idea; used by History's rule (an idea in a vote the room has not seen is not used) |
| `log` | the phones' filtered log, less: `crew`, `base`, `help` entries; any entry about an ask the room has not seen; image entries whose picture is not in `images`; and, with List names off, any entry whose text names a player, builder, idea author, voter or spinner. Never `name` (unless List names), `forAgent`, `as`, `held`, `deliveredAt`, `from`; links never a laptop address or keyed |
| `images` | `{ imageId, caption, kind, askId, label, contentType, createdAt }`: not for an ask the room has not seen; a builder's only if the crew board shows it |
| `outcome, doing, run, shownPoint` | as the phones' (`shownPoint.from` a builder's wall label unless List names) |
| `agent` | `{ connected, listening, name }`: Claude's status line on the Stage and Build screen |
| `lan` | `{ live: true }` when the demo is on this Wi-Fi, `{ state: 'off' }`, or `null`. **Never the link**: it carries the gateway's key |
| `opening` | `openingView` (phase, steps, current, kinds, readyForDraft, drafted) |
| `brief` | the agreed brief: `{ forWhom, keep, lines, steps, headline, summary }`. Never `briefDraft`, never `later` |
| `wallComment` | `{ ideaId, text, at }` while fresh (`WALL_COMMENT_MS`), else `null` |
| `crew` | `{ enabled: false }`, or the phones' crew read less `repoUrl`, `modes`, `runCrewCode`, `me`, branches, fork URLs, builders' notes, PR links, tests summaries: builders are `Builder 1…n` (stable, so a lane and its early look match) unless List names is on; room comments carry no name |
| `wall` | `{ screen, codes, profile, rev }` |

Never in it: `seen`, raw `ideas`, `activity`, `points`, `settings`, `plugin`, any email,
`IdSecret`, the agent key, the wall key.

**`GET /games/{id}/build-play/wall/images/{imageId}?k=<wallKey>`**: the same key check;
the image bytes (as `build/images`) only if `wallView.images` lists it, else **404**.

**Changed from §2.2 by the code:** `asks` is `history.asks` (H5's `roomHistory` already had
the `'wall'` audience); `agent` and `goal` were added (the Stage's Claude line and the header
read them); `lan` never carries a link, so the Build screen's demo QR and the `both` codes
card cannot show the demo's link on the wall. If the owner wants the demo's QR on the
projector, the wall would need the keyed link while `codes === 'both'`: an owner's call.

### 2.10 Owner's checks on dev after B9

1. Build session on `engage.dev.seibtribe.us`, Chrome, two displays. Settings › Screens ›
   two screens; Room's window ↗ opens on the projector; click once: full screen; the laptop
   says "on, full screen".
2. Press 3: the wall shows Build, the laptop stays on Host. 4: History. 2: Stage.
3. Open an ask from the laptop; the wall shows it. The console's footer says what the Stage's dock said on one screen.
4. Reload the wall; it comes back on the same screen. Open a second copy on another
   computer; both follow.
5. Nothing on the wall names anyone (with "List names" off), and nothing on it is pressable.
6. One screen (Settings › Screens › one screen): today's page, unchanged.

---

## 2a. The dock that holds still, and the way back to Host (owner, 17 Oct)

Owner, 17 Oct: *"right now the bottom row buttons jump all over the place as you move the
cursor or things adjust. not good UX ... for 1 screen mode clicking into the stage screen
it is unclear on how to get back to host."* (with a screenshot of the HOST · 1 list open
over the Stage, "Host screen · 1" small at its foot).

**Why the buttons move.** Read in the code on `f0d6aa17`:

| Cause | Where | Effect |
|---|---|---|
| The **"Press Space to …" hint is added on hover**, between the main button and HOST, and removed on leave | `BuildRoomPage.jsx:2101` (`overDock && … brm-dockhint`), `.brm-dockhint { flex: none }` (`BuildRoom.css:1239`) | The pointer entering the dock pushes HOST and SESSION sideways; reaching for HOST moves it |
| The dock is a plain flex row whose **status text sets the width** of everything after it | `.dock { display: flex }` (`styles/stage.css:537`); status "3 of 18 answered", the "Open the build" link appearing (`BuildRoomPage.jsx`, `liveLink`) | Every count change and the build link shift the buttons |
| **Buttons come and go** per moment, with labels of different widths | `stageModel` extras / secondary (`buildScreens.js:370-508`), the codes card's own move | "Send B to Claude", "Spin the wheel", "Take it down" never sit in one place |

**Why the way back is unclear.** On one screen the Stage has no header; the only way back
is the dock's HOST. With a count, HOST opens the alert list instead of going to Host
(`BuildHostAlert.jsx:47` `press`), and the way back is the small "Host screen · 1" at the
list's foot. The 1 and P keys work but nothing on the Stage says so.

**The rule** (owner, 17 Oct: delivered by the shared parts of §2.6, not a Build Room dock; it becomes host standard §2's dock rule for every type, so it is fixed in the shared `Dock` / `HostActionBar` where they have the same fault):

1. **Fixed slots, fixed order.** The dock is a grid: status (one line, ellipsis, the full
   words in `title`; the build link on a second line whose height is always reserved) ·
   the moment's secondary · the main button · then **HOST and SESSION pinned at the right
   edge**. A slot with nothing in it keeps its width; the main button has a min-width per
   profile.
2. **Nothing appears or disappears on hover.** The Space hint becomes part of the main
   button (a small `Space` key cap inside it, always there when Space works) and its
   `aria-keyshortcuts`; the hover state only changes colour.
3. **Extras never push.** A third move (the run list's Stop, Save the rest) goes into a
   fixed "More" slot, not a new button.
4. **HOST always goes to Host, in one press.** The count stays on it as a badge. The list
   of what waits is on the Host screen itself ("Waiting for you" already lists it), so
   the Stage needs no pop-up. The button reads "← Host", with the key in its title
   ("Host screen (1 or P)").

On two screens the laptop never leaves Host (§2.6), so the way-back problem does not arise
there; the console's footer (B8) is the same shared bar.

| # | Task | Files | Tests (first) |
|---|---|---|---|
| D1 | **Built** (`worktree-agent-ada9445699ced6a3f`): `buildControls.js`; the Stage dock is `Dock` + `HostActionBar` (Space, →, arm in place; Stop and Save the rest in the bar's third slot); the shared Dock keeps the SPACE slot and puts its hint before the buttons; ← is not bound (Build Room has no step back). `buildControls` (the controls shape from `stageModel`); the Stage's dock becomes the shared `Dock` + `HostActionBar` reading it; the hover hint goes (the shared bar's key cap replaces it); extras into the shared bar's secondary or Session. If the shared dock also moves when its status text changes, fix it there (fixed slots), for every type | `buildroom/buildControls.js` (new), `BuildRoomPage.jsx` (`BuildStage`), shared `components/stage/Dock.jsx`, `components/HostActionBar.jsx` and their CSS if they move | `__tests__/buildControls.test.js`: one primary, at most one secondary, per moment fixture; labels from `words.js`; `arm.inPlace` on the early advances. `__tests__/dockStill.test.jsx`: no element in the dock renders on hover; Host and Session last in every moment |
| D2 | **Built** (`worktree-agent-ada9445699ced6a3f`): HOST reads "← Host", one press home, the count a badge whose slot is kept; `BuildHostAlert` is the header's only. HOST goes to Host in one press, its count a badge; the Stage's alert pop-up removed; the header tab's list on Build and History stays (Q16, ruled) | `BuildHostAlert.jsx`, `BuildRoomPage.jsx` | `buildRoomPage` case: on the Stage with a count, one click on HOST shows the Host screen |
| D3 | **Measure** in Chromium (standards §5): the x of Host, Session and the main button's right edge across every moment, pointer on and off the dock, four sizes, **for Build Room and C&A both** | a Playwright script beside `docs/handoff/tools/` | the numbers in the commit: zero movement |

Order (owner, 17 Oct): **D1–D3 go with the one-screen/two-screen work**, not before it: D1
lands with B6 (the screens split from their controls), D2 with it, D3 with B9m. The
mockup (B7a) shows the dock as it will be.

## 2b. Share demo shares the demo, not a folder (owner, 17 Oct, dev game 1215)

Reported: Open the build and Share over Wi-Fi opened `http://192.168.0.205:4904/`, a
directory listing of the mockups with a `.js` file "that supposedly linked all 4 mockups
... i dont think it was meant for the participants."

**What happened, from the code.**
- The share opens **up to four** local servers: every loopback address Claude linked in
  its posts, in a Choose ask's option previews, and in the wrap-up, newest four
  (`lanTargets`, `lambda-functions/game/build-lan.js:58-72`). The plugin gives each a
  gateway port from 4900 (`src/public/engage-mcp.mjs:2504, 2638-2642`). `:4904` was one
  of them, most likely the server Claude started for the mockups.
- The host's links went to each server's root (fixed in `cc323627`: the host now opens the
  page Claude showed, as the phones always did). A static server's root is a listing of
  its whole folder.
- The gateway forwards whole ports and never looks at paths
  (`docs/design/build-room-lan-share/LATER.md`, "the gateway forwards whole ports"). So
  anyone on the Wi-Fi with the key can browse every file the server serves: Claude's
  helper files, and, if Claude served a project root, project files. Nothing is "run" by
  the share; a browser shows a `.js` file as text.

**Proposed** (each needs the owner's ruling, Q18):

| # | Change | Where | Cost |
|---|---|---|---|
| S1 | **Built (1.19.0).** **Scope each gateway to the paths Claude linked**: a request outside the demo's and the options' own paths gets 404, and a directory listing is never forwarded | the plugin (`engage-mcp.mjs` gateway); a plugin release (`LATEST_PLUGIN`) | about a day, plus every host updating the plugin (the update dot already asks them to) |
| S2 | **Built (1.19.0).** **Tell Claude** (the MCP server's instructions) to serve the demo and each mockup from their own folder, never a project root, and never to link a helper page | `engage-mcp.mjs` instructions | an hour; relies on Claude following it, so S1 is the guarantee |
| S3 | **Built (1.20.0).** (a) The plugin reads `.engage/share.json` each round (loopback http only, 4 KB at most, a broken file declares nothing) and reports it; Engage keeps it on the Wi-Fi row and it wins: Open the build, the QR and the phones go to its `demo` page, the declared servers are shared first and their folders are in scope. (b) `post_update` takes `role: demo or mockup`; the demo is the declared one, else the newest link marked demo, else the newest link. Claude is told to set the role and write the file. (c) The share panel names each server Demo, Mockups, "Mockups · Ask 3" or App N, as "localhost:5173 → :4900"; the gateway's own pages say "Build Room 4821 · label or title". The title comes from a state read Claude made, never from the share loop, because an agent's state read takes Claude's inbox. (d) Ports from `4900 + (code mod 100) × 10`, ten per session (`ENGAGE_LAN_PORT` still overrides, twenty from it); `X-Engage-Session` on every gateway answer; `.engage/share-status.json` lists each server local → Wi-Fi → role, with no key. A 1.19.0 plugin keeps working: it declares nothing and ignores the new `roles` in the answer. **Asked for:** mark every shared server's role, and every session (owner, 17 Oct: "push these as a env var or something else, so that the mockup serving vs the demo share are clearly marked. and if im running multiple sessions from the same server, it is clearly labeled to find"). (a) A project file `.engage/share.json` (`demo`, `mockups`, `label`), editable by the host or Claude at any time, reported by the plugin and winning over any guess: Open the build and the QR always go to `demo`, mockup servers are shared only for option previews. Not an env var: it is fixed at Claude Code's start and the same for every server. (b) Claude's show tool takes `role: demo or mockup` and Claude writes the file when it starts servers. (c) Labels: the share panel names each server ("Demo · localhost:5173 → :4900", "Mockups (Ask 3)") instead of App 1/App 2; the gateway's own pages name the session ("Build Room 1215 · title"). (d) Several sessions on one laptop: a port block per game code (`ENGAGE_LAN_PORT` still overrides; today every session starts at 4900 and their ports interleave, likely why 1215 shared on :4904), `X-Engage-Session` on every gateway response, and `.engage/share-status.json` listing local → Wi-Fi → role per project | plugin (`engage-mcp.mjs`), `build-lan.js`, `BuildWifiShare.jsx` | about a day; plugin 1.20.0 |

## 2c. Release gate (owner, 17 Oct)

Owner, 17 Oct: *"Have thing get to host queue to release to room."* Nothing Claude makes
for the room reaches the room (the phones, the room's window, the laptop's projected
Stage, Build and History) until the host releases it from the host's queue. Owner's
ruling the same day: Claude's live status (the doing line, its helper and steps,
connected, listening) stays live and is never held.

**Built.**
- **The setting.** `Settings.reviewAgentPosts` on BUILD#STATE, on by default (like
  `reviewAgentAsks`), set by the host's `POST build/settings`. Off: posts go straight
  through as before; what is already held stays held until released.
- **What is held.** Claude's posts (`progress`, `milestone`, `showing`, `checkpoint`,
  `answer`, from the host's Claude or a builder's) and the host's Claude's screenshots
  are written with `Released: false` on the log row (and the image row). No flag means
  released, so every row written before the gate stays visible. A builder's picture
  follows the crew board, as before.
- **Where held rows go.** The host's read and Claude's (`roomHold: 'held'|'kept'` on
  the entry and the image). Never `publicView`, `roomHistory`, `wallView`, the wall's
  image route or the phone's image route, and they never drive the room's Open the
  build (`lanPublicView` reads the room's rows). The host's share link and the Wi-Fi
  targets may still use them. One filter does it: `roomRowsForRoom`
  (`build-store.js`), which also drops a picture or entry about an ask the room has not
  seen, and every "Claude proposed a question" entry (`HostOnly` from now; an older row
  by its words). A phone cannot send preview feedback on a held showing.
- **Mockups** (an image on an ask) are never held: they appear on phones and the wall
  exactly when their ask opens, whatever the setting.
- **The API.** `POST build/posts {action: 'release'|'keep', ids: [logId…]}`, the host's
  only (Claude and a builder 403, a phone 404), 50 at a time, all or nothing: every id
  must be waiting (404 otherwise; 409 for one kept). Release stamps `ReleasedAt` and a
  screenshot's entry releases its picture; the entry keeps its key, so History shows it
  at the time it happened. Keep stamps `KeptAt`: private for good.
- **The host's screen.** Waiting for you lists each held post ("Claude wants to show the
  room": its words, picture and link) with Release to the room and Keep to myself, and
  Release all when two or more wait (`BuildHeldPosts.jsx`). The Host alert counts them on
  one grey line of fixed words ("Claude wants to show 2 things", seen ids `post:<logId>`).
  Session › Settings › Claude: "Check Claude's posts before the room sees them". The
  host's Timeline marks "Not shown to the room" / "Kept to yourself". The laptop's
  projected Stage, Build and History draw `roomSees(room)`, the room's copy. Capability
  id `release-posts`.
- **The codes card follows the server.** When the server clears `wall.codes` (an ask
  opened), the laptop's own codes card comes down too; a read from before the server
  heard the laptop put them up does not count.
- **Claude** (plugin **1.21.0**) is told its posts and screenshots reach the room once
  the host releases them, and a held post's reply says it went to the host's queue.

Tests: `tests/build-release.js` (server), `__tests__/buildRelease.test.jsx` (host screen).

## 2d. What the room sees, and how large (owner, 17 Oct)

> "Remember the experience for 1 and 2 screen destination and the default option needs to
> share only the most relevant info to the room. For example the call and answer when
> asked a question or given a lesson the most important thing is the lesson needed t the
> instructions. But anything on the screen worth having needs to be large type and
> readable. This can be more verbose on zoom screen the projector but always keep it to
> just what is needed."

And, the same day: "I do like that Claude's status and activity is kept current on the
build room stage (whichever screen shown to the room)."

**Built** (`worktree-agent-a1aa9c2da620aa868`). One pure function decides it for every
screen the room sees: `src/src/config/roomContent.js`, `roomContentFor(moment, profile,
data)`. It returns each part of the moment with a role (lead, support, kicker, count,
dropped), a ladder step, what may give way for space (`dropOrder`) and what never may
(`essential`). The one-screen stage (`GameHostPage` → `QuestionCard`), the room's window
(`presentModel` → `PresentMoments`) and the Build Room's projected Stage, Build and History
(`buildroom/roomContentData.js`, the same components on one screen and on the window) all
read it. Call is the one verbose profile; Room, TV and Table carry only what is needed.

| Moment | Room / TV / Table | Call |
|---|---|---|
| Lobby | **Lead:** the session title, large, with the event details under it; the QR at the right with the address and code under it. Count | same |
| A question or lesson is up (answering, the question put back) | **Lead: the title** (hero when short). **The lesson** under it at the secondary step, never dropped. **"Your turn"**: the question's own instruction, or the question pulled from the front of the lesson, never dropped. A generic instruction is left off. Category as a small eyebrow. Count | same, + the generic instruction as a line that may give way |
| Voting | **Lead: every answer, whole and numbered** (all at once when `overviewFits`, else one at a time from answer 1). The title as the reminder. No tally. Count | same |
| A response on the wall (voting) | **Lead:** the one answer the host put up, with chips showing where it sits. Title in the top line. Count | same |
| Results | **Lead: the pick in full**, the runners-up with their text, the bar the fill behind each, relative to the pick. **No counts where names are hidden.** The title as the reminder; the talk line (first to give way). Counts | same |
| Responses, Workie's read | **Lead:** the response, the page | same |
| Feedback | **Lead:** the ask, or the comment put up. The round's title as the reminder (kicker) | same |
| A question for the room | **Lead:** the question and its options. Kind kicker, count | same |
| Ended | **Lead:** thanks. Session title | same |
| Top line | the round (the session title only in the lobby and at the end) | session title and round |
| Build Room: an ask (live, voting) | **Lead:** the prompt and the option titles (secondary step or larger; a long ask pages), each option's detail under it (first to give way). **No tally while open.** Claude's status (support, essential). Count | + the ask's detail |
| Build Room: results | as an ask, the tally rising inside the options, the pick marked with the room's best reason; "Sent to Claude" | same |
| Build Room: the wheel | **Lead:** the prompt and the wheel (scales with the fitter). Claude's status | + the detail |
| Build Room: between asks | **Lead: Claude's status** (headline, the doing line and its duration, the helper and activity lines); the newest picture and the last decision as support | same |
| Build Room: a talking point, the run list | **Lead:** the point; the run list and its current step (essential). Claude's status | same |
| Build Room: History, Build | **Lead:** the story (newest that fit, "and N earlier"); the newest screenshot. Claude's status at the top | same |
| Build Room: codes, crew board, the brief | **Lead:** what the host put up. Claude's status | same |

**Changed again 18 Oct, afternoon** (owner: "you provided the biggest text with the generic room instructions, not the changing lesson … the instructions is the optional one. the title often is nice to have big too"; and "nice to see a bar chart results but not at the expense of seeing what was voted on"). Mockup and reasoning: `docs/design/room-content-v2/`. The title and the lesson lead; the question goes in "Your turn"; voting shows every answer; results put the bars behind the answers with no counts where names are hidden; Build Room options keep their detail on every profile and hide the tally until the vote closes. Two host moves: the QR as a side panel beside the content (`stageFocus.join`), and putting one answer or result up.

**Changed 18 Oct, morning** (owner: "for the rounds for the answer phase neither the host nor the room sees the actual lesson instead we tell them what to do"): the lesson leads and the task sits under it, on every profile; until then the task led and a question with its own instruction dropped the lesson. The lobby leads with the session title and its details ("why is the title of the session tiny").

**Claude's status** is essential on every Build Room moment and profile, on one screen
and on the room's window, on Stage, Build and History (`screens/ClaudeStatus.jsx`): never
`data-drop`, the body step or larger, and after an open ask's prompt and options, never in
their place.

**Never a name, never the Workie Background:** the output is built from a whitelist; the
question's Background (authoring prompt: "Never shown to players") is never a part, even on
Call.

**Large and readable:** the lead is the profile's hero or primary step and shrinks only to
`--fit-min` (`__tests__/roomContentPalette.test.js`). A long Build Room ask **pages** its
options (`stagePaging.js` `OPTION_PAGE_SIZE`: Room 3, TV 2 or 1 under 900px tall, Call 3
or 2 at results, Table 4): "Options 1–3 of 6 · page 1 of 2 · ↑ ↓ to page" on the host's
Stage, the first page and "and 3 more options on your phone" on the room's window (no
server fact carries an option page; §5 lever 3). Measurements and before/after pictures:
`docs/design/room-content/README.md`.

**For the owner:** (1) settled 18 Oct: the lesson is never dropped. (2) The room's
window cannot page a long ask (no server fact); a `build/wall` option page the host's ↑ ↓
publishes would let it follow, as `/stage-focus` does for C&A.

## 3. Build Room's other standards (B10, after two screens)

| Standard | Task | Notes |
|---|---|---|
| Press twice in place | Replace `window.confirm` discards (`BuildCrew.jsx:243,723,745`; `BuildRoomPage.jsx:4069,4250`) and `PickConfirm`, `TakeDownOffer`, `RunConfirm`, Discard with the in-place arm. Keep `EndDialog` and the crew code switch as real dialogs (irreversible) | `PickConfirm` is a *choice* (the room's pick or another), not a confirm: Q6 |
| Settings scope labels | `BuildSessionPanel`: Screens and The room "Applies now"; Claude "Applies to the next thing Claude picks up"; Crew "Applies now" | Build Room has no rounds: the wording is Q7 |
| Late items | Make respond/vote writes conditional on the ask's status (close the race at `build-room.js:2799-2872`); then decide whether a late answer is kept and labelled | Q8 |
| Strip | None. Build Room has no rounds; `askPathStep` (`buildScreens.js:894-901`) is its loop. Do not force `roundStep` on it | Q3 |

---

## 4. The other types (outlines)

### 4.1 Trivia

Already has: the strip and `roundStep` (`hostControls.js:817-834`), the stage fitter,
scope labels, late answers kept server-side.

| # | Task | Notes |
|---|---|---|
| T1 | Skip's arm gets `inPlace` (`roundStep.js:261, 280`); Ask now and next question move off dialogs (`GameHostPage.jsx:4540-4546, 4711-4719`) | Fixes C&A and Poll too |
| T2 | Late trivia answers: decide (Q10); the late list already shows them (`late-list.js:77`) | |
| T3 | Wall moments in `present/presentModel.js` / `PresentMoments.jsx`: ASK draws the options with **no mark**; RESULTS draws the correct option and the split per option. Public reads already withhold the answer until RESULTS (two-surface PLAN Phase 7) — verify with a test in `tests/present-public-reads.js` before drawing anything | `/present` does not check type today (`PresentPage`, `presentModel.js:111-192`): a trivia session opened there now shows C&A moments. Until T3 lands, `PresentPage` should show "This session shows on the host's screen" for any type outside `TWO_SURFACE_TYPES` |
| T4 | Console panels: the correct answer and its detail **on the laptop only** during ASK (the one-screen laptop shows nothing private today: `QuestionCard.jsx:116-128`; `SessionSetupPanel.jsx:760-768`); per-option counts as they land | The reason two screens matter more for trivia than any other type |
| T5 | Measure (§5) with long options; join `TWO_SURFACE_TYPES` | Scoreboard already supports trivia (`config/scoreboard.js:68`) |

### 4.2 Poll

| # | Task | Notes |
|---|---|---|
| P1 | Page open answers: replace `TEXT_ON_WALL = 6` (`PollBoard.jsx:31,48`) with `stagePaging` sizes per profile and a printed position; until then at least "and N more" | Fixes a §5 breach on one screen today |
| P2 | Late poll answers are stored unvalidated (`message.js:596-624` runs after the late branch): validate them as on-time answers are, then decide whether a late poll answer counts (Q10) | |
| P3 | Wall moments for each `POLL_KINDS` (`config/surveyKinds.js:32`: choice, rating, yesno, text) reusing `PollBoard`'s renderers inside `.present`; live fill at ASK | |
| P4 | Console panel: the tally live, open answers as they land; measure; join `TWO_SURFACE_TYPES` | |

### 4.3 Survey

| # | Task | Notes |
|---|---|---|
| S1 | Words: survey labels out of `hostControls.js` into a words module (`roundWords` or `surveyWords`), with the parity test | |
| S2 | One main button: CLOSED and ENDED carry two secondaries (`hostControls.js:559-567, 582-591`); move Walk through or See the results under Session | |
| S3 | A survey strip: Open › Collecting › Closed › What we heard › Finish, from `workflowStrip` with a survey `LIVE_STEP` entry (`workflowStrip.js:21-34`) | Build from the README's description, which describes nothing that exists |
| S4 | Scope labels: `scope()` (`SessionSetupPanel.jsx:286-296`) says "Applies now" for a type with no rounds | One-line fix, can ship with T1 |
| S5 | Two screens: a public, aggregate-only survey read (the walk-through's data), wall moments for collecting (count only) and the walk-through; console panel for results | Last. Survey's late answers stay refused by design (`survey-answers.js:125-137`) |

### 4.4 Shared, any time

- **Declare the theme on the stage**: `data-theme="dark"` on `<main className="stage">`
  (`Stage.jsx:98`) and drop the five-token re-set (`stage.css:1309-1313`) once the palette
  test passes. Touches every one-screen type; measure contrast in light mode first.

---

## 5. Open questions for the owner

Each with a recommendation and the cost of getting it wrong.

**Ruled 16 Oct 2026: the owner agreed with every recommendation below** ("agree with your
recommendations, start with H1"). The Recommended column is now the decision.

| # | Question | Recommended | If wrong |
|---|---|---|---|
| **Q1** | **Who may read the Build Room wall?** C&A's `/present` is readable by anyone with the four-digit code (two-surface PLAN D3). Build Room's wall would carry screenshots of an org's product work, which today need a sign-in or a seat. | **A per-session wall key in the window's URL** (B1), minted by the host, rotatable. The code alone does not open the wall. | If the key is unnecessary: one extra query parameter and a rotate action, ~half a day. If we skip it and it was necessary: screenshots readable by anyone who guesses a four-digit code, without appearing in the roster. |
| Q2 | Draw the wall's Stage with the existing `Stage` (vh ladders, as Build Room does today) or C&A's fixed 1920×1080 `PresentStage` canvas? | **Existing `Stage`** for B7–B9: it already fits Build Room's moments; the window is full screen so vh is the projector's. Move to `PresentStage` only if B9m measures misses | If wrong: a second pass on the wall's CSS; the data and routes do not change |
| Q3 | Should Build Room get the round strip? | **No.** It has no rounds; `askPathStep` is its loop. The standard it should meet is "one function decides the main button", which `stageModel` already is | If wrong: a strip that names steps Build Room does not have |
| Q4 | On two screens, what does P do? | **Nothing** (the laptop has one screen); 2/3/4 move the wall. Keep P on one screen | Low: one key binding |
| Q5 | Should the host page through History on the wall (server-held page, like Workie's read)? | **Not in B.** Show the newest entries that fit and "and N earlier". Add a `WallPage` fact later if hosts ask | If hosts need it: one more field on `build/wall` and a pager, ~1 day |
| Q6 | `PickConfirm` asks "the room's choice or yours?" Is that a confirm (→ press twice) or a choice (→ stays a small dialog)? | **A choice: keep it**, restyled as a sheet with one exit | If wrong: one more dialog than the standard allows |
| Q7 | Scope wording for a type with no rounds (Build Room, Survey) | **"Applies now"** everywhere it is true; Claude's settings "Applies to Claude's next step" | Wording only |
| Q8 | Late Build Room answers (after Show results): keep and label, or refuse? | **Refuse, but close the race** (conditional writes). A build ask decides a direction for Claude; a late answer cannot change what was sent | If hosts want them: the late list already exists for rounds; ~2 days to extend |
| Q9 | C&A's answer order is a plain hash of the author (`answer-order.js:59-62`). Key it under `IdSecret`? | **Yes, separately from this plan**: two guarded-identical copies to change together | If left: a person holding the roster can match "Response N" to a name in a hidden-name round |
| Q10 | Late trivia and poll answers are already kept. Do they count? | **Trivia: kept, never scored, listed. Poll: counted only if the results have not been shown** | If wrong: a score or tally that changes after the room saw it |
| Q11 | Should `/present` refuse types outside `TWO_SURFACE_TYPES` until they are built? | **Yes**: show "This session shows on the host's screen" | If not: a trivia session on `/present` shows C&A's moments today |
| Q13 | Does an idea the host **put on the wall** (`wall`, acknowledged, not sent) count as "used" on History? | **No**: History's "used" means it fed an ask or reached Claude. The wall moment is already brief by design | If wrong: those ideas need one more mark, "Shown to the room" |
| Q14 | When is a version "reworded"? | **Any change to the words** the server would have sent by default, including combining. No similarity threshold | If too strict: a fixed typo reads as "reworded". Cheap to loosen later; a guessed threshold is not |
| Q15 | Names on History contributions on the laptop's own History (one screen, Host only)? | **No names on History anywhere** (it is a projected screen); the queue and the report keep names | If hosts want them: a host-only toggle |
| Q16 | **Ruled 17 Oct: keep it on the header tab, never block the Host button.** The Host alert list: keep it on Build and History's header tab (where it opens downward and moves nothing), or drop it everywhere and rely on the Host screen's "Waiting for you"? | **Keep it on the header tab**, drop it only from the Stage dock: the header list was liked; the dock pop-up is the one that blocks the way back | If wrong: one more click to see what waits from Build or History |
| Q17 | Build Room's loop line: show the ask path (Ask › Collect › Settle › Send to Claude) in the shared strip, or no strip? | **The ask path in the shared strip**: it is the loop a host works through on every ask, and the strip is how every other type says "where am I" | If it confuses: drop the strip for Build Room; the panels already show the path |
| Q18 | **Ruled 17 Oct: S1 and S2 now (built, plugin 1.19.0).** Share demo exposure (§2b): scope the Wi-Fi gateway to the paths Claude linked (S1), tell Claude to serve only the demo's and mockups' own folders (S2), and let Claude name the one demo link (S3)? | **S1 and S2 now, S3 with the next plugin release**: S1 is the only one that guarantees a participant cannot browse a folder | If S1 is skipped: whatever folder Claude serves stays browsable by everyone in the room |
| Q19 | **Ruled 17 Oct: all four parts (built, plugin 1.20.0).** S3 as above: a project file plus Claude declaring the role, labels in the panel and on the gateway's pages, a port block per session? | **Yes, all four parts in one plugin release**: the file is the one place a host can correct Claude, and the port block plus labels end the guessing when two rooms run on one laptop | If only (b): Claude's word is the only source, and a wrong guess cannot be corrected without asking Claude |
| Q12 | Builders' names on the wall's crew board (and the wheel's "Ada spins the wheel", `buildScreens.js:452`): fine, or only with "List names" on? | **Follow "List names"**: one rule for every name on the wall | If wrong: a name on the projector the host did not choose to show |
