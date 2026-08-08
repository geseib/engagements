# Workie Personas & the Output Contract — Design

**Date:** 2026-08-07
**Status:** Approved (owner answered all five design questions; implementation authorised)

## Problem

Three symptoms, one cause.

1. **Summaries come back thin.** The parser wants `## Summary` / `## Discussion Questions` /
   `## Next Steps`. Nothing makes the model produce them. On engagedev game 7971 Claude returned
   `# Strategic Engagement Summary` followed by `## Challenge`; no section matched, so
   `summaryText` fell through to a "first non-empty line" fallback and the panel showed a single
   sentence.

2. **Workie misreads the room.** The same session asked *"ULTIMATE VACATION DESTINATION"*. The
   seeded default prompt declares Claude *"an AI business strategist analyzing lessons learned"*,
   so it refused: *"insufficient for meaningful business analysis… leisure-focused question."*
   The content was fine; the persona was wrong for it.

3. **Session intent loses to the template.** That set's `aiContextInstruction` said
   *"you are a witty DJ. Comment on the top picks and share a piece of trivia."* It **was** loaded
   (`🎯 Found question set AI context:` in the log) but injected as a subordinate
   `QUESTION SET CONTEXT:` line underneath a template that had already assigned Claude a
   different identity. The strategist won.

**Root cause:** voice and structure are tangled in one free-text template, and the template's
baked-in voice outranks the session's actual intent. Fixing the parser alone would produce
well-structured summaries in the wrong voice.

## Approach

Split the prompt into three layers with distinct owners:

| Layer | Owns | Set by |
|---|---|---|
| **Voice** | tone, register, angle | persona (host / set / inferred) |
| **Structure** | headings, section order | **the system, always** |
| **Content** | session facts | game + set + question data |

A persona can never change structure, which is what makes personas safe to add freely — the
parser's contract stops depending on what anyone typed into a textarea.

The admin form already models this: field 1 is *"Define the AI's persona, expertise, and
communication style"*, field 2 is *"Output Format (Markdown)"*. This design makes that split
real and moves structure out of field 2's reach.

## Design decisions (owner-approved)

1. **Default behaviour: infer from the session.** No persona configured → Workie adapts its own
   register from the event title, question set, question and answers.
2. **Persona storage: admin-managed**, as a new record kind alongside existing prompts
   (`PK=AIPROMPTS`, `SK=PERSONA#<id>`), edited in the existing prompt manager. Ships with a
   curated starter set that can be edited without a deploy.
3. **Precedence: host pick > question set > game > template.** The most specific, most recent
   human choice wins. This is the precedence that would have prevented the bug — the witty DJ
   would have beaten the strategist.
4. **Output contract is system-appended.** Personas control only tone.
5. **Mid-game switch applies to the next question**, plus an explicit **Redo** control to
   regenerate the question currently on screen.

## Components

### `lambda-functions/game/personas.js` (new)

Owns the persona vocabulary and resolution. No AWS calls beyond a single DynamoDB read.

```js
resolvePersona({ hostPersonaId, setPersonaId, questionSetAiContext, gameAiContext, templateInstructions })
  -> { source, personaId?, name?, voice, inferred: boolean }
```

Resolution order, first hit wins:

1. `hostPersonaId` — explicit host pick, including a mid-game switch
2. `setPersonaId` — persona attached to the question set
3. `questionSetAiContext` / `gameAiContext` — free-text voice already authored by the owner
   (this is the "witty DJ" path; kept so existing content keeps working)
4. **inferred** — no fixed persona; emit an adaptive voice instruction (below)
5. `templateInstructions` — legacy prompt text, last resort

Returns `voice` as a plain string so the caller never branches on source.

**Inference is not a separate model call.** When nothing resolves, `voice` becomes a
meta-instruction telling Claude to read the session and choose its own register — playful for an
icebreaker, analytical for a retro. No extra latency, no extra cost, and it is precisely the
"understand the intent" behaviour asked for.

### Persona record shape

```
PK: "AIPROMPTS"
SK: "PERSONA#<personaId>"
personaId, name, tagline, icon      // icon = a name from components/Icon.jsx
voice                                // the instruction text; the persona IS this string
gameTypes: ["all"] | ["trivia", ...] // which game types it suits
status: "active" | "inactive"
isDefault: boolean
sortOrder: number
```

Starter personas (editable after seeding): **The Facilitator** (neutral, warm), **The Comedian**,
**The Business Advisor**, **The Coach**, **The Historian**, **The Sports Commentator**,
**The Sceptic**, **The Storyteller**.

### Output contract — `buildOutputContract()`

Appended after the voice block on every request, regardless of persona or template:

```
## Summary
2-4 sentences.

## Discussion Questions
1-3 numbered questions.

## Next Steps
1-4 numbered actions.
```

with an explicit instruction to use exactly those three H2 headings, in that order, and to add no
others. Voice shapes what goes *inside* the sections.

### Parser hardening — `parseAIResponse()`

The contract makes conformance likely, not certain, so the parser stops being brittle:

- Accept `#`, `##`, or `###` for section headings.
- Strip a leading H1 title before parsing (that H1 is what broke game 7971).
- Broaden heading synonyms (`Key Lessons`, `Themes`, `Takeaways`, `Recommendations`, `Actions`,
  `Discussion Topics`).
- **Replace the "first paragraph" fallback.** When no `Summary` heading is found, take all prose
  *before the first recognised section heading*, not the first line. That single change fixes the
  thin summary even for a non-conforming response.
- Accept `-`/`*` bullets as well as `1.` numbering for the list sections.

### Host control

- Persona picker at engagement creation (existing new-game dialog).
- Persona picker in the host toolbar during a game → sets voice for subsequent questions.
- **Redo** button on the results panel → re-invokes the summary worker with `force: true` for the
  question on screen.

## Data flow

```
host pick ─┐
set persona ├─> resolvePersona() ──> voice string ─┐
ai context ─┤                                      ├─> prompt = voice + CONTRACT + content
inferred ───┘                                      │
template ───┘                                      │
                                                   v
                              Bedrock (Haiku 4.5) ──> parseAIResponse() ──> Field Notes
```

## Error handling

- Persona lookup fails or the id is dangling → fall through to the next precedence level. Same
  defect class as the dangling `promptId` fixed in `433dfb21`; it must degrade, never dead-end.
- No persona resolvable at any level → inferred voice. There is always a voice.
- Bedrock fails → existing data-driven fallback, unchanged.
- Response ignores the contract → hardened parser recovers; the raw markdown is retained.

## Testing

`tests/persona-resolution.js`, plain-Node in the existing style, stubbing via `Module._load`
(as `tests/ai-prompt-resolution.js` does — the `require.cache`-by-path approach silently misses
because several SDK packages exist only in the deployed bundle).

- each precedence level wins over the ones below it
- a dangling `personaId` degrades to the next level rather than dead-ending
- with nothing set, the voice is the adaptive/inferred instruction
- the output contract is present regardless of which level supplied the voice
- a persona cannot inject or override section headings

`tests/ai-response-parsing.js`:

- the exact game 7971 response (leading H1 + `## Challenge`) yields a full multi-sentence summary,
  not one line — the regression that motivated this
- a fully conforming response parses all three sections
- `#`/`##`/`###` heading levels all parse
- `-`/`*` bullets and `1.` numbering both parse
- a response with no recognisable headings still yields a usable summary

## Out of scope

- Changing the DynamoDB key schema.
- Fixing the non-atomic question-set DELETE (tracked in `admin-prompt-cleanup-plan.md`).
- Reconciling the `SETS/SET#x` vs `SET#x/METADATA` split that let a dangling `promptId` survive.
- Per-persona model selection.
