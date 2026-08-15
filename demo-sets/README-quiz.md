# Quiz demo sets (trivia) — four sets, four Workies

Four **trivia** question sets built to be demoed, each paired 1:1 with its own AI
analysis prompt. The call-and-answer demo sets and the shared `README.md` in this
directory belong to a different author; everything prefixed `quiz-` is described
here.

| # | Set | Questions | Categories | CSV | Workie |
|---|-----|-----------|------------|-----|--------|
| 1 | Intro to Ontology, Taxonomy, Glossary & Controlled Vocabulary | 12 | 5 | `quiz-1-knowledge-organization-foundations.csv` | `quiz-1-…prompt.json` |
| 2 | GenAI From Three Angles: Development, Engineering, Business | 12 | 3 | `quiz-2-genai-dev-eng-business.csv` | `quiz-2-…prompt.json` |
| 3 | Running a Vocabulary: Standards and Failure Modes | 5 | 2 | `quiz-3-vocabulary-standards-and-failure-modes.csv` | `quiz-3-…prompt.json` |
| 4 | Grounding GenAI: RAG and the Retrieval Layer | 5 | 2 | `quiz-4-grounding-genai-rag.csv` | `quiz-4-…prompt.json` |

Two long sets and two short ones. 1 and 2 are the anchors; 3 and 4 are their
close relatives, deliberately pitched one step sideways rather than one step
further along — see *Why these four* below.

---

## How to load one

1. **Admin → Question Sets → Upload**, engagement type **Trivia**. Picking any
   other type silently drops every option column: `upload-questions.js` chooses
   which columns to read from the engagement type, and only the trivia branch
   reads `OptionA`…`OptionF`, `CorrectAnswer` and `Difficulty`.
2. Set the title from the table above. The set id is the title slugged to
   `[a-z0-9]`, so keep titles distinct.
3. The preflight panel should report **0 blocking, 0 skipped, 0 gaps** for every
   one of these files. If it does not, the file has been edited.
4. Create the matching prompt in **AI Prompts** (game type *Trivia*), pasting
   `instructions` into **What the AI is given** and `outputFormat` into **What the
   AI writes**, then attach it to the set. The two halves are concatenated and
   variable-substituted as one string, so the split is for the author's benefit,
   not the engine's.

**Do not set a round kind on these.** `roundKindApplies` is
`['call-and-answer', 'poll']` only — trivia has a correct answer, so "invention"
and "verdict" mean nothing for it. A direction set here would be stored and
ignored, which is worse than absent.

## The format rules these files obey

Learned from `lambda-functions/admin/upload-questions.js`, not guessed:

- **`CorrectAnswer` is a token, not text.** It must be the literal `OptionA` …
  `OptionF`. `websocket/message.js` scores with
  `correctAnswer === 'Option' + answer`, so the answer *text* in that cell
  imports with a cheerful 200 and scores nobody. The importer validates nothing
  here; the preflight warns, and the test in this directory fails.
- **`Difficulty` is `easy` | `medium` | `hard`**, defaulting to `medium` when
  blank. Used as `{difficulty}` in a prompt and shown in the console.
- **A row needs BOTH `Category` and `Title`** or it is skipped in silence.
- **`AnswerDetails` is the reveal.** It is carried by no player or host payload
  and is read only by `get-ai-summary.js`, which runs at RESULTS. That is where
  "why this is right" belongs. `QuestionDetail` is shown during ASK, so it must
  never give the answer away.
- **Category identity folds case and inner whitespace, first spelling wins.**
  These sets use one spelling per category throughout.
- **24 categories is the hard ceiling** (three eight-bit host masks) and nothing
  enforces it — a 25th is stored, displayed and permanently untoggleable. The
  largest set here uses 5.

### Categories are the host's switches

Category is the axis a host toggles off when it does not suit the room, so in
these sets it carries the *angle* rather than a filing label:

- Set 2 is filed **Development / Engineering / Business**. A room of engineers
  gets a twelve-question set; the same set played to a leadership audience with
  Development switched off is an eight-question set that never mentions
  temperature settings. Its Workie reads `{questionCategory}` and changes
  register to match.
- Set 1 is filed **Telling Them Apart / Glossary / Controlled Vocabulary /
  Taxonomy / Ontology**, so a host can run only the head-to-head distinctions as
  a four-question opener, or drop Ontology for a room that will never write OWL.
- Sets 3 and 4 split into two halves each (**Standards / Failure Modes**,
  **How Retrieval Works / When It Goes Wrong**), so a five-minute slot can be cut
  to three questions without losing coherence.

## Why these four

**1 — Intro to Ontology, Taxonomy, Glossary & Controlled Vocabulary.** The brief
set: four words that are constantly used interchangeably, and the confusion is
expensive rather than academic — publishing a glossary and expecting the data to
get cleaner is a real and recurring disappointment. The set is built as a
*ladder*: each question puts one boundary in one place, and the four
"Telling Them Apart" questions are head-to-heads where the room has to pick the
weakest artefact that actually solves a stated problem, which is the judgement
that matters in practice.

**2 — GenAI from Development, Engineering and Business.** The brief set. Three
angles carried by Category. Every question is conceptual rather than
version-trivia: context windows, temperature, in-context learning, unit
economics, latency perception, evaluation, the four EU AI Act tiers, the four
NIST AI RMF functions. Nothing here should need rewriting when the next model
ships.

**3 — Running a Vocabulary: Standards and Failure Modes.** Close to 1, and
deliberately the *other* question. Set 1 asks what these things **are**; set 3
asks what goes **wrong** with one you already own, and which standard tells you
what to do about it — orphans, homographs, deprecation, inter-indexer
consistency, ISO 25964, the reason `skos:broader` is not transitive. It is the
set you play to a room that has already nodded along to set 1 and now has to go
and maintain something. Its Workie is built around that difference: every
response must end in a *check* the room could run this week.

**4 — Grounding GenAI: RAG and the Retrieval Layer.** Close to 2, and one level
deeper on a single axis. Set 2 covers GenAI broadly across three business
registers; set 4 takes the one architecture almost every organisation is actually
building and asks where its faults live — chunking, hybrid retrieval, ranking,
faithfulness, citation as a control. It also quietly joins the two halves of this
collection: a retrieval layer is a knowledge-organization problem wearing a
GenAI hat, which makes 1 → 4 a coherent two-set demo for a room that thinks those
are separate conversations.

## The four Workies

Each prompt is 1:1 with its set and does something the stock trivia prompt
cannot. All four use only variables that are genuinely populated on the **trivia**
path — checked against `lambda-functions/game/template-variables.js`, which is
explicit that a variable resolving to nothing does not error, does not warn and
leaves no visible braces; the sentence built around it just loses its content.

| Set | What its Workie does that a generic one does not |
|---|---|
| 1 | Opens every round by naming the **distinction** in one repeatable sentence, then treats the most popular wrong option as a real position rather than an error. |
| 2 | Reads `{questionCategory}` and pitches the whole response in that **register** — building / running it / deciding — and refuses to invent a model name, price or benchmark. |
| 3 | Every response must contain **one mechanical check** the room could run against a vocabulary they already own, and what a bad result looks like. |
| 4 | Places every question at a named **pipeline stage** — index, retrieve, rank, assemble, generate — and bans "add more documents" and "use a better model" as reflex fixes. |

None declares `outputSections`, so all four use the validated default
Summary / Discussion Questions / Next Steps triad and the response parser fills
the discussion and next-step lists normally.

## Verification

Run from the repo root:

```bash
npx --prefix src jest --config demo-sets/quiz-verify-jest.config.js
```

`quiz-verify-import.test.js` reads each CSV off disk and puts it through the
real `csvPreflight.js` and the **real** `upload-questions.js` handler with only
the AWS SDK stubbed — the same technique
`src/src/__tests__/questionCategories.test.js` uses — then asserts against the
rows the handler tried to write. It is invisible to `npm test` (the repo suite's
`roots` never reach this directory), so it cannot slow or break the main suite.

Last run — 12 tests, all passing:

| Set | Rows accepted | Rows skipped | Categories produced | Answer-key spread |
|---|---|---|---|---|
| 1 | 12 / 12 | 0 | Telling Them Apart, Glossary, Controlled Vocabulary, Taxonomy, Ontology | A3 B3 C3 D3 |
| 2 | 12 / 12 | 0 | Development, Engineering, Business | A3 B3 C3 D3 |
| 3 | 5 / 5 | 0 | Standards, Failure Modes | A2 B1 C1 D1 |
| 4 | 5 / 5 | 0 | How Retrieval Works, When It Goes Wrong | A1 B1 C1 D2 |

Per question, the test also asserts: `correctAnswer` is one of `OptionA`…`OptionF`
**and** names a non-empty option; exactly A–D are populated (E and F unused); no
two options share the same text; `AnswerDetails` survived the import and is
substantial; `Detail` is non-empty; `difficulty` is one of the three accepted
values; and no `RoundKind` was written.

The answer-key spread is deliberate. The first draft of these sets keyed
`OptionB` nine times out of twelve — an artefact of writing questions one at a
time, and something a room notices by round four and starts playing instead of
thinking. The options are rotated (not shuffled) so the distractors keep the
cyclic order they were written in, which matters for the questions whose options
are themselves ordered lists.

## Accuracy

Every question was written to have exactly one defensible answer and three
plausible distractors. The following claims were verified against primary or
near-primary sources rather than recall:

- **ISO 25964** is the thesaurus standard in two parts (Part 1 thesauri for
  information retrieval, Part 2 interoperability/mapping), superseding ISO 2788
  and ISO 5964. *Note: a revision of Part 1 was at DIS stage during 2025, so the
  question and its reveal name no edition year.*
- **`skos:broader` is deliberately not transitive**, with `skos:broaderTransitive`
  provided as its transitive super-property for closure and query expansion.
- **Dublin Core** is a 15-element set (checked, though the final questions do not
  turn on it).
- **EU AI Act** risk tiers: unacceptable, high, limited, minimal. *The question
  asks only about the tiers, not about application dates, which were still moving
  at time of writing.*
- **NIST AI RMF 1.0** core functions: Govern, Map, Measure, Manage — with Govern
  spanning the other three rather than preceding them. Identify/Protect/Detect/
  Respond is the Cybersecurity Framework, used as the distractor.
- **ISO/IEC 42001** published December 2023, the first certifiable AI
  management-system standard.
- **RAG** introduced in Lewis et al. 2020, *Retrieval-Augmented Generation for
  Knowledge-Intensive NLP Tasks*, pairing parametric with non-parametric memory.
- **Model Context Protocol** open-sourced by Anthropic in November 2024, solving
  the M×N connector problem.

Everything else is definitional or conceptual and does not depend on a date: the
semantic spectrum and what each rung adds, preferred/non-preferred terms,
homograph qualifiers, the three legitimate hierarchical relations, polyhierarchy,
class vs individual, the open-world assumption, context windows, temperature and
greedy decoding, in-context learning, token-based billing, time-to-first-token,
evaluation sets and non-determinism, chunking trade-offs, hybrid retrieval, and
citation as a detection control.

Questions that could only be answered with a fact likely to rot — model names,
context-window sizes, benchmark scores, pricing, compliance deadlines — were cut
rather than dated.
