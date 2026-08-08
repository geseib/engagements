# Question-Set Content Audit

Audit of every CSV in `sets/` (the two `.pdf` source documents are ignored). Companion to
`engage-refresh-handoff.md` item 9, "prompt-content quality".

Cleaned versions of the sets worth keeping are in **`sets/cleaned/`**, same filenames.
Originals are untouched.

---

## What the columns actually do

Confirmed against `lambda-functions/admin/upload-questions.js` (parser at lines 35-94, column
mapping at 119-230) and the two render sites:

| Column | Where it lands | Reality check |
|---|---|---|
| `Category` | `.field-badge` pill above the question, and the host's category filter | Must be a *grouping*, not a subtitle |
| `Title` | `.lesson-title`, 1.8rem, the thing on the projector | Anything over ~60 chars wraps badly |
| `Detail_lesson` | `.lesson-detail` body copy | Read on a phone, not the wall |
| `School` | `PlayerPage.jsx:1588` → `.school-name`, 14px grey italic, directly under the badge | **A visible attribution line.** Whatever is in here is shown to every player, every question |
| `CustomInstruction` | `PlayerPage.jsx:1650` → bold text immediately above the answer box | The single biggest lever. This is the brief the player answers against |
| `Image` | `.artwork-image` | Art Title rounds only |

The `School` misnomer is worse than it looks: because it renders on *every* question, a set with
`School of Decision Making` on all 160 rows puts a meaningless grey italic line on the screen 160
times. In `subject-specific-scenarios` it is worse still — that column holds the **answers**.

## Three files do not parse at all

Verified with a Node script that replicates `parseCSV()` from `upload-questions.js` byte for byte:

- **`greatest-hits.csv`** — rows 3-10 have 5 columns where the header declares 6. The trailing
  `CustomInstruction` field is simply absent. It imports, but 9 of 10 questions silently get no
  instruction.
- **`sample-trivia-tech-culture.csv`** — header is `Category,Question,OptionA,…`. There is no
  `Title` column and the `title` fallback (`h.includes('title')`) finds nothing, so the upload is
  rejected outright: *"Missing required columns: Title"*.
- **`trivia-template.csv`** — same defect, same rejection. This file has never been importable.

---

## Verdicts

| Set | Rows | Verdict | Why |
|---|---:|---|---|
| `amazon_all_leadership_scenarios.csv` | 160 | **CLEAN** ✅ | Best content in the repo. Blanked 160 `School of …` lines, added 160 instructions |
| `lessons.csv` | 80 | **CLEAN** ✅ | Strong cross-discipline material. `School` repurposed to the actual thinker cited; 5 shaky attributions removed |
| `Interview-Preparation-scenarios-…csv` | 20 | **CLEAN** ✅ | Deliberately mixes strong and terrible answers — a genuinely good "score this candidate" format that was undersold by generic instructions |
| `famous-art-titles.csv` | 10 | **CLEAN** ✅ | Already the model for correct `School` use. Only defect: all 10 instructions blank |
| `organizational-challenges.csv` | 10 | **CLEAN** ✅ | Serious senior-leadership prompts; titles and body were far too long, no instruction column existed |
| `greatest-hits.csv` | 10 | **CLEAN** ✅ | Good debate spine, ragged CSV, invented `School of …` values, one wrong instruction |
| `developer-advocacy-development-teams.csv` | 20 | **CLEAN (converted)** ✅ | Good engineering prompts wearing a trivia costume — see note below |
| `developer-advocacy-product-teams.csv` | 20 | **CLEAN (converted)** ✅ | Same |
| `sample-trivia-tech-culture.csv` | 32→29 | **CLEAN** ✅ | Broken header rebuilt; 3 questions dropped as wrong or unanswerable |
| `trivia-AWS___Constant_Work-…csv` | 10→6 | **CLEAN** ✅ | Factually sound, but 5 concepts asked twice each |
| `custom-scenarios-1753697732416.csv` | 5 | **CLEAN** ✅ | Quietly the best-written small set; only needed `School` blanked and `Question#` fixed |
| `call-and-answer-workbackwards4step.csv` | 4 | **CLEAN** ✅ | Good workshop spine, three real bugs |
| `template-callandanswer.csv` | 5 | **CLEAN** ✅ | It is a template; people copy its defects |
| `wavelength-sample-questions.csv` | 5 | **CLEAN** ✅ | Literal `**markdown**` in the body, junk `School`, one instruction copy-pasted five times |
| `template-trivia.csv` | 10 | **CLEAN** ✅ | One unanswerable question; `CorrectAnswer` normalised |
| `template-pbod.csv` | 15 | **KEEP AS-IS** ⚠️ | Good content, but its `QuestionType`/`Slider*` columns are not read by the importer. Blocked on product, not content |
| `subject-specific-scenarios-1752962941485.csv` | 40 | **RETIRE** ❌ | Answers stored in `School`; at least four factually wrong |
| `trivia-80s_Music_Trivia_101-…csv` | 20 | **RETIRE** ❌ | Same question asked 4×; two answers marked wrong; self-contradictory |
| `trivia-80s_music_trivia-…csv` | 30 | **RETIRE** ❌ | 27 distinct `School` values for 30 rows; "totally tubular" voice |
| `trivia-History-1753021557014.csv` | 20 | **RETIRE** ❌ | Several fabricated or debunked "facts" — detail below |
| `lists-favorites-scenarios-…csv` | 20 | **RETIRE** ❌ | 20 rows are really 5 questions pasted four times each |
| `trivia-template.csv` | 8 | **RETIRE** ❌ | Unimportable duplicate of `template-trivia.csv` |
| `amazon-leadership-call-and-answer.csv` | 29 | **RETIRE** ❌ | Truncated 29-row subset of the 160-row set |
| `amazon-leadership-call-and-answer-fixed.csv` | 29 | **RETIRE** ❌ | Same subset again |
| `amazon_all_leadership_scenarios-converted.csv` | 29 | **RETIRE** ❌ | Same subset a third time |
| `lessons-call-and-answer.csv` | 9 | **RETIRE** ❌ | Architecture-only slice of `lessons.csv` |
| `lessons-call-and-answer-fixed.csv` | 9 | **RETIRE** ❌ | Same slice |
| `lessons-converted.csv` | 9 | **RETIRE** ❌ | Same slice |
| `sample-trivia-tech-culture-converted.csv` | 4 | **RETIRE** ❌ | First 4 rows of another set |
| `newquestionsettemplate.csv` | 2 | **RETIRE** ❌ | Third redundant call-and-answer template, and the worse one |

**15 cleaned · 2 kept as-is · 14 retired.**

### A note on the header

Nine of the cleaned files needed a `CustomInstruction` column that the original did not have
(`amazon_all_leadership_scenarios`, `lessons`, `organizational-challenges`, both
`developer-advocacy` sets) or a `Title` column the importer requires
(`sample-trivia-tech-culture`). Those files were normalised to the canonical schema —
`Category,Question#,Title,Detail_lesson,School,CustomInstruction` for call-and-answer, and the
repo's working trivia shape for trivia. Every other cleaned file keeps its original header and
column order byte for byte. This is called out because it is the one place the cleaning brief's
"preserve the exact header" and "write a CustomInstruction per question" could not both hold.

---

## Per-set notes

### `amazon_all_leadership_scenarios.csv` — CLEAN (160 rows)

The strongest asset here. 16 Leadership Principles × 10 prompts, titles already short and
projector-safe, `Detail_lesson` already a single well-formed question.

- **School:** all 160 rows carried an invented `School of Decision Making` / `School of Action
  Orientation` / `School of Corporate Responsibility` label. Nothing to attribute → all blanked.
- **Category:** genuinely good. The 16 LP names are exactly what a host wants to filter by. Left alone.
- **CustomInstruction:** did not exist. 160 written. They are deliberately not variations on one
  template — each names the specific evidence that separates a real answer from a rehearsed one.
  *"Name one data source your team trusts and one it has learned not to. The useful part is how you
  tell them apart."* / *"Say who held the final call and how that was agreed before the work started.
  Most cross-functional failures are decision-rights failures."*
- **Left alone:** titles and prompts. Both are already right.
- **Audience note:** this set names Amazon and Bezos in ten places (`Customer Obsession`). Fine for
  an Amazon-adjacent room, slightly evangelical for a mixed one. Not changed — it is the set's
  premise — but worth knowing before you pick it.

### `lessons.csv` — CLEAN (80 rows)

Eight disciplines × 10 transferable principles. The best structural idea in the collection.

- **School:** the original repeated the category (`Architecture` → `School of Architecture`) — pure
  noise. Repurposed as a real attribution: `Christopher Alexander`, `Jane Jacobs`, `Daniel Kahneman`,
  `Amy Edmondson`, `Walter Murch`, `Ferran Adrià`. 44 of 80 rows now carry a name; the other 36 are
  blank because the lesson comes from a tradition rather than a person, and inventing a name would
  be exactly the failure mode this audit is about.
- **Five attributions removed as unverified**, with the surrounding text rewritten so the principle
  survives: *Julia Morgan* on adaptive reuse (not her signature), *Justice Brandeis* on burden of
  proof, *Paul Rand* on constraints (replaced with Charles Eames, who demonstrably said it),
  *Susan Kare* on accessibility (replaced with the curb-cut effect), and the Deming entry, which had
  Deming's system-optimisation point welded to Goldratt's bottleneck point.
- **CustomInstruction:** did not exist — which meant the set had no ask at all. 80 written, each one
  an application of that specific lesson: *"Impose one artificial limit on a problem you are working
  on — half the budget, half the features, half the time — and say what it forces."*
- **Left alone:** the 80 `Detail_lesson` bodies. They run 45-60 words, which is long for a
  projector but correct for a phone. If big-screen mode ever renders them, trim there rather than
  in the data.
- **Psychology block is the strongest** (Miller, Kahneman, Cialdini, Dweck, Edmondson, Wason, Deci,
  Tversky, Fogg, Loewenstein — all correctly attributed). **Law block is the weakest**: ten real
  doctrines, no attributable source, and it reads US-specific in places ("constitutional due
  process"). Kept, but it is the block to cut first if the set needs shortening for a non-US room.

### `Interview-Preparation-scenarios-…csv` — CLEAN (20 rows)

Badly undersold by its own metadata. The `Detail_lesson` holds multi-turn interview transcripts,
and — this is the good part — **ten of them are deliberately bad answers**. Row 11's candidate says
*"I just told them to work faster… some people just aren't cut out for the job."* Row 19's says
*"I heard Kubernetes is popular so I watched some YouTube videos."* Rows 14, 16 and 18 open strong
and collapse on the follow-up. That contrast is a real facilitation asset.

- **School:** 15 rows said `Professional Development`, five said things like `Technical Problem
  Solving`. Meaningless either way → blanked.
- **Category:** the 7 LP names are right; fixed the `Learn and be Curious` / `Learn and Be Curious`
  split that was fragmenting one category into two in the host filter.
- **Title:** every title was the full interview question, 60-95 characters, guaranteed to wrap. All
  20 rewritten as short screen headers that also distinguish the near-duplicates —
  `WE JUST GOT IT DONE` versus `SIX WEEKS, TWO MILLION USERS` for the two "tight constraints" rows.
- **CustomInstruction:** the originals were evaluator-facing but generic (*"Evaluate coaching
  approach and measurable outcomes"*). Rewritten to point at what is actually wrong or right in
  *that* transcript: *"The opening claim is strong and the follow-ups collapse. Quote the exact line
  where the answer stops being credible."*
- **Not deduplicated.** Rows 1/4, 7/8, 14/15 and 18/19 look redundant by title but are strong/weak
  pairs. That is the design.

### `famous-art-titles.csv` — CLEAN (10 rows)

The reference implementation for `School` done right (`Leonardo da Vinci, c. 1503`) and the only set
using `Image`. Category = art movement, which is a real grouping.

Sole defect: **all ten `CustomInstruction` fields were empty**, so players saw an artwork and a
poetic decoy title with no ask. Ten written, each anchored to something in that specific painting —
*"There are three boats in this picture, and a mountain. Write a title that admits at least one of
them exists."* / *"Title it without using the words gold or love. That constraint forces you to look
at what the two figures are actually doing."*

Titles, attributions, blank details and image URLs all left exactly as they were.

### `organizational-challenges.csv` — CLEAN (10 rows)

Real senior-leadership material, delivered badly.

- **Titles** were up to 55 characters of consultancy noun-stack
  (`PORTFOLIO PRIORITIZATION IN RESOURCE-CONSTRAINED ENVIRONMENTS`). Rewritten as plain English
  (`SAYING NO TO GOOD IDEAS`, `THE ORGANIZATION'S IMMUNE SYSTEM`, `WHEN NOBODY OWNS THE OUTCOME`).
- **Bodies** ran 70-95 words each and ended in a question that duplicated what the instruction should
  say. Cut to two sentences of setup.
- **School:** ten invented `School of Change Leadership`-style labels → blanked.
- **CustomInstruction:** column did not exist. Written to force commitment rather than commentary:
  *"Take a real conflict you have seen and say who you would disappoint first, and how you would tell
  them. Naming the loser is the whole exercise."*
- Category was already good and is unchanged.

### `greatest-hits.csv` — CLEAN (10 rows)

Concept is sound: ten unwinnable arguments, which is exactly what a vote-after-answer format wants.

- **Ragged CSV** — 9 of 10 rows were short a column. Fixed.
- **School:** ten fabricated institutions (`School of Athletic Performance`, `School of Life
  Philosophy`) → blanked.
- **CustomInstruction:** only row 1 had one, and it was wrong — *"How would you implement this
  concept in your current role or organization?"* attached to "greatest musical artist of all time".
  All ten rewritten to name the criterion the room should be arguing about: *"State your criterion
  first, then your athlete. One sentence each."*
- **Category:** `Entertainment` covered music, film and art; split into `Music` / `Film` / `Art`.
  `Experience` → `Life`.
- **Bodies** were 60-80 word lists of examples that pre-answered the question. Cut to one framing
  sentence each.
- `BEST AGE TO BE ALIVE` was ambiguous (life stage or historical era?) → `THE BEST AGE TO BE`.

### `developer-advocacy-{development,product}-teams.csv` — CLEAN, converted (20 + 20)

**These were never trivia.** They carry `optionA…optionD`, `correctAnswer` and `difficulty`, but the
questions are open discussion prompts and the "correct" answers are opinions. *"How do you balance
platform improvements against feature development?"* is scored correct if you pick "Dynamic based on
needs" — that is not a fact, and marking a room wrong for choosing "70/30" is a bad experience.

Converted to call-and-answer: option and answer columns dropped, `questionDetail` trimmed to the
framing question, real instructions added. The content underneath is good and specific — ADRs,
incident-response maturity, dependency policy, deprecation rules — and now asks for something
answerable: *"Say who gets paged when a service breaks at three in the morning, and whether that
matches who owns the code."*

Titles and categories were already fine and are unchanged. If you genuinely want these as trivia,
they need real answers, not preferences.

### `sample-trivia-tech-culture.csv` — CLEAN (32 → 29)

Never importable (no `Title` column, `CorrectAnswer` stored as option text). Rebuilt on the working
trivia header, `CorrectAnswer` normalised to `OptionA`-style, and `AnswerDetails` written for every
question so the RESULTS screen has something to say.

**Three questions dropped:**
- *"Which **company** developed Git?"* — answer key said "Linus Torvalds", who is not a company.
  Rewritten as "who created Git", kept.
- *"What is Spotify's organizational structure model called?"* — options included both
  "Tribes and Guilds" and "Squads and Tribes", which are both partly right. Dropped.
- *"Who is credited with inventing the first programmable computer?"* — genuinely contested
  (Babbage designed but never built; Zuse's Z3 was first working). Rewritten as *"Who designed the
  Analytical Engine?"*, which has one answer.

**Two reworded for accuracy:** Zappos "pioneered" holacracy → "famously adopted" (it was developed
by Brian Robertson); "first widely-used web browser" → "which 1993 browser popularised inline
images", which is what Mosaic actually did and stops Netscape being a defensible answer.

The remaining 29 are checked and correct. School blanked; the four categories were already good.

### `trivia-AWS___Constant_Work-…csv` — CLEAN (10 → 6)

The only trivia set in the repo with no factual problems — it tracks Colm MacCarthaigh's constant-work
article (the PDF is in `sets/`) accurately throughout.

Its problem is **structural duplication**: 10 questions cover 5 concepts, each asked twice with
different wording (Q1/Q7 dummy health checks, Q2/Q8 cache modes, Q3/Q9 Hyperplane config, Q4/Q10
self-healing). Reduced to 6 distinct questions, answers expanded so RESULTS teaches something.

Category was 10 near-synonyms for one topic (`System Design`, `System Design Patterns`,
`System Architecture`, `System Implementation`, `System Reliability`…) — collapsed to
`Constant Work`, since a single meaningful category beats ten fake ones. `School` was `AWS` on all
ten rows; blanked, because it is the topic, not an attribution.

### Small sets — CLEAN

- **`custom-scenarios-1753697732416.csv`** (5) — the best-written small set and it needed the least.
  `School` was `Professional Development` five times → blanked. `Question#` was `1` on all five rows,
  which breaks ordering → renumbered. Instructions were already real; sharpened to demand one
  concrete artefact each. Titles converted to screen-friendly caps.
- **`call-and-answer-workbackwards4step.csv`** (4) — a good four-step workshop with three real bugs:
  `"Forth, How can we help"` (typo for Fourth); step 2's instruction was generic filler (*"What
  innovative approach would you implement in your current project?"*) attached to "identify our
  customer"; step 3's instruction was step 2's, so the pain-point question told players to describe
  the customer. Categories were `Marketing / Mission / Strategy / Strategy`, which hid the sequence —
  now `Step 1 — Name` … `Step 4 — Help`, so the badge tells the room where it is.
- **`template-callandanswer.csv`** (5) — a template, so its defects get copied. Five invented
  `School of Modern Work`-style values blanked; five near-identical instructions
  (*"How would you implement…"*, *"How could you better leverage…"*) replaced with specific asks;
  bodies cut from ~55 words to one sentence.
- **`wavelength-sample-questions.csv`** (5) — uses its own lowercase header, preserved. Three fixes:
  `school` was `Business School` on all five rows → blanked; the body used literal `**Agentic AI**`
  markdown, which the player renders as plain text including the asterisks → removed; and all five
  `customInstructions` were the identical sentence. Kept the ten-word mechanic (it *is* the game) but
  differentiated the framing per term.
- **`template-trivia.csv`** (10) — the only importable trivia template. Facts were fine; one question
  was unanswerable (*"Which Git command creates a new branch?"* with "Both A and B" as the key),
  rewritten to have exactly one right answer. `CorrectAnswer` normalised to `OptionX`. Note it has no
  `AnswerDetails` column, so anything built from it will have a bare RESULTS screen — the fuller
  trivia header used by `trivia-AWS___Constant_Work` is the better thing to copy.

### `template-pbod.csv` — KEEP AS-IS (15 rows)

Genuinely good content: a Personal Board of Directors workshop with Peer / Mentor / Champion /
Specialist / Challenger / Mentee roles, mixing choice, slider and freeform questions. Categories are
meaningful and sequenced. No `School` column at all, which is correct.

Not cleaned because it is **blocked on the importer, not on content**: `QuestionType`, `SliderMin`,
`SliderMax` and `SliderLabel` are not read by `upload-questions.js`, so importing it today produces
fifteen questions that all behave identically. Fix the importer (or the game types) before touching
the words.

---

## Retired sets, with reasons

### `trivia-History-1753021557014.csv` — RETIRE (fabrications)

Reads well and is substantially untrue. I did not attempt to salvage it because the failure rate is
too high to trust the remainder without checking every row against sources.

- **Q2, Napoleon's tin buttons.** The story that French soldiers froze because tin buttons
  disintegrated in the cold is a well-known and repeatedly debunked myth. Marked as the correct
  answer.
- **Q10, "The Nilometer".** Described as a 1500 BCE counterweight machine requiring 1,000 men to
  operate, built "to protect the city of Memphis". A nilometer is a measuring device for flood
  levels. The counterweight system, the crew and the defensive purpose are invented.
- **Q17, Lincoln at Ford's Theatre.** Asks which actor "insisted on appearing in *Our American
  Cousin*", answer John Wilkes Booth, and the explanation states he "specifically arranged to perform
  that night". Booth was not in the play. The question has no valid answer.
- **Q13, the Terracotta Army.** Claims craftsmen were executed *for signing their work*. The
  inscriptions were quality-control marks; there is no evidence for this consequence.
- **Q12, Napoleon "obsessed with jelly" on Saint Helena.** No reliable source.
- **Q4, Theodore Roosevelt naming his cup "The Abundance"** and the Maxwell House slogan origin —
  legend, presented as fact.
- **Q7** attributes the plague-of-Athens immunity observation to Hippocrates; it is Thucydides.
- **Q1 and Q11 are the same Boston Tea Party question** with slightly different distractors.

Some rows are fine (thermopolia, the Zimmermann Telegram, Roanoke, Constantine XI, Hypatia, ancient
Olympic nudity). If you want a history round, write ten fresh questions rather than trying to
disinfect this file.

### `trivia-80s_Music_Trivia_101-…csv` — RETIRE (wrong answers, 4× duplication)

- *"Which video was played first on MTV?"* appears as **Q1, Q6, Q11 and Q16** — four of twenty.
- *"Who did Madonna marry in 1985?"* appears as **Q2, Q7 and Q12**, each describing a **different
  outfit** — a black bustier, a black "Love" tank top, and a white dress with a "Boy Toy" belt. At
  most one can be right.
- **Q9 is marked wrong.** The question asks about the star pattern over the right eye — that is Paul
  Stanley of KISS. The key says Twisted Sister, and the explanation contradicts itself mid-sentence:
  *"Paul Stanley of KISS was known for his star pattern, but Starchild pattern."*
- **Q10 is marked wrong and is anachronistic.** Asks about a 1981 computer-animated video, keys
  Kraftwerk, and the explanation spends its length on Dire Straits' *Money for Nothing* (1985).
- **Q8 and Q18** both claim the Yamaha DX7 debuted on *Thriller*. The DX7 shipped in 1983; *Thriller*
  was released in November 1982. Both are false, and both call it a 1983 album.

### `trivia-80s_music_trivia-…csv` — RETIRE (voice, metadata)

The facts are mostly defensible (single white glove, *Take On Me* rotoscoping, *Pac-Man Fever*,
Bowie/Jagger). It is unusable for other reasons:

- **27 distinct `School` values across 30 rows**, including `80s Gaming Culture`, `80s gaming
  culture`, `1980s gaming` and `1980s Gaming & Music` — four spellings of one idea, all rendering as
  the italic subtitle.
- Written in period pastiche — *"In the totally radical year of 1983…"*, *"totally tubular"*,
  *"gnarly"*, *"bodacious"* — in the question text itself, which is what goes on the projector.
- Non-standard `WrongAnswer1…5` columns the importer does not read, so the distractors vanish on
  upload and the questions arrive with no options.

If 80s music is wanted, it needs writing from scratch. Also worth noting for a mixed professional
audience: three of the four remaining 80s/MTV sets lean heavily on US TV of 1981-89, which lands
very differently outside the US and for anyone under about forty.

### `subject-specific-scenarios-1752962941485.csv` — RETIRE (answers in `School`, wrong facts)

Structurally broken and factually unreliable.

- **The `School` column holds the answers.** Ten rows contain values like `Lionel Richie's 'Dancing
  on the Ceiling'`, `Money For Nothing by Dire Straits`, `We Are The World`. Those render in grey
  italic *above* the question. The other 30 rows say `Professional Development`.
- **`CustomInstruction` also holds answers** on several rows (`"Correct Answer: 'Video Killed the
  Radio Star'"`, `"Mötley Crüe reportedly spent over $10,000 annually on hairspray"`), while 10 rows
  have no instruction at all.
- **Factual failures:** *"first video to use crowd-sourced fan content"* → Bowie's *Ashes to Ashes*
  (false); *"radical image change from suits to glam rock makeup"* → *"Kiss removing their makeup in
  1983"* (backwards — they took the makeup off); *"which 1981 video first used computer graphics"* →
  *Money for Nothing*, which is 1985.
- Categories `Music and Culture Stars` and `Music and Culture stars` differ only in case, so the host
  filter shows two entries for one group. `New Wave Networking` and `Thriller Time Management` each
  appear twice as titles.
- The framing throughout — HR releasing policy as a-ha parodies, an office printer that only works
  during power ballads — is forced, and several rows ask people to physically perform 80s dance moves
  at work, which is a specific and not universally welcome request.

### `lists-favorites-scenarios-…csv` — RETIRE (5 questions padded to 20)

Five topics (movies, professional resources, travel, personal growth, hobbies) each appear four
times with near-identical titles — `Team Movie Night Planning` ×3, `Professional Development
Library` ×3, `Team Retreat Planning` ×3. Eight of the twenty instructions are five stacked
"List 10 of your favorite…" lines inside one field, which is five questions crammed into one and far
too much to answer in a live round. `School` is a four-way muddle of `Professional Development`,
`Team Building`, `Career Growth`, `Career Development`, `Knowledge Sharing`.

The underlying idea — a "list ten favourites" round — is fine. It needs five questions, not twenty.

### Duplicate slices — RETIRE (9 files)

Nine files are subsets or format experiments of two originals, and every one of them will show up in
the admin question-set list as if it were a real set:

- `amazon-leadership-call-and-answer.csv`, `amazon-leadership-call-and-answer-fixed.csv` and
  `amazon_all_leadership_scenarios-converted.csv` are each the first 29 rows (3 of 16 LPs) of
  `amazon_all_leadership_scenarios.csv`, differing only in whether the guidance sits in
  `Detail_lesson` or in a separate `AnswerDetails` column.
- `lessons-call-and-answer.csv`, `lessons-call-and-answer-fixed.csv` and `lessons-converted.csv` are
  each the Architecture block (9 of 80 rows) of `lessons.csv`.
- `sample-trivia-tech-culture-converted.csv` is the first 4 rows of a 32-row set.
- `trivia-template.csv` is an unimportable near-duplicate of `template-trivia.csv`. Its
  "longest river" question is also genuinely disputed (Nile vs Amazon).
- `newquestionsettemplate.csv` is a two-row call-and-answer template — the third in the repo, and the
  weakest: one of its two rows has an empty `CustomInstruction` and the other is
  *"How would you apply this leadership principle in your current team or organization?"*, the same
  generic filler that infects `greatest-hits`.

The `-converted` / `-fixed` suffixes suggest these were produced while working out the schema. That
work is done; keeping them costs clarity in the admin list and risks someone importing the 29-row
Amazon subset thinking it is the full set.

---

## Cross-cutting patterns worth fixing upstream

1. **`School` is a foot-gun.** It is optional, invisible in the admin UI until you play a game, and
   renders on every question. Of the 22 sets that populate it, exactly **one**
   (`famous-art-titles`) uses it correctly. Recommend renaming the field to `Attribution` in the
   importer with a `School` alias, and adding help text: *"leave blank unless there is a real source
   to credit."*
2. **Duplicated-instruction bug is real but rarer than expected.** No cleaned or original file has an
   instruction byte-identical to its title. The actual failure mode is subtler and worse: an
   instruction that is *generic* (*"Share your thoughts"*, *"How would you implement this concept in
   your current role?"*) or *copied from a different question*. Both appear in
   `call-and-answer-workbackwards4step`, `greatest-hits` and `newquestionsettemplate`.
3. **Fake trivia.** Two sets (`developer-advocacy` ×2) and arguably the AI-generated scenario sets
   attach a `correctAnswer` to a matter of opinion. A trivia round that marks a reasonable answer
   wrong is worse than no round. If the generator can produce open prompts, it should not be emitting
   `correctAnswer` for them.
4. **AI-generated sets duplicate within themselves.** Every set with a timestamp suffix
   (`…-175xxxxxxxxx.csv`) repeats questions inside the same file — 4× for MTV's first video, 3× for
   Madonna's wedding, 4× per topic in `lists-favorites`. Worth a dedup pass in the generator on
   `Title` and on question stem similarity before the CSV is offered for download.
5. **Ragged rows import silently.** `greatest-hits.csv` lost 9 of 10 instructions and nothing
   complained. `upload-questions.js` should warn when a data row's column count differs from the
   header's.
6. **`Title` has no length guidance.** `Interview-Preparation` had 20 titles averaging 74
   characters. A soft warning above ~60 in the admin uploader would have caught it.

---

## Questions kept despite some doubt

Flagged rather than silently retained, per the brief:

- **`sample-trivia-tech-culture` Q18, Mosaic as the browser that popularised inline images (1993).**
  Correct as reworded, but "first widely used browser" is a contested framing and someone will argue
  for Netscape or for the earlier WorldWideWeb browser.
- **`sample-trivia-tech-culture` Q13, Zappos and holacracy.** Reworded to "famously adopted" because
  Zappos did not create holacracy. The ~18% buyout figure in the answer text is widely reported but I
  have not verified it against a primary source.
- **`lessons` Design 9, Jony Ive on emotional connection.** A fair characterisation of his public
  statements rather than a sourced quotation. Kept with his name; drop the attribution if you want
  the set fully citable.
- **`lessons` Film 1 and 6** (Kurosawa on visual storytelling, Charlie Kaufman on subtext) are
  reasonable characterisations of both figures' known work but are not sourced quotations.
- **`lessons` Culinary 9,** that identical food plated better "literally tastes better". There is
  real research on plating and perceived taste, but the claim as written is stronger than the
  evidence. Softening it would cost nothing.

---

## Verification

`sets/cleaned/` was checked with a throwaway Node script that replicates `parseCSV()` from
`upload-questions.js` line for line, then asserted per file: every data row has exactly the header's
column count, no UTF-8 BOM, `Category` and `Title` both resolve through the importer's own
lookup-and-fallback logic, and no `CustomInstruction` equals its own `Title`.

**Result: 15/15 PASS.** Run against `sets/` for comparison, the same script fails 3 files —
`greatest-hits.csv` (ragged rows), `sample-trivia-tech-culture.csv` and `trivia-template.csv`
(no `Title` column, rejected at upload). The script has been deleted.
