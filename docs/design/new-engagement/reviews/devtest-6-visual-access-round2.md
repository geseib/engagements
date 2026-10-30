# Live dev test 6: visual and accessibility, round 2

*30 Oct 2026. Re-test of every finding in `devtest-3-visual-access.md` on
https://engage.dev.seibtribe.us. The served bundle was checked as `main.ebacfad4.js` (commit
`4e00af67b`). I used the same QA host account, and the method was unchanged from round 1:*

- *Playwright and Chromium at 1440×900, 1366×768, 1280×720 and 390×844, plus a 1440 run with
  `prefers-reduced-motion: reduce` emulated;*
- *composited contrast for every visible text node;*
- *focus rings read once transitions had settled;*
- *axe-core 4.14;*
- *`getAnimations()` for motion.*

*Read-only. Every dialog was opened and then left by Cancel, X or Discard, and nothing was
created. The newcomer view came from my browser alone, which answered `GET /games` with an
empty list. Scripts (`r2*.js`) and screenshots (`r2-*`) are in
`/tmp/claude-0/-home-user-engagements/5d28207d-9725-5ad9-936c-89dd5e908516/scratchpad/ux/devtest-a11y/`.*

**Verdict.** 19 of the 26 IDs are fixed and 3 are partly fixed. Three remain open, or are a
deliberate choice: H4 (focus on close), L5 and L6. One newly found:

- **"Your sessions" at 390px is unusable.** The fix for the paint leak works on a laptop, but the
  table is squeezed into 350px.

Three new lower-severity issues are listed below. All four viewports and the reduced-motion run
show:

- 0 contrast failures;
- 0 text under 12px;
- 0 horizontal page scroll;
- Create always on screen.

---

## Status by ID

| ID | Round 1 | Round 2 | Evidence |
|---|---|---|---|
| **H1** | "Topics refreshed" note 1.02:1 | **Fixed.** Text on `rgba(124,167,230,.14)` measures **9.75:1** at every size. | `r2-1440-09-refreshed.png`, `r2-1440-f-note.png` |
| **H2** | 390 Create 56×70, clipped | **Fixed.** Cancel and Create are each **175×46**, full-width halves, and the label is "Create". The head is one line. The formats fold behind "Wavelength, Survey, Build Room, Event ▾". | `r2-390-01-empty.png` |
| **H3** | ↓ on a chooser row committed a set | **Fixed.** The search is a `combobox` (`aria-expanded`, `aria-controls="gsd-set-list"` present in the DOM, `aria-activedescendant`). ↓↓ moves the highlight, and the highlighted row is drawn with the ring. ↓ on a row radio keeps the chooser open. Enter commits, and focus lands on **Change**. Rows are out of the Tab order. Same at all sizes. | `r2-1440-06b-chooser-arrow.png` |
| **H4** | Focus to `<body>` in 5 places | **4 of 5 fixed.** Compare opens on its heading. Esc/Back return focus to "Format guide". "Use Trivia" focuses Trivia. Esc in the chooser and Enter-commit both focus Change. **Still open: closing the dialog** by X → Discard, Cancel → Discard, or a clean Cancel leaves focus on `<body>` at all four sizes. The opener `.wel-action.is-primary` is not refocused. | `r2-extra.js` output |
| **H5** | Off topic under the pointer 1.06:1 | **Fixed.** Background is `transparent` with text `#F4EDE4` on the card (12.5:1). | `r2-1440-f-topic-off-hover.png` |
| **H6** | Help ring invisible, icon 2.37:1 | **Fixed.** The icon is `#A9B5C9` (7.0:1) and the ring is 2px `#7CA7E6`. | `r2-1440-f-help.png` |
| **M1** | Disabled Create 3.5:1 (opacity .6); 1.27:1 fade | **Fixed.** Opacity is 1 and the label measures ≥7.0:1 (13.7 at 1440). No fade was caught at 40ms in "Loading topics…" at any size. | `r2-1440-09b-changing.png` |
| **M2** | Reduced motion did not stop the Trivia preview | **Fixed.** Under `reduce`, hovering a card gives **0** animations (`gsd-fp-right` with no reduce). At rest 0, none infinite. | `r2-rm.log` |
| **M3** | Mixed rings (1px amber field border, amber link rings) | **Fixed.** Every stop in the 14-stop Tab cycle has 2px `#7CA7E6`, including the title field and links. The search wrapper gets the ring through `:focus-within`. | `r2-1440-f-title.png`, `r2-1440-f-link1.png` |
| **M4** | Layout drift; step 3 below the fold at 1440 | **Partly fixed.** Meeting chips fit one row. The format chips fit one row at 1440 and 1280, and in compact at 880. Topics are inline chips (36px, 44px on the phone) with the count after the name. Cards are 182px, down from 249. **Still:** the head is 90px with its subtitle, and at 1440 step 3 "Questions" shows only its top ~8px above the foot (y≈795). | `r2-1440-01-empty.png` |
| **M5** | Side preview cropped (1440) or collapsed (1280) | **Partly fixed.** At 1280 and 1366 the whole side pane now scrolls (509/727), and the art and caption are fully visible. At 1440 the preview region is 291/329, so the caption "Room: answers appear… Names are" is cut by the pinned summary. Also new: at 1280 the checklist is no longer pinned, so "Advanced" and "What happens next" sit below the side pane's fold (README principle 5 said pinned). | `r2-1280-09-refreshed.png`, `r2-1440-09-refreshed.png` |
| **M6** | Sticky head bleeds; two primaries | **Fixed.** `thead th` is on the card colour, with nothing showing above the head. "Use Call & Answer" is an outlined amber button with "✓ Chosen" above it, so Create is the only filled primary. *Residual (Low):* the C&A and Event preview art is clipped top and bottom inside its own tile ("9"/"2", "09:00"/"09:45" half cut), unscrolled too. | `r2-1440-05-compare.png` |
| **M7** | Disabled "Room screen" looked pressed | **Fixed.** Disabled, both tabs are dashed. Enabled after a pick, Room screen is solid and pressed. | `r2-1440-01-empty.png` |
| **L1** | `aria-controls` named a missing id | **Fixed.** It is only set while the list is rendered. axe is clean in the no-match state. | |
| **L2** | ↓ in the gallery moved linearly | **Fixed.** ↓ from Trivia lands on Build Room, the next row in the same column. | |
| **L3** | 21px text links, 16px "See plans" | **Fixed.** Links are 29px tall and "See plans" no longer flags. No target is under 24px apart from 18px checkboxes, which have labels. | |
| **L4** | "match Search “zzzq”", wrapped exit | **Fixed.** It now reads "No Call & Answer sets match “zzzq”", with the exit on one line. | `r2-1440-07-nomatch.png` |
| **L5** | Decorative icons exposed as unnamed `img` | **Still present.** 13 unnamed `img` in the empty state and 4 in the chooser. | `r2-aria-empty.txt` |
| **L6** | Set-row meta 4.64:1; "Engage", "Unfiled" | **Partly fixed.** Now **5.38:1**. The badge still reads "Engage" (not "Ready-made"). The chooser's Topic column and filter still say "Unfiled". | `r2-1440-06-chooser.png` |
| **V1** | Phone layout | **Fixed** (frame 10): stacked cards, More fold, one-line head, 44px topics. *Low:* at 390 the format chips wrap to 2 rows (frame 10b draws one segmented row with "More ▾"). | `r2-390-13-compact.png` |
| **V2** | Chips wrap at 1440 | **Fixed** | |
| **V3** | Topic chips stretched | **Fixed** | |
| **V5** | Faint help icon | **Fixed** (H6) | |
| **V6** | Preview clipped at 900 | **Partly fixed** (M5, caption still cut at 1440) | |
| **V7** | Two primaries in Compare | **Fixed** (M6) | |
| **V8** | "Chosen" over the art | **Fixed.** It sits in the card's name row. | |

---

## New issues

| # | Severity | Finding | Measurement | Fix |
|---|---|---|---|---|
| N1 | **High (phone)** | **"Your sessions" at 390×844 is unusable.** The table keeps all eight columns in 350px. Titles show as "UX QA …", codes as "7", "9", "2", "1", and type and state as icon fragments. The action buttons are clipped to "Edi", "Sta", "Lin" and "Invite". | 16 action labels flagged `scrollWidth > clientWidth`. The search field is about 75px wide, with its placeholder cut to "Title,". | Under 600px, render one card per session (title, code, state, then Edit/Start as 44px full-width buttons). Or hide Players, Rounds, Created and Last played and give the actions their own row. Screens: `r2-390-sessions.png`. |
| N2 | Medium | **"Your sessions" is not a dialog.** It has no `role="dialog"` or `aria-modal`, focus stays on `<body>` when it opens, and **Esc does not close it**. axe flags 35 `region` nodes and one empty `th` (the actions column). | `r2-extra.js`: inDialog false, focus BODY, Esc closes = false | Mount it through the shared `Modal` (Escape, focus trap, focus restore, label from "Your sessions"). Give the actions column a visually hidden "Actions". |
| N3 | Low | **"Your sessions" truncates with no recovery** (hard rule 7). Titles ("UX QA — Round 2 speed ru…"), "Set: Workplace Scenarios for Dis…" and the Created date ("Oct 30, 20…") are cut at 1440. Only one `title=` exists in the panel. | `r2-1440-sessions.png` | Add `title=` with the full string on each truncating cell. Use a shorter date format ("30 Oct") so Created fits. |
| N4 | Low | The chooser's scrolling list (`div.schs-list`) is a Tab stop. It gets Chrome's default `auto` ring (thin white/black) instead of the scope's 2px `#7CA7E6`. | `r2-1440-f-chooser-region.png` | Add `.schs-list` to the scope's `:focus-visible` ring, or give it `tabIndex=-1` if keyboard users are meant to scroll it through the combobox. |

The paint fix on "Your sessions" holds on a laptop. The title measures 14.97:1, every text is
≥7.24:1, there is no white frame, the corners are clean dusk, the Players/Rounds/Type heads are
whole, set names are readable rather than raw ids, and no "host Host" appears.

---

## Still to do, in order

1. **N1:** a phone layout for "Your sessions".
2. **H4 remainder:** focus back to the opener on close.
3. **N2:** "Your sessions" through `Modal`.
4. **M5 and M4 residue:** the 1440 caption, the pinned checklist at 720, and step 3 above the fold at 1440 (drop the subtitle or trim the head).
5. **N3, N4, L5, L6, and the M6 art clip.**
