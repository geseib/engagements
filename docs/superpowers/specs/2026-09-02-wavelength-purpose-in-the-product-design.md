# Wavelength states its own purpose — design

*2026-09-02*

## The complaint, in the owner's words

> "the wavelngth set for AI stil has weird text that mislead the purpose of
> wavelength. we give the a word or phrase and they are supposed to list words
> that come to mind when they think of this word or phrase. the idea is in
> communication we often assume that people agree on the meaning when we state
> common words. but often due to or different experiences we have slightly
> different meanings."

That paragraph is the game. It appears in no screen, no set, and no prompt. It
has been explained to an agent twice in one week because there is nowhere for it
to live.

## Why content authoring cannot fix this

The `aijargon` set carried, on every question:

    "Describe in your own words what it means when an AI 'hallucinates',
     without using the word itself."

while the player looks at ten single-word boxes. Clearing that column fixes that
set. It does not stop the next author, or the AI question-writer, from filling
it in again — and both currently do.

Two precedence rules make per-question text authoritative:

- `config/instructions.js:44` — a question's own `CustomInstructions` beats the
  set's, which beats `GAME_TYPE_INSTRUCTIONS[gameType]`. The product's wavelength
  line is the LAST resort, reached only when nobody wrote anything.
- `admin/upload-questions.js:586` —
  `questionCustomInstruction || customInstructions?.trim() || ''`. A filled cell
  beats the set-level value at import, and an EMPTY cell inherits rather than
  clears, so a column can never be used to remove an instruction.

And the AI question-writer actively produces the wrong shape:

- `admin/ai-generate-questions.js:140` instructs `detail:` "one short **scenario**
  introducing the subject". A scenario is call-and-answer framing. It is what
  produced "Your product manager stopped you in the hall and said we need to add
  **Agentic AI** to our dashboard" in `sets/wavelength-sample-questions.csv`.
- `:141` has it emit a per-question `customInstructions` at all, which is the
  field that overrides the product.

So the framing is authored, per question, by whoever or whatever wrote the set —
and the game's own words are the fallback nobody reaches.

## The decision

**The purpose belongs to the product, not the content.** Chosen by the owner
over three alternatives (guided authoring with a save-time check; product plus
optional set addendum; leaving it to the host to say out loud).

Set authors supply the SUBJECT — a word or phrase — and nothing else about
framing. They cannot get it wrong because they no longer write it.

The host-says-it option was argued against and rejected: a room reads the screen
faster than it listens, and a participant joining mid-round never hears it.

## What changes

### 1. Wavelength's instruction is not overridable

`resolveInstruction` returns `GAME_TYPE_INSTRUCTIONS.wavelength` for wavelength
rounds regardless of what the question or the set carries. Every other game type
keeps today's precedence exactly.

This is the load-bearing change. Everything below is consequence or cleanup, and
without it each of them is one CSV away from being undone.

Existing sets are unaffected at rest — nothing is migrated or rewritten. Their
per-question instructions simply stop being consulted for wavelength, which is
what makes this safe to ship without touching a row.

### 2. The screens carry the why, not just the what

Today: `"Enter up to 10 words that come to mind for this subject:"` — an
instruction with no reason attached.

The purpose sentence appears:

- on the player ASK screen, under the instruction
- on the results screen, where the divergence is the finding being read

Wording is the owner's to settle; the spec fixes the PLACEMENT, not the prose.
A starting point, from their own description: *we usually assume we mean the same
thing by a common word — this shows how much we actually do.*

Constraints: it is not a heading and must not compete with the subject; it is one
sentence; on the stage it sits at the meta tier, per `styles/stage.css` — the
four display profiles have literal ladders and the entry must not be sized off
the laptop one.

### 3. The AI question-writer stops producing framing

In `lengthGuidanceFor`'s wavelength branch:

- `detail` stops being "one short scenario". A wavelength detail is suppressed on
  every ASK surface already (`__tests__/wavelengthConvergence.test.jsx`, "ASK
  shows the term and NOTHING about it"), so a scenario there is invisible to
  players and misleads only the author and the report. It becomes a short
  neutral note ABOUT the subject, or is dropped.
- `customInstructions` is no longer emitted for wavelength. The product owns it.

### 4. The template and the sample stop teaching the wrong shape

- `admin/download-template.js` — the wavelength template's `CustomInstruction`
  column is emptied, with a header comment saying the product supplies it.
- `sets/wavelength-sample-questions.csv` — the scenario details
  ("Your product manager stopped you in the hall…") are replaced with subjects.

### 5. The results prompt stops contradicting the engine

`sets/prompt-wavelength-round.json` tells the model the round looks for words
"MULTIPLE PEOPLE independently reached for". That is the count>1 rule the
convergence spec retired: a word LANDS when EVERY submitter said it. The prompt
is describing a different game than the one that ran.

## What is deliberately NOT in scope

- **No migration.** No stored set is rewritten. Change 1 makes existing content
  inert for wavelength, which is the whole reason it is first.
- **No save-time gate.** The owner rejected the "guided authoring" option; a
  check that rejects prose-style instructions would be guessing at intent, and
  is unnecessary once the field is not consulted.
- **The round-header bug is separate.** Rounds asked outside `next-question`
  record no `QUESTION#nnn#REF`, so `create-report.js:614` falls back to
  `Question NNN`. Same report surface, unrelated cause, its own fix.

## How this is tested

Source-scanned where it must be: neither page mounts in jsdom, which is the
pattern `wavelengthConvergence.test.jsx` already uses for the ASK contract.

- `resolveInstruction` returns the product's line for wavelength even when the
  question AND the set both carry text — the regression that would silently
  restore author control.
- Every other game type's precedence is unchanged, asserted alongside it, or
  change 1 becomes a quiet behaviour change for trivia and polls.
- The purpose sentence is present on both surfaces and is not sized off the
  laptop ladder.
- The generator's wavelength branch emits no `customInstructions` and does not
  use the word "scenario".
- The prompt asserts unanimity, not "multiple people".
