# Host screen redesign — design specification

**Date:** 2026-08-08 · **Revised:** 2026-08-09 (revision 3, post first-look user testing — see §10 and §11)
**Status:** proposed
**Scope:** `src/src/GameHostPage.jsx`, `src/src/components/HostActionBar.jsx`, the big-screen block of `src/src/styles.css`. No backend change is required.
**Mockups:** `docs/design/host-redesign/index.html` (16 states + an index). They carry **worst-case content deliberately** — the longest plausible question, six long trivia options, forty players, sixty distinct wavelength terms, a 900-word Workie response. Open each full-screen, ideally on the real projector: the type scale is expressed in `vh` and only shows its true size at the true display size.
**Verification:** `docs/design/host-redesign/audit.html` + `audit.js`. Nine assertions over every mockup × four display profiles × five viewports, plus a wide-face stress pass. Intended to port into component tests as-is.
**Review:** `docs/design/host-redesign/CRITIQUE.md` — independent design critique of revision 1 (§10). `docs/design/host-redesign/USER-REVIEWS.md` — three first-look evaluators who run meetings for a living, shown the mockups and nothing else (§11). Two of the three would not have run revision 2; §11 records what that changed and where this document argues back.
**Prior art this supersedes:** commit `5363a6db fix(host): the advance button was below the fold in all 12 game states`, which introduced `components/HostActionBar.jsx` and `config/hostControls.js`. Both survive this redesign nearly intact. What does not survive is the page they were bolted onto.

---

## 1. The problem, stated precisely

The owner's complaint is that the host screen "always requires scrolling up or down to see the question instructions and the buttons and status of the players," that the recently added bottom bar "kinda just crowded everything," and that the Big Screen option is "slightly better."

All three observations are symptoms of one cause, and it is worth naming it exactly, because the fix follows from it directly.

**The host screen is a scrolling document that is being used as a display.**

`.outer-container` is `min-height: 100vh` with a white paper card, `max-width: 1160px`, and content stacked in DOM order: a 250px decorative parallax hero, then a title block, then the *entire player roster as a grid of cards*, then the phase content, then a fixed action bar. The question — the single thing a room is in the building to read — is the third block down the page. Everything above it grows: the roster grows with attendance, the title grows with the length of the event name. So the position of the important content is a function of variables the host does not control, and on a document layout the only remedy the browser offers is a scrollbar.

The `5363a6db` fix was correct about the diagnosis ("scrolling to READ is fine, scrolling to ACT is not") and correct about the remedy for the *action*: it hoisted the advance control out of the flow into a bar fixed to the foot of the column. But it left the underlying document layout in place. So the host now has a reachable button and *still* has to scroll to see the question, the instruction and the roster — and the bar itself consumes 76px plus 24px of reserved padding at the bottom of an already-crowded column. That is precisely "it kinda just crowded everything." The fix was right and insufficient in the same move: it solved reachability without solving composition.

Big Screen is "slightly better" for one structural reason that nobody wrote down and that turns out to be the whole answer:

```css
.outer-container.big-screen-mode .game-host-container {
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.outer-container.big-screen-mode .players-section {
  position: absolute; top: 24px; right: 24px; width: 336px;
}
```

Big Screen **stops being a document and becomes a fixed-height region layout**, and in the same stroke it **demotes the roster from content to periphery**. Those two moves are why it reads better. Everything else about big-screen mode — the photo hero, the dusk palette, the amber alpenglow — is skin. The skin is good and should be kept, but it is not the reason the mode works.

So the redesign is not "make the default look more like Big Screen." It is: **adopt Big Screen's layout model as the only layout model, and then finish the job it started** — because Big Screen still keeps a scrollbar (`.waiting-state.big-screen-mode, … { overflow-y: auto }`, styles.css:7223), still reserves 384px of stage for the roster in states where the roster is irrelevant, still draws two QR codes at once in the lobby, still types the room at laptop sizes, and still has no screen at all for a finished session.

---

## 2. Full element inventory

Every element the host screen renders today, with a verdict. Verdicts are:

- **ROOM** — the audience needs it; it belongs on the stage.
- **OPERATOR** — the host needs it; it must be reachable but must not occupy stage.
- **REDUNDANT** — the same fact is already stated elsewhere on screen.
- **CUT** — it should not exist on this surface at all.

### 2.1 Persistent chrome (rendered in every state)

| Element | Where | Verdict | Why |
|---|---|---|---|
| Parallax hero (3 Webflow CDN `.webp` layers + "Engagements"/"Trivia" title) | `GameHostPage.jsx:3671–3686` | **CUT** in standard mode | 250px of the fold (96px during a live round after `5363a6db`) spent on a word the host already knows and the room does not need. It is also an external CDN dependency the design spec already flags for removal. The dusk photo field in big-screen mode replaces it and does the job better because it sits *behind* content instead of above it. |
| `big-screen-hero` photo field + scrim + amberwash | `:3691–3709` | **ROOM** | Keep. This is the identity, it costs no layout, and its per-phase scrim change is one of the few things that makes a phase transition perceptible. |
| `players-section` → `game-title-header` → `game-title-main` (event title) | `:3724–3735` | **REDUNDANT** in lobby | Duplicated by `.bs-lobby-title` (`:3789`), which renders the same `eventTitle` at hero scale in the same viewport. |
| `game-meta-info` → question-set name + `SetImageBadge` | `:3728–3731` | **OPERATOR** | The room does not care which set is loaded. Also duplicated by the Game Info panel's right column header (`:3544–3548`). |
| `player-count-info` "(12 Players)" | `:3732` | **REDUNDANT** | Stated again by `answer-progress` (`:3925`), again by the action bar status (`hostControls.statusTextFor`), again by the ring numeral (`:3839`), and implied by the roster itself. |
| `players-header-simple` "12 Players" (when no `eventTitle`) | `:3736–3740` | **REDUNDANT** | Same fact, different branch. |
| `players-grid` → `player-card` × N (rank icon, name, score, answer/vote tick) | `:3741–3775` | **REDUNDANT / reduce** | See §2.6. The roster is the single largest consumer of stage in every phase and it restates progress that the meter already carries. |
| `big-screen-players-qr` (120px QR + "Scan to Join") | `:3712–3723` | **REDUNDANT** | In the big-screen lobby this renders *simultaneously* with the 300px `big-screen-join-qr` (`:3792`). Two QR codes, both live, both for the same URL, in one viewport. A room presented with two QR codes has to make a decision it should never have been asked to make. |
| Instructions rail — "How to Play", 4-step `<ol>` + 4-tip `<ul>` per game type | `:3322–3417` | **CUT from stage** | ~180 words of onboarding copy addressed to players, rendered on the host's screen, and it reserves 300px of layout width (`.main-layout.rail-left { --rail-left: 300px }`). Players have their own screens. Keep the content, move it into the Console (§5) where a host can read it before the session. |
| Instructions rail → user name / email / "Administrator" / Sign Out | `:3382–3414` | **CUT from stage** | The room must never see the host's email address. This also appears a second time in the Game Info rail (`:3505–3535`). |
| Game Info rail — join URL, copy message, Game ID, WebSocket status, 180px QR | `:3427–3472` | **OPERATOR** | Genuinely useful to the host; reserves 300–600px of layout. Move to the Console. The one part the room needs — the join address and code — becomes one line in the top rail. |
| Game Info rail → Copy Invite / Big Screen ON-OFF / View Reports / IssueFab / Switch Game / user block / Sign Out | `:3473–3536` | **OPERATOR** (Big Screen toggle: **CUT**) | Console. The Big Screen toggle disappears entirely because there is no longer a mode to toggle (§3). |
| Game Info rail right column — set name, "N questions remaining", per-category toggle buttons with counts, per-category browse magnifier | `:3540–3654` | **OPERATOR** | This is genuinely powerful mid-session control and it should stay in the product — in the Console. It must never be on the stage: it is 24 buttons of live-editable configuration in front of an audience. |
| `HostActionBar` (status line + optional Skip + primary + `SPACE` kbd) | `:4348–4353` | **ROOM + OPERATOR** | Keep, and promote. This is the one control that is legitimately dual-purpose: the room benefits from reading "Show Results" because it tells them what happens next. See §5.1. |
| `IssueFab` (bug-report FAB, fixed bottom-right) | `:3498` | **CUT from stage** | Console. |
| Per-render `console.log` (`🎨 RENDER: …`, `:3316`; `🏆 TRIVIA PLAYER RESULT`, `:4076`; `🖥️ RENDERING RESULT`, `:4137`; and ~365 emoji log sites in this file) | throughout | **CUT** | Not UI, but it runs inside the render path of a live projector and it is noise in the one console a host might open when something goes wrong. Out of scope for this spec; flagged. |

### 2.2 LOBBY (`CREATED`, `STARTED`, and — see §2.7 — `ENDED`)

| Element | Where | Verdict |
|---|---|---|
| `bs-lobby-eyebrow` "Live Engagement · Live" | `:3781–3787` | **REDUNDANT** — the word "Live" twice in one line, and the game-type label is already in the rail. Becomes the phase chip. |
| `bs-lobby-title` (event title, hero) | `:3788–3790` | **ROOM** — keep, it is the only place the event title belongs. |
| `big-screen-join-qr` (300px QR) + "Scan to join the game" + "Game ID: 4821" | `:3791–3805` | **ROOM** — keep exactly one of these, enlarge it, and pair it with the typed URL and the code. |
| `<h2>Waiting for players to join...</h2>` | `:3806` | **REDUNDANT** — the action bar already says "Waiting for players to join…" via `statusTextFor('LOBBY')`. The identical sentence, twice, ~400px apart. |

### 2.3 ASK

| Element | Where | Verdict |
|---|---|---|
| `bs-kicker` — category / round noun + number / total | `:3817–3828` | **ROOM** — keep, move to the top rail. |
| Non-big-screen `<h2>Round 3</h2>` + `field-badge` + `school-name` | `:3845–3853` | **REDUNDANT** — the same round number and category the kicker carries. Two renderings of the header exist purely because there are two modes. Collapsing to one layout deletes this branch. |
| `bs-timer-ring` — SVG ring + answered numeral | `:3829–3842` | **REDUNDANT** — it is not a timer, it is answer progress drawn as a clock. It restates `answer-progress` (`:3925`) and the action-bar status. Worse, it *reads* as a countdown to a room, implying time pressure that does not exist. Replaced by the room meter (§5.2). |
| `lesson-title` (the question) | `:3856–3865` | **ROOM** — this is the screen. Everything else is negotiable. |
| `artwork-image` | `:3866–3873` | **ROOM** — on artwork rounds it is co-equal with the title. |
| `lesson-detail` / wavelength topic | `:3874–3898` | **ROOM** — keep, one step down the ladder. |
| `trivia-options` A–F | `:3900–3913` | **ROOM** |
| `application-prompt` — "How to answer" + resolved instruction | `:3915–3923` | **CUT from stage** | This is addressed to players in the second person, and every player already has it on their own phone at arm's length, rendered by `PlayerPage`. Printing it on the projector spends a third of the stage restating what twelve people are already looking at. Keep it in the Console so a host can read the instruction aloud if they want to. |
| `answer-progress` "9 of 12 players answered" | `:3924–3926` | **REDUNDANT** — third statement of the same number. |
| `lesson-expanded` modal (click title to expand) | `:4435–4482` | **OPERATOR / keep as a deliberate beat** — see §6.3. |

### 2.4 VOTE

| Element | Where | Verdict |
|---|---|---|
| `<h2>Vote for the Best Applications!</h2>` + explanatory `<p>` | `:3932–3935` | **REDUNDANT** — the phase chip says VOTING and the players' own screens carry the instruction. Two lines of exclamation-marked chrome at the top of the stage. |
| `artwork-image-voting` | `:3937–3944` | **ROOM** on artwork rounds. |
| `answer-navigator` — "Answer 3 of 12", ‹ › nav arrows, one answer at a time | `:3946–3975` | **CUT** — the single worst interaction on the screen. It requires the host to manually page a room through twelve answers with two small arrow buttons while the room is voting on their phones, where they can already see all twelve. It is a job created by the UI for the UI. Replaced by an auto-paging live tally (§6.4). |
| `voting-progress` "7 of 12 players voted" | `:3977–3979` | **REDUNDANT** — restates the action-bar status and the roster ticks. |

### 2.5 RESULTS

| Element | Where | Verdict |
|---|---|---|
| `results-heading` "Round 3 · Results" + Trophy | `:3985–3988` | **REDUNDANT** — the rail already carries round + phase. |
| Trivia: `trivia-question-recap` | `:3992–3994` | **ROOM**, reduced — see below. |
| Trivia: `trivia-options-results` (letter, text, % , bar, correct tick) | `:3996–4065` | **ROOM** — the best thing on the current results screen. Keep. |
| Trivia: `trivia-player-scores` — every player's name, chosen letter, round points, running total | `:4067–4092` | **CUT from stage** | This is the third simultaneous rendering of the same scores: the distribution bars above it, this list, and the roster panel to the right. At 12 players it is 12 rows of four columns each. The room cannot read it and does not want it. Standings belong in exactly one place. |
| Wavelength: `WavelengthWordCloud` | `:4096–4100` | **ROOM** — the cloud *is* the result; give it the whole stage. |
| Wavelength: `wavelength-player-list` "Player Contributions" — every player's raw word list | `:4102–4125` | **CUT from stage** | Duplicates the cloud, in 14px grey (`#666` hardcoded on a dark stage — currently near-invisible), for twelve people. |
| Open-answer: `results-display` → `result-item` × N (name, +points this round, running total, answer text, vote count, placement medal) | `:4128–4174` | **ROOM**, reduced to top 3 (§6.5). Twelve of these do not fit and never did. |
| Open-answer: `no-results-message` with `JSON.stringify(answers)` | `:4129–4134` | **CUT** — raw JSON on a conference-room projector. |
| `ai-insights-section` — Workie avatar, "Field Notes", full markdown body (summary + numbered discussion topics + next steps) | `:4178–4338` | **ROOM**, but as its own beat (§6.6). Rendered inline it is a 300–900-word essay stacked under a leaderboard; it is the single biggest reason RESULTS scrolls. |
| `ai-persona-switch` — "Voice (next round)" `<select>` | `:4198–4216` | **CUT from stage** → Console. A dropdown on a projector. |
| `regenerate-ai-btn` | `:4217–4227` | **CUT from stage** → Console. |
| `debug-section` — prompt provenance, context hierarchy, full AI prompt text | `:4272–4326` | **CUT from stage** → Console, behind the existing `gameDebugMode`. |

### 2.6 Overlays and modals

| Element | Where | Verdict |
|---|---|---|
| `expanded-qr-overlay` (300px QR modal) | `:4359–4388` | **CUT** — the lobby QR is already 300px+ and always visible. The modal exists because the sidebar QR is 180px and too small; fix the cause. |
| `flash-alert-overlay` × 4 — "All Players Have Answered!", "All Players Have Voted!", "Invite Created & Copied!", loading | `:4391–4432` | **CUT** (3 of 4). Two of them announce, as a full-screen takeover with a 64px icon, exactly what the dock's status line already says in place and in colour ("All 12 answered"). One announces that the host's clipboard changed — to the whole room. Keep only the loading overlay, and shrink it to an in-dock spinner. |
| `expanded-lesson-overlay` | `:4435–4482` | **KEEP**, repurposed as the deliberate "show the full prompt" beat (§6.3). |
| `showConfirmModal` (generic) | `:4485–4510` | **OPERATOR** — keep, but see §2.7: it must not be how a session ends. |
| `question-browser-modal` (full question table with correct answers visible) | `:4515–4601` | **CUT from stage** → Console. It renders the correct answers of unasked questions at 999999 z-index over the room. |

### 2.7 The state that does not exist

`isWaitingState()` (`:59–67`) returns `true` for any state that is not `ASK#`/`VOTE#`/`RESULTS#`. `'ENDED'` therefore satisfies it. The consequence:

**When a session finishes, the host screen renders the lobby.** The room sees a QR code, the words "Waiting for players to join...", and a dock offering "Start First Round" — for a game with no questions left. The only finale that exists anywhere in the product is inside `GameReport` (`:4740+`), which is a paginated PDF-oriented document with a parallax header, not a projector screen.

Worse, the path into it is a modal question addressed to the host, in front of the room:

```js
webSocketClient.onMessage('gameEnded', (data) => {
  showConfirmation('End of Game',
    'All questions have been completed. Would you like to view the final report?',
    'View Report').then((confirmed) => {
      if (confirmed) { setGameState('ENDED'); setShowFinalReport(true); … }
    });
});
```

If the host declines, `setGameState('ENDED')` never runs and the session is left on its last `RESULTS#` screen with an advance button that will fail. A session either ends in a dialog box or does not visibly end at all.

This spec treats ENDED as a first-class state with a designed finale (§6.8). It is one of the twelve.

### 2.8 The redundancy summary

Stated plainly, because this is the owner's actual question. During a single ASK phase on a big screen today, the room is told **how many people have answered** in five places at once: the ring numeral (`:3839`), the per-player ticks in the roster (`:3758–3771`), the `answer-progress` line (`:3925`), the action-bar status (`hostControls`), and the flash-alert overlay when it reaches 100%. It is told **the round number** twice (rail kicker + results heading), the **category** twice (kicker + `field-badge`), the **event title** twice (title header + lobby title), the **question set** twice (meta info + Game Info panel), the **join URL** three times (rail QR, lobby QR, Game Info panel) with **two QR codes rendered simultaneously**, and — in trivia RESULTS — the **scores** three times (distribution, per-player list, roster panel).

That is the crowding. It is not a spacing problem.

---

## 3. The central question: one surface, two audiences

### 3.1 What makes this hard

The same pixels serve an operator who needs control and precision, and an audience who needs one idea at a time at 60px. These are not merely different priorities; they are opposed. Everything the operator adds — a category count, a persona picker, a skip button, a connection indicator — is noise to the room, and everything the room needs — scale, whitespace, one thing at a time — is friction to the operator, who would rather see the whole state at once.

The owner has closed the easy exit: no separate private host view. And the third context (host's laptop *is* the display) makes the exit incoherent anyway — there is only one screen in the room.

Three approaches follow. Each is stated at its strongest.

### 3.2 Approach A — Presentation-first, remote-primary

Make the main screen a pure audience display. Remove every operator affordance from it, including the advance button. Promote `HostRemote.jsx` from an optional gadget to the documented way to run a session: the projector shows the room, the phone drives it.

**In its favour.** It is the cleanest possible stage — genuinely broadcast-grade, with nothing to subtract. It matches how conference AV actually works. The remote already exists, already drives every transition over HTTP independent of the host page (`HostRemote.jsx:17–60`), and is already the proof that this reduction works: it collapsed the entire session to one primary action plus a progress meter and lost nothing. And it resolves the conflict honestly rather than compromising — the two audiences get two devices.

**Why it loses.** The brief is explicit that the host may have no remote and no second device. Approach A does not degrade; it fails. A host on a laptop with a dead phone has an un-drivable session. There are also two live defects that make the remote unsafe as the *only* path: `websocket/connect.js` evicts every existing HOST connection when a new one arrives (documented in `hostRemote.js:47–54`), so the remote deliberately polls instead of subscribing; and `next-question.js` has no `ConditionExpression`, so concurrent control from two devices can consume two questions and show one (`5363a6db`, race analysis). Making a second device mandatory in that state would be irresponsible. Finally, it is a strictly worse fit for the laptop-as-display case: a host reaching across a table to their own trackpad should not need a phone in their hand.

Approach A is right about the destination and wrong about making it compulsory.

### 3.3 Approach B — Keep two modes, polish both

Keep `bigScreenMode` as a toggle. Fix the default document layout (shrink the hero, cap the roster, tighten the bar), and fix the big-screen layout (kill the scrollbar, kill the second QR, raise the type).

**In its favour.** It is the smallest diff and the least risky. Each mode can be optimised for its case without compromise: dense for the operator, spare for the room. It preserves an escape hatch the host already knows.

**Why it loses.** First, it does not answer the complaint. The owner's problem is with the surface they actually get — the default — and "there is a better mode you can switch to" is what they already have and are unhappy with. Second, two layouts for twelve states is twenty-four layouts to design, build, test and keep in sync, and the current code shows exactly how that decays: the ASK header is written twice (`:3815–3854`), the QR is written twice, and the two branches have already drifted apart in typography and information architecture. Third, and decisively, **the mode is not durable**:

```js
useEffect(() => {
  setBigScreenMode(false);
  console.log('🖥️ Big screen mode reset to false on component mount');
}, []);
```

`GameHostPage.jsx:189–192`. Any reload of the projector browser — a refresh, a crash, a sleeping laptop reconnecting — silently drops the host out of presentation layout mid-session, in front of a room, with no indication that anything changed except that everything suddenly looks wrong. A mode that the host must notice, remember and re-apply under pressure is not a mode; it is a trap. Approach B institutionalises it.

### 3.4 Approach C — One stage, always; the operator gets a summoned overlay (RECOMMENDED)

There is no mode. Big Screen's layout model becomes the only layout model, at all sizes, for all three contexts.

The stage is a fixed-height, three-row grid that never scrolls. It carries exactly three things:

1. a **rail** across the top that answers *where are we* (phase, round, category, how to join);
2. the **content** — the question, the options, the cloud, the result — which owns the majority of the stage;
3. a **dock** across the bottom that answers *what happens next* — one status line and one primary action.

Beside the content sits a single **room meter**, one region whose content changes by phase but whose job never does: *where is the room*. It replaces the roster grid, the progress ring, the two progress lines and the flash alerts.

Every other operator affordance in §2 — categories, question browser, persona, regenerate, invite, reports, debug, switch game, sign out, the How-to-Play text — moves into one **Console**: an overlay drawer opened from a permanent `⋯` control in the dock (with `\` as an accelerator), which dims the stage behind a scrim, stops short of the dock so the primary action is never covered, and announces itself as temporary. It is styled at arm's-length sizes (13–20px), it is visibly *not content*, and it closes on `Esc`, on its own close button, and on every advance (the page already calls `closeAllSidePanels()` in `runHostAction`, `:3282`).

The viewing contexts are handled by **display profiles: four named ladders, not one ladder times a multiplier**. Revision 1 of this document specified a single `--k` scalar and it was wrong twice over — it did not work, and it could not have worked. §4.2 sets out the corrected model and §10.2 records why the scalar was the wrong abstraction rather than merely a broken one.

**Why this wins.**

It fixes the actual cause. The crowding is not a spacing problem; it is a *composition* problem caused by putting two audiences' content in one linear flow. Approach C separates them along the axis that costs nothing: **the operator's controls become temporally separate rather than spatially separate.** The host has full control at all times; the room only ever sees it for the seconds the host chooses. That is the third answer the brief asked for, and it is strictly better than a separate device because it degrades to nothing — a host with no phone loses no capability, just adds a keystroke.

It keeps exactly one operator control permanently on the stage, and that one is honest about being dual-purpose: **the dock's primary action is also a room-facing signal.** "Show Results" tells the audience what is about to happen. A room reading the next beat off the screen is a room that stays with you. This is the one place where the two audiences want the same pixel, so it is the one place chrome earns its stage.

It makes the remote *optional and better*. With operator controls off the stage, a host who does have a phone gets the ideal setup for free — Approach A's outcome, arrived at by choice rather than requirement. The Console's "Open phone remote" is a suggestion, never a dependency.

It halves the surface area. Twelve states, one layout each. The two-branch renders in `GameHostPage` collapse. `hostControls.js` and `HostActionBar.jsx` survive unchanged in their decision logic — the bar simply becomes a grid row instead of a `position: fixed` overlay, which also means it can never be pushed below the fold, because a grid row has no fold.

**What it costs, honestly.** The host loses the ability to see the whole roster and all twelve answers simultaneously without a keystroke. That is a real loss for a host who likes ambient awareness. It is mitigated by the meter (which answers the only ambient question that matters — how many are we waiting on) and by the Console's roster tab (which names them). The second cost is that `bigScreenMode` disappears as a user-facing concept, so a host who had learned it must learn `\` instead; the density switch is the replacement and it persists.

### 3.5 Decision

**Adopt Approach C.** Ship Big Screen's structure as the default and only layout; move all operator chrome into a summoned Console; keep the dock as the single always-visible control; handle the viewing contexts with persisted display profiles.

---

## 4. Typography, colour and the display profiles

### 4.1 Deriving the sizes rather than guessing them

A conference-room projector at 1920×1080 typically fills a screen about 96 inches wide, i.e. **20 device pixels per inch**. Comfortable sustained reading of unfamiliar text requires the cap height to subtend roughly 20–24 arcminutes — about four to five times the acuity threshold. At the back of a 25-foot room (300 inches):

```
cap height = 300 in × tan(22′) ≈ 1.9 in
font size  = cap height ÷ 0.72  ≈ 2.7 in
in pixels  = 2.7 in × 20 px/in  ≈ 54 px
```

At 30 feet the same calculation gives ~65px. So **the primary read must be 55–68px at 1920** — which is exactly what `warm-summit-design-spec.md` already prescribes for the question title (`clamp(48px, 4.4vw, 68px)`). The spec is right. The implementation is not: today the big-screen trivia option text is `clamp(1rem, 1.5vw, 1.5rem)` — a **24px** maximum where the spec says 40px — player names are `1rem` (16px), and Field Notes body text is `1rem`. At 20 px/inch, 16px is a 0.8-inch line: legible at about 8 feet, invisible at 25.

### 4.2 The floor is angular, and that is why there are four ladders

The 20px number above is not a property of type. It is the product of three things: a viewing distance (25 ft), a pixel density (20 ppi), and a target angular size. Change any of them and 20px stops meaning anything.

Revision 1 of this document ignored that. It declared one ladder and scaled it with a `--k` multiplier — Room 1.0, Call 0.82, Table 0.62 — and asserted a single 20px floor across all three. It failed in three separate ways, and the third is the one that matters:

1. **It did not work at all.** `--t-primary: calc(clamp(...) * var(--k))` was declared on `:root`, where `var(--k)` substitutes against `:root`'s own value of 1. Custom properties are substituted at computed-value time *on the declaring element*, and what descendants inherit is the already-substituted token. Setting `--k` on `body` could never reach it. Measured: all three profiles rendered the question at 60.5px and the label tier at 20.5px. Only the *boxes* shrank, because those rules did live on descendants — which is why the Table mockup clipped a player name in half while its type stayed projector-sized.
2. **Fixing the substitution would have broken the floor.** With the multiply outside the clamp, any `k < 1` drops below 20px by construction: Table's label tier lands at 12.7px at 1080 and 12.4px at 720.
3. **Fixing the floor would have erased the parameter.** Move the multiply inside the clamp and the pixel floors bind almost every rung at laptop heights — at 720px tall, Room and Table become identical on four of five rungs. The scalar evaporates precisely in the context it was invented for.

The three failures share a cause: **a multiplier can only honour one floor, and the four contexts have four different ones.** Re-deriving the same ~8.3 arcminute label tier for each context gives:

| Profile | Display | Distance | ppi | Label tier at 8.3′ | Floor adopted |
|---|---|---|---|---|---|
| **Room** | projected image ≥ 90 in wide | ≤ 30 ft | ~20 | 20 px | **20 px** |
| **TV** | ~65 in wide panel | ≤ 20 ft | ~30 | 24.5 px | **26 px** |
| **Call** | screen-share, re-encoded | laptop | n/a — see below | n/a | **20 px** |
| **Table** | laptop panel | 2–4 ft | ~120 | 14.8 px | **16 px** |

So the profiles are **four literal ladders, declared on the root element** where nothing downstream has already substituted:

```css
:root, :root.d-room{                          /* projector, ≤30 ft */
  --L-hero:      clamp(56px, 8.4vh, 104px);
  --L-primary:   clamp(40px, 5.6vh,  68px);
  --L-secondary: clamp(28px, 3.7vh,  44px);
  --L-body:      clamp(22px, 2.8vh,  34px);
  --L-meta:      clamp(20px, 1.9vh,  24px);
  --floor:20px; --measure:26ch;
}
:root.d-tv{                                    /* ~65in panel, ≤20 ft, ~30 ppi */
  --L-hero:      clamp(72px, 11vh, 132px);
  --L-primary:   clamp(52px, 7.4vh, 88px);
  --L-secondary: clamp(36px, 4.8vh, 56px);
  --L-body:      clamp(28px, 3.5vh, 42px);
  --L-meta:      clamp(26px, 2.4vh, 31px);
  --floor:26px; --measure:22ch;
}
:root.d-call{ /* Room's ladder verbatim */ --hair:2px; --measure:24ch; --floor:20px; }
:root.d-table{                                 /* laptop, 2–4 ft, ~120 ppi */
  --L-hero:      clamp(44px, 6.2vh, 64px);
  --L-primary:   clamp(32px, 4.0vh, 44px);
  --L-secondary: clamp(22px, 2.6vh, 30px);
  --L-body:      clamp(18px, 2.0vh, 24px);
  --L-meta:      clamp(16px, 1.5vh, 19px);
  --floor:16px; --measure:30ch;
}
```

Sizes stay in `vh` because the binding constraint is **vertical fit** — a state must fit one screen — and `vh` tracks the projected image regardless of the projector's native resolution, so one rule is correct at 720p, 1080p and 4K.

**On the 20px floor and Table.** A reasonable objection is that 16px violates the hard floor §7.7 sets. It does not, because the floor is angular and the pixel number is a projection of it. 16px on a ~120 ppi laptop panel at three feet subtends **9.0 arcminutes** — *more* than the 8.3 arcminutes the 20px Room floor buys at 25 feet. Holding 20px on the laptop would not be conservative, it would simply spend space to over-serve an eye that is eight times closer. §7.7 is therefore restated in angular terms, with the per-profile pixel floors above as its enforceable form, and the audit asserts each profile against its own number.

**On Call sharing Room's ladder.** Call is deliberately not a smaller Room. The constraint on a screen-share is not the viewer's eye — they are at laptop distance — it is the encoder: the shared surface is downscaled (commonly 1920 → 1280) and re-encoded at a low bitrate, so a 20px glyph arrives as a ~13px glyph made of compression artefacts. Shrinking type for Call would make exactly the wrong trade. What Call changes instead is **treatment**: `--hair` goes to 2px because a 1px rule does not survive the codec, the photo field is replaced by a flat `--bg` because wide low-frequency gradients band badly and waste bitrate the text needs, and the measure tightens to 24ch. The audit's A5 check asserts that Call differs from Room in hairline weight and field treatment, precisely so "Call = Room" cannot quietly decay into "Call does not exist."

**Selection and persistence.** Room is the default; Table auto-selects below 1600px width. TV and Call cannot be detected — the browser cannot know a panel's physical size or that it is being shared — so they are explicit choices in the Console's Display section. The chosen profile is written to `localStorage` and restored on mount. The existing `useEffect(() => setBigScreenMode(false), [])` must be **deleted**: a projector browser that reloads has to come back exactly as it was.

Line lengths come from `--measure`: the question caps at 26ch on Room, 22ch on TV, 24ch on Call, 30ch on Table. Detail text caps at 44ch, Field Notes prompts at 34ch. These are tighter than web-typical because a room reads in saccades across a wide field and long lines force head movement.

Text *inside the Console* is exempt from all of this and should be 13–20px. It is read at arm's length by one person; typing it at room scale would make it unusable and would also make it look like content.

### 4.2b The content budget, and what happens when it is exceeded

Revision 1 said the layout would "drop a rung" and "switch to a single column" and never implemented either; the behaviour existed only as prose, and with worst-case content the stage silently decapitated the question instead. This section is the missing mechanism.

**Never centre a clipping box.** `.content` was `justify-content: center` with `overflow: hidden`, which overflows *both* ends and clips both — so the top of the question was the first thing to disappear, with no scrollbar and no out-of-bounds rect to detect it by. The fix is one line: the column is `flex-start` and its child carries `margin-block: auto`. Auto margins absorb spare space (so short content still centres) but never go negative, so **overflow can only ever appear at the bottom.** Losing the tail of a list is survivable; losing the head of the question is not.

**Truncation is something the fitter DOES, never something it inherits.** This is the rule revision 2 broke, and breaking it produced the single worst defect in the project. The line clamps lived in the *base* stylesheet — `.opt .txt { -webkit-line-clamp: 2 }` and friends — so content arrived at the fitter already cut. `scrollHeight` then equalled `clientHeight`, the fitter concluded the box fit, and it stopped. Measured on `03-ask-trivia` at 1920×1080: an 800px box holding 669px of content, with five of six options truncated mid-word and **131px sitting empty underneath them**. All three first-look evaluators named it first and independently, and none of them read it as graceful degradation; all three read it as a bug. It was.

The fix is stated as an invariant, because that is the form it needs to survive in:

> **A reduction may only fire when space is actually exhausted.**

Audit check **A10** enforces it and **A11** enforces the stronger product rule that room-facing content is never abbreviated at all. With the base clamps removed, the *existing* fitter produced a fully legible screen at the same type size: 2 columns at 0.86 scale needs 791px in an 800px box. The 131px was exactly the third line each option had been denied.

**Levers, in order of what they cost.** On layout and on every resize, `fit()` searches for the largest presentation that loses nothing:

```
for each .content:
  reset; choose the shorter option-grid column count
  search --fit for the largest scale that is CLEAN      (no overflow, no truncation)
  if none:  drop [data-drop] groups in order, re-searching after each
  if none:  take the meter's column (width is the cheapest lever of all)
  if none:  clamp — and A11 fails, because that is a budget problem, not a landing
```

`--fit` is a single continuous factor, binary-searched over `[0.55, max]` in seven steps, and every tier it touches is wrapped in `max(var(--floor), …)` so it can shrink type only as far as the profile floor and must then find a different lever. Label and meta tiers do not scale at all.

This is not the unfloored "auto-shrink to fit" §9 rejects. The distinction is the floor, and it is load-bearing: legibility is never a function of content length, because below the floor the search simply stops working and control passes to a lever that removes content instead of shrinking it.

**The ladder may also grow.** A state carrying a single object — a wavelength subject, a champion, a join code — opts in with `data-grow`, and the search runs up to 1.5–2.2×. The profile ladder is a legibility *floor* derived from the room, not a ceiling, and a ladder tuned for a dense screen under-uses a sparse one. `04-ask-wavelength` was reported as "60% empty… that is not restraint, that's a layout that gave up", and that was a fair reading of a two-word screen set at dense-screen sizes.

**Two implementation traps, both of which bit.** First, `-webkit-line-clamp` in base CSS makes the fitter blind (above). Second, and subtler: *do not test every element for truncation by comparing `scrollHeight` to `clientHeight`*. A block with a fractional line-height reports a pixel of phantom overflow — measured, `h1.q` at 33.264px/34.9272px reports 176 against 175 — which made the predicate permanently true, drove the search to its floor, and left 548px of a 795px box empty. Only an element that *declares* a truncation can abbreviate anything; ask only those, with a tolerance of half a line.

**Ordered sacrifice is one general mechanism.** Any element may carry `data-drop="1|2|3"` and an optional `data-drop-note`. Groups are dropped lowest-number-first and the screen states what it dropped ("Options E–F — in the session report"). The rail uses the same mechanism on the horizontal axis: title, then "JOIN", then the URL, always keeping the session code. A reduction that announces itself satisfies §7.10 (a reduction with no recovery is a deletion); a silent clip does not.

**Chrome is sacrificed before content, always.** The meter is chrome; its column is taken before a word is cut. That is the rule three evaluators converged on independently — *"the type steps down, the layout goes single-column, and the meter gets sacrificed before a single word does"*.

Revision 5 claimed this and did the opposite. `widen()` — taking the meter's column — ran only *after* every `data-drop` group had been hidden, so a state would discard an **answer** and then keep a 233px standings column. Measured on `21-results-revealed` at 1280×720: two cards, meter kept, 117px unused, second place thrown away. One key press earlier, `06` fitted the same three answers with 14px to spare. It landed on the worst possible beat — the reveal is the payoff of the entire anonymity feature and it was the moment the screen discarded the answers.

The meter now enters the ordered sacrifice at **priority −1**, ahead of every content group, through the same mechanism as everything else rather than a special case bolted to the end. The full order for a results state:

| order | what goes | kind |
|---|---|---|
| −1 | the meter's column | chrome |
| 1 | the pager line | chrome |
| 2 | the anonymity guarantee | chrome-ish — see below |
| 3 | third answer | **content** |
| 4 | second answer | **content** |

Measured after, same viewport: **three cards, meter taken, 1px unused, no content dropped.**

The guarantee sits at 2 because it is worth stage space but not worth an answer, and it drops **silently** — a `.reduced` line reading "Anonymity note — in the session report" would be nonsense. At 1920 it is always present; at 1280 the room is close enough for the host to say it.

Per-state budgets and the order of sacrifice are given in §6. The audit's A2 check is the enforcement: any element that clips content without a *rendering* truncation is a failure.

**Correction carried from revision 1:** it claimed five or six trivia options should "switch to a single column at the next rung down." That is backwards — six options in one column is *taller* than six in two. The rule is: two columns whenever there are four or more options (height-optimal), one column for three or fewer with long text (width-optimal). The mockups now show six options in a 2×3 grid.

### 4.3 Colour

Keep the Warm Summit tokens unchanged (`--bg #0F1A2E`, `--text #F4EDE4`, `--primary #F6A94C`, `--success #4FB286`, `--muted #9BA8BE`). Three additional rules specific to projection:

**Assume the projector lifts the black point.** Measured contrast on an LCD is optimistic: a typical conference projector in a lit room raises the effective background from `#0F1A2E` toward `#2A3550`, which costs roughly 1.6× of every ratio. Design against the lifted value:

| Pair | Nominal | After black-lift | Verdict |
|---|---|---|---|
| `--text` on `--bg` | 13.2:1 | ≈ 8.1:1 | Safe for anything. |
| `--primary` on `--bg` | 8.4:1 | ≈ 5.2:1 | Safe at `--t-meta` and above. Never for body runs. |
| `--success` on `--bg` | 5.6:1 | ≈ 3.4:1 | Large text only (≥ 24px bold / 30px regular) — which the floor guarantees. |
| `--muted` on `--bg` | 6.1:1 | ≈ 3.7:1 | **Labels only.** Never for a sentence the room must read. |

So: **`--muted` is a labelling colour, not a reading colour.** Every place the current code uses it for content — the wavelength contributions list at hardcoded `#666`, the Field Notes body — becomes `--text`.

**Two tokens had to move, and the audit is why.** Running A9 over the mockups with the lift model above showed that `--muted #9BA8BE` lands at **4.03:1** on a lifted background — under the 4.5:1 AA bar for normal text — and `--success #4FB286` at **4.25:1**, likewise under it for the small success strings (the `CORRECT` flag, "Everyone is in", the completion cue). The Warm Summit figures of 6.1:1 and 5.6:1 are correct, but they are measured against an *unlifted* background, which is the situation this section exists to say does not obtain in a lit room.

Rather than weaken the rule, two text-only tints are added and the originals keep every non-text job:

```css
--muted:        #B6C2D4;   /* was #9BA8BE — room-facing label TEXT (~6.8:1 lifted) */
--success-text: #6FD0A4;   /* small success text (~6.5:1 lifted) */
--success:      #4FB286;   /* unchanged: borders, bars, fills, the correct-row rule */
```

Hairlines and inactive fills are `rgba()` literals and are unaffected, so this is a change to text colour only. It is a deliberate departure from `warm-summit-design-spec.md` and should be folded back into that document.

WCAG 2.1 AA (4.5:1 body / 3:1 large) is the floor and, with those two tints, is met after the lift for every room-facing string at its sanctioned size — asserted by A9 across all sixteen mockups at four profiles.

**One amber per view.** Unchanged from the existing spec, and now enforceable because there is only one layout: the lobby spends it on the session code, ASK spends it on the meter bar, RESULTS spends it on the Field Notes rule and the rank-1 marker, ENDED spends it on the champion. Never two.

**Never colour alone.** Correct is `--success` *plus* a 2px border *plus* a `CORRECT` word-flag. Incorrect is `--muted` (never red — red means destructive, per the existing spec). Answered is a filled dot *plus* a count.

### 4.4 The four profiles, as content and treatment

One DOM. Four ladders (§4.2), and each profile also changes *what* is shown, not only how big it is.

| | **Room** | **TV** | **Call** | **Table** |
|---|---|---|---|---|
| Display | projected ≥ 90 in | ~65 in panel | screen-share | laptop panel |
| Distance | ≤ 30 ft | ≤ 20 ft | laptop | 2–4 ft |
| Primary read @1080 | 60 px | 80 px | 60 px | 43 px |
| Label floor | 20 px | 26 px | 20 px | 16 px |
| Field | photo | photo | **flat** | photo |
| Hairlines | 1 px | 1 px | **2 px** | 1 px |
| Measure | 26ch | 22ch | 24ch | 30ch |
| Roster | count only | count only | count only | count only |
| `SPACE` hint | hidden | hidden | hidden | **shown** |
| Selection | default | Console | Console | auto < 1600px |

**Room** is the reference case the ladder in §4.1 was derived for.

**TV** exists because the brief says "projector / big TV" and those are not the same display. A 75-inch panel is about 65 inches wide, so 1920 across it is ~30 ppi, half again as dense as a projected image. At 20 feet the Room ladder's question drops to ~16.7 arcminutes — under the comfort band — and the Room label tier to ~5.6 arcminutes, which is at the acuity limit, i.e. not readable. TV raises the top three rungs and the floor. The consequence is that **less content fits**, and the mockup at `14-density-tv.html` is included specifically so the reduction can be seen firing. That is the design working, not a defect.

**Call** keeps Room's type and changes treatment only — see the encoder argument in §4.2.

**Table** gets back what Room had to cut, because the type is smaller and the reader is closer — but **not names**. Revision 5's table said Table shows "roster with names + ticks", which contradicts §7.15 ("never name a person on the stage") in the same document. Table *is* a stage profile: a laptop read by three to five people is exactly the shared surface §5.4.1's whole argument turns on. §7.15 wins, the contradiction is resolved in its favour, and `12-density-table` no longer names anyone. Table's advantage is that more *content* fits, never that the privacy rules relax. **Skip stays visible at every profile.** Revision 1 said keyboard hints and Skip were Table-only and then showed both everywhere; the critique was right that the spec was over-strict. Skip is a legitimate operator control the room can ignore; the `SPACE` hint genuinely is Table-only, because nobody at the back of a room is looking for a keycap.

**Compact fallback** — below 1100×620 no host display exists, but browsers get dragged small. The meter becomes a single horizontal line, the option grid collapses to one column, the answer list caps at three. This tier exists so a narrow window degrades instead of mangling; it is not a supported presentation size and the Console should say so.

**Persistence is mandatory.** The chosen profile is written to `localStorage` and restored on mount. The current `useEffect(() => setBigScreenMode(false), [])` (`:189–192`) must be deleted, not adapted. A projector browser that reloads must come back exactly as it was.

---

## 5. The three regions

### 5.1 Rail and phase bar (top)

One line, never wraps, never grows. Left to right: **phase chip**, **event title**, **round context** (category · round noun + number · of total), and pinned right, **the join line** — `JOIN eng.seibtribe.us/play · 4821`.

The join line is present in every state except ENDED, at `--t-meta` with the code at 1.3× in amber, because people arrive late and the most common in-session question a host is asked is "how do I get in?" It replaces three separate join surfaces and both QR codes outside the lobby. Exactly one QR exists in the product and it lives in the lobby at ≥300px.

**Truncation that actually renders.** Revision 1 promised "a long event title truncates; it never pushes the code off screen" and implemented it as `overflow:hidden; text-overflow:ellipsis` on a *flex container with separate span children*. `text-overflow` only applies to a block container with inline content; on a flex box it is inert, so the rail clipped mid-glyph with no ellipsis — measured at −445px of slack on the lobby rail at 1280, and −150px at 1600, which is this spec's own Room/Table switch threshold. The title is now a **single text node with `display:block; min-width:0; max-width:34ch; white-space:nowrap; text-overflow:ellipsis`**, and the chip, context and join line are `flex:none`.

**Shrink order is declared, not emergent.** The same ordered-sacrifice mechanism from §4.2b applies horizontally: drop the **event title** first, then the word "JOIN", then the join **URL**, always keeping the session code and the round context.

Revision 5 numbered it backwards — URL(1), JOIN(2), the whole join block *including the code*(3), title(4) — so the session code was sacrificed before the event title, the exact inverse of what this paragraph promised. Corrected: title(1), JOIN(2), URL(3), and the block itself is no longer droppable, so the code cannot be lost.

**The title is readable or it is gone.** With `min-width: 0` it shrank silently to a 14% stub — "Q3 Lead…", verbatim the string an evaluator quoted as a complaint — while the rail never reported an overflow, so `fitChrome()` never fired and the drop ladder never ran. A `min-width: 22ch` floor makes the rail overflow instead, which is what triggers the sacrifice. The 34ch cap is also gone: it truncated the title at 1920 with 395–615px of rail sitting free. The audit's A7 check exists to stop this regressing: any element that truncates must prove it declared a truncation that renders.

**The phase bar.** Directly beneath the rail sits a full-width band, 8px on Room, 12px on TV, 5px on Table, carrying the phase colour. This is the answer to a real problem the critique identified: the brief calls phase legibility the most important thing a big screen does, and revision 1 left the room's only persistent phase signal as a 20px pill in the top-left corner — **8.3 arcminutes at 25 feet**, which is a coloured blob, not a word. A band is perceived without being read, costs almost no vertical space, and works at any distance.

Colour must also disambiguate, which it previously did not: LOBBY and VOTE were both `--secondary`, ASK and COMPLETE both `--primary`. Now LOBBY is `--muted` (it is the low-energy pre-state), ASK `--primary`, VOTE `--secondary`, RESULTS `--success`, and COMPLETE is a **doubled-height striped amber band** — distinguished by pattern and weight, not only hue, so it cannot be mistaken for ASK.

The single strongest persistent phase cue remains the dock's primary label ("Show Results" at ~37px). Revision 1 arrived at that by accident; it is now deliberate, and it is the reason the dock's label is written as a verb phrase naming the *next* beat rather than as a generic "Next".

**The round timer — a defended yes, with conditions.** Revision 1 removed the `bs-timer-ring` on the grounds that it "reads as a countdown to a room, implying time pressure that does not exist". All three first-look evaluators then asked for a timer, unprompted, and one of them named the cost of not having it precisely: *"in a hybrid all-hands, silence is the enemy… I will fill that silence by talking, badly, for an unknown number of seconds."*

The original argument was right about the wrong thing. What was wrong with the ring was not that it was a clock; it was that it was **answer progress drawn as a clock** — a fake instrument, telling the room a fraction while looking like a duration. The objection was to the lie, not the genre, and I generalised it too far.

So: an **explicit countdown, armed by the host from the setup panel, off by default.** When armed it sits in the rail at `--t-meta × 1.5` and turns amber under thirty seconds. Three constraints make it honest:

1. It counts something real — a duration the host chose — and nothing else is ever drawn as a clock.
2. **It never advances the round.** Expiry changes the dock status and stops; taking control away from a facilitator at a fixed moment is worse than the silence it solves.
3. Off by default, because a visible countdown changes how a room answers and not every session wants that. A host who wants one will find it under Setup; a host who does not will never see it.

### 5.2 Room meter (right of content, sized to its content)

One region, one question: **where is the room.**

It is a grid column of `auto` width with `align-self: start` and a `max-width` of `clamp(210px, 21vw, 460px)`. Revision 1 reserved a fixed `19vw + 130px` — 495px, 26% of a 1920 stage — in every non-solo state, and filled 150–250px of roughly 800px vertically, with a `border-left` hairline running the full height beside a quarter of a column of content. Sizing the track to its content and letting the divider span only the meter's own height removes both tells.

**It states progress once.** §2.8 is the strongest passage in this document and revision 2 violated it more comprehensively than the code it condemned. On one `03-ask-trivia` viewport the room was told the same fact six times: the word ANSWERED, the numeral `40 / 40`, a filled bar, the sentence "Everyone is in", forty dots, and "All 40 answered" in the dock. All three first-look evaluators counted them.

What survives is the **labelled fraction**, because it is the only representation that is both precise and legible at twenty-five feet. The bar encodes the same ratio less precisely. The dot matrix encodes it least precisely, costs the most vertical space, and — see §5.3 — doubles as a public per-person attendance record. Both are deleted. (The dot matrix was praised in the earlier critique as the best reduction in the spec. It is a good idea that turned out to be the third statement of a fact that only needed one, and being the best of three redundant things is not a defence.)

| Phase | Heading | Body |
|---|---|---|
| LOBBY | IN THE ROOM | one count |
| ASK | ANSWERED | `31 / 40` |
| VOTE | VOTED | `26 / 40` |
| RESULTS | STANDINGS | top 6 by score, "+ N more" — a leaderboard, not progress |
| Wavelength RESULTS, ENDED | *(collapsed)* | the terms / the conclusion take the full stage |

Completion turns the numeral `--success-text`. The dock adds a readiness *judgement* — never the number again. Audit check **A12** counts progress statements per viewport and fails above one.

**The dot matrix is the reduction that makes 40 players fit.** Above 12 players, names stop being useful — at 40 they cannot be shown at 20px in a 380px column, and more importantly they are not the question. The room and the host both need one number: how many are we waiting on. Forty dots at `1.3vh + 8px` occupy about 200px and read instantly from the back row.

**Nobody is named on the stage. This reverses revision 2, and the reversal is the right call.**

Revision 1 kept the list of non-responders in the Console; the critique argued that a facilitator should not have to project an operator panel to learn that Dana had not answered, and revision 2 accordingly put `waiting on Dana, Tomás, Jordan and 6 more` in the dock. A Chief of Staff who runs 200-person hybrid all-hands in healthcare read that and said she would have it removed before running the tool once: *"our clinical staff answer late because they are with patients."*

She is right and the critique was wrong, for a reason the critique had no way to see: it evaluated the nudge as a facilitation affordance, and it is also an attendance record. Displaying who has not complied, by name, to two hundred colleagues, is an HR artefact regardless of intent. The room-facing benefit — a gentle prod — is real but small; the cost lands on exactly the people least able to object.

So the stage shows a count and never a name. Who specifically is missing is genuinely useful to the host, so it moves to the one surface where the audience is a single person: the phone remote (§5.5). A host without a phone loses the names and keeps everything else, which is the correct trade.

### 5.3 Dock (bottom)

A grid row, not a fixed overlay. This is a small change with a large consequence: `position: fixed` guarantees the control is *visible*, but a grid row guarantees it is *placed* — it cannot be covered by a rail, clipped by a `height: 100vh; overflow: hidden` ancestor (which is exactly the bug the big-screen CSS comment at styles.css:7190 documents), or reach a state where reserved padding fights the content.

Contents, left to right: the **setup control** (`⋯ SETUP`, minimum 48×48), the **status line**, then flexible space, an optional **hint**, an optional **back** step, the **ghost secondary** (Skip), the **`SPACE` key hint**, and the **primary action**.

**The status line states a judgement, not a count** — `Some are still answering`, `Safe to move on`. The meter owns the number (§5.2); the dock owns the decision. This is what makes two surfaces mentioning progress defensible rather than redundant: they answer different questions.

**The `SPACE` hint now shows in every profile.** Revision 2 hid it in Room and TV, which are precisely the profiles where the operator is furthest from the machine and most dependent on knowing a key exists. A reviewer caught the inversion; it was mine, and it was backwards.

The dock reserves a fixed `--dock-h` per profile, and the Console's `bottom` is bound to the same variable — see §5.4.

**Going back — a partial yes, and an honest no.** Every dock in revision 2 advanced; nothing went back. The evaluator's scenario is the real one: *"if I hit Show Results while three people are still typing, I can find nothing on screen that reopens answering."*

Two different things wear the same word, and conflating them is how you ship a button that lies:

- **Stepping back through the display** — What we heard → Results — writes nothing to the server and is always safe. This now has a visible `‹ Results` ghost in the dock, and `Left`/`PageUp` for a clicker. Shipped.
- **Reopening a closed phase** — going from RESULTS back to ASK — is not a display step. `get-results.js` has already written `RESULTS#nnn`, scored the round and broadcast it to every phone. There is no endpoint that undoes that, and there is no honest way to draw a button for it. **Not shipped, and specified as backend work**: `POST /games/{id}/reopen-round` restoring `ASK#nnn`, clearing the round's scores and re-broadcasting. Until that exists the Console must not offer it.

What *can* be done today is to make the mistake harder. `hostRemote.js` already implements the right pattern — `needsConfirmation()` arms the primary when advancing would discard in-flight input, and only when it would. **The stage adopts it**: if the room is not complete, the first press arms the button (`9 people are still answering · press again`) and the second fires. When everyone is in it stays one press, because a button that fights the host on the expected beat reads as broken. Demonstrated on `17-remote.html`.

**Completion needs a cue, not just a colour.** Deleting the "All Players Have Answered!" takeover was right, but that overlay was also the peripheral signal that told a host who was *talking to the room* it was time to move. Two static colour changes do not replace it. The dock status therefore pulses its opacity three times over ~4.5s on reaching completion, and stops. It respects `prefers-reduced-motion`.

All of this comes from `config/hostControls.js` unchanged. The existing invariant test — every (game type × phase) pair yields exactly one primary — is what keeps this region honest and must be kept.

Two additions to `hostControls.js`:
- a `RESULTS` → `FIELD_NOTES` → `NEXT` sub-sequence (§6.6), so RESULTS has two beats rather than one long screen;
- an `ENDED` phase returning `{ id: 'report', label: 'Open Session Report' }`, so §2.7's dead end acquires a way forward.

### 5.4 Console (overlay)

**It must never cover the dock.** Revision 1 placed the drawer at `top:0; right:0; bottom:0` while simultaneously requiring the `Space`/`ArrowRight` shortcut to be suppressed whenever an overlay was open. The two rules combined produced a state in which **the session could not be advanced at all** — not by click, because the drawer sat on top of the primary button at the right edge of the dock, and not by key, because the spec had disabled the key. That is a direct violation of §7.1 by the design's own component.

Three corrections:

1. **The drawer and its scrim stop at `bottom: var(--dock-h)`.** The dock is a no-overlay zone. The primary action, the Skip ghost and the status line stay visible and clickable with the Console open, so the host can advance straight out of it — which is also the behaviour that makes "closes on advance" coherent.
2. **The advance shortcut stays live while the Console is open.** `HostActionBar` already refuses to fire when focus is in an `INPUT`/`TEXTAREA`/`SELECT`/`contenteditable` (`isTypingTarget`), which is the actual hazard; blanket-suppressing on any overlay was over-broad. The Console is therefore *excluded* from `anyOverlayOpen`. Modals that ask a question — the confirmation dialog, the question browser — stay in it.
3. **There is a visible way in and a visible way out.** A permanent `⋯` button sits at the far left of the dock status line at `--t-meta × 0.9` in `--muted`: a trackpad target from a foot away and an unreadable speck from the back row. The drawer has a `✕` close button, traps focus while open, and restores focus to the `⋯` on close.

**On discoverability and the hit target.** Revision 1's only entry points were the `\` key and a hover-revealed edge tab, and the edge tab appeared in the body of exactly one mockup — the one where the drawer was already open, so it was drawn behind it. Neither is acceptable: nobody hovers a projector, and `\` is behind ⌥⇧ or AltGr on several common layouts. `\` survives as an accelerator only.

Revision 2's `⋯` chip was then, in a consultant's words, *"perhaps thirty pixels wide in the bottom-left corner at low contrast — I could not hit that reliably standing at a flipchart with a clicker in one hand."* **Accepted.** The control is now a minimum 48×48 target carrying the word `SETUP` beside the glyph. It is still `--muted` at the label tier, so it remains an unreadable speck from the back row and a plain button from a foot away — which is exactly the split it needs.

**On the caption, and what the Console actually is.** Revision 2 printed *"Setup — the room can see this panel"* on the panel. All three evaluators read that as the design conceding its own central claim, and they were right to: a caption apologising for a leak is worse than either fixing it or not having it. Two of them independently drew the consequence — every recovery action is performed in front of the audience.

The honest resolution is not a better caption. It is to split the surface by what the information actually is:

- **The stage's setup panel is not private and no longer pretends to be.** It is a deliberate, dignified `Session setup` overlay — the mode a room understands, like a presenter opening slide options. So it must contain nothing that would embarrass anyone if projected. The email address is gone. **The roster of who has not answered is gone.** What remains — categories, timer, re-pick, profile, join link — is configuration a room can watch without cost.
- **Anything genuinely private lives on the phone remote (§5.5)**, whose audience is one person.

That is a real architectural answer rather than a caption, and it does not require the second device: a host without a phone can do everything, and simply cannot see who specifically is missing — which they should not be projecting anyway. The caption is deleted because, once the panel holds nothing sensitive, there is nothing to warn about.

**On presentation clickers.** The critique notes that a host with a wireless clicker can advance (clickers send Right/PageDown) but cannot open the Console, and asks that this case be designed for. Partly accepted, partly argued:

- **Accepted:** the clicker should have a second verb. `Left`/`PageUp` maps to **step back one beat** — Field Notes ↔ Results — which is non-destructive, writes nothing to the server, and matches what a presenter expects a back button to do. Advance and step-back are now both clicker-reachable.
- **Argued:** the Console should *not* be clicker-reachable, and its absence there is not a capability gap. A host standing twenty feet from the laptop cannot read a 15px drawer, so a clicker-opened Console would be a panel they can summon and not use — while the room stares at it. More importantly the clicker is an *addition* to the laptop, never a replacement for it: the machine is in the room, and skip, re-pick and category changes are reachable from it in two seconds. Advance and step-back are the complete set of things anyone can usefully do from across a room, which is exactly what the clicker gets.

Sections: **This round** (choose the next question → §5.4.1, expand prompt on stage, skip) · **Categories** (the existing toggles and counts, moved off the stage intact) · **Round timer** (§5.1) · **Joining** (copy link, put the code back on the stage) · **Synthesis** (voice, rewrite the last summary) · **Display** (profile, session report, put the controls on my phone) · **Session** (show how this works on the stage → §6.2b, switch game, report a problem, sign out) · **Keys** (a four-line reference: `Space`/`→` advance, `←` step back, `↑ ↓` page the ballot, `\` toggle, `Esc` close).

Two of those entries open surfaces of their own. Both are specified below rather than left as buttons that lead nowhere.

#### 5.4.1 Choosing the next question → `18-question-browser.html`

The existing `question-browser-modal` (`GameHostPage.jsx:4515–4601`) renders the whole question table **including the correct answers of questions nobody has been asked yet**, at `z-index: 999999`. §2.6 verdicts it CUT-from-stage for exactly that reason. Moving it into a Console that §11.4 now says is deliberately *not* private looks like a direct contradiction, and it is one — so it has to be resolved rather than relocated.

**The resolution rests on a fact worth stating plainly: there is no display profile in which the stage is unobserved.** Room, TV and Call are shared by definition, and Table is *the host's laptop being read by three to five people around it*. The stage is watched in all four. That single fact disposes of the obvious middle option — a mask-with-reveal control is not a capability on a permanently shared surface, it is a trap. One curious tap in front of a room burns the next question, and the host finds out afterwards.

So the correct answer is not masked here. **It is absent.** The panel carries everything a host needs in order to *choose* — title, detail, category, difficulty, the options themselves, whether the question has already been asked, search and category filters, and a per-row `Ask next` — and does not carry the one thing that must not be projected. It says so once, without apology: *"Correct answers are not on this screen. The stage is a shared surface in every display profile, so an answer shown here is an answer shown to the room. Open the browser on your phone to see them."*

This is not a new rule. It is the rule §11.4 already applied to names, generalised:

> **Anything whose value depends on the room not seeing it does not exist on the stage. It lives on the remote.**

Names and correct answers are the same category of thing, and the Console stays honestly non-private because it continues to hold nothing that needs hiding. The apparent contradiction dissolves once you stop trying to make the panel private and start making its contents unremarkable.

**Rejected — blanking the stage behind the browser.** Tempting, and it does not work. Blanking removes the distraction of the live round; it does nothing about disclosure, because the panel itself is drawn on the same shared screen. It solves the wrong half of the problem while feeling like a solution, which is the worst property a fix can have.

**Rejected — browsing only on the remote.** Genuinely attractive: scanning forty-seven rows is a phone task, not a projector task, and a phone is private by construction. But the brief forbids requiring a second device, and picking a specific question mid-session is an ordinary need, not an advanced one. The remote gets the browser *as well* (§5.5), with the answers; the stage gets it without.

**Does the host lose anything they need?** To choose a question you need to know what it asks, which category it belongs to, how hard it is, and whether you have used it. You do not need the answer. If a host genuinely needs to verify an answer, that is an authoring task and belongs in the Builder before the session, not in front of a room during it.

**Ordinary use, done quickly.** Search filters titles as you type; category chips filter by section; `Unasked only` hides the used ones. Used questions stay in the list at reduced opacity with an `already asked` marker and an `Ask again` button, because "did I already use this?" is the question a host asks most often and hiding the answer to it is unhelpful. One click on `Ask next` commits and closes. The panel is `anyOverlayOpen`, so `Space` cannot fire the round forward while a host is reading a list.

#### 5.4.2 How this works — an action, not a document

The Console does **not** contain a how-to-play document. It contains a button that puts one on the stage. See §6.2b for why.

**No identity in the panel.** "Signed in as george.seib@gmail.com · Administrator" is deleted. §7.2 says the room must never see an email address, and moving it into a panel whose own banner reads *"the room can see this panel"* converts a guarantee into a hope — especially since skip, re-pick, categories and profile all live here, so the host will be opening it regularly, in front of people. "Sign out" is enough; which account is signed in is answerable elsewhere.

**Skip is not styled as destructive.** It was `--danger` red; §4.3 reserves red for destructive actions and errors. Skipping a round loses a question, not data, and red is the wrong signal on a control a host reaches for under time pressure. It is a neutral ghost button.

The Console is **the one surface in this design permitted to scroll.** It is operator-only, read at arm's length, and its length varies with the question set. The audit exempts it from the clipping and floor checks for exactly that reason, and for no other.

### 5.6 Anonymous responses

> *"We need a way to make all of the responses anonymous (optionally by game setup) until after voting. This is to avoid vote bias for a person. It should be default on."*

None of this exists today. `grep -i anonym` across `lambda-functions/` and `src/src/` returns an archive-uploader default and a privacy-policy sentence. Attribution currently ships with every answer: `get-answers.js:77-78` returns `playerName` and `name` on every row, and `start-vote.js:63-69` returns `playerId`, `playerName` and `name`. During voting, every answer on every surface is labelled with its author.

#### 5.6.1 It cannot be an access-control feature

`role` is a client-supplied query parameter (`get-answers.js:11`), not derived from auth. A player can request `role=host`. So "show names to the host, hide them from players" is not something this system can enforce, and a guarantee the API cannot keep is not a guarantee - it is a label on a leak.

Anonymity therefore has exactly one honest meaning: **the server does not send the names**, to anybody, until the host reveals. Everything below follows from that.

#### 5.6.2 Ruling: nobody sees authorship during an anonymous round, including the host

This is the hard question, and the reasoning matters more than the answer.

There is an apparent conflict with §5.3, where three first-look reviewers pushed hard for the facilitator to know who has not contributed, and where I added and then removed *"waiting on Dana, Tomas, Jordan"*. If a facilitator needs names, does anonymity take them away?

**No - because those are two different facts, and only one of them is the sensitive one.**

- *Who has not acted yet* is a set of names with **no mapping to answers**. Knowing Dana has not answered tells you nothing about which answer is Dana's.
- *Who wrote which answer* is the mapping. That, and only that, produces the vote bias the owner is trying to remove.

Once separated, the tension dissolves. Roster attribution is untouched by anonymity and stays exactly where §5.5 put it: on the remote. Answer attribution is withheld from everyone until reveal. A host running an anonymous round loses nothing they had - and, decisively for the no-second-device rule, **an anonymous round needs no phone to facilitate**, because the facilitation data is not the anonymised data.

Why the host is inside "nobody", when the host is the one person the room already trusts:

1. **It is not enforceable anyway** (§5.6.1). If the server will emit the mapping to a caller claiming `role=host`, it will emit it to any caller. The only implementable design is one where the payload does not contain it.
2. **The host is the strongest bias vector in the room.** Even a host who does not vote facilitates: *"let's talk about number three"* lands differently when you know three is the CEO's. Removing name bias from forty voters and leaving it with the one person steering the discussion removes the smaller half of the problem.
3. **It is a promise made in public.** The stage tells the room the answers are anonymous. If the host can see them, that sentence is false - and it is the kind of false that gets discovered.

This is the rule from §5.4.1 with the clause it always needed:

> Anything whose value depends on the room not seeing it does not exist on the stage; it lives on the remote. **And anything whose value depends on *nobody* seeing it exists on neither - the server does not send it.**

Names of non-responders are the first kind. Correct answers are the first kind. Authorship during an anonymous round is the second.

#### 5.6.3 The setup control -> `20-setup.html`

It lives in game setup, in a **Responses** section beside the existing shuffle option, and it is called **"Anonymous responses"** - not `anonymousUntilReveal`, and not "hide names", which describes a mechanism rather than an outcome.

Because it defaults to on, the copy has to make an *already-active* guarantee legible to a host who never touches it. Three lines do that work and a two-panel preview does the rest:

- **What it does:** *"Until you reveal them, nobody sees who wrote which answer - not the room, not you. The room votes on the answers, not on the people."* The second clause is the surprising one, so it is stated rather than implied.
- **What off means:** *"Turn it off and every answer is labelled with its author from the moment voting opens, as it is today."*
- **What it cannot promise:** see §5.6.6.

The preview shows one answer twice - `Response 1` while voting, `Priya Raghavan · +180 pts` after the reveal - because the fastest way to explain a state machine is to show both states side by side.

**It appears only for formats that hold a vote.** That is not a new taxonomy: `hostRunsVotePhase()` in `config/hostControls.js` already computes exactly this set - call-and-answer, poll, survey. Trivia has no authored answer to attribute (the response is a letter) and wavelength never attributes one on the stage anyway (§6.10 cut the per-player contribution list). For those two the option is hidden rather than shown-and-disabled, because an option that cannot do anything is a question a host should not be asked.

#### 5.6.4 The reveal -> `06-results-call-and-answer.html` -> `21-results-revealed.html`

**The reveal is the primary action of RESULTS, not an automatic consequence of arriving there.**

RESULTS lands anonymous: the top three answers, ranked by votes, labelled `Response 1/2/3`. The dock reads *"Ranked on merit - nobody knows whose is whose yet"* and its primary is **Reveal who wrote these**. Pressing it annotates the cards in place and unfreezes the standings; the primary then becomes **What we heard**. The beat order for an anonymous round is:

```
RESULTS (anonymous) -> RESULTS (revealed) -> What we heard -> Next Round
```

That preserves §5.3's invariant of exactly one primary per beat, and it makes the reveal unmissable - a host cannot forget to reveal, because revealing is the only way forward. It also gives the room the honest sequence: the ranking arrives on merit, and *then* you learn who.

**No standings before the reveal.** This is the subtle leak and it is worth naming precisely: for call-and-answer, points come from votes cast on your own answer, so a leaderboard that updates while the answers are still anonymous is **attribution by arithmetic** - watch whose score jumps by 180 and you have found the author of the 180-point answer. Pre-reveal RESULTS therefore runs `main solo` with no meter at all, and the standings return, already updated, at the reveal. The reveal visibly delivers something, which is the right shape for a beat that costs a press.

**It annotates; it does not take the screen. Ruled twice, and held the second time against the users who asked.**

Two of three evaluators asked for the reveal to get `16-phase-wipe`'s full-width band. That is real evidence from the people this is for, and it deserved a real answer rather than a restatement.

The original argument stands: the wipe's vocabulary means one specific thing — *"look at your phone now"*, an instruction — and a reveal is an annotation of an object the room is already looking at. Covering the three answers and uncovering them makes the room re-find its place in the thing being annotated.

But the argument that actually decides it is one **the evaluators were not in a position to make**, and it is worth stating because it generalises. They each saw the set once, as stills. Nobody has sat through eight rounds of it. A wipe that fires twice per round fires sixteen times in a session, and its entire value is that it is unmissable — a property that decays with frequency. The reviewers who asked for a second wipe are the same reviewers who unanimously named the first one as the thing that solves their notice problem. **Single-screen review cannot see habituation**, so a request generated by it is evidence about the moment and not about the session.

What the request *is* good evidence for is that a staggered fade is too quiet for a payoff beat. So the moment gets louder without spending the wipe: the author lines animate in over 500ms with a 60ms stagger, an amber sweep crosses the card stack once, and the phase bar pulses. `prefers-reduced-motion` gets the end state with no stagger and no sweep.

**What would change this ruling:** run one real session with the wipe on both beats and one without, and ask the host afterwards whether the *voting* wipe still landed by round six. If it does, I am wrong and the reveal should have it. That is a cheap test and it is the only one that can settle it.

**Going back.** The revealed state carries a `‹ Hide again` step. It is display-only and does not un-send anything - the payload has already been delivered. It exists for the host who reveals a beat early, and the spec should not pretend it is a security control.

**Nobody voted.** If the vote phase closes with zero votes there is no ranking. RESULTS shows the responses in submission order under *"No votes were cast"*, and the reveal still happens: the round is over, so the reason for anonymity has expired. Same for a round the host skipped past voting entirely.

#### 5.6.5 The backend contract

Someone will implement this, so it is stated exactly, and every line below was read in the source rather than inferred from the UI.

**The ballot is already positional, and already carries no attribution.** This is the single most important fact for estimating the work, and an earlier draft of this section got it wrong in the expensive direction. Verified:

- `submit-vote.js:63` stores `Votes: votes, // e.g., {"0": 1, "1": 2, "2": 3}` — a map from **answer index** to rank.
- `get-results.js:275-286` initialises `answerScores[index]` and `voteTallies[index]` from `answers.forEach((answer, index) => …)`, and `:290-293` reads `vote.Votes` back against those same indices.

No vote record anywhere stores a player name as an answer reference. The `playerId: answer.PlayerName` in `start-vote.js:74` is a **label in the response payload**, not the identifier the ballot uses — the client votes by position. Anonymity is therefore **a redaction and nothing more**: withhold `playerId`, `playerName` and `name` from the vote-phase payloads, and join them back at reveal. No key change, no data migration, no new identifier is required to ship this feature.

**Setup.** Beside the existing default-on idiom:

```js
hostPreferences: {
  randomizeQuestions: randomizeQuestions !== false,
  anonymousUntilReveal: anonymousUntilReveal !== false   // default ON, as asked
}
```

`hostPreferences` already round-trips end to end — persisted as `HostPreferences` by `save-game-context.js:61`, read back by `get-complete-state.js:64` — so the storage path exists. **The create payload is not as free as that makes it sound**, and `create-game.js` says so in its own comment: adding a field takes *three* edits — the destructure at `:9`, the `createGame()` argument, and the METADATA item in `schema-compliant-manager.js` — and `triviaTimer` was sent by the frontend for months and silently discarded by missing them. Budget three edits and a test that asserts the value survives a round-trip.

**Per-round reveal state**, not per-game, because a host may reveal round 3 and end the session before round 4: `Round.AuthorsRevealed` (boolean, default false).

**Redaction gate.** Let `hidden = hostPreferences.anonymousUntilReveal !== false && !round.AuthorsRevealed`.

| Endpoint | Attribution today | When `hidden` |
|---|---|---|
| `GET /games/{id}/answers` | `playerName`, `name` (`:77-78`) | omit both |
| `POST /games/{id}/start-vote` | `playerId`, `playerName`, `name` — all three set from `answer.PlayerName` (`:73-78`) | omit all three |
| `POST /games/get-results` | `playerName` in each tally row (`:323`), and `Winners: winners.map(w => w.playerName)` persisted at `:414` | omit from the response; still persist internally |
| `playerAnswered` WS notification | `playerName` **plus the spread `...messageData`**, which for an `ANSWER#` message includes the answer text (`message.js:566-582`) | send the round and the fact of an answer; omit `playerName` and the answer body |

Answer order in the response is unchanged, because order is what the ballot runs on.

**`votingStarted` is already clean** and needs no change: `start-vote.js:58-63` broadcasts only `gameId`, `newState`, `state`, `questionNumber` and `timestamp`. The answers travel over HTTP, which is where the redaction belongs. An earlier draft of this table said "WebSocket round broadcasts may carry names", which was vague in both directions — it implied work on the broadcast that is already safe, and it missed the one that is not.

**New endpoint.** `POST /games/{id}/reveal-authors { questionNumber }` sets `AuthorsRevealed`, broadcasts `authorsRevealed`, and returns the rows with attribution joined back on. Idempotent.

**Omit, do not null.** The field should be absent rather than `null`, so a client that forgets to handle anonymity renders nothing instead of the string "null", and so the redaction is visible in a payload diff.

#### 5.6.5a Risk R1 — positional answer ordering is stable only by accident

**This is independent of anonymity. Do not bundle them, and do not block either on the other.** It is recorded here because it was found while verifying the contract above, and because the fix would look superficially like an anonymity change.

Both `start-vote.js:40` and `get-results.js` obtain the round's answers by querying the `QUESTION#nnn#ANSWER#` sort-key prefix. The answer key is written as `QUESTION#${questionNumber}#ANSWER#${playerName}` (`message.js:355`), so the returned order is DynamoDB sort-key order — **alphabetical by the author's name.** The indices issued on the ballot line up with the indices used at tally *because the key happens to contain the author*, and for no other reason.

The consequence: any change to answer keying, or any answer row that arrives between the ballot being issued and the results being tallied, silently shifts every index at or after the insertion point and **lands votes on the wrong answers**. It fails silently — no error, no mismatch, just a wrong winner.

**Recommendation.** Introduce a stable opaque `answerId` per round (`r003-a07`, or a hash of `gameId|round|index`) and have `submit-vote` accept it in place of the positional key, with `get-results` tallying against it. Worth doing on its own merits. Not a prerequisite for anonymous responses, which ships as a redaction over the existing positional ballot.

#### 5.6.6 What the feature promises, and what it cannot

The spec must not overclaim, because the room is being told something.

- **Small rooms de-anonymise by elimination.** Six people, six answers, a known guest list, and "6 of 6 answered" on the stage is a solvable puzzle; with two people it is not even a puzzle. The setup copy says so in the host's own language: *"This hides names, not identities."*
- **Distinctive voice defeats it.** A colleague's turn of phrase is recognisable to the people who work with them. No product feature fixes that.
- **It is not a secret ballot.** The server knows, the database knows, and the report knows once revealed. This removes the label from the room's view during the vote. It must never be described as anonymity in the cryptographic sense.
- **The vote itself is not anonymised.** This feature is about who *wrote* an answer, not who *voted* for it.

#### 5.6.7 Leak surfaces in the product as it stands

Named, whether or not they are solved here:

1. **`get-answers.js`, `start-vote.js`, `get-results.js`** - the three payloads in §5.6.5. Straight redactions.
2. **The standings meter** - attribution by arithmetic (§5.6.4). Solved here by removing standings pre-reveal. Note the leak has a physical source: `get-results.js:336-389` writes scores to `PLAYER#{playerName}#SCORE`, so the points genuinely are per-person and a visible delta genuinely does identify an author.
3. **"What we heard" / AI Field Notes — the worst one, and it is not hypothetical.** An earlier draft said the model "could" quote or attribute. It is not a could and it is not the model: `get-ai-summary.js:1175-1176` builds the string in code —

   ```js
   parts.push(`${top.playerName}'s answer, "${top.answer}", earned the most support (…)`);
   ```

   — so the top contributor is named and quoted verbatim by a deterministic template, every time. Two mitigations, the first structural: the beat is ordered *after* the reveal, so attribution is already public by the time it renders. The second is required anyway, because a host may press Next Round without ever revealing: while `hidden`, this template must fall back to an unattributed form ("the most-supported answer was …") and the model prompt must be built from redacted rows.
4. **The session report and archive export** - `create-report.js` attributes freely (`:278`, `:317`, `:436`, `:441`), and `get-results.js:414` persists `Winners` by name into the round record, so the report can reconstruct attribution even if the response was redacted. Rule: **a round that was never revealed stays unattributed in the report**, which means the report must read `AuthorsRevealed` rather than simply reading what is in the table. Otherwise a promise made to the room is quietly broken by an artefact produced after everyone has left.
5. **The `playerAnswered` WebSocket notification — the leak that would survive a purely HTTP redaction.** On every `ANSWER#nnn` message, `message.js:566-582` pushes `{ messageType, gameId, playerName, ...messageData }` to the host connection, and for an answer `messageData` carries the answer text. So the host's socket receives a live author-to-answer mapping in real time, before any endpoint is called. Redacting `get-answers` and `start-vote` while leaving this in place would produce a feature that looks anonymous and is not. Under §5.6.2 the host is inside "nobody", so this must be redacted too: broadcast that *an* answer arrived and the round it belongs to, not who wrote what. (`playerVoted` may keep its `playerName` — §5.6.6 is explicit that the vote itself is not anonymised.)
6. **The player's own screen** - a player sees their own answer attributed to themselves. Correct, and not a leak.
7. **Progress arithmetic** - "31 of 40 answered" beside a visible response count is the elimination attack in §5.6.6. Accepted and documented rather than fixed; hiding the count would cost more than it buys.

### 5.5 The phone remote — optional, demonstrated, and the only surface that may name people

→ `17-remote.html`

`HostRemote.jsx` already exists and already drives every transition over HTTP independently of the host page. Revision 2 mentioned it in one Console button and never drew it, which a reviewer noticed: *"it is a button in a picture and there is nothing anywhere showing me what it does."* It is now drawn, because the thing it enables is the answer to the strongest objection in the review round.

**What it adds that the stage cannot have.** Two things, and they are the same kind of thing:

1. **Names.** `Still to answer: Dana, Tomás, Jordan…` — exactly what a facilitator needs, exactly what a room must not be shown (§5.3).
2. **Correct answers.** The remote's second screen is the question browser with the answer marked (§5.4.1). Scanning forty-seven rows is a phone task anyway; the privacy falls out of the device rather than having to be engineered.

A surface whose audience is one person can hold both; a wall can hold neither. The remote also carries the arm-then-fire confirmation, skip, expand-on-stage and the timer.

**What it does not change.** It remains optional and it remains additive. Approach C's reasoning in §3.2 stands: the brief forbids *requiring* a second device, two live backend defects make a mandatory second controller unsafe, and a host with a dead phone must lose nothing but the names. Every action on the remote also exists under Setup on the stage. The correct framing, and the one the mockup uses, is *"optional, never required"* — not "recommended", and certainly not "needed for privacy", because the stage is designed to have nothing to hide in the first place.

---

## 6. State-by-state

Twelve states. Each holds its **worst case** in one viewport with no scrolling and no silent clipping, at four display profiles × five viewports, verified by `audit.html`.

Each state below gives its **content budget** — the most content the layout accepts at the top rung — and its **order of sacrifice**, the `data-drop` sequence §4.2b applies when the budget is exceeded. The mockups carry the worst case, so what you see is the reduction already firing.

### 6.1 State 1 — CREATED
*No mockup; identical to State 2 with an empty meter.*

**Room:** rail (LOBBY chip, event title, join line) · the join block: 300px+ QR, the typed URL, the session code at `--t-hero` in amber · meter reading `IN THE ROOM · 0`.
**Dock:** "Waiting for players to join…" / **Start First Round**, disabled, hint "At least one player has to join first."
**Operator:** Console (question set, categories, invite).
**Empty case:** with no question set chosen the hint becomes "Choose a question set in the Console first" — reworded from today's "in Game Info," which names a panel that no longer exists.

### 6.2 State 2 — STARTED / lobby → `01-lobby.html`

As above, with the meter filling: count at `--t-primary × 0.92`, then names as they arrive. Nine names fit; beyond that "+ N more". Above 20 players the meter switches to the dot matrix and the count carries the load alone.

**Dock:** "12 players ready" (`--success`) / **Start First Round**.

The lobby is the one state where a decorative surface earns its space, so the photo field's scrim is at its lightest here and the ridge is fully visible.

### 6.2b How this works — a lobby beat → `19-how-to-play.html`

**Who is it for? The room.** That is the whole ruling, and it follows from §2.1's own reasoning rather than contradicting it. The ~180 words per game type in the current instructions rail were cut from the stage because they are *addressed to players* — "Read the Content", "Provide Your Response" — and players have their own screens. True, but the conclusion drawn was wrong: the fix for content in the wrong place is to move it to the right place, and revision 2 filed it in a panel the host reads silently, where nobody it is addressed to will ever see it.

So the instructions go back on the stage — as a **deliberate thirty-second beat in the lobby**, triggered from the dock or from Setup, returning to the join screen or straight into the first round.

**Rewritten, not relocated.** A wall is not a manual. The four numbered steps become four lines of about ten words each — roughly forty words against the original hundred and eighty — at `--t-secondary`, with a single footnote. The four "Tips" bullets per game type are **cut entirely**: they are advice to an individual answering on a phone, and they belong on the phone if anywhere. Each game type keeps its own four lines (call-and-answer, trivia, poll, wavelength, survey).

**The Console holds no how-to-play document at all** (§5.4.2). Its button is an action — `Show how this works on the stage →`. What the Console *does* gain is the thing that genuinely is operator content and genuinely was missing: a four-line **Keys** card. Those are different documents, and only one of them is a document.

**Dock:** `Showing the format to the room` / **Start First Round**, with `‹ Join screen` to step back. **Sacrifice:** (1) the footnote.

### 6.3 States 3–4 — ASK, Call & Answer (and the artwork variant) → `02-ask-call-and-answer.html`, `15-edge-minimum.html`

**Room:** the question at `--t-primary`, capped at `--measure` (26ch on Room); the detail line at `--t-body` in `--text` at 82% opacity, capped at 44ch, clamped to 3 lines; meter counting answers.
**Budget:** question ≤ 4 lines at rung a. **Sacrifice:** (1) the detail line.
**Dock:** "31 of 40 answered · waiting on Dana, Tomás, Jordan and 6 more" / **Start Voting**, with **Skip Round** as a ghost.

**Long question.** The mockup carries a 264-character prompt — the longest a strategic session plausibly produces. It steps down through rungs b and c, and the question itself is `-webkit-line-clamp`ed at 6 lines (7 at rung c) so it can never eat the options or the dock. Below that the full text is not shrunk further: **Expand prompt on stage** in the Console pushes it as a full-stage takeover at `--t-body`, a deliberate beat the room can see happening. That preserves the existing `expanded-lesson-overlay` and gives it a purpose.

**Artwork rounds** (a `call-and-answer` question carrying an `image`; art is not a game type, per `config/instructions.js`). The content area splits 50/50: prompt left at the stepped-down size, artwork right at `aspect-ratio: 4/3` filling its half. The round noun becomes "Artwork" via the existing `resolveRoundNoun`. The `ART_TITLE_INSTRUCTION` is *not* printed — it is on every player's phone — but the kicker carries a four-word version of it: "Name this work · accurate, witty, or make the room think."

### 6.4 State 5 — ASK, Trivia → `03-ask-trivia.html`

**Room:** question at `--t-primary`; options at `--t-secondary` (40px) with amber circular letter badges, each clamped to 2 lines.

**Grid rule:** two columns whenever there are **four or more** options, one column for three or fewer. Revision 1 had this backwards — it said five or six options should "switch to a single column", but six options in one column is *taller* than six in two, so the stated mitigation would have made the overflow worse. Six options render as a 2×3 grid.

**Budget:** question ≤ 3 lines + 6 options ≤ 2 lines each at rung a. This is the case that decapitated revision 1: measured at 1920×1080, `.content` was a 765px box holding 903px of content, and the room saw the question as "margin lift in B2B software?" with options E and F sliced in half. It now steps to rung b, then c.
**Sacrifice:** none — trivia options are the content; if they will not fit, the type steps down until they do, and the 20px floor is reached long after the options have shrunk to fit.
**Dock:** "All 40 answered" (`--success`) / **Show Results**.

Trivia never enters VOTE (`hostControls.TYPES_THAT_SKIP_VOTE`), so the dock goes straight from ASK to RESULTS. The room must be able to see that this game type is shorter, which it can, because the dock names the next beat.

### 6.5 State 6 — ASK, Wavelength → `04-ask-wavelength.html`

The subject word is the entire screen: `--t-hero` in amber, clamped to 2 lines, with a kicker above ("Up to ten words · first thing that comes to mind") and the framing sentence below at `--t-body`.

The meter reads **ANSWERED**, not "sent words". Revision 1 used two nouns for one fact — the meter said "SENT WORDS 5 / 12" while the dock said "5 of 12 answered" — and "sent words" was also simply wrong: five of twelve *people* have sent words, and the results screen then counts 214 words.
**Sacrifice:** (1) the framing sentence.
**Dock:** "17 of 40 answered…" / **Show Results**.

### 6.6 State 7 — ASK, Poll / Survey

Renders identically to State 3. Note the live divergence recorded in `hostControls.js:19–32`: `survey` *does* run a VOTE phase at runtime and `wavelength` does not, the opposite of what the old `GAME_TYPES` table claimed. This spec follows `hostControls.js`, which follows the running code. The redesign must not be the change that silently "fixes" the survey flow.

### 6.7 State 8 — VOTE → `05-vote.html`

The carousel is gone. The stage shows **three responses per page as full-width cards**, each with a rank number, the answer at `--t-body` clamped to **four** lines, the author at `--t-meta`, a live vote tally and a proportional fill bar. Pages advance automatically with page dots and an `n of m` label; the host never touches them. The Console retains manual paging.

**Three, not six.** Revision 1 specified six cards in two columns with a two-line clamp, and every one of them truncated: at 1920 the room saw six sentence fragments, and at 1280 each card was 158px wide and held about six words. The justification offered was that players hold the full list on their phones — but if the phone owns the text, six half-sentences on the wall are ceremony, and a shared focus made of fragments is not a shared focus. The carousel this replaces at least showed one answer *whole*. Three full-width cards at four lines each hold a real strategic answer; there are simply more pages, which costs nothing because the pager is automatic.

**Rotation is off by default, and the items are numbered.** This is the change a workshop facilitator called the single most facilitation-hostile thing in the set, and the reasoning is worth recording because it is not obvious from a screenshot:

> *"When I run a prioritisation, the room's shared attention* is *the deliverable. I say 'look at six and eleven' and forty heads go to the same place. On this screen there is no six and eleven — there is whatever page happens to be up, and it changes under them mid-sentence. I cannot point. I cannot hold. I cannot go back to the one someone wants to argue about."*

Auto-rotation optimised for the wrong thing. It was chosen to remove an operator task, and it removed the operator's control of the room instead — during the one phase where holding attention on a specific item is the entire job. So:

- **Responses carry stable numbers** that run 1…N across the whole ballot, not per page. "Look at six and eleven" now resolves.
- **Paging is manual by default** — `↑`/`↓`, and in the setup panel. The pager reads `Responses 1–3 of 20 · page 1 of 7`.
- **Auto-rotation survives as an opt-in** for the unattended case (a lobby screen, a long silent read), off unless chosen.

**The question is on the screen.** Revision 2's vote state showed "Pick the two you would actually fund" and never the prompt those answers were answering — after the room had spent three minutes heads-down on their phones. §6.8 had already learned this lesson for RESULTS and VOTE did not inherit it. The recap is now on both.

**The leader's fill bar caps at 90%.** At 100% it read as a selected state rather than a proportional bar.

**Artwork rounds** keep the image at 40% of the stage with two cards beside it.
**Dock:** "26 of 40 voted…" / **Show Results**.
**Edge — one response:** one card, full width, no pager, and the dock reads "Only one response — voting will be quick."

### 6.8 State 9 — RESULTS, Call & Answer / Poll / Survey → `06-results-call-and-answer.html`

**Room:** kicker "The room funded these", **the question recap**, then the **top three** answers as full-width cards, rank 1 carrying the 2px amber outline, each with the answer, the author, the points awarded and the vote count. Below them one line: *"37 more responses in the session report."* Meter shows STANDINGS.

**The recap is not optional.** Revision 1 dropped it, and that was a straight §7.10 violation — §2.5 had verdicted it ROOM/reduced, i.e. keep. The design's own premise is that players are heads-down on their phones during ASK; that premise is exactly what makes the recap load-bearing. A room that looks up at RESULTS and sees three answers under "The room funded these" has no idea what was asked. It renders at `--t-body`, `--text`, one line, `text-overflow: ellipsis`.

**Budget:** recap 1 line + 3 cards ≤ 4 lines each. **Sacrifice:** (1) the third card, which becomes "and 38 more in the report".

The cut from forty result cards to three is the largest single reduction in this spec, and it is the right one. Positions 4–40 are unreadable at any honest size, nobody in the room is tracking them, and they are captured verbatim in the report. Saying so on screen is more respectful than pretending to show them in 14px.

**Dock:** "Results are on screen" / **Field Notes**, with **Next Round** as a ghost so a host who wants to skip Workie can.

### 6.9 State 10 — RESULTS, Trivia → `07-results-trivia.html`

**Room:** the **question recap** at `--t-body` (one line, ellipsis — same argument as §6.8), then the options as a single-column distribution. The correct row *is* the headline — `--t-secondary × 1.26`, 2px `--success` border, teal letter badge, a `CORRECT` pill, and its share of the vote — and the others are `--muted` at normal size with percentages and proportional fills. The explanation follows at `--t-body`. Meter shows STANDINGS.

**Budget:** recap + up to 6 rows + explanation. **Sacrifice, in order:** (1) option F, (2) option E — collapsing to "Options E–F — in the session report" — then (3) the explanation. The correct row and the top three chosen options are never dropped.

An earlier draft of this mockup repeated the correct answer as an `<h1>` above the list, which is the same string twice inside 100px — precisely the fault this document exists to remove. Letting the winning row carry the headline weight is the fix, and it also makes the distribution legible as one object rather than two.

`trivia-player-scores` is deleted from the stage; the standings meter is the single place a score appears.
**Dock:** "5 of 12 got it" / **Field Notes**, ghost **Next Question**.

### 6.10 State 11 — RESULTS, Wavelength → `08-results-wavelength.html`

The meter collapses; the terms take the full stage.

**It is a ranked weighted flow, not a packed cloud.** Revision 1 gave this state three sentences of spec and twelve hand-placed absolutely-positioned spans, while the line above them announced "34 distinct" — the screen contradicting itself, with no rule for which twelve and no "+22 more". Fed sixty real terms it produced overlapping text throughout, and the single amber focal term was the one most likely to be obscured.

A packed cloud needs measured bounding boxes and a collision test to be legible, and even done properly it cannot guarantee the floor or that the focal term is unobscured. So the shape changes: terms are laid out in **descending frequency as a wrapped inline flow**, sized in five buckets from `--t-hero` down to `--t-meta` (the floor — no term is ever smaller), each carrying its count as a superscript. Deterministic, no collisions, no algorithm to get wrong, and at 25 feet a frequency-ordered list is the better read anyway.

**One accent.** The top term is amber; everything else is `--text` or `--muted`. Revision 1 coloured one arbitrary mid-frequency term `--secondary` for no stated reason, putting two accents on a view §4.3 gives one.

**N is stated on screen.** The kicker reads `Pricing power · 40 people · 214 words · 60 distinct · showing the top 16`, and a line below reads "All 60 terms in the session report". N is whatever fits above the floor; the sacrifice order drops the smallest bucket first.
**Dock:** "Three terms carried the room" / **Field Notes**, ghost **Next Subject**.

### 6.11 State 9b/10b/11b — Field Notes → `09-field-notes.html`

A sub-beat of every RESULTS state, and the answer to "the AI summary is long and must scroll." It does not scroll; it gets its own screen.

**It is called "What we heard", not "Workie's read on the room".** An AI's pet name on a client's wall *"reads as unserious and invites a fifteen-minute detour about what the model is and where the data goes"*. Internal product vocabulary does not belong on a projected surface; nor does `Names in the Console`, which revision 2 printed on the lobby screen — nobody in the room knows what the Console is, and nobody should have to.

**Room:** an amber left rule, the kicker "Across all forty responses", then **one headline sentence** at `--t-primary × 0.82` clamped to 4 lines and capped at 20ch of its own size, and **up to three numbered discussion prompts** at `--t-body`, each capped at 34ch and clamped to 3 lines. At ≥1600px wide the two sit side by side; below that they stack.

**The measure goes on the text, at the text's own size.** Revision 1 set `max-width: 52ch` on the *container*, which has no `font-size` of its own, so `ch` resolved against the inherited 16px body font and produced a 520px column — a 26-character measure for 30px text, occupying 27% of a 1920 stage with 65% of the screen empty and the prompts clipped anyway. `ch` is relative to the font of the element it is declared on; putting it on a container that does not set a font size is a unit error, not a layout choice. This is the state whose entire justification is that it fits, so it is the one that could least afford the bug.

**Budget:** headline ≤ 4 lines + 3 prompts ≤ 3 lines each. **Sacrifice:** (1) prompt 3, then (2) prompt 2.

Anything Workie generates beyond that — next steps, the full markdown body, the debug provenance — is not shown to the room. It is in the Console and in the report, and a line on screen says so. The stage version of Field Notes is a **discussion prompt**, not a document: the host reads it out and the room talks. A room does not read three hundred words off a wall — and the 900-word response in `09-field-notes.html` is what Workie actually produces, so the clamp is the design, not a fallback.

The instruction "Workie's prompt should be adjusted to produce a single sentence under 90 characters as its first line" stays, but it is a *preference*, not a guarantee. The view clamps regardless, because the model will not always comply.

**Dock:** "Discussion prompt on screen" / **Next Round**, ghost **Back to Results**.
**Empty case:** if generation is still running the beat is skipped entirely — the dock stays on **Next Round** and a small `Workie is writing…` line sits in the status. A spinner on a projector is dead air.

### 6.12 State 12 — ENDED → `10-ended.html`

The state that does not currently exist. On `gameEnded` the stage transitions directly — **no confirmation dialog** — to a finale: COMPLETE chip, "Session champion" kicker, the champion's name at `--t-hero` in amber clamped to 2 lines, their score at `--t-primary`, and a podium below showing **2nd and 3rd only**.

Two corrections from revision 1, both of them its own rules turned back on it. The podium showed three cards including 1st, so the champion's name appeared **twice in one viewport** — §7.4. And the rail still showed `JOIN eng.seibtribe.us/play · 4821`, so a finished session was still inviting people to join; the join line is replaced by the session summary (`8 rounds · 40 players · session closed`), which is what §6.12 said all along and the mockup did not do.

**Sacrifice:** (1) the scoreboard — the conclusion is the point.

**It leads with the conclusion, not the leaderboard.** A consultancy partner: *"my clients spent four hours deciding something and the last artefact on the wall is a leaderboard."* He is right for the sessions this product says it is for. The hero is now what the room decided; the most-backed contributor is a footnote beside it, and is the first thing dropped when space is tight. Trivia is the exception and may lead with the champion — it is a quiz and the scoreboard *is* the conclusion — but that is a per-game-type choice, not the default, and the default for a strategic session is the decision.

**Dock:** "All 8 rounds played" / **Open Session Report**, ghost **Keep on screen** (which dismisses the dock and leaves the podium up while people file out — the one case where the primary control may be hidden, and only on explicit request).

The existing `showConfirmation('End of Game', …)` flow is deleted. Ending a session is not a question to ask a host in front of a room, and the current code's failure branch — decline, and the game never reaches `ENDED` — is a bug this removes by construction.

### 6.13 Edge cases, collected

| Case | Behaviour | Mockup |
|---|---|---|
| Nobody has answered yet | Primary disabled, `--muted`; hint in plain English beside it ("The button wakes up on the first answer"). Never an error tone and never a full-screen alert. | `15-edge-minimum.html` |
| One player | Everything renders; the meter reads `0 / 1`; `hostControls`' singular/plural handling covers the copy. The lobby's Start button enables at one player, as today. | `15-edge-minimum.html` |
| 40 players | Roster → dot matrix; names move to the dock status (first three) and the Console (all). | `01-lobby.html`, `02-…`, `03-…` |
| Very long question | Rungs b/c, then a 6-line clamp, then the Expand beat. | `02-ask-call-and-answer.html` |
| Six long trivia options | 2×3 grid, rungs b/c, 2-line clamp per option. | `03-ask-trivia.html`, `14-density-tv.html` |
| Image round | 50/50 split; round noun "Artwork". | `15-edge-minimum.html` |
| Long answers in VOTE/RESULTS | Four-line clamp with ellipsis; three per page. Full text in the report. | `05-vote.html` |
| 60 distinct wavelength terms | Ranked weighted flow, top N above the floor, count stated on screen. | `08-results-wavelength.html` |
| 900-word Field Notes | Headline clamped to 4 lines, three prompts clamped to 3, rest in the report. | `09-field-notes.html` |
| Under-filled stage | `margin-block:auto` centres short content; it never stretches to fill. | `15-edge-minimum.html` |
| WebSocket drops | A 2px amber underline appears beneath the rail and the join code is replaced by `Reconnecting…`. No modal, no room-facing alarm. The Console carries the detail. | — |
| Reload mid-session | Profile restored from `localStorage`; the stage returns exactly as it was. | — |

### 6.14 Transitions → `16-phase-wipe.html`

Every phase change gets a **1200ms band**: a full-width `rgba(11,18,32,.93)` strip with 2px amber edges, carrying the phase in one sentence ("Voting is open — check your phone"), over a dimmed stage. Simultaneously the **phase bar changes hue**, the rail chip changes word and colour, and the dock's label changes.

Four simultaneous signals for one event is not redundancy — this is the one thing a room genuinely needs stated more than once, because a phase change is an *instruction* ("look at your phone now") and a room that misses it stalls.

**1200ms, not 700.** 700ms is fine for a room already looking at the screen; it is short for a room that is heads-down on phones, which is precisely the room this exists for. Whether the band should instead persist until the first response arrives is a live question the mockups cannot settle — it risks sitting there for a slow room — so the fixed duration ships first and the adaptive version is a follow-up. Respect `prefers-reduced-motion` by holding the band statically rather than sweeping it.

---

## 7. What it must never do

The failure modes this design is built against. Each should become a test.

1. **The advance control must never be unreachable.** It is a grid row in a fixed-height grid; it cannot be scrolled past, clipped by an ancestor's `overflow: hidden`, or covered by a panel — *including the Console*, which is the design's own component and did exactly that in revision 1. The existing invariant test (exactly one primary per game type × phase) stays. Audit check **A6** adds the geometry: the primary's box must be inside the viewport with ≥8px clearance, and it must be the topmost element at its own centre point, which is what catches an overlay sitting on top of it.
2. **The room must never see operator chrome.** No email address, no "Sign Out", no category counts, no unasked questions with their correct answers, no AI prompt text, no `JSON.stringify(answers)`, no "Big Screen OFF". Everything in that list is on the stage today.
3. **A phase change must never be imperceptible.** Never signal a transition with a changed word alone, and never with colour alone.
4. **Never state the same fact twice in one viewport.** One QR, one event title, one progress count, one score list, one round number. If a second instance is needed, the first one is in the wrong place.
5. **Never take the stage with a modal the room did not need.** No "All Players Have Answered!" takeover for something the dock already says; no "Invite copied" broadcast to twelve people; no dialog box as the way a session ends.
6. **Never lose the presentation state on reload.** Delete `useEffect(() => setBigScreenMode(false), [])`. Persist density.
7. **Never render room-facing text below the profile's floor** — 20px Room and Call, 26px TV, 16px Table, each derived from the same ~8.3 arcminute target (§4.2). If it does not fit at the floor, reduce the content, not the type. Audit check **A4**.
8. **Never scroll, and never clip silently.** No horizontal scroll anywhere, no vertical scroll on the stage — and no element may lose content to `overflow: hidden` without a **rendering** truncation (a line clamp, or an ellipsis on a block container that can actually show one). Clipping is the failure mode this design is most prone to and the one the first sweep could not see; audit checks **A2** and **A7** exist for it and for nothing else. A centred, clipping flex column is banned outright: it decapitates the top of the content, which is the most important part.
9. **Never show an empty state that lies.** "Waiting for players to join…" after a session has ended is the current behaviour and it is worse than a blank screen.
10. **Never make the host lose information they could previously see without a way back.** Every reduction in §6 has a named recovery: names → Console roster; answers 4–12 → report; full Field Notes → Console and report; long prompt → Expand beat. A reduction with no recovery is a deletion, and deletions belong in §2, argued.
11. **Never require the phone remote.** It is an accelerant, never a dependency. Every action must remain reachable from the stage plus the Console.
12. **Never gate the operator surface behind a keystroke alone.** The Console needs a visible, clickable, permanently present entry point. `\` is an accelerator; on several keyboard layouts it is behind ⌥⇧ or AltGr, and nobody hovers a projector.
13. **Never let a reduction fire while space is unused.** Truncation is something the fitter *does* after exhausting every lever, never something the base stylesheet applies in advance. Audit checks **A10** and **A11**.
14. **Never abbreviate room-facing content.** Type steps down, the layout changes, chrome is sacrificed, the meter's column is taken — and only then, if a state still cannot fit, does anything get cut, and the audit reports it as a budget failure to fix rather than a graceful landing.
15. **Never name a person on the stage.** Not who has not answered, not who is late. A count is a nudge; a list of names is an attendance record, and the room is the wrong audience for one. Names exist only on the private remote.
16. **Never print internal vocabulary on the stage.** No feature names, no model nicknames, no panel names.
17. **Never move the room's shared focus without the host asking.** No content that rotates, advances or reflows on a timer during a phase where the room is reading or choosing.
18. **Never assert a physical claim for a display type you did not derive it for.** The arcminute model in §4.1 is derived for a projected image; a 65-inch panel is ~30 ppi and needs its own ladder. If a fifth display type appears, derive it or state the supported viewing distance — do not reuse a number.

---

## 8. Implementation notes

**Order.** (1) Ship the stage grid and the three regions with the existing content, replacing both current layouts at once — do not add a third mode. (2) Add the four profile ladders and the `fit()` pass; these are load-bearing and everything after them depends on the reduction working. (3) Move operator chrome into the Console. (4) Add the ENDED state and the Field Notes beat. (5) Delete the flash alerts, the vote carousel, the duplicate headers and the duplicate QR.

**`fit()` is about forty lines and belongs in a hook**, not in `GameHostPage`. It runs on mount, on resize, and whenever the question or the answer list changes. It must be idempotent — it resets rung and drop state before measuring — because it will be called on every render in practice.

**What survives untouched.** `config/hostControls.js` and `config/hostRemote.js` are the two best-reasoned files in this area and their decision logic needs no change beyond the two additions in §5.3. `components/HostActionBar.jsx` keeps its keyboard handling, its typing-target guard and its disabled-hint behaviour; only its positioning CSS changes. `config/instructions.js` and `config/gameTypes.js` are unchanged. The Warm Summit tokens are unchanged.

**Independent risks found while specifying, not caused by this redesign.** Both are recorded so they are scheduled on their own merits rather than smuggled into a UI change:

- **R1 — positional answer ordering is stable only by accident** (§5.6.5a). Ballot and tally indices agree because the answer sort key ends in the author's name. Any re-keying, or an answer arriving mid-round, lands votes on the wrong answers, silently. Fix with a stable `answerId`. **Not a prerequisite for anonymous responses**, which is a redaction over the existing positional ballot.
- **R2 — `reopen-round` does not exist** (§5.3). A host who advances early cannot recover; the shipped mitigation is a confirmation, not an undo.

**What must be deleted, not adapted.** The `bigScreenMode` reset effect (`:189–192`). The `isWaitingState` treatment of `ENDED` (`:59–67`). The `showConfirmation` end-of-game flow (`:961–975`). The `answer-navigator` (`:3946–3975`). The three non-loading flash alerts (`:4401–4432`). The `.parallax` block in the host container (`:3671–3686`).

**Testing.** `docs/design/host-redesign/audit.js` is written to port into component tests unchanged: the checks are pure functions over a snapshot of a rendered document plus a viewport, and know nothing about how the page got there. Nine assertions:

| | Asserts | Catches |
|---|---|---|
| A1 | the page does not scroll | the original promise |
| **A2** | **no element clips content without a rendering truncation** | decapitated questions, Field Notes overflow, six-option trivia clip, rail cut |
| A3 | nothing renders outside the stage | escaped content |
| A4 | no room-facing text below the profile floor | type creep |
| **A5** | **the four profiles render measurably differently, each above its own floor** | a display profile that silently does nothing |
| **A6** | **the primary action is on screen, clear of the edge, and topmost at its centre** | an overlay covering the advance control |
| A7 | a declared truncation actually renders | inert `text-overflow` on a flex container |
| A8 | A1/A2/A3/A6 again under +5.5% tracking | width claims measured against the wrong font |
| A9 | contrast after the black-lift model | dark-on-dark |

A2, A5 and A6 are the ones that matter: they are the three failure modes the first sweep was structurally incapable of detecting, and between them they account for six of the nine blocking issues found by review. **Any new check added here must be demonstrated failing against a known-bad input before it is trusted** — `docs/design/host-redesign/_baseline/` holds the pre-critique mockups for exactly that, and `audit.html` has a button for it.

**Measured, both ways.** 16 pages × 4 profiles × 2 viewports = 128 checks, plus the A8 stress pass:

| | pre-critique `_baseline/` | revised |
|---|---|---|
| **Total failures** | **1567** | **0** |
| A2 silent clipping | 152 | 0 |
| A4 sub-floor text | 683 | 0 |
| A5 profiles identical | 4 | 0 |
| A6 primary unreachable / no Console entry | 128 | 0 |
| A7 ellipsis that cannot render | 128 | 0 |
| A9 contrast after black-lift | 192 | 0 |
| A8/* under wide-face stress | 280 | 0 |

The A5 probe is the single most useful line of output, because it is the one that shows a pillar of the design doing nothing at all. On the baseline, all four profiles measured `q 60.5px · meta 20.5px · hair 1px · photo field` — byte-identical. On the revision:

| profile | chrome tier | label tier | hairline | field | floor |
|---|---|---|---|---|---|
| Room | 33.6 px | 20.5 px | 1 px | photo | 20 px |
| TV | 43.5 px | 26.0 px | 1 px | photo | 26 px |
| Call | 33.6 px | 20.5 px | **2 px** | **flat** | 20 px |
| Table | 23.6 px | **16.2 px** | 1 px | photo | 16 px |

A5 measures *chrome*, not content: content sizes are post-fit, and the fitter can legitimately step one profile down a rung and leave another where it is, compressing a real 35% ladder difference into 10% and making a working parameter look broken. The rail chip and the dock button read the profile tokens directly and are never re-scaled, so they are the honest answer to "did the profile change anything".

**Two findings the audit produced that review did not.** A9 with the spec's own black-lift model showed `--muted` at 4.03:1 and `--success` at 4.25:1 for small text — both under AA — which is why §4.3 now carries two text-only tints. And A2 showed the TV ladder cannot be honoured below ~820px of viewport height on the trivia states even after every reduction, which is why §4.4 declares a documented fallback there instead of clipping to protect a number.

---

## 9. Rejected approaches, recorded

**Presentation-first with the phone remote as the primary control (§3.2).** Lost because the brief requires a host with no second device to be fully capable, and because two known backend defects — host-connection eviction in `websocket/connect.js` and the unconditional write in `next-question.js` — make a mandatory second controller unsafe today. Its *outcome* is adopted: a host who has a phone gets exactly this.

**Keep two modes and polish both (§3.3).** Lost on three counts: it does not address the default surface, which is what the owner is unhappy with; it doubles twelve states into twenty-four and the current code already shows that drift (two ASK headers, two QR blocks); and the mode does not survive a page reload, so it fails silently in front of a room.

**Auto-shrink the type to fit whatever content arrives.** Considered and rejected. A fit-to-box algorithm is the obvious answer to "make it fit," and it is wrong here, because it makes legibility a function of content length — a long question becomes an unreadable question. The floor rule inverts that: type size is fixed by the room, and *content* adapts.

**Let RESULTS scroll, since reading is allowed to scroll.** This is what `5363a6db` concluded and it was reasonable, but it does not survive the projector case. Scrolling to read is fine when one person is reading; when thirty people are reading, a scroll is a *performance* that the host must drive at the pace of the slowest reader, and they cannot see who has finished. The Field Notes beat replaces it: same content, paced by an explicit advance, at a size the back row can read.

**Move the roster to the bottom as a ticker/marquee.** Attractive — it is what broadcast does — but a moving element beside a question actively costs comprehension, and the information (who has answered) is better served by a static count. Rejected.

**One type ladder scaled by a multiplier (revision 1's `--k`).** Rejected in revision 2 — see §4.2 and §10.2. Not merely because it was implemented wrongly, but because a single scalar cannot honour four different angular floors; the bug and the design error pointed the same way.

**A packed (Wordle-style) word cloud for wavelength results.** Rejected in favour of a ranked weighted flow — see §6.10. A packed cloud needs measured bounding boxes and collision testing to be legible, and even implemented properly it cannot guarantee the type floor or that the focal term is unobscured. At 25 feet a frequency-ordered flow is the better read regardless, and it can state its own reduction honestly.

**Six answer cards per page during VOTE.** Rejected in revision 2 — see §6.7. Six two-line cards truncated all six; three four-line cards show whole answers. More pages is a cheap price when the pager is automatic.

---

## 10. Revision 2 — what the critique changed

`docs/design/host-redesign/CRITIQUE.md` reviewed revision 1 and returned "approve with required changes". The strategy (§1–3, Approach C) was endorsed and is unchanged. Everything below is a change to the artifact.

### 10.1 The meta-point, which is the important one

**The verification could not detect how the design failed.** Revision 1's sweep asserted three things — the page does not scroll, no rect falls outside the viewport, no text is under 20px — and all sixteen mockups passed. But `.content` was a `justify-content: center` flex column with `overflow: hidden`, and a centred column that overflows loses content from *both* ends with no scrollbar and no out-of-bounds rect. Every assertion stayed true while the room lost the top of the question. Sixteen green pages meant only that the sample copy had been chosen to fit.

Two things follow, and both are now structural rather than good intentions:

1. **The mockups carry worst-case content.** Longest plausible prompt, six long options, forty players, sixty wavelength terms, a 900-word Workie response. If a state cannot hold its worst case, the mockup shows the reduction firing. That is the deliverable.
2. **The audit asserts the failure mode, not the happy path** (§8). A2 catches silent clipping, A5 catches a profile that does nothing, A6 catches an overlay covering the primary. Each was demonstrated failing against `_baseline/` — the pre-critique files — before being trusted.

### 10.2 Blocking issues: what changed

| | Issue | Resolution |
|---|---|---|
| B1 | "Never scroll" implemented as silent bidirectional clipping; no content budget | **Fixed.** `flex-start` + `margin-block:auto` so overflow can only be at the bottom (§4.2b). Measure-then-step fitter with named rungs and ordered sacrifice, implemented in CSS and a 40-line script, not prose. Per-state budgets and sacrifice orders in §6. |
| B2 | `--k` was a no-op; fixing it broke the floor; fixing the floor erased the parameter | **Fixed, and the abstraction replaced.** Four literal ladders on the root element with four angular-derived floors (§4.2). Measured on the baseline: all four profiles were rendering identical 60.5px/20.5px type. |
| B3 | Console covered the primary, killed the keyboard, invisible in 15/16 states | **Fixed** (§5.4): drawer stops at `--dock-h`; the shortcut stays live; a permanent `⋯` control in the dock; close button and focus trap; email address deleted; Skip de-reddened. Clicker case **partly argued** — see §10.3. |
| B4 | Rail clipped mid-word; `text-overflow` inert on a flex container | **Fixed** (§5.1): single block text node, declared shrink order, and audit A7 to stop it regressing. |
| B5 | Field Notes overflowed at 1920 from a `ch`-on-a-container unit error | **Fixed** (§6.11): measure moved onto the text at its own size; two-column at ≥1600; headline and prompts clamped. |
| B6 | Wavelength results not designed — 12 hand-placed spans claiming 34 terms | **Fixed** (§6.10): ranked weighted flow, N stated on screen, single accent. |
| B7 | Both RESULTS states omitted the question | **Fixed** (§6.8, §6.9): one-line recap restored, `--text`, ellipsis. |
| B8 | All six VOTE answers truncated | **Fixed** (§6.7): three full-width cards, four-line clamp, leader fill capped at 90%. |
| B9 | Phase legibility rested on a 20px chip; ladder a rung short for big TVs | **Fixed** (§5.1, §4.4): full-width phase bar, four disambiguated phases, and a TV profile derived at ~30 ppi. |

Non-blocking items 1–12 are all adopted except #7, which is resolved in the opposite direction from the spec's original claim: Skip is now visible at every profile and only the `SPACE` hint is Table-only (§4.4).

### 10.3 Where this document argues back

Three points where the critique's diagnosis is accepted but its remedy is not, and one where a number is disputed.

**The 20px floor does not apply to the Table profile.** The critique treated §4.4 (three densities) and §7.7 (a hard 20px floor) as "mutually exclusive as written — one of them has to give," and suggested a separate Table ladder with a 16px floor. That is what is adopted, but the framing matters for anyone who inherits this: the two rules were never in conflict, because **the floor is angular and 20px was only ever its projection at 20 ppi and 25 feet.** 16px on a ~120 ppi laptop at three feet subtends 9.0 arcminutes against the Room floor's 8.3 — the Table floor is *more* generous, not a relaxation. §7.7 is restated in those terms rather than weakened.

**The Call profile deliberately does not shrink.** The critique's table implies each context should differ by size. Call keeps Room's ladder exactly, because on a screen-share the binding constraint is the encoder, not the eye: the surface is downscaled and re-encoded, so a 20px glyph arrives at ~13px made of artefacts. Shrinking for Call would compound the loss. Call differs in treatment — 2px hairlines, flat field, tighter measure — and A5 asserts that difference so "Call = Room" cannot decay into "Call does not exist."

**The presentation clicker should not reach the Console.** Accepted that a clicker host needs more than one verb: `Left`/`PageUp` now steps back a beat (§5.4). Not accepted that the Console should be clicker-reachable. A host twenty feet from the laptop cannot read a 15px drawer, so a clicker-summoned Console is a panel they can open and not use — while the room looks at it. The clicker is an addition to the laptop, never a substitute: the machine is in the room and skip, re-pick and categories are two seconds away on it. Advance and step-back are the complete set of things anyone can usefully do from across a room.

**One number is disputed.** The critique reports `--muted` on `--bg` as 7.24:1 nominal and ~5.1:1 lifted, against this document's 6.1:1 / 3.7:1. The critique's measurement is correct and this document's original figure was pessimistic. The *conclusion* is unchanged and stays: `--muted` remains a labelling colour, because that is a hierarchy decision, not an accessibility one — a room should not be asked to read a sentence in the same grey as the labels around it. §6.3 and §6.9 accordingly move detail copy to `--text` at 82% opacity, which is the intended effect without the ambiguity.

### 10.4 Still not assessable

Unchanged from the critique's own list, and worth carrying forward rather than quietly dropping:

- **The real fonts.** The mockups fall back to system faces; production self-hosts Archivo Expanded, which is materially wider. Audit A8 approximates the penalty with +5.5% tracking and the direction of error is right, but it is a simulation. Re-measure the 26ch/22ch measures, the option clamps and the button widths once the real face is loaded.
- **The real projector.** Nobody has stood 25 feet from a lit room and read `03-ask-trivia.html`. That single test is worth more than either this document or the critique.
- **Video-call rendering.** "2px and flat" is sound reasoning and an untested hypothesis until somebody shares `13-density-call.html` over a real connection.
- **Motion and timing.** The 1200ms wipe, the 10s VOTE rotation, the completion pulse and the step-back transition are all unassessable in static HTML. The rotation interval in particular needs a room.
- **Whether hosts find the Console.** The `⋯` control is a considered answer, not a validated one. Put a host in front of `01-lobby.html` with no instructions and ask them to change the question set.

---

## 11. Revision 3 — what first-look user testing changed

Three people who run meetings for a living — a VP of Product, a Chief of Staff who runs 200-person hybrid all-hands, and a strategy-consultancy partner — were shown the sixteen mockups and nothing else. **Two of the three would not have put revision 2 in front of their team; the consultant would not have used it with a paying client.** `docs/design/host-redesign/USER-REVIEWS.md` has the full transcripts.

### 11.1 The fitter bug, and why the audit did not see it

The primary objection was unanimous, independent, and correct: content was truncated while space sat empty beside it. The VP found the disqualifying evidence unprompted — `07-results-trivia` renders the same six options **in full, at larger type**, than `03-ask-trivia` truncated them.

**Root cause: `-webkit-line-clamp` was declared in the base stylesheet rather than applied by the fitter.** Content therefore arrived already cut. `scrollHeight` matched `clientHeight`, `over()` returned false, and the fitter concluded the box fit and stopped — blind to the five options that had lost their tails. Measured on `03-ask-trivia` at 1920×1080: 800px box, 669px consumed, 131px unused, five of six options clamped.

With the base clamps removed, the *existing* fitter needed no cleverness at all: two columns at the same 0.86 scale need 791px in an 800px box and truncate nothing. The 131px was precisely the third line each option had been denied.

The audit could not fail on this because every check it had was satisfied: the page did not scroll, nothing escaped the stage, no text was under the floor, and the clamps were "intentional truncations" that A2 was written to wave through. The class of bug it could not see is *a reduction that fires when it did not need to* — so that is now a check of its own.

### 11.2 The new invariants

| | Asserts | Would have caught |
|---|---|---|
| **A10** | a reduction may only fire when space is exhausted | the 131px, and the 320px on `02`, and the 290px on `09` |
| **A11** | room-facing content is never abbreviated | every ellipsis the evaluators quoted back |
| **A12** | progress is stated once per viewport | the six simultaneous statements on `03` |

A10's tolerance is *the smallest step the fitter could have put back* — one line of the largest text, or the height of the smallest dropped group — because a discrete lever cannot be held to a continuous tolerance. Run against the pre-review files in `_prev/`, the three checks produce, among others:

```
03-ask-trivia | A10 | reduction fired (clamped, 6 element(s) truncated) while
                      131px of 800px was unused — budget was not exhausted (epsilon 63px)
03-ask-trivia | A11 | span.txt is abbreviated — "A 5% increase to list price, held …"
                      (42px of text below the clamp)
06-results    | A11 | p.recap is abbreviated — "Our largest competitor cut list pr…"
                      (2533px cut horizontally)
03-ask-trivia | A12 | progress is stated 2 times in one viewport (1 dot matrix, 1 bar)
```

Two further bugs surfaced while fixing the first, both worth recording because both are traps:

- **Sub-pixel line-height poisons naïve truncation tests.** A block at 33.264px type and 34.9272px line-height reports `scrollHeight` 176 against `clientHeight` 175. Testing every element for `scrollHeight > clientHeight` therefore made the predicate permanently true, drove the scale search to its floor, and left 548px of a 795px box empty — the same defect inverted. Only elements that *declare* a truncation can abbreviate anything; ask only those, with a tolerance of half a line. The audit's A10/A11 use the identical rule.
- **The meter clipped itself** by the same mechanism, because a display face at `line-height: .95` does not fit its own line box and the meter is `overflow: hidden`.

### 11.3 Rulings on the four judgement calls

**Timer — yes, with conditions (§5.1).** Revision 1 removed the progress ring arguing it "implied time pressure that does not exist". That was right about the wrong thing: the fault was a *fake instrument*, answer progress drawn as a clock, not the existence of a clock. A real host-armed countdown is a different object. Off by default; never advances the round; lives in the rail.

**Reverse — split, half shipped, half specified (§5.3).** Stepping back through the display (What we heard → Results) is safe and now has a visible `‹ Results` ghost plus `Left`/`PageUp`. Reopening a closed phase is not a display step — `get-results.js` has already scored and broadcast the round, and no endpoint undoes that — so it is specified as backend work (`POST /games/{id}/reopen-round`) rather than drawn as a button that would lie. What ships today instead is prevention: the stage adopts `hostRemote.js`'s arm-then-fire, which asks once when advancing would discard in-flight input and never otherwise.

**Hit target — accepted (§5.4).** 48×48 minimum with the word `SETUP` beside the glyph. Still `--muted` at the label tier, so it stays invisible from the back row and obvious from a foot away.

**Vocabulary leak — accepted (§6.11).** "Names in the Console" is gone; so is "Workie's read on the room", which becomes "What we heard". Internal feature names and model nicknames do not go on a projected surface. This is now §7.16.

### 11.4 Where this document reverses itself

**Nobody is named on the stage.** Revision 2 put `waiting on Dana, Tomás, Jordan and 6 more` in the dock *because the previous critique asked for it*. A Chief of Staff in healthcare read it as a public attendance record and would remove it before running the tool once. She is right and the critique was wrong: the same string is a facilitation nudge and an HR artefact, and which one it is depends on the room, not the intent. The stage shows a count; names live only on the remote (§5.5). Now §7.15.

**The dot matrix is deleted.** The earlier critique called it "the single best reduction in the spec" and it was a good idea — but it was also the third simultaneous statement of a fact that needed one. Being the best of three redundant things is not a defence.

**Auto-rotation on VOTE is off by default (§6.7).** It was chosen to remove an operator task and removed the operator's control of the room instead, during the one phase where holding attention on a specific item is the whole job. Responses now carry stable numbers across the whole ballot so a facilitator can say "look at six and eleven" and have that resolve.

### 11.5 What was left alone

`16-phase-wipe` was unanimously the strongest screen in the set and the only element all three said beats their current tool. It is unchanged.

### 11.6 Still open

- **`POST /games/{id}/reopen-round`** does not exist. Until it does, a host who advances early cannot recover, and the mitigation is the confirmation rather than an undo.
- **Nothing has been on a real projector**, in a real room, at twenty-five feet — still the single highest-value test available and still not done.
- **The remote is a still frame.** So was the Console last round, and a reviewer's inability to test it was itself a finding.
- **Whether hosts find `⋯ SETUP`** is now a smaller question than it was, but it is still unvalidated.

### 11.7 Round 4 — the two undrawn surfaces

The owner asked whether the redesign covered category selection, question browsing and how-to-play. Categories were already drawn and intact. The other two were **entry points with no destination**: `11-console.html` drew `Browse questions` and `How to play` as buttons, §5 assigned both to the Console, and neither surface existed. Both are now drawn, and drawing them forced two decisions the architecture had deferred.

**The question browser (§5.4.1) exposed a real contradiction between two of this document's own rulings**, and the resolution generalises both rather than trading one off against the other. §2.6 cut the browser from the stage because it shows the correct answers of unasked questions; §11.4 then declared the Console deliberately non-private. A panel a room can watch cannot show the answer to the next question.

The way out is a fact this design had established but never used: **there is no display profile in which the stage is unobserved.** Room, TV and Call are shared by definition; Table is a laptop being read by several people. So a reveal control on the stage is a trap rather than a feature, masking is theatre, and blanking the stage behind the panel fixes the wrong half of the problem. The correct answers are therefore **absent** from the stage browser and present on the remote — the same move §11.4 made for names, and now stated once as a rule that covers both: *anything whose value depends on the room not seeing it does not exist on the stage.* The Console remains honestly non-private because it continues to hold nothing worth hiding, which is a stronger position than a private-looking panel.

**How to play (§6.2b) turned out to be filed in the wrong place, not merely undrawn.** §2.1 cut it from the stage on the correct observation that it is addressed to players — and then put it in a panel only the host reads, where the audience it is written for will never see it. It goes back on the stage as a deliberate lobby beat, rewritten from ~180 words to about forty, with the four per-type "Tips" bullets cut outright. The Console keeps no document at all: its entry is an action that puts the beat on the stage, plus a four-line **Keys** card, which is the operator content that was actually missing.

`17-remote.html` gains a second screen — the browser with answers marked — which is what makes the split above real rather than asserted.

Audit: both new pages are in `FILES`; 18 pages × 4 profiles × 2 viewports = **144 checks, 0 failures**, including A10/A11/A12.

### 11.8 Round 5 — anonymous responses

A new feature rather than a fix, and it turned out to be the first real test of the rule §5.4.1 landed on. Full design in §5.6.

**The rule needed a second clause, and the feature found it.** *Anything whose value depends on the room not seeing it lives on the remote* handles names and correct answers. It does not handle authorship during an anonymous round, because the remote is not a safe home for that either — the host is the strongest bias vector in the room, and `role` is a client-supplied parameter (`get-answers.js:11`) so "host only" is unenforceable regardless. The rule now reads: *…and anything whose value depends on nobody seeing it exists on neither — the server does not send it.*

**The facilitation objection dissolves on inspection.** Three reviewers fought for the host to know who has not contributed, and §5.3 was rewritten twice over it. But *who has not acted* and *who wrote which answer* are different facts, and only the second creates vote bias. The first is untouched by anonymity and stays on the remote. So an anonymous round costs a facilitator nothing and needs no second device — which is what makes the strict ruling affordable.

**A claim I got wrong, corrected.** I first reported that `playerId: answer.PlayerName` meant voting identifies an answer by its author's name, making anonymity a key change rather than a redaction, and called it the largest change in the feature. That was wrong and it inflated the estimate. The ballot is already positional — `submit-vote.js:63` stores `{"0": 1, "1": 2}` by index and `get-results.js:275-293` tallies against those same indices — so no vote record contains a name and `playerId` is only a label in a payload. **Anonymity is a redaction of three fields.** The lesson is the one this document keeps relearning: I read the response shape and inferred the storage, when the storage is what decides.

**The real hazard next door, recorded separately as R1 (§5.6.5a).** Answer order comes from the `QUESTION#nnn#ANSWER#` sort-key prefix, and that key ends in the player's name (`message.js:355`) — so ballot indices and tally indices agree *because the key contains the author*. Any re-keying, or any answer arriving between ballot-issue and tally, shifts every later index and lands votes on the wrong answers, silently. A stable `answerId` is worth introducing for that reason and only that reason. It is explicitly **not** a prerequisite for anonymity, and the two must not be bundled.

**One more overstatement fixed.** §5.6.7 said the AI summary "could" attribute. It does, unconditionally, in a hardcoded template: `get-ai-summary.js:1175-1176` names the top contributor and quotes their answer verbatim. Ordering the beat after the reveal handles the common path; the template still needs an unattributed fallback for the host who never reveals.

**Two leaks the drawings would have shipped.** A live standings meter during an anonymous RESULTS is attribution by arithmetic — a score jumping 180 identifies the 180-point answer — so pre-reveal RESULTS carries no meter at all. And "What we heard" summarises the answers, so it is ordered *after* the reveal, and its prompt must be built from redacted rows for the host who never reveals.

**Restraint on `16-phase-wipe`.** The reveal annotates in place rather than taking the screen. The wipe means "look at your phone now" — an instruction — and spending that vocabulary on an annotation would blunt the one element every reviewer said beats their current tool.

**Audit.** Two new surfaces are not stages: a phone and a setup form are never projected, so the angular floors, the fitter invariants and the single-progress-statement rule are meaningless for them. Rather than drop them from the suite — which is how a surface stops being verified — `STAGELESS` runs horizontal-scroll and contrast against them and skips the stage physics. Adding them immediately caught three real defects: `Response N` at 18.9px under the 20px floor, the remote's Skip button at 4.29:1, and my own first attempt asserting "must not scroll" against a document that is supposed to.

21 pages × 4 profiles × 2 viewports = **168 checks, 0 failures**, including A10/A11/A12.

### 11.9 Round 6 — the fitter inverted its own rule, and anonymity was per-file

All three first-look evaluators flipped to yes and the critic upheld all five rebuttals. What follows is what was still wrong.

**The fitter sacrificed content before chrome — the exact inverse of §4.2b, which I wrote.** `widen()` ran after the drop loop instead of before it, so `21-results-revealed` at 1280×720 discarded the second-place answer while keeping a 233px standings column and leaving 117px empty. Fixed by making the meter a priority −1 entry in the ordered sacrifice rather than a special case appended to the end. Measured before/after at 1280×720 `d-room`:

| | cards kept | meter | unused | content dropped |
|---|---|---|---|---|
| before | 2 | kept (233px) | 117px | 2nd place |
| after | **3** | taken | **1px** | **none** |

`05-vote` and `06` show the same improvement: all three answers survive at both viewports, with the meter and then the pager and then the guarantee going first.

**A10 was circular, and the circularity was mine.** I implemented "reduction only when space is exhausted" with an epsilon that included the dropped group's own height — so dropping a card always excused a card-sized gap and the check could never fail on over-reduction. It passed the screen above. A10 now asks the only question that is not circular: **would a cheaper reduction have fit?** It reverts the most expensive active reduction and tests whether scaling alone still lands clean. Three sub-checks: **A10a** over-reduction by experiment, **A10b** the scale search under-shooting, **A10c** a state sitting >25% empty with no reduction active and no `data-grow` — which never ran before, so Table could under-fill invisibly. A10c immediately found five such states.

**A5 could not see a profile decaying into another**, because it measured chrome, which the fitter cannot touch. It now measures a content element too and asserts an ordering rather than a difference. That caught the density finding: TV was rendering VOTE answers at 26.8px against Room's 30.2px — the big-screen profile *smaller* than the projector one. Two fixes: a per-profile `--fit-min` (TV .78, so it must sacrifice rather than shrink below Room), and Call's measure raised from 24ch to 26ch, since a tighter measure wraps more, which made the fitter scale Call ~6% below Room and silently defeated §4.2's stated intent that Call keeps Room's ladder. Measured after: Room 59.2px, TV 63.6px, Call 59.2px, Table 43.2px.

**Anonymity had been applied to the files in front of me rather than derived across the set.** `16-phase-wipe` — the transition *into* voting, the exact moment the guarantee takes force, and the screen every evaluator called the best in the set — showed the ballot with author names. `12-density-table` marked non-responders by name on a stage profile while the Console next door promised names are never on the stage; that one also exposed a contradiction inside this document, between §4.4's "Table shows names" and §7.15's "never name a person on the stage", resolved in §7.15's favour. New audit check **A13** asserts that no roster name appears in a stage document unless it declares `data-attribution="revealed"`, so the rule is now enforced across the set instead of remembered per file.

**The room was never told.** The guarantee appeared only after people had already answered, was never stated at the size §5.1 requires, never mentioned that the *host* cannot see either — which is the whole substance of §5.6.2 — and used two different phrasings on consecutive screens. It is now one sentence, at `--t-body`, on the lobby, the how-it-works beat, VOTE and pre-reveal RESULTS: *"Nobody sees who wrote what — the host included — until voting closes."*

**Truncation residue.** The podium ellipsed "Aleksandra Wiśniewska" with 40% of the screen empty; the rail's drop order sacrificed the session code before the event title, inverting §5.1; the title shrank to a 14% stub instead of dropping, because `min-width: 0` meant the rail never overflowed and `fitChrome()` never fired; and the dock status ellipsed room-facing copy to "Results are o…". The dock status and hint are now in the audit's `CONTENT_SEL`, so A11 fails if they ever truncate, which forces the copy to stay short rather than relying on anyone remembering.

