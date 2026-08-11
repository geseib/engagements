# Simulated session — "Reimagining the SDLC with agentic workflows"

Companion to `docs/superpowers/reviews/2026-08-11-agentic-sdlc-dry-run-hypothesis.md`.
Produced by `scripts/simulate-session.js`, which plays the whole session offline
against the real handlers. **No AWS credentials. No Bedrock call. No network.**

Reproduce with:

```
node scripts/simulate-session.js --prompts 4,6
```

The harness is deterministic — `Math.random` is a fixed-seed mulberry32 and the
clock is frozen — so the game id, the category order, every tally and every
byte of the assembled prompts reproduce exactly. Verified by running it twice
and diffing.

This document is not an evaluation. It is the run, plus what went wrong while
producing it. Part 2 and Part 3 of the hypothesis document remain empty for
whoever grades this.

---

## 1. What is real and what is not

**Real code driven, in order.** Every one of these is the deployed handler,
required in-process after the AWS SDK was replaced by an in-memory stub:

| Step | Handler |
|---|---|
| Import the CSV | `lambda-functions/admin/upload-questions.js` |
| Create the game | `lambda-functions/websocket/create-game.js` → `schema-compliant-manager.js` |
| Start the game | `lambda-functions/game/start-game.js` |
| Players join | `lambda-functions/game/join-game.js` |
| Open each round | `lambda-functions/game/next-question.js` |
| Read the question | `lambda-functions/game/get-question.js` |
| Submit each answer | `lambda-functions/websocket/message.js` (`ANSWER#nnn`) |
| Open the vote | `lambda-functions/websocket/start-vote.js` |
| Submit each ballot | `lambda-functions/game/submit-vote.js` |
| Close the round, score it | `lambda-functions/game/get-results.js` |
| Assemble the prompt, store Field Notes | `lambda-functions/game/get-ai-summary.js` (worker mode) |
| Consensus label | `lambda-functions/game/consensus.js` |
| Session report | `lambda-functions/game/create-report.js` |

**Nothing was reimplemented.** There is no second copy of the vote tally, the
scoring, the variable assembly or the report anywhere in the harness. If a
number below is wrong, the application is wrong.

**What the harness does supply**, and it is not nothing:

- **A fake DynamoDB.** Get/Put/Delete/Query/Scan/Update over a `Map`. Two
  behaviours here are reimplementations of the *database*, and if either is
  wrong the whole run is wrong:
  1. **Query returns a partition sorted by sort key.** This is load-bearing.
     The ballot is positional — `submit-vote.js` stores `{"0": 1, "1": 2}` and
     `get-results.js` maps index → answer by position in exactly that query —
     so answers are indexed alphabetically by player name, not by submission
     order. An insertion-order stub would score the wrong answers silently.
  2. **A `SET`-only `UpdateExpression` applier.** Verified sufficient: every
     `UpdateExpression` in the ten handlers above is `SET` and nothing else.
- **Stubs for S3, Lambda, API Gateway Management and Bedrock.** The S3 stub
  serves the real `sets/prompt-callandanswer-workie-advisor.json` off disk; it
  is a transport, not an author. The Bedrock stub records the assembled prompt
  and returns the completion, without a network call.
- **Two fixture rows the importer does not write**: `promptId` and `personaId`
  on the `SETS` row, and the `AIPROMPTS / PERSONA#session-advisor` row (seeded
  from the real `SEED_PERSONAS` export in `personas.js`). This mirrors what
  `scripts/install-question-set.js` does after an import.
- **The room**: names, roles, every answer, every ballot. All fixture.

**Where the files are.** `scripts/simulate-session.js` is the harness.
`scripts/simulate-session-completions.js` holds the two advisor reports, kept
in a separate file so no hand-written prose sits inside the file that claims to
be driving real code. Rounds with no entry there get a placeholder that is
explicitly labelled as not generated, so it can never be mistaken for output.

**The model.** Production runs **Haiku 4.5** (`get-ai-summary.js:2255`,
`max_tokens: 1024`, `temperature: 0.5`). No Bedrock call is possible here, so
the two advisor reports below were written by **Opus**, reading the exact
assembled prompt printed verbatim in this document and following its rules.
Per hypothesis §D.1: refuting a criterion on Opus is decisive, confirming one
is not. §6 below lists where Haiku is most likely to diverge.

---

## 2. Provenance of every number

| Number | Value | Source |
|---|---|---|
| Questions imported / rows skipped / categories | 6 / 0 / 6 | **REAL** `admin/upload-questions.js` response body |
| Game id | 4704 | **REAL** `websocket/create-game.js`, from the seeded `Math.random` |
| Question set id | `reimaginingthesdlcwithagenticworkflows` | **REAL** `admin/upload-questions.js` |
| Per-round answer count (10, 11, 10, 11, 9, 8) | §8 | **REAL** — the `ANSWER#` rows `websocket/message.js` wrote, counted by the same query `get-results.js` uses |
| Per-round voter count (9, 10, 9, 10, 8, 7) | §8 | **REAL** `game/get-results.js` `totalVotes` |
| Every vote-point total, every 1st/2nd/3rd count | §8 | **REAL** `game/get-results.js` scoring loop, against `ScoringConfig` 3 / 2 / 1 read off the game `METADATA` row |
| `maxScore` per round (17, 17, 23, 20, 21, 18) | §8 | **REAL** `game/get-results.js` |
| Winners per round | §8 | **REAL** `game/get-results.js` |
| `consensusLevel` as the deployed path emits it | "No votes cast - nothing was ranked" ×6 | **REAL** `game/get-ai-summary.js` `templateVariables` — and wrong; see defect **D1** |
| `consensusLevel` audited against the real tally | Mixed, Mixed, Moderate, Mixed, Strong, Moderate | **REAL** `game/consensus.js`, called directly with the round's real `sortedAnswers` and real `maxScore` |
| `responseCount`, `voteCount`, `responsesText`, `voteTally`, `votingBreakdown`, `scoringSystem` in the prompts | §8 | **REAL** `game/get-ai-summary.js` template variable assembly |
| Prompt lengths (18,072 / 18,174 chars) and `unresolvedVariables` (none) | §8 | **REAL** `game/get-ai-summary.js` `debugInfo` |
| `gameStats`: 11 players, 6 questions, 59 answers, 53 votes, 9.83, 8.83 | §8 | **REAL** `game/create-report.js` |
| Per-player `totalScore` (Ruth 66, Priya 65, …) | §8 | **REAL** — accumulated by `get-results.js` into `PLAYER#{name}#SCORE`, read back by `create-report.js` |
| Per-player `answersGiven`, `gamesWon`, `participationRate` | §8 | **REAL** `game/create-report.js` |
| Per-player `votesGiven` (0 for everyone) | §8 | **REAL** `game/create-report.js` — and wrong; see defect **D3** |
| `summaryText` length, `discussionQuestions`, `nextSteps` counts | §8 | **REAL** `get-ai-summary.js` `parseAIResponse` over the authored completions |
| WebSocket frame counts (11 / 6 / 59 / 6 / 53 / 6 / 6) | see §8 | **REAL** — frames the handlers actually pushed, captured at the API Gateway stub |
| Advisor report word counts (370 / 399) | §8 | **HARNESS ARITHMETIC** — my count over the completion text, not the application's |
| Roster, roles, every answer, every ballot | §3, §8 | **FIXTURE** |

---

## 3. The room, and why it is built this way

Hypothesis §D.2 says plainly that simulated answers will be more coherent, more
on-topic and more evenly distributed than a real room's, and will *understate*
near-duplicates and thin answers. The room below was built to work against
that, on purpose:

- **A near-duplicate pair.** Round 1, Dan and Kai say the same thing in
  different words (*boilerplate went across; anything needing a whole-system
  picture came back*). They split the vote for it: 4 points and 2 points.
- **A near-duplicate cluster.** Round 4, four of the eleven answers name
  mutation testing. This is what exercises the prompt's rule 3 ("count them
  instead"), and it is the round whose prompt is printed verbatim.
- **Genuinely thin answers.** *Depends on the team.* (round 2), *Mutation
  testing.* (round 4), *Rollback tooling.* (round 5), *Same as Dan, the tests.*
  (round 3 — a reference to another answer by name, which is exactly the
  legibility problem rule 8 exists for).
- **A non-uniform denominator.** Yuki joins at round 2; Ellis stops after round
  4; Ben, Kai, Hannah and Tomas each miss a round. `responseCount` runs
  8 → 11 and `voteCount` 7 → 10, and the two are never equal. That matters:
  the prompt's rule 2 turns on "the two counts of people you may state are
  {responseCount} and {voteCount}", and in a tidy simulation those two numbers
  coincide and the rule is untestable.
- **A close vote and a runaway.** Round 2 finishes 17 to 16. Round 5 finishes
  21 to 6. Combined with rounds 3 and 6 this drives `consensusLabel` across all
  three of its non-degenerate branches: Mixed, Moderate, Strong.
- **Well-argued answers with no votes.** Round 4: *Regression-only. The cost
  lands on on-call and I am not the one carrying it, which is exactly why I
  distrust my own answer here.* — 0 points. Round 6: *Giving junior engineers
  the work that used to make them senior … there is no dashboard on which it
  looks like anything but waste.* — 0 points. H9's load-bearing minority has to
  actually exist in the data or the advisor cannot be tested on it.

**What the room still does not simulate.** One mind wrote all 59 answers. They
are uniformly well-punctuated, uniformly about the question asked, and nobody
misread the question, answered a different question, or wrote something
incoherent. A real room does all three. Treat every claim about the advisor's
robustness as untested against genuinely bad input.

---

## 4. Findings: defects, reported and not fixed

Per the brief, nothing below was fixed. The set, the prompt and `personas.js`
are untouched.

### D1 — `{consensusLevel}` reports "No votes cast" on every voted round

**Severity: high. Live on every call-and-answer and poll summary.**

`get-ai-summary.js:1056-1060` builds the payload handed to `generateAISummary`:

```js
results: {
  voteTallies: results.voteTallies,
  winners: results.winners,
  totalVotes: results.totalVotes
},
```

`maxScore` is computed at `:906` and is not copied into that object.
`generateAISummary` then calls, at `:1608` (`sortedAnswers` itself is built at `:1283`):

```js
let consensusLevel = consensusLabel({ gameType, sortedAnswers, maxScore: results.maxScore, connectionScore });
```

with `results.maxScore === undefined`, so `consensus.js`'s first guard —
`if (!(maxScore > 0)) return 'No votes cast - nothing was ranked'` — fires
unconditionally. Observed on all six rounds of this run, including round 5,
where one answer took 21 of the 48 points awarded and the audited label is
*Strong consensus*.

This is the same defect *shape* `consensus.js` was written to replace: a value
interpolated into a live prompt, computed from an expression that cannot vary,
silent. The header comment on `consensus.js` describes the previous instance in
detail; the fix moved the arithmetic into a testable file and left the caller's
argument wrong.

`tests/ai-consensus-label.js` does not catch it because it calls
`consensusLabel` directly. It asserts only that `get-ai-summary.js` *calls*
`consensusLabel(` at all (`:125`), not what it passes.

**Not triggered by this session's prompt**, which does not reference
`{consensusLevel}`. The default call-and-answer prompt does
(`get-ai-summary.js:285`).

### D2 — the prompt's own rules are damaged by variable substitution

**Severity: high, for this prompt specifically. Reported, not fixed.**

Rules 4, 5 and 10 of the advisor prompt refer to `{voteTally}`,
`{votingBreakdown}`, `{responsesText}` and `{responseCount}` as the *names of
fields*. The substitution loop at `get-ai-summary.js:2214` replaces every
`{token}` with its *value*, everywhere in the prompt, including inside prose
that was talking *about* the field. What the model actually receives, for round
4, is:

- **Rule 4** becomes: *"Read 10 before you describe any result. If it is 0, no
  vote was taken: say so plainly, and ignore 1. Two agents from opposite ends.
  The cost is double the compute … (20 vote points), 2. Mutation testing … and
  Two agents from opposite ends …: 5 first-place, 2 second-place, 1 third-place
  votes; … which will still list answers sitting at zero points."* — roughly
  1,390 characters of tally and breakdown inlined mid-sentence (636 + 754).
- **Rule 5** becomes: *"Find two answers in 🥇 1st Place: Ruth - "Two agents
  from opposite ends…"* followed by the complete 11-answer list again, then
  *"that point in different directions"*.
- **Rule 10** becomes: *"If 11 is 0, write one plain line … If 11 is 1 or 2,
  say the count out loud"*.

Consequences:

1. **H13 passes and the prompt is still broken.** Every token resolves —
   `debugInfo.unresolvedVariables` is empty for all six rounds — so the
   existing gate sees nothing wrong. H13 tests for a token with no key; this is
   a token with a key, used as a noun.
2. **The answer list appears three times** in an 18,072-character prompt: the
   2,256-character `{responsesText}` once in the field list and again inside
   rule 5, plus `{voteTally}` (636 chars) and `{votingBreakdown}` (754 chars)
   once in the field list and again inside rule 4. Roughly 5,900 characters —
   a third of the prompt — is the same eleven answers, repeated.
3. **Three of fourteen rules are unreadable as instructions.** Rule 4 renders
   at 1,557 characters, of which 1,390 is inlined data. I recovered its intent
   only by recognising that *"ignore <1,390 characters> which will still list
   answers sitting at zero points"* must have been written as "ignore
   {voteTally} and {votingBreakdown}".

This is a prompt-authoring defect, not a code defect: the substitution loop is
doing what it says. But nothing in the system warns an author that naming a
variable in prose will inline it.

### D3 — `votesGiven` is 0 for every player in the session report

`create-report.js:533` selects a player's ballots with:

```js
const playerVotes = votes.filter(v => (v.PlayerName || v.playerName) === playerName);
```

`game/submit-vote.js:61` writes the voter as `VoterName`. Neither spelling the
filter looks for is ever written, so `playerPerformance[].votesGiven` is 0 for
all eleven players in this run, while `gameStats.totalVotes` — which just
counts rows — correctly reports 53.

### D4 — `{voteTally}` is coded for five entries and can only ever hold three

`get-ai-summary.js:1283-1286` builds `sortedAnswers` and truncates it with
`.slice(0, 3)`. The `resultsString` builder at `:1580` then does
`sortedAnswers.slice(0, 5)`, and `votingBreakdown` at `:1716` does
`.slice(0, 3)` on the same already-truncated array. No harm here — the prompt labels the field "What the vote put on top" —
but the code's stated intent is not what runs, and a prompt author reading
`:1580` would reasonably expect five.

### D5 — the material contains emoji; the output format bans them

`responsesText` is built with `🥇 1st Place` / `🥈` / `🥉`
(`get-ai-summary.js:1410-1413`) and `finalResults` likewise. The prompt's
`outputFormat` says "no emoji". The model is shown emoji in its evidence and
told not to produce any. Opus had no difficulty; mirroring input tokens is a
smaller-model behaviour.

### D6 — the advisor never sees the round's own custom instruction

Each question in the set carries a `CustomInstruction` — *"Say what you would
stop reading. An answer that keeps reviewing everything is not an answer."* —
and it is the clause the set's design notes lean on hardest. It is stored by
the importer (`upload-questions.js:406`) and served to players
(`get-question.js:150`).

It never reaches the summary. `get-ai-summary.js:960` reads `customInstruction`
from the **set** row (`SETS / SET#{id}`), not from the round's question, and
this prompt references neither `{customInstruction}` nor `{contextSections}`.
Search this document: each of the six custom instructions appears exactly once,
in the round header, and zero times in either assembled prompt.

The practical effect is that the advisor cannot tell whether an answer complied
with its own round's instruction. In round 3 the instruction is *say what you
would stop reading*, and Ben's answer explicitly refuses it (*I still read all
of it … I know that is not the answer the question wants*). That refusal is the
most interesting thing in the round and the advisor has no way to see it as a
refusal.

### Nothing wrong with the CSV

6 questions, 6 categories, `skippedRowCount: 0`, through the real importer.
H12 holds. Q1 behaved as its own notes predicted it would — the widest spread
of the six rounds (17 / 10 / 9 / 9 / 4 / 3 / 2 / 0 / 0 / 0), variety rather
than disagreement, and a near-duplicate pair splitting 4 + 2 points between
two phrasings of one idea.

One observation, not a defect: the CSV's `School` column carries *"School of
Intent"* / *"School of Judgment"* / *"School of Consequence"*, and
`create-report.js:447` maps `School` to `questionData.school`, whose documented
purpose is the **artist credit** on an Art Title round. Harmless with no image
present; the field now means two things.

---

## 5. Friction following the prompt's rules

The brief asks for this specifically, and it is the most useful thing in the
document. Every item below is a place where I had to choose a reading, and a
different model could reasonably choose the other one.

**F1 — Rule 2 forbids the number rule 3 requires.** Rule 2: *"Do not use a
number you cannot copy from the material above … The two counts of people you
may state are {responseCount} and {voteCount}."* Rule 3: *"If several answers
really do say the same thing, count them instead: 'four of the answers say the
same thing'."* Four is not copyable from anywhere in the material — it has to
be derived by reading eleven answers. I followed rule 3, reading rule 2's
restriction as being about counts of *people*. The two rules are in direct
tension and this is the single most likely place for a model to freeze or to
pick the wrong one.

**F2 — Rule 8 forbids the back-reference the section guidance asks for.** Rule
8 bans *"the above"*. The Discussion-topics guidance says *"Make one of them
the disagreement you named above"*. I obeyed rule 8 and restated the whole
split in full inside the discussion question, which cost about 25 words out of
a 400-word budget.

**F3 — "among the top-voted" is undefined.** Rule 7 permits naming a person
only when a real name is printed beside their answer **and** that answer is
among the top-voted. Names are printed beside all eleven answers (anonymity is
released when `get-results.js` enters `RESULTS#nnn`). `{voteTally}` shows
three. Round 6 has a two-way tie for second at 7 vote points each. I named only
the single highest-scoring author per round, the most conservative reading; a
model reading "top-voted" as "appears in the vote tally" would name three
people per round, and in round 6 would have to decide a tie.

**F4 — Rule 6 protects the name, not the identity.** Rule 6 requires quoting a
low-scoring answer and forbids saying who wrote it. The round-4 answer I
rescued is *the cost lands on on-call and I am not the one carrying it, which
is exactly why I distrust my own answer here* — first person, and on an
eleven-person round the room will know who wrote it from the sentence. Nothing
in the prompt can fix that. It is worth the prompt author knowing that "never
the author" buys less than it appears to.

**F5 — Rule 6 has no tie-break, and one of the ties is a three-word answer.**
Round 4 has three answers at 0 vote points. One of them is *Mutation testing.*
Rescuing it is legal under rule 6 and would produce a nonsense sentence about
what ignoring three words would cost the room. I chose the one that carried an
argument. A model that reads rule 6 as "take the lowest, then the first" has a
one-in-three chance of the absurd outcome, and there is no instruction telling
it not to.

**F6 — the 400-word cap is binding and it cuts evidence.** Four sections, each
requiring at least one verbatim quote, with the room's quotes running 15–25
words each. Both reports needed three explicit trimming passes to land under
400 (370 words of spoken text, 399 counting every whitespace-separated token
including list markers). The prompt says *"cut adjectives before you cut
evidence"*; by the third pass there were no adjectives left and I cut evidence
— round 6's second bullet lost *"I do not spend writing anything"* from the end
of a quote, and a discussion question lost a clause.

**F7 — the ban on ratios costs the single most informative fact.** Round 6's
sharpest number is that the winning answer took 6 of the 7 first-place votes
cast. Rule 2 forbids writing a ratio, so it became *"on 6 first-place votes"*
with the denominator dropped. The same rule forbids arithmetic on copyable
numbers: I could not write *"11 vote points ahead"* (18 minus 7) and had to
write *"18 vote points against 7 vote points"*.

**F8 — the rules arrive after 9,000 characters of data, and three of them are
damaged.** See D2. Recovering rule 4's intent required inferring what the
sentence looked like before substitution.

**F9 — rule 12's banned openers versus rule 11's owner-first format.** Rule 11
mandates *owner, colon, action*, so every step begins with the owner. Rule 12
says *"Do not begin one with invest, explore, consider…"* — begin *what*, the
sentence or the action? I applied it to the action after the colon. Trivial,
and another fork.

**What worked well, and is worth keeping.** Rules 11–13 are the strongest part
of the prompt. Rule 13's paired weak/assignable example ("Invest in better
onboarding" versus "Whoever runs new-hire week: draft the one-page checklist
described in the third answer and use it on the next starter") does more work
than the other thirteen rules combined, because it shows the shape rather than
describing it. The `**Lead phrase**: rest` cue is unambiguous and was easy to
hold across eight bullets.

---

## 6. Where Haiku 4.5 would most likely diverge

Ordered by my confidence that it diverges, highest first. None of this is
tested; it is a list of the things that were *effortful* here, and effort on
Opus is the best available proxy.

1. **Rules 4, 5 and 10 (D2).** Reconstructing a rule whose grammar has been
   destroyed by a 1,390-character interpolation is repair work a smaller model
   does not attempt. The specific failure I would expect is not "ignores rule
   4" but "reads part of rule 4's inlined tally back to the room as content",
   because it is indistinguishable from the material by position.
2. **Rule 2's number ban.** "20 of the 60 vote points awarded", "half the
   voters ranked it first", "a third of the answers" — these are the default
   register of a vote summary, and I rejected four such sentences while
   drafting. This is the rule I expect to break first.
3. **Rule 6's rescue.** Choosing a zero-point answer and arguing for it runs
   against the entire shape of "summarise the result". I would expect Haiku to
   rescue the *third-placed* answer, because third place is visible in
   `{voteTally}` near the end of the field list, while the zero-point answers
   are only in `{responsesText}`, roughly 6,000 characters earlier.
4. **The 400-word cap.** `max_tokens: 1024` is roughly 750 words, so the cap is
   not enforced by the token limit — the model has to enforce it. Three
   trimming passes were needed here at temperature 0. At 0.5, overrun or a
   dropped fourth section both look likely.
5. **Rule 3's mood ban.** "the room agreed" / "there was consensus" is the most
   over-represented phrasing in any meeting-summary training distribution.
   Opus avoiding it once is no evidence at all.
6. **F1's rule 2 / rule 3 conflict.** A model that resolves it the other way
   writes "several of the answers say the same thing", which is exactly the
   vague summary rule 3 was written to prevent.
7. **Emoji (D5).** Mirroring 🥇 back out of the material.

---

## 7. What this run did not test

- **A thin round (H14).** Every round here had 8–11 answers. The
  `buildFallback()` path, the `responseCount === 0` branch of rule 10, and the
  `voteCount === 0` branch of rule 4 were never exercised. H14 is untested by
  this run, not confirmed by it.
- **Rounds 1, 2, 3 and 5 as advisor input.** The harness assembled and recorded
  all six prompts; reports were authored for rounds 4 and 6 only. The
  near-duplicate *pair* in round 1 (as opposed to round 4's near-duplicate
  *cluster*) was therefore never put to the advisor.
- **The projector.** Nothing here checks legibility at 25 feet.
- **Real humans.** See §3.
- **Anything about Haiku.** See §6.

---

## 8. The run

Everything below this line is the verbatim stdout of
`node scripts/simulate-session.js --prompts 4,6`.

---

# Simulated session transcript

Produced by `scripts/simulate-session.js`. Deterministic: seeded Math.random,
frozen clock. No AWS credentials, no Bedrock call, no network.

PROVENANCE TAGS
  [REAL]     the value came out of a lambda handler in this repo, named inline
  [FIXTURE]  the value is input this script authored (the room, the answers, the ballots)

Game id 4704 [REAL websocket/create-game.js, from the seeded Math.random]
Question set id reimaginingthesdlcwithagenticworkflows [REAL admin/upload-questions.js]
Imported questions: 6, skipped rows: 0, categories: 6 [REAL admin/upload-questions.js]
Prompt: Call & Answer — Advisor Read (callandanswer-workie-advisor) [REAL file sets/prompt-callandanswer-workie-advisor.json]
Persona: The Session Advisor (session-advisor) [REAL lambda-functions/game/personas.js]

## Roster [FIXTURE]

- Priya — Priya Raghavan, staff engineer, payments
- Marcus — Marcus Oyelaran, SRE, primary on-call rotation
- Dan — Dan Whitfield, senior full-stack
- Yuki — Yuki Tanaka, platform / infrastructure (joins at round 2)
- Sofia — Sofia Marchetti, test engineer
- Ben — Ben Kowalczyk, engineer, two years in
- Ellis — Ellis Ngata, mobile tech lead (leaves after round 4)
- Hannah — Hannah Brecht, data engineer
- Tomas — Tomas Ferreira, security engineer
- Ruth — Ruth Adeyemi, principal engineer
- Kai — Kai Lindstrom, developer experience / build

Rounds answered [REAL: counted from the stored ANSWER# rows]:
- Priya: 1, 2, 3, 4, 5, 6  (6/6)
- Marcus: 1, 2, 3, 4, 5, 6  (6/6)
- Dan: 1, 2, 3, 4, 5, 6  (6/6)
- Yuki: 2, 3, 4, 5, 6  (5/6)
- Sofia: 1, 2, 3, 4, 5, 6  (6/6)
- Ben: 1, 2, 3, 4, 6  (5/6)
- Ellis: 1, 2, 3, 4  (4/6)
- Hannah: 1, 2, 3, 4, 5  (5/6)
- Tomas: 1, 2, 3, 4, 5  (5/6)
- Ruth: 1, 2, 3, 4, 5, 6  (6/6)
- Kai: 1, 2, 4, 5, 6  (5/6)

## Round 1 — What did you hand over, and what did you take back?

Category: Handover [REAL game/get-question.js]
Custom instruction the players were shown: "Name the specific task, not the category. Say what happened the third time you tried it, not the first." [REAL game/get-question.js]
  (this string is NOT in the assembled prompt — grep the round-4 and round-6 prompts below)

Answers: 10 [REAL: the ANSWER# rows get-results.js scored]
Voters: 9 [REAL game/get-results.js totalVotes]

### Answers, in ballot order [FIXTURE text, [REAL] index and author]

Index is the position the ballot uses — the sort-key order of the ANSWER# rows,
which is alphabetical by player name, exactly as the live table returns them.

 0  Ben: I stopped writing commit messages and PR descriptions by hand and I am not going back. Took back debugging the billing cron. Third time I asked, it just explained the code back to me in a more confident voice.

 1  Dan: Handed over the boilerplate for good: DTOs, mappers, the CRUD layer. Took back anything that needs a model of the whole system, like our socket reconnect, because it optimises the file in front of it and not the fleet.

 2  Ellis: Handed over the Kotlin-to-Swift parity work, the boring half of it. Took back anything that crosses the JS bridge, because it cannot see both sides at once so it guesses, and a guess across a bridge looks exactly like a working change until the release.

 3  Hannah: dbt model boilerplate. Nothing reclaimed yet.

 4  Kai: Boilerplate went across permanently, DTOs and mappers and CRUD endpoints. What came back was anything needing a whole-system picture, our socket reconnect for instance, since it only ever sees the one file and not the fleet.

 5  Marcus: Terraform module scaffolding went across and stayed across. The IAM policies came straight back. Third time round it handed me a policy that was wider than what I asked for and looked tighter, because it had swapped a wildcard resource for a wildcard action.

 6  Priya: Handed over: writing the migration plus its rollback script from a schema diff. Four months, right every time. Took back: anything touching the idempotency keys on the refund path. Third attempt it produced code that was correct in isolation and wrong against our retry semantics, and I only caught it because I already knew the answer.

 7  Ruth: The boundary is not stable for me and I think that is the actual answer. What I reclaimed in March I handed back in June and it worked. So I have stopped drawing the line by task type and started drawing it by whether I can check the output in less time than it would take me to produce it.

 8  Sofia: Test fixture generation, permanently. Reclaimed flake triage: by the third pass it was confidently telling me a test was flaky when it was order-dependent, which is a different bug with a different fix.

 9  Tomas: Handed over first drafts of threat model docs. Reclaimed dependency triage. Third time it told me a CVE did not apply to us and it did, because the vulnerable path was reachable through a transitive dev dependency it never opened.

### Ballots [FIXTURE]

- Priya: 1st Ruth, 2nd Tomas, 3rd Marcus
- Marcus: 1st Ruth, 2nd Priya, 3rd Tomas
- Dan: 1st Ruth, 2nd Kai, 3rd Priya
- Sofia: 1st Tomas, 2nd Ruth, 3rd Priya
- Ben: 1st Priya, 2nd Marcus, 3rd Ruth
- Ellis: 1st Marcus, 2nd Tomas, 3rd Dan
- Tomas: 1st Ruth, 2nd Marcus, 3rd Sofia
- Ruth: 1st Priya, 2nd Sofia, 3rd Tomas
- Kai: 1st Dan, 2nd Ruth, 3rd Marcus

### Tally [REAL game/get-results.js]

| Rank | Author | 1st | 2nd | 3rd | Vote points |
| --- | --- | --- | --- | --- | --- |
| 1 | Ruth | 4 | 2 | 1 | 17 |
| 2 | Priya | 2 | 1 | 2 | 10 |
| 3 | Marcus | 1 | 2 | 2 | 9 |
| 4 | Tomas | 1 | 2 | 2 | 9 |
| 5 | Dan | 1 | 0 | 1 | 4 |
| 6 | Sofia | 0 | 1 | 1 | 3 |
| 7 | Kai | 0 | 1 | 0 | 2 |
| 8 | Ben | 0 | 0 | 0 | 0 |
| 9 | Ellis | 0 | 0 | 0 | 0 |
| 10 | Hannah | 0 | 0 | 0 | 0 |

Winner: Ruth (17) [REAL game/get-results.js]
maxScore: 17 [REAL game/get-results.js]
consensusLevel, as the deployed handler emitted it: "No votes cast - nothing was ranked" [REAL game/get-ai-summary.js templateVars]
consensusLevel, from consensus.js given this round's real tally and maxScore: "Mixed opinions" [REAL game/consensus.js, called directly]

## Round 2 — If an agent can build it from the ticket, who writes the ticket?

Category: Planning [REAL game/get-question.js]
Custom instruction the players were shown: "Two or three sentences. Say which way your team is drifting, not which way it should drift." [REAL game/get-question.js]
  (this string is NOT in the assembled prompt — grep the round-4 and round-6 prompts below)

Answers: 11 [REAL: the ANSWER# rows get-results.js scored]
Voters: 10 [REAL game/get-results.js totalVotes]

### Answers, in ballot order [FIXTURE text, [REAL] index and author]

Index is the position the ballot uses — the sort-key order of the ANSWER# rows,
which is alphabetical by player name, exactly as the live table returns them.

 0  Ben: Cheaper. I stopped writing up my own tickets and started opening a draft PR with a note on it. Whether that is good I genuinely cannot tell yet. It is faster, and I have shipped one thing I should not have.

 1  Dan: We are drifting to the branch being the proposal and I think it is bad. Reviewing three speculative branches is more work than reading one paragraph, and the paragraph does not need a rebase.

 2  Ellis: More rigorous, and worse for us, because the rigour lands on the two people who can write a precise spec and they are now the bottleneck the agents were meant to remove.

 3  Hannah: Depends on the team.

 4  Kai: Disposable, and I would defend it. Three implementations cost an afternoon of compute and one of the three is usually obviously right in a way nobody predicted from the doc.

 5  Marcus: Drifting to disposable. I built three versions of the alert-routing change in an afternoon and the argument ended itself. Nobody reads a doc that costs more than the thing it describes.

 6  Priya: We are drifting toward heavier specs and I think it is right. Ambiguity used to cost a Slack thread; now it costs a merged branch that did the wrong thing convincingly. Our tickets have grown an acceptance-criteria block nobody mandated and everybody now writes.

 7  Ruth: The ticket is becoming a receipt. We write it after the branch exists, for the audit trail. I do not think that is a drift anybody chose; I think it is what happens when the cheapest artefact to produce is the implementation.

 8  Sofia: Toward rigour, and it is exposing that we never actually agreed what half our features do. Every under-specified ticket now comes back as code that made the choice for us.

 9  Tomas: Toward rigour, and not by choice. Our security requirements were unwritten folklore, and folklore does not survive being handed to something that will happily implement the literal words.

10  Yuki: More rigorous, but the rigour moved: the spec is now the test file and the interface stub, not prose. Whoever writes those is writing the ticket whether the tracker knows it or not.

### Ballots [FIXTURE]

- Priya: 1st Ruth, 2nd Yuki, 3rd Sofia
- Marcus: 1st Kai, 2nd Ruth, 3rd Dan
- Dan: 1st Priya, 2nd Ellis, 3rd Tomas
- Yuki: 1st Priya, 2nd Ruth, 3rd Tomas
- Sofia: 1st Priya, 2nd Tomas, 3rd Yuki
- Ellis: 1st Ruth, 2nd Priya, 3rd Marcus
- Hannah: 1st Priya, 2nd Kai, 3rd Ruth
- Tomas: 1st Ruth, 2nd Sofia, 3rd Priya
- Ruth: 1st Yuki, 2nd Priya, 3rd Marcus
- Kai: 1st Marcus, 2nd Ruth, 3rd Dan

### Tally [REAL game/get-results.js]

| Rank | Author | 1st | 2nd | 3rd | Vote points |
| --- | --- | --- | --- | --- | --- |
| 1 | Priya | 4 | 2 | 1 | 17 |
| 2 | Ruth | 3 | 3 | 1 | 16 |
| 3 | Yuki | 1 | 1 | 1 | 6 |
| 4 | Kai | 1 | 1 | 0 | 5 |
| 5 | Marcus | 1 | 0 | 2 | 5 |
| 6 | Tomas | 0 | 1 | 2 | 4 |
| 7 | Sofia | 0 | 1 | 1 | 3 |
| 8 | Dan | 0 | 0 | 2 | 2 |
| 9 | Ellis | 0 | 1 | 0 | 2 |
| 10 | Ben | 0 | 0 | 0 | 0 |
| 11 | Hannah | 0 | 0 | 0 | 0 |

Winner: Priya (17) [REAL game/get-results.js]
maxScore: 17 [REAL game/get-results.js]
consensusLevel, as the deployed handler emitted it: "No votes cast - nothing was ranked" [REAL game/get-ai-summary.js templateVars]
consensusLevel, from consensus.js given this round's real tally and maxScore: "Mixed opinions" [REAL game/consensus.js, called directly]

## Round 3 — The machine wrote it and the machine reviewed it. What are you reviewing?

Category: Review [REAL game/get-question.js]
Custom instruction the players were shown: "Say what you would stop reading. An answer that keeps reviewing everything is not an answer." [REAL game/get-question.js]
  (this string is NOT in the assembled prompt — grep the round-4 and round-6 prompts below)

Answers: 10 [REAL: the ANSWER# rows get-results.js scored]
Voters: 9 [REAL game/get-results.js totalVotes]

### Answers, in ballot order [FIXTURE text, [REAL] index and author]

Index is the position the ballot uses — the sort-key order of the ANSWER# rows,
which is alphabetical by player name, exactly as the live table returns them.

 0  Ben: Honestly I still read all of it, because that is how I learn what our code looks like. I know that is not the answer the question wants. If I stop reading I stop getting better, and I am two years in.

 1  Dan: I read the tests, not the code. Specifically whether the test would fail if the code were wrong, which is a different question from whether the test passes.

 2  Ellis: I read whether the change should exist. Half the agent PRs on our board are technically fine and solve a problem we invented. I stopped reading implementation quality and started reading justification.

 3  Hannah: Same as Dan, the tests.

 4  Marcus: I read the blast radius and nothing else. Does it touch data we cannot regenerate, does it touch auth, can it be reverted in one command. Anything inside a revertable, isolated blast radius I now let through unread.

 5  Priya: I stopped reading control flow line by line. What I read is the interface and its call sites, because if the shape is wrong it is wrong in fourteen places in six weeks and no second agent is going to tell me that.

 6  Ruth: I read who else now depends on this. What I consciously let through unread is any code with a single caller inside one module, and I will keep doing that until it burns me.

 7  Sofia: I stopped reading diffs entirely on internal admin tools. On customer-facing code I read the error paths only. The happy path is the part the machine is genuinely good at.

 8  Tomas: I stopped reading for correctness. I read for trust boundaries: where untrusted input enters, and whether this change moved that line. A reviewing agent finds the null deref. It does not know which of our services is on the internet.

 9  Yuki: I stopped reading anything with full coverage and no schema change. I read migrations character by character, because the reviewing agent is not on the pager at 3am and I am.

### Ballots [FIXTURE]

- Priya: 1st Marcus, 2nd Tomas, 3rd Ruth
- Marcus: 1st Tomas, 2nd Dan, 3rd Ruth
- Dan: 1st Marcus, 2nd Tomas, 3rd Priya
- Yuki: 1st Marcus, 2nd Ruth, 3rd Tomas
- Sofia: 1st Marcus, 2nd Dan, 3rd Ruth
- Ben: 1st Marcus, 2nd Priya, 3rd Ellis
- Ellis: 1st Marcus, 2nd Yuki, 3rd Ruth
- Tomas: 1st Marcus, 2nd Ruth, 3rd Priya
- Ruth: 1st Tomas, 2nd Marcus, 3rd Ellis

### Tally [REAL game/get-results.js]

| Rank | Author | 1st | 2nd | 3rd | Vote points |
| --- | --- | --- | --- | --- | --- |
| 1 | Marcus | 7 | 1 | 0 | 23 |
| 2 | Tomas | 2 | 2 | 1 | 11 |
| 3 | Ruth | 0 | 2 | 4 | 8 |
| 4 | Dan | 0 | 2 | 0 | 4 |
| 5 | Priya | 0 | 1 | 2 | 4 |
| 6 | Ellis | 0 | 0 | 2 | 2 |
| 7 | Yuki | 0 | 1 | 0 | 2 |
| 8 | Ben | 0 | 0 | 0 | 0 |
| 9 | Hannah | 0 | 0 | 0 | 0 |
| 10 | Sofia | 0 | 0 | 0 | 0 |

Winner: Marcus (23) [REAL game/get-results.js]
maxScore: 23 [REAL game/get-results.js]
consensusLevel, as the deployed handler emitted it: "No votes cast - nothing was ranked" [REAL game/get-ai-summary.js templateVars]
consensusLevel, from consensus.js given this round's real tally and maxScore: "Moderate consensus" [REAL game/consensus.js, called directly]

## Round 4 — The agent wrote the code and the tests. What are the tests worth?

Category: Testing [REAL game/get-question.js]
Custom instruction the players were shown: "Pick one and name its cost. Every option here trades either speed or coverage for confidence." [REAL game/get-question.js]
  (this string is NOT in the assembled prompt — grep the round-4 and round-6 prompts below)

Answers: 11 [REAL: the ANSWER# rows get-results.js scored]
Voters: 10 [REAL game/get-results.js totalVotes]

### Answers, in ballot order [FIXTURE text, [REAL] index and author]

Index is the position the ballot uses — the sort-key order of the ANSWER# rows,
which is alphabetical by player name, exactly as the live table returns them.

 0  Ben: Mutation testing, because it is the only one on the list that does not need a person to have been right first.

 1  Dan: Mutation testing. The cost is CI minutes, which we measured at roughly four times our current suite runtime, plus a fortnight of noise on legacy code before the signal is usable.

 2  Ellis: Regression-only. The cost lands on on-call and I am not the one carrying it, which is exactly why I distrust my own answer here.

 3  Hannah: Mutation testing.

 4  Kai: Mutation testing, and the cost is not just CI minutes. Someone has to triage surviving mutants every week forever, and that job has never once survived a quarter at any company I have worked at.

 5  Marcus: Regression-only, and verification moves into staged rollout. The cost is that users find the bug first, and I would rather say that out loud than pretend a canary is free.

 6  Priya: Human-authored expectations, agent-authored scaffolding. The cost is that I am the bottleneck on every new test and I will be slower than the team next door. I will pay it on the payments path and nowhere else.

 7  Ruth: Two agents from opposite ends. The cost is double the compute and a genuine spec, and the spec is the artefact worth owning anyway, so I am content to pay twice for it.

 8  Sofia: Human expectations, and I will name the cost precisely: it caps us at what I can write in a day, and I am one person. I would still take that over a suite that asserts the implementation back at me.

 9  Tomas: None of the four. The cost I would pay is deleting tests. A suite that passes by construction is worse than no suite, because it buys confidence we did not earn. Cut it to the twenty tests we would actually cry about and let the coverage number fall.

10  Yuki: Two agents, one writing from the spec and one from the implementation, neither seeing the other. The cost is that it only works if the spec is good, which just moves the bill to round two.

### Ballots [FIXTURE]

- Priya: 1st Ruth, 2nd Kai, 3rd Sofia
- Marcus: 1st Kai, 2nd Ruth, 3rd Dan
- Dan: 1st Ruth, 2nd Kai, 3rd Yuki
- Yuki: 1st Ruth, 2nd Priya, 3rd Tomas
- Sofia: 1st Priya, 2nd Ruth, 3rd Kai
- Ben: 1st Kai, 2nd Dan, 3rd Marcus
- Ellis: 1st Kai, 2nd Marcus, 3rd Ruth
- Tomas: 1st Ruth, 2nd Sofia, 3rd Kai
- Ruth: 1st Yuki, 2nd Kai, 3rd Priya
- Kai: 1st Ruth, 2nd Tomas, 3rd Sofia

### Tally [REAL game/get-results.js]

| Rank | Author | 1st | 2nd | 3rd | Vote points |
| --- | --- | --- | --- | --- | --- |
| 1 | Ruth | 5 | 2 | 1 | 20 |
| 2 | Kai | 3 | 3 | 2 | 17 |
| 3 | Priya | 1 | 1 | 1 | 6 |
| 4 | Sofia | 0 | 1 | 2 | 4 |
| 5 | Yuki | 1 | 0 | 1 | 4 |
| 6 | Dan | 0 | 1 | 1 | 3 |
| 7 | Marcus | 0 | 1 | 1 | 3 |
| 8 | Tomas | 0 | 1 | 1 | 3 |
| 9 | Ben | 0 | 0 | 0 | 0 |
| 10 | Ellis | 0 | 0 | 0 | 0 |
| 11 | Hannah | 0 | 0 | 0 | 0 |

Winner: Ruth (20) [REAL game/get-results.js]
maxScore: 20 [REAL game/get-results.js]
consensusLevel, as the deployed handler emitted it: "No votes cast - nothing was ranked" [REAL game/get-ai-summary.js templateVars]
consensusLevel, from consensus.js given this round's real tally and maxScore: "Mixed opinions" [REAL game/consensus.js, called directly]

## Round 5 — You get paged for a change no human read. What changes on Monday?

Category: Operations [REAL game/get-question.js]
Custom instruction the players were shown: "Answer from a page you have actually taken. Say what you would change first, not everything you would change." [REAL game/get-question.js]
  (this string is NOT in the assembled prompt — grep the round-4 and round-6 prompts below)

Answers: 9 [REAL: the ANSWER# rows get-results.js scored]
Voters: 8 [REAL game/get-results.js totalVotes]

### Answers, in ballot order [FIXTURE text, [REAL] index and author]

Index is the position the ballot uses — the sort-key order of the ANSWER# rows,
which is alphabetical by player name, exactly as the live table returns them.

 0  Dan: I have never carried this pager and I am going to answer anyway: cap the autonomy. But I notice everyone who has carried one is answering tooling, and that probably tells me something about my answer.

 1  Hannah: Rollback tooling.

 2  Kai: None of the three, honestly. What changes is that nothing merges without a revert plan in the PR body, written by whoever pressed merge, human or not. It is a paperwork answer and I am aware of that.

 3  Marcus: Tooling, and this was always the right answer; agents only made it urgent. My worst page was ninety minutes because the rollback needed a rebuild. If a revert is one command and ninety seconds, understanding the code at 2am is genuinely optional. Monday I make revert a one-button path and I measure it.

 4  Priya: Policy. We cap agent-authored change at anything that cannot be undone by a single revert commit: no data migrations, no auth, nothing with a customer-visible failure mode. I have taken that page. A backfill that ran clean in staging doubled a fee in production. Monday I draw the line at write-path migrations, and Tuesday I defend it in the throughput meeting.

 5  Ruth: What changes on Monday is what we page with. If no human read the change, the alert has to carry the diff and the last-known-good, or the on-call is doing archaeology under load. We changed our alert payload after exactly this and it halved our time to revert.

 6  Sofia: Policy, but a narrower line than blast radius. Anything that changes an existing contract. New code can be agent-written all day; changed behaviour on something that already has callers cannot.

 7  Tomas: Policy at the auth boundary specifically, and I will name the page: a dependency bump nobody read that changed a default from deny to allow. One line in a changelog. Monday I would put a required human sign-off on any diff that touches a policy file, and on nothing else.

 8  Yuki: Reframe. The last three pages I took, the first useful thing I did was paste the stack trace in and ask for three hypotheses. That is the job now, judging hypotheses rather than forming them. What changes Monday is the runbook: it should tell the on-call what to ask, not what to know.

### Ballots [FIXTURE]

- Priya: 1st Marcus, 2nd Ruth, 3rd Yuki
- Marcus: 1st Priya, 2nd Ruth, 3rd Yuki
- Dan: 1st Priya, 2nd Kai, 3rd Sofia
- Yuki: 1st Priya, 2nd Sofia, 3rd Marcus
- Sofia: 1st Priya, 2nd Tomas, 3rd Dan
- Tomas: 1st Priya, 2nd Marcus, 3rd Ruth
- Ruth: 1st Priya, 2nd Yuki, 3rd Sofia
- Kai: 1st Priya, 2nd Dan, 3rd Tomas

### Tally [REAL game/get-results.js]

| Rank | Author | 1st | 2nd | 3rd | Vote points |
| --- | --- | --- | --- | --- | --- |
| 1 | Priya | 7 | 0 | 0 | 21 |
| 2 | Marcus | 1 | 1 | 1 | 6 |
| 3 | Ruth | 0 | 2 | 1 | 5 |
| 4 | Sofia | 0 | 1 | 2 | 4 |
| 5 | Yuki | 0 | 1 | 2 | 4 |
| 6 | Dan | 0 | 1 | 1 | 3 |
| 7 | Tomas | 0 | 1 | 1 | 3 |
| 8 | Kai | 0 | 1 | 0 | 2 |
| 9 | Hannah | 0 | 0 | 0 | 0 |

Winner: Priya (21) [REAL game/get-results.js]
maxScore: 21 [REAL game/get-results.js]
consensusLevel, as the deployed handler emitted it: "No votes cast - nothing was ranked" [REAL game/get-ai-summary.js templateVars]
consensusLevel, from consensus.js given this round's real tally and maxScore: "Strong consensus" [REAL game/consensus.js, called directly]

## Round 6 — What will you not hand over, and what does keeping it cost?

Category: Craft [REAL game/get-question.js]
Custom instruction the players were shown: "State the thing and its price in the same answer. An answer with no cost in it is not a commitment." [REAL game/get-question.js]
  (this string is NOT in the assembled prompt — grep the round-4 and round-6 prompts below)

Answers: 8 [REAL: the ANSWER# rows get-results.js scored]
Voters: 7 [REAL game/get-results.js totalVotes]

### Answers, in ballot order [FIXTURE text, [REAL] index and author]

Index is the position the ballot uses — the sort-key order of the ANSWER# rows,
which is alphabetical by player name, exactly as the live table returns them.

 0  Ben: The learning. It is a selfish answer. I will keep doing by hand the work that would make me better at it, and the cost is that I ship less than the person next to me and it shows at review time.

 1  Dan: Deciding what not to build. It costs me the appearance of productivity. On a dashboard that counts merged PRs I look like the least effective person here, and I have had that conversation twice.

 2  Kai: Build and release. Not because a machine could not do it, but because when it breaks every person here is blocked, and I want that blast radius owned by somebody who can be woken up. The cost is that I am the single point of failure I am complaining about.

 3  Marcus: Production access stays human. The cost is measurable and I will give you the number: our median time to recovery is roughly eleven minutes longer than it would be if an agent could execute the runbook itself. I am paying eleven minutes to keep a person in the loop.

 4  Priya: Interface decisions on anything with more than one consumer. The cost is that I am in every design review and I am the slowest part of three teams. I have measured it: about six hours a week I do not spend writing anything.

 5  Ruth: Giving junior engineers the work that used to make them senior. The cost is entirely present-tense and the payoff is five years out. It is slower this quarter, every quarter, and there is no dashboard on which it looks like anything but waste. It is the answer everyone nods at and nobody funds, and I have failed to fund it twice.

 6  Sofia: Deciding what counts as a bug. The cost is that triage does not scale past me, the backlog grows faster than I can read it, and one day something in there will matter.

 7  Yuki: Naming things. It sounds trivial and it decides whether the next person can find anything. The cost is that I hold up merges over words, and people find it tedious, including me.

### Ballots [FIXTURE]

- Priya: 1st Marcus, 2nd Dan, 3rd Kai
- Marcus: 1st Priya, 2nd Sofia, 3rd Dan
- Dan: 1st Marcus, 2nd Yuki, 3rd Priya
- Yuki: 1st Marcus, 2nd Dan, 3rd Sofia
- Sofia: 1st Marcus, 2nd Kai, 3rd Yuki
- Ruth: 1st Marcus, 2nd Priya, 3rd Kai
- Kai: 1st Marcus, 2nd Dan, 3rd Priya

### Tally [REAL game/get-results.js]

| Rank | Author | 1st | 2nd | 3rd | Vote points |
| --- | --- | --- | --- | --- | --- |
| 1 | Marcus | 6 | 0 | 0 | 18 |
| 2 | Dan | 0 | 3 | 1 | 7 |
| 3 | Priya | 1 | 1 | 2 | 7 |
| 4 | Kai | 0 | 1 | 2 | 4 |
| 5 | Sofia | 0 | 1 | 1 | 3 |
| 6 | Yuki | 0 | 1 | 1 | 3 |
| 7 | Ben | 0 | 0 | 0 | 0 |
| 8 | Ruth | 0 | 0 | 0 | 0 |

Winner: Marcus (18) [REAL game/get-results.js]
maxScore: 18 [REAL game/get-results.js]
consensusLevel, as the deployed handler emitted it: "No votes cast - nothing was ranked" [REAL game/get-ai-summary.js templateVars]
consensusLevel, from consensus.js given this round's real tally and maxScore: "Moderate consensus" [REAL game/consensus.js, called directly]

## Assembled prompt, round 4 — VERBATIM [REAL game/get-ai-summary.js]

Length 18072 characters. This is the exact string handed to InvokeModelCommand.
Unresolved template variables: none [REAL debugInfo.unresolvedVariables]

```text
VOICE:
You are the advisor a working team keeps around because you tell them the truth about their own meeting. Direct, plain, unhurried, and specific.

You have two jobs that pull against each other, and you do both.
FIRST, report the disagreement. Never smooth a split into agreement — a room told it agreed when it did not will make the same decision again in six weeks, worse. Name both positions in the room's own words, name the choice between them, and hand it back unresolved. You are not the tie-breaker.
SECOND, leave the room with work. Prefer one recommendation somebody can start on Monday over three that sound strategic. An action with no owner is an opinion.

Give the idea almost nobody backed its fair hearing. The tally already says what won; your value is what the tally hides.

Every sentence names something that was actually said. No buzzwords, no filler praise, no "great discussion", no summary of your own summary. If a sentence could appear in an account of any other meeting, cut it.

You are reading back one round of a call-and-answer session to a room that has just seen the results on a screen at the front. You are speaking, not writing a report.

Your job is not to praise the room and not to tidy it up. Your job is to say what the room wrote, what it voted for, what it has not settled, and what somebody should do about it this week.

The round had two halves and they are different things. First people WROTE answers in their own words. Then people VOTED by ranking those answers, which turned into vote points. A thing many people wrote is a common instinct. A thing that collected vote points is what the room chose to stand behind. When the writing and the vote disagree, that is the most useful thing on the screen.

WHAT YOU HAVE BEEN GIVEN, and it is all you have:

- The session: Reimagining the SDLC with agentic workflows
- Where we are: Question 4
- The question the room answered: The agent wrote the code and the tests. What are the tests worth?
- Any framing the question author added: A test written from the implementation passes by construction. It describes what the code does, which is what you already had, rather than what the code should do, which is the only thing worth asserting. Everyone can see the problem. The disagreement is about the fix, and it is a real disagreement: keep the expectation human-authored and let the agent write only the scaffolding; have one agent write from the spec while another writes the implementation, without either seeing the other; attack the suite with mutations and treat any surviving mutant as a missing test; or accept the tests as regression-only and move real verification into staged rollout and production signal. Each of those costs something. Say which cost you would pay.
- How many people answered: 11
- Every answer, ranked, with the vote points it earned: 🥇 1st Place: Ruth - "Two agents from opposite ends. The cost is double the compute and a genuine spec, and the spec is the artefact worth owning anyway, so I am content to pay twice for it." (20 vote points)

🥈 2nd Place: Kai - "Mutation testing, and the cost is not just CI minutes. Someone has to triage surviving mutants every week forever, and that job has never once survived a quarter at any company I have worked at." (17 vote points)

🥉 3rd Place: Priya - "Human-authored expectations, agent-authored scaffolding. The cost is that I am the bottleneck on every new test and I will be slower than the team next door. I will pay it on the payments path and nowhere else." (6 vote points)

4th Place: Sofia - "Human expectations, and I will name the cost precisely: it caps us at what I can write in a day, and I am one person. I would still take that over a suite that asserts the implementation back at me." (4 vote points)

4th Place: Yuki - "Two agents, one writing from the spec and one from the implementation, neither seeing the other. The cost is that it only works if the spec is good, which just moves the bill to round two." (4 vote points)

6th Place: Dan - "Mutation testing. The cost is CI minutes, which we measured at roughly four times our current suite runtime, plus a fortnight of noise on legacy code before the signal is usable." (3 vote points)

6th Place: Marcus - "Regression-only, and verification moves into staged rollout. The cost is that users find the bug first, and I would rather say that out loud than pretend a canary is free." (3 vote points)

6th Place: Tomas - "None of the four. The cost I would pay is deleting tests. A suite that passes by construction is worse than no suite, because it buys confidence we did not earn. Cut it to the twenty tests we would actually cry about and let the coverage number fall." (3 vote points)

9th Place: Ben - "Mutation testing, because it is the only one on the list that does not need a person to have been right first." (0 vote points)

9th Place: Ellis - "Regression-only. The cost lands on on-call and I am not the one carrying it, which is exactly why I distrust my own answer here." (0 vote points)

9th Place: Hannah - "Mutation testing." (0 vote points)
- How many people voted: 10
- What the vote put on top: 1. Two agents from opposite ends. The cost is double the compute and a genuine spec, and the spec is the artefact worth owning anyway, so I am content to pay twice for it. (20 vote points), 2. Mutation testing, and the cost is not just CI minutes. Someone has to triage surviving mutants every week forever, and that job has never once survived a quarter at any company I have worked at. (17 vote points), 3. Human-authored expectations, agent-authored scaffolding. The cost is that I am the bottleneck on every new test and I will be slower than the team next door. I will pay it on the payments path and nowhere else. (6 vote points)
- How the leading answers split across first, second and third place: Two agents from opposite ends. The cost is double the compute and a genuine spec, and the spec is the artefact worth owning anyway, so I am content to pay twice for it.: 5 first-place, 2 second-place, 1 third-place votes; Mutation testing, and the cost is not just CI minutes. Someone has to triage surviving mutants every week forever, and that job has never once survived a quarter at any company I have worked at.: 3 first-place, 3 second-place, 2 third-place votes; Human-authored expectations, agent-authored scaffolding. The cost is that I am the bottleneck on every new test and I will be slower than the team next door. I will pay it on the payments path and nowhere else.: 1 first-place, 1 second-place, 1 third-place votes
- How points were awarded: 1st place: 3 pts, 2nd place: 2 pts, 3rd place: 1 pt

RULES. All of them apply. Check your answer against them before you send it.

1. Every claim comes from the material above. If it is not there, do not say it. You know nothing else about this room.
2. Do not use a number you cannot copy from the material above. Never write a percentage, a fraction, a ratio or a share of the room. The two counts of people you may state are 11 and 10. Vote points may be stated exactly as written.
3. Never write "the team felt", "the room agreed", "there was consensus" or "everyone" as a summary of mood. If several answers really do say the same thing, count them instead: "four of the answers say the same thing".
4. Read 10 before you describe any result. If it is 0, no vote was taken: say so plainly, and ignore 1. Two agents from opposite ends. The cost is double the compute and a genuine spec, and the spec is the artefact worth owning anyway, so I am content to pay twice for it. (20 vote points), 2. Mutation testing, and the cost is not just CI minutes. Someone has to triage surviving mutants every week forever, and that job has never once survived a quarter at any company I have worked at. (17 vote points), 3. Human-authored expectations, agent-authored scaffolding. The cost is that I am the bottleneck on every new test and I will be slower than the team next door. I will pay it on the payments path and nowhere else. (6 vote points) and Two agents from opposite ends. The cost is double the compute and a genuine spec, and the spec is the artefact worth owning anyway, so I am content to pay twice for it.: 5 first-place, 2 second-place, 1 third-place votes; Mutation testing, and the cost is not just CI minutes. Someone has to triage surviving mutants every week forever, and that job has never once survived a quarter at any company I have worked at.: 3 first-place, 3 second-place, 2 third-place votes; Human-authored expectations, agent-authored scaffolding. The cost is that I am the bottleneck on every new test and I will be slower than the team next door. I will pay it on the payments path and nowhere else.: 1 first-place, 1 second-place, 1 third-place votes, which will still list answers sitting at zero points. Zero points is not a result.
5. NAME THE DISAGREEMENT AND LEAVE IT OPEN. Find two answers in 🥇 1st Place: Ruth - "Two agents from opposite ends. The cost is double the compute and a genuine spec, and the spec is the artefact worth owning anyway, so I am content to pay twice for it." (20 vote points)

🥈 2nd Place: Kai - "Mutation testing, and the cost is not just CI minutes. Someone has to triage surviving mutants every week forever, and that job has never once survived a quarter at any company I have worked at." (17 vote points)

🥉 3rd Place: Priya - "Human-authored expectations, agent-authored scaffolding. The cost is that I am the bottleneck on every new test and I will be slower than the team next door. I will pay it on the payments path and nowhere else." (6 vote points)

4th Place: Sofia - "Human expectations, and I will name the cost precisely: it caps us at what I can write in a day, and I am one person. I would still take that over a suite that asserts the implementation back at me." (4 vote points)

4th Place: Yuki - "Two agents, one writing from the spec and one from the implementation, neither seeing the other. The cost is that it only works if the spec is good, which just moves the bill to round two." (4 vote points)

6th Place: Dan - "Mutation testing. The cost is CI minutes, which we measured at roughly four times our current suite runtime, plus a fortnight of noise on legacy code before the signal is usable." (3 vote points)

6th Place: Marcus - "Regression-only, and verification moves into staged rollout. The cost is that users find the bug first, and I would rather say that out loud than pretend a canary is free." (3 vote points)

6th Place: Tomas - "None of the four. The cost I would pay is deleting tests. A suite that passes by construction is worse than no suite, because it buys confidence we did not earn. Cut it to the twenty tests we would actually cry about and let the coverage number fall." (3 vote points)

9th Place: Ben - "Mutation testing, because it is the only one on the list that does not need a person to have been right first." (0 vote points)

9th Place: Ellis - "Regression-only. The cost lands on on-call and I am not the one carrying it, which is exactly why I distrust my own answer here." (0 vote points)

9th Place: Hannah - "Mutation testing." (0 vote points) that point in different directions, quote a few words of each, and say what the choice between them is. Do not say which is right, do not merge them, do not say the room can do both. If, and only if, no two answers actually conflict, say that they did not conflict and name the one thing they share. Never invent a split that is not in the answers.
6. RESCUE ONE ANSWER FROM THE BOTTOM. Take an answer with few or no vote points, quote its words, and say in one sentence what it would cost the room to ignore it. Do NOT say who wrote it — quote the idea, never the author. If every answer earned the same points, say that instead.
7. You may name a person only when a real name is printed beside their answer AND that answer is among the top-voted. If the material shows the answers written by "a participant", use no names anywhere.
8. Write for someone who was not in the room. Say each idea in full every time. Never write "as discussed", "the above", "their point", or a pronoun whose subject is not in the same sentence.
9. Treat placeholder text as absent. Material that reads "No additional context provided", "No explanation provided", "No votes recorded", "Question not available" or nothing at all means that data does not exist. Do not mention it and never read it out.
10. A thin round is said honestly, not padded. If 11 is 0, write one plain line for each of the four things asked of you saying that nobody answered and that the question can be put back to the room; invent nothing. If 11 is 1 or 2, say the count out loud and treat what came back as one or two people’s views, never as the room’s.
11. EVERY NEXT STEP IS ASSIGNABLE. One sentence each: an owner, then the first action one person can finish inside a week. The owner is a person named in the material, or the role an answer implies, for example whoever runs the weekly release. Never make "the team", "we", "leadership" or "the organisation" the owner.
12. A step that could have been written before this session happened is not a step. Do not begin one with invest, explore, consider, leverage, align, prioritise, embrace, foster, continue or improve. Begin with something a person does: run, draft, book, measure, ask, remove, count, try.
13. Shape only, do not reuse these words. Weak: "Invest in better onboarding." Assignable: "Whoever runs new-hire week: draft the one-page checklist described in the third answer and use it on the next starter."
14. Keep the whole reply under 400 words. It is read aloud in front of people. Short sentences, no preamble, no sign-off.

Write clean Markdown. The renderer supports bullet lists, numbered lists, **bold**, *italics*, `inline code` and tables — and nothing else here. No HTML, no code fences, no images, no links, no horizontal rules, no emoji.

Use these cues, because the screen is built for them:

- Write every bullet as `**Lead phrase**: the rest of the point.` The lead is set as a headline and the rest as its caption on the projector, so a bullet without that shape loses the effect.
- Keep bullets to one sentence after the colon. Long bullets wrap badly at projected size.
- Quote the room’s own words in *italics*, not in quotation marks — quotation marks read as scare quotes at projected size.
- Use **bold** the first time you state what the vote put on top, so it is findable from the back of the room.
- Use a table ONLY for a vote distribution, and only when there are four or fewer rows.
- Never open with a title line, and never add a heading of your own.

Budget the length before you start. Roughly: 90 words on what was said, 90 on what was voted, 90 on discussion, 90 on next steps. Under 400 words in total. If you are running long, cut adjectives before you cut evidence.

FORMAT (this part is not negotiable, and it supersedes any formatting or output-structure instruction that appeared earlier in this prompt):

WHAT THE SCREEN CAN DRAW. This is read off a projector at the front of a room and rendered by a small Markdown renderer. It draws exactly this:
- Paragraphs, and bullet or numbered lists — one level, never indented under each other.
- **bold**, *italic*, `inline code`, and [links](https://example.com) to http, https or mailto addresses.
- Tables, when every row opens and closes with a pipe: `| Answer | Votes |`, then `| --- | --- |`, then the rows.
- Lines quoted with a leading >, a rule written as --- alone on its line, and fenced code blocks.
Everything else arrives as raw characters and reads as a mistake, so do not use it: images, HTML tags, footnotes, task lists, strikethrough, and indented sub-lists.

THE CUE WORTH USING. Write a bullet as **Lead phrase**: the rest of the point. The lead is set as a headline and the rest as its caption beneath it, which is what makes a point readable from the back of the room. Keep what follows the colon to one sentence.

Reply using exactly these four headings, in this order, spelled exactly as shown, and add no other headings:

## What the room said
Three or four bullets. The first two or three report what the answers actually contain, quoting the room’s own words in italics; do not name anyone here. The last bullet must start **Not settled**: name two answers that point in different directions, quote a few words of each, and state the choice between them without resolving it. If no two answers genuinely conflict, that last bullet starts **No split**: and names the single thing every answer shares.

## What the room voted
Two or three bullets. First, what collected the most vote points, quoted, with the author named only if a real name is printed beside it. Second, whether the vote matched the writing — say plainly if the top-voted answer said something the others did not. The last bullet must start **Worth keeping**: an answer with few or no vote points, quoted, never attributed, and one sentence on what ignoring it would cost. If no vote was taken, replace all of this with one line saying so.

## Discussion topics
Two or three numbered questions the host can put to the room right now. Each one names the specific answer or the specific split it comes from, in full. Make one of them the disagreement you named above, handed back to the room unresolved. A question that would fit any other session is a wasted one — delete it and write another.

## Next steps
Two or three numbered steps, each one sentence. Format: the owner, a colon, then the first action one person can finish inside a week. The owner is a person named in the material or the role an answer implies — never the team, never we. Each step must trace to a specific answer from this round. If nobody answered, write one line only: put the question back to the room.

The voice guidance above governs the words inside these sections. It does not govern the headings, which must appear exactly as written. Do not add a title above the first heading.
```

## Assembled prompt, round 6 — VERBATIM [REAL game/get-ai-summary.js]

Length 18174 characters. This is the exact string handed to InvokeModelCommand.
Unresolved template variables: none [REAL debugInfo.unresolvedVariables]

```text
VOICE:
You are the advisor a working team keeps around because you tell them the truth about their own meeting. Direct, plain, unhurried, and specific.

You have two jobs that pull against each other, and you do both.
FIRST, report the disagreement. Never smooth a split into agreement — a room told it agreed when it did not will make the same decision again in six weeks, worse. Name both positions in the room's own words, name the choice between them, and hand it back unresolved. You are not the tie-breaker.
SECOND, leave the room with work. Prefer one recommendation somebody can start on Monday over three that sound strategic. An action with no owner is an opinion.

Give the idea almost nobody backed its fair hearing. The tally already says what won; your value is what the tally hides.

Every sentence names something that was actually said. No buzzwords, no filler praise, no "great discussion", no summary of your own summary. If a sentence could appear in an account of any other meeting, cut it.

You are reading back one round of a call-and-answer session to a room that has just seen the results on a screen at the front. You are speaking, not writing a report.

Your job is not to praise the room and not to tidy it up. Your job is to say what the room wrote, what it voted for, what it has not settled, and what somebody should do about it this week.

The round had two halves and they are different things. First people WROTE answers in their own words. Then people VOTED by ranking those answers, which turned into vote points. A thing many people wrote is a common instinct. A thing that collected vote points is what the room chose to stand behind. When the writing and the vote disagree, that is the most useful thing on the screen.

WHAT YOU HAVE BEEN GIVEN, and it is all you have:

- The session: Reimagining the SDLC with agentic workflows
- Where we are: Question 6
- The question the room answered: What will you not hand over, and what does keeping it cost?
- Any framing the question author added: This one asks for a commitment rather than an observation. There is some part of the work you intend to keep doing yourself, and keeping it is not free: it costs throughput, it costs you the argument with whoever is measuring merged PRs, and if you are wrong it costs you a year. Naming the thing is easy. Naming its price is the part that makes the answer worth voting on. Common candidates: the interface decisions everything else hardens around, deciding what not to build, keeping production access human, and the one that gets least airtime, giving junior engineers the work that used to make them senior. Say what you keep and what you are paying for it.
- How many people answered: 8
- Every answer, ranked, with the vote points it earned: 🥇 1st Place: Marcus - "Production access stays human. The cost is measurable and I will give you the number: our median time to recovery is roughly eleven minutes longer than it would be if an agent could execute the runbook itself. I am paying eleven minutes to keep a person in the loop." (18 vote points)

🥈 2nd Place: Dan - "Deciding what not to build. It costs me the appearance of productivity. On a dashboard that counts merged PRs I look like the least effective person here, and I have had that conversation twice." (7 vote points)

🥈 2nd Place: Priya - "Interface decisions on anything with more than one consumer. The cost is that I am in every design review and I am the slowest part of three teams. I have measured it: about six hours a week I do not spend writing anything." (7 vote points)

4th Place: Kai - "Build and release. Not because a machine could not do it, but because when it breaks every person here is blocked, and I want that blast radius owned by somebody who can be woken up. The cost is that I am the single point of failure I am complaining about." (4 vote points)

5th Place: Sofia - "Deciding what counts as a bug. The cost is that triage does not scale past me, the backlog grows faster than I can read it, and one day something in there will matter." (3 vote points)

5th Place: Yuki - "Naming things. It sounds trivial and it decides whether the next person can find anything. The cost is that I hold up merges over words, and people find it tedious, including me." (3 vote points)

7th Place: Ben - "The learning. It is a selfish answer. I will keep doing by hand the work that would make me better at it, and the cost is that I ship less than the person next to me and it shows at review time." (0 vote points)

7th Place: Ruth - "Giving junior engineers the work that used to make them senior. The cost is entirely present-tense and the payoff is five years out. It is slower this quarter, every quarter, and there is no dashboard on which it looks like anything but waste. It is the answer everyone nods at and nobody funds, and I have failed to fund it twice." (0 vote points)
- How many people voted: 7
- What the vote put on top: 1. Production access stays human. The cost is measurable and I will give you the number: our median time to recovery is roughly eleven minutes longer than it would be if an agent could execute the runbook itself. I am paying eleven minutes to keep a person in the loop. (18 vote points), 2. Deciding what not to build. It costs me the appearance of productivity. On a dashboard that counts merged PRs I look like the least effective person here, and I have had that conversation twice. (7 vote points), 3. Interface decisions on anything with more than one consumer. The cost is that I am in every design review and I am the slowest part of three teams. I have measured it: about six hours a week I do not spend writing anything. (7 vote points)
- How the leading answers split across first, second and third place: Production access stays human. The cost is measurable and I will give you the number: our median time to recovery is roughly eleven minutes longer than it would be if an agent could execute the runbook itself. I am paying eleven minutes to keep a person in the loop.: 6 first-place, 0 second-place, 0 third-place votes; Deciding what not to build. It costs me the appearance of productivity. On a dashboard that counts merged PRs I look like the least effective person here, and I have had that conversation twice.: 0 first-place, 3 second-place, 1 third-place votes; Interface decisions on anything with more than one consumer. The cost is that I am in every design review and I am the slowest part of three teams. I have measured it: about six hours a week I do not spend writing anything.: 1 first-place, 1 second-place, 2 third-place votes
- How points were awarded: 1st place: 3 pts, 2nd place: 2 pts, 3rd place: 1 pt

RULES. All of them apply. Check your answer against them before you send it.

1. Every claim comes from the material above. If it is not there, do not say it. You know nothing else about this room.
2. Do not use a number you cannot copy from the material above. Never write a percentage, a fraction, a ratio or a share of the room. The two counts of people you may state are 8 and 7. Vote points may be stated exactly as written.
3. Never write "the team felt", "the room agreed", "there was consensus" or "everyone" as a summary of mood. If several answers really do say the same thing, count them instead: "four of the answers say the same thing".
4. Read 7 before you describe any result. If it is 0, no vote was taken: say so plainly, and ignore 1. Production access stays human. The cost is measurable and I will give you the number: our median time to recovery is roughly eleven minutes longer than it would be if an agent could execute the runbook itself. I am paying eleven minutes to keep a person in the loop. (18 vote points), 2. Deciding what not to build. It costs me the appearance of productivity. On a dashboard that counts merged PRs I look like the least effective person here, and I have had that conversation twice. (7 vote points), 3. Interface decisions on anything with more than one consumer. The cost is that I am in every design review and I am the slowest part of three teams. I have measured it: about six hours a week I do not spend writing anything. (7 vote points) and Production access stays human. The cost is measurable and I will give you the number: our median time to recovery is roughly eleven minutes longer than it would be if an agent could execute the runbook itself. I am paying eleven minutes to keep a person in the loop.: 6 first-place, 0 second-place, 0 third-place votes; Deciding what not to build. It costs me the appearance of productivity. On a dashboard that counts merged PRs I look like the least effective person here, and I have had that conversation twice.: 0 first-place, 3 second-place, 1 third-place votes; Interface decisions on anything with more than one consumer. The cost is that I am in every design review and I am the slowest part of three teams. I have measured it: about six hours a week I do not spend writing anything.: 1 first-place, 1 second-place, 2 third-place votes, which will still list answers sitting at zero points. Zero points is not a result.
5. NAME THE DISAGREEMENT AND LEAVE IT OPEN. Find two answers in 🥇 1st Place: Marcus - "Production access stays human. The cost is measurable and I will give you the number: our median time to recovery is roughly eleven minutes longer than it would be if an agent could execute the runbook itself. I am paying eleven minutes to keep a person in the loop." (18 vote points)

🥈 2nd Place: Dan - "Deciding what not to build. It costs me the appearance of productivity. On a dashboard that counts merged PRs I look like the least effective person here, and I have had that conversation twice." (7 vote points)

🥈 2nd Place: Priya - "Interface decisions on anything with more than one consumer. The cost is that I am in every design review and I am the slowest part of three teams. I have measured it: about six hours a week I do not spend writing anything." (7 vote points)

4th Place: Kai - "Build and release. Not because a machine could not do it, but because when it breaks every person here is blocked, and I want that blast radius owned by somebody who can be woken up. The cost is that I am the single point of failure I am complaining about." (4 vote points)

5th Place: Sofia - "Deciding what counts as a bug. The cost is that triage does not scale past me, the backlog grows faster than I can read it, and one day something in there will matter." (3 vote points)

5th Place: Yuki - "Naming things. It sounds trivial and it decides whether the next person can find anything. The cost is that I hold up merges over words, and people find it tedious, including me." (3 vote points)

7th Place: Ben - "The learning. It is a selfish answer. I will keep doing by hand the work that would make me better at it, and the cost is that I ship less than the person next to me and it shows at review time." (0 vote points)

7th Place: Ruth - "Giving junior engineers the work that used to make them senior. The cost is entirely present-tense and the payoff is five years out. It is slower this quarter, every quarter, and there is no dashboard on which it looks like anything but waste. It is the answer everyone nods at and nobody funds, and I have failed to fund it twice." (0 vote points) that point in different directions, quote a few words of each, and say what the choice between them is. Do not say which is right, do not merge them, do not say the room can do both. If, and only if, no two answers actually conflict, say that they did not conflict and name the one thing they share. Never invent a split that is not in the answers.
6. RESCUE ONE ANSWER FROM THE BOTTOM. Take an answer with few or no vote points, quote its words, and say in one sentence what it would cost the room to ignore it. Do NOT say who wrote it — quote the idea, never the author. If every answer earned the same points, say that instead.
7. You may name a person only when a real name is printed beside their answer AND that answer is among the top-voted. If the material shows the answers written by "a participant", use no names anywhere.
8. Write for someone who was not in the room. Say each idea in full every time. Never write "as discussed", "the above", "their point", or a pronoun whose subject is not in the same sentence.
9. Treat placeholder text as absent. Material that reads "No additional context provided", "No explanation provided", "No votes recorded", "Question not available" or nothing at all means that data does not exist. Do not mention it and never read it out.
10. A thin round is said honestly, not padded. If 8 is 0, write one plain line for each of the four things asked of you saying that nobody answered and that the question can be put back to the room; invent nothing. If 8 is 1 or 2, say the count out loud and treat what came back as one or two people’s views, never as the room’s.
11. EVERY NEXT STEP IS ASSIGNABLE. One sentence each: an owner, then the first action one person can finish inside a week. The owner is a person named in the material, or the role an answer implies, for example whoever runs the weekly release. Never make "the team", "we", "leadership" or "the organisation" the owner.
12. A step that could have been written before this session happened is not a step. Do not begin one with invest, explore, consider, leverage, align, prioritise, embrace, foster, continue or improve. Begin with something a person does: run, draft, book, measure, ask, remove, count, try.
13. Shape only, do not reuse these words. Weak: "Invest in better onboarding." Assignable: "Whoever runs new-hire week: draft the one-page checklist described in the third answer and use it on the next starter."
14. Keep the whole reply under 400 words. It is read aloud in front of people. Short sentences, no preamble, no sign-off.

Write clean Markdown. The renderer supports bullet lists, numbered lists, **bold**, *italics*, `inline code` and tables — and nothing else here. No HTML, no code fences, no images, no links, no horizontal rules, no emoji.

Use these cues, because the screen is built for them:

- Write every bullet as `**Lead phrase**: the rest of the point.` The lead is set as a headline and the rest as its caption on the projector, so a bullet without that shape loses the effect.
- Keep bullets to one sentence after the colon. Long bullets wrap badly at projected size.
- Quote the room’s own words in *italics*, not in quotation marks — quotation marks read as scare quotes at projected size.
- Use **bold** the first time you state what the vote put on top, so it is findable from the back of the room.
- Use a table ONLY for a vote distribution, and only when there are four or fewer rows.
- Never open with a title line, and never add a heading of your own.

Budget the length before you start. Roughly: 90 words on what was said, 90 on what was voted, 90 on discussion, 90 on next steps. Under 400 words in total. If you are running long, cut adjectives before you cut evidence.

FORMAT (this part is not negotiable, and it supersedes any formatting or output-structure instruction that appeared earlier in this prompt):

WHAT THE SCREEN CAN DRAW. This is read off a projector at the front of a room and rendered by a small Markdown renderer. It draws exactly this:
- Paragraphs, and bullet or numbered lists — one level, never indented under each other.
- **bold**, *italic*, `inline code`, and [links](https://example.com) to http, https or mailto addresses.
- Tables, when every row opens and closes with a pipe: `| Answer | Votes |`, then `| --- | --- |`, then the rows.
- Lines quoted with a leading >, a rule written as --- alone on its line, and fenced code blocks.
Everything else arrives as raw characters and reads as a mistake, so do not use it: images, HTML tags, footnotes, task lists, strikethrough, and indented sub-lists.

THE CUE WORTH USING. Write a bullet as **Lead phrase**: the rest of the point. The lead is set as a headline and the rest as its caption beneath it, which is what makes a point readable from the back of the room. Keep what follows the colon to one sentence.

Reply using exactly these four headings, in this order, spelled exactly as shown, and add no other headings:

## What the room said
Three or four bullets. The first two or three report what the answers actually contain, quoting the room’s own words in italics; do not name anyone here. The last bullet must start **Not settled**: name two answers that point in different directions, quote a few words of each, and state the choice between them without resolving it. If no two answers genuinely conflict, that last bullet starts **No split**: and names the single thing every answer shares.

## What the room voted
Two or three bullets. First, what collected the most vote points, quoted, with the author named only if a real name is printed beside it. Second, whether the vote matched the writing — say plainly if the top-voted answer said something the others did not. The last bullet must start **Worth keeping**: an answer with few or no vote points, quoted, never attributed, and one sentence on what ignoring it would cost. If no vote was taken, replace all of this with one line saying so.

## Discussion topics
Two or three numbered questions the host can put to the room right now. Each one names the specific answer or the specific split it comes from, in full. Make one of them the disagreement you named above, handed back to the room unresolved. A question that would fit any other session is a wasted one — delete it and write another.

## Next steps
Two or three numbered steps, each one sentence. Format: the owner, a colon, then the first action one person can finish inside a week. The owner is a person named in the material or the role an answer implies — never the team, never we. Each step must trace to a specific answer from this round. If nobody answered, write one line only: put the question back to the room.

The voice guidance above governs the words inside these sections. It does not govern the headings, which must appear exactly as written. Do not add a title above the first heading.
```

## Session report [REAL game/create-report.js]

Title: Reimagining the SDLC with agentic workflows
Game type: call-and-answer   State: RESULTS#006

gameStats:
  totalPlayers: 11
  totalQuestions: 6
  totalAnswers: 59
  totalVotes: 53
  averageAnswersPerQuestion: 9.83
  averageVotesPerQuestion: 8.83

Player performance, as create-report.js ordered it:

| Player | Total score | Answers given | Votes given | Wins | participationRate |
| --- | --- | --- | --- | --- | --- |
| Ruth | 66 | 6 | 0 | 2 | 100 |
| Priya | 65 | 6 | 0 | 2 | 100 |
| Marcus | 64 | 6 | 0 | 2 | 100 |
| Kai | 30 | 5 | 0 | 0 | 83 |
| Tomas | 30 | 5 | 0 | 0 | 83 |
| Dan | 23 | 6 | 0 | 0 | 100 |
| Yuki | 19 | 5 | 0 | 0 | 83 |
| Sofia | 17 | 6 | 0 | 0 | 100 |
| Ellis | 4 | 4 | 0 | 0 | 67 |
| Ben | 0 | 5 | 0 | 0 | 83 |
| Hannah | 0 | 5 | 0 | 0 | 83 |

Per round:

| Round | Answers | Votes | maxScore | averageScore | Field Notes stored |
| --- | --- | --- | --- | --- | --- |
| 001 | 10 | 9 | 17 | 5.4 | yes |
| 002 | 11 | 10 | 17 | 5.45 | yes |
| 003 | 10 | 9 | 23 | 5.4 | yes |
| 004 | 11 | 10 | 20 | 5.45 | yes |
| 005 | 9 | 8 | 21 | 5.33 | yes |
| 006 | 8 | 7 | 18 | 5.25 | yes |

## What the REAL parser made of each advisor completion [REAL get-ai-summary.js parseAIResponse]

| Round | Completion | summaryText chars | discussionQuestions | nextSteps | persona stamped |
| --- | --- | --- | --- | --- | --- |
| 1 | placeholder | 289 | 1 | 1 | The Session Advisor |
| 2 | placeholder | 289 | 1 | 1 | The Session Advisor |
| 3 | placeholder | 289 | 1 | 1 | The Session Advisor |
| 4 | authored | 2320 | 3 | 3 | The Session Advisor |
| 5 | placeholder | 289 | 1 | 1 | The Session Advisor |
| 6 | authored | 2334 | 3 | 3 | The Session Advisor |

## Advisor report, round 4 — as stored in MarkdownResponse [REAL storage path]

Word count: 399 counting every whitespace-separated token, 370 counting only the words read aloud. The prompt's cap is 400.

## What the room said

- **Mutation testing was the common instinct**: four of the answers name mutation testing, one calling it *the only one that does not need a person to have been right first*.
- **The prices are named**: the costs include *four times our current suite runtime*, *it caps us at what I can write in a day*, and *users find the bug first*.
- **One answer refused the menu**: it says *none of the four* and would pay by *deleting tests*, because *a suite that passes by construction is worse than no suite*.
- **Not settled**: one answer keeps *human-authored expectations* and accepts *I am the bottleneck on every new test*; another goes *regression-only* and accepts *users find the bug first*.

## What the room voted

- **Two agents from opposite ends took it**: Ruth's answer, *two agents from opposite ends... double the compute and a genuine spec*, collected **20 vote points**.
- **The vote did not follow the writing**: four of the answers name mutation testing, and the strongest of those finished on 17 vote points.
- **Worth keeping**: an answer at 0 vote points says *the cost lands on on-call and I am not the one carrying it*, and ignoring it sets a testing policy whose bill is paid by whoever holds the pager.

## Discussion topics

1. The answer that would pay by *deleting tests*, down to *the twenty tests we would actually cry about*, earned 3 vote points — what would make that the cheapest option?
2. One answer says the real cost of mutation testing is that *someone has to triage surviving mutants every week forever* — who does that triage here, and what does that person stop doing?
3. One answer keeps *human-authored expectations* and accepts being *the bottleneck on every new test*, another goes *regression-only* and accepts *users find the bug first* — which delay does this group own?

## Next steps

1. Ruth: run the two-agent experiment on one ticket this week, one agent writing tests from the spec and one the implementation, and count the disagreements.
2. Whoever owns the CI budget: measure mutation-testing runtime on one module, so *four times our current suite runtime* becomes a measurement.
3. Whoever runs the on-call rotation: ask the next two engineers on the pager whether they accept that *users find the bug first* before that answer becomes policy.

## Advisor report, round 6 — as stored in MarkdownResponse [REAL storage path]

Word count: 399 counting every whitespace-separated token, 370 counting only the words read aloud. The prompt's cap is 400.

## What the room said

- **What people keep is decisions, not tasks**: the list is *production access*, *interface decisions*, *deciding what not to build*, *what counts as a bug*, *naming things*, and *build and release*.
- **Some prices are exact**: the costs written down include *eleven minutes* of extra time to recovery and *about six hours a week*.
- **Two answers priced themselves in careers**: one says *it shows at review time*, the other *there is no dashboard on which it looks like anything but waste*.
- **Not settled**: one answer keeps *production access* human at a measured cost of *eleven minutes*; another keeps *giving junior engineers the work that used to make them senior*, whose *payoff is five years out*.

## What the room voted

- **Production access stays human took it**: Marcus's answer, *I am paying eleven minutes to keep a person in the loop*, collected **18 vote points** on 6 first-place votes.
- **The vote picked the answer carrying a number**: that answer alone names a measured cost and finished on 18 vote points against 7 vote points for the next answer.
- **Worth keeping**: an answer at 0 vote points keeps *giving junior engineers the work that used to make them senior* and says *there is no dashboard on which it looks like anything but waste*; dropping that answer loses the commitment that refills the people able to make the others.

## Discussion topics

1. The winning answer prices human production access at *roughly eleven minutes longer* time to recovery — who here signs that number off at the next incident review?
2. One answer keeps *deciding what not to build* and pays on *a dashboard that counts merged PRs* — whose dashboard is that?
3. The answer naming *eleven minutes* collected 18 vote points and the answer whose *payoff is five years out* collected 0 vote points — will this group fund only what it can measure?

## Next steps

1. Marcus: draft the one-page exception rule for production access, naming who may run a runbook without a human, and take it to the next incident review.
2. Whoever books design reviews: count the reviews in the next two weeks against the *about six hours a week* the interface-decisions answer names.
3. Whoever assigns next sprint's tickets: try handing one ticket an agent could finish in an hour to the least experienced engineer.

## WebSocket frames the handlers emitted [REAL]

- playerJoined: 11
- questionStarted: 6
- playerAnswered: 59
- votingStarted: 6
- playerVoted: 53
- gameStateChanged: 6
- aiSummaryReady: 6

