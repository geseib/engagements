# Live dev test 8: experienced host ("Sam"), round 3 (final)

*30 Oct 2026. This is a re-test of `devtest-5-experienced-round2.md` against dev at commit
`5c7d3a28b`. The site serves `main.4157b825.js`. I used the same QA host account
(`george+uxqa@`) with Playwright and Chromium at 1440×900 and 390×844. The scripts (`s1.js`,
`s1b.js`, `s2.js`, `s3.js`), their output (`s*-result.txt`) and the screenshots are in the session
scratchpad under `ux/devtest-expert/r3/`. Every filename below is relative to that folder.*

**Created:** one session, **1988 "UX QA — Round 3"** (Call & Answer, Workplace Scenarios for
Discussion, all topics, not started). Its edit dialog was opened, a topic was toggled off and back
on, and the edit was then cancelled, so nothing was saved. I did not touch any other session.

---

## 1. Key counts

| Path | Round 1 | Round 2 | **Round 3** | Target |
|---|---|---|---|---|
| Last format right: title → recent → create | 7 (two Ctrl+Enters dropped) | 3 | **3**: Enter · Enter · Ctrl+Enter. The button showed "Waiting for topics…" at 276 ms, and the POST went at 352 ms (`s2-result.txt`). | 4 |
| Format switch: title → other format → recent → create | 10 | 7 | **5**: Tab · → · **Enter** (chip → set search) · Enter (first recent) · Ctrl+Enter (`s1-result.txt`). | ≤ 5 |
| Mouse, last format right | 2 clicks + a wasted chord | 1 click + chord | 1 click + chord (unchanged) | — |

Today's modal: 25+ keys, or 3 clicks.

---

## 2. Round-2 items by ID

| ID | Asked for | Status | Evidence |
|---|---|---|---|
| **N1** | Format guide in the header in compact; Enter on a format chip moves to the search; ≤ 5 keys | **Fixed** | "Format guide" sits in the header beside Show preview (`01-open.png`). Title → Tab lands on the radiogroup, → picks Trivia, and Enter moves focus to "type to search 10 Trivia sets". That is 5 keys in total. |
| **N2** | "Always open with the full guide" only inside the guide | **Fixed** | It is absent from the compact form and present inside Format guide (`04-format-guide.png`), with "Back to the form". Esc in the guide returns to the form without the discard bar. |
| **N3** | Compact preview as a drawer inside the 880px card; no width jump; no "What happens next" | **Width and content fixed. New layout bug (R3-1)** | The card stays at 880×860, with no "What happens next" or "Your choices". **But the drawer is laid over the form instead of the form reflowing.** The form keeps its full width under the drawer, so the title field, the search, the briefing and Advanced lines are clipped at about x=780. The Survey, Build Room and Event chips (right edges 854–1063px) and the right-hand topic chips are hidden behind the drawer (`03-show-preview.png`, `22-drawer-1440.png`). |
| **N4** | Tags column hidden when no set has tags; names not truncated at 1440 | **Fixed** | The headers are Name · Questions · Whose · Used / updated, with no Tags column. "Workplace Scenarios for Discussion" and "Lessons from the School of Hard Books" show in full (`05-chooser-1440.png`). |
| **N5** | Phone chooser names wrap | **Fixed** | "Workplace / Scenarios for / Discussion", "Lessons from / the Tech World" (`21-phone-chooser.png`). The placeholder is "Search 15 sets" and is not clipped. Nit: the table only fills about 250 of 358px, leaving an empty strip on the right. |
| **N6** | "Ready-made" badge in the chooser | **Fixed** | The tab reads "Ready-made 14" and the badges read "Ready-made". The column is "Whose". The recents row and the chosen-set row use it too. |

---

## 3. Regression sweep

| Check | Result | Evidence |
|---|---|---|
| 3: search keeps the recents; Enter picks; Esc | **PASS** | Esc on an empty search keeps the dialog with no discard bar, and focus stays in the search. Enter picks the first recent, and focus moves to "Change". |
| 4: Change set | **PASS** | 0 topics render while the chooser is open, and the card stays at 880×860. Esc keeps the set **and** the switched-off topic, with focus on "Change". Picking Greatest Hits renders `[]` at 0 ms, then its 8 topics. |
| 5: format round trip | **PASS** | The set and the switched-off topic both survive C&A → Trivia → C&A. |
| 6: Build Room / Event | **PASS** | Build Room: Ctrl+Enter moves focus to "Set up the Build Room" and announces it. Event (plan-disabled): focus stays put and the live region says "Events come with the Standard plan, so there is nothing to continue to." The URL never changed. |
| 9: edit | **PASS** (not saved) | The format radios are all disabled. The side pane reads "Changed: 1 topic switched off", and returns to "Nothing yet" when the topic is toggled back on. |
| Your sessions panel | **PASS** | It is `role="dialog"` with `aria-modal="true"` and is labelled by its title. The create banner reads "Created “UX QA — Round 3”. Its code is 1988…". **Esc closes it** (dialogs went from 1 to 0). On the phone (390), it shows one card per session with a title, LATEST, set name, code, type and state chips, and 2×2 Edit / Start / Link / Invite buttons at 44px or more, with no horizontal scroll (`14-phone-sessions.png`). Nit: after Esc, focus goes to `<body>`, not back to the "Sessions" button. |

---

## 4. New issues

| ID | Severity | Steps | Expected | Actual |
|---|---|---|---|---|
| **R3-1** | **Medium** | Compact, 1440. Pick Trivia (or anything) and press Show preview. | The form column narrows to the space left by the drawer, and every control stays reachable. | The drawer covers the right ~380px of the form. The title, search and briefing lines are clipped. **The Survey, Build Room and Event chips sit under the drawer**, and so do the right-hand topic chips (for example the third chip in each row of 80s Trivia's topics), so they cannot be clicked until the preview is hidden (`03-show-preview.png`, `22-drawer-1440.png`). Keyboard focus can still land on the hidden chips. |
| **R3-2** | **Medium** | Open New engagement, type "Draft A", press × → **Discard**. Open New engagement again. | An empty title, since the bar said "what you filled in is lost". | **The title still reads "Draft A"** (`s1b-result.txt`, `07b-reopen.png`). Typing a new title appends to it, which I hit for real: "UX QA r3 probe (not created)UX QA r3 probe 2 (not created)" (`05-chooser-1440.png`). For a fast typist this produces a wrongly named session. It only lasts within one page load; a fresh page opens empty. |
| R3-3 | Low | Esc closes Your sessions. | Focus returns to the "Sessions" button that opened it. | Focus is on `<body>`. |
| R3-4 | Low | Phone, open chooser. | The table fills the card. | About 100px is left empty on the right, and the folded summary wraps "Call & Answer · Edit" onto a second line (`21-phone-chooser.png`). |

---

## 5. Verdict

All six round-2 items are addressed: N1, N2, N4, N5 and N6 are fully fixed, and N3 fixes its
width and content. The keyboard targets are met: **3 keys** for the common create and **5 keys**
for a format switch, and no Ctrl+Enter is dropped. Checks 3 to 6, check 9 and the Sessions dialog
show no regressions.

Nothing blocks the core create flow. Two medium issues should be fixed before this goes to test:
**R3-1**, the preview drawer hiding part of the form, and **R3-2**, Discard not clearing the
title. Both are easy to reproduce, and R3-2 can produce a wrongly named session.
