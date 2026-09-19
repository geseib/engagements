# Handoff — the score card that measures, and the question preview (2026-09-19)

Two owner requests, built as two parallel workflows in two worktrees, merged and pushed to **dev**.
Neither is on test or prod.

| | Branch | Dev |
|---|---|---|
| Score card | `working/scorecard-tally` | live since `edd261db` (pipeline `65e0d8b7`, Succeeded) |
| Question preview | `working/question-preview` | first cut live since `edd261db`; a follow-up round rides the next dev push |

---

## 1. The score card — "it doesn't reveal much"

The owner's serial-killer trivia set showed "Checked — passed" and "The check found nothing to say."

### Why it was empty — verified live, not inferred

`shared/content-guardrail.js` sent `ApplyGuardrail` with **no `outputScope`**, so Bedrock returned only
filters that INTERVENED, and every content filter is `InputStrength: LOW` (intervenes on HIGH only).
Probed against the dev guardrail `ugftgdxrubb4` at version `1` (the version
`engagedev-check-question-set` runs, not DRAFT): the default scope returned **0 filters** for a
"murdering and dismembering" question, a mild one and a neutral control alike. `FULL` returned all six
categories, the graphic one as `VIOLENCE: LOW, detected: false, action: NONE`.

So the check never saw a LOW or a MEDIUM, and the documented **MEDIUM → escalated → "N uncertain
questions"** path has very likely never fired in production. MEDIUM was not sampled live; it follows
from the same strength rule. AWS CLI 2.24.20 has no `--output-scope` — probe through the SDK.

### What it does now

- **Owner decision: measure everything, gate exactly as before.** `outputScope: 'FULL'`. A filter
  intervened if `detected !== false` (true, or absent as in every pre-FULL response and old mock).
  Only intervened filters reach `outcomeForBand`, so no set that auto-published before is escalated.
  Turning MEDIUM gating on is a separate, deliberate decision that nobody has made.
- **New on the REVIEW row:** `review.tally` (`scope: 'full'`, `questions`, `setTextChecked`,
  `spotless`, `unread`, and all five categories with `worst` and distinct `low/medium/high` counts)
  and `review.observed` (every LOW+ band, `{questionId, category, band, intervened, explanation?}`).
  **`findings` keeps its meaning** — the queue, the author banner, moderation-list and moderation-get
  read it, and none of them changed. The `checked` log event carries the tally, never `observed`.
- **Explanations reach passed sets**, worst first, still at most 12 Haiku calls per check in total,
  with the budget re-checked before every call.
- **`standing()`** now projects `reasons`, `tally`, `observed` and `declaredNotice`, and names each
  observed question by its text from the **public copy in DynamoDB** — not the S3 snapshot, which has
  a 30-day lifecycle and for which this function has no grant.
- **The card** shows a summary line, the five-category block with "none" written out, every observed
  question by its text with why and whether it held the set, the reasons in the queue's own words
  (`whyLabel`), the appeal's text, and plain sentences for a check that stopped on an error and for
  one made before any of this existed.

**Sets checked before this deploy have no tally** and say so (owner's choice: no re-check button, no
backfill). To see a real card on dev, share a set again, then open Public library → Score card.

### Parked, with reasons

- The queue's "Uncertain (medium ×N)" can never render: the worker writes `bands` as
  `{category: band}`, `escalationWords` reads counts per band. Filed as its own task.
- `review.observed` has no size cap. About 100 bytes a row; a 200-question set hitting all five
  categories is ~100 KB, well under DynamoDB's 400 KB item limit, but nothing enforces it.
- A passed set now waits for up to 12 sequential Haiku calls before its review row is written.
- The card keeps its own copy of the category words and band sentences; drift is possible.
- The live stage's trivia RESULTS draws no question, although its own mockup
  (`docs/design/host-redesign/07-results-trivia.html`) draws a recap line. Not touched.

## 2. The question preview — "flash through all or some questions"

Answers `create-set-experience-2026-09-18.md` open question 5: **extract a shared card.** Spec
`docs/superpowers/specs/2026-09-19-question-preview-design.md` (carries dated corrections), plan
`docs/superpowers/plans/2026-09-19-question-preview.md` (its D-notes record every decision).

- **Where:** the set editor's Questions tab, `[Table] [Preview]`, at any time in edit mode, unsaved
  edits included (the working rows and the Details panel's live Custom Instructions).
- **Left:** the in-session browser's mechanics — search over title and detail, category chips,
  "Showing N of M", ↑/↓. **Right:** `components/QuestionCard.jsx`, which **the live stage now also
  renders** (extracted from `GameHostPage.jsx` as a pure refactor), at the Table ladder via the
  `.stage-ladder-table` scope — the preview never touches `document.documentElement`.
- **Reveal** is offered wherever there is something to reveal: trivia's correct option, or any
  question's `answerDetails` (art sets keep the real title there). It is sticky across questions and
  draws the question above the revealed options.
- Saving in Preview keeps the preview up on the same question and phase; the importer renumbers every
  SK on save, so the place is re-found through `savedKeys`, not the old key.

### Parked

- Entry is the editor only (owner's choice). **The public library's "Preview" button still opens the
  full editable editor**, despite its comment calling it read-only.
- The fitter is not simulated: on a dense question the stage may drop `data-drop` lines the preview
  shows.

## 3. How this was built, for the next person

Two workflows ran in parallel in two worktrees under `.claude/worktrees/`, each task test-first and
reviewed before the next started; reviews caught at least one real defect in every task. Worth
knowing: moving markup out of `GameHostPage.jsx` silently hollowed out two NEGATIVE source-scan guards
(retired topic field, retired author-reveal controls) until they were pointed at the card too — any
future extraction should grep for scans of the file it moves markup out of.
