# The console — mockup review and recommendation

**Date:** 2026-08-09
**Reviewer:** design review, no implementation
**Subject:** `docs/design/host-redesign/11-console.html`, `18-question-browser.html`, `19-how-to-play.html`
**Against:** the shipped stage shell (`src/src/components/stage/`, `src/src/styles/stage.css`) and the two side panels still living in `src/src/GameHostPage.jsx`
**Spec:** `docs/superpowers/specs/2026-08-08-host-screen-redesign-design.md` §5.4, §5.4.1, §5.4.2, §6.2b, §8
**Also binds:** `docs/superpowers/specs/2026-08-09-host-completion-signal-design.md` §3, §6

> **Note on sources.** The brief named `RATIONALE.md` and `OPEN-QUESTIONS.md` in `docs/design/host-redesign/`. Those files do not exist for this redesign — they exist for `admin-redesign`, `player-redesign` and `entry-redesign` only. The equivalents here are `CRITIQUE.md` and `USER-REVIEWS-2.md`, and both are read below.

---

## 0. Rulings taken as given

1. The pull tabs are deleted. `GameHostPage.jsx:3753-3759` (`.instructions-tab`) and `GameHostPage.jsx:4043-4049` (`.qr-tab`) go, with their CSS. One dock button, everything inside it.
2. Top three on the room's screen, never a roster.
3. The console's QR encodes the **host remote**, not the player join url. The sign-in wall on the phone is accepted.

One naming correction before anything else. **Do not put the word "Console" on screen.** `USER-REVIEWS-2.md:35` records that the proper noun was deliberately killed: *"Nobody in the room needs to learn a proper noun."* The dock button already reads `SETUP` (`Dock.jsx:47`) and the panel heading in the mockup is `Session setup`. "Console" is the internal name for the thing; keep it in code and out of the UI.

---

## 1. What the console contains, in what order, and why

The mockup's section list (`11-console.html`, and §5.4's prose) is close to right but ordered by taxonomy. Order it by **how hot the control is** — what a host reaches for mid-round with thirty people watching goes at the top; what they set once goes at the bottom. The console is the one surface permitted to scroll (§5.4), so cold content below the fold costs nothing, and hot content below the fold costs a live room.

| # | Section | Contents | Where it exists today |
|---|---|---|---|
| 1 | **This round** | `Choose the next question →` (scrolls to §2, does not open a second surface) · `Expand prompt on stage` · `Skip round` (neutral ghost, never `--danger`) | `lessonExpanded` `GameHostPage.jsx:153, 4578`; skip is `HOST_INTENTS.SKIP` `hostControls.js:115, 258-260` |
| 2 | **Questions** | category chips with live remaining counts and on/off toggles, then the browser list beneath them (§3 below) | categories `GameHostPage.jsx:3965-4037`; browser `4658-4744` |
| 3 | **Joining** | copy join link · copy invite · put the join code back on the stage · connection status | `3766-3800`, `3847-3854` |
| 4 | **My phone** | the **remote QR**, inline, plus a text link for the same-machine case (§5 below) | does not exist |
| 5 | **Round timer** | Off / 2:00 / 3:00 / 5:00 with the mockup's one-line caption | does not exist |
| 6 | **Synthesis** | `Rewrite the last summary` | regenerate handler `GameHostPage.jsx:~660-681` |
| 7 | **Display** | profile picker · session report | `3865-3877`, `3878-3880` |
| 8 | **Session** | `Show how this works on the stage →` · switch game · report a problem · sign out | `3886`, `IssueFab` `3884`, `handleSignOut` |
| 9 | **Keys** | four lines: `Space`/`→` advance · `←` step back a beat · `\` open and close · `Esc` close | does not exist |

**Why 1 and 2 are merged in spirit but split in fact.** The mockup has `This round` and `Categories` as neighbours and puts the browser behind a button. Categories and the browser answer the same question at two zoom levels — *which pool does the next question come from* versus *which exact question* — so they belong in one section, adjacent, with the chips acting as the browser's filter. That is what `18-question-browser.html` already draws (`.qb-chip` row above `.qb-list`). It also kills the shipped design's worst structural decision: today the **only** way into the browser is the per-category magnifier button (`GameHostPage.jsx:4012-4023`), which scopes the browser to one category (`fetchQuestionsForBrowsing(category)`, `:1725-1727`) and gives the host no way to see the whole set at once.

**Why the timer is section 5 and not section 2.** It is the mockup's best-received new control (`USER-REVIEWS-2.md:33` — *"That sentence is the whole reason I'll turn it on"*), but it is set once at the start of a session and not touched again. Keep its caption verbatim: *"A countdown appears in the header. It never advances the round on its own."* That sentence is doing the work, not the buttons.

**What the shipped panels do that the mockups missed, and that must not be lost:**

- **Live per-category remaining counts driven by the bitmask** (`GameHostPage.jsx:3936-3961, 3976-3993`). The mockup draws `7 left · on` as static text. The shipped version computes it from `categoryCounts` + `HostMask1-8/9-16/17-24` and disables the button while a toggle is in flight (`isTogglingCategory`, `:4007`). Port the shipped behaviour, not the mockup's badge.
- **`questions remaining` for the whole set**, recomputed over enabled categories only (`:3936-3961`). The mockup's `31 questions left` note is the same number; keep the shipped arithmetic.
- **`exhausted` styling for a category at zero** (`:3998`). Not drawn anywhere in the mockups, and it is the thing that stops a host toggling on a category that cannot yield a question.
- **Connection status** — WebSocket connected / connecting / HTTP polling (`:3784-3800`). The mockups have no equivalent, and it is the first thing a host looks at when the room stops updating.
- **`Copy Invite`** (`:3848-3854`) — a calendar-invite blob, distinct from copying the join link. The mockup only has the link.

**What must NOT move into the console, and this is where I push back on "everything lives inside it":**

The host roster (`GameHostPage.jsx:3817-3845`) — every player's name, their score, and a per-round answered/voted tick. That is precisely the attendance record `RoomMeter.jsx:12-16` refuses, and §11.4/§5.4 make the console **deliberately non-private**: a room can watch it. Putting a by-name "who hasn't answered" list in a panel the host opens in front of people is the leak the spec spent two revisions closing, and `USER-REVIEWS-2.md:334` already caught the mockup asserting the opposite of what a sibling screen did.

Recommendation: **the roster goes to the remote** (`HostRemote.jsx`), which is where §5.4 and §11.8 already put it, and the console keeps counts and the top three. A host with no phone loses the ability to see *who specifically* is missing — which §5.4 argues, correctly, they should not be projecting anyway. Section 4's remote QR is what makes that affordable, and it is the reason the QR change lands in the same review as the roster cut.

---

## 2. Opening, closing, and SPACE

**Opening.** The `SETUP` button already exists in the dock and already takes an `onSetup` callback (`Dock.jsx:36-48`); `GameHostPage.jsx:4105` currently wires it to `setQrSidebarVisible`. This is a one-line repoint, not new chrome. Keep the word `SETUP`; **drop the `⋯` glyph** (`Dock.jsx:46`) — the word and the glyph say the same thing in a 48px target, and §5.4's whole argument for the label was that the glyph alone was unhittable. `\` stays as an accelerator only.

**Geometry — inherit, do not reinvent.** The console must be `position: fixed` with `bottom: var(--dock-measured, var(--dock-h, 0px))`, the exact rule the shipped panels already carry and whose reasoning is written out at `styles.css:400-447`. Two properties depend on it:

- **The stage does not re-fit when the console opens.** `.stage` is `height:100dvh` and the panel is an overlay, so no grid track changes and `useStageFit` is not re-entered. The console must therefore be a **sibling of `<Stage>`**, not a child — anything inside the measured subtree enters `fitPolicy`'s world and a section list of unknown length would drive the scale search to its floor.
- **The dock is a no-overlay zone**, which is audit check A6 (§8) and the reason `--dock-measured` exists rather than `--dock-h` (the dock outgrows its token: measured 100px against 82.8px at 1280×720 in Table).

**Closing.** `✕` in the panel, `Esc`, `\`, click on the scrim. Focus is trapped while open and returns to the `SETUP` button on close (§5.4 correction 3).

**Advancing closes it.** `runHostAction` already calls `closeAllSidePanels()` first (`GameHostPage.jsx:3510`); the console joins that. The reason is not tidiness: half the console's content is round-scoped (this round's actions, remaining counts, the browser's already-asked marks) and a phase change invalidates it in place. Nothing is lost by closing, because every console control commits on click — categories toggle immediately (`:3999-4006`), `Ask next` commits and closes.

**SPACE: the console does not join `anyOverlayOpen`, including its browser section.** This diverges from §5.4.1, which said the browser *is* in `anyOverlayOpen`. That sentence was written when the browser was a separate full-screen modal covering the dock. As a section of a panel that stops at the dock, with the primary button and its `SPACE` chip visibly live beneath it, suppression would make the affordance lie: the chip renders exactly when `!anyOverlayOpen` (`GameHostPage.jsx:3616`), so the host would watch the chip blink out while looking at a live button. Blanket suppression is also what produced the unadvanceable state §5.4 was written to fix.

**But there is a real hazard the spec has not recorded, and it is not the one it guards against.** `isTypingTarget` (`HostActionBar.jsx:34-38`) covers `INPUT`/`TEXTAREA`/`SELECT`/contenteditable only. The handler then calls `event.preventDefault()` (`:62`) — which suppresses the browser's default space-activation of *any* focused button. So a host who tabs to `Ask next` inside the console and presses Space does **not** press the button: the round advances instead, and the question they were choosing is gone. The search box is safe; every button in the console is not.

**Recommended rule, and it is one line:** SPACE stays live while the console is open **unless the event target is inside the console**. `if (event.target.closest('.console')) return;` beside the existing `isTypingTarget` check. Mouse-driven use — the overwhelming case, and the one a host under pressure is in — keeps its accelerator. Keyboard-driven use inside the panel gets the button it is pointing at. This is event-target logic, not geometry, so it is honestly unit-testable (§6).

**The QR overlay's separate rule stands unchanged.** The completion-signal spec §3 puts only the *pinned* rail QR into `anyOverlayOpen`, and that is correct and orthogonal — it is a full-screen overlay that does cover the dock. The console's own QR is inline (§5) and raises no such question.

---

## 3. The question browser as a console section

**What the host actually needs in order to choose:** what the question asks, which category it belongs to, how hard it is, whether it has been used, and a way to narrow forty-seven rows to five. Not the answer. §5.4.1's reasoning is sound and I would not reopen it — *there is no display profile in which the stage is unobserved*, so a reveal control on a shared surface is a trap rather than a feature.

**What `18-question-browser.html` gets right:**

- Search-by-title, category chips, and an `Unasked only` filter, with a live `Showing 8 of 47` count. The shipped browser has **none of these** — it fetches one category and renders every row (`GameHostPage.jsx:1725-1746, 4682-4726`).
- Used questions stay in the list at reduced opacity with an `already asked` marker and `Ask again` (`.qb-row.is-used`). Right call: "did I already use this?" is the question a host asks most, and hiding the row hides the answer to it.
- One `Ask next` per row that commits and closes. The shipped equivalent is a `Select` button (`:4714-4720`).
- Free-text questions render `Free-text response` rather than a fake A/B/C/D block. The shipped browser only draws options when `optionA` exists (`:4701`), which is the same behaviour by accident; make it explicit.
- The privacy line is stated once, without apology, and names the alternative (`Open the browser on your phone to see them`).

**What it gets wrong or omits:**

- **It shows the options and calls that "not the answer".** For a four-option trivia question, `A/B/C/D` on screen plus a host who then picks it is a meaningful narrowing for anyone in the room paying attention. §5.4.1's own justification — *"To choose a question you need to know what it asks, which category, how hard, and whether you have used it"* — does not require the options. I would **cut the option block from the stage browser entirely** and keep title, detail, category, difficulty and used-state. It is a smaller row, more rows fit, and the rule gets simpler: *the stage browser shows what the question is about, the remote shows what it says.* This is a change to §5.4.1, and I am proposing it deliberately.
- **No empty state.** The shipped one has one (`:4727-4732`) and it is better than nothing.
- **No loading state.** Fetching is remote (`fetchQuestionsForBrowsing`); the shipped modal has a spinner (`:4677-4681`).
- **No confirmation on a destructive pick.** `selectQuestion` mid-`ASK`/`VOTE` abandons the live round, and the shipped code correctly confirms first (`:1786-1794`). Keep that — but it currently fires a second full-screen overlay (`expanded-qr-overlay` reused as a scrim, `:4629`) which covers the dock. Route it through a dialog that respects the `--dock-measured` rule.
- **Row numbers (`qb-n`: 12, 13, 14…).** Meaningless to a host — they are set-order indices, not anything the host knows a question by. Cut.

**What must be deleted from the shipped browser:**

- The `correct-answer` row (`GameHostPage.jsx:4707-4709`) — the entire reason §2.6 cut this surface from the stage.
- The inline `z-index: 999999` full-screen scrim (`:4659-4670`). It covers the dock, which is A6, and it is the highest z-index in the codebase by three orders of magnitude.
- The debug tracers: `openQuestionBrowser` logs five lines and schedules a 100ms `setTimeout` purely to log again (`:1756-1770`), and there is a `console.log` on **every render of the host page** (`:3646`) plus two effects that log on every browser state change (`:1888-1901`). These run in a live session.

---

## 4. Where the top three lives, and what happens to the RoomMeter test

**Recommendation: the stage owns the top three, in the RESULTS and ENDED content. Not the meter, not the console.**

Three reasons, in descending order of force.

1. **The meter cannot hold it, because on RESULTS there is no meter.** `GameHostPage.jsx:3590-3592` returns `null` for RESULTS, FIELD_NOTES and ENDED — those states run solo on purpose. The top three exists exactly and only in the states where the meter does not.
2. **Even if there were one, the meter is the first thing sacrificed.** `fitPolicy.js:65` enters it at priority `-1`, ahead of every `data-drop` group, and the completion-signal spec §2 already reasons from this: *"On a dense round the meter is not on screen at all."* A podium that disappears on the densest results screen is worse than no podium, because the host has promised it.
3. **The console is the wrong audience.** `19-how-to-play.html` promises the room, in the room's own words: *"We put the top three on screen and talk about them."* A host-only panel does not discharge that promise.

So it is a `.podium` block inside `.content`, which is where the mockups already put it — §11.9 records the podium ellipsing a name on `10-ended`, so the element exists and has already been through one round of truncation fixes. Being **content**, it may not be dropped and may not be clamped (audit A2/A11); it earns its space through the scale search like everything else.

**The gating condition the ruling has not yet accounted for, and this is the part the owner may not have considered.** A podium is a list of three names ordered by score. During an anonymous, unrevealed round that is attribution by arithmetic — the identical leak §11.8 closed by removing the standings meter from pre-reveal RESULTS (*"a score jumping 180 identifies the 180-point answer"*). The page already reasons this way for the answer cards via `standingsVisible({ gameType, anonymousUntilReveal, authorsRevealed })` (`GameHostPage.jsx:4383-4387`). **The podium must be gated on the same predicate**, and on ENDED it must be gated on the reveal having happened at some point. A podium that renders before the reveal defeats the guarantee the lobby, the how-it-works beat, VOTE and pre-reveal RESULTS all print in one sentence.

### What happens to the RoomMeter no-names test

**It stands, unmodified.** `stageShell.test.jsx:268-275` asserts that `RoomMeter`, *given a `players` prop*, renders no names. The podium is not rendered by `RoomMeter` and never will be, so `players` stays an unread prop and the test keeps its exact meaning. The completion-signal spec §4 already says the same thing about its own change (*"if either needs changing, the change is wrong"*), and that judgement is right here too.

Two things do change:

1. **`RoomMeter.jsx:12-16`'s docstring is now over-broad and should be narrowed, not weakened.** It currently reads as a claim about the whole stage — *"A count is a nudge; a list of names is an attendance record, and the room is the wrong audience for one."* The carve-out is a distinction, not an exception: a **roster** is every name, unordered, complete, and its content is who is present and who is late. A **podium** is three names, ordered, earned, and its content is the outcome of a round the room just played. The first is surveillance and the second is the point. Say that in the comment so the next person does not read the podium as the rule being abandoned.
2. **The carve-out needs its own test at the level where it lives**, or the rule now has a hole nothing guards. Two assertions, both honest in jsdom: the podium renders **at most three** entries given twenty players; and the podium renders **nothing** when `anonymityActive(...)` and authors are not revealed. The second is the one that matters.

There is also an existing invariant to check against: audit check **A13** (§11.9) asserts that no roster name appears in a stage document unless it declares `data-attribution="revealed"`. The podium must carry that attribute, which conveniently is the same condition as the gating predicate above. If the audit is ported to component tests as §8 intends, A13 is where the podium's carve-out is enforced for free.

---

## 5. The two QRs, and the auth defect behind the second one

### The division of labour, stated once so it is never confused again

| | Surface | Encodes | Audience | Size | Trigger |
|---|---|---|---|---|---|
| **Player join** | the stage rail's join `<code>` | `playUrl` (`/play?gameId=…`) | the room | 300px, full-screen overlay | hover/focus previews, click pins — completion-signal spec §3 |
| **Host remote** | the console, section 4 | `${origin}/remote?gameId=${gameId}` | one person, arm's length | ~180px, **inline in the panel** | opening the console |

**Recommendation: two surfaces, not one component parameterised.** The obvious move is to extract `expanded-qr-overlay` (`GameHostPage.jsx:4528-4556`) into `<QrOverlay url caption/>` and use it twice. I would not. The two cases differ in every dimension that determines the markup: the room-facing one must be scannable from the back of a room, so it is full-screen and 300px and must be dismissible; the operator-facing one is scanned from thirty centimetres by the person already holding the mouse, so 160–180px inline is generous. Sharing them means a component with a size prop, a fullscreen prop, a scrim prop and a dismiss prop, which is four booleans standing in for "these are different things."

More importantly, an **inline** console QR sidesteps the dock problem entirely. `expanded-qr-overlay` is a fixed full-screen scrim (`:4529`) — rendering the remote QR through it would cover the primary action (A6) and force a decision about whether it joins `anyOverlayOpen`. Inline in a panel that already stops at `--dock-measured`, there is no question to answer.

**What the completion-signal spec has to change.** §3 *"Which QR"* stays true — the rail keeps reusing `expanded-qr-overlay` unchanged, which is that spec's whole point. What becomes false is §6, *"Out of scope: the side panel's existing click-to-expand stays exactly as it is."* The side panel is being deleted, and with it `GameHostPage.jsx:3801-3806` (the 180px `QRCodeSVG value={playUrl}` under the caption `Scan to join!`) and `:3802`'s click-to-expand. One sentence to amend, plus a note that the join QR now has exactly one home.

**Caption.** `Scan to join!` is wrong twice over for the remote: it would walk a host's phone into the player flow, and it does not warn about the sign-in. Recommended copy:

> **Controls on your phone**
> Scan with your own phone to run the session from it. You will be asked to sign in.
> `eng.seibtribe.us/remote?gameId=4821`

The word **join** must not appear in this section. The player link stays in section 3, labelled as the players' link, so the two are never adjacent and never ambiguous.

### The defect: the `?gameId=` does not survive a social sign-in

I checked, because a QR that lands the host on a remote with no session is a QR that has failed.

**The email/password path is fine.** `ProtectedRoute` renders `<AuthPage>` **in place** rather than navigating (`App.jsx:42-43`) — the browser URL stays `/remote?gameId=4821` throughout. On success it calls `window.location.reload()`, which reloads that same URL, and `HostRemote` reads the parameter from `window.location.search` on mount (`HostRemote.jsx:121-123`). The game loads.

**The social path loses it.** Google/Facebook/Amazon/Apple bounce through `/auth/callback`, and `OAuthCallback.jsx:86` finishes with a hard `window.location.href = '/'`. `/` is the **host page**, behind `ProtectedRoute` (`App.jsx:218-221`). So a host who scans the QR while signed out on their phone and taps "Sign in with Google" lands on a second copy of the *host page* on a phone screen, with no gameId, no remote, and having to navigate back by hand.

That is worse than a failed QR. A second host page is a second host WebSocket connection, and host-connection eviction is a known live defect — the completion-signal spec §5.2 depends on its fix. Opening a phone-sized host page mid-session is a way to knock the projector off the socket.

**Flagged as a real defect, not a design note.** The fix is standard and small: stash `window.location.pathname + search` before the OAuth hop and restore it in `OAuthCallback` instead of hard-coding `/`. Worth extracting the "where do I go back to" decision into a pure function so it can be tested (§6) — as it stands it is three `window.location.href` assignments in a callback and nothing can assert anything about it.

**What the host experiences on first scan, stated plainly since the cost is accepted:** camera → browser opens `/remote?gameId=4821` → sign-in screen → they sign in → remote loads with the session already selected (email/password) **or** they land on the host page and have to fix it by hand (social). On every subsequent session the phone is already signed in and the scan goes straight through. The one-time cost is real and small; the social-path bug makes it look much larger than it is, which is the argument for fixing it before this ships.

---

## 6. What I would cut

**From the mockups:**

- **The `⋯` glyph beside `SETUP`** (`Dock.jsx:46`). The word is the target; the glyph is decoration in a control whose whole design brief was hittability.
- **`Synthesis → Voice: Adapt to the session ▾`.** No backend, and voice is an authoring-time choice, not a mid-session one. `Rewrite the last summary` maps to a handler that exists and stays.
- **The `DISPLAY` note: *"Who has not answered yet, by name, is only ever shown there — never here, and never on the stage."*** `USER-REVIEWS-2.md:334` already caught this exact sentence being contradicted by `12-density-table.html`, and the reviewer's line is the right one: *"Guarantees don't work like that."* A guarantee printed in a panel is either enforced by a test or it is a liability. Enforce it (A13, the meter test, the new podium test) and delete the sentence.
- **`Put the controls on my phone →` as a button that leads nowhere.** Replaced by section 4's QR, plus a plain text link for the same-machine case.
- **Row numbers in the browser** (`.qb-n`).
- **The option block in the browser rows** — argued in §3; this is a change to §5.4.1, not an omission from it.
- **A how-to-play *document* in the console.** §6.2b is right and the owner's ruling does not disturb it: the console holds the *action* (`Show how this works on the stage →`), and the four lines go on the stage where the players they are addressed to can read them. `19-how-to-play.html` is drawn as a **stage state**, not a panel — it has a rail, a phase bar, a meter and a dock. Putting the document back in the console would file player-facing copy in a surface no player sees, which is the original bug. "Everything lives inside the console" is satisfied by the entry point living inside it.

**From the shipped panels:**

- **Both edge tabs** and their CSS — `.instructions-tab` (`GameHostPage.jsx:3753-3759`, `styles.css:495+`), `.qr-tab` (`GameHostPage.jsx:4043-4049`).
- **The entire how-to-play document** (`GameHostPage.jsx:3662-3714`). Beyond §6.2b's argument, it has a shipped bug worth naming: it renders only for `call-and-answer`, `trivia` and `poll`. A **wavelength or survey** host opens the panel and sees a heading, nothing, and a Sign Out button. Nobody has reported it, which tells you how often that panel is opened.
- **Both identity blocks.** `GameHostPage.jsx:3716-3749` and `:3890-3921` render the signed-in name, email and Administrator badge — twice, in two panels. §5.4.2 deletes the email outright (§7.2: the room must never see an email address). `Sign Out` alone is enough; which account is signed in is answerable elsewhere.
- **The host roster** (`:3817-3845`) — to the remote, per §1.
- **`questionSetTabVisible`** (`:160, 432, 2884`). Declared, set, cleared by `closeAllSidePanels`, and read by nothing. Dead.
- **`.main-layout.rail-right-narrow` / `.rail-right-wide` / `.rail-left`** (`styles.css:204-207` and the `@media` block at `:220-224`). The comment at `GameHostPage.jsx:3650-3654` says these classes are no longer applied; grep confirms it. Dead CSS carrying a long and now-misleading rationale comment (`styles.css:187-203`).
- **The debug logging** — `:3646` (every render), `:1756-1770` (five lines plus a pointless `setTimeout`), `:1888-1901` (two effects on browser state).
- **`z-index: 999999`** (`:4666`).
- **The `correct-answer` row** (`:4707-4709`).

**What I would keep that the mockups do not have:** the live bitmask category counts, `exhausted` state, `isTogglingCategory` disabling, connection status, `Copy Invite`, the loading spinner, the empty state, and the mid-round skip confirmation. Six of the nine are things the mockups simply had no reason to draw; all nine are the shipped code being right.

---

## 7. Verification

Split by what can actually be asserted, because this repo's stated failure mode is tests that look like coverage and assert nothing — and `jsdom` has no layout engine, so every geometric assertion returns zero and passes unconditionally.

### Honestly unit-testable (jsdom + RTL)

- **A pure section model.** Follow `config/hostControls.js`: a `consoleSections({ phase, gameType, capabilities })` returning data, with a test that every phase yields the mandatory sections and that no section is emitted empty. `hostControls.test.js` already proves this shape works.
- **The browser row projection.** A pure `browserRow(question)` and a test that its output contains **no key whose value equals** `question.correctAnswer` / `question.CorrectAnswer`, across all the field-name variants the shipped code juggles (`:4696-4709`). This is the one assertion that keeps the answer off the stage, and it is falsifiable — put a correct answer in the fixture and watch it fail.
- **The SPACE rule.** Open the console; dispatch `keydown` with `key: ' '` on `document.body` → the advance handler ran. Dispatch it with the target inside `.console` → it did not. Dispatch it with the target being the search `<input>` → it did not (the existing `isTypingTarget` path). Three cases, no geometry, and the middle one is the regression a reviewer is most likely to reintroduce.
- **Focus.** `Esc` closes and `document.activeElement` is the `SETUP` button. `activeElement` is real in jsdom.
- **The QR values.** The console's `QRCodeSVG` receives a value matching `/\/remote\?gameId=/`; the console contains no text matching `/join/i`; the rail overlay still receives `playUrl`. Cheap, and it catches the exact mix-up the owner is asking to prevent.
- **The podium.** At most three entries given twenty players. Nothing rendered when anonymity is active and authors are not revealed.
- **The meter.** `stageShell.test.jsx:256-281` runs unmodified. If it needs changing, the change is wrong.
- **`postAuthDestination(location)`** — *if* the redirect decision is extracted from `OAuthCallback.jsx` into a pure function, then `/remote?gameId=ABCD` surviving it is a one-line test. As the code stands (three `window.location.href` assignments in a callback) nothing can be asserted, which is itself the argument for extracting it.

### Requires a human in a browser

- **That opening the console does not re-trigger the fitter.** Read `--fit` and the set of dropped `data-drop` groups before and after opening, on a dense state. jsdom reports zeros for both.
- **That the console clears the dock and the primary is topmost at its centre** — audit check A6. `docs/design/host-redesign/audit.js` is written to run against a rendered document plus a viewport (§8), so the honest home for this is the audit run in a real browser against the console page, not a component test.
- **That the console scrolls and nothing else does** — A1 plus §5.4's single exemption.
- **Contrast of the console at each of the four profiles** — A9, after the black-lift model.
- **That the remote QR scans at 160–180px** from arm's length, on a real phone camera, at each display profile's rendering. This is not simulatable.
- **The full auth round-trip on a real phone**, both paths: email/password (expected to work) and Google (expected to fail today, per §5). This is the check that decides whether the QR ships.
- **A clicker pass:** `Space`/`→` advance and `←` step back with the console open and closed, since a presentation clicker sends keys with no meaningful `event.target`.

### Not testable at all, and said out loud rather than faked

Whether nine sections in one scrolling panel is findable under pressure. That is a rehearsal question. `USER-REVIEWS-2.md:139` records a reviewer asking for two rehearsals on real hardware before an all-hands, and this surface is the one that most deserves them: every control on it is reached while a room waits.
