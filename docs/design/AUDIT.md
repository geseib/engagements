# Design audit — reviewing and updating every portion of the site

*Written 2026-08-15. Keyed to the `engage-design` skill
(`.claude/skills/engage-design/SKILL.md`), which is where the rules and their reasons
live. This file is the checklist and the scoreboard.*

The owner's ask was **"a way to review and update all portions of the site"**. This is it:
a checklist you run against one surface, and a table saying where all thirty-two stand today.

---

## How to use this

**Auditing one surface.** Work down §1. Every "fail" gets a `file:line` in §3's table and
a line in §4 if it is a real defect rather than an unconverted surface.

**Converting one surface.** Do it in this order, because two of the steps are only safe
together:

1. Write the stylesheet under a **new scope prefix** nothing else uses (§1.A).
2. Convert the markup **and** flip `contentTheme` in `AdminPage.jsx` **in the same
   change** (§1.C). Either alone renders at 1.2:1 or 1.4:1.
3. Add the `*Palette.test.js` before you believe the colours
   (`references/testing-a-surface.md`).
4. Update this table's row.

**Re-running the whole audit.** The enumeration in §3 came from the file tree
(`src/src/components/*.css`, `src/src/*.jsx`), `ADMIN_SECTIONS` in `AdminPage.jsx:43-95`
and the route switch in `App.jsx:185-264`. Re-derive it the same way rather than trusting
the list; new surfaces will not add themselves.

---

## 1. The checklist

### A — Scope

- [ ] Every selector in the stylesheet is rooted at one scope class.
- [ ] `styles.css` declares **nothing** in that scope. *(Both halves. `.qs` collided
      once already and repainted a whole empty state.)*
- [ ] No bare `.btn`, `.chip`, `.modal`, `.form-group`, `.tag`, `.status-badge`,
      `.empty-state`, `.loading-*` declared from a component stylesheet.
- [ ] No `!important` reaching outside the scope.

### B — Colour from tokens

- [ ] Every colour is `var(--…)` or an `rgba()` of a token's hue.
- [ ] Raw hex appears **only** inside the scope's own token block, and each one has a
      comment saying why `styles.css` cannot supply it.
- [ ] Locally declared tokens are prefixed (`--qsets-…`, `--adm-…`).
- [ ] Every `var(--x)` used is declared somewhere reachable — an undefined custom
      property invalidates the *whole* declaration.
- [ ] `color: var(--danger)` appears nowhere. Destructive **copy** is `--danger-text`;
      a filled destructive button is `--danger-deep`.

### C — Theme

- [ ] The surface root declares `data-theme` explicitly rather than inheriting it.
      `public/index.html` puts `data-theme="light"` on `<html>`.
- [ ] The markup's palette and the container's theme match, and were changed in one
      commit.
- [ ] A component reused across polarities re-points its tokens in one `--onlight`-style
      block, including a selector for **nested** instances of its own scope.
- [ ] A field that deliberately **inherits** (a control dropped into somebody else's
      form, not a screen root) is measured on **every ground it can land on**, not just
      the one it was drawn against. `CountField` was written for the console's dusk work
      field and its palette test measured dusk only; the AI builders that host it are
      mounted outside `AdminShell`, so what it actually inherits is paper, where
      `color: var(--bg)` on the filled preset measured **1.84:1**.
- [ ] Ink on a **theme-invariant** token (`--primary`, `--danger`, `--success`) is itself
      invariant. `var(--bg)` and `var(--text)` swap under it and one of the two ends up
      near-isoluminant with the fill.

### D — Type and density

- [ ] Laptop surfaces use 12 / 13 / 15 / 19 / 24 / 30 px. Nothing below 12px (14px
      allowed for monospace only).
- [ ] Every input renders at **body** (15px), never at label.
- [ ] Rows are 36px. Lists are tables, not card grids.
- [ ] Stage surfaces use the four profile ladders and nothing from the laptop ladder.
- [ ] `font-variant-numeric: tabular-nums` wherever numbers change in place.

### E — Containers

- [ ] Every dialog routes through `components/Modal.jsx`.
- [ ] No modal is opened from inside a modal.
- [ ] No form is appended below the list and scrolled to.
- [ ] A detail with several panels is a **place** (own work area, own title, breadcrumb),
      not a section under its list.
- [ ] `window.confirm` / `window.alert` appear nowhere in a designed flow.

### F — Exits

- [ ] Every dialog has an **X in the header** and an **exit at the bottom**.
- [ ] Both route through one `requestClose()` that confirms when work is unsaved.
- [ ] Escape is *gated* (`closeOnEscape={() => !dirty}`), never merely absent.
- [ ] No exit renders when its handler is missing; any deliberately-dead control carries
      a comment saying why.
- [ ] The scrim scrolls (`align-items: flex-start` + `overflow-y: auto` + `padding`) and
      the card centres with `margin: auto`.

### G — Contrast, measured

- [ ] Every flat pairing clears 4.5:1 against its **composited** background.
- [ ] Every tinted composite clears 4.5:1 — a tint is invisible in a token table.
- [ ] Ratios are in the stylesheet header, computed not eyeballed.
- [ ] No black-lift model on a laptop surface; the stage keeps its own.
- [ ] Non-text parts clear **3:1** (WCAG 1.4.11) where they carry a control's identity or
      its state — a slider's filled rail and thumb, a selected chip's boundary. Ask it of
      those, and **not** of everything: the unfilled remainder of a rail is context, not
      state, and holding it to 3:1 forces a heavier grey than the design wants. Say in
      the test which side of that line each part is on and why.
- [ ] A selected state that rests on a **fill colour alone** is checked against the
      unselected one. On paper `--cnt-on-accent` and `--text` are the same #1B2942, so
      selection rode entirely on an amber fill measuring 1.96:1 until the boundary moved
      to `--primary-deep`.

### H — Tests

- [ ] A `*Palette.test.js` parses this stylesheet as text. **Never named `*Token*`** —
      `.gitignore:35` is an unanchored `*token*`.
- [ ] Namespace, ladder, floor, stray-hex and `--danger` assertions present.
- [ ] Reachability contracts for any scrim or overflow-hidden action cell.
- [ ] **No geometric assertions.** jsdom has no layout engine.
- [ ] The component is mountable in jsdom (pure, props-in/callbacks-out).

---

## 2. Reading the table

`ok` · `FAIL` (with the citation in §3.1) · `part` (some of it holds) · `n/a`
· `—` (not applicable to this kind of surface)

---

## 3. Every significant surface

### Entry and authentication

| Surface | Files | A scope | B tokens | C theme | D type | E container | F exits | G contrast | H tests |
|---|---|---|---|---|---|---|---|---|---|
| Root door `/` | `components/RootPage.{jsx,css}` | ok `.entry-` | part¹ | ok | ok | ok | — | ok² | ok `rootPage.test.jsx` |
| Sign in / register / verify / pending | `auth/*.jsx`, `auth/auth.css` | part³ | part | ok `AuthChrome.jsx:115` | ok | ok | — | part | part `authSurfaces.test.jsx` |

*(Join name collision has moved to **Player**: it renders inside `PlayerPage`'s shell and
is scoped, themed and tested with it. It was listed here as `ok .join-` / theme
"inherited" / contrast `n/a` — all three were wrong, and citation 28 says how.)*

### Player

| Surface | Files | A | B | C | D | E | F | G | H |
|---|---|---|---|---|---|---|---|---|---|
| Player session (join → lobby → ask → vote → results → end) | `PlayerPage.jsx`, `components/PlayerSurface.css` | ok `.plr` | ok | ok `PlayerPage.jsx:69`⁵ | ok — three literal ladders | ok | ok | ok | ok `playerSurfacePalette`, `playerSurface` |
| Join name collision | `components/JoinNameCollision.jsx` | ok `.plr`²⁸ | ok²⁸ | ok — inside `.plr` | ok²⁸ | — | — | ok²⁸ | ok `joinNameCollision`, `playerSurface` |
| Read one response (shared with the host) | `components/AnswerSpotlight.jsx` + `styles.css:11266+` | part²⁹ | part²⁹ | ok on the player (`.plr-spot`); paper for the host and `PastRound` | part²⁹ | ok (Modal) | ok — X, backdrop and Escape | part²⁹ | ok `answerSpotlight`, `playerSurfacePalette` §7b |

### Host

| Surface | Files | A | B | C | D | E | F | G | H |
|---|---|---|---|---|---|---|---|---|---|
| Host front door | `components/WelcomeScreen.{jsx,css}` | ok `.wel-` | ok | ok `:88` | FAIL⁸ | ok | — | ok | ok `welcomeScreen.test.jsx` |
| Host stage (lobby/ask/vote/results/ended) | `components/stage/*`, `styles/stage.css` | ok | ok | ok | ok (profiles) | ok | — | ok (lifted model) | ok `stageShell`, `stageCompletion`, `displayProfile` |
| Host page chrome + overlays | `GameHostPage.jsx` + `styles.css` | FAIL⁴ | FAIL⁴ | part | part | FAIL⁷ | FAIL⁷ | part | part — call-site tests only, cannot mount |
| Create engagement | `components/GameSetupDialog.jsx` + `styles.css:2643` | part | FAIL | part | part | ok (Modal) | **FAIL⁹** | part | ok `gameSetupDialog.test.jsx` |
| Quickstart menu | `components/QuickstartMenu.jsx` + `styles.css` | part | part | ok `:195` | part | FAIL⁷ | part | n/a | ok `quickstartMenu.test.jsx` |
| Host question-set shelf | `components/HostQuestionSetsDialog.jsx` | ok `.qsets--onlight` | ok | ok | ok | ok | ok `:193` + footer | ok | ok `hostQuestionSetsPalette` |
| Host remote (phone) | `HostRemote.{jsx,css}`, `RemoteCategoryList`, `RemoteQuestionBrowser`, `RemoteSessionPanel` | ok `.hr-/.hrc-/.hrq-/.hrs-` | ok | ok `HostRemote.jsx`³⁰ | ok — one phone ladder, **not** a stage profile³¹ | ok | ok³² | part³⁰ — no palette test; every pairing is a measured `styles.css` token | ok `hostRemote`, `hostRemoteScreen`, `hostRemoteBrowser`, `hostRemoteSession` |
| Game report | `components/GameReport.{jsx,css}` | ok `.report-` | part | ok `:208` paper by design | ok | part | part | n/a | part `gameReport.test.jsx` |

### Admin console

| Surface | Files | A | B | C | D | E | F | G | H |
|---|---|---|---|---|---|---|---|---|---|
| Console shell | `components/AdminShell.{jsx,css}` | ok `.adm-` | ok | ok `:116` | ok | ok | — | ok | ok `adminShellPalette`, `adminShell` |
| **Question sets — the standard** | `components/QuestionSetsPanel.{jsx,css}` | ok `.qsets` | ok | ok `AdminPage.jsx:54` | ok | ok | ok | ok | ok `questionSetsPalette`, `rowActionsReachable` |
| Question-set editor | `QuestionSetEditor`, `QuestionsPanel`, `CategoryPicker` + `styles.css:10012+` | part¹⁰ | FAIL¹⁰ | **FAIL¹¹** | part | part¹² | ok (`4fd425d6`) | part | part |
| Sessions | `components/SessionsPanel.{jsx,css}` | ok `.sp` | ok | ok `AdminPage.jsx:62` | ok | ok | ok | ok | ok `adminTabsPalette`, `sessionsPanel` |
| Users | `components/UserManagement.{jsx,css}` | ok `.um` | ok | ok `AdminPage.jsx:84` | ok | ok | ok | ok | ok `adminTabsPalette`, `userManagement` |
| **Prompts — the section** | `AdminPage.jsx` (`.padm`) + `AIPromptManager.css` | ok `.padm` | ok | ok `AdminPage.jsx` `contentTheme:'dark'` | ok | ok (chooser → place) | ok — one `.padm-back` for both | ok | ok `AdminPage`, `promptEditorPalette` |
| **Prompts — library list** | `components/PromptLibraryPanel.jsx` + `AIPromptManager.css` | ok `.plib` | ok (`--pc-*`, now aliases) | ok | ok | ok (table, fixed layout) | — | ok — measured on dusk | ok `promptLibraryPanel`, `promptEditorPalette`, `rowActionsReachable` |
| **Prompts — summary editor** | `AIPromptManager.jsx:146-878` + `.css` | ok `.pmgr` | ok | ok | ok | ok (`Modal`) | ok | ok | ok `promptEditorPalette`, `promptManagerScope`, `promptManagerDialogs` |
| **Prompts — advisor** | `AIPromptManager.jsx:881-1086` | ok `.pmgr` | ok | ok | ok | ok (`Modal`) | ok | ok | ok `promptManagerDialogs` |
| **Prompts — generation library** | `components/AIGenerationPromptEditor.jsx` | ok `.pgen` | ok | ok | ok | ok — a **place**, no longer an overlay | ok — `.padm-back` | ok | ok `aiGenerationPromptEditor` |
| Archive | `components/ArchivePanel.jsx` + `styles.css:3580+` | FAIL⁴ | FAIL⁴ | **FAIL¹³** | FAIL | **FAIL²¹** | FAIL | FAIL | FAIL |
| Settings | `AdminPage.jsx:1153+` + `styles.css:4760` | FAIL⁴ | FAIL⁴ | **FAIL¹³** | FAIL | — | — | FAIL | FAIL |

### Authoring and shared

| Surface | Files | A | B | C | D | E | F | G | H |
|---|---|---|---|---|---|---|---|---|---|
| Builder page `/builder` | `BuilderPage.{jsx,css}` | FAIL²² | FAIL²² | FAIL | FAIL²³ | FAIL⁷ | FAIL | FAIL | FAIL |
| AI builders (Trivia / Poll / Survey / Scenario / Assistant / FormAssist) | `components/*AIBuilder.jsx`, `AIAssistant.jsx`, `AIFormAssist.jsx` | part | part | FAIL | part | **FAIL⁷** | FAIL | part | part `aiScenarioBuilderKind`, `formAssistPanel` |
| Generation job + generated items | `GenerationJobPanel.{jsx,css}`, `GeneratedItemsTable.{jsx,css}` | ok `.gjp-/.git-` | part | inherited | ok | ok | ok | n/a — no palette test | ok `generationJobPanel`, `generatedItemsTable` |
| CSV upload + preflight | `QuestionSetUploadPanel.jsx` (`.qsets`), `FileUploadPrompt.{jsx,css}` | part²⁴ | part | ok / FAIL | ok | ok | ok | ok (qsets half) | ok `questionSetUploadPanel`, `csvPreflight` |
| Help system | `HelpSystem.{jsx,css}`, `HelpButton.{jsx,css}` | part | FAIL | FAIL | ok | FAIL⁷ | part | FAIL | FAIL |
| Issue reporting | `IssueFab.{jsx,css}`, `IssueReportForm.{jsx,css}` | FAIL²⁵ | FAIL | FAIL | ok | FAIL⁷ | part | FAIL | FAIL |
| Category picker | `components/CategoryPicker.{jsx,css}` | ok `.qs-cat-` | n/a²⁶ | paper | ok | ok (inline, never a 2nd modal) | — | measured in header | ok `categoryPicker` |
| Modal primitive | `components/Modal.jsx` | — | — | — | — | ok | ok | — | ok `modal`, `modalReachability` |
| Icon / StatusMessage / statusTone | `components/Icon.jsx`, `StatusMessage.jsx` | ok `.ws-icon` | ok | ok | — | — | — | part²⁷ | ok `designSystem.test.jsx` |

### 3.1 Citations

1. `components/RootPage.css:16-25` declares its own `--entry-*` set as literals rather
   than referencing `styles.css`'s tokens, and `--entry-muted #B6C2D4` diverges from
   `--muted #9BA8BE`. Documented at `:20-22` — deliberate, so a component lifted onto the
   stage needs no fresh audit. Live divergence to be aware of, not a bug.
2. `docs/design/entry-redesign/RATIONALE.md:192-210` carries the measured table.
3. `auth/auth.css` scopes most rules under `.au-`/`.auth-` but also declares bare
   `.form-group` (`:118`), `.status-*`, `.error-*`, `.loading-*` and `.field-*`.
4. `styles.css` is an 11,665-line unscoped monolith: 690 hex literals outside any token
   block, and it owns `.btn-*`, `.modal-*`, `.form-*`, `.card`, `.chip`, `.tag`,
   `.status-*` globally. Every surface still living in it inherits that.
5. **Was**: "`PlayerPage.jsx` never declares `data-theme`; it inherits `light` from
   `public/index.html` while painting its own gradients." **Fixed** by `5678b92b`:
   `PlayerPage.jsx:69` is `<div className="plr" data-theme="dark" …>`, and
   `components/PlayerSurface.css` is the scoped stylesheet that theme is useless
   without. Both directions are asserted in `__tests__/playerSurfacePalette.test.js`.
6. `styles.css:794`, `:927`, `:2801`, `:9879`, `:9996`, `:10939`, `:11015`, `:11051` are
   all `font-size: 11px`.
7. Raw overlay `div`s that bypass `components/Modal.jsx` — no Escape, no focus trap, no
   scroll lock, no `role="dialog"`. `PlayerPage.jsx:2657` was the twenty-second and is
   **gone**: `5678b92b` deleted the game-end dialog outright (a finished session is a
   state, not a modal), and the page's one remaining dialog — `AnswerSpotlight` — has
   always routed through `Modal`. Re-derive this list rather than trusting the count;
   the twenty-one below have not been re-checked since. `QuestionsPanel.jsx:1186`,
   `QuestionsPanel.jsx:1204`, `QuestionSetEditor.jsx:1333`, `HelpSystem.jsx:287`,
   `IssueReportForm.jsx:88`, `AIAssistant.jsx:155`, `AIScenarioBuilder.jsx:927`,
   `PollAIBuilder.jsx:374`, `SurveyAIBuilder.jsx:503`, `TriviaAIBuilder.jsx:369`,
   `AIGenerationPromptEditor.jsx:242`, `AIGenerationPromptEditor.jsx:253`,
   `AIPromptManager.jsx:466`, `AIPromptManager.jsx:927`, `QuickstartMenu.jsx:209`,
   `GameHostPage.jsx:3824`, `GameHostPage.jsx:5177`, `GameHostPage.jsx:5195`,
   `GameHostPage.jsx:5245`, `GameReport.jsx:281`, `GameReport.jsx:341`. **Twenty-one.**
8. `components/WelcomeScreen.css:140-142` — `.wel-badge` at `font-size: 11px`, below the
   12px floor. Same class of defect at `components/RoundKindPicker.css:166`.
9. `components/GameSetupDialog.jsx:150-160` is `closeOnBackdrop={false}` on a long form
   whose only exit is the Cancel at `:424-425`. **No X.** Named in commit `4fd425d6` as
   the weakest remaining case, and unchanged since.
10. `styles.css:10012-10060` (`.qs-editor`, `.qs-panel`, `.qs-empty` + ~16 more) is the
    paper-theme block that collided with the first `.qs`-scoped cut of the question sets
    screen. Still paper, still in the monolith.
11. `AdminPage.jsx:975` — `contentTheme={editingSet ? 'light' : section.contentTheme ||
    'light'}`. The question-sets **list** is dusk and its **editor** is forced to paper,
    so the console changes polarity when you press Edit.
12. `QuestionSetEditor.jsx:1333` — `pendingDelete` is a fourth raw `modal-overlay`,
    inside a component that otherwise uses `Modal`. Reported in `4fd425d6`, not fixed.
13. **Was**: "prompts, archive and settings carry no `contentTheme`, so
    `AdminShell.css:410-413` paints `#f5f7fa` under them — three of six sections on the
    wrong side of the seam." **Prompts is fixed** (§6.2 items 11-15): the section carries
    `contentTheme: 'dark'` and `AIPromptManager.css` converted in the same change, which
    is the only safe order. Archive and Settings are still light; **two** of six now.
14. **Was**: "`components/AIPromptManager.css` declares **global** selectors from a
    component stylesheet — `.btn-primary`, `.btn-secondary`, `.modal-overlay`,
    `.modal-content`, `.large-modal` (with `!important`), `.status-badge`,
    `.empty-state`, `.form-group`, `.form-actions`, `.tag`, `.loading-spinner`. 158 hex
    literals outside any token block." **Fixed** across §6.2 items 1-3 and 11-13. Every
    selector is rooted at one of seven scopes (`.padm`, `.pmgr`, `.pgen`, `.plib`,
    `.pvi`, `.ppf`, `.pap`) and **zero** hex literals survive outside the token block.
    ONE global remains and it is named: `.form-group input/textarea/select`, the only
    rule in the product that gives a form control its border — eighteen paper components
    read it, so it stays and the dusk override for it is scoped. Both halves are pinned
    by `__tests__/promptManagerScope.test.js` and `promptEditorPalette.test.js`.
15. **Was**: "`AIPromptManager.css:952` — an 11px tooltip, and the floor assertion only
    covers the block after `BEFORE YOU SAVE`, so the legacy half is unchecked."
    **Fixed** (§6.2 item 8): the tooltip is 12px and the assertion reads the whole sheet.
    Extended again in items 11-15 to cover the LADDER TOKENS as well — with the sheet
    reading `var(--pc-t-*)`, an 11px step added to the token block would put 11px type on
    screen while every literal `font-size:` still measured 12 or more.
16. **Was**: "`AIPromptManager.jsx:466` and `:927` are hand-rolled overlays. No Escape,
    no focus trap, no scroll lock, no `role="dialog"` — on the tallest form in the
    product." **Fixed** (§6.2 item 4): both route through `components/Modal.jsx`.
17. **Was**: "the editor has an X and a bottom Cancel, but neither routes through a
    shared `requestClose()` and there is no dirty check on either." **Fixed** (§6.2 item
    6): one `requestClose()` behind both, with `closeOnEscape={() => !isDirty}`.
18. **Was**: "`AIPromptManager.css` declares a genuinely measured PAPER palette
    (`--pc-*`) … the 1,325 lines above it are not covered." The palette is dusk now and
    the `--pc-*` names are aliases onto `styles.css`'s own tokens rather than a seventh
    private set (§6.2 item 12). Coverage is the whole sheet: `promptEditorPalette.test.js`
    asserts that no hex survives outside the token block, that every alias resolves to a
    DUSK value, and that every tinted composite still clears AA on both beds.
19. **Was**: "the advisor has an X and **no bottom exit** at all, on a panel that renders
    analysis lists, improvement items, pros/cons and recommendations." **Fixed** (§6.2
    item 5): it carries the same footer exit the editor does, outside the scroll region.
20. **Was**: "`AIGenerationPromptEditor.jsx` still renders `.prompts-grid` /
    `.prompt-card` — the card grid RATIONALE §4 rejected — and is the third UI over the
    one prompt record." **Fixed** (§6.2 item 9): it mounts `PromptLibraryPanel`. Item 16
    followed: it is no longer a full-viewport overlay either, but a place in the work
    area reached by the same chooser and left by the same control as the summary
    library — which is what the owner asked for when they said the two were *"slightly
    different. they should be the same."*
21. `styles.css:3632` — `.archive-grid` is a card grid. RATIONALE §10: *"Cards for the
    archive. Rejected. 214 items."*
22. `BuilderPage.css` — 140 hex literals, bare `.modal`, `.btn`, `.tab`, `.form-group`
    (`:63`), `.section`, `.input`, `.close`, `.nav`. Not designed at all (RATIONALE §1:
    *"Not designed: the `/builder` route"*).
23. `BuilderPage.css:280`, `:1286` — `font-size: 11px`.
24. `components/FileUploadPrompt.css:145,165` redeclares global `.btn-primary` /
    `.btn-secondary`.
25. `components/IssueReportForm.css:172-204` redeclares global `.btn-primary` /
    `.btn-secondary`; `:75` declares bare `.form-group`; `:43` bare `.close-button`.
26. Deliberate: `CategoryPicker.css:24-26` uses literals because the control renders in
    component tests where `styles.css`'s `:root` is not loaded, and every value is lifted
    from the `.qs-*` block it sits inside. Documented exception, not a precedent.
27. `utils/statusTone.js:33-39` returns `var(--success)` for the success icon. On the
    paper `.status-message.success` ground (`#d4edda`) that is 2.10:1 — which is why
    `QuestionSetsPanel.css:672-675` restates `--success: #1C7350` for the host scope. The
    global default is still the unreadable one.
28. `components/JoinNameCollision.css` is **deleted**. It had no scope prefix
    (`.join-name-collision*`), a heading at `clamp(1.3rem, 6vw, 1.9rem)` — a fourth
    ladder on a surface with three — and `color: #444` on its explanatory sentence,
    which is **1.79:1** on `--bg #0F1A2E`. Its own header comment explained why: *"Sits
    inside `.join-screen`, which is centred and white"*, a container `5678b92b` had
    deleted. Nothing replaced the stylesheet: the refusal is now `.plr-h1
    .plr-h1--primary` and `.plr-lede .plr-muted`, and its two ways out moved into
    `.plr-dock` as `.plr-btn` / `.plr-btn--ghost`, which is where every other ACT state
    on this surface already put its actions. It was the only one that did not, and it is
    the one screen where a player is already stuck.
29. `components/AnswerSpotlight.jsx` is the host's dialog, shared with `PastRound` and
    painted from `styles.css:11266+` for the paper theme: `border-top: rgba(0,0,0,.1)`,
    two bare `opacity` values tuned against white, `font-size: clamp(1.15rem, 2.4vw,
    1.75rem)`, and `.btn-secondary` nav buttons that are `background: white; color:
    var(--primary)` — **1.96:1**, plus a hover of white on `--primary` at the same ratio
    and no disabled state at all. On the player it was mounted as a **sibling** of
    `.plr`, so it opened that white card over a dusk ballot. Fixed on the player side
    only: it mounts inside `.plr` through `PlayerShell`'s `after` slot and takes an
    opt-in `surfaceClassName="plr-spot"`, which `PlayerSurface.css` §10 re-tints — the
    `.qsets--onlight` move, in the other polarity. **The host and `PastRound` are
    unchanged and still carry every defect above**; fixing them means fixing
    `styles.css`, which is citation 4's problem.
30. **Was**: theme "ok" and contrast "n/a". Both were wrong, and for one reason.
    `HostRemote.jsx` never declared `data-theme`, so under
    `public/index.html:2`'s `<html data-theme="light">` — and `:root` **is**
    `html`, so `styles.css:58-66` wins on specificity — every token the remote
    reads resolved to the PAPER value. A surface whose own stylesheet header says
    it is held "in a dim room, glancing down between sentences" was rendering a
    cream `#FBF7F1` field with navy text. Two consequences past the glare: `.hr-btn--primary`
    and `.hr-primary` hard-code `color: #1B2942` for their label because that is the
    **dusk** surface colour, and `RemoteQuestionBrowser.css:94,106` reads
    `var(--success-text, var(--success))` — there has never been a global
    `--success-text` (see the skill's §6), so it fell back to `--success` `#4FB286`,
    **2.65:1 on white**, on the CORRECT flag, which is the single fact that surface
    exists to carry. Identical defect and identical one-line fix to citation 5:
    `<div className="hr" data-theme="dark">`, on both the entry card and the
    session view, asserted in `hostRemoteSession.test.jsx`. Contrast is now `part`
    rather than `n/a`: with dusk restored every pairing in use is a token already
    measured in the skill's table, but no `*Palette.test.js` composites them here.
31. The remote deliberately does **not** use `config/displayProfile.js`. Those four
    profiles are the STAGE's, derived for a room reading from 2–30ft; the closest,
    Table, is a laptop at 3ft with a 16px floor. The remote follows the entry/welcome
    pattern instead — one ladder, `clamp()` against the viewport
    (`tokens-and-type.md` §4.3). `hostRemoteSession.test.jsx` fails if a `--L-*`
    ladder or a `.d-*` class ever appears in `RemoteSessionPanel.css`.
32. Exits were `—` when the remote had no dialog. It now has three lists behind one
    panel, and the way back is `.hr-back` in the sticky bar rather than in the dock —
    so the primary action stays in the thumb arc while a list is open, which the old
    full-screen question browser did not manage. Pinned in `hostRemoteSession.test.jsx`
    by document order, not by geometry.

---

## 4. Headline findings

**The console is four-fifths converted and the seam now runs through Archive.** Question
sets, Sessions, Users and **Prompts** are dusk, namespaced, ladder-correct and
contrast-asserted. Archive and Settings are still paper markup on a `#f5f7fa` patch that
`AdminShell` paints specifically so they do not render at 1.4:1. That patch
(`AdminShell.css:402-413`) is marked "DELETE WHEN WAVE D LANDS" and has two sections left
to outlive.

**The worst surfaces, in order.**

1. **Archive** — a card grid over 214 items, in the monolith, unscoped, untested, and the
   one design doc that mentions it says the format cannot round-trip a set.
2. **`/builder`** — 1,422 lines of undesigned CSS, never in scope for any redesign,
   opening in a second tab that does not know which set you were looking at.
3. ~~**Prompts (editor + advisor + generation editor)**~~ — **converted.** It was "three
   UIs over one record type, two hand-rolled overlays on the tallest form in the product,
   a card grid, and eleven global class names declared from a component stylesheet". §6
   was the plan and §6.2 is now the record: one library component mounted twice, three
   dialogs through `Modal`, seven scopes, zero stray hex, and the two libraries reached by
   one chooser and left by one control. What remains is a product question, not a paint
   one — see item 16 on the summary editor's duplicate-on-save path.
4. ~~**Player session**~~ — **converted.** It was "the largest surface with no design
   pass at all, no theme declaration, no scoped stylesheet and no CSS contract test,
   despite `docs/design/player-redesign/` holding 23 finished mockups and a RATIONALE".
   `5678b92b` built it from those mockups (`.plr`, `data-theme="dark"`, three literal
   ladders, `playerSurfacePalette` + `playerSurface`); a follow-up closed the two paper
   islands left inside it (citations 28 and 29) and pinned the markup namespace as well
   as the stylesheet's. **What is still not provable anywhere in this repo** is the
   design's own audit checks A1-A4 — no sideways scroll, the page itself never scrolls,
   the dock is on screen at rest, every target is 44×44. All four are geometric, jsdom
   has no layout engine, and only a device can answer them.
5. **Settings** — three switches in a white `.admin-section` card, one of which prints AI
   prompt text onto the **host's** screen, which may be a projector (RATIONALE §9). That
   is a warning, not a feature description, and it is currently neither.

**Systemic, not per-surface:**

- **Twenty-one raw overlay `div`s bypass `Modal.jsx`** (citation 7 — twenty-two until the
  player's game-end dialog went). Each is a dialog with no Escape, no focus trap, no
  scroll lock and no `role="dialog"`. The container rule document counted twelve shells in
  August; the count above is by call site.
- **Four component stylesheets redeclare the global `.btn-primary` / `.btn-secondary`**
  (`AIPromptManager.css:472`, `IssueReportForm.css:172`, `FileUploadPrompt.css:145`,
  `BuilderPage.css`), competing with `styles.css:127` at equal specificity. Which one wins
  is decided by CSS injection order, i.e. by module evaluation order — see §5.2.
- **The console changes polarity when you press Edit** on a question set
  (`AdminPage.jsx:975`, citation 11).
- **Six stylesheets carry text below the 12px floor** (citations 6, 8, 15, 23).

---

## 5. Bugs found while auditing — reported, not fixed

### 5.1 The skill this file is keyed to is invisible to git

`.gitignore:194` is a bare `.claude/`, which excludes the whole directory — so
`.claude/skills/engage-design/` and `.claude/agents/aws-cicd-architect.md` are both
untracked. A project skill that never reaches the repo never reaches another session, a
teammate, or CI. It is the same trap as the unanchored `*token*` at `.gitignore:35` that
forced every palette test to be named `*Palette*`.

**Git cannot re-include a file whose parent directory is excluded**, so `!.claude/skills/`
alone will not work. The fix is to exclude the directory's *contents* instead:

```gitignore
# .gitignore:194 — replace `.claude/` with:
.claude/*
!.claude/skills/
!.claude/agents/
```

Owner's call — `.gitignore` is outside this change's file set.

### 5.2 A component stylesheet redeclares the global `.modal-overlay`

**`components/AIPromptManager.css:1094` redeclares the global `.modal-overlay` with
`align-items: center` and no `overflow-y`.**

That is the exact defect `__tests__/modalReachability.test.js` exists to prevent, in the
exact selector it guards — a dialog taller than the viewport is centred, overflows top and
bottom at once, and its footer cannot be reached by any gesture. `styles.css:5561-5581`
carries the correct rule (`align-items: flex-start; overflow-y: auto`, with
`margin: auto` on the card).

The two rules have equal specificity, so the later injection wins. Today that is
`styles.css`, because `src/src/index.jsx:3-4` imports `App` **before** `./styles.css` and
ES module evaluation is depth-first — so `AIPromptManager.css` is injected while `App`'s
tree evaluates, and `styles.css` lands last. **Swapping those two lines silently re-breaks
every `.modal-overlay` dialog in the product** — the player's game-end modal, the question
discard confirm, `QuestionSetEditor`'s pending delete, all four AI builders and the
generation prompt editor.

`modalReachability.test.js:50` reads `.modal-overlay` **only out of `styles.css`**, and its
own header already records that "reading only `styles.css` is how the fourth instance hid".
This is the fifth.

**Suggested fix (for whoever owns that file):** delete `.modal-overlay`, `.modal-content`
and `.large-modal` from `AIPromptManager.css` and give `AIGenerationPromptEditor` a scoped
width modifier instead of `max-width: 1200px !important`; then extend
`modalReachability.test.js` to assert that **no component stylesheet declares
`.modal-overlay` at all**.

---

## 6. The prompt admin gap list

The owner's specific complaint — *"i still dont like the admin prompt management
interface... i dont think its been given the same UX treatment, as the question set admin
peice"* — gets its own ordered plan here, with the blocking test named. **Items 1-15 are implemented and 16 is
partly implemented; the status column below is the record.**

### 6.1 What was blocked, and by what

`__tests__/promptEditorPalette.test.js` used to assert that `AdminPage.jsx`'s prompts
section carried **no** `contentTheme`. Its comment was correct and was honoured:

> If this test goes red because the section gained `contentTheme:'dark'`, THAT is the
> signal to convert these blocks, in the same change.

**Verified, and then done.** That test's own comment named its exit — *"If this test goes
red because the section gained `contentTheme:'dark'`, THAT is the signal to convert these
blocks, in the same change"* — and that is the change items 11-15 are. The flip, the
repaint and the rewritten expectation all landed together, because either half alone is
unreadable: the flip alone puts `--pc-ink #1a1a1a` on `--bg #0F1A2E` at 1.3:1, the repaint
alone puts `#F4EDE4` on the light field at 1.2:1. `promptEditorPalette.test.js` now asserts
BOTH ends of that pair rather than only the "still paper" end.

### 6.2 The list, in order

| # | Change | Rule | Where |
|---|---|---|---|
| 1 | **[DONE]** Delete `.modal-overlay` `:1094`, `.modal-content` `:1108`, `.large-modal` `:1118` from `AIPromptManager.css`; give the generation editor a scoped `--wide` modifier instead of `!important`. | §1.A, §5.2 | `components/AIPromptManager.css:1094-1129` |
| 2 | **[DONE]** Delete the other global declarations: `.btn-primary`/`.btn-secondary` `:472-506`, `.status-badge` `:118`, `.empty-state` `:237`, `.form-group` `:338`, `.form-actions` `:1085`, `.tag` `:199`, `.loading-spinner` `:1277`. Re-declare each under one scope prefix. | §1.A | same file |
| 3 | **[DONE — `.pmgr`, plus six sub-scopes]** Choose the scope prefix and root every remaining selector at it. `.pc-` is already taken by the token block; `.pmgr` is free and `.plib`/`.pvi`/`.ppf`/`.pap` already exist as sub-scopes. | §1.A | `components/AIPromptManager.css` throughout |
| 4 | **[DONE]** Route both dialogs through `Modal.jsx`: `AIPromptEditor` at `AIPromptManager.jsx:466-470` and `AIPromptAdvisor` at `:927-932`. They currently have no Escape, no focus trap, no scroll lock and no `role="dialog"` — on the tallest form in the product. | §1.E, container rule | `components/AIPromptManager.jsx:466,927` |
| 5 | **[DONE]** Give the **advisor** a bottom exit. It has an X at `:931` and nothing else, below several screens of analysis. | §1.F, commit `4fd425d6` | `components/AIPromptManager.jsx:1082-1085` |
| 6 | **[DONE]** Route the editor's X `:470` and Cancel `:867-869` through one `requestClose()` that confirms when the form is dirty, and gate `closeOnEscape` on the same flag. | §1.F | `components/AIPromptManager.jsx:470,861-874` |
| 7 | **[DONE — two Modal confirms; the failure/success alerts became inline `StatusMessage` banners instead, because a modal reporting a failed list load is dismissed into an empty state that lies]** Replace `window.confirm` at `:1146` and `:1183` and the six `alert()` calls (`:372,392,446,920,1139,1162,1212,1219`) with `Modal`-based dialogs that state the **consequence**, not the severity — and, for archive-a-prompt, offer the reversible neighbour. | §1.E, RATIONALE §8 | `components/AIPromptManager.jsx` |
| 8 | **[DONE]** Raise the 11px tooltip at `AIPromptManager.css:952` to the 12px floor, and extend the floor assertion to the **whole** stylesheet rather than only the block after `BEFORE YOU SAVE`. | §1.D | `.css:952`, `__tests__/promptEditorPalette.test.js:174-182` |
| 9 | **[DONE]** Replace the third prompt UI: `AIGenerationPromptEditor.jsx:318-333` renders `.prompts-grid`/`.prompt-card`. Point it at `PromptLibraryPanel` — the table already exists. | §1.D/E, RATIONALE §9 | `components/AIGenerationPromptEditor.jsx:318` |
| 10 | **[DONE — `modalReachability.test.js`, plus a new `promptManagerScope.test.js` for the namespace and orphan contract]** Give the editor a `promptEditor`-scoped reachability test asserting its scrim contract, the way `modalReachability.test.js:133-152` already does for `.prompt-editor-overlay`. | §1.H | new assertions in `modalReachability.test.js` |
| 11 | **[DONE]** Flip `AdminPage.jsx:65-71` to `contentTheme: 'dark'` **and** convert every `--pc-*` value to the dusk set in the same commit. `--pc-ink #1a1a1a` on `--bg #0F1A2E` is 1.3:1 the moment the flip lands alone. | §1.C | `AdminPage.jsx:65-71` + `AIPromptManager.css:1356-1365`, `:1706-1716` |
| 12 | **[DONE — plus `--pc-go`, `--pc-card`, `--pc-field`, `--pc-hover` and the `--pc-t-*` ladder, all named in the stylesheet header]** Map the six `--pc-*` tokens onto the shipped dusk tokens rather than inventing new ones: `--pc-ink → --text`, `--pc-muted → --muted`, `--pc-link → --secondary`, `--pc-stop → --danger-text`, `--pc-silent → --primary`, `--pc-paper → --surface`, and the two tints onto `rgba()` of `--danger` / `--primary` at the alphas `.qsets-tint-*` already uses. | §1.B | `components/AIPromptManager.css:1356-1365` |
| 13 | **[DONE — and two idiom faults came with it: `.plib-rowact` was `justify-content: flex-end` inside a table cell (hard rule 9, the exact bug `rowActionsReachable.test.js` was written for), and `.plib-tbl` had declared widths under `table-layout: auto`, where they are hints (hard rule 11). Active moved off the link hue it shared with the Type chip onto `--qsets-success-text`.]** Convert `.plib` to the `.qsets` palette. Structurally it is already the right screen — table, two empty states, drop-exits, chips — so this is paint only: `.plib-tbl` `:1911`, `.plib-chip*` `:1958-1975`, `.plib-btn*` `:1978-1999`, `.plib-empty/-nomatch` `:2001-2016`. | §1.B/C | `components/AIPromptManager.css:1905-2020` |
| 14 | **[DONE]** Remove the `.admin-section` white card and the `.tab-content` wrapper from the prompts branch, exactly as the users section already did (`AdminPage.jsx:1148-1151`: *"No `.tab-content` wrapper: that class carries a 500px min-height and a fade-in written for the paper tabs"*). | §1.C | `AdminPage.jsx:1001-1005` |
| 15 | **[DONE]** Rewrite `promptEditorPalette.test.js` in the same commit: swap the "still paper" assertion at `:150-161` for the dusk one at `questionSetsPalette.test.js:197-204`, re-measure every `--pc-*` pairing against `--bg`/`--surface` instead of white and `#f8f9fa`, and add the namespace-both-ways and stray-hex assertions. | §1.H | `__tests__/promptEditorPalette.test.js` |
| 16 | **[PARTLY DONE — the generation library became a place; the SUMMARY editor is still a modal, deliberately]** The generation library is no longer a full-viewport overlay mounted outside the console: it is a place in the work area, reached by the same chooser and left by the same `.padm-back` as the summary library. That was the owner's *"the way you get to the Question set AI generator prompts and the Engagement results prompts … should be the same"*, and it is the container rule's own answer for a library plus a fourteen-field editor. The SUMMARY editor stays a `Modal`, and the reason RATIONALE §1 gave is unchanged: *"the editor creates duplicates instead of updating, and there is no versioning in the editor despite versioning existing in the lambda"*. Do not draw a beautiful editor on top of a save path that duplicates records. | RATIONALE §1, §2 | `AIPromptManager.jsx:146`, `AdminPage.jsx` (`.padm`) |

### 6.3 What NOT to touch

The `BEFORE YOU SAVE` block (`AIPromptManager.css:1326-1680`) and its siblings `.pvi`,
`.ppf`, `.pap`, `.prompt-build`, `.prompt-half`, `.prompt-readout` are good work: scoped,
token-driven within their own set, contrast-measured with the ratios in the header, and
covered by `promptEditorPalette.test.js`, `promptVariablePalette.test.jsx`,
`promptPreflightPanel.test.jsx` and `promptAssembledPreview.test.jsx`. Items 11-13 re-point
their tokens; nothing else about them should change.
