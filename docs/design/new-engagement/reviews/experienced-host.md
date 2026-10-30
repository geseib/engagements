# Review: an experienced host looks at the new-engagement mockups

*Reviewer persona: Sam, a professional facilitator with 60+ Engage sessions behind them. Mostly
Call & Answer for client work, Trivia for Friday socials, Events for offsites. Creates several
sessions a week, often in the five minutes between meetings, mostly from the keyboard. Changes the
question set mid-setup regularly. 30 Oct 2026.*

*Inputs: `index.html`, frames 01–11, `README.md`, today's modal
(`ux/baseline/01-modal-1440.png`), `GameSetupDialog.jsx`, `SetChooser.jsx`, `Modal.jsx`.*

---

## Verdict in one paragraph

The mockups fix the bug I actually hit: the stale categories and the modal growing and shrinking
on Change (5a/5b). They also give me a real keyboard path (radiogroup, Ctrl+Enter). Those two are
worth shipping. The design falls short in two ways. First, the "compact" mode is not compact:
420px of side pane keeps re-telling me my own title, format and set, and "What happens next"
explains Create → Start → Run to someone who has done it sixty times. Second, the chooser in 5a
silently drops five things I use today: Sort, Switch team, Make a set / Your question sets, the
Used / updated column and the "Used by you lately" grouping. The one frame an expert needs most,
the folded set picker showing my recent sets, is not drawn at all. Frame 3 skips straight past it.

---

## 1. The stopwatch

Counting the work after the modal is open. "T" is the keystrokes of the title, which is the same
on both sides. Assumptions are stated where the mockup does not say.

### A. Call & Answer from a set I used lately (my most common create)

| | Today | Mockup (compact, last format = C&A) |
|---|---|---|
| **Mouse** | click title · T · click the recent chip under the search box · click Create = **3 clicks + T** | T (if the title is autofocused) · click the recent set · **Ctrl+Enter** = **1 click + 1 chord + T**. 2 clicks + chord if the title is not autofocused. |
| **Keyboard only** | Tab ×3 to reach the title (help ?, X, title; `Modal` does not move focus on mount and the input has no `autoFocus`) · T · Tab ×7 through the format pills, which are separate tab stops · focus the search, which opens the list **and widens the card** · Enter picks row 0 · Tab through "Your question sets", 4–8 category chips, the briefing buttons, the Advanced summary and Cancel to reach Create · Enter ≈ **25+ keys + T**. Nobody does this. | (title autofocused) T · Tab (format radiogroup, one stop) · Tab (search) · Enter (first recent row) · Ctrl+Enter = **4 keys + T**. |
| **Rough time** | ~12 s | ~8 s |

The README claims "Five keystrokes and two clicks" in `index.html`. That is wrong: the title alone
is 20–40 keystrokes. Say "4 keys after the title" instead, which is the honest and still very good
number.

The mouse saving is real but small, one or two actions. The actual win is keyboard-only, from 25+
keys to 4. **That win depends on two things the mockup does not specify: title autofocus, and the
search box offering the recents without a full-body takeover.** (See §2, items 3 and 4.)

### B. Switching set mid-setup

| | Today | Mockup |
|---|---|---|
| **Mouse** | Change · (card animates 680→1120px; the old categories sit beside or under the table) · click the search, because it is **not** focused on Change · type · click the row · (card animates back) = **3 clicks + typing + 2 layout jumps**. Then I re-check the categories, because the old set's ids can still be in `activeCategoryIds` and Create would send them (README §2b.4). | Change · (body swaps, frame size fixed) · type · Enter or click = **2 actions + typing, 0 jumps**, *if* the search is focused when Change opens. 5a draws the search with an amber focus ring, but nothing in the README says focus moves there. |
| **Keyboard only** | Shift+Tab back to Change · Enter · Tab to search · type · ↓ · Enter | the same minus one Tab if search autofocuses |

Correctness matters more than the clicks here. 5b's "Your earlier picks belonged to the other set
and were cleared" is exactly the honesty I want. Create **must** be disabled during the skeleton
state. 5b draws Create bright beside the skeleton because the frame shows both states side by
side; make sure nobody builds from that picture.

### C. Trivia (Friday social; my last create was Call & Answer)

| | Today | Mockup (last = C&A) |
|---|---|---|
| **Mouse** | click title · T · Trivia pill · recent chip · Create = **4 clicks + T** | T · Trivia chip · recent set · Ctrl+Enter = **2 clicks + chord + T** |
| **Keyboard only** | Tab ×3 · T · Tab ×2 · Enter (Trivia) · Tab ×6 to search · Enter · Tab ~7 to Create · Enter ≈ **20+ keys** | T · Tab · → · Tab · Enter · Ctrl+Enter = **5 keys** |

If my last create *was* Trivia, the mockup saves one more click than today. If last-used guesses
wrong, the cost is the same as today. That makes remembered format a net win (see §4).

---

## 2. What slows me down or feels overbearing, ranked

1. **The side pane in "compact" mode repeats the left column (frames 3, 4, 5b, 6, 9, 11).**
   "Ready to create / What you're creating: Title ✓ Format ✓ Questions ✓" is the form I am looking
   at, restated 500px to the right. On a 1240px modal that is a third of the width spent on
   duplication. "What happens next: Create · Start · Run (· Report)" is re-teaching, and the brief
   says experts must not be re-taught. **For an expert, collapse the pane by default.** If anything
   stays, show only the *deltas*: a briefing attached, an Advanced change, a plan limit. Frame 9's
   amber "Changed: goal 8 questions" on the Advanced line already does that job in place.
2. **The frames disagree about what compact means.** README and frame 3 say "the preview is
   behind a link" in compact. Frames 4, 5b, 6 and 11 show the compact chip row *and* the full
   animated Room-screen-plus-phone preview. Pick one. My vote: preview behind "Show what the room
   will see", collapsed, and remembered.
3. **The folded set picker with "Used by you lately" is never drawn.** It is the single most
   important expert state: title typed, format pre-picked, three recent sets one click away. Frame 3
   jumps straight to "Ready or Not" already picked. `index.html` describes the recents as "one
   click under the search box", but no frame shows their layout, how many there are, or their
   keyboard behaviour. Draw it.
4. **Focus on the search box will take over the whole body.** Today `SetChooser` opens on focus
   when nothing is picked (`onFocus={() => { if (!chosen) openUp(); }}`). In the new layout,
   opening means the full-body takeover of 5a, side pane gone, so merely *Tabbing past* the field
   flips the screen. That breaks the 4-key path. Fix: on focus, show the 3 recents as an inline
   listbox (↓/Enter), and switch to the full chooser only when I type, press ↓ past the recents, or
   choose "Browse all N sets".
5. **No title autofocus is specified.** `Modal` deliberately does not move focus on mount, and the
   title input has no `autoFocus`. Without it, every create starts with a click or 3 Tabs. Autofocus
   the title in create mode; in edit mode, leave focus where it is.
6. **The 5a chooser leaves Name and Format taking ~190px above it,** so only four set rows are
   visible. While the chooser is open, fold Name and Format into one summary line ("Platform team
   — … · Call & Answer · edit") and give the list 8+ rows.
7. **Workie's briefing is still a 3-line card in compact (3, 4, 5b, 11).** The README promises
   "one dashed line"; what is drawn is ~90px with a two-sentence explanation I have read sixty
   times. Compact should be literally one line: `Workie's briefing (optional) · Add a document · write key points`.
8. **Helper copy shown every time:** "The room sees this on the main screen and on their phones"
   under the title, "Three decisions. Everything else has a sensible default" in the header (frame
   1), and "from this set" after CATEGORIES. These are fine on first run. Hide them in compact.
9. **Green tick badges and "Required" pills on every section header.** This is a reasonable
   checklist for a novice. For me it is three extra icons and the visual weight of a wizard on a
   one-page form. In compact, drop the "Required" pills; a tick appearing is enough.
10. **Arrow keys on the format radiogroup clear the set at every step.** `chooseFormat` wipes the
    set on any format change, which is correct because a set belongs to one format. Combine that
    with "←/→ changes it" (frame 3), and overshooting C&A → Trivia → back to C&A loses the set I
    already picked. Arrowing to Build Room or Event also swaps step 3 into a hand-off panel and
    rebinds Ctrl+Enter to "Continue to …" (7, 8). Remember the last set per format **within this
    open dialog**, so going back restores it. This is not the cross-session memory the owner
    retired.
11. **The phone (frame 10) has no expert variant.** It shows full description cards for C&A,
    Trivia and Poll, plus a preview, even though the ticks say this is a returning host. The
    categories are cut off under the foot. On a phone I want a one-line format selector and the
    recents.
12. **The Ctrl ↵ label is printed on the button.** That is fine on Windows. On a Mac it must read
    ⌘↵, and the binding must accept Meta. Detect the platform.

---

## 3. Power features the mockup loses or hides

Checked against `SetChooser.jsx` and `GameSetupDialog.jsx` as they ship today:

| Today | Where it lives now | In the mockup |
|---|---|---|
| **"Your question sets" / "Make a question set"** link under the picker, which opens `HostQuestionSetsDialog` | `GameSetupDialog.jsx:664-672` | **Gone from every frame** (3, 4, 5a, 6, 9). I use it to fix a typo in a set five minutes before a session. A must-keep. |
| **"Make a new set"** inside the open chooser and in its empty state | `SetChooser.jsx:342, 356-358, 414-416` | Not in 5a. |
| **Sort** (beside the count) | `SetChooser.jsx:270-275` | **Missing in 5a.** Topic, Tag and Updated survive; Sort does not. |
| **Switch team** | `SetChooser.jsx:254-266` | **Missing in 5a.** I work across client teams, so this is how I reach the right library. |
| **Owner tab named with the team's real name** ("Acme 2", not "Team 2") | `ownerWord` / `ownerChip` | 5a reads "Team 2" in the tab and "Team" in the row. Use the name. |
| **"Used by you lately" group header** at the top of the list | `SetChooser.jsx:380-381` | Not drawn in 5a. The rows are not visibly grouped. |
| **Used / updated column** ("you used it 3 days ago") | `SetChooser.jsx:371, 405` | **Missing.** The 5a columns are Set · Qs · Whose · Topic. That column is how I tell this week's version from last quarter's. |
| **Tags column** (wide) | `SetChooser.jsx:399-402` | Missing. Tags are still filterable but no longer visible per row. |
| **No-match exits, including "Other formats: Trivia — 3 sets"**, which switch format from the search | `SetChooser.jsx:344-359` | Not drawn. I often type a set name while on the wrong format; this recovers it in one click. Keep it. |
| **Esc clears the search, then a second Esc folds the list** (not closing the dialog) | `SetChooser.jsx:162-166` | Not stated. In 5a, Esc should equal "Keep the set I had". |
| **Image marker on set names, unreadable sets shown disabled with a reason** | `imageMarkerSuffix`, `isUnreadable` | Not drawn; presumably kept. Say so. |
| **Edit mode** (same dialog, format and set disabled, categories live) | `mode === 'edit'` | **Not drawn at all.** Editing an unstarted session must not open on a gallery or a "Ready to create" pane. |
| **Plan-limit notice / refusal line / goal-blocked reason** above the foot | `:747-763` | Not drawn in the new layout. Where do they sit with a two-pane body? |

---

## 4. "I know these — show compact" and remembered format

**Compact switch.** This works for me, but I should never have to press it. Auto-detection
("created at least one session", README Q2) is right, and I would accept a threshold of 1. Keep
the link for people who arrive with no history, such as a colleague's new account. Keep "Format
guide" as the way back for one look, without flipping the mode.

**Per browser or per account: per account.** I create from my laptop, a client's room PC, and
sometimes my iPad. With `localStorage` I get the novice gallery on every unfamiliar machine,
exactly where I am most rushed and least patient. Derive compact from my session history (which
the server already has) or from an account preference. Use `localStorage` only as a cache.

**Remembered format: yes, last-used, per account.** I alternate (C&A on weekdays, Trivia on
Friday), so last-used guesses right most of the time and costs exactly today's one click when it
is wrong. Do not use "most used", which would always say C&A and make every Friday a click worse.
The "last" tag on the chip is enough; no explanation needed.

**What to remember, and where:**

| Remember | Where | Why |
|---|---|---|
| Compact vs gallery | account | Same person on every device |
| Last format | account | As above |
| Side pane collapsed / preview hidden | account | A layout preference, like compact |
| Chooser owner tab and Sort (e.g. "Yours", "Recently used") | browser is fine | A convenience; harmless if lost |
| Last set per format | **only within the open dialog** | So format round-trips don't lose it; respects the owner's "no pre-selected set" rule |
| Anonymity, shuffle, goal, Workie's voice | **never** | Today's non-sticky rule is right (`GameSetupDialog.jsx:30-36`). A sticky "off" carries one room's decision into the next. |

---

## 5. Concrete suggestions

1. **Autofocus the title** in create mode. Make **Enter** in the title move to the next empty
   decision: format if none, else the set search.
2. **Draw and build the folded-recents state** (title, chips, three recent sets as one-click rows,
   ↓/Enter-able), and make focus on search show only those recents. The full-body chooser opens on
   typing or "Browse all".
3. **Expert side pane: collapsed by default,** with a slim rail or a "Show preview" link. If it
   shows anything, show only non-default choices and problems. Drop "What happens next" for anyone
   past their first create.
4. **Restore the chooser's missing controls in 5a:** Sort, Switch team, Make a new set, the
   Used / updated column (and Tags when wide), the "Used by you lately" group, the team's real name,
   and the cross-format no-match exits. Put **"Your question sets"** back beside the folded picker.
5. **On Change, focus the search** and fold Name and Format to one line so the list gets the
   height. Esc = "Keep the set I had".
6. **Per-dialog set memory per format,** so ←/→ overshoot or a C&A → Trivia → C&A round trip
   restores the set. Arrow keys across Build Room or Event should not silently rebind Ctrl+Enter to
   leave the dialog: require a deliberate Enter or click on the hand-off button.
7. **Compact means compact:** one-line briefing, no section helper copy, no "Required" pills,
   Advanced line kept as is (it is my safety check and earns its two lines).
8. **⌘↵ on Mac,** Ctrl+↵ elsewhere, detected and printed correctly.
9. **Answer README Q5 with yes:** add "Create and open the lobby" as a secondary action (Shift+Ctrl+Enter).
   For socials I create and start within a minute, and today that is a trip back through the
   sessions list.
10. **Out of scope but the biggest time-saver for weekly work:** "Create another like this" from a
    session in history (same format, set, categories and options, new title). My "Ops weekly —
    round N" sessions would go from 8 seconds to 3.
11. **Draw edit mode** in the new layout, plus the refusal and plan-limit placement, before anyone
    builds.
12. **Phone expert variant:** a format select or segmented control plus recents. Do not show
    description cards to a host with history.

---

## 6. Keep these

- **5a/5b: fixed frame size, chooser replaces the body, old categories gone, a skeleton while
  loading, the "earlier picks were cleared" note.** This is the bug fix, and it is right.
- **The format radiogroup as a single tab stop, the "last" tag, and Ctrl+Enter on the button.**
  These turn a 25-key keyboard create into 4.
- **Categories under the set, full width, with per-category counts and "5 of 8 categories · 10
  questions"** (4, 9). I can see at a glance how long the session will run.
- **The Advanced line naming every default and any change in amber** (9). I can glance at it
  instead of opening the fold.
- **The Build Room and Event hand-off with "Nothing is created yet"** and the price stated before
  I leave (7, 8).
- **"Format guide" as a one-line way back** instead of a permanent gallery.
