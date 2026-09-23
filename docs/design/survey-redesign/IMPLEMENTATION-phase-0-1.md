# Surveys — Phase 0 + Phase 1 implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development
> (this plan runs as three parallel tracks after one shared step) or
> superpowers:executing-plans. Steps use `- [ ]` for tracking. Every step is
> test-first (superpowers:test-driven-development): write the test, watch it
> fail for the right reason, then write the code.

**Goal:** Survey question sets can be made, generated, imported, edited,
versioned and downloaded, with the five kinds (rating, choice, yes/no, rank,
open text). Plus the Phase 0 fixes. **Nothing plays a survey yet** — that is
Phase 2 — so `survey` stays in `UNPLAYABLE_GAME_TYPES` and the "Not playable"
chip stays truthful.

**Architecture:** One CSV contract carries every question set in this product
(the editor's Save, AI draft sets, the download and the importer all
round-trip through it; `tests/question-set-roundtrip.js` holds the browser's
`rowsToCsv` and the server's `download-question-set.js` byte-identical). A
survey is a new branch of that contract with fixed columns, exactly as trivia
has `OptionA..F` and poll has `Options,AllowMultiple`. The server's
vocabulary lives in `lambda-functions/admin/shared/survey-kinds.js`; the
browser's in `src/src/utils/questionRows.js` (data) and
`src/src/config/surveyKinds.js` (UI metadata).

**Tech stack:** Node 20 Lambdas (CommonJS), standalone `node tests/*.js`
suites judged by exit code; React (CRA) with Jest + Testing Library in
`src/`; DynamoDB single table; `tenant-crypto.js` envelope encryption.

**Spec:** `docs/design/survey-redesign/RATIONALE.md`, `PLAN.md` (Phases 0–1),
and the mockups 01–07 in the same folder. **The mockups are the design**
(build from them, not from prose).

## Global constraints

- Owner rulings (2026-09-23): question content is **encrypted for org sets**
  (options, labels, prompts, placeholder — surveys and polls alike); the
  free-text vote poll is retired (that is Phase 6 — do not touch poll play
  here); Names/sharing are Phase 2+/5 — not here.
- Survey is still **not playable**: keep `'survey'` in
  `UNPLAYABLE_GAME_TYPES` (`src/src/config/gameTypes.js`). Update its comment
  and `notPlayableReason()` text: surveys can now be authored and imported, no
  session plays one yet.
- The engage-design skill (`.claude/skills/engage-design/SKILL.md`) binds every
  UI change: tokens only, a scoped class prefix, 12/13/15/19/24/30 ladder, rows
  36px, inputs 15px, every dialog has an X and a bottom exit through one
  `requestClose()`, measured contrast with a `*Palette.test.js` for any new
  stylesheet (never name a test file `*Token*` — `.gitignore` hides it), no
  geometric assertions in jsdom tests.
- Never write either of the two deploy phrases `tests/no-retired-twin-references.js` bans, in any tracked file (it scans them all — this plan included).
- Backend suites: `for f in tests/*.js; do node "$f" >/dev/null 2>&1 || echo "FAIL $f"; done`
  — judge by exit code AND count the suites. Frontend: `cd src && npm test -- --watchAll=false`
  (never `npx jest`), `npm run lint`, `npm run build`.

## THE CONTRACT (both sides implement exactly this)

### Kinds
`rating` · `choice` · `yesno` · `rank` · `text`. Legacy spellings accepted on
import only: `multiple_choice`→`choice`, `text_entry`→`text`,
`yes_no`/`yes-no`/`yesno`→`yesno`, `ranking`→`rank`, `nps`→`rating` with
`scale:'0-10'`.

### Fields (row fields in the browser = DynamoDB attribute names)
| field | kinds | type | default when relevant & empty |
|---|---|---|---|
| `kind` | all | string | — (required) |
| `required` | all | boolean | `false` |
| `options` | choice, rank | string[] | `[]` |
| `allowMultiple` | choice | boolean | `false` |
| `maxPicks` | choice (only if allowMultiple) | integer or null | `null` |
| `allowOther` | choice | boolean | `false` |
| `shuffle` | choice | boolean | `false` |
| `scale` | rating | `'1-5'`/`'1-10'`/`'0-10'`/`'stars'` | `'1-5'` |
| `lowLabel`, `highLabel` | rating | string | `''` |
| `yesLabel`, `noLabel` | yesno | string | `''` (renders "Yes"/"No") |
| `unsure` | yesno | boolean | `false` |
| `followUpWhen` | yesno | `''`/`'yes'`/`'no'`/`'any'` | `''` (none) |
| `followUpPrompt` | yesno (only if followUpWhen) | string | `''` |
| `rankTop` | rank | integer or null | `null` (rank all) |
| `textLength` | text | `'short'`/`'long'` | `'long'` |
| `maxLength` | text | integer | `500` if long, `280` if short |
| `placeholder` | text | string | `''` |
| `themes` | text | boolean | `true` |

A field not relevant to the row's kind is **not stored** on the DynamoDB item
and reads back as its empty value (`''`, `false`, `null`, `[]`).

### Validation (importer skip reason = browser `rowProblems` wording)
- no/unknown kind → `needs a kind` / `unknown kind '<x>'`
- choice: fewer than 2 options → `needs at least two options`; more than 8 →
  `has more than eight options`; maxPicks set and not 2..options.length →
  `can't allow <n> picks from <m> options`
- rank: fewer than 3 → `needs at least three items`; more than 7 →
  `has more than seven items`; rankTop set and not 1..options.length-1 →
  `can't rank the top <n> of <m>`
- rating: scale not in the four → `unknown scale '<x>'`
- yesno: followUpWhen not in the four → `unknown follow-up '<x>'`;
  followUpWhen set and followUpPrompt blank → `needs the follow-up question`
- text: textLength not short/long → `unknown length '<x>'`; maxLength outside
  20..2000 → `answer limit must be 20–2000 characters`
- (all rows, as today) no Category → `needs a category`, no Title → `needs a title`

### Category
Surveys don't expose categories. Every survey row carries category
**`Survey`** (the importer's category bitmask still needs one). The editor
hides the Category field for survey sets and fills it; the generator and the
legacy-JSON import set it.

### CSV (survey branch) — header, in this order
```
Category,Question#,Title,Detail_lesson,School,CustomInstruction,Kind,Required,Options,AllowMultiple,MaxPicks,AllowOther,Shuffle,Scale,LowLabel,HighLabel,YesLabel,NoLabel,Unsure,FollowUpWhen,FollowUpPrompt,RankTop,TextLength,MaxLength,Placeholder,Themes
```
then the existing optional columns (`optionalHeader`, same rule and order as
every other type), then `,Tags`. Cells, every one double-quoted exactly like
the poll branch (`"…"`, `"` doubled): strings as stored (`''` when not
relevant); booleans `"true"`/`"false"` (`"false"` when not relevant);
integers as digits or `""` (`""` when null / not relevant); `Options`
pipe-joined. `Question#` unquoted, as today. Row order and numbering exactly
as today.

### Encryption
Add to the `question` entity in **all three** copies of `tenant-crypto.js`
(`lambda-functions/admin/shared/`, `game/`, `websocket/`):
`options`, `lowLabel`, `highLabel`, `yesLabel`, `noLabel`, `followUpPrompt`,
`placeholder`. `tests/tenant-crypto-wiring.js` keeps the copies equal. Legacy
plaintext poll `options` pass through `decryptValue` unchanged and encrypt on
their next save. Every reader of `options` must decrypt the question row
(verify: `get-question-set-questions.js`, `download-question-set.js`,
`get-ai-summary.js`, any game reader).

## Review focus
1. **A survey set round-trips unchanged**: load in the editor → Save with no
   edits → download → identical CSV; and download → re-upload → identical rows.
   (Owned by the integration step: `tests/question-set-roundtrip.js`.)
2. **A kind change never silently drops data**: choice↔rank keep options;
   every other change asks first (Track B1 test).
3. **An org survey's options are ciphertext at rest and plaintext in the
   editor, the download and the review table** (Track A test).
4. **Legacy survey JSON (the builder's old export) imports** and its
   `multiple_choice`/`text_entry`/`1-10` values map correctly (Track A test).
5. **Poll sets are unaffected** except that their options are now encrypted
   for org sets — a poll round-trip test stays green (Track A + integration).

---

## Step 0 (main session, before the tracks): the browser's kinds table

**Files:** Create `src/src/config/surveyKinds.js`, test
`src/src/__tests__/surveyKinds.test.js`. Modify `src/src/components/Icon.jsx`
(add `Star`, `ListBullets`, `ToggleLeft`, `ListNumbers`, `TextAlignLeft` from
`@phosphor-icons/react`; `designSystem.test.jsx` asserts every name resolves).

**Produces** (ESM):
- `SURVEY_KINDS` — ordered array of `{ id, label, icon, blurb }`:
  rating/"Rating"/`Star`/"A scale: 1–5, 1–10, 0–10 (a recommend score) or stars.";
  choice/"Multiple choice"/`ListBullets`/"Pick one or several, with an optional write-in.";
  yesno/"Yes / No"/`ToggleLeft`/"Two buttons, an optional Not sure, and an optional “why?”";
  rank/"Ranking"/`ListNumbers`/"Put 3–7 items in order; the top few can be enough.";
  text/"Open answer"/`TextAlignLeft`/"Words. Workie groups them into themes when the survey closes."
- `SURVEY_CATEGORY = 'Survey'`
- `surveyKindMeta(id)` → entry (unknown → the `text` entry)
- `kindLabel(row)` → "Rating 0–10" when `kind==='rating' && scale==='0-10'`, else the label
- `previewLine(row)` → the editor's one-line answer preview, per the mockup 04
  (`1–5 · Not useful → Very useful`; `0–10 · recommend score`;
  `4 options · pick one` / `pick up to 2` / `+ write-in`;
  `Yes / No / Not sure · asks why on No`; `5 items · top 3 is enough` / `rank all`;
  `Long answer · up to 500 characters`)
- `convertKind(row, toKind)` → `{ row, loses: string[] }`: returns the row with
  `kind` changed and the irrelevant fields reset; `loses` lists what would be
  discarded in words (empty array = safe to switch without asking). choice↔rank
  keep `options` (loses nothing unless rank would exceed 7 → loses the extras,
  named); anything → anything else loses its kind's filled fields.
- `defaultsFor(kind)` → the table's defaults for that kind (used by new rows).
- `estimateMinutes(rows)` → ~20s per non-text question, 60s per text, rounded
  up to whole minutes (the generator's "about N minutes").

- [ ] Write `surveyKinds.test.js` covering every export (labels, previews for
  each kind incl. the 0–10 and write-in variants, conversions choice→rank
  keeps options, rank→choice keeps options, rating→text loses the scale labels,
  estimate for [rating, choice, text] = 2 min).
- [ ] Run it red; implement; run it green; add the icons; run
  `designSystem.test.jsx`.
- [ ] Commit.

---

## Track A — backend (one implementer)

### A1. `lambda-functions/admin/shared/survey-kinds.js` (new)
**Produces:** `KINDS`, `SURVEY_CATEGORY`, `SURVEY_CSV_COLUMNS` (the 20 survey
columns from Kind to Themes, in order), `normalizeKind(raw)` (legacy map; returns
`{ kind, scale? }` or `{ error }`), `surveyFieldsFromCells(get)` (given a
`get(columnName)` → trimmed string, returns the full normalised field object
per the table, applying defaults), `validateSurvey(fields)` → string[] (the
exact wording above), `itemFields(fields)` → only the relevant attributes for
the DynamoDB item (plus `kind`, `required`), `surveyCsvCells(q)` → the 20
quoted cells for the exporter (reads lower-case attributes, tolerant of
capitalised), `itemsToSurveyCsv(items, { category })` → a complete survey CSV
(for the generator's `setCreation.toCsv` and the legacy JSON import),
`legacySurveyJsonToCsv(jsonText)` → CSV (or throws with a readable message).
**Test:** `tests/survey-kinds.js` — every validation message, every default,
every legacy mapping (`1-10`, `multiple_choice`, `text_entry` with
`textType:'email'` → short), relevant-only item fields, cells quoting.

### A2. `upload-questions.js` accepts surveys
- Remove the survey rejection (`:286-300`) **for survey only**: JSON is
  accepted when `engagementType === 'survey'` and converted with
  `legacySurveyJsonToCsv` before parsing; JSON for any other type is still
  rejected with a message that no longer says "survey".
- Survey column indices; per row build the fields with `surveyFieldsFromCells`,
  run `validateSurvey`; problems → `skippedRows.push({ row, reason })` (joined
  with `; `) and the row is not imported.
- Write `itemFields(fields)` onto `questionItem` in the type branch (`~:1076`).
- Survey rows missing Category get `Survey`.
**Test:** `tests/survey-upload.js` — a CSV with one row of every kind imports
with the right attributes (and nothing irrelevant stored); an invalid row is
skipped with its reason and the rest import; a legacy JSON export imports; a
`.json` upload for trivia is still refused; an org set's `options` /
`lowLabel` / `followUpPrompt` are envelopes at rest (use the existing
tenant-crypto test harness pattern from `tests/tenant-crypto-wiring.js`).

### A3. Download + templates
- `download-question-set.js`: survey → CSV (drop the JSON-for-survey choice at
  `:93`; `format=json` still works if asked), new survey branch emitting the
  contract header + `surveyCsvCells(q)` between `CustomInstruction` and the
  optional columns. Decrypt as it already does.
- `download-template.js`: `type=survey` returns `survey-template.csv` — one row
  of every kind (category `Survey`), plus `type=survey&template=<id>` for five
  named CSVs: `presentation-feedback`, `event-feedback`, `workshop-retro`,
  `training-evaluation`, `team-pulse` (6–8 sensible questions each, mixing
  kinds; the presentation one uses the mockups' eight questions from
  `docs/design/survey-redesign/_src/content.py`).
**Test:** extend `tests/survey-upload.js` (or a new `tests/survey-download.js`):
downloading an imported survey set yields the contract header and cells; every
template imports with zero skipped rows.

### A4. Encryption (all three copies)
Add the seven fields to `question` in the three `tenant-crypto.js` copies.
Verify every reader of `options` decrypts (list them in the commit message).
**Test:** extend `tests/tenant-crypto.js` / `tests/tenant-crypto-wiring.js`
(copies equal; the new fields round-trip; a legacy plaintext `options` array
passes through).

### A5. The generator writes a draft survey set
- `ai-generate-survey.js`: request takes `source` (text, ≤ the existing
  customPrompt cap), `goal`, `kinds` (subset of the five; empty → all five;
  legacy `include*` flags still honoured), `questionCount` (1–20), `title`,
  `description`, `customPrompt`. Tool schema emits the contract fields per item
  (`kind`, `title` ≤200, `detail`, `required`, and the kind fields); the prompt
  uses only the chosen kinds and mixes them, reads `source` as the material and
  `goal` as the purpose. `normalizeItem` returns contract-shaped items (plus
  `tags`); `titleOf: item => item?.title`.
- Add `setCreation: { engagementType: 'survey', toCsv: (items) => itemsToSurveyCsv(items) }`
  and remove survey from the "deliberately absent" list in
  `shared/generated-set.js` (update its comment).
**Test:** extend `tests/survey-generation-job.js` (kinds reach the prompt and
the schema enum; count capped at 20; items normalised; setCreation produces a
CSV the importer accepts with zero skipped rows) and
`tests/generated-set-creation.js` (survey opts in).

### A6. Phase 0 (backend)
- `get-ai-summary.js ~:2107-2115`: poll options come from the (decrypted)
  question's `options` array, falling back to `optionA..E` only when `options`
  is absent. Minimal change — another session is editing this file around
  `:755` (decrypting METADATA); keep your diff local to the poll block.
**Test:** a unit test (new `tests/ai-summary-poll-options.js`) that builds a
poll question with `options:['A thing','B thing']` and asserts they reach the
prompt / `pollOptions`.

---

## Track B — browser, the editor (one implementer)

### B1. `utils/questionRows.js`
- `toRow` picks every contract field (lower-case, tolerant of capitalised).
- `blankRow({ kind })` for a survey: `{ category: 'Survey', kind, ...defaultsFor(kind) }`
  — take the defaults from the contract table (questionRows.js is CommonJS and
  cannot import the ESM `surveyKinds.js`; duplicate the defaults and add a
  test that the two agree).
- `rowProblems(row, 'survey')` → the contract's validation wording.
- `rowsToCsv(rows, 'survey')` → the contract CSV, byte-for-byte what A3's
  exporter writes for the same stored rows.
**Test:** extend the existing questionRows tests (find them with
`grep -rl rowsToCsv src/src/__tests__ tests`) — every kind serialises to the
contract cells; problems wording; blankRow defaults agree with `defaultsFor`.

### B2. `QuestionsPanel.jsx` for a survey set (mockups 04, 05, 06)
- Table: a **Kind** column (icon + word chip, `kindLabel`), the question with
  the `previewLine` under it, and **Required**. No Category column for
  surveys. Up/down reorder as today.
- **Add question** becomes a menu of the five kinds (icon, label, blurb —
  `SURVEY_KINDS`), keyboard-operable (↑/↓/Enter/Escape), plus "From another
  set" if the panel already offers pulling questions.
- `QuestionForm` for surveys: a kind switcher (five buttons, icon + word;
  switching calls `convertKind`; if `loses` is non-empty ask first with the
  panel's existing confirm pattern, naming what is lost); Title; Detail
  (optional); **Needs an answer**; then the kind's fields exactly as mockups
  05/06: rating (scale: 1–5 / 1–10 / 0–10 recommend score / Stars; label under
  low end, label under high end); choice (options list 2–8 with add/remove,
  One/Several + up to N, "Something else" with a box, shuffle); yes/no (Yes
  reads / No reads, offer Not sure, ask why: when they say No/Yes/Either + the
  question); ranking (items 3–7, All of them / Just the top N); open answer
  (Short/Long, up to N characters, placeholder, let Workie group into themes).
  Category is not shown (filled with `Survey`).
- **No live phone preview in Phase 1**: the player's survey inputs are Phase 2.
  Leave a clearly named slot (e.g. a comment and a prop) where the preview
  iframe will go.
- New stylesheet `src/src/components/SurveyQuestionFields.css` scoped `.sqf`
  (mockup classes `sv-kind`, `sv-kindbar`, `sv-optlist`, `sv-three`… re-cut
  under `.sqf-*`), declaring `data-theme="dark"` expectations like
  `QuestionSetEditor.css`, with `src/src/__tests__/surveyQuestionFieldsPalette.test.js`.
**Test:** `src/src/__tests__/questionFormKinds.test.jsx` — each kind shows its
fields; switching choice→rank keeps options without asking; switching
rating→text asks; the Add menu adds a row of the chosen kind with its
defaults; a survey row shows its preview line; Save produces the contract CSV
(assert on the `upload-questions` request body).

---

## Track C — browser, making a survey (one implementer)

### C1. `SurveyAIBuilder.jsx` becomes mockup 02 + 03
- Form: "What was the session? Paste the outline, or attach the deck" (textarea
  + the existing `FileUploadPrompt`, whose extracted text fills this field —
  not `customPrompt`), "What do you want to find out?" (one line), **Kinds of
  question** (five multi-select toggles, icon + word + tick, at least one; all
  on except Ranking by default), **How many** (Quick 5 / Standard 8 /
  Thorough 12, a number field capped at 20, and "about N minutes to answer"
  via `estimateMinutes`), "Anything else Workie must obey" in a `<details>`.
  This replaces the three checkboxes whose keys never matched (Phase 0 fix 1,
  `:589-591`) — say so in the commit.
- The job now creates a **draft survey set** (A5); the builder hands over like
  the trivia/poll builders do after a draft set is created (find the pattern in
  `TriviaAIBuilder.jsx` / `generatedSetHandoff.test.jsx`). JSON export buttons
  go; keep a small "Download as CSV" if the other builders have an equivalent.
- Review (mockup 03): `GeneratedItemsTable` gets a **Kind** column (chip) with
  a select to change a row's kind (`convertKind`, asking when `loses` is
  non-empty), and the preview line under each question.
- `AdminPage.jsx` `handleSurveyGenerated` and `HostQuestionSetsDialog.jsx`
  `onSurveyGenerated` (`:926`, today closes and downloads nothing — Phase 0
  fix 2) route to the same "set created" handling the other builders use.
**Test:** new `src/src/__tests__/surveyAIBuilder.test.jsx` (toggles reach the
request as `kinds`; count capped at 20; minutes estimate; the file's text lands
in `source`); update `builderJobCallSite.test.js` / `builderStacking.test.js`
/ `generatedSetHandoff.test.jsx` as needed; `generatedItemsTable.test.jsx` for
the Kind column.

### C2. New set dialog + import (mockup 01)
- `QuestionSetUploadPanel.jsx` for `survey`: the four routes — **Your own
  material** (opens the survey builder), **A template** (the five named CSV
  templates as downloads + the every-kind template, via A3's
  `download-template?type=survey&template=…`), **A blank survey** (creates the
  set and opens the editor if the panel supports blank sets; otherwise say so
  in the report), **A file** (CSV with a Kind column, or the survey JSON).
  Replace the copy that says surveys can't be imported. Keep the "Not
  playable" note, reworded: can be authored, not yet run in a session.
- `utils/csvPreflight.js`: replace the `survey-unsupported` block with the
  contract's checks (header has `Kind`; per-row problems in the contract
  wording, so what the preflight says is what the importer would skip). Accept
  `.json` only for survey.
**Test:** `questionSetUploadPanel.test.jsx`, `newSetDialog.test.jsx`,
`csvPreflight.test.js` — survey routes render; a good survey CSV preflights
clean; a bad row reports the contract's wording; trivia `.json` still refused.

---

## Integration (main session)
- [ ] Merge A, B, C into `working/survey-phase-0-1`; resolve conflicts.
- [ ] Extend `tests/question-set-roundtrip.js`: a survey set with every kind
  imports, downloads, and the browser's `rowsToCsv` over the editor rows equals
  the download byte-for-byte; a poll set still round-trips with its options
  encrypted for an org.
- [ ] Phase 0 comments: `gameTypes.js` UNPLAYABLE comment + `notPlayableReason`
  reworded; `csvPreflight.js` stale line reference.
- [ ] Full backend loop (count suites), frontend `npm test`, `npm run lint`,
  `npm run build`; baselines hold.
- [ ] Whole-branch review (superpowers:requesting-code-review).
- [ ] Merge `origin/dev` in, re-run, push the branch to `dev` (a dev deploy),
  name the commit.
