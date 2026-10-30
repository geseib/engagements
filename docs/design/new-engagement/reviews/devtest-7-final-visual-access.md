# Live dev test 7: final visual and accessibility pass

*30 Oct 2026. The final re-test of `devtest-6-visual-access-round2.md`, on
https://engage.dev.seibtribe.us. The served bundle was checked as `main.4157b825.js` (commit
`5c7d3a28b`). I used the same QA host account and the same method as rounds 1 and 2:*

- *Playwright and Chromium at 1440×900, 1366×768, 1280×720 and 390×844, plus a 1440 run with
  `prefers-reduced-motion: reduce` emulated;*
- *composited contrast for every visible text node;*
- *focus rings read once transitions had settled;*
- *axe-core 4.14;*
- *`getAnimations()` for motion.*

*Read-only. The New engagement dialog was only opened and left, and "Your sessions" was only
opened and closed with Esc. Nothing was created or edited. For the newcomer runs my browser
alone answered `GET /games` with an empty list. "Your sessions" was measured against the real
list (5 sessions) in a separate run without that mock. Scripts (`r3*.js`) and screenshots
(`r3-*`) are in
`/tmp/claude-0/-home-user-engagements/5d28207d-9725-5ad9-936c-89dd5e908516/scratchpad/ux/devtest-a11y/`.*

**Verdict.** Every round-2 item is fixed, including all of round 1's Highs. There is no High
open.

The pass found **one new Medium**: Discard does not discard the title. The Discard bar says
"what you filled in is lost", but the title comes back the next time the dialog opens.
Everything else is Low polish. axe-core is clean in every state, "Your sessions" included.

---

## Round-2 items

| ID | Status | Measurement | Evidence |
|---|---|---|---|
| **H4** focus return on close | **Fixed** | After ×, Cancel, Esc, Esc → Discard and × → Discard (dirty), focus is on the opener `button.wel-action.is-primary` "Create engagement" at all four sizes. After a keyboard close (Esc) it shows `:focus-visible` with its 3px amber ring. After a pointer close the ring is correctly absent. | `r3x-*.log`, `r3p-*.log` |
| **M4** step 3 visible at 1440×900 | **Fixed** | The "3 Questions" heading sits at y 734–758, above the foot at 800, with its line of text under it. With a format chosen, "Question set" is at 761–785. It is still below the fold at 1366 and 1280, which was not required. | `r3-1440-x-empty.png` |
| **M5 / V6** caption and pinned checklist at 1280×720 | **Fixed** | The caption now sits above the picture (y 172–210) and is always visible. The checklist (Three decisions / Your choices, What happens next) stays pinned at y 241–602 while the side pane scrolls (515/727), so the preview picture slides behind it, as README principle 5 asks. At 1440 the side pane fits (695/695). | `r3-1280-x-format.png` |
| **L5** decorative icons hidden | **Fixed** | 0 of 26 SVGs are exposed (0 of 23 on the phone). | |
| **L6** chooser badges | **Fixed** | The column head reads "Whose" and the badge "Ready-made" ×15. "Engage" appears 0 times and "Unfiled" 0 times. Set-row meta is 5.38:1. | `r3-1440-x-chooser.png` |
| **N1** Your sessions at 390 | **Fixed** | Stacked cards: title, set, then code, type and state. Edit, Start, Link and Invite are each **153×44**. Search and Type are full width. No clipping, no horizontal scroll. | `r3-390-sessions-real.png` |
| **N2** Your sessions as a dialog | **Fixed** | `role=dialog`, `aria-modal=true`, named "Your sessions". Focus opens on the `h2`. Tab stays inside. **Esc closes it**, and focus returns to "Sessions" with a visible ring. axe is clean (the round-2 `region` and empty-`th` findings are gone). | `r3x-*.log` |
| **N3** truncation titles | **Fixed** | 41 `title=` attributes, carrying the full title, set name and date. 0 ellipsised nodes without one. | `r3-1440-sessions-real.png` |
| **N4** chooser list focus ring | **Fixed** | `div.schs-list` gets 2px `#7CA7E6` at all sizes. | `r3-1440-f-list.png` |
| **Compare art fit / "Use this" on phone** | **Fixed** | 0 art elements overflow their tile. At 390 each button reads "Use this", with `aria-label="Use Call & Answer"` etc., at 78×44. | `r3-1440-x-compare.png` |

## Regression sweep (round-1 Highs, contrast, motion)

| Check | 1440 | 1366 | 1280 | 390 | 1440 reduce |
|---|---|---|---|---|---|
| H1 "Topics refreshed" note | 9.75:1 | same | same | same | same |
| H2 phone foot | — | — | — | Cancel/Create 175×46 | — |
| H3 chooser keyboard | combobox; ↓ moves, Enter commits, focus → Change | same | same | same | same |
| H5 off topic under pointer | transparent, 12.5:1 | | | | |
| H6 help "?" | 7.0:1, 2px blue ring | | | | |
| Lowest text contrast | 4.81 ("See plans") | 4.81 | 4.81 | 5.07 | 4.81 |
| Contrast failures / text <12px | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| Horizontal page scroll | none | none | none | none (Compare scrolls inside its own region) | none |
| Create on screen | y 815 | 683 | 635 | 786 | 815 |
| Motion | 0 at rest, 1 single-play on hover, 0 infinite | same | same | none | **0** on hover |
| axe-core | clean in every state | | | | |

---

## New

| # | Severity | Finding | Fix |
|---|---|---|---|
| R1 | **Medium** | **Discard keeps the title.** Steps: type "probe — not saved", press × (or Esc), then Discard. The bar says "Nothing has been created yet, and what you filled in is lost". Reopen New engagement and the title field still holds "probe — not saved", ticked as done. The format and set are cleared, so only the title survives. The cause: in create mode the title is the page's `eventTitle` (`GameSetupDialog.jsx:286`, `GameHostPage.jsx:1093`), which Discard never resets. Same at every size. | On Discard in create mode, call `setEventTitle('')`. Or, if keeping a draft title is wanted, change the bar's sentence and show "Draft kept" in the field. Add a test for the Discard → reopen cycle. (`r3p-1440.log`, `r3-1440-x-empty.png`) |
| R2 | Low | "Your sessions" focus styles are mixed. The header help, ×, search and Type select fall back to Chrome's default `auto` ring, while the row buttons use a 2px amber ring. The `h2` opens with a wide 1px light box around it that reads like an input. | Use one ring in `.shist` (2px `--secondary`, as the dialog uses). Give the `tabIndex=-1` title `outline: none` and announce it through the dialog name instead. |
| R3 | Low | At 1366 and 1280 step 3 is still below the fold on first open (M4 asked only for 1440). | Optional: drop the subtitle under 800px tall. |

## Open questions carried forward (not defects)

- The phone format chips wrap to two rows. Frame 10b draws one segmented row with "More ▾".
- `aria-activedescendant` points at a native radio inside a table, not at `role=option`. Screen
  readers announce it, but the pattern is non-standard. A listbox of options would be cleaner
  if the chooser is ever rebuilt.
