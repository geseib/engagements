# Live dev test 3: visual and accessibility

*30 Oct 2026. Tested live on https://engage.dev.seibtribe.us (dev at `79fbdadb7`) with the QA
host account. I worked as a senior visual designer and accessibility tester, from the
`engage-design` skill. The checks ran in Playwright on Chromium at 1440×900, 1366×768,
1280×720 and 390×844. Each viewport had a normal run, and 1440 also had a run with
`prefers-reduced-motion: reduce` emulated.*

*How the numbers were taken. Contrast was computed for every visible text node in the dialog,
with alpha and `opacity` composited up the ancestor chain. axe-core 4.14 ran on each state.
Focus was read from computed `outline`/`border` once transitions had settled. Target sizes
come from `getBoundingClientRect`. Motion comes from `document.getAnimations()`.*

*Read-only. No session was created, edited or deleted. Every open ended with Cancel/X →
Discard. The account has history, so to get the newcomer view my browser alone answered
`GET /games` with an empty list (`page.route`). The server was never touched. The scripts and
every screenshot are in
`/tmp/claude-0/-home-user-engagements/5d28207d-9725-5ad9-936c-89dd5e908516/scratchpad/ux/devtest-a11y/`,
and screenshot names below are relative to that folder. The raw measurements are the
`m-<viewport>-<state>.json` files there.*

**Light theme.** The site does not offer one for this dialog. No stylesheet under `src/src`
reads `prefers-color-scheme`, and `.gsd` is scoped to dusk tokens. Emulating a light scheme
changes nothing, so only dusk was tested.

---

## Verdict

The structure from the spec is in the build and holds up:

- a fixed-size dialog, 1240×860 / 1240×728 / 1232×680, with compact at 880;
- the foot pinned at every laptop size;
- one format radiogroup;
- ticks plus "Chosen" on the selection;
- named topics, and a compare table with a caption;
- previews that play once;
- nothing under 12px;
- no horizontal page scroll.

Round 1's two reported faults are both still live:

- **The "Topics refreshed" note measures 1.02:1.**
- **Create at 390 is 56px wide and clipped.**

There are three new problems this pass found:

- arrow keys in the set chooser commit a set and close it;
- focus drops to `<body>` in five places;
- the help button's focus ring is the same colour as the card.

Three faults share one cause: global paper-era rules in `styles.css` leak into `.gsd`. They are
the white note, the white hover on an off topic, and the 0.6 opacity on disabled Create. One
palette-test pattern would catch all three.

---

## Findings, ranked

### High (AA failures or broken keyboard paths)

| # | Finding | Measurement | Element | Screens | Fix |
|---|---|---|---|---|---|
| H1 | **The "Topics refreshed" note is unreadable** (round 1 B1, confirmed at all four sizes). | Text `#F4EDE4` on `rgb(240,240,240)` = **1.02:1**. axe `color-contrast` (serious). It stays on screen after the topics load, and in compact mode. | `div.status-message.gsd-cleared.pending` (`role=status`, polite, which is correct) | `1440-09-topics-refreshed.png`, `1440-f-cleared-note.png`, `1280-09-topics-refreshed.png`, `390-13-compact-ready.png` | `GameSetupDialog.css:579` sets only `color`. The global `.status-message.pending` paper background wins. Scope it: `.gsd .status-message { background: rgb(var(--info-rgb) / .12); border: 1px solid rgb(var(--info-rgb) / .35); color: var(--gsd-text); }` (text about 11:1), or render it through `StatusMessage` with dusk tone tokens. Add a composited assertion for `.gsd-cleared` to `gameSetupPalette.test.js`. |
| H2 | **Create is clipped at 390** (round 1 B2, confirmed). | Create is **56×70**. The label wraps to "Create / gageme". The foot keeps one row: a 2-line lock note, Cancel 89×46, Create 56×70. The header also wraps to two lines ("New / engagement") and keeps its subtitle. | `.gsd .dialog-actions .btn-primary` | `390-01-empty.png`, `390-08-set-topics.png` | The phone rule at `GameSetupDialog.css:1752-1760` is not taking effect. Under 480px: `.gsd .dialog-actions { flex-wrap: wrap }`, the foot note at `flex: 1 0 100%`, both buttons `flex: 1 1 0; min-height: 44px`. Drop the subtitle on the phone and set the title at 19px. |
| H3 | **Arrow keys in the set chooser pick a set.** The rows are native radios, so ↓ on a row fires `change`. The next set is committed, the chooser closes and focus goes to `<body>`. A keyboard user cannot look through 15 sets. | Measured at 1440, 1366 and 1280 alike: "ArrowDown on row radio PICKED a set and closed the chooser". The search box is a plain `textbox`, not a combobox, and it has no `aria-activedescendant`. | `SetChooser` table rows (`input[type=radio]`, 13×13) | `1440-06b-row-focus.png`, `1440-06-chooser.png` | Build what README §8 specifies: the search as `role="combobox"` with `aria-controls` pointing to the list, rows as `role="option"` driven by `aria-activedescendant`, and **commit on Enter or click only**. If the radios stay, select on Space/Enter, not on `change` from arrows (WCAG 3.2.2, 2.1.1). |
| H4 | **Focus is lost to `<body>`** in five places. A screen-reader user is dropped at the top of the page. | `document.activeElement` = BODY after: (1) "Compare side by side"; (2) Esc or "Back to the form" in Compare; (3) the second Esc in the chooser (keep set); (4) a keyboard pick in the chooser; (5) closing the dialog: the trigger `.wel-action.is-primary` is not refocused. Same at all sizes. | Compare view, chooser, Modal focus restore | `1440-05-compare.png`, `1440-07b-after-esc2.png` | Compare: focus the "Compare the formats" heading (`tabIndex=-1`) on open, and return focus to the Compare link on close (the review asked for this in §3.3). Chooser close: focus "Change" on the folded set row. Modal: keep a ref to the opener and restore focus to it. If it re-rendered, look it up again by role and name. |
| H5 | **An off topic under the pointer turns white with white text.** | `#F4EDE4` on `#F0F4FF` = **1.06:1** for the name. Count 1.42:1, dash 1.88:1. This happens straight after switching a topic off, while the pointer is still over it. | `.gsd .category-button[aria-pressed=false]:hover` (the global `.category-button:hover` leaks in) | `1440-g-topic-off-hover.png`, `1440-f-topics.png` | `.gsd .category-button:hover:not([aria-pressed="true"]) { background: rgb(var(--slate-rgb) / .10); }`. Make the palette test assert that every global `.category-button` and `.status-message` state has a `.gsd` override. |
| H6 | **The help "?" button has an invisible focus ring and a sub-3:1 icon.** | Settled ring: `2px solid rgb(27,41,66)`, which is the card colour, so **1.0:1**. Icon `rgb(94,97,103)` on the card = **2.37:1** (needs 3:1, WCAG 1.4.11). Round 1 V5 ("very faint") is the same element. | `.help-button.help-button-quiet` in the header | `1440-g-help.png`, `focus-sheet.png` | `.gsd .help-button { color: var(--gsd-muted); }` gives 7.0:1. Add `.gsd .help-button:focus-visible { outline: 2px solid var(--gsd-focus); outline-offset: 2px; }`. |

### Medium (spec promises broken, or visible drift)

| # | Finding | Measurement | Element | Screens | Fix |
|---|---|---|---|---|---|
| M1 | **Disabled primary is dimmed with opacity**, against README §3.8 ("never dimmed with opacity"). While a set changes, it also fades from amber. | The label measures **3.5:1** (op 0.6), not the promised 7.0. In the first ~300ms of "Loading topics…" it measures **1.27:1** at 1440, 1.66 at 1280 and 1.12 at 390 (round 1 B12). This applies to Create, "Loading topics…" and "Continue to the event". | `.btn-primary:disabled { opacity: .6 }` at `styles.css:121-122` leaks in. `GameSetupDialog.css:1415` never resets it. | `1440-01-empty.png`, `1440-09b-changing.png`, `1440-11-event.png` | Add `opacity: 1; transition: none;` to `.gsd .btn-primary:disabled`, and assert opacity 1 in the palette test. Disabled text is exempt under 1.4.3, but it is the most important word on the screen and the spec promised 7.0. |
| M2 | **Reduced motion does not stop the Trivia preview.** | With `reduce` emulated, hovering the Trivia card still runs `gsd-fp-right` (1.6s). The C tile is mid-fade at 300ms. | `@media (prefers-reduced-motion) { .gsd .gsd-fp * { animation: none } }` is specificity 0,2,0. It loses to `.gsd .gsd-fp.is-play .gsd-fp-opt.is-right` at 0,5,0 (`GameSetupDialog.css:1611, 1655-1658`). The other `is-play` rules lose the same way. | `1440rm-01b-hover-300ms.png` | Use `.gsd .gsd-fp.is-play *, .gsd .gsd-fp * { animation: none; }` inside the query, or do not add `is-play` when `matchMedia('(prefers-reduced-motion: reduce)')` matches. Extend the CSS-contract test to compare selector specificity. *Otherwise the motion is right:* 0 animations at rest, none infinite, one on hover, finished in under 2s, and base styles are the end states. |
| M3 | **There is not one focus ring.** | The title input and fields show only a 1px amber border change (`outline: none`), not the 2px ring the mockup draws. `.gsd-btn--link` (Compare, Format guide, I know these) and the Advanced summary use an **amber** 2px ring. Everything else uses periwinkle. | `.gsd .dialog-input:focus { outline: none }` (0,3,0) beats `.gsd input:focus-visible` (`:291-295`). `.gsd .gsd-btn:focus-visible` (`:1037`) and `.gsd-adv > summary:focus-visible` (`:1245`) use `--gsd-primary`. | `1440-g-title.png`, `focus-sheet.png` | Delete `outline: none` and keep the border change as an extra. Point both amber rules at `var(--gsd-focus)`. |
| M4 | **The layout drifts from frames 1 and 4.** Step 3 is not visible on the first screen at 1440, which breaks README principle 2. | Header **98px** (frame 1: 78). Card art **92px** (frame: 58), so the second row of cards is cut at y=800 and "Questions" is below the fold. Meeting chips wrap "Offsite day" alone. Format chips wrap **"Event" alone** in full and compact (880) layouts (round 1 V2). Topic chips stretch 4–5 per row, 45px tall, with names on two lines and "(2)" pushed to the right (frame 4 draws inline "Architecture 2"; round 1 V3). | `.gsd-head`, `.gsd-fmt--gallery` art, `.gsd-fmt` chip row, `SessionCategories` grid | `1440-01-empty.png` vs `01-first-time.png`; `1440-09-topics-refreshed.png` vs `04-call-and-answer.png`; `a01-compact-1440.png` | Art at `height: 58px`. Chip gap 6px and padding 12px, so seven chips fit on one row at 762px, or use `flex-wrap: nowrap; overflow-x: auto` with a fade. Topics as `display: flex; flex-wrap: wrap` with `flex: 0 0 auto` chips and the count inline (`.category-count` without parentheses). |
| M5 | **The side-pane preview is cropped or collapsed** (round 1 V6 and B9). | 1440 C&A: the preview region is 283px tall for 365px of content, so the bottom of the stage is cut by the pinned summary. 1280: 103px of 365, so only the caption shows. | `.gsd-side-pv` | `1440-04-format-chosen.png`, `1280-08-set-topics.png` | Cap the art (`max-height: 32vh; aspect-ratio: 16/9`) so it scales instead of being cropped. Below 760px tall, put the caption under the art and let the summary scroll. |
| M6 | **Compare: the sticky head bleeds and there are two primaries** (round 1 B10 and V7). | Row text shows above the sticky head ("round.", "otherwise.") and the C&A/Event art is clipped at the top. "Use Call & Answer" is filled amber while Create is also amber. | `.gsd-compare-scroll thead` | `1440-05b-compare-scrolled.png` | Give `thead th` `background: var(--gsd-card); top: 0` and remove the padding-top gap on the scroller. Make the chosen column's button the outlined `.btn-secondary` with its tick. |
| M7 | **The disabled "Room screen" toggle looks pressed** (round 1 B11). | `disabled` with `aria-pressed=true`, drawn with a bright 2px periwinkle border while Phones and Replay are dashed. | `.gsd-pv-tab` | `1440-01-empty.png` | When disabled, use `border-style: dashed; color: var(--gsd-muted)` whatever the pressed state. |

### Low (polish)

| # | Finding | Measurement / element | Screens | Fix |
|---|---|---|---|---|
| L1 | `aria-controls="gsd-set-list"` points at an id that is not rendered (no-match state). | axe `aria-valid-attr-value` (critical rule, little practical effect). `#gsd-set-search` | `1440-07-no-results.png` | Set it only while the list is in the DOM. |
| L2 | In the 4-across gallery, ↓ moves to the next card (Trivia → Poll), not down a row. | FormatPicker key handler | `1440-03b-radio-arrowed.png` | ↑/↓ by the column count, ←/→ by one, wrapping. The visual review asked for this. |
| L3 | Text links are 21px tall: Compare side by side, I know these, Your question sets, Make a new set, Edit (24×21), Clear all. "See plans" is **60×16**. The chooser radios are 13×13, but the 52px row is clickable. | They pass 2.5.8 only by spacing. | `1440-11-event.png` | `padding-block: 4px` on `.gsd-btn--link`, `.gsd-setlink`, `.schs-link` and the plan link (the review's §3.5 asked for this). |
| L4 | No-match copy (round 1 C8, still there): "No Call & Answer sets match **Search** “zzzq”", and "Clear the search / “zzzq”" wraps with "15 / sets" stacked. | `SetChooser` empty state | `1440-07-no-results.png` | Drop the chip label from the sentence. Keep the button to one line (`white-space: nowrap`, count after the label). |
| L5 | Decorative Phosphor icons are exposed as unnamed `img`: 13 in the empty state, plus the compare headers and chips. | `Icon` | `aria-empty.txt`, `aria-compare.txt` | `aria-hidden="true"` by default on `Icon` when it has no `title` or `label`. |
| L6 | Set-row metadata uses the site `#9BA8BE`, not `--gsd-muted`, on the amber-washed row: **4.64:1**, the narrowest passing pair in the dialog. The badge still reads "Engage", with "Unfiled" (round 1 C1). | `.schs-dim`, `.schs-own` | `1440-09-topics-refreshed.png` | Use `--gsd-muted` (7.0 on the card) and the "Ready-made" label from README §9. |

---

## What passes (measured)

| Check | Result |
|---|---|
| Text contrast | Everything other than H1, H5 and M1 clears AA. The lowest are 4.64 (L6), 4.81 ("See plans") and 5.16 (Discard on `--danger-deep`). Links are 5.91, muted 7.0, "Chosen" amber on the wash 5.92. |
| No text under 12px | **0 nodes** below 12px, in every state at every viewport. The stage art is `aria-hidden`. |
| No horizontal scroll | Document `scrollWidth` equals the viewport everywhere. At 390, Compare scrolls inside its own region (980/358), as intended. |
| Create visible without page scroll | Yes at 1440 (y=815), 1366 (683) and 1280 (635), in every state including chooser, compare, hand-offs and the discard bar. At 390 it is on screen but clipped (H2). |
| Dialog never resizes | 1240×860 / 1240×728 / 1232×680 in every state. Compact is 880 wide. |
| Tab trapped, order sensible | A 14-stop cycle: Help → Close → Title → Compare → I know these → 7 meeting chips → format radio → Cancel. Shift+Tab from the title goes to Close. Focus starts in the title. |
| Format = one radiogroup | `radiogroup "Pick a format"`, tabindex `[0,-1,-1,-1,-1,-1,-1]`, arrows move and select. Card names are the format alone ("Call & Answer"), with the description in `aria-describedby`. Compact chips use the same group. |
| Selection not by colour alone | Cards: tick, "Chosen" and 2px amber border. Chips: leading tick. Topics: ✓ / – glyph plus `aria-pressed`. Compare: "✓ Suggested for a retro" in words. Meeting chip: tick plus `aria-pressed`. |
| Screen-reader names | Topics read "Culture, 1 question" in `group "Topics in this set"`, with a live total "7 of 8 topics · 11 questions" (polite). Compare has a `caption`, `th scope=colgroup` ×2, `th scope=row` ×6 and `table-layout: fixed`. Previews are `aria-hidden` with a caption. Create has `aria-keyshortcuts="Meta+Enter Control+Enter"` and its kbd is `aria-hidden`. The discard foot is `role=alertdialog`, labelled. |
| Esc | With work: the discard bar opens, focus goes to Keep editing, and a second Esc dismisses it (focus to Cancel). The X with work opens the same bar. In the chooser, the first Esc clears the search and the second keeps the set, without reaching the modal: **round 1 B5 is fixed**. |
| Motion | 0 animations at rest, none infinite, one single-play animation on hover/choose, finished in under 2s. The skeletons are still. Only the reduced-motion specificity is wrong (M2). |
| axe-core 4.14 | Clean in the empty, format-chosen, compare, chooser, set-and-topics, Build Room, Event and discard states. It flagged only H1 (contrast) and L1. |

## Round-1 findings re-checked

| Round 1 | Now |
|---|---|
| B1 unreadable "Topics refreshed" note | **Still present**: 1.02:1 (H1) |
| B2 390 Create cut off | **Still present**: 56×70, "Create / gageme" (H2) |
| B5 Esc in search opens discard | Fixed |
| B9 preview collapses at 1280 | Still present (M5) |
| B10 Compare sticky head bleeds | Still present (M6) |
| B11 disabled Room screen looks pressed | Still present (M7) |
| B12 amber fade on "Loading topics…" | Still present: 1.27:1 for ~300ms (M1) |
| V2, V3 chips wrap / topics stretch | Still present (M4) |
| V5 faint help icon | Still present, plus an invisible focus ring (H6) |
| V7 two primaries in Compare | Still present (M6) |

## Fix order

1. H1 and H5 and M1 together, because they are one cause: scope the three global states under
   `.gsd`, then add one palette-test block that walks every global class `.gsd` mounts
   (`.status-message`, `.category-button`, `.btn-primary`) in every state.
2. H3 and H4: the chooser keyboard model and focus management.
3. H2: the phone foot.
4. H6 and M3: one ring, everywhere.
5. M2: reduced-motion specificity.
6. M4 to M7: layout fidelity against frames 1, 4 and 12a.
