# Setup / New Engagement — mockup vs. shipped

**Subject:** `docs/design/host-redesign/20-setup.html` reviewed against the shipped
create-engagement overlay in `src/src/GameHostPage.jsx:3236-3466` and its submit
handler `handleStartNewGame` (`src/src/GameHostPage.jsx:2557-2676`).

**Status:** review only. Nothing in the application was modified.

---

## 0. The two things to read first

Two findings outrank everything else on this page, and neither is a matter of taste.

1. **The mockup's anonymity copy is the version the owner explicitly rejected on
   the same day it was drafted.** Shipped copy is correct; mockup copy is a
   promise the system does not keep. Section 2.
2. **The trivia timer field in the shipped app is dead.** The host types a
   number, the app tells them "Players will have 30 seconds to answer each
   question", and the value is dropped on the floor by
   `lambda-functions/websocket/create-game.js:9` before it ever reaches the
   database. Nothing in the product reads a trivia timer. The mockup deletes
   this field, and deleting it is the correct call — but only because the
   feature does not exist, which is not what the mockup thought it was saying.
   Section 1.

---

## 1. Verdict per field

Every field on either side. "In app?" refers to the shipped overlay
(`GameHostPage.jsx:3236-3466`); "In mockup?" to `20-setup.html:766-837`.

| Field | Mockup | App | Recommendation | Reason |
|---|---|---|---|---|
| **Event title** | Yes (`20-setup.html:770-772`) | Yes (`GameHostPage.jsx:3242-3251`) | **Keep both.** Adopt the mockup's plainer label ("Event title", no colon). | Required by the submit guard (`GameHostPage.jsx:2558`, and the button's `disabled` at `:3458`). It is also dual-purpose — `eventTitle` is a per-game key (`config/gameSession.js:105`) that the live host screen reads — so this input cannot simply become local form state. See §5. |
| **Event details** (optional, 300 chars) | **Dropped** | Yes (`GameHostPage.jsx:3253-3266`) | **Keep the field, fix the help text — or drop the field.** Recommend: keep, and change the help text. | The value is stored (`create-game.js:37` → `schema-compliant-manager.js:87` as `Details`) and the API does return it to participants (`lambda-functions/game/get-game.js:102`, `engagementInfo`). But **no frontend renders it** — `grep engagementInfo src/src` returns only the two *send* sites (`GameHostPage.jsx:2620`, `QuickstartMenu.jsx:82`). So the shipped help text "This information will be shown to participants when they join" (`:3264`) is **false today**. The data path is one component away from being real; the copy is a lie right now. Either wire the player side and keep the promise, or cut the sentence. Do not silently delete a field whose payload the backend already persists. |
| **Format / Engagement type** | Yes — 5 pill buttons (`20-setup.html:775-783`) | Yes — 3-option `<select>` (`GameHostPage.jsx:3268-3282`) | **Adopt the mockup's control. Add poll; hold survey — see §3.** | Pills show all options at once and are a bigger target; a `<select>` hides the choice behind a click and is the reason nobody noticed poll and survey are missing. The app's version is also mislabelled in its own source comment (`:221`: "'call-and-answer', 'trivia', or 'wavelength'"). One caveat: `gameTypes.js` already carries `label`, `icon`, `accent` and `blurb` for all five (`src/src/config/gameTypes.js:11-78`); the picker should render from `GAME_TYPE_LIST` (`:140`) rather than hand-listing options, so it cannot drift again. |
| **Format blurb / one-line description** | No | No | **Add.** | `blurb` exists on every type (`gameTypes.js:20,33,44,58,74`) and is rendered **nowhere** in `src/src` — dead data. Under a pill picker it costs one line and answers "what is Wavelength?" without a manual. It is also the natural home for the Wavelength group-size guidance (§6). |
| **Question set** | Yes (`20-setup.html:786-789`) | Yes (`GameHostPage.jsx:3284-3308`) | **Keep the app's.** | The app filters sets by the selected type (`:3301`), shows the question count, and appends an image marker (`imageMarkerSuffix`, `:3304`). The mockup's single hardcoded option shows none of that. The app's version is strictly better and the filter is what makes adding poll/survey safe (§3). |
| **Categories** | Yes — one `<select>` "All four categories" (`20-setup.html:790-793`) | Yes — multi-select button grid with per-category counts (`GameHostPage.jsx:3310-3335`) | **Keep the app's, unambiguously.** | A poll/trivia set has 4-24 categories with wildly different question counts; a single-value `<select>` cannot express "these three, not those five", which is the actual job. The app also states the empty-selection rule out loud (`:3328-3331`: none selected = all included), which the mockup does not. This is the clearest case in the document of the shipped app beating the mockup. |
| **Trivia timer** (10-300s) | **Dropped** | Yes, trivia only (`GameHostPage.jsx:3337-3353`) | **Drop the field. Do not "restore" it.** | `handleStartNewGame` sends `triviaTimer` (`:2626`) and `QuickstartMenu.jsx:88` sends it too, but `create-game.js:9`'s destructure is an explicit whitelist that does not name it — and its own comment says so verbatim: *"`triviaTimer` was sent by the frontend for months and silently discarded that way."* `grep -rn "triviaTimer\|TriviaTimer" lambda-functions src/src` finds **no consumer anywhere**. There is no countdown in the player UI and none on the host stage. So the shipped field is a control that does nothing plus a sentence that is untrue. Cutting it is right. **But note the mockup contradicts itself**: `20-setup.html:180-187` defines a `.rail-timer` and its comment says the timer is *"armed from the setup panel"* — a panel that in the same file has no timer control. If the redesign wants a round timer, that is a **new feature** with a backend field, a broadcast and a player-side clock, and it should be planned as one; it is not a field to keep. |
| **Randomize / Shuffle question order** | Yes, toggle, default on (`20-setup.html:824-831`) | Yes, checkbox, default on (`GameHostPage.jsx:3355-3371`, default at `:223`) | **Keep. Adopt the mockup's label and the app's help text.** | "Shuffle the question order" is plainer than "Randomize Question Order". But the app's help text states **both** branches (`:3366-3369`) — critically, that non-random means "completing each category before moving to the next", which is not guessable. The mockup only describes the on state. Keep the two-branch text. |
| **Anonymous responses** | Yes, rich card with previews (`20-setup.html:798-822`) | Yes, checkbox + two help lines (`GameHostPage.jsx:3376-3400`) | **Adopt the mockup's card. Reject the mockup's copy.** See §2. | The mockup's structure is better: an explicit on/off switch, a while-voting / after-reveal preview pair (`:805-816`), the "turn it off and…" counterfactual (`:817-818`), and a plainly-worded limits box (`:819-821`). The app has the limits sentence but not the previews and not the counterfactual in the on state. Both sides correctly gate the whole section on `anonymityApplies(engagementType)` (`GameHostPage.jsx:3376`; mockup states the same rule in prose at `:838-842`) — and the app checks the *dialog's* type, not the live game's, which is subtle and correct (comment at `:3373-3375`). |
| **AI context** (optional, 500 chars) | **Dropped** | Yes (`GameHostPage.jsx:3402-3415`) | **Keep — but move it.** | Unlike the timer, this one is **live**: stored as `AIContext` (`schema-compliant-manager.js:82`), read at `lambda-functions/game/get-ai-summary.js:1013`, and injected into the Bedrock prompt as `SESSION BACKGROUND:` (`get-ai-summary.js:1345-1346`). Dropping it silently degrades every AI summary in the session. It is, however, the least urgent field on the screen and the only one a host will ignore 90% of the time. Put it behind a collapsed "Advanced" disclosure rather than as the third-largest textarea on the page. |
| **Workie's Voice / persona** | **Dropped** | Yes (`GameHostPage.jsx:3417-3440`) | **Keep — collapsed, next to AI context.** | Also live: `personaId` is whitelisted (`create-game.js:9,36`), stored (`schema-compliant-manager.js:86`), and resolved host→set→context→inferred (`get-ai-summary.js:1019-1020,1322-1333`). The default `''` ("Adapt to the session") is the designed behaviour and the comment records why (`:3425-3427`): a fixed persona is what made Workie refuse an icebreaker as "insufficient for business analysis". So the *default* is right and most hosts should never touch it — which is an argument for hiding it, not for deleting it. |
| **Visibility / access code** | No | No | **Add. See §4.** | Backend accepts (`create-game.js:9,39-40`), stores (`schema-compliant-manager.js:58-59,88-89`), and fully enforces (`join-game.js:53-92`). Participant design exists (`docs/design/entry-redesign/06-join-private.html`). No host UI sets either — so private sessions are unreachable. |
| **Wavelength group-size guidance** | No | No | **Add. See §6.** | New owner requirement. |
| **Cancel** | Yes (`20-setup.html:834`) | Yes (`GameHostPage.jsx:3444-3454`) | **Keep the app's behaviour.** | The app's Cancel returns to the welcome screen when the host was not already in a game (`:3448-3450`). The mockup's button has no defined destination. |
| **Create engagement** | Yes (`20-setup.html:835`) | Yes (`GameHostPage.jsx:3455-3461`) | **Keep, but fix what happens next.** | The app disables it until a set and a title exist (`:3458`) — good, and better than the mockup, which shows an always-live button. What follows is the problem: see §1.1. |

### 1.1 What happens after Create — a defect neither side designs

On success the app does **not** open the game. It closes the dialog, refetches
the games list, and opens the reports modal in `select` mode
(`GameHostPage.jsx:2648-2653`). The host lands in a list of every game they have
ever made and must find and click the one they just created.

Three things make this worse than it sounds:

- The log line claims the new game is highlighted
  (`GameHostPage.jsx:2650`: *"Show game history with the new game highlighted"*).
  It is not. `newGameId` is never passed to the modal and nothing in the list
  renderer (`:3060-3215`) marks it.
- The other create path does the opposite. `QuickstartMenu.createQuickGame`
  creates the game, **starts** it (`QuickstartMenu.jsx:103-107`), sets the URL
  and hands straight off to the live session (`:121-124`). Same product, two
  create flows, two different destinations.
- The mockup has no opinion here at all, which is a gap in the mockup.

**Recommendation:** after create, go where Quickstart goes — into the game's
lobby. The reports modal in `select` mode is a *browse* surface being used as a
*confirmation* surface. If the owner wants the list, at minimum pass the new
gameId through and highlight it.

---

## 2. The anonymity copy ruling

**The shipped copy is true. The mockup's copy is false. Keep "until voting
closes".**

- Mockup (`20-setup.html:803-804`): *"**Until you reveal them**, nobody sees who
  wrote which answer — not the room, not you."*
- Shipped (`GameHostPage.jsx:3391-3392`): *"**Until voting closes**, nobody sees
  who wrote which answer — not the room, not you."*

### The evidence

The gate is `isHidden` in `lambda-functions/game/anonymity.js:50-64` (and its
byte-identical twin `lambda-functions/websocket/anonymity.js`):

```js
const anonymous = prefs.anonymousUntilReveal !== false; // default ON
const revealed  = !!(round && round.AuthorsRevealed);
return anonymous && !revealed;
```

So everything turns on who writes `AuthorsRevealed`. Two writers:

1. **`enterResultsState`** in `lambda-functions/game/get-results.js:207-217` —
   an **unconditional** `SET AuthorsRevealed = true` executed as part of closing
   the round. Its own comment (`:195-198`) reads: *"VOTING HAS CLOSED, SO THE
   PROMISE IS DISCHARGED. The room was told 'nobody sees who wrote what — the
   host included — until voting closes', and this is that moment."*
2. **`POST /reveal-authors`** (`lambda-functions/game/reveal-authors.js:86-94`),
   whose header (`:4-9`) states it is now only load-bearing for a host who
   reveals *before* closing the vote, and is otherwise an idempotent no-op.

The host client mirrors this: `handleShowResults` sets `authorsRevealed` locally
the moment results open (`GameHostPage.jsx:2364-2367`), and `handleRevealAuthors`
is documented as the *early* reveal, reachable only from ASK/VOTE
(`GameHostPage.jsx:2396-2411`).

The decision is recorded in writing, dated the same day as the mockup:

- `docs/superpowers/plans/2026-08-09-anonymous-responses.md:18` — *"(Owner
  decision, 2026-08-09, amending Tasks 8 and 10.) The promise this feature makes
  is … **until voting closes**, not 'until the host presses a button'."*
- Same file `:25` fixes the exact wording: *"Nobody sees who wrote what — the
  host included — until voting closes."*
- `docs/handoff/anonymous-responses-2026-08-09.md:34` — *"The promise was always
  'until voting closes'; the build had drifted to 'until the host presses a
  button'."*

The mockup's own source, `docs/superpowers/plans/2026-08-09-anonymous-responses.md:1804`,
still carries the pre-amendment sentence. **The mockup is a snapshot of the
drifted copy the owner corrected.**

### Why the mockup's version is the dangerous direction, not merely the stale one

"Until you reveal them" tells the host they hold the switch. They do not. A host
who reads that sentence and then closes voting to show the tally has just
attributed every answer, believing they had not. There is no configuration in
which names stay hidden past the close of voting — the RESULTS-phase "Hide
authors" control is **display-only** and un-sends nothing
(`reveal-authors.js:27-30`; `config/anonymity.js:66-68`: *"DISPLAY ONLY, AND SAY
SO … It is a projector control, never a security control."*).

The mockup also carries the error into its preview panel, which labels the
second card **"After you reveal"** (`20-setup.html:812`). That card should read
**"After voting closes"**.

### Recommended copy

Adopt the mockup's card structure with the shipped sentence, plus one clause the
neither side has that closes the last gap — that the host *can* reveal early:

> **Until voting closes, nobody sees who wrote which answer — not the room, not
> you.** The room votes on the answers, not on the people. When the round's
> results open, every answer is attributed. You can also reveal the names
> earlier if you want to.

Keep the app's limits sentence verbatim — it is the one the plan mandates
(`plan:24`: *"Never overclaim"*) and the mockup's longer version
(`20-setup.html:819-821`) says the same thing at three times the length. Either
is defensible; the app's is shorter and already shipped.

Preview card headings: **"While voting"** / **"After voting closes"**.

---

## 3. Poll and survey in the picker

**Recommendation: add poll now. Do not add survey — it cannot be played.**
The mockup's five-type picker is right about four of them.

### The picker is missing types the rest of the app already knows about

`src/src/config/gameTypes.js:11-78` defines all five with labels, icons, accents,
phases and blurbs. `GAME_TYPE_LIST` (`:140`) exists specifically as the "ordered
list for pickers/filters". `anonymityApplies()` returns true for
call-and-answer, poll **and survey** (`config/anonymity.js:19-21` via
`hostRunsVotePhase`), and a test asserts exactly that
(`src/src/__tests__/anonymitySetup.test.js:16-18`). The shipped `<select>`
(`GameHostPage.jsx:3270-3282`) hand-lists three of the five, and its own state
comment repeats the omission (`:221`). This is a picker that drifted from a
table built to prevent drift.

### Poll: add it

- **Question sets exist and upload cleanly.** `lambda-functions/admin/upload-questions.js`
  has a first-class poll branch — header detection at `:301`, per-row parsing at
  `:445`.
- **The round runs.** Poll is not in `TYPES_THAT_SKIP_VOTE`
  (`config/hostControls.js:59`), so it goes ASK → VOTE → RESULTS, the same path
  call-and-answer takes today. `gameTypes.js:43` agrees.
- **The player screen already speaks poll.** `PlayerPage.jsx:1846` ("Response
  Submitted!"), `:1860` ("Vote for the Best Response"), `:1866` ("Which response
  best captures where the room should land?"). The header comment at
  `PlayerPage.jsx:71` records that this was fixed *because* the type used to be
  hardcoded.
- **Host instructions exist.** `GameHostPage.jsx:3698-3709` renders a poll block.
- **Player prompt exists.** `config/instructions.js:25`: *"Share your opinion:"*.
- **Anonymity applies and is already wired** (`anonymity.js:19-21`).

**What breaks if poll is added: nothing, and the picker fails safe.** The
question-set dropdown filters by `set.engagementType === engagementType`
(`GameHostPage.jsx:3301`). A host who picks Poll with no poll sets loaded sees an
empty list, and Create stays disabled because `newGameSetId` is empty (`:3458`).
That is the correct degenerate behaviour and it is already implemented.

**One caveat, worth telling the owner but not worth blocking on.** Upload parses
poll `Options` / `AllowMultiple` columns (`upload-questions.js:301,445`), but
`lambda-functions/game/get-question.js:154` forwards options for **trivia only**.
So a poll round today plays as free-text-then-vote — call-and-answer with
different wording — and any multiple-choice options in an uploaded poll set are
stored and never shown. Poll is genuinely playable; it is just not yet the
multiple-choice format the upload template implies. Adding it to the picker does
not create that gap, it exposes one that already exists.

### Survey: do not add it

`upload-questions.js:146-157` **rejects survey uploads outright**, and the error
string states the reason in full:

> *"Survey upload is not yet supported. Survey JSON templates can be downloaded
> and edited, but surveys cannot be imported as playable question sets until game
> sessions support the survey engagement type."*

The comment above it (`:146-149`) is equally explicit: surveys have no playable
representation, so importing one "would create a set that can never be played."

Consequences, in order:

1. **No survey question set can exist**, so the set dropdown for Survey is
   permanently empty and Create is permanently disabled (`:3458`). The pill would
   be a dead end that looks like a feature.
2. The two type tables **disagree about survey's phases**, and the disagreement is
   documented rather than resolved: `gameTypes.js:68-73` records that survey
   falls through to a vote phase and flags that this "may not be what was
   intended"; `config/hostControls.js:20-31` states plainly that
   `GAME_TYPES[].phases` and the runtime graph disagree for survey and
   wavelength, and that reconciling them "is a separate change".
3. Survey has a player prompt (`instructions.js:28`) and nothing else — no host
   instructions block, no player-screen branch (the poll branches at
   `PlayerPage.jsx:1846,1860,1866` do not include it).
4. `docs/handoff/admin-prompt-cleanup-plan.md:49` records that survey is not a
   member of any canonical game-type list; it exists only as a standalone
   generator (`lambda-functions/admin/ai-generate-survey.js`) and in the upload
   UI's type dropdown (`AdminPage.jsx:1421`).

**So the picker should offer four, not five: Call & Answer, Trivia, Poll,
Wavelength.** Survey is a half-built format, and the honest place to say so is a
plan, not a disabled pill. When survey upload lands, adding the fifth pill is a
one-line change — because the picker will be rendering from `GAME_TYPE_LIST`.

**If the owner wants five anyway**, the minimum to make survey real is: lift the
upload block (`upload-questions.js:146-157`), decide the phase question that
`gameTypes.js:68-73` deliberately left open (does a survey hold a vote?), and add
the player-screen branch. Note that decision has an anonymity consequence:
`anonymityApplies()` derives from `hostRunsVotePhase()` (`anonymity.js:19-21`), so
removing survey's vote phase also removes its anonymity option — and a survey is
arguably the format that needs it most. That is a design decision, not a
refactor.

---

## 4. Visibility and access code

**Recommendation: add it, as one control, with a narrow scope.**

The whole path exists except the host's end of it:

- `create-game.js:9` accepts `visibility` and `accessCode`; `:39-40` passes both
  to `createGame`.
- `schema-compliant-manager.js:58-59` and `:88-89` persist `Visibility` and
  `AccessCode` on the metadata items.
- `join-game.js:53-92` fully enforces: private + no stored code → 500 config
  error; private + no supplied code → 401 `Access code required`; wrong code →
  403.
- The participant side is **already built**: `PlayerPage.jsx:101` holds
  `accessCodeInput`, `:1014` and `:1092` send it, `:1515` renders the field.
- The participant *design* is done: `docs/design/entry-redesign/06-join-private.html`,
  with rationale at `docs/design/entry-redesign/RATIONALE.md:356-364`.
- `get-game.js:64` returns `visibility` to everyone and `:79` returns
  `accessCode` to the host, so a running session can display its own code.

So today: every enforcement branch in `join-game.js:53-92` is unreachable, the
whole `PlayerPage` access-code UI is dead code, and a completed design sits
unbuilt — all because no create call ever sets `visibility: 'private'`.

**Scope it small.** One toggle plus one text input, in the same "Responses"
region as anonymity, since both answer "who can see this":

- Default **public** — the opposite of the anonymity default, and deliberately.
  Anonymity defaults on because the safe state costs nothing; a private session
  defaults off because a host who did not ask for a gate must not be handed one
  they then cannot open in front of a room.
- Show the code input only when private is on. Do not format-constrain it —
  `RATIONALE.md:362-364` is explicit that the code is host-chosen and of unknown
  shape.
- **Guard the invalid state the backend already fears.** `join-game.js:60-67`
  returns a 500 *"Game configuration error"* for private-with-no-code. The setup
  screen must make that unreachable: disable Create while private is on and the
  code is empty. This is the single highest-value line of validation on the
  screen, because its failure mode is a room of people who cannot join and an
  error message that tells them nothing.
- The QR/join panel on the live host screen will need to show the code too,
  otherwise the host has locked the room and cannot tell anyone the key. That is
  a second, small piece of work and it should be planned in the same change —
  shipping the setup half alone creates exactly the trap above.

**Do not** invent visibility levels beyond `public` / `private`.
`join-game.js:55-57` branches on the single string `'private'`; anything else is
treated as public, silently.

---

## 5. Structure — component, not route

### Should it be a route?

**No.** Two reasons, and the first is decisive.

`src/src/App.jsx:141-222` is a hand-rolled router: it reads
`window.location.pathname` once and returns a component. There is no history
integration, no client-side navigation — the only URL writing in the host flow
is `window.history.replaceState` for query params (`QuickstartMenu.jsx:115-118`).
Making setup a route therefore means a **full page load**, which destroys the
in-memory host session, the WebSocket connection and every per-game value. The
setup screen's entire job is to hand off state to that session. A route is the
one shape that cannot do it.

Second: setup is not addressable in any useful sense. There is nothing to
bookmark, link or reload into.

### What it should be

**A `<GameSetupDialog>` component in `src/src/components/`, rendered by
GameHostPage exactly where the early return is today, receiving props and
raising one callback.** That is a real improvement — 230 lines of form leave a
5,180-line file, and the form becomes testable, which it currently is not
(`src/src/__tests__/anonymitySetup.test.js:3-7` explains why: rendering
GameHostPage in jsdom fails on the auth provider, so the setup logic is tested
as pure functions instead).

### The minimum safe extraction

The five entanglements the owner named, and what happens to each:

| Entanglement | Where it lives now | Disposition |
|---|---|---|
| **`eventTitle`** — dual-purpose | State at `GameHostPage.jsx:218`; a per-game key (`gameSession.js:105`, setter mapped at `:410`); bound to the dialog input at `:3247`; carried as a reset override at `:2599` | **STAYS in GameHostPage.** Pass `value` + `onChange` down. Do not move ownership: the live host screen reads it, and `resetGameSession` writes it. |
| **`categories` + `activeCategoryIds`** — dual-purpose, with ordering | Both per-game keys (`gameSession.js:85-86`); the dialog renders and toggles them (`:3315-3320`); `fetchCategories` populates them on set selection (`:3291`) | **STAYS.** Pass `categories`, `activeCategoryIds`, `onToggleCategory` as props. |
| **The read-before-reset ordering** | `handleStartNewGame` calls `leaveCurrentGame()` at `:2598` — which clears `activeCategoryIds` — then reads `Array.from(activeCategoryIds)` at `:2613` from the **pre-reset closure**. It works, and it works for a reason that is invisible at the call site. The same pattern is documented explicitly one function away (`handleSwitchGame`, `:2450`: *"Order matters: read selectedSetId before the reset clears it"*) | **STAYS, and gets safer for free.** If the dialog raises `onCreate({ title, type, setId, categoryIds, ... })` with the selected ids **in the payload**, `handleStartNewGame` no longer depends on stale-closure timing at all. This is the single best argument for the extraction. |
| **`leaveCurrentGame` + overrides** | Defined `:455-459`; the create path passes three overrides (`:2598-2607`) including a pre-computed `anonymousUntilReveal` so the screen never flashes the previous game's flag | **STAYS in GameHostPage, untouched.** The dialog must not know that resetting a game session is a thing. |
| **The four-setter hand-off** | `:2672-2675` — `setGamePersonaId`, `setPersonaSwitchStatus`, `setGameAiContext`, `setNewGamePersonaId` after a successful create | **STAYS in `handleStartNewGame`.** Note two of these are the dialog's own inputs being cleared for next time (`gameAiContext`, `newGamePersonaId`) and two are live-session state being seeded. Splitting them across a component boundary would break the pairing. |

**What actually moves:** the JSX (`:3236-3466`) and the four inputs that are
purely the form's own — `engagementType` (`:221`), `newGameSetId` (`:217`),
`randomizeQuestions` (`:223`), `anonymousResponses` (`:224`), plus `eventDetails`
(`:219`), `gameAiContext` (`:220`) and `newGamePersonaId` (`:236`). Five of these
are already declared out-of-scope by `config/gameSession.js:27-29` ("they are the
form, not the game"), which is the boundary the extraction should follow exactly.

**Two housekeeping notes on that boundary:**

- `gameSession.js:27-29` lists `engagementType, triviaTimer, randomizeQuestions,
  newGameSetId, eventDetails` as deliberately excluded. It does **not** mention
  `anonymousResponses`, `gameAiContext` or `newGamePersonaId`, which are equally
  form-only. The list should be completed when this is touched.
- `anonymousResponses` is never reset between creates. `gameAiContext` and
  `newGamePersonaId` are cleared at `:2674-2675`; `anonymousResponses` is not.
  That is arguably right (a sticky host preference) but it is accidental rather
  than decided. Decide it.

**What must not move:** `handleStartNewGame` itself. It clears the old game's
data server-side (`:2564-2584`), resets, creates, and navigates — four
responsibilities that all belong to the page, not the form.

**Test the boundary.** `src/src/__tests__/gameSession.test.js` already fails if
the setter map drifts from `gameSession.js`. The extraction should add the
mirror assertion: no key in `gameSessionKeys()` is owned by the dialog.

---

## 6. Wavelength: where the group-size guidance lives

**The requirement:** a word counts when *everyone* said it; players give up to 10
words (fewer accepted); matching uses conservative AI clustering; **it works best
with groups of 10 or less** — and that last fact must reach the host at the
moment they pick Wavelength.

**Where it goes: inline, under the format picker, the instant Wavelength is
selected. Not a tooltip, not a help icon, not the question-set description.**

The reasoning is arithmetic, not aesthetics. "A word counts when everyone said
it" means the intersection across N players. Each additional participant can only
shrink that intersection, never grow it. At 25 people the odds that all 25
independently produced the same word are close to nil, so the round produces an
empty cloud — a *correct* result that looks exactly like a broken feature, in
front of a room. The host cannot recover from this mid-session: the group size is
already in the room. The only moment the information can change a decision is
**before Create**, while they are still choosing a format.

That rules out every deferred placement. A tooltip is not read; the question-set
blurb is read after the format is already chosen; the player instructions
(`src/src/config/instructions.js:26` — already correct, *"Enter up to 10 words
that come to mind for this subject"*) reach the wrong person entirely.

**Mechanism:** render `gameTypeMeta(type).blurb` under the picker for every type
— it exists for all five (`gameTypes.js:20,33,44,58,74`) and is currently
rendered nowhere in `src/src` — and give Wavelength a second `caveat` line. One
new optional key on the table, one conditional line in the picker, no new
plumbing.

**Proposed copy** (blurb + caveat, both host-facing):

> **Wavelength** — Everyone writes up to 10 words for the same subject. A word
> counts only when *everyone* said it.
>
> **Best with 10 people or fewer.** Every extra person makes a shared word less
> likely, so large groups tend to finish with an empty board.

Three notes on that wording:

- It says *why*, not just *what*. "Best with 10 or fewer" alone reads as
  arbitrary and will be ignored; the mechanism makes it self-enforcing.
- It states the failure mode ("an empty board") so that if the host runs it with
  30 people anyway, they recognise the outcome as the thing they were warned
  about rather than a bug.
- The existing blurb — *"Word association — the room converges on a shared
  cloud"* (`gameTypes.js:58`) — is now wrong under the new definition. "Converges
  on a shared cloud" describes frequency weighting, not unanimity. Replace it.

**Do not** hard-block or warn on player count at setup: nobody has joined yet, so
there is no number to check. Guidance at choose-time is the only honest option.

**Out of scope for this screen, but flagged:** the new "everyone said it" rule
and the conservative AI clustering are a **behavioural** change to how a
wavelength round is scored. Today's aggregation is frequency-based, not
unanimity-based (`lambda-functions/game/get-ai-summary.js:1931-1945`:
`commonWords` from `wordCounts` entries, with a `connectionScore` computed as
`commonWords.length / totalUniqueWords`). Writing the new setup copy does not
make the new rule true. The copy above should ship **with** the scoring change,
not before it — otherwise this section commits exactly the sin §2 is about.

Related, and already known: `get-ai-summary.js:866` references an undeclared
`commonWords` inside `exports.handler`'s wavelength pass, which is a runtime
`ReferenceError` (`docs/handoff/anonymous-responses-2026-08-09.md:108`). Any
wavelength scoring work will land on top of that.

---

## 7. What I would cut from the mockup

1. **"Until you reveal them"** and the **"After you reveal"** preview heading
   (`20-setup.html:803, 812`). Wrong, and wrong in the direction that harms
   people. §2.
2. **The categories `<select>`** (`:790-793`). A single-value control cannot
   express a multi-select, which is what category filtering is. The app's button
   grid with counts is better and already built. §1.
3. **The hardcoded question-set option** (`:788`). Loses the type filter, the
   question count and the image marker the app already shows.
4. **The always-enabled "Create engagement" button** (`:835`). The app disables
   it until a set and title exist (`GameHostPage.jsx:3458`); that guard should
   survive the redesign, and gains a third clause under §4.
5. **The claim that setup arms a round timer** (`:180-187`, in the `.rail-timer`
   comment: *"armed from the setup panel"*). No such control exists in the
   mockup, and no timer exists in the product. Either cut the comment or plan
   the feature; do not leave a design asserting a capability nothing implements.
6. **The trailing `.setup-note` paragraph** (`:838-842`). Its content is correct
   and valuable — it is the clearest statement anywhere of *why* anonymity
   appears for some formats and not others — but it is design rationale sitting
   outside the panel, addressed to a reader, not a host. Move it into
   `config/anonymity.js`'s header (where two thirds of it already lives,
   `anonymity.js:9-18`) and out of the shipped surface.
7. **The four dropped fields, as a set.** Dropping AI context and persona
   removes live, wired capability (§1); dropping event details removes a field
   whose payload the backend persists and returns; only the trivia timer
   deserves deletion, and only because it never worked. Silence in a mockup
   reads as "delete this" and here it would have deleted three working things.

---

## 8. Summary of recommended changes, in priority order

1. Keep **"until voting closes"**; fix the preview heading to match. Never ship
   the mockup's sentence. *(Correctness — §2.)*
2. Delete the **trivia timer** field, and note in the changelog that it never
   did anything, so nobody "restores" it. *(Removes a false statement — §1.)*
3. Fix or cut the **event-details** help text — it promises participant
   visibility that no frontend delivers. *(Removes a false statement — §1.)*
4. Adopt the mockup's **pill format picker**, driven from `GAME_TYPE_LIST`, with
   blurbs; add **poll**, hold **survey** until it is playable, per §3.
   *(§1, §3, §6.)*
5. Add the **Wavelength group-size caveat**, shipped alongside the scoring
   change it describes. *(§6.)*
6. Change the **post-create destination** to the game's lobby, matching
   Quickstart. *(§1.1.)*
7. Add **visibility + access code**, with the private-and-no-code state made
   unreachable, and the code surfaced on the host's join panel. *(§4.)*
8. Extract **`<GameSetupDialog>`**, moving the seven form-only state values and
   passing selected category ids in the create payload. *(§5.)*
9. Collapse **AI context** and **persona** into an "Advanced" disclosure rather
   than dropping them. *(§1.)*
