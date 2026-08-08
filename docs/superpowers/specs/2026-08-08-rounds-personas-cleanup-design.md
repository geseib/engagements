# Round Labels, Persona Controls & Prompt/Set Cleanup — Design

**Date:** 2026-08-08
**Status:** Draft — awaiting owner approval
**Branch:** `dev`

## Problem

Six complaints from the owner. Mapping them surfaced the causes, which are mostly not where the
symptoms are.

1. **Workie has no controls.** The persona resolver shipped (`personas.js`, spec
   `2026-08-07-workie-personas-design.md`) but nothing writes `PersonaId` and nothing reads the
   persona library. No picker at creation, in game, or on a set.
2. **Adding an Art prompt in admin changed nothing.**
3. **Every call-and-answer round is "Lesson N."** Art should read "Artwork N"; "Lesson" is a poor
   general default.
4. **The art instruction is weak.**
5. **The question-set edit did not stick**, and the prompt dropdown ignores game type.
6. **Prompts and question sets need culling.**

---

## Root causes

### R1 — Why "I added an Art prompt and nothing changed"

Three independent mechanisms, each sufficient on its own.

**(a) Prompts silently expire.** TTL is enabled on `ttl` (`template-clean.yaml:104-106`) and every
prompt writer stamps `now + 365 days` (`create-ai-prompt.js:173`, `:237`,
`update-ai-prompt.js:258`, `migrate-ai-prompts.js:57,81`). Prompts authored in Aug 2025 are
expiring now. **Question sets carry no `ttl`.** This is a data-loss bug, not a UX bug.

> **R1a — live-data remediation (implemented in code; the sweep is still to run).**
>
> The `ttl` stamps are gone from all three writers (`create-ai-prompt.js` — both the
> `AIPROMPT#` item and the `GAMETYPE#…#CATEGORY#…` default-lookup row —,
> `update-ai-prompt.js`, `migrate-ai-prompts.js`). The table's
> `TimeToLiveSpecification` is **unchanged and must stay enabled**: TTL is a per-item
> opt-in, and `GAME#`/`PLAYER#`/`CONNECTION#` records legitimately depend on it.
> Only records in the `PK='AIPROMPTS'` partition should ever lose their `ttl`.
>
> Existing rows still carry the old stamp and are expiring now. Two remedies, both live:
>
> 1. **Self-healing.** `update-ai-prompt.js` now appends `REMOVE #ttl` to every save,
>    so any prompt anyone edits loses its stamp automatically. (`ttl` is a DynamoDB
>    reserved word — it must go through `ExpressionAttributeNames`.)
> 2. **One-off sweep** — `scripts/cull-ai-prompts.js`, pass `ttl`. Dry run by default:
>
>    ```bash
>    AWS_PROFILE=adminaccess node scripts/cull-ai-prompts.js engagedev --only=ttl
>    AWS_PROFILE=adminaccess node scripts/cull-ai-prompts.js engagedev --only=ttl --apply
>    ```
>
>    It paginates `Query PK='AIPROMPTS'` (never a Scan, so game/player rows are never
>    even read), prints each row with its expiry date and flags any already past, then
>    issues one `UpdateCommand` per row:
>
>    ```js
>    UpdateExpression: 'REMOVE #ttl',
>    ExpressionAttributeNames: { '#ttl': 'ttl' },
>    ```
>
>    Removing an absent attribute is a no-op, so the sweep is idempotent and safe to
>    re-run. Run it against dev, then test, then prod.
>
> **Anything already deleted by TTL is gone** — there is no recovery short of
> point-in-time restore, which is only enabled on prod (`template-clean.yaml:110`).
> Run the sweep before more rows cross their expiry.

**(b) A prompt authored in `AIGenerationPromptEditor` can never work as a summary prompt.** That
form emits `basePrompt`/`contextTemplate`/`outputFormat` and never `template`/`instructions`.
The runtime gate is `get-ai-summary.js:340`:
```js
const usable = (p) => p && (p.template || (p.instructions && p.outputFormat));
```
A generation-format prompt fails it, so `resolvePromptTemplate` logs a warning and **silently
falls back to the game-type default**. Exactly "nothing changed."

**(c) Rows written by `populate-generation-prompts.js` have no `promptId` attribute at all**
(`:473-491`) yet use `SK: 'AIPROMPT#GENERATION#...'`, so `get-ai-prompts.js:44-48` returns them.
In the dropdown `value={prompt.promptId}` is `undefined`, so the DOM option's value becomes its
**label text** — selecting one writes garbage like `"Lessons Learned Scenarios (call-and-answer - )"`
into the set's `promptId`, a dangling reference that falls back to the default.

### R2 — Why "the question-set edit didn't stick"

`AdminPage.jsx:200-203` maps every empty field to `null`; `edit-question-set.js:45,50,55,60` guard
with `if (x !== null && x !== undefined)`. **`null` means "skip."** So:
- Blanking Description / Custom Instructions / AI Context is a **no-op**; the old value returns.
- Choosing "Use default prompt for game type" (option value `""` → `null`) is **ignored**. There
  is no way to detach a prompt through the UI.

Contributors: `editEngagementType` is loaded (`AdminPage.jsx:151`) but **never rendered and never
sent** — engagement type is not editable at all. `edit-question-set.js:34` writes `UpdatedAt`
while `get-question-sets.js:32` reads `updatedAt`, so the list timestamp never moves. The set list
renders only `customInstruction`, never `promptId`, so a failed prompt change looks like a
successful one.

**The `SETS`/`SET#x` vs `SET#x`/`METADATA` split is *not* the cause here** — nothing currently
writes `SET#x`/`METADATA`, and the runtime reader that matters (`get-ai-summary.js:796`) reads
exactly the key the editor writes.

### R3 — Why the prompt dropdown is wrong

The edit dropdown (`AdminPage.jsx:1327-1339`) has **no filter at all**. The upload dropdown
(`:1504`) has one, broken by two competing game-type vocabularies:

| UI value | Analysis prompts stored as | Generation prompts stored as | Result |
|---|---|---|---|
| `call-and-answer` | `callandanswer` | `call-and-answer` | generation never shows |
| `poll` | `polls` | `poll` | **no poll prompt ever shows** |
| `survey` | — | — | matches nothing |

Compounding it, `upload-questions.js:392` hardcodes `promptId || 'lessons-learned'` for **every**
set regardless of type, so a call-and-answer prompt is currently attached to 14 trivia and
wavelength sets — including `SET#famousarttitles`.

### R4 — Art has no identity

Art is detected **solely by a non-empty `image`/`Image` on the question**
(`instructions.js:49`). There is no art game type, tag, category, or set flag. The live set
`SET#famousarttitles` has `engagementType: "call-and-answer"`, `customInstruction: ""`,
`aiContextInstruction: ""`, `promptId: "lessons-learned"`.

---

## Defects found while mapping (all real, none reported)

| # | Defect | Evidence |
|---|---|---|
| D1 | Player round badge renders **blank** — "Lesson " with no number — on ASK and RESULTS | `PlayerPage.jsx:1512` reads `currentQuestion.id`; the player payload (`get-question.js:170-175`) has no `id`. Only the VOTE path sets one. |
| D2 | **Per-set instructions never reach players.** | `PlayerPage.jsx:552` guards on `questionData.setId`; the payload exposes `questionSetId` to the host only (`:155`). The guard never fires. |
| D3 | Host contradicts itself: ASK "Lesson N", RESULTS "Question N" | `GameHostPage.jsx:3533-3535` vs `:3699` |
| D4 | Poll and survey fall through to "Lesson" | `GameHostPage.jsx:3508-3509`, `:3533-3535` |
| D5 | Two art strings; only one is the shared constant | `instructions.js:29` vs `PlayerPage.jsx:1733-1737`, `:1759-1763` |
| D6 | Three instruction surfaces bypass `resolveInstruction` | `PlayerPage.jsx:1635-1637`, `:1733-1737`, `:1759-1763` |
| D7 | `getPlayerInstructionText` hardcodes `'call-and-answer'`; poll/survey never get their default | `PlayerPage.jsx:39-40` |
| D8 | Personas are **not** editable in admin, contrary to the handoff | `get-ai-prompts.js:43-48` hard-filters `SK begins_with 'AIPROMPT#'` |
| D9 | `create-game` silently drops unknown fields (`triviaTimer` has been discarded for months) | `create-game.js:4` fixed whitelist |
| D10 | `personaId` absent from both set-list projections | `admin/get-question-sets.js:18-34`, `game/get-question-sets.js:39-50` |
| D11 | Persona `gameTypes` stored but never consulted | `personas.js:196-235` |
| D12 | Report drops Field Notes for a question that never reached RESULTS | `create-report.js:158` unions votes ∪ results only |
| D13 | Seeded personas have no `status`; the resolver reads one | `seed-personas.js:43-67` vs `personas.js:209` |
| D14 | **Deleting any normally-created prompt throws "not found"** — key-schema split | `delete-ai-prompt.js:67-70,152,180` and `ai-prompt-advisor.js:148-153` use `PK:'AI_PROMPT#'+id, SK:'METADATA'`; everything else uses `PK:'AIPROMPTS', SK:'AIPROMPT#'+id` |
| D15 | `AIPromptManager` never sends `promptType`, so `create-ai-prompt.js:50` labels every Workie **analysis** prompt as `generation` | `AIPromptManager.jsx:10-22` |
| D16 | `get-ai-prompts.js` ignores the `promptType` query param that two callers send | `:34-69` vs `AIGenerationPromptEditor.jsx:95` |
| D17 | Seven call-and-answer prompts all `isDefault:true`; `findDefaultPromptId` tie-breaks arbitrarily | `default-ai-prompts.json`; `get-ai-summary.js:279-320` |
| D18 | Two drifted copies of the default prompts; only `populate-defaults.js` is routed | `default-ai-prompts.json` vs `populate-defaults.js:23+` |
| D19 | `game/get-question-sets.js` omits `hasImages`, so the game-side picker can't badge art sets | `:40-51` |
| D20 | `wavelength` missing from the AIPromptManager filter dropdown | `AIPromptManager.jsx:1201-1210` |

---

## Design decisions

### 1. Round labels — `roundNoun` on the registry, art resolved by image

`config/gameTypes.js` gains `roundNoun`. Art is not a game type, so it resolves by image presence
in a helper beside `resolveInstruction`:

```js
resolveRoundNoun(question, gameType, setRoundNoun) -> 'Artwork' | 'Round' | ...
```

**Default noun: `Round`, not `Lesson`.** "Lesson" asserts the content is didactic, which is false
for icebreakers, retros and opinion sets — and it is the same wrong assumption that made Workie
refuse the vacation-destination game. "Round" is accurate everywhere, reads naturally, and leaves
"Lesson" available as a deliberate per-set override.

| Type | Noun |
|---|---|
| call-and-answer | Round |
| call-and-answer **with image** | Artwork |
| trivia | Question |
| poll | Poll |
| wavelength | Subject |
| survey | Question |

Per-set override via a `roundNoun` field on set metadata (same write path as `customInstruction`),
so a genuine lessons-learned set can still say "Lesson 3".

All eight label sites route through the helper, fixing D3 and D4 as a side effect.

### 2. Art instruction

```js
export const ART_TITLE_INSTRUCTION =
  'Name this work of art. Will you be accurate, witty, or make the room really think?';
```

Applied to the constant *and* both textarea placeholders (D5), with all five instruction surfaces
routed through `resolveInstruction` (D6, D7).

### 3. Clear-vs-skip semantics

`edit-question-set.js` must distinguish "not supplied" from "set to empty". The frontend sends
`''` for a cleared field and omits the key entirely when untouched; the backend guards on
`!== undefined` instead of `!== null`. This is the fix for R2 and it is the single highest-value
change in the plan.

### 4. Prompt system

- **Remove `ttl` from every prompt writer** and strip it from live prompt records. Prompts are
  configuration, not session data. (R1a — urgent.)
- **One vocabulary.** Canonicalise on the dashed ids already in `config/gameTypes.js`
  (`call-and-answer`, `trivia`, `poll`, `wavelength`, `survey`) via `normalizeGameType()` on both
  read and write, with a migration for existing `callandanswer`/`polls` rows.
- **Filter both dropdowns** by normalized game type + `promptType === 'analysis'`, so an art set
  offers only call-and-answer summary prompts.
- **Reject unusable prompts at the picker**, not silently at runtime: a prompt failing the
  `usable()` gate is not offered as a summary prompt (R1b).
- Backfill `promptId` on the `AIPROMPT#GENERATION#` rows or re-key them (R1c).
- Fix `promptType` on write (D15) and honour it on read (D16).
- Fix the delete key-schema split (D14).
- Cull: collapse the duplicated default sets (D18), resolve the `isDefault` collisions (D17), add
  an art/creative summary prompt (none exists).

### 5. Persona controls

- **Read:** `GET /admin/personas`, filtered by `gameType` when supplied (D8, D11).
- **Create:** `personaId` through `create-game.js` → `schema-compliant-manager.js` as `PersonaId`
  (D9).
- **Set:** `personaId` via the existing conditional-`UpdateExpression` pattern in
  `edit-question-set.js`; surfaced in both list projections (D10).
- **Mid-game:** a narrow `PUT /games/{gameId}/persona` using `UpdateCommand`. Explicitly **not**
  reviving `websocket/save-game-context.js`, which `Put`s METADATA seeded from the CONTEXT record
  and would destroy `ScoringConfig`, `Visibility`, `AccessCode` and `Started`.
- Write `status: 'active'` in the seeder (D13).
- The existing **Redo** button (`GameHostPage.jsx:3913`, `generateNew=true`) already works; the
  persona picker sits beside it.

### 6. Reporting

- Union AI-summary question numbers into the report's question list (D12).
- Persist the resolved persona name onto the AISummary item so the report can attribute the voice.

### 7. Deployment tags

Keep the working branch triggers; **add** tag triggers by migrating `cicd/pipeline-clean.yaml` to
`PipelineType: V2` with a `Triggers` block on `dev-v*` / `test-v*` / `prod-v*`. Immutable
`<tier>-v<semver>` tags both deploy and record what shipped, which moving `*-active` pointers
cannot. `scripts/deploy-cicd.sh` must be fixed first — it passes a `GitHubToken` parameter the
template no longer declares.

---

## Out of scope

- Renaming the `LessonNumber` DynamoDB attribute (display is entirely a frontend concern).
- Retiring the `engdev` stack.
- Rewriting the five stale pre-auth test suites.
- The `SET#x`/`METADATA` legacy dual-read (dead code, harmless).
