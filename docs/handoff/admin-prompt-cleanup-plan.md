# Engage2 Admin Prompt + Question-Set Cleanup Plan (PARKED)

Investigation complete. Both the frontend UI and the two backend subagent traces are in. Here is the full structured report.

---

# Engage2 Admin Prompt + Question-Set Subsystem — Analysis & Cleanup Plan

Everything below is read-only analysis. No files were changed. All paths absolute under `/Users/georgeseib/Documents/projects/engage2/`.

---

## (A) The two prompt generators — map & why they're confusing

Both live on the **"🤖 AI Prompts" tab** of `src/src/AdminPage.jsx` (tab defined `AdminPage.jsx:980`, content block `AdminPage.jsx:1020-1091`). Two side-by-side cards render there:

| | **Generator #1 "Question Set Generator AI Prompts"** | **Generator #2 "Engagement Results AI Analysis (Workie)"** |
|---|---|---|
| Card / button | `AdminPage.jsx:1029-1050`, button `:1041-1046` "Manage Generation Prompts" | `AdminPage.jsx:1052-1076`, button `:1067-1072` "Manage Analysis Prompts" |
| Opens | **Modal overlay** `AIGenerationPromptEditor` (`AdminPage.jsx:1829-1832`; component `components/AIGenerationPromptEditor.jsx`) | **Inline expanding section** `AIPromptManager` (`AdminPage.jsx:1079-1088`; component `components/AIPromptManager.jsx`, 1349 lines) |
| State toggle | `showGenerationPromptEditor` (`AdminPage.jsx:103`) | `showAnalysisPrompts` (`AdminPage.jsx:105`) |
| Purpose | Templates that generate **questions** (`promptType:'generation'`) | Templates that tell **Workie** how to **summarize/analyze** player responses |

**Why it's confusing — the "second prompt generator below":** Generator #1 opens a clean **modal**. Generator #2's button instead **expands the giant `AIPromptManager` inline underneath both cards** (`AdminPage.jsx:1080-1086`). So after clicking "Manage Analysis Prompts" a large second editor unfolds below the two cards — it looks like an unrelated third panel rather than the detail view of card #2. The two editors are also structurally different tools:

- `AIGenerationPromptEditor` — simple modal: list + filter + one create/edit form. Fetches `admin/ai-prompts?promptType=generation` (`AIGenerationPromptEditor.jsx:98`), saves via `admin/ai-prompts/save` (`:137`). **No delete, no AI-assist, no advisor.**
- `AIPromptManager` — a full sub-app: an editor with a 49-variable template palette (`AIPromptManager.jsx:32-…`), a "magic wand" that calls `admin/ai-generate-prompt` (`:497`), a `PromptAdvisor` that calls `admin/ai-prompt-advisor` (`:827`), plus list/create (`POST admin/ai-prompts`, `:445`), update (`PUT admin/ai-prompts/{promptId}`, `:446`), delete (`:1102`), and `populate-defaults` (`:1140`).

**Backend wiring (from `template-clean.yaml`):**
- `/admin/ai-prompts` GET → `get-ai-prompts.js` (`:1351`)
- `/admin/ai-prompts` POST **and** `/admin/ai-prompts/save` POST → **both** `create-ai-prompt.js` (`:1380`, `:1388`) — so Generator #1's "save" and Generator #2's "create" hit the same lambda by two different routes
- `/admin/ai-prompts/{promptId}` PUT → `update-ai-prompt.js` (`:1417`); DELETE → `delete-ai-prompt.js` (`:1446`)
- `/admin/ai-generate-prompt` POST → `ai-generate-prompt.js` (`:1530`); `/admin/ai-prompt-advisor` → `ai-prompt-advisor.js`
- Storage is dual: DynamoDB metadata + an S3 `${StackName}-ai-prompts` bucket (`template-clean.yaml:1704`, `2294`).

**Concrete inconsistencies that make them behave differently:**
1. **Different game-type vocabularies** for the same four types:
   - Generator #1: `call-and-answer, trivia, poll, wavelength` (`AIGenerationPromptEditor.jsx:263-267`)
   - Generator #2: `callandanswer, trivia, polls, wavelength` (`AIPromptManager.jsx:12`, `1202-1204`)
   - `create-ai-prompt.js:82` accepts an alias grab-bag `['callandanswer','call-and-answer','trivia','polls','poll','wavelength']` to paper over this.
2. **Different save endpoints** (`/save` POST vs `/{promptId}` PUT) for essentially the same action.
3. **`promptType` only set by Generator #1** (`AIGenerationPromptEditor.jsx:15,23,95,153`); Generator #2's `formData` has no `promptType` (`AIPromptManager.jsx:9-22`) — so the two prompt families are distinguished only by whichever default the backend assigns.
4. **Key-schema split in the backend** (bug, see C): create/get/update use `PK:'AIPROMPTS', SK:'AIPROMPT#'+id`, but `delete-ai-prompt.js` and `ai-prompt-advisor.js` read/write `PK:'AI_PROMPT#'+id, SK:'METADATA'` — a *different* item. Delete and the advisor's "load existing prompt" cannot find prompts that were created normally.

---

## (B) Per-game-type prompt-generation correctness + variable gaps

**Actual game-type set.** There is **no single canonical enum**. The persisted four are **call-and-answer, trivia, polls, wavelength** (`create-ai-prompt.js:82`; `default-ai-prompts.json`; `ai-generate-prompt.js:6-30`). **Survey** and **PBD** (Personal Board of Directors) exist only as standalone generators, not members of any game-type list. The question-set upload UI is the only place that lists **survey** (`AdminPage.jsx:1421`).

**Generation path per type (prompt template → generate fn → output shape):**

| Game type | Frontend builder | Generate lambda (routed?) | Output object shape |
|---|---|---|---|
| call-and-answer / scenarios | `AIScenarioBuilder.jsx:509` | `ai-generate-scenarios.js` ✅ | `{title, category, detail, customInstructions}` (+`school`) `ai-generate-scenarios.js:33`, `populate-generation-prompts.js:30` |
| wavelength | `AIScenarioBuilder.jsx` (WAVELENGTH_SPEC `:11`, case `:152`) → `ai-generate-scenarios.js:442` | `ai-generate-scenarios.js` ✅ | `{title:"Subject 1-4 words", detail, category, customInstructions:"up to 10 words"}` `:25` |
| trivia | `TriviaAIBuilder.jsx:79` | `ai-generate-trivia.js` ✅ | `{title, questionDetail, category, answerDetails, school, optionA-D(+E/F), correctAnswer, difficulty}` `ai-generate-trivia.js:89-101,156-171` |
| poll | `PollAIBuilder.jsx:78` | `ai-generate-polls.js` ✅ | `{title, category, detail, school, customInstructions, options[], allowMultiple}` `ai-generate-polls.js:89` |
| survey | `SurveyAIBuilder.jsx:41` | `ai-generate-survey.js` ✅ | single object `{title, description, questions:[{id, question, type, scale, options, textType, …}]}` `ai-generate-survey.js:66-70` |
| pbd | *(no builder wired)* | `ai-generate-pbd.js` ❌ **NOT routed** | `{title, description, sections[…roles…], actionPlanTemplate}` `ai-generate-pbd.js:125-167` |
| (legacy) generic | `AIAssistant.jsx:68` | `ai-generate-questions.js` ✅ | overlaps trivia/poll/wavelength — duplicate path |

Generated questions are **not written to Dynamo by the generate lambdas**; the builder posts them to `admin/upload-questions` (`AdminPage.jsx:588,658,728` etc.), which is the only writer of `SET#` rows. The output shapes above match what `upload-questions.js` expects.

**Correctness issues found:**
- **`ai-generate-pbd.js` is dead** — no API route (`template-clean.yaml` has 0 references) and no frontend builder. PBD generation cannot be invoked.
- **`ai-generate-questions.js` is a legacy duplicate** of the trivia/poll/wavelength generators (only reachable via `AIAssistant.jsx`), overlapping the dedicated per-type lambdas — a maintenance hazard (two shapes can drift).
- **Category control is inconsistent:** only the scenarios generator honors `{numberOfCategories}`/`{mustHaveCategories}` (`ai-generate-scenarios.js:97,163-172`); trivia and polls generators ignore them.
- **Result-summary variable list drift:** `ai-generate-prompt.js:6-30` hand-maintains a `TEMPLATE_VARIABLES` map that no longer matches the ~70 vars actually built in `game/get-ai-summary.js:1569-1690` (e.g. it advertises wavelength `wordFrequency/uniqueWords/conceptualThemes`, but the summary engine emits `commonWords/wavelengthWords/connectionScore`). The palette shown to admins can promise variables that never resolve.

**Variables exposed to the admin (and gaps):**

*Generation prompts (Generator #1 form, `AIGenerationPromptEditor.jsx:357-540`):* `gameType, name, description, basePrompt, contextTemplate ({context}), audienceTemplate ({audience}), categoryTemplate ({numberOfCategories},{mustHaveCategories}), outputFormat, status, isDefault, sampleCategories, contextPlaceholder, audiencePlaceholder, tags`.
- **Missing from the form despite being used elsewhere:** no **difficulty** field, no **count/numberOfQuestions**, no **numChoices/numCorrect** (trivia), no **allowMultiple** (polls), no **tone/audience-level**, and **no `scenarioType` selector** — even though the list **filters by `scenarioType`** (`:122,277`) and cards display it (`:320`). You can filter by a field you can never set.
- The actual generate lambdas *do* accept far more (`topic, difficulty, count, numChoices, numCorrect, allowMultiple, audience, context` — `ai-generate-trivia.js:28`, `ai-generate-polls.js:28`, `ai-generate-scenarios.js:58`, `ai-generate-survey.js:28-31`), but those are collected in the per-builder wizards, not in the prompt-template editor. So the "prompt template" and the "runtime knobs" are split across two UIs with no shared variable contract.
- **Naming inconsistency across generators:** topic is `topic` (trivia/polls/survey) vs `prompt`/`context` (scenarios); difficulty is labeled "Difficulty" (trivia) / "Complexity" (`ai-generate-polls.js:71`) / "Level of Detail" (`ai-generate-scenarios.js:159`).

*Workie / result-summary prompts (Generator #2, `AIPromptManager.jsx:32-…`):* a rich 49-entry `templateVariables` palette across categories Set Info / Game Info / Player Info / Question Info / Answers / Votes / Scores / Results / Wavelength. The runtime substitution map lives in `game/get-ai-summary.js:1569-1690` (~70 vars, substituted `:1746-1749`). The "Workie" persona default template is `default-ai-prompts.json` `trivia.workie-trivia:78` exposing `{question},{playerResponses},{gameContext},{correctCount},{totalPlayers},{performanceComment},{correctAnswer},…`. **Gap:** the editor's 49-var palette ≠ the engine's ~70 vars (drift), and only trivia has a real "Workie" persona template; call-and-answer/wavelength/polls defaults expose only `{question},{playerResponses},{gameContext}` (`default-ai-prompts.json:6,130,176`).

**On-screen instructions:** the two cards have decent one-line descriptions (`AdminPage.jsx:1037-1040,1063-1066`), but inside the editors guidance is thin: template fields rely on placeholder hints only (`AIGenerationPromptEditor.jsx:407,417,427`); there is no explanation of which `{placeholders}` are valid per game type, no indication that `scenarioType`/difficulty/count are set elsewhere, and no note that survey/pbd aren't supported here.

---

## (C) Question-set CRUD map + DynamoDB hygiene bugs

**Key schema (single table):**
- Set metadata: `PK:'SETS', SK:'SET#'+setId` — `upload-questions.js:289-291`. `setId` = slug of name: `setName.toLowerCase().replace(/[^a-z0-9]/g,'')` (`:109`).
- Questions: `PK:'SET#'+setId, SK:'QUESTION#'+categoryId+'#'+nnn` (`upload-questions.js:353,359-360`).
- Categories: `PK:'SET#'+setId, SK:'CATEGORY#'+categoryId` (`:314-315`).
- **Metadata lives in a different partition (`SETS`) than its questions (`SET#<id>`)** — the root cause of the orphan risks below.

**CRUD trace:**
- **AUTO-GENERATE** → generate lambda returns payload (no writes), builder posts to `upload-questions.js` with `isAIGenerated:true` → metadata `active:false` (`:299`), questions `Active:false` (`:369`). Frontend: `AdminPage.jsx:575-760`.
- **UPLOAD** → `upload-questions.js`: existence check on metadata only (`:273-284`, returns 400 if `SETS/SET#id` exists), then metadata Put (`:287-306`), category Puts (`:309-323`), question Puts (`:334-400`). Frontend `handleUploadQuestionSet` `AdminPage.jsx:497-563` — sends no setId, always "create."
- **EDIT** → `edit-question-set.js:31-65`: single `UpdateCommand` on metadata; **never reads/writes questions**; does not recompute counts. Frontend `AdminPage.jsx:177-197` (metadata fields only).
- **REPLACE** → **no endpoint exists.** UPLOAD hard-blocks an existing id, so "replace" = manual DELETE + re-UPLOAD.
- **DELETE** → `delete-question-set.js`: get metadata (`:21-24`), query `SET#` partition (`:37-41`), delete metadata (`:44-47`), batch-delete queried items (`:55-70`). Frontend `confirmDeleteQuestionSet` `AdminPage.jsx:876`.
- **TOGGLE active** → `toggle-question-set.js:31-39` (metadata only); **TOGGLE quickstart** → `toggle-quickstart.js:23-29`.
- **DOWNLOAD** → `download-question-set.js` exists and exports JSON/CSV per engagement type (`:61-98,104-136`) but is **NOT routed** in `template-clean.yaml` (0 refs) and **not called by the frontend** (no `download-question-set` reference in `AdminPage.jsx`) → dead feature. Only `download-template.js` (blank templates) is wired (`AdminPage.jsx:396-419`).

**Hygiene bugs (orphan/clutter risks):**
- **Bug A — non-atomic delete:** `delete-question-set.js:44-47` deletes metadata *before* the question batch (`:55-70`); a mid-loop throw leaves orphaned `SET#` rows with no owning metadata, invisible to `get-question-sets.js` (which only scans the `SETS` partition).
- **Bug B — `UnprocessedItems` ignored:** `delete-question-set.js:63-67` (and `delete-game.js:79`) discard the `BatchWrite` response; throttled deletes are silently dropped while `itemsDeleted` is incremented unconditionally (`:69`).
- **Bug C — no Query pagination:** `delete-question-set.js:37-41` (also `download-question-set.js:41-48`, `get-question-set-questions.js:57`) issue a single Query with no `LastEvaluatedKey` loop → for sets >1 MB, only the first page is deleted/exported; the rest is orphaned/truncated.
- **Bug D — orphans merge into a rebuilt set (compounding):** UPLOAD's existence guard checks only metadata (`:273-276`). After a partial delete, metadata is gone but questions remain, so re-UPLOAD of the same name passes the guard; new question keys don't overwrite the differently-numbered stale rows, so `get-question-set-questions.js` returns new + ghost questions.
- **Bug E — EDIT leaves stale counts + attribute-casing split:** `edit-question-set.js` never recomputes `questionCount`/`categoryCount`, and writes `UpdatedAt` (`:34`) while UPLOAD/toggle write `updatedAt` (`upload-questions.js:301`, `toggle-question-set.js:34`) — timestamps land in two different attributes.
- **Bug F — slug collisions / rename drift:** `upload-questions.js:109` slugging means "Test 1" and "test1" collide; EDIT rename never changes `setId`, so key and displayed name drift apart.
- **Bug G — prompt-attach filter slug mismatch:** the set-upload prompt dropdown filters prompts by `engagementType==='call-and-answer' ? 'callandanswer' : engagementType` (`AdminPage.jsx:1487`). Generation prompts saved by Generator #1 carry gameType `call-and-answer`/`poll`, which won't match `callandanswer`/`poll`... survey never matches anything. So custom generation prompts are often invisible in the attach list.

**Net:** there is **no transactional "clear old SET# rows then write new" path anywhere.** DELETE is the only cleaner and it is non-atomic, non-paginated, and drops unprocessed items; UPLOAD refuses overwrite and guards only on the separately-partitioned metadata row.

---

## (D) Prioritized cleanup plan (analysis only — not implemented)

### P0 — Data-integrity / correctness (do first)
1. **Fix AI-prompt key-schema split.** Make `delete-ai-prompt.js` and `ai-prompt-advisor.js` read/write the same key as create/get/update (`PK:'AIPROMPTS', SK:'AIPROMPT#'+id`), not `PK:'AI_PROMPT#'+id, SK:'METADATA'`. *Touches:* `lambda-functions/admin/delete-ai-prompt.js:68-71,150-153,178-181`, `ai-prompt-advisor.js:150-153`. (Also purge/migrate any stray `AI_PROMPT#` rows.)
2. **Make question-set DELETE clean & complete:** paginate the Query (`LastEvaluatedKey` loop), retry `UnprocessedItems`, delete questions **before** metadata (or ideally in one `TransactWrite`/ordered flow), and only increment counters for confirmed deletes. *Touches:* `delete-question-set.js:37-70`.
3. **Add delete-before-write to UPLOAD/REPLACE.** Introduce an explicit REPLACE path (or make UPLOAD, when `overwrite=true`, run the paginated cleanup of the `SET#<id>` partition before writing). Change the existence guard to also detect orphaned `SET#` rows, not just metadata. *Touches:* `upload-questions.js:109,273-306,334-400`; new route in `template-clean.yaml`; `AdminPage.jsx` upload flow.
4. **Standardize one game-type vocabulary** (recommend the dashed set `call-and-answer, trivia, poll, wavelength, survey`) and remove the alias fan-out. Fix the prompt-attach filter slug mismatch. *Touches:* `AIGenerationPromptEditor.jsx:263-267,364-368`, `AIPromptManager.jsx:12,1202-1204`, `create-ai-prompt.js:82`, `AdminPage.jsx:1487`.

### P1 — Prompt UI unification & variable exposure
5. **Unify presentation of the two generators.** Make Generator #2 (Workie) open in a modal like Generator #1 (or make both inline), so there's no surprise "editor below." Label them unambiguously ("Question generation prompts" vs "Result-summary (Workie) prompts"). *Touches:* `AdminPage.jsx:1052-1088,1829-1832`.
6. **Expose the missing per-game-type variables in Generator #1**: add `scenarioType` selector (it's already filtered but unsettable), plus `difficulty`, `count`, `numChoices`/`numCorrect` (trivia), `allowMultiple` (polls), `tone`, `audienceLevel` — and drive them into the generate lambdas. Add survey to the editor or clearly scope it out. *Touches:* `AIGenerationPromptEditor.jsx:22-43,357-540`; generate lambdas already accept most (`ai-generate-trivia.js:28`, `ai-generate-polls.js:28`, `ai-generate-scenarios.js:58`, `ai-generate-survey.js:28`).
7. **Single source of truth for template variables.** Derive the Workie variable palette from the same list the summary engine builds, to kill drift. *Touches:* `AIPromptManager.jsx:32-…` + `ai-generate-prompt.js:6-30` should import/share the map defined in `game/get-ai-summary.js:1569-1690`.
8. **Add on-screen guidance:** per-field help listing valid `{placeholders}` per game type and a note on which knobs are set in the builder wizard vs the template. *Touches:* both editor components.

### P2 — Dead code & consistency cleanup
9. **Remove or wire up dead lambdas:** `ai-generate-pbd.js` (unrouted, no builder), `download-question-set.js` (unrouted; either route it and add a "Download Set" button, or delete), plus debug/legacy handlers with 0 routes (`debug-prompt.js`, `list-ai-prompts-debug.js`, `migrate-ai-prompts.js`, `populate-default-prompts.js`, `populate-generation-prompts.js`). *Touches:* those files + `template-clean.yaml`.
10. **Retire the legacy generic generator** `ai-generate-questions.js` + `AIAssistant.jsx` in favor of the dedicated per-type lambdas, or clearly mark it. *Touches:* `AIAssistant.jsx`, `ai-generate-questions.js`, `template-clean.yaml:858`.
11. **Fix EDIT hygiene:** recompute `questionCount`/`categoryCount` on edit and standardize on one `updatedAt` attribute casing across `upload-questions.js:301`, `edit-question-set.js:34`, `toggle-question-set.js:34`.
12. **Normalize `setId`/slug handling** to prevent collisions and rename drift (e.g. keep an immutable id separate from the display name). *Touches:* `upload-questions.js:109`, `edit-question-set.js`.

**Suggested sequence:** P0.1–P0.3 (stop the DynamoDB bleeding) → P0.4 (vocabulary) → P1.5–P1.8 (UI unify + variables, the owner's main ask) → P2 (dead code). Items P0.2/P0.3 and P2.9 are the ones that directly stop table clutter/orphans.