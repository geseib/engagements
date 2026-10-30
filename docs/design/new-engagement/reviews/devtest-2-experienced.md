# Live dev test 2: experienced host ("Sam")

*30 Oct 2026. Tested live on https://engage.dev.seibtribe.us with the QA host account
(`george+uxqa@`). The account already had two sessions from round 1 (1224 Call & Answer, then
2572 Trivia), so the dialog opened in compact mode. Playwright and Chromium ran at 1440×900, with
extra runs at 1280×720 and 390×844. Compared against `README.md` (revision 2), frames 03, 03b,
05a, 05c and 10b, and the power-feature list in `reviews/experienced-host.md`. The scripts
(`s1.js` to `s8.js`, with `lib.js`), their output (`s*-result.txt`) and the 76 screenshots are
in the session scratchpad under `ux/devtest-expert/`. Every filename below is relative to that
folder.*

*The persona: Sam is a professional facilitator with 60+ sessions. They work keyboard-first,
are usually in a hurry, and do not want to be taught again.*

**Created during this test:** one session, **9167 "UX QA — Expert speed run"** (Call & Answer,
Workplace Scenarios for Discussion). It was then edited in check 9 so that "Decision Making" is
switched off. It has not been started. Nothing else was created, edited or deleted. The other
two sessions in the account were not touched. Layout override in my own browser was left at
`compact`.

---

## 1. Pass/fail by check

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | Opens compact on last format, title focused, recents visible, one-click pick | **PASS** | `01b-open.png`. The card is 880px with no side pane. **Trivia** is pre-chosen and marked "last used", which is correct because 2572 was the newest session. Focus is in `#gsd-title`. "Used by you lately" shows 80s Trivia under the search before anything is focused, which is better than the frame. One click on the row picks it (`s8`). The account only has one recent set per format, so only one row shows. Small differences from frame 03: the format blurb line ("Multiple choice with one correct answer…") is still shown, and **Event wraps alone onto a second chip row** (round-1 V2 is still there, in compact mode too). |
| 2 | Fastest path: title, recent set, Ctrl+Enter | **FAIL** | `02a`–`02i`. The session was created, but **Ctrl+Enter is silently ignored twice on the shortest path** (bug E1, plus E2 while topics load). It took **10 keys after the title, about 9 s**, where frame 03 and README §5 promise 4. Counts are in §2. |
| 3 | Tab into search does not open full chooser; arrows/Enter pick recents | **PASS, with gaps** | `03a`–`03h`, `s3-result.txt`. Tab (or Enter in the title, which jumps straight to the search) shows only the recents listbox. ↓ highlights the first recent (`aria-activedescendant=gsd-set-recent-0`, `03e-down1.png`). ↓ past the last recent opens the full chooser (`03f-down2.png`), as specified. **Enter on its own, with nothing highlighted, opens the full chooser instead of picking the first recent** (README §5: "Enter picks the first"), so the path is ↓ Enter. **Esc in the recents asks "Discard this engagement?"** (`11a-esc-in-recents.png`). That is round-1 B5, still present. |
| 4 | Change set mid-setup: old topics clear, layout stable, Keep restores | **PASS (behaviour), FAIL (note)** | `04a`–`04f`. On Change, 0 topic chips render and focus is in the search (`04b-change-open.png`: folded "Name · Call & Answer · Edit" line, "✓ current", "Keep the set I had", hint "Esc keeps your set"). Esc kept the set **with my switched-off topic still off**. Picking Greatest Hits: samples at 0 and 250 ms show `[]` with still placeholders and "Loading this set's topics…", then only set B's 8 topics. **No set-A topic was ever on screen.** The dialog stayed 880×860 at 280,20 for every sample. The **cleared-picks note is still a blank white slab** (`04e-setB-0.png`, `04f-setB-settled.png`). That is round-1 B1, still present. After Esc or a pick, focus falls to `<body>` (E1). |
| 5 | Arrow through format chips and back: set and topics remembered | **PASS (set), FAIL (topics)** | `05-0..3-*.png`, `05x-roundtrip-topics.png`. C&A → → Trivia → Poll → ← ← back to C&A brings back Greatest Hits. Trivia also keeps its own set (80s Trivia) across a round trip. The chip row has one tab stop. **Switched-off topics are not remembered**: Entertainment was off before C&A → Trivia → C&A and on after it, with no note. That is round-1 B8, still present. |
| 6 | Build Room / Event: Ctrl+Enter must not navigate; own labelled button | **PASS, one wrong announcement** | `06c-*.png`, `06d-*.png`. On both, Ctrl+Enter stays in the dialog with the URL unchanged. The buttons read **"Set up the Build Room"** and **"Continue to the event"**, and the foot says "Nothing is created yet. Ctrl+↵ moves to Continue; press Enter there to go." On Build Room, focus moves to the button and the live region announces it. Arrowing from Survey into Build Room and pressing Ctrl+Enter also moves focus to Continue and never leaves. **On Event, the account's plan disables Continue** ("Events come with the Standard plan"), so Ctrl+Enter leaves focus in the title **but still announces "moved to Continue"** (E6). |
| 7 | Full chooser keeps power features | **MOSTLY PASS** | `07a-chooser.png`, `07c-no-match.png`, `07a.txt`. Present: **Sort** (Recently used / Recently updated / Name / Most questions / Owner), the **"Used by you lately"** group, the **Used / updated** column ("used today", "1 wk ago"), Topic, Tag and Updated filters, **Make a new set**, "Keep the set I had", "✓ current", and **"Other formats: Trivia · 3 sets"** in the no-match state, plus the three make-your-own routes. **Your question sets** sits under the folded picker (`01b`), not inside the open chooser. **Tags column: missing** at 880px compact, while frame 5a draws it. **Switch team / the team's real name: not testable**, because this account has no team, so the tabs read "Engage / Public". Round-1 C1 ("Engage", "Unfiled") and C8 ("match Search “80s”") are both still present. |
| 8 | "I know these" / compact override toggles and survives reload | **PASS** | `08a`–`08e`, `s5-result.txt`. Compact → **Show preview** → "Always show the guide" stores `engage.newEngagement.layout=full`. After a reload the dialog opens in full mode (1240px) with "I know these — show compact". Pressing that stores `compact`, and after a reload it is 880px compact again. **But "Show preview" in compact does not add a preview pane.** It swaps to the whole novice layout: gallery, meeting chips, "Three decisions", "What happens next" (`08a-show-preview.png`). See O2. |
| 9 | Edit my unstarted session: format/set locked, topics editable, side pane says what changed; Save | **PASS** | `09c`–`09f`, `s6-result.txt`. "Edit session" has no gallery. The format radios are `disabled` with the line "The format and question set are fixed once a session is created", and the set shows a lock icon with "Fixed once a session is created". Topics are live, with "Switch off any you want to skip" and "Turn all on". The side pane reads "Status: Created, not started" and **"Changed: 1 topic switched off"**. Save changes sent `PUT /games/9167` with `categoryIds:["Ethical Dilemmas","Team Dynamics"]`, and reopening shows Decision Making off. Two issues: after Save, the Sessions list gives **no confirmation** (round-1 B6, including the white frame and the near-invisible "Your sessions" title), and the **topic you just switched off turns into an unreadable white chip while the pointer is still over it** (E5, `09d-edit-changed.png`). |
| 10 | Compact at 1280×720 and 390×844 | **1280 PARTIAL, 390 FAIL** | **1280** (`10-1280-*.png`): the card is 880×680, the foot is always visible, and there is no page scroll. After a pick, though, the stray **"✓ Questions — 20 questions, all 3 topics" row (round-1 B7) is pinned over the topic grid and hides it completely** (`10-1280-c-picked.png`). You have to scroll to see your topics. **390** (`10-390-*.png`): nothing of frame 10b has shipped. The title wraps to two lines, the chips take three rows with no "More ▾", and the search placeholder is cut ("type to sear"). The recent row is truncated to "Workplace Scen…". **Create is 56px wide and clipped** to "Create / engagement", then "ate / ement" (round-1 B2). In the chooser, the hint covers the placeholder (`10-390-f-chooser.png`). There is no horizontal page scroll. |

**Summary: 4 pass (1, 7 mostly, 8, 9), 3 pass with a failing part (3, 4, 5), 1 pass with a
wrong announcement (6), 2 fail (2, 10 at 390).**

---

## 2. Stopwatch: keystrokes and clicks

"T" is the title, the same in every column. Today's modal: **3 clicks + T, or 25+ keys + T**.
Frame 03 / README §5: **4 keys + T**.

| Path | Spec | Live, as a host who presses keys naturally | Live, best possible once you know the bugs |
|---|---|---|---|
| **Keyboard, last format already right** (C&A after C&A) | Tab · Tab · Enter · Ctrl+Enter = **4** | Enter (title → search) · ↓ · Enter · Ctrl+Enter *(ignored: topics loading)* · Ctrl+Enter *(ignored: focus on body)* · Tab · Ctrl+Enter = **7**, plus a confused pause | Enter · ↓ · Enter · *wait ~2 s* · Tab · Ctrl+Enter = **5** |
| **Keyboard, last format wrong** (what I ran: last = Trivia, want C&A) | Tab · ← · Tab · Enter · Ctrl+Enter = **5** | Tab *(lands on "Format guide")* · Tab · ← · Tab · ↓ · Enter · Ctrl+Enter ✗ · Ctrl+Enter ✗ · Tab *(lands on "Show preview")* · Ctrl+Enter = **10 keys, ~9 s** (`s2-result.txt`, `s2b-result.txt`) | Tab · Tab · ← · Tab · ↓ · Enter · Tab · Ctrl+Enter = **8** |
| **Mouse, last format right** | click recent · Ctrl+Enter = 1 click + chord | click recent · Ctrl+Enter ✗ *(focus on body)* · click Create = **2 clicks** + one wasted chord | click recent · click Create = **2 clicks + T** (today: 3 + T) |
| **Mouse, last format wrong** | 2 clicks + chord | chip · recent · Create = **3 clicks + T** | the same as today |

The keyboard win is real: 25+ keys become 5 to 8. But it is **not the 4 that was promised**, and
the first two Ctrl+Enters an expert presses do nothing, with no feedback. That is the worst kind of
slow for Sam, because it feels broken. Fix E1 and E2 and the paths become 4 and 7, matching the
spec except for the extra "Format guide" tab stop (E4).

Timing from the first title key to landing in Sessions was about 9 s. About 2.1 s of that is
topics loading after the pick (`create enabled after ms 2117`).

---

## 3. Bugs

| ID | Severity | Steps | Expected | Actual |
|---|---|---|---|---|
| **E1** | **High** | Compact. Pick a set by any route: ↓ Enter on a recent, a click on a recent, Enter in the full chooser, or Esc / "Keep the set I had". Then press Ctrl+Enter. | The dialog creates the session (README §5: "⌘↵ creates"). | **Nothing happens.** The search input unmounts when the set is picked, so focus falls to `<body>`. The shortcut handler (`GameSetupDialog.jsx:510-513`) ignores any key whose `event.target` is outside the dialog, so Ctrl+Enter is dropped with no feedback. The next Tab lands on "Show preview" at the top. Fix: after a pick or a fold, focus the chosen-set "Change" button (or the first topic), and/or accept the shortcut when `document.activeElement === document.body` while the dialog is open. |
| **E2** | **High** | Pick a set and press Ctrl+Enter at once, which an expert will do. | Either queue the create until topics land, or say why not. | During the ~2 s "Loading topics…", Ctrl+Enter is swallowed silently (`02c-after-first-ctrl-enter.png`). Fix: remember the intent and submit when `categoriesLoading` clears, or announce "Loading topics. Creating when ready." |
| **E3** | Medium | Compact. Focus the set search (recents showing) and press Enter. | It picks the first recent (README §5, Sam's walkthrough). | It opens the full chooser with row 0 highlighted, so it takes ↓ Enter, one extra key on every create. Frame 03's hint "↓ Enter" matches the build; README §5 does not. Pick one. My vote: Enter on an empty search picks the first recent. |
| **E4** | Low | Title → Tab. | Tab reaches the format radiogroup (README §5). | Tab lands on **"Format guide"** first, so changing format costs one extra key. Move the link after the radiogroup in tab order, or let Enter in the title go to the format group when Sam wants it (for example Shift+Enter). |
| **E5** | Medium | Switch a topic off by clicking it, and leave the pointer where it is (create and edit). | The chip shows as off: transparent, muted text, "–". | **While hovered, an off chip is a white slab with pale amber text**, unreadable (`04a-setA-one-off.png`, `09d-edit-changed.png`). Unhovered it is fine (`bg transparent`, text `#A9B5C9`, `10-1280-e-scrolled.png`). This is probably the same paper hover style leaking into `.gsd` as round-1 B1. |
| **E6** | Low | Event, on a plan without events (Continue disabled). Press Ctrl+Enter. | The shortcut says the event needs the Standard plan, or does nothing. | Focus stays in the title, but the live region says **"Ctrl+↵ moved to Continue. Press Enter there to go."** That is untrue. `primaryRef.focus()` on a disabled button does nothing. |
| **E7** | Medium | Compact at 1280×720. Pick a set. | The topics are visible under the set (frame 3b). | The stray summary row (round-1 **B7**) is pinned at the bottom of the form and **covers the entire topic grid** (`10-1280-c-picked.png`). At 1440 it covers the names card (`04e-setB-0.png`). Compact should not render it at all. |
| **E8** | Low | Compact → "Show preview". | Frame 03: it toggles the 420px preview pane beside the compact form. | It switches to the full **novice** layout: subtitle, gallery, "Planning a…" chips, "Three decisions", "What happens next", and no keycap (`08a-show-preview.png`). "Back to compact" returns. |

**Round-1 findings re-confirmed as still present:** B1 (white cleared-picks note), B2 (phone
Create clipped), B5 (Esc in the set search asks to discard, now also from the recents listbox),
B6 (no confirmation after Create or Save; Sessions dialog has a white frame, an invisible title,
clipped heads, a raw set id and "host Host"), B7 (stray summary row, worse at 720 as E7), B8
(topic picks lost on a format round trip), C1 ("Engage" / "Unfiled" badges), C8 ("match Search
“80s”"), and V2 (chips wrap "Event" alone, now in compact too). B3 ("Make a new set" lands in
the library) was not retested.

---

## 4. Overbearing or slow, as Sam

- **O1. Ctrl+Enter that does nothing** (E1, E2). This is the single thing that makes the dialog feel
  slow, even though most of the path is quick.
- **O2. "Show preview" brings back the whole guide** (E8). I only wanted to glance at the room
  screen, and I got re-taught Create → Start → Run.
- **O3. The format blurb under the chips** ("Open responses, then the room votes on the best
  ones.") is shown every time in compact. Frame 03 has none. Drop it in compact; it is in Format
  guide.
- **O4. The chip row wraps "Event" onto its own line** at 880px. Frame 03 fits seven chips on one
  line. That costs 42px and makes the row look unfinished.
- **O5. Advanced is two lines** at 1280 and always spells out every default. I still like it as a
  safety check (as in the earlier review). It is fine.
- **Good, and I would keep it as is:** the title autofocus, Enter in the title jumping straight to the
  search, recents visible without focusing, the fixed card size, the folded "Name · Format · Edit"
  line while choosing, "Esc keeps your set", the per-format set memory, the hand-off formats that
  never leave on the shortcut, and edit mode's "Changed: 1 topic switched off".

---

## 5. Ranked fixes

1. **E1: keep focus inside the dialog after a set is picked or kept** (focus "Change" or the first
   topic), and let the shortcut work when focus is on `body` while the dialog is open. Add a
   jsdom test: pick a recent with Enter, then fire Ctrl+Enter, and expect `onCreate`.
2. **E2: queue Ctrl+Enter during "Loading topics…"** (or announce it), so pick then ⌘↵ in one
   motion always creates.
3. **E7/B7: remove the pinned summary row in compact.** At 1280×720 it hides the topics.
4. **B2 + frame 10b: the phone compact layout.** Full-width 44px Cancel and Create, a one-line
   title, a segmented format row with "More ▾", a short placeholder ("Search 15 sets"), and
   untruncated recent names.
5. **B1 + E5: the paper styles leaking into `.gsd`.** The cleared-picks note and the off-chip hover
   both need dusk tokens and a composited-contrast assertion.
6. **E3: Enter on an empty search picks the first recent.** Also **B5: Esc in the search or recents
   must not reach the modal.**
7. **E8: "Show preview" opens only the preview pane in compact.** Drop the format blurb in compact,
   and fit the chips on one row at 880px (O3, O4).
8. **B8: restore topic picks on a format round trip,** as "Keep the set I had" already does.
9. **E4 / E6:** move "Format guide" after the radiogroup in tab order, and announce honestly when
   Event's Continue is disabled.
10. **B6:** confirm Create and Save in the Sessions list ("Created 9167 · press Start in the
    room"), and fix that dialog's frame and title.
