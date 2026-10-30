# New engagement mockups: visual and accessibility review

*30 Oct 2026. Reviewer: senior visual designer and accessibility pass, working from the
`engage-design` skill. Scope: `index.html`, `README.md` and PNGs 01 to 11 in this folder.
Every number below was measured in Chromium with Playwright: the mockup's own CSS was rendered,
alpha layers were composited up the ancestor chain, and the `.screen.desk` box was resized to
1280×720 and 1366×768 as well as the drawn 1440×900. Nothing was eyeballed. The measuring
scripts are in the session scratchpad, not the repo.*

**Verdict.** The structure is right. A fixed-size two-pane modal, the categories moved under
the set, the chooser taking the body instead of growing the card, and the hand-off strips for
Build Room and Event all fix real faults. The footer and Create stay on screen at every laptop
size tested. The problems are in three areas. (1) Motion: seven to nine loops run at once with
no way to pause them, and the reduced-motion state shows the *start* of three previews, not
the end. (2) Selection is shown by colour alone on the format chips and the gallery. (3) There
is no focus style, the radio group has seven tab stops, and the set table cannot be reached by
keyboard. All three can be fixed without changing the layout.

---

## 1. Consistency with the shipped design system

### What matches
- **Tokens.** Card `#1B2942`, field `#25375A`, text `#F4EDE4`, amber, periwinkle and success
  all match `styles.css`. The lighter muted `#A9B5C9` is **not** invented: it is the shipped
  `--gsd-muted` (`GameSetupDialog.css:61`), and the comment there says why (#9BA8BE measures
  4.23:1 on the green tint). Keep it.
- **Selected chip.** `.chip.on` copies the shipped `.gsd-pill.on` exactly
  (`GameSetupDialog.css:304-308`): amber border, amber text, 12% amber wash.
- **Dialog exits.** Both the X ("Close without creating") and Cancel are present on every frame,
  and the README routes both through `requestClose()`. The discard question stays inline in the
  foot, and no modal opens from inside the modal. This satisfies hard rules 2 and 3.
- **Tables.** `.cmp` and `.ch-tbl` both declare `table-layout: fixed` (hard rule 11).
- **Shape.** One wide Modal, a body that scrolls inside, and a fixed head and foot. This is the
  `.qsets` shape.

### What drifts, and should be pulled back

| # | Drift | Where | Fix |
|---|---|---|---|
| D1 | **Off-ladder type sizes**: 11.5px (`.fmt-tag` "Own setup screen", the "last" tag in `.chip em`, `.cap`, the `.cmp tr.grp` group heads), 12.5px (every `.cmp td`, `.hand-steps li`), 14px (`.cmp-n`, `.next b`), 17px (`.side-explain h3`) and 20px (phone `h1`). | CSS lines 102, 127, 167, 285, 345 and others | Use 12 / 13 / 15 / 19 / 24 only. 11.5 is **below the 12px floor**, so it is a hard-rule break, not just style. 12.5 → 13, 14 → 15, 17 → 19, 20 → 24 (or 19 on the phone). |
| D2 | **Side-pane ground `#16233A`** (`--card-in`) is a new colour with no token. | `.ne-side` | Declare it as `--gsd-side` in the `.gsd` token block, with its measured pairs in the header comment and in `gameSetupPalette.test.js`. The README already lists this as a test. |
| D3 | **Paper frame (11) uses `[data-theme="light"]` on the screen** and introduces `--secondary #2F5FA8` and `--success-t #1F7A52`. | CSS line 34 | `GameSetupDialog.css` deliberately uses scoped `--gsd-*` tokens because Modal owns the root element (`:20-25`). Paper must be a re-tint block on the scope, following `QuestionSetsPanel.css:585-604` (`.gsd.gsd--onlight, .gsd--onlight .gsd`), not a theme attribute. Before building it, confirm that the host page ever shows this dialog on paper. If it never does, drop frame 11 and its test burden. |
| D4 | **Preview "tabs"** (`Room screen / Phones`) are `<span>`s inside `role="tablist"`: an invented control that is neither focusable nor a real tab. | `.pv-tabs` | Use two `aria-pressed` toggle buttons styled like `.chip`, or real `role="tab"` buttons. Do not create a third tab idiom. `ScopeTabs` is the org switcher and is not a generic tab bar. |
| D5 | **Dashed borders carry three meanings**: a goal filter chip, an optional field (briefing), and a placeholder or empty slot ("Not sure?", "Categories appear here", "Wavelength, Survey…" on the phone, skeletons). | `.goal`, `.opt-line`, `.fmt-cmp`, `.ne-held`, `.pm-more`, `.cat.sk` | Keep dashed for "empty or placeholder" only. Give goal chips a solid `--rule` border (they are buttons). Give the collapsed briefing a solid hairline, so the dashed box stops looking like a drop zone. |
| D6 | **Amber means "selected", "required step" and "warning"** in one viewport. The 5b note "Your earlier picks… were cleared" is set in amber text, as is the Advanced "Changed:". | `.amber`, `.blocked` | Selection stays amber. Render the cleared-picks note through `StatusMessage` (or its tone tokens) so its tone comes from the shared helper. "Changed:" can stay amber because the shipped sheet already does that (`GameSetupDialog.css:39`). |
| D7 | **Numbering appears three times** in the hand-off frames: step badge "3", hand-off tiles 1 to 4, and "What happens next" 1 to 4. | Frames 7, 8, 9 | Leave the hand-off tiles unnumbered (use icons or ticks). Keep numbers for the form steps and for "What happens next" only. |
| D8 | **The Compare table repeats the format previews**, each with its own animation, inside the table head. | Frame 2 | This reuses `FormatPreview`, which is fine, but the previews must be still in the table (see M1). |

### Things invented that should reuse something that exists
- **Category toggles**: today's `SessionCategories` already renders a toggle grid. Restyle it.
  Do not build a `.cat` from scratch.
- **The set row "Change" and the chooser**: `SetChooser` as it ships. The mockup is consistent
  with this, as long as the builder keeps the existing component and only moves it.
- **Skeleton chips**: there is no shared skeleton component. If one is added here, name it
  `.gsd-skel` and keep it in this scope.
- **Ready / blocked notes** (`.blocked`, the cleared-picks note): use `StatusMessage`.

---

## 2. Visual hierarchy and density, frame by frame

| Frame | Is the primary action obvious? | Noise and issues |
|---|---|---|
| **1 First time** | Create is correctly disabled, and the foot says "3 things to decide". The *next* action is not obvious, though: the Call & Answer card is drawn in its **hover** state (periwinkle ring and wash). A novice will read that as "already selected", which contradicts "nothing is pre-chosen". | The seven formats are named **three times** in one viewport: seven goal chips, seven cards, and the side-pane explainer. "Compare" also appears twice (the "Not sure?" tile and the side-pane link). The goal chips take two rows (about 70px) to highlight one card each. Fold each goal into its card as a line ("For: ideas and priorities") and delete the chip rows. That gives a 1280×720 laptop room for the second gallery row. At 1280×720 only the first four cards show, and the "Not sure?" tile is below the fold. |
| **2 Compare** | The filled "Use Wavelength" button is clear. The amber-filled but disabled "Create engagement" in the foot competes with it. | The highlighted column renders **grey-brown**, not amber, because the 12% amber wash composites over the 5% periwinkle "Bigger" group ground. Separate the two layers. At 1280×720 the "Use …" row sits 195px below the fold and the header scrolls away (form 528/723). |
| **3 Expert** | Yes. Filled Create with Ctrl+↵ is the single amber block. | Good density. The side checklist repeats the title, format and set that are visible 600px to the left (see H1). |
| **4 Call & Answer** | Yes. | The categories read well. Three facts are stated twice in one viewport: "5 of 8 categories · 10 questions" (under the grid and in the side pane), the title, and the set name. |
| **5a Change set** | Correct that Create is disabled. The commit action is a row click, and rows show no affordance (no focus or hover indication beyond `.hl`). | Good: the side pane steps aside and the card keeps its size. The "Keep the set I had" link floats at the far right, 1,000px from the search the eye is on. Put it next to the search, or as a secondary button in the foot ("Keep Lessons from Different Schools"). |
| **5b Set picked** | Yes. | The side-by-side "loading / loaded" split is a presentation device. Make sure the builder does not ship the dashed annotation boxes. The foot says "Ready." while the left half is loading; in the product, Create must be disabled with "Loading categories…". |
| **6 Trivia** | Yes. | The set name truncates ("GenAI From Three Angles: Development, Engineer…"). Hard rule 7: `title=` must carry the full string. The `.setp b` truncation is a single text node with `min-width:0`, which is correct (hard rule 8). |
| **7 Build Room / 8 Event** | Yes. The arrow and "Continue to…" make the leave-the-dialog step honest. | Good use of "Nothing is created yet". The Free-plan variant in 8 is drawn as an extra box under the real one. In the product it **replaces** the price line, so don't ship both. |
| **9 Ready** | Yes. | The best frame. The "What happens next" four-step list is the only place the flow is explained, and it is clear. |
| **10 Phone** | Yes. Create is full-width amber, and the foot takes 98px of 844 (down from about 140). | The category row is cut by the foot without a fade or "8 categories ↓" hint, so a user may not know there is more. |
| **11 Paper** | Yes. | See D3 and A6. |

### Does "flashy" stay crisp?
Each preview on its own does: it is small, on a dark plate, uses token colours, and loops in 6
to 9 seconds. The trouble is how many run together. **Frame 1 has nine infinite animations
running at once**: seven cards, the side-pane stage, and the typing caret. They loop out of phase,
so something is always moving at the edge of vision while the host is trying to read card
copy. That is noisy, not crisp, and it is also a WCAG failure (M1 below).

### Motion and `prefers-reduced-motion` (measured with `reducedMotion: 'reduce'`)
- **The reduced state shows the start, not the end, for three of seven previews.** The rule
  sets `animation:none; opacity:1`, which leaves every property at its *un-animated* value:
  - Trivia: option C never turns green (`.a-opt.ok` background stays `rgba(244,237,228,.08)`), so
    "the right answer lighting up" is invisible.
  - Survey: ticks are `color: transparent` and the progress bar is `width: 0px`, so it shows an
    empty form.
  - Call & Answer: the winning card's amber wash (`ca-win`) never appears.
  The README promises "each preview shows its end state". Write explicit end-state rules
  (`.a-opt.ok{background:rgba(79,178,134,.45)}`, `.a-row b{color:#0F1A2E;background:#4FB286}`,
  `.a-prog i{width:100%}`, `.c1{background:rgba(246,169,76,.22)}`) inside the media query.
- **The skeleton shimmer (`.cat.sk`, `animation: sk 1.2s infinite`) is not covered** by the media
  query. It still animates under reduce.
- `.fmt` has `transition: transform` with nothing that uses transform. Remove it.

---

## 3. Accessibility

### 3.1 Contrast (measured, composited)

Text pairs that **fail**:

| Element | Frame | Ratio | Need | Cause |
|---|---|---|---|---|
| Step 3 heading "Choose the questions" | 1 | **4.27** | 4.5 | `.ne-step.later{opacity:.5}` |
| Step 3 badge "3", "Required", "Pick a format first…" | 1 | **2.87** | 4.5 | same |
| `kbd` "Ctrl", "↵" on Create | 3–9, 11 | **3.99** | 4.5 | `kbd{opacity:.7}` |
| `kbd` "←", "→" | 3 | **4.23** | 4.5 | same |
| Disabled "Create engagement" | 1, 2, 5a | 2.31 | (exempt) | `opacity:.45`. Exempt under 1.4.3, but it is the most important word on the screen. See below. |

Everything else clears AA: muted on card 7.0, muted on the side pane 7.59, periwinkle links
5.91 / 6.38, amber on the selected wash 5.92, text on the wash 10.0, paper amber `#9A5B18` 5.41 on
white and 4.87 on its wash, paper muted 5.82, paper link `#2F5FA8` 6.32.

Non-text contrast (WCAG 1.4.11, needs 3:1):

| Element | Ratio | Note |
|---|---|---|
| Unselected chip, category and card border (`--rule-s` on card) | 2.07 | Passes only because the text names the control. In practice the off categories read as plain text. |
| Same, paper | **1.69** | Weaker still. |
| Done-tick fill `#4FB286` on white (paper) | **2.61** | A state graphic, so it fails. Use `#1F7A52` for the paper fill. |
| Input focus halo (amber 18%) | 1.42 | Fine only because the border also turns amber (7.4). Do not rely on the halo. |
| **Selected vs unselected format chip** | **1.06** luminance difference (amber text vs muted text) | Colour-only state: WCAG 1.4.1 failure, below. |

Fixes: do not use `opacity` to dim text. Use `--gsd-muted` for the "later" step (7.0:1) and keep
the step-3 row inert through `aria-disabled` plus copy. Set `kbd` to `color: inherit;
opacity: 1`, with the border at `currentColor` 50%. For disabled Create, keep the amber at full
strength on the border and give the label `--gsd-muted` on a transparent fill. A dimmed amber
block reads as "broken"; an outlined one reads as "not yet".

### 3.2 Selection by colour alone (WCAG 1.4.1, Level A)
- **Format chips** (frames 3–11): selected and unselected differ only by hue. Their luminance
  difference is 1.06:1, so for a deuteranope "Call & Answer" and "Trivia" look the same. The
  category toggles already solve this with a tick. **Give `.chip.on` the same leading tick**
  (it replaces the format icon, or sits before it).
- **Gallery cards**: `.on` is an amber border plus a 12% wash, a 1.25:1 change of ground. Add a
  tick badge in the card corner and a visible "Chosen" word.
- **Compare column**: the selected column is shown only by its tint and the filled button.
  Add "Chosen" to the column header.

### 3.3 Keyboard path and focus order (Tab sequence recorded per frame)
- **There is no focus style anywhere in the mockup CSS.** Every stop falls back to the browser's
  `auto 1px` outline. The shipped sheet has `:focus-visible` rules for `.gsd-close`,
  `.gsd-three-opt`, `.gsd-btn` and the Advanced summary (`GameSetupDialog.css:175, 620, 757,
  959`). Specify one ring for every new control: 2px `--gsd-secondary` outline at 2px offset,
  which is 5.9:1 on the card. The chooser's search input declares **`outline:none`** with only a
  `.srch.focus` class to stand in. That must become `.srch:focus-within`.
- **Format radiogroup = 7 tab stops** (frame 4: stops 3–9). The README promises ←/→, which
  implies a roving tabindex: one stop (the checked radio, or the first if none is checked),
  arrows move *and* select. As drawn, a keyboard user tabs through seven chips to reach the set.
- **The gallery uses `aria-pressed` buttons (8 stops)**, while the chips use `role="radio"`, for
  the same single choice. Make the gallery a `role="radiogroup"` with
  `aria-labelledby` = the step-2 heading, each card a `role="radio"` with `aria-checked`, a roving
  tabindex, and arrow keys that wrap in the 4-across grid. Each card's accessible name is the
  format name (`aria-labelledby` → the `<b>`). Put the description and length in
  `aria-describedby`; don't put the whole card text in the name.
- **Goal chips** have no state at all (no `aria-pressed`), and their effect, highlighting a card,
  is silent. Add `aria-pressed` and an `aria-live="polite"` line ("Suggests Wavelength"). Better,
  remove them (see frame 1). Seven extra tab stops sit *before* the gallery.
- **"Not sure? Compare"** comes after the seven cards. Put the Compare entry point before the
  gallery so a novice meets it first.
- **Order in frame 1**: Help → Close → Title → … The Modal should send initial focus to the
  Title input, not the Help button, since focus lands at stop 0.
- **Set chooser (5a)**: after the search box, the next stop is "Keep the set I had" and then
  Cancel. **The table rows are not focusable.** The `↑↓ Enter` hint implies a combobox. Make the
  search a `role="combobox"` with `aria-controls` → the table as `role="grid"` (or a listbox),
  and drive rows with `aria-activedescendant`. Each row needs a name ("Ready or Not, 12
  questions, Engage, Strategy"), and the current set should carry `aria-current="true"` in
  addition to the ✓.
- **Ctrl+Enter**: announce it with `aria-keyshortcuts="Control+Enter"` on Create. Hide the
  `kbd` glyphs from the accessible name (`aria-hidden`), or the button reads "Create engagement
  Ctrl return".
- **Compare (2)**: "Back to the form" is reachable. Put focus on the "Compare the formats"
  heading when the view opens, and return it to the Compare link when the view closes.

### 3.4 Screen-reader labels and roles
- **Title field**: `aria-label="Title"` while the visible label is "Name it". This mismatches
  label-in-name (2.5.3), so voice control users saying "Name it" miss it. Use `<label for>` or
  `aria-labelledby` on the step heading, and `aria-describedby` on "The room sees this…".
- **Category toggles**: their names read "Architecture2". Add a visually hidden " questions"
  (or `aria-label="Architecture, 2 questions"`). Group them in
  `role="group" aria-labelledby` "Categories from this set". The live total ("5 of 8 categories ·
  10 questions") should be `aria-live="polite"`.
- **The side-pane stage and phone** (`.pv-stage`, `.pv-phone`) are **not** `aria-hidden`, unlike
  the gallery art. A screen reader reads out 9px fake content ("Join code 4821", "14 of 18
  answered", a typing field). Mark them `aria-hidden="true"` and keep the `.pv-cap` sentence as
  the accessible description. Change the "Preview · sample" word to be part of it.
- **Compare table**: has `th scope="col"` / `scope="row"`, which is good. The group row ("ONE
  ACTIVITY — …", "BIGGER — …") is a `td`. It should be `<th scope="colgroup">` with `<colgroup>`
  spans. Add a `<caption>` (visually hidden) "Seven formats compared". Each "Use …" button's name
  is unique, which is good.
- **Step state**: the green tick badges carry no text. Give each step heading a hidden suffix
  (", done" / ", required") so the "Ready" state is not only a colour and glyph.
- **Phone dialog** (`.ne.pm`) has `role="dialog"` with **no accessible name**. Every dialog needs
  `aria-modal="true"` and `aria-labelledby` → its `h1`. The real `Modal` supplies this; the
  mockup should not be copied as markup.
- **Loading categories**: `aria-busy="true"` is present, which is good. Add a live "Loading
  categories for Ready or Not" message, plus the failure line with Retry from the README.

### 3.5 Target sizes (measured minimum heights)
- Desktop: goal chips 28px, "I know these — show compact" link 20px, "Use …" buttons 32px,
  chips and categories 34px, icon buttons 36px. All clear WCAG 2.2 AA (24px). The 20px link
  passes only by spacing; give it `padding-block:4px`.
- **Phone (390)**: icon buttons 36×36, "Compare" link **57×20**, categories 34px tall, "Change"
  34px. These pass AA, but the shipped phone surfaces aim at 44px. On the sheet, raise
  categories, Change and the icon buttons to 44px and give Compare a 44px hit area.

### 3.6 Modal size changes and scroll containers
- **Size never changes**: confirmed. The card is 1240×850 at 1440×900, and 1230×670 at
  1280×720, in every frame including compare and chooser. The only change is the body grid going
  `solo`, and that change does not animate. This fixes the alignment bug's layout half. ✓
- **Two independent scroll regions** sit side by side (`.ne-form` and `.ne-side`, both
  `overflow:auto`). At 1280×720 both scroll in frames 1, 4, 5b, 9 and 11. The side pane's "What
  you're creating" checklist is below its fold (682px of content in 528px), so the confirmation
  a host would glance at is out of sight. Do one of these: make the side pane's preview shrink
  (`aspect-ratio` capped by `max-height: 32vh`) so the checklist fits, or make the checklist
  sticky at the bottom of the pane. Both regions need `tabindex="0"` plus a label if they can
  scroll and contain no focusable child, or keyboard users cannot scroll them (the side pane in
  frame 3 has one link; in frames 4–6 it has none).
- **Scrim**: the mockup scrim is `align-items:flex-start` with `margin:auto` on the card, which is
  correct per hard rule 10. It is `overflow:hidden` only because the frame is a picture. The
  product scrim must keep `overflow-y:auto` for viewports shorter than the card's minimum.
- **Compare**: the header (previews and names) scrolls away, so in the lower rows a user can't
  see which column is which. Make `thead` `position: sticky; top: 0` with the card ground, and
  move the "Use …" button into the header under each name so it is visible at 1280×720.

### 3.7 1280×720 laptop fit
| Frame | Foot and Create visible without page scroll? | Form visible / content | Side visible / content |
|---|---|---|---|
| 1 First time | **Yes** | 513 / 927 | 513 / 621 |
| 2 Compare | Yes | 528 / 723 ("Use" row hidden) | — |
| 3 Expert | Yes | 528 / 696 | 528 / 532 |
| 4 C&A | Yes | 528 / 720 | 528 / 682 |
| 5a Chooser | Yes | 528 / 736 (fourth set row and the hint are hidden) | — |
| 9 Ready | Yes | 528 / 675 | 528 / 669 |

The foot is pinned (`flex:none`) and Create is always on screen at 1280×720, 1366×768 and
1440×900. Nothing scrolls horizontally at any size, including the 390 phone frame (document
`scrollWidth` 390 = viewport). The cost is the body. The header (81px in frame 1 because of the
subtitle) plus the foot (74px) take 155px of a 720px laptop. Drop the subtitle in frame 1 (the
foot already says "3 things to decide") and trim the foot padding to 10px. That recovers about
30px. Removing the goal chips recovers about 70px more.

---

## 4. Concrete fixes, ranked by severity

**Blocker: fix before build starts**
1. **Motion with no pause (WCAG 2.2.2, Level A) and a wrong reduced-motion state.** Animate only
   the hovered, focused or chosen card and the side-pane stage. Every other preview rests in its
   end state. Write explicit end-state rules for Trivia, Survey and Call & Answer, and cover
   `.cat.sk` in the media query. Previews in the Compare table head are always still.
2. **No focus style, and the search input has `outline:none`.** Add one `:focus-visible` ring
   token for the scope (2px `--gsd-secondary`, 2px offset) and use `:focus-within` on `.srch`.
3. **The set chooser rows are unreachable by keyboard.** Use a combobox → grid/listbox with
   `aria-activedescendant`, named rows, and `aria-current` on the current set.

**High: AA failures**
4. **Selection by colour alone** on format chips (1.06:1 difference), gallery cards and the
   Compare column. Add the tick the category toggles already use, plus "Chosen" text.
5. **Text dimmed with `opacity`**: step 3 at 2.87–4.27, `kbd` at 3.99. Use `--gsd-muted` and
   `aria-disabled`, and set `kbd` to opacity 1.
6. **One format choice, two widget models.** Make the gallery and the chips both
   `role="radiogroup"` with a roving tabindex: one tab stop, arrows select. The gallery card's
   name is the format name, with the rest as its description.
7. **Below-floor type**: 11.5px tags and group heads. Use 12px minimum; 12.5 → 13.
8. **Unlabelled or mis-labelled things**: the Title's label-in-name, the category counts
   ("Architecture2"), the phone dialog with no name, the preview stage read aloud (mark it
   `aria-hidden`), the `kbd` glyphs inside Create's name (use `aria-keyshortcuts`).

**Medium: hierarchy and fit**
9. **Frame 1 shows the formats three times and draws a card in hover that reads as selected.**
   Fold the goals into the cards and delete the chip rows, then render frame 1 with no card
   highlighted.
10. **The side checklist repeats facts visible in the form** (hard rule 5: title, set, category
    count). On desktop, show only status ticks plus what the form does *not* show (briefing
    source, non-default Advanced), and keep "What happens next". At 1280×720, make the checklist
    sticky or shrink the preview so it is above the fold.
11. **Compare at 1280×720**: sticky `thead`, the "Use …" button in the header, and a fix for
    the grey-brown composite on the chosen column.
12. **Paper theme**: a `.gsd--onlight` re-tint block, not `[data-theme]`. The done-tick fill
    must be `#1F7A52` (2.61 → 5.30). Confirm the dialog ever renders on paper before building
    this.

**Low: polish**
13. Collapse the dashed-border meanings to "placeholder" only. Unnumber the hand-off tiles. Use
    `StatusMessage` for the cleared-picks note.
14. Phone targets: 44px for categories, Change, the icon buttons and Compare. Add a fade or
    "more below" cue where the category row meets the foot.
15. Add `title=` to the truncated set name. Remove the unused `transform` transition on `.fmt`.
16. Add the new ground, the chip wash, the paper amber, the focus ring and the step-later
    colour to `gameSetupPalette.test.js`, composited. Assert that no declaration under `.gsd`
    uses `opacity` on a text-bearing selector, and that the ladder has nothing under 12px.
