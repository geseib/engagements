# Entry, setup, console, scoreboard and the remote's AI beat

**Date:** 2026-08-09
**Status:** design approved by the owner. Five streams, one program.
**Baseline at time of writing:** `dev` @ `461f46d8`, backend **28 suites / 927 passed / 0 failed** (re-verified).

Five bodies of work the owner asked for in one instruction: the home page, the
engagement setup screen, the host tools/settings panel, a scoreboard through
the session, and a button on the remote that shows the AI.

They are **not** one change. Three of the five edit `GameHostPage.jsx`, which is
5,235 lines, so they are sequenced rather than parallelised. Each stream below
is self-contained enough to ship, verify and stop after.

> **Line numbers in `docs/handoff/RESUME.md` are stale by +55 to +120.** The
> numbers in this document were re-derived on 2026-08-09 against the working
> tree and are the ones to trust.

---

## 0.0 The mockups are the design. Read them first.

**Owner instruction, 2026-08-09:** *"just make sure you are following the great
designs you had created in the mockups."*

This document records **decisions, defects and constraints**. It does not
re-draw the screens. Every stream below has mockups already built for it, and
the mockup is the source of truth for layout, type, spacing, copy and states.
**Open them in a browser before writing a line** — reading the HTML source is
not the same as seeing the screen it renders.

```bash
python3 -m http.server 8124 --directory docs/design
```

(There is a `.claude/launch.json` entry, `all-design-mockups`, on port 8124;
`host-redesign-mockups` serves the host set alone on 8123.) Each set has an
annotated contents page at `<set>/index.html`, a deck viewer at `view.html`, and
a runnable audit at `audit.html` / `audit.js`.

| Stream | Mockups — **primary in bold** | Supporting reading |
|---|---|---|
| **A** root page | **`entry-redesign/01-root.html`**, `03-join-unknown-code.html`, `10-signin.html`, `11-register.html` | `entry-redesign/RATIONALE.md` §2–§3, `OPEN-QUESTIONS.md` |
| **B** engagement setup | **`host-redesign/20-setup.html`** | `docs/superpowers/reviews/2026-08-09-setup-screen-review.md` |
| **C** setup panel | **`host-redesign/11-console.html`**, **`18-question-browser.html`**, `19-how-to-play.html` | `docs/superpowers/reviews/2026-08-09-console-review.md`, `host-redesign/CRITIQUE.md`, `USER-REVIEWS-2.md` |
| **D** scoreboard | **`host-redesign/10-ended.html`**, `06`/`07`/`08-results-*.html`, `21-results-revealed.html` | `docs/superpowers/reviews/2026-08-09-ended-screen-review.md` |
| **E** remote AI beat | **`host-redesign/17-remote.html`**, `09-field-notes.html` | — |

**Where this document and a mockup disagree, this document wins on the specific
point it names and the mockup wins on everything else.** Each disagreement is
argued in place below — §2.5 (anonymity copy), §2.3 (the trivia timer), §3.2
(tabs replacing the mockup's nine-section scroll), §3.6 (deletions), §4.4 (the
podium sort). There are no silent overrides: if this document does not say
otherwise, build what the mockup draws.

Two mockup-level cautions carried forward from the reviews:

- **The mockups omit shipped behaviour that is correct** — live bitmask category
  counts, `exhausted` state, `isTogglingCategory` disabling, connection status,
  `Copy Invite`, loading and empty states, the mid-round skip confirmation. §3.3
  lists them. Silence in a mockup is not an instruction to delete.
- **`host-redesign/RATIONALE.md` and `OPEN-QUESTIONS.md` do not exist** for the
  host set — the equivalents are `CRITIQUE.md` and `USER-REVIEWS-2.md`. The
  other three sets do have them.

The design agents were asked to argue back and did. Several of their
disagreements were correct; read them before building from their output.

---

## 0. Rulings taken as given

These came from the owner during design. They are settled, not suggestions.

1. **The scoreboard is top-three, on RESULTS and ENDED only.** Not every phase.
2. **The setup panel gets a Players tab**, listing every player in score order.
   This overrides the console reviewer's §1 recommendation to move the roster to
   the phone. The owner's reason, verbatim: *"the anonymity is just for
   preventing people voting for an answer based on who said it. thats it."*
3. **The remote also gets a waiting list** — who has not answered or voted yet,
   by name, *"so they could call out 'hey George, we are waiting on you'"*.
4. **The remote's AI button adds the missing beat**: RESULTS → What We Heard →
   Next, matching the stage. The beat is **server-side and bidirectional**.
5. **The setup panel has three tabs: Players · Questions · Settings.**
6. Setup screen scope: extract the dialog, pill picker, add Poll, delete the
   trivia timer, and make Event Details real. **Not** in scope: access codes
   (deferred), post-create destination (not selected), the wavelength unanimity
   caveat (must ship with the scoring change it describes, not before it).
7. **The root page's code field validates, then navigates.** Saving the
   participant from typing `/play` is the point; the check is a bonus that must
   never block.

### 0.1 On ruling 2, because it will look like a reversal

`config/anonymity.js:154-168` already argues the owner's position in its own
docstring:

> *"A cumulative total during an unrevealed round leaks nothing anyway: no
> points exist until RESULTS, and entering RESULTS is what reveals."*

`get-results.js:207-217` sets `AuthorsRevealed` **unconditionally** on entering
RESULTS. So there is no state in which a cumulative score list attributes an
unrevealed answer. The reviewer's objection generalised a rule that
`standingsVisible()` had already scoped correctly. Ruling 2 is consistent with
the code, not an exception to it.

**What does not change:** `standingsVisible()` still gates the podium (§4), and
`RoomMeter`'s no-names test still stands unmodified. A roster in a host panel and
a podium on the room's screen are different surfaces with different audiences.

---

## 1. Stream A — the root page

**Build from `docs/design/entry-redesign/01-root.html`.** Everything below is
what the mockup cannot tell you: why `/` is broken today, and what the code
field must do.

### 1.1 The defect

`src/src/App.jsx:141-224` is a `window.location.pathname` switch with **no case
for `/`**. `/` is the catch-all fallthrough at `:219-223`, rendering
`<ProtectedRoute><GameHostPage/></ProtectedRoute>`. `ProtectedRoute` (`:15-138`)
renders `<AuthPage>` **in place** when signed out — the URL stays `/` — so a
participant who types the domain off a slide gets a sign-in form for an account
they will never have. The only thing on that page for them is one footer
sentence that is not a link.

### 1.2 What is built

A `<RootGate>` for `path === '/'`, ahead of the existing fallthrough:

| Auth state | Renders |
|---|---|
| loading | the existing inline spinner |
| signed in | `<ProtectedRoute><GameHostPage/></ProtectedRoute>` — **today's behaviour, unchanged** |
| signed out | `<RootPage/>` |

The signed-in case is deliberate and is the entry rationale's own ruling (§2):
*"a signed-in host goes straight to their host page … Making the only repeat
users click through a landing page on every visit would be a real cost paid for
a hypothetical."*

**Unrecognised paths keep falling through to `GameHostPage` exactly as today.**
A 404 route is out of scope.

### 1.3 `<RootPage>` — `src/src/components/RootPage.jsx`

Per `docs/design/entry-redesign/01-root.html`. Two audiences, one page:

- **Join a session** — heading, a session-code field, a Join button, and the
  line *"Scanning the QR code on screen skips this step. No account, no app."*
- **Running a session** — heading, *"For people who create and run sessions."*,
  a full-width outlined Sign in button, and a Create host account link.
- Privacy and Terms links, which already have routes (`App.jsx:177-184`).

**Geometry.** Built as a phone page: join first, host below a rule. Grows a
second column at **900px, not 768** — at 768 the join column squeezes below the
width the code cells need. The DOM order is the priority order at every width,
so tab order and screen-reader order are correct without extra work.

**The join column stays dominant at 1280.** Hosts sign in a few hundred times
and need the control *findable*; a participant sees this page once, under time
pressure, while a room waits.

### 1.4 The code check

```
type code → GET {API_BASE}games/{code}
  404            → inline "No session with that code", stay on the page
  200            → window.location.href = `/play?gameId=${code}`
  anything else  → navigate anyway
```

`GET /games/{gameId}` has **no authorizer** (`template-clean.yaml:425-431`),
returns `404 {error: 'Game not found'}` (`get-game.js:31`) and already sets
`Access-Control-Allow-Origin: *`. **No backend change.**

**The fourth rule is not defensive noise.** A check that can strand a
participant is worse than no check. Network failure, timeout, CORS — navigate,
and let `/play` own the error. The check only ever saves a page load.

**Why check at all, given the owner's point that populating `/play` is the
value.** `PlayerPage.jsx:1541-1547` sets `readOnly={gameIdFromUrl}`. A code
arriving in the URL makes the field uneditable — so navigating on a typo lands
a participant on a play page with a wrong, locked code and no way to fix it but
editing the URL. Validating first guarantees the code in the URL is one that
resolved.

*Residual, pre-existing, not fixed here:* a QR encoding a stale gameId hits the
same lock.

Navigation is `window.location.href` — a full page load, because `App.jsx` has
no history integration. That is correct here: the root page has nothing to hand
off.

### 1.5 The hook bug

`App.jsx:116-120` calls `useAuth()` **inside an onClick handler** in the Access
Pending branch — a hook outside render. That Sign Out button throws when
clicked. Fixed in this stream: lift the `useAuth()` call to the component body.

### 1.6 Return path

Host sign-in from the root calls `rememberReturnPath()` (`auth/returnPath.js`,
already built and already used by `LoginForm.jsx:89` and `RegisterForm.jsx:118`).
Storing `/` is correct — `/` is the host page for a signed-in user.

### 1.7 Verification

Testable in jsdom: `<RootPage>` renders both columns; the code field with a
mocked 404 shows the error and does not navigate; with a mocked 200 it calls the
navigation indirection; with a rejected fetch it navigates anyway. Use
`auth/navigate.js`'s `navigateTo` so the destination is assertable — the same
technique that made `postAuthDestination` testable.

**`setupTests.js`'s `window.location` mock is a silent no-op under jsdom 26.**
Do not assert on `window.location.href`. Assert on `navigateTo`.

---

## 2. Stream B — the engagement setup dialog

**Build from `docs/design/host-redesign/20-setup.html`**, with four named
overrides: the anonymity sentence (§2.5), the categories control (keep the app's
multi-select grid, not the mockup's `<select>`), the question-set dropdown (keep
the app's type filter, count and image marker), and the Create button's disabled
guard. The mockup also **drops three working fields** — AI context, persona and
event details — which §2.1 and §2.4 keep.

### 2.1 `<GameSetupDialog>`

Extract `src/src/GameHostPage.jsx`'s create-engagement overlay into
`src/src/components/GameSetupDialog.jsx`. It is an early-return overlay reached
only from the welcome screen.

**It is a component, not a route.** `App.jsx` is a pathname switch with no
client-side navigation, so a route means a full page load — which destroys the
in-memory host session, the WebSocket connection and every per-game value the
setup screen exists to hand off. A route is the one shape that cannot do the
job.

**What moves** (form-only state, per `config/gameSession.js:27-29`'s own
boundary): `engagementType`, `newGameSetId`, `randomizeQuestions`,
`anonymousResponses`, `eventDetails`, `gameAiContext`, `newGamePersonaId`.

**What stays in `GameHostPage`, passed as props:** `eventTitle` (a per-game key
the live host screen reads, `gameSession.js:105`), `categories`,
`activeCategoryIds`, `onToggleCategory`. And `handleStartNewGame` itself — it
clears the old game server-side, resets, creates and navigates, four
responsibilities that belong to the page.

**The single best reason for the extraction.** `handleStartNewGame` calls
`leaveCurrentGame()` — which clears `activeCategoryIds` — and then reads
`Array.from(activeCategoryIds)` from the **pre-reset closure**. It works, and it
works for a reason invisible at the call site. Have the dialog raise
`onCreate({ title, type, setId, categoryIds, ... })` with the selected ids **in
the payload**, and the stale-closure dependency is gone.

**Housekeeping that must land with it:** update the setter registry
(`GameHostPage.jsx:~430-461`) for every extracted key or the leave-game reset
breaks, and complete `gameSession.js:27-29`'s exclusion list, which today names
five form-only keys and omits three.

### 2.2 The format picker

Replace the three-option `<select>` with pills rendered from `GAME_TYPE_LIST`
(`config/gameTypes.js:140`), which exists specifically as the "ordered list for
pickers/filters". The shipped `<select>` hand-lists three of five, and its own
state comment repeats the omission — a picker that drifted from a table built to
prevent drift.

**Add Poll. Hold Survey.**

Poll is fully playable: upload has a first-class branch
(`upload-questions.js:301,445`), it is not in `TYPES_THAT_SKIP_VOTE`
(`hostControls.js:58`), `PlayerPage` already speaks poll (`:1846,1860,1866`),
host instructions exist, and anonymity already applies. The picker also fails
safe — the set dropdown filters by `engagementType`, so a host with no poll sets
sees an empty list and Create stays disabled.

Survey cannot exist: `upload-questions.js:146-157` **rejects survey uploads
outright**, so no survey set can be created and the pill would be permanently
dead. Exclude it via a **named constant with the reason in a comment**, not by
hand-listing four types — so that when upload lands, the fix is one line.

Render `blurb` under the picker. It exists for all five types and is rendered
nowhere in `src/src` today — dead data that answers "what is Wavelength?"
without a manual.

**Do not add the wavelength unanimity caveat yet.** It describes a scoring rule
that does not exist: today's aggregation is frequency-based
(`get-ai-summary.js:1931-1945`). Shipping the copy before the change commits the
exact sin §2.4 is about.

### 2.3 The trivia timer is deleted

`create-game.js:9`'s destructure is a whitelist that omits `triviaTimer`, and its
own comment says the field *"was sent by the frontend for months and silently
discarded"*. `grep -rn "triviaTimer\|TriviaTimer" lambda-functions src/src` finds
no consumer. There is no countdown anywhere.

So the shipped field is a control that does nothing plus a sentence that is
untrue — it promises players 30 seconds. Delete the field, the state
(`GameHostPage.jsx:241`), the send in `handleStartNewGame`, and the send in
`QuickstartMenu.jsx:88`.

**Record in the commit message that it never worked**, so nobody restores it.

### 2.4 Event Details becomes true

`create-game.js:37` stores it as `Details`; `get-game.js:102` returns it to
participants as `engagementInfo`. `grep engagementInfo src/src` finds **only the
two send sites** — `GameHostPage.jsx:2640` and `QuickstartMenu.jsx:82`. Nothing
renders it.

So the shipped help text — *"This information will be shown to participants when
they join"* — is false today. **Render it on `PlayerPage`** at the point the
field promises: when a participant joins. One component away, and the payload is
already arriving.

### 2.5 Anonymity copy

**Adopt the mockup's card structure. Keep the shipped sentence.**

Shipped and correct: *"Until voting closes, nobody sees who wrote which answer —
not the room, not you."*

The mockup's *"Until you reveal them"* is false in the dangerous direction: it
tells the host they hold a switch they do not hold. `get-results.js:207-217`
sets `AuthorsRevealed` unconditionally on entering RESULTS; `/reveal-authors` is
only an *early* reveal. A host who reads the mockup's sentence and then closes
voting to show the tally has just attributed every answer believing they had
not.

Preview card headings: **"While voting"** / **"After voting closes"** — not
"After you reveal".

Keep the shipped limits sentence verbatim.

### 2.6 Out of scope, named so nobody adds them

- **Access codes / visibility.** Deferred by the owner. The backend accepts,
  stores and fully enforces them and the participant UI is already built and
  dead — but no host UI is wanted yet.
- **Post-create destination.** Stays as shipped.
- **Survey.** §2.2.

---

## 3. Stream C — the setup panel

**Build from `docs/design/host-redesign/11-console.html` and
`18-question-browser.html`.** The panel's chrome, geometry, type and copy are
the mockup's. What changes is the **organisation**: the owner ruled three tabs
(§3.2) in place of the mockup's nine-section scroll, and the mockup's content
redistributes into them rather than being redrawn.

`19-how-to-play.html` is drawn as a **stage state**, not a panel — it has a
rail, a phase bar, a meter and a dock. The panel holds only the entry point to
it (§3.6).

### 3.1 What it replaces

Both edge tabs and both side panels are deleted. Owner ruling: *"As much as I
like the pull tab, I think they somewhat distract from the game — primarily the
how-to-play one is in the way."*

| Deleted | Lines |
|---|---|
| `.instructions-sidebar` | 3684–3779 |
| `.instructions-tab` | 3780–3786 |
| `.qr-sidebar` | 3789–4082 |
| `.qr-tab` | 4083–4089 |

The `SETUP` button already exists in the dock and already takes an `onSetup`
callback (`Dock.jsx:36-48`), currently wired to `setQrSidebarVisible`. This is a
repoint, not new chrome. **Drop the `⋯` glyph** (`Dock.jsx:46`) — the word and
the glyph say the same thing in a 48px target, and the whole argument for the
label was hittability.

**Do not print the word "Console" anywhere on screen.** User testing killed the
proper noun; the dock says `SETUP`.

### 3.2 Three tabs

**Players**
: Every player in score order, from `calculatePlayerRankings(players)`
  (`GameHostPage.jsx:39-82`, tie handling already correct). Name, points, and a
  done/pending tick keyed off the phase — `playersWhoAnswered` during `ASK#`,
  `playersWhoVoted` during `VOTE#`. This is the owner's ruling 2; the shipped
  roster at `:3848-3885` already does exactly this and moves in mostly intact.

**Questions**
: Category chips with **live per-category remaining counts** and on/off
  toggles, then the browser list beneath them. The chips are the browser's
  filter. Categories and the browser answer the same question at two zoom levels
  — which pool, then which question.

  This kills the shipped design's worst structural decision: today the **only**
  way into the browser is the per-category magnifier (`:4052-4063`), which scopes
  it to one category, so a host can never see the whole set at once.

  Adds: search-by-title, an `Unasked only` filter, a live `Showing 8 of 47`
  count, and used questions kept in the list at reduced opacity with `Ask again`
  — because "did I already use this?" is the question a host asks most.

**Settings**
: Display profile picker · session report · join link with one-click copy ·
  `Copy Invite` · put the join code back on the stage · the **remote QR** ·
  switch game · report a problem · sign out · the four keyboard lines.

**Connection status is in the panel header, not a tab.** It is the first thing a
host looks at when the room stops updating; burying it behind a tab is a
regression. The shipped display is at `:3811-3827` and is the **only** WS status
on the host page.

### 3.3 What must be ported, not re-drawn

The mockups did not draw these and the shipped code is right:

- the **bitmask arithmetic** for live per-category counts (`:3969-4003`, with the
  identical decode duplicated inline at `:4016-4032` — deduplicate on the way);
- `questions remaining` for the whole set, recomputed over enabled categories;
- `exhausted` styling for a category at zero — the thing that stops a host
  enabling a category that cannot yield a question;
- `isTogglingCategory` disabling while a toggle is in flight;
- the browser's loading spinner and empty state;
- the mid-round `selectQuestion` confirmation (`:1814-1821`) — abandoning a live
  round must still confirm;
- `Copy Invite` (`:3888-3894`), a calendar blob distinct from copying the link.

### 3.4 Geometry

`position: fixed`, `bottom: var(--dock-measured, var(--dock-h, 0px))` — the
exact rule the shipped panels carry, reasoned at `styles.css:400-447`.

**A sibling of `<Stage>`, not a child.** `.stage` is `height:100dvh` and the
panel is an overlay, so no grid track changes and `useStageFit` is not
re-entered. Anything inside the measured subtree enters the fitter's world, and
a section list of unknown length would drive the scale search to its floor.

**The dock is a no-overlay zone** — audit check A6, and the reason
`--dock-measured` exists rather than `--dock-h` (the dock outgrows its token:
measured 100px against 82.8px at 1280×720 in Table).

Closes on `✕`, `Esc`, `\`, and scrim click. Focus is trapped while open and
returns to the `SETUP` button. `runHostAction` already calls
`closeAllSidePanels()` first (`:3535`); the panel joins that — half its content
is round-scoped and a phase change invalidates it in place.

### 3.5 The SPACE defect

`isTypingTarget` (`HostActionBar.jsx:34-38`) covers `INPUT`/`TEXTAREA`/`SELECT`/
contenteditable only, and the handler then calls `event.preventDefault()`
(`:62`) — which suppresses the browser's default space-activation of **any**
focused button. A host who tabs to `Ask next` inside the panel and presses Space
does not press the button: **the round advances and the question they were
choosing is gone.**

**The rule, and it is one line:** SPACE stays live while the panel is open
*unless the event target is inside it*.

```js
if (event.target.closest('.setup-panel')) return;
```

beside the existing `isTypingTarget` check.

**The panel does not join `anyOverlayOpen`, and neither does its browser
section.** The `SPACE` chip renders exactly when `!anyOverlayOpen`
(`GameHostPage.jsx:3616`), so blanket suppression would make the host watch the
chip blink out while looking at a live button. Blanket suppression is also what
produced the unadvanceable state the original rule was written to fix.

`showQuestionBrowser` must therefore come **out** of the `shortcutsSuppressed`
call at `:3526-3530`, since the browser is now a panel section rather than a
full-screen modal covering the dock.

> **Landmine, already recorded and still live:** `shortcutsSuppressed()` is
> extracted and tested, but deleting an argument from its *call site*
> reinstates the defect with the whole suite green. **Assert the argument, not
> just the call.**

The pinned-QR rule is orthogonal and unchanged: only a *pinned* rail QR joins
`anyOverlayOpen`, because it is a full-screen overlay that does cover the dock.

### 3.6 Deleted on the way

- **The how-to-play document** (`:3684-3779`). It renders for only **three of
  five game types** — a wavelength or survey host opens the panel and sees a
  heading, nothing, and a Sign Out button. The panel keeps the *action*
  (`Show how this works on the stage →`); the four lines belong on the stage
  where the players they address can read them.
- **Both identity blocks** (`:3743-3776` and the second in `.qr-controls`). They
  render the signed-in name, email and Administrator badge, twice, in two
  panels. **The room must never see an email address.** `Sign Out` alone is
  enough.
- **`questionSetTabVisible`** (`:179`) — declared, set, cleared by
  `closeAllSidePanels`, read by nothing.
- **The `useWebSocket === false` polling branch** (`:3822-3826`) —
  `useWebSocket` is hardcoded `true` at `:210`.
- **The `z-index: 999999` scrim** on the browser modal — the highest z-index in
  the codebase by three orders of magnitude, and it covers the dock (A6).
- **The `correct-answer` row** in the browser (`:4769` region) — the entire
  reason that surface was cut from the stage.
- **The debug logging.** `:3673` fires a `console.log` on **every render of the
  host page**; `openQuestionBrowser` logs five lines and schedules a 100ms
  `setTimeout` purely to log again (`:1786-1788`); effects at `:1894-1921` log on
  every browser state change. These run in live sessions.
- **Dead CSS**: `.main-layout.rail-right-narrow` / `.rail-right-wide` /
  `.rail-left` and their `@media` block, no longer applied.

`closeQuestionBrowser` (`:1793-1797`) is currently **orphaned** — the modal's
Close button calls `setShowQuestionBrowser(false)` directly and leaves
`browsingQuestions` and `selectedCategory` dirty. Wire it, don't delete it.

### 3.7 Verification

Honestly unit-testable, following `config/hostControls.js`'s precedent:

- a pure `setupPanelTabs({ phase, gameType, capabilities })` returning data, with
  a test that no tab is emitted empty;
- a pure `browserRow(question)` whose output contains **no key whose value
  equals** `question.correctAnswer` / `question.CorrectAnswer`, across every
  field-name variant the shipped code juggles. Put a correct answer in the
  fixture and watch it fail — this is the assertion that keeps the answer off
  the stage;
- the SPACE rule, three cases: target on `document.body` → advanced; target
  inside `.setup-panel` → did not; target the search `<input>` → did not;
- `Esc` closes and `document.activeElement` is the `SETUP` button —
  `activeElement` is real in jsdom;
- the QR values: the panel's `QRCodeSVG` receives a value matching
  `/\/remote\?gameId=/`, the panel contains no text matching `/join/i` in the
  remote section, and the rail overlay still receives `playUrl`.

Requires a human in a browser: that opening the panel does not re-trigger the
fitter (read `--fit` and the dropped `data-drop` set before and after, on a
dense state); that the panel clears the dock (A6); that the panel scrolls and
nothing else does; contrast at each of the four profiles; a clicker pass, since
a presentation clicker sends keys with no meaningful `event.target`.

---

## 4. Stream D — the scoreboard

**Build the podium from `docs/design/host-redesign/10-ended.html`** (`.pod`
cards; `.nm` already wraps, a truncation fix made against **two** cards that
needs re-measuring at three), and place it on RESULTS per
`06`/`07`/`08-results-*.html` and `21-results-revealed.html`.

Three corrections to `10-ended.html`, argued in the ENDED review: its
`Rounds captured · All eight · 100%` stat can only ever read 100% and is
deleted; the podium slot is three cards, not one champion plus that stat; and
the participation figure must move **out** of the `data-drop` group, since the
mockup currently drops the one number the owner asked for first.

### 4.1 Where it lives

**A `.podium` block inside `.content`, on RESULTS and ENDED. Not the meter, not
the panel.**

1. **The meter cannot hold it** — `GameHostPage.jsx:3590-3592` returns `null`
   for RESULTS, FIELD_NOTES and ENDED. The podium exists exactly and only in the
   states where the meter does not.
2. **Even if it could, the meter is the first thing sacrificed** —
   `fitPolicy.js:65` enters it at priority `-1`, ahead of every `data-drop`
   group. A podium that disappears on the densest results screen is worse than
   no podium, because the host has promised it.
3. Being **content**, it may not be dropped and may not be clamped (A2/A11); it
   earns its space through the scale search like everything else.

### 4.2 Gating

**`standingsVisible({ gameType, anonymousUntilReveal, authorsRevealed })`** — the
same predicate the answer cards already use (`:4383-4387` region). On ENDED,
gated on the reveal having happened.

Note `authorsRevealed` here is *whatever currently decides the labels* — on the
RESULTS stage that is the local display toggle, so hiding the names takes the
arithmetic with it. That is the existing, correct semantics; do not change it.

### 4.3 Capability, not game type

**Gate on "does this session have score records", not on the type string.**

Wavelength writes no scores at all: `get-results.js:952-960` builds a
`teamScoring` map where `totalScore` is hardcoded `0` with the comment *"Will be
calculated elsewhere"* — nothing calculates it. `GameHostPage.jsx:2323` zeroes it
again (`points: 0, // No points in wavelength`). The only
`PLAYER#{name}#SCORE` row a wavelength player holds is the zero written at join.

Survey is flagged rather than settled — `gameTypes.js:64-69` records that it runs
a vote phase only because nothing excludes it. A capability gate means survey
cannot produce an empty podium if that ever changes.

**Wavelength gets no podium.** Per the owner's earlier ruling and the code.

### 4.4 The backend prerequisite

**`create-report.js:590` sorts `playerPerformance` by `gamesWon`.** `gamesWon`
derives from `result.Winners` (`:523-527`), which is written **only** in the
vote-tally branch at `get-results.js:546`. Trivia never writes it. So every
trivia player is `gamesWon: 0` and the report's ordering is whatever DynamoDB
returned. `totalScore` on the same object (`:557`) is correct; the sort key is
not.

**Sort by `totalScore`.** This changes no pixel and is a prerequisite for the
podium being truthful anywhere it reads from the report.

Two neighbouring Tier-0 corrections from the ENDED review are **noted and
deferred** — they are not prerequisites for this stream and each deserves its
own change: `participationRate`/`votingParticipation` telling the model every
round had 100% participation (`get-ai-summary.js:1511,1599`), and
`gameStats.totalPlayers` counting `PLAYER#`, `#SCORE` and `#STATE` rows together
(`create-report.js:115`).

### 4.5 The RoomMeter test

**It stands, unmodified.** `stageShell.test.jsx:268-275` asserts that
`RoomMeter`, *given a `players` prop*, renders no names. The podium is not
rendered by `RoomMeter` and never will be, so `players` stays an unread prop and
the test keeps its exact meaning. **If it needs changing, the change is wrong.**

Two things do change:

1. `RoomMeter.jsx:12-16`'s docstring is now over-broad and is **narrowed, not
   weakened**. A **roster** is every name, unordered, complete, and says who is
   present and who is late. A **podium** is three names, ordered, earned, and
   says what the room just did. Say that, so the next reader does not take the
   podium as the rule being abandoned.
2. The carve-out gets its own test where it lives: the podium renders **at most
   three** entries given twenty players, and renders **nothing** when
   `anonymityActive(...)` and authors are not revealed. The second is the one
   that matters.

Audit check **A13** — no roster name in a stage document unless it declares
`data-attribution="revealed"` — means the podium must carry that attribute,
which is conveniently the same condition as the gate.

---

## 5. Stream E — the remote's AI beat

**Build from `docs/design/host-redesign/17-remote.html`** — the phone's layout,
its status card, its primary control and its confirm behaviour are the mockup's.
The AI text the phone renders follows `09-field-notes.html`, reflowed to a phone
column.

**The mockup is far ahead of the shipped remote.** It already draws, and the
shipped `HostRemote.jsx` has none of: the **waiting list by name** (`Still to
vote · Dana, Tomás, Jordan…`) with its own privacy rationale printed beside it;
a `This round` block (`Choose next question`, `Expand on stage`, `Timer 2:00`,
`Skip round`); a `Session` block (`Categories`, `Join code`, `Session report`,
`Switch game`); and a full question browser on the phone **including the correct
answer**, which is right — the stage browser shows what a question is *about*,
the remote shows what it *says*.

Only one thing here is not in the mockup: the **What We Heard** beat in the
RESULTS control (§5.3), which is the owner's ruling 4.

**Scope for this stream:** the beat (§5.3), the AI text (§5.4) and the waiting
list (§5.5). The mockup's `This round` and `Session` blocks and its phone
question browser are **real, designed, unbuilt work** — they are noted here so
they are not lost, and they are their own change. The timer in particular is a
feature that does not exist anywhere (§2.3).

### 5.1 The gap

`config/hostRemote.js:145-146` returns `next` for RESULTS. The host's
`hostControlsFor` returns `field-notes` (`hostControls.js:190-198`). **The remote
skips the AI beat entirely.**

### 5.2 Why this needs a backend change

- `resultsBeat` is **client-only** React state — four references, nothing
  persists or broadcasts it (`GameHostPage.jsx:312,313,3509,3554`).
- **There is no display channel.** All eleven host WebSocket types
  (`GameHostPage.jsx:936-1082`) are game-state facts. The only display commands
  are `postMessage` into a window the remote itself opened
  (`HostRemote.jsx:272-286`) — useless across devices, which is the entire point
  of scanning the QR.
- The remote is **HTTP-only**, polling `/state` every 2s and `/players` every 6s
  (`HostRemote.jsx:64-65`). It holds no socket, deliberately — see its `:48-56`
  comment on host-row eviction.

### 5.3 The design

**`POST /games/{gameId}/stage-beat`**, body `{ beat: 'results' | 'field-notes' }`,
**behind the Cognito authorizer** like `close-round`. It:

1. writes `StageBeat` on the round record;
2. broadcasts `stageBeatChanged` using the existing `broadcastToGame` helper
   (the pattern at `next-question.js:340-395`).

`get-game-state.js` returns `StageBeat` in its payload. Both surfaces then read
one source of truth.

**The host's own stage button posts too.** That is what makes it bidirectional:
tap it on the projector and the phone follows; tap it on the phone and the
projector follows. A host page reload does not lose the beat.

`GameHostPage` gains a `stageBeatChanged` handler that sets `resultsBeat`.

> **Watch `GameHostPage.jsx:313`** —
> `useEffect(() => setResultsBeat('results'), [currentQuestionId, gameState])`.
> A beat push does not change `gameState`, so it does not fire. But any change
> that starts writing `gameState` on re-sync will silently knock the stage back
> to the tally beat. Note it in the code.

`hostRemote.js` gains the RESULTS two-step in `primaryAction`: *What We Heard*
when `StageBeat !== 'field-notes'`, then *Next Round*. Pure function, unit-tested
against every `(gameType × phase)` pair like the rest of that module.

### 5.4 The AI text on the phone — no backend

`GET /games/{gameId}/ai-summary` is **public, no authorizer**
(`template-clean.yaml:744`) and returns `summary`, `summaryText`,
`discussionQuestions`, `nextSteps`, `markdownResponse`. The remote fetches it
directly.

*(Note the client renames `discussionQuestions` → `discussionTopics` at
`GameHostPage.jsx:775`; the remote should read the server's name.)*

### 5.5 The waiting list — already designed, no new endpoint

**Build it from `17-remote.html`**, which draws it as a `Still to vote` /
`Still to answer` block of name chips under the progress count, with a
`Private` note beside it. Keep that note — it is the argument for why the list
is allowed, printed where the person holding the phone can read it.

`GET /games/{gameId}/players` already returns, per player, `playerName`,
`totalScore`, `isConnected`, `ranking` and
**`readiness: { isReady, type, hasAnswered, hasVoted }`** (`get-players.js:101-152`),
plus a `stats` block.

**The remote already polls this every 6 seconds and throws it away**, keeping
only `data.stats.totalPlayers ?? data.players.length`
(`HostRemote.jsx:155`). Keep the array; filter on `!hasAnswered` during ASK and
`!hasVoted` during VOTE.

This is on the allowed side of the project's own anonymity rule, which
`message.js:592-614` states as permitting *who has not acted* while forbidding
*who wrote which answer*. `get-players.js` never returns answer text.

### 5.6 Blocked on a deploy

This is the only stream with a `template-clean.yaml` change, so it cannot be
verified in dev until the owner deploys. **The pipeline is the only route.**
Everything else in this program is frontend-only.

---

## 6. Sequencing

Streams B, C and D all edit `GameHostPage.jsx`. They are sequenced, not
parallelised.

| Wave | Work | Files |
|---|---|---|
| **0** | Diagnose the *What We Heard* defect | investigation only |
| **1** | **A** ‖ **E** | `App.jsx`, `auth/`, new `RootPage` ‖ `HostRemote.jsx`, `config/hostRemote.js`, lambda, template, small `GameHostPage` wiring |
| **2** | **B** | `GameHostPage.jsx`, new `GameSetupDialog.jsx`, `PlayerPage.jsx`, `gameTypes.js`, `gameSession.js` |
| **3** | **C** | `GameHostPage.jsx`, new `SessionSetupPanel.jsx`, `Dock.jsx`, `HostActionBar.jsx` |
| **4** | **D** | `GameHostPage.jsx`, `RoomMeter.jsx`, `create-report.js` |

Wave 0 is blocking: if the stage's own *What We Heard* button is unreachable,
Stream E is building a remote control for a button that does not work.

---

## 7. Landmines that bind every stream

**Tests that look like coverage and assert nothing** are this codebase's
dominant failure mode. **For every test, name the implementation it would
reject. If the answer is "none", say so rather than padding the count.**

**Test the call site, not just the module.** Three defects shipped past full
green suites recently, all invisible to unit tests of the units involved: an
ARIA `role="button"` that got no keyboard activation; a same-origin guard that
was an open redirect because browsers normalise backslashes; and an entire
OAuth return-path fix that was dead code because the route hardcoded its
destination.

**`setupTests.js`'s `window.location` mock is a silent no-op** under jsdom 26 —
`delete window.location` returns `false`, so every assignment to
`pathname`/`search` is an ignored navigation. It is the root cause of three of
the five failing frontend suites. **Do not fix it inside any of these streams**
— it moves the frontend baseline and deserves its own change. Route through
`auth/navigate.js` instead.

**jsdom has no layout engine.** Every geometric assertion returns zero and
passes unconditionally. Verification is a human in a browser, at the projected
size, **varying the configuration and not just the state** — a walkthrough of
every phase once missed a Critical because no measurement was taken with a side
panel open.

**`GameHostPage` cannot be rendered in jsdom at all** — it dies on the auth
provider. The established workaround is to extract the decision into a pure
module and test that (`config/hostControls.js`, `config/anonymity.js`,
`utils/hostOverlays.js`). Asserting against source text is a last resort.

**`hostControlsFor` rewrites an unrecognised phase to `LOBBY`.** Adding a phase
without adding it to `HOST_PHASES` produces something that looks like it works
and renders the lobby.

**Do not delete the expanded-lesson modal.** It is the recovery path for a
dropped ASK prompt, which the fitter sacrifices on a dense round.

**`ArchiveManager.jsx` and `ArchiveSearch.jsx` are dead** — single-line escaped
garbage, not valid JS, imported by nothing. Exclude them from sweeps.

**Never deploy.** The pipeline is the only route to any tier, and `CLAUDE.md`
reserves it to the owner.

## 8. Baselines

| Suite | Command | Expected |
|---|---|---|
| Backend | `for t in tests/*.js; do node "$t"; done` | **28 suites, 927 passed, 0 failed** |
| Frontend | `cd src && npx jest __tests__/` | 5 failed suites / 30 failed / **445 passed** |
| Build | `cd src && npm run build` | compiles, 2 pre-existing size warnings |
| Template | `sam validate --lint -t template-clean.yaml` | valid |

Aggregate the backend with `grep -E '^[0-9]+ passed'`, **never** `tail -1`, and
**assert the suite count** — a crashed suite prints no result line, so a
grep-based aggregate silently drops it and reports "0 failed". The ten
`tests/*.spec.js` files are Playwright and legitimately print no result line.
