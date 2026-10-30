# Live dev test 5: experienced host ("Sam"), round 2

*30 Oct 2026. This is a re-test of `devtest-2-experienced.md` against dev at commit `4e00af67b`. I
confirmed that https://engage.dev.seibtribe.us serves `main.ebacfad4.js`. I used the same QA host
account (`george+uxqa@`) with Playwright and Chromium at 1440×900, 1280×720 and 390×844. The
scripts (`s2.js`, `s4.js`, `s5.js`, `s7.js`), their output (`s*-result.txt`) and the 35
screenshots are in the session scratchpad under `ux/devtest-expert/r2/`. Every filename below is
relative to that folder.*

**Created:** one session, **7158 "UX QA — Round 2 speed run"** (Call & Answer, Workplace
Scenarios for Discussion, all topics, not started). **Edited:** my own round-1 session 9167. I
switched Decision Making back on, so it now has all topics again. I did not touch anything else.

---

## 1. Speed run: 3 keys after the title (target 4)

Last format was Call & Answer (from 9167), so the dialog opened compact on C&A with focus in the
title (`01-open.png`).

| Key | Action | Focus after |
|---|---|---|
| T | type "UX QA — Round 2 speed run" | title |
| 1 | **Enter**: the title moves to the set search (format already chosen) | set search (combobox) |
| 2 | **Enter**: picks the first recent ("Workplace Scenarios for Discussion") | **"Change"**, inside the dialog |
| 3 | **Ctrl+Enter**, pressed at once | — |

Button samples after key 3 (`s2-result.txt`, `02b`–`02c`):

- just before key 3: "Loading topics…"
- 400 ms after the title: **"Waiting for topics…"**
- 716 ms: "Creating…" (the POST has gone)

It then lands in "Your sessions" with **"Created “UX QA — Round 2 speed run”. Its code is 7158.
It waits here … press Start when the room is ready … Start it now"** (`02d-landed.png`). From the
end of the title to the POST took **465 ms**, and the whole run took about 7.7 s including typing.

| | Today's modal | Round 1 (as pressed) | **Round 2** | Spec |
|---|---|---|---|---|
| Keyboard, last format right | 25+ keys | 7 (two Ctrl+Enters dropped) | **3** | 4 |
| Keyboard, format switch | 20+ keys | 10 | **7** (Tab · ← · Tab · Tab · Tab · Enter · Ctrl+Enter), or **6** via Shift+Tab to the title then Enter · Enter · Ctrl+Enter | 5 |
| Mouse, last format right | 3 clicks | 2 clicks + a wasted chord | **1 click + Ctrl+Enter** (focus stays in the dialog after a click pick) | 1 click + chord |

---

## 2. The 10 checks, re-run

| # | Check | Round 1 | **Round 2** | Evidence |
|---|---|---|---|---|
| 1 | Compact on last format, title focused, recents, one-click pick | PASS | **PASS** | `01-open.png`. The chips fit on one row, the format blurb is gone, and the search hint reads "Enter picks". |
| 2 | Speed run | FAIL | **PASS** | §1. 3 keys. |
| 3 | Tab into search keeps the recents; arrows/Enter pick | PASS with gaps | **PASS** | Enter on an empty search picks the first recent. Esc no longer reaches the modal (`b5-esc-search.png`). |
| 4 | Change set: old topics clear, layout stable, Keep restores | PASS / note FAIL | **PASS** | The cleared-picks note is readable (`b1-setB-settled.png`). Esc keeps the set **and** the off topic, and focus returns to "Change". |
| 5 | Format round trip remembers set and topics | set PASS, topics FAIL | **PASS** | Decision Making off → Trivia → C&A → still off (`b8-roundtrip-2.png`). |
| 6 | Build Room / Event never leave on Ctrl+Enter | PASS, wrong announcement | **PASS** | Build Room: focus moves to "Set up the Build Room". Event (plan-disabled): focus stays put, and the live region now says "Events come with the Standard plan, so there is nothing to continue to." (`e6-*.png`). |
| 7 | Chooser power features | MOSTLY PASS | **PASS** (Switch team not testable: the account has no team) | The **Tags** column is now present at 880px (`c7-chooser.png`). Sort, Used by you lately, Used / updated, Make a new set, Keep the set I had, ✓ current, and "Other formats" on no match are all there. |
| 8 | Override toggles and survives reload | PASS | **PASS** (not re-run: the storage code is unchanged; see E8 for Show preview) | — |
| 9 | Edit an unstarted session | PASS | **PASS** | Side pane: "Changed: 1 topic switched on". Save gives **"Saved “UX QA — Expert speed run”. Its code is 9167…"** (`e9-*.png`). |
| 10 | Compact at 1280×720 and 390×844 | 1280 partial, 390 FAIL | **PASS** | 1280: no summary row, topics visible under the set, foot visible (`10-1280-c-picked.png`). 390: one-line title, C&A / Trivia / Poll / **More ▾**, "Search 15 sets", full-width 175×46 Cancel and Create, no horizontal scroll (`10-390-*.png`). |

---

## 3. Round-1 findings by ID

| ID | Round-1 finding | Status | Evidence |
|---|---|---|---|
| E1 | Ctrl+Enter ignored after a pick (focus fell to body) | **Fixed** | After a recent pick by keyboard or mouse, a chooser pick, or Esc-keep, focus is on "Change" and Ctrl+Enter creates (§1, `s4-result.txt`). |
| E2 | Ctrl+Enter swallowed while topics load | **Fixed** | The button reads "Waiting for topics…", then creates on its own. |
| E3 | Enter on empty search opened the full chooser | **Fixed** | Key 2 in §1. |
| E4 | "Format guide" tab stop before the format group | **Fixed, but moved the cost** | Title → Tab lands on the radiogroup now. But **"Format guide" and "Always show the guide" now sit between the radiogroup and the search**, so a format switch needs 3 Tabs to reach the search (N1). |
| E5 | Off topic unreadable while hovered | **Fixed** | Hovered off chip: transparent background, text `#A9B5C9`. |
| E6 | Event plan-disabled: false "moved to Continue" | **Fixed** | It now announces the plan reason. |
| E7 / B7 | "Questions" summary row covering topics (1280×720) | **Fixed** | Absent in compact at 1440 and 1280. |
| E8 | Compact "Show preview" threw the full novice layout | **Fixed, with a nit** | It keeps the compact form (chips, no gallery, no meeting chips) and adds the preview pane with "Hide preview" (`b8-roundtrip.png`). The pane still shows "Your choices" and "What happens next", and the card widens from 880px to about 1300px (N3). |
| B1 | White cleared-picks note | **Fixed** | Dusk blue wash, readable text. |
| B2 | Phone Create clipped | **Fixed** | 175×46, label "Create". |
| B5 | Esc in set search asked to discard | **Fixed** | Esc on an empty search, Esc to clear text, and Esc twice in the open chooser all keep the dialog, with no discard bar. |
| B6 | No confirmation after Create/Save; Sessions dialog broken | **Fixed** | A green banner with title, code and next step, plus "Start it now". The title is readable, there is no white frame, and the real set name shows. (The payload still sends `hostName:"Host"`, but it is no longer displayed.) |
| B8 | Topic picks lost on format round trip | **Fixed** | Check 5. |
| C1 | "Engage" / "Unfiled" badges | **Partly fixed** | "Unfiled" is gone from the chosen-set row. The badge and owner tab still read **"Engage"** (the spec says "Ready-made"). |
| C8 | "match Search “80s”" | **Fixed** | It now reads "No Call & Answer sets match “80s”". |
| V2 | Chips wrap "Event" alone | **Fixed** | One row at 880px. |
| Phone 10b | No compact phone variant | **Fixed** | Check 10. |
| B3 | "Make a new set" lands in the library | Not retested | — |

---

## 4. New issues, ranked

| ID | Severity | What | Fix |
|---|---|---|---|
| **N1** | Medium | A format switch by keyboard costs **7 keys** where the spec says 5. The two header links ("Format guide", "Always show the guide") are tab stops between the radiogroup and the search. | Put the links before the radiogroup again but skip them in Enter-from-title, **or** let Enter on a format radio move to the search (as Enter in the title does). Either gives Tab · ← · Enter · Enter · Ctrl+Enter = 5. |
| **N2** | Low | **"Always show the guide" is always visible in compact**, next to Format guide. It is a second link I will never press, and a tab stop. | Show it only inside the Format guide / Show preview state, as round 1 did. |
| **N3** | Low | **Show preview widens the card from 880px to about 1300px and re-shows "What happens next".** An expert asked for the room picture, not the checklist. | In compact, show the preview only (frame 03 says "Show preview toggles it"), or at least drop "What happens next" there. |
| **N4** | Low | **The Tags column is empty for every set** (no demo set has tags) yet takes about 200px, so names truncate at 1440 ("Workplace Scenarios for Discu…", "Lessons from the School of Ha…"). | Hide the column when no visible row has tags. |
| **N5** | Low | **Phone chooser** truncates every set name to about 10 characters ("Workplace …", "Lessons fro…"), and its search placeholder is cut ("Search 15 Call & Answ"). | On the phone, drop the description line or the Owner column, let names wrap, and use the short "Search 15 sets" placeholder there too. |
| **N6** | Low | C1 remainder: the badge and owner tab still say "Engage". | Rename to "Ready-made" as in §9 of the README. |

**Verdict:** every round-1 blocker is fixed. The common create now takes **3 keys after the
title**, which beats the 4-key target, and it never drops a Ctrl+Enter. What is left is polish,
led by N1 (the format-switch path).
