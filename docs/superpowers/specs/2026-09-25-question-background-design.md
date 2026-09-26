# Question Background — material the Workie can draw on

2026-09-25 · approved in conversation with the owner

## Why

The owner wants Workie summaries with more variety, better-spoken dialogue, and real facts
about the round, the event and the topic. They also want a rule that "never makes stuff up".
Today the material is thin in the places that matter:

- The **Call & Answer generator** writes nothing hidden per question. Its item schema
  (`lambda-functions/admin/shared/structured-generation.js` `buildItemsTool`) is
  `title, category, detail, customInstructions, tags`.
- The **Trivia generator** writes `answerDetails` (the reveal: why the answer is right).
  Nothing else.
- Both builders fill the set's Workie note (`aiContextInstruction`) with boilerplate
  (`AIScenarioBuilder.jsx` `generateAIContextInstructions`, `TriviaAIBuilder.jsx`
  `buildSetMetadata`). They throw away the admin's free-text brief, apart from 100
  characters kept in `description`.
- Seven of the eight Call & Answer default prompts never read a question's reveal.

The owner considered a knowledge base and chose instead to populate what already exists
first. S3 Vectors stays a later option.

## What the owner decided

| Question | Decision |
|---|---|
| Where the per-question material lives | A **new `Background` field**. The Reveal (`AnswerDetails`) keeps its job. |
| Who sees it | **The Workie and admins only.** Never phones, never the stage. |
| Missing context | A **quiet host-only hint**. The Workie never mentions the gap on screen. |
| Host event details | **Keep the current fields.** Event details and Instructions for Workie serve every type; the briefing stays Call & Answer only. |
| How Background reaches the Workie | **Injected automatically** into the context block every prompt already receives. `{background}` is catalogued for prompts that want to place it themselves. |

My assumptions, which the owner can correct: the prompt-workbench work on
`working/prompt-workbench` is separate, and Wavelength is not included.

## Design

### 1. The `Background` field

- Stored on the question row as `Background` (a string, 600 characters at most).
- **Encrypted for org sets.** Add it to `ENCRYPTED_FIELDS.question` in all three
  identical copies of `tenant-crypto.js` (`admin/shared`, `game`, `websocket`).
- **Published and copied with the set.** Add it to `QUESTION_FIELDS` in
  `admin/shared/publishable.js`, so publish hashes, snapshots and copies carry it.
- **Never in a live payload.** `get-question.js`, `get-game-state.js` and every
  websocket broadcast leave it out, as they already do for `AnswerDetails`.
- **CSV.** An optional `Background` column in `upload-questions.js` and in
  `download-question-set.js`, and a line in the outside-author guide
  `src/src/config/aiAuthoringPrompt.js` telling authors to write only what they are
  certain of.
- **Editor.** A text field in the question editor (`QuestionsPanel.jsx`, beside
  "Reveal") labelled **Background for Workie**, with the hint "Facts and context
  Workie may use. Never shown to players."
- **Content check.** `content-guardrail.js` scans it, as it scans `AnswerDetails`.
- **Legacy.** A question without the field reads as having no background. Nothing is
  migrated.

### 2. The generators

**Call & Answer** (`ai-generate-scenarios.js` via `structured-generation.js`)
- The item schema gains `background`. It is required for `call-and-answer` and absent
  for `wavelength`.
- Schema text: "2-4 sentences, 600 characters maximum. Material the summariser may draw
  on when reading the room's answers: context, one well-established fact, a useful
  angle, or a follow-up that pushes the room further."
- It flows through `scenariosToCsv` (`generated-set.js`) as a new `Background` column.
- `appendOnly` runs from the Add Questions dialog get it too, because they share the
  same tool.

**Trivia** (`ai-generate-trivia.js`)
- The item schema gains `background`, separate from `answerDetails`.
- Schema text: "1-3 sentences, 400 characters maximum. The story around the answer that
  makes good commentary. Not the explanation of why it is correct; that is
  answerDetails."
- It flows through `triviaToCsv` as a new `Background` column.

**The truth rule, identical in both generator prompts.** It lives in one shared
constant.

> Write only what you are certain is true. No statistics, dates, names or quotations
> unless they are widely established and you are sure of them. Nothing about the
> audience's organisation, people or events. When you are not certain of a fact, give
> an angle or a question instead.

**The set's Workie note** (`aiContextInstruction`) is built deterministically from the
admin's own brief, in both builders. No extra model call, so nothing in it is invented.
It contains:

- the topic, audience and difficulty;
- the free-text context the admin typed, verbatim, trimmed to the field's limit;
- one fixed line: "Each question carries Background notes from the set's author. Draw
  facts from those notes and from what the room says."

### 3. The Workie (`get-ai-summary.js`, `personas.js`)

- The summary engine reads the question's `Background`, decrypting it with the set's
  org as it does for `AnswerDetails`. It accepts either spelling, and an absent value
  becomes `''`.
- `buildContextBlock` gains `questionBackground`. When it is non-empty, the block adds
  this line:
  `BACKGROUND ON THIS QUESTION (from the set's author, not something the room said): …`
- `{background}` joins the variable catalogue in all three copies of
  `template-variables.js`, for every game type. If a prompt names `{background}`, the
  context block leaves the line out, so the material is never said twice.
- **One honesty rule, written once in `personas.js`,** is appended to every prompt's
  context, whether or not the block has anything else in it:

> Facts come from the material above, from what the room said, or from general knowledge
> you are certain of. Never invent numbers, names, quotations, or anything about this
> organisation or event. When something you would like is missing, work with what you
> have and do not mention that it is missing.

- `answerDetails`'s placeholder "No explanation provided" is **not** changed here. The
  prompts already treat it as absent, and changing it is out of scope.

### 4. The host-only hint

- Each summary row records `ContextUsed`, as yes/no flags only and never the content:
  `eventDetails`, `hostInstructions`, `briefing`, `setNote`, `background`. This
  generalises the existing `BriefingUsed`.
- The host sees one quiet line: **Workie had:** question notes ✓ · event details — ·
  set note ✓ · briefing —.
- It is shown in two places: the **host remote** (a phone, tablet or laptop), under "What we heard", and the
  **session report**'s round view (after the fact). It is never shown on the host
  page. That includes the session sidebar, because `SessionSetupPanel.jsx` is an
  overlay on the page the room may be watching (its own header: "this panel is a
  surface the room can watch"). *Corrected 2026-09-25, while planning. The first
  draft said "session sidebar".*
- Wording and placement follow the `engage-design` skill.

### 5. Proof on dev (acceptance)

1. Generate one Call & Answer set and one Trivia set with the builders. Every question
   has a Background, and the set note reflects the brief.
2. Host one session of each with Event details filled in, and play a round. The summary
   uses the notes and event details, and the hint shows ✓ for each.
3. Play again with no Event details. Nothing on the stage mentions the gap, and the hint
   shows "event details —".
4. Read the generated Backgrounds for anything invented, and report what was found.

## Data flow

```
builder brief ──► set note (deterministic) ──────────────┐
generator ──► items{…, background} ──► CSV ──► upload ──► question row Background (encrypted for org)
                                                          │
host setup ──► METADATA Details / AIContext / Briefing ───┤
                                                          ▼
get-ai-summary ──► buildContextBlock(eventDetails, hostInstructions, setNote, questionBackground)
               ──► honesty rule ──► model ──► summary row { …, ContextUsed }
                                                          │
                                         host sidebar + host remote hint
```

## Error handling and edge cases

- **Missing Background** (legacy, manual builder, CSV without the column): the line is
  omitted and the flag reads "—".
- **Over-long Background**: one shared `clampBackground()` trims it to 600 characters
  at the last sentence end that fits, or else the last word. It runs wherever
  Background comes in, generator output and CSV import alike. The editor field stops
  at 600. *Corrected while planning: `upload-questions.js` has no per-row length
  check to reuse.*
- **A decryption failure** for Background is treated like one for `AnswerDetails`:
  it is logged without content and the question reads as having no background.
- **Logging**: Background content is never logged. Lengths only, via `shapeForLog`.

## Testing

Backend node tests, each watched failing first:
- the Call & Answer and Trivia tool schemas carry `background`, and it lands on the
  saved row;
- it is encrypted for an org set;
- it is absent from every player and live payload;
- the context block and the honesty rule;
- no duplicate when a prompt names `{background}`;
- the `ContextUsed` flags.

Frontend jest tests: the editor field, and the hint in the sidebar and on the remote
(and its absence from the stage).

The full backend loop, jest, lint and build all run, and the baselines hold.

## Out of scope

- S3 Vectors or any knowledge base.
- The briefing for Trivia.
- Rewriting the default prompts: automatic injection makes it unnecessary.
- Wavelength.
- Changing `answerDetails`'s placeholder text.
