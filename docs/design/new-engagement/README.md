# New engagement: redesign of the create modal

*30 Oct 2026. These are mockups and notes only. No application code has changed.
Open `index.html` in a browser. Each frame is drawn at 1440×900, or 390×844 for the phone,
and the PNG files beside it are renders of those frames.*

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
  chooser is open, do not render the categories, and show one line in their place (frame 5a).
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

1. **Three decisions, then Create.** The required path is title → format → questions. Everything
   else is collected under one "Optional — every one has a safe default" heading, and the
   Advanced line keeps naming every default in force (`config/setupDefaults.js`, unchanged).
2. **One page, not a wizard.** Experts dislike steps they cannot skip, and novices dislike
   not seeing where they are. The answer here is numbered sections that tick green as they are
   completed, on a single scrolling page.
3. **Show, then tell.** Every format shows a few seconds of what the room does: answers arriving
   and a vote, A–D with the right answer lighting up, poll bars growing, matching words merging,
   a survey form filling in, A/B mockups with "Sent to Claude", an agenda with a Now marker. The
   text then says what the room does, what the host gets, how long it takes and how big a group
   suits it. Motion loops in 6–9s and is all CSS. Under `prefers-reduced-motion` each preview
   shows its end state.
4. **The window is the canvas.** The modal is `min(1240px, 100vw − 48px)` wide and full height,
   split into a form on the left and a side pane on the right (420px). The outer size never
   changes. Only the inner content swaps (frames 2 and 5a), so nothing jumps.
5. **Always say what is being made and what happens next.** The side pane is a live preview of
   the room screen and phones, built from the chosen set, plus a checklist of the decisions.
   When everything is ready it switches to the steps that follow Create.
6. **Learn once, then step aside.** After the first create, or when the host presses "I know
   these", the gallery becomes one row of chips. The explanation is one link away ("Format
   guide") and never disappears entirely.
7. **The shipped language, unchanged.**
   - Colours are dusk tokens: card `#1B2942`, field `#25375A`, text `#F4EDE4`, the scope's
     lighter muted `#A9B5C9`, amber `#F6A94C` for selection, periwinkle `#7CA7E6` for links and
     information, and success `#4FB286` / `#6FD0A4` for ticks.
   - Type follows the laptop ladder: 12 / 13 / 15 / 19 / 24px, with inputs at 15px.
   - Paper uses `#9A5B18` for amber text.
   - There is still one Modal, the X and Cancel both go through `requestClose()`, and the discard
     question appears inline in the foot. No modal opens from inside the modal.

## 4. Walkthrough of the frames

| # | File | What it shows |
|---|---|---|
| 1 | `01-first-time.png` | A first-time host. Nothing is pre-chosen. The 1 and 2 badges are amber, and step 3 is greyed out with "Pick a format first". The format step is a 4-across gallery of seven cards plus a "Not sure? Compare the formats" tile, each card with an animated preview, a one-line description and length · group size. Build Room and Event carry an "Own setup screen" tag. Above them is a row of goal chips under "What do you want from the room?" (Ideas and priorities → Call & Answer, Test what they know → Trivia, A quick show of hands → Poll, See if we're aligned → Wavelength, Feedback in their own time → Survey, Build something together → Build Room, Run a whole day → Event). Clicking a goal highlights its card. Hovering or focusing a card plays it large in the side pane, with *The room / You get / Takes*. The foot reads "3 things to decide…" and Create stays disabled. |
| 2 | `02-compare.png` | "Compare the formats" fills the modal body with one fixed-layout table: a column per format with its preview in the header, rows for The room, You get, Typical length, Group size, Needs and Starts, and a "Use …" button at the bottom of each column. The goal chips still work here; "See if we're aligned" highlights Wavelength. "Back to the form" keeps the title. |
| 3 | `03-expert.png` | The compact path. Format is a radio group of chips with the last-used format pre-selected and tagged "last", and ←/→ changes it. Sets the host used lately are one click away (the chooser's existing "Used by you lately"). The side pane becomes a short "Ready to create" checklist plus "What happens next", and the preview is behind a link. Ctrl+Enter is printed on the Create button. |
| 4 | `04-call-and-answer.png` | Call & Answer with *Lessons from Different Schools* (14 questions, 8 categories). The set has folded to one line with Change. Under it the categories run full width as toggles, each with a tick and its question count. Three are off, and the line reads "5 of 8 categories · 10 questions". Workie's briefing is now one dashed line marked optional, with *Add a document* and *or write key points*; BriefingField's existing states expand in place. The side pane shows that set's real first question. |
| 5a | `05a-change-set-open.png` | Change pressed. The chooser takes the whole body, and the side pane steps aside while the modal keeps its size. The old categories are gone, and one dashed line says "Categories appear here once you pick". The current set is ticked and marked *current*. "Keep the set I had" restores everything. |
| 5b | `05b-change-set-done.png` | *Ready or Not* picked. The chooser folds and the side pane returns with Ready or Not's question. The categories block keeps its height with skeleton chips while loading (left; the two states are shown side by side for this frame only), then shows the new four, all on. An amber note appears when the host had edited the old selection: "Your earlier picks belonged to the other set and were cleared." |
| 6 | `06-trivia.png` | Trivia with *GenAI From Three Angles* (12 questions, 3 categories). There is no briefing line at all; it is not shown as "unavailable". The preview shows A–D with C correct and the phone locked in. Poll has the same shape with live bars. Survey swaps Categories for its Names card, and the button reads "Open the survey". |
| 7 | `07-build-room.png` | Build Room. Step 3 becomes "Next: the Build Room setup": a four-tile strip (Title ✓ carried over, Goal, Connect your Claude Code, Open the room), the one prerequisite ("You need Claude Code… No question set — Claude writes the questions as it goes"), and a link to *How Build Room works*. The primary button reads **Continue to Build Room setup →** and the foot reads "Nothing is created yet". |
| 8 | `08-event.png` | Event, using the same hand-off pattern: Name ✓, Day and place, Build the agenda, Run it. It shows the price ($2.00 an event, counted when it first goes live) and the Free-plan variant (a sentence plus See plans, with the button disabled). The preview is an agenda with a Now marker. |
| 9 | `09-ready.png` | Ready to create. Every decision is ticked in plain words, including the one Advanced change (Goal: 8 questions), which is also named in amber on the Advanced line. A ready briefing collapses to "Ready · 212 words, from Q3 engineering review.pdf". "What happens next" has four steps: Create, Start, Run, Report. |
| 10 | `10-phone-390.png` | A full-height sheet. Format is a list: the three common formats with their one-line descriptions, the chosen one showing its small preview, and "Wavelength, Survey, Build Room, Event" one tap away. Compare opens the frame 2 table, scrolled one column at a time. Briefing and Advanced share one *Optional* fold, and the preview has its own fold. The foot restates the choice and keeps both exits on one row. |
| 11 | `11-light.png` | Frame 4 on paper. The selection uses amber `#9A5B18`. The room preview stays dusk on purpose, because it is a picture of the stage. |

## 5. Novice and expert, step by step

**A novice** reads the title placeholder and types. Then they either scan the gallery, where
every card is already moving, or click the goal that matches their intent and get one card
highlighted. They hover two or three cards and watch the side pane, or open Compare to see them
side by side. They pick one, and step 3 lights up and offers sets they used lately or a search.
They leave all categories on (the sentence says how many questions that is), ignore Optional, read
"What happens next", and press **Create engagement**.

**An expert** sees the compact layout because they have created before. They type the title and
press Tab. The last-used format is already chosen, or ←/→ changes it. They click a recent set and
press **Ctrl+Enter**. Nothing re-explains a format unless they press *Format guide*.

## 6. Decisions and reasons

- **The last set is not pre-selected.** The owner retired that: *"the create engagement should not
  remember or preselect that last picked question set"* (`GameSetupDialog.jsx:162-170`). The
  design remembers the **format** only, and puts the sets used lately one click away, as the
  chooser already does.
- **Nothing is pre-selected for a first-timer**, so that choosing a format is a visible decision.
  Experts get the last-used format, so they lose no clicks compared with today.
- **The goal chips are a filter, not a quiz.** They highlight one card and never block anything
  or navigate away.
- **The comparison is a table, not cards.** Seven formats across six attributes is a matrix, and
  "lists are tables" is a house rule (skill §0.7).
- **The briefing is one line until it is used.** It is optional, it applies to only one format,
  and it was the largest block on the form.
- **The hand-off for Build Room and Event is explained before the host leaves**, because today
  the host only learns that a Build Room needs Claude Code, or that an event costs money, after
  clicking through.
- **The side pane steps aside for the chooser** instead of the card growing. The set table needs
  the width, and the modal frame stays still.

## 7. Open questions for the owner

1. **Length and group-size figures.** "10–15 min a round", "About 1 min a question", "Best with
   10 or fewer" and the others are design estimates. Only Wavelength's group size comes from the
   product (`gameTypes.js` blurb). Should they be confirmed, or dropped in favour of the room and
   you-get lines alone?
2. **What counts as "experienced"?** Proposal: compact mode once the host has created at least one
   session, read from their own session history, or once they press "I know these". The
   preference is stored per browser in `localStorage`, wrapped in try/catch. Should it be stored
   per account instead?
3. **Should the format be remembered at all?** Remembering the set was retired. Remembering the
   format is proposed here, but the same reasoning could apply. A separate question: should
   `initialSetId` stay as a deep-link seam only?
4. **Wavelength and Survey visibility on the phone list.** Should the three formats shown before
   "more" be fixed, or be this host's three most used?
5. **Create and start.** Should there be a second button, "Create and open the lobby", for hosts
   who run the session immediately? Today's flow returns to the sessions list.
6. **Event plan name.** Frame 8's Free-plan sentence uses `eventsAccess.offerPlanName`, as today.
   Confirm the copy.
7. **Preview data.** The side pane shows the chosen set's first question, which needs
   `GET /question-sets/{id}` or a question count only. Is one extra read per pick acceptable, or
   should it use a format-generic sample until the session is created?

## 8. Implementation map

**Files that change**

| File | Change |
|---|---|
| `src/src/components/GameSetupDialog.jsx` | Restructure the form into three numbered sections inside a two-pane body. Remove `chooserOpen` / `gsd--wide`. Render `SessionCategories` under the set, never in `.gsd-row`, and not while the chooser is open. Add format state for "nothing chosen" (`''`) in create mode for first-timers, and "last used" for experts. Add `categoriesLoading` from props and disable Create while it is true. Add Ctrl/Cmd+Enter to submit when `canCreate`. Make the format group a `role="radiogroup"` with arrow keys. Show the Build Room and Event hand-off panels in place of step 3. |
| `src/src/components/GameSetupDialog.css` | Make the card wide and full-height with no width transition. Add the `.gsd-body` grid (form + 420px side), section badges, the 4-across gallery, chips, the hand-off strip and the side-pane checklist. Use the existing tokens. Add a paper re-tint block for the light theme. |
| `src/src/GameHostPage.jsx` | `handleSetupSetChange` / `fetchCategories` (`:4111-4186`): clear the categories before the await, add a request token or AbortController so stale responses are dropped, check `res.ok`, and expose `categoriesLoading` and `categoriesError`. Pass `lastFormat` and `knowsFormats` to the dialog. |
| `src/src/components/SessionOptions.jsx` | `SessionCategories`: a reserved-height skeleton state, an error line with retry, and the "earlier picks cleared" sentence when the previous selection was edited. `SessionBriefing`: a collapsed one-line variant that opens into `BriefingField`. |
| `src/src/components/SetChooser.jsx` | Base `wideCols` on the container (ResizeObserver), not on `matchMedia(900px)`, because the chooser now lives in a known-width pane. |
| `src/src/config/gameTypes.js` | Add `room`, `get`, `length` and `size` strings next to `blurb`, so the gallery, the compare table and help read from one source. Build Room and Event copy goes in `config/engagementKinds.js`. |
| `src/src/config/help/host-setup.js` | Rewrite "Create engagement, field by field" (`:230-244`) for the gallery, the compact chips, Compare, the side pane and Ctrl+Enter. Run `node scripts/help-drift.js`. |

**New components**

- `FormatGallery.jsx` (cards, goal chips, the "Not sure?" tile) and `FormatChips.jsx` (the
  compact radiogroup). They share one `formatCatalog` built from `gameTypes.js` and
  `engagementKinds.js`.
- `FormatPreview.jsx`: the animated mini and large previews, CSS-only, with the reduced-motion
  end state.
- `FormatCompare.jsx`: the table body of frame 2.
- `CreateSummary.jsx`: the side-pane checklist and "What happens next".
- `OtherFormatHandoff.jsx`: the Build Room and Event strips, replacing `OTHER_BLURBS`.

**Tests to add or change**

- The behaviour tests listed in §2.
- `gameSetupDialog.test.jsx`:
  - A first-time create has no format chosen and Create is disabled.
  - Compact mode pre-selects `lastFormat`.
  - Ctrl+Enter submits only when `canCreate`.
  - Arrow keys move the format radio.
  - Build Room and Event show the hand-off panel and the arrow button.
  - The Free plan disables Event with the sentence.
- `gameSetupDialogDom.test.jsx` holds the old form "to the byte". It has to be re-recorded on
  purpose, and the change noted in its header.
- `gameSetupPalette.test.js`: add the gallery card, the chip-on tint, the side-pane ground
  (`#16233A`-ish) and the paper amber `#9A5B18`, all composited.
- A CSS-contract test that `.gsd--wide` and the `max-width` transition are gone, and that no
  `.gsd-row` contains `SessionCategories`, asserted as text with no geometry.
- `helpContent.test.js` must still pass after the help rewrite.

## 9. Notes on the mockups

- The previews are illustrations of the room. Text inside the stage picture sits below the 12px
  floor because it is a scaled picture of a projected screen, not UI to read. The UI text around
  it follows the ladder.
- Trivia and Call & Answer use the real demo sets (`demo-sets/`). There are no Poll, Wavelength or
  Survey demo sets, so those formats appear only through their previews.
- The helper scripts that generate `index.html` and the PNG files are kept outside the repo.
