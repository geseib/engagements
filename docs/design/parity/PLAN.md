# Parity: bringing Trivia, Poll, Survey and Build Room up to the host standards

Written 16 Oct 2026 on `working/parity-plan`, branched from `working/build-room-host-redesign`
at `3f07c0e4`. **A plan, not code.** Nothing here is built.

Inputs: `docs/design/host-standards/README.md` (the standards, and the table this plan
corrected), `docs/design/two-surface/PLAN.md`, `docs/superpowers/specs/2026-10-15-host-console-design.md`.

Paths are relative to the repo root; `src/src/` is the frontend. Every claim about today's
code carries a `file:line` read on this branch.

---

## 0. Summary

| Phase | What | Template resources | Owner can test on dev |
|---|---|---|---|
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
LAPTOP (Host screen, private)                         PROJECTOR (/present?type=build…)
┌───────────────────────────────────────────────┐     ┌──────────────────────────────────┐
│ Join 7924 · Room's window ↗ · ● on, full screen│     │ Stage / Build / History,          │
│ The room sees: [Stage] [Build] [History]  2 3 4│ ──▶ │ drawn from a public wall read,    │
│ … the Host screen as today …                   │     │ following the server's choice.    │
│ Room's dock: status · [secondary] [MAIN]       │     │ No buttons. Reload lands on the   │
└───────────────────────────────────────────────┘     │ same screen.                      │
                                                      └──────────────────────────────────┘
```

- **One screen is unchanged.** Host / Stage / Build / History on one page, P and 1–4 as
  today, the Stage's dock on the Stage.
- **Two screens:** the laptop stays on Host. 2 / 3 / 4 (and the "room sees" chips) write the
  wall's screen to the server; the window follows. P is not needed (Q4).
- The Stage dock's moves (`stageModel`'s primary, secondary and extras) are drawn on the
  Host screen as **Room's dock**, from the same function, so the Stage on one screen and
  Host on two can never disagree.

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

### 2.6 The laptop on two screens

In `BuildRoomPage.jsx`, behind `twoSurfacesOn({ …, gameType: 'build' })`:

- **Top line** gains Join, `RoomWindowLink` to `presentHref(gameId, { type: 'build', k })`
  and the window status from `presentStatusFrom(detail)` (`config/presentStatus.js:14-36`).
- **"The room sees"** chips (Stage, Build, History) with 2/3/4, posting `build/wall`;
  the pressed chip follows the server's `wall.screen`, not local state. The header's
  screen tabs (`BuildRoomPage.jsx:1749-1765`) become these chips; Host is the laptop's only
  screen.
- **Room's dock** at the foot of Host: `stageModel(room, current, now, …)`'s status,
  secondary, extras and primary, with Space, wired to the same `doMove` logic the Stage uses
  today (`BuildRoomPage.jsx:1945-1978`, lifted into a hook `useStageMoves`). The decide
  window (`BuildStageDecide`) opens on the laptop.
- **Show codes** posts `codes`; Escape posts `codes: none`.
- The window status needs `presenting` / `presentDetail`: add them to the build host read
  (`hostView`, host audience only), computed by the existing `room-counts.js`
  `presentingDetail` (`room-counts.js:101-121`), same `CodeUri` so no packaging change. The
  page refetches on the existing `presentChanged` frame (`message.js:748-749`).

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
| H5 | The public and wall views carry the stamps with no names (ids and marks only) | `build-store.js` (`publicView`, later `wallView`) | B2's no-names scan covers the new fields |

### 2.9 Tasks

Each task: test first, see it fail for the right reason, implement, commit. Gates per the
standards §10. **No task touches `template-clean.yaml`; if one seems to, stop and report.**

| # | Task | Files | Tests (write first) |
|---|---|---|---|
| B1 | Wall key: minted lazily on `BUILD#STATE` (`WallKey`, 32 random bytes, base64url), returned only on the host read; `rotate` action on `build/wall` | `build-store.js`, `build-room.js` | `tests/build-wall-key.js`: host read carries it; public and agent reads never do; rotate retires the old key |
| B2 | `wallView` + `askView(…, 'wall')` + the two `build-play/wall` routes ahead of the seat check | `build-store.js`, `build-room.js` | `tests/build-wall-read.js`: no key → 403, wrong key → 403, non-build → 404; a fixture with named players, voters, why names, notes, `claudeNote`, `briefDraft`, `brief.later`, idea authors, LAN key: **none of those strings** appears in `JSON.stringify(body)`; names appear only with `listNames` on; an image id not in `wallView` → 404; no `IdSecret`, no `@` |
| B3 | `WallScreen/WallCodes/WallProfile/WallRev` + `POST build/wall` + server clears (§2.3) | `build-room.js`, `build-store.js` | `tests/build-wall-screen.js`: host may write, agent key and player may not (404/403); enum junk refused; rev monotonic; ttl kept; opening an ask clears codes; announce sent |
| B4 | `presenting` / `presentDetail` on the build host read | `build-store.js` (`hostView`), `build-room.js` | extend B2's file: host read carries them; wall and phone reads do not; a viewer row is not counted in `playerCount` |
| B5 | `safeHref` to `buildroom/links.js`; transitive import test | `buildroom/links.js`, `buildHostApi.js`, `buildScreens.js` | `__tests__/buildWallImports.test.js`: walking imports from `present/build/BuildWall.jsx` reaches no `authFetch`, `hostTicketClient`, `/build/state` |
| B6 | Split the three screens into `buildroom/screens/` with optional `controls`; lift `doMove` into `useStageMoves` | `BuildRoomPage.jsx`, `buildroom/screens/{BuildStageScreen,BuildBuildScreen,BuildHistoryScreen}.jsx`, `buildroom/useStageMoves.js` | existing Build Room suites unchanged and green; `__tests__/buildScreensDisplay.test.jsx`: each screen with a `wallView` fixture and no controls renders no `button`/`role=button` and no name |
| B7 | `BuildWall` + `useBuildWall` + `present/presentStatusReporter.js`; `PresentPage` dispatch on `type=build` | `present/build/*`, `PresentPage.jsx`, `usePresentation.js` | `__tests__/buildWall.test.jsx`: follows `wall.screen`; a `buildChanged` frame refetches and its payload is ignored; stale rev dropped; 403 copy; PRESENT_STATUS sent on fullscreen change; `presentRoute` test still public |
| B8 | Laptop two-screen mode: top line, "room sees" chips + 2/3/4 → server, Room's dock, codes → server, `presentChanged` refetch | `BuildRoomPage.jsx`, `buildroom/words.js` | `__tests__/buildTwoScreen.test.jsx`: on two screens 2/3/4 post `build/wall` and the laptop stays on Host; Room's dock shows `stageModel`'s primary label for each moment fixture (parity with the one-screen Stage); one screen unchanged (source scan, as `workflowStripView.test.jsx` does) |
| B9 | Screens group in `BuildSessionPanel`, the chooser, `'build'` added to `TWO_SURFACE_TYPES`; words, help (`config/help/`), release notes | `BuildSessionPanel.jsx`, `config/surfaces.js`, `config/roomScreen.js` (href with type), help | `surfaces.test.js` (build on dev, off on test/prod by default); `buildSessionPanel` Screens test; panel measured at 660/375 |
| B9m | **Measure** (standards §5): the wall at 1280×720, 1366×768, 1440×900, 1920×1080 × Room/TV/Call/Table, with long asks (six options of 130–320 chars), a 40-entry History, a tall screenshot. History on the wall shows the newest entries that fit and "and N earlier" (fit lever 3); never scrolls | `buildroom/screens/*`, `BuildRoom.css` | numbers in the commit; `data-fit="miss"` count zero |

Order: H1→H5 (History, §2.8; useful on one screen at once), then B1→B2→B3→B4 (server,
one deploy), B5→B6 (refactor, no behaviour change, one deploy), B7→B8→B9→B9m. Each arrow is a dev push the owner can look at; B6's push must
look identical to today.

### 2.10 Owner's checks on dev after B9

1. Build session on `engage.dev.seibtribe.us`, Chrome, two displays. Settings › Screens ›
   two screens; Room's window ↗ opens on the projector; click once: full screen; the laptop
   says "on, full screen".
2. Press 3: the wall shows Build, the laptop stays on Host. 4: History. 2: Stage.
3. Open an ask from Host; the wall shows it. Room's dock says what the Stage's dock said.
4. Reload the wall; it comes back on the same screen. Open a second copy on another
   computer; both follow.
5. Nothing on the wall names anyone (with "List names" off), and nothing on it is pressable.
6. One screen (Settings › Screens › one screen): today's page, unchanged.

---

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
| Q12 | Builders' names on the wall's crew board (and the wheel's "Ada spins the wheel", `buildScreens.js:452`): fine, or only with "List names" on? | **Follow "List names"**: one rule for every name on the wall | If wrong: a name on the projector the host did not choose to show |
