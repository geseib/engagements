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
| Join name collision | `components/JoinNameCollision.{jsx,css}` | ok `.join-` | ok | inherited | ok | — | — | n/a | ok `joinNameCollision.test.jsx` |

### Player

| Surface | Files | A | B | C | D | E | F | G | H |
|---|---|---|---|---|---|---|---|---|---|
| Player session (join → lobby → ask → vote → results → end) | `PlayerPage.jsx` + `styles.css:2195+` | FAIL⁴ | FAIL⁴ | FAIL⁵ | FAIL⁶ | FAIL⁷ | FAIL⁷ | FAIL | FAIL — no CSS contract test |

### Host

| Surface | Files | A | B | C | D | E | F | G | H |
|---|---|---|---|---|---|---|---|---|---|
| Host front door | `components/WelcomeScreen.{jsx,css}` | ok `.wel-` | ok | ok `:88` | FAIL⁸ | ok | — | ok | ok `welcomeScreen.test.jsx` |
| Host stage (lobby/ask/vote/results/ended) | `components/stage/*`, `styles/stage.css` | ok | ok | ok | ok (profiles) | ok | — | ok (lifted model) | ok `stageShell`, `stageCompletion`, `displayProfile` |
| Host page chrome + overlays | `GameHostPage.jsx` + `styles.css` | FAIL⁴ | FAIL⁴ | part | part | FAIL⁷ | FAIL⁷ | part | part — call-site tests only, cannot mount |
| Create engagement | `components/GameSetupDialog.jsx` + `styles.css:2643` | part | FAIL | part | part | ok (Modal) | **FAIL⁹** | part | ok `gameSetupDialog.test.jsx` |
| Quickstart menu | `components/QuickstartMenu.jsx` + `styles.css` | part | part | ok `:195` | part | FAIL⁷ | part | n/a | ok `quickstartMenu.test.jsx` |
| Host question-set shelf | `components/HostQuestionSetsDialog.jsx` | ok `.qsets--onlight` | ok | ok | ok | ok | ok `:193` + footer | ok | ok `hostQuestionSetsPalette` |
| Host remote (phone) | `HostRemote.{jsx,css}`, `RemoteCategoryList`, `RemoteQuestionBrowser` | ok `.hr-/.hrc-/.hrq-` | ok | ok | ok | ok | — | n/a — no palette test | part `hostRemote*.test` |
| Game report | `components/GameReport.{jsx,css}` | ok `.report-` | part | ok `:208` paper by design | ok | part | part | n/a | part `gameReport.test.jsx` |

### Admin console

| Surface | Files | A | B | C | D | E | F | G | H |
|---|---|---|---|---|---|---|---|---|---|
| Console shell | `components/AdminShell.{jsx,css}` | ok `.adm-` | ok | ok `:116` | ok | ok | — | ok | ok `adminShellPalette`, `adminShell` |
| **Question sets — the standard** | `components/QuestionSetsPanel.{jsx,css}` | ok `.qsets` | ok | ok `AdminPage.jsx:54` | ok | ok | ok | ok | ok `questionSetsPalette`, `rowActionsReachable` |
| Question-set editor | `QuestionSetEditor`, `QuestionsPanel`, `CategoryPicker` + `styles.css:10012+` | part¹⁰ | FAIL¹⁰ | **FAIL¹¹** | part | part¹² | ok (`4fd425d6`) | part | part |
| Sessions | `components/SessionsPanel.{jsx,css}` | ok `.sp` | ok | ok `AdminPage.jsx:62` | ok | ok | ok | ok | ok `adminTabsPalette`, `sessionsPanel` |
| Users | `components/UserManagement.{jsx,css}` | ok `.um` | ok | ok `AdminPage.jsx:84` | ok | ok | ok | ok | ok `adminTabsPalette`, `userManagement` |
| **Prompts — library list** | `components/PromptLibraryPanel.jsx` + `AIPromptManager.css:1905+` | ok `.plib` | ok (`--pc-*`) | **FAIL¹³** | ok | ok (table) | — | ok (on white) | ok `promptLibraryPanel`, `promptEditorPalette` |
| **Prompts — summary editor** | `AIPromptManager.jsx:146-878` + `.css` | **FAIL¹⁴** | **FAIL¹⁴** | **FAIL¹³** | FAIL¹⁵ | **FAIL¹⁶** | part¹⁷ | part¹⁸ | part |
| **Prompts — advisor** | `AIPromptManager.jsx:881-1086` | **FAIL¹⁴** | **FAIL¹⁴** | **FAIL¹³** | FAIL¹⁵ | **FAIL¹⁶** | **FAIL¹⁹** | FAIL | FAIL |
| **Prompts — generation editor** | `components/AIGenerationPromptEditor.jsx` | **FAIL¹⁴** | **FAIL¹⁴** | **FAIL¹³** | FAIL | **FAIL²⁰** | FAIL | FAIL | FAIL |
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
5. `PlayerPage.jsx` never declares `data-theme`; it inherits `light` from
   `public/index.html` while painting its own gradients.
6. `styles.css:794`, `:927`, `:2801`, `:9879`, `:9996`, `:10939`, `:11015`, `:11051` are
   all `font-size: 11px`.
7. Raw overlay `div`s that bypass `components/Modal.jsx` — no Escape, no focus trap, no
   scroll lock, no `role="dialog"`: `PlayerPage.jsx:2657`, `QuestionsPanel.jsx:1186`,
   `QuestionsPanel.jsx:1204`, `QuestionSetEditor.jsx:1333`, `HelpSystem.jsx:287`,
   `IssueReportForm.jsx:88`, `AIAssistant.jsx:155`, `AIScenarioBuilder.jsx:927`,
   `PollAIBuilder.jsx:374`, `SurveyAIBuilder.jsx:503`, `TriviaAIBuilder.jsx:369`,
   `AIGenerationPromptEditor.jsx:242`, `AIGenerationPromptEditor.jsx:253`,
   `AIPromptManager.jsx:466`, `AIPromptManager.jsx:927`, `QuickstartMenu.jsx:209`,
   `GameHostPage.jsx:3824`, `GameHostPage.jsx:5177`, `GameHostPage.jsx:5195`,
   `GameHostPage.jsx:5245`, `GameReport.jsx:281`, `GameReport.jsx:341`. **Twenty-two.**
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
13. `AdminPage.jsx:65-71` (prompts), `:72-78` (archive), `:86-95` (settings) carry no
    `contentTheme`, so `AdminShell.css:410-413` paints `#f5f7fa` under them. The seam is
    deliberate and marked TRANSITIONAL — but three of six sections are still on the wrong
    side of it.
14. `components/AIPromptManager.css` declares **global** selectors from a component
    stylesheet: `.btn-primary` `:472,483`, `.btn-secondary` `:472,497`, `.modal-overlay`
    `:1094`, `.modal-content` `:1108`, `.large-modal` `:1118` (with `!important`),
    `.status-badge` `:118`, `.empty-state` `:237`, `.form-group` `:338`, `.form-actions`
    `:1085`, `.tag` `:199`, `.loading-spinner` `:1277`. 158 hex literals outside any
    token block.
15. `components/AIPromptManager.css:952` — an 11px tooltip. The floor assertion in
    `promptEditorPalette.test.js:174-182` only covers the block **after** `BEFORE YOU
    SAVE`, so the legacy half is unchecked.
16. `AIPromptManager.jsx:466` and `:927` are hand-rolled overlays. No Escape, no focus
    trap, no scroll lock, no `role="dialog"` — on the tallest form in the product.
17. The editor has an X (`:470`) and a bottom Cancel (`:866-868`), but neither routes
    through a shared `requestClose()` and there is no dirty check on either.
18. `AIPromptManager.css:1350-1365` declares a genuinely measured paper palette
    (`--pc-*`, ratios in the header at `:1343-1347`), asserted by
    `promptEditorPalette.test.js`. That half is good work. The 1,325 lines above it are
    not covered.
19. `AIPromptManager.jsx:927-1086` — the advisor has an X at `:931` and **no bottom
    exit** at all, on a panel that renders analysis lists, improvement items, pros/cons
    and recommendations. Scroll to the recommendations and the only way out has left the
    frame.
20. `AIGenerationPromptEditor.jsx:318-333` still renders `.prompts-grid` / `.prompt-card`
    — the card grid RATIONALE §4 rejected — and is the third UI over the one prompt
    record (RATIONALE §9, "One prompt library").
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

---

## 4. Headline findings

**The console is two-thirds converted and the seam runs through Prompts.** Question sets,
Sessions and Users are dusk, namespaced, ladder-correct and contrast-asserted. Prompts,
Archive and Settings are paper markup on a `#f5f7fa` patch that `AdminShell` paints
specifically so they do not render at 1.4:1. That patch
(`AdminShell.css:402-413`) is marked "DELETE WHEN WAVE D LANDS".

**The worst surfaces, in order.**

1. **Archive** — a card grid over 214 items, in the monolith, unscoped, untested, and the
   one design doc that mentions it says the format cannot round-trip a set.
2. **`/builder`** — 1,422 lines of undesigned CSS, never in scope for any redesign,
   opening in a second tab that does not know which set you were looking at.
3. **Prompts (editor + advisor + generation editor)** — three UIs over one record type,
   two hand-rolled overlays on the tallest form in the product, a card grid, and eleven
   global class names declared from a component stylesheet. §6 is the plan.
4. **Player session** — the largest surface with no design pass at all, no theme
   declaration, no scoped stylesheet and no CSS contract test, despite
   `docs/design/player-redesign/` holding 23 finished mockups and a RATIONALE.
5. **Settings** — three switches in a white `.admin-section` card, one of which prints AI
   prompt text onto the **host's** screen, which may be a projector (RATIONALE §9). That
   is a warning, not a feature description, and it is currently neither.

**Systemic, not per-surface:**

- **Twenty-two raw overlay `div`s bypass `Modal.jsx`** (citation 7). Each is a dialog with
  no Escape, no focus trap, no scroll lock and no `role="dialog"`. The container rule
  document counted twelve shells in August; the count above is by call site.
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
peice"* — gets its own ordered plan here, with the blocking test named. **Nothing below is
implemented; a separate change applies it.**

### 6.1 What is blocked, and by what

`__tests__/promptEditorPalette.test.js:150-161` asserts that `AdminPage.jsx`'s prompts
section carries **no** `contentTheme`. Its comment is correct and should be honoured:

> If this test goes red because the section gained `contentTheme:'dark'`, THAT is the
> signal to convert these blocks, in the same change.

**Verified**: `AdminPage.jsx:65-71` has no `contentTheme`, and `AdminShell.jsx:69` defaults
to `'light'`. So every item marked **[blocked]** below must land in the *same commit* as
the `contentTheme: 'dark'` flip and the rewrite of that test's expectation. Items marked
**[free]** can be done now, on the paper theme, without touching it.

### 6.2 The list, in order

| # | Change | Rule | Where |
|---|---|---|---|
| 1 | **[free]** Delete `.modal-overlay` `:1094`, `.modal-content` `:1108`, `.large-modal` `:1118` from `AIPromptManager.css`; give the generation editor a scoped `--wide` modifier instead of `!important`. | §1.A, §5.2 | `components/AIPromptManager.css:1094-1129` |
| 2 | **[free]** Delete the other global declarations: `.btn-primary`/`.btn-secondary` `:472-506`, `.status-badge` `:118`, `.empty-state` `:237`, `.form-group` `:338`, `.form-actions` `:1085`, `.tag` `:199`, `.loading-spinner` `:1277`. Re-declare each under one scope prefix. | §1.A | same file |
| 3 | **[free]** Choose the scope prefix and root every remaining selector at it. `.pc-` is already taken by the token block; `.pmgr` is free and `.plib`/`.pvi`/`.ppf`/`.pap` already exist as sub-scopes. | §1.A | `components/AIPromptManager.css` throughout |
| 4 | **[free]** Route both dialogs through `Modal.jsx`: `AIPromptEditor` at `AIPromptManager.jsx:466-470` and `AIPromptAdvisor` at `:927-932`. They currently have no Escape, no focus trap, no scroll lock and no `role="dialog"` — on the tallest form in the product. | §1.E, container rule | `components/AIPromptManager.jsx:466,927` |
| 5 | **[free]** Give the **advisor** a bottom exit. It has an X at `:931` and nothing else, below several screens of analysis. | §1.F, commit `4fd425d6` | `components/AIPromptManager.jsx:1082-1085` |
| 6 | **[free]** Route the editor's X `:470` and Cancel `:867-869` through one `requestClose()` that confirms when the form is dirty, and gate `closeOnEscape` on the same flag. | §1.F | `components/AIPromptManager.jsx:470,861-874` |
| 7 | **[free]** Replace `window.confirm` at `:1146` and `:1183` and the six `alert()` calls (`:372,392,446,920,1139,1162,1212,1219`) with `Modal`-based dialogs that state the **consequence**, not the severity — and, for archive-a-prompt, offer the reversible neighbour. | §1.E, RATIONALE §8 | `components/AIPromptManager.jsx` |
| 8 | **[free]** Raise the 11px tooltip at `AIPromptManager.css:952` to the 12px floor, and extend the floor assertion to the **whole** stylesheet rather than only the block after `BEFORE YOU SAVE`. | §1.D | `.css:952`, `__tests__/promptEditorPalette.test.js:174-182` |
| 9 | **[free]** Replace the third prompt UI: `AIGenerationPromptEditor.jsx:318-333` renders `.prompts-grid`/`.prompt-card`. Point it at `PromptLibraryPanel` — the table already exists. | §1.D/E, RATIONALE §9 | `components/AIGenerationPromptEditor.jsx:318` |
| 10 | **[free]** Give the editor a `promptEditor`-scoped reachability test asserting its scrim contract, the way `modalReachability.test.js:133-152` already does for `.prompt-editor-overlay`. | §1.H | new assertions in `modalReachability.test.js` |
| 11 | **[blocked]** Flip `AdminPage.jsx:65-71` to `contentTheme: 'dark'` **and** convert every `--pc-*` value to the dusk set in the same commit. `--pc-ink #1a1a1a` on `--bg #0F1A2E` is 1.3:1 the moment the flip lands alone. | §1.C | `AdminPage.jsx:65-71` + `AIPromptManager.css:1356-1365`, `:1706-1716` |
| 12 | **[blocked]** Map the six `--pc-*` tokens onto the shipped dusk tokens rather than inventing new ones: `--pc-ink → --text`, `--pc-muted → --muted`, `--pc-link → --secondary`, `--pc-stop → --danger-text`, `--pc-silent → --primary`, `--pc-paper → --surface`, and the two tints onto `rgba()` of `--danger` / `--primary` at the alphas `.qsets-tint-*` already uses. | §1.B | `components/AIPromptManager.css:1356-1365` |
| 13 | **[blocked]** Convert `.plib` to the `.qsets` palette. Structurally it is already the right screen — table, two empty states, drop-exits, chips — so this is paint only: `.plib-tbl` `:1911`, `.plib-chip*` `:1958-1975`, `.plib-btn*` `:1978-1999`, `.plib-empty/-nomatch` `:2001-2016`. | §1.B/C | `components/AIPromptManager.css:1905-2020` |
| 14 | **[blocked]** Remove the `.admin-section` white card and the `.tab-content` wrapper from the prompts branch, exactly as the users section already did (`AdminPage.jsx:1148-1151`: *"No `.tab-content` wrapper: that class carries a 500px min-height and a fade-in written for the paper tabs"*). | §1.C | `AdminPage.jsx:1001-1005` |
| 15 | **[blocked]** Rewrite `promptEditorPalette.test.js` in the same commit: swap the "still paper" assertion at `:150-161` for the dusk one at `questionSetsPalette.test.js:197-204`, re-measure every `--pc-*` pairing against `--bg`/`--surface` instead of white and `#f8f9fa`, and add the namespace-both-ways and stray-hex assertions. | §1.H | `__tests__/promptEditorPalette.test.js` |
| 16 | **[after 11-15]** Consider making the editor a **place** rather than a modal, matching `docs/design/admin-redesign/19-prompt-editor.html` — breadcrumb "‹ Prompts", full work area, versioned save. This is a product decision, not a paint one: RATIONALE §1 parked the prompt designs because *"the editor creates duplicates instead of updating, and there is no versioning in the editor despite versioning existing in the lambda"*. Do not draw a beautiful editor on top of a save path that duplicates records. | RATIONALE §1, §2 | `AIPromptManager.jsx:146` |

### 6.3 What NOT to touch

The `BEFORE YOU SAVE` block (`AIPromptManager.css:1326-1680`) and its siblings `.pvi`,
`.ppf`, `.pap`, `.prompt-build`, `.prompt-half`, `.prompt-readout` are good work: scoped,
token-driven within their own set, contrast-measured with the ratios in the header, and
covered by `promptEditorPalette.test.js`, `promptVariablePalette.test.jsx`,
`promptPreflightPanel.test.jsx` and `promptAssembledPreview.test.jsx`. Items 11-13 re-point
their tokens; nothing else about them should change.
