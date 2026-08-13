# Question-set management, reimagined — the design and the build

**Date:** 2026-08-12
**Status:** proposed, awaiting owner approval. **No code has been changed.**
**Brief:** [`docs/handoff/question-set-management-reimagined.md`](../../handoff/question-set-management-reimagined.md)
**Sibling plan / house style:** [`2026-08-11-admin-question-sets-and-jobs.md`](2026-08-11-admin-question-sets-and-jobs.md)
**Owner constraint, verbatim, and it still binds:** *"fix bugs, and add capabilities that are needed as long as they are not considered major uplift items."* Part 7 says plainly which items exceed it.

**Grounding.** Every line number below was re-derived on `dev` at `87162f0b`. The parent
plan's numbers are stale and it says so; so are `RESUME.md`'s. `AdminPage.jsx` is **1,147**
lines today, not 1,719 — `QuestionSetsPanel`, `QuestionSetUploadPanel`, `QuestionSetDeleteDialog`
and the editor have all left it since that figure was written.

---

## 0. The one fact that reorganises this whole problem

**There is no per-question write API. There never has been.**

Search the template: the only routes that touch question rows are
`POST /admin/upload-questions` (`template-clean.yaml:1323`) and the three version routes
(`:1541`, `:1565`, `:1592`). `GET /question-sets/{setId}/questions` (`:421`) is read-only.
There is no POST, PUT or DELETE for a question anywhere in the API.

So every capability the owner asked for —

> add more questions · refine a single question · delete a specific question ·
> select a group and make a subset set · add them to another existing set

— resolves to the **same** mechanism: read the current version's questions, mutate an array
in the browser, and `POST /admin/upload-questions` with `replaceSetId`. That is exactly what
`QuestionSetEditor.jsx:278-300` already does with a hand-picked CSV file.

Three consequences run through everything below:

1. **"Saving makes a version" is already true.** The replace branch of `upload-questions.js`
   unconditionally writes `SET#<id>#v<n+1>` and flips `activeVersion` (`:522-557`, `:741-800`).
   Any question change is already a version. Nothing needs building for that half of §3 of the
   brief; what needs deciding is *when the save fires*, which is a UI question (Decision 3).
2. **The CSV round trip is the load-bearing contract**, not a convenience. And it is broken —
   see **S1**, which is the first slice for that reason.
3. **A new per-question API is not needed and should not be built.** It would be a second
   writer racing the version system, and versions exist precisely so a game already in progress
   keeps reading the rows it started on (`set-version.js:12-29`).

---

## 1. The five decisions

### D1 — The kind is a property of the QUESTION. The set carries the default.

**Decision.** `roundKind ∈ {produce, apply, improve, judge, custom}` lives on **both** rows.
On the `SETS` row it is the set's **direction**: what the generator is steered with, what the
library filters on, and what a question inherits. On a question row it is an **optional
override**; absent means inherit. Absent on the set means `produce`.

**Why the question and not only the set.** Apply and Improve are defined by *the material you
hand the participant* (§1 of the brief), and that material is per question — the passage about
surgical checklists, the mission statement being reworded. A set cannot be uniformly Apply
unless every question shares one artefact, which is not how the exemplar set is written
(`sets/agentic-sdlc-call-and-answer.csv` gives each round its own `Detail_lesson` of 400–700
characters). The owner also named the mixed case directly: open Produce to warm the room, move
to Improve once people are talking.

**Why the set carries it too, rather than deriving it.** The generator is invoked once for
twenty questions. It needs one steering value. The library needs one facet to filter on
without reading every question row. And a set with no declared direction has nothing for the
"AI-assisted overview" step to propose a persona from.

**`custom` is an escape hatch, not a fifth kind.** The owner asked for a "something else"
free-text path. Take it, but keep the enum **closed** — every prompt branch, every filter and
every test switches on it exhaustively, and a free-text key makes all three unwriteable. So
`roundKind: 'custom'` plus a separate `roundKindBrief` string (≤500 chars) that the generator
renders in the position the house direction would have occupied. **Never let operator text
become a key.**

**Default `produce` for the ~41 sets that exist.** Same reasoning as the ownership default in
`question-set-access.js:27-55`: this is a fact about the past, not a guess. Every set in the
library today ("Lessons Learned", "Amazon Leadership Principles", "Interview Preparation",
"Organizational Challenges") hands the room a prompt and nothing else; the room supplies the
material from its own memory. That is Produce. **Do not default to `improve`** merely because
the *generator* is improve-shaped — the generator's defect is in its instructions, not in the
sets' actual structure. No migration is required and none should be run.

**What it costs.** Two attributes instead of one, a CSV column, a validated enum in two
handlers, and a per-question control in the editor. The CSV column is the part that bites:
anything the importer does not read and the downloader does not emit is silently destroyed by
the next replace — which is S1's whole subject.

**What it forecloses.** Nothing material. It specifically does **not** foreclose the time axis
(§1's fifth axis — rounds operating on an earlier round's output), because "where did the
material come from" is orthogonal to "what do you do with it". A later `roundSource` attribute
sits beside `roundKind` and neither has to change.

---

### D2 — A copied question is independent. No link, ever.

**Decision.** Copying a question into another set writes new rows with new keys. There is no
shared identity, no back-reference used for anything, and no propagation. The UI says so at
the moment of copying: *"These become copies. Editing them here will not change the original."*

The brief marks this as an opinion and asks me to test it. I tested it and it is stronger than
the brief states — there are **three** independent reasons, and any one of them is sufficient.

**1. Shared identity destroys the Groups insurance.** Questions live at `PK=SET#<id>#v<n>`,
`SK=QUESTION#<cat>#<nnn>`. A shared question would need its own partition and its own owner,
and then `canManageSet(event, setItem)` (`question-set-access.js:123-126`) is no longer the
single funnel — you need a `canManageQuestion` beside it. The brief's own §5.5 names that
funnel as the cheap insurance that makes Groups a one-place change later. Shared identity
spends it.

**2. Versions make it unimplementable at a reasonable price.** A set's questions are
snapshotted per version and games **pin** a version (`set-version.js:104-129`). A linked
question would have to be either (a) outside the version system — so editing it silently
changes what an already-played, pinned game reads, destroying the exact history
`findGamesPinnedToVersion` (`:242-273`) exists to protect; or (b) versioned itself, so a set
version pins a question version. That is a second versioning system. Both are far outside
"not a major uplift".

**3. The write path cannot carry a link.** Per §0, the only question writer is a whole-CSV
replace. A CSV row's identity is `Category` plus position. A link would need a stable id column
surviving a hand-edit in Excel, and it would not survive.

**What it costs, stated plainly.** No propagation. A question that lives in four sets is fixed
four times. That is a real loss and the copy dialog should not pretend otherwise.

**The cheap mitigation, and it is worth taking: record provenance, not identity.** Stamp
`SourceSetId` and `SourceQuestionSk` on a copied row. **Write-once. Never read for a permission
decision. Never used to propagate anything.** It answers "where did this come from" in the
library, and it is the only data a future "six sets contain a variant of this" feature would
need. It is two strings and it commits to nothing.

**What it forecloses.** A genuine shared-question library where one edit updates every
consumer. That is a different product. Part 7.

---

### D3 — A version is a content snapshot a game can pin to. Metadata edits do not version, and Save batches.

**Decision, in four parts.**

1. **Question changes version; metadata changes do not.** `edit-question-set.js` writes
   `name`, `description`, `customInstruction`, `aiContextInstruction`, `promptId`, `roundNoun`,
   `personaId`, `engagementType` in place (`:38-45`, `:113-167`) with no history, and that is
   correct. A version is what a game's `QuestionSetVersion` points at, and it points at a
   *content* partition. Renaming a set must not manufacture one.
2. **The editor holds a working copy; Save is one replace is one version.** This is the answer
   to "every save creating a version could produce dozens per session". You do not throttle
   versions, you batch edits. Open a set, add/refine/delete freely in memory, press Save once.
3. **Populate `versions[].note`.** The field already exists (`set-version.js:71-81`) and is
   seeded on the legacy snapshot (`upload-questions.js:549`) — and nothing writes it on an
   ordinary replace, so every version in the list reads identically. Write what happened:
   *"3 added, 1 refined by AI, 2 deleted"*. A version list you cannot tell apart is not a
   rollback affordance.
4. **What a version is *for* here: both, and they do not conflict.** Pinning protects a game in
   progress; rollback is `POST .../versions/{n}/promote`, which already exists
   (`promote-set-version.js`) and needs no restore. Add no retention policy and no auto-delete.
   `findGamesPinnedToVersion` exists because deleting a version breaks history, and that
   warning path is already built and already interpreted on the frontend
   (`utils/questionSetEditing.js:258`).

**What it costs.** The editor now holds unsaved state, so it needs a dirty indicator, a
discard path, and a guard on navigating away. That is real UI work and it is priced into S4.

**What it forecloses.** Per-question undo. You roll back a whole version, which is what the
machinery does.

**The gap this opens, and it must close in the same programme.** `upload-questions.js`'s
replace branch checks ownership (`:144`). **`delete-set-version.js`, `promote-set-version.js`,
`get-set-versions.js`, `download-question-set.js`, `toggle-question-set.js` and
`toggle-quickstart.js` do not** — they are admins-only purely because `auth/authorizer.js:142`
prefixes on `admin`. Making versions part of ordinary editing makes those host-facing
immediately. Each needs `requireSetManager` **and** an exact entry in `HOST_ADMIN_ROUTES`
(`authorizer.js:115-127`, whose own comment explains why it is exact and not a prefix). Adding
the route without the handler check is the hole; adding the check without the route is a 403 a
host cannot explain. **S5.**

---

### D4 — Archive is scoped out. Ship version delete and promote; raise the archive service separately.

**Decision.** Do not build "archive the previous version before editing this one". Offer
version **delete** with the consequence warnings that already exist, and version **promote** as
the go-back path. Raise the archive service as its own piece of work.

**Why, with a fact the brief did not have.** The brief frames this as a client problem —
`ArchivePanel.jsx` hardcodes `https://archive.seibtribe.us` six times (`:76, :142, :170, :195,
:233, :271`) with plain `fetch` and no auth. That is true, and moving it server-side does not
help, because **the server-side path is already there and is equally anonymous**:
`lambda-functions/admin/export-to-archive.js:154` POSTs to `${ARCHIVE_SERVICE_URL}/archive/items`
with `headers: { 'Content-Type': 'application/json' }` and no credential of any kind, from an
authorised admin route. The service accepts anonymous writes whoever calls it, and its CORS
advertises DELETE with `Origin: *`.

So the choice is not "browser or lambda". It is: does "archive it first" write the only
remaining copy of a host's content into a store any unauthenticated caller can read and delete?
Making a deletion *feel* reversible by putting the survivor somewhere world-writable is worse
than not offering it.

**What ships instead, and it covers most of the owner's intent.** Version delete already
answers with what breaks (`delete-set-version.js` → `interpretVersionDelete`), and promote
already restores a previous version without leaving the pipeline. The UI should say plainly
that a deleted version is gone.

**What it costs.** The owner's *"be asked whether to archive the previous version"* is not
delivered. Named in Part 8 as an owner decision, not quietly dropped.

**The separate work, specified so it can be picked up:** authenticate `archive.seibtribe.us`;
remove `DELETE` from the `Origin: *` CORS; move the base URL into configuration (six sites in
`ArchivePanel.jsx` plus the default at `export-to-archive.js:10`); and decide whether the
archive is per-tier or shared — it is currently shared across dev, test and prod, which is why
an `environment` tag is stamped at `export-to-archive.js:60`. **It needs a deploy outside this
pipeline**, which is why it cannot ride along.

---

### D5 — Groups: change nothing, and enforce the funnel with a test instead of a convention.

**Decision.** Do not model groups. Do not model an owner as a person. And make "every
permission check funnels through `canManageSet`" a thing the suite *rejects a violation of*,
rather than a thing a comment asks for.

Four concrete rules for every builder on this programme:

1. **No new handler reads `createdBy` directly.** It calls `requireSetManager(event, setItem,
   verb)` and nothing else. Today exactly four handlers use the module —
   `edit-question-set.js:104`, `delete-question-set.js:76`, `upload-questions.js:144`,
   `get-question-sets.js:68` — and only the last reads `setOwnerId` directly, for the
   admin-only `createdBy` *projection* (`:75`). A projection is not a decision; that read is
   legitimate and is the only one.
2. **Add the assertion.** `tests/question-set-ownership.js` grows a source check that no file
   under `lambda-functions/admin/` compares `createdBy` outside
   `shared/question-set-access.js`. Strip comments before asserting — a source assertion in
   this repo has already passed on a comment once (RESUME, Landmines).
3. **The client never computes ownership.** The library's "mine" facet reads the server's
   `mine` boolean (`get-question-sets.js:73`), never `createdBy === myId` in the browser. There
   is no such comparison in `src/` today and there must not be one; `HostQuestionSetsDialog.jsx`
   already filters on the server's `canManage` and its header comment explains why.
4. **D2's provenance fields are not ownership.** A copied question belongs to the set it now
   lives in. That is what keeps groups a one-function change: when an owner becomes a group,
   `isSetOwner` (`question-set-access.js:112-116`) becomes `ownerIncludesCaller` and nothing
   else moves.

**What it costs.** Near zero — one test and a discipline.
**What it forecloses.** Nothing. Per-question ownership is already foreclosed by D2.

---

### D6 — Pasted source documents: request-only now; stored at `PK='SETSOURCES'` later; never a `ttl`.

Not one of the five, but it is a data-model question and the build order depends on it.

**What already exists.** `FileUploadPrompt.jsx` → `POST /admin/parse-document` (authorised,
`template-clean.yaml:1364-1385`) handles `.txt/.md/.pdf/.docx` and returns cleaned text capped
at 50,000 characters (`parse-document.js:144-147`). `AIScenarioBuilder.jsx:967-976` appends the
result onto `scenarioConfig.customPrompt`. So "a document becomes the source material for
generated questions" **works today, request-only**, for call-and-answer, trivia, poll, survey
and wavelength. The owner may not know this.

**Why it eventually has to be stored.** Apply *is* "here is somebody else's material". If the
text only ever exists inside one request, an Apply set has no record of what it was applying —
regeneration cannot reuse it and the summary cannot refer to it.

**Decision.** Slice S2 keeps it request-only (zero cost, already works). Slice S8 stores it at
**`PK='SETSOURCES'`, `SK='SET#<setId>#<nnn>'`** carrying `{ name, text, chars, addedAt,
addedBy }`.

**Not** at `PK='SET#<setId>'`, and this is the trap worth naming: `copyPartition` queries a
partition with **no SK prefix** (`set-version.js:221-227`, calling `queryPartition` at `:160`
with `skPrefix` undefined), so any non-question row sitting in the legacy content partition
gets copied into `#v1` on the set's first replace. That function is byte-identical across three
lambda bundles (`set-version.js:31-37`), so changing it is three edits and a regression risk.
Using a separate partition needs no change to it at all.

One row per source, not an array: a DynamoDB item caps at 400KB and `cleanText` allows 50,000
characters, so one source fits comfortably and three do not.

**No `ttl` attribute. Ever.** `docs/02-data-model.md` reserves `ttl` for session data, the
table's TTL is table-wide, and RESUME's Landmines records prompts and personas silently
vanishing a year later from exactly this mistake.

**What it costs: retention and confidentiality.** Sources are pasted by hosts, may be
internal, and are readable by every admin. Say so at the paste box, and **ship source deletion
in the same slice as source storage** — not later.

---

## 2. The data model, exactly

### The `SETS` row — `PK='SETS'`, `SK='SET#<id>'`

| attribute | type | written by | read by | why |
|---|---|---|---|---|
| `roundKind` | enum, 5 values | `upload-questions.js` on create; `edit-question-set.js` | generator, library facet, question inherit | D1. **Validated like `engagementType`, not free like `description`** — copy the branch at `edit-question-set.js:150-165`, which 400s an unknown value. Every prompt branch switches on it; a typo must not silently become a new kind. |
| `roundKindBrief` | string ≤500 | same | the generator, only when `roundKind === 'custom'` | D1's escape hatch, kept out of the key |
| `sourceCount` | number | the source writer (S8) | the editor's Sources tab | so the list does not query `SETSOURCES` per row |

`roundKindBrief` goes in `OPTIONAL_FIELDS` (`edit-question-set.js:38-45`) and gets the
clear-vs-skip semantics documented at `:126-137` for free. `roundKind` does **not** — it needs
the validated branch.

Absent `roundKind` reads as `produce` at every reader. Do not backfill.

### Question rows — `PK=SET#<id>[#v<n>]`, `SK=QUESTION#<cat>#<nnn>`

| attribute | why |
|---|---|
| `RoundKind` | D1's override. Absent/empty = inherit the set's. |
| `SourceAttribution` | Apply only — whose material this is, shown beside the artefact. Empty otherwise. |
| `SourceSetId`, `SourceQuestionSk` | D2's provenance. Write-once, never authorised against, never propagated. |

**Capitalised**, matching every other CSV-derived attribute on that row (`Title`, `Detail`,
`Category`, `Tags`, `AnswerDetails`, `School`, `Image` — `upload-questions.js:652-673`). The
readers tolerate both cases (`get-question-set-questions.js:76-90`) but the writers are
consistent and should stay so.

### CSV columns

Two new: `RoundKind`, `SourceAttribution`.

- **Read** in `upload-questions.js` beside `Tags`. Use the **exact-ish** matcher at `:343-346`,
  not a loose `includes` — the comment there records why (`includes('tag')` would also claim a
  column called "Stage").
- **Emitted** by `download-question-set.js` **only when the set actually carries them**,
  following the `hasImages` / `hasAnswerDetails` pattern at `:159-166`, so an ordinary set's
  CSV keeps its familiar shape.

### New rows

`PK='SETSOURCES'`, `SK='SET#<setId>#<nnn>'` — D6. S8 only.

### Unchanged

`activeVersion`, `versions[]`, `createdBy`, `createdByName`, every existing question attribute,
and the whole version resolution chain. **Nothing in `set-version.js` moves**, which is the
point — it is duplicated byte-identically into three bundles.

---

## 3. The generator: where "improve" is actually baked in

The brief says the prompt "carries direction like *improve* baked in". It is in **three**
places, and only the third is the one that produces the confusing set.

**1. The type catalogue is topics, and every topic is reflection-shaped.**
`AIScenarioBuilder.jsx:252-292` hardcodes six call-and-answer types: Lessons Learned,
Problem-Solving, Interview Prep, Amazon Principles, Team Building, Custom. There is no
vocabulary anywhere for *"here is a foreign artefact — land it here"*. Choosing a topic is the
only steering the operator has.

**2. The default prompt row says it in words.** `populate-generation-prompts.js:39` seeds
`gen-call-and-answer-lessons-learned` with `basePrompt: "Create scenarios based on common
workplace challenges and the lessons learned from them"`. It resolves at
`ai-generate-scenarios.js:97-124` and becomes the *first* instruction the model reads:
`buildPrompt` opens `Create ${count} scenarios. ${template.basePrompt}` (`:133`). The operator's
own text is appended after it as `"\n\nAdditional Requirements: …"` (`:137`). **The house
instruction leads and the operator's follows**, which is why typing an Apply brief into the
details box does not change the shape of what comes back.

**3. The line that actually confuses participants.** `generateCustomInstructions()`
(`AIScenarioBuilder.jsx:667-689`) builds the set-level `customInstruction` from a hardcoded map
keyed on scenario type. The importer then stamps that string onto **every question that has no
per-question instruction** (`upload-questions.js:419`), and it is shown to the participant
during ASK. For any type not in the map of six — which is *every* database prompt whose
`scenarioType` is not one of those strings, and every "something else" — it falls to:

> `'Engage thoughtfully with each scenario and share your experiences and insights.'`

So the room is told to share their own experiences even when the round handed them a passage
about somebody else's surgical checklists. **That is the reported symptom, and it is one
hardcoded object in the browser.**

### The fix: separate topic from direction

**A dropdown is not the fix; two orthogonal controls are.** Today one control carries both
"what is this about" and "what should the room do", which is precisely why an Apply-shaped
request comes back Improve-shaped. The scenario type stays as **topic**. `roundKind` is added
as **direction**. Both feed the prompt.

One new module, deliberately duplicated because Lambda bundles are per-directory
(`set-version.js:31-37` states the rule; `edit-question-set.js:8-14` follows it):
`lambda-functions/admin/shared/round-kinds.js` and `src/src/config/roundKinds.js`. It exports,
per kind, the four things everything else derives from:

| kind | picker line (the "brief definition" the owner asked for) | generator direction | participant instruction | schema effect |
|---|---|---|---|---|
| **produce** | *You hand them a prompt and nothing else. The room is the source.* | ask for invention; answerable from the room's own experience; the question must not assume an artefact | "Answer from your own experience. Be specific." | `detail` is framing; current limits fine |
| **apply** | *You hand them somebody else's material and ask where it lands here.* | `detail` MUST contain or summarise the foreign material and name its origin; the ask is the transfer **and its friction** | "The material above is not ours. Say where it would work here, and who would resist it." | `detail` **required, longer** (see below); new `sourceAttribution` |
| **improve** | *You hand them our own material and ask for a better version.* | `detail` MUST contain the actual artefact being revised; the ask is a rewrite, not a direction | "Rewrite it. Show the words, not the intent." | `detail` required, ≥100 chars |
| **judge** | *You hand them a thing and ask for a verdict, not a fix.* | ask for an evaluation against a stated criterion; **explicitly forbid** "how would you improve this" | "Give a verdict and your reason. Do not fix it." | `detail` required |
| **custom** | *Say what the round should do, in your own words.* | `roundKindBrief` verbatim, in the position the house direction would occupy | operator-supplied, **required** | as produce |

Icons for the picker, all confirmed exports of `components/Icon.jsx`: `Lightbulb`, `Handshake`,
`NotePencil`, `Ruler`, `MagicWand`.

**The length limit is a real conflict and must be fixed with the kind, not after it.**
`lengthGuidance()` (`shared/structured-generation.js:98-107`) tells the model
`detail: 2-4 sentences, 350 characters maximum` for every non-wavelength type. An Apply
question has to *carry the material*, and the exemplar set's `Detail_lesson` fields run 400–700
characters (`sets/agentic-sdlc-call-and-answer.csv`). Left alone, the length rule will fight
the Apply direction and Apply will lose, because the length block is appended last
(`ai-generate-scenarios.js:156`) and a model weights the most recent formatting instruction
most heavily — the same reasoning `personas.js:290-311` gives for its own ordering. So
`lengthGuidance` becomes kind-aware: `apply` and `improve` get a higher `detail` ceiling
(~900 characters) with the same "do not pad to reach it" closing line, which is the sentence
that makes the limits work at all (`:83-86`).

**Nothing else about the job machinery changes.** No new endpoint, no schema-breaking change,
no touch to `generation-jobs.js`.

### H1–H5 become constraints in the prompt, not aspirations in a document

`docs/superpowers/reviews/2026-08-11-agentic-sdlc-dry-run-hypothesis.md` Part 1 §A is the
target. Append them to the call-and-answer and poll generation prompt, per kind:

| | how it enters the prompt | honest status |
|---|---|---|
| **H1 divergence** | *"Two or three answers must be both defensible and incompatible. If the room would agree within thirty seconds, the round is wasted."* — the sentence `sets/agentic-sdlc-call-and-answer.md` opens with | all four kinds |
| **H3 no vendor answers** | *"No question whose best answer is a product or a tool name."* | all four kinds |
| **H4 practitioner-answerable** | *"Answerable in 2–3 sentences by someone doing the work, not only by whoever owns the process."* | all four kinds |
| **H5 breadth** | needs a **coverage** guard, which does not exist. `alreadyUsedTitles` (`ai-generate-scenarios.js:151-154`) is a *duplicate* guard. Add the other half: pass the categories already produced and ask the next chunk for one not yet used. | S3 |
| **H2 escalation** | **not addressed, and say so in the code.** `itemsPerCall` (`structured-generation.js:72-74`) is `floor((8000−600)/420) = 17` for call-and-answer, so any request over 17 is chunked, and a later chunk sees only the earlier titles — never their difficulty. A generator that cannot see what it already asked cannot escalate past it. When the whole request fits one call, add the escalation instruction; when it does not, do not claim it. | honest gap |

### Trivia is a different problem — five things, in value order

Do **not** reuse H1–H5. Trivia has a correct answer; divergence is meaningless. Put that
statement in a comment at the site where the criteria are appended, keyed on game type, so a
later edit cannot slide the divergence instruction into the trivia prompt.

1. **Typed distractors — the highest-value change and it is schema-only.** Today the entire
   guidance is one sentence: *"The wrong answers must be plausible. An option nobody would pick
   is a wasted option."* (`ai-generate-trivia.js:126`). Extend the tool schema with a
   `distractorRationale` array — one line per wrong option saying *why someone would pick it*.
   A model made to justify each wrong answer writes better wrong answers. The rationale is
   discardable: `normalizeItem` (`:133-177`) simply does not copy it onto the item, so nothing
   reaches DynamoDB and no CSV column changes.
2. **Answer-position balance.** `normalizeItem:157` falls back to `'OptionA'` for any
   unmappable answer and nothing shuffles, so the correct answer skews to A. Count the
   distribution over `produced` in the worker's post-pass; if one position holds more than 40%,
   warn through the existing `warnings[]` channel, which the review panel already renders.
3. **Difficulty is stored, shown to the summary model, and never scored.**
   `upload-questions.js:688` hardcodes `points = 10` for every trivia question and
   `websocket/message.js:409` reads `question.Item.points || 10`. The only reader of
   `difficulty` anywhere is the summary prompt variable (`game/template-variables.js:238`).
   Either score it or stop asking for it. **Owner decision** — scoring by difficulty changes
   every leaderboard the product has ever produced.
4. **Verifiability, cheaply.** Trivia's failure mode is a confidently wrong fact and nothing
   checks. `answerDetails` is already required (`ai-generate-trivia.js:90`); constrain it to
   state the fact in a form somebody could look up. Do **not** build fact-checking — Part 7.
5. **The reveal is currently destroyed by the round trip.** The trivia download branch never
   emits `AnswerDetails` at all (`download-question-set.js:115`). S1.

### Personas: two of the four kinds are unserved, and `sceptic` is a trap

The ten seed personas (`game/personas.js:43-247`) are **voice** — they govern the summary, not
the questions, and `buildOutputContract` deliberately keeps structure out of their reach
(`:10-15`). So four kinds do not need four personas. But:

| kind | covered? | by what |
|---|---|---|
| **Produce** | yes | `session-advisor` (`:223-246`) is written precisely for "the room writes and then votes" — name the split, rescue the load-bearing minority, hand out work. `gameTypes: ['call-and-answer','poll']`. |
| **Improve** | yes | `session-advisor` plus `business-advisor` (`:71-82`). |
| **Judge** | **no — and `sceptic` is the wrong answer.** | `sceptic` (`:122-133`) tells Workie *to be* the sceptic: *"take the group's answers seriously enough to test them"*. In a Judge round the **room** is the sceptic and the artefact is the target; a Workie that adds its own critique is critiquing the critics. |
| **Apply** | **no** | No persona knows there is foreign material in the room. Every existing voice will blur the source with the room's own situation, which is the one distinction an Apply summary exists to keep. |

**Specify two new seed personas** in `SEED_PERSONAS`, seeded by `scripts/seed-personas.js`
(which never overwrites without `--overwrite`, so re-seeding is safe):

- **`verdict-keeper`** — *"Reports the verdict, and where it split."* icon `Ruler`,
  `gameTypes: ['call-and-answer','poll']`. Its job is to **aggregate verdicts**: where the room
  converged, where it split, and the strongest objection nobody voted for — and explicitly
  **not** to add an opinion of its own or propose a fix.
- **`transfer-guide`** — *"Keeps their material and ours apart."* icon `Handshake`, same
  `gameTypes`. Its job: which transfers the room believed, which it rejected, and the friction
  it named — while never letting the foreign source and the room's own situation merge into one
  voice.

**Do not auto-attach.** The set's `personaId` is a *suggestion* the AI overview step proposes
and the author accepts. Resolution precedence (`personas.js:346-357`) puts the set persona
below an explicit host pick, so a host can still override in the room. Nothing in the resolver
changes.

**One constraint that silently degrades:** `icon` must be an export of
`components/Icon.jsx` — an unknown name renders a generic circle with no error
(`personas.js:226-228`). `Ruler` and `Handshake` are both present; verified.

---

## 4. The build, sliced and ordered

Each slice is independently shippable to dev and independently valuable. The order is chosen
so that the thing everything else stands on is repaired first.

| # | Slice | Kind | Backend? | Size |
|---|---|---|---|---|
| **S1** | The replace round trip stops destroying options and reveals | **bug — silent data loss** | yes | S |
| **S2** | `roundKind` end to end; the generator is steered by direction, not topic | capability + the reported bug | yes | M |
| **S3** | H1–H5 as prompt constraints; the category-coverage guard | capability | yes | S |
| **S4** | The editor's Questions table: add, refine, delete, one Save = one version | capability | no | L |
| **S5** | Host parity — ownership checks and routes for the six unguarded handlers | **bug (latent) / capability** | yes | S |
| **S6** | The question library | capability | yes | L |
| **S7** | `verdict-keeper` and `transfer-guide` | capability | yes | XS |
| **S8** | Source documents stored, with deletion | capability | yes | M |

**Why this order.** S1 is a live data-loss bug and every later slice edits questions through
the path it repairs — shipping S4 on top of it would turn a silent loss into a routine one. S2
is the thing the owner named first, it is self-contained, and a better generator changes what
the management UI has to do. S3 is small and rides S2's module. S4 is the console work and it
needs S1's contract and S2's field. S5 must land with or before S4 reaches hosts. S6 is a
separate screen with a new route and is the natural cut line. S7 and S8 are independent of
everything and can land any time after S2.

---

### S1 — The replace round trip stops destroying options and reveals

**bug, silent data loss, backend, S. Ship alone, no UI.**

`download-question-set.js` and `upload-questions.js` disagree about the CSV, in three ways, and
the disagreement is silent:

| | download emits | importer reads | result |
|---|---|---|---|
| trivia options | `WrongAnswer1,WrongAnswer2,WrongAnswer3` (`:115`), filled from `q.optionA / optionB / optionC` (`:124-126`) — `optionD` dropped entirely | `OptionA…OptionF` by exact match (`:307-312`) | **every option lost on re-import** |
| trivia reveal | not emitted at all (`:115`) | `AnswerDetails` (`:282`) | **every reveal lost** |
| poll options | `q.Options` (`:143`) — but the importer wrote the attribute as lower-case `options` (`upload-questions.js:691`) | `Options`, pipe-separated (`:315`, split at `:460`) | **column emitted empty; every option lost** |

`getColumnIndex` (`upload-questions.js:275`) is an exact case-insensitive match, and the
fallback block at `:319-346` covers nine columns — Category, Title, QuestionDetail,
AnswerDetails, Detail, School, CustomInstruction, Image, Tags — and **no option column**. There
is no rescue path.

So: **download a trivia or poll set, edit one word, upload it back as a new version, and every
question loses all of its answers.** This is the same class as the `Option1..5` defect that
made every AI-generated poll set import with zero options — that one was fixed in the emitters
(`AdminPage.jsx:667-670` carries the warning not to restore it); this is the other half of the
same contract and it is still open.

**The fix, on the download side, because the importer's format is what every hand-authored
CSV, every template (`download-template.js`) and every AI builder already uses.**
Trivia emits the header the trivia AI builder already emits — `AdminPage.jsx:575`,
`Category,Question#,Title,QuestionDetail,AnswerDetails,School,OptionA,OptionB,OptionC,OptionD,OptionE,OptionF,CorrectAnswer,Difficulty,Tags`
— plus `CustomInstruction`, which the importer reads (`:285`) and the builder's header omits.
Poll reads `q.options` as well as `q.Options`. Both keep the conditional-column pattern at
`:159-166`.

The poll emitter next door already carries the warning not to undo the sibling half of this
contract (`AdminPage.jsx:667-670`: *"Do not 'restore' the numbered columns"*). The download
fix deserves the same comment, pointing back at this slice.

**Verified by.** New `tests/question-set-roundtrip.js`: feed `download-question-set`'s CSV
straight into `upload-questions`'s parser in-process, with DynamoDB intercepted, and assert
every option, the correct answer id, the reveal, the difficulty and the tags come back
unchanged for trivia, poll and call-and-answer. `// rejects:` a return to `WrongAnswer*`, and
a poll download that reads only the capitalised `Options`. Then re-run
`scripts/install-question-set.js <table> <downloaded.csv> --type trivia` — its dry run parses
for real with no AWS credentials and reports skipped rows.

---

### S2 — `roundKind` end to end, and a generator steered by direction

**capability + the reported bug, backend and frontend, M.**

Backend:
- new `lambda-functions/admin/shared/round-kinds.js` (the table in Part 3), duplicated to
  `src/src/config/roundKinds.js`
- `edit-question-set.js` — `roundKind` validated like `engagementType` (`:150-165`);
  `roundKindBrief` added to `OPTIONAL_FIELDS` (`:38-45`)
- `upload-questions.js` — accept both on create (beside the other `customX` payload fields);
  read the `RoundKind` and `SourceAttribution` columns using the exact-ish matcher at `:343-346`
- `download-question-set.js` — emit both when present, conditional-column style
- `get-question-sets.js` — project `roundKind`, `roundKindBrief`
- `ai-generate-scenarios.js` `buildPrompt` (`:128-160`) — the kind's direction goes **in front
  of** `template.basePrompt`, since `:133` puts `basePrompt` first today and first is what the
  model follows. For `custom`, `roundKindBrief` replaces the house direction.
- `ai-generate-questions.js` `buildPrompt` (`:130-171`) — same, for the bulk and refine paths
- `shared/structured-generation.js` `lengthGuidance` (`:87-107`) — kind-aware `detail` ceiling

Frontend:
- `AIScenarioBuilder.jsx` — a kind picker with the one-line definitions and the `custom`
  free-text box, above the existing type cards
- **`generateCustomInstructions()` (`:667-689`) is derived from the kind, not from the scenario
  type.** This is the line that produces the confusing set.

**Verified by.** `tests/scenario-generation-job.js` grows: the rendered prompt for `apply`
contains the Apply direction and does **not** contain "lessons learned"; `custom` renders
`roundKindBrief` verbatim; an unknown kind is rejected with 400 by `edit-question-set`.
Frontend: `roundKinds.test.js` (pure, no rendering) and `aiScenarioBuilderKind.test.jsx`
asserting the participant instruction changes when the kind changes and stays put when only the
topic changes. `// rejects:` re-keying the instruction map on scenario type.

---

### S3 — H1–H5 as constraints, and the coverage guard

**capability, backend, S.**

Append the criteria per kind (Part 3's table). Add the coverage half to the chunk loop
(`ai-generate-scenarios.js:239-...`): the loop already passes `alreadyUsedTitles`; pass the
categories produced so far too, and ask the next chunk for one not yet used. Write the H2 note
into the code at the site where the escalation instruction is conditionally added, with the
`itemsPerCall` arithmetic, so the next reader does not "fix" it by adding a claim the machinery
cannot keep.

**Verified by.** `tests/scenario-generation-job.js` — a two-chunk request's second prompt names
the first chunk's categories; a one-chunk request carries the escalation line and a two-chunk
request does not. `// rejects:` deleting the coverage list while keeping the duplicate list.

---

### S4 — The editor's Questions table

**capability, frontend, L. The largest item that is not the library.**

`QuestionSetEditor.jsx`'s Questions panel is download-and-replace-a-file only today
(`:275-310`). Give it a **working copy**: load from `GET /question-sets/{setId}/questions`,
edit in memory, and **Save** performs one `replaceSetId` upload — one version, with
`versions[].note` populated per D3.

- **Refine one question** reuses `POST /admin/ai-generate-questions` with `existingQuestion`.
  That path already exists and already returns exactly one item whatever was asked
  (`ai-generate-questions.js:27-42`), and its prompt already says "Improve the following …
  based on the user's feedback" (`:135`) — which is correct *here*, because refining is
  genuinely an improve operation on our own draft. Do not confuse it with the `improve`
  round kind.
- **Delete a question** and **add a question** are array operations on the working copy.
- **Per-question `RoundKind`** control lands here (D1's override).

**Two constraints the builder must not trip on, both verified:**

1. **`GET /question-sets/{setId}/questions` is unauthenticated.** There is no `Auth:` block on
   the event (`template-clean.yaml:416-422`), the API sets no `DefaultAuthorizer` on purpose
   (`:359-363`), and two callers use bare `fetch` — `GameHostPage.jsx:2209` and
   `RemoteQuestionBrowser.jsx:49`. **Do not attach the authorizer as part of this slice.** That
   is exactly the shape of the trap in `RESUME.md` §2, and it would 401 the host's question
   browser and the phone remote. Read it as it is; the *write* path is where
   `requireSetManager` lives, and that is where the permission belongs. (It is also worth
   raising separately: that route serves `correctAnswer` and `answerDetails` to anyone. Part 9.)
2. **It is a single un-paginated `QueryCommand`** (`:66`) — one 1MB page. A 100-question set is
   nowhere near the cap, so this is fine for the editor. It is **not** fine as the basis for a
   library (S6).

Also worth knowing before wiring the table: that endpoint sorts by `sortOrder` then title
(`:109-114`), and **no writer sets `sortOrder`** — `upload-questions.js` writes
`OrderInCategory` and `QuestionNumber` (`:669-671`). So it is 0 for every row and questions come
back alphabetically, not in set order. Sort on `QuestionNumber` in the table.

**Verified by.** `questionSetEditorQuestions.test.jsx`, following the `SessionsPanel` recipe
(mock exactly `authFetch` and `useAuth`, a `mockApi` router that throws on an unmatched URL, an
async `mount()`): deleting two questions and saving issues exactly one POST carrying
`replaceSetId` and a CSV two rows shorter; a 500 leaves the working copy intact and the set
list unchanged; the Save button is disabled while in flight and while nothing is dirty.
`// rejects:` a save that fires per edit, and a save that sends the whole form rather than a
replace.

---

### S5 — Host parity on the six unguarded handlers

**latent bug / capability, backend, S. Must land with or before S4 reaches hosts.**

| handler | today |
|---|---|
| `delete-set-version.js` | no ownership check |
| `promote-set-version.js` | no ownership check |
| `get-set-versions.js` | no ownership check |
| `download-question-set.js` | no ownership check |
| `toggle-question-set.js` | no ownership check |
| `toggle-quickstart.js` | no ownership check |

All six are admins-only purely because `auth/authorizer.js:142` prefixes on `admin`. Each gains
`requireSetManager(event, setItem, verb)` after reading its SETS row, **and** an exact
`"METHOD path"` entry in `HOST_ADMIN_ROUTES` (`:115-127`).

`toggle-quickstart` is arguably admin-only curation rather than ownership — the Quickstart
badge decides what appears on the room's front page. **Flag it to the owner** (Part 8) and, if
in doubt, add the ownership check but leave it out of `HOST_ADMIN_ROUTES`; the check is
harmless for an admin and the route entry is the part that grants access.

**Verified by.** `tests/question-set-ownership.js` grows three cases per route — host + own set
→ 200, host + another's set → 403, admin + any set → 200 — driven with hand-made events copied
from the shape `auth/authorizer.js:171-182` actually emits (`.authorizer.lambda`, groups
comma-joined into a **string**). Not `.jwt.claims`; eighteen tests once passed against that
non-existent shape. Plus D5's funnel source assertion. `// rejects:` a prefix match sneaking
into `HOST_ADMIN_ROUTES`, which would open the version DELETE.

---

### S6 — The question library

**capability, frontend + one backend route, L. This is the cut line.**

A different screen with a different primary object: the question, not the set. Treat it as
such, per the brief's §7.3.

**It needs a route that does not exist**, and this is the part to be honest about. The table
has **no GSIs anywhere** (`template-clean.yaml:88-108`), so there is no index to answer
"every question of category X across all sets". The only mechanism is a bounded fan-out: read
the `SETS` partition, then one `queryPartition` per set's resolved content partition —
`findGamesPinnedToVersion` (`set-version.js:242-273`) is the existing precedent for exactly
this shape. `GET /admin/questions?type=&category=&kind=&q=` with a hard cap, real pagination,
and a response field saying how many sets were read, so the screen never claims completeness it
does not have.

**Search is substring matching over what was read**, not search. Say so. A real search needs an
index this table does not have and should not grow for this.

**The two group actions are both D2 copies:**
- *Make a subset set* — build a CSV from the selection, `POST /admin/upload-questions` with no
  `replaceSetId`. New set, new owner (`ownerStamp`, `:599`), independent rows.
- *Add to an existing set* — `GET` that set's questions, concatenate, `POST` with
  `replaceSetId: <target>`. One replace, one version, and `requireSetManager` refuses a target
  the caller does not own **in the handler** (`:144`), which is what makes the whole feature
  safe regardless of what the picker rendered.

Stamp `SourceSetId` / `SourceQuestionSk` on the copies. Say "these become copies" in the dialog.

**Verified by.** `questionLibrary.test.jsx` — filtering by category and kind narrows the list
without a refetch; selecting three and choosing "add to set" issues exactly one GET of the
target and one POST carrying six rows when the target had three; a target the caller cannot
manage is not offered, **and** a hand-made request for it 403s in `tests/question-set-ownership.js`.

---

### S7 — `verdict-keeper` and `transfer-guide`

**capability, backend, XS.**

Two entries in `SEED_PERSONAS` (`game/personas.js:43-247`), voices as specified in Part 3,
`gameTypes: ['call-and-answer','poll']`, icons `Ruler` and `Handshake` (both confirmed exports
of `components/Icon.jsx`). Applied with `scripts/seed-personas.js`, which never overwrites
without `--overwrite`.

**Verified by.** `tests/persona-resolution.js` — both resolve through `setPersonaId`; an
`inactive` record falls through to the next precedence level rather than dead-ending
(`personas.js:380-383`); neither changes the output contract, which is `buildOutputContract`'s
job and not a persona's (`:325-342`).

---

### S8 — Source documents, stored

**capability, backend + frontend, M.** Per D6. `PK='SETSOURCES'`, `SK='SET#<setId>#<nnn>'`.
**No `ttl`.** Deletion ships in this slice, not later. A Sources tab in the editor beside
Details / Questions / Versions / Media. `sourceCount` on the SETS row so the list does not
query per row.

**Verified by.** A backend script asserting a written source row carries **no `ttl` attribute**
— that is the assertion that matters, and it is the one this repo has been burned by twice.
Plus: adding a source and then replacing the set leaves the source rows untouched (the D6
partition choice, tested rather than assumed).

---

## 5. Sizing, and the cut order

| Slice | Backend | Frontend | Tests | Total |
|---|---|---|---|---|
| S1 | ~40 lines in one file | none | 1 new backend script | **S** — half a day |
| S2 | ~120 lines across 6 files + 1 new module | ~80 lines + 1 new module | 2 frontend, 1 backend | **M** — 2–3 days |
| S3 | ~50 lines in 2 files | none | 1 backend | **S** — half a day |
| S4 | none | ~350 lines in 1 file | 1 frontend | **L** — 3–4 days |
| S5 | ~60 lines across 7 files | none | 1 backend (extend) | **S** — 1 day |
| S6 | 1 new handler + 1 route | ~400 lines, new screen | 1 frontend, 1 backend | **L** — 4–5 days |
| S7 | ~30 lines in 1 file | none | 1 backend (extend) | **XS** — an hour |
| S8 | 2 new handlers + 2 routes | ~150 lines | 1 backend | **M** — 2 days |

**If the programme must shrink, cut in this order:** S6, then S8, then S4's per-question
`RoundKind` control (keep the set-level one), then S3's coverage guard.

**S1, S2 and S5 are the floor.** Below that: the editor keeps destroying answers, the generator
keeps writing the wrong shape, and hosts get an editing feature whose routes refuse them.

---

## 6. Baselines to hold

Measured at `148ea278` and carried forward by the brief. Nothing in this plan changes them and
every slice must leave them where they are.

| | |
|---|---|
| Backend | `for t in tests/*.js; do node "$t"; done` → **40 suites / 1343 passed / 0 failed** |
| Frontend | `cd src && CI=true npx jest __tests__/` → **5 failed suites / 31 failed / 1629 passed** — `AdminPage`, `App`, `GameHostPage`, `PlayerPage`, `WebSocketClient`, all pre-existing |
| Build | `cd src && npm run build` compiles, 2 pre-existing size warnings |
| Template | `sam validate --lint -t template-clean.yaml` valid |

Aggregate the backend with `grep -E '^[0-9]+ passed'` and **assert the suite count** — a
crashed suite prints no result line and a bare grep reports "0 failed". Anchor the failure grep
too (`^[0-9]+ failed`); unanchored, it matches an intentional error-path fixture inside a
passing suite and invents failures. `tests/host-connection-dedup.js` is a known
order-dependent flake; ignore it.

**`AdminPage.jsx` cannot be mounted in jsdom** — `useAuth` hard-throws (`AuthContext.jsx:27-30`).
Every component in this plan renders on its own; six precedents exist. Do not "fix"
`AdminPage.test.jsx` as a side effect — that is a deliberate separate decision.

**Every test carries a `// rejects:` comment naming the implementation change it would catch,
and is watched failing before it is trusted.** If the answer is "nothing", the test is not
written. jsdom has no layout engine, so no geometric assertions.

---

## 7. What exceeds the constraint, and should be its own project

| Item | Why it exceeds "not a major uplift" |
|---|---|
| **Shared / linked questions** (D2's rejected alternative) | A third partition with its own owner and its own versioning, plus a second permission funnel. Changes the data model at its root. |
| **The archive service** | Authentication, CORS, per-tier vs shared, and a base URL in seven places. Needs a deploy outside this pipeline. **D4.** |
| **A real question search** | Substring matching over a bounded fan-out is what S6 can honestly offer. Search needs an index the table does not have; adding a GSI for it is a table-level change with its own cost and migration. |
| **The time axis** — rounds operating on an earlier round's output | Named as out of scope in the brief §1. The data model above does not foreclose it; building it is a different programme. |
| **Scoring trivia by difficulty** | `points` is hardcoded to 10 at write time and read at `websocket/message.js:409`. Changing it changes every leaderboard and every stored score's meaning. **Owner decision first.** |
| **Trivia fact-checking** | A verification pass against a source. Genuinely valuable, genuinely a project. |
| **Migrating `ai-generate-scenarios.js` onto the shared flow** | It carries a byte-for-byte inline copy of `shared/generation-handler.js`'s job flow. Nothing in S2 or S3 touches job semantics, so this plan does not force the duplication — but **any future change to job semantics is two edits**, and that is worth retiring on its own. |
| **Finishing Survey** | Unchanged from the parent plan's O1. `upload-questions.js:159-176` rejects survey uploads outright, on a three-way gate — `engagementType === 'survey'`, a `.json` filename, or content starting with `[`/`{`. |
| **A per-question write API** | See §0. It would be a second writer racing the version system. Do not build it. |

---

## 8. What needs an owner decision, not an implementation

1. **Archive.** Accept D4 (scoped out; version delete and promote instead), or fund the
   archive-service work as its own project. Nothing else in this plan is blocked either way.
2. **Trivia difficulty.** Score it or stop asking for it. It is currently stored on all 100
   questions of the 80s set, shown to the summary model, and worth nothing.
3. **Does the kind picker sit above the topic cards, or replace them?** My recommendation is
   **above** — topic and direction are genuinely different questions and conflating them is the
   defect. The cost is that step 1 of the builder becomes two controls instead of one.
4. **Default kind for the ~41 existing sets is `produce`, with no migration.** Confirm. The
   reasoning is in D1 and it mirrors the ownership default that has already proved out.
5. **Should hosts get the `custom` free-text direction, or admins only?** Operator text is
   rendered into a generation prompt. The blast radius is bounded — the output is a tool-call
   schema, not free prose — but it is still text from a less-trusted role steering a model.
   Default recommendation: allow it; it is the same trust level as the "Additional
   Requirements" box hosts can already reach.
6. **`toggle-quickstart`** — is the Quickstart badge a host's to set on their own set, or admin
   curation of the room's front page? S5 needs the answer.
7. **Survey**, still open from the parent plan's O1. Unchanged.

---

## 9. Found in passing, not in this plan

- **`GET /question-sets/{setId}/questions` is unauthenticated** and serves `correctAnswer` and
  `answerDetails` for every question of every set in the environment
  (`template-clean.yaml:416-422`, no `Auth:` block; no `DefaultAuthorizer` on the API at
  `:359-363`). Two callers use bare `fetch` (`GameHostPage.jsx:2209`,
  `RemoteQuestionBrowser.jsx:49`), so closing it is the same two-commit, frontend-first shape as
  `RESUME.md` §2's `GET /games`. Raised, not fixed here — S4 explicitly does not touch it.
- **`export-to-archive.js` has no ownership check.** Admin-only today by prefix, so it is not a
  live hole, but it is a seventh member of S5's list the moment anything opens it to hosts.
- **`sortOrder` is read and never written.** `get-question-set-questions.js:109-114` sorts on
  it; no writer sets it. Every question has `sortOrder: 0`, so the host's question browser and
  the phone remote list questions **alphabetically**, not in set order.
- **`install-ai-prompt.js` builds a DynamoDB client before it parses**, so its dry run dies on
  "Region is missing" having validated nothing — the same defect `install-question-set.js` was
  repaired for. Still unfixed. Small.
- **Two prompts claim `isDefault` for every game type** and only poll resolves in favour of
  `sets/`. `scripts/cull-ai-prompts.js` exists. Unchanged from the parent plan.
- `default-ai-prompts.json` ships **19** templates under four game-type keys — 8
  call-and-answer, 4 trivia, 4 wavelength, 3 poll — and they are **summary** prompts. The
  **generation** prompts are a separate family seeded by `populate-generation-prompts.js` at
  `SK=AIPROMPT#gen-<gameType>-<scenarioType>`. Two people have now confused the two families;
  worth a line in whichever doc a third person reads first.
