# Handoff — the create-set experience: what is proposed, and what still has to be decided

**Nothing in sections 4 to 7 is built.** This file is the state of a design conversation that was
paused deliberately on 2026-09-18 to think it through. The mockups are real and committed; the code
behind them is not written and should not be written until section 8's questions are answered.

**What IS live**, from the same day: the Workie half of this work — dev `e9f2f9d1`, test `d878e743`.
See §2. The public library and its moderation pipeline shipped earlier the same day; that is
`docs/handoff/public-library-2026-09-18.md`.

---

## 0. WHERE THIS STANDS

The owner's complaint, in their words, was that the **Create new set button and interface is
difficult to navigate and create a new data set with**, that the **selector of number of new
questions or categories is awkward**, and that two things are missing: **a preview for flashing
through all or some questions**, and the ability to **add more questions and categories to
existing sets**. Later in the same conversation they added: **"I don't see where the prompt/Workie
selection maps to a question set as a default, and for the host, how do they change it? Today they
can only apply the overlay (comedian, facilitator…) and I'm not sure that even works."**

That last one turned out to be the only part that was mostly a defect rather than a design problem,
so it was fixed and shipped the same day (§2). Everything else is a design problem, and it is
open.

Three mockups exist for the create flow — `docs/design/create-set-redesign/01-new-set.html`,
`02-ai-describe.html`, `03-ai-interview.html` — in the same self-contained language as
`docs/design/admin-redesign/`. Open any of them in a browser; press `N` to hide the design-note
rail. **The reasoning lives in that rail**, not in this file, and it is the better read.

---

## 1. WHAT THE AUDIT FOUND — today's create flow, step by step

Audited 2026-09-18 by reading the code. Line numbers were accurate that morning; several of these
files were edited later the same day by the Workie work, so treat the numbers as landmarks, not
addresses.

1. **Sets list → "New set"** (`components/QuestionSetsPanel.jsx`). An empty library instead shows
   three ranked buttons.
2. `handleCreatePath` (`AdminPage.jsx`) toggles a panel. Only the AI path also opens a builder.
3. ⚠️ **The creation panel is appended BELOW the 41-row table** and scrolls itself into view
   (`QuestionSetUploadPanel.jsx`). This is the pattern the design skill names as *the* rejected one:
   "appending a form below the list and scrolling to it"; a list and its detail are two places, not
   two sections. This is the "I have to scroll down and most people never see it" problem, exactly.
4. ⚠️ **The panel renders all three tiers at once regardless of route** — engagement-type select,
   five route cards, then the full CSV form (file, title, description, custom instructions, AI
   context, summary prompt, Upload). Choosing "Generate with AI" leaves the entire CSV form on
   screen underneath it.
5. The AI route opens **one of four builders**, dispatched by engagement type at `AdminPage.jsx`
   (`handleOpenBuilder`): `TriviaAIBuilder` for trivia, `PollAIBuilder` for poll, `SurveyAIBuilder`
   for survey, and `AIScenarioBuilder` as the `else` — which today means Call & Answer and
   Wavelength. So it is three type-specific builders plus a catch-all, not four peers.
6. ⚠️ **Each builder is a hand-rolled modal**, not the shared `Modal` component. The design skill's
   rule is "never build a second modal shell"; there are four here.
7. Each asks **eight to ten fields** before anything can run. The scenario one is a three-step wizard.
8. The job then polls every 2 s with a ceiling of about 16 minutes, **with no cancel** — only
   "Close — this keeps running".
9. ⚠️ After it succeeds it is still **about three more clicks** to reach the editor.
10. ⚠️ **Two of the five paths are dead ends.** The Survey builder **downloads a JSON file and never
    creates a set**. The Manual builder **opens `/builder` in a second tab** that knows nothing
    about the set you were making.
11. ⚠️ For a host, the editor opens as **a modal inside the host's modal**, with the question form
    as a third layer. The skill forbids opening a modal from inside a modal.

### The four fields the owner asked about

They hit this in the catch-all builder, and the confusion is real but it is not four versions of
one thing. It is **three different things wearing one misleading label**:

| Field, as labelled today | What it actually is |
|---|---|
| "What should this round do?" | The **direction**. The backend places it *in front of* everything else the model reads, and it is the field that genuinely changes the shape of the questions. |
| "What is the room told?" | **Not a generation input at all.** It becomes the instruction players and the host see during the game. |
| "Context/Background" | **Subject matter** for the model. Appended to the prompt as "Context". |
| "Base Prompt & Additional Requirements" | Appended **last**, as "Additional Requirements". It is called "Base Prompt" only because choosing a saved prompt pre-fills it with that prompt's text; nothing treats it as the base prompt. |

The code even records the consequence: typing a direction into the last box "never changed the shape
of the output", because last is what a model ignores. **Order is the hidden rule of this screen**,
and none of the labels say so.

---

## 2. WHAT WAS FIXED AND SHIPPED (so it is off tomorrow's list)

Plan: `docs/superpowers/plans/2026-09-18-workie-settings-and-defects.md`. Live on dev `e9f2f9d1`
and test `d878e743`.

- **The Workie settings a builder could not find.** A set carries two fields — `personaId` (the
  voice) and `promptId` (how each round is summed up). The console's editor showed both; the host's
  dialog opened the *same editor* without passing it the two lists, so both selects rendered one
  dead option and a host concluded the feature did not exist. Both are now settable from either
  surface, presented as one **Workie** group: *Its voice* and *How it sums up each round*.
- **The overlay does work** — this was checked end to end. Choosing a persona writes it on the game
  and the summary generator puts that persona's voice text at the head of the model prompt, changing
  the words of every round summary from the next round on. **If it looks dead on an environment, the
  cause is that persona rows are only created by a seed script (`scripts/seed-personas.js`) and there
  is no API that creates them.** An unseeded tier shows one option everywhere. Worth checking dev.
- A value that resolves to nothing is now refused with a message naming the fix, except a value the
  builder did not touch (so renaming an old set still works), and the editor shows such a value as
  unavailable with a one-click clear.
- Nothing over-claims: the session dialog says a set brings its own summary approach only when that
  prompt really resolves, and says nothing when it cannot tell.
- Copying a set into another organisation no longer carries a prompt that organisation cannot read.
- `/builder`'s seven hardcoded prompt ids — which the seeder never mints — are gone.

**Two residues:** sets copied before that day still hold unusable ids (the path is fixed, the rows
are not; there is no backfill), and none of it has been looked at in a browser, because the console
needs a signed-in session.

---

## 3. WHAT IS DECIDED

These came out of the conversation and should not be re-opened without a reason:

1. **The entry becomes a dialog**, not a panel below the table. Below-the-fold is the complaint.
2. **The conversation is a fallback, not the front door.** The owner's phrasing was "could it work
   better as a simple chat interview **if they don't provide a clear enough detail**". So: one box
   first; if the sentence carries enough, generate; only if it is thin does Workie ask, and an
   expert path stays visible throughout.
3. **Preview is for two moments**: before a session, on a laptop, with answers visible; and while
   editing — and for editing it must be reachable **at any time in edit mode**, not only after a save.
4. **The Workie/prompt question is answered** and shipped (§2).

---

## 4. THE PROPOSAL — the three mockups

### `01-new-set.html` — the way in
A **dialog** with three ways, each stating what it costs: Generate with AI (primary), Upload a CSV
(with the template download folded in), Import from archive (which loses tags, School, Question#,
the attached prompt and the AI context). The manual builder is demoted to a **link at the foot**,
because it genuinely is a separate tool in its own tab that does not know about the set. Survey's AI
path is **absent on purpose** — it downloads a file and never creates a set, which is a bug to fix,
not a path to offer. The format is asked **once**, inside whichever path needs it.

### `02-ai-describe.html` — the new AI builder, one screen
1. **One textarea:** "What is this set about?" — example: *80s movie trivia for a team offsite —
   mostly blockbusters, nothing too obscure*. Help: one or two sentences is plenty.
2. **Format as chips**, not a select.
3. **How many, as one row.** Three presets (Quick 12 / Standard 24 / Deep 48) that set both numbers,
   then a single sentence: "About **24** questions across **4** categories", with "6 per category"
   live beside it.
4. A **collapsed disclosure**, "Anything else Workie must obey", honest that it is read last.
5. Primary "Write the questions"; secondary "Ask me a few questions instead".

The topic and the direction **merge into the one box**, because a person describing a set writes
both in one breath. "What is the room told?" **moves to the set editor**, where the rest of the
player-facing copy already lives. The trailing requirements become the disclosure.

### `03-ai-interview.html` — the fallback
Appears only when the first sentence is too thin. Two or three questions, one at a time, each
offering **clickable suggestions** so nobody has to compose an answer; a visible "Skip the rest and
write them now"; and it writes **the same fields the form writes**, so the two paths converge and a
set made either way is indistinguishable afterwards.

Open detail the mockup author flagged: an answered turn keeps all its chips live with one filled,
rather than collapsing to the chosen answer. Live chips make re-answering free; the cost is that
"answered" and "waiting" differ only by a filled chip. Dimming was considered and rejected because
the dimmed text falls below the contrast bar.

---

## 5. THE TWO FEATURES THAT ARE NOT YET DESIGNED

### Preview — "flash through all or some questions"
**Nothing like it exists today.** The public library's "Preview" is wired straight to the full
editable editor, despite a comment calling it read-only.

What it would reuse: `components/stage/Stage.jsx` with the **Table display profile** (the 16px
laptop ladder), `components/stage/Pager.jsx` (arrow keys, wrapping, prints position), and
`RoundReport.jsx`, which already renders a question's title, detail, image and options in one
reusable block.

⚠️ **The honest prerequisite:** the ASK and reveal markup the host stage uses is **inline inside
`GameHostPage.jsx`**, not extracted. So a preview either duplicates it — and drifts — or a shared
question-card component is extracted first. `RoundReport.jsx` is the cheap interim.

One warning from the code: a one-at-a-time carousel was **removed** from batch review once before.
Keep preview a preview; do not rebuild review as a carousel.

### Adding questions and categories to an existing set
- **By hand: already works.** So does adding a category, but only from inside the question modal;
  there is no set-level category management.
- **Generating more into a set: one question at a time**, and each needs its own brief.
- ⚠️ **There is no backend route that appends to a set.** The only write is a whole-set replace.
  This is the blocker: "generate 10 more into this category" needs either a loop over the existing
  single-question route (works today, slow, N jobs) or a new bulk path. **This is the one item here
  with real backend cost**, and it should be sized before it is promised.

---

## 6. THE NUMBER CONTROL

`components/CountField.jsx` offers **four affordances for one integer**: a preset row, −/+ steppers,
a number box, and a painted slider whenever the range is wide. Its own header records that the
slider was removed once and came back.

Why it grates, specifically:
- Clearing the box **snaps to 1**, so you cannot backspace and retype.
- No hold-to-repeat and no coarse step: 5 → 50 is 45 clicks or a drag.
- Presets are hardcoded per site and **never include the maximum**.
- ⚠️ **The two numbers that multiply are not adjacent** — questions and categories sit two fields
  apart in both the scenario and trivia builders — and only the categories field states the product.
- There is **no "questions per category" control** at all; it exists only as prose.

The mockup's answer is one row: presets that set both, the two numbers adjacent in a sentence, and
the product shown live. Note the constraint: `__tests__/countField.test.jsx` bans a range input
elsewhere and a bare number box in any builder, so a redesign stays inside `CountField.jsx`.

---

## 7. WHAT THE MOCKUPS ASSUME BUT NOBODY HAS AGREED

**The one-screen fork.** The mockups assume the three type-specific builders and the catch-all
collapse into a single screen where the format is a chip. The alternatives are: keep all four and
put the conversation in front of them (smaller change, four screens still drift), or collapse three
and leave the scenario wizard alone because it is genuinely more complex.

Looking at the drawn screen, one screen seems right — the format-specific difference really is small
enough to be a chip — but that is the author's read, not a decision.

---

## 8. QUESTIONS FOR TOMORROW

1. **Is the one-screen shape the direction?** Everything else in §4 depends on it.
2. **Is Survey's AI path worth fixing, or should it go?** It currently downloads a file and creates
   nothing. The mockups omit it.
3. **Does the manual builder stay?** It is a separate tool in its own tab that knows nothing about
   the set. Demoting it to a link (as drawn) is the mild option; retiring it is the other.
4. **How much does "add more questions" matter, given it needs a backend route?** It is the only
   item with real server cost and it decides whether this is one project or two.
5. **Does preview justify extracting a shared question card**, or is the `RoundReport` interim
   enough to start?
6. **The interview's answered-turn detail** (§4) — live chips or collapse.

## 9. SUGGESTED SEQUENCE, IF IT ALL GOES AHEAD

1. The entry dialog and the one AI screen — highest value, no backend, and it removes the
   below-the-fold complaint, the always-visible CSV form, and the four-fields confusion together.
2. The count row, inside `CountField.jsx`, pinned by its existing tests.
3. Preview, starting from `RoundReport`, with the shared-card extraction as its own decision.
4. The append route and "generate more into this category" — sized first, because it is the only
   part that is not a frontend change.

Fix Survey's dead end wherever it lands in that order; it is small and it is currently a trap.
