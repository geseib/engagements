# Question preview — browse a set and see each question as the room will

**Status:** approved by the owner 2026-09-19. Design only; the implementation plan is
`docs/superpowers/plans/2026-09-19-question-preview.md`.

**Origin:** the owner's complaint in `docs/handoff/create-set-experience-2026-09-18.md` §0 — *"a
preview for flashing through all or some questions"* — left undesigned there (§5) with open
question 5: *"Does preview justify extracting a shared question card, or is the `RoundReport`
interim enough?"* This document answers it: **extract.**

The owner's own description of the thing, 2026-09-19: *"an interface that is like the session
question list and a panel like the actual screen, but keep it nice and tight so you can scroll,
search and click through the list of questions and click preview to see them."* And: *"can this be
identical mechanics to what is in game … the questions tab in the session menu. It seems to have
much of what is needed."*

---

## 1. What it is

A **Preview** mode of the set editor's **Questions** tab. Two panes side by side:

```
┌─ Questions (30) ─────────┐ ┌─ Preview ──────────────────────┐
│ 🔍 search                │ │  [ ASK ] [ Reveal ]     3 / 30 │
│ [All][History][Method]   │ │                                │
│ Showing 3 of 30          │ │  Which killer was caught       │
│                          │ │  by a parking ticket?          │
│ Which killer was…     ▸  │ │                                │
│ History · easy           │ │   A  Ted Bundy                 │
│ The Green River…         │ │   B  David Berkowitz   ✓       │
│ Method · hard            │ │   C  John Wayne Gacy           │
│ Who was dubbed…          │ │   D  Richard Ramirez           │
│ History · medium         │ │                                │
│                          │ │  Reveal — shown only after the │
│                          │ │  round: Stopped for parking…   │
└──────────────────────────┘ └────────────────────────────────┘
           ↑ ↓ page through the list
```

- **Left — the list.** The in-session Questions tab's mechanics (search box, category chips,
  "Showing N of M", click a row), rebuilt on the admin type ladder.
- **Right — the card.** The question rendered by **the same component the live stage renders**,
  at the **Table** display profile, on the stage's dusk ground.

---

## 2. Decisions — settled by the owner, do not reopen

1. **Entry: the set editor, at any time in edit mode.** Unsaved edits included — the preview
   reads the editor's working rows, not the server. *Not* the public library's Preview button,
   *not* a row action on the sets table, *not* the host's pre-session surface. (The public
   library's "Preview" still opens the full editor; that is a known, separate bug.)
2. **Container: inline, not a dialog.** `QuestionSetEditor` is a *place* in the admin console but
   a *modal* on the host shelf (`HostQuestionSetsDialog`, mounted at `GameHostPage.jsx` ~4784).
   A preview dialog opened from it would be a modal inside a modal, which the design system bans.
3. **Fidelity: one card for the stage and the preview.** The ASK markup and the trivia reveal
   markup are extracted out of `GameHostPage.jsx` into a shared component that **both** render.
   Drift becomes structurally impossible.
4. **Phases: ASK and Reveal.** Reveal is the stage's trivia RESULTS option treatment — the
   correct option highlighted, the rest dimmed — without the vote percentages, because there were
   no votes.

   **Correction, 2026-09-19: Reveal is offered wherever there is something to reveal.** This
   spec first gated `[ASK] [Reveal]` on trivia, because "for every other format there is nothing
   to reveal" (§4.4). That was false. Art sets are call-and-answer, and they keep the artwork's
   real title in `answerDetails`, so the preview could never show an art answer. The rule is still
   "gate the control on there being something behind it". It is now worked out correctly, and for
   the whole set, so the control does not come and go while paging: the toggle is offered when the
   set is trivia, or when any question not marked for removal has `answerDetails`. In Reveal, a
   trivia question shows the treatment above. Any other question shows its card exactly as in ASK,
   plus its reveal note below the card (§4.4) when it has one. The stage's RESULTS never draws
   `answerDetails`, so nothing on the card changes.

   **Correction, 2026-09-19: Reveal keeps the question above its answer.** The branch's final
   review changed Reveal to draw the question in ASK's own lines (the heading, the picture and
   the full prompt) above the revealed options, as the §1 sketch has it. Reveal is sticky, so
   with the options alone every question you moved to showed four answers and nothing saying what
   was asked. The how-to-answer line stays ASK's: in Reveal the answering is over. The stage never
   asks for any of this (§4.2).
5. **One row action.** Clicking a row shows it in the card. The card pane owns the
   `[ASK] [Reveal]` toggle, and the toggle is **sticky**: flip to Reveal once, and every question
   you move to shows its answer.
6. **Search matches title and detail**, plus **category chips**. (The in-session search matches
   titles only; see §4.3 — the stage keeps that.)
7. **Answers are visible here.** `create-set-experience-2026-09-18.md` §3.3 decided preview is
   "before a session, on a laptop, with answers visible". The live stage's answer-stripping is
   **not** loosened — this feature routes around it, never through it (§6).

---

## 3. The hazards that shaped the design

These are facts about the code, found while designing. Each one is a requirement below.

### 3.1 The stage owns `document.documentElement`, and the editor can be open over a live stage

`components/stage/Stage.jsx` puts the display-profile class (`d-room`, `d-tv`, `d-call`,
`d-table`) on `document.documentElement` because the four ladders are declared on `:root`
(`styles/stage.css` ~43–90). `GameHostPage.jsx` mounts `HostQuestionSetsDialog` — and through it
the set editor — **on top of the running stage.**

A preview that added `d-table` to the root, or removed the other profile classes the way
`Stage.jsx`'s effect does, would **re-profile the projector mid-session** — the room's type would
drop to the laptop ladder while the host checked a question.

**Requirement:** the preview never reads or writes `document.documentElement`'s classes or
attributes. Not on mount, not on unmount.

### 3.2 The card's CSS is global, and the default ladder is the projector's

`.q`, `.qdetail`, `.opts`, `.opt`, `.ltr`, `.txt`, `.fill`, `.pct`, `.stage-art` in
`styles/stage.css` are **unscoped** selectors, and `:root, :root.d-room{…}` makes the **Room**
ladder the default on bare `:root`. So the card rendered anywhere in the admin console, with no
further work, draws at projector scale (20px floor, headline sized for a 90-inch wall).

**Mechanism:** widen the Table ladder's selector so it also matches a scope class —
`:root.d-table, .stage-ladder-table { … }` — and wrap the preview's card in that class. The same
literal declarations then apply to the wrapper's descendants by ordinary inheritance. One
declaration, two selectors; nothing to keep in sync.

**Requirement to verify, not assume:** a custom property declared **only** on bare `:root` and
**derived** from a ladder variable (a `calc()` or `var()` over `--t-*`, say) is computed once, at
`:root`, with the Room values — and the wrapper inherits that computed value, not a Table one.
(This is exactly how the retired `--k` scalar rendered all four profiles identically.) Every
custom property the card's selectors read must resolve to a Table value under the wrapper. Check
the bare `:root{…}` block near `stage.css` ~828 and every `var()` chain the card selectors touch;
move any derived property into the widened block if needed. Pin it with a CSS-contract test (§7).

### 3.3 `.content` and `.fitbox` are the fitter's, not the card's

`.content` (stage.css ~222–259) sets `overflow:hidden` and flex layout and is what `useStageFit`
measures. The preview does not use `.content` or `.fitbox`, and does not run the fitter.

**Known, accepted difference:** on a dense question the stage's fitter may drop `data-drop`
lines (the full prompt at `data-drop="4"`, the how-to-answer line at `"3"`) at room scale. The
preview shows every line. It is a preview of the content, not a simulation of the fitter.

### 3.4 Two row shapes, one card

The stage passes wire-shaped questions; the editor holds `utils/questionRows.js:toRow` rows. The
fields the card reads line up: `title` (stage also falls back to `question`), `detail` (stage
reads `questionDetail || detail`), `image`, `optionA`…`optionF`, `correctAnswer`. The card reads
through the same fallbacks the stage does today, so both shapes render identically.

**One trap to check:** the how-to-answer line comes from `resolveInstruction(question,
customInstruction, gameType)` in `config/instructions.js`. `toRow` normalises the per-question
instruction to **singular** `customInstruction`, while the wire name is plural. If
`resolveInstruction` reads only the wire spelling, an editor row with its own instruction would
silently show the set-level or default line instead. A parity test is required (§7).

---

## 4. The units

### 4.1 `src/src/config/questionCard.js` — pure

- `TRIVIA_OPTION_KEYS` and `isCorrectTriviaOption` **move here verbatim** from `GameHostPage.jsx`
  (module-level today, lines ~78–107). `GameHostPage.jsx` imports them. Behaviour unchanged.
- Anything else the card needs that can be computed without React lives here, so it is testable
  without mounting anything (`GameHostPage.jsx` cannot mount in jsdom — `Pager.jsx`'s header).

### 4.2 `src/src/components/QuestionCard.jsx` — the shared renderer

Renders the **fragments** the stage renders today, with **identical DOM**: same elements, same
classes, same attributes (`data-drop`, `data-drop-note`, `data-expandable`), same order.

- `phase="ASK"`: `h1.q`, `img.stage-art` (with the stage's `onError` hide), `p.qdetail
  data-drop="4" data-drop-note="Full prompt"` (**never** for wavelength), `div.opts > div.opt >
  span.ltr + span.txt` for trivia, then `p.qdetail data-drop="3" data-drop-note="How to answer"`
  with the instruction text.
- `phase="REVEAL"` (trivia only): the `div.opts` block with `.opt.correct` / `.opt.dim`. When the
  caller passes `answers` (the stage), each option also renders `span.fill` (width = share) and
  `span.pct`, **exactly** as the RESULTS branch does today — including 0% when `answers` is an
  empty array. When `answers` is **absent** (the preview), no `.fill` and no `.pct` are rendered:
  a 0% bar in a preview would claim nobody chose it.

  **Correction, 2026-09-19:** REVEAL has an opt-in `withQuestion` prop, and only the preview
  passes it. With it, the card draws ASK's question lines (`h1.q`, `img.stage-art`, and the
  `data-drop="4"` full prompt) above the `div.opts` block. It draws them from the same block ASK
  uses, so the two cannot drift. It leaves out the how-to-answer line. The stage never passes the
  prop, so its RESULTS DOM is unchanged, and `questionCardDom.test.jsx` holds it to that (§2.4).
  The card's REVEAL is still trivia only. For any other format the preview asks the card for ASK,
  and its Reveal is the note below the card (§4.4).
- **The expand affordance is gated on its handler.** The stage passes `onExpand`; the `h1` then
  carries `data-expandable="1"`, `title="Show the full question"` and `onClick`. With no handler
  (the preview), none of the three render. A control that does nothing is not rendered.
- Instruction text is a **prop**, not computed inside the card: the stage passes
  `getHostInstructionText(…)` as it does today; the preview passes `resolveInstruction(…)`.

`GameHostPage.jsx` replaces its inline ASK markup and its inline trivia RESULTS `.opts` block with
`<QuestionCard …/>`. The RESULTS kicker, the wavelength branch (`WavelengthConvergence`) and the
answer-cards branch **stay** inline — they are not part of a question, they are the room's
responses. This change is a **pure refactor**: the stage renders the same DOM before and after.

### 4.3 `src/src/config/setupPanel.js` — opt-in detail search

`filterBrowserRows(rows, { search, category, unaskedOnly, enabledOnly })` gains
`matchDetail = false`. When true, the search needle also matches `row.detail`. **The default is
false**, so the in-session stage browser behaves exactly as it does today; its placeholder still
truthfully says "Search titles…".

The list rows reuse the stage browser's row fields (title, category, difficulty) — via
`browserRow` if it accepts the editor's row shape, otherwise via a thin adapter that produces the
same fields. **The list rows carry no answers**; the answer appears only in the card, and only in
Reveal. The full row is handed to the card by id.

### 4.4 `src/src/components/QuestionPreview.jsx` + `QuestionPreview.css` — scope `.qprev`

Props: the editor's working `rows`, the set's `gameType` (mapped from the set's engagement type
exactly the way the host maps it — verify the mapping, pin it), the set-level
`customInstruction`, and `onEditQuestion(row)`.

**The list (left):**
- Search input (matches title **and** detail), category chips built from the rows' categories,
  "Showing N of M".
- Rows: the title on one line (truncated, with `title=` carrying the full string — a truncation
  with no recovery is a deletion), and a meta line `Category · difficulty`. No detail snippet in
  the row: the card shows it, and the owner asked for tight.
- **Rows marked `removed` are excluded** — they will not exist once the set is saved.
- `role="listbox"` with `role="option"` rows and `aria-selected`. **↑ / ↓** move the selection
  through the *visible* (filtered) rows, **not** while focus is in a text input. Wrap at the ends.
- Two different empty states (never one that lies): the set has **no questions** (then the
  `[Preview]` segment is **disabled**, with a `title` saying there is nothing to preview yet), versus **nothing matches** the search
  or chip (with a "Clear search" exit).
  **Correction, 2026-09-19:** there is a third. When every question is **marked for removal**,
  the set has questions, and "no questions yet" was false. That case gets its own line: "Every
  question is marked for removal, so there is nothing to preview." It names the way back, which is
  Restore in the Table or discarding the changes, not adding a question. The disabled
  `[Preview]` segment's `title` says the same.
- If the selected row is filtered out, the selection moves to the first visible row; if nothing is
  visible, the card pane says nothing is selected.

**The card (right):**
- `data-theme="dark"`, on the stage's ground, wrapped in `.stage-ladder-table` (§3.2), so it looks
  like the screen in a paper editor as well as a dusk one.
- The `[ASK] [Reveal]` toggle renders **only for trivia**; for every other format there is nothing
  to reveal, so there is no control. Sticky across selection changes.
  **Correction, 2026-09-19:** the toggle renders when the set is trivia, or when any question not
  marked for removal has `answerDetails` (§2.4). An art set keeps the artwork's real title there.
  It is worked out over the set, not the question on the card, so it does not come and go while
  paging. In Reveal, a trivia question shows the card's REVEAL with its question above the
  options (§4.2). Any other question shows its ASK card unchanged, with its reveal note below the
  card when it has one; a question with no reveal written shows no note.
- Position `3 / 30` counts the visible list.
- In Reveal, when the row has `answerDetails`, it renders **below and outside** the card, labelled
  with the editor's own wording for that field — **"Reveal — shown only after the round"** —
  because the stage's RESULTS never shows it (it reaches players only in the round report,
  `RoundReport.jsx`). The card stays exactly the stage; the note is honestly marked as not on it.
- An **Edit** action on the selected question calls the Questions tab's existing `startEdit(row)`
  — the existing question dialog, no new modal. After Done, the preview is still open and shows
  the edit.

### 4.5 `QuestionsPanel.jsx` — the mount

A segmented control in the Questions tab's toolbar: **`[Table] [Preview]`**. Preview mode replaces
the table with the two panes; Table mode is today's tab, unchanged. The mode is local state with a
name that cannot be confused with the existing `preview` state (which is the CSV replace diff,
~line 210) — e.g. `viewMode`.

---

## 5. Out of scope

The public library's Preview button; a sets-table row action; the host pre-session surface; an
"unsaved change" tag on rows; poll/survey vote states; the fitter; the append-to-a-set route.

## 6. What must stay exactly as it is

- `config/setupPanel.js:browserRow` stays an allow-list that strips every option field, and
  `setupPanel.test.js` ("browserRow — the answer never reaches the stage") keeps passing unedited.
- The in-session stage browser's search matches titles only (the `matchDetail` default).
- The live stage's DOM for ASK and trivia RESULTS is unchanged by the extraction.
- No test that exists today is weakened or deleted to make this pass.

## 7. How it is tested

jsdom has no layout engine, so nothing geometric is asserted. `GameHostPage.jsx` cannot mount in
jsdom, which is the reason the card is extracted.

1. **Card DOM is the stage's DOM** — `QuestionCard` in each state renders the exact structure the
   inline markup rendered: trivia ASK; ASK with an image; wavelength ASK (no detail line); ASK with
   and without `onExpand`; trivia REVEAL with `answers` (fill + pct, including the 0% case) and
   without (neither span).
2. **The stage really uses it** — a source-text check that `GameHostPage.jsx` renders
   `<QuestionCard` and no longer contains its own `className="opt"` markup, so re-inlining it
   fails a test rather than silently forking the two.
3. **`isCorrectTriviaOption` unchanged** — every correct-answer spelling (`"OptionB"`, `"B"`, the
   option's own text, an array of those) tested from its new home.
4. **Instruction parity** — a `toRow` row and the equivalent wire question, each with a
   per-question instruction, produce the same how-to-answer text (§3.4).
5. **Engagement type → game type** mapping pinned for every format.
6. **`filterBrowserRows`** — `matchDetail` matches detail when true and not when false; every
   existing setupPanel test passes unedited.
7. **The root is never touched** — set `document.documentElement.className = 'd-room'`, mount
   and unmount the preview, assert it is still exactly `'d-room'` and never gained `d-table`.
8. **The ladder scope** — stage.css's Table ladder block also matches `.stage-ladder-table`; the
   `:root.d-table` selector is still in it; every custom property read by the card selectors is
   declared inside the widened block or is a non-derived literal (§3.2).
9. **The preview's behaviour** — search on title and on detail; chips; the count line; click
   selects; ↑/↓ move and skip text inputs; Reveal only for trivia; the toggle sticks across
   selection; removed rows excluded; an unsaved edit in `rows` shows in the card; both empty
   states and their exits; the answer-details note only in Reveal and only when present; Edit
   calls `onEditQuestion` with the selected row. (**Correction, 2026-09-19:** "Reveal only for
   trivia" is now Reveal wherever there is something to reveal, tested with an art-style
   call-and-answer set, §2.4.)
10. **`.qprev` palette** — a `QuestionPreviewPalette.test.js` in the repo's pattern (never
    `*Token*` in the name — `.gitignore` hides it): AA on every pairing composited up the real
    ancestor chain, tokens only outside the scope's token block, nothing below 12px, every selector
    rooted at `.qprev`, every `var()` declared.

## 8. The gate

Backend suite by exit code with the suite **count** asserted, frontend suite, `npm run lint`
(0 errors), `npm run build` (exit 0). Baseline before this work: backend 147 suites / 0 failed,
frontend 222 suites / 5226 tests, lint 0 errors / 10 warnings, build exit 0 with its two size
warnings.
