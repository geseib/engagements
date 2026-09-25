# The prompt workbench — design

**Date:** 2026-09-25 · **Status:** built on `working/prompt-workbench`, for review before dev

## What the owner hit

He ran Improve, applied its fixes, opened the editor, and the editor showed a finding Improve had
never mentioned: "discussionQuestions and nextSteps will come back empty on every round". Two
reviewers that never saw each other, and Improve could not have fixed it anyway:

- **Improve** (the AI advisor) was never told the prompt's declared Output sections, reviewed the
  SAVED copy rather than the draft, and could only rewrite the two text halves.
- **The editor's checks** (`utils/promptPreflight.js`, deterministic) ran on the rewrite only after
  Apply, at the bottom of the dialog.
- **Nothing in the editor could change Output sections at all.** The finding said "name a
  section so it matches", and no field existed to do it.

The owner's ask: fix the confusion; a simple but flexible tool; a way to simplify; export to an
outside agent and import back, Engage admins only; and better prompts — variety, well-spoken
dialogue, facts about the round and the event, and outside knowledge.

## What the admin sees

Everything happens in the prompt editor, on the draft in front of them. Nothing is ever saved
without pressing Save.

1. **The editor gains one field, Output sections** — the headings the reply must use, in order,
   each with a line of guidance. Empty means the default Summary / Discussion Questions / Next
   Steps. This is where the structured-fields finding gets fixed.
2. **In the editor's head sit three tools** — where the mockup puts "Ask AI to improve it"
   (`docs/design/admin-redesign/19-prompt-editor.html`): *Improve or simplify…*, *Download for an
   agent*, *Upload a revised file*.
3. **Improve…** swaps the editor's content for the workbench (same dialog, "Back to the editor"
   returns; the draft is untouched until Use this). The library row's Improve button opens the
   editor straight onto this view. It stays mounted while you go back to the form, so advice that
   cost a model call survives a detour to fix a heading; if the draft changed since, it says so.
   - **What the checks found** is shown at once — the editor's own deterministic checks on the
     draft. Every item says where it gets fixed: **Improve can fix this** (it is in the text
     halves; it has a tick box), **Fix in the editor: Output sections / the default box / the two
     halves**, or **For information**.
   - **Ask the AI**: *Review* (safety, fairness, clarity) or *Improve* (effectiveness, variety,
     voice, use of round and event facts, tightening). Its items join the same list, with the
     same "where" line. The AI is shown the declared sections and every finding the code made,
     and told not to repeat or contradict them; advice about headings comes back as "Fix in the
     editor: Output sections" and is never sent to a rewrite.
   - **Apply selected (N)** rewrites the halves with the ticked items — the code's and the AI's
     together. The result opens with **the checks re-run on it** (fixed / still there / new),
     then each half before and after with word counts. *Use this* puts both halves in the editor
     as unsaved work.
   - **Simplify** is the third choice: shorter and clearer in one pass, shown the same way. The
     server refuses a result that dropped a `{variable}` or a heading line, or that breaks a save
     rule, and says which (an organisation's heading by position, since a job's error is not
     sealed; the log gets only that there was a refusal).
4. **Download for an agent** writes one Markdown file (below). **Upload a revised file** reads it
   back, refuses a file for another prompt or game type or a malformed one with a sentence,
   otherwise shows what changes and the checks on the new version; *Put it in the editor* makes
   it unsaved work.

## Who owns what

| Deterministic — code checks it, the save gate and the room obey it | The AI — judgement |
|---|---|
| unknown / misleading / duplicated variables, variables named inside sentences, square brackets, no response variable, section-heading rules, structured fields left empty, the default flag's reach, word caps the model need not obey | variety round to round, a well-spoken voice for a room, clarity, using what it is given about this round and this event, where outside knowledge helps, tightening |
| Simplify's guarantees (every variable and heading kept, save rules held) — checked on the server after the model replies | Simplify's wording |

Output sections stay deterministic and admin-edited: they are a contract with the parser and
three screens, code validates them exactly, and editing them is three inputs. The AI may say a
heading should change; it may not change one.

## The export file

One Markdown file, `<name>.workie.md`: prose an agent (or person) reads, then one hand-back
region between `<!-- engage-workie:begin -->` and `<!-- engage-workie:end -->` holding a
` ```json engage-workie ` block (identity and structured fields: `format`, `version`, `promptId`,
`gameType`, `promptType`, `category`, `name`, `description`, `outputSections`, `angleWeights`,
`template`, `status`, `isDefault`, `tags`) and the two halves in their own ` ```text ` fences
(`engage-workie:instructions`, `engage-workie:outputFormat`).

**Why the halves are not JSON strings:** this repo measured it — asked for two long halves as
JSON, Sonnet 4.6 wrote a reply that held no parseable object (`ai-prompt-advisor.js`,
`parseRewrite`). A fenced text block needs no escaping; the fence is made longer than any
backtick run in the text. Upload also accepts the bare JSON object with the halves inside, for
an agent that prefers it.

The prose carries, generated from the sources the app uses, never retyped:

- what the agent may change (`instructions`, `outputFormat`, `outputSections`, `angleWeights`,
  `description`) and how to hand it back; everything else is identity and is ignored on upload;
- the variables for the prompt's game type with meaning and example, and the save rules —
  both from a new gated server call (`POST admin/ai-prompt-advisor`, `analysisType: 'reference'`),
  which returns `AUTHORING_RULES`, `variablesToOffer(gameType)`, the section limits and default
  from `prompt-shape.js`, and the assembly layers the advisor itself is told;
- how the reply is parsed (`SECTION_SYNONYMS`) and which screen reads which field; the target
  model and its limits; the round angles and their house weights — from the frontend modules
  that are pinned to `get-ai-summary.js` by tests;
- the current deterministic findings, with where each gets fixed.

## Engage admins only

- **Client**: the three tools live only in the editor, which read-only mode never mounts (the
  read-only view has no editor and no tools).
- **Server**: the reference call is the advisor's POST, behind `requireAdmin` and
  `canAuthorPrompts` — the same gate as every prompt write — so no file can be built for anyone
  else. Upload has no route: its only effect is the editor's draft, and Save is gated as before.
- Prompt text never reaches a log: the reference call carries none, and the new jobs log lengths
  only.
