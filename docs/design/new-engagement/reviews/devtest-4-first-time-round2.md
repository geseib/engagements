# Live dev test 4: first-time host ("Dana"), round 2

*30 Oct 2026. Run against dev on commit `4e00af67b`. I confirmed the live bundle is
`main.ebacfad4.js`. I used the new newcomer account (`george+uxqa2@`), which had no history, so
the first-time view was shown until my session was created. The round-1 scripts were re-run
unchanged, except that the set search is now a `combobox` rather than a `textbox`. Screenshots
are in the session scratchpad under `ux/devtest-novice-r2/`; filenames below are relative to
it. The round-1 report is `devtest-1-first-time.md`, and the IDs below refer to it.*

---

## 1. Numbered checks

| # | Check | Round 2 | Evidence |
|---|---|---|---|
| 1 | Title focused, no format chosen | **PASS** | `e01-open.png`. Focus is in `#gsd-title`, no radio is checked, and Create is disabled. |
| 2a | Retro chooses C&A with a reason | **PASS** | `d03b-retro-after-anim.png` |
| 2b | Compare → Use Trivia → back | **PASS** | `d05-compare.png`, `d06-used-trivia.png` (Retro un-pressed, reason line gone), `d07-back-to-ca.png` |
| 3a | Browse all, pick: topics all on | **PASS** | `d09-browse-all.png`, `d10a-picked-0ms.png`, `d10c-picked-settled.png` |
| 3b | Change → Keep the set I had | **PASS** | `c3-03-change-open.png` (0 topics while open), `c3-04-kept.png` (Sports was off before and is still off) |
| 3c | Different set, no flash of old topics | **PASS** | `c3-06-pick-B-0..7.png`. The MutationObserver and rAF trace saw only `""`, then set B: 0 frames with set-A topics. The note is now readable (`c3-07-B-settled.png`). |
| 4 | "zzz" → three make-your-own routes | **PASS** | `c4-01-zzz.png`, `c4-02-zzz-scrolled.png` |
| 5 | ↓ to Trivia, ↑ back: set returns | **PASS** | `c5-03-after-down.png`, `c5-04-after-up.png`. Topic picks now survive the round trip (`x01-roundtrip-topics.png`). |
| 8a | 1280×720 | **PASS** | `c8-1280-*.png` |
| 8b | 390×844 | **PASS, with minor issues** | `c8-390-*.png` (see N1 and N2) |
| — | Create C&A "UX QA — Round 2 newcomer" (Ctrl+Enter) | **PASS** | `k01-early-ctrl-enter.png` (nothing happened, correctly), `k02-ready.png`, `k03-*`, `k04-landed.png`. Code **8080**. |

---

## 2. Round-1 findings by ID

| ID | Status | Evidence / note |
|---|---|---|
| B1 picks-cleared note unreadable | **Fixed** | Dusk card with readable text (`c3-06-pick-B-0.png`, `c3-07-B-settled.png`). |
| B2 phone Create clipped | **Fixed** | Full-width Cancel and Create, each about 44px (`c8-390-01-open.png`, `-05-picked.png`). |
| B3 Make a new set buried | **Fixed** | Opens straight on "New question set", with the format preset to Call & Answer and AI / template / chatbot routes at the top (`x05-make-new-set.png`). |
| B4 Retro stays pressed after Use Trivia | **Fixed** | `d06-used-trivia.png` |
| B5 Esc in empty search → Discard | **Fixed** | Esc leaves the form alone and no discard bar appears (`d08b-after-esc.png`, `d09-browse-all.png`). |
| B6 no confirmation; broken Sessions styling | **Fixed** | The banner reads: Created "UX QA — Round 2 newcomer". Its code is **8080**… nobody can join until you press Start… You can still Edit it first. A **Start it now** button sits beside it in a `status` region. The white frame is gone, the title is `#F4EDE4` on `#0F1A2E`, the column heads are whole, the set shows its name, and "host Host" no longer appears (`k04-landed.png`). See N3. |
| B7 stray summary row in compact | **Fixed** | `m05-trivia-ready.png` (compact, second open, not created) |
| B8 topic picks reset on format round trip | **Fixed** | `x01-roundtrip-topics.png` |
| B9 preview collapses at 1280×720 | **Fixed** | The preview and caption are visible (`c8-1280-05-picked.png`). |
| B10 Compare sticky header bleed | **Mostly fixed** | The header is opaque now. The tops of the C&A and Event preview art are still clipped (`c8-1280-08-compare-scrolled.png`). |
| B11 disabled tab looks selected | **Fixed** | `e01-open.png` |
| B12 "Loading topics…" looks clickable | **Fixed** | Outlined while loading (`c3-06-pick-B-0.png`). |
| C1 "Engage" / "OWNER" / "Unfiled" | **Partly fixed** | "Unfiled" is gone from the picked-set row. The chooser still shows the "Engage" and "Public" badges, the OWNER column and "Unfiled" topics (`d09-browse-all.png`). |
| C2 / C3 set content | **Still present** | This is content, not the modal: jargon descriptions, and the crime set in Trivia. |
| C8 no-match copy | **Fixed** | "No Call & Answer sets match “zzz”". The footnote is consistent, and the duplicate "Make a new set" is gone. See N2. |
| V1 phone layout | **Mostly fixed** | One-line header, the "Wavelength, Survey, Build Room, Event ▾" fold, Call & Answer / Trivia / Poll / More chips, and compact topic chips. The chooser table still truncates names ("Lessons fro…") and the search placeholder is still cut (`c8-390-04-chooser.png`). |
| V2 chip wrap at 1440 | **Fixed** | Meeting and format chips each fit on one row (`e01-open.png`, `c3-07-B-settled.png`). |
| V3 stretched topic chips | **Fixed** | Compact chips with the count inline ("Architecture 2"). |
| V4 dashed briefing box | **Still present** | `d04-step3.png` |
| V5 faint help icon | **Fixed** | |
| V6 preview caption clipped | **Still present at 1440×900** | "Room: answers appear, then the room votes. Names are…" is cut by the pinned checklist (`d04-step3.png`). It is fine at 1280. |
| V7 two amber primaries in Compare | **Fixed** | "Use Call & Answer" is outlined. |
| V8 Chosen badge over art | **Fixed** | `d06-used-trivia.png` |

---

## 3. New problems (all minor)

| ID | Severity | What | Evidence |
|---|---|---|---|
| N1 | Low | Phone Compare: the chosen column's button is clipped to "Use Call & Answ". | `c8-390-07-compare.png` |
| N2 | Low | No-match exit button: "15 sets" spills past the right border of "Clear the search “zzz”". | `c4-02-zzz-scrolled.png` |
| N3 | Low | Your sessions: there is plenty of room, yet the session title truncates ("UX QA — Round 2 newcom…"), which hides the LATEST tag. Created truncates to "Oct 30, 20…". `hostName:"Host"` is still sent in the create payload, though no longer shown. | `k04-landed.png` |
| N4 | Low | Compact mode leaves about 90px of empty space between the topics and Advanced. | `m05-trivia-ready.png` |

## 4. Remaining fixes, ranked

1. **C1:** finish the chooser renames ("Ready-made", "Whose") and hide "Unfiled".
2. **V1 remainder:** a phone chooser list (stacked name and meta) instead of a truncated
   table, and a shorter placeholder.
3. **V6:** let the preview caption fit at 1440×900, or put it above the frame.
4. **N1–N3:** fix the clipped and truncated labels.
5. **V4:** use a solid one-line briefing in full mode.
6. **Content (C2, C3).**

**State left behind:** `george+uxqa2@` now has one session, **8080** (C&A, Workplace Scenarios
for Discussion, not started), and opens the modal in compact mode. Nothing was started or
uploaded, and no question set was created.
