# Wave D, part two — the Question Sets tab and the generation job

**Date:** 2026-08-11
**Status:** proposed, awaiting owner approval. No code has been changed.
**Parent plan:** [2026-08-10-admin-console.md](2026-08-10-admin-console.md) §"Wave D"
**Owner constraint, verbatim:** *"fix bugs, and add capabilities that are needed as long as they are not considered major uplift items."* Part 5 says plainly which items exceed that.

**Grounding:** the 22 mockups in `docs/design/admin-redesign/`, its `RATIONALE.md` (§6 the generation job, §8 destructive actions, §9 smaller decisions) and `OPEN-QUESTIONS.md` #1, #2, #3, #5, #8, #9. Every line number below was re-derived on `dev` at `6a4ead84`. `INVENTORY.md`'s numbers, and the parent plan's, are stale — `AdminPage.jsx` is **1,719** lines today, not 1,769 or 1,805, because Sessions, Users and the set editor have already left it.

---

## 0. What has already shipped, and what it changes about this slice

| Landed | Commit | Consequence for this plan |
|---|---|---|
| Wave A — the variable catalogue, save-time validation | `e6665458` | Touches the *variable* contract only. It never touched `AdminPage.jsx`, and it says nothing about prompt **usability**. The summary-prompt picker defect below is unclaimed by any wave. |
| Wave B — output contract, renderer hardening | `e6665458` | Independent. |
| Wave C — `AdminShell`, left nav, breadcrumb, env chip | `819bc7e1` | A list and its detail are already two places. `contentTheme` is per-section (`AdminPage.jsx:41-79`), so Question sets can convert to dusk on its own. |
| Wave D — Sessions, Users | `6a4ead84` | `SessionsPanel.jsx` / `UserManagement.jsx` + their tests are the precedents to match exactly. |
| The set **editor** | `43e04d67`, `d3d88322` | `QuestionSetEditor.jsx` (850 lines) already is the detail place: Details / Questions / Versions / Media seam, the replace preview, the version list, `interpretVersionDelete`. **Mockup 04 is largely built.** What is *not* built is the Delete panel inside it and the questions table. |
| `selectableSummaryPrompts()` | `d3d88322` | The prompt-picker fix already exists as a tested pure function at `utils/questionSetEditing.js:330`. The editor uses it; the upload form does not. |

So this slice is **smaller than the parent plan implies for sets, and larger than it implies for generation**.

---

## 1. The constraint that shapes every item

`AdminPage.jsx` **cannot be mounted in jsdom.** Verified by running it:

```
src/src/__tests__/AdminPage.test.jsx   Tests: 8 failed, 8 total
  useAuth must be used within an AuthProvider
  at useAuth (src/auth/AuthContext.jsx:29)
  at AdminPage (src/AdminPage.jsx:98)
```

`useAuth` hard-throws when the context is null (`AuthContext.jsx:27-30`); the only provider is the real Cognito one. Every test in that file has failed since it was written, and they also assert a UI that no longer exists ("Admin Panel", "Delete Single Game").

**Therefore: nothing planned here is testable until it is a component that renders on its own.** Five precedents prove the pattern — `GameSetupDialog`, `SessionSetupPanel`, `Podium`, `WelcomeScreen`, `AdminShell` — and two more prove it for components that talk to the API.

**The recipe, for the implementer:**

- *Pure-props components* (`Podium`, `WelcomeScreen`, `AdminShell`): props in, callbacks out, no `useAuth`, no `authFetch`, no `fetch`. Their tests contain **zero** `jest.mock` calls.
- *Components that must call the API* (`SessionsPanel`, `UserManagement`): mock exactly two modules and nothing else —
  ```js
  jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn() }));
  jest.mock('../auth/AuthContext', () => ({ useAuth: () => ({ isAdmin: () => mockAuth.admin }) }));
  ```
  plus a `jsonResponse(status, body)` helper, a `mockApi({...})` router that `throw`s on an unmatched URL, and an `async mount()` that waits on the loading text disappearing (`fetch → json()` is two awaits deep; one flush resolves only the first). **Never wrap `AuthProvider`.**
- House rules from those files, kept: **no geometric assertions** (jsdom has no layout engine, so they pass unconditionally), and every test carries a `// rejects:` comment naming the implementation change it would catch. If the answer is "nothing", the test is not written.
- Where the wiring back into `AdminPage.jsx` matters and cannot be rendered, add a `*CallSite.test.js` that reads the source with `fs.readFileSync` — the pattern in `sessionsPanel.test.jsx`'s last describe and `adminShellPalette.test.js`. Strip comments before asserting; a previous agent's test passed on a comment, which is why `podium.test.jsx` has a `stripComments()` helper.

**Baselines to hold** (measured today, both differ from the parent plan's figures):

| | now |
|---|---|
| Frontend `cd src && CI=true npx jest` | **54 suites: 5 failed / 49 passed · 952 tests: 30 failed / 922 passed** |
| The 5 failures | `AdminPage`, `GameHostPage`, `App` (all: `useAuth` outside a provider), `PlayerPage` (stale expectations), `WebSocketClient` (`not a constructor`). All pre-existing. |
| Backend | 32 standalone `node tests/*.js` scripts, **32 pass / 0 fail**. There is no backend jest; `lambda-functions/package.json`'s `test` script is an `echo`. The 11 `tests/*.spec.js` are Playwright and need a live server. |

---

## 2. The order, and why it is this order

| # | Item | Kind | Backend? | Size |
|---|---|---|---|---|
| **G1** | Terminal job state stops being inferred from `items.length` | bug — headline | no | M |
| **G2** | `completed` / `requested` / `warnings` reach the screen | bug | no | S |
| **G3** | Poll options survive generation | bug — silent data loss | no | S |
| **G4** | CSV values are escaped | bug — silent data loss | no | S |
| **G5** | The job outlives the modal | capability | no | M |
| **G6** | Review is a table with per-item reject | capability | no | L |
| **Q1** | A failed set-delete stops looking like a success | bug | no | S |
| **Q2** | The two empty states stop lying | bug | no | S |
| **Q3** | The summary-prompt picker uses the helper that already exists | bug | no | XS |
| **Q4** | The type filter is derived, not hand-written | bug | no | XS |
| **Q5** | CSV is validated before the round trip | capability | no | M |
| **Q6** | One engagement-type control, once | bug | no | M |
| **B1** | Set-delete answers with its consequence | capability | **yes** | L |
| **B2** | Job cancellation | capability | **yes** | M |
| **B3** | Report snapshot at ENDED | capability | **yes** | own project |
| **O1** | Survey's future | — | decision | — |
| **O2** | Does editing a prompt create a version | — | decision | — |
| **O3** | The six broken prompts: cull or carry | — | decision | — |

G1–G4 first because they are data-integrity bugs that are shipping wrong answers today. Q1–Q4 next because they are each under an hour once the panel exists. G5, G6, Q5, Q6 are the four real pieces of work.

---

## 3. Part one — the generation job (zero backend, ships first)

`RATIONALE.md:239`: *"the largest new piece of design and the one I would ship first."* Confirmed: every number these screens need is already in the poll response.

**The wire, exactly.** `lambda-functions/admin/shared/generation-jobs.js:178-192`, `jobToResponse()` returns ten keys and nothing else:

```js
{ jobId, status, phase, requested, completed, items, warnings, meta, error, updatedAt }
```

`status` ∈ `queued | running | complete | error`. The job row lives at `PK='AIJOBS'`, `SK='AIJOB#<id>'` with a **3-day TTL stamped only at creation** (`generation-jobs.js:39, 77`) — nothing refreshes it. POST returns `202 {jobId, status:'queued', requested}`. A missing job is `404 {error:'Job not found or expired'}`.

**And the fact everything turns on:** `failJob(..., { items: produced })` writes `status:'error'`, `errorMessage`, `phase:'Failed'` **and** `items` + `completed` in one `UpdateCommand` (`shared/generation-handler.js:197`, `generation-jobs.js:148-170`). A partial failure is a single row carrying both the error and the work. A client that does not read both renders one of them.

### G1. A partial failure renders as a success. — bug, headline

**What happens.** `pollGenerationJob` (`src/src/utils/aiBatchClient.js:121-171`) calls `onProgress(job)` at **:161**, *then* checks status. On `'error'` (**:165-169**) it builds an `Error`, hangs `err.partialItems = job.items` on it, and throws — discarding `completed`, `requested`, `warnings`, `phase` and `meta` in the act.

All four builders then land in the same place:

| builder | catch | what it sets | render branch | where `Generation failed:` goes |
|---|---|---|---|---|
| `TriviaAIBuilder.jsx` | :77-87 | `partialItems` → `generatedTrivia` (:80-83), status (:84) | `generatedTrivia.length > 0` (:330) | the `length === 0` else-branch (:521-527) |
| `PollAIBuilder.jsx` | :74-81 | :76-79, :80 | :296 | :447 |
| `SurveyAIBuilder.jsx` | :91-98 | :93-96, :97 | `generatedSurvey` truthy (:518+) | :631 |
| `AIScenarioBuilder.jsx` | :471-476 | **nothing** — but `onProgress` at :457-461 already wrote `generatedScenarios` | :872 | :977 |

So in every one of the four, the operator sees a review table and a live **Load into System** (`TriviaAIBuilder.jsx:516`) over a job that failed. `AIScenarioBuilder` gets there without touching `partialItems` at all: `onProgress` fires on the final poll, before the throw.

Also dead on that path: `warnings[]` is only joined into `generationStatus` on the **success** branch (`TriviaAIBuilder.jsx:72-76`, `PollAIBuilder.jsx:68-72`, `SurveyAIBuilder.jsx:86-90`, `AIScenarioBuilder.jsx:466-468`); `completed` and `requested` are on every response and read nowhere in `src/`.

**The fix.**

1. `pollGenerationJob` **resolves** with the terminal job when `status === 'error'` instead of throwing. It keeps throwing only for transport failures — timeout (:136-138), five consecutive poll errors (:154-155), 404 (:145-147) — because those genuinely have no job to show. Keep setting `err.partialItems` on the transport paths for compatibility; nothing will read it once the builders move.
2. New pure module `src/src/utils/generationJob.js` exporting `interpretGenerationJob(job)` → `{ outcome, items, completed, requested, warnings, error, meta }` where `outcome ∈ 'running' | 'complete' | 'partial' | 'empty-failure'`. This is the direct analogue of `interpretVersionDelete` (`utils/questionSetEditing.js:246+`), which exists for exactly this reason and is already tested.
3. Every render branch keys on `outcome`, **never on `items.length`**. That single change is the bug.

**Files.** `src/src/utils/aiBatchClient.js`; new `src/src/utils/generationJob.js`; new `src/src/components/GenerationJobPanel.jsx` (see G2); the four builders drop their bespoke status strings and render the panel.

**Verified by.** `generationJob.test.js`: a job with `status:'error'`, `items` of 41 and `requested` 100 yields `outcome:'partial'` and never `'complete'`. `generationJobPanel.test.jsx`: given that job, the primary action is **not** "Load into System"; the error string is on screen; the warnings are listed. `// rejects:` a future edit that re-derives the branch from `items.length`.

### G2. Show the numbers already on the wire — bug

`RATIONALE.md:6.2-6.4`. Mockups 09 and 10.

- **`completed` / `requested`** become "34 of 100" (running) and "stopped at 41 of 100" (failed).
- **`warnings[]`** get displayed for the first time. One caveat found in the backend and worth stating on the screen: **`failJob` does not write `warnings`** (`generation-jobs.js:148-170`), so on a hard failure the client sees only the warnings persisted by the last successful `updateJobProgress`. If the failure lands in pass 1 there are none. Do not write copy that promises a complete list.
- **The bar is indeterminate.** `updateJobProgress` fires once per completed model call (`generation-handler.js:178-184`) and one call fits 17–67 items. For any request at or below that there is exactly one update, at the end. Draw a real fraction that jumps, an indeterminate sweep for liveness, and the sentence saying why — mockup 09 has the copy.
- **No Cancel button, and the screen says why.** Verified: no cancel route exists in `template-clean.yaml`, and the worker **never re-reads the job row** between passes — it checks only `context.getRemainingTimeInMillis()` (`generation-handler.js:105-112`). So even a flag written by a new endpoint would be invisible to the worker as written. `isCancelled` at `aiBatchClient.js:128` is client-side and no caller passes it.

**Files.** New `src/src/components/GenerationJobPanel.jsx` + `.css`, pure-props: takes the interpreted job and callbacks, renders running / partial / failed. The four builders mount it.

**Verified by.** `generationJobPanel.test.jsx` — running state shows "34 of 100" and no Cancel control anywhere in the tree; the "it cannot be stopped" line is present; warnings render as a list.

### G3. Every AI-generated poll set imports with no options — bug, silent data loss

Not in the brief; found while checking the serialisers, and it is the most expensive bug in this slice.

`generatePollCSV` emits `Option1,Option2,…,Option5` — `AdminPage.jsx:843` (header), `:866` (row) — as does `PollAIBuilder.jsx:136, :143`. The importer reads **one** `Options` column, pipe-separated: `upload-questions.js:301-304` (`optionsIndex = getColumnIndex('Options')`), split at `:447`. `getColumnIndex` (`:262`) is an exact case-insensitive match with no numbered fallback. So `options` lands as `[]` for every question (`:666`), and a poll set generated by AI plays with nothing to vote on.

Mockup 06 draws this as a named product bug. `OPEN-QUESTIONS.md#11` asks whether to fix the builder, the importer, or both.

**The fix, zero backend:** the emitters write a single `Options` column joined with `|`. One line each in two files. Fixing the emitter, not the importer, because the importer's format is what every hand-authored and template CSV already uses (`download-template.js`), and changing the reader would need to keep both shapes forever.

**Verified by.** A serialiser test asserting the header contains `Options` and not `Option1`, and that a three-option question round-trips through `parseCsv` to `a|b|c`. Plus the existing backend script `node tests/…` covering `upload-questions` poll parsing.

### G4. Nine CSV serialisers interpolate values bare — bug, silent data loss

`"${value}"` with no escaping. A `"` in a title ends the field and shifts every subsequent column; a newline ends the row.

| file | lines |
|---|---|
| `src/src/AdminPage.jsx` | 714 (scenario), 790 (trivia), 866 (poll) |
| `src/src/components/TriviaAIBuilder.jsx` | 130 |
| `src/src/components/PollAIBuilder.jsx` | 143 |
| `src/src/components/AIScenarioBuilder.jsx` | 521 |
| `src/src/BuilderPage.jsx` | 160, 166, 171, 177 |

The brief named three; there are nine, in five files. The reader half of this is already correct and quote-aware — `parseCsv()` at `utils/questionSetEditing.js:104-148` doubles embedded quotes properly. Only the writers are wrong.

**The fix.** One `src/src/utils/csv.js` exporting `csvCell(value)` (doubling `"`, always quoting) and `csvRow(values)`. All nine sites call it. Pure, no React, ~15 lines.

**Verified by.** `csv.test.js` — a title containing `"`, a comma and a newline survives `csvRow` → `parseCsv` unchanged. `// rejects:` a return to bare interpolation. Round-trip the existing `tagsToCsvCell` output through it so tags are not double-escaped.

### G5. The job outlives the modal — capability, moderate

`RATIONALE.md:6.1`. Today the `jobId` lives in a local `const` inside each `handleConfigSubmit` (`TriviaAIBuilder.jsx:47`), the modal's only exit unmounts the component while the polling loop keeps writing into it, and the timeout message (`aiBatchClient.js:137`) advises you to *"reopen the builder to check"* — which is impossible, because nothing stores the id.

Three parts, and I recommend shipping only the first two:

1. **Persist the id.** `localStorage`, keyed by endpoint, cleared when the job reaches a terminal outcome or is dismissed. On mount, a builder with a stored id resumes polling instead of starting at step 1. Small.
2. **"Close — this keeps running" becomes the primary action** on the running screen, with the four-line "If you leave" block from mockup 09. Also fix `POLL_TIMEOUT_MS` (`aiBatchClient.js:103`): the client gives up at 10 minutes on a worker allowed 15, so a long job is abandoned by the watcher while still succeeding. Raise past the worker ceiling; the "reopen to check" sentence becomes true once (1) lands. Small.
3. **The top-bar jobs chip and tray** (mockup 09, "2 jobs · 34/100"). This is a change to `AdminShell` — a new slot, a new tray component, and a job registry that outlives the Question sets screen. **Recommend deferring**; it is the one part of the generation work that is a new subsystem rather than a repair.

**Note the 3-day TTL is real and unrefreshed** — a stored id older than three days will 404. The resume path must treat 404 as "that job is gone", not as an error.

**Verified by.** `generationJobResume.test.jsx` — a stored id causes exactly one GET on mount and no POST; a 404 clears storage and returns to configuration with a stated reason.

### G6. Review is a table with per-item reject — capability, the largest item here

`RATIONALE.md:6.6`, mockup 11. Today review is a one-item carousel behind Previous/Next (`TriviaAIBuilder.jsx:332-353`), and there is no way to drop a single generated item: `handleLoadIntoSystem` (`:135-147`) sends the whole array. One bad question means importing it and fixing it later, or discarding eighty-three good ones.

**Scope I recommend:** a `GeneratedItemsTable` — `#`, question, category, difficulty, a per-row exclude toggle, and an Edit that opens the existing per-item editor. Keep the carousel editor; it is fine as a drill-in. The header states the shortfall ("You asked for 100 and got 84") from `requested` vs `items.length`, and names the near-duplicate suppression, which the server currently only `console.warn`s.

**Be honest about this one:** it is new UI, roughly 200 lines plus a test, replicated across four builders unless they share the component. Share it. If the owner wants the slice smaller, G6 is the item to cut — G1 alone stops the console from lying, and the carousel is merely bad, not wrong.

---

## 4. Part two — Question sets (zero backend)

### Q1. A failed delete is visually identical to a success — bug

`questionSetDeleteStatus` is set **six** times — `AdminPage.jsx:411, 910, 919, 935, 939, 943` — and rendered **zero** times. `isDeletingQuestionSet` is set at `:918` and `:945` and read nowhere, so there is no busy state. And `confirmDeleteQuestionSet` closes the modal at **`:917`, before the request is sent** (`:925`), so success and failure both look like "the dialog went away".

`handleDeleteQuestionSet` (`:908-914`) is dead — the only wired path is `handleDeleteQuestionSetFromList` (`:408-414`) from the row button at `:1260`. Delete it rather than wiring it; the `'Please select a question set to delete'` branch belongs to a selector that no longer exists.

**The fix.** Extract `src/src/components/QuestionSetDeleteDialog.jsx`: owns its own busy and outcome state, **stays open until the server answers**, renders the outcome, and only then closes on acknowledgement. Model it on the version-delete flow already in `QuestionSetEditor.jsx`, which gets this right.

Two things the dialog can say *today*, with no backend (the rest is B1):

- **Offer the reversible neighbour.** "Or deactivate it instead — it stops appearing in the host's picker and nothing is lost." The Active toggle already exists at `AdminPage.jsx:1228-1234`. `RATIONALE.md:344-347`: this prevents more damage than any amount of red.
- **State the report consequence generically**, since it is unconditionally true: a report is built on demand from the live set, so deleting a set decides which past sessions can still produce one.

**Verified by.** `questionSetDeleteDialog.test.jsx` (the `SessionsPanel` pattern): a 500 leaves the dialog open with the error text and the set still in the list; a 200 shows what was deleted; the confirm button is disabled while in flight. `// rejects:` a return to closing before the response.

### Q2. Both empty states lie — bug

`AdminPage.jsx:1174-1179`. `questionSets.length === 0` prints *"Upload your first question set above to get started"* — while the upload form is **below** it (`:1281`) and collapsed by default (`isUploadSectionExpanded`, `:183`). Host spec §7.9, and `RATIONALE.md:170-173` names it.

The `else` prints *"No question sets found matching your filters"* with no exit.

**The fix**, per mockups 02 and 03:

- **Nothing exists:** the three ranked creation paths, in the work area, not a grey sentence.
- **Nothing matches:** count the result of dropping each active filter individually — one extra pass over `questionSets`, which is already in memory — and offer each as a one-click exit, plus "Clear all filters".

**Files.** Extract `src/src/components/QuestionSetsPanel.jsx` (list + filters + both empty states + row actions), leaving `AdminPage` to own fetching. Pure-props except the fetch, which stays in the page. This extraction is the prerequisite for Q1, Q2, Q4 and Q6 being testable at all.

**Verified by.** `questionSetsPanel.test.jsx` — with zero sets, the copy contains no word "above"; with 41 sets and three filters matching none, each filter's drop-count is stated and clicking one clears exactly that filter.

### Q3. The summary-prompt picker offers prompts that cannot work — bug, XS

`AdminPage.jsx:1399-1413`. The filter at **`:1406-1407`** compares `prompt.gameType` as a raw string with one hand-patched `call-and-answer → callandanswer` case. Three consequences, not one:

1. A **generation-shaped** prompt is selectable; attaching it does nothing, because `get-ai-summary.js` rejects it and silently falls back to the default — the "I picked a prompt and nothing changed" symptom.
2. A record with **no `promptId`** renders `<option value={undefined}>`, which makes the browser submit the option's label text as the value. `get-ai-prompts.js:100-107` documents exactly this failure.
3. The raw compare misses `polls` and every other alias, so those prompts never appear at all.

**The fix is a one-site change**, because the function already exists and is already tested: `selectableSummaryPrompts(prompts, engagementType)` at `utils/questionSetEditing.js:330-339`. `QuestionSetEditor.jsx` has used it since `d3d88322` (`:90-91`, rendered `:556-571` with the "showing N of M" line mockup 04 asks for). `AdminPage.jsx` imports only `truncate` from that module (`:24`). Two pickers in one app disagree.

**Do not "improve" it into a status filter.** The verdict *is* on the wire — `get-ai-prompts.js:109-137` decorates every record with `malformed`, `summaryPromptStatus` and `summaryPromptDefect`, and `AIPromptManager.jsx:1029-1040` already renders them. But `summaryPromptStatus` is computed from `promptContent || basePrompt` (`:119`), and `promptContent` is only fetched with `includeContent=true`, which `AdminPage.jsx:204` does not pass. So analysis prompts come back `'unknown'`. A `!== 'usable'` filter would empty the list. That reasoning is already written down at `questionSetEditing.js:324-328` and asserted by `questionSetEditing.test.js:390-395`: **status annotates, structure excludes.** Keep it that way.

**Verified by.** Extend `questionSetEditing.test.js` if the helper changes at all; otherwise a `*CallSite` source assertion that `AdminPage.jsx` imports and calls `selectableSummaryPrompts`, since the page cannot render. Better: this select moves into `QuestionSetUploadPanel` (Q5/Q6) and becomes rendered-testable there.

### Q4. The type filter is hand-written and has drifted — bug, XS

`AdminPage.jsx:1137-1142` lists four types and omits Survey, while the upload select (`:1341`) and the new-set select (`:1473`) both offer it. `config/gameTypes.js` exists precisely to stop this and already exports `GAME_TYPE_LIST`, `PICKER_GAME_TYPES` and `UNPLAYABLE_GAME_TYPES`. Derive all three lists from it. Which list each `<select>` derives from is the O1 decision.

### Q5. CSV is validated after the round trip, not before — capability

Mockup 06. Three things are true today:

- `summarizeCsv()` (`utils/questionSetEditing.js:151-181`) already parses the file in the browser, quote-aware, and is already used by the editor's replace preview.
- `handleFileSelect` (`AdminPage.jsx:509-581`) ignores it and does `lines[0].split(',')` at **`:540`** with `replace(/"/g,'')` — a naive split that mis-parses any quoted comma, i.e. most real files. It then auto-populates the description from whatever that produced.
- The server **already returns** `skippedRowCount` and the first fifty `skippedRows` with reasons, and the only place that surfaces is one clause appended to a success message *after the write*.

**Recommended scope (in the constraint):**

- Replace `:540`'s hand-rolled parse with `summarizeCsv`. Pure win, no new UI.
- Grow `summarizeCsv` into a `preflight(text, engagementType)` returning three tiers: **stops the import** (no Title column — `upload-questions.js:343-355` 400s on it), **would be skipped silently** (missing Category, too few columns, unbalanced quote), **known importer gaps** (the `Option1..5` shape from G3; `Image` values that will resolve to `sets/<setId>/…` with no object behind them). All of it is derivable from the parse plus the importer's published rules.
- Show `skippedRows` **before** the write, in a table.

**Out of the constraint (see Part 5):** the auto-fix actions mockup 06 draws — "Treat `Prompt` as Title", "Merge into `Options`". They mean rewriting the file client-side and are their own feature.

**Files.** Extend `utils/questionSetEditing.js` (or a sibling `utils/csvPreflight.js` importing its `parseCsv`); new `src/src/components/QuestionSetUploadPanel.jsx` carrying the form, the preflight report and the prompt picker from Q3.

**Verified by.** `csvPreflight.test.js` over fixture files — headerless, no-Title, quoted-comma, unbalanced-quote, `Option1..5`. Pure functions, no rendering. Then `questionSetUploadPanel.test.jsx` for the report rendering and the disabled Upload button.

### Q6. One engagement-type control, rendered twice — bug

`engagementType` (`AdminPage.jsx:124`) is one state behind **two** `<select>` elements on the same tab: `:1331-1342` inside the upload accordion and `:1463-1474` in "Add New Question Set". Changing either silently changes the other, and it also decides which AI builder the button opens (`:1477-1497`) and which template downloads (`:1504-1513`).

Mockup 07 resolves this by asking for the type **inside** whichever creation path you pick, behind a single "New set" action.

**Two options, and I recommend the smaller one:**

- **(a) In the constraint.** One control. The upload panel owns the select; the "Add new set" section stops rendering its own and reads the panel's value, or — cleaner — the AI-builder buttons move inside the upload/creation panel so the type is asked once, where it is used. ~1 day including the extraction.
- **(b) Mockup 07 in full.** A `NewQuestionSetChooser` with five ranked paths, each stating what it is best for and what it costs, and the type asked inside the path. This is genuinely better and it is a new screen. See Part 5.

**Verified by.** `questionSetUploadPanel.test.jsx` — changing the type once changes every dependent label and the builder that opens; a source assertion that only one `id="engagement-type"`-class select exists in the tree.

---

## 5. Part three — needs a backend contract

### B1. Set-delete answers with its consequence

`OPEN-QUESTIONS.md#1`, `RATIONALE.md` §8, mockup 14. **Verified in full:**

- `DELETE /admin/question-sets/{setId}` (`lambda-functions/admin/delete-question-set.js`) checks exactly two things: that `setId` is present (400) and that the set exists (404). **No usage check, no pin check, no `?confirm=true`.** It then deletes every row in `SET#<id>` and `SET#<id>#v1 … v(highest+5)`, then the index row. Non-atomic by design, ordered so a mid-flight failure leaves the set listed and retryable. No S3 objects are touched — images are keys served from the web bucket, so a delete strands them.
- `DELETE …/versions/{version}` is the contract to copy, and the mockup's assumption needs one correction: the pinned path is **`200` with `{deleted:false, requiresConfirmation:true, warning, pinnedByGames:[gameId], pinnedGames:[{gameId,title,state,ended}]}`**, not 409. 409 is reserved for "that is the active version" and for the race guard. The frontend already interprets all of it — `interpretVersionDelete` at `utils/questionSetEditing.js:246+`.
- **"Which games used set X" is answerable, but there is no index for it.** `template-clean.yaml:88-105` defines the table with `PK`/`SK` only and **no GSIs anywhere**. The only mechanism is a full paginated query of the `GAMES` partition with a client-side filter — which `findGamesPinnedToVersion` (`admin/shared/set-version.js:242-273`) already does. A set-level check is that function with the version filter dropped. Note it deliberately skips games with no version pin, and `GAMES` rows carry their own TTL, so a set used by long-expired sessions is genuinely unfindable and the dialog must not claim completeness.
- **Two facts that change the mockup's copy.** A report is materialised lazily *and rebuilt on every view* — `GameHostPage.jsx:2927` POSTs each time — from the live set (`create-report.js:139-141, 256-281`). And the stored copy carries a **30-day TTL** (`create-report.js:643`). So mockup 14's "Report already saved. Unaffected." is true for thirty days, not forever. Say so, or accept it.

**Shape to build:** `DELETE /admin/question-sets/{setId}` returns `200 {deleted:false, requiresConfirmation:true, usedByGames:[{gameId,title,endedAt,state,hasStoredReport}]}` unless `?confirm=true`. The frontend half is small because Q1's dialog and `interpretVersionDelete`'s precedent already exist.

**Size: L, and mostly backend.** One new query path, one contract change, one test script in `tests/`. It is a *capability*, not a bug fix — the bug (Q1) is that the result is never rendered, and Q1 fixes that without it.

### B2. Job cancellation

`OPEN-QUESTIONS.md#9`. There is no cancel route. Beyond that: **the worker never re-reads the job row**, so a flag written by a new endpoint would be invisible as the code stands. Cancellation needs `DELETE /admin/ai-generate-*/{jobId}` **and** a read-and-check between passes in `shared/generation-handler.js` (and again in `ai-generate-scenarios.js`, which carries a byte-for-byte inline copy of the same flow). Until both exist, do not draw the button — G2 states why on the screen instead.

### B3. Snapshot the report at ENDED

`OPEN-QUESTIONS.md#2`. If `create-report` ran automatically when a session reaches `ENDED`, set deletion would stop being destructive to history and B1 would shrink to a courtesy warning. This is the right fix to the underlying problem and it is **its own project** — it changes when compute is spent, and the 30-day report TTL would have to be reconsidered with it.

---

## 6. Part four — blocked on an owner decision

### O1. Survey: finish it, hide it, or label it

`OPEN-QUESTIONS.md#3`. The state, verified:

- `handleSurveyGenerated` (`AdminPage.jsx:874-905`) does not upload. It builds a Blob, clicks an anchor, and reports *"exported as JSON file"* (`:899`).
- `upload-questions.js:146-161` rejects survey outright, and the gate is three-way — `engagementType === 'survey'` **or** a `.json` filename **or** content starting with `[`/`{`.
- `handleFileSelect` already admits this to the operator at `AdminPage.jsx:527`: *"survey JSON upload is not yet supported by the server"* — while the form still offers Survey and the Upload button still enables.
- `config/gameTypes.js` already holds `survey` in `UNPLAYABLE_GAME_TYPES`, so the host's create dialog hides it. Only the admin pickers still offer it.
- `GAME_TYPES.survey.phases` records that a survey would fall through into a **VOTE** phase, "which is probably not intended".

So a survey set can be authored, exported to disk, and never played. Three ways out:

| | what it means | size |
|---|---|---|
| **(a) Finish it** | a JSON branch in `upload-questions.js`, a survey write branch, plus game-side playback (host, player, and the game lambdas all only play four types) | own project — well outside the constraint |
| **(b) Hide it** | derive the admin pickers from `PICKER_GAME_TYPES` too, so Survey disappears until it exists; keep the builder reachable as an export tool or drop it | XS, and it is the honest minimum |
| **(c) Label it** | keep it everywhere, mark it **Not playable** — mockup 01 row 13 draws this — and make the builder's button say "Export JSON", not "Load into System" | S |

**My recommendation is (b), with the button copy from (c) if the builder stays.** The current state — offering a creation path that reports success and produces nothing usable — is the worst of the three, and `gameTypes.js`'s comment already says the fix is a one-line deletion when the block lifts. **But this is a product decision, not a console one. It needs the owner.**

### O2. Does editing a prompt create a version?

`OPEN-QUESTIONS.md#7`. `update-ai-prompt.js` bumps the version only when the caller passes `createNewVersion` or the prompt is a default; `AIPromptManager` never passes it, so every edit to a non-default prompt overwrites `v{n}.json` in place — no history, no rollback. One flag, an S3 storage cost. **Not in this slice**, and it belongs with `OPEN-QUESTIONS.md#6` (the prompt-library merge), which is itself blocked on `POST /admin/ai-prompts/save` being routed to the *create* handler — so editing a generation prompt duplicates the record today. Q3 is the only prompt work in this slice, and it is a picker fix.

### O3. The six broken prompts

`OPEN-QUESTIONS.md#8`. Note one interaction with Q3: `fetchAvailablePrompts` (`AdminPage.jsx:208`) filters `status === 'active'`, and one of the six carries `status:'inactive'` — a fourth status value no filter in the UI matches. So that record is already invisible in this picker. `scripts/cull-ai-prompts.js` exists. Cull or carry is the owner's call; nothing in this slice depends on it.

---

## 7. What exceeds the constraint, and should be its own project

Stated plainly, because the owner asked for it:

| Item | Why it exceeds "not a major uplift" |
|---|---|
| **Mockup 07 in full** — the five-path ranked chooser | A new screen with five documented paths and per-path type selection. Q6(a) fixes the actual bug (one state, two controls) for a fraction of it. |
| **Mockup 06 in full** — auto-fix actions | "Treat `Prompt` as Title" and "Merge into `Options`" rewrite the file in the browser before sending. The *validation* (Q5) is cheap; the *repair* is a feature. |
| **The top-bar jobs tray** (G5.3) | A job registry outliving the screen, a new `AdminShell` slot, a tray. New subsystem. |
| **B1** — set-delete consequence | New backend contract plus an unindexed cross-partition scan. Worth doing; not a bug fix. |
| **B3** — report snapshot at ENDED | Changes when compute is spent and interacts with the 30-day report TTL. |
| **O1(a)** — finishing Survey | Importer branch + game-side playback across host, player and the game lambdas. |
| **The prompt-library merge** (`OPEN-QUESTIONS.md#6`) | Blocked on `POST /admin/ai-prompts/save` aliasing create. Its own decision, as the parent plan already says. |
| **The `/builder` route** | Cut deliberately by the designers. Unchanged. |
| **The archive** | `OPEN-QUESTIONS.md#4`. Public, unauthenticated, shared across all three tiers, including DELETE. No UI fixes it. |

**If the slice has to be smaller still**, cut in this order: G6, then Q5's preflight tiers (keep only the `summarizeCsv` swap), then G5.2. G1–G4 and Q1–Q4 are the floor; below that the console keeps giving wrong answers.

---

## 8. Verification

Per the parent plan, each part gets: unit tests naming what they reject, a **design-critic** pass against the mockups, and a **tester** pass driving the real console.

- **Reuse `docs/design/admin-redesign/audit.js`** — 6 assertions × 22 mockups × 2 viewports, every check demonstrated failing before it was trusted. The checks are pure functions over a rendered document plus a viewport, so they port into component tests unchanged. A4 (WCAG AA against the *composited* background) matters most here: the Question sets tab is still `contentTheme: 'light'` (`AdminPage.jsx:41-48`), and a converted panel dropped onto the dark field without its own palette pass is `#333` on `#0F1A2E` — 1.4:1. Convert theme and markup in the same commit, and add a `questionSetsPalette.test.js` beside the existing `adminTabsPalette.test.js` and `adminShellPalette.test.js`.
- **Every new component gets a test in `src/src/__tests__/`** following §1's recipe. Target: `generationJob.test.js`, `generationJobPanel.test.jsx`, `csv.test.js`, `csvPreflight.test.js`, `questionSetsPanel.test.jsx`, `questionSetDeleteDialog.test.jsx`, `questionSetUploadPanel.test.jsx`, plus a `questionSetsCallSite.test.js` source assertion for the wiring into `AdminPage.jsx`.
- **Do not "fix" `AdminPage.test.jsx`.** It asserts a UI that has not existed for months and cannot mount regardless. Either delete it or replace it wholesale with call-site source assertions — but that is a decision to take deliberately, not a side effect of this work.
- **Baselines to hold:** frontend 5 failed suites / 30 failed / 922 passed of 952; backend 32 of 32 scripts. Every number above is measured, not quoted.

---

## 9. Found in passing, not in this slice

- `delete-question-set.js:143` hardcodes `partial: true` in its 500 body even when `error.deleted` is `undefined`, so a plain failure reports itself as a partial delete.
- `src/src/PlayerPage.jsx:1354` fetches `admin/reports/{gameId}`, which has **no route** in `template-clean.yaml`. That request 404s every time.
- `lambda-functions/admin/ai-generate-pbd.js` exists with no route in the template.
- `ai-generate-scenarios.js` carries a byte-for-byte inline copy of `shared/generation-handler.js`'s flow, deliberately not migrated. Any change to job semantics — G1's contract, B2's cancel check — has to be made twice.
- The AI generation job's 3-day TTL is stamped only at creation and never refreshed, so a 15-minute job started 71 hours ago dies mid-flight from the client's point of view.
