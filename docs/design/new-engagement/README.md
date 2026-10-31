# New engagement: redesign of the create modal

*30 Oct 2026, revision 2 (after the three reviews in `reviews/`). These are mockups and notes
only. No application code has changed. Open `index.html` in a browser. Each frame is drawn at
1440×900, 1280×720 (frame 12) or 390×844 for the phone, and the PNG files beside it are renders
of those frames. What changed after review is in §9.*

## The brief

The owner, verbatim:

> "There is a lot that needs to be worked through on the new engagement modal. I need to have
> agent act as an expert UX designer focus on usability and crisp clean design. there could be a
> flashy way to show the difference and explain what call and answer/ trivia/ poll build, event
> are. you could make better use of screen and window and right now if the users decides to
> change the question set during setup the catagories of the old question set stay up and the
> modal alignment is all wrong. think through this experience and then come up with a set of
> mockups ... the /goal of a great user experience creating a new engagement when the user has
> very little experience with the site. also a user with lots of experience, doesn't feel like
> its too overbearing with things they know already, they can quickly navigate and create
> sessions like they need to."

## 1. What is wrong today

The screenshots of today's modal on dev are in the session scratchpad
(`ux/baseline/01-modal-1440.png`, `-1280`, `-390`, with the text in `modal-text.txt`). Here is
what they show.

1. **The formats are seven same-weight pills with one grey line under them.** The 1440
   screenshot shows Call & Answer, Trivia, Poll, Wavelength, Survey, Build Room and Event as
   identical pills. Under them is one 13px sentence: the `blurb` of whichever pill is selected
   (`GameSetupDialog.jsx:583-600`). A new host cannot compare formats without clicking each pill
   and reading the line again. Build Room and Event are not regular sessions: each has its own
   setup screen, and Event costs money. Nothing shows this until the host clicks one of them.
2. **Call & Answer is pre-selected for everyone** (`:203-205`). An expert who always runs Trivia
   pays one click every time. A novice is never asked to choose, so they never learn that a
   choice exists.
3. **The modal does not use the window.** On a 1440 screen the card is 680px wide
   (`GameSetupDialog.css:92`), about 47% of the width, and the rest is empty backdrop. Workie's
   briefing already needs a scroll before the host reaches Advanced. The card only gets wider
   while the set list is open (`:96`, `gsd--wide`). The whole dialog then changes width when the
   host clicks Change and again when they pick a set, so everything moves.
4. **Nothing tells the host what will be created or what happens next.** The only forward-looking
   text is the foot note "Nobody can join until you start it". The host-setup help guide covers
   the Create → Start → Run sequence (`config/help/host-setup.js:42-45`). The dialog never shows it.
5. **Workie's briefing is a large dashed box with a pill saying "Call & Answer only".** In the
   1440 screenshot it takes about 170px. That is the largest block on the form, and it is an
   optional field.
6. **At 390px the format pills take three rows.** The set search placeholder is cut off mid-word
   ("type to se"), and the foot takes about 140px of an 844px screen.
7. **The bug the owner reported.** The root cause is in §2.

## 2. Root cause: changing the set leaves the old categories up and breaks the alignment

There are two faults. They happen in the same click, so they look like one bug.

### (a) Alignment: the old categories share a row with the opened chooser

- `GameSetupDialog.jsx:622` puts the set chooser and the categories in one flex row,
  `.gsd-row`. `GameSetupDialog.css:198-207` gives each child `flex: 1 1 220px`, so they sit side
  by side on a wide card.
- The categories render whenever a set is held: `newGameSetId && !isSurvey`
  (`GameSetupDialog.jsx:688`).
- Change opens the list without clearing the value (`SetChooser.jsx:198`). The design is
  deliberate: "Keep the set I had" (`:276`) has to restore it. So while the list is open,
  `newGameSetId` is still the old set, and **the old set's category grid stays rendered**.
- The open list is a six-column table: fixed widths of 52, 120, 150, 200 and 128px plus the name
  column (`SetChooser.css:187-191, 265-267`). In the same click, `onOpenChange` sets
  `chooserOpen` (`GameSetupDialog.jsx:656`), and the card grows from 680px to 1120px
  (`:517`, `.css:96`) over a 0.2s transition (`.css:97-99`).
- The table and the old categories now share one row, each starting from a 220px basis on a card
  that is still animating. The row either squeezes the table beside stale chips or wraps them
  under it, depending on how wide the card is at that moment. That is the broken alignment.

### (b) Stale categories: the page keeps the old set's list until the new fetch returns, and accepts any response

`handleSetupSetChange` (`GameHostPage.jsx:4179-4186`) calls
`fetchCategories(setId, false, scope)` (`:4111-4166`). That function:

1. **Does not clear anything before it awaits.** It only empties `categories` and
   `activeCategoryIds` when the id is empty (`:4112-4116`). For a new set it awaits
   `authFetch` and only then calls `setCategories(fetched)` (`:4127-4130`). Until then the grid
   shows set A's categories under set B's name.
2. **Has no guard against stale responses.** Nothing checks that the response belongs to the set
   that is now selected. Pick A, then B quickly: if A's response arrives second, A's categories
   overwrite B's and stay up.
3. **Leaves the old list in place on failure.** The `catch` (`:4164`) only logs, and `res.ok` is
   never checked (`:4127-4128`). A 403 or 500 keeps set A's categories on screen indefinitely.
4. **Lets Create send the wrong categories.** During that window, `activeCategoryIds` still holds
   set A's names. A Create pressed then sends them as `categoryIds` for set B
   (`GameSetupDialog.jsx:438`), and the masks are built against the wrong list.

### The fix, for the builder

- **Layout.** Never put the categories beside the set. Put them under it, full width. While the
  chooser is open, do not render the categories, and show one line in their place (frame 5a). Name and format fold into one line while it is open.
  Retire `gsd--wide` and the width transition. The new modal is wide from the start and never
  changes size.
- **Data.**
  - In `handleSetupSetChange`, clear `categories` and `activeCategoryIds` before the await.
  - Tag each request with the set ref it was made for, using a ref counter or an
    `AbortController`. Drop any response whose ref is no longer the selected one.
  - Treat `!res.ok` as an error, and on error leave the list empty with a sentence and a retry.
  - In the dialog, disable Create while the categories are loading, as it already does while the
    briefing is working.
- **Tests to add.** These are behaviour tests, with no geometry (jsdom has no layout):
  - Picking set B renders none of set A's category names, even before B's fetch resolves.
  - A late response for set A after set B is selected is ignored.
  - A failed fetch leaves zero categories plus an error line, not set A's.
  - Opening Change unmounts `SessionCategories`, and "Keep the set I had" brings back the same
    selection.
  - Create is disabled while the categories are loading.


## 3. Design principles

1. **Three decisions, then Create.** The required path is title → format → questions.
   Everything else sits under "Optional — every one has a safe default", and the Advanced line
   keeps naming every default in force (`config/setupDefaults.js`, unchanged). Two things are
   pulled out of Advanced because they decide what the room experiences: the **names rule**
   (Call & Answer; Names for Survey) and, for a returning host, a **time estimate** from their
   own history.
2. **One page, not a wizard.** Numbered sections tick as they are completed, on one scrolling
   page. Step 3 is visible from the first frame, greyed but readable.
3. **Show, then tell, once.** Every format is named once, on its card, with what it is and what
   it suits ("Good for: Retros, brainstorms"). Its preview plays **once, in under five seconds,
   when the card is hovered, focused or chosen**; otherwise it stands still in its end state.
   The side-pane preview plays once when it appears and has a Replay button. The CSS is written
   so that the **base styles are the end state** and animations only run *from* the start, so
   `prefers-reduced-motion` (which removes animation) shows the end state by construction.
4. **The window is the canvas, and it never moves.** Full mode is `min(1240px, 100vw − 48px)` and
   full height, with a form on the left and a 420px side pane on the right. Compact mode is a
   fixed 880px single column. Neither changes size while it is open. Only the body swaps
   (Compare, the chooser).
5. **Say what happens next, but don't repeat the form.** The side pane shows the preview, then a
   status-only checklist (required rows tick, optional rows carry a dash and "that's fine"; no
   empty circles), then "What happens next". The checklist and next steps are pinned to the
   bottom of the pane, so they stay visible at 1280×720 while the preview scrolls behind them.
6. **Learn once, then step aside.** A host with any session in their history gets compact mode:
   format chips, the recents list, a one-line briefing, no helper copy, no Required pills, no
   side pane unless they ask for it.
7. **The shipped language.** Dusk tokens, the laptop ladder 12 / 13 / 15 / 19 / 24 with nothing
   below 12px outside the stage picture, inputs at 15px, one Modal, the X and Cancel both through
   `requestClose()`, the discard question inline in the foot, and no modal opened from inside the
   modal (the set builders open in the existing sibling layer, as `HostQuestionSetsDialog` does
   today).
8. **Accessible by construction.**
   - One focus ring everywhere: 2px `--secondary` at a 2px offset (5.9:1 on the card).
   - One widget model for the format choice: `role="radiogroup"` with a roving tabindex (one tab
     stop, arrows move and choose). This applies to both the gallery and the chips.
   - Selection is never shown by colour alone: a tick and a 2px border on chips, cards and
     topics, plus the word "Chosen" on cards.
   - Disabled text is never dimmed with `opacity`.

## 4. Walkthrough of the frames

| # | File | What it shows |
|---|---|---|
| 1 | `01-first-time.png` | **First-time host.** Focus is in the title. Nothing is chosen and no card is highlighted. "Planning a…" offers Retro, Brainstorm, Kick-off, Team check-in, Quiz, Feedback form and Offsite day. Seven cards are laid out 4 across, each with a still preview, its name, one plain line and a "Good for" line. Build Room and Event say "Continues on its own page". "Compare side by side" and "I know these — show compact" sit in the step header, before the grid in tab order. Step 3 is visible. The side pane shows a placeholder preview, "Three decisions" with dashes, and "What happens next". Create is outlined, not dimmed. |
| 1b | `01b-retro.png` | **"Retro" points to the format.** The chip is pressed (with a tick). Call & Answer is chosen (tick, 2px border, "Chosen"). A live line explains why in one sentence. The preview is captioned "Example from a ready-made set. Yours will show your own questions." |
| 2 | `02-compare.png` | **Compare.** The praised rows are kept, with three corrected: **Pace** replaces the guessed "Typical length"; **Questions** reads "15 ready-made, or write your own"; **Starts** says Survey opens the moment it is created, with no Start step. The header, with each Use button, is sticky. The column for the pressed meeting type is labelled in words ("Suggested for a retro"). The group heads are `th scope="colgroup"`, with a hidden caption. |
| 3 | `03-expert-recents.png` | **Compact, before a pick.** The 880px card has no side pane ("Show preview" toggles it). The last-used format is pre-chosen and marked "last used". Focus in the search shows **Used by you lately** as a three-row listbox under it, with "Browse all 15 sets" beneath; the body does not switch to the full chooser. "Your question sets · Make a new set" sit beside the picker. Create shows ⌘↵ (Ctrl+↵ off Mac). |
| 3b | `03b-expert-ready.png` | **Compact, ready.** A one-line names rule, a one-line briefing, the Advanced line. The topics line carries an estimate from the host's own past sessions ("your rounds run about 6 min, so about 70 min"). No checklist, no "What happens next". |
| 4 | `04-call-and-answer.png` | **Call & Answer, full mode.** All topics start on ("Switch off any you want to skip"). A visible names card says "Names are hidden until the vote closes", in the shipped card's own terms, and the phone preview uses the same words. "Background for Workie" introduces Workie as Engage's AI assistant. "Your question sets · Make a new set" sits under the set. The checklist shows status only. |
| 5a | `05a-change-set-open.png` | **Change set.** Name and format fold into one line. The search is focused. The chooser has all of today's power: Sort, Switch team, the team's real name (Northwind), Mine / Northwind / Ready-made counts, Topic, Tag, Updated, Your question sets, Make a new set, the Tags and Used / updated columns, and the **Used by you lately** group. The highlighted row is drawn with the focus ring (combobox + `aria-activedescendant`). "Keep the set I had" sits beside the search, and Esc does the same. The current set says "✓ current". |
| 5b | `05b-change-set-done.png` | **Topics refresh.** The loading and loaded states are drawn side by side in dashed annotation boxes. While loading, the chips are still placeholders (no shimmer) and Create reads "Loading topics…". The cleared-picks note uses the status-message style. |
| 5c | `05c-no-match.png` | **No set fits.** "No Call & Answer sets match 'retro'", with today's exits (Clear the search · Other formats: Survey 1 set), then three ways to make your own: **Write your own questions** (manual builder), **Make a set with Workie** (AI generator) and **Fill in a spreadsheet** (template). These are the routes `HostQuestionSetsDialog` already offers hosts, preset to this format. The new set comes back already picked. |
| 6 | `06-trivia.png` | Trivia. No names line, because a trivia answer is a letter. The truncated set name carries its full text in `title`. |
| 6b | `06b-survey.png` | **Survey.** A Names card. The foot changes to "People can answer as soon as you open it. There is no separate Start." The button reads "Open the survey", and "What happens next" is Open / Collect / Close. |
| 7 | `07-build-room.png` | **Build Room hand-off.** The tiles carry ticks and arrows instead of numbers. ⌘↵ never leaves the dialog: it moves focus to Continue, and the foot says so. |
| 8 | `08-event.png` | **Event hand-off.** The same pattern. The Free-plan variant *replaces* the price line; it is drawn as an annotation. |
| 9 | `09-ready.png` | **Ready.** The checklist says "Done" instead of restating, and spells out only what the form does not show in full (the briefing's source, "stops after 8"). "Goal" is renamed **Stop after N questions**. No keycaps for the novice. |
| 10 | `10-phone-390.png` | **Phone, first-time.** 44px targets throughout, "Chosen" on the format, and a fade where the topics meet the foot. |
| 10b | `10b-phone-390-compact.png` | **Phone, compact.** The title, a segmented format row (last used first, "More ▾"), the search with the recents list, Your question sets · Make a new set, a one-line "Workie background", and Advanced. |
| 11 | `11-light.png` | **Paper re-tint** of frame 4, as a `.gsd--onlight` token block. Amber text is `#9A5B18`, and the done tick fills `#1F7A52`. |
| 12a/12b | `12a-laptop-1280x720.png`, `12b-compare-1280x720.png` | **1280×720.** The checklist and next steps stay pinned in the side pane, and the Compare header with its Use buttons stays stuck while the rows scroll. The foot is always visible. |
| 13 | `13-edit.png` | **Edit mode.** "Edit session" has no gallery. Format and set are shown fixed, with the reason and a lock; topics and options stay live. The side pane says what changed. A refusal or plan-limit notice goes at the top of the side pane (above the foot in compact mode). |

## 5. Novice and expert, step by step

**Dana (first time, a retro).** She types "Team retro — October" and presses **Retro**. Call &
Answer is chosen and one sentence says why. If she's unsure she opens Compare, which shows Survey
is for answering in your own time. In step 3 she searches "retro" and finds nothing (5c). She
presses **Write your own questions**, types three questions, saves, and the set is picked. All
topics are on. The names card tells her nobody sees who wrote what until the vote closes. She
skips Optional, reads "What happens next", and presses **Create engagement**.

**Sam (60+ sessions, keyboard).** The compact card opens with focus in the title. They type the
title and press Tab: format is already Call & Answer (last used). Tab again: the search shows
three recent sets. Enter picks the first. ⌘↵ creates. That is **four keys after the title**. If
they arrow to Trivia and back, the set they had for Call & Answer comes back.

## 6. Decisions and reasons

- **Compact and last format are per account, derived from session history. No new storage is
  needed.** `GameHostPage` already fetches `GET /games` every time the dialog opens
  (`GameHostPage.jsx:1019-1031`, for "Used by you lately"), and each row carries `byMe`,
  `gameType` and `createdAt`. "Has created at least one session" and "the newest session's
  format" fall out of the same response, on every device. `localStorage` holds only a cache of
  those two values, so the first paint picks the right layout before the request returns.
- **The explicit override is the exception.** "I know these" (novice → compact) and "Show the
  format guide every time" (expert → full) need a stored per-account preference. There is no
  user-preferences API today. Proposal: a `USER#<sub> / PREFS` row behind `GET` and `PUT
  /me/preferences`. Until that exists, the override lives in `localStorage`, because it is a
  per-viewer convenience whose loss costs one click.
- **The set is remembered per format only while the dialog is open.** This keeps the owner's
  rule ("should not remember or preselect that last picked question set",
  `GameSetupDialog.jsx:162-170`). Arrowing C&A → Trivia → C&A restores the set instead of
  clearing it.
- **Hand-off formats never leave on the shortcut.** On Build Room or Event, ⌘/Ctrl+Enter
  focuses Continue and announces it. Only Enter or a click on Continue navigates.
- **⌘ on Mac, Ctrl elsewhere.** Detected from `navigator.userAgentData.platform` with a
  `navigator.platform` fallback. The handler accepts either Meta or Control, and the button
  carries `aria-keyshortcuts`. Keycaps show only in compact mode.
- **Time: estimates from history, never guesses.** `GET /games` returns `roundsPlayed`, the start
  and `lastPlayedAt` for each of the host's sessions. Their median minutes per round in this
  format, times the questions that will be asked (after topics and "Stop after"), gives the
  estimate in 3b. With no history the line says "you set the pace". The compare table's guessed
  minutes are gone; the **Pace** row says who controls the pace instead.
- **Meeting types instead of abstract goals.** People say "retro", not "ideas and priorities".
  Each chip is a suggestion: it chooses a format and explains why, and any card can still be
  picked.
- **Names visible, in the shipped words.** The shipped card is explicit that names are revealed
  when voting closes (`SessionOptions.jsx:313-323`), so the new line says "hidden until the vote
  closes, then shown with the results" and the phone says "Your name is hidden until the vote
  closes". "Always hidden" is not something the product can do today (open question 2).
- **Keep the compare table, the Advanced line, "What happens next", the fixed-size body, and
  set-change-clears-topics-with-stable-height.** All three reviews praised them.

## 7. Open questions for the owner

1. **Preferences API.** Should a small `/me/preferences` row be built for the compact override,
   or is `localStorage` enough for an override the history-derived default rarely needs?
2. **Names "hidden from everyone, always".** The first-time reviewer asked for it for retros. The
   product reveals names when voting closes. Should a permanent-anonymity option exist?
3. **One noun.** The dialog says "engagement" and the list says "Sessions". Should one word be
   used everywhere?
4. **Create and open the lobby** (Shift+⌘↵), for hosts who start right away?
5. **"Create another like this"** from a session in history (same format, set, topics and
   options, new title). The experienced reviewer called it the biggest weekly time-saver. It is
   out of scope for this modal.
6. **Paper.** Is this dialog ever shown on a paper surface? If not, drop frame 11 and its test.
7. **Preview data.** Showing the chosen set's first question needs one read per pick. Is that
   acceptable?

## 8. Implementation map

**Files that change**

| File | Change |
|---|---|
| `src/src/components/GameSetupDialog.jsx` | Two layouts (full / compact) with fixed sizes, and three sections. Remove `chooserOpen` / `gsd--wide`. Topics under the set, never in `.gsd-row`, and not rendered while the chooser is open. Format `''` for a novice and `lastFormat` for an expert. `setByFormat` map (dialog-local) so format round-trips restore the set. `categoriesLoading` disables Create ("Loading topics…"). Title `autoFocus` in create mode, and Enter in the title moves to the next empty decision. ⌘/Ctrl+Enter submits when `canCreate`, or focuses Continue for Build Room or Event. A visible names line for Call & Answer that opens the existing anonymity card. A Survey foot with the warning line. Refusals at the top of the side pane. |
| `src/src/components/GameSetupDialog.css` | The `.gsd-body` grid (form + 420px side, the side pinned by `.side-sum`), the compact 880px variant, a `--gsd-side` token, `--gsd-focus` and one `:focus-visible` ring, the gallery and chip radio styles with a tick and 2px border, the outlined disabled primary, `kbd` at full opacity, preview art whose base state is the end state, still skeletons, 44px targets under 480px, and a `.gsd--onlight` re-tint block if paper is confirmed. |
| `src/src/GameHostPage.jsx` | `handleSetupSetChange` / `fetchCategories` (`:4111-4186`): clear before the await, drop stale responses, check `res.ok`, and expose `categoriesLoading` and `categoriesError`. From the existing `GET /games` effect (`:1019-1031`), derive `hasCreated`, `lastFormat` and `paceByFormat`, and pass them in. |
| `src/src/components/SetChooser.jsx` | **Keep every feature.** Change: on focus with nothing picked, open a *recents* listbox instead of the full chooser (new prop `recentsFirst`); the full chooser opens on typing, on ↓ past the recents, or on "Browse all". Focus the search when Change opens. "Keep the set I had" goes beside the search. Rows become `role="option"` driven by `aria-activedescendant`, named, with `aria-current` on the current set. Replace the search's `outline:none` with `:focus-within`. Base `wideCols` on the container width, not `matchMedia`. In the no-match state, show the three make-your-own routes after the exits. |
| `src/src/components/SessionOptions.jsx` | `SessionCategories`: label "Topics in this set", aria-labels "Architecture, 2 questions", a live total, still skeletons, an error with Retry, and the cleared-picks note through `StatusMessage`. `SessionBriefing`: a one-line variant ("Background for Workie · optional · Add a document · write key points") and the one-sentence Workie introduction in full mode. Goal copy renamed "Stop after N questions". |
| `src/src/components/HostQuestionSetsDialog.jsx` | Accept an `initialRoute` (`manual` / `ai` / `template`) and a preset format, so the 5c routes open straight into the right builder. It already hands back the list it fetched (`onSetsChanged`); the dialog then picks the new set. |
| `src/src/config/gameTypes.js`, `config/engagementKinds.js` | Add `short`, `good`, `room`, `get`, `pace` and `size` strings, plus a `MEETING_TYPES` list (meeting → format + reason). One source for the cards, compare, help and the phone list. |
| `src/src/config/help/host-setup.js` | Rewrite "Create engagement, field by field" (`:230-244`) for the gallery, the meeting chips, Compare, compact mode, the recents list, the names line, the no-match routes and the shortcuts. Run `node scripts/help-drift.js`. |

**New components:** `FormatPicker.jsx` (one radiogroup with two skins: gallery and chips),
`FormatPreview.jsx`, `FormatCompare.jsx`, `MeetingTypeChips.jsx`, `CreateSummary.jsx` (checklist
plus next steps) and `OtherFormatHandoff.jsx`.

**Tests to add or change**

- The behaviour tests in §2.
- `gameSetupDialog.test.jsx`:
  - A novice create has no format chosen, and Create is disabled.
  - `hasCreated` gives compact mode with `lastFormat` chosen.
  - The title has focus on open.
  - The format radiogroup has exactly one tab stop, and arrows select.
  - Arrowing C&A → Trivia → C&A restores the set.
  - ⌘/Ctrl+Enter submits only when `canCreate`, and on Build Room or Event moves focus to
    Continue without calling `onChooseOther`.
  - Survey shows the warning foot and "Open the survey".
  - The Free plan replaces the price line and disables Continue.
- `setChooser.test.jsx`:
  - Focus with nothing picked shows the recents listbox, not the full chooser.
  - Typing opens the full chooser.
  - Rows are reachable with ↑↓ and Enter.
  - Esc twice keeps the set.
  - The no-match state lists the three routes.
- `gameSetupDialogDom.test.jsx`: re-record it on purpose, and note the change in its header.
- `gameSetupPalette.test.js`, composited:
  - `--gsd-side`, the chip and card washes, the focus ring, the step-later colour and paper
    `#9A5B18` / `#1F7A52`.
  - No `opacity` on a text-bearing selector under `.gsd`.
  - Nothing under 12px.
- CSS contract:
  - `.gsd--wide` and the width transition are gone.
  - Every `@keyframes` used by the previews has no `to`/`100%` that differs from the base rule
    (end state = base).
  - No `animation-iteration-count: infinite` under `.gsd`.
- `helpContent.test.js` still passes after the help rewrite.

## 9. Changes from review

Every point the coordinator listed as "must address", and what was done. The reviews are in
`reviews/`.

### First-time host (Dana)

| Point | What changed |
|---|---|
| A path when no set fits; designed empty search | Frame 5c: the no-match state keeps today's exits, then offers Write your own questions, Make a set with Workie and Fill in a spreadsheet, which are the routes hosts already have. The new set comes back picked. Step 3 also offers "Write your own questions" before any search (1b). |
| "Retro" and common goals as chips | "Planning a…" chips: Retro, Brainstorm, Kick-off, Team check-in, Quiz, Feedback form, Offsite day. Each chooses a format and explains why in a live line (1b). The abstract goal chips are gone, and "Good for" moved onto the cards. |
| Anonymity stated plainly, consistent room/phone wording | A visible names card under the questions for Call & Answer (4) and a one-line version elsewhere (3b, 5b, 9, 13). The room preview, caption and phone all say "hidden until the vote closes". Survey shows its Names card (6b). "Always hidden" is an open question, because the product reveals names after the vote. |
| Compare-table contradictions | **Questions** is an offer ("15 ready-made, or write your own"). **Starts** for Survey reads "Opens to answers the moment you create it. No Start step." The Survey foot now matches (6b): a warning line instead of the lock line. |
| Introduce Workie in one plain line | "Workie is Engage's AI assistant: after each round it sums up what the room said." This sits on "Background for Workie" (4), and Workie is named the same way in 5c. |
| Session length from the set, or drop the guess | The guessed minutes are dropped everywhere (cards, compare, side pane). A real estimate appears only from the host's own history (3b); otherwise the line says "you set the pace". Compare's row became **Pace**. |
| No empty circles that look unfinished | Optional rows show a dash and "Not added — that's fine" / "Defaults". Only required rows tick. |
| Also taken from the review | Example banner on the pre-pick preview (1b). All topics start on, with "Switch off any you want to skip". Step 3 is visible in frame 1. The long "Seven formats" sentence is cut. "Own setup screen" → "Continues on its own page". "Engage" badge → "Ready-made". "QS" → "Questions". "Goal" → "Stop after N questions". Keycaps hidden for novices. "Categories" → "Topics". |

### Experienced host (Sam)

| Point | What changed |
|---|---|
| Compact must really be compact; draw it at phone width | Compact is a fixed 880px single column with no side pane, no checklist, no "What happens next", no helper copy, no Required pills, and a one-line briefing (3, 3b). The phone version is 10b. |
| Keep the chooser power features | Frame 5a has all of them: Sort, Switch team, the team's real name, Make a new set, Your question sets, the Tags and Used / updated columns, the "Used by you lately" group, and Other formats in the no-match state (5c). "Your question sets · Make a new set" also sit beside the folded picker in every frame. |
| Draw the picker before a pick, recents one click away | Frame 3 (and 10b): the recents listbox under the search. |
| Title autofocus | Specified (§8) and drawn (frame 1 focus ring). Enter in the title moves to the next empty decision. |
| Tab into search must not throw the full chooser | Focus shows the recents listbox only. The full chooser needs typing, ↓ past the recents, or "Browse all". |
| Arrowing chips must not clear the set; ⌘↵ on Build Room/Event must not leave silently | Set memory per format, local to the dialog. On hand-off formats ⌘↵ focuses Continue, and the foot says so (7, 8). |
| ⌘ on Mac | The keycaps read ⌘↵ in the mockups. Platform detection and the Meta-or-Control handler are specified (§6). |
| Remember compact and last format per account | Both are derived from `GET /games`, which the dialog already fetches, so they are per account with no new API. The explicit override needs `/me/preferences` (proposed); until then it lives in `localStorage`, for the reason given in §6. |
| Also taken from the review | Edit mode and refusal placement are drawn (13). Change focuses the search and folds name and format to one line (5a). Esc = "Keep the set I had". "Create and open the lobby" and "Create another like this" are listed as open questions. |

### Visual and accessibility

| Point | What changed |
|---|---|
| Pause control, or play once / on hover; correct reduced-motion end states; no infinite shimmer | Previews play once, in under 5s, only on hover, focus or chosen. The side pane has Replay. The base CSS *is* the end state (Trivia's C green, Survey ticked and full, Call & Answer's winner amber), so reduced motion shows it. Skeletons are still. No infinite animation remains (the caret no longer blinks). |
| Visible focus everywhere; chooser rows reachable | One `:focus-visible` ring for every control. `.srch:focus-within` replaces `outline:none`. Chooser rows are combobox options with `aria-activedescendant`, drawn with the ring on the active row (3, 5a, 10b). |
| Selection not by colour alone | A tick and a 2px border on chips, cards and topics. "Chosen" on cards. "Suggested for a retro" in words on the compare column. "✓ current" on the current set. |
| Contrast ≥ 4.5:1, including dimmed step 3 and key hints | Step 3 uses `--muted` text (7.0:1) with no opacity. `kbd` is at full opacity and inherits the button colour. Disabled Create is outlined with a muted label (7.0:1) instead of a dimmed amber block. Paper uses `#9A5B18` and `#1F7A52`. |
| One radio-group keyboard model | Gallery and chips are both `role="radiogroup"` with a roving tabindex. Each card's name is the format; its description is `aria-describedby`. |
| Frame 1 density; no hover-state card; ≥12px; labels named | Formats are named once (cards only). The side pane no longer repeats them. No card is drawn hovered. The render script audits every UI text node and finds none under 12px (the stage picture is `aria-hidden`). The title uses `aria-labelledby` on "Name it". Topics are named "Architecture, 2 questions". Previews are `aria-hidden` with a caption. The phone dialog has `aria-modal` and a label. The compare table has a `colgroup` header and a caption. The preview tabs are `aria-pressed` buttons. |
| 1280×720: checklist and Compare actions reachable | Frame 12. The checklist and next steps are pinned to the bottom of the side pane; the Compare header with its Use buttons is sticky. |
| Also taken from the review | Dashed borders now mean only "placeholder or annotation" (meeting chips and the briefing line are solid). The hand-off tiles are unnumbered. The cleared-picks note uses the status-message style. The Free-plan line *replaces* the price. The unused `transform` transition is removed. 44px targets on the phone, plus a fade cue. |

### Declined, and why

- **Removing the subtitle "Three decisions. Everything else has a sensible default."** to save
  30px at 720 (visual review). The first-time reviewer named it the most reassuring line on the
  screen. It stays in full mode only; compact drops it.
- **"Names: hidden from everyone (always)" as a setting** (Dana). The product cannot do it:
  names are revealed when voting closes. The wording now says so plainly, and it is listed as an
  open question.
- **Pre-filtering step 3 by meeting type** (Dana: "Retro" filters to retro sets). Sets carry
  tags, but no retro sets exist in the demo library and nothing guarantees a tag vocabulary. A
  filter that usually empties the list would send novices to 5c every time. The chip chooses the
  format and leaves the set search open.
- **Renaming the product nouns** ("engagement" vs "session"). This is product-wide, not a modal
  change; it is an open question.
- **Dropping frame 11 now** (visual review D3). Kept as a re-tint block pending the owner's answer
  on whether the dialog ever renders on paper.

## 10. Notes on the mockups

- The previews are illustrations of the room. Text inside the stage picture is below 12px because
  it is a scaled picture of a projected screen. It is `aria-hidden`, and the caption beside it is
  the accessible description.
- Call & Answer and Trivia use the real demo sets. There are no Poll, Wavelength or Survey demo
  sets, so frame 6b's survey set and 5a's extra sets (Incident Review Starters, Team Health
  Check) are illustrative.
- The PNG files are captured after the single-play animations finish, so they show end states.
- The helper scripts that generate `index.html` and the PNG files are kept outside the repo.

## Round 2 — owner feedback

*30 Oct 2026. The owner reviewed the dialog on test (commit `7fc7e30b1`); their notes are in
`feedback/owner-2026-10-30.md`. The mockups are in `index-2.html`, and each PNG is prefixed
`2-`. Rounds 1 and 2 above still stand except where this section says otherwise.*

### Frames

| # | File | What it shows |
|---|---|---|
| 2-01 | `2-01-guided-expert-1440.png` | Guided view, which is now the default for everyone. An experienced host sees format **chips** (no gallery) next to the walkthrough pane, on step 3 of 5, using their own set's question. The **Guided / Quick** switch is in the header. |
| 2-02 | `2-02-quick-1440.png` | Quick view at **1060px** (was 880). The seven chips sit on one line and the topics have room. Same switch, same place. |
| 2-03 | `2-03-guided-first-1440.png` | Guided view for a first-time host. The gallery stays, with the plain descriptions on the cards. The walkthrough starts at step 1. |
| 2-04 | `2-04-storyboard-call-and-answer.png` | The full Call & Answer walkthrough: five steps plus "What you get", drawn at the pane's real size. |
| 2-05 | `2-05-step-lists.png` | Trivia, Poll, Wavelength, Survey, Build Room and Event: the step list for each, one picture per step, ending with "What you get". |
| 2-06 / 2-07 / 2-08 | `2-06-guide-1440x900.png`, `2-07-guide-1280x720.png`, `2-08-guide-1850x1000.png` | The Format guide at three window sizes. All seven formats are visible at each size with nothing clipped. |
| 2-09 | `2-09-guide-phone-390.png` | The Format guide on a phone: one format at a time, with ‹ › to move between formats. |
| 2-10 / 2-11 | `2-10-guided-1280x720.png`, `2-11-quick-1280x720.png` | Guided and Quick on a 1280×720 laptop. |

### Decisions

1. **Guided by default, and the switch is always visible.** A segmented **Guided | Quick**
   control sits in the header next to Help and the X, in every view including the Format guide.
   - The radiogroup shows its state with a tick and a border, not by colour alone.
   - It replaces both "I know these — show compact" and the "Always open with the full guide"
     link that was buried inside the guide.
   - The choice is remembered per browser in `localStorage`, wrapped in try/catch. It is a
     convenience, and losing it costs one click. A per-account copy waits on the
     `/me/preferences` row proposed in round 1, §6.
   - With nothing stored, the dialog opens in Guided view. Round 1's "derive compact from
     history" rule is retired. Round 1's history-based time estimate (frame 3b, §6) is also
     dropped: `formatGuide.js` notes that `GET /games` carries no start time.
2. **Inside Guided, a returning host gets chips instead of the gallery.** The gallery is for
   someone who has never created a session. A host who has, still gets the walkthrough pane.
3. **Quick is 1060px.** At 880px the chips wrapped and the topics felt cramped. At 1060px both
   fit at 1280 and 1440, and the dialog still reads as the smaller, faster one.
4. **The preview becomes a walkthrough.**
   - The visual style stays the same. Each step pairs **You** (what the host does), **Phones**
     and **Room screen**, with a picture of both screens.
   - Controls are ‹ Back, step dots (the last dot is "What you get"), and Next ›.
   - **▶ Play** is off by default. When on, it advances every 8 seconds, pauses while the
     pointer or focus is inside the pane, and stops at the last step. It is not offered under
     reduced motion. Changing the format resets to step 1.
   - Pictures are built from boxes as today, with no images. Each step's picture is its end
     state, so nothing depends on animation.
5. **Call & Answer's steps are written in the owner's words and checked against the help.**
   1. You ask a question.
   2. Everyone answers on their phone.
   3. Everyone reads all the answers and votes. Phones say "Rank your top three"; there are no
      names on the stage or the phones while voting (`player.js` Voting).
   4. The results, ranked, and Workie's read. "The room's pick" comes first, and names go up
      with the results (`host-running.js`).
   5. Comments, then the next question. Comments are asked for after Workie's read, either with
      **Open comments** or **Request feedback**, and they carry the writer's name
      (`host-reports.js`).

   Then **What you get**: the report.

   The owner's draft said "votes for their favourites". The steps say "votes" and spell out the
   top three, because that is what the phone asks. The draft's "a word scores when everyone
   wrote it" (Wavelength) became "counts", because the help says Wavelength has no winners and
   nobody scores.
6. **The Format guide is two rows, not a seven-column table.**
   - **Top row:** the walkthrough of the format being shown. It has a picture, a plain one-line
     summary, the current step with You / Phones / Room screen, the controls, a rail listing
     all the steps (dropped below about 1400px), and the single **Use [format]** button.
   - **Bottom row:** seven short cards, one per format, acting as tabs (arrow keys move between
     them). Each card has the name on one line, a one-sentence plain description, Good for,
     Group and Starts. Group labels sit above their cards.
   - **Why:** the owner's complaint was that the table "doesn't shed light on what happens".
     Six rows × seven columns of prose was the least readable way to answer that, and it is
     what clipped. The cards keep the at-a-glance comparison, short enough to scan in one
     sweep. The walkthrough answers "what happens".
   - **No per-card Use buttons**, so nothing can clip. Picking a card shows it above, and the
     button is there.
   - **Width:** the guide always uses `min(1760px, window − 48px)`, whichever view opened it,
     and returns to that view's width on Back. Measured: nothing clipped at 1280×720, 1440×900
     or 1850×1000; every format name fits on one line.
7. **The phone guide shows one format at a time.** ‹ › and swipe move between the seven
   formats (with "1 of 7"). The walkthrough has its own ‹ › and dots, and **Use [format]** is
   full width in the foot.
8. **Plain descriptions** come from the lead's draft (`feedback/copy-draft.diff`), with three
   fixes:
   - Wavelength: "counts", not "scores".
   - Survey: "with names only if you chose that".
   - Trivia: "you reveal the answer". I could not confirm that every set's explanation is shown
     on the stage, so the copy does not promise it.

   Each format has three lengths: the card line, the guide's summary, and "What you get".

### For the builder

- **`GameSetupDialog.jsx`**
  - Add `view` (`'guided' | 'quick'`), defaulting to guided and stored in `localStorage`.
  - Add the header switch.
  - In guided view, show the gallery only when `!hasCreated`; otherwise show chips.
  - Remove the "Always open with the full guide" link and "I know these".
  - Set the Quick width to 1060px in `GameSetupDialog.css` (`.gsd--compact`).
- **New `FormatWalkthrough.jsx`**, which replaces `FormatPreview` in the pane:
  - Steps come from a new `config/formatWalkthrough.js`, as `{ title, you, phones, room, art }`
    per step plus `get`.
  - Back / Next / dots and an optional Play: an interval paused on `pointerenter` and
    `focusin`, and never started when `matchMedia('(prefers-reduced-motion: reduce)')` matches.
  - Reset to step 1 when the format changes. The pane announces "Step n of m" politely.
- **`FormatCompare.jsx`:** rewrite it as the two-row guide. It renders full-width regardless of
  layout (a `gsd--guide` class on the card, `width: min(1760px, calc(100vw - 48px))`). Cards are
  `role="tab"`; the top row is the `tabpanel`. On a phone it becomes the one-at-a-time view.
- **`config/formatGuide.js`:** apply the plain copy, adding `col` (card line) and `get` per
  format.
- **Tests:**
  - The view switch defaults to Guided and persists.
  - Quick never shows the walkthrough.
  - Play never starts under reduced motion, and pauses on focus.
  - Changing format resets to step 1.
  - The guide's card count is seven, each card name is a single text node with
    `white-space: nowrap`, and there is exactly one Use button.
  - Re-record `gameSetupDialogDom.test.jsx` on purpose.
- **Help:** update `host-setup.js` for the switch, the walkthrough and the new guide. Run
  `node scripts/help-drift.js`.

### Open questions

1. Should Play exist at all, or are Back and Next enough? It is off by default here.
2. The "Guided" view is remembered per browser. Should it follow the account once
   `/me/preferences` exists?
3. Should the walkthrough's pictures use the chosen set's real questions on every step (one read
   per pick), or a ready-made example until a set is picked, as now?

## Round 3 — one view, not two

*30 Oct 2026. The owner, on the round-2 build: "think through the experience again because the
guided vs quick is not intuitive." The mockups are in `index-3.html`, and each PNG is prefixed
`3-`. The walkthrough content and the visual style from round 2 are kept.*

### What is wrong with Guided | Quick

1. **Two abstract names for one dialog.** Neither word says what is on screen. "Quick" doesn't
   say what it removes, and "Guided" doesn't say what it adds.
2. **You can't tell what the switch does until you press it.** The whole layout changes at once:
   the width, the pane, the gallery and the helper copy.
3. **A returning host doesn't know why the screen looks different.** The choice is remembered
   per browser, so the dialog can open in a shape the host doesn't remember choosing, with
   nothing on screen explaining why.
4. **The useful thing is tied to a mode.** The walkthrough is what the owner asked for. Putting
   it behind a mode makes the host choose a mode in order to see an explanation.

### The options

| | A — one layout; "How it runs" beside the form, hideable | B — the form alone; "How it runs" opens inline | C — a one-line step strip; the pictures live in the guide |
|---|---|---|---|
| Frames | `3-A1-one-layout-open-1440.png`, `3-A2-one-layout-hidden-1440.png` | `3-B-inline-1440.png` | `3-C-stepline-1440.png` |
| What changes the layout | One button, **Hide**, on the walkthrough itself. Hidden, the pane becomes a rail that reads "Show how Call & Answer runs". | A "How it runs ▾" link at the end of the format's plain line. | Nothing. |
| **Dana** (first time) | Sees what happens before committing, in pictures, with nothing to learn first. ✓ | Must notice a small link to find the most useful thing. When it opens, Questions is pushed down while she reads. ✗ | Gets the order of events in words, but not the phone and room-screen pictures that made round 2 work. ~ |
| **Sam** (keyboard, zero teaching) | Hides it once and never sees it again. The rail is out of the tab order's way (one stop), and the 4-key path is unchanged. ✓ | Nothing appears unless asked. ✓ | One line to ignore. ✓ |
| **Owner's words** ("I don't see the preview right away"; "not intuitive") | The walkthrough is on screen from the first open, and there is no mode to explain. ✓ | The walkthrough is hidden by default, which is the round-2 complaint again. ✗ | The visual walkthrough is reduced to text on the main screen. ~ |
| Layout stability | Fixed dialog size; hiding only gives the form more width. ✓ | The form grows and shrinks inside itself. ✗ | Stable. ✓ |

### Recommendation: A

- There is **one layout**: the form on the left, "How [format] runs" on the right, open by
  default.
- The **only control is Hide**, which sits on the thing it hides. Hidden, the pane folds to a
  56px rail labelled with what it holds ("Show how Call & Answer runs"), so a host who hid it
  can see what is there and how to get it back. The format name on the rail follows the chips.
- **Shown or hidden is remembered per browser.** If it is lost, the pane simply shows, which is
  the safe default.
- **Gallery or chips depends only on whether the host has created before.** That is no longer a
  mode, just the right picker for what they know.
- **The Format guide stays as the explorer**, opened from "Compare formats".
- **The Guided | Quick switch is removed**, and so is the separate 1060px Quick width. Hiding
  the pane gives the form that width inside the same fixed dialog.
- **At 1280×720** (`3-A1-recommended-1280x720.png`) the pane fits with Back and Next above the
  fold.
- **On a phone** (`3-A-recommended-390.png`) there is no room beside the form, so "How it runs"
  is a fold directly under Format. It follows the same remembered choice, and is open on a first
  create.

### For the builder

- **Remove** the `view` state, the header switch and the `gsd--compact` width.
- **Keep** `hasCreated` → gallery or chips.
- **Add** a `howItRunsHidden` boolean, kept in `localStorage` and wrapped in try/catch. The pane
  has a **Hide** button (`aria-expanded`, `aria-controls`). The rail is one button, named "Show
  how [format] runs".
- **Keyboard:** focus moves to the rail button when the pane is hidden, and back to Hide when
  it is shown.
- **Move** the keycaps on Create to every host, because there is no longer a "quick" host to
  reserve them for. They are `aria-hidden`, and the shortcut lives in `aria-keyshortcuts`.
- **Tests:**
  - No view switch is rendered.
  - Hide collapses the pane to a rail whose name includes the format.
  - The hidden state persists, and survives `localStorage` throwing.
  - A first-time host gets the gallery and a returning host gets chips, in both states.
- **Help:** replace the Guided/Quick paragraph in `host-setup.js` with one line about Hide and
  the rail.

## Round 4 — show the next decision, not all of them

*31 Oct 2026. The owner, on the shipped round-3 dialog: "i wonder if it would be less daunting if
we revealed the sections as needed? As this seems overwhelming to a newbie". The mockups are in
`index-4.html`, and each PNG is prefixed `4-`. The review is in `reviews/round-4.md`. Rounds 1–3
stand except where this section says otherwise. No application code has changed.*

### The problem

The owner's screenshot (about 1440px wide) shows every section at once:

- Name it.
- Format: seven chips, Compare formats and a description.
- Question set: search, Browse all, Your question sets and Make a new set.
- The names card.
- "OPTIONAL — EVERY ONE HAS A SAFE DEFAULT", with Background for Workie and a 30-word Advanced
  line.
- A storyboard pane with a stage index.
- A status line of Title · Format · Questions.
- Create.

That screenshot is the **returning host's** view: chips, with the last format already chosen. A
true first-timer today sees a heavier version. They get seven meeting chips and seven gallery
cards, each with a mini picture that the pane beside them draws again at three times the size. A
greyed "3 Questions — Choose a format first" waits underneath.

Every one of those things was added for a reason in rounds 1–3. The problem is that they all
compete at once, so a newcomer cannot tell which one to deal with first.

### Decisions

1. **One rule for everyone: a section appears when the decision above it is made, and stays
   while the dialog is open.** This applies to every host, not only first-timers.
   - A host with history is not given a different dialog. ~~They start two decisions in, because
     their last format is preselected, so Question set is there on open (frame 4e).~~ Superseded
     by the revision of 31 Oct below: they start where a first-timer does.
   - There is no `hasCreated` branch for what is shown and no remembered "revealed" state.
     Everything is derived from the decisions on screen.
   - Round 3 removed a mode for exactly this reason: a dialog whose shape depends on something
     the host cannot see. (Fork 2 below.)
2. **The title gates nothing.** It is required only to create. Typing never reveals anything, so
   nothing appears while the host is mid-word, and a host who decides "it's a quiz" before
   naming it is not held up. Frame 4b shows that after the title, only the foot's line changes;
   Enter moves focus to the formats, as it does today.
3. **Name it and Format are on screen from the start.** Format is the interesting decision, and
   the pane's preview follows the card under the pointer or focus, so it helps a first-timer
   choose.
4. **Choosing a format reveals Question set.** It appears with a 180ms fade and a 4px rise, once
   per dialog; under reduced motion it is simply there. It lands directly under Format, and its
   heading is on the first screen at 1440×900 and 1280×720 (frames 4c, 4f).
5. **Picking a set reveals the names card, Background for Workie and Advanced.** Before there is
   a set there is nothing to be anonymous about, and the first-time reviewer said the names card
   "turned up right when the questions did".
6. **Create is always in the foot.** Until the decisions are in, it is outlined, and the foot
   says "Still needed: a title, a format and a question set." (shortening as each is made). Once
   ready, the foot says "Nobody can join until you start it." and Create fills.
   - The button is `aria-disabled`, not `disabled`, so it stays reachable.
   - Pressing it early moves focus to the first gap and says which (review A1).
7. **The right pane is present from the first frame, kept quiet** (Fork 1 below).
   - **Before a format is chosen**, it shows one sentence ("Pick a format and this side shows
     what happens in the room, stage by stage.") and **one** example stage, labelled "Example ·
     Call & Answer, stage 1 of 6". There is no index and no storyboard.
   - **While a gallery card has focus or the pointer**, the pane shows that card's storyboard,
     debounced (shipped), with "A preview of the card you are on".
   - **Once a format is chosen**, the pane shows the full storyboard and its index.
   - Hide and the rail are unchanged.
8. **The pane's status line is dropped**, because the foot's "Still needed" says the same thing
   beside the button it concerns. Edit mode keeps its summary rows.
9. **Density cuts, for everyone:**
   - **No step numbers or ticks** (1, ✓, 3). They counted steps that waited on screen, and
     nothing waits now. A finished section shows its answer, and that is the tick.
   - **No "OPTIONAL — EVERY ONE HAS A SAFE DEFAULT" header.** Two quiet fold lines remain:
     "Background for Workie · Optional" and "Advanced · Defaults: questions shuffled, Workie's
     standard summary" (or "Changed: …" in amber). The full defaults sentence moves inside the
     fold. The names rule was being stated twice on one screen, on the names card and in the
     Advanced line (design-system hard rule 5).
   - **The gallery becomes text cards, three across, with no mini pictures.** The pane draws the
     same pictures larger and follows focus. Build Room and Event share the sixth cell as two
     quieter rows under "Bigger than one session", each with a three-word line and "each
     continues on its own page". This makes the gallery two rows instead of two rows of tall
     picture cards, and is what puts the revealed section on the first screen at 1280×720.
   - **The title's help sits beside its label**, which saves a line.
   - **"Your question sets" shows only to a host who has a set**; otherwise there is one link,
     "Make your own set".
   - **A one-line explanation of what a set is** ("The questions you will ask. Start from a
     ready-made set; you can switch topics off once it is picked.") shows only when "Used by you
     lately" is empty.
10. **On a phone, "How it runs" is a closed fold** (it was open in round 3). Open, its stacked
    stages push the revealed Question set two screens down (frame 4g).

### The reveal rules, precisely

| Section | Shown when | Hidden again when |
|---|---|---|
| Name it | Always | Never |
| Format (gallery or chips, by `hasCreated` as today) | Always | Never |
| Question set | `engagementType` is set. Since the 31 Oct revision this is never true on open for a new engagement | Never for a session format. Choosing Build Room or Event puts "Next: the … page" (`OtherFormatHandoff`) in the **same slot**; choosing a session format again brings Question set back with the set it had (`setByFormat`, shipped) |
| Topics | A set is picked (unchanged) | The set is cleared or the chooser is open (unchanged) |
| Names card (C&A, Survey), Background for Workie (C&A), Advanced | A set has been picked **at any point** while the dialog is open (`revealed` latch, dialog-local) | Never while open. Each shows only for the formats it applies to, as today. A hand-off format hides them along with Question set; returning brings them back |
| Gallery → chips | A set is picked (shipped `galleryDone`), or a hand-off format is chosen (shipped) | — |
| Create | Always | Never. `aria-disabled` + "Still needed: …" until title, format and set are in (or, on a hand-off, until the format is chosen and not blocked) |
| Edit mode | Everything, from the start | — |

**Motion.** The entrance is opacity 0→1 plus translateY(4px→0) over 180ms ease-out, and runs
once per section per dialog. The base CSS is the end state; the animation is declared only under
`prefers-reduced-motion: no-preference`. Nothing animates height or the position of other
content. Swapping a section's contents (a format change) never animates.

**Focus.** A reveal never moves focus. Focus moves only where it does today: Enter in the title
goes to the format's tab stop, and Enter on a format goes to the set search. New sections follow the current one in DOM order, so the next Tab reaches them.
Each is a `<section aria-labelledby>` with an `h3`.

**Announcements.** There is one polite live region (the existing `.gsd-sr`) and at most one
message per action:

- "Question set is below." on its first reveal only.
- "Next: the Build Room page, below." (or "the event page") once per swap to a hand-off format.
- Nothing when returning to a session format, or when names and options appear. They arrive
  below the set just picked and are the next Tab stops, and a second message would talk over
  the chooser's own feedback on the pick.
- A meeting chip's reason and the reveal are one message.
- The foot's "Still needed" is **not** live.

**Create pressed early** (click, Enter or ⌘/Ctrl+Enter) moves focus to the first gap, in the
order title, format tab stop, set search. It announces "Add a title first." / "Pick a format
first." / "Pick a question set first." The shipped queue-while-topics-load (`pendingCreate`) is
unchanged.

### What stays for experienced hosts

- The last format is marked "last" and is the format group's tab stop. (Until 31 Oct it was
  also preselected, so Question set was on screen at open; see the revision below.)
- The search shows "Used by you lately" on focus.
- The rail is remembered if they hid the pane.
- ⌘↵ and the keycaps stay.
- The key path, since 31 Oct: type the title, Enter (the last format), Enter (picks it, on to
  the set search), Enter (the recent set), ⌘↵.

What they lose is the step numbers, the status line, the uppercase header and 25 words of the
Advanced line. The names card and options now arrive with the set, which costs no keys: in the
review, Sam never touches options before the set.

### Forks

| | A (recommended) | B |
|---|---|---|
| **1. The pane before a format is chosen** | Present from the start, quiet: one sentence and one labelled example stage (frame 4a) | Absent until a format is chosen (frame `4-fork1-B-no-pane-1440.png`) |
| Why | B is calmer on open, but the pane's arrival takes 420px from the form at the moment of the click, so the cards re-wrap under the pointer that just pressed one. It also loses the hover and focus preview that helps a first-timer choose (4b). | |
| **2. Who gets the reveal** | Everyone, by one derived rule (frame 4e) | `hasCreated` hosts see every section at once, as in the proposal (frame `4-fork2-B-expert-all-1440.png`) |
| Why | B is no faster (same key path), and it reintroduces two shapes of one dialog chosen by history the host cannot see, which is round 3's lesson. A first-timer's second visit would look different from their first. | |

### Frames

| # | File | What it shows |
|---|---|---|
| 4a | `4-a-open-1440.png` | First time, on open: Name it and Pick a format only; text cards; the quiet pane; "Still needed" in the foot |
| 4b | `4-b-title-1440.png` | After the title and Enter: focus on the first card, the pane previewing it; nothing revealed |
| 4c | `4-c-format-chosen-1440.png` | Retro pressed → Call & Answer; Question set revealed (dashed outline = annotation); full storyboard |
| 4d | `4-d-ready-1440.png` | Set picked: chips, topics, names card, two quiet optional lines; Create filled |
| 4e | `4-e-experienced-1440.png` | A host with history: last format chosen, Question set with recents, pane as the rail (superseded 31 Oct: nothing is chosen on open) |
| 4f | `4-f-1280x720.png` | 4c on a short laptop: the revealed heading is on the first screen |
| 4g | `4-g-phone-390.png` | 4c on a phone: format rows, the storyboard folded, Question set revealed |
| Fork 1 B | `4-fork1-B-no-pane-1440.png` | No pane until a format is chosen (not recommended) |
| Fork 2 B | `4-fork2-B-expert-all-1440.png` | A returning host sees every section at once (not recommended) |

### Open questions for the owner

1. **Show three ready-made sets under the search for a first-timer?** Dana asked for it. The
   cost is a taller revealed section that no longer lands on the first screen at 1280×720, and a
   choice of *which* three (there is no "popular" signal today).
2. **Text cards instead of picture cards in the gallery.** The pictures were round 1's "flashy
   way to show the difference". They live on, larger, in the pane. Is that acceptable?

### For the builder

**`src/src/components/GameSetupDialog.jsx`**

- **The reveal.**
  - Add a dialog-local `revealed` ref/state, set to true the first time `newGameSetId` is
    non-empty. Seed it true in edit mode.
  - Render `questionsStep` only when `hasFormat`. Delete the `is-later` placeholder branch and
    "Choose a format first, then …".
  - Render `namesBlock` and `optionalBlock` only when `revealed` (and `hasFormat && !isOther`,
    as now).
- **The entrance.**
  - Add a class `gsd-reveal` on a section's first mount per dialog. Track it in a `Set` ref of
    section ids already shown; skip the class after the first time.
- **Announcements.**
  - Write to the existing `announce` state, once per first reveal and once per hand-off swap.
  - In `pickMeeting`, compose the reason and the reveal into one string. The reason paragraph
    loses its own `aria-live`, and the single region speaks.
- **Step numbers.**
  - Remove `stepMark` and every `gsd-step-n`. The headings stay `h3`; "Pick a format" / "Format"
    is unchanged.
  - Move the title help into the heading row.
- **Optional.**
  - Remove the `gsd-optional-h` heading.
  - The briefing summary reads "Optional" (or "added · Workie will use it").
- **Create.**
  - Replace `disabled={!canCreate || busy}` with `disabled={busy}` and
    `aria-disabled={!canCreate || undefined}`.
  - Add `aria-describedby` pointing at a new `#gsd-need` foot line.
  - In `submit()`, when `!canCreate`, focus the first gap (`titleRef`, then `focusFormat()`, then
    `#gsd-set-search`) and `setAnnounce(...)`.
  - The ⌘↵ handler takes the same path when not ready (keep the `readyButTopics` queue first).
- **The foot note.**
  - When `!canCreate && !isOther && !isEdit`, the foot shows "Still needed: …", built from the
    three booleans.
  - Otherwise it shows today's notes.
- **The pane.**
  - Pass `preview='example'` with a new `exampleOnly` flag when nothing is chosen and nothing is
    hovered.
  - Keep `'hover'` for the focused or pointed card.
- **The phone fold.** Default closed: `open={!howHidden && !narrow}` becomes a separate
  `foldOpen` state, defaulting to false on a phone.

**`src/src/components/FormatWalkthrough.jsx`**

- With `exampleOnly`, render the one-sentence welcome, the "Example · {label}, stage 1 of n"
  label and the first stage only. There is no index.
- The `'hover'` note becomes "A preview of the card you are on. Click it, or press Enter, to
  choose it."

**`src/src/components/CreateSummary.jsx`**

- Drop `StatusLine` and its `gsd-side-pin` in create mode. `SummaryRows` stays for edit.

**`src/src/components/FormatPicker.jsx`** (gallery skin)

- Drop `FormatPreview` from the cards.
- Lay the session formats out as three columns.
- Render the hand-off options as compact rows inside one "Bigger than one session" cell. They
  stay radios in the same group, so the roving tabindex is unchanged. The cell is
  `role="presentation"`, and each row is described by its line plus a shared "each continues on
  its own page" id.

**`src/src/components/SessionOptions.jsx` + `config/setupDefaults.js`**

- Add a `brief` field to `advancedSummary()`:
  - "Defaults: questions shuffled, Workie's standard summary", leaving out whatever the names
    card already states;
  - or `lead` alone when something changed.
- The closed summary shows `brief`. The full sentence (`lead` + `rest`) moves to the top of
  `.gsd-adv-body`.

**`src/src/components/SetChooser.jsx`**

- With no recents (a first-timer), show "Browse all N sets" as a button beside the search, and
  the one-line explanation above it.
- Show "Your question sets" only when the host owns a set of this format; otherwise show "Make
  your own set" alone.

**`src/src/components/GameSetupDialog.css`**

- Remove `.gsd-step-n`, `.gsd-later`, `.gsd-optional-h` and `.gsd-stat` (and their short-height
  overrides).
- Add `.gsd-reveal` with the entrance under `prefers-reduced-motion: no-preference` only, with
  the end state as the base.
- Add the three-column text gallery and the hand-off cell.
- Restyle `.gsd-foot-need` and the `aria-disabled` primary, reusing the outlined disabled style
  already measured at 7.0:1.

**`src/src/config/help/host-setup.js`**

- In "Create engagement, field by field" and "Topics, names and creating":
  - Sections appear as each decision is made.
  - Say what "Still needed" means, and that Create pressed early takes you to the gap.
  - No step numbers.
  - The Optional wording changes.
  - The phone fold is closed.
- Run `node scripts/help-drift.js`. `helpContent.test.js` must still pass.

**Tests that will change** (in `src/src/__tests__/`)

- **`newEngagementDialog.test.jsx`**
  - "nothing is chosen, step 3 is visible but waits…" (`/Choose a format first/`) becomes "only
    Name it and Format on open; no Question set section".
  - `toBeDisabled()` on Create (lines ~126, 147, 185) becomes `aria-disabled="true"`, plus a
    new test that pressing it focuses the first gap and announces.
  - "names rule beside the questions", "Workie is introduced in one line" and "V4: Background
    for Workie…" render with `lastFormat` only. They now need a picked set (`initialSetId`) for
    the names card and the optional lines to appear.
  - "nothing chosen: the pane shows Call & Answer, said to be an example" now expects the
    example-only pane (one stage, no index).
  - "a phone: How it runs is a fold under Format, open unless hidden" becomes closed by
    default.
  - "B7: compact draws no pinned summary row" still holds.
  - "R3 (1366/1280): on a short window the gallery cards drop only their picture" is retired
    (no pictures).
  - "O3/E4/N1" and "the keyboard path" tab-order tests: Create is now a tab stop when not ready.
    Re-check the filter at line ~599 (`!el.disabled`).
- **`gameSetupDialog.test.jsx`**
  - Create `toBeDisabled()` at ~298–318 and ~1126 becomes `aria-disabled`.
  - The Advanced line assertion at ~626 (full "Using the defaults — …" sentence) now reads the
    closed `brief`, and the full sentence moves into the open fold.
- **`gameSetupGoal.test.jsx`**: `create()` `toBeDisabled()` at ~81 and ~106 becomes
  `aria-disabled`. The goal's `role="alert"` reason is unchanged. The `Changed: a goal of 5
  questions.` assertion on `gsd-adv-summary` still holds (the lead shows closed).
- **`setupDefaults.test.js`**: the existing sentences are unchanged. Add cases for `brief`.
- **`sessionOptions.test.jsx`**: the closed summary text.
- **`gameSetupPalette.test.js`**
  - Line ~135 (`.gsd-later` colour) is retired.
  - Add composited checks for `.gsd-foot-need` and the hand-off cell's 12px muted line.
  - Add a contract that `.gsd-reveal`'s animation is declared only inside
    `prefers-reduced-motion: no-preference`, and that no `@keyframes` used by it ends away from
    the base rule.
- **`formatWalkthrough.test.jsx`**: the example-only render (one stage, label, no index) and the
  new hover note.
- **`gameSetupDialogDom.test.jsx`**: re-record on purpose (`-u`), with a header note naming
  round 4.
- **New behaviour tests:**
  - choosing a format reveals Question set, and arrowing formats announces once;
  - a set pick reveals names and options, and switching format keeps them;
  - Build Room swaps the slot and announces once;
  - edit mode shows everything;
  - ~~a host with `lastFormat` sees Question set on open but no names card until a set is
    picked.~~ Replaced on 31 Oct: see the revision below.

### Revision, 31 Oct — every new engagement opens as a first-timer's

**Why.** The owner, on the shipped round 4: *"Why can't we get it to appear like the first timer
we need to support those that forgot or clicked ahead"*. A host with history had their last
format preselected, so they never saw the first-timer state: no quiet example in the pane, and
Question set already open with a format they may not want this time. A host who forgot what
the formats are, or clicked ahead, had nothing to orient them, and decision 1's "one rule for
everyone" was only half true: the rule was the same, but the starting point was not.

**The new rule.** Every new engagement opens with **no format chosen**, for every host. The pane
shows the quiet example, Question set is not yet revealed, and the foot says "Still needed: a
title, a format and a question set." (or "a format and a question set." with a title in hand).
Editing a session is unchanged: everything filled in from the start.

What a host with history keeps, so they lose no keys:

- **Chips, not the gallery** (`hasCreated`, unchanged), with the last format's chip tagged
  **last**.
- **The keyboard lands on the last format.** When nothing is chosen, the format group's one tab
  stop (roving tabindex, `FormatPicker`) is the last-used option, not the first. Enter in the
  title goes to that stop; Enter or Space picks it. Tab from the title reaches it one stop
  later, past "Compare formats" (round 2 put that link before the chips in the Tab order, and
  that is unchanged). On a phone the last format is drawn even when the row is folded behind
  "More".
- **Recents one keystroke away.** Once the format is chosen, the set search has "Used by you
  lately" under it. The fast path is title, Enter, Enter, Enter, ⌘/Ctrl+Enter
  (`newEngagementDialog.test.jsx`, "the keyboard path").
- The meeting-type chips, Compare formats' "Use …" and the arrows all choose a format as before.

Round 3's rule holds: one layout, the same card for every host.

**The chip row at 1280×720.** With the pane open, the seven chips wrapped "Event" onto a second
line at 1280×720 (seen live). The form column there is 8px narrower than at 1440 and, 720
tall, it scrolls. Between 901px and 1440px with the pane open, the chips' padding (10 → 8px),
the gaps (5 → 4px) and the form's side padding (28 → 24px) step in. No text shrinks: chip names
stay at 13px and the "last" tag at the 12px floor (`gameSetupPalette.test.js`).

**In code.** `GameSetupDialog` no longer seeds `engagementType` from `lastFormat`, and the
effect that applied a late history read is gone; `lastFormat` now only tags a chip. An
`initialFormat` prop, like `initialSetId`, is a seam no caller passes; the tests use it to start
past the format decision.
