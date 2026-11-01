# Audit E: the host outside a live session, and how much each session type differs

*1 Nov 2026. A read-only audit against `HEAD` = `b287bb92a` (`working/parity-plan`). No
application code was changed. Keyed to the `engage-design` skill, `docs/design/AUDIT.md`,
`docs/design/host-standards/README.md`, `docs/design/admin-container-rule.md` and the
2026-10-08 consistency review (`docs/design/ux-consistency-review-2026-10-08/review.md`).*

**The owner's brief (1 Nov):** *"capabilities that change buttons or styles from view to view,
or session type, that move around. This will be too difficult for users... we have 99% of the
functionality, just not organized for a simple and visually appealing experience."*

**Method.** Everything here comes from reading the source, with `file:line` given for each
claim. I did not open a browser, so nothing was measured on screen. The counts come from
scripts that read the stylesheets as text (comments stripped first). They are written out in
§4 so the numbers can be produced again. Where a claim depends on how code paths combine
rather than on one line, it is marked **(inference)**.

---

## 0. Summary in five lines

1. **A host has two homes, and each object has two doors.** The start screen (`/`) and the console
   (`/admin`) each have their own list of sessions, question sets, reports and events, built
   from different components in different visual styles (§1.1, §1.9).
2. **"New" has four doors that lead to four different kinds of result.** Create engagement, Quick
   start, Build Room and New event all sit on the start screen. Inside Create engagement, two of
   the seven formats hand off to a *second* form somewhere else. After Create, a round type
   lands in the Sessions list, a Survey goes straight live, a Build Room lands on its room page,
   and an Event lands on its agenda (§1.2).
3. **Most of the session-type differences are accidental.** Of the 41 per-type differences
   listed in §2, 14 are essential to the format and 27 are accidental. The accidental ones are
   mostly where things sit and what they are called: where SESSION lives, what the way out is
   called, which button family is used, and whether labels are Title Case or sentence case.
4. **The visual language is fragmented, not wrong.** The tokens and the 12/13/15/19/24/30 ladder
   hold in about 58 scoped sheets. Around them are **34 scoped "primary button" classes** (plus
   the global `.btn-primary`, redeclared in 9 sheets), **40 modal shell class pairs**, and
   **~125 button class families**. Button corner radii run from 6 to 16px and heights from 30
   to 56px. A shared component library (`components/ui/`) exists, but only `/present` uses it.
5. **The paper/dusk split is now small and mostly deliberate.** Reports are paper by design. What
   is left: console Settings, the AI builders (raw paper `.modal-content`), help, issue reporting, `/builder`, and
   the 603 hex literals still inside `styles.css`.

---

## 1. Journey maps: the host outside a session

Notation: **→** navigates or opens. **[page]** is a full page (a route or an early return).
**(modal: shell)** names the overlay class pair.

### 1.1 Sign-in → the start screen

| Step | What the host sees | Evidence |
|---|---|---|
| `/` signed in | `RootGate` renders `GameHostPage`, which early-returns `WelcomeScreen` while `showWelcomeScreen` is true | `App.jsx:240-255`, `GameHostPage.jsx:6729-6763` |
| Header strip | Brand mark + "Engagements" + env chip (links to **`/home`, the marketing page**), org switcher, bell, name, "Administrator" badge, **"Admin console"** (admins) or **"Question sets & team"** (everyone else) → `/admin` in place, Sign out, `?` | `WelcomeScreen.jsx:106-168` |
| Left column, "New session / Start an engagement" | Three stacked card-buttons. **Create engagement** (the one amber button), **Quick start**, **Build Room** (a real link to `/build`). Under them, **"Events / Run an event"**: a list with its own **New event** button | `WelcomeScreen.jsx:211-237`, `WelcomeEvents.jsx:85-145` |
| Right column, "Already running / Rejoin a session" | A four-cell code field + Continue (ghost). Then "Your library": **Question sets**, **Sessions**, **Reports** (outlined `wel-btn-line`) | `WelcomeScreen.jsx:242-340` |

Findings:

- **S1. Start-screen sections are labelled inconsistently.** "Your library" contains *Sessions*,
  which are not library items. Events (an *object list*) sit in the "New session" column,
  while Sessions (also an object list) are behind a button in the other column. Events are
  listed inline, up to `SHOWN` of them, but sessions, sets and reports are not.
  (`WelcomeEvents.jsx:110-130` vs `WelcomeScreen.jsx:304-338`)
- **S2. The console link changes its name by role.** The same link reads "Admin console" or
  "Question sets & team" (`WelcomeScreen.jsx:146`). From the console, the way back is "Host ↗"
  and opens a **new tab** (`AdminShell.jsx:233`), while the way in opens **in place**. This is
  deliberate (the comments at `:126-145` explain it), but a host meets two names and two
  behaviours for one round trip.
- **S3. The brand mark leaves the app.** On the start screen and in the console it links to
  `/home`, the marketing page (`WelcomeScreen.jsx:106`, `AdminShell.jsx:165`). The product name
  also changes. It is "Engagements" on the start screen, the console top line and auth
  (`WelcomeScreen.jsx:108`, `ConsoleTop.jsx:26`, `AuthChrome.jsx:126`). It is "Engage" in the
  console brand and on the report (`AdminShell.jsx:56`, `GameReport.jsx:653`).
- **S4.** `.wel-badge` is still `font-size: 11px` (`WelcomeScreen.css:156`). This is
  AUDIT.md citation 8, still open.

### 1.2 Starting something new: four doors, four landings

```
Start screen
 ├─ Create engagement ──► [GameSetupDialog]  (Modal: .gsd)               GameHostPage.jsx:6978
 │     formats: C&A · Trivia · Poll · Wavelength · Survey · Build Room · Event
 │     primary label changes per format:                                 GameSetupDialog.jsx:837-846
 │        "Create engagement" | "Open the survey" | "Set up the Build Room" | "Continue to the event"
 │     ├─ round types ─► Create ─► [Sessions list modal] "Created … press Start"   GameHostPage.jsx:5971-5979
 │     ├─ Survey ──────► Create ─► opened AND live at once (no Start)             GameHostPage.jsx:5971-5972, GameSetupDialog.jsx:832
 │     ├─ Build Room ──► navigate /build?title= ─► [BuildCreate] a 2nd form ─► [room page]   GameHostPage.jsx:1125-1129, BuildRoomPage.jsx:257-330
 │     └─ Event ───────► [EventDetailsDialog] (Modal: .evts) ─► [/host/event/N/agenda]       GameHostPage.jsx:1130-1131, :6968-6976
 ├─ Quick start ───────► [QuickstartMenu] raw div overlay, styles.css ─► straight into a live room   GameHostPage.jsx:6695-6716, QuickstartMenu.jsx:353
 ├─ Build Room (link) ─► [BuildCreate] (same 2nd form as above)          WelcomeScreen.jsx:227
 └─ New event ─────────► [EventDetailsDialog] ─► agenda                   WelcomeEvents.jsx:136-144
```

- **N1. Four landings after "create".** A round type lands in a *list* and needs Start. A
  Survey is live at once. Quick start is live at once. A Build Room opens its room. An Event
  opens its agenda. The Survey difference is essential (it has no lobby, `gameTypes.js:69-79`).
  Landing a round type in the Sessions list rather than in its own lobby is a choice that comes
  from the owner's "edit before it starts" request (`GameHostPage.jsx:6883-6896`). It is
  defensible, but Quick start does the opposite, so the two doors disagree.
- **N2. Build Room and Event each have a second form, styled differently.** Round 4 shows them
  as formats (`GameSetupDialog.jsx:103-113, 240-243`). Choosing Build Room then does a full page
  load to `BuildCreate`, which uses a different card (`brm-card`), header (`brm-dh`), X (an
  `<a href="/">`, so a page load), button family (`brm-btn`) and help placement
  (`BuildRoomPage.jsx:292-300`). Its four fields (goal, who decides, visibility, review) would
  fit the dialog's "Optional" section. *Accidental.*
- **N3. Quick start is a different shell.** It is a bare `div.quickstart-overlay` with
  `onClick={onClose}` (`QuickstartMenu.jsx:339, 353`), styled from 74 `quickstart-*` rules in
  `styles.css` (from `:5305`). It does not use `Modal`, `.gsd` or `.qsets`. AUDIT.md marks it
  E: FAIL.
- **N4. Build Room has three doors**: the start-screen link, the format in the dialog, and the
  marketing page. Event has three: New event, the format in the dialog, and the console's Events
  section.

### 1.3 Sessions ("Your sessions")

| Step | Evidence |
|---|---|
| Start screen → **Sessions** → `handleViewGameHistory` → early return of a `Modal` (`new-game-overlay` / `new-game-dialog reports-modal`) wrapping `SessionHistoryPanel` (`.shist`, BEM `__`) | `WelcomeScreen.jsx:320`, `GameHostPage.jsx:5647-5650, 6877-6960`, `SessionHistoryPanel.jsx:218` |
| Row actions: Open/Continue, Start, Edit (→ `GameSetupDialog mode="edit"`, an early return that replaces the list), Invite (`InviteDialog`, mounted twice on purpose), Report, Results (surveys) | `GameHostPage.jsx:6854-6874, 6930-6957` |
| The same component in **"Session reports" mode** (`mode='reports'`), reached from a report's "All session reports" | `SessionHistoryPanel.jsx:231`, `GameHostPage.jsx:6154-6161`, `GameReport.jsx:290-293` |
| The console's own list: `SessionsPanel` (`.sp`, `sp-btn`), a different component | `AdminPage.jsx:2222`, `SessionsPanel.jsx:383` |

- **L1. Two session lists, two idioms.** `.shist` (BEM, 8px buttons with padding 7/10) and
  `.sp` (6px, 30px high). Both are tables, both dusk, built separately.
- **L2. The close X is a text glyph "✕"** (`SessionHistoryPanel.jsx:243-248`). The shelf next to
  it uses "×" (`HostQuestionSetsDialog.jsx:1095`). Build Room uses `<Icon name="X">`
  (`BuildRoomPage.jsx:300`). The product has 34 "×" text closes, 4 "✕" and 48 Icon X (§4.6).
- **L3. State naming leaks.** The session list's state is `showReportsModal` and its class is
  `reports-modal` (`GameHostPage.jsx:926, 6914`), left over from when it was "history".
  Harmless to users, but it shows that "reports" means three different things in this file
  (§1.6).

### 1.4 Events and the agenda

| Step | Evidence |
|---|---|
| Start screen "Run an event" → **Open** → `/host/event/N` (the **stage**, not the agenda) | `WelcomeEvents.jsx:121-127` |
| `/host/event/N/agenda` → `HostEventAgenda` (`.hea`, dusk): header with **"← Main screen"** (navigates to `/host`), kicker "Event N · agenda", `?`, **Save event summary (PDF)**, **Open the stage** (`hea-btn--primary`). Body = the console's `EventBuilder` | `App.jsx:445-458`, `HostEventAgenda.jsx:70-104` |
| `/host/event/N` → `EventStage` (`.ag-stage-root`, dusk) built on the shared `Stage`/`Dock`; ENDED offers "Back to the agenda"; a load failure offers "Back to the console" (`/admin`) | `EventStage.jsx:584, 637-639, 906-907` |
| Event summary: `EventSummary` paper document + `downloadEventSummary` | `EventSummary.jsx:45`, `HostEventAgenda.jsx:43-52` |

- **E1. One builder, two frames.** This is good: `EventBuilder` is reused (`HostEventAgenda.jsx:19-27`).
  But the frame's way out is "Main screen", which no other surface uses (§2, row "Exit").
- **E2. Open goes to the stage, not the agenda**, while its aria-label says "its agenda and
  stage" (`WelcomeEvents.jsx:126`). A host who wants to edit the agenda goes stage → agenda.
- **E3. The help `?` is in the middle of the header** (before Save summary, after the title,
  `HostEventAgenda.jsx:80`). Everywhere else outside a session it is last on the right
  (`WelcomeScreen.jsx:160`, `BuildRoomPage.jsx:2417`).

### 1.5 Question sets: library, editor, AI generation, drafts

| Step | Container | Evidence |
|---|---|---|
| Start screen → **Question sets** → `HostQuestionSetsDialog` | `Modal` `qsets-scrim--over`, `theme="dark"` | `HostQuestionSetsDialog.jsx:514-525` |
| → Edit set → `QuestionSetEditor` **inside** the shelf modal | `Modal` `qsets-scrim` / `qsets-editor-frame`, no theme prop (inherits) | `:1140-1148` |
| → editor → add/edit question → `QuestionsPanel`'s own `Modal`s (a third layer) | `Modal` ×4 in `QuestionsPanel.jsx` | `HostQuestionSetsDialog.jsx:1117-1124` (comment) |
| → AI builder (Trivia/Poll/Survey/Scenario) **inside** the shelf | raw `div.modal-overlay` + `.modal-content` (paper, `styles.css`) | `:1036-1072`, `TriviaAIBuilder.jsx:467-474`, `PollAIBuilder.jsx:458-460`, `SurveyAIBuilder.jsx:370-371`, `AIScenarioBuilder.jsx:1159-1161` |
| → Review AI draft **inside** the shelf | `Modal` `qsets-modal--wide` with an "×" glyph close | `:1079-1110` |
| Console → Question sets (`QuestionSetsPanel`, the standard) / Drafts | console place | `config/consoleSections.js:123-130`, `AdminPage.jsx:1940` |
| Other set pickers: `SetChooser` in New engagement, Quick start's own list, `EventBuilder`'s picker | — | `GameSetupDialog.jsx`, `QuickstartMenu.jsx:355-420`, `HostEventAgenda.jsx:55-68` |

- **Q1. Modals are opened from inside a modal, up to three deep.** The skill says *never* do this
  (§3; `admin-container-rule.md:68-69`). The shelf's comments explain the stacking-context
  workaround (`:1038-1048, 1112-1135`). The workaround is careful, but the rule is still broken.
  Editing one question from the start screen gives start screen → shelf → editor → question
  dialog.
- **Q2. The four AI builders are four different products.** Their headings are Title Case
  ("AI Trivia Builder", "Configure Your Trivia Questions", `TriviaAIBuilder.jsx:471, 480`;
  `PollAIBuilder.jsx:462, 471`; `AIScenarioBuilder.jsx:1163`). They paint paper (`.modal-content`)
  inside a dusk shelf, and none goes through `Modal`. AUDIT.md marks them C: FAIL and E: FAIL.
- **Q3. A host meets at least five set browsers**: the shelf, the console list, `SetChooser`,
  Quick start and the agenda's picker. Only the first two share the `.qsets` idiom
  **(inference: from the class names; SetChooser carries its own `SetChooser.css`)**.

### 1.6 Reports: three meanings of one word

| What the host clicks | What opens | Theme | Evidence |
|---|---|---|---|
| Start screen **Reports** | `HostReportsDialog` "Your reports", saved PDFs (`ReportsPanel`, `.rp`) | dusk | `WelcomeScreen.jsx:333`, `HostReportsDialog.jsx:14-28` |
| Session row **Report** | `GameReport` (full page, paper) | paper | `GameHostPage.jsx:6773-6788`, `GameReport.jsx:281` |
| On a report: **All session reports** | the *Sessions* list re-titled **"Session reports"** (not "Your reports") | dusk | `GameReport.jsx:290-293`, `GameHostPage.jsx:6154-6161`, `SessionHistoryPanel.jsx:231` |
| Survey row **Results** | `SurveyResultsPanel` (cut sheet) / `SurveyWalkthrough` | **dusk** (`svrp-page`) | `SurveyResultsPanel.jsx:62`, `GameHostPage.jsx:6812-6852` |
| Build Room report | `BuildReport` | paper | `buildroom/BuildReport.jsx:4` |
| Event summary | `EventSummary` + PDF download | paper | `EventSummary.jsx:45` |
| Console → Reports | `ReportsPanel` in the console | dusk | `config/consoleSections.js:144-150` |

- **R1. "All session reports" and "Reports" are different lists with almost the same name.**
  One lists live sessions that *can* produce a report. The other lists saved PDFs that outlive
  sessions. A host who expects to find last month's report from inside a report will not
  find it there.
- **R2. Results are paper for four types and dusk for Survey.** The paper choice is deliberate
  ("a document", `GameReport.jsx:278-281`). The survey cut sheet is a results *screen*, not a
  document. That is defensible, but nothing on screen explains it **(judgement)**.

### 1.7 Account, team, billing

- There is no account page on the host side. The start screen's only account controls are
  the org switcher, the name, Sign out, and the console link labelled "Question sets & team"
  (`WelcomeScreen.jsx:119-150`).
- In the console, a host's space shows **Overview, Question sets, Sessions, Events, Reports,
  Public library, Prompts** under "Your space", and **Plan & usage, Data & privacy** under
  "Account" (`config/consoleSections.js:445-458`). A team adds **Members**, **Activity**.
- Password change exists only inside `AuthPage` (`auth/AuthPage.jsx:8`). Neither home links to it
  **(inference: no other import of `PasswordChangeForm`)**.
- **A1.** The console's Overview (`OverviewPanel.jsx:15-31`: "Needs you", then four tiles) and
  the start screen are both "home" for a host. They share no layout, no component and no
  vocabulary. The console says "Sessions" and the start screen says "Sessions", but the
  console top line says "All sessions" for a link that goes to the *start screen*
  (`config/consoleWords.js:33-34`), not to a sessions list.

### 1.8 Help (`?`)

- One component, `HelpButton`, has 34 mounts. 24 of them use `help-button-quiet` to cancel the
  base paint, which is a Tailwind blue `#3b82f6` / `#2563eb` / `#374151` (`HelpButton.css:4, 18,
  90, 95`). The rest re-skin it per surface (`wel-helpbtn`, `dock-help`, `hc-help`, `brm-help`,
  `plr-helpbtn`).
- `HelpSystem` is a `Modal` with `theme="dark"` (`HelpSystem.jsx:360-365`). AUDIT.md still rows
  Help as B/C/G FAIL, because `HelpSystem.css` has not been re-tokenised.
- **Position of `?`:** last on the right of the top strip on the start screen, Build Room and the
  console top line. In the **dock at the bottom** on the one-screen Stage and the event stage
  (`Dock.jsx:183`, `EventStage.jsx:867`). Mid-header on the agenda (E3).

### 1.9 The two-homes table

| Object | Start screen door | Console door | Same component? |
|---|---|---|---|
| Question sets | `HostQuestionSetsDialog` (modal over the start screen) | `QuestionSetsPanel` (a place) | Rows: partly (`.qsets`). Shell: no |
| Sessions | `SessionHistoryPanel` (`.shist`) in a `new-game-overlay` modal | `SessionsPanel` (`.sp`) | **No** |
| Reports | `HostReportsDialog` → `ReportsPanel` | `ReportsPanel` | **Yes** (a good precedent) |
| Events | `WelcomeEvents` inline list + `HostEventAgenda` frame | console Events place → `EventBuilder` | Builder yes, list no |
| Team / plan | the link text only | Members, Plan & usage | n/a |

---

## 2. Session-type variance

The host's UI for each type, compared with Call & Answer. **E** = essential to the format.
**A** = accidental: it could be identical without losing anything. "One screen" means the
`Stage`. "Two screens" means the `HostConsole`.

### 2.1 Where each type lives

| | C&A | Trivia | Poll | Wavelength | Survey | Build Room | Event |
|---|---|---|---|---|---|---|---|
| Created from | New engagement | New engagement | New engagement | New engagement | New engagement | New engagement → **`/build` form**, or the start-screen link | New engagement → **EventDetailsDialog**, or New event |
| After create | Sessions list, then Start | same | same | same | **live at once** | room page | agenda page |
| Host page | `GameHostPage` | `GameHostPage` | `GameHostPage` | `GameHostPage` | `GameHostPage` | **`BuildRoomPage`** (own route, 4,879 lines) | **`EventStage`** + `HostEventAgenda` |
| Two-screen console | yes (`TWO_SURFACE_TYPES`, `surfaces.js:26`) | no | no | no | no | own console (`BuildConsole`) | no |
| Default layout before the host chooses | **dev: console. test/prod: Stage** (`surfaces.js:54-59`, `GameHostPage.jsx:490-494`) | Stage | Stage | Stage | Stage | per room | Stage |
| Report | `GameReport` paper | same | same | same + vocabulary | `SurveyResultsPanel` **dusk** | `BuildReport` paper | `EventSummary` paper |

Note **(inference)**: `useConsole` lists `trivia`, `poll` and `wavelength`
(`GameHostPage.jsx:1271`), but `twoSurfacesFor` returns false for any type not in
`TWO_SURFACE_TYPES` (`surfaces.js:54-55`). So those three entries cannot be reached today. They
are not wrong, just ahead of the list.

### 2.2 The difference table

| # | Element | C&A | Others | E/A | Why |
|---|---|---|---|---|---|
| 1 | Phases | ASK→VOTE→RESULTS | Trivia/Poll/Wavelength ASK→RESULTS; Survey COLLECTING→CLOSED; Build asks; Event items | **E** | `gameTypes.js:19, 31, 46, 61, 79` |
| 2 | Answer input | free text | A–D; poll kinds; words; a form; ideas/choose/rate | **E** | the format |
| 3 | Live result | answers then votes | correct answer + scoreboard; `PollBoard` live; word convergence; tallies; Claude status | **E** | `GameHostPage.jsx:8772-8773, 8957-8990` |
| 4 | No lobby / no Start (Survey) | Start | Survey opens on create | **E** | `GameSetupDialog.jsx:832` |
| 5 | Private correct answer (Trivia) | — | the host must see it and the room must not | **E** | host-standards §Trivia |
| 6 | Group-size caveat (Wavelength) | — | "Best with ten or fewer" | **E** | `gameTypes.js:65` |
| 7 | Build Room setup fields (goal, who decides, visibility, review) | — | Build only | **E** (the fields) / **A** (that they sit in a second form) | `BuildRoomPage.jsx:257-330` |
| 8 | Event: agenda, money, per-event charge | — | Event only | **E** | `WelcomeEvents.jsx:93-97` |
| 9 | Build Room: Claude status always visible, MCP key | — | Build only | **E** | host-standards §6 |
| 10 | Event: item doors, breaks, talks | — | Event only | **E** | `EventStage.jsx` |
| 11 | Survey close is irreversible, so it confirms in a dialog | press twice | dialog | **E** | host-standards §3 allows it |
| 12 | Late answers kept vs refused | kept | Survey refused; Build answers refused | **E** for Survey, open question for Build | host-standards table |
| 13 | Room's-window moments | built | Trivia/Poll not built | **E** for now (work not done, not a design choice) | host-standards §1 |
| 14 | Stage skin for Wavelength ENDED vocabulary | — | Wavelength | **E** | `GameHostPage.jsx:9374` |
| 15 | **Create primary label** | "Create engagement" | "Open the survey", "Set up the Build Room", "Continue to the event" | **A**, partly: "Open the survey" is honest because it goes live. The other two are hand-offs | `GameSetupDialog.jsx:110-113, 837-846` |
| 16 | **Second setup form** | none | Build `/build` form; Event `EventDetailsDialog` | **A** | §1.2 N2 |
| 17 | **Page shell** | `GameHostPage` Stage/Console | Build `.brm` page; Event `.ag-stage-root`/`.hea` | **A** for the chrome; E for the content | |
| 18 | **Where SESSION (settings) lives** | console: "Settings" link in the left rail's tools; Stage: **SESSION** bottom-right in the dock | Build: **SESSION** top-right in the header | **A** | `ConsoleRail.jsx:129-131`, `Dock.jsx:257-263`, `BuildRoomPage.jsx:2427-2433` |
| 19 | **Where `?` lives** | console top; Stage dock bottom | Build header top; Event agenda mid-header; Event stage dock | **A** | §1.8 |
| 20 | **Way out (label)** | console "← All sessions" (goes to the start screen); dock "Back to menu" | Survey "Back to Menu"; Build "Main menu" (House icon); Event agenda "← Main screen"; Event stage "Back to the agenda"; Event load error "Back to the console"; Remote "Back to Menu" | **A**: **7 labels** for "leave this screen" | `consoleWords.js:33`, `roundWords.js:65`, `hostControls.js:624, 1052`, `buildroom/words.js:214`, `HostEventAgenda.jsx:73`, `EventStage.jsx:584, 639`, `HostRemote.jsx:2039` |
| 21 | **Way out (position)** | console top-left (only when `onLeave` is passed); Stage: the dock's secondary at LOBBY/ENDED, or inside the Session panel | Build: always first in the header; agenda: first in the header | **A** | `ConsoleTop.jsx:20-24`, `SessionSetupPanel.jsx:1279`, `BuildRoomPage.jsx:2344-2346` |
| 22 | **Label casing** | sentence case via `roundWords` ("Show results", "Start voting", "Back to menu") | Survey via `primaryFor` in Title Case ("Show Results", "Start Voting", "Next Page", "Open Session Report", "Back to Menu") | **A** | `roundWords.js:30-31, 37, 64-65` vs `hostControls.js:512, 520, 624, 633, 659, 909` |
| 23 | **Primary button family** | console `hc-btn`/footer; Stage `.btn` (stage.css) | Build `brm-btn--primary` (56 uses); Event agenda `hea-btn--primary`; Event dialog `evts-btn--primary` | **A** | §4.1 |
| 24 | **Brand in top line** | console "Engagements"; Stage none | Build none ("Main menu" instead) | **A** | `ConsoleTop.jsx:26` |
| 25 | **Two-screen chooser words** | "Room's window ↗" | Build: same `RoomWindowStatus` part with `brm-*` classes | **A**, mostly solved (shared part) | `BuildRoomPage.jsx:2387-2397` |
| 26 | **Join code control** | console `hc-code` "Join 1234" | Build: Join in `HeaderTools`; Stage: rail | **A** | |
| 27 | **Strip / one main button** | `roundStep` + strip | Survey: no strip, inline words; Build: `buildControls` → shared bar on Stage only | **A** (Survey could show Open › Collecting › Closed) | host-standards table |
| 28 | **Confirm style** | press twice in place | Trivia/Poll Skip etc. use dialogs; Build `window.confirm` (`BuildRoomPage.jsx` ×2, `BuildCrew.jsx` ×3) | **A** | §4.8 |
| 29 | **Dialog head** | `Modal` + per-scope header | Build: its own `DialogHead` ×2 + hand-made heads; 20 `brm-scrim` modals | **A** | review F14 |
| 30 | **Notice/status slot** | console footer status | Build: up to seven stacked bars | **A** | review F6 |
| 31 | **Format icon colour** | `--secondary` | Trivia `--primary` (amber). Used only in Quick start | **A** (amber is the action colour) | `gameTypes.js:17, 30`, `QuickstartMenu.jsx:469` |
| 32 | **Report theme** | paper | Survey dusk | **A** (judgement) | §1.6 R2 |
| 33 | **Report doors** | Sessions row Report | Survey row Results; Build `?view=report`; Event agenda "Save event summary (PDF)" | **A** for the names; E that the contents differ | |
| 34 | **Stage `data-theme`** | console declares dusk | one-screen `Stage` (C&A/Trivia/Poll/Wavelength/Survey) still declares none | **A** | `HostConsole.jsx:81`; `Stage.jsx:98` has no attribute; host-standards §9 |
| 35 | **Session-panel naming** | "SESSION" | Build "SESSION"; console "Settings" | **A** | row 18 |
| 36 | **Build Room tabs** (Host/Stage/Build/History) vs C&A strip | strip of steps | screen tabs | **E** in part (Build has extra screens); **A** in that it is a second navigation model | `BuildRoomPage.jsx:2351-2369` |
| 37 | **Quick start offers** | C&A/Trivia/Poll/… | no Build Room, no Event | **E** (they need setup) | `surfaces.js:19` comment |
| 38 | **Remote support** | yes | Build refused by HostRemote | **E** for now | `surfaces.js:17-19` |
| 39 | **Setup "Where will the room watch?"** | in lobby + Settings › Screens | Build asks at its own point | **A** (same question, two places) | host-standards §1 |
| 40 | **Event's agenda frame header** | — | kicker + h1 + 3 buttons | **A** vs the console's breadcrumb pattern | `HostEventAgenda.jsx:70-93` |
| 41 | **Survey's confirm for close / results "Walk through"** | — | survey-only control words inline | **E** (the controls) / **A** (the words are not in a words module) | host-standards table |

**Count: 14 essential (rows 1–14), 27 accidental or mostly accidental (rows 15–41).**
Rows 7, 13, 33, 36 and 41 are split. They are counted once, by the part a user would notice.

### 2.3 Reading the table

The format differences (1–14) are content: what is asked, how it is answered, and what is
shown. The accidental differences (15–41) are almost all chrome: where things are, what they
are called, and what they look like. The host-standards "one app, different use cases" rule
(`host-standards/README.md:38-42`) already says the chrome should be shared and only the panels
and words should differ. The table shows how far that rule is from what ships.

---

## 3. Inconsistencies, grouped

### 3.1 Placement (things that move)

| Thing | Where it lives, by view | Evidence |
|---|---|---|
| Settings / SESSION | rail link (console) · dock bottom-right (Stage) · header top-right (Build) | §2 row 18 |
| Help `?` | top-right (start screen, console, Build, sessions list, shelf, Quick start) · dock (Stage, event stage) · mid-header (agenda) | §1.8 |
| Way out | top-left (console when wired, Build, agenda) · dock secondary (Stage) · inside Settings (Stage, Remote) | §2 row 21 |
| Main action | one fixed bar (console footer, Stage dock) · inside the open step (Build, review F1/F25) · dialog foot (New engagement) · card-button at the top (start screen) | review F1, F25 |
| Close X | Icon X · "×" · "✕"; X as a link that reloads (`BuildCreate`) | §4.6 |

### 3.2 Vocabulary

| Concept | Words in use | Evidence |
|---|---|---|
| Leave | Back to Menu · Back to menu · All sessions · Main menu · Main screen · Back to the agenda · Back to the console | §2 row 20 |
| The thing a host runs | engagement (create dialog, start-screen heading) · session (lists, rejoin, console) · game (`Game Type *`, `All Game Types`, "quickstart game") · room (Build) | `WelcomeScreen.jsx:205-213`; rough JSX text count: "session" 67, "engagement" 11, "game" 4+ |
| Reports | Reports · Your reports · Session reports · All session reports · Results · Save event summary (PDF) | §1.6 |
| Console | Admin console · Question sets & team · the console · Host ↗ (the way back) | §1.1 S2 |
| Product | Engagements · Engage | §1.1 S3 |
| Casing | sentence case (`roundWords`, Build) vs Title Case (`hostControls.primaryFor`, AI builders, `quickstart`) | §2 row 22, §1.5 Q2 |

### 3.3 Containers

- **Modals opened from modals:** the host shelf → editor → question dialog, the shelf → AI
  builder, the shelf → draft review (§1.5 Q1). Build Room's Stage "Edit" → Discard confirm
  (review F10).
- **Not through `Modal`:** 14 raw overlay `div`s still in JSX. Four are the AI builders, plus
  Quick start ×3, `GameReport.jsx:363` (save report), `IssueReportForm.jsx:88`,
  `ConfirmDialog.jsx:64` (the *shared* confirm), `AIAssistant.jsx:156`, and
  `GameHostPage.jsx:9692, 9710`.
- **Browser dialogs:** ~25 `alert(` calls (GameHostPage 15, PlayerPage 10) and 32
  `window.confirm(` calls across 26 files, including the console's Overview, Sessions, Users
  and the Build Room.

### 3.4 Theme

| State | Surfaces | Evidence |
|---|---|---|
| Dusk, declared | start screen, sessions list, shelf, reports dialog, New engagement, console (every section **except Settings**), Build Room, event agenda/stage, two-screen console, Session panel, survey results | `data-theme="dark"`/`theme="dark"` in **68** JSX files |
| Paper by default (no `contentTheme`) | console **Settings**, the foot section: `consoleSections.js:351-356` has no `contentTheme`, so `AdminShell.jsx:111` falls back to `'light'` | AUDIT.md citation 13, still open |
| Paper by design | `GameReport`, `BuildReport`, `EventSummary` | `GameReport.jsx:281`, `BuildReport.jsx:4`, `EventSummary.jsx:45` |
| Paper by inheritance (unconverted) | AI builders (`.modal-content`, except Poll's edit pane), `IssueReportForm`, `/builder`, the host `AnswerSpotlight`/`PastRound` (AUDIT cite 29) | `TriviaAIBuilder.jsx:469`; `PollAIBuilder.jsx:773` is the one dusk island |
| No declaration on a dusk-painted root | one-screen `Stage` | `Stage.jsx:98` |

---

## 4. Visual-language census

All counts are over `src/src/**/*.css` (134 stylesheets, comments stripped) and
`src/src/**/*.jsx` excluding `__tests__`. The scripts are inline in §4.9.

### 4.1 Buttons

| Measure | Count |
|---|---:|
| Distinct CSS class names containing `btn`/`button` | **273** |
| …grouped into families (prefix before `btn`/`button`) | **~125** |
| Scoped **primary** modifiers (`*-btn--primary`, `*-btn-primary`, `--go`, `--amber`) | **34** |
| Global `.btn-primary` / `.btn-secondary` / `.btn-danger` / `.btn` selectors | 56 / 49 / 10 / 50 |
| Stylesheets that **declare** `.btn-primary` (global or re-skinned under a scope) | **9**: `styles.css`, `BuilderPage.css`, `IssueReportForm.css`, `FileUploadPrompt.css`, `GameSetupDialog.css`, `GeneratedItemsTable.css`, `GenerationJobPanel.css`, `AIPromptManager.css`, `QuestionSetEditor.css` |
| Adopters of the shared `components/ui/Button` | **1** (`PresentPage.jsx`) + `AskComposer.jsx` using the class directly |

The 34 scoped primaries: `arch, au, bill, bpl-rx (amber, go), brm, corg (go), dcode, drv,
entry, evb, evts, hea, hr, inv, inv__, lvp, mk, modq, obill, ovw, plim, preq, priv, publib,
pubshare, qsets, rshare, shist__, smed, srev, team, um, ust`. Add `.wel-action.is-primary`
and `.gsd .btn-primary` for the two surfaces at the top of the host's day.

**Geometry of the base button, by surface the host meets outside a session:**

| Surface | Class | Radius | Height | Padding | Evidence |
|---|---|---|---|---|---|
| Start screen action | `.wel-action` | 16px | content | 16/18 | `WelcomeScreen.css:34, 267` |
| Start screen button | `.wel-btn` | 10px | min 48 | 12/20 | `WelcomeScreen.css:35` |
| New engagement | `.gsd .btn-primary` | 8px | min 44 | 10/18 | `GameSetupDialog.css:1399-1441` |
| Sessions list | `.shist__btn` | 8px | content | 7/10 | `SessionHistoryPanel.css` |
| Question sets shelf | `.qsets-btn` | 6px | min 30 | 0/12 | `QuestionSetsPanel.css` |
| Reports / console Sessions / Events | `.rp-btn`, `.sp-btn`, `.evts-btn` | 6px | 30 | 0/12 | `ReportsPanel.css`, `SessionsPanel.css`, `EventsPanel.css` |
| Event agenda | `.hea-btn` | 10px | min 40 | 8/14 | `HostEventAgenda.css:74-85` |
| Build Room | `.brm-btn` | 8px | 36 (`--brm-row-h`) | 8/14 | `BuildRoom.css:113-117` |
| Two-screen console | `.hc-btn` | 8px | content | 5/12, 13px | `HostConsole.css` |
| Stage | `.btn` | `--radius×.85` | vh-based | vh/vw | `styles/stage.css` |
| Global | `.btn-primary` | 8px | content | 12/24, 16px | `styles.css` |
| Shared library | `.ui-btn` | `--radius-sm` | 2.15em | .4/.95em | `ui/Button.css:33` |

**Six radii (6, 8, 10, 14, 16px, and a token) and six heights (30, 36, 40, 44, 48, 56px)** on
buttons a host presses within a minute of signing in. *This is the "buttons change from view to
view" the owner describes, in numbers.*

### 4.2 Headings and type

| Measure | Count |
|---|---:|
| `font-size` declarations | 2,685 |
| Distinct values | 461 (271 are `var(...)`; 190 literal) |
| Distinct literal px values | 25: 8, 9, 10, 11, 12, 12.5, 13, 13.5, 14, 15, 16, 17, 18, 19, 20, 21, 22, 24, 26, 28, 30, 36, 38, 40, 48 |
| Distinct rem/em values | 65 |
| Distinct `clamp()` values | 40 |
| Declarations under the 12px floor | **15** |
| Distinct font sizes on heading selectors (`h1`, `h2`, `*-title`, `*__title`) | **99** |
| Scoped type ladders (`--x-t-*`) | **66**: the same 12/13/15/19/24/30 ladder redeclared 58 times; outliers: `head` 17/20/25/30, `title` 20/26/32/44, `body` 16/17px |

The ladder in the skill **holds**: 58 of 66 scopes say floor 12, label 13, body 15, head 19.
The drift sits in `styles.css` (rem/clamp) and in the outliers. *The headline problem is not
the ladder. It is that the ladder is copied 66 times instead of declared once.*

### 4.3 Panels, cards, lists

| Idiom | Distinct classes |
|---|---:|
| `*card` | 45 |
| `*panel` | 24 |
| `*tbl` / `*table` | 37 |
| `*chip` / `*badge` / `*pill` / `*tag` | 94 |
| `*kicker` / `*eyebrow` | 26 (two words for one job: 20 `kicker`, 6 `eyebrow`) |
| `*notice` / `*alert` / `*error` / `*banner` | 60 (vs 23 files using `StatusMessage`) |
| Modal overlay class pairs passed to `Modal` | **40** distinct (top: `brm-scrim` 20, `modal-overlay` 11, `ag-scrim` 6, `qsets-scrim--over` 4, `new-game-overlay` 4) |
| Close-button classes | 30+ (`brm-x` 14, `qs-dialog-close` 9, `close-button` 7, `ag-close` 6, then one per scope) |

`admin-container-rule.md` counted "roughly ten distinct shells" on 13 Aug. All of them now route
through `Modal`, and that is real progress. But the *visual* shell has gone from ten to forty
class pairs, each with its own scrim colour, header and X.

### 4.4 Paper vs dusk

See §3.4. Since AUDIT.md was written, the console has nearly converted: every
`consoleSections.js` entry except the foot **Settings** carries `contentTheme: 'dark'`
(`:120-348`), and the question-set editor is now dusk (`AdminPage.jsx:1940`), which closes
citation 11. What is left on paper by accident is Settings, the authoring overlays and
help/feedback.

### 4.5 Colour outside tokens

| Measure | Count |
|---|---:|
| Hex literals in ordinary rules (not `--token:` declarations) | **900** in 134 sheets |
| …of which `styles.css` | **603** |
| …`BuilderPage.css` | 140 |
| …`auth/auth.css` | 26 |
| …`FileUploadPrompt.css` / `IssueReportForm.css` | 25 / 24 |
| …`JoinCodeEntry.css` | 12 |
| …`styles/stage.css` | 10 |
| …`HelpButton.css` | 7 (Tailwind blues and greys) |
| Hex inside scoped token blocks (allowed by the skill) | 220 |
| Sheets with **zero** colour literals in rules | 71 of 134 |
| Including `rgb[a]()` literals | 1,506 in rules (888 in `styles.css`) |

The themes INVENTORY (13 Oct) measured 1,731 literals in rules. Today it is 1,506
(rgb + hex, same method, broader file set), so the number is going down.

### 4.6 Icons

- **One icon library**, `@phosphor-icons/react` (`src/package.json:16`), imported only by
  `components/Icon.jsx`. `Icon` is imported in **150** files. This is clean.
- **Typographic glyphs used as icons** alongside it: close as "×" (34 sites), "✕" (4), against
  48 `Icon name="X"`. Ticks are "✓" in 12 places (`WorkflowStrip.jsx:20`, `ConsoleRail.jsx:10`,
  `CompletionFlag.jsx:55`, …). Arrows are "←", "↗" in labels (`ConsoleTop.jsx:23`,
  `consoleWords`). Emoji in UI copy: 1 live (`PlayerPage.jsx:3664`, "✅ You're in!"). The
  other 26 matches are comments or prompts.

### 4.7 The shared library that exists and is unused

`components/ui/` holds **Button, Card, Chip, Dialog (CSS), Eyebrow, Ground, Heading, Notice,
NumberBadge, Pips, Row (CSS), TallyRow, TopLine**, built to `docs/design/themes/SPEC.md` §6 with
palette tests across skins (`ui/Button.css:1-31`). Adoption outside `ui/` and its fixtures is
**`PresentPage.jsx` and `present/*` only**. Chip and Notice have no adopters at all. *This is
the most direct way to fix §4.1–4.3, and it is already built.*

### 4.8 Browser dialogs (counted again)

`alert(` ~25 (GameHostPage 15, PlayerPage 10, plus QuickstartMenu 2, AIPromptManager 2,
AIGenerationPromptEditor 2, InviteDialog, GameReport, AdminPage). `window.confirm(` 32 across 26
files. Review F23 (8 Oct) listed the host and player ones. Those are still there.

### 4.9 How these numbers were taken

```bash
# button class families
grep -rhoE '\.[a-zA-Z][a-zA-Z0-9_-]*(btn|button|Btn)[a-zA-Z0-9_-]*' --include=*.css src/src | sort -u
# hex in rules vs token decls (python, comments stripped): a declaration whose property
# starts with "--" counts as a token decl; any other with #[0-9a-f]{3,8} counts as a rule literal
# font-size census: every `font-size:` value, plus selectors matching h1|h2|-title|__title
# overlays: grep -rhoE 'overlayClassName="[^"]*"' --include=*.jsx src/src | sort | uniq -c
```

---

## 5. Ranked top 10

Ranked by how often a host meets the problem, multiplied by how much it costs them. Each fix
direction is one line and is a direction, not a design.

| # | Problem | Evidence | Fix direction |
|---|---|---|---|
| 1 | **Settings, help and the way out sit in a different corner on each host surface** (rail / dock-bottom / header-top; `?` in three positions; leave in four) | §2 rows 18–21, §3.1 | One top line for every host surface: leave (left), title, join, room's window, `?`, SESSION (right). Then retire the dock's SESSION and `?`. |
| 2 | **Seven names for "leave"**, one of which ("All sessions") goes somewhere else | §2 row 20, §1.7 A1 | One word and one icon ("Main menu", House) from one words module, with a CSS/words parity test across `roundWords`, `consoleWords`, `buildroom/words`, `hostControls`, `HostEventAgenda`. |
| 3 | **34 primary-button classes with 6 radii and 6 heights** | §4.1 | Adopt `components/ui/Button` (already built and palette-tested) on the host path first: start screen, New engagement, shelf, sessions, reports, agenda, Build Room. Delete the scoped `--primary` modifiers as each one moves. |
| 4 | **Two homes, each with its own sessions/sets/events list** | §1.9 | Decide which is home for a host. Make the other one link to it, not copy it. `HostReportsDialog` → `ReportsPanel` is the pattern to repeat for Sessions (`.shist` ↔ `.sp`). |
| 5 | **Four "new" doors with four landings, and two formats that hand off to a second form** | §1.2 | Keep one door (New engagement) with Quick start as a fast lane inside it. Fold the Build Room's four fields into the dialog's Optional section, and land every created thing in the same place. |
| 6 | **Modals inside modals, up to three deep, in question-set authoring** | §1.5 Q1 | Make the set editor a *place* on the host side too (the skill's own §6 rule: "a detail with panels and tables is a place"). Builders and draft review become steps in that place, not overlays. |
| 7 | **The AI builders: raw overlays, paper inside dusk, Title Case, four different headings** | §1.5 Q2, §3.3 | Route all four through `Modal` with one header, one footer and one dusk scope (`PollAIBuilder.jsx:773`'s `.pab` dusk pane is the seed). Sentence case. |
| 8 | **"Reports" means three lists**; "All session reports" is not "Your reports" | §1.6 R1 | Rename the report's link and the list mode ("Your sessions" in reports mode, or send the link to Your reports). One noun for saved PDFs everywhere. |
| 9 | **Survey's host labels are Title Case through a separate function** while every round type is sentence case | §2 row 22 | Move `primaryFor`'s labels into `roundWords` (or a `surveyWords` module) and run them through the same parity test. Then Survey gets the strip (Open › Collecting › Closed). |
| 10 | **Forty modal shells, three close glyphs, and an X that reloads the page** | §4.3, §4.6, §1.2 N2 | One dialog head/foot (`ui/Dialog.css` exists) with `Icon name="X"` only. `BuildCreate`'s X becomes a `requestClose`. Grep tests ban "×"/"✕" as a close label. |

Just below the line: the brand mark linking to marketing and two product names (S3). The
dev-only default for the two-screen console, which means the owner and the test reviewer see
different host pages until the lobby asks (§2.1). `.wel-badge` at 11px (S4). The one-screen
`Stage` with no `data-theme` (§2 row 34). The 25 `alert()` / 32 `window.confirm()` calls (§4.8).

---

## 6. What is already right and should be copied

- **`HostReportsDialog` reuses `ReportsPanel` verbatim.** One list in two frames. This is the
  pattern for fix 4.
- **`HostEventAgenda` mounts `EventBuilder` verbatim** (`HostEventAgenda.jsx:19-27`). The same
  idea for the agenda.
- **`RoomWindowStatus` is one part with per-surface class hooks**, used by the console and the
  Build Room (`ConsoleTop.jsx:33-41`, `BuildRoomPage.jsx:2390-2397`). This is how the
  top line in fix 1 can be shared without forcing one stylesheet.
- **The type ladder** holds in 58 scopes, and **the icon library** is single-sourced. Neither
  needs a redesign, only consolidation.
- **`components/ui/`**, palette-tested across skins and themes. It is waiting for adopters.

## 7. Not covered here

In-session host screens beyond what the type table needs (audits A–D), the participant phone
(audit C), the attention model (audit D), and anything measured in a browser. The widths,
heights and contrast on screen still need a Chromium pass at the host-standards §5 sizes.
