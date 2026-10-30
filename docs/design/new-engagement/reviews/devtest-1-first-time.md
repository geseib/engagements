# Live dev test 1: first-time host ("Dana")

*30 Oct 2026. Tested live on https://engage.dev.seibtribe.us with the QA host account
(`george+uxqa@`). The account had never created a session when the test began, so the newcomer
view was shown. Playwright and Chromium ran at 1440×900, with extra runs at 1280×720 and 390×844.
Compared against `README.md` (revision 2) and frames 01, 01b, 02, 04, 05a, 05c and 10. The
scripts and all 87 screenshots are in the session scratchpad under `ux/devtest-novice/`. Every
filename below is relative to that folder.*

*The persona: Dana is a team lead who has never used Engage. She wants to set up next week's
retro and is not technical.*

---

## 1. Pass/fail by numbered check

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | Newcomer opens Create engagement: title focused, no format chosen | **PASS** | `e01-open.png`, `d01-open-nohover.png`. Focus is in `#gsd-title`. No radio is checked, and Create is disabled and outlined. The Questions step is visible and greyed. |
| 2a | Press Retro: Call & Answer chosen, with a reason | **PASS** | `d03b-retro-after-anim.png`. The chip is `aria-pressed` with a tick. The card says "Chosen" and the reason line reads "For a retro: Call & Answer…". |
| 2b | Compare side by side → Use Trivia → switch back | **PASS, with a bug** | `d05-compare.png`, `d05b-compare-scrolled.png`, `d06-used-trivia.png`, `d07-back-to-ca.png`. All of it works. After "Use Trivia", however, **Retro stays pressed and the line still says "For a retro: Call & Answer"** while Trivia shows "Chosen" (bug B4). |
| 3a | Browse all, pick a set: its topics appear, all on | **PASS** | `d09-browse-all.png`, `d10a-picked-0ms.png` (still placeholders and "Loading topics…", with Create disabled), `d10c-picked-settled.png` (8 of 8 on). |
| 3b | Change → "Keep the set I had" → topics return | **PASS** | `c3-03-change-open.png` shows 0 topic buttons rendered while the chooser is open, focus in the search, and "✓ current" on the row. In `c3-04-kept.png` the same set comes back **with the same selection**: I had switched Sports off, and it was still off. |
| 3c | Change → a DIFFERENT set → no old topic shows, even briefly | **PASS (data), FAIL (visual)** | Eight screenshots back to back (`c3-06-pick-B-0..7.png`), plus a MutationObserver and a rAF sampler running for 5s. Only two topic lists were ever in the DOM: empty, then set B. **0 frames contained a set-A topic.** A race (pick X, then 80ms later Change and pick Y) ended with Y's topics. But the "Topics refreshed…" note that appears in this step is **unreadable** (bug B1, `c3-07-B-settled.png`). |
| 4 | Search "zzz" → three make-your-own options | **PASS** | `c4-01-zzz.png`, `c4-02-zzz-scrolled.png`. Write your own questions, Make a set with Workie and Fill in a spreadsheet are all present. Copy problems are listed under C8. No upload was started. |
| 5 | ↓ in the format chips to Trivia, then ↑: the first set returns | **PASS (set), minor FAIL (topics)** | `c5-02..05*.png`. ↓ gives Trivia with no set, and ↑ brings back C&A with Greatest Hits. ←/→ behave the same way. There is one tab stop (tabIndex `[0,-1,…]`). **Topic picks are not restored:** Sports was off before the round trip and on after it (`x01-roundtrip-topics.png`, bug B8). |
| 8a | 1280×720 | **PARTIAL** | `c8-1280-*.png`. The foot is always visible, the dialog is 1232×680 with no page scroll, and the Compare header is sticky. Once a set is picked, **the preview collapses to its caption only** (`c8-1280-05-picked.png`). In Compare, the rows scroll visibly through the gap above the sticky header (`c8-1280-08-compare-scrolled.png`). |
| 8b | 390×844 | **FAIL** | `c8-390-*.png`. **The Create button is clipped and wraps to "Create / gageme"** (`c8-390-01-open.png`, `-05-picked.png`). The phone has none of frame 10's compact treatment (bug B2, visual V1). The page width holds at 390 (no horizontal page scroll). |
| — | Create C&A "UX QA — Retro test" with Ctrl+Enter | **PASS** | `k01-early-ctrl-enter.png`: an early Ctrl+Enter did nothing (correct). Then `k02-ready.png` → `k03-after-ctrl-enter-0..3.png` ("Creating…") → `k04-landed.png`. The button carries `aria-keyshortcuts="Meta+Enter Control+Enter"`. Session code **1224**. |
| — | Create Trivia "UX QA — Trivia test" with the Create button | **PASS** | `m05-trivia-ready.png` → `m06-after-create-*.png` → `m07-landed.png`. Session code **2572**. This was the second open, so it ran in **compact mode** (`m01-open-returning.png`): the account now has history, C&A is pre-chosen and marked "last used", and "Used by you lately" shows the retro set. |

**State left for the next tester:** two sessions, both not started: 1224 (C&A, set
`workplacescenariosfordiscussion`) and 2572 (Trivia, `80strivia`). The modal now opens in compact
mode with Call & Answer as the last-used format. No question sets were created or uploaded.

---

## 2. Bugs

| ID | Severity | Steps | Expected | Actual |
|---|---|---|---|---|
| **B1** | **High** | Pick set A, switch one topic off, Change, pick set B. | The cleared-picks note in the dusk status style (frame 5b). | The note `div.status-message.gsd-cleared.pending` has background `rgb(240,240,240)` and inherited text `rgb(244,237,228)`, so the contrast is about 1.1:1. It shows as a **blank white slab** with a timer icon (`c3-06-pick-B-0.png`, `c3-07-B-settled.png`). The one sentence explaining why her choices were reset cannot be read. The global `.status-message.pending` paper style is leaking into `.gsd`. |
| **B2** | **High** | Open Create engagement at 390×844. | Full-width Cancel and Create, each 44px or taller (frame 10). | The foot keeps the desktop row: the lock note, Cancel, then Create squeezed to about 60px wide. The label wraps and is clipped ("Create / gageme"). The primary action is barely recognisable (`c8-390-01-open.png`, `c8-390-05-picked.png`, `c8-390-07-compare.png`). |
| **B3** | **High (novice)** | In step 3, click "Make a new set". | It opens straight into making a set for this format (§8: `initialRoute`, "the new set comes back picked"). | It opens **"Your question sets"**: "You haven't made a question set yet", then **33 "Copy and edit" rows** of other people's sets. The actual "New question set" panel (AI builder, template, manual builder) is about **1,900px down**, below all of them (`x05-make-new-set.png`, `x06-…`, `x07-new-set-panel-at-bottom.png`). Dana would never find it. |
| **B4** | Medium | Press Retro → Compare → "Use Trivia". | The meeting chip un-presses (or the line updates), as it does when you click a different card. | Retro stays `aria-pressed` and the line still reads "For a retro: Call & Answer…" while Trivia shows "Chosen" (`d06-used-trivia.png`). Clicking the C&A card afterwards clears the chip (`d07-back-to-ca.png`), so the two paths disagree. |
| **B5** | Medium | Click the empty set search and press Esc (to dismiss it). | Esc closes nothing, or only clears the search (the chooser hint says "Esc clears"). | Esc goes up to the modal and asks **"Discard this engagement?"** (`d08b-after-esc.png`). If she ignores it and clicks "Browse all", **the discard bar stays in the foot** while she browses sets (`d09-browse-all.png`), with Create hidden behind it. |
| **B6** | Medium | Create any session. | It says what was created and what to do next (README §4: "Create waits in your Sessions list"). | It lands in "Your sessions" with **no confirmation** (no "Created, code 1224" and no pointer to Start). The dialog is visibly broken. It has a **white 20px frame** around a dark panel. The **title "Your sessions" is near-invisible** (dark on navy). The column heads are clipped ("PLAYEI", "ROUND", "Call & Answei"). The set shows its **raw id** ("Set: workplacescenariosfordisc…", "80strivia"). It also says "host Host", because the create payload sends `hostName:"Host"` (`k04-landed.png`, `m07-landed.png`). "LATEST" is the only cue to which row is new. |
| **B7** | Medium | Second open (compact mode): pick Trivia and a set. | Compact has no checklist (frame 3b). | A summary row **"✓ Questions — 100 questions, all 8 topics"** is pinned at the bottom of the form and **overlaps the topic grid** (`m05-trivia-ready.png`). |
| **B8** | Low | Pick a set, switch a topic off, arrow to Trivia and back. | The same set **and** the same topic picks, as "Keep the set I had" already does. | The set returns with all topics on again, and no note says the picks were reset (`x01-roundtrip-topics.png`). |
| **B9** | Low | Pick a set at 1280×720. | The preview stays visible and scrolls behind the pinned checklist (frame 12a). | The preview frame is squeezed to zero height, leaving only its caption ("An example of the format…") (`c8-1280-05-picked.png`). |
| **B10** | Low | Compare, then scroll the rows (1440 or 1280). | The sticky header is opaque. | Row text shows through above the header ("round.", "otherwise.", "Any size"). The tops of the C&A and Event preview art are clipped (`d05b-compare-scrolled.png`, `c8-1280-08-compare-scrolled.png`). |
| **B11** | Low | Open the modal (novice, no format). | Disabled preview tabs look disabled. | "Room screen" is `disabled` but drawn with a bright, selected-looking border (`e01-open.png`). |
| **B12** | Low | Pick set B after set A. | Create stays visibly disabled while it reads "Loading topics…". | It is `disabled` (correct), but a background transition fades the amber fill from the previous enabled state, so for about 300ms a solid amber "Loading topics…" looks clickable (`c3-06-pick-B-0.png`). |

---

## 3. Confusions, as Dana (element + the words)

- **C1. Set badge "Engage" and topic "Unfiled"** (set row and chooser). *"Engage? I'm in Engage.
  Is that the owner? And what's 'Unfiled', did someone forget something?"* The spec renamed the
  badge to "Ready-made" (§9) and the column to "Whose". Live it still reads "Engage", "Public"
  and "OWNER". 14 of 15 C&A sets are "Unfiled".
- **C2. Set descriptions**, for example "AI-generated scenarios for detailed difficulty level.
  Target audience: …". *"Detailed difficulty level? Which of these is a retro?"* None of the 15
  C&A sets reads as retro-shaped. "Workplace Scenarios for Discussion" was the closest guess.
  (This is content, not the modal.)
- **C3. "Serial murders throughout time Trivia for Crime buffs"** is the second row of the
  Trivia list for every host (`m04-trivia-chooser.png`). *"Not something I want my team to see
  over my shoulder."* This is content and moderation, flagged for the owner.
- **C4. Preview caption "Example from a ready-made set. Yours will show your own questions."**
  The preview shows only abstract bars (9 / 4 / 2) with no example question, so *"example of
  what?"* The mockup shows a real question ("Build a Threshold, Not a Door").
- **C5. The meeting chips and the reason line vanish after a set is picked.** The gallery turns
  into chips, and "Retro" and its sentence disappear (`d10c-picked-settled.png`). *"Did it
  forget I said retro?"* This matches frame 4, but it is jarring live because it happens on the
  set click, not on a format click.
- **C6. The side-pane heading flips between "THREE DECISIONS" and "YOUR CHOICES"** depending on
  whether a set is picked. *"Is this a different list now?"*
- **C7. "Make a new set" vs "Your question sets"** both open the same library dialog (B3). *"I
  clicked 'make', why am I looking at everyone else's sets?"*
- **C8. No-match copy.** The heading reads **"No Call & Answer sets match Search “zzz”"**: the
  filter-chip label "Search" has leaked into the sentence. The exit button wraps to "Clear the
  search / “zzz”" with "15 / sets" stacked beside it. The footnote contradicts the cards: "A set
  you upload is picked… A set Workie drafts waits for your review", while the card for writing
  your own says it "Opens your question sets…". *"So if I write my own, is it picked or not?"*
  Under the three cards, "Not there at all? Make a new set" repeats the cards and goes to B3's
  dead end.
- **C9. The step 3 heading is "Question set"** (the spec says "Choose the questions"), and the
  search placeholder says "Choose a question set: type to search 15 Call & Answer sets". For a
  first-timer that is fine. On the phone it is cut off at "Search 15 Call & Answe".
- **C10. After Create** (B6): *"Did it work? What's 1224? Do I press Start now? It's a week
  away."* Nothing on the landing screen says "it waits here until the day; press Start in the
  room".

---

## 4. Visual problems compared with the mockups

- **V1. Phone (frame 10 vs `c8-390-*`).** The header wraps to two lines ("New / engagement")
  and keeps its subtitle, about 150px in all. "Compare side by side" and "I know these" each take
  their own row. The meeting chips take three rows. **All seven format cards are stacked** with
  no "Wavelength, Survey, Build Room, Event ▾" fold, so the form is 1,396px of scroll in a 602px
  window. In the chooser the table truncates names ("Lessons fro…") and hides Topic, Tags and
  Updated. Compare shows two columns at a time.
- **V2. Meeting chips wrap at 1440.** "Offsite day" sits alone on a second row
  (`d01-open-nohover.png`); frame 1 fits all seven on one row. After a pick, the **format chips
  wrap "Event" alone** onto a second row (`d10c-picked-settled.png`), where frame 4 fits them on
  one.
- **V3. Topic chips stretch to fill each row,** with the count pushed to the far right in
  brackets ("Entertainment ……… (3)"). Frame 4 draws compact chips ("Architecture 2"). In compact
  mode, long topic names wrap to three lines in four columns (`m05-trivia-ready.png`).
- **V4. The "Brief Workie from a document" box is still the large dashed box,** about 160px
  (`d04-step3.png`). §9 says dashed borders are for placeholders only and frame 4 draws a solid
  card. This is the same weight problem §1.5 set out to fix.
- **V5. The help "?" in the header is very faint** next to the ×, at 1440 and 1280 alike.
- **V6. The preview frame is clipped at the bottom** by the pinned checklist for C&A, which has
  five rows, but not for Trivia, which has four (`d03b-retro-after-anim.png` vs
  `d06-used-trivia.png`). Its caption "Room: answers appear, then the room votes…" is in the DOM
  but never on screen at 900px.
- **V7. "Use Call & Answer" is a filled amber button in Compare** while Create is also filled
  amber, so there are two primaries on one screen (`c8-1280-08-compare-scrolled.png`).
- **V8. The Trivia "Chosen" badge covers the B answer tile** of its own preview art
  (`d06-used-trivia.png`).
- These match the mockups and are good: the 1440 full-mode layout, the step ticks, the
  checklist's dashes and "that's fine", the outlined disabled Create, the placeholders and
  "Loading topics…", the folded "Name · format · Edit" line while the chooser is open, "✓
  current", and the compact card at 880px with "last used" and the Ctrl+↵ keycap.

---

## 5. Top fixes, ranked

1. **B1: make the cleared-picks note readable.** Scope `.status-message.pending` under `.gsd` to
   dusk tokens, or route it through `StatusMessage`, and add a composited-contrast assertion
   for `.gsd-cleared` to `gameSetupPalette.test.js`.
2. **B2/V1: the phone foot and layout.** Use full-width stacked Cancel and Create (44px), a
   one-line header, the "More ▾" fold for the last four formats, and the chips on one scrolling
   row.
3. **B3/C7/C8: "Make a new set" must land in the builder.** Open `HostQuestionSetsDialog`
   with `initialRoute` and the format preset (README §8), or at the very least scroll to and
   open the "New question set" panel. Make the no-match footnote say the same thing for all
   three routes.
4. **B6/C10: after Create, say what happened.** Show "Created ‘UX QA — Retro test’. Code 1224.
   It waits here until you press Start in the room." Fix the Sessions dialog's paper frame,
   title contrast, clipped heads and raw set id, and stop sending `hostName:"Host"`.
5. **B4 and B5: keep the state honest.** Clear or update the meeting chip when Compare's "Use X"
   picks another format. Stop Esc in the set search from reaching the modal, and dismiss the
   discard bar on any further interaction.
6. **B7: remove the stray summary row in compact mode.**
7. **C1: rename the badges** to "Ready-made", "Whose" and so on as specified, and hide "Unfiled".
8. **B8, B9, B10, V2–V8:** restore topic picks on a format round trip, keep the preview at
   1280×720, make the Compare sticky header opaque, stop the chips wrapping at 1440, use a solid
   one-line briefing, and strengthen the help icon.
9. **Content (C2, C3):** retro-shaped C&A sets for newcomers, and review the public Trivia set
   that sits second in the list.
