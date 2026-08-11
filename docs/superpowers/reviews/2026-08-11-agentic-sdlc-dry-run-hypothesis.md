# Dry run — "Reimagining the SDLC with agentic workflows"

**Written BEFORE the set, the prompt, or the simulation existed.** That is the
point: an evaluation written after the output is a description, not a test.

**Subject:** a 6-question call-and-answer session, plus a Workie advisor that
reads back what was said and voted, names discussion topics, and proposes next
steps.

---

## Part 1 — The hypothesis: what good looks like

Every criterion below is **falsifiable against the artefacts**, and each names
what would refute it. Anything I cannot check from the files is marked as owed
to a human.

### The session's purpose

> A session succeeds if it produces something **the group could not have
> written alone**, and that **survives contact with Monday**.

Everything else is a proxy for those two.

### A. The question set

| # | Criterion | Refuted by |
|---|---|---|
| **H1** | Each question produces genuine **divergence** — the vote spreads, rather than 80%+ converging on one answer. | A question where the room agrees immediately. That question told us something we already knew. |
| **H2** | The set **escalates**. Early questions are answerable from experience; later ones force a trade-off, a cost, or a commitment. | Q6 being no harder to answer than Q1 — the room's warmed-up state was wasted. |
| **H3** | **No question is answerable with a tool or vendor name.** "Which agent framework" is a shopping question; "what do you stop doing once review is cheap" is a design question. | Any question whose best answer is a product. |
| **H4** | Each question is **answerable in 2–3 sentences by a practitioner**, not only by an architect or only by a manager. | A question that requires org-chart authority to have an opinion on. |
| **H5** | The set covers **more than code generation**. Agentic SDLC touches planning, review, testing, deploy, on-call, and what humans are now for. A set that is six flavours of "AI writes code" is one question asked six times. | Two questions that would attract the same answers. |

### B. The advisor's report

| # | Criterion | Refuted by |
|---|---|---|
| **H6** | It names **at least one thing the room disagreed about, and does not resolve it.** | A report that manufactures consensus. This is the dominant failure mode of AI meeting summaries and the most valuable thing to get right. |
| **H7** | **Every claim traces to an actual response.** No invented statistics, no "the team felt", no percentage the system cannot compute. | Any number not derivable from the answers and votes — specifically the `participationRate` defect fixed in `78df15ca`, where the model was told participation was 100% on every round by construction. |
| **H8** | **Next steps are assignable.** Each has an owner-shaped subject and a first action doable inside a week. | "Invest in agentic tooling." Passes: "Run one real PR through agent review and compare against the human reviewer's findings." |
| **H9** | It surfaces the **load-bearing minority** — the answer that got few votes but that the room will regret ignoring. | A report that only echoes the top-voted answer. The tally already says what won; the advisor's job is what the tally hides. |
| **H10** | It is **legible to someone who was not in the room.** | Pronouns with no referent, in-jokes, "as discussed". |
| **H11** | It is **readable aloud in under three minutes** (~450 words). | A wall of text on a projector. |

### C. The mechanics

| # | Criterion | Refuted by |
|---|---|---|
| **H12** | The set **imports through the real importer** with zero skipped rows. | Any row silently dropped — the exact class of defect that made every AI-generated poll set import with no options. |
| **H13** | The prompt uses **only variables the system actually emits**, and every variable it references resolves to real data. | A `{token}` with no key, which renders literally on the projector. |
| **H14** | The report degrades honestly when data is thin — a round nobody answered must not read like a round with nothing interesting in it. | The `buildFallback()` path being indistinguishable from a real summary (the defect behind `fb39b9c8`). |

### D. What this dry run CANNOT establish

Stated up front so the evaluation cannot quietly claim it:

1. **The model gap.** Production summaries run on **Haiku 4.5**
   (`get-ai-summary.js:2255`). This simulation runs on Opus. A prompt that
   produces a disciplined report here may ramble or manufacture consensus
   there. **Refuting H6–H11 on Opus is decisive; confirming them is not.**
2. **Real humans.** Simulated answers are written by one mind and will be more
   coherent, more on-topic, and more evenly distributed than a real room's.
   In particular they will **understate** how much of a real session is
   near-duplicates and one-word answers.
3. **The projector.** Nothing here checks legibility at 25 feet.
4. **No Bedrock call is made.** The prompt is rendered for real; the completion
   is produced by a model reading that rendered prompt, not by the deployed
   lambda.

---

## Part 2 — Evaluation

Written by an evaluator who wrote none of the artefacts. Part 1 above is
untouched.

**What I re-ran rather than took on trust.** `node scripts/simulate-session.js
--prompts 4,6` (reproduces: 6 imported / 0 skipped / 6 categories, prompt
lengths 18,072 and 18,174, `unresolvedVariables` empty on all six rounds). The
real dry-run importer against the set on its own, with no credentials
(`questions: 6, categories: 6, rows that would be written: 13, skipped: 0`).
The full backend loop: **49 test files, 1261 passed, 0 failed** — the stated
baseline holds and `tests/host-connection-dedup.js` did not flake this time. I
also re-derived every number quoted in the two advisor reports from the tallies
in §8 of the session document, and measured the D2 character claims myself.

**§D.1 is binding.** Every verdict on H6–H11 below is recorded as *satisfied on
Opus, unconfirmed on Haiku 4.5*. Confirmed in the code as it stands today:
`claude-haiku-4-5-20251001`, `max_tokens: 1024`, `temperature: 0.5`, now at
`get-ai-summary.js:2266-2275` — Part 1 cites `:2255`, which was correct when it
was written and drifted eleven lines when the fixes below landed. None of these
four is a clean pass, and none should be quoted as one.

### A. The question set

**H1 — divergence. UNTESTED.**
This criterion measures how a room votes, and **every ballot in this run is
fixture**: §2 of the session document tags "Roster, roles, every answer, every
ballot" as `FIXTURE`. Worse for grading purposes, §3 records that the vote
distribution was *designed* around a code path rather than around the
questions — *"A close vote and a runaway. Round 2 finishes 17 to 16. Round 5
finishes 21 to 6. Combined with rounds 3 and 6 this drives `consensusLabel`
across all three of its non-degenerate branches."* A pass here would have been
authored and so would a fail.

Recorded for the record, because it does not go the way the set notes assume:
if you grade the observed data anyway, H1's 80% threshold is breached twice on
first-place ballots — round 5, *"| 1 | Priya | 7 | 0 | 0 | 21 |"* against 8
voters (87.5%), and round 6, *"| 1 | Marcus | 6 | 0 | 0 | 18 |"* against 7
voters (86%). On the vote-*points* reading no round exceeds 44% (round 5 is 21
of the 48 points awarded), so the verdict flips with the denominator, and Part 1
does not say which denominator it meant. **This is where I judge differently
from the producer**: the set notes nominate Q1 as *"the weakest question,
honestly"* and predict the evaluation will find the room converged there, and
Q1 is in fact the *most* spread round of the six (17 / 10 / 9 / 9 / 4 / 3 / 2 /
0 / 0 / 0). The rounds that converged are Q5 and Q6 — the two the notes call the
hardest.

**H2 — escalation. PASS**, graded on the question text, which is a real
artefact. Q1 asks for recall (*"Name the specific task, not the category. Say
what happened the third time you tried it"*); Q6 asks for a commitment with a
price and refuses answers without one — *"State the thing and its price in the
same answer. An answer with no cost in it is not a commitment."* The fixture
answers corroborate (all 8 round-6 answers carry a cost, four of them
quantified: *eleven minutes*, *six hours a week*, *five years out*, *twice*),
but that corroboration is authored and I am not resting the verdict on it.

**H3 — no question answerable with a tool or vendor name. PASS.** No question in
`sets/agentic-sdlc-call-and-answer.csv` has a product as its best answer; Q4's
four candidate positions are techniques and postures (*"attack the suite with
mutations… accept the tests as regression-only"*), not purchases. Corroborating
and mildly interesting: three product names did surface in the fixture answers
and all three sit in round 1 — *"dbt model boilerplate. Nothing reclaimed yet."*
(0 vote points), *"Terraform module scaffolding"*, *"the Kotlin-to-Swift parity
work"* — and none is the substance of a scoring answer.

**H4 — practitioner-answerable. PASS**, on the question text. Every round is
framed at the level of the person doing the work (*"Answer from a page you have
actually taken"*, *"Say what you would stop reading"*), and none requires
org-chart authority to hold a view. Caveat that limits how much this is worth:
the evidence that a junior *can* answer — Ben, *"engineer, two years in"*,
answering all five rounds he was present for — is fixture written by the same
mind that wrote Ruth's answers.

**H5 — breadth. PASS.** Six distinct categories through the real importer:
*"Handover / Planning / Review / Testing / Operations / Craft"*. The closest
pair is Q3/Q4, and their answer sets are disjoint in kind: Q3 answers name what
a person stops attending to (*"I read the blast radius and nothing else"*), Q4
answers name a bill (*"The cost is CI minutes, which we measured at roughly four
times our current suite runtime"*). No answer idea repeats across rounds.

### B. The advisor's report

**H6 — names a disagreement and does not resolve it. Satisfied on Opus,
unconfirmed on Haiku 4.5.** Round 4: *"**Not settled**: one answer keeps
*human-authored expectations* and accepts *I am the bottleneck on every new
test*; another goes *regression-only* and accepts *users find the bug first*."*
Those two are genuinely mutually exclusive, both are quoted, and neither report
picks a winner anywhere. The refutation condition — a report that manufactures
consensus — did not occur in either round.

Recorded against the same criterion, in the other direction: **round 6's "Not
settled" pairs two answers that do not actually conflict** — keeping production
access human, and giving junior engineers formative work. One person can do
both. The prompt's own rule 5 says *"Never invent a split that is not in the
answers"* and the output section provides a **No split** branch for exactly this
case. H6 does not cover the inverse failure, so this is not a fail against H6;
it is logged below as **D8**.

**H7 — every claim traces to an actual response. PASS on the pre-registered
refutation, with one exception logged.** The refutation named in Part 1 is *"any
number not derivable from the answers and votes"*. I checked every number in
both reports against §8: *20 vote points* (Ruth, round 4), *17* (Kai), *3* for
the delete-tests answer, *four of the answers name mutation testing* (Ben, Dan,
Hannah, Kai — exactly four), *18 vote points… on 6 first-place votes* and *7
vote points for the next answer* (round 6). All derivable, none invented, and
`participationRate` is now the empty string by construction
(`get-ai-summary.js:2123`).

The exception is not a number. Round 6: *"**The vote picked the answer carrying
a number**: that answer alone names a measured cost"* — false against the
material, and contradicted three bullets earlier by the same report: *"**Some
prices are exact**: the costs written down include *eleven minutes* … and *about
six hours a week*."* Priya's answer says *"I have measured it: about six hours a
week"*. Logged as **D7**.

**H8 — next steps are assignable. Satisfied on Opus, unconfirmed on Haiku 4.5.**
All six steps carry an owner-shaped subject and a doing verb: *"Whoever owns the
CI budget: measure mutation-testing runtime on one module"*, *"Whoever assigns
next sprint's tickets: try handing one ticket an agent could finish in an hour
to the least experienced engineer."* None begins with a banned opener. One
wobble on the week test: *"Marcus: draft the one-page exception rule … and take
it to the next incident review"* pairs a week-sized action with an event that
may not fall inside the week.

**H9 — the load-bearing minority. Satisfied on Opus, unconfirmed on Haiku 4.5.
The strongest single result of this run.** Both reports rescue an answer sitting
at 0 vote points, quote it, price the omission, and attribute it to nobody:
round 4, *"**Worth keeping**: an answer at 0 vote points says *the cost lands on
on-call and I am not the one carrying it*, and ignoring it sets a testing policy
whose bill is paid by whoever holds the pager"*; round 6, the *"payoff is five
years out"* answer. The refutation — a report that only echoes the top-voted
answer — did not occur.

**H10 — legible to someone who was not in the room. Satisfied on Opus,
unconfirmed on Haiku 4.5.** No in-jokes, no "as discussed", and each idea is
restated in full rather than back-referenced — the discussion questions restate
the whole split rather than pointing at it, which is what F2 cost 25 words to
achieve. One borderline case: round 6's *"that answer alone names a measured
cost"* uses a demonstrative whose referent is the bullet's own lead phrase
rather than a subject in the same clause, which is at the edge of what rule 8
bans.

**H11 — readable aloud in under three minutes. Satisfied on Opus, unconfirmed on
Haiku 4.5.** Counted independently, not taken from the document: both reports
are **399 whitespace-separated tokens and ~370 spoken words**. Both are under
the 400 cap, and both are under it by one token — there is no headroom, and F6
records that getting there took three trimming passes and cost evidence.

### C. The mechanics

**H12 — imports through the real importer with zero skipped rows. PASS**, and
verified twice by me independently of the harness. `node
scripts/install-question-set.js dummy-table sets/agentic-sdlc-call-and-answer.csv
--type call-and-answer --title "T"` (no credentials, nothing written) reports
*"questions : 6 / categories: 6 / rows that would be written: 13 / skipped: 0"*,
and the simulation reports *"Imported questions: 6, skipped rows: 0, categories:
6"*. See **D10** for a cosmetic miscount in the same tool's preamble.

**H13 — only variables the system actually emits. PASS on its letter, and the
letter is not enough.** `debugInfo.unresolvedVariables` is empty on all six
rounds and I reproduced that. But H13 tests for *a token with no key*; D2 is *a
token with a key, used as a noun*, and H13 is structurally blind to it. A prompt
can pass H13 with a third of its instruction text destroyed, which is what
happened here. Part 3 proposes the companion check.

**H14 — honest degradation on thin data. UNTESTED.** Confirmed, not inherited:
the smallest round in the run is round 6 at 8 answers and 7 voters, so rule 10's
`{responseCount}` is 0 / 1 / 2 branches and rule 4's `{voteCount}` is 0 branch
never ran. Reading the code makes the gap worse than the producer states:
`buildFallback()` — the path Part 1 names as the refutation target — is not a
thin-data path at all. Its triggers are *prompt template unavailable*
(`get-ai-summary.js:1336-1338`) and *Bedrock failed* (`:2334`); with zero
answers and a working model it never fires, and the thin round is handled
entirely by the prompt's rule 10. So H14 as pre-registered conflates two
different degradations and needs two tests, neither of which exists. Not a mark
against the run — a mark against the criterion.

### Verdict summary

| | Criterion | Verdict |
|---|---|---|
| H1 | Divergence | **UNTESTED** (ballots are fixture; observed data leans refute) |
| H2 | Escalation | PASS |
| H3 | No vendor answers | PASS |
| H4 | Practitioner-answerable | PASS (question text; the room is fixture) |
| H5 | Breadth | PASS |
| H6 | Names an open disagreement | Satisfied on Opus, unconfirmed on Haiku |
| H7 | Every claim traces | PASS on the pre-registered refutation; see D7 |
| H8 | Assignable next steps | Satisfied on Opus, unconfirmed on Haiku |
| H9 | Load-bearing minority | Satisfied on Opus, unconfirmed on Haiku |
| H10 | Legible to an outsider | Satisfied on Opus, unconfirmed on Haiku |
| H11 | Under ~450 words | Satisfied on Opus, unconfirmed on Haiku |
| H12 | Clean import | PASS |
| H13 | Only real variables | PASS on its letter; blind to D2 |
| H14 | Honest thin-data degradation | **UNTESTED** |

**Totals: 8 PASS, 4 satisfied-on-Opus-only, 2 UNTESTED, 0 FAIL.** Read the
middle column, not the total: the four Opus-only results are the ones the
session exists to establish and the ones §D.1 says cannot be established here.

### Defects the run exposed

#### Fixed, and each verified against the code rather than the list

| | Defect | Severity | Status |
|---|---|---|---|
| D1 | `consensusLevel` read a `maxScore` never passed to it | High | **Fixed, verified** |
| D3 | `votesGiven` structurally 0 in every report | High | **Fixed, verified** |
| — | The earlier `consensusLevel` tautology | High | **Fixed; claim partly retracted — see below** |
| — | `install-question-set.js` dry run validated nothing | High | **Fixed, verified** |

**D1.** `get-ai-summary.js:1056-1068` now carries `maxScore` into the only
`results` object `generateAISummary` sees. Verified end to end, not by reading:
re-running the simulation now prints, per round, *"consensusLevel, as the
deployed handler emitted it"* = Mixed / Mixed / Moderate / Mixed / **Strong** /
Moderate, matching the audited `consensus.js` labels on all six rounds. The
session document still records the pre-fix output (*"No votes cast - nothing was
ranked" ×6*), which is correct as a record of that run.
`tests/ai-consensus-label.js`: 18 passed, including *"the results object passed
to generateAISummary carries maxScore"*. Blast radius worth stating: the
hardcoded `lessons-learned` default prompt interpolates `{consensusLevel}` at
`:285`, and so does the shipped `sets/prompt-poll-round.json` (*"How much the
room agreed: {consensusLevel}"*), so this was live on poll rounds too.

**D3.** `create-report.js:539-540` now filters `(v.VoterName || v.PlayerName ||
v.playerName)`. Verified by re-running: `votesGiven` is now 6/6/6/5/5/6/5/6/4
for the nine full participants and — the part that proves it is not the lazy fix
of counting every vote row for everybody — **Ben 3 and Hannah 1**, both lower
than their answer counts. `tests/session-report-honesty.js`: 22 passed,
including *"the column distinguishes voters from non-voters at all"*.

**The tautology and its retraction — what was actually true.** Both commit
messages are partly right and the retraction is the accurate one. The expression
`winners.length === 1 && winners[0].score > (results.maxScore * 0.8)` *was* a
tautology in form: `winners` is built as the answers whose score equals
`maxScore`. But it never fired, because the pre-`a3246ae8` results literal
(`bf7e4d4b^:get-ai-summary.js:1055-1059`) carried `voteTallies`, `winners` and
`totalVotes` and **no `maxScore`**, so the comparison was `score > NaN` — false
always. Rounds fell through to a Moderate branch comparing top against
runner-up × 2, which is real arithmetic, or to the `'Mixed opinions'` default.
So: **`bf7e4d4b`'s headline claim — that every voted round was told the room
strongly agreed — is false; the branch was dead code.** `bf7e4d4b` then made it
briefly true in the other direction, because `consensusLabel`'s zero-guard reads
a missing `maxScore` as "nobody voted". `a3246ae8` fixed the root cause. **Still
outstanding: the retraction lives only in a commit message.** Two code comments
still assert the retracted claim — the `consensus.js` header (*"Any round with a
single top answer and one vote point reported 'Strong consensus'… A 4/3/3 round
read as strong agreement"*) and `get-ai-summary.js:1609-1611` (*"the previous
inline version compared maxScore against itself and therefore reported 'Strong
consensus' on every voted round"*). Logged as **D9**.

**The dry run.** `scripts/install-question-set.js` now parses before any AWS
call (`:143-166`), needs no credentials, and prints questions / categories /
rows / skipped. Verified by running it on this set: it produced a full column
map, a per-question trace and `skipped: 0`, then said plainly *"skipping table
checks: Region is missing"* rather than dying. This is the fix I trust most,
because the failure it prevents is silent.

#### Reported, not fixed — each confirmed by me

**D2 — variable substitution destroys the prompt's own rules. CONFIRMED,
severity high, and I could not reproduce the producer's arithmetic.** The
mechanism is exactly as described: `get-ai-summary.js:2214-2217` does a global
`replace` per token, and rules 4, 5 and 10 name the tokens in prose. Rule 10
renders as *"If 11 is 0, write one plain line"*; rule 4 renders at **1,557
characters** (the producer's figure, confirmed to the character).

My measurements of the round-4 prompt differ from the document's: `responsesText`
is **2,244** chars, `voteTally` **635**, `votingBreakdown` **732**, and each
appears **exactly twice** in the 18,072-character prompt. That is **7,222
characters — 40.0% of the prompt — occupied by those three fields**, of which
**3,611 characters is pure duplication (20%)**. The document's *"roughly 5,900
characters — a third of the prompt — is the same eleven answers, repeated"*
matches neither figure. The defect is real and, on the occupancy reading, worse
than stated; the number as written should not be quoted.

H13's blindness to this is confirmed above.

**D4 — `{voteTally}` sliced for five over an array truncated to three.
CONFIRMED, severity low.** `get-ai-summary.js:1283-1286` builds `sortedAnswers`
with `.slice(0, 3)`; the `resultsString` builder does `sortedAnswers.slice(0, 5)`
and `votingBreakdown` does `.slice(0, 3)` on the same already-truncated array.
Harmless today. Worth adding to the producer's note: the same 3-entry array also
feeds `topAnswers`, hence `{topVotedAnswers}` and `buildFallback()`'s `top`, so
"three" is a wider assumption than one field.

**D5 — emoji in the material, emoji banned in the output. CONFIRMED, severity
low-medium.** `get-ai-summary.js:1410-1413` builds `responsesText` with *🥇 1st
Place* / *🥈* / *🥉*; `outputFormat` ends *"no emoji"*. Twelve emoji appear in
the two assembled prompts. Opus did not mirror them; that is not evidence about
Haiku.

**D6 — the advisor never sees the round's own `CustomInstruction`. CONFIRMED,
severity high, and it is the most product-shaped defect in the set.**
`get-ai-summary.js:959-960` reads `customInstruction` off the **set** row, not
the question; the advisor prompt references neither `{customInstruction}` nor
`{contextSections}`. I grepped the assembled round-4 prompt for the round's own
instruction strings — *"Say what you would stop reading"*, *"Name the specific
task"*, *"State the thing and its price"* — and all three are absent. The
consequence the producer names is real and is the sharpest thing in the
transcript: round 3's instruction is *say what you would stop reading*, and
Ben's answer refuses it in as many words — *"Honestly I still read all of it…
I know that is not the answer the question wants"* — and no advisor reading that
round can see it as a refusal, because the thing being refused was never shown.

#### Found during this evaluation — recorded, not fixed

| | Defect | Severity | Status |
|---|---|---|---|
| D7 | Round-6 report claims *"that answer alone names a measured cost"*, contradicted by Priya's answer and by the report's own second bullet | Medium | Recorded |
| D8 | Round-6 *"Not settled"* pairs two answers that do not conflict; rule 5 bans inventing a split and the **No split** branch existed | Medium | Recorded |
| D9 | `consensus.js` header and `get-ai-summary.js:1609-1611` still assert the claim `a3246ae8` retracted | Medium | Recorded |
| D10 | `install-question-set.js:144` prints `split('\n').length - 1` as "data rows" — says **7 data rows** for a 6-question CSV, so a clean import reads like a dropped row in the very tool built to surface dropped rows | Low | Recorded |
| D11 | `template-variables.js` misdescribes `voteTally` as *"Detailed breakdown of votes received by each response"*, example *"Alice: 3 first-place, 2 second-place votes (13 points)"* — that is `votingBreakdown`'s shape; the real value is a top-3 list of answer **texts** with point totals and no names. The catalogue is a prompt author's only spec | Medium | Recorded |
| D12 | `{votingPattern}` sets *"Clear consensus"* when `winners[0].score > results.totalVotes * 2` (`get-ai-summary.js:1580`) — vote **points** compared against **voter count** × 2, two different units. Live in the hardcoded `lessons-learned` default prompt at `:284`. On this data it fires for rounds 3 (23 > 18) and 5 (21 > 16) and not round 1 (17 > 18), for no reason a reader could defend | High | Recorded |
| D13 | `{resultsSummary}` non-trivia branch computes *"N% of possible vote points"* with denominator `totalVotes * 3`, while a full 3/2/1 ballot awards 6 points — so the figure is roughly double the true share and can exceed 100% (3 firsts + 3 seconds across 4 voters → 15/12 = 125%). Currently unused by any shipped prompt, but catalogued and offered to authors | Medium (latent) | Recorded |

D12 and D13 matter beyond themselves: they are the same shape as the two defects
this repo has already removed (`participationRate` in `78df15ca`, the consensus
tautology) — a number computed from mismatched or self-referential quantities,
interpolated straight into a live prompt, and read aloud. The prompt author
excluded both variables by instinct. The instinct was right and the arithmetic
is still shipping.

**One scaling observation, not a defect.** Nothing truncates `responsesText`, so
prompt size grows linearly with the room and D2 doubles the slope. At 11 people
the prompt is 18 KB; the fixed text is ~10.9 KB, so a 40-person round lands
around 30 KB (~8k tokens) of input per round, per summary. Fine today, worth a
number before anyone runs a large session.

---

## Part 3 — What to improve

Ordered by value within each half. Cost and consequence-of-skipping stated for
each. Items marked **OWNER DECISION** are trades, not implementations, and
should not be made by whoever holds the next keyboard.

### 3A. The report and the prompt

These are edits to `sets/prompt-callandanswer-workie-advisor.json` and nothing
else. No code changes, no deployment. The prompt is one string; every item below
is cheap to make and expensive to verify, because verification means
re-rendering and re-reading an 18 KB prompt.

**1. Stop naming variables in prose — rewrite rules 4, 5 and 10 (D2, F8).**
Refer to the fields by the English labels already printed beside them, not by
their tokens: rule 4 becomes *"Read the count under 'How many people voted'
before you describe any result. If it is 0, no vote was taken: say so plainly,
and ignore the two vote sections below it"*; rule 5 becomes *"Find two answers
in the ranked list above…"*; rule 10 becomes *"If the count under 'How many
people answered' is 0…"*. **Cost:** three sentences, one file, no code. Half a
day if you re-render and re-read the assembled prompt, which you must.
**If skipped:** three of fourteen rules arrive as unreadable data-filled
sentences, 40% of the prompt is three fields and 20% of it is literal
duplication, and §6 of the session document names the specific Haiku failure it
expects — *"reads part of rule 4's inlined tally back to the room as content,
because it is indistinguishable from the material by position."* This is the
single highest-value edit in the document.

**2. Resolve rule 2 against rule 3 (F1).** Rule 2 forbids any number not
copyable from the material; rule 3 requires *"four of the answers say the same
thing"*, and four is not copyable from anywhere. Amend rule 2 to: *"The only
counts of **people** you may state are those two. You may also count answers
that say the same thing, by reading them."* **Cost:** one clause.
**If skipped:** a model resolves the conflict the other way and writes *"several
of the answers say the same thing"* — precisely the vague summary rule 3 exists
to prevent — or freezes between two rules that cannot both be obeyed. §6 ranks
this the sixth most likely divergence and rule 2 the second most likely to break
outright.

**3. Reorder: put the rules before the material (F8).** The rules currently
arrive after ~9,000 characters of answers and tallies. Both blocks live inside
the same `instructions` string, so this is a cut-and-paste with no code change.
**Cost:** minutes to make, one careful re-read to confirm nothing referred
backwards. **If skipped:** on a small model, instruction adherence decays with
distance from the instruction, and every one of the 14 rules is currently on the
far side of the data.

**4. Remove the rule 8 / Discussion-topics collision (F2).** Rule 8 bans *"the
above"*; the Discussion-topics guidance says *"Make one of them the disagreement
you named above"*. Change the guidance to *"One question must be the split you
named in the first section, restated here in full."* **Cost:** one clause.
**If skipped:** the model must break one of two rules; Opus paid ~25 words of a
400-word budget to obey both, and those 25 words came out of evidence.

**5. Give rule 6 a tie-break (F5).** Round 4 has three answers at 0 points and
one of them is *"Mutation testing."* — three words. Add: *"If several answers are
tied at the bottom, take the one that carries an argument. Do not rescue an
answer shorter than about ten words."* **Cost:** one sentence.
**If skipped:** a model reading rule 6 as "lowest, then first" has a one-in-three
chance on this round of writing a straight-faced sentence about what ignoring
three words would cost the room, on a projector, aloud.

**6. Say what rule 6's anonymity actually buys (F4). OWNER DECISION.** Rule 6
forbids naming the author, and the round-4 rescue is *"the cost lands on on-call
and I am not the one carrying it, which is exactly why I distrust my own answer
here"* — first person, on an eleven-person round. Everyone will know who wrote
it. Three options, and they are a real trade: (a) accept it and say so in the
prompt, so the author of the prompt is not fooled either; (b) instruct
paraphrase-instead-of-quote for first-person answers on rounds under ~15 people,
which costs the verbatim evidence the rest of the prompt is built on; (c) leave
it and treat anonymity as a UI promise the summary cannot keep. **Cost of (a):**
one sentence. **Cost of (b):** weakens H9's rescue, the best thing the report
does. **If skipped:** the platform makes a promise at the round level that the
read-back quietly breaks, which is the kind of thing a room notices once and
remembers.

**7. The 400-word cap versus four evidence-bearing sections (F6). OWNER
DECISION.** Both reports landed at exactly 399 tokens after three trimming
passes, and evidence was cut — round 6 lost *"I do not spend writing anything"*
off the end of a quote — despite the prompt saying *"cut adjectives before you
cut evidence"*. Four sections each requiring at least one 15–25 word verbatim
quote does not fit in 400 words. Either raise the cap to 500 (~3.3 minutes
aloud, still projector-sized) or cut Discussion topics from three questions to
two. **Cost:** trivial to change, real to decide — it trades room airtime
against quoted evidence. **If skipped:** the cap is enforced by cutting the one
thing the prompt says to protect, every time, silently.

**8. Reconsider rule 2's blanket ban on ratios (F7). OWNER DECISION.** The
sharpest fact in round 6 is that the winning answer took 6 of the 7 first-place
votes cast; rule 2 forced *"on 6 first-place votes"* with the denominator
dropped, and forbade *"11 vote points ahead"* as arithmetic. A narrow exception —
*"you may state one count against one of the two counts of people given above,
in words"* — recovers it. **Cost:** reopens, by a crack, the door rule 2 exists
to close, and rule 2 is guarding against invented percentages, which is a defect
this repo has shipped twice. **If skipped:** the reports stay slightly duller
than the data, which is the cheaper failure. My recommendation is to skip it
unless a host complains.

**9. Two small ones.** Rule 12 should say *"do not begin the action after the
colon with…"* (F9 — one word, removes a fork). And **keep rules 11–13 exactly as
they are**: the paired weak/assignable example in rule 13 is, by the producer's
account and by the evidence of six well-formed next steps, the most effective
instruction in the prompt, because it shows a shape instead of describing one.

### 3B. The Workie mechanics

The product, not the session. D2 and D6 are here, not in 3A: no amount of
careful authoring makes a round's own instruction visible to the advisor, and
nothing in the platform tells an author that naming a variable in prose will
inline 2 KB of answers into their sentence.

**1. Expose the round's own `CustomInstruction` as a template variable (D6).**
The field is stored (`upload-questions.js:406`), served to players
(`get-question.js:150`), and dropped on the floor at summary time, where
`get-ai-summary.js:959-960` reads the **set**-level instruction instead. Add a
`{roundInstruction}` key sourced from the `question` object already in scope,
catalogue it, and let prompts opt in. **Cost:** one `templateVars` key, one
catalogue entry copied byte-identically into all three copies of
`template-variables.js`, one test. Small and low-risk — additive, no existing
prompt changes behaviour. **If skipped:** the advisor can never tell whether an
answer obeyed, stretched or refused the instruction the room was actually given,
and the most interesting single moment in this transcript — a player explicitly
declining the round's instruction and explaining why — is invisible to the one
component whose job is to notice what the tally hides.

**2. Make prose-inlining visible to prompt authors (D2).** Nothing warns an
author that `{responsesText}` inside a sentence becomes 2,244 characters of
answers. Two options, and I would do the cheap one first: **(a)** extend the
existing `unresolvedVariables` block in `get-ai-summary.js` with a
`variableUsage` entry in `debugInfo` — per token, rendered length and occurrence
count — and log a warning when any token resolves to more than ~200 characters
and occurs more than once. ~20 lines beside code that already walks every token,
no behaviour change, visible through `?debug=true`. **(b)** a save-time lint in
the prompt editor that flags the same condition before a prompt goes live.
**Cost:** (a) an afternoon; (b) UI work plus a threshold people will argue about.
**If skipped:** every future prompt author repeats D2, and the only existing gate
— the one H13 tests — passes a prompt with a third of its instructions ruined.

**3. Add an anonymity-state variable, and stop asking the model to sniff for
one.** There is no `hidden` / `authorsHidden` key in `templateVars`. Rule 7
therefore has to infer anonymity from the material's text: *"If the material
shows the answers written by 'a participant', use no names anywhere."* That is a
string comparison performed by a language model against a placeholder defined at
`get-ai-summary.js:1273`. Change the placeholder wording, or add a second
redaction form, and rule 7 silently stops working with no error anywhere.
**Cost:** one `templateVars` key plus catalogue entry and test; the redaction
itself already exists at `:1273-1281`. **If skipped:** the strongest guarantee
the product makes to a room — that a low-scoring answer will not be attributed —
depends on a model correctly noticing a two-word phrase. This is the mechanics
item I would do first after D6, because it fails silently and it fails on a
promise.

**4. Fix and enrich the variable catalogue (D11).** `voteTally`'s description
and example in `template-variables.js` describe a different variable's shape,
and no entry tells an author how large its value renders. Correct the
description, and add two fields: a rendered-size class (`inline` / `block`) and a
realistic length. **Cost:** an edit to three byte-identical copies plus
`tests/template-variable-catalogue.js`; the duplication is the annoying part.
**If skipped:** authors budget an 18 KB prompt from examples that are wrong about
content and silent about size, which is how this prompt ended up 40% tally.

**5. Retire or repair the excluded variables — the author's exclusions were
right, and the arithmetic is still live.** The prompt author deliberately
avoided `totalParticipants`, `activeParticipants`, `topVotedAnswers`,
`votingPattern` and `resultsSummary`. Confirmed by reading each one:

- `totalParticipants` (`:1286`) is `answers.length` — this round's answer count,
  not the room's size, and already exposed honestly as `{responseCount}`. The
  name invites exactly the misreading `78df15ca` removed. **Rename or drop from
  the advertised list.**
- `activeParticipants` (`:1542`) collapses to `answers.length` whenever a round
  has no votes, so it cannot distinguish "everyone voted" from "nobody voted".
  **Drop from the advertised list.**
- `participationRate` resolves to `''` by design and is still advertised, so it
  renders as nothing at all. **Either give it the session roster as a real
  denominator — which exists in `create-report.js` and not in the summary path —
  or unadvertise it.** OWNER DECISION: restoring it means plumbing the roster
  into `get-ai-summary.js`, which is a bigger change than it looks.
- `votingPattern` (D12) is live in the default prompt and compares points to
  voters. **Fix or remove.** This is not a style question; it is a wrong claim
  interpolated into a prompt that gets read aloud.
- `resultsSummary` (D13) can print over 100%. **Fix or remove before anyone
  uses it.**

**Cost:** each is small individually; the catalogue's triplicate copies and the
"live prompts must not break" constraint make the removals fiddlier than the
fixes. **If skipped:** the next prompt author picks one of these off a chip
palette that advertises them as safe, and the next `78df15ca` gets written.

**6. Give the harness a thin round, then a zero round (H14).**
`scripts/simulate-session.js` is the only artefact here that found defects
nothing else could — D1 and D3 were both invisible to unit tests over the
pieces. Add two fixture rounds: one answer, and none. That exercises rule 10's
two branches, rule 4's no-vote branch, `consensusLabel`'s *"Only one response"*
guard, and — separately, because it is a different trigger — `buildFallback()`
with the prompt or the model unavailable. **Cost:** harness-only, an hour or two,
zero production risk, deterministic and offline. **If skipped:** H14 stays
untested indefinitely, and the failure it names — a round nobody answered reading
like a round with nothing interesting in it — ships unobserved, which is the one
failure mode a room will read as the product lying to them.

**7. Run the harness in CI, and say who maintains it.** It is deterministic,
offline, needs no credentials, and completes in seconds; its cost is entirely in
keeping it honest when handlers change. **OWNER DECISION**, because an
unmaintained simulation that silently stops driving the real handlers is worse
than none. **If skipped:** the next prompt-assembly defect is found by a host, on
a projector, in front of the room.
