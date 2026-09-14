# How a "Workie" gets chosen — the current map

*2026-09-02. Research only: no code changed. Every claim carries a `file:line`.*

## The headline: it is TWO systems, not one

A host thinks "which Workie narrates this round?" is one choice. It is two
independent resolutions that never consult each other:

| | **Persona** — the VOICE | **Prompt** — WHAT IT SAYS |
|---|---|---|
| resolver | `game/personas.js:486-552` | `get-ai-summary.js:477-511` |
| storage | `PK='AIPROMPTS', SK='PERSONA#<id>'` | `PK='AIPROMPTS'` (+ org partitions) |
| set field | `personaId` | `promptId` |
| host override | `PUT /games/{id}/persona` | none |
| tenanted? | deliberately **not** (`tenant.js:143-145`) | org partitions exist but are unread |

Almost every confusion below comes from these being separate.

## Persona resolution, in order

1. Session `METADATA.PersonaId` — the host override (`get-ai-summary.js:1148`)
2. Question set's `personaId` (`:1066-1069`)
3. The set's `aiContextInstruction`, used *as a voice* (`personas.js:539`)
4. The session's `AIContext`, used *as a voice* (`personas.js:542`)
5. **`INFERRED_VOICE`** — the real default; the model picks its own register (`personas.js:258-270`)
6. `templateInstructions` — legacy, **never wins** (`personas.js:551`)

A dangling, inactive or empty-`voice` persona falls to the next rung rather than
erroring (`personas.js:494-512`).

## Prompt resolution, in order

1. The set's own `promptId`, if it loads **and** has usable shape (`prompt-shape.js:29`)
2. Otherwise fall through, recording `recoveredFrom`/`recoveryReason` (`:481-497`)
3. Game-type default — a Scan for `isDefault:true`, matched in JS (`:394-405`)
4. Tie-break: preferred category → analysis-shape → oldest → id (`:415-429`)
5. Hardcoded *ids* (`'trivia-basic'`/`'lessons-learned'`) — the seeder mints random
   ids (`populate-defaults.js:63-65`), so these usually resolve to nothing
6. Hardcoded *text* — sits in a `catch`; a merely missing row returns null first
   (`:285-287`) and never reaches it
7. Nothing → data-driven fallback summary, `model:'fallback'`

**Category, org scope and `status` appear nowhere in this order.**

## Answering the three questions directly

**What lets me pick a Workie?** Four surfaces, and one of them is invisible to
most hosts:

- create/edit session dialog — `GameSetupDialog.jsx:559-580`, gameType-filtered
- live stage picker beside Redo — `GameHostPage.jsx:6102-6131`
- question-set editor, "Workie's Voice" — `QuestionSetEditor.jsx:1190-1210`, unfiltered
- host remote — **none**

**How does a set default one?** `personaId` for the voice, `promptId` for the
analysis, both on the set row, both written without any backend validation —
no existence, shape, status or org check (`upload-questions.js:828`,
`edit-question-set.js:48`).

**How does a host override, change tone, add info?** `PUT /games/{id}/persona`
works at any point and applies **from the next round** — an on-screen summary
keeps its voice, because PersonaId/Name/Source are frozen onto the AISummary item
(`get-ai-summary.js:1219-1221`). "Redo" is the separate control that rewrites the
current one.

**There is no tone knob.** Tone lives inside a persona's `voice` string. The two
free-text fields a host does get — `engagementInfo`→`Details`, `aiContext`→
`AIContext` — reach the model **three times**: as a voice rung (3/4 above), as
`SESSION CONTEXT` (`:2398`), and again last as `THE HOST'S REQUIRED ADDITIONS`
(`personas.js:427-469`).

## What can go wrong today

**Correctness**

1. **An org's own prompt is invisible.** `create-ai-prompt.js:204` writes
   `PK=ORG#<id>#AIPROMPTS`; `get-ai-summary.js` hardcodes `PK:'AIPROMPTS'`
   (`:281,:315,:398`) and never decrypts a prompt. An org's Workie, attached to
   its own set, silently becomes the platform default.
2. **Hosts cannot see the persona list.** `GET /admin/personas` resolves to
   `['admins']` (`authorizer.js:369-372`) while `PUT .../persona` is hosts+admins.
   Both callers swallow the 403 into an empty list, so a non-admin host sees only
   "Adapt to the session", and a set that HAS a persona renders as
   `"<id> (unknown — Workie will adapt instead)"` (`QuestionSetEditor.jsx:338-339`).
3. **`status` is never read at runtime.** Archiving a prompt does not stop it;
   soft delete only sets `status:'archived'` (`delete-ai-prompt.js:264-274`).
4. **Game-type coupling is picker-only.** `gameTypes` is read solely by
   `get-personas.js:41-50`; the resolver and both write routes ignore it, so the
   trivia-only `mtv-vjs` can narrate a wavelength round.
5. **No persona names `wavelength` or `survey`** — they get only the eight
   `['all']` voices. **`survey` has no default prompt at all.**
6. **Two competing "defaults".** `facilitator` carries `isDefault:true`
   (`personas.js:49`) and is pinned by a test, but nothing reads it — the real
   default is `INFERRED_VOICE`.
7. **A public set can point at a private org prompt** —
   `publish-question-set.js:162` copies `promptId` but not the prompt.

**Security**

8. **`PUT /games/{gameId}/persona` never checks whose session it is.**
   `update-game-persona.js` has no tenant import at all and is absent from the
   org-ownership registry that covers eleven other session routes. It carries the
   Cognito authorizer, so the boundary is "any `hosts` account plus one of 9,000
   ids" — the exact class closed for `next-question`, `stage-beat`,
   `reveal-authors`, `create-report` and the rest. `update-game.js:214-230` also
   writes `PersonaId` and DOES check (`:147`), so the two writers disagree.

**Dead weight**

9. Stored generation prompts are decorative — `populate-generation-prompts.js` is
   unrouted, `WAVELENGTH_OUTPUT_FORMAT` is read by no generator, hardcoded
   guidance is appended last and always wins.
10. `GAMETYPE#<t>#CATEGORY#<c>` pointer rows: written by two handlers, read by none.
11. `questionSetIds` on prompt records: accepted, never populated.
12. `ai-generate-pbd.js` is unrouted with no caller.
13. **There is no persona write API.** The seed script is the only creator, so
    `personas.js:38` and `seed-personas.js:10` ("editable in the admin UI") are
    both false — `get-personas.js:5-8` says so itself.

**Authoring**

14. **Two wavelength question-writers disagree.** `ai-generate-scenarios.js:229`
    forces `detail:''` ("any framing contaminates their answers");
    `ai-generate-questions.js:140` asks for "one short scenario". The first is
    reached when generating a whole set, the second when adding or refining one
    question. The scenario text in `sets/wavelength-sample-questions.csv` is the
    second path's output, checked in.
15. `ai-generate-questions.js`'s tool schema has no wavelength branch, so it
    describes `detail` as "the scenario itself, 2-4 sentences, 350 characters"
    while the same request says 200 (`:65,:82` vs `:140`).
16. Nothing validates a generated question against its game type.
